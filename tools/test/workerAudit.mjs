// Runs the real tile worker (src/tileWorker.js) in Node over every built tile, fed exactly as main.js/tiles.js
// feed it, and audits what it makes: lamp posts, trees, street furniture (telegraph poles, pillar boxes, bins,
// benches) and bridge piers standing in a carriageway (more than 25 cm inside the tile's road polygons).
// Usage: node tools/test/workerAudit.mjs [maxTiles]   (WORKER=path to audit another copy of the worker)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../src/data.js';
import { Network } from '../../src/network.js';
import { repairGaps, alignRoads } from '../../src/roadProfile.js';
import { cleanSignals, motorwayLayout, kerbBusStops, applyStops, barriers } from '../../src/roadDetail.js';
import { Trains } from '../../src/trains.js';
import { Stations } from '../../src/stations.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = async f => { const raw = fs.readFileSync(path.join(root, f)); const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); try { return decode(ab); } catch { return decode(await inflate(ab)); } };
const c = await load('www/world/network.bin');
const added = repairGaps(c); cleanSignals(c);
const net = new Network(c); net.addedBridges = added;
const rail = JSON.parse(fs.readFileSync(path.join(root, 'www/world/rail.json'), 'utf8'));
alignRoads(net, rail);
const stations = new Stations({ trains: Object.assign(new Trains(null).setup(rail), { ready: true }) });
motorwayLayout(net); kerbBusStops(net); applyStops(net, JSON.parse(fs.readFileSync(path.join(root, 'www/world/stops.json'), 'utf8'))); barriers(net);
const results = [];
globalThis.self = { postMessage: o => results.push(o) };
globalThis.fetch = async url => { const b = fs.readFileSync(path.join(root, 'www', url)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
await import(process.env.WORKER || '../../src/tileWorker.js');
self.onmessage({ data: {
  type: 'init', pts: net.pts, pstart: net.pstart, pcount: net.pcount, width: net.width, flags: net.flags, cls: net.cls,
  pav: net.pav, lanesF: net.lanesF, lanesB: net.lanesB, cutA: net.cutA, cutB: net.cutB, ctrlA: net.ctrlA, ctrlB: net.ctrlB,
  classes: net.classes, crossings: net.crossings, ea: net.ea, eb: net.eb, rise: net.rise, addedBridges: net.addedBridges,
  shoulder: net.shoulder, strip: net.strip, barriers: net.barriers,
  slabs: [...(net.slabRange || new Map())].flatMap(([e, rs]) => rs.flatMap(r => [e, r[0], r[1]])), connector: net.connector,
  bays: (net.busBays || []).flatMap(b => [b.e, b.s, b.side, b.laneW, b.served ? 1 : 0]),
  approaches: net.controllers.flatMap(cc => cc.approaches.map(a => [a[0], a[1], a[2]])),
  driveCls: net.classes.map((cl, i) => [cl, i]).filter(([cl]) => !/footway|path|pedestrian|steps|cycleway|bridleway|corridor/.test(cl)).map(([, i]) => i),
  platforms: stations.footprints(), railLines: rail.lines.map(L => ({ p: L.p, off: L.off })),
} });
// exact road polygons of a tile for the audit (independent of the worker's own index)
function roadPolys(A) {
  const C = A.roadC, R = A.roadR, P = A.roadP, out = []; if (!C || !P) return out;
  let ci = 0, ri = 0;
  for (let pi = 0; pi < P.length; pi++) { const poly = []; for (let k = 0; k < P[pi]; k++) { const n = R[ri++], ring = []; for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]); ci += n; poly.push(ring); } out.push(poly); }
  return out;
}
const pip = (poly, x, z) => { let c = false; for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const depthIn = (polys, x, z) => { for (const poly of polys) if (pip(poly, x, z)) { let d = 1e9; for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [ax, az] = ring[j], [bx, bz] = ring[i]; if ((Math.abs(ax - bx) < 1e-3 && Math.abs(ax / 32 - Math.round(ax / 32)) < 1e-4) || (Math.abs(az - bz) < 1e-3 && Math.abs(az / 32 - Math.round(az / 32)) < 1e-4)) continue; const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1; let t = ((x - ax) * ex + (z - az) * ez) / L2; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t)); } return d; } return 0; };
const man = JSON.parse(fs.readFileSync(path.join(root, 'www/world/manifest.json'), 'utf8'));
const keys = process.env.TILES ? process.env.TILES.split(',') : man.tiles.slice(0, Number(process.argv[2]) || man.tiles.length);
const S = { tiles: 0, lamps: 0, lampsInRoad: 0, trees: 0, treesInRoad: 0, props: 0, propsInRoad: 0, piers: 0, piersInRoad: 0 }, ex = [];
for (const key of keys) {
  results.length = 0;
  await self.onmessage({ data: { type: 'tile', url: 'world/tiles/' + key + '.bin', key, lod: 0 } });
  const out = results[0]; if (!out || out.error) { console.log('error', key, out?.error?.slice(0, 200)); continue; }
  const { arrays: A } = await load('www/world/tiles/' + key + '.bin');
  const polys = roadPolys(A); S.tiles++;
  const chk = (kind, x, z, r, sub = '') => { S[kind]++; const d = depthIn(polys, x, z); if (d > r) { S[kind + 'InRoad']++; if (ex.length < 20) ex.push([kind + sub, key, Math.round(x + out.ox), Math.round(z + out.oz), +d.toFixed(2)]); } };
  for (let k = 0; k < out.lamps.length; k += 4) chk('lamps', out.lamps[k], out.lamps[k + 2], 0.25);
  for (let k = 0; k < out.trees.length; k += 4) chk('trees', out.trees[k], out.trees[k + 2], 0.25);
  const B = out.brk, BR = 14;
  for (let k = 0; k < B.length; k += BR) { if ([1, 2, 3, 5].includes(B[k])) chk('props', B[k + 3], B[k + 4], 0.2, ':' + B[k]); else if (B[k] === 4) chk('props', (B[k + 3] + B[k + 5]) / 2, (B[k + 4] + B[k + 6]) / 2, 0.2, ':4'); }
  const PR = out.piers || []; for (let k = 0; k < PR.length; k += 8) chk('piers', PR[k], PR[k + 1], 0.1);
  if (S.tiles % 500 === 0) console.log(S.tiles, JSON.stringify(S));
}
console.log(JSON.stringify(S)); for (const e of ex) console.log(JSON.stringify(e));
