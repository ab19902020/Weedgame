// Tyre marks and tyre smoke. Each is one draw call.
//   marks: a ring buffer of flat quads laid along a wheel's path while it slides, spins or locks;
//          they fade over a couple of minutes (fainter on wet roads, which they don't mark as much).
//   smoke: instanced camera-facing sprites puffed from sliding wheels; they rise, spread and thin out.
import * as THREE from 'three/webgpu';
import { float, vec3, uniform, smoothstep, length, positionGeometry, instancedDynamicBufferAttribute, uv, attribute } from 'three/tsl';

const MAXM = 1600, MAXS = 160;

export class TyreFx {
  constructor(scene) {
    this.t = uniform(0);
    // ---- marks
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.mAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAXM * 2), 2); this.mAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iMark', this.mAttr);
    const mm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    mm.polygonOffset = true; mm.polygonOffsetFactor = -3; mm.polygonOffsetUnits = -3;
    const a = attribute('iMark', 'vec2');
    const age = this.t.sub(a.x);
    const edge = smoothstep(0.5, 0.32, positionGeometry.z.abs());
    mm.colorNode = vec3(0.012, 0.012, 0.012);
    mm.opacityNode = a.y.mul(edge).mul(smoothstep(150, 20, age)).mul(0.62);
    this.marks = new THREE.InstancedMesh(g, mm, MAXM);
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marks.frustumCulled = false; this.marks.count = 0; this.marks.renderOrder = 2;
    for (let i = 0; i < MAXM; i++) this.marks.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    scene.add(this.marks);
    this.mi = 0; this.mn = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._y = new THREE.Vector3(0, 1, 0);
    // ---- smoke
    this.sPos = new Float32Array(MAXS * 4); this.sVel = new Float32Array(MAXS * 3); this.sAge = new Float32Array(MAXS).fill(99);
    this.sPosAttr = new THREE.InstancedBufferAttribute(this.sPos, 4); this.sPosAttr.setUsage(THREE.DynamicDrawUsage);
    const sm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: true });
    const sp = instancedDynamicBufferAttribute(this.sPosAttr, 'vec4');
    sm.positionNode = sp.xyz;
    const life = sp.w;                                   // 0 new .. 1 gone
    sm.scaleNode = float(0.7).add(life.mul(3.2));
    const r = length(uv().sub(0.5)).mul(2);
    sm.colorNode = vec3(0.78, 0.78, 0.8);
    sm.opacityNode = smoothstep(1, 0.2, r).mul(smoothstep(1, 0.4, life)).mul(smoothstep(0, 0.06, life)).mul(0.3);
    this.smoke = new THREE.Sprite(sm);
    this.smoke.count = 0; this.smoke.frustumCulled = false; this.smoke.renderOrder = 3;
    scene.add(this.smoke);
    this.si = 0;
    this.time = 0;
  }
  // per car per frame: lay marks and smoke where wheels slide
  track(v, P, ph, wet) {
    const slip = ph.slip || 0;
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading), rx = -fz, rz = fx;
    const a = P.wb / 2, o = P.d.wx || 0, w = P.W / 2 - 0.16;
    const wheels = [[o - a, w], [o - a, -w], [o + a, w], [o + a, -w]];
    const last = v._skid || (v._skid = [null, null, null, null]);
    const front = ph.brk > 0.9 || (!ph.thr && !v.player);   // locked or sliding fronts mark too
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = wheels[k];
      const x = v.x + fx * lx + rx * lz, z = v.z + fz * lx + rz * lz;
      const on = slip > 0.28 && (k < 2 || front || slip > 0.7);
      if (!on) { last[k] = null; continue; }
      if (!last[k]) { last[k] = [x, z]; continue; }
      const [px, pz] = last[k], dx = x - px, dz = z - pz, L = Math.hypot(dx, dz);
      if (L < 0.35) continue;
      if (L < 3) this.mark((x + px) / 2, v.y + 0.02, (z + pz) / 2, Math.atan2(dz, dx), L + 0.04, Math.min(1, slip) * (1 - wet * 0.6));
      last[k] = [x, z];
      if (k < 2 && slip > 0.45 && !ph.soft && Math.random() < slip * 0.8) this.puff(x, v.y + 0.25, z, ph.vx * 0.2, ph.vz * 0.2, wet);
    }
  }
  mark(x, y, z, ang, len, k) {
    const i = this.mi; this.mi = (this.mi + 1) % MAXM; this.mn = Math.min(MAXM, this.mn + 1);
    this._q.setFromAxisAngle(this._y, -ang);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(len, 1, 0.21));
    this.marks.setMatrixAt(i, this._m);
    this.mAttr.array[i * 2] = this.time; this.mAttr.array[i * 2 + 1] = k;
    this.marks.instanceMatrix.needsUpdate = true; this.mAttr.needsUpdate = true;
    this.marks.count = this.mn;
  }
  puff(x, y, z, vx, vz, wet) {
    if (wet > 0.5) return;                      // wet roads spray rather than smoke
    const i = this.si; this.si = (this.si + 1) % MAXS;
    this.sPos.set([x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, 0], i * 4);
    this.sVel.set([vx + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, vz + (Math.random() - 0.5) * 0.8], i * 3);
    this.sAge[i] = 0;
  }
  update(dt, wind = [0, 0]) {
    this.time += dt; this.t.value = this.time;
    let live = 0;
    for (let i = 0; i < MAXS; i++) {
      if (this.sAge[i] >= 1) { this.sPos[i * 4 + 3] = 1; continue; }
      this.sAge[i] += dt / 3.2; live++;
      const vy = this.sVel[i * 3 + 1];
      this.sVel[i * 3] += (wind[0] * 0.3 - this.sVel[i * 3]) * dt * 0.8; this.sVel[i * 3 + 2] += (wind[1] * 0.3 - this.sVel[i * 3 + 2]) * dt * 0.8;
      this.sPos[i * 4] += this.sVel[i * 3] * dt; this.sPos[i * 4 + 1] += vy * dt; this.sPos[i * 4 + 2] += this.sVel[i * 3 + 2] * dt;
      this.sPos[i * 4 + 3] = this.sAge[i];
    }
    this.smoke.count = live ? MAXS : 0; this.smoke.visible = live > 0;
    if (live) this.sPosAttr.needsUpdate = true;
  }
}

