// The fishing lakes on the map, built from the world tiles for the fishing game (src/fishData.js, src/fishing.js):
// each lake's outline and depth on a 2 m grid (the tiles' water level less their carved bed), its islands, numbered
// pegs along the banks you may fish from (facing open water, spaced as on the real fishery, and kept out of any
// part closed to fishing), and lily beds in the shallow margins. Writes www/world/fishing/<id>.json and index.json.
//   node tools/fishing/lakes.mjs
// The waters (which are fisheries, their clubs and tickets, and their fish) come from the fishery listings cited in
// docs/SOURCES.md; where each lies on the map from the world's own water levels (docs/MAP-AUDIT.md) and OpenStreetMap.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decode } from '../../src/data.js';
const W = new URL('../../www/world/', import.meta.url).pathname;
const LAKES = [
  { id: 'southlake', name: 'South Lake', place: 'Woodley', level: 52.97, seed: [-3300, -1140], box: [-3600, -1320, -2960, -960], spacing: 38,
    closed: p => p.x < -3462, closedNote: 'The western end is closed to fishing.' },
  { id: 'whiteswan', name: 'White Swan Lake', place: 'Dinton Pastures', level: 37.22, seed: [-1279, -1218], box: [-1480, -1600, -1080, -820], spacing: 30 },
  { id: 'blackswan', name: 'Black Swan Lake', place: 'Dinton Pastures', level: 37.19, seed: [-815, -1295], box: [-1220, -1700, -420, -860], spacing: 48 },
  { id: 'canberra', name: 'Canberra Lake', place: 'Charvil', level: 34.64, seed: [-811, -4063], box: [-1000, -4300, -660, -3820], spacing: 30 },
  // Orrell: ten swims along the west bank
  { id: 'orrell', name: 'Orrell Lake', place: 'Charvil', level: 33.73, seed: [-704, -4925], box: [-790, -5080, -600, -4770], spacing: 14, bank: p => Math.cos(p.h) > 0.45, maxPegs: 10 },
];
const R = 2;

// the tiles once, cached by key
const tileCache = new Map();
function tile(ti, tj) {
  const k = ti + '_' + tj; if (tileCache.has(k)) return tileCache.get(k);
  const f = W + `tiles/${k}.bin`; let v = null;
  if (fs.existsSync(f)) { const raw = zlib.inflateSync(fs.readFileSync(f)); v = decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); }
  tileCache.set(k, v); return v;
}

function build(L) {
  const [X0, Z0, X1, Z1] = L.box, nx = (X1 - X0) / R, nz = (Z1 - Z0) / R;
  const dep = new Float32Array(nx * nz).fill(-1), ground = new Float32Array(nx * nz);
  for (let ti = Math.floor(X0 / 256); ti < X1 / 256; ti++) for (let tj = Math.floor(Z0 / 256); tj < Z1 / 256; tj++) {
    const T = tile(ti, tj); if (!T) continue;
    const { header: hd, arrays: A } = T, ox = ti * 256, oz = tj * 256;
    const H = (gx, gz) => { const i = Math.min(63, Math.floor(gx)), j = Math.min(63, Math.floor(gz)), u = gx - i, v = gz - j;
      const h = (a, b) => hd.hmin + A.h[b * 65 + a] / 100; return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
    for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
      const x = ox + i * 2 + 1, z = oz + j * 2 + 1, gi = Math.floor((x - X0) / R), gj = Math.floor((z - Z0) / R);
      if (gi < 0 || gj < 0 || gi >= nx || gj >= nz) continue;
      const k = gj * nx + gi, g = H((x - ox) / 4, (z - oz) / 4); ground[k] = g;
      const a = Math.round((x - ox) / 4), b = Math.round((z - oz) / 4), wl = A.wl ? A.wl[b * 65 + a] : 32767;
      if (A.lc[j * 128 + i] === 4 && wl !== 32767 && Math.abs(wl / 100 - L.level) < 0.025) dep[k] = Math.max(0.15, L.level - g);
    }
  }
  // the lake is the water body round the seed (the nearest water cell to it)
  let s0 = -1, sd = 1e9;
  for (let k = 0; k < nx * nz; k++) if (dep[k] >= 0) { const d = Math.hypot(X0 + (k % nx + 0.5) * R - L.seed[0], Z0 + (((k / nx) | 0) + 0.5) * R - L.seed[1]); if (d < sd) { sd = d; s0 = k; } }
  const inLake = new Uint8Array(nx * nz), st = [s0]; inLake[s0] = 1;
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (st.length) { const k = st.pop(), i = k % nx, j = (k / nx) | 0; for (const [di, dj] of N4) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const q = b * nx + a; if (dep[q] >= 0 && !inLake[q]) { inLake[q] = 1; st.push(q); } } }
  for (let k = 0; k < nx * nz; k++) if (!inLake[k]) dep[k] = -1;
  // islands: land not reached from the box's edge through land
  const outside = new Uint8Array(nx * nz), q = [];
  const edge = k => { if (dep[k] < 0 && !outside[k]) { outside[k] = 1; q.push(k); } };
  for (let i = 0; i < nx; i++) { edge(i); edge((nz - 1) * nx + i); } for (let j = 0; j < nz; j++) { edge(j * nx); edge(j * nx + nx - 1); }
  while (q.length) { const k = q.pop(), i = k % nx, j = (k / nx) | 0; for (const [di, dj] of N4) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const r = b * nx + a; if (dep[r] < 0 && !outside[r]) { outside[r] = 1; q.push(r); } } }
  const islands = [], seen = new Uint8Array(nx * nz);
  for (let s = 0; s < nx * nz; s++) {
    if (dep[s] >= 0 || outside[s] || seen[s]) continue;
    const w = [s]; seen[s] = 1; let n = 0, sx = 0, sz = 0;
    while (w.length) { const k = w.pop(); n++; sx += k % nx; sz += (k / nx) | 0; const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of N4) { const a = i + di, b = j + dj; const r = b * nx + a; if (dep[r] < 0 && !outside[r] && !seen[r]) { seen[r] = 1; w.push(r); } } }
    if (n * R * R >= 12) islands.push({ x: +(X0 + (sx / n + 0.5) * R).toFixed(1), z: +(Z0 + (sz / n + 0.5) * R).toFixed(1), r: +Math.sqrt(n * R * R / Math.PI).toFixed(1) });
  }
  // distance (m) from each water cell to the nearest land, bank or island (two-pass chamfer)
  const dist = new Float32Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) dist[k] = dep[k] < 0 ? 0 : 1e9;
  for (let pass = 0; pass < 2; pass++) {
    const js = pass ? [nz - 1, -1, -1] : [0, nz, 1], is = pass ? [nx - 1, -1, -1] : [0, nx, 1];
    const nb = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]].map(([a, b, w]) => pass ? [-a, -b, w] : [a, b, w]);
    for (let j = js[0]; j !== js[1]; j += js[2]) for (let i = is[0]; i !== is[1]; i += is[2]) {
      const k = j * nx + i; if (!dist[k]) continue;
      for (const [di, dj, w] of nb) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; dist[k] = Math.min(dist[k], dist[b * nx + a] + w * R); }
    }
  }
  // the bank: land cells (not islands) beside the water, each facing the water round it
  const bank = [];
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i; if (dep[k] >= 0 || !outside[k]) continue;
    let wx = 0, wz = 0, n = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; if (dep[b * nx + a] >= 0) { wx += di; wz += dj; n++; } }
    if (n >= 3) bank.push({ x: X0 + (i + 0.5) * R, z: Z0 + (j + 0.5) * R, h: Math.atan2(wz, wx), g: ground[k] });
  }
  const cx = bank.reduce((a, p) => a + p.x, 0) / bank.length, cz = bank.reduce((a, p) => a + p.z, 0) / bank.length;
  bank.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
  const cell = (x, z) => { const i = Math.floor((x - X0) / R), j = Math.floor((z - Z0) / R); return i >= 0 && j >= 0 && i < nx && j < nz ? j * nx + i : -1; };
  // pegs: round the bank at the fishery's spacing, facing open water (20 m or more of lake straight out)
  const pegs = [];
  for (const p of bank) {
    if (L.closed?.(p) || (L.bank && !L.bank(p))) continue;
    if (pegs.some(o => Math.hypot(p.x - o.x, p.z - o.z) < L.spacing)) continue;
    let open = 0; for (let d = 4; d <= 30; d += 2) { const k = cell(p.x + Math.cos(p.h) * d, p.z + Math.sin(p.h) * d); if (k >= 0 && dep[k] >= 0) open += 2; }
    if (open < Math.min(20, L.spacing * 1.2)) continue;
    pegs.push({ n: 0, x: +p.x.toFixed(1), z: +p.z.toFixed(1), heading: +p.h.toFixed(3), g: +p.g.toFixed(2) });
    if (L.maxPegs && pegs.length >= L.maxPegs) break;
  }
  pegs.forEach((p, i) => { p.n = i + 1; });
  // lily beds: in the shallows (0.4 to 1.3 m) near a bank or an island, spread apart (a seeded pick)
  let seed = 11 + L.id.length; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lilies = [], want = Math.max(2, Math.min(9, Math.round(nx * nz * R * R / 1e4)));
  for (let tries = 0; tries < 6000 && lilies.length < want; tries++) {
    const k = Math.floor(rnd() * nx * nz); if (dep[k] < 0.4 || dep[k] > 1.3 || dist[k] > 9) continue;
    const x = X0 + (k % nx + 0.5) * R, z = Z0 + (((k / nx) | 0) + 0.5) * R;
    if (lilies.some(l => Math.hypot(l.x - x, l.z - z) < 60)) continue;
    lilies.push({ x: +x.toFixed(1), z: +z.toFixed(1), r: +(3.5 + rnd() * 5).toFixed(1) });
  }
  const D = new Uint8Array(nx * nz); let maxD = 0, area = 0;
  for (let k = 0; k < nx * nz; k++) { D[k] = dep[k] < 0 ? 255 : Math.min(254, Math.round(dep[k] * 10)); if (dep[k] >= 0) { maxD = Math.max(maxD, dep[k]); area += R * R; } }
  const { closed, bank: _b, ...meta } = L; void closed; void _b;
  const out = { ...meta, x0: X0, z0: Z0, res: R, nx, nz, depth: Buffer.from(D).toString('base64'), islands, pegs, lilies, area: Math.round(area), maxDepth: +maxD.toFixed(2),
    x: Math.round(cx), z: Math.round(cz) };
  fs.writeFileSync(W + `fishing/${L.id}.json`, JSON.stringify(out));
  console.error(`${L.name}: ${(area / 10000).toFixed(2)} ha, max depth ${maxD.toFixed(2)} m, ${islands.length} islands, ${pegs.length} pegs, ${lilies.length} lily beds`);
  return { id: L.id, name: L.name, place: L.place, x: Math.round(cx), z: Math.round(cz), box: L.box, area: Math.round(area), pegs: pegs.length, closedNote: L.closedNote || '', peg1: pegs[0] ? { x: pegs[0].x, z: pegs[0].z } : null };
}
fs.mkdirSync(W + 'fishing', { recursive: true });
fs.rmSync(W + 'fishing/southlake.json', { force: true });
const index = LAKES.map(build);
fs.writeFileSync(W + 'fishing/index.json', JSON.stringify({ lakes: index }, null, 1));
