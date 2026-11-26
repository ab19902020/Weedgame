// Picks the enterable buildings from the scanned building table (tools/interiors/scan.mjs) and writes
// www/world/interiors.json: for each, its kind, name, street, district, the interior's floor plan (a rectangle
// inside the footprint, front wall facing the street), floor heights and the front door outside.
// node tools/interiors/scan.mjs > /tmp/b.json && node tools/interiors/pick.mjs /tmp/b.json
import fs from 'node:fs';
import { inflate, decode } from '../../src/data.js';
import { Network } from '../../src/network.js';
const W = new URL('../../www/world/', import.meta.url).pathname;
const B = JSON.parse(fs.readFileSync(process.argv[2]));
const man = JSON.parse(fs.readFileSync(W + 'manifest.json'));
const net = new Network(decode(await inflate(fs.readFileSync(W + 'network.bin'))));

// ------------------------------------------------------------------ roads near a point (drive roads, 64 m grid)
const grid = new Map(), G = 64;
for (let e = 0; e < net.nEdges; e++) {
  if (net.walkCls.has(net.cls[e]) || /service|track|busway/.test(net.classes[net.cls[e]])) continue;
  const s = net.pstart[e], n = net.pcount[e];
  for (let i = 0; i + 1 < n; i++) {
    const ax = net.pts[(s + i) * 3], az = net.pts[(s + i) * 3 + 2], bx = net.pts[(s + i + 1) * 3], bz = net.pts[(s + i + 1) * 3 + 2];
    for (let cx = Math.floor(Math.min(ax, bx) / G); cx <= Math.floor(Math.max(ax, bx) / G); cx++) for (let cz = Math.floor(Math.min(az, bz) / G); cz <= Math.floor(Math.max(az, bz) / G); cz++) {
      const k = cx * 65536 + cz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([e, ax, az, bx, bz]);
    }
  }
}
function nearestRoad(x, z, r = 60) {
  let best = null;
  for (let cx = Math.floor((x - r) / G); cx <= Math.floor((x + r) / G); cx++) for (let cz = Math.floor((z - r) / G); cz <= Math.floor((z + r) / G); cz++) for (const [e, ax, az, bx, bz] of grid.get(cx * 65536 + cz) || []) {
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; let t = ((x - ax) * vx + (z - az) * vz) / L2; t = Math.max(0, Math.min(1, t));
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { d, e, px, pz, cls: net.classes[net.cls[e]], name: net.names[net.name[e]] || net.names[net.ref[e]] || '' };
  }
  return best;
}
const inRing = (R, x, z) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const centroid = b => [b.ring.reduce((a, p) => a + p[0], 0) / b.ring.length, b.ring.reduce((a, p) => a + p[1], 0) / b.ring.length];
const district = (x, z) => { let b = null, bd = 1e9; for (const d of man.districts) { const dd = Math.hypot(d.x - x, d.z - z) / (d.kind === 'district' ? 1.6 : d.kind === 'suburb' ? 1.2 : 1); if (dd < bd) { bd = dd; b = d; } } return b; };
// neighbours sharing a wall: other footprints within 0.6 m of this one's edges (terraces and semis)
const bgrid = new Map();
for (const b of B) { const [x, z] = centroid(b); const k = Math.floor(x / 32) * 65536 + Math.floor(z / 32); let l = bgrid.get(k); if (!l) bgrid.set(k, l = []); l.push(b); b.c = [x, z]; }
function neighbours(b, gap = 0.6) {
  let n = 0; const [x, z] = b.c;
  for (let cx = Math.floor(x / 32) - 1; cx <= Math.floor(x / 32) + 1; cx++) for (let cz = Math.floor(z / 32) - 1; cz <= Math.floor(z / 32) + 1; cz++) for (const o of bgrid.get(cx * 65536 + cz) || []) {
    if (o === b || o.cls > 2) continue;
    if (o.ring.some(([px, pz]) => { for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) { const [ax, az] = b.ring[j], [bx, bz] = b.ring[i]; const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; let t = ((px - ax) * vx + (pz - az) * vz) / L2; t = Math.max(0, Math.min(1, t)); if (Math.hypot(ax + vx * t - px, az + vz * t - pz) < gap) return true; } return false; })) n++;
  }
  return n;
}

// ------------------------------------------------------------------ the interior frame: front wall to the street
function frame(b, inset = 0.3) {
  if (!b.ins) return null;
  const c = Math.cos(b.ang), s = Math.sin(b.ang);
  let [u0, u1, v0, v1] = b.ins; u0 += inset; u1 -= inset; v0 += inset; v1 -= inset;
  const toW = (u, v) => [u * c - v * s, u * s + v * c];
  const [cx, cz] = toW((u0 + u1) / 2, (v0 + v1) / 2);
  const road = nearestRoad(cx, cz, 90); if (!road) return null;
  // which side faces the road: compare the road direction in the local frame
  const dx = road.px - cx, dz = road.pz - cz, lu = dx * c + dz * s, lv = -dx * s + dz * c;
  const side = Math.abs(lu) > Math.abs(lv) ? (lu > 0 ? 'u1' : 'u0') : (lv > 0 ? 'v1' : 'v0');
  // corners in world coords; origin = front-left as seen from the street looking in; ax along the front, ay inward
  let o, ax, ay, Wd, D;
  const U = [c, s], V = [-s, c];
  if (side === 'v0') { o = toW(u1, v0); ax = [-U[0], -U[1]]; ay = V; Wd = u1 - u0; D = v1 - v0; }
  else if (side === 'v1') { o = toW(u0, v1); ax = U; ay = [-V[0], -V[1]]; Wd = u1 - u0; D = v1 - v0; }
  else if (side === 'u0') { o = toW(u0, v0); ax = V; ay = U; Wd = v1 - v0; D = u1 - u0; }
  else { o = toW(u1, v1); ax = [-V[0], -V[1]]; ay = [-U[0], -U[1]]; Wd = v1 - v0; D = u1 - u0; }
  // keep the frame right-handed (x along the front, up, y inwards) so the interior isn't drawn inside out
  if (ax[0] * ay[1] - ax[1] * ay[0] < 0) { o = [o[0] + ax[0] * Wd, o[1] + ax[1] * Wd]; ax = [-ax[0], -ax[1]]; }
  return { o, ax, ay, W: Wd, D, road };
}
// the front door outside: from the middle of the front wall (or at doorX) out through the footprint's edge
function doorOutside(b, f, doorX) {
  const px = f.o[0] + f.ax[0] * doorX, pz = f.o[1] + f.ax[1] * doorX;
  let d = 0; while (d < 12 && inRing(b.ring, px - f.ay[0] * d, pz - f.ay[1] * d)) d += 0.1;
  return { x: +(px - f.ay[0] * (d + 0.7)).toFixed(2), z: +(pz - f.ay[1] * (d + 0.7)).toFixed(2), wall: +d.toFixed(2), heading: +Math.atan2(f.ay[1], f.ay[0]).toFixed(4) };
}

// ------------------------------------------------------------------ candidates per kind
const sq = (b, f) => f && f.W > 0 && f.D > 0;
const fill = b => b.ins ? (b.ins[1] - b.ins[0]) * (b.ins[3] - b.ins[2]) / b.area : 0;
const KINDS = {
  terrace: b => (b.cls === 2 || (b.cls === 1 && neighbours(b) >= 2)) && b.lv >= 2 && b.wall >= 4.2 && b.area >= 35 && b.area <= 110 && fill(b) > 0.72,
  semi: b => b.cls === 1 && b.lv === 2 && b.wall >= 4.2 && b.area >= 45 && b.area <= 120 && fill(b) > 0.75 && neighbours(b) === 1,
  detached: b => b.cls === 1 && b.lv === 2 && b.wall >= 4.4 && b.area >= 85 && b.area <= 230 && fill(b) > 0.7 && neighbours(b, 1.5) === 0,
  bungalow: b => b.cls === 1 && b.lv === 1 && b.wall >= 2.3 && b.wall <= 3.6 && b.area >= 60 && b.area <= 170 && fill(b) > 0.72 && neighbours(b, 1.5) === 0,
  cottage: b => b.cls === 1 && b.lv === 2 && b.wall >= 3.8 && b.area >= 50 && b.area <= 130 && fill(b) > 0.7,
  warehouse: b => b.cls === 8 && b.area >= 700 && b.area <= 6000 && b.wall >= 5 && fill(b) > 0.7 && !b.lm && !/data cent|substation|depot|power/i.test(b.name),
  office: b => b.cls === 6 && b.area >= 350 && b.area <= 3500 && b.wall >= 6 && fill(b) > 0.65 && !b.lm && (!b.name || /house|court|centre|park|plaza|point|office|ltd|limited|group|tower|building|place|lodge|works/i.test(b.name)) && !/school|church|hospital|station|library|surgery|hall|police|fire|theatre|leisure|sports|community|health|medical|saint|st\.? |pub|inn|arms/i.test(b.name),
  shop: b => (b.cls === 7 || b.shop) && b.area >= 60 && b.area <= 600 && fill(b) > 0.7 && !b.lm && (!b.name || /londis|co-?op|spar|nisa|one stop|premier|budgens|costcutter|best-one|mace|stores|news|convenience|express|local|supermarket|market|shop/i.test(b.name)) && !/station|church|mcdonald|kfc|burger|subway|costa|starbucks|greggs|pizza|domino|nando|caf|restaurant|bar\b|pharmacy|boots|bank|barber|salon|hair|nails|dental|vets?\b/i.test(b.name),
  pub: b => /\b(Arms|Inn|Tavern|Head|Horse|Lion|Bell|Crown|Swan|Plough|Oak|Bull|Fox|George|Castle|Anchor|Chequers|Ship|Bear|Rose|Hare|Hound|Harrow|Wheatsheaf)\b/.test(b.name) && !/hotel|court|house|road|centre|decorat|ltd|garage|motor|lodge|farm|close|cottage/i.test(b.name) && b.area >= 80 && b.area <= 900 && fill(b) > 0.6 && !b.lm,
  church: b => b.cls === 9 && b.area >= 150 && b.area <= 1400 && fill(b) > 0.55 && !b.lm && /church|chapel|\bst\.? |saint|methodist|baptist|united reformed|our lady|holy|christ|all saints|trinity/i.test(b.name),
};
const WANT = { terrace: 6, semi: 6, detached: 6, bungalow: 6, cottage: 3, warehouse: 6, office: 6, shop: 6, pub: 2, church: 2 };
const VILLAGE = new Set(['v', 'h']);
const sites = [], usedB = new Set(), usedD = new Map();
function add(kind, b, f, extra = {}) {
  const d = district(...b.c); usedB.add(b.key + ':' + b.bi); usedD.set(d.name, (usedD.get(d.name) || 0) + 1);
  const lv = kind === 'bungalow' || ['warehouse', 'shop', 'pub', 'church', 'mall'].includes(kind) ? 1 : kind === 'office' ? Math.min(2, b.lv) : 2;
  const floorH = lv === 1 ? Math.max(2.6, Math.min(kind === 'warehouse' ? 10 : kind === 'church' ? 9 : kind === 'mall' ? 9 : 4.2, b.wall - 0.3)) : Math.max(2.55, Math.min(3.1, b.wall / Math.max(2, b.lv)));
  // the door: houses on the stair side of the front, the rest in the middle
  // (two-storey houses: the hall's passage beside the stairs, 1.375 m in on narrow houses, central on wide ones)
  const house2 = ['terrace', 'semi', 'trap', 'detached', 'cottage', 'nice'].includes(kind);
  const doorX = extra.doorX ?? (house2 && f.W < 8.5 ? 1.375 : f.W / 2);
  const door = doorOutside(b, f, doorX);
  sites.push({ id: sites.length + 1, kind, name: extra.name || '', street: f.road.name, district: d.name, bkey: b.key, bi: b.bi,
    base: b.base, wall: b.wall, lv, floorH: +floorH.toFixed(2), o: f.o.map(v => +v.toFixed(2)), ax: f.ax.map(v => +v.toFixed(5)), ay: f.ay.map(v => +v.toFixed(5)),
    W: +f.W.toFixed(2), D: +f.D.toFixed(2), doorX: +doorX.toFixed(2), door, seed: (b.bi * 7919 + parseInt(b.key.replace(/[^0-9]/g, '')) * 104729) % 2147483647 });
}
// 1. the trap house on Drovers Way, Woodley: a two-storey semi facing the street (ex-council)
const drovers = B.filter(b => b.cls === 1 && b.lv === 2 && b.wall >= 4.2 && b.area >= 45 && b.area <= 90 && fill(b) > 0.75 && Math.hypot(b.c[0] + 2700, b.c[1] + 1300) < 450)
  .map(b => ({ b, f: frame(b) })).filter(({ f }) => f && f.road.name === 'Drovers Way' && f.road.d < 25 && f.W >= 5.6 && f.D >= 6)
  .sort((a, b) => (Math.abs(a.f.W * a.f.D - 48)) - (Math.abs(b.f.W * b.f.D - 48)));
if (!drovers.length) throw Error('no house on Drovers Way');
add('trap', drovers[0].b, drovers[0].f, { name: 'Trap house' });
// 2. a nicer house in a nicer part of Woodley: a big detached house on a quiet road, away from the main roads
const Wd = man.districts.find(d => d.name === 'Woodley');
const nice = B.filter(b => b.cls === 1 && b.lv === 2 && b.wall >= 5 && b.area >= 110 && b.area <= 260 && fill(b) > 0.72 && district(...b.c).name === 'Woodley' && neighbours(b, 3) === 0)
  .map(b => ({ b, f: frame(b) })).filter(({ f }) => f && /residential|living_street/.test(f.road.cls) && f.road.d < 30 && f.W >= 8.5 && f.W <= 15 && f.D >= 8 && f.D <= 14)
  .sort((a, b) => b.b.area - a.b.area);
add('nice', nice[0].b, nice[0].f, { name: 'The nicer house' });
// 3. The Oracle, Reading
const oracle = B.find(b => b.name === 'The Oracle');
{ const f = frame(oracle, 1.5);
  // one long concourse, centred on the front, capped to a size that streams well
  const W0 = f.W; f.W = Math.min(f.W, 120); f.D = Math.min(f.D, 44); f.o = [f.o[0] + f.ax[0] * (W0 - f.W) / 2, f.o[1] + f.ax[1] * (W0 - f.W) / 2];
  add('mall', oracle, f, { name: 'The Oracle', doorX: f.W / 2 }); }
// 4. the rest, spread over the map: each kind takes the best candidates from districts it hasn't used yet
const pool = {};
for (const [k, test] of Object.entries(KINDS)) {
  pool[k] = [];
  for (const b of B) {
    if (usedB.has(b.key + ':' + b.bi) || !test(b)) continue;
    const d = district(...b.c);
    if (k === 'cottage' && !VILLAGE.has(d.kind[0])) continue;
    if ((k === 'terrace' || k === 'semi') && VILLAGE.has(d.kind[0]) && Math.random() < 0) continue;
    pool[k].push(b);
  }
}
let rnd = 12345; const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
for (const [k, n] of Object.entries(WANT)) {
  const byD = new Map();
  for (const b of pool[k]) { const d = district(...b.c).name; if (!byD.has(d)) byD.set(d, []); byD.get(d).push(b); }
  let got = 0, guard = 0;
  while (got < n && guard++ < 400) {
    // the district this kind has used least, then the map's least used overall, then at random
    const ds = [...byD.keys()].filter(d => byD.get(d).length).sort((a, b) => (sites.filter(s => s.kind === k && s.district === a).length - sites.filter(s => s.kind === k && s.district === b).length) || ((usedD.get(a) || 0) - (usedD.get(b) || 0)) || (rand() - 0.5));
    if (!ds.length) break;
    const list = byD.get(ds[0]), b = list.splice(Math.floor(rand() * list.length), 1)[0];
    if (usedB.has(b.key + ':' + b.bi)) continue;
    const f = frame(b, k === 'warehouse' || k === 'office' ? 0.5 : 0.3);
    if (!f || f.road.d > (k === 'warehouse' ? 80 : 40)) continue;
    const minW = { terrace: 4.2, semi: 5, detached: 7, bungalow: 6.5, cottage: 5, warehouse: 18, office: 12, shop: 5.5, pub: 8, church: 8 }[k];
    const minD = { terrace: 6.5, semi: 6, detached: 7, bungalow: 6.5, cottage: 5.5, warehouse: 18, office: 10, shop: 6, pub: 7, church: 12 }[k];
    if (f.W < minW || f.D < minD) continue;
    // the big ones: keep the interior a sensible size
    if (k === 'warehouse') { f.W = Math.min(f.W, 70); f.D = Math.min(f.D, 60); }
    if (k === 'office') { f.W = Math.min(f.W, 40); f.D = Math.min(f.D, 28); }
    add(k, b, f, { name: b.name && !/^\d/.test(b.name) ? b.name : '' });
    got++;
  }
  console.error(k, got, 'from', pool[k].length);
}
// ------------------------------------------------------------------ fast food: the real places on the map
// names from the tiles' building names and point signs (the sign carries its building's index)
import zlibM from 'node:zlib';
const { decode: decodeC } = await import('../../src/data.js');
const signs = [];
for (const key of man.tiles.map(t => typeof t === 'string' ? t : t.key)) {
  const raw = zlibM.inflateSync(fs.readFileSync(W + 'tiles/' + key + '.bin'));
  const { header: h, arrays: A } = decodeC(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const [ti, tj] = key.split('_').map(Number);
  if (h.sn && A.sg) for (let i = 0; i < h.sn.length; i++) if (h.sn[i]) signs.push({ name: h.sn[i], key, bi: A.sg[i * 7 + 5] | 0, x: A.sg[i * 7] + ti * 256, z: A.sg[i * 7 + 2] + tj * 256 });
}
const FOOD = [
  [/^mcdonald/i, 'burger', 10], [/^burger king/i, 'burger', 10], [/^kfc$/i, 'chicken', 10], [/^popeyes/i, 'chicken', 9], [/^wendy/i, 'burger', 9], [/^five guys/i, 'burger', 8],
  [/^taco bell/i, 'mex', 8], [/gourmet burger/i, 'burger', 6], [/^nando/i, 'piri', 7], [/^subway$/i, 'sub', 6], [/^greggs$/i, 'bakery', 6],
  [/chicken/i, 'chicken', 5], [/fish|chips/i, 'chippy', 5], [/kebab/i, 'kebab', 5], [/^domino|^pizza hut/i, 'pizza', 4], [/pizza/i, 'pizza', 3], [/^tortilla$/i, 'mex', 4],
];
const foodOf = n => { for (const [re, cat, pri] of FOOD) if (re.test(n)) return { cat, pri }; return null; };
const byKey = new Map(B.map(b => [b.key + ':' + b.bi, b]));
const cand = [];
for (const b of B) if (b.name) { const f = foodOf(b.name); if (f) cand.push({ name: b.name, b, ...f }); }
for (const sg of signs) { const f = foodOf(sg.name); if (!f) continue; const b = byKey.get(sg.key + ':' + sg.bi); if (b) cand.push({ name: sg.name, b, sx: sg.x, sz: sg.z, ...f }); }
cand.sort((a, b) => b.pri - a.pri || a.name.localeCompare(b.name));
const food = [], CHAIN_GAP = 450;
const chainOf = n => n.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
// (a mix: no more than a few of any one chain or kind of food)
const CHAIN_CAP = { mcdonald: 4, burgerki: 2, kfc: 3, nandos: 1, greggs: 2, subway: 2, wendys: 1, popeyes: 1 }, CAT_CAP = { burger: 7, chicken: 6, piri: 1, sub: 2, bakery: 2, chippy: 2, kebab: 2, pizza: 2, mex: 1 };
for (const c of cand) {
  if (food.length >= 25) break;
  if (food.filter(o => chainOf(o.name) === chainOf(c.name)).length >= (CHAIN_CAP[chainOf(c.name)] ?? 2)) continue;
  if (food.filter(o => o.cat === c.cat).length >= (CAT_CAP[c.cat] ?? 2)) continue;
  const k = c.b.key + ':' + c.b.bi;
  if (usedB.has(k) && !c.b.multi) continue;
  if (c.b.area > 6000 || c.b.lm || /oracle|broad street mall/i.test(c.b.name || '')) continue;      // a unit in a shopping centre: no
  // (the same chain twice close together: the second stays shut; so does a third of one category in a district)
  const [cx, cz] = c.b.c;
  if (food.some(o => chainOf(o.name) === chainOf(c.name) && Math.hypot(o.x - cx, o.z - cz) < CHAIN_GAP)) continue;
  const d = district(cx, cz).name;
  if (food.filter(o => o.cat === c.cat && o.district === d).length >= (c.pri >= 8 ? 3 : 1)) continue;
  const f = frame(c.b, 0.3); if (!f || f.road.d > 60 || f.W < 5.2 || f.D < 7) continue;
  // a parade of shops: just this unit, around its sign along the front (or the middle), up to 11 m wide
  if (f.W > 13 || c.b.area > 400) {
    const sx = c.sx ?? f.o[0] + f.ax[0] * f.W / 2, sz = c.sz ?? f.o[1] + f.ax[1] * f.W / 2;
    const along = (sx - f.o[0]) * f.ax[0] + (sz - f.o[1]) * f.ax[1];
    const w = Math.min(f.W, c.pri >= 8 ? 14 : 10), u0 = Math.max(0, Math.min(f.W - w, along - w / 2));
    f.o = [f.o[0] + f.ax[0] * u0, f.o[1] + f.ax[1] * u0]; f.W = w; f.D = Math.min(f.D, c.pri >= 8 ? 20 : 15);
    c.b.multi = true;
  }
  f.D = Math.min(f.D, 22);
  add('food', c.b, f, { name: c.name, doorX: f.W / 2 });
  const site = sites[sites.length - 1]; site.food = c.cat; site.lv = 1; site.floorH = +Math.max(2.8, Math.min(3.6, c.b.wall - 0.3)).toFixed(2);
  food.push({ name: c.name, cat: c.cat, x: cx, z: cz, district: site.district });
}
console.error('food', food.length, food.map(f => f.name + ' (' + f.district + ')').join('; '));

// ------------------------------------------------------------------ petrol stations: the forecourt canopy and its shop
const FUELNAME = /fuel station|\bbp\b|bp shop|^shell$|^esso|petrol|filling|asda express|asda on the move|tesco express|m&s simply food|wild bean|^tesco$|morrisons/i;
const fuel = [];
const roofs = B.filter(r => r.cls === 13 && r.area >= 140 && r.area <= 1000);
for (const r of roofs) {
  const [x, z] = r.c;
  const shopB = B.filter(b => b !== r && b.cls !== 13 && b.name && FUELNAME.test(b.name) && Math.hypot(b.c[0] - x, b.c[1] - z) < 60).sort((a, b) => Math.hypot(a.c[0] - x, a.c[1] - z) - Math.hypot(b.c[0] - x, b.c[1] - z))[0];
  if (!shopB) continue;
  // a big supermarket with a canopy by the door isn't a forecourt: its fuel needs a petrol-ish name or a small shop
  if (shopB.area > 1500 && !/fuel|petrol/i.test(shopB.name)) { if (!/morrisons/i.test(shopB.name)) continue; }
  if (fuel.some(f => Math.hypot(f.x - x, f.z - z) < 80)) continue;
  const near = man.canopies.some(c => Math.hypot((c[0] + c[2]) / 2 - x, (c[1] + c[3]) / 2 - z) < 12);
  const o = r.obb, L = o[1] - o[0], Dp = o[3] - o[2];
  const road = nearestRoad(x, z, 120);
  const brand = /sainsbury/i.test(shopB.name) ? "Sainsbury's" : /\bbp\b|wild bean|m&s/i.test(shopB.name) ? 'BP' : /shell/i.test(shopB.name) ? 'Shell' : /esso|tesco/i.test(shopB.name) ? 'Esso' : /asda/i.test(shopB.name) ? 'Asda' : /morrisons/i.test(shopB.name) ? 'Morrisons' : 'Fuel';
  fuel.push({ id: fuel.length + 1, name: brand === 'Fuel' ? shopB.name : brand + (road?.name ? ', ' + road.name : ''), brand, shop: shopB.name, x: +x.toFixed(2), z: +z.toFixed(2),
    ang: r.ang, L: +Math.max(L, Dp).toFixed(2), D: +Math.min(L, Dp).toFixed(2), long: L >= Dp ? 'u' : 'v', draw: !near, base: r.base, district: district(x, z).name, street: road?.name || '' });
  // the station's shop: a kiosk you can go into
  if (!usedB.has(shopB.key + ':' + shopB.bi) && shopB.area < 700) {
    const f = frame(shopB, 0.3);
    if (f && f.W >= 5 && f.D >= 5) { f.W = Math.min(f.W, 16); f.D = Math.min(f.D, 14); add('shop', shopB, f, { name: shopB.name, doorX: f.W / 2 }); sites[sites.length - 1].kiosk = 1; }
  }
}
console.error('fuel', fuel.length, fuel.map(f => f.name + ' (' + f.district + ')').join('; '));
fs.writeFileSync(W + 'interiors.json', JSON.stringify({ version: 2, sites, fuel }));
console.error('sites', sites.length);
for (const s of sites) console.error(s.id, s.kind, s.name || '-', '|', s.street, '|', s.district, s.W.toFixed(1) + 'x' + s.D.toFixed(1), 'lv' + s.lv, 'fh' + s.floorH);
