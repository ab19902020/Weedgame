// Paints the far-terrain aerial texture (seen from a drone high up) from the world tiles' own land cover and trees:
// fields, woods, parks, roads, roofs and water in their real places, at 8 m a pixel over the overview extent.
// Writes raw RGB (and a coverage mask) for tools/world/far_terrain.py to finish (fill the land beyond the tiles,
// encode the JPEG, build the height grid).
//   node tools/world/far_colour.mjs <out.rgb> <out.mask>
import fs from 'node:fs';
import { decode, inflate } from '../../src/data.js';
const W = new URL('../../www/world/', import.meta.url).pathname;
const man = JSON.parse(fs.readFileSync(W + 'manifest.json'));
const OV = man.overview, MPX = 8;
const NX = Math.round(OV.w * OV.mpx / MPX), NZ = Math.round(OV.h * OV.mpx / MPX);
const rgb = new Uint8Array(NX * NZ * 3), mask = new Uint8Array(NX * NZ);
// summer aerial colours by land-cover class (0 grass .. 19 sand), sRGB
const COL = [[104, 132, 74], [86, 86, 88], [146, 143, 134], null, [48, 68, 76], [44, 70, 38], [150, 154, 92], [96, 138, 72], [104, 104, 104], [112, 102, 92],
  [158, 148, 120], [92, 122, 66], [168, 163, 152], [82, 142, 72], [116, 124, 74], [104, 112, 66], [98, 126, 78], [132, 130, 124], [142, 124, 94], [198, 184, 148]];
const ROOF = [[126, 86, 74], [96, 96, 100], [140, 98, 82], [78, 80, 86], [150, 140, 128], [112, 70, 60]];
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// smooth value noise (bilinear between hashed lattice points): fields shade gently instead of in blocks
const smooth = (x, z) => { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, s = t => t * t * (3 - 2 * t), a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a + (b - a) * s(u)) * (1 - s(v)) + (c + (d - c) * s(u)) * s(v); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
let n = 0;
for (const key of man.tiles) {
  const raw = fs.readFileSync(W + 'tiles/' + key + '.bin'), ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  let c; try { c = decode(ab); } catch { c = decode(await inflate(ab)); }
  const A = c.arrays, ix = c.header.ix, iz = c.header.iz, ox = ix * 256, oz = iz * 256;
  const lc = A.lc; if (!lc) continue;
  // 8 m pixels: average the 4x4 blocks of 2 m land cover (fields vary a little per field)
  for (let pz = 0; pz < 32; pz++) for (let px = 0; px < 32; px++) {
    const gx = Math.floor((ox + px * MPX - OV.x0) / MPX), gz = Math.floor((oz + pz * MPX - OV.z0) / MPX);
    if (gx < 0 || gz < 0 || gx >= NX || gz >= NZ) continue;
    let r = 0, g = 0, b = 0, k = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const cls = lc[(pz * 4 + j) * 128 + px * 4 + i];
      let col = cls === 3 ? ROOF[Math.floor(hash(ox + px * 8 + i, oz + pz * 8 + j) * ROOF.length)] : COL[cls] || COL[0];
      if (cls === 6) { const f = smooth((ox + px * MPX + i * 2) / 140, (oz + pz * MPX + j * 2) / 110); col = f < 0.5 ? lerp3([122, 146, 80], [150, 154, 92], f * 2) : lerp3([150, 154, 92], [178, 166, 108], f * 2 - 1); }
      r += col[0]; g += col[1]; b += col[2]; k++;
    }
    const o = (gz * NX + gx) * 3; rgb[o] = r / k; rgb[o + 1] = g / k; rgb[o + 2] = b / k; mask[gz * NX + gx] = 255;
  }
  // trees: a dark canopy pixel (and its neighbours for big ones)
  const tr = A.tr || [];
  for (let k = 0; k < tr.length; k += 4) {
    const x = ox + tr[k], z = oz + tr[k + 1], H = tr[k + 2] + (tr[k + 3] || 0) * 10;
    const gx = Math.floor((x - OV.x0) / MPX), gz = Math.floor((z - OV.z0) / MPX), rad = H > 14 ? 1 : 0;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      const qx = gx + dx, qz = gz + dz; if (qx < 0 || qz < 0 || qx >= NX || qz >= NZ) continue;
      const o = (qz * NX + qx) * 3, w = dx || dz ? 0.35 : 0.7;
      rgb[o] = rgb[o] * (1 - w) + 40 * w; rgb[o + 1] = rgb[o + 1] * (1 - w) + 66 * w; rgb[o + 2] = rgb[o + 2] * (1 - w) + 34 * w;
    }
  }
  if (++n % 500 === 0) console.error('tiles', n);
}
fs.writeFileSync(process.argv[2], rgb); fs.writeFileSync(process.argv[3], mask);
console.error('far colour', NX, 'x', NZ, 'from', n, 'tiles');
