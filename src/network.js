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
  laneCount(h) { const e = h >> 1; return Math.max(1, (h & 1) ? this.lanesB[e] : this.lanesF[e]); }
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
    const N = this.nodes, bx = N[b * 3], bz = N[b * 3 + 2];
    const g = new Map([[a, 0]]), came = new Map();
    const heap = [[Math.hypot(N[a * 3] - bx, N[a * 3 + 2] - bz) / 30, a]];
    const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let iter = 0;
    const out = opts.walk ? this.outW : this.outD;
    while (heap.length && iter++ < (opts.limit || 60000)) {
      const [, n] = pop();
      if (n === b) break;
      const gn = g.get(n);
      for (const h of out[n]) {
        const e = h >> 1;
        if (!opts.walk && this.cls[e] === this.classes.indexOf('service') && opts.noService) continue;
        const m = this.endNode(h);
        const sp = opts.walk ? 1.4 : Math.max(4, this.speed[e] / 3.6) * (this.cls[e] === 13 ? 0.5 : 1);
        const c = gn + this.len[e] / sp + (opts.walk ? 0 : 2);
        if (c < (g.get(m) ?? Infinity)) {
          g.set(m, c); came.set(m, h);
          push([c + Math.hypot(N[m * 3] - bx, N[m * 3 + 2] - bz) / (opts.walk ? 1.4 : 31), m]);
        }
      }
    }
    if (!came.has(b)) return null;
    const path = [];
    for (let n = b; n !== a;) { const h = came.get(n); path.push(h); n = this.startNode(h); if (path.length > 5000) return null; }
    return path.reverse();
  }
}
