// Instanced low-poly people. Every person (brothers, pedestrians, police) is drawn by the
// same nine instanced part meshes, so a crowd costs nine draw calls.
import * as THREE from 'three/webgpu';
import { mergeGeos } from './tiles.js';

const MAX = 260;
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

function partGeo(kind) {
  let g;
  if (kind === 'torso') {
    g = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8, 1); g.scale(1, 1, 0.62); g.translate(0, 1.15, 0);
    const sh = new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2); sh.scale(1.05, 0.35, 0.62); sh.translate(0, 1.45, 0);
    g = mergeGeos([g.toNonIndexed(), sh.toNonIndexed()]);
  } else if (kind === 'head') { g = new THREE.SphereGeometry(0.105, 10, 8); g.scale(0.92, 1.12, 1); g.translate(0, 1.64, 0); }
  else if (kind === 'hair') { g = new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(0.95, 1.05, 1.05); g.translate(0, 1.665, -0.01); }
  else if (kind === 'leg') { g = new THREE.CapsuleGeometry(0.072, 0.74, 3, 8); g.translate(0, -0.44, 0); const foot = new THREE.BoxGeometry(0.1, 0.07, 0.24); foot.translate(0, -0.86, 0.05); g = mergeGeos([g.toNonIndexed(), foot.toNonIndexed()]); }
  else if (kind === 'arm') { g = new THREE.CapsuleGeometry(0.05, 0.5, 3, 6); g.translate(0, -0.29, 0); }
  else if (kind === 'hand') { g = new THREE.SphereGeometry(0.048, 6, 4); g.translate(0, -0.6, 0); }
  else if (kind === 'hat') { const a = new THREE.CylinderGeometry(0.1, 0.12, 0.16, 10); a.translate(0, 1.79, 0); const d = new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2); d.scale(1, 1.4, 1); d.translate(0, 1.86, 0); const brim = new THREE.CylinderGeometry(0.15, 0.15, 0.015, 12); brim.translate(0, 1.72, 0); g = mergeGeos([a.toNonIndexed(), d.toNonIndexed(), brim.toNonIndexed()]); }
  else if (kind === 'umbrella') { const c = new THREE.ConeGeometry(0.55, 0.28, 10, 1, true); c.translate(0, 2.12, 0); const st = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4); st.translate(0, 1.7, 0); g = mergeGeos([c.toNonIndexed(), st.toNonIndexed()]); }
  else if (kind === 'bag') { g = new THREE.BoxGeometry(0.26, 0.32, 0.1); g.translate(0, 1.18, -0.17); }
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

const PARTS = ['torso', 'head', 'hair', 'legL', 'legR', 'armL', 'armR', 'handL', 'handR', 'hat', 'umbrella', 'bag'];

export class People {
  constructor(scene, shadows) {
    this.list = [];
    const geos = { torso: partGeo('torso'), head: partGeo('head'), hair: partGeo('hair'), leg: partGeo('leg'), arm: partGeo('arm'), hand: partGeo('hand'), hat: partGeo('hat'), umbrella: partGeo('umbrella'), bag: partGeo('bag') };
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    const umat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, side: THREE.DoubleSide });
    this.meshes = {};
    for (const p of PARTS) {
      const g = geos[p.replace(/[LR]$/, '')];
      const m = new THREE.InstancedMesh(g, p === 'umbrella' ? umat : mat, MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadows;
      scene.add(m); this.meshes[p] = m;
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    this._base = new THREE.Matrix4(); this._part = new THREE.Matrix4();
  }
  // look: {skin, hair, top, legs, hat, hiVis, bag, umbrellaColor}
  static randomLook(r = Math.random) {
    const skins = [0xf1c7a5, 0xe0ac86, 0xc68a62, 0x8d5a3b, 0x5e3a26, 0xf5d0b5];
    const hairs = [0x2a1d14, 0x4a3122, 0x8b6a3e, 0x1b1b1b, 0xb9a27a, 0x6b6b6b, 0xd8d0c0];
    const tops = [0x2d3e50, 0x6b2737, 0x2f4f2f, 0x8a6d3b, 0x444444, 0xbfb8a5, 0x1f2f55, 0x7a7a7a, 0x9e3a2b, 0x3c5a6e, 0x111111, 0xd9d4c7];
    const legs = [0x22252b, 0x2b3a55, 0x3e3a33, 0x111111, 0x5a5348, 0x3a4a63];
    const pick = a => a[Math.floor(r() * a.length)];
    return { skin: pick(skins), hair: pick(hairs), top: pick(tops), legs: pick(legs), bald: r() < 0.08, bag: r() < 0.25, umbrella: [0x1a1a1a, 0x283a75, 0x8a1f2b, 0x2a5a3a, 0xd9c37a][Math.floor(r() * 5)], h: 0.94 + r() * 0.12 };
  }
  // Begin frame; returns writer
  draw(actors, camPos, maxDist = 160) {
    let n = 0;
    const M = this.meshes;
    for (const a of actors) {
      if (!a.visible) continue;
      const dx = a.x - camPos.x, dz = a.z - camPos.z;
      if (dx * dx + dz * dz > maxDist * maxDist) continue;
      if (n >= MAX) break;
      this.pose(n, a);
      n++;
    }
    for (const p of PARTS) { M[p].count = n; M[p].instanceMatrix.needsUpdate = true; M[p].instanceColor.needsUpdate = true; }
    return n;
  }
  set(part, i, local, color) {
    const m = this.meshes[part];
    this._part.multiplyMatrices(this._base, local);
    m.setMatrixAt(i, this._part);
    m.setColorAt(i, this._c.setHex(color));
  }
  hide(part, i) { this._part.makeScale(0, 0, 0); this.meshes[part].setMatrixAt(i, this._part); }
  pose(i, a) {
    const L = a.look, s = L.h || 1;
    const fall = a.fall || 0;          // 0 standing .. 1 lying
    this._q.setFromAxisAngle(Y, -a.heading + Math.PI / 2);
    if (fall) { this._q2.setFromAxisAngle(X, -fall * Math.PI / 2); this._q.multiply(this._q2); }
    this._base.compose(this._v.set(a.x, a.y + fall * 0.15, a.z), this._q, this._s.set(s, s, s));
    const ph = a.phase || 0, amp = Math.min(1, (a.speed || 0) / 1.4) * (a.running ? 0.95 : 0.55);
    const swing = Math.sin(ph) * amp;
    const I = this._tmp || (this._tmp = new THREE.Matrix4());
    const top = a.hiVis ? 0xd8e030 : L.top;
    this.set('torso', i, I.identity(), top);
    this.set('head', i, I.identity(), L.skin);
    if (L.bald || a.hat) this.hide('hair', i); else this.set('hair', i, I.identity(), L.hair);
    const legM = (side, ang) => I.makeRotationX(ang).setPosition(side * 0.1, 0.9, 0);
    this.set('legL', i, legM(-1, swing), L.legs);
    this.set('legR', i, legM(1, -swing), L.legs);
    let armL = -swing * 0.8, armR = swing * 0.8, armRz = 0, armLz = 0;
    if (a.pose === 'talk') { armR = -0.6 - 0.35 * Math.sin(a.t * 3.1); armL = -0.15; }
    else if (a.pose === 'phone') { armR = -2.3; armRz = 0.5; }
    else if (a.pose === 'umbrella') { armR = -1.4; }
    else if (a.pose === 'wave') { armR = -2.6 + 0.3 * Math.sin(a.t * 8); }
    else if (a.pose === 'point') { armR = -1.5; }
    else if (a.pose === 'hands') { armR = armL = -2.8; }
    const R2 = this._tmp2 || (this._tmp2 = new THREE.Matrix4());
    const armM = (side, ang, z) => { I.makeRotationX(ang); if (z) { R2.makeRotationZ(z * side); I.premultiply(R2); } return I.setPosition(side * 0.245, 1.44, 0); };
    this.set('armL', i, armM(-1, armL, armLz), top);
    this.set('armR', i, armM(1, armR, armRz), top);
    this.set('handL', i, armM(-1, armL, armLz), L.skin);
    this.set('handR', i, armM(1, armR, armRz), L.skin);
    if (a.hat) this.set('hat', i, I.identity(), 0x101318); else this.hide('hat', i);
    if (a.pose === 'umbrella') this.set('umbrella', i, I.makeTranslation(0.12, 0, 0.05), L.umbrella); else this.hide('umbrella', i);
    if (L.bag && !a.hiVis) this.set('bag', i, I.identity(), 0x3a2f28); else this.hide('bag', i);
  }
}
