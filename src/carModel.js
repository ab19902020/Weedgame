// Detailed procedural cars for vehicles.js.
// Each model has a spec: a smooth side profile (bonnet, windscreen, roof, rear screen, boot or tail),
// sill, belt and shoulder lines, plan-view taper, tumblehome, arch flares, door layout. The body is lofted
// through rounded cross-sections, then dressed with headlight and tail-light clusters, DRLs, indicators,
// grilles and intakes, UK number plates, wing mirrors, door handles, wipers, roof rails, spoilers,
// exhausts and a shark-fin aerial. Glass shows a parallax cabin (seats, headrests, wheel) behind
// sky reflections. Wheels have per-car alloy designs, brake discs and calipers that stay put.
//
// Per-vertex data (WebGPU allows 8 vertex buffers per pipeline, instancing takes three):
//   color (vec3 trim colour), vdat (vec4: paint 0/1, part code, livery, model index + 1)
// Part codes: 0 body, 1 headlight, 2 tail/brake, 3 light bar, 4 bus blind, 5 indicator, 6 DRL,
//   10 front plate, 11 rear plate, 12 grille, 13 chrome, 14 glass, 15 mirror glass, 16 black trim,
//   17 exhaust, 18 reversing lens
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, int, mix, step, smoothstep, positionGeometry, positionWorld, cameraPosition, length, atan, fract, floor, abs, sin, cos,
  attribute, uniformArray, normalize, max, min, select, dot, pow,
} from 'three/tsl';
import { U } from './env.js';
import { lightPool } from './materials.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ specs (metres; +x forward)
// top: side-profile control points [x as fraction of half-length, y]; ws0/ws1 windscreen base/top x, rr0 roof end x,
// gl0/gl1 side-glass x range, belt [front, rear], hs sill, flare arch bulge, tumble glasshouse lean,
// doors [xFrontEdge, xB, xRearEdge] (2-door: xB = null), extras
export const CAR_SPECS = {
  hatch: { hs: 0.27, belt: [0.95, 1.02], tumble: 1, flare: 0.012, endF: 0.48, endR: 0.36, ws0: 0.6, ws1: -0.18, rr0: -1.62, gl: [0.55, -1.78], doors: [0.62, -0.32, -1.08],
    top: [[-1, 0.42], [-0.985, 0.98], [-0.93, 1.2], [-0.8, 1.44], [-0.09, 1.47], [0.3, 0.99], [0.62, 0.9], [0.92, 0.8], [1, 0.62]], wheelX: 0.04, rim: 0.66, wheel: 0 },
  hothatch: { hs: 0.23, belt: [0.94, 1.0], tumble: 1, flare: 0.03, endF: 0.48, endR: 0.36, ws0: 0.62, ws1: -0.15, rr0: -1.6, gl: [0.56, -1.76], doors: [0.64, -0.32, -1.06],
    top: [[-1, 0.4], [-0.985, 0.96], [-0.93, 1.18], [-0.8, 1.42], [-0.08, 1.44], [0.3, 0.97], [0.62, 0.88], [0.92, 0.76], [1, 0.58]], wheelX: 0.04, rim: 0.74, wheel: 3,
    spoiler: 'roof', exhaust: 2, caliper: 1, intake: 1 },
  saloon: { hs: 0.28, belt: [0.95, 1.02], tumble: 1, flare: 0.012, endF: 0.5, endR: 0.42, ws0: 0.75, ws1: 0.02, rr0: -0.78, gl: [0.68, -1.0], doors: [0.78, -0.18, -0.98],
    top: [[-1, 0.45], [-0.985, 0.96], [-0.92, 1.04], [-0.66, 1.06], [-0.33, 1.44], [0.01, 1.45], [0.32, 0.99], [0.66, 0.88], [0.94, 0.78], [1, 0.6]], wheelX: 0.02, rim: 0.68, wheel: 1 },
  estate: { hs: 0.28, belt: [0.96, 1.03], tumble: 0.9, flare: 0.012, endF: 0.5, endR: 0.36, ws0: 0.78, ws1: 0.02, rr0: -2.1, gl: [0.7, -2.12], doors: [0.8, -0.16, -0.96],
    top: [[-1, 0.45], [-0.99, 1.0], [-0.95, 1.32], [-0.86, 1.47], [0.01, 1.5], [0.33, 1.0], [0.66, 0.9], [0.94, 0.78], [1, 0.6]], wheelX: 0.02, rim: 0.66, wheel: 1, rails: 1 },
  suv: { hs: 0.4, belt: [1.07, 1.13], tumble: 0.75, flare: 0.03, endF: 0.45, endR: 0.38, ws0: 0.68, ws1: -0.06, rr0: -1.8, gl: [0.62, -1.86], doors: [0.7, -0.24, -1.0],
    top: [[-1, 0.52], [-0.985, 1.12], [-0.94, 1.42], [-0.84, 1.62], [-0.04, 1.66], [0.31, 1.1], [0.64, 1.02], [0.93, 0.92], [1, 0.72]], wheelX: 0.03, rim: 0.62, wheel: 0, rails: 1, cladding: 1 },
  van: { hs: 0.33, belt: [1.2, 1.2], tumble: 0.3, flare: 0.0, endF: 0.4, endR: 0.12, ws0: 1.62, ws1: 1.02, rr0: -2.62, gl: [1.58, 0.48], doors: [1.64, 0.5, null],
    top: [[-1, 0.4], [-0.996, 2.2], [-0.98, 2.3], [0.38, 2.32], [0.6, 1.4], [0.82, 1.22], [0.96, 1.04], [1, 0.72]], wheelX: 0.08, rim: 0.6, wheel: 2, panelVan: 1 },
  coupe: { hs: 0.23, belt: [0.9, 0.96], tumble: 1.1, flare: 0.03, endF: 0.52, endR: 0.42, ws0: 0.66, ws1: -0.12, rr0: -0.9, gl: [0.6, -1.2], doors: [0.68, null, -0.66],
    top: [[-1, 0.44], [-0.985, 0.9], [-0.9, 0.98], [-0.62, 1.0], [-0.22, 1.33], [0.0, 1.36], [0.31, 0.95], [0.68, 0.84], [0.95, 0.72], [1, 0.55]], wheelX: 0.02, rim: 0.74, wheel: 3,
    exhaust: 2, caliper: 1, lightBar: 1 },
  sports: { hs: 0.13, belt: [0.84, 0.92], tumble: 1.3, flare: 0.07, endF: 0.55, endR: 0.4, ws0: 0.42, ws1: -0.28, rr0: -0.62, gl: [0.38, -0.66], doors: [0.4, null, -0.4],
    top: [[-1, 0.4], [-0.985, 0.82], [-0.88, 0.92], [-0.5, 0.98], [-0.3, 1.16], [-0.1, 1.19], [0.2, 0.85], [0.6, 0.7], [0.94, 0.6], [1, 0.44]], wheelX: 0.0, rim: 0.78, wheel: 3,
    wing: 1, exhaust: 4, caliper: 1, intake: 2, lightBar: 1, sideIntake: 1 },
  police: { inherit: 'estate', rails: 0 },
};
for (const k in CAR_SPECS) if (CAR_SPECS[k].inherit) CAR_SPECS[k] = { ...CAR_SPECS[CAR_SPECS[k].inherit], ...CAR_SPECS[k] };

// monotone cubic (no overshoot) through sorted points
function monotone(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ geometry
class Parts {
  constructor() { this.list = []; }
  // g: BufferGeometry; part code; paint 0/1; rgb trim colour
  add(g, code, paint = 0, rgb = [0.03, 0.03, 0.03]) {
    g = g.index ? g.toNonIndexed() : g;
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => rgb[i % 3]), 3));
    g.setAttribute('vdat', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, i) => [paint, code, 0, 0][i % 4]), 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'vdat'].includes(k)) g.deleteAttribute(k);
    this.list.push(g);
    return g;
  }
}

export function buildCar(def, key, modelIndex) {
  const S = CAR_SPECS[key] || CAR_SPECS.hatch;
  const { L, W, H, wb, wr } = def, l = L / 2, hw0 = W / 2;
  const topF = monotone(S.top.map(([u, y]) => [u * l, y]));
  const wx = (S.wheelX || 0) * l;            // wheelbase centre offset (front-engined cars sit their wheels forward)
  const wheels = [wb / 2 + wx, -wb / 2 + wx];
  const beltAt = x => lerp(S.belt[1], S.belt[0], clamp01((x + l) / L));
  const bottomAt = x => { const e = clamp01((Math.abs(x) - (l - 0.22)) / 0.22); return S.hs + e * e * 0.16; };
  const flareAt = x => wheels.reduce((a, c) => a + S.flare * Math.exp(-(((x - c) / (wr * 1.25)) ** 2)), 0);
  const widthAt = x => {
    const r = x > 0 ? S.endF : S.endR, u = clamp01((Math.abs(x) - (l - r)) / r);
    return hw0 * Math.max(0.58, Math.pow(1 - Math.pow(u, 2.4), 1 / 2.4));
  };
  // stations: cosine spacing + profile breaks + dense around arches
  const xs = new Set();
  const NS = 26;
  for (let i = 0; i <= NS; i++) xs.add(+(-l * Math.cos(Math.PI * i / NS)).toFixed(4));
  for (const [u] of S.top) xs.add(+(u * l).toFixed(4));
  for (const c of wheels) for (let k = -4; k <= 4; k++) xs.add(+(c + k / 4 * (wr + 0.14)).toFixed(4));
  for (const d of S.doors) if (d != null) for (const o of [-0.03, 0.03]) xs.add(+(d + o).toFixed(4));
  const X = [...xs].filter(x => x >= -l && x <= l).sort((a, b) => a - b);
  const K = 13;
  const ring = x => {
    const hw = widthAt(x), y0 = bottomAt(x), yt = Math.max(topF(x), y0 + 0.2), yb = Math.min(beltAt(x), yt - 0.025);
    const gh = clamp01((yt - yb) / 0.22), tb = S.tumble * gh, f = flareAt(x);
    const end = clamp01((Math.abs(x) - (l - 0.1)) / 0.1);
    const half = [
      [y0, hw * 0.86], [y0 + 0.05, hw * 0.97 + f * 0.6], [lerp(y0, yb, 0.3), hw + f], [lerp(y0, yb, 0.62), hw + f * 0.7],
      [yb - 0.085, hw * 0.996 + f * 0.2], [yb - 0.035, hw * 1.004], [yb, hw * 0.968],
      [yb + 0.015 * gh, hw * (0.955 - 0.02 * gh)], [lerp(yb, yt, 0.55), hw * (0.95 - 0.1 * tb)], [yt - 0.03 * gh - 0.012, hw * (0.94 - 0.2 * tb)],
      [yt - 0.004, hw * (0.84 - 0.18 * tb)], [yt + 0.006, hw * (0.5 - 0.1 * gh)], [yt + 0.012 * (1 - end), 0],
    ];
    // wheel-arch recesses: lower side points inside the arch circle are pulled in to the inner liner
    const cw = wheels.reduce((a, c) => (Math.abs(x - c) < Math.abs(x - a) ? c : a), wheels[0]);
    for (let k = 0; k <= 4; k++) {
      const d = Math.hypot(x - cw, half[k][0] - wr), m = clamp01((wr + 0.1 - d) / 0.035);
      if (m > 0) half[k] = [half[k][0], lerp(half[k][1], hw - 0.3, m)];
    }
    const r = [];
    for (const [y, w] of half) r.push([x, y, w * (1 - end * 0.04)]);
    for (let k = K - 2; k >= 0; k--) r.push([x, half[k][0], -half[k][1] * (1 - end * 0.04)]);
    return r;
  };
  const R = 2 * K - 1;
  const P = [], I = [], tri = [];
  for (const x of X) for (const v of ring(x)) P.push(...v);
  for (let s = 0; s < X.length - 1; s++) for (let k = 0; k < R; k++) {
    const k1 = (k + 1) % R, a = s * R + k, b = (s + 1) * R + k, c = (s + 1) * R + k1, d = s * R + k1;
    I.push(a, b, c, a, c, d); tri.push([k, s], [k, s]);
  }
  for (const [s, flip] of [[0, true], [X.length - 1, false]]) {
    let cy = 0; for (let k = 0; k < R; k++) cy += P[(s * R + k) * 3 + 1] / R;
    const c = P.length / 3; P.push(X[s] + (flip ? -0.01 : 0.01), cy, 0);
    for (let k = 0; k < R; k++) { const k1 = (k + 1) % R; if (flip) I.push(c, s * R + k, s * R + k1); else I.push(c, s * R + k1, s * R + k); tri.push([k, -1 - s]); }
  }
  let body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); body.setIndex(I);
  body.computeVertexNormals();
  body = body.toNonIndexed();
  // classify body triangles: glass panels, black sills / lower bumpers / cladding, paint
  const pos = body.attributes.position, nT = pos.count / 3;
  const col = new Float32Array(pos.count * 3), vd = new Float32Array(pos.count * 4);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const mirror = k => (k >= K ? 2 * (K - 1) - k : k);
  const bPillar = S.doors[1];
  for (let t = 0; t < nT; t++) {
    const [k, s] = tri[t];
    va.fromBufferAttribute(pos, t * 3); vb.fromBufferAttribute(pos, t * 3 + 1); vc.fromBufferAttribute(pos, t * 3 + 2);
    const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3;
    const n = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
    const h = mirror(k);
    let code = 0, paint = 1, rgb = [1, 1, 1];
    if (s >= 0) {
      const belt = beltAt(cx);
      const sideGlass = (h === 7 || h === 8) && cx < S.gl[0] && cx > S.gl[1] && cy > belt - 0.01 && !(bPillar != null && Math.abs(cx - bPillar) < 0.045);
      const screen = h >= 9 && h <= 11 && Math.abs(n.x) > 0.38 && cy > belt + 0.02 && cy < topF(cx) + 0.02;
      if ((sideGlass && !(S.panelVan && cx < S.gl[1] + 0.02)) || screen) { code = 14; paint = 0; rgb = [0.02, 0.025, 0.03]; }
      else if (h <= 1 && (s >= 0)) { code = 16; paint = 0; rgb = [0.025, 0.025, 0.027]; }                                         // sills
      else if (S.cladding && h <= 3 && cy < S.hs + 0.22) { code = 16; paint = 0; rgb = [0.03, 0.03, 0.032]; }                     // SUV cladding
    } else if (cy > beltAt(cx) + 0.03 && Math.abs(n.y) < 0.75 && cy < topF(cx) && !S.panelVan) { code = 14; paint = 0; rgb = [0.02, 0.025, 0.03]; }   // tailgate glass
    else if (cy < S.hs + 0.1) { code = 16; paint = 0; rgb = [0.025, 0.025, 0.027]; }
    for (let j = 0; j < 3; j++) { const v = t * 3 + j; col.set(rgb, v * 3); vd.set([paint, code, 0, modelIndex], v * 4); }
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.setAttribute('vdat', new THREE.BufferAttribute(vd, 4));
  const parts = new Parts(); parts.list.push(body);
  // ---------------- details
  const noseY = topF(l - 0.02), tailY = topF(-l + 0.02);
  const zH = hw0 - 0.26 - (S.endF > 0.5 ? 0.03 : 0);
  const xNose = x => l - (1 - Math.pow(Math.max(0, 1 - Math.pow(clamp01(Math.abs(x) / (hw0 * 1.0)), 2.4)), 1 / 2.4)) * S.endF;   // x of the nose surface at lateral offset
  const xTail = z => -l + (1 - Math.pow(Math.max(0, 1 - Math.pow(clamp01(Math.abs(z) / hw0), 2.4)), 1 / 2.4)) * S.endR;
  const hy = Math.max(noseY - 0.1, S.hs + 0.25);
  for (const sd of [-1, 1]) {
    // headlight cluster: swept lens following the corner, DRL strip under it, amber indicator outboard
    const hl = new THREE.SphereGeometry(1, 14, 8); hl.scale(0.09, S.wing ? 0.035 : 0.055, 0.2); hl.rotateY(sd * 0.42);
    hl.translate(xNose(zH) - 0.05, hy, sd * zH); parts.add(hl, 1, 0, [0.85, 0.85, 0.82]);
    const drl = new THREE.BoxGeometry(0.03, 0.012, 0.22); drl.rotateY(sd * 0.42); drl.translate(xNose(zH) - 0.03, hy - (S.wing ? 0.03 : 0.05), sd * (zH - 0.02)); parts.add(drl, 6, 0, [0.9, 0.9, 0.9]);
    const ind = new THREE.BoxGeometry(0.05, 0.03, 0.06); ind.translate(xNose(zH + 0.15) - 0.03, hy, sd * (zH + 0.15)); parts.add(ind, 5, 0, [0.7, 0.4, 0.05]);
    // tail-light cluster wrapping round the rear corner, clear reversing lens inboard
    const tl = new THREE.SphereGeometry(1, 14, 8); tl.scale(0.07, S.lightBar ? 0.03 : 0.07, S.lightBar ? 0.24 : 0.17); tl.rotateY(-sd * 0.5);
    const tz = hw0 - 0.2, ty = Math.min(tailY - 0.12, S.belt[1] - 0.06);
    tl.translate(xTail(tz) + 0.05, ty, sd * tz); parts.add(tl, 2, 0, [0.45, 0.03, 0.03]);
    const rv = new THREE.BoxGeometry(0.03, 0.035, 0.08); rv.translate(xTail(tz - 0.2) - 0.005, ty - 0.02, sd * (tz - 0.2)); parts.add(rv, 18, 0, [0.8, 0.8, 0.8]);
    // wing mirror: stalk, body-colour housing, glass facing back
    const mx = S.ws0 - 0.08, my = beltAt(mx) + 0.07, mz = sd * (widthAt(mx) + 0.06);
    const stalk = new THREE.BoxGeometry(0.05, 0.025, 0.09); stalk.translate(mx, my - 0.02, sd * (widthAt(mx) + 0.02)); parts.add(stalk, 16, 0);
    const hous = new THREE.SphereGeometry(1, 12, 8); hous.scale(0.075, 0.06, 0.1); hous.translate(mx, my, mz); parts.add(hous, 0, 1);
    const mg = new THREE.BoxGeometry(0.005, 0.085, 0.15); mg.translate(mx - 0.068, my, mz); parts.add(mg, 15, 0, [0.4, 0.42, 0.45]);
    // door handles (near the rear edge of each door)
    const handles = S.doors[1] != null ? [S.doors[1] + 0.13, S.doors[2] + 0.13] : [S.doors[2] + 0.16];
    for (const x of handles) { const g = new THREE.BoxGeometry(0.14, 0.022, 0.02); g.translate(x, beltAt(x) - 0.075, sd * (widthAt(x) + 0.002)); parts.add(g, S.wheel === 3 ? 13 : 0, S.wheel === 3 ? 0 : 1, [0.6, 0.6, 0.62]); }
    // roof rails
    if (S.rails) { const len = S.ws1 - S.rr0 - 0.2, g = new THREE.BoxGeometry(len, 0.03, 0.03); g.translate((S.ws1 + S.rr0) / 2, topF((S.ws1 + S.rr0) / 2) + 0.03, sd * hw0 * 0.62); parts.add(g, 16, 0, [0.05, 0.05, 0.05]); }
    // sports side intakes ahead of the rear wheels
    if (S.sideIntake) { const g = new THREE.SphereGeometry(1, 10, 6); g.scale(0.32, 0.09, 0.03); g.translate(wheels[1] + wr + 0.4, S.hs + 0.32, sd * (widthAt(wheels[1] + wr + 0.4) + 0.012)); parts.add(g, 16, 0, [0.01, 0.01, 0.012]); }
  }
  // grille / intakes
  const gw = S.wing ? hw0 * 1.2 : hw0 * 0.75;
  const grille = new THREE.BoxGeometry(0.03, S.wing ? 0.1 : 0.15, gw); grille.translate(xNose(0) - 0.012, S.wing ? S.hs + 0.18 : hy - 0.09, 0); parts.add(grille, 12, 0, [0.02, 0.02, 0.022]);
  if (S.intake) { const g = new THREE.BoxGeometry(0.03, 0.08, hw0 * 1.3); g.translate(xNose(0) - 0.02, S.hs + 0.1, 0); parts.add(g, 12, 0, [0.015, 0.015, 0.017]); }
  // number plates: front white, rear yellow (520 x 111 mm)
  const pfy = S.wing ? S.hs + 0.3 : hy - 0.2, pry = Math.max(S.hs + 0.22, Math.min(tailY - 0.38, 0.62));
  const pf = new THREE.BoxGeometry(0.015, 0.111, 0.52); pf.translate(xNose(0) + 0.004, pfy, 0); parts.add(pf, 10, 0, [pfy, 0, 0]);
  const pr = new THREE.BoxGeometry(0.015, 0.111, 0.52); pr.translate(xTail(0) - 0.004, pry, 0); parts.add(pr, 11, 0, [pry, 0, 0]);
  // wipers at the windscreen base, shark-fin aerial
  for (const z of [-0.05, 0.42]) { const g = new THREE.BoxGeometry(0.02, 0.012, 0.55); g.rotateY(0.18); g.translate(S.ws0 - 0.06, topF(S.ws0 - 0.06) + 0.012, z); parts.add(g, 16, 0, [0.02, 0.02, 0.02]); }
  { const g = new THREE.ConeGeometry(0.03, 0.06, 6); g.scale(2.2, 1, 0.6); g.translate(S.rr0 + 0.25, topF(S.rr0 + 0.25) + 0.03, 0); parts.add(g, 16, 0, [0.02, 0.02, 0.02]); }
  // spoilers and wings
  if (S.spoiler === 'roof') { const g = new THREE.BoxGeometry(0.22, 0.03, W * 0.8); g.rotateZ(-0.18); g.translate(S.rr0 - 0.02, topF(S.rr0) - 0.005, 0); parts.add(g, 0, 1); }
  if (S.wing) {
    const g = new THREE.BoxGeometry(0.28, 0.025, W * 0.86); g.rotateZ(-0.08); g.translate(-l + 0.28, tailY + 0.22, 0); parts.add(g, 16, 0, [0.02, 0.02, 0.02]);
    for (const sd of [-1, 1]) { const p = new THREE.BoxGeometry(0.12, 0.2, 0.025); p.translate(-l + 0.3, tailY + 0.11, sd * W * 0.3); parts.add(p, 16, 0, [0.02, 0.02, 0.02]); }
  }
  // exhausts
  const nEx = S.exhaust || 1;
  for (let e = 0; e < nEx; e++) {
    const z = nEx === 1 ? -hw0 * 0.55 : (e - (nEx - 1) / 2) * (nEx > 2 ? 0.13 : hw0 * 1.1);
    const g = new THREE.CylinderGeometry(nEx > 1 ? 0.04 : 0.028, nEx > 1 ? 0.04 : 0.028, 0.12, 10); g.rotateZ(Math.PI / 2); g.translate(xTail(z) + 0.02, S.hs + 0.05, z); parts.add(g, 17, 0, [0.5, 0.5, 0.52]);
  }
  if (def.livery) { const g = new THREE.BoxGeometry(0.35, 0.1, 1.2); g.translate(-0.25, H + 0.05, 0); parts.add(g, 3, 0, [0.1, 0.1, 0.12]); }
  // cockpit (seen from the driver camera, where the single-sided shell drops away): dashboard under the
  // windscreen, instrument binnacle, steering wheel on the right, front seats
  {
    const sc = topF(S.ws0) - 0.015, fl = S.hs + 0.12, iw = widthAt(S.ws0 - 0.3) * 0.86;
    const dash = new THREE.BoxGeometry(0.6, sc - fl, iw * 2); dash.translate(S.ws0 - 0.32, (sc + fl) / 2, 0); parts.add(dash, 16, 0, [0.035, 0.035, 0.038]);
    const top = new THREE.BoxGeometry(0.3, 0.025, iw * 2); top.translate(S.ws0 - 0.5, sc - 0.01, 0); parts.add(top, 16, 0, [0.05, 0.05, 0.052]);
    const bin = new THREE.BoxGeometry(0.16, 0.07, 0.34); bin.translate(S.ws0 - 0.62, sc + 0.02, 0.37); parts.add(bin, 16, 0, [0.02, 0.02, 0.022]);
    const sw = new THREE.TorusGeometry(0.18, 0.02, 6, 20); sw.rotateY(Math.PI / 2); sw.rotateZ(0.42); sw.translate(S.ws0 - 0.78, sc - 0.06, 0.37); parts.add(sw, 16, 0, [0.02, 0.02, 0.02]);
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10); hub.rotateZ(Math.PI / 2 - 0.42); hub.translate(S.ws0 - 0.78, sc - 0.06, 0.37); parts.add(hub, 16, 0, [0.03, 0.03, 0.03]);
    const seatX = S.ws0 - 1.35;
    for (const z of [0.37, -0.37]) {
      const base = new THREE.BoxGeometry(0.5, 0.12, 0.46); base.translate(seatX + 0.1, fl + 0.2, z); parts.add(base, 16, 0, [0.05, 0.05, 0.055]);
      const back = new THREE.BoxGeometry(0.12, 0.62, 0.46); back.rotateZ(0.22); back.translate(seatX - 0.17, fl + 0.55, z); parts.add(back, 16, 0, [0.05, 0.05, 0.055]);
      const rest = new THREE.BoxGeometry(0.1, 0.18, 0.26); rest.rotateZ(0.22); rest.translate(seatX - 0.25, fl + 0.95, z); parts.add(rest, 16, 0, [0.06, 0.06, 0.065]);
    }
  }
  return { parts: parts.list, spec: S, wheels };
}

// ------------------------------------------------------------------ materials
const sel = (c, a, b) => select(c, a, b).uniformFlow().toVar();
const eqf = (a, k) => step(k - 0.5, a).mul(step(a, k + 0.5));
const rotY = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };

// models: ordered list of [key, def] matching vdat.w (index + 1)
export function vehicleMaterial(models) {
  const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.35, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const vd = attribute('vdat', 'vec4'), vc = attribute('color', 'vec3'), paint = vd.x, part = vd.y, liv = vd.z;
  const ic = attribute('iPaint', 'vec3');
  const st = attribute('iState', 'vec4');   // x brake, y lights, z siren, w heading
  const lp = positionGeometry;             // model space (positionLocal is instance-transformed in the fragment)
  const spec = k => CAR_SPECS[k] || null;
  const arr = (f, d) => uniformArray([d, ...models.map(([k, def]) => f(k, def))], 'vec4').element(int(vd.w.add(0.5)));
  // per model: (half wheelbase, wheel radius, half width, wheel x offset) and (door front, B pillar, door rear, belt)
  const A = arr((k, d) => { const S = spec(k); return S ? new THREE.Vector4(d.wb / 2, d.wr, d.W / 2, (S.wheelX || 0) * d.L / 2) : new THREE.Vector4(); }, new THREE.Vector4());
  const D = arr((k, d) => { const S = spec(k); return S ? new THREE.Vector4(S.doors[0], S.doors[1] ?? -99, S.doors[2] ?? -99, (S.belt[0] + S.belt[1]) / 2) : new THREE.Vector4(-99, -99, -99, 1); }, new THREE.Vector4(-99, -99, -99, 1));
  const isCar = step(0.01, A.x);
  // Battenburg livery
  const checker = step(0.5, fract(lp.x.div(0.62).add(step(0.72, lp.y).mul(0.5))));
  const batten = mix(vec3(0.85, 0.82, 0.05), vec3(0.04, 0.1, 0.55), checker);
  // wheel-arch liners, cut per pixel
  const ax = abs(lp.x.sub(A.w));
  const archD = length(vec2(abs(ax.sub(A.x)), lp.y.sub(A.y)));
  const archM = isCar.mul(step(A.z.sub(0.3), abs(lp.z))).mul(smoothstep(A.y.add(0.09), A.y.add(0.075), archD));
  // shut lines: doors (verticals and the sill/belt rails of each door), bonnet and boot edges
  const side = step(A.z.mul(0.82), abs(lp.z)).mul(isCar);
  const inDoorY = step(0.3, lp.y).mul(step(lp.y, D.w.add(0.02)));
  const vline = step(abs(lp.x.sub(D.x)), 0.004).add(step(abs(lp.x.sub(D.y)), 0.004)).add(step(abs(lp.x.sub(D.z)), 0.004)).min(1).mul(inDoorY).mul(side);
  const shut = vline.mul(eqf(part, 0)).mul(paint);
  // number plates: 3x5 pixel glyphs from a per-car hash (UK layout AB12 CDE); vc.x carries the plate centre height
  const plate = eqf(part, 10).add(eqf(part, 11));
  const pu = lp.z.add(0.26).div(0.52), pvv = lp.y.sub(vc.x.sub(0.0555)).div(0.111);
  const cell = floor(pu.mul(8.5)), cu = fract(pu.mul(8.5)), gap = eqf(cell, 4);
  const seed = fract(sin(dot(ic.xy.add(vec2(vd.w, ic.z)), vec2(12.9898, 78.233))).mul(43758.5453));
  const glyphBits = floor(fract(sin(cell.mul(17.13).add(seed.mul(91.7))).mul(43758.5453)).mul(32768));
  const px = floor(cu.mul(4)), py = floor(pvv.mul(7));
  const bitI = px.add(py.sub(1).mul(3)).max(0);
  const on = step(0.5, fract(floor(glyphBits.div(pow(float(2), bitI))).mul(0.5))).mul(step(px, 2.5)).mul(step(0.5, py)).mul(step(py, 5.5)).mul(float(1).sub(gap)).mul(step(0.04, pu)).mul(step(pu, 0.96)).mul(plate);
  const plateCol = mix(vec3(0.85, 0.85, 0.83), vec3(0.88, 0.7, 0.04), eqf(part, 11));
  // grille mesh
  const mesh = eqf(part, 12).mul(step(0.5, fract(lp.y.mul(55).add(step(0.5, fract(lp.z.mul(28))).mul(0.5)))).mul(step(0.5, fract(lp.z.mul(28)))));
  // glass: parallax cabin (seat backs with headrests, dashboard, wheel on the right) behind the reflections
  const glass = eqf(part, 14).add(eqf(part, 15).mul(0));
  const vw = normalize(positionWorld.sub(cameraPosition));
  const vl = rotY(vw, st.w);                                      // world -> model (yaw only)
  const seatPlane = (xs) => {
    const t = xs.sub(lp.x).div(vl.x.add(step(abs(vl.x), 0.02).mul(0.02)));
    const h = lp.add(vl.mul(t.max(0)));
    const back = step(abs(abs(h.z).sub(0.33)), 0.2).mul(step(D.w.sub(0.25), h.y)).mul(step(h.y, D.w.add(0.28)));
    const rest = step(abs(abs(h.z).sub(0.33)), 0.12).mul(step(D.w.add(0.28), h.y)).mul(step(h.y, D.w.add(0.42)));
    return back.add(rest).min(1).mul(step(0.0, t));
  };
  const seats = max(seatPlane(D.y.add(0.05).max(D.z.add(0.3))), seatPlane(D.z.add(-0.25))).mul(isCar);
  const wheelRing = (() => { const t = D.x.sub(0.45).sub(lp.x).div(vl.x.add(step(abs(vl.x), 0.02).mul(0.02))); const h = lp.add(vl.mul(t.max(0))); const r = length(vec2(h.z.sub(0.37), h.y.sub(D.w.add(0.12)))); return step(abs(r.sub(0.17)), 0.018).mul(isCar); })();
  const cabin = mix(vec3(0.012, 0.012, 0.014), vec3(0.05, 0.05, 0.055), seats).add(vec3(0.02).mul(wheelRing));
  const daylight = float(1).sub(U.night.mul(0.85));
  // ---------------- colour
  let base = mix(vc, ic, paint);
  base = mix(base, batten, liv);
  base = mix(base, vec3(0.018), archM);
  base = base.mul(float(1).sub(shut.mul(0.85)));
  base = mix(base, plateCol, plate);
  base = mix(base, vec3(0.02, 0.02, 0.02), on);
  base = mix(base, vec3(0.006), mesh);
  base = mix(base, cabin.mul(daylight), glass.mul(isCar));
  mat.colorNode = base;
  const paintE = paint.mul(float(1).sub(archM));
  const chrome = eqf(part, 13).add(eqf(part, 17)).add(eqf(part, 15));
  mat.roughnessNode = mix(mix(mix(mix(float(0.55), float(0.03), glass), float(0.38), paint), float(0.85), archM), float(0.08), chrome);
  mat.metalnessNode = paintE.mul(0.5).add(chrome.mul(0.95));
  mat.clearcoatNode = paintE;
  // ---------------- lights
  const head = eqf(part, 1), tail = eqf(part, 2), bar = eqf(part, 3), blind = eqf(part, 4), drl = eqf(part, 6);
  const flash = step(0.5, fract(U.t.mul(2.6).add(step(0, lp.z).mul(0.5))));
  mat.emissiveNode = vec3(1, 0.95, 0.85).mul(head).mul(st.y).mul(4)
    .add(vec3(1, 0.05, 0.02).mul(tail).mul(st.y.mul(0.8).add(st.x.mul(3)).add(0.12)))
    .add(vec3(0.85, 0.9, 1).mul(drl).mul(1.2))
    .add(vec3(0.05, 0.2, 1).mul(bar).mul(st.z).mul(flash).mul(8))
    .add(vec3(1, 0.65, 0.05).mul(blind).mul(1.5))
    .add(lightPool(positionWorld).mul(base));
  return mat;
}

// ------------------------------------------------------------------ wheels
// unit wheel: radius 1, axle along z, width 1. Per instance iWheel = (rim radius fraction, design, spin, red calipers)
export function wheelGeometry() {
  const V = (r, y) => new THREE.Vector2(r, y);
  const prof = [V(0.0, -0.4), V(0.25, -0.41), V(0.55, -0.36), V(0.6, -0.5), V(0.84, -0.5), V(0.95, -0.46), V(0.995, -0.33), V(1.0, 0), V(0.995, 0.33),
    V(0.95, 0.46), V(0.84, 0.5), V(0.6, 0.5), V(0.55, 0.36), V(0.25, 0.41), V(0.0, 0.4)];
  const g = new THREE.LatheGeometry(prof, 20);
  g.rotateX(Math.PI / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
export function wheelMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const iw = attribute('iWheel', 'vec4');
  const p = positionGeometry;
  const r = length(p.xy), rim = iw.x, design = floor(iw.y.add(0.5));
  const a = atan(p.y, p.x).div(Math.PI * 2).add(0.5);
  const aw = fract(a.add(iw.z.div(Math.PI * 2)));                 // angle in the non-rotating hub frame
  const face = step(0.3, abs(p.z));
  const nSp = sel(design.lessThan(0.5), float(5), sel(design.lessThan(1.5), float(10), sel(design.lessThan(2.5), float(8), float(5))));
  const sw = sel(design.lessThan(0.5), float(0.36), sel(design.lessThan(1.5), float(0.5), sel(design.lessThan(2.5), float(0.75), float(0.55))));
  const sp = abs(fract(a.mul(nSp)).sub(0.5)).mul(2);              // 0 at spoke centre
  const ySplit = eqf(design, 3).mul(step(abs(sp.sub(0.0)), 0.12)).mul(step(r, rim.mul(0.7)));   // Y-spoke split near the hub
  const spoke = step(sp, sw).mul(float(1).sub(ySplit));
  const inRim = step(r, rim.mul(0.96));
  const gap = inRim.mul(face).mul(step(rim.mul(0.2), r)).mul(float(1).sub(spoke));
  // behind the spokes: brake disc, and a caliper fixed at the rear-top of the hub
  const disc = gap.mul(step(r, rim.mul(0.82)));
  const cal = disc.mul(step(abs(aw.sub(0.62)), 0.06)).mul(step(rim.mul(0.52), r));
  const steel = eqf(design, 2);
  const alloy = mix(vec3(0.6, 0.61, 0.63), vec3(0.42), steel).mul(float(1).sub(step(r, rim.mul(0.12)).mul(0.5)));
  const gapCol = mix(mix(vec3(0.015), vec3(0.18), disc), mix(vec3(0.03), vec3(0.45, 0.02, 0.02), step(0.5, iw.w)), cal);
  const lip = step(rim.mul(0.93), r).mul(inRim);
  const tyre = vec3(0.022).mul(float(1).add(step(0.86, r).mul(step(r, 0.9)).mul(step(0.5, fract(a.mul(36)))).mul(0.6)));
  m.colorNode = mix(tyre, mix(mix(alloy, gapCol, gap), vec3(0.7), lip), inRim);
  m.metalnessNode = inRim.mul(float(1).sub(gap.mul(0.6))).mul(0.85);
  m.roughnessNode = mix(float(0.92), mix(float(0.28), float(0.5), gap), inRim);
  return m;
}
