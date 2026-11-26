// Fighting and firearms for the brothers.
//  - Weapons (weaponsData.js): picked on the weapon wheel (hud.js), drawn and held for real: the gun is placed
//    from the body (rifle butt in the right shoulder, handguns and SMGs out in front of the chest) and both arms
//    are solved onto it (armIK.js), right palm round the grip, index finger on the trigger, left hand on the
//    handguard, pump or round the right hand. Lowered (a low-ready carry, or across the chest when running)
//    until fired; raised and aimed while shooting and for a moment after. Unlimited ammunition: magazines are
//    changed, with the owner's recordings of each kind of reload, but there's always another.
//  - Shots are traced against people (a capsule each, or lying flat when down), vehicles (their boxes),
//    buildings and the ground (marched, then pinned down by bisection), or the walls of the place you're in.
//    Each hit has its effect: a pock and brick dust on a wall, a dusty pit in the tarmac, sparks, a dent and
//    broken glass on a car, a red mist and a proper reaction (hitReactions.js) on a person.
//  - Unarmed: a jab, cross, hook and kick combo (the kick from the clips, the punches with the arms solved onto
//    the target), with a hit-stop and a jolt of the camera when one lands; the knife slashes.
// Police (police.js) hear about assaults and gunfire; crashing into things is left to the insurers.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPONS, BY_KEY, SAMPLES, shotInterval, reloadCues, spreadDirs } from './weaponsData.js';
import { GunFx } from './fx.js';
import { HeroArms } from './armIK.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
// the punches of a combo, then a kick: [name, which hand, reach, swing in from the side, reaction, damage]
const COMBO = [['jab', 'L', 0.62, 0, 'jab', 9], ['cross', 'R', 0.66, 0.1, 'jab', 13], ['hook', 'L', 0.5, 0.55, 'stagger', 18], ['kick', null, 0, 0, 'down', 26]];

export class Combat {
  constructor(G) {
    this.G = G;
    this.fx = new GunFx(G);
    this.loader = new GLTFLoader();
    this.templates = new Map(); this.loading = new Map();
    this.buf = {}; this.bufLoading = null;
    this.s = [0, 1].map(i => ({ i, mag: {}, aim: 0, aimT: 0, fireT: 0, queued: false, reloadT: 0, cues: [], recoil: 0, pump: 0, gun: null, gunKey: null,
      aimDir: new THREE.Vector3(1, 0, 0), aimYaw: 0, target: null, muzzle: new THREE.Vector3(), gunQ: new THREE.Quaternion(), posed: false,
      move: null, combo: 0, comboT: 0, guard: 0, slash: null, shake: 0 }));
    this.reported = -99;
    this.lastShotAt = -99;
  }
  key(i) { return this.G.brothers.b[i].weapon || null; }
  weapon(i) { const k = this.key(i); return k ? BY_KEY[k] : null; }
  // ---------------------------------------------------------------- choosing
  select(key, i = this.G.brothers.active) {
    const B = this.G.brothers, b = B.b[i];
    if (key && !BY_KEY[key]) return;
    b.weapon = key || null;
    const s = this.s[i]; s.reloadT = 0; s.cues = []; s.aimT = 0; s.queued = false; s.move = null; s.slash = null;
    if (key) { this.model(key); this.sounds(); const w = BY_KEY[key]; if (s.mag[key] == null) s.mag[key] = w.mag || 0;
      this.sample(w.melee ? null : 'rack', b.x, b.y + 1.3, b.z, 0.45); }
    this.G.hud?.weaponChanged?.();
  }
  status(i = this.G.brothers.active) {
    const w = this.weapon(i); if (!w) return null;
    const s = this.s[i];
    return { name: w.name, key: w.key, melee: !!w.melee, mag: s.mag[w.key] ?? w.mag, size: w.mag, reloading: s.reloadT > 0 };
  }
  model(key) {
    if (this.templates.has(key)) return Promise.resolve(this.templates.get(key));
    if (this.loading.has(key)) return this.loading.get(key);
    const w = BY_KEY[key];
    const job = this.loader.loadAsync('weapons/' + w.file + '.glb').then(g => {
      const m = g.scene; m.getObjectByName('LS_ORIENT_YUP')?.removeFromParent();
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      const root = new THREE.Group(); root.add(m); root.scale.setScalar(w.scale);
      this.templates.set(key, root); this.loading.delete(key); return root;
    }).catch(e => { console.warn('weapon load', key, e); this.loading.delete(key); return null; });
    this.loading.set(key, job); return job;
  }
  sounds() {
    if (this.bufLoading || !this.G.audio?.ctx) return;
    const ctx = this.G.audio.ctx;
    this.bufLoading = Promise.all(Object.entries(SAMPLES).map(([k, f]) => fetch('sfx/guns/' + f + '.mp3').then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).then(b => { this.buf[k] = b; }).catch(() => {})));
  }
  // one of the gun recordings, placed in the world (muffle: a low-pass corner in Hz, for the suppressor)
  sample(name, x, y, z, gain = 1, rate = 1, muffle = 0) {
    const A = this.G.audio; if (!name || !A?.ctx || !this.buf[name]) { if (A?.ctx && !this.bufLoading) this.sounds(); return; }
    const ctx = A.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createPanner();
    src.buffer = this.buf[name]; src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    g.gain.value = gain; pan.refDistance = 6; pan.rolloffFactor = 0.9; A.setPos(pan, x, y, z);
    let head = src;
    if (muffle) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = muffle; f.Q.value = 0.7; src.connect(f); head = f; }
    head.connect(g); g.connect(pan); pan.connect(A.master);
    src.onended = () => { src.disconnect(); g.disconnect(); pan.disconnect(); };
    src.start();
  }
  // ---------------------------------------------------------------- per frame (after the brothers have moved)
  update(dt, hitPressed, hitHeld) {
    const G = this.G, B = G.brothers, I = G.input;
    // the wheel and the number keys
    for (let n = 0; n <= 10; n++) if (I.consume('weapon' + n)) this.select(n === 0 ? null : WEAPONS[n - 1]?.key);
    if (I.consume('wheel')) G.hud?.toggleWheel?.();
    for (let i = 0; i < 2; i++) this.tick(i, dt);
    const me = B.me, i = B.active, s = this.s[i], a = B.actor[i];
    const busy = !!me.vehicle || G.transit?.ride || G.interiors?.games?.open || G.hud?.wheelOpen;
    if (!busy) {
      if (I.consume('reload')) this.reload(i);
      const w = this.weapon(i);
      if (!w) { if (hitPressed) this.punch(i); }
      else if (w.melee) { if (hitPressed) this.slash(i); }
      else this.trigger(i, w, hitPressed, hitHeld, dt);
      // aiming: the body turns to the aim, the arms come up
      if (s.aim > 0.15 && !me.swimming) { me.heading = lerpAngle(me.heading, s.aimYaw, Math.min(1, dt * 16)); a.heading = me.heading; }
    }
    // the shot and the blows shake the camera a little
    if (s.shake > 0.002) { const k = s.shake * 0.05, t = G.time * 41; G.camera.position.x += Math.sin(t * 1.3) * k; G.camera.position.y += Math.sin(t * 1.9 + 1) * k * 0.7; G.camera.position.z += Math.sin(t * 1.1 + 2) * k; s.shake *= Math.exp(-dt * 9); }
    this.fx.update(dt, G.camera);
  }
  tick(i, dt) {
    const s = this.s[i], w = this.weapon(i), b = this.G.brothers.b[i];
    s.aimT -= dt; s.fireT -= dt; s.comboT -= dt; s.guard = Math.max(0, s.guard - dt);
    s.aim += ((s.aimT > 0 && !b.vehicle ? 1 : 0) - s.aim) * Math.min(1, dt * (s.aimT > 0 ? 11 : 4));
    s.recoil *= Math.exp(-dt * 13); s.pump = Math.max(0, s.pump - dt);
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      for (const c of s.cues) if (!c.done && (w?.reload || 2) - s.reloadT >= c.at) { c.done = true; this.sample(c.name, b.x, b.y + 1.2, b.z, 0.6); }
      if (s.reloadT <= 0 && w) s.mag[w.key] = w.mag;
    }
    if (s.move) { s.move.t += dt; if (s.move.t > s.move.dur) s.move = null; }
    if (s.slash) { s.slash.t += dt; if (s.slash.t > 0.42) s.slash = null; }
  }
  reload(i) {
    const w = this.weapon(i), s = this.s[i]; if (!w || w.melee || s.reloadT > 0 || (s.mag[w.key] ?? 0) >= w.mag) return;
    s.reloadT = w.reload; s.cues = reloadCues(w).map(([name, at]) => ({ name, at, done: false })); s.queued = false;
  }
  // ---------------------------------------------------------------- guns
  trigger(i, w, pressed, held, dt) {
    const G = this.G, s = this.s[i];
    if (pressed || (held && w.automatic)) s.aimT = Math.max(s.aimT, 1.6);
    if (pressed && !w.automatic) s.queued = true;
    this.aim(i, w);
    const want = w.automatic ? held || pressed : s.queued;
    if (!want || s.reloadT > 0 || s.fireT > 0 || s.aim < 0.55) return;
    if ((s.mag[w.key] ?? w.mag) <= 0) { this.reload(i); return; }
    s.queued = false;
    s.fireT = shotInterval(w);
    s.mag[w.key] = (s.mag[w.key] ?? w.mag) - 1;
    this.shoot(i, w);
    if (s.mag[w.key] <= 0) setTimeout(() => this.reload(i), 250);
  }
  // what the active brother is aiming at: the nearest person (then vehicle) near the line of the camera
  aim(i, w) {
    const G = this.G, B = G.brothers, me = B.b[i], s = this.s[i];
    const yaw = B.cam.yaw + Math.PI, fx = Math.cos(yaw), fz = Math.sin(yaw);
    let best = null, bs = 1e9;
    const range = Math.min(w.range, w.zoom ? 90 : 45);
    for (const p of G.peds.list) {
      if (p.dead && p.react?.t > 1.5) continue;
      const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz); if (d < 0.6 || d > range || Math.abs(p.y - me.y) > 6) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)); if (ang > (d < 6 ? 0.75 : 0.42)) continue;
      const score = ang * 3 + d * 0.04; if (score < bs) { bs = score; best = { kind: 'ped', p, x: p.x, y: p.y + (p.dead ? 0.3 : 1.25), z: p.z }; }
    }
    if (!best) for (const v of G.traffic.list) {
      const dx = v.x - me.x, dz = v.z - me.z, d = Math.hypot(dx, dz); if (d < 1.5 || d > Math.min(range, 40)) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)); if (ang > 0.3) continue;
      const score = ang * 3 + d * 0.04; if (score < bs) { bs = score; best = { kind: 'car', v, x: v.x, y: v.y + 0.85, z: v.z }; }
    }
    s.target = best;
    const o = s.posed ? s.muzzle : _a.set(me.x, me.y + 1.4, me.z);
    if (best) { s.aimDir.set(best.x - o.x, best.y - o.y, best.z - o.z).normalize(); s.aimYaw = Math.atan2(best.z - me.z, best.x - me.x); }
    else { const pitch = clamp(-(B.cam.pitch - 0.28) * 0.9, -0.5, 0.6); s.aimDir.set(fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch)); s.aimYaw = yaw; }
  }
  shoot(i, w) {
    const G = this.G, B = G.brothers, b = B.b[i], s = this.s[i];
    const o = s.posed ? s.muzzle.clone() : new THREE.Vector3(b.x + s.aimDir.x * 0.6, b.y + 1.4, b.z + s.aimDir.z * 0.6);
    const dirs = spreadDirs(w, [s.aimDir.x, s.aimDir.y, s.aimDir.z], s.aim > 0.9);
    let hitSomeone = false;
    for (const d of dirs) {
      const dir = new THREE.Vector3(...d), hit = this.trace(o, dir, w.range, i);
      this.impact(hit, dir, w);
      if (hit.kind === 'ped') hitSomeone = true;
      if (dirs.length === 1 || Math.random() < 0.35) this.fx.tracer(o, dir, hit.t);
    }
    // muzzle flash and smoke, the report, brass out of the port, the gun kicking
    const big = w.hold === 'rifle' ? 0.3 : 0.2;
    if (!w.fire?.muffle) this.fx.flash(o, s.aimDir, big * (w.pellets ? 1.4 : 1)); else this.fx.flash(o, s.aimDir, 0.08);
    this.fx.puff(o, _a.copy(s.aimDir).multiplyScalar(1.5), [0.62, 0.62, 0.6], w.fire?.muffle ? 0.15 : 0.35, 0.08, 0.5, 0.9);
    this.sample(w.fire.sample, o.x, o.y, o.z, w.fire.gain, w.fire.rate, w.fire.muffle || 0);
    if (!w.pellets && !w.bolt && s.gun) {
      _b.set(-1, 0.6, -0.2).applyQuaternion(s.gunQ);
      _c.set(0, 0.03, 0.02).applyQuaternion(s.gunQ).add(s.gun.position);
      this.fx.casing(_c, _b.multiplyScalar(2.2).add(_d.set((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.6)));
    }
    if (w.pump || w.bolt) { s.pump = w.pump ? 0.55 : 0.9; setTimeout(() => { this.sample(w.pump ? 'rack' : 'boltIn', b.x, b.y + 1.3, b.z, 0.5); if (w.pump && s.gun) { _b.set(-1, 0.4, 0).applyQuaternion(s.gunQ); this.fx.casing(s.gun.position.clone(), _b.multiplyScalar(2)); } }, w.pump ? 260 : 420); }
    s.recoil += w.recoil; s.shake += w.recoil * (i === B.active ? 1 : 0);
    s.aimT = Math.max(s.aimT, 1.6);
    // everyone near runs; the police take an interest
    G.peds.disturb(b.x, b.z, w.fire?.muffle ? 14 : 55, 'gun');
    this.lastShotAt = G.time;
    this.report(hitSomeone ? 'shooting someone' : 'shots fired', b.x, b.z, 2);
  }
  report(what, x, z, level) {
    const G = this.G; if (G.time - this.reported < 6 || !G.police) return;
    this.reported = G.time;
    // seen by an officer: they act on it; otherwise somebody rings 999
    if (G.police.witnessed(x, z)) G.police.onOffence(what, x, z, level);
    else G.police.callIn?.(what, x, z, level);
  }
  // the first thing along o + t*d (t up to range): { kind: 'ped'|'car'|'wall'|'ground'|'none', t, p, n, ... }
  trace(o, d, range, shooter) {
    const G = this.G; let best = { kind: 'none', t: range };
    // people
    for (const p of G.peds.list) {
      const dx = p.x - o.x, dz = p.z - o.z; if (dx * dx + dz * dz > (best.t + 1) ** 2) continue;
      let A, Bv, r = 0.27;
      if (p.dead && p.react?.t > 1.2) { const h = p.react.dir; A = _a.set(p.x, p.y + 0.15, p.z); Bv = _b.set(p.x + Math.cos(h) * 1.6, p.y + 0.15, p.z + Math.sin(h) * 1.6); r = 0.2; }
      else { A = _a.set(p.x, p.y + 0.2, p.z); Bv = _b.set(p.x, p.y + 1.62, p.z); }
      const t = raySegment(o, d, A, Bv, r);
      if (t != null && t < best.t) best = { kind: 'ped', t, ped: p };
    }
    // vehicles
    for (const v of G.traffic.list) {
      if (v.hidden || !v.def) continue;
      const dx = v.x - o.x, dz = v.z - o.z, R = v.def.L / 2 + 1; if (dx * dx + dz * dz > (best.t + R) ** 2) continue;
      const t = rayBox(o, d, v);
      if (t != null && t < best.t) best = { kind: 'car', t, v };
    }
    // inside: the walls, floor and ceiling of the place
    const IN = G.interiors?.at?.(G.brothers.b[shooter]);
    if (IN) {
      const S = IN.site, P = IN.plan, [lx, ly] = G.interiors.toLocal(S, o.x, o.z), [tx, ty] = G.interiors.toLocal(S, o.x + d.x * best.t, o.z + d.z * best.t);
      const hRel = o.y - IN.floor0, f = P.ray(lx, ly, tx, ty, hRel);
      let t = f * best.t, kind = 'wall';
      const li = P.levelAt(hRel - 0.5), lv = P.levels[li];
      if (d.y < -1e-3) { const tf = (IN.floor0 + lv.h - o.y) / d.y; if (tf > 0 && tf < t) { t = tf; kind = 'floor'; } }
      if (d.y > 1e-3) { const tc = (IN.floor0 + lv.h + lv.ceil - o.y) / d.y; if (tc > 0 && tc < t) { t = tc; kind = 'ceiling'; } }
      if (t < best.t - 0.01) best = { kind, t, n: kind === 'floor' ? UP.clone() : kind === 'ceiling' ? UP.clone().negate() : new THREE.Vector3(-d.x, 0, -d.z).normalize(), inside: true };
    } else {
      // buildings and the ground: march, then bisect
      let prev = 0;
      for (let t = 0.4; t < best.t; t += 0.45) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        const gy = G.tiles.ground(x, z, y + 0.6);
        const under = gy != null && y < gy, inB = !under && G.tiles.insideBuilding(x, z, y);
        if (under || inB) {
          let lo = prev, hi = t;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2, mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
            const g2 = G.tiles.ground(mx, mz, my + 0.6), hit = under ? (g2 != null && my < g2) : !!G.tiles.insideBuilding(mx, mz, my);
            if (hit) hi = m; else lo = m;
          }
          const p = new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
          best = under ? { kind: 'ground', t: hi, p, n: UP.clone() } : { kind: 'wall', t: hi, p, n: this.wallNormal(p, d, inB) };
          break;
        }
        prev = t;
      }
    }
    best.p ??= new THREE.Vector3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t);
    return best;
  }
  // a building's face at p (the nearest edge of its footprint, facing the shot), or its roof
  wallNormal(p, d, b) {
    if (b && p.y > b.top - 0.2 && d.y < 0) return UP.clone();
    let best = 1e9, n = new THREE.Vector3(-d.x, 0, -d.z).normalize();
    this.G.tiles.buildingsNear(p.x, p.z, 1, (P, s, cnt) => {
      for (let i = 0, j = cnt - 1; i < cnt; j = i++) {
        const ax = P[(s + j) * 2], az = P[(s + j) * 2 + 1], bx = P[(s + i) * 2], bz = P[(s + i) * 2 + 1];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; let t = ((p.x - ax) * vx + (p.z - az) * vz) / L2; t = clamp(t, 0, 1);
        const qx = ax + vx * t - p.x, qz = az + vz * t - p.z, dd = qx * qx + qz * qz;
        if (dd < best) { best = dd; const L = Math.sqrt(L2); n.set(-vz / L, 0, vx / L); if (n.x * d.x + n.z * d.z > 0) n.negate(); }
      }
    });
    return n;
  }
  impact(hit, d, w) {
    const G = this.G, fx = this.fx, D = G.breakables?.debris, p = hit.p;
    const big = w.damage > 50 ? 1.35 : 1;
    switch (hit.kind) {
      case 'wall': case 'floor': case 'ceiling': {
        const col = hit.inside ? [0.62, 0.6, 0.56] : [0.5, 0.38, 0.32];
        fx.hole(p, hit.n, 0.075 * big, col);
        fx.puff(_a.copy(p).addScaledVector(hit.n, 0.06), _b.copy(hit.n).multiplyScalar(1.6), [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1], 0.75, 0.1, 0.7 * big, 1.1);
        D?.burst('rubble', 2, p.x + hit.n.x * 0.05, p.y, p.z + hit.n.z * 0.05, hit.n.x * 2.2, 1, hit.n.z * 2.2, 0.8, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
        if (Math.random() < 0.6) G.audio?.shot?.('brick', p.x, p.z, 0.25, p.y);
        break;
      }
      case 'ground': {
        fx.hole(p, hit.n, 0.06 * big, [0.25, 0.24, 0.23]);
        fx.puff(_a.copy(p).add(_b.set(0, 0.05, 0)), _b.set(-d.x * 0.5, 1.2, -d.z * 0.5), [0.45, 0.42, 0.38], 0.7, 0.1, 0.55 * big, 1.0);
        D?.burst('rubble', 1, p.x, p.y + 0.04, p.z, -d.x, 1.4, -d.z, 0.6, [0.2, 0.2, 0.2]);
        break;
      }
      case 'car': {
        const v = hit.v;
        D?.spark(5, p.x, p.y, p.z, -d.x * 3, 2, -d.z * 3, 3.5);
        fx.puff(p, _b.set(-d.x, 0.6, -d.z), [0.5, 0.5, 0.52], 0.4, 0.08, 0.35, 0.6);
        // glass up at window height, metal below
        const rel = p.y - v.y, glass = rel > (v.def.H || 1.45) * 0.6;
        if (glass) { D?.burst('glass', 5, p.x, p.y, p.z, d.x * 1.5, 0.5, d.z * 1.5, 1.2); G.audio?.shot?.('glass', p.x, p.z, 0.45, p.y); }
        else G.audio?.shot?.(Math.random() < 0.5 ? 'clang' : 'iron', p.x, p.z, 0.35, p.y);
        if (!v.dmg) v.dmg = [0, 0, 0, 0];
        const c = Math.cos(v.heading), s = Math.sin(v.heading), lx = (p.x - v.x) * c + (p.z - v.z) * s, lz = -(p.x - v.x) * s + (p.z - v.z) * c;
        const zone = Math.abs(lx) / v.def.L > Math.abs(lz) / v.def.W ? (lx > 0 ? 0 : 1) : (lz > 0 ? 3 : 2);
        v.dmg[zone] = Math.min(1, v.dmg[zone] + 0.012 * w.damage / 30);
        if (!v.player && !v.parked && v.kind === 'traffic') v.panic = 6;
        break;
      }
      case 'ped': {
        const ped = hit.ped, head = p.y > ped.y + 1.5 && !ped.dead;
        fx.puff(p, _b.copy(d).multiplyScalar(1.2), [0.32, 0.02, 0.02], 0.85, 0.06, 0.32, 0.5);
        D?.burst('drop', 3, p.x, p.y, p.z, d.x * 2, 0.6, d.z * 2, 0.8, [0.3, 0.01, 0.01]);
        G.audio?.play?.('punch', p.x, p.y, p.z, 0.22);
        G.peds.hurt?.(ped, Math.atan2(d.z, d.x), 'shot', w.damage * (head ? 2.6 : 1), { s: Math.min(1.4, w.damage / 30), head });
        break;
      }
    }
  }
  // ---------------------------------------------------------------- fists and feet
  punch(i) {
    const G = this.G, B = G.brothers, me = B.b[i], a = B.actor[i], s = this.s[i];
    if (s.move && s.move.t < s.move.dur * 0.55) { s.queuedHit = true; return; }
    s.combo = s.comboT > 0 ? (s.combo + 1) % COMBO.length : 0;
    s.comboT = 1.1; s.guard = 2.5;
    const [name, hand, reach, swing, reaction, dmg] = COMBO[s.combo];
    // the nearest person in front, within a step
    const fx = Math.cos(me.heading), fz = Math.sin(me.heading);
    let target = null, bd = 1e9;
    for (const p of G.peds.list) {
      if (p.dead) continue;
      const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz); if (d > 2.1 || d < 0.2) continue;
      const c = (dx * fx + dz * fz) / d; if (c < 0.35) continue;
      if (d < bd) { bd = d; target = p; }
    }
    if (target) { me.heading = Math.atan2(target.z - me.z, target.x - me.x); a.heading = me.heading; }
    const kick = name === 'kick';
    s.move = { name, hand, reach, swing, reaction, dmg, t: 0, dur: kick ? 0.95 : name === 'hook' ? 0.42 : 0.34, at: kick ? 0.36 : 0.1, landed: false, target, kick };
    if (kick) { a.kickT = 0.95; a.kickClip = 'front_kick_02'; }
    G.audio?.play?.('swing', me.x, me.y + 1.2, me.z, 0.18);
  }
  slash(i) {
    const G = this.G, me = this.G.brothers.b[i], s = this.s[i];
    if (s.slash && s.slash.t < 0.3) return;
    s.slash = { t: 0, landed: false, side: (s.slashSide = -(s.slashSide || 1)) };
    s.guard = 2;
    G.audio?.play?.('swing', me.x, me.y + 1.2, me.z, 0.25);
  }
  // blows land part-way through the move (called each frame from update via meleeTick)
  meleeTick(i) {
    const G = this.G, B = G.brothers, me = B.b[i], s = this.s[i];
    const m = s.move;
    if (m && !m.landed && m.t >= m.at) {
      m.landed = true;
      const p = m.target && !m.target.dead && Math.hypot(m.target.x - me.x, m.target.z - me.z) < (m.kick ? 2.0 : 1.75) ? m.target : null;
      if (p) {
        const dir = Math.atan2(p.z - me.z, p.x - me.x);
        G.peds.hurt?.(p, dir, m.reaction, m.dmg, { s: 1, side: m.hand === 'L' ? -1 : 1 });
        G.audio?.play?.(m.kick ? 'kick' : 'punch', p.x, p.y + 1.4, p.z, m.kick ? 0.7 : 0.6);
        G.slowmo = Math.max(G.slowmo || 0, m.kick ? 0.12 : 0.07);
        s.shake += m.kick ? 0.5 : 0.3;
        this.report(m.reaction === 'down' ? 'assault' : 'assault', me.x, me.z, m.reaction === 'down' ? 2 : 1);
      }
    }
    if (m && s.queuedHit && m.t > m.dur * 0.6) { s.queuedHit = false; s.move = null; this.punch(i); }
    const k = s.slash;
    if (k && !k.landed && k.t > 0.13) {
      k.landed = true;
      const fx = Math.cos(me.heading), fz = Math.sin(me.heading);
      const p = G.peds.list.find(q => !q.dead && Math.hypot(q.x - me.x, q.z - me.z) < 1.8 && ((q.x - me.x) * fx + (q.z - me.z) * fz) / (Math.hypot(q.x - me.x, q.z - me.z) || 1) > 0.4);
      if (p) {
        const dir = Math.atan2(p.z - me.z, p.x - me.x);
        G.peds.hurt?.(p, dir, 'shot', BY_KEY.knife.damage, { s: 0.8, side: k.side });
        this.fx.puff(new THREE.Vector3(p.x, p.y + 1.2, p.z), new THREE.Vector3(Math.cos(dir), 0.4, Math.sin(dir)), [0.32, 0.02, 0.02], 0.8, 0.06, 0.3, 0.5);
        G.audio?.play?.('punch', p.x, p.y + 1.2, p.z, 0.5);
        G.slowmo = Math.max(G.slowmo || 0, 0.06); s.shake += 0.25;
        this.report('a stabbing', me.x, me.z, 2);
      }
    }
  }
  // ---------------------------------------------------------------- the brothers' arms (riggedPeople calls this)
  pose(slot, a, dt) {
    const i = a.id === 'brother1' ? 1 : 0, s = this.s[i], w = this.weapon(i);
    if (!slot.arms) slot.arms = new HeroArms(slot.body);
    const arms = slot.arms; if (!arms.ok) return;
    this.meleeTick(i);
    a.armed = !!w || s.guard > 0;       // no fidgeting with a gun out (riggedPeople)
    const gunVisible = !!w && a.visible !== false;
    this.ensureGun(i, gunVisible ? w.key : null);
    if (!w && !s.move && s.guard <= 0) { s.posed = false; return; }
    slot.body.updateMatrixWorld(true);
    const g = n => slot.body.getObjectByName(n);
    const shR = g('R_Upperarm').getWorldPosition(new THREE.Vector3()), shL = g('L_Upperarm').getWorldPosition(new THREE.Vector3());
    const head = g('Head').getWorldPosition(new THREE.Vector3()), chest = g('Spine02').getWorldPosition(new THREE.Vector3());
    const r = new THREE.Vector3().subVectors(shR, shL).setY(0).normalize(), f = new THREE.Vector3().crossVectors(UP, r).normalize();
    const run = clamp(((a.speed || 0) - 2.6) / 1.6, 0, 1);
    if (!w) { this.poseFists(slot, a, s, arms, { shR, shL, head, chest, r, f, run }, dt); return; }
    if (w.melee) { this.poseKnife(slot, a, s, arms, { shR, shL, head, chest, r, f, run }); return; }
    if (!s.gun) return;
    const raise = s.aim, low = 1 - raise;
    // the gun's frame: forward (Z), up (Y) and left (X)
    const gF = new THREE.Vector3(), gU = new THREE.Vector3(), gL = new THREE.Vector3();
    const aimD = i === this.G.brothers.active ? s.aimDir : f;
    let grip = new THREE.Vector3();
    const reloading = s.reloadT > 0 ? Math.sin(clamp(1 - s.reloadT / w.reload, 0, 1) * Math.PI) : 0;
    if (w.hold === 'rifle') {
      // aimed: butt in the shoulder pocket, along the aim. Low ready: muzzle down and in. Running: across the chest
      const lowDir = _a.copy(f).multiplyScalar(0.78).addScaledVector(UP, -0.5).addScaledVector(r, -0.32).normalize();
      const runDir = _b.copy(f).multiplyScalar(0.35).addScaledVector(r, -0.72).addScaledVector(UP, 0.42).normalize();
      gF.copy(lowDir).lerp(runDir, run).lerp(aimD, raise).normalize();
      const pocket = new THREE.Vector3().copy(shR).addScaledVector(r, -0.055).addScaledVector(f, 0.04).addScaledVector(UP, -0.035);
      pocket.lerp(_c.copy(shR).addScaledVector(UP, -0.12).addScaledVector(f, 0.08).addScaledVector(r, -0.02), low * (1 - run)).lerp(_d.copy(shR).addScaledVector(UP, -0.38).addScaledVector(f, 0.14).addScaledVector(r, 0.06), run * low);
      this.frame(gF, gU, gL, reloading * 0.5);
      const origin = pocket.clone().sub(this.local(w.butt, w.scale, gF, gU, gL));
      grip.copy(origin).add(this.local(w.grip, w.scale, gF, gU, gL));
    } else {
      // pistols and SMGs: out in front, eye-high and two-handed when aimed; low and close otherwise
      const pistol = w.hold === 'pistol';
      const aimed = new THREE.Vector3().copy(head).addScaledVector(UP, pistol ? -0.17 : -0.3).addScaledVector(f, pistol ? 0.5 : 0.4).addScaledVector(r, 0.04);
      const lowered = pistol ? new THREE.Vector3().copy(shR).addScaledVector(UP, -0.5).addScaledVector(f, 0.16).addScaledVector(r, 0.05)
        : new THREE.Vector3().copy(chest).addScaledVector(f, 0.32).addScaledVector(UP, -0.12).addScaledVector(r, 0.12);
      grip.copy(lowered).lerp(aimed, raise);
      const lowDir = pistol ? _a.copy(f).multiplyScalar(0.4).addScaledVector(UP, -0.92).normalize() : _a.copy(f).multiplyScalar(0.85).addScaledVector(UP, -0.45).addScaledVector(r, -0.12).normalize();
      gF.copy(lowDir).lerp(aimD, raise).normalize();
      this.frame(gF, gU, gL, reloading * 0.6);
    }
    // recoil: back and up
    grip.addScaledVector(gF, -s.recoil * 0.07).addScaledVector(gU, s.recoil * 0.025);
    gF.addScaledVector(gU, s.recoil * 0.35).normalize(); this.frame(gF, gU, gL, reloading * 0.5);
    // right hand on the grip: knuckles forward round it, palm towards the gun's left
    const ga = this.dirLocal(w.gripAxis, gF, gU, gL);
    const Fr = _a.copy(gF).addScaledVector(ga, -gF.dot(ga)).normalize().multiplyScalar(0.94).addScaledVector(gL, 0.34).normalize().clone();
    const Nr = gL.clone();
    const poleR = new THREE.Vector3().copy(UP).multiplyScalar(-0.75).addScaledVector(r, 0.6).addScaledVector(f, -0.25);
    const oneHanded = w.hold === 'pistol' && raise < 0.35;
    arms.reach('R', arms.wristFor('R', grip, Fr, Nr), Fr, Nr, poleR, 1);
    arms.curl('R', [0.35, 0.55, 0.35], [1.25, 1.35, 0.85], [0.35, 0.45, 0.4], 1);
    // the gun goes where the hand actually got to (if the arm came up short the gun stays in the hand)
    const palm = arms.palm('R');
    const qg = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(gL, gU, gF));
    s.gun.quaternion.copy(qg); s.gunQ.copy(qg);
    s.gun.position.copy(palm.p).sub(this.local(w.grip, w.scale, gF, gU, gL));
    s.gun.updateMatrixWorld(true);
    s.muzzle.copy(s.gun.position).add(this.local(w.muzzle, w.scale, gF, gU, gL));
    s.posed = true;
    // the left hand: under the handguard or pump (slid back for a pump), round the right hand on a pistol, on the
    // magazine during a reload
    const wL = oneHanded ? 0 : 1;
    if (wL > 0) {
      let target, FL, NL;
      if (w.fore) {
        const back = w.pump && s.pump > 0 ? Math.sin(clamp(1 - s.pump / 0.55, 0, 1) * Math.PI) * 0.07 : 0;
        target = s.gun.position.clone().add(this.local(w.fore, w.scale, gF, gU, gL)).addScaledVector(gF, -back).addScaledVector(gU, -0.018 * w.scale);
        FL = _b.copy(gL).multiplyScalar(-0.82).addScaledVector(gF, 0.55).normalize().clone(); NL = gU.clone();
      } else {
        target = palm.p.clone().addScaledVector(gL, 0.045).addScaledVector(gF, 0.01).addScaledVector(gU, -0.01);
        FL = _b.copy(gF).multiplyScalar(0.3).addScaledVector(gU, -0.95).normalize().clone(); NL = gL.clone().negate();
      }
      if (reloading > 0) { const mag = s.gun.position.clone().add(this.local(w.grip, w.scale, gF, gU, gL)).addScaledVector(gU, -0.09).addScaledVector(gF, 0.06); target.lerp(mag, reloading); }
      const poleL = new THREE.Vector3().copy(UP).multiplyScalar(-0.85).addScaledVector(r, -0.45).addScaledVector(f, -0.1);
      arms.reach('L', arms.wristFor('L', target, FL, NL), FL, NL, poleL, wL);
      arms.curl('L', [1.0, 1.1, 0.7], [1.05, 1.15, 0.75], [0.3, 0.4, 0.3], wL);
    }
  }
  // gun frame from a forward direction (kept upright), canted by `cant` (a reload tips it over)
  frame(gF, gU, gL, cant = 0) {
    gL.crossVectors(UP, gF); if (gL.lengthSq() < 1e-6) gL.set(1, 0, 0); gL.normalize();
    gU.crossVectors(gF, gL).normalize();
    if (cant) { _q.setFromAxisAngle(gF, cant); gU.applyQuaternion(_q); gL.applyQuaternion(_q); }
  }
  local(v, sc, gF, gU, gL) { return new THREE.Vector3().copy(gL).multiplyScalar(v[0] * sc).addScaledVector(gU, v[1] * sc).addScaledVector(gF, v[2] * sc); }
  dirLocal(v, gF, gU, gL) { return new THREE.Vector3().copy(gL).multiplyScalar(v[0]).addScaledVector(gU, v[1]).addScaledVector(gF, v[2]).normalize(); }
  ensureGun(i, key) {
    const s = this.s[i];
    if (s.gunKey !== key) {
      if (s.gun) { this.G.scene.remove(s.gun); s.gun = null; }
      s.gunKey = key;
      if (key) { const t = this.templates.get(key); if (t) { s.gun = t.clone(true); this.G.scene.add(s.gun); } else { s.gunKey = null; this.model(key); } }
    }
    if (s.gun) s.gun.visible = !!key;
  }
  // hide guns the rig didn't pose this frame (brother out of range, in a car)
  beginFrame() { for (const s of this.s) { if (s.gun) s.gun.visible = false; s.wasPosed = s.posed; s.posed = false; } }
  poseKnife(slot, a, s, arms, B) {
    const { shR, r, f } = B;
    // slashing: the hand sweeps across in front, from high on the right to low on the left (and back)
    if (s.slash) {
      const t = clamp(s.slash.t / 0.32, 0, 1), side = s.slash.side, e = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
      const from = new THREE.Vector3().copy(shR).addScaledVector(UP, 0.15).addScaledVector(r, 0.25 * side).addScaledVector(f, 0.15);
      const to = new THREE.Vector3().copy(shR).addScaledVector(UP, -0.25).addScaledVector(r, -0.5 * side).addScaledVector(f, 0.6);
      const p = from.lerp(to, clamp(t / 0.45, 0, 1)), dir = new THREE.Vector3().subVectors(to, from).normalize();
      const F = dir.clone().addScaledVector(f, 0.6).normalize(), N = UP.clone().multiplyScalar(-1);
      arms.reach('R', arms.wristFor('R', p, F, N), F, N, new THREE.Vector3().copy(UP).multiplyScalar(-0.6).addScaledVector(r, 0.7), Math.min(1, e * 3 + 0.2));
    }
    arms.curl('R', [1.3, 1.35, 0.9], [1.35, 1.4, 0.9], [0.55, 0.7, 0.5], 1);
    if (!s.gun) return;
    const palm = arms.palm('R');
    // blade out from the thumb side, edge to the knuckles
    const Z = palm.X.clone(), Y = palm.F.clone().negate(), X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    Y.crossVectors(Z, X).normalize();
    const w = BY_KEY.knife;
    s.gun.quaternion.setFromRotationMatrix(_m.makeBasis(X, Y, Z));
    s.gun.position.copy(palm.p).sub(this.local(w.grip, w.scale, Z, Y, X));
  }
  poseFists(slot, a, s, arms, B, dt) {
    const { shR, shL, head, r, f } = B;
    const m = s.move, guard = clamp(s.guard, 0, 1);
    // fists up by the chin, then the punch: out to the target (or straight ahead) and back
    for (const side of ['L', 'R']) {
      const sh = side === 'R' ? shR : shL, sg = side === 'R' ? 1 : -1;
      const g = new THREE.Vector3().copy(head).addScaledVector(UP, -0.14).addScaledVector(f, 0.24).addScaledVector(r, sg * 0.1);
      let p = g, F = new THREE.Vector3().copy(UP).multiplyScalar(0.8).addScaledVector(f, 0.6).normalize(), N = new THREE.Vector3().copy(r).multiplyScalar(-sg).addScaledVector(f, -0.3).normalize(), wgt = m?.kick ? 0 : guard;
      if (m && !m.kick && m.hand === side) {
        const ext = m.t < m.at ? Math.sin(m.t / m.at * Math.PI / 2) : Math.max(0, 1 - (m.t - m.at - 0.04) / (m.dur - m.at - 0.04));
        const tp = m.target ? new THREE.Vector3(m.target.x, m.target.y + (m.name === 'hook' ? 1.52 : 1.55), m.target.z) : new THREE.Vector3().copy(sh).addScaledVector(f, m.reach + 0.1);
        // the hand ends on the near side of the face, swung in from the side for a hook
        const toT = new THREE.Vector3().subVectors(tp, sh); const L = Math.min(toT.length(), m.reach); toT.setLength(L);
        const strike = new THREE.Vector3().copy(sh).add(toT).addScaledVector(r, sg * m.swing * 0.25 * (1 - ext));
        p = g.clone().lerp(strike, ext);
        F = toT.clone().normalize(); N = m.name === 'hook' ? r.clone().multiplyScalar(-sg) : UP.clone().negate();
        wgt = 1;
      }
      if (wgt <= 0.01) continue;
      const pole = new THREE.Vector3().copy(UP).multiplyScalar(-0.8).addScaledVector(r, sg * 0.55);
      arms.reach(side, arms.wristFor(side, p, F, N), F, N, pole, wgt);
      arms.curl(side, [1.45, 1.55, 1.1], [1.5, 1.6, 1.15], [0.6, 0.8, 0.6], wgt);
    }
  }
}

// ray o + t*d against a capsule round segment A-B of radius r: the entry distance or null
function raySegment(o, d, A, B, r) {
  const u = _c.subVectors(B, A), w0 = _d.subVectors(o, A);
  const a = d.dot(d), b = d.dot(u), c = u.dot(u), dd = d.dot(w0), e = u.dot(w0);
  const den = a * c - b * b;
  let sc, tc;
  if (den < 1e-8) { sc = 0; tc = e / c; } else { sc = (b * e - c * dd) / den; tc = (a * e - b * dd) / den; }
  tc = clamp(tc, 0, 1); sc = Math.max(0, (b * tc - dd) / a);
  const px = o.x + d.x * sc - (A.x + u.x * tc), py = o.y + d.y * sc - (A.y + u.y * tc), pz = o.z + d.z * sc - (A.z + u.z * tc);
  const dist2 = px * px + py * py + pz * pz; if (dist2 > r * r) return null;
  return Math.max(0, sc - Math.sqrt(r * r - dist2));
}
// ray against a vehicle's box (heading, length, width, height off its wheels)
function rayBox(o, d, v) {
  const c = Math.cos(v.heading), s = Math.sin(v.heading), H = v.def.H || 1.45;
  const ox = o.x - v.x, oz = o.z - v.z;
  const lo = [ox * c + oz * s, o.y - v.y, -ox * s + oz * c], ld = [d.x * c + d.z * s, d.y, -d.x * s + d.z * c];
  const mn = [-v.def.L / 2, 0.15, -v.def.W / 2], mx = [v.def.L / 2, H, v.def.W / 2];
  let t0 = 0, t1 = 1e9;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-9) { if (lo[k] < mn[k] || lo[k] > mx[k]) return null; continue; }
    let a = (mn[k] - lo[k]) / ld[k], b = (mx[k] - lo[k]) / ld[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null;
  }
  return t0;
}
