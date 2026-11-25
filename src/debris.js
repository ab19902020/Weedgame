// Flying bits: glass, plastic and paint chips, bricks, wood splinters and leaves (one lit instanced draw),
// plus sparks (one unlit, HDR-bright draw so the bloom picks them up). Pieces tumble under gravity, bounce
// and skid on the ground, then lie there for a while and shrink away. Ring buffers: the oldest piece is
// reused when the pool is full, so a big pile-up can never grow the cost.
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

const MAX = 900, MAXS = 260;
// per kind: size range (x, y, z in metres), drag, bounce, lifetime on the ground (s), colour (linear)
const KINDS = {
  glass: { s: [0.045, 0.014, 0.05], v: 0.6, drag: 0.4, bounce: 0.35, life: 18, col: [0.62, 0.72, 0.78] },
  chip: { s: [0.11, 0.01, 0.08], v: 0.8, drag: 0.6, bounce: 0.3, life: 25, col: [0.02, 0.02, 0.022] },
  brick: { s: [0.2, 0.065, 0.1], v: 0.35, drag: 0.05, bounce: 0.18, life: 60, col: [0.36, 0.13, 0.08] },
  rubble: { s: [0.09, 0.06, 0.08], v: 0.7, drag: 0.08, bounce: 0.2, life: 50, col: [0.3, 0.28, 0.26] },
  splinter: { s: [0.45, 0.025, 0.07], v: 0.6, drag: 0.2, bounce: 0.25, life: 40, col: [0.3, 0.2, 0.11] },
  leaf: { s: [0.06, 0.004, 0.045], v: 0.5, drag: 3.2, bounce: 0.05, life: 22, col: [0.09, 0.2, 0.05] },
  twig: { s: [0.3, 0.015, 0.015], v: 0.6, drag: 1.2, bounce: 0.1, life: 22, col: [0.18, 0.12, 0.07] },
  plastic: { s: [0.16, 0.015, 0.1], v: 0.8, drag: 0.5, bounce: 0.3, life: 30, col: [0.03, 0.03, 0.03] },
  drop: { s: [0.035, 0.035, 0.035], v: 0.2, drag: 0.4, bounce: 0, life: 0.9, col: [0.8, 0.86, 0.9] },          // splash droplets
  plate: { s: [0.52, 0.012, 0.11], v: 0.05, drag: 0.3, bounce: 0.3, life: 90, col: [0.85, 0.85, 0.82] },     // number plate
  trim: { s: [0.9, 0.05, 0.12], v: 0.3, drag: 0.15, bounce: 0.25, life: 90, col: [0.025, 0.025, 0.028] },   // bumper trim / grille
};

export class Debris {
  constructor(scene, groundAt) {
    this.groundAt = groundAt;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(g, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.receiveShadow = true;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    const sm = new THREE.MeshBasicNodeMaterial({ fog: false });
    sm.colorNode = vec3(6, 2.6, 0.7);            // far above 1: blooms as hot metal
    this.sparks = new THREE.InstancedMesh(g, sm, MAXS);
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.frustumCulled = false; this.sparks.count = 0;
    scene.add(this.sparks);
    // piece state: position, velocity, rotation (euler), spin, size, age, life, rest flag, kind index
    this.P = new Float32Array(MAX * 3); this.V = new Float32Array(MAX * 3); this.R = new Float32Array(MAX * 3);
    this.W = new Float32Array(MAX * 3); this.S = new Float32Array(MAX * 3); this.A = new Float32Array(MAX).fill(-1);
    this.L = new Float32Array(MAX); this.rest = new Uint8Array(MAX); this.k = [];
    this.i = 0; this.n = 0;
    this.sp = new Float32Array(MAXS * 3); this.sv = new Float32Array(MAXS * 3); this.sa = new Float32Array(MAXS).fill(9); this.sl = new Float32Array(MAXS);
    this.si = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
    this._z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this._z);
    for (let i = 0; i < MAXS; i++) this.sparks.setMatrixAt(i, this._z);
  }
  // n pieces of a kind from (x, y, z), thrown with velocity (vx, vy, vz) plus a spread; col overrides the colour
  burst(kind, n, x, y, z, vx, vy, vz, spread = 2, col = null) {
    const K = KINDS[kind];
    for (let j = 0; j < n; j++) {
      const i = this.i; this.i = (this.i + 1) % MAX; this.n = Math.min(MAX, this.n + 1);
      const sz = 0.6 + Math.random() * 0.8;
      this.P.set([x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.4], i * 3);
      this.V.set([vx + (Math.random() - 0.5) * spread * 2, vy + Math.random() * spread, vz + (Math.random() - 0.5) * spread * 2], i * 3);
      this.R.set([Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28], i * 3);
      this.W.set([(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24], i * 3);
      this.S.set([K.s[0] * sz, K.s[1] * (0.8 + Math.random() * 0.4), K.s[2] * sz], i * 3);
      this.A[i] = 0; this.L[i] = K.life * (0.7 + Math.random() * 0.6); this.rest[i] = 0; this.k[i] = K;
      const c = col || K.col, t = 1 - K.v / 2 + Math.random() * K.v;
      this.mesh.setColorAt(i, this._c.setRGB(c[0] * t, c[1] * t, c[2] * t));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  spark(n, x, y, z, vx, vy, vz, spread = 3) {
    for (let j = 0; j < n; j++) {
      const i = this.si; this.si = (this.si + 1) % MAXS;
      this.sp.set([x, y, z], i * 3);
      this.sv.set([vx + (Math.random() - 0.5) * spread * 2, vy + Math.random() * spread, vz + (Math.random() - 0.5) * spread * 2], i * 3);
      this.sa[i] = 0; this.sl[i] = 0.25 + Math.random() * 0.45;
    }
  }
  update(dt) {
    if (dt <= 0) return;
    const P = this.P, V = this.V, R = this.R, W = this.W, S = this.S, m = this._m;
    let moved = false;
    for (let i = 0; i < this.n; i++) {
      if (this.A[i] < 0) continue;
      const K = this.k[i];
      this.A[i] += dt;
      const fade = Math.min(1, (this.L[i] - this.A[i]) / 1.5);
      if (fade <= 0) { this.A[i] = -1; this.mesh.setMatrixAt(i, this._z); moved = true; continue; }
      if (!this.rest[i]) {
        const o = i * 3, d = Math.exp(-K.drag * dt);
        V[o] *= d; V[o + 2] *= d; V[o + 1] = V[o + 1] * d - 9.81 * dt;
        if (K === KINDS.leaf || K === KINDS.twig) {
          // leaves flutter: lift against the fall and a sideways wobble
          V[o + 1] = Math.max(V[o + 1], -1.3); V[o] += Math.sin(this.A[i] * 7 + i) * dt * 2.2; V[o + 2] += Math.cos(this.A[i] * 6 + i * 1.7) * dt * 2.2;
        }
        P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
        R[o] += W[o] * dt; R[o + 1] += W[o + 1] * dt; R[o + 2] += W[o + 2] * dt;
        const gy = this.groundAt(P[o], P[o + 2], P[o + 1]) + S[o + 1] * 0.5;
        if (P[o + 1] < gy) {
          P[o + 1] = gy;
          if (V[o + 1] < -1.2) { V[o + 1] *= -K.bounce; V[o] *= 0.6; V[o + 2] *= 0.6; W[o] *= 0.6; W[o + 1] *= 0.6; W[o + 2] *= 0.6; }
          else {
            // lying down: skid to a stop and settle flat (pieces are thin in y)
            V[o + 1] = 0; const f = Math.exp(-6 * dt); V[o] *= f; V[o + 2] *= f;
            W[o] *= f; W[o + 1] *= f; W[o + 2] *= f;
            R[o] += (Math.round(R[o] / Math.PI) * Math.PI - R[o]) * Math.min(1, dt * 8);
            R[o + 2] += (Math.round(R[o + 2] / Math.PI) * Math.PI - R[o + 2]) * Math.min(1, dt * 8);
            if (V[o] * V[o] + V[o + 2] * V[o + 2] < 0.01) this.rest[i] = 1;
          }
        }
      } else if (fade >= 1) continue;
      const o = i * 3;
      this._q.setFromEuler(this._e.set(R[o], R[o + 1], R[o + 2]));
      m.compose(this._p.set(P[o], P[o + 1], P[o + 2]), this._q, this._s.set(S[o] * fade, S[o + 1] * fade, S[o + 2] * fade));
      this.mesh.setMatrixAt(i, m); moved = true;
    }
    if (moved) { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
    // sparks: short bright streaks along their velocity
    let live = 0;
    for (let i = 0; i < MAXS; i++) {
      if (this.sa[i] >= this.sl[i]) { if (this.sa[i] < 9) { this.sa[i] = 9; this.sparks.setMatrixAt(i, this._z); } continue; }
      live++;
      const o = i * 3; this.sa[i] += dt;
      this.sv[o + 1] -= 9.81 * dt;
      this.sp[o] += this.sv[o] * dt; this.sp[o + 1] += this.sv[o + 1] * dt; this.sp[o + 2] += this.sv[o + 2] * dt;
      const gy = this.groundAt(this.sp[o], this.sp[o + 2], this.sp[o + 1]);
      if (this.sp[o + 1] < gy) { this.sp[o + 1] = gy; this.sv[o + 1] *= -0.4; this.sv[o] *= 0.7; this.sv[o + 2] *= 0.7; }
      const vx = this.sv[o], vy = this.sv[o + 1], vz = this.sv[o + 2], sp = Math.hypot(vx, vy, vz) || 1;
      this._p.set(vx / sp, vy / sp, vz / sp);
      this._q.setFromUnitVectors(this._s.set(0, 0, 1), this._p);
      const k = 1 - this.sa[i] / this.sl[i];
      m.compose(this._p.set(this.sp[o], this.sp[o + 1], this.sp[o + 2]), this._q, this._s.set(0.012 * k, 0.012 * k, Math.min(0.5, sp * 0.03) * k + 0.02));
      this.sparks.setMatrixAt(i, m);
    }
    this.sparks.count = live ? MAXS : 0;
    if (live || this._sl) this.sparks.instanceMatrix.needsUpdate = true;
    this._sl = live;
  }
}
