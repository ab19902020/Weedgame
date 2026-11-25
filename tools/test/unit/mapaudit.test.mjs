// The map audit (docs/MAP-AUDIT.md) checked against the committed world: the whole study area is built,
// back lanes are complete and connected, and the lakes have real levels and carved beds you can swim in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../../src/data.js';
import { loadNet, manifest } from './world.mjs';
import { F_DRIVE } from '../../../src/network.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function tile(key) {
  const raw = fs.readFileSync(path.join(root, 'www/world/tiles', key + '.bin'));
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  try { return decode(ab); } catch { return decode(await inflate(ab)); }
}
// water level and bed at world (x, z) from a tile's 4 m grids
async function water(x, z) {
  const ix = Math.floor(x / 256), iz = Math.floor(z / 256), t = await tile(`${ix}_${iz}`);
  const A = t.arrays || t, H = t.header || t.meta || t;
  const i = Math.round((x - ix * 256) / 4), j = Math.round((z - iz * 256) / 4);
  const wl = A.wl?.[j * 65 + i];
  return { level: wl == null || wl === 32767 ? null : wl / 100, bed: (H.hmin ?? 0) + A.h[j * 65 + i] / 100 };
}

test('the world covers the whole study area', () => {
  const m = manifest();
  assert.ok(m.coverageAreaKm2 > 200, `coverage ${m.coverageAreaKm2} km²`);
  assert.ok(m.tiles.length > 3000, `${m.tiles.length} tiles`);
  for (const name of ['Hurst', 'Twyford', 'Sonning', 'Charvil']) assert.ok(m.districts.some(d => d.name === name), `${name} is named on the map`);
});

test('Sandford Lane is complete and joined to the road network', async () => {
  const net = await loadNet(), N = net.nodes.length / 3, E = net.ea.length;
  const parent = Int32Array.from({ length: N }, (_, i) => i), find = a => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let e = 0; e < E; e++) if (net.flags[e] & F_DRIVE) { const a = find(net.ea[e]), b = find(net.eb[e]); if (a !== b) parent[a] = b; }
  const len = new Map(); for (let e = 0; e < E; e++) if (net.flags[e] & F_DRIVE) { const r = find(net.ea[e]); len.set(r, (len.get(r) || 0) + net.len[e]); }
  const main = [...len.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const si = net.names.indexOf('Sandford Lane'); let n = 0, L = 0;
  for (let e = 0; e < E; e++) if (net.name[e] === si) { n++; L += net.len[e]; assert.equal(find(net.ea[e]), main, 'in the main network'); }
  assert.ok(L > 1400, `Sandford Lane ${L.toFixed(0)} m long`);
});

test('lakes have measured levels and carved beds deep enough to swim in', async () => {
  const south = await water(-3328, -1140);           // South Lake, Woodley
  assert.ok(Math.abs(south.level - 52.97) < 0.1, `South Lake level ${south.level}`);
  assert.ok(south.level - south.bed > 3, `South Lake ${(south.level - south.bed).toFixed(2)} m deep`);
  const swan = await water(-1064, -1128);            // Black Swan Lake, Dinton Pastures
  assert.ok(swan.level - swan.bed > 5, `Black Swan Lake ${(swan.level - swan.bed).toFixed(2)} m deep`);
});

test('the M4 runs unbroken across the map, J12 (Theale) to J8/9 (Holyport)', async () => {
  const net = await loadNet(), N = net.nodes.length / 3, E = net.ea.length;
  const parent = Int32Array.from({ length: N }, (_, i) => i), find = a => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let e = 0; e < E; e++) if (net.flags[e] & F_DRIVE) { const a = find(net.ea[e]), b = find(net.eb[e]); if (a !== b) parent[a] = b; }
  const refs = new Set(); net.names.forEach((s, i) => { if (/(^|;)M4($|;)/.test(s)) refs.add(i); });
  const deg = new Map(); let xmin = 1e9, xmax = -1e9, root = null;
  for (let e = 0; e < E; e++) {
    if (!refs.has(net.ref[e]) || net.classes[net.cls[e]] !== 'motorway') continue;
    const r = find(net.ea[e]); if (root == null) root = r; assert.equal(r, root, 'one connected road');
    for (const v of [net.ea[e], net.eb[e]]) deg.set(v, (deg.get(v) || 0) + 1);
    const s = net.pstart[e]; for (let k = 0; k < net.pcount[e]; k++) { const x = net.pts[(s + k) * 3]; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
  }
  assert.ok(xmin < -14300 && xmax > 10200, `M4 spans x ${xmin.toFixed(0)}..${xmax.toFixed(0)} (J12 at -14282, J8/9 at 10219)`);
  // the only carriageway ends are where the data stops, beyond both junctions
  for (const [v, d] of deg) if (d === 1) { const x = net.nodes[v * 3]; assert.ok(x < -14300 || x > 10200, `M4 carriageway ends at x ${x.toFixed(0)}`); }
  const m = manifest(), tiles = new Set(m.tiles);
  for (const [x, z] of [[-14282, -891], [-7870, 2128], [133, 647], [10219, -7615]]) assert.ok(tiles.has(`${Math.floor(x / 256)}_${Math.floor(z / 256)}`), `junction at ${x},${z} is built`);
});
