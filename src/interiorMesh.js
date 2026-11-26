// Draws an interior plan (interiorPlan.js): walls with their doors and windows (real openings you see out
// through), floors, ceilings, skirting, stairs with banisters, ceiling lights and the furniture. Everything is
// unlit with light baked into the vertex colours (ceiling-light falloff, darker corners, faces by direction),
// so interiors cost no lights or shadows, look the same on every phone and never flicker.
import * as THREE from 'three/webgpu';
import { MENUS, STYLE, price } from './food.js';

// ------------------------------------------------------------------ textures (canvas, made once)
const TEX = {};
function canvas(n, draw) { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); return c; }
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function tex(name, n, draw, rep = 1) {
  if (TEX[name]) return TEX[name];
  const t = new THREE.CanvasTexture(canvas(n, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.userData.rep = rep;
  return (TEX[name] = t);
}
const noise = (c, n, a, b, k, seed) => { const R = rnd(seed); const im = c.getImageData(0, 0, n, n), d = im.data; for (let i = 0; i < d.length; i += 4) { const v = (R() - 0.5) * k; d[i] = Math.max(0, Math.min(255, d[i] + v * a)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v * a)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v * b)); } c.putImageData(im, 0, 0); };
const TEXTURES = {
  // 1 texture = rep metres
  plaster: () => tex('plaster', 256, (c, n) => { c.fillStyle = '#f6f6f6'; c.fillRect(0, 0, n, n); noise(c, n, 1, 1, 10, 3); }, 2),
  wallpaper: () => tex('wallpaper', 256, (c, n) => {
    c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, n, n);
    c.fillStyle = '#dedede'; for (let x = 0; x < n; x += 32) c.fillRect(x, 0, 12, n);
    c.strokeStyle = '#d0d0d0'; c.lineWidth = 2; for (let y = 16; y < n; y += 64) for (let x = 22; x < n; x += 32) { c.beginPath(); c.ellipse(x, y + (x % 64 ? 32 : 0), 5, 9, 0, 0, 7); c.stroke(); }
    noise(c, n, 1, 1, 8, 5);
  }, 0.8),
  wood: () => tex('wood', 512, (c, n) => {
    const R = rnd(11), rows = 8, h = n / rows;
    for (let r = 0; r < rows; r++) {
      let x = -R() * 300;
      while (x < n) {
        const L = 220 + R() * 260, tone = 0.86 + R() * 0.22;
        c.fillStyle = `rgb(${Math.round(196 * tone)},${Math.round(152 * tone)},${Math.round(104 * tone)})`; c.fillRect(x, r * h, L, h - 2);
        c.strokeStyle = `rgba(90,55,25,${0.12 + R() * 0.12})`; c.lineWidth = 1;
        for (let k = 0; k < 6; k++) { const y = r * h + 3 + R() * (h - 6); c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + L * 0.3, y + (R() - 0.5) * 6, x + L * 0.6, y + (R() - 0.5) * 6, x + L, y + (R() - 0.5) * 4); c.stroke(); }
        c.fillStyle = 'rgba(60,35,15,0.5)'; c.fillRect(x + L - 1, r * h, 2, h - 2);
        x += L;
      }
      c.fillStyle = 'rgba(50,30,12,0.55)'; c.fillRect(0, r * h + h - 2, n, 2);
    }
  }, 1.6),
  carpet: () => tex('carpet', 256, (c, n) => { c.fillStyle = '#eeeeee'; c.fillRect(0, 0, n, n); noise(c, n, 1, 1, 34, 7); }, 0.6),
  carpettile: () => tex('carpettile', 256, (c, n) => { c.fillStyle = '#e8e8e8'; c.fillRect(0, 0, n, n); noise(c, n, 1, 1, 30, 9); c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2; c.strokeRect(1, 1, n - 2, n - 2); c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(0, 0, n / 2, n / 2); c.fillRect(n / 2, n / 2, n / 2, n / 2); }, 1.0),
  tile: () => tex('tile', 256, (c, n) => {
    c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, n, n);
    const k = 4, s = n / k; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const v = 238 + (((i * 7 + j * 3) % 5) - 2) * 3; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    noise(c, n, 1, 1, 6, 13);
  }, 1.2),
  concrete: () => tex('concrete', 512, (c, n) => {
    c.fillStyle = '#d4d4d4'; c.fillRect(0, 0, n, n); noise(c, n, 1, 1, 26, 17);
    const R = rnd(19); for (let k = 0; k < 14; k++) { c.fillStyle = `rgba(80,80,80,${0.03 + R() * 0.05})`; c.beginPath(); c.ellipse(R() * n, R() * n, 20 + R() * 80, 10 + R() * 40, R() * 3, 0, 7); c.fill(); }
    c.fillStyle = 'rgba(60,60,60,0.35)'; c.fillRect(0, 0, n, 2); c.fillRect(0, 0, 2, n);
  }, 6),
  metal: () => tex('metal', 256, (c, n) => { c.fillStyle = '#ececec'; c.fillRect(0, 0, n, n); for (let x = 0; x < n; x += 32) { c.fillStyle = '#d2d2d2'; c.fillRect(x, 0, 6, n); c.fillStyle = '#fafafa'; c.fillRect(x + 6, 0, 3, n); } noise(c, n, 1, 1, 6, 23); }, 2),
  marble: () => tex('marble', 512, (c, n) => {
    c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, n, n);
    const R = rnd(29); c.lineWidth = 1.2;
    for (let k = 0; k < 18; k++) { c.strokeStyle = `rgba(120,120,125,${0.08 + R() * 0.14})`; c.beginPath(); let x = R() * n, y = R() * n; c.moveTo(x, y); for (let q = 0; q < 12; q++) { x += (R() - 0.3) * 50; y += (R() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, 0, n, 2); c.fillRect(0, 0, 2, n); c.fillRect(n / 2, 0, 2, n); c.fillRect(0, n / 2, n, 2);
  }, 2.4),
  ceiling: () => tex('ceiling', 256, (c, n) => { c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, n, n); noise(c, n, 1, 1, 14, 31); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, n, 3); c.fillRect(0, 0, 3, n); }, 0.6),
  books: () => tex('books', 256, (c, n) => {
    const R = rnd(37); c.fillStyle = '#3a2a1a'; c.fillRect(0, 0, n, n);
    for (let row = 0; row < 4; row++) { let x = 2; const y0 = row * 64 + 6; while (x < n - 4) { const w = 6 + R() * 10, h = 40 + R() * 16; c.fillStyle = `hsl(${R() * 360},${30 + R() * 40}%,${25 + R() * 40}%)`; c.fillRect(x, y0 + 58 - h, w, h); x += w + 1; } }
  }, 1),
  products: () => tex('products', 512, (c, n) => {
    const R = rnd(41); c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, n, n);
    for (let row = 0; row < 4; row++) { let x = 0; const y0 = row * 128; c.fillStyle = '#c8c8c8'; c.fillRect(0, y0 + 118, n, 10); while (x < n) { const w = 14 + R() * 30, h = 50 + R() * 60, hue = R() * 360; for (let q = 0; q < 2 + R() * 3 && x < n; q++) { c.fillStyle = `hsl(${hue},${55 + R() * 35}%,${40 + R() * 25}%)`; c.fillRect(x + 1, y0 + 118 - h, w - 2, h); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x + 3, y0 + 118 - h * 0.6, w - 6, h * 0.18); x += w; } } }
  }, 1),
  bottles: () => tex('bottles', 256, (c, n) => {
    const R = rnd(43); c.fillStyle = '#2a1a10'; c.fillRect(0, 0, n, n);
    for (let row = 0; row < 3; row++) { let x = 4; const y0 = row * 85 + 80; c.fillStyle = '#7a5a3a'; c.fillRect(0, y0, n, 5); while (x < n - 8) { const w = 9 + R() * 5, h = 34 + R() * 24; c.fillStyle = `hsla(${R() < 0.5 ? 30 + R() * 30 : 90 + R() * 60},${50 + R() * 40}%,${30 + R() * 40}%,0.95)`; c.fillRect(x, y0 - h, w, h); c.fillRect(x + w * 0.3, y0 - h - 10, w * 0.4, 10); x += w + 3; } }
  }, 1),
  art: () => tex('art', 256, (c, n) => {
    const R = rnd(47); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = i * 64, y = j * 64; c.fillStyle = `hsl(${R() * 360},${30 + R() * 40}%,${45 + R() * 30}%)`; c.fillRect(x, y, 64, 64); for (let k = 0; k < 4; k++) { c.fillStyle = `hsla(${R() * 360},${40 + R() * 40}%,${30 + R() * 50}%,0.8)`; c.beginPath(); c.arc(x + R() * 64, y + R() * 64, 6 + R() * 18, 0, 7); c.fill(); } c.strokeStyle = '#2a2a2a'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, 60, 60); }
  }, 1),
  stained: () => tex('stained', 256, (c, n) => {
    const R = rnd(53); c.fillStyle = '#222'; c.fillRect(0, 0, n, n);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 16; j++) { c.fillStyle = `hsl(${[0, 45, 210, 120, 280][Math.floor(R() * 5)]},${60 + R() * 30}%,${40 + R() * 25}%)`; c.fillRect(i * 32 + 2, j * 16 + 2, 28, 12); }
  }, 1),
};
// the mall's shop signs: one atlas, a row each
let SIGNS = null;
function signAtlas(names) {
  if (SIGNS) return SIGNS;
  const rows = names.length, c = document.createElement('canvas'); c.width = 1024; c.height = rows * 64;
  const g = c.getContext('2d');
  names.forEach((nm, i) => { g.fillStyle = '#ffffff'; g.fillRect(0, i * 64, 1024, 64); g.fillStyle = '#1b1b1b'; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(nm.toUpperCase(), 512, i * 64 + 34); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  SIGNS = { t, rows, index: new Map(names.map((n, i) => [n, i])) };
  return SIGNS;
}

// ------------------------------------------------------------------ materials (shared by every interior)
let MATS = null;
export function materials() {
  if (MATS) return MATS;
  const M = (map, o = {}) => { const m = new THREE.MeshBasicNodeMaterial({ vertexColors: true, map: map || null, ...o }); m.userData.rep = map?.userData.rep || 1; return m; };
  MATS = {
    plain: M(null), plaster: M(TEXTURES.plaster()), wallpaper: M(TEXTURES.wallpaper()), wood: M(TEXTURES.wood()), carpet: M(TEXTURES.carpet()),
    carpettile: M(TEXTURES.carpettile()), tile: M(TEXTURES.tile()), concrete: M(TEXTURES.concrete()), metal: M(TEXTURES.metal()), marble: M(TEXTURES.marble()),
    ceiling: M(TEXTURES.ceiling()), books: M(TEXTURES.books()), products: M(TEXTURES.products()), bottles: M(TEXTURES.bottles()), art: M(TEXTURES.art()),
    stained: M(TEXTURES.stained()), glow: M(null),
    glass: new THREE.MeshBasicNodeMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    frosted: new THREE.MeshBasicNodeMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
  };
  MATS.glass.userData.rep = MATS.frosted.userData.rep = 1;
  MATS.sign = new THREE.MeshBasicNodeMaterial({ map: signAtlas(MALL_NAMES).t, vertexColors: true }); MATS.sign.userData.rep = 1;
  return MATS;
}
// the overall brightness (and a warmer cast at night) for every interior
export function setDaylight(day) {
  const m = materials(), k = 1.0 + 0.1 * day;
  const warm = new THREE.Color(1.0, 0.97 - 0.03 * (1 - day), 0.92 - 0.06 * (1 - day)).multiplyScalar(k);
  for (const [n, mm] of Object.entries(m)) if (n !== 'glass' && n !== 'frosted') mm.color.copy(n === 'glow' || n === 'stained' || n === 'sign' || n.startsWith('menu:') ? new THREE.Color(1.6, 1.6, 1.6) : warm);
}

// the menu boards over the counter: dishes and prices on a dark board, lit (one texture per place kind and panel)
function menuMaterial(cat, k, n) {
  const M = materials(), name = `menu:${cat}:${k}:${n}`;
  if (M[name]) return name;
  const menu = MENUS[cat] || MENUS.burger, st = STYLE[cat] || STYLE.burger;
  const c = document.createElement('canvas'); c.width = 768; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = st.board; g.fillRect(0, 0, 768, 256);
  g.strokeStyle = st.hi; g.lineWidth = 6; g.strokeRect(6, 6, 756, 244);
  const per = Math.ceil(menu.items.length / n), items = menu.items.slice(k * per, k * per + per);
  g.textBaseline = 'middle';
  g.fillStyle = st.hi; g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'left';
  g.fillText(k === 0 ? menu.title.toUpperCase() : k === n - 1 ? 'DRINKS & SIDES' : 'MORE', 26, 36);
  const rows = Math.max(1, Math.ceil(items.length / 2)), lh = Math.min(48, 190 / rows);
  items.forEach(([nm, pr], i) => {
    const col = Math.floor(i / rows), row = i % rows, x = 26 + col * 372, y = 82 + row * lh;
    g.fillStyle = st.ink; g.font = `600 ${Math.min(26, lh * 0.62)}px system-ui, sans-serif`; g.textAlign = 'left'; g.fillText(nm, x, y);
    g.fillStyle = st.hi; g.textAlign = 'right'; g.fillText(price(pr), x + 340, y);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshBasicNodeMaterial({ map: t, vertexColors: true }); m.userData.rep = 1; m.color.setScalar(1.5);
  M[name] = m;
  return name;
}

// ------------------------------------------------------------------ geometry builder
const C = new THREE.Color();
class GB {
  constructor() { this.bufs = new Map(); this.ctx = { cx: 0, cy: 0, r: 4, h: 0, k: 1 }; this.tris = 0; }
  buf(mat) { let b = this.bufs.get(mat); if (!b) this.bufs.set(mat, b = { p: [], c: [], u: [] }); return b; }
  // a quad from corner p along u then v (front face where u x v points); p, u, v as [x, h, y]
  quad(mat, p, u, v, col, o = {}) {
    const b = this.buf(mat), rep = o.rep || materials()[mat]?.userData.rep || 1;
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0], nl = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / nl, ny / nl, nz / nl];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    const P = [p, [p[0] + u[0], p[1] + u[1], p[2] + u[2]], [p[0] + u[0] + v[0], p[1] + u[1] + v[1], p[2] + u[2] + v[2]], [p[0] + v[0], p[1] + v[1], p[2] + v[2]]];
    const U = o.uv || [[0, 0], [lu / rep, 0], [lu / rep, lv / rep], [0, lv / rep]];
    const u0 = o.uv0 || [0, 0];
    C.set(col ?? 0xffffff);
    const S = P.map(q => this.shade(n, q, o));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = P[k]; b.p.push(q[0], q[1], q[2]);
      const s = S[k]; b.c.push(C.r * s, C.g * s, C.b * s);
      b.u.push(U[k][0] + u0[0], U[k][1] + u0[1]);
    }
    this.tris += 2;
  }
  // baked light: by facing, ceiling-light falloff in the room, darker low down on walls
  shade(n, q, o) {
    if (o.flat) return o.flat;
    const c = this.ctx;
    const dir = n[1] > 0.5 ? 1.0 : n[1] < -0.5 ? 0.78 : 0.86 + 0.06 * n[0] + 0.03 * n[2];
    const dx = q[0] - c.cx, dy = q[2] - c.cy, fall = 0.66 + 0.46 * Math.exp(-(dx * dx + dy * dy) / (c.r * c.r));
    const hh = q[1] - c.h, low = Math.abs(n[1]) < 0.5 ? 0.78 + 0.22 * Math.min(1, Math.max(0, hh / 1.4)) : 1;
    return dir * fall * low * c.k;
  }
  // an axis-free box in an item's frame: centre (x, y), turned rot, u across, v depth (+v the front), h up
  box(mat, f, u0, u1, v0, v1, h0, h1, col, o = {}) {
    const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
    const at = (u, v, h) => [f.x + u * c - v * s, h + (f.h || 0), f.y + u * s + v * c];
    const eu = [c, 0, s], ev = [-s, 0, c], du = u1 - u0, dv = v1 - v0, dh = h1 - h0;
    const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const sk = o.skip || '';
    if (!sk.includes('f')) this.quad(o.front || mat, at(u0, v1, h0), sc(eu, du), [0, dh, 0], o.frontCol ?? col, o.frontUV ? { uv: o.frontUV } : o);
    if (!sk.includes('b')) this.quad(mat, at(u1, v0, h0), sc(eu, -du), [0, dh, 0], col, o);
    if (!sk.includes('r')) this.quad(mat, at(u1, v1, h0), sc(ev, -dv), [0, dh, 0], col, o);
    if (!sk.includes('l')) this.quad(mat, at(u0, v0, h0), sc(ev, dv), [0, dh, 0], col, o);
    if (!sk.includes('t')) this.quad(o.top || mat, at(u0, v0, h1), sc(ev, dv), sc(eu, du), o.topCol ?? col, o);
    if (!sk.includes('d')) this.quad(mat, at(u0, v0, h0), sc(eu, du), sc(ev, dv), col, o);
  }
  // an octagonal post (pots, lamps, legs)
  cyl(mat, f, u, v, r, h0, h1, col, seg = 8, o = {}) {
    const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
    const cx = f.x + u * c - v * s, cy = f.y + u * s + v * c, H = f.h || 0;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = [cx + Math.cos(a1) * r, h0 + H, cy + Math.sin(a1) * r], q = [cx + Math.cos(a0) * r, h0 + H, cy + Math.sin(a0) * r];
      this.quad(mat, p, [q[0] - p[0], 0, q[2] - p[2]], [0, h1 - h0, 0], col, o);
      if (!o.open) this.tri(mat, [cx, h1 + H, cy], [q[0], h1 + H, q[2]], [p[0], h1 + H, p[2]], o.topCol ?? col);
    }
  }
  // a beam from p0 to p1 (any direction), w wide and h deep
  beam(mat, p0, p1, w, h, col) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d) || 1, dn = d.map(v => v / L);
    let sd = [dn[2], 0, -dn[0]]; const sl = Math.hypot(sd[0], sd[2]) || 1; sd = sd.map(v => v / sl);
    const up = [sd[1] * dn[2] - sd[2] * dn[1], sd[2] * dn[0] - sd[0] * dn[2], sd[0] * dn[1] - sd[1] * dn[0]];
    const S = sd.map(v => v * w / 2), U = up.map(v => v * h / 2), add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
    const c0 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    const face = (a, b, c) => { // a parallelogram a, a+(b-a), a+(c-a); flipped to face out from the beam's middle
      const u = b.map((v, i) => v - a[i]), v = c.map((q, i) => q - a[i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const mid = a.map((q, i) => q + (u[i] + v[i]) / 2 - c0[i]);
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] >= 0) this.quad(mat, a, u, v, col); else this.quad(mat, a, v, u, col);
    };
    const A = (s, t, e) => add(add(e ? p1 : p0, S, s), U, t);
    face(A(-1, 1, 0), A(1, 1, 0), A(-1, 1, 1)); face(A(-1, -1, 0), A(-1, -1, 1), A(1, -1, 0));
    face(A(1, -1, 0), A(1, -1, 1), A(1, 1, 0)); face(A(-1, -1, 0), A(-1, 1, 0), A(-1, -1, 1));
    face(A(-1, -1, 0), A(1, -1, 0), A(-1, 1, 0)); face(A(-1, -1, 1), A(-1, 1, 1), A(1, -1, 1));
  }
  tri(mat, a, b, c, col) {
    const B = this.buf(mat); C.set(col);
    const s = this.shade([0, 1, 0], a, {});
    for (const q of [a, b, c]) { B.p.push(q[0], q[1], q[2]); B.c.push(C.r * s, C.g * s, C.b * s); B.u.push(q[0], q[2]); }
    this.tris++;
  }
  // geometry per material
  meshes() {
    const M = materials(), out = [];
    for (const [mat, b] of this.bufs) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, M[mat] || M.plain);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      if (mat === 'glass' || mat === 'frosted') m.renderOrder = 2;
      out.push(m);
    }
    return out;
  }
}

// ------------------------------------------------------------------ the shell: floors, ceilings, walls, openings
const mat = f => (f && f[0]) || 'plaster';
function subtract(r, holes) {
  let rects = [[r.x0, r.y0, r.x1, r.y1]];
  for (const h of holes) {
    const next = [];
    for (const [x0, y0, x1, y1] of rects) {
      if (h.x1 <= x0 || h.x0 >= x1 || h.y1 <= y0 || h.y0 >= y1) { next.push([x0, y0, x1, y1]); continue; }
      if (h.y0 > y0) next.push([x0, y0, x1, h.y0]);
      if (h.y1 < y1) next.push([x0, h.y1, x1, y1]);
      const ya = Math.max(y0, h.y0), yb = Math.min(y1, h.y1);
      if (h.x0 > x0) next.push([x0, ya, h.x0, yb]);
      if (h.x1 < x1) next.push([h.x1, ya, x1, yb]);
    }
    rects = next;
  }
  return rects;
}
function lightOf(r, lvH, k = 1) { return { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, r: Math.max(2.2, Math.hypot(r.x1 - r.x0, r.y1 - r.y0) * 0.55), h: lvH, k }; }

export function buildInterior(P) {
  const gb = new GB(), M = materials();
  const style = P.style, trap = style.trap;
  const dim = trap ? 0.8 : 1;
  for (const lv of P.levels) {
    const H = lv.h, top = H + lv.ceil;
    const next = P.levels[lv.i + 1];
    // floors and ceilings
    for (const r of lv.rooms) {
      gb.ctx = lightOf(r, H, dim * (r.light ?? 1));
      for (const [x0, y0, x1, y1] of subtract(r, lv.holes)) gb.quad(mat(r.floor), [x0, H, y0], [0, 0, y1 - y0], [x1 - x0, 0, 0], r.floor[1]);
      const ceilMat = r.kind === 'office' || r.kind === 'shop' ? 'ceiling' : 'plain';
      for (const [x0, y0, x1, y1] of subtract(r, next ? next.holes : [])) gb.quad(ceilMat, [x0, top, y0], [x1 - x0, 0, 0], [0, 0, y1 - y0], r.ceil);
      // the stairwell's sides, between this ceiling and the next floor
      if (next) for (const h of next.holes) {
        const hh = next.h - top; if (hh <= 0.01) continue;
        const x0 = Math.max(r.x0, h.x0), x1 = Math.min(r.x1, h.x1), y0 = Math.max(r.y0, h.y0), y1 = Math.min(r.y1, h.y1);
        if (x1 <= x0 || y1 <= y0) continue;
        // (faces looking into the well)
        gb.quad('plain', [x0, top, y0], [x1 - x0, 0, 0], [0, hh, 0], r.ceil); gb.quad('plain', [x1, top, y1], [x0 - x1, 0, 0], [0, hh, 0], r.ceil);
        gb.quad('plain', [x0, top, y1], [0, 0, y0 - y1], [0, hh, 0], r.ceil); gb.quad('plain', [x1, top, y0], [0, 0, y1 - y0], [0, hh, 0], r.ceil);
      }
      lights(gb, r, lv, top, style);
    }
    // walls
    for (const s of lv.walls) drawWall(gb, P, lv, s, H, top);
    // stair rails up here
    for (const rl of lv.rails) if (rl.top) rail(gb, rl, H, 0.92, style);
  }
  for (const st of P.stairs) stairs(gb, P, st);
  for (const it of P.items) {
    const lv = P.levels[it.lv];
    const r = lv.rooms.find(q => it.x >= q.x0 && it.x <= q.x1 && it.y >= q.y0 && it.y <= q.y1) || lv.rooms[0];
    gb.ctx = lightOf(r, lv.h, dim * (r.light ?? 1));
    const f = { x: it.x, y: it.y, rot: it.rot || 0, h: lv.h + (it.base || 0) };
    (ITEM[it.type] || ITEM.box)(gb, it, f, P);
  }
  const group = new THREE.Group();
  for (const m of gb.meshes()) group.add(m);
  group.userData.tris = gb.tris;
  return group;
}

// a wall: its face on each side it has a room, cut round its openings, with skirting, reveals, frames, glass, doors
function drawWall(gb, P, lv, s, H, top) {
  const horiz = s.o === 'h', ceil = top - H;
  const t = s.outer ? 0 : 0.05;                 // half thickness of a partition (outer walls: the inner face only)
  const faces = [];
  s.rooms.forEach((r, i) => faces.push({ r, side: s.sides[i] }));
  const ops = s.open;
  for (const { r, side } of faces) {
    gb.ctx = lightOf(r, H, (P.style.trap ? 0.8 : 1) * (r.light ?? 1));
    // the face lies at c + side*t, facing the room (side +1: room on the +c side)
    const c = s.c + side * t;
    const wm = mat(r.wall), wc = r.wall[1];
    // pieces between openings (full height), and under/over each opening
    let a = s.a;
    const spans = [];
    for (const o of ops) { if (o.a > a) spans.push([a, o.a, 0, ceil]); if (o.bot > 0.01) spans.push([o.a, o.b, 0, o.bot]); if (o.top < ceil - 0.01) spans.push([o.a, o.b, o.top, ceil]); a = o.b; }
    if (s.b > a) spans.push([a, s.b, 0, ceil]);
    // (a shopfront: glass up to the doorway's head either side of it, the wall above)
    const sf = ops.find(o => o.kind === 'shopfront');
    for (const [p0, p1, h0, h1] of spans) {
      if (sf && h0 === 0 && h1 > sf.top) {
        if (side === s.sides[0]) face(gb, horiz, c, side, p0, p1, H, H + sf.top, 'glass', 0xffffff);
        face(gb, horiz, c, side, p0, p1, H + sf.top, H + h1, wm, wc);
        for (const pp of [p0, p1]) { const fr2 = horiz ? { x: pp, y: c, rot: 0, h: H } : { x: c, y: pp, rot: Math.PI / 2, h: H }; gb.box('plain', fr2, -0.04, 0.04, -0.04, 0.04, 0, sf.top, 0x3b3b3b); }
        continue;
      }
      face(gb, horiz, c, side, p0, p1, H + h0, H + h1, wm, wc);
    }
    // skirting along the floor (not across doorways)
    if (!r.kind || !/warehouse|mall|church/.test(r.kind)) {
      let sa = s.a;
      const sk = [];
      for (const o of ops) { if (o.bot < 0.3) { if (o.a > sa) sk.push([sa, o.a]); sa = o.b; } }
      if (s.b > sa) sk.push([sa, s.b]);
      for (const [p0, p1] of sk) face(gb, horiz, c + side * 0.012, side, p0, p1, H, H + 0.1, 'plain', P.style.trap ? 0xd8d0bc : 0xf6f5f0);
    }
    // openings: reveals through the wall's thickness, frames, glass or a door
    for (const o of ops) opening(gb, P, s, o, r, side, c, H, top);
  }
}
// one face of wall at line c (horizontal: y = c), from p0 to p1 along it, h0..h1, facing side (+1: towards +c)
function face(gb, horiz, c, side, p0, p1, h0, h1, m, col, o) {
  if (p1 - p0 < 0.005 || h1 - h0 < 0.005) return;
  if (horiz) { if (side > 0) gb.quad(m, [p0, h0, c], [p1 - p0, 0, 0], [0, h1 - h0, 0], col, o); else gb.quad(m, [p1, h0, c], [p0 - p1, 0, 0], [0, h1 - h0, 0], col, o); }
  else { if (side > 0) gb.quad(m, [c, h0, p1], [0, 0, p0 - p1], [0, h1 - h0, 0], col, o); else gb.quad(m, [c, h0, p0], [0, 0, p1 - p0], [0, h1 - h0, 0], col, o); }
}
// a point on the wall's line: along u, out from the face by d (towards the room when d > 0)
const wp = (horiz, c, side, u, h, d) => horiz ? [u, h, c + side * d] : [c + side * d, h, u];
function opening(gb, P, s, o, r, side, c, H, top) {
  const horiz = s.o === 'h', depth = s.outer ? 0.3 : 0.1, out = -depth;   // the reveal runs from the face back into the wall
  const jamb = (u, sgn) => {   // a reveal face across the thickness at u, facing along +-u
    const p = wp(horiz, c, side, u, H + o.bot, 0), q = wp(horiz, c, side, u, H + o.bot, out);
    const d = [q[0] - p[0], 0, q[2] - p[2]];
    // orient so it faces into the opening
    const n = horiz ? [0, 0, 0] : [0, 0, 0]; void n;
    const up = [0, o.top - o.bot, 0];
    const cr = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
    const along = horiz ? cr[0] : cr[2];
    if (Math.sign(along) === sgn) gb.quad('plain', p, d, up, 0xf3f2ee); else gb.quad('plain', q, [-d[0], 0, -d[2]], up, 0xf3f2ee);
  };
  if (o.kind !== 'arch' || true) { jamb(o.a, +1); jamb(o.b, -1); }
  // head (soffit) and sill
  const headA = wp(horiz, c, side, o.a, H + o.top, 0), headB = wp(horiz, c, side, o.b, H + o.top, 0), headO = wp(horiz, c, side, o.a, H + o.top, out);
  const soff = [headB[0] - headA[0], 0, headB[2] - headA[2]], inw = [headO[0] - headA[0], 0, headO[2] - headA[2]];
  const crs = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (crs(soff, inw)[1] < 0) gb.quad('plain', headA, soff, inw, 0xf3f2ee); else gb.quad('plain', headA, inw, soff, 0xf3f2ee);
  if (o.bot > 0.01) {
    const sa = wp(horiz, c, side, o.a - 0.04, H + o.bot, 0.04), sb = wp(horiz, c, side, o.b + 0.04, H + o.bot, 0.04), so = wp(horiz, c, side, o.a - 0.04, H + o.bot, out);
    const v1 = [sb[0] - sa[0], 0, sb[2] - sa[2]], v2 = [so[0] - sa[0], 0, so[2] - sa[2]];
    if (crs(v1, v2)[1] > 0) gb.quad('plain', sa, v1, v2, 0xf6f5f0); else gb.quad('plain', sa, v2, v1, 0xf6f5f0);
  }
  const len = o.b - o.a, hgt = o.top - o.bot, mid = (o.a + o.b) / 2;
  // an item frame for boxes in the opening: u along the wall, v out of the room
  const fr = horiz ? { x: mid, y: c, rot: side > 0 ? 0 : Math.PI, h: H } : { x: c, y: mid, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, h: H };
  if (o.kind === 'window') {
    if (side !== (s.sides[0])) return;
    const ext = -depth + 0.06;    // the window sits near the outside of the reveal
    const fc = P.style.church ? 0x6b5a46 : P.style.trap ? 0xe0dccf : 0xf4f4f2;
    // frame
    gb.box('plain', fr, -len / 2, len / 2, ext - 0.04, ext + 0.02, o.bot, o.bot + 0.06, fc);
    gb.box('plain', fr, -len / 2, len / 2, ext - 0.04, ext + 0.02, o.top - 0.06, o.top, fc);
    gb.box('plain', fr, -len / 2, -len / 2 + 0.06, ext - 0.04, ext + 0.02, o.bot, o.top, fc);
    gb.box('plain', fr, len / 2 - 0.06, len / 2, ext - 0.04, ext + 0.02, o.bot, o.top, fc);
    if (len > 1.1 && !P.style.warehouse) gb.box('plain', fr, -0.03, 0.03, ext - 0.04, ext + 0.02, o.bot, o.top, fc);
    // glass, frosted, stained, or covered over
    const pane = (m, col, flat) => gb.quad(m, wp(horiz, c, side, side > 0 === horiz ? o.a : o.b, H + o.bot, ext - 0.01), horiz ? [(side > 0 ? 1 : -1) * len, 0, 0] : [0, 0, (side > 0 ? -1 : 1) * len], [0, hgt, 0], col, flat ? { flat } : undefined);
    if (P.style.church) pane('stained', 0xffffff, 1);
    else if (o.cover === 'foil') pane('plain', 0xc9ccd0, 0.95);
    else if (o.frosted) pane('frosted', 0xffffff);
    else pane('glass', 0xffffff);
    if (o.cover === 'boards') for (let k = 0; k < 4; k++) { const h0 = o.bot + 0.05 + k * hgt / 4, tilt = (k % 2 ? 1 : -1) * 0.02; gb.box('plain', fr, -len / 2 - 0.05, len / 2 + 0.05, 0.0, 0.025, h0, h0 + hgt / 4 - 0.06 + tilt, 0xa88a5e); }
    // a radiator under the window in homes
    const home = !P.style.warehouse && !P.style.office && !P.style.shop && !P.style.mall && !P.style.church && !P.style.pub;
    if (home && o.bot > 0.75 && len > 0.7) {
      const rw = Math.min(len, 1.4), rc = P.style.trap ? 0xe6e0cf : 0xf6f6f2;
      gb.box('plain', fr, -rw / 2, rw / 2, 0.04, 0.11, 0.15, Math.min(o.bot - 0.1, 0.72), rc);
      for (let u = -rw / 2 + 0.05; u < rw / 2; u += 0.06) gb.box('plain', fr, u, u + 0.012, 0.11, 0.115, 0.17, Math.min(o.bot - 0.12, 0.7), shadeK(rc, 0.82));
      gb.box('plain', fr, rw / 2 - 0.02, rw / 2 + 0.04, 0.05, 0.1, 0.1, 0.2, 0xd8d8d4);
    }
    // curtains or blinds in homes
    if (!P.style.warehouse && !P.style.office && !P.style.shop && !P.style.mall && !P.style.church && r.kind !== 'bath' && o.cover !== 'boards') {
      const cc = P.style.trap ? 0x5a4f45 : [0x8f6f5f, 0x5f6f8f, 0xd8cfc0, 0x6f8f6f, 0xb3936a][(Math.abs(Math.round(mid * 7)) + r.name.length) % 5];
      gb.box('plain', fr, -len / 2 - 0.15, len / 2 + 0.15, 0.03, 0.05, o.top + 0.05, o.top + 0.09, 0x8a8a88);
      const closed = P.style.trap;
      // each curtain in pleats: narrow folds, alternately forward and back, lighter and darker
      for (const sgn of [-1, 1]) {
        const u0 = sgn < 0 ? -len / 2 - 0.25 : (closed ? 0 : len / 2 - 0.05), u1 = sgn < 0 ? (closed ? 0 : -len / 2 + 0.05) : len / 2 + 0.25;
        const n = Math.max(2, Math.round((u1 - u0) / 0.11));
        for (let q = 0; q < n; q++) { const a = u0 + (u1 - u0) * q / n, b = u0 + (u1 - u0) * (q + 1) / n, fwd = q % 2 ? 0.02 : 0; gb.box('plain', fr, a, b, 0.06 + fwd, 0.1 + fwd, Math.max(0, o.bot - 0.12), o.top + 0.07, shadeK(cc, q % 2 ? 1.06 : 0.9)); }
      }
    }
    return;
  }
  if (o.kind === 'front') {
    if (side !== s.sides[0]) return;
    const dc = P.style.trap ? 0xe9e6dc : P.style.office || P.style.mall || P.style.shop ? null : [0x2e3d55, 0x7d1f2a, 0x3a5a3a, 0x2c2c2c, 0xe9e6dc][P.site.id % 5];
    if (dc == null) { // glass doors
      gb.box('plain', fr, -len / 2, len / 2, -0.08, -0.04, hgt - 0.08, hgt, 0x3b3b3b);
      gb.box('plain', fr, -0.03, 0.03, -0.08, -0.04, 0, hgt, 0x3b3b3b);
      gb.quad('glass', wp(horiz, c, side, side > 0 === horiz ? o.a : o.b, H, -0.06), horiz ? [(side > 0 ? 1 : -1) * len, 0, 0] : [0, 0, (side > 0 ? -1 : 1) * len], [0, hgt, 0], 0xffffff);
      return;
    }
    gb.box('plain', fr, -len / 2, len / 2, -0.1, -0.05, 0, hgt, dc);
    gb.box('plain', fr, len / 2 - 0.16, len / 2 - 0.1, -0.05, 0.0, 1.0, 1.04, 0xc9b26a);         // handle
    gb.box('plain', fr, -0.18, 0.18, -0.05, -0.03, 1.45, 1.5, 0xc9b26a);                              // letterbox
    if (!P.style.trap) gb.quad('frosted', wp(horiz, c, side, side > 0 === horiz ? mid - 0.15 : mid + 0.15, H + 1.6, -0.045), horiz ? [(side > 0 ? 0.3 : -0.3), 0, 0] : [0, 0, (side > 0 ? -0.3 : 0.3)], [0, 0.3, 0], 0xffffff);
    // architrave
    arch(gb, fr, len, hgt, 0xf6f5f0);
    return;
  }
  if (o.kind === 'door') {
    arch(gb, fr, len, hgt, P.style.trap ? 0xe2dccd : 0xf6f5f0);
    // the leaf, open against the wall on the room side it opens into (the second room)
    if (side === s.sides[1] && o.leaf === 'open') {
      const lc = P.style.office ? 0xd8c29a : P.style.trap ? 0xd8d2c2 : [0xf4f4f2, 0xc8a27a, 0xf4f4f2, 0x9a7a58][P.site.id % 4];
      const f2 = { ...fr }; const c2 = Math.cos(fr.rot), s2 = Math.sin(fr.rot);
      // hinge at the a end; the leaf lies along +v
      const hx = fr.x + (-len / 2) * c2, hy = fr.y + (-len / 2) * s2;
      f2.x = hx; f2.y = hy;
      gb.box('plain', f2, 0.0, 0.04, 0.05, 0.05 + len - 0.04, 0, hgt - 0.02, lc);
      gb.box('plain', f2, -0.03, 0.0, 0.05 + len - 0.16, 0.05 + len - 0.1, 0.98, 1.03, 0xb8b8b4);
    }
    return;
  }
  if (o.kind === 'shopfront') {
    if (side !== s.sides[0]) return;
    // glass either side of the doorway along the whole wall up to the doorway's height, a sign above
    const sg = signAtlas(MALL_NAMES);
    const room = s.rooms.find(q => q.shopName);
    const L0 = s.a, L1 = s.b;
    const gp = (p0, p1) => { if (p1 - p0 < 0.05) return; gb.quad('glass', wp(horiz, c, side, side > 0 === horiz ? p0 : p1, H, 0), horiz ? [(side > 0 ? 1 : -1) * (p1 - p0), 0, 0] : [0, 0, (side > 0 ? -1 : 1) * (p1 - p0)], [0, o.top, 0], 0xffffff); };
    void gp; void L0; void L1;
    if (room) {
      const row = sg.index.get(room.shopName) ?? 0, v0 = 1 - (row + 1) / sg.rows, v1 = 1 - row / sg.rows;
      const sw = Math.min(len + 2, 7);
      const p = wp(horiz, c, side, side > 0 === horiz ? mid - sw / 2 : mid + sw / 2, H + o.top + 0.25, 0.04);
      gb.box('plain', fr, -sw / 2 - 0.1, sw / 2 + 0.1, 0.0, 0.06, o.top + 0.15, o.top + 1.05, room.brand);
      gb.quad('sign', p, horiz ? [(side > 0 ? sw : -sw), 0, 0] : [0, 0, (side > 0 ? -sw : sw)], [0, 0.7, 0], 0xffffff, { uv: [[0, v0], [1, v0], [1, v1], [0, v1]], flat: 1.35 });
    }
  }
}
const MALL_NAMES = ['Fashion House', 'Step Shoes', 'TechZone', 'Bean & Leaf', 'Bookends', 'Toy Town', 'Glow Beauty', 'Sports Hub', 'Gold & Co', 'Phone Point',
  'Card Corner', 'Burger Bar', 'Little Ones', 'Home Store', 'Specs', 'Denim Co', 'Sweet Spot', 'Game Zone', 'Outdoor Gear', 'Watch World'];
function arch(gb, fr, len, hgt, col) {
  gb.box('plain', fr, -len / 2 - 0.07, -len / 2, 0.0, 0.02, 0, hgt + 0.07, col);
  gb.box('plain', fr, len / 2, len / 2 + 0.07, 0.0, 0.02, 0, hgt + 0.07, col);
  gb.box('plain', fr, -len / 2 - 0.07, len / 2 + 0.07, 0.0, 0.02, hgt, hgt + 0.07, col);
}
// ceiling lights: a pendant or flush light per room; strip lights in offices, shops and warehouses; skylights in the mall
function lights(gb, r, lv, top, style) {
  const [cx, cy] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  const f = { x: cx, y: cy, rot: 0, h: 0 };
  if (r.kind === 'warehouse' || r.kind === 'office' || r.kind === 'shop' || r.kind === 'unit') {
    const sx = r.kind === 'warehouse' ? 6 : 3, sy = r.kind === 'warehouse' ? 8 : 2.4;
    for (let x = r.x0 + sx / 2; x < r.x1; x += sx) for (let y = r.y0 + sy / 2; y < r.y1; y += sy) gb.box('glow', { x, y, rot: 0, h: 0 }, -0.6, 0.6, -0.1, 0.1, top - 0.06, top - 0.01, 0xfffbf0, { flat: 1.4 });
    return;
  }
  if (r.kind === 'mall') { if (r.name === 'concourse') for (let x = r.x0 + 4; x < r.x1 - 2; x += 8) gb.box('glow', { x, y: cy, rot: 0, h: 0 }, -3.4, 3.4, -2.2, 2.2, top - 0.05, top - 0.01, 0xf4fbff, { flat: 1.45, skip: 't' }); return; }
  if (r.kind === 'church') { for (let y = r.y0 + 3; y < r.y1 - 2; y += 4.5) { gb.cyl('glow', { x: cx, y, rot: 0, h: 0 }, 0, 0, 0.35, top - 2.2, top - 1.9, 0xfff1cc, 8, { flat: 1.4 }); gb.box('plain', { x: cx, y, rot: 0, h: 0 }, -0.01, 0.01, -0.01, 0.01, top - 1.9, top, 0x3a3a3a); } return; }
  if (r.x1 - r.x0 < 0.9 || r.y1 - r.y0 < 0.9) return;
  if (style.trap) { gb.box('plain', f, -0.01, 0.01, -0.01, 0.01, top - 0.35, top, 0x3a3a3a); gb.cyl('glow', f, 0, 0, 0.05, top - 0.45, top - 0.35, 0xfff3d0, 6, { flat: 1.5 }); return; }
  if (r.name === 'bath' || /landing|hall|corridor/.test(r.name)) { gb.cyl('glow', f, 0, 0, 0.16, top - 0.06, top - 0.01, 0xfffbf0, 10, { flat: 1.35 }); return; }
  // a pendant with a shade
  gb.box('plain', f, -0.008, 0.008, -0.008, 0.008, top - 0.55, top, 0x3a3a3a);
  gb.cyl('plain', f, 0, 0, 0.22, top - 0.78, top - 0.55, style.nice ? 0x2b2b2b : 0xe9e1d0, 10, { open: true });
  gb.cyl('glow', f, 0, 0, 0.07, top - 0.74, top - 0.62, 0xfff3d0, 6, { flat: 1.6 });
}
// a banister (or the guard rail round the stairwell upstairs): posts, a rail, balusters
function rail(gb, rl, H, hgt, style) {
  const col = style.office || style.mall ? 0xb9bcbf : style.trap ? 0xd8d2c2 : 0xf3f2ee, wood = style.office || style.mall ? 0x8a8d90 : 0x8a6a4a;
  const along = rl.o === 'v';
  const L = rl.b - rl.a;
  const f = along ? { x: rl.c, y: (rl.a + rl.b) / 2, rot: Math.PI / 2, h: H } : { x: (rl.a + rl.b) / 2, y: rl.c, rot: 0, h: H };
  gb.box('plain', f, -L / 2, L / 2, -0.035, 0.035, hgt - 0.06, hgt, wood);
  for (let k = 0; k <= Math.floor(L / 0.12); k++) { const u = -L / 2 + k * L / Math.max(1, Math.floor(L / 0.12)); gb.box('plain', f, u - 0.015, u + 0.015, -0.015, 0.015, 0, hgt - 0.06, col); }
  gb.box('plain', f, -L / 2 - 0.05, -L / 2 + 0.05, -0.05, 0.05, 0, hgt + 0.1, wood); gb.box('plain', f, L / 2 - 0.05, L / 2 + 0.05, -0.05, 0.05, 0, hgt + 0.1, wood);
}
// the flight: a block per step (treads and risers), the open side's panel under it, a sloping banister
function stairs(gb, P, st) {
  const lv = P.levels[st.lv], H = lv.h, n = st.n, along = st.dir === 'y';
  const [a0, a1] = along ? [st.y0, st.y1] : [st.x0, st.x1], [b0, b1] = along ? [st.x0, st.x1] : [st.y0, st.y1];
  const g = (a1 - a0) / n, rise = st.rise / n;
  const room = lv.rooms.find(q => (st.x0 + st.x1) / 2 >= q.x0 && (st.x0 + st.x1) / 2 <= q.x1 && (st.y0 + st.y1) / 2 >= q.y0 && (st.y0 + st.y1) / 2 <= q.y1) || lv.rooms[0];
  gb.ctx = lightOf(room, H, P.style.trap ? 0.8 : 1);
  const tread = P.style.office || P.style.mall ? 'tile' : typeof st.col === 'number' && st.col > 0x900000 && st.col < 0xc00000 ? 'wood' : 'carpet';
  const side = room.wall;
  for (let i = 0; i < n; i++) {
    const k = st.up > 0 ? i : n - 1 - i;
    const s0 = a0 + k * g, s1 = s0 + g, h1 = (i + 1) * rise;
    const f = along ? { x: (b0 + b1) / 2, y: (s0 + s1) / 2, rot: st.up > 0 ? 0 : Math.PI, h: H } : { x: (s0 + s1) / 2, y: (b0 + b1) / 2, rot: st.up > 0 ? -Math.PI / 2 : Math.PI / 2, h: H };
    const w = b1 - b0;
    gb.box(tread, f, -w / 2, w / 2, -g / 2, g / 2, Math.max(0, h1 - rise), h1, st.col || 0x8a6a4a, { skip: 'd' });
    // the panel underneath (the side of the flight), as wall
    gb.box(side[0] || 'plaster', f, -w / 2, w / 2, -g / 2, g / 2, 0, Math.max(0.001, h1 - rise), side[1], { skip: 'dtfb' });
    // nosing
    gb.box('plain', f, -w / 2, w / 2, g / 2 - 0.02, g / 2 + 0.015, h1 - 0.03, h1, 0x7a5a3a);
  }
  // the sloping banister on the open side
  const c = st.side === 'x0' ? st.x0 : st.side === 'x1' ? st.x1 : st.side === 'y0' ? st.y0 : st.y1;
  const col = P.style.office || P.style.mall ? 0x8a8d90 : 0x8a6a4a, bal = P.style.office || P.style.mall ? 0xb9bcbf : 0xf3f2ee;
  const pt = (a, h) => along ? [c, H + h, a] : [a, H + h, c];
  const hAt = a => (st.up > 0 ? (a - a0) / (a1 - a0) : (a1 - a) / (a1 - a0)) * st.rise;
  // the handrail and the string under the balusters, each one sloping beam
  gb.beam('plain', pt(a0, hAt(a0) + 0.92), pt(a1, hAt(a1) + 0.92), 0.06, 0.06, col);
  gb.beam('plain', pt(a0, hAt(a0) + 0.12), pt(a1, hAt(a1) + 0.12), 0.05, 0.14, col);
  for (let i = 0; i < n * 2; i++) { const a = a0 + (i + 0.5) * (a1 - a0) / (n * 2), h = hAt(a); gb.beam('plain', pt(a, h + 0.18), pt(a, h + 0.89), 0.025, 0.025, bal); }
  // newel posts at the foot and the head
  for (const a of [a0 + 0.04, a1 - 0.04]) gb.beam('plain', pt(a, hAt(a) > st.rise / 2 ? st.rise - 0.2 : 0), pt(a, (hAt(a) > st.rise / 2 ? st.rise : 0) + 1.05), 0.09, 0.09, col);
}

// ------------------------------------------------------------------ furniture
const shadeK = (col, k) => { C.set(col); return new THREE.Color(Math.min(1, C.r * k), Math.min(1, C.g * k), Math.min(1, C.b * k)).getHex(); };
const legs = (gb, f, w, d, h, col, inset = 0.05, r = 0.025) => { for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) gb.box('plain', f, u * (w / 2 - inset) - r, u * (w / 2 - inset) + r, v * (d / 2 - inset) - r, v * (d / 2 - inset) + r, 0, h, col); };
function chairsRound(gb, f, w, d, n, col) {
  const pos = [];
  if (n >= 2) pos.push([0, -d / 2 - 0.32, 0], [0, d / 2 + 0.32, Math.PI]);
  if (n >= 4) { pos.length = 0; for (const u of n >= 6 ? [-w / 3, w / 3, 0] : [-w / 4, w / 4]) pos.push([u, -d / 2 - 0.32, 0], [u, d / 2 + 0.32, Math.PI]); }
  if (n >= 8) pos.push([-w / 2 - 0.35, 0, -Math.PI / 2], [w / 2 + 0.35, 0, Math.PI / 2]);
  for (const [u, v, r] of pos.slice(0, n)) {
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const cf = { x: f.x + u * c - v * s, y: f.y + u * s + v * c, rot: f.rot + r, h: f.h };
    gb.box('plain', cf, -0.22, 0.22, -0.22, 0.22, 0.43, 0.48, col); legs(gb, cf, 0.44, 0.44, 0.43, shadeK(col, 0.7), 0.04, 0.02);
    gb.box('plain', cf, -0.22, 0.22, -0.24, -0.2, 0.48, 0.9, col);
  }
}
const ITEM = {
  box: (gb, it, f) => gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col ?? 0xb08a5a),
  tvunit: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.05, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.03, it.d / 2 - 0.03, 0, 0.05, 0x222222); },
  tv: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2, it.w / 2, -0.03, 0.03, 0.1, 0.1 + it.h, 0x161616);
    gb.box('glow', f, -it.w / 2 + 0.025, it.w / 2 - 0.025, 0.031, 0.034, 0.125, 0.075 + it.h, 0x29425e, { flat: 0.9 });
    gb.box('plain', f, -0.15, 0.15, -0.1, 0.1, 0, 0.1, 0x161616);
  },
  sofa: (gb, it, f) => {
    const w = it.w, d = it.d, col = it.col;
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2, 0.08, 0.42, col);                     // base
    gb.box('plain', f, -w / 2, w / 2, -d / 2, -d / 2 + 0.22, 0.42, it.h, shadeK(col, 0.92)); // back
    gb.box('plain', f, -w / 2, -w / 2 + 0.18, -d / 2, d / 2, 0.42, 0.62, shadeK(col, 0.95)); gb.box('plain', f, w / 2 - 0.18, w / 2, -d / 2, d / 2, 0.42, 0.62, shadeK(col, 0.95));
    const nc = Math.max(2, Math.round((w - 0.36) / 0.7));
    for (let k = 0; k < nc; k++) { const u0 = -w / 2 + 0.18 + k * (w - 0.36) / nc; gb.box('plain', f, u0 + 0.01, u0 + (w - 0.36) / nc - 0.01, -d / 2 + 0.22, d / 2 - 0.02, 0.42, 0.52, shadeK(col, 1.05)); }
    if (it.worn) gb.box('plain', f, -0.3, 0.1, 0.0, 0.25, 0.521, 0.525, 0x2a2520);
    legs(gb, f, w, d, 0.08, 0x2a2a2a, 0.06, 0.02);
  },
  sofaL: (gb, it, f) => { ITEM.sofa(gb, { ...it }, f); const c = Math.cos(f.rot), s = Math.sin(f.rot); const u = it.w / 2 - 0.45, v = it.d / 2 + 0.55; ITEM.sofa(gb, { ...it, w: 1.1, d: 0.9 }, { ...f, x: f.x + u * c - v * s, y: f.y + u * s + v * c, rot: f.rot + Math.PI / 2 }); },
  armchair: (gb, it, f) => ITEM.sofa(gb, { ...it, w: 0.9 }, f),
  coffeetable: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.04, it.h, it.col); legs(gb, f, it.w, it.d, it.h - 0.04, shadeK(it.col, 0.8));
    if (it.clutter === 'trap') { gb.box('plain', f, -0.3, -0.1, -0.1, 0.1, it.h, it.h + 0.03, 0x2a2a2a); gb.box('glow', f, -0.27, -0.13, -0.07, 0.07, it.h + 0.03, it.h + 0.032, 0x5aff7a, { flat: 0.8 }); for (let k = 0; k < 5; k++) gb.cyl('plain', f, 0.1 + k * 0.07, (k % 2) * 0.12 - 0.05, 0.033, it.h, it.h + 0.12, [0xc0392b, 0x2f6fb0, 0xe0e0e0, 0x27ae60, 0xf1c40f][k], 6); gb.box('plain', f, -0.05, 0.05, 0.1, 0.18, it.h, it.h + 0.02, 0x7fae5a); }
    if (it.clutter === 'books') { gb.box('plain', f, -0.25, 0.05, -0.12, 0.12, it.h, it.h + 0.05, 0x7a2f2f); gb.box('plain', f, -0.22, 0.02, -0.1, 0.1, it.h + 0.05, it.h + 0.09, 0x2f4a7a); }
  },
  rug: (gb, it, f) => { gb.box('carpet', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.003, 0.012, it.col, { skip: 'd' }); if (it.stained) gb.box('plain', f, -0.3, 0.2, -0.2, 0.25, 0.0125, 0.013, 0x3a3226, { skip: 'd' }); },
  plant: (gb, it, f) => { gb.cyl('plain', f, 0, 0, 0.18, 0, 0.32, 0xb8643a, 8); for (let k = 0; k < 5; k++) { const a = k * 1.3; gb.box('plain', f, Math.cos(a) * 0.12 - 0.12, Math.cos(a) * 0.12 + 0.12, Math.sin(a) * 0.12 - 0.12, Math.sin(a) * 0.12 + 0.12, 0.3 + k * 0.12, 0.55 + k * 0.14, [0x3f6b35, 0x4f7f3f, 0x2f5a2a][k % 3]); } },
  lamp: (gb, it, f) => { gb.cyl('plain', f, 0, 0, 0.14, 0, 0.03, 0x2a2a2a); gb.box('plain', f, -0.012, 0.012, -0.012, 0.012, 0.03, it.h - 0.3, 0x2a2a2a); gb.cyl('glow', f, 0, 0, 0.2, it.h - 0.32, it.h, 0xfff0d0, 10, { flat: 1.3 }); },
  shelves: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col, { skip: 'f' }); gb.quad('books', [f.x - Math.cos(f.rot) * (it.w / 2 - 0.03) - Math.sin(f.rot) * (it.d / 2 - 0.01), f.h + 0.05, f.y - Math.sin(f.rot) * (it.w / 2 - 0.03) + Math.cos(f.rot) * (it.d / 2 - 0.01)], [Math.cos(f.rot) * (it.w - 0.06), 0, Math.sin(f.rot) * (it.w - 0.06)], [0, it.h - 0.1, 0], 0xffffff, { uv: [[0, 0], [it.w, 0], [it.w, 1], [0, 1]] }); },
  binbags: (gb, it, f) => { for (let k = 0; k < 3; k++) { const u = (k - 1) * it.w * 0.3; gb.cyl('plain', f, u, (k % 2) * 0.1 - 0.05, 0.22, 0, 0.45 - k * 0.05, 0x1c1c1c, 7); } },
  cans: (gb, it, f) => { for (let k = 0; k < 7; k++) gb.cyl('plain', f, (k % 4) * 0.12 - 0.18, Math.floor(k / 4) * 0.15 - 0.08, 0.033, 0, 0.12, [0xc0392b, 0x2f6fb0, 0xe0e0e0, 0x27ae60][k % 4], 6); },
  cctv: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.75, 0x3a3a3a); gb.box('plain', f, -0.22, 0.22, -0.05, 0.05, 0.75, 1.05, 0x161616); gb.box('glow', f, -0.2, 0.2, 0.051, 0.055, 0.77, 1.03, 0x6a8a6a, { flat: 0.8 }); },
  units: (gb, it, f) => {
    const w = it.w, d = it.d, top = it.top ?? 0x3b3b3b;
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2 - 0.02, 0.1, it.h - 0.04, it.col);
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2 - 0.06, 0, 0.1, 0x2a2a2a);
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2 + 0.02, it.h - 0.04, it.h, top);
    for (let u = -w / 2 + 0.6; u < w / 2 - 0.05; u += 0.6) gb.box('plain', f, u - 0.004, u + 0.004, d / 2 - 0.021, d / 2 - 0.018, 0.12, it.h - 0.06, shadeK(it.col, 0.7));
    for (let u = -w / 2 + 0.3; u < w / 2; u += 0.6) gb.box('plain', f, u - 0.08, u + 0.08, d / 2 - 0.018, d / 2, it.h - 0.15, it.h - 0.13, 0x9a9a98);
    if (!it.island) gb.box('tile', f, -w / 2, w / 2, -d / 2 - 0.005, -d / 2 + 0.008, it.h, it.h + 0.5, it.splash ?? 0xf2f1ec, { skip: 'bd' });
    if (it.sink) { gb.box('plain', f, -0.3, 0.3, -0.2, 0.2, it.h - 0.001, it.h + 0.003, 0xb9bcbf); gb.box('plain', f, -0.25, 0.25, -0.16, 0.16, it.h + 0.003, it.h + 0.004, 0x55585c); gb.box('plain', f, -0.02, 0.02, -0.22, -0.18, it.h, it.h + 0.3, 0xb9bcbf); }
    const hob = w > 1.8 ? w / 2 - 0.45 : null;
    if (hob != null) { gb.box('plain', f, hob - 0.3, hob + 0.3, -0.25, 0.25, it.h, it.h + 0.01, 0x161616); for (const [a, b] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) gb.cyl('plain', f, hob + a, b, 0.07, it.h + 0.01, it.h + 0.012, 0x3a3a3a, 8); gb.box('plain', f, hob - 0.3, hob + 0.3, d / 2 - 0.022, d / 2 - 0.018, 0.2, 0.8, 0x161616); }
  },
  wallunits: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); for (let u = -it.w / 2 + 0.5; u < it.w / 2; u += 0.5) gb.box('plain', f, u - 0.004, u + 0.004, it.d / 2, it.d / 2 + 0.003, 0.02, it.h - 0.02, shadeK(it.col, 0.7)); },
  fridge: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, it.d / 2, it.d / 2 + 0.004, 1.05, 1.06, shadeK(it.col, 0.6)); gb.box('plain', f, it.w / 2 - 0.08, it.w / 2 - 0.05, it.d / 2, it.d / 2 + 0.03, 1.15, 1.5, 0x9a9a98); },
  island: (gb, it, f) => { ITEM.units(gb, { ...it, d: it.d, island: true }, f); for (const sgn of [-0.6, 0, 0.6]) { const sf = { ...f, x: f.x + Math.cos(f.rot) * sgn - Math.sin(f.rot) * (it.d / 2 + 0.35), y: f.y + Math.sin(f.rot) * sgn + Math.cos(f.rot) * (it.d / 2 + 0.35) }; gb.cyl('plain', sf, 0, 0, 0.18, 0.62, 0.68, 0x2b2b2b, 8); gb.box('plain', sf, -0.02, 0.02, -0.02, 0.02, 0, 0.62, 0x9a9a98); } },
  table: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.04, it.h, it.col); legs(gb, f, it.w, it.d, it.h - 0.04, shadeK(it.col, 0.85), 0.06, 0.03);
    chairsRound(gb, f, it.w, it.d, it.chairs || 0, it.chairCol || 0x3b3b3b);
    if (it.clutter === 'scales') { gb.box('plain', f, -0.25, -0.05, -0.1, 0.1, it.h, it.h + 0.03, 0xb9bcbf); gb.box('glow', f, -0.2, -0.1, -0.09, -0.05, it.h + 0.03, it.h + 0.032, 0x7aff9a, { flat: 0.9 }); for (let k = 0; k < 6; k++) gb.box('plain', f, 0.05 + (k % 3) * 0.12, 0.13 + (k % 3) * 0.12, -0.15 + Math.floor(k / 3) * 0.15, -0.07 + Math.floor(k / 3) * 0.15, it.h, it.h + 0.04, 0x7fae5a); gb.box('plain', f, -0.45, -0.3, 0.05, 0.25, it.h, it.h + 0.05, 0xd9d9d9); }
    if (it.clutter === 'fruit') { gb.cyl('plain', f, 0, 0, 0.16, it.h, it.h + 0.06, 0xe9e4da, 10); for (let k = 0; k < 4; k++) gb.cyl('plain', f, Math.cos(k * 1.6) * 0.07, Math.sin(k * 1.6) * 0.07, 0.04, it.h + 0.06, it.h + 0.12, [0xd84a3a, 0xf1c40f, 0x7fae3a, 0xe67e22][k], 6); }
  },
  pizzaboxes: (gb, it, f) => { for (let k = 0; k < 4; k++) gb.box('plain', f, -0.2 + k * 0.02, 0.2 + k * 0.02, -0.2 - k * 0.015, 0.2 - k * 0.015, k * 0.045, k * 0.045 + 0.04, 0xc8a26a); },
  doormat: (gb, it, f) => gb.box('carpet', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.012, it.col, { skip: 'd' }),
  post: (gb, it, f) => { for (let k = 0; k < 9; k++) gb.box('plain', f, -0.25 + (k % 3) * 0.15, -0.1 + (k % 3) * 0.15, -0.15 + Math.floor(k / 3) * 0.1, -0.03 + Math.floor(k / 3) * 0.1, k * 0.003, k * 0.003 + 0.003, [0xf4f4f2, 0xe8dcc0, 0xd8e0e8][k % 3]); },
  console: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.04, it.h, 0x8a6a4a); legs(gb, f, it.w, it.d, it.h - 0.04, 0x6a4a2a); gb.box('plain', f, -0.3, 0.3, -it.d / 2 - 0.005, -it.d / 2 + 0.01, 1.2, 1.8, 0x8a7a5a); gb.box('glow', f, -0.27, 0.27, -it.d / 2 + 0.01, -it.d / 2 + 0.012, 1.23, 1.77, 0xb9c9d2, { flat: 0.95 }); },
  mattress: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0xd9d2bf); gb.box('plain', f, -it.w / 2 + 0.05, it.w / 2 - 0.1, -it.d / 2 + 0.5, it.d / 2 - 0.1, it.h, it.h + 0.06, it.col); gb.box('plain', f, -0.4, 0.4, -it.d / 2 + 0.08, -it.d / 2 + 0.42, it.h, it.h + 0.1, 0xe9e4da); },
  bed1: (gb, it, f) => ITEM.bed2(gb, it, f),
  bed2: (gb, it, f) => {
    const w = it.w, d = it.d, fc = it.frame ?? 0x8a6a4a;
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2, 0.08, 0.32, fc); legs(gb, f, w, d, 0.08, shadeK(fc, 0.8), 0.04, 0.03);
    gb.box('plain', f, -w / 2, w / 2, -d / 2, -d / 2 + 0.06, 0, 1.05, shadeK(fc, 0.95));
    gb.box('plain', f, -w / 2 + 0.03, w / 2 - 0.03, -d / 2 + 0.06, d / 2 - 0.03, 0.32, 0.5, 0xf4f2ec);
    gb.box('plain', f, -w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.6, d / 2 - 0.01, 0.5, 0.56, it.col);
    gb.box('plain', f, -w / 2 + 0.01, w / 2 - 0.01, d / 2 - 0.015, d / 2 + 0.005, 0.3, 0.56, it.col);
    const np = w > 1.2 ? 2 : 1;
    for (let k = 0; k < np; k++) { const u = np === 2 ? (k ? 0.38 : -0.38) * w / 1.5 : 0; gb.box('plain', f, u - 0.3, u + 0.3, -d / 2 + 0.12, -d / 2 + 0.5, 0.5, 0.64, 0xffffff); }
  },
  bedside: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col ?? 0x8a6a4a); gb.cyl('plain', f, 0, 0, 0.07, it.h, it.h + 0.25, 0xe9e1d0, 6); gb.cyl('glow', f, 0, 0, 0.1, it.h + 0.25, it.h + 0.42, 0xfff0d0, 8, { flat: 1.2 }); },
  wardrobe: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -0.003, 0.003, it.d / 2, it.d / 2 + 0.003, 0.05, it.h - 0.05, shadeK(it.col, 0.6)); for (const u of [-0.06, 0.06]) gb.box('plain', f, u - 0.01, u + 0.01, it.d / 2, it.d / 2 + 0.03, 0.9, 1.2, 0x9a9a98); },
  drawers: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); for (let k = 1; k < 4; k++) gb.box('plain', f, -it.w / 2 + 0.02, it.w / 2 - 0.02, it.d / 2, it.d / 2 + 0.003, k * it.h / 4 - 0.005, k * it.h / 4 + 0.005, shadeK(it.col, 0.6)); },
  clothes: (gb, it, f) => { for (let k = 0; k < 6; k++) gb.box('plain', f, -0.4 + k * 0.13, -0.15 + k * 0.13, -0.25 + (k % 2) * 0.1, 0.1 + (k % 2) * 0.1, k * 0.03, k * 0.03 + 0.05, [0x2c3e50, 0x7f8c8d, 0x8e2b2b, 0x1c1c1c, 0x34495e, 0x95a5a6][k]); },
  growtent: (gb, it, f) => {
    const w = it.w, d = it.d, h = it.h;
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2, 0, h, 0x1c1c1c, { skip: 'f' });
    // the front flap rolled up: you see the plants under the light
    gb.box('plain', f, -w / 2, w / 2, d / 2 - 0.02, d / 2, h - 0.3, h, 0x1c1c1c);
    gb.box('glow', f, -w / 2 + 0.1, w / 2 - 0.1, -d / 2 + 0.1, d / 2 - 0.1, h - 0.38, h - 0.34, 0xffd9ff, { flat: 1.6 });
    gb.box('plain', f, -w / 2 + 0.02, w / 2 - 0.02, -d / 2 + 0.02, d / 2 - 0.02, 0, 0.01, 0xc9c9c9);
    for (let k = 0; k < 4; k++) { const u = ((k % 2) - 0.5) * w * 0.45, v = (Math.floor(k / 2) - 0.5) * d * 0.45; gb.box('plain', f, u - 0.14, u + 0.14, v - 0.14, v + 0.14, 0, 0.26, 0x2a2a2a); for (let q = 0; q < 4; q++) gb.box('plain', f, u - 0.18 + q * 0.03, u + 0.18 - q * 0.03, v - 0.18 + q * 0.03, v + 0.18 - q * 0.03, 0.26 + q * 0.18, 0.44 + q * 0.18, [0x4f8f3f, 0x3f7f35, 0x5a9a45, 0x3a6b30][q]); }
  },
  bath: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.08, it.w / 2 - 0.08, -it.d / 2 + 0.08, it.d / 2 - 0.08, it.h - 0.002, it.h + 0.001, it.dirty ? 0xc9bfa0 : 0xdfe8ea); gb.box('plain', f, it.w / 2 - 0.2, it.w / 2 - 0.15, -it.d / 2, -it.d / 2 + 0.06, it.h, it.h + 0.25, 0xb9bcbf); gb.box('glass', f, -it.w / 2 + 0.6, -it.w / 2 + 0.62, -it.d / 2, it.d / 2, it.h, it.h + 1.4, 0xffffff); },
  freebath: (gb, it, f) => { gb.cyl('plain', f, 0, 0, Math.min(it.w, it.d) * 0.48, 0, it.h, 0xf7f7f4, 12); gb.cyl('plain', f, 0, 0, Math.min(it.w, it.d) * 0.4, it.h - 0.002, it.h + 0.001, 0xdfe8ea, 12); },
  toilet: (gb, it, f) => { gb.box('plain', f, -0.19, 0.19, -it.d / 2, -it.d / 2 + 0.18, 0.4, 0.8, it.col); gb.box('plain', f, -0.16, 0.16, -it.d / 2 + 0.18, it.d / 2, 0, 0.4, it.col); gb.box('plain', f, -0.18, 0.18, -it.d / 2 + 0.2, it.d / 2 + 0.02, 0.4, 0.43, 0xf2f2ee); },
  basin: (gb, it, f) => { gb.box('plain', f, -0.04, 0.04, -it.d / 2, -it.d / 2 + 0.08, 0, it.h - 0.15, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.15, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.08, it.d / 2 - 0.04, it.h - 0.001, it.h + 0.001, 0xdfe8ea); if (it.mirror) { gb.box('plain', f, -0.3, 0.3, -it.d / 2 - 0.02, -it.d / 2 + 0.01, it.h + 0.25, it.h + 0.95, 0xc9c9c9); gb.box('glow', f, -0.27, 0.27, -it.d / 2 + 0.01, -it.d / 2 + 0.013, it.h + 0.28, it.h + 0.92, 0xc9d9e2, { flat: 0.95 }); } },
  picture: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col ?? 0x2a2a2a); gb.quad('art', [f.x - Math.cos(f.rot) * (it.w / 2 - 0.05) - Math.sin(f.rot) * (it.d / 2 + 0.002), f.h + 0.05, f.y - Math.sin(f.rot) * (it.w / 2 - 0.05) + Math.cos(f.rot) * (it.d / 2 + 0.002)], [Math.cos(f.rot) * (it.w - 0.1), 0, Math.sin(f.rot) * (it.w - 0.1)], [0, it.h - 0.1, 0], 0xffffff, { uv: (() => { const k = (it.seed || 0) % 16, u0 = (k % 4) / 4, v0 = Math.floor(k / 4) / 4; return [[u0, v0], [u0 + 0.25, v0], [u0 + 0.25, v0 + 0.25], [u0, v0 + 0.25]]; })() }); },
  // ------------------------------------------------ fast food
  foodcounter: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h - 0.05, it.col);
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2 - 0.04, it.d / 2, it.h - 0.05, it.h, it.top);
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2 - 0.005, -it.d / 2, 0.0, 0.12, 0x2a2a2a);
    gb.box('glow', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, -it.d / 2 - 0.035, -it.d / 2 - 0.03, it.h - 0.09, it.h - 0.06, 0xfff1d8, { flat: 1.3 });
    // the pass behind: a heated shelf where the orders wait
    gb.box('metal', f, -it.w / 2 + 0.2, it.w / 2 - 0.2, it.d / 2 + 0.45, it.d / 2 + 0.75, 0, 1.1, 0xc9cdd2);
  },
  till: (gb, it, f) => { gb.box('plain', f, -0.18, 0.18, -0.14, 0.14, 0, 0.06, 0x2a2a2a); gb.box('plain', f, -0.02, 0.02, -0.02, 0.02, 0.06, 0.2, 0x2a2a2a); gb.box('plain', f, -0.19, 0.19, -0.03, 0.0, 0.18, 0.42, 0x1a1a1a); gb.box('glow', f, -0.17, 0.17, 0.0, 0.004, 0.2, 0.4, 0x4a8acf, { flat: 1.0 }); gb.box('plain', f, -0.08, 0.08, -0.2, -0.14, 0, 0.12, 0x2a2a2a); },
  menuboard: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2 - 0.04, it.w / 2 + 0.04, -0.03, 0.03, -0.04, it.h + 0.04, 0x1a1a1a);
    const m = menuMaterial(it.cat, it.panel, it.panels), c = Math.cos(f.rot), s = Math.sin(f.rot);
    // the face, on the board's front (+v) side, reading left to right from in front
    const p = [f.x - c * it.w / 2 - s * 0.032, f.h, f.y - s * it.w / 2 + c * 0.032];
    gb.quad(m, p, [c * it.w, 0, s * it.w], [0, it.h, 0], 0xffffff, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]], flat: 1 });
    for (const u of [-it.w * 0.35, it.w * 0.35]) gb.box('plain', f, u - 0.01, u + 0.01, -0.01, 0.01, it.h, it.h + 1.2, 0x3a3a3a);
  },
  hood: (gb, it, f) => { gb.box('metal', f, -it.w / 2 - 0.05, it.w / 2 + 0.05, -it.d / 2, it.d / 2 + 0.1, 2.05, 2.45, 0xc9cdd2); },
  grill: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xb9bcbf); gb.box('plain', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.05, it.d / 2 - 0.05, 0.9, 0.93, 0x2a2a2a); gb.box('glow', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, -it.d / 2 + 0.1, it.d / 2 - 0.1, 0.93, 0.935, 0xff7a3a, { flat: 0.7 }); ITEM.hood(gb, it, f); },
  fryer: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xb9bcbf); for (const u of [-it.w / 4, it.w / 4]) { gb.box('plain', f, u - 0.16, u + 0.16, -0.2, 0.2, 0.9, 0.91, 0xb07a2a); gb.box('metal', f, u - 0.12, u + 0.12, -0.12, 0.12, 0.95, 1.12, 0x9a9a98); } ITEM.hood(gb, it, f); },
  warmer: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xb9bcbf); gb.box('glass', f, -it.w / 2, it.w / 2, -it.d / 2 + 0.1, it.d / 2, 0.9, 1.4, 0xffffff); gb.box('glow', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.15, it.d / 2 - 0.05, 1.38, 1.4, 0xffb060, { flat: 1.3 }); for (let k = 0; k < 6; k++) gb.box('plain', f, -it.w / 2 + 0.1 + k * (it.w - 0.2) / 6, -it.w / 2 + 0.06 + (k + 1) * (it.w - 0.2) / 6, -0.15, 0.15, 0.92, 1.0, [0xe9d9a0, 0xd8a050, 0xf2f2ee][k % 3]); },
  drinks: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0x55585c); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.35, 0.9, 1.75, 0x2a2a2a); gb.box('glow', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.35, -it.d / 2 + 0.36, 1.35, 1.7, 0x7ab8e8, { flat: 1.2 }); for (let k = 0; k < 4; k++) gb.box('plain', f, -it.w / 2 + 0.12 + k * 0.22, -it.w / 2 + 0.2 + k * 0.22, -it.d / 2 + 0.35, -it.d / 2 + 0.45, 1.15, 1.3, 0x9a9a98); },
  steel: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xc9cdd2); gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.3, 1.5, 1.53, 0xc9cdd2); for (let k = 0; k < 3; k++) gb.box('plain', f, -it.w / 2 + 0.2 + k * 0.4, -it.w / 2 + 0.45 + k * 0.4, -0.15, 0.1, 0.9, 0.96, [0xe9e4da, 0xc0392b, 0x7fae3a][k]); },
  breadoven: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 1.6, 0xb9bcbf); gb.box('plain', f, -it.w / 2 + 0.08, it.w / 2 - 0.08, it.d / 2, it.d / 2 + 0.01, 0.6, 1.4, 0x161616); gb.box('glow', f, -it.w / 2 + 0.12, it.w / 2 - 0.12, it.d / 2 + 0.01, it.d / 2 + 0.012, 0.65, 1.35, 0xffa050, { flat: 0.8 }); },
  fridge2: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0x2a2a2a, { skip: 'f' }); gb.quad('products', [f.x - Math.cos(f.rot) * it.w / 2 - Math.sin(f.rot) * (it.d / 2 - 0.12), f.h + 0.1, f.y - Math.sin(f.rot) * it.w / 2 + Math.cos(f.rot) * (it.d / 2 - 0.12)], [Math.cos(f.rot) * it.w, 0, Math.sin(f.rot) * it.w], [0, it.h - 0.3, 0], 0xffffff, { uv: [[0, 0], [it.w, 0], [it.w, 1], [0, 1]], flat: 1.25 }); gb.box('glass', f, -it.w / 2, it.w / 2, it.d / 2 - 0.02, it.d / 2, 0.05, it.h - 0.1, 0xffffff); },
  breadrack: (gb, it, f) => { for (let k = 0; k < 5; k++) { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.2 + k * 0.38, 0.23 + k * 0.38, 0xb9bcbf); for (let q = 0; q < 4; q++) gb.box('plain', f, -it.w / 2 + 0.08 + q * 0.2, -it.w / 2 + 0.24 + q * 0.2, -0.2, 0.2, 0.23 + k * 0.38, 0.31 + k * 0.38, [0xd8a050, 0xc9883a, 0xe9c080][q % 3]); } for (const u of [-it.w / 2, it.w / 2 - 0.03]) gb.box('metal', f, u, u + 0.03, -it.d / 2, it.d / 2, 0, it.h, 0x9a9a98); },
  coffee: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0x55585c); gb.box('metal', f, -0.35, 0.35, -0.25, 0.2, 0.9, 1.45, 0xc9cdd2); gb.box('plain', f, -0.3, 0.3, 0.2, 0.25, 1.0, 1.1, 0x2a2a2a); },
  fryrange: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xc9cdd2); for (let k = 0; k < 3; k++) { const u = -it.w / 2 + 0.5 + k * (it.w - 1) / 2; gb.box('plain', f, u - 0.32, u + 0.32, -0.25, 0.25, 0.9, 0.91, 0xb07a2a); } gb.box('glass', f, -it.w / 2, it.w / 2, it.d / 2 - 0.05, it.d / 2, 0.9, 1.35, 0xffffff); gb.box('glow', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, it.d / 2 - 0.3, it.d / 2 - 0.1, 1.3, 1.33, 0xffb060, { flat: 1.2 }); ITEM.hood(gb, it, f); },
  doner: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0xb9bcbf); gb.box('plain', f, -0.25, 0.25, -it.d / 2, -it.d / 2 + 0.12, 0.9, 1.8, 0x3a3a3a); gb.box('glow', f, -0.22, 0.22, -it.d / 2 + 0.12, -it.d / 2 + 0.13, 0.95, 1.75, 0xff6a2a, { flat: 1.1 }); gb.cyl('plain', f, 0, 0.05, 0.16, 0.95, 1.6, 0x9a5a32, 10); gb.cyl('plain', f, 0, 0.05, 0.012, 0.9, 1.75, 0xb9bcbf, 6); },
  pizzaoven: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.7, 0x55585c); gb.box('metal', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.7, 1.45, 0xb9bcbf); gb.box('plain', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, it.d / 2, it.d / 2 + 0.01, 0.95, 1.15, 0x161616); gb.box('glow', f, -it.w / 2 + 0.15, it.w / 2 - 0.15, it.d / 2 + 0.01, it.d / 2 + 0.012, 0.98, 1.12, 0xff8a3a, { flat: 1.0 }); },
  pastrycase: (gb, it, f) => { gb.box('glass', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0xffffff); gb.box('glow', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.02, it.h, 0xfff1d8, { flat: 1.2 }); for (let row = 0; row < 2; row++) for (let k = 0; k < Math.floor(it.w / 0.18); k++) gb.box('plain', f, -it.w / 2 + 0.05 + k * 0.18, -it.w / 2 + 0.19 + k * 0.18, -0.2 + row * 0.22, -0.05 + row * 0.22, 0.02 + row * 0.18, 0.08 + row * 0.18, [0xd8a050, 0xc9883a, 0xe9c080, 0xb06a3a][(k + row) % 4]); },
  subline: (gb, it, f) => { gb.box('glass', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.02, 0.1, it.h, 0xffffff); gb.box('glass', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.02, it.h, 0xffffff); for (let k = 0; k < Math.floor(it.w / 0.2); k++) gb.box('plain', f, -it.w / 2 + 0.04 + k * 0.2, -it.w / 2 + 0.2 + k * 0.2, -0.1, 0.15, 0, 0.06, [0x7fae3a, 0xc0392b, 0xf1c40f, 0xe9e4da, 0x8e44ad, 0xe67e22][k % 6]); },
  windowbar: (gb, it, f) => { gb.box('wood', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h - 0.04, it.h, it.col); for (const u of [-it.w / 2 + 0.1, it.w / 2 - 0.15]) gb.box('plain', f, u, u + 0.05, -0.05, 0.05, 0, it.h - 0.04, 0x3a3a3a); },
  stool: (gb, it, f) => { gb.cyl('plain', f, 0, 0, 0.17, it.h - 0.05, it.h, it.col, 8); gb.box('plain', f, -0.02, 0.02, -0.02, 0.02, 0, it.h - 0.05, 0x3a3a3a); gb.cyl('plain', f, 0, 0, 0.18, 0, 0.03, 0x3a3a3a, 8); },
  binunit: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, it.d / 2, it.d / 2 + 0.01, it.h - 0.35, it.h - 0.15, 0x1a1a1a); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, it.h, it.h + 0.03, 0xb9bcbf); for (let k = 0; k < 3; k++) gb.box('plain', f, -it.w / 2 + 0.1 + k * 0.12, -it.w / 2 + 0.2 + k * 0.12, -0.1, 0.1, it.h + 0.03, it.h + 0.05 + k * 0.03, 0x7a5a3a); },
  condiments: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, 0x55585c); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.9, 0.93, it.col); for (let k = 0; k < 5; k++) gb.cyl('plain', f, -it.w / 2 + 0.15 + k * 0.18, 0, 0.04, 0.93, 1.1, [0xc0392b, 0xf1c40f, 0x7a4a2a, 0xe9e4da, 0x2f6fb0][k], 6); },
  orderkiosk: (gb, it, f) => { gb.box('plain', f, -0.06, 0.06, -0.06, 0.06, 0, 1.0, 0x3a3a3a); gb.box('plain', f, -it.w / 2, it.w / 2, -0.05, 0.05, 0.95, it.h, 0x1a1a1a); gb.box('glow', f, -it.w / 2 + 0.03, it.w / 2 - 0.03, 0.05, 0.053, 1.0, it.h - 0.05, 0xe9f0f6, { flat: 1.2 }); gb.box('plain', f, -0.2, 0.2, -0.2, 0.2, 0, 0.04, 0x3a3a3a); },
  // ------------------------------------------------ warehouse
  cabin: (gb, it, f) => {
    const w = it.w, d = it.d, h = it.h;
    gb.box('plain', f, -w / 2, w / 2, -d / 2, d / 2, h - 0.05, h, it.col);
    for (const [u0, u1, v0, v1] of [[-w / 2, w / 2, -d / 2, -d / 2 + 0.08], [-w / 2, w / 2, d / 2 - 0.08, d / 2], [-w / 2, -w / 2 + 0.08, -d / 2, d / 2], [w / 2 - 0.08, w / 2, -d / 2, d / 2]]) {
      gb.box('plain', f, u0, u1, v0, v1, 0, 1.0, it.col); gb.box('plain', f, u0, u1, v0, v1, 2.1, h, it.col);
      gb.box('glass', f, u0, u1, v0, v1, 1.0, 2.1, 0xffffff);
      gb.box('plain', f, u0, u1, v0, v1, 0.98, 1.02, it.frame); gb.box('plain', f, u0, u1, v0, v1, 2.08, 2.12, it.frame);
    }
    gb.box('plain', f, -w / 2 + 0.4, -w / 2 + 2.0, -d / 2 + 0.4, -d / 2 + 1.1, 0.72, 0.76, 0xd8c29a); legs(gb, { ...f, x: f.x + Math.cos(f.rot) * (-w / 2 + 1.2) - Math.sin(f.rot) * (-d / 2 + 0.75), y: f.y + Math.sin(f.rot) * (-w / 2 + 1.2) + Math.cos(f.rot) * (-d / 2 + 0.75) }, 1.6, 0.7, 0.72, 0x55585c);
    gb.box('plain', f, -w / 2 + 0.9, -w / 2 + 1.4, -d / 2 + 0.5, -d / 2 + 0.55, 0.76, 1.1, 0x161616);
  },
  racking: (gb, it, f) => {
    const w = it.w, d = it.d, h = it.h, beams = Math.max(2, Math.floor(h / 1.6));
    const bays = Math.max(1, Math.round(d / 2.7));
    for (let b = 0; b <= bays; b++) { const v = -d / 2 + b * d / bays; for (const u of [-w / 2, w / 2 - 0.08]) gb.box('plain', f, u, u + 0.08, v - 0.04, v + 0.04, 0, h, it.col); }
    for (let k = 1; k <= beams; k++) { const hh = k * h / (beams + 0.3); for (const u of [-w / 2, w / 2 - 0.06]) gb.box('plain', f, u, u + 0.06, -d / 2, d / 2, hh - 0.12, hh, it.col2);
      for (let b = 0; b < bays; b++) { const v0 = -d / 2 + b * d / bays + 0.15, v1 = v0 + d / bays - 0.3; const R = ((it.seed || 0) * 31 + k * 7 + b * 13) % 10;
        if (R < 7) { gb.box('plain', f, -w / 2 + 0.05, w / 2 - 0.05, v0, v1, hh, hh + 0.14, 0xc8a26a); gb.box('plain', f, -w / 2 + 0.08, w / 2 - 0.08, v0 + 0.05, v1 - 0.05, hh + 0.14, hh + 0.14 + 0.5 + (R % 3) * 0.3, [0xb08a5a, 0xc49a68, 0xd8d8d0, 0x9c7a50, 0x8fb3c8][R % 5]); } } }
  },
  forklift: (gb, it, f) => {
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2 - 0.7, 0.2, 1.1, it.col);
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.5, 1.1, 1.3, 0x2a2a2a);
    for (const u of [-it.w / 2 + 0.05, it.w / 2 - 0.1]) { gb.box('plain', f, u, u + 0.05, -it.d / 2 + 0.3, -it.d / 2 + 0.35, 1.1, 2.1, 0x2a2a2a); gb.box('plain', f, u, u + 0.05, it.d / 2 - 0.8, it.d / 2 - 0.75, 1.1, 2.1, 0x2a2a2a); }
    gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2 + 0.3, it.d / 2 - 0.75, 2.05, 2.1, 0x2a2a2a);
    gb.box('plain', f, -0.4, 0.4, it.d / 2 - 0.7, it.d / 2 - 0.6, 0, 2.6, 0x3a3a3a);
    for (const u of [-0.3, 0.2]) gb.box('plain', f, u, u + 0.1, it.d / 2 - 0.6, it.d / 2 + 0.4, 0.05, 0.12, 0x3a3a3a);
    for (const [u, v] of [[-it.w / 2, -it.d / 2 + 0.3], [it.w / 2 - 0.2, -it.d / 2 + 0.3], [-it.w / 2, it.d / 2 - 1.1], [it.w / 2 - 0.2, it.d / 2 - 1.1]]) gb.box('plain', f, u - 0.02, u + 0.22, v, v + 0.5, 0, 0.45, 0x161616);
  },
  pallet: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.14, 0xc8a26a); if (it.h > 0.2) gb.box('plain', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.05, it.d / 2 - 0.05, 0.14, it.h, 0xb08a5a); },
  rollerdoor: (gb, it, f) => { gb.box('metal', f, -it.w / 2, it.w / 2, -0.06, 0.0, 0, it.h, 0xb9bcbf); gb.box('plain', f, -it.w / 2 - 0.15, -it.w / 2, -0.06, 0.04, 0, it.h + 0.3, 0xe0a02a); gb.box('plain', f, it.w / 2, it.w / 2 + 0.15, -0.06, 0.04, 0, it.h + 0.3, 0xe0a02a); },
  floorlines: (gb, it, f) => { const W = it.w, D = it.d; for (const u of [-W / 2 + 2.0, W / 2 - 2.0]) gb.box('plain', f, u - 0.05, u + 0.05, -D / 2 + 1, D / 2 - 1, 0.002, 0.004, 0xf0c81c, { skip: 'd' }); gb.box('plain', f, -W / 2 + 2, W / 2 - 2, D / 2 - 3.2, D / 2 - 3.1, 0.002, 0.004, 0xf0c81c, { skip: 'd' }); },
  // ------------------------------------------------ office
  reception: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, it.d / 2, it.d / 2 + 0.02, 0.2, 0.9, it.col2); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2 + 0.05, it.h, it.h + 0.04, 0x3b3b3b); gb.box('plain', f, -0.3, 0.1, -it.d / 2 + 0.1, -it.d / 2 + 0.15, it.h + 0.04, it.h + 0.4, 0x161616); },
  deskpod: (gb, it, f) => {
    for (const sv of [-1, 1]) for (const su of [-1, 1]) {
      const df = { ...f, x: f.x + Math.cos(f.rot) * su * it.w / 4 - Math.sin(f.rot) * sv * it.d / 4, y: f.y + Math.sin(f.rot) * su * it.w / 4 + Math.cos(f.rot) * sv * it.d / 4, rot: f.rot + (sv > 0 ? Math.PI : 0) };
      gb.box('plain', df, -it.w / 4 + 0.02, it.w / 4 - 0.02, -it.d / 4, it.d / 4, it.h - 0.03, it.h, it.col); legs(gb, df, it.w / 2 - 0.04, it.d / 2, it.h - 0.03, 0x9a9a98, 0.03, 0.02);
      gb.box('plain', df, -0.28, 0.28, -it.d / 4 + 0.08, -it.d / 4 + 0.11, it.h + 0.1, it.h + 0.45, 0x161616); gb.box('glow', df, -0.26, 0.26, -it.d / 4 + 0.111, -it.d / 4 + 0.113, it.h + 0.12, it.h + 0.43, [0x2f4f6f, 0x3f5f4f, 0x4f4f6f][(it.seed + (su > 0) + (sv > 0) * 2) % 3], { flat: 0.95 });
      gb.box('plain', df, -0.05, 0.05, -it.d / 4 + 0.08, -it.d / 4 + 0.14, it.h, it.h + 0.12, 0x3a3a3a);
      const cf = { ...df, x: df.x - Math.sin(df.rot) * (it.d / 4 + 0.35), y: df.y + Math.cos(df.rot) * (it.d / 4 + 0.35) };
      gb.box('plain', cf, -0.24, 0.24, -0.24, 0.24, 0.45, 0.52, it.col2); gb.box('plain', cf, -0.22, 0.22, 0.2, 0.26, 0.52, 1.0, it.col2); gb.cyl('plain', cf, 0, 0, 0.03, 0.05, 0.45, 0x3a3a3a, 6); gb.box('plain', cf, -0.28, 0.28, -0.03, 0.03, 0.0, 0.05, 0x3a3a3a); gb.box('plain', cf, -0.03, 0.03, -0.28, 0.28, 0.0, 0.05, 0x3a3a3a);
    }
    gb.box('plain', f, -it.w / 2, it.w / 2, -0.02, 0.02, it.h, it.h + 0.4, 0x8a9aa6);
  },
  meeting: (gb, it, f) => ITEM.table(gb, it, f),
  printer: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, -it.d / 2 + 0.1, it.d / 2 - 0.1, it.h, it.h + 0.03, 0x3a3a3a); },
  // ------------------------------------------------ shop
  counter: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2 + 0.03, it.h, it.h + 0.04, 0x3b3b3b); if (it.till) { gb.box('plain', f, -0.25, 0.15, -0.1, 0.2, it.h + 0.04, it.h + 0.15, 0x2a2a2a); gb.box('glow', f, -0.2, 0.1, 0.0, 0.02, it.h + 0.15, it.h + 0.38, 0x4a7aaa, { flat: 0.95 }); } gb.box('products', f, -it.w / 2, it.w / 2, -it.d / 2 - 0.45, -it.d / 2 - 0.3, 0.9, 2.2, 0xffffff, { frontUV: [[0, 0], [it.w, 0], [it.w, 1], [0, 1]] }); },
  chiller: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0x2a2a2a, { skip: 'f' }); gb.quad('products', [f.x - Math.cos(f.rot) * it.w / 2 - Math.sin(f.rot) * (it.d / 2 - 0.15), f.h + 0.1, f.y - Math.sin(f.rot) * it.w / 2 + Math.cos(f.rot) * (it.d / 2 - 0.15)], [Math.cos(f.rot) * it.w, 0, Math.sin(f.rot) * it.w], [0, it.h - 0.3, 0], 0xffffff, { uv: [[0, 0], [it.w, 0], [it.w, 1], [0, 1]], flat: 1.25 }); gb.box('glass', f, -it.w / 2, it.w / 2, it.d / 2 - 0.02, it.d / 2, 0.05, it.h - 0.1, 0xffffff); gb.box('glow', f, -it.w / 2, it.w / 2, it.d / 2 - 0.1, it.d / 2, it.h - 0.18, it.h - 0.05, 0x2f6fb0, { flat: 1.2 }); },
  gondola: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0xe9e9e6, { skip: 'f' }); gb.quad('products', [f.x - Math.cos(f.rot) * it.w / 2 - Math.sin(f.rot) * (it.d / 2), f.h + 0.1, f.y - Math.sin(f.rot) * it.w / 2 + Math.cos(f.rot) * (it.d / 2)], [Math.cos(f.rot) * it.w, 0, Math.sin(f.rot) * it.w], [0, it.h - 0.15, 0], 0xffffff, { uv: [[it.seed * 0.37, 0], [it.seed * 0.37 + it.w, 0], [it.seed * 0.37 + it.w, 1], [it.seed * 0.37, 1]] }); },
  gondola2: (gb, it, f) => { for (const r of [0, Math.PI]) ITEM.gondola(gb, { ...it, d: it.d / 2 }, { ...f, rot: f.rot + r, x: f.x - Math.sin(f.rot + r) * it.d / 4, y: f.y + Math.cos(f.rot + r) * it.d / 4 }); },
  // ------------------------------------------------ pub
  barcounter: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('wood', f, -it.w / 2 - 0.05, it.w / 2 + 0.05, -it.d / 2 - 0.05, it.d / 2 + 0.1, it.h, it.h + 0.05, 0xb08a5a); for (let u = -it.w / 2 + 0.6; u < it.w / 2 - 0.4; u += 0.45) { gb.box('plain', f, u - 0.03, u + 0.03, -0.05, 0.05, it.h + 0.05, it.h + 0.45, 0xc9b26a); gb.box('plain', f, u - 0.035, u + 0.035, -0.06, 0.06, it.h + 0.45, it.h + 0.55, [0x7d1f2a, 0x2f4a7a, 0x1c1c1c, 0x3a6b4a][Math.abs(Math.round(u * 10)) % 4]); } for (let u = -it.w / 2 + 0.4; u < it.w / 2; u += 0.8) { const sf = { ...f, x: f.x + Math.cos(f.rot) * u - Math.sin(f.rot) * (-it.d / 2 - 0.45), y: f.y + Math.sin(f.rot) * u + Math.cos(f.rot) * (-it.d / 2 - 0.45) }; gb.cyl('plain', sf, 0, 0, 0.18, 0.72, 0.78, 0x7d1f2a, 8); gb.box('plain', sf, -0.02, 0.02, -0.02, 0.02, 0, 0.72, 0x3a3a3a); } },
  backbar: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.9, it.col); gb.quad('bottles', [f.x - Math.cos(f.rot) * it.w / 2 - Math.sin(f.rot) * (it.d / 2), f.h + 0.95, f.y - Math.sin(f.rot) * it.w / 2 + Math.cos(f.rot) * (it.d / 2)], [Math.cos(f.rot) * it.w, 0, Math.sin(f.rot) * it.w], [0, 1.15, 0], 0xffffff, { uv: [[0, 0], [it.w, 0], [it.w, 1], [0, 1]], flat: 1.1 }); },
  fireplace: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0x7a6a5a); gb.box('plain', f, -it.w / 2 + 0.3, it.w / 2 - 0.3, it.d / 2 - 0.01, it.d / 2 + 0.001, 0.1, it.h - 0.35, 0x161616); gb.box('glow', f, -0.3, 0.3, it.d / 2 - 0.2, it.d / 2 - 0.05, 0.12, 0.35, 0xff8a3a, { flat: 1.5 }); gb.box('plain', f, -it.w / 2 - 0.1, it.w / 2 + 0.1, -it.d / 2, it.d / 2 + 0.08, it.h, it.h + 0.08, 0x5b3a22); },
  pubtable: (gb, it, f) => { gb.cyl('plain', f, 0, 0, it.w / 2, it.h - 0.04, it.h, it.col, 10); gb.box('plain', f, -0.04, 0.04, -0.04, 0.04, 0, it.h - 0.04, 0x2a2a2a); chairsRound(gb, f, it.w, it.d, it.chairs, it.chairCol); gb.cyl('plain', f, 0.1, 0.05, 0.04, it.h, it.h + 0.15, 0xd9a03a, 6); },
  banquette: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 0.45, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.15, 0.45, it.h, shadeK(it.col, 0.9)); },
  dartboard: (gb, it, f) => { gb.cyl('plain', { ...f, rot: f.rot }, 0, 0.0, 0.23, 0, 0.02, 0x1c1c1c, 12); gb.box('plain', f, -0.23, 0.23, -0.02, 0.0, -0.23, 0.23, 0x1c1c1c); gb.box('plain', f, -0.18, 0.18, 0.0, 0.005, -0.18, 0.18, 0xd9c9a0); gb.box('plain', f, -0.04, 0.04, 0.005, 0.008, -0.04, 0.04, 0xc0392b); },
  // ------------------------------------------------ church
  dais: (gb, it, f) => gb.box('wood', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col, { skip: 'd' }),
  altar: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.3, 0.3 + it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.2, it.w / 2 - 0.2, it.d / 2, it.d / 2 + 0.005, 0.35, 0.3 + it.h - 0.05, it.col2); gb.box('plain', f, -0.02, 0.02, -0.02, 0.02, 0.3 + it.h, 0.3 + it.h + 0.5, 0xc9b26a); gb.box('plain', f, -0.15, 0.15, -0.02, 0.02, 0.3 + it.h + 0.32, 0.3 + it.h + 0.36, 0xc9b26a); },
  lectern: (gb, it, f) => { gb.box('plain', f, -0.06, 0.06, -0.06, 0.06, 0.3, 0.3 + it.h - 0.2, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.3 + it.h - 0.2, 0.3 + it.h, it.col); },
  font: (gb, it, f) => { gb.cyl('plain', f, 0, 0, 0.16, 0, it.h - 0.3, it.col, 8); gb.cyl('plain', f, 0, 0, it.w / 2, it.h - 0.3, it.h, it.col, 10); },
  pew: (gb, it, f) => { gb.box('wood', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.42, 0.47, it.col); gb.box('wood', f, -it.w / 2, it.w / 2, -it.d / 2, -it.d / 2 + 0.05, 0.47, it.h, it.col); for (const u of [-it.w / 2, it.w / 2 - 0.05]) gb.box('wood', f, u, u + 0.05, -it.d / 2, it.d / 2, 0, 0.9, shadeK(it.col, 0.85)); },
  runner: (gb, it, f) => gb.box('carpet', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.002, 0.01, it.col, { skip: 'd' }),
  // ------------------------------------------------ mall
  planter: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, it.col); gb.box('plain', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, -it.d / 2 + 0.1, it.d / 2 - 0.1, it.h, it.h + 0.02, 0x4a3a2a); gb.cyl('plain', f, 0, 0, 0.1, it.h, it.h + 2.4, 0x6a4a2a, 6); for (let k = 0; k < 6; k++) { const a = k * 1.05; gb.box('plain', f, Math.cos(a) * 0.5 - 0.5, Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 - 0.5, Math.sin(a) * 0.5 + 0.5, it.h + 2.0 + (k % 2) * 0.4, it.h + 3.0 + (k % 3) * 0.3, [0x3f6b35, 0x4f7f3f, 0x2f5a2a][k % 3]); } },
  bench: (gb, it, f) => { gb.box('wood', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0.4, it.h, it.col); for (const u of [-it.w / 2 + 0.1, it.w / 2 - 0.15]) gb.box('plain', f, u, u + 0.05, -it.d / 2 + 0.05, it.d / 2 - 0.05, 0, 0.4, 0x55585c); },
  kiosk: (gb, it, f) => { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, 1.05, it.col); gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 2.1, it.h, it.col); gb.box('glow', f, -it.w / 2, it.w / 2, it.d / 2, it.d / 2 + 0.01, 2.15, it.h - 0.05, 0xfff3d0, { flat: 1.2 }); for (const u of [-it.w / 2, it.w / 2 - 0.08]) gb.box('plain', f, u, u + 0.08, -it.d / 2, it.d / 2, 1.05, 2.1, 0x3a3a3a); },
  escalator: (gb, it, f) => {
    const L = it.w, h = it.h, n = 16;
    for (let k = 0; k < n; k++) { const u0 = -L / 2 + k * L / n; gb.box('metal', f, u0, u0 + L / n, -it.d / 2, it.d / 2, 0, (k + 1) * h / n, 0xb9bcbf, { skip: 'd' }); }
    for (const v of [-it.d / 2 - 0.08, it.d / 2]) for (let k = 0; k < n; k++) { const u0 = -L / 2 + k * L / n; gb.box('glass', f, u0, u0 + L / n, v, v + 0.08, (k + 0.5) * h / n, (k + 0.5) * h / n + 1.0, 0xffffff); gb.box('plain', f, u0, u0 + L / n, v, v + 0.08, (k + 0.5) * h / n + 0.95, (k + 0.5) * h / n + 1.05, 0x1c1c1c); }
  },
  gallery: (gb, it, f) => {
    // the upper floor's walkway either side, its glass balustrade and the upper shopfronts (to look up at)
    const W = it.w, h = it.h;
    for (const [y0, y1] of [[it.y0, it.y0 + 3.5], [it.y1 - 3.5, it.y1]]) {
      const g = { x: f.x, y: f.y, rot: 0, h: f.h };
      const v0 = y0 - f.y, v1 = y1 - f.y;
      gb.box('marble', g, -W / 2, W / 2, v0, v1, h - 0.3, h, 0xf4f1ea);
      const edge = y0 === it.y0 ? v1 : v0;
      gb.box('glass', g, -W / 2, W / 2, edge - 0.03, edge + 0.03, h, h + 1.05, 0xffffff);
      gb.box('plain', g, -W / 2, W / 2, edge - 0.04, edge + 0.04, h + 1.02, h + 1.08, 0xb9bcbf);
      for (let x = -W / 2 + 6; x < W / 2; x += 12) gb.box('plain', g, x - 0.25, x + 0.25, edge - 0.25, edge + 0.25, 0, h, 0xeeeeea);
      // upper shopfronts: glowing windows along the back of the walkway
      const back = y0 === it.y0 ? v0 : v1;
      for (let x = -W / 2 + 1; x < W / 2 - 2; x += 9) gb.box('glow', g, x, x + 7, back - 0.02, back + 0.02, h + 0.2, h + 2.8, [0xe9eef2, 0xf4ece4, 0xeef4ea][Math.abs(Math.round(x)) % 3], { flat: 1.15 });
    }
  },
  display: (gb, it, f) => { const k = (it.seed || 0) % 3; if (k === 0) { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0xf2efe9); gb.box('plain', f, -it.w / 2 + 0.1, it.w / 2 - 0.1, -it.d / 2 + 0.1, it.d / 2 - 0.1, it.h, it.h + 0.15, it.col); } else if (k === 1) { gb.box('plain', f, -it.w / 2, it.w / 2, -0.02, 0.02, 1.5, 1.53, 0x9a9a98); for (let q = 0; q < 6; q++) gb.box('plain', f, -it.w / 2 + 0.1 + q * 0.17, -it.w / 2 + 0.22 + q * 0.17, -0.15, 0.15, 0.6, 1.48, [it.col, 0x2c3e50, 0xe9e4da, 0x8e2b2b][q % 4]); for (const u of [-it.w / 2, it.w / 2 - 0.03]) gb.box('plain', f, u, u + 0.03, -0.02, 0.02, 0, 1.55, 0x9a9a98); } else { gb.box('plain', f, -it.w / 2, it.w / 2, -it.d / 2, it.d / 2, 0, it.h, 0x2a2a2a); gb.box('products', f, -it.w / 2 + 0.05, it.w / 2 - 0.05, -it.d / 2 + 0.05, it.d / 2 - 0.05, it.h, it.h + 0.4, 0xffffff); } },
};
