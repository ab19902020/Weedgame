// The road the tiles draw (src/tileWorker.js) lies where the traffic drives: the ground is cut down under a
// road that runs below it and decks carry the pieces the ground falls away from, at the bridges, underpasses
// and junctions where they used to part (Hatch Farm Way's spans, Berkeley Avenue over the A33, the IDR under
// Castle Hill and beside Windrush roundabout, the A329(M) over the M4 at junction 10), and along the M4; and
// no station platform is buried in the side of the cutting it stands in.
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

// drive-road points in a tile where the drawn road (terrain + 5 cm) and the traffic part by more than 35 cm,
// leaving out points a deck carries (approach slabs, links between spans, decks over sagging ground)
function parted(key, r) {
  const [ix, iz] = key.split('_').map(Number), ox = ix * 256, oz = iz * 256, H = r.heights, decked = new Set(r.decks);
  const hAt = (x, z) => { const gx = Math.max(0, Math.min(63.9999, x / 4)), gz = Math.max(0, Math.min(63.9999, z / 4)), i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j; const h00 = H[j * 65 + i], h10 = H[j * 65 + i + 1], h01 = H[(j + 1) * 65 + i], h11 = H[(j + 1) * 65 + i + 1]; return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01); };
  const out = []; let n = 0;
  for (let e = 0; e < net.nEdges; e++) {
    if (!(net.flags[e] & 16) || (net.flags[e] & 12) || /footway|path|pedestrian|steps|cycleway|bridleway|corridor/.test(net.clsName(e))) continue;
    const s0 = net.pstart[e], rs = net.slabRange.get(e);
    for (let k = 0; k < net.pcount[e]; k++) {
      const i = (s0 + k) * 3, x = net.pts[i] - ox, z = net.pts[i + 2] - oz;
      if (x < 0 || x >= 256 || z < 0 || z >= 256) continue;
      const sk = net.cum[s0 + k];
      if (net.connector[e] || (rs && rs.some(q => sk >= q[0] - 0.5 && sk <= q[1] + 0.5)) || decked.has(s0 + k) || (k > 0 && decked.has(s0 + k - 1))) continue;
      n++;
      const d = hAt(x, z) + 0.05 - net.pts[i + 1];
      if (Math.abs(d) > 0.35) out.push(`${net.clsName(e)} ${net.roadName(e) || ''} at ${net.pts[i].toFixed(0)},${net.pts[i + 2].toFixed(0)}: drawn ${d > 0 ? 'above' : 'below'} by ${Math.abs(d).toFixed(2)} m`);
    }
  }
  return { out, n };
}

test('the drawn road meets the traffic at the bridges and underpasses it used to part from', async () => {
  let n = 0;
  // Hatch Farm Way's spans, Berkeley Avenue over the A33, Castle Hill and Windrush roundabouts over the IDR, J10
  for (const key of ['-9_0', '-9_-1', '-30_-7', '-31_-9', '-31_-10', '2_0', '2_-1', '3_0']) {
    const r = await build(key), p = parted(key, r);
    assert.deepEqual(p.out, [], `tile ${key}`);
    n += p.n;
  }
  assert.ok(n > 1000, `${n} road points checked`);
});

test('the M4 is drawn where its traffic drives, end to end', async () => {
  const keys = new Set();
  for (let e = 0; e < net.nEdges; e++) if (net.names[net.ref[e]] === 'M4') { const s = net.pstart[e]; for (let k = 0; k < net.pcount[e]; k++) keys.add(Math.floor(net.pts[(s + k) * 3] / 256) + '_' + Math.floor(net.pts[(s + k) * 3 + 2] / 256)); }
  let n = 0;
  for (const key of keys) {
    if (!fs.existsSync(path.join(root, 'www/world/tiles', key + '.bin'))) continue;
    const r = await build(key), p = parted(key, r);
    assert.deepEqual(p.out.filter(s => s.startsWith('motorway')), [], `tile ${key}`);
    n += p.n;
  }
  assert.ok(keys.size > 30 && n > 3000, `${keys.size} tiles, ${n} road points checked`);
});

test('decks over sagging ground are reported for the ground under the player', async () => {
  // the slip roads climbing out of the IDR cutting beside Windrush roundabout ride on decks
  const r = await build('-31_-10');
  assert.ok(r.decks.length > 0, 'decked segments reported');
  const near = [...r.decks].map(j => [net.pts[j * 3], net.pts[j * 3 + 2]]).filter(([x, z]) => Math.hypot(x + 7905, z + 2495) < 30);
  assert.ok(near.length > 0, 'the slip road beside the cutting is decked');
});

test('no platform is buried in its cutting: the ground lies below every platform', async () => {
  const tiles = new Map();
  const ground = async (x, z) => {
    const key = Math.floor(x / 256) + '_' + Math.floor(z / 256);
    if (!tiles.has(key)) tiles.set(key, fs.existsSync(path.join(root, 'www/world/tiles', key + '.bin')) ? await build(key) : null);
    const r = tiles.get(key); if (!r) return null;   // (past the edge of the map)
    const H = r.heights, gx = Math.min(63.9999, (x - r.ox) / 4), gz = Math.min(63.9999, (z - r.oz) / 4), i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    const h00 = H[j * 65 + i], h10 = H[j * 65 + i + 1], h01 = H[(j + 1) * 65 + i], h11 = H[(j + 1) * 65 + i + 1];
    return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  };
  let n = 0;
  for (const p of stations.platforms) for (let i = 0; i < p.pts.length; i++) for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const [x, y, z] = stations.across(p, i, f), g = await ground(x, z);
    if (g === null) continue;
    assert.ok(g < y - 0.05, `${p.name} platform ${p.number}: ground ${(g - y).toFixed(2)} m from the surface`);
    assert.ok(g > y - 0.86 - 4.0, `${p.name} platform ${p.number}: the back wall reaches the ground`);
    n++;
  }
  assert.ok(n > 1000, `${n} points on platforms checked`);
});
