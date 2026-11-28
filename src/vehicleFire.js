// Vehicles on fire, and blowing up.
//
// Put rounds into a car's bonnet (about seven from a pistol; a motorbike's engine and tank, about four) or smash it
// up badly enough and the engine smokes, a wisp from under the bonnet thickening and darkening, and then it catches.
// The fire starts in the engine bay, licking out round the bonnet and through the grille, and spreads back: through
// the bulkhead into the cabin (the windows glow orange from inside), then the whole car, black smoke pouring off it.
// The driver bails out and runs. Some seconds later the fuel tank goes: a white flash that lights up the street, a
// fireball rolling up into a column of black smoke, a ring of dust blown out over the ground, glass, panels and burning
// bits flung out in arcs, the windows of the cars around it shattering. The car itself is thrown into the air, spinning,
// and comes down a blackened shell on its rims, still burning. Anyone close is killed outright; further out they're
// knocked flat; the cars beside it are shoved and dented, and catch too if they're close enough (and go up in turn).
// Shooting a car that's already alight sets it off sooner. A hole in the tank (rounds into the back of the car) has
// it alight from the rear. Rounds into anything that isn't a car (a pedal bike) do nothing of the kind.
//
// The fire brigade comes to it (emergency.js): if they get the hose on it before it goes up, it doesn't; and they put
// out what's left of a car that has. Left alone, a wreck burns down and smoulders out over a couple of minutes.
// Fires, smoke and light: fireFx.js. Burnt shells: the car shaders (carModel.js, vehicles.js, heroCars.js).
import * as THREE from 'three/webgpu';
import { People } from './characters.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const SMOKE_AT = 0.45, IGNITE_AT = 1;
const pedal = v => v.def?.prof === 'cycle' || v.def?.prof === 'scooter';   // (no petrol: they don't burn)
const bike = v => v.def?.wheels === 2;
const heavy = v => (v.def?.mass || 0) > 5000;

export class VehicleFires {
  constructor(G) {
    this.G = G; this.list = new Set(); this.marks = []; this.scanT = 0; this.smokeT = 0;
    this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._c = new THREE.Vector3();
  }
  // ---------------------------------------------------------------- what sets them off
  // a round into a vehicle (combat.js). zone: 0 front, 1 rear, 2/3 sides
  shot(v, zone, w, by) {
    if (!v?.def || pedal(v) || v.burnt) return;
    const k = (w?.damage ?? 30) / 30;
    if (v.burning) { if (v.fire && !v.fire.exploded) v.fire.fuse = Math.max(0.15, v.fire.fuse - 0.55 * k); v.fire && (v.fire.by ||= by); return; }
    // the engine: under the bonnet (on a bike, it and the tank are most of what you can hit)
    if (zone === 0 || bike(v)) v.eng = Math.min(1.2, (v.eng || 0) + (bike(v) ? 0.26 : heavy(v) ? 0.07 : 0.15) * k);
    // the tank: low down at the back
    if (zone === 1 && !bike(v)) v.tank = Math.min(1, (v.tank || 0) + 0.06 * k);
    if (by) v.lastHitBy = by;
    // (the one you're in takes a bit more, and gives you longer to get out)
    if ((v.eng || 0) >= (v.player ? 1.15 : IGNITE_AT)) this.ignite(v, { by, fuse: v.player ? rnd(11, 14) : bike(v) ? rnd(4.5, 6.5) : heavy(v) ? rnd(14, 18) : rnd(8.5, 12) });
    else if ((v.tank || 0) >= 1) this.ignite(v, { by, from: 'rear', fuse: rnd(7, 10) });
  }
  // a vehicle catches fire. o: { by (who's to blame), fuse (s until the tank goes; Infinity: it won't), from
  // ('front' the engine, 'rear' the tank), quiet (no 999 call) }
  ignite(v, o = {}) {
    if (!v?.def || pedal(v) || v.burnt || v.burning || v.dead) return false;
    const F = v.fire = { t: 0, heat: 0.18, spread: 0, fuse: o.fuse ?? rnd(10, 14), from: o.from || 'front', by: o.by ?? v.lastHitBy ?? null, exploded: false, post: 0, cool: 0, srcs: null, bail: v.player || v.parked ? null : rnd(0.6, 1.4) };
    v.burning = true; v.smoking = true;
    if (!v.player) Object.assign(v, { crashed: !v.parked, v: 0, brake: true, hazard: false });
    this.list.add(v);
    if (v.player) this.G.hud.banner('Your vehicle’s on fire — get out!', 'pursuit', 4);
    if (!o.quiet) this.G.emergency?.vehicleFire?.(v);
    // people further off stop to look (and get their phones out); anyone close runs
    this.G.peds?.disturb?.(v.x, v.z, 45, 'fire'); this.G.peds?.disturb?.(v.x, v.z, 14, 'blaze');
    return true;
  }
  // a hose on it (emergency.js): it doesn't go up while they're cooling it, and it's out when the heat's gone
  douse(v, dt, takes) {
    const F = v.fire; if (!F) return 0;
    F.cool = 0.4;
    F.heat = Math.max(0, F.heat - dt / takes);
    if (F.heat <= 0 && !F.out) this.out(v);
    return F.heat;
  }
  out(v) {
    const F = v.fire; if (!F) return;
    F.out = true; F.heat = 0; F.smoulder = F.smoulder ?? 30;
    v.burning = false; v.doused = true;   // (once it's out, it stays out)
    if (F.exploded || F.t > 6) this.char(v);
  }
  char(v) {
    if (v.burnt) return;
    Object.assign(v, { burnt: true, paint: 0x231f1c, lights: false, fullBeam: false, siren: false, lightsOnly: false, alarmT: 0, brake: false, hazard: false, ind: 0 });
    v.dmg = (v.dmg || [0, 0, 0, 0]).map(d => Math.max(d, 0.55));
    v.flat = [1, 1, 1, 1];
    if (!v.owner && !v.free && this.G.emergency && !this.G.emergency.wrecks.includes(v)) this.G.emergency.wrecks.push(v);
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G;
    if ((this.scanT -= dt) <= 0) { this.scanT = 0.5; this.scan(0.5); }
    // smoking engines (not yet alight)
    if ((this.smokeT -= dt) <= 0) {
      this.smokeT = 0.1; const cam = G.camera.position;
      for (const v of G.traffic.list) {
        const e = v.eng || 0;
        if ((e < SMOKE_AT && !(v.smokeT > 0)) || v.burning || v.burnt || v.hidden || pedal(v)) continue;
        if ((v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 110 * 110) continue;
        const S = v._smk || (v._smk = { heat: 0 }), k = clamp((e - SMOKE_AT) / (IGNITE_AT - SMOKE_AT), 0, 1);
        this.pose(v, S, bike(v) ? 0 : v.def.L / 2 - v.def.L * 0.16, v.def.H * 0.62, v.def.L * 0.12, v.def.W * 0.3);
        // (white-grey at first, steam and hot oil, going grey and then darker as it gets near to catching)
        S.heat = 0; S.smoke = 0.55 + k * 0.9 + (v.smokeT > 0 ? 0.4 : 0); S.dark = 0.8 - k * 0.48; S.h = 0.6; S.density = 0.6 + k * 0.28; S.smokeRate = 1;
        G.fireFx.burn(S, 0.1);
      }
    }
    for (const v of this.list) {
      const F = v.fire;
      if (!F || v.dead || !G.traffic.byId.has(v.id)) { this.list.delete(v); continue; }
      F.t += dt;
      if (F.bail != null && F.t >= F.bail) { F.bail = null; this.bailOut(v); }
      if (!F.out && (F.scare = (F.scare || 0) - dt) <= 0) { F.scare = 1.5; G.peds?.disturb?.(v.x, v.z, 13, 'blaze'); }   // (nobody hangs about next to it)
      if (v._air) this.fly(v, dt);
      if (!F.out) {
        if (F.cool > 0) F.cool -= dt;
        else if (!F.exploded) {
          // taking hold: hotter, and spreading back from where it started
          F.heat = Math.min(1, F.heat + dt * 0.11);
          F.spread = Math.min(1, F.spread + dt / Math.max(7, Math.min(F.fuse === Infinity ? 24 : F.fuse * 0.85, 24)));
          F.fuse -= dt;
          if (v.player && F.fuse < 3.2 && !F.warned) { F.warned = true; G.hud.banner('It’s going to blow!', 'pursuit', 2.5); }
          if (F.fuse <= 0) this.explode(v);
          else if (F.fuse === Infinity && F.t > 150) this.out(v);   // (a fire that won't go up burns itself out)
        } else {
          // the wreck burns on, then down, then out
          F.post += dt;
          F.heat = F.post < 25 ? 1 : Math.max(0, 1 - (F.post - 25) / 95);
          if (F.heat <= 0) this.out(v);
        }
      } else if ((F.smoulder -= dt) <= 0) { this.list.delete(v); v.fire = null; v.smoking = false; continue; }
      this.draw(v, F, dt);
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i], cam = G.camera.position;
      if (Math.hypot(m.position.x - cam.x, m.position.z - cam.z) > 420) { G.scene.remove(m); m.geometry.dispose(); this.marks.splice(i, 1); }
    }
  }
  // badly damaged vehicles catch: a wrecked engine goes up; a car smashed in all round smokes for a few seconds first
  scan(dt) {
    const G = this.G, f = G.focus;
    for (const v of G.traffic.list) {
      if (v.burning || v.burnt || v.doused || !v.dmg || pedal(v) || v.hidden) continue;
      if (Math.hypot(v.x - f.x, v.z - f.z) > 260) continue;
      const d = v.dmg, total = d[0] + d[1] + d[2] + d[3], e = v.eng || 0;
      // (the one you're driving: only once the engine's completely gone)
      if (v.player) { if (e >= 1.15) this.ignite(v, { fuse: rnd(12, 15), by: null }); continue; }
      if (e >= IGNITE_AT) { this.ignite(v, { fuse: bike(v) ? rnd(5, 7) : rnd(11, 15) }); continue; }
      if (total < 3.2) { v.smokeT = 0; continue; }
      v.smoking = true; v.smokeT = (v.smokeT || 0) + dt;
      if (v.smokeT >= 8) this.ignite(v, { fuse: rnd(12, 16) });
    }
  }
  // a burn source on the vehicle: at local (ax along it, up above the ground under it), half extents hx, hz
  pose(v, S, ax, up, hx, hz) {
    const c = Math.cos(v.heading), s = Math.sin(v.heading), base = (v.y || 0) - (v.onRoof ? v.def.H : 0);
    S.x = v.x + c * ax; S.z = v.z + s * ax; S.y = base + up; S.heading = v.heading; S.hx = hx; S.hz = hz;
    return S;
  }
  draw(v, F, dt) {
    const G = this.G, L = v.def.L, W = v.def.W, H = v.def.H, B = bike(v);
    const cam = G.camera.position; if ((v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 260 * 260) return;
    const S = F.srcs || (F.srcs = [{}, {}, {}, {}]);
    const heat = F.out ? 0 : F.heat, k = F.exploded ? 1 : F.spread, rear = F.from === 'rear';
    const steam = F.out || F.cool > 0;
    if (B) {
      // a bike: it's all one fire, the tank and the engine together
      this.pose(v, S[0], 0, v.onSide ? 0.15 : 0.45, L * 0.3, 0.3);
      Object.assign(S[0], { heat, h: 1.1, smoke: heat * 0.9 + (steam ? 0.5 : 0), dark: steam ? 0.6 : 0.05, embers: 1, rate: 0.9, size: 0.9 });
      G.fireFx.burn(S[0], dt);
    } else {
      // engine bay, cabin, boot (the far end from where it started catches last), and once the tank's gone a pool of
      // burning fuel under it all
      const ends = [L / 2 - L * 0.15, -L * 0.03, -L / 2 + L * 0.15];
      if (rear) ends.reverse();
      const w = [1, smooth((k - 0.22) / 0.35), smooth((k - 0.58) / 0.35)];
      for (let j = 0; j < 3; j++) {
        const s = this.pose(v, S[j], ends[j], j === 1 ? H * 0.42 : H * 0.5, L * (j === 1 ? 0.17 : 0.13), W * 0.36);
        const hj = heat * w[j];
        Object.assign(s, { heat: hj, h: (j === 1 ? 1.25 : 0.95) * (heavy(v) ? 1.5 : 1) * (F.exploded ? 1.1 : 1), smoke: hj * 1.1 + (steam && w[j] > 0.1 ? 0.45 : 0), dark: steam ? 0.6 : F.exploded ? 0.02 : 0.06,
          embers: 0.8, rate: 1, size: 1, density: 0.85, smokeRate: j === 1 ? 1.3 : 1 });
        if (hj > 0.01 || s.smoke > 0.01) G.fireFx.burn(s, dt);
      }
      const pool = F.exploded ? heat * (F.post < 30 ? 1 : 0.6) : rear ? heat * 0.5 : 0;
      if (pool > 0.02) {
        const s = this.pose(v, S[3], -L * 0.08, 0.04, L * 0.46, W * 0.62);
        Object.assign(s, { heat: pool, h: 0.75, smoke: pool * 0.3, dark: 0.03, embers: 0.3, rate: 0.8, size: 0.85 });
        G.fireFx.burn(s, dt);
      }
    }
    // the fire's light on everything round it, flickering
    if (heat > 0.02) {
      const t = G.fireFx.time, fl = 0.8 + 0.12 * Math.sin(t * 13.7 + v.x) + 0.08 * Math.sin(t * 31.3 + v.z);
      G.fireFx.light(v.x, (v.y || 0) + (B ? 0.9 : H * 0.9), v.z, 1, 0.5, 0.15, (1.6 + 1.3 * k) * heat * fl * (heavy(v) ? 1.4 : 1), 9 + 6 * k);
    }
  }
  // the driver (or rider) gets out and runs
  bailOut(v) {
    const G = this.G;
    if (v.player || v.law || v.parked) return;   // (a parked car's empty, or it's the other brother sat in it)
    // (out of the driver's door, on the right)
    const h = v.heading, B = bike(v), sx = -Math.sin(h), sz = Math.cos(h), off = B ? 0.7 : v.def.W / 2 + 0.45;
    const x = v.x + sx * off + Math.cos(h) * (B ? 0 : v.def.L * 0.08), z = v.z + sz * off + Math.sin(h) * (B ? 0 : v.def.L * 0.08);
    const net = G.net, w = net.nearest(x, z, 40, e => net.walkable(e));
    const p = { id: 'p' + (G.peds.nextId++), x, y: v.y, z, heading: Math.atan2(sz, sx), look: People.randomLook(Math.random), speed: 1.3, speedNow: 0, mode: 'walk', t: 0, phase: 0, alpha: 1, visible: true,
      h: w ? w.e * 2 : v.h, s: w ? w.s : v.s, sideSign: w?.side || 1, lane: 0 };
    p.y = G.tiles.ground(x, z, v.y + 1) ?? v.y;
    p.reactT = 9 + Math.random() * 4; p.reactHeading = Math.atan2(v.z - z, v.x - x); p.reactPose = 'flee';
    G.peds.list.push(p);
    v.occupied = false; v.driverOut = true;
    if (B) { G.carjack?.knockDown?.(v, h + Math.PI / 2, 2); v.onSide = true; }
    G.audio?.play?.('Car_Door_Open', v.x, v.y + 1, v.z, 0.5);
  }
  // ---------------------------------------------------------------- the explosion
  explode(v) {
    const G = this.G, F = v.fire, B = bike(v), k = B ? 0.7 : heavy(v) ? 1.45 : 1;
    if (F.exploded) return;
    F.exploded = true; F.heat = 1; F.spread = 1; F.post = 0; F.bail = null;
    const x = v.x, z = v.z, y = G.tiles.ground(x, z, (v.y || 0) + 1) ?? v.y ?? 0;
    const back = F.from === 'rear' ? -0.6 : 0.3, cx = x + Math.cos(v.heading) * back, cz = z + Math.sin(v.heading) * back;
    this.debris(v, x, y, z, k);
    // in it: that's that
    const wasPlayer = v.player, me = G.brothers.me;
    if (wasPlayer || me.vehicle === v.id) G.wanted?.hurt?.(1000, x, z);
    this.char(v);
    if (!wasPlayer) {
      G.carDyn?.loose?.delete(v);
      Object.assign(v, { crashed: !v.parked, occupied: false, v: 0 });
      this.launch(v, k);
    }
    this.boom(cx, y + (B ? 0.4 : v.def.H * 0.45), cz, k, F.by, v, (B ? 2.2 : heavy(v) ? 5.5 : 3.6) * (0.9 + Math.random() * 0.2));
    if (v.law && F.by === 'player') G.events?.emit?.('copShot', {});
  }
  // a fuel tank (or a petrol pump) going up at (x, y, z): the fireball, the blast, the bang, the scorch on the ground
  boom(x, y, z, k = 1, by = null, src = null, mark = 3.6 * k) {
    const G = this.G, gy = G.tiles.ground(x, z, y + 1) ?? y - 0.5;
    G.fireFx.explosion(x, y, z, k);
    this.blast(x, gy + 0.8, z, k, by, src);
    this.scorch(x, gy, z, mark, src?.heading ?? Math.random() * 6.28);
    G.audio?.explosion?.(x, y + 0.5, z, k);
    const cam = G.camera.position, d = Math.hypot(x - cam.x, z - cam.z);
    G.brothers.cam.shake = Math.max(G.brothers.cam.shake || 0, clamp(1.35 - d / 45, 0, 1.1) * Math.min(1.2, k));
    if (d < 120) G.haptics?.rumble?.(clamp(1.1 - d / 90, 0.15, 1), clamp(1 - d / 110, 0.1, 0.9), 350 + 450 * clamp(1 - d / 80, 0, 1));
    G.peds?.disturb?.(x, z, 140, 'blaze');
    G.hud.feed('Explosion · ' + (G.roadName(x, z) || 'nearby'));
    G.events?.emit?.('explosion', { x, y: gy, z, by, v: src });
  }
  // what flies: glass, bits of trim and plastic, a number plate, panels (the bonnet, a door) and lumps of the engine
  debris(v, x, y, z, k) {
    const D = this.G.breakables?.debris; if (!D) return;
    // (the panels in their paint, scorched; the bits of the engine black)
    const B = bike(v), h = B ? 0.6 : v.def.H * 0.55, paint = new THREE.Color(v.paint ?? 0x777777), pc = [paint.r * 0.3 + 0.02, paint.g * 0.3 + 0.02, paint.b * 0.3 + 0.02];
    if (!B) D.burst('glass', Math.round(70 * k), x, y + v.def.H * 0.7, z, 0, 4, 0, 7);
    D.burst('trim', B ? 2 : 4, x, y + h, z, 0, 8, 0, 6);
    D.burst('plastic', Math.round(16 * k), x, y + h, z, 0, 7, 0, 7);
    D.burst('chip', Math.round(24 * k), x, y + h, z, 0, 8, 0, 8, pc);
    D.burst('panel', B ? 1 : 3, x, y + h + 0.3, z, 0, 10, 0, 5, pc);
    D.burst('chunk', B ? 3 : 7, x, y + h, z, 0, 7, 0, 6);
    D.burst('plate', B ? 1 : 2, x, y + h * 0.6, z, 0, 6, 0, 5);
    D.spark(Math.round(46 * k), x, y + h, z, 0, 7, 0, 12);
  }
  // thrown up and spun by the blast; it comes down on its wheels (a bike on its side)
  launch(v, k) {
    // (about 2 m up for a car, a little more for a motorbike, a bus or a fire engine barely off the ground)
    const B = bike(v), m = v.def.mass || 1500, up = clamp(8.4 - m / 650, 3.2, 7) * (0.88 + Math.random() * 0.24);
    const a = Math.random() * Math.PI * 2, lat = rnd(0.4, 1.6);
    this._e.set(v.roll || 0, -v.heading, v.pitch || 0, 'YXZ'); this._q.setFromEuler(this._e); this._c.set(0, v.def.H * 0.45, 0).applyQuaternion(this._q);
    v._air = { cx: v.x + this._c.x, cy: (v.y || 0) + this._c.y, cz: v.z + this._c.z, vx: Math.cos(a) * lat, vy: up, vz: Math.sin(a) * lat,
      wp: rnd(-0.8, 0.8), wr: rnd(-1.3, 1.3) * (B ? 1.6 : 1), wy: rnd(-0.9, 0.9), bounces: 0, settle: 0 };
    v.onSide = false; v.onRoof = false;
  }
  fly(v, dt) {
    const A = v._air, G = this.G, hc = v.def.H * 0.45, B = bike(v);
    if (A.settle > 0) {
      // down: easing on to its wheels (a bike on to its side), still turning about its middle
      A.settle -= dt; const e = 1 - Math.exp(-dt * 10);
      const want = B ? A.side * 1.42 : 0, g = G.tiles.ground(A.cx, A.cz, A.cy + 1) ?? (A.cy - hc);
      v.roll += (want - v.roll) * e; v.pitch += (0 - v.pitch) * e;
      A.cy += (g + hc * Math.cos(want) + (B ? 0.05 : 0) - A.cy) * e;
      this.place(v, A, hc);
      if (A.settle <= 0) { v.roll = want; v.pitch = 0; this.place(v, A, hc); v._air = null; if (B) { v.onSide = true; v.fallenBike = true; } }
      return;
    }
    A.vy -= 9.81 * dt; A.vx *= Math.exp(-0.4 * dt); A.vz *= Math.exp(-0.4 * dt);
    A.cx += A.vx * dt; A.cy += A.vy * dt; A.cz += A.vz * dt;
    v.pitch = (v.pitch || 0) + A.wp * dt; v.roll = (v.roll || 0) + A.wr * dt; v.heading += A.wy * dt;
    this.place(v, A, hc);
    const g = G.tiles.ground(A.cx, A.cz, A.cy + 1) ?? (A.cy - 5);
    if (A.vy < 0 && A.cy - hc * 0.85 <= g) {
      A.cy = g + hc * 0.85;
      const hard = -A.vy;
      G.audio?.shot?.('thud', A.cx, A.cz, clamp(hard / 8, 0.3, 1), g + 0.5);
      G.audio?.crash?.(A.cx, A.cz, clamp(hard / 10, 0.25, 0.8));
      G.breakables?.debris?.spark?.(12, A.cx, g + 0.2, A.cz, A.vx, 1, A.vz, 3);
      G.breakables?.debris?.burst?.('glass', 8, A.cx, g + 0.5, A.cz, A.vx, 1, A.vz, 2);
      for (let j = 0; j < 4; j++) G.fireFx.puff(A.cx + rnd(-1.5, 1.5), g + 0.3, A.cz + rnd(-1.5, 1.5), rnd(-2, 2), rnd(0.3, 1), rnd(-2, 2), 2.5, 1, 3, 0.55, 0, 0.5, 0, 2);
      const cam = G.camera.position, d = Math.hypot(A.cx - cam.x, A.cz - cam.z);
      G.brothers.cam.shake = Math.max(G.brothers.cam.shake || 0, clamp(0.5 - d / 60, 0, 0.5));
      A.bounces++;
      if (hard > 3.5 && A.bounces < 3) { A.vy = hard * 0.28; A.wp *= -0.4; A.wr *= -0.35; A.wy *= 0.5; A.vx *= 0.6; A.vz *= 0.6; }
      else {
        // (angles wrapped to the nearest turn, so it settles the short way round)
        const tw = Math.PI * 2, wrap = a => a - tw * Math.round(a / tw);
        v.roll = wrap(v.roll); v.pitch = wrap(v.pitch);
        A.settle = 0.55; A.side = Math.sign(v.roll) || 1;
      }
    }
  }
  // the vehicle's origin (the ground under its wheels) from where its middle is and how it's turned
  place(v, A, hc) {
    this._e.set(v.roll, -v.heading, v.pitch, 'YXZ'); this._q.setFromEuler(this._e); this._c.set(0, hc, 0).applyQuaternion(this._q);
    v.x = A.cx - this._c.x; v.y = A.cy - this._c.y; v.z = A.cz - this._c.z;
  }
  // the blast on everything round it: people, Cal, other vehicles, street furniture
  blast(x, y, z, k, by, src) {
    const G = this.G, R = 10 * k, kill = 4.2 * k;
    // people
    for (const p of G.peds.list) {
      if (p.carried || p.gone) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d > R || Math.abs((p.y || 0) - y) > 6) continue;
      const dir = Math.atan2(dz, dx);
      if (d < kill) {
        G.peds.hurt(p, dir, 'shot', 1000, { lethal: true, big: true, zone: 'torso', s: 1.4, push: 2.6 * (1.3 - d / kill), by, how: 'explosion' });
      } else G.peds.hurt(p, dir, 'down', 25 + 70 * (1 - (d - kill) / (R - kill)), { push: 2.2 * (1 - d / R) + 0.6, by, how: 'explosion' });
    }
    // you
    const me = G.brothers.me, inCar = me.vehicle && me.vehicle !== src?.id;
    if (me.vehicle !== src?.id) {
      const d = Math.hypot(me.x - x, me.z - z);
      if (d < R && Math.abs((me.y || 0) - y) < 6) {
        const dmg = 135 * Math.pow(1 - d / R, 1.3) * (inCar ? 0.35 : 1);
        if (dmg > 1) G.wanted?.hurt?.(dmg, x, z);
        if (!inCar && d < 7 * k && me.hp > 0) G.wanted?.knock?.(1.2 + (1 - d / (7 * k)) * 1.2);
      }
    }
    // other vehicles: shoved away, dented on the side facing it, their glass in; close ones catch (and go up in turn)
    for (const o of G.traffic.list) {
      if (o === src || o.dead || o.hidden) continue;
      const dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz), RV = 8.5 * k; if (d > RV || Math.abs((o.y || 0) - y) > 5) continue;
      const f = 1 - d / RV, nx = dx / (d || 1), nz = dz / (d || 1);
      if (!o.dmg) o.dmg = [0, 0, 0, 0];
      const c = Math.cos(o.heading), s = Math.sin(o.heading), lx = -(nx * c + nz * s), lz = -(-nx * s + nz * c);
      const zone = Math.abs(lx) / o.def.L > Math.abs(lz) / o.def.W ? (lx > 0 ? 0 : 1) : (lz > 0 ? 3 : 2);
      o.dmg[zone] = Math.min(1, o.dmg[zone] + f * 0.9);
      if (pedal(o)) { if (!o.fallenBike && !o.player) G.carjack?.knockDown?.(o, Math.atan2(nz, nx), 6 * f); continue; }
      o.eng = Math.min(1.2, (o.eng || 0) + f * 0.75);
      if (f > 0.25 && !o.burnt) G.breakables?.debris?.burst?.('glass', Math.round(10 + 20 * f), o.x, (o.y || 0) + o.def.H * 0.7, o.z, nx * 3, 1.5, nz * 3, 2);
      if (!o.burnt && (o.parked || o.kind === 'parked') && !o.player && !(o.alarmT > 0) && G.combat?.alarms) { o.alarmT = 14; G.combat.alarms.add(o); }
      if (o.player && o.ph) { o.ph.vx += nx * 9 * f; o.ph.vz += nz * 9 * f; o._kick = [rnd(-1, 1) * f * 6, (nx * -Math.sin(o.heading) + nz * Math.cos(o.heading)) * f * 8]; }
      else if (!o._air && G.carDyn?.makeLoose && !o.burnt && (o.def.mass || 1500) < 5000) {
        const ph = G.carDyn.makeLoose(o), push = 11 * f * Math.sqrt(1500 / (o.def.mass || 1500));
        ph.vx += nx * push; ph.vz += nz * push; ph.w += rnd(-1, 1) * 1.8 * f; o._kick = [rnd(-1, 1) * f * 6, f * 8];
        if (!o.parked) { o.crashed = true; o.v = 0; }
      }
      // (to its near end, about: a car parked nose to tail with it is 3-4 m off)
      const dn = Math.max(0, d - (o.def.L || 4) * 0.4);
      if (!o.burning && !o.burnt && (dn < 4.6 * k || (dn < 6 * k && Math.random() < 0.5) || o.eng >= 1)) this.ignite(o, { by, fuse: rnd(3, 6.5), quiet: true });
    }
    this.props(x, y, z, k);
  }
  // street furniture: bins and benches thrown, fence panels blown down, lamp lanterns blown out, leaves off the trees
  props(x, y, z, k) {
    const Br = this.G.breakables; if (!Br?.gather) return;
    const list = this._props || (this._props = []); list.length = 0;
    Br.gather(x, z, y, 9 * k, list);
    for (const c of list) {
      const e = c.b; if (!e || e.broken) continue;
      const ex = e.ax != null ? (e.ax + e.bx) / 2 : e.x, ez = e.az != null ? (e.az + e.bz) / 2 : e.z;
      const dx = ex - x, dz = ez - z, d = Math.hypot(dx, dz), nx = dx / (d || 1), nz = dz / (d || 1), f = 1 - d / (9 * k);
      if (f <= 0) continue;
      try {
        if (e.kind === 2 || e.kind === 3 || e.kind === 4 || e.kind === 8) { if (f > 0.25) { e.broken = true; Br.prop(e, nx, nz, 5 + 12 * f, 4 + 8 * f, ex, ez); Br.sound?.(e.S.snd, ex, ez, 0.6); } }
        else if (e.kind === 20) { if (f > 0.3) Br.shoot(e, { x: e.x, y: e.y + e.h - 0.4, z: e.z }, { x: nx, y: 0, z: nz }); }
        else if (e.kind === 7 || e.kind === 10 || e.kind === 22) { if (f > 0.6) { e.broken = true; Br.prop(e, nx, nz, 6, 3, ex, ez); } }
        else if (e.kind === 9) { if (f > 0.72) { e.broken = true; Br.prop(e, nx, nz, 9, 6, ex, ez); Br.sound?.('brick', ex, ez, 0.7); } }
        else if (e.kind === 21 || e.kind === 23) Br.bump?.(e, 8 * f + 4);
      } catch (err) { console.warn('blast prop', err); }
    }
  }
  // a blackened patch on the road where it went up
  scorch(x, y, z, size, heading) {
    const G = this.G;
    if (typeof document === 'undefined') return;
    if (!this._scorchMat) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(8,7,6,0.92)'); r.addColorStop(0.45, 'rgba(14,12,10,0.75)'); r.addColorStop(0.8, 'rgba(20,18,16,0.3)'); r.addColorStop(1, 'rgba(20,18,16,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, d = 30 + Math.random() * 34, s = 4 + Math.random() * 9; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, s, 0, 6.283); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill(); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = this._scorchMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff });
      m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
    }
    const geo = new THREE.PlaneGeometry(size, size * 0.8); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this._scorchMat); mesh.position.set(x, y + 0.025, z); mesh.rotation.y = -heading + Math.random() * 0.6; mesh.renderOrder = 2;
    G.scene.add(mesh); this.marks.push(mesh);
    if (this.marks.length > 10) { const old = this.marks.shift(); G.scene.remove(old); old.geometry.dispose(); }
  }
  // ---------------------------------------------------------------- for others
  // the burning vehicle nearest (x, z) within r (audio.js: the roar and crackle of it)
  nearest(x, z, r = 60) {
    let best = null, bd = r;
    for (const v of this.list) { if (!v.burning) continue; const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
}
