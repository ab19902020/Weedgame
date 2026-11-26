// Trains on the Reading–Waterloo line (Reading, Earley, Winnersh Triangle, Winnersh, Wokingham, Bracknell,
// Martins Heron) and the Great Western main line through Reading. Paths come from www/world/rail.json
// (tools/rail/build_rail.mjs: OSM track from the tiles, stations from manifest.stations when present,
// otherwise public coordinates snapped to the track). No timetable: each line runs evenly spaced trains
// that shuttle end to end, stopping at every station with a fixed dwell. Positions follow a precomputed
// run profile, so the service is continuous and cheap; cars are drawn only where tiles are loaded.
import * as THREE from 'three/webgpu';
import { mergeGeos } from './tiles.js';

// cars are 18 m long, as the passenger car (passengerCabin.js) the riders sit in
export const CAR_L = 18, CAR_GAP = 0.9, PITCH = CAR_L + CAR_GAP;
const CAR_W = 2.8, CAR_H = 3.7, ACC = 0.6, DEC = 0.75, DWELL = 40, TURN = 240, DT = 0.5;

export class Trains {
  constructor(G) {
    this.G = G; this.lines = []; this.trains = []; this.t = 0; this.ready = false; this.drawn = 0; this.hide = new Set();
    if (G?.rail) { this.setup(G.rail); this.build(); this.ready = true; }   // rail.json, already fetched at boot (main.js)
    else if (G) this.load().catch(e => console.warn('trains: no rail data', e.message));
  }
  async load() {
    const r = await fetch('world/rail.json'); if (!r.ok) return;
    this.setup(await r.json()); this.build(); this.ready = true;
  }
  setup(data) {
    this.stations = data.stations || [];
    for (const L of data.lines || []) {
      const n = L.p.length / 3, P = new Float32Array(L.p), S = new Float32Array(n);
      for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
      const len = S[n - 1], named = L.stops.filter(s => s.name), stops = named.map(s => s.s);
      const line = { name: L.name, P, S, n, len, stops, names: named.map(s => s.name), cars: L.cars || 4, vmax: L.vmax || 30, color: L.color ?? 0x334488,
        headway: L.headway || 900, board: !!L.board, off: L.off || null };
      // a train stops with its middle at the station (its front half a train beyond), and a line whose first
      // or last station is at its end turns round there instead of running on to the end of the track
      const Lt = line.cars * PITCH; line.Lt = Lt;
      line.centre = stops.map(s => Math.max(Lt / 2, Math.min(len - Lt / 2, s)));
      const t0 = stops.length && stops[0] < 60, t1 = stops.length && stops.at(-1) > len - 60;
      line.term0 = !!t0; line.term1 = !!t1;
      const fStops = line.centre.map(c => c + Lt / 2), bStops = line.centre.map(c => len - c + Lt / 2).reverse();
      // (a run starts where the reversed train's front is: a train length in from the end it turned at)
      line.fwd = this.profile(line, fStops, t0 ? fStops[0] : Lt, t1 ? fStops.at(-1) : len);
      line.bwd = this.profile(line, bStops, t1 ? bStops[0] : Lt, t0 ? bStops.at(-1) : len);
      line.cycle = line.fwd.length * DT + TURN + line.bwd.length * DT + TURN;
      const k = Math.max(1, Math.round(line.cycle / line.headway));
      for (let j = 0; j < k; j++) this.trains.push({ id: `${L.name.split(/[ –]/).map(w => w[0]).join('').toLowerCase()}-${j + 1}`, line, phase: j * line.cycle / k, s: 0, dir: 1, v: 0, status: '' });
      this.lines.push(line);
    }
    return this;
  }
  // front of the train every DT seconds for a run from start to end that stops at each station front
  // position on the way (ascending, in the run's own direction)
  profile(line, stops, start = 0, end = line.len) {
    const out = []; let s = start, v = 0, i = 0, dwell = 0, guard = 0;
    const next = stops.filter(x => x > start + 1 && x < end - 1);
    if (stops.some(x => Math.abs(x - start) <= 1)) out.push(...new Array(Math.round(DWELL / DT)).fill(start));
    while (s < end - 0.5 && guard++ < 200000) {
      if (dwell > 0) { dwell -= DT; out.push(s); continue; }
      const target = i < next.length ? next[i] : end, d = target - s;
      const vStop = Math.sqrt(Math.max(0, 2 * DEC * d));
      v = Math.min(line.vmax, v + ACC * DT, vStop);
      if (d < 0.6 || (v < 0.05 && d < 3)) { s = target; v = 0; i++; dwell = target < end - 1 ? DWELL : 0; out.push(s); continue; }
      s = Math.min(target, s + v * DT); out.push(s);
    }
    out.push(end);
    return Float32Array.from(out);
  }
  // where a train's front is at line time tau: [s, direction, speed, status]. At a terminus the train
  // reverses: its front becomes the old rear, a train length back.
  state(tr, tau) {
    const L = tr.line, a = L.fwd.length * DT, b = a + TURN, c = b + L.bwd.length * DT;
    let t = (tau + tr.phase) % L.cycle;
    const at = (arr, t) => { const i = Math.min(arr.length - 1, Math.floor(t / DT)), j = Math.min(arr.length - 1, i + 1), f = t / DT - i; return [arr[i] + (arr[j] - arr[i]) * f, (arr[j] - arr[i]) / DT]; };
    if (t < a) { const [s, v] = at(L.fwd, t); return [s, 1, v, v < 0.05 ? 'at station' : 'running']; }
    if (t < b) return [L.fwd[L.fwd.length - 1] - L.Lt, -1, 0, 'terminus'];
    if (t < c) { const [s, v] = at(L.bwd, t - b); return [L.len - s, -1, v, v < 0.05 ? 'at station' : 'running']; }
    return [L.len - L.bwd[L.bwd.length - 1] + L.Lt, 1, 0, 'terminus'];
  }
  // lateral offset (+ left of the line's forward direction) of the track a train going dir uses at s
  offset(L, s, dir) {
    const o = L.off; if (!o) return 0;
    const g = a => { const x = Math.max(0, Math.min(a.length - 1.001, s / o.ds)), i = Math.floor(x), f = x - i; return a[i] + (a[Math.min(a.length - 1, i + 1)] - a[i]) * f; };
    let v = g(dir > 0 ? o.f : o.b);
    // at a terminus a train leaves from the platform it came in at: near the end station both directions
    // use the arrival track, easing back to their own over 120 m
    if (L.term1 && dir < 0) { const k = (s - (L.centre.at(-1) - L.Lt / 2 - 120)) / 120; if (k > 0) v += (g(o.f) - v) * Math.min(1, k); }
    if (L.term0 && dir > 0) { const k = ((L.centre[0] + L.Lt / 2 + 120) - s) / 120; if (k > 0) v += (g(o.b) - v) * Math.min(1, k); }
    return v;
  }
  // point on the running track for direction dir at s: [x, y, z, dx, dy, dz] (offset included)
  track(L, s, dir, out) {
    this.at(L, s, out);
    const h = Math.hypot(out[3], out[5]) || 1, o = this.offset(L, s, dir);
    out[0] += out[5] / h * o; out[2] -= out[3] / h * o;
    return out;
  }
  // the station a stopped train is standing at (index into line.stops), or -1
  stationOf(tr) {
    if (tr.status === 'running') return -1;
    const L = tr.line, mid = tr.s - tr.dir * L.Lt / 2;
    let best = -1, bd = 6;
    L.centre.forEach((c, k) => { const d = Math.abs(c - mid); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  // point and tangent on the line at distance s
  at(L, s, out) {
    s = Math.max(0, Math.min(L.len, s));
    let lo = 0, hi = L.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.S[m] <= s) lo = m; else hi = m; }
    const f = (s - L.S[lo]) / Math.max(1e-6, L.S[hi] - L.S[lo]), P = L.P;
    for (let k = 0; k < 3; k++) out[k] = P[lo * 3 + k] + (P[hi * 3 + k] - P[lo * 3 + k]) * f;
    out[3] = P[hi * 3] - P[lo * 3]; out[4] = P[hi * 3 + 1] - P[lo * 3 + 1]; out[5] = P[hi * 3 + 2] - P[lo * 3 + 2];
    return out;
  }
  build() {
    const box = (w, h, l, y, col) => { const g = new THREE.BoxGeometry(l, h, w).toNonIndexed(); g.translate(0, y + h / 2, 0); const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
    const geo = mergeGeos([
      ...Array.from({length:9},(_,i) => box(CAR_W+.055,.96,.085,2.095,[.58,.62,.65]).translate((i-4)*1.65,0,0)),
      ...[-1,1].flatMap(end => [
        box(CAR_W+.065,1.94,1.08,1.02,[.70,.72,.73]).translate(end*5.7,0,0),
        box(CAR_W+.08,.68,.86,2.14,[.09,.13,.16]).translate(end*5.7,0,0),
        box(CAR_W+.09,1.89,.035,1.05,[.15,.16,.16]).translate(end*5.7,0,0),
        box(1.12,.18,2.05,CAR_H+.09,[.50,.53,.55]).translate(end*3.4,0,0),
        box(1.52,.18,.34,.42,[.24,.25,.25]).translate(end*8.86,0,0),
      ]),
      box(CAR_W, CAR_H - 0.9, CAR_L, 0.9, [1, 1, 1]),                         // body (tinted per line)
      box(CAR_W + 0.04, 0.95, CAR_L - 2.6, 2.1, [0.05, 0.06, 0.08]),            // window band
      box(CAR_W - 0.3, 0.12, CAR_L - 0.4, CAR_H, [0.55, 0.56, 0.58]),            // roof
      box(CAR_W - 0.5, 0.75, CAR_L - 3, 0.15, [0.08, 0.08, 0.08]),              // underframe and bogies
      box(1.3, 2.1, 0.06, 0.9, [0.12, 0.12, 0.13]).translate(-CAR_L / 2 + 0.02, 0, 0),  // gangway ends
      box(1.3, 2.1, 0.06, 0.9, [0.12, 0.12, 0.13]).translate(CAR_L / 2 - 0.02, 0, 0),
    ]);
    const max = Math.max(1, this.trains.reduce((a, t) => a + t.line.cars, 0));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.2, vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.castShadow = !!this.G.renderer?.shadowMap?.enabled; this.mesh.name = 'trains';
    this.G.scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YZX'); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.col = new THREE.Color(); this.tmp = new Float64Array(6); this.tmp2 = new Float64Array(6); this.tmp3 = new Float64Array(6);
  }
  update(dt) {
    if (!this.ready) return;
    this.t += dt;
    for (const tr of this.trains) { const [s, dir, v, st] = this.state(tr, this.t); if (tr.status === 'at station' && st === 'running' && this.G?.audio?.fleetBank) {
        const p = this.track(tr.line,s,dir,this.tmp);
        this.G.audio.departure('railHorn',p[0],p[1],p[2]);
      }
      tr.s = s; tr.dir = dir; tr.v = Math.abs(v); tr.status = st; tr.station = this.stationOf(tr); }
  }
  // cars within maxD of the camera, on loaded tiles only
  draw(cam, maxD = 900) {
    if (!this.ready) return;
    const M = this.mesh, tiles = this.G.tiles; let n = 0;
    for (const tr of this.trains) {
      const L = tr.line;
      if (this.hide.has(tr)) continue;           // drawn as passenger cars by transit.js
      for (let c = 0; c < L.cars; c++) {
        // the leading car is at s (front), the rest trail behind it
        const sm = this.carCentre(tr, c);
        const p = this.track(L, sm, tr.dir, this.tmp);
        if (Math.abs(p[0] - cam.x) > maxD || Math.abs(p[2] - cam.z) > maxD) continue;
        if (!tiles.tileAt(p[0], p[2])) continue;
        const bx = p[0], by = p[1], bz = p[2], a = this.track(L, sm - CAR_L * 0.45, tr.dir, this.tmp2), b2 = this.track(L, sm + CAR_L * 0.45, tr.dir, this.tmp3);
        const dx = b2[0] - a[0], dy = b2[1] - a[1], dz = b2[2] - a[2], h = Math.hypot(dx, dz) || 1;
        this.e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, h)); this.q.setFromEuler(this.e);
        this.p.set(bx, by, bz); this.m4.compose(this.p, this.q, this.one);
        M.setMatrixAt(n, this.m4); M.setColorAt(n, this.col.set(L.color)); n++;
        if (n >= M.instanceMatrix.count) break;
      }
    }
    M.count = n; M.visible = n > 0; this.drawn = n;
    if (n) { M.instanceMatrix.needsUpdate = true; if (M.instanceColor) M.instanceColor.needsUpdate = true; }
  }
  // centre of car c (0 leads) along the line
  carCentre(tr, c) { const L = tr.line; return Math.max(CAR_L / 2, Math.min(L.len - CAR_L / 2, tr.s - tr.dir * (c + 0.5) * PITCH)); }
  // for the HUD / tests: trains with their line, position and state (middle of the train)
  list() { return this.trains.map(tr => { const p = this.track(tr.line, tr.s - tr.dir * tr.line.Lt / 2, tr.dir, new Float64Array(6)); return { id: tr.id, line: tr.line.name, s: Math.round(tr.s), x: Math.round(p[0]), z: Math.round(p[2]), dir: tr.dir, v: +tr.v.toFixed(1), status: tr.status, station: tr.station >= 0 ? tr.line.names[tr.station] : null }; }); }
}
