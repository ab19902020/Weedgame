// Parked cars from tile parking slots (stable ids), the brothers' own cars, and bus services
// that run the OSM bus-route relations with stops and dwell times.
import { MODELS, PAINTS, randomModel, paintFor } from './vehicles.js';
import { mulberry } from './traffic.js';

export class Parking {
  constructor(G) {
    this.G = G;
    this.byKey = new Map();   // tile key -> its parked cars (a tile swapping LOD replaces its object without an unload event)
    G.tiles.listeners.push((ev, t) => ev === 'load' ? this.onLoad(t) : this.onUnload(t));
  }
  onLoad(t) {
    const prev = this.byKey.get(t.key);
    if (prev && t.lod === 0) { t.parked = prev; return; }          // reloaded at LOD0: keep the same cars
    if (prev) { this.removeAll(prev); this.byKey.delete(t.key); }  // dropped to LOD1: the cars go with the detail
    if (t.lod !== 0 || !t.data.slots) return;
    const G = this.G, S = t.data.slots, K = t.data.slotKind;
    t.parked = []; this.byKey.set(t.key, t.parked);
    for (let i = 0; i < S.length / 4; i++) {
      const id = `p:${t.key}:${i}`;
      if (G.save.taken.has(id) || G.traffic.byId.has(id)) continue;
      const r = mulberry(hashStr(id))();
      const occ = K[i] ? 0.14 : 0.21;     // half the old car parks / kerbside fill
      if (r > occ) continue;
      const r2 = mulberry(hashStr(id) ^ 0x5bd1e995);
      const roll = r2();
      const model = (!K[i] && roll < 0.12) ? (roll < .035 ? 'dirtbike' : roll < .07 ? 'motorcycle' : roll < .085 ? 'moped' : roll < .099 ? 'bicycle' : roll < .110 ? 'ebike' : 'escooter') : randomModel(r2());
      const x = S[i * 4] + t.data.ox, z = S[i * 4 + 2] + t.data.oz;
      if (this.blocked(x, z)) continue;
      const v = G.traffic.add({ id, kind: 'parked', model, paint: paintFor(model, r2()), x, y: S[i * 4 + 1], z, heading: S[i * 4 + 3], parked: true, v: 0 });
      v.y = G.tiles.ground(x, z) ?? v.y;
      t.parked.push(v);
    }
  }
  blocked(x, z) {
    for (const v of this.G.traffic.list) if (v.parked && Math.abs(v.x - x) < 3 && Math.abs(v.z - z) < 3) return true;
    return false;
  }
  removeAll(list) { for (const v of list) if (!v.free && !v.player && v.parked) this.G.traffic.remove(v); }
  onUnload(t) {
    const list = t.parked || this.byKey.get(t.key); this.byKey.delete(t.key);
    if (!list) return;
    this.removeAll(list);
    t.parked = null;
  }
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export class Buses {
  constructor(G) {
    this.G = G; this.timer = 2; this.rand = mulberry(31);
    const net = G.net;
    // Index mapped kerbside stops once. Infer calls only on matching directed roads.
    const stopsByDirection = new Map();
    net.busStops.forEach(([x,z],si) => {
      const snap = net.nearest(x,z,22,e => (net.flags[e]&(16|128)) && !/motorway|trunk/.test(net.clsName(e)));
      if (!snap || snap.d > net.width[snap.e]/2+9) return;
      const reverse = snap.side < 0;
      if (reverse && (net.flags[snap.e]&1)) return;
      const h = snap.e*2+Number(reverse);
      if (!stopsByDirection.has(h)) stopsByDirection.set(h,[]);
      stopsByDirection.get(h).push({si,s:reverse ? net.len[snap.e]-snap.s : snap.s});
    });
    // Some imported relations traverse ordinary one-way streets backwards. Bridge each
    // illegal run over directed roads, or keep its two valid sections separate.
    const sections=[];
    for (const r of net.routes) {
      const input=r.seq.map(([e,d])=>2*e+(d===1?0:1));
      const allowed=h=>net.outD[net.startNode(h)].includes(h) || ((net.flags[h>>1]&128) && !(h&1));
      let hs=[], changed=false;
      const flush=()=>{if(hs.length)sections.push({...r,hs,stops:changed?[]:r.stops});hs=[];};
      for(let k=0;k<input.length;) {
        if(allowed(input[k])) {hs.push(input[k++]);continue;}
        changed=true;
        const start=k;
        while(k<input.length && !allowed(input[k]))k++;
        const path=net.route(net.startNode(input[start]),net.endNode(input[k-1]));
        if(path)hs.push(...path);else flush();
      }
      flush();
    }
    this.cursor=0;
    this.routes = sections.map((r, i) => {
      const hs=r.hs;
      const cum = [0]; for (const h of hs) cum.push(cum[cum.length - 1] + net.len[h >> 1]);
      // stop positions -> route distance (fallback: snap bus_stop nodes near the path)
      let stops = r.stops.map(([si, d]) => ({ si, d }));
      if (!stops.length) {
        hs.forEach((h,k) => {
          for (const stop of stopsByDirection.get(h) || []) stops.push({si:stop.si,d:cum[k]+stop.s,inferred:true});
        });
      }
      stops.sort((a,b)=>a.d-b.d);
      return { i, ref: r.ref, name: r.name, colour: parseColour(r.colour), hs, cum, stops, len: cum[cum.length - 1] };
    }).filter(r => r.hs.length > 0 && r.len > 0);
  }
  update(dt, focus, info) {
    this.timer -= dt; if (this.timer > 0) return; this.timer = 6;
    const G = this.G, net = G.net;
    const buses = G.traffic.list.filter(v => v.kind === 'bus');
    for (const b of buses) if ((b.notInService || (b.ri >= b.route.length - 1 && b.v < 0.1)) && !b.player && !info.visible(b.x, b.y, b.z, 4)) G.traffic.remove(b);
    if (buses.length >= 14) return;
    for (let count=0;count<this.routes.length;count++) {
      const r=this.routes[this.cursor];
      this.cursor=(this.cursor+1)%this.routes.length;
      if (buses.some(b => b.busRoute === r.i && Math.hypot(b.x - focus.x, b.z - focus.z) < 900)) continue;
      // find route points near the focus; spawn ~350-550 m upstream, out of view
      let best = null;
      for (let k = 0; k < r.hs.length; k++) {
        net.at(r.hs[k], 0, this._t || (this._t = [0, 0, 0, 0, 0]));
        const d = Math.hypot(this._t[0] - focus.x, this._t[2] - focus.z);
        if (d > 320 && d < 620 && !info.visible(this._t[0], this._t[1], this._t[2], 5)) {
          // only if the route later passes near the focus
          let passes = false;
          for (let j = k; j < Math.min(r.hs.length, k + 40); j++) { net.at(r.hs[j], 0, this._t); if (Math.hypot(this._t[0] - focus.x, this._t[2] - focus.z) < 200) { passes = true; break; } }
          if (passes) { best = k; break; }
        }
      }
      if (best == null) continue;
      const deck = /^(1[0-9]|2|3|4|5|9|17)$/.test(r.ref) ? 'bus' : (this.rand() < 0.5 ? 'bus' : 'busS');
      const v = G.traffic.spawnAt(r.hs[best], 1, { kind: 'bus', model: deck, paint: r.colour, route: r.hs, ri: best });
      v.fixedRoute = true; v.busRoute = r.i; v.ref = r.ref; v.persistent = true; v.v0f = 0.85;
      v.nextStop = r.stops.findIndex(s => s.d > r.cum[best] + 5);
      v.busData = r;
      buses.push(v);
      if (buses.length >= 14) break;
    }
  }
  // called from traffic.drive through stopAtFn
  stopFor(v) {
    const r = v.busData; if (!r || v.nextStop == null || v.nextStop < 0 || v.nextStop >= r.stops.length) return 1e9;
    const pos = r.cum[v.ri] + v.s, st = r.stops[v.nextStop];
    const d = st.d - pos;
    if (d < -3) { v.nextStop++; return 1e9; }
    if (d < (v.s0 || 2) + 1.2 && v.v < 0.3) {
      v.dwell = (v.dwell || 0) + this.G.dt;
      if (!v.served) { v.served = true; const n = this.G.peds.board(st.si, v); v.dwellFor = 8 + n * 2.5; }
      if (v.dwell > (v.dwellFor || 10)) { this.G.audio?.departure?.('busDepart',v.x,v.y,v.z); v.nextStop++; v.dwell = 0; v.served = false; return 1e9; }
      return 0.01;
    }
    return d < 60 ? d : 1e9;
  }
}
function parseColour(c) {
  if (!c) return 0x6b2a8a;
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (m) return parseInt(m[1], 16);
  const named = { purple: 0x6b2a8a, red: 0xb3202a, blue: 0x1e4fa3, green: 0x2a7a3a, yellow: 0xd8b400, orange: 0xe07a10, pink: 0xd0508a, brown: 0x7a4a2a, grey: 0x777777, gray: 0x777777, black: 0x222222, white: 0xeeeeee, lime: 0x80c020, navy: 0x1a2a5a, maroon: 0x6a1a2a, teal: 0x1a7a7a, gold: 0xc8a030 };
  return named[c.toLowerCase()] ?? 0x6b2a8a;
}
