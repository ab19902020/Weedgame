// Taxis, and Kerb: the ride app on your phone.
//
// Cabs work the streets, most of them round the town centres: hackney carriages (black, white and silver saloons)
// with the TAXI sign on the roof, lit while they're for hire. Wave one down as it comes along towards you (Use: "Hail
// taxi") and it pulls in beside you.
// Or book one on the phone (phone.js): Kerb, where to and what it'll cost; a driver's sent from a few streets away
// (you can watch it come on the map); it pulls up beside you with its hazards on; you get in the back (Use) and it
// drives you there through the traffic. Ask it to stop early (Use, or the phone), or skip the journey (the phone).
// The fare's paid from your cash when you're dropped off, on the kerb side.
import * as THREE from 'three/webgpu';
import { cash, spend } from './food.js';
import { makeRoute, distanceLabel } from './navigation.js';

const DRIVERS = ['Amir', 'Priya', 'Tomasz', 'Dave', 'Kwame', 'Sarah', 'Imran', 'Chloe', 'Marek', 'Gary', 'Aisha', 'Ravi', 'Jo', 'Femi', 'Lukas', 'Bev', 'Sunil', 'Ola'];
const KERB_CARS = [['evsaloon', 'electric saloon'], ['evsaloon', 'electric saloon'], ['saloon', 'saloon'], ['estate', 'estate'], ['evsuv', 'electric SUV']];
const KERB_PAINTS = [[0x111111, 'black'], [0xe8e8e8, 'white'], [0x9aa0a6, 'silver'], [0x5a5f66, 'grey'], [0x1f2a44, 'navy']];
const CAB_PAINTS = [0x111111, 0x111111, 0x111111, 0xe8e8e8, 0xe8e8e8, 0x9aa0a6];
const CAB_MODELS = /^(saloon|estate|evsaloon)$/;
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXY';
// a Berkshire minicab's rates (to the nearest 5p): £3.20 to start, £1.75 a kilometre, £5 at least
export const fare = metres => Math.round(Math.max(5, 3.2 + 1.75 * metres / 1000) * 20) / 20;
// a Reading registration: R and a letter, the age, three letters
export const plate = (r = Math.random) => { const L = () => LETTERS[Math.floor(r() * LETTERS.length)]; return 'R' + L() + String([19, 69, 20, 70, 21, 71, 22, 72, 23, 73][Math.floor(r() * 10)]) + ' ' + L() + L() + L(); };
const ROADS = (net, e) => (net.flags[e] & 16) && !/motorway|service|track/.test(net.classes[net.cls[e]]);

export class Taxis {
  constructor(G, info) {
    this.G = G; this.info = info; this.job = null; this.history = [];
    G.traffic.onSpawn = v => this.maybeCab(v);
    // the roof signs: a pool of boxes put on the cabs near the camera, lit while they're for hire
    const tex = this.signTexture();
    this.signOn = new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffc21a, emissiveIntensity: 0.9, emissiveMap: tex, map: tex, roughness: 0.4 });
    this.signOff = new THREE.MeshStandardMaterial({ color: 0xcfc9b6, map: tex, roughness: 0.6 });
    this.signGeo = new THREE.BoxGeometry(0.22, 0.15, 0.62);
    this.signs = [];
  }
  signTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#f5d64a'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#141414'; g.font = '900 25px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 64, 17);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // a car just added to the traffic: about one in forty is a cab, one in six in a town centre
  maybeCab(v) {
    if (v.kind !== 'traffic' || !CAB_MODELS.test(v.model)) return;
    const d = this.G.districtAt?.(v.x, v.z), core = d?.core ? Math.max(0, 1 - Math.hypot(v.x - d.x, v.z - d.z) / d.coreR) : 0;
    if (Math.random() > 0.025 + core * 0.15) return;
    v.cab = true; v.paint = CAB_PAINTS[Math.floor(Math.random() * CAB_PAINTS.length)];
  }
  // ---------------------------------------------------------------- the phone's side of it
  // the places the phone offers: your waypoint, home, and the nearest of each kind on the Road Atlas
  destinations(kind) {
    const G = this.G, me = G.brothers.me, cats = G.hud.placeCategories || {};
    const list = (cats[kind]?.() || []).map(s => { const x = s.dx ?? s.x, z = s.dz ?? s.z; return { x, z, name: s.title || s.name, district: s.district, distance: Math.hypot(x - me.x, z - me.z) }; });
    return list.filter(p => Number.isFinite(p.distance) && p.distance > 60).sort((a, b) => a.distance - b.distance).slice(0, 8);
  }
  // what it'll cost to (x, z), and how long: by the roads
  quote(dest) {
    const G = this.G, me = G.brothers.me, r = makeRoute(G.net, me, dest, false);
    if (!r || r.length < 40) return null;
    return { dest, metres: r.length, fare: fare(r.length), mins: Math.max(2, Math.round(r.length / 8.5 / 60)), distance: distanceLabel(r.length) };
  }
  // book a Kerb: a driver a few streets away is sent to where you're standing
  book(q) {
    const G = this.G, me = G.brothers.me;
    if (this.job) return 'busy';
    if (G.wanted?.level) return 'wanted';
    if (me.vehicle || me.inside) return 'place';
    if (cash(me) + 1e-6 < q.fare) return 'cash';
    const at = this.kerbside(me.x, me.z); if (!at) return 'road';
    const [model, label] = KERB_CARS[Math.floor(Math.random() * KERB_CARS.length)], [paint, colour] = KERB_PAINTS[Math.floor(Math.random() * KERB_PAINTS.length)];
    const v = this.sendCar(at, model, paint, 230, 480);
    if (!v) return 'none';
    const driver = DRIVERS[Math.floor(Math.random() * DRIVERS.length)];
    this.job = { kind: 'kerb', v, dest: q.dest, fare: q.fare, metres: q.metres, driver, car: `${colour} ${label}`, plate: plate(), stage: 'coming', t: 0, at };
    v.kerb = true; v.hired = true;
    G.hud.feed(`Kerb: ${driver} is on the way · ${this.job.car} · ${this.job.plate}`);
    return 'ok';
  }
  cancel(why = 'Ride cancelled') {
    const J = this.job; if (!J || J.stage === 'riding') return;
    this.release(J.v); this.job = null; this.G.hud.toast(why);
  }
  // the road point by you a car can stop at
  kerbside(x, z) {
    const net = this.G.net, n = net.nearest(x, z, 40, e => ROADS(net, e));
    return n ? { x: n.x, z: n.z, e: n.e, s: n.s } : null;
  }
  // a car from a few streets away, out of sight, on its way to `at`
  sendCar(at, model, paint, r0, r1) {
    const G = this.G, net = G.net;
    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * 6.283, r = r0 + Math.random() * (r1 - r0);
      const n = net.nearest(at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, 150, e => ROADS(net, e));
      if (!n || Math.hypot(n.x - at.x, n.z - at.z) < r0 * 0.6) continue;
      const h = n.e * 2 + (net.flags[n.e] & 1 ? 0 : (Math.random() < 0.5 ? 0 : 1));
      if (!net.outD[net.startNode(h)].includes(h)) continue;
      const p = net.at(h, Math.max(0.5, Math.min((h & 1) ? net.len[n.e] - n.s : n.s, net.len[n.e] - 1)), []);
      if (this.info?.visible?.(p[0], p[1] + 1, p[2], 3) && Math.hypot(p[0] - G.camera.position.x, p[2] - G.camera.position.z) < 300) continue;
      const v = G.traffic.spawnAt(h, Math.max(0.5, Math.min((h & 1) ? net.len[n.e] - n.s : n.s, net.len[n.e] - 1)), { kind: 'taxi', model, paint, v: 6 });
      if (!v) continue;
      if (!this.routeTo(v, at)) { G.traffic.remove(v); continue; }
      v.persistent = true; v.status = 'pickup';
      return v;
    }
    return null;
  }
  // plan the way to a road point; the car pulls up there (traffic.js stops a 'pickup' car at its target)
  routeTo(v, at) {
    const net = this.G.net, start = net.endNode(v.h);
    let best = null;
    for (const h of [at.e * 2, at.e * 2 + 1]) {
      if (!net.outD[net.startNode(h)].includes(h)) continue;
      // already on the right road with the spot ahead
      if (h === v.h) { const s = (h & 1) ? net.len[at.e] - at.s : at.s; if (s > v.s + 3) { best = { h, path: null, len: s - v.s }; break; } }
      const path = start === net.startNode(h) ? [] : net.route(start, net.startNode(h), { limit: 250000 });
      if (!path) continue;
      const len = path.reduce((a, q) => a + net.len[q >> 1], 0);
      if (!best || len < best.len) best = { h, path, len };
    }
    if (!best) return false;
    v.route = best.path ? [v.h, ...best.path, best.h] : [v.h]; v.ri = 0; v.dest = net.endNode(best.h); v.fixedRoute = false;
    v.target = { x: at.x, z: at.z }; v.routedAt = this.G.time;
    return true;
  }
  // the car goes back to being ordinary traffic
  release(v) {
    if (!v || v.dead) return;
    Object.assign(v, { kerb: false, hired: false, parked: false, occupied: false, hazard: false, target: null, status: null, persistent: false, fixedRoute: false });
    if (v.kind === 'taxi') v.kind = 'traffic';
  }
  // ---------------------------------------------------------------- per frame
  // a cab for hire coming along the road towards you, close: Use waves it down
  hailable() {
    const G = this.G, me = G.brothers.me;
    if (this.job || me.vehicle || me.inside || G.transit.ride || G.wanted?.level) return null;
    let best = null, bd = 34;
    for (const v of G.traffic.list) {
      if (!v.cab || v.hired || v.parked || v.player || v.dead || v.kind !== 'traffic') continue;
      const dx = me.x - v.x, dz = me.z - v.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 4) continue;
      const ahead = dx * Math.cos(v.heading) + dz * Math.sin(v.heading), side = Math.abs(-dx * Math.sin(v.heading) + dz * Math.cos(v.heading));
      if (ahead > 3 && side < 14) { bd = d; best = v; }
    }
    return best;
  }
  hail(v) {
    const G = this.G, me = G.brothers.me, at = this.kerbside(me.x, me.z);
    if (!at || !this.routeTo(v, at)) return false;
    v.kind = 'taxi'; v.hired = true; v.status = 'pickup'; v.persistent = true;
    this.job = { kind: 'cab', v, dest: null, fare: 0, driver: DRIVERS[Math.floor(Math.random() * DRIVERS.length)], car: 'taxi', plate: plate(), stage: 'coming', t: 0, at };
    G.hud.toast('Taxi! It\'s pulling in for you');
    return true;
  }
  // before the brothers move (app.js): boarding, and the ride itself (true while you're in the back)
  ride(dt) {
    const G = this.G, I = G.input, B = G.brothers, me = B.me, J = this.job;
    if (!J) {
      const cab = this.hailable(), free = cab && !G.interiors?.prompt && !B.nearestVehicle() && !G.transit.nearby(me) && cab;
      this.hailCab = free || null;
      if (free && I.consume('use')) this.hail(free);
      return false;
    }
    this.hailCab = null;
    const v = J.v; J.t += dt;
    if (v.dead || v.player) { if (J.stage === 'riding') this.dropOff(true); this.job = null; G.hud.toast('Your ride was cancelled'); return false; }
    if (J.stage === 'coming' || J.stage === 'waiting') {
      const d = Math.hypot(v.x - J.at.x, v.z - J.at.z);
      // pulled up: hazards on, waiting for you
      if (J.stage === 'coming' && d < 14 && v.v < 0.4 && !v.parked) {
        Object.assign(v, { parked: true, v: 0, occupied: true, hazard: true, status: 'waiting' }); J.stage = 'waiting'; J.waitT = 0;
        G.hud.feed(J.kind === 'kerb' ? `Kerb: ${J.driver} is here · ${J.car} · ${J.plate}` : 'Your taxi is waiting');
        G.haptics?.select?.();
      }
      // gone past, or lost: plan it round again
      if (J.stage === 'coming' && (G.time - (v.routedAt || 0)) > 6 && (d > 60 && v.ri >= v.route.length - 1 || v.stuck > 20)) this.routeTo(v, J.at);
      if (J.stage === 'waiting' && (J.waitT += dt) > 240) { this.cancel(J.kind === 'kerb' ? `Kerb: ${J.driver} couldn't wait any longer` : 'The taxi drove off'); return false; }
      // you walked off: it comes to where you are now
      if (J.stage === 'coming' && Math.hypot(me.x - J.at.x, me.z - J.at.z) > 60) { const at = this.kerbside(me.x, me.z); if (at && this.routeTo(v, at)) J.at = at; }
      if (J.stage === 'waiting' && Math.hypot(me.x - v.x, me.z - v.z) > 90) { const at = this.kerbside(me.x, me.z); if (at && this.routeTo(v, at)) { J.at = at; J.stage = 'coming'; Object.assign(v, { parked: false, hazard: false, status: 'pickup' }); } }
      // in the back
      if (J.stage === 'waiting' && !me.vehicle && Math.hypot(me.x - v.x, me.z - v.z) < v.def.W / 2 + 3.2 && I.consume('use')) this.getIn();
      return false;
    }
    if (J.stage !== 'riding') return false;
    // riding along
    if (!J.dest && !J.asked) { J.asked = true; G.phone?.toggle(true, 'kerbWhere'); }
    const d = J.dest ? Math.hypot(v.x - J.drop.x, v.z - J.drop.z) : 1e9;
    if (J.dest && d < 14 && v.v < 0.4 && J.t > 2) { this.dropOff(false); return false; }
    if (J.dest && (G.time - (v.routedAt || 0)) > 6 && (d > 80 && v.ri >= v.route.length - 1 || v.stuck > 25)) this.routeTo(v, J.drop);
    if (I.consume('use')) this.stopHere();
    I.consume('swap'); I.consume('jump'); I.consume('hit'); I.consume('pickup'); I.consume('wheel');
    me.x = v.x; me.z = v.z; me.y = v.y; me.heading = v.heading;
    B.actor[B.active].visible = false;
    const look = I.takeLook(), c = B.cam;
    if (look.dx || look.dy) { c.yaw += look.dx * 0.0062; c.pitch = Math.max(-0.25, Math.min(1.1, c.pitch + look.dy * 0.0045)); c.lastUser = G.time; }
    return true;
  }
  get riding() { return this.job?.stage === 'riding'; }
  // the camera while you're in the back (app.js, after the traffic has moved): behind the car, the right stick to
  // look round
  view(dt) {
    const v = this.job?.v; if (!v) return;
    const B = this.G.brothers;
    B.followCam(dt, v.x, v.y + 1.5, v.z, 7.4, v.v > 1 ? v.heading : null, 1.5, 0.24);
  }
  // the destination's road point, and the car sent on its way there
  setDest(dest) {
    const J = this.job; if (!J) return false;
    const G = this.G, drop = this.kerbside(dest.x, dest.z) || (() => { const n = G.net.nearest(dest.x, dest.z, 150, e => ROADS(G.net, e)); return n && { x: n.x, z: n.z, e: n.e, s: n.s }; })();
    if (!drop) return false;
    J.dest = dest; J.drop = drop;
    if (!J.fare) { const r = makeRoute(G.net, { x: J.v.x, z: J.v.z }, dest, false); J.metres = r?.length || Math.hypot(dest.x - J.v.x, dest.z - J.v.z) * 1.3; J.fare = fare(J.metres); }
    if (J.stage === 'riding') { Object.assign(J.v, { status: 'pickup' }); this.routeTo(J.v, drop); }
    return true;
  }
  getIn() {
    const G = this.G, J = this.job, v = J.v, me = G.brothers.me;
    J.stage = 'riding'; J.t = 0;
    G.audio?.play?.('Car_Door_Open', v.x, v.y + 1, v.z, 0.5);
    setTimeout(() => G.audio?.play?.('Car_Door_Close', v.x, v.y + 1, v.z, 0.5), 900);
    Object.assign(v, { parked: false, hazard: false, occupied: true, status: 'pickup' });
    G.brothers.cam.yaw = v.heading + Math.PI; G.brothers.cam.lastUser = -10;
    me.riding = v.id;
    if (J.dest) this.setDest(J.dest);
    G.hud.toast(J.dest ? `On the way to ${J.dest.name} · ${J.fare ? '£' + J.fare.toFixed(2) : ''}` : 'Where to? (your phone)');
  }
  // ask to be let out now: it pulls in at the next bit of kerb
  stopHere() {
    const J = this.job, v = J?.v; if (!J || J.stage !== 'riding') return;
    const net = this.G.net, ahead = net.at(v.h, Math.min(net.len[v.h >> 1], v.s + 25), []);
    const at = this.kerbside(ahead[0], ahead[2]); if (!at) return;
    // charged for the distance so far (the meter), not the whole way
    J.short = true; J.dest = { x: at.x, z: at.z, name: this.G.roadName(at.x, at.z) || 'here' }; J.drop = at;
    this.routeTo(v, at); this.G.hud.toast('Pulling in…');
  }
  // out on the kerb side (the left, here), the fare paid
  dropOff(abandoned) {
    const G = this.G, J = this.job, v = J.v, B = G.brothers, me = B.me;
    const h = v.heading, side = v.def.W / 2 + 0.75;
    let x = v.x + Math.sin(h) * side, z = v.z - Math.cos(h) * side;
    if (G.tiles.insideBuilding?.(x, z)) { x = v.x - Math.sin(h) * side; z = v.z + Math.cos(h) * side; }
    me.x = x; me.z = z; me.y = G.tiles.ground(x, z, v.y + 1) ?? v.y; me.heading = h; me.riding = null;
    B.actor[B.active].visible = true; B.cam.yaw = h + Math.PI; B.cam.lastUser = -10;
    this.job = null;
    G.audio?.play?.('Car_Door_Close', v.x, v.y + 1, v.z, 0.5);
    if (abandoned) { this.release(v); return; }
    this.pay(J);
    Object.assign(v, { parked: true, v: 0, occupied: true, hazard: true, status: 'waiting' });
    setTimeout(() => this.release(v), 2500);
  }
  pay(J) {
    const G = this.G, me = G.brothers.me;
    let due = J.fare || fare(J.metres || 0);
    if (J.short) due = (J.travelled || 0) < 30 ? 0 : Math.min(due, fare(J.travelled));   // let out early: what's on the meter (nothing if it never moved off)
    const paid = Math.min(cash(me), due);
    spend(me, paid); this.history.push({ to: J.dest?.name, fare: paid });
    G.hud.toast(`${J.dest?.name || 'Arrived'} · £${paid.toFixed(2)} paid${paid + 1e-6 < due ? ' (all you had)' : ''} · ${me.short} has £${cash(me).toFixed(2)}`, 5);
    G.phone?.arrived?.(J, paid);
  }
  // the phone's Skip: there in a cut, the fare paid
  skip() {
    const G = this.G, J = this.job; if (!J || J.stage !== 'riding' || !J.dest) return;
    const v = J.v, B = G.brothers, me = B.me;
    this.job = null; me.riding = null; B.actor[B.active].visible = true;
    this.pay(J);
    G.traffic.remove(v);
    const h = Math.atan2(J.drop.z - me.z, J.drop.x - me.x);
    G.teleport(J.drop.x, J.drop.z, h);
  }
  // per frame (always): the meter while riding, and the roof signs
  update(dt) {
    const J = this.job;
    if (J?.stage === 'riding') { J.travelled = (J.travelled || 0) + Math.abs(J.v.v || 0) * dt; }
    this.drawSigns();
  }
  drawSigns() {
    const G = this.G, cam = G.camera.position; let n = 0;
    for (const v of G.traffic.list) {
      if (!v.cab || v.hidden || v.dead || v.player) continue;
      const dx = v.x - cam.x, dz = v.z - cam.z; if (dx * dx + dz * dz > 170 * 170) continue;
      let s = this.signs[n];
      if (!s) { s = this.signs[n] = new THREE.Mesh(this.signGeo, this.signOn); s.castShadow = false; s.frustumCulled = false; G.scene.add(s); }
      s.visible = true; s.material = v.hired ? this.signOff : this.signOn;
      const h = v.heading; s.position.set(v.x - Math.cos(h) * 0.2, (v.y || 0) + v.def.H + 0.07, v.z - Math.sin(h) * 0.2); s.rotation.set(v.roll || 0, -h, v.pitch || 0, 'YXZ');
      if (++n >= 24) break;
    }
    for (let i = n; i < this.signs.length; i++) this.signs[i].visible = false;
  }
  // for the phone: where the job is up to, in words
  status() {
    const J = this.job; if (!J) return null;
    const G = this.G, v = J.v, me = G.brothers.me;
    if (J.stage === 'coming') { const d = Math.hypot(v.x - me.x, v.z - me.z); return { stage: 'coming', eta: Math.max(1, Math.round(d * 1.4 / 9 / 60)), metres: d }; }
    if (J.stage === 'waiting') return { stage: 'waiting', metres: Math.hypot(v.x - me.x, v.z - me.z) };
    const d = J.drop ? Math.hypot(v.x - J.drop.x, v.z - J.drop.z) : 0;
    return { stage: 'riding', eta: J.dest ? Math.max(1, Math.round(d * 1.35 / 8.5 / 60)) : null, metres: d };
  }
}
