// Lofted car bodies and alloy wheels for vehicles.js. The side profile still comes from
// vehicles.js profile(); here it is swept through rounded cross-sections (tumblehome glasshouse,
// shoulder line, tucked sills) and rounded in plan at the corners, with smooth normals.
import * as THREE from 'three/webgpu';
import { float, vec3, mix, step, positionLocal, length, atan, fract, abs, smoothstep, attribute } from 'three/tsl';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.max(0, Math.min(1, v));

// upper chain of the side profile (first and last points are the bottom corners)
function topAt(pts, x) {
  const ch = pts.slice(1, -1);
  if (x <= ch[0][0]) return ch[0][1];
  for (let i = 1; i < ch.length; i++) {
    const [x0, y0] = ch[i - 1], [x1, y1] = ch[i];
    if (x <= x1) return x1 - x0 < 1e-6 ? Math.max(y0, y1) : lerp(y0, y1, (x - x0) / (x1 - x0));
  }
  return ch[ch.length - 1][1];
}

export function loftBody(def, pts, belt) {
  const { L, W } = def, l = L / 2, hw0 = W / 2;
  const bot = pts[0][1];
  const tumble = def.prof === 'van' ? 0.35 : def.prof === 'suv' ? 0.75 : 1;
  // stations: cosine-spaced plus the profile's own break points (keeps the screen base crisp)
  const xs = new Set();
  const NS = 34;
  for (let i = 0; i <= NS; i++) xs.add(+(-l * Math.cos(Math.PI * i / NS)).toFixed(4));
  for (const [x] of pts) if (x > -l + 0.01 && x < l - 0.01) xs.add(+x.toFixed(4));
  // dense stations across each wheel arch so the liner reads as a round arch, not a block
  for (const c of [-def.wb / 2, def.wb / 2]) for (let k = -6; k <= 6; k++) {
    const x = c + k / 6 * (def.wr + 0.12); if (x > -l + 0.02 && x < l - 0.02) xs.add(+x.toFixed(4));
  }
  const X = [...xs].sort((a, b) => a - b);
  const rP = 0.34;
  const ring = x => {
    const t = clamp01((Math.abs(x) - (l - rP)) / rP);
    const hw = hw0 * Math.max(0.6, Math.sqrt(1 - t * t));
    const top = topAt(pts, x);
    const gh = clamp01((top - belt) / 0.25) * tumble;
    const yb = Math.min(belt, top - 0.03);
    // end faces round over vertically too
    const endDrop = t * t * 0.05;
    const half = [
      [bot + 0.02, hw * 0.9],
      [bot + 0.09, hw],
      [lerp(bot, yb, 0.2), hw * 1.006],
      [lerp(bot, yb, 0.42), hw * 1.012],
      [lerp(bot, yb, 0.65), hw * 1.008],
      [yb - 0.05, hw * 1.0],
      [yb - endDrop, hw * 0.975],
      [yb + 0.025 * gh, hw * (0.965 - 0.03 * gh)],
      [Math.max(yb + 0.03, top - 0.08 * gh - 0.02), hw * (0.94 - 0.13 * gh)],
      [top - 0.008 - endDrop, hw * (0.84 - 0.1 * gh)],
      [top - endDrop * 0.5, hw * 0.45],
      [top - endDrop * 0.5, 0],
    ];
    const r = [];
    for (const [y, w] of half) r.push([x, y, w]);
    for (let k = half.length - 2; k >= 0; k--) r.push([x, half[k][0], -half[k][1]]);
    return r;
  };
  const P = [], I = [], tri = [];   // tri: per triangle [ring segment k, station s]
  const R = ring(0).length, KH = 12;   // KH: points per half-section
  const GH = X.map(x => clamp01((topAt(pts, x) - belt) / 0.25));
  for (const x of X) for (const [a, b, c] of ring(x)) P.push(a, b, c);
  for (let s = 0; s < X.length - 1; s++) {
    const a0 = s * R, b0 = (s + 1) * R;
    for (let k = 0; k < R; k++) {
      const k1 = (k + 1) % R;
      I.push(a0 + k, b0 + k, b0 + k1, a0 + k, b0 + k1, a0 + k1);
      tri.push([k, s], [k, s]);
    }
  }
  // end caps (fans from the section centroid)
  for (const [s, flip] of [[0, true], [X.length - 1, false]]) {
    let cy = 0; for (let k = 0; k < R; k++) cy += P[(s * R + k) * 3 + 1] / R;
    const c = P.length / 3; P.push(X[s] + (flip ? -0.015 : 0.015), cy, 0);
    for (let k = 0; k < R; k++) {
      const k1 = (k + 1) % R;
      if (flip) I.push(c, s * R + k, s * R + k1); else I.push(c, s * R + k1, s * R + k);
      tri.push([k, -1 - s]);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  // glass by panel, not by triangle: side windows are ring segment 7 (and its mirror), screens are
  // the roof-side segments where the surface slopes along the car; whole quads, so edges are clean
  const pos = g.attributes.position, gl = new Float32Array(pos.count);
  const mirror = k => (k >= KH ? 2 * (KH - 1) - k : k);       // left-side segment -> right-side index
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (let t = 0; t < tri.length; t++) {
    const [k, s] = tri[t];
    va.fromBufferAttribute(pos, t * 3); vb.fromBufferAttribute(pos, t * 3 + 1); vc.fromBufferAttribute(pos, t * 3 + 2);
    const cy = (va.y + vb.y + vc.y) / 3;
    const n = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
    const h = mirror(k);
    let glass = false;
    if (s >= 0) {
      const gh = Math.min(GH[s], GH[s + 1]);
      if (h === 7 && gh > 0.3) glass = true;         // side windows
      if (h >= 8 && h <= 10 && Math.abs(n.x) > 0.42 && cy > belt + 0.02) glass = true;            // wind / rear screens
    } else if (cy > belt + 0.03 && Math.abs(n.y) < 0.8) glass = true;                            // tail glass on the end cap
    if (glass) gl[t * 3] = gl[t * 3 + 1] = gl[t * 3 + 2] = 1;
  }
  g.setAttribute('glassQ', new THREE.BufferAttribute(gl, 1));
  return g;
}

// unit wheel: radius 1, axle along z, width 1 (vehicles.js scales it per model)
export function wheelGeometry() {
  const V = (r, y) => new THREE.Vector2(r, y);
  const prof = [V(0.0, -0.42), V(0.2, -0.43), V(0.6, -0.4), V(0.64, -0.5), V(0.86, -0.5), V(0.96, -0.44), V(1.0, -0.3), V(1.0, 0.3),
    V(0.96, 0.44), V(0.86, 0.5), V(0.64, 0.5), V(0.6, 0.4), V(0.2, 0.43), V(0.0, 0.42)];
  const g = new THREE.LatheGeometry(prof, 24);
  g.rotateX(Math.PI / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
export function wheelMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const p = positionLocal;
  const r = length(p.xy);
  const rim = step(r, 0.63);
  // five-spoke alloy: dark gaps between spokes, darker hub recess
  const a = atan(p.y, p.x).div(Math.PI * 2).add(0.5);
  const spoke = smoothstep(0.32, 0.4, abs(fract(a.mul(5)).sub(0.5)).mul(2));
  const face = step(0.36, abs(p.z));
  const gap = rim.mul(face).mul(step(0.18, r)).mul(step(r, 0.56)).mul(float(1).sub(spoke));
  const alloy = mix(vec3(0.62, 0.63, 0.65), vec3(0.05), gap).mul(mix(float(1), float(0.5), step(r, 0.14)));
  const tyre = vec3(0.028).mul(mix(float(1), float(1.5), step(0.97, r)));
  m.colorNode = mix(tyre, alloy, rim);
  m.metalnessNode = rim.mul(float(1).sub(gap)).mul(0.85);
  m.roughnessNode = mix(float(0.9), float(0.3), rim);
  return m;
}
