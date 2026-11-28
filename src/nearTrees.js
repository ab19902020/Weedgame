// Trees near you, grown in Blender 4.3 (tools/blender/trees.py -> www/vegetation/trees.glb): a real trunk, limbs
// and branches carrying clumps of leaf cards, the ambient occlusion ray traced through each tree in Blender.
// Seven trees (two oaks, two limes, a plane, a copper beech, a conifer) stand in for the map's trees (tiles.js
// addTrees) within the preset's treeNear of the camera; beyond it the cheap leaf-card crowns carry on, handing over in
// a fine dither (vegetation.js treeNear). One instanced draw per tree model, whatever the number of tiles.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { nearTreeMaterial, treeNear } from './vegetation.js';

// tiles.js species: 0 oak, 1 lime, 2 plane, 3 copper beech, 4 yew and conifers -> the Blender trees for each
const KINDS = [['oak_a', 'oak_b'], ['lime_a', 'lime_b'], ['plane'], ['beech'], ['conifer']];
const CAP = 160;   // per model (within 120 m on High there are rarely a hundred trees of all kinds together)

export class NearTrees {
  constructor(G) {
    this.G = G; this.near = G.budget?.treeNear || 0; this.ready = false; this.list = [];
    this.timer = 0; this.lx = 1e9; this.lz = 1e9;
    this._d = new THREE.Matrix4(); this._m = new THREE.Matrix4(); this._tc = new THREE.Matrix4(); this._t0 = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._c = new THREE.Color();
    if (this.near > 0 && !G.Q?.has('notrees')) new GLTFLoader().load('vegetation/trees.glb', g => this.setup(g), undefined, e => console.warn('Trees failed to load', e));
  }
  setup(g) {
    const G = this.G, mat = nearTreeMaterial(), sm = G.renderer.shadowMap.enabled;
    this.meshes = new Map(); this.info = new Map();
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, mat, CAP);
      im.count = 0; im.frustumCulled = false; im.name = 'near-tree-' + o.name;
      im.castShadow = sm && G.budget?.shadow?.trees !== false; im.receiveShadow = sm;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this._c.setRGB(0.5, 0.5, 0.5));
      G.scene.add(im);
      this.meshes.set(o.name, im);
      this.info.set(o.name, { height: o.userData.height || 12, crown: o.userData.crownRadius || 5 });   // (glTF extras)
    });
    this.kinds = KINDS.map(k => k.filter(n => this.meshes.has(n)));
    this.ready = true; this.enabled = this.on !== false;
  }
  // (off: the leaf-card crowns everywhere, as before)
  get enabled() { return this.on !== false; }
  set enabled(v) { this.on = !!v; if (!this.ready) return; treeNear.value = v ? this.near : 0; for (const im of this.meshes.values()) im.visible = !!v; if (v) this.timer = 0; }
  update(dt) {
    if (!this.ready || this.on === false) return;
    const cam = this.G.camera.position;
    this.timer -= dt;
    if (this.timer <= 0 || Math.hypot(cam.x - this.lx, cam.z - this.lz) > 5) { this.timer = 0.3; this.lx = cam.x; this.lz = cam.z; this.rebuild(cam); }
    else this.follow();
  }
  // which trees are near, and which model each one gets
  rebuild(cam) {
    const R = this.near + 8, R2 = R * R, L = this.list; L.length = 0;
    for (const im of this.meshes.values()) im.count = 0;
    for (const t of this.G.tiles.tiles.values()) {
      const D = t.treeData, T = t.treeMesh; if (!D || !T) continue;
      const ox = t.data.ox, oz = t.data.oz;
      if (cam.x < ox - R || cam.x > ox + 256 + R || cam.z < oz - R || cam.z > oz + 256 + R) continue;
      for (let i = 0, n = D.length / 8; i < n; i++) {
        const dx = D[i * 8] + ox - cam.x, dz = D[i * 8 + 2] + oz - cam.z;
        if (dx * dx + dz * dz > R2) continue;
        const ks = this.kinds[D[i * 8 + 5]]; if (!ks?.length) continue;
        const name = ks[Math.floor(D[i * 8 + 6] * 7919) % ks.length], im = this.meshes.get(name);
        if (im.count >= CAP) continue;
        const e = { t, i, im, k: im.count++, name, sig: 0 };
        L.push(e); this.place(e);
        T.crowns.getColorAt(i, this._c); im.setColorAt(e.k, this._c);   // (the species tint the far crown has)
      }
    }
    for (const im of this.meshes.values()) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  // stand the model where the tree is: its height, a width to suit the spot it was planted in (no wider than the far
  // crown by more than a third), the far crown's turn; and if its trunk has been moved since (toppled by a car,
  // breakables.js; hidden in a building you've opened, interiors.js), moved the same way
  place(e) {
    const { t, i, im, k } = e, D = t.treeData, T = t.treeMesh, info = this.info.get(e.name), o = i * 16;
    const H = D[i * 8 + 3], s = H / info.height, sxz = Math.min(1, Math.max(0.72, D[i * 8 + 7] * 1.35 / (info.crown * s)));
    this._q.setFromAxisAngle(this._up, D[i * 8 + 4]);
    this._d.compose(this._p.set(D[i * 8], D[i * 8 + 1] - 0.15, D[i * 8 + 2]), this._q, this._s.set(s * sxz, s, s * sxz));
    const A = T.trunks.instanceMatrix.array, A0 = T.trunk0;
    let moved = false; for (let j = 0; j < 16; j++) if (A[o + j] !== A0[o + j]) { moved = true; break; }
    if (moved) { this._t0.fromArray(A0, o).invert(); this._tc.fromArray(A, o); this._d.premultiply(this._t0).premultiply(this._tc); }
    this._d.premultiply(this._m.makeTranslation(t.data.ox, 0, t.data.oz));
    im.setMatrixAt(k, this._d);
    e.sig = A[o] + A[o + 1] * 3 + A[o + 5] * 5 + A[o + 12] * 7 + A[o + 13] * 11;
  }
  // between rebuilds: keep up with a tree being toppled (frame by frame)
  follow() {
    let dirty = null;
    for (const e of this.list) {
      const A = e.t.treeMesh.trunks.instanceMatrix.array, o = e.i * 16;
      if (A[o] + A[o + 1] * 3 + A[o + 5] * 5 + A[o + 12] * 7 + A[o + 13] * 11 === e.sig) continue;
      this.place(e); (dirty ||= new Set()).add(e.im);
    }
    if (dirty) for (const im of dirty) im.instanceMatrix.needsUpdate = true;
  }
}
