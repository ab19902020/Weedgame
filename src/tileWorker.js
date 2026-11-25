// Tile worker: fetches world tiles and turns them into GPU-ready typed arrays.
// Everything here is plain math so the main thread never stalls on geometry.
import earcut from '../node_modules/three/src/extras/lib/earcut.js';
import { inflate, decode } from './data.js';
import { fasciaBrand, signBox, normName } from './brands.js';

const TILE = 256, NT = 65, STEP = 4;
let NET = null;

self.onmessage = async ev => {
  const m = ev.data;
  if (m.type === 'init') { initNet(m); return; }
  if (m.type === 'tile') {
    try {
      const r = await fetch(m.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { header, arrays } = decode(await inflate(await r.arrayBuffer()));
      const out = build(header, arrays, m.lod);
      out.key = m.key; out.lod = m.lod;
      self.postMessage(out, collectTransfer(out));
    } catch (err) {
      self.postMessage({ key: m.key, lod: m.lod, error: String(err && err.stack || err) });
    }
  }
};

function collectTransfer(o, list = []) {
  for (const v of Object.values(o)) {
    if (ArrayBuffer.isView(v)) list.push(v.buffer);
    else if (v && typeof v === 'object' && !Array.isArray(v)) collectTransfer(v, list);
  }
  return [...new Set(list)];
}

function initNet(m) {
  NET = m;
  const nP = m.pts.length / 3;
  NET.cum = new Float32Array(nP);
  for (let e = 0; e < m.pstart.length; e++) {
    const s = m.pstart[e], n = m.pcount[e];
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const a = (s + i - 1) * 3, b = (s + i) * 3;
      acc += Math.hypot(m.pts[b] - m.pts[a], m.pts[b + 2] - m.pts[a + 2]);
      NET.cum[s + i] = acc;
    }
  }
  NET.cross = new Map();
  for (const c of m.crossings) { if (!NET.cross.has(c[0])) NET.cross.set(c[0], []); NET.cross.get(c[0]).push(c); }
  NET.stops = new Map();
  for (const [e, d, stop] of m.approaches) { if (!NET.stops.has(e)) NET.stops.set(e, []); NET.stops.get(e).push([d, stop]); }
  NET.driveCls = new Set(m.driveCls);
}

// ------------------------------------------------------------------ growable buffers
const BR = 14;   // floats per breakable record (see build: brkRec)
class Buf {
  constructor(extra = 0) { this.p = []; this.n = []; this.x = []; this.extra = extra; this.uv = []; }
  v(x, y, z, nx, ny, nz, u, w, ...ex) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); for (let i = 0; i < this.extra; i++) this.x.push(ex[i] ?? 0); }
  pack() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv),
      extra: this.extra ? new Float32Array(this.x) : null, count: this.p.length / 3 };
  }
}
function triN(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
// quad a-b-c-d (ccw seen from the side the normal faces); want normal hint w
function quad(B, a, b, c, d, hint, uvs, ex) {
  let n = triN(...a, ...b, ...c);
  if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, d] = [d, b]; uvs = uvs && [uvs[0], uvs[3], uvs[2], uvs[1]]; n = n.map(v => -v); }
  const U = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
  B.v(...a, ...n, ...U[0], ...ex); B.v(...b, ...n, ...U[1], ...ex); B.v(...c, ...n, ...U[2], ...ex);
  B.v(...a, ...n, ...U[0], ...ex); B.v(...c, ...n, ...U[2], ...ex); B.v(...d, ...n, ...U[3], ...ex);
}
function tri(B, a, b, c, hint, uvs, ex) {
  let n = triN(...a, ...b, ...c);
  if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, c] = [c, b]; uvs = uvs && [uvs[0], uvs[2], uvs[1]]; n = n.map(v => -v); }
  const U = uvs || [[0, 0], [1, 0], [0, 1]];
  B.v(...a, ...n, ...U[0], ...ex); B.v(...b, ...n, ...U[1], ...ex); B.v(...c, ...n, ...U[2], ...ex);
}

// ------------------------------------------------------------------ build
function build(header, A, lod) {
  const ox = header.ix * TILE, oz = header.iz * TILE, hmin = header.hmin;
  const H = new Float32Array(NT * NT);
  for (let i = 0; i < H.length; i++) H[i] = hmin + A.h[i] / 100;
  const lc = A.lc;  // 128x128 at 2 m
  const lcAt = (x, z) => lc[Math.min(127, Math.max(0, z >> 1)) * 128 + Math.min(127, Math.max(0, x >> 1))];
  // terrain surface height (matches triangle split of the terrain mesh)
  const hAt = (x, z) => {
    const gx = Math.max(0, Math.min(NT - 1.0001, x / STEP)), gz = Math.max(0, Math.min(NT - 1.0001, z / STEP));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    const h00 = H[j * NT + i], h10 = H[j * NT + i + 1], h01 = H[(j + 1) * NT + i], h11 = H[(j + 1) * NT + i + 1];
    return fu >= fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
  };
  const out = { ix: header.ix, iz: header.iz, ox, oz, hmin, heights: H, lc: new Uint8Array(lc) };

  // ---------------- terrain
  const tstep = lod ? 4 : 1; // grid stride in samples
  const tn = (NT - 1) / tstep + 1;
  const tp = new Float32Array(tn * tn * 3), tnor = new Float32Array(tn * tn * 3);
  for (let j = 0; j < tn; j++) for (let i = 0; i < tn; i++) {
    const gi = i * tstep, gj = j * tstep, k = (j * tn + i) * 3;
    let y = H[gj * NT + gi];
    if (!lod) { // sink terrain under hard surfaces so draped surfaces never clip
      const c = lcAt(gi * STEP, gj * STEP);
      if (c === 1 || c === 2 || c === 3 || c === 8 || c === 12 || c === 10) y -= 0.25;
    }
    tp[k] = gi * STEP; tp[k + 1] = y; tp[k + 2] = gj * STEP;
    const hl = H[gj * NT + Math.max(0, gi - 1)], hr = H[gj * NT + Math.min(NT - 1, gi + 1)];
    const hu = H[Math.max(0, gj - 1) * NT + gi], hd = H[Math.min(NT - 1, gj + 1) * NT + gi];
    const dx = (hr - hl) / ((Math.min(NT - 1, gi + 1) - Math.max(0, gi - 1)) * STEP), dz = (hd - hu) / ((Math.min(NT - 1, gj + 1) - Math.max(0, gj - 1)) * STEP);
    const l = Math.hypot(dx, 1, dz); tnor[k] = -dx / l; tnor[k + 1] = 1 / l; tnor[k + 2] = -dz / l;
  }
  const tidx = new Uint32Array((tn - 1) * (tn - 1) * 6); let ti = 0;
  for (let j = 0; j < tn - 1; j++) for (let i = 0; i < tn - 1; i++) {
    const a = j * tn + i, b = a + 1, c = a + tn, d = c + 1;
    tidx[ti++] = a; tidx[ti++] = d; tidx[ti++] = b; tidx[ti++] = a; tidx[ti++] = c; tidx[ti++] = d;
  }
  out.terrain = { position: tp, normal: tnor, index: tidx };

  // ---------------- buildings (both LODs)
  out.buildings = buildBuildings(header, A, lod, hAt, ox, oz, lcAt);
  // ---------------- open water (both LODs): surfaces over the carved beds, and the level grid for swimming
  if (A.wl && A.wtP && A.wtP.length) { out.water = buildWater(A, hAt); out.wl = new Int16Array(A.wl); }
  if (lod) return out;

  // ---------------- surfaces
  const G = new Buf(1);
  const surf = (pre, id, lift, kerb) => {
    const C = A[pre + 'C'], R = A[pre + 'R'], P = A[pre + 'P'];
    let ci = 0, ri = 0;
    for (let pi = 0; pi < P.length; pi++) {
      const flat = [], holes = [], rings = [];
      for (let k = 0; k < P[pi]; k++) {
        const n = R[ri++];
        if (k) holes.push(flat.length / 2);
        const ring = [];
        for (let q = 0; q < n; q++) { const x = C[(ci + q) * 2] / 10, z = C[(ci + q) * 2 + 1] / 10; flat.push(x, z); ring.push([x, z]); }
        ci += n; rings.push(ring);
      }
      const t = earcut(flat, holes.length ? holes : null);
      for (let q = 0; q < t.length; q += 3) {
        const P3 = [t[q], t[q + 1], t[q + 2]].map(i => [flat[i * 2], hAt(flat[i * 2], flat[i * 2 + 1]) + lift, flat[i * 2 + 1]]);
        tri(G, P3[0], P3[1], P3[2], [0, 1, 0], null, [id]);
      }
      if (kerb) for (const ring of rings) for (let q = 0; q < ring.length; q++) {
        const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
        if ((Math.abs(x0 - x1) < 1e-3 && Math.abs(x0 / 32 - Math.round(x0 / 32)) < 1e-4) || (Math.abs(z0 - z1) < 1e-3 && Math.abs(z0 / 32 - Math.round(z0 / 32)) < 1e-4)) continue;
        const y0 = hAt(x0, z0), y1 = hAt(x1, z1);
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
        quad(G, [x0, y0 + 0.02, z0], [x1, y1 + 0.02, z1], [x1, y1 + lift, z1], [x0, y0 + lift, z0], [-dz / l, 0, dx / l], null, [2]);
      }
    }
  };
  surf('road', 0, 0.05, false);
  surf('plaza', 4, 0.09, false);
  surf('path', 3, 0.07, false);
  surf('pave', 1, 0.17, true);

  // ---------------- bridges (decks in ground mesh, structure in struct mesh)
  const S = new Buf(1);
  const bm = A.brM, bp = A.brP;
  let off = 0;
  for (let k = 0; k < bm.length; k += 4) {
    const n = bm[k], w = bm[k + 1], kind = bm[k + 2];
    const pts = []; for (let q = 0; q < n; q++) pts.push([bp[(off + q) * 3], bp[(off + q) * 3 + 1], bp[(off + q) * 3 + 2]]);
    off += n;
    ribbonDeck(G, S, pts, w, kind, hAt);
    if(kind===2) permanentWay(S,pts);
  }
  // ---------------- rails
  {
    const C = A.railC; let ci = 0;
    for (const n of A.railN) {
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      permanentWay(S,pts.map(([x,z])=>[x,hAt(x,z)+.12,z]));
      strip(G, pts, 0, 3.2, p => hAt(p[0], p[1]) + 0.12, 9);
    }
  }
  // ---------------- walls / fences / hedges
  const wallCol = [], hedgeSegs = [];
  // breakables (main thread: breakables.js). Each record is BR floats: kind, first vertex and vertex count in
  // the struct mesh, x0 z0 x1 z1 (a point prop keeps its heading in x1), thickness or radius, height,
  // attached-wire range, next-span range, ground y. Kinds: 1 telegraph pole, 2 wheelie bin, 3 litter bin,
  // 4 bench, 5 pillar box, 7 hedge section, 8 fence panel, 9 low garden wall section, 10 garden shrub
  const brk = [], vtx = () => S.p.length / 3;
  const brkRec = (kind, v0, x0, z0, x1, z1, th, h) => { brk.push(kind, v0, vtx() - v0, x0, z0, x1, z1, th, h, 0, 0, 0, 0, hAt(x0, z0)); return brk.length / BR - 1; };
  // hedges, fences and low walls are built in short sections, each its own breakable (not a static collider)
  const breakWall = (pts, th, h, id, kind, piece) => {
    for (let q = 0; q < pts.length - 1; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[q + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const n = Math.max(1, Math.round(L / piece));
      for (let i = 0; i < n; i++) {
        const A0 = [ax + (bx - ax) * i / n, az + (bz - az) * i / n], B0 = [ax + (bx - ax) * (i + 1) / n, az + (bz - az) * (i + 1) / n];
        const v0 = vtx();
        // a hedge's solid core sits inside its leafy bushes (plantings), which give it its shape
        if (id === 3) wall(S, [A0, B0], th * 0.62, h * 0.9, hAt, id); else wall(S, [A0, B0], th, h, hAt, id);
        brkRec(kind, v0, A0[0], A0[1], B0[0], B0[1], th, h);
      }
    }
  };
  {
    const C = A.wlC, M = A.wlM; let ci = 0;
    for (let k = 0; k < M.length; k += 3) {
      const n = M[k], kind = M[k + 1], h = M[k + 2];
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      if (kind === 6) continue; // tree rows handled as trees by the pipeline
      const th = kind === 2 ? 0.8 : kind === 1 ? 0.06 : kind === 5 ? 0.1 : 0.25;
      const id = kind === 2 ? 3 : kind === 1 ? 2 : kind === 5 ? 4 : 1;
      if (id === 3) for (let q = 0; q < pts.length - 1; q++) hedgeSegs.push(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], h, th);
      // hedges, fences and low walls give way to a car; walls, retaining walls and guard rails don't
      const bk = lod ? 0 : kind === 2 ? 7 : kind === 1 && h <= 2.2 ? 8 : kind === 0 && h <= 1.1 ? 9 : 0;
      if (bk) { breakWall(pts, th, h, id, bk, bk === 7 ? 1.6 : bk === 8 ? 1.9 : 1.2); continue; }
      wall(S, pts, th, h, hAt, id);
      if (id === 3) wall(S, pts, th * 0.62, h * 0.36, (x, z) => hAt(x, z) + h * 0.72, id);
      for (let q = 0; q < pts.length - 1; q++) wallCol.push(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], h);
    }
  }
  // ---------------- front gardens: boundary hedge / low wall with a driveway or path gap (inferred)
  for (const [x0, z0, x1, z1, nx, nz, t, seed, cls] of out.buildings.gardens || []) {
    const r = (seed * 7919) % 100 / 100, style = r < 0.4 ? 'hedge' : r < 0.82 ? 'wall' : 'open';
    const l = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / l, uz = (z1 - z0) / l;
    const drive = t > 4.5 && l > 6 && seed % 2 === 0;
    const gw = drive ? 3.0 : 1.1;
    const gs = drive ? (seed % 3 === 0 ? 0.3 : l - gw - 0.3) : (seed % 4 < 2 ? l * 0.3 : l * 0.62);
    const P = (s_, o) => [x0 + ux * s_ + nx * o, z0 + uz * s_ + nz * o];
    if (style !== 'open') {
      const h = style === 'hedge' ? 0.95 + r * 0.5 : 0.62, th = style === 'hedge' ? 0.6 : 0.24, id = style === 'hedge' ? 3 : 1;
      for (const [a, b] of [[-0.2, gs], [gs + gw, l + 0.2]]) if (b - a > 0.4) {
        const A0 = P(a, t), B0 = P(b, t);
        if (id === 3) hedgeSegs.push(A0[0], A0[1], B0[0], B0[1], h, th);
        if (!lod) { breakWall([A0, B0], th, h, id, id === 3 ? 7 : 9, id === 3 ? 1.6 : 1.2); continue; }
        wall(S, [A0, B0], th, h, hAt, id); if (id === 3) wall(S, [A0, B0], th * 0.62, h * 0.36, (x, z) => hAt(x, z) + h * 0.72, id);
        wallCol.push(A0[0], A0[1], B0[0], B0[1], h);
      }
    }
    // driveway (block paving or tarmac) or front path (flags) from the gap to the house
    const surfId = drive ? (seed % 5 < 3 ? 4 : 0) : 1, lift = drive ? 0.08 : 0.09;
    const a = P(gs, t + 0.3), b = P(gs + gw, t + 0.3), c = P(gs + gw, 0.05), d = P(gs, 0.05);
    const q = [a, b, c, d].map(([x, z]) => [x, hAt(x, z) + lift, z]);
    quad(G, q[0], q[1], q[2], q[3], [0, 1, 0], null, [surfId]);
    // wheelie bins by the house, away from the path (general waste black/grey, recycling blue or green)
    if (!lod && seed % 7 !== 0 && l > 3.5) {
      const sb = gs > l / 2 ? 0.45 : l - 1.35, ang = Math.atan2(uz, ux);
      for (let k = 0; k < (seed % 3 ? 2 : 1); k++) {
        const [bx, bz] = P(sb + k * 0.68, 0.55), y = hAt(bx, bz), v0 = vtx();
        wheelieBin(S, bx, y, bz, ang, k ? [11, 12][seed % 2] : (seed % 4 ? 10 : 17));
        if (!lod) brkRec(2, v0, bx, bz, ang, 0, 0.36, 1.1);
      }
    }
    // shrubs and a flower bed in the front garden, kept off the driveway
    if (!lod && style !== 'open') {
      const spots = [];
      if (gs > 1.3) spots.push(Math.max(0.4, gs * 0.45));
      if (l - (gs + gw) > 1.3) spots.push(Math.min(l - 0.4, gs + gw + (l - gs - gw) * 0.55));
      spots.forEach((sv, i) => {
        const [sx, sz] = P(sv, Math.min(Math.max(t * 0.42, 0.8), 2.2)), sv0 = vtx(), ss = 0.46 + ((seed + i) % 4) * 0.07;
        shrub(S, sx, hAt(sx, sz), sz, ss);
        if (!lod) brkRec(10, sv0, sx, sz, 0, 0, ss * 0.45, ss);
      });
      if (seed % 4 !== 0) {
        const sv = Math.min(l - 0.35, Math.max(0.35, drive ? gs + gw + 0.55 : l * 0.5));
        const [sx, sz] = P(sv, 0.45);
        bloom(S, sx, hAt(sx, sz), sz, Math.atan2(uz, ux), drive ? 0.75 : 1.2, [19, 20, 21][seed % 3]);
      }
    }
  }
  // ---------------- street life (inferred): telegraph poles and wires along residential roads, the odd
  // pillar box, litter bins and benches along pedestrian ways
  if (!lod && NET) {
    const inTile = (x, z) => x >= 0 && x < TILE && z >= 0 && z < TILE;
    // eave anchor of each house front (for telegraph drop wires): mid front wall, just under the eaves
    const drops = (out.buildings.gardens || []).map(([x0, z0, x1, z1, nx, nz, , , , eave]) => [(x0 + x1) / 2 + nx * 0.15, (z0 + z1) / 2 + nz * 0.15, eave, 0]);
    const h32i = v => { v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); return (v ^ (v >>> 16)) >>> 0; };
    for (const e of header.edges) {
      const cn = NET.classes[NET.cls[e]], st = NET.pstart[e], n = NET.pcount[e], w = NET.width[e];
      const pts = []; let cum = 0;
      for (let i = 0; i < n; i++) { const x = NET.pts[(st + i) * 3] - ox, z = NET.pts[(st + i) * 3 + 2] - oz; if (i) cum += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]); pts.push([x, z, cum]); }
      if (cum < 10) continue;
      const at = (sv, off) => {
        let i = 1; while (i < pts.length - 1 && pts[i][2] < sv) i++;
        const a = pts[i - 1], b = pts[i], L = Math.max(1e-3, b[2] - a[2]), t = Math.min(1, Math.max(0, (sv - a[2]) / L));
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        return [a[0] + (b[0] - a[0]) * t - dz * off, a[1] + (b[1] - a[1]) * t + dx * off, Math.atan2(dz, dx)];
      };
      const hh = h32i(e + 7);
      if (/^(residential|unclassified|living_street)$/.test(cn) && hh % 5 < 3) {
        const side = hh & 1 ? 1 : -1, off = side * (w / 2 + 0.9), sp = 32, s0 = 4 + (hh % 14);
        let prev = null;
        for (let sv = s0; sv < cum - 4; sv += sp) {
          const [x, z] = at(sv, off); if (!inTile(x, z)) { prev = null; continue; }
          const y = hAt(x, z), top = y + 8.4, p0 = vtx();
          box(S, x, y, z, 0, 0.13, 4.2, 0.13, 15);
          const [, , ang] = at(sv, off);
          box(S, x, top - 0.35, z, ang + Math.PI / 2, 0.55, 0.05, 0.06, 15);
          const rec = brkRec(1, p0, x, z, ang, 0, 0.15, 8.4), w0 = vtx();
          // service drops: the fan of thin cables from the pole to the eaves of the nearest houses
          let nd = 0;
          for (const g of drops) {
            if (nd >= 5) break;
            const ddx = g[0] - x, ddz = g[1] - z, dd = ddx * ddx + ddz * ddz;
            if (dd > 26 * 26 || dd < 9 || g[3]) continue;
            g[3] = 1; nd++;
            sagWire(S, [x, top - 0.55, z], [g[0], g[2] - 0.25, g[1]], 0.25 + Math.sqrt(dd) * 0.012, 3);
          }
          if (prev) {
            const s0 = vtx();
            for (const o of [-0.4, 0, 0.4]) sagWire(S, [prev[0] + Math.cos(prev[2] + Math.PI / 2) * o, prev[1] - 0.3, prev[3] + Math.sin(prev[2] + Math.PI / 2) * o], [x + Math.cos(ang + Math.PI / 2) * o, top - 0.3, z + Math.sin(ang + Math.PI / 2) * o], 0.45);
            // the span hangs between two poles, so either one falling takes it down: it is the tail of this
            // pole's wire range and the earlier pole's 'next span'
            brk[prev[4] * BR + 11] = s0; brk[prev[4] * BR + 12] = vtx() - s0;
          }
          brk[rec * BR + 9] = w0; brk[rec * BR + 10] = vtx() - w0;                 // drop wires + span back
          prev = [x, top, ang, z, rec];
        }
        if (hh % 23 === 0) { const [x, z, ang] = at(Math.min(8, cum / 2), -side * (w / 2 + 0.7)); if (inTile(x, z)) { const v0 = vtx(); pillarBox(S, x, hAt(x, z), z, ang); brkRec(5, v0, x, z, ang, 0, 0.27, 1.56); } }
      }
      if (header.core && /^(primary|secondary|tertiary)$/.test(cn)) {
        // high-street furniture on the pavement edge: litter bins, the odd bench
        for (let sv = 10 + (hh % 25); sv < cum - 6; sv += 42) {
          const sd = (Math.round(sv) & 1) ? 1 : -1, [x, z, ang] = at(sv, sd * (w / 2 + 0.55)); if (!inTile(x, z)) continue;
          const y = hAt(x, z) + 0.15, v0 = vtx();
          if ((h32i(e * 17 + Math.round(sv)) % 5) === 0) { bench(S, x, y, z, ang + (sd > 0 ? 0 : Math.PI)); brkRec(4, v0, x - Math.cos(ang) * 0.9, z - Math.sin(ang) * 0.9, x + Math.cos(ang) * 0.9, z + Math.sin(ang) * 0.9, 0.5, 0.75); }
          else { litterBin(S, x, y, z); brkRec(3, v0, x, z, 0.3, 0, 0.29, 1.05); }
        }
      }
      if (/^(pedestrian|footway)$/.test(cn) && (header.core || /pedestrian/.test(cn))) {
        for (let sv = 8 + (hh % 20); sv < cum - 3; sv += 32) {
          const [x, z, ang] = at(sv, (hh & 2 ? 1 : -1) * (w / 2 + 0.5)); if (!inTile(x, z)) continue;
          const y = hAt(x, z) + 0.1, v0 = vtx();
          if ((h32i(e * 31 + Math.round(sv)) & 3) === 0) { bench(S, x, y, z, ang); brkRec(4, v0, x - Math.cos(ang) * 0.9, z - Math.sin(ang) * 0.9, x + Math.cos(ang) * 0.9, z + Math.sin(ang) * 0.9, 0.5, 0.75); }
          else { litterBin(S, x, y, z); brkRec(3, v0, x, z, 0.3, 0, 0.29, 1.05); }
        }
      }
    }
    // shop planters on the pavement in front of a retail frontage
    for (const [x0, z0, x1, z1, nx, nz, len, seed] of out.buildings.planters || []) {
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, ang = Math.atan2(uz, ux);
      for (const f of [0.22, 0.78]) {
        const x = x0 + ux * len * f + nx * 0.45, z = z0 + uz * len * f + nz * 0.45;
        if (x < 0 || z < 0 || x >= TILE || z >= TILE) continue;
        bloom(S, x, hAt(x, z), z, ang, 0.85, [19, 21, 20][seed % 3]);
      }
    }
  }
  if (wallCol.length) {
    const B = out.buildings, col = Array.from(B.col), pts = Array.from(B.colPts);
    for (let k = 0; k < wallCol.length; k += 5) {
      const x0 = wallCol[k], z0 = wallCol[k + 1], x1 = wallCol[k + 2], z1 = wallCol[k + 3], base = Math.min(hAt(x0, z0), hAt(x1, z1));
      col.push(pts.length / 2, 2, base + wallCol[k + 4], base); pts.push(x0 + ox, z0 + oz, x1 + ox, z1 + oz);
    }
    B.col = new Float32Array(col); B.colPts = new Float32Array(pts);
  }
  out.ground = G.pack();
  out.struct = S.pack();
  out.brk = new Float32Array(brk);
  out.markings = buildMarkings(header, ox, oz, hAt);

  // ---------------- instances: trees, lamps, slots
  const tr = A.tr, trees = new Float32Array(tr.length);
  for (let k = 0; k < tr.length; k += 4) { trees[k] = tr[k]; trees[k + 1] = hAt(tr[k], tr[k + 1]); trees[k + 2] = tr[k + 1]; trees[k + 3] = tr[k + 2] + (tr[k + 3] || 0) * 10; }
  out.trees = trees;
  // ---------------- planting (inferred): leafy hedges, shrubs and extra trees in open green space
  if (!lod) {
    const P = plantings(header, lcAt, hAt, trees, hedgeSegs);
    out.bushes = P.bushes;
    if (P.trees.length) { const t2 = new Float32Array(trees.length + P.trees.length); t2.set(trees); t2.set(P.trees, trees.length); out.trees = t2; }
  }
  const lp = A.lp, lamps = new Float32Array(lp.length);
  for (let k = 0; k < lp.length; k += 4) { lamps[k] = lp[k]; lamps[k + 1] = hAt(lp[k], lp[k + 1]) + 0.17; lamps[k + 2] = lp[k + 1]; lamps[k + 3] = lp[k + 2]; }
  out.lamps = lamps;
  const pk = A.pk, slots = new Float32Array(pk.length);
  for (let k = 0; k < pk.length; k += 4) { slots[k] = pk[k]; slots[k + 1] = hAt(pk[k], pk[k + 1]) + 0.05; slots[k + 2] = pk[k + 1]; slots[k + 3] = pk[k + 2]; }
  out.slots = slots; out.slotKind = new Float32Array(Array.from({ length: pk.length / 4 }, (_, i) => pk[i * 4 + 3]));
  out.signs = mergeSigns(header, A, out.buildings.fascias || []);
  delete out.buildings.fascias;
  return out;
}

// ---- street props (struct mesh; surf ids 10.. map to colours in materials.structMaterial)
function shrub(B, x, y, z, s) {
  box(B, x, y, z, 0.4, s * 0.48, s * 0.34, s * 0.42, 18);
  box(B, x + s * 0.08, y + s * 0.5, z, 1.2, s * 0.32, s * 0.24, s * 0.3, 18);
}
function bloom(B, x, y, z, ang, len, id) {
  box(B, x, y, z, ang, len * 0.5, 0.06, 0.18, 18);
  box(B, x, y + 0.1, z, ang, len * 0.42, 0.06, 0.14, id);
}
function box(B, x, y, z, ang, hx, hy, hz, id) {
  const ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v, w) => [x + u * ca - w * sa, y + v, z + u * sa + w * ca];
  const c = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  for (let k = 0; k < 4; k++) {
    const [u0, w0] = c[k], [u1, w1] = c[(k + 1) % 4], mu = (u0 + u1) / 2, mw = (w0 + w1) / 2;
    quad(B, P(u0, 0, w0), P(u1, 0, w1), P(u1, 2 * hy, w1), P(u0, 2 * hy, w0), [mu * ca - mw * sa, 0, mu * sa + mw * ca], [[0, 0], [1, 0], [1, 1], [0, 1]], [id]);
  }
  quad(B, P(-hx, 2 * hy, -hz), P(hx, 2 * hy, -hz), P(hx, 2 * hy, hz), P(-hx, 2 * hy, hz), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [id]);
}
function wheelieBin(B, x, y, z, ang, lidId) {
  box(B, x, y + 0.08, z, ang, 0.29, 0.48, 0.34, lidId === 17 ? 17 : 10);
  box(B, x, y + 1.04, z - 0.0, ang, 0.31, 0.025, 0.37, lidId);
  for (const sd of [-1, 1]) box(B, x - Math.sin(ang) * sd * 0.24 - Math.cos(ang) * 0.0, y, z + Math.cos(ang) * sd * 0.24, ang, 0.1, 0.1, 0.03, 17);
}
function pillarBox(B, x, y, z, ang) {
  box(B, x, y, z, ang, 0.24, 0.72, 0.24, 13);
  box(B, x, y + 1.44, z, ang, 0.28, 0.06, 0.28, 13);
  box(B, x, y + 1.25, z, ang, 0.245, 0.02, 0.18, 17);
}
function litterBin(B, x, y, z) { box(B, x, y, z, 0.3, 0.26, 0.5, 0.26, 17); box(B, x, y + 1.0, z, 0.3, 0.28, 0.04, 0.28, 17); }
function bench(B, x, y, z, ang) {
  box(B, x, y + 0.42, z, ang, 0.9, 0.025, 0.22, 16);
  box(B, x - Math.sin(ang) * -0.2, y + 0.55, z + Math.cos(ang) * -0.2, ang, 0.9, 0.18, 0.025, 16);
  for (const sd of [-0.8, 0.8]) box(B, x + Math.cos(ang) * sd, y, z + Math.sin(ang) * sd, ang, 0.03, 0.22, 0.2, 17);
}
// sagging cable between two points (catenary approximated by 4 straight spans)
function sagWire(B, a, b, sag, N = 4) {
  let p0 = a;
  for (let i = 1; i <= N; i++) {
    const t = i / N, y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
    const p1 = [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz) || 1, px = -dz / L * 0.02, pz = dx / L * 0.02;
    quad(B, [p0[0] - px, p0[1], p0[2] - pz], [p1[0] - px, p1[1], p1[2] - pz], [p1[0] + px, p1[1] + 0.03, p1[2] + pz], [p0[0] + px, p0[1] + 0.03, p0[2] + pz], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [14]);
    quad(B, [p0[0] - px, p0[1], p0[2] - pz], [p1[0] - px, p1[1], p1[2] - pz], [p1[0] + px, p1[1] + 0.03, p1[2] + pz], [p0[0] + px, p0[1] + 0.03, p0[2] + pz], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [14]);
    p0 = p1;
  }
}

// polyline strip (flat quads along a 2D polyline at lateral offset)
function strip(B, pts, offset, width, yfn, id, dashOn = 0, dashOff = 0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l, nz = dx / l;
    const a = [x0 + nx * (offset - width / 2), 0, z0 + nz * (offset - width / 2)], b = [x1 + nx * (offset - width / 2), 0, z1 + nz * (offset - width / 2)];
    const c = [x1 + nx * (offset + width / 2), 0, z1 + nz * (offset + width / 2)], d = [x0 + nx * (offset + width / 2), 0, z0 + nz * (offset + width / 2)];
    for (const p of [a, b, c, d]) p[1] = yfn([p[0], p[2]]);
    quad(B, a, b, c, d, [0, 1, 0], null, [id]);
  }
}

// Planting for open ground (inferred). Bushes: [x, y, z, sx, sy, sz, yaw, tint] per instance, drawn by tiles.js
// with the tree-crown leaf material. Hedges become rows of overlapping leafy bushes over their box core;
// grass, parks, gardens, scrub, woods, cemeteries and allotments get shrubs and a few extra trees, never
// within 2.5 m of a road, pavement, path, car park, building, pitch or water.
const PLANT = { 0: [0.011, 0.0024], 5: [0.03, 0], 6: [0.0015, 0.0004], 7: [0.022, 0.0042], 11: [0.022, 0.0014], 14: [0.012, 0], 15: [0.05, 0.0012], 16: [0.012, 0.002], 18: [0.012, 0.0008] };
const HARD = new Set([1, 2, 3, 4, 8, 9, 10, 12, 13, 17]);
function plantings(header, lcAt, hAt, trees, hedgeSegs) {
  let seed = (header.ix * 73856093 ^ header.iz * 19349663) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const bushes = [], extra = [];
  // hedges: elongated leafy bushes every ~1.5 m along each segment, a little taller and wider than the core
  for (let k = 0; k < hedgeSegs.length; k += 6) {
    const x0 = hedgeSegs[k], z0 = hedgeSegs[k + 1], x1 = hedgeSegs[k + 2], z1 = hedgeSegs[k + 3], h = hedgeSegs[k + 4], th = hedgeSegs[k + 5];
    const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.3) continue;
    const n = Math.max(1, Math.round(L / 1.5)), yaw = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
      if (x < 0 || x >= 256 || z < 0 || z >= 256) continue;
      const hh = h * (1.02 + rnd() * 0.12);
      bushes.push(x, hAt(x, z) + hh * 0.5, z, L / n * 0.95 + 0.35, hh * 0.6, th * 1.3 + 0.3, yaw, 2);
    }
  }
  // open ground: jittered grid at 3 m, density by landcover class
  const clear = (x, z, r) => {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= 256 || zz >= 256) continue;
      if (HARD.has(lcAt(xx, zz))) return false;
    }
    return true;
  };
  const nearTree = (x, z, r) => { for (let k = 0; k < trees.length; k += 4) { const dx = trees[k] - x, dz = trees[k + 2] - z; if (dx * dx + dz * dz < r * r) return true; } return false; };
  for (let gz = 1.5; gz < 256; gz += 3) for (let gx = 1.5; gx < 256; gx += 3) {
    const x = gx + (rnd() - 0.5) * 2.6, z = gz + (rnd() - 0.5) * 2.6, c = lcAt(x, z), d0 = PLANT[c];
    if (!d0) continue;
    // planting gathers along edges (4-10 m from paths, roads, buildings); mown open middles stay mostly clear
    const edge = !clear(x, z, 9) ? 2.5 : c === 15 || c === 5 ? 0.8 : 0.12, d = [d0[0] * edge, d0[1] * (edge > 1 ? 1.6 : 0.8)];
    const r = rnd();
    if (r < d[0] * 9) {
      if (!clear(x, z, 2.5) || nearTree(x, z, 2.2)) continue;
      // shrubs in loose clumps of one to four, one species per clump; widths are full widths, the
      // height is a half-height (tiles.js halves x and z), and each sits a little sunk so no base shows
      const n = rnd() < 0.55 ? 2 + Math.floor(rnd() * 3) : 1, big = c === 15 || c === 5 ? 1.3 : 1;
      const tint = c === 16 ? 2 : c === 15 && rnd() < 0.3 ? 4 : rnd() < 0.1 ? 5 : rnd() < 0.12 ? 3 : Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const bx = x + (rnd() - 0.5) * 2.6 * (n > 1), bz = z + (rnd() - 0.5) * 2.6 * (n > 1);
        if (n > 1 && !clear(bx, bz, 2)) continue;
        const w = big * (1.3 + rnd() * 1.5), hy = w * (0.3 + rnd() * 0.16);
        bushes.push(bx, hAt(bx, bz) + hy * 0.72, bz, w * (0.85 + rnd() * 0.3), hy, w * (0.85 + rnd() * 0.3), rnd() * 6.28, tint);
      }
    } else if (r < d[0] * 9 + d[1] * 9) {
      if (!clear(x, z, 4.5) || nearTree(x, z, 7)) continue;
      // tree code as in the pipeline: kind (0 broadleaf, 1 tall, 2 small/ornamental, 3 conifer) + 10 x height tag
      const kind = c === 16 ? 3 : c === 11 ? 2 : rnd() < 0.2 ? 1 : rnd() < 0.35 ? 2 : 0;
      extra.push(x, hAt(x, z), z, kind);
      trees = Float32Array.from([...trees, x, 0, z, 0]);   // keep spacing between new trees too
    }
  }
  return { bushes: new Float32Array(bushes), trees: new Float32Array(extra) };
}

function wall(B, pts, th, h, hAt, id) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l * th / 2, nz = dx / l * th / 2;
    const y0 = hAt(x0, z0) - 0.2, y1 = hAt(x1, z1) - 0.2, t0 = y0 + 0.2 + h, t1 = y1 + 0.2 + h;
    const L = [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz]], R = [[x0 - nx, z0 - nz], [x1 - nx, z1 - nz]];
    quad(B, [L[0][0], y0, L[0][1]], [L[1][0], y1, L[1][1]], [L[1][0], t1, L[1][1]], [L[0][0], t0, L[0][1]], [nx, 0, nz], [[0, 0], [l, 0], [l, h], [0, h]], [id]);
    quad(B, [R[0][0], y0, R[0][1]], [R[1][0], y1, R[1][1]], [R[1][0], t1, R[1][1]], [R[0][0], t0, R[0][1]], [-nx, 0, -nz], [[0, 0], [l, 0], [l, h], [0, h]], [id]);
    quad(B, [L[0][0], t0, L[0][1]], [L[1][0], t1, L[1][1]], [R[1][0], t1, R[1][1]], [R[0][0], t0, R[0][1]], [0, 1, 0], null, [id]);
    if (i === 0) quad(B, [L[0][0], y0, L[0][1]], [R[0][0], y0, R[0][1]], [R[0][0], t0, R[0][1]], [L[0][0], t0, L[0][1]], [-dx, 0, -dz], null, [id]);
    if (i === pts.length - 2) quad(B, [L[1][0], y1, L[1][1]], [R[1][0], y1, R[1][1]], [R[1][0], t1, R[1][1]], [L[1][0], t1, L[1][1]], [dx, 0, dz], null, [id]);
  }
}

// Batched top faces follow the same elevation profile as each mapped track section.
function permanentWay(buf,pts){
  let nextSleeper=.3;
  for(let i=1;i<pts.length;i++){
    const [x,y,z]=pts[i-1],[ex,ey,ez]=pts[i],len=Math.hypot(ex-x,ez-z);
    if(len<.01)continue;
    const dx=(ex-x)/len,dz=(ez-z)/len;
    function panel(start,end,left,right,lift,id){
      const vertex=(a,b)=>[x+a*dx-b*dz,y+(ey-y)*a/len+lift,z+a*dz+b*dx];
      quad(buf,vertex(start,left),vertex(start,right),vertex(end,right),vertex(end,left),[0,1,0],null,[id]);
    }
    for(;nextSleeper<len;nextSleeper+=.68){
      panel(nextSleeper,Math.min(len,nextSleeper+.22),-1.22,1.22,.055,0);
    }
    nextSleeper-=len;
    for(const gauge of [-.7175,.7175]){
      panel(0,len,gauge-.07,gauge+.07,.08,2);
      panel(0,len,gauge-.034,gauge+.034,.15,6);
    }
  }
}
function ribbonDeck(G, S, pts, w, kind, hAt) {
  // deck surface (ground mesh, surf 5 road / 6 foot / 7 rail deck) + sides, parapets, piers (struct)
  const surfId = kind === 0 ? 5 : kind === 1 ? 6 : 7;
  const hw = w / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.05) continue;
    const nx = -dz / l, nz = dx / l;
    const e = hw + 0.4;
    const a = [x0 + nx * e, y0, z0 + nz * e], b = [x1 + nx * e, y1, z1 + nz * e], c = [x1 - nx * e, y1, z1 - nz * e], d = [x0 - nx * e, y0, z0 - nz * e];
    quad(G, a, b, c, d, [0, 1, 0], null, [surfId]);
    for (const s of [1, -1]) {
      const ex = nx * e * s, ez = nz * e * s;
      // side face down 1.1 m
      quad(S, [x0 + ex, y0 - 1.2, z0 + ez], [x1 + ex, y1 - 1.2, z1 + ez], [x1 + ex, y0 === y0 ? y1 : y1, z1 + ez], [x0 + ex, y0, z0 + ez], [nx * s, 0, nz * s], null, [0]);
      // parapet 1.1 m high, 0.3 thick
      const ix = nx * (e - 0.3) * s, iz = nz * (e - 0.3) * s;
      quad(S, [x0 + ex, y0, z0 + ez], [x1 + ex, y1, z1 + ez], [x1 + ex, y1 + 1.1, z1 + ez], [x0 + ex, y0 + 1.1, z0 + ez], [nx * s, 0, nz * s], null, [0]);
      quad(S, [x0 + ix, y0, z0 + iz], [x1 + ix, y1, z1 + iz], [x1 + ix, y1 + 1.1, z1 + iz], [x0 + ix, y0 + 1.1, z0 + iz], [-nx * s, 0, -nz * s], null, [0]);
      quad(S, [x0 + ix, y0 + 1.1, z0 + iz], [x1 + ix, y1 + 1.1, z1 + iz], [x1 + ex, y1 + 1.1, z1 + ez], [x0 + ex, y0 + 1.1, z0 + ez], [0, 1, 0], null, [0]);
    }
    // underside
    quad(S, [a[0], y0 - 1.2, a[2]], [b[0], y1 - 1.2, b[2]], [c[0], y1 - 1.2, c[2]], [d[0], y0 - 1.2, d[2]], [0, -1, 0], null, [0]);
  }
  // piers every ~22 m where the deck is well above ground
  let acc = 11;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    const l = Math.hypot(x1 - x0, z1 - z0);
    while (acc < l) {
      const t = acc / l, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      const g = hAt(x, z);
      if (y - g > 3) {
        const dx = (x1 - x0) / l, dz = (z1 - z0) / l, nx = -dz, nz = dx;
        for (const s of (w > 8 ? [-hw * 0.6, hw * 0.6] : [0])) {
          const cx = x + nx * s, cz = z + nz * s, r = 0.55;
          const P = [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];
          for (let q = 0; q < 4; q++) {
            const [ax, az] = P[q], [bx, bz] = P[(q + 1) % 4];
            quad(S, [ax, g - 0.5, az], [bx, g - 0.5, bz], [bx, y - 1.2, bz], [ax, y - 1.2, az], [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz], null, [0]);
          }
        }
      }
      acc += 22;
    }
    acc -= l;
  }
}

// ------------------------------------------------------------------ buildings
function floorHOf(M, bi) {
  if (!M || bi < 0 || (bi + 1) * 16 > M.length) return 3.2;
  const wall = M[bi * 16 + 2], lv = M[bi * 16 + 11];
  if (!(wall > 0)) return 3.2;
  return Math.max(2.5, Math.min(5.4, wall / Math.max(1, lv || 1)));
}
function mergeSigns(header, A, fascias) {
  const data = [], text = [];
  const sg = A.sg && A.sg.length ? A.sg : new Float32Array(0);
  const sn = header.sn || [];
  const nSign = Math.min(sn.length, Math.floor(sg.length / 7));
  const closeToFascia = (x0, z0, x1, z1) => {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (const f of fascias) {
      const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
      const half = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) * 0.5 + 1.6;
      if (Math.hypot(mx - fx, mz - fz) < half) return true;
    }
    return false;
  };
  for (let i = 0; i < nSign; i++) {
    const name = sn[i] || '';
    if (!name) continue;
    const bi = sg[i * 7 + 5] | 0;
    const key = normName(name);
    if (fascias.some(f => f.bi === bi && normName(f.name) === key)) continue;
    let x0 = sg[i * 7], z0 = sg[i * 7 + 1], x1 = sg[i * 7 + 2], z1 = sg[i * 7 + 3];
    if (closeToFascia(x0, z0, x1, z1)) continue;
    const ring = outerRing(A, bi);
    if (ring) [x0, z0, x1, z1] = faceOut(ring, x0, z0, x1, z1);
    const brand = fasciaBrand(name, true);
    const box = signBox(brand, floorHOf(A.bM, bi));
    data.push(x0, z0, x1, z1, sg[i * 7 + 4], box.dy, box.h);
    text.push(name);
  }
  for (const f of fascias) {
    data.push(f.x0, f.z0, f.x1, f.z1, f.base, f.dy, f.h);
    text.push(f.name);
  }
  return { data: new Float32Array(data), text };
}
function outerRing(A, bi) {
  const P = A.bP, R = A.bR, C = A.bC;
  if (!P || bi < 0 || bi >= P.length) return null;
  let ri = 0, ci = 0;
  for (let i = 0; i < bi; i++) for (let k = 0; k < P[i]; k++) ci += R[ri++];
  if (ri >= R.length) return null;
  const n = R[ri], ring = [];
  for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
  return ring.length > 2 ? ring : null;
}
function insideRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-9) + xi) c = !c;
  }
  return c;
}
// Street side of an edge. Returns the segment ordered so (dz, -dx) points out of the footprint.
function faceOut(ring, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
  const nx = dz / L, nz = -dx / L, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (insideRing(ring, mx + nx * 0.7, mz + nz * 0.7)) return [x1, z1, x0, z0];
  return [x0, z0, x1, z1];
}
function edgeFrame(ring, q) {
  const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 2.2) return null;
  let nx = dz / L, nz = -dx / L;
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (insideRing(ring, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
  return { q, L, nx, nz, mx, mz, x0, z0, x1, z1 };
}
// Name board on the street face, just proud of the fascia. No canopy — that was hiding the lettering.
function placeFascia(fascias, ring, edge, baseRel, floorH, brand, bi) {
  const e = edgeFrame(ring, edge);
  if (!e || e.L < 2.3) return null;
  const [ax, az, bx, bz] = faceOut(ring, e.x0, e.z0, e.x1, e.z1);
  const dx = bx - ax, dz = bz - az, fl = Math.hypot(dx, dz) || 1;
  const tx = dx / fl, tz = dz / fl, nx = dz / fl, nz = -dx / fl;
  const box = signBox(brand, floorH);
  const wide = !!(brand.canopy && fl >= 14);
  let w = Math.min(fl - 0.3, wide ? Math.min(16, Math.max(9, fl * 0.42)) : fl - 0.2);
  if (w < 2.1) return null;
  const c0 = (fl - w) / 2, out = 0.06;
  let uF = 0;
  for (let q = 0; q < edge; q++) {
    const [px, pz] = ring[q], [qx, qz] = ring[(q + 1) % ring.length];
    const l = Math.hypot(qx - px, qz - pz); if (l >= 0.02) uF += l;
  }
  const doorT = brand.canopy ? 0.5 : 0.72;
  fascias.push({
    x0: ax + tx * c0 + nx * out, z0: az + tz * c0 + nz * out,
    x1: ax + tx * (c0 + w) + nx * out, z1: az + tz * (c0 + w) + nz * out,
    base: baseRel, dy: box.dy, h: box.h, name: brand.label, bi,
  });
  return { fl, box, doorU: uF + e.L * doorT };
}
function buildBuildings(header, A, lod, hAt, ox, oz, lcAt) {
  const B = new Buf(4);
  const C = A.bC, R = A.bR, P = A.bP, M = A.bM, hmin = header.hmin;
  const NM = 16;
  // nearby drive-edge segments for frontage detection
  const segs = [];
  const walkSegs = [];
  if (!lod && NET) for (const e of header.edges) {
    const drive = NET.driveCls.has(NET.cls[e]);
    const cn = NET.classes[NET.cls[e]];
    if (!drive && !/pedestrian|footway/.test(cn)) continue;
    const s = NET.pstart[e], n = NET.pcount[e], dst = drive ? segs : walkSegs;
    for (let i = 0; i < n - 1; i++) { const a = (s + i) * 3, b = a + 3; dst.push(NET.pts[a] - ox, NET.pts[a + 2] - oz, NET.pts[b] - ox, NET.pts[b + 2] - oz, NET.width[e] / 2); }
  }
  // distance to the nearest centreline (edge=false) or carriageway edge (edge=true)
  const segDist = (x, z, list = segs, edge = false) => {
    let best = 1e9;
    for (let k = 0; k < list.length; k += 5) {
      const ax = list[k], az = list[k + 1], vx = list[k + 2] - ax, vz = list[k + 3] - az, L2 = vx * vx + vz * vz || 1;
      let t = ((x - ax) * vx + (z - az) * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      let d = Math.hypot(ax + vx * t - x, az + vz * t - z); if (edge) d -= list[k + 4];
      if (d < best) best = d;
    }
    return best;
  };
  const col = []; // collision: per building [ringStart, ringLen, top, base]
  const landmarks = [], destinations = [];
  const gardens = [];
  const planters = [];
  const fascias = [];
  const colPts = [];
  const poiOn = new Set();
  if (!lod && A.sg && header.sn) {
    const nSign = Math.min(header.sn.length, Math.floor(A.sg.length / 7));
    for (let i = 0; i < nSign; i++) if (header.sn[i]) poiOn.add(A.sg[i * 7 + 5] | 0);
  }
  let ci = 0, ri = 0;
  for (let bi = 0; bi < P.length; bi++) {
    const m = M.subarray(bi * NM, bi * NM + NM);
    const base = m[0] + hmin, low = m[1] + hmin - 0.6, wallH = m[2], roof = m[3], rh = m[4];
    const rcx = m[5], rcz = m[6], rang = m[7], rL = m[8], rW = m[9], cls = m[10], lv = m[11], seed = m[13];
    const bname = (header.bn && header.bn[bi]) || '';
    const retail = m[12] > 0 || cls === 6 || cls === 7;
    const brand = (!lod && fasciaBrand(bname, retail)) || null;
    // named commercial / retail units are shops even when only the name is tagged (e.g. amenity=pharmacy)
    const shop = m[12] || ((cls === 6 || cls === 7) && bname) || brand || poiOn.has(bi) ? 1 : 0;

    if (cls === 13) { for (let k = 0; k < P[bi]; k++) ci += R[ri++]; continue; } // canopies are drawn by landmarks.js
    // a supermarket is one tall retail front, not two floors of brick with a garage door
    const retailBox = !!(brand && brand.canopy);
    const floorH = retailBox
      ? Math.max(3.4, Math.min(9.2, wallH))
      : Math.max(2.4, Math.min(5, wallH / Math.max(1, lv || 1)));
    const rings = [];
    for (let k = 0; k < P[bi]; k++) {
      const n = R[ri++], ring = [];
      for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n; rings.push(ring);
    }
    const outer = rings[0];
    if(cls<=3 || shop || [6,7,8,10].includes(cls))destinations.push({x:ox+outer.reduce((sum,v)=>sum+v[0],0)/outer.length,z:oz+outer.reduce((sum,v)=>sum+v[1],0)/outer.length,kind:shop||cls===7?'shop':cls<=3?'home':'work',name:header.bn[bi]||''});
    if (m[14] > 0.5) { // hand-authored landmark: hand the footprint over, keep collision
      landmarks.push({ name: header.bn[bi], ring: outer.map(([x, z]) => [x + ox, z + oz]), base, wall: wallH });
      col.push(colPts.length / 2, outer.length, header.bn[bi] === 'Cemetery Arch' ? base - 1 : base + wallH + 4, base);
      for (const [x, z] of outer) colPts.push(x + ox, z + oz);
      continue;
    }
    const pitched = roof > 0 && rL > 0 && !lod;
    const top = base + wallH + (lod && roof ? rh * 0.45 : 0);
    const parapet = !pitched && !lod && (cls === 3 || cls === 6 || cls === 7 || cls === 11) ? 0.6 : 0;
    // public faces. Sample landcover OUTSIDE the footprint (rings are not always CCW).
    let front = -1;
    const street = [];
    if (!lod && outer && outer.length > 2) {
      const scored = [];
      for (let q = 0; q < outer.length; q++) {
        const fr = edgeFrame(outer, q);
        if (!fr || fr.L < 2.4) continue;
        const px = fr.mx + fr.nx * 2.4, pz = fr.mz + fr.nz * 2.4;
        const c = lcAt(Math.floor(px), Math.floor(pz));
        let d = segs.length ? segDist(fr.mx, fr.mz) : 36;
        if (shop && walkSegs.length) d = Math.min(d, segDist(fr.mx, fr.mz, walkSegs) - 6);
        if (shop && (c === 12 || c === 2 || c === 17 || c === 8)) d -= 16;
        if (c === 3) d += 50;
        scored.push({ q, d, L: fr.L, c });
      }
      if (scored.length) {
        const net = segs.length || walkSegs.length;
        if (!net) scored.sort((a, b) => b.L - a.L);
        else scored.sort((a, b) => a.d - b.d);
        const best = scored[0];
        if (!net || best.d < 42) front = best.q;
        if (shop && front >= 0) {
          const primary = edgeFrame(outer, front);
          const pool = scored.filter(s => s.c !== 3 && s.L >= 3.4 && (!net || s.d < Math.min(24, best.d + 8)));
          pool.sort((a, b) => b.L - a.L);
          street.push(front);
          for (const s of pool) {
            if (s.q === front || !primary) continue;
            const fr = edgeFrame(outer, s.q);
            if (!fr) continue;
            const dot = primary.nx * fr.nx + primary.nz * fr.nz;
            if (Math.abs(dot) > 0.5) continue;
            street.push(s.q);
            break;
          }
        }
      }
    }
    if (!lod && (shop || brand) && front < 0 && outer) {
      let bl = 0, bq = -1;
      for (let q = 0; q < outer.length; q++) {
        const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length];
        const l = Math.hypot(bx - ax, bz - az);
        if (l > bl) { bl = l; bq = q; }
      }
      if (bl >= 2.4) { front = bq; if (shop && !street.length) street.push(bq); }
    }
    const clsCode = cls + (shop ? 32 : 0) + (brand ? brand.id * 64 : 0);
    // front door and bay window positions are chosen here (so the door hood and bay line up with the
    // painted door); the door's u coordinate along the wall rides in the seed attribute
    let seedEnc = seed, frontInfo = null;
    if (!lod && front >= 0 && (cls === 1 || cls === 2) && !shop) {
      let uF = 0;
      for (let q = 0; q < front; q++) { const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length]; const l = Math.hypot(bx - ax, bz - az); if (l >= 0.02) uF += l; }
      const [ox0, oz0] = outer[front], [ox1, oz1] = outer[(front + 1) % outer.length], fl = Math.hypot(ox1 - ox0, oz1 - oz0);
      if (fl >= 2.2) {
        const dT0 = fl < 4.7 ? 0.5 : (seed % 2 ? 0.27 : 0.73);
        const doorU = uF + fl * dT0;
        seedEnc = seed + 1000 * Math.round(doorU * 4);
        const [x0, z0, x1, z1] = faceOut(outer, ox0, oz0, ox1, oz1);
        const flipped = x0 !== ox0 || z0 !== oz0;
        frontInfo = { x0, z0, x1, z1, fl, dT: flipped ? 1 - dT0 : dT0 };
      }
    }
    if (front >= 0 && (cls === 1 || cls === 2) && !shop) {
      const fr = edgeFrame(outer, front);
      if (fr && fr.L >= 4) {
        const ce = segDist(fr.mx, fr.mz, segs, true);
        const t = ce - 2.1;
        if (t >= 1.6 && t <= 14) gardens.push([fr.x0, fr.z0, fr.x1, fr.z1, fr.nx, fr.nz, t, seed, cls, base + wallH]);
      }
    }
    if (front >= 0 && shop && !retailBox) {
      const fr = edgeFrame(outer, front);
      if (fr && fr.L >= 4 && fr.L <= 22) planters.push([fr.x0, fr.z0, fr.x1, fr.z1, fr.nx, fr.nz, fr.L, seed]);
    }
    if (!lod && brand && street.length) {
      let doorU = 0;
      for (const q of street) {
        const placed = placeFascia(fascias, outer, q, m[0], floorH, brand, bi);
        if (placed && (q === front || !doorU)) doorU = placed.doorU;
      }
      if (doorU > 0.4) seedEnc = seed + 1000 * Math.round(doorU * 4);
    } else if (!lod && shop && front >= 0) {
      let uF = 0;
      for (let q = 0; q < front; q++) { const [ax, az] = outer[q], [bx, bz] = outer[(q + 1) % outer.length]; const l = Math.hypot(bx - ax, bz - az); if (l >= 0.02) uF += l; }
      const [x0, z0] = outer[front], [x1, z1] = outer[(front + 1) % outer.length], fl = Math.hypot(x1 - x0, z1 - z0);
      if (fl >= 2.2) seedEnc = seed + 1000 * Math.round((uF + fl * 0.72) * 4);
    }
    const streetSet = new Set(street);
    // walls
    rings.forEach((ring, k) => {
      let u = 0;
      for (let q = 0; q < ring.length; q++) {
        const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.02) continue;
        let nx = dz / l, nz = -dx / l;
        if (k === 0) {
          const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
          if (insideRing(ring, mx + nx * 0.55, mz + nz * 0.55)) { nx = -nx; nz = -nz; }
        }
        const nrm = [nx, 0, nz];
        const part = k === 0 && (q === front || streetSet.has(q)) ? 1 : 0;
        const t = top + parapet;
        quad(B, [x0, low, z0], [x1, low, z1], [x1, t, z1], [x0, t, z0], nrm, [[u, low - base], [u + l, low - base], [u + l, t - base], [u, t - base]], [floorH, seedEnc, clsCode, part]);
        if (parapet) quad(B, [x0, top, z0], [x1, top, z1], [x1, t, z1], [x0, t, z0], nrm.map(v => -v), [[u, 0], [u + l, 0], [u + l, 1], [u, 1]], [floorH, seedEnc, clsCode, 6]);
        u += l;
      }
    });
    // flat roof over full footprint (also under pitched roofs where the footprint isn't rectangular)
    {
      const flat = [], holes = [];
      rings.forEach((ring, k) => { if (k) holes.push(flat.length / 2); for (const [x, z] of ring) flat.push(x, z); });
      const t = earcut(flat, holes.length ? holes : null);
      for (let q = 0; q < t.length; q += 3) {
        const v = [t[q], t[q + 1], t[q + 2]].map(i => [flat[i * 2], top + (pitched ? -0.02 : 0), flat[i * 2 + 1]]);
        tri(B, v[0], v[1], v[2], [0, 1, 0], v.map(p => [p[0], p[2]]), [floorH, seedEnc, clsCode, 3]);
      }
    }
    if (pitched) addRoof(B, rcx, rcz, rang, rL, rW, base + wallH, rh, roof, [floorH, seedEnc, clsCode], cls, seed, base);
    if (frontInfo) addFrontage(B, frontInfo, base, low, wallH, floorH, [floorH, seedEnc, clsCode], seed);
    // collision ring (world coords)
    col.push(colPts.length / 2, outer.length, base + wallH + (roof ? rh : 0), base);
    for (const [x, z] of outer) colPts.push(x + ox, z + oz);
  }
  const g = B.pack();
  g.col = new Float32Array(col); g.colPts = new Float32Array(colPts); g.destinations = destinations; g.landmarks = landmarks; g.gardens = gardens; g.planters = planters; g.fascias = fascias;
  return g;
}

// box between two points (a beam): width across, height up; parts 7 trim, 8 gutter, 9 ridge, 10 pot
function beam(B, a, b, wid, hgt, ex, up = [0, 1, 0]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); if (L < 0.01) return;
  const t = d.map(v => v / L);
  let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]; const sl = Math.hypot(...s) || 1; s = s.map(v => v / sl);
  const u = [s[1] * t[2] - s[2] * t[1], s[2] * t[0] - s[0] * t[2], s[0] * t[1] - s[1] * t[0]];
  const off = (p, i, j) => [p[0] + s[0] * i * wid / 2 + u[0] * j * hgt / 2, p[1] + s[1] * i * wid / 2 + u[1] * j * hgt / 2, p[2] + s[2] * i * wid / 2 + u[2] * j * hgt / 2];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [i0, j0] = C[k], [i1, j1] = C[(k + 1) % 4];
    const nm = [s[0] * (i0 + i1) + u[0] * (j0 + j1), s[1] * (i0 + i1) + u[1] * (j0 + j1), s[2] * (i0 + i1) + u[2] * (j0 + j1)];
    quad(B, off(a, i0, j0), off(b, i0, j0), off(b, i1, j1), off(a, i1, j1), nm, [[0, 0], [L, 0], [L, 1], [0, 1]], ex);
  }
}
function addRoof(B, cx, cz, ang, L, W, eave, rh, type, ex, cls, seed, base = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang), o = 0.3;
  const part = k => [...ex.slice(0, 3), k];
  const P = (u, v, y) => [cx + u * ca - v * sa, y, cz + u * sa + v * ca];
  const l = L / 2, w = W / 2, slope = rh / w;
  const ye = eave - o * slope; // eave lowered by overhang
  const R = [...ex, 2], Gw = [...ex, 4];
  if (type === 4) { // skillion
    quad(B, P(-l - o, -w - o, ye), P(l + o, -w - o, ye), P(l + o, w + o, eave + rh), P(-l - o, w + o, eave + rh), [0, 1, 0], [[0, 0], [L, 0], [L, W], [0, W]], R);
    tri(B, P(-l, -w, eave), P(-l, w, eave), P(-l, w, eave + rh), [-ca, 0, -sa], null, Gw);
    tri(B, P(l, -w, eave), P(l, w, eave), P(l, w, eave + rh), [ca, 0, sa], null, Gw);
    quad(B, P(-l, w, eave), P(l, w, eave), P(l, w, eave + rh), P(-l, w, eave + rh), [-sa, 0, ca], null, Gw);
    return;
  }
  const ridge = type === 1 ? l + o : type === 3 ? 0 : Math.max(0, l - w);
  const top = eave + rh;
  const sl = Math.hypot(w + o, rh + o * slope);
  if (type === 1) { // gabled
    for (const s of [-1, 1]) quad(B, P(-l - o, s * (w + o), ye), P(l + o, s * (w + o), ye), P(l + o, 0, top), P(-l - o, 0, top), [-sa * s, 1, ca * s], [[0, 0], [L + 2 * o, 0], [L + 2 * o, sl], [0, sl]], R);
    for (const s of [-1, 1]) tri(B, P(s * l, -w, eave), P(s * l, w, eave), P(s * l, 0, top), [ca * s, 0, sa * s], [[-w, 0], [w, 0], [0, rh]], Gw);
  } else { // hipped / pyramidal
    for (const s of [-1, 1]) quad(B, P(-l - o, s * (w + o), ye), P(l + o, s * (w + o), ye), P(ridge, 0, top), P(-ridge, 0, top), [-sa * s, 1, ca * s], [[0, 0], [L, 0], [L - 1, sl], [1, sl]], R);
    for (const s of [-1, 1]) tri(B, P(s * (l + o), -w - o, ye), P(s * (l + o), w + o, ye), P(s * ridge, 0, top), [ca * s, 1, sa * s], [[0, 0], [W, 0], [W / 2, sl]], R);
  }
  // eaves: fascia boards, white soffits under the overhang, gutters with downpipes at the corners
  {
    const fh = 0.2, edges = type === 1 ? [[-1, 1], [1, 1]] : [[-1, 1], [1, 1], [-1, 0], [1, 0]];
    for (const [sd, along] of edges) {
      const a = along ? P(-l - o, sd * (w + o), ye) : P(sd * (l + o), -w - o, ye), b = along ? P(l + o, sd * (w + o), ye) : P(sd * (l + o), w + o, ye);
      const nOut = along ? [-sa * sd, 0, ca * sd] : [ca * sd, 0, sa * sd];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      quad(B, [a[0], ye - fh, a[2]], [b[0], ye - fh, b[2]], [b[0], ye, b[2]], [a[0], ye, a[2]], nOut, [[0, 0], [len, 0], [len, fh], [0, fh]], part(7));
      const ai = along ? P(-l - o, sd * w, ye) : P(sd * l, -w - o, ye), bi = along ? P(l + o, sd * w, ye) : P(sd * l, w + o, ye);
      quad(B, [ai[0], ye - fh, ai[2]], [bi[0], ye - fh, bi[2]], [b[0], ye - fh, b[2]], [a[0], ye - fh, a[2]], [0, -1, 0], null, part(11));
      const g = 0.07, gx = nOut[0] * g, gz = nOut[2] * g;
      beam(B, [a[0] + gx, ye - 0.1, a[2] + gz], [b[0] + gx, ye - 0.1, b[2] + gz], 0.11, 0.09, part(8));
      if (along && sd === -1) for (const e of [a, b]) beam(B, [e[0] + gx * 1.2, ye - 0.12, e[2] + gz * 1.2], [e[0] + gx * 1.2, base - 0.2, e[2] + gz * 1.2], 0.07, 0.07, part(8), [ca, 0, sa]);
    }
  }
  if (type === 1) {
    // bargeboards on the gable rakes and ridge tiles along the ridge
    for (const s of [-1, 1]) for (const v of [-1, 1]) {
      const a = P(s * (l + o + 0.03), v * (w + o), ye), b = P(s * (l + o + 0.03), 0, top + 0.02);
      beam(B, [a[0], a[1] - 0.09, a[2]], [b[0], b[1] - 0.09, b[2]], 0.05, 0.2, part(7), [0, 1, 0]);
    }
    beam(B, P(-l - o, 0, top + 0.04), P(l + o, 0, top + 0.04), 0.22, 0.12, part(9));
  } else if (type !== 4) {
    if (ridge > 0.05) beam(B, P(-ridge, 0, top + 0.04), P(ridge, 0, top + 0.04), 0.22, 0.12, part(9));
    for (const s of [-1, 1]) for (const v of [-1, 1]) beam(B, P(s * ridge, 0, top + 0.03), P(s * (l + o), v * (w + o), ye + 0.03), 0.2, 0.1, part(9));
  }
  // television aerial on some pitched roofs (lived-in streets, not every house)
  if ((cls === 1 || cls === 2) && seed % 5 === 2) {
    const u = (seed % 2 ? 0.4 : -0.4) * Math.max(0.4, l * 0.5);
    const yA = type === 1 ? top - rh * 0.45 : eave + 0.15;
    const c = P(u, w * 0.2, yA);
    beam(B, c, [c[0], c[1] + 1.05, c[2]], 0.025, 0.025, part(8), [0, 1, 0]);
    beam(B, [c[0] - ca * 0.42, c[1] + 0.9, c[2] - sa * 0.42], [c[0] + ca * 0.42, c[1] + 0.9, c[2] + sa * 0.42], 0.015, 0.015, part(8));
    beam(B, [c[0] - sa * 0.26, c[1] + 0.72, c[2] + ca * 0.26], [c[0] + sa * 0.26, c[1] + 0.72, c[2] - ca * 0.26], 0.015, 0.015, part(8));
  }
  // chimney on houses
  if ((cls === 1 || cls === 2) && seed % 3 !== 0) {
    const u = (seed % 2 ? 1 : -1) * Math.max(0, (type === 1 ? l : ridge) - 0.7), v = 0.2;
    const c = P(u, v, 0), h0 = top - 1.0, h1 = top + 0.9, r = 0.35;
    const pts = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([a, b]) => [c[0] + a * ca - b * sa, c[2] + a * sa + b * ca]);
    const Cx = [...ex.slice(0, 3), 5];
    for (let q = 0; q < 4; q++) {
      const [ax, az] = pts[q], [bx, bz] = pts[(q + 1) % 4];
      quad(B, [ax, h0, az], [bx, h0, bz], [bx, h1, bz], [ax, h1, az], [(ax + bx) / 2 - c[0], 0, (az + bz) / 2 - c[2]], [[0, 0], [.7, 0], [.7, 1.9], [0, 1.9]], Cx);
    }
    quad(B, [pts[0][0], h1, pts[0][1]], [pts[1][0], h1, pts[1][1]], [pts[2][0], h1, pts[2][1]], [pts[3][0], h1, pts[3][1]], [0, 1, 0], null, Cx);
    // oversailing cap course and clay pots
    beam(B, [c[0] - ca * (r + 0.05), h1 - 0.06, c[2] - sa * (r + 0.05)], [c[0] + ca * (r + 0.05), h1 - 0.06, c[2] + sa * (r + 0.05)], 2 * r + 0.1, 0.12, Cx, [0, 1, 0]);
    for (const k of seed % 2 ? [-0.15, 0.15] : [0]) beam(B, [c[0] + ca * k, h1, c[2] + sa * k], [c[0] + ca * k, h1 + 0.42, c[2] + sa * k], 0.17, 0.17, part(10), [ca, 0, sa]);
  }
}

// canted bay window (ground floor, or both floors on some houses) and a hood over the front door
function addFrontage(B, F, base, low, wallH, floorH, ex, seed) {
  const part = k => [...ex.slice(0, 3), k];
  const tx = (F.x1 - F.x0) / F.fl, tz = (F.z1 - F.z0) / F.fl, nx = tz, nz = -tx;          // along the wall, outward
  const at = (t, d) => [F.x0 + tx * t + nx * d, F.z0 + tz * t + nz * d];
  if (F.fl >= 4.7 && seed % 5 !== 0) {
    const bt = (F.dT < 0.5 ? 0.7 : 0.3) * F.fl, back = 1.15, frontW = 0.72, dep = 0.62;
    const twoStorey = wallH > 4.6 && seed % 3 === 0;
    const yTop = base + (twoStorey ? Math.min(wallH - 0.25, floorH * 2 - 0.1) : Math.min(floorH - 0.1, 2.62));
    const C = [at(bt - back, 0), at(bt - frontW, dep), at(bt + frontW, dep), at(bt + back, 0)];
    // three glazed faces: u runs 0..1 across each side face and 0..2 across the front (two lights)
    const faces = [[C[0], C[1], 1], [C[1], C[2], 2], [C[2], C[3], 1]];
    for (const [a, b, n] of faces) {
      const nm = [(b[1] - a[1]), 0, -(b[0] - a[0])];
      quad(B, [a[0], low, a[1]], [b[0], low, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], nm, [[0, low - base], [n, low - base], [n, yTop - base], [0, yTop - base]], part(12));
    }
    // lean-to roof over the bay
    const rT = yTop + 0.42, rF = yTop + 0.08, o = 0.08;
    const R = [at(bt - back - o, 0), at(bt - frontW - o, dep + o), at(bt + frontW + o, dep + o), at(bt + back + o, 0)];
    quad(B, [R[0][0], rT, R[0][1]], [R[1][0], rF, R[1][1]], [R[2][0], rF, R[2][1]], [R[3][0], rT, R[3][1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], part(13));
    quad(B, [R[1][0], rF - 0.16, R[1][1]], [R[2][0], rF - 0.16, R[2][1]], [R[2][0], rF, R[2][1]], [R[1][0], rF, R[1][1]], [nx, 0, nz], null, part(7));
    quad(B, [C[1][0], yTop, C[1][1]], [C[2][0], yTop, C[2][1]], [R[2][0], rF - 0.16, R[2][1]], [R[1][0], rF - 0.16, R[1][1]], [0, -1, 0], null, part(11));
  }
  // door hood on brackets
  const dt = F.dT * F.fl, hw = 0.78, dep = 0.75, y = base + 2.38;
  const A0 = at(dt - hw, 0), A1 = at(dt + hw, 0), B0 = at(dt - hw, dep), B1 = at(dt + hw, dep);
  quad(B, [A0[0], y + 0.32, A0[1]], [A1[0], y + 0.32, A1[1]], [B1[0], y + 0.06, B1[1]], [B0[0], y + 0.06, B0[1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], part(13));
  quad(B, [B0[0], y - 0.04, B0[1]], [B1[0], y - 0.04, B1[1]], [B1[0], y + 0.06, B1[1]], [B0[0], y + 0.06, B0[1]], [nx, 0, nz], null, part(7));
  quad(B, [A0[0], y - 0.04, A0[1]], [A1[0], y - 0.04, A1[1]], [B1[0], y - 0.04, B1[1]], [B0[0], y - 0.04, B0[1]], [0, -1, 0], null, part(11));
  for (const e of [-hw + 0.06, hw - 0.06]) { const p = at(dt + e, 0.02), q = at(dt + e, dep - 0.05); beam(B, [p[0], y - 0.35, p[1]], [q[0], y - 0.04, q[1]], 0.06, 0.1, part(7), [0, 1, 0]); }
}

// ------------------------------------------------------------------ road markings
function buildMarkings(header, ox, oz, hAt) {
  const B = new Buf(1);
  if (!NET) return B.pack();
  const P = NET.pts, cum = NET.cum;
  for (const e of header.edges) {
    const c = NET.cls[e];
    if (!NET.driveCls.has(c)) continue;
    const name = NET.classes[c];
    const minor = name === 'service' || name === 'track';
    const f = NET.flags[e];
    if (f & 8) continue;
    const bridge = !!(f & 4);
    const st = NET.pstart[e], n = NET.pcount[e];
    const L = cum[st + n - 1];
    const pts = []; for (let i = 0; i < n; i++) pts.push([P[(st + i) * 3] - ox, P[(st + i) * 3 + 1], P[(st + i) * 3 + 2] - oz, cum[st + i]]);
    const yAt = bridge ? (p, s) => sampleY(pts, s) + 0.03 : (p) => hAt(p[0], p[2]) + 0.07;
    const w = NET.width[e], lf = NET.lanesF[e], lb = NET.lanesB[e], oneway = f & 1;
    const s0 = NET.cutA[e], s1 = L - NET.cutB[e];
    const inTile = p => p[0] >= 0 && p[0] < TILE && p[2] >= 0 && p[2] < TILE;
    const line = (offset, width, from, to, dash, gap, id) => {
      for (let s = from; s < to; s += dash + gap) {
        const a = s, b = Math.min(to, s + dash);
        if (b - a < 0.2) continue;

        const segs = Math.max(1, Math.ceil((b - a) / 3));
        for (let k = 0; k < segs; k++) {
          const ta = a + (b - a) * k / segs, tb = a + (b - a) * (k + 1) / segs;
          if (!inTile(posAt(pts,(ta+tb)/2))) continue;
          const A1 = posAt(pts, ta), B1 = posAt(pts, tb);
          const q = [[A1, -1], [B1, -1], [B1, 1], [A1, 1]].map(([p, sd]) => {
            const x = p[0] + p[3] * (offset + sd * width / 2), z = p[2] + p[4] * (offset + sd * width / 2);
            return [x, 0, z];
          });
          q[0][1] = yAt(q[0], ta); q[1][1] = yAt(q[1], tb); q[2][1] = yAt(q[2], tb); q[3][1] = yAt(q[3], ta);
          quad(B, q[0], q[1], q[2], q[3], [0, 1, 0], null, [id]);
        }
      }
    };
    const total = Math.max(1, lf + lb), lw = w / total;
    if (!minor && L > 4 && s1 - s0 > 2 && w >= 4.5) {
      if (!oneway && lf && lb && name !== 'living_street') line(w/2-lf*lw, 0.1, s0, s1, name === 'residential' ? 2.5 : 4, name === 'residential' ? 4 : 5, 0); // centre line
      // lane lines (forward lanes are left of centre: offset positive = left)
      for (let k = 1; k < lf; k++) line(oneway ? w / 2 - k * lw : w / 2 - k * lw, 0.1, s0, s1, 2, 7, 0);
      for (let k = 1; k < lb; k++) line(-(w / 2 - k * lw), 0.1, s0, s1, 2, 7, 0);
      if (/motorway|trunk|primary/.test(name)) { line(w / 2 - 0.25, 0.15, s0, s1, 1e4, 0, 0); line(-(w / 2 - 0.25), 0.15, s0, s1, 1e4, 0, 0); }
      if (header.core && /primary|secondary|tertiary/.test(name)) { for (const s of [1, -1]) { line(s * (w / 2 - 0.25), 0.08, s0, s1, 1e4, 0, 1); line(s * (w / 2 - 0.42), 0.08, s0, s1, 1e4, 0, 1); } }
    }
    // stop / give-way lines at ends
    const endLine = (atEnd, code, stopDist) => {
      const dirLeft = atEnd ? 1 : -1; // forward traffic arrives at B on the left half
      const s = atEnd ? (stopDist != null ? stopDist : L - Math.max(1.5, NET.cutB[e] - 0.5)) : (stopDist != null ? L - stopDist : Math.max(1.5, NET.cutA[e] - 0.5));
      if (s <= 0.3 || s >= L - 0.3) return;
      const p = posAt(pts, s); if (!inTile(p)) return;
      const halfFrom = oneway ? -w / 2 + 0.3 : 0.1, halfTo = w / 2 - 0.3;
      const tx = p[3], tz = p[4]; // left normal (p[3],p[4]) is lateral unit
      const sgn = oneway ? 1 : dirLeft;
      const mk = (o0, o1, thick, alongOff, id) => {
        const dx = -p[4] * (atEnd ? 1 : -1), dz = p[3] * (atEnd ? 1 : -1); // along travel
        const base = [p[0] + dx * alongOff, p[2] + dz * alongOff];
        const a = [base[0] + tx * o0 * sgn, 0, base[1] + tz * o0 * sgn], b = [base[0] + tx * o1 * sgn, 0, base[1] + tz * o1 * sgn];
        const c = [b[0] + dx * thick, 0, b[2] + dz * thick], d = [a[0] + dx * thick, 0, a[2] + dz * thick];
        for (const v of [a, b, c, d]) v[1] = bridge ? p[1] + 0.03 : hAt(v[0], v[2]) + 0.075;
        quad(B, a, b, c, d, [0, 1, 0], null, [id]);
      };
      if (code === 3 || code === 2) mk(halfFrom, halfTo, code === 2 ? 0.4 : 0.3, 0, 0);
      else if (code === 1 || code === 4) {
        for (let o = halfFrom; o < halfTo; o += 0.9) { mk(o, Math.min(halfTo, o + 0.6), 0.2, 0, 0); mk(o, Math.min(halfTo, o + 0.6), 0.2, 0.4, 0); }
      }
    };
    const stops = NET.stops.get(e) || [];
    for (const [d, stop] of stops) { if (d === 1) endLine(true, 3, stop); else endLine(false, 3, stop); }
    if (NET.ctrlB[e] && NET.ctrlB[e] !== 3) endLine(true, NET.ctrlB[e]);
    if (NET.ctrlA[e] && NET.ctrlA[e] !== 3 && !oneway) endLine(false, NET.ctrlA[e]);
    // crossings
    for (const cr of NET.cross.get(e) || []) {
      const idx = cr[1], kind = cr[2];
      const s = cum[st + idx];
      const p = posAt(pts, s); if (!inTile(p)) continue;
      const along = [-p[4], p[3]]; // travel dir
      const lat = [p[3], p[4]];
      const put = (o0, o1, a0, a1, id) => {
        const v = [[o0, a0], [o1, a0], [o1, a1], [o0, a1]].map(([o, a]) => {
          const x = p[0] + lat[0] * o + along[0] * a * -1, z = p[2] + lat[1] * o + along[1] * a * -1;
          return [x, bridge ? p[1] + 0.03 : hAt(x, z) + 0.076, z];
        });
        quad(B, v[0], v[1], v[2], v[3], [0, 1, 0], null, [id]);
      };
      // Tactile landings are inferred only on mapped/inferred pavement sides.
      for (const [side,bit] of [[1,1],[-1,2]]) if (NET.pav?.[e] & bit) {
        const o0=side*(w/2+.12), o1=side*(w/2+1.05);
        const landing=[[o0,-.9],[o1,-.9],[o1,.9],[o0,.9]].map(([o,a])=>{
          const x=p[0]+lat[0]*o+along[0]*a,z=p[2]+lat[1]*o+along[1]*a;
          return [x,(bridge?p[1]:hAt(x,z))+.185,z];
        });
        quad(B,...landing,[0,1,0],null,[kind==='uncontrolled'?3:2]);
      }
      if (kind === 'zebra') {
        for (let o = -w / 2 + 0.2; o < w / 2 - 0.4; o += 1.0) put(o, o + 0.5, -1.4, 1.4, 0);
        zigzags(B, pts, s, w, bridge, hAt, inTile);
      } else if (kind === 'signal') {
        for (let o = -w / 2; o < w / 2; o += 0.6) { put(o, o + 0.3, -1.6, -1.45, 0); put(o, o + 0.3, 1.45, 1.6, 0); }
        zigzags(B, pts, s, w, bridge, hAt, inTile);
      }
    }
  }
  return B.pack();
}
function zigzags(B, pts, s, w, bridge, hAt, inTile) {
  for (const dir of [-1, 1]) for (const lat of [w / 2 - 0.3, -(w / 2 - 0.3)]) {
    for (let k = 0; k < 8; k++) {
      const a = s + dir * (3 + k * 2), b = s + dir * (3 + (k + 1) * 2);
      const pa = posAt(pts, a), pb = posAt(pts, b);
      if (!pa || !pb || !inTile(pa)) continue;
      const oa = lat + (k % 2 ? 0.3 : -0.3) * Math.sign(lat), ob = lat + (k % 2 ? -0.3 : 0.3) * Math.sign(lat);
      const A1 = [pa[0] + pa[3] * oa, 0, pa[2] + pa[4] * oa], B1 = [pb[0] + pb[3] * ob, 0, pb[2] + pb[4] * ob];
      const dx = B1[0] - A1[0], dz = B1[2] - A1[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.05, nz = dx / l * 0.05;
      const q = [[A1[0] - nx, A1[2] - nz], [B1[0] - nx, B1[2] - nz], [B1[0] + nx, B1[2] + nz], [A1[0] + nx, A1[2] + nz]].map(([x, z]) => [x, bridge ? pa[1] + 0.03 : hAt(x, z) + 0.077, z]);
      quad(B, q[0], q[1], q[2], q[3], [0, 1, 0], null, [0]);
    }
  }
}
// pts entries: [x, y, z, cum]; returns [x, y, z, leftx, leftz]
function posAt(pts, s) {
  const L = pts[pts.length - 1][3];
  s = Math.max(0, Math.min(L, s));
  let i = 1; while (i < pts.length - 1 && pts[i][3] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = (b[3] - a[3]) || 1, t = (s - a[3]) / seg;
  const dx = (b[0] - a[0]) / seg, dz = (b[2] - a[2]) / seg;
  // left of travel direction (dx,dz) is (dz,-dx)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, dz, -dx];
}
function sampleY(pts, s) { return posAt(pts, s)[1]; }

// Water surfaces: the pipeline's water polygons (tile-local, padded under the banks) at the water level on the
// tile's 4 m grid (A.wl, cm, 32767 = none). wDepth = level minus the carved bed, for the water shader.
function buildWater(A, hAt) {
  const WL = A.wl, C = A.wtC, R = A.wtR, P = A.wtP;
  const lv = (x, z) => {
    const gx = Math.max(0, Math.min(NT - 1.0001, x / STEP)), gz = Math.max(0, Math.min(NT - 1.0001, z / STEP));
    const i = Math.floor(gx), j = Math.floor(gz), fu = gx - i, fv = gz - j;
    let s = 0, w = 0;
    for (const [a, b, k] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]]) {
      const v = WL[(j + b) * NT + i + a]; if (v !== 32767) { s += v * (k + 1e-4); w += k + 1e-4; }
    }
    if (w) return s / w / 100;
    // outside the grid's water cells: the nearest level within 3 cells
    let best = null, bd = 1e9;
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= NT || jj >= NT) continue;
      const v = WL[jj * NT + ii]; if (v === 32767) continue;
      const d = a * a + b * b; if (d < bd) { bd = d; best = v / 100; }
    }
    return best;
  };
  const pos = [], dep = [], idx = [];
  let ci = 0, ri = 0;
  for (let pi = 0; pi < P.length; pi++) {
    const flat = [], holes = [];
    for (let k = 0; k < P[pi]; k++) {
      const n = R[ri++];
      if (k) holes.push(flat.length / 2);
      for (let q = 0; q < n; q++) flat.push(C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10);
      ci += n;
    }
    const base = pos.length / 3, nv = flat.length / 2, ys = [];
    let ok = true;
    for (let q = 0; q < nv; q++) { const y = lv(flat[q * 2], flat[q * 2 + 1]); if (y == null) { ok = false; break; } ys.push(y); }
    if (!ok) continue;
    for (let q = 0; q < nv; q++) {
      const x = flat[q * 2], z = flat[q * 2 + 1];
      pos.push(x, ys[q], z); dep.push(Math.max(0, ys[q] - hAt(x, z)));
    }
    const t = earcut(flat, holes.length ? holes : null);
    for (let q = 0; q < t.length; q += 3) idx.push(base + t[q], base + t[q + 2], base + t[q + 1]);
  }
  if (!idx.length) return null;
  return { position: new Float32Array(pos), depth: new Float32Array(dep), index: new Uint32Array(idx) };
}
