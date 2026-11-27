// Road geometry repairs at load (src/roadProfile.js, src/roadDetail.js): bridges meet their approaches,
// no road climbs like a wall, the M4 runs through, decks clear what passes beneath, bus stops stand at
// the kerb and signal stop lines sit in front of the traffic they hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../../src/data.js';
import { Network, F_BRIDGE, F_TUNNEL, F_DRIVE, F_ONEWAY } from '../../../src/network.js';
import { repairGaps, alignRoads } from '../../../src/roadProfile.js';
import zlib from 'node:zlib';
import { cleanSignals, motorwayLayout, kerbBusStops, applyStops, barriers, shelterPose } from '../../../src/roadDetail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let cached = null;
async function roads() {
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(root, 'www/world/network.bin'));
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  let c; try { c = decode(ab); } catch { c = decode(await inflate(ab)); }
  const added = repairGaps(c);
  cleanSignals(c);
  const net = new Network(c);
  net.addedBridges = added;
  const rail = JSON.parse(fs.readFileSync(path.join(root, 'www/world/rail.json'), 'utf8'));
  alignRoads(net, rail);
  motorwayLayout(net); kerbBusStops(net); applyStops(net, JSON.parse(fs.readFileSync(path.join(root, 'www/world/stops.json'), 'utf8'))); barriers(net);
  cached = { net, rail };
  return cached;
}
const endY = (net, e, n) => net.pts[(net.ea[e] === n ? net.pstart[e] : net.pstart[e] + net.pcount[e] - 1) * 3 + 1];

test('bridge decks meet the roads leading onto them', async () => {
  const { net } = await roads();
  const at = new Map();
  for (let e = 0; e < net.nEdges; e++) if (net.flags[e] & F_DRIVE) for (const n of [net.ea[e], net.eb[e]]) { if (!at.has(n)) at.set(n, []); at.get(n).push(e); }
  let joins = 0;
  for (const [n, es] of at) {
    if (!es.some(e => net.flags[e] & F_BRIDGE) || !es.some(e => !(net.flags[e] & F_BRIDGE))) continue;
    const ys = es.map(e => endY(net, e, n));
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.05, `deck and road meet at node ${n} (${ys.map(y => y.toFixed(2)).join(' / ')})`);
    joins++;
  }
  assert.ok(joins > 200, `checked ${joins} bridge ends`);
});

test('main roads never climb like a wall', async () => {
  const { net } = await roads();
  let worst = 0, where = '';
  for (let e = 0; e < net.nEdges; e++) {
    if (!(net.flags[e] & F_DRIVE) || (net.flags[e] & F_TUNNEL) || !/^(motorway|trunk|primary|secondary)/.test(net.clsName(e))) continue;
    const s = net.pstart[e];
    for (let k = 0; k + 1 < net.pcount[e]; k++) {
      const a = (s + k) * 3, b = a + 3, d = Math.hypot(net.pts[b] - net.pts[a], net.pts[b + 2] - net.pts[a + 2]);
      if (d < 2) continue;
      const g = Math.abs(net.pts[b + 1] - net.pts[a + 1]) / d;
      if (g > worst) { worst = g; where = `${net.clsName(e)} ${net.roadName(e)} at ${net.pts[a].toFixed(0)},${net.pts[a + 2].toFixed(0)}`; }
    }
  }
  assert.ok(worst < 0.1, `steepest main-road segment ${(worst * 100).toFixed(1)} % (${where})`);
});

test('the M4 runs through: no dead end inside the map', async () => {
  const { net } = await roads();
  const deg = new Map();
  for (let e = 0; e < net.nEdges; e++) for (const n of [net.ea[e], net.eb[e]]) deg.set(n, (deg.get(n) || 0) + 1);
  for (let e = 0; e < net.nEdges; e++) {
    if (net.names[net.ref[e]] !== 'M4' || net.clsName(e) !== 'motorway') continue;
    for (const n of [net.ea[e], net.eb[e]]) {
      if (deg.get(n) !== 1) continue;
      const x = net.nodes[n * 3];
      assert.ok(x < -6000 || x > 1300, `M4 carriageway ends at x=${x.toFixed(0)}, inside the map`);
    }
  }
  // (until v0.17 the pipeline dropped the M4's River Loddon spans and repairGaps rejoined them; the rebuilt
  // network has them, which the dead-end check above proves either way)
  assert.ok(Array.isArray(net.addedBridges), 'gap repair ran');
});

test('decks clear the roads and railways beneath them', async () => {
  const { net, rail } = await roads();
  const segX = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = cx - ax, qz = cz - az, t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
  };
  let checked = 0, worst = Infinity;
  for (let e = 0; e < net.nEdges; e++) {
    if (!(net.flags[e] & F_BRIDGE) || !(net.flags[e] & F_DRIVE)) continue;
    const s = net.pstart[e];
    for (let k = 0; k + 1 < net.pcount[e]; k++) {
      const a = (s + k) * 3, b = a + 3, P = net.pts;
      for (const L of rail.lines) for (let i = 0; i + 5 < L.p.length; i += 3) {
        const x = segX(P[a], P[a + 2], P[b], P[b + 2], L.p[i], L.p[i + 2], L.p[i + 3], L.p[i + 5]); if (!x) continue;
        const deck = P[a + 1] + (P[b + 1] - P[a + 1]) * x[0], low = L.p[i + 1] + (L.p[i + 4] - L.p[i + 1]) * x[1];
        worst = Math.min(worst, deck - low); checked++;
      }
    }
  }
  assert.ok(checked > 5, `checked ${checked} road bridges over railways`);
  assert.ok(worst > 5.5, `least deck height over a railway ${worst.toFixed(2)} m`);
});

test('bus stops stand at the kerb, not in the carriageway', async () => {
  const { net } = await roads();
  for (const [x, z, name] of net.busStops) {
    const n = net.nearest(x, z, 30, e => (net.flags[e] & F_DRIVE) && !(net.flags[e] & F_BRIDGE) && !/service|footway|path|cycleway|steps|pedestrian|track/.test(net.clsName(e)));
    if (!n) continue;
    assert.ok(n.d >= net.width[n.e] / 2 - 0.3, `stop ${name || '(unnamed)'} at ${x},${z} stands ${n.d.toFixed(1)} m from the centre of ${net.roadName(n.e)} (half width ${(net.width[n.e] / 2).toFixed(1)})`);
  }
  assert.ok(net.busBays.filter(b => b.served).length > 200, 'bays marked where buses pass');
});

test('signal stop lines face traffic arriving at the signal, outside the junction', async () => {
  const { net } = await roads();
  let n = 0;
  for (const c of net.controllers) for (const [e, d, stop] of c.approaches) {
    assert.ok(stop > 1, `stop line ${stop} m into edge ${e}: traffic there is leaving the signal`);
    assert.ok(stop <= net.len[e], 'stop line on its road');
    n++;
  }
  assert.ok(n > 400, `${n} approaches`);
});

test('motorway lanes leave the hard shoulder clear', async () => {
  const { net } = await roads();
  let n = 0;
  for (let e = 0; e < net.nEdges; e++) {
    if (!net.shoulder[e]) continue;
    assert.ok(net.flags[e] & F_ONEWAY);
    const lanes = net.lanesF[e], laneW = (net.width[e] - net.shoulder[e] - net.strip[e]) / lanes;
    assert.ok(laneW > 3.4 && laneW < 3.9, `lane width ${laneW.toFixed(2)} m`);
    // 3.3 m standard; the five-lane sections at J11 leave 2.75 m
    assert.ok(net.shoulder[e] > 2.5 && net.shoulder[e] < 3.6, `hard shoulder ${net.shoulder[e].toFixed(2)} m`);
    n++;
  }
  assert.ok(n > 30, `${n} motorway carriageway edges with a hard shoulder`);
  assert.ok(net.barriers.length > 1000, 'central reservation and embankment barriers built');
});

test('bus stop flags and shelters stand clear of the road surface the tiles draw', async () => {
  const { net } = await roads();
  const tiles = new Map();
  const roadPolys = (x, z) => {
    const ix = Math.floor(x / 256), iz = Math.floor(z / 256), k = ix + ',' + iz;
    if (!tiles.has(k)) {
      const f = path.join(root, 'www/world/tiles', `${ix}_${iz}.bin`); let polys = [];
      if (fs.existsSync(f)) {
        const b = zlib.inflateSync(fs.readFileSync(f)), { header: H, arrays: A } = decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
        let ci = 0, ri = 0;
        for (let pi = 0; pi < A.roadP.length; pi++) { const rings = []; for (let q = 0; q < A.roadP[pi]; q++) { const n = A.roadR[ri++], ring = []; for (let j = 0; j < n; j++) ring.push([A.roadC[(ci + j) * 2] / 10 + H.ix * 256, A.roadC[(ci + j) * 2 + 1] / 10 + H.iz * 256]); ci += n; rings.push(ring); } polys.push(rings); }
      }
      tiles.set(k, polys);
    }
    return tiles.get(k);
  };
  const inRing = (r, x, z) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; };
  const onRoad = (x, z) => roadPolys(x, z).some(rings => inRing(rings[0], x, z) && !rings.slice(1).some(h => inRing(h, x, z)));
  let shelters = 0;
  net.busStops.forEach(([x, z, name, shelter], i) => {
    assert.ok(!onRoad(x, z), `the flag of ${name || 'stop ' + i} stands on the road at ${x},${z}`);
    if (!shelter) return;
    const fit = net.shelterPoses?.[i]; assert.ok(fit, `shelter ${i} placed`);
    const [cx, cz, h] = fit, ca = Math.cos(h), sa = Math.sin(h);
    for (const [u, v] of [[-1.6, -0.7], [1.6, -0.7], [1.6, 0.7], [-1.6, 0.7], [0, 0]]) assert.ok(!onRoad(cx + ca * u - sa * v, cz + sa * u + ca * v), `the shelter of ${name || 'stop ' + i} reaches into the road`);
    assert.ok(Math.cos(h - shelterPose(net, x, z).h) > 0.99, 'shelter faces the road its flag stands by');
    shelters++;
  });
  assert.ok(shelters > 150, `${shelters} shelters checked`);
});

test('Warren Road crosses the railway with a connected two-way deck', async () => {
  const { net } = await roads();
  const span = net.addedBridges.find(e => net.names[net.name[e]] === 'Warren Road');
  assert.ok(span !== undefined);
  assert.ok(net.flags[span] & F_BRIDGE);
  assert.equal(net.flags[span] & F_ONEWAY, 0);
  assert.ok(net.len[span] > 70 && net.len[span] < 80);
  assert.ok(net.lanesF[span] && net.lanesB[span]);
});
