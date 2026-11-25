// Fits every bus stop flag and shelter onto the footway beside its road, using the road and pavement
// polygons and the land cover the tiles actually draw: the network's centre lines alone miss junction
// mouths, lay-bys, service roads and narrow town-centre pavements, where stops snapped to the kerb by
// roadDetail.js can still stand on the road or put their shelter into a road or a building.
// Writes www/world/stops.json, applied at load (roadDetail.applyStops). Usage: node tools/roads/stops.mjs
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { decode } from '../../src/data.js';
import { Network } from '../../src/network.js';
import { repairGaps, alignRoads } from '../../src/roadProfile.js';
import { cleanSignals, motorwayLayout, kerbBusStops, shelterPose } from '../../src/roadDetail.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), W = path.join(ROOT, 'www/world');
const unz = f => { const raw = fs.readFileSync(f); let b; try { b = zlib.inflateSync(raw); } catch { b = raw; } return decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const c = unz(path.join(W, 'network.bin')), added = repairGaps(c); cleanSignals(c);
const net = new Network(c); net.addedBridges = added;
alignRoads(net, JSON.parse(fs.readFileSync(path.join(W, 'rail.json'), 'utf8'))); motorwayLayout(net);
const mapped = net.busStops.map(s => [s[0], s[1]]);
kerbBusStops(net);
// ---- what the tiles draw: road and pavement polygons, 2 m land cover (3 building, 4 water)
const tiles = new Map();
const tile = (ix, iz) => {
  const k = ix + ',' + iz; if (tiles.has(k)) return tiles.get(k);
  let t = null; const f = path.join(W, 'tiles', `${ix}_${iz}.bin`);
  if (fs.existsSync(f)) {
    const { header: H, arrays: A } = unz(f), ox = H.ix * 256, oz = H.iz * 256;
    const polys = pre => { const C = A[pre + 'C'], R = A[pre + 'R'], P = A[pre + 'P'], out = []; let ci = 0, ri = 0;
      for (let pi = 0; pi < P.length; pi++) { const rings = []; for (let q = 0; q < P[pi]; q++) { const n = R[ri++], ring = []; for (let j = 0; j < n; j++) ring.push([C[(ci + j) * 2] / 10 + ox, C[(ci + j) * 2 + 1] / 10 + oz]); ci += n; rings.push(ring); } out.push(rings); } return out; };
    t = { road: polys('road'), pave: polys('pave'), lc: A.lc, ox, oz };
  }
  tiles.set(k, t); return t;
};
const inRing = (r, x, z) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; };
const inPolys = (ps, x, z) => ps.some(rings => inRing(rings[0], x, z) && !rings.slice(1).some(h => inRing(h, x, z)));
const T = (x, z) => tile(Math.floor(x / 256), Math.floor(z / 256));
const onRoad = (x, z) => { const t = T(x, z); return !!t && inPolys(t.road, x, z); };
const onPave = (x, z) => { const t = T(x, z); return !!t && inPolys(t.pave, x, z); };
const cover = (x, z) => { const t = T(x, z); if (!t) return -1; const lx = Math.floor((x - t.ox) / 2), lz = Math.floor((z - t.oz) / 2); return t.lc[Math.min(127, Math.max(0, lz)) * 128 + Math.min(127, Math.max(0, lx))]; };
const blocked = (x, z) => onRoad(x, z) || [3, 4, 9].includes(cover(x, z));
// a flag spot: clear of the road by 0.35 m all round, not in water or on the railway, and not in a building
// (the 2 m land cover runs a little over narrow pavements in front of buildings: drawn pavement is fine)
const flagOk = (x, z) => { const c = cover(x, z); return !onRoad(x, z) && c !== 4 && c !== 9 && (c !== 3 || onPave(x, z)) && [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].every(([a, b]) => !onRoad(x + a, z + b)); };
// a shelter footprint (3.2 x 1.4 m at heading h, its open side towards the road) clear of road and buildings
const shelterOk = (cx, cz, h) => { const ca = Math.cos(h), sa = Math.sin(h);
  for (const [u, v] of [[-1.7, -0.75], [1.7, -0.75], [1.7, 0.75], [-1.7, 0.75], [0, 0], [0, -0.75], [0, 0.75], [-1.7, 0], [1.7, 0]]) { const x = cx + ca * u - sa * v, z = cz + sa * u + ca * v; if (blocked(x, z)) return false; }
  return true; };
const out = [], stats = { stops: 0, flagsMoved: 0, flagsStillOnRoad: 0, shelters: 0, sheltersPlaced: 0, sheltersDropped: 0 };
net.busStops.forEach((st, i) => {
  stats.stops++;
  let [x, z] = st;
  const road = net.nearest(x, z, 30, e => !!(net.flags[e] & 16) && !/footway|path|cycleway|steps|pedestrian|bridleway|corridor|track/.test(net.classes[net.cls[e]]));
  // outwards: away from the road the stop belongs to
  let ox = 0, oz = 0;
  if (road) { const dx = x - road.x, dz = z - road.z, l = Math.hypot(dx, dz); if (l > 0.05) { ox = dx / l; oz = dz / l; } else { ox = road.dz; oz = -road.dx; } }
  if (!flagOk(x, z)) {
    let best = null;
    for (let k = 0.25; k <= 8 && !best; k += 0.25) for (const a of [0, 1, -1, 2, -2, 3, -3]) {
      const px = x + ox * k + (road ? road.dx : 0) * a, pz = z + oz * k + (road ? road.dz : 0) * a;
      if (flagOk(px, pz)) { const score = Math.hypot(px - x, pz - z) - (onPave(px, pz) ? 0.6 : 0); if (!best || score < best[2]) best = [px, pz, score]; }
    }
    if (best) { [x, z] = best; stats.flagsMoved++; } else if (onRoad(x, z)) stats.flagsStillOnRoad++;
  }
  const entry = [Math.round(mapped[i][0] * 10) / 10, Math.round(mapped[i][1] * 10) / 10, Math.round(x * 100) / 100, Math.round(z * 100) / 100];
  if (st[3]) {
    stats.shelters++;
    // the open side faces the road; try behind the flag, ahead of it, beside it, a little further back
    const h = shelterPose(net, x, z).h, ca = Math.cos(h), sa = Math.sin(h), bx = Math.sin(h), bz = -Math.cos(h);
    let pose = null;
    for (const back of [0.95, 1.4, 2.0]) { for (const along of [-2.8, 2.8, -4.4, 4.4, 0]) { const cx = x + bx * back + ca * along, cz = z + bz * back + sa * along; if (shelterOk(cx, cz, h)) { pose = [cx, cz]; break; } } if (pose) break; }
    if (pose) { entry.push(Math.round(pose[0] * 100) / 100, Math.round(pose[1] * 100) / 100, Math.round(h * 1000) / 1000); stats.sheltersPlaced++; } else stats.sheltersDropped++;
  }
  out.push(entry);
});
fs.writeFileSync(path.join(W, 'stops.json'), JSON.stringify({ built: new Date().toISOString(), source: 'bus stops fitted to the drawn footways (tools/roads/stops.mjs)', stops: out }));
console.log(stats);
