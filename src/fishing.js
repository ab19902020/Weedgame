// Fishing: go to a fishing lake (South Lake, White Swan and Black Swan at Dinton Pastures, Canberra and Orrell at
// Charvil), stand at a peg with a rod from TechZone, and fish it properly.
//   Cast: hold to swing the rod back (the power builds; hold too long and it goes off), let go to cast. Aim along the
//     bank. Feather the line as the rig comes down to stop it short and land it without a tangle (a carp rig that
//     isn't feathered can tangle and you'll catch nothing). Clip up the line to hit the same spot each time.
//   Wait: the float dips and goes under, the carp rod's alarm bleeps and then screams off, or a lure is hit as you
//     wind it back. Feed the swim to draw fish in. Strike in time: too soon and you pull it out of their mouths, too
//     late and the bait's gone.
//   Fight: the line has a breaking strain and stretches, the rod bends and cushions, the reel's clutch gives line
//     at the drag you set. Wind when the fish lets you, let the clutch take the runs, hold the rod up and pump, and
//     use side strain to steer the fish away from the lilies and the islands, where it'll cut you off. Keep it
//     tight: a slack line lets the hook drop out (barbless hooks at Dinton make that likelier). A pike can bite
//     through anything but a wire trace.
//   Land it: draw a beaten fish over the net (small ones you can swing in). Weigh it, take a picture, put it back.
// Tackle wears out and gets lost: a break takes the hook and float (or lead and hair rig, or the lure), casting into
// an island's trees or a snag in the lilies can cost a rig, and a hook goes blunt after a dozen fish. Spares,
// baits, nets and mats are sold at TechZone (techCatalogue.js); each water's ticket is bought at the lake.
// Everything about the fish, the lakes and the bites is in fishData.js; what you see in fishModels.js; the screen
// and the controls (touch, keyboard, DualShock / DualSense) in fishingHud.js.
import * as THREE from 'three/webgpu';
import { SPECIES, STOCK, WATERS, RODS, BAITS, Lake, biteRates, drawBite, biteShape, lbOz, lengthCm } from './fishData.js';
import { FishGear } from './fishModels.js';
import { cash, spend } from './food.js';

const LB = 0.4536, G0 = 9.81, UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// a brother's fishing kit (saved with him)
export function kitOf(b) {
  b.items ??= {};
  const k = b.items.fishing ??= {};
  k.rods ??= {}; k.tackle ??= {}; k.bait ??= {}; k.tickets ??= {}; k.log ??= []; k.pb ??= {}; k.drag ??= {}; k.clip ??= {}; k.sel ??= {};
  for (const t of ['hooks', 'floats', 'hairrigs', 'leads', 'spinner', 'shad']) k.tackle[t] ??= 0;
  for (const t of ['maggots', 'corn', 'bread', 'worms', 'boilies']) k.bait[t] ??= 0;
  return k;
}
export const hasRod = b => !!b.items?.fishing && Object.keys(b.items.fishing.rods || {}).length > 0;

export class Fishing {
  constructor(G) {
    this.G = G; this.active = false; this.state = 'off';
    this.lakes = new Map(); this.index = []; this.loading = new Set();
    this.gear = new FishGear(G);
    this.feed = []; this.splashes = []; this.msgs = [];
    this.here = null; this.t = 0;
    if (typeof document !== 'undefined') fetch('world/fishing/index.json').then(r => r.json()).then(d => { this.index = d.lakes; }).catch(e => console.warn('fishing index', e));
  }
  kit(b = this.G.brothers.me) { return kitOf(b); }
  rodOwned(m, b = this.G.brothers.me) { return !!b.items?.fishing?.rods?.[m]; }
  // ---------------------------------------------------------------- near a lake: load it, find the peg you're at
  scan() {
    const G = this.G, me = G.brothers.me;
    if (me.vehicle || me.inside) { this.here = null; return; }
    let found = null;
    for (const L of this.index) {
      const [x0, z0, x1, z1] = L.box; if (me.x < x0 - 400 || me.x > x1 + 400 || me.z < z0 - 400 || me.z > z1 + 400) continue;
      const lake = this.lakes.get(L.id);
      if (!lake) { if (!this.loading.has(L.id)) this.load(L.id); continue; }
      if (me.x < x0 - 30 || me.x > x1 + 30 || me.z < z0 - 30 || me.z > z1 + 30) continue;
      const np = lake.nearestPeg(me.x, me.z); if (np && np.d < 5) found = { lake, peg: np.peg, d: np.d };
    }
    this.here = found;
  }
  async load(id) {
    this.loading.add(id);
    try {
      const d = await (await fetch(`world/fishing/${id}.json`)).json(), lake = new Lake(d);
      this.lakes.set(id, lake);
      this.gear.pegs(lake, (x, z) => this.G.tiles.ground(x, z) ?? this.G.tiles.terrain(x, z));
      this.gear.lilies(lake);
    } catch (e) { console.warn('fishing lake', id, e); }
  }
  // the Use button's text at a peg (hud.js)
  prompt() {
    if (this.active || !this.here) return null;
    return { text: `Fish · ${this.here.lake.name} peg ${this.here.peg.n}`, fish: true };
  }
  // ---------------------------------------------------------------- tickets
  ticketKey(id) { return WATERS[id]?.shares || id; }
  hasTicket(id, b = this.G.brothers.me) {
    const W = WATERS[id], k = this.kit(b), v = k.tickets[this.ticketKey(id)]; if (!W) return true;
    return W.ticket === 'day' ? v === this.dayNo() : !!v;
  }
  dayNo() { return Math.floor((this.G.world?.s?.t || 0) / 86400); }
  buyTicket(id) {
    const W = WATERS[id], me = this.G.brothers.me; if (!W) return true;
    if (!spend(me, W.price)) { this.toast(`${W.label}: £${W.price} — not enough cash`); return false; }
    this.kit(me).tickets[this.ticketKey(id)] = W.ticket === 'day' ? this.dayNo() : true;
    this.G.save?.now?.(); return true;
  }
  // ---------------------------------------------------------------- start and stop
  tryStart() {
    const G = this.G, me = G.brothers.me, H = this.here; if (!H || this.active) return false;
    if (!hasRod(me)) { this.toast('You need a fishing rod: TechZone sells them, rigged and ready', 4); return false; }
    const W = WATERS[H.lake.id], k = this.kit(me);
    const missing = (W?.needs || []).filter(n => !k[n]);
    if (missing.length) { this.toast(`${H.lake.name} rules: ${missing.map(n => n === 'net' ? 'a landing net' : 'an unhooking mat').join(' and ')} needed (TechZone)`, 4.5); return false; }
    if (!this.hasTicket(H.lake.id)) { G.fishingHud?.ticket(H.lake, W, () => { if (this.buyTicket(H.lake.id)) this.start(H.lake, H.peg); }); return false; }
    this.start(H.lake, H.peg); return true;
  }
  start(lake, peg) {
    const G = this.G, me = G.brothers.me, k = this.kit(me);
    this.lake = lake; this.peg = peg; this.water = WATERS[lake.id] || {};
    this.active = true; this.state = 'ready';
    G.combat?.select?.(null);
    // stand a metre back from the water, facing it
    this.h0 = peg.heading;
    this.stand = new THREE.Vector3(peg.x - Math.cos(peg.heading) * 1.1, 0, peg.z - Math.sin(peg.heading) * 1.1);
    this.stand.y = G.tiles.ground(this.stand.x, this.stand.z, me.y + 1) ?? G.tiles.terrain(this.stand.x, this.stand.z) ?? peg.g;
    me.x = this.stand.x; me.z = this.stand.z; me.y = this.stand.y; me.heading = peg.heading;
    this.method = this.rodOwned(k.method === 'ledger' ? 'carp' : k.method || 'float') ? (k.method || 'float') : this.rodOwned('float') ? 'float' : this.rodOwned('carp') ? 'ledger' : 'lure';
    this.chooseMethod(this.method, true);
    this.aim = 0; this.lift = 0; this.side = 0; this.charge = 0; this.rig = null; this.fish = null; this.bite = null; this.caught = null;
    this.camSaved = { fov: G.camera.fov }; this.camYaw = 0; this.camPitch = 0;
    this.t = 0; this.events = [];
    G.hud?.toast?.(`${lake.name}, peg ${peg.n}. ${this.water.rules?.[0] || ''}`, 3.5);
    G.haptics?.select?.();
  }
  stop() {
    const G = this.G;
    if (this.state === 'fight') this.lose('You put the rod down', 'line');
    this.active = false; this.state = 'off'; this.rig = null; this.fish = null; this.bite = null; this.caught = null;
    this.gear.hide(); this.gear.showFish(null);
    if (this.camSaved) { G.camera.fov = this.camSaved.fov; G.camera.updateProjectionMatrix(); }
    G.audio?.fishLoops?.(0, 1, 0, 1, null);
    const a = G.brothers.actor?.[G.brothers.active]; if (a) a.pose = 'idle';
    G.save?.now?.();
  }
  // ---------------------------------------------------------------- tackle choices
  rodKind(m = this.method) { return m === 'ledger' ? 'carp' : m; }
  rodSpec(m = this.method) { return RODS[this.rodKind(m)]; }
  chooseMethod(m, quiet = false) {
    const k = this.kit(); if (!this.rodOwned(this.rodKind(m))) return false;
    if (this.state !== 'ready' && this.state !== 'off') return false;
    this.method = m; k.method = m;
    const R = this.rodSpec(m);
    k.drag[m] ??= +(R.line * 0.35).toFixed(1);
    // bait: the last used for this method, or the first in the bag that goes on it
    const PREFER = { float: ['maggots', 'corn', 'worms', 'bread'], ledger: ['boilies', 'corn', 'worms'], lure: ['shad', 'spinner'] };
    const ok = PREFER[m].filter(id => BAITS[id]?.methods.includes(m));
    let b = k.sel[m]; if (!ok.includes(b) || !this.baitLeft(b)) b = ok.find(x => this.baitLeft(x)) || ok[0];
    k.sel[m] = b;
    const rod = k.rods[this.rodKind(m)];
    if (m === 'lure' && rod && !rod.rig) rod.rig = BAITS[b]?.lure && this.baitLeft(b) ? b : null;
    if (!quiet) this.toast(`${R.name}: ${R.line} lb line · ${BAITS[b]?.name || 'no bait'}`, 2);
    return true;
  }
  baitLeft(b) { const k = this.kit(); return BAITS[b]?.lure ? (k.tackle[b] || 0) + (k.rods.lure?.rig === b ? 1 : 0) : (k.bait[b] || 0); }
  chooseBait(b) {
    if (!BAITS[b]?.methods.includes(this.method) || this.state === 'fight') return false;
    const k = this.kit(); k.sel[this.method] = b;
    if (this.method === 'lure') { const rod = k.rods.lure; if (rod.rig !== b) { if ((k.tackle[b] || 0) <= 0) { this.toast(`No ${BAITS[b].name.toLowerCase()} in the box`); return false; } if (rod.rig) k.tackle[rod.rig]++; k.tackle[b]--; rod.rig = b; } }
    else if (this.rig && this.rig.bait && this.rig.bait !== b) this.rig.bait = null;   // rebait on the next cast
    this.toast(`${BAITS[b].name} on`, 1.4); return true;
  }
  setDrag(lb) { const R = this.rodSpec(), k = this.kit(); k.drag[this.method] = +clamp(lb, R.drag[0], R.drag[1]).toFixed(1); }
  dragLb() { return this.kit().drag[this.method] ?? this.rodSpec().line * 0.35; }
  toggleClip() {
    const k = this.kit(), m = this.method;
    if (k.clip[m]) { k.clip[m] = 0; this.toast('Line unclipped', 1.5); }
    else if (this.lastCast) { k.clip[m] = Math.round(this.lastCast); this.toast(`Clipped up at ${k.clip[m]} m: every cast stops there`, 2.5); }
    else this.toast('Cast first, then clip up at that distance', 2);
  }
  // the rig on the rod: tied on, or tie on a new one from the spares
  rigged(m = this.method) { const r = this.kit().rods[this.rodKind(m)]; return !!r && (m === 'lure' ? !!r.rig : r.rig !== false); }
  retie() {
    const k = this.kit(), m = this.method, kind = this.rodKind(m), rod = k.rods[kind]; if (!rod) return false;
    if (m === 'lure') { const b = k.sel.lure; if ((k.tackle[b] || 0) > 0) { k.tackle[b]--; rod.rig = b; this.toast(`${BAITS[b].name} clipped on`, 2); return true; } const other = ['shad', 'spinner'].find(x => k.tackle[x] > 0); if (other) { k.tackle[other]--; rod.rig = other; k.sel.lure = other; this.toast(`${BAITS[other].name} clipped on`, 2); return true; } this.toast('No lures left: TechZone sells them', 3); return false; }
    const need = RODS[kind].rig, short = need.filter(t => (k.tackle[t] || 0) <= 0);
    // a blunt hook only needs a new hook
    if (rod.rig !== false && rod.wear >= 12) { const h = need[0]; if ((k.tackle[h] || 0) <= 0) { this.toast(`No ${h === 'hooks' ? 'hooks' : 'hair rigs'} left to change it`, 3); return false; } k.tackle[h]--; rod.wear = 0; this.toast(`Fresh ${h === 'hooks' ? 'hook' : 'hair rig'} tied on (${k.tackle[h]} left)`, 2.5); return true; }
    if (short.length) { this.toast(`Can't tie a new rig: no ${short.map(t => ({ hooks: 'hooks', floats: 'floats', hairrigs: 'hair rigs', leads: 'leads' }[t])).join(' or ')} left (TechZone)`, 3.5); return false; }
    for (const t of need) k.tackle[t]--;
    rod.rig = true; rod.wear = 0;
    this.toast(kind === 'carp' ? `New lead and hair rig tied on (${k.tackle.hairrigs} rigs left)` : `New float and hook tied on (${k.tackle.hooks} hooks, ${k.tackle.floats} floats left)`, 3);
    return true;
  }
  // a rig gone: the hook and float (lead and hair rig, or the lure) lost with it
  loseRig(why) {
    const k = this.kit(), rod = k.rods[this.rodKind()]; if (!rod) return;
    if (this.method === 'lure') rod.rig = null; else rod.rig = false;
    rod.wear = 0;
    const spare = this.method === 'lure' ? (k.tackle.spinner + k.tackle.shad) : Math.min(...RODS[this.rodKind()].rig.map(t => k.tackle[t] || 0));
    this.events.push({ kind: 'lostRig' });
    this.toast(`${why}: ${this.method === 'lure' ? 'the lure' : this.method === 'ledger' ? 'the lead and rig' : 'the float and hook'} gone. ${spare > 0 ? 'Tie on a new one (Tackle)' : 'No spares left: TechZone'}`, 4);
  }
  // ---------------------------------------------------------------- the swim: loose feed and disturbance
  feedLevel(x, z) { const now = this.t; let f = 0; for (const e of this.feed) { const d = Math.hypot(e.x - x, e.z - z); f += e.n * Math.exp(-(now - e.t) / 480) * Math.exp(-d * d / 60); } return f / 12; }
  disturbance(x, z) { const now = this.t; let f = 0; for (const e of this.splashes) { const d = Math.hypot(e.x - x, e.z - z); f += e.m * Math.exp(-(now - e.t) / 80) * Math.exp(-d * d / 120); } return f; }
  feedSwim() {
    if (!this.active || this.state === 'fight' || this.state === 'landed') return;
    const k = this.kit(), b = k.sel[this.method], B = BAITS[b];
    if (!B || !B.feed) { this.toast(B?.lure ? 'Nothing to feed with a lure' : `You can't loose-feed ${B?.name.toLowerCase() || 'that'}`, 2); return; }
    if ((k.bait[b] || 0) < B.feed) { this.toast(`Not enough ${B.name.toLowerCase()} to feed`, 2); return; }
    const reach = k.catapult ? 42 : 13, P = this.stand;
    let tx, tz;
    if (this.rig?.inWater) { tx = this.rig.p.x; tz = this.rig.p.z; } else { const y = this.h0 + this.aim; tx = P.x + Math.cos(y) * 18; tz = P.z + Math.sin(y) * 18; }
    const d = Math.hypot(tx - P.x, tz - P.z); if (d > reach) { const s = reach / d; tx = P.x + (tx - P.x) * s; tz = P.z + (tz - P.z) * s; if (!k.catapult) this.toast('Thrown by hand it only goes 13 m: a catapult reaches 40 m', 2.5); }
    k.bait[b] -= B.feed;
    const spread = 1 + d * 0.08;
    for (let i = 0; i < B.feed; i++) { const x = tx + (Math.random() - 0.5) * spread * 2, z = tz + (Math.random() - 0.5) * spread * 2; if (this.lake.wet(x, z)) setTimeout(() => this.gear.ring(x, this.lake.level, z, 0.12), 500 + Math.random() * 400); }
    this.feed.push({ x: tx, z: tz, n: B.feed, t: this.t });
    this.splashes.push({ x: tx, z: tz, m: 0.08, t: this.t });
    this.G.audio?.fishShot?.('plop', tx, this.lake.level, tz, 0.25, 1.4);
    this.toast(`${k.catapult ? 'Catapulted' : 'Threw'} in some ${B.name.toLowerCase()} (${k.bait[b]} left)`, 1.8);
  }
  // ---------------------------------------------------------------- per frame
  update(dt, I) {
    const G = this.G; this.t += dt;
    const lake = this.lake, k = this.kit(), R = this.rodSpec();
    if (I.exit) { this.stop(); return; }
    // looking about (drag / right stick), aiming along the bank (left stick / A D)
    this.camYaw = clamp(this.camYaw + (I.look?.dx || 0) * 0.004, -1.2, 1.2); this.camPitch = clamp(this.camPitch + (I.look?.dy || 0) * 0.003, -0.4, 0.5);
    if (this.state === 'ready' || this.state === 'windup') this.aim = clamp(this.aim + (I.aim || 0) * dt * 0.9, -1.1, 1.1);
    this.side += ((this.state === 'fight' ? I.aim || 0 : 0) - this.side) * Math.min(1, dt * 5);
    this.lift += ((I.lift || 0) - this.lift) * Math.min(1, dt * 4);
    if (I.dragDelta) this.setDrag(this.dragLb() + I.dragDelta * (R.line > 10 ? 0.5 : 0.2));
    if (I.feed) this.feedSwim();
    const sub = 1 / 120; let acc = dt;
    // ---- states
    switch (this.state) {
      case 'ready':
        if (!this.rigged()) { if (I.castDown) this.toast('No rig on the line: tie one on in Tackle', 2.5); break; }
        if (I.castDown || I.castHeld) { this.state = 'windup'; this.charge = 0; this.featherT = -9; }
        break;
      case 'windup':
        this.charge += dt / 1.15;
        if (!I.castHeld) this.release();
        else if (this.charge > 1.6) { this.release(); }
        break;
      case 'release':
        this.relT += dt; if (this.relT >= 0.12 && this.rig && !this.rig.flying) this.launch();
        if (this.state === 'release' && this.relT > 0.2 && this.rig?.flying) this.state = 'flight';
        break;
      case 'flight':
        if (I.feather) this.featherT = this.t;
        while (acc > 1e-6 && this.state === 'flight') { const h = Math.min(sub, acc); this.flight(h, I.feather); acc -= h; }
        break;
      case 'settle': this.settle(dt); this.waiting(dt, I); break;
      case 'fishing': this.waiting(dt, I); break;
      case 'snagged': this.snagged(dt, I); break;
      case 'fight':
        while (acc > 1e-6 && this.state === 'fight') { const h = Math.min(sub, acc); this.fightStep(h, I); acc -= h; }
        if (this.state === 'fight') this.fightFrame(dt, I);
        break;
      case 'netting': this.netting(dt, I); break;
      case 'landed': if (I.ok) this.release_fish(); break;
    }
    if (this.state !== 'ready' && this.state !== 'windup' && I.castDown && this.state === 'fishing' && this.method !== 'lure' && !this.bite) { /* a second press while waiting does nothing (strike is its own) */ }
    if (I.strike) this.strike();
    if (I.net) this.tryNet();
    // retie a lost or blunt rig from the box (Tackle)
    this.feed = this.feed.filter(e => this.t - e.t < 1500); this.splashes = this.splashes.filter(e => this.t - e.t < 400);
    this.pose(dt); this.draw(dt, I); this.sound(dt); this.placeCamera(dt);
    void lake; void k;
  }
  // ---------------------------------------------------------------- the rod: where it is (physics and drawing share this)
  rodYaw() {
    if (this.state === 'fight' || this.state === 'netting') { const f = this.fish; const ly = f ? Math.atan2(f.p.z - this.stand.z, f.p.x - this.stand.x) : this.h0; return ly - this.side * 0.75; }
    if ((this.state === 'fishing' || this.state === 'settle' || this.state === 'snagged') && this.rig) return Math.atan2(this.rig.p.z - this.stand.z, this.rig.p.x - this.stand.x);
    return this.h0 + this.aim;
  }
  rodElev() {
    switch (this.state) {
      case 'windup': return 0.5 + 1.75 * Math.min(1, this.charge);
      case 'release': return 0.5 + 1.75 * Math.min(1, this.charge) - (1.75 * Math.min(1, this.charge) + 0.05) * Math.min(1, this.relT / 0.16);
      case 'fight': return 0.75 + 0.55 * this.lift;
      case 'netting': return 1.05;
      case 'fishing': case 'settle': case 'snagged': return this.method === 'ledger' ? 0.1 : this.method === 'lure' ? 0.15 + this.lift * 0.4 : 0.32;
      default: return 0.45;
    }
  }
  onPod() { return this.method === 'ledger' && (this.state === 'fishing' || this.state === 'settle'); }
  butt() {
    const y = this.rodYaw(), P = this.stand;
    if (this.onPod()) { const pp = this.podAt(); return new THREE.Vector3(pp.x, P.y + 0.53, pp.z); }
    const r = y + Math.PI / 2;
    return new THREE.Vector3(P.x + Math.cos(y) * 0.12 + Math.cos(r) * 0.2, P.y + 1.0, P.z + Math.sin(y) * 0.12 + Math.sin(r) * 0.2);
  }
  // the pod's back rest: beside and a little ahead of where you stand (the alarm is 0.9 m further out)
  podAt() { const P = this.stand, r = this.h0 + Math.PI / 2; return { x: P.x + Math.cos(this.h0) * 0.2 + Math.cos(r) * 0.65, z: P.z + Math.sin(this.h0) * 0.2 + Math.sin(r) * 0.65 }; }
  rodDir() { const y = this.rodYaw(), e = this.rodElev(); return new THREE.Vector3(Math.cos(e) * Math.cos(y), Math.sin(e), Math.cos(e) * Math.sin(y)); }
  // the tip, bent towards the pull (the same curve fishModels.js draws)
  tipOf(T = 0, toward = null) {
    const B = this.butt(), d = this.rodDir(), L = this.rodSpec().length, b = clamp(T / (this.rodSpec().tc * LB), 0, 1.6);
    if (!toward || b < 1e-3) return B.addScaledVector(d, L);
    const side = new THREE.Vector3().copy(toward).addScaledVector(d, -toward.dot(d)); if (side.lengthSq() < 1e-6) side.set(0, -1, 0); side.normalize();
    const ang = b * 1.25;
    return B.addScaledVector(d, L * Math.cos(ang * 0.6)).addScaledVector(side, L * Math.sin(ang * 0.6) * 0.75);
  }
  // ---------------------------------------------------------------- casting
  release() {
    const c = this.charge;
    this.power = c <= 1 ? Math.max(0.12, c) : Math.max(0.55, 1 - (c - 1) * 0.9);
    this.over = c > 1.05;
    this.state = 'release'; this.relT = 0;
    this.rig = { flying: false, p: this.tipOf(), v: new THREE.Vector3(), inWater: false, bait: this.rig?.bait || null };
  }
  launch() {
    const k = this.kit(), R = this.rodSpec(), m = this.method;
    // a fresh bait if the last one came off (lures are always on)
    if (m !== 'lure') {
      const b = k.sel[m];
      if (!this.rig.bait) { if ((k.bait[b] || 0) <= 0) { this.state = 'ready'; this.rig = null; this.toast(`No ${BAITS[b]?.name.toLowerCase() || 'bait'} left: TechZone sells it`, 3); return; } k.bait[b]--; this.rig.bait = b; }
    } else this.rig.bait = k.rods.lure.rig;
    // a crack-off: a carp lead on a cast forced too hard
    if (m === 'ledger' && this.over && this.power > 0.6 && Math.random() < 0.2) {
      this.G.audio?.fishShot?.('snap', this.stand.x, this.stand.y + 1.5, this.stand.z, 0.8);
      this.G.haptics?.rumble(0.8, 0.6, 160);
      this.loseRig('Crack-off! The line parted on the cast'); this.state = 'ready'; this.rig = null; return;
    }
    const y = this.h0 + this.aim + (Math.random() - 0.5) * (0.04 + (this.over ? 0.12 : 0) + (this.power < 0.3 ? 0.04 : 0));
    const e = 0.6 + (Math.random() - 0.5) * 0.08 + (this.over ? -0.15 : 0);
    const v0 = R.cast.v * (0.25 + 0.75 * this.power);
    this.rig.p.copy(this.tipOf()); this.rig.v.set(Math.cos(e) * Math.cos(y) * v0, Math.sin(e) * v0, Math.cos(e) * Math.sin(y) * v0);
    this.rig.flying = true; this.rig.tangle = false; this.rig.t = 0; this.castYaw = y;
    this.G.audio?.fishShot?.('cast', this.stand.x, this.stand.y + 1.6, this.stand.z, 0.7, 0.95 + this.power * 0.1);
    this.G.haptics?.rumble(0.15, 0.35, 90);
  }
  flight(h, feather) {
    const r = this.rig, R = this.rodSpec(), k = this.kit(), lake = this.lake;
    const wind = this.G.world?.wind || [0, 0];
    const vr = _v.set(r.v.x - wind[0] * 0.6, r.v.y, r.v.z - wind[1] * 0.6), sp = vr.length();
    const drag = R.cast.drag * (feather ? 5 : 1);
    r.v.addScaledVector(vr, -drag * sp * h); r.v.y -= G0 * h;
    r.p.addScaledVector(r.v, h); r.t += h;
    // the clip: the line stops at the clipped distance and the rig drops
    const clip = k.clip[this.method], dx = r.p.x - this.stand.x, dz = r.p.z - this.stand.z, d = Math.hypot(dx, dz);
    if (clip && d >= clip && !r.clipped) { r.clipped = true; r.v.x *= -0.05; r.v.z *= -0.05; this.events.push({ kind: 'clip' }); this.G.haptics?.rumble(0.25, 0.2, 60); }
    const level = lake.level;
    if (r.p.y <= level + 0.02) this.land();
    else if (r.t > 0.3) { const g = this.G.tiles.ground(r.p.x, r.p.z, r.p.y); if (g != null && r.p.y <= g + 0.05 && !lake.wet(r.p.x, r.p.z)) this.land(); }
  }
  land() {
    const r = this.rig, lake = this.lake, m = this.method, k = this.kit();
    r.flying = false; this.lastCast = Math.hypot(r.p.x - this.stand.x, r.p.z - this.stand.z);
    const wet = lake.wet(r.p.x, r.p.z);
    if (!wet) {
      // on an island: in its bushes and trees
      const isl = lake.islands.find(i => Math.hypot(r.p.x - i.x, r.p.z - i.z) < i.r + 3);
      if (isl) { r.p.y = (this.G.tiles.ground(r.p.x, r.p.z) ?? lake.level) + 1.5; this.state = 'snagged'; this.snag = { kind: 'tree', t: 0 }; this.toast('In the island\'s trees! Wind to pull it free (and pray)', 3); }
      else { r.p.y = (this.G.tiles.ground(r.p.x, r.p.z) ?? lake.level) + 0.02; this.state = 'fishing'; r.onBank = true; this.toast('On the bank: wind in and cast again', 2.5); }
      this.line = this.distTip(); return;
    }
    r.p.y = lake.level; r.inWater = true; r.onBank = false;
    const mag = m === 'ledger' ? 0.65 : m === 'lure' ? 0.3 : 0.22;
    this.gear.splash(r.p.x, lake.level, r.p.z, mag);
    this.splashes.push({ x: r.p.x, z: r.p.z, m: m === 'ledger' ? 0.45 : 0.15, t: this.t });
    this.G.audio?.fishShot?.(m === 'ledger' ? 'lead' : 'plop', r.p.x, lake.level, r.p.z, m === 'ledger' ? 0.9 : 0.6);
    // feathered in the last moments: no tangle. Not feathered: a carp rig may well have tangled round the lead
    const feathered = this.t - this.featherT < 0.75;
    r.tangle = !feathered && Math.random() < (m === 'ledger' ? 0.4 : m === 'float' ? 0.12 : 0);
    if (feathered) this.events.push({ kind: 'feathered' });
    r.depth = Math.max(0.3, lake.depthAt(r.p.x, r.p.z));
    this.state = 'settle'; this.settleT = 0; this.line = this.distTip() + 0.3;
    this.bite = null; this.biteRateT = 0; this.lastBiteCheck = 0;
    void k;
  }
  distTip() { return this.tipOf().distanceTo(this.rig.p); }
  // where a cast at this power would come down (no wind, no feathering): for the target ring and the HUD
  predictCast(power, yaw = this.h0 + this.aim) {
    const R = this.rodSpec(), v0 = R.cast.v * (0.25 + 0.75 * power), e = 0.6, h = 1 / 60;
    const p = this.tipOf(), v = new THREE.Vector3(Math.cos(e) * Math.cos(yaw) * v0, Math.sin(e) * v0, Math.cos(e) * Math.sin(yaw) * v0);
    const clip = this.kit().clip[this.method];
    for (let i = 0; i < 600; i++) {
      const sp = v.length(); v.addScaledVector(v, -R.cast.drag * sp * h); v.y -= G0 * h; p.addScaledVector(v, h);
      if (clip && Math.hypot(p.x - this.stand.x, p.z - this.stand.z) >= clip) { v.x = v.z = 0; }
      if (p.y <= this.lake.level) break;
    }
    p.y = this.lake.level; return p;
  }
  // how much water there is straight out along a line (to the far bank or an island)
  openWater(yaw = this.h0 + this.aim) {
    const L = this.lake; let d = 1, seen = false;
    for (; d < 140; d += 1) { const w = L.wet(this.stand.x + Math.cos(yaw) * d, this.stand.z + Math.sin(yaw) * d); if (w) seen = true; else if (seen) break; }
    return seen ? d : 0;
  }
  settle(dt) {
    this.settleT += dt;
    if (this.settleT > (this.method === 'ledger' ? Math.min(2.5, 0.6 + this.rig.depth / 1.5) : 1.2)) {
      this.state = 'fishing';
      if (this.method === 'ledger') { this.events.push({ kind: 'beep' }); this.toast('Rod on the pod, alarm set. Wait for a run…', 2.2); }
    }
  }
  // ---------------------------------------------------------------- waiting for a bite (and winding back)
  waiting(dt, I) {
    const r = this.rig, lake = this.lake, m = this.method, R = this.rodSpec();
    if (!r) { this.state = 'ready'; return; }
    // winding in: the rig comes back towards you (a lure is fished like this)
    const reel = I.reel || 0;
    const moving = reel > 0.05 && !this.bite;
    if (moving) {
      const to = _v.set(this.stand.x - r.p.x, 0, this.stand.z - r.p.z), d = to.length(), sp = R.reel * reel * (m === 'lure' ? 1 : 1.3);
      if (d > 0.01) r.p.addScaledVector(to.normalize(), Math.min(d, sp * dt));
      if (m === 'lure') r.lureDepth = clamp((r.lureDepth ?? 0.4) - (reel - 0.5) * dt * 0.8, 0.15, Math.max(0.3, lake.depthAt(r.p.x, r.p.z) - 0.2));
      // snags: through a lily bed, a float or a lure can catch
      const F = lake.features(r.p.x, r.p.z);
      if (r.inWater && F.lily < 0 && Math.random() < dt * (m === 'lure' ? 0.5 : 0.25)) { this.state = 'snagged'; this.snag = { kind: 'lily', t: 0 }; this.toast('Snagged in the lilies! Keep winding to pull free, or it may break', 3); return; }
      // out of the water and back at the bank
      if (Math.hypot(r.p.x - this.stand.x, r.p.z - this.stand.z) < 2.6 || (!lake.wet(r.p.x, r.p.z) && !r.onBank && r.inWater)) { this.retrieved(); return; }
      if (r.onBank && Math.hypot(r.p.x - this.stand.x, r.p.z - this.stand.z) < 4) { this.retrieved(); return; }
    } else if (m === 'lure' && r.inWater) r.lureDepth = Math.min((r.lureDepth ?? 0.4) + dt * 0.15, Math.max(0.3, lake.depthAt(r.p.x, r.p.z) - 0.15));
    if (this.state !== 'fishing' && this.state !== 'settle') return;
    if (!r.inWater || r.onBank) return;
    // the line out follows the rig
    this.line = this.distTip() + (m === 'ledger' ? 0.05 : 0.4);
    // bites
    if (this.bite) { this.biteTick(dt, I); return; }
    if (this.state === 'settle' && m !== 'lure') return;
    this.biteRateT -= dt;
    if (this.biteRateT <= 0) {
      this.biteRateT = 1.5;
      const W = this.G.world, hour = W?.hours?.() ?? 12, cover = W?.cur?.cover ?? 0.5, wind = Math.hypot(...(W?.wind || [0, 0]));
      const bait = m === 'lure' ? this.kit().rods.lure.rig : r.bait;
      const can = (m === 'lure' ? !!bait : !!bait) && !r.tangle;
      this.rates = can ? biteRates(this.lake.id, lake, r.p, { bait, method: m, hour, cover, wind, feed: this.feedLevel(r.p.x, r.p.z), disturb: this.disturbance(r.p.x, r.p.z), moving }) : [];
    }
    const tot = (this.rates || []).reduce((a, x) => a + x.rate, 0) * (m === 'lure' && !moving ? 0.03 : 1);
    if (tot > 0 && Math.random() < 1 - Math.exp(-tot / 60 * dt)) {
      const bait = m === 'lure' ? this.kit().rods.lure.rig : r.bait;
      const b = drawBite(this.lake.id, this.rates, bait); if (!b) return;
      this.bite = { ...b, shape: biteShape(b.s, m), t: 0, phase: m === 'lure' ? 'take' : 'nibble', nextDip: 0.2, tTake: 0 };
      if (m === 'lure') { this.events.push({ kind: 'thump' }); this.G.haptics?.rumble(0.55, 0.4, 110); }
    }
  }
  biteTick(dt, I) {
    const B = this.bite, S = B.shape; B.t += dt;
    if (B.phase === 'nibble') {
      B.nextDip -= dt;
      if (B.nextDip <= 0) { B.nextDip = 0.4 + Math.random() * 1.2; B.dip = 0.35; this.events.push({ kind: 'beep' }); if (this.method === 'ledger') this.G.haptics?.rumble(0, 0.3, 40); }
      if (B.t >= S.lead) { B.phase = 'take'; B.tTake = 0; this.events.push({ kind: 'take' });
        if (this.method === 'ledger' && S.run) { this.G.haptics?.rumble(0.5, 0.6, 400); this.toast('RUN! The alarm\'s screaming — strike!', 2.5); } }
    } else if (B.phase === 'take') {
      B.tTake += dt;
      if (this.method === 'ledger' && S.run) { this.line += dt * 1.6; this.runBeep = (this.runBeep || 0) - dt; if (this.runBeep <= 0) { this.runBeep = 0.11; this.events.push({ kind: 'beep' }); this.G.haptics?.rumble(0.12, 0.35, 70); } }
      if (B.tTake > S.window) {
        // too late: the fish has hooked itself (a bolt rig, a pike on a lure), or it's dropped the bait
        if (Math.random() < S.self) { this.hook(0.62); this.toast('It\'s hooked itself!', 2); }
        else { this.missed(Math.random() < 0.6, 'Too late: it\'s let go'); }
      }
    }
    void I;
  }
  strike() {
    if (!this.active) return;
    const st = this.state;
    if (st !== 'fishing' && st !== 'settle') return;
    this.G.audio?.fishShot?.('swish', this.stand.x, this.stand.y + 1.6, this.stand.z, 0.55, 1.1);
    this.strikeT = this.t;
    const B = this.bite, r = this.rig;
    if (!B) {
      // struck at nothing: the rig jumps towards you, which lures do on purpose
      if (r?.inWater) { const to = _v.set(this.stand.x - r.p.x, 0, this.stand.z - r.p.z); const d = to.length(); if (d > 0.1) r.p.addScaledVector(to.normalize(), Math.max(0, Math.min(d - 2.5, this.method === 'lure' ? 0.7 : 1.4))); if (this.method !== 'lure') { this.splashes.push({ x: r.p.x, z: r.p.z, m: 0.12, t: this.t }); if (Math.random() < 0.25) r.bait = null; } }
      return;
    }
    if (B.phase === 'nibble') { this.missed(Math.random() < 0.35, 'Too soon! You pulled it out of its mouth'); this.splashes.push({ x: r.p.x, z: r.p.z, m: 0.25, t: this.t }); return; }
    // in the take: the sooner the better the hook hold
    const q = clamp(1 - (B.tTake / B.shape.window) * 0.55, 0.35, 1) * (this.kit().rods[this.rodKind()]?.wear >= 12 ? 0.75 : 1);
    if (B.s === 'pike' && this.method === 'lure' && Math.random() < 0.15) { this.missed(false, 'It spat the lure out'); return; }
    this.hook(q);
  }
  missed(baitGone, msg) {
    this.bite = null; if (baitGone && this.rig && this.method !== 'lure') this.rig.bait = null;
    this.toast(msg + (baitGone && this.method !== 'lure' ? ' (and the bait\'s gone)' : ''), 2.5);
    this.events.push({ kind: 'missed' });
  }
  retrieved() {
    const r = this.rig, m = this.method;
    if (r?.tangle) this.toast(m === 'ledger' ? 'Tangled round the lead! Feather the line just before it lands' : 'Tangled: feather it down next time', 3.5);
    else if (r && m !== 'lure' && r.bait) { const B = BAITS[r.bait]; if (Math.random() > (B?.stay ?? 0.8)) { r.bait = null; this.toast('The bait\'s come off', 1.8); } }
    else if (r && m !== 'lure' && !r.bait) this.toast('The bait\'s gone', 1.8);
    this.state = 'ready'; this.rig = r ? { flying: false, p: r.p, v: new THREE.Vector3(), bait: r.tangle ? r.bait : r.bait } : null; this.bite = null;
    if (this.rig) this.rig.inWater = false;
  }
  snagged(dt, I) {
    const S = this.snag, r = this.rig; S.t += dt;
    if ((I.reel || 0) > 0.3) {
      S.pull = (S.pull || 0) + dt * I.reel;
      this.G.haptics?.rumble(0.3, 0.2, 60);
      if (S.pull > 1.6) {
        const free = Math.random() < (S.kind === 'tree' ? 0.45 : 0.55);
        if (free) { this.toast('Pulled free!', 1.8); this.state = r.inWater ? 'fishing' : 'fishing'; if (S.kind === 'tree') { r.p.y = this.lake.level; r.inWater = this.lake.wet(r.p.x, r.p.z); r.onBank = !r.inWater; } this.snag = null; }
        else { this.G.audio?.fishShot?.('snap', r.p.x, r.p.y, r.p.z, 0.6); this.G.haptics?.rumble(0.9, 0.7, 180); this.loseRig('Snapped off in the snag'); this.state = 'ready'; this.rig = null; this.snag = null; }
      }
    }
  }
  // ---------------------------------------------------------------- the fight
  hook(q) {
    const B = this.bite, sp = SPECIES[B.s], kg = B.lb * LB, Lm = lengthCm(B.s, B.lb) / 100;
    const r = this.rig;
    this.fish = {
      s: B.s, lb: B.lb, kg, Lm, p: new THREE.Vector3(r.p.x, 0, r.p.z), y: this.method === 'lure' ? (r.lureDepth ?? 0.5) : Math.max(0.3, r.depth - 0.2), v: new THREE.Vector3(),
      head: Math.atan2(r.p.z - this.stand.z, r.p.x - this.stand.x), E: 1, mode: 'run', modeT: 0, want: 0, hookQ: q, slackT: 0, wear: 0, snag: null, snagT: 0, lastRun: false, roll: 0,
      Fmax: sp.fight.force * Math.pow(kg, 0.75), vmax: 0.7 + 2.2 * Lm, style: sp.fight.style, stamina: sp.fight.stamina, mouth: sp.mouth, t: 0, shake: 0, jumpT: 0,
    };
    this.fish.drag = this.fish.Fmax * G0 / (kg * 1.8) / (this.fish.vmax * this.fish.vmax);
    this.chooseMode(true);
    this.bite = null; this.state = 'fight'; this.T = 0;
    this.line = Math.max(this.line, this.tipOf().distanceTo(_w.set(this.fish.p.x, this.lake.level - this.fish.y, this.fish.p.z)) + 0.05);
    this.events.push({ kind: 'hooked' });
    this.G.haptics?.rumble(0.6, 0.5, 160);
    this.toast('Fish on!', 1.6);
  }
  chooseMode(first = false) {
    const f = this.fish, toAngler = Math.atan2(this.stand.z - f.p.z, this.stand.x - f.p.x), away = toAngler + Math.PI;
    const near = Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z);
    const r = Math.random(), E = f.E;
    // the nearest snag it could make for
    let snag = null, sd = 1e9;
    for (const l of this.lake.lilies) { const d = Math.hypot(l.x - f.p.x, l.z - f.p.z); if (d < sd && d < 35) { sd = d; snag = l; } }
    for (const i of this.lake.islands) { const d = Math.hypot(i.x - f.p.x, i.z - f.p.z) - i.r; if (d < sd && d < 40) { sd = d; snag = i; } }
    let mode, dur, want;
    if (E < 0.12) { mode = 'beaten'; dur = 3; want = f.head; }
    else if (first) { mode = f.style === 'slab' || f.style === 'small' ? 'kite' : 'run'; dur = f.style === 'runs' ? 6 + Math.random() * 8 : 2 + Math.random() * 3; want = snag && f.style !== 'small' && Math.random() < 0.5 ? Math.atan2(snag.z - f.p.z, snag.x - f.p.x) : away + (Math.random() - 0.5) * 1.4; }
    else if (near < 6 && E < 0.35 && !f.lastRun && f.style !== 'small' && f.style !== 'slab') { mode = 'run'; dur = 3 + Math.random() * 3; want = away + (Math.random() - 0.5) * 1.6; f.lastRun = true; f.E = Math.min(1, f.E + 0.06); this.toast('One last run!', 1.5); }
    else if (f.style === 'shake' && r < 0.35) { mode = 'shake'; dur = 1 + Math.random() * 1.5; want = f.head; }
    else if (f.style === 'dogged' && r < 0.45) { mode = 'dive'; dur = 2 + Math.random() * 3; want = snag ? Math.atan2(snag.z - f.p.z, snag.x - f.p.x) : f.head; }
    else if (r < 0.3 + E * 0.35 && f.style !== 'slab') { mode = 'run'; dur = (f.style === 'runs' ? 4 : 2) + Math.random() * 6 * E; want = snag && Math.random() < 0.4 ? Math.atan2(snag.z - f.p.z, snag.x - f.p.x) : away + (Math.random() - 0.5) * 2; }
    else if (r < 0.75) { mode = 'kite'; dur = 2.5 + Math.random() * 4; want = toAngler + (Math.random() < 0.5 ? 1 : -1) * (1.3 + Math.random() * 0.5); }
    else { mode = 'rest'; dur = 1.5 + Math.random() * 2.5; want = f.head; }
    f.mode = mode; f.modeT = dur; f.want = want;
  }
  fightStep(h, I) {
    const f = this.fish, lake = this.lake, R = this.rodSpec(), k = this.kit();
    f.t += h; f.modeT -= h; if (f.modeT <= 0) this.chooseMode();
    // the line: from the rod tip to the fish
    const fishPos = new THREE.Vector3(f.p.x, lake.level - f.y, f.p.z);
    const lineDir = new THREE.Vector3().subVectors(fishPos, this.tipOf()).normalize();
    const tip = this.tipOf(this.T, lineDir);
    const toTip = new THREE.Vector3().subVectors(tip, fishPos), dist = toTip.length(); toTip.divideScalar(dist || 1);
    const BS = R.line * LB, c = R.stretch * Math.max(1, this.line) / BS + 0.35 * R.length / (R.tc * LB);
    let T = Math.max(0, dist - this.line) / c;
    const drag = this.dragLb() * LB;
    this.slip = 0;
    if (T > drag) { const L2 = dist - drag * c; this.slip = (L2 - this.line) / h; this.line = L2; T = drag; }
    else if ((I.reel || 0) > 0.02) { this.line = Math.max(0.6, this.line - R.reel * I.reel * h * (1 - 0.55 * Math.min(1, T / drag))); }
    this.T = T; this.Tmax = Math.max(this.Tmax || 0, T);
    // the fish swims: its own force along its heading, the line's pull, the water's drag
    const modeK = { run: 1, kite: 0.6, dive: 0.85, shake: 0.55, rest: 0.18, beaten: 0.05 }[f.mode] ?? 0.5;
    const Fs = f.Fmax * modeK * (0.15 + 0.85 * f.E) * (f.snag ? 0.3 : 1);
    // turning: towards what it wants, and the line (with side strain) turning its head
    const pull = Math.atan2(toTip.z, toTip.x) - this.side * 0.6;
    f.head += clamp(angDiff(f.want, f.head), -1, 1) * h * 1.6;
    f.head += Math.sin(angDiff(pull, f.head)) * Math.min(2.2, T / Math.max(0.05, f.Fmax)) * h * (0.6 + Math.abs(this.side) * 1.2);
    if (f.mode === 'shake') { f.shake += h; f.head += Math.sin(f.t * 22) * h * 3; }
    const kgE = f.kg * 1.8;
    const ax = (Fs * Math.cos(f.head) + T * toTip.x) * G0 / kgE, az = (Fs * Math.sin(f.head) + T * toTip.z) * G0 / kgE;
    const sp = Math.hypot(f.v.x, f.v.z);
    f.v.x += (ax - f.drag * sp * f.v.x) * h; f.v.z += (az - f.drag * sp * f.v.z) * h;
    let nx = f.p.x + f.v.x * h, nz = f.p.z + f.v.z * h;
    // the lake's edge: it can't swim out of the water (it turns along the margin)
    if (!lake.wet(nx, nz)) {
      // pulled or swimming into the bank: it slides along the margin (or turns away if it's in a corner)
      if (lake.wet(nx, f.p.z)) { nz = f.p.z; f.v.z *= -0.2; } else if (lake.wet(f.p.x, nz)) { nx = f.p.x; f.v.x *= -0.2; }
      else { f.v.multiplyScalar(-0.3); nx = f.p.x; nz = f.p.z; }
      if (f.mode !== 'beaten') f.want = Math.atan2(this.stand.z - f.p.z, this.stand.x - f.p.x) + (Math.random() < 0.5 ? 1.3 : -1.3);
    }
    f.p.x = nx; f.p.z = nz;
    // depth: down when it runs or bores, up as it tires or the line lifts it
    const bottom = Math.max(0.25, lake.depthAt(f.p.x, f.p.z) - 0.15);
    const want = f.mode === 'beaten' ? 0.04 : f.mode === 'dive' ? bottom : f.mode === 'run' ? bottom * 0.7 : f.mode === 'rest' ? bottom * 0.6 : bottom * 0.45;
    const lift = Math.max(0, toTip.y) * T / Math.max(0.1, f.Fmax) * 0.8;
    f.y = clamp(f.y + ((want - f.y) * 0.6 - lift) * h, 0.03, bottom);
    // tiring
    const effort = (Fs / Math.max(0.01, f.Fmax)) * Math.min(1.5, sp / f.vmax) * 0.5 + (T / Math.max(0.01, f.Fmax)) * 0.6;
    const K = 15 * Math.pow(f.kg, 0.25) * f.stamina;
    f.E = clamp(f.E - effort / K * h + (f.mode === 'rest' && T < 0.3 * f.Fmax ? 0.012 * h : 0), 0, 1);
    if (f.E < 0.12 && f.mode !== 'beaten') { f.mode = 'beaten'; f.modeT = 4; this.events.push({ kind: 'beaten' }); }
    // snags: into the lilies or round an island's margin
    if (!f.snag) {
      const F = lake.features(f.p.x, f.p.z);
      if (F.lily < 0) { f.snag = 'lily'; f.snagT = 0; this.toast('It\'s in the lilies! Side strain, and keep it on the move', 2.5); this.G.haptics?.rumble(0.4, 0.3, 120); }
      else if (F.island < 1.2 && f.mode === 'run') { f.snag = 'island'; f.snagT = 0; this.toast('Round the island\'s roots! Ease off or it will cut you', 2.5); }
    } else {
      f.snagT += h;
      // the line rubbing: worse round an island's roots than through lily stems, worse the harder you pull
      if (T > 0.22 * BS) f.wear += h * (f.snag === 'island' ? 0.16 : 0.05) * (T / BS);
      const F = lake.features(f.p.x, f.p.z);
      if ((f.snag === 'lily' && F.lily > 1) || (f.snag === 'island' && F.island > 3)) { f.snag = null; this.toast('Out of the snag!', 1.5); }
      else if (T < 0.04 * BS && f.snagT > 4 && Math.random() < h * 0.25) { f.snag = null; f.want = Math.atan2(this.stand.z - f.p.z, this.stand.x - f.p.x); this.toast('Given slack, it\'s swum out', 2); }
    }
    // the line breaks (worn by a snag, it goes sooner)
    if (T > BS * 0.93 * (1 - Math.min(0.55, f.wear))) return this.lose(f.wear > 0.2 ? 'Cut off in the snag' : `Snapped! ${R.line} lb line`, 'snap');
    // a pike's teeth through mono (lure rods have a wire trace)
    if (f.s === 'pike' && this.method !== 'lure' && Math.random() < h * 0.06) return this.lose('Bitten off! A pike\'s teeth went through the line', 'snap');
    // the hook: pulled out by a hard jerk, or dropped out on a slack line
    const hold = (0.35 + 0.65 * f.hookQ) * f.mouth * (this.water.barbless ? 0.85 : 1) * (1.2 + f.kg * 0.45) * (f.mode === 'shake' ? 0.75 : 1);
    if (T > hold && Math.random() < (T / hold - 1) * 4 * h) return this.lose('The hook pulled', 'hook');
    if (T < 0.025) f.slackT += h; else f.slackT = 0;
    if (f.slackT > 1.1 && Math.random() < h * (this.water.barbless ? 0.4 : 0.12) * (1.25 - f.hookQ) * (f.mode === 'shake' ? 2 : 1)) return this.lose('Slack line: the hook dropped out', 'hook');
    // pike and perch jump and shake at the top
    if ((f.s === 'pike' || f.s === 'rudd') && f.y < 0.25 && f.mode === 'shake' && f.jumpT <= 0 && Math.random() < h * 0.6) { f.jumpT = 0.7; this.gear.splash(f.p.x, lake.level, f.p.z, Math.min(1.2, 0.3 + f.kg * 0.1)); this.G.audio?.fishShot?.('splash', f.p.x, lake.level, f.p.z, 0.8); }
    f.jumpT -= h;
    void k;
  }
  fightFrame(dt, I) {
    const f = this.fish, lake = this.lake;
    // thrashing at the surface: splashes and rings
    f.splashT = (f.splashT || 0) - dt;
    if (f.y < 0.35 && f.splashT <= 0 && (f.mode !== 'rest')) { f.splashT = 0.5 + Math.random() * 1.2; this.gear.splash(f.p.x, lake.level, f.p.z, Math.min(1, 0.12 + f.kg * 0.05) * (f.mode === 'beaten' ? 0.4 : 1)); if (Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z) < 25) this.G.audio?.fishShot?.(f.kg > 2 ? 'thrash' : 'splash', f.p.x, lake.level, f.p.z, Math.min(0.9, 0.2 + f.kg * 0.06)); }
    // the pad: the fish through the motors, the reel through R2 (haptics.js)
    this.hapT = (this.hapT || 0) - dt;
    if (this.hapT <= 0) { this.hapT = 0.12; const k = clamp(this.T / (this.rodSpec().line * LB), 0, 1); if (k > 0.08) this.G.haptics?.rumble(k * 0.55 + (this.slip > 0 ? 0.15 : 0), k * 0.3 + (f.mode === 'shake' ? 0.4 : 0), 140); }
    // small fish: swing them in; beaten ones near the bank: net them
    const near = Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z);
    this.canNet = f.y < 0.6 && near < 4.2;
    if (this.canNet && f.lb < 1.2 && I.reel > 0.3 && near < 3.4) this.swingIn();
    void dt;
  }
  tryNet() {
    if (this.state !== 'fight' || !this.fish) return;
    const f = this.fish, k = this.kit(), near = Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z);
    if (near > 4.2 || f.y > 0.6) { this.toast('Draw it closer first: it has to be at the top, under the rod tip', 2); return; }
    if (f.lb < 1.2) { this.swingIn(); return; }
    if (!k.net) {
      if (f.lb < 3) { if (Math.random() < 0.5 + (f.lb - 1.2) * 0.2) { this.lose('Lifting it out without a net, it fell off', 'hook'); return; } this.landed(); return; }
      this.toast('Too big to lift out: you need a landing net (TechZone)', 3); return;
    }
    this.state = 'netting'; this.netT = 0; this.netYaw = null;
    this.G.audio?.fishShot?.('plop', this.stand.x + Math.cos(this.h0) * 2.5, this.lake.level, this.stand.z + Math.sin(this.h0) * 2.5, 0.5, 0.7);
  }
  swingIn() {
    const f = this.fish; if (!f) return;
    if (f.E > 0.45 && f.lb > 0.5) { this.toast('Still lively: play it a bit longer', 1.5); return; }
    if (f.lb > 0.9 && Math.random() < 0.15) { this.lose('Swung in, it dropped off', 'hook'); return; }
    this.landed();
  }
  netting(dt, I) {
    const f = this.fish; this.netT += dt;
    // keep playing it while the net's in
    let acc = dt; while (acc > 1e-6 && this.state === 'netting') { const h = Math.min(1 / 120, acc); this.state = 'fight'; this.fightStep(h, I); if (this.state === 'fight') this.state = 'netting'; acc -= h; }
    if (this.state !== 'netting') return;
    // the net goes in towards the fish, as far as an arm and the pole reach
    const near = Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z), ny = Math.atan2(f.p.z - this.stand.z, f.p.x - this.stand.x);
    this.netYaw = this.netYaw == null ? ny : this.netYaw + clamp(angDiff(ny, this.netYaw), -1, 1) * Math.min(1, dt * 3);
    this.netReach = clamp(near - 0.3, 1.2, 2.8);
    const head = new THREE.Vector3(this.stand.x + Math.cos(this.netYaw) * this.netReach, 0, this.stand.z + Math.sin(this.netYaw) * this.netReach);
    const d = Math.hypot(f.p.x - head.x, f.p.z - head.z);
    if (this.netT > 0.6) {
      if (f.E > 0.18) { f.E = Math.min(1, f.E + 0.05); f.mode = 'run'; f.modeT = 3; f.want = Math.atan2(f.p.z - this.stand.z, f.p.x - this.stand.x); this.state = 'fight'; this.toast('It saw the net and bolted: it isn\'t beaten yet', 2.5); if (Math.random() < 0.08) this.lose('It bolted and the hook pulled', 'hook'); return; }
      // draw it over the net: pull it in towards the head
      f.want = Math.atan2(head.z - f.p.z, head.x - f.p.x);
      if (d < 1.4 && f.y < 0.5) { this.landed(); return; }
      if (this.netT > 6) { this.state = 'fight'; this.toast('Missed it with the net', 1.5); }
    }
  }
  lose(msg, how) {
    const f = this.fish;
    this.G.audio?.fishShot?.(how === 'snap' ? 'snap' : 'swish', this.stand.x, this.stand.y + 1.6, this.stand.z, how === 'snap' ? 0.8 : 0.3, how === 'snap' ? 1 : 1.4);
    this.G.haptics?.rumble(how === 'snap' ? 1 : 0.4, how === 'snap' ? 0.8 : 0.3, how === 'snap' ? 260 : 100);
    if (how === 'snap') this.loseRig(msg); else this.toast(msg + (f ? (f.kg > 4 ? '. That felt like a big one' : '') : ''), 3);
    if (f) { this.gear.splash(f.p.x, this.lake.level, f.p.z, Math.min(1, 0.2 + f.kg * 0.05)); this.events.push({ kind: 'lost', s: f.s }); }
    this.fish = null; this.state = 'ready'; this.rig = how === 'snap' ? null : { flying: false, p: new THREE.Vector3(), v: new THREE.Vector3(), bait: Math.random() < 0.5 ? this.rig?.bait : null };
    this.T = 0;
    return false;
  }
  landed() {
    const f = this.fish, k = this.kit(), lake = this.lake, me = this.G.brothers.me;
    const rod = k.rods[this.rodKind()]; if (rod) rod.wear = (rod.wear || 0) + 1;
    const cm = lengthCm(f.s, f.lb), prev = k.pb[f.s] || 0, best = STOCK[lake.id].fish[f.s].max;
    const rec = { s: f.s, lb: +f.lb.toFixed(3), cm: Math.round(cm), lake: lake.id, peg: this.peg.n, bait: this.method === 'lure' ? k.rods.lure.rig : this.rig?.bait, method: this.method, at: this.G.world?.s?.t || Date.now() / 1000, who: me.short };
    k.log.unshift(rec); if (k.log.length > 80) k.log.length = 80;
    if (f.lb > prev) k.pb[f.s] = rec.lb;
    k.stats ??= { fish: 0, weight: 0 }; k.stats.fish++; k.stats.weight += f.lb;
    this.caught = { ...rec, name: SPECIES[f.s].name, weight: lbOz(f.lb), kg: (f.lb * LB).toFixed(2), pb: f.lb > prev && prev > 0, first: !prev, lakeBest: f.lb >= best * 0.97, lakeName: lake.name };
    // the bait: a hookbait often comes back on the hook, often not
    if (this.rig && this.method !== 'lure' && Math.random() > ({ boilies: 0.7, corn: 0.3 }[this.rig.bait] ?? 0.1)) this.rig.bait = null;
    if (rod && rod.wear === 12) this.toast('That hook\'s getting blunt: change it (Tackle)', 3);
    this.state = 'landed'; this.landT = 0; this.photo = false;
    this.events.push({ kind: 'landed', s: f.s, lb: f.lb });
    this.G.haptics?.rumble(0.3, 0.5, 120);
    this.G.audio?.fishShot?.('splash', this.stand.x + Math.cos(this.h0) * 1.6, lake.level, this.stand.z + Math.sin(this.h0) * 1.6, 0.6);
    this.G.save?.now?.();
  }
  release_fish() {
    const f = this.fish, lake = this.lake;
    if (f) { const x = this.stand.x + Math.cos(this.h0) * 1.8, z = this.stand.z + Math.sin(this.h0) * 1.8; this.gear.splash(x, lake.level, z, 0.5); this.G.audio?.fishShot?.('splash', x, lake.level, z, 0.6); }
    this.fish = null; this.caught = null; this.state = 'ready'; this.photo = false;
    if (this.rig) { this.rig.inWater = false; }
  }
  // ---------------------------------------------------------------- the brother: stood at the peg, rod in hand
  pose() {
    const G = this.G, B = G.brothers, a = B.actor?.[B.active], me = B.me;
    me.x = this.stand.x; me.z = this.stand.z; me.y = this.stand.y;
    const face = this.state === 'landed' ? this.h0 + Math.PI * (this.photo ? 1 : 0) : this.rodYaw() - (this.onPod() ? 0.5 : 0.25);
    me.heading = face;
    if (a) { a.x = me.x; a.y = me.y; a.z = me.z; a.heading = face; a.speed = 0; a.pose = 'idle'; a.visible = true; a.t = (a.t || 0) + 1 / 60; a.armed = true; }
  }
  // the arms (riggedPeople → app.js onHero): the right hand round the handle above the reel, the left on the butt
  // when casting and holding, on the reel's handle when winding, on the net's pole when netting; both under the
  // fish for the picture
  poseArms(slot, a, arms) {
    if (!this.active || a.id !== 'brother' + this.G.brothers.active || !arms?.ok) return;
    const gear = this.gear; if (!gear.rodPts) return;
    slot.body.updateMatrixWorld(true);
    const holding = !this.onPod() && this.state !== 'landed';
    const UPv = UP;
    if (holding) {
      const L = gear.rodLen, d = _v.copy(gear.rodPts[2]).sub(gear.rodPts[0]).normalize().clone(), gl = new THREE.Vector3().crossVectors(UPv, d).normalize();
      const gripR = gear.along(this.method === 'lure' ? 0.26 : 0.48).addScaledVector(UPv, -0.03);
      const Fr = d.clone().multiplyScalar(0.9).addScaledVector(gl, 0.4).normalize(), Nr = gl.clone();
      arms.reach('R', arms.wristFor('R', gripR, Fr, Nr), Fr, Nr, new THREE.Vector3(0, -0.8, 0).addScaledVector(gl, -0.6), 1);
      arms.curl('R', [1.0, 1.1, 0.7], [1.05, 1.15, 0.75], [0.4, 0.5, 0.4], 1);
      const winding = (this.reelSpin || 0) > 0.05 && (this.state === 'fight' || this.state === 'fishing' || this.state === 'netting');
      let tL, FL, NL;
      if (this.state === 'netting') { tL = this.netGrip || gear.along(0.05); FL = d.clone(); NL = gl.clone().negate(); }
      else if (winding) { tL = gear.reelHandle(); FL = new THREE.Vector3(0, -1, 0).addScaledVector(d, 0.3).normalize(); NL = gl.clone().negate(); }
      else { tL = gear.along(0.05); FL = d.clone(); NL = gl.clone().negate(); }
      arms.reach('L', arms.wristFor('L', tL, FL, NL), FL, NL, new THREE.Vector3(0, -0.8, 0).addScaledVector(gl, 0.6), 1);
      arms.curl('L', [1.0, 1.1, 0.7], [1.05, 1.15, 0.75], [0.3, 0.4, 0.3], 1);
    } else if (this.state === 'landed' && this.photo && this.fishHold && this.fish) {
      const { p, dir } = this.fishHold, side = new THREE.Vector3().crossVectors(UPv, dir).normalize();
      const r = p.clone().addScaledVector(dir, this.fish.Lm * 0.18).addScaledVector(UPv, -0.06), l = p.clone().addScaledVector(dir, -this.fish.Lm * 0.28).addScaledVector(UPv, -0.06);
      const F = side.clone().negate(), N = UPv.clone();
      arms.reach('R', arms.wristFor('R', r, F, N), F, N, new THREE.Vector3(0, -0.8, 0).addScaledVector(side, 0.5), 1);
      arms.reach('L', arms.wristFor('L', l, F, N), F, N, new THREE.Vector3(0, -0.8, 0).addScaledVector(side, 0.5), 1);
    }
  }
  // ---------------------------------------------------------------- drawing
  draw(dt, I) {
    const G = this.G, gear = this.gear, lake = this.lake, m = this.method, kind = this.rodKind();
    const r = this.rig, f = this.fish;
    // the rod, bent to the pull
    const target = f ? new THREE.Vector3(f.p.x, lake.level - f.y, f.p.z) : r && (r.inWater || r.onBank || r.flying) ? r.p : null;
    const tip0 = this.tipOf(), toward = target ? new THREE.Vector3().subVectors(target, tip0).normalize() : new THREE.Vector3(0, -1, 0);
    let T = this.T || 0; if (!f && this.state === 'snagged') T = this.rodSpec().line * LB * 0.4 * Math.min(1, (this.snag?.pull || 0)); if (this.bite?.phase === 'take' && m === 'lure') T = 0.4;
    this.reelSpin = (I.reel || 0) * (this.slip > 0 ? 0 : 1); this.crank = (this.crank || 0) + this.reelSpin * dt * 18;
    const tip = gear.setRod(this.butt(), this.rodDir(), toward, T / (this.rodSpec().tc * LB) + (this.state === 'windup' ? 0.15 + this.charge * 0.25 : 0), kind, this.crank);
    // the line: tip to the rig (in flight an arc), sagging between when it's slack
    const pts = [];
    if (target) {
      const a = tip.clone(), b = target.clone(), n = 24, span = a.distanceTo(b);
      const slack = f ? Math.max(0, this.line - span) : r?.flying ? 0 : Math.max(0.05, (this.line || span) - span) + (m === 'float' ? 0.3 : 0.05);
      for (let i = 0; i <= n; i++) { const t = i / n, p = a.clone().lerp(b, t); p.y -= Math.sin(Math.PI * t) * Math.min(span * 0.12, slack * 0.6 + (f ? 0 : 0.02 * span)); if (p.y < lake.level - 0.01 && i < n && !f) p.y = Math.max(p.y, lake.level - 0.01); pts.push(p); }
    }
    gear.setLine(pts);
    // the float: cocked, dipping and going under on a bite
    if (m === 'float' && r && (r.inWater || r.flying) && !f) {
      let tipUp = 0.04, tilt = 0;
      if (r.flying) tipUp = 0.2; else if (this.state === 'settle') { tipUp = 0.18 * (1 - this.settleT / 1.2) + 0.04; tilt = 1.2 * (1 - this.settleT / 1.2); }
      const B = this.bite;
      if (B) { if (B.dip > 0) { B.dip -= dt; tipUp -= Math.sin((0.35 - B.dip) / 0.35 * Math.PI) * 0.03; }
        if (B.phase === 'take') { if (B.shape.run === 'lift' && B.tTake < B.shape.window * 0.5) { tipUp += 0.06; tilt = 0.8; } else { tipUp = -0.06 - B.tTake * 0.05; r.p.x += Math.cos(B.t) * dt * 0.2; r.p.z += Math.sin(B.t) * dt * 0.2; } } }
      tipUp += Math.sin(this.t * 1.7) * 0.004;
      gear.setFloat(r.p, tipUp, tilt);
    } else gear.setFloat(null);
    // the lure: where it's swimming as you wind
    if (m === 'lure' && r && (r.inWater || r.flying) && !f) gear.setLure(this.kit().rods.lure?.rig, r.flying ? r.p : new THREE.Vector3(r.p.x, lake.level - (r.lureDepth ?? 0.3), r.p.z), Math.atan2(this.stand.z - r.p.z, this.stand.x - r.p.x), this.t);
    else gear.setLure(null);
    // the carp rod's pod and alarm
    if (m === 'ledger' && this.state !== 'landed') {
      const P = this.stand, pp = this.podAt();
      this.alarmLed = Math.max(0, (this.alarmLed || 0) - dt * 6);
      gear.setPod(new THREE.Vector3(pp.x, P.y, pp.z), this.h0, this.alarmLed, this.bite?.phase === 'take' ? 1 : this.alarmLed * 0.3);
    } else gear.setPod(null);
    // the net: lying on the bank, or in the water
    const k = this.kit();
    if (k.net) {
      const P = this.stand, side = this.h0 - Math.PI / 2;
      if (this.state === 'netting') { const into = Math.min(1, this.netT / 0.5), ny = this.netYaw ?? this.h0, reach = (this.netReach ?? 2.6) - 0.5; const p = new THREE.Vector3(P.x + Math.cos(ny) * (0.8 + reach * into), lake.level + 0.05, P.z + Math.sin(ny) * (0.8 + reach * into)); gear.setNet(p, new THREE.Vector3(Math.cos(ny), 0, Math.sin(ny)), into); this.netGrip = new THREE.Vector3(P.x + Math.cos(ny) * 0.2, P.y + 0.95, P.z + Math.sin(ny) * 0.2); }
      else gear.setNet(new THREE.Vector3(P.x + Math.cos(side) * 1.1 + Math.cos(this.h0) * 0.6, P.y + 0.05, P.z + Math.sin(side) * 1.1 + Math.sin(this.h0) * 0.6), new THREE.Vector3(Math.cos(this.h0), 0, Math.sin(this.h0)), 0);
    } else gear.setNet(null);
    // the fish: under the surface while it fights (seen near the top), on the mat or held up when landed
    if (f && (this.state === 'fight' || this.state === 'netting')) {
      if (f.y < 0.7) gear.showFish(f.s, f.Lm, new THREE.Vector3(f.p.x, lake.level - f.y - f.Lm * 0.05, f.p.z), f.head, f.mode === 'beaten' ? 1.2 + Math.sin(this.t * 2) * 0.3 : 0, this.t * (6 + f.E * 8), 0.25 + f.E * 0.2);
      else gear.showFish(null);
    } else if (f && this.state === 'landed') {
      this.landT += dt;
      const P = this.stand, fwd = new THREE.Vector3(Math.cos(this.h0), 0, Math.sin(this.h0));
      if (this.photo) { const p = new THREE.Vector3(P.x, P.y + 1.05, P.z).addScaledVector(fwd, -0.38); const dir = new THREE.Vector3(Math.cos(this.h0 + Math.PI / 2), 0, Math.sin(this.h0 + Math.PI / 2)); this.fishHold = { p, dir }; gear.showFish(f.s, f.Lm, p, this.h0 + Math.PI / 2, 0, this.t * 3, 0.05); gear.setMat(null); }
      else { const p = new THREE.Vector3(P.x, P.y + 0.08 + f.Lm * 0.02, P.z).addScaledVector(fwd, 0.4).addScaledVector(new THREE.Vector3(Math.cos(this.h0 + Math.PI / 2), 0, Math.sin(this.h0 + Math.PI / 2)), 0.6); gear.showFish(f.s, f.Lm, p, this.h0 + Math.PI / 2, Math.PI / 2, this.t * 4, 0.12 + 0.1 * Math.max(0, Math.sin(this.landT * 1.3))); gear.setMat(k.mat ? new THREE.Vector3(p.x, P.y + 0.02, p.z) : null, this.h0); }
    } else { gear.showFish(null); gear.setMat(null); }
    // the target: where this cast would land (at full power while aiming, at the power so far while swinging back)
    if ((this.state === 'ready' || this.state === 'windup') && this.rigged()) {
      const pw = this.state === 'windup' ? (this.charge <= 1 ? Math.max(0.12, this.charge) : Math.max(0.55, 1 - (this.charge - 1) * 0.9)) : 1;
      const tp = this.predictCast(pw); this.aimDist = Math.hypot(tp.x - this.stand.x, tp.z - this.stand.z);
      gear.setTarget(tp, lake.wet(tp.x, tp.z));
    } else gear.setTarget(null);
    gear.update(dt);
  }
  // ---------------------------------------------------------------- sound
  sound(dt) {
    const A = this.G.audio; if (!A) return;
    const P = this.stand, reel = this.reelSpin || 0;
    for (const e of this.events) {
      if (e.kind === 'beep') { A.fishShot?.('beep', P.x, P.y + 0.6, P.z, 0.5, this.alarmTone || 1); this.alarmLed = 1; }
      else if (e.kind === 'take' && this.method === 'float') this.G.haptics?.rumble(0.2, 0.4, 90);
      else if (e.kind === 'thump') A.fishShot?.('swish', P.x, P.y + 1.4, P.z, 0.25, 1.6);
    }
    this.events.length = 0;
    // the reel: wound in (pitch with speed), and the clutch giving line on a run or a fish taking line
    const slip = Math.max(0, this.slip || 0) + (this.bite?.phase === 'take' && this.method === 'ledger' && this.bite.shape.run ? 1.6 : 0);
    A.fishLoops?.(reel > 0.05 && slip <= 0.05 ? 0.35 + reel * 0.4 : 0, 0.75 + reel * 0.5, slip > 0.05 ? Math.min(0.9, 0.3 + slip * 0.25) : 0, Math.min(1.8, 0.7 + slip * 0.3), P);
    void dt;
  }
  // ---------------------------------------------------------------- the camera: behind and over the shoulder, out to the float or the fish
  placeCamera(dt) {
    const G = this.G, cam = G.camera, P = this.stand, lake = this.lake;
    let look, from, fov = 50;
    const yawFace = this.rodYaw(), bx = Math.cos(yawFace), bz = Math.sin(yawFace);
    if (this.state === 'landed') {
      const f = this.fish, fwd = new THREE.Vector3(Math.cos(this.h0), 0, Math.sin(this.h0));
      if (this.photo) { look = new THREE.Vector3(P.x, P.y + 1.2, P.z); from = look.clone().addScaledVector(fwd, -2.6).add(new THREE.Vector3(0, 0.15, 0)); fov = 45; }
      else { look = new THREE.Vector3(P.x, P.y + 0.15, P.z).addScaledVector(fwd, 0.4).addScaledVector(new THREE.Vector3(Math.cos(this.h0 + Math.PI / 2), 0, Math.sin(this.h0 + Math.PI / 2)), 0.6); from = look.clone().addScaledVector(fwd, 1.4).add(new THREE.Vector3(0, 1.3 + (f?.Lm || 0.5), 0)); fov = 50; }
    } else {
      // what we're watching: the fish, the float, the rig in flight, or out over the water where we'd cast
      let tgt;
      if (this.fish) tgt = new THREE.Vector3(this.fish.p.x, lake.level, this.fish.p.z);
      else if (this.rig && (this.rig.inWater || this.rig.flying || this.rig.onBank)) tgt = this.rig.p.clone();
      else { const y = this.h0 + this.aim, d = this.kit().clip[this.method] || 22; tgt = new THREE.Vector3(P.x + Math.cos(y) * d, lake.level, P.z + Math.sin(y) * d); }
      const dist = Math.hypot(tgt.x - P.x, tgt.z - P.z);
      const yaw = Math.atan2(tgt.z - P.z, tgt.x - P.x) + this.camYaw;
      const back = this.state === 'fight' ? 3.6 : 3.0, up = this.state === 'fight' ? 2.4 : 2.0;
      from = new THREE.Vector3(P.x - Math.cos(yaw) * back + Math.cos(yaw - Math.PI / 2) * 0.9, P.y + up + this.camPitch * 2, P.z - Math.sin(yaw) * back + Math.sin(yaw - Math.PI / 2) * 0.9);
      // a fish close in: swing round to the side and up, looking down past you at it coming to the net
      if (this.fish) {
        const k = clamp((9 - dist) / 6, 0, 1);
        if (k > 0) { const side = yaw - Math.PI / 2, near = new THREE.Vector3(P.x + Math.cos(side) * 3.2 - Math.cos(yaw) * 0.6, P.y + 2.7, P.z + Math.sin(side) * 3.2 - Math.sin(yaw) * 0.6); from.lerp(near, k); }
      }
      look = tgt.clone(); look.y = lake.level + 0.1;
      // zoom in on a float out in the lake so you can watch it
      if (this.method === 'float' && this.rig?.inWater && !this.fish) fov = clamp(2 * Math.atan(7 / Math.max(8, dist)) * 57.3, 18, 50);
      else if (this.fish) fov = clamp(2 * Math.atan(16 / Math.max(6, dist)) * 57.3, 30, 58);
      else fov = 52;
      void bx; void bz;
    }
    const k = Math.min(1, dt * 4);
    this.camFrom = this.camFrom ? this.camFrom.lerp(from, k) : from.clone();
    this.camLook = this.camLook ? this.camLook.lerp(look, Math.min(1, dt * 6)) : look.clone();
    cam.position.copy(this.camFrom); cam.lookAt(this.camLook);
    const nf = cam.fov + (fov - cam.fov) * Math.min(1, dt * 3);
    if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
  }
  toast(t, s = 2) { this.G.hud?.toast?.(t, s); this.msgs.push({ t, at: this.t }); }
  // ---------------------------------------------------------------- what the HUD shows
  status() {
    const R = this.rodSpec(), k = this.kit(), f = this.fish, B = this.bite;
    return {
      state: this.state, method: this.method, rod: R.name, line: R.line, drag: this.dragLb(), dragMax: R.drag[1], tension: this.T ? this.T / LB : 0,
      lineOut: this.line || 0, distance: this.rig ? Math.hypot(this.rig.p.x - this.stand.x, this.rig.p.z - this.stand.z) : 0,
      bait: k.sel[this.method], baitLeft: this.baitLeft(k.sel[this.method]), clip: k.clip[this.method] || 0, charge: this.charge, power: this.power,
      bite: B ? { phase: B.phase, dip: B.dip || 0, t: B.tTake } : null, fishE: f?.E, fishNear: f ? Math.hypot(f.p.x - this.stand.x, f.p.z - this.stand.z) : 0, canNet: !!this.canNet,
      snag: this.state === 'snagged' || !!f?.snag, rigged: this.rigged(), open: this.state === 'ready' || this.state === 'windup' ? this.openWater() : 0, aimDist: this.aimDist || 0, wear: k.rods[this.rodKind()]?.wear || 0, lake: this.lake?.name, peg: this.peg?.n, caught: this.caught, photo: this.photo,
    };
  }
}

// the price of a cash spend check for the HUD's ticket dialog
export const canAfford = (b, price) => cash(b) + 1e-6 >= price;
