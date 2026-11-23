// Walk graph for pedestrians and the test harness. Built on the network's walkable half-edges (mapped
// footways, paths and road pavements) plus "links" that join dangling footway ends to the nearest
// pavement or footway node, so separately mapped OSM footways connect to road pavements.
// Pure logic (no rendering), usable in Node for tests.
export const LINK_R = 22;

export class WalkGraph {
  constructor(net) {
    this.net = net;
    this.links = new Map();                       // node -> [[node, length]]
    this.mapped = new Int8Array(net.nEdges).fill(-1);   // road edge has a parallel mapped footway (lazy)
    this.tmp = [0, 0, 0, 0, 0];
    this.buildLinks();
  }
  isFoot(e) { return this.net.walkCls.has(this.net.cls[e]); }
  nodeXZ(n) { const N = this.net.nodes; return [N[n * 3], N[n * 3 + 2]]; }
  buildLinks() {
    const net = this.net; let n = 0;
    for (let a = 0; a < net.nNodes; a++) {
      const o = net.outW[a]; if (o.length !== 1 || !this.isFoot(o[0] >> 1)) continue;
      const own = o[0] >> 1, [x, z] = this.nodeXZ(a);
      const hit = net.nearest(x, z, LINK_R, e => e !== own && net.walkable(e) && net.ea[e] !== a && net.eb[e] !== a);
      if (!hit) continue;
      // link to the nearer end of the edge we found (graph nodes only)
      const ea = net.ea[hit.e], eb = net.eb[hit.e], [ax, az] = this.nodeXZ(ea), [bx, bz] = this.nodeXZ(eb);
      const da = Math.hypot(ax - x, az - z), db = Math.hypot(bx - x, bz - z);
      const b = da <= db ? ea : eb, d = Math.min(da, db);
      if (d > LINK_R * 2.5 || b === a) continue;
      this.addLink(a, b, d); n++;
    }
    this.linkCount = n;
  }
  addLink(a, b, d) { for (const [p, q] of [[a, b], [b, a]]) { let l = this.links.get(p); if (!l) this.links.set(p, l = []); l.push([q, d]); } }
  // does road edge e have its own separately mapped sidewalk running alongside? (cached)
  hasMappedSidewalk(e) {
    const m = this.mapped[e]; if (m >= 0) return m === 1;
    const net = this.net;
    if (this.isFoot(e) || !net.pav[e]) { this.mapped[e] = 0; return false; }
    const L = net.len[e], w = net.width[e] / 2 + 7; let hits = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      net.at(e * 2, L * f, this.tmp); const x = this.tmp[0], z = this.tmp[2], dx = this.tmp[3], dz = this.tmp[4];
      const hit = net.nearest(x, z, w, k => this.isFoot(k));
      if (hit && Math.abs(hit.dx * dx + hit.dz * dz) > 0.85) hits++;
    }
    this.mapped[e] = hits >= 2 ? 1 : 0;
    return hits >= 2;
  }
  // cost of walking half-edge h (roads whose sidewalk is mapped separately cost more, so routes use the footway)
  cost(h) { const e = h >> 1; return this.net.len[e] * (this.hasMappedSidewalk(e) ? 1.8 : 1); }
  nearestNode(x, z, maxD = 120) {
    const net = this.net, hit = net.nearest(x, z, maxD, e => net.walkable(e)); if (!hit) return null;
    const a = net.ea[hit.e], b = net.eb[hit.e], [ax, az] = this.nodeXZ(a), [bx, bz] = this.nodeXZ(b);
    return Math.hypot(ax - x, az - z) <= Math.hypot(bx - x, bz - z) ? a : b;
  }
  // A* from node a to node b. Returns steps: { h } for a half-edge or { link: node } for a link, or null.
  route(a, b, limit = 80000) {
    if (a === b) return [];
    const net = this.net, [bx, bz] = this.nodeXZ(b);
    const g = new Map([[a, 0]]), came = new Map();
    const heap = [[0, a]];
    const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let it = 0;
    while (heap.length && it++ < limit) {
      const [, n] = pop(); if (n === b) break;
      const gn = g.get(n);
      const relax = (m, c, step) => { if (c < (g.get(m) ?? Infinity)) { g.set(m, c); came.set(m, step); const [mx, mz] = this.nodeXZ(m); push([c + Math.hypot(mx - bx, mz - bz), m]); } };
      for (const h of net.outW[n]) relax(net.endNode(h), gn + this.cost(h), { h, from: n });
      for (const [m, d] of this.links.get(n) || []) relax(m, gn + d * 1.2, { link: m, from: n });
    }
    if (!came.has(b)) return null;
    const out = [];
    for (let n = b; n !== a;) { const st = came.get(n); out.push(st); n = st.from; if (out.length > 20000) return null; }
    return out.reverse();
  }
  // walking polyline between two points: pavement side (left of travel) on roads, centre line on footways
  path(x0, z0, x1, z1) {
    const a = this.nearestNode(x0, z0), b = this.nearestNode(x1, z1);
    if (a == null || b == null) return null;
    const steps = this.route(a, b); if (!steps) return null;
    const net = this.net, pts = [[x0, z0]];
    for (const st of steps) {
      if (st.link != null) { pts.push(this.nodeXZ(st.link)); continue; }
      const e = st.h >> 1, L = net.len[e], off = this.isFoot(e) ? 0 : net.width[e] / 2 + 1.2;
      for (let s = 0; s <= L; s += Math.max(4, L / 12)) { net.at(st.h, s, this.tmp); pts.push([this.tmp[0] + this.tmp[4] * off, this.tmp[2] - this.tmp[3] * off]); }
      net.at(st.h, L, this.tmp); pts.push([this.tmp[0] + this.tmp[4] * off, this.tmp[2] - this.tmp[3] * off]);
    }
    pts.push([x1, z1]);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { pts, steps: steps.length, length: len };
  }
}
