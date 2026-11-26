// Tile worker: fetches world tiles and turns them into GPU-ready typed arrays.
// Everything here is plain math so the main thread never stalls on geometry.
import earcut from '../node_modules/three/src/extras/lib/earcut.js';
import { inflate, decode } from './data.js';
import { fasciaBrand, signBox, normName } from './brands.js';

const TILE = 256, NT = 65, STEP = 4;
let NET = null;

self.onmessage = async ev => {
  const m = ev.data;
  if (m.type === 'init') { initNet(m); return; }
  if (m.type === 'tile') {
    try {
      const r = await fetch(m.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { header, arrays } = decode(await inflate(await r.arrayBuffer()));
      const out = build(header, arrays, m.lod);
      out.key = m.key; out.lod = m.lod;
      self.postMessage(out, collectTransfer(out));
    } catch (err) {
      self.postMessage({ key: m.key, lod: m.lod, error: String(err && err.stack || err) });
    }
  }
};

function collectTransfer(o, list = []) {
  for (const v of Object.values(o)) {
    if (ArrayBuffer.isView(v)) list.push(v.buffer);
    else if (v && typeof v === 'object' && !Array.isArray(v)) collectTransfer(v, list);
  }
  return [...new Set(list)];
}

function initNet(m) {
  NET = m;
  const nP = m.pts.length / 3;
  NET.cum = new Float32Array(nP);
  for (let e = 0; e < m.pstart.length; e++) {
    const s = m.pstart[e], n = m.pcount[e];
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const a = (s + i - 1) * 3, b = (s + i) * 3;
      acc += Math.hypot(m.pts[b] - m.pts[a], m.pts[b + 2] - m.pts[a + 2]);
      NET.cum[s + i] = acc;
    }
  }
  NET.cross = new Map();
  for (const c of m.crossings) { if (!NET.cross.has(c[0])) NET.cross.set(c[0], []); NET.cross.get(c[0]).push(c); }
  NET.stops = new Map();
  for (const [e, d, stop] of m.approaches) { if (!NET.stops.has(e)) NET.stops.set(e, []); NET.stops.get(e).push([d, stop]); }
  NET.driveCls = new Set(m.driveCls);
  NET.added = m.addedBridges || [];
  NET.slabs = []; for (let i = 0; i + 2 < (m.slabs || []).length; i += 3) NET.slabs.push([m.slabs[i], m.slabs[i + 1], m.slabs[i + 2]]);
  // links between the spans of a bridge mapped in pieces ride at deck height: they are deck too
  if (m.connector) for (let e = 0; e < m.connector.length; e++) if (m.connector[e] && NET.driveCls.has(m.cls[e])) NET.slabs.push([e, 0, Infinity]);
  NET.slabOf = new Map(); for (const [e, lo, hi] of NET.slabs) { if (!NET.slabOf.has(e)) NET.slabOf.set(e, []); NET.slabOf.get(e).push([lo, hi]); }
  NET.shoulder = m.shoulder || null; NET.strip = m.strip || null;
  // nodes where a slip road joins or leaves a motorway (edge lines there are broken)
  NET.linkNode = new Set();
  if (m.ea) {
    const mw = m.classes.indexOf('motorway'), ml = m.classes.indexOf('motorway_link'), onMw = new Set();
    for (let e = 0; e < m.cls.length; e++) if (m.cls[e] === mw) { onMw.add(m.ea[e]); onMw.add(m.eb[e]); }
    for (let e = 0; e < m.cls.length; e++) if (m.cls[e] === ml) for (const n of [m.ea[e], m.eb[e]]) if (onMw.has(n)) NET.linkNode.add(n);
  }
  initEmbankments(m);
  initCuttings(m);
  initProfile(m);
  initPlatforms(m.platforms || []);
  initRailLines(m.railLines || []);
  initBarriers(m.barriers);
  const bays = m.bays || [];   // (NET is this message: read the flat list before replacing it with the map)
  NET.bays = new Map();
  for (let i = 0; i + 4 < bays.length; i += 5) { const e = bays[i]; if (!NET.bays.has(e)) NET.bays.set(e, []); NET.bays.get(e).push([bays[i + 1], bays[i + 2], bays[i + 3], bays[i + 4]]); }
}

// ------------------------------------------------------------------ barriers (roadDetail.js)
// kind 0: concrete step barrier on a motorway's central reservation; 2: double-sided steel fence on a dual
// carriageway's; 1: steel fence along a verge on a high embankment. Segments are drawn by the tile that
// holds their midpoint.
function initBarriers(flat) {
  NET.bar = null;
  if (!flat || !flat.length) return;
  const seg = [], grid = new Map();
  for (let i = 0; i < flat.length;) {
    const n = flat[i], kind = flat[i + 1]; i += 2;
    for (let k = 0; k + 1 < n; k++) {
      const a = i + k * 3, b = a + 3, id = seg.length / 7;
      seg.push(flat[a], flat[a + 1], flat[a + 2], flat[b], flat[b + 1], flat[b + 2], kind);
      const key = Math.floor((flat[a] + flat[b]) / 2 / TILE) * 65536 + Math.floor((flat[a + 2] + flat[b + 2]) / 2 / TILE);
      let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(id);
    }
    i += n * 3;
  }
  NET.bar = { seg: new Float32Array(seg), grid };
}
function buildBarriers(S, ix, iz, ox, oz) {
  const B = NET && NET.bar; if (!B) return;
  const ids = B.grid.get(ix * 65536 + iz); if (!ids) return;
  const g = B.seg;
  for (const id of ids) {
    const o = id * 7, kind = g[o + 6];
    const a = [g[o] - ox, g[o + 1], g[o + 2] - oz], b = [g[o + 3] - ox, g[o + 4], g[o + 5] - oz];
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l, nz = dx / l;
    const at = (p, off, h) => [p[0] + nx * off, p[1] + h, p[2] + nz * off];
    if (kind === 0) {
      // concrete step barrier: 0.9 m, a 60 mm step then a sloped face, both sides (struct 0 = concrete)
      const prof = [[0.3, -0.3], [0.3, 0.06], [0.24, 0.16], [0.1, 0.9]];
      for (const sd of [1, -1]) for (let q = 0; q + 1 < prof.length; q++) {
        const [w0, h0] = prof[q], [w1, h1] = prof[q + 1];
        quad(S, at(a, sd * w0, h0), at(b, sd * w0, h0), at(b, sd * w1, h1), at(a, sd * w1, h1), [nx * sd, (w0 - w1) * 2, nz * sd], [[0, h0], [l, h0], [l, h1], [0, h1]], [0]);
      }
      quad(S, at(a, 0.1, 0.9), at(b, 0.1, 0.9), at(b, -0.1, 0.9), at(a, -0.1, 0.9), [0, 1, 0], null, [0]);
    } else {
      // tensioned corrugated steel beam on Z posts every 3.2 m (struct 6 = galvanised steel)
      const faces = kind === 2 ? [1, -1] : [1, -1];
      for (const sd of faces) {
        quad(S, at(a, sd * 0.09, 0.45), at(b, sd * 0.09, 0.45), at(b, sd * 0.09, 0.76), at(a, sd * 0.09, 0.76), [nx * sd, 0, nz * sd], [[0, 0], [l, 0], [l, 0.31], [0, 0.31]], [6]);
        quad(S, at(a, sd * 0.09, 0.6), at(b, sd * 0.09, 0.6), at(b, sd * 0.13, 0.6), at(a, sd * 0.13, 0.6), [0, 1, 0], null, [6]);
      }
      quad(S, at(a, 0.09, 0.76), at(b, 0.09, 0.76), at(b, -0.09, 0.76), at(a, -0.09, 0.76), [0, 1, 0], null, [6]);
      const ang = Math.atan2(dz, dx);
      for (let sv = 1.6; sv < l; sv += 3.2) { const t = sv / l; box(S, a[0] + dx * t, a[1] + (b[1] - a[1]) * t - 0.4, a[2] + dz * t, ang, 0.06, 0.56, 0.05, 6); }
    }
  }
}

// ------------------------------------------------------------------ embankments
// Roads that climb to a bridge (net.rise, from roadProfile.js) get the ground built up under them: level
// with the road across the carriageway and pavements, then falling away at 1:1.7. The fill stops dead at
// a bridge end (the abutment) and never covers another road, pavement, railway, water or a building.
const EMB_CELL = 64, EMB_SLOPE = 0.6, EMB_REC = 11;
function initEmbankments(m) {
  NET.emb = null;
  const rise = m.rise, ea = m.ea, eb = m.eb;
  if (!rise || !ea) return;
  const brNode = new Set();
  for (let e = 0; e < m.flags.length; e++) if (m.flags[e] & 4) { brNode.add(ea[e]); brNode.add(eb[e]); }
  const seg = [], grid = new Map(), P = m.pts;
  for (let e = 0; e < m.flags.length; e++) {
    if (m.flags[e] & 12) continue;   // decks and tunnels
    const s = m.pstart[e], c = m.pcount[e];
    const cn = m.classes[m.cls[e]], walk = !NET.driveCls.has(m.cls[e]);
    const pw = m.pav[e] ? (/primary|secondary|trunk/.test(cn) ? 2.6 : 2.0) : 0.4;
    const hw = m.width[e] / 2 + (walk ? 0.6 : pw + 0.5);
    for (let k = 0; k + 1 < c; k++) {
      // next to a bridge the ground falls away under the deck, whatever the road was lifted by: always fill
      const capA = k === 0 && brNode.has(ea[e]), capB = k + 2 === c && brNode.has(eb[e]);
      const r = Math.max(rise[s + k], rise[s + k + 1], capA || capB ? 4 : 0);
      if (r < 0.06) continue;
      const a = (s + k) * 3, b = a + 3, id = seg.length / EMB_REC;
      seg.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], hw, capA ? 1 : 0, capB ? 1 : 0, r, walk ? 0 : m.width[e]);
      const R = hw + r / EMB_SLOPE + 1;
      for (let cx = Math.floor((Math.min(P[a], P[b]) - R) / EMB_CELL); cx <= Math.floor((Math.max(P[a], P[b]) + R) / EMB_CELL); cx++)
        for (let cz = Math.floor((Math.min(P[a + 2], P[b + 2]) - R) / EMB_CELL); cz <= Math.floor((Math.max(P[a + 2], P[b + 2]) + R) / EMB_CELL); cz++) {
          const key = cx * 65536 + cz; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(id);
        }
    }
  }
  if (seg.length) NET.emb = { seg: new Float32Array(seg), grid };
}
function embank(H, ox, oz, lcAt, edges = []) {
  const E = NET && NET.emb; if (!E) return;
  // carriageways of roads that are not raised (the road under a bridge, a slip road beside a ramp): a fill
  // that would bury one is left out there
  const low = [];
  for (const e of edges) {
    if (!NET.driveCls.has(NET.cls[e]) || (NET.flags[e] & 12)) continue;
    const s = NET.pstart[e], c = NET.pcount[e], P = NET.pts;
    for (let k = 0; k + 1 < c; k++) {
      if (Math.max(NET.rise[s + k], NET.rise[s + k + 1]) >= 0.06) continue;
      // (one grid step beyond its edge: the ground between grid points is interpolated)
      low.push(P[(s + k) * 3] - ox, P[(s + k) * 3 + 2] - oz, P[(s + k + 1) * 3] - ox, P[(s + k + 1) * 3 + 2] - oz, NET.width[e] / 2 + STEP, Math.max(P[(s + k) * 3 + 1], P[(s + k + 1) * 3 + 1]));
    }
  }
  const underLowRoad = (x, z, target) => {
    for (let q = 0; q < low.length; q += 6) {
      if (low[q + 5] + 0.15 > target) continue;
      const ax = low[q], az = low[q + 1], vx = low[q + 2] - ax, vz = low[q + 3] - az, L2 = vx * vx + vz * vz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      if (Math.hypot(ax + vx * t - x, az + vz * t - z) < low[q + 4]) return true;
    }
    return false;
  };
  const ids = new Set();
  for (let cx = Math.floor(ox / EMB_CELL); cx <= Math.floor((ox + TILE) / EMB_CELL); cx++)
    for (let cz = Math.floor(oz / EMB_CELL); cz <= Math.floor((oz + TILE) / EMB_CELL); cz++)
      for (const id of E.grid.get(cx * 65536 + cz) || []) ids.add(id);
  const S = E.seg;
  for (const id of ids) {
    const o = id * EMB_REC;
    const ax = S[o] - ox, ay = S[o + 1], az = S[o + 2] - oz, bx = S[o + 3] - ox, by = S[o + 4], bz = S[o + 5] - oz;
    const hw = S[o + 6], capA = S[o + 7], capB = S[o + 8], R = hw + S[o + 9] / EMB_SLOPE + 1;
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / STEP)), i1 = Math.min(NT - 1, Math.ceil((Math.max(ax, bx) + R) / STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R) / STEP)), j1 = Math.min(NT - 1, Math.ceil((Math.max(az, bz) + R) / STEP));
    const segL = Math.sqrt(L2);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * STEP, z = j * STEP;
      let t = ((x - ax) * vx + (z - az) * vz) / L2, beyond = 0;
      // at an abutment the fill runs on under the deck for one grid step as a steep spill slope, so the
      // road surface doesn't sag into the gap before the deck (never over a road, railway or water)
      if (t < 0) { if (capA) { beyond = -t * segL; if (beyond > STEP + 0.5) continue; } t = 0; }
      else if (t > 1) { if (capB) { beyond = (t - 1) * segL; if (beyond > STEP + 0.5) continue; } t = 1; }
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d > R) continue;
      const target = ay + (by - ay) * t - 0.06 - Math.max(0, d - hw) * EMB_SLOPE - beyond * 0.6, k = j * NT + i;
      if (target <= H[k]) continue;
      if (beyond > 0) { const cc = lcAt(x, z); if (cc === 1 || cc === 3 || cc === 4 || cc === 9) continue; }
      // (grid points on the tile edge are shared with the neighbour, which can't see this land cover: both
      // tiles must agree on them, so the land-cover test is left out there)
      const edge = i === 0 || j === 0 || i === NT - 1 || j === NT - 1, c = edge ? 0 : lcAt(x, z);
      if (c === 3 || (d > hw && (c === 1 || c === 2 || c === 4 || c === 8 || c === 9 || c === 10 || c === 12))) continue;
      if (underLowRoad(x, z, target)) continue;
      H[k] = target;
    }
  }
}

// ------------------------------------------------------------------ cuttings
// Where the ground stands above a road that runs on it (a road in a cutting narrower than the 4 m terrain
// grid can hold, the dip under a bridge, the island between two spans of a bridge), the carriageway and a
// metre and a half either side are cut down to the road, with 1:1 side slopes beyond, so the drawn road, its
// markings and the traffic on it agree. A road beside a higher one (a slip road climbing out of a cutting)
// never cuts into the ground that carries the higher road, nor into the ground under a railway line. Built
// from every road in the network, so the two tiles that share an edge cut it alike.
const CUT_REC = 9, CUT_FULL = 1.5, CUT_SLOPE = 1, CUT_BAND = 6, CUT_CELL = 32;
function initCuttings(m) {
  NET.cut = null;
  const seg = [], grid = new Map(), P = m.pts;
  for (let e = 0; e < m.flags.length; e++) {
    if ((m.flags[e] & 12) || !NET.driveCls.has(m.cls[e])) continue;   // decks and tunnels
    const s = m.pstart[e], c = m.pcount[e], hw = m.width[e] / 2;
    for (let k = 0; k + 1 < c; k++) {
      const a = (s + k) * 3, b = a + 3, id = seg.length / CUT_REC, R = hw + CUT_BAND;
      seg.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], hw, e, s + k);
      for (let cx = Math.floor((Math.min(P[a], P[b]) - R) / CUT_CELL); cx <= Math.floor((Math.max(P[a], P[b]) + R) / CUT_CELL); cx++)
        for (let cz = Math.floor((Math.min(P[a + 2], P[b + 2]) - R) / CUT_CELL); cz <= Math.floor((Math.max(P[a + 2], P[b + 2]) + R) / CUT_CELL); cz++) {
          const key = cx * 65536 + cz; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(id);
        }
    }
  }
  if (seg.length) NET.cut = { seg: new Float32Array(seg), grid };
}
// Every driveable centreline, bridges included, so the drawn carriageway can follow the road profile
// instead of the 4 m terrain grid (that grid is what put a diagonal crease across the lanes).
function initProfile(m) {
  const seg = [], grid = new Map(), P = m.pts, CELL = 32;
  for (let e = 0; e < m.flags.length; e++) {
    if ((m.flags[e] & 8) || !NET.driveCls.has(m.cls[e])) continue;
    const s = m.pstart[e], c = m.pcount[e], hw = m.width[e] / 2;
    for (let k = 0; k + 1 < c; k++) {
      const a = (s + k) * 3, b = a + 3, id = seg.length / 8, R = hw + 6;
      seg.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], hw, m.flags[e]);
      for (let cx = Math.floor((Math.min(P[a], P[b]) - R) / CELL); cx <= Math.floor((Math.max(P[a], P[b]) + R) / CELL); cx++)
        for (let cz = Math.floor((Math.min(P[a + 2], P[b + 2]) - R) / CELL); cz <= Math.floor((Math.max(P[a + 2], P[b + 2]) + R) / CELL); cz++) {
          const key = cx * 65536 + cz; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(id);
        }
    }
  }
  NET.profile = seg.length ? { seg: new Float32Array(seg), grid } : null;
}
// Nearest ground carriageway and nearest bridge, kept apart. A road under a span keeps the ground
// line; the bridge's own polygon is left out and the deck ribbon draws the span.
function profileAt(wx, wz) {
  const R = NET && NET.profile; if (!R) return null;
  const S = R.seg, cx = Math.floor(wx / 32), cz = Math.floor(wz / 32);
  let ground = null, bridge = null, gd = 1e9, bd = 1e9;
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    const ids = R.grid.get(ix * 65536 + iz); if (!ids) continue;
    for (let n = 0; n < ids.length; n++) {
      const o = ids[n] * 8, ax = S[o], ay = S[o + 1], az = S[o + 2], bx = S[o + 3], by = S[o + 4], bz = S[o + 5], hw = S[o + 6];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6;
      let t = ((wx - ax) * vx + (wz - az) * vz) / L2; if (t < -0.08 || t > 1.08) continue;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + vx * t - wx, az + vz * t - wz);
      if (d > hw + 2.2) continue;
      const rec = { y: ay + (by - ay) * t, d, hw };
      if (S[o + 7] & 4) { if (d < bd) { bd = d; bridge = rec; } }
      else if (d < gd) { gd = d; ground = rec; }
    }
  }
  return ground || bridge ? { ground, bridge } : null;
}
function cut(H, ox, oz, lcAt, A) {
  const C = NET && NET.cut; if (!C) return { floor: null, low: null, near: null };
  const H0 = H.slice();
  const ids = new Set();
  for (let cx = Math.floor(ox / CUT_CELL); cx <= Math.floor((ox + TILE) / CUT_CELL); cx++)
    for (let cz = Math.floor(oz / CUT_CELL); cz <= Math.floor((oz + TILE) / CUT_CELL); cz++)
      for (const id of C.grid.get(cx * 65536 + cz) || []) ids.add(id);
  // per grid point: the lowest the roads around it want the ground (low); the highest road whose drawn
  // surface it holds up, being within a grid step of its carriageway (floor); and whether it lies on a
  // carriageway at all (on)
  const low = new Float32Array(NT * NT).fill(Infinity), floor = new Float32Array(NT * NT).fill(-Infinity), on = new Uint8Array(NT * NT);
  const near = new Float32Array(NT * NT).fill(Infinity);   // the lowest road within a grid step of its carriageway
  const S = C.seg;
  for (const id of ids) {
    const o = id * CUT_REC, ax = S[o] - ox, ay = S[o + 1], az = S[o + 2] - oz, bx = S[o + 3] - ox, by = S[o + 4], bz = S[o + 5] - oz, hw = S[o + 6];
    const R = hw + CUT_BAND, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / STEP)), i1 = Math.min(NT - 1, Math.ceil((Math.max(ax, bx) + R) / STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R) / STEP)), j1 = Math.min(NT - 1, Math.ceil((Math.max(az, bz) + R) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * STEP, z = j * STEP, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t); if (d > R) continue;
      const y = ay + (by - ay) * t - 0.06, k = j * NT + i;
      const want = y + Math.max(0, d - hw - CUT_FULL) * CUT_SLOPE;
      if (want < low[k]) low[k] = want;
      if (d <= hw + STEP && y > floor[k]) floor[k] = y;
      if (d <= hw + STEP && y < near[k]) near[k] = y;
      if (d <= hw) on[k] = 1;
    }
  }
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) {
    const k = j * NT + i, want = Math.max(low[k], floor[k]);
    if (!(want < H[k])) continue;
    // off the carriageway the cut stops at buildings, water and the railway (land cover is left out on the
    // tile edge, which the neighbour shares but can't see)
    const edge = i === 0 || j === 0 || i === NT - 1 || j === NT - 1;
    if (!on[k]) { const c = edge ? 0 : lcAt(i * STEP, j * STEP); if (c === 3 || c === 4 || c === 9) continue; }
    H[k] = want;
  }
  // the tile's railway lines lie on the ground: every terrain cell a line runs through keeps its ground
  const RC = A.railC; let ci = 0;
  for (const n of A.railN) {
    for (let q = 0; q + 1 < n; q++) {
      const ax = RC[(ci + q) * 2] / 10, az = RC[(ci + q) * 2 + 1] / 10, bx = RC[(ci + q + 1) * 2] / 10, bz = RC[(ci + q + 1) * 2 + 1] / 10;
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 1) + 1;
      for (let u = 0; u <= steps; u++) {
        const x = ax + (bx - ax) * u / steps, z = az + (bz - az) * u / steps;
        const i = Math.max(0, Math.min(NT - 2, Math.floor(x / STEP))), j = Math.max(0, Math.min(NT - 2, Math.floor(z / STEP)));
        for (const k of [j * NT + i, j * NT + i + 1, (j + 1) * NT + i, (j + 1) * NT + i + 1]) H[k] = H0[k];
      }
    }
    ci += n;
  }
  return { floor, low, near };
}

// ------------------------------------------------------------------ railway lines the trains run on
// (rail.json): each segment with the reach of its trains either side of the line, the running tracks' offsets
// (trains.js) plus a car's half width and a clearance; nothing a bridge stands on may come within it
const RAIL_REC = 7;
function initRailLines(lines) {
  NET.rail = null;
  const seg = [], grid = new Map();
  for (const L of lines) {
    const p = L.p, n = p.length / 3, off = L.off;
    const reach = v => { if (!off || !off.f) return 2.5; const k = Math.max(0, Math.min(off.f.length - 1, Math.round(v / (off.ds || 20)))); return Math.max(Math.abs(off.f[k] || 0), Math.abs(off.b?.[k] || 0)); };
    let sv = 0;
    for (let i = 0; i + 1 < n; i++) {
      const a = i * 3, b = a + 3, len = Math.hypot(p[b] - p[a], p[b + 2] - p[a + 2]), hw = Math.max(reach(sv), reach(sv + len)) + 2.0, R = hw;
      const id = seg.length / RAIL_REC; seg.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], hw);
      for (let cx = Math.floor((Math.min(p[a], p[b]) - R) / CUT_CELL); cx <= Math.floor((Math.max(p[a], p[b]) + R) / CUT_CELL); cx++)
        for (let cz = Math.floor((Math.min(p[a + 2], p[b + 2]) - R) / CUT_CELL); cz <= Math.floor((Math.max(p[a + 2], p[b + 2]) + R) / CUT_CELL); cz++) {
          const key = cx * 65536 + cz; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(id);
        }
      sv += len;
    }
  }
  if (seg.length) NET.rail = { seg: new Float32Array(seg), grid };
}

// height of the trains' rails (rail.json) at a world point within reach m of a line's centre, or null
function railY(gx, gz, reach) {
  const R = NET && NET.rail; if (!R) return null;
  let best = null, bd = reach; const seen = new Set();
  for (let cx = Math.floor((gx - reach) / CUT_CELL); cx <= Math.floor((gx + reach) / CUT_CELL); cx++) for (let cz = Math.floor((gz - reach) / CUT_CELL); cz <= Math.floor((gz + reach) / CUT_CELL); cz++) for (const id of R.grid.get(cx * 65536 + cz) || []) {
    if (seen.has(id)) continue; seen.add(id);
    const o = id * RAIL_REC, C = R.seg, ax = C[o], az = C[o + 2], vx = C[o + 3] - ax, vz = C[o + 5] - az, L2 = vx * vx + vz * vz || 1e-6;
    const t = Math.max(0, Math.min(1, ((gx - ax) * vx + (gz - az) * vz) / L2)), d = Math.hypot(ax + vx * t - gx, az + vz * t - gz);
    if (d < bd) { bd = d; best = C[o + 1] + (C[o + 4] - C[o + 1]) * t; }
  }
  return best;
}
// The ground along the lines the trains run (rail.json) is brought to their track bed (the rails 0.32 m above
// it): cut down where it stands over the trains (an embankment the terrain model kept across a cutting), built
// up where they would hang above it, across the trains' reach and with 1:1 slopes beyond. It is never built
// over a road passing under the railway, in water or under a railway bridge's deck, and never cut into the
// ground a road beside the line stands on.
function railBed(H, ox, oz, lcAt, roads, A) {
  const R = NET && NET.rail; if (!R) return;
  const BAND = 8, decks = [];
  { const bm = A.brM, bp = A.brP; let off = 0;
    for (let k = 0; k < bm.length; k += 4) { const n = bm[k], w = bm[k + 1], kind = bm[k + 2]; if (kind === 2) for (let q = 0; q + 1 < n; q++) decks.push(bp[(off + q) * 3], bp[(off + q) * 3 + 2], bp[(off + q + 1) * 3], bp[(off + q + 1) * 3 + 2], w / 2 + 2); off += n; } }
  const underDeck = (x, z) => { for (let q = 0; q < decks.length; q += 5) { const ax = decks[q], az = decks[q + 1], vx = decks[q + 2] - ax, vz = decks[q + 3] - az, L2 = vx * vx + vz * vz || 1e-6, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); if (Math.hypot(ax + vx * t - x, az + vz * t - z) < decks[q + 4]) return true; } return false; };
  const ids = new Set();
  for (let cx = Math.floor(ox / CUT_CELL); cx <= Math.floor((ox + TILE) / CUT_CELL); cx++)
    for (let cz = Math.floor(oz / CUT_CELL); cz <= Math.floor((oz + TILE) / CUT_CELL); cz++) for (const id of R.grid.get(cx * 65536 + cz) || []) ids.add(id);
  if (!ids.size) return;
  const top = new Float32Array(NT * NT).fill(Infinity), bot = new Float32Array(NT * NT).fill(-Infinity), on = new Uint8Array(NT * NT), C = R.seg;
  for (const id of ids) {
    const o = id * RAIL_REC, ax = C[o] - ox, ay = C[o + 1] - 0.32, az = C[o + 2] - oz, bx = C[o + 3] - ox, by = C[o + 4] - 0.32, bz = C[o + 5] - oz, hw = C[o + 6] - 0.6;
    const Rr = hw + BAND, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - Rr) / STEP)), i1 = Math.min(NT - 1, Math.ceil((Math.max(ax, bx) + Rr) / STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - Rr) / STEP)), j1 = Math.min(NT - 1, Math.ceil((Math.max(az, bz) + Rr) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * STEP, z = j * STEP, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d > Rr) continue;
      const y = ay + (by - ay) * t, k = j * NT + i, beyond = Math.max(0, d - hw);
      top[k] = Math.min(top[k], y + beyond);
      bot[k] = Math.max(bot[k], y - beyond);
      if (d <= hw) on[k] = 1;
    }
  }
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) {
    const k = j * NT + i, edge = i === 0 || j === 0 || i === NT - 1 || j === NT - 1, x = i * STEP, z = j * STEP;
    if (H[k] > top[k] + 0.1) {
      const c = edge || on[k] ? 0 : lcAt(x, z); if (c === 3) continue;
      // (a road well above the line where the trains run crosses it on a bridge, even where the map stops the
      // bridge short of the track: the trains win, and the road is carried on a deck over the gap)
      const f = roads.floor ? roads.floor[k] : -Infinity, v = on[k] && f > top[k] + 1.5 ? top[k] : Math.max(top[k], f);
      if (v < H[k]) H[k] = v;
    } else if (H[k] < bot[k] - 0.1) {
      const c = edge ? 0 : lcAt(x, z);
      if (c === 4 || (!on[k] && c === 3)) continue;
      // a road passes under the railway here, or runs below it within a grid step (its drawn surface rests
      // on this ground): the embankment never builds up over it
      if ((roads.low && roads.low[k] < bot[k] - 0.1) || (roads.near && roads.near[k] < bot[k] - 0.1)) continue;
      if (underDeck(x, z)) continue;                          // the trains cross on a bridge
      H[k] = bot[k];
    }
  }
}

// ------------------------------------------------------------------ station platforms
// Stations in a cutting: the ground under each platform and its track (stations.js footprints), and a grid
// step around them, is cut down to the rails, rising beyond at 1:1, so the platform isn't buried in the side
// of the cutting (the 4 m terrain grid would tilt the ground up through its back).
function initPlatforms(flat) {
  NET.plat = [];
  for (let i = 0; i < flat.length;) {
    const n = flat[i++], q = [];
    for (let k = 0; k < n; k++, i += 5) q.push(flat.slice(i, i + 5));
    for (let k = 0; k + 1 < n; k++) {
      const [ax, az, bx, bz, ra] = q[k], [cx, cz, dx, dz, rb] = q[k + 1];
      NET.plat.push({ ring: [[ax, az], [bx, bz], [dx, dz], [cx, cz]], ra, rb, x0: Math.min(ax, bx, cx, dx), x1: Math.max(ax, bx, cx, dx), z0: Math.min(az, bz, cz, dz), z1: Math.max(az, bz, cz, dz) });
    }
  }
}
function cutPlatforms(H, ox, oz, lcAt, floor) {
  const BAND = 10;
  for (const P of NET && NET.plat || []) {
    if (P.x1 + BAND < ox || P.x0 - BAND > ox + TILE || P.z1 + BAND < oz || P.z0 - BAND > oz + TILE) continue;
    const R = P.ring.map(([x, z]) => [x - ox, z - oz]);
    // along the platform: from the a-c side (k) to the b-d side (k + 1) for the rail height
    const mx0 = (R[0][0] + R[1][0]) / 2, mz0 = (R[0][1] + R[1][1]) / 2, mx1 = (R[3][0] + R[2][0]) / 2, mz1 = (R[3][1] + R[2][1]) / 2;
    const ux = mx1 - mx0, uz = mz1 - mz0, L2 = ux * ux + uz * uz || 1e-6;
    const i0 = Math.max(0, Math.floor((P.x0 - ox - BAND) / STEP)), i1 = Math.min(NT - 1, Math.ceil((P.x1 - ox + BAND) / STEP));
    const j0 = Math.max(0, Math.floor((P.z0 - oz - BAND) / STEP)), j1 = Math.min(NT - 1, Math.ceil((P.z1 - oz + BAND) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * STEP, z = j * STEP;
      let d = Infinity;
      if (!insideRing(R, x, z)) for (let q = 0; q < 4; q++) {
        const [ax, az] = R[q], [bx, bz] = R[(q + 1) % 4], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        d = Math.min(d, Math.hypot(ax + vx * t - x, az + vz * t - z));
      } else d = 0;
      if (d > BAND) continue;
      const t = Math.max(0, Math.min(1, ((x - mx0) * ux + (z - mz0) * uz) / L2)), k = j * NT + i;
      // (under the platform and a grid step around it the platform wins: the terrain grid would otherwise
      // tilt the ground up through its back; further out it never cuts into the ground a road stands on,
      // nor under buildings or into water)
      const base = P.ra + (P.rb - P.ra) * t - 0.12 + Math.max(0, d - STEP), want = d > STEP ? Math.max(base, floor ? floor[k] : -Infinity) : base;
      if (!(want < H[k])) continue;
      if (d > STEP) { const edge = i === 0 || j === 0 || i === NT - 1 || j === NT - 1, c = edge ? 0 : lcAt(x, z); if (c === 3 || c === 4) continue; }
      H[k] = want;
    }
  }
}

// ------------------------------------------------------------------ growable buffers
const BR = 14;   // floats per breakable record (see build: brkRec)
class Buf {
  constructor(extra = 0) { this.p = []; this.n = []; this.x = []; this.extra = extra; this.uv = []; }
  v(x, y, z, nx, ny, nz, u, w, ...ex) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); for (let i = 0; i < this.extra; i++) this.x.push(ex[i] ?? 0); }
  pack() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv),
      extra: this.extra ? new Float32Array(this.x) : null, count: this.p.length / 3 };
  }
}
function triN(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
// quad a-b-c-d (ccw seen from the side the normal faces); want normal hint w
function quad(B, a, b, c, d, hint, uvs, ex) {
  let n = triN(...a, ...b, ...c);
  if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, d] = [d, b]; uvs = uvs && [uvs[0], uvs[3], uvs[2], uvs[1]]; n = n.map(v => -v); }
  const U = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
  B.v(...a, ...n, ...U[0], ...ex); B.v(...b, ...n, ...U[1], ...ex); B.v(...c, ...n, ...U[2], ...ex);
  B.v(...a, ...n, ...U[0], ...ex); B.v(...c, ...n, ...U[2], ...ex); B.v(...d, ...n, ...U[3], ...ex);
}
function tri(B, a, b, c, hint, uvs, ex) {
  let n = triN(...a, ...b, ...c);
  if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, c] = [c, b]; uvs = uvs && [uvs[0], uvs[2], uvs[1]]; n = n.map(v => -v); }
  const U = uvs || [[0, 0], [1, 0], [0, 1]];
  B.v(...a, ...n, ...U[0], ...ex); B.v(...b, ...n, ...U[1], ...ex); B.v(...c, ...n, ...U[2], ...ex);
}

// ------------------------------------------------------------------ build
function build(header, A, lod) {
  const ox = header.ix * TILE, oz = header.iz * TILE, hmin = header.hmin;
  const H = new Float32Array(NT * NT);
  for (let i = 0; i < H.length; i++) H[i] = hmin + A.h[i] / 100;
  const lc = A.lc;  // 128x128 at 2 m
  const lcAt = (x, z) => lc[Math.min(127, Math.max(0, z >> 1)) * 128 + Math.min(127, Math.max(0, x >> 1))];
  embank(H, ox, oz, lcAt, header.edges);
  const roads = cut(H, ox, oz, lcAt, A);
  railBed(H, ox, oz, lcAt, roads, A);
  cutPlatforms(H, ox, oz, lcAt, roads.floor);
  // terrain surface height (matches triangle split of the terrain mesh)
  const hAt = (x, z) => {
    const gx = Math.max(0, Math.min(NT - 1.0001, x / STEP)), gz = Math.max(0, Math.min(NT - 1.0001, z / STEP));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    const h00 = H[j * NT + i], h10 = H[j * NT + i + 1], h01 = H[(j + 1) * NT + i], h11 = H[(j + 1) * NT + i + 1];
    return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  };
  const out = { ix: header.ix, iz: header.iz, ox, oz, hmin, heights: H, lc: new Uint8Array(lc) };
  // exact carriageway test (the tile's road polygons): no lamp post, tree or street furniture stands in a road
  const inRoad = roadIndex(A);
  // ...nor on a railway or in water (2 m landcover)
  const blocked = (x, z, r = 0.5) => inRoad(x, z, r) || [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([a, b]) => { const c = lcAt(x + a, z + b); return c === 9 || c === 4; });

  // ---------------- terrain
  const tstep = lod ? 4 : 1; // grid stride in samples
  const tn = (NT - 1) / tstep + 1;
  const tp = new Float32Array(tn * tn * 3), tnor = new Float32Array(tn * tn * 3);
  for (let j = 0; j < tn; j++) for (let i = 0; i < tn; i++) {
    const gi = i * tstep, gj = j * tstep, k = (j * tn + i) * 3;
    let y = H[gj * NT + gi];
    if (!lod) { // sink terrain under hard surfaces so draped surfaces never clip
      const c = lcAt(gi * STEP, gj * STEP);
      if (c === 1 || c === 2 || c === 3 || c === 8 || c === 12 || c === 10) y -= 0.25;
    }
    tp[k] = gi * STEP; tp[k + 1] = y; tp[k + 2] = gj * STEP;
    const hl = H[gj * NT + Math.max(0, gi - 1)], hr = H[gj * NT + Math.min(NT - 1, gi + 1)];
    const hu = H[Math.max(0, gj - 1) * NT + gi], hd = H[Math.min(NT - 1, gj + 1) * NT + gi];
    const dx = (hr - hl) / ((Math.min(NT - 1, gi + 1) - Math.max(0, gi - 1)) * STEP), dz = (hd - hu) / ((Math.min(NT - 1, gj + 1) - Math.max(0, gj - 1)) * STEP);
    const l = Math.hypot(dx, 1, dz); tnor[k] = -dx / l; tnor[k + 1] = 1 / l; tnor[k + 2] = -dz / l;
  }
  const tidx = new Uint32Array((tn - 1) * (tn - 1) * 6); let ti = 0;
  for (let j = 0; j < tn - 1; j++) for (let i = 0; i < tn - 1; i++) {
    const a = j * tn + i, b = a + 1, c = a + tn, d = c + 1;
    tidx[ti++] = a; tidx[ti++] = d; tidx[ti++] = b; tidx[ti++] = a; tidx[ti++] = c; tidx[ti++] = d;
  }
  out.terrain = { position: tp, normal: tnor, index: tidx };

  // ---------------- buildings (both LODs)
  out.buildings = buildBuildings(header, A, lod, hAt, ox, oz, lcAt);
  // ---------------- open water (both LODs): surfaces over the carved beds, and the level grid for swimming
  if (A.wl && A.wtP && A.wtP.length) { out.water = buildWater(A, hAt); out.wl = new Int16Array(A.wl); }
  // street lamps: one standing in a carriageway (an OSM position a little off, or an inferred one at a junction
  // mouth or on the far carriageway) is moved just behind the nearest kerb, or dropped if there's no room there
  const lp = A.lp, lampL = [];
  for (let k = 0; k < lp.length; k += 4) {
    let x = lp[k], z = lp[k + 1], a = lp[k + 2];
    if (inRoad(x, z, 0.35)) {
      const q = inRoad.outside(x, z, 0.75);
      if (!q || inRoad(q[0], q[1], 0.35) || lcAt(q[0], q[1]) === 3 || lcAt(q[0], q[1]) === 9) continue;
      a = Math.atan2(z - q[1], x - q[0]);          // the arm still reaches out over the road
      x = q[0]; z = q[1];
    }
    lampL.push(x, hAt(x, z) + 0.17, z, a);
  }
  const lamps = new Float32Array(lampL);
  out.lamps = lamps;
  if (lod) return out;

  // ---------------- surfaces
  const G = new Buf(1);
  const surf = (pre, id, lift, kerb) => {
    const C = A[pre + 'C'], R = A[pre + 'R'], P = A[pre + 'P'];
    let ci = 0, ri = 0;
    for (let pi = 0; pi < P.length; pi++) {
      const flat = [], holes = [], rings = [];
      for (let k = 0; k < P[pi]; k++) {
        const n = R[ri++];
        if (k) holes.push(flat.length / 2);
        const ring = [];
        for (let q = 0; q < n; q++) { const x = C[(ci + q) * 2] / 10, z = C[(ci + q) * 2 + 1] / 10; flat.push(x, z); ring.push([x, z]); }
        ci += n; rings.push(ring);
      }
      const t = earcut(flat, holes.length ? holes : null);
      for (let q = 0; q < t.length; q += 3) {
        const P3 = [t[q], t[q + 1], t[q + 2]].map(i => {
          const x = flat[i * 2], z = flat[i * 2 + 1];
          const pr = id === 0 ? profileAt(x + ox, z + oz) : null;
          const g = pr && pr.ground && pr.ground.d <= pr.ground.hw + 0.8 ? pr.ground : null;
          const br = pr && pr.bridge && pr.bridge.d <= pr.bridge.hw + 0.4 ? pr.bridge : null;
          // one height from the centreline, the same all the way across, so the earcut diagonal
          // is not a kink. A point on a road under a bridge stays on that road.
          const onGround = !!(g && g.d <= g.hw + 0.35);
          const y = onGround ? g.y + 0.04 : hAt(x, z) + lift;
          return { x, y, z, bridge: !!(br && !onGround) };
        });
        if (id === 0 && P3.filter(v => v.bridge).length >= 2) continue;
        tri(G, [P3[0].x, P3[0].y, P3[0].z], [P3[1].x, P3[1].y, P3[1].z], [P3[2].x, P3[2].y, P3[2].z], [0, 1, 0], null, [id]);
      }
      if (kerb) for (const ring of rings) for (let q = 0; q < ring.length; q++) {
        const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
        if ((Math.abs(x0 - x1) < 1e-3 && Math.abs(x0 / 32 - Math.round(x0 / 32)) < 1e-4) || (Math.abs(z0 - z1) < 1e-3 && Math.abs(z0 / 32 - Math.round(z0 / 32)) < 1e-4)) continue;
        const y0 = hAt(x0, z0), y1 = hAt(x1, z1);
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
        quad(G, [x0, y0 + 0.02, z0], [x1, y1 + 0.02, z1], [x1, y1 + lift, z1], [x0, y0 + lift, z0], [-dz / l, 0, dx / l], null, [2]);
      }
    }
  };
  surf('road', 0, 0.05, false);
  surf('plaza', 4, 0.09, false);
  surf('path', 3, 0.07, false);
  surf('pave', 1, 0.17, true);

  // ---------------- bridges (decks in ground mesh, structure in struct mesh)
  const S = new Buf(1);
  // what stands under a deck, which its piers and end walls keep clear of: the land cover at a spot (roads,
  // pavements, paths, plazas, water, railway) and the roads and railway lines passing under a line beneath it,
  // as [arc length along the line, half width along it, kind (1 road, 2 railway), its direction, sin of the angle]
  const segX = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return null;
    const qx = cx - ax, qz = cz - az, t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
  };
  const railSegs = []; { let ci = 0; for (const n of A.railN) { for (let q = 0; q + 1 < n; q++) railSegs.push(A.railC[(ci + q) * 2] / 10, A.railC[(ci + q) * 2 + 1] / 10, A.railC[(ci + q + 1) * 2] / 10, A.railC[(ci + q + 1) * 2 + 1] / 10); ci += n; } }
  const clearOf = c => c === 1 || c === 2 || c === 4 || c === 9 || c === 10 || c === 12;
  const site = {
    piers: [],   // every pier drawn: x, z, its axis, half length along it and half width across, foot and top (out.piers)
    ok: (x, z) => {
      for (const [dx, dz] of [[0, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) { const px = x + dx, pz = z + dz; if (px < 0 || pz < 0 || px >= TILE || pz >= TILE) continue; if (clearOf(lcAt(px, pz))) return false; }
      for (const P of NET && NET.plat || []) if (x + ox > P.x0 - 1.5 && x + ox < P.x1 + 1.5 && z + oz > P.z0 - 1.5 && z + oz < P.z1 + 1.5) return false;   // nor on a station platform
      return true;
    },
    // a spot clear of the trains' lines (their reach, rail.json) and of the carriageways (with a verge) that
    // pass below a deck at height top, whichever way they run
    clear: (x, z, top, roads = true) => {
      const gx = x + ox, gz = z + oz, k = Math.floor(gx / CUT_CELL) * 65536 + Math.floor(gz / CUT_CELL);
      const near = (C, rec, ids, pad) => { for (const id of ids || []) {
        const o = id * rec, ax = C[o], az = C[o + 2], vx = C[o + 3] - ax, vz = C[o + 5] - az, L2 = vx * vx + vz * vz || 1e-6, t = Math.max(0, Math.min(1, ((gx - ax) * vx + (gz - az) * vz) / L2));
        if (C[o + 1] + (C[o + 4] - C[o + 1]) * t > top - 2) continue;   // up on the deck, not below it
        if (Math.hypot(ax + vx * t - gx, az + vz * t - gz) < C[o + 6] + pad) return true;
      } return false; };
      if (NET && NET.rail && near(NET.rail.seg, RAIL_REC, NET.rail.grid.get(k), 0.8)) return false;
      if (roads && NET && NET.cut && near(NET.cut.seg, CUT_REC, NET.cut.grid.get(k), 2.0)) return false;
      return true;
    },
    wallOk: (ax, az, bx, bz) => { for (let q = 0; q <= 8; q++) { const px = ax + (bx - ax) * q / 8, pz = az + (bz - az) * q / 8; if (px < 0 || pz < 0 || px >= TILE || pz >= TILE) continue; const c = lcAt(px, pz); if (c === 1 || c === 9) return false; } return true; },
    under: (line, cum) => {
      const out = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of line) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
      const add = (i, t, ux, uz, half, kind) => {
        const a = line[i], b = line[i + 1], lx = b[0] - a[0], lz = b[2] - a[2], ll = Math.hypot(lx, lz) || 1, ul = Math.hypot(ux, uz) || 1;
        const sin = Math.max(0.3, Math.abs(lx * uz - lz * ux) / (ll * ul));
        out.push([cum[i] + (cum[i + 1] - cum[i]) * t, half / sin, kind, ux / ul, uz / ul, sin]);
      };
      const deckY = (i, t) => line[i][1] + (line[i + 1][1] - line[i][1]) * t;
      if (NET && NET.cut) {
        const C = NET.cut.seg, ids = new Set();
        for (let cx = Math.floor((x0 + ox) / CUT_CELL); cx <= Math.floor((x1 + ox) / CUT_CELL); cx++)
          for (let cz = Math.floor((z0 + oz) / CUT_CELL); cz <= Math.floor((z1 + oz) / CUT_CELL); cz++) for (const id of NET.cut.grid.get(cx * 65536 + cz) || []) ids.add(id);
        for (const id of ids) {
          const o = id * CUT_REC, ax = C[o] - ox, ay = C[o + 1], az = C[o + 2] - oz, bx = C[o + 3] - ox, by = C[o + 4], bz = C[o + 5] - oz;
          for (let i = 0; i + 1 < line.length; i++) {
            const X = segX(line[i][0], line[i][2], line[i + 1][0], line[i + 1][2], ax, az, bx, bz); if (!X) continue;
            if (deckY(i, X[0]) - (ay + (by - ay) * X[1]) < 3) continue;   // not beneath: it joins the deck or runs over it
            add(i, X[0], bx - ax, bz - az, C[o + 6], 1);
          }
        }
      }
      if (NET && NET.rail) {
        const C = NET.rail.seg, ids = new Set();
        for (let cx = Math.floor((x0 + ox) / CUT_CELL); cx <= Math.floor((x1 + ox) / CUT_CELL); cx++)
          for (let cz = Math.floor((z0 + oz) / CUT_CELL); cz <= Math.floor((z1 + oz) / CUT_CELL); cz++) for (const id of NET.rail.grid.get(cx * 65536 + cz) || []) ids.add(id);
        for (const id of ids) {
          const o = id * RAIL_REC, ax = C[o] - ox, ay = C[o + 1], az = C[o + 2] - oz, bx = C[o + 3] - ox, by = C[o + 4], bz = C[o + 5] - oz;
          for (let i = 0; i + 1 < line.length; i++) {
            const X = segX(line[i][0], line[i][2], line[i + 1][0], line[i + 1][2], ax, az, bx, bz); if (!X) continue;
            if (deckY(i, X[0]) - (ay + (by - ay) * X[1]) < 3) continue;   // the line runs on this deck, not under it
            add(i, X[0], bx - ax, bz - az, C[o + 6], 2);
          }
        }
      }
      for (let q = 0; q < railSegs.length; q += 4) {
        const ax = railSegs[q], az = railSegs[q + 1], bx = railSegs[q + 2], bz = railSegs[q + 3];
        for (let i = 0; i + 1 < line.length; i++) {
          const X = segX(line[i][0], line[i][2], line[i + 1][0], line[i + 1][2], ax, az, bx, bz); if (!X) continue;
          if (deckY(i, X[0]) - (hAt(ax + (bx - ax) * X[1], az + (bz - az) * X[1]) + 0.12) < 3) continue;
          add(i, X[0], bx - ax, bz - az, 1.7, 2);
        }
      }
      // one entry per crossing (a polyline meets the line twice where it crosses at one of its vertices)
      out.sort((p, q) => p[0] - q[0]);
      return out.filter((p, k) => !k || Math.abs(p[0] - out[k - 1][0]) > 0.05 || p[2] !== out[k - 1][2]);
    },
  };
  const bm = A.brM, bp = A.brP, deckLines = [];   // every bridge deck as drawn: n, kind, width, then its points (out.deckLines)
  let off = 0;
  for (let k = 0; k < bm.length; k += 4) {
    const n = bm[k], w = bm[k + 1], kind = bm[k + 2], e = bm[k + 3];
    // deck heights come from the network (roadProfile.js aligns decks with their approaches)
    const live = NET && e >= 0 && NET.pcount[e] === n ? NET.pstart[e] : -1;
    const pts = []; for (let q = 0; q < n; q++) pts.push([bp[(off + q) * 3], live >= 0 ? NET.pts[(live + q) * 3 + 1] : bp[(off + q) * 3 + 1], bp[(off + q) * 3 + 2]]);
    off += n;
    if (kind === 2 && live < 0) {
      // a railway bridge carries its line at the trains' height (rail.json, 0.2 m below their rails): where the
      // tile's deck sits lower or higher than the line, the deck follows the line. The bridges of the tracks
      // beside a line (sidings, the other pair, junction tracks) are brought up to its level where they sit
      // well below it (the pipeline's deck heights can lie on the road beneath)
      const on = pts.map(p => railY(p[0] + ox, p[2] + oz, 4.5) != null);
      const ys = pts.map(p => { const at = railY(p[0] + ox, p[2] + oz, 4.5); if (at != null) return at; const by = railY(p[0] + ox, p[2] + oz, 40); return by != null && by - 0.2 - p[1] > 1 ? by : null; });
      const got = ys.map((v, q) => v == null ? -1 : q).filter(q => q >= 0);
      // (between the points that found a line the deck runs straight; past the last it holds that level)
      if (got.length) for (let q = 0; q < n; q++) {
        if (ys[q] != null) { pts[q][1] = ys[q] - 0.2; continue; }
        const a = got.filter(g => g < q).pop(), b = got.find(g => g > q);
        pts[q][1] = a != null && b != null ? ys[a] - 0.2 + (ys[b] - ys[a]) * (q - a) / (b - a) : ys[a ?? b] - 0.2;
      }
      // where no train runs (a chord, a branch, sidings) a railway bridge still clears the roads beneath it:
      // 4.8 m under a 1.2 m deck, its deck rising to that at 1 in 50 from the trains' line or its ends (the
      // trains' own lines climb to clear the roads they cross: build_rail.mjs)
      if (on.some(v => !v) && NET && NET.cut) {
        const C = NET.cut.seg, ids = new Set(), need = [];
        const cm = [0]; for (let q = 1; q < n; q++) cm.push(cm[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][2] - pts[q - 1][2]));
        const bx0 = Math.min(...pts.map(p => p[0])) + ox, bx1 = Math.max(...pts.map(p => p[0])) + ox, bz0 = Math.min(...pts.map(p => p[2])) + oz, bz1 = Math.max(...pts.map(p => p[2])) + oz;
        for (let cx = Math.floor(bx0 / CUT_CELL); cx <= Math.floor(bx1 / CUT_CELL); cx++) for (let cz = Math.floor(bz0 / CUT_CELL); cz <= Math.floor(bz1 / CUT_CELL); cz++) for (const id of NET.cut.grid.get(cx * 65536 + cz) || []) ids.add(id);
        for (const id of ids) {
          const o = id * CUT_REC, ax = C[o] - ox, ay = C[o + 1], az = C[o + 2] - oz, bx = C[o + 3] - ox, by = C[o + 4], bz = C[o + 5] - oz;
          for (let q = 0; q + 1 < n; q++) {
            const X = segX(pts[q][0], pts[q][2], pts[q + 1][0], pts[q + 1][2], ax, az, bx, bz); if (!X) continue;
            const deck = pts[q][1] + (pts[q + 1][1] - pts[q][1]) * X[0], road = ay + (by - ay) * X[1];
            // (a road beneath, not one joining the bridge, and not where the trains cross on it)
            if (deck - road > 0.5 && road + 6 > deck && !(on[q] && on[q + 1])) need.push([cm[q] + (cm[q + 1] - cm[q]) * X[0], road + 6]);
          }
        }
        for (const [sv, req] of need) for (let q = 0; q < n; q++) if (!on[q]) pts[q][1] = Math.max(pts[q][1], req - Math.abs(cm[q] - sv) / 50);
      }
    }
    ribbonDeck(G, S, pts, w, kind, hAt, true, 3, site, kind === 0 && w >= 6.5 && e >= 0 && NET && !(NET.flags[e] & 1));
    deckLines.push(n, kind, w); for (const p of pts) deckLines.push(p[0], p[1], p[2]);
    if(kind===2) permanentWay(S,pts);
  }
  // spans the pipeline dropped (the M4 over the River Loddon), drawn in the tile holding their middle
  const addedHere = [];
  for (const e of NET ? NET.added : []) {
    const st = NET.pstart[e], n = NET.pcount[e], P = NET.pts;
    let inside = false;
    for (let q = 0; q < n; q++) { const x = P[(st + q) * 3] - ox, z = P[(st + q) * 3 + 2] - oz; if (x > -20 && x < TILE + 20 && z > -20 && z < TILE + 20) inside = true; }
    if (!inside) continue;
    addedHere.push(e);
    const m = Math.floor(n / 2), mx = P[(st + m) * 3] - ox, mz = P[(st + m) * 3 + 2] - oz;
    if (mx < 0 || mx >= TILE || mz < 0 || mz >= TILE) continue;
    const pts = []; for (let q = 0; q < n; q++) pts.push([P[(st + q) * 3] - ox, P[(st + q) * 3 + 1], P[(st + q) * 3 + 2] - oz]);
    ribbonDeck(G, S, pts, NET.width[e], 0, hAt, true, 3, site, NET.width[e] >= 6.5 && !(NET.flags[e] & 1));
    deckLines.push(n, 0, NET.width[e]); for (const p of pts) deckLines.push(p[0], p[1], p[2]);
  }
  // approach slabs: the deck carried on along roads leaving a bridge while they stand above the ground
  // (roadProfile.js net.slabRange); drawn by the tile holding their middle, without parapets
  for (let [e, lo, hi] of NET ? NET.slabs : []) {
    const st = NET.pstart[e], n = NET.pcount[e], P = NET.pts, cum = NET.cum, at = sv => {
      let i = 1; while (i < n - 1 && cum[st + i] < sv) i++;
      const a = st + i - 1, b = st + i, t = Math.max(0, Math.min(1, (sv - cum[a]) / ((cum[b] - cum[a]) || 1)));
      return [P[a * 3] + (P[b * 3] - P[a * 3]) * t - ox, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t - oz];
    };
    hi = Math.min(hi, cum[st + n - 1]);
    const m = at((lo + hi) / 2); if (m[0] < 0 || m[0] >= TILE || m[2] < 0 || m[2] >= TILE) continue;
    const pts = [at(lo)]; for (let q = 0; q < n; q++) { const sv = cum[st + q]; if (sv > lo + 0.3 && sv < hi - 0.3) pts.push(at(sv)); } pts.push(at(hi));
    ribbonDeck(G, S, pts, NET.width[e], 0, hAt, false, 3, site, NET.width[e] >= 6.5 && !(NET.flags[e] & 1));
  }
  // a road standing clear of the ground drawn under it (a raised road the ground couldn't be built up under,
  // a slip road climbing beside a cutting the terrain grid can't hold) rides on a deck instead of hanging over
  // the ground. Each tile decks the part of a road inside it and tells the main thread which segments ride on
  // a deck (tiles.js); markings on a decked piece follow the deck (deckOf)
  const deckOf = new Map(), deckSegs = [];
  const addPiece = (e, a, b, hw) => { let l = deckOf.get(e); if (!l) deckOf.set(e, l = []); l.push([a[0], a[1], a[2], b[0], b[1], b[2], hw]); };
  for (let [e, lo, hi] of NET ? NET.slabs : []) {   // approach slabs and links between spans (drawn above)
    const st = NET.pstart[e], n = NET.pcount[e], P = NET.pts, cum = NET.cum;
    for (let q = 0; q + 1 < n; q++) {
      const c0 = cum[st + q], c1 = cum[st + q + 1]; if (c1 < lo || c0 > hi || c1 - c0 < 1e-3) continue;
      const at = sv => { const t = Math.max(0, Math.min(1, (sv - c0) / (c1 - c0))), i = (st + q) * 3; return [P[i] + (P[i + 3] - P[i]) * t - ox, P[i + 1] + (P[i + 4] - P[i + 1]) * t, P[i + 2] + (P[i + 5] - P[i + 2]) * t - oz]; };
      const a = at(Math.max(lo, c0)), b = at(Math.min(hi, c1));
      if (Math.max(a[0], b[0]) < -10 || Math.min(a[0], b[0]) > TILE + 10 || Math.max(a[2], b[2]) < -10 || Math.min(a[2], b[2]) > TILE + 10) continue;
      addPiece(e, a, b, NET.width[e] / 2);
    }
  }
  if (NET && NET.cut) {
    const C = NET.cut.seg, ids = new Set(), runs = new Map();
    for (let cx = Math.floor(ox / CUT_CELL); cx <= Math.floor((ox + TILE) / CUT_CELL); cx++)
      for (let cz = Math.floor(oz / CUT_CELL); cz <= Math.floor((oz + TILE) / CUT_CELL); cz++) for (const id of NET.cut.grid.get(cx * 65536 + cz) || []) ids.add(id);
    for (const id of ids) {
      const o = id * CUT_REC, e = C[o + 7], j = C[o + 8], hw = C[o + 6];
      const sl = NET.slabOf.get(e); if (sl && sl.some(([lo, hi]) => NET.cum[j + 1] >= lo && NET.cum[j] <= hi)) continue;
      // the part of the segment inside this tile
      const ax = C[o] - ox, ay = C[o + 1], az = C[o + 2] - oz, vx = C[o + 3] - ox - ax, vy = C[o + 4] - ay, vz = C[o + 5] - oz - az;
      let t0 = 0, t1 = 1;
      for (const [p0, d] of [[ax, vx], [az, vz]]) {
        if (Math.abs(d) < 1e-9) { if (p0 < 0 || p0 >= TILE) t1 = -1; continue; }
        const ta = (0 - p0) / d, tb = (TILE - p0) / d;
        t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t1 - t0 < 1e-4) continue;
      let sag = 0;
      for (let q = 0; q <= 4; q++) { const t = t0 + (t1 - t0) * q / 4; sag = Math.max(sag, ay + vy * t - (hAt(Math.min(TILE - 1e-3, ax + vx * t), Math.min(TILE - 1e-3, az + vz * t)) + 0.05)); }
      if (sag <= 0.35) continue;
      const at = t => [ax + vx * t, ay + vy * t, az + vz * t];
      if (!runs.has(e)) runs.set(e, []);
      runs.get(e).push({ j, t0, t1, a: at(t0), b: at(t1), hw });
    }
    for (const [e, list] of runs) {
      // consecutive pieces of a road make one deck; where a piece stops at the tile edge the deck goes on in
      // the neighbour, so no end wall there
      list.sort((p, q) => p.j - q.j);
      let cur = null;
      const flush = () => { if (cur) ribbonDeck(G, S, cur.pts, cur.hw * 2, 0, hAt, false, (cur.c0 ? 0 : 1) | (cur.c1 ? 0 : 2), site, cur.hw * 2 >= 6.5 && !(NET.flags[e] & 1)); cur = null; };
      for (const p of list) {
        if (cur && p.j === cur.j + 1 && cur.t1 === 1 && p.t0 === 0) { cur.pts.push(p.b); cur.j = p.j; cur.t1 = p.t1; cur.c1 = p.t1 < 1; }
        else { flush(); cur = { pts: [p.a, p.b], hw: p.hw, c0: p.t0 > 0, c1: p.t1 < 1, j: p.j, t1: p.t1 }; }
        deckSegs.push(p.j); addPiece(e, p.a, p.b, p.hw);
      }
      flush();
    }
  }
  out.decks = new Int32Array(deckSegs);
  out.deckLines = new Float32Array(deckLines);
  out.piers = new Float32Array(site.piers);
  buildBarriers(S, header.ix, header.iz, ox, oz);
  // ---------------- rails
  {
    const C = A.railC; let ci = 0;
    for (const n of A.railN) {
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      permanentWay(S,pts.map(([x,z])=>[x,hAt(x,z)+.12,z]));
      strip(G, pts, 0, 3.2, p => hAt(p[0], p[1]) + 0.12, 9);
    }
  }
  // ---------------- walls / fences / hedges
  const wallCol = [], hedgeSegs = [];
  // breakables (main thread: breakables.js). Each record is BR floats: kind, first vertex and vertex count in
  // the struct mesh, x0 z0 x1 z1 (a point prop keeps its heading in x1), thickness or radius, height,
  // attached-wire range, next-span range, ground y. Kinds: 1 telegraph pole, 2 wheelie bin, 3 litter bin,
  // 4 bench, 5 pillar box, 7 hedge section, 8 fence panel, 9 low garden wall section, 10 garden shrub
  const brk = [], vtx = () => S.p.length / 3;
  const brkRec = (kind, v0, x0, z0, x1, z1, th, h) => { brk.push(kind, v0, vtx() - v0, x0, z0, x1, z1, th, h, 0, 0, 0, 0, hAt(x0, z0)); return brk.length / BR - 1; };
  // hedges, fences and low walls are built in short sections, each its own breakable (not a static collider)
  const breakWall = (pts, th, h, id, kind, piece) => {
    for (let q = 0; q < pts.length - 1; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[q + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const n = Math.max(1, Math.round(L / piece));
      for (let i = 0; i < n; i++) {
        const A0 = [ax + (bx - ax) * i / n, az + (bz - az) * i / n], B0 = [ax + (bx - ax) * (i + 1) / n, az + (bz - az) * (i + 1) / n];
        const v0 = vtx();
        // a hedge's solid core sits inside its leafy bushes (plantings), which give it its shape
        if (id === 3) wall(S, [A0, B0], th * 0.62, h * 0.9, hAt, id); else wall(S, [A0, B0], th, h, hAt, id);
        brkRec(kind, v0, A0[0], A0[1], B0[0], B0[1], th, h);
      }
    }
  };
  {
    const C = A.wlC, M = A.wlM; let ci = 0;
    for (let k = 0; k < M.length; k += 3) {
      const n = M[k], kind = M[k + 1], h = M[k + 2];
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      if (kind === 6) continue; // tree rows handled as trees by the pipeline
      const th = kind === 2 ? 0.8 : kind === 1 ? 0.06 : kind === 5 ? 0.1 : 0.25;
      const id = kind === 2 ? 3 : kind === 1 ? 2 : kind === 5 ? 4 : 1;
      if (id === 3) for (let q = 0; q < pts.length - 1; q++) hedgeSegs.push(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], h, th);
      // hedges, fences and low walls give way to a car; walls, retaining walls and guard rails don't
      const bk = lod ? 0 : kind === 2 ? 7 : kind === 1 && h <= 2.2 ? 8 : kind === 0 && h <= 1.1 ? 9 : 0;
      if (bk) { breakWall(pts, th, h, id, bk, bk === 7 ? 1.6 : bk === 8 ? 1.9 : 1.2); continue; }
      wall(S, pts, th, h, hAt, id);
      if (id === 3) wall(S, pts, th * 0.62, h * 0.36, (x, z) => hAt(x, z) + h * 0.72, id);
      for (let q = 0; q < pts.length - 1; q++) wallCol.push(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], h);
    }
  }
  // ---------------- front gardens: boundary hedge / low wall with a driveway or path gap (inferred)
  for (const [x0, z0, x1, z1, nx, nz, t, seed, cls] of out.buildings.gardens || []) {
    const r = (seed * 7919) % 100 / 100, style = r < 0.4 ? 'hedge' : r < 0.82 ? 'wall' : 'open';
    const l = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / l, uz = (z1 - z0) / l;
    const drive = t > 4.5 && l > 6 && seed % 2 === 0;
    const gw = drive ? 3.0 : 1.1;
    const gs = drive ? (seed % 3 === 0 ? 0.3 : l - gw - 0.3) : (seed % 4 < 2 ? l * 0.3 : l * 0.62);
    const P = (s_, o) => [x0 + ux * s_ + nx * o, z0 + uz * s_ + nz * o];
    if (style !== 'open') {
      const h = style === 'hedge' ? 0.95 + r * 0.5 : 0.62, th = style === 'hedge' ? 0.6 : 0.24, id = style === 'hedge' ? 3 : 1;
      for (const [a, b] of [[-0.2, gs], [gs + gw, l + 0.2]]) if (b - a > 0.4) {
        const A0 = P(a, t), B0 = P(b, t);
        if (id === 3) hedgeSegs.push(A0[0], A0[1], B0[0], B0[1], h, th);
        if (!lod) { breakWall([A0, B0], th, h, id, id === 3 ? 7 : 9, id === 3 ? 1.6 : 1.2); continue; }
        wall(S, [A0, B0], th, h, hAt, id); if (id === 3) wall(S, [A0, B0], th * 0.62, h * 0.36, (x, z) => hAt(x, z) + h * 0.72, id);
        wallCol.push(A0[0], A0[1], B0[0], B0[1], h);
      }
    }
    // driveway (block paving or tarmac) or front path (flags) from the gap to the house
    const surfId = drive ? (seed % 5 < 3 ? 4 : 0) : 1, lift = drive ? 0.08 : 0.09;
    const a = P(gs, t + 0.3), b = P(gs + gw, t + 0.3), c = P(gs + gw, 0.05), d = P(gs, 0.05);
    const q = [a, b, c, d].map(([x, z]) => [x, hAt(x, z) + lift, z]);
    quad(G, q[0], q[1], q[2], q[3], [0, 1, 0], null, [surfId]);
    // wheelie bins by the house, away from the path (general waste black/grey, recycling blue or green)
    if (!lod && seed % 7 !== 0 && l > 3.5) {
      const sb = gs > l / 2 ? 0.45 : l - 1.35, ang = Math.atan2(uz, ux);
      for (let k = 0; k < (seed % 3 ? 2 : 1); k++) {
        const [bx, bz] = P(sb + k * 0.68, 0.55), y = hAt(bx, bz), v0 = vtx();
        if (blocked(bx, bz, 0.45)) continue;   // a garden drawn over the carriageway: no bin in the road
        wheelieBin(S, bx, y, bz, ang, k ? [11, 12][seed % 2] : (seed % 4 ? 10 : 17));
        if (!lod) brkRec(2, v0, bx, bz, ang, 0, 0.36, 1.1);
      }
    }
    // shrubs and a flower bed in the front garden, kept off the driveway
    if (!lod && style !== 'open') {
      const spots = [];
      if (gs > 1.3) spots.push(Math.max(0.4, gs * 0.45));
      if (l - (gs + gw) > 1.3) spots.push(Math.min(l - 0.4, gs + gw + (l - gs - gw) * 0.55));
      spots.forEach((sv, i) => {
        const [sx, sz] = P(sv, Math.min(Math.max(t * 0.42, 0.8), 2.2)), sv0 = vtx(), ss = 0.46 + ((seed + i) % 4) * 0.07;
        shrub(S, sx, hAt(sx, sz), sz, ss);
        if (!lod) brkRec(10, sv0, sx, sz, 0, 0, ss * 0.45, ss);
      });
      if (seed % 4 !== 0) {
        const sv = Math.min(l - 0.35, Math.max(0.35, drive ? gs + gw + 0.55 : l * 0.5));
        const [sx, sz] = P(sv, 0.45);
        bloom(S, sx, hAt(sx, sz), sz, Math.atan2(uz, ux), drive ? 0.75 : 1.2, [19, 20, 21][seed % 3]);
      }
    }
  }
  // ---------------- street life (inferred): telegraph poles and wires along residential roads, the odd
  // pillar box, litter bins and benches along pedestrian ways
  if (!lod && NET) {
    const inTile = (x, z) => x >= 0 && x < TILE && z >= 0 && z < TILE;
    // eave anchor of each house front (for telegraph drop wires): mid front wall, just under the eaves
    const drops = (out.buildings.gardens || []).map(([x0, z0, x1, z1, nx, nz, , , , eave]) => [(x0 + x1) / 2 + nx * 0.15, (z0 + z1) / 2 + nz * 0.15, eave, 0]);
    const h32i = v => { v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); return (v ^ (v >>> 16)) >>> 0; };
    for (const e of header.edges) {
      const cn = NET.classes[NET.cls[e]], st = NET.pstart[e], n = NET.pcount[e], w = NET.width[e];
      const pts = []; let cum = 0;
      for (let i = 0; i < n; i++) { const x = NET.pts[(st + i) * 3] - ox, z = NET.pts[(st + i) * 3 + 2] - oz; if (i) cum += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]); pts.push([x, z, cum]); }
      if (cum < 10) continue;
      const at = (sv, off) => {
        let i = 1; while (i < pts.length - 1 && pts[i][2] < sv) i++;
        const a = pts[i - 1], b = pts[i], L = Math.max(1e-3, b[2] - a[2]), t = Math.min(1, Math.max(0, (sv - a[2]) / L));
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        return [a[0] + (b[0] - a[0]) * t - dz * off, a[1] + (b[1] - a[1]) * t + dx * off, Math.atan2(dz, dx)];
      };
      const hh = h32i(e + 7);
      if (/^(residential|unclassified|living_street)$/.test(cn) && hh % 5 < 3) {
        const side = hh & 1 ? 1 : -1, off = side * (w / 2 + 0.9), sp = 32, s0 = 4 + (hh % 14);
        let prev = null;
        for (let sv = s0; sv < cum - 4; sv += sp) {
          const [x, z] = at(sv, off); if (!inTile(x, z) || blocked(x, z, 0.6)) { prev = null; continue; }
          const y = hAt(x, z), top = y + 8.4, p0 = vtx();
          box(S, x, y, z, 0, 0.13, 4.2, 0.13, 15);
          const [, , ang] = at(sv, off);
          box(S, x, top - 0.35, z, ang + Math.PI / 2, 0.55, 0.05, 0.06, 15);
          const rec = brkRec(1, p0, x, z, ang, 0, 0.15, 8.4), w0 = vtx();
          // service drops: the fan of thin cables from the pole to the eaves of the nearest houses
          let nd = 0;
          for (const g of drops) {
            if (nd >= 5) break;
            const ddx = g[0] - x, ddz = g[1] - z, dd = ddx * ddx + ddz * ddz;
            if (dd > 26 * 26 || dd < 9 || g[3]) continue;
            g[3] = 1; nd++;
            sagWire(S, [x, top - 0.55, z], [g[0], g[2] - 0.25, g[1]], 0.25 + Math.sqrt(dd) * 0.012, 3);
          }
          if (prev) {
            const s0 = vtx();
            for (const o of [-0.4, 0, 0.4]) sagWire(S, [prev[0] + Math.cos(prev[2] + Math.PI / 2) * o, prev[1] - 0.3, prev[3] + Math.sin(prev[2] + Math.PI / 2) * o], [x + Math.cos(ang + Math.PI / 2) * o, top - 0.3, z + Math.sin(ang + Math.PI / 2) * o], 0.45);
            // the span hangs between two poles, so either one falling takes it down: it is the tail of this
            // pole's wire range and the earlier pole's 'next span'
            brk[prev[4] * BR + 11] = s0; brk[prev[4] * BR + 12] = vtx() - s0;
          }
          brk[rec * BR + 9] = w0; brk[rec * BR + 10] = vtx() - w0;                 // drop wires + span back
          prev = [x, top, ang, z, rec];
        }
        if (hh % 23 === 0) { const [x, z, ang] = at(Math.min(8, cum / 2), -side * (w / 2 + 0.7)); if (inTile(x, z) && !blocked(x, z, 0.5)) { const v0 = vtx(); pillarBox(S, x, hAt(x, z), z, ang); brkRec(5, v0, x, z, ang, 0, 0.27, 1.56); } }
      }
      if (header.core && /^(primary|secondary|tertiary)$/.test(cn)) {
        // high-street furniture on the pavement edge: litter bins, the odd bench
        for (let sv = 10 + (hh % 25); sv < cum - 6; sv += 42) {
          const sd = (Math.round(sv) & 1) ? 1 : -1, [x, z, ang] = at(sv, sd * (w / 2 + 0.55)); if (!inTile(x, z) || blocked(x, z, 0.9)) continue;
          const y = hAt(x, z) + 0.15, v0 = vtx();
          if ((h32i(e * 17 + Math.round(sv)) % 5) === 0) { bench(S, x, y, z, ang + (sd > 0 ? 0 : Math.PI)); brkRec(4, v0, x - Math.cos(ang) * 0.9, z - Math.sin(ang) * 0.9, x + Math.cos(ang) * 0.9, z + Math.sin(ang) * 0.9, 0.5, 0.75); }
          else { litterBin(S, x, y, z); brkRec(3, v0, x, z, 0.3, 0, 0.29, 1.05); }
        }
      }
      if (/^(pedestrian|footway)$/.test(cn) && (header.core || /pedestrian/.test(cn))) {
        for (let sv = 8 + (hh % 20); sv < cum - 3; sv += 32) {
          const [x, z, ang] = at(sv, (hh & 2 ? 1 : -1) * (w / 2 + 0.5)); if (!inTile(x, z) || blocked(x, z, 0.9)) continue;
          const y = hAt(x, z) + 0.1, v0 = vtx();
          if ((h32i(e * 31 + Math.round(sv)) & 3) === 0) { bench(S, x, y, z, ang); brkRec(4, v0, x - Math.cos(ang) * 0.9, z - Math.sin(ang) * 0.9, x + Math.cos(ang) * 0.9, z + Math.sin(ang) * 0.9, 0.5, 0.75); }
          else { litterBin(S, x, y, z); brkRec(3, v0, x, z, 0.3, 0, 0.29, 1.05); }
        }
      }
    }
    // shop planters on the pavement in front of a retail frontage
    for (const [x0, z0, x1, z1, nx, nz, len, seed] of out.buildings.planters || []) {
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, ang = Math.atan2(uz, ux);
      for (const f of [0.22, 0.78]) {
        const x = x0 + ux * len * f + nx * 0.45, z = z0 + uz * len * f + nz * 0.45;
        if (x < 0 || z < 0 || x >= TILE || z >= TILE) continue;
        bloom(S, x, hAt(x, z), z, ang, 0.85, [19, 21, 20][seed % 3]);
      }
    }
  }
  if (wallCol.length) {
    const B = out.buildings, col = Array.from(B.col), pts = Array.from(B.colPts);
    for (let k = 0; k < wallCol.length; k += 5) {
      const x0 = wallCol[k], z0 = wallCol[k + 1], x1 = wallCol[k + 2], z1 = wallCol[k + 3], base = Math.min(hAt(x0, z0), hAt(x1, z1));
      col.push(pts.length / 2, 2, base + wallCol[k + 4], base); pts.push(x0 + ox, z0 + oz, x1 + ox, z1 + oz);
    }
    B.col = new Float32Array(col); B.colPts = new Float32Array(pts);
  }
  out.ground = G.pack();
  out.struct = S.pack();
  out.brk = new Float32Array(brk);
  out.markings = buildMarkings(addedHere.length ? { ...header, edges: [...header.edges, ...addedHere] } : header, ox, oz, hAt, deckOf);

  // ---------------- instances: trees, lamps, slots
  const tr = A.tr, trL = [];
  for (let k = 0; k < tr.length; k += 4) {
    if (!lod && blocked(tr[k], tr[k + 1], 0.9)) continue;     // never a trunk in the road (or on the line)
    trL.push(tr[k], hAt(tr[k], tr[k + 1]), tr[k + 1], tr[k + 2] + (tr[k + 3] || 0) * 10);
  }
  const trees = new Float32Array(trL);
  out.trees = trees;
  // ---------------- planting (inferred): leafy hedges, shrubs and extra trees in open green space
  if (!lod) {
    const P = plantings(header, lcAt, hAt, trees, hedgeSegs);
    out.bushes = P.bushes;
    if (P.trees.length) { const t2 = new Float32Array(trees.length + P.trees.length); t2.set(trees); t2.set(P.trees, trees.length); out.trees = t2; }
  }
  const pk = A.pk, slots = new Float32Array(pk.length);
  for (let k = 0; k < pk.length; k += 4) { slots[k] = pk[k]; slots[k + 1] = hAt(pk[k], pk[k + 1]) + 0.05; slots[k + 2] = pk[k + 1]; slots[k + 3] = pk[k + 2]; }
  out.slots = slots; out.slotKind = new Float32Array(Array.from({ length: pk.length / 4 }, (_, i) => pk[i * 4 + 3]));
  out.signs = mergeSigns(header, A, out.buildings.fascias || []);
  delete out.buildings.fascias;
  return out;
}

// ---- street props (struct mesh; surf ids 10.. map to colours in materials.structMaterial)
function shrub(B, x, y, z, s) {
  box(B, x, y, z, 0.4, s * 0.48, s * 0.34, s * 0.42, 18);
  box(B, x + s * 0.08, y + s * 0.5, z, 1.2, s * 0.32, s * 0.24, s * 0.3, 18);
}
function bloom(B, x, y, z, ang, len, id) {
  box(B, x, y, z, ang, len * 0.5, 0.06, 0.18, 18);
  box(B, x, y + 0.1, z, ang, len * 0.42, 0.06, 0.14, id);
}
function box(B, x, y, z, ang, hx, hy, hz, id) {
  const ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v, w) => [x + u * ca - w * sa, y + v, z + u * sa + w * ca];
  const c = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  for (let k = 0; k < 4; k++) {
    const [u0, w0] = c[k], [u1, w1] = c[(k + 1) % 4], mu = (u0 + u1) / 2, mw = (w0 + w1) / 2;
    quad(B, P(u0, 0, w0), P(u1, 0, w1), P(u1, 2 * hy, w1), P(u0, 2 * hy, w0), [mu * ca - mw * sa, 0, mu * sa + mw * ca], [[0, 0], [1, 0], [1, 1], [0, 1]], [id]);
  }
  quad(B, P(-hx, 2 * hy, -hz), P(hx, 2 * hy, -hz), P(hx, 2 * hy, hz), P(-hx, 2 * hy, hz), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [id]);
}
function wheelieBin(B, x, y, z, ang, lidId) {
  box(B, x, y + 0.08, z, ang, 0.29, 0.48, 0.34, lidId === 17 ? 17 : 10);
  box(B, x, y + 1.04, z - 0.0, ang, 0.31, 0.025, 0.37, lidId);
  for (const sd of [-1, 1]) box(B, x - Math.sin(ang) * sd * 0.24 - Math.cos(ang) * 0.0, y, z + Math.cos(ang) * sd * 0.24, ang, 0.1, 0.1, 0.03, 17);
}
function pillarBox(B, x, y, z, ang) {
  box(B, x, y, z, ang, 0.24, 0.72, 0.24, 13);
  box(B, x, y + 1.44, z, ang, 0.28, 0.06, 0.28, 13);
  box(B, x, y + 1.25, z, ang, 0.245, 0.02, 0.18, 17);
}
function litterBin(B, x, y, z) { box(B, x, y, z, 0.3, 0.26, 0.5, 0.26, 17); box(B, x, y + 1.0, z, 0.3, 0.28, 0.04, 0.28, 17); }
function bench(B, x, y, z, ang) {
  box(B, x, y + 0.42, z, ang, 0.9, 0.025, 0.22, 16);
  box(B, x - Math.sin(ang) * -0.2, y + 0.55, z + Math.cos(ang) * -0.2, ang, 0.9, 0.18, 0.025, 16);
  for (const sd of [-0.8, 0.8]) box(B, x + Math.cos(ang) * sd, y, z + Math.sin(ang) * sd, ang, 0.03, 0.22, 0.2, 17);
}
// sagging cable between two points (catenary approximated by 4 straight spans)
function sagWire(B, a, b, sag, N = 4) {
  let p0 = a;
  for (let i = 1; i <= N; i++) {
    const t = i / N, y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
    const p1 = [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz) || 1, px = -dz / L * 0.02, pz = dx / L * 0.02;
    quad(B, [p0[0] - px, p0[1], p0[2] - pz], [p1[0] - px, p1[1], p1[2] - pz], [p1[0] + px, p1[1] + 0.03, p1[2] + pz], [p0[0] + px, p0[1] + 0.03, p0[2] + pz], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [14]);
    quad(B, [p0[0] - px, p0[1], p0[2] - pz], [p1[0] - px, p1[1], p1[2] - pz], [p1[0] + px, p1[1] + 0.03, p1[2] + pz], [p0[0] + px, p0[1] + 0.03, p0[2] + pz], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [14]);
    p0 = p1;
  }
}

// polyline strip (flat quads along a 2D polyline at lateral offset)
function strip(B, pts, offset, width, yfn, id, dashOn = 0, dashOff = 0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l, nz = dx / l;
    const a = [x0 + nx * (offset - width / 2), 0, z0 + nz * (offset - width / 2)], b = [x1 + nx * (offset - width / 2), 0, z1 + nz * (offset - width / 2)];
    const c = [x1 + nx * (offset + width / 2), 0, z1 + nz * (offset + width / 2)], d = [x0 + nx * (offset + width / 2), 0, z0 + nz * (offset + width / 2)];
    for (const p of [a, b, c, d]) p[1] = yfn([p[0], p[2]]);
    quad(B, a, b, c, d, [0, 1, 0], null, [id]);
  }
}

// Planting for open ground (inferred). Bushes: [x, y, z, sx, sy, sz, yaw, tint] per instance, drawn by tiles.js
// with the tree-crown leaf material. Hedges become rows of overlapping leafy bushes over their box core;
// grass, parks, gardens, scrub, woods, cemeteries and allotments get shrubs and a few extra trees, never
// within 2.5 m of a road, pavement, path, car park, building, pitch or water.
const PLANT = { 0: [0.011, 0.0024], 5: [0.03, 0], 6: [0.0015, 0.0004], 7: [0.022, 0.0042], 11: [0.022, 0.0014], 14: [0.012, 0], 15: [0.05, 0.0012], 16: [0.012, 0.002], 18: [0.012, 0.0008] };
const HARD = new Set([1, 2, 3, 4, 8, 9, 10, 12, 13, 17]);
function plantings(header, lcAt, hAt, trees, hedgeSegs) {
  let seed = (header.ix * 73856093 ^ header.iz * 19349663) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const bushes = [], extra = [];
  // hedges: elongated leafy bushes every ~1.5 m along each segment, a little taller and wider than the core
  for (let k = 0; k < hedgeSegs.length; k += 6) {
    const x0 = hedgeSegs[k], z0 = hedgeSegs[k + 1], x1 = hedgeSegs[k + 2], z1 = hedgeSegs[k + 3], h = hedgeSegs[k + 4], th = hedgeSegs[k + 5];
    const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.3) continue;
    const n = Math.max(1, Math.round(L / 1.5)), yaw = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
      if (x < 0 || x >= 256 || z < 0 || z >= 256) continue;
      const hh = h * (1.02 + rnd() * 0.12);
      bushes.push(x, hAt(x, z) + hh * 0.5, z, L / n * 0.95 + 0.35, hh * 0.6, th * 1.3 + 0.3, yaw, 2);
    }
  }
  // open ground: jittered grid at 3 m, density by landcover class
  const clear = (x, z, r) => {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= 256 || zz >= 256) continue;
      if (HARD.has(lcAt(xx, zz))) return false;
    }
    return true;
  };
  const nearTree = (x, z, r) => { for (let k = 0; k < trees.length; k += 4) { const dx = trees[k] - x, dz = trees[k + 2] - z; if (dx * dx + dz * dz < r * r) return true; } return false; };
  for (let gz = 1.5; gz < 256; gz += 3) for (let gx = 1.5; gx < 256; gx += 3) {
    const x = gx + (rnd() - 0.5) * 2.6, z = gz + (rnd() - 0.5) * 2.6, c = lcAt(x, z), d0 = PLANT[c];
    if (!d0) continue;
    // planting gathers along edges (4-10 m from paths, roads, buildings); mown open middles stay mostly clear
    const edge = !clear(x, z, 9) ? 2.5 : c === 15 || c === 5 ? 0.8 : 0.12, d = [d0[0] * edge, d0[1] * (edge > 1 ? 1.6 : 0.8)];
    const r = rnd();
    if (r < d[0] * 9) {
      if (!clear(x, z, 2.5) || nearTree(x, z, 2.2)) continue;
      // shrubs in loose clumps of one to four, one species per clump; widths are full widths, the
      // height is a half-height (tiles.js halves x and z), and each sits a little sunk so no base shows
      const n = rnd() < 0.55 ? 2 + Math.floor(rnd() * 3) : 1, big = c === 15 || c === 5 ? 1.3 : 1;
      const tint = c === 16 ? 2 : c === 15 && rnd() < 0.3 ? 4 : rnd() < 0.1 ? 5 : rnd() < 0.12 ? 3 : Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const bx = x + (rnd() - 0.5) * 2.6 * (n > 1), bz = z + (rnd() - 0.5) * 2.6 * (n > 1);
        if (n > 1 && !clear(bx, bz, 2)) continue;
        const w = big * (1.3 + rnd() * 1.5), hy = w * (0.3 + rnd() * 0.16);
        bushes.push(bx, hAt(bx, bz) + hy * 0.72, bz, w * (0.85 + rnd() * 0.3), hy, w * (0.85 + rnd() * 0.3), rnd() * 6.28, tint);
      }
    } else if (r < d[0] * 9 + d[1] * 9) {
      if (!clear(x, z, 4.5) || nearTree(x, z, 7)) continue;
      // tree code as in the pipeline: kind (0 broadleaf, 1 tall, 2 small/ornamental, 3 conifer) + 10 x height tag
      const kind = c === 16 ? 3 : c === 11 ? 2 : rnd() < 0.2 ? 1 : rnd() < 0.35 ? 2 : 0;
      extra.push(x, hAt(x, z), z, kind);
      trees = Float32Array.from([...trees, x, 0, z, 0]);   // keep spacing between new trees too
    }
  }
  return { bushes: new Float32Array(bushes), trees: new Float32Array(extra) };
}

function wall(B, pts, th, h, hAt, id) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l * th / 2, nz = dx / l * th / 2;
    const y0 = hAt(x0, z0) - 0.2, y1 = hAt(x1, z1) - 0.2, t0 = y0 + 0.2 + h, t1 = y1 + 0.2 + h;
    const L = [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz]], R = [[x0 - nx, z0 - nz], [x1 - nx, z1 - nz]];
    quad(B, [L[0][0], y0, L[0][1]], [L[1][0], y1, L[1][1]], [L[1][0], t1, L[1][1]], [L[0][0], t0, L[0][1]], [nx, 0, nz], [[0, 0], [l, 0], [l, h], [0, h]], [id]);
    quad(B, [R[0][0], y0, R[0][1]], [R[1][0], y1, R[1][1]], [R[1][0], t1, R[1][1]], [R[0][0], t0, R[0][1]], [-nx, 0, -nz], [[0, 0], [l, 0], [l, h], [0, h]], [id]);
    quad(B, [L[0][0], t0, L[0][1]], [L[1][0], t1, L[1][1]], [R[1][0], t1, R[1][1]], [R[0][0], t0, R[0][1]], [0, 1, 0], null, [id]);
    if (i === 0) quad(B, [L[0][0], y0, L[0][1]], [R[0][0], y0, R[0][1]], [R[0][0], t0, R[0][1]], [L[0][0], t0, L[0][1]], [-dx, 0, -dz], null, [id]);
    if (i === pts.length - 2) quad(B, [L[1][0], y1, L[1][1]], [R[1][0], y1, R[1][1]], [R[1][0], t1, R[1][1]], [L[1][0], t1, L[1][1]], [dx, 0, dz], null, [id]);
  }
}

// Batched top faces follow the same elevation profile as each mapped track section.
function permanentWay(buf,pts){
  let nextSleeper=.3;
  for(let i=1;i<pts.length;i++){
    const [x,y,z]=pts[i-1],[ex,ey,ez]=pts[i],len=Math.hypot(ex-x,ez-z);
    if(len<.01)continue;
    const dx=(ex-x)/len,dz=(ez-z)/len;
    function panel(start,end,left,right,lift,id){
      const vertex=(a,b)=>[x+a*dx-b*dz,y+(ey-y)*a/len+lift,z+a*dz+b*dx];
      quad(buf,vertex(start,left),vertex(start,right),vertex(end,right),vertex(end,left),[0,1,0],null,[id]);
    }
    for(;nextSleeper<len;nextSleeper+=.68){
      panel(nextSleeper,Math.min(len,nextSleeper+.22),-1.22,1.22,.055,0);
    }
    nextSleeper-=len;
    for(const gauge of [-.7175,.7175]){
      panel(0,len,gauge-.07,gauge+.07,.08,2);
      panel(0,len,gauge-.034,gauge+.034,.15,6);
    }
  }
}
function ribbonDeck(G, S, pts, w, kind, hAt, parapets = true, ends = 3, site = null, split = false) {
  // deck surface (ground mesh, surf 5 road / 6 foot / 7 rail deck) + sides, parapets, piers (struct)
  // edges are mitred so a curved span meets itself instead of leaving a triangular gap at every bend
  const surfId = kind === 0 ? 5 : kind === 1 ? 6 : 7;
  const hw = w / 2, e = hw + 0.4, lift = kind === 0 ? 0.045 : 0.02;
  const left = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const snx = -dz / l, snz = dx / l;
    const m = (nx, nz) => Math.min(2.2, 1 / Math.max(0.4, nx * snx + nz * snz));
    const e0 = e * m(left[i][0], left[i][1]), e1 = e * m(left[i + 1][0], left[i + 1][1]);
    const a = [x0 + left[i][0] * e0, y0 + lift, z0 + left[i][1] * e0], b = [x1 + left[i + 1][0] * e1, y1 + lift, z1 + left[i + 1][1] * e1];
    const c = [x1 - left[i + 1][0] * e1, y1 + lift, z1 - left[i + 1][1] * e1], d = [x0 - left[i][0] * e0, y0 + lift, z0 - left[i][1] * e0];
    quad(G, a, b, c, d, [0, 1, 0], null, [surfId]);
    // a low concrete reservation down a two-way deck, so the two directions stay on their own sides
    if (split && kind === 0) {
      const bw = 0.16, bh = 0.82;
      const L0 = [x0 + left[i][0] * bw, y0 + lift, z0 + left[i][1] * bw];
      const L1 = [x1 + left[i + 1][0] * bw, y1 + lift, z1 + left[i + 1][1] * bw];
      const R0 = [x0 - left[i][0] * bw, y0 + lift, z0 - left[i][1] * bw];
      const R1 = [x1 - left[i + 1][0] * bw, y1 + lift, z1 - left[i + 1][1] * bw];
      quad(S, L0, L1, [L1[0], L1[1] + bh, L1[2]], [L0[0], L0[1] + bh, L0[2]], [left[i][0], 0, left[i][1]], null, [0]);
      quad(S, R1, R0, [R0[0], R0[1] + bh, R0[2]], [R1[0], R1[1] + bh, R1[2]], [-left[i][0], 0, -left[i][1]], null, [0]);
      quad(S, [L0[0], L0[1] + bh, L0[2]], [L1[0], L1[1] + bh, L1[2]], [R1[0], R1[1] + bh, R1[2]], [R0[0], R0[1] + bh, R0[2]], [0, 1, 0], null, [0]);
    }
    for (const s of [1, -1]) {
      const xA = x0 + left[i][0] * e0 * s, zA = z0 + left[i][1] * e0 * s, xB = x1 + left[i + 1][0] * e1 * s, zB = z1 + left[i + 1][1] * e1 * s;
      quad(S, [xA, y0 - 1.2, zA], [xB, y1 - 1.2, zB], [xB, y1, zB], [xA, y0, zA], [left[i][0] * s, 0, left[i][1] * s], null, [0]);
      if (!parapets) continue;
      const p0 = e0 - 0.3 * m(left[i][0], left[i][1]), p1 = e1 - 0.3 * m(left[i + 1][0], left[i + 1][1]);
      const iA = x0 + left[i][0] * p0 * s, izA = z0 + left[i][1] * p0 * s, iB = x1 + left[i + 1][0] * p1 * s, izB = z1 + left[i + 1][1] * p1 * s;
      quad(S, [xA, y0, zA], [xB, y1, zB], [xB, y1 + 1.1, zB], [xA, y0 + 1.1, zA], [left[i][0] * s, 0, left[i][1] * s], null, [0]);
      quad(S, [iA, y0, izA], [iB, y1, izB], [iB, y1 + 1.1, izB], [iA, y0 + 1.1, izA], [-left[i][0] * s, 0, -left[i][1] * s], null, [0]);
      quad(S, [iA, y0 + 1.1, izA], [iB, y1 + 1.1, izB], [xB, y1 + 1.1, zB], [xA, y0 + 1.1, zA], [0, 1, 0], null, [0]);
    }
    quad(S, [a[0], y0 - 1.2, a[2]], [b[0], y1 - 1.2, b[2]], [c[0], y1 - 1.2, c[2]], [d[0], y0 - 1.2, d[2]], [0, -1, 0], null, [0]);
  }
  // abutments: a concrete wall across each end of a deck that stands clear of the ground, facing the span
  // (the embankment behind it stops at the bridge end)
  for (const [i, j, bit] of [[0, 1, 1], [pts.length - 1, pts.length - 2, 2]]) {
    if (j < 0 || j >= pts.length || !(ends & bit)) continue;
    const [x0, y0, z0] = pts[i], [x1, , z1] = pts[j];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const ux = dx / l, uz = dz / l, nx = -uz, nz = ux, e = hw + 0.4;
    const inner = hAt(x0 + ux * Math.min(3, l), z0 + uz * Math.min(3, l));
    if (y0 - inner < 1.5) continue;
    if (site && !site.wallOk(x0 + nx * e, z0 + nz * e, x0 - nx * e, z0 - nz * e)) continue;   // never across a road or the railway
    const g = Math.min(inner, hAt(x0 + nx * e, z0 + nz * e), hAt(x0 - nx * e, z0 - nz * e)) - 0.6;
    const a = [x0 + nx * e, y0 - 1.2, z0 + nz * e], b = [x0 - nx * e, y0 - 1.2, z0 - nz * e];
    quad(S, [a[0], g, a[2]], [b[0], g, b[2]], b, a, [ux, 0, uz], null, [0]);
    quad(S, b, a, [a[0], g, a[2]], [b[0], g, b[2]], [-ux, 0, -uz], null, [0]);
  }
  piers(S, pts, w, hAt, site);
}
// Piers where a deck stands well above the ground: one in the central reservation of each dual carriageway it
// passes over, and every ~22 m elsewhere, always clear of the carriageways, railway lines, paths and water
// beneath (site.under: what passes under a line; site.ok: the land cover at a spot)
function piers(S, pts, w, hAt, site) {
  const hw = w / 2;
  for (const o of (w > 8 ? [-hw * 0.6, hw * 0.6] : [0])) {
    // this column's line under the deck
    const line = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      return [p[0] - dz / l * o, p[1], p[2] + dx / l * o];
    });
    const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][2] - line[i - 1][2]));
    const total = cum[cum.length - 1];
    const at = sv => {
      let i = 0; while (i < line.length - 2 && cum[i + 1] < sv) i++;
      const t = Math.max(0, Math.min(1, (sv - cum[i]) / ((cum[i + 1] - cum[i]) || 1))), a = line[i], b = line[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    const obs = site ? site.under(line, cum) : [];   // [s, half width along the line, kind (1 road, 2 railway), road dx, dz]
    const spots = [];
    for (let k = 0; k + 1 < obs.length; k++) {   // between two carriageways side by side
      const A = obs[k], B = obs[k + 1]; if (A[2] !== 1 || B[2] !== 1) continue;
      const gap = (B[0] - B[1]) - (A[0] + A[1]); if (gap < 0.4 || gap > 14) continue;
      // a column standing along the reservation, as wide as it allows
      const sin = A[5], across = Math.min(0.55, (gap * sin) / 2 - 0.05), sv = (A[0] + A[1] + B[0] - B[1]) / 2;
      if (across >= 0.25 && !obs.some(([c, h, kind]) => kind === 2 && Math.abs(sv - c) < h + 1)) spots.push({ s: sv, ux: A[3], uz: A[4], across, along: 0.9 });
    }
    for (let sv = 11; sv < total - 2; sv += 22)
      if (!obs.some(([c, h, kind]) => Math.abs(sv - c) < h + (kind === 2 ? 1.5 : 1.2) + 0.8)) spots.push({ s: sv, ux: 1, uz: 0, across: 0.55, along: 0.55, free: true });
    for (const sp of spots) {
      const [x, y, z] = at(sp.s), g = hAt(x, z);
      if (y - g <= 3) continue;
      if (site && ((sp.free && !site.ok(x, z)) || !site.clear(x, z, y - 1.2, !!sp.free))) continue;
      const ux = sp.ux, uz = sp.uz, vx = -uz, vz = ux;
      if (site && site.piers) site.piers.push(x, z, ux, uz, sp.along, sp.across, g - 0.5, y - 1.2);
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * a * sp.along + vx * b * sp.across, z + uz * a * sp.along + vz * b * sp.across]);
      for (let q = 0; q < 4; q++) {
        const [ax, az] = P[q], [bx, bz] = P[(q + 1) % 4];
        quad(S, [ax, g - 0.5, az], [bx, g - 0.5, bz], [bx, y - 1.2, bz], [ax, y - 1.2, az], [(ax + bx) / 2 - x, 0, (az + bz) / 2 - z], null, [0]);
      }
    }
  }
}

// ------------------------------------------------------------------ buildings
function floorHOf(M, bi) {
  if (!M || bi < 0 || (bi + 1) * 16 > M.length) return 3.2;
  const wall = M[bi * 16 + 2], lv = M[bi * 16 + 11];
  if (!(wall > 0)) return 3.2;
  return Math.max(2.5, Math.min(5.4, wall / Math.max(1, lv || 1)));
}
function mergeSigns(header, A, fascias) {
  const data = [], text = [];
  const sg = A.sg && A.sg.length ? A.sg : new Float32Array(0);
  const sn = header.sn || [];
  const nSign = Math.min(sn.length, Math.floor(sg.length / 7));
  const closeToFascia = (x0, z0, x1, z1) => {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (const f of fascias) {
      const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
      const half = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) * 0.5 + 1.6;
      if (Math.hypot(mx - fx, mz - fz) < half) return true;
    }
    return false;
  };
  for (let i = 0; i < nSign; i++) {
    const name = sn[i] || '';
    if (!name) continue;
    const bi = sg[i * 7 + 5] | 0;
    const key = normName(name);
    if (fascias.some(f => f.bi === bi && normName(f.name) === key)) continue;
    let x0 = sg[i * 7], z0 = sg[i * 7 + 1], x1 = sg[i * 7 + 2], z1 = sg[i * 7 + 3];
    if (closeToFascia(x0, z0, x1, z1)) continue;
    const ring = outerRing(A, bi);
    if (ring) [x0, z0, x1, z1] = faceOut(ring, x0, z0, x1, z1);
    const brand = fasciaBrand(name, true);
    const box = signBox(brand, floorHOf(A.bM, bi));
    data.push(x0, z0, x1, z1, sg[i * 7 + 4], box.dy, box.h);
    text.push(name);
  }
  for (const f of fascias) {
    data.push(f.x0, f.z0, f.x1, f.z1, f.base, f.dy, f.h);
    text.push(f.name);
  }
  return { data: new Float32Array(data), text };
}
function outerRing(A, bi) {
  const P = A.bP, R = A.bR, C = A.bC;
  if (!P || bi < 0 || bi >= P.length) return null;
  let ri = 0, ci = 0;
  for (let i = 0; i < bi; i++) for (let k = 0; k < P[i]; k++) ci += R[ri++];
  if (ri >= R.length) return null;
  const n = R[ri], ring = [];
  for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
  return ring.length > 2 ? ring : null;
}
function insideRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-9) + xi) c = !c;
  }
  return c;
}
// Street side of an edge. Returns the segment ordered so (dz, -dx) points out of the footprint.
function faceOut(ring, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
  const nx = dz / L, nz = -dx / L, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (insideRing(ring, mx + nx * 0.7, mz + nz * 0.7)) return [x1, z1, x0, z0];
  return [x0, z0, x1, z1];
}
function edgeFrame(ring, q) {
  const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 2.2) return null;
  let nx = dz / L, nz = -dx / L;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (insideRing(ring, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
  return { q, L, nx, nz, mx, mz, x0, z0, x1, z1 };
}
// Name board on the street face, just proud of the fascia. No canopy — that was hiding the lettering.
function placeFascia(fascias, ring, edge, baseRel, floorH, brand, bi) {
  const e = edgeFrame(ring, edge);
  if (!e || e.L < 2.3) return null;
  const [ax, az, bx, bz] = faceOut(ring, e.x0, e.z0, e.x1, e.z1);
  const dx = bx - ax, dz = bz - az, fl = Math.hypot(dx, dz) || 1;
  const tx = dx / fl, tz = dz / fl, nx = dz / fl, nz = -dx / fl;
  const box = signBox(brand, floorH);
  const wide = !!(brand.canopy && fl >= 14);
  let w = Math.min(fl - 0.3, wide ? Math.min(16, Math.max(9, fl * 0.42)) : fl - 0.2);
  if (w < 2.1) return null;
  const c0 = (fl - w) / 2, out = 0.06;
  let uF = 0;
  for (let q = 0; q < edge; q++) {
    const [px, pz] = ring[q], [qx, qz] = ring[(q + 1) % ring.length];
    const l = Math.hypot(qx - px, qz - pz); if (l >= 0.02) uF += l;
  }
  const doorT = brand.canopy ? 0.5 : 0.72;
  fascias.push({
    x0: ax + tx * c0 + nx * out, z0: az + tz * c0 + nz * out,
    x1: ax + tx * (c0 + w) + nx * out, z1: az + tz * (c0 + w) + nz * out,
    base: baseRel, dy: box.dy, h: box.h, name: brand.label, bi,
  });
  return { fl, box, doorU: uF + e.L * doorT };
}
function buildBuildings(header, A, lod, hAt, ox, oz, lcAt) {
  const B = new Buf(4);
  const C = A.bC, R = A.bR, P = A.bP, M = A.bM, hmin = header.hmin;
  const NM = 16;
  // nearby drive-edge segments for frontage detection
  const segs = [];
  const walkSegs = [];
  if (!lod && NET) for (const e of header.edges) {
    const drive = NET.driveCls.has(NET.cls[e]);
    const cn = NET.classes[NET.cls[e]];
    if (!drive && !/pedestrian|footway/.test(cn)) continue;
    const s = NET.pstart[e], n = NET.pcount[e], dst = drive ? segs : walkSegs;
    for (let i = 0; i < n - 1; i++) { const a = (s + i) * 3, b = a + 3; dst.push(NET.pts[a] - ox, NET.pts[a + 2] - oz, NET.pts[b] - ox, NET.pts[b + 2] - oz, NET.width[e] / 2); }
  }
  // distance to the nearest centreline (edge=false) or carriageway edge (edge=true)
  const segDist = (x, z, list = segs, edge = false) => {
    let best = 1e9;
    for (let k = 0; k < list.length; k += 5) {
      const ax = list[k], az = list[k + 1], vx = list[k + 2] - ax, vz = list[k + 3] - az, L2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      let d = Math.hypot(ax + vx * t - x, az + vz * t - z); if (edge) d -= list[k + 4];
      if (d < best) best = d;
    }
    return best;
  };
  const col = []; // collision: per building [ringStart, ringLen, top, base]
  const landmarks = [], destinations = [];
  const gardens = [];
  const planters = [];
  const fascias = [];
  const colPts = [];
  const poiOn = new Set();
  if (!lod && A.sg && header.sn) {
    const nSign = Math.min(header.sn.length, Math.floor(A.sg.length / 7));
    for (let i = 0; i < nSign; i++) if (header.sn[i]) poiOn.add(A.sg[i * 7 + 5] | 0);
  }
  let ci = 0, ri = 0;
  for (let bi = 0; bi < P.length; bi++) {
    const m = M.subarray(bi * NM, bi * NM + NM);
    const base = m[0] + hmin, low = m[1] + hmin - 0.6, wallH = m[2], roof = m[3], rh = m[4];
    const rcx = m[5], rcz = m[6], rang = m[7], rL = m[8], rW = m[9], cls = m[10], lv = m[11], seed = m[13];
    const bname = (header.bn && header.bn[bi]) || '';
    const retail = m[12] > 0 || cls === 6 || cls === 7;
    const brand = (!lod && fasciaBrand(bname, retail)) || null;
    // named commercial / retail units are shops even when only the name is tagged (e.g. amenity=pharmacy)
    const shop = m[12] || ((cls === 6 || cls === 7) && bname) || brand || poiOn.has(bi) ? 1 : 0;

    if (cls === 13) { for (let k = 0; k < P[bi]; k++) ci += R[ri++]; continue; } // canopies are drawn by landmarks.js
    // a supermarket is one tall retail front, not two floors of brick with a garage door
    const retailBox = !!(brand && brand.canopy);
    const floorH = retailBox
      ? Math.max(3.4, Math.min(9.2, wallH))
      : Math.max(2.4, Math.min(5, wallH / Math.max(1, lv || 1)));
    const rings = [];
    for (let k = 0; k < P[bi]; k++) {
      const n = R[ri++], ring = [];
      for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n; rings.push(ring);
    }
    const outer = rings[0];
    if(cls<=3 || shop || [6,7,8,10].includes(cls))destinations.push({x:ox+outer.reduce((sum,v)=>sum+v[0],0)/outer.length,z:oz+outer.reduce((sum,v)=>sum+v[1],0)/outer.length,kind:shop||cls===7?'shop':cls<=3?'home':'work',name:header.bn[bi]||''});
    if (m[14] > 0.5) { // hand-authored landmark: hand the footprint over, keep collision
      landmarks.push({ name: header.bn[bi], ring: outer.map(([x, z]) => [x + ox, z + oz]), base, wall: wallH });
      col.push(colPts.length / 2, outer.length, header.bn[bi] === 'Cemetery Arch' ? base - 1 : base + wallH + 4, base);
      for (const [x, z] of outer) colPts.push(x + ox, z + oz);
      continue;
    }
    const pitched = roof > 0 && rL > 0 && !lod;
    const top = base + wallH + (lod && roof ? rh * 0.45 : 0);
    const parapet = !pitched && !lod && (cls === 3 || cls === 6 || cls === 7 || cls === 11) ? 0.6 : 0;
    // public faces. Sample landcover OUTSIDE the footprint (rings are not always CCW).
    let front = -1;
    const street = [];
    if (!lod && outer && outer.length > 2) {
      const scored = [];
      for (let q = 0; q < outer.length; q++) {
        const fr = edgeFrame(outer, q);
        if (!fr || fr.L < 2.4) continue;
        const px = fr.mx + fr.nx * 2.4, pz = fr.mz + fr.nz * 2.4;
        const c = lcAt(Math.floor(px), Math.floor(pz));
        let d = segs.length ? segDist(fr.mx, fr.mz) : 36;
        if (shop && walkSegs.length) d = Math.min(d, segDist(fr.mx, fr.mz, walkSegs) - 6);
        if (shop && (c === 12 || c === 2 || c === 17 || c === 8)) d -= 16;
        if (c === 3) d += 50;
        scored.push({ q, d, L: fr.L, c });
      }
      if (scored.length) {
        const net = segs.length || walkSegs.length;
        if (!net) scored.sort((a, b) => b.L - a.L);
        else scored.sort((a, b) => a.d - b.d);
        const best = scored[0];
        if (!net || best.d < 42) front = best.q;
        if (shop && front >= 0) {
          const primary = edgeFrame(outer, front);
          const pool = scored.filter(s => s.c !== 3 && s.L >= 3.4 && (!net || s.d < Math.min(24, best.d + 8)));
          pool.sort((a, b) => b.L - a.L);
          street.push(front);
          for (const s of pool) {
            if (s.q === front || !primary) continue;
            const fr = edgeFrame(outer, s.q);
            if (!fr) continue;
            const dot = primary.nx * fr.nx + primary.nz * fr.nz;
            if (Math.abs(dot) > 0.5) continue;
            street.push(s.q);
            break;
          }
        }
      }
    }
    if (!lod && (shop || brand) && front < 0 && outer) {
      let bl = 0, bq = -1;
      for (let q = 0; q < outer.length; q++) {
        const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length];
        const l = Math.hypot(bx - ax, bz - az);
        if (l > bl) { bl = l; bq = q; }
      }
      if (bl >= 2.4) { front = bq; if (shop && !street.length) street.push(bq); }
    }
    const clsCode = cls + (shop ? 32 : 0) + (brand ? brand.id * 64 : 0);
    // front door and bay window positions are chosen here (so the door hood and bay line up with the
    // painted door); the door's u coordinate along the wall rides in the seed attribute
    let seedEnc = seed, frontInfo = null;
    if (!lod && front >= 0 && (cls === 1 || cls === 2) && !shop) {
      let uF = 0;
      for (let q = 0; q < front; q++) { const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length]; const l = Math.hypot(bx - ax, bz - az); if (l >= 0.02) uF += l; }
      const [ox0, oz0] = outer[front], [ox1, oz1] = outer[(front + 1) % outer.length], fl = Math.hypot(ox1 - ox0, oz1 - oz0);
      if (fl >= 2.2) {
        const dT0 = fl < 4.7 ? 0.5 : (seed % 2 ? 0.27 : 0.73);
        const doorU = uF + fl * dT0;
        seedEnc = seed + 1000 * Math.round(doorU * 4);
        const [x0, z0, x1, z1] = faceOut(outer, ox0, oz0, ox1, oz1);
        const flipped = x0 !== ox0 || z0 !== oz0;
        frontInfo = { x0, z0, x1, z1, fl, dT: flipped ? 1 - dT0 : dT0 };
      }
    }
    if (front >= 0 && (cls === 1 || cls === 2) && !shop) {
      const fr = edgeFrame(outer, front);
      if (fr && fr.L >= 4) {
        const ce = segDist(fr.mx, fr.mz, segs, true);
        const t = ce - 2.1;
        if (t >= 1.6 && t <= 14) gardens.push([fr.x0, fr.z0, fr.x1, fr.z1, fr.nx, fr.nz, t, seed, cls, base + wallH]);
      }
    }
    if (front >= 0 && shop && !retailBox) {
      const fr = edgeFrame(outer, front);
      if (fr && fr.L >= 4 && fr.L <= 22) planters.push([fr.x0, fr.z0, fr.x1, fr.z1, fr.nx, fr.nz, fr.L, seed]);
    }
    if (!lod && brand && street.length) {
      let doorU = 0;
      for (const q of street) {
        const placed = placeFascia(fascias, outer, q, m[0], floorH, brand, bi);
        if (placed && (q === front || !doorU)) doorU = placed.doorU;
      }
      if (doorU > 0.4) seedEnc = seed + 1000 * Math.round(doorU * 4);
    } else if (!lod && shop && front >= 0) {
      let uF = 0;
      for (let q = 0; q < front; q++) { const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length]; const l = Math.hypot(bx - ax, bz - az); if (l >= 0.02) uF += l; }
      const [x0, z0] = outer[front], [x1, z1] = outer[(front + 1) % outer.length], fl = Math.hypot(x1 - x0, z1 - z0);
      if (fl >= 2.2) seedEnc = seed + 1000 * Math.round((uF + fl * 0.72) * 4);
    }
    const streetSet = new Set(street);
    // walls
    rings.forEach((ring, k) => {
      let u = 0;
      for (let q = 0; q < ring.length; q++) {
        const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.02) continue;
        let nx = dz / l, nz = -dx / l;
        if (k === 0) {
          const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
          if (insideRing(ring, mx + nx * 0.55, mz + nz * 0.55)) { nx = -nx; nz = -nz; }
        }
        const nrm = [nx, 0, nz];
        const part = k === 0 && (q === front || streetSet.has(q)) ? 1 : 0;
        const t = top + parapet;
        quad(B, [x0, low, z0], [x1, low, z1], [x1, t, z1], [x0, t, z0], nrm, [[u, low - base], [u + l, low - base], [u + l, t - base], [u, t - base]], [floorH, seedEnc, clsCode, part]);
        if (parapet) quad(B, [x0, top, z0], [x1, top, z1], [x1, t, z1], [x0, t, z0], nrm.map(v => -v), [[u, 0], [u + l, 0], [u + l, 1], [u, 1]], [floorH, seedEnc, clsCode, 6]);
        u += l;
      }
    });
    // flat roof over full footprint (also under pitched roofs where the footprint isn't rectangular)
    {
      const flat = [], holes = [];
      rings.forEach((ring, k) => { if (k) holes.push(flat.length / 2); for (const [x, z] of ring) flat.push(x, z); });
      const t = earcut(flat, holes.length ? holes : null);
      for (let q = 0; q < t.length; q += 3) {
        const v = [t[q], t[q + 1], t[q + 2]].map(i => [flat[i * 2], top + (pitched ? -0.02 : 0), flat[i * 2 + 1]]);
        tri(B, v[0], v[1], v[2], [0, 1, 0], v.map(p => [p[0], p[2]]), [floorH, seedEnc, clsCode, 3]);
      }
    }
    if (pitched) addRoof(B, rcx, rcz, rang, rL, rW, base + wallH, rh, roof, [floorH, seedEnc, clsCode], cls, seed, base);
    if (frontInfo) addFrontage(B, frontInfo, base, low, wallH, floorH, [floorH, seedEnc, clsCode], seed);
    // collision ring (world coords)
    col.push(colPts.length / 2, outer.length, base + wallH + (roof ? rh : 0), base);
    for (const [x, z] of outer) colPts.push(x + ox, z + oz);
  }
  const g = B.pack();
  g.col = new Float32Array(col); g.colPts = new Float32Array(colPts); g.destinations = destinations; g.landmarks = landmarks; g.gardens = gardens; g.planters = planters; g.fascias = fascias;
  return g;
}

// box between two points (a beam): width across, height up; parts 7 trim, 8 gutter, 9 ridge, 10 pot
function beam(B, a, b, wid, hgt, ex, up = [0, 1, 0]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); if (L < 0.01) return;
  const t = d.map(v => v / L);
  let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]; const sl = Math.hypot(...s) || 1; s = s.map(v => v / sl);
  const u = [s[1] * t[2] - s[2] * t[1], s[2] * t[0] - s[0] * t[2], s[0] * t[1] - s[1] * t[0]];
  const off = (p, i, j) => [p[0] + s[0] * i * wid / 2 + u[0] * j * hgt / 2, p[1] + s[1] * i * wid / 2 + u[1] * j * hgt / 2, p[2] + s[2] * i * wid / 2 + u[2] * j * hgt / 2];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [i0, j0] = C[k], [i1, j1] = C[(k + 1) % 4];
    const nm = [s[0] * (i0 + i1) + u[0] * (j0 + j1), s[1] * (i0 + i1) + u[1] * (j0 + j1), s[2] * (i0 + i1) + u[2] * (j0 + j1)];
    quad(B, off(a, i0, j0), off(b, i0, j0), off(b, i1, j1), off(a, i1, j1), nm, [[0, 0], [L, 0], [L, 1], [0, 1]], ex);
  }
}
function addRoof(B, cx, cz, ang, L, W, eave, rh, type, ex, cls, seed, base = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang), o = 0.3;
  const part = k => [...ex.slice(0, 3), k];
  const P = (u, v, y) => [cx + u * ca - v * sa, y, cz + u * sa + v * ca];
  const l = L / 2, w = W / 2, slope = rh / w;
  const ye = eave - o * slope; // eave lowered by overhang
  const R = [...ex, 2], Gw = [...ex, 4];
  if (type === 4) { // skillion
    quad(B, P(-l - o, -w - o, ye), P(l + o, -w - o, ye), P(l + o, w + o, eave + rh), P(-l - o, w + o, eave + rh), [0, 1, 0], [[0, 0], [L, 0], [L, W], [0, W]], R);
    tri(B, P(-l, -w, eave), P(-l, w, eave), P(-l, w, eave + rh), [-ca, 0, -sa], null, Gw);
    tri(B, P(l, -w, eave), P(l, w, eave), P(l, w, eave + rh), [ca, 0, sa], null, Gw);
    quad(B, P(-l, w, eave), P(l, w, eave), P(l, w, eave + rh), P(-l, w, eave + rh), [-sa, 0, ca], null, Gw);
    return;
  }
  const ridge = type === 1 ? l + o : type === 3 ? 0 : Math.max(0, l - w);
  const top = eave + rh;
  const sl = Math.hypot(w + o, rh + o * slope);
  if (type === 1) { // gabled
    for (const s of [-1, 1]) quad(B, P(-l - o, s * (w + o), ye), P(l + o, s * (w + o), ye), P(l + o, 0, top), P(-l - o, 0, top), [-sa * s, 1, ca * s], [[0, 0], [L + 2 * o, 0], [L + 2 * o, sl], [0, sl]], R);
    for (const s of [-1, 1]) tri(B, P(s * l, -w, eave), P(s * l, w, eave), P(s * l, 0, top), [ca * s, 0, sa * s], [[-w, 0], [w, 0], [0, rh]], Gw);
  } else { // hipped / pyramidal
    for (const s of [-1, 1]) quad(B, P(-l - o, s * (w + o), ye), P(l + o, s * (w + o), ye), P(ridge, 0, top), P(-ridge, 0, top), [-sa * s, 1, ca * s], [[0, 0], [L, 0], [L - 1, sl], [1, sl]], R);
    for (const s of [-1, 1]) tri(B, P(s * (l + o), -w - o, ye), P(s * (l + o), w + o, ye), P(s * ridge, 0, top), [ca * s, 1, sa * s], [[0, 0], [W, 0], [W / 2, sl]], R);
  }
  // eaves: fascia boards, white soffits under the overhang, gutters with downpipes at the corners
  {
    const fh = 0.2, edges = type === 1 ? [[-1, 1], [1, 1]] : [[-1, 1], [1, 1], [-1, 0], [1, 0]];
    for (const [sd, along] of edges) {
      const a = along ? P(-l - o, sd * (w + o), ye) : P(sd * (l + o), -w - o, ye), b = along ? P(l + o, sd * (w + o), ye) : P(sd * (l + o), w + o, ye);
      const nOut = along ? [-sa * sd, 0, ca * sd] : [ca * sd, 0, sa * sd];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      quad(B, [a[0], ye - fh, a[2]], [b[0], ye - fh, b[2]], [b[0], ye, b[2]], [a[0], ye, a[2]], nOut, [[0, 0], [len, 0], [len, fh], [0, fh]], part(7));
      const ai = along ? P(-l - o, sd * w, ye) : P(sd * l, -w - o, ye), bi = along ? P(l + o, sd * w, ye) : P(sd * l, w + o, ye);
      quad(B, [ai[0], ye - fh, ai[2]], [bi[0], ye - fh, bi[2]], [b[0], ye - fh, b[2]], [a[0], ye - fh, a[2]], [0, -1, 0], null, part(11));
      const g = 0.07, gx = nOut[0] * g, gz = nOut[2] * g;
      beam(B, [a[0] + gx, ye - 0.1, a[2] + gz], [b[0] + gx, ye - 0.1, b[2] + gz], 0.11, 0.09, part(8));
      if (along && sd === -1) for (const e of [a, b]) beam(B, [e[0] + gx * 1.2, ye - 0.12, e[2] + gz * 1.2], [e[0] + gx * 1.2, base - 0.2, e[2] + gz * 1.2], 0.07, 0.07, part(8), [ca, 0, sa]);
    }
  }
  if (type === 1) {
    // bargeboards on the gable rakes and ridge tiles along the ridge
    for (const s of [-1, 1]) for (const v of [-1, 1]) {
      const a = P(s * (l + o + 0.03), v * (w + o), ye), b = P(s * (l + o + 0.03), 0, top + 0.02);
      beam(B, [a[0], a[1] - 0.09, a[2]], [b[0], b[1] - 0.09, b[2]], 0.05, 0.2, part(7), [0, 1, 0]);
    }
    beam(B, P(-l - o, 0, top + 0.04), P(l + o, 0, top + 0.04), 0.22, 0.12, part(9));
  } else if (type !== 4) {
    if (ridge > 0.05) beam(B, P(-ridge, 0, top + 0.04), P(ridge, 0, top + 0.04), 0.22, 0.12, part(9));
    for (const s of [-1, 1]) for (const v of [-1, 1]) beam(B, P(s * ridge, 0, top + 0.03), P(s * (l + o), v * (w + o), ye + 0.03), 0.2, 0.1, part(9));
  }
  // television aerial on some pitched roofs (lived-in streets, not every house)
  if ((cls === 1 || cls === 2) && seed % 5 === 2) {
    const u = (seed % 2 ? 0.4 : -0.4) * Math.max(0.4, l * 0.5);
    const yA = type === 1 ? top - rh * 0.45 : eave + 0.15;
    const c = P(u, w * 0.2, yA);
    beam(B, c, [c[0], c[1] + 1.05, c[2]], 0.025, 0.025, part(8), [0, 1, 0]);
    beam(B, [c[0] - ca * 0.42, c[1] + 0.9, c[2] - sa * 0.42], [c[0] + ca * 0.42, c[1] + 0.9, c[2] + sa * 0.42], 0.015, 0.015, part(8));
    beam(B, [c[0] - sa * 0.26, c[1] + 0.72, c[2] + ca * 0.26], [c[0] + sa * 0.26, c[1] + 0.72, c[2] - ca * 0.26], 0.015, 0.015, part(8));
  }
  // chimney on houses
  if ((cls === 1 || cls === 2) && seed % 3 !== 0) {
    const u = (seed % 2 ? 1 : -1) * Math.max(0, (type === 1 ? l : ridge) - 0.7), v = 0.2;
    const c = P(u, v, 0), h0 = top - 1.0, h1 = top + 0.9, r = 0.35;
    const pts = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([a, b]) => [c[0] + a * ca - b * sa, c[2] + a * sa + b * ca]);
    const Cx = [...ex.slice(0, 3), 5];
    for (let q = 0; q < 4; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[(q + 1) % 4];
      quad(B, [ax, h0, az], [bx, h0, bz], [bx, h1, bz], [ax, h1, az], [(ax + bx) / 2 - c[0], 0, (az + bz) / 2 - c[2]], [[0, 0], [.7, 0], [.7, 1.9], [0, 1.9]], Cx);
    }
    quad(B, [pts[0][0], h1, pts[0][1]], [pts[1][0], h1, pts[1][1]], [pts[2][0], h1, pts[2][1]], [pts[3][0], h1, pts[3][1]], [0, 1, 0], null, Cx);
    // oversailing cap course and clay pots
    beam(B, [c[0] - ca * (r + 0.05), h1 - 0.06, c[2] - sa * (r + 0.05)], [c[0] + ca * (r + 0.05), h1 - 0.06, c[2] + sa * (r + 0.05)], 2 * r + 0.1, 0.12, Cx, [0, 1, 0]);
    for (const k of seed % 2 ? [-0.15, 0.15] : [0]) beam(B, [c[0] + ca * k, h1, c[2] + sa * k], [c[0] + ca * k, h1 + 0.42, c[2] + sa * k], 0.17, 0.17, part(10), [ca, 0, sa]);
  }
}

// canted bay window (ground floor, or both floors on some houses) and a hood over the front door
function addFrontage(B, F, base, low, wallH, floorH, ex, seed) {
  const part = k => [...ex.slice(0, 3), k];
  const tx = (F.x1 - F.x0) / F.fl, tz = (F.z1 - F.z0) / F.fl, nx = tz, nz = -tx;          // along the wall, outward
  const at = (t, d) => [F.x0 + tx * t + nx * d, F.z0 + tz * t + nz * d];
  if (F.fl >= 4.7 && seed % 5 !== 0) {
    const bt = (F.dT < 0.5 ? 0.7 : 0.3) * F.fl, back = 1.15, frontW = 0.72, dep = 0.62;
    const twoStorey = wallH > 4.6 && seed % 3 === 0;
    const yTop = base + (twoStorey ? Math.min(wallH - 0.25, floorH * 2 - 0.1) : Math.min(floorH - 0.1, 2.62));
    const C = [at(bt - back, 0), at(bt - frontW, dep), at(bt + frontW, dep), at(bt + back, 0)];
    // three glazed faces: u runs 0..1 across each side face and 0..2 across the front (two lights)
    const faces = [[C[0], C[1], 1], [C[1], C[2], 2], [C[2], C[3], 1]];
    for (const [a, b, n] of faces) {
      const nm = [(b[1] - a[1]), 0, -(b[0] - a[0])];
      quad(B, [a[0], low, a[1]], [b[0], low, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], nm, [[0, low - base], [n, low - base], [n, yTop - base], [0, yTop - base]], part(12));
    }
    // lean-to roof over the bay
    const rT = yTop + 0.42, rF = yTop + 0.08, o = 0.08;
    const R = [at(bt - back - o, 0), at(bt - frontW - o, dep + o), at(bt + frontW + o, dep + o), at(bt + back + o, 0)];
    quad(B, [R[0][0], rT, R[0][1]], [R[1][0], rF, R[1][1]], [R[2][0], rF, R[2][1]], [R[3][0], rT, R[3][1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], part(13));
    quad(B, [R[1][0], rF - 0.16, R[1][1]], [R[2][0], rF - 0.16, R[2][1]], [R[2][0], rF, R[2][1]], [R[1][0], rF, R[1][1]], [nx, 0, nz], null, part(7));
    quad(B, [C[1][0], yTop, C[1][1]], [C[2][0], yTop, C[2][1]], [R[2][0], rF - 0.16, R[2][1]], [R[1][0], rF - 0.16, R[1][1]], [0, -1, 0], null, part(11));
  }
  // door hood on brackets
  const dt = F.dT * F.fl, hw = 0.78, dep = 0.75, y = base + 2.38;
  const A0 = at(dt - hw, 0), A1 = at(dt + hw, 0), B0 = at(dt - hw, dep), B1 = at(dt + hw, dep);
  quad(B, [A0[0], y + 0.32, A0[1]], [A1[0], y + 0.32, A1[1]], [B1[0], y + 0.06, B1[1]], [B0[0], y + 0.06, B0[1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], part(13));
  quad(B, [B0[0], y - 0.04, B0[1]], [B1[0], y - 0.04, B1[1]], [B1[0], y + 0.06, B1[1]], [B0[0], y + 0.06, B0[1]], [nx, 0, nz], null, part(7));
  quad(B, [A0[0], y - 0.04, A0[1]], [A1[0], y - 0.04, A1[1]], [B1[0], y - 0.04, B1[1]], [B0[0], y - 0.04, B0[1]], [0, -1, 0], null, part(11));
  for (const e of [-hw + 0.06, hw - 0.06]) { const p = at(dt + e, 0.02), q = at(dt + e, dep - 0.05); beam(B, [p[0], y - 0.35, p[1]], [q[0], y - 0.04, q[1]], 0.06, 0.1, part(7), [0, 1, 0]); }
}

// ------------------------------------------------------------------ road markings
function buildMarkings(header, ox, oz, hAt0, deckOf = new Map()) {
  const B = new Buf(1);
  if (!NET) return B.pack();
  const P = NET.pts, cum = NET.cum;
  for (const e of header.edges) {
    const c = NET.cls[e];
    if (!NET.driveCls.has(c)) continue;
    const name = NET.classes[c];
    const minor = name === 'service' || name === 'track';
    const f = NET.flags[e];
    if (f & 8) continue;
    const bridge = !!(f & 4);
    // where a deck carries a piece of this road (approach slab, sagging ground) its markings lie on the deck
    const dk = deckOf.get(e);
    // markings sit just above the flat carriageway (or the deck), not in the terrain triangles
    const hAt = (x, z) => {
      if (dk) for (const [ax, ay, az, bx, by, bz, hw] of dk) {
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6, t = ((x - ax) * vx + (z - az) * vz) / L2;
        if (t < -0.02 || t > 1.02) continue;
        const tc = Math.max(0, Math.min(1, t));
        if (Math.hypot(ax + vx * tc - x, az + vz * tc - z) <= hw + 0.45) return ay + (by - ay) * tc - 0.005;
      }
      if (!bridge) {
        const pr = profileAt(x + ox, z + oz), g = pr && pr.ground;
        if (g && g.d <= g.hw + 0.45) return g.y - 0.01;
      }
      return hAt0(x, z);
    };
    const st = NET.pstart[e], n = NET.pcount[e];
    const L = cum[st + n - 1];
    const pts = []; for (let i = 0; i < n; i++) pts.push([P[(st + i) * 3] - ox, P[(st + i) * 3 + 1], P[(st + i) * 3 + 2] - oz, cum[st + i]]);
    const yAt = bridge ? (p, s) => sampleY(pts, s) + 0.065 : (p) => hAt(p[0], p[2]) + 0.07;
    const w = NET.width[e], lf = NET.lanesF[e], lb = NET.lanesB[e], oneway = f & 1;
    const s0 = NET.cutA[e], s1 = L - NET.cutB[e];
    const inTile = p => p[0] >= 0 && p[0] < TILE && p[2] >= 0 && p[2] < TILE;
    const line = (offset, width, from, to, dash, gap, id) => {
      for (let s = from; s < to; s += dash + gap) {
        const a = s, b = Math.min(to, s + dash);
        if (b - a < 0.2) continue;

        const segs = Math.max(1, Math.ceil((b - a) / 3));
        for (let k = 0; k < segs; k++) {
          const ta = a + (b - a) * k / segs, tb = a + (b - a) * (k + 1) / segs;
          if (!inTile(posAt(pts,(ta+tb)/2))) continue;
          const A1 = posAt(pts, ta), B1 = posAt(pts, tb);
          const q = [[A1, -1], [B1, -1], [B1, 1], [A1, 1]].map(([p, sd]) => {
            const x = p[0] + p[3] * (offset + sd * width / 2), z = p[2] + p[4] * (offset + sd * width / 2);
            return [x, 0, z];
          });
          q[0][1] = yAt(q[0], ta); q[1][1] = yAt(q[1], tb); q[2][1] = yAt(q[2], tb); q[3][1] = yAt(q[3], ta);
          quad(B, q[0], q[1], q[2], q[3], [0, 1, 0], null, [id]);
        }
      }
    };
    const total = Math.max(1, lf + lb), lw = w / total;
    const hs = NET.shoulder ? NET.shoulder[e] : 0, hst = NET.strip ? NET.strip[e] : 0;
    // road studs (cat's eyes) every 18 m at a lateral offset: surf 4 red, 5 amber, 6 white
    const studs = (offset, id, phase = 0) => {
      for (let sv = s0 + 4 + phase; sv < s1 - 2; sv += 18) {
        const p = posAt(pts, sv); if (!inTile(p)) continue;
        const ax = -p[4], az = p[3], cx = p[0] + p[3] * offset, cz = p[2] + p[4] * offset;
        const y = bridge ? sampleY(pts, sv) + 0.08 : hAt(cx, cz) + 0.09;
        const q = [[-0.09, -0.06], [0.09, -0.06], [0.09, 0.06], [-0.09, 0.06]].map(([a, l]) => [cx + ax * a + p[3] * l, y, cz + az * a + p[4] * l]);
        quad(B, q[0], q[1], q[2], q[3], [0, 1, 0], null, [id]);
      }
    };
    const fast = /^(motorway|trunk)/.test(name) || name === 'primary_link';
    if (!minor && L > 4 && s1 - s0 > 2 && w >= 4.5 && hs > 0) {
      // motorway (TSRGD 1012.1 / 1005): edge line between the hard shoulder and lane 1, offside edge line
      // beside the hard strip, 2 m lane lines with 7 m gaps; nothing on the hard shoulder itself
      const lwm = (w - hs - hst) / Math.max(1, lf);
      // the nearside edge line breaks (1.5 m marks) for 150 m where a slip road joins or leaves
      const zA = NET.linkNode.has(NET.ea[e]) ? Math.min(s1, s0 + 150) : s0, zB = NET.linkNode.has(NET.eb[e]) ? Math.max(zA, s1 - 150) : s1;
      if (zA > s0) line(w / 2 - hs, 0.2, s0, zA, 1.5, 1.5, 0);
      if (zB > zA) line(w / 2 - hs, 0.2, zA, zB, 1e4, 0, 0);
      if (s1 > zB) line(w / 2 - hs, 0.2, zB, s1, 1.5, 1.5, 0);
      line(-(w / 2 - hst), 0.2, s0, s1, 1e4, 0, 0);
      for (let k = 1; k < lf; k++) line(w / 2 - hs - k * lwm, 0.15, s0, s1, 2, 7, 0);
      studs(w / 2 - hs - 0.3, 4); studs(-(w / 2 - hst) + 0.3, 5);
      for (let k = 1; k < lf; k++) studs(w / 2 - hs - k * lwm, 6, 4.5);
    } else if (!minor && L > 4 && s1 - s0 > 2 && w >= 4.5) {
      if (!oneway && lf && lb && name !== 'living_street') {
        // centre line (TSRGD 1008), turning into a hazard warning line (1004) on the last 30 m before a
        // junction on the main roads
        const co = w / 2 - lf * lw, res = name === 'residential' || name === 'unclassified' || name === 'service';
        const mk = res ? 2.5 : 4, gp = res ? 4 : 5, major = /^(primary|secondary|tertiary|trunk)/.test(name);
        const hzA = major && NET.cutA[e] > 0 ? Math.min(s1, s0 + 30) : s0, hzB = major && NET.cutB[e] > 0 ? Math.max(hzA, s1 - 30) : s1;
        if (hzA > s0) line(co, 0.1, s0, hzA, 4, 2, 0);
        if (hzB > hzA) line(co, 0.1, hzA, hzB, mk, gp, 0);
        if (hzB < s1) line(co, 0.1, hzB, s1, 4, 2, 0);
      }
      // lane lines (forward lanes are left of centre: offset positive = left): 2 m / 7 m on fast roads,
      // 1 m / 5 m in town (TSRGD 1005)
      const [ld, lg] = fast ? [2, 7] : [1, 5];
      for (let k = 1; k < lf; k++) line(w / 2 - k * lw, 0.1, s0, s1, ld, lg, 0);
      for (let k = 1; k < lb; k++) line(-(w / 2 - k * lw), 0.1, s0, s1, ld, lg, 0);
      if (/motorway|trunk|primary/.test(name)) {
        line(w / 2 - 0.25, 0.15, s0, s1, 1e4, 0, 0);
        // a slip road's offside edge, where it runs alongside the motorway lane it leaves or joins: broken
        const lA = name === 'motorway_link' && NET.linkNode.has(NET.ea[e]) ? Math.min(s1, s0 + 80) : s0, lB = name === 'motorway_link' && NET.linkNode.has(NET.eb[e]) ? Math.max(lA, s1 - 80) : s1;
        if (lA > s0) line(-(w / 2 - 0.25), 0.15, s0, lA, 1.5, 1.5, 0);
        if (lB > lA) line(-(w / 2 - 0.25), 0.15, lA, lB, 1e4, 0, 0);
        if (s1 > lB) line(-(w / 2 - 0.25), 0.15, lB, s1, 1.5, 1.5, 0);
      }
      // dual carriageways and slip roads at speed: red studs on the nearside edge, amber offside, white between lanes
      if (oneway && fast && /motorway|trunk/.test(name)) { studs(w / 2 - 0.45, 4); studs(-(w / 2 - 0.45), 5); for (let k = 1; k < lf; k++) studs(w / 2 - k * lw, 6, 4.5); }
      if (header.core && /primary|secondary|tertiary/.test(name)) { for (const s of [1, -1]) { line(s * (w / 2 - 0.25), 0.08, s0, s1, 1e4, 0, 1); line(s * (w / 2 - 0.42), 0.08, s0, s1, 1e4, 0, 1); } }
    }
    // stop / give-way lines at ends
    const endLine = (atEnd, code, stopDist) => {
      const dirLeft = atEnd ? 1 : -1; // forward traffic arrives at B on the left half
      const s = atEnd ? (stopDist != null ? stopDist : L - Math.max(1.5, NET.cutB[e] - 0.5)) : (stopDist != null ? L - stopDist : Math.max(1.5, NET.cutA[e] - 0.5));
      if (s <= 0.3 || s >= L - 0.3) return;
      const p = posAt(pts, s); if (!inTile(p)) return;
      const halfFrom = oneway ? -w / 2 + 0.3 : 0.1, halfTo = w / 2 - 0.3;
      const tx = p[3], tz = p[4]; // left normal (p[3],p[4]) is lateral unit
      const sgn = oneway ? 1 : dirLeft;
      const mk = (o0, o1, thick, alongOff, id) => {
        const dx = -p[4] * (atEnd ? 1 : -1), dz = p[3] * (atEnd ? 1 : -1); // along travel
        const base = [p[0] + dx * alongOff, p[2] + dz * alongOff];
        const a = [base[0] + tx * o0 * sgn, 0, base[1] + tz * o0 * sgn], b = [base[0] + tx * o1 * sgn, 0, base[1] + tz * o1 * sgn];
        const c = [b[0] + dx * thick, 0, b[2] + dz * thick], d = [a[0] + dx * thick, 0, a[2] + dz * thick];
        for (const v of [a, b, c, d]) v[1] = bridge ? p[1] + 0.065 : hAt(v[0], v[2]) + 0.075;
        quad(B, a, b, c, d, [0, 1, 0], null, [id]);
      };
      if (code === 3 || code === 2) mk(halfFrom, halfTo, code === 2 ? 0.4 : 0.3, 0, 0);
      else if (code === 1) {   // give way: double broken line (TSRGD 1003)
        for (let o = halfFrom; o < halfTo; o += 0.9) { mk(o, Math.min(halfTo, o + 0.6), 0.2, 0, 0); mk(o, Math.min(halfTo, o + 0.6), 0.2, 0.4, 0); }
      } else if (code === 4) { // roundabout entry: single broken line (TSRGD 1003.1)
        for (let o = halfFrom; o < halfTo; o += 0.9) mk(o, Math.min(halfTo, o + 0.6), 0.2, 0, 0);
      }
    };
    const stops = NET.stops.get(e) || [];
    for (const [d, stop] of stops) { if (d === 1) endLine(true, 3, stop); else endLine(false, 3, stop); }
    if (NET.ctrlB[e] && NET.ctrlB[e] !== 3) endLine(true, NET.ctrlB[e]);
    if (NET.ctrlA[e] && NET.ctrlA[e] !== 3 && !oneway) endLine(false, NET.ctrlA[e]);
    // give-way triangle (TSRGD 1023) 15 m before a give-way line on a road wide enough for one: an outline,
    // point towards the driver, in the approaching lane
    if (!minor && w >= 4.5) for (const [atEnd, code] of [[true, NET.ctrlB[e]], [false, oneway ? 0 : NET.ctrlA[e]]]) {
      if (code !== 1) continue;
      const dir = atEnd ? 1 : -1, line0 = atEnd ? L - Math.max(1.5, NET.cutB[e] - 0.5) : Math.max(1.5, NET.cutA[e] - 0.5);
      const tip = line0 - dir * 18.75, base = tip + dir * 3.75;
      if (Math.min(tip, base) < 2 || Math.max(tip, base) > L - 2) continue;
      const lane = oneway ? 0 : dir * w / 4, half = Math.min(0.62, w / 8);
      const A = posAt(pts, tip); if (!inTile(A)) continue;
      const corner = (sv, o) => { const p = posAt(pts, sv), x = p[0] + p[3] * o, z = p[2] + p[4] * o; return [x, bridge ? p[1] + 0.065 : hAt(x, z) + 0.075, z]; };
      const T = corner(tip, lane), B1 = corner(base, lane - half), B2 = corner(base, lane + half);
      for (const [u, v] of [[T, B1], [T, B2], [B1, B2]]) {
        const dx = v[0] - u[0], dz = v[2] - u[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.08, nz = dx / l * 0.08;
        quad(B, [u[0] - nx, u[1], u[2] - nz], [v[0] - nx, v[1], v[2] - nz], [v[0] + nx, v[1], v[2] + nz], [u[0] + nx, u[1], u[2] + nz], [0, 1, 0], null, [0]);
      }
    }
    // crossings
    for (const cr of NET.cross.get(e) || []) {
      const idx = cr[1], kind = cr[2];
      const s = cum[st + idx];
      const p = posAt(pts, s); if (!inTile(p)) continue;
      const along = [-p[4], p[3]]; // travel dir
      const lat = [p[3], p[4]];
      const put = (o0, o1, a0, a1, id) => {
        const v = [[o0, a0], [o1, a0], [o1, a1], [o0, a1]].map(([o, a]) => {
          const x = p[0] + lat[0] * o + along[0] * a * -1, z = p[2] + lat[1] * o + along[1] * a * -1;
          return [x, bridge ? p[1] + 0.065 : hAt(x, z) + 0.076, z];
        });
        quad(B, v[0], v[1], v[2], v[3], [0, 1, 0], null, [id]);
      };
      // Tactile landings are inferred only on mapped/inferred pavement sides.
      for (const [side,bit] of [[1,1],[-1,2]]) if (NET.pav?.[e] & bit) {
        const o0=side*(w/2+.12), o1=side*(w/2+1.05);
        const landing=[[o0,-.9],[o1,-.9],[o1,.9],[o0,.9]].map(([o,a])=>{
          const x=p[0]+lat[0]*o+along[0]*a,z=p[2]+lat[1]*o+along[1]*a;
          return [x,(bridge?p[1]:hAt(x,z))+.185,z];
        });
        quad(B,...landing,[0,1,0],null,[kind==='uncontrolled'?3:2]);
      }
      if (kind === 'zebra') {
        for (let o = -w / 2 + 0.2; o < w / 2 - 0.4; o += 1.0) put(o, o + 0.5, -1.4, 1.4, 0);
        zigzags(B, pts, s, w, bridge, hAt, inTile, s0, s1);
      } else if (kind === 'signal') {
        for (let o = -w / 2; o < w / 2; o += 0.6) { put(o, o + 0.3, -1.6, -1.45, 0); put(o, o + 0.3, 1.45, 1.6, 0); }
        // zig-zags belong to stand-alone crossings, not to the crossings at a signalled junction
        const nearJunction = (NET.cutA[e] > 0 && s - s0 < 25) || (NET.cutB[e] > 0 && s1 - s < 25);
        if (!nearJunction) zigzags(B, pts, s, w, bridge, hAt, inTile, s0, s1);
      }
    }
    // bus stop box (TSRGD 1025.1) in the kerbside lane: a broken yellow line with tapered ends from 23 m
    // before the flag to 3 m past it, and BUS STOP in elongated letters read by the approaching driver
    for (const [sb, side, laneW, served] of NET.bays.get(e) || []) {
      if (!served || bridge) continue;
      const dir = side > 0 ? 1 : -1;                         // +1: buses run a->b with the stop on their left
      const k0 = w / 2 - 0.2, k1 = Math.max(0.35, w / 2 - laneW + 0.3);
      const lo = Math.max(1, Math.min(sb - dir * 23, sb + dir * 3)), hi = Math.min(L - 1, Math.max(sb - dir * 23, sb + dir * 3));
      if (hi - lo < 10 || k0 - k1 < 1.8) continue;
      if (!inTile(posAt(pts, (lo + hi) / 2))) continue;
      const P4 = (s, o) => { const p = posAt(pts, s), x = p[0] + p[3] * o, z = p[2] + p[4] * o; return [x, hAt(x, z) + 0.078, z]; };
      const rect = (sa, oa, sb2, ob) => quad(B, P4(sa, oa), P4(sb2, oa), P4(sb2, ob), P4(sa, ob), [0, 1, 0], null, [1]);
      line(side * k1, 0.1, lo + 2, hi - 2, 0.9, 0.6, 1);
      for (const [sA, sB] of [[lo, lo + 2], [hi, hi - 2]]) for (let q = 0; q < 3; q++) {   // tapers, kerb to the broken line
        const t0 = q / 3, t1 = (q + 0.6) / 3, oA = side * (k0 + (k1 - k0) * t0), oB = side * (k0 + (k1 - k0) * t1);
        const a = P4(sA + (sB - sA) * t0, oA), b = P4(sA + (sB - sA) * t1, oB);
        const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.05, nz = dx / l * 0.05;
        quad(B, [a[0] - nx, a[1], a[2] - nz], [b[0] - nx, b[1], b[2] - nz], [b[0] + nx, b[1], b[2] + nz], [a[0] + nx, a[1], a[2] + nz], [0, 1, 0], null, [1]);
      }
      // letters: u across from the driver's left (the kerb), v along the road away from the driver
      const word = (text, tFrom) => {
        const lw = 0.55, gap = 0.12, wide = text.length * lw + (text.length - 1) * gap, q0 = (k0 - k1 - wide) / 2;
        [...text].forEach((ch, i) => {
          for (const [u0, v0, u1, v1] of GLYPHS[ch] || []) {
            const qa = q0 + i * (lw + gap) + u0 * lw, qb = q0 + i * (lw + gap) + u1 * lw;
            const sa = sb + dir * (tFrom + v0 * 1.6), sb2 = sb + dir * (tFrom + v1 * 1.6);
            rect(sa, side * (k0 - qa), sb2, side * (k0 - qb));
          }
        });
      };
      word('BUS', -14); word('STOP', -10.5);
    }
  }
  return B.pack();
}
// block capitals for road text: [u0, v0, u1, v1] in a unit cell (u across from the reader's left, v away)
const GLYPHS = {
  B: [[0, 0, 0.22, 1], [0, 0.86, 0.8, 1], [0, 0.43, 0.8, 0.57], [0, 0, 0.8, 0.14], [0.78, 0.57, 1, 0.86], [0.78, 0.14, 1, 0.43]],
  U: [[0, 0.14, 0.22, 1], [0.78, 0.14, 1, 1], [0.1, 0, 0.9, 0.14]],
  S: [[0.1, 0.86, 1, 1], [0, 0.57, 0.22, 0.9], [0.1, 0.43, 0.9, 0.57], [0.78, 0.1, 1, 0.43], [0, 0, 0.9, 0.14]],
  T: [[0, 0.86, 1, 1], [0.39, 0, 0.61, 0.86]],
  O: [[0, 0.1, 0.22, 0.9], [0.78, 0.1, 1, 0.9], [0.1, 0.86, 0.9, 1], [0.1, 0, 0.9, 0.14]],
  P: [[0, 0, 0.22, 1], [0, 0.86, 0.9, 1], [0, 0.43, 0.9, 0.57], [0.78, 0.57, 1, 0.86]],
};
// zig-zags (TSRGD 1001.3) along both kerbs either side of a crossing, kept to this road: they stop where it
// meets a junction instead of piling up across it
function zigzags(B, pts, s, w, bridge, hAt, inTile, lo = 0, hi = Infinity) {
  for (const dir of [-1, 1]) for (const lat of [w / 2 - 0.3, -(w / 2 - 0.3)]) {
    for (let k = 0; k < 8; k++) {
      const a = s + dir * (3 + k * 2), b = s + dir * (3 + (k + 1) * 2);
      if (Math.min(a, b) < lo || Math.max(a, b) > hi) continue;
      const pa = posAt(pts, a), pb = posAt(pts, b);
      if (!pa || !pb || !inTile(pa)) continue;
      const oa = lat + (k % 2 ? 0.3 : -0.3) * Math.sign(lat), ob = lat + (k % 2 ? -0.3 : 0.3) * Math.sign(lat);
      const A1 = [pa[0] + pa[3] * oa, 0, pa[2] + pa[4] * oa], B1 = [pb[0] + pb[3] * ob, 0, pb[2] + pb[4] * ob];
      const dx = B1[0] - A1[0], dz = B1[2] - A1[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.05, nz = dx / l * 0.05;
      const q = [[A1[0] - nx, A1[2] - nz], [B1[0] - nx, B1[2] - nz], [B1[0] + nx, B1[2] + nz], [A1[0] + nx, A1[2] + nz]].map(([x, z]) => [x, bridge ? pa[1] + 0.065 : hAt(x, z) + 0.077, z]);
      quad(B, q[0], q[1], q[2], q[3], [0, 1, 0], null, [0]);
    }
  }
}
// pts entries: [x, y, z, cum]; returns [x, y, z, leftx, leftz]
function posAt(pts, s) {
  const L = pts[pts.length - 1][3];
  s = Math.max(0, Math.min(L, s));
  let i = 1; while (i < pts.length - 1 && pts[i][3] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = (b[3] - a[3]) || 1, t = (s - a[3]) / seg;
  const dx = (b[0] - a[0]) / seg, dz = (b[2] - a[2]) / seg;
  // left of travel direction (dx,dz) is (dz,-dx)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, dz, -dx];
}
function sampleY(pts, s) { return posAt(pts, s)[1]; }

// Water surfaces: the pipeline's water polygons (tile-local, padded under the banks) at the water level on the
// tile's 4 m grid (A.wl, cm, 32767 = none). wDepth = level minus the carved bed, for the water shader.
function buildWater(A, hAt) {
  const WL = A.wl, C = A.wtC, R = A.wtR, P = A.wtP;
  const lv = (x, z) => {
    const gx = Math.max(0, Math.min(NT - 1.0001, x / STEP)), gz = Math.max(0, Math.min(NT - 1.0001, z / STEP));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    let s = 0, w = 0;
    for (const [a, b, k] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]]) {
      const v = WL[(j + b) * NT + i + a]; if (v !== 32767) { s += v * (k + 1e-4); w += k + 1e-4; }
    }
    if (w) return s / w / 100;
    // outside the grid's water cells: the nearest level within 3 cells
    let best = null, bd = 1e9;
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= NT || jj >= NT) continue;
      const v = WL[jj * NT + ii]; if (v === 32767) continue;
      const d = a * a + b * b; if (d < bd) { bd = d; best = v / 100; }
    }
    return best;
  };
  const pos = [], dep = [], idx = [];
  let ci = 0, ri = 0;
  for (let pi = 0; pi < P.length; pi++) {
    const flat = [], holes = [];
    for (let k = 0; k < P[pi]; k++) {
      const n = R[ri++];
      if (k) holes.push(flat.length / 2);
      for (let q = 0; q < n; q++) flat.push(C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10);
      ci += n;
    }
    const base = pos.length / 3, nv = flat.length / 2, ys = [];
    let ok = true;
    for (let q = 0; q < nv; q++) { const y = lv(flat[q * 2], flat[q * 2 + 1]); if (y == null) { ok = false; break; } ys.push(y); }
    if (!ok) continue;
    for (let q = 0; q < nv; q++) {
      const x = flat[q * 2], z = flat[q * 2 + 1];
      pos.push(x, ys[q], z); dep.push(Math.max(0, ys[q] - hAt(x, z)));
    }
    const t = earcut(flat, holes.length ? holes : null);
    for (let q = 0; q < t.length; q += 3) idx.push(base + t[q], base + t[q + 2], base + t[q + 1]);
  }
  if (!idx.length) return null;
  return { position: new Float32Array(pos), depth: new Float32Array(dep), index: new Uint32Array(idx) };
}

// Exact point-in-carriageway test from the tile's road polygons (pipeline: roadC/roadR/roadP, grid-clipped to 32 m
// cells, so a point only needs the polygons of its own cell and the neighbours). inRoad(x, z, margin) is true
// inside a carriageway or within `margin` of one; inRoad.outside(x, z, gap) gives the nearest point `gap` metres
// beyond the kerb.
function roadIndex(A) {
  const C = A.roadC, R = A.roadR, P = A.roadP, cells = new Map(), rings = [];
  if (C && P) {
    let ci = 0, ri = 0;
    for (let pi = 0; pi < P.length; pi++) {
      const poly = [];
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let k = 0; k < P[pi]; k++) {
        const n = R[ri++], ring = new Float32Array(n * 2);
        for (let q = 0; q < n; q++) { const x = C[(ci + q) * 2] / 10, z = C[(ci + q) * 2 + 1] / 10; ring[q * 2] = x; ring[q * 2 + 1] = z; if (!k) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
        ci += n; poly.push(ring);
      }
      const id = rings.length; rings.push(poly);
      for (let cx = Math.floor(x0 / 32); cx <= Math.floor(x1 / 32); cx++) for (let cz = Math.floor(z0 / 32); cz <= Math.floor(z1 / 32); cz++) {
        const key = cx * 64 + cz; let l = cells.get(key); if (!l) cells.set(key, l = []); l.push(id);
      }
    }
  }
  const near = (x, z, m) => {
    const out = new Set();
    for (let cx = Math.floor((x - m) / 32); cx <= Math.floor((x + m) / 32); cx++) for (let cz = Math.floor((z - m) / 32); cz <= Math.floor((z + m) / 32); cz++) for (const id of cells.get(cx * 64 + cz) || []) out.add(id);
    return out;
  };
  const inside = (poly, x, z) => {
    let c = false;
    for (const ring of poly) for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  // nearest point on a polygon's boundary, ignoring edges along the 32 m clipping grid (they are not kerbs)
  const nearestEdge = (poly, x, z) => {
    let best = null;
    for (const ring of poly) for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
      const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
      if ((Math.abs(ax - bx) < 1e-3 && Math.abs(ax / 32 - Math.round(ax / 32)) < 1e-4) || (Math.abs(az - bz) < 1e-3 && Math.abs(az / 32 - Math.round(az / 32)) < 1e-4)) continue;
      const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1;
      let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best[2]) best = [px, pz, d];
    }
    return best;
  };
  const f = (x, z, m = 0) => {
    for (const id of near(x, z, m)) {
      const poly = rings[id];
      if (inside(poly, x, z)) return true;
      if (m > 0) { const e = nearestEdge(poly, x, z); if (e && e[2] < m) return true; }
    }
    return false;
  };
  f.outside = (x, z, gap) => {
    let best = null;
    for (const id of near(x, z, 12)) {
      const poly = rings[id]; if (!inside(poly, x, z)) continue;
      const e = nearestEdge(poly, x, z); if (!e) continue;
      const d = e[2] || 1e-3, ux = (e[0] - x) / d, uz = (e[1] - z) / d;
      const q = [e[0] + ux * gap, e[1] + uz * gap];
      if (!best || e[2] < best[2]) best = [q[0], q[1], e[2]];
    }
    return best && [best[0], best[1]];
  };
  return f;
}
