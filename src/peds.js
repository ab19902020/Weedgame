// Pedestrians: pavement navigation, crossings, routines, groups, queues and reactions.
import { People } from './characters.js';
import { mulberry, lerpAngle } from './traffic.js';
import { F_DRIVE } from './network.js';
import { WalkGraph } from './walkgraph.js';

// Hourly footfall profiles (0..1, index = hour). Town centres peak on Saturday afternoons; residential
// streets are near-empty at dawn and busiest around the school run and early evening. Simulated, not counted.
export const PROFILES = {
  centre: {
    weekday: [.04, .02, .01, .01, .01, .02, .05, .15, .45, .55, .65, .75, .9, .85, .75, .75, .8, .85, .6, .45, .35, .3, .2, .1],
    saturday: [.08, .05, .03, .02, .01, .02, .04, .08, .2, .45, .75, .95, 1, 1, 1, 1, .95, .8, .55, .45, .45, .4, .3, .15],
    sunday: [.06, .04, .02, .01, .01, .01, .03, .05, .1, .25, .45, .6, .7, .7, .7, .65, .5, .35, .25, .2, .15, .1, .06, .04],
  },
  local: {
    weekday: [.02, .01, .005, .005, .01, .03, .12, .35, .6, .35, .3, .3, .35, .35, .3, .55, .6, .55, .45, .35, .25, .15, .08, .04],
    saturday: [.03, .02, .01, .005, .005, .01, .04, .1, .25, .4, .5, .55, .55, .5, .5, .5, .45, .4, .35, .3, .2, .15, .08, .05],
    sunday: [.03, .02, .01, .005, .005, .01, .03, .06, .15, .3, .45, .5, .5, .45, .45, .4, .35, .3, .25, .2, .15, .1, .06, .04],
  },
};
export function footfall(kind, dow, hour) {
  const P = PROFILES[kind] || PROFILES.local, day = dow === 6 ? P.saturday : dow === 0 ? P.sunday : P.weekday;
  const h0 = Math.floor(((hour % 24) + 24) % 24), f = hour - Math.floor(hour), h1 = (h0 + 1) % 24;
  return day[h0] * (1 - f) + day[h1] * f;
}

const R = 190, KILL = 240;
const CORES = []; // filled from manifest districts (town centres are busier)

export class Peds {
  constructor(G) {
    this.G = G; this.net = G.net; this.list = []; this.nextId = 1;
    this.rand = mulberry(99);
    this.tmp = [0, 0, 0, 0, 0];
    this.timer = 0;
    this.walkEdges = null;
    this.residents=new Map();
    this.events = [];
    this.graph = G.walkGraph = new WalkGraph(G.net);
    G.events.on('horn', e => this.horn(e));
    G.events.on('vehicleSweep', e => this.sweep(e));
    G.events.on('impact', e => this.disturb(e.x, e.z, 45, 'crash'));
    G.events.on('noise', e => this.disturb(e.x, e.z, e.r || 30, e.kind));
  }
  // density by place / time / weather
  density(x, z) {
    const G = this.G, hr = G.world.hours();
    const d = G.districtAt(x, z);
    const core = d && d.core ? Math.max(0, 1 - Math.hypot(x - d.x, z - d.z) / d.coreR) : 0;
    const dow = new Date(G.world.time * 1000).getDay();
    const wet = 1 - G.world.cur.rain * 0.55;
    // e.g. Broad Street on a Saturday at 14:00 -> ~110; a Woodley close at 06:00 on a weekday -> ~0.2
    return (10 * footfall('local', dow, hr) + core * 110 * footfall('centre', dow, hr)) * wet;
  }
  pickWalkEdge(focus) {
    // collect walkable edges in range
    const net = this.net, out = [];
    for (let cx = Math.floor((focus.x - R) / 50); cx <= Math.floor((focus.x + R) / 50); cx++)
      for (let cz = Math.floor((focus.z - R) / 50); cz <= Math.floor((focus.z + R) / 50); cz++) {
        const l = net.grid.get(cx * 65536 + cz); if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const e = l[k]; if (!net.walkable(e)) continue;
          if (this.graph && this.graph.hasMappedSidewalk(e)) continue;     // the mapped footway alongside is used instead
          out.push(e); if (net.cls[e] === this._pedCls) out.push(e, e);     // pedestrianised streets are busier
        }
      }
    return out;
  }
  side(e) { return this.net.walkCls.has(this.net.cls[e]) ? 0 : 1; }
  get _pedCls() { return this.__pc ?? (this.__pc = this.net.classes.indexOf('pedestrian')); }
  pos(p) {
    const net = this.net, t = net.at(p.h, p.s, this.tmp), e = p.h >> 1;
    const off = this.side(e) ? (net.width[e] / 2 + 1.05 + p.lane * 0.6) : p.lane * 0.5;
    const ox = t[4] * off * p.sideSign, oz = -t[3] * off * p.sideSign;
    return [t[0] + ox, t[2] + oz, t[3], t[4]];
  }
  spawn(focus, info, near) {
    const edges = this._edges; if (!edges || !edges.length) return;
    const e = edges[Math.floor(this.rand() * edges.length)];
    const net = this.net;
    if (!net.walkable(e)) return;
    const h = e * 2 + (this.rand() < 0.5 ? 1 : 0);
    const s = this.rand() * net.len[e];
    const p = { id: 'p' + this.nextId++, h, s, sideSign: this.rand() < 0.5 ? 1 : -1, lane: this.rand() * 0.8 - 0.4, look: People.randomLook(this.rand),
      speed: 1.15 + this.rand() * 0.45, mode: 'walk', t: 0, phase: this.rand() * 6, heading: 0, y: 0, visible: true, alpha: 0 };
    if (!net.pav[e] && !net.walkCls.has(net.cls[e])) return;
    const [x, z] = this.pos(p);
    if (Math.hypot(x - focus.x, z - focus.z) > R) return;
    if (!near && info.visible(x, 1, z, 1.5) && Math.hypot(x - focus.x, z - focus.z) < 120) return;
    if (this.G.tiles.insideBuilding(x, z)) return;
    p.x = x; p.z = z;
    const gy = this.G.tiles.ground(x, z); if (gy == null) return;
    p.y = gy;
    this.list.push(p);
    // routines: some go to the bus stop, some chat, some walk in pairs
    const r = this.rand();
    if (r > 0.86) this.toDoor(p);
    if (r < 0.12) this.toBusStop(p);
    else if (r < 0.2 && this.list.length < 120) {
      const q = { ...p, id: 'p' + this.nextId++, look: People.randomLook(this.rand), lane: p.lane + 0.5, leader: p, phase: p.phase + 1 };
      this.list.push(q);
    } else if (r < 0.27) { p.mode = 'talk'; p.timer = 15 + this.rand() * 40; const q = { ...p, id: 'p' + this.nextId++, look: People.randomLook(this.rand), mode: 'talk', partner: p, timer: p.timer }; q.x += Math.cos(p.heading) * 1.1; this.list.push(q); p.partner = q; }
    return p;
  }
  toBusStop(p) {
    const stops = this.G.net.busStops;
    let best = -1, bd = 160;
    for (let i = 0; i < stops.length; i++) { if(!this.G.transit?.services.has(i))continue; const d = Math.hypot(stops[i][0] - p.x, stops[i][1] - p.z); if (d < bd) { bd = d; best = i; } }
    if (best < 0) return;
    p.goal = { kind: 'stop', i: best, x: stops[best][0], z: stops[best][1] };
  }
  update(dt, focus, info) {
    const G = this.G, net = this.net; this.info = info;
    this.timer -= dt;
    if (!this._ef || Math.hypot(this._ef.x - focus.x, this._ef.z - focus.z) > 40) { this._edges = this.pickWalkEdge(focus); this._ef = { x: focus.x, z: focus.z }; }
    if (this.timer <= 0) {
      this.timer = 0.3;
      for(const [id,p] of this.residents){
        if(Math.hypot(p.x-focus.x,p.z-focus.z)>R || this.G.tiles.terrain(p.x,p.z)==null || info.visible(p.x,p.y+1,p.z,1))continue;
        p.t+=Math.max(0,G.time-p.awaySince);p.planAfter=0;p.mode='walk';p.goal=null;
        this.list.push(p);this.residents.delete(id);
      }
      const target = Math.min(G.budget?.people || 170, this.density(focus.x, focus.z) * (G.quality === 'low' ? 0.5 : 1));
      if (this.list.length < target) for (let i = 0; i < 3; i++) { if (this.rand() < 0.18) this.spawnAtDoor(focus, info); else this.spawn(focus, info, this.list.length < target * 0.3); }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        const d = Math.hypot(p.x - focus.x, p.z - focus.z);
        if ((!p.officer && d > KILL && !info.visible(p.x, p.y + 1, p.z, 1)) || p.gone) { this.list.splice(i, 1); this.queueRemove(p);
          if(!p.gone && p.job && !p.officer){
            p.awaySince=G.time;p.leader=null;p.partner=null;p.stopIdx=null;
            this.residents.set(p.id,p);
            if(this.residents.size>400)this.residents.delete(this.residents.keys().next().value);
          } }
      }
    }
    const rain = G.world.cur.rain;
    for (const p of this.list) {
      p.t += dt;
      if (p.alpha < 1) p.alpha = Math.min(1, p.alpha + dt);
      if (p.fallT > 0) { p.fallT -= dt; p.fall = p.fallT > 1.2 ? Math.min(1, (p.fall || 0) + dt * 6) : Math.max(0, p.fall - dt * 1.5); p.speedNow = 0; if (p.fallT <= 0) { p.mode = 'walk'; p.pose = 'phone'; p.phoneT = 6; } continue; }
      if (p.reactT > 0) { p.reactT -= dt; p.heading = lerpAngle(p.heading, p.reactHeading, dt * 6); p.pose = p.reactPose; p.speedNow = p.reactPose === 'flee' ? 3.5 : 0; if (p.reactPose === 'flee') { p.x += Math.cos(p.reactHeading + Math.PI) * 3.5 * dt; p.z += Math.sin(p.reactHeading + Math.PI) * 3.5 * dt; } this.ground(p); continue; }
      if (p.phoneT > 0) { p.phoneT -= dt; p.pose = 'phone'; p.speedNow = 0; continue; }
      if(p.mode==='greeting'){
        p.timer-=dt;p.speedNow=0;p.pose='talk';
        if(p.partner)p.heading=Math.atan2(p.partner.z-p.z,p.partner.x-p.x);
        if(p.timer<=0||p.partner?.gone){p.mode='walk';p.partner=null;}
        continue;
      }
      if (p.mode === 'talk') { this.talk(p, dt); continue; }
      if (p.mode === 'queue') { this.queue(p, dt); continue; }
      if (p.mode === 'shelter') { if (rain < 0.15 || p.t > p.shelterUntil) p.mode = 'walk'; p.pose = 'idle'; p.speedNow = 0; continue; }
      if (p.mode === 'cross') { this.cross(p, dt); continue; }
      if (p.mode === 'waitCross') { this.waitCross(p, dt); continue; }
      if (p.mode === 'scene') { this.atScene(p, dt); continue; }
      if (p.mode === 'chase') continue;    // moved by police.js (foot chase)
      if (p.mode === 'toDoor' || p.mode === 'atDoor' || p.mode === 'fromDoor' || p.mode === 'link') { this.doorWalk(p, dt); continue; }
      if (p.corner) { this.corner(p, dt, rain); continue; }
      if (p.leader && !p.leader.gone && p.leader.mode === 'walk') { this.follow(p, dt); continue; }
      if(!p.officer && p.id.startsWith('p') && !p.goal && !(p.planAfter>p.t)){
        this.planDay(p);p.planAfter=p.t+30;
      }
      this.walk(p, dt, rain);
    }
    // gentle separation
    for (let i = 0; i < this.list.length; i++) for (let j = i + 1; j < this.list.length; j++) {
      const a = this.list[i], b = this.list[j]; const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 1e-6 && a.mode !== 'talk' && b.mode !== 'talk') { const d = Math.sqrt(d2), k = (0.6 - d) * 0.5 / d; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
    }
  }
  planDay(p){
    const hour=this.G.world.hours(), role=p.job ||= ['shop assistant','courier','office worker'][Number(p.id.slice(1))%3||0];
    const kind=hour<7||hour>=18?'home':hour>=12&&hour<14?'shop':role==='shop assistant'?'shop':'work';
    const places=[];
    for(const tile of this.G.tiles.tiles.values())for(const site of tile.data?.buildings?.destinations||[]){
      if(site.kind===kind && Math.hypot(site.x-p.x,site.z-p.z)<500)places.push(site);
    }
    for(let attempt=0;attempt<5 && places.length;attempt++){
      const site=(attempt===0 && p[kind+'Site']) || places[Math.floor(this.rand()*places.length)];
      const snap=this.net.nearest(site.x,site.z,65,e=>this.net.walkable(e));
      if(!snap)continue;
      const h=snap.e*2,path=this.net.route(this.net.endNode(p.h),this.net.startNode(h),{walk:true,limit:2500});
      if(!path)continue;
      p[kind+'Site']=site;p.dayPath=[...path,h];p.goal={kind:'routine',x:snap.x,z:snap.z};
      p.activity=kind==='home'?'Home':kind==='shop'&&hour>=12&&hour<14?'Shopping':role;
      return;
    }
  }
  ground(p) { const g = this.G.tiles.ground(p.x, p.z, p.y + 0.3); if (g != null) p.y += (g - p.y) * 0.5; }
  walk(p, dt, rain) {
    const net = this.net, e = p.h >> 1, L = net.len[e];
    const hurry = rain > 0.3 ? 1.35 : 1;
    if (rain > 0.35 && !p.umb) { p.umb = this.rand() < 0.55 ? 1 : -1; }
    if (rain < 0.15) p.umb = 0;
    // shelter seeking in heavy rain when no umbrella
    if (rain > 0.6 && p.umb === -1 && !p.sheltered && this.G.coverNear) {
      const c = this.G.coverNear(p.x, p.z, 40);
      if (c) { p.goal = { kind: 'shelter', x: c[0], z: c[1] }; p.sheltered = true; }
    }
    let sp = p.hurryUntil>p.t ? 3.8 : p.speed*hurry;
    // crossings on this edge: maybe cross the road
    const crs = net.crossByEdge.get(e);
    if (crs && !p.crossCool) for (const c of crs) {
      const cs = (p.h & 1) ? L - c.s : c.s; const d = cs - p.s;
      if (d > 0 && d < sp * dt + 0.05 && (this.rand() < 0.35 || this.wantsOtherSide(p))) { p.mode = 'waitCross'; p.cross = c; p.crossT = 0; this.G.signalsDemand?.(c); return; }
    }
    p.crossCool = Math.max(0, (p.crossCool || 0) - dt);
    p.s += sp * dt;
    // choose the next edge a little before the junction so the corner can be rounded
    const off = this.side(e) ? net.width[e] / 2 + 1.05 : 0, cr = this.side(e) ? Math.min(off + 1.5, L * 0.45) : 0;
    if (p.s >= L - cr && p.nextH == null) p.nextH = this.chooseNext(p);
    if (p.nextH != null && p.nextH.link != null) { if (p.s >= L) { p.mode = 'link'; p.door = { ...p.nextH }; p.nextH = null; } }
    else if (p.nextH != null && cr > 0 && p.s >= L - cr && this.side(p.nextH >> 1) && this.startCorner(p, p.nextH, cr)) { p.nextH = null; return; }
    if (p.s >= L) {
      let next = p.nextH != null && p.nextH.link == null ? p.nextH : this.chooseNext(p); p.nextH = null;
      if (p.goal?.kind === 'routine' && p.dayPath?.length && net.startNode(p.dayPath[0]) === net.endNode(p.h)) next = p.dayPath.shift();
      if (next && next.link != null) { p.mode = 'link'; p.door = { ...next }; p.s = L; return; }
      p.s = Math.max(0, p.s - L); p.h = next;
      if (!net.walkable(p.h >> 1)) { p.h = p.h ^ 1; p.s = 0; }
      // the pavement side flips sign relative to travel when reversing direction
    }
    const [x, z, dx, dz] = this.pos(p);
    p.x += (x - p.x) * Math.min(1, dt * 6); p.z += (z - p.z) * Math.min(1, dt * 6);
    p.heading = lerpAngle(p.heading, Math.atan2(dz, dx), Math.min(1, dt * 6));
    this.ground(p);
    p.speedNow = sp; p.phase = (p.phase + sp * dt * 3.6) % 6.283;
    p.pose = p.umb === 1 ? 'umbrella' : 'walk';
    if (p.goal) {
      const gd = Math.hypot(p.goal.x - p.x, p.goal.z - p.z);
      if (gd < (p.goal.kind === 'door' ? 14 : 6)) {
        if (p.goal.kind === 'door') { p.mode = 'toDoor'; return; }
        if(p.goal.kind==='routine'){
          p.dayPath=null;p.mode='scene';p.sceneT=p.activity==='Shopping'?18:Math.max(65,((p.activity==='Home'?7:18)-this.G.world.hours()+24)%24*3600/Math.max(1,this.G.world.s.scale));
          p.scenePose=p.activity==='Home'?'idle':p.job==='courier'?'phone':'talk';
          p.sceneX=p.x+1;p.sceneZ=p.z;p.planAfter=p.t+p.sceneT+1;
        }
        if (p.goal.kind === 'stop') this.joinQueue(p);
        else if (p.goal.kind === 'shelter') { p.mode = 'shelter'; p.shelterUntil = p.t + 60 + this.rand() * 60; p.x = p.goal.x + (this.rand() - 0.5) * 1.5; p.z = p.goal.z + (this.rand() - 0.5) * 1.5; }
        p.goal = null;
      }
    }
  }
  wantsOtherSide(p) { return p.goal && this.rand() < 0.6; }
  // next half-edge at the end of p.h: mapped footways beat pavements that duplicate them, links join
  // dangling footway ends to the pavement network, goals bias the choice
  chooseNext(p) {
    const net = this.net, e = p.h >> 1, end = net.endNode(p.h), W = this.graph;
    let outs = net.outW[end].filter(h => (h >> 1) !== e);
    const pref = outs.filter(h => !W.hasMappedSidewalk(h >> 1)); if (pref.length) outs = pref;
    const links = W.links.get(end) || [];
    if (links.length && (!outs.length || this.rand() < 0.3)) { const [to] = links[Math.floor(this.rand() * links.length)]; const [x, z] = W.nodeXZ(to); return { link: to, x, z }; }
    let next = outs.length ? outs[Math.floor(this.rand() * outs.length)] : (p.h ^ 1);
    if (p.goal) { let bd = 1e9; for (const h of outs) { net.at(h, Math.min(net.len[h >> 1], 30), this.tmp); const d = Math.hypot(this.tmp[0] - p.goal.x, this.tmp[2] - p.goal.z); if (d < bd) { bd = d; next = h; } } }
    return next;
  }
  // round the pavement corner at a junction mouth: quadratic curve through the kerb corner (mitre point)
  startCorner(p, nh, cr) {
    const net = this.net, h = p.h, L = net.len[h >> 1];
    const a = net.at(h, L, [0, 0, 0, 0, 0]), b = net.at(nh, 0, [0, 0, 0, 0, 0]);
    const ss = p.sideSign, n1x = a[4] * ss, n1z = -a[3] * ss, n2x = b[4] * ss, n2z = -b[3] * ss, k = 1 + n1x * n2x + n1z * n2z;
    if (k < 0.35 || (h >> 1) === (nh >> 1)) return false;                     // too sharp: just walk it
    const o1 = net.width[h >> 1] / 2 + 1.05 + p.lane * 0.6, o2 = net.width[nh >> 1] / 2 + 1.05 + p.lane * 0.6, o = (o1 + o2) / 2;
    const cx = a[0] + (n1x + n2x) * o / k, cz = a[2] + (n1z + n2z) * o / k;
    const r2 = Math.min(o2 + 1.5, net.len[nh >> 1] * 0.45), bb = net.at(nh, r2, [0, 0, 0, 0, 0]);
    const B = [bb[0] + bb[4] * o2 * ss, bb[2] - bb[3] * o2 * ss], A = [p.x, p.z];
    const len = (Math.hypot(cx - A[0], cz - A[1]) + Math.hypot(B[0] - cx, B[1] - cz) + Math.hypot(B[0] - A[0], B[1] - A[1])) / 2;
    if (len > 40) return false;
    p.corner = { A, C: [cx, cz], B, t: 0, len: Math.max(0.5, len), nh, s2: r2 };
    return true;
  }
  corner(p, dt, rain) {
    const c = p.corner, sp = p.speed * (rain > 0.3 ? 1.35 : 1);
    c.t = Math.min(1, c.t + sp * dt / c.len);
    const t = c.t, u = 1 - t;
    const x = u * u * c.A[0] + 2 * u * t * c.C[0] + t * t * c.B[0], z = u * u * c.A[1] + 2 * u * t * c.C[1] + t * t * c.B[1];
    const hd = Math.atan2(z - p.z, x - p.x); if (Math.hypot(x - p.x, z - p.z) > 1e-4) p.heading = lerpAngle(p.heading, hd, Math.min(1, dt * 8));
    p.x = x; p.z = z; this.ground(p);
    p.speedNow = sp; p.phase = (p.phase + sp * dt * 3.6) % 6.283; p.pose = p.umb === 1 ? 'umbrella' : 'walk';
    if (t >= 1) { p.h = c.nh; p.s = c.s2; p.corner = null; }
  }
  // ---------------- buildings: doors (Astra's tile doors when present, else the frontage midpoint)
  doorsNear(x, z, r = 80) {
    const G = this.G, out = [], t = G.tiles.tileAt(x, z);
    const D = t && t.data && t.data.doors;
    if (D && D.length >= 4) {
      for (let i = 0; i + 3 < D.length; i += 4) {
        let dx = D[i], dz = D[i + 1]; if (Math.abs(dx) < 400 && Math.abs(dz) < 400) { dx += t.data.ox; dz += t.data.oz; }   // tile-local -> world
        if (Math.hypot(dx - x, dz - z) < r) out.push({ x: dx, z: dz, shop: !!D[i + 3] });
      }
      if (out.length) return out;
    }
    let n = 0;
    G.tiles.buildingsNear(x, z, r, (P, s, cnt) => {
      if (n++ > 10) return false;
      let best = null, bd = 1e9;
      for (let i = 0, j = cnt - 1; i < cnt; j = i++) {
        const ax = P[(s + j) * 2], az = P[(s + j) * 2 + 1], bx = P[(s + i) * 2], bz = P[(s + i) * 2 + 1], l = Math.hypot(bx - ax, bz - az);
        if (l < 3) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, hit = this.net.nearest(mx, mz, 30, e => this.net.walkable(e));
        if (hit && hit.d < bd) { bd = hit.d; const nx = -(bz - az) / l, nz = (bx - ax) / l, sgn = Math.sign((hit.x - mx) * nx + (hit.z - mz) * nz) || 1; best = { x: mx + nx * sgn * 0.6, z: mz + nz * sgn * 0.6 }; }
      }
      if (best) out.push(best);
    });
    return out;
  }
  toDoor(p) {
    const d = this.doorsNear(p.x, p.z); if (!d.length) return;
    const door = d[Math.floor(this.rand() * d.length)];
    p.goal = { kind: 'door', x: door.x, z: door.z };
  }
  // someone comes out of a building (out of view) and joins the pavement
  spawnAtDoor(focus, info) {
    const a = this.rand() * 6.283, r = 40 + this.rand() * (R - 50);
    const d = this.doorsNear(focus.x + Math.cos(a) * r, focus.z + Math.sin(a) * r, 40);
    if (!d.length) return;
    const door = d[Math.floor(this.rand() * d.length)];
    if (info.visible(door.x, 1, door.z, 1.5)) return;
    const hit = this.net.nearest(door.x, door.z, 40, e => this.net.walkable(e) && !this.graph.hasMappedSidewalk(e)); if (!hit) return;
    const gy = this.G.tiles.ground(door.x, door.z); if (gy == null) return;
    const h = hit.e * 2 + (this.rand() < 0.5 ? 1 : 0), s = (h & 1) ? this.net.len[hit.e] - hit.s : hit.s;
    const p = { id: 'p' + this.nextId++, h, s, sideSign: hit.side >= 0 ? ((h & 1) ? -1 : 1) : ((h & 1) ? 1 : -1), lane: this.rand() * 0.8 - 0.4, look: People.randomLook(this.rand),
      speed: 1.15 + this.rand() * 0.45, mode: 'fromDoor', t: 0, phase: this.rand() * 6, heading: 0, x: door.x, y: gy, z: door.z, visible: true, alpha: 0 };
    const [tx, tz] = this.pos(p); p.door = { x: tx, z: tz };
    this.list.push(p);
  }
  doorWalk(p, dt) {
    const tgt = p.mode === 'atDoor' ? null : p.mode === 'toDoor' ? p.goal : p.door;
    if (p.mode === 'atDoor') {
      // go in once nobody is looking; give up and walk on after a while
      p.speedNow = 0; p.pose = 'idle'; p.doorT = (p.doorT || 0) + dt;
      if (!this.info.visible(p.x, p.y + 1, p.z, 1)) { p.gone = true; this.entered = (this.entered || 0) + 1; }
      else if (p.doorT > 25) { p.mode = 'walk'; p.goal = null; p.doorT = 0; }
      return;
    }
    if (!tgt) { p.mode = 'walk'; return; }
    const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz), sp = p.speed;
    if (d < 0.4) {
      if (p.mode === 'toDoor') { p.mode = 'atDoor'; p.goal = null; return; }
      if (p.mode === 'link') { p.mode = 'walk'; const W = this.graph, outs = this.net.outW[p.door.link] || []; if (outs.length) { p.h = outs[Math.floor(this.rand() * outs.length)]; p.s = 0; } p.door = null; return; }
      p.mode = 'walk'; p.door = null; return;
    }
    const k = Math.min(d, sp * dt); p.x += dx / d * k; p.z += dz / d * k;
    p.heading = lerpAngle(p.heading, Math.atan2(dz, dx), Math.min(1, dt * 8));
    p.speedNow = sp; p.phase = (p.phase + sp * dt * 3.6) % 6.283; p.pose = p.umb === 1 ? 'umbrella' : 'walk';
    this.ground(p);
  }
  follow(p, dt) {
    const l = p.leader;
    const tx = l.x + Math.cos(l.heading + Math.PI / 2) * 0.7, tz = l.z + Math.sin(l.heading + Math.PI / 2) * 0.7;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const sp = Math.min(2.2, d * 2);
    if (d > 0.05) { p.x += dx / d * sp * dt; p.z += dz / d * sp * dt; }
    p.heading = lerpAngle(p.heading, l.heading, dt * 5);
    p.speedNow = sp; p.phase = (p.phase + sp * dt * 3.6) % 6.283; p.pose = l.pose; p.umb = l.umb;
    this.ground(p);
    p.h = l.h; p.s = l.s;
  }
  talk(p, dt) {
    p.timer -= dt; p.pose = 'talk'; p.speedNow = 0;
    if (p.partner) p.heading = Math.atan2(p.partner.z - p.z, p.partner.x - p.x);
    if (p.timer <= 0) { p.mode = 'walk'; if (p.partner && !p.partner.leader && p.partner.partner === p) p.partner.leader = p; p.partner = null; }
  }
  // ---------------- bus stop queues
  joinQueue(p) {
    const g = p.goal; this.queues = this.queues || new Map();
    let q = this.queues.get(g.i); if (!q) this.queues.set(g.i, q = []);
    q.push(p); p.mode = 'queue'; p.stopIdx = g.i;
  }
  queue(p, dt) {
    const q = this.queues.get(p.stopIdx) || [];
    const k = q.indexOf(p), st = this.net.busStops[p.stopIdx];
    const ang = (p.stopIdx * 1.7) % 6.28;
    const tx = st[0] + Math.cos(ang) * (1 + k * 0.85), tz = st[1] + Math.sin(ang) * (1 + k * 0.85);
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.1) { p.x += dx / d * Math.min(d, 1.3 * dt); p.z += dz / d * Math.min(d, 1.3 * dt); p.speedNow = 1.3; p.heading = Math.atan2(dz, dx); }
    else { p.speedNow = 0; p.heading = lerpAngle(p.heading, ang + Math.PI, dt * 3); }
    p.pose = this.G.world.cur.rain > 0.35 && !st[3] ? 'umbrella' : (p.t % 30 < 8 ? 'phone' : 'idle');
    this.ground(p);
    p.phase = (p.phase + p.speedNow * dt * 3.6) % 6.283;
  }
  queueRemove(p) { if (this.queues && p.stopIdx != null) { const q = this.queues.get(p.stopIdx); if (q) { const i = q.indexOf(p); if (i >= 0) q.splice(i, 1); } } }
  // a bus arrived at stop i: board everyone queued, return count
  board(i, bus) {
    const q=this.queues?.get(i)||[], st=this.net.busStops[i];
    bus.passengers ||= [];
    const here=bus.nextStop, remaining=bus.busData.stops.length-1-here;
    const road=this.net.nearest(st[0],st[1],65,e=>this.net.walkable(e));
    for(const trip of bus.passengers.filter(t=>t.to<=here)){
      if(!road)continue;
      const p=trip.actor;
      Object.assign(p,{h:road.e*2,s:road.s,sideSign:road.side||1,lane:0,x:st[0],z:st[1],y:bus.y,
        mode:'walk',goal:null,stopIdx:null,leader:null,partner:null,visible:true,gone:false,crossCool:4});
      this.list.push(p);
    }
    bus.passengers=bus.passengers.filter(t=>t.to>here);
    if(!remaining)return 0;
    let boarded=0;
    for(const p of q.splice(0)){
      if(p.gone)continue;
      this.queueRemove(p);
      const index=this.list.indexOf(p);if(index<0)continue;
      this.list.splice(index,1);p.visible=false;
      bus.passengers.push({actor:p,to:here+1+Math.floor(this.rand()*Math.min(remaining,5))});
      boarded++;
    }
    return boarded;
  }
  // ---------------- crossings
  waitCross(p, dt) {
    const c = p.cross; p.crossT += dt; p.speedNow = 0; p.pose = 'idle';
    { const [, , tdx, tdz] = this.pos(p); p.heading = Math.atan2(p.sideSign * tdx, -p.sideSign * tdz); }
    const G = this.G;
    let go = false;
    if (c.kind === 'signal') {
      const ci = this.controllerFor(c);
      if (ci >= 0) { const a = G.signals.ped(ci); go = a === 'walk'; if (!go) G.signals.press(ci); }
      else go = this.clearRoad(p, c);
    } else if (c.kind === 'zebra') {
      G.traffic.zebraBusy.set((p.h >> 1) + ':' + Math.round(c.s), G.signals.t + 1);
      go = this.clearRoad(p, c, 14);
    } else go = this.clearRoad(p, c, 28);

    if (go) { p.mode = 'cross'; p.crossProg = 0; p.cx0 = p.x; p.cz0 = p.z; const w = this.net.width[p.h >> 1] / 2 + 1.05; const [, , tdx, tdz] = this.pos(p); p.cdx = -2 * w * p.sideSign * tdz; p.cdz = 2 * w * p.sideSign * tdx; if (c.kind === 'zebra' || c.kind === 'uncontrolled') G.traffic.zebraBusy.set((p.h >> 1) + ':' + Math.round(c.s), G.signals.t + 12); }
  }
  cross(p, dt) {
    const c = p.cross;
    this.G.traffic.zebraBusy.set((p.h >> 1) + ':' + Math.round(c.s), this.G.signals.t + 1);
    const len = Math.hypot(p.cdx, p.cdz) || 1;
    p.crossProg += p.speed * 1.1 * dt / len;
    p.x = p.cx0 + p.cdx * Math.min(1, p.crossProg); p.z = p.cz0 + p.cdz * Math.min(1, p.crossProg);
    p.heading = Math.atan2(p.cdz, p.cdx); p.speedNow = p.speed * 1.1; p.phase = (p.phase + p.speedNow * dt * 3.6) % 6.283; p.pose = p.umb === 1 ? 'umbrella' : 'walk';
    this.ground(p);
    if (p.crossProg >= 1) { p.mode = 'walk'; p.sideSign *= -1; p.crossCool = 4; }
  }
  controllerFor(c) {
    if (c._ci !== undefined) return c._ci;
    let best = -1, bd = 70;
    this.net.controllers.forEach((k, i) => { for (const [x,z] of k.peds) { const d=Math.hypot(x-c.x,z-c.z); if(d<bd){bd=d;best=i;} } });
    return (c._ci = best);
  }
  clearRoad(p, c, dist = 22) {
    for (const v of this.G.traffic.list) {
      if (v.parked) continue;
      const d = Math.hypot(v.x - c.x, v.z - c.z);
      if (d < dist && (v.v || Math.abs(v.sp || 0)) > 0.8) return false;
    }
    return true;
  }
  slowTraffic(p, c) { for (const v of this.G.traffic.list) { const d = Math.hypot(v.x - c.x, v.z - c.z); if (d < 10 && (v.v || 0) > 2) return false; } return true; }
  atScene(p, dt) { p.speedNow = 0; p.pose = p.scenePose || 'idle'; p.heading = Math.atan2(p.sceneZ - p.z, p.sceneX - p.x); p.sceneT -= dt; if (p.sceneT <= 0) p.mode = 'walk'; }
  // ---------------- reactions
  horn({ x, z, v }) {
    for (const p of this.list) {
      const d = Math.hypot(p.x - x, p.z - z); if (d > 18) continue;
      p.reactT = 1.2 + this.rand(); p.reactHeading = Math.atan2(z - p.z, x - p.x); p.reactPose = d < 6 ? 'flee' : 'point';
    }
  }
  disturb(x, z, r, kind) {
    for (const p of this.list) {
      const d = Math.hypot(p.x - x, p.z - z); if (d > r || p.fallT > 0) continue;
      p.reactT = 2 + this.rand() * 2; p.reactHeading = Math.atan2(z - p.z, x - p.x); p.reactPose = d < 8 ? 'flee' : this.rand() < 0.3 ? 'phone' : 'point';
    }
  }
  sweep({ v, x, z, speed }) {
    if (speed < 1.5) return;
    for (const p of this.list) {
      const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz > 16) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) < v.def.L / 2 + 0.3 && Math.abs(lz) < v.def.W / 2 + 0.3 && !(p.fallT > 0)) {
        p.fallT = 3.5; p.fall = 0; p.x += -s * Math.sign(lz || 1) * 1.2; p.z += c * Math.sign(lz || 1) * 1.2;
        this.G.events.emit('pedHit', { p, v, speed });
        this.disturb(p.x, p.z, 35, 'hit');
      }
    }
  }
  // witnesses near (x,z)
  near(x, z, r) { return this.list.filter(p => Math.hypot(p.x - x, p.z - z) < r && !(p.fallT > 0)); }
  draw(people, extra, cam, dt) {
    const arr = this.list.concat(extra);
    return people.draw(arr, cam, this.G.budget?.peopleDist || 170, dt);
  }
}
