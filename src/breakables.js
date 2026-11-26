// Things a car can knock down. Lamp posts, telegraph poles, bins, benches, pillar boxes, young trees,
// shrubs, hedges, fences and low garden walls give way once the car hits them hard enough, taking only
// part of its speed; below that speed they stop it like anything else. Buildings, big trees, tall walls
// and guard rails always stop it.
//   - poles, lamp posts, pillar boxes and young trees snap at the base and topple (a rod falling about its
//     foot), bounce once on landing, and lie there; lamps go dark
//   - bins, benches and fence panels are thrown and tumble to rest
//   - hedges and shrubs are flattened, garden walls burst into bricks
// The tile worker records each struct-mesh prop's vertex range (tileWorker.js: brkRec), so a broken one is
// lifted out of the merged tile mesh into its own mesh. Everything resets when the tile streams out.
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { Debris } from './debris.js';
import { lampMaterial } from './materials.js';
import { SPEC, carLoss } from './breakSpec.js';
export { SPEC };

const BR = 14;
const YOUNG = 9;          // trees shorter than this (m) can be knocked down
const CELL = 16;

export class Breakables {
  constructor(G) {
    this.G = G;
    this.debris = new Debris(G.scene, (x, z, y) => G.tiles.ground(x, z, y) ?? y - 10);
    this.moving = [];
    this.deadLamp = lampMaterial(); this.deadLamp.emissiveNode = vec3(0);
    this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4(); this._mt = new THREE.Matrix4(); this._gen = 1; this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._s = new THREE.Vector3(); this._a = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.smokeT = 0;
    G.tiles.listeners.push((ev, t) => { if (ev === 'load') this.index(t); else if (ev === 'unload') this.moving = this.moving.filter(o => o.t !== t); });
    for (const t of G.tiles.tiles.values()) this.index(t);
  }
  // ------------------------------------------------------------------ indexing
  index(t) {
    if (t.brkGrid || !t.data || t.data.lod) return;
    const grid = t.brkGrid = new Map(), ox = t.data.ox, oz = t.data.oz;
    const add = e => {
      e.t = t;
      const x0 = Math.min(e.ax ?? e.x, e.bx ?? e.x) - 2, x1 = Math.max(e.ax ?? e.x, e.bx ?? e.x) + 2;
      const z0 = Math.min(e.az ?? e.z, e.bz ?? e.z) - 2, z1 = Math.max(e.az ?? e.z, e.bz ?? e.z) + 2;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = cx * 65536 + cz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(e);
      }
      // the collision shape carPhysics tests: a post (circle) or a thick segment
      e.c = e.ax != null ? { k: 'wall', P: new Float32Array([e.ax, e.az, e.bx, e.bz]), s: 0, n: 2, T: e.T, b: e } : { k: 'post', x: e.x, z: e.z, r: e.r, b: e };
    };
    const B = t.data.brk;
    if (B) for (let i = 0; i < B.length; i += BR) {
      const kind = B[i], e = { kind, S: SPEC[kind], v0: B[i + 1], vn: B[i + 2], h: B[i + 8], y: B[i + 13], w0: B[i + 9], wn: B[i + 10], s0: B[i + 11], sn: B[i + 12] };
      if (kind === 4 || (kind >= 7 && kind <= 9)) Object.assign(e, { ax: B[i + 3] + ox, az: B[i + 4] + oz, bx: B[i + 5] + ox, bz: B[i + 6] + oz, T: kind === 4 ? 0.25 : Math.max(0.1, B[i + 7] / 2) });
      else Object.assign(e, { x: B[i + 3] + ox, z: B[i + 4] + oz, ang: B[i + 5], r: B[i + 7] });
      add(e);
    }
    if (t.lamps) t.lamps.forEach((L, i) => { const lp = t.data.lamps; add({ kind: 20, S: SPEC[20], i, x: lp[i * 4] + ox, z: lp[i * 4 + 2] + oz, y: lp[i * 4 + 1], ang: lp[i * 4 + 3], r: 0.11, h: 8 }); });
    if (t.trees) t.trees.forEach(([x, z, H], i) => { const k = H < YOUNG ? 21 : 23; add({ kind: k, S: SPEC[k], i, x, z, y: t.data.trees[i * 4 + 1], r: 0.12 * (1 + H / 14), h: H }); });
    if (t.bushPos) for (let j = 0; j < t.bushPos.length; j += 4) add({ kind: 22, S: SPEC[22], i: t.bushPos[j + 3], x: t.bushPos[j], z: t.bushPos[j + 1], y: 0, r: t.bushPos[j + 2] });
  }
  // candidates near a car for carPhysics.gather (skips broken ones and things on another level)
  gather(x, z, y, r, out) {
    const G = this.G, seen = this._seen || (this._seen = new Set()); seen.clear();
    this._gen++;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      const t = G.tiles.tileAt(x + dx * r, z + dz * r); if (!t || seen.has(t)) continue; seen.add(t);
      if (!t.brkGrid) this.index(t);
      if (!t.brkGrid) continue;
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const l = t.brkGrid.get(cx * 65536 + cz); if (!l) continue;
        for (const e of l) {
          if (e.broken || e._g === this._gen) continue;
          e._g = this._gen;
          if (e.kind !== 22 && Math.abs(e.y - y) > 3) continue;
          out.push(e.c);
        }
      }
    }
  }
  // people on foot: unbroken hedges, fences and garden walls still block the way (posts never did)
  pushOut(x, z, r, y) {
    const c = this._walk || (this._walk = []); c.length = 0;
    this.gather(x, z, y, r + 1, c);
    for (const k of c) {
      if (k.k !== 'wall') continue;
      const e = k.b; if (e.kind === 4) continue;
      if (y > e.y + e.h - 0.3) continue;
      const ex = e.bx - e.ax, ez = e.bz - e.az, L2 = ex * ex + ez * ez || 1;
      let t = ((x - e.ax) * ex + (z - e.az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = e.ax + ex * t, pz = e.az + ez * t, d = Math.hypot(x - px, z - pz), R = r + e.T;
      if (d < R && d > 1e-4) { x = px + (x - px) / d * R; z = pz + (z - pz) / d * R; }
    }
    return [x, z];
  }
  // ------------------------------------------------------------------ hits
  // the car (v) hit e at (x, z) with closing speed `closing` along the contact normal (nx, nz): break it
  // and return the speed the car loses
  smash(e, v, x, z, nx, nz, closing) {
    e.broken = true;
    const S = e.S, sp = Math.hypot(v.ph?.vx || 0, v.ph?.vz || 0) || closing;
    let dx = (v.ph?.vx || -nx) / sp, dz = (v.ph?.vz || -nz) / sp;
    if (!isFinite(dx)) { dx = -nx; dz = -nz; }
    const loss = carLoss(e, v, closing, this.G.time || 0);
    const after = Math.max(0, closing - loss);
    const y0 = (this.G.tiles.ground(x, z, v.y) ?? v.y);
    if (e.kind === 20) this.lamp(e, dx, dz, closing);
    else if (e.kind === 21) this.tree(e, dx, dz, closing);
    else if (e.kind === 22) this.bush(e, dx, dz, closing);
    else this.prop(e, dx, dz, closing, after, x, z);
    this.sound(S.snd, x, z, Math.min(1, closing / 12));
    // what flies off the car itself
    if (S.dmg > 0.5 && closing > 6) this.carBits(v, x, y0 + 0.5, z, closing * 0.6, nx, nz);
    return loss;
  }
  // a hard hit on something that doesn't give: mature trees shed leaves
  bump(e, closing) {
    const now = performance.now();
    if (e.kind !== 23 || closing < 4 || now - (e._bt || 0) < 900) return;
    e._bt = now;
    this.debris.burst('leaf', Math.min(60, Math.round(closing * 4)), e.x, e.y + e.h * 0.7, e.z, 0, 0, 0, 2.2);
    this.debris.burst('twig', Math.round(closing / 3), e.x, e.y + e.h * 0.6, e.z, 0, 0, 0, 1.5);
    this.sound('leaves', e.x, e.z, 0.7);
  }
  // ------------------------------------------------------------------ gunfire (combat.js)
  // the first unbroken thing along a shot from o in direction d (unit) within `range`: { t, e } or null. Posts are
  // upright cylinders, fences, hedges and walls thick vertical strips
  rayHit(o, d, range) {
    const c = this._ray || (this._ray = []); let best = null;
    for (let s0 = 0; s0 < range; s0 += 12) {
      c.length = 0; const m = Math.min(range, s0 + 6);
      this.gather(o.x + d.x * m, o.z + d.z * m, o.y + d.y * m, 8, c);
      for (const k of c) {
        const e = k.b; if (e.broken) continue;
        let t = null;
        if (k.k === 'post') {
          const ox = o.x - e.x, oz = o.z - e.z, a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - (e.r + 0.03) ** 2, disc = b * b - a * cc;
          if (a < 1e-9 || disc < 0) continue; t = (-b - Math.sqrt(disc)) / a;
        } else {
          const ex = e.bx - e.ax, ez = e.bz - e.az, L = Math.hypot(ex, ez) || 1, nx = -ez / L, nz = ex / L;
          const dn = d.x * nx + d.z * nz; if (Math.abs(dn) < 1e-6) continue;
          const off = (o.x - e.ax) * nx + (o.z - e.az) * nz; t = (-(off - Math.sign(off) * (e.T || 0.1))) / dn;
          const hx = o.x + d.x * t - e.ax, hz = o.z + d.z * t - e.az, f = (hx * ex + hz * ez) / (L * L); if (f < 0 || f > 1) continue;
        }
        if (t == null || t < 0.3 || t > range || (best && t > best.t)) continue;
        const y = o.y + d.y * t, base = e.kind === 22 || e.kind === 10 ? (this.G.tiles.ground(e.x ?? e.ax, e.z ?? e.az) ?? e.y) : e.y;
        if (y < base - 0.1 || y > base + (e.h || 1)) continue;
        best = { t, e };
      }
      if (best && best.t < s0 + 12) break;
    }
    return best;
  }
  // a round hits e at p travelling along d: what it does to it
  shoot(e, p, d) {
    const D = this.debris, dx = d.x, dz = d.z, hard = Math.hypot(dx, dz) || 1;
    switch (e.kind) {
      case 20: {   // lamp post: the lantern up top shatters and goes dark, the column just rings
        if (p.y > e.y + e.h - 1.6 && !(e.t.lamps?.[e.i]?.dead)) {
          if (e.t.lamps?.[e.i]) e.t.lamps[e.i].dead = true; if (this.G.atmos) this.G.atmos.lightsDirty = true; if (this.G.lampGlow) this.G.lampGlow.dirty = true;
          // the post stays up, drawn with the dark lantern instead of the lit one
          const t = e.t;
          if (t.lampMesh) { t.lampMesh.setMatrixAt(e.i, this._zero); t.lampMesh.instanceMatrix.needsUpdate = true; }
          const mesh = e.deadMesh = new THREE.Mesh(this.G.tiles.lampGeo, this.deadLamp); mesh.castShadow = true;
          mesh.position.set(e.x - t.data.ox, e.y, e.z - t.data.oz); mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -e.ang + Math.PI);
          t.group.add(mesh);
          D.burst('glass', 10, p.x, p.y, p.z, dx * 1.5, 0.2, dz * 1.5, 1.4); D.spark(8, p.x, p.y, p.z, dx, 0.5, dz, 2.5);
          this.sound('glass', p.x, p.z, 0.8);
        } else { D.spark(5, p.x, p.y, p.z, -dx * 2, 1, -dz * 2, 3); this.sound('clang', p.x, p.z, 0.5); }
        break;
      }
      case 2: case 3: case 5: {   // bins are knocked flying after a hit or two; the pillar box only rings
        D.spark(4, p.x, p.y, p.z, -dx * 2, 1, -dz * 2, 3); this.sound(e.kind === 5 ? 'iron' : e.kind === 2 ? 'bin' : 'can', p.x, p.z, 0.6);
        e.shots = (e.shots || 0) + 1;
        if (e.kind !== 5 && e.shots >= (e.kind === 3 ? 1 : 2)) { e.broken = true; this.prop(e, dx / hard, dz / hard, 4.5, 1.5, p.x, p.z); }
        break;
      }
      case 4: case 8: case 1: case 21: case 23: {   // wood: splinters and bark; a fence panel gives way after a few
        D.burst('grit', 5, p.x, p.y, p.z, -dx * 2, 1, -dz * 2, 1, [0.36, 0.25, 0.14]);
        if (e.kind === 21 || e.kind === 23) D.burst('leaf', 5, p.x, Math.max(p.y, e.y + e.h * 0.6), p.z, 0, 0, 0, 1.2);
        this.sound('wood', p.x, p.z, 0.45);
        e.shots = (e.shots || 0) + 1;
        if ((e.kind === 8 && e.shots >= 4) || (e.kind === 4 && e.shots >= 6)) { e.broken = true; this.prop(e, dx / hard, dz / hard, 3, 1, p.x, p.z); }
        break;
      }
      case 7: case 10: case 22: {   // hedges and shrubs: leaves and twigs fly
        D.burst('leaf', 9, p.x, p.y, p.z, dx * 1.5, 0.8, dz * 1.5, 1.4); D.burst('twig', 2, p.x, p.y, p.z, dx, 0.5, dz, 1);
        this.sound('leaves', p.x, p.z, 0.5);
        break;
      }
      case 9: {   // a low wall: brick chips
        D.burst('grit', 5, p.x, p.y, p.z, -dx * 2.2, 1, -dz * 2.2, 0.9, [0.5, 0.3, 0.24]); this.sound('brick', p.x, p.z, 0.4);
        break;
      }
    }
  }
  // ------------------------------------------------------------------ each kind
  lamp(e, dx, dz, closing) {
    const t = e.t;
    if (e.deadMesh) { e.deadMesh.removeFromParent(); e.deadMesh = null; }   // (its lantern was shot out earlier)
    if (t.lampMesh) { t.lampMesh.setMatrixAt(e.i, this._zero); t.lampMesh.instanceMatrix.needsUpdate = true; }
    if (t.lamps && t.lamps[e.i]) t.lamps[e.i].dead = true;
    if (this.G.atmos) this.G.atmos.lightsDirty = true; if (this.G.lampGlow) this.G.lampGlow.dirty = true;
    const mesh = new THREE.Mesh(this.G.tiles.lampGeo, this.deadLamp);
    mesh.castShadow = true;
    const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -e.ang + Math.PI);
    mesh.position.set(e.x - t.data.ox, e.y, e.z - t.data.oz); mesh.quaternion.copy(q0);
    t.group.add(mesh);
    this.topple({ t, e, mesh, q0, dx, dz, h: e.h, closing });
    this.debris.spark(14, e.x, e.y + 0.5, e.z, dx * closing * 0.3, 1.5, dz * closing * 0.3, 3);
  }
  tree(e, dx, dz, closing) {
    const t = e.t, T = t.treeMesh; if (!T) return;
    const mc = new THREE.Matrix4(), mt = new THREE.Matrix4();
    T.crowns.getMatrixAt(e.i, mc); T.trunks.getMatrixAt(e.i, mt);
    this.topple({ t, e, inst: [[T.crowns, mc], [T.trunks, mt]], pivot: new THREE.Vector3(e.x - t.data.ox, e.y, e.z - t.data.oz), dx, dz, h: e.h * 0.8, closing });
    this.debris.burst('leaf', 40, e.x, e.y + e.h * 0.6, e.z, dx * closing * 0.2, 0, dz * closing * 0.2, 2);
    this.debris.burst('splinter', 5, e.x, e.y + 0.6, e.z, dx * closing * 0.3, 1.5, dz * closing * 0.3, 2);
  }
  bush(e, dx, dz, closing) {
    this.flattenBush(e.t, e.i, dx, dz);
    this.debris.burst('leaf', 18, e.x, e.y + 0.6 + (this.G.tiles.ground(e.x, e.z) ?? 0), e.z, dx * closing * 0.25, 1, dz * closing * 0.25, 1.6);
    this.debris.burst('twig', 4, e.x, (this.G.tiles.ground(e.x, e.z) ?? 0) + 0.5, e.z, dx * closing * 0.2, 1, dz * closing * 0.2, 1.4);
  }
  flattenBush(t, i, dx, dz) {
    const im = t.bushMesh; if (!im || i == null) return;
    const m0 = new THREE.Matrix4(); im.getMatrixAt(i, m0);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m0.decompose(p, q, s);
    if (s.y < 0.01) return;
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), 0.5);
    this.moving.push({ t, kind: 'squash', im, i, p, q, s, q1: tilt.multiply(q), age: 0, dur: 0.3 });
  }
  // struct-mesh props: lift the piece out of the merged tile mesh, then animate it
  prop(e, dx, dz, closing, after, hx, hz) {
    const t = e.t, sm = t.structMesh; if (!sm) return;
    const ox = t.data.ox, oz = t.data.oz, S = e.S;
    const geo = this.extract(sm.geometry, e.v0, e.vn);
    this.collapse(sm.geometry, e.v0, e.vn);
    if (e.kind === 1) { if (e.wn) this.collapse(sm.geometry, e.w0, e.wn); if (e.sn) this.collapse(sm.geometry, e.s0, e.sn); }
    const bb = geo.boundingBox.clone(), mid = bb.getCenter(new THREE.Vector3());   // (a copy: translate() recomputes the original)
    if (S.fall === 'rubble') {
      geo.dispose();
      const L = Math.hypot(e.bx - e.ax, e.bz - e.az), n = Math.min(16, Math.round(L * 9));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, x = e.ax + (e.bx - e.ax) * f, z = e.az + (e.bz - e.az) * f;
        const y = (this.G.tiles.ground(x, z) ?? e.y) + Math.random() * e.h;
        const push = after * (0.35 + Math.random() * 0.4) + 1;
        this.debris.burst('brick', 1, x, y, z, dx * push, 0.8 + Math.random() * 1.6, dz * push, 1.2);
      }
      this.debris.burst('rubble', 10, hx, e.y + 0.3, hz, dx * after * 0.4, 1, dz * after * 0.4, 1.5);
      for (let k = 0; k < 4; k++) this.G.tyreFx?.puff(hx + dx * k * 0.6, e.y + 0.4, hz + dz * k * 0.6, dx * 2, dz * 2, 0);
      return;
    }
    // pivot: the base for things that topple or flatten, the middle for things that are thrown
    const base = S.fall === 'toss' ? mid.clone() : new THREE.Vector3(mid.x, bb.min.y + 0.2, mid.z);
    geo.translate(-base.x, -base.y, -base.z);
    const mesh = new THREE.Mesh(geo, this.G.tiles.mats.struct);
    mesh.castShadow = true; mesh.position.copy(base);
    t.group.add(mesh);
    const wx = base.x + ox, wz = base.z + oz;
    if (S.fall === 'topple') {
      this.topple({ t, e, mesh, q0: new THREE.Quaternion(), dx, dz, h: e.h, closing });
      if (e.kind === 1) this.debris.burst('splinter', 6, wx, base.y + 0.4, wz, dx * closing * 0.3, 1.2, dz * closing * 0.3, 2);
      if (e.kind === 5) this.debris.burst('chip', 14, wx, base.y + 1.2, wz, dx * closing * 0.25, 2, dz * closing * 0.25, 2, [0.85, 0.85, 0.82]);   // the post
    } else if (S.fall === 'flatten') {
      // hedge: the section folds over away from the car and squashes down; its leafy bushes go with it
      // (a garden shrub just folds the way the car is going)
      const seg = e.ax != null, ux = seg ? e.bx - e.ax : -dz, uz = seg ? e.bz - e.az : dx, L = Math.hypot(ux, uz) || 1, nx = -uz / L, nz = ux / L, side = Math.sign(nx * dx + nz * dz) || 1;
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(nz * side, 0, -nx * side), seg ? 1.15 : 0.9);
      this.moving.push({ t, e, kind: 'fold', mesh, q1: tilt, age: 0, dur: 0.35 });
      if (!seg) { this.debris.burst('leaf', 14, wx, base.y + 0.5, wz, dx * closing * 0.25, 1, dz * closing * 0.25, 1.4); return; }
      if (t.bushPos) for (let j = 0; j < t.bushPos.length; j += 4) {
        const bx = t.bushPos[j], bz = t.bushPos[j + 1], f = Math.max(0, Math.min(1, ((bx - e.ax) * ux + (bz - e.az) * uz) / (L * L)));
        if (Math.hypot(bx - e.ax - ux * f, bz - e.az - uz * f) < e.T + 0.45) this.flattenBush(t, t.bushPos[j + 3], dx, dz);
      }
      const cx = (e.ax + e.bx) / 2, cz = (e.az + e.bz) / 2;
      this.debris.burst('leaf', 34, cx, e.y + e.h * 0.8, cz, dx * closing * 0.3, 1.2, dz * closing * 0.3, 1.8);
      this.debris.burst('twig', 8, cx, e.y + e.h * 0.6, cz, dx * closing * 0.3, 1, dz * closing * 0.3, 1.5);
    } else {
      // thrown: light things fly, heavy or anchored ones mostly slide and tumble
      const up = S.up * (0.6 + Math.random() * 0.5) + closing * 0.08;
      const v = new THREE.Vector3(dx * (after * 0.9 + closing * 0.25), up, dz * (after * 0.9 + closing * 0.25));
      const w = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8).multiplyScalar(0.5 + closing / 12);
      const corners = []; for (const X of [bb.min.x, bb.max.x]) for (const Y of [bb.min.y, bb.max.y]) for (const Z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(X - base.x, Y - base.y, Z - base.z));
      this.moving.push({ t, e, kind: 'toss', mesh, v, w, corners, age: 0, rest: 0 });
      if (e.kind === 2 || e.kind === 3) this.debris.burst('plastic', 8, wx, base.y + 0.5, wz, v.x * 0.8, v.y, v.z * 0.8, 2, [[0.5, 0.45, 0.35], [0.2, 0.25, 0.45], [0.7, 0.7, 0.68]][Math.floor(Math.random() * 3)]);
      if (e.kind === 4 || e.kind === 8) this.debris.burst('splinter', e.kind === 8 ? 7 : 3, wx, base.y + 0.4, wz, v.x * 0.7, 1.2, v.z * 0.7, 2);
    }
  }
  topple(o) {
    o.kind = 'topple'; o.th = 0; o.age = 0;
    o.w = 0.5 + o.closing * 0.06 * Math.min(1.5, 8 / o.h);
    o.slide = new THREE.Vector3(o.dx, 0, o.dz).multiplyScalar(Math.min(4, o.closing * 0.25));
    o.axis = new THREE.Vector3(o.dz, 0, -o.dx).normalize();
    if (o.mesh) o.pivot = o.mesh.position.clone();
    o.base = o.pivot.clone();
    this.moving.push(o);
  }
  // copy a vertex range of the struct mesh into its own geometry
  extract(g, v0, n) {
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'surf']) {
      const a = g.attributes[name]; if (!a) continue;
      out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(v0 * a.itemSize, (v0 + n) * a.itemSize), a.itemSize));
    }
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }
  // and remove it from the struct mesh (all its vertices onto one point: zero-area triangles)
  collapse(g, v0, n) {
    const a = g.attributes.position, A = a.array, x = A[v0 * 3], y = A[v0 * 3 + 1], z = A[v0 * 3 + 2];
    for (let i = v0; i < v0 + n; i++) { A[i * 3] = x; A[i * 3 + 1] = y; A[i * 3 + 2] = z; }
    a.addUpdateRange(v0 * 3, n * 3); a.needsUpdate = true;
  }
  // ------------------------------------------------------------------ crashes between cars and into walls
  // called by carPhysics for impacts it resolves (speed: closing speed, m/s; nx, nz: the contact normal)
  crash(v, x, z, speed, nx, nz, other) {
    const now = performance.now();
    if (now - (v._fxT || 0) < 120 && speed < (v._fxS || 0) + 3) return;
    v._fxT = now; v._fxS = speed;
    const y = (v.y || 0) + 0.55;
    if (speed > 3.5) this.debris.spark(Math.min(40, Math.round(speed * 2.2)), x, y, z, nx * 2, 1.5, nz * 2, 2.5 + speed * 0.15);
    this.carBits(v, x, y, z, speed, nx, nz);
    if (other) this.carBits(other, x, y, z, speed * 0.8, -nx, -nz);
    for (const c of other ? [v, other] : [v]) this.shed(c);
  }
  // a badly smashed end loses its number plate and a length of bumper trim (once per end)
  shed(v) {
    const d = v.dmg; if (!d) return;
    const c = Math.cos(v.heading), s = Math.sin(v.heading), L = v.def.L / 2, vx = (v.ph?.vx || 0) * 0.6, vz = (v.ph?.vz || 0) * 0.6, y = (v.y || 0) + 0.45;
    if (d[0] > 0.5 && !v._shedF) {
      v._shedF = 1;
      this.debris.burst('plate', 1, v.x + c * L, y, v.z + s * L, vx + c * 1.5, 2, vz + s * 1.5, 1.2, [0.86, 0.86, 0.83]);
      this.debris.burst('trim', 1, v.x + c * L, y - 0.1, v.z + s * L, vx + c * 1.2, 1.4, vz + s * 1.2, 1);
    }
    if (d[1] > 0.5 && !v._shedR) {
      v._shedR = 1;
      this.debris.burst('plate', 1, v.x - c * L, y + 0.15, v.z - s * L, vx - c * 1.5, 2, vz - s * 1.5, 1.2, [0.85, 0.66, 0.04]);
      this.debris.burst('trim', 1, v.x - c * L, y - 0.1, v.z - s * L, vx - c * 1.2, 1.4, vz - s * 1.2, 1);
    }
  }
  carBits(v, x, y, z, speed, nx, nz) {
    if (speed < 4) return;
    const vx = (v.ph?.vx || 0) * 0.45, vz = (v.ph?.vz || 0) * 0.45;
    const paint = new THREE.Color(v.paint ?? 0x777777);
    this.debris.burst('chip', Math.min(14, Math.round(speed * 0.8)), x, y, z, vx + nx * 2, 1.2, vz + nz * 2, 2.2, [paint.r, paint.g, paint.b]);
    this.debris.burst('plastic', Math.min(10, Math.round(speed * 0.5)), x, y - 0.2, z, vx + nx * 2, 1, vz + nz * 2, 2);
    if (speed > 7) {
      this.debris.burst('glass', Math.min(60, Math.round((speed - 6) * 5)), x, y + 0.3, z, vx + nx * 1.5, 1.8, vz + nz * 1.5, 2.6);
      if (speed > 9) this.sound('glass', x, z, Math.min(1, speed / 20));
    }
  }
  // scraping along a wall or another car: a trail of sparks from the contact
  scrape(x, y, z, vx, vz, speed) {
    if (speed < 4 || Math.random() > 0.6) return;
    this.debris.spark(1 + Math.floor(speed / 8), x, y + 0.35, z, vx * 0.6, 0.8, vz * 0.6, 1.6);
  }
  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const G = this.G;
    for (let k = this.moving.length - 1; k >= 0; k--) {
      const o = this.moving[k];
      o.age += dt;
      if (o.kind === 'topple') { if (this.stepTopple(o, dt)) this.moving.splice(k, 1); }
      else if (o.kind === 'toss') { if (this.stepToss(o, dt)) this.moving.splice(k, 1); }
      else if (o.kind === 'fold') {
        const f = Math.min(1, o.age / o.dur), e = 1 - (1 - f) * (1 - f);
        o.mesh.quaternion.slerpQuaternions(this._q2.identity(), o.q1, e);
        o.mesh.scale.set(1, 1 - e * 0.55, 1);
        if (f >= 1) this.moving.splice(k, 1);
      } else if (o.kind === 'squash') {
        const f = Math.min(1, o.age / o.dur), e = 1 - (1 - f) * (1 - f);
        this._q.slerpQuaternions(o.q, o.q1, e);
        this._s.set(o.s.x * (1 + e * 0.3), o.s.y * (1 - e * 0.68), o.s.z * (1 + e * 0.3));
        this._v.copy(o.p); this._v.y -= o.s.y * 0.6 * e;
        o.im.setMatrixAt(o.i, this._m.compose(this._v, this._q, this._s)); o.im.instanceMatrix.needsUpdate = true;
        if (f >= 1) this.moving.splice(k, 1);
      }
    }
    this.debris.update(dt);
    // smashed-in fronts steam and smoke
    this.smokeT += dt;
    if (this.smokeT > 0.09) {
      this.smokeT = 0;
      const cam = G.camera.position;
      for (const v of G.traffic.list) {
        const d = v.dmg; if (!d || d[0] < 0.45 || v.hidden) continue;
        if ((v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 80 * 80) continue;
        if (Math.random() > (d[0] - 0.35) * 1.6) continue;
        const L = v.def.L / 2 - 0.5, c = Math.cos(v.heading), s = Math.sin(v.heading);
        G.tyreFx?.puff(v.x + c * L, (v.y || 0) + 1.0, v.z + s * L, (v.ph?.vx || 0) * 0.5, (v.ph?.vz || 0) * 0.5, 0);
      }
    }
  }
  stepTopple(o, dt) {
    const g = 9.81, H = o.h;
    o.w += 1.5 * g / H * Math.sin(Math.max(0.03, o.th)) * dt;
    o.th += o.w * dt;
    // the snapped foot is dragged along by the car and skids to a stop
    o.pivot.addScaledVector(o.slide, dt); o.slide.multiplyScalar(Math.exp(-3.2 * dt));
    const lie = Math.PI / 2 - 0.04;
    let done = false;
    if (o.th >= lie) {
      o.th = lie;
      if (o.w > 0.8) {
        if (!o.landed) {
          o.landed = true;
          const tx = o.pivot.x + o.dx * H + o.t.data.ox, tz = o.pivot.z + o.dz * H + o.t.data.oz, ty = o.pivot.y + 0.2;
          this.sound(o.e.S.snd === 'tree' ? 'treefall' : o.e.S.snd === 'lamp' ? 'clang' : 'thud', tx, tz, 1);
          if (o.e.kind === 20) { this.debris.burst('glass', 30, tx, ty + 0.3, tz, o.dx * 2, 2, o.dz * 2, 2.4); this.debris.spark(12, tx, ty, tz, 0, 2, 0, 3); this.sound('glass', tx, tz, 0.8); }
          if (o.e.kind === 21) this.debris.burst('leaf', 40, tx - o.dx * H * 0.3, ty + 1, tz - o.dz * H * 0.3, 0, 1.5, 0, 2.5);
          for (let k = 0; k < 3; k++) this.G.tyreFx?.puff(tx - o.dx * H * k * 0.3, ty, tz - o.dz * H * k * 0.3, 0, 0, 0);
        }
        o.w = -o.w * 0.22;
      } else { o.w = 0; done = o.slide.lengthSq() < 0.01; }
    }
    this._q.setFromAxisAngle(o.axis, o.th);
    if (o.mesh) { o.mesh.quaternion.multiplyQuaternions(this._q, o.q0); o.mesh.position.copy(o.pivot); }
    if (o.inst) {
      // instanced trees: rotate each instance's matrix about the foot of the trunk
      // M = T(pivot) R T(-foot) M0
      const R = this._m2.makeRotationFromQuaternion(this._q), Tp = this._mt.makeTranslation(o.pivot.x, o.pivot.y, o.pivot.z);
      for (const [im, m0] of o.inst) {
        this._m.makeTranslation(-o.base.x, -o.base.y, -o.base.z).premultiply(R).premultiply(Tp).multiply(m0);
        im.setMatrixAt(o.e.i, this._m); im.instanceMatrix.needsUpdate = true;
      }
    }
    return done;
  }
  stepToss(o, dt) {
    const m = o.mesh, G = this.G, ox = o.t.data.ox, oz = o.t.data.oz;
    o.v.y -= 9.81 * dt;
    m.position.addScaledVector(o.v, dt);
    this._q.setFromAxisAngle(this._a.copy(o.w).normalize(), o.w.length() * dt);
    if (o.w.lengthSq() > 1e-6) m.quaternion.premultiply(this._q);
    // lowest corner against the ground
    let low = Infinity, lx = 0, lz = 0;
    for (const c of o.corners) { this._v.copy(c).applyQuaternion(m.quaternion); if (this._v.y < low) { low = this._v.y; lx = this._v.x; lz = this._v.z; } }
    const gy = G.tiles.ground(m.position.x + ox, m.position.z + oz, m.position.y) ?? m.position.y + low;
    const pen = gy - (m.position.y + low);
    if (pen > 0) {
      m.position.y += pen;
      if (o.v.y < -1.5) {
        if (!o.thud && o.v.y < -3) { o.thud = true; this.sound(o.e.S.snd === 'bin' ? 'bin' : 'thud', m.position.x + ox, m.position.z + oz, Math.min(1, -o.v.y / 6)); }
        o.v.y *= -0.28; o.v.x *= 0.7; o.v.z *= 0.7;
        // the corner that hit the ground spins the piece over
        o.w.x += lz * o.v.y * 1.5; o.w.z -= lx * o.v.y * 1.5; o.w.multiplyScalar(0.75);
      } else {
        o.v.y = 0; const f = Math.exp(-5 * dt); o.v.x *= f; o.v.z *= f; o.w.multiplyScalar(Math.exp(-6 * dt));
        // settle onto its nearest flat side
        const up = this._v2.set(0, 1, 0).applyQuaternion(this._q2.copy(m.quaternion).invert());
        const ax = Math.abs(up.x) > Math.abs(up.y) ? (Math.abs(up.x) > Math.abs(up.z) ? 0 : 2) : (Math.abs(up.y) > Math.abs(up.z) ? 1 : 2);
        const target = this._s.set(0, 0, 0); target.setComponent(ax, Math.sign(up.getComponent(ax)) || 1);
        this._q.setFromUnitVectors(up.normalize(), target);
        this._q2.copy(m.quaternion).multiply(this._q);
        m.quaternion.slerp(this._q2, Math.min(1, dt * 4));
        if (o.v.lengthSq() < 0.02 && o.w.lengthSq() < 0.05) o.rest += dt;
      }
    }
    return o.rest > 0.6 || o.age > 20;
  }
  // ------------------------------------------------------------------ sound: synthesised one-shots
  // a recorded impact (www/sfx/world.ogg, tools/audio/build_sfx.py): struck steel for lamp posts, a pillar box's
  // cast iron, timber cracking for poles, benches, fences and trees, foliage, plastic bins, rubble and glass
  sound(kind, x, z, k = 1) {
    const A = this.G.audio; if (!A || !A.on || !A.shot) return;
    const name = { lamp: 'lamp', clang: 'clang', iron: 'iron', can: 'can', pole: 'pole', wood: 'wood', tree: 'tree', treefall: 'treefall', leaves: 'leaves', bin: 'bin', brick: 'brick', thud: 'thud', glass: 'glass' }[kind] || 'thud';
    A.shot(name, x, z, 0.35 + 0.65 * Math.max(0, Math.min(1, k)));
  }
}
