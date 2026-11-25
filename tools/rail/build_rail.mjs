// Builds www/world/rail.json for the train simulation from the rail centre lines already in the committed
// tiles (OSM railway=rail, clipped per tile, bridges left out by the pipeline). Pieces are joined across
// tile edges, gaps at bridges are bridged with straight links when the track continues in line, and every
// point gets a height from the tile terrain (+0.32 m, as drawn). Stations come from manifest.stations when
// the world data provides them, otherwise from public station coordinates (Wikipedia, WGS84) snapped to the
// nearest track. Usage: node tools/rail/build_rail.mjs
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { decode } from '../../src/data.js';
import { llToWorld } from '../../src/save.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TILE = 256, NT = 65, STEP = 4;
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'www/world/manifest.json'), 'utf8'));
// Wikipedia coordinates (en.wikipedia.org, prop=coordinates), used only when manifest.stations is absent
const STATIONS_LL = [
  ['Reading', 51.459, -0.9722], ['Earley', 51.441, -0.918], ['Winnersh Triangle', 51.437, -0.891], ['Winnersh', 51.43, -0.877],
  ['Wokingham', 51.411, -0.843], ['Bracknell', 51.413, -0.752], ['Martins Heron', 51.408, -0.725],
  ['Twyford', 51.476, -0.863], ['Tilehurst', 51.4715, -1.0295], ['Reading West', 51.455142, -0.990516],
];
// headway: seconds between trains each way (shorter than the real timetable, so nobody waits long in play).
// board: passengers can ride it. apart: through trains take a track at least this far from the station's
// snapped track (Reading has many; the terminating services use the snapped one and its platforms).
const LINES = [
  { name: 'Reading–Waterloo line', stops: ['Reading', 'Earley', 'Winnersh Triangle', 'Winnersh', 'Wokingham', 'Bracknell', 'Martins Heron'], vmax: 33, cars: 4, color: 0x2b3f8c, headway: 420, board: true },
  { name: 'Reading–Basingstoke line', stops: ['Reading', 'Reading West'], vmax: 20, cars: 2, color: 0x6a3a8c, headway: 360, board: true },
  { name: 'Great Western main line', stops: ['Reading'], through: 9000, vmax: 45, cars: 6, color: 0x1f4d3a, headway: 600, apart: 15 },
];
const tiles = new Map(), pieces = [];
for (const f of fs.readdirSync(path.join(ROOT, 'www/world/tiles'))) {
  const raw = fs.readFileSync(path.join(ROOT, 'www/world/tiles', f)); let b; try { b = zlib.inflateSync(raw); } catch { b = raw; }
  const c = decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); const { header, arrays: A } = c;
  const ox = header.ix * TILE, oz = header.iz * TILE, H = new Float32Array(NT * NT);
  for (let i = 0; i < H.length; i++) H[i] = header.hmin + A.h[i] / 100;
  tiles.set(header.ix + ',' + header.iz, { ox, oz, H });
  if (!A.railN || !A.railN.length) continue;
  let ci = 0;
  for (const n of A.railN) { const pts = []; for (let q = 0; q < n; q++) pts.push([ox + A.railC[(ci + q) * 2] / 10, oz + A.railC[(ci + q) * 2 + 1] / 10]); ci += n; pieces.push(pts); }
}
function terrain(x, z) {
  const t = tiles.get(Math.floor(x / TILE) + ',' + Math.floor(z / TILE)); if (!t) return null;
  const gx = Math.max(0, Math.min(NT - 1.0001, (x - t.ox) / STEP)), gz = Math.max(0, Math.min(NT - 1.0001, (z - t.oz) / STEP));
  const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j, H = t.H;
  const h00 = H[j * NT + i], h10 = H[j * NT + i + 1], h01 = H[(j + 1) * NT + i], h11 = H[(j + 1) * NT + i + 1];
  return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
}
// nodes: endpoints merged within 1.5 m
const nodes = [], grid = new Map();
const nodeAt = (x, z) => {
  const gx = Math.round(x / 3), gz = Math.round(z / 3);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get((gx + a) + ',' + (gz + b)) || []) if (Math.hypot(nodes[k][0] - x, nodes[k][1] - z) < 1.5) return k;
  nodes.push([x, z]); const key = gx + ',' + gz; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(nodes.length - 1); return nodes.length - 1;
};
const edges = [];
for (const p of pieces) { const a = nodeAt(...p[0]), b = nodeAt(...p.at(-1)); if (a === b && p.length < 3) continue; edges.push({ a, b, pts: p.map(q => [q[0], q[1]]), link: false }); }
// outward direction of edge i at its end (end=1 at b, 0 at a), and the direction leaving node n along it
const endTan = (e, end) => { const P = e.pts, p0 = end ? P.at(-1) : P[0], p1 = end ? P[Math.max(0, P.length - 3)] : P[Math.min(P.length - 1, 2)]; const dx = p0[0] - p1[0], dz = p0[1] - p1[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
const deg = new Map(), tangent = new Map(), leave = new Map();   // leave: node -> directions of track leaving it
for (const e of edges) for (const [n, end] of [[e.a, 0], [e.b, 1]]) {
  deg.set(n, (deg.get(n) || 0) + 1); const t = endTan(e, end); tangent.set(n, t);
  if (!leave.has(n)) leave.set(n, []); leave.get(n).push([-t[0], -t[1]]);
}
// bridge gaps: from each dangling end, join the nearest node ahead and in line whose track carries on in the
// same direction (bridges the pipeline left out, tile-edge slivers, junction pieces). Long aligned gaps between
// two dangling ends (track outside the mapped area) become hidden links: trains run through them unseen.
const dangling = [...deg].filter(([, d]) => d === 1).map(([n]) => n); let links = 0, hidden = 0; const linked = new Set();
// nearest point ahead of (ax, az) along (tx, tz) on any track segment running the same way; splits that edge
function joinPoint(a, ax, az, tx, tz) {
  let best = null;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]; if (e.link) continue;
    for (let k = 1; k < e.pts.length; k++) {
      const [px, pz] = e.pts[k - 1], [qx, qz] = e.pts[k];
      if (Math.min(px, qx) > ax + 200 || Math.max(px, qx) < ax - 200 || Math.min(pz, qz) > az + 200 || Math.max(pz, qz) < az - 200) continue;
      const sx = qx - px, sz = qz - pz, sl = Math.hypot(sx, sz) || 1, dir = (sx * tx + sz * tz) / sl;
      if (Math.abs(dir) < 0.92) continue;
      const t = Math.max(0, Math.min(1, ((ax - px) * sx + (az - pz) * sz) / (sl * sl)));
      // aim a little ahead along the target track so the link merges at a shallow angle
      const ahead = Math.max(t, Math.min(1, t + Math.sign(dir) * 0));
      const cx = px + sx * ahead, cz = pz + sz * ahead, dx = cx - ax, dz = cz - az, d = Math.hypot(dx, dz);
      if (d < 1 || d > 200) continue;
      const along = (dx * tx + dz * tz) / d; if (along < (d < 30 ? 0.94 : 0.985)) continue;
      if (e.a === a || e.b === a) continue;
      if (!best || d < best.d) best = { d, ei, k, t: ahead, x: cx, z: cz };
    }
  }
  if (!best) return null;
  const e = edges[best.ei];
  if (best.t <= 0.02 && best.k === 1) return { node: e.a, d: best.d };
  if (best.t >= 0.98 && best.k === e.pts.length - 1) return { node: e.b, d: best.d };
  const n = nodes.push([best.x, best.z]) - 1;
  const left = e.pts.slice(0, best.k).concat([[best.x, best.z]]), right = [[best.x, best.z]].concat(e.pts.slice(best.k));
  edges[best.ei] = { a: e.a, b: n, pts: left, link: false }; edges.push({ a: n, b: e.b, pts: right, link: false });
  return { node: n, d: best.d };
}
for (const a of dangling) {
  const [ax, az] = nodes[a], [tx, tz] = tangent.get(a);
  let j = joinPoint(a, ax, az, tx, tz), best = j ? j.node : null, bd = j ? j.d : 1e9;
  if (best == null) {   // long gap to another dangling end, both in line
    for (const b of dangling) { if (b === a) continue; const dx = nodes[b][0] - ax, dz = nodes[b][1] - az, d = Math.hypot(dx, dz); if (d < 200 || d > 3000) continue; const [ux, uz] = tangent.get(b); if ((dx * tx + dz * tz) / d > 0.9 && -(dx * ux + dz * uz) / d > 0.9 && d < bd) { bd = d; best = b; } }
    if (best != null) hidden++;
  }
  const key = Math.min(a, best) + ',' + Math.max(a, best);
  if (best != null && !linked.has(key)) { linked.add(key); edges.push({ a, b: best, pts: [nodes[a].slice(), nodes[best].slice()], link: true, hidden: bd >= 200 }); links++; }
}
// heights: terrain + 0.32 on track; links (bridges) interpolate between their ends
const out = { built: new Date().toISOString(), source: 'OSM railway=rail centre lines from the committed tiles; bridge gaps joined by straight links', nodes: nodes.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]), edges: [], stations: [], lines: [] };

for (const e of edges) {
  let ys = e.pts.map(([x, z]) => { const h = terrain(x, z); return h == null ? null : h + 0.32; });
  if (e.link) { const y0 = ys[0], y1 = ys.at(-1); ys = [y0, y1]; }
  for (let i = 0; i < ys.length; i++) if (ys[i] == null) ys[i] = ys.find(v => v != null) ?? 40;
  const flat = []; e.pts.forEach(([x, z], i) => flat.push(+x.toFixed(1), +ys[i].toFixed(2), +z.toFixed(1)));
  let len = 0; for (let i = 1; i < e.pts.length; i++) len += Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]);
  out.edges.push({ a: e.a, b: e.b, len: +len.toFixed(1), link: e.link || undefined, hidden: e.hidden || undefined, p: flat });
}
// stations
const src = Array.isArray(man.stations) && man.stations.length ? man.stations.map(s => [s[0], null, null, s[1], s[2]]) : STATIONS_LL.map(([n, lat, lon]) => [n, lat, lon, ...llToWorld(man.llfit, lon, lat)]);
for (const [name, lat, lon, x, z] of src) {
  let best = null; const cands = [];
  out.edges.forEach((e, ei) => { if (e.link) return; let s = 0, eb = null; for (let i = 3; i < e.p.length; i += 3) { const ax = e.p[i - 3], az = e.p[i - 1], bx = e.p[i], bz = e.p[i + 2]; const l = Math.hypot(bx - ax, bz - az) || 1; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (l * l))); const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, d = Math.hypot(px - x, pz - z); const c = { d, edge: ei, s: s + l * t, x: px, z: pz }; if (!best || d < best.d) best = c; if (!eb || d < eb.d) eb = c; s += l; } if (eb && eb.d < 200) cands.push(eb); });
  cands.sort((p, q) => p.d - q.d);
  if (best && best.d < 350) out.stations.push({ name, x: +best.x.toFixed(1), z: +best.z.toFixed(1), edge: best.edge, s: +best.s.toFixed(1), snapM: +best.d.toFixed(0), from: lat != null ? 'wikipedia' : 'manifest', alt: cands.slice(0, 12).map(c => ({ edge: c.edge, s: +c.s.toFixed(1), d: +c.d.toFixed(0) })) });
}
// ---- line paths: directed search over (edge, direction) with no reversals at junctions (turns < 35°)
const E = out.edges, adj = new Map();
E.forEach((e, i) => { for (const n of [e.a, e.b]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(i); } });
const P = i => { const p = E[i].p, o = []; for (let k = 0; k < p.length; k += 3) o.push([p[k], p[k + 1], p[k + 2]]); return o; };
const endNode = (i, d) => d ? E[i].a : E[i].b;
const tanAt = (i, d, atEnd) => { const q = P(i); if (d) q.reverse(); const [p0, p1] = atEnd ? [q.at(-2), q.at(-1)] : [q[0], q[1]]; const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
const nexts = (i, d) => { const n = endNode(i, d), [tx, tz] = tanAt(i, d, true), r = []; for (const f of adj.get(n) || []) { if (f === i) continue; const df = E[f].a === n ? 0 : 1; const [ux, uz] = tanAt(f, df, false); const dot = tx * ux + tz * uz; if (dot > 0.82) r.push([f, df, dot]); } return r; };
// polyline of edge i in direction d between distances s0..s1 measured in that direction
function slice(i, d, s0, s1) { const q = P(i); if (d) q.reverse(); const o = []; let acc = 0; for (let k = 0; k < q.length; k++) { if (k) acc += Math.hypot(q[k][0] - q[k - 1][0], q[k][2] - q[k - 1][2]); if (acc >= s0 - 1e-6 && acc <= s1 + 1e-6) o.push(q[k]); }
  const at = s => { let a = 0; for (let k = 1; k < q.length; k++) { const l = Math.hypot(q[k][0] - q[k - 1][0], q[k][2] - q[k - 1][2]); if (a + l >= s) { const t = l ? (s - a) / l : 0; return q[k - 1].map((v, j) => v + (q[k][j] - v) * t); } a += l; } return q.at(-1); };
  return [at(s0), ...o.filter(p => p), at(s1)]; }
function leg(A, B, dirs) {
  const LA = E[A.edge].len, best = { c: 1e18 }; const g = new Map(), came = new Map(), heap = [];
  const push = (c, st) => { heap.push([c, st]); heap.sort((a, b) => a[0] - b[0]); };
  for (const d of dirs) { const sA = d ? LA - A.s : A.s; if (A.edge === B.edge) { const sB = d ? LA - B.s : B.s; if (sB > sA && sB - sA < best.c) Object.assign(best, { c: sB - sA, direct: true, d }); } const c = LA - sA; g.set(A.edge + ':' + d, c); push(c, [A.edge, d]); }
  let it = 0;
  while (heap.length && it++ < 60000) { const [c, [i, d]] = heap.shift(); if (c > best.c) break; for (const [f, df] of nexts(i, d)) { const k = f + ':' + df; if (f === B.edge) { const sB = df ? E[f].len - B.s : B.s; if (c + sB < best.c) Object.assign(best, { c: c + sB, last: [f, df], prev: i + ':' + d, direct: false }); continue; } const nc = c + E[f].len; if (nc < (g.get(k) ?? 1e18)) { g.set(k, nc); came.set(k, i + ':' + d); push(nc, [f, df]); } } }
  if (best.c >= 1e18) return null;
  if (best.direct) { const d = best.d, sA = d ? LA - A.s : A.s, sB = d ? LA - B.s : B.s; return { pts: slice(A.edge, d, sA, sB), dirOut: d, len: best.c }; }
  const chain = []; let k = best.prev; while (k) { const [i, d] = k.split(':').map(Number); chain.unshift([i, d]); k = came.get(k); }
  const [d0] = [chain[0][1]], sA = d0 ? LA - A.s : A.s; let pts = slice(A.edge, d0, sA, LA);
  for (const [i, d] of chain.slice(1)) pts = pts.concat(slice(i, d, 0, E[i].len).slice(1));
  const [f, df] = best.last, sB = df ? E[f].len - B.s : B.s; pts = pts.concat(slice(f, df, 0, sB).slice(1));
  return { pts, dirOut: df, len: best.c };
}
// follow the straightest continuation from a station until the track ends (or maxLen)
function extend(A, d, maxLen) { const L = E[A.edge].len, s0 = d ? L - A.s : A.s; let pts = slice(A.edge, d, s0, L), len = L - s0, i = A.edge, dd = d; const seen = new Set();
  while (len < maxLen) { const n = nexts(i, dd).sort((a, b) => b[2] - a[2])[0]; if (!n || seen.has(n[0])) break; seen.add(n[0]); [i, dd] = n; pts = pts.concat(slice(i, dd, 0, E[i].len).slice(1)); len += E[i].len; } return { pts, len }; }
const st = Object.fromEntries(out.stations.map(s => [s.name, s]));
const cum = pts => { const c = [0]; for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2])); return c; };
for (const L of LINES) {
  const stops = L.stops.filter(n => st[n]); let pts = null, stopS = [], dir = [0, 1], prevEnd = null, missing = L.stops.filter(n => !st[n]);
  if (stops.length >= 2) {
    pts = []; stopS.push([stops[0], 0]);
    for (let k = 1; k < stops.length; k++) { let r = null; const As = k === 1 ? [st[stops[0]], ...st[stops[0]].alt] : [prevEnd], Bs = [st[stops[k]], ...st[stops[k]].alt];
      for (const A of As) { for (const B of Bs) { r = leg(A, B, k === 1 ? [0, 1] : dir); if (r) { prevEnd = B; break; } } if (r) break; } if (!r) { missing.push(...stops.slice(k)); break; } pts = pts.length ? pts.concat(r.pts.slice(1)) : r.pts; stopS.push([stops[k], cum(pts).at(-1)]); dir = [r.dirOut]; }
  } else if (stops.length === 1 && L.through) {
    // a through line with one station in the map: run end to end along the straightest track through it
    const S0 = st[stops[0]], S = L.apart ? (S0.alt.find(a => a.d >= L.apart && a.d < 60 && E[a.edge].len > 150) || S0) : S0;
    const ends = [0, 1].map(d => extend(S, d, L.through));
    const west = ends[0].pts.slice().reverse(); pts = west.concat(ends[1].pts.slice(1)); stopS = [['', 0], [stops[0], ends[0].len], ['', cum(pts).at(-1)]];
  }
  if (!pts || pts.length < 2) { console.log('line skipped', L.name); continue; }
  // height profile: a 60 m running median (drops DTM dips under short bridges) then a 40 m running mean
  { const c = cum(pts), y = pts.map(p => p[1]), med = y.map((_, i) => { const w = []; for (let j = i; j >= 0 && c[i] - c[j] < 30; j--) w.push(y[j]); for (let j = i + 1; j < y.length && c[j] - c[i] < 30; j++) w.push(y[j]); w.sort((a, b) => a - b); return w[w.length >> 1]; });
    const sm = med.map((_, i) => { let a = 0, n = 0; for (let j = i; j >= 0 && c[i] - c[j] < 20; j--) { a += med[j]; n++; } for (let j = i + 1; j < y.length && c[j] - c[i] < 20; j++) { a += med[j]; n++; } return a / n; });
    pts.forEach((p, i) => { p[1] = sm[i]; }); }
  const flat = []; for (const p of pts) flat.push(+p[0].toFixed(1), +p[1].toFixed(2), +p[2].toFixed(1));
  out.lines.push({ ...L, stops: stopS.map(([n, s]) => ({ name: n, s: +s.toFixed(1) })), missing, len: +cum(pts).at(-1).toFixed(0), p: flat, off: runningTracks(pts) });
}
// ---- running tracks. A line follows one OSM track; on double track the other lies 1.5-5 m to one side, and
// which side changes wherever the line hops between them. Trains keep left (UK): each direction runs on the
// left-hand track as seen in its direction of travel. off.f / off.b: lateral offset (m, + = left of the
// forward direction) of the track each direction uses, every off.ds metres along the line.
function runningTracks(pts) {
  const DS = 20, c = cum(pts), len = c.at(-1), n = Math.floor(len / DS) + 1, G = 40, grid = new Map();
  pieces.forEach((pc, pi) => { for (let k = 1; k < pc.length; k++) { const key = Math.floor(pc[k][0] / G) * 65536 + Math.floor(pc[k][1] / G); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(pi * 100000 + k); } });
  const at = s => { let i = 1; while (i < c.length - 1 && c[i] < s) i++; const a = pts[i - 1], b = pts[i], l = c[i] - c[i - 1] || 1, t = Math.max(0, Math.min(1, (s - c[i - 1]) / l)); return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, (b[0] - a[0]) / l, (b[2] - a[2]) / l]; };
  const other = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const [x, z, ux, uz] = at(i * DS), lx = uz, lz = -ux; let best = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const id of grid.get((Math.floor(x / G) + a) * 65536 + Math.floor(z / G) + b) || []) {
      const pc = pieces[Math.floor(id / 100000)], k = id % 100000, [px, pz] = pc[k - 1], [qx, qz] = pc[k];
      const sx = qx - px, sz = qz - pz, sl = Math.hypot(sx, sz) || 1; if (Math.abs((sx * ux + sz * uz) / sl) < 0.96) continue;
      const t = Math.max(0, Math.min(1, ((x - px) * sx + (z - pz) * sz) / (sl * sl))), cx = px + sx * t - x, cz = pz + sz * t - z;
      const lat = cx * lx + cz * lz; if (Math.abs(cx * ux + cz * uz) > 3 || Math.abs(lat) < 1.3 || Math.abs(lat) > 5.5) continue;
      if (!best || Math.abs(lat) < Math.abs(best)) best = lat;
    }
    other[i] = best;
  }
  // bridge short gaps (rail bridges carry no tile track) between readings on the same side
  for (let i = 0; i < n; i++) if (other[i] == null) {
    let a = i - 1; while (a >= 0 && other[a] == null) a--; let b = i + 1; while (b < n && other[b] == null) b++;
    if (a >= 0 && b < n && (b - a) * DS <= 400 && Math.sign(other[a]) === Math.sign(other[b])) other[i] = other[a] + (other[b] - other[a]) * (i - a) / (b - a);
  }
  const f = other.map(o => o != null && o > 0 ? o : 0), bk = other.map(o => o != null && o < 0 ? o : 0);
  const smooth = v => v.map((_, i) => { let s = 0, m = 0; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s += v[j]; m++; } return +(s / m).toFixed(2); });
  return { ds: DS, f: smooth(f), b: smooth(bk) };
}
const save = { built: out.built, source: out.source, graph: { nodes: out.nodes.length, edges: out.edges.length, links, hidden }, stations: out.stations.map(({ alt, edge, s, ...r }) => r), lines: out.lines };
fs.writeFileSync(path.join(ROOT, 'www/world/rail.json'), JSON.stringify(save));
console.log(out.lines.map(l => `${l.name}: ${l.len} m, stops ${l.stops.map(s => s.name + '@' + Math.round(s.s)).join(' ')}${l.missing.length ? ' (outside the map: ' + l.missing.join(', ') + ')' : ''}`).join('\n'));
console.log({ pieces: pieces.length, nodes: nodes.length, edges: out.edges.length, links, hidden, stations: out.stations.map(s => `${s.name} (${s.snapM} m)`), kB: Math.round(fs.statSync(path.join(ROOT, 'www/world/rail.json')).size / 1024) });
if (process.env.RAILDBG) {
  for (const n of process.env.RAILDBG.split(',')) for (const d of [0, 1]) { const r = extend(st[n], d, 20000); const e = r.pts.at(-1); console.log(n, d, Math.round(r.len), 'ends at', Math.round(e[0]), Math.round(e[2])); }
  const dang = [...new Set(out.edges.flatMap(e => [e.a, e.b]))].filter(n => adj.get(n).length === 1);
  console.log('dangling', dang.length);
}
if (process.env.NEAR) { const [x, z] = process.env.NEAR.split(',').map(Number);
  for (const [n, d] of deg) { const [nx, nz] = nodes[n]; const D = Math.hypot(nx - x, nz - z); if (D < 500) console.log('node', n, 'deg', d, 'adj', adj.get(n)?.length, Math.round(nx), Math.round(nz), 'D', Math.round(D), 'tan', tangent.get(n).map(v => v.toFixed(2)).join(','), 'edges', (adj.get(n) || []).map(i => E[i].link ? 'L' : Math.round(E[i].len)).join('/')); } }
