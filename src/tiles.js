// Streams 256 m world tiles around a focus point in two LOD rings and keeps the
// collision / ground-height data the simulation needs for loaded tiles.
import * as THREE from 'three/webgpu';
import { atlasData, atlasTex, ATLAS_N } from './env.js';
import { terrainMaterial, groundMaterial, markingMaterial, structMaterial, buildingMaterial, treeMaterials, lampMaterial, waterMaterial } from './materials.js';
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
      terrain: terrainMaterial(), ground: groundMaterial(), mark: markingMaterial(), struct: structMaterial(), water: waterMaterial(),
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
        pav: net.pav, lanesF: net.lanesF, lanesB: net.lanesB, cutA: net.cutA, cutB: net.cutB, ctrlA: net.ctrlA, ctrlB: net.ctrlB,
        classes: net.classes, crossings: net.crossings, ea: net.ea, eb: net.eb, rise: net.rise, addedBridges: net.addedBridges,
        shoulder: net.shoulder, strip: net.strip, barriers: net.barriers,
        slabs: [...(net.slabRange || new Map())].flatMap(([e, rs]) => rs.flatMap(r => [e, r[0], r[1]])), connector: net.connector,
        bays: (net.busBays || []).flatMap(b => [b.e, b.s, b.side, b.laneW, b.served ? 1 : 0]),
        approaches: net.controllers.flatMap(c => c.approaches.map(a => [a[0], a[1], a[2]])),
        driveCls: net.classes.map((c, i) => [c, i]).filter(([c]) => !/footway|path|pedestrian|steps|cycleway|bridleway|corridor/.test(c)).map(([, i]) => i),
        platforms: opts.platforms || [], railLines: opts.railLines || [],
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
    this.bushGeo = crownGeometry(16);   // shrubs and hedge bushes (tileWorker plantings), same leaf material; few cards: there are thousands
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
    this.lampHeadGeo = parts[2];
  }
  key(ix, iz) { return ix + '_' + iz; }
  // look: optional { x, z } camera forward (unit) and { vx, vz } travel velocity (m/s) for look-ahead priority
  update(fx, fz, look = null) {
    this.fx = fx; this.fz = fz;
    this.drain(this.drainMs ?? 4);
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
  // A finished tile from a worker. Building it into meshes takes the main thread a few milliseconds, and several can
  // arrive within one frame when moving fast (the stutter when driving), so they wait in a queue and the frame
  // loop adds them a few milliseconds' worth at a time, nearest first (drain()). While no frames are running (the
  // start menu) they go straight in, as before.
  onResult(d) {
    this.inflight--;
    if (d.error) { if (this.pending.get(d.key) === d.lod) this.pending.delete(d.key); this.errors++; console.error('tile', d.key, d.error); return; }
    if (performance.now() - (this.lastDrain || 0) > 150) { this.apply(d); return; }
    (this.ready ||= []).push(d);
  }
  drain(budgetMs = 4) {
    this.lastDrain = performance.now();
    const q = this.ready; if (!q || !q.length) return;
    const t0 = performance.now(), fx = this.fx, fz = this.fz, dist = d => Math.hypot(d.ox + 128 - fx, d.oz + 128 - fz);
    q.sort((a, b) => (a.lod - b.lod) || dist(a) - dist(b));
    // (all at once while the ground under you is still missing)
    const budget = this.tiles.size < 6 ? 60 : budgetMs;
    let n = 0;
    while (q.length && (n === 0 || performance.now() - t0 < budget)) { this.apply(q.shift()); n++; }
  }
  apply(d) {
    if (this.pending.get(d.key) === d.lod) this.pending.delete(d.key);
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
    this.addMesh(t, tg, this.mats.terrain, { receive: true }).name = 'terrain';
    // buildings
    const bg = geoFrom(d.buildings, 'bA', 4);
    if (bg) this.addMesh(t, bg, this.mats.building, { cast: d.lod === 0, receive: true }).name = 'buildings';
    // open water: a surface over the carved bed (lakes, rivers, brooks), drawn after the opaque world
    if (d.water) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(d.water.position, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(d.water.position.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
      wg.setAttribute('wDepth', new THREE.BufferAttribute(d.water.depth, 1));
      wg.setIndex(new THREE.BufferAttribute(d.water.index, 1));
      wg.computeBoundingSphere();
      const wm = this.addMesh(t, wg, this.mats.water, { receive: true });
      wm.renderOrder = 1;
    }
    if (d.lod === 0) {
      const gg = geoFrom(d.ground, 'surf', 1); if (gg) this.addMesh(t, gg, this.mats.ground, { receive: true }).name = 'ground';
      const mg = geoFrom(d.markings, 'surf', 1); if (mg) this.addMesh(t, mg, this.mats.mark, { receive: true }).name = 'markings';
      const sg = geoFrom(d.struct, 'surf', 1); if (sg) t.structMesh = this.addMesh(t, sg, this.mats.struct, { cast: this.budget?.shadow?.props !== false, receive: true });
      this.addTrees(t, d.trees);

      if (d.bushes && d.bushes.length) this.addBushes(t, d.bushes);
      this.addSigns(t, d.signs);
      this.registerCollision(t);
      // road segments this tile carries on a deck over sagging ground (tileWorker.js): ground() rides on them
      if (d.decks && d.decks.length && this.net) { const m = this.net.sagDeck || (this.net.sagDeck = new Map()); for (const j of d.decks) m.set(j, (m.get(j) || 0) + 1); }
    }
    this.addLamps(t,d.lamps || []);
    this.scene.add(t.group);
    this.tiles.set(d.key, t); (this.byNum ||= new Map()).set(d.ix * 100003 + d.iz, t); this._lt = null;
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
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    // half-tints (shader multiplies by 2): oak, lime, plane, copper beech, yew
    const PAL = [[0.48, 0.52, 0.40], [0.56, 0.58, 0.36], [0.50, 0.55, 0.42], [0.64, 0.36, 0.32], [0.30, 0.42, 0.32]];
    t.trees = [];
    for (let i = 0; i < n; i++) {
      const x = tr[i * 4], y = tr[i * 4 + 1], z = tr[i * 4 + 2], code = tr[i * 4 + 3];
      const kind = Math.floor(code % 10), hTag = Math.floor(code / 10);
      const r = hash(x * 13.1 + z * 7.7);
      let H = kind === 1 ? 11 + r * 8 : kind === 2 ? 5 + r * 4 : kind === 3 ? 9 + r * 6 : 8 + r * 6;
      if (hTag > 2) H = hTag;
      const si = kind === 1 ? (r < 0.45 ? 2 : 1) : kind === 2 ? (r < 0.22 ? 3 : 0) : kind === 3 ? 4 : (r < 0.12 ? 3 : 0);
      const cw = H * (si === 4 ? 0.22 + r * 0.05 : 0.30 + r * 0.1);
      let sx = cw, sy = cw * (si === 4 ? 1.55 : si === 1 ? 0.86 : 1.02), sz = cw * (si === 1 ? 1.14 : 1);
      if (kind === 2) { sx *= 1.18; sy *= 0.78; sz *= 1.18; }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
      m.compose(p.set(x, y + H - sy * 0.9, z), q, s.set(sx, sy, sz)); crowns.setMatrixAt(i, m);
      const trunkH = Math.max(1.1, H - sy * (si === 4 ? 0.55 : 1.05));
      m.compose(p.set(x, y - 0.15, z), q, s.set(0.85 + H / 18, trunkH, 0.85 + H / 18)); trunks.setMatrixAt(i, m);
      col.setRGB(PAL[si][0], PAL[si][1], PAL[si][2]);
      crowns.setColorAt(i, col);
      t.trees.push([x + t.data.ox, z + t.data.oz, H]);
    }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    crowns.castShadow = trunks.castShadow = this.shadows && this.budget?.shadow?.trees !== false;
    crowns.receiveShadow = this.shadows;
    crowns.computeBoundingSphere(); trunks.computeBoundingSphere();
    t.group.add(crowns, trunks);
    t.treeMesh = { crowns, trunks };   // breakables.js topples young trees by rewriting their instances
  }
  // shrubs and leafy hedges: [x, y, z, sx, sy, sz, yaw, tint] from the worker; tints as for tree species
  addBushes(t, b) {
    const n = b.length / 8, q = this.budget?.bushes ?? 1;
    const keep = q >= 1 ? n : Math.floor(n * q); if (!keep) return;
    const im = new THREE.InstancedMesh(this.bushGeo, this.mats.crown, keep);
    t.bushMesh = im; t.bushPos = [];
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    // half-tints: shrub green, fresh green, dark privet/laurel (hedges), copper-leaved, gorse, flowering
    const PAL = [[0.46, 0.54, 0.38], [0.58, 0.64, 0.38], [0.36, 0.48, 0.32], [0.6, 0.42, 0.34], [0.72, 0.68, 0.3], [0.7, 0.46, 0.5]];   // + gorse yellow, blossom pink
    let k = 0;
    for (let i = 0; i < n && k < keep; i++) {
      if (q < 1 && b[i * 8 + 7] !== 2 && (i * 0.6180339887 % 1) > q) continue;
      p.set(b[i * 8], b[i * 8 + 1], b[i * 8 + 2]);   // tile-local, like the trees (the group carries the tile offset)
      qq.setFromAxisAngle(up, -b[i * 8 + 6]);
      m.compose(p, qq, s.set(b[i * 8 + 3] * 0.5, b[i * 8 + 4], b[i * 8 + 5] * 0.5));
      im.setMatrixAt(k, m);
      // breakables.js flattens shrubs a car drives through: world x, z, radius, instance
      t.bushPos.push(p.x + t.data.ox, p.z + t.data.oz, Math.max(b[i * 8 + 3], b[i * 8 + 5]) * 0.42, k);
      const c = PAL[b[i * 8 + 7] | 0] || PAL[0], v = 0.9 + ((i * 0.754877666) % 1) * 0.2;
      im.setColorAt(k, col.setRGB(c[0] * v, c[1] * v, c[2] * v));
      k++;
    }
    im.count = k;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // shrubs only cast shadows on high quality (GTAO grounds them otherwise): the shadow pass doubles their cost
    im.castShadow = this.shadows && q >= 1; im.receiveShadow = true;
    im.computeBoundingSphere();
    t.group.add(im);
  }
  addLamps(t, lp) {
    const n = lp.length / 4; if (!n) return;
    const im = new THREE.InstancedMesh(t.lod ? this.lampHeadGeo : this.lampGeo, this.mats.lamp, n);
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
    t.lampMesh = im;
  }
  addSigns(t, signs) {
    const S = signs.data, n = Math.floor(S.length / 7); if (!n || !this.signAtlas) return;
    t.signs = [];
    const pos = [], uvs = [], nor = [];
    const push = (a, b, c, d, uv, nm) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const [u0, v0, u1, v1] = uv;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      for (let k = 0; k < 6; k++) nor.push(nm[0], nm[1], nm[2]);
    };
    for (let i = 0; i < n; i++) {
      const x0 = S[i * 7], z0 = S[i * 7 + 1], x1 = S[i * 7 + 2], z1 = S[i * 7 + 3];
      const base = S[i * 7 + 4], dy = S[i * 7 + 5], h = S[i * 7 + 6];
      if (!(h > 0.15)) continue;
      const uvr = this.signAtlas.alloc(signs.text[i]);
      if (!uvr) continue;
      t.signs.push(uvr.slot);
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.4) continue;
      const tx = dx / l, tz = dz / l, nx = dz / l, nz = -dx / l;
      const off = 0.08, th = 0.05;
      const y0 = t.data.hmin + base + dy, y1 = y0 + h;
      const P = (s, o, y) => [x0 + tx * s + nx * o, y, z0 + tz * s + nz * o];
      const [u0, v0, u1, v1] = uvr.uv;
      const face = uvr.uv;
      const solid = [u0 + 0.0008, v0 + 0.0008, u0 + 0.0012, v0 + 0.0012];
      // winding A-B-C faces back into the wall; the street side is B-A-D
      const o = off + th;
      // the name keeps the painted board's shape (8:1) in the middle; the board's own colour carries on to
      // either end of a longer fascia (it was stretched to fit, and squashed on a narrow one)
      const front = (sa, sb, ya, yb, ua, va, ub, vb) => {
        const A = P(sa, o, ya), B = P(sb, o, ya), C = P(sb, o, yb), D = P(sa, o, yb);
        pos.push(...B, ...A, ...D, ...B, ...D, ...C);
        uvs.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
        for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
      };
      const ASP = 8, eu = 1 / 2048, ev = 1 / 4096;
      let tw = Math.min(l, h * ASP), hp = h;
      if (l < h * 6) { hp = l / 6; tw = l; }
      const s0 = (l - tw) / 2, s1 = s0 + tw, ym0 = y0 + (h - hp) / 2, ym1 = ym0 + hp;
      front(s0, s1, ym0, ym1, u0, v0, u1, v1);
      if (s1 < l - 1e-3) front(s1, l, ym0, ym1, u0 + eu, v0, u0 + eu, v1);
      if (s0 > 1e-3) front(0, s0, ym0, ym1, u1 - eu, v0, u1 - eu, v1);
      if (ym0 > y0 + 1e-3) { front(0, l, y0, ym0, u0 + eu, v0 + ev, u0 + eu, v0 + ev); front(0, l, ym1, y1, u0 + eu, v1 - ev, u0 + eu, v1 - ev); }
      push(P(l, off, y0), P(0, off, y0), P(0, off, y1), P(l, off, y1), solid, [-nx, 0, -nz]);
      push(P(0, off, y1), P(l, off, y1), P(l, o, y1), P(0, o, y1), solid, [0, 1, 0]);
      push(P(0, o, y0), P(l, o, y0), P(l, off, y0), P(0, off, y0), solid, [0, -1, 0]);
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
  // (by number, and the last one found first: thousands of height lookups a frame used to build a string key each)
  tileAt(x, z) {
    const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE), lt = this._lt;
    if (lt && lt.ix === ix && lt.iz === iz) return lt;
    const t = this.byNum?.get(ix * 100003 + iz); if (t) this._lt = t;
    return t;
  }
  // terrain height (matches LOD0 terrain triangles) or null when not loaded
  terrain(x, z) {
    const t = this.tileAt(x, z); if (!t) return null;
    const H = t.data.heights, lx = x - t.data.ox, lz = z - t.data.oz;
    const gx = Math.max(0, Math.min(NT - 1.0001, lx / 4)), gz = Math.max(0, Math.min(NT - 1.0001, lz / 4));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    const h00 = H[j * NT + i], h10 = H[j * NT + i + 1], h01 = H[(j + 1) * NT + i], h11 = H[(j + 1) * NT + i + 1];
    return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  }
  // water surface level at (x, z) in m, or null where there is no open water (tile level grid, 4 m)
  waterLevel(x, z) {
    const t = this.tileAt(x, z); if (!t || !t.data.wl) return null;
    const W = t.data.wl, lx = x - t.data.ox, lz = z - t.data.oz;
    const gx = Math.max(0, Math.min(NT - 1.0001, lx / 4)), gz = Math.max(0, Math.min(NT - 1.0001, lz / 4));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    let s = 0, w = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const v = W[(j + b) * NT + i + a]; if (v === 32767) continue;
      const k = (a ? fu : 1 - fu) * (b ? fv : 1 - fv) + 1e-4; s += v * k; w += k;
    }
    if (!w) return null;
    // only where the landcover says water (the grid's level extends a little under the banks)
    return this.landcover(x, z) === 4 || this.landcover(x + 2, z) === 4 || this.landcover(x - 2, z) === 4 || this.landcover(x, z + 2) === 4 || this.landcover(x, z - 2) === 4 ? s / w / 100 : null;
  }
  // depth of water over the ground at (x, z) (0 on dry land)
  waterDepth(x, z, curY = null) {
    const l = this.waterLevel(x, z); if (l == null) return 0;
    const g = this.ground(x, z, curY); return g == null ? 0 : Math.max(0, l - g);
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
    if (this.extraDecks) this.extraDecks(x, z, decks);   // station platforms (stations.js)
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
    this.tiles.delete(k); { const [ix, iz] = k.split('_').map(Number); this.byNum?.delete(ix * 100003 + iz); } this._lt = null;
    for (const f of this.listeners) f('unload', t);
  }
  disposeTile(t, keepSlot) {
    this.scene.remove(t.group);
    t.group.traverse(o => { if (o.isMesh && o.geometry !== this.crownGeo && o.geometry !== this.trunkGeo && o.geometry !== this.lampGeo && o.geometry !== this.lampHeadGeo && o.geometry !== this.bushGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    if (t.signs && this.signAtlas) for (const s of t.signs) this.signAtlas.free(s);
    this.unregisterCollision(t);
    if (t.lod === 0 && t.data.decks && this.net && this.net.sagDeck) for (const j of t.data.decks) { const n = (this.net.sagDeck.get(j) || 0) - 1; if (n > 0) this.net.sagDeck.set(j, n); else this.net.sagDeck.delete(j); }
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
