// Performance: quality budgets, render-cost control (static batching, distance culling) and
// the frame-time / stall / memory recorder with a scripted flythrough.
// Budgets are design targets for the Honor Magic 6 Pro (30 fps); they are NOT measurements.
// The recorder output (perf-*.json) is what turns them into real device numbers.
import * as THREE from 'three/webgpu';

// ------------------------------------------------------------------ quality budgets
// r0/r1: LOD0 / LOD1 streaming radii (m). tiles: soft cap on loaded tiles. drawCalls / tris: per-frame
// targets including the shadow pass. people / vehicles: simulated actor caps. cloudSteps: sky raymarch
// steps. pixelRatio: [min, start, max] for dynamic resolution without post. fsr/outPr/scale: with post-processing the canvas
// runs at min(devicePixelRatio, outPr) and the scene renders at scale [min, start, max] of that, upscaled by FSR 1. shadow: map size and half-extent (m) of the
// sun's shadow box (0 = off). *Dist: draw distance (m) for per-tile detail meshes.
// Look (post.js, grass.js): post = scene pass + FXAA; ao = GTAO resolution scale and samples (0 = off);
// bloom = strength (0 = off); ibl = sky PMREM cube size (0 = off); grass = blades near the camera;
// ssr = screen-space reflections {scale, quality} (null = off).
// Streaming (v0.34, as GTA San Andreas does it): full detail only near you (r0), cheap stand-ins (terrain every 16 m,
// box buildings) out to r1, and a haze that thickens over the last stretch so the edge of the loaded world melts
// into the sky instead of being drawn (main.js fog). Medium used to keep ~60 tiles in (1.1 km out); now ~25.
// v0.33 targets: low 720p at 60 fps, medium 1080p at 60 fps, high 1440p ('2K') at 30 fps with the richest image.
// outH: the output (canvas) height in pixels (the phone's short side, so a 2400x1080 screen shows medium at its own
// resolution); with FSR the 3D scene renders at `scale` of that and is upscaled, moved by the frame-time controller.
// vehicles: moving traffic within `bubble` m of the player (parked cars are on top, at `parkFill` of the slots);
// people: pedestrians. Medium has no GTAO (a full-screen pass a phone GPU can't afford at 60) and a tighter shadow box.
export const BUDGETS = {
  // v0.36, the happy medium. Low: 720p up to the screen's refresh rate (120 Hz phones: 120 fps); the sun casts
  // shadows from people, the brothers and their cars only (a small map round you, redrawn every other frame: a few
  // draw calls) and a tiny sky cube gives paint and glass their reflections. Medium: 1080p at 60 with FSR from a
  // lower internal resolution, and a cheap sun shadow: a tight 40 m box round you, cast by buildings, people and the
  // brothers (not trees, shrubs, street clutter or traffic, which keep their contact shadows), redrawn every other
  // frame; sky reflections from a small cube refreshed every 20 s. High: the screen's full resolution (up to 4K) at
  // 30 with everything. Real lights (each paid for by every lit pixel) stay High only. vehicles: moving cars;
  // parkedMax: parked cars, kept to a handful (the moving traffic is what fills the streets); people: pedestrians
  // (the crowd is one instanced draw per level of detail, so these are cheap to draw; v0.40 raised them by about
  // two-thirds, 75 / 130 / 200, so the streets aren't empty).
  low: {
    r0: 220, r1: 480, tiles: 26, drawCalls: 110, tris: 250e3, people: 75, vehicles: 16, parkedMax: 3, bubble: 360, parkFill: 0.08, cloudSteps: 6,
    outH: 720, pixelRatio: [0.8, 1.0, 1.25], shadow: { size: 1024, extent: 24, far: 400, every: 2, buildings: false, trees: false, props: false, traffic: false }, antialias: false,
    treeDist: 160, lampDist: 140, signDist: 100, markDist: 200, vehicleDist: 300, peopleDist: 90,
    post: false, ao: { scale: 0, samples: 0 }, bloom: 0, ibl: 16, iblEvery: 30, grass: false, ssr: null, targetFps: 120, bushes: 0.25,
  },
  medium: {
    r0: 260, r1: 650, tiles: 38, drawCalls: 170, tris: 450e3, people: 130, vehicles: 30, parkedMax: 6, bubble: 420, parkFill: 0.1, cloudSteps: 8,
    outH: 1080, pixelRatio: [0.7, 1.15, 1.35], shadow: { size: 1024, extent: 40, far: 450, every: 2, trees: false, props: false, traffic: false }, antialias: true, fsr: true, outPr: 2.0, scale: [0.5, 0.62, 0.85],
    treeDist: 220, lampDist: 200, signDist: 150, markDist: 300, vehicleDist: 380, peopleDist: 120,
    post: true, ao: { scale: 0, samples: 0 }, bloom: 0.18, ibl: 32, iblEvery: 20, grass: false, ssr: null, targetFps: 60, bushes: 0.45,
  },
  high: {
    r0: 380, r1: 950, tiles: 70, drawCalls: 320, tris: 900e3, people: 200, vehicles: 50, parkedMax: 12, bubble: 540, parkFill: 0.15, cloudSteps: 16,
    outH: 2160, pixelRatio: [0.8, 1.5, 1.5], shadow: { size: 2048, extent: 100, far: 600 }, antialias: true, fsr: true, outPr: 2.0, scale: [0.55, 0.8, 1.0],
    treeDist: 480, lampDist: 360, signDist: 260, markDist: 480, vehicleDist: 650, peopleDist: 170,
    post: true, ao: { scale: 0.5, samples: 10 }, bloom: 0.3, ibl: 64, iblEvery: 8, grass: true, ssr: { scale: 0.4, quality: 0.35 }, targetFps: 30, bushes: 1,
  },
};
// the canvas pixel ratio for a budget's output height on this screen (never above the device's own)
export function outputRatio(budget, w = innerWidth, h = innerHeight, dpr = devicePixelRatio) {
  const short = Math.max(1, Math.min(w, h));
  return Math.min(dpr || 1, Math.max(0.5, (budget.outH || 1080) / short));
}
export function budgetFor(q) { return BUDGETS[q] || BUDGETS.medium; }

// ------------------------------------------------------------------ geometry merging
// Merge geometries (each with an optional translation) into one. Only attributes present in every
// input are kept; indexed and non-indexed inputs are both handled.
export function mergeGeometries(items) {
  if (!items.length) return null;
  const names = Object.keys(items[0].geo.attributes).filter(n => items.every(it => it.geo.attributes[n] && it.geo.attributes[n].itemSize === items[0].geo.attributes[n].itemSize));
  const indexed = items.every(it => it.geo.index);
  const src = indexed ? items : items.map(it => ({ ...it, geo: it.geo.index ? it.geo.toNonIndexed() : it.geo }));
  const out = new THREE.BufferGeometry();
  let nv = 0; for (const it of src) nv += it.geo.attributes.position.count;
  for (const n of names) {
    const size = src[0].geo.attributes[n].itemSize, arr = new Float32Array(nv * size);
    let o = 0;
    for (const it of src) {
      const a = it.geo.attributes[n];
      if (n === 'position' && it.m) {
        const v = new THREE.Vector3();
        for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(it.m); arr[o + i * 3] = v.x; arr[o + i * 3 + 1] = v.y; arr[o + i * 3 + 2] = v.z; }
      } else if (n === 'normal' && it.m) {
        const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(it.m);
        for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix3(nm).normalize(); arr[o + i * 3] = v.x; arr[o + i * 3 + 1] = v.y; arr[o + i * 3 + 2] = v.z; }
      } else if (n === 'position' && (it.dx || it.dz)) {
        arr.set(a.array.subarray(0, a.count * 3), o);
        for (let i = 0; i < a.count; i++) { arr[o + i * 3] += it.dx || 0; arr[o + i * 3 + 2] += it.dz || 0; }
      } else arr.set(a.array.subarray(0, a.count * size), o);
      o += a.count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  if (indexed) {
    let ni = 0; for (const it of src) ni += it.geo.index.count;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, base = 0;
    for (const it of src) { const I = it.geo.index.array; for (let i = 0; i < it.geo.index.count; i++) idx[o + i] = I[i] + base; o += it.geo.index.count; base += it.geo.attributes.position.count; }
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  out.computeBoundingSphere();
  return out;
}

// ------------------------------------------------------------------ render budget
// Cuts draw calls without touching tile generation:
//  * LOD1 buildings are batched into one mesh per 4x4-tile cluster (1 km²).
//  * Hand-authored canopies and bus shelters (many small meshes) are baked into one mesh per
//    material per 512 m cell.
//  * Per-tile trees, lamps, signs and markings are hidden beyond the preset's draw distance.
//  * LOD1 tiles outside the view frustum are skipped as whole groups (they cast no shadows).
//  * Empty instanced meshes are hidden so they cost no draw call.
const CLUSTER = 4, TILE = 256;
const EMPTY_GEO = new THREE.BufferGeometry();
export class RenderBudget {
  constructor(G) {
    this.G = G; this.B = budgetFor(G.quality);
    this.clusters = new Map();     // key -> { members: Map(tileKey -> mesh), batch, dirtyAt, ox, oz }
    this.canopyBuckets = new Map(); this._canopyN = -1;
    this.stats = { lod1Batches: 0, lod1Tiles: 0, canopyMeshes: 0, canopyBatches: 0, mergeMs: 0 };
    this.enabled = !G.Q.has('nobatch');
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere(); this._v = new THREE.Vector3();
    G.tiles.listeners.push((ev, t) => this.onTile(ev, t));
  }
  clusterKey(t) { const [ix, iz] = t.key.split('_').map(Number); const cx = Math.floor(ix / CLUSTER), cz = Math.floor(iz / CLUSTER); return [cx + '_' + cz, cx * CLUSTER * TILE, cz * CLUSTER * TILE]; }
  onTile(ev, t) {
    if (!this.enabled) return;
    const [ck, ox, oz] = this.clusterKey(t);
    let c = this.clusters.get(ck);
    // any load replaces whatever this tile key contributed before (LOD changes don't fire 'unload')
    if (c && c.members.has(t.key)) { c.members.delete(t.key); this.invalidate(c); }
    if (ev !== 'load' || t.lod !== 1) return;
    const mesh = t.group.children.find(m => m.isMesh && m.material === this.G.tiles.mats.building);
    if (!mesh) return;
    if (!c) this.clusters.set(ck, c = { key: ck, members: new Map(), batch: null, dirtyAt: 0, ox, oz });
    c.members.set(t.key, { mesh, t });
    c.dirtyAt = performance.now();
  }
  invalidate(c) {
    // the batch holds geometry of a tile that left: show members individually until rebuilt
    if (c.batch) c.batch.visible = false;
    for (const { mesh } of c.members.values()) mesh.visible = true;
    c.dirtyAt = performance.now();
  }
  rebuild(c) {
    const G = this.G, t0 = performance.now();
    const items = [];
    for (const { mesh, t } of c.members.values()) items.push({ geo: mesh.geometry, dx: t.data.ox - c.ox, dz: t.data.oz - c.oz, mesh });
    if (c.batch) { c.batch.geometry.dispose(); c.batch.geometry = EMPTY_GEO; c.batch.visible = false; }
    if (items.length >= 2) {
      const geo = mergeGeometries(items);
      // one mesh object per cluster for its whole life; only the geometry is swapped on rebuild
      let m = c.batch;
      if (!m) {
        m = new THREE.Mesh(geo, G.tiles.mats.building);
        m.position.set(c.ox, 0, c.oz); m.matrixAutoUpdate = false; m.updateMatrix();
        m.castShadow = false; m.userData.k = 'lod1batch';
        G.scene.add(m); c.batch = m;
      } else m.geometry = geo;
      m.receiveShadow = items[0].mesh.receiveShadow; m.visible = true;
      // hide the per-tile meshes (not dispose: disposing a geometry that stays attached to a scene mesh and is
      // shown again later leaked renderer state, ~0.5 MB/s of JS heap during the flythrough)
      for (const it of items) it.mesh.visible = false;
    } else for (const it of items) it.mesh.visible = true;
    c.dirtyAt = 0;
    this.stats.mergeMs = +(performance.now() - t0).toFixed(1);
    if (!c.members.size) { if (c.batch) G.scene.remove(c.batch); this.clusters.delete(c.key); }
  }
  bakeCanopies() {
    const G = this.G, grp = G.landmarks?.group; if (!grp) return;
    if (grp.children.length === this._canopyN) return;
    const keep = new Set(G.landmarks.built ? [...G.landmarks.built.values()] : []);
    const touched = new Set();
    for (const o of [...grp.children]) {
      if (!o.isGroup || keep.has(o) || o.userData.baked) continue;
      if (!o.children.every(m => m.isMesh && !m.isInstancedMesh && m.children.length === 0)) continue;
      o.updateMatrixWorld(true);
      // (a merged cell is drawn whole in the shadow pass as soon as the shadow box touches it: on high, where the
      // canopies cast shadows, the cells are a quarter the size; elsewhere they cast none)
      const CELL = this.G.quality === 'high' ? 256 : 512;
      const cell = Math.floor(o.position.x / CELL) + '_' + Math.floor(o.position.z / CELL);
      for (const m of o.children) {
        const k = cell + '|' + m.material.uuid;
        let b = this.canopyBuckets.get(k); if (!b) this.canopyBuckets.set(k, b = { items: [], mesh: null, material: m.material, cast: false });
        b.items.push({ geo: m.geometry, m: m.matrixWorld.clone() }); b.cast = b.cast || m.castShadow;
        touched.add(k); this.stats.canopyMeshes++;
      }
      grp.remove(o); o.userData.baked = true;
    }
    for (const k of touched) {
      const b = this.canopyBuckets.get(k);
      if (b.mesh) { grp.remove(b.mesh); b.mesh.geometry.dispose(); }
      const geo = mergeGeometries(b.items); if (!geo) continue;
      b.mesh = new THREE.Mesh(geo, b.material); b.mesh.castShadow = b.cast && this.G.quality === 'high'; b.mesh.receiveShadow = true; b.mesh.userData.k = 'canopyBatch';
      b.mesh.matrixAutoUpdate = false; grp.add(b.mesh);
    }
    this.stats.canopyBatches = this.canopyBuckets.size;
    this._canopyN = grp.children.length;
  }
  update() {
    const G = this.G, B = this.B, cam = G.camera.position;
    if (this.enabled) {
      // at most one cluster rebuild per frame, once its membership has been stable for 0.6 s
      const now = performance.now(); let best = null, bd = 1e18;
      for (const c of this.clusters.values()) if (c.dirtyAt && now - c.dirtyAt > 600) { const d = (c.ox - cam.x) ** 2 + (c.oz - cam.z) ** 2; if (d < bd) { bd = d; best = c; } }
      if (best && !this.G.Q.has('nolod1batch')) this.rebuild(best);
      if (now - (this._ct || 0) > 1000 && !this.G.Q.has('nocanopybake')) { this._ct = now; this.bakeCanopies(); }
    }
    this._pm.multiplyMatrices(G.camera.projectionMatrix, G.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._pm);
    const T = G.tiles, mats = T.mats;
    let lod1 = 0, batches = 0;
    for (const t of T.tiles.values()) {
      const cx = t.data.ox + 128, cz = t.data.oz + 128, d = Math.hypot(cx - cam.x, cz - cam.z);
      if (t.lod === 1) {
        lod1++;
        this._sph.center.set(cx, ((t.data.hmin || 0) + 40), cz); this._sph.radius = 200;
        t.group.visible = this.frustum.intersectsSphere(this._sph);
        continue;
      }
      // LOD0 groups stay visible (they cast shadows into view from behind the camera); thin out detail
      for (const m of t.group.children) {
        let lim = 0;
        if (m.geometry === T.crownGeo || m.geometry === T.trunkGeo) lim = B.treeDist;
        else if (m === t.bushMesh) lim = B.treeDist * (B.bushes >= 1 ? 1 : 0.6);
        else if (m.material === mats.mark) lim = B.markDist;
        else if (T.signAtlas && m.material === T.signAtlas.material) lim = B.signDist;
        if (lim) m.visible = d - 181 < lim;
      }
    }
    for (const c of this.clusters.values()) if (c.batch && c.batch.visible !== false) { batches++; }
    this.stats.lod1Tiles = lod1; this.stats.lod1Batches = batches;
  }
}

// ------------------------------------------------------------------ recorder
function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null; }
function avg(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }
export function gpuName(G) {
  try {
    const gl = G.renderer.backend?.gl;
    if (gl) { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
    const info = G.renderer.backend?.adapter?.info; if (info) return [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') || 'WebGPU adapter (no info)';
  } catch { }
  return null;
}
export function summarise(frames) {
  const f = [...frames].sort((a, b) => a - b);
  return { frames: f.length, fps: f.length ? +(1000 / avg(frames)).toFixed(1) : null, p50: pct(f, 0.5) && +pct(f, 0.5).toFixed(1), p95: pct(f, 0.95) && +pct(f, 0.95).toFixed(1), p99: pct(f, 0.99) && +pct(f, 0.99).toFixed(1), worst: f.length ? +f[f.length - 1].toFixed(1) : null, stalls: frames.filter(x => x > 100).length };
}

export class Perf {
  constructor(G) {
    this.G = G; this.frames = []; this.stalls = 0; this.samples = []; this.t0 = performance.now(); this.last = performance.now(); this.acc = 0;
    this.budget = budgetFor(G.quality);
    this.render = new RenderBudget(G);
    this.fly = new Flythrough(G, this);
    // read draw calls / triangles of the previous frame, then reset by hand (three's auto reset runs
    // before our frame code, so the counters would always read 0 here)
    G.renderer.info.autoReset = false; this.lastInfo = { calls: 0, tris: 0 };
  }
  info() { return this.lastInfo; }
  frame(dt) {
    const now = performance.now(), ms = now - this.last; this.last = now;
    const R = this.G.renderer.info; this.lastInfo = { calls: R.render.drawCalls, tris: Math.round(R.render.triangles) }; R.reset();
    this.frames.push(ms); if (this.frames.length > 240) this.frames.shift();
    if (ms > 100) this.stalls++;
    this.fly.record(ms);
    this.acc += dt;
    if (this.acc > 2) {
      this.acc = 0;
      const G = this.G, f = [...this.frames].sort((a, b) => a - b);
      const me = G.brothers?.me, ri = this.info();
      this.samples.push({ t: +((now - this.t0) / 1000).toFixed(1), fps: +(1000 / avg(this.frames)).toFixed(1), p50: +pct(f, 0.5).toFixed(1), p95: +pct(f, 0.95).toFixed(1),
        stalls: this.stalls, calls: ri.calls, tris: ri.tris, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        pr: +G.renderer.getPixelRatio().toFixed(2), tiles: G.tiles.tiles.size, vehicles: G.traffic?.list.length, peds: G.peds?.list.length, x: me ? Math.round(me.x) : null, z: me ? Math.round(me.z) : null, speed: G.brothers ? +(G.brothers.speedNow || 0).toFixed(1) : null });
      if (this.samples.length > 1800) this.samples.shift();
    }
  }
  text() {
    const s = this.samples[this.samples.length - 1] || {}; const G = this.G, b = this.budget;
    const fly = this.fly.active ? ` · flythrough ${(this.fly.progress() * 100).toFixed(0)}%` : '';
    return `${G.backend} · ${G.quality} · ${s.fps ?? '–'} fps · p95 ${s.p95 ?? '–'} ms · stalls ${this.stalls} · draws ${s.calls ?? '–'}/${b.drawCalls} · tris ${s.tris != null ? Math.round(s.tris / 1000) + 'k' : '–'}/${Math.round(b.tris / 1000)}k · heap ${s.heapMB ?? 'n/a'} MB · px ${s.pr ?? '–'} · tiles ${s.tiles ?? '–'} · cars ${s.vehicles ?? '–'} · people ${s.peds ?? '–'}${fly}`;
  }
  device() { const G = this.G; return { userAgent: navigator.userAgent, backend: G.backend, gpu: gpuName(G), quality: G.quality, graphicsPreference: G.choice, gameMode: G.device?.mode, chipset: G.device?.chip, budget: this.budget, devicePixelRatio: devicePixelRatio, screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight], cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory ?? null, version: G.version }; }
  report() { return { kind: 'session', ...this.device(), samples: this.samples, stalls: this.stalls }; }
  save(obj, prefix = 'green-county-perf') {
    const json = JSON.stringify(obj, null, 1);
    try { localStorage.setItem('greenCounty.perf.last', json.length < 2e6 ? json : JSON.stringify({ ...obj, samples: undefined })); } catch { }
    if (window.GCNative && GCNative.savePerf) { const p = GCNative.savePerf(json); this.G.hud.toast('Saved ' + p, 6); return p; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `${prefix}-${Date.now()}.json`; a.click();
    this.G.hud.toast('Perf log downloaded', 4);
    return a.download;
  }
  export() { return this.save(this.report()); }
}

// ------------------------------------------------------------------ scripted flythrough
// Drives a car along a fixed road route (Woodley precinct -> A3290 -> Reading town centre) at a
// steady speed in wall-clock time, so slow devices see the same route in the same time and the
// streaming / simulation load is comparable between runs. Records every frame and saves the log.
export const FLY_ROUTE = [
  { name: 'Woodley precinct', x: -2869, z: -2225 },
  { name: 'A3290', x: -5300, z: -2650, ref: 'A3290' },
  { name: 'Reading town centre', x: -7180, z: -2560 },
];
export class Flythrough {
  constructor(G, perf) { this.G = G; this.perf = perf; this.active = false; this.last = null; }
  buildPath(route = FLY_ROUTE) {
    const G = this.G, net = G.net, drive = e => (net.flags[e] & 16) && !/service|track|path|footway/.test(net.classes[net.cls[e]]);
    const nodes = route.map(w => {
      const f = w.ref ? (e => drive(e) && (net.roadName(e) === w.ref || net.names[net.ref[e]] === w.ref)) : drive;
      const n = net.nearest(w.x, w.z, 400, f) || net.nearest(w.x, w.z, 400, drive);
      return n ? net.eb[n.e] : null;
    });
    if (nodes.some(n => n == null)) return null;
    const legs = [], hs = [];
    for (let i = 0; i + 1 < nodes.length; i++) {
      const r = net.route(nodes[i], nodes[i + 1], { limit: 200000, noService: true });
      if (!r) return null;
      legs.push({ from: route[i].name, to: route[i + 1].name, start: hs.length, n: r.length }); hs.push(...r);
    }
    // polyline in the left-hand lane, sampled every ~3 m
    const pts = [], tmp = [0, 0, 0, 0, 0], legAt = [];
    hs.forEach((h, k) => {
      const L = net.len[h >> 1], off = G.traffic.laneOffset(h, 0), leg = legs.findIndex(l => k >= l.start && k < l.start + l.n);
      for (let s = 0; s < L; s += 3) { net.at(h, s, tmp); pts.push([tmp[0] + tmp[4] * off, tmp[1], tmp[2] - tmp[3] * off]); legAt.push(leg); }
    });
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    return { pts, cum, legAt, legs, length: cum[cum.length - 1], route: route.map(r => r.name) };
  }
  progress() { return this.path ? Math.min(1, this.s / this.path.length) : 0; }
  start(opts = {}) {
    const G = this.G;
    if (this.active) return false;
    const path = this.buildPath(opts.route);
    if (!path) { G.hud?.toast('Flythrough: no road route found'); return false; }
    const B = G.brothers, me = B.me, v = B.vehicleOf(me);
    this.restore = { me: { x: me.x, y: me.y, z: me.z, heading: me.heading }, v: v ? { id: v.id, x: v.x, y: v.y, z: v.z, heading: v.heading } : null, yaw: B.cam.yaw, simSteps: G.simSteps };
    if (v) v.hidden = true;
    this.car = G.traffic.add({ id: 'perf-car', kind: 'parked', model: 'saloon', paint: 0x1d3d7a, x: path.pts[0][0], y: path.pts[0][1], z: path.pts[0][2], heading: 0, parked: true, player: true });
    this._saveNow = G.save.now; G.save.now = () => false;   // never save the flythrough position
    this.path = path; this.s = 0; this.i = 0; this.speed = opts.speed || Number(G.Q.get('flyspeed')) || 14;
    this.frames = []; this.legFrames = path.legs.map(() => []); this.samples = []; this.acc = 0; this.t0 = performance.now(); this.lastT = performance.now(); this.stalls = 0;
    this.heap = []; this.active = true; this.onDone = opts.onDone; this.save = opts.save !== false;
    G.simSteps = 1;
    G.hud?.toast(`Perf flythrough · ${(path.length / 1000).toFixed(1)} km · ${path.route.join(' → ')}`, 5);
    return true;
  }
  // called every frame instead of the brothers' input update
  update() {
    const G = this.G, P = this.path, now = performance.now();
    const wall = Math.min(0.5, (now - this.lastT) / 1000); this.lastT = now;
    this.s += this.speed * wall;
    if (this.s >= P.length) { this.finish(true); return; }
    while (this.i + 1 < P.cum.length && P.cum[this.i + 1] < this.s) this.i++;
    const a = P.pts[this.i], b = P.pts[Math.min(P.pts.length - 1, this.i + 1)], seg = (P.cum[this.i + 1] ?? P.cum[this.i]) - P.cum[this.i] || 1, t = Math.min(1, (this.s - P.cum[this.i]) / seg);
    const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    // heading from a point ~8 m ahead for a smooth camera
    let j = this.i; while (j + 1 < P.cum.length && P.cum[j] < this.s + 8) j++;
    const hd = Math.atan2(P.pts[j][2] - z, P.pts[j][0] - x);
    const car = this.car, B = G.brothers, me = B.me;
    const gy = G.tiles.ground(x, z, car.y + 0.5);
    const y = gy != null && Math.abs(gy - (a[1] + 0.05)) < 4 ? gy : a[1] + 0.05;
    car.x = x; car.z = z; car.y = y; car.v = this.speed; car.sp = this.speed; car.heading = car.heading == null ? hd : lerpA(car.heading, hd, 0.15);
    car.spin = ((car.spin || 0) + this.speed * wall / car.def.wr) % (Math.PI * 2); car.lights = G.world.day < 0.6;
    me.x = x; me.z = z; me.y = y; B.speedNow = this.speed;
    for (const a2 of B.actor) a2.visible = false;
    B.followCam(wall, x, y + 1.5, z, 7.2, car.heading);
  }
  record(ms) {
    if (!this.active) return;
    this.frames.push(ms); if (ms > 100) this.stalls++;
    const leg = this.path.legAt[this.i] ?? 0; this.legFrames[leg]?.push(ms);
    const G = this.G;
    if ((this.acc += ms) >= 2000) {
      this.acc = 0;
      const recent = this.frames.slice(-120), ri = this.perf.info();
      const heapMB = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; if (heapMB != null) this.heap.push(heapMB);
      this.samples.push({ t: +((performance.now() - this.t0) / 1000).toFixed(1), leg, km: +(this.s / 1000).toFixed(2), x: Math.round(this.car.x), z: Math.round(this.car.z), ...summarise(recent), calls: ri.calls, tris: ri.tris, heapMB, pr: +G.renderer.getPixelRatio().toFixed(2), tiles: G.tiles.tiles.size, pending: G.tiles.pending.size, vehicles: G.traffic.list.length, peds: G.peds.list.length });
    }
  }
  finish(completed) {
    const G = this.G; if (!this.active) return null;
    this.active = false;
    const B = G.brothers, me = B.me, R = this.restore;
    G.traffic.remove(this.car); this.car = null;
    Object.assign(me, R.me); B.cam.yaw = R.yaw; G.simSteps = R.simSteps;
    if (R.v) { const v = G.traffic.byId.get(R.v.id); if (v) { Object.assign(v, { x: R.v.x, y: R.v.y, z: R.v.z, heading: R.v.heading }); v.hidden = false; } }
    G.save.now = this._saveNow; G._needGround = true;
    const calls = this.samples.map(s => s.calls).sort((a, b) => a - b), tris = this.samples.map(s => s.tris).sort((a, b) => a - b);
    const log = {
      kind: 'flythrough', completed, savedAt: new Date().toISOString(), ...this.perf.device(),
      route: this.path.route, distanceKm: +(Math.min(this.s, this.path.length) / 1000).toFixed(2), routeKm: +(this.path.length / 1000).toFixed(2), speedMps: this.speed,
      seconds: +((performance.now() - this.t0) / 1000).toFixed(1),
      summary: { ...summarise(this.frames), drawCallsP50: pct(calls, 0.5), drawCallsP95: pct(calls, 0.95), trisP95: pct(tris, 0.95), heapMinMB: this.heap.length ? Math.min(...this.heap) : null, heapMaxMB: this.heap.length ? Math.max(...this.heap) : null },
      legs: this.path.legs.map((l, k) => ({ from: l.from, to: l.to, ...summarise(this.legFrames[k]) })),
      samples: this.samples,
      note: 'Measured on the device named in userAgent/gpu with the backend shown. Figures from a software renderer (SwiftShader/llvmpipe) say nothing about phone performance.',
    };
    this.last = log;
    if (this.save) log.file = this.perf.save(log, 'perf-flythrough');
    G.hud?.toast(`Flythrough ${completed ? 'done' : 'stopped'} · ${log.summary.fps} fps avg · p95 ${log.summary.p95} ms · ${log.summary.stalls} stalls`, 8);
    if (this.onDone) this.onDone(log);
    return log;
  }
}
function lerpA(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
