// Scans every world tile's buildings into one table for picking enterable buildings (tools/interiors/pick.mjs):
// footprint (world coords), class, levels, wall height, base level, name, and the biggest rectangle that fits
// inside the footprint (the interior's floor plan). node tools/interiors/scan.mjs > /tmp/buildings.json
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decode } from '../../src/data.js';
const W = new URL('../../www/world/', import.meta.url).pathname;
const man = JSON.parse(fs.readFileSync(W + 'manifest.json'));
const NM = 16, TILE = 256;
const out = [];
// convex hull + minimum-area rectangle (rotating calipers over hull edges)
function hull(P) {
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function obb(P) {
  const H = hull(P); let best = null;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of H) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, ang, u0, u1, v0, v1 };
  }
  return best;
}
const inRing = (R, x, z) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
// biggest axis-aligned rectangle (in the OBB's frame) of 0.5 m cells inside the footprint
function inscribed(R, o) {
  const c = Math.cos(o.ang), s = Math.sin(o.ang), g = Math.max(0.5, Math.sqrt((o.u1 - o.u0) * (o.v1 - o.v0) / 120000));
  const nu = Math.max(1, Math.round((o.u1 - o.u0) / g)), nv = Math.max(1, Math.round((o.v1 - o.v0) / g));
  const hgt = new Array(nu).fill(0); let best = { A: 0 };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) { const u = o.u0 + (i + 0.5) * g, v = o.v0 + (j + 0.5) * g; const x = u * c - v * s, z = u * s + v * c; hgt[i] = inRing(R, x, z) ? hgt[i] + 1 : 0; }
    const st = [];
    for (let i = 0; i <= nu; i++) {
      const h = i < nu ? hgt[i] : 0; let start = i;
      while (st.length && st[st.length - 1][1] >= h) { const [si, sh] = st.pop(); const A = sh * (i - si); if (A > best.A) best = { A, i0: si, i1: i, j1: j + 1, j0: j + 1 - sh }; start = si; }
      st.push([start, h]);
    }
  }
  if (!best.A) return null;
  return { u0: o.u0 + best.i0 * g, u1: o.u0 + best.i1 * g, v0: o.v0 + best.j0 * g, v1: o.v0 + best.j1 * g };
}
for (const key of man.tiles.map(t => typeof t === 'string' ? t : t.key)) {
  const raw = zlib.inflateSync(fs.readFileSync(W + 'tiles/' + key + '.bin'));
  const { header: hd, arrays: A } = decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const [ti, tj] = key.split('_').map(Number), ox = ti * TILE, oz = tj * TILE;
  const C = A.bC, R = A.bR, P = A.bP, M = A.bM; if (!P) continue;
  let ci = 0, ri = 0;
  for (let bi = 0; bi < P.length; bi++) {
    const m = M.subarray(bi * NM, bi * NM + NM);
    let ring = null;
    for (let k = 0; k < P[bi]; k++) { const n = R[ri++]; if (!k) { ring = []; for (let q = 0; q < n; q++) ring.push([+(C[(ci + q) * 2] / 10 + ox).toFixed(2), +(C[(ci + q) * 2 + 1] / 10 + oz).toFixed(2)]); } ci += n; }
    const holes = P[bi] > 1;
    let area = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; area = Math.abs(area / 2);
    if (area < 30) continue;
    const o = obb(ring), ins = inscribed(ring, o);
    out.push({ key, bi, cls: m[10], lv: m[11], base: +(m[0] + hd.hmin).toFixed(2), wall: +m[2].toFixed(2), roof: m[3], shop: m[12], lm: m[14] > 0.5 ? 1 : 0, name: (hd.bn && hd.bn[bi]) || '',
      area: +area.toFixed(1), holes, ring, ang: +o.ang.toFixed(4), obb: [o.u0, o.u1, o.v0, o.v1].map(v => +v.toFixed(2)), ins: ins && [ins.u0, ins.u1, ins.v0, ins.v1].map(v => +v.toFixed(2)) });
  }
}
process.stdout.write(JSON.stringify(out));
console.error('buildings', out.length);
