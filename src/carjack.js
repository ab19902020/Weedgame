// Taking anyone's vehicle, GTA style. Any car on the road with someone at the wheel (the supplied BMWs, the Volvo,
// the Mercedes, the fleet, cabs) and any bike, moped or scooter with someone on it can be had, stopped or crawling:
//   a car: Use and the brother runs to the driver's door (the right: these are British cars), yanks it open, drags
//     the driver out and throws them down in the road, gets in and drives off. They pick themselves up and run.
//   a bike, moped or scooter: he boots the rider off it, they go sprawling, and he's on.
// Not buses, the police, ambulances or fire engines, a taxi on a job, or Cal's own cars.
// Also here: someone thrown off a bike when a car hits it, and the bike going down on its side and sliding.
import { People } from './characters.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpA = (a, b, t) => a + wrap(b - a) * t;
const EXCLUDE = new Set(['police', 'ambulance', 'fire', 'recovery', 'bus']);

export class Carjack {
  constructor(G) {
    this.G = G; this.job = null; this.near = null; this.fallen = []; this.downed = new Set();
    G.events?.on?.('vehicleHit', e => this.onHit(e));
  }
  // ---------------------------------------------------------------- what can be had
  stealable(v) {
    if (!v.def || v.player || v.hidden || v.dead || v.owner || v.law || v.driven || v.busData || v.towFor || v.hired || v.kerb || v.fallenBike) return false;
    if (EXCLUDE.has(v.kind) || /^bus/.test(v.model) || v.retiredCrew) return false;
    if (v.parked && v.occupied !== true) return false;          // empty (the ordinary Get in), or a brother sat in it
    return (v.v || 0) < (v.def.wheels === 2 ? 7 : 5.5);         // stopped or crawling
  }
  // where you stand to take it: the driver's door (on the right), or beside a bike
  door(v, out = 0.55) {
    const h = v.heading, fx = Math.cos(h), fz = Math.sin(h), rx = -fz, rz = fx, bike = v.def.wheels === 2;
    const along = bike ? 0 : v.def.L * 0.08, side = bike ? -(v.def.W / 2 + 0.45) : v.def.W / 2 + out;
    return { x: v.x + fx * along + rx * side, z: v.z + fz * along + rz * side, rx, rz, fx, fz };
  }
  target() {
    const G = this.G, me = G.brothers.me;
    let best = null, bd = 5.5;
    for (const v of G.traffic.list) {
      const dx = v.x - me.x, dz = v.z - me.z; if (dx * dx + dz * dz > 100) continue;
      if (!this.stealable(v)) continue;
      const d = this.door(v), dd = Math.hypot(d.x - me.x, d.z - me.z);
      if (dd < bd) { bd = dd; best = v; }
    }
    return best;
  }
  // ---------------------------------------------------------------- per frame (before Cal moves: app.js)
  // true while a theft is under way (the brother is ours to move)
  update(dt) {
    const G = this.G, B = G.brothers, me = B.me, I = G.input;
    this.stepFallen(dt);
    const pv = me.vehicle && G.traffic.byId.get(me.vehicle);
    if (pv?.fallenBike) { pv.fallenBike = false; pv.crashed = false; }
    if (!this.job) {
      const busy = me.vehicle || me.inside || G.transit.ride || G.taxis?.riding || G.wanted?.holding?.() || G.interiors?.homeTV?.seated;
      this.near = busy ? null : this.target();
      if (this.near && I.pressed.has('use') && !G.interiors?.prompt && !B.nearestVehicle()) { I.consume('use'); this.start(this.near); }
      if (!this.job) return false;
    }
    return this.step(dt);
  }
  start(v) {
    const G = this.G, bike = v.def.wheels === 2;
    // it stops where it is (pulled up short), its driver still in it for now
    this.job = { v, bike, stage: 'run', t: 0, v0: v.v || 0, role: 'cal' };
    Object.assign(v, { parked: true, occupied: true, jacked: true });
    this.near = null;
  }
  step(dt) {
    const G = this.G, B = G.brothers, me = B.me, a = B.actor[B.active], J = this.job, v = J.v;
    J.t += dt;
    // the vehicle rolls to a stop
    if (J.v0 > 0.05) { const s = J.v0 * dt; v.x += Math.cos(v.heading) * s; v.z += Math.sin(v.heading) * s; J.v0 *= Math.exp(-dt * 5); v.v = J.v0; }
    if (v.dead || v.player) { this.abort(); return false; }
    // facing the car: from the driver's door on its right, or from a bike's left
    const D = this.door(v), face = J.bike ? Math.atan2(D.rz, D.rx) : Math.atan2(-D.rz, -D.rx);
    switch (J.stage) {
      case 'run': {
        // to the door, round the car if need be
        let tx = D.x, tz = D.z;
        const via = G.emergency?.around?.(v, me.x, me.z, D.x, D.z); if (via) { tx = via[0]; tz = via[1]; }
        const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz), sp = 4.6;
        if (d < 0.2 && !via || J.t > 4) { me.x = D.x; me.z = D.z; J.stage = J.bike ? 'boot' : 'yank'; J.t = 0; this.anim(a, 0, face, dt); if (!J.bike) G.audio?.play?.('Car_Door_Open', v.x, v.y + 1, v.z, 0.6); break; }
        const st = Math.min(d, sp * dt); me.x += dx / d * st; me.z += dz / d * st;
        me.y = G.tiles.ground(me.x, me.z, me.y + 0.5) ?? me.y;
        this.anim(a, sp, Math.atan2(dz, dx), dt);
        break;
      }
      case 'yank': {
        // the door open, a fist in, and the driver dragged out and thrown down in the road
        this.anim(a, 0, face, dt);
        if (!J.clip) { J.clip = true; a.kickT = 0.9; a.kickClip = J.role === 'cal' ? 'box_02' : 'pitch_baseball'; }
        if (J.t > 0.42 && !J.victim) { J.victim = this.eject(v, Math.atan2(D.rz, D.rx) + (Math.random() - 0.5) * 0.6, 2.6); G.audio?.play?.('punch', v.x, v.y + 1, v.z, 0.6); G.haptics?.hit?.(false); }
        if (J.t > 1.05) { J.stage = 'in'; J.t = 0; }
        break;
      }
      case 'boot': {
        // a boot to the rider and they're off it
        this.anim(a, 0, face, dt);
        if (!J.clip) { J.clip = true; a.kickT = 0.9; a.kickClip = 'front_kick_02'; }
        if (J.t > 0.32 && !J.victim) { J.victim = this.eject(v, Math.atan2(D.rz, D.rx) + (Math.random() - 0.5) * 0.5, 3.2); v.occupied = false; G.audio?.play?.('kick', v.x, v.y + 1, v.z, 0.7); G.haptics?.hit?.(true); }
        if (J.t > 0.8) { J.stage = 'in'; J.t = 0; }
        break;
      }
      case 'in': {
        // in (or on), the door shut, away
        this.anim(a, 0, face, dt);
        me.x += (v.x - me.x) * Math.min(1, dt * 6); me.z += (v.z - me.z) * Math.min(1, dt * 6);
        if (J.t > (J.bike ? 0.25 : 0.45)) this.finish();
        break;
      }
    }
    // the camera: close behind him
    if (this.job) B.followCam(dt, me.x, me.y + 1.55, me.z, 4.8, null, 0.7, 0.3);
    return !!this.job;
  }
  // the brother's actor while we move him (the rig picks walk or run from the speed; the clip from kickT)
  anim(a, sp, h, dt) {
    const G = this.G, me = G.brothers.me;
    me.heading = lerpA(me.heading, h, Math.min(1, dt * 12));
    a.x = me.x; a.y = me.y; a.z = me.z; a.heading = me.heading; a.speed = sp; a.running = sp > 3; a.pose = 'walk';
    a.phase = (a.phase + sp * dt * (sp > 3 ? 2.6 : 3.6)) % (Math.PI * 2); a.t += dt; a.visible = true;
    G.brothers.speedNow = sp;
  }
  finish() {
    const G = this.G, B = G.brothers, me = B.me, J = this.job, v = J.v;
    this.job = null;
    if (!J.bike) G.audio?.play?.('Car_Door_Close', v.x, v.y + 1, v.z, 0.6);
    Object.assign(v, { parked: false, player: true, free: true, hidden: false, occupied: null, jacked: false, sp: 0, v: 0 });
    me.vehicle = v.id; me.x = v.x; me.z = v.z;
    G.carDyn.loose.delete(v); G.carDyn.ph(v); v.ph.vx = v.ph.vz = v.ph.w = 0; v.ph.gear = 1; v.ph.rpm = 900;
    G.events.emit('tookVehicle', { v, by: me, jacked: true });
    G.save.markVehicle(v);
    B.cam.lastUser = -10;
    G.hud.toast(J.bike ? 'Off it, and it\'s yours' : 'Out you get');
  }
  abort() { const J = this.job; this.job = null; if (J?.v && !J.v.player) Object.assign(J.v, { parked: false, occupied: null, jacked: false }); }
  // ---------------------------------------------------------------- the driver or rider, out on the ground
  // a person where the driver (or rider) was, thrown along `dir` at `speed`: down in a heap; up again and away
  // (hurt badly or killed when it's a car that's sent them flying)
  eject(v, dir, speed, opts = {}) {
    const G = this.G, net = G.net, bike = v.def.wheels === 2, h = v.heading;
    const sx = bike ? v.x : v.x + -Math.sin(h) * v.def.W * 0.22, sz = bike ? v.z : v.z + Math.cos(h) * v.def.W * 0.22;
    const x = sx + Math.cos(dir) * (bike ? 0.3 : v.def.W * 0.35), z = sz + Math.sin(dir) * (bike ? 0.3 : v.def.W * 0.35);
    const w = net.nearest(x, z, 40, e => net.walkable(e));
    const p = { id: 'p' + (G.peds.nextId++), x, y: v.y, z, heading: dir + Math.PI, look: People.randomLook(Math.random), speed: 1.3, speedNow: 0, mode: 'walk', t: 0, phase: 0, alpha: 1, visible: true,
      h: w ? w.e * 2 : v.h, s: w ? w.s : v.s, sideSign: w?.side || 1, lane: 0 };
    if (bike && v.model !== 'bicycle' && v.model !== 'ebike') p.look.cap = true;   // (a helmet would be better; a cap reads at a distance)
    p.y = G.tiles.ground(x, z, v.y + 1) ?? v.y;
    if (opts.medic) p.awaitingMedic = true;          // (an ambulance is already on the way: the police have it as a collision)
    G.peds.list.push(p);
    if (opts.kill) G.peds.hurt(p, dir, 'down', 1000, { lethal: true, push: Math.min(4, speed / 2.5), by: opts.by, how: 'car' });
    else G.peds.hurt(p, dir, 'down', opts.dmg ?? 15, { push: Math.min(3.5, speed / 1.6) });
    return p;
  }
  // ---------------------------------------------------------------- a car into a bike
  // the rider's thrown (hurt or killed by the speed of it), the bike goes down on its side and slides
  onHit({ by, other, speed }) {
    const G = this.G;
    for (const [bike, car] of [[other, by], [by, other]]) {
      if (!bike?.def || !car?.def || bike.def.wheels !== 2 || bike.player || bike.fallenBike || (bike.parked && !bike.occupied) || (car.def.wheels === 2 && !car.player)) continue;
      if (speed < 2.5) continue;
      // thrown the way the car was going (and away from it)
      const away = Math.atan2(bike.z - car.z, bike.x - car.x), along = car.heading ?? away;
      const dir = Math.atan2(Math.sin(away) + Math.sin(along), Math.cos(away) + Math.cos(along));
      const kill = speed >= 16 && !!car.player, hurt = speed >= 9;
      const rider = this.eject(bike, dir, speed * 0.9, { kill, by: car.player ? 'player' : null, dmg: hurt ? 1000 : 40, medic: hurt || kill });
      // the police's report of the collision (police.js) gets them as its casualty, for the ambulance
      if (hurt || kill) {
        const inc = [...(G.police?.incidents || [])].reverse().find(i => i.parties?.includes(bike.id));
        if (inc) { inc.injury = true; inc.patient = rider; inc.drivers = [...(inc.drivers || []), rider]; }
        else G.police?.createIncident?.('rtc', bike.x, bike.z, [bike.id], { injury: true, patient: rider, byPlayer: !!car.player, label: bike.model === 'bicycle' || bike.model === 'ebike' ? 'Cyclist knocked down' : 'Rider knocked off' });
      }
      G.audio?.crash?.(bike.x, bike.z, Math.min(1, speed / 15));
      this.knockDown(bike, dir, speed);
    }
  }
  knockDown(v, dir, speed) {
    const G = this.G;
    G.carDyn?.loose?.delete(v);
    Object.assign(v, { fallenBike: true, parked: true, occupied: false, crashed: true, hazard: false, v: 0 });
    this.downed.add(v);
    const side = Math.sin(dir - v.heading) >= 0 ? 1 : -1;
    this.fallen.push({ v, t: 0, vx: Math.cos(dir) * speed * 0.55, vz: Math.sin(dir) * speed * 0.55, spin: (Math.random() - 0.5) * speed * 0.35, side, y0: v.y });
    G.breakables?.debris?.spark?.(8, v.x, v.y + 0.2, v.z, Math.cos(dir) * 2, 1, Math.sin(dir) * 2, 2.5);
  }
  // fallen bikes: over on to the side in a moment, sliding and spinning to a stop (sparks while it scrapes)
  stepFallen(dt) {
    const G = this.G;
    // a bike left lying in the road goes once you're well away (one you've ridden is yours: it stays)
    if (this.downed.size && (this._clearT = (this._clearT || 0) - dt) <= 0) {
      this._clearT = 3; const cam = G.camera.position;
      for (const v of this.downed) {
        if (v.player || v.free || v.dead || !v.fallenBike) { this.downed.delete(v); continue; }
        if (Math.hypot(v.x - cam.x, v.z - cam.z) > 300) { G.traffic.remove(v); this.downed.delete(v); }
      }
    }
    if (!this.fallen.length) return;
    for (let i = this.fallen.length - 1; i >= 0; i--) {
      const f = this.fallen[i], v = f.v; f.t += dt;
      if (v.dead || v.player) { this.fallen.splice(i, 1); v.roll = 0; v.fallenBike = false; v.crashed = false; continue; }
      const k = Math.exp(-dt * 2.2);
      f.vx *= k; f.vz *= k; f.spin *= k;
      v.x += f.vx * dt; v.z += f.vz * dt; v.heading += f.spin * dt;
      const over = Math.min(1, f.t / 0.45);
      v.roll = f.side * (Math.PI / 2 - 0.12) * over * over;
      v.y = (G.tiles.ground(v.x, v.z, f.y0 + 1) ?? f.y0) + Math.sin(Math.abs(v.roll)) * v.def.W * 0.42;
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 1.5 && Math.random() < dt * 14) G.breakables?.debris?.spark?.(2, v.x, v.y, v.z, -f.vx * 0.3, 0.6, -f.vz * 0.3, 1.5);
      if (sp < 0.05 && f.t > 1) this.fallen.splice(i, 1);
    }
  }
}
