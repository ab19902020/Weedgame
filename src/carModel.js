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
  float, vec2, vec3, vec4, int, mix, step, smoothstep, positionGeometry, positionWorld, positionLocal, cameraPosition, length, atan, fract, floor, abs, sin, cos,
  attribute, uniformArray, normalize, max, min, select, dot, pow, normalGeometry, normalWorld, Fn,
} from 'three/tsl';
import { worldToView } from './surfaces.js';
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

// lamp, glass and trim layout per model, shared by the geometry (plates, spoilers) and the shader
const layoutCache = new Map();
export function carLayout(def, key) {
  if (layoutCache.has(key)) return layoutCache.get(key);
  const S = CAR_SPECS[key] || CAR_SPECS.hatch, l = def.L / 2, hw = def.W / 2;
  const topF = monotone(S.top.map(([u, y]) => [u * l, y]));
  let Htop = 0; for (let x = -l; x <= l; x += 0.05) Htop = Math.max(Htop, topF(x));
  const thin = !!(S.lightBar || S.wing), tall = !!(S.rails || S.panelVan);
  const hy = Math.max(S.hs + 0.3, topF(l - S.endF * 0.6) - (thin ? 0.05 : 0.075));
  const hlH = thin ? 0.032 : key === 'van' ? 0.075 : key === 'suv' ? 0.055 : 0.048;
  const deck = topF(-l + 0.14);
  const ty = Math.min(S.belt[1] - 0.05, deck - (thin ? 0.06 : 0.09));
  const tlH = thin ? 0.03 : tall ? (key === 'van' ? 0.16 : 0.1) : 0.06;
  const boot = key === 'saloon' || key === 'coupe' ? S.top.find(([u, y]) => u > -0.8 && u < -0.5)?.[0] * l : -99;
  const grY1 = hy - 0.012, grY0 = Math.max(S.hs + 0.22, hy - (key === 'suv' || key === 'van' ? 0.2 : 0.13));
  const Lo = {
    l, hw, hy, hlH, hlZ0: hw - (thin ? 0.4 : 0.42), ty, tlH, tlZ0: S.lightBar ? 0 : hw - (tall ? 0.2 : 0.36), Htop, boot,
    grY0, grY1, grW: hw - 0.47, gstyle: S.wing ? 2 : key === 'suv' || key === 'hothatch' || key === 'coupe' ? 1 : 0,
    pfy: S.wing ? S.hs + 0.24 : Math.max(S.hs + 0.17, grY0 - 0.08), pry: Math.max(S.hs + 0.22, Math.min(ty - tlH - 0.12, 0.66)),
    roofBlack: S.wing || key === 'hothatch' ? 1 : 0, livery: def.livery ? 1 : 0,
  };
  layoutCache.set(key, Lo);
  return Lo;
}

export function buildCar(def, key, modelIndex, lod = 0) {
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
    return hw0 * Math.max(0.64, Math.pow(1 - Math.pow(u, 3.0), 1 / 3.0));
  };
  // stations: cosine spacing + profile breaks + dense around arches
  const xs = new Set();
  const NS = lod ? 10 : 26;
  for (let i = 0; i <= NS; i++) xs.add(+(-l * Math.cos(Math.PI * i / NS)).toFixed(4));
  for (const [u] of S.top) xs.add(+(u * l).toFixed(4));
  for (const c of wheels) for (let k = -4; k <= 4; k += lod ? 2 : 1) xs.add(+(c + k / 4 * (wr + 0.14)).toFixed(4));
  for (const d of S.doors) if (d != null) for (const o of [-0.03, 0.03]) xs.add(+(d + o).toFixed(4));
  const X = [...xs].filter(x => x >= -l && x <= l).sort((a, b) => a - b);
  const K = 13;
  const ring = x => {
    const hw = widthAt(x), y0 = bottomAt(x), yt = Math.max(topF(x), y0 + 0.25), yb = Math.min(beltAt(x), yt - 0.02);
    const gh = clamp01((yt - yb - 0.02) / 0.22), f = flareAt(x);
    const end = clamp01((Math.abs(x) - (l - 0.1)) / 0.1);
    // glasshouse: the side glass leans in (tumblehome), the roof sits ~0.17 m inside the shoulder each side
    const tumble = (0.1 + 0.055 * S.tumble) * gh, roofW = hw - 0.035 - tumble;
    const sh = Math.min(yb - 0.05, lerp(y0, yb, 0.82));
    const half = [
      [y0, hw - 0.13],                                   // 0 underbody edge
      [y0 + 0.05, hw - 0.03],                            // 1 sill turn-under
      [y0 + 0.15, hw - 0.006 + f * 0.5],                 // 2 rocker
      [lerp(y0, yb, 0.42), hw + f],                      // 3 lower door, fullest point
      [lerp(y0 + 0.15, sh, 0.72), hw + f * 0.55 - 0.004],  // 4 door
      [sh, hw + f * 0.2],                                // 5 shoulder crease
      [yb - 0.014, hw - 0.014],                          // 6 shoulder roll-over
      [yb, hw - 0.045],                                  // 7 belt (window seal) / wing top
      [lerp(yb, yt - 0.045, 0.5), lerp(hw - 0.07, hw - 0.045 - tumble * 0.55, gh)],   // 8 side glass
      [yt - lerp(0.035, 0.045, gh), lerp(hw - 0.1, roofW + 0.012, gh)],             // 9 drip rail / bonnet edge
      [yt - lerp(0.016, 0.014, gh), lerp(hw * 0.78, roofW - 0.06, gh)],            // 10 roof / bonnet turn
      [yt - 0.004, lerp(hw * 0.42, roofW * 0.5, gh)],                              // 11 crown
      [yt + 0.002 * (1 - end), 0],                                                 // 12 centre
    ];
    // wheel-arch recesses: lower side points inside the arch circle are pulled in to the inner liner
    const cw = wheels.reduce((a, c) => (Math.abs(x - c) < Math.abs(x - a) ? c : a), wheels[0]);
    for (let k = 0; k <= 4; k++) {
      const d = Math.hypot(x - cw, half[k][0] - wr), m = clamp01((wr + 0.065 - d) / 0.03);
      if (m > 0) half[k] = [half[k][0], lerp(half[k][1], hw - 0.3, m)];
    }
    const r = [];
    for (const [y, w] of half) r.push([x, y, w * (1 - end * 0.035)]);
    for (let k = K - 2; k >= 0; k--) r.push([x, half[k][0], -half[k][1] * (1 - end * 0.035)]);
    return r;
  };
  const R = 2 * K - 1;
  const P = [], I = [], tri = [];
  for (const x of X) for (const v of ring(x)) P.push(...v);
  const triK = [], triCapK = [], mir = k => (k >= K ? 2 * (K - 1) - k : k);
  for (let s = 0; s < X.length - 1; s++) for (let k = 0; k < R; k++) {
    const k1 = (k + 1) % R, a = s * R + k, b = (s + 1) * R + k, c = (s + 1) * R + k1, d = s * R + k1;
    I.push(a, b, c, a, c, d); tri.push([k, s], [k, s]);
    triK.push([mir(k), mir(k), mir(k1)], [mir(k), mir(k1), mir(k1)]); triCapK.push(null, null);
  }
  for (const [s, flip] of [[0, true], [X.length - 1, false]]) {
    let cy = 0; for (let k = 0; k < R; k++) cy += P[(s * R + k) * 3 + 1] / R;
    const c = P.length / 3; P.push(X[s] + (flip ? -0.01 : 0.01), cy, 0);
    for (let k = 0; k < R; k++) { const k1 = (k + 1) % R; if (flip) I.push(c, s * R + k, s * R + k1); else I.push(c, s * R + k1, s * R + k); tri.push([k, -1 - s]); triK.push(null); triCapK.push(flip ? [12, k, k1] : [12, k1, k]); }
  }
  let body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); body.setIndex(I);
  body.computeVertexNormals();
  body = body.toNonIndexed();
  // the whole loft is one part (20); the shader draws glass, pillars, lights, grilles, trim and shut lines
  // per pixel from the model's layout. color carries (section index 0..12 round the ring, end cap, 0)
  const pos = body.attributes.position, nT = pos.count / 3;
  const col = new Float32Array(pos.count * 3), vd = new Float32Array(pos.count * 4);
  const mirror = k => (k >= K ? 2 * (K - 1) - k : k);
  for (let t = 0; t < nT; t++) {
    const [k, s] = tri[t];
    for (let j = 0; j < 3; j++) {
      const v = t * 3 + j;
      col.set([s >= 0 ? triK[t][j] : mirror(triCapK[t][j]), s >= 0 ? 0 : 1, 0], v * 3);
      vd.set([1, 20, 0, modelIndex], v * 4);
    }
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.setAttribute('vdat', new THREE.BufferAttribute(vd, 4));
  const parts = new Parts(); parts.list.push(body);
  // ---------------- details
  const noseY = topF(l - 0.02), tailY = topF(-l + 0.02);
  const zH = hw0 - 0.26 - (S.endF > 0.5 ? 0.03 : 0);
  const xNose = x => l - (1 - Math.pow(Math.max(0, 1 - Math.pow(clamp01(Math.abs(x) / (hw0 * 1.0)), 3.0)), 1 / 3.0)) * S.endF;   // x of the nose surface at lateral offset
  const xTail = z => -l + (1 - Math.pow(Math.max(0, 1 - Math.pow(clamp01(Math.abs(z) / hw0), 3.0)), 1 / 3.0)) * S.endR;
  const LO = carLayout(def, key), hy = LO.hy;
  if (lod) {
    // distant cars: the body (lights, glass and trim are drawn by the shader) and plates
    const pf = new THREE.BoxGeometry(0.015, 0.111, 0.52); pf.translate(xNose(0) + 0.004, LO.pfy, 0); parts.add(pf, 10, 0, [LO.pfy, 0, 0]);
    const pr = new THREE.BoxGeometry(0.015, 0.111, 0.52); pr.translate(xTail(0) - 0.004, LO.pry, 0); parts.add(pr, 11, 0, [LO.pry, 0, 0]);
    if (def.livery) { const g = new THREE.BoxGeometry(0.35, 0.1, 1.2); g.translate(-0.25, H + 0.05, 0); parts.add(g, 3, 0, [0.1, 0.1, 0.12]); }
    return { parts: parts.list, spec: S, wheels };
  }
  for (const sd of [-1, 1]) {
    // wing mirror: stalk, body-colour housing, glass facing back
    const mx = S.ws0 - 0.08, my = beltAt(mx) + 0.07, mz = sd * (widthAt(mx) + 0.06);
    const stalk = new THREE.BoxGeometry(0.05, 0.025, 0.09); stalk.translate(mx, my - 0.02, sd * (widthAt(mx) + 0.02)); parts.add(stalk, 16, 0);
    const hous = new THREE.SphereGeometry(1, 12, 8); hous.scale(0.075, 0.06, 0.1); hous.translate(mx, my, mz); parts.add(hous, 0, 1);
    const mg = new THREE.BoxGeometry(0.005, 0.085, 0.15); mg.translate(mx - 0.068, my, mz); parts.add(mg, 15, 0, [0.4, 0.42, 0.45]);
    // door handles (near the rear edge of each door)
    const handles = S.doors[1] != null ? [S.doors[1] + 0.13, S.doors[2] + 0.13] : [S.doors[2] + 0.16];
    for (const x of handles) { const g = new THREE.BoxGeometry(0.14, 0.022, 0.02); g.translate(x, beltAt(x) - 0.075, sd * (widthAt(x) + 0.002)); parts.add(g, S.wheel === 3 ? 13 : 0, S.wheel === 3 ? 0 : 1, [0.6, 0.6, 0.62]); }
    const sillLength = Math.min(L*.48,S.doors[0]-S.gl[1]);
    const sillX = S.doors[0]-sillLength*.5;
    const moulding = new THREE.BoxGeometry(sillLength,.036,.027);
    moulding.translate(sillX,S.hs+.15,sd*(widthAt(sillX)-.012));
    parts.add(moulding,16,0,[.078,.082,.084]);
    // roof rails
    if (S.rails) { const len = S.ws1 - S.rr0 - 0.2, g = new THREE.BoxGeometry(len, 0.03, 0.03); g.translate((S.ws1 + S.rr0) / 2, topF((S.ws1 + S.rr0) / 2) + 0.03, sd * hw0 * 0.62); parts.add(g, 16, 0, [0.05, 0.05, 0.05]); }
  }
  // number plates: front white, rear yellow (520 x 111 mm)
  const pfy = LO.pfy, pry = LO.pry;
  const pf = new THREE.BoxGeometry(0.015, 0.111, 0.52); pf.translate(xNose(0) + 0.004, pfy, 0); parts.add(pf, 10, 0, [pfy, 0, 0]);
  const pr = new THREE.BoxGeometry(0.015, 0.111, 0.52); pr.translate(xTail(0) - 0.004, pry, 0); parts.add(pr, 11, 0, [pry, 0, 0]);
  // wipers at the windscreen base, shark-fin aerial
  for (const z of [-0.05, 0.42]) { const g = new THREE.BoxGeometry(0.02, 0.012, 0.55); g.rotateY(0.18); g.translate(S.ws0 - 0.06, topF(S.ws0 - 0.06) + 0.012, z); parts.add(g, 16, 0, [0.02, 0.02, 0.02]); }
  { const g = new THREE.ConeGeometry(0.03, 0.06, 6); g.scale(2.2, 1, 0.6); g.translate(S.rr0 + 0.25, topF(S.rr0 + 0.25) + 0.03, 0); parts.add(g, 16, 0, [0.02, 0.02, 0.02]); }
  // spoilers and wings
  if (S.spoiler === 'roof') { const g = new THREE.BoxGeometry(0.22, 0.03, W * 0.8); g.rotateZ(-0.18); g.translate(S.rr0 - 0.02, topF(S.rr0) - 0.005, 0); parts.add(g, 0, 1); }
  if (S.wing) {
    const deck = topF(-l + 0.3);
    const g = new THREE.BoxGeometry(0.26, 0.02, W * 0.84); g.rotateZ(-0.06); g.translate(-l + 0.22, deck + 0.17, 0); parts.add(g, 16, 0, [0.02, 0.02, 0.02]);
    for (const sd of [-1, 1]) { const p = new THREE.BoxGeometry(0.1, 0.18, 0.02); p.translate(-l + 0.28, deck + 0.075, sd * W * 0.28); parts.add(p, 16, 0, [0.02, 0.02, 0.02]); }
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
    // RHD instruments sit just behind the binnacle face, towards the driver.
    for (const z of [.29,.45]) {
      const dial = new THREE.CylinderGeometry(.054,.054,.016,16).rotateZ(Math.PI/2);
      parts.add(dial.translate(S.ws0-.714,sc+.018,z),0,0,[.12,.15,.17]);
      const pointer = new THREE.BoxGeometry(.01,.043,.008).rotateX(z>.4?.52:-.64);
      parts.add(pointer.translate(S.ws0-.726,sc+.03,z),0,0,[.93,.49,.22]);
    }
    const centre = new THREE.BoxGeometry(.04,.13,.26);
    parts.add(centre.translate(S.ws0-.642,sc-.095,0),0,0,[.065,.13,.16]);
    for (const z of [-iw*.76,iw*.76]) {
      const vent = new THREE.BoxGeometry(.025,.065,.14);
      parts.add(vent.translate(S.ws0-.635,sc-.11,z),0,0,[.012,.019,.023]);
    }
    const tunnel = new THREE.BoxGeometry(.57,.20,.18);
    parts.add(tunnel.translate(S.ws0-.88,fl+.12,0),0,0,[.052,.055,.059]);
    const sw = new THREE.TorusGeometry(0.18, 0.02, 6, 20); sw.rotateY(Math.PI / 2); sw.rotateZ(0.42); sw.translate(S.ws0 - 0.78, sc - 0.06, 0.37); parts.add(sw, 16, 0, [0.02, 0.02, 0.02]);
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10); hub.rotateZ(Math.PI / 2 - 0.42); hub.translate(S.ws0 - 0.78, sc - 0.06, 0.37); parts.add(hub, 16, 0, [0.03, 0.03, 0.03]);
    const seatX = Math.max(S.ws0 - 1.35, S.rr0 + 0.32), headTop = topF(seatX - 0.2) - 0.07;
    for (const z of [0.37, -0.37]) {
      const base = new THREE.BoxGeometry(0.5, 0.12, 0.46); base.translate(seatX + 0.1, fl + 0.2, z); parts.add(base, 16, 0, [0.05, 0.05, 0.055]);
      const back = new THREE.BoxGeometry(0.12, 0.62, 0.46); back.rotateZ(0.22); back.translate(seatX - 0.17, fl + 0.55, z); parts.add(back, 16, 0, [0.05, 0.05, 0.055]);
      const rest = new THREE.BoxGeometry(0.1, 0.16, 0.26); rest.rotateZ(0.22); rest.translate(seatX - 0.25, Math.min(fl + 0.95, headTop - 0.08), z); parts.add(rest, 16, 0, [0.06, 0.06, 0.065]);
    }
  }
  return { parts: parts.list, spec: S, wheels };
}

// ------------------------------------------------------------------ materials
const sel = (c, a, b) => select(c, a, b).uniformFlow().toVar();
const eqf = (a, k) => step(k - 0.5, a).mul(step(a, k + 0.5));
const rotY = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };

const clamp01n = v => v.clamp(0, 1);
const bitf = (v, k) => step(0.5, fract(floor(v.div(2 ** k)).mul(0.5)));
const band = (v, a, b) => step(a, v).mul(step(v, b));
// cheap value noise from a hash of the model-space position (dents, dirt, scratches)
const hash3 = p => fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
const vnoise = p => { const i = floor(p), f = fract(p), u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const n = (o) => hash3(i.add(o));
  const x0 = mix(mix(n(vec3(0, 0, 0)), n(vec3(1, 0, 0)), u.x), mix(n(vec3(0, 1, 0)), n(vec3(1, 1, 0)), u.x), u.y);
  const x1 = mix(mix(n(vec3(0, 0, 1)), n(vec3(1, 0, 1)), u.x), mix(n(vec3(0, 1, 1)), n(vec3(1, 1, 1)), u.x), u.y);
  return mix(x0, x1, u.z); };

// models: ordered list of [key, def] matching vdat.w (index + 1)
// Per-instance: iPaint (rgb), iState (x flags: 1 brake, 2 reversing, 4 left indicator, 8 right, 16 hazards;
// y lights, z siren, w heading), iDmg (front, rear, left -z, right +z damage 0..1).
export function vehicleMaterial(models) {
  const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.35, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const vd = attribute('vdat', 'vec4'), vc = attribute('color', 'vec3'), paint = vd.x, part = vd.y, liv = vd.z;
  const ic = attribute('iPaint', 'vec3');
  const st = attribute('iState', 'vec4');
  const dm4 = attribute('iDmg', 'vec4');
  const lp = positionGeometry, nm = normalGeometry;   // model space (positionLocal is instance-transformed)
  const spec = k => CAR_SPECS[k] || null;
  const lay = models.map(([k, def]) => spec(k) ? carLayout(def, k) : null);
  const V = (a, b, c, d) => new THREE.Vector4(a, b, c, d);
  const arr = (f, d) => uniformArray([d, ...models.map(([k, def], i) => (lay[i] ? f(lay[i], spec(k), def, k) : d))], 'vec4').element(int(vd.w.add(0.5)));
  const A = arr((Lo, S, d) => V(d.wb / 2, d.wr, d.W / 2, (S.wheelX || 0) * d.L / 2), V(0, 0, 0, 0));
  const D = arr((Lo, S) => V(S.doors[0], S.doors[1] ?? -99, S.doors[2] ?? -99, (S.belt[0] + S.belt[1]) / 2), V(-99, -99, -99, 1));
  const E = arr((Lo, S) => V(Lo.l, Lo.hw, S.hs, S.endF), V(9, 9, 0, 0.4));
  const F = arr((Lo, S) => V(S.ws0, S.ws1, S.rr0, Lo.Htop), V(0, 0, 0, 9));
  const Gd = arr((Lo, S) => V(S.gl[0], S.gl[1], Lo.boot, S.endR), V(0, 0, -99, 0.4));
  const BL = arr((Lo, S) => V(S.belt[0], S.belt[1], S.panelVan ? 1 : 0, S.cladding ? 1 : 0), V(1, 1, 0, 0));
  const HL = arr(Lo => V(Lo.hy, Lo.hlH, Lo.hlZ0, Lo.roofBlack), V(-9, 0, 9, 0));
  const TL = arr(Lo => V(Lo.ty, Lo.tlH, Lo.tlZ0, Lo.livery), V(-9, 0, 9, 0));
  const GR = arr(Lo => V(Lo.grY0, Lo.grY1, Lo.grW, Lo.gstyle), V(-9, -9, 0, 0));
  const isCar = step(0.01, A.x);
  const loft = eqf(part, 20).mul(isCar);
  const x = lp.x, y = lp.y, z = lp.z, az = abs(z), kq = vc.x, cap = vc.y.mul(loft);
  const l = E.x, hw = E.y, hs = E.z;
  const front = step(0, x), rear = float(1).sub(front);
  const belt = mix(BL.y, BL.x, clamp01n(x.add(l).div(l.mul(2))));
  // ---------------- damage zones (front, rear, left, right)
  const wF = smoothstep(l.sub(1.1), l, x), wR = smoothstep(l.negate().add(1.1), l.negate(), x);
  const wL = smoothstep(hw.negate().add(0.42), hw.negate(), z), wRt = smoothstep(hw.sub(0.42), hw, z);
  const dmg = clamp01n(dm4.x.mul(wF).add(dm4.y.mul(wR)).add(dm4.z.mul(wL)).add(dm4.w.mul(wRt))).mul(isCar);
  const dn = vnoise(lp.mul(7.3)), dn2 = vnoise(lp.mul(23.1).add(5.2));
  // crumple: ends shorten, sides push in, panels buckle (world-space offset from the yaw: instancing runs first)
  mat.positionNode = Fn(() => {
    const p = positionGeometry, n0 = vnoise(p.mul(7.3)), n1 = vnoise(p.mul(3.1).add(9.1));
    const zf = smoothstep(l.sub(1.1), l, p.x), zr = smoothstep(l.negate().add(1.1), l.negate(), p.x);
    const zl = smoothstep(hw.negate().add(0.42), hw.negate(), p.z), zrt = smoothstep(hw.sub(0.42), hw, p.z);
    const k = isCar.mul(float(0.55).add(n1.mul(0.9)));
    const dx = dm4.y.mul(zr.mul(zr)).mul(0.3).sub(dm4.x.mul(zf.mul(zf)).mul(0.34)).mul(k);
    const dz = dm4.z.mul(zl).mul(0.13).sub(dm4.w.mul(zrt).mul(0.13)).mul(k);
    const dy = dm4.x.mul(zf).add(dm4.y.mul(zr)).mul(n0.sub(0.35)).mul(0.07).mul(isCar);
    const h = st.w, c = cos(h), s = sin(h);
    return positionLocal.add(vec3(dx.mul(c).sub(dz.mul(s)), dy, dx.mul(s).add(dz.mul(c))));
  })();
  // ---------------- side glass with pillars and a black surround
  const tG = clamp01n(kq.sub(7).div(2));
  const xF = mix(Gd.x, F.y.add(0.1), tG), xR = mix(Gd.y, F.z.add(0.16), tG);
  const inK = band(kq, 7.14, 8.8).mul(float(1).sub(cap));
  const bp = step(abs(x.sub(D.y)), 0.048).mul(step(-50, D.y));
  const vanBack = BL.z.mul(step(x, D.y.add(0.04)));
  const sideGlass = loft.mul(inK).mul(step(xR.add(0.03), x)).mul(step(x, xF.sub(0.03))).mul(float(1).sub(bp)).mul(float(1).sub(vanBack));
  const dloTrim = loft.mul(band(kq, 6.92, 9.0)).mul(float(1).sub(cap)).mul(step(xR.sub(0.005), x)).mul(step(x, xF.add(0.012))).mul(float(1).sub(sideGlass)).mul(float(1).sub(vanBack));
  // windscreen and rear screen (black frit at the edges)
  const wsc = loft.mul(float(1).sub(cap)).mul(step(F.y.add(0.03), x)).mul(step(x, F.x.sub(0.02))).mul(step(8.75, kq)).mul(step(0.12, nm.x));
  const frit = wsc.mul(float(1).sub(step(F.y.add(0.075), x).mul(step(x, F.x.sub(0.06))).mul(step(9.1, kq))));
  const rearGl = loft.mul(step(belt.add(0.045), y)).mul(step(y, F.w.sub(0.065))).mul(step(nm.x, -0.22)).mul(step(x, F.z.add(0.04)))
    .mul(step(az, hw.sub(0.13))).mul(step(Gd.z.add(0.04), x)).mul(float(1).sub(BL.z.mul(0.0)));
  const rearFrit = rearGl.mul(float(1).sub(step(az, hw.sub(0.19)).mul(step(belt.add(0.09), y)).mul(step(y, F.w.sub(0.11)))));
  const glassL = clamp01n(sideGlass.add(wsc).add(rearGl));
  // ---------------- lamps
  const hlTop = HL.x.add(HL.y).sub(hw.sub(az).mul(0.07));
  const inHL = loft.mul(front).mul(step(HL.z, az)).mul(step(az, hw.mul(0.992))).mul(step(HL.x.sub(HL.y), y)).mul(step(y, hlTop)).mul(step(0.1, nm.x)).mul(step(l.sub(E.w).sub(0.12), x));
  const uz = clamp01n(az.sub(HL.z).div(hw.sub(HL.z)));
  const bowl = (c) => step(length(vec2(uz.sub(c).mul(hw.sub(HL.z)), y.sub(HL.x).add(0.004))), HL.y.mul(0.62));
  const bowls = max(bowl(0.33), bowl(0.68));
  const drl = step(y, HL.x.sub(HL.y).add(0.013)).mul(step(0.08, uz));
  const indF = step(0.88, uz);
  const inTL = loft.mul(rear).mul(step(TL.z, az)).mul(step(az, hw.mul(0.992))).mul(step(TL.x.sub(TL.y), y)).mul(step(y, TL.x.add(TL.y))).mul(step(nm.x, -0.1)).mul(step(x, l.negate().add(Gd.w).add(0.16)));
  const tu = clamp01n(az.sub(TL.z).div(hw.sub(TL.z).max(0.05)));
  const revL = step(tu, 0.2).mul(step(0.05, TL.z)).add(step(TL.z, 0.05).mul(step(az, 0.12)));
  const indR = step(0.82, tu).mul(step(TL.x.add(TL.y.mul(0.2)), y));
  const ledBars = step(0.5, fract(y.sub(TL.x).div(0.014)));
  // ---------------- front and rear faces: grille, intakes, splitter, diffuser, badges, fog lamps
  const frontFace = loft.mul(front).mul(step(0.5, nm.x));
  const rearFace = loft.mul(rear).mul(step(nm.x, -0.5));
  const grille = frontFace.mul(step(az, GR.z)).mul(band(y, GR.x, GR.y)).mul(step(GR.w, 1.5));
  const intakeTop = hs.add(mix(float(0.16), float(0.26), step(1.5, GR.w)));
  const intake = frontFace.mul(step(az, hw.mul(0.74))).mul(band(y, hs.add(0.065), intakeTop));
  const fog = frontFace.mul(step(length(vec2(az.sub(hw.mul(0.8)), y.sub(hs.add(0.12)))), 0.038)).mul(step(GR.w, 1.5));
  const splitter = loft.mul(front).mul(step(y, hs.add(0.045))).mul(step(l.sub(0.4), x));
  const diffuser = loft.mul(rear).mul(step(y, hs.add(0.12))).mul(step(x, l.negate().add(0.32)));
  const gy = GR.x.add(GR.y).mul(0.5);
  const badgeF = frontFace.mul(step(length(vec2(z, y.sub(gy).mul(1.5))), 0.038));
  const badgeR = rearFace.mul(step(length(vec2(z, y.sub(TL.x.add(0.05)).mul(1.5))), 0.034));
  const slats = step(0.55, fract(y.div(0.018)));
  const meshP = step(0.5, fract(y.mul(38).add(step(0.5, fract(z.mul(19))).mul(0.5)))).mul(step(0.25, fract(z.mul(38))));
  const gpat = mix(slats, meshP, step(0.5, GR.w));
  // ---------------- trims and shut lines
  const sill = loft.mul(step(kq, 1.6)).mul(float(1).sub(cap));
  const clad = loft.mul(BL.w).mul(step(kq, 3.4)).mul(step(y, hs.add(0.25))).mul(float(1).sub(cap));
  const seal = loft.mul(band(kq, 6.7, 7.14)).mul(float(1).sub(cap)).mul(step(xR.sub(0.01), x)).mul(step(x, xF.add(0.02)));
  const roofBlk = loft.mul(HL.w).mul(step(9.0, kq)).mul(float(1).sub(cap)).mul(step(F.z, x)).mul(step(x, F.y.add(0.02)));
  const ln = (v, c) => step(abs(v.sub(c)), 0.0042);
  const sideFace = step(0.5, abs(nm.z)), topFace = step(0.55, nm.y);
  const inDoorY = band(y, hs.add(0.1), belt.add(0.01));
  const doors = ln(x, D.x).add(ln(x, D.y)).add(ln(x, D.z)).min(1).mul(inDoorY).mul(sideFace);
  const bonnet = topFace.mul(front).mul(step(F.x.add(0.04), x)).mul(step(x, l.sub(0.04))).mul(ln(az, hw.sub(0.115)));
  const bumpF = sideFace.mul(ln(x, l.sub(E.w).sub(0.14))).mul(step(y, HL.x.sub(HL.y).sub(0.01)));
  const bumpR = sideFace.mul(ln(x, l.negate().add(Gd.w).add(0.18))).mul(step(y, TL.x.sub(TL.y).sub(0.01)));
  const tailgate = rearFace.mul(step(Gd.z, -50)).mul(ln(az, hw.mul(0.64))).mul(step(TL.x.sub(TL.y).sub(0.04), y));
  const bumperTop = rearFace.mul(ln(y, TL.x.sub(TL.y).sub(0.045)));
  const bootLid = topFace.mul(rear).mul(step(-50, Gd.z)).mul(step(x, Gd.z)).mul(ln(az, hw.sub(0.12)));
  const fuel = sideFace.mul(step(0, z)).mul(ln(length(vec2(x.sub(l.negate().add(Gd.w).add(0.5)), y.sub(belt.sub(0.13)))), 0.085));
  const shut = loft.mul(clamp01n(doors.add(bonnet).add(bumpF).add(bumpR).add(tailgate).add(bumperTop).add(bootLid).add(fuel))).mul(float(1).sub(glassL));
  const repeater = loft.mul(sideFace).mul(step(abs(x.sub(l.sub(E.w).sub(0.32))), 0.028)).mul(step(abs(y.sub(HL.x)), 0.011));
  // wheel-arch liners, cut per pixel
  const ax = abs(x.sub(A.w));
  const archD = length(vec2(abs(ax.sub(A.x)), y.sub(A.y)));
  const archM = isCar.mul(step(A.z.sub(0.3), az)).mul(smoothstep(A.y.add(0.078), A.y.add(0.064), archD));
  const archLip = loft.mul(BL.w).mul(step(A.z.sub(0.3), az)).mul(smoothstep(A.y.add(0.14), A.y.add(0.12), archD)).mul(float(1).sub(archM));
  // Battenburg livery
  const checker = step(0.5, fract(x.div(0.62).add(step(0.72, y).mul(0.5))));
  const batten = mix(vec3(0.85, 0.82, 0.05), vec3(0.04, 0.1, 0.55), checker);
  // number plates: 3x5 pixel glyphs from a per-car hash (UK layout AB12 CDE); vc.x carries the plate centre height
  const plate = eqf(part, 10).add(eqf(part, 11));
  const pu = z.add(0.26).div(0.52), pvv = y.sub(vc.x.sub(0.0555)).div(0.111);
  const cell = floor(pu.mul(8.5)), cu = fract(pu.mul(8.5)), gap = eqf(cell, 4);
  const seed = fract(sin(dot(ic.xy.add(vec2(vd.w, ic.z)), vec2(12.9898, 78.233))).mul(43758.5453));
  const glyphBits = floor(fract(sin(cell.mul(17.13).add(seed.mul(91.7))).mul(43758.5453)).mul(32768));
  const px = floor(cu.mul(4)), py = floor(pvv.mul(7));
  const bitI = px.add(py.sub(1).mul(3)).max(0);
  const on = step(0.5, fract(floor(glyphBits.div(pow(float(2), bitI))).mul(0.5))).mul(step(px, 2.5)).mul(step(0.5, py)).mul(step(py, 5.5)).mul(float(1).sub(gap)).mul(step(0.04, pu)).mul(step(pu, 0.96)).mul(plate);
  const plateCol = mix(vec3(0.85, 0.85, 0.83), vec3(0.88, 0.7, 0.04), eqf(part, 11));
  // glass: dark tinted, a faint cabin behind (seat backs, headrests) from a parallax ray
  const glassPart = eqf(part, 14).add(glassL).min(1);
  const vw = normalize(positionWorld.sub(cameraPosition));
  const vl = rotY(vw, st.w);
  const seatPlane = (xs) => {
    const t = xs.sub(x).div(vl.x.add(step(abs(vl.x), 0.02).mul(0.02)));
    const hh = lp.add(vl.mul(t.max(0)));
    const back = step(abs(abs(hh.z).sub(0.33)), 0.2).mul(step(D.w.sub(0.25), hh.y)).mul(step(hh.y, D.w.add(0.28)));
    const rest = step(abs(abs(hh.z).sub(0.33)), 0.12).mul(step(D.w.add(0.28), hh.y)).mul(step(hh.y, D.w.add(0.42)));
    return back.add(rest).min(1).mul(step(0.0, t));
  };
  const seats = max(seatPlane(D.y.add(0.05).max(D.z.add(0.3))), seatPlane(D.z.add(-0.25))).mul(isCar);
  const cabin = mix(vec3(0.007, 0.008, 0.01), vec3(0.016, 0.016, 0.018), seats).mul(float(0.8).add(y.sub(D.w).mul(0.8)).clamp(0.6, 1.4));
  const daylight = float(1).sub(U.night.mul(0.85));
  // ---------------- state
  const flags = floor(st.x.add(0.5));
  const brake = bitf(flags, 0), reversing = bitf(flags, 1), hazard = bitf(flags, 4);
  const blink = step(0.5, fract(U.t.mul(1.5)));
  const indOn = mix(bitf(flags, 3), bitf(flags, 2), step(z, 0)).add(hazard).min(1).mul(blink);
  const hlBroken = smoothstep(0.38, 0.6, dm4.x.add(mix(dm4.w, dm4.z, step(z, 0)).mul(0.5)));
  const tlBroken = smoothstep(0.38, 0.6, dm4.y.add(mix(dm4.w, dm4.z, step(z, 0)).mul(0.5)));
  // ---------------- colour
  let base = mix(vc, ic, paint);
  // police: Battenburg checks along the sides below the windows
  const livL = loft.mul(TL.w).mul(step(0.5, abs(nm.z))).mul(band(y, hs.add(0.17), belt.sub(0.035)));
  base = mix(base, batten, clamp01n(liv.add(livL)));
  const blackPl = vec3(0.028, 0.028, 0.03), glossBlk = vec3(0.012), chrome = vec3(0.72, 0.73, 0.75);
  base = mix(base, blackPl, clamp01n(sill.add(clad).add(archLip).add(splitter).add(diffuser).add(intake).add(seal)));
  base = mix(base, glossBlk, clamp01n(dloTrim.add(roofBlk).add(frit).add(rearFrit)));
  base = mix(base, vec3(0.015), archM);
  base = base.mul(float(1).sub(shut.mul(0.82)));
  base = mix(base, mix(vec3(0.01), vec3(0.06), gpat), grille);
  base = mix(base, vec3(0.006), intake.mul(step(0.5, fract(y.mul(40)))));
  base = mix(base, chrome, clamp01n(badgeF.add(badgeR).add(fog)));
  // headlight: dark chrome housing, two reflector bowls, LED strip, amber indicator
  const hlCol = mix(mix(vec3(0.06, 0.065, 0.07), chrome, bowls), vec3(0.85), drl);
  base = mix(base, mix(mix(hlCol, vec3(0.5, 0.28, 0.04), indF), vec3(0.05), hlBroken.mul(step(0.5, dn2))), inHL);
  base = mix(base, vec3(0.6, 0.35, 0.04), repeater);
  // tail light: red lens over LED bars, clear reversing section, amber indicator
  const tlCol = mix(mix(vec3(0.22, 0.012, 0.01), vec3(0.32, 0.02, 0.015), ledBars), vec3(0.55), revL);
  base = mix(base, mix(mix(tlCol, vec3(0.45, 0.22, 0.03), indR.mul(float(1).sub(revL))), vec3(0.05), tlBroken.mul(step(0.5, dn2))), inTL);
  base = mix(base, plateCol, plate);
  base = mix(base, vec3(0.02, 0.02, 0.02), on);
  // glass, cracked where the zone is smashed
  const crack = step(0.985, abs(sin(atan(y.sub(D.w), z.add(x.mul(0.3))).mul(13).add(dn.mul(3))))).add(step(0.99, abs(sin(length(vec2(x, y.sub(D.w))).mul(70).add(dn.mul(6)))))).min(1).mul(smoothstep(0.45, 0.7, dmg));
  base = mix(base, mix(cabin.mul(daylight), vec3(0.2, 0.21, 0.22), crack), glassPart.mul(isCar));
  // buses: window pillars every ~1.2 m and a rubber frame along the glass bands
  const busGl = eqf(part, 14).mul(float(1).sub(isCar)).mul(step(0.5, abs(nm.z)));
  const pillar = step(fract(x.div(1.22).add(0.5)), 0.07);
  base = mix(base, vec3(0.012), busGl.mul(pillar));
  // road grime low on the body, heavier in the wet
  const paintArea = paint.mul(float(1).sub(glassPart)).mul(isCar);
  const grime = smoothstep(hs.add(0.42), hs, y).mul(float(0.18).add(U.wet.mul(0.3))).mul(dn.mul(0.6).add(0.4)).mul(paintArea);
  base = mix(base, vec3(0.16, 0.14, 0.12), grime);
  // damage: dents shade the paint, scratches show primer and bare metal
  const dent = vnoise(lp.mul(3.2).add(1.7));
  const scratch = step(0.8, vnoise(vec3(x.mul(2.5), y.mul(70), z.mul(2.5)))).mul(step(0.45, dent)).mul(smoothstep(0.1, 0.4, dmg)).mul(paintArea);
  base = base.mul(float(1).sub(dmg.mul(smoothstep(0.45, 0.9, dent)).mul(0.35).mul(paintArea)));
  base = mix(base, mix(vec3(0.42, 0.42, 0.4), vec3(0.62), step(0.5, dn2)), scratch);
  // Reflected sky on upward-facing clearcoat and a soft rocker-panel shadow anchor the body.
  const rocker=smoothstep(.26,.88,y).mul(.12).add(.88);
  base=base.mul(mix(float(1),rocker,paintArea));
  mat.colorNode = base;
  // ---------------- surface response
  const lens = clamp01n(inHL.add(inTL).add(glassPart));
  const chromeM = clamp01n(eqf(part, 13).add(eqf(part, 17)).add(eqf(part, 15)).add(badgeF).add(badgeR).add(fog).add(inHL.mul(bowls)));
  const plastic = clamp01n(sill.add(clad).add(archLip).add(splitter).add(diffuser).add(intake).add(grille).add(seal));
  const paintE = paint.mul(float(1).sub(archM)).mul(float(1).sub(plastic)).mul(float(1).sub(lens));
  let rough = mix(float(0.55), float(0.45), paint);   // paint gloss lives in the clearcoat (keeps SSR off the paint)
  rough = mix(rough, float(0.62), plastic);
  rough = mix(rough, float(0.12), clamp01n(dloTrim.add(roofBlk)));
  rough = mix(rough, float(0.85), archM);
  rough = mix(rough, float(0.06), chromeM);
  rough = mix(rough, float(0.055), lens);
  rough = mix(rough, float(0.7), scratch.add(grime.mul(1.5)).min(1));
  rough = mix(rough, float(0.12), U.wet.mul(paintE).mul(0.6));
  mat.roughnessNode = rough;
  mat.metalnessNode = paintE.mul(0.45).mul(float(1).sub(dmg.mul(0.5))).add(chromeM.mul(0.95)).add(scratch.mul(step(0.5, dn2)).mul(0.6)).min(1);
  mat.clearcoatNode = paintE.mul(float(1).sub(dmg.mul(0.8))).add(lens.mul(0.8)).add(dloTrim.mul(0.7)).min(1);
  mat.clearcoatRoughnessNode = mix(float(0.04), float(0.5), dmg.add(grime).min(1));
  // dents and crumples bend the reflections
  const dg = vec3(vnoise(lp.mul(3.6)).sub(0.5), vnoise(lp.mul(3.3).add(3.3)).sub(0.5), vnoise(lp.mul(3.9).add(7.7)).sub(0.5));
  mat.normalNode = worldToView(normalize(normalWorld.add(dg.mul(dmg.mul(0.75)))));
  // ---------------- lights
  const head = eqf(part, 1), tail = eqf(part, 2), bar = eqf(part, 3), blind = eqf(part, 4);
  const flash = step(0.5, fract(U.t.mul(2.6).add(step(0, z).mul(0.5))));
  const hlOK = float(1).sub(hlBroken), tlOK = float(1).sub(tlBroken);
  const beam = inHL.mul(bowls.mul(0.8).add(0.2)).mul(st.y).mul(5).mul(hlOK).mul(float(1).sub(indF));
  const drlE = inHL.mul(drl).mul(float(1).sub(indF)).mul(1.6).mul(hlOK);
  const tailE = inTL.mul(float(1).sub(revL)).mul(float(1).sub(indR)).mul(st.y.mul(0.9).add(brake.mul(3.2)).add(0.06)).mul(ledBars.mul(0.5).add(0.5)).mul(tlOK);
  const revE = inTL.mul(revL).mul(reversing).mul(2.5).mul(tlOK);
  const indE = clamp01n(inHL.mul(indF).add(inTL.mul(indR)).add(repeater)).mul(indOn).mul(4);
  mat.emissiveNode = vec3(1, 0.95, 0.85).mul(head).mul(st.y).mul(4)
    .add(vec3(1, 0.05, 0.02).mul(tail).mul(st.y.mul(0.8).add(brake.mul(3)).add(0.12)))
    .add(vec3(1, 0.96, 0.9).mul(beam)).add(vec3(0.85, 0.9, 1).mul(drlE))
    .add(vec3(1, 0.04, 0.02).mul(tailE)).add(vec3(1, 0.98, 0.95).mul(revE)).add(vec3(1, 0.5, 0.05).mul(indE))
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
  const nSp = sel(design.greaterThan(3.5),float(28),sel(design.lessThan(0.5), float(5), sel(design.lessThan(1.5), float(10), sel(design.lessThan(2.5), float(8), float(5)))));
  const sw = sel(design.greaterThan(3.5),float(.18),sel(design.lessThan(0.5), float(0.36), sel(design.lessThan(1.5), float(0.5), sel(design.lessThan(2.5), float(0.75), float(0.55)))));
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
  const tyre = vec3(0.022).mul(float(1).add(eqf(design,4).mul(step(.85,r)).mul(step(.52,fract(a.mul(42)))).mul(.40))).mul(float(1).add(step(0.86, r).mul(step(r, 0.9)).mul(step(0.5, fract(a.mul(36)))).mul(0.6)));
  m.colorNode = mix(tyre, mix(mix(alloy, gapCol, gap), vec3(0.7), lip), inRim);
  m.metalnessNode = inRim.mul(float(1).sub(gap.mul(0.6))).mul(0.85);
  m.roughnessNode = mix(float(0.92), mix(float(0.28), float(0.5), gap), inRim);
  return m;
}
