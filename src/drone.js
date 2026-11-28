// The Kestrel T3: a camera drone with a thermal camera, bought at TechZone (techShop.js) and flown from wherever the
// brother stands, anywhere on the map and up into the clouds.
//
// Flight model: a rigid body (0.82 kg) lifted by four props along its own up axis, against gravity, quadratic drag
// (more face-on than edge-on), the wind (stronger with height, gusting) and ground effect near the surface. The
// flight controller works the way a real one does:
//   CINE / NORMAL / SPORT  self-levelling with GPS hold: the right stick asks for a speed over the ground in the
//                          direction the drone faces, the left stick a climb rate and a turn rate; centred sticks
//                          brake to a hover and hold it against the wind (an integral wind estimate). The velocity
//                          loop asks for a thrust vector, the attitude loop turns that into body rates.
//   MANUAL                 full acro, like an FPV quad: the sticks ask for body rates through Betaflight-style rates
//                          (centre-soft expo, up to ~700 deg/s), the throttle is raw (hover at mid-stick), nothing
//                          levels it, and the camera is fixed to the frame tilted up 30 degrees.
// The body rates follow the controller through the props' spin-up lag (35 ms); thrust lags 50 ms. Physics runs in
// fixed 1/240 s substeps.
// Collisions: the ground (and bridge decks), building walls and roofs (land on a roof), tree trunks and canopies,
// water (it sinks), vehicles and people. A hard hit is a crash: motors cut, it tumbles; upright it can take off
// again, upside down it flips itself over (turtle mode), and broken props are swapped from the spares in the kit.
// Battery (39.9 Wh, ~30 min hover), video link (15 km), return to home (failsafe on low battery or lost signal).
import * as THREE from 'three/webgpu';
import { buildDroneModel } from './droneModel.js';

const G0 = 9.81, RHO = 1.225, HZ = 240;
const DEG = Math.PI / 180;
export const MODES = ['CINE', 'NORMAL', 'SPORT', 'MANUAL'];
const MODE = {
  CINE: { vmax: 5, up: 3, down: 2.5, yaw: 45, tilt: 18, kv: 1.3, smooth: 0.45 },
  NORMAL: { vmax: 12, up: 5, down: 4, yaw: 95, tilt: 30, kv: 1.9, smooth: 0.18 },
  SPORT: { vmax: 21, up: 7, down: 6, yaw: 160, tilt: 45, kv: 2.4, smooth: 0.08 },
  MANUAL: { vmax: 40, up: 20, down: 20, yaw: 0, tilt: 180, kv: 0, smooth: 0 },
};
export const SPEC = {
  mass: 0.82, twr: 3.4, cdaH: 0.030, cdaV: 0.065, radius: 0.24, wh: 39.9, pHover: 74, pElec: 6, range: 15000,
  crashV: 4.6, guardV: 6.8, propBreakV: 9.5, ceiling: 3600, uptilt: 30 * DEG, fovGimbal: 82, fovFPV: 116,
};
// Betaflight "actual" rates: centre sensitivity, max rate, expo (deg/s)
const RATES = { center: 200, max: 720, expo: 0.55 };
const rate = s => { const a = Math.abs(s), e = RATES.expo; const y = a * (1 - e) + a * a * a * e; return Math.sign(s) * (RATES.center * a + (RATES.max - RATES.center) * Math.max(0, y - a * 0.2) / 0.8) * DEG; };

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0), YAXIS = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const inRing = (P, s, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = P[(s + i) * 2], zi = P[(s + i) * 2 + 1], xj = P[(s + j) * 2], zj = P[(s + j) * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// a cheap smooth 1D noise (gusts, turbulence)
const noise1 = t => { const i = Math.floor(t), f = t - i, h = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1; };

export class Drone {
  constructor(G) {
    this.G = G;
    this.active = false;          // the view and the controls are on the drone
    this.state = 'packed';        // packed | landed | flying | crashed | ditched
    this.mode = 'NORMAL';
    this.view = 'fpv';            // fpv | chase | pilot
    this.cam = 'normal';          // normal | thermal (white hot) | ironbow
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3();
    this.T = 0; this.Tcmd = 0; this.armed = false; this.rth = null; this.home = new THREE.Vector3();
    this.gimbal = -12 * DEG; this.gimbalWant = -12 * DEG; this.yawWant = 0; this.windI = new THREE.Vector2();
    this.stick = { lx: 0, ly: 0, rx: 0, ry: 0 };   // filtered stick inputs, -1..1 (up and right positive)
    this.raw = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this.battery = 1; this.flightT = 0; this.maxAlt = 0; this.dist = 0; this.signal = 1;
    this.contact = null; this.restT = 0; this.turtleT = 0; this.crashT = 0; this.inFoliage = 0;
    this.events = [];             // for the HUD, the audio and the haptics: { kind, ... }
    this.motor = [0, 0, 0, 0];    // prop speeds 0..1 (the model spins them, the audio follows them)
    this.acc = 0;                 // fixed-step accumulator
    this.t = 0;
    this.model = null;
  }
  // ---------------------------------------------------------------- ownership (on the brother, saved with him)
  kit(b = this.G.brothers.me) { return b.items?.drone || null; }
  give(b) { b.items ??= {}; b.items.drone ??= { model: 'kestrel-t3', props: 2, battery: 1, upgrades: {} }; return b.items.drone; }
  upgrade(b, id) { const k = this.give(b); if (id === 'props') k.props = (k.props || 0) + 4; else k.upgrades[id] = true; }
  // the drone as kitted out (upgrades from TechZone), worked out once a frame
  get spec() { return this._spec || this.refreshSpec(); }
  refreshSpec() {
    const k = this.kit(this.pilot || this.G.brothers.me) || {}, u = k.upgrades || {};
    return (this._spec = { ...SPEC, wh: SPEC.wh * (u.battery ? 1.45 : 1), range: SPEC.range + (u.range ? 10000 : 0), crashV: u.guards ? SPEC.guardV : SPEC.crashV, propBreakV: SPEC.propBreakV + (u.guards ? 3 : 0) });
  }
  // ---------------------------------------------------------------- taking it out, putting it away
  canDeploy() {
    const G = this.G, B = G.brothers, me = B.me;
    if (!this.kit()) return 'You need a drone: TechZone sells them';
    if (this.active) return 'Already flying';
    if (B.vehicleOf(me) || G.transit?.ride || G.taxis?.riding) return 'Get out first';
    if (G.interiors?.at?.(me)) return 'Take it outside';
    if (me.swimming) return 'Not while swimming';
    return null;
  }
  deploy() {
    const why = this.canDeploy(); if (why) { this.G.hud?.toast?.(why); return false; }
    const G = this.G, me = G.brothers.me, k = this.kit();
    if ((k.props ?? 0) < 0) { G.hud?.toast?.('The props are broken: buy spares at TechZone'); return false; }
    // set it down a couple of metres in front, clear of walls
    let d = 2.2, x = me.x, z = me.z;
    for (; d > 0.6; d -= 0.4) { x = me.x + Math.cos(me.heading) * d; z = me.z + Math.sin(me.heading) * d; if (!G.tiles.insideBuilding(x, z, me.y + 0.5)) break; }
    const gy = G.tiles.ground(x, z, me.y + 0.5) ?? me.y;
    this.p.set(x, gy + 0.09, z); this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    // facing where the brother faces
    this.q.setFromAxisAngle(YAXIS, -me.heading - Math.PI / 2); this.yawWant = this.yaw;
    this.home.copy(this.p); this.state = 'landed'; this.armed = false; this.T = this.Tcmd = 0; this.rth = null;
    this.battery = k.battery ?? 1; this.flightT = 0; this.maxAlt = 0; this.crashT = 0; this.turtleT = 0;
    this.gimbal = this.gimbalWant = -12 * DEG; this.windI.set(0, 0);
    this.ensureModel(); this.model.visible = true;
    this.active = true; this.pilot = me; this.view = 'fpv';
    this.camSaved = { fov: G.camera.fov, near: G.camera.near, far: G.camera.far };
    this.emit('deploy');
    G.hud?.toast?.(`${me.short} sets the Kestrel down · ${this.mode} mode · Take off when ready`, 3.5);
    return true;
  }
  // back to the brother. Landed near him: packed away at once. In the air: it flies itself home (press again to
  // skip the flight: it comes straight back).
  exit(force) {
    if (!this.active) return;
    const G = this.G, near = this.p.distanceTo(this.pilotPos()) < 6;
    if (!force && this.state === 'flying' && !(this.rth && this.rth.exitAfter)) { this.startRTH('Returning home'); this.rth.exitAfter = true; G.hud?.toast?.('Flying home to land · press Exit again to bring it straight back', 3); return; }
    if (!force && this.state === 'landed' && !near && !this.rth) { this.startRTH('Returning home'); this.rth.exitAfter = true; G.hud?.toast?.('Flying back to you · press Exit again to bring it straight back', 3); return; }
    this.pack(near || this.state === 'landed' ? '' : 'The Kestrel is back in the bag');
  }
  pack(msg) {
    const G = this.G, k = this.kit(this.pilot || G.brothers.me);
    if (k) k.battery = 1;     // a fresh battery from the case for next time
    this.state = 'packed'; this.active = false; this.armed = false; this.rth = null; this.T = 0;
    if (this.model) this.model.visible = false;
    if (this.camSaved) { G.camera.fov = this.camSaved.fov; G.camera.near = this.camSaved.near; G.camera.far = this.camSaved.far; G.camera.updateProjectionMatrix(); }
    if (G.fogEdge) G.fogEdge.value = 1;
    if (this.pilot && this.G.brothers.actor) { const a = this.G.brothers.actor[this.G.brothers.active]; if (a) a.pose = 'idle'; }
    this.emit('pack');
    if (msg) G.hud?.toast?.(msg, 2.5);
  }
  pilotPos() { const b = this.pilot || this.G.brothers.me; return _v2.set(b.x, b.y + 1.5, b.z); }
  // ---------------------------------------------------------------- the orientation helpers
  get up() { return _up.set(0, 1, 0).applyQuaternion(this.q); }
  get fwd() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.q); }
  get yaw() { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q); return Math.atan2(-f.x, -f.z); }
  get heading() { const f = this.fwd; return Math.atan2(f.z, f.x); }     // the game's heading convention
  get agl() { return this.p.y - (this.groundY ?? this.p.y); }
  get speed() { return Math.hypot(this.v.x, this.v.z); }
  emit(kind, o = {}) { this.events.push({ kind, ...o }); if (this.events.length > 32) this.events.shift(); }
  // ---------------------------------------------------------------- commands
  takeoff() {
    if (this.state === 'crashed') return this.recover();
    if (this.state !== 'landed') return;
    const k = this.kit(this.pilot);
    if (k && (k.props ?? 0) < 0) { this.G.hud?.toast?.('Props broken and no spares: buy some at TechZone'); return; }
    this.armed = true; this.state = 'flying'; this.autoTO = 1.2; this.emit('arm');
  }
  land() { if (this.state === 'flying') { this.rth = { phase: 'land', auto: true }; this.emit('autoland'); } }
  toggleRTH() { if (this.rth && this.rth.phase !== 'land') { this.rth = null; this.emit('rthCancel'); } else if (this.state === 'flying' || this.state === 'landed') this.startRTH('Return to home'); }
  startRTH(why) {
    if (this.state === 'landed') this.takeoff();
    if (this.state !== 'flying') return;
    const G = this.G, pp = this.pilotPos();
    // home is beside the pilot; climb to clear what's on the way (the tallest roof on the line home, plus 15 m)
    this.home.set(pp.x + 1.6 * Math.cos((this.pilot || G.brothers.me).heading + 1.2), 0, pp.z + 1.6 * Math.sin((this.pilot || G.brothers.me).heading + 1.2));
    this.home.y = (G.tiles.ground(this.home.x, this.home.z, pp.y) ?? pp.y - 1.5) + 0.09;
    let top = Math.max(this.p.y, this.home.y + 35);
    const n = Math.min(40, Math.ceil(this.p.distanceTo(this.home) / 40));
    for (let i = 0; i <= n; i++) { const x = this.p.x + (this.home.x - this.p.x) * i / n, z = this.p.z + (this.home.z - this.p.z) * i / n; G.tiles.buildingsNear(x, z, 20, (P, s, nn, t) => { top = Math.max(top, t + 15); }); }
    this.rth = { phase: 'climb', alt: Math.min(top, this.home.y + SPEC.ceiling), why };
    this.emit('rth', { why });
  }
  recover() {
    const k = this.kit(this.pilot);
    if (this.state !== 'crashed' && this.state !== 'ditched') return;
    if (this.state === 'ditched') { this.G.hud?.toast?.('It went in the water: Exit to fish it out'); return; }
    if (this.broken) {
      if ((k?.props ?? 0) > 0) { k.props--; this.broken = false; this.G.hud?.toast?.(`Fitted a spare set of props (${k.props} left)`); }
      else { this.G.hud?.toast?.('Props broken and no spares: Exit to bring it back, buy props at TechZone'); return; }
    }
    if (this.up.y < 0.3) { this.turtleT = 1.1; this.emit('turtle'); return; }
    this.state = 'landed'; this.crashT = 0; this.emit('recovered');
    this.takeoff();
  }
  cycleMode(d = 1) { const i = (MODES.indexOf(this.mode) + d + MODES.length) % MODES.length; this.mode = MODES[i]; this.windI.set(0, 0); this.yawWant = this.yaw; this.emit('mode', { mode: this.mode }); }
  cycleCam() { const list = ['normal', 'thermal', 'ironbow']; this.cam = list[(list.indexOf(this.cam) + 1) % list.length]; this.emit('cam', { cam: this.cam }); }
  cycleView() { const list = ['fpv', 'chase', 'pilot']; this.view = list[(list.indexOf(this.view) + 1) % list.length]; this.emit('view', { view: this.view }); }

  // ---------------------------------------------------------------- per frame
  // input: { lx, ly, rx, ry } sticks (-1..1, up/right positive), gimbal (-1..1 rate), from droneHud.js / controller.js
  update(dt, input) {
    const G = this.G;
    this.t += dt; this.refreshSpec();
    if (input) Object.assign(this.raw, input.sticks || {});
    if (input?.gimbal) this.gimbalWant = clamp(this.gimbalWant + input.gimbal * dt * 70 * DEG, -90 * DEG, 25 * DEG);
    // any stick input takes back control from return-to-home (not from a failsafe)
    const moving = Math.abs(this.raw.rx) + Math.abs(this.raw.ry) + Math.abs(this.raw.lx) + Math.abs(this.raw.ly) > 0.35;
    if (this.rth && moving && !this.rth.failsafe && !this.rth.exitAfter && this.rth.phase !== 'land') { this.rth = null; this.emit('rthCancel'); }
    // stick shaping: CINE glides, SPORT is sharp
    const m = MODE[this.mode], a = m.smooth ? 1 - Math.exp(-dt / m.smooth) : 1;
    for (const k of ['lx', 'ly', 'rx', 'ry']) this.stick[k] += (this.raw[k] - this.stick[k]) * a;
    // the world around it, once a frame
    this.sense();
    // fixed substeps
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = 1 / HZ;
    while (this.acc >= h) { this.step(h); this.acc -= h; }
    // battery, signal, warnings, failsafes
    this.systems(dt);
    // the brother stands with the controller
    const B = G.brothers, act = B.actor?.[B.active];
    if (act) { act.pose = 'phone'; act.speed = 0; act.t = (act.t || 0) + dt; act.visible = true; }
    this.drawModel(dt);
    this.placeCamera(dt);
  }
  // ground, roofs, water and trees around the drone (once a frame: substeps reuse them)
  sense() {
    const G = this.G, p = this.p;
    this.groundY = G.tiles.ground(p.x, p.z, p.y + 0.5);
    if (this.groundY == null) this.groundY = G.tiles.terrain(p.x, p.z);
    this.waterY = G.tiles.waterLevel ? G.tiles.waterLevel(p.x, p.z) : null;
    // building footprints close enough to touch this frame
    const r = SPEC.radius + 1.5 + this.v.length() / 30, B = this._b ||= [];
    B.length = 0;
    G.tiles.buildingsNear(p.x, p.z, r, (P, s, n, top, base) => { if (p.y - 2 < top && p.y + 2 > base) B.push([P, s, n, top, base]); });
    // trees: the loaded tiles' trees near the drone
    const T = this._t ||= []; T.length = 0;
    const t = G.tiles.tileAt(p.x, p.z);
    if (t) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const q = G.tiles.byNum?.get((t.ix + dx) * 100003 + t.iz + dz); if (!q?.trees) continue;
      for (const tr of q.trees) if (Math.abs(tr[0] - p.x) < 14 && Math.abs(tr[1] - p.z) < 14) T.push(tr);
    }
    // what's ahead (the OSD's obstacle warning): walls within 12 m along the way it's moving, every few frames
    if (((this._obsN = (this._obsN || 0) + 1) & 3) === 0) {
      this.obstacle = null;
      const sp = this.v.length();
      if (sp > 1.5) {
        const dx = this.v.x / sp, dy = this.v.y / sp, dz = this.v.z / sp, F = [];
        G.tiles.buildingsNear(p.x + dx * 6, p.z + dz * 6, 7, (P, s, n, top, base) => { F.push([P, s, n, top, base]); });
        for (let d = 0.5; d <= 12 && this.obstacle == null && F.length; d += 0.5) {
          const x = p.x + dx * d, y = p.y + dy * d, z = p.z + dz * d;
          for (const [P, s, n, top, base] of F) if (y < top && y > base && inRing(P, s, n, x, z)) { this.obstacle = d; break; }
        }
      }
    }
    // vehicles and people nearby (bumps)
    const O = this._o ||= []; O.length = 0;
    if (p.y - (this.groundY ?? -1e9) < 4) {
      for (const v of G.traffic.list) if (!v.hidden && Math.abs(v.x - p.x) < 6 && Math.abs(v.z - p.z) < 6) O.push([v.x, (v.y || 0) + 0.8, v.z, (v.def?.W || 1.8) / 2 + 0.1, 1.6]);
      for (const q of G.peds.list) if (q.visible && !q.gone && Math.abs(q.x - p.x) < 3 && Math.abs(q.z - p.z) < 3) O.push([q.x, (q.y || 0) + 0.9, q.z, 0.3, 1.8]);
    }
    // wind at this height (log profile, gusting)
    const w = G.world.wind || [0, 0], agl = Math.max(0, p.y - (this.groundY ?? p.y));
    const k = 1 + 0.55 * Math.log10(1 + agl / 4), gust = 1 + 0.28 * noise1(this.t * 0.35) + 0.12 * noise1(this.t * 1.7 + 9);
    this.wind = [w[0] * k * gust, w[1] * k * gust];
  }
  // one physics substep
  step(h) {
    const S = this.spec, m = S.mass, mg = m * G0, Tmax = mg * S.twr, st = this.stick, M = MODE[this.mode];
    const up = this.up.clone(), p = this.p, v = this.v;
    let wDes = _v.set(0, 0, 0), Tcmd = 0;
    const flying = this.state === 'flying' && this.armed;
    if (flying) {
      if (this.rth) [wDes, Tcmd] = this.autopilot(h, up, mg, Tmax);
      else if (this.autoTO > 0) { this.autoTO -= h; [wDes, Tcmd] = this.angleMode(h, up, mg, Tmax, 0, 0.7, 0, 0); }
      else if (this.mode === 'MANUAL') {
        // acro: body rates from the sticks, raw throttle (hover at mid-stick: a curve through the hover point)
        // (stick forward pitches the nose down: a negative rate about the body's right axis)
        wDes.set(-rate(st.ry), -rate(st.lx) * 0.75, -rate(st.rx));
        const thr = (st.ly + 1) / 2, hov = 1 / S.twr;
        Tcmd = Tmax * (thr < 0.5 ? hov * Math.pow(thr / 0.5, 1.25) : hov + (1 - hov) * Math.pow((thr - 0.5) / 0.5, 1.35));
        // air mode: a little authority even at zero throttle
        Tcmd = Math.max(Tcmd, mg * 0.06);
      } else [wDes, Tcmd] = this.angleMode(h, up, mg, Tmax, st.rx, st.ly, st.ry, st.lx);
    } else if (this.turtleT > 0) {
      // turtle mode: two motors reversed flip it back onto its feet
      this.turtleT -= h; wDes.set(0, 0, 9); Tcmd = 0;
      if (this.turtleT <= 0 || this.up.y > 0.85) { this.turtleT = 0; this.q.setFromAxisAngle(YAXIS, this.yaw); this.w.set(0, 0, 0); this.state = 'landed'; this.crashT = 0; this.emit('recovered'); }
    }
    // the props spin up and down: rates follow with a 35 ms lag, thrust 50 ms
    const kr = 1 - Math.exp(-h / 0.035), kt = 1 - Math.exp(-h / 0.05);
    if (flying || this.turtleT > 0) {
      this.w.x += (wDes.x - this.w.x) * kr; this.w.y += (wDes.y - this.w.y) * kr; this.w.z += (wDes.z - this.w.z) * kr;
      // turbulence: wind gusts, and prop wash when it sinks into its own downdraught
      const sink = Math.max(0, -v.y - 2.5) * (1 - clamp(this.T / mg - 0.6, 0, 1)), gustK = Math.hypot(this.wind[0], this.wind[1]) * 0.012;
      const turb = (gustK + sink * 0.16) * (1 + this.inFoliage * 6);
      if (turb > 0) { this.w.x += (Math.random() - 0.5) * turb * 2; this.w.z += (Math.random() - 0.5) * turb * 2; this.w.y += (Math.random() - 0.5) * turb * 0.5; }
    } else if (this.state === 'landed') this.w.multiplyScalar(0.5);
    this.T += (clamp(Tcmd, 0, Tmax) - this.T) * kt;
    if (!flying) this.T *= this.state === 'crashed' ? 0.8 : 1;
    // integrate the attitude
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_v2.copy(this.w).divideScalar(wl), wl * h); this.q.multiply(_q).normalize(); }
    // forces: thrust along the body's up axis (more near the ground), drag against the air, gravity
    const agl = p.y - (this.groundY ?? -1e9);
    const T = this.T * (1 + 0.18 * Math.exp(-Math.max(0, agl) / 0.35));
    const ax = this.wind ? v.x - this.wind[0] : v.x, az = this.wind ? v.z - this.wind[1] : v.z, ay = v.y, air = Math.hypot(ax, ay, az);
    // drag area: face-on when tilted into the airflow
    const kH = 0.5 * RHO * (S.cdaH + (S.cdaV - S.cdaH) * Math.abs(up.x * ax + up.z * az) / (air + 1e-6) * 0.6), kV = 0.5 * RHO * S.cdaV;
    let fx = up.x * T - kH * air * ax, fy = up.y * T - kV * air * ay - mg, fz = up.z * T - kH * air * az;
    if (this.inFoliage) { const k = 1 + this.inFoliage * 30; fx -= v.x * k * 0.1; fy -= v.y * k * 0.1; fz -= v.z * k * 0.1; }
    if (this.state === 'ditched') { fy += mg * 0.92 - v.y * 3; fx -= v.x * 3; fz -= v.z * 3; }
    if (this.state === 'landed' && !this.armed) { v.set(0, 0, 0); return; }
    v.x += fx / m * h; v.y += fy / m * h; v.z += fz / m * h;
    p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
    this.collide(h);
    // prop speeds for the model and the motor sound (thrust ~ rpm^2), with each prop's share of the rate commands
    const base = Math.sqrt(clamp(this.T / Tmax, 0, 1));
    const mix = [this.w.x - this.w.z, this.w.x + this.w.z, -this.w.x - this.w.z, -this.w.x + this.w.z];
    for (let i = 0; i < 4; i++) this.motor[i] = clamp(base + mix[i] * 0.02 + (i % 2 ? 1 : -1) * this.w.y * 0.02, 0, 1);
  }
  // self-levelling flight: sticks (right x/y = roll/pitch, left y/x = climb/yaw) -> velocity -> thrust vector -> rates
  angleMode(h, up, mg, Tmax, sx, sy, fy, yx) {
    const M = MODE[this.mode] || MODE.NORMAL, S = this.spec, v = this.v;
    // desired heading: turn rate from the left stick
    this.yawWant -= yx * M.yaw * DEG * h * (Math.abs(yx) > 0.04 ? 1 : 0);
    if (Math.abs(this.yawWant - this.yaw) > Math.PI) this.yawWant = this.yaw + Math.atan2(Math.sin(this.yawWant - this.yaw), Math.cos(this.yawWant - this.yaw));
    const yw = this.yawWant, fx = -Math.sin(yw), fz = -Math.cos(yw), rxv = Math.cos(yw), rzv = -Math.sin(yw);
    // a speed over the ground in the facing frame; centred sticks hold position (brake, then hold against the wind)
    const vfx = (fy * fx + sx * rxv) * M.vmax, vfz = (fy * fz + sx * rzv) * M.vmax;
    const ex = vfx - v.x, ez = vfz - v.z;
    // integral term: learns the wind so the hover doesn't drift
    this.windI.x = clamp(this.windI.x + ex * h * 0.9, -12, 12); this.windI.y = clamp(this.windI.y + ez * h * 0.9, -12, 12);
    let axd = ex * M.kv + this.windI.x * 0.6, azd = ez * M.kv + this.windI.y * 0.6;
    // feed-forward for drag at the asked-for speed, so it reaches it
    const kH = 0.5 * RHO * S.cdaH / S.mass, wv = Math.hypot(vfx - (this.wind?.[0] || 0), vfz - (this.wind?.[1] || 0));
    axd += kH * wv * (vfx - (this.wind?.[0] || 0)); azd += kH * wv * (vfz - (this.wind?.[1] || 0));
    // vertical: a climb rate from the throttle stick
    const vyd = sy > 0 ? sy * M.up : sy * M.down;
    let ayd = (vyd - v.y) * 3.2;
    // the ceiling
    if (this.p.y - this.home.y > S.ceiling - 20 && ayd > 0) ayd = Math.min(ayd, (S.ceiling - (this.p.y - this.home.y)) * 0.5);
    // the thrust vector, its tilt limited (height first)
    const tilt = M.tilt * DEG, gz = G0 + ayd;
    let hx = axd, hz = azd; const hm = Math.hypot(hx, hz), lim = Math.max(0.1, gz) * Math.tan(tilt);
    if (hm > lim) { hx *= lim / hm; hz *= lim / hm; }
    _v2.set(hx, Math.max(0.5, gz), hz);
    const amag = _v2.length(); _v2.divideScalar(amag);
    // desired attitude: yaw first, then tilt the up axis onto the thrust direction
    _qy.setFromAxisAngle(YAXIS, yw); _q2.setFromUnitVectors(UP, _v2).multiply(_qy);
    // attitude error in the body frame -> rates
    _q.copy(this.q).invert().multiply(_q2); if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const kp = 9.5, kyaw = 11, maxR = 260 * DEG;
    const wd = new THREE.Vector3(clamp(2 * _q.x * kp, -maxR, maxR), clamp(2 * _q.y * kyaw, -M.yaw * 1.4 * DEG, M.yaw * 1.4 * DEG), clamp(2 * _q.z * kp, -maxR, maxR));
    // collective: the asked-for acceleration along the present up axis
    const T = this.spec.mass * amag * Math.max(0.2, up.dot(_v2));
    return [wd, clamp(T, mg * 0.05, Tmax)];
  }
  // return to home and auto-land
  autopilot(h, up, mg, Tmax) {
    const R = this.rth, p = this.p, home = this.home, dx = home.x - p.x, dz = home.z - p.z, d = Math.hypot(dx, dz);
    const save = this.mode; if (save === 'MANUAL' || save === 'CINE') this.mode = 'NORMAL';
    let sx = 0, sy = 0, fy = 0, yx = 0;
    if (R.phase === 'climb') { sy = p.y < R.alt - 1 ? 1 : 0; if (p.y >= R.alt - 1.5) R.phase = 'cruise'; }
    if (R.phase === 'cruise') {
      // turn to face home, then fly at it, slowing for the last 30 m
      const want = Math.atan2(-dx, -dz); let e = Math.atan2(Math.sin(want - this.yawWant), Math.cos(want - this.yawWant));
      this.yawWant += clamp(e, -1.6 * h, 1.6 * h); e = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      fy = Math.abs(e) < 0.5 ? Math.min(1, d / 30) : 0; sy = clamp((R.alt - p.y) * 0.3, -1, 1);
      if (d < 2) R.phase = 'land';
    }
    if (R.phase === 'land') {
      // over home: line up within a metre, then down, slowly for the last 5 m
      const fxv = -Math.sin(this.yawWant), fzv = -Math.cos(this.yawWant), rxv = Math.cos(this.yawWant), rzv = -Math.sin(this.yawWant);
      if (!R.auto) { fy = clamp((dx * fxv + dz * fzv) * 0.15, -0.3, 0.3); sx = clamp((dx * rxv + dz * rzv) * 0.15, -0.3, 0.3); }
      const agl = p.y - (this.groundY ?? p.y);
      sy = agl > 5 ? -0.75 : -0.22;
    }
    const out = this.angleMode(h, up, mg, Tmax, sx, sy, fy, 0);
    this.mode = save;
    return out;
  }
  // ---------------------------------------------------------------- collisions
  collide(h) {
    const p = this.p, v = this.v, r = SPEC.radius, S = this.spec;
    let n = null, depth = 0, kind = null;
    // the ground (and decks)
    if (this.groundY != null && p.y - r < this.groundY) { const d = this.groundY - (p.y - r); if (d > depth) { depth = d; n = [0, 1, 0]; kind = 'ground'; } }
    // buildings: walls push out, roofs are landed on
    for (const [P, s, nn, top, base] of this._b || []) {
      if (p.y + r < base || p.y - r > top) continue;
      let inside = false, best = 1e9, bx = 0, bz = 0;
      for (let i = 0, j = nn - 1; i < nn; j = i++) {
        const xi = P[(s + i) * 2], zi = P[(s + i) * 2 + 1], xj = P[(s + j) * 2], zj = P[(s + j) * 2 + 1];
        if ((zi > p.z) !== (zj > p.z) && p.x < (xj - xi) * (p.z - zi) / (zj - zi) + xi) inside = !inside;
        const ex = xi - xj, ez = zi - zj, L2 = ex * ex + ez * ez || 1; let t = ((p.x - xj) * ex + (p.z - zj) * ez) / L2; t = clamp(t, 0, 1);
        const qx = xj + ex * t, qz = zj + ez * t, dd = (qx - p.x) ** 2 + (qz - p.z) ** 2; if (dd < best) { best = dd; bx = qx; bz = qz; }
      }
      const de = Math.sqrt(best);
      if (!inside && de > r) continue;
      // came down onto it (or is just over the top): the roof
      const roofD = top - (p.y - r);
      if (roofD < 0.6 || (inside && v.y < -0.5 && roofD < 1.2)) { if (roofD > depth) { depth = roofD; n = [0, 1, 0]; kind = 'roof'; } continue; }
      // a wall: out to the nearest edge
      const ox = inside ? bx - p.x : p.x - bx, oz = inside ? bz - p.z : p.z - bz, ol = Math.hypot(ox, oz) || 1;
      const d = inside ? de + r : r - de;
      if (d > depth) { depth = d; n = [ox / ol, 0, oz / ol]; kind = 'wall'; }
    }
    // trees: trunks are solid, canopies drag and snag
    this.inFoliage *= 0.9;
    for (const [tx, tz, H] of this._t || []) {
      const gy = this.groundY ?? p.y, dx = p.x - tx, dz = p.z - tz, dh = Math.hypot(dx, dz);
      const trunkTop = gy + H * 0.45, cy = gy + H * 0.64, cr = Math.max(1.2, H * 0.3);
      if (p.y < trunkTop && dh < 0.22 + r) { const d = 0.22 + r - dh; if (d > depth) { depth = d; n = [dx / (dh || 1), 0, dz / (dh || 1)]; kind = 'trunk'; } }
      const dc = Math.hypot(dx, (p.y - cy) * 1.25, dz);
      if (dc < cr) { this.inFoliage = Math.max(this.inFoliage, 1 - dc / cr); if (this.state === 'flying' && v.length() > 7 && Math.random() < h * 8) this.crash(v.length() * 0.8, 'tree'); }
    }
    // vehicles and people
    for (const [ox, oy, oz, orad, oh] of this._o || []) {
      const dx = p.x - ox, dz = p.z - oz, dh = Math.hypot(dx, dz);
      if (dh < orad + r && Math.abs(p.y - oy) < oh / 2 + r) { const d = orad + r - dh; if (d > depth) { depth = d; n = [dx / (dh || 1), 0, dz / (dh || 1)]; kind = 'body'; } }
    }
    // water
    if (this.waterY != null && p.y - r * 0.5 < this.waterY && this.state !== 'ditched' && this.state !== 'packed') {
      this.state = 'ditched'; this.armed = false; this.T = 0; this.emit('splash', { x: p.x, y: this.waterY, z: p.z, speed: v.length() }); this.G.hud?.toast?.('Splash! The Kestrel is in the water', 3); return;
    }
    if (!n) { this.contact = null; return; }
    p.x += n[0] * depth; p.y += n[1] * depth; p.z += n[2] * depth;
    const vn = v.x * n[0] + v.y * n[1] + v.z * n[2];
    this.contact = { kind, n };
    if (vn >= 0) return;
    const impact = -vn, up = this.up;
    // a hard hit, or the props touching (tilted over on a surface): a crash
    if (this.state === 'flying' && (impact > S.crashV || (n[1] > 0.7 && up.y < 0.45 && impact > 0.6))) { this.crash(impact, kind); }
    // bounce, with friction along the surface
    const e = this.state === 'flying' ? 0.15 : 0.32, fr = n[1] > 0.7 ? 0.55 : 0.85;
    v.x -= (1 + e) * vn * n[0]; v.y -= (1 + e) * vn * n[1]; v.z -= (1 + e) * vn * n[2];
    if (n[1] > 0.7) { v.x *= 1 - (1 - fr) * Math.min(1, h * 60); v.z *= 1 - (1 - fr) * Math.min(1, h * 60); }
    if (impact > 1.2) this.emit('bump', { impact, kind });
  }
  crash(impact, kind) {
    if (this.state !== 'flying') return;
    const S = this.spec;
    this.state = 'crashed'; this.armed = false; this.rth = null; this.crashT = 0;
    this.broken = impact > S.propBreakV;
    this.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18).multiplyScalar(Math.min(1, impact / 8));
    this.emit('crash', { impact, kind, broken: this.broken, x: this.p.x, y: this.p.y, z: this.p.z });
  }
  // ---------------------------------------------------------------- battery, signal, failsafes
  systems(dt) {
    const S = this.spec, mg = S.mass * G0, G = this.G;
    if (this.state === 'flying') {
      this.flightT += dt;
      const P = S.pHover * Math.pow(Math.max(0.05, this.T / mg), 1.5) + S.pElec;
      this.battery = Math.max(0, this.battery - P * dt / 3600 / S.wh);
      this.maxAlt = Math.max(this.maxAlt, this.p.y - this.home.y);
    }
    this.dist = Math.hypot(this.p.x - this.pilotPos().x, this.p.z - this.pilotPos().z);
    // video link: fades over the last 30% of its range, and through hills between drone and pilot is ignored
    this.signal = clamp(1 - smoothstep(S.range * 0.7, S.range, this.dist), 0, 1);
    // auto landing after a return home
    if (this.state === 'flying' && this.contact && this.contact.n[1] > 0.7 && (this.rth?.phase === 'land' || this.stick.ly < -0.6) && this.v.length() < 1.6 && this.up.y > 0.8) {
      this.restT += dt; if (this.restT > 0.4) { this.state = 'landed'; this.armed = false; this.T = 0; this.v.set(0, 0, 0); this.emit('landed'); const exitAfter = this.rth?.exitAfter; this.rth = null; this.restT = 0; if (exitAfter && this.p.distanceTo(this.pilotPos()) < 8) this.pack(''); }
    } else this.restT = 0;
    // failsafes
    if (this.state === 'flying') {
      if (this.battery < 0.15 && !this.rth && !this.lowWarned) { this.lowWarned = true; this.startRTH('Low battery'); if (this.rth) this.rth.failsafe = true; G.hud?.toast?.('Battery low: returning home', 3); }
      if (this.battery < 0.05 && this.rth?.phase !== 'land') { this.rth = { phase: 'land', auto: true, failsafe: true }; G.hud?.toast?.('Battery critical: landing now', 3); }
      if (this.battery <= 0) { this.crash(0, 'battery'); this.broken = false; G.hud?.toast?.('Battery flat: the motors stopped'); }
      if (this.signal <= 0 && !this.rth?.failsafe) { this.startRTH('Signal lost'); if (this.rth) this.rth.failsafe = true; G.hud?.toast?.('Signal lost: returning home', 3); }
    }
    if (this.battery > 0.2) this.lowWarned = false;
    // crashed: it tumbles and comes to rest
    if (this.state === 'crashed' || this.state === 'ditched') {
      this.crashT += dt;
      if (this.state === 'crashed' && this.contact) this.w.multiplyScalar(Math.exp(-dt * 6));
      if (this.state === 'ditched') { this.w.multiplyScalar(Math.exp(-dt * 2)); if (this.waterY != null && this.crashT > 3) this.p.y = Math.max(this.p.y - dt * 0.15, this.waterY - 0.4); }
    }
  }
  // ---------------------------------------------------------------- the model, seen in chase and pilot views
  ensureModel() {
    if (this.model) return;
    this.model = buildDroneModel({ leds: true });
    this.G.scene.add(this.model);
  }
  drawModel(dt) {
    const M = this.model; if (!M) return;
    M.position.copy(this.p); M.quaternion.copy(this.q);
    // the props blur at speed; the front LEDs blink green when ready, the rear red ones steady
    M.userData.spin?.(this.motor, dt, this.state === 'flying' || this.turtleT > 0);
    M.userData.leds?.(this.t, this.state);
    // in FPV the camera is inside the body: don't draw it (except the prop guards' edges would clip the view)
    M.visible = this.view !== 'fpv';
  }
  // ---------------------------------------------------------------- cameras
  placeCamera(dt) {
    const G = this.G, cam = G.camera, p = this.p;
    let fov;
    if (this.view === 'fpv') {
      if (this.mode === 'MANUAL' && this.state !== 'landed') {
        // fixed to the frame, tilted up (a racing quad's camera)
        cam.quaternion.copy(this.q).multiply(_q.setFromAxisAngle(XAXIS, SPEC.uptilt));
        fov = SPEC.fovFPV;
      } else {
        // the gimbal: holds the horizon, follows the drone's heading, tilts as asked
        this.gimbal += (this.gimbalWant - this.gimbal) * Math.min(1, dt * 6);
        const yaw = this.yaw;
        this.camYaw = this.camYaw == null ? yaw : this.camYaw + Math.atan2(Math.sin(yaw - this.camYaw), Math.cos(yaw - this.camYaw)) * Math.min(1, dt * 8);
        cam.quaternion.setFromEuler(new THREE.Euler(this.gimbal, this.camYaw, 0, 'YXZ'));
        // a trace of motor vibration
        const vib = (this.T / (this.spec.mass * G0)) * 0.0006;
        if (vib > 0 && this.state === 'flying') { cam.rotateX((Math.random() - 0.5) * vib); cam.rotateY((Math.random() - 0.5) * vib); }
        fov = SPEC.fovGimbal;
      }
      // the lens sits at the nose, under the body
      const f = _v.set(0, -0.04, -0.12).applyQuaternion(this.q);
      cam.position.copy(p).add(f);
    } else if (this.view === 'chase') {
      // behind and above, lagging a little
      const yaw = this.yaw, back = _v.set(Math.sin(yaw) * 3.2, 1.1, Math.cos(yaw) * 3.2);
      const want = _v2.copy(p).add(back);
      this.chase = this.chase ? this.chase.lerp(want, Math.min(1, dt * 5)) : want.clone();
      const gy = G.tiles.ground(this.chase.x, this.chase.z, this.chase.y);
      if (gy != null && this.chase.y < gy + 0.4) this.chase.y = gy + 0.4;
      cam.position.copy(this.chase); cam.lookAt(p.x, p.y + 0.2, p.z);
      fov = 70;
    } else {
      // from the pilot's eyes, watching it fly
      const pp = this.pilotPos(); cam.position.set(pp.x, pp.y + 0.15, pp.z); cam.lookAt(p.x, p.y, p.z);
      // zoom in as it gets further away (a little, like your eyes would focus)
      const d = this.p.distanceTo(pp); fov = clamp(70 - Math.log2(1 + d / 15) * 12, 18, 70);
    }
    if (Math.abs(cam.fov - fov) > 0.05) cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  // where the world should stream around while it flies
  focus() { return this.active ? this.p : null; }
  // the drone in the save: nothing mid-flight (it goes back in the bag on load)
  static restore(G) { for (const b of G.brothers.b) if (b.items?.drone) b.items.drone.battery = 1; }
}
