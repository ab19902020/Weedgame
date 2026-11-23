// Trains on the Reading–Waterloo line (Reading, Earley, Winnersh Triangle, Winnersh, Wokingham, Bracknell,
// Martins Heron) and the Great Western main line through Reading. Paths come from www/world/rail.json
// (tools/rail/build_rail.mjs: OSM track from the tiles, stations from manifest.stations when present,
// otherwise public coordinates snapped to the track). No timetable: each line runs evenly spaced trains
// that shuttle end to end, stopping at every station with a fixed dwell. Positions follow a precomputed
// run profile, so the service is continuous and cheap; cars are drawn only where tiles are loaded.
import * as THREE from 'three/webgpu';
import { mergeGeos } from './tiles.js';

const CAR_L = 20, CAR_GAP = 0.9, CAR_W = 2.8, CAR_H = 3.7, ACC = 0.6, DEC = 0.75, DWELL = 40, TURN = 240, DT = 0.5;

export class Trains {
  constructor(G) {
    this.G = G; this.lines = []; this.trains = []; this.t = 0; this.ready = false; this.drawn = 0;
    if (G) this.load().catch(e => console.warn('trains: no rail data', e.message));
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
      const len = S[n - 1], stops = L.stops.filter(s => s.name).map(s => s.s);
      const line = { name: L.name, P, S, n, len, stops, cars: L.cars || 4, vmax: L.vmax || 30, color: L.color ?? 0x334488, headway: L.headway || 900 };
      // run profile for one direction (forward); the return trip mirrors it
      line.fwd = this.profile(line, stops); line.bwd = this.profile(line, stops.map(s => len - s).reverse());
      line.cycle = line.fwd.length * DT + TURN + line.bwd.length * DT + TURN;
      const k = Math.max(1, Math.round(line.cycle / line.headway));
      for (let j = 0; j < k; j++) this.trains.push({ id: `${L.name.split(/[ –]/).map(w => w[0]).join('').toLowerCase()}-${j + 1}`, line, phase: j * line.cycle / k, s: 0, dir: 1, v: 0, status: '' });
      this.lines.push(line);
    }
    return this;
  }
  // distance along the line every DT seconds for a run that stops at each station (s positions, ascending)
  profile(line, stops) {
    const out = []; let s = 0, v = 0, i = 0, dwell = 0, guard = 0;
    const next = stops.filter(x => x > 1);
    if (stops[0] <= 1) out.push(...new Array(Math.round(DWELL / DT)).fill(0));
    while (s < line.len - 0.5 && guard++ < 200000) {
      if (dwell > 0) { dwell -= DT; out.push(s); continue; }
      const target = i < next.length ? next[i] : line.len, d = target - s;
      const vStop = Math.sqrt(Math.max(0, 2 * DEC * d));
      v = Math.min(line.vmax, v + ACC * DT, vStop);
      if (d < 0.6 || (v < 0.05 && d < 3)) { s = target; v = 0; i++; dwell = target < line.len - 1 ? DWELL : 0; out.push(s); continue; }
      s = Math.min(target, s + v * DT); out.push(s);
    }
    out.push(line.len);
    return Float32Array.from(out);
  }
  // where a train is at line time tau: [s, direction, speed, status]
  state(tr, tau) {
    const L = tr.line, a = L.fwd.length * DT, b = a + TURN, c = b + L.bwd.length * DT;
    let t = (tau + tr.phase) % L.cycle;
    const at = (arr, t) => { const i = Math.min(arr.length - 1, Math.floor(t / DT)), j = Math.min(arr.length - 1, i + 1), f = t / DT - i; return [arr[i] + (arr[j] - arr[i]) * f, (arr[j] - arr[i]) / DT]; };
    if (t < a) { const [s, v] = at(L.fwd, t); return [s, 1, v, v < 0.05 ? 'at station' : 'running']; }
    if (t < b) return [L.len, -1, 0, 'terminus'];
    if (t < c) { const [s, v] = at(L.bwd, t - b); return [L.len - s, -1, v, v < 0.05 ? 'at station' : 'running']; }
    return [0, 1, 0, 'terminus'];
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
    for (const tr of this.trains) { const [s, dir, v, st] = this.state(tr, this.t); tr.s = s; tr.dir = dir; tr.v = Math.abs(v); tr.status = st; }
  }
  // cars within maxD of the camera, on loaded tiles only
  draw(cam, maxD = 900) {
    if (!this.ready) return;
    const M = this.mesh, tiles = this.G.tiles; let n = 0;
    for (const tr of this.trains) {
      const L = tr.line;
      for (let c = 0; c < L.cars; c++) {
        // the leading car is at s (front), the rest trail behind it
        const sm = Math.max(CAR_L / 2, Math.min(L.len - CAR_L / 2, tr.s - tr.dir * (c + 0.5) * (CAR_L + CAR_GAP)));
        const p = this.at(L, sm, this.tmp);
        if (Math.abs(p[0] - cam.x) > maxD || Math.abs(p[2] - cam.z) > maxD) continue;
        if (!tiles.tileAt(p[0], p[2])) continue;
        const bx = p[0], by = p[1], bz = p[2], a = this.at(L, sm - CAR_L * 0.45, this.tmp2), b2 = this.at(L, sm + CAR_L * 0.45, this.tmp3);
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
  // for the HUD / tests: trains with their line, position and state
  list() { return this.trains.map(tr => { const p = this.at(tr.line, tr.s, new Float64Array(6)); return { id: tr.id, line: tr.line.name, s: Math.round(tr.s), x: Math.round(p[0]), z: Math.round(p[2]), dir: tr.dir, v: +tr.v.toFixed(1), status: tr.status }; }); }
}
