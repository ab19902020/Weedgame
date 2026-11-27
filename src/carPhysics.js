// Vehicle dynamics and collisions.
//
// Driving: a planar rigid body (position, velocity, yaw, yaw rate) on two axles. Each axle has a
// slip-angle tyre (simplified Pacejka curve) loaded by static weight plus longitudinal load
// transfer, limited by a friction circle shared with drive and brake forces. Throttle on a
// rear-driven car therefore costs rear grip, so it can oversteer. The engine follows a power curve
// through an automatic gearbox (rpm and gear also drive the engine sound). There are aero drag,
// rolling resistance and engine braking. Grip falls on wet roads, gravel and grass. The handbrake
// locks the rear wheels.
// Driving assists, as on the best mobile racers (Real Racing 3's steering assist and traction control, Gran
// Turismo's counter-steer assist) and on every modern road car (ABS, EBD, traction and stability control):
// ctl.assists is 1 for 'Easy' (the default) and 0 for 'Realistic', scaled per model (the sports cars get less):
//  * steering: speed-sensitive lock no greater than the front tyres can use, calmer steering at speed, quick
//    return to centre, and steering into a slide (counter-steer assist);
//  * ABS and EBD: no tyre locks under braking and the rear brakes stay well under the rear's grip, so braking
//    in a turn runs a little wide instead of spinning (the handbrake still locks the rear for handbrake turns);
//  * traction control: each driven axle gets only the drive its tyres can put down while holding the corner,
//    less again once the tail starts to slide;
//  * stability control: turning faster than the steering asks for is pulled back (as braking the outside
//    front wheel does) and the engine eased while it works;
//  * a chassis set to understeer a little at the limit: the rear holds slightly more than the front.
//
// Collisions: impulses at the actual contact point, with mass, moment of inertia, restitution and
// friction, so glancing blows scrape and spin the car rather than bouncing it. Obstacles are
// building footprints and walls (from the tile collision grid), lamp posts, tree trunks and other
// vehicles. A struck parked or moving car becomes a loose body that slides and spins on locked or
// braking tyres until it stops; a hard enough hit also makes a moving car a crash for the police.
// Impacts dent four damage zones per car (front, rear, left, right; v.dmg), which the vehicle
// shader turns into crumpled panels, broken lights and cracked glass. Heavy front damage costs power
// and pulls the steering.
import { breaks } from './breakSpec.js';
import { wheelPose } from './drivingSurface.js';
import { MODELS } from './vehicles.js';
import { pointInRing } from './tiles.js';

const G0 = 9.81, H = 1 / 120;

// per model: power (kW), top speed (m/s), driven axle, tyre grip, front weight share, centre-of-gravity
// height, gears, redline, stability assist
export const HANDLING = {
  hatch: { kw: 75, vmax: 51, drive: 'F', mu: 1.0, fw: 0.61, cg: 0.52, gears: 5, redline: 6300, assist: 1 },
  saloon: { kw: 125, vmax: 63, drive: 'F', mu: 1.02, fw: 0.58, cg: 0.52, gears: 6, redline: 6200, assist: 1 },
  estate: { kw: 115, vmax: 60, drive: 'F', mu: 1.0, fw: 0.58, cg: 0.55, gears: 6, redline: 6000, assist: 1 },
  suv: { kw: 150, vmax: 58, drive: 'A', mu: 0.98, fw: 0.56, cg: 0.68, gears: 6, redline: 5800, assist: 1.2 },
  van: { kw: 100, vmax: 46, drive: 'F', mu: 0.93, fw: 0.56, cg: 0.78, gears: 6, redline: 4600, assist: 1.2 },
  police: { kw: 170, vmax: 66, drive: 'A', mu: 1.04, fw: 0.57, cg: 0.55, gears: 6, redline: 6200, assist: 0.9 },
  hothatch: { kw: 210, vmax: 70, drive: 'F', mu: 1.1, fw: 0.6, cg: 0.48, gears: 6, redline: 6800, assist: 0.8 },
  coupe: { kw: 300, vmax: 77, drive: 'R', mu: 1.12, fw: 0.52, cg: 0.46, gears: 7, redline: 7000, assist: 0.6 },
  sports: { kw: 460, vmax: 90, drive: 'R', mu: 1.24, fw: 0.42, cg: 0.42, gears: 7, redline: 8300, assist: 0.45 },
  // Range Rover 5.0 V8: permanent four-wheel drive, eight-speed automatic, air suspension (tall but well damped)
  rangerover: { kw: 330, vmax: 69, drive: 'A', mu: 0.95, fw: 0.53, cg: 0.72, gears: 8, redline: 6500, assist: 1.1 },
  bus: { kw: 190, vmax: 24, drive: 'R', mu: 0.82, fw: 0.36, cg: 1.35, gears: 4, redline: 2400, assist: 1.4 },
  busS: { kw: 180, vmax: 25, drive: 'R', mu: 0.82, fw: 0.36, cg: 1.1, gears: 4, redline: 2400, assist: 1.4 },
  // light town bikes: short gearing, plenty of assist so a stolen one does not spin like a car
  bicycle:{ kw:.42,vmax:9,drive:'R',mu:.9,fw:.44,cg:.81,gears:1,redline:3000,assist:1.4 },
  ebike:{ kw:.85,vmax:11,drive:'R',mu:.94,fw:.46,cg:.77,gears:1,redline:4200,assist:1.45 },
  evsaloon:{ kw:235,vmax:56,drive:'R',mu:1.06,fw:.48,cg:.45,gears:1,redline:14000,assist:1.1 },
  evsuv:{ kw:205,vmax:49,drive:'A',mu:1,fw:.51,cg:.57,gears:1,redline:13000,assist:1.15 },
  dirtbike: { kw:29,vmax:35,drive:'R',mu:1.1,fw:.47,cg:.61,gears:6,redline:9400,assist:1.15 },
  motorcycle: { kw:49,vmax:51,drive:'R',mu:1.15,fw:.47,cg:.51,gears:5,redline:6800,assist:1.1 },
  moped: { kw: 7, vmax: 20, drive: 'R', mu: 1.05, fw: 0.46, cg: 0.55, gears: 4, redline: 8500, assist: 1.35 },
  escooter: { kw: 0.8, vmax: 7, drive: 'R', mu: 0.9, fw: 0.48, cg: 0.7, gears: 1, redline: 4200, assist: 1.5 },
};

const derived = new Map();
export function params(model) {
  let p = derived.get(model); if (p) return p;
  const d = MODELS[model], h = HANDLING[model] || (d.prof==='van' ? HANDLING.van : HANDLING.hatch), m = d.mass || 1300;
  const a = d.wb * (1 - h.fw), b = d.wb * h.fw;                 // CG to front / rear axle
  const cgx = (d.wx || 0) + d.wb / 2 - a;                       // CG ahead of the body centre
  const top = h.redline * 0.94 * 2 * Math.PI / 60 * d.wr / h.vmax;  // overall ratio in top gear
  const spread = h.gears >= 7 ? 4.6 : h.gears === 6 ? 4.0 : h.gears === 5 ? 3.5 : 3.0;
  const ratios = Array.from({ length: h.gears }, (_, i) => h.gears===1 ? top : top * Math.pow(spread, 1 - i / (h.gears - 1)));
  const P = h.kw * 1000;
  p = { ...h, d, m, a, b, cgx, Iz: m * (d.L * d.L + d.W * d.W) / 12 * 0.9, ratios, P, kd: P * 0.85 / Math.pow(h.vmax, 3), L: d.L, W: d.W, wr: d.wr, wb: d.wb };
  derived.set(model, p);
  return p;
}
// engine power fraction against rpm / redline
const pcurve = x => Math.max(0.12, Math.min(1, 1.55 * x - 0.55 * x * x * x));
// lateral force fraction against slip angle (peak near 8 degrees, gentle fall-off when sliding)
const pac = al => Math.sin(1.35 * Math.atan(9.5 * al));

export class CarDynamics {
  constructor(G) {
    this.G = G;
    this.loose = new Set();      // struck cars sliding to a stop
    this.cand = [];              // obstacle candidates gathered once per frame
    this.events = [];
  }
  ph(v) {
    if (!v.ph) {
      const f = [Math.cos(v.heading), Math.sin(v.heading)], sp = v.sp ?? v.v ?? 0;
      v.ph = { vx: f[0] * sp, vz: f[1] * sp, w: 0, ax: 0, ay: 0, gear: 1, rpm: 900, shiftT: 0, steer: 0, slip: 0, spinT: 0, surf: 1, scrape: 0 };
    }
    if (!v.dmg) v.dmg = [0, 0, 0, 0];
    return v.ph;
  }
  // ------------------------------------------------------------------ player-driven car
  // ctl: { throttle -1..1 (stick back = brake, then reverse), steer -1..1, handbrake bool }
  drive(v, dt, ctl) {
    const ph = this.ph(v), P = params(v.model);
    this.surface(v, ph);
    this.gather(v, dt);
    const n = Math.min(10, Math.max(1, Math.round(dt / H)));
    const h = dt / n;
    let impact = 0;
    if (ph.water > 0.75) { v.flooded = true; if (ctl) ctl = { ...ctl, throttle: Math.min(0, ctl.throttle || 0) * 0.2 }; }
    else if (ph.water < 0.05) v.flooded = false;
    for (let i = 0; i < n; i++) {
      this.integrate(v, ph, P, h, ctl);
      impact = Math.max(impact, this.collide(v, ph, P, h, true));
    }
    // brake assist (the player's car): an extra bite straight off the speed on top of what the tyres can do, so the
    // brakes feel strong and immediate (fun before simulation)
    if (ctl && ctl.brake > 0.05) {
      const sp = Math.hypot(ph.vx, ph.vz);
      if (sp > 0.3) { const k = Math.max(0, sp - Math.min(sp, ctl.brake * 3.2 * dt)) / sp; ph.vx *= k; ph.vz *= k; }
    }
    // water resistance: a bow wave and spray while ploughing in, then the car wallows to a stop
    if (ph.water > 0.15) {
      const k = Math.exp(-dt * ph.water * 1.8), sp = Math.hypot(ph.vx, ph.vz);
      ph.vx *= k; ph.vz *= k; ph.w *= k;
      const bx = v.x + Math.cos(v.heading) * v.def.L / 2, bz = v.z + Math.sin(v.heading) * v.def.L / 2, wy = (v.y || 0) + ph.water;
      if (sp > 2 && Math.random() < Math.min(1, sp / 8)) this.G.breakables?.debris.burst('drop', Math.round(4 + sp), bx, wy + 0.1, bz, ph.vx * 0.5, 1.5 + sp * 0.15, ph.vz * 0.5, 1.2);
      if (v.player && this.G.U?.wake) this.G.U.wake.value.set(bx, bz, Math.min(1, 0.3 + sp * 0.12));
    }
    this.finish(v, ph, P, dt);
    return impact;
  }
  // struck cars without a driver: slide, spin and stop
  update(dt) {
    for (const v of this.loose) {
      if (v.dead || v.player) { this.loose.delete(v); continue; }
      const ph = this.ph(v), P = params(v.model);
      this.surface(v, ph);
      this.gather(v, dt);
      const n = Math.min(6, Math.max(1, Math.round(dt / H))), h = dt / n;
      for (let i = 0; i < n; i++) { this.integrate(v, ph, P, h, null); this.collide(v, ph, P, h, false); }
      this.finish(v, ph, P, dt);
      v.brake = !v.parked;
      this.flush(v);
      if (Math.hypot(ph.vx, ph.vz) < 0.15 && Math.abs(ph.w) < 0.05) {
        ph.vx = ph.vz = ph.w = 0; this.loose.delete(v); v.v = 0;
      }
    }
  }
  makeLoose(o) {
    const ph = this.ph(o);
    if (!this.loose.has(o)) {
      const sp = o.parked ? 0 : (o.v || 0);
      ph.vx = Math.cos(o.heading) * sp; ph.vz = Math.sin(o.heading) * sp; ph.w = 0;
      this.loose.add(o); o._offLane = !o.parked;
    }
    return ph;
  }
  // ------------------------------------------------------------------ surface and obstacles
  surface(v, ph) {
    const G = this.G, lc = G.tiles.landcover(v.x, v.z), wet = G.world?.s?.wet || 0;
    // landcover: 1 road, 2 pavement, 10 gravel, 7 grass, 11 gardens
    const base = lc === 1 || lc === 2 || lc === 12 ? 1 : lc === 10 ? 0.72 : lc === 7 || lc === 11 || lc === 3 || lc === 4 ? 0.58 : 0.85;
    const soft = base < 0.7;
    ph.surf = base * (1 - wet * (soft ? 0.35 : 0.27));
    ph.crr = soft ? 0.07 : base < 0.8 ? 0.035 : 0.013;
    if(v.model==='dirtbike' && (soft || lc===10)){
      ph.surf*=1.20;
      ph.crr*=.75;
    }
    ph.soft = soft;
    // driving into a lake or river: water drags at the car and floods the engine once it's over the sills
    const lv = G.tiles.waterLevel ? G.tiles.waterLevel(v.x, v.z) : null;
    ph.water = lv != null ? Math.max(0, lv - (v.y || 0)) : 0;
    if (ph.water > 0.1) { ph.surf *= Math.max(0.35, 1 - ph.water * 0.5); ph.crr += Math.min(0.5, ph.water * 0.4); }
  }
  gather(v, dt) {
    const G = this.G, c = this.cand; c.length = 0;
    const r = v.def.L / 2 + 2 + Math.hypot(v.ph.vx, v.ph.vz) * dt;
    G.tiles.buildingsNear(v.x, v.z, r, (P, s, n, top, base) => {
      if (v.y > top - 0.35 || base > v.y + 1.6) return;
      c.push({ k: n === 2 ? 'wall' : 'poly', P, s, n });
    });
    // lamp posts, trees, street furniture, hedges, fences and garden walls: breakables.js decides what gives way
    if (G.breakables) G.breakables.gather(v.x, v.z, v.y, r, c);
    // (without it, e.g. in the unit tests: lamp posts and tree trunks are plain posts)
    else for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const t = G.tiles.tileAt(v.x + dx * r, v.z + dz * r); if (!t || t._cSeen === this) continue;
      t._cSeen = this;
      const lp = t.data.lamps;
      if (lp) for (let k = 0; k < lp.length; k += 4) {
        const x = lp[k] + t.data.ox, z = lp[k + 2] + t.data.oz;
        if (Math.abs(x - v.x) < r && Math.abs(z - v.z) < r) c.push({ k: 'post', x, z, r: 0.11 });
      }
      if (t.trees) for (const [x, z, Ht] of t.trees) if (Math.abs(x - v.x) < r && Math.abs(z - v.z) < r) c.push({ k: 'post', x, z, r: 0.12 * (1 + Ht / 14) });
    }
    if (!G.breakables) for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) { const t = G.tiles.tileAt(v.x + dx * r, v.z + dz * r); if (t) t._cSeen = null; }
    // other vehicles
    this.others = [];
    for (const o of G.traffic.list) {
      if (o === v || o.hidden || o.dead) continue;
      const ddx = o.x - v.x, ddz = o.z - v.z, rr = r + o.def.L / 2;
      if (ddx * ddx + ddz * ddz < rr * rr && Math.abs((o.y || 0) - v.y) < 2.5) this.others.push(o);
    }
  }
  // ------------------------------------------------------------------ one substep of the dynamics
  integrate(v, ph, P, h, ctl) {
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading), rx = -fz, rz = fx;
    let u = ph.vx * fx + ph.vz * fz, vl = ph.vx * rx + ph.vz * rz;
    const speed = Math.hypot(u, vl);
    const dmg = v.dmg;
    // ---- controls
    let thr = 0, brk = 0, hb = false, steerT = 0;
    // assists: 1 Easy .. 0 Realistic. Easy gives every car near-full help (the sports cars too); Realistic leaves the
    // light stability and traction control a road car of that sort has (less on the sports cars)
    const A = ctl ? Math.max(0, Math.min(1, ctl.assists ?? 1)) : 0, AS = A * Math.max(0.9, P.assist) + (1 - A) * 0.6 * P.assist;
    const muS = P.mu * ph.surf * (ctl ? 1.07 : 1);   // a touch more grip for the player than the tyres would give: fun before simulation
    if (ctl) {
      if (ctl.throttle > 0.05) { if (u < -0.8) brk = ctl.throttle; else { thr = ctl.throttle; if (ph.gear < 1) ph.gear = 1; } }
      else if (ctl.throttle < -0.05) { if (u > 0.8) brk = -ctl.throttle; else { thr = -ctl.throttle; ph.gear = -1; } }
      // the brake pedal (separate from the accelerator): full pressure at once, and it holds a stopped car still
      if (ctl.brake > 0.02) { brk = Math.max(brk, ctl.brake); thr *= 1 - Math.min(1, ctl.brake); }
      hb = !!ctl.handbrake;
      let maxSteer = 0.62 / (1 + Math.max(0, u) / 12);
      // steering assist: no more lock than the front tyres can use at this speed (the angle for the tightest turn
      // the grip allows, plus their working slip), so a full-lock swipe at speed turns as hard as the car can
      // instead of scrubbing the front or snapping the tail
      if (u > 6) { const dg = P.wb * muS * G0 * 0.95 / (u * u) + 0.09; maxSteer += (Math.min(maxSteer, dg) - maxSteer) * Math.min(1, A * 1.2); }
      // Preserve parking lock while making small motorway corrections more progressive.
      const precision = 0.26 * Math.min(1, speed / 18) * A;
      steerT = ctl.steer * (1 - precision + precision * Math.abs(ctl.steer)) * maxSteer;
      // counter-steer assist: steer into a slide (not while the handbrake is held, so handbrake turns still work). The
      // slide is the rear tyres' own slip beyond their working angle, not the body's angle to its path (in a tight
      // turn at walking pace that is geometry, and steering into it wound the lock on past full)
      if (!hb && speed > 4) {
        const arN = Math.atan2(vl - ph.w * P.b, Math.max(Math.abs(u), 0.8)), ex = Math.sign(arN) * Math.max(0, Math.abs(arN) - 0.04);
        steerT += Math.max(-0.35, Math.min(0.35, ex * (0.5 + 0.5 * A) * P.assist * Math.min(1, (speed - 4) / 4))) * Math.sign(u || 1);
      }
      steerT += ((dmg[3] - dmg[2]) * 0.05 + Math.max(dmg[0] - 0.5, 0) * 0.03) * Math.min(1, speed / 10);   // bent steering pulls
      // the wheel turns quickly at parking speeds and more calmly at speed, and comes back to centre faster
      const crossingCentre = steerT * ph.steer < 0;
      const back = crossingCentre || Math.abs(steerT) < Math.abs(ph.steer) - 1e-3;
      const rate = 3.2 / (1 + Math.max(0, u) / (16 + 14 * (1 - A))) * (back ? 1.7 : 1);
      const target = crossingCentre ? 0 : steerT;
      ph.steer += Math.max(-rate * h, Math.min(rate * h, target - ph.steer));
    } else {
      // driverless: parked cars sit on their handbrake and in gear, crashed traffic on the footbrake
      brk = v.parked ? 0.75 : 0.85; hb = !!v.parked; ph.steer *= 0.9;
    }
    const delta = ph.steer, cd = Math.cos(delta), sd = Math.sin(delta);
    // ---- engine and gearbox
    let drive = 0;
    const wheelRpm = Math.abs(u) / P.wr * 60 / (2 * Math.PI);
    ph.shiftT = Math.max(0, ph.shiftT - h);
    if (P.gears===1 && ph.gear>=1) {
      const pedalOnly = v.model==='ebike' && v.fuel===0;
      const power = pedalOnly ? 350 : P.P;
      const maxSpeed = pedalOnly ? 8 : P.vmax;
      ph.rpm = wheelRpm*P.ratios[0];
      drive = thr * Math.min(P.m*3.8,power*.9/Math.max(1.1,u)) * Math.max(0,Math.min(1,(maxSpeed-u)/2));
    } else if (ph.gear >= 1) {
      const g = ph.gear, ratio = P.ratios[g - 1];
      let rpm = wheelRpm * ratio;
      if (thr > 0.05 && rpm > P.redline * (thr > 0.6 ? 0.93 : 0.72) && g < P.gears && ph.shiftT <= 0) { ph.gear++; ph.shiftT = 0.18; }
      else if (g > 1 && (rpm < P.redline * (thr > 0.6 ? 0.42 : 0.28)) && ph.shiftT <= 0) { ph.gear--; ph.shiftT = 0.14; }
      rpm = wheelRpm * P.ratios[ph.gear - 1];
      const eng = Math.max(rpm, ph.gear === 1 ? 900 + thr * P.redline * 0.42 : 900);   // clutch slip on launch
      ph.rpm += (Math.min(P.redline * 1.02, eng) - ph.rpm) * Math.min(1, h * 14);
      if (thr > 0 && ph.shiftT <= 0 && rpm < P.redline) {
        const lim = 1 - Math.max(0, dmg[0] - 0.55) * 1.2;    // a smashed front end loses power
        drive = thr * P.P * 0.88 * pcurve(Math.max(eng, 1000) / P.redline) / Math.max(u, 2.2) * Math.max(0.25, lim);
      }
      if (thr <= 0.05 && u > 1) drive = -P.m * G0 * 0.035 * Math.min(1, ph.rpm / 3000);  // engine braking
    } else {
      ph.rpm += (900 + wheelRpm * P.ratios[0] - ph.rpm) * Math.min(1, h * 10);
      if (thr > 0) drive = -thr * P.m * G0 * 0.35 * Math.max(0, 1 - Math.max(0, -u) / 8);
    }
    // ---- loads (longitudinal transfer from last step's acceleration)
    const mg = P.m * G0, dz = P.m * ph.ax * P.cg / P.wb;
    const Fzf = Math.max(mg * 0.12, mg * P.fw - dz), Fzr = Math.max(mg * 0.12, mg * (1 - P.fw) + dz);
    const mu = P.mu * ph.surf;
    // ---- tyre forces
    const vf = vl + ph.w * P.a, vr = vl - ph.w * P.b;
    const ufw = u * cd + vf * sd, vfw = -u * sd + vf * cd;
    const af = Math.atan2(vfw, Math.max(Math.abs(ufw), 0.8)), ar = Math.atan2(vr, Math.max(Math.abs(u), 0.8));
    const share = P.drive === 'F' ? [1, 0] : P.drive === 'R' ? [0, 1] : [0.4, 0.6];
    const sgnU = Math.abs(u) > 0.05 ? Math.sign(u) : 0;
    // tyres grip a little less per kilogram the harder they're loaded (load sensitivity): braking hard throws load
    // on the front and lifts it off the rear, and without this the front out-gripped the rear and the car swapped ends
    const sens = (Fz, Fz0) => mu * Math.max(0.75, Math.min(1.2, 1 - 0.15 * (Fz - Fz0) / Fz0));
    const capF = sens(Fzf, mg * P.fw) * Fzf, capR = sens(Fzr, mg * (1 - P.fw)) * Fzr;
    let dF = drive * share[0], dR = drive * share[1];
    if (ctl && drive > 0) {
      // traction control: each driven axle gets at most what its tyres can put down while still holding the corner
      // (last step's cornering force), and less again once the tail slides or stability control is at work
      const latF = Math.min(0.95, Math.abs(ph.fyF || 0) / Math.max(1, capF)), latR = Math.min(0.95, Math.abs(ph.fyR || 0) / Math.max(1, capR));
      const kF = 1 - 0.08 * AS, kR = 0.98 - 0.22 * AS;
      dF = Math.min(dF, capF * kF * Math.sqrt(1 - latF * latF));
      dR = Math.min(dR, capR * kR * Math.sqrt(1 - latR * latR));
      if (!hb && Math.abs(ar) > 0.07) dR *= Math.max(0.15, 1 - (Math.abs(ar) - 0.07) * 9 * AS);
      if (ph.esc) { const cut = Math.max(0.2, 1 - ph.esc * 0.8 * AS); dF *= cut; dR *= cut; }
    }
    // ABS and EBD: the brakes never lock a wheel, and the rear's share stays well inside the rear's grip (it loses load
    // as the car pitches forward), so the car steers and stays straight under hard braking. Crashed cars with nobody
    // at the wheel skid on locked tyres as before.
    const bF = brk * mg * (ctl ? 1.25 : 1.05);
    let bkF = bF * 0.64, bkR = bF * 0.36;
    if (ctl) { bkF = Math.min(bkF, capF * 1.0); bkR = Math.min(bkR, capR * (0.8 - 0.08 * Math.min(1, AS))); }
    let FxF = dF - sgnU * bkF;
    let FxR = dR - sgnU * bkR;
    let gripR = 1;
    if (hb) { FxR = -sgnU * mu * Fzr * 0.85; gripR = 0.42; }
    let spin = 0;
    if (Math.abs(FxF) > capF) { spin = Math.max(spin, (Math.abs(FxF) - capF) / capF); FxF = Math.sign(FxF) * capF; }
    if (Math.abs(FxR) > capR) { spin = Math.max(spin, (Math.abs(FxR) - capR) / capR); FxR = Math.sign(FxR) * capR; }
    // (a chassis that understeers a little at the limit, as road cars are set up: the rear holds a touch more)
    const capRy = capR * gripR * (hb ? 1 : 1 + 0.1 * AS);
    let FyF = -capF * pac(af), FyR = -capRy * pac(ar);
    const limF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF)), limR = Math.sqrt(Math.max(0, capRy * capRy - (hb ? 0 : FxR * FxR)));
    FyF = Math.max(-limF, Math.min(limF, FyF)); FyR = Math.max(-limR, Math.min(limR, FyR));
    // never let a tyre force overshoot (low-speed stability): at most what cancels that axle's lateral speed this step
    const mF = P.m * P.fw, mR = P.m * (1 - P.fw);
    FyF = Math.max(-Math.abs(vfw) * mF / h, Math.min(Math.abs(vfw) * mF / h, FyF));
    FyR = Math.max(-Math.abs(vr) * mR / h, Math.min(Math.abs(vr) * mR / h, FyR));
    // braking can't push a stopped car backwards
    if (brk > 0 || !ctl) { const maxB = Math.abs(u) * P.m / h; const sumX = FxF + FxR; if (Math.abs(sumX) > maxB && drive === 0) { const k = maxB / Math.abs(sumX); FxF *= k; FxR *= k; } }
    // ---- body forces and moment
    let Fx = FxF * cd - FyF * sd + FxR;
    const Fy = FxF * sd + FyF * cd + FyR;
    let Mz = P.a * (FxF * sd + FyF * cd) - P.b * FyR;
    Fx -= P.kd * u * Math.abs(u) * (1 + (dmg[0] + dmg[1]) * 0.3) + (Math.abs(u) > 0.05 ? sgnU * ph.crr * mg : 0);
    // Measured Berkshire slopes influence the car gently; keep the existing easy handling.
    if(Math.abs(u)>0.5 || Math.abs(thr)>0.05)Fx -= mg * Math.max(-0.20,Math.min(0.20,ph.groundGrade || 0)) * 0.55;
    // stability control: the yaw rate the steering asks for (a steady turn of a car that understeers a little),
    // no faster than the grip allows; turning faster than that, or the wrong way, is pulled back as braking the
    // outside front wheel would, and the engine is eased (traction control reads ph.esc next step)
    ph.esc = 0;
    if (ctl && !hb && speed > 5 && u > 2) {
      const wRef0 = u * Math.tan(delta) / (P.wb * (1 + (u / 24) ** 2)), wCap = mu * G0 * 0.92 / speed;
      const wRef = Math.max(-wCap, Math.min(wCap, wRef0)), over = Math.abs(ph.w) - Math.abs(wRef);
      if ((over > 0.03 && Math.sign(ph.w) === Math.sign(wRef || ph.w)) || (Math.sign(ph.w) !== Math.sign(wRef) && Math.abs(ph.w) > 0.06 && Math.abs(wRef) > 0.02)) {
        Mz -= (ph.w - wRef) * P.Iz * 9 * AS;
        ph.esc = Math.min(1, Math.abs(ph.w - wRef) * 4);
      }
    }
    // yaw limiter (ESP): stops a spin building beyond what the tyres can hold, unless on the handbrake
    if (ctl && !hb && speed > 6) {
      const wMax = mu * G0 / speed * 1.15 + 0.15;
      if (Math.abs(ph.w) > wMax) Mz -= Math.sign(ph.w) * (Math.abs(ph.w) - wMax) * P.Iz * 6 * P.assist;
    }
    // ---- integrate in the world frame
    const ax = Fx / P.m, ay = Fy / P.m;
    ph.vx += (ax * fx + ay * rx) * h; ph.vz += (ax * fz + ay * rz) * h;
    ph.w += Mz / P.Iz * h;
    if (speed < 0.6 && thr === 0) ph.w *= 0.85;
    if (speed < 0.12 && thr === 0 && (brk > 0 || hb || !ctl)) { ph.vx *= 0.5; ph.vz *= 0.5; }
    // move the centre of gravity, then the body centre with it
    const cgx = P.cgx, oldX=v.x, oldZ=v.z, oldHeading=v.heading;
    let gx = v.x + fx * cgx, gz = v.z + fz * cgx;
    gx += ph.vx * h; gz += ph.vz * h;
    v.heading += ph.w * h;
    v.x = gx - Math.cos(v.heading) * cgx; v.z = gz - Math.sin(v.heading) * cgx;
    // Do not drive into missing world geometry when streaming stalls or at the map edge.
    if(this.G.tiles.vehicleGround && !this.G.tiles.tileAt(v.x,v.z)){
      v.x=oldX;v.z=oldZ;v.heading=oldHeading;ph.vx=ph.vz=ph.w=0;
    }
    // smoothed local accelerations (load transfer next step; body pitch and roll)
    ph.ax += (ax - ph.ax) * Math.min(1, h * 12);
    ph.ay += (ay - ph.ay) * Math.min(1, h * 12);
    ph.slip = Math.max(Math.abs(af) > 0.16 ? (Math.abs(af) - 0.16) * 4 : 0, Math.abs(ar) > 0.15 ? (Math.abs(ar) - 0.15) * 4 : 0, spin * 1.5, hb && speed > 3 ? 1 : 0, brk > 0.9 && speed > 3 && ph.surf < 0.8 ? 0.5 : 0);
    ph.slip = Math.min(1, ph.slip) * Math.min(1, speed / 4);
    ph.thr = thr; ph.brk = brk; ph.hb = hb; ph.fyF = FyF; ph.fyR = FyR;
  }
  // ------------------------------------------------------------------ collisions
  // returns the largest closing speed resolved (m/s)
  collide(v, ph, P, h, byPlayer) {
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading), rx = -fz, rz = fx;
    const hl = P.L / 2, hw = P.W / 2;
    const cgx = P.cgx, gx = v.x + fx * cgx, gz = v.z + fz * cgx;
    let worst = 0;
    const toWorld = (lx, lz) => [v.x + fx * lx + rx * lz, v.z + fz * lx + rz * lz];
    const local = (x, z) => { const dx = x - v.x, dz = z - v.z; return [dx * fx + dz * fz, dx * rx + dz * rz]; };
    const samples = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw], [hl * 0.5, hw], [hl * 0.5, -hw], [-hl * 0.5, hw], [-hl * 0.5, -hw]];
    const contacts = [];
    for (const c of this.cand) {
      const n0 = contacts.length;
      if (c.b && c.b.broken) continue;
      if (c.k === 'poly') {
        const { P: Q, s, n } = c;
        for (const [lx, lz] of samples) {
          const [x, z] = toWorld(lx, lz);
          if (!pointInRing(Q, s, n, x, z)) continue;
          let best = 1e9, bx = 0, bz = 0;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const ax = Q[(s + j) * 2], az = Q[(s + j) * 2 + 1], ex = Q[(s + i) * 2] - ax, ez = Q[(s + i) * 2 + 1] - az, L2 = ex * ex + ez * ez || 1;
            let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + ex * t, pz = az + ez * t, d = (px - x) ** 2 + (pz - z) ** 2;
            if (d < best) { best = d; bx = px; bz = pz; }
          }
          const d = Math.sqrt(best) || 1e-4;
          if (d < 2.5) contacts.push([x, z, (bx - x) / d, (bz - z) / d, d + 0.01]);
        }
        // building corners poking into the car's sides
        for (let i = 0; i < n; i++) {
          const x = Q[(s + i) * 2], z = Q[(s + i) * 2 + 1], [lx, lz] = local(x, z);
          if (Math.abs(lx) >= hl || Math.abs(lz) >= hw) continue;
          const px = hl - Math.abs(lx), pz = hw - Math.abs(lz);
          if (px < pz) contacts.push([x, z, -fx * Math.sign(lx), -fz * Math.sign(lx), px]);
          else contacts.push([x, z, -rx * Math.sign(lz), -rz * Math.sign(lz), pz]);
        }
      } else if (c.k === 'wall') {
        const { P: Q, s } = c, ax = Q[s * 2], az = Q[s * 2 + 1], ex = Q[s * 2 + 2] - ax, ez = Q[s * 2 + 3] - az, L2 = ex * ex + ez * ez || 1;
        const T = c.T || 0.16;
        for (const [lx, lz] of samples) {
          const [x, z] = toWorld(lx, lz);
          let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz);
          if (d < T) {
            // push to the side of the wall the car's centre is on
            const L = Math.sqrt(L2), nx0 = -ez / L, nz0 = ex / L, side = Math.sign((gx - ax) * nx0 + (gz - az) * nz0) || 1;
            const sd = ((x - ax) * nx0 + (z - az) * nz0) * side;
            contacts.push([x, z, nx0 * side, nz0 * side, T - sd]);
          }
        }
        for (const [x, z] of [[ax, az], [ax + ex, az + ez]]) {
          const [lx, lz] = local(x, z); if (Math.abs(lx) >= hl || Math.abs(lz) >= hw) continue;
          const px = hl - Math.abs(lx), pz = hw - Math.abs(lz);
          if (px < pz) contacts.push([x, z, -fx * Math.sign(lx), -fz * Math.sign(lx), px]); else contacts.push([x, z, -rx * Math.sign(lz), -rz * Math.sign(lz), pz]);
        }
      } else {
        // post: circle against the car's box
        const [lx, lz] = local(c.x, c.z);
        const qx = Math.max(-hl, Math.min(hl, lx)), qz = Math.max(-hw, Math.min(hw, lz));
        const dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        if (d < c.r && d > 1e-4) {
          const nlx = -dx / d, nlz = -dz / d;     // push the car away from the post
          const [x, z] = toWorld(qx, qz);
          contacts.push([x, z, fx * nlx + rx * nlz, fz * nlx + rz * nlz, c.r - d]);
        } else if (d <= 1e-4) {
          const px = hl - Math.abs(lx), pz = hw - Math.abs(lz);
          if (px < pz) contacts.push([c.x, c.z, -fx * Math.sign(lx), -fz * Math.sign(lx), px + c.r]); else contacts.push([c.x, c.z, -rx * Math.sign(lz), -rz * Math.sign(lz), pz + c.r]);
        }
      }
      if (c.b && contacts.length > n0) this.giveWay(v, ph, P, c.b, contacts, n0, cgx, fx, fz, rx, rz);
    }
    // static contacts: resolve the deepest few
    contacts.sort((a, b) => b[4] - a[4]);
    for (let i = 0; i < Math.min(4, contacts.length); i++) {
      const [x, z, nx, nz, depth] = contacts[i];
      const cvx = v.x + fx * cgx, cvz = v.z + fz * cgx;
      const r0x = x - cvx, r0z = z - cvz;
      const vn = this.pointVel(ph, r0x, r0z, nx, nz);
      if (vn < 0) {
        const before = [ph.vx, ph.vz];
        worst = Math.max(worst, this.impulseStatic(v, ph, P, r0x, r0z, nx, nz, vn, 0.12, 0.35));
        this.kick(v, ph.vx - before[0], ph.vz - before[1], fx, fz, rx, rz);
        if (-vn > 3) this.G.breakables?.crash(v, x, z, -vn, nx, nz, null);
      }
      // grinding along: sparks from the contact
      if (i === 0 && this.G.breakables) { const tv = Math.abs(this.pointVel(ph, r0x, r0z, -nz, nx)); if (tv > 4) this.G.breakables.scrape(x, v.y || 0, z, ph.vx, ph.vz, tv); }
      v.x += nx * Math.min(depth, 0.5) * 0.85; v.z += nz * Math.min(depth, 0.5) * 0.85;
    }
    if (contacts.length) ph.scrape = Math.max(ph.scrape, Math.min(1, Math.hypot(ph.vx, ph.vz) / 8));
    // ---- other vehicles
    for (const o of this.others) {
      if (o === v || o.dead) continue;
      const od = o.def, hit = obb(v.x, v.z, v.heading, P.L, P.W, o.x, o.z, o.heading, od.L, od.W);
      if (!hit) continue;
      const [nx, nz, depth, cx, cz] = hit;      // n points from o towards v
      const Po = params(o.model), oph = this.ph(o);
      const oLoose = this.loose.has(o);
      // velocity of o: loose bodies carry their own; traffic moves along its heading; parked cars stand still
      const ovx = oLoose ? oph.vx : o.parked ? 0 : Math.cos(o.heading) * (o.v || 0), ovz = oLoose ? oph.vz : o.parked ? 0 : Math.sin(o.heading) * (o.v || 0);
      const ow = oLoose ? oph.w : 0;
      const ocx = o.x + Math.cos(o.heading) * Po.cgx, ocz = o.z + Math.sin(o.heading) * Po.cgx;
      const ra = [cx - (v.x + fx * cgx), cz - (v.z + fz * cgx)], rb = [cx - ocx, cz - ocz];
      const va = [ph.vx - ph.w * ra[1], ph.vz + ph.w * ra[0]], vb = [ovx - ow * rb[1], ovz + ow * rb[0]];
      const vn = (va[0] - vb[0]) * nx + (va[1] - vb[1]) * nz;
      const pushShare = Po.m / (P.m + Po.m);
      if (vn < 0) {
        const rna = ra[0] * nz - ra[1] * nx, rnb = rb[0] * nz - rb[1] * nx;
        const e = 0.18;
        // a gentle nudge against moving traffic: that car keeps its line (its driver brakes for us)
        let invB = 1 / Po.m + rnb * rnb / Po.Iz;
        const jTry = -(1 + e) * vn / (1 / P.m + rna * rna / P.Iz + invB);
        const dvB = jTry / Po.m;
        const kinematic = !oLoose && !o.parked && dvB < 1.6 && !o.player;
        if (kinematic) invB = 0;
        const j = -(1 + e) * vn / (1 / P.m + rna * rna / P.Iz + invB);
        ph.vx += j * nx / P.m; ph.vz += j * nz / P.m; ph.w += rna * j / P.Iz;
        // friction along the contact (scraping down a car's side)
        const tx = -nz, tz = nx, vt = (va[0] - vb[0]) * tx + (va[1] - vb[1]) * tz;
        const rta = ra[0] * tz - ra[1] * tx, rtb = rb[0] * tz - rb[1] * tx;
        let jt = -vt / (1 / P.m + rta * rta / P.Iz + (kinematic ? 0 : 1 / Po.m + rtb * rtb / Po.Iz));
        jt = Math.max(-0.3 * j, Math.min(0.3 * j, jt));
        ph.vx += jt * tx / P.m; ph.vz += jt * tz / P.m; ph.w += rta * jt / P.Iz;
        this.kick(v, (j * nx + jt * tx) / P.m, (j * nz + jt * tz) / P.m, fx, fz, rx, rz);
        if (-vn > 3) this.G.breakables?.crash(v, cx, cz, -vn, nx, nz, o);
        if (Math.abs(vt) > 4) this.G.breakables?.scrape(cx, v.y || 0, cz, ph.vx, ph.vz, Math.abs(vt));
        if (!kinematic && !o.player) {
          const ophL = this.makeLoose(o);
          ophL.vx -= (j * nx + jt * tx) / Po.m; ophL.vz -= (j * nz + jt * tz) / Po.m; ophL.w -= (rnb * j + rtb * jt) / Po.Iz;
          if (!o.parked && !o.crashed && Math.abs(vn) > 2.5) this.G.events.emit('vehicleHit', { by: v, other: o, speed: Math.abs(vn) });
          if (!o.parked) { o.crashed = true; o.hazard = true; o.v = 0; }
          this.damage(o, Po, cx, cz, j / Po.m);
          const ofx = Math.cos(o.heading), ofz = Math.sin(o.heading);
          this.kick(o, -(j * nx + jt * tx) / Po.m, -(j * nz + jt * tz) / Po.m, ofx, ofz, -ofz, ofx);
        }
        this.damage(v, P, cx, cz, j / P.m);
        worst = Math.max(worst, -vn);
        if (-vn > 1) this.events.push({ x: cx, z: cz, speed: -vn });
      }
      // separate: loose and parked cars share the correction by mass, moving traffic does not budge
      const share = this.loose.has(o) || (o.parked && !o.player) ? pushShare : 1;
      v.x += nx * depth * share; v.z += nz * depth * share;
      if (share < 1) { o.x -= nx * depth * (1 - share); o.z -= nz * depth * (1 - share); }
    }
    return worst;
  }
  // something that can give way (breakables.js) is in contact: below its breaking speed it stays a solid
  // obstacle; above it, it breaks and the car ploughs on, losing some speed and maybe a little paint
  giveWay(v, ph, P, b, contacts, n0, cgx, fx, fz, rx, rz) {
    let k = n0; for (let i = n0 + 1; i < contacts.length; i++) if (contacts[i][4] > contacts[k][4]) k = i;
    const [x, z, nx, nz] = contacts[k];
    const r0x = x - (v.x + fx * cgx), r0z = z - (v.z + fz * cgx);
    const closing = -this.pointVel(ph, r0x, r0z, nx, nz);
    if (!breaks(b, v, closing, this.G.time || 0)) { if (closing > 4) this.G.breakables?.bump(b, closing); return; }
    contacts.length = n0;
    const loss = this.G.breakables.smash(b, v, x, z, nx, nz, closing);
    const rn = r0x * nz - r0z * nx, j = loss / (1 / P.m + rn * rn / P.Iz * 0.35);
    ph.vx += j * nx / P.m; ph.vz += j * nz / P.m; ph.w += rn * j / P.Iz * 0.35;
    this.kick(v, j * nx / P.m, j * nz / P.m, fx, fz, rx, rz);
    if (b.S.dmg) this.damage(v, P, x, z, closing * b.S.dmg * 0.25);
    if (b.S.dmg >= 0.8) this.events.push({ x, z, speed: loss * 1.3 });
  }
  // the sprung body lurches with a sudden change of velocity (vehicles.js adds it to pitch and roll)
  kick(v, dvx, dvz, fx, fz, rx, rz) {
    const k = v._kick || (v._kick = [0, 0]);
    k[0] = Math.max(-14, Math.min(14, k[0] + dvx * fx + dvz * fz));
    k[1] = Math.max(-14, Math.min(14, k[1] + dvx * rx + dvz * rz));
  }
  // report the hardest impact since the last flush (sound, camera shake, pedestrians, police)
  flush(v) {
    if (!this.events.length) return 0;
    let e = this.events[0]; for (const x of this.events) if (x.speed > e.speed) e = x;
    this.events.length = 0;
    if (e.speed > 1.2) this.G.events.emit('impact', { speed: e.speed, x: e.x, z: e.z, v });
    return e.speed;
  }
  pointVel(ph, rx_, rz_, nx, nz) { return (ph.vx - ph.w * rz_) * nx + (ph.vz + ph.w * rx_) * nz; }
  impulseStatic(v, ph, P, r0x, r0z, nx, nz, vn, e, muC) {
    const rn = r0x * nz - r0z * nx;
    const j = -(1 + e) * vn / (1 / P.m + rn * rn / P.Iz);
    ph.vx += j * nx / P.m; ph.vz += j * nz / P.m; ph.w += rn * j / P.Iz;
    const tx = -nz, tz = nx, vt = (ph.vx - ph.w * r0z) * tx + (ph.vz + ph.w * r0x) * tz, rt = r0x * tz - r0z * tx;
    let jt = -vt / (1 / P.m + rt * rt / P.Iz); jt = Math.max(-muC * j, Math.min(muC * j, jt));
    ph.vx += jt * tx / P.m; ph.vz += jt * tz / P.m; ph.w += rt * jt / P.Iz;
    this.damage(v, P, v.x + r0x, v.z + r0z, j / P.m);
    if (-vn > 1) this.events.push({ x: v.x + r0x, z: v.z + r0z, speed: -vn });
    return -vn;
  }
  // dent the zone nearest the contact; dv is the change of velocity the hit caused (m/s)
  damage(v, P, x, z, dv) {
    if (dv < 2.2) return;
    const d = v.dmg || (v.dmg = [0, 0, 0, 0]);
    const fx = Math.cos(v.heading), fz = Math.sin(v.heading), dx = x - v.x, dz = z - v.z;
    const lx = dx * fx + dz * fz, lz = -dx * fz + dz * fx;
    const amt = Math.min(0.45, (dv - 2.2) / 20);
    const ex = Math.abs(lx) / (P.L / 2), ez = Math.abs(lz) / (P.W / 2);
    const end = Math.max(0, Math.min(1, (ex - 0.55) / 0.35)), side = Math.max(0, Math.min(1, (ez - 0.5) / 0.4));
    const wEnd = end * (1 - side * 0.4), wSide = side * (1 - end * 0.4);
    if (lx > 0) d[0] = Math.min(1, d[0] + amt * wEnd); else d[1] = Math.min(1, d[1] + amt * wEnd);
    if (lz < 0) d[2] = Math.min(1, d[2] + amt * wSide); else d[3] = Math.min(1, d[3] + amt * wSide);
    v.dmgT = (v.dmgT || 0) + 1;
  }
  // ------------------------------------------------------------------ after the substeps: ground, pose, wheels
  finish(v, ph, P, dt) {
    const G = this.G, fx = Math.cos(v.heading), fz = Math.sin(v.heading), rx = -fz, rz = fx;
    const a = P.wb / 2, w = P.W / 2 - 0.1, o = P.d.wx || 0;
    const cx = v.x + fx * o, cz = v.z + fz * o;
    const sample=(x,z,ref)=>G.tiles.vehicleGround ? G.tiles.vehicleGround(x,z,ref) : G.tiles.ground(x,z,ref);
    const contact=(f,r)=>{
      // Predict this wheel's elevation from the previous pose: a ramp and a deck
      // can overlap in plan, so all four wheels must stay on the correct level.
      const ref=v.y+(o+f)*Math.tan(v.pitch||0)+r*Math.tan(v.roll||0);
      return sample(cx+fx*f+rx*r,cz+fz*f+rz*r,ref) ?? ref;
    };
    const fl=contact(a,w),fr=contact(a,-w),rl=contact(-a,w),rr=contact(-a,-w);
    const pose=wheelPose(fl,fr,rl,rr,sample(v.x,v.z,v.y),Math.max(0.2,a),Math.max(0.15,w),o);
    const ty=pose.y;
    if(ty>=v.y || v.y-ty<0.5){v.y=ty;ph.fallV=0;}
    else {ph.fallV=Math.min(25,(ph.fallV||0)+9.81*dt);v.y=Math.max(ty,v.y-ph.fallV*dt);}
    v.pitch=pose.pitch;v.roll=pose.roll;
    ph.groundGrade=(ph.groundGrade||0)+(Math.max(-0.2,Math.min(0.2,pose.grade))-(ph.groundGrade||0))*Math.min(1,dt*8);
    const u = ph.vx * fx + ph.vz * fz;
    v.sp = u; v.v = Math.abs(u);
    v.spin = ((v.spin || 0) + (ph.hb ? 0 : u) * dt / P.wr) % (Math.PI * 2);
    v.steer = ph.steer;
    v.rpm = ph.rpm; v.gear = ph.gear;
    ph.scrape *= Math.max(0, 1 - dt * 4);
    if (G.tyreFx) G.tyreFx.track(v, P, ph, G.world?.s?.wet || 0);
  }
}

// separating-axis test of two oriented boxes. Returns [nx, nz, depth, contactX, contactZ] with n pointing
// from B to A, or null. The contact point is the deepest corner of either box inside the other.
export function obb(ax, az, ah, aL, aW, bx, bz, bh, bL, bW) {
  const ca = Math.cos(ah), sa = Math.sin(ah), cb = Math.cos(bh), sb = Math.sin(bh);
  const axes = [[ca, sa], [-sa, ca], [cb, sb], [-sb, cb]];
  const dx = ax - bx, dz = az - bz;
  let minO = 1e9, best = null;
  for (const [ux, uz] of axes) {
    const ra = Math.abs(aL / 2 * (ca * ux + sa * uz)) + Math.abs(aW / 2 * (-sa * ux + ca * uz));
    const rb = Math.abs(bL / 2 * (cb * ux + sb * uz)) + Math.abs(bW / 2 * (-sb * ux + cb * uz));
    const dist = dx * ux + dz * uz, o = ra + rb - Math.abs(dist);
    if (o <= 0) return null;
    if (o < minO) { minO = o; const s = Math.sign(dist) || 1; best = [ux * s, uz * s]; }
  }
  // contact: corners of each box inside the other (average of the deepest)
  const corners = (x, z, c, s, L, W) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([i, k]) => [x + c * L / 2 * i - s * W / 2 * k, z + s * L / 2 * i + c * W / 2 * k]);
  const inside = (px, pz, x, z, c, s, L, W) => { const lx = (px - x) * c + (pz - z) * s, lz = -(px - x) * s + (pz - z) * c; return Math.abs(lx) <= L / 2 && Math.abs(lz) <= W / 2; };
  let sx = 0, sz = 0, n = 0;
  for (const [px, pz] of corners(ax, az, ca, sa, aL, aW)) if (inside(px, pz, bx, bz, cb, sb, bL, bW)) { sx += px; sz += pz; n++; }
  for (const [px, pz] of corners(bx, bz, cb, sb, bL, bW)) if (inside(px, pz, ax, az, ca, sa, aL, aW)) { sx += px; sz += pz; n++; }
  if (!n) { sx = (ax + bx) / 2; sz = (az + bz) / 2; n = 1; }
  return [best[0], best[1], minO, sx / n, sz / n];
}
