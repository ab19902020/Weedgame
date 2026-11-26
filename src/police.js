// Thames Valley-style fictional police presence: foot and vehicle patrols, witnessed incidents,
// dispatch, attendance and return to patrol; proportionate stops/pursuits for the player.
// Everything emerges from the simulation — there are no scripted missions.
import * as THREE from 'three/webgpu';
import { People } from './characters.js';
import { mulberry } from './traffic.js';

const BEATS = [ // district name -> patrol centre radius (m)
  ['Reading town centre', 900], ['Cemetery Junction', 700], ['Earley', 1200], ['Woodley', 1200], ['Winnersh', 900], ['Bracknell town centre', 1100],
];

export class Police {
  constructor(G) {
    this.G = G; this.rand = mulberry(7); this.units = []; this.officers = []; this.incidents = []; this.nextInc = 1;
    this.player = { level: 0, state: 'none', t: 0, unit: null, msg: '' };
    this.calm = 0;
    G.events.on('vehicleHit', e => this.onVehicleHit(e));
    G.events.on('pedHit', e => this.onPedHit(e));
    G.events.on('tookVehicle', e => this.onOffence('took a parked car', e.v.x, e.v.z, 1));
    this.crashTimer = 120 + this.rand() * 240;
    this.breakdownTimer = 420 + this.rand() * 480;
  }
  init() {
    const G = this.G, net = G.net;
    // one patrol car per beat, placed on the nearest primary/secondary road
    BEATS.forEach(([name, r], i) => {
      const d = G.manifest.districts.find(x => x.name === name); if (!d) return;
      const n = net.nearest(d.x, d.z, 400, e => (net.flags[e] & 16) && /primary|secondary|tertiary/.test(net.classes[net.cls[e]]));
      if (!n) return;
      const h = n.e * 2 + (this.rand() < 0.5 ? 0 : (net.flags[n.e] & 1 ? 0 : 1));
      const v = G.traffic.spawnAt(h, Math.min(n.s, net.len[n.e] - 1), { kind: 'police', model: 'police', paint: 0xf2f2f2 });
      v.id = 'police-' + (i + 1); G.traffic.byId.set(v.id, v);
      v.beat = { x: d.x, z: d.z, r }; v.persistent = true; v.status = 'patrol';
      v.dest = this.beatNode(v);
      this.units.push(v);
    });
    // foot patrols: pairs of officers in town centres and Woodley precinct
    for (const name of ['Reading town centre', 'Bracknell town centre', 'Woodley', 'Cemetery Junction']) {
      const d = G.manifest.districts.find(x => x.name === name); if (!d) continue;
      const n = net.nearest(d.x, d.z, 300, e => net.walkable(e)); if (!n) continue;
      for (let k = 0; k < 2; k++) {
        const o = { id: `pc-${name}-${k}`, h: n.e * 2, s: n.s, sideSign: 1, lane: k * 0.7, look: { ...People.randomLook(this.rand), top: 0x15171c, legs: 0x15171c }, hiVis: true, hat: k === 0,
          speed: 1.15, mode: 'walk', t: 0, phase: k, heading: 0, x: n.x, y: 0, z: n.z, visible: true, alpha: 1, officer: true, beat: { x: d.x, z: d.z, r: 350 }, foot: true };
        if (k) o.leader = this.officers[this.officers.length - 1];
        this.officers.push(o); G.peds.list.push(o);
      }
    }
  }
  beatNode(v) {
    const net = this.G.net;
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rand() * 6.283, r = this.rand() * v.beat.r;
      const n = net.nearest(v.beat.x + Math.cos(a) * r, v.beat.z + Math.sin(a) * r, 150, e => net.flags[e] & 16);
      if (n) return net.eb[n.e];
    }
    return null;
  }
  // ---------------------------------------------------------------- incidents
  createIncident(type, x, z, parties, opts = {}) {
    const inc = { id: this.nextInc++, type, x, z, parties, t: 0, status: 'new', witnesses: [], reportedAt: null, unit: null, byPlayer: !!opts.byPlayer, label: opts.label || type };
    inc.injury = !!opts.injury; inc.trapped = !!opts.trapped; inc.patient = opts.patient;
    this.incidents.push(inc);
    // witnesses: nearby pedestrians react; one of them phones it in
    const w = this.G.peds.near(x, z, 55);
    for (const p of w) { p.reactT = 3 + this.rand() * 3; p.reactHeading = Math.atan2(z - p.z, x - p.x); p.reactPose = 'point'; }
    if (w.length) { const caller = w[Math.floor(this.rand() * w.length)]; caller.reactT = 0; caller.phoneT = 9; inc.witnesses = w.map(p => p.id); inc.caller = caller; inc.callAt = 6 + this.rand() * 6; }
    else inc.callAt = 20 + this.rand() * 25; // a driver phones it in
    this.G.events.emit('noise', { x, z, r: 40, kind: type });
    return inc;
  }
  onVehicleHit({ by, other, speed }) {
    if (other.crashed || other.kind === 'police' && by.player) return;     // a crash is for the insurers, not a chase
    if (speed < 3) return;
    other.crashed = true; other.v = 0; other.hazard = true;
    const inc = this.createIncident('rtc', other.x, other.z, [other.id, by.id], { byPlayer: by.player, injury: speed >= 10, trapped: speed >= 23 && other.def?.wheels !== 2, label: 'Road traffic collision' });
    if(inc.injury && other.kind==='traffic'){
      const side=other.def.W/2+.65;
      const patient={id:'injured-'+inc.id,look:People.randomLook(this.rand),x:other.x-Math.sin(other.heading)*side,
        y:other.y,z:other.z+Math.cos(other.heading)*side,heading:other.heading,h:other.h,s:other.s,sideSign:1,lane:0,
        mode:'scene',sceneX:other.x,sceneZ:other.z,sceneT:180,t:0,phase:0,speed:0,alpha:1,visible:true,awaitingMedic:true};
      this.G.peds.list.push(patient);inc.patient=patient;inc.drivers=[patient];
    }
  }
  onPedHit({ p, v, speed }) {
    if (p.awaitingMedic) return;
    p.awaitingMedic = true;
    this.createIncident('pedestrian', p.x, p.z, [v.id], { byPlayer: v.player, injury: true, patient: p, label: 'Pedestrian struck' });
    if (v.player) this.onOffence('struck a pedestrian', p.x, p.z, 2);
  }
  // staged NPC collision (also happens naturally every few minutes near the player)
  stageCollision(severity) {
    const G = this.G, f = G.focus;
    const cands = G.traffic.list.filter(v => !v.parked && !v.player && !v.crashed && v.kind === 'traffic' && v.v > 2 && Math.hypot(v.x - f.x, v.z - f.z) < 260 && Math.hypot(v.x - f.x, v.z - f.z) > 40);
    cands.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
    for (const a of cands) {
      const l = G.traffic.occ.get(a.h); if (!l) continue;
      const lead = l.find(o => o.s > a.s && o !== a && o.s - a.s < 30 && !o.crashed);
      if (!lead) continue;
      // rear-end shunt: a runs into lead
      a.s = lead.s - (lead.len + a.len) / 2 - 0.15; G.traffic.place(a);
      const impact = Math.max(0,a.v-lead.v);
      const trapped = severity === 'rescue' || (!severity && impact >= 23 && lead.def.wheels !== 2);
      const injury = trapped || severity === 'injury' || (!severity && impact >= 10);
      a.crashed = lead.crashed = true; a.v = lead.v = 0;
      const inc = this.createIncident('rtc', (a.x + lead.x) / 2, (a.z + lead.z) / 2, [a.id, lead.id], { injury, trapped, label: trapped ? 'Collision · occupant trapped' : injury ? 'Collision with injuries' : 'Shunt (rear-end collision)' });
      G.audio?.crash(inc.x, inc.z, 0.6);
      // drivers get out
      for (const v of [a, lead]) {
        const rx = -Math.sin(v.heading), rz = Math.cos(v.heading);
        const d = { id: 'drv-' + v.id, h: v.h, s: v.s, sideSign: 1, lane: 0, look: People.randomLook(this.rand), speed: 1, mode: 'scene', sceneX: inc.x, sceneZ: inc.z, sceneT: 1e9, scenePose: 'phone',
          t: 0, phase: 0, heading: 0, x: v.x - rx * (v.def.W / 2 + 0.8), y: v.y, z: v.z - rz * (v.def.W / 2 + 0.8), visible: true, alpha: 1, driverOf: v.id };
        G.peds.list.push(d); inc.drivers = (inc.drivers || []).concat(d);
      }
      if(injury){ inc.patient=inc.drivers[1]; inc.patient.awaitingMedic=true; }
      return inc;
    }
    return null;
  }
  update(dt) {
    const G = this.G;
    // natural incidents: rarely, a shunt near the player
    this.crashTimer -= dt;
    if (this.crashTimer <= 0) { this.crashTimer = 300 + this.rand() * 420; if (this.incidents.filter(i => i.status !== 'cleared').length < 2) this.stageCollision(); }
    this.breakdownTimer -= dt;
    if (this.breakdownTimer <= 0) { this.breakdownTimer = 480 + this.rand() * 600; if (this.incidents.filter(i => i.status !== 'cleared').length < 2) this.stageBreakdown(); }
    this.updateOffroad(dt);
    for (const v of this.units) {
      if (v.status === 'patrol') {
        v.siren = false;
        if (v.dest == null || (v.route && v.ri >= v.route.length - 2 && G.net.endNode(v.h) === v.dest)) v.dest = this.beatNode(v);
      }
    }
    for (const inc of this.incidents) this.updateIncident(inc, dt);
    this.incidents = this.incidents.filter(i => !(i.status === 'cleared' && i.t > 30));
    this.updatePlayer(dt);
    // foot patrols wander within their beat
    for (const o of this.officers) {
      if (o.mode === 'walk' && !o.leader && Math.hypot(o.x - o.beat.x, o.z - o.beat.z) > o.beat.r) o.goal = { kind: 'beat', x: o.beat.x, z: o.beat.z };
    }
    // yield to blue lights
    for (const v of G.traffic.list) if (v.siren) for (const o of G.traffic.list) {
      if (o.siren || o.parked || o.player) continue;
      const dx = o.x - v.x, dz = o.z - v.z; if (dx * dx + dz * dz > 50 * 50) continue;
      const ahead = dx * Math.cos(v.heading) + dz * Math.sin(v.heading);
      if (ahead > 0 && ahead < 50) { o.yieldTo = 3; o.slow = 0.4; }
    }
    for (const o of G.traffic.list) if (o.yieldTo <= 0 && o.slow) { o.slow = null; o.latT = o.passing ? o.latT : 0; }
  }
  nearestUnit(x, z) {
    let best = null, bd = 1e9;
    for (const v of this.units) { if (v.status !== 'patrol') continue; const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  dispatch(v, x, z, why, urgent=true) {
    const net = this.G.net;
    const n = net.nearest(x, z, 200, e => net.flags[e] & 16); if (!n) return false;
    // aim for the end of the scene's road segment nearest the unit, then stop short of the scene
    const a = net.ea[n.e], b = net.eb[n.e], N = net.nodes;
    const da = Math.hypot(N[a * 3] - v.x, N[a * 3 + 2] - v.z), db = Math.hypot(N[b * 3] - v.x, N[b * 3 + 2] - v.z);
    v.status = 'responding'; v.siren = urgent; v.dest = da < db ? a : b; v.sceneEdge = n.e;
    v.target = { x, z }; v.why = why;
    this.routeTo(v);
    return true;
  }
  // plan the whole response route now (long routes no longer depend on the per-frame routing budget);
  // fall back to the scene edge's other end, then to any drivable node near the scene
  routeTo(v) {
    const net = this.G.net, start = net.endNode(v.h), e = v.sceneEdge;
    const cands = [v.dest]; if (e != null) cands.push(v.dest === net.ea[e] ? net.eb[e] : net.ea[e]);
    for (let k = 0; k < 6 && v.target; k++) { const a = k * 1.05; const n = net.nearest(v.target.x + Math.cos(a) * 60, v.target.z + Math.sin(a) * 60, 150, ee => net.flags[ee] & 16); if (n) cands.push(net.eb[n.e]); }
    for (const d of cands) {
      if (d == null) continue;
      if (d === start) { v.dest = d; v.route = [v.h]; v.ri = 0; return true; }
      const r = net.route(start, d, { limit: 250000 });
      if (r && r.length) { v.dest = d; v.route = [v.h, ...r]; v.ri = 0; v.routeLen = r.reduce((a, h) => a + net.len[h >> 1], 0); this.routed = (this.routed || 0) + 1; return true; }
    }
    v.route = [v.h]; v.ri = 0; this.routeFails = (this.routeFails || 0) + 1;
    return false;
  }
  updateIncident(inc, dt) {
    const G = this.G; inc.t += dt;
    if (inc.status === 'new' && inc.t > inc.callAt) {
      inc.status = 'reported';
      const u = this.nearestUnit(inc.x, inc.z);
      if (u && this.dispatch(u, inc.x, inc.z, inc.label, inc.injury || inc.type==='theft')) { inc.unit = u; inc.status = 'responding'; u.incident = inc; G.hud.feed(`999 call: ${inc.label} · ${G.roadName(inc.x, inc.z)} · ${u.id} responding`); }
      else G.hud.feed(`999 call: ${inc.label} · no unit free yet`);
    }
    if (inc.status === 'reported' && inc.t % 10 < dt) { const u = this.nearestUnit(inc.x, inc.z); if (u && this.dispatch(u, inc.x, inc.z, inc.label, inc.injury || inc.type==='theft')) { inc.unit = u; inc.status = 'responding'; u.incident = inc; } }
    if (inc.status === 'responding') {
      const u = inc.unit, d = Math.hypot(u.x - inc.x, u.z - inc.z);
      // overshot or reached the routing node without seeing the scene: route to the other end
      if ((u._rr = (u._rr || 0) - dt) <= 0 && d > 60 && ((u.dest != null && G.net.endNode(u.h) === u.dest) || u.ri >= u.route.length - 1)) {
        u._rr = 8; const e = u.sceneEdge; if (e != null && u.dest != null && G.net.endNode(u.h) === u.dest) u.dest = u.dest === G.net.ea[e] ? G.net.eb[e] : G.net.ea[e]; this.routeTo(u);
      }
      // blocked short of the scene (jam behind the collision, narrow street): park up and attend on foot
      if (d < 35 || (d < 60 && u.wait > 4) || (d < 350 && u.wait > 25)) {
        // arrive: pull over, officers attend
        u.status = 'onscene'; u.parked = true; u.v = 0; u.siren = false; u.lightsOnly = true; inc.status = 'onscene'; inc.arrived = inc.t;
        const rx = -Math.sin(u.heading), rz = Math.cos(u.heading);
        inc.officers = [0, 1].map(k => {
          const o = { id: `pc-${u.id}-${k}`, h: u.h, s: u.s, sideSign: 1, lane: 0, look: { ...People.randomLook(this.rand), top: 0x15171c, legs: 0x15171c }, hiVis: true, hat: k === 0, speed: 1.2,
            mode: 'scene', sceneX: inc.x, sceneZ: inc.z, sceneT: 1e9, scenePose: k ? 'talk' : 'idle', t: 0, phase: 0, heading: 0, x: u.x + rx * (k ? 1.6 : -1.6), y: u.y, z: u.z + rz * (k ? 1.6 : -1.6), visible: true, alpha: 1, officer: true };
          G.peds.list.push(o); return o;
        });
        G.hud.feed(`${u.id} on scene · ${inc.label}`);
      }
      // long responses get time to arrive (route length at blue-light speed plus margin), then stand down cleanly
      const limit = inc.respondLimit || (inc.respondLimit = 300 + (u.routeLen || 0) / 6);
      if (inc.status === 'responding' && inc.t > limit) { inc.status = 'cleared'; inc.t = 0; u.status = 'patrol'; u.siren = false; u.incident = null; u.target = null; u.dest = this.beatNode(u); G.hud.feed(`${u.id}: stood down (${inc.label}) · another unit dealt with it`); for (const id of inc.parties) { const v = G.traffic.byId.get(id); if (v && !v.player) { v.crashed = false; v.hazard = false; v.brokenDown = false; } } for (const dd of inc.drivers || []) dd.gone = true; }
    }
    if (inc.status === 'onscene') {
      // officers walk to the scene, talk with drivers, then clear
      for (const o of inc.officers) {
        const dx = inc.x - o.x, dz = inc.z - o.z, d = Math.hypot(dx, dz);
        if (d > 3) { const sp = d > 40 ? 2.6 : 1.2; o.x += dx / d * sp * dt; o.z += dz / d * sp * dt; o.speedNow = sp; o.phase = (o.phase + dt * 4.3 * sp / 1.2) % 6.283; o.scenePose = 'walk'; }
        else { o.speedNow = 0; o.scenePose = 'talk'; }
        G.peds.ground(o);
      }
      if (inc.type === 'breakdown') { this.updateBreakdown(inc, dt); return; }
      if (inc.officers.every(o => Math.hypot(inc.x - o.x, inc.z - o.z) < 6) ? (inc.atScene = (inc.atScene || 0) + dt) > 60 : inc.t - inc.arrived > 420) {
        inc.status = 'cleared'; inc.t = 0;
        const u = inc.unit;
        for (const o of inc.officers) o.gone = true;
        for (const d of inc.drivers || []) d.gone = true;
        u.parked = false; u.status = 'patrol'; u.incident = null; u.lightsOnly = false; u.dest = this.beatNode(u);
        for (const id of inc.parties) { const v = G.traffic.byId.get(id); if (v && !v.player) { v.crashed = false; v.hazard = false; v.v = 0; } }
        G.hud.feed(`${u.id}: scene cleared, resuming patrol`);
      }
    }
  }
  // ---------------------------------------------------------------- breakdowns
  // A car breaks down and blocks a lane: hazards on, the driver waits on the pavement and phones it in.
  // A patrol attends to protect the scene; a recovery truck comes, loads the car and drives off.
  stageBreakdown() {
    const G = this.G, f = G.focus, net = G.net;
    const cands = G.traffic.list.filter(v => !v.parked && !v.player && !v.crashed && !v.brokenDown && v.kind === 'traffic' && v.v > 2 && Math.hypot(v.x - f.x, v.z - f.z) < 300 && Math.hypot(v.x - f.x, v.z - f.z) > 50
      && net.len[v.h >> 1] - v.s > 25 && !net.stopAt.has(v.h));
    if (!cands.length) return null;
    cands.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
    const v = cands[0];
    v.brokenDown = true; v.v = 0; v.hazard = true;
    const inc = this.createIncident('breakdown', v.x, v.z, [v.id], { label: 'Broken-down car blocking a lane' });
    inc.callAt = 8 + this.rand() * 6;   // the driver phones it in
    const rx = -Math.sin(v.heading), rz = Math.cos(v.heading);
    const d = { id: 'drv-' + v.id, h: v.h, s: v.s, sideSign: 1, lane: 0, look: People.randomLook(this.rand), speed: 1, mode: 'scene', sceneX: v.x, sceneZ: v.z, sceneT: 1e9, scenePose: 'phone',
      t: 0, phase: 0, heading: 0, x: v.x + rx * (v.def.W / 2 + 2.2), y: v.y, z: v.z + rz * (v.def.W / 2 + 2.2), visible: true, alpha: 1, driverOf: v.id };
    G.peds.list.push(d); inc.drivers = [d];
    return inc;
  }
  spawnRecovery(inc) {
    const G = this.G, net = G.net, car = G.traffic.byId.get(inc.parties[0]); if (!car) return null;
    // upstream of the broken-down car, out of sight, on the roads leading to it
    const back = []; let h = car.h, L = 0;
    for (let k = 0; k < 12 && L < 380; k++) { const ins = net.inD[net.startNode(h)].filter(x => (x >> 1) !== (h >> 1)); if (!ins.length) break; h = ins[Math.floor(this.rand() * ins.length)]; back.unshift(h); L += net.len[h >> 1]; }
    const tr = G.traffic.spawnAt(back.length ? back[0] : car.h, back.length ? 1 : Math.max(0, car.s - 60), { kind: 'recovery', model: 'van', paint: 0xe0a800, route: [...back, car.h], ri: 0, v: 8 });
    tr.id = 'recovery-' + inc.id; G.traffic.byId.set(tr.id, tr); tr.fixedRoute = true; tr.persistent = true; tr.status = 'responding'; tr.hazard = true; tr.towFor = car;
    return tr;
  }
  updateBreakdown(inc, dt) {
    const G = this.G, u = inc.unit, car = G.traffic.byId.get(inc.parties[0]);
    for (const o of inc.officers || []) { const dx = inc.x - o.x, dz = inc.z - o.z, d = Math.hypot(dx, dz); if (d > 6) { o.x += dx / d * 1.2 * dt; o.z += dz / d * 1.2 * dt; o.speedNow = 1.2; o.scenePose = 'walk'; } else { o.speedNow = 0; o.scenePose = 'idle'; } G.peds.ground(o); }
    if (!inc.truck && inc.t - inc.arrived > 5) { inc.truck = this.spawnRecovery(inc); if (inc.truck) G.hud.feed(`Recovery truck on its way · ${inc.label}`); }
    const tr = inc.truck;
    if (tr && !tr.dead && car && tr.h === car.h && !inc.loaded) { if (tr.lane !== car.lane) { const b0 = G.traffic.laneOffset(tr.h, tr.lane); tr.lane = car.lane; tr.lat += b0 - G.traffic.laneOffset(tr.h, tr.lane); } tr.stuck = 0; }
    // the truck pulls up behind the car (it is the car-following leader); loading takes ~20 s
    if (tr && !tr.dead && !inc.loaded && car && ((tr.h === car.h && car.s - tr.s < 45) || Math.hypot(tr.x - car.x, tr.z - car.z) < 30) && tr.v < 1) { inc.loadT = (inc.loadT || 0) + dt; if (inc.loadT > 20) { inc.loaded = true; G.hud.feed('Broken-down car loaded onto the recovery truck'); } }
    const done = inc.loaded || inc.t - inc.arrived > 300 || !car;
    if (done) {
      if (car) { car.brokenDown = false; car.hazard = false; if (inc.loaded) G.traffic.remove(car); }
      if (tr && !tr.dead) { tr.fixedRoute = false; tr.status = 'leaving'; tr.hazard = false; tr.kind = 'traffic'; tr.towFor = null; }
      for (const o of inc.officers || []) o.gone = true; for (const d of inc.drivers || []) d.gone = true;
      inc.status = 'cleared'; inc.t = 0; inc.resolvedHow = inc.loaded ? 'towed' : 'cleared';
      u.parked = false; u.status = 'patrol'; u.incident = null; u.lightsOnly = false; u.target = null; u.dest = this.beatNode(u);
      G.hud.feed(`${u.id}: lane reopened, resuming patrol`);
    }
  }
  // ---------------------------------------------------------------- off-road pursuit
  // When the player leaves the road graph, the pursuing car leaves it too (slowly, avoiding buildings)
  // and rejoins the nearest road when the chase ends or the player is back on the roads.
  updateOffroad(dt) {
    const G = this.G, net = G.net;
    for (const u of this.units) {
      if (!u.offroad || u.parked) continue;
      const P = this.player, me = G.brothers.me, chasing = P.unit === u && P.state === 'pursuit';
      const onRoad = !!net.nearest(me.x, me.z, 12, e => net.flags[e] & 16);
      const n = net.nearest(u.x, u.z, 20, e => (net.flags[e] & 16) && !/footway|path/.test(net.classes[net.cls[e]]));
      if ((!chasing || onRoad) && n) { this.rejoin(u, n); continue; }
      const far = !chasing && !n ? net.nearest(u.x, u.z, 400, e => net.flags[e] & 16) : null;
      const tx = chasing ? me.x : far ? far.x : u.x, tz = chasing ? me.z : far ? far.z : u.z;
      const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
      const want = d < 9 ? 0 : Math.min(11, d * 0.5);
      u.v += Math.max(-6 * dt, Math.min(3 * dt, want - u.v));
      const hd = Math.atan2(dz, dx); let e = hd - u.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      u.heading += Math.max(-1.2 * dt, Math.min(1.2 * dt, e));
      const nx = u.x + Math.cos(u.heading) * u.v * dt, nz = u.z + Math.sin(u.heading) * u.v * dt;
      const [cx, cz] = G.brothers.collideCircle(nx, nz, u.def.W / 2, u.y);
      if (cx !== nx || cz !== nz) u.v *= 0.5;
      u.x = cx; u.z = cz;
      const gy = G.tiles.ground(u.x, u.z, u.y + 0.5); if (gy != null) u.y += (gy - u.y) * Math.min(1, dt * 10);
      u.spin = ((u.spin || 0) + u.v * dt / u.def.wr) % (Math.PI * 2);
      // stuck away from any road for 40 s: back to the nearest road (never left stranded)
      if (!chasing && (u._offT = (u._offT || 0) + dt) > 40 && far) this.rejoin(u, far);
    }
  }
  rejoin(u, n) {
    const net = this.G.net;
    let h = n.e * 2; if (!(net.flags[n.e] & 1) && Math.cos(Math.atan2(n.dz, n.dx) - u.heading) < 0) h++;
    u.h = h; u.s = (h & 1) ? net.len[n.e] - n.s : n.s; u.lane = 0; u.lat = 0; u.latT = 0; u.route = [h]; u.ri = 0; u.offroad = false; u._offT = 0;
    this.G.traffic.place(u);
  }
  // ---------------------------------------------------------------- foot chase
  startFootChase(o) {
    const P = this.player; P.state = 'footchase'; P.t = 0; P.unit = o; P.lost = 0; P.caught = 0;
    o.mode = 'chase';
    this.G.hud.banner('Officer: “Stop! Police!” · foot chase · stop running to give yourself up', 'pursuit');
  }
  moveChaser(o, dt) {
    const G = this.G, me = G.brothers.me, dx = me.x - o.x, dz = me.z - o.z, d = Math.hypot(dx, dz);
    const sp = d < 1.6 ? 0 : 4.7;   // a little slower than a running brother (5.4 m/s)
    if (d > 0.01) { let nx = o.x + dx / d * sp * dt, nz = o.z + dz / d * sp * dt; [nx, nz] = G.brothers.collideCircle(nx, nz, 0.32, o.y); o.x = nx; o.z = nz; }
    o.heading = Math.atan2(dz, dx); o.speedNow = sp; o.pose = 'walk'; o.running = sp > 3; o.phase = (o.phase + sp * dt * 2.6) % 6.283;
    G.peds.ground(o);
    return d;
  }
  leavePatrolCar(car){
    Object.assign(car,{v:0,parked:true,occupied:true,siren:false,lightsOnly:true});
    const officer={id:'pc-'+car.id+'-chase',h:car.h,s:car.s,sideSign:1,lane:0,
      look:{...People.randomLook(this.rand),top:0x181e25,legs:0x171e27},hiVis:true,hat:true,
      speed:1.2,t:0,phase:0,heading:car.heading,x:car.x-Math.sin(car.heading)*1.7,
      y:car.y,z:car.z+Math.cos(car.heading)*1.7,visible:true,alpha:1,officer:true,fromCar:car};
    this.G.peds.list.push(officer);this.chaseCar=car;this.startFootChase(officer);
  }
  roadStop(dt,car){
    const G=this.G,P=this.player;
    if(!car || P.state!=='pursuit')return;
    if(!this.stopSite && P.t>(P.nextStop??22)){
      P.nextStop=P.t+40;
      const n=G.net.nearest(car.x,car.z,18,e=>G.net.flags[e]&16);
      if(!n || this.rand()>.55)return;
      const dir=n.dx*Math.cos(car.heading)+n.dz*Math.sin(car.heading);
      const h=n.e*2+Number(dir<0),choices=G.net.outD[G.net.endNode(h)].filter(edge=>(edge>>1)!==n.e);
      if(!choices.length)return;
      const edge=choices[Math.floor(this.rand()*choices.length)],pos=[0,0,0,0,0];
      G.net.at(edge,Math.min(40,G.net.len[edge>>1]*.55),pos);
      const [x,y,z,dx,dz]=pos,unit=this.nearestUnit(x,z);
      if(!unit || Math.hypot(x-car.x,z-car.z)<45 || Math.hypot(unit.x-x,unit.z-z)>350)return;
      if(this.dispatch(unit,x,z,'Pursuit support'))this.stopSite={unit,x,y,z,angle:Math.atan2(dz,dx),t:0};
    }
    const site=this.stopSite;if(!site)return;
    site.t+=dt;
    if(site.t>55){this.clearRoadStop();return;}
    if(!site.strip && Math.hypot(site.unit.x-site.x,site.unit.z-site.z)<30){
      Object.assign(site.unit,{v:0,parked:true,siren:false,lightsOnly:true});
      const strip=new THREE.Mesh(new THREE.BoxGeometry(.29,.09,3.2),new THREE.MeshStandardMaterial({color:0xcaa94b}));
      strip.position.set(site.x,site.y+.065,site.z);strip.rotation.y=-site.angle;G.scene.add(strip);site.strip=strip;
      site.oldX=car.x;site.oldZ=car.z;
    }
    if(site.strip){
      const c=Math.cos(site.angle),s=Math.sin(site.angle);
      const along=(x,z)=>(x-site.x)*c+(z-site.z)*s, across=(x,z)=>-(x-site.x)*s+(z-site.z)*c;
      const a=along(site.oldX,site.oldZ),b=along(car.x,car.z);
      if(a*b<=0 && a!==b){
        const f=a/(a-b),z=across(site.oldX+(car.x-site.oldX)*f,site.oldZ+(car.z-site.oldZ)*f);
        if(Math.abs(z)<1.6+car.def.W*.45 && Math.abs(car.y-site.y)<2){
          car.spikeStop=14;G.hud.banner('Tyres damaged · pull over or leave the vehicle','pursuit');this.clearRoadStop();return;
        }
      }
      site.oldX=car.x;site.oldZ=car.z;
    }
  }
  clearRoadStop(){
    const site=this.stopSite;if(!site)return;
    if(site.strip){site.strip.removeFromParent();site.strip.geometry.dispose();site.strip.material.dispose();}
    Object.assign(site.unit,{status:'patrol',parked:false,siren:false,lightsOnly:false,target:null,dest:this.beatNode(site.unit)});
    this.stopSite=null;
  }
  endFootChase() { const o = this.player.unit; if (o && o.mode === 'chase') { o.mode = 'walk'; o.goal = o.beat ? { kind: 'beat', x: o.beat.x, z: o.beat.z } : null; o.running = false; } }
  // ---------------------------------------------------------------- player
  witnessed(x, z, r = 70) {
    const G = this.G;
    for (const v of this.units) if (v.status !== 'onscene' && Math.hypot(v.x - x, v.z - z) < r) return v;
    for (const o of this.officers) if (Math.hypot(o.x - x, o.z - z) < r * 0.85) return o;
    return null;
  }
  // a crime nobody in uniform saw, reported in (a shop's alarm, a 999 call about gunfire): the nearest free cars
  // are sent on blue lights; a pursuit once they're on you
  callIn(what, x, z, level = 2, n = 2) {
    const G = this.G, P = this.player;
    let cars = this.units.filter(v => v.def && v.status !== 'onscene' && !(P.backup || []).includes(v) && v !== P.unit)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, n);
    // the patrols are all miles away: a response car or two from the nearest station, out of sight round the corner
    const close = cars.filter(c => Math.hypot(c.x - x, c.z - z) < 700).length;
    for (let k = close; k < Math.min(2, n); k++) { const c = this.respond(x, z, k); if (c) cars = [c, ...cars]; }
    cars = cars.slice(0, n);
    if (!cars.length && !P.unit) { G.hud.feed(`Reported to the police (${what}) · no units free`); return; }
    for (const c of cars) { c.status = 'pursuit'; c.siren = true; }
    if (P.state === 'pursuit') { P.backup = [...(P.backup || []), ...cars]; P.level = Math.max(P.level, level); return; }
    P.level = Math.max(P.level, level); P.what = what; P.unit = cars[0]; P.backup = cars.slice(1); P.t = 0; P.lost = 0; P.spotted = false;
    P.state = level >= 2 ? 'pursuit' : 'stop';
    G.hud.banner(level >= 2 ? `999 call: ${what} · police on the way — get away` : `Reported: ${what} · an officer is coming to have a word`, 'pursuit');
  }
  // a police car on a road 250-450 m from (x, z), heading in to it
  respond(x, z, k = 0) {
    const G = this.G, net = G.net;
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rand() * Math.PI * 2, r = 260 + this.rand() * 220;
      const n = net.nearest(x + Math.cos(a) * r, z + Math.sin(a) * r, 150, e => (net.flags[e] & 16) && !/motorway|service|track/.test(net.classes[net.cls[e]]));
      if (!n) continue;
      const h = n.e * 2 + (net.flags[n.e] & 1 ? 0 : (this.rand() < 0.5 ? 0 : 1));
      const v = G.traffic.spawnAt(h, Math.min(n.s, net.len[n.e] - 1), { kind: 'police', model: 'police', paint: 0xf2f2f2 });
      if (!v) continue;
      v.id = 'police-r' + (this._resp = (this._resp || 0) + 1); G.traffic.byId.set(v.id, v);
      v.beat = { x, z, r: 600 }; v.persistent = true; v.status = 'patrol'; v.dest = this.beatNode(v);
      this.units.push(v);
      return v;
    }
    return null;
  }
  onOffence(what, x, z, level, inc) {
    const w = this.witnessed(x, z);
    if (!w) { this.G.hud.feed(`Nobody from the police saw that (${what}).`); return; }
    const P = this.player;
    if (['pursuit','footchase','detained'].includes(P.state)) return;
    P.level = Math.max(P.level, level); P.what = what; P.unit = w; P.t = 0;
    P.state = level >= 2 ? 'pursuit' : 'stop';
    P.msg = P.state === 'stop' ? 'Police: pull over / stand still — an officer wants a word' : 'Police pursuit — get out of sight, or stop to give yourself up';
    if (w.status !== undefined) { w.status = 'pursuit'; w.siren = true; }
    this.G.hud.banner(P.msg, P.state);
  }
  updatePlayer(dt) {
    const G = this.G, P = this.player; if (P.state === 'none') return;
    P.t += dt;
    const me = G.brothers.me, speed = G.brothers.speedNow || 0;
    const u = P.unit;
    this.roadStop(dt,G.brothers.vehicleOf(me));
    if(u?.foot && P.state==='pursuit' && !me.vehicle){this.startFootChase(u);return;}
    // police cars chase / follow (the first one, and any backup sent after a 999 call)
    for (const u of [P.unit, ...(P.backup || [])]) if (u && u.def && (P.state === 'pursuit' || P.state === 'stop')) {
      u.siren = true;
      if (!u.offroad && (u._rt = (u._rt || 0) - dt) <= 0) {
        u._rt = 2; const n = G.net.nearest(me.x, me.z, 120, e => G.net.flags[e] & 16);
        if (n) { u.dest = G.net.ea[n.e]; u.route = [u.h]; u.ri = 0; }
        // the player has left the road graph: when close, follow off-road instead of circling the block
        const onRoad = G.net.nearest(me.x, me.z, 12, e => G.net.flags[e] & 16);
        if (P.state === 'pursuit' && !onRoad && Math.hypot(u.x - me.x, u.z - me.z) < 160) { u.offroad = true; u.v = Math.min(u.v, 8); }
      }
    }
    const dist = u ? Math.hypot(u.x - me.x, u.z - me.z) : 999;
    if (P.state === 'stop' && u && u.foot && !me.vehicle) {
      // walking or running away from an officer who wants a word becomes a foot chase
      P.away = speed > 3 && dist > 4 ? (P.away || 0) + dt : 0;
      if (P.away > 1.5) { this.startFootChase(u); return; }
    }
    if (P.state === 'footchase') {
      if(me.vehicle && speed>4 && u.fromCar){
        const car=u.fromCar;u.gone=true;car.parked=false;car.occupied=false;car.lightsOnly=false;
        P.unit=car;P.state='pursuit';P.t=0;P.lost=0;return;
      }
      const d = this.moveChaser(u, dt);
      if(P.level>=2 && !me.vehicle && speed>2 && d<5 && P.t>(P.tryAt??4)){
        P.tryAt=P.t+9;
        if(this.rand()<.45){u.pose='point';P.stun=2.8;G.hud.banner('Stunned · officer approaching','pursuit');}
      }
      P.stun=Math.max(0,(P.stun||0)-dt);
      P.lost = d > 45 ? P.lost + dt : 0;
      if (d < 2 && speed < 1.5) { P.caught += dt; if (P.caught > 2) { P.state = P.level>=2?'detained':'talking'; P.t = 0; u.pose='talk'; u.running=false; u.speedNow=0; G.hud.banner(P.level>=2?'Under arrest · remain with the officer':'Officer giving words of advice', 'talk'); } }
      else P.caught = 0;
      if (P.lost > 12) { this.endFootChase(); this.resolve('The officer lost you in the crowd.'); }
      else if (P.t > 120) { this.endFootChase(); this.resolve('The officer gave up the chase.'); }
      return;
    }
    if (P.state === 'stop') {
      if(u?.def && speed<.8 && dist<32){
        u.v=Math.max(0,u.v-7*dt);if(u.v<3){this.leavePatrolCar(u);return;}
      }
      if (!u?.def && speed < 0.8) { P.still = (P.still || 0) + dt; if (P.still > 3 && dist < 60) { P.state = 'talking'; P.t = 0; G.hud.banner('Officer: “Mind how you go. Words of advice given — no further action.”', 'talk'); } }
      else P.still = 0;
      if (P.t > 25 && speed > 3) { P.state = 'pursuit'; P.t = 0; G.hud.banner('You didn’t stop — police pursuit', 'pursuit'); }
      if (dist > 400) this.resolve('The officer lost interest.');
    } else if (P.state === 'talking') {
      if (P.t > 6) this.resolve('Free to go.');
    } else if (P.state === 'pursuit') {
      const seen = [P.unit, ...(P.backup || [])].some(c => c && Math.hypot(c.x - me.x, c.z - me.z) < 180);
      if (seen) P.spotted = true;
      // they can't lose you before they've found you; but if they never do, the search is called off
      P.lost = seen || !P.spotted ? 0 : (P.lost || 0) + dt;
      if (!P.spotted && P.t > 150) { this.resolve('The police searched the area but didn’t find you.'); return; }
      if (u?.def && dist<35 && (!me.vehicle || speed<1.5)){
        u.v=Math.max(0,u.v-7*dt);
        if(u.v<3){this.clearRoadStop();this.leavePatrolCar(u);return;}
      }
      if (P.lost > 25) this.resolve('Police lost sight of you.');
      else if (P.t > 240) this.resolve('The pursuit was called off.');
    } else if (P.state === 'detained') {
      if (P.t > 5) { this.endFootChase(); this.resolve('Released with a caution.'); }
    }
  }
  resolve(msg) {
    const P = this.player, u = P.unit;
    if (u && u.def) { u.siren = false; u.status = 'patrol'; u.dest = this.beatNode(u); }
    if (u && u.fromCar) { u.gone = true; }   // an officer who left the car to chase goes back to it
    const car = this.chaseCar || (u && u.def ? u : null);
    for (const c of [car, ...(P.backup || [])]) if (c) { c.siren = false; c.status = 'patrol'; c.dest = this.beatNode(c); if (c.offroad) { c.offroad = false; const n = this.G.net.nearest(c.x, c.z, 400, e => this.G.net.flags[e] & 16); if (n) this.rejoin(c, n, true); } }
    if(car){car.parked=false;car.occupied=false;car.lightsOnly=false;car.target=null;}
    P.backup = []; P.spotted = false;
    this.clearRoadStop();this.chaseCar=null;P.nextStop=null;P.surrendered=false;P.stun=0;P.tryAt=null;P.away=0;
    P.state = 'none'; P.level = 0; P.unit = null; P.still = 0; P.caught = 0; P.lost = 0;
    this.G.hud.banner(msg, 'clear', 4);
  }
}
