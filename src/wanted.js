// The police after you, at the level of GTA V's wanted system (Thames Valley-flavoured).
//
// What brings them: only killing someone. Gunfire, a fight, a robbery, a nicked car or a knock with the car doesn't.
// A killing seen by an officer or a police car puts them straight on to you; one seen by the public is phoned in
// (999) a few seconds later and they come to where it happened. Stars: one for a killing and one more for each after
// (two for an officer); shooting at the police adds one. Up to four stars they're out to stop you, not kill you:
// Tasers, stingers, the PIT and boxing you in. At five they bring in everything, and armed response: guns.
//
// Seen and searching: while a car crew or an officer can see you (a clear line, within about 110 m from a car and
// 75 m on foot), they know where you are and come for you. Out of sight for a few seconds, the stars flash and they
// search round where you were last seen (the circle on the minimap). Get outside the circle and stay unseen for a
// while, and they lose you. Indoors you're out of sight.
//
// The cars work as a team, the way British traffic units run a pursuit (plan(), TPAC: tactical pursuit and
// containment). Far off they come by the roads on blue lights, heading for where you're going rather than where you
// are. Close in, each is driven through the same car physics as yours (carPhysics.js, `driven`) by a pursuit driver
// with a role: the lead car follows at a safe distance (more the faster you go) with a second behind it; they ease
// off for traffic in their way rather than plough through it. Given a straight run at moderate speed and three cars,
// they contain you: one gets in front and slows, bringing you down with it (a rolling block), one closes up behind
// and the others come up alongside, until you're boxed in and stop and the crews get out. Tactical contact (the
// PIT: alongside your back wheel, then turning in) only from three stars, ramming only from four. From two stars a
// crew lays a stinger (spike strip) ahead: it lies at the kerb by their car and is pulled across as you come, and
// back once you're past; from four, roadblocks of two cars across the road.
//
// On foot: the officers get out and come for you with Tasers (you drop for a few seconds and they cuff you). At five
// stars it's armed response officers (dark kit, caps), who stand and shoot: at you, or at your car and through the
// windows. Stop, get Tasered, give yourself up (Triangle / Use) or get boxed in and they arrest you: BUSTED, out at
// the nearest police station with a fine.
// Your health (the bar by the minimap) comes back slowly once they stop hitting you; at nothing you're WASTED and
// wake at the hospital with a bill.
import * as THREE from 'three/webgpu';
import { People } from './characters.js';
import { cash } from './food.js';

const STATIONS = [['Reading police station', -7804, -2221], ['Loddon Valley police station', -4205, 932], ['Wokingham police station', 2183, 2325], ['Bracknell police station', 8301, 1991]];
const HOSPITALS = [['the Royal Berkshire Hospital', -6540, -1816], ['Wokingham Hospital', 1410, 2771]];
const SEE_CAR = 110, SEE_FOOT = 75;      // how far a car crew / an officer on foot sees you, with a clear line (m)
const DRIVE_R = 75, ROAD_R = 220;        // closer than this (with a clear line) a car drives straight at you; further, back to the roads
const CARS = [0, 1, 2, 3, 4, 7];         // cars in the operation, by stars (five: everything they've got)
const JOBS = ['pit', 'block', 'tail', 'pit', 'ram', 'block'];
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Wanted {
  constructor(G, camInfo) {
    this.G = G; this.cam = camInfo;
    this.level = 0; this.phase = 'none';       // phase: none | active (they can see you) | search (they can't)
    this.units = []; this.foot = [];            // the cars in the operation; officers out on foot
    this.last = { x: 0, z: 0 }; this.unseen = 0; this.searchT = 0; this.evade = 0; this.t = 0;
    this.reports = [];                          // 999 calls on their way in
    this.hold = null;                           // stun | surrender | busted | wasted (player.js waits while it runs)
    this.hitFlash = 0; this.lastHurt = -99; this.shotAtPolice = false; this.seeT = 0; this.seen = false;
    this.spawnT = 0; this.blockT = 30; this.fx = [];
    G.events.on('pedKilled', e => this.onKill(e));
    // shooting at the police: one more star (not more than one every ten seconds)
    G.events.on('copShot', () => { if (this.level && this.level < 5 && G.time - (this.copShotAt ?? -99) > 10) { this.copShotAt = G.time; this.setLevel(this.level + 1, 'Shots fired at police'); } });
  }
  get active() { return this.level > 0; }
  // ---------------------------------------------------------------- crimes
  onKill({ p, by }) {
    if (by !== 'player') return;
    const G = this.G, me = G.brothers.me, cop = !!p.officer;
    const next = this.level + (cop ? 2 : 1);
    const what = cop ? 'an officer has been killed' : 'a killing';
    // already after you: it goes straight on; a police car or an officer saw it: straight on to you
    if (this.level || this.policeSee(p.x, p.y + 1, p.z) || this.policeSee(me.x, me.y + 1.5, me.z)) {
      this.setLevel(next, `Police: ${what} — they’re on to you`);
      this.spotted(me);
      return;
    }
    // the public: someone who saw it rings 999
    const w = G.peds.near(p.x, p.z, 55).filter(q => q !== p && !q.dead && !q.officer);
    if (!w.length) { G.hud.feed('Nobody saw that.'); return; }
    const caller = w[Math.floor(Math.random() * w.length)];
    caller.reactT = 0; caller.phoneT = 10;
    this.reports.push({ at: G.time + 6 + Math.random() * 6, x: p.x, z: p.z, level: next, road: G.roadName(p.x, p.z) });
    G.hud.feed('A witness is calling 999…');
  }
  setLevel(n, msg) {
    n = clamp(n, 0, 5); if (n <= this.level) return;
    const was = this.level; this.level = n;
    if (!was) { this.phase = 'search'; this.searchT = 0; this.unseen = 99; this.evade = 0; this.spawnT = 0; }
    if (msg) this.G.hud.banner(`${'★'.repeat(n)} ${msg}`, 'pursuit', 5);
    this.G.haptics?.rumble?.(0.6, 0.5, 260);
  }
  spotted(me) {
    this.last.x = me.x; this.last.z = me.z; this.unseen = 0; this.evade = 0;
    if (this.phase !== 'active') { this.phase = 'active'; this.searchT = 0; }
  }
  // the circle they search when they've lost sight of you (m)
  searchR() { return 90 + this.level * 45; }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G, B = G.brothers, me = B.me, car = B.vehicleOf(me);
    this.t += dt;
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i]; if (G.time < r.at) continue;
      this.reports.splice(i, 1);
      const first = !this.level;
      this.setLevel(Math.max(r.level, this.level + (first ? 0 : 1)), `999 call: ${r.road ? 'a killing on ' + r.road : 'a killing'} — police on the way`);
      if (first) { this.last.x = r.x; this.last.z = r.z; this.phase = 'search'; this.searchT = 0; this.unseen = 99; }
    }
    this.health(dt, me);
    if (this.hold) this.holdStep(dt, me, car);
    this.effects(dt);
    if (!this.level) { this.sync(); return; }
    // who can see you (every quarter of a second: the lines of sight are marched through the town)
    if ((this.seeT -= dt) <= 0) { this.seeT = 0.25; this.seen = !me.inside && this.seesPlayer(me, car); }
    if (this.seen) this.spotted(me);
    else {
      this.unseen += dt;
      if (this.phase === 'active' && this.unseen > 4) { this.phase = 'search'; this.searchT = 0; this.searchSeq = (this.searchSeq || 0) + 1; this.G.hud.banner(`${'★'.repeat(this.level)} Out of sight — get away from the area`, 'pursuit', 4); }
    }
    if (this.phase === 'search') {
      this.searchT += dt;
      const out = Math.hypot(me.x - this.last.x, me.z - this.last.z) > this.searchR();
      this.evade = out || me.inside ? this.evade + dt : Math.max(0, this.evade - dt * 0.5);
      if (this.evade > 6 + this.level * 3 || this.searchT > 100 + this.level * 25) { this.clear(this.searchT > 100 + this.level * 25 ? 'The police called off the search.' : 'You lost the police.'); return; }
    }
    if (!this.hold || this.hold.kind === 'stun' || this.hold.kind === 'surrender') {
      this.bringIn(dt, me, car);
      const T = this.targetOf(me, car);
      this.watch(dt, T); if ((this.planT = (this.planT || 0) - dt) <= 0) { this.planT = 0.5; this.plan(T); }
      for (const u of this.units.slice()) this.unit(u, dt, T, me, car);
      for (const o of this.foot.slice()) this.officer(o, dt, T, me, car);
      this.stingers(dt, T, car);
      this.arrest(dt, me, car);
    }
    this.sync();
  }
  // the old police.player record other code reads (the HUD's Give up, the DualSense lightbar)
  sync() {
    const P = this.G.police?.player; if (!P) return;
    P.level = this.level; P.state = !this.level ? 'none' : this.phase === 'active' ? 'pursuit' : 'search';
  }
  // ---------------------------------------------------------------- seeing
  // a clear line between two points (the town's buildings in the way)
  los(ax, ay, az, bx, by, bz) {
    const G = this.G, dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    for (let t = 2; t < L - 1.5; t += 2.5) {
      const x = ax + dx / L * t, y = ay + dy / L * t, z = az + dz / L * t;
      if (G.tiles.insideBuilding(x, z, y)) return false;
    }
    return true;
  }
  policeSee(x, y, z) {
    const G = this.G;
    for (const v of G.police.units) { if (v.dead || v.hidden) continue; const d = Math.hypot(v.x - x, v.z - z); if (d < SEE_CAR && this.los(v.x, v.y + 1.4, v.z, x, y, z)) return v; }
    for (const o of G.police.officers.concat(this.foot)) { if (o.dead || o.gone) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < SEE_FOOT && this.los(o.x, o.y + 1.6, o.z, x, y, z)) return o; }
    return null;
  }
  seesPlayer(me, car) {
    const y = car ? car.y + 1.1 : me.y + 1.5, x = car ? car.x : me.x, z = car ? car.z : me.z;
    for (const v of this.units) { if (v.dead) continue; const d = Math.hypot(v.x - x, v.z - z); if (d < 18 || d < SEE_CAR && this.los(v.x, v.y + 1.4, v.z, x, y, z)) return true; }
    for (const o of this.foot) { if (o.dead || o.gone) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < 8 || d < SEE_FOOT && this.los(o.x, o.y + 1.6, o.z, x, y, z)) return true; }
    // any other patrol that sees you joins in
    const w = this.policeSee(x, y, z);
    if (w && w.def && w.status === 'patrol') this.recruit(w);
    return !!w;
  }
  // ---------------------------------------------------------------- the cars
  targetOf(me, car) {
    const B = this.G.brothers;
    if (car) { const ph = car.ph, sp = Math.abs(car.sp || 0); return { x: car.x, z: car.z, y: car.y, vx: ph ? ph.vx : Math.cos(car.heading) * sp, vz: ph ? ph.vz : Math.sin(car.heading) * sp, h: car.heading, sp, car, L: car.def.L, W: car.def.W }; }
    return { x: me.x, z: me.z, y: me.y, vx: B.vel.x, vz: B.vel.z, h: me.heading, sp: B.speedNow || 0, car: null, L: 0.6, W: 0.6 };
  }
  // keep the operation at strength: patrols nearby join; response cars come in from out of sight
  bringIn(dt, me, car) {
    const G = this.G, want = CARS[this.level];
    this.units = this.units.filter(u => !u.dead && G.traffic.byId.get(u.id) === u);
    if (this.units.length >= want || (this.spawnT -= dt) > 0) return;
    this.spawnT = this.level >= 4 ? 2.5 : 4;
    const ax = this.phase === 'active' ? (car || me).x : this.last.x, az = this.phase === 'active' ? (car || me).z : this.last.z;
    // a patrol within a kilometre first
    const free = G.police.units.filter(v => !this.units.includes(v) && !v.dead && v.status === 'patrol' && !v.law && Math.hypot(v.x - ax, v.z - az) < 1000);
    free.sort((a, b) => Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az));
    const v = free[0] || this.spawnCar(ax, az);
    if (v) this.recruit(v);
  }
  // a response car on a road 200-380 m away, somewhere you can't see it arrive
  spawnCar(x, z) {
    const G = this.G, net = G.net;
    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * Math.PI * 2, r = 200 + Math.random() * 180;
      const n = net.nearest(x + Math.cos(a) * r, z + Math.sin(a) * r, 120, e => (net.flags[e] & 16) && !/motorway|service|track|footway|path|cycle|pedestrian|steps/.test(net.classes[net.cls[e]]));
      if (!n) continue;
      const gy = G.tiles.ground(n.x, n.z, 60); if (gy == null) continue;
      if (this.cam?.visible(n.x, gy + 1, n.z, 3) && Math.hypot(n.x - G.camera.position.x, n.z - G.camera.position.z) < 260) continue;
      const v = G.police.spawnUnit(n, x, z);
      if (v) return v;
    }
    return null;
  }
  recruit(v) {
    if (!v || this.units.includes(v)) return;
    v.law = { job: JOBS[this.units.length % JOBS.length], mode: 'road', routeT: 0, stuckT: 0, revT: 0, crew: 2, out: [], side: 0, slowT: 0, blockT: 0 };
    v.status = 'pursuit'; v.siren = true; v.lightsOnly = false; v.persistent = true; v.parked = false; v.occupied = true; v.incident = null;
    this.units.push(v);
  }
  unit(u, dt, T, me, car) {
    const G = this.G, L = u.law; if (!L) return;
    // where it's going: you, while they can see you; otherwise points round the search circle
    let tx = T.x, tz = T.z;
    if (this.phase !== 'active') {
      if (!L.search || L.searchAt !== this.searchSeq || (L.searchT -= dt) <= 0 || Math.hypot(L.search.x - u.x, L.search.z - u.z) < 25) {
        const first = L.searchAt !== this.searchSeq; L.searchAt = this.searchSeq;
        const a = Math.random() * Math.PI * 2, r = first ? 0 : Math.random() * this.searchR();
        const n = G.net.nearest(this.last.x + Math.cos(a) * r, this.last.z + Math.sin(a) * r, 150, e => G.net.flags[e] & 16);
        L.search = n ? { x: n.x, z: n.z } : { x: this.last.x, z: this.last.z }; L.searchT = 20;
      }
      tx = L.search.x; tz = L.search.z;
    }
    const d = Math.hypot(tx - u.x, tz - u.z);
    if (L.mode === 'stop') { this.stopped(u, dt, T, me, car, d); return; }
    if (L.mode === 'road') {
      u.siren = true;
      // shunted by traffic on the way in: shake it off and carry on (traffic.js would leave a crashed car standing)
      if (u.crashed || G.carDyn.loose.has(u)) { u.crashed = false; u.hazard = false; G.carDyn.loose.delete(u); }
      // you're on foot somewhere the roads don't reach (a precinct, a park, between the houses): once the car stops
      // getting closer, the crew gets out and comes after you on foot
      if (this.phase === 'active' && !car && d < 160) {
        if (d < (L.best ?? 1e9) - 2) { L.best = d; L.noProg = 0; } else L.noProg = (L.noProg || 0) + dt;
        if (L.noProg > 4 && (u.v || 0) < 8) { L.best = null; this.deploy(u); return; }
      }
      // close, with a clear line to you: take the wheel (off the lanes, straight at you)
      if (this.phase === 'active' && (d < 25 || d < DRIVE_R && (L.losT = (L.losT || 0) - dt) <= 0 && ((L.losT = 0.3), this.los(u.x, u.y + 1.2, u.z, tx, T.y + 1, tz)))) { this.takeWheel(u); return; }
      if ((L.routeT -= dt) <= 0) {
        L.routeT = 2.5;
        // intercepting: a point ahead of you on your way (8 s on), so they meet you rather than trail you
        if (L.role === 'intercept' && d > 160) { const k = Math.min(8, d / 25); tx = T.x + T.vx * k; tz = T.z + T.vz * k; }
        const n = G.net.nearest(tx, tz, 150, e => G.net.flags[e] & 16);
        if (n) { u.dest = Math.hypot(G.net.nodes[G.net.ea[n.e] * 3] - u.x, G.net.nodes[G.net.ea[n.e] * 3 + 2] - u.z) < Math.hypot(G.net.nodes[G.net.eb[n.e] * 3] - u.x, G.net.nodes[G.net.eb[n.e] * 3 + 2] - u.z) ? G.net.ea[n.e] : G.net.eb[n.e]; u.route = [u.h]; u.ri = 0; }
      }
      return;
    }
    // driving through the physics; lost the line for a while (round a block) or far off: back to the roads
    if ((L.lineT = (L.lineT || 0) - dt) <= 0) { L.lineT = 0.4; L.blind = d > 30 && !this.los(u.x, u.y + 1.2, u.z, tx, (T.y ?? u.y) + 1, tz) ? (L.blind || 0) + 0.4 : 0; }
    if (d > ROAD_R || (this.phase !== 'active' && d > 70) || L.blind > 3) { if (this.toRoads(u)) return; }
    const ctl = this.driver(u, L, this.phase === 'active' ? T : { x: tx, z: tz, vx: 0, vz: 0, h: Math.atan2(tz - u.z, tx - u.x), sp: 0, car: null, L: 1, W: 1, search: true }, dt);
    G.carDyn.drive(u, dt, ctl);
    const hit = G.carDyn.flush(u);
    if (hit > 3) G.audio?.crash?.(u.x, u.z, Math.min(1, hit / 12));
    u.steerVis = u.steer; u.brake = ctl.brake > 0.1; u.reversing = u.sp < -0.5;
    G.events.emit('vehicleSweep', { v: u, x: u.x, z: u.z, speed: Math.abs(u.sp) });
    // you've stopped (or you're on foot) and they're on you: pull up and the crew gets out. On foot somewhere the
    // car can't get to (between buildings, across a park): they get out and come on foot
    if (this.phase === 'active') {
      const slow = !car || T.sp < 3;
      L.slowT = slow && d < (car ? 16 : 24) ? L.slowT + dt : 0;
      if (d < (L.best ?? 1e9) - 1) { L.best = d; L.noProg = 0; } else L.noProg = (L.noProg || 0) + dt;
      if ((L.slowT > (car ? 1.2 : 0.4) || (!car && d < 90 && L.noProg > 5)) && Math.abs(u.sp) < 5) { L.best = null; this.deploy(u); }
    }
  }
  // ---------------------------------------------------------------- the team
  // How British traffic units work a pursuit (TPAC: tactical pursuit and containment): a lead car follows at a safe
  // distance with a second behind it, nobody piling in; where the road and the speed allow, they contain you: one
  // gets in front and slows, bringing you down with it (a rolling block), one closes up behind and the others come up
  // alongside, until you're boxed in and stop. Tactical contact (the PIT) only from three stars; ramming only from
  // four. Cars further off don't chase your tail: they head for where you're going. Re-planned twice a second.
  watch(dt, T) {
    const dh = this.lastH == null ? 0 : Math.abs(wrap(T.h - this.lastH)) / Math.max(dt, 1e-3);
    this.lastH = T.h;
    // how long they've been going straight (a containment needs a straight run), and their speed smoothed
    this.straight = dh < 0.12 && T.sp > 3 ? (this.straight || 0) + dt : 0;
    this.suspectSp = (this.suspectSp ?? T.sp) + (T.sp - (this.suspectSp ?? T.sp)) * Math.min(1, dt * 2);
  }
  plan(T) {
    const close = this.units.filter(u => u.law && !u.law.fixed && u.law.mode === 'drive' && !u.dead);
    for (const u of this.units) if (u.law && !u.law.fixed) u.law.role = u.law.mode === 'road' ? (T.car && T.sp > 6 && this.phase === 'active' ? 'intercept' : 'converge') : null;
    if (this.phase !== 'active') { for (const u of close) u.law.role = 'search'; return; }
    const tfx = Math.cos(T.h), tfz = Math.sin(T.h), trx = -tfz, trz = tfx;
    const R = close.map(u => ({ u, along: (u.x - T.x) * tfx + (u.z - T.z) * tfz, side: (u.x - T.x) * trx + (u.z - T.z) * trz, d: Math.hypot(u.x - T.x, u.z - T.z) }));
    const free = () => R.filter(r => !r.u.law.role);
    const take = (role, score) => { const c = free().sort((a, b) => score(a) - score(b))[0]; if (c) c.u.law.role = role; return c; };
    const moving = T.car && T.sp > 4;
    if (!moving) {
      // stopped, or on foot: the box, then everyone else holds back and the crews get out
      take('rear', r => Math.hypot(r.along + 8, r.side)); take('front', r => Math.hypot(r.along - 8, r.side));
      take('left', r => Math.hypot(r.along, r.side + 4)); take('right', r => Math.hypot(r.along, r.side - 4));
    } else {
      const contain = this.level >= 2 && R.length >= 3 && this.suspectSp < 20 && this.straight > 1.5;
      if (contain) {
        take('front', r => -r.along + Math.abs(r.side) * 0.5);
        take('rear', r => r.along < 0 ? -r.along : 50 + r.along);
        take('left', r => Math.abs(r.side + 3) + Math.abs(r.along) * 0.3);
        take('right', r => Math.abs(r.side - 3) + Math.abs(r.along) * 0.3);
        if (!this.contained) { this.contained = true; this.G.hud.feed('Police: containment — boxing you in'); }
      } else {
        this.contained = false;
        take('lead', r => (r.along < 0 ? 0 : 40) + r.d);
        if (this.level >= 3 && T.sp > 6 && T.sp < 24) take('pit', r => Math.abs(r.along + T.L * 0.5) + Math.abs(Math.abs(r.side) - 2.5));
        if (this.level >= 4) take('ram', r => r.d);
        take('second', r => (r.along < 0 ? 0 : 40) + r.d);
      }
      for (const r of free()) r.u.law.role = 'second';
    }
    for (const r of free()) r.u.law.role = 'hold';
  }
  // off the lanes: the car is driven through carPhysics.js from here
  takeWheel(u) {
    const G = this.G, L = u.law, ph = G.carDyn.ph(u), sp = u.v || 0;
    ph.vx = Math.cos(u.heading) * sp; ph.vz = Math.sin(u.heading) * sp; ph.w = 0; ph.gear = Math.max(1, ph.gear || 1);
    u.driven = true; u.offroad = false; L.mode = 'drive'; L.stuckT = 0; L.revT = 0; L.side = 0;
    G.carDyn.loose.delete(u); u.crashed = false; u.hazard = false;
  }
  // back on to the road graph (nearest drivable road, facing the way the car points)
  toRoads(u) {
    const G = this.G, net = G.net;
    const n = net.nearest(u.x, u.z, 30, e => (net.flags[e] & 16) && !/footway|path|cycle|pedestrian|steps/.test(net.classes[net.cls[e]]));
    if (!n) return false;
    const sp = Math.abs(u.sp || 0);
    u._offLane = true; G.police.rejoin(u, n);
    u.driven = false; u.v = Math.min(sp, 20); u.law.mode = 'road'; u.law.routeT = 0; u.parked = false;
    return true;
  }
  // ---------------------------------------------------------------- the pursuit driver
  // T: the target (you, or a search point). Returns the controls for carPhysics.js.
  driver(u, L, T, dt) {
    const G = this.G, ph = u.ph, h = u.heading, fx = Math.cos(h), fz = Math.sin(h);
    const sp = ph.vx * fx + ph.vz * fz;
    const dx = T.x - u.x, dz = T.z - u.z, d = Math.hypot(dx, dz);
    const tfx = Math.cos(T.h), tfz = Math.sin(T.h), trx = -tfz, trz = tfx;
    // where we are relative to the target: ahead (+) / behind, its right (+) / left
    const along = (u.x - T.x) * tfx + (u.z - T.z) * tfz, side = (u.x - T.x) * trx + (u.z - T.z) * trz;
    const look = clamp(d / Math.max(12, Math.abs(sp) + 6), 0, 1.4);
    let ax = T.x + T.vx * look, az = T.z + T.vz * look, want = 60, hb = false;
    const role = T.search ? 'search' : L.role || ({ pit: 'lead', block: 'second', tail: 'second', ram: 'second' }[L.job]) || 'second';
    const gap = clamp(6 + T.sp * 1.1, 8, 34), lenGap = T.L / 2 + u.def.L / 2;
    // a point beside / ahead of / behind the target, in its frame
    const at = (fwd, right, lead = 0.25) => [T.x + tfx * fwd + trx * right + T.vx * lead, T.z + tfz * fwd + trz * right + T.vz * lead];
    if (T.car && T.sp > 4) {
      if (role === 'lead' || role === 'second' || role === 'hold') {
        // following: the lead at a safe gap, close enough to keep eyes on; the second behind it, offset a little
        const g = role === 'lead' ? gap : gap + 12, off = role === 'lead' ? 0 : (L.off ??= Math.random() < 0.5 ? -1.6 : 1.6);
        [ax, az] = at(-g, off, 0.4);
        const behind = -along;   // metres behind the target (negative: we're level or ahead)
        want = T.sp + clamp((behind - g) * 0.45, -8, role === 'lead' ? 9 : 7);
        if (behind < g * 0.55) want = Math.min(want, T.sp - 3);   // too close: drop back
      } else if (role === 'front') {
        // get in front, then slow: the rolling block brings them down with you
        const ahead = along - lenGap - 3;
        [ax, az] = at(lenGap + 4, 0, 0.5);
        if (ahead < 0) { want = T.sp + clamp(-ahead * 0.5 + 3, 2, 11); L.rollT = 0; }
        else { L.rollT = (L.rollT || 0) + dt; want = Math.max(0, T.sp - 1.5 - L.rollT * 1.2); }
      } else if (role === 'rear') {
        [ax, az] = at(-(lenGap + 2.5), 0, 0.3);
        want = T.sp + clamp((-along - lenGap - 2.5) * 0.6, -6, 7);
      } else if (role === 'left' || role === 'right') {
        const s2 = role === 'right' ? 1 : -1;
        [ax, az] = at(-T.L * 0.1, s2 * (T.W / 2 + u.def.W / 2 + 0.7), 0.3);
        want = T.sp + clamp((-along - T.L * 0.1) * 0.5, -5, 7);
      } else if (role === 'pit') {
        // tactical contact: alongside the back wheel, a car's width out, then turn into the rear quarter
        if (!L.side) L.side = side >= 0 ? 1 : -1;
        const inPlace = d < 10 && along < T.L * 0.1 && along > -T.L * 0.9 && Math.abs(side) < T.W / 2 + 2.6;
        const ox = inPlace ? -T.L * 0.32 : -T.L * 0.45, oz = inPlace ? L.side * (T.W * 0.15) : L.side * (T.W / 2 + 1.3);
        ax = T.x + tfx * ox + trx * oz + T.vx * 0.25; az = T.z + tfz * ox + trz * oz + T.vz * 0.25;
        want = T.sp + clamp((d - 2) * 0.9, -5, 8) + (inPlace ? 2.5 : 0);
      } else if (role === 'ram') {
        want = T.sp + clamp(d * 0.6, 3, 10);
      }
    } else if (!T.search) {
      // slow or stopped (or on foot): the box (front, back and sides), the rest hold back
      const slot = { front: [1, 0], rear: [-1, 0], left: [0, -1], right: [0, 1] }[role];
      if (slot) {
        const sx = slot[0] * (lenGap + 0.8), sz = slot[1] * (T.W / 2 + u.def.W / 2 + 0.6);
        ax = T.x + tfx * sx + trx * sz; az = T.z + tfz * sx + trz * sz;
        const ds = Math.hypot(ax - u.x, az - u.z);
        want = T.car ? clamp(ds * 0.8, 0, 14) : clamp((d - 9) * 0.8, 0, 16);
      } else { want = clamp((d - (T.car ? 22 : 14)) * 0.6, 0, 12); }
    } else {
      want = d > 40 ? 20 : 11;
    }
    void hb;
    // steer for the aim point; feel ahead for walls; ease off for sharp turns
    let err = wrap(Math.atan2(az - u.z, ax - u.x) - h);
    let steer = clamp(err * 2.2, -1, 1);
    const feel = this.feel(u, sp, T.car);
    steer = clamp(steer + feel.steer, -1, 1);
    const turn = Math.abs(err);
    want = Math.min(want, turn > 1.6 ? 7 : turn > 0.9 ? 13 : turn > 0.45 ? 24 : 60, feel.slow);
    let thr = clamp((want - sp) * 0.4, -1, 1), brk = 0;
    if (thr < 0) { brk = Math.min(1, -thr * 1.2); thr = 0; }
    // the aim point is behind and close: turn round (back up, swinging the nose round, if there's no room)
    if (turn > 2.3 && d < 30 && sp < 6) { thr = 0.7; steer = Math.sign(err) || 1; }
    // stuck against something: back out, wheel turned the other way
    if (L.revT > 0) { L.revT -= dt; return { throttle: -0.85, brake: 0, steer: -L.revSteer, handbrake: false, assists: 1 }; }
    L.stuckT = thr > 0.4 && Math.abs(sp) < 1.2 && want > 3 ? L.stuckT + dt : Math.max(0, L.stuckT - dt);
    if (L.stuckT > 1.1) { L.stuckT = 0; L.revT = 1.2 + Math.random() * 0.5; L.revSteer = steer || 1; }
    return { throttle: thr, brake: brk, steer, handbrake: hb, assists: 1 };
  }
  // feelers ahead (left, centre, right) for buildings: steer away from the blocked side, slow for a wall in front
  feel(u, sp, target = null) {
    const G = this.G, h = u.heading, out = { steer: 0, slow: 60 };
    // traffic (and the other police cars) in the way ahead: ease off and edge round it, rather than plough through
    const fx = Math.cos(h), fz = Math.sin(h), reachV = clamp(Math.abs(sp) * 1.4, 8, 30);
    for (const v of G.traffic.list) {
      if (v === u || v === target || v.hidden) continue;
      const dx = v.x - u.x, dz = v.z - u.z; if (Math.abs(dx) > reachV || Math.abs(dz) > reachV) continue;
      const a = dx * fx + dz * fz, l = -dx * fz + dz * fx;
      if (a < 1 || a > reachV || Math.abs(l) > (v.def?.W || 2) / 2 + u.def.W / 2 + 0.6) continue;
      out.slow = Math.min(out.slow, Math.max(2, (a - 4) * 0.7)); out.steer += l > 0 ? -0.35 : 0.35;
    }
    const reach = clamp(Math.abs(sp) * 0.9, 6, 22);
    const blocked = (a, r) => { const x = u.x + Math.cos(h + a) * r, z = u.z + Math.sin(h + a) * r; return G.tiles.insideBuilding(x, z, u.y + 1); };
    const c = blocked(0, reach * 0.6) || blocked(0, reach), l = blocked(-0.42, reach * 0.8), r = blocked(0.42, reach * 0.8);
    if (l && !r) out.steer += 0.6; else if (r && !l) out.steer -= 0.6;
    if (c) { out.slow = 8; if (!l && r) out.steer -= 0.5; else if (!r && l) out.steer += 0.5; else if (!l && !r) out.steer += 0.6; }
    return out;
  }
  // ---------------------------------------------------------------- officers
  deploy(u) {
    const G = this.G, L = u.law;
    L.mode = 'stop'; u.parked = true; u.driven = false; u.v = 0; u.sp = 0; u.lightsOnly = true; u.siren = false;
    if (u.ph) { u.ph.vx = u.ph.vz = u.ph.w = 0; }
    G.audio?.play?.('Car_Door_Open', u.x, u.y + 1, u.z, 0.4);
    const rx = -Math.sin(u.heading), rz = Math.cos(u.heading);
    for (let k = 0; k < L.crew; k++) {
      const s = k ? 1 : -1;
      const o = { id: `pc-${u.id}-${this.t.toFixed(2)}-${k}`, h: u.h, s: u.s, sideSign: 1, lane: 0,
        look: { ...People.randomLook(Math.random, { work: true }), citizen: null, top: 0x15171c, legs: 0x15171c, cap: this.level >= 5, bag: false, backpack: false }, hiVis: this.level < 5, hat: k === 0 && this.level < 5,
        speed: 1.2, mode: 'chase', t: 0, phase: k * 2, heading: u.heading, x: u.x + rx * s * (u.def.W / 2 + 0.6), y: u.y, z: u.z + rz * s * (u.def.W / 2 + 0.6),
        visible: true, alpha: 1, officer: true, hp: 100, law: { car: u, next: G.time + 0.8 + Math.random() * 0.8, taserAt: G.time + 1 + Math.random(), shouted: false } };
      G.peds.list.push(o); this.foot.push(o); L.out.push(o);
    }
  }
  // a car whose crew is out: they get back in and go after you if you drive off
  stopped(u, dt, T, me, car, d) {
    const L = u.law;
    L.out = L.out.filter(o => !o.dead && !o.gone);
    const away = this.phase !== 'active' || (car && T.sp > 6 && d > 18) || (!car && d > 45);
    if (!away) return;
    // officers within reach get back in; the car carries on (an officer who's down or far off stays)
    for (const o of L.out) if (Math.hypot(o.x - u.x, o.z - u.z) < 14) { o.gone = true; }
    L.out = L.out.filter(o => !o.gone);
    L.crew = Math.max(0, 2 - L.out.length);
    if (!L.crew) return;
    u.parked = false; u.lightsOnly = false; u.siren = true; L.slowT = 0;
    this.takeWheel(u);
  }
  // one officer on foot
  officer(o, dt, T, me, car) {
    const G = this.G, W = o.law;
    if (o.gone || o.dead) { this.foot.splice(this.foot.indexOf(o), 1); return; }
    o.reactT = 0;        // (an officer knocked down gets up and carries on, not running off like the public)
    if (o.impact || o.fallT > 0) return;
    const tx = car ? car.x : me.x, tz = car ? car.z : me.z, ty = car ? car.y : me.y;
    const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
    // lost you: back to the car (or off)
    if (this.phase !== 'active' && this.unseen > 6 || me.inside) {
      const c = W.car; if (!c || c.dead || Math.hypot(c.x - o.x, c.z - o.z) < 2.5) { o.gone = true; return; }
      this.chase(o, c.x, c.z, 4.2, dt, Math.hypot(c.x - o.x, c.z - o.z) < 20); return;
    }
    const sightLine = d < 60 && this.los(o.x, o.y + 1.6, o.z, tx, ty + 1.2, tz);
    const armed = this.level >= 5;   // guns at five stars only; below that, Tasers
    const hold = this.hold?.kind;
    // somebody down, giving up, or stopped in a car: go and cuff them
    if (hold === 'stun' || hold === 'surrender' || (car && T.sp < 1)) {
      if (!W.shouted && car) { W.shouted = true; G.hud.banner(armed ? 'Armed police! Out of the car — hands where we can see them!' : 'Police! Step out of the vehicle!', 'pursuit', 3); }
      if (d > 1.1 + (car ? car.def.W / 2 + 0.3 : 0)) this.chase(o, tx, tz, d > 6 ? 4.6 : 2.2, dt, sightLine);
      else { o.pose = 'idle'; o.speedNow = 0; o.heading = Math.atan2(dz, dx); }
      return;
    }
    if (armed) {
      // armed response: stand with a clear line at 7-25 m and shoot; close in when there's no line
      if (car && T.sp > 2) { if (sightLine && d < 45) this.aimFire(o, dt, me, car, d); else this.chase(o, tx, tz, 5, dt, sightLine); return; }
      if (!sightLine || d > 26) { this.chase(o, tx, tz, 5.4, dt, sightLine); return; }
      if (d < 4 && !this.armedNow()) { this.move(o, dx, dz, 3, dt); return; }
      this.aimFire(o, dt, me, car, d);
      if (!W.shouted) { W.shouted = true; G.hud.banner('Armed police! Get down on the ground!', 'pursuit', 3); }
      return;
    }
    // up to four stars: run you down and Taser you
    if (car) { this.chase(o, tx, tz, 5, dt, sightLine); return; }
    if (!W.shouted && d < 30) { W.shouted = true; G.hud.banner('Police! Stop!', 'pursuit', 2.5); }
    if (d < 9 && d > 1.6 && sightLine && G.time > W.taserAt) { this.taser(o, me, d); return; }
    if (W.aimT > 0) { W.aimT -= dt; o.pose = 'aim'; o.speedNow = 0; o.heading = Math.atan2(dz, dx); return; }
    this.chase(o, tx, tz, d > 12 ? 5.7 : d > 3 ? 5.1 : 2, dt, sightLine);
  }
  // run at (tx, tz): straight at it with a clear line; otherwise along the pavements and footpaths round the
  // buildings (the pedestrians' walk graph, walkgraph.js), the route worked out again every few seconds
  chase(o, tx, tz, sp, dt, line) {
    const W = o.law, d = Math.hypot(tx - o.x, tz - o.z);
    if (line || d < 6 || !this.G.walkGraph) { W.path = null; this.move(o, tx - o.x, tz - o.z, sp, dt); return; }
    if (!W.path || (W.pathT -= dt) <= 0 || Math.hypot(W.goal[0] - tx, W.goal[1] - tz) > 15) {
      W.pathT = 3; W.goal = [tx, tz]; W.path = this.G.walkGraph.path(o.x, o.z, tx, tz)?.pts || null; W.pi = 1;
      if (!W.path) W.pathT = 1;
    }
    const P = W.path;
    if (!P) { this.move(o, tx - o.x, tz - o.z, sp, dt); return; }
    while (W.pi < P.length - 1 && Math.hypot(P[W.pi][0] - o.x, P[W.pi][1] - o.z) < 2) W.pi++;
    this.move(o, P[W.pi][0] - o.x, P[W.pi][1] - o.z, sp, dt);
  }
  move(o, dx, dz, sp, dt) {
    const G = this.G, d = Math.hypot(dx, dz) || 1;
    let nx = o.x + dx / d * sp * dt, nz = o.z + dz / d * sp * dt;
    [nx, nz] = G.brothers.collideCircle(nx, nz, 0.32, o.y);
    // round a car in the way
    for (const v of G.traffic.list) { const ddx = nx - v.x, ddz = nz - v.z; if (ddx * ddx + ddz * ddz < 16) { const L2 = v.def.L / 2 + 0.35, W2 = v.def.W / 2 + 0.35, c = Math.cos(v.heading), s = Math.sin(v.heading), lx = ddx * c + ddz * s, lz = -ddx * s + ddz * c; if (Math.abs(lx) < L2 && Math.abs(lz) < W2) { const px = L2 - Math.abs(lx), pz = W2 - Math.abs(lz); if (px < pz) { nx += c * Math.sign(lx) * px; nz += s * Math.sign(lx) * px; } else { nx += -s * Math.sign(lz) * pz; nz += c * Math.sign(lz) * pz; } } } }
    o.x = nx; o.z = nz; o.heading = Math.atan2(dz, dx); o.speedNow = sp; o.running = sp > 3; o.pose = 'walk';
    o.phase = (o.phase + sp * dt * (sp > 3 ? 2.6 : 3.6)) % 6.283;
    G.peds.ground(o);
  }
  armed() { const st = this.G.combat?.status?.(); return !!st && !st.melee; }
  armedNow() { const C = this.G.combat; return this.armed() && (C.aiming() || C.s[this.G.brothers.active].aim > 0.4); }
  // ---------------------------------------------------------------- force
  aimFire(o, dt, me, car, d) {
    const G = this.G, W = o.law, tx = car ? car.x : me.x, tz = car ? car.z : me.z;
    o.pose = 'aim'; o.speedNow = 0; o.heading = Math.atan2(tz - o.z, tx - o.x);
    if (G.time < W.next) return;
    W.next = G.time + (Math.random() < 0.35 ? 0.28 : 0.75 + Math.random() * 0.7);   // now and then a double tap
    const sp = car ? Math.abs(car.sp || 0) : G.brothers.speedNow || 0;
    let p = clamp(0.7 - d * 0.014 - sp * 0.022, 0.1, 0.72) * (this.level >= 4 ? 1.15 : 1);
    if (this.hold?.kind === 'stun') p = 0;
    this.shoot(o.x + Math.cos(o.heading) * 0.55, o.y + 1.42, o.z + Math.sin(o.heading) * 0.55, me, car, Math.random() < p, 8 + Math.random() * 6);
  }
  // a round from (x, y, z) at you: a hit hurts you (in a car: the car takes it, and now and then you do); a miss
  // flies past and hits whatever's behind
  shoot(x, y, z, me, car, hit, dmg) {
    const G = this.G, C = G.combat; if (!C) return;
    C.sounds?.();
    const ty = car ? car.y + 1.0 : me.y + 1.25, tx = car ? car.x : me.x, tz = car ? car.z : me.z;
    const o = new THREE.Vector3(x, y, z), aim = new THREE.Vector3(tx, ty, tz).sub(o), L = aim.length(); aim.divideScalar(L);
    if (!hit) { const side = new THREE.Vector3(-aim.z, 0, aim.x); aim.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.05)).add(new THREE.Vector3(0, (Math.random() - 0.4) * 0.05, 0)).normalize(); }
    C.fx.flash(o, aim, 0.18); C.sample('9mm', x, y, z, 0.85, 0.96 + Math.random() * 0.08);
    if (hit) {
      C.fx.tracer(o, aim, L);
      if (car) {
        C.impact({ kind: 'car', t: L, v: car, p: new THREE.Vector3(tx, ty - 0.1 + Math.random() * 0.4, tz) }, aim, { damage: 30 });
        if (Math.random() < 0.4) this.hurt(dmg * 0.8, x, z);
      } else this.hurt(dmg, x, z);
    } else {
      const h = C.trace(o, aim, 90, G.brothers.active);
      C.fx.tracer(o, aim, h.t);
      if (h.kind !== 'none' && h.kind !== 'ped') C.impact(h, aim, { damage: 30 });
    }
  }
  taser(o, me, d) {
    const G = this.G, W = o.law;
    W.taserAt = G.time + 3.5 + Math.random() * 1.5; W.aimT = 0.5;
    o.pose = 'aim'; o.speedNow = 0; o.heading = Math.atan2(me.z - o.z, me.x - o.x);
    const sp = G.brothers.speedNow || 0, p = (d < 4 ? 0.92 : d < 7 ? 0.78 : 0.55) * (sp > 3 ? 0.75 : 1);
    const hit = Math.random() < p;
    // the barbs and their wires, and the crackle (a short metallic tick)
    const a = new THREE.Vector3(o.x + Math.cos(o.heading) * 0.5, o.y + 1.35, o.z + Math.sin(o.heading) * 0.5);
    const b = new THREE.Vector3(me.x, me.y + (hit ? 1.1 : 0.3), me.z);
    if (!hit) b.add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6));
    this.wires(a, b, hit ? 2.6 : 0.6);
    G.audio?.tap?.('metal', 0.55, 2.4);
    G.hud.banner(hit ? 'Taser! Taser! — you’re down' : 'Taser! — missed', 'pursuit', 2);
    if (hit) this.stun(3.2);
  }
  wires(a, b, life) {
    const G = this.G, g = new THREE.BufferGeometry(), up = new THREE.Vector3(0, 0.05, 0);
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, a.x + up.x, a.y - 0.05, a.z, b.x, b.y - 0.12, b.z], 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe14d }));
    G.scene.add(line); this.fx.push({ obj: line, t: life });
  }
  effects(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.t -= dt; if (f.t <= 0) { f.obj.removeFromParent(); f.obj.geometry.dispose(); f.obj.material.dispose(); this.fx.splice(i, 1); } }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.6);
  }
  // ---------------------------------------------------------------- stingers and roadblocks
  stingers(dt, T, car) {
    const G = this.G;
    if (this.block) {
      const B = this.block; B.t += dt;
      // the stinger lies at the kerb until you're coming: then it's pulled across the carriageway, and back once
      // you're past (so the cars behind you don't run over it)
      if (B.strip) {
        const c0 = Math.cos(B.angle), s0 = Math.sin(B.angle), pos = car || T, rel = (pos.x - B.x) * c0 + (pos.z - B.z) * s0;
        const coming = rel < 0 && rel > -70 && !B.used, passed = rel > 6 || B.used;
        B.out = clamp((B.out || 0) + (coming && !passed ? dt * 2.2 : passed ? -dt * 1.2 : 0), 0, 1);
        const k = 0.06 + 0.94 * B.out, ax = -s0 * B.kerb, az = c0 * B.kerb;
        B.strip.scale.z = k; B.strip.position.set(B.x + ax * 3.4 * (1 - k), B.y + 0.05, B.z + az * 3.4 * (1 - k));
        if (coming && B.out > 0.5 && !B.called) { B.called = true; G.hud.feed('Police: stinger out'); }
      }
      // the stinger: a car that runs over it (while it's out) loses its tyres
      if (B.strip && car && B.out > 0.7) {
        const c = Math.cos(B.angle), s = Math.sin(B.angle), along = (x, z) => (x - B.x) * c + (z - B.z) * s, across = (x, z) => -(x - B.x) * s + (z - B.z) * c;
        const a = along(B.px ?? car.x, B.pz ?? car.z), b = along(car.x, car.z);
        if (a * b <= 0 && a !== b) {
          const f = a / (a - b), zz = across((B.px ?? car.x) + (car.x - (B.px ?? car.x)) * f, (B.pz ?? car.z) + (car.z - (B.pz ?? car.z)) * f);
          if (Math.abs(zz) < 3.4 + car.def.W * 0.45 && Math.abs(car.y - B.y) < 2) { car.spikeStop = 16; car.flat = [1, 1, 1, 1]; G.hud.banner('Stinger! Your tyres are shredded', 'pursuit', 3); B.strip.visible = false; B.used = true; }
        }
        B.px = car.x; B.pz = car.z;
      }
      if (B.t > 60 || Math.hypot(B.x - T.x, B.z - T.z) > 500) this.clearBlock();
      return;
    }
    if (this.level < 2 || this.phase !== 'active' || !car || T.sp < 9 || this.contained || (this.blockT -= dt) > 0) return;
    this.blockT = 3;
    // a point on the road ahead of you, 150-230 m on
    const net = G.net, n = net.nearest(car.x, car.z, 20, e => net.flags[e] & 16); if (!n) return;
    let h = n.e * 2 + (Math.cos(Math.atan2(n.dz, n.dx) - car.heading) < 0 ? 1 : 0);
    let left = (h & 1 ? n.s : net.len[n.e] - n.s), dist = left;
    const want = 150 + Math.random() * 80;
    for (let k = 0; k < 12 && dist < want; k++) {
      const outs = net.outD[net.endNode(h)].filter(o => (o >> 1) !== (h >> 1));
      if (!outs.length) return;
      // straight on, as near as there is
      outs.sort((a, b) => Math.abs(wrap(this.edgeDir(a) - car.heading)) - Math.abs(wrap(this.edgeDir(b) - car.heading)));
      h = outs[0]; dist += net.len[h >> 1];
    }
    const pos = [0, 0, 0, 0, 0]; net.at(h, Math.max(2, net.len[h >> 1] - (dist - want)), pos);
    const [x, y, z, ddx, ddz] = pos, angle = Math.atan2(ddz, ddx);
    if (this.cam?.visible(x, y + 1, z, 4) && Math.hypot(x - G.camera.position.x, z - G.camera.position.z) < 120) return;
    const B = this.block = { x, y, z, angle, t: 0, cars: [], kerb: 1, out: 0 };
    // the stinger, laid from the nearside kerb by the crew of a car pulled up just beyond it
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 6.8), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }));
    strip.position.set(x, y + 0.05, z); strip.rotation.y = -angle; G.scene.add(strip); B.strip = strip;
    if (this.level < 4) {
      const w = (net.width[h >> 1] || 7) / 2, kx = -Math.sin(angle) * B.kerb, kz = Math.cos(angle) * B.kerb;
      const v = G.traffic.add({ id: 'stinger-' + Math.round(this.t * 10), kind: 'police', model: 'police', paint: 0xf2f2f2, x: x + Math.cos(angle) * 14 + kx * (w + 1.2), y, z: z + Math.sin(angle) * 14 + kz * (w + 1.2), heading: angle, parked: true, persistent: true });
      if (v) { v.lightsOnly = true; v.status = 'roadblock'; v.law = { job: 'block', mode: 'stop', out: [], crew: 1, fixed: true }; G.police.units.push(v); B.cars.push(v); this.deploy(v); v.law.mode = 'stop'; }
    }
    // four stars: two cars across the road beyond it, crews out and aiming
    if (this.level >= 4) for (const s of [-1, 1]) {
      const cx = x + Math.cos(angle) * 9 - Math.sin(angle) * s * 2.6, cz = z + Math.sin(angle) * 9 + Math.cos(angle) * s * 2.6;
      const v = G.traffic.add({ id: 'roadblock-' + Math.round(this.t * 10) + (s > 0 ? 'a' : 'b'), kind: 'police', model: 'police', paint: 0xf2f2f2, x: cx, y, z: cz, heading: angle + Math.PI / 2 + s * 0.25, parked: true, persistent: true });
      v.lightsOnly = true; v.status = 'roadblock'; v.law = { job: 'block', mode: 'stop', out: [], crew: 2 };
      G.police.units.push(v); B.cars.push(v); this.deploy(v); v.law.mode = 'stop'; v.law.fixed = true;
    }
    this.blockT = this.level >= 4 ? 25 : 40;
    G.hud.feed(this.level >= 4 ? 'Police: roadblock and stinger ahead' : 'Police: stinger deployed ahead');
  }
  edgeDir(h) { const net = this.G.net, p = [0, 0, 0, 0, 0]; net.at(h, Math.min(5, net.len[h >> 1] / 2), p); return Math.atan2(p[4], p[3]); }
  clearBlock() {
    const B = this.block; if (!B) return;
    if (B.strip) { B.strip.removeFromParent(); B.strip.geometry.dispose(); B.strip.material.dispose(); }
    for (const v of B.cars) { for (const o of v.law?.out || []) o.gone = true; this.G.traffic.remove(v); const i = this.G.police.units.indexOf(v); if (i >= 0) this.G.police.units.splice(i, 1); }
    this.block = null;
  }
  // ---------------------------------------------------------------- arrest
  arrest(dt, me, car) {
    const G = this.G, H = this.hold;
    if (H && (H.kind === 'busted' || H.kind === 'wasted')) return;
    const near = (r) => this.foot.some(o => !o.dead && !o.gone && !o.impact && Math.hypot(o.x - (car ? car.x : me.x), o.z - (car ? car.z : me.z)) < r);
    if (car) {
      const sp = Math.abs(car.sp || 0);
      const boxed = this.units.filter(u => u.law && Math.hypot(u.x - car.x, u.z - car.z) < 8).length;
      this.stillT = sp < 1.2 && (near(car.def.W / 2 + 1.6) || boxed >= 2) ? (this.stillT || 0) + dt : 0;
      if (this.stillT > (near(car.def.W / 2 + 1.6) ? 2.2 : 4)) this.busted('They pulled you out of the car');
      return;
    }
    const sp = G.brothers.speedNow || 0;
    this.stillT = (sp < 0.6 && !this.armedNow()) || H ? (this.stillT || 0) + dt : 0;
    if (near(1.4) && (H?.kind === 'stun' || H?.kind === 'surrender' || this.stillT > 1.2)) this.busted(H?.kind === 'stun' ? 'Cuffed while you were down' : 'Arrested');
  }
  canGiveUp() {
    const G = this.G, me = G.brothers.me;
    return this.level > 0 && !this.hold && !me.vehicle && this.foot.some(o => !o.dead && !o.gone && Math.hypot(o.x - me.x, o.z - me.z) < 30);
  }
  giveUp() { if (!this.canGiveUp()) return false; this.hold = { kind: 'surrender', t: 0 }; this.G.hud.banner('You put your hands up', 'pursuit', 3); return true; }
  stun(secs) { if (this.hold && this.hold.kind !== 'surrender') return; this.hold = { kind: 'stun', t: 0, secs }; this.G.haptics?.rumble?.(1, 1, 900); }
  // ---------------------------------------------------------------- your health
  hurt(dmg, fx, fz) {
    const G = this.G, me = G.brothers.me;
    if (this.hold?.kind === 'wasted' || this.hold?.kind === 'busted') return;
    me.hp = Math.max(0, (me.hp ?? 100) - dmg);
    this.lastHurt = G.time; this.hitFlash = Math.min(1, this.hitFlash + 0.55);
    G.haptics?.rumble?.(0.8, 0.6, 160);
    G.combat?.fx?.puff?.(new THREE.Vector3(me.x, me.y + 1.2, me.z), new THREE.Vector3(me.x - fx, 0.3, me.z - fz).normalize(), [0.32, 0.02, 0.02], 0.7, 0.05, 0.25, 0.5);
    if (G.combat?.s) G.combat.s[G.brothers.active].shake += 0.35;
    if (me.hp <= 0) this.wasted();
  }
  health(dt, me) {
    const G = this.G;
    if (me.hp == null) me.hp = 100;
    // it comes back slowly once nothing's hit you for a while
    if (me.hp > 0 && me.hp < 100 && G.time - this.lastHurt > 8 && !this.hold) me.hp = Math.min(100, me.hp + dt * 2.5);
  }
  // ---------------------------------------------------------------- busted / wasted
  busted(why) {
    if (this.hold?.kind === 'busted' || this.hold?.kind === 'wasted') return;
    this.hold = { kind: 'busted', t: 0, why };
    this.G.hud.bigText?.('BUSTED', 'busted');
    this.G.haptics?.rumble?.(0.5, 0.3, 300);
  }
  wasted() {
    if (this.hold?.kind === 'wasted') return;
    this.hold = { kind: 'wasted', t: 0 };
    this.G.hud.bigText?.('WASTED', 'wasted');
    this.G.haptics?.rumble?.(1, 0.8, 700);
  }
  // runs while you're held (player.js asks holding() each frame and doesn't move you)
  holding() { return !!this.hold; }
  holdStep(dt, me, car) {
    const G = this.G, H = this.hold, B = G.brothers, a = B.actor[B.active];
    H.t += dt;
    if (H.kind === 'stun') {
      a.down = H.t < H.secs ? Math.min(1, H.t / 0.35) : Math.max(0, 1 - (H.t - H.secs) / 0.8);
      if (H.t > H.secs + 0.8) { a.down = 0; this.hold = null; }
      return;
    }
    if (H.kind === 'surrender') { a.down = 0; if (H.t > 25) this.hold = null; return; }
    if (H.kind === 'wasted') {
      a.down = Math.min(1, H.t / 0.6);
      if (H.t > 3.6 && !H.done) { H.done = true; this.respawn(HOSPITALS, 'Wasted', 250, 'hospital bill'); }
      return;
    }
    if (H.kind === 'busted') {
      a.down = 0;
      if (H.t > 3 && !H.done) { H.done = true; this.respawn(STATIONS, 'Busted', 150, 'fine'); }
    }
  }
  respawn(list, verb, fee, what) {
    const G = this.G, B = G.brothers, me = B.me, a = B.actor[B.active];
    // out of any car (left where it was) and out of any building
    const v = B.vehicleOf(me);
    if (v) { v.player = false; v.parked = true; v.sp = 0; v.v = 0; v.camInside = false; if (v.ph) { v.ph.vx = v.ph.vz = v.ph.w = 0; } me.vehicle = null; }
    if (me.inside != null) { me.inside = null; G.interiors?.showVeg?.(); }
    let best = list[0], bd = 1e18;
    for (const p of list) { const d = Math.hypot(p[1] - me.x, p[2] - me.z); if (d < bd) { bd = d; best = p; } }
    this.clear(null);
    G.teleport(best[1], best[2]);
    const paid = Math.min(cash(me), fee); me.cash = Math.round((cash(me) - paid) * 100) / 100;
    me.hp = 100; a.down = 0; this.hold = null; this.hitFlash = 0;
    G.hud.fade(`${verb} · ${best[0].replace(/^the /, 'The ')}`);
    G.hud.banner(`${verb === 'Wasted' ? 'Patched up at' : 'Released from'} ${best[0]} · ${paid ? '£' + paid.toFixed(0) + ' ' + what : 'no ' + what + ' (skint)'}`, 'clear', 6);
  }
  // ---------------------------------------------------------------- the end of it
  clear(msg) {
    const G = this.G;
    this.level = 0; this.phase = 'none'; this.reports.length = 0; this.shotAtPolice = false; this.stillT = 0; this.evade = 0;
    if (this.hold && (this.hold.kind === 'surrender' || this.hold.kind === 'stun')) { G.brothers.actor[G.brothers.active].down = 0; this.hold = null; }
    this.clearBlock();
    for (const u of this.units) {
      const L = u.law; u.law = null;
      for (const o of L?.out || []) o.gone = true;
      if (u.driven && !this.toRoads2(u)) { u.driven = false; G.traffic.remove(u); const i = G.police.units.indexOf(u); if (i >= 0) G.police.units.splice(i, 1); continue; }
      u.parked = false; u.siren = false; u.lightsOnly = false; u.status = 'patrol'; u.dest = G.police.beatNode(u); u.occupied = false;
    }
    for (const o of this.foot) o.gone = true;
    this.units = []; this.foot = [];
    // the extra response cars go once nobody's looking; the patrols stay
    G.police.trim?.();
    this.sync();
    if (msg) G.hud.banner(msg, 'clear', 4);
  }
  toRoads2(u) { if (!u.law) u.law = { mode: 'road' }; const ok = this.toRoads(u); u.law = null; return ok; }
}
