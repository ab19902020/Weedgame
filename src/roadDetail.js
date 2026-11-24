// Road furniture fixes applied once at load, alongside roadProfile.js:
//   * traffic signals: drop the phantom approaches the pipeline made for traffic *leaving* a signal node
//     (they put stop lines and signal poles in the middle of junctions and 60 m up the road), merge
//     duplicates and set stop lines back from the junction they guard;
//   * bus stops: OSM puts many stop nodes on the road centreline. Each stop moves to the kerb on the side
//     its buses use (UK: on their left), and gets a bay marking;
//   * motorway cross-section: a nearside hard shoulder and offside hard strip, so lanes are 3.65 m wide
//     and traffic, markings and barriers agree;
//   * barriers: a steel safety fence along the central reservation of motorways and dual carriageways and
//     along both verges where a road runs on a high embankment.

const F_ONEWAY = 1, F_BRIDGE = 4, F_TUNNEL = 8, F_DRIVE = 16;
const LANE_MWAY = 3.65, STRIP = 1.0;

// ---- signals (on the decoded container, before the Network is built: its constructor groups approaches)
export function cleanSignals(raw) {
  const H = raw.header, A = raw.arrays, P = A.pts, ps = A.pstart, pc = A.pcount;
  const len = e => { let s = 0; for (let k = 1; k < pc[e]; k++) { const a = (ps[e] + k - 1) * 3, b = a + 3; s += Math.hypot(P[b] - P[a], P[b + 2] - P[a + 2]); } return s; };
  const deg = new Uint16Array(A.nodes.length / 3);
  for (let e = 0; e < A.ea.length; e++) if (A.flags[e] & F_DRIVE) { deg[A.ea[e]]++; deg[A.eb[e]]++; }
  let dropped = 0, setBack = 0;
  for (const c of H.controllers) {
    const byHalf = new Map();
    for (const a of c.approaches) {
      const [e, d, stop] = a;
      // the signal node is where this piece of road starts: traffic on it is leaving the signal
      if (stop <= 1.0) { dropped++; continue; }
      const L = len(e), end = d === 1 ? A.eb[e] : A.ea[e], cut = d === 1 ? A.cutB[e] : A.cutA[e];
      // a stop line inside the junction it guards moves back to the junction mouth
      if (deg[end] >= 3 && L - stop < cut + 1) { a[2] = Math.max(1.5, +(L - cut - 1).toFixed(1)); setBack++; }
      const k = e * 2 + (d === 1 ? 0 : 1);
      if (!byHalf.has(k)) byHalf.set(k, []);
      byHalf.get(k).push(a);
    }
    const keep = [];
    for (const list of byHalf.values()) {
      list.sort((p, q) => p[2] - q[2]);
      let last = -1e9;
      for (const a of list) { if (a[2] - last < 10) { dropped++; continue; } keep.push(a); last = a[2]; }
    }
    c.approaches = keep;
    const peds = [];
    for (const p of c.peds) if (!peds.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2)) peds.push(p);
    c.peds = peds;
  }
  return { dropped, setBack };
}

// ---- motorway cross-section: hard shoulder (nearside) and hard strip (offside), per edge
export function motorwayLayout(net) {
  const n = net.nEdges, shoulder = new Float32Array(n), strip = new Float32Array(n);
  for (let e = 0; e < n; e++) {
    if (net.classes[net.cls[e]] !== 'motorway' || !(net.flags[e] & F_ONEWAY)) continue;
    const lanes = Math.max(1, net.lanesF[e]), spare = net.width[e] - lanes * LANE_MWAY;
    if (spare < 3.4) continue;
    strip[e] = STRIP; shoulder[e] = spare - STRIP;
  }
  net.shoulder = shoulder; net.strip = strip;
}

// ---- bus stops to the kerb
const NOT_KERB = /motorway|footway|path|cycleway|steps|pedestrian|bridleway|corridor|track/;
export function kerbBusStops(net) {
  // roads the bus routes run along, and in which directions (1: a->b, 2: b->a)
  const routeDir = new Map();
  for (const r of net.routes) for (const [e, d] of r.seq) routeDir.set(e, (routeDir.get(e) || 0) | (d === 1 ? 1 : 2));
  const usable = e => (net.flags[e] & F_DRIVE) && !(net.flags[e] & (F_BRIDGE | F_TUNNEL)) && !NOT_KERB.test(net.classes[net.cls[e]]);
  const bays = [];
  let moved = 0;
  // the road the buses use beside each stop, else the nearest ordinary road
  const ordinary = e => usable(e) && net.classes[net.cls[e]] !== 'service';
  const near = (x, z) => net.nearest(x, z, 30, ordinary) || net.nearest(x, z, 30, usable);
  // a kerb spot must be clear of every carriageway (a stop snapped to a bus road behind another road would not be)
  const clear = (x, z) => { const q = net.nearest(x, z, 16, ordinary); return !q || q.d >= net.width[q.e] / 2 + 0.3; };
  const snaps = net.busStops.map(([x, z]) => {
    const r = net.nearest(x, z, 25, e => usable(e) && routeDir.has(e)), o = near(x, z);
    if (!r || (o && o.e !== r.e && o.d < net.width[o.e] / 2 + 0.6 && o.d + 4 < r.d)) return o;   // standing in another road: that one
    return r;
  });
  const clearSide = snaps.map(n => n && n.d > 1.2 ? n.side : 0);
  net.busStops.forEach((st, si) => {
    const [x, z, name] = st, n = snaps[si];
    if (!n) return;
    const w = net.width[n.e], dirs = routeDir.get(n.e) || 0;
    let side;
    if (n.d > 1.2) side = n.side;                                   // mapped beside the road: that kerb
    else if (dirs === 1 || dirs === 2) side = dirs === 1 ? 1 : -1;  // on the centreline: the left of the buses using it
    else if (net.flags[n.e] & F_ONEWAY) side = 1;
    else {
      // the other half of a pair (same name, a stop each side of the road) fixes which kerb this one is
      const mate = net.busStops.findIndex((o, j) => j !== si && o[2] === name && name && clearSide[j] && Math.hypot(o[0] - x, o[1] - z) < 80);
      side = mate >= 0 ? -clearSide[mate] * Math.sign((snaps[mate].dx * n.dx + snaps[mate].dz * n.dz) || 1) : (n.side || 1);
    }
    const lx = n.dz * side, lz = -n.dx * side;                     // towards the kerb the stop is on
    const pav = net.pav[n.e] & (side > 0 ? 1 : 2);
    const off = w / 2 + (pav ? 0.75 : 1.2);
    // only stops standing in the carriageway move; the rest stay where they were mapped (lay-bys, verges)
    if (n.d < w / 2 + 0.6) {
      let nx = n.x + lx * off, nz = n.z + lz * off;
      if (!clear(nx, nz)) { nx = n.x - lx * off; nz = n.z - lz * off; if (!clear(nx, nz)) { nx = n.x + lx * off; nz = n.z + lz * off; } else side = -side; }
      if (Math.hypot(nx - x, nz - z) > 0.4) moved++;
      st[0] = Math.round(nx * 100) / 100; st[1] = Math.round(nz * 100) / 100;
    }
    // a bay in the kerbside lane where buses actually pass this side of the road
    const served = side > 0 ? (dirs & 1) !== 0 : (dirs & 2) !== 0;
    const laneW = Math.min(3.4, (net.flags[n.e] & F_ONEWAY ? w / Math.max(1, net.lanesF[n.e]) : w / Math.max(2, net.lanesF[n.e] + net.lanesB[n.e])));
    bays.push({ si, e: n.e, s: n.s, side, laneW, served });
  });
  net.busBays = bays;
  return { moved, bays: bays.length, served: bays.filter(b => b.served).length };
}

// ---- barriers: polylines [x, y, z] of a double-sided steel fence (central reserve) or a single fence (verge)
export function barriers(net) {
  const P = net.pts, out = [];
  const major = net.classes.map(c => /^(motorway|trunk|primary)$/.test(c));
  const isCarriage = new Uint8Array(net.nEdges);
  for (let e = 0; e < net.nEdges; e++) isCarriage[e] = (net.flags[e] & F_ONEWAY) && (net.flags[e] & F_DRIVE) && !(net.flags[e] & F_TUNNEL) && major[net.cls[e]] ? 1 : 0;
  const carriage = e => isCarriage[e] === 1;
  const tmp = [0, 0, 0, 0, 0];
  const STEP = 8;
  // gaps: at-grade junctions and crossings (dual carriageways have openings there), and anywhere the line
  // would cross another carriageway
  const deg = new Uint16Array(net.nNodes);
  for (let e = 0; e < net.nEdges; e++) if (net.flags[e] & F_DRIVE) { deg[net.ea[e]]++; deg[net.eb[e]]++; }
  const junctionNear = (e, s, r) => (deg[net.ea[e]] >= 3 && s < r) || (deg[net.eb[e]] >= 3 && net.len[e] - s < r);
  const crossingNear = (e, s, r) => (net.crossByEdge.get(e) || []).some(c => Math.abs(c.s - s) < r);
  const onCarriage = (x, z, skipA = -1, skipB = -1) => { const q = net.nearest(x, z, 12, o => o !== skipA && o !== skipB && (net.flags[o] & F_DRIVE) && !(net.flags[o] & F_BRIDGE)); return q && q.d < net.width[q.e] / 2 + 0.3; };
  // central reservation: midway between a carriageway and the opposing one on its offside (right)
  for (let e = 0; e < net.nEdges; e++) {
    if (!carriage(e) || (net.flags[e] & F_BRIDGE)) continue;
    const L = net.len[e]; let line = [];
    const kind = net.classes[net.cls[e]] === 'motorway' ? 0 : 2;   // concrete step barrier on motorways, steel elsewhere
    const flush = () => { if (line.length > 1) out.push({ kind, pts: line }); line = []; };
    for (let s = 0; s <= L; s += STEP) {
      net.at(e * 2, Math.min(s, L), tmp);
      const x = tmp[0], y = tmp[1], z = tmp[2], dx = tmp[3], dz = tmp[4], rx = -dz, rz = dx;   // right of travel
      const w = net.width[e];
      const q = net.nearest(x + rx * (w / 2 + 5), z + rz * (w / 2 + 5), 22, o => o !== e && carriage(o));
      let ok = false;
      if (q) {
        const along = (q.x - x) * dx + (q.z - z) * dz, lat = (q.x - x) * rx + (q.z - z) * rz;
        const opposite = q.dx * dx + q.dz * dz < -0.85;
        const gap = lat - w / 2 - net.width[q.e] / 2;          // width of the reservation between the carriageway edges
        // one fence per pair (from the lower edge index), only where the reservation is narrow enough to need one
        const atGrade = kind !== 0 && (junctionNear(e, s, 28) || junctionNear(q.e, q.s, 28) || crossingNear(e, s, 10) || crossingNear(q.e, q.s, 10));
        // room between the two outermost lanes (a motorway's hard strips are part of the reservation)
        const inner = gap + (net.strip ? net.strip[e] + net.strip[q.e] : 0);
        if (opposite && !atGrade && Math.abs(along) < 4 && inner > 0.8 && gap < 14 && q.e > e && !(net.flags[q.e] & F_BRIDGE)) {
          const mx = (x + rx * (w / 2) + q.x - rx * (net.width[q.e] / 2)) / 2, mz = (z + rz * (w / 2) + q.z - rz * (net.width[q.e] / 2)) / 2;
          if (!onCarriage(mx, mz, e, q.e)) { line.push([mx, (y + q.y) / 2, mz]); ok = true; }
        }
      }
      if (!ok) flush();
    }
    flush();
  }
  // verges on high embankments (roads ramping up to a bridge): a fence a metre outside each edge
  const rise = net.rise;
  if (rise) for (let e = 0; e < net.nEdges; e++) {
    if ((net.flags[e] & (F_BRIDGE | F_TUNNEL)) || !(net.flags[e] & F_DRIVE) || /service|track/.test(net.classes[net.cls[e]])) continue;
    const s0 = net.pstart[e], c = net.pcount[e];
    let any = false; for (let k = 0; k < c; k++) if (rise[s0 + k] > 2) any = true;
    if (!any) continue;
    const w = net.width[e] / 2 + (net.pav[e] ? 2.4 : 0.9);
    for (const sd of [1, -1]) {
      let line = [];
      const flush = () => { if (line.length > 1) out.push({ kind: 1, pts: line }); line = []; };
      for (let k = 0; k < c; k++) {
        const i = s0 + k, sk = net.cum[i];
        if (rise[i] < 1.6 || junctionNear(e, sk, 16)) { flush(); continue; }
        const j = Math.min(c - 1, k + 1), h = Math.max(0, k - 1);
        const dx = P[(s0 + j) * 3] - P[(s0 + h) * 3], dz = P[(s0 + j) * 3 + 2] - P[(s0 + h) * 3 + 2], l = Math.hypot(dx, dz) || 1;
        const lx = dz / l * sd, lz = -dx / l * sd;
        const bx = P[i * 3] + lx * w, bz = P[i * 3 + 2] + lz * w;
        if (onCarriage(bx, bz)) { flush(); continue; }
        line.push([bx, P[i * 3 + 1], bz]);
      }
      flush();
    }
  }
  // flatten: [count, kind, x, y, z, ...] per line
  const flat = [];
  for (const b of out) { flat.push(b.pts.length, b.kind); for (const p of b.pts) flat.push(p[0], p[1], p[2]); }
  net.barriers = new Float32Array(flat);
  return { lines: out.length, central: out.filter(b => b.kind !== 1).length };
}
