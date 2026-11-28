// TechZone: the gadget, tech and accessory shop, one in every town, all the same (src/interiorPlan.js gadget(),
// src/techShop.js). Reading's is the TechZone unit in The Oracle; this picks a real shop unit on each other town's
// shopping street and appends it to www/world/interiors.json as kind 'gadget' (every earlier site keeps its id).
//   node tools/interiors/scan.mjs > /tmp/b.json && node tools/interiors/gadget.mjs /tmp/b.json
import fs from 'node:fs';
import { inflate, decode } from '../../src/data.js';
import { Network } from '../../src/network.js';
const W = new URL('../../www/world/', import.meta.url).pathname;
const B = JSON.parse(fs.readFileSync(process.argv[2]));
const man = JSON.parse(fs.readFileSync(W + 'manifest.json'));
const net = new Network(decode(await inflate(fs.readFileSync(W + 'network.bin'))));
const IN = JSON.parse(fs.readFileSync(W + 'interiors.json'));
// pub names (as pick.mjs): a pub is never turned into a shop
const PUB = /\b(Arms|Inn|Tavern|Head|Horse|Lion|Bell|Crown|Swan|Plough|Oak|Bull|Fox|George|Castle|Anchor|Chequers|Ship|Bear|Rose|Hare|Hound|Harrow|Wheatsheaf|Rising Sun|Volunteer|Red Cow|Running Horse|Dragon|Tuns|Bar|Club|Tap)\b/i;
// the towns: their shopping streets (where to look first), as found on the map
const TOWNS = [
  { town: 'Caversham', x: -7631, z: -3848, streets: /church street|prospect street|bridge street|church road/i },
  { town: 'Earley', x: -4749, z: -1096, streets: /wokingham road|london road|culver lane|silverdale road|maiden/i },
  { town: 'Lower Earley', x: -3473, z: 554, streets: /chalfont|lower earley way|rushey way|beighton|kilnsea|maiden place/i, far: 1100, big: 3000, road: 70 },
  { town: 'Woodley', x: -2869, z: -2192, streets: /crockhamwell|headley road|loddon vale|reading road/i },
  { town: 'Winnersh', x: -766, z: 179, streets: /reading road|king street lane|robin hood lane/i },
  { town: 'Wokingham', x: 2051, z: 2361, streets: /peach street|broad street|market place|denmark street|rose street|the terrace/i },
  { town: 'Bracknell', x: 7990, z: 1707, streets: /high street|charles square|braccan walk|broadway|market street|crossway/i },
  { town: 'Twyford', x: -70, z: -5151, streets: /london road|high street|church street|station road/i },
];

// ------------------------------------------------------------------ helpers (as tools/interiors/pick.mjs)
const grid = new Map(), GS = 64;
for (let e = 0; e < net.nEdges; e++) {
  if (net.walkCls.has(net.cls[e]) || /service|track|busway/.test(net.classes[net.cls[e]])) continue;
  const s = net.pstart[e], n = net.pcount[e];
  for (let i = 0; i + 1 < n; i++) {
    const ax = net.pts[(s + i) * 3], az = net.pts[(s + i) * 3 + 2], bx = net.pts[(s + i + 1) * 3], bz = net.pts[(s + i + 1) * 3 + 2];
    for (let cx = Math.floor(Math.min(ax, bx) / GS); cx <= Math.floor(Math.max(ax, bx) / GS); cx++) for (let cz = Math.floor(Math.min(az, bz) / GS); cz <= Math.floor(Math.max(az, bz) / GS); cz++) {
      const k = cx * 65536 + cz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([e, ax, az, bx, bz]);
    }
  }
}
function nearestRoad(x, z, r = 60) {
  let best = null;
  for (let cx = Math.floor((x - r) / GS); cx <= Math.floor((x + r) / GS); cx++) for (let cz = Math.floor((z - r) / GS); cz <= Math.floor((z + r) / GS); cz++) for (const [e, ax, az, bx, bz] of grid.get(cx * 65536 + cz) || []) {
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; let t = ((x - ax) * vx + (z - az) * vz) / L2; t = Math.max(0, Math.min(1, t));
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { d, e, px, pz, cls: net.classes[net.cls[e]], name: net.names[net.name[e]] || net.names[net.ref[e]] || '' };
  }
  return best;
}
const inRing = (R, x, z) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const centroid = b => [b.ring.reduce((a, p) => a + p[0], 0) / b.ring.length, b.ring.reduce((a, p) => a + p[1], 0) / b.ring.length];
const district = (x, z) => { let b = null, bd = 1e9; for (const d of man.districts) { const dd = Math.hypot(d.x - x, d.z - z) / (d.kind === 'district' ? 1.6 : d.kind === 'suburb' ? 1.2 : 1); if (dd < bd) { bd = dd; b = d; } } return b; };
const fill = b => b.ins ? (b.ins[1] - b.ins[0]) * (b.ins[3] - b.ins[2]) / b.area : 0;
function frame(b, inset = 0.3) {
  if (!b.ins) return null;
  const c = Math.cos(b.ang), s = Math.sin(b.ang);
  let [u0, u1, v0, v1] = b.ins; u0 += inset; u1 -= inset; v0 += inset; v1 -= inset;
  const toW = (u, v) => [u * c - v * s, u * s + v * c];
  const [cx, cz] = toW((u0 + u1) / 2, (v0 + v1) / 2);
  const road = nearestRoad(cx, cz, 90); if (!road) return null;
  const dx = road.px - cx, dz = road.pz - cz, lu = dx * c + dz * s, lv = -dx * s + dz * c;
  const side = Math.abs(lu) > Math.abs(lv) ? (lu > 0 ? 'u1' : 'u0') : (lv > 0 ? 'v1' : 'v0');
  let o, ax, ay, Wd, D;
  const U = [c, s], V = [-s, c];
  if (side === 'v0') { o = toW(u1, v0); ax = [-U[0], -U[1]]; ay = V; Wd = u1 - u0; D = v1 - v0; }
  else if (side === 'v1') { o = toW(u0, v1); ax = U; ay = [-V[0], -V[1]]; Wd = u1 - u0; D = v1 - v0; }
  else if (side === 'u0') { o = toW(u0, v0); ax = V; ay = U; Wd = v1 - v0; D = u1 - u0; }
  else { o = toW(u1, v1); ax = [-V[0], -V[1]]; ay = [-U[0], -U[1]]; Wd = v1 - v0; D = u1 - u0; }
  if (ax[0] * ay[1] - ax[1] * ay[0] < 0) { o = [o[0] + ax[0] * Wd, o[1] + ax[1] * Wd]; ax = [-ax[0], -ax[1]]; }
  return { o, ax, ay, W: Wd, D, road };
}
function doorOutside(b, f, doorX) {
  const px = f.o[0] + f.ax[0] * doorX, pz = f.o[1] + f.ax[1] * doorX;
  let d = 0; while (d < 12 && inRing(b.ring, px - f.ay[0] * d, pz - f.ay[1] * d)) d += 0.1;
  return { x: +(px - f.ay[0] * (d + 0.7)).toFixed(2), z: +(pz - f.ay[1] * (d + 0.7)).toFixed(2), wall: +d.toFixed(2), heading: +Math.atan2(f.ay[1], f.ay[0]).toFixed(4) };
}

// ------------------------------------------------------------------ one per town
const used = new Set(IN.sites.map(s => s.bkey + ':' + s.bi));
const sites = IN.sites.filter(s => s.kind !== 'gadget');
let id = Math.max(...sites.map(s => s.id)) + 1;
for (const b of B) b.c = centroid(b);
for (const T of TOWNS) {
  const cand = [];
  for (const b of B) {
    const d = Math.hypot(b.c[0] - T.x, b.c[1] - T.z); if (d > (T.far || 700)) continue;
    const why = !(b.cls === 7 || b.shop) ? 'cls' : b.lm ? 'lm' : b.area < 70 || b.area > (T.big || 700) ? 'area' : fill(b) < 0.45 ? 'fill' : used.has(b.key + ':' + b.bi) ? 'used' : null;
    if (why) { if (process.env.DBG === T.town && why !== 'cls') console.error('  reject', why, Math.round(d), Math.round(b.area), fill(b).toFixed(2), b.name); continue; }
    if (b.name && PUB.test(b.name)) continue;
    if (b.name && /church|bank|pharmacy|surgery|station|library|pub|inn|restaurant|kebab|pizza|chicken|cafe|café|bakery|hotel|school|post office/i.test(b.name)) continue;
    const f = frame(b, 0.3); if (!f || f.road.d > (T.road || 28) || f.W < 4.3 || f.D < 7.5) { if (process.env.DBG === T.town) console.error('  reject frame', Math.round(d), f && Math.round(f.road.d), f && f.W.toFixed(1), f && f.D.toFixed(1), b.name); continue; }
    const street = T.streets.test(f.road.name), main = /primary|secondary|tertiary|residential|unclassified|pedestrian/.test(f.road.cls);
    // an empty or unnamed unit rather than a real business that's on the map
    cand.push({ b, f, score: d * 0.6 - (street ? 380 : 0) - (main ? 40 : 0) + (b.name ? 900 : 0) + Math.abs(f.W - 10) * 4 + Math.abs(f.D - 14) * 2 });
  }
  cand.sort((a, b) => a.score - b.score);
  const c = cand[0];
  if (!c) { console.error('no unit found in', T.town); continue; }
  const { b, f } = c;
  // a shop unit: up to 14 m of frontage and 18 m deep (a parade's single unit around the middle of the front)
  if (f.W > 14) { const u0 = (f.W - 14) / 2; f.o = [f.o[0] + f.ax[0] * u0, f.o[1] + f.ax[1] * u0]; f.W = 14; }
  f.D = Math.min(f.D, 18);
  const doorX = f.W / 2, door = doorOutside(b, f, doorX), dd = district(...b.c);
  used.add(b.key + ':' + b.bi);
  sites.push({ id: id++, kind: 'gadget', name: 'TechZone', chain: 'TechZone', town: T.town, street: f.road.name, district: dd.name, bkey: b.key, bi: b.bi,
    base: b.base, wall: b.wall, lv: 1, floorH: +Math.max(2.8, Math.min(3.6, b.wall - 0.3)).toFixed(2), o: f.o.map(v => +v.toFixed(2)), ax: f.ax.map(v => +v.toFixed(5)), ay: f.ay.map(v => +v.toFixed(5)),
    W: +f.W.toFixed(2), D: +f.D.toFixed(2), doorX: +doorX.toFixed(2), door, seed: 7177 });
  console.error('TechZone', T.town, '|', f.road.name, '|', dd.name, f.W.toFixed(1) + 'x' + f.D.toFixed(1), 'from', Math.round(Math.hypot(b.c[0] - T.x, b.c[1] - T.z)), 'm', b.name || '');
}
fs.writeFileSync(W + 'interiors.json', JSON.stringify({ ...IN, sites }));
console.error('sites', sites.length, 'TechZone', sites.filter(s => s.kind === 'gadget').length);
