// Global road / footway graph: geometry queries, junction control data and routing.
export const F_ONEWAY = 1, F_ROUNDABOUT = 2, F_BRIDGE = 4, F_TUNNEL = 8, F_DRIVE = 16, F_BUS = 128;
const CELL = 50;

export class Network {
  constructor({ header, arrays }) {
    Object.assign(this, arrays);
    this.names = header.names;
    this.classes = header.classes;
    this.controllers = header.controllers;
    this.crossings = header.crossings;
    this.busStops = header.busStops;
    this.routes = header.routes;
    this.nEdges = this.ea.length;
    this.nNodes = this.nodes.length / 3;
    const nP = this.pts.length / 3;
    this.cum = new Float32Array(nP);
    for (let e = 0; e < this.nEdges; e++) {
      const s = this.pstart[e], n = this.pcount[e];
      let acc = 0; this.cum[s] = 0;
      for (let i = 1; i < n; i++) {
        const a = (s + i - 1) * 3, b = (s + i) * 3;
        acc += Math.hypot(this.pts[b] - this.pts[a], this.pts[b + 2] - this.pts[a + 2]);
        this.cum[s + i] = acc;
      }
      this.len[e] = acc;
    }
    // class helpers
    this.walkCls = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'track', 'corridor'].map(c => this.classes.indexOf(c)));
    this.clsName = e => this.classes[this.cls[e]];
    // adjacency
    const outD = Array.from({ length: this.nNodes }, () => []);
    const outW = Array.from({ length: this.nNodes }, () => []);
    for (let e = 0; e < this.nEdges; e++) {
      const a = this.ea[e], b = this.eb[e], f = this.flags[e];
      if (f & F_DRIVE) {
        outD[a].push(e * 2);              // forward (a->b), encoded e*2+0
        if (!(f & F_ONEWAY)) outD[b].push(e * 2 + 1); // backward
      }
      if (this.walkable(e)) { outW[a].push(e * 2); outW[b].push(e * 2 + 1); }
    }
    this.outD = outD; this.outW = outW;
    this.inD = Array.from({ length: this.nNodes }, () => []);
    for (let n = 0; n < this.nNodes; n++) for (const h of outD[n]) this.inD[this.endNode(h)].push(h);
    // spatial grid of segments
    this.grid = new Map();
    for (let e = 0; e < this.nEdges; e++) {
      const s = this.pstart[e], n = this.pcount[e], pad = this.width[e] / 2 + 3;
      for (let i = 0; i < n - 1; i++) {
        const a = (s + i) * 3, b = a + 3;
        const x0 = Math.min(this.pts[a], this.pts[b]) - pad, x1 = Math.max(this.pts[a], this.pts[b]) + pad;
        const z0 = Math.min(this.pts[a + 2], this.pts[b + 2]) - pad, z1 = Math.max(this.pts[a + 2], this.pts[b + 2]) + pad;
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
          for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
            const k = cx * 65536 + cz;
            let l = this.grid.get(k); if (!l) this.grid.set(k, l = []);
            l.push(e, i);
          }
      }
    }
    // regroup junction approaches into stages by road axis: approaches whose axes are within
    // 32 degrees share a stage (opposing arms together), so multi-arm junctions get 2-4 stages.
    const tmpP = [0, 0, 0, 0, 0];
    for (const c of this.controllers) {
      if (c.standalone || c.approaches.length < 2) continue;
      const axes = c.approaches.map(a => { const h = a[0] * 2 + (a[1] === 1 ? 0 : 1); this.at(h, Math.max(0, a[2] - 3), tmpP); let ang = Math.atan2(tmpP[4], tmpP[3]); ang = ((ang % Math.PI) + Math.PI) % Math.PI; return ang; });
      const groups = [];
      axes.forEach((ang, k) => {
        let g = groups.findIndex(gr => { let d = Math.abs(ang - gr); d = Math.min(d, Math.PI - d); return d < 0.56; });
        if (g < 0 || groups.length >= 4 && g < 0) { if (groups.length < 4) { groups.push(ang); g = groups.length - 1; } else g = groups.length - 1; }
        c.approaches[k][3] = g;
      });
      c.groups = Math.max(1, groups.length);
      const rank = { motorway: 10, trunk: 9, primary: 8, secondary: 7, tertiary: 6, unclassified: 4, residential: 3 };
      c.green = Array.from({ length: c.groups }, (_, g) => { let r = 0; for (const a of c.approaches) if (a[3] === g) r = Math.max(r, rank[this.classes[this.cls[a[0]]].replace('_link', '')] || 3); return Math.round(14 + 3 * r); });
    }
    // signal approach lookup: per half-edge -> [controller, group, stopDistance]
    this.stopAt = new Map();
    this.controllers.forEach((c, ci) => {
      for (const [e, d, stop, g] of c.approaches) {
        const h=e*2+(d===1 ? 0 : 1);
        if (!this.stopAt.has(h)) this.stopAt.set(h,[]);
        this.stopAt.get(h).push([ci,g,stop]);
      }
    });
    this.crossByEdge = new Map();
    for (const c of this.crossings) {
      const [e, idx, kind] = c;
      if (!this.crossByEdge.has(e)) this.crossByEdge.set(e, []);
      this.crossByEdge.get(e).push({ s: this.cum[this.pstart[e] + idx], kind, x: c[3], z: c[4], h: c[5], w: c[6] });
    }
  }
  walkable(e) { return this.walkCls.has(this.cls[e]) || (this.pav[e] && !(this.flags[e] & F_TUNNEL)); }
  roadName(e) { return this.names[this.name[e]] || this.names[this.ref[e]] || ''; }
  endNode(h) { const e = h >> 1; return (h & 1) ? this.ea[e] : this.eb[e]; }
  startNode(h) { const e = h >> 1; return (h & 1) ? this.eb[e] : this.ea[e]; }
  // lanes in this direction (UK). A two-way road that only tags one direction still splits in half,
  // so neither direction is given the whole carriageway.
  laneCount(h) {
    const e = h >> 1, f = this.lanesF[e] | 0, b = this.lanesB[e] | 0;
    if (this.flags[e] & F_ONEWAY) return Math.max(1, f + b);
    if (f > 0 && b > 0) return Math.max(1, (h & 1) ? b : f);
    const tot = Math.max(f, b, 2), backN = Math.max(1, Math.floor(tot / 2)), fwdN = Math.max(1, tot - backN);
    return (h & 1) ? backN : fwdN;
  }
  // position along half-edge h at distance s from its start; writes [x,y,z,dirx,dirz]
  at(h, s, out) {
    const e = h >> 1, rev = h & 1, L = this.len[e];
    let d = rev ? L - s : s;
    d = Math.max(0, Math.min(L, d));
    const st = this.pstart[e], n = this.pcount[e], cum = this.cum;
    let lo = st, hi = st + n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / seg;
    const a = lo * 3, b = hi * 3, P = this.pts;
    out[0] = P[a] + (P[b] - P[a]) * t; out[1] = P[a + 1] + (P[b + 1] - P[a + 1]) * t; out[2] = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
    let dx = (P[b] - P[a]) / seg, dz = (P[b + 2] - P[a + 2]) / seg;
    if (rev) { dx = -dx; dz = -dz; }
    out[3] = dx; out[4] = dz;
    return out;
  }
  // Nearest segment to (x,z). filter(e) -> bool. Returns {e, s (along a->b), d, x, y, z, dx, dz, side}
  nearest(x, z, maxD = 40, filter = null) {
    let best = null, bd = maxD * maxD;
    const r = Math.ceil(maxD / CELL);
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL), P = this.pts;
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
      const l = this.grid.get(cx * 65536 + cz); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const e = l[k], i = l[k + 1];
        if (filter && !filter(e)) continue;
        const a = (this.pstart[e] + i) * 3, b = a + 3;
        const ax = P[a], az = P[a + 2], vx = P[b] - ax, vz = P[b + 2] - az;
        const L2 = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + vx * t, pz = az + vz * t, d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) {
          bd = d;
          const L = Math.sqrt(L2);
          best = { e, i, t, d: Math.sqrt(d), x: px, z: pz, y: P[a + 1] + (P[b + 1] - P[a + 1]) * t,
            s: this.cum[this.pstart[e] + i] + t * L, dx: vx / L, dz: vz / L,
            side: Math.sign((x - px) * (vz / L) - (z - pz) * (vx / L)) };
        }
      }
    }
    return best;
  }
  // Surface candidates (road decks) under (x,z): returns array of heights within half-width
  decks(x, z, out) {
    out.length = 0;
    const l = this.grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)); if (!l) return out;
    const P = this.pts;
    for (let k = 0; k < l.length; k += 2) {
      const e = l[k], i = l[k + 1];
      if (!(this.flags[e] & F_BRIDGE)) {
        // roads raised to meet a bridge (roadProfile.js) ride on their own surface, whether an embankment
        // or an approach slab carries them, and so do an approach slab and a deck over sagging ground (tiles.js)
        const j = this.pstart[e] + i, raised = (this.rise && (this.rise[j] > 0.06 || this.rise[j + 1] > 0.06)) || (this.connector && this.connector[e]) || (this.sagDeck && this.sagDeck.has(j));
        const rs = this.slabRange?.get(e);
        if (!raised && !(rs && rs.some(r => this.cum[j + 1] >= r[0] && this.cum[j] <= r[1]))) continue;
      }
      const a = (this.pstart[e] + i) * 3, b = a + 3;
      const ax = P[a], az = P[a + 2], vx = P[b] - ax, vz = P[b + 2] - az, L2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / L2; if (t < -0.05 || t > 1.05) continue; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d <= this.width[e] / 2 + 0.6) out.push(P[a + 1] + (P[b + 1] - P[a + 1]) * t + 0.05);
    }
    return out;
  }
  // A* over half-edges for driving. Returns array of half-edges from node a to node b.
  route(a, b, opts = {}) {
    if (a === b) return [];
    // A* in reusable typed arrays (v0.36): the old one allocated a little array per heap entry and per swap and
    // grew two Maps, megabytes of garbage a second with traffic routing as it drives, which the phone paid for in
    // collection pauses. Same costs, same search, same result.
    const N = this.nodes, bx = N[b * 3], bz = N[b * 3 + 2], nN = this.nNodes;
    let S = this._astar;
    if (!S || S.g.length < nN) S = this._astar = { g: new Float64Array(nN), came: new Int32Array(nN), stamp: new Uint32Array(nN), id: 0, hc: new Float64Array(1024), hn: new Int32Array(1024) };
    const id = ++S.id; if (id === 0xffffffff) { S.stamp.fill(0); S.id = 1; }
    const g = S.g, came = S.came, stamp = S.stamp;
    let hc = S.hc, hn = S.hn, hl = 0;
    const walk = !!opts.walk, out = walk ? this.outW : this.outD, svc = this._svc ??= this.classes.indexOf('service'), noSvc = !walk && opts.noService;
    const dist = n => { const dx = N[n * 3] - bx, dz = N[n * 3 + 2] - bz; return Math.sqrt(dx * dx + dz * dz); };
    const push = (c, n) => {
      if (hl === hc.length) { const c2 = new Float64Array(hl * 2), n2 = new Int32Array(hl * 2); c2.set(hc); n2.set(hn); S.hc = hc = c2; S.hn = hn = n2; }
      let i = hl++;
      while (i) { const p = (i - 1) >> 1; if (hc[p] <= c) break; hc[i] = hc[p]; hn[i] = hn[p]; i = p; }
      hc[i] = c; hn[i] = n;
    };
    const pop = () => {
      const top = hn[0]; hl--;
      if (hl) {
        const c = hc[hl], n = hn[hl]; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = -1, mc = c; if (l < hl && hc[l] < mc) { m = l; mc = hc[l]; } if (r < hl && hc[r] < mc) { m = r; mc = hc[r]; } if (m < 0) break; hc[i] = hc[m]; hn[i] = hn[m]; i = m; }
        hc[i] = c; hn[i] = n;
      }
      return top;
    };
    stamp[a] = id; g[a] = 0; came[a] = -1;
    push(dist(a) / 30, a);
    let iter = 0, found = false;
    const limit = opts.limit || 60000;
    while (hl && iter++ < limit) {
      const n = pop();
      if (n === b) { found = true; break; }
      const gn = g[n], outs = out[n];
      for (let k = 0; k < outs.length; k++) {
        const h = outs[k], e = h >> 1;
        if (noSvc && this.cls[e] === svc) continue;
        const m = this.endNode(h);
        const sp = walk ? 1.4 : Math.max(4, this.speed[e] / 3.6) * (this.cls[e] === 13 ? 0.5 : 1);
        const c = gn + this.len[e] / sp + (walk ? 0 : 2);
        if (stamp[m] !== id || c < g[m]) {
          stamp[m] = id; g[m] = c; came[m] = h;
          push(c + dist(m) / (walk ? 1.4 : 31), m);
        }
      }
    }
    if (!found && !(stamp[b] === id && came[b] >= 0)) return null;
    const path = [];
    for (let n = b; n !== a;) { const h = came[n]; if (h < 0) return null; path.push(h); n = this.startNode(h); if (path.length > 5000) return null; }
    return path.reverse();
  }
}
