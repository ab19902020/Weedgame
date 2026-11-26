import {quietDrive} from './propulsion.js';
// Cal and Ward brothers: the only playable people. Walking, running, driving, parking,
// swapping, and the third-person orbit camera.
import * as THREE from 'three/webgpu';
import { MODELS } from './vehicles.js';
import { lerpAngle } from './traffic.js';
import { pointInRing } from './tiles.js';

const JACKETS = [0x314958, 0x765741, 0x294735, 0x653143], SKINS = [0xb48265, 0x895e46, 0xc39475];

import { CAR_SPECS } from './carModel.js';
import { HERO_CARS } from './heroCars.js';
const SWIM_DEPTH = 0.45;   // a swimmer's root sits this far below the surface: the rigs' swim clips hold the head ~0.56 m above it
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
      style: 1, female: false, face: i ? 0 : 1, build: i ? 0.55 : 0.38, shoe: i ? 2 : 0, hood: !!i, cap: false, umbIdx: 0 };
  }
  get me() { return this.b[this.active]; }
  vehicleOf(b) { return b.vehicle ? this.G.traffic.byId.get(b.vehicle) : null; }
  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const G = this.G, me = this.me;
    const look = input.takeLook();
    if (look.dx || look.dy) { this.cam.yaw += look.dx * 0.0062; this.cam.pitch = Math.max(-0.25, Math.min(1.1, this.cam.pitch + look.dy * 0.0045)); this.cam.lastUser = G.time; }
    const veh = this.vehicleOf(me);
    if(G.interiors?.homeTV?.seated){G.interiors.homeTV.updateSeat(dt);return;}
    const law=G.police?.player;
    if(law?.state==='detained'||law?.stun>0||law?.surrendered){
      this.speedNow=0;const a=this.actor[this.active];a.speed=0;a.running=false;a.pose='hands';a.t+=dt;
      return;
    }
    if (veh) this.drive(dt, input, veh); else this.walk(dt, input);
    if (input.consume('camera')) this.cycleCamera(!!veh);
    if (input.consume('use')) {
      if(law?.state==='footchase' && !veh)law.surrendered=true;
      else if(!G.interiors?.use())this.toggleVehicle();
    }
    if (input.consume('swap')) this.swap();
    // update actors for both brothers
    for (let i = 0; i < 2; i++) {
      const b = this.b[i], a = this.actor[i];
      a.look = this.lookFor(i);
      a.visible = !b.vehicle;
      if (i !== this.active) { a.x = b.x; a.y = b.y; a.z = b.z; a.heading = b.heading; a.speed = 0; a.pose = b.swimming ? 'swim' : G.world.cur.rain > 0.35 && !G.shelteredAt(b.x, b.y, b.z) ? 'umbrella' : 'idle'; a.t += dt; }
    }
  }
  walk(dt, input) {
    const G = this.G, me = this.me, a = this.actor[this.active];
    const ax = input.axis();
    const run = input.padRun || input.held.has('run') || Math.hypot(ax.x, ax.y) > 0.92 && input.held.has('run');
    // water: wade (slower the deeper it gets) and swim where it's over chest height
    const IN = G.interiors?.at(me);     // inside an enterable building (interiors.js)
    const lvl = IN ? null : G.tiles.waterLevel ? G.tiles.waterLevel(me.x, me.z) : null, gy0 = IN ? me.y : G.tiles.ground(me.x, me.z, me.y + 0.3);
    const wdep = lvl != null && gy0 != null ? lvl - gy0 : 0;
    me.swimming = me.swimming ? wdep > 1.05 : wdep > 1.3;
    const wade = me.swimming ? 0 : Math.max(0, Math.min(0.65, wdep * 0.55));
    const speed = (me.swimming ? (run ? 1.9 : 1.1) : (run && wdep < 0.6 ? 5.4 : 1.7) * (1 - wade)) * Math.min(1, Math.hypot(ax.x, ax.y));
    const fx = -Math.cos(this.cam.yaw), fz = -Math.sin(this.cam.yaw);
    const dx = (-ax.y) * fx + ax.x * -fz, dz = (-ax.y) * fz + ax.x * fx;
    const l = Math.hypot(dx, dz);
    const tx = l > 0.01 ? dx / l * speed : 0, tz = l > 0.01 ? dz / l * speed : 0;
    const k = Math.min(1, dt * 8);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    let nx = me.x + this.vel.x * dt, nz = me.z + this.vel.z * dt;
    [nx, nz] = IN ? IN.collide(nx, nz, 0.3, me.y) : this.collideCircle(nx, nz, 0.32, me.y);
    // other people & vehicles
    if (!IN) for (const v of G.traffic.list) {
      const ddx = nx - v.x, ddz = nz - v.z; if (ddx * ddx + ddz * ddz > 64) continue;
      [nx, nz] = pushFromBox(nx, nz, 0.3, v);
    }
    const gy = IN ? IN.floorAt(nx, nz, me.y) : G.tiles.ground(nx, nz, me.y + 0.3);
    if (me.swimming && lvl != null) {
      // float with the head just out of the water; climbing out happens when the bed shelves up
      const target = Math.max(gy ?? -1e9, lvl - SWIM_DEPTH);
      me.y += (target - me.y) * Math.min(1, dt * 6);
    } else if (gy != null) { me.y = IN ? me.y + (gy - me.y) * Math.min(1, dt * 18) : gy > me.y ? me.y + (gy - me.y) * Math.min(1, dt * 14) : gy; }
    const mv = Math.hypot(nx - me.x, nz - me.z);
    me.x = nx; me.z = nz;
    const sp = mv / Math.max(dt, 1e-3);
    if (sp > 0.2) me.heading = lerpAngle(me.heading, Math.atan2(this.vel.z, this.vel.x), Math.min(1, dt * 10));
    a.x = me.x; a.y = me.y; a.z = me.z; a.heading = me.heading; a.speed = sp; a.running = run && sp > 3;
    a.phase = (a.phase + sp * dt * (a.running ? 2.6 : 3.6)) % (Math.PI * 2);
    a.t += dt;
    a.pose = me.swimming ? 'swim' : !IN && G.world.cur.rain > 0.35 && !a.running && !G.shelteredAt(me.x, me.y, me.z) ? 'umbrella' : 'walk';
    a.swimming = !!me.swimming; a.wading = wdep > 0.25 && !me.swimming;
    if (me.swimming) a.jumpTime = 0;
    this.speedNow = sp;
    // splashes: a burst going in, then droplets with each stroke or stride, and a wake on the water shader
    const drops = (n, up, spread) => G.breakables?.debris.burst('drop', n, me.x + Math.cos(me.heading) * 0.35, lvl + 0.15, me.z + Math.sin(me.heading) * 0.35, this.vel.x * 0.3, up, this.vel.z * 0.3, spread);
    if (lvl != null && wdep > 0.25) {
      if (!this._inWater && sp > 1.2) { drops(26, 2.6, 1.4); G.audio?.play?.('water', me.x, lvl, me.z, 0.8); }
      this._splT = (this._splT || 0) - dt;
      if (sp > 0.4 && this._splT <= 0) {
        this._splT = me.swimming ? 0.55 : 0.4;
        drops(me.swimming ? 7 : 5, 1.4, 0.7);
        G.audio?.play?.('water', me.x, lvl, me.z, me.swimming ? 0.45 : 0.35);
      }
      G.U.wake.value.set(me.x, me.z, Math.min(1, 0.25 + sp * 0.5));
    } else if (G.U.wake.value.z > 0) G.U.wake.value.z = Math.max(0, G.U.wake.value.z - dt * 0.8);
    this._inWater = lvl != null && wdep > 0.25;
    // on foot, only re-centre behind the brother while the stick is pushed mostly forward
    const forward = ax.y < -0.55 && Math.abs(ax.x) < 0.35;
    const fm = this.cam.foot;
    if (this.cam.baseFov && Math.abs(G.camera.fov - this.cam.baseFov) > 0.05) { G.camera.fov += (this.cam.baseFov - G.camera.fov) * Math.min(1, dt * 3); G.camera.updateProjectionMatrix(); }
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
    // hedges, fences and garden walls are breakables now (a car can go through them; people can't)
    if (G.breakables) [x, z] = G.breakables.pushOut(x, z, r, y ?? 0);
    return [x, z];
  }
  drive(dt, input, v) {
    const G = this.G, me = this.me;
    const c = input.driveControls ? input.driveControls(dt) : (a => ({ steer: a.x, gas: Math.max(0, -a.y), brake: Math.max(0, a.y) }))(input.axis());
    // brake pedal: brakes while moving; held at a standstill it holds the car, then after a moment engages reverse
    // (so stopping at a junction never lurches backwards). The accelerator brakes a car that is rolling backwards.
    const u = v.ph ? v.ph.vx * Math.cos(v.heading) + v.ph.vz * Math.sin(v.heading) : (v.sp || 0);
    // Reverse carries on only while the press that engaged it is held: a fresh press while rolling backwards brakes.
    const braking = c.brake > 0.05 && c.gas < 0.05;
    if (!braking) { this.stillT = 0; this.revHold = false; } else if (Math.abs(u) < 0.8) this.stillT = (this.stillT || 0) + dt;
    if (braking && this.stillT > 0.45) this.revHold = true;
    const reverse = braking && this.revHold && v.def.wheels!==2;
    // carPhysics.js: tyre model, gearbox, assists and impulse collisions
    const ctl = { throttle: c.gas > 0.05 ? c.gas : reverse ? -c.brake : 0, brake: reverse ? 0 : c.brake, steer: c.steer, handbrake: input.padBrake || input.held.has('brake'), assists: input.assists ?? 1 };
    if (G.fuel) ctl.throttle = G.fuel.drive(v, G.driveSeconds ?? dt, ctl.throttle);   // fuel.js: burns fuel; no throttle when dry
    if(v.spikeStop>0){
      v.spikeStop=Math.max(0,v.spikeStop-dt);ctl.throttle=0;ctl.brake=Math.max(ctl.brake,.58);
    }
    G.carDyn.drive(v, dt, ctl);
    const hit = G.carDyn.flush(v);
    if (hit > 2) this.cam.shake = Math.max(this.cam.shake || 0, Math.min(1, hit / 14));
    // pedestrians
    G.events.emit('vehicleSweep', { v, x: v.x, z: v.z, speed: Math.abs(v.sp) });
    const ph = v.ph;
    v.brake = ph.brk > 0.05 || (ph.hb && Math.abs(v.sp) > 0.5);
    v.reversing = ph.gear < 0 && v.sp < -0.1;
    if (input.consume('beam')) v.fullBeam=!v.fullBeam;
    v.lights = v.fullBeam || G.world.day < 0.6 || G.world.cur.rain > 0.4;
    me.x = v.x; me.y = v.y; me.z = v.z; me.heading = v.heading;
    this.speedNow = Math.abs(v.sp);
    if (input.consume('horn')) G.events.emit('horn', { x: v.x, z: v.z, v });
    const big = v.model.startsWith('bus') ? 13 : v.model === 'van' ? 8.5 : 7.2;
    const camY = v.y + (v.model.startsWith('bus') ? 3 : 1.5), mh = Math.abs(v.sp) > 1 ? (v.sp > 0 ? v.heading : v.heading + Math.PI) : null;
    const mode = this.cam.car;
    const vel = Math.hypot(ph.vx, ph.vz);
    const mhv = mh != null && vel > 4 && v.sp > 0 ? lerpAngle(v.heading, Math.atan2(ph.vz, ph.vx), 0.55) : mh;
    v.camInside = mode === 3;
    if (mode === 3) this.driverCam(v);
    else if (mode === 4) this.cineCam(dt, v);
    else this.followCam(dt, v.x, camY + (mode === 1 ? 0.4 : mode === 2 ? 1 : 0), v.z, big * [1, 1.65, 2.7][mode] * (1 + Math.min(0.18, vel / 260)), mhv, mode === 2 ? 2.2 : 1.6 + Math.min(1.2, vel / 30), [0.22, 0.3, 0.78][mode]);
    this.cameraFx(dt, vel, mode);
  }
  // speed widens the field of view a little; hard impacts shake the camera
  cameraFx(dt, vel, mode) {
    const G = this.G, c = this.cam, cam = G.camera;
    c.baseFov = c.baseFov || cam.fov;
    const want = c.baseFov + (mode === 3 ? 0.5 : 1) * Math.min(12, Math.max(0, vel - 8) * 0.3);
    if (Math.abs(cam.fov - want) > 0.05) { cam.fov += (want - cam.fov) * Math.min(1, dt * 2.5); cam.updateProjectionMatrix(); }
    if (c.shake > 0.01) {
      const k = c.shake * 0.22, t = G.time * 37;
      cam.position.x += Math.sin(t * 1.3) * k; cam.position.y += Math.sin(t * 1.7 + 1) * k * 0.6; cam.position.z += Math.sin(t * 1.1 + 2) * k;
      c.shake *= Math.exp(-dt * 5);
    }
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
    const bus = v.model.startsWith('bus'), S = CAR_SPECS[v.model], Hd = HERO_CARS[v.model]?.driver;
    // seat position from the car's own windscreen and belt line (hand-made models give their own)
    const bike = v.def.wheels === 2;
    const eye = bike ? (v.model === "dirtbike" ? 1.64 : 1.46) : Hd ? Hd.eye : bus ? 2.3 : v.model === 'van' ? 1.8 : S ? (S.belt[0] + S.belt[1]) / 2 + 0.26 : 1.2;
    const fwd = Hd ? Hd.fwd : bus ? v.def.L / 2 - 1.2 : S ? Math.max(S.ws0 - 1.4, S.rr0 + 0.3) : 0, side = bike ? 0 : Hd ? Hd.side : bus ? 0.6 : 0.37;
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
    const IN = !this.me.vehicle && G.interiors?.at(this.me);
    if (IN) { if (moveHeading != null && G.time - c.lastUser > 1.4) c.yaw = lerpAngle(c.yaw, moveHeading + Math.PI, Math.min(1, dt * rate)); IN.camera(c, dt, tx, ty, tz); return; }
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
    if (me.inside) return null;
    // a front door closer than any car wins the button
    const door = this.G.interiors?.prompt; if (door && door.act === 'enter') bd = Math.min(bd, door.d + 0.5);
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
      v.sp = 0; v.v = 0; v.player = false; v.parked = true; v.owner = v.owner || me.short; v.fullBeam=false; v.lights=false; v.brake = false; v.reversing = false; v.camInside = false;
      if (v.ph) { v.ph.vx = v.ph.vz = v.ph.w = 0; v.ph.gear = 1; }
      v.parkedBy = me.short; v.parkedAt = G.world.time;
      const rx = -Math.sin(v.heading), rz = Math.cos(v.heading);
      me.x = v.x + rx * (v.def.W / 2 + 0.7); me.z = v.z + rz * (v.def.W / 2 + 0.7);
      me.y = G.tiles.ground(me.x, me.z, v.y + 0.5) ?? v.y; me.heading = v.heading + Math.PI / 2;
      me.vehicle = null;
      if(v.def.wheels !== 2 && !quietDrive(v.model)) G.audio?.play('Car_Engine_Turning_Off', v.x, v.y, v.z);
      if(v.def.wheels !== 2) G.audio?.play('Car_Door_Close', me.x, me.y, me.z);
      G.events.emit('parked', { v, by: me });
      G.hud.toast(`${me.short} parked on ${G.roadName(v.x, v.z) || 'the street'}`);
      G.save.markVehicle(v);
    } else {
      const n = this.nearestVehicle();
      if (!n) { G.hud.toast('No vehicle within reach'); return; }
      const wasNpc = !n.owner && !n.free;
      if(n.def.wheels !== 2) G.audio?.play('Car_Door_Open', n.x, n.y, n.z);
      if (n.parked) { if (G.audio?.engineStart) G.audio.engineStart(n); else G.audio?.play('Car_Engine_Start_Up', n.x, n.y, n.z); }
      n.parked = false; n.player = true; n.free = true; n.hidden = false;
      me.vehicle = n.id; n.sp = 0;
      G.carDyn.loose.delete(n); if (n.ph) { n.ph.vx = n.ph.vz = n.ph.w = 0; n.ph.gear = 1; n.ph.rpm = 900; }
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
    if (fv) { fv.sp = 0; fv.v = 0; fv.player = false; fv.parked = true; fv.occupied = from.short; if (fv.ph) { fv.ph.vx = fv.ph.vz = fv.ph.w = 0; } G.save.markVehicle(fv); }
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
