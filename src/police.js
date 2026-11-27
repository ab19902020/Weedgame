// Thames Valley-style fictional police presence: foot and vehicle patrols, witnessed incidents (crashes,
// breakdowns, people hurt), dispatch, attendance and return to patrol. Everything emerges from the simulation —
// there are no scripted missions. Coming after you (only for a killing) is wanted.js, which uses these cars.
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
    G.events.on('pedKilled', e => this.onKilled(e));
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
    if (by.driven || other.driven || other.player) return;                 // contact in a pursuit (wanted.js) isn't a collision to attend
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
    this.createIncident('pedestrian', p.x, p.z, [v.id], { byPlayer: v.player, injury: true, patient: p, label: p.dead ? 'Fatal collision with a pedestrian' : 'Pedestrian struck' });
  }
  // someone killed (by gun or knife: a car's are onPedHit's): a scene the police attend, and an ambulance for them
  // (neighbourhood.js sends it; the paramedics take the body away when they leave)
  onKilled({ p, how }) {
    if (how === 'car' || p.awaitingMedic) return;
    p.awaitingMedic = true;
    this.createIncident('fatal', p.x, p.z, [], { injury: true, patient: p, label: p.officer ? 'Officer down' : how === 'stabbed' ? 'Stabbing · one dead' : 'Shooting · one dead' });
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
    for (const v of this.units) {
      if (v.status === 'patrol') {
        v.siren = false;
        if (v.dest == null || (v.route && v.ri >= v.route.length - 2 && G.net.endNode(v.h) === v.dest)) v.dest = this.beatNode(v);
      }
    }
    for (const inc of this.incidents) this.updateIncident(inc, dt);
    this.incidents = this.incidents.filter(i => !(i.status === 'cleared' && i.t > 30));
    // cones behind the vehicles at a scene the officers are attending, taken in when it's cleared (cones.js)
    const C = G.cones;
    if (C) {
      for (const inc of this.incidents) {
        if (inc.status !== 'onscene' || !inc.parties?.length || C.sets.has('inc' + inc.id)) continue;
        const v = G.traffic.byId.get(inc.parties[0]); if (v) C.taper('inc' + inc.id, v);
      }
      for (const key of C.sets.keys()) if (key.startsWith('inc') && !this.incidents.some(i => 'inc' + i.id === key && i.status === 'onscene')) C.clear(key);
    }
    this.G.wanted?.update(dt);   // you, if they're after you (wanted.js)
    this.trimUnits(dt);
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
  rejoin(u, n) {
    const net = this.G.net;
    let h = n.e * 2; if (!(net.flags[n.e] & 1) && Math.cos(Math.atan2(n.dz, n.dx) - u.heading) < 0) h++;
    u.h = h; u.s = (h & 1) ? net.len[n.e] - n.s : n.s; u.lane = 0; u.lat = 0; u.latT = 0; u.route = [h]; u.ri = 0; u.offroad = false; u._offT = 0;
    this.G.traffic.place(u);
  }
  // a response car at a road point n (net.nearest result), its beat round (x, z) (wanted.js picks the spot)
  spawnUnit(n, x, z) {
    const G = this.G, net = G.net;
    const h = n.e * 2 + (net.flags[n.e] & 1 ? 0 : (this.rand() < 0.5 ? 0 : 1));
    const v = G.traffic.spawnAt(h, Math.max(0.5, Math.min((h & 1) ? net.len[n.e] - n.s : n.s, net.len[n.e] - 1)), { kind: 'police', model: 'police', paint: 0xf2f2f2 });
    if (!v) return null;
    v.id = 'police-r' + (this._resp = (this._resp || 0) + 1); G.traffic.byId.set(v.id, v);
    v.beat = { x, z, r: 600 }; v.persistent = true; v.status = 'patrol'; v.dest = this.beatNode(v); v.extra = true;
    this.units.push(v);
    return v;
  }
  // response cars brought in for a pursuit go once it's over and nobody's watching (the six patrols stay)
  trimUnits(dt) {
    if ((this._trimT = (this._trimT || 0) - dt) > 0) return;
    this._trimT = 2;
    const G = this.G, me = G.brothers.me, cam = G.camera.position;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const v = this.units[i];
      if (!v.extra || v.law || v.status !== 'patrol' || v.player || v.owner) continue;
      if (Math.hypot(v.x - me.x, v.z - me.z) < 180 || Math.hypot(v.x - cam.x, v.z - cam.z) < 120) continue;
      G.traffic.remove(v); this.units.splice(i, 1);
    }
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
}
