// The Road Atlas (the full-screen map) and the minimap, drawn from the world's own data (hud.js calls them).
//  * Far out, the overview raster (4 m a pixel, build_world.py) carries the land, and the network's roads are drawn
//    over it in road-atlas colours with casings: motorways blue, primary routes (trunk roads) green, A roads red,
//    B roads orange, minor roads yellow, streets white; road-number shields on the main roads; place names sized
//    by importance.
//  * Closer in, each 256 m tile's own polygons are drawn crisply instead, fetched and decoded on demand: its 2 m
//    land cover, water, squares and pavements, carriageways and building footprints (with a soft shadow), so street
//    level reads like a street map rather than enlarged pixels. Street names run along their roads, once each.
//  * The minimap is the same map in a dark key. It is drawn north up into a cache around the player, which is turned
//    and slid under the needle every frame, so it moves smoothly and costs a drawImage; the cache is redrawn when
//    the player has moved on, the zoom has changed or more of the map has arrived.
// Everything is drawn at the screen's own pixel density.
import { fetchContainer } from './data.js';

const TILE = 256, LCN = 128, KEEP = 220;   // tile size (m), land cover cells a side, tiles kept

// ---------------------------------------------------------------- style
// road kinds: M motorway, T trunk (primary route), A primary (A road), B secondary (B road), C tertiary (minor
// road), U unclassified, S street, V service road / busway; P paths (drawn dashed, close in only)
const KIND = { motorway: 'M', motorway_link: 'M', trunk: 'T', trunk_link: 'T', primary: 'A', primary_link: 'A', secondary: 'B', secondary_link: 'B',
  tertiary: 'C', tertiary_link: 'C', unclassified: 'U', residential: 'S', living_street: 'S', service: 'V', busway: 'V', bus_guideway: 'V' };
// z: drawing order; w: width (CSS px) when zoomed out; real: typical carriageway width (m) for close in; minS: drawn from
// this zoom (px a metre); cas/fill: atlas colours; mini: minimap colour; label: names shown from this zoom
const ROAD = {
  V: { z: 0, w: 1.1, real: 4, minS: 0.5, cas: '#d3cdc3', fill: '#ffffff', mini: '#c4cac6', label: 2.0 },
  S: { z: 1, w: 1.5, real: 6, minS: 0.11, cas: '#c7c0b4', fill: '#ffffff', mini: '#f3f5f1', label: 0.55 },
  U: { z: 2, w: 1.7, real: 6, minS: 0.08, cas: '#bfb7aa', fill: '#ffffff', mini: '#f8f8f3', label: 0.5 },
  C: { z: 3, w: 2.2, real: 7, minS: 0.05, cas: '#b39c4e', fill: '#fbe38a', mini: '#f4d977', label: 0.35 },
  B: { z: 4, w: 2.6, real: 8, minS: 0.025, cas: '#a8661c', fill: '#f4a242', mini: '#ffb257', label: 0.25 },
  A: { z: 5, w: 3.0, real: 9, minS: 0, cas: '#8d2a22', fill: '#e14a3e', mini: '#ff786a', label: 0.18 },
  T: { z: 6, w: 3.5, real: 11, minS: 0, cas: '#13512e', fill: '#2a9b5b', mini: '#4bd38d', label: 0.14 },
  M: { z: 7, w: 4.2, real: 11, minS: 0, cas: '#14386f', fill: '#2f71d4', mini: '#5aa8ff', label: 0.1 },
};
const ORDER = Object.keys(ROAD).sort((a, b) => ROAD[a].z - ROAD[b].z);
// land cover (build_world.py LC) in the atlas's light key and the minimap's dark one
const LAND = [
  ['#e7efdc', '#25312b'], ['#eef0ea', '#2a3431'], ['#f1efe9', '#2c3532'], ['#ebe7e1', '#2a3431'], ['#a9d2ef', '#22506c'],
  ['#b5d5a1', '#1f3f2a'], ['#f3efd7', '#2f3429'], ['#c9e5b5', '#23452e'], ['#e9e6e1', '#2e3533'], ['#e0dadf', '#2e3131'],
  ['#e9e5da', '#2b3430'], ['#edf1e5', '#27312d'], ['#f2ede4', '#313936'], ['#bde2ab', '#24482e'], ['#d8e7c1', '#2b3e2b'],
  ['#c8deb3', '#243e2b'], ['#cde2c2', '#283f2e'], ['#ece4ea', '#2f2e34'], ['#e7e0cd', '#32312a'], ['#f4eac6', '#393728'],
];
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// (the minimap's key is the atlas's pulled towards a dark green-grey: mid tones, so the white roads, blue water and
// green parks stand out over any scene; greens and water keep more of their colour)
const MINI_BASE = [24, 34, 30];
const toMini = (h, f) => rgb(h).map((v, i) => Math.round(v * (1 - f) + MINI_BASE[i] * f));
const LAND_RGB = LAND.map(p => { const a = rgb(p[0]), green = a[1] > a[0] + 12 && a[1] > a[2] - 30; return [a, toMini(p[0], green || a[2] > a[0] + 30 ? 0.5 : 0.6)]; });
const AT = {   // atlas layers
  bg: '#e7efdc', water: '#a9d2ef', waterEdge: '#82b7de', plaza: '#f5f0e7', pave: '#f3f1eb', path: '#ebe5d8', carriage: '#ffffff', carriageEdge: '#cfc8bd',
  bld: '#e1d8d0', bldMid: '#d9cfc5', bldEdge: '#c6b8ac', bldShadow: 'rgba(110,92,74,0.2)', text: '#2b2824', halo: 'rgba(255,255,255,0.92)', place: '#1f2a24',
};
const MI = {   // minimap layers
  bg: '#58615b', water: '#3d8fd1', waterEdge: '#7fbdf0', plaza: '#7a817b', pave: '#737a75', path: '#6c736d', bld: '#8f9792', bldEdge: '#4b524e',
  bldShadow: 'rgba(16,22,20,0.35)', walk: '#e9dfc2', rail: '#3a3346', railTie: '#d9d3e2', casing: 'rgba(14,19,17,0.92)',
};
const isRef = s => /^(M\d+|A\d+(\(M\))?|B\d+)$/.test(s);

// ---------------------------------------------------------------- tile vectors, fetched on demand
// polygons are rings of int16 decimetres from the tile's corner: P[k] rings in polygon k, R[r] points in ring r
function rings(C, R, P) {
  const p = new Path2D();
  if (!C || !R || !P) return p;
  let ci = 0, ri = 0;
  for (let k = 0; k < P.length; k++) for (let r = 0; r < P[k]; r++) {
    const n = R[ri++]; if (n == null) return p;
    for (let q = 0; q < n; q++) { const x = C[(ci + q) * 2] / 10, z = C[(ci + q) * 2 + 1] / 10; q ? p.lineTo(x, z) : p.moveTo(x, z); }
    p.closePath(); ci += n;
  }
  return p;
}
class TileVec {
  constructor(i, j, A) {
    this.ox = i * TILE; this.oz = j * TILE; this.lc = A.lc || null; this.landC = [null, null];
    this.water = rings(A.wtC, A.wtR, A.wtP); this.plaza = rings(A.plazaC, A.plazaR, A.plazaP);
    this.pave = rings(A.paveC, A.paveR, A.paveP); this.path = rings(A.pathC, A.pathR, A.pathP);
    this.road = rings(A.roadC, A.roadR, A.roadP); this.bld = rings(A.bC, A.bR, A.bP);
    this.used = performance.now();
  }
  // the land cover as a 128 x 128 picture in either key (2 m a pixel, drawn smoothed)
  land(k) {
    if (this.landC[k] || !this.lc) return this.landC[k];
    const cv = document.createElement('canvas'); cv.width = cv.height = LCN;
    const cx = cv.getContext('2d'), im = cx.createImageData(LCN, LCN), d = im.data, pal = LAND_RGB;
    for (let q = 0; q < LCN * LCN; q++) { const c = (pal[this.lc[q]] || pal[0])[k]; d[q * 4] = c[0]; d[q * 4 + 1] = c[1]; d[q * 4 + 2] = c[2]; d[q * 4 + 3] = 255; }
    cx.putImageData(im, 0, 0);
    return (this.landC[k] = cv);
  }
}
export class MapData {
  constructor(G) {
    this.G = G; this.tiles = new Map(); this.pending = new Set(); this.failed = new Set(); this.version = 0;
    this.known = new Set(G.manifest.tiles?.map?.(t => (typeof t === 'string' ? t : t.key || (t.i + '_' + t.j))) || []);
  }
  get(i, j, want = true) {
    const key = i + '_' + j, t = this.tiles.get(key);
    if (t) { t.used = performance.now(); return t; }
    if (want && !this.pending.has(key) && !this.failed.has(key) && this.pending.size < 6 && (!this.known.size || this.known.has(key))) this.load(key, i, j);
    return null;
  }
  // a tile that exists and can still arrive
  wants(i, j) { const key = i + '_' + j; return !this.failed.has(key) && (!this.known.size || this.known.has(key)); }
  async load(key, i, j) {
    this.pending.add(key);
    try { const c = await fetchContainer(`world/tiles/${key}.bin`); this.tiles.set(key, new TileVec(i, j, c.arrays)); this.version++; this.trim(); }
    catch { this.failed.add(key); }
    finally { this.pending.delete(key); }
  }
  trim() {
    if (this.tiles.size <= KEEP + 20) return;
    const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.tiles.size - KEEP);
    for (const [k] of old) this.tiles.delete(k);
  }
}

// ---------------------------------------------------------------- the road network, indexed for drawing
class Roads {
  constructor(net) {
    this.net = net;
    const E = net.nEdges, kind = this.kind = new Array(E), bb = this.bb = new Float32Array(E * 4);
    const walk = net.walkCls;
    this.grid = new Map();                      // 256 m cells -> edges
    this.far = {};                              // Path2D per major kind, world coordinates (zoomed right out)
    for (const k of ORDER) this.far[k] = new Path2D();
    for (let e = 0; e < E; e++) {
      const cl = net.classes[net.cls[e]];
      kind[e] = walk.has(net.cls[e]) ? 'P' : KIND[cl] || null;
      const s = net.pstart[e], n = net.pcount[e], P = net.pts;
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = 0; i < n; i++) { const x = P[(s + i) * 3], z = P[(s + i) * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      bb[e * 4] = x0; bb[e * 4 + 1] = z0; bb[e * 4 + 2] = x1; bb[e * 4 + 3] = z1;
      if (!kind[e]) continue;
      for (let cx = Math.floor(x0 / TILE); cx <= Math.floor(x1 / TILE); cx++) for (let cz = Math.floor(z0 / TILE); cz <= Math.floor(z1 / TILE); cz++) {
        const key = cx * 65536 + cz; let l = this.grid.get(key); if (!l) this.grid.set(key, l = []); l.push(e);
      }
      if (/[MTAB]/.test(kind[e])) { const p = this.far[kind[e]]; for (let i = 0; i < n; i++) { const x = P[(s + i) * 3], z = P[(s + i) * 3 + 2]; i ? p.lineTo(x, z) : p.moveTo(x, z); } }
    }
  }
  // edges whose box meets [x0,x1] x [z0,z1]
  near(x0, z0, x1, z1, out = []) {
    const seen = this._seen || (this._seen = new Uint32Array(this.net.nEdges)), stamp = (this._stamp = (this._stamp || 0) + 1);
    const bb = this.bb;
    for (let cx = Math.floor(x0 / TILE); cx <= Math.floor(x1 / TILE); cx++) for (let cz = Math.floor(z0 / TILE); cz <= Math.floor(z1 / TILE); cz++) {
      const l = this.grid.get(cx * 65536 + cz); if (!l) continue;
      for (const e of l) {
        if (seen[e] === stamp) continue; seen[e] = stamp;
        if (bb[e * 4 + 2] < x0 || bb[e * 4] > x1 || bb[e * 4 + 3] < z0 || bb[e * 4 + 1] > z1) continue;
        out.push(e);
      }
    }
    return out;
  }
  trace(c, e) {
    const net = this.net, s = net.pstart[e], n = net.pcount[e], P = net.pts;
    for (let i = 0; i < n; i++) { const x = P[(s + i) * 3], z = P[(s + i) * 3 + 2]; i ? c.lineTo(x, z) : c.moveTo(x, z); }
  }
}

// ---------------------------------------------------------------- the renderer
export class MapView {
  constructor(G) {
    this.G = G; this.data = new MapData(G); this.roads = null; this.mini = null;
    this.places = (G.manifest.districts || []).map(d => ({ ...d, rank: d.kind === 'district' ? (/town centre/.test(d.name) ? 5 : 4) : d.kind === 'suburb' || d.kind === 'quarter' ? 3 : d.kind === 'village' ? 3 : 2 }));
  }
  ensure() { if (!this.roads) this.roads = new Roads(this.G.net); return this.roads; }

  // ------------------------------------------------------------ the Road Atlas
  // c: the atlas canvas's context; V: { x, z, s } (centre, px a metre); W, H: CSS size; extra: { dpr, avoid (boxes
  // names keep clear of), ovTile(i, j), over(c, X, Z, s) (markers, drawn fresh every time) }.
  // The map itself is painted into a base picture with a margin all round, which is slid (and, while a pinch is
  // under way, scaled) under the markers; it is repainted once the view leaves it, the zoom settles, or more of
  // the county's detail has arrived. this.pending: a repaint is still due, so keep calling.
  atlas(c, V, W, H, extra = {}) {
    const dpr = extra.dpr || 1, now = performance.now(), s = V.s;
    const B = this.base || (this.base = { cv: document.createElement('canvas'), s: 0, zt: 0 });
    if (s !== B.lastS) { B.lastS = s; B.zt = now; }
    const mx = Math.round(W * 0.2), mz = Math.round(H * 0.2), BW = W + 2 * mx, BH = H + 2 * mz;
    const k = s / (B.s || s), settled = now - B.zt > 180;
    // the base's world rectangle against the screen's
    const covered = B.s && Math.abs(V.x - B.x) <= (BW / 2 / B.s - W / 2 / s) && Math.abs(V.z - B.z) <= (BH / 2 / B.s - H / 2 / s);
    const stale = (B.ver !== this.data.version || B.partial) && now - B.t > 350;
    if (!B.s || B.W !== BW || B.H !== BH || B.dpr !== dpr || k < 0.5 || k > 2 || (B.s !== s ? settled : !covered) || (stale && (B.s === s || settled))) {
      B.x = V.x; B.z = V.z; B.s = s; B.W = BW; B.H = BH; B.dpr = dpr; B.ver = this.data.version; B.t = now;
      const w = Math.round(BW * dpr), h = Math.round(BH * dpr);
      if (B.cv.width !== w || B.cv.height !== h) { B.cv.width = w; B.cv.height = h; }
      const bc = B.cv.getContext('2d');
      // the controls and the compass, scale and key, in the base's pixels; the markers where they are now
      // (and thin lines along the screen's edges, so no name is cut in half by them)
      const avoid = (extra.avoid || []).concat([[W - 34, 108, 52, 64], [W / 2, H - 56, W, 40], [0, H / 2, 1, BH], [W, H / 2, 1, BH], [W / 2, 0, BW, 1], [W / 2, H, BW, 1]]).map(a => [a[0] + mx, a[1] + mz, a[2], a[3]]);
      B.partial = !this.paint(bc, { x: V.x, z: V.z, s }, BW, BH, dpr, extra.ovTile, avoid);
    }
    this.pending = B.s !== s || B.ver !== this.data.version || B.partial;
    // the base, slid and scaled to the view
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#c9cfc2'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = B.s === s ? 'low' : 'medium';
    const kk = s / B.s, dx = (B.x - V.x) * s + W / 2 - BW / 2 * kk, dz = (B.z - V.z) * s + H / 2 - BH / 2 * kk;
    if (kk === 1) c.drawImage(B.cv, Math.round(dx * dpr) / dpr, Math.round(dz * dpr) / dpr, BW, BH);
    else c.drawImage(B.cv, dx, dz, BW * kk, BH * kk);
    const X = x => (x - V.x) * s + W / 2, Z = z => (z - V.z) * s + H / 2;
    extra.over?.(c, X, Z, s);
    this.furniture(c, W, H, s);
  }
  // the map proper: land, water, roads, buildings, railways and names, centred on V, W x H CSS px; false if some of
  // it hadn't arrived yet (so it's painted again shortly)
  paint(c, V, W, H, dpr, ovTile, avoid) {
    let whole = true;
    const G = this.G, R = this.ensure(), s = V.s, ov = G.manifest.overview;
    this.dpr = dpr;
    const x0 = V.x - W / 2 / s, x1 = V.x + W / 2 / s, z0 = V.z - H / 2 / s, z1 = V.z + H / 2 / s;
    const toWorld = () => c.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (W / 2 - V.x * s), this.dpr * (H / 2 - V.z * s));
    const toScreen = () => c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    toScreen();
    c.fillStyle = '#dfe6d4'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    // 1. land: the overview raster everywhere; close in, each tile's own land and polygons where they have arrived
    const tw = ov.tile * ov.mpx;
    const i0 = Math.max(0, Math.floor((x0 - ov.x0) / tw)), i1 = Math.min(Math.ceil(ov.w / ov.tile) - 1, Math.floor((x1 - ov.x0) / tw));
    const j0 = Math.max(0, Math.floor((z0 - ov.z0) / tw)), j1 = Math.min(Math.ceil(ov.h / ov.tile) - 1, Math.floor((z1 - ov.z0) / tw));
    toWorld();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const img = ovTile(i, j); if (!img.complete || !img.naturalWidth) { if (!img.complete) whole = false; continue; }
      c.drawImage(img, ov.x0 + i * tw, ov.z0 + j * tw, tw + 1 / s, tw + 1 / s);
    }
    // (the tiles' own drawing from the mid zoom, as long as the view needs no more of them than are kept)
    const nT = (Math.floor(x1 / TILE) - Math.floor(x0 / TILE) + 1) * (Math.floor(z1 / TILE) - Math.floor(z0 / TILE) + 1);
    const near = s >= 0.26 && nT <= KEEP - 20, close = s >= 0.7;
    const tiles = [];
    if (near) {
      this.wanted = 0;
      for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++) for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) {
        const t = this.data.get(i, j); if (t) tiles.push(t); else if (this.data.wants(i, j)) this.wanted++;
      }
      this.wanted += tiles.length;
      // (water comes as many small cells: a wide edge stroke under one nonzero fill of them all leaves just the
      // shoreline, with no seams between cells or tiles)
      for (const t of tiles) { const L = t.land(0); if (L) c.drawImage(L, t.ox, t.oz, TILE, TILE); }
      c.lineJoin = 'round'; c.lineWidth = 2.4 / s; c.strokeStyle = AT.waterEdge;
      for (const t of tiles) { c.save(); c.translate(t.ox, t.oz); c.stroke(t.water); c.restore(); }
      for (const t of tiles) {
        c.save(); c.translate(t.ox, t.oz);
        c.fillStyle = AT.water; c.fill(t.water);
        c.fillStyle = AT.plaza; c.fill(t.plaza); c.fillStyle = AT.pave; c.fill(t.pave); c.fillStyle = AT.path; c.fill(t.path);
        c.fillStyle = AT.carriage; c.fill(t.road); if (close) { c.lineWidth = 0.8 / s; c.strokeStyle = AT.carriageEdge; c.stroke(t.road); }
        c.restore();
      }
    }
    // 2. roads: casings then fills, minor first; zoomed right out, the main roads only (one path a kind)
    const lw = k => Math.max(ROAD[k].w, (near ? 0.8 : 0.55) * ROAD[k].real * s) / s;
    if (s < 0.09) {
      for (const k of ['B', 'A', 'T', 'M']) { if (s < ROAD[k].minS) continue; c.strokeStyle = ROAD[k].cas; c.lineWidth = lw(k) + 1.6 / s; c.lineJoin = c.lineCap = 'round'; c.stroke(R.far[k]); }
      for (const k of ['B', 'A', 'T', 'M']) { if (s < ROAD[k].minS) continue; c.strokeStyle = ROAD[k].fill; c.lineWidth = lw(k); c.stroke(R.far[k]); }
    } else {
      const E = R.near(x0 - 50, z0 - 50, x1 + 50, z1 + 50), by = {};
      for (const e of E) { const k = R.kind[e]; if (!k || (k !== 'P' && s < ROAD[k].minS)) continue; (by[k] || (by[k] = [])).push(e); }
      c.lineJoin = c.lineCap = 'round';
      if (by.P && s >= 0.6) { c.setLineDash([3 / s, 2.5 / s]); c.strokeStyle = '#a3927a'; c.lineWidth = 1.1 / s; c.beginPath(); for (const e of by.P) R.trace(c, e); c.stroke(); c.setLineDash([]); }
      const paths = {};
      for (const k of ORDER) if (by[k]) { const p = paths[k] = new Path2D(); for (const e of by[k]) R.trace(p, e); }
      for (const k of ORDER) if (paths[k] && !(near && 'VSU'.includes(k))) { c.strokeStyle = ROAD[k].cas; c.lineWidth = lw(k) + 1.8 / s; c.stroke(paths[k]); }
      for (const k of ORDER) if (paths[k]) {
        // (close in, the white streets are the tiles' own carriageways; where a tile hasn't arrived, the line stands in)
        c.strokeStyle = ROAD[k].fill; c.lineWidth = near && 'VSU'.includes(k) ? Math.max(ROAD[k].w, 0.5 * ROAD[k].real * s) / s : lw(k);
        c.globalAlpha = near && 'VSU'.includes(k) ? 0.75 : 1; c.stroke(paths[k]); c.globalAlpha = 1;
      }
      this._labelEdges = E;
    }
    // 3. buildings close in: footprints with a soft shadow
    if (near) for (const t of tiles) {
      c.save(); c.translate(t.ox, t.oz);
      if (close) { c.save(); c.translate(0.9 / s, 1.1 / s); c.fillStyle = AT.bldShadow; c.fill(t.bld); c.restore(); }
      c.fillStyle = close ? AT.bld : AT.bldMid; c.fill(t.bld); if (close) { c.lineWidth = 0.9 / s; c.strokeStyle = AT.bldEdge; c.stroke(t.bld); }
      c.restore();
    }
    // 4. railways: a dark line with white dashes, as on the printed atlases
    const T = G.trains;
    if (T?.ready) {
      const rail = this._rail || (this._rail = (() => { const p = new Path2D(); for (const L of T.lines) for (let q = 0; q < L.n; q++) { const x = L.P[q * 3], z = L.P[q * 3 + 2]; q ? p.lineTo(x, z) : p.moveTo(x, z); } return p; })());
      c.lineJoin = c.lineCap = 'butt';
      c.strokeStyle = '#3c3a45'; c.lineWidth = Math.max(2.6, 4 * Math.min(1, s)) / s; c.stroke(rail);
      c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(1.2, 2 * Math.min(1, s)) / s; c.setLineDash([7 / s, 7 / s]); c.stroke(rail); c.setLineDash([]);
      c.lineJoin = c.lineCap = 'round';
    }
    toScreen();
    const X = x => (x - V.x) * s + W / 2, Z = z => (z - V.z) * s + H / 2;
    // 5. bus stops close in, stations, then the names
    const tr = G.transit;
    if (tr && s > 0.8) for (const [si] of tr.services || []) {
      const st = G.net.busStops[si]; if (!st) continue; const x = X(st[0]), z = Z(st[1]); if (x < -8 || x > W + 8 || z < -8 || z > H + 8) continue;
      c.fillStyle = '#1b6f8a'; c.strokeStyle = '#ffffff'; c.lineWidth = 1.4; c.beginPath(); c.roundRect ? c.roundRect(x - 3.5, z - 3.5, 7, 7, 1.5) : c.rect(x - 3.5, z - 3.5, 7, 7); c.fill(); c.stroke();
    }
    this.labels(c, V, W, H, X, Z, s, avoid);
    return whole && !(near && tiles.length < this.wanted);
  }
  // street names along their roads (once each, reading left to right, never overlapping), road-number shields,
  // place names; nothing under the controls or the markers (avoid)
  labels(c, V, W, H, X, Z, s, avoid) {
    const R = this.roads, net = this.G.net, boxes = [];
    for (const a of avoid) boxes.push(a);
    const free = (x, z, w, h) => {
      if (x - w / 2 < 4 || x + w / 2 > W - 4 || z - h / 2 < 4 || z + h / 2 > H - 4) return false;
      for (const b of boxes) if (Math.abs(b[0] - x) * 2 < b[2] + w && Math.abs(b[1] - z) * 2 < b[3] + h) return false;
      boxes.push([x, z, w, h]); return true;
    };
    c.lineJoin = 'round'; c.textBaseline = 'middle'; c.textAlign = 'center';
    // railway stations: a red disc, the name beside it where there's room
    const tr = this.G.transit;
    if (tr?.stations) {
      c.font = '700 11.5px system-ui';
      for (const st of tr.stations) {
        const x = X(st.x), z = Z(st.z); if (x < -10 || x > W + 10 || z < -10 || z > H + 10) continue;
        c.beginPath(); c.arc(x, z, 5.5, 0, 7); c.fillStyle = '#ffffff'; c.fill(); c.strokeStyle = '#d6332a'; c.lineWidth = 3; c.stroke();
        c.beginPath(); c.arc(x, z, 7.2, 0, 7); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1; c.stroke();
        boxes.push([x, z, 14, 14]);
        if (s <= 0.1) continue;
        const w = c.measureText(st.name).width;
        for (const [ox, oz] of [[w / 2 + 10, 0], [-w / 2 - 10, 0], [0, -15], [0, 15]]) if (free(x + ox, z + oz, w + 6, 16)) {
          c.strokeStyle = AT.halo; c.lineWidth = 3.5; c.strokeText(st.name, x + ox, z + oz + 0.5); c.fillStyle = '#7a1d17'; c.fillText(st.name, x + ox, z + oz + 0.5); break;
        }
      }
    }
    // places (they claim their space): towns in capitals, smaller places in italics as zoom allows
    const placeList = this.places.filter(p => s > (p.rank >= 5 ? 0 : p.rank === 4 ? 0.025 : p.rank === 3 ? 0.06 : 0.25)).sort((a, b) => b.rank - a.rank);
    for (const p of placeList) {
      const x = X(p.x), z = Z(p.z) - 16; if (x < -200 || x > W + 200 || z < -40 || z > H + 40) continue;
      const big = p.rank >= 4, size = (p.rank >= 5 ? 18 : p.rank === 4 ? 16 : p.rank === 3 ? 13.5 : 12) * (s < 0.09 && big ? 0.85 : 1);
      c.font = `${big ? 800 : p.rank === 2 ? 'italic 600' : 700} ${size}px system-ui`;
      const label = big ? p.name.toUpperCase() : p.name;
      try { c.letterSpacing = big ? '1.5px' : '0px'; } catch { /* older canvases */ }
      const w = c.measureText(label).width, dz = [0, -size - 12, size + 12, -2 * size - 22, 2 * size + 22].find(d => free(x, z + d, w + 10, size + 8));
      if (dz == null) continue;
      c.strokeStyle = AT.halo; c.lineWidth = 4; c.strokeText(label, x, z + dz); c.fillStyle = big ? '#17231d' : AT.place; c.fillText(label, x, z + dz);
    }
    try { c.letterSpacing = '0px'; } catch { /* older canvases */ }
    if (s < 0.09 || !this._labelEdges) { this.shields(c, X, Z, s, free, W, H, true); return; }
    // shields on the main roads, then street names along the streets (joined up across junctions)
    this.shields(c, X, Z, s, free, W, H, false);
    const named = [];
    for (const e of this._labelEdges) {
      const k = R.kind[e]; if (!k || k === 'P' || s < ROAD[k].label) continue;
      const nm = net.names[net.name[e]]; if (!nm || isRef(nm)) continue;
      named.push(e);
    }
    const chains = this.chains(named).sort((a, b) => ROAD[b.kind].z - ROAD[a.kind].z || b.len - a.len);
    const done = new Map(), fontPx = s > 1.2 ? 12.5 : 11.5;
    c.font = `600 ${fontPx}px system-ui`;
    const glyphs = [];
    let n = 0;
    for (const ch of chains) {
      if (n >= 60) break;
      const nm = ch.nm, L = c.measureText(nm).width + 12;
      // the chain on screen, with distance along it
      const Q = ch.line.map(([x, z]) => [X(x), Z(z)]), D = [0];
      for (let i = 1; i < Q.length; i++) D.push(D[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
      const total = D[D.length - 1]; if (total < L) continue;
      const at = d => { let i = 1; while (i < D.length - 1 && D[i] < d) i++; const f = (d - D[i - 1]) / Math.max(1e-6, D[i] - D[i - 1]); return [Q[i - 1][0] + (Q[i][0] - Q[i - 1][0]) * f, Q[i - 1][1] + (Q[i][1] - Q[i - 1][1]) * f]; };
      // try the middle first, then either side of it
      const step = L + 240, cands = [total / 2];
      for (let k = 1; k < 6; k++) cands.push(total / 2 - k * step, total / 2 + k * step);
      let placedHere = 0;
      for (const m of cands) {
        if (m - L / 2 < 0 || m + L / 2 > total) continue;
        const a = at(m - L / 2), b = at(m + L / 2), mid = at(m);
        const prev = done.get(nm); if (prev && prev.some(([px, pz]) => Math.hypot(px - mid[0], pz - mid[1]) < 300)) continue;
        // straight enough: every point of the span close to the chord
        const cx = b[0] - a[0], cz = b[1] - a[1], cl = Math.hypot(cx, cz); if (cl < L * 0.9) continue;
        let ok = true, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
        for (let i = 1; i < Q.length - 1 && ok; i++) if (D[i] > m - L / 2 && D[i] < m + L / 2) {
          const [px, pz] = Q[i]; if (Math.abs((px - a[0]) * cz - (pz - a[1]) * cx) / cl > 4.5) ok = false;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
        }
        if (!ok) continue;
        const ang = Math.atan2(cz, cx), pad = Math.abs(Math.cos(ang)) * 7 + 2, padX = Math.abs(Math.sin(ang)) * 7 + 2;
        if (!free((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + padX * 2, z1 - z0 + pad * 2)) continue;
        // lay the letters along the road, left to right
        const rev = cx < 0;
        let off = 6;
        for (const g of nm) {
          const gw = c.measureText(g).width, d = rev ? m + L / 2 - off - gw / 2 : m - L / 2 + off + gw / 2;
          const p0 = at(d - 3), p1 = at(d + 3), p = at(d);
          let ga = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); if (rev) ga += Math.PI;
          glyphs.push([g, p[0], p[1], ga]); off += gw;
        }
        (prev || done.set(nm, []).get(nm)).push(mid); n++; placedHere++;
        if (placedHere >= 2) break;
      }
    }
    for (const pass of [0, 1]) {
      if (pass) c.fillStyle = AT.text; else { c.strokeStyle = AT.halo; c.lineWidth = 3.2; }
      for (const [g, x, z, a] of glyphs) {
        c.setTransform(this.dpr * Math.cos(a), this.dpr * Math.sin(a), -this.dpr * Math.sin(a), this.dpr * Math.cos(a), this.dpr * x, this.dpr * z);
        pass ? c.fillText(g, 0, 0.5) : c.strokeText(g, 0, 0.5);
      }
    }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  // the named roads joined into runs across junctions, so a street's name can sit anywhere along it
  chains(edges) {
    const net = this.G.net, R = this.roads, P = net.pts, groups = new Map(), out = [];
    for (const e of edges) { const k = net.name[e]; let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(e); }
    const pts = e => { const st = net.pstart[e], a = []; for (let i = 0; i < net.pcount[e]; i++) a.push([P[(st + i) * 3], P[(st + i) * 3 + 2]]); return a; };
    const key = p => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
    for (const [k, g] of groups) {
      const ends = new Map(), used = new Set();
      const add = (q, e, end) => { let l = ends.get(q); if (!l) ends.set(q, l = []); l.push([e, end]); };
      for (const e of g) { const p = pts(e); add(key(p[0]), e, 0); add(key(p[p.length - 1]), e, 1); }
      for (const e0 of g) {
        if (used.has(e0)) continue; used.add(e0);
        let line = pts(e0), kind = R.kind[e0];
        for (let dir = 0; dir < 2; dir++) {
          for (let guard = 0; guard < 60; guard++) {
            const t = line[line.length - 1], u = line[Math.max(0, line.length - 2)], hd = Math.atan2(t[1] - u[1], t[0] - u[0]);
            let best = null, bd = 1.2;   // the straightest way on, if it doesn't turn more than about 70 degrees
            for (const [e, end] of ends.get(key(t)) || []) {
              if (used.has(e)) continue;
              const p = pts(e); if (end === 1) p.reverse();
              const q = p[Math.min(1, p.length - 1)], d = Math.abs(((Math.atan2(q[1] - t[1], q[0] - t[0]) - hd + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
              if (d < bd) { bd = d; best = [e, p]; }
            }
            if (!best) break;
            used.add(best[0]); line = line.concat(best[1].slice(1));
            if (ROAD[R.kind[best[0]]].z > ROAD[kind].z) kind = R.kind[best[0]];
          }
          line.reverse();
        }
        let len = 0; for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        out.push({ nm: net.names[k], kind, line, len });
      }
    }
    return out;
  }
  // road numbers on the main roads, coloured as UK signs: motorways blue, primary routes green (yellow numbers),
  // other A and B roads white
  shields(c, X, Z, s, free, W, H, farOnly) {
    const R = this.roads, net = this.G.net, P = net.pts, spacing = 260, placed = new Map();
    const list = farOnly ? this._majorRefs || (this._majorRefs = this.refEdges(['M', 'T', 'A'])) : (this._refEdges || (this._refEdges = this.refEdges(['M', 'T', 'A', 'B'])));
    c.font = '800 10.5px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    let n = 0;
    for (const e of list) {
      if (n > 40) break;
      const k = R.kind[e]; if (k === 'B' && s < 0.12) continue;
      const mid = net.pstart[e] + (net.pcount[e] >> 1), x = X(P[mid * 3]), z = Z(P[mid * 3 + 2]);
      if (x < 10 || x > W - 10 || z < 10 || z > H - 10) continue;
      const ref = net.names[net.ref[e]], arr = placed.get(ref) || [];
      if (arr.some(([px, pz]) => Math.hypot(px - x, pz - z) < spacing)) continue;
      const w = c.measureText(ref).width + 10;
      if (!free(x, z, w + 4, 19)) continue;
      const [bg, fg, edge] = k === 'M' ? ['#1f5fbf', '#ffffff', '#ffffff'] : k === 'T' ? ['#0f6a3a', '#ffd21f', '#ffffff'] : ['#ffffff', '#111111', '#111111'];
      c.fillStyle = bg; c.strokeStyle = edge; c.lineWidth = 1.4;
      c.beginPath(); c.roundRect ? c.roundRect(x - w / 2, z - 8, w, 16, 3) : c.rect(x - w / 2, z - 8, w, 16); c.fill(); c.stroke();
      c.fillStyle = fg; c.fillText(ref, x, z + 0.5);
      arr.push([x, z]); placed.set(ref, arr); n++;
    }
  }
  refEdges(kinds) {
    const R = this.roads, net = this.G.net, out = [];
    for (let e = 0; e < net.nEdges; e++) { const k = R.kind[e]; if (!k || !kinds.includes(k)) continue; const r = net.names[net.ref[e]]; if (r && isRef(r) && net.len[e] > 120) out.push(e); }
    return out.sort((a, b) => net.len[b] - net.len[a]);
  }
  // compass, scale bar and key
  furniture(c, W, H, s) {
    c.save();
    // compass (the atlas is always north up)
    const cx = W - 34, cz = 112;
    c.fillStyle = 'rgba(23,51,44,0.92)'; c.beginPath(); c.arc(cx, cz, 20, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#9bb9a0'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#ff6b5a'; c.beginPath(); c.moveTo(cx, cz - 15); c.lineTo(cx + 5.5, cz); c.lineTo(cx - 5.5, cz); c.fill();
    c.fillStyle = '#f3ead2'; c.beginPath(); c.moveTo(cx, cz + 15); c.lineTo(cx + 5.5, cz); c.lineTo(cx - 5.5, cz); c.fill();
    c.fillStyle = '#ffffff'; c.font = '800 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', cx, cz - 28);
    // scale bar: alternating black and white blocks
    const metres = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(m => m * s >= 70) || 5000, w = metres * s, bx = 18, by = H - 66;
    c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(bx - 6, by - 18, w + 12, 30);
    for (let q = 0; q < 4; q++) { c.fillStyle = q % 2 ? '#ffffff' : '#1d1d1d'; c.fillRect(bx + q * w / 4, by, w / 4, 5); }
    c.strokeStyle = '#1d1d1d'; c.lineWidth = 1; c.strokeRect(bx, by, w, 5);
    c.fillStyle = '#1d1d1d'; c.font = '700 11px system-ui'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('0', bx - 2, by - 4); c.textAlign = 'right'; c.fillText(metres >= 1000 ? metres / 1000 + ' km' : metres + ' m', bx + w + 2, by - 4);
    // key
    const items = [['M', 'Motorway'], ['T', 'Primary route'], ['A', 'A road'], ['B', 'B road'], ['C', 'Minor road']];
    c.font = '600 10.5px system-ui'; c.textAlign = 'left'; c.textBaseline = 'middle';
    let kw = 12; for (const [, l] of items) kw += 22 + c.measureText(l).width + 10;
    kw += 22 + c.measureText('Railway').width + 6;
    const kx = Math.max(bx + w + 24, W - kw - 14), ky = H - 58;
    if (kx > bx + w + 16) {
      c.fillStyle = 'rgba(255,255,255,0.88)'; c.beginPath(); c.roundRect ? c.roundRect(kx, ky - 12, kw, 24, 6) : c.rect(kx, ky - 12, kw, 24); c.fill();
      let x = kx + 10;
      for (const [k, l] of items) {
        c.strokeStyle = ROAD[k].cas; c.lineWidth = 6; c.beginPath(); c.moveTo(x, ky); c.lineTo(x + 16, ky); c.stroke();
        c.strokeStyle = ROAD[k].fill; c.lineWidth = 3.6; c.stroke();
        c.fillStyle = '#26231f'; c.fillText(l, x + 21, ky + 0.5); x += 22 + c.measureText(l).width + 10;
      }
      c.lineCap = 'butt'; c.strokeStyle = '#3c3a45'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, ky); c.lineTo(x + 18, ky); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#26231f'; c.fillText('Railway', x + 21, ky + 0.5);
    }
    c.restore();
  }

  // ------------------------------------------------------------ the minimap
  // c: the minimap's context (backing store size x size device px); S: CSS size; dpr; me: the player; scale: px a
  // metre (CSS); rot: the map's rotation; over(c): the route, vehicles etc. in world coordinates
  minimap(c, S, dpr, me, scale, rot, over) {
    const M = this.mini || (this.mini = { cv: document.createElement('canvas'), x: 0, z: 0, scale: 0, ver: -1, t: 0 });
    const R = S / 2, now = performance.now();
    // (the cache covers a disc 1.7 times the minimap's reach, so it can be turned and slid before it needs redrawing)
    const reach = R / scale, cover = reach * 1.7;
    const moved = Math.hypot(me.x - M.x, me.z - M.z), zoomed = Math.abs(Math.log(scale / (M.scale || 1)));
    if (!M.scale || moved > (cover - reach * 1.05) * 0.8 || zoomed > 0.14 || (M.ver !== this.data.version && now - M.t > 400)) this.miniCache(M, me, scale, cover, dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = MI.bg; c.fillRect(0, 0, S, S);
    c.translate(R, R); c.rotate(rot);
    const k = scale / M.scale;
    c.save(); c.scale(k, k); c.translate((M.x - me.x) * M.scale, (M.z - me.z) * M.scale);
    c.imageSmoothingEnabled = true;
    c.drawImage(M.cv, -M.px / 2, -M.px / 2, M.px, M.px);
    c.restore();
    c.scale(scale, scale); c.translate(-me.x, -me.z);
    over(c);
    c.restore();
  }
  miniCache(M, me, scale, cover, dpr) {
    const R = this.ensure(), G = this.G, px = Math.ceil(cover * 2 * scale), dev = Math.min(1600, Math.ceil(px * dpr));
    if (M.cv.width !== dev) { M.cv.width = M.cv.height = dev; }
    const c = M.cv.getContext('2d'), k = dev / px;   // device px a CSS px
    M.x = me.x; M.z = me.z; M.scale = scale; M.px = px; M.ver = this.data.version; M.t = performance.now();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, dev, dev);
    // world -> cache pixels
    const f = scale * k;
    c.setTransform(f, 0, 0, f, dev / 2 - me.x * f, dev / 2 - me.z * f);
    const x0 = me.x - cover, x1 = me.x + cover, z0 = me.z - cover, z1 = me.z + cover;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const tiles = [];
    for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++) for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) { const t = this.data.get(i, j); if (t) tiles.push(t); }
    for (const t of tiles) { const L = t.land(1); if (L) c.drawImage(L, t.ox, t.oz, TILE, TILE); }
    c.lineJoin = 'round'; c.lineWidth = 2.2 / scale; c.strokeStyle = MI.waterEdge;
    for (const t of tiles) { c.save(); c.translate(t.ox, t.oz); c.stroke(t.water); c.restore(); }
    for (const t of tiles) {
      c.save(); c.translate(t.ox, t.oz);
      c.fillStyle = MI.water; c.fill(t.water);
      c.fillStyle = MI.plaza; c.fill(t.plaza); c.fillStyle = MI.pave; c.fill(t.pave); c.fillStyle = MI.path; c.fill(t.path);
      c.restore();
    }
    // buildings: raised a touch off the ground with a soft shadow and a dark edge
    for (const t of tiles) {
      c.save(); c.translate(t.ox, t.oz);
      c.save(); c.translate(0.8 / scale, 1.2 / scale); c.fillStyle = MI.bldShadow; c.fill(t.bld); c.restore();
      c.fillStyle = MI.bld; c.fill(t.bld); c.lineWidth = 0.7 / scale; c.strokeStyle = MI.bldEdge; c.stroke(t.bld);
      c.restore();
    }
    // railways: a dark line with pale ties
    const T = G.trains; if (T?.ready) {
      const rail = new Path2D(); for (const L of T.lines) for (let q = 0; q < L.n; q++) { const x = L.P[q * 3], z = L.P[q * 3 + 2]; q ? rail.lineTo(x, z) : rail.moveTo(x, z); }
      c.strokeStyle = MI.rail; c.lineWidth = 3.2 / scale; c.stroke(rail);
      c.strokeStyle = MI.railTie; c.lineWidth = 1.4 / scale; c.setLineDash([3 / scale, 3 / scale]); c.stroke(rail); c.setLineDash([]);
    }
    // roads: paths dashed, then each kind with a dark edge
    const E = R.near(x0, z0, x1, z1), by = {};
    for (const e of E) { const kd = R.kind[e]; if (kd) (by[kd] || (by[kd] = [])).push(e); }
    c.lineJoin = c.lineCap = 'round';
    if (by.P) { c.strokeStyle = MI.walk; c.lineWidth = 1.1 / scale; c.setLineDash([2.5 / scale, 2 / scale]); c.beginPath(); for (const e of by.P) R.trace(c, e); c.stroke(); c.setLineDash([]); }
    const w = kd => Math.max(ROAD[kd].w * 1.1, ROAD[kd].real * 0.8 * scale) / scale;
    const paths = {};
    for (const kd of ORDER) if (by[kd]) { const p = paths[kd] = new Path2D(); for (const e of by[kd]) R.trace(p, e); }
    for (const kd of ORDER) if (paths[kd]) { c.strokeStyle = MI.casing; c.lineWidth = w(kd) + 2.2 / scale; c.stroke(paths[kd]); }
    for (const kd of ORDER) if (paths[kd]) { c.strokeStyle = ROAD[kd].mini; c.lineWidth = w(kd); c.stroke(paths[kd]); }
  }
}
