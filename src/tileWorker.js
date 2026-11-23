// Tile worker: fetches world tiles and turns them into GPU-ready typed arrays.
// Everything here is plain math so the main thread never stalls on geometry.
import earcut from '../node_modules/three/src/extras/lib/earcut.js';
import { inflate, decode } from './data.js';

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
  }
  // ---------------- rails
  {
    const C = A.railC; let ci = 0;
    for (const n of A.railN) {
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      for (const side of [-0.7175, 0.7175]) strip(S, pts, side, 0.08, p => hAt(p[0], p[1]) + 0.32, 6, 0.12);
      strip(G, pts, 0, 3.2, p => hAt(p[0], p[1]) + 0.12, 9);
    }
  }
  // ---------------- walls / fences / hedges
  const wallCol = [];
  {
    const C = A.wlC, M = A.wlM; let ci = 0;
    for (let k = 0; k < M.length; k += 3) {
      const n = M[k], kind = M[k + 1], h = M[k + 2];
      const pts = []; for (let q = 0; q < n; q++) pts.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n;
      if (kind === 6) continue; // tree rows handled as trees by the pipeline
      const th = kind === 2 ? 0.8 : kind === 1 ? 0.06 : kind === 5 ? 0.1 : 0.25;
      const id = kind === 2 ? 3 : kind === 1 ? 2 : kind === 5 ? 4 : 1;
      wall(S, pts, th, h, hAt, id);
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
      for (const [a, b] of [[-0.2, gs], [gs + gw, l + 0.2]]) if (b - a > 0.4) { const A0 = P(a, t), B0 = P(b, t); wall(S, [A0, B0], th, h, hAt, id); wallCol.push(A0[0], A0[1], B0[0], B0[1], h); }
    }
    // driveway (block paving or tarmac) or front path (flags) from the gap to the house
    const surfId = drive ? (seed % 5 < 3 ? 4 : 0) : 1, lift = drive ? 0.08 : 0.09;
    const a = P(gs, t + 0.3), b = P(gs + gw, t + 0.3), c = P(gs + gw, 0.05), d = P(gs, 0.05);
    const q = [a, b, c, d].map(([x, z]) => [x, hAt(x, z) + lift, z]);
    quad(G, q[0], q[1], q[2], q[3], [0, 1, 0], null, [surfId]);
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
  out.markings = buildMarkings(header, ox, oz, hAt);

  // ---------------- instances: trees, lamps, slots
  const tr = A.tr, trees = new Float32Array(tr.length);
  for (let k = 0; k < tr.length; k += 4) { trees[k] = tr[k]; trees[k + 1] = hAt(tr[k], tr[k + 1]); trees[k + 2] = tr[k + 1]; trees[k + 3] = tr[k + 2] + (tr[k + 3] || 0) * 10; }
  out.trees = trees;
  const lp = A.lp, lamps = new Float32Array(lp.length);
  for (let k = 0; k < lp.length; k += 4) { lamps[k] = lp[k]; lamps[k + 1] = hAt(lp[k], lp[k + 1]) + 0.17; lamps[k + 2] = lp[k + 1]; lamps[k + 3] = lp[k + 2]; }
  out.lamps = lamps;
  const pk = A.pk, slots = new Float32Array(pk.length);
  for (let k = 0; k < pk.length; k += 4) { slots[k] = pk[k]; slots[k + 1] = hAt(pk[k], pk[k + 1]) + 0.05; slots[k + 2] = pk[k + 1]; slots[k + 3] = pk[k + 2]; }
  out.slots = slots; out.slotKind = new Float32Array(Array.from({ length: pk.length / 4 }, (_, i) => pk[i * 4 + 3]));
  out.signs = { data: new Float32Array(A.sg), text: header.sn };
  return out;
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
  const landmarks = [];
  const gardens = [];
  const colPts = [];
  let ci = 0, ri = 0;
  for (let bi = 0; bi < P.length; bi++) {
    const m = M.subarray(bi * NM, bi * NM + NM);
    const base = m[0] + hmin, low = m[1] + hmin - 0.6, wallH = m[2], roof = m[3], rh = m[4];
    const rcx = m[5], rcz = m[6], rang = m[7], rL = m[8], rW = m[9], cls = m[10], lv = m[11], seed = m[13];
    // named commercial / retail units are shops even when only the name is tagged (e.g. amenity=pharmacy)
    const shop = m[12] || ((cls === 6 || cls === 7) && header.bn[bi] ? 1 : 0);
    if (cls === 13) { for (let k = 0; k < P[bi]; k++) ci += R[ri++]; continue; } // canopies are drawn by landmarks.js
    const floorH = Math.max(2.4, Math.min(5, wallH / Math.max(1, lv)));
    const rings = [];
    for (let k = 0; k < P[bi]; k++) {
      const n = R[ri++], ring = [];
      for (let q = 0; q < n; q++) ring.push([C[(ci + q) * 2] / 10, C[(ci + q) * 2 + 1] / 10]);
      ci += n; rings.push(ring);
    }
    const outer = rings[0];
    if (m[14] > 0.5) { // hand-authored landmark: hand the footprint over, keep collision
      landmarks.push({ name: header.bn[bi], ring: outer.map(([x, z]) => [x + ox, z + oz]), base, wall: wallH });
      col.push(colPts.length / 2, outer.length, header.bn[bi] === 'Cemetery Arch' ? base - 1 : base + wallH + 4, base);
      for (const [x, z] of outer) colPts.push(x + ox, z + oz);
      continue;
    }
    const pitched = roof > 0 && rL > 0 && !lod;
    const top = base + wallH + (lod && roof ? rh * 0.45 : 0);
    const parapet = !pitched && !lod && (cls === 3 || cls === 6 || cls === 7 || cls === 11) ? 0.6 : 0;
    // frontage edge (nearest to a road)
    let front = -1;
    if (!lod && segs.length) {
      let bd = 1e9;
      for (let q = 0; q < outer.length; q++) {
        const [x0, z0] = outer[q], [x1, z1] = outer[(q + 1) % outer.length];
        if (Math.hypot(x1 - x0, z1 - z0) < 2.5) continue;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, L = Math.hypot(x1 - x0, z1 - z0);
        const px = mx + (z1 - z0) / L * 2.2, pz = mz - (x1 - x0) / L * 2.2;   // 2.2 m outside the wall
        const c = lcAt(Math.floor(px), Math.floor(pz));
        let d = segDist(mx, mz);
        if (shop && walkSegs.length) d = Math.min(d, segDist(mx, mz, walkSegs) - 8);
        if (shop && (c === 12 || c === 2)) d -= 15;     // shopfronts face the pavement / precinct
        if (c === 3) d += 50;                           // never a party wall
        if (d < bd) { bd = d; front = q; }
      }
      if (bd > 40) front = -1;
    }
    const clsCode = cls + (shop ? 32 : 0);
    if (front >= 0 && (cls === 1 || cls === 2)) {
      const [x0, z0] = outer[front], [x1, z1] = outer[(front + 1) % outer.length];
      const l = Math.hypot(x1 - x0, z1 - z0), nx = (z1 - z0) / l, nz = -(x1 - x0) / l;
      const ce = segDist((x0 + x1) / 2, (z0 + z1) / 2, segs, true);
      const t = ce - 2.1;
      if (t >= 1.6 && t <= 14 && l >= 4) gardens.push([x0, z0, x1, z1, nx, nz, t, seed, cls]);
    }
    // walls
    rings.forEach((ring, k) => {
      let u = 0;
      for (let q = 0; q < ring.length; q++) {
        const [x0, z0] = ring[q], [x1, z1] = ring[(q + 1) % ring.length];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); if (l < 0.02) continue;
        const nrm = [dz / l, 0, -dx / l]; // outward for CCW (x,z) rings; inner rings are CW -> faces courtyard
        const part = k === 0 && q === front ? 1 : 0;
        const t = top + parapet;
        quad(B, [x0, low, z0], [x1, low, z1], [x1, t, z1], [x0, t, z0], nrm, [[u, low - base], [u + l, low - base], [u + l, t - base], [u, t - base]], [floorH, seed, clsCode, part]);
        if (parapet) quad(B, [x0, top, z0], [x1, top, z1], [x1, t, z1], [x0, t, z0], nrm.map(v => -v), [[u, 0], [u + l, 0], [u + l, 1], [u, 1]], [floorH, seed, clsCode, 6]);
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
        tri(B, v[0], v[1], v[2], [0, 1, 0], v.map(p => [p[0], p[2]]), [floorH, seed, clsCode, 3]);
      }
    }
    if (pitched) addRoof(B, rcx, rcz, rang, rL, rW, base + wallH, rh, roof, [floorH, seed, clsCode], cls, seed);
    // collision ring (world coords)
    col.push(colPts.length / 2, outer.length, base + wallH + (roof ? rh : 0), base);
    for (const [x, z] of outer) colPts.push(x + ox, z + oz);
  }
  const g = B.pack();
  g.col = new Float32Array(col); g.colPts = new Float32Array(colPts); g.landmarks = landmarks; g.gardens = gardens;
  return g;
}

function addRoof(B, cx, cz, ang, L, W, eave, rh, type, ex, cls, seed) {
  const ca = Math.cos(ang), sa = Math.sin(ang), o = 0.3;
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
  }
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
    if (name === 'service' || name === 'track') continue;
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
        const pa = posAt(pts, a), pb = posAt(pts, b);
        const mid = posAt(pts, (a + b) / 2);
        if (!inTile(mid)) continue;
        const segs = Math.max(1, Math.ceil((b - a) / 3));
        for (let k = 0; k < segs; k++) {
          const ta = a + (b - a) * k / segs, tb = a + (b - a) * (k + 1) / segs;
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
    if (L > 4 && s1 - s0 > 2 && w >= 4.5) {
      if (!oneway && lf && lb && name !== 'living_street') line(0, 0.1, s0, s1, name === 'residential' ? 2.5 : 4, name === 'residential' ? 4 : 5, 0); // centre line
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
      if (code === 3) mk(halfFrom, halfTo, 0.3, 0, 0);
      else if (code === 1 || code === 4 || code === 2) {
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
