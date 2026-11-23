// Streams 256 m world tiles around a focus point in two LOD rings and keeps the
// collision / ground-height data the simulation needs for loaded tiles.
import * as THREE from 'three/webgpu';
import { atlasData, atlasTex, ATLAS_N } from './env.js';
import { terrainMaterial, groundMaterial, markingMaterial, structMaterial, buildingMaterial, treeMaterials, lampMaterial } from './materials.js';
import { crownGeometry, trunkGeometry } from './vegetation.js';

const TILE = 256, NT = 65;

export class Tiles {
  constructor(scene, manifest, net, opts = {}) {
    this.scene = scene; this.manifest = manifest; this.net = net; this.renderer = opts.renderer || null; this.gpuReady = false;
    this.R0 = opts.r0 ?? 400; this.R1 = opts.r1 ?? 1150;
    this.exists = new Set(manifest.tiles);
    this.tiles = new Map();      // key -> {lod, group, data, slot}
    this.pending = new Map();    // key -> lod requested
    this.inflight = 0; this.maxInflight = opts.inflight ?? 3;
    this.freeSlots = Array.from({ length: 256 }, (_, i) => i);
    this.mats = {
      terrain: terrainMaterial(), ground: groundMaterial(), mark: markingMaterial(), struct: structMaterial(),
      building: buildingMaterial(), lamp: lampMaterial(), ...treeMaterials(),
    };
    this.shadows = !!opts.shadows;
    this.colGrid = new Map();    // 32 m cells -> [tileKey, buildingIndex]
    this.listeners = [];
    this.workers = [];
    const nW = opts.workers ?? 2;
    for (let i = 0; i < nW; i++) {
      const w = new Worker(opts.workerUrl || 'worker.js');
      w.onmessage = ev => this.onResult(ev.data);
      w.postMessage({
        type: 'init', pts: net.pts, pstart: net.pstart, pcount: net.pcount, width: net.width, flags: net.flags, cls: net.cls,
        lanesF: net.lanesF, lanesB: net.lanesB, cutA: net.cutA, cutB: net.cutB, ctrlA: net.ctrlA, ctrlB: net.ctrlB,
        classes: net.classes, crossings: net.crossings,
        approaches: net.controllers.flatMap(c => c.approaches.map(a => [a[0], a[1], a[2]])),
        driveCls: net.classes.map((c, i) => [c, i]).filter(([c]) => !/footway|path|pedestrian|steps|cycleway|bridleway|corridor/.test(c)).map(([, i]) => i),
      });
      this.workers.push(w);
    }
    this.wi = 0;
    this.base = opts.base || 'world/';
    this.loaded = 0; this.errors = 0;
    this.buildShared();
  }
  buildShared() {
    // tree geometries (leaf-card crowns, forked trunks: vegetation.js)
    this.crownGeo = crownGeometry();
    this.trunkGeo = trunkGeometry();
    // street lamp: pole + arm + head (lampHead attribute = 1 on the luminaire)
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 7.5, 6).translate(0, 3.75, 0);
    const arm = new THREE.BoxGeometry(1.3, 0.08, 0.08).translate(-0.6, 7.45, 0);
    const head = new THREE.BoxGeometry(0.7, 0.12, 0.3).translate(-1.2, 7.35, 0);
    for (const [g, v] of [[pole, 0], [arm, 0], [head, 1]]) {
      const gg = g.toNonIndexed(); gg.setAttribute('lampHead', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count).fill(v), 1)); parts.push(gg);
    }
    this.lampGeo = mergeGeos(parts);
  }
  key(ix, iz) { return ix + '_' + iz; }
  // look: optional { x, z } camera forward (unit) and { vx, vz } travel velocity (m/s) for look-ahead priority
  update(fx, fz, look = null) {
    this.fx = fx; this.fz = fz;
    const want = new Map();
    const r = Math.ceil(this.R1 / TILE) + 1, cx = Math.floor(fx / TILE), cz = Math.floor(fz / TILE);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const k = this.key(ix, iz); if (!this.exists.has(k)) continue;
      const d = Math.hypot((ix + 0.5) * TILE - fx, (iz + 0.5) * TILE - fz);
      const cur = this.tiles.get(k);
      const hyst = cur ? 60 : 0;
      if (d < this.R0 + (cur && cur.lod === 0 ? hyst : 0)) want.set(k, [0, d]);
      else if (d < this.R1 + hyst) want.set(k, [1, d]);
    }
    // unload
    for (const [k, t] of this.tiles) if (!want.has(k)) this.unload(k);
    // request order: the near ring first, then tiles in front of the camera and along the direction of travel
    // (projected ~4 s ahead), tiles behind last
    const ax = fx + (look?.vx || 0) * 4, az = fz + (look?.vz || 0) * 4, lx = look?.x || 0, lz = look?.z || 0;
    const score = (k, d) => {
      const [ix, iz] = k.split('_').map(Number), tx = (ix + 0.5) * TILE, tz = (iz + 0.5) * TILE;
      const da = Math.hypot(tx - ax, tz - az), cos = d > 1 ? ((tx - fx) * lx + (tz - fz) * lz) / d : 1;
      return Math.min(d, da) * (1.25 - 0.45 * cos) - (d < 300 ? 1e5 : 0);
    };
    const todo = [...want].filter(([k, [lod]]) => { const t = this.tiles.get(k); return (!t || t.lod !== lod) && this.pending.get(k) !== lod; })
      .map(e => [e[0], e[1], score(e[0], e[1][1])]).sort((a, b) => a[2] - b[2]);
    for (const [k, [lod]] of todo) {
      if (this.inflight >= this.maxInflight) break;
      this.pending.set(k, lod); this.inflight++;
      this.workers[this.wi++ % this.workers.length].postMessage({ type: 'tile', key: k, lod, url: this.base + 'tiles/' + k + '.bin' });
    }
    this.want = want;
  }
  get busy() { return this.inflight > 0; }
  onResult(d) {
    this.inflight--;
    if (this.pending.get(d.key) === d.lod) this.pending.delete(d.key);
    if (d.error) { this.errors++; console.error('tile', d.key, d.error); return; }
    const w = this.want && this.want.get(d.key);
    if (!w || w[0] !== d.lod) return; // stale
    const old = this.tiles.get(d.key);
    const slot = old ? old.slot : this.freeSlots.shift();
    if (old) this.disposeTile(old, true);
    const t = { key: d.key, lod: d.lod, slot, data: d, group: new THREE.Group(), ix: d.ix, iz: d.iz };
    t.group.position.set(d.ox, 0, d.oz);
    t.group.matrixAutoUpdate = false; t.group.updateMatrix();
    // landcover into atlas
    const sx = (slot % 16) * 128, sy = Math.floor(slot / 16) * 128;
    for (let r = 0; r < 128; r++) atlasData.set(d.lc.subarray(r * 128, r * 128 + 128), (sy + r) * ATLAS_N + sx);
    // upload only this tile's 128x128 block once the atlas is on the GPU (re-uploading all 4 MB per tile caused hitches)
    if (this.renderer && this.gpuReady) {
      const sc = this._lcScratch || (this._lcScratch = Object.assign(new THREE.DataTexture(new Uint8Array(128 * 128), 128, 128, THREE.RedFormat), { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter }));
      sc.image.data.set(d.lc); sc.needsUpdate = true;
      try { this.renderer.initTexture(sc); this.renderer.copyTextureToTexture(sc, atlasTex, null, new THREE.Vector2(sx, sy)); } catch (e) { atlasTex.needsUpdate = true; }
    } else atlasTex.needsUpdate = true;
    // terrain
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(d.terrain.position, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(d.terrain.normal, 3));
    const nv = d.terrain.position.length / 3, sl = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) { sl[i * 2] = slot % 16; sl[i * 2 + 1] = Math.floor(slot / 16); }
    tg.setAttribute('aslot', new THREE.BufferAttribute(sl, 2));
    tg.setIndex(new THREE.BufferAttribute(d.terrain.index, 1));
    tg.computeBoundingSphere();
    this.addMesh(t, tg, this.mats.terrain, { receive: true });
    // buildings
    const bg = geoFrom(d.buildings, 'bA', 4);
    if (bg) this.addMesh(t, bg, this.mats.building, { cast: d.lod === 0, receive: true });
    if (d.lod === 0) {
      const gg = geoFrom(d.ground, 'surf', 1); if (gg) this.addMesh(t, gg, this.mats.ground, { receive: true });
      const mg = geoFrom(d.markings, 'surf', 1); if (mg) this.addMesh(t, mg, this.mats.mark, { receive: true });
      const sg = geoFrom(d.struct, 'surf', 1); if (sg) this.addMesh(t, sg, this.mats.struct, { cast: true, receive: true });
      this.addTrees(t, d.trees);
      this.addLamps(t, d.lamps);
      this.addSigns(t, d.signs);
      this.registerCollision(t);
    }
    this.scene.add(t.group);
    this.tiles.set(d.key, t);
    this.loaded++;
    for (const f of this.listeners) f('load', t);
  }
  addMesh(t, geo, mat, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = this.shadows && !!o.cast; m.receiveShadow = this.shadows && !!o.receive;
    m.matrixAutoUpdate = false;
    t.group.add(m);
    return m;
  }
  addTrees(t, tr) {
    const n = tr.length / 4; if (!n) return;
    const crowns = new THREE.InstancedMesh(this.crownGeo, this.mats.crown, n);
    const trunks = new THREE.InstancedMesh(this.trunkGeo, this.mats.trunk, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    t.trees = [];
    for (let i = 0; i < n; i++) {
      const x = tr[i * 4], y = tr[i * 4 + 1], z = tr[i * 4 + 2], code = tr[i * 4 + 3];
      const kind = Math.floor(code % 10), hTag = Math.floor(code / 10);
      const r = hash(x * 13.1 + z * 7.7);
      let H = kind === 1 ? 11 + r * 8 : kind === 2 ? 5 + r * 4 : kind === 3 ? 9 + r * 6 : 8 + r * 6;
      if (hTag > 2) H = hTag;
      const cw = H * (0.28 + r * 0.1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
      m.compose(p.set(x, y + H - cw * 0.95, z), q, s.set(cw, cw * 1.05, cw)); crowns.setMatrixAt(i, m);
      m.compose(p.set(x, y - 0.2, z), q, s.set(1 + H / 14, H - cw * 1.2, 1 + H / 14)); trunks.setMatrixAt(i, m);
      t.trees.push([x + t.data.ox, z + t.data.oz, H]);
    }
    crowns.castShadow = trunks.castShadow = this.shadows;
    crowns.receiveShadow = this.shadows;
    crowns.computeBoundingSphere(); trunks.computeBoundingSphere();
    t.group.add(crowns, trunks);
  }
  addLamps(t, lp) {
    const n = lp.length / 4; if (!n) return;
    const im = new THREE.InstancedMesh(this.lampGeo, this.mats.lamp, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    t.lamps = [];
    for (let i = 0; i < n; i++) {
      const x = lp[i * 4], y = lp[i * 4 + 1], z = lp[i * 4 + 2], a = lp[i * 4 + 3];
      // arm points towards the road: local -x arm; heading a = direction from lamp to road
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI);
      m.compose(p.set(x, y, z), q, s); im.setMatrixAt(i, m);
      t.lamps.push([x + t.data.ox - Math.cos(a) * -1.2, y + 7.3, z + t.data.oz - Math.sin(a) * -1.2]);
    }
    im.computeBoundingSphere();
    t.group.add(im);
  }
  addSigns(t, signs) {
    const S = signs.data, n = S.length / 7; if (!n || !this.signAtlas) return;
    t.signs = [];
    const pos = [], uvs = [], nor = [];
    for (let i = 0; i < n; i++) {
      const x0 = S[i * 7], z0 = S[i * 7 + 1], x1 = S[i * 7 + 2], z1 = S[i * 7 + 3], base = S[i * 7 + 4];
      const cat = S[i * 7 + 6];
      const uvr = this.signAtlas.alloc(signs.text[i], cat);
      if (!uvr) continue;
      t.signs.push(uvr.slot);
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.5) continue;
      const nx = dz / l, nz = -dx / l; // outward for CCW rings
      const off = 0.12, y0 = t.data.hmin + base + 2.95, y1 = y0 + 0.75;
      const a = [x0 + nx * off, y0, z0 + nz * off], b = [x1 + nx * off, y0, z1 + nz * off], c = [x1 + nx * off, y1, z1 + nz * off], d = [x0 + nx * off, y1, z0 + nz * off];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const [u0, v0, u1, v1] = uvr.uv;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const m = new THREE.Mesh(g, this.signAtlas.material);
    t.group.add(m);
  }
  registerCollision(t) {
    const b = t.data.buildings; const col = b.col, P = b.colPts;
    t.col = { col, P };
    for (let i = 0; i < col.length / 4; i++) {
      const s = col[i * 4], n = col[i * 4 + 1];
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let k = 0; k < n; k++) { const x = P[(s + k) * 2], z = P[(s + k) * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let cx = Math.floor(x0 / 32); cx <= Math.floor(x1 / 32); cx++) for (let cz = Math.floor(z0 / 32); cz <= Math.floor(z1 / 32); cz++) {
        const k = cx * 65536 + cz; let l = this.colGrid.get(k); if (!l) this.colGrid.set(k, l = []); l.push(t.key, i);
      }
    }
  }
  unregisterCollision(t) {
    if (!t.col) return;
    for (const [k, l] of this.colGrid) {
      let j = 0; for (let i = 0; i < l.length; i += 2) if (l[i] !== t.key) { l[j++] = l[i]; l[j++] = l[i + 1]; }
      l.length = j; if (!j) this.colGrid.delete(k);
    }
  }
  // iterate building footprints near (x,z): cb(points Float32Array, start, n, top, base)
  buildingsNear(x, z, r, cb) {
    const seen = new Set();
    for (let cx = Math.floor((x - r) / 32); cx <= Math.floor((x + r) / 32); cx++) for (let cz = Math.floor((z - r) / 32); cz <= Math.floor((z + r) / 32); cz++) {
      const l = this.colGrid.get(cx * 65536 + cz); if (!l) continue;
      for (let i = 0; i < l.length; i += 2) {
        const id = l[i] + ':' + l[i + 1]; if (seen.has(id)) continue; seen.add(id);
        const t = this.tiles.get(l[i]); if (!t || !t.col) continue;
        const c = t.col.col, bi = l[i + 1];
        if (cb(t.col.P, c[bi * 4], c[bi * 4 + 1], c[bi * 4 + 2], c[bi * 4 + 3]) === false) return;
      }
    }
  }
  insideBuilding(x, z, y = -1e9) {
    let hit = null;
    this.buildingsNear(x, z, 1, (P, s, n, top, base) => {
      if (y > top) return;
      if (pointInRing(P, s, n, x, z)) { hit = { top, base }; return false; }
    });
    return hit;
  }
  tileAt(x, z) { return this.tiles.get(this.key(Math.floor(x / TILE), Math.floor(z / TILE))); }
  // terrain height (matches LOD0 terrain triangles) or null when not loaded
  terrain(x, z) {
    const t = this.tileAt(x, z); if (!t) return null;
    const H = t.data.heights, lx = x - t.data.ox, lz = z - t.data.oz;
    const gx = Math.max(0, Math.min(NT - 1.0001, lx / 4)), gz = Math.max(0, Math.min(NT - 1.0001, lz / 4));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    const h00 = H[j * NT + i], h10 = H[j * NT + i + 1], h01 = H[(j + 1) * NT + i], h11 = H[(j + 1) * NT + i + 1];
    return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  }
  landcover(x, z) {
    const t = this.tileAt(x, z); if (!t) return 0;
    const lx = Math.floor((x - t.data.ox) / 2), lz = Math.floor((z - t.data.oz) / 2);
    return t.data.lc[Math.min(127, Math.max(0, lz)) * 128 + Math.min(127, Math.max(0, lx))];
  }
  // walkable/drivable surface height near current y (handles bridges/flyovers)
  ground(x, z, curY = null) {
    const g = this.terrain(x, z);
    const c = this.landcover(x, z);
    const lift = c === 2 || c === 12 ? 0.17 : c === 1 ? 0.05 : c === 10 ? 0.07 : 0;
    let y = g == null ? null : g + lift;
    const decks = this.net.decks(x, z, this._decks || (this._decks = []));
    if (decks.length) {
      const ref = curY == null ? (y ?? 0) : curY;
      let best = y, bd = y == null ? 1e9 : Math.abs(ref - y);
      for (const d of decks) { const dd = Math.abs(ref - d); if (dd < bd && d < ref + 1.6) { bd = dd; best = d; } }
      if (curY == null && decks.length) best = y; // spawn on ground by default
      y = best;
    }
    return y;
  }
  unload(k) {
    const t = this.tiles.get(k); if (!t) return;
    this.disposeTile(t, false);
    this.tiles.delete(k);
    for (const f of this.listeners) f('unload', t);
  }
  disposeTile(t, keepSlot) {
    this.scene.remove(t.group);
    t.group.traverse(o => { if (o.isMesh && o.geometry !== this.crownGeo && o.geometry !== this.trunkGeo && o.geometry !== this.lampGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    if (t.signs && this.signAtlas) for (const s of t.signs) this.signAtlas.free(s);
    this.unregisterCollision(t);
    if (!keepSlot && t.slot != null) this.freeSlots.push(t.slot);
  }
}

export function pointInRing(P, s, n, x, z) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = P[(s + i) * 2], zi = P[(s + i) * 2 + 1], xj = P[(s + j) * 2], zj = P[(s + j) * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function hash(x) { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); }
function geoFrom(o, name, size) {
  if (!o || !o.count) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(o.uv, 2));
  if (o.extra) g.setAttribute(name, new THREE.BufferAttribute(o.extra, size));
  g.computeBoundingSphere();
  return g;
}
export function mergeGeos(list) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(list[0].attributes)) {
    const arrs = list.map(g => g.attributes[name].array), size = list[0].attributes[name].itemSize;
    const total = arrs.reduce((a, b) => a + b.length, 0), arr = new Float32Array(total);
    let o = 0; for (const a of arrs) { arr.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
