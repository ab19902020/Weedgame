// Cal and Ward brothers: the only playable people. Walking, running, driving, parking,
// swapping, and the third-person orbit camera.
import * as THREE from 'three/webgpu';
import { MODELS } from './vehicles.js';
import { lerpAngle } from './traffic.js';
import { pointInRing } from './tiles.js';

const JACKETS = [0x314958, 0x765741, 0x294735, 0x653143], SKINS = [0xb48265, 0x895e46, 0xc39475];

import { CAR_SPECS } from './carModel.js';
export class Brothers {
  constructor(G, saved) {
    this.G = G;
    const def = (i) => ({ name: i ? 'Leon Ward' : 'Cal Ward', short: i ? 'Leon' : 'Cal', x: 0, y: 0, z: 0, heading: 0, vehicle: null,
      outfit: { jacket: i, skin: i ? 1 : 0, hair: 0 } });
    this.b = saved?.brothers || [def(0), def(1)];
    this.active = saved?.active ?? 0;
    this.cam = { yaw: saved?.camYaw ?? 0, pitch: 0.28, dist: 4.4, x: 0, y: 0, z: 0, lastUser: -10, fade: 0, foot: 0, car: 0, cine: null };
    try { const m = JSON.parse(localStorage.getItem('greenCounty.camModes') || '{}'); this.cam.foot = m.foot | 0; this.cam.car = m.car | 0; } catch (e) { /* storage blocked */ }
    this.actor = [0, 1].map(i => ({ id: 'brother' + i, x: 0, y: 0, z: 0, heading: 0, speed: 0, phase: 0, look: this.lookFor(i), visible: true, t: 0 }));
    this.vel = { x: 0, z: 0 };
    this.notice = null;
  }
  lookFor(i) {
    const o = this.b[i].outfit;
    // Cal: short crop, dark trousers, black shoes. Leon: hoodie, jeans, white trainers, a little taller and heavier
    return { skin: SKINS[o.skin] ?? SKINS[0], hair: 0x2b1d14, top: JACKETS[o.jacket] ?? JACKETS[0], legs: i ? 0x2b3a55 : 0x22252b, bald: o.hair === 1, bag: false, umbrella: 0x1a1a1a, h: i ? 1.02 : 1.0,
      style: 1, female: false, build: i ? 0.55 : 0.38, shoe: i ? 2 : 0, hood: !!i, cap: false, umbIdx: 0 };
  }
  get me() { return this.b[this.active]; }
  vehicleOf(b) { return b.vehicle ? this.G.traffic.byId.get(b.vehicle) : null; }
  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const G = this.G, me = this.me;
    const look = input.takeLook();
    if (look.dx || look.dy) { this.cam.yaw += look.dx * 0.0062; this.cam.pitch = Math.max(-0.25, Math.min(1.1, this.cam.pitch + look.dy * 0.0045)); this.cam.lastUser = G.time; }
    const veh = this.vehicleOf(me);
    if (veh) this.drive(dt, input, veh); else this.walk(dt, input);
    if (input.consume('camera')) this.cycleCamera(!!veh);
    if (input.consume('use')) this.toggleVehicle();
    if (input.consume('swap')) this.swap();
    // update actors for both brothers
    for (let i = 0; i < 2; i++) {
      const b = this.b[i], a = this.actor[i];
      a.look = this.lookFor(i);
      a.visible = !b.vehicle;
      if (i !== this.active) { a.x = b.x; a.y = b.y; a.z = b.z; a.heading = b.heading; a.speed = 0; a.pose = G.world.cur.rain > 0.35 && !G.shelteredAt(b.x, b.y, b.z) ? 'umbrella' : 'idle'; a.t += dt; }
    }
  }
  walk(dt, input) {
    const G = this.G, me = this.me, a = this.actor[this.active];
    const ax = input.axis();
    const run = input.held.has('run') || Math.hypot(ax.x, ax.y) > 0.92 && input.held.has('run');
    const speed = (run ? 5.4 : 1.7) * Math.min(1, Math.hypot(ax.x, ax.y));
    const fx = -Math.cos(this.cam.yaw), fz = -Math.sin(this.cam.yaw);
    const dx = (-ax.y) * fx + ax.x * -fz, dz = (-ax.y) * fz + ax.x * fx;
    const l = Math.hypot(dx, dz);
    const tx = l > 0.01 ? dx / l * speed : 0, tz = l > 0.01 ? dz / l * speed : 0;
    const k = Math.min(1, dt * 8);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    let nx = me.x + this.vel.x * dt, nz = me.z + this.vel.z * dt;
    [nx, nz] = this.collideCircle(nx, nz, 0.32, me.y);
    // other people & vehicles
    for (const v of G.traffic.list) {
      const ddx = nx - v.x, ddz = nz - v.z; if (ddx * ddx + ddz * ddz > 64) continue;
      [nx, nz] = pushFromBox(nx, nz, 0.3, v);
    }
    const gy = G.tiles.ground(nx, nz, me.y + 0.3);
    if (gy != null) { me.y = gy > me.y ? me.y + (gy - me.y) * Math.min(1, dt * 14) : gy; }
    const mv = Math.hypot(nx - me.x, nz - me.z);
    me.x = nx; me.z = nz;
    const sp = mv / Math.max(dt, 1e-3);
    if (sp > 0.2) me.heading = lerpAngle(me.heading, Math.atan2(this.vel.z, this.vel.x), Math.min(1, dt * 10));
    a.x = me.x; a.y = me.y; a.z = me.z; a.heading = me.heading; a.speed = sp; a.running = run && sp > 3;
    a.phase = (a.phase + sp * dt * (a.running ? 2.6 : 3.6)) % (Math.PI * 2);
    a.t += dt;
    a.pose = G.world.cur.rain > 0.35 && !a.running && !G.shelteredAt(me.x, me.y, me.z) ? 'umbrella' : 'walk';
    this.speedNow = sp;
    // on foot, only re-centre behind the brother while the stick is pushed mostly forward
    const forward = ax.y < -0.55 && Math.abs(ax.x) < 0.35;
    const fm = this.cam.foot;
    this.followCam(dt, me.x, me.y + 1.55 + (fm === 2 ? 0.6 : 0), me.z, [4.3, 7.4, 13][fm], sp > 0.5 && forward ? me.heading : null, 0.7, fm === 0 ? null : [0.28, 0.36, 0.85][fm]);
  }
  collideCircle(x, z, r, y) {
    const G = this.G;
    G.tiles.buildingsNear(x, z, r + 2, (P, s, n, top, base) => {
      if (y > top - 0.3) return;
      // inside? push to nearest edge
      let best = 1e9, bx = 0, bz = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = P[(s + j) * 2], az = P[(s + j) * 2 + 1], cx = P[(s + i) * 2], cz = P[(s + i) * 2 + 1];
        const vx = cx - ax, vz = cz - az, L2 = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + vx * t, pz = az + vz * t, d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < best) { best = d; bx = px; bz = pz; }
      }
      const inside = pointInRing(P, s, n, x, z);
      const d = Math.sqrt(best);
      if (inside) { const ux = bx - x, uz = bz - z, l = Math.hypot(ux, uz) || 1; x = bx + ux / l * r; z = bz + uz / l * r; this.hit = (this.hit || 0) + 1; }
      else if (d < r) { const ux = x - bx, uz = z - bz, l = d || 1; x = bx + ux / l * r; z = bz + uz / l * r; }
    });
    return [x, z];
  }
  drive(dt, input, v) {
    const G = this.G, me = this.me, def = MODELS[v.model];
    const ax = input.axis();
    const throttle = -ax.y, steerIn = ax.x;
    v.sp = v.sp || 0;
    const braking = input.held.has('brake');
    const maxV = v.model.startsWith('bus') ? 18 : v.model === 'van' ? 33 : 50;
    let acc = 0;
    if (throttle > 0.05) acc = v.sp < -0.5 ? 9 * throttle : (v.model.startsWith('bus') ? 1.4 : 3.6) * throttle * (1 - Math.max(0, v.sp) / maxV);
    else if (throttle < -0.05) acc = v.sp > 0.5 ? -9 * -throttle : -2.5 * -throttle;
    if (braking) acc = -Math.sign(v.sp) * Math.min(Math.abs(v.sp) / dt, 10);
    acc -= v.sp * Math.abs(v.sp) * 0.0012 + Math.sign(v.sp) * 0.25;
    v.sp += acc * dt;
    if (Math.abs(v.sp) < 0.05 && Math.abs(throttle) < 0.05) v.sp = 0;
    v.sp = Math.max(-8, Math.min(maxV, v.sp));
    const maxSteer = 0.6 / (1 + Math.abs(v.sp) / 11);
    v.steer = (v.steer || 0) + (steerIn * maxSteer - (v.steer || 0)) * Math.min(1, dt * 6);
    const yawRate = v.sp / def.wb * Math.tan(v.steer) * (braking && Math.abs(v.sp) > 8 ? 1.6 : 1);
    v.heading += yawRate * dt;
    let nx = v.x + Math.cos(v.heading) * v.sp * dt, nz = v.z + Math.sin(v.heading) * v.sp * dt;
    // collisions: buildings via three circles along the body
    const r = def.W / 2, fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    let impact = 0;
    for (const off of [-(def.L / 2 - r), 0, def.L / 2 - r]) {
      const cx = nx + fx * off, cz = nz + fz * off;
      const [px, pz] = this.collideCircle(cx, cz, r, v.y);
      if (px !== cx || pz !== cz) { nx += px - cx; nz += pz - cz; impact = Math.max(impact, Math.abs(v.sp)); }
    }
    // NPC vehicles
    for (const o of G.traffic.list) {
      if (o === v) continue;
      const dx = o.x - nx, dz = o.z - nz; if (dx * dx + dz * dz > 100) continue;
      const hit = obbOverlap(nx, nz, v.heading, def.L, def.W, o.x, o.z, o.heading, o.def.L, o.def.W);
      if (hit) {
        nx -= hit[0]; nz -= hit[1];
        const rel = Math.abs(v.sp - (o.v || 0) * Math.cos(o.heading - v.heading));
        if (rel > 2.5) { impact = Math.max(impact, rel); G.events.emit('vehicleHit', { by: v, other: o, speed: rel }); }
        if (o.parked) { o.x += hit[0] * 0.3; o.z += hit[1] * 0.3; }
      }
    }
    // pedestrians
    G.events.emit('vehicleSweep', { v, x: nx, z: nz, speed: Math.abs(v.sp) });
    if (impact > 0.5) { v.sp *= impact > 6 ? -0.25 : 0.3; G.events.emit('impact', { speed: impact, x: nx, z: nz, v }); }
    v.x = nx; v.z = nz;
    // ground: sample under axles for height, pitch and roll
    const a = def.wb / 2, w = def.W / 2 - 0.1, rx = -fz, rz = fx;
    const yf = G.tiles.ground(nx + fx * a, nz + fz * a, v.y + 0.5) ?? v.y, yb = G.tiles.ground(nx - fx * a, nz - fz * a, v.y + 0.5) ?? v.y;
    const yl = G.tiles.ground(nx + rx * w, nz + rz * w, v.y + 0.5) ?? v.y, yr = G.tiles.ground(nx - rx * w, nz - rz * w, v.y + 0.5) ?? v.y;
    const ty = (yf + yb + yl + yr) / 4;
    v.y += (ty - v.y) * Math.min(1, dt * 12);
    v.pitch = Math.atan2(yf - yb, 2 * a); v.roll = Math.atan2(yl - yr, 2 * w) * 0.6;
    v.spin = ((v.spin || 0) + v.sp * dt / def.wr) % (Math.PI * 2);
    v.v = Math.abs(v.sp);
    v.brake = braking || (throttle < -0.05 && v.sp > 0.5);
    v.lights = G.world.day < 0.6 || G.world.cur.rain > 0.4;
    me.x = v.x; me.y = v.y; me.z = v.z; me.heading = v.heading;
    this.speedNow = Math.abs(v.sp);
    if (input.consume('horn')) G.events.emit('horn', { x: v.x, z: v.z, v });
    const big = v.model.startsWith('bus') ? 13 : v.model === 'van' ? 8.5 : 7.2;
    const camY = v.y + (v.model.startsWith('bus') ? 3 : 1.5), mh = Math.abs(v.sp) > 1 ? (v.sp > 0 ? v.heading : v.heading + Math.PI) : null;
    const mode = this.cam.car;
    if (mode === 3) this.driverCam(v);
    else if (mode === 4) this.cineCam(dt, v);
    else this.followCam(dt, v.x, camY + (mode === 1 ? 0.4 : mode === 2 ? 1 : 0), v.z, big * [1, 1.65, 2.7][mode], mh, mode === 2 ? 2.2 : 1.6, [0.22, 0.3, 0.78][mode]);
  }
  // ------------------------------------------------------------------ camera modes
  static CAR_MODES = ['Chase', 'Far chase', 'High', 'Driver', 'Cinematic'];
  static FOOT_MODES = ['Close', 'Far', 'High'];
  cycleCamera(inCar) {
    const c = this.cam, names = inCar ? Brothers.CAR_MODES : Brothers.FOOT_MODES;
    if (inCar) c.car = (c.car + 1) % names.length; else c.foot = (c.foot + 1) % names.length;
    c.cine = null; c.lastUser = -10;
    try { localStorage.setItem('greenCounty.camModes', JSON.stringify({ foot: c.foot, car: c.car })); } catch (e) { /* storage blocked */ }
    this.G.hud.toast('Camera · ' + names[inCar ? c.car : c.foot], 1.6);
  }
  // from the driver's seat (right-hand drive): the shell is single-sided, so pillars and roof drop away
  driverCam(v) {
    const c = this.cam, G = this.G, h = v.heading, fx = Math.cos(h), fz = Math.sin(h), rx = -Math.sin(h), rz = Math.cos(h);
    const bus = v.model.startsWith('bus'), S = CAR_SPECS[v.model];
    // seat position from the car's own windscreen and belt line
    const eye = bus ? 2.3 : v.model === 'van' ? 1.8 : S ? (S.belt[0] + S.belt[1]) / 2 + 0.26 : 1.2;
    const fwd = bus ? v.def.L / 2 - 1.2 : S ? S.ws0 - 1.4 : 0, side = bus ? 0.6 : 0.37;
    c.x = v.x + fx * fwd + rx * side; c.y = v.y + eye; c.z = v.z + fz * fwd + rz * side;
    const look = (G.time - c.lastUser < 2.5) ? c.yaw + Math.PI - h : 0;     // drag to look around, eases back
    c.yaw = G.time - c.lastUser < 2.5 ? c.yaw : h + Math.PI;
    const lh = h + look;
    G.camera.position.set(c.x, c.y, c.z);
    G.camera.lookAt(c.x + Math.cos(lh) * 20, c.y - 1.2 - (v.pitch || 0) * 20, c.z + Math.sin(lh) * 20);
  }
  // roadside cameras that hand over as the car passes
  cineCam(dt, v) {
    const c = this.cam, G = this.G, fx = Math.cos(v.heading), fz = Math.sin(v.heading);
    const far = !c.cine || Math.hypot(c.cine.x - v.x, c.cine.z - v.z) > 38 || ((c.cine.x - v.x) * fx + (c.cine.z - v.z) * fz) < -22;
    if (far) {
      const ahead = 16 + Math.min(24, Math.abs(v.sp || 0) * 1.6), sd = Math.random() < 0.5 ? -1 : 1;
      const x = v.x + fx * ahead - fz * sd * 7, z = v.z + fz * ahead + fx * sd * 7;
      const gy = G.tiles.ground(x, z, v.y + 2) ?? v.y;
      c.cine = { x, z, y: gy + (Math.random() < 0.3 ? 4.5 : 1.1) };
    }
    G.camera.position.set(c.cine.x, c.cine.y, c.cine.z);
    G.camera.lookAt(v.x, v.y + 0.9, v.z);
    c.x = c.cine.x; c.y = c.cine.y; c.z = c.cine.z;
  }
  followCam(dt, tx, ty, tz, dist, moveHeading, rate = 1.6, pitchTarget = null) {
    const c = this.cam, G = this.G;
    if (moveHeading != null && G.time - c.lastUser > 1.4) c.yaw = lerpAngle(c.yaw, moveHeading + Math.PI, Math.min(1, dt * rate));
    if (pitchTarget != null && G.time - c.lastUser > 1.4) c.pitch += (pitchTarget - c.pitch) * Math.min(1, dt * 2);
    c.dist += (dist - c.dist) * Math.min(1, dt * 3);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    let d = c.dist;
    // pull in when a building is between the target and the camera
    for (let s = 0.8; s <= c.dist; s += 0.5) {
      const x = tx + Math.cos(c.yaw) * cp * s, y = ty + sp * s, z = tz + Math.sin(c.yaw) * cp * s;
      if (G.tiles.insideBuilding(x, z, y)) { d = Math.max(0.8, s - 0.6); break; }
    }
    c.x = tx + Math.cos(c.yaw) * cp * d; c.y = ty + sp * d; c.z = tz + Math.sin(c.yaw) * cp * d;
    const gy = G.tiles.ground(c.x, c.z, c.y);
    if (gy != null && c.y < gy + 0.5) c.y = gy + 0.5;
    G.camera.position.set(c.x, c.y, c.z);
    G.camera.lookAt(tx, ty, tz);
  }
  // ------------------------------------------------------------------ actions
  nearestVehicle(maxD = 4.5) {
    const me = this.me; let best = null, bd = maxD;
    for (const v of this.G.traffic.list) {
      if (!v.parked || v.hidden || v.occupied) continue;
      // a brother's own car wins when it is within reach
      const d = Math.hypot(v.x - me.x, v.z - me.z) - v.def.W / 2 - (v.owner === me.short ? 3 : 0);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  toggleVehicle() {
    const G = this.G, me = this.me, v = this.vehicleOf(me);
    if (v) {
      if (Math.abs(v.sp || 0) > 2) { G.hud.toast('Slow down to get out'); return; }
      v.sp = 0; v.v = 0; v.player = false; v.parked = true; v.owner = v.owner || me.short; v.brake = false;
      v.parkedBy = me.short; v.parkedAt = G.world.time;
      const rx = -Math.sin(v.heading), rz = Math.cos(v.heading);
      me.x = v.x + rx * (v.def.W / 2 + 0.7); me.z = v.z + rz * (v.def.W / 2 + 0.7);
      me.y = G.tiles.ground(me.x, me.z, v.y + 0.5) ?? v.y; me.heading = v.heading + Math.PI / 2;
      me.vehicle = null;
      G.events.emit('parked', { v, by: me });
      G.hud.toast(`${me.short} parked on ${G.roadName(v.x, v.z) || 'the street'}`);
      G.save.markVehicle(v);
    } else {
      const n = this.nearestVehicle();
      if (!n) { G.hud.toast('No vehicle within reach'); return; }
      const wasNpc = !n.owner && !n.free;
      n.parked = false; n.player = true; n.free = true; n.hidden = false;
      me.vehicle = n.id; n.sp = 0;
      if (wasNpc) G.events.emit('tookVehicle', { v: n, by: me });
      G.save.markVehicle(n);
      this.cam.lastUser = -10;
    }
  }
  swap() {
    const G = this.G;
    const from = this.me;
    const fv = this.vehicleOf(from);
    if (fv && Math.abs(fv.sp || 0) > 1.5) { G.hud.toast('Stop the vehicle before switching'); return; }
    if (fv) { fv.sp = 0; fv.v = 0; fv.player = false; fv.parked = true; fv.occupied = from.short; G.save.markVehicle(fv); }
    this.active = 1 - this.active;
    const to = this.me;
    const tv = this.vehicleOf(to);
    if (tv) { tv.parked = false; tv.player = true; tv.occupied = null; }
    this.cam.yaw = to.heading + Math.PI; this.cam.lastUser = -10;
    G.events.emit('swap', { from, to });
    G.hud.fade(`${to.name} · ${G.districtName(to.x, to.z)}`);
    G.save.now();
  }
}

// push a circle out of a vehicle's oriented box
function pushFromBox(x, z, r, v) {
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  const dx = x - v.x, dz = z - v.z;
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  const hx = v.def.L / 2 + r, hz = v.def.W / 2 + r;
  if (Math.abs(lx) > hx || Math.abs(lz) > hz) return [x, z];
  const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
  let ox = 0, oz = 0;
  if (px < pz) ox = Math.sign(lx) * px; else oz = Math.sign(lz) * pz;
  return [x + ox * c - oz * s, z + ox * s + oz * c];
}
// separating-axis overlap of two oriented rectangles; returns push vector for A
function obbOverlap(ax, az, ah, aL, aW, bx, bz, bh, bL, bW) {
  const axes = [[Math.cos(ah), Math.sin(ah)], [-Math.sin(ah), Math.cos(ah)], [Math.cos(bh), Math.sin(bh)], [-Math.sin(bh), Math.cos(bh)]];
  const dx = bx - ax, dz = bz - az;
  let minO = 1e9, best = null;
  for (const [ux, uz] of axes) {
    const ra = Math.abs(aL / 2 * (Math.cos(ah) * ux + Math.sin(ah) * uz)) + Math.abs(aW / 2 * (-Math.sin(ah) * ux + Math.cos(ah) * uz));
    const rb = Math.abs(bL / 2 * (Math.cos(bh) * ux + Math.sin(bh) * uz)) + Math.abs(bW / 2 * (-Math.sin(bh) * ux + Math.cos(bh) * uz));
    const dist = dx * ux + dz * uz;
    const o = ra + rb - Math.abs(dist);
    if (o <= 0) return null;
    if (o < minO) { minO = o; best = [ux * o * Math.sign(dist), uz * o * Math.sign(dist)]; }
  }
  return best;
}
