import {isCycle} from './propulsion.js';
// Vehicle simulation. Vehicles have stable ids and state independent of rendering.
// Near the focus they run full car-following (IDM) with lanes, signals and give-way rules;
// further away they keep moving along their routes at reduced cost, so nothing pops or U-turns
// at a streaming boundary.
import { MODELS, PAINTS, randomModel, paintFor } from './vehicles.js';
import { F_ONEWAY, F_ROUNDABOUT, F_BRIDGE, F_DRIVE } from './network.js';

// the simulation bubble round the player: full simulation inside FULL_R, cars kept up to BUBBLE_R (frozen beyond it
// near an anchor), removed past KILL_R. Set per quality preset (perf.js `bubble`, setRadius).
let FULL_R = 480, BUBBLE_R = 650, KILL_R = 820;
export const KEEP_R = 250;        // the fleet within this radius of either brother is kept (frozen while he is inactive) and saved
const RANK = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6, motorway_link: 8, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 5, unclassified: 4, residential: 3, living_street: 2, service: 1, busway: 3 };
const DENS = { motorway: 1 / 120, trunk: 1 / 140, primary: 1 / 110, secondary: 1 / 160, tertiary: 1 / 220, motorway_link: 1 / 300, trunk_link: 1 / 300, primary_link: 1 / 240, secondary_link: 1 / 300, tertiary_link: 1 / 400, unclassified: 1 / 520, residential: 1 / 1040, living_street: 1 / 1800 };

export class Traffic {
  setRadius(bubble) { if (bubble > 0) setTrafficRadius(bubble); }
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
    this.density = 1;            // road classes above are already half the old spacing; the vehicle cap is halved too
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
    return randomModel(this.rand());
  }
  // mopeds and electric scooters mix in with the cars, more of them on the town streets than on the A-roads
  pickModel(h) {
    const name = this.net.clsName(h >> 1);
    const town = name === 'residential' || name === 'living_street' || name === 'service' || name === 'unclassified' || name === 'tertiary';
    const r = this.rand();
    if (r < (town ? .22 : .055)) {
      const type=this.rand();
      if (!town && /motorway|trunk/.test(name)) return 'motorcycle';
      if (!town) return type<.55 ? 'motorcycle' : 'moped';
      return type<.18 ? 'dirtbike' : type<.36 ? 'motorcycle' : type<.49 ? 'moped' : type<.67 ? 'bicycle' : type<.83 ? 'ebike' : 'escooter';
    }
    return this.randomModel();
  }
  driver(v) {
    const r = this.rand();
    v.v0f = 0.85 + r * 0.3;        // desired speed factor
    if (v.model === 'moped') v.v0f *= 0.62;
    if (isCycle(v.model) || v.model==='escooter') { v.v0f*=.55; v.citySpeed = v.model==='bicycle'?5.3:v.model==='ebike'?7.5:6.3; v.v=Math.min(v.v,v.citySpeed); }
    v.T = 1.2 + this.rand() * 0.6; v.s0 = 2 + this.rand(); v.amax = v.model.startsWith('bus') ? 1.0 : v.model === 'escooter' ? 1.1 : v.model === 'moped' ? 1.4 : 1.6 + this.rand() * 0.8; v.bc = 2.2;
  }
  spawnAt(h, s, opts = {}) {
    const model = opts.model || this.pickModel(h);
    const v = this.add({ kind: opts.kind || 'traffic', model, paint: opts.paint ?? paintFor(model, this.rand()), h, s, lane: 0, route: [h], ri: 0, v: opts.v ?? Math.min(12, this.net.speed[h >> 1] / 3.6 * 0.8) });
    this.driver(v);
    if (opts.route) { v.route = opts.route; v.ri = opts.ri || 0; v.h = v.route[v.ri]; }
    v.lane = Math.floor(this.rand() * this.net.laneCount(v.h));
    if (v.model === 'moped' || v.citySpeed) v.lane = 0;   // nearside, with the kerb
    this.place(v);
    return v;
  }
  // ----------------------------------------------------------------- geometry
  laneOffset(h, lane) {
    const e = h >> 1, w = this.net.width[e], nl = Math.max(1, this.net.lanesF[e] + this.net.lanesB[e]);
    const hs = this.net.shoulder ? this.net.shoulder[e] : 0;
    // motorway carriageway: lanes start inside the nearside hard shoulder and stop at the offside hard strip
    if (hs > 0) return w / 2 - hs - (w - hs - (this.net.strip[e] || 0)) / nl * ((lane | 0) + 0.5);
    const oneway = this.net.flags[e] & F_ONEWAY;
    // each direction owns only its left half (UK). laneCount already splits a one-sided tag in two.
    const n = this.net.laneCount(h);
    const lw = (oneway ? w : w * 0.5) / n;
    const i = Math.min(Math.max(0, lane | 0), n - 1);
    return w * 0.5 - lw * (i + 0.5);
  }
  // A Hermite arc connects the two lane centres with tangents parallel to each road.
  // Route distance still governs signals, stop lines, bus stops and right of way.
  junctionArc(v,from,to,lane,nextLane) {
    if(to==null || from===to || (from>>1)===(to>>1)) return null;
    const L=this.net.len[from>>1];
    const span=Math.min(8, Math.max(4,v.len*1.4), L*.42,this.net.len[to>>1]*.42);
    if(span<.6)return null;
    const point=(h,s,i)=>{
      const t=this.net.at(h,s,[0,0,0,0,0]), off=this.laneOffset(h,i);
      return {x:t[0]+t[4]*off,z:t[2]-t[3]*off,dx:t[3],dz:t[4]};
    };
    const a=point(from,L-span,lane), b=point(to,span,nextLane);
    const angle=Math.acos(Math.max(-1,Math.min(1,a.dx*b.dx+a.dz*b.dz)));
    return {from,to,lane,nextLane,span,a,b,angle};
  }
  place(v,dt=0) {
    const t = this.net.at(v.h, v.s, this.tmp);
    const dx = t[3], dz = t[4];
    const off = this.laneOffset(v.h, v.lane) + v.lat;
    let tx=t[0]+dz*off, tz=t[2]-dx*off, hd=Math.atan2(dz,dx);
    const remain=this.net.len[v.h>>1]-v.s;
    let arc=v.exitArc, offset=v.s;
    if(!arc || arc.to!==v.h || v.s>arc.span){
      arc=v.entryArc; offset=-remain;
      if(arc?.from!==v.h || arc.to!==v.route?.[v.ri+1] || arc.lane!==v.lane)arc=null;
    }
    if(arc && Math.abs(offset)<=arc.span){
      const u=.5+.5*offset/arc.span, w=1-u, {a,b}=arc;
      const tangent=2*arc.span;
      const sample=(start,end,d0,d1)=> w*w*(1+2*u)*start+u*u*(3-2*u)*end+tangent*u*w*(w*d0-u*d1);
      const deriv=(start,end,d0,d1)=>6*u*w*(end-start)+tangent*(w*(1-3*u)*d0+u*(3*u-2)*d1);
      hd=Math.atan2(deriv(a.z,b.z,a.dz,b.dz),deriv(a.x,b.x,a.dx,b.dx));
      tx=sample(a.x,b.x,a.dx,b.dx)+Math.sin(hd)*v.lat;
      tz=sample(a.z,b.z,a.dz,b.dz)-Math.cos(hd)*v.lat;
    }
    // a car knocked off its line (carPhysics.js) eases back into lane instead of snapping
    if (v._offLane && v.x != null) {
      const d = Math.hypot(tx - v.x, tz - v.z);
      if (d < 0.25 || d > 40) v._offLane = false;
      else { const k = Math.min(1, 0.6 / d) * 0.25; v.x += (tx - v.x) * k; v.z += (tz - v.z) * k; }
    }
    if (!v._offLane) { v.x = tx; v.z = tz; }
    const ty = t[1] + 0.05;
    v.y = v.y && Math.abs(v.y - ty) < 3 ? v.y + (ty - v.y) * 0.35 : ty;
    v.heading = !dt || v.heading == null ? hd : lerpAngle(v.heading,hd,1-Math.exp(-dt*13));
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
    if (!v.citySpeed && v.dest != null && this.routeBudget > 0 && end !== v.dest) {
      this.routeBudget--;
      const r = this.net.route(end, v.dest, { limit: v.kind === 'police' ? 40000 : 9000 });
      if (r && r.length) { v.route = [v.h, ...r]; v.ri = 0; return; }
      v.dest = null;
    }
    // weighted random continuation, no U-turns
    const outs = this.net.outD[end].filter(h => (!v.citySpeed || !/motorway|trunk/.test(this.net.clsName(h>>1))) && ((h >> 1) !== (v.h >> 1) || this.net.outD[end].length===1));
    if (!outs.length) {
      // a one-way carriageway that runs out (the motorway at the edge of the mapped area) is never driven
      // back against its traffic: the car waits at the end and is recycled as soon as nobody can see it
      if (this.net.flags[v.h >> 1] & F_ONEWAY) { v.route = [v.h]; v.ri = 0; v.deadEnd = true; return; }
      v.route = [v.h, v.h ^ 1]; v.ri = 0; return;
    }
    let tot = 0; const w = outs.map(h => { const r = this.rank[h >> 1]; const x = r <= 1 ? 0.15 : r * r; tot += x; return x; });
    let r = this.rand() * tot, pick = outs[0];
    for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) { pick = outs[i]; break; } }
    v.route = [v.h, pick]; v.ri = 0;
    // entering a roundabout: choose the exit now so the approach lane can match it
    if ((this.net.flags[pick >> 1] & F_ROUNDABOUT) && !(this.net.flags[v.h >> 1] & F_ROUNDABOUT)) this.planRoundabout(v);
  }
  planRoundabout(v) {
    const net = this.net; let h = v.route[v.route.length - 1];
    for (let k = 0; k < 12; k++) {
      const end = net.endNode(h), outs = net.outD[end].filter(o => (o >> 1) !== (h >> 1));
      const ring = outs.find(o => net.flags[o >> 1] & F_ROUNDABOUT), exits = outs.filter(o => !(net.flags[o >> 1] & F_ROUNDABOUT) && this.rank[o >> 1] > 1);
      if (exits.length && (!ring || this.rand() < 0.45)) { v.route.push(exits[Math.floor(this.rand() * exits.length)]); return; }
      if (!ring) return;
      v.route.push(ring); h = ring;
    }
  }
  // turn at the end of half-edge h into nh: 'left' | 'right' | 'through' (UK: left is nearside)
  turnOf(h, nh) {
    const net = this.net, a = net.at(h, net.len[h >> 1] - 0.5, this.tmpT || (this.tmpT = [0, 0, 0, 0, 0])), dx = a[3], dz = a[4];
    const b = net.at(nh, Math.min(net.len[nh >> 1], 6), this.tmpT2 || (this.tmpT2 = [0, 0, 0, 0, 0]));
    const ex = b[0] - a[0], ez = b[2] - a[2], l = Math.hypot(ex, ez) || 1;
    const left = (ex * dz - ez * dx) / l;   // component along (dz,-dx), the left of travel
    if ((h >> 1) === (nh >> 1)) return 'right';   // U-turn
    return left > 0.5 ? 'left' : left < -0.5 ? 'right' : 'through';
  }
  // exit direction for a planned route through a roundabout (relative to the approach)
  roundaboutTurn(v) {
    const net = this.net; let i = v.ri + 1;
    while (i < v.route.length && (net.flags[v.route[i] >> 1] & F_ROUNDABOUT)) i++;
    if (i >= v.route.length) return null;
    const a = net.at(v.h, net.len[v.h >> 1] - 0.5, [0, 0, 0, 0, 0]), b = net.at(v.route[i], 2, [0, 0, 0, 0, 0]);
    // component of the exit direction along the approach's left (dz,-dx), as in turnOf
    return { exitIndex: i, left: b[3] * a[4] - b[4] * a[3], dot: a[3] * b[3] + a[4] * b[4] };
  }
  // lane wanted for the coming manoeuvre on a multi-lane approach, or null for no preference
  wantedLane(v) {
    const net = this.net, h = v.h, e = h >> 1, nl = net.laneCount(h), nh = v.route[v.ri + 1];
    const psv = net.psv && net.psv[e] && nl > 1;
    if (v.kind === 'bus' && psv) return 0;                      // buses keep to the nearside bus lane
    if (nl < 2 || nh == null) return psv ? Math.max(1, Math.min(v.lane, nl - 1)) : null;
    let turn;
    if ((net.flags[nh >> 1] & F_ROUNDABOUT) && !(net.flags[e] & F_ROUNDABOUT)) {
      const r = this.roundaboutTurn(v);
      // UK: left or straight ahead (up to 12 o'clock) from the left lane, further round from the right lane
      turn = !r ? null : (r.left > 0.3 ? 'left' : r.dot > 0.5 ? 'through' : 'right');
      if (turn === 'through') return 0;
    } else if (net.flags[e] & F_ROUNDABOUT) {
      // on the ring: move to the outer (left) lane before taking the exit
      return !(net.flags[nh >> 1] & F_ROUNDABOUT) ? 0 : null;
    } else turn = this.turnOf(h, nh);
    const tl = this.turnLanesOf(h);
    if (tl) {
      const ok = tl.map((t, i) => [t, i]).filter(([t]) => turn === 'left' ? /left/.test(t) : turn === 'right' ? /right/.test(t) : /through|^none$|^$/.test(t)).map(([, i]) => i);
      if (ok.length) return ok.includes(v.lane) ? v.lane : ok.reduce((a, b) => Math.abs(b - v.lane) < Math.abs(a - v.lane) ? b : a);
    }
    if (turn === 'left') return 0;
    if (turn === 'right') return nl - 1;                        // UK: right turns from the offside lane
    if (psv && v.lane === 0) return 1;                          // others stay out of the bus lane
    return null;
  }
  // OSM turn:lanes for half-edge h, left to right (lane 0 is the nearside), when Astra's data has it
  turnLanesOf(h) {
    const net = this.net; if (!net.turnLanes) return null;
    const k = net.turnLanes[h]; if (k == null || k < 0) return null;
    const c = this._tl || (this._tl = new Map()); if (c.has(k)) return c.get(k);
    const str = net.names[k]; const arr = typeof str === 'string' && str.length ? str.split('|').map(x => x.trim()) : null;
    const res = arr && arr.length === net.laneCount(h) ? arr : null; c.set(k, res); return res;
  }
  // move into lane `to` if there is room; the lateral offset eases across instead of snapping
  changeLane(v, to, occ) {
    if (to === v.lane) return true;
    const l = occ.get(v.h) || [];
    if (l.some(o => o !== v && o.lane === to && o.s > v.s - 10 && o.s < v.s + 8)) return false;
    const before = this.laneOffset(v.h, v.lane);
    v.lane = to; v.lat += before - this.laneOffset(v.h, to);
    return true;
  }
  // right turns give way to oncoming traffic going ahead or turning left (not at signals with a red for them)
  oncoming(v, node, occ) {
    const net = this.net, a = net.at(v.h, net.len[v.h >> 1] - 0.5, this.tmpO || (this.tmpO = [0, 0, 0, 0, 0])), dx = a[3], dz = a[4];
    for (const h of net.inD[node]) {
      if (h === v.h || (h >> 1) === (v.h >> 1)) continue;
      const L = net.len[h >> 1], b = net.at(h, L - 0.5, this.tmpO2 || (this.tmpO2 = [0, 0, 0, 0, 0]));
      if (b[3] * dx + b[4] * dz > -0.7) continue;             // not opposing
      const l = occ.get(h); if (!l) continue;
      for (let i = l.length - 1; i >= 0; i--) {
        const o = l[i], d = L - o.s;
        if (d > 45) break;
        if (o.v > 1.2 && d / Math.max(o.v, 1) < 4.5) { const onh = o.route[o.ri + 1]; if (onh == null || this.turnOf(h, onh) !== 'right') return true; }
      }
    }
    return false;
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
      // traffic around the inactive brother waits where it is until he is played again
      v.frozen = v.kind !== 'police' && d2 > BUBBLE_R * BUBBLE_R && this.nearAnchor(v);
      if (v.frozen || v.offroad) continue;     // off-road police are moved by police.js
      if (v.crashed || v.brokenDown) { v.v = 0; v.brake = true; v.hazard = true; continue; }
      v.tick=(v.tick||0)+dt;
      if(v.near || v.tick>=.4 || v.s+v.v*dt>=net.len[v.h>>1]){
        this.drive(v,v.tick,occ,dt); v.tick=0;
      } else {v.s+=v.v*dt; this.place(v,dt);}
      v.spin = (v.spin + v.v * dt / v.def.wr) % (Math.PI * 2);
      v.lights = camInfo.night > 0.4 || camInfo.rain > 0.4;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 0.4; this.maintain(focus, camInfo); }
    for (const [k, t] of this.zebraBusy) { if (t < this.sig.t) this.zebraBusy.delete(k); }
  }
  leaderGap(v, occ) {
    const net = this.net, L = net.len[v.h >> 1];
    let gap = 1e9, lv = 0, lead = null;
    const l = occ.get(v.h);
    if (l) for (const o of l) {
      if (o === v || o.s <= v.s) continue;
      if (v.siren && o.yieldTo > 0 && o.v < 6) continue;        // blue lights squeeze past cars pulling over
      if (o.lane !== v.lane && Math.abs(o.lat - v.lat) < 1.2 && net.laneCount(v.h) > 1) continue;
      if (v.passing && Math.abs((o.lat || 0) - (v.lat || 0)) > 1.6) continue;   // overtaking in the opposing lane
      const g = o.s - v.s - o.len / 2 - v.len / 2;
      if (g < gap) { gap = g; lv = o.v; lead = o; }
      break;
    }
    if (gap > 60 || gap === 1e9) {
      const nh = v.route[v.ri + 1];
      if (nh != null) {
        const l2 = occ.get(nh);
        if (l2 && l2.length) { const o = l2[0]; const g = L - v.s + o.s - o.len / 2 - v.len / 2; if (g < gap) { gap = g; lv = o.v; lead = o; } }
      }
    }
    return [gap, lv, lead];
  }
  // Is the stationary thing ahead something to drive round, rather than the back of a queue? Only a car that has
  // crashed or broken down, a bus at its stop, a police car at a scene, a parked car or the player in the lane.
  // (Overtaking anything stationary sent whole queues at red lights down the wrong side of the road.)
  blocking(lead) {
    if (!lead) return false;
    if (lead === 'obstacle') return true;
    return !!(lead.crashed || lead.brokenDown || lead.hazard || lead.parked || lead.status === 'onscene' || lead.atStop);
  }
  drive(v, dt, occ, moveDt=dt) {
    const net = this.net, e = v.h >> 1, L = net.len[e];
    this.extend(v);
    let vmax = Math.max(4, (net.speed[e] / 3.6) * (v.v0f || 1) * (v.siren ? 1.35 : 1)) * (v.slow || 1);
    if (v.citySpeed) vmax = Math.min(vmax,v.citySpeed);
    let [gap, lv, lead] = this.leaderGap(v, occ);
    let stopAt = 1e9;
    const rem = L - v.s;
    const next=v.route[v.ri+1];
    if(next!=null && rem<36){
      const arc=v.entryArc;
      if(!arc || arc.from!==v.h || arc.to!==next || arc.lane!==v.lane)
        v.entryArc=this.junctionArc(v,v.h,next,v.lane,Math.min(v.lane,net.laneCount(next)-1));
      if(v.entryArc?.angle>.25){
        const cornerSpeed=Math.sqrt(2.8*v.entryArc.span / v.entryArc.angle);
        vmax=Math.min(vmax,Math.sqrt(cornerSpeed**2+4.4*Math.max(0,rem-v.entryArc.span)));
      }
    }
    // signals
    const approaches = net.stopAt.get(v.h);
    if (approaches && !v.siren) for (const [ci,g,stop] of approaches) {
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
    // lane choice for the next turn (turn:lanes, else UK rules), roundabout lanes and bus lanes
    if (rem < 90 && rem > 6 && !v.passing) { const wl = this.wantedLane(v); if (wl != null && wl !== v.lane) this.changeLane(v, wl, occ); }
    // right turns give way to oncoming traffic (patience runs out after ~20 s, then they nose through a gap)
    const nhT = v.route[v.ri + 1];
    if (nhT != null && rem < 22 && !v.siren && !(net.flags[e] & F_ROUNDABOUT) && net.inD[net.endNode(v.h)].length > 2 && this.turnOf(v.h, nhT) === 'right') {
      v.rtWait = v.v < 0.5 ? (v.rtWait || 0) + dt : (v.rtWait || 0);
      if (this.oncoming(v, net.endNode(v.h), occ) && v.rtWait < 20) stopAt = Math.min(stopAt, rem - 2);
    } else if (rem > 30) v.rtWait = 0;
    // indicators: signal the coming turn from ~40 m out (UK left = nearside), and when pulling out to pass
    const nhI = v.route[v.ri + 1];
    if (nhI != null && (v._ih !== v.h || v._inh !== nhI)) { v._ih = v.h; v._inh = nhI; v._turn = (net.flags[e] & F_ROUNDABOUT) ? null : this.turnOf(v.h, nhI); }
    v.ind = v.passing && Math.abs(v.lat - v.latT) > 0.3 ? 2 : nhI != null && rem < 40 && v._turn === 'left' ? 1 : nhI != null && rem < 40 && v._turn === 'right' ? 2 : 0;
    // demand-actuated signals: approaching vehicles register on the detector
    if (approaches && this.sig.detect) for (const [ci, g, stop] of approaches) if (stop - v.s < 60 && stop - v.s > -2) this.sig.detect(ci, g);
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
    if (gap < 14 && lv < (v.siren ? 3 : 0.5) && stopAt > gap + 2 && (v.siren || this.blocking(lead))) {
      v.stuck += dt;
      if (v.stuck > (v.siren ? 1 : 4)) this.tryPass(v, occ);
    } else { v.stuck = Math.max(0, v.stuck - dt); if (v.passing) { v.passT = (v.passT || 0) + dt; if ((gap > 18 && v.s > (v.passUntil ?? -1e9)) || v.passT > 7) { v.passing = false; v.latT = 0; v.passT = 0; } } }
    // responding police: pull up ~10 m short of the scene when it lies ahead on this road
    if (v.target && v.status === 'responding') {
      for (let k = 0; k <= 90; k += 6) {
        const t = this.net.at(v.h, Math.min(L, v.s + k), this.tmp2 || (this.tmp2 = [0, 0, 0, 0, 0]));
        if (Math.hypot(t[0] - v.target.x, t[2] - v.target.z) < 16) { stopAt = Math.min(stopAt, Math.max(0.5, k - 10)); break; }
        if (v.s + k >= L) break;
      }
    }
    // bus stops
    if (v.busData && this.busStop) { const bs = this.busStop(v); stopAt = Math.min(stopAt, bs); v.atStop = bs < 2.5 && v.v < 0.5; }
    // player vehicle / people standing in the carriageway ahead
    if (this.obstacles) {
      const c = Math.cos(v.heading), sn = Math.sin(v.heading);
      for (const o of this.obstacles) {
        const dx = o.x - v.x, dz = o.z - v.z; if (dx * dx + dz * dz > 50 * 50) continue;
        const ahead = dx * c + dz * sn, lat = -dx * sn + dz * c;
        if (ahead > 0 && Math.abs(lat) < (o.r || 1) + 1.1) { const g = ahead - v.len / 2 - (o.r || 1); if (g < gap) { gap = Math.max(0.01, g); lv = o.v || 0; lead = 'obstacle'; } }
      }
    }
    if (stopAt < gap) { gap = Math.max(0.01, stopAt); lv = 0; lead = null; }
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
    v.s += v.v * moveDt;
    v.lat += (v.latT - v.lat) * Math.min(1, dt * 1.5);
    // advance across half-edges
    let guard = 0;
    while (v.s >= net.len[v.h >> 1] && guard++ < 6) {
      v.s -= net.len[v.h >> 1];
      if (v.fixedRoute && v.ri + 1 >= v.route.length) { v.fixedRoute = false; v.busData = null; v.notInService = true; } // bus route left the map area: carry on as traffic
      this.extend(v);
      v.ri++;
      if (v.ri >= v.route.length) { v.ri = v.route.length - 1; v.s = net.len[v.h >> 1] - 0.1; v.v = 0; break; }
      const nh2 = v.route[v.ri];
      v.exitArc = v.entryArc?.to===nh2 ? v.entryArc : null; v.entryArc=null;
      v.h = nh2;
      v.lane = Math.min(v.lane, net.laneCount(v.h) - 1);
      // a pass that wasn't finished does not carry onto the next street (that left cars on the wrong side)
      if ((nh2 >> 1) !== e) { v.lat = 0; v.latT = 0; v.passing = false; v.passT = 0; }
      if (v.fixedRoute && v.onEdge) v.onEdge(v);
      if (!v.fixedRoute && v.route.length > 64 && v.ri > 32) { v.route = v.route.slice(v.ri); v.ri = 0; }
    }
    this.place(v,moveDt);
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
      if (!l.some(o => o !== v && o.lane === target && Math.abs(o.s - v.s) < 12)) { const b0 = this.laneOffset(v.h, v.lane); v.lane = target; v.lat += b0 - this.laneOffset(v.h, target); v.stuck = 0; return; }
    }
    if (!(net.flags[e] & F_ONEWAY)) { // overtake into the opposing lane when it is clear
      const name = net.clsName(e);
      // only the big one-way and primary roads: a pass on a town street put the car on the right and left it there
      if (name !== 'motorway' && name !== 'motorway_link' && name !== 'trunk' && name !== 'trunk_link' && name !== 'primary' && name !== 'primary_link') return;
      const opp = occ.get(v.h ^ 1) || [];
      const L = net.len[e], myOpp = L - v.s;
      // never across a junction, on a road too narrow for two, or without a long clear view of oncoming traffic
      if (L - v.s < 35 || v.s < 8 || net.width[e] < 5.5) return;
      if (!opp.some(o => o.s > myOpp - 90 && o.s < myOpp + 15)) { v.latT = -this.net.width[e] * 0.5; v.passing = true; v.stuck = 0; const l = occ.get(v.h) || []; const ahead = l.filter(o => o !== v && o.s > v.s && o.s - v.s < 45); v.passUntil = ahead.length ? Math.max(...ahead.map(o => o.s + o.len)) + 4 : v.s + 20; }
    }
  }
  // ----------------------------------------------------------------- persistence
  // anchors: positions to keep traffic around (both brothers). Set by the app every frame.
  nearAnchor(v, r = KEEP_R) {
    const A = this.anchors; if (!A) return false;
    for (const a of A) { const dx = v.x - a.x, dz = v.z - a.z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }
  // compact record of one simulated vehicle (ids, route, edge and position)
  fleetRecord(v) {
    const r = { id: v.id, k: v.kind, m: v.model, p: v.paint, h: v.h, s: +v.s.toFixed(1), l: v.lane, v: +(v.v || 0).toFixed(1) };
    if (v.kind === 'bus' && v.busRoute != null && v.fixedRoute) { r.br = v.busRoute; r.ri = v.ri; r.ns = v.nextStop; r.ref = v.ref; }
    else { r.r = v.route.slice(v.ri, v.ri + 12); if (v.dest != null) r.d = v.dest; if (v.notInService) r.nis = 1; if (v.ref) r.ref = v.ref; }
    return r;
  }
  // the moving fleet within r of any anchor, nearest first, capped (a record is ~150 bytes)
  snapshotFleet(anchors = this.anchors || [], r = KEEP_R, max = 600) {
    const out = [];
    for (const v of this.list) {
      if (v.parked || v.player || v.crashed || v.h == null || v.dead || v.free || v.owner) continue;
      if (v.kind !== 'traffic' && v.kind !== 'bus') continue;
      let d = 1e9; for (const a of anchors) d = Math.min(d, Math.hypot(v.x - a.x, v.z - a.z));
      if (d < r) out.push([d, v]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return { v: 1, nextId: this.nextId, cars: out.slice(0, max).map(([, v]) => this.fleetRecord(v)) };
  }
  // recreate saved vehicles with their ids; busRoute(i) resolves a bus route index to its data
  restoreFleet(fleet, busRoute = null) {
    if (!fleet || !Array.isArray(fleet.cars)) return 0;
    const net = this.net; let n = 0;
    for (const r of fleet.cars) {
      if (this.byId.has(r.id) || !MODELS[r.m] || r.h == null || r.h >> 1 >= net.nEdges) continue;
      const v = this.add({ id: r.id, kind: r.k, model: r.m, paint: r.p, h: r.h, s: Math.min(r.s, net.len[r.h >> 1]), lane: Math.min(r.l || 0, net.laneCount(r.h) - 1), route: [r.h], ri: 0, v: r.v || 0 });
      this.driver(v);
      const bd = r.br != null && busRoute ? busRoute(r.br) : null;
      if (bd && bd.hs[r.ri] === r.h) { v.route = bd.hs; v.ri = r.ri; v.fixedRoute = true; v.busRoute = r.br; v.ref = r.ref; v.persistent = true; v.v0f = 0.85; v.nextStop = r.ns; v.busData = bd; }
      else {
        if (Array.isArray(r.r) && r.r[0] === r.h) v.route = r.r.filter(h => h >> 1 < net.nEdges);
        if (r.d != null) v.dest = r.d; if (r.nis) v.notInService = true; if (r.ref) v.ref = r.ref;
        if (r.k === 'bus') v.notInService = true;
      }
      this.place(v); n++;
      const m = /^v(\d+)$/.exec(r.id); if (m) this.nextId = Math.max(this.nextId, +m[1] + 1);
    }
    if (fleet.nextId) this.nextId = Math.max(this.nextId, fleet.nextId);
    return n;
  }
  // ----------------------------------------------------------------- density bubble
  maintain(focus, info) {
    const net = this.net;
    // remove far ordinary traffic that nobody can see
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.kind !== 'traffic' || v.parked || v.player || v.crashed || v.brokenDown || v.frozen || v.towing) continue;
      const d = Math.hypot(v.x - focus.x, v.z - focus.z);
      if ((d > KILL_R || v.deadEnd) && !info.visible(v.x, v.y, v.z, 0.6)) this.remove(v);
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
    const target = Math.min(this.maxVehicles || 130, this._edgeCache.target * tod * this.density);
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

export function setTrafficRadius(bubble) { BUBBLE_R = bubble; FULL_R = Math.max(250, bubble - 170); KILL_R = bubble + 170; }
export function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
