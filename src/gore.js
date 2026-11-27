// What a gunshot (or a blade) does to a person, and what it leaves behind.
//  - blood thrown from the wound: a fine mist that hangs for a moment, droplets flung out of the exit side in a
//    cone (and a few back towards the gun from the entry), flying, falling and leaving spots where they land
//  - spatter: a splash up the wall behind them (with drips running down it) or across the ground, shaped by where
//    it flew
//  - the wound itself, on their clothes or skin, soaking outwards (humans.js draws it from ped.wounds)
//  - a pool spreading out from under a body for half a minute; a smaller one under someone lying hurt
//  - drips behind someone getting away hurt
// All pooled (ring buffers in two instanced draws), so a firefight never adds draw calls or garbage.
import * as THREE from 'three/webgpu';
import { attribute, uv, vec2, vec3, float, smoothstep, length, mix, sin, cos, abs, atan, step, max, fract, select } from 'three/tsl';

const DROPS = 520, DECALS = 460;
const Z0 = new THREE.Matrix4().makeScale(0, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
// decal kinds (the shader draws each shape)
const SPOT = 0, SPLASH = 1, WALL = 2, POOL = 3;

export class Gore {
  constructor(G) {
    this.G = G; const scene = G.scene;
    // ---- droplets: dark red beads stretched along their flight
    const dm = new THREE.MeshStandardNodeMaterial({ roughness: 0.22, metalness: 0 });
    dm.colorNode = vec3(0.11, 0.004, 0.003);
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), dm, DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.drops.frustumCulled = false; this.drops.castShadow = false;
    for (let i = 0; i < DROPS; i++) this.drops.setMatrixAt(i, Z0);
    scene.add(this.drops);
    this.dP = new Float32Array(DROPS * 3); this.dV = new Float32Array(DROPS * 3); this.dS = new Float32Array(DROPS); this.dA = new Float32Array(DROPS).fill(-1);
    this.dG = new Float32Array(DROPS);            // the ground's height where it'll come down
    this.dW = new Float32Array(DROPS * 4);        // the wall it might hit: a point's along-normal distance, and the normal (x, z) + flag
    this.dWp = new Float32Array(DROPS * 3);
    this.di = 0; this.live = 0;
    // ---- decals: spots, splashes, wall spatter with drips, pools
    const g = new THREE.PlaneGeometry(1, 1);
    this.gd = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 4), 4); this.gd.setUsage(THREE.DynamicDrawUsage); g.setAttribute('gd', this.gd);
    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10, metalness: 0 });
    const a = attribute('gd', 'vec4'), seed = a.x, kind = a.y, alpha = a.z, flip = a.w;
    const u = uv().sub(0.5).mul(2).mul(vec2(flip, 1));
    const hash = k => fract(sin(seed.mul(127.1).add(k * 311.7)).mul(43758.5453));
    const disc = (cx, cy, r, soft = 0.12) => float(1).sub(smoothstep(r.mul(1 - soft), r, length(u.sub(vec2(cx, cy)))));
    const ang = atan(u.y, u.x), r = length(u);
    const lobes = sin(ang.mul(3).add(seed.mul(17))).mul(0.07).add(sin(ang.mul(7).add(seed.mul(29))).mul(0.045)).add(sin(ang.mul(13).add(seed.mul(41))).mul(0.025));
    // a spot: a round drop with a ragged crown and a few specks thrown round it
    let spot = float(1).sub(smoothstep(float(0.5).add(lobes.mul(0.6)).sub(0.05), float(0.5).add(lobes.mul(0.6)), r));
    for (let k = 0; k < 4; k++) { const an = hash(k).mul(6.283), rr = hash(k + 7).mul(0.25).add(0.66); spot = max(spot, disc(cos(an).mul(rr), sin(an).mul(rr), hash(k + 13).mul(0.07).add(0.04))); }
    // a splash (the quad stretched along +x, the way it flew): the main body at the near end, a tail of droplets
    // and streaks thrown on along the line
    const bx = float(-0.42), body = float(1).sub(smoothstep(float(0.46).add(lobes.mul(0.7)).sub(0.06), float(0.46).add(lobes.mul(0.7)), length(u.sub(vec2(bx, 0)).mul(vec2(1.0, 1.15)))));
    let tail = float(0);
    for (let k = 0; k < 9; k++) {
      const f = k / 9, cx = bx.add(0.32 + f * 1.15).add(hash(k).mul(0.08)), cy = hash(k + 20).sub(0.5).mul(0.15 + f * 0.75);
      tail = max(tail, disc(cx, cy, hash(k + 40).mul(0.045).add(0.075 * (1 - f) + 0.02)));
    }
    // streaks: thin spikes out of the body along the line
    const sy = u.y.sub(hash(50).sub(0.5).mul(0.3)), streak = float(1).sub(smoothstep(0.012, 0.035, abs(sy).sub(u.x.sub(bx).mul(0.04)))).mul(step(bx, u.x)).mul(float(1).sub(smoothstep(0.15, 0.72, u.x)));
    const splash = max(max(body, tail), streak.mul(0.9));
    // up a wall: the splash, with drips running down from it
    let drips = float(0);
    for (let k = 0; k < 4; k++) {
      const dx = bx.add(hash(k + 60).mul(0.9).sub(0.25)), len = hash(k + 70).mul(0.55).add(0.2), top = float(-0.05), bot = top.sub(len);
      const inX = float(1).sub(smoothstep(0.018, 0.034, abs(u.x.sub(dx)))), inY = step(bot, u.y).mul(step(u.y, top.add(0.1)));
      drips = max(drips, inX.mul(inY));
      drips = max(drips, disc(dx, bot, hash(k + 80).mul(0.02).add(0.035)));          // the bead at the end of a run
    }
    const wall = max(splash, drips);
    // a pool: wide and irregular, darker where it's deep
    const poolEdge = float(0.82).add(lobes.mul(1.4));
    const pool = float(1).sub(smoothstep(poolEdge.sub(0.07), poolEdge, r));
    const shape = select(kind.lessThan(0.5), spot, select(kind.lessThan(1.5), splash, select(kind.lessThan(2.5), wall, pool)));
    const deep = select(kind.greaterThan(2.5), float(1).sub(smoothstep(0.0, 0.8, r)), float(0.4));
    // fresh blood is a deep, wet red; thinner at the edges, darker where it pools
    mat.colorNode = mix(vec3(0.075, 0.0025, 0.002), vec3(0.12, 0.004, 0.003), shape.mul(0.6)).mul(float(1).sub(deep.mul(0.55)));
    mat.roughnessNode = mix(float(0.45), float(0.24), deep.add(step(2.5, kind).mul(0.4)).min(1));
    mat.opacityNode = shape.mul(alpha).mul(0.94);
    this.decals = new THREE.InstancedMesh(g, mat, DECALS);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.decals.frustumCulled = false; this.decals.renderOrder = 2; this.decals.receiveShadow = true;
    for (let i = 0; i < DECALS; i++) this.decals.setMatrixAt(i, Z0);
    scene.add(this.decals);
    this.gi = 0; this.growing = []; this.wounded = new Set();
  }
  // ---------------------------------------------------------------- a round through someone
  // p where it hit them, d the line of the shot (unit), o: { zone, lethal, big (shotgun/rifle), ped }
  hit(ped, p, d, o = {}) {
    const G = this.G, head = o.zone === 'head', big = o.big ? 1.6 : 1, limb = o.zone === 'arm' || o.zone === 'leg';
    const gy = G.tiles.ground(p.x, p.z, p.y + 0.5) ?? ped.y ?? p.y - 1;
    // the wall close behind them, if there is one (out of the exit side)
    const wall = this.findWall(p, d, 4.2);
    // the exit: a cone of droplets on along the line, a mist behind
    const n = Math.round((head ? 30 : limb ? 12 : 20) * big);
    for (let k = 0; k < n; k++) {
      const spread = head ? 0.5 : 0.36;
      _d.set(d.x + rnd(-spread, spread), d.y + rnd(-0.15, spread * 0.8), d.z + rnd(-spread, spread)).normalize();
      const sp = rnd(2.2, head ? 8.5 : 6.5) * (o.big ? 1.25 : 1);
      this.drop(p.x + d.x * 0.12, p.y + d.y * 0.12, p.z + d.z * 0.12, _d.x * sp, _d.y * sp + rnd(0.2, 1.2), _d.z * sp, rnd(0.008, head ? 0.03 : 0.024), gy, wall);
    }
    // the entry: a little blown back towards the gun
    for (let k = 0; k < (head ? 6 : 4); k++) {
      _d.set(-d.x + rnd(-0.5, 0.5), rnd(0, 0.6), -d.z + rnd(-0.5, 0.5)).normalize();
      const sp = rnd(0.8, 2.4); this.drop(p.x - d.x * 0.1, p.y, p.z - d.z * 0.1, _d.x * sp, _d.y * sp, _d.z * sp, rnd(0.006, 0.014), gy, null);
    }
    const fx = G.combat?.fx;
    if (fx) {
      _p.set(p.x + d.x * 0.2, p.y + 0.02, p.z + d.z * 0.2);
      fx.puff(_p, _d.copy(d).multiplyScalar(head ? 2.4 : 1.7), [0.2, 0.009, 0.007], head ? 0.85 : 0.7, 0.08, (head ? 0.95 : 0.6) * (o.big ? 1.3 : 1), head ? 0.9 : 0.65);
      fx.puff(_p.set(p.x - d.x * 0.05, p.y, p.z - d.z * 0.05), _d.copy(d).multiplyScalar(-0.5), [0.17, 0.008, 0.006], 0.5, 0.04, 0.22, 0.4);
    }
    // spatter: up the wall behind, or across the ground
    if (wall) {
      const hy = p.y + d.y * wall.t, tx = d.x - wall.nx * (d.x * wall.nx + d.z * wall.nz), tz = d.z - wall.nz * (d.x * wall.nx + d.z * wall.nz);
      const size = rnd(0.5, 0.8) * (head ? 1.35 : limb ? 0.65 : 1) * (o.big ? 1.25 : 1);
      this.decal(WALL, wall.x, Math.max(gy + 0.15, hy), wall.z, wall.nx, 0, wall.nz, tx, tz, size * 1.7, size, 0.95);
    } else {
      const t = rnd(1.1, 2.2) * (head ? 1.2 : 1), sx = p.x + d.x * t, sz = p.z + d.z * t, sy = G.tiles.ground(sx, sz, gy + 1) ?? gy;
      if (Math.abs(sy - gy) < 0.6 && !G.tiles.insideBuilding?.(sx, sz, sy + 0.3)) {
        const size = rnd(0.45, 0.75) * (head ? 1.3 : limb ? 0.6 : 1) * (o.big ? 1.2 : 1);
        this.decal(SPLASH, sx - d.x * size * 0.4, sy, sz - d.z * size * 0.4, 0, 1, 0, d.x, d.z, size * 2, size * 0.85, 0.92);
      }
    }
    this.wound(ped, p, d, o);
  }
  // a blade: a short arc of blood off the cut and a wound
  slash(ped, p, d) {
    const gy = this.G.tiles.ground(p.x, p.z, p.y + 0.5) ?? ped.y;
    for (let k = 0; k < 10; k++) { _d.set(d.x + rnd(-0.6, 0.6), rnd(0.1, 0.7), d.z + rnd(-0.6, 0.6)).normalize(); const sp = rnd(1.2, 3.5); this.drop(p.x, p.y, p.z, _d.x * sp, _d.y * sp, _d.z * sp, rnd(0.008, 0.02), gy, null); }
    this.wound(ped, p, d, { zone: 'torso' });
  }
  // the wall the spray from p along d meets within `range` m (buildings only): where, its normal, how far
  findWall(p, d, range) {
    const G = this.G, hx = Math.hypot(d.x, d.z) || 1;
    for (let t = 0.35; t < range; t += 0.3) {
      const x = p.x + d.x / hx * t, z = p.z + d.z / hx * t, y = p.y + d.y * t;
      if (G.tiles.insideBuilding(x, z, y)) {
        // back to the face, then its normal from the footprint (combat.js knows how)
        let lo = t - 0.3, hi = t;
        for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (G.tiles.insideBuilding(p.x + d.x / hx * m, p.z + d.z / hx * m, p.y + d.y * m)) hi = m; else lo = m; }
        const wx = p.x + d.x / hx * lo, wz = p.z + d.z / hx * lo;
        const n = G.combat?.wallNormal?.(_p.set(wx, p.y, wz), d, null) || _d.set(-d.x, 0, -d.z).normalize();
        return { x: wx + n.x * 0.01, z: wz + n.z * 0.01, nx: n.x, nz: n.z, t: lo };
      }
    }
    return null;
  }
  // ---------------------------------------------------------------- the wound on the body
  // where on them it went in: the angle round the body from the front (towards their left is +), the height on a
  // standing body, and how far it soaks (humans.js: two wounds a person)
  wound(ped, p, d, o) {
    const L = ped.look || {}, hgt = L.h || 1, hf = (ped.heading || 0) + (ped.pose === 'flee' ? Math.PI : 0);
    let ang, y;
    if (o.lying ?? (ped.dead || ped.fall > 0.5)) {
      // a body on the ground: the chest, the side facing up
      ang = (Math.random() - 0.5) * 0.8; y = 1.1 + Math.random() * 0.2;
    } else {
      const dx = p.x - ped.x, dz = p.z - ped.z;
      const lz = dx * Math.cos(hf) + dz * Math.sin(hf), lx = dx * Math.sin(hf) - dz * Math.cos(hf);
      ang = Math.atan2(lx, lz); y = Math.max(0.15, Math.min(1.68, (p.y - (ped.y || 0)) / hgt));
    }
    const head = o.zone === 'head', limb = o.zone === 'arm' || o.zone === 'leg';
    const r1 = (head ? 0.11 : limb ? 0.13 : 0.24) * (o.lethal || ped.dead ? 1.25 : 1) * (o.big ? 1.25 : 1);
    const W = ped.wounds ||= [];
    // close to one they've got: that one spreads; otherwise a second (or the smaller of two moves here)
    const near = W.find(w => Math.abs(w.y - y) < 0.18 && Math.abs(Math.atan2(Math.sin(w.a - ang), Math.cos(w.a - ang))) < 0.8);
    if (near) { near.r1 = Math.min(0.36, near.r1 + r1 * 0.5); near.k = 1; }
    else if (W.length < 2) W.push({ a: ang, y, r: r1 * 0.3, r1, k: 0.85 });
    else { const w = W[0].r1 < W[1].r1 ? W[0] : W[1]; Object.assign(w, { a: ang, y, r: r1 * 0.3, r1, k: 0.85 }); }
    this.wounded.add(ped);
  }
  // ---------------------------------------------------------------- pools and drips
  // a pool spreading from under someone (x, y, z ground), size across, over `secs`
  pool(x, y, z, size, secs = 25) {
    const i = this.decal(POOL, x, y, z, 0, 1, 0, Math.random() - 0.5, Math.random() - 0.5, size, size, 0.95, 0.04);
    this.growing.push({ i, size, t: 0, secs });
  }
  drip(x, y, z) { this.decal(SPOT, x + rnd(-0.12, 0.12), y, z + rnd(-0.12, 0.12), 0, 1, 0, Math.random() - 0.5, Math.random() - 0.5, rnd(0.04, 0.09), rnd(0.04, 0.09), 0.9); }
  // ---------------------------------------------------------------- pools of instances
  drop(x, y, z, vx, vy, vz, size, gy, wall) {
    const i = this.di; this.di = (i + 1) % DROPS;
    this.dP[i * 3] = x; this.dP[i * 3 + 1] = y; this.dP[i * 3 + 2] = z; this.dV[i * 3] = vx; this.dV[i * 3 + 1] = vy; this.dV[i * 3 + 2] = vz;
    this.dS[i] = size; this.dA[i] = 0; this.dG[i] = gy; this.live++;
    if (wall) { this.dW[i * 4] = 1; this.dW[i * 4 + 1] = wall.nx; this.dW[i * 4 + 2] = wall.nz; this.dWp[i * 3] = wall.x; this.dWp[i * 3 + 1] = 0; this.dWp[i * 3 + 2] = wall.z; }
    else this.dW[i * 4] = 0;
  }
  // a decal at (x, y, z) facing (nx, ny, nz), its long axis along (tx, tz) on the surface; sx by sy metres
  decal(kind, x, y, z, nx, ny, nz, tx, tz, sx, sy, alpha, grow = 1) {
    const i = this.gi; this.gi = (i + 1) % DECALS;
    _z.set(nx, ny, nz).normalize();
    if (Math.abs(ny) > 0.7) {
      // on the ground: +x along the line it flew
      _x.set(tx, 0, tz); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize();
      _y.crossVectors(_z, _x);
    } else {
      // on a wall: +y up (drips run down), +x along the wall the way it flew
      _y.copy(UP); _x.crossVectors(_y, _z).normalize();
      const flip = _x.x * tx + _x.z * tz < 0 ? -1 : 1;
      this.gd.setW(i, flip);
    }
    if (Math.abs(ny) > 0.7) this.gd.setW(i, 1);
    _m.makeBasis(_x.multiplyScalar(sx * grow), _y.multiplyScalar(sy * grow), _z);
    _m.setPosition(x + nx * 0.006, y + (Math.abs(ny) > 0.7 ? 0.006 + (this.gi % 7) * 0.0004 : 0), z + nz * 0.006);
    this.decals.setMatrixAt(i, _m); this.decals.instanceMatrix.needsUpdate = true;
    this.gd.setXYZ(i, Math.random(), kind, alpha); this.gd.needsUpdate = true;
    return i;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G;
    // droplets: fly, fall, and leave a spot where they land (on the ground or the wall behind)
    if (this.live > 0) {
      let live = 0;
      for (let i = 0; i < DROPS; i++) {
        if (this.dA[i] < 0) continue;
        this.dA[i] += dt; live++;
        const j = i * 3, k = Math.exp(-0.6 * dt);
        this.dV[j] *= k; this.dV[j + 2] *= k; this.dV[j + 1] -= 9.8 * dt;
        const ox = this.dP[j], oz = this.dP[j + 2];
        this.dP[j] += this.dV[j] * dt; this.dP[j + 1] += this.dV[j + 1] * dt; this.dP[j + 2] += this.dV[j + 2] * dt;
        let landed = false;
        if (this.dW[i * 4]) {
          // through the wall's plane: a spot on it
          const nx = this.dW[i * 4 + 1], nz = this.dW[i * 4 + 2], wx = this.dWp[j], wz = this.dWp[j + 2];
          const before = (ox - wx) * nx + (oz - wz) * nz, after = (this.dP[j] - wx) * nx + (this.dP[j + 2] - wz) * nz;
          if (before > 0 && after <= 0) {
            const s = this.dS[i] * rnd(2.5, 4.5);
            this.decal(Math.random() < 0.5 ? SPOT : WALL, this.dP[j] + nx * (0.002 - after), this.dP[j + 1], this.dP[j + 2] + nz * (0.002 - after), nx, 0, nz, this.dV[j], this.dV[j + 2], s * 1.3, s, 0.9);
            landed = true;
          }
        }
        if (!landed && this.dP[j + 1] <= this.dG[i]) {
          if (Math.random() < 0.7) { const s = this.dS[i] * rnd(2.8, 5.5); this.decal(Math.random() < 0.65 ? SPOT : SPLASH, this.dP[j], this.dG[i], this.dP[j + 2], 0, 1, 0, this.dV[j], this.dV[j + 2], s * 1.4, s, 0.9); }
          landed = true;
        }
        if (landed || this.dA[i] > 2.5) { this.dA[i] = -1; this.drops.setMatrixAt(i, Z0); continue; }
        // stretched along the way it's going
        _d.set(this.dV[j], this.dV[j + 1], this.dV[j + 2]); const sp = _d.length();
        _q.setFromUnitVectors(UP, sp > 1e-4 ? _d.multiplyScalar(1 / sp) : UP);
        const s = this.dS[i]; _s.set(s, s * (1 + Math.min(3, sp * 0.35)), s);
        _m.compose(_p.set(this.dP[j], this.dP[j + 1], this.dP[j + 2]), _q, _s); this.drops.setMatrixAt(i, _m);
      }
      this.live = live; this.drops.instanceMatrix.needsUpdate = true;
    }
    // pools spreading out
    if (this.growing.length) {
      for (const g of this.growing) {
        g.t += dt; const k = 0.04 + 0.96 * Math.sqrt(Math.min(1, g.t / g.secs));
        this.decals.getMatrixAt(g.i, _m); const sx = _x.setFromMatrixColumn(_m, 0).length(), sy = _y.setFromMatrixColumn(_m, 1).length();
        const want = g.size * k; if (sx > 0) { _x.multiplyScalar(want / sx); _y.multiplyScalar(want / Math.max(1e-6, sy)); _z.setFromMatrixColumn(_m, 2); const px = _m.elements[12], py = _m.elements[13], pz = _m.elements[14]; _m.makeBasis(_x, _y, _z); _m.setPosition(px, py, pz); this.decals.setMatrixAt(g.i, _m); this.decals.instanceMatrix.needsUpdate = true; }
      }
      this.growing = this.growing.filter(g => g.t < g.secs);
    }
    // wounds soaking outwards (faster on the dead and the dying, a little on the walking wounded)
    for (const p of this.wounded) {
      if (p.gone) { this.wounded.delete(p); continue; }
      let busy = false;
      for (const w of p.wounds || []) { if (w.r < w.r1) { w.r = Math.min(w.r1, w.r + dt * (p.dead ? 0.03 : 0.012)); busy = true; } w.k = Math.min(1, w.k + dt * 0.05); }
      if (!busy && !(p.wound && !p.dead)) this.wounded.delete(p);
      // drips behind someone getting away hurt
      if (!p.dead && p.wound && (p.speedNow || 0) > 0.4 && !p.carried) {
        p._dripD = (p._dripD || 0) + p.speedNow * dt;
        if (p._dripD > (p.wound.zone === 'leg' ? 0.55 : 0.9)) { p._dripD = 0; this.drip(p.x, (G.tiles.ground(p.x, p.z, (p.y || 0) + 0.5) ?? p.y) + 0.002, p.z); }
      }
    }
  }
}
