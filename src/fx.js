// Gunfire effects, all pooled (ring buffers in instanced draws, so firing never adds draw calls or garbage):
//  - flashes: a hot star at the muzzle for a frame or two, plus one shared point light that pulses with it
//  - tracers: a bright streak down the line of the shot
//  - puffs: soft billboards that swell and fade (dust off brick and tarmac, smoke at the muzzle, a red mist
//    off a person, grey from a car)
//  - holes: a dark pock with a chipped rim, pressed onto the wall or ground where a round hit
//  - casings: brass thrown out of the ejection port, bouncing and rolling to a stop
import * as THREE from 'three/webgpu';
import { attribute, uv, vec3, vec4, float, smoothstep, length, mix, sin, atan, step } from 'three/tsl';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
const Z0 = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);

function pool(geo, mat, n, scene, extra = {}) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = n;
  for (let i = 0; i < n; i++) m.setMatrixAt(i, Z0);
  Object.assign(m, extra); scene.add(m);
  return m;
}

export class GunFx {
  constructor(G) {
    this.G = G; const scene = G.scene;
    // ---- puffs (colour and opacity per instance)
    const NP = 220; this.NP = NP;
    const pg = new THREE.PlaneGeometry(1, 1);
    this.pCol = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); this.pCol.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('pcol', this.pCol);
    const pm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const c = attribute('pcol', 'vec4'), r = length(uv().sub(0.5)).mul(2);
    const soft = float(1).sub(smoothstep(0.35, 1.0, r)).mul(sin(uv().x.mul(9.0).add(uv().y.mul(7.0))).mul(0.12).add(0.88));
    pm.colorNode = c.rgb; pm.opacityNode = soft.mul(c.a);
    this.puffs = pool(pg, pm, NP, scene, { renderOrder: 3 });
    this.pP = new Float32Array(NP * 3); this.pV = new Float32Array(NP * 3); this.pA = new Float32Array(NP).fill(9); this.pL = new Float32Array(NP);
    this.pS0 = new Float32Array(NP); this.pS1 = new Float32Array(NP); this.pAl = new Float32Array(NP); this.pR = new Float32Array(NP); this.pi = 0;
    // ---- flashes (unlit, far above 1 so the bloom takes them)
    const NF = 24; this.NF = NF;
    const fg = new THREE.PlaneGeometry(1, 1);
    const fm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const fu = uv().sub(0.5), fr = length(fu).mul(2), star = float(1).sub(smoothstep(0.0, 1.0, fr)).mul(float(1).sub(smoothstep(0.0, 0.5, fu.x.abs().mul(fu.y.abs()).mul(60))).mul(0.6).add(0.4));
    fm.colorNode = vec3(9, 5.2, 1.8).mul(star); fm.opacityNode = star;
    this.flashes = pool(fg, fm, NF, scene, { renderOrder: 4 });
    this.fA = new Float32Array(NF).fill(9); this.fi = 0; this.fMat = Array.from({ length: NF }, () => new THREE.Matrix4());
    // the muzzle flash's light on its surroundings: High only (any light in the scene costs every lit pixel, firing
    // or not); elsewhere the flash and the bloom carry it
    if (G.quality === 'high') { this.light = new THREE.PointLight(0xffc27a, 0, 9, 2); this.light.castShadow = false; scene.add(this.light); }
    else this.light = { position: new THREE.Vector3(), intensity: 0 };
    this.lightT = 0;
    // ---- tracers
    const NT = 40; this.NT = NT;
    const tm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    tm.colorNode = vec3(7, 5, 2.2); tm.opacityNode = float(0.9);
    this.tracers = pool(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), tm, NT, scene);
    this.tA = new Float32Array(NT).fill(9); this.tL = new Float32Array(NT); this.tFrom = new Float32Array(NT * 3); this.tDir = new Float32Array(NT * 3); this.tLen = new Float32Array(NT); this.ti = 0;
    // ---- holes
    const NH = 320; this.NH = NH;
    const hg = new THREE.PlaneGeometry(1, 1);
    this.hCol = new THREE.InstancedBufferAttribute(new Float32Array(NH * 4), 4); hg.setAttribute('hcol', this.hCol);
    const hm = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, roughness: 0.95 });
    const hc = attribute('hcol', 'vec4'), hr = length(uv().sub(0.5)).mul(2);
    const pit = float(1).sub(smoothstep(0.14, 0.26, hr)), rim = smoothstep(0.2, 0.32, hr).mul(float(1).sub(smoothstep(0.5, 0.95, hr)));
    // a stain (alpha above 1: a pool of blood): a soft-edged irregular pool of its colour, darker where it's deep
    const stain = step(1.5, hc.a), au = uv().sub(0.5), ang = atan(au.y, au.x);
    const edge = float(0.78).add(sin(ang.mul(3).add(hc.a.mul(7))).mul(0.08)).add(sin(ang.mul(7).add(hc.a.mul(13))).mul(0.05));
    const puddle = float(1).sub(smoothstep(edge.sub(0.12), edge, hr));
    hm.colorNode = mix(mix(mix(hc.rgb.mul(1.35), hc.rgb.mul(0.55), rim.mul(0.5)), vec3(0.015, 0.014, 0.013), pit), mix(hc.rgb, hc.rgb.mul(0.55), float(1).sub(hr)), stain);
    hm.roughnessNode = mix(float(0.95), float(0.18), stain);
    hm.opacityNode = mix(pit.add(rim.mul(hc.a)).min(1), puddle.mul(0.92), stain);
    this.holes = pool(hg, hm, NH, scene, { renderOrder: 2, receiveShadow: true });
    this.hi = 0;
    // ---- casings
    const NC = 60; this.NC = NC;
    const cm = new THREE.MeshStandardNodeMaterial({ color: 0xb08a3a, metalness: 0.85, roughness: 0.32 });
    this.casings = pool(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 6).rotateX(Math.PI / 2), cm, NC, scene, { castShadow: false });
    this.cP = new Float32Array(NC * 3); this.cV = new Float32Array(NC * 3); this.cR = new Float32Array(NC * 3); this.cW = new Float32Array(NC * 3); this.cA = new Float32Array(NC).fill(99); this.cRest = new Uint8Array(NC); this.ci = 0;
  }
  // a soft puff at p with velocity v: size from s0 to s1 over `life` seconds, colour rgb, peak opacity a
  puff(p, v, rgb, a, s0, s1, life) {
    const i = this.pi; this.pi = (i + 1) % this.NP;
    this.pP.set([p.x, p.y, p.z], i * 3); this.pV.set([v.x, v.y, v.z], i * 3);
    this.pA[i] = 0; this.pL[i] = life; this.pS0[i] = s0; this.pS1[i] = s1; this.pAl[i] = a; this.pR[i] = Math.random() * 6.28;
    this.pCol.setXYZW(i, rgb[0], rgb[1], rgb[2], 0);
  }
  flash(p, dir, size) {
    for (let k = 0; k < 3; k++) {
      const i = this.fi; this.fi = (i + 1) % this.NF; this.fA[i] = 0;
      // two planes along the barrel (a star seen from the side) and one facing down it
      if (k < 2) { _q.setFromUnitVectors(UP, dir); _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, k * Math.PI / 2)); _s.set(size * 0.55, size * 1.4, 1); _p.copy(p).addScaledVector(dir, size * 0.55); }
      else { _q.setFromUnitVectors(FWD, dir); _s.set(size * 0.8, size * 0.8, 1); _p.copy(p).addScaledVector(dir, size * 0.12); }
      this.fMat[i].compose(_p, _q, _s);
      this.flashes.setMatrixAt(i, this.fMat[i]);
    }
    this.flashes.instanceMatrix.needsUpdate = true;
    this.light.position.copy(p).addScaledVector(dir, 0.15); this.light.intensity = 26 * size / 0.25; this.lightT = 0.05;
  }
  tracer(from, dir, len) {
    if (len < 1.5) return;
    const i = this.ti; this.ti = (i + 1) % this.NT;
    this.tA[i] = 0; this.tL[i] = Math.min(0.07, len / 900 + 0.03);
    this.tFrom.set([from.x, from.y, from.z], i * 3); this.tDir.set([dir.x, dir.y, dir.z], i * 3); this.tLen[i] = len;
  }
  // a hole in a surface at p with outward normal n; rgb the surface's own colour (the rim's chipped paint)
  hole(p, n, size, rgb = [0.4, 0.38, 0.35]) {
    const i = this.hi; this.hi = (i + 1) % this.NH;
    _q.setFromUnitVectors(FWD, n); _q.multiply(new THREE.Quaternion().setFromAxisAngle(FWD, Math.random() * 6.28));
    _p.copy(p).addScaledVector(n, 0.004); _s.setScalar(size * (0.8 + Math.random() * 0.4));
    _m.compose(_p, _q, _s); this.holes.setMatrixAt(i, _m); this.holes.instanceMatrix.needsUpdate = true;
    this.hCol.setXYZW(i, rgb[0], rgb[1], rgb[2], 0.85); this.hCol.needsUpdate = true;
  }
  // a pool of blood on the ground at (x, y, z), `size` metres across (it spreads out over a couple of seconds)
  stain(x, y, z, size) {
    const i = this.hi; this.hi = (i + 1) % this.NH;
    this.grow = this.grow || []; this.grow.push({ i, x, y, z, size, t: 0, rot: Math.random() * 6.28 });
    this.hCol.setXYZW(i, 0.2, 0.012, 0.01, 2 + Math.random()); this.hCol.needsUpdate = true;
    this.growStain(this.grow.at(-1), 0.05);
  }
  growStain(g, k) {
    _q.setFromUnitVectors(FWD, UP); _q.multiply(new THREE.Quaternion().setFromAxisAngle(FWD, g.rot));
    _p.set(g.x, g.y + 0.004, g.z); _s.setScalar(g.size * k);
    _m.compose(_p, _q, _s); this.holes.setMatrixAt(g.i, _m); this.holes.instanceMatrix.needsUpdate = true;
  }
  casing(p, v) {
    const i = this.ci; this.ci = (i + 1) % this.NC;
    this.cP.set([p.x, p.y, p.z], i * 3); this.cV.set([v.x, v.y, v.z], i * 3);
    this.cR.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3); this.cW.set([(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40], i * 3);
    this.cA[i] = 0; this.cRest[i] = 0;
  }
  update(dt, cam) {
    if (this.grow?.length) { for (const g of this.grow) { g.t += dt; this.growStain(g, Math.min(1, 0.05 + Math.sqrt(g.t / 3.5) * 0.95)); } this.grow = this.grow.filter(g => g.t < 3.5); }
    const G = this.G;
    // puffs: billboards to the camera, drifting up and slowing
    const cq = cam.quaternion; let any = false;
    for (let i = 0; i < this.NP; i++) {
      if (this.pA[i] >= this.pL[i]) { if (this.pA[i] < 9) { this.pA[i] = 9; this.puffs.setMatrixAt(i, Z0); any = true; } continue; }
      this.pA[i] += dt; const t = Math.min(1, this.pA[i] / this.pL[i]); any = true;
      const k = Math.exp(-3 * dt);
      for (let c = 0; c < 3; c++) { this.pV[i * 3 + c] *= k; this.pP[i * 3 + c] += this.pV[i * 3 + c] * dt; }
      this.pP[i * 3 + 1] += 0.25 * dt;
      _p.fromArray(this.pP, i * 3); _q.copy(cq).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, this.pR[i] + t * 0.6));
      const s = this.pS0[i] + (this.pS1[i] - this.pS0[i]) * (1 - (1 - t) * (1 - t)); _s.set(s, s, s);
      _m.compose(_p, _q, _s); this.puffs.setMatrixAt(i, _m);
      this.pCol.setW(i, this.pAl[i] * Math.min(1, t * 8) * (1 - t) * (1 - t));
    }
    if (any) { this.puffs.instanceMatrix.needsUpdate = true; this.pCol.needsUpdate = true; }
    // flashes: a frame or two
    let fl = false;
    for (let i = 0; i < this.NF; i++) { if (this.fA[i] >= 9) continue; this.fA[i] += dt; fl = true; if (this.fA[i] > 0.045) { this.fA[i] = 9; this.flashes.setMatrixAt(i, Z0); } }
    if (fl) this.flashes.instanceMatrix.needsUpdate = true;
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; else this.light.intensity *= Math.exp(-dt * 40); }
    // tracers: a streak a few metres long racing down the line
    let tr = false;
    for (let i = 0; i < this.NT; i++) {
      if (this.tA[i] >= 9) continue; tr = true;
      this.tA[i] += dt; const t = this.tA[i] / this.tL[i];
      if (t >= 1) { this.tA[i] = 9; this.tracers.setMatrixAt(i, Z0); continue; }
      const L = this.tLen[i], seg = Math.min(L * 0.35, 6), head = Math.min(L, t * (L + seg)), tail = Math.max(0, head - seg);
      _v.fromArray(this.tDir, i * 3); _p.fromArray(this.tFrom, i * 3).addScaledVector(_v, tail);
      _q.setFromUnitVectors(FWD, _v); _s.set(0.012, 0.012, Math.max(0.01, head - tail));
      _m.compose(_p, _q, _s); this.tracers.setMatrixAt(i, _m);
    }
    if (tr) this.tracers.instanceMatrix.needsUpdate = true;
    // casings: thrown, bounce on the ground with a tinkle of spin, then lie there a few seconds
    let ca = false;
    for (let i = 0; i < this.NC; i++) {
      if (this.cA[i] >= 99) continue; ca = true;
      this.cA[i] += dt;
      if (this.cA[i] > 8) { this.cA[i] = 99; this.casings.setMatrixAt(i, Z0); continue; }
      const j = i * 3;
      if (!this.cRest[i]) {
        this.cV[j + 1] -= 9.8 * dt;
        for (let c = 0; c < 3; c++) { this.cP[j + c] += this.cV[j + c] * dt; this.cR[j + c] += this.cW[j + c] * dt; }
        const gy = G.interiors?.at?.(G.brothers.me)?.floorAt?.(this.cP[j], this.cP[j + 2], this.cP[j + 1] + 0.3) ?? G.tiles.ground(this.cP[j], this.cP[j + 2], this.cP[j + 1] + 0.3);
        if (gy != null && this.cP[j + 1] < gy + 0.005) {
          this.cP[j + 1] = gy + 0.005;
          if (Math.abs(this.cV[j + 1]) < 0.6) { this.cRest[i] = 1; this.cR[j] = Math.PI / 2 * Math.round(this.cR[j] / (Math.PI / 2)); this.cR[j + 2] = 0; }
          else { this.cV[j + 1] *= -0.35; this.cV[j] *= 0.5; this.cV[j + 2] *= 0.5; for (let c = 0; c < 3; c++) this.cW[j + c] *= 0.6; }
        }
      }
      _p.fromArray(this.cP, j); _q.setFromEuler(new THREE.Euler(this.cR[j], this.cR[j + 1], this.cR[j + 2])); _s.setScalar(1);
      _m.compose(_p, _q, _s); this.casings.setMatrixAt(i, _m);
    }
    if (ca) this.casings.instanceMatrix.needsUpdate = true;
  }
}
