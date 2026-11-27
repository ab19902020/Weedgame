// The ambulance service and the fire brigade, wherever you are on the map.
//
// Ambulances come to anyone left lying hurt (shot and down, knocked out, knocked down by a car, hurt in a crash) and
// to anyone killed. Blue lights; it pulls up near them; the two paramedics (green, yellow-and-green hi-vis) get out
// and go round to the back, open the doors, take out the wheeled stretcher and raise it, wheel it over and park it
// alongside, kneel and treat the patient, lift them on to it, wheel them back, load them in head first, shut the
// doors, get back in and drive off (on blue lights if they're alive).
//
// The fire brigade comes to a car on fire (smashed up badly by crashes or gunfire, or one that just goes up) and to a
// crash with someone trapped. The engine stops short of it; the crew get out and go to the lockers by the pump; one
// runs the hose out to the fire with another backing him up on the line and the third on the pump; they put it out
// with a jet of water (spray where it lands, steam off the fire, the hiss of it); then they make the hose up, get back
// in and drive off. A car that's burnt out is left a blackened shell. Someone trapped: they work at the car with the
// cutting gear while the paramedics see to the driver.
//
// police.js raises the incidents with a patient (crashes, killings); peds.js the 'casualty' events (shot and down,
// knocked out); this sends the crews and plays the scene. The crews are drawn as crowd members (humans.js), the
// stretcher, hose, water, flames and steam here.
import * as THREE from 'three/webgpu';
import { People } from './characters.js';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpA = (a, b, t) => a + wrap(b - a) * t;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
// a crew member: the crowd's own body (never a citizen's mesh) in the service's kit (humans.js draws the hi-vis for
// `uniform`: 1 fire, 2 ambulance)
const uniformLook = (top, legs) => ({ ...People.randomLook(Math.random, { work: true }), citizen: null, top, legs, bag: false, backpack: false, headphones: false, carrier: false,
  coat: false, skirt: false, tights: false, shorts: false, denim: false, hood: false, cap: false, beanie: false, scarf: false, stoop: false, outfit: 0, idle: 0, shoe: 0 });

export class Emergency {
  constructor(G) {
    this.G = G; this.calls = []; this.actors = []; this.wrecks = []; this.elapsed = 0;
    this.nextFire = 1200 + Math.random() * 1200;
    G.events?.on?.('casualty', e => this.casualty(e.p, e.label));
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
    this.mats = {
      frame: M(0x9aa1a8, { metalness: 0.6, roughness: 0.35 }), mattress: M(0x2b3d57), pillow: M(0xe9ecef), wheel: M(0x1c1c1e),
      flameA: M(0xffb02e, { emissive: 0xff8a00, emissiveIntensity: 1.6 }), flameB: M(0xf35e2e, { emissive: 0xff3b00, emissiveIntensity: 1.3 }), smoke: M(0x3f3d3b, { transparent: true, opacity: 0.72, depthWrite: false }),
      hose: M(0x7c1812, { side: THREE.DoubleSide, roughness: 0.75 }), branch: M(0x2a2a2c, { metalness: 0.7, roughness: 0.3 }),
      water: new THREE.MeshBasicMaterial({ color: 0xdcecff, transparent: true, opacity: 0.55, depthWrite: false }),
      steam: new THREE.MeshBasicMaterial({ color: 0xe4e7ea, transparent: true, opacity: 0.22, depthWrite: false }),
    };
    this.geos = { box: new THREE.BoxGeometry(1, 1, 1), wheel: new THREE.CylinderGeometry(0.065, 0.065, 0.045, 10).rotateX(Math.PI / 2), drop: new THREE.IcosahedronGeometry(1, 0), puff: new THREE.IcosahedronGeometry(1, 1), cone: new THREE.ConeGeometry(1, 1, 7) };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._d = new THREE.Vector3();
  }
  // ---------------------------------------------------------------- calls coming in
  // the incidents with someone hurt: an ambulance each (four out at once at most), the fire brigade too for someone
  // trapped (one crew at a time)
  dispatchInjuries(dt) {
    for (const inc of this.G.police.incidents) {
      if (!inc.injury || inc.status === 'new' || inc.medicalClosed) continue;
      inc.responseAge = (inc.responseAge || 0) + dt;
      if (inc.responseAge >= 300 || inc.status === 'cleared' && !inc.medicalSent) {
        if (!inc.medicalSent && inc.patient) inc.patient.awaitingMedic = false;
        inc.medicalClosed = true; continue;
      }
      if (inc.retryAfter > inc.responseAge) continue;
      inc.retryAfter = inc.responseAge + 8;
      if (!inc.medicalSent && this.calls.filter(c => c.service === 'ambulance').length < 4) inc.medicalSent = this.sendCrew('ambulance', inc.x, inc.z, inc.label || 'reported injury', inc);
      if (inc.trapped && !inc.rescueSent && !this.calls.some(c => c.service === 'fire')) inc.rescueSent = this.sendCrew('fire', inc.x, inc.z, 'trapped occupant', inc);
    }
  }
  // someone who has gone down hurt and stays down (peds.js: shot, knocked out): a 999 call, an ambulance for them
  casualty(p, label = 'Casualty') {
    if (!p || p.awaitingMedic || p.dead || p.carried || !this.G.police) return;
    p.awaitingMedic = true;
    this.G.police.createIncident('casualty', p.x, p.z, [], { injury: true, patient: p, label, medical: true });
  }
  // a crew on its way: the vehicle starts round the corner, a couple of hundred metres back along the roads
  sendCrew(service, x, z, reason, incident) {
    const G = this.G, net = G.net;
    const snap = net.nearest(x, z, 90, e => net.flags[e] & 16);
    if (!snap) return false;
    for (const last of [snap.e * 2, snap.e * 2 + 1]) {
      if (!net.outD[net.startNode(last)].includes(last)) continue;
      const route = [last], seen = new Set([snap.e]); let length = 0;
      while (length < 230) {
        const h = net.inD[net.startNode(route[0])].find(edge => !seen.has(edge >> 1));
        if (h == null) break;
        seen.add(h >> 1); route.unshift(h); length += net.len[h >> 1];
      }
      if (length < 65) continue;
      const medic = service === 'ambulance';
      const unit = G.traffic.spawnAt(route[0], 0, { kind: service, model: service, paint: medic ? 0xe9ee77 : 0xac221e, route, v: 0 });
      if (!unit) continue;
      Object.assign(unit, { siren: true, status: 'responding', target: { x, z }, persistent: true });
      this.calls.push({ unit, service, reason, incident, x, z, time: 0, stage: 'drive', t: 0, bestD: 1e9, lastH: last });
      if (medic && incident) incident.medicalBusy = true;
      G.hud.feed((medic ? 'Ambulance' : 'Fire engine') + ' responding · ' + reason);
      return true;
    }
    return false;
  }
  // ---------------------------------------------------------------- fires
  startFire() {
    if (this.calls.some(c => c.service === 'fire')) return false;
    const G = this.G;
    for (const car of G.traffic.list) {
      if (car.kind !== 'parked' || car.owner || car.free || car.player || car.burnt || Math.hypot(car.x - G.focus.x, car.z - G.focus.z) > 160) continue;
      if (this.ignite(car)) return true;
    }
    return false;
  }
  ignite(car) {
    if (!this.sendCrew('fire', car.x, car.z, 'vehicle fire', null)) return false;
    const call = this.calls[this.calls.length - 1];
    Object.assign(car, { burning: true, v: 0, crashed: !car.parked, hazard: true, smoking: true });
    call.car = car; call.heat = 1; call.fire = this.fireMesh(); this.G.scene.add(call.fire);
    this.G.hud.feed('999 call: a car on fire · ' + (this.G.roadName(car.x, car.z) || 'nearby'));
    return true;
  }
  // a car smashed up badly enough smokes for a few seconds, then goes up (not one you're in)
  checkFires(dt) {
    if ((this.fireScan = (this.fireScan || 0) - dt) > 0) return;
    this.fireScan = 1;
    if (this.calls.some(c => c.service === 'fire')) return;
    const G = this.G, f = G.focus;
    for (const v of G.traffic.list) {
      if (v.player || v.owner || v.burning || v.burnt || !v.dmg || v.def?.wheels === 2 || v.law || v.kind === 'fire' || v.kind === 'ambulance' || v.kind === 'taxi' || Math.hypot(v.x - f.x, v.z - f.z) > 220) continue;
      const d = v.dmg, total = d[0] + d[1] + d[2] + d[3];
      if (d[0] < 0.8 && d[1] < 0.9 && total < 2.2) { v.smokeT = 0; continue; }
      v.smoking = true; v.smokeT = (v.smokeT || 0) + 1;
      if (v.smokeT >= 8 && this.ignite(v)) return;
    }
  }
  fireMesh() {
    const g = new THREE.Group(), M = this.mats;
    for (let k = 0; k < 7; k++) { const f = new THREE.Mesh(this.geos.cone, k % 2 ? M.flameA : M.flameB); f.position.set(Math.sin(k * 2.1) * 0.7, 0.55, Math.cos(k * 1.7) * 0.45); f.userData.k = k; g.add(f); }
    for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(this.geos.puff, M.smoke); s.userData.smoke = k; g.add(s); }
    return g;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G; this.elapsed += dt;
    if (this.elapsed >= this.nextFire) {
      this.nextFire = this.elapsed + 1200 + Math.random() * 1200;
      if (!G.police.incidents.some(i => i.status !== 'cleared')) this.startFire();
    }
    this.checkFires(dt); this.dispatchInjuries(dt);
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]; c.time += dt; c.t += dt;
      const v = c.unit;
      // the vehicle's been taken (by you) or wrecked, the patient's gone, or it's all taken far too long: stand down
      if (v.player || v.dead || c.time > 600 || (c.patient && c.patient.gone && c.stage !== 'board' && c.stage !== 'done')) { this.end(c, true); this.calls.splice(i, 1); continue; }
      if (c.fire) this.burn(c, dt);
      if (c.stage === 'drive') this.arrive(c, dt);
      else if (c.service === 'ambulance') this.ambulance(c, dt);
      else this.firefight(c, dt);
      if (c.stage === 'done') { this.end(c, false); this.calls.splice(i, 1); }
    }
    // burnt-out shells go once they're well behind you
    if ((this._wreckT = (this._wreckT || 0) - dt) <= 0) {
      this._wreckT = 3;
      const cam = G.camera.position;
      for (let i = this.wrecks.length - 1; i >= 0; i--) {
        const w = this.wrecks[i];
        if (w.player || w.owner || !G.traffic.list.includes(w)) { this.wrecks.splice(i, 1); continue; }
        if (Math.hypot(w.x - cam.x, w.z - cam.z) > 350) { G.traffic.remove(w); this.wrecks.splice(i, 1); }
      }
    }
    this.actors.length = 0;
    for (const c of this.calls) if (c.crew) for (const p of c.crew) if (!p.gone) this.actors.push(p);
  }
  // where the nearest hose that's on is landing (audio.js: the hiss of the jet)
  hoseAt(cam) {
    let best = null, bd = 60;
    for (const c of this.calls) {
      if (!c.water?.jet.visible || !c.aim) continue;
      const d = Math.hypot(c.aim[0] - cam.x, c.aim[2] - cam.z);
      if (d < bd) { bd = d; best = c.aim; }
    }
    return best;
  }
  // pulled up (close, held up in traffic close by, or past the nearest it gets): park, hazards and blue lights, and
  // the crew get out at the cab doors
  arrive(c, dt) {
    const v = c.unit, P = c.service === 'ambulance' ? c.incident?.patient : null;
    const tx = P?.x ?? c.car?.x ?? c.x, tz = P?.z ?? c.car?.z ?? c.z, d = Math.hypot(v.x - tx, v.z - tz);
    const near = c.service === 'fire' ? 18 : 20;
    // on the scene's own road (the last of the route), as close as it gets: past it, or off the end of it
    if (v.h === c.lastH) { c.onLast = true; c.bestD = Math.min(c.bestD, d); }
    const passed = c.onLast && (v.h !== c.lastH || d > c.bestD + 3) && c.bestD < 120;
    if (!(d < near || (d < 90 && v.wait > 6) || passed)) return;
    Object.assign(v, { occupied: true, parked: true, v: 0, siren: false, lightsOnly: true, target: null, status: 'onscene' });
    const fire = c.service === 'fire', n = fire ? 3 : 2, F = this.frame(v);
    c.crew = Array.from({ length: n }, (_, k) => {
      const side = k % 2 ? 1 : -1, front = k < 2 ? 0.22 : -0.05, [x, z] = this.door(v, F, side, front);
      return { id: v.id + '-crew-' + k, x, y: v.y, z, heading: v.heading + side * Math.PI / 2,
        look: fire ? uniformLook(0x1d2333, 0x1d2333) : uniformLook(0x1f5e46, 0x1d3d30), hiVis: true, uniform: fire ? 1 : 2, hat: false,
        speed: 0, speedNow: 0, t: 0, phase: k * 1.7, visible: true, alpha: 1, pose: 'idle', side, front };
    });
    c.patient = P; c.stage = fire || P ? 'toRear' : 'check'; c.t = 0;
    this.G.audio?.play?.('Car_Door_Open', v.x, v.y + 1, v.z, 0.35);
    this.G.hud.feed(fire ? 'Fire crew on scene' : 'Paramedics on scene');
  }
  // the vehicle's frame: forward and right; a point behind it (back metres past the rear, side to the right) and
  // one `along` forward of the centre
  frame(v) {
    const h = v.heading, fx = Math.cos(h), fz = Math.sin(h), rx = -fz, rz = fx, L2 = v.def.L / 2;
    return { fx, fz, rx, rz, rear: (back, side = 0) => [v.x - fx * (L2 + back) + rx * side, v.z - fz * (L2 + back) + rz * side],
      at: (along, side) => [v.x + fx * along + rx * side, v.z + fz * along + rz * side] };
  }
  // outside a door: `along` a fraction of the length forward of centre, on `side` (+1 right)
  door(v, F, side, along) { return F.at(v.def.L * along, side * (v.def.W / 2 + 0.45)); }
  // round the vehicle rather than through it: the corner to make for next (the shortest way round its four corners),
  // or null when the way is clear
  around(v, x0, z0, x1, z1) {
    const c = Math.cos(v.heading), s = Math.sin(v.heading), L2 = v.def.L / 2 + 0.45, W2 = v.def.W / 2 + 0.45, limX = L2 - 0.3, limZ = W2 - 0.3;
    const local = (x, z) => [(x - v.x) * c + (z - v.z) * s, -(x - v.x) * s + (z - v.z) * c];
    // does a straight line cross the vehicle (shrunk a little, so walking along its side is fine)?
    const blocked = (ax, az, bx, bz) => {
      let t0 = 0, t1 = 1;
      for (const [p, d, lim] of [[ax, bx - ax, limX], [az, bz - az, limZ]]) {
        if (Math.abs(d) < 1e-9) { if (p <= -lim || p >= lim) return false; continue; }
        let lo = (-lim - p) / d, hi = (lim - p) / d; if (lo > hi) [lo, hi] = [hi, lo];
        t0 = Math.max(t0, lo); t1 = Math.min(t1, hi); if (t0 >= t1) return false;
      }
      return true;
    };
    const pts = [local(x0, z0), [L2, W2], [L2, -W2], [-L2, -W2], [-L2, W2], local(x1, z1)];
    if (!blocked(...pts[0], ...pts[5])) return null;
    // shortest way from where they are (0) to where they're going (5), corner to corner
    const dist = [0, 1e9, 1e9, 1e9, 1e9, 1e9], prev = [-1, -1, -1, -1, -1, -1], done = [];
    for (let k = 0; k < 6; k++) {
      let u = -1; for (let i = 0; i < 6; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] >= 1e9) break; done[u] = true;
      for (let w = 0; w < 6; w++) if (!done[w] && !blocked(...pts[u], ...pts[w])) { const d = dist[u] + Math.hypot(pts[w][0] - pts[u][0], pts[w][1] - pts[u][1]); if (d < dist[w]) { dist[w] = d; prev[w] = u; } }
    }
    if (prev[5] < 0) return null;
    let n = 5; while (prev[n] > 0) n = prev[n];
    if (n === 5) return null;
    const [cx, cz] = pts[n];
    return [v.x + c * cx - s * cz, v.z + s * cx + c * cz];
  }
  // walk a crew member towards (x, z); true once there. With a vehicle, round it rather than through it
  walk(p, x, z, dt, sp = 1.5, v = null) {
    const G = this.G;
    let tx = x, tz = z;
    const via = v && this.around(v, p.x, p.z, x, z);
    if (via) { tx = via[0]; tz = via[1]; }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25 && !via) { p.speedNow = 0; p.speed = 0; return true; }
    const step = Math.min(d, sp * dt);
    p.x += dx / (d || 1) * step; p.z += dz / (d || 1) * step;
    p.heading = lerpA(p.heading, Math.atan2(dz, dx), Math.min(1, dt * 10)); p.speedNow = sp; p.speed = sp; p.pose = p.carrying ? 'hold' : 'walk'; p.brace = 0; p.kneel = 0;
    p.phase = (p.phase + dt * sp * 2.85) % 6.283; p.t += dt;
    p.y = G.tiles.ground(p.x, p.z, p.y + 1) ?? p.y;
    return false;
  }
  // stand facing (x, z) (or, with kneel ±1, go down on that knee)
  face(p, x, z, pose, dt, brace = 0, kneel = 0) { p.heading = lerpA(p.heading, Math.atan2(z - p.z, x - p.x), Math.min(1, dt * 8)); p.speedNow = 0; p.speed = 0; p.pose = pose; p.brace = brace; p.kneel = lerp(p.kneel || 0, kneel, Math.min(1, dt * 5)); p.t += dt; }
  // a crew member kept at a spot that moves (with the stretcher), facing hd; walking to it if it's moved off
  place(p, x, z, hd, moving, dt, pose = 'hold') {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > 0.6) { this.walk(p, x, z, dt, 1.9); return; }
    p.x = x; p.z = z; p.y = this.G.tiles.ground(x, z, p.y + 1) ?? p.y; p.heading = lerpA(p.heading, hd, Math.min(1, dt * 8));
    p.speedNow = moving ? 1.25 : 0; p.speed = p.speedNow; p.pose = pose; p.brace = 0; p.kneel = 0;
    p.phase = (p.phase + dt * p.speedNow * 2.85) % 6.283; p.t += dt;
  }
  // back to the cab doors and in: true once everyone's in
  board(c, dt, F) {
    const v = c.unit; let all = true;
    for (const p of c.crew) {
      if (p.gone) continue;
      p.carrying = false;
      const [x, z] = this.door(v, F, p.side, p.front);
      if (this.walk(p, x, z, dt, 1.7, v)) { p.gone = true; this.G.audio?.play?.('Car_Door_Close', v.x, v.y + 1, v.z, 0.35); } else all = false;
    }
    return all;
  }
  // ---------------------------------------------------------------- the ambulance
  // the way a patient's body lies from their feet (as humans.js lays it): with the blow, or backwards for a car's
  bodyDir(P) { const R = P.react; return R ? (R.back >= 0 ? R.dir : R.dir + Math.PI) : P.heading + Math.PI; }
  ambulance(c, dt) {
    const G = this.G, v = c.unit, F = this.frame(v), [A, B] = c.crew, P = c.patient;
    const ground = (x, z) => G.tiles.ground(x, z, v.y + 1) ?? v.y;
    switch (c.stage) {
      case 'check': {
        // nobody to take: a look round the scene, then off
        const a = this.walk(A, c.x + 0.8, c.z, dt, 1.5, v), b = this.walk(B, c.x - 0.8, c.z, dt, 1.5, v);
        if (a) this.face(A, c.x, c.z, 'hold', dt, 0, 1);
        if (b) this.face(B, c.x, c.z, 'idle', dt);
        if (a && b && (c.look = (c.look || 0) + dt) > 8) { c.stage = 'board'; c.t = 0; }
        break;
      }
      case 'toRear': {
        // round to the back doors
        const [ax, az] = F.rear(0.55, -0.55), [bx, bz] = F.rear(0.55, 0.55);
        const a = this.walk(A, ax, az, dt, 1.7, v), b = this.walk(B, bx, bz, dt, 1.7, v);
        if (a && b) { c.stage = 'doors'; c.t = 0; G.audio?.play?.('Car_Trunk_Open', v.x, v.y + 1, v.z, 0.4); }
        break;
      }
      case 'doors': {
        // the doors open; the stretcher's drawn out at the deck's height, foot end first, lowered on to its wheels and
        // pumped up to working height
        const [rx, rz] = F.rear(0);
        if (c.t < 1.4) { this.face(A, rx, rz, 'hold', dt); this.face(B, rx, rz, 'hold', dt); }
        if (c.t > 0.9 && !c.bed) { c.bed = this.stretcher(); G.scene.add(c.bed); c.bedHd = v.heading + Math.PI; c.bedH = 0.6; }
        if (c.bed) {
          const out = smooth((c.t - 0.9) / 1.4), inX = v.x - F.fx * (v.def.L / 2 - 0.9), inZ = v.z - F.fz * (v.def.L / 2 - 0.9), [ox, oz] = F.rear(1.25);
          c.bedX = lerp(inX, ox, out); c.bedZ = lerp(inZ, oz, out);
          c.bedH = c.t < 2.3 ? 0.6 : lerp(0.6, 0.34, smooth((c.t - 2.3) / 0.4)) + (0.86 - 0.34) * smooth((c.t - 2.8) / 1.0);
          this.setBed(c, ground(c.bedX, c.bedZ));
          // one at the foot end drawing it out, the other at its side
          const ex = Math.cos(c.bedHd), ez = Math.sin(c.bedHd);
          if (c.t > 1.4) { this.place(A, c.bedX + ex * 1.25, c.bedZ + ez * 1.25, c.bedHd + Math.PI, c.t < 2.3, dt); this.place(B, c.bedX - ez * 0.62, c.bedZ + ex * 0.62, c.bedHd - Math.PI / 2, false, dt); }
        }
        if (c.t > 3.9) { c.stage = P && !P.gone ? 'wheel' : 'stowEmpty'; c.t = 0; }
        break;
      }
      case 'wheel': case 'back': {
        // wheeled over to park alongside the patient, or back to the doors with them on it
        const toPatient = c.stage === 'wheel';
        let gx, gz, gh;
        if (toPatient) {
          const bd = this.bodyDir(P), tx = P.x + Math.cos(bd) * 0.85, tz = P.z + Math.sin(bd) * 0.85, mx = -Math.sin(bd), mz = Math.cos(bd);
          if (c.side == null) c.side = (c.bedX - tx) * mx + (c.bedZ - tz) * mz >= 0 ? 1 : -1;
          gx = tx + mx * c.side * 0.95; gz = tz + mz * c.side * 0.95; gh = bd + Math.PI;
        } else { [gx, gz] = F.rear(1.25); gh = v.heading + Math.PI; }
        const dx = gx - c.bedX, dz = gz - c.bedZ, d = Math.hypot(dx, dz);
        let moving = false;
        if (d > 0.12) {
          // pushed along: it turns as it goes (slowly into a tight turn); the last bit squared up by hand
          const hd = Math.atan2(dz, dx), e = wrap(hd - c.bedHd), sp = Math.min(d, 1.25 * dt * (Math.abs(e) > 1.2 ? 0.25 : 1));
          if (d > 0.7) { c.bedHd += clamp(e, -dt * 1.8, dt * 1.8); c.bedX += Math.cos(c.bedHd) * sp; c.bedZ += Math.sin(c.bedHd) * sp; }
          else { c.bedX += dx / d * Math.min(d, 0.6 * dt); c.bedZ += dz / d * Math.min(d, 0.6 * dt); }
          moving = true;
        } else {
          // there: swung round to lie alongside them (or square to the doors)
          const e = wrap(gh - c.bedHd);
          if (Math.abs(e) > 0.04) { c.bedHd += clamp(e, -dt * 1.1, dt * 1.1); moving = true; }
          else { c.t = 0; c.stage = toPatient ? 'treat' : 'load'; }
        }
        const gy = ground(c.bedX, c.bedZ); this.setBed(c, gy);
        // one pushing at the head end, the other walking at the foot end guiding it
        const ex = Math.cos(c.bedHd), ez = Math.sin(c.bedHd);
        this.place(B, c.bedX - ex * 1.42, c.bedZ - ez * 1.42, c.bedHd, moving, dt, 'hold');
        this.place(A, c.bedX + ex * 0.75 + ez * 0.62, c.bedZ + ez * 0.75 - ex * 0.62, moving ? c.bedHd : c.bedHd + Math.PI / 2, moving, dt, moving ? 'walk' : 'hold');
        if (!toPatient) this.carry(c, gy);
        break;
      }
      case 'treat': {
        // kneeling either side of them, working on them
        const bd = this.bodyDir(P), tx = P.x + Math.cos(bd) * 0.85, tz = P.z + Math.sin(bd) * 0.85, mx = -Math.sin(bd), mz = Math.cos(bd), s = c.side || 1;
        if (this.walk(A, tx - mx * s * 0.62, tz - mz * s * 0.62, dt, 1.3)) this.face(A, tx, tz, 'hold', dt, 0, 1);
        if (this.walk(B, P.x + Math.cos(bd) * 2.05, P.z + Math.sin(bd) * 2.05, dt, 1.3)) this.face(B, tx, tz, 'hold', dt, 0, -1);
        this.setBed(c, ground(c.bedX, c.bedZ));
        if (c.t > (P.dead ? 7 : 11)) { c.stage = 'lift'; c.t = 0; this.pickUp(c); }
        break;
      }
      case 'lift': {
        // up and on to the stretcher
        const gy = ground(c.bedX, c.bedZ), e = smooth((c.t - 0.3) / 1.6), [fx, fz, fy] = this.bedSpot(c, gy), L0 = c.liftFrom;
        P.x = lerp(L0[0], fx, e); P.z = lerp(L0[1], fz, e); P.y = lerp(L0[2], fy, e) + Math.sin(Math.PI * e) * 0.2; P.heading = lerpA(L0[3], c.bedHd, e);
        const mx = P.x - Math.cos(P.heading) * 0.8, mz = P.z - Math.sin(P.heading) * 0.8;
        this.face(A, mx, mz, 'hold', dt); this.face(B, mx, mz, 'hold', dt);
        if (c.t > 2.1) { c.stage = 'back'; c.t = 0; if (c.incident) c.incident.medicalDone = true; G.hud.feed(P.dead ? 'Paramedics: the casualty did not survive' : 'Paramedics: patient on board, heading for hospital'); }
        break;
      }
      case 'load': {
        // in, head first: lifted to the deck and slid in (its legs folding up), the doors shut
        const k = smooth(c.t / 1.8), [rx0, rz0] = F.rear(1.25), inX = v.x - F.fx * (v.def.L / 2 - 1.1), inZ = v.z - F.fz * (v.def.L / 2 - 1.1);
        c.bedX = lerp(rx0, inX, k); c.bedZ = lerp(rz0, inZ, k); c.bedH = lerp(0.86, 0.66, smooth(c.t / 0.6));
        const gy = ground(c.bedX, c.bedZ); this.setBed(c, gy); this.carry(c, gy);
        const ex = Math.cos(c.bedHd), ez = Math.sin(c.bedHd);
        if (c.t < 1.5) { this.place(B, c.bedX + ex * 1.35, c.bedZ + ez * 1.35, c.bedHd + Math.PI, k < 1, dt); this.place(A, c.bedX - ez * 0.62, c.bedZ + ex * 0.62, c.bedHd - Math.PI / 2, k < 1, dt); }
        else { this.face(A, ...F.rear(0), 'hold', dt); this.face(B, ...F.rear(0), 'hold', dt); }
        if (c.t > 1.9 && c.bed.visible) { P.gone = true; c.bed.visible = false; G.audio?.play?.('Car_Door_Close', v.x, v.y + 1, v.z, 0.45); }
        if (c.t > 2.4) { c.stage = 'board'; c.t = 0; c.alive = !P.dead; }
        break;
      }
      case 'stowEmpty': {
        // nobody to take after all: the stretcher goes back in
        const k = smooth(c.t / 1.5), [rx0, rz0] = F.rear(1.25), inX = v.x - F.fx * (v.def.L / 2 - 1.1), inZ = v.z - F.fz * (v.def.L / 2 - 1.1);
        c.bedX = lerp(rx0, inX, k); c.bedZ = lerp(rz0, inZ, k); c.bedH = lerp(c.bedH, 0.66, Math.min(1, dt * 4)); this.setBed(c, ground(c.bedX, c.bedZ));
        if (c.t > 1.6) { c.bed.visible = false; c.stage = 'board'; c.t = 0; }
        break;
      }
      case 'board': if (this.board(c, dt, F)) c.stage = 'done'; break;
    }
  }
  // the wheeled stretcher: frame, mattress, pillow, backrest and rails on four legs with castors (local +x the foot end)
  stretcher() {
    const g = new THREE.Group(), M = this.mats, B = this.geos.box;
    const part = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(B, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
    part(M.frame, 1.95, 0.045, 0.58, 0, 0, 0); part(M.mattress, 1.85, 0.09, 0.54, 0, 0.065, 0); part(M.pillow, 0.34, 0.07, 0.44, -0.72, 0.14, 0);
    part(M.frame, 0.04, 0.3, 0.56, -0.98, 0.15, 0); part(M.frame, 0.03, 0.03, 0.6, 0.99, 0.08, 0);
    for (const sz of [-0.3, 0.3]) part(M.frame, 1.2, 0.025, 0.025, 0.1, 0.16, sz);
    g.userData.legs = [];
    for (const sx of [-0.78, 0.78]) for (const sz of [-0.24, 0.24]) {
      const leg = part(M.frame, 0.035, 1, 0.035, sx, -0.5, sz), w = new THREE.Mesh(this.geos.wheel, M.wheel); w.position.set(sx, -1, sz); g.add(w);
      g.userData.legs.push([leg, w]);
    }
    for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
    return g;
  }
  setBed(c, gy) {
    const g = c.bed, h = c.bedH; if (!g) return;
    g.position.set(c.bedX, gy + h, c.bedZ); g.rotation.set(0, -c.bedHd, 0);
    for (const [leg, w] of g.userData.legs) { const L = Math.max(0.05, h - 0.07); leg.scale.y = L; leg.position.y = -L / 2; w.position.y = -(h - 0.065); }
  }
  // where the patient lies on the stretcher: feet at the foot end, head on the pillow (humans.js lays them back from
  // their feet)
  bedSpot(c, gy) { return [c.bedX + Math.cos(c.bedHd) * 0.84, c.bedZ + Math.sin(c.bedHd) * 0.84, gy + c.bedH + 0.1]; }
  // the patient is the stretcher's now: lying on their back (the way they were lying), moved with it (peds.js leaves
  // them be, and they're nobody's witness or target)
  pickUp(c) {
    const P = c.patient, bd = this.bodyDir(P);
    c.liftFrom = [P.x, P.z, P.y, bd + Math.PI];
    Object.assign(P, { carried: true, mode: 'chase', react: null, impact: null, wound: null, fall: 0.999, brace: 0, fallT: 1e9, pose: 'idle', speedNow: 0, reactT: 0, phoneT: 0, awaitingMedic: false, medicFall: false, heading: bd + Math.PI });
  }
  carry(c, gy) { const P = c.patient; if (!P || !P.carried) return; const [x, z, y] = this.bedSpot(c, gy); P.x = x; P.z = z; P.y = y; P.heading = c.bedHd; }
  // ---------------------------------------------------------------- the fire brigade
  firefight(c, dt) {
    const G = this.G, v = c.unit, F = this.frame(v), [A, B, C] = c.crew;
    const car = c.car || (c.incident && G.traffic.byId.get(c.incident.parties?.[0]));
    const fx = car?.x ?? c.x, fz = car?.z ?? c.z, fy = car?.y ?? v.y;
    // the pump and its deliveries: by the back, on the fire's side
    if (c.pumpSide == null) c.pumpSide = ((fx - v.x) * F.rx + (fz - v.z) * F.rz) >= 0 ? 1 : -1;
    const s = c.pumpSide, back = -v.def.L / 2 + 1.1, [kx, kz] = F.at(back, s * (v.def.W / 2 + 0.12)), [ox, oz] = F.at(back, s * (v.def.W / 2 + 0.7));
    const dir = Math.atan2(oz - fz, ox - fx), nx = fx + Math.cos(dir) * 6.5, nz = fz + Math.sin(dir) * 6.5;
    const stand = k => F.at(back + k, s * (v.def.W / 2 + 0.6));
    switch (c.stage) {
      case 'toRear': {
        // to the lockers by the pump
        const a = this.walk(A, ...stand(-0.6), dt, 2, v), b = this.walk(B, ...stand(0.6), dt, 2, v), d = this.walk(C, ox, oz, dt, 2, v);
        if (a && b && d) { c.stage = 'lockers'; c.t = 0; G.audio?.play?.('Car_Hood_Open', v.x, v.y + 1, v.z, 0.4); }
        break;
      }
      case 'lockers': {
        // the lockers open, the hose and the branch (or the cutting gear) come out
        this.face(A, kx, kz, 'hold', dt); this.face(B, kx, kz, 'hold', dt); this.face(C, kx, kz, 'hold', dt);
        if (c.t > 2.2) {
          c.t = 0; A.carrying = B.carrying = true;
          if (!c.fire) c.stage = 'toCar';
          else { c.stage = 'runOut'; c.hose = this.hoseMesh(); G.scene.add(c.hose.mesh, c.hose.branch); }
        }
        break;
      }
      case 'runOut': {
        // the hose run out: the branch to the fire, the second on the line behind him, the third on the pump
        const mx = lerp(ox, nx, 0.6), mz = lerp(oz, nz, 0.6);
        const a = this.walk(A, nx, nz, dt, 2.6, v), b = this.walk(B, mx - Math.sin(dir) * 0.6, mz + Math.cos(dir) * 0.6, dt, 2.4, v);
        this.face(C, kx, kz, 'point', dt);
        this.layHose(c, kx, kz);
        if (a && b) { c.stage = 'spray'; c.t = 0; c.water = this.waterMesh(); G.scene.add(c.water.jet, c.water.steam); }
        break;
      }
      case 'spray': case 'damp': {
        // the jet on the fire until it's out, then a little longer on the hot shell
        this.face(A, fx, fz, 'hold', dt); this.face(B, fx, fz, 'hold', dt); this.face(C, kx, kz, 'point', dt);
        this.layHose(c, kx, kz);
        const on = c.stage === 'spray' || c.t < 3;
        this.spray(c, dt, fx, fy, fz, on);
        if (c.stage === 'spray') { c.heat = Math.max(0, c.heat - dt / 14); if (c.heat <= 0) { c.stage = 'damp'; c.t = 0; this.burnOut(c); } }
        else if (c.t > 6) { c.stage = 'makeUp'; c.t = 0; c.water.jet.visible = false; }
        break;
      }
      case 'makeUp': {
        // the hose made up: walked back in to the pump
        this.spray(c, dt, fx, fy, fz, false);
        const a = this.walk(A, ox, oz, dt, 1.5, v), b = this.walk(B, ...stand(0.6), dt, 1.5, v);
        this.face(C, kx, kz, 'hold', dt);
        this.layHose(c, kx, kz);
        if (a && b) { c.stage = 'stow'; c.t = 0; c.hose.mesh.visible = c.hose.branch.visible = false; A.carrying = B.carrying = false; }
        break;
      }
      case 'toCar': {
        // someone trapped: the cutting gear to the car's doors, on the engine's side of it
        const cx = car?.x ?? fx, cz = car?.z ?? fz, ch = car?.heading ?? 0, w = (car?.def?.W ?? 1.8) / 2 + 0.55;
        const sx = -Math.sin(ch), sz = Math.cos(ch), side = ((v.x - cx) * sx + (v.z - cz) * sz) >= 0 ? 1 : -1;
        const a = this.walk(A, cx + sx * side * w + Math.cos(ch) * 0.4, cz + sz * side * w + Math.sin(ch) * 0.4, dt, 2, v);
        const b = this.walk(B, cx + sx * side * w - Math.cos(ch) * 0.8, cz + sz * side * w - Math.sin(ch) * 0.8, dt, 2, v);
        this.face(C, kx, kz, 'point', dt);
        if (a && b) {
          this.face(A, cx, cz, 'hold', dt, 0, 1); this.face(B, cx, cz, 'hold', dt);
          if ((c.cut = (c.cut || 0) + dt) > 20) { c.stage = 'cutDone'; c.t = 0; G.hud.feed('Fire crew: the trapped driver is free'); }
        }
        break;
      }
      case 'cutDone': {
        const a = this.walk(A, ox, oz, dt, 1.6, v), b = this.walk(B, ...stand(0.6), dt, 1.6, v);
        this.face(C, kx, kz, 'hold', dt);
        if (a && b) { c.stage = 'stow'; c.t = 0; A.carrying = B.carrying = false; }
        break;
      }
      case 'stow': {
        this.face(A, kx, kz, 'hold', dt); this.face(B, kx, kz, 'hold', dt); this.face(C, kx, kz, 'hold', dt);
        if (c.t > 1.8) { c.stage = 'board'; c.t = 0; G.audio?.play?.('Car_Hood_Close', v.x, v.y + 1, v.z, 0.4); }
        break;
      }
      case 'board': if (this.board(c, dt, F)) c.stage = 'done'; break;
    }
  }
  // the flames on the car, their size with the heat; smoke rolling up off it (thinning as it's put out)
  burn(c, dt) {
    const g = c.fire, car = c.car; if (!g) return;
    if (car) { g.position.set(car.x, (car.y || 0) + 0.65, car.z); g.rotation.y = -(car.heading || 0); }
    const k = c.heat ?? 1, t = c.time, damp = c.stage === 'damp' || c.stage === 'makeUp';
    const smoke = Math.max(k, damp ? Math.max(0, 0.6 - (c.t || 0) / 20) : 0);
    for (const o of g.children) {
      if (o.userData.smoke != null) {
        // (rising from above the flames, so the fire itself shows; spreading as it climbs and drifts)
        const j = o.userData.smoke, u = (t * 0.25 + j / 7) % 1, sc = (0.25 + u * 1.25) * (0.35 + 0.65 * smoke);
        o.position.set(Math.sin(j * 1.9) * 0.4 + u * 1.1, 1.7 + u * 5.5, Math.cos(j * 2.3) * 0.4); o.scale.setScalar(sc); o.visible = smoke > 0.02;
      } else {
        const j = o.userData.k, f = 1 + 0.3 * Math.sin(t * 9 + j * 1.3) + 0.15 * Math.sin(t * 23 + j), r = (0.34 + j * 0.05) * (0.4 + 0.6 * k);
        o.visible = k > 0.03; o.scale.set(r, (1.0 + 0.3 * (j % 3)) * f * k * 1.4, r); o.position.y = 0.55 * k * f;
      }
    }
  }
  burnOut(c) {
    const car = c.car; if (!car || car.burnt) return;
    Object.assign(car, { burning: false, burnt: true, smoking: false, paint: 0x231f1c });
    car.dmg = [Math.max(car.dmg?.[0] || 0, 0.7), Math.max(car.dmg?.[1] || 0, 0.5), Math.max(car.dmg?.[2] || 0, 0.5), Math.max(car.dmg?.[3] || 0, 0.5)];
    this.wrecks.push(car);
    this.G.hud.feed('Fire out · ' + (this.G.roadName(car.x, car.z) || 'the vehicle fire'));
  }
  // the hose: a ribbon turned to face the camera (so it reads as a round hose from any angle), from the pump
  // coupling down to the ground, along it to the second firefighter, up through his hands and on to the branch
  hoseMesh() {
    const N = 44, pos = new Float32Array(N * 2 * 3), idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.mats.hose); mesh.frustumCulled = false;
    const branch = new THREE.Mesh(this.geos.cone, this.mats.branch); branch.scale.set(0.045, 0.42, 0.045);
    return { mesh, branch, N, curve: new THREE.CatmullRomCurve3(Array.from({ length: 6 }, () => new THREE.Vector3())) };
  }
  layHose(c, kx, kz) {
    const G = this.G, H = c.hose; if (!H) return;
    const [A, B] = c.crew;
    const ground = (x, z) => (G.tiles.ground(x, z, c.unit.y + 1) ?? c.unit.y) + 0.05;
    const hand = (p, f, up) => [p.x + Math.cos(p.heading) * f, (p.y || 0) + up, p.z + Math.sin(p.heading) * f];
    const [ax, ay, az] = hand(A, 0.5, 1.12), [bx, by, bz] = hand(B, 0.42, 1.02);
    // a lazy bend in the line on the ground either side of the second man
    const m1x = lerp(kx, bx, 0.55), m1z = lerp(kz, bz, 0.55), m2x = lerp(bx, ax, 0.5), m2z = lerp(bz, az, 0.5);
    const ctrl = [[kx, ground(kx, kz) + 0.75, kz], [kx + (bx - kx) * 0.08, ground(kx, kz), kz + (bz - kz) * 0.08], [m1x + 0.35, ground(m1x, m1z), m1z - 0.35], [bx, by, bz], [m2x, ground(m2x, m2z) + 0.25, m2z], [ax, ay, az]];
    ctrl.forEach(([x, y, z], i) => H.curve.points[i].set(x, y, z));
    H.curve.needsUpdate = true; H.curve.updateArcLengths?.();
    const pts = H.curve.getSpacedPoints(H.N - 1), cam = G.camera.position, P = H.mesh.geometry.attributes.position.array;
    const t = this._p, sd = this._s, vv = this._v;
    for (let i = 0; i < H.N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(H.N - 1, i + 1)];
      t.subVectors(b, a).normalize(); vv.subVectors(pts[i], cam); sd.crossVectors(t, vv).normalize().multiplyScalar(0.04);
      P[i * 6] = pts[i].x + sd.x; P[i * 6 + 1] = pts[i].y + sd.y; P[i * 6 + 2] = pts[i].z + sd.z;
      P[i * 6 + 3] = pts[i].x - sd.x; P[i * 6 + 4] = pts[i].y - sd.y; P[i * 6 + 5] = pts[i].z - sd.z;
    }
    H.mesh.geometry.attributes.position.needsUpdate = true;
    // the branch in his hands: pointing the way he faces, a little up
    const dirX = Math.cos(A.heading), dirZ = Math.sin(A.heading);
    H.branch.position.set(ax + dirX * 0.16, ay + 0.03, az + dirZ * 0.16);
    H.branch.quaternion.setFromUnitVectors(this._up, this._d.set(dirX, 0.18, dirZ).normalize());
    H.tip = [ax + dirX * 0.36, ay + 0.07, az + dirZ * 0.36];
  }
  // the jet: droplets along an arc from the branch to the base of the flames, spray where it lands, steam rising
  waterMesh() {
    const jet = new THREE.InstancedMesh(this.geos.drop, this.mats.water, 120), steam = new THREE.InstancedMesh(this.geos.puff, this.mats.steam, 14);
    jet.frustumCulled = steam.frustumCulled = false;
    return { jet, steam, seed: Array.from({ length: 120 }, () => [Math.random(), Math.random() - 0.5, Math.random() - 0.5, Math.random()]) };
  }
  spray(c, dt, fx, fy, fz, on) {
    const W = c.water, H = c.hose; if (!W || !H?.tip) return;
    const [bx, by, bz] = H.tip, tx = fx, ty = fy + 0.45, tz = fz, m = this._m, q = this._q, sc = this._s, p = this._p;
    const L = Math.hypot(tx - bx, tz - bz), arc = 0.3 + L * 0.07, t = c.time;
    c.aim = [tx, ty, tz];
    W.jet.visible = on;
    if (on) {
      for (let i = 0; i < 120; i++) {
        const [ph, jx, jz, r] = W.seed[i];
        if (i < 86) {
          // the stream, breaking up and spreading as it goes
          const u = (ph + t * 1.7) % 1, spread = 0.03 + u * u * 0.45;
          p.set(lerp(bx, tx, u) + jx * spread, lerp(by, ty, u) + arc * 4 * u * (1 - u) + jz * spread * 0.6, lerp(bz, tz, u) + jz * spread);
          sc.setScalar(0.03 + u * 0.07 + r * 0.025);
        } else {
          // the splash off the car: thrown up and out, falling back
          const u = (ph + t * 2.2) % 1, a = r * Math.PI * 2, rad = 0.3 + u * 1.5;
          p.set(tx + Math.cos(a) * rad, ty + 0.15 + Math.sin(Math.PI * u) * 1.0 - u * 0.3, tz + Math.sin(a) * rad);
          sc.setScalar(0.04 + (1 - u) * 0.09);
        }
        m.compose(p, q, sc); W.jet.setMatrixAt(i, m);
      }
      W.jet.instanceMatrix.needsUpdate = true;
      if ((c.splashT = (c.splashT || 0) - dt) <= 0) { c.splashT = 0.55 + Math.random() * 0.3; this.G.audio?.play?.('water', tx, ty, tz, 0.55); }
    }
    // steam off the hot car while the water's on it, dying away after
    const hot = on ? 1 : Math.max(0, 1 - (c.t || 0) / 6);
    W.steam.visible = hot > 0.02;
    for (let i = 0; i < 14; i++) {
      const u = (i / 14 + t * 0.3) % 1, a = i * 2.4;
      p.set(tx + Math.cos(a) * 0.6 + u * 0.9, ty + 0.3 + u * 3.8, tz + Math.sin(a) * 0.6);
      sc.setScalar((0.35 + u * 1.25) * hot); m.compose(p, q, sc); W.steam.setMatrixAt(i, m);
    }
    W.steam.instanceMatrix.needsUpdate = true;
  }
  // ---------------------------------------------------------------- done
  end(c, abandoned) {
    const G = this.G, v = c.unit;
    if (c.crew) for (const p of c.crew) p.gone = true;
    if (c.bed) G.scene.remove(c.bed);
    if (c.hose) { G.scene.remove(c.hose.mesh, c.hose.branch); c.hose.mesh.geometry.dispose(); }
    if (c.water) { G.scene.remove(c.water.jet, c.water.steam); c.water.jet.dispose?.(); c.water.steam.dispose?.(); }
    if (c.fire) { G.scene.remove(c.fire); if (abandoned && c.car) this.burnOut(c); }
    if (c.incident && c.service === 'ambulance') c.incident.medicalBusy = false;
    const P = c.patient;
    if (P && abandoned && !P.gone) {
      // left where they were: back on the ground
      P.awaitingMedic = false;
      if (P.carried) { P.carried = false; P.mode = 'walk'; P.fallT = 0; P.y = G.tiles.ground(P.x, P.z, P.y + 1) ?? P.y; if (P.dead) P.gone = true; else P.medicFall = true; }
    }
    if (!v.player && !v.dead) Object.assign(v, { parked: false, target: null, siren: !!c.alive && c.service === 'ambulance', lightsOnly: false, occupied: false, status: 'returning', retiredCrew: true, persistent: false });
  }
}
