// The fish, the lakes' stocks, the tackle and the bites (pure data and maths: src/fishing.js plays it, the unit tests
// check it). Weights in pounds.
//
// The waters and what swims in them follow the fishery listings (docs/SOURCES.md):
//   South Lake, Woodley (South Lake Angling Society, season ticket): carp to 39 lb, pike 25 lb, tench 9 lb+, rudd,
//     roach, perch. The western end is closed to fishing.
//   White Swan Lake, Dinton Pastures (Wokingham Borough Council, day ticket): carp 54 lb, pike 34 lb, tench 11 lb+,
//     bream 18 lb, rudd, roach, perch. Barbless hooks.
//   Black Swan Lake, Dinton Pastures (specimen syndicate): carp 65 lb (a 64-pounder in 2024), pike 21 lb, tench
//     9 lb+, bream 15 lb, perch. Barbless hooks; two big islands.
//   Canberra Lake, Charvil (Charvil Complex syndicate): specimen carp to 40 lb+, tench 14 lb, good bream.
//   Orrell Lake, Charvil (Charvil Complex): carp 2 to 20 lb+, tench 12 lb, pike, bream, silver fish. Ten swims on
//     the west bank.
// Each lake's outline, depths, islands, lily beds and pegs come from the world tiles (tools/fishing/lakes.mjs).

// ---------------------------------------------------------------- species
// look: body shape and colours for fishModels.js. wl: weight-length (W g = a * L cm ^ b, from published fisheries
// relationships, rounded). fight: force per (kg ^ 0.75), stamina, style. mouth: how well a hook holds (1 = rubbery
// carp lips; roach have soft mouths, pike bony jaws that need a firm strike).
export const SPECIES = {
  roach: { name: 'Roach', wl: [0.0105, 3.08], fight: { force: 0.42, stamina: 0.7, style: 'small' }, mouth: 0.55, teeth: false },
  rudd: { name: 'Rudd', wl: [0.0115, 3.08], fight: { force: 0.45, stamina: 0.7, style: 'small' }, mouth: 0.6, teeth: false },
  perch: { name: 'Perch', wl: [0.0103, 3.12], fight: { force: 0.55, stamina: 0.75, style: 'jag' }, mouth: 0.8, teeth: false },
  bream: { name: 'Bream', wl: [0.0087, 3.15], fight: { force: 0.38, stamina: 0.65, style: 'slab' }, mouth: 0.75, teeth: false },
  tench: { name: 'Tench', wl: [0.0126, 3.04], fight: { force: 0.62, stamina: 1.15, style: 'dogged' }, mouth: 0.9, teeth: false },
  common: { name: 'Common carp', wl: [0.0137, 3.02], fight: { force: 0.66, stamina: 1.25, style: 'runs' }, mouth: 1.0, teeth: false },
  mirror: { name: 'Mirror carp', wl: [0.0150, 3.0], fight: { force: 0.64, stamina: 1.2, style: 'runs' }, mouth: 1.0, teeth: false },
  pike: { name: 'Pike', wl: [0.0045, 3.12], fight: { force: 0.6, stamina: 0.85, style: 'shake' }, mouth: 0.7, teeth: true },
};

// ---------------------------------------------------------------- the lakes' stocks
// share: how much of the lake's feeding activity is this species; typ / sigma: the usual weight (lb) and spread (log);
// max: the lake's best. rate: bites a minute at a lake (before bait, place, time and weather).
export const STOCK = {
  southlake: { rate: 1.0, fish: {
    roach: { share: 1.0, typ: 0.35, sigma: 0.55, max: 2.1 }, rudd: { share: 0.75, typ: 0.4, sigma: 0.5, max: 2.3 },
    perch: { share: 0.55, typ: 0.55, sigma: 0.6, max: 3.6 }, tench: { share: 0.35, typ: 4.6, sigma: 0.3, max: 9.6 },
    common: { share: 0.16, typ: 15, sigma: 0.38, max: 36.5 }, mirror: { share: 0.14, typ: 17, sigma: 0.38, max: 39.1 },
    pike: { share: 0.2, typ: 8, sigma: 0.45, max: 25.2 } } },
  whiteswan: { rate: 1.0, fish: {
    roach: { share: 0.9, typ: 0.4, sigma: 0.55, max: 2.2 }, rudd: { share: 0.6, typ: 0.45, sigma: 0.5, max: 2.4 },
    perch: { share: 0.5, typ: 0.6, sigma: 0.6, max: 3.8 }, bream: { share: 0.45, typ: 6.5, sigma: 0.38, max: 18.2 },
    tench: { share: 0.32, typ: 5.5, sigma: 0.3, max: 11.6 }, common: { share: 0.15, typ: 19, sigma: 0.4, max: 48 },
    mirror: { share: 0.14, typ: 21, sigma: 0.4, max: 54.2 }, pike: { share: 0.2, typ: 10, sigma: 0.5, max: 34.4 } } },
  blackswan: { rate: 0.55, fish: {
    perch: { share: 0.45, typ: 1.1, sigma: 0.55, max: 4.1 }, bream: { share: 0.5, typ: 8.5, sigma: 0.32, max: 15.3 },
    tench: { share: 0.3, typ: 6, sigma: 0.25, max: 9.8 }, common: { share: 0.22, typ: 30, sigma: 0.33, max: 58 },
    mirror: { share: 0.24, typ: 33, sigma: 0.33, max: 65.1 }, pike: { share: 0.2, typ: 9, sigma: 0.4, max: 21.2 } } },
  canberra: { rate: 0.7, fish: {
    bream: { share: 0.5, typ: 7.5, sigma: 0.3, max: 12.8 }, tench: { share: 0.55, typ: 7.5, sigma: 0.28, max: 14.1 },
    common: { share: 0.3, typ: 21, sigma: 0.32, max: 38 }, mirror: { share: 0.3, typ: 23, sigma: 0.32, max: 40.6 } } },
  orrell: { rate: 1.1, fish: {
    roach: { share: 1.0, typ: 0.35, sigma: 0.5, max: 1.8 }, rudd: { share: 0.6, typ: 0.4, sigma: 0.5, max: 2.0 },
    perch: { share: 0.45, typ: 0.5, sigma: 0.55, max: 2.8 }, bream: { share: 0.35, typ: 3.5, sigma: 0.4, max: 9.2 },
    tench: { share: 0.35, typ: 4.5, sigma: 0.35, max: 12.2 }, common: { share: 0.3, typ: 7.5, sigma: 0.55, max: 21.4 },
    mirror: { share: 0.22, typ: 8.5, sigma: 0.5, max: 20.6 }, pike: { share: 0.12, typ: 6, sigma: 0.45, max: 18 } } },
};

// tickets: what each water needs, what it costs, and its rules
export const WATERS = {
  southlake: { club: 'South Lake Angling Society', ticket: 'season', price: 85, label: 'Season ticket', rules: ['The western end is closed to fishing', 'Landing net and unhooking mat for carp and pike'], barbless: false, mat: true },
  whiteswan: { club: 'Wokingham Borough Council', ticket: 'day', price: 10, label: 'Day ticket (car park machine)', rules: ['Barbless hooks only', 'Day fishing'], barbless: true, mat: false },
  blackswan: { club: 'Black Swan specimen syndicate', ticket: 'season', price: 450, label: 'Syndicate membership', rules: ['Barbless hooks only', 'Landing net and unhooking mat required'], barbless: true, mat: true, needs: ['net', 'mat'] },
  canberra: { club: 'Charvil Complex', ticket: 'season', price: 300, label: 'Charvil Complex syndicate (Canberra and Orrell)', rules: ['Landing net and unhooking mat required'], barbless: false, mat: true, needs: ['net', 'mat'], shares: 'charvil' },
  orrell: { club: 'Charvil Complex', ticket: 'season', price: 300, label: 'Charvil Complex syndicate (Canberra and Orrell)', rules: ['Ten swims along the west bank'], barbless: false, mat: false, shares: 'charvil' },
};

// ---------------------------------------------------------------- tackle
// The three rods (TechZone sells them rigged and ready). line: breaking strain (lb); stretch at the break (share of
// the line out); tc: test curve (lb: the pull that bends the tip round to a right angle); cast: launch speed (m/s) at
// full power and the rig's drag; reel: line wound in per second at full speed; drag: the clutch's range (lb): it
// screws down past the line's strength, so a locked-up clutch on a big fish snaps you.
export const RODS = {
  float: { name: 'Float rod', length: 3.9, line: 4, stretch: 0.22, tc: 1.1, cast: { v: 21, drag: 0.055, splash: 'plop' }, reel: 1.05, drag: [0.3, 4.8], rig: ['hooks', 'floats'], methods: ['float'] },
  carp: { name: 'Carp rod', length: 3.66, line: 12, stretch: 0.2, tc: 3, cast: { v: 34, drag: 0.0042, splash: 'lead' }, reel: 1.25, drag: [1, 14], rig: ['hairrigs', 'leads'], methods: ['ledger'] },
  lure: { name: 'Lure rod', length: 2.2, line: 20, stretch: 0.04, tc: 2.2, cast: { v: 27, drag: 0.012, splash: 'plop' }, reel: 1.15, drag: [1, 24], rig: ['lure'], methods: ['lure'] },
};
// baits (hookbaits in a pack) and which method they go on
export const BAITS = {
  maggots: { name: 'Maggots', methods: ['float'], stay: 0.75, feed: 6 },
  corn: { name: 'Sweetcorn', methods: ['float', 'ledger'], stay: 0.85, feed: 6 },
  bread: { name: 'Bread', methods: ['float'], stay: 0.45, feed: 3 },
  worms: { name: 'Worms', methods: ['float', 'ledger'], stay: 0.8, feed: 0 },
  boilies: { name: 'Boilies', methods: ['ledger'], stay: 0.95, feed: 8 },
  spinner: { name: 'Spinner', methods: ['lure'], lure: true },
  shad: { name: 'Soft shad', methods: ['lure'], lure: true },
};
// how much each species wants each bait (0..1)
const PREF = {
  roach: { maggots: 1, bread: 0.9, corn: 0.5, worms: 0.35, boilies: 0.02, spinner: 0, shad: 0 },
  rudd: { maggots: 0.9, bread: 1, corn: 0.7, worms: 0.25, boilies: 0.02, spinner: 0.02, shad: 0 },
  perch: { maggots: 0.7, bread: 0.05, corn: 0.1, worms: 1, boilies: 0, spinner: 0.8, shad: 0.75 },
  bream: { maggots: 0.8, bread: 0.6, corn: 0.7, worms: 0.9, boilies: 0.5, spinner: 0, shad: 0 },
  tench: { maggots: 0.7, bread: 0.4, corn: 1, worms: 0.9, boilies: 0.35, spinner: 0, shad: 0 },
  common: { maggots: 0.25, bread: 0.5, corn: 0.8, worms: 0.3, boilies: 1, spinner: 0, shad: 0 },
  mirror: { maggots: 0.25, bread: 0.5, corn: 0.8, worms: 0.3, boilies: 1, spinner: 0, shad: 0 },
  pike: { maggots: 0.01, bread: 0, corn: 0, worms: 0.04, boilies: 0, spinner: 0.8, shad: 1 },
};
export const pref = (s, bait) => PREF[s]?.[bait] ?? 0;

// ---------------------------------------------------------------- weights and lengths
export const lbOz = lb => { let p = Math.floor(lb), o = Math.round((lb - p) * 16); if (o === 16) { p++; o = 0; } return p ? `${p} lb ${o} oz` : `${o} oz`; };
export const lengthCm = (s, lb) => { const [a, b] = SPECIES[s].wl; return Math.pow(lb * 453.6 / a, 1 / b); };
// a fish's weight: log-normal round the lake's usual size, the big bait shifting the odds towards bigger fish, and
// never over the lake's best
export function drawWeight(stock, rnd = Math.random, bigBait = false) {
  const g = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const w = stock.typ * (bigBait ? 1.12 : 1) * Math.exp(g * stock.sigma);
  return Math.max(stock.typ * 0.22, Math.min(stock.max, w));
}

// ---------------------------------------------------------------- the lake: depth and features at a point
export class Lake {
  constructor(d) {
    Object.assign(this, d);
    const bin = typeof atob === 'function' ? atob(d.depth) : Buffer.from(d.depth, 'base64').toString('binary');
    this.D = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) this.D[i] = bin.charCodeAt(i);
  }
  // depth (m) at a point, or -1 on land
  depthAt(x, z) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((z - this.z0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    const v = this.D[j * this.nx + i]; return v === 255 ? -1 : v / 10;
  }
  wet(x, z) { return this.depthAt(x, z) >= 0; }
  // distance to the nearest bank or island along a few rays (good enough for the bite model and the fish's runs)
  shore(x, z, max = 24) {
    let best = max;
    for (let a = 0; a < 8; a++) { const c = Math.cos(a * Math.PI / 4), s = Math.sin(a * Math.PI / 4); for (let d = 1; d < best; d += 1) if (!this.wet(x + c * d, z + s * d)) { best = d; break; } }
    return best;
  }
  // the features near a point: lily beds and islands (with how close), each a snag a hooked fish can make for
  features(x, z) {
    let lily = 1e9, island = 1e9;
    for (const l of this.lilies) lily = Math.min(lily, Math.hypot(x - l.x, z - l.z) - l.r);
    for (const i of this.islands) island = Math.min(island, Math.hypot(x - i.x, z - i.z) - i.r);
    return { lily, island };
  }
  peg(n) { return this.pegs.find(p => p.n === n); }
  nearestPeg(x, z) { let b = null, bd = 1e9; for (const p of this.pegs) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; b = p; } } return b ? { peg: b, d: bd } : null; }
}

// ---------------------------------------------------------------- the bite model
// How keen each species is at a spot, for a bait, at a time of day, in this weather, with the swim fed and
// disturbed as it is. Returns [{ s, rate }] (bites a minute) for the species that would take.
export function biteRates(lakeId, lake, spot, ctx) {
  const st = STOCK[lakeId]; if (!st) return [];
  const { bait, method, hour = 12, cover = 0.5, wind = 3, feed = 0, disturb = 0, moving = false } = ctx;
  const depth = Math.max(0.2, lake.depthAt(spot.x, spot.z)), shore = lake.shore(spot.x, spot.z), F = lake.features(spot.x, spot.z);
  const nearLily = F.lily < 6 ? 1 - Math.max(0, F.lily) / 6 : 0, nearIsland = F.island < 14 ? 1 - Math.max(0, F.island) / 14 : 0, margin = shore < 7 ? 1 - shore / 7 : 0;
  const dawn = Math.exp(-((hour - 6) ** 2) / 4), dusk = Math.exp(-((hour - 20.5) ** 2) / 4), night = hour < 4.5 || hour > 22.5 ? 1 : 0, midday = Math.exp(-((hour - 13.5) ** 2) / 6);
  const dull = 0.8 + 0.4 * cover + Math.min(0.2, wind * 0.03);
  const out = [];
  for (const [s, f] of Object.entries(st.fish)) {
    let k = pref(s, bait); if (k <= 0) continue;
    // where it likes to be
    let place = 1;
    if (s === 'roach') place = 0.7 + 0.5 * Math.min(1, depth / 2) + 0.2 * (1 - margin);
    else if (s === 'rudd') place = 0.5 + 1.2 * nearLily + 0.6 * margin + (depth < 1.6 ? 0.4 : 0);
    else if (s === 'perch') place = 0.5 + 0.9 * nearLily + 0.8 * nearIsland + 0.6 * margin;
    else if (s === 'bream') place = 0.4 + 1.1 * Math.min(1, depth / 3) * (1 - margin * 0.7);
    else if (s === 'tench') place = 0.5 + 1.2 * nearLily + 0.9 * margin;
    else if (s === 'common' || s === 'mirror') place = 0.6 + 1.1 * nearIsland + 0.5 * margin * (dusk + night) + 0.25 * Math.min(1, depth / 2.5);
    else if (s === 'pike') place = 0.5 + 0.9 * nearLily + 0.6 * margin + 0.5 * nearIsland;
    // when it feeds
    let when = 0.65 + 0.5 * dawn + 0.5 * dusk;
    if (s === 'common' || s === 'mirror') when = 0.55 + 0.5 * dawn + 0.7 * dusk + 0.6 * night;
    else if (s === 'tench') when = 0.45 + 1.1 * dawn + 0.5 * dusk;
    else if (s === 'rudd' || s === 'roach') when = 0.7 + 0.35 * midday + 0.3 * dusk - 0.4 * night;
    else if (s === 'pike' || s === 'perch') when = 0.75 + 0.5 * dawn + 0.3 * dusk - 0.5 * night;
    // a lure has to be moving; a static bait on the bottom is what everything else wants
    const how = method === 'lure' ? (moving ? 1 : 0.05) : (moving ? 0.25 : 1);
    // loose feed draws fish in (not pike), a recent splash puts them off for a while
    const fed = s === 'pike' ? 1 + 0.4 * Math.min(1, feed) : 1 + 1.6 * Math.min(1.4, feed);
    const r = st.rate * f.share * k * Math.max(0.1, place) * Math.max(0.1, when) * dull * how * fed * (1 - 0.75 * Math.min(1, disturb));
    if (r > 0) out.push({ s, rate: r * 0.85 });
  }
  return out;
}
// pick the species (by rate) and its weight for a bite
export function drawBite(lakeId, rates, bait, rnd = Math.random) {
  const tot = rates.reduce((a, r) => a + r.rate, 0); if (!tot) return null;
  let u = rnd() * tot, s = rates[0].s;
  for (const r of rates) { u -= r.rate; if (u <= 0) { s = r.s; break; } }
  const stock = STOCK[lakeId].fish[s];
  return { s, lb: drawWeight(stock, rnd, bait === 'boilies' || bait === 'shad'), record: stock.max };
}
// how the bite shows, and how long you have to strike (seconds after the take starts): float bites dip and then
// go (roach and rudd fast, tench lift it then slide away, carp sail off), a carp on the bolt rig runs and the alarm
// screams, a lure is a thump
export function biteShape(s, method, rnd = Math.random) {
  if (method === 'ledger') {
    const carp = s === 'common' || s === 'mirror';
    return { bleeps: 1 + Math.floor(rnd() * (carp ? 3 : 5)), lead: 1.2 + rnd() * 5, window: carp ? 9 : 3.2, run: carp, self: carp ? 0.75 : 0.25 };
  }
  if (method === 'lure') return { bleeps: 0, lead: 0, window: s === 'pike' ? 0.75 : 0.55, run: false, self: s === 'pike' ? 0.35 : 0.15 };
  const W = { roach: 0.55, rudd: 0.6, perch: 1.1, bream: 1.4, tench: 1.6, common: 2.6, mirror: 2.6, pike: 2.2 }[s] || 0.8;
  return { bleeps: 1 + Math.floor(rnd() * 4), lead: 0.8 + rnd() * 3.5, window: W, run: s === 'tench' ? 'lift' : 'under', self: 0 };
}
