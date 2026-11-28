// Railway stations for the lines passengers can ride (rail.json `board`, trains.js). Trains keep left, so
// each direction has its own platform beside the track it runs on, on the train's nearside; a terminus has
// one platform, used both ways (trains leave from the track they came in on). A platform is as long as the
// train plus 8 m at each end and stands 0.86 m above the rails, level with the car floor, with a ramp down
// to the ground at each end, the station's name boards, a shelter with a bench, more benches and lamps.
// Platforms and ramps are walkable (tiles.ground asks decks()) and people wait on them for the next train.
import * as THREE from 'three/webgpu';
import { TransitSign } from './transitSign.js';
import { People } from './characters.js';
import { CAR_L } from './trains.js';

const EDGE = 1.55;     // track centre to platform edge (a car is 2.7 m wide)
const WIDTH = 3.2, TOP = 0.86, SEG = 5, RAMP = 0.083, CELL = 32;

export class Stations {
  constructor(G) {
    this.G = G; this.platforms = []; this.list = []; this.grid = new Map(); this.waiting = []; this.seq = 0; this.lampT = -1;
    const T = G.trains; if (!T?.ready) return;
    for (const L of T.lines) {
      if (!L.board) continue;
      L.names.forEach((name, k) => {
        const terminus = k === 0 && L.term0 ? 'start' : k === L.names.length - 1 && L.term1 ? 'end' : null;
        for (const dir of [1, -1]) {
          if ((terminus === 'start' && dir > 0) || (terminus === 'end' && dir < 0)) continue;
          this.platforms.push(this.layout(L, k, name, dir, terminus));
        }
      });
    }
    // number the platforms at each station; one entry per station for maps, search and the HUD
    for (const p of this.platforms) {
      let st = this.list.find(s => s.name === p.name);
      if (!st) { st = { name: p.name, x: p.mid[0], z: p.mid[2], y: p.mid[1], platforms: [] }; this.list.push(st); }
      st.platforms.push(p); p.number = st.platforms.length;
    }
    if (G.scene) this.build();
  }
  // geometry of one platform: samples of its centre line, edge and outer side every SEG metres
  layout(L, k, name, dir, terminus) {
    const T = this.G.trains, c = L.centre[k], hl = L.Lt / 2 + 8, tmp = new Float64Array(6), pts = [];
    const side = dir;   // + : left of the line's forward direction
    // (at a terminus the platform stops where the track does)
    const s0 = Math.max(0, c - hl), s1 = Math.min(L.len, c + hl);
    for (let s = s0; s <= s1 + 0.01; s = s < s1 && s + SEG > s1 ? s1 : s + SEG) {
      T.at(L, s, tmp);
      const h = Math.hypot(tmp[3], tmp[5]) || 1, ux = tmp[3] / h, uz = tmp[5] / h, nx = uz, nz = -ux;
      const o = T.offset(L, s, dir), edge = o + side * EDGE, outer = o + side * (EDGE + WIDTH);
      pts.push({ s, y: tmp[1] + TOP, rail: tmp[1], ux, uz, nx, nz, x: tmp[0], z: tmp[2], edge, outer });
    }
    const m = pts[Math.floor(pts.length / 2)], lc = (m.edge + m.outer) / 2;
    const dest = dir > 0 ? L.names.at(-1) : L.names[0];
    return { line: L, k, name, dir, side, terminus, c, hl, pts, dest: terminus ? null : dest, mid: [m.x + m.nx * lc, m.y, m.z + m.nz * lc] };
  }
  // the ground the platforms need, for the tile worker (tileWorker.js cutPlatforms): per platform its sample
  // count, then per sample a point just beyond its track, a point 2.5 m behind the platform and the rail
  // height. Where a station stands in a cutting the ground is cut down to the track under it.
  footprints() {
    const out = [];
    for (const p of this.platforms) {
      out.push(p.pts.length);
      for (const q of p.pts) {
        const track = q.edge - p.side * EDGE, a = track - p.side * 1.6, b = q.outer + p.side * 2.5;
        out.push(q.x + q.nx * a, q.z + q.nz * a, q.x + q.nx * b, q.z + q.nz * b, q.rail);
      }
    }
    return out;
  }
  // world point at fraction f (0 edge .. 1 outer side) across the platform at sample i
  across(p, i, f) {
    const q = p.pts[i], o = q.edge + (q.outer - q.edge) * f;
    return [q.x + q.nx * o, q.y, q.z + q.nz * o];
  }
  build() {
    const G = this.G, col = [], pos = [], glassPos = [], lampPos = [], tmp = new Float64Array(6);
    const tri = (P, C, a, b, c, rgb) => { P.push(...a, ...b, ...c); if (C) for (let i = 0; i < 3; i++) C.push(...rgb); };
    const quad = (P, C, a, b, c, d, rgb) => { tri(P, C, a, b, c, rgb); tri(P, C, a, c, d, rgb); };
    const boxAt = (P, C, x, y, z, ang, hx, hy, hz, rgb) => {   // y is the bottom
      const ca = Math.cos(ang), sa = Math.sin(ang), V = (u, v, w) => [x + u * ca - w * sa, y + v, z + u * sa + w * ca];
      const c8 = [V(-hx, 0, -hz), V(hx, 0, -hz), V(hx, 0, hz), V(-hx, 0, hz), V(-hx, 2 * hy, -hz), V(hx, 2 * hy, -hz), V(hx, 2 * hy, hz), V(-hx, 2 * hy, hz)];
      for (const [a, b, c, d] of [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(P, C, c8[a], c8[b], c8[c], c8[d], rgb);
    };
    const GREY = [0.6, 0.6, 0.58], WHITE = [0.9, 0.89, 0.84], BUFF = [0.75, 0.62, 0.38], YELLOW = [0.93, 0.76, 0.12], WALL = [0.42, 0.39, 0.37], DARK = [0.16, 0.2, 0.2];
    const BANDS = [[0, 0.45 / WIDTH, WHITE], [0.45 / WIDTH, 0.85 / WIDTH, BUFF], [0.85 / WIDTH, 0.95 / WIDTH, GREY], [0.95 / WIDTH, 1.05 / WIDTH, YELLOW], [1.05 / WIDTH, 1, GREY]];
    for (const p of this.platforms) {
      const n = p.pts.length, up = (v, dy) => [v[0], v[1] + dy, v[2]];
      for (let i = 0; i + 1 < n; i++) {
        for (const [f0, f1, rgb] of BANDS) quad(pos, col, this.across(p, i, f0), this.across(p, i + 1, f0), this.across(p, i + 1, f1), this.across(p, i, f1), rgb);
        const e0 = this.across(p, i, 0), e1 = this.across(p, i + 1, 0), o0 = this.across(p, i, 1), o1 = this.across(p, i + 1, 1);
        quad(pos, col, e0, e1, up(e1, -(TOP + 0.3)), up(e0, -(TOP + 0.3)), WALL);          // face towards the track
        quad(pos, col, o0, o1, up(o1, -(TOP + 4)), up(o0, -(TOP + 4)), WALL);              // back wall, down to the ground
      }
      // ramps at both ends, down to the ground beside the track (or as far as the ground allows)
      p.ramps = [];
      for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
        const q = p.pts[i], ground = q.rail - 0.32, len = Math.max(3, Math.min(14, (q.y - ground) / RAMP));
        const e = this.across(p, i, 0), o = this.across(p, i, 1), dx = q.ux * sgn * len, dz = q.uz * sgn * len;
        const e2 = [e[0] + dx, ground, e[2] + dz], o2 = [o[0] + dx, ground, o[2] + dz];
        quad(pos, col, e, o, o2, e2, GREY);
        quad(pos, col, e, e2, up(e2, -0.3), up(e, -(TOP + 0.3)), WALL); quad(pos, col, o, o2, up(o2, -0.3), up(o, -(TOP + 4)), WALL);
        p.ramps.push({ a: [(e[0] + o[0]) / 2, (e[2] + o[2]) / 2], b: [(e2[0] + o2[0]) / 2, (e2[2] + o2[2]) / 2], ya: q.y, yb: ground });
      }
      // furniture along the back half of the platform
      const at = (s, f) => { const i = Math.max(0, Math.min(n - 1, Math.round((s - p.pts[0].s) / SEG))); return [...this.across(p, i, f), Math.atan2(p.pts[i].uz, p.pts[i].ux)]; };
      for (let s = p.pts[0].s + 6; s < p.pts.at(-1).s - 4; s += 18) {   // lamp posts
        const [x, y, z] = at(s, 0.88); boxAt(pos, col, x, y, z, 0, 0.05, 2.1, 0.05, DARK); boxAt(pos, col, x, y + 4.1, z, 0, 0.22, 0.05, 0.22, DARK); lampPos.push([x, y + 4.05, z]);
      }
      { // shelter at the middle: frame, roof and bench; glass back and ends
        const [x, y, z, a] = at(p.c, 0.72), ca = Math.cos(a), sa = Math.sin(a), nx = sa * p.side, nz = -ca * p.side;   // nx,nz: towards the back
        for (const u of [-2, 0, 2]) boxAt(pos, col, x + ca * u + nx * 0.5, y, z + sa * u + nz * 0.5, a, 0.04, 1.2, 0.04, DARK);
        boxAt(pos, col, x, y + 2.4, z, a, 2.2, 0.04, 0.8, [0.38, 0.4, 0.42]);
        boxAt(pos, col, x + nx * 0.25, y + 0.42, z + nz * 0.25, a, 1.6, 0.03, 0.2, [0.25, 0.28, 0.3]);
        const g0 = [x - ca * 2 + nx * 0.5, y + 0.1, z - sa * 2 + nz * 0.5], g1 = [x + ca * 2 + nx * 0.5, y + 0.1, z + sa * 2 + nz * 0.5];
        quad(glassPos, null, g0, g1, up(g1, 2.2), up(g0, 2.2));
        for (const g of [g0, g1]) quad(glassPos, null, g, [g[0] - nx * 1.1, g[1], g[2] - nz * 1.1], [g[0] - nx * 1.1, g[1] + 2.2, g[2] - nz * 1.1], up(g, 2.2));
      }
      for (const s of [p.c - p.hl * 0.5, p.c + p.hl * 0.5]) {   // benches
        const [x, y, z, a] = at(s + 4, 0.8); boxAt(pos, col, x, y + 0.4, z, a, 0.8, 0.03, 0.22, [0.3, 0.33, 0.35]); boxAt(pos, col, x, y, z, a, 0.7, 0.2, 0.05, DARK);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.receiveShadow = true; mesh.castShadow = !!G.renderer?.shadowMap?.enabled; mesh.name = 'station-platforms';
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3)); gg.computeVertexNormals();
    const glass = new THREE.Mesh(gg, new THREE.MeshStandardNodeMaterial({ color: 0x9fc4cf, transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    this.lampMat = new THREE.MeshStandardNodeMaterial({ color: 0xfff4dc, emissive: 0xffe2b0, emissiveIntensity: 0 });
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.06, 0.36), this.lampMat, Math.max(1, lampPos.length));
    const m4 = new THREE.Matrix4(); lampPos.forEach((q, i) => lamps.setMatrixAt(i, m4.makeTranslation(q[0], q[1], q[2]))); lamps.count = lampPos.length; lamps.computeBoundingSphere();
    // name boards: one canvas per station, two boards per platform facing the track
    const group = new THREE.Group(); group.name = 'stations'; group.add(mesh, glass, lamps);
    for (const st of this.list) {
      const sign = new TransitSign(2.6, 0.62); sign.write(st.platforms[0].line.name.toUpperCase(), st.name); this.boards = (this.boards || []).concat(sign);
      for (const p of st.platforms) for (const s of [p.c - p.hl * 0.55, p.c + p.hl * 0.55]) {
        const i = Math.max(0, Math.min(p.pts.length - 1, Math.round((s - p.pts[0].s) / SEG))), [x, y, z] = this.across(p, i, 0.55), q = p.pts[i];
        const b = new THREE.Mesh(sign.geometry, sign.material); b.position.set(x, y + 2.55, z); b.rotation.y = Math.atan2(q.nx * p.side, q.nz * p.side) + Math.PI; group.add(b);
        for (const u of [-1.2, 1.2]) { const post = new THREE.Mesh(this.postGeo || (this.postGeo = new THREE.BoxGeometry(0.07, 2.9, 0.07).translate(0, 1.45, 0)), this.postMat || (this.postMat = new THREE.MeshStandardNodeMaterial({ color: 0x24302f }))); post.position.set(x + q.ux * u, y, z + q.uz * u); group.add(post); }
      }
    }
    G.scene.add(group); this.group = group;
    // walkable surfaces
    for (const p of this.platforms) {
      for (let i = 0; i + 1 < p.pts.length; i++) { const a = this.across(p, i, 0.5), b = this.across(p, i + 1, 0.5); this.addDeck(a[0], a[2], b[0], b[2], WIDTH / 2, a[1], b[1]); }
      for (const r of p.ramps) this.addDeck(r.a[0], r.a[1], r.b[0], r.b[1], WIDTH / 2, r.ya, r.yb);
    }
    if (G.tiles) G.tiles.extraDecks = (x, z, out) => this.decks(x, z, out);
  }
  addDeck(ax, az, bx, bz, hw, ya, yb) {
    const id = (this.decksList || (this.decksList = [])).push([ax, az, bx, bz, hw, ya, yb]) - 1;
    for (let cx = Math.floor((Math.min(ax, bx) - hw) / CELL); cx <= Math.floor((Math.max(ax, bx) + hw) / CELL); cx++)
      for (let cz = Math.floor((Math.min(az, bz) - hw) / CELL); cz <= Math.floor((Math.max(az, bz) + hw) / CELL); cz++) {
        const k = cx * 65536 + cz; let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(id);
      }
  }
  // heights of platform and ramp surfaces under (x, z)
  decks(x, z, out) {
    const l = this.grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)); if (!l) return out;
    for (const id of l) {
      const [ax, az, bx, bz, hw, ya, yb] = this.decksList[id], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = ((x - ax) * vx + (z - az) * vz) / L2; if (t < -0.02 || t > 1.02) continue;
      const tt = Math.max(0, Math.min(1, t));
      if (Math.hypot(ax + vx * tt - x, az + vz * tt - z) <= hw) out.push(ya + (yb - ya) * tt);
    }
    return out;
  }
  // the platform someone at (x, y, z) stands on (a metre's grace around it)
  platformAt(x, z, y) {
    for (const p of this.platforms) {
      if (Math.abs(x - p.mid[0]) > p.hl + 20 || Math.abs(z - p.mid[2]) > p.hl + 20) continue;
      for (let i = 0; i + 1 < p.pts.length; i++) {
        const a = this.across(p, i, 0.5), b = this.across(p, i + 1, 0.5), vx = b[0] - a[0], vz = b[2] - a[2], L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[2]) * vz) / L2));
        if (Math.hypot(a[0] + vx * t - x, a[2] + vz * t - z) <= WIDTH / 2 + 1 && (y == null || Math.abs(y - a[1]) < 2.5)) return p;
      }
    }
    return null;
  }
  // a train standing at this platform, doors open: same line and station, on this platform's track
  trainAt(p) {
    return this.G.trains.trains.find(tr => tr.line === p.line && tr.status !== 'running' && tr.station === p.k && (p.terminus || tr.dir === p.dir)) || null;
  }
  // the platform a stopped train has its doors on
  platformFor(tr) {
    if (!tr || tr.status === 'running' || tr.station < 0) return null;
    return this.platforms.find(p => p.line === tr.line && p.k === tr.station && (p.terminus || p.dir === tr.dir)) || null;
  }
  // a point on platform p beside world position (x, z): where someone getting off there stands
  beside(p, x, z) {
    let best = this.across(p, Math.floor(p.pts.length / 2), 0.3), bd = Infinity;
    for (let i = 0; i < p.pts.length; i++) { const q = this.across(p, i, 0.3), d = Math.hypot(q[0] - x, q[2] - z); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  // the next station a train will call at, or its terminus
  nextName(tr) {
    const L = tr.line, mid = tr.s - tr.dir * L.Lt / 2;
    if (tr.dir > 0) { const k = L.centre.findIndex(c => c > mid + 5); return L.names[k >= 0 ? k : L.names.length - 1]; }
    for (let k = L.centre.length - 1; k >= 0; k--) if (L.centre[k] < mid - 5) return L.names[k];
    return L.names[0];
  }
  destination(tr) { return tr.dir > 0 ? tr.line.names.at(-1) : tr.line.names[0]; }
  // people waiting on the platforms near the player; they board the next train that opens its doors
  update(dt, focus) {
    const G = this.G;
    if (this.lampMat) { const n = G.U?.night?.value ?? 0; if (Math.abs(n - this.lampT) > 0.02) { this.lampT = n; this.lampMat.emissiveIntensity = n * 2.2; } }
    for (const p of this.platforms) {
      const near = Math.hypot(p.mid[0] - focus.x, p.mid[2] - focus.z) < 260;
      p.people = p.people || [];
      const tr = this.trainAt(p);
      // a train in: a few get off and make for the ramps, and those waiting walk to the nearest door and get on
      if (tr && !p.served) {
        p.served = true; p.doors = this.doorsOf(p, tr);
        for (const q of p.people) if (!q.path) { q.board = this.nearestDoor(p, q.x, q.z); q.delay = Math.random() * 2.2; }
        if (near && p.doors.length) this.alight(p);
      }
      if (!tr && p.served) { p.served = false; p.doors = null; p.respawn = 45 + Math.random() * 60; for (const q of p.people) q.board = null; }
      for (const q of p.people) if (q.board || q.path) this.walkOn(p, q, dt);
      if (p.people.some(q => q.gone)) p.people = p.people.filter(q => !q.gone);
      if (p.respawn > 0) p.respawn -= dt;
      if (near && !p.people.length && !(p.respawn > 0) && !tr) {
        const n = 1 + Math.floor(Math.random() * 4), mid = Math.floor(p.pts.length / 2);
        for (let k = 0; k < n; k++) {
          const i = Math.max(0, Math.min(p.pts.length - 1, mid + Math.round((Math.random() - 0.5) * p.pts.length * 0.7))), q = this.across(p, i, 0.45 + Math.random() * 0.3);
          p.people.push({ id: 'rail-passenger-' + this.seq++, x: q[0], y: q[1], z: q[2], heading: Math.atan2(-p.pts[i].nz * p.side, -p.pts[i].nx * p.side) + (Math.random() - 0.5) * 0.8, look: People.randomLook(), visible: true, speed: 0, t: 0, phase: Math.random() * 6, pose: Math.random() < 0.25 ? 'phone' : 'idle' });
        }
      }
      if (!near && p.people.length) p.people = [];
    }
  }
  // door positions along a standing train, at the platform's edge (two doors a car, at its quarter points)
  doorsOf(p, tr) {
    const T = this.G.trains, L = tr.line, out = [], t = new Float64Array(6);
    for (let k = 0; k < L.cars; k++) for (const f of [-0.25, 0.25]) {
      const sc = T.carCentre(tr, k) + f * CAR_L * tr.dir, c = T.track(L, sc, tr.dir, t);
      let best = p.pts[0], bd = Infinity;
      for (const q of p.pts) { const d = (q.x - c[0]) ** 2 + (q.z - c[2]) ** 2; if (d < bd) { bd = d; best = q; } }
      if (bd > 40 * 40) continue;
      out.push([c[0] + best.nx * p.side * (EDGE - 0.1), best.y, c[2] + best.nz * p.side * (EDGE - 0.1)]);
    }
    return out;
  }
  nearestDoor(p, x, z) {
    let best = null, bd = Infinity;
    for (const d of p.doors || []) { const e = Math.hypot(d[0] - x, d[2] - z); if (e < bd) { bd = e; best = d; } }
    return best;
  }
  // passengers off the train: out at a door, along the platform and down the nearer ramp, then into the street
  alight(p) {
    const n = Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const d = p.doors[Math.floor(Math.random() * p.doors.length)];
      let ramp = null, rd = Infinity;
      for (const r of p.ramps || []) { const top = r.ya >= r.yb ? r.a : r.b, e = Math.hypot(top[0] - d[0], top[1] - d[2]); if (e < rd) { rd = e; ramp = r; } }
      if (!ramp) return;
      const top = ramp.ya >= ramp.yb ? ramp.a : ramp.b, foot = ramp.ya >= ramp.yb ? ramp.b : ramp.a;
      p.people.push({ id: 'rail-passenger-' + this.seq++, x: d[0], y: d[1], z: d[2], heading: 0, look: People.randomLook(), visible: true, speed: 0, t: 0, phase: Math.random() * 6, pose: 'walk',
        delay: 0.4 + k * 0.9, path: [[top[0], top[1]], [foot[0], foot[1]]] });
    }
  }
  // someone on the platform on the move: to a door (and aboard), or off along it and down to the street
  walkOn(p, q, dt) {
    if ((q.delay -= dt) > 0) { q.speedNow = 0; q.pose = 'idle'; return; }
    const tgt = q.board ? [q.board[0], q.board[2]] : q.path[0];
    const dx = tgt[0] - q.x, dz = tgt[1] - q.z, d = Math.hypot(dx, dz), sp = 1.35;
    if (d < 0.4) {
      if (q.board) { q.gone = true; return; }
      q.path.shift();
      if (!q.path.length) { q.gone = true; this.G.peds?.adopt?.(q); }
      return;
    }
    const st = Math.min(d, sp * dt); q.x += dx / d * st; q.z += dz / d * st;
    q.heading = Math.atan2(dz, dx); q.speedNow = sp; q.speed = sp; q.pose = 'walk'; q.phase = (q.phase + sp * dt * 3.6) % 6.283;
    q.gaitPhase = q.phase; q.gaitSpeed = sp;
    const g = this.G.tiles?.ground?.(q.x, q.z, q.y + 0.5); if (g != null) q.y += (g - q.y) * 0.5;
  }
  people() { const out = []; for (const p of this.platforms) if (p.people) out.push(...p.people); return out; }
}
