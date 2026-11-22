// Thames Valley-style fictional police presence: foot and vehicle patrols, witnessed incidents,
// dispatch, attendance and return to patrol; proportionate stops/pursuits for the player.
// Everything emerges from the simulation — there are no scripted missions.
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
    if (other.crashed || other.kind === 'police' && by.player) { if (other.kind === 'police') this.onOffence('hit a police car', other.x, other.z, 2); return; }
    if (speed < 3) return;
    other.crashed = true; other.v = 0; other.hazard = true;
    const inc = this.createIncident('rtc', other.x, other.z, [other.id, by.id], { byPlayer: by.player, label: 'Road traffic collision' });
    if (by.player) this.onOffence('collision', other.x, other.z, speed > 9 ? 2 : 1, inc);
  }
  onPedHit({ p, v, speed }) {
    this.createIncident('pedestrian', p.x, p.z, [v.id], { byPlayer: v.player, label: 'Pedestrian struck' });
    if (v.player) this.onOffence('struck a pedestrian', p.x, p.z, 2);
  }
  // staged NPC collision (also happens naturally every few minutes near the player)
  stageCollision() {
    const G = this.G, f = G.focus;
    const cands = G.traffic.list.filter(v => !v.parked && !v.player && !v.crashed && v.kind === 'traffic' && v.v > 2 && Math.hypot(v.x - f.x, v.z - f.z) < 260 && Math.hypot(v.x - f.x, v.z - f.z) > 40);
    cands.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
    for (const a of cands) {
      const l = G.traffic.occ.get(a.h); if (!l) continue;
      const lead = l.find(o => o.s > a.s && o !== a && o.s - a.s < 30 && !o.crashed);
      if (!lead) continue;
      // rear-end shunt: a runs into lead
      a.s = lead.s - (lead.len + a.len) / 2 - 0.15; G.traffic.place(a);
      a.crashed = lead.crashed = true; a.v = lead.v = 0;
      const inc = this.createIncident('rtc', (a.x + lead.x) / 2, (a.z + lead.z) / 2, [a.id, lead.id], { label: 'Shunt (rear-end collision)' });
      G.audio?.crash(inc.x, inc.z, 0.6);
      // drivers get out
      for (const v of [a, lead]) {
        const rx = -Math.sin(v.heading), rz = Math.cos(v.heading);
        const d = { id: 'drv-' + v.id, h: v.h, s: v.s, sideSign: 1, lane: 0, look: People.randomLook(this.rand), speed: 1, mode: 'scene', sceneX: inc.x, sceneZ: inc.z, sceneT: 1e9, scenePose: 'phone',
          t: 0, phase: 0, heading: 0, x: v.x - rx * (v.def.W / 2 + 0.8), y: v.y, z: v.z - rz * (v.def.W / 2 + 0.8), visible: true, alpha: 1, driverOf: v.id };
        G.peds.list.push(d); inc.drivers = (inc.drivers || []).concat(d);
      }
      return inc;
    }
    return null;
  }
  update(dt) {
    const G = this.G;
    // natural incidents: rarely, a shunt near the player
    this.crashTimer -= dt;
    if (this.crashTimer <= 0) { this.crashTimer = 300 + this.rand() * 420; if (this.incidents.filter(i => i.status !== 'cleared').length < 2) this.stageCollision(); }
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
    for (const v of this.units) if (v.siren) for (const o of G.traffic.list) {
      if (o === v || o.parked || o.player) continue;
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
  dispatch(v, x, z, why) {
    const net = this.G.net;
    const n = net.nearest(x, z, 200, e => net.flags[e] & 16); if (!n) return false;
    v.status = 'responding'; v.siren = true; v.dest = net.ea[n.e];
    v.route = [v.h]; v.ri = 0; // force re-route next edge
    v.target = { x, z }; v.why = why;
    return true;
  }
  updateIncident(inc, dt) {
    const G = this.G; inc.t += dt;
    if (inc.status === 'new' && inc.t > inc.callAt) {
      inc.status = 'reported';
      const u = this.nearestUnit(inc.x, inc.z);
      if (u && this.dispatch(u, inc.x, inc.z, inc.label)) { inc.unit = u; inc.status = 'responding'; u.incident = inc; G.hud.feed(`999 call: ${inc.label} · ${G.roadName(inc.x, inc.z)} · ${u.id} responding`); }
      else G.hud.feed(`999 call: ${inc.label} · no unit free yet`);
    }
    if (inc.status === 'reported' && inc.t % 10 < dt) { const u = this.nearestUnit(inc.x, inc.z); if (u && this.dispatch(u, inc.x, inc.z, inc.label)) { inc.unit = u; inc.status = 'responding'; u.incident = inc; } }
    if (inc.status === 'responding') {
      const u = inc.unit, d = Math.hypot(u.x - inc.x, u.z - inc.z);
      if (d < 35 || (d < 60 && u.wait > 4)) {
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
      if (inc.t > 400) { inc.status = 'cleared'; }
    }
    if (inc.status === 'onscene') {
      // officers walk to the scene, talk with drivers, then clear
      for (const o of inc.officers) {
        const dx = inc.x - o.x, dz = inc.z - o.z, d = Math.hypot(dx, dz);
        if (d > 3) { o.x += dx / d * 1.2 * dt; o.z += dz / d * 1.2 * dt; o.speedNow = 1.2; o.phase = (o.phase + dt * 4.3) % 6.283; o.scenePose = 'walk'; }
        else { o.speedNow = 0; o.scenePose = 'talk'; }
        G.peds.ground(o);
      }
      if (inc.t - inc.arrived > 75) {
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
  // ---------------------------------------------------------------- player
  witnessed(x, z, r = 70) {
    const G = this.G;
    for (const v of this.units) if (v.status !== 'onscene' && Math.hypot(v.x - x, v.z - z) < r) return v;
    for (const o of this.officers) if (Math.hypot(o.x - x, o.z - z) < r * 0.7) return o;
    return null;
  }
  onOffence(what, x, z, level, inc) {
    const w = this.witnessed(x, z);
    if (!w) { this.G.hud.feed(`Nobody from the police saw that (${what}).`); return; }
    const P = this.player;
    if (P.state === 'pursuit') return;
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
    // police car chases / follows
    if (u && u.def && (P.state === 'pursuit' || P.state === 'stop')) {
      u.siren = true;
      if ((u._rt = (u._rt || 0) - dt) <= 0) { u._rt = 2; const n = G.net.nearest(me.x, me.z, 120, e => G.net.flags[e] & 16); if (n) { u.dest = G.net.ea[n.e]; u.route = [u.h]; u.ri = 0; } }
    }
    const dist = u ? Math.hypot(u.x - me.x, u.z - me.z) : 999;
    if (P.state === 'stop') {
      if (speed < 0.8) { P.still = (P.still || 0) + dt; if (P.still > 3 && dist < 60) { P.state = 'talking'; P.t = 0; G.hud.banner('Officer: “Mind how you go. Words of advice given — no further action.”', 'talk'); } }
      else P.still = 0;
      if (P.t > 25 && speed > 3) { P.state = 'pursuit'; P.t = 0; G.hud.banner('You didn’t stop — police pursuit', 'pursuit'); }
      if (dist > 400) this.resolve('The officer lost interest.');
    } else if (P.state === 'talking') {
      if (P.t > 6) this.resolve('Free to go.');
    } else if (P.state === 'pursuit') {
      const seen = dist < 180;
      P.lost = seen ? 0 : (P.lost || 0) + dt;
      if (dist < 7 && speed < 2.5) { P.caught = (P.caught || 0) + dt; if (P.caught > 2.5) { P.state = 'detained'; P.t = 0; G.hud.banner('Detained · interviewed and released with a caution (fictional)', 'talk'); G.hud.fade('Released'); } }
      else P.caught = 0;
      if (P.lost > 25) this.resolve('Police lost sight of you.');
      if (P.t > 240) this.resolve('The pursuit was called off.');
    } else if (P.state === 'detained') {
      if (P.t > 5) this.resolve('Released. Control returned.');
    }
  }
  resolve(msg) {
    const P = this.player, u = P.unit;
    if (u && u.def) { u.siren = false; u.status = 'patrol'; u.dest = this.beatNode(u); }
    P.state = 'none'; P.level = 0; P.unit = null; P.still = 0; P.caught = 0; P.lost = 0;
    this.G.hud.banner(msg, 'clear', 4);
  }
}
