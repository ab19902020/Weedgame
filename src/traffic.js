// Vehicle simulation. Vehicles have stable ids and state independent of rendering.
// Near the focus they run full car-following (IDM) with lanes, signals and give-way rules;
// further away they keep moving along their routes at reduced cost, so nothing pops or U-turns
// at a streaming boundary.
import { MODELS, PAINTS } from './vehicles.js';
import { F_ONEWAY, F_ROUNDABOUT, F_BRIDGE, F_DRIVE } from './network.js';

const FULL_R = 480, BUBBLE_R = 650, KILL_R = 820;
const RANK = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6, motorway_link: 8, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 5, unclassified: 4, residential: 3, living_street: 2, service: 1, busway: 3 };
const DENS = { motorway: 1 / 60, trunk: 1 / 70, primary: 1 / 55, secondary: 1 / 80, tertiary: 1 / 110, motorway_link: 1 / 150, trunk_link: 1 / 150, primary_link: 1 / 120, secondary_link: 1 / 150, tertiary_link: 1 / 200, unclassified: 1 / 260, residential: 1 / 520, living_street: 1 / 900 };

export class Traffic {
  constructor(net, signals, opts = {}) {
    this.net = net; this.sig = signals;
    this.list = []; this.byId = new Map(); this.nextId = 1;
    this.rand = mulberry(opts.seed || 1234);
    this.tmp = [0, 0, 0, 0, 0];
    this.routeBudget = 0;
    this.zebraBusy = new Map();      // crossing key -> time until free
    this.rank = new Uint8Array(net.nEdges);
    for (let e = 0; e < net.nEdges; e++) this.rank[e] = RANK[net.classes[net.cls[e]]] || 0;
    this.onCollision = null;
    this.spawnTimer = 0;
    this.density = 1;
    this.focus = { x: 0, z: 0 };
  }
  // ----------------------------------------------------------------- creation
  add(v) {
    v.id = v.id || 'v' + (this.nextId++);
    Object.assign(v, { v: v.v ?? 0, lat: v.lat ?? 0, latT: 0, brake: false, lights: false, spin: 0, wait: 0, stuck: 0, y: v.y ?? 0 });
    const def = MODELS[v.model]; v.len = def.L; v.def = def;
    this.list.push(v); this.byId.set(v.id, v);
    if (v.h != null) this.place(v);
    return v;
  }
  remove(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); this.byId.delete(v.id); v.dead = true; }
  randomModel() {
    const r = this.rand();
    return r < 0.36 ? 'hatch' : r < 0.6 ? 'saloon' : r < 0.74 ? 'estate' : r < 0.88 ? 'suv' : 'van';
  }
  driver(v) {
    const r = this.rand();
    v.v0f = 0.85 + r * 0.3;        // desired speed factor
    v.T = 1.2 + this.rand() * 0.6; v.s0 = 2 + this.rand(); v.amax = v.model.startsWith('bus') ? 1.0 : 1.6 + this.rand() * 0.8; v.bc = 2.2;
  }
  spawnAt(h, s, opts = {}) {
    const model = opts.model || this.randomModel();
    const v = this.add({ kind: opts.kind || 'traffic', model, paint: opts.paint ?? PAINTS[Math.floor(this.rand() * PAINTS.length)], h, s, lane: 0, route: [h], ri: 0, v: opts.v ?? Math.min(12, this.net.speed[h >> 1] / 3.6 * 0.8) });
    this.driver(v);
    if (opts.route) { v.route = opts.route; v.ri = opts.ri || 0; v.h = v.route[v.ri]; }
    v.lane = Math.floor(this.rand() * this.net.laneCount(v.h));
    this.place(v);
    return v;
  }
  // ----------------------------------------------------------------- geometry
  laneOffset(h, lane) {
    const e = h >> 1, w = this.net.width[e], nl = Math.max(1, this.net.lanesF[e] + this.net.lanesB[e]);
    const lw = w / nl;
    const fl = (h & 1) ? this.net.lanesB[e] : this.net.lanesF[e];
    if (this.net.flags[e] & F_ONEWAY) return w / 2 - lw * (lane + 0.5);
    return Math.max(lw * 0.5, w / 2 - lw * (Math.min(lane, Math.max(0, fl - 1)) + 0.5));
  }
  place(v) {
    const t = this.net.at(v.h, v.s, this.tmp);
    const dx = t[3], dz = t[4];
    const off = this.laneOffset(v.h, v.lane) + v.lat;
    v.x = t[0] + dz * off; v.z = t[2] - dx * off;
    const ty = t[1] + 0.05;
    v.y = v.y && Math.abs(v.y - ty) < 3 ? v.y + (ty - v.y) * 0.35 : ty;
    const hd = Math.atan2(dz, dx);
    v.heading = v.heading == null ? hd : lerpAngle(v.heading, hd, 0.35);
    // pitch from grade
    const ahead = this.net.at(v.h, Math.min(this.net.len[v.h >> 1], v.s + 2), this.tmp)[1];
    v.pitch = Math.atan2(ahead + 0.05 - ty, 2) * 0.8;
  }
  // ----------------------------------------------------------------- routing
  extend(v) {
    // ensure the route has a next half-edge after the current one
    if (v.ri + 1 < v.route.length) return;
    if (v.fixedRoute) return;
    const end = this.net.endNode(v.h);
    if (v.dest != null && this.routeBudget > 0 && end !== v.dest) {
      this.routeBudget--;
      const r = this.net.route(end, v.dest, { limit: v.kind === 'police' ? 40000 : 9000 });
      if (r && r.length) { v.route = [v.h, ...r]; v.ri = 0; return; }
      v.dest = null;
    }
    // weighted random continuation, no U-turns
    const outs = this.net.outD[end].filter(h => (h >> 1) !== (v.h >> 1) || this.net.outD[end].length === 1);
    if (!outs.length) { v.route = [v.h, v.h ^ 1]; v.ri = 0; return; }
    let tot = 0; const w = outs.map(h => { const r = this.rank[h >> 1]; const x = r <= 1 ? 0.15 : r * r; tot += x; return x; });
    let r = this.rand() * tot, pick = outs[0];
    for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) { pick = outs[i]; break; } }
    v.route = [v.h, pick]; v.ri = 0;
  }
  // ----------------------------------------------------------------- main update
  update(dt, focus, camInfo) {
    this.focus = focus;
    this.routeBudget = 3;
    const net = this.net;
    // occupancy buckets per half-edge
    const occ = this.occ = new Map();
    for (const v of this.list) {
      if (v.parked || v.h == null || v.player) continue;
      let l = occ.get(v.h); if (!l) occ.set(v.h, l = []); l.push(v);
    }
    for (const l of occ.values()) l.sort((a, b) => a.s - b.s);
    const R2 = FULL_R * FULL_R;
    for (const v of this.list) {
      if (v.parked || v.player || v.h == null) continue;
      const dx = v.x - focus.x, dz = v.z - focus.z, d2 = dx * dx + dz * dz;
      v.near = d2 < R2;
      if (v.crashed) { v.v = 0; v.brake = true; v.hazard = true; continue; }
      if (v.near || (v.tick = (v.tick || 0) + dt) > 0.4) { this.drive(v, v.near ? dt : v.tick, occ); v.tick = 0; }
      else { v.s += v.v * dt; if (v.s < net.len[v.h >> 1]) this.place(v); }
      v.spin = (v.spin + v.v * dt / v.def.wr) % (Math.PI * 2);
      v.lights = camInfo.night > 0.4 || camInfo.rain > 0.4;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 0.4; this.maintain(focus, camInfo); }
    for (const [k, t] of this.zebraBusy) { if (t < this.sig.t) this.zebraBusy.delete(k); }
  }
  leaderGap(v, occ) {
    const net = this.net, L = net.len[v.h >> 1];
    let gap = 1e9, lv = 0;
    const l = occ.get(v.h);
    if (l) for (const o of l) {
      if (o === v || o.s <= v.s) continue;
      if (o.lane !== v.lane && Math.abs(o.lat - v.lat) < 1.2 && net.laneCount(v.h) > 1) continue;
      const g = o.s - v.s - o.len / 2 - v.len / 2;
      if (g < gap) { gap = g; lv = o.v; }
      break;
    }
    if (gap > 60 || gap === 1e9) {
      const nh = v.route[v.ri + 1];
      if (nh != null) {
        const l2 = occ.get(nh);
        if (l2 && l2.length) { const o = l2[0]; const g = L - v.s + o.s - o.len / 2 - v.len / 2; if (g < gap) { gap = g; lv = o.v; } }
      }
    }
    return [gap, lv];
  }
  drive(v, dt, occ) {
    const net = this.net, e = v.h >> 1, L = net.len[e];
    this.extend(v);
    const vmax = Math.max(4, (net.speed[e] / 3.6) * (v.v0f || 1) * (v.siren ? 1.35 : 1)) * (v.slow || 1);
    let [gap, lv] = this.leaderGap(v, occ);
    let stopAt = 1e9;
    const rem = L - v.s;
    // signals
    const sa = net.stopAt.get(v.h);
    if (sa && !v.siren) {
      const [ci, g, stop] = sa;
      const a = this.sig.aspect(ci, g);
      const dStop = stop - v.s;
      if (dStop > -0.5 && (a === 'R' || a === 'RA' || (a === 'A' && dStop > v.v * v.v / (2 * 3.5)))) stopAt = Math.min(stopAt, dStop);
    }
    // give way / stop / roundabout entry at the end of this half-edge
    const ctrl = (v.h & 1) ? net.ctrlA[e] : net.ctrlB[e];
    if (ctrl && ctrl !== 3 && rem < 30 && !v.siren) {
      const end = net.endNode(v.h);
      if (ctrl === 2 && !v.stopped) { if (v.v < 0.3 && rem < 3) v.stopped = true; else stopAt = Math.min(stopAt, rem - 1.5); }
      if (this.conflict(v, end, occ)) stopAt = Math.min(stopAt, rem - 1.5);
    }
    if (rem > 30) v.stopped = false;
    // don't block the junction: next half-edge jammed at its entry
    const nh = v.route[v.ri + 1];
    if (nh != null && rem < 25) {
      const l2 = occ.get(nh);
      if (l2 && l2.length && l2[0].s < l2[0].len + 2 && l2[0].v < 1 && l2[0] !== v) stopAt = Math.min(stopAt, rem - 1.5);
    }
    // zebra / crossing occupancy
    const crs = net.crossByEdge.get(e);
    if (crs) for (const c of crs) {
      const cs = (v.h & 1) ? L - c.s : c.s; const d = cs - v.s;
      if (d > 0 && d < 30 && this.zebraBusy.has(e + ':' + Math.round(c.s))) stopAt = Math.min(stopAt, d - 3);
    }
    // overtake / change lane when blocked by a stationary obstacle
    if (gap < 14 && lv < 0.5 && stopAt > gap + 2) {
      v.stuck += dt;
      if (v.stuck > 4) this.tryPass(v, occ);
    } else { v.stuck = Math.max(0, v.stuck - dt); if (v.passing && gap > 25) { v.passing = false; v.latT = 0; } }
    // bus stops
    if (v.busData && this.busStop) stopAt = Math.min(stopAt, this.busStop(v));
    // player vehicle / people standing in the carriageway ahead
    if (this.obstacles) {
      const c = Math.cos(v.heading), sn = Math.sin(v.heading);
      for (const o of this.obstacles) {
        const dx = o.x - v.x, dz = o.z - v.z; if (dx * dx + dz * dz > 50 * 50) continue;
        const ahead = dx * c + dz * sn, lat = -dx * sn + dz * c;
        if (ahead > 0 && Math.abs(lat) < (o.r || 1) + 1.1) { const g = ahead - v.len / 2 - (o.r || 1); if (g < gap) { gap = Math.max(0.01, g); lv = o.v || 0; } }
      }
    }
    if (stopAt < gap) { gap = Math.max(0.01, stopAt); lv = 0; }
    // police with sirens: others pull over
    if (v.yieldTo > 0) { v.yieldTo -= dt; v.latT = Math.max(v.latT, 0.9); }
    // IDM
    const s0 = v.s0 || 2, T = v.T || 1.4, a = v.amax || 1.8, b = v.bc || 2.2;
    const dv = v.v - lv;
    const sStar = s0 + Math.max(0, v.v * T + v.v * dv / (2 * Math.sqrt(a * b)));
    let acc = a * (1 - Math.pow(v.v / vmax, 4) - Math.pow(sStar / Math.max(0.1, gap), 2));
    acc = Math.max(-8, Math.min(a, acc));
    v.v = Math.max(0, v.v + acc * dt);
    if (gap < 0.3 && lv < 0.1) v.v = 0;
    v.brake = acc < -0.8 || (v.v < 0.2 && gap < 20);
    v.wait = v.v < 0.3 ? v.wait + dt : 0;
    v.s += v.v * dt;
    v.lat += (v.latT - v.lat) * Math.min(1, dt * 1.5);
    // advance across half-edges
    let guard = 0;
    while (v.s >= net.len[v.h >> 1] && guard++ < 6) {
      v.s -= net.len[v.h >> 1];
      this.extend(v);
      v.ri++;
      if (v.ri >= v.route.length) { v.ri = v.route.length - 1; v.s = net.len[v.h >> 1] - 0.1; v.v = 0; break; }
      const nh2 = v.route[v.ri];
      v.h = nh2;
      v.lane = Math.min(v.lane, net.laneCount(v.h) - 1);
      if (v.fixedRoute && v.onEdge) v.onEdge(v);
      if (v.route.length > 64 && v.ri > 32) { v.route = v.route.slice(v.ri); v.ri = 0; }
    }
    this.place(v);
  }
  conflict(v, node, occ) {
    // any higher-priority approaching vehicle within 35 m of the node (or on the roundabout)
    const net = this.net;
    for (const h of net.inD[node]) {
      if (h === v.h) continue;
      const e = h >> 1;
      const ctrl = (h & 1) ? net.ctrlA[e] : net.ctrlB[e];
      const ring = net.flags[e] & F_ROUNDABOUT;
      if (ctrl !== 0 && !ring) continue;  // they also have to give way
      const l = occ.get(h); if (!l) continue;
      const L = net.len[e];
      for (const o of l) {
        const d = L - o.s;
        if (d < (ring ? 22 : 38) && d > -2 && o.v > 1.2 && d / Math.max(o.v, 1) < 4.5) return true;
      }
    }
    // vehicles currently crossing the junction box
    for (const h of net.outD[node]) {
      const l = occ.get(h); if (!l) continue;
      for (const o of l) { if (o.s < 6 && o !== v && o.v > 0.5 && (o.route[o.ri - 1] ?? -1) !== v.h) return true; break; }
    }
    return false;
  }
  tryPass(v, occ) {
    const net = this.net, e = v.h >> 1, nl = net.laneCount(v.h);
    if (nl > 1) { // change lane within the same direction
      const target = v.lane === 0 ? 1 : v.lane - 1;
      const l = occ.get(v.h) || [];
      if (!l.some(o => o !== v && o.lane === target && Math.abs(o.s - v.s) < 12)) { v.lane = target; v.stuck = 0; return; }
    }
    if (!(net.flags[e] & F_ONEWAY)) { // overtake into the opposing lane when it is clear
      const opp = occ.get(v.h ^ 1) || [];
      const L = net.len[e], myOpp = L - v.s;
      if (!opp.some(o => Math.abs(o.s - myOpp) < 55)) { v.latT = -this.net.width[e] * 0.5; v.passing = true; v.stuck = 0; }
    }
  }
  // ----------------------------------------------------------------- density bubble
  maintain(focus, info) {
    const net = this.net;
    // remove far ordinary traffic that nobody can see
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.kind !== 'traffic' || v.parked || v.player || v.crashed) continue;
      const d = Math.hypot(v.x - focus.x, v.z - focus.z);
      if (d > KILL_R && !info.visible(v.x, v.y, v.z, 0.6)) this.remove(v);
    }
    // target count from network around the focus
    if (!this._edgeCache || Math.hypot(this._edgeCache.x - focus.x, this._edgeCache.z - focus.z) > 80) {
      const edges = new Set(), w = [];
      for (let cx = Math.floor((focus.x - BUBBLE_R) / 50); cx <= Math.floor((focus.x + BUBBLE_R) / 50); cx++)
        for (let cz = Math.floor((focus.z - BUBBLE_R) / 50); cz <= Math.floor((focus.z + BUBBLE_R) / 50); cz++) {
          const l = net.grid.get(cx * 65536 + cz); if (!l) continue;
          for (let k = 0; k < l.length; k += 2) edges.add(l[k]);
        }
      let target = 0;
      for (const e of edges) {
        if (!(net.flags[e] & F_DRIVE)) continue;
        const d = DENS[net.classes[net.cls[e]]]; if (!d) continue;
        const lanes = Math.max(1, net.lanesF[e] + net.lanesB[e]);
        const x = d * net.len[e] * Math.min(lanes, 4) * 0.5; target += x; w.push([e, x]);
      }
      this._edgeCache = { x: focus.x, z: focus.z, w, target };
    }
    const hr = info.hour;
    const tod = hr < 5 ? 0.12 : hr < 6.5 ? 0.3 : hr < 9.5 ? 1.15 : hr < 16 ? 0.85 : hr < 18.5 ? 1.15 : hr < 22 ? 0.55 : 0.25;
    const target = Math.min(260, this._edgeCache.target * tod * this.density);
    let count = 0;
    for (const v of this.list) if (!v.parked && Math.hypot(v.x - focus.x, v.z - focus.z) < BUBBLE_R) count++;
    let tries = 6;
    while (count < target && tries-- > 0) {
      const W = this._edgeCache.w; if (!W.length) break;
      let tot = 0; for (const [, x] of W) tot += x;
      let r = this.rand() * tot, e = W[0][0];
      for (const [ee, x] of W) { r -= x; if (r <= 0) { e = ee; break; } }
      let h = e * 2;
      if (!(net.flags[e] & F_ONEWAY) && this.rand() < 0.5) h++;
      const s = this.rand() * net.len[e];
      net.at(h, s, this.tmp);
      const d = Math.hypot(this.tmp[0] - focus.x, this.tmp[2] - focus.z);
      if (d > BUBBLE_R) continue;
      if (info.visible(this.tmp[0], this.tmp[1], this.tmp[2], 0.5) && d < 520) continue;
      const l = this.occ.get(h);
      if (l && l.some(o => Math.abs(o.s - s) < 14)) continue;
      const v = this.spawnAt(h, s);
      if (this.rand() < 0.5) { v.dest = Math.floor(this.rand() * net.nNodes); }
      count++;
    }
  }
}

export function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
