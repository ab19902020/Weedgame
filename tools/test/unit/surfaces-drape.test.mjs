// Off-road ground surfaces the tiles draw (src/tileWorker.js) lie over the terrain: no grass or tarmac pokes up
// through a pavement, footpath or paved square, wherever the ground bends under it; and a car park carries
// painted bays on the lattice its parked cars stand on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../../src/data.js';
import { Network } from '../../../src/network.js';
import { repairGaps, alignRoads } from '../../../src/roadProfile.js';
import { cleanSignals, motorwayLayout, kerbBusStops, applyStops, barriers } from '../../../src/roadDetail.js';
import { Trains } from '../../../src/trains.js';
import { Stations } from '../../../src/stations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const raw = fs.readFileSync(path.join(root, 'www/world/network.bin'));
const c = decode(await inflate(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
const added = repairGaps(c); cleanSignals(c);
const net = new Network(c); net.addedBridges = added;
const rail = JSON.parse(fs.readFileSync(path.join(root, 'www/world/rail.json'), 'utf8'));
alignRoads(net, rail);
const stations = new Stations({ trains: Object.assign(new Trains(null).setup(rail), { ready: true }) });   // as main.js
motorwayLayout(net); kerbBusStops(net); applyStops(net, JSON.parse(fs.readFileSync(path.join(root, 'www/world/stops.json'), 'utf8'))); barriers(net);

// the tile worker, fed the network as tiles.js feeds it
let result = null;
globalThis.self = { postMessage: o => { result = o; } };
globalThis.fetch = async url => { const b = fs.readFileSync(path.join(root, 'www', url)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
await import('../../../src/tileWorker.js');
self.onmessage({ data: {
  type: 'init', pts: net.pts, pstart: net.pstart, pcount: net.pcount, width: net.width, flags: net.flags, cls: net.cls,
  pav: net.pav, lanesF: net.lanesF, lanesB: net.lanesB, cutA: net.cutA, cutB: net.cutB, ctrlA: net.ctrlA, ctrlB: net.ctrlB,
  classes: net.classes, crossings: net.crossings, ea: net.ea, eb: net.eb, rise: net.rise, addedBridges: net.addedBridges,
  shoulder: net.shoulder, strip: net.strip, barriers: net.barriers,
  slabs: [...(net.slabRange || new Map())].flatMap(([e, rs]) => rs.flatMap(r => [e, r[0], r[1]])), connector: net.connector,
  bays: (net.busBays || []).flatMap(b => [b.e, b.s, b.side, b.laneW, b.served ? 1 : 0]),
  approaches: net.controllers.flatMap(c => c.approaches.map(a => [a[0], a[1], a[2]])),
  driveCls: net.classes.map((c, i) => [c, i]).filter(([c]) => !/footway|path|pedestrian|steps|cycleway|bridleway|corridor/.test(c)).map(([, i]) => i),
  platforms: stations.footprints(), railLines: rail.lines.map(L => ({ p: L.p, off: L.off })),
} });
const build = async key => { result = null; await self.onmessage({ data: { type: 'tile', key, lod: 0, url: `world/tiles/${key}.bin` } }); assert.ok(result && !result.error, `tile ${key} builds: ${result && result.error}`); return result; };


// the terrain mesh's height at a tile-local point (the grid the worker sends, 65 x 65 at 4 m, split as it is)
const meshAt = (r, x, z) => {
  const P = r.terrain.position, at = (i, j) => P[(j * 65 + i) * 3 + 1];
  const gx = Math.max(0, Math.min(63.9999, x / 4)), gz = Math.max(0, Math.min(63.9999, z / 4)), i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
  const h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
  return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
};
// points on pavements (1), paths (3) and plazas (4) where the terrain comes within 1 cm of the surface
function poking(r) {
  const P = r.ground.position, S = r.ground.extra, N = r.ground.normal, bad = []; let n = 0;
  for (let t = 0; t < r.ground.count; t += 3) {
    const id = S[t]; if (id !== 1 && id !== 3 && id !== 4) continue;
    if (N[t * 3 + 1] < 0.9) continue;
    const v = k => [P[(t + k) * 3], P[(t + k) * 3 + 1], P[(t + k) * 3 + 2]], A = v(0), B = v(1), C = v(2);
    for (const [a, b, c] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8]]) {
      const x = A[0] * a + B[0] * b + C[0] * c, y = A[1] * a + B[1] * b + C[1] * c, z = A[2] * a + B[2] * b + C[2] * c;
      if (x < 0 || z < 0 || x > 256 || z > 256) continue;
      n++;
      if (meshAt(r, x, z) > y - 0.01) bad.push([x.toFixed(1), z.toFixed(1), id, (meshAt(r, x, z) - y).toFixed(2)]);
    }
  }
  return { n, bad };
}

test('the ground never pokes through a pavement, footpath or paved square', async () => {
  // a Woodley estate with verges and humped pavements, Reading town centre, a car park beside a shopping parade
  for (const key of ['-13_-6', '-30_-10', '-11_-9', '-12_-9']) {
    const r = await build(key), { n, bad } = poking(r);
    assert.ok(n > 200, `${key}: ${n} surface points tested`);
    assert.ok(bad.length <= n * 0.002, `${key}: the ground rises through the surface at ${bad.length} of ${n} points, e.g. ${JSON.stringify(bad.slice(0, 6))}`);
  }
});

test('car parks are tarmac with painted bays, lined up with the cars parked in them', async () => {
  for (const key of ['-11_-9', '-12_-9']) {
    const r = await build(key), P = r.markings.position, S = r.markings.extra;
    const slots = []; for (let k = 0; k < r.slots.length; k += 4) if (r.slotKind[k / 4] === 1) slots.push([r.slots[k], r.slots[k + 2], r.slots[k + 3]]);
    assert.ok(slots.length > 10, `${key}: cars parked in car parks`);
    // white marking quads (6 vertices each) within 3 m of a parked car
    const dirs = [];
    for (let q = 0; q < r.markings.count; q += 6) {
      if (S[q] !== 0) continue;
      const cx = (P[q * 3] + P[(q + 1) * 3] + P[(q + 2) * 3]) / 3, cz = (P[q * 3 + 2] + P[(q + 1) * 3 + 2] + P[(q + 2) * 3 + 2]) / 3;
      const near = slots.find(([x, z]) => Math.hypot(x - cx, z - cz) < 3);
      if (near) dirs.push([Math.atan2(P[(q + 1) * 3 + 2] - P[q * 3 + 2], P[(q + 1) * 3] - P[q * 3]), near[2]]);
    }
    assert.ok(dirs.length > 60, `${key}: ${dirs.length} painted bay pieces beside the parked cars`);
    // every line beside a car runs along or across its heading
    const skew = dirs.filter(([a, h]) => { const d = (((a - h) % (Math.PI / 2)) + Math.PI) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d) > 0.02; }).length;
    assert.ok(skew <= dirs.length * 0.05, `${key}: ${skew} of ${dirs.length} bay lines beside a car run at an angle to it`);
    // the ground under the parked cars is tarmac (surface 5), not block paving (4)
    const G = r.ground.position, GS = r.ground.extra, under = { 4: 0, 5: 0 };
    for (const [x, z] of slots) for (let t = 0; t < r.ground.count; t += 3) {
      if (GS[t] !== 4 && GS[t] !== 5) continue;
      const a = [G[t * 3], G[t * 3 + 2]], b = [G[t * 3 + 3], G[t * 3 + 5]], c = [G[t * 3 + 6], G[t * 3 + 8]];
      const s1 = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]), s2 = (c[0] - b[0]) * (z - b[1]) - (c[1] - b[1]) * (x - b[0]), s3 = (a[0] - c[0]) * (z - c[1]) - (a[1] - c[1]) * (x - c[0]);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) { under[GS[t]]++; break; }
    }
    assert.ok(under[5] > 0 && under[4] === 0, `${key}: parked cars on tarmac ${under[5]}, on block paving ${under[4]}`);
  }
});
