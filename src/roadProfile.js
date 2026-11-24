// Road geometry repairs applied once when the network loads: missing motorway bridges and the vertical
// alignment of every bridge, flyover and approach.
//
// The world pipeline gave each bridge deck the LIDAR ground height at its two end points and then raised
// it wherever a "lower" road crossed it. The roads leading onto a bridge touch it at its ends, so they
// counted as roads passing underneath: almost every deck was lifted ~5.6 m above its own approaches,
// split bridges got different heights per piece, and the approach roads stayed on the ground with only
// their last point lifted (a cliff on screen, a 50 % ramp for traffic). alignRoads rebuilds the profile:
//   * a deck spans between the embankment crests the LIDAR ground already shows beside its ends; the
//     pieces of a split bridge (and short ordinary links between spans) are solved together so they meet;
//   * it rises only where a road or railway that really passes underneath needs headroom;
//   * roads leading onto a deck that ends above the ground climb to it at a steady grade for their class
//     (motorways 3 %), through junctions where needed. `net.rise` (metres above the ground per network
//     point) tells the tile worker where to build an earth embankment under them.
// Heights are written back into net.pts / net.nodes, so traffic, the player, markings and the tile
// worker all see one road surface.

const F_ONEWAY = 1, F_BRIDGE = 4, F_TUNNEL = 8, F_DRIVE = 16;
const CREST_MIN = 1.5, CREST_MAX = 14;           // ground samples beside a bridge end used for its crest
const CLEAR_ROAD = 6.3, CLEAR_RAIL = 6.6;          // deck top above a road / railway beneath (headroom + structure)
const DECK_GRADE = 0.04;                           // a deck raised for headroom falls away at this grade
const CONNECTOR = 60;                              // ordinary links up to this long between two spans ride with them
const GRADE = {
  motorway: 0.03, motorway_link: 0.04, trunk: 0.035, trunk_link: 0.045, primary: 0.045, primary_link: 0.05,
  secondary: 0.05, secondary_link: 0.055, tertiary: 0.06, tertiary_link: 0.06, unclassified: 0.065,
  residential: 0.07, living_street: 0.07, service: 0.08, busway: 0.05, bus_guideway: 0.05, steps: 0.6,
};
const WALK_GRADE = 0.1;                            // ramps up to footbridges
// steepest a deck may run (a steeper one is lifted at its low end and the approach takes the climb)
const DECK_MAX = {
  motorway: 0.04, motorway_link: 0.05, trunk: 0.05, trunk_link: 0.06, primary: 0.06, primary_link: 0.06,
  secondary: 0.07, secondary_link: 0.07, tertiary: 0.08, tertiary_link: 0.08, unclassified: 0.08, residential: 0.08,
  living_street: 0.08, service: 0.1, busway: 0.06, steps: 0.6,
};
// steepest a road of each class may run before the ground under it counts as a hole or a lump
const ENVELOPE = {
  motorway: 0.05, motorway_link: 0.07, trunk: 0.06, trunk_link: 0.08, primary: 0.08, primary_link: 0.09,
  secondary: 0.09, secondary_link: 0.1, tertiary: 0.11, busway: 0.08,
};

// ---------------------------------------------------------------------------------------------------
// Missing motorway / trunk spans. A short bridge outside the mapped coverage was dropped by the
// pipeline, leaving both carriageways of the M4 dead-ended either side of the River Loddon (traffic
// turned round there). Joins each one-way dead end to the matching carriageway start ahead of it.
// Works on the decoded container before the Network is built; returns the new edge indices.
export function repairGaps(raw) {
  const A = raw.arrays, cls = raw.header.classes, names = raw.header.names;
  const nE = A.ea.length, nN = A.nodes.length / 3, P = A.pts;
  const deg = new Uint16Array(nN);
  for (let e = 0; e < nE; e++) { deg[A.ea[e]]++; deg[A.eb[e]]++; }
  const main = new Set(['motorway', 'trunk'].map(c => cls.indexOf(c)));
  const ends = [];
  for (let e = 0; e < nE; e++) {
    if (!main.has(A.cls[e]) || !(A.flags[e] & F_ONEWAY) || !(A.flags[e] & F_DRIVE) || !names[A.ref[e]]) continue;
    const s = A.pstart[e], c = A.pcount[e];
    const dir = (k, j) => { const dx = P[k * 3] - P[j * 3], dz = P[k * 3 + 2] - P[j * 3 + 2], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    if (deg[A.eb[e]] === 1) ends.push({ e, n: A.eb[e], k: s + c - 1, out: true, dir: dir(s + c - 1, s + c - 2) });
    if (deg[A.ea[e]] === 1) ends.push({ e, n: A.ea[e], k: s, out: false, dir: dir(s + 1, s) });
  }
  const joins = [];
  for (const a of ends) {
    if (!a.out) continue;
    let best = null, bd = 90;
    for (const b of ends) {
      if (b.out || b.e === a.e || A.ref[b.e] !== A.ref[a.e] || A.cls[b.e] !== A.cls[a.e]) continue;
      const dx = P[b.k * 3] - P[a.k * 3], dz = P[b.k * 3 + 2] - P[a.k * 3 + 2], d = Math.hypot(dx, dz);
      if (d < 2 || d > bd) continue;
      const gx = dx / d, gz = dz / d;
      if (a.dir[0] * gx + a.dir[1] * gz < 0.85 || b.dir[0] * gx + b.dir[1] * gz < 0.85) continue;
      best = b; bd = d;
    }
    if (best && !joins.some(j => j.b === best)) joins.push({ a, b: best, d: bd });
  }
  if (!joins.length) return [];
  // grow every per-edge array and the point array
  const grow = (arr, n) => { const out = new arr.constructor(arr.length + n); out.set(arr); return out; };
  const segs = joins.map(j => Math.max(2, Math.ceil(j.d / 8)));
  const addPts = segs.reduce((s, n) => s + n + 1, 0);
  const per = ['ea', 'eb', 'cls', 'flags', 'lanesF', 'lanesB', 'width', 'speed', 'layer', 'pav', 'name', 'ref', 'pstart', 'pcount', 'len',
    'ctrlA', 'ctrlB', 'sigA', 'sigB', 'grpA', 'grpB', 'cutA', 'cutB', 'osm', 'osmway'];
  for (const k of per) if (A[k]) A[k] = grow(A[k], joins.length);
  const nP0 = P.length / 3;
  A.pts = grow(P, addPts * 3);
  const Q = A.pts, added = [];
  let pi = nP0;
  joins.forEach((j, i) => {
    const e = nE + i, src = j.a.e, n = segs[i];
    const ax = P[j.a.k * 3], ay = P[j.a.k * 3 + 1], az = P[j.a.k * 3 + 2], bx = P[j.b.k * 3], by = P[j.b.k * 3 + 1], bz = P[j.b.k * 3 + 2];
    A.ea[e] = j.a.n; A.eb[e] = j.b.n; A.cls[e] = A.cls[src];
    A.flags[e] = (A.flags[src] & ~F_TUNNEL) | F_BRIDGE | F_ONEWAY | F_DRIVE;
    A.lanesF[e] = A.lanesF[src]; A.lanesB[e] = 0; A.width[e] = A.width[src]; A.speed[e] = A.speed[src];
    A.layer[e] = 1; A.pav[e] = 0; A.name[e] = A.name[src]; A.ref[e] = A.ref[src];
    if (A.sigA) { A.sigA[e] = -1; A.sigB[e] = -1; }
    A.pstart[e] = pi; A.pcount[e] = n + 1;
    // cubic Hermite between the two carriageway ends, leaving and arriving along each one
    for (let q = 0; q <= n; q++) {
      const t = q / n, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
      Q[pi * 3] = h00 * ax + h10 * j.d * j.a.dir[0] + h01 * bx + h11 * j.d * j.b.dir[0];
      Q[pi * 3 + 1] = ay + (by - ay) * t;
      Q[pi * 3 + 2] = h00 * az + h10 * j.d * j.a.dir[1] + h01 * bz + h11 * j.d * j.b.dir[1];
      pi++;
    }
    added.push(e);
  });
  raw.header.addedBridges = added;
  return added;
}

// ---------------------------------------------------------------------------------------------------
export function alignRoads(net, rail = null) {
  const P = net.pts, nP = P.length / 3, nE = net.nEdges, nN = net.nNodes;
  const ea = net.ea, eb = net.eb, ps = net.pstart, pc = net.pcount, fl = net.flags, L = net.len;
  const isBr = e => (fl[e] & F_BRIDGE) !== 0;
  // per-class constants looked up once per edge (the loops below run over every edge many times)
  const gradeOf = new Float32Array(nE), envOf = new Float32Array(nE), deckMaxOf = new Float32Array(nE);
  { const gc = net.classes.map(c => GRADE[c] ?? WALK_GRADE), ec = net.classes.map(c => ENVELOPE[c] ?? 0.13), dc = net.classes.map(c => DECK_MAX[c] ?? 0.1);
    for (let e = 0; e < nE; e++) { gradeOf[e] = gc[net.cls[e]]; envOf[e] = ec[net.cls[e]]; deckMaxOf[e] = dc[net.cls[e]]; } }
  const grade = e => gradeOf[e];
  const inc = Array.from({ length: nN }, () => []);
  for (let e = 0; e < nE; e++) { inc[ea[e]].push(e); if (eb[e] !== ea[e]) inc[eb[e]].push(e); }
  const nodeBr = new Uint8Array(nN);
  for (let e = 0; e < nE; e++) if (isBr(e)) { nodeBr[ea[e]] = 1; nodeBr[eb[e]] = 1; }
  // ordinary links sandwiched between two spans (a bridge mapped in pieces) ride with the deck
  const conn = new Uint8Array(nE);
  for (let e = 0; e < nE; e++) if (!isBr(e) && !(fl[e] & F_TUNNEL) && ea[e] !== eb[e] && nodeBr[ea[e]] && nodeBr[eb[e]] && L[e] < CONNECTOR) conn[e] = 1;
  const inCh = e => isBr(e) || conn[e] === 1;
  const arc = new Float32Array(nP);
  for (let e = 0; e < nE; e++) {
    const s = ps[e], c = pc[e];
    for (let k = 1; k < c; k++) arc[s + k] = arc[s + k - 1] + Math.hypot(P[(s + k) * 3] - P[(s + k - 1) * 3], P[(s + k) * 3 + 2] - P[(s + k - 1) * 3 + 2]);
  }

  // ---- ground under each network point. Ordinary roads carry the LIDAR ground along their centreline,
  // except the end points the pipeline lifted to a deck: those (and connectors) take nearby ground.
  const g0 = new Float32Array(nP), trusted = new Uint8Array(nP);
  for (let i = 0; i < nP; i++) g0[i] = P[i * 3 + 1];
  for (let e = 0; e < nE; e++) {
    if (inCh(e)) continue;
    const s = ps[e], c = pc[e];
    for (let k = 0; k < c; k++) trusted[s + k] = (k === 0 && nodeBr[ea[e]]) || (k === c - 1 && nodeBr[eb[e]]) ? 0 : 1;
  }
  const TC = 16, tgrid = new Map();
  for (let i = 0; i < nP; i++) if (trusted[i]) {
    const k = Math.floor(P[i * 3] / TC) * 65536 + Math.floor(P[i * 3 + 2] / TC);
    let l = tgrid.get(k); if (!l) tgrid.set(k, l = []); l.push(i);
  }
  // lowest trusted ground among the nearest few points within r (a conservative "ground under here")
  const groundNear = (x, z, r = 24) => {
    const near = [];
    for (let cx = Math.floor((x - r) / TC); cx <= Math.floor((x + r) / TC); cx++)
      for (let cz = Math.floor((z - r) / TC); cz <= Math.floor((z + r) / TC); cz++)
        for (const i of tgrid.get(cx * 65536 + cz) || []) { const d = Math.hypot(P[i * 3] - x, P[i * 3 + 2] - z); if (d <= r) near.push([d, g0[i]]); }
    if (!near.length) return NaN;
    near.sort((a, b) => a[0] - b[0]);
    let m = Infinity; for (let q = 0; q < Math.min(4, near.length); q++) m = Math.min(m, near[q][1]);
    return m;
  };
  const gN = new Float32Array(nN);
  for (let n = 0; n < nN; n++) {
    if (!nodeBr[n]) { gN[n] = net.nodes[n * 3 + 1]; continue; }
    let best = Infinity;
    for (const e of inc[n]) {
      if (inCh(e)) continue;
      const s = ps[e], c = pc[e];
      const k = ea[e] === n ? s + 1 : s + c - 2;
      if (c > 2 || trusted[k]) best = Math.min(best, g0[k]);
    }
    if (!Number.isFinite(best)) { const g = groundNear(net.nodes[n * 3], net.nodes[n * 3 + 2]); best = Number.isNaN(g) ? net.nodes[n * 3 + 1] : g; }
    gN[n] = best;
  }
  for (let e = 0; e < nE; e++) {
    if (isBr(e)) continue;
    const s = ps[e], c = pc[e];
    if (conn[e]) { for (let k = 0; k < c; k++) { const g = groundNear(P[(s + k) * 3], P[(s + k) * 3 + 2]); if (!Number.isNaN(g)) g0[s + k] = Math.min(g0[s + k], g); } continue; }
    if (nodeBr[ea[e]]) g0[s] = gN[ea[e]];
    if (nodeBr[eb[e]]) g0[s + c - 1] = gN[eb[e]];
  }
  // ---- the LIDAR ground along a road has holes where an underpass or culvert runs beneath it (the
  // roundabouts over Bracknell's cycle underpasses dip 3-4 m). Roads can't be steeper than their class
  // allows, so fill holes steeper than that (a max-plus envelope along the drive network).
  const gs = Float32Array.from(g0);
  {
    const ord = new Uint8Array(nE);
    for (let e = 0; e < nE; e++) ord[e] = !inCh(e) && !(fl[e] & F_TUNNEL) && (fl[e] & F_DRIVE) ? 1 : 0;
    const ordinary = e => ord[e] === 1;
    const envG = e => envOf[e];
    const nodeV = new Float32Array(nN);
    for (const sign of [1]) {
      for (let pass = 0; pass < 40; pass++) {
        let ch = 0;
        for (let e = 0; e < nE; e++) {
          if (!ordinary(e)) continue;
          const s = ps[e], c = pc[e], g = envG(e);
          for (let k = 1; k < c; k++) { const v = gs[s + k - 1] - sign * g * (arc[s + k] - arc[s + k - 1]); if (sign * (v - gs[s + k]) > 1e-3) { gs[s + k] = v; ch++; } }
          for (let k = c - 2; k >= 0; k--) { const v = gs[s + k + 1] - sign * g * (arc[s + k + 1] - arc[s + k]); if (sign * (v - gs[s + k]) > 1e-3) { gs[s + k] = v; ch++; } }
        }
        nodeV.fill(sign > 0 ? -Infinity : Infinity);
        for (let e = 0; e < nE; e++) {
          if (!ordinary(e)) continue;
          const s = ps[e], c = pc[e];
          nodeV[ea[e]] = sign > 0 ? Math.max(nodeV[ea[e]], gs[s]) : Math.min(nodeV[ea[e]], gs[s]);
          nodeV[eb[e]] = sign > 0 ? Math.max(nodeV[eb[e]], gs[s + c - 1]) : Math.min(nodeV[eb[e]], gs[s + c - 1]);
        }
        for (let e = 0; e < nE; e++) {
          if (!ordinary(e)) continue;
          const s = ps[e], c = pc[e];
          if (sign * (nodeV[ea[e]] - gs[s]) > 1e-3) { gs[s] = nodeV[ea[e]]; ch++; }
          if (sign * (nodeV[eb[e]] - gs[s + c - 1]) > 1e-3) { gs[s + c - 1] = nodeV[eb[e]]; ch++; }
        }
        if (!ch) break;
      }
    }
    for (let e = 0; e < nE; e++) if (ordinary(e)) { const s = ps[e], c = pc[e]; if (!nodeBr[ea[e]]) gN[ea[e]] = gs[s]; if (!nodeBr[eb[e]]) gN[eb[e]] = gs[s + c - 1]; }
  }

  // ---- chains: bridge spans (and their connectors) joined through shared nodes
  const chainOf = new Int32Array(nE).fill(-1), chains = [];
  for (let e = 0; e < nE; e++) {
    if (!inCh(e) || chainOf[e] >= 0) continue;
    const id = chains.length, edges = [], st = [e]; chainOf[e] = id;
    while (st.length) {
      const x = st.pop(); edges.push(x);
      for (const n of [ea[x], eb[x]]) for (const y of inc[n]) if (inCh(y) && chainOf[y] < 0) { chainOf[y] = id; st.push(y); }
    }
    const nodes = new Set(); for (const x of edges) { nodes.add(ea[x]); nodes.add(eb[x]); }
    const ends = [...nodes].filter(n => inc[n].some(x => !inCh(x)));
    chains.push({ edges, nodes: [...nodes], ends, h: new Map(), lifts: [], walk: edges.every(x => !(fl[x] & F_DRIVE)) });
  }
  // crest beside a chain end: highest ground 1.5-14 m out along the ordinary roads leaving it
  const crest = n => {
    let best = -Infinity;
    const stack = [[n, 0]], seen = new Set([n]);
    while (stack.length) {
      const [m, d0] = stack.pop();
      for (const e of inc[m]) {
        if (inCh(e)) continue;
        const s = ps[e], c = pc[e], fwd = ea[e] === m;
        let acc = d0, k = 1;
        for (; k < c; k++) {
          const i = fwd ? s + k : s + c - 1 - k;
          acc = d0 + (fwd ? arc[i] : arc[s + c - 1] - arc[i]);
          if (acc > CREST_MAX) break;
          if (acc >= CREST_MIN && trusted[i]) best = Math.max(best, gs[i]);
        }
        const other = fwd ? eb[e] : ea[e];
        if (k === c && !seen.has(other) && !nodeBr[other]) { seen.add(other); stack.push([other, acc]); }
      }
    }
    return best;
  };
  const fixedEnd = chains.map(ch => { const m = new Map(); for (const n of ch.ends) { const c = crest(n); m.set(n, Number.isFinite(c) ? c : gN[n]); } return m; });

  // ---- what passes underneath: drive roads (network grid) and railway lines
  const railSegs = [], railGrid = new Map(), RC = 50;
  for (const line of rail?.lines || []) {
    const p = line.p;
    for (let i = 0; i + 5 < p.length; i += 3) {
      const id = railSegs.length; railSegs.push([p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]]);
      for (let cx = Math.floor(Math.min(p[i], p[i + 3]) / RC); cx <= Math.floor(Math.max(p[i], p[i + 3]) / RC); cx++)
        for (let cz = Math.floor(Math.min(p[i + 2], p[i + 5]) / RC); cz <= Math.floor(Math.max(p[i + 2], p[i + 5]) / RC); cz++) {
          const k = cx * 65536 + cz; let l = railGrid.get(k); if (!l) railGrid.set(k, l = []); l.push(id);
        }
    }
  }
  const segX = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = cx - ax, qz = cz - az, t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
  };
  const needs = chains.map(() => []);
  chains.forEach((ch, ci) => {
    const own = new Set(ch.nodes);
    for (const e of ch.edges) {
      if (!isBr(e)) continue;
      const s = ps[e], c = pc[e];
      for (let k = 0; k + 1 < c; k++) {
        const ax = P[(s + k) * 3], az = P[(s + k) * 3 + 2], bx = P[(s + k + 1) * 3], bz = P[(s + k + 1) * 3 + 2];
        const seen = new Set();
        for (let cx = Math.floor(Math.min(ax, bx) / 50); cx <= Math.floor(Math.max(ax, bx) / 50); cx++)
          for (let cz = Math.floor(Math.min(az, bz) / 50); cz <= Math.floor(Math.max(az, bz) / 50); cz++) {
            const l = net.grid.get(cx * 65536 + cz);
            if (l) for (let q = 0; q < l.length; q += 2) {
              const e2 = l[q], i2 = l[q + 1];
              if (inCh(e2) || !(fl[e2] & F_DRIVE) || (fl[e2] & F_TUNNEL) || own.has(ea[e2]) || own.has(eb[e2])) continue;
              const key = e2 * 4096 + i2; if (seen.has(key)) continue; seen.add(key);
              const j = (ps[e2] + i2) * 3;
              const x = segX(ax, az, bx, bz, P[j], P[j + 2], P[j + 3], P[j + 5]); if (!x) continue;
              needs[ci].push({ e, at: arc[s + k] + (arc[s + k + 1] - arc[s + k]) * x[0], road: e2,
                roadAt: arc[ps[e2] + i2] + (arc[ps[e2] + i2 + 1] - arc[ps[e2] + i2]) * x[1], clear: CLEAR_ROAD });
            }
            const r = railGrid.get(cx * 65536 + cz);
            if (r) for (const id of r) {
              if (seen.has(-1 - id)) continue; seen.add(-1 - id);
              const [x0, y0, z0, x1, y1, z1] = railSegs[id];
              const x = segX(ax, az, bx, bz, x0, z0, x1, z1); if (!x) continue;
              needs[ci].push({ e, at: arc[s + k] + (arc[s + k + 1] - arc[s + k]) * x[0], road: -1, low: y0 + (y1 - y0) * x[1], clear: CLEAR_RAIL });
            }
          }
      }
    }
  });

  // ---- solve: deck profiles with headroom, approach ramps; repeat while a ramp lifts another deck end
  const ynew = new Float32Array(nP);
  for (let i = 0; i < nP; i++) ynew[i] = gs[i];
  const req = new Float64Array(nN), reqW = new Float64Array(nN);   // 64-bit: the queue compares against them
  const nodeDrive = new Uint8Array(nN);
  for (let e = 0; e < nE; e++) if (!inCh(e) && (fl[e] & F_DRIVE)) { nodeDrive[ea[e]] = 1; nodeDrive[eb[e]] = 1; }
  const lowAround = (e, a) => { const s = ps[e], c = pc[e]; let m = Infinity; for (let k = 0; k < c; k++) if (Math.abs(arc[s + k] - a) <= 10) m = Math.min(m, ynew[s + k]); return m; };
  const chEdges = new Map();   // node -> its chain edges (each node belongs to one chain)
  const chainEdges = (ci, n) => { let l = chEdges.get(n); if (!l) chEdges.set(n, l = inc[n].filter(e => chainOf[e] === ci)); return l; };
  let lifted = 0, iters = 0;
  for (; iters < 6; iters++) {
    chains.forEach((ch, ci) => {
      const fix = fixedEnd[ci], h = ch.h; h.clear();
      if (!fix.size) {   // a span with no approach keeps the pipeline heights
        for (const e of ch.edges) { h.set(ea[e], P[ps[e] * 3 + 1]); h.set(eb[e], P[(ps[e] + pc[e] - 1) * 3 + 1]); }
      } else {
        let avg = 0; for (const v of fix.values()) avg += v; avg /= fix.size;
        for (const n of ch.nodes) h.set(n, fix.has(n) ? fix.get(n) : avg);
        const free = ch.nodes.filter(n => !fix.has(n));
        for (let it = 0; it < (free.length ? 300 : 0); it++) for (const n of free) {
          let sw = 0, sh = 0;
          for (const e of chainEdges(ci, n)) { const m = ea[e] === n ? eb[e] : ea[e], w = 1 / Math.max(1, L[e]); sw += w; sh += w * h.get(m); }
          if (sw) h.set(n, sh / sw);
        }
      }
      // headroom over what passes beneath: lift the deck, falling away along the chain at DECK_GRADE
      ch.lifts = [];
      for (const nd of needs[ci]) {
        const want = (nd.road >= 0 ? lowAround(nd.road, nd.roadAt) : nd.low) + nd.clear;
        const ha = h.get(ea[nd.e]), hb = h.get(eb[nd.e]), cur = ha + (hb - ha) * (L[nd.e] ? nd.at / L[nd.e] : 0);
        if (cur >= want - 0.05) continue;
        ch.lifts.push({ e: nd.e, at: nd.at, want });
        const dist = new Map([[ea[nd.e], nd.at], [eb[nd.e], L[nd.e] - nd.at]]), queue = [ea[nd.e], eb[nd.e]];
        while (queue.length) {
          const n = queue.shift(), d = dist.get(n);
          for (const e of chainEdges(ci, n)) { const m = ea[e] === n ? eb[e] : ea[e], dm = d + L[e]; if (dm < (dist.get(m) ?? Infinity)) { dist.set(m, dm); queue.push(m); } }
        }
        for (const [n, d] of dist) { const v = want - DECK_GRADE * d; if (v > h.get(n) + 0.01) { h.set(n, v); lifted++; } }
      }
      // no deck steeper than its class allows: lift the low end (its approach then ramps down to the ground)
      for (let pass = 0; pass < 20; pass++) {
        let moved = false;
        for (const e of ch.edges) {
          const ha = h.get(ea[e]), hb = h.get(eb[e]), lim = deckMaxOf[e] * Math.max(1, L[e]);
          if (Math.abs(hb - ha) <= lim + 0.01) continue;
          const lo = ha < hb ? ea[e] : eb[e], v = Math.max(ha, hb) - lim;
          h.set(lo, v); moved = true;
          if (fix.has(lo) && v > fix.get(lo) + 0.05) { fix.set(lo, v); }
        }
        if (!moved) break;
      }
      for (const e of ch.edges) {
        const s = ps[e], c = pc[e], ha = h.get(ea[e]), hb = h.get(eb[e]);
        for (let k = 0; k < c; k++) {
          const a = arc[s + k];
          let y = ha + (hb - ha) * (L[e] ? a / L[e] : 0);
          for (const lf of ch.lifts) if (lf.e === e) y = Math.max(y, lf.want - DECK_GRADE * Math.abs(a - lf.at));
          ynew[s + k] = y;
        }
      }
    });
    // ramps: required heights spread from every chain end down the ordinary roads leaving it. A footbridge's
    // ramps (reqW) stay on footpaths: they never lift a road, its landing on a street is a flight of steps.
    req.fill(-Infinity); reqW.fill(-Infinity);
    const spread = (R, walk) => {
      const heap = [];
      const push = (n, v) => { heap.push([v, n]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      for (const ch of chains) if (ch.walk === walk) for (const n of ch.ends) { const v = ch.h.get(n); if (v > R[n]) { R[n] = v; push(n, v); } }
      while (heap.length) {
        const [v, n] = pop(); if (v < R[n]) continue;
        for (const e of inc[n]) {
          if (inCh(e) || (walk && (fl[e] & F_DRIVE))) continue;
          const m = ea[e] === n ? eb[e] : ea[e], r = v - grade(e) * L[e];
          if (walk && nodeDrive[m]) continue;
          if (r > R[m] && r > gN[m] + 0.05) { R[m] = r; push(m, r); }
        }
      }
    };
    spread(req, false); spread(reqW, true);
    for (let e = 0; e < nE; e++) {
      if (inCh(e)) continue;
      const s = ps[e], c = pc[e], g = grade(e), walk = !(fl[e] & F_DRIVE);
      const ra = Math.max(req[ea[e]], walk && !nodeDrive[ea[e]] ? reqW[ea[e]] : -Infinity);
      const rb = Math.max(req[eb[e]], walk && !nodeDrive[eb[e]] ? reqW[eb[e]] : -Infinity);
      for (let k = 0; k < c; k++) {
        const a = arc[s + k];
        let y = gs[s + k];
        if (ra > -Infinity) y = Math.max(y, ra - g * a);
        if (rb > -Infinity) y = Math.max(y, rb - g * (L[e] - a));
        ynew[s + k] = y;
      }
      // a footbridge's steps arrive on the street at the street's height
      if (walk) { if (nodeDrive[ea[e]]) ynew[s] = Math.max(gs[s], req[ea[e]]); if (nodeDrive[eb[e]]) ynew[s + c - 1] = Math.max(gs[s + c - 1], req[eb[e]]); }
    }
    // a ramp arriving at another deck's end above that end, or a road beneath now short of headroom
    let changed = false;
    chains.forEach((ch, ci) => {
      for (const n of ch.ends) {
        let top = ch.walk ? Math.max(req[n], nodeDrive[n] ? -Infinity : reqW[n]) : req[n];
        // ordinary roads arriving higher than the deck end (their ground beside the abutment)
        for (const e of inc[n]) if (!inCh(e) && (!ch.walk || !(fl[e] & F_DRIVE))) top = Math.max(top, ynew[ea[e] === n ? ps[e] : ps[e] + pc[e] - 1]);
        if (top > ch.h.get(n) + 0.05) { fixedEnd[ci].set(n, top); changed = true; }
      }
      for (const nd of needs[ci]) if (nd.road >= 0) {
        const want = lowAround(nd.road, nd.roadAt) + nd.clear, ha = ch.h.get(ea[nd.e]), hb = ch.h.get(eb[nd.e]);
        if (Math.max(ha + (hb - ha) * (L[nd.e] ? nd.at / L[nd.e] : 0), ...ch.lifts.filter(l => l.e === nd.e).map(l => l.want - DECK_GRADE * Math.abs(l.at - nd.at))) < want - 0.05) changed = true;
      }
    });
    if (!changed) break;
  }
  // ---- footpaths meeting a road whose hole was filled or which now ramps: ease them onto it over 12 m
  for (let e = 0; e < nE; e++) {
    if (inCh(e) || (fl[e] & F_DRIVE)) continue;
    const s = ps[e], c = pc[e];
    for (const [n, k0, dir] of [[ea[e], s, 1], [eb[e], s + c - 1, -1]]) {
      if (!nodeDrive[n]) continue;
      const d = Math.max(gN[n], req[n]) - ynew[k0];
      if (Math.abs(d) < 0.02) continue;
      for (let k = k0, q = 0; q < c; q++, k += dir) {
        const a = Math.abs(arc[k] - arc[k0]);
        if (a >= 12) break;
        ynew[k] += d * (1 - a / 12);
      }
    }
  }
  // ---- write back
  const rise = new Float32Array(nP);
  for (let e = 0; e < nE; e++) {
    const s = ps[e], c = pc[e], br = isBr(e);
    for (let k = 0; k < c; k++) { P[(s + k) * 3 + 1] = ynew[s + k]; if (!br) rise[s + k] = conn[e] ? Math.max(0, ynew[s + k] - g0[s + k]) : ynew[s + k] - g0[s + k]; }
  }
  for (let n = 0; n < nN; n++) {
    let y = Math.max(gN[n], req[n], nodeDrive[n] ? -Infinity : reqW[n]);
    for (const e of inc[n]) if (inCh(e)) { const ci = chainOf[e]; y = chains[ci].h.get(n); break; }
    net.nodes[n * 3 + 1] = y;
  }
  net.rise = rise;
  net.ground = g0;
  net.connector = conn;
  let rampNodes = 0; for (let n = 0; n < nN; n++) if (req[n] > gN[n] + 0.05) rampNodes++;
  net.profileStats = { chains: chains.length, lifted, rampNodes, iterations: iters + 1 };
  return net.profileStats;
}
