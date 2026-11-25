// Procedurally baked face and hair textures for the crowd (humans.js). Drawn once at start-up on a 2D
// canvas, layer by layer, then packed into the channels of one RGBA texture:
//   R  skin shading, 0.5 = neutral (eye sockets, brow ridge, nose bridge and nostrils, nasolabial folds,
//      lip line, chin shadow, cheekbone and forehead highlights, lash lines, wrinkles)
//   G  hair-colour mask (eyebrows, stubble, beards, moustaches)
//   B  red tint (lips, lipstick, cheek blush)
//   A  eye mask: 1/3 sclera, 2/3 iris, 1 pupil
// The atlas holds 8 faces (4 x 2 cells, 256 px each): 0-3 men (clean shaven, stubble, full beard, older),
// 4-7 women (young, natural, made-up, older). Faces are drawn in head model space (metres): u = 0.5 + x / 0.2,
// v = (y - 1.53) / 0.26, matching the planar projection in the crowd shader.
// The hair texture is a tileable strand map: R strand brightness, G clump shading.
import * as THREE from 'three/webgpu';

const CELL = 256, COLS = 4, ROWS = 2;
export const FACE_ATLAS = { cols: COLS, rows: ROWS, x0: -0.1, w: 0.2, y0: 1.53, h: 0.26 };

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

const FACES = [
  { male: 1, stubble: 0.12, brow: 1.0 },
  { male: 1, stubble: 0.75, brow: 1.1 },
  { male: 1, beard: 1, brow: 1.15 },
  { male: 1, stubble: 0.25, moustache: 1, age: 1, brow: 0.8 },
  { male: 0, lips: 0.55, blush: 0.5, liner: 0.6, brow: 0.7 },
  { male: 0, lips: 0.4, blush: 0.25, liner: 0.25, brow: 0.9, freckles: 1 },
  { male: 0, lips: 1.0, blush: 0.45, liner: 1.0, brow: 0.65 },
  { male: 0, lips: 0.35, blush: 0.2, liner: 0.3, age: 1, brow: 0.6 },
];

export function bakeFaceAtlas() {
  const W = CELL * COLS, H = CELL * ROWS;
  const layers = ['shade', 'hair', 'tint', 'eye'].map(() => { const c = canvas(W, H); const g = c.getContext('2d'); return { c, g }; });
  const [S, Hm, T, E] = layers.map(l => l.g);
  S.fillStyle = 'rgb(128,128,128)'; S.fillRect(0, 0, W, H);
  for (const g of [Hm, T, E]) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  FACES.forEach((f, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    // metres (head model space) -> pixels of this cell
    const setT = g => g.setTransform(CELL / 0.2, 0, 0, -CELL / 0.26, cx + CELL * 0.5, cy + CELL + 1.53 * CELL / 0.26);
    for (const g of [S, Hm, T, E]) { g.save(); g.beginPath(); g.rect(cx, cy, CELL, CELL); g.clip(); setT(g); }
    drawFace(S, Hm, T, E, f, rng(1234 + i * 977));
    for (const g of [S, Hm, T, E]) g.restore();
  });
  const px = layers.map(l => l.g.getImageData(0, 0, W, H).data);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4, dst = y * W * 4;   // flip: texture row 0 = v 0 (bottom)
    for (let x = 0; x < W; x++) {
      const a = src + x * 4, b = dst + x * 4;
      out[b] = px[0][a]; out[b + 1] = px[1][a]; out[b + 2] = px[2][a]; out[b + 3] = px[3][a];
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

// soft radial blob in metres; rx, ry radii; colour as 'r,g,b' and peak alpha
function blob(g, x, y, rx, ry, col, a) {
  g.save(); g.translate(x, y); g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
}
const stroke = (g, pts, w, style) => { g.strokeStyle = style; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(...pts[0]); for (let k = 1; k < pts.length; k++) g.lineTo(...pts[k]); g.stroke(); };
const curve = (g, a, c, b, w, style) => { g.strokeStyle = style; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(...c, ...b); g.stroke(); };
const D = '0,0,0', L = '255,255,255';

function drawFace(S, Hm, T, E, f, r) {
  const age = f.age || 0;
  // ---- broad form shading: temples and jaw fall into shadow, forehead, cheekbones, nose bridge catch light
  for (const s of [-1, 1]) {
    blob(S, s * 0.098, 1.66, 0.03, 0.09, D, 0.35);           // temple / side of face
    blob(S, s * 0.05, 1.632, 0.024, 0.016, L, 0.18);         // cheekbone
    blob(S, s * 0.045, 1.6, 0.03, 0.022, D, 0.12 + age * 0.1); // hollow under the cheekbone
  }
  blob(S, 0, 1.725, 0.06, 0.035, L, 0.16);                   // forehead
  blob(S, 0, 1.545, 0.07, 0.02, D, 0.4);                     // under the jaw
  blob(S, 0, 1.567, 0.02, 0.011, L, 0.14);                   // chin
  blob(S, 0, 1.582, 0.018, 0.006, D, 0.35);                  // under the lower lip
  // A cell has one consistent facial structure on both sides, with slight natural asymmetry.
  const spacing = .031 + .005*r(), eyeHeight = 1.660 + .004*r();
  const eyeWidth = .0114 + .0026*r(), lidOpening = .0052 + .0015*r();
  const browHeight = 1.682 + .008*r();
  // ---- eyes
  for (const s of [-1, 1]) {
    const ex = s*spacing, ey = eyeHeight + s*.0005, hw = eyeWidth, hh = lidOpening;
    blob(S, ex, ey + 0.004, 0.024, 0.017, D, 0.42);           // socket
    blob(S, s * 0.04, 1.685, 0.022, 0.006, L, 0.16);          // brow ridge
    blob(S, ex, ey - 0.012, 0.014, 0.005, D, 0.18 + age * 0.22); // under-eye shadow / bags
    // almond: upper lid arc and lower lid arc (outer corner slightly higher)
    const inner = [ex - s * hw, ey - 0.0008], outer = [ex + s * hw, ey + 0.0012];
    const up = [ex + s * 0.001, ey + hh * 1.9], lo = [ex, ey - hh * 1.25];
    const almond = g => { g.beginPath(); g.moveTo(...inner); g.quadraticCurveTo(...up, ...outer); g.quadraticCurveTo(...lo, ...inner); g.closePath(); };
    E.save(); almond(E); E.fillStyle = 'rgb(85,85,85)'; E.fill(); E.clip();
    E.fillStyle = 'rgb(170,170,170)'; E.beginPath(); E.ellipse(ex + s * 0.0006, ey + 0.0004, 0.0056, 0.0056, 0, 0, Math.PI * 2); E.fill();
    E.fillStyle = 'rgb(255,255,255)'; E.beginPath(); E.ellipse(ex + s * 0.0006, ey + 0.0004, 0.0023, 0.0023, 0, 0, Math.PI * 2); E.fill();
    E.restore();
    // lid crease, lash line (heavier with liner), lower lid
    curve(S, [ex - s * hw * 0.9, ey + 0.0035], [ex, ey + hh * 2.9], [ex + s * hw * 1.05, ey + 0.004], 0.0011, `rgba(${D},0.28)`);
    const liner = f.liner || 0;
    curve(S, inner, up, [outer[0] + s * liner * 0.0028, outer[1] + liner * 0.0012], 0.0011 + liner * 0.0011 + (f.male ? 0 : 0.0003), `rgba(${D},${0.7 + liner * 0.25})`);
    curve(S, inner, lo, outer, 0.0007, `rgba(${D},0.3)`);
    // shadow the upper lid casts onto the eyeball
    curve(S, [inner[0] + s * 0.001, inner[1] + 0.0004], [up[0], up[1] - 0.0016], [outer[0] - s * 0.001, outer[1]], 0.0022, `rgba(${D},0.25)`);
    if (age) for (let k = 0; k < 3; k++) curve(S, [ex + s * 0.016, ey + 0.002 - k * 0.003], [ex + s * 0.021, ey + 0.001 - k * 0.0035], [ex + s * 0.025, ey + 0.002 - k * 0.005], 0.0006, `rgba(${D},0.22)`);
    // eyebrows: many short hairs along an arch, thicker at the inner end
    const b0 = 0.013, b1 = 0.054, by = browHeight;
    for (let k = 0; k < 140 * f.brow; k++) {
      const t = r(), x = s * (b0 + (b1 - b0) * t), arch = Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.75) * 0.0045 - (t > 0.75 ? (t - 0.75) * 0.01 : 0);
      const th = (f.male ? 0.0042 : 0.0028) * f.brow * (1 - t * 0.55);
      const y = by + arch + (r() - 0.5) * th, ang = s * (0.35 + t * 0.5), len = 0.003 + r() * 0.002;
      stroke(Hm, [[x, y], [x + s * Math.cos(ang) * len, y + Math.sin(Math.abs(ang)) * len * 0.5]], 0.0007, `rgba(${L},${0.35 + r() * 0.4})`);
    }
  }
  // ---- nose
  blob(S, 0, 1.655, 0.006, 0.02, L, 0.2);                    // bridge
  for (const s of [-1, 1]) {
    blob(S, s * 0.011, 1.65, 0.006, 0.02, D, 0.22);           // flanks
    blob(S, s * 0.0085, 1.629, 0.0042, 0.0026, D, 0.75);      // nostril
    blob(S, s * 0.013, 1.632, 0.006, 0.006, D, 0.2);          // ala crease
    // nasolabial fold
    curve(S, [s * 0.0145, 1.632], [s * 0.026, 1.616], [s * 0.028, 1.597], 0.0016 + age * 0.0008, `rgba(${D},${0.16 + age * 0.22})`);
  }
  blob(S, 0, 1.636, 0.009, 0.005, L, 0.22);                  // tip highlight
  blob(S, 0, 1.624, 0.016, 0.005, D, 0.4);                   // shadow under the nose
  blob(S, 0, 1.615, 0.0035, 0.007, D, 0.18);                 // philtrum
  // ---- mouth
  const mw = .0185 + .005*r(), my = 1.601 + .003*r();
  const upper = g => { g.beginPath(); g.moveTo(-mw, my); g.quadraticCurveTo(-mw * 0.5, my + 0.0058, -0.003, my + 0.0055); g.lineTo(0, my + 0.0047); g.lineTo(0.003, my + 0.0055); g.quadraticCurveTo(mw * 0.5, my + 0.0058, mw, my); g.quadraticCurveTo(0, my + 0.0008, -mw, my); g.closePath(); };
  const lower = g => { g.beginPath(); g.moveTo(-mw, my); g.quadraticCurveTo(0, my - 0.0002, mw, my); g.quadraticCurveTo(mw * 0.4, my - 0.0085, 0, my - 0.0088); g.quadraticCurveTo(-mw * 0.4, my - 0.0085, -mw, my); g.closePath(); };
  S.fillStyle = `rgba(${D},0.22)`; upper(S); S.fill();
  S.fillStyle = `rgba(${D},0.06)`; lower(S); S.fill();
  blob(S, 0, my - 0.004, 0.009, 0.0022, L, 0.22);            // lower lip highlight
  curve(S, [-mw, my], [0, my + 0.0005], [mw, my], 0.0012, `rgba(${D},0.65)`);
  for (const s of [-1, 1]) blob(S, s * mw, my, 0.002, 0.002, D, 0.4);
  const lipA = 90 + (f.lips || 0) * 130 + (f.male ? 0 : 20);
  T.fillStyle = `rgb(${lipA},${lipA},${lipA})`; upper(T); T.fill(); lower(T); T.fill();
  if (f.blush) for (const s of [-1, 1]) blob(T, s * 0.05, 1.625, 0.022, 0.014, L, f.blush * 0.35);
  for (const s of [-1, 1]) blob(T, s * 0.05, 1.628, 0.02, 0.012, L, 0.12);   // natural cheek warmth
  blob(T, 0, 1.636, 0.008, 0.006, L, 0.12);
  // ---- age lines
  if (age) {
    for (let k = 0; k < 3; k++) curve(S, [-0.04, 1.712 + k * 0.009], [0, 1.716 + k * 0.009], [0.04, 1.712 + k * 0.009], 0.0008, `rgba(${D},0.2)`);
    for (const s of [-1, 1]) curve(S, [s * 0.024, 1.598], [s * 0.026, 1.588], [s * 0.022, 1.577], 0.001, `rgba(${D},0.25)`);
    curve(S, [-0.005, 1.68], [-0.004, 1.69], [-0.005, 1.697], 0.0008, `rgba(${D},0.2)`);
  }
  if (f.freckles) for (let k = 0; k < 160; k++) { const x = (r() - 0.5) * 0.09, y = 1.63 + (r() - 0.5) * 0.03; if (Math.abs(x) < 0.012 && y < 1.62) continue; blob(S, x, y, 0.0009, 0.0009, '90,50,30', 0.35 * r()); }
  // ---- facial hair (G channel), only below the cheek line
  const beardZone = (x, y) => {
    const ax = Math.abs(x);
    if (y > 1.628 - ax * 0.25 || y < 1.535) return false;
    if (ax > 0.075) return false;
    if (Math.abs(y - (my - 0.0015)) < 0.0062 && ax < mw - 0.001) return false;     // lips
    if (y > 1.62 && ax < 0.017) return false;                                         // nostrils
    return true;
  };
  const dots = (n, alpha, len, test) => {
    for (let k = 0; k < n; k++) {
      const x = (r() - 0.5) * 0.15, y = 1.535 + r() * 0.1;
      if (!beardZone(x, y) || (test && !test(x, y))) continue;
      const a = r() * Math.PI * 2;
      stroke(Hm, [[x, y], [x + Math.cos(a) * len * 0.4, y - len]], 0.0006 + len * 0.15, `rgba(${L},${alpha * (0.5 + r() * 0.5)})`);
    }
  };
  if (f.stubble) {
    // even five o'clock shadow plus individual stubble dots
    for (let k = 0; k < 4000 * f.stubble; k++) { const x = (r() - 0.5) * 0.15, y = 1.535 + r() * 0.1; if (beardZone(x, y)) blob(Hm, x, y, 0.0012, 0.0012, L, 0.18 + f.stubble * 0.3); }
    dots(2200 * f.stubble, 0.6, 0.0009);
  }
  if (f.beard) { for (let k = 0; k < 9000; k++) { const x = (r() - 0.5) * 0.15, y = 1.535 + r() * 0.1; if (beardZone(x, y)) blob(Hm, x, y, 0.002, 0.002, L, 0.5); } dots(5000, 0.9, 0.004); }
  if (f.moustache || f.beard) {
    for (let k = 0; k < 900; k++) {
      const t = r() * 2 - 1, x = t * (mw + 0.004), y = my + 0.0062 + (1 - t * t) * 0.006 + r() * 0.004 - Math.abs(t) * 0.004;
      stroke(Hm, [[x, y], [x + Math.sign(t) * 0.0025, y - 0.004]], 0.0007, `rgba(${L},${0.5 + r() * 0.5})`);
    }
  }
}

// tileable hair strand map (R brightness, G clump shading)
export function bakeHairTexture(seed = 77) {
  const N = 256, r = rng(seed);
  const c = canvas(N, N), g = c.getContext('2d');
  g.fillStyle = 'rgb(110,110,110)'; g.fillRect(0, 0, N, N);
  const c2 = canvas(N, N), g2 = c2.getContext('2d');
  g2.fillStyle = 'rgb(150,150,150)'; g2.fillRect(0, 0, N, N);
  // clumps: soft vertical bands of light and shadow
  for (let k = 0; k < 60; k++) {
    const x = r() * N, w = 3 + r() * 10, v = r() < 0.5 ? 0 : 255, a = 0.12 + r() * 0.2;
    for (const ox of [-N, 0, N]) { const gr = g2.createLinearGradient(x + ox - w, 0, x + ox + w, 0); gr.addColorStop(0, `rgba(${v},${v},${v},0)`); gr.addColorStop(0.5, `rgba(${v},${v},${v},${a})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g2.fillStyle = gr; g2.fillRect(x + ox - w, 0, w * 2, N); }
  }
  // strands: long, slightly wavy, wrapped at the edges so the map tiles
  for (let k = 0; k < 2600; k++) {
    const x0 = r() * N, y0 = r() * N, len = 20 + r() * 60, v = Math.round(40 + r() * 200), a = 0.25 + r() * 0.45, wv = (r() - 0.5) * 4;
    g.strokeStyle = `rgba(${v},${v},${v},${a})`; g.lineWidth = 0.6 + r() * 0.9;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      g.beginPath(); g.moveTo(x0 + ox, y0 + oy); g.quadraticCurveTo(x0 + ox + wv, y0 + oy + len / 2, x0 + ox + wv * 0.3, y0 + oy + len); g.stroke();
    }
  }
  const a = g.getImageData(0, 0, N, N).data, b = g2.getImageData(0, 0, N, N).data;
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { out[i * 4] = a[i * 4]; out[i * 4 + 1] = b[i * 4]; out[i * 4 + 2] = 128; out[i * 4 + 3] = 255; }
  const tex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}
