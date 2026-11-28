// Wildlife and pets: where they live, when they are about and what they do (wildlife.js draws them and plays their
// calls). Plain JavaScript run through a small world interface, so the unit tests can drive it on a made-up map:
//   W.lc(x, z)            land cover class (wildlifeSpecies.js LC), null where the map is not loaded
//   W.ground(x, z, y)     the walkable surface nearest height y (null where not loaded)
//   W.water(x, z)         the water's surface level, null on land
//   W.trees(x, z, r)      trees within r: [[x, z, H, groundY], ...]
//   W.busy(x, z)          how many people are about (peds.js footfall)
//   W.bigRoad(x, z, r)    a main road within r
//   W.blocked(x, z, y)    inside a building, below its roof, at height y
//   W.visible(x, y, z, r) in the camera's view
//   W.time() game time (unix s); W.clock() clock hours; W.rain() 0..1; W.wind() {x, z} m/s
//   W.focus()             the player { x, y, z, speed, vehicle, vspeed }
//   W.peds()              people on foot (peds.js list); W.cars() traffic
// Nothing appears where you are looking: animals passing through arrive out of sight (or far off) and birds fly
// in; the herds keep to their fields, the waterfowl to their lakes, rabbits come out of their warrens and badgers
// out of their setts at dusk. How many of each are about follows the place, the hour and the weather
// (wildlifeSpecies.js), so a fox in a shopping street at noon is vanishingly rare and a hedgehog by day rare.
import { SPECIES, LC, active, habitatKey, suitability, weatherFactor, solarHour, YOUNG, isYoungSeason, CALLS } from './wildlifeSpecies.js';

const TAU = Math.PI * 2;
export function hash3(a, b, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const turnTo = (h, t, max) => { const d = wrap(t - h); return h + Math.max(-max, Math.min(max, d)); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// body sizes the behaviours need: leg (stride and lying), len (spacing), hz (wingbeats drawn per second)
export const BODY = {
  cat: { leg: 0.15, len: 0.45 }, dog: { leg: 0.3, len: 0.75 }, fox: { leg: 0.27, len: 0.62 }, badger: { leg: 0.12, len: 0.75 }, hedgehog: { leg: 0.05, len: 0.26 },
  rabbit: { leg: 0.08, len: 0.34 }, hare: { leg: 0.15, len: 0.5 }, squirrel: { leg: 0.06, len: 0.24 }, muntjac: { leg: 0.3, len: 0.66 }, roe: { leg: 0.5, len: 0.92 },
  rat: { leg: 0.03, len: 0.21 }, mouse: { leg: 0.015, len: 0.1 }, cow: { leg: 0.72, len: 1.95 }, sheep: { leg: 0.36, len: 1.15 }, horse: { leg: 0.85, len: 1.75 },
  woodpigeon: { hz: 5, len: 0.4, leg: 0.035 }, pigeon: { hz: 6, len: 0.33, leg: 0.03 }, crow: { hz: 4, len: 0.45, leg: 0.06 }, rook: { hz: 4, len: 0.45, leg: 0.06 },
  magpie: { hz: 6, len: 0.45, leg: 0.05 }, jackdaw: { hz: 5, len: 0.34, leg: 0.045 }, robin: { hz: 8, len: 0.14, leg: 0.025 }, blackbird: { hz: 8, len: 0.25, leg: 0.035 },
  bluetit: { hz: 8, len: 0.12, leg: 0.02 }, sparrow: { hz: 8, len: 0.15, leg: 0.02 }, starling: { hz: 8, len: 0.21, leg: 0.03 }, parakeet: { hz: 7, len: 0.4, leg: 0.025 },
  pheasant: { hz: 7, len: 0.8, leg: 0.09 }, greenpecker: { hz: 7, len: 0.32, leg: 0.03 }, gull: { hz: 3.5, len: 0.38, leg: 0.06 }, heron: { hz: 2.2, len: 0.95, leg: 0.48 },
  owl: { hz: 3.5, len: 0.38, leg: 0.03 }, swift: { hz: 8, len: 0.17 }, swallow: { hz: 7, len: 0.18 }, redkite: { hz: 2, len: 0.62 }, buzzard: { hz: 2.5, len: 0.54 }, kestrel: { hz: 8, len: 0.34 },
  mallard: { hz: 6, len: 0.58, leg: 0.06 }, coot: { hz: 6, len: 0.38, leg: 0.08 }, moorhen: { hz: 6, len: 0.33, leg: 0.08 }, grebe: { hz: 6, len: 0.5, leg: 0.05 },
  tufted: { hz: 6, len: 0.44, leg: 0.05 }, swan: { hz: 2.6, len: 1.5, leg: 0.12 }, canada: { hz: 3.5, len: 1.0, leg: 0.22 }, greylag: { hz: 3.5, len: 0.95, leg: 0.22 },
  egyptian: { hz: 4, len: 0.7, leg: 0.24 }, bat: { hz: 9, len: 0.06 },
};
// who a dog sets running (cows and horses ignore them; herons and owls are out of reach)
const DOG_SCARES = new Set(['cat', 'fox', 'squirrel', 'rabbit', 'hare', 'muntjac', 'roe', 'sheep', 'hedgehog', 'rat', 'mouse', 'woodpigeon', 'pigeon', 'crow', 'rook', 'magpie', 'jackdaw',
  'robin', 'blackbird', 'bluetit', 'sparrow', 'starling', 'parakeet', 'pheasant', 'greenpecker', 'gull', 'mallard', 'coot', 'moorhen', 'canada', 'greylag', 'egyptian', 'grebe', 'tufted']);
const FORAGE_GROUND = new Set(['woodpigeon', 'blackbird', 'robin', 'starling', 'magpie', 'crow', 'rook', 'jackdaw', 'sparrow', 'parakeet']);
const RANGE = 130, NS = 96, CELL = 96;
// how many more of each to bring out on 'Plenty' (the rest: x1.8 birds, x2.5 mammals); the town fox above all
const PLENTY = { fox: 3.5, hedgehog: 2.5, badger: 3, muntjac: 3, roe: 2.5, hare: 3, squirrel: 3, rabbit: 1.5, swift: 1, gull: 1.2, pigeon: 1.2, rat: 1.2, mouse: 1.5 };

export class WildSim {
  constructor(W, opts = {}) {
    this.W = W; this.rand = mulberry(opts.seed ?? 20240615);
    this.max = opts.max || 100; this.drawScale = opts.drawScale || 1;
    // Settings > Wildlife: 'Plenty' (1, the default) brings out more of everything than you'd really meet,
    // so the foxes, hedgehogs, deer and garden birds are actually seen; 'Realistic' (0) is Berkshire's numbers
    this.abundance = opts.abundance ?? 1;
    this.list = []; this.samples = new Array(NS).fill(null); this.si = 0;
    this.cells = new Map();         // site cells (deterministic: the same herds, flocks and warrens on every visit)
    this.live = new Map();          // active site -> its animals
    this.nests = [];                // nests in the trees near the player
    this.nestSites = new Map();     // tree key -> nesting pair
    this.dogs = new Map();          // ped id -> its dog, or null (no dog)
    this.threats = []; this.calls = []; this.u = {}; this.E = {}; this.over = {}; this.uT = 0; this.planT = 0; this.t = 0; this.nextId = 1; this.nextGroup = 1; this.tick = 0;
    this.roam = 0; this.siteN = 0; this.siteMax = opts.siteMax || 160;   // animals passing through / kept by their places
    this.feeder = null; this.stillT = 0;
    this.transient = Object.keys(SPECIES).filter(k => !SPECIES[k].site && !SPECIES[k].walked);
    this.stats = { spawned: {}, seenSpawn: 0 };
  }

  // ---------------------------------------------------------------- the place
  habitat(x, z) {
    const W = this.W, lc = W.lc(x, z);
    if (lc == null) return null;
    let waterD = lc === LC.water ? 0 : 99;
    if (waterD) for (const r of [5, 10, 17, 25]) {
      let hit = false;
      for (let k = 0; k < 8 && !hit; k++) { const a = k * Math.PI / 4 + r * 0.37; hit = W.lc(x + Math.cos(a) * r, z + Math.sin(a) * r) === LC.water; }
      if (hit) { waterD = r; break; }
    }
    let built = 0;
    for (let k = 0; k < 12; k++) {
      const r = k < 6 ? 18 : 36, a = k * 1.0472 + (k < 6 ? 0 : 0.52), c = W.lc(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (c === LC.building || c === LC.road || c === LC.pavement || c === LC.parking || c === LC.plaza || c === LC.hard) built++;
    }
    const trees = W.trees(x, z, 18).length;
    let peds = 0; for (const p of W.peds()) if (Math.abs(p.x - x) < 30 && Math.abs(p.z - z) < 30) peds++;
    const h = { x, z, lc, waterD, urban: built / 12, trees, busy: W.busy(x, z) + peds * 4, bigRoad: W.bigRoad(x, z, 22) };
    h.key = habitatKey(h);
    return h;
  }
  // the habitat at a spot from its land cover alone (choosing where to walk or land)
  quickKey(x, z, urban) {
    const lc = this.W.lc(x, z); if (lc == null) return null;
    return habitatKey({ lc, waterD: lc === LC.water ? 0 : 99, urban: urban ?? 0.5 });
  }
  sample(f) {
    const i = this.si = (this.si + 1) % NS;
    // Reserve a quarter of samples for habitats within walking distance.
    const radius = i % 4 === 0 ? 36 : RANGE;
    const r = 8 + Math.pow(this.rand(), 0.75) * (radius - 8), a = this.rand() * TAU;
    const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, h = this.habitat(x, z);
    this.samples[i] = h ? { x, z, h, w: {} } : null;
  }

  // ---------------------------------------------------------------- how many of each are about, and where
  rangeOf(S) { return S.plan === 'raptor' ? RANGE : Math.min(RANGE, S.draw * 0.9 * this.drawScale); }
  minR(S) { return S.plan === 'raptor' ? 60 : S.draw > 150 ? 35 : S.draw > 80 ? 18 : 10; }
  hideD(S) { return S.draw * 0.85 * this.drawScale; }   // beyond this they're too small to notice arriving
  expected(S, mean, range, key) {
    const more = this.abundance ? (PLENTY[key] ?? (S.plan === 'bird' ? 1.8 : S.plan === 'quad' || S.plan === 'hog' ? 2.5 : 1.3)) : 1;
    if (S.plan === 'raptor') return 3 * S.dens * mean * Math.min(more, 1.5);
    const D = S.plan === 'bird' || S.plan === 'bat' || S.plan === 'aerial' ? 2.5 : 0.5;
    return D * S.dens * mean * Math.PI * range * range / 1e4 * more;
  }
  plan(f) {
    const hour = this.hour, rain = this.W.rain();
    if (this.t >= this.uT) { for (const k of this.transient) this.u[k] = this.rand(); this.uT = this.t + 150 + this.rand() * 150; }
    const ok = this._ok ||= []; ok.length = 0; for (const s of this.samples) if (s) ok.push(s);
    if (ok.length < 16) return;
    const seen = this._seen ||= new Set();
    for (const key of this.transient) {
      const S = SPECIES[key], range = this.rangeOf(S);
      let sum = 0, n = 0;
      for (const s of ok) {
        const r = Math.hypot(s.x - f.x, s.z - f.z);
        if (r > range) { s.w[key] = 0; continue; }
        n++; sum += s.w[key] = suitability(S, s.h, hour) * weatherFactor(S, rain);
      }
      // (smoothed over half a minute: the samples come and go, the animals shouldn't)
      const E0 = n && (!S.months || S.months.includes(this.month)) ? this.expected(S, sum / n, range, key) : 0, prev = this.E[key];
      const E = this.E[key] = prev == null ? E0 : prev + (E0 - prev) * 0.06;
      const gMean = (S.group[0] + S.group[1]) / 2;
      const want = Math.min(Math.floor(E + this.u[key]), Math.ceil(S.cap / gMean));
      let have = 0, far = null, fd = -1; seen.clear();
      // (only those passing through: not the places' animals, the nesting birds or the dogs)
      for (const a of this.list) if (a.key === key && !a.leaving && !a.site && !a.nest && !a.owner && !seen.has(a.group)) {
        seen.add(a.group); have++;
        const d = Math.hypot(a.x - f.x, a.z - f.z); if (d > fd) { fd = d; far = a.group; }
      }
      if (have < want && this.roam < this.max) this.spawnGroup(key, S, ok, f, range);
      // too many for the place and the hour now (dusk has come, you've walked into town): one group moves off
      this.over[key] = have > want ? (this.over[key] || 0) + 1 : 0;
      if (this.over[key] > 25 && far != null) { this.over[key] = 0; for (const a of this.list) if (a.group === far && !a.site && !a.nest && !a.owner) this.leave(a); }
    }
  }
  canArrive(S) { return S.plan === 'bird' || S.plan === 'raptor' || S.plan === 'bat' || S.plan === 'aerial'; }
  // (with a margin, so nothing starts just outside the edge of the view either)
  inSight(a, f, hide) { return Math.hypot(a.x - f.x, a.z - f.z) < hide + 6 && this.W.visible(a.x, a.y + 0.5, a.z, 4); }
  spawnGroup(key, S, samples, f, range) {
    const W = this.W, hide = this.hideD(S), rMin = this.minR(S), cand = [];
    let tot = 0;
    for (const s of samples) {
      const w = s.w[key]; if (!(w > 0)) continue;
      const r = Math.hypot(s.x - f.x, s.z - f.z); if (r < rMin || r > range) continue;
      const gy = W.ground(s.x, s.z); if (gy == null) continue;
      const seen = r < hide + 6 && W.visible(s.x, gy + 0.5, s.z, 4);
      if (seen && !this.canArrive(S)) continue;
      cand.push([s, w * w, seen, gy]); tot += w * w;
    }
    if (!cand.length) return null;
    let q = this.rand() * tot, c = cand[0];
    for (const e of cand) { q -= e[1]; if (q <= 0) { c = e; break; } }
    const [s, , seen, gy] = c, n = S.group[0] + Math.floor(this.rand() * (S.group[1] - S.group[0] + 1));
    const group = this.nextGroup++, habit = 0.45 + 0.55 * Math.exp(-s.h.busy / 25);
    const made = [], flyer = S.plan === 'raptor' || S.plan === 'bat' || S.plan === 'aerial';
    const ok = (x, z) => (flyer ? W.lc(x, z) != null : this.landOk(key, S, x, z));   // (bats and swifts over the water too)
    for (let i = 0; i < n && this.roam + i < this.max; i++) {
      const spread = Math.min(8, 0.6 + Math.sqrt(n) * (BODY[key]?.len || 0.4) * 1.4);
      let x = s.x, z = s.z;
      for (let k = 0; k < 6 && i; k++) {
        const tx = s.x + (this.rand() - 0.5) * 2 * spread, tz = s.z + (this.rand() - 0.5) * 2 * spread;
        if (ok(tx, tz)) { x = tx; z = tz; break; }
      }
      if (!ok(x, z)) continue;
      const a = this.make(key, x, W.ground(x, z) ?? gy, z, { group, habit, urban: s.h.urban });
      made.push(a);
    }
    if (!made.length) return null;
    // where they come from: birds fly in from out of sight; others were already there (out of view)
    if (S.plan === 'raptor') for (const a of made) this.startRaptor(a, f, seen);
    else if (S.plan === 'bat' || S.plan === 'aerial') for (const a of made) {
      if (S.plan === 'bat') this.startBat(a, s); else this.startAerial(a, f, seen);
      // up in the air it may be in sight after all: not this one, then (a swift arriving from far off is fine)
      if (this.inSight(a, f, hide)) a.gone = true;
    }
    else if (S.plan === 'bird') {
      const perch = S.move === 'perch';
      for (const a of made) {
        // where it will be (in a tree, on the ground, at the water's edge); if that's in sight it flies in to
        // there from somewhere out of sight
        if (!(perch && this.perchIn(a, a.x, a.z, 25))) {
          a.state = S.move === 'wade' ? 'wade' : 'peck';
          if (S.move === 'wade') { const T = this.shore(a.x, a.z, 0, 25); if (T) { a.x = T.x; a.z = T.z; a.y = W.ground(T.x, T.z) ?? a.y; } }
        }
        if (this.inSight(a, f, hide)) this.arrive(a, f);
      }
    } else {
      // walkers: only those that are out of sight (the group's edge can reach into the view)
      for (const a of made) if (this.inSight(a, f, hide)) a.gone = true;
      this.startMammal(made.filter(a => !a.gone), s.h);
    }
    if (seen) this.stats.seenSpawn++;
    this.stats.spawned[key] = (this.stats.spawned[key] || 0) + made.length;
    return made;
  }
  // can a land animal of this kind stand here?
  landOk(key, S, x, z) {
    const lc = this.W.lc(x, z); if (lc == null) return false;
    if (S.move === 'wade') return lc !== LC.building && (lc === LC.water ? this.W.water(x, z) != null : true);
    if (lc === LC.water || lc === LC.building) return false;
    if (lc === LC.road && !S.roads && S.plan !== 'bird') return false;
    return true;
  }
  make(key, x, y, z, o = {}) {
    const S = SPECIES[key], r = this.rand();
    const a = { id: this.nextId++, key, S, x, y, z, heading: this.rand() * TAU, state: 'idle', t: 1 + this.rand() * 4, speed: 0, phase: this.rand() * TAU, amp: 0, mode: 0,
      scale: (o.scale || 1) * (0.93 + r * 0.14), seed: this.rand(), look: 0, drop: 0, wag: 0, pitch: 0, lift: 0, group: o.group || this.nextGroup++, habit: o.habit ?? 1, urban: o.urban ?? 0.5,
      home: o.home || { x, z }, range: o.range || 0, born: this.t, life: o.life ?? (90 + this.rand() * 300), site: o.site || null, hidden: false };
    this.list.push(a);
    return a;
  }
  leave(a) { if (a.leaving) return; a.leaving = true; a.range = 0; if (a.state === 'under') a.gone = true; }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1); this.t += dt;
    const W = this.W, f = W.focus(), time = W.time();
    this.hour = solarHour(time); this.clockH = W.clock(); this.month = new Date(time * 1000).getUTCMonth();
    this.calls.length = 0;
    this.gatherThreats(f);
    this.watchFeeder(f, dt);
    // Spend the habitat-query budget per simulated second across frame rates.
    this.sampleCredit = Math.min(4, (this.sampleCredit ?? 4) + dt * 32);
    while (this.sampleCredit >= 1) { this.sample(f); this.sampleCredit--; }
    if ((this.planT -= dt) <= 0) {
      this.planT = 1;
      this.dogWalkers(f); this.plan(f); this.sitesNear(f); this.nestsNear(f);
    }
    for (const [site, animals] of this.live) this.runSite(site, animals, dt, f);
    let dead = false, roam = 0, siteN = 0;
    for (const a of this.list) { if (a.site || a.nest) siteN++; else roam++; }
    this.roam = roam; this.siteN = siteN;
    this.frame = (this.frame || 0) + 1;
    for (const a of this.list) {
      if (a.gone) { dead = true; continue; }
      // the far ones less often (a herd 200 m off moves a few centimetres a frame)
      let d = Math.hypot(a.x - f.x, a.z - f.z);
      const lod = a.fl || a.key === 'dog' ? 1 : d > 120 ? 4 : d > 50 ? 2 : 1;
      a.acc = (a.acc || 0) + dt;
      if (lod === 1 || (a.id + this.frame) % lod === 0) { this.step(a, Math.min(0.25, a.acc), f); a.acc = 0; d = Math.hypot(a.x - f.x, a.z - f.z); }
      if (a.gone) { dead = true; continue; }
      // gone from view and out of range (never drawn there), or finished leaving
      const far = a.S.draw * 1.1 * this.drawScale;
      if ((d > far && !a.site && !a.owner) || (a.leaving && d > 25 && !W.visible(a.x, a.y + 0.5, a.z, 1))) { a.gone = true; dead = true; continue; }
      if (!a.site && !a.owner && !a.leaving && this.t - a.born > a.life) this.leave(a);
      this.voice(a, dt, d);
    }
    if (dead) this.list = this.list.filter(a => !a.gone);
  }
  step(a, dt, f) {
    const S = a.S;
    if (a.key === 'dog') return this.dog(a, dt);
    if (a.state === 'under') return this.underground(a, dt);
    if (a.fl) return this.flight(a, dt);
    switch (S.plan) {
      case 'raptor': return this.raptor(a, dt, f);
      case 'bat': return this.bat(a, dt);
      case 'aerial': return this.aerial(a, dt, f);
      case 'water': return this.waterfowl(a, dt);
      case 'bird': return this.bird(a, dt);
      default: return S.site === 'herd' ? this.grazer(a, dt) : this.mammal(a, dt);
    }
  }

  // ---------------------------------------------------------------- what frightens them
  // (the entries are pooled and refilled every frame: they were a fresh object for every person and car in range)
  gatherThreats(f) {
    const T = this.threats, W = this.W, pool = this._tPool ||= []; T.length = 0;
    const add = (x, z, k, kind, still = false, dog = null) => { const t = pool[T.length] ||= {}; t.x = x; t.z = z; t.k = k; t.kind = kind; t.still = still; t.dog = dog; T.push(t); };
    if (f.vehicle) add(f.x, f.z, f.vspeed > 2 ? 0.8 : 0.4, 'car', f.vspeed < 0.5);
    else add(f.x, f.z, f.speed > 3 ? 1.6 : f.speed > 0.4 ? 1 : 0.65, 'player', f.speed < 0.3);
    for (const p of W.peds()) if (Math.abs(p.x - f.x) < 160 && Math.abs(p.z - f.z) < 160) add(p.x, p.z, 0.55, 'ped');
    for (const a of this.list) if (a.key === 'dog') add(a.x, a.z, a.offLead ? 1.5 : 1.1, 'dog', false, a);
    for (const c of W.cars()) if (Math.abs(c.x - f.x) < 160 && Math.abs(c.z - f.z) < 160 && Math.abs(c.sp || 0) > 2) add(c.x, c.z, 0.6, 'car');
  }
  // the most pressing threat: { d (distance scaled by how frightening it is), x, z, kind } or null
  threat(a, reach) {
    let best = null, bq = reach;
    for (const t of this.threats) {
      if (t.dog === a) continue;
      if (t.kind === 'dog' && !DOG_SCARES.has(a.key)) continue;
      const dx = a.x - t.x, dz = a.z - t.z;
      if (Math.abs(dx) > bq * 2 || Math.abs(dz) > bq * 2) continue;
      const q = Math.hypot(dx, dz) / t.k;
      if (q < bq) { bq = q; best = t; }
    }
    // (one result object per caller slot, reused; callers read it at once)
    if (!best) return null;
    const r = this._thr = this._thr === this._thrA ? (this._thrB ||= {}) : (this._thrA ||= {});
    r.d = bq; r.x = best.x; r.z = best.z; r.kind = best.kind; r.t = best;
    return r;
  }
  // standing still at the water's edge: the ducks, geese and swans swim over (hoping for bread)
  watchFeeder(f, dt) {
    this.stillT = !f.vehicle && f.speed < 0.3 ? this.stillT + dt : 0;
    if (this.stillT > 3) {
      if (!this.feeder || Math.hypot(this.feeder.x - f.x, this.feeder.z - f.z) > 2) {
        let best = null, bd = 12;
        for (let k = 0; k < 16; k++) for (const r of [2, 4, 7, 10]) {
          const a = k * TAU / 16, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
          if (r < bd && this.W.water(x, z) != null) { bd = r; best = { x, z }; }
        }
        this.feeder = best ? { x: best.x, z: best.z, px: f.x, pz: f.z } : null;
      }
    } else this.feeder = null;
  }

  // ---------------------------------------------------------------- moving about
  passable(a, x, z) {
    const W = this.W, lc = W.lc(x, z);
    if (lc == null) return false;
    if (a.swimming) return lc === LC.water;
    if (lc === LC.building) return false;
    if (lc === LC.water) return a.S.move === 'wade' && W.water(x, z) != null && !!a.wading;
    if (a.field) return lc === a.field.lc && (x - a.field.x) ** 2 + (z - a.field.z) ** 2 < a.field.r2;
    if ((lc === LC.road || lc === LC.rail) && !a.S.roads && a.S.plan !== 'bird') return false;
    if (a.range && (x - a.home.x) ** 2 + (z - a.home.z) ** 2 > a.range * a.range && (x - a.home.x) ** 2 + (z - a.home.z) ** 2 > (a.x - a.home.x) ** 2 + (a.z - a.home.z) ** 2) return false;
    return true;
  }
  // step forward along the heading; turns aside when the way is blocked
  move(a, speed, dt) {
    if (speed <= 0) { a.speed = 0; return true; }
    const nx = a.x + Math.cos(a.heading) * speed * dt, nz = a.z + Math.sin(a.heading) * speed * dt;
    if (!this.passable(a, nx, nz)) {
      a.heading += (a.seed < 0.5 ? 1 : -1) * (0.6 + this.rand() * 1.2); a.speed = 0; a.stuck = (a.stuck || 0) + dt;
      return false;
    }
    a.x = nx; a.z = nz; a.speed = speed; a.stuck = 0;
    if (a.swimming) { if ((a.id + ++this.tick) % 10 === 0) { const l = this.W.water(nx, nz); if (l != null) a.y = l; } }
    else { const g = this.W.ground(nx, nz, a.y); if (g != null) a.y = g; }
    const B = BODY[a.key], leg = (B?.leg || 0.1) * a.scale;
    a.phase += speed * dt * TAU / Math.max(0.05, leg * 2.6);
    return true;
  }
  walkTo(a, tx, tz, speed, dt, rate = 3.5) {
    a.heading = turnTo(a.heading, Math.atan2(tz - a.z, tx - a.x), rate * dt);
    this.move(a, speed, dt);
    return Math.hypot(tx - a.x, tz - a.z);
  }
  // a spot to go to within [r0, r1] of (x, z), suited to the animal (land cover), optionally away from a point
  spot(a, x, z, r0, r1, away = null, tries = 8) {
    const S = a.S;
    for (let k = 0; k < tries; k++) {
      let ang = this.rand() * TAU;
      if (away) ang = Math.atan2(z - away.z, x - away.x) + (this.rand() - 0.5) * 2.2;
      const r = r0 + this.rand() * (r1 - r0), tx = x + Math.cos(ang) * r, tz = z + Math.sin(ang) * r;
      if (!this.landOk(a.key, S, tx, tz)) continue;
      if (a.field && (tx - a.field.x) ** 2 + (tz - a.field.z) ** 2 > a.field.r2) continue;
      if (a.field && this.W.lc(tx, tz) !== a.field.lc) continue;
      if (a.range && (tx - a.home.x) ** 2 + (tz - a.home.z) ** 2 > a.range * a.range) continue;
      const key = this.quickKey(tx, tz, a.urban);
      if (S.hab && !(S.hab[key] > 0.15) && !a.field && k < tries - 2) continue;
      return { x: tx, z: tz };
    }
    return null;
  }
  gait(a, dt, target) {   // stride amplitude eases to suit the speed; still when stopped
    const B = BODY[a.key], leg = (B?.leg || 0.1) * a.scale;
    const want = target ?? (a.speed > 0.05 ? clamp(0.22 + a.speed / (leg * 7), 0.2, 0.75) : 0);
    a.amp += (want - a.amp) * Math.min(1, dt * 6);
  }

  // ---------------------------------------------------------------- mammals passing through
  startMammal(made, h) {
    for (const a of made) {
      const S = a.S;
      a.state = 'idle'; a.t = 2 + this.rand() * 6;
      if (a.key === 'cat') { a.friendly = this.rand() < 0.4; a.state = this.rand() < 0.5 ? 'sit' : 'idle'; a.range = 70; a.home = { x: a.x, z: a.z }; }
      if (a.key === 'squirrel' || a.key === 'hedgehog' || a.key === 'rat' || a.key === 'mouse') a.range = 40;
      // by day a fox may be lying up in a quiet corner; cats doze in the sun
      if ((a.key === 'fox' && active('fox', this.hour) < 0.3) || (a.key === 'cat' && this.rand() < 0.25)) { a.state = 'curl'; a.t = 30 + this.rand() * 120; }
      a.bold = a.key === 'fox' && h.urban > 0.3 ? 0.6 : 1;   // town foxes let you nearer
    }
  }
  mammal(a, dt) {
    const S = a.S, B = BODY[a.key] || {}, run = S.speed[1], walk = S.speed[0];
    a.t -= dt; a.lift = 0; a.pitch = 0;
    // frightened? (a curled hedgehog stays curled; cats and foxes first stop and stare)
    const th = (a.state === 'curl' && a.key === 'hedgehog') || a.state === 'climb' || a.state === 'down' ? null : this.threat(a, S.flee * 2.2 * (a.bold || 1));
    const fleeD = S.flee * a.habit * (a.bold || 1);
    if (th && a.state !== 'flee' && a.state !== 'tree') {
      if (a.key === 'cat' && a.friendly && th.kind === 'player' && th.t.still && th.d < 9 && a.state !== 'greet') { a.state = 'greet'; a.t = 20 + this.rand() * 30; }
      else if (a.state !== 'greet' && th.d < fleeD) this.startle(a, th);
      else if (a.state !== 'greet' && a.state !== 'alert' && th.d < fleeD * 1.8 && (a.key === 'fox' || a.key === 'muntjac' || a.key === 'roe' || a.key === 'hare' || a.key === 'cat' || a.key === 'badger')) { a.state = 'alert'; a.t = 2 + this.rand() * 4; a.watch = th; }
    }
    switch (a.state) {
      case 'idle': case 'sit': {
        a.mode = a.state === 'sit' ? 2 : 0; a.drop = a.state === 'sit' ? (B.leg || 0.1) * 0.75 : 0; a.speed = 0;
        a.look = Math.sin(this.t * 0.7 + a.seed * 9) * 0.8;
        if (a.key === 'rabbit' || a.key === 'hare' || a.key === 'squirrel') { a.pitch = a.state === 'idle' ? 0.55 : 0; a.lift = a.pitch * (B.len || 0.3) * 0.3 * a.scale; }
        if (a.t <= 0) this.nextMammal(a);
        break;
      }
      case 'alert': {   // stop and stare at whatever it is
        a.mode = 0; a.speed = 0; const w = a.watch;
        if (w) a.look = clamp(wrap(Math.atan2(w.z - a.z, w.x - a.x) - a.heading), -1.3, 1.3);
        if (a.key === 'hare' || a.key === 'rabbit') { a.pitch = 0.6; a.lift = 0.6 * (B.len || 0.3) * 0.3 * a.scale; }
        if (a.t <= 0) { a.state = 'walk'; a.target = this.spot(a, a.x, a.z, 8, 25, w) || null; a.t = 10; }
        break;
      }
      case 'forage': {   // nose down, a few steps at a time (sniffing, grazing, rooting)
        a.mode = 1; a.look = Math.sin(this.t * 1.3 + a.seed * 5) * 0.4;
        const sp = (Math.sin(this.t * (a.key === 'hedgehog' ? 1.6 : 0.9) + a.seed * 20) > 0.2 ? walk * 0.45 : 0);
        if (this.rand() < dt * 0.4) a.heading += (this.rand() - 0.5) * 1.6;
        this.move(a, sp, dt);
        if (a.t <= 0) this.nextMammal(a);
        break;
      }
      case 'walk': {
        a.mode = 0; a.look *= 0.9;
        const T = a.target;
        if (!T) { this.nextMammal(a); break; }
        const hop = S.move === 'hop';
        const sp = hop ? (Math.sin(a.phase * 0.5) > -0.3 ? walk * 1.4 : 0.15) : walk * (a.trot || 1);
        const d = this.walkTo(a, T.x, T.z, sp, dt);
        if (hop && a.speed > 0.1) a.lift = Math.max(0, Math.sin(a.phase)) * (B.leg || 0.08) * 0.8 * a.scale;
        if (d < 0.6 || a.t <= 0 || a.stuck > 1.5) this.nextMammal(a);
        break;
      }
      case 'flee': {
        a.mode = 0; a.look = 0;
        const T = a.target, sp = run * (a.key === 'hedgehog' ? 0.6 : 1);
        if (T) {
          const d = this.walkTo(a, T.x, T.z, sp, dt, 7);
          if (S.move === 'hop' && a.speed > 0.1) a.lift = Math.max(0, Math.sin(a.phase)) * (B.leg || 0.08) * 1.2 * a.scale;
          if (d < 0.8 || a.stuck > 1) {
            if (a.climbTo && d < 1.5) { a.tree = a.climbTo; a.climbTo = null; a.state = 'climb'; a.heading = Math.atan2(a.tree.z - a.z, a.tree.x - a.x); break; }
            if (a.toBurrow && d < 1.5) { a.state = 'under'; a.hidden = true; a.toBurrow = false; a.t = 30 + this.rand() * 60; a.x = a.site.x; a.z = a.site.z; break; }
            a.climbTo = null; a.toBurrow = false; a.state = 'idle'; a.t = 2 + this.rand() * 5;
          }
        } else { this.move(a, sp, dt); }
        if (a.t <= 0 && !a.toBurrow) { a.state = 'idle'; a.t = 3; a.climbTo = null; }
        break;
      }
      case 'curl': {   // asleep (cats in the sun, a fox lying up) or a hedgehog rolled into a ball
        a.mode = 5; a.speed = 0; a.look = 0;
        if (a.t <= 0) { const th2 = this.threat(a, 8); if (!th2 || a.key !== 'hedgehog') { a.state = 'idle'; a.t = 1 + this.rand() * 3; } else a.t = 5; }
        break;
      }
      case 'greet': {   // a friendly cat comes over, winds round your legs and asks for attention
        const p = this.threats[0];
        a.mode = 0;
        if (!p || p.kind !== 'player' || !p.still || a.t <= 0) { a.state = 'walk'; a.target = this.spot(a, a.x, a.z, 6, 20) ; a.t = 12; break; }
        const ang = this.t * 0.9 + a.seed * 6, tx = p.x + Math.cos(ang) * 0.55, tz = p.z + Math.sin(ang) * 0.55;
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        this.walkTo(a, d > 1.4 ? p.x : tx, d > 1.4 ? p.z : tz, d > 1.4 ? walk * 1.3 : walk * 0.55, dt, 5);
        a.wag = 0.25;
        if (this.rand() < dt * 0.12) this.say(a, 'meow', 0.9);
        break;
      }
      case 'climb': {   // squirrels up the trunk
        const T = a.tree; a.mode = 0; a.pitch = 1.4; a.amp = -0.6; a.phase += dt * 22;
        a.y += 2.2 * dt; a.x = T.x + Math.cos(a.heading + Math.PI) * 0.25; a.z = T.z + Math.sin(a.heading + Math.PI) * 0.25;
        if (a.y >= T.y1) { a.state = 'tree'; a.t = 8 + this.rand() * 20; a.pitch = 0; }
        break;
      }
      case 'tree': {   // up a tree, sitting on a bough
        a.mode = 0; a.speed = 0; a.amp = 0; a.look = Math.sin(this.t + a.seed * 7) * 0.6;
        if (a.t <= 0) {
          const th2 = this.threat(a, S.flee * 1.5);
          if (th2) a.t = 5; else { a.state = 'down'; a.heading += Math.PI; }
        }
        break;
      }
      case 'down': {   // head first down the trunk
        a.mode = 0; a.pitch = -1.4; a.amp = -0.6; a.phase += dt * 18; a.y -= 1.8 * dt;
        const g = this.W.ground(a.x, a.z, a.y - 30);
        if (g == null || a.y <= g) { a.y = g ?? a.y; a.state = 'idle'; a.t = 2; a.tree = null; a.pitch = 0; a.x += Math.cos(a.heading) * 0.3; a.z += Math.sin(a.heading) * 0.3; }
        break;
      }
      default: this.nextMammal(a);
    }
    if (a.state !== 'climb' && a.state !== 'down') this.gait(a, dt, S.move === 'hop' && a.speed > 0.1 ? -0.55 : undefined);
    a.drop = a.state === 'curl' ? (B.leg || 0.1) * 0.95 : a.state === 'sit' ? (B.leg || 0.1) * 0.75 : 0;
    a.wag = a.state === 'greet' ? 0.25 : a.key === 'cat' ? 0.12 : 0.03;
  }
  nextMammal(a) {
    const S = a.S, r = this.rand();
    if (a.leaving) {
      // off out of sight: away from the player, to cover
      const f = this.threats[0], T = this.spot(a, a.x, a.z, 30, 60, f, 10);
      a.state = 'walk'; a.target = T || { x: a.x + Math.cos(a.heading) * 40, z: a.z + Math.sin(a.heading) * 40 }; a.t = 40; a.trot = 1.4;
      return;
    }
    a.trot = 1;
    const forage = { hedgehog: 0.7, badger: 0.65, rabbit: 0.55, hare: 0.45, squirrel: 0.4, muntjac: 0.45, roe: 0.4, rat: 0.5, mouse: 0.5, fox: 0.3, cat: 0.1 }[a.key] ?? 0.3;
    if (a.key === 'cat' && r < 0.3) { a.state = this.rand() < 0.5 ? 'sit' : 'curl'; a.t = 15 + this.rand() * 60; return; }
    if (r < forage) { a.state = 'forage'; a.t = 4 + this.rand() * 10; return; }
    if (r < forage + 0.2) { a.state = a.key === 'cat' || a.key === 'fox' ? 'sit' : 'idle'; a.t = 2 + this.rand() * 6; return; }
    const T = this.spot(a, a.x, a.z, 5, a.key === 'fox' || a.key === 'roe' ? 45 : a.key === 'hedgehog' || a.key === 'mouse' ? 8 : 20);
    if (T) { a.state = 'walk'; a.target = T; a.t = 25; a.trot = a.key === 'fox' && this.rand() < 0.5 ? 1.3 : 1; }
    else { a.state = 'idle'; a.t = 2; }
  }
  startle(a, th) {
    const S = a.S;
    if (a.key === 'hedgehog') { a.state = 'curl'; a.t = 15 + this.rand() * 25; return; }
    if (a.key === 'squirrel') {   // up the nearest tree
      const trees = this.W.trees(a.x, a.z, 12);
      if (trees.length) {
        let best = trees[0], bd = 1e9; for (const t of trees) { const d = (t[0] - a.x) ** 2 + (t[1] - a.z) ** 2; if (d < bd) { bd = d; best = t; } }
        const T = { x: best[0], z: best[1], y1: best[3] + Math.min(6, best[2] * 0.45) };
        a.state = 'flee'; a.target = { x: T.x, z: T.z }; a.t = 6; a.climbTo = T; return;
      }
    }
    if (a.site && a.site.burrow) { a.state = 'flee'; a.target = { x: a.site.x, z: a.site.z }; a.t = 20; a.toBurrow = true; return; }
    a.state = 'flee'; a.t = 4 + this.rand() * 4;
    a.target = this.spot(a, a.x, a.z, 15, 40, th, 10);
    if (!a.target) a.heading = Math.atan2(a.z - th.z, a.x - th.x);
    if (a.key === 'muntjac' || a.key === 'roe') this.say(a, a.key === 'roe' ? 'roebark' : 'muntjac', 1);
  }

  // ---------------------------------------------------------------- herds in their fields
  grazer(a, dt) {
    const S = a.S, B = BODY[a.key], site = a.site;
    a.t -= dt; a.look *= 0.98;
    const th = this.threat(a, 30);
    if (th && a.key === 'sheep' && th.d < S.flee * a.habit && a.state !== 'flee') {   // the flock moves off together
      for (const b of this.live.get(site) || []) if (b.state !== 'flee' && Math.hypot(b.x - a.x, b.z - a.z) < 12) { b.state = 'flee'; b.t = 4 + this.rand() * 3; b.target = this.spot(b, b.x, b.z, 12, 30, th, 10); }
    } else if (th && (a.key === 'cow' || a.key === 'horse') && th.kind === 'player' && th.d < 22 && a.state !== 'lie') {
      a.look = clamp(wrap(Math.atan2(th.z - a.z, th.x - a.x) - a.heading), -1.1, 1.1);   // they watch you
      if (a.key === 'cow' && a.curious && th.d > 4 && th.t.still && a.state !== 'walk') { a.state = 'walk'; a.target = this.spot(a, th.x, th.z, 2.5, 5) || null; a.t = 20; }
    }
    switch (a.state) {
      case 'graze': a.mode = 1; this.move(a, Math.sin(this.t * 0.6 + a.seed * 30) > 0.55 ? S.speed[0] * 0.5 : 0, dt); if (this.rand() < dt * 0.15) a.heading += (this.rand() - 0.5); break;
      case 'stand': a.mode = 0; a.speed = 0; break;
      case 'lie': a.mode = 2; a.speed = 0; a.drop = B.leg * 0.78; break;
      case 'walk': case 'flee': {
        a.mode = 0;
        if (!a.target) { a.t = 0; break; }
        const d = this.walkTo(a, a.target.x, a.target.z, a.state === 'flee' ? S.speed[1] : S.speed[0], dt, 1.5);
        if (d < 1 || a.stuck > 2) a.t = Math.min(a.t, 0);
        break;
      }
      default: a.t = 0;
    }
    if (a.state !== 'lie') a.drop = 0;
    if (a.t <= 0) {
      // lying down to chew the cud: a lot at night and round midday (cows ~ half the day), horses seldom
      const h = this.hour, night = active('night', h);
      const pLie = { cow: 0.12 + night * 0.55 + (h > 11 && h < 15 ? 0.2 : 0), sheep: 0.1 + night * 0.5 + (h > 11 && h < 15 ? 0.25 : 0), horse: 0.03 + night * 0.12 }[a.key] || 0.1;
      const r = this.rand();
      const cx = site.cx ?? site.x, cz = site.cz ?? site.z;
      if (r < pLie) { a.state = 'lie'; a.t = 60 + this.rand() * 240; }
      else if (Math.hypot(a.x - cx, a.z - cz) > site.spread) { a.state = 'walk'; a.target = this.spot(a, cx, cz, 1, site.spread * 0.6) || { x: cx, z: cz }; a.t = 40; }
      else if (r < pLie + 0.55) { a.state = 'graze'; a.t = 20 + this.rand() * 60; }
      else if (r < pLie + 0.75) { a.state = 'stand'; a.t = 5 + this.rand() * 20; }
      else { a.state = 'walk'; a.target = this.spot(a, a.x, a.z, 4, 15); a.t = 30; }
    }
    this.gait(a, dt);
    a.wag = 0.06; a.plain = a.key === 'horse' && !a.rug;
    if (a.young && a.mother && !a.mother.gone && a.state !== 'lie' && Math.hypot(a.mother.x - a.x, a.mother.z - a.z) > 4) { a.state = 'walk'; a.target = { x: a.mother.x - Math.cos(a.mother.heading) * 1.5, z: a.mother.z - Math.sin(a.mother.heading) * 1.5 }; a.t = 6; }
  }

  // ---------------------------------------------------------------- birds on the ground and in the trees
  bird(a, dt) {
    const S = a.S;
    a.t -= dt; a.pitch = 0;
    if (a.state === 'nest') return this.onNest(a, dt);
    if (a.nest && a.back && this.t > a.back && !a.nest.gone) { a.back = 0; this.flyTo(a, a.nestAt.x, a.nestAt.y, a.nestAt.z, 'nest'); return; }
    const th = this.threat(a, S.flee * 2);
    if (th && th.d < S.flee * a.habit && a.state !== 'perch') return this.takeOff(a, th, true);
    if (th && a.state === 'perch' && th.d < S.flee * 0.4 * a.habit) return this.takeOff(a, th, true);
    if (a.leaving && a.t <= 0) return this.flyAway(a);
    switch (a.state) {
      case 'peck': case 'idle': {   // walking about, pecking at the ground (pigeons bob their heads)
        const hop = a.key === 'sparrow' || a.key === 'robin' || a.key === 'blackbird' || a.key === 'bluetit' || a.key === 'magpie';
        const cycle = Math.sin(this.t * (hop ? 2.2 : 1.5) + a.seed * 17);
        a.mode = cycle > 0.35 ? 1 : 0;
        const sp = cycle < -0.2 ? S.speed[0] * (hop ? 1.2 : 0.7) : 0;
        if (this.rand() < dt * 0.5) a.heading += (this.rand() - 0.5) * 2;
        this.move(a, sp, dt);
        if (hop && a.speed > 0) a.lift = Math.max(0, Math.sin(this.t * 14 + a.seed * 9)) * 0.03 * a.scale; else a.lift = 0;
        // the flock keeps together
        if (a.group) { const l = this.leaderOf(a); if (l && l !== a && Math.hypot(l.x - a.x, l.z - a.z) > 6) a.heading = turnTo(a.heading, Math.atan2(l.z - a.z, l.x - a.x), dt * 3); }
        if (a.t <= 0) {
          a.t = 6 + this.rand() * 20;
          const r = this.rand();
          if (S.move === 'perch' || (r < 0.12 && a.key !== 'pigeon' && a.key !== 'gull')) { if (this.toTree(a)) break; }
          if (r > 0.9) this.hopTo(a);
        }
        break;
      }
      case 'perch': {   // in a tree: looking about, singing
        a.mode = 6; a.speed = 0; a.amp = 0; a.lift = 0;
        a.look = Math.sin(this.t * 0.8 + a.seed * 11) * 1.1;
        if (a.t <= 0) {
          a.t = 8 + this.rand() * 30;
          const r = this.rand();
          if (FORAGE_GROUND.has(a.key) && r < 0.35) { const T = this.spot(a, a.x, a.z, 3, 18); if (T) { this.flyTo(a, T.x, this.W.ground(T.x, T.z) ?? a.y, T.z, 'peck'); break; } }
          if (r < 0.55) this.toTree(a);
        }
        break;
      }
      case 'wade': {   // a heron stands at the water's edge, still for a long time, now and then a stab
        a.mode = Math.sin(this.t * 0.31 + a.seed * 40) > 0.97 ? 1 : 0; a.speed = 0;
        a.look = Math.sin(this.t * 0.2 + a.seed * 3) * 0.5;
        if (a.t <= 0) {
          a.t = 20 + this.rand() * 50;
          const T = this.shore(a.x, a.z, 4, 14);
          if (T) { a.state = 'stalk'; a.target = T; }
        }
        break;
      }
      case 'stalk': {
        a.mode = 0; a.wading = true;
        const d = this.walkTo(a, a.target.x, a.target.z, S.speed[0] * 0.5, dt, 1);
        if (d < 0.4 || a.stuck > 2 || a.t <= 0) { a.state = 'wade'; a.t = 15 + this.rand() * 40; a.wading = false; }
        break;
      }
      default: a.state = 'peck';
    }
    this.gait(a, dt, a.speed > 0 ? 0.35 : 0);
  }
  leaderOf(a) { for (const b of this.list) if (b.group === a.group && !b.fl) return b; return null; }
  // a shore point (land beside water, or the shallows) near (x, z)
  shore(x, z, r0, r1) {
    for (let k = 0; k < 12; k++) {
      const ang = this.rand() * TAU, r = r0 + this.rand() * (r1 - r0), tx = x + Math.cos(ang) * r, tz = z + Math.sin(ang) * r;
      const lc = this.W.lc(tx, tz); if (lc == null || lc === LC.building || lc === LC.road) continue;
      let wet = 0; for (let j = 0; j < 4; j++) if (this.W.lc(tx + Math.cos(j * 1.57) * 3, tz + Math.sin(j * 1.57) * 3) === LC.water) wet++;
      if (wet && wet < 4) return { x: tx, z: tz };
    }
    return null;
  }
  // into the trees: a perch on the top of a crown near the bird
  perchIn(a, x, z, r) {
    const trees = this.W.trees(x, z, r);
    if (!trees.length) return false;
    const t = trees[Math.floor(this.rand() * trees.length)];
    const P = this.perchPoint(t, this.rand(), this.rand());
    a.x = P.x; a.y = P.y; a.z = P.z; a.state = 'perch'; a.t = 10 + this.rand() * 30;
    return true;
  }
  perchPoint(t, u, v) {
    const [x, z, H, gy] = t, cw = H * 0.35, f = 0.25 + u * 0.5, ang = v * TAU;
    return { x: x + Math.cos(ang) * f * cw, y: gy + H - 0.9 * cw + cw * 0.92 * Math.sqrt(1 - f * f), z: z + Math.sin(ang) * f * cw };
  }
  toTree(a) {
    const trees = this.W.trees(a.x, a.z, 35);
    if (!trees.length) return false;
    const t = trees[Math.floor(this.rand() * trees.length)], P = this.perchPoint(t, this.rand(), this.rand());
    this.flyTo(a, P.x, P.y, P.z, 'perch');
    return true;
  }
  hopTo(a) { const T = this.spot(a, a.x, a.z, 8, 25); if (T) this.flyTo(a, T.x, this.W.ground(T.x, T.z) ?? a.y, T.z, a.state === 'perch' ? 'peck' : a.state); }
  takeOff(a, th, flock) {
    const S = a.S;
    if (a.nest) a.back = this.t + 20 + this.rand() * 30;   // a nesting bird comes back when the coast is clear
    // the whole flock goes up together and settles again away from whatever startled them
    const mates = flock && a.group ? this.list.filter(b => b.group === a.group && !b.fl && Math.hypot(b.x - a.x, b.z - a.z) < 18) : [a];
    let T = null;
    if (S.move === 'perch' || this.rand() < 0.3) {
      const trees = this.W.trees(a.x, a.z, 45).filter(t => Math.hypot(t[0] - th.x, t[1] - th.z) > S.flee * 1.5);
      if (trees.length) { const t = trees[Math.floor(this.rand() * trees.length)]; for (const b of mates) { const P = this.perchPoint(t, this.rand(), this.rand()); this.flyTo(b, P.x, P.y, P.z, 'perch'); } return; }
    }
    T = this.spot(a, a.x, a.z, 18, 50, th, 10);
    if (!T || a.leaving) { for (const b of mates) this.flyAway(b, th); return; }
    for (const b of mates) {
      const ox = (this.rand() - 0.5) * 6, oz = (this.rand() - 0.5) * 6, tx = T.x + ox, tz = T.z + oz;
      const ok = this.landOk(b.key, S, tx, tz);
      this.flyTo(b, ok ? tx : T.x, this.W.ground(ok ? tx : T.x, ok ? tz : T.z) ?? b.y, ok ? tz : T.z, S.move === 'wade' ? 'wade' : 'peck');
    }
    if (a.key === 'woodpigeon' || a.key === 'pigeon') this.say(a, 'clatter', 1);
    else if (a.key === 'pheasant') this.say(a, 'pheasant', 1.2);
    else if (CALLS[a.key] && this.rand() < 0.5) this.say(a, CALLS[a.key].call, 1);
  }
  flyAway(a, th = null) {
    const f = th || this.threats[0] || { x: a.x, z: a.z }, ang = Math.atan2(a.z - f.z, a.x - f.x) + (this.rand() - 0.5) * 1.2, r = 110 + this.rand() * 60;
    this.flyTo(a, a.x + Math.cos(ang) * r, a.y + 25 + this.rand() * 20, a.z + Math.sin(ang) * r, 'gone');
    a.leaving = true;
  }
  // arriving: fly in from out of sight to where the bird is now
  arrive(a, f) {
    const tx = a.x, ty = a.y, tz = a.z, W = this.W;
    for (let k = 0; k < 8; k++) {
      const ang = this.rand() * TAU, r = 45 + this.rand() * 40, sx = tx + Math.cos(ang) * r, sz = tz + Math.sin(ang) * r, sy = ty + 14 + this.rand() * 18;
      if (!W.visible(sx, sy, sz, 1) || Math.hypot(sx - f.x, sz - f.z) > a.S.draw * this.drawScale) {
        const after = a.state;
        a.x = sx; a.y = sy; a.z = sz; this.flyTo(a, tx, ty, tz, after); return;
      }
    }
    a.gone = true;   // nowhere unseen to come from: not this time
  }
  flyTo(a, x, y, z, after) {
    const L = Math.max(1, Math.hypot(x - a.x, z - a.z));
    const peak = after === 'gone' ? 4 : after === 'perch' ? Math.max(1.5, L * 0.1) : clamp(L * 0.2, 1.5, 14);
    a.fl = { x0: a.x, y0: a.y, z0: a.z, x1: x, y1: y, z1: z, s: 0, L: Math.hypot(L, y - a.y), peak, after };
    a.mode = 3; a.wading = false;
  }
  flight(a, dt) {
    const F = a.fl, S = a.S, B = BODY[a.key] || {};
    const v = (a.young ? S.speed[1] * 0.8 : S.speed[1]) * (F.s < 0.15 ? 0.6 + F.s * 2.6 : F.s > 0.85 ? 0.5 + (1 - F.s) * 3.3 : 1);
    const s0 = F.s; F.s = Math.min(1, F.s + v * dt / F.L);
    const s = F.s, x = lerp(F.x0, F.x1, s), z = lerp(F.z0, F.z1, s), y = lerp(F.y0, F.y1, s) + F.peak * Math.sin(Math.PI * s);
    const dy = y - a.y, dh = Math.hypot(x - a.x, z - a.z);
    if (dh > 1e-4) a.heading = Math.atan2(z - a.z, x - a.x);
    a.pitch = clamp(Math.atan2(dy, dh + 1e-4) * 0.6, -0.5, 0.6);
    a.x = x; a.y = y; a.z = z;
    // big birds glide the last part of the way in; little ones flap all the way
    a.mode = (B.hz || 6) < 4.5 && s > 0.55 && s < 0.93 ? 7 : a.key === 'pigeon' && s > 0.75 && s < 0.95 ? 7 : 3;
    a.phase += TAU * Math.min(8, B.hz || 6) * dt; a.amp = 0; a.lift = 0; a.look = 0;
    if (F.s >= 1 && s0 < 1) {
      a.fl = null; a.pitch = 0;
      if (F.after === 'gone') { a.gone = true; return; }
      a.state = F.after; a.t = 4 + this.rand() * 15;
      if (a.state === 'swim') { a.swimming = true; const l = this.W.water(a.x, a.z); if (l != null) a.y = l; }
      if (a.state === 'peck' || a.state === 'wade') { const g = this.W.ground(a.x, a.z, a.y); if (g != null) a.y = g; }
      if (a.state === 'nest' && a.nestAt) { a.x = a.nestAt.x; a.y = a.nestAt.y; a.z = a.nestAt.z; }
      a.mode = a.state === 'perch' || a.state === 'nest' ? 6 : a.state === 'swim' ? 4 : 0;
    }
  }

  // ---------------------------------------------------------------- birds of prey, bats
  startRaptor(a, f, seen) {
    const S = a.S, W = this.W;
    // they come into view from behind or from far off, already circling
    let ang = 0, r = 0, ok = false;
    for (let k = 0; k < 10 && !ok; k++) {
      ang = this.rand() * TAU; r = 90 + this.rand() * 160;
      const x = f.x + Math.cos(ang) * r, z = f.z + Math.sin(ang) * r, g = W.ground(x, z) ?? f.y ?? 40;
      ok = !W.visible(x, g + S.alt[1], z, 60) && !W.visible(x, g + S.alt[0], z, 60);
    }
    if (!ok) r = this.hideD(S) + 40;
    a.cx = f.x + Math.cos(ang) * r; a.cz = f.z + Math.sin(ang) * r;
    a.R = S.move === 'hover' ? 0 : 25 + this.rand() * 35; a.ang = this.rand() * TAU; a.dir = this.rand() < 0.5 ? 1 : -1;
    a.alt = S.alt[0] + this.rand() * (S.alt[1] - S.alt[0]);
    a.goal = { x: f.x + (this.rand() - 0.5) * 300, z: f.z + (this.rand() - 0.5) * 300 };
    a.state = S.move; a.t = 20 + this.rand() * 40;
    const g = this.W.ground(a.cx, a.cz) ?? f.y ?? 40; a.y = g + a.alt; a.x = a.cx + Math.cos(a.ang) * a.R; a.z = a.cz + Math.sin(a.ang) * a.R;
  }
  raptor(a, dt, f) {
    const S = a.S, W = this.W, wind = W.wind();
    a.t -= dt;
    if (a.state === 'hover') {   // a kestrel over the verge: head into the wind, wings beating, then on a little way
      a.mode = 3; a.phase += TAU * 7 * dt; a.heading = turnTo(a.heading, Math.atan2(-wind.z, -wind.x), dt);
      if (a.t <= 0) { a.state = 'glide'; a.t = 4 + this.rand() * 4; a.heading += (this.rand() - 0.5) * 2; }
      const g = W.ground(a.x, a.z); if (g != null) a.y += (g + a.alt - a.y) * Math.min(1, dt * 0.8);
      return;
    }
    if (a.state === 'glide') {
      a.mode = 7; this.fly2(a, S.speed[0], dt);
      if (a.t <= 0) { a.state = 'hover'; a.t = 8 + this.rand() * 15; }
      return;
    }
    // soaring: round and round in a thermal that drifts with the wind; now and then a few wingbeats, or
    // off in a long glide to the next one (and the leaving ones away for good)
    if (a.leaving) { a.goal = { x: a.cx + (a.cx - f.x) * 3, z: a.cz + (a.cz - f.z) * 3 }; }
    const gx = a.goal.x - a.cx, gz = a.goal.z - a.cz, gd = Math.hypot(gx, gz);
    const drift = gd > 30 ? 2.5 : 0;
    a.cx += (wind.x * 0.6 + (gd > 1 ? gx / gd * drift : 0)) * dt; a.cz += (wind.z * 0.6 + (gd > 1 ? gz / gd * drift : 0)) * dt;
    if (gd < 30 || a.t <= 0) { a.goal = { x: f.x + (this.rand() - 0.5) * 360, z: f.z + (this.rand() - 0.5) * 360 }; a.t = 30 + this.rand() * 60; }
    const w = S.speed[0] / a.R;
    a.ang += a.dir * w * dt;
    const x = a.cx + Math.cos(a.ang) * a.R, z = a.cz + Math.sin(a.ang) * a.R;
    a.heading = Math.atan2(z - a.z, x - a.x); a.x = x; a.z = z;
    const g = W.ground(x, z); if (g != null) a.y += (g + a.alt + Math.sin(this.t * 0.05 + a.seed * 9) * 8 - a.y) * Math.min(1, dt * 0.3);
    const flap = Math.sin(this.t * 0.13 + a.seed * 31) > 0.93;
    a.mode = flap ? 3 : 7; a.phase += TAU * (BODY[a.key]?.hz || 2) * dt; a.pitch = 0;
  }
  // swifts and swallows: on the wing all day, sweeping round in long arcs, now and then a glide
  startAerial(a, f, seen) {
    const S = a.S, ang = this.rand() * TAU, r = seen ? S.draw * this.drawScale * 0.95 : 40 + this.rand() * 60;
    a.cx = a.x; a.cz = a.z;
    if (seen) { a.x = f.x + Math.cos(ang) * r; a.z = f.z + Math.sin(ang) * r; }   // in from far off
    a.alt = S.alt[0] + this.rand() * (S.alt[1] - S.alt[0]); a.state = 'wing'; a.turn = (this.rand() - 0.5) * 1.2;
    a.gy = this.W.ground(a.x, a.z) ?? f.y ?? 40; a.y = a.gy + a.alt;
  }
  aerial(a, dt, f) {
    const S = a.S;
    if (this.rand() < dt * 0.6) a.turn = (this.rand() - 0.5) * (a.key === 'swift' ? 1.6 : 2.4);
    const dx = a.cx - a.x, dz = a.cz - a.z;
    if (dx * dx + dz * dz > 60 * 60) a.heading = turnTo(a.heading, Math.atan2(dz, dx), dt * 1.5);
    else a.heading += a.turn * dt;
    const glide = Math.sin(this.t * 0.9 + a.seed * 17) > 0.3;
    this.fly2(a, S.speed[glide ? 1 : 0], dt);
    if ((a.id + this.frame) % 8 === 0) { const g = this.W.ground(a.x, a.z); if (g != null) a.gy = g; }
    a.y += (a.gy + a.alt + Math.sin(this.t * 0.7 + a.seed * 9) * (a.key === 'swift' ? 6 : 0.8) - a.y) * Math.min(1, dt * 2);
    a.mode = glide ? 7 : 3; a.phase += TAU * (BODY[a.key]?.hz || 8) * dt; a.pitch = 0;
    // the centre of their hunting drifts about the place (and away for good when leaving)
    if (a.leaving) { a.cx += Math.cos(a.seed * TAU) * 8 * dt; a.cz += Math.sin(a.seed * TAU) * 8 * dt; }
    else if (Math.hypot(a.cx - f.x, a.cz - f.z) > 120) { a.cx += (f.x - a.cx) * dt * 0.02; a.cz += (f.z - a.cz) * dt * 0.02; }
  }
  fly2(a, v, dt) { a.x += Math.cos(a.heading) * v * dt; a.z += Math.sin(a.heading) * v * dt; }
  startBat(a, s) {
    a.cx = a.x; a.cz = a.z; a.state = 'hawk'; a.alt = 3 + this.rand() * 4;
    const g = this.W.ground(a.x, a.z) ?? 0; a.y = g + a.alt; a.gy = g;
  }
  bat(a, dt) {
    // hawking insects: quick, jinking flight round a tree line or over the water
    a.mode = 3; a.phase += TAU * 9 * dt;
    if (this.rand() < dt * 3) a.heading += (this.rand() - 0.5) * 2.6;
    const dx = a.cx - a.x, dz = a.cz - a.z;
    if (dx * dx + dz * dz > 400) a.heading = turnTo(a.heading, Math.atan2(dz, dx), dt * 4);
    this.fly2(a, a.S.speed[0], dt);
    a.y = a.gy + a.alt + Math.sin(this.t * 3 + a.seed * 20) * 1.2;
    if (a.leaving) { a.cx += Math.cos(a.seed * TAU) * 6 * dt; a.cz += Math.sin(a.seed * TAU) * 6 * dt; }
  }

  // ---------------------------------------------------------------- the lakes' waterfowl
  waterfowl(a, dt) {
    const S = a.S;
    a.t -= dt; a.lift = 0; if (a.state !== 'dabble') a.pitch = 0;
    const th = this.threat(a, S.flee * 2);
    if (a.onLand) return this.goose(a, dt, th);
    a.swimming = true;
    if (th && th.d < S.flee * a.habit * 0.45 && !a.young && a.key !== 'swan' && a.key !== 'grebe' && a.key !== 'coot' && a.key !== 'moorhen' && a.state !== 'fleeSwim' && this.rand() < 0.5) {
      // up and away to another part of the lake
      const T = this.waterSpot(a, a.x, a.z, 40, 110, th);
      if (T) { const mates = a.group ? this.list.filter(b => b.group === a.group && !b.fl && Math.hypot(b.x - a.x, b.z - a.z) < 15) : [a]; for (const b of mates) { b.swimming = false; this.flyTo(b, T.x + (this.rand() - 0.5) * 5, T.y, T.z + (this.rand() - 0.5) * 5, 'swim'); } this.say(a, CALLS[a.key]?.call || 'quack', 1.2); return; }
    }
    if (th && th.d < S.flee * a.habit && a.state !== 'fleeSwim' && !(this.feeder && th.kind === 'player')) { a.state = 'fleeSwim'; a.target = this.waterSpot(a, a.x, a.z, 10, 30, th); a.t = 6; }
    // the young keep in a line behind their mother
    if (a.young && a.mother) {
      const m = a.mother;
      if (m.gone) { a.young = false; }
      else {
        // (a loose line, each one weaving a little)
        const k = a.youngIndex + 1, back = (0.6 + k * 0.35) * m.scale, side = Math.sin(this.t * 0.8 + k * 1.7) * 0.18 * k ** 0.5;
        const bx = m.x - Math.cos(m.heading) * back + Math.sin(m.heading) * side, bz = m.z - Math.sin(m.heading) * back - Math.cos(m.heading) * side;
        const d = Math.hypot(bx - a.x, bz - a.z);
        if (m.fl || m.onLand) { a.mode = 4; a.speed = 0; return; }
        this.walkTo(a, bx, bz, Math.min(1.6, d * 0.9), dt, 4); a.mode = 4; return;
      }
    }
    switch (a.state) {
      case 'swim': case 'idle': {
        a.mode = 4;
        if (!a.target || a.t <= 0) {
          const r = this.rand();
          a.t = 6 + this.rand() * 20;
          if (this.feeder && Math.hypot(this.feeder.x - a.x, this.feeder.z - a.z) < 45 && a.key !== 'grebe' && a.key !== 'tufted') { a.state = 'toFeeder'; break; }
          if ((S.grazes ? r < 0.12 : a.key === 'mallard' && r < 0.04) && !a.young) { const L = this.shore(a.x, a.z, 3, 18); if (L) { a.state = 'toShore'; a.target = L; a.t = 30; break; } }
          if ((a.key === 'tufted' || a.key === 'grebe' || a.key === 'coot') && r < 0.3 && !a.young) { a.state = 'dive'; a.t = 6 + this.rand() * (a.key === 'grebe' ? 25 : 12); a.hidden = true; break; }
          if (r < 0.35) { a.state = 'dabble'; a.t = 3 + this.rand() * 6; break; }
          if (r < 0.5) { a.state = 'rest'; a.t = 8 + this.rand() * 30; break; }
          a.target = this.waterSpot(a, a.x, a.z, 4, 20) || null;
        }
        if (a.target) { const d = this.walkTo(a, a.target.x, a.target.z, S.speed[0] * 0.6, dt, 1.2); if (d < 0.8 || a.stuck > 1) a.target = null; }
        break;
      }
      case 'dabble': a.mode = 4; a.speed = 0; a.pitch = a.key === 'mallard' || a.key === 'swan' || a.young ? -1.05 : -0.3; if (a.t <= 0) { a.state = 'swim'; a.t = 0; a.pitch = 0; } break;   // upended: head under, tail up
      case 'dive': {   // under water a while, coming up again a little way off
        a.mode = 4; this.move(a, 0.8, dt); a.hidden = true;
        if (a.t <= 0) { a.state = 'swim'; a.t = 2 + this.rand() * 5; a.hidden = false; }
        break;
      }
      case 'rest': a.mode = 4; a.speed = 0; a.look = Math.sin(this.t * 0.3 + a.seed * 9) * 1.2; if (a.t <= 0) { a.state = 'swim'; a.t = 0; } break;
      case 'fleeSwim': {
        a.mode = 4;
        if (a.target) this.walkTo(a, a.target.x, a.target.z, S.speed[1], dt, 3); else this.move(a, S.speed[1], dt);
        if (a.t <= 0) { a.state = 'swim'; a.t = 0; a.target = null; }
        break;
      }
      case 'toFeeder': {
        a.mode = 4;
        const F = this.feeder;
        if (!F) { a.state = 'swim'; a.t = 0; break; }
        if (!a.fspot || a.t <= 0) { a.fspot = this.waterSpot(a, F.x, F.z, 0.5, 4) || { x: F.x, z: F.z }; a.t = 6; }
        const d = this.walkTo(a, a.fspot.x, a.fspot.z, d2speed(Math.hypot(a.fspot.x - a.x, a.fspot.z - a.z), S.speed[0]), dt, 2.5);
        if (d < 1.2) { a.mode = this.rand() < 0.5 ? 1 : 4; a.look = Math.sin(this.t + a.seed * 7) * 0.5; if (this.rand() < dt * 0.25) this.say(a, CALLS[a.key]?.call || 'quack', 1); }
        break;
      }
      case 'toShore': {   // geese go up the bank to graze the grass
        a.mode = 4;
        const T = a.target; if (!T) { a.state = 'swim'; break; }
        const d = Math.hypot(T.x - a.x, T.z - a.z);
        a.heading = turnTo(a.heading, Math.atan2(T.z - a.z, T.x - a.x), dt * 2);
        const nx = a.x + Math.cos(a.heading) * S.speed[0] * 0.6 * dt, nz = a.z + Math.sin(a.heading) * S.speed[0] * 0.6 * dt;
        if (this.W.lc(nx, nz) !== LC.water) { a.onLand = true; a.swimming = false; a.state = 'graze'; a.t = 20 + this.rand() * 60; a.home2 = { x: a.x, z: a.z }; a.x = nx; a.z = nz; a.y = this.W.ground(nx, nz) ?? a.y; break; }
        a.x = nx; a.z = nz; a.phase += dt * 6;
        if (d < 0.5 || a.t <= 0) { a.state = 'swim'; a.t = 0; }
        break;
      }
      default: a.state = 'swim';
    }
    a.amp = 0;
  }
  goose(a, dt, th) {   // grazing the bank
    const S = a.S;
    a.swimming = false;
    if ((th && th.d < S.flee * a.habit) || a.t <= 0 || a.leaving) {
      // back to the water
      a.mode = 0;
      const T = a.home2 || { x: a.x, z: a.z }, sp = th ? S.speed[0] * 2 : S.speed[0];
      a.heading = turnTo(a.heading, Math.atan2(T.z - a.z, T.x - a.x), dt * 3);
      const nx = a.x + Math.cos(a.heading) * sp * dt, nz = a.z + Math.sin(a.heading) * sp * dt, lc = this.W.lc(nx, nz);
      if (lc === LC.water && this.W.water(nx, nz) != null) { a.x = nx; a.z = nz; a.onLand = false; a.swimming = true; a.state = 'swim'; a.t = 0; a.y = this.W.water(nx, nz); a.speed = 0; return; }
      if (lc != null && lc !== LC.building) { a.x = nx; a.z = nz; a.speed = sp; a.phase += sp * dt * 8; const g = this.W.ground(nx, nz, a.y); if (g != null) a.y = g; }
      else a.speed = 0;
      if (Math.hypot(T.x - a.x, T.z - a.z) < 0.4) { a.x = T.x; a.z = T.z; }
    } else {
      a.mode = Math.sin(this.t * 0.7 + a.seed * 13) > -0.4 ? 1 : 0;
      this.move(a, a.mode === 1 && Math.sin(this.t * 1.1 + a.seed * 7) > 0.5 ? S.speed[0] * 0.4 : 0, dt);
      if (this.rand() < dt * 0.2) a.heading += (this.rand() - 0.5) * 1.5;
    }
    this.gait(a, dt, a.speed > 0 ? 0.4 : 0);
  }
  waterSpot(a, x, z, r0, r1, away = null) {
    for (let k = 0; k < 10; k++) {
      let ang = this.rand() * TAU; if (away) ang = Math.atan2(z - away.z, x - away.x) + (this.rand() - 0.5) * 2;
      const r = r0 + this.rand() * (r1 - r0), tx = x + Math.cos(ang) * r, tz = z + Math.sin(ang) * r;
      if (this.W.lc(tx, tz) !== LC.water) continue;
      const l = this.W.water(tx, tz); if (l == null) continue;
      // keep off the very edge (the bank)
      let edge = false; for (let j = 0; j < 4 && !edge; j++) edge = this.W.lc(tx + Math.cos(j * 1.57) * 1.5, tz + Math.sin(j * 1.57) * 1.5) !== LC.water;
      if (edge && k < 7) continue;
      return { x: tx, y: l, z: tz };
    }
    return null;
  }

  // ---------------------------------------------------------------- places: herds, lakes, warrens, setts, rookeries
  // one 96 m cell's places, the same on every visit (decided by the land cover and a hash of the cell)
  cellSites(cx, cz) {
    const k = cx * 100003 + cz;
    if (this.cells.has(k)) return this.cells.get(k);
    const W = this.W, x0 = cx * CELL, z0 = cz * CELL, n = {}, pts = {};
    let missing = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = x0 + (i + 0.5) * 12, z = z0 + (j + 0.5) * 12, c = W.lc(x, z);
      if (c == null) { missing++; continue; }
      n[c] = (n[c] || 0) + 1; (pts[c] || (pts[c] = [])).push([x, z]);
    }
    if (missing > 8) return null;   // not loaded yet: try again later
    const sites = [], h = s => hash3(cx, cz, s), pick = (arr, s) => arr[Math.floor(h(s) * arr.length) % arr.length];
    const farm = n[LC.farm] || 0, water = n[LC.water] || 0, wood = n[LC.wood] || 0, pasture = n[LC.grass] || 0, grass = pasture + (n[LC.scrub] || 0) + (n[LC.park] || 0) + (n[LC.brownfield] || 0);
    const built = (n[LC.building] || 0) + (n[LC.road] || 0) + (n[LC.pavement] || 0);
    // a herd in its field: dairy and beef cattle, sheep, and horses in the paddocks at the edge of town. They
    // graze pasture (meadows and grassland), not the ploughed and sown fields (farmland is arable here)
    if (pasture >= 34 && built <= 2 && h(1) < 0.22) {
      // (the herd's middle well away from any road or house)
      const open = pts[LC.grass].filter(([x, z]) => { for (let k = 0; k < 8; k++) { const c = W.lc(x + Math.cos(k * 0.785) * 30, z + Math.sin(k * 0.785) * 30); if (c === LC.road || c === LC.building || c === LC.pavement || c === LC.garden) return false; } return true; });
      const c = open.length ? pick(open, 2) : null, r = h(3), edgeOfTown = built > 0 || (n[LC.garden] || 0) > 0;
      if (c) {
      const key = edgeOfTown ? (r < 0.5 ? 'horse' : r < 0.8 ? 'cow' : 'sheep') : (r < 0.58 ? 'cow' : r < 0.86 ? 'sheep' : 'horse');
      const S = SPECIES[key];
      sites.push({ kind: 'herd', key, x: c[0], z: c[1], n: S.group[0] + Math.floor(h(4) * (S.group[1] - S.group[0] + 1)), seed: k, spread: key === 'sheep' ? 30 : key === 'horse' ? 22 : 35, R: 70, draw: S.draw, beef: h(5) < 0.45, lc: LC.grass });
      }
    }
    // waterfowl on lakes, gravel pits and rivers; more and more kinds on the bigger waters
    if (water >= 6 && (water < 24 || h(9) < 0.6)) {
      const f = water / 64, big = f > 0.45, mid = f > 0.2;
      const flock = [];
      const add = (key, p, scale = 1) => { if (h(10 + flock.length * 3 + key.length) < p) { const S = SPECIES[key]; flock.push([key, Math.max(1, Math.round((S.group[0] + h(11 + key.length) * (S.group[1] - S.group[0])) * scale * 0.75))]); } };
      add('mallard', 0.95, mid ? 1 : 0.6); add('coot', mid ? 0.8 : 0.35); add('moorhen', mid ? 0.4 : 0.6); add('swan', mid ? 0.45 : 0.25);
      add('canada', mid ? 0.6 : 0.15, big ? 1 : 0.6); if (big) { add('grebe', 0.7); add('tufted', 0.6); add('greylag', 0.4); add('egyptian', 0.3); }
      else if (mid) { add('grebe', 0.3); add('tufted', 0.3); add('egyptian', 0.15); }
      if (flock.length) sites.push({ kind: 'lake', x: x0 + CELL / 2, z: z0 + CELL / 2, flock, seed: k, R: 60, draw: 220, pts: pts[LC.water] });
    }
    // a warren in rough grass, scrub or a field edge (rabbits), a sett in the woods (badgers)
    if (grass + farm >= 14 && built < 10 && h(20) < 0.32) {
      const opts = [...(pts[LC.grass] || []), ...(pts[LC.scrub] || []), ...(pts[LC.brownfield] || []), ...(pts[LC.park] || [])];
      if (opts.length) { const c = pick(opts, 21); sites.push({ kind: 'warren', key: 'rabbit', x: c[0], z: c[1], n: 3 + Math.floor(h(22) * 6), seed: k + 1, R: 25, draw: 95, burrow: true }); }
    }
    if (wood >= 12 && h(30) < 0.3) {
      const c = pick(pts[LC.wood], 31);
      sites.push({ kind: 'sett', key: 'badger', x: c[0], z: c[1], n: 1 + Math.floor(h(32) * 3), seed: k + 2, R: 140, draw: 110, burrow: true });
    }
    this.cells.set(k, sites);
    if (this.cells.size > 6000) this.cells.delete(this.cells.keys().next().value);
    return sites;
  }
  sitesNear(f) {
    const r = 330 * this.drawScale, c0x = Math.floor((f.x - r) / CELL), c1x = Math.floor((f.x + r) / CELL), c0z = Math.floor((f.z - r) / CELL), c1z = Math.floor((f.z + r) / CELL);
    const want = new Set();
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const sites = this.cellSites(cx, cz); if (!sites) continue;
      for (const s of sites) if (Math.hypot(s.x - f.x, s.z - f.z) < s.draw * this.drawScale + s.R) want.add(s);
    }
    // rookeries: tall trees by the fields, found from the trees near the player
    for (const s of this.rookeries(f)) want.add(s);
    for (const s of [...this.live.keys()]) if (!want.has(s)) this.closeSite(s);
    // open the nearest one not yet open, if the places' animals are within their budget (or it is nearer
    // than the farthest open one, which then closes)
    let best = null, bd = 1e9;
    for (const s of want) if (!this.live.has(s)) { const d = Math.hypot(s.x - f.x, s.z - f.z); if (d < bd) { bd = d; best = s; } }
    if (best) {
      if (this.siteN + (best.n || 12) > this.siteMax) {
        let worst = null, wd = -1;
        for (const s of this.live.keys()) { const d = Math.hypot(s.x - f.x, s.z - f.z); if (d > wd) { wd = d; worst = s; } }
        if (worst && wd > bd + 40) { this.closeSite(worst); this.openSite(best, f); }
      } else this.openSite(best, f);
    }
  }
  rookeries(f) {
    const out = [];
    for (let cx = Math.floor((f.x - 200) / CELL); cx <= Math.floor((f.x + 200) / CELL); cx++) for (let cz = Math.floor((f.z - 200) / CELL); cz <= Math.floor((f.z + 200) / CELL); cz++) {
      const k = 'r' + (cx * 100003 + cz);
      let s = this.cells.get(k);
      if (s === undefined) {
        s = null;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        if (this.W.lc(x, z) == null || !this.W.treesLoaded(x, z)) continue;   // not loaded yet
        const trees = this.W.trees(x, z, 48), tall = trees.filter(t => t[2] >= 12);
        if (tall.length >= 4 && hash3(cx, cz, 77) < 0.35) {
          const key = this.quickKey(x, z, 0.1);
          if (key === 'farm' || key === 'meadow' || key === 'park') { const T = tall.slice(0, 8); s = { kind: 'rookery', key: 'rook', x: T[0][0], z: T[0][1], trees: T, n: 6 + Math.floor(hash3(cx, cz, 78) * 10), seed: cx * 7 + cz, R: 150, draw: 150 }; }
        }
        this.cells.set(k, s);
      }
      if (s && Math.hypot(s.x - f.x, s.z - f.z) < s.draw * this.drawScale + 30) out.push(s);
    }
    return out;
  }
  openSite(s, f) {
    const W = this.W, R = mulberry((s.seed * 2654435761) >>> 0), animals = [];
    const at = (cx, cz, r, test) => { for (let k = 0; k < 24; k++) { const x = cx + (R() - 0.5) * 2 * r, z = cz + (R() - 0.5) * 2 * r; if (test(x, z)) return [x, z]; } return null; };
    if (s.kind === 'herd') {
      const S = SPECIES[s.key], young = YOUNG[s.key] && isYoungSeason(s.key, this.month) && (!YOUNG[s.key].beef || s.beef);
      const field = { x: s.x, z: s.z, r2: s.R * s.R, lc: s.lc ?? LC.farm };
      // (cows and horses graze steadily as you pass; the herd's centre wanders slowly round the field)
      s.cx = s.x; s.cz = s.z;
      const rug = s.key === 'horse' && (this.month >= 9 || this.month <= 2 ? R() < 0.7 : R() < 0.15);
      for (let i = 0; i < s.n; i++) {
        const p = at(s.x, s.z, s.spread, (x, z) => W.lc(x, z) === field.lc); if (!p) continue;
        const a = this.make(s.key, p[0], W.ground(p[0], p[1]) ?? 0, p[1], { site: s, home: { x: s.x, z: s.z }, habit: 1 });
        a.field = field; a.state = 'graze'; a.t = R() * 20; a.curious = R() < 0.5; a.rug = rug && R() < 0.85; a.coat = Math.floor(R() * 8);
        a.heading = R() * TAU; animals.push(a);
        if (young && R() < YOUNG[s.key].share) {
          const q = at(p[0], p[1], 3, (x, z) => W.lc(x, z) === field.lc);
          if (q) { const b = this.make(s.key, q[0], W.ground(q[0], q[1]) ?? 0, q[1], { site: s, scale: YOUNG[s.key].scale, habit: 1 }); b.field = field; b.young = true; b.mother = a; b.state = 'graze'; b.t = R() * 10; b.coat = a.coat; animals.push(b); }
        }
      }
    } else if (s.kind === 'lake') {
      const water = (x, z) => W.lc(x, z) === LC.water && W.water(x, z) != null;
      for (const [key, n] of s.flock) {
        const S = SPECIES[key], c = s.pts[Math.floor(R() * s.pts.length)], group = this.nextGroup++, Y = YOUNG[key];
        for (let i = 0; i < n; i++) {
          const p = at(c[0], c[1], 6 + n * 1.5, water); if (!p) continue;
          const a = this.make(key, p[0], W.water(p[0], p[1]), p[1], { site: s, group, habit: 0.55 + 0.45 * Math.exp(-W.busy(p[0], p[1]) / 20) });
          a.swimming = true; a.state = 'swim'; a.t = R() * 10; animals.push(a);
          // the young: ducklings, cygnets, goslings and coot chicks behind their mother in early summer
          if (Y && isYoungSeason(key, this.month) && i === 0 && R() < Y.p) {
            const m = Y.n[0] + Math.floor(R() * (Y.n[1] - Y.n[0] + 1));
            if (key === 'mallard') a.coat = 1;   // the duck raises the brood (the brown one), not the drake
            for (let j = 0; j < m; j++) { const b = this.make(key, p[0] - Math.cos(a.heading) * (j + 1) * 0.4, a.y, p[1] - Math.sin(a.heading) * (j + 1) * 0.4, { site: s, scale: Y.scale, group }); b.young = true; b.mother = a; b.youngIndex = j; b.coat = Y.coat; b.swimming = true; b.state = 'swim'; animals.push(b); }
          }
        }
      }
      // a heron fishing from the bank at dawn and dusk; black-headed gulls over the bigger waters
      if (R() < 0.35 + active('dawnDusk', this.hour) * 0.4) {
        const p = this.shore(s.x, s.z, 5, 45); if (p) { const a = this.make('heron', p.x, W.ground(p.x, p.z) ?? 0, p.z, { site: s, habit: 1 }); a.state = 'wade'; a.t = 10 + R() * 30; animals.push(a); }
      }
    } else if (s.kind === 'warren' || s.kind === 'sett') {
      s.burrowY = W.ground(s.x, s.z);
      for (let i = 0; i < s.n; i++) { const a = this.make(s.key, s.x, s.burrowY ?? 0, s.z, { site: s, home: { x: s.x, z: s.z }, range: s.R, habit: 1 }); a.state = 'under'; a.hidden = true; a.t = 2 + R() * 30; animals.push(a); }
    } else if (s.kind === 'rookery') {
      s.nests = [];
      for (const t of s.trees) { const m = 2 + Math.floor(R() * 4); for (let j = 0; j < m; j++) { const P = this.perchPoint(t, 0.15 + R() * 0.4, R()); s.nests.push({ x: P.x, y: P.y - 0.15, z: P.z, model: 'nest', seed: R(), heading: R() * TAU }); } }
      for (let i = 0; i < s.n; i++) {
        const t = s.trees[Math.floor(R() * s.trees.length)], P = this.perchPoint(t, R(), R());
        const a = this.make('rook', P.x, P.y, P.z, { site: s, group: s.group || (s.group = this.nextGroup++), habit: 1 }); a.state = 'perch'; a.t = R() * 30; animals.push(a);
      }
    }
    this.live.set(s, animals);
  }
  closeSite(s) { for (const a of this.live.get(s) || []) a.gone = true; this.live.delete(s); }
  runSite(s, animals, dt, f) {
    if (s.kind === 'herd') {   // the grazing front moves slowly across the field
      if (!s.drift || this.rand() < dt / 120) s.drift = this.spot({ S: SPECIES[s.key], key: s.key, field: { x: s.x, z: s.z, r2: s.R * s.R, lc: s.lc ?? LC.farm }, home: s, range: 0, urban: 0 }, s.x, s.z, 0, s.R * 0.6) || { x: s.x, z: s.z };
      s.cx += (s.drift.x - s.cx) * dt * 0.01; s.cz += (s.drift.z - s.cz) * dt * 0.01;
    }
    if (s.kind === 'warren' || s.kind === 'sett') {
      // out at dawn and dusk (rabbits; in quiet places by day too) or after dark (badgers), back underground otherwise
      const S = SPECIES[s.key], out = active(S.act, this.hour) * (s.kind === 'warren' ? (0.35 + 0.65 * Math.exp(-this.W.busy(s.x, s.z) / 6)) : 1);
      const near = this.threat({ x: s.x, z: s.z, key: s.key }, 30);
      for (const a of animals) {
        if (a.state === 'under') {
          if (a.t > 0) { a.t -= dt; continue; }
          a.t = 5 + this.rand() * 20;
          if (out > 0.35 && (!near || near.d > S.flee * 1.3) && this.rand() < out) { a.state = 'idle'; a.hidden = false; a.t = 2 + this.rand() * 4; a.x = s.x; a.z = s.z; a.y = s.burrowY ?? a.y; a.heading = this.rand() * TAU; }
        } else if (out < 0.2 && !a.toBurrow && a.state !== 'flee') { a.state = 'flee'; a.target = { x: s.x, z: s.z }; a.toBurrow = true; a.t = 60; }
      }
    }
    if (s.kind === 'rookery') {   // to the fields and back, cawing
      for (const a of animals) if (a.state === 'perch' && a.t <= 0 && !a.fl) {
        a.t = 10 + this.rand() * 40;
        if (this.rand() < 0.35) { const T = this.spot(a, s.x, s.z, 30, 140); if (T) this.flyTo(a, T.x, this.W.ground(T.x, T.z) ?? a.y, T.z, 'peck'); }
      } else if (a.state === 'peck' && a.t <= 0 && this.rand() < 0.3) { const t = s.trees[Math.floor(this.rand() * s.trees.length)], P = this.perchPoint(t, this.rand(), this.rand()); this.flyTo(a, P.x, P.y, P.z, 'perch'); }
    }
  }
  underground(a, dt) {
    a.hidden = true; a.speed = 0;
    if (a.leaving) a.gone = true;
  }

  // ---------------------------------------------------------------- nests in the trees
  nestsNear(f) {
    const W = this.W, out = [];
    const trees = W.trees(f.x, f.z, 70);
    const seen = new Set();
    for (const t of trees) {
      const k = Math.round(t[0] * 10) * 100003 + Math.round(t[1] * 10), r = hash3(Math.round(t[0] * 10), Math.round(t[1] * 10), 5);
      const p = t[2] >= 12 ? 0.07 : t[2] >= 8 ? 0.05 : 0.035;
      if (r >= p) continue;
      seen.add(k);
      let n = this.nestSites.get(k);
      if (!n) {
        const key = this.quickKey(t[0], t[1], 0.5), r2 = hash3(Math.round(t[0] * 10), Math.round(t[1] * 10), 6);
        const sp = t[2] < 8 ? (r2 < 0.6 ? 'blackbird' : 'robin') : key === 'farm' || key === 'meadow' ? (r2 < 0.6 ? 'crow' : 'woodpigeon') : key === 'garden' ? (r2 < 0.5 ? 'woodpigeon' : r2 < 0.8 ? 'magpie' : 'blackbird') : r2 < 0.45 ? 'woodpigeon' : r2 < 0.75 ? 'magpie' : 'crow';
        const small = sp === 'blackbird' || sp === 'robin';
        const P = this.perchPoint(t, small ? 0.55 : 0.35, hash3(k, 1, 9));
        n = { x: P.x, y: P.y - (small ? 0.35 : 0.25), z: P.z, model: small ? 'nestSmall' : 'nest', seed: r2, heading: r2 * TAU, sp, birds: [] };
        this.nestSites.set(k, n);
      }
      out.push(n);
      // the pair: one sits tight on the eggs, the other comes and goes with food (spring and early summer)
      const breeding = this.month >= 2 && this.month <= 6, day = active('day', this.hour) > 0.3;
      n.birds = n.birds.filter(b => !b.gone);
      if (breeding && !n.birds.length && Math.hypot(n.x - f.x, n.z - f.z) < Math.min(55, SPECIES[n.sp].draw * 0.9 * this.drawScale)) {
        const a = this.make(n.sp, n.x, n.y + 0.05, n.z, { habit: 1, life: 1e9 }); a.state = 'nest'; a.nestAt = { x: n.x, y: n.y + 0.05, z: n.z }; a.heading = n.heading; a.nest = n; a.sitter = true; n.birds.push(a);
        if (day) { const b = this.make(n.sp, n.x, n.y, n.z, { habit: 1, life: 1e9 }); b.nest = n; b.nestAt = a.nestAt; b.state = 'nest'; b.t = 3 + this.rand() * 8; b.x += 0.15; n.birds.push(b); }
      }
    }
    for (const [k, n] of this.nestSites) if (!seen.has(k)) { for (const b of n.birds) b.gone = true; n.gone = true; this.nestSites.delete(k); }
    for (const s of this.live.keys()) if (s.kind === 'rookery' && s.nests) out.push(...s.nests);
    this.nests = out;
  }
  onNest(a, dt) {
    a.mode = 6; a.speed = 0; a.amp = 0; a.look = Math.sin(this.t * 0.5 + a.seed * 9) * 0.9;
    const th = this.threat(a, 6);
    if (th && th.d < 3) { this.takeOff(a, th, false); return; }
    if (a.sitter) return;
    // the partner: off to forage and back with food
    if (a.t <= 0) {
      a.t = 10 + this.rand() * 25;
      const T = this.spot(a, a.x, a.z, 10, 35);
      if (T) { a.state = 'peck'; this.flyTo(a, T.x, this.W.ground(T.x, T.z) ?? a.y, T.z, 'peck'); a.back = this.t + 15 + this.rand() * 20; }
    }
  }

  // ---------------------------------------------------------------- dogs out for a walk with their people
  attachDog(p, offLead, r) {
    const a = this.make('dog', p.x - Math.cos(p.heading || 0), p.y || 0, p.z - Math.sin(p.heading || 0), { habit: 1, life: 1e9 });
    a.owner = p; a.state = 'heel'; a.offLead = offLead; a.t = 2;
    a.breed = hash3(r * 1e6 | 0, 5, 5); a.side = 1;
    this.roam++; this.dogs.set(p.id, a);
    return a;
  }
  dogWalkers(f) {
    const W = this.W, peds = W.peds();
    const live = new Set();
    const nearbyDog = this.list.some(a => a.owner && !a.gone && Math.hypot(a.x-f.x,a.z-f.z)<75);
    let localWalk = nearbyDog;
    for (const p of peds) {
      if (!p.id || p.officer || p.gone) continue;
      live.add(p.id);
      if (this.dogs.has(p.id)) continue;
      // decided once per person, when first met out of sight (or stepping out of their front door, as people
      // do with the dog): more in the morning and evening, in parks and residential streets, fewer in the town
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (p.alpha !== 0 && p.mode !== 'fromDoor' && d < SPECIES.dog.draw * 0.85 * this.drawScale + 6 && W.visible(p.x, (p.y || 0) + 1, p.z, 4)) continue;
      const key = this.quickKey(p.x, p.z, 0.5), busy = W.busy(p.x, p.z);
      const place = key === 'park' || key === 'meadow' || key === 'shore' ? 1.8 : busy > 30 ? 0.25 : 1;
      const walks = active('walks', this.clockH);
      const localCandidate = !localWalk && d < 75 && busy < 30 && walks > .25;
      const prob = Math.min(1,(0.04 + 0.22 * walks) * place + (localCandidate ? .45 : 0));
      const r = hash3(String(p.id).split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7) | 0, 3, 1);
      if (this.roam >= this.max) continue;
      if (r >= prob) { this.dogs.set(p.id, null); continue; }
      const a = this.attachDog(p, (key === 'park' || key === 'meadow') && r < prob * 0.45, r);
      if (d < 75) localWalk = true;
      // a second dog now and then
      if (this.roam < this.max && r < prob * 0.12) { this.roam++; const b = this.make('dog', a.x, a.y, a.z, { habit: 1, life: 1e9 }); b.owner = p; b.state = 'heel'; b.offLead = a.offLead; b.t = 3; b.breed = hash3(r * 1e6 | 0, 6, 6); b.side = -1; }
    }
    for (const [id, a] of this.dogs) if (!live.has(id)) { if (a) a.gone = true; this.dogs.delete(id); }
    for (const a of this.list) if (a.key === 'dog' && (a.owner.gone || !live.has(a.owner.id))) a.gone = true;
  }
  dog(a, dt) {
    const o = a.owner, W = this.W;
    if (!o || o.gone) { a.gone = true; return; }
    a.t -= dt; a.look *= 0.95; a.pitch = 0; a.lift = 0;
    const oh = o.heading || 0, osp = o.speedNow ?? (o.mode === 'walk' ? o.speed || 1.3 : 0);
    const fx = Math.cos(oh), fz = Math.sin(oh), lx = Math.sin(oh), lz = -Math.cos(oh);
    const lead = 1.9;
    // something to chase (squirrels, pigeons, a cat) when off the lead
    if (a.offLead && !a.chase && this.rand() < dt * 0.2) for (const b of this.list) if (b !== a && DOG_SCARES.has(b.key) && !b.fl && !b.hidden && b.key !== 'dog' && Math.hypot(b.x - a.x, b.z - a.z) < 15) { a.chase = b; a.state = 'chase'; a.t = 4 + this.rand() * 3; this.say(a, 'bark', 1); break; }
    const ownerStill = osp < 0.2;
    switch (a.state) {
      case 'heel': default: {
        // on the left, a little ahead, by its person
        let tx = o.x + fx * 0.55 + lx * 0.75 * a.side, tz = o.z + fz * 0.55 + lz * 0.75 * a.side;
        if (W.lc(tx, tz) === LC.building) { a.side = -a.side; tx = o.x + fx * 0.55 + lx * 0.75 * a.side; tz = o.z + fz * 0.55 + lz * 0.75 * a.side; }
        if (a.offLead) { a.state = 'roam'; a.t = 0; break; }
        const d = Math.hypot(tx - a.x, tz - a.z);
        const sp = clamp(osp + (d - 0.3) * 2.2, 0, a.S.speed[1]);
        a.heading = turnTo(a.heading, d > 0.25 ? Math.atan2(tz - a.z, tx - a.x) : oh, dt * 6);
        this.dogMove(a, sp, dt);
        a.mode = 0;
        if (ownerStill && a.t <= 0) { a.state = this.rand() < 0.6 ? 'sit' : 'sniff'; a.t = 3 + this.rand() * 6; }
        else if (!ownerStill && a.t <= 0 && this.rand() < 0.35) { a.state = 'sniff'; a.t = 1.5 + this.rand() * 3; }
        else if (a.t <= 0) a.t = 2 + this.rand() * 4;
        break;
      }
      case 'sniff': {   // nose to the ground until the lead goes tight
        a.mode = 1; this.dogMove(a, 0, dt);
        const d = Math.hypot(o.x - a.x, o.z - a.z);
        if (d > lead || a.t <= 0) { a.state = 'heel'; a.t = 3 + this.rand() * 5; }
        break;
      }
      case 'sit': {
        a.mode = 2; a.drop = BODY.dog.leg * 0.6; this.dogMove(a, 0, dt);
        a.look = clamp(wrap(Math.atan2(o.z - a.z, o.x - a.x) - a.heading), -1, 1);
        if (!ownerStill || a.t <= 0) { a.state = 'heel'; a.t = 2; a.drop = 0; }
        break;
      }
      case 'roam': {   // off the lead in the park: out and back, nose down, never far
        a.mode = 0;
        if (!a.target || a.t <= 0) {
          a.t = 3 + this.rand() * 6;
          const r = this.rand();
          a.target = r < 0.25 ? { x: o.x + lx * 1.2, z: o.z + lz * 1.2 } : { x: o.x + fx * 6 + (this.rand() - 0.5) * 24, z: o.z + fz * 6 + (this.rand() - 0.5) * 24 };
          a.run = this.rand() < 0.45;
        }
        const d = Math.hypot(a.target.x - a.x, a.target.z - a.z), far = Math.hypot(o.x - a.x, o.z - a.z);
        if (far > 25) { a.target = { x: o.x, z: o.z }; a.run = true; }
        if (d < 1) { a.mode = 1; this.dogMove(a, 0, dt); }
        else { a.heading = turnTo(a.heading, Math.atan2(a.target.z - a.z, a.target.x - a.x), dt * 5); this.dogMove(a, a.run ? a.S.speed[1] * 0.8 : a.S.speed[0] * 1.2, dt); }
        break;
      }
      case 'chase': {
        const b = a.chase;
        if (!b || b.gone || b.fl || b.hidden || a.t <= 0 || Math.hypot(o.x - a.x, o.z - a.z) > 35) { a.chase = null; a.state = a.offLead ? 'roam' : 'heel'; a.target = null; break; }
        a.heading = turnTo(a.heading, Math.atan2(b.z - a.z, b.x - a.x), dt * 6); this.dogMove(a, a.S.speed[1], dt); a.mode = 0;
        break;
      }
    }
    if (a.state !== 'sit') a.drop = 0;
    this.gait(a, dt);
    a.wag = a.state === 'sit' ? 0.5 : 1;
  }
  dogMove(a, sp, dt) {   // dogs go where their people go (roads at crossings included), never into buildings or water
    if (sp <= 0) { a.speed = 0; return; }
    const nx = a.x + Math.cos(a.heading) * sp * dt, nz = a.z + Math.sin(a.heading) * sp * dt, lc = this.W.lc(nx, nz);
    if (lc == null || lc === LC.building || lc === LC.water) { a.speed = 0; a.x += (a.owner.x - a.x) * Math.min(1, dt * 2); a.z += (a.owner.z - a.z) * Math.min(1, dt * 2); return; }
    a.x = nx; a.z = nz; a.speed = sp;
    const g = this.W.ground(nx, nz, a.owner.y ?? a.y); if (g != null) a.y = g;
    a.phase += sp * dt * TAU / (BODY.dog.leg * a.scale * 2.6);
  }

  // ---------------------------------------------------------------- calls
  say(a, call, gain = 1) { this.calls.push({ call, x: a.x, y: a.y, z: a.z, gain, key: a.key, size: a.scale }); }
  voice(a, dt, d) {
    if (a.hidden || d > 110) return;
    const C = CALLS[a.key]; if (!C) return;
    let rate = C.rate / 60;
    if (C.act) rate *= active(C.act, this.hour) * 1.6;
    if (!C.night && active('night', this.hour) > 0.6) rate *= 0.05;
    if (a.key === 'robin' && active('night', this.hour) > 0.6) rate *= 0.15;   // robins sing under the street lights
    if (a.key === 'fox' && (this.month > 1 && this.month < 11)) rate *= 0.3;   // the screaming is a winter thing
    if (a.key === 'dog' && a.state !== 'chase' && a.state !== 'roam') rate *= 0.4;
    if (a.young) rate *= 0.3;
    if (this.rand() < rate * dt) this.say(a, C.call, 1);
  }
}
const d2speed = (d, v) => clamp(d * 0.6, 0.2, v * 1.4);
