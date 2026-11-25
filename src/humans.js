// Detailed people for the whole crowd (pedestrians, police, drivers, Cal and Leon).
// One continuous body mesh per level of detail, skinned procedurally in the vertex shader: every
// vertex carries (limb, chain coordinate, clothing region, accessory tag) and is bent around the
// hip/knee/ankle or shoulder/elbow/wrist joints by angles computed from each person's gait phase,
// speed and pose. Joints blend smoothly (no rigid pipes), and the whole crowd is one instanced draw
// per LOD. Faces, hair styles, hats, hoods, umbrellas, bags, hi-vis and body shape vary per person.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, int, attribute, positionGeometry, normalGeometry, positionWorld, varyingProperty,
  sin, cos, abs, max, min, mix, step, smoothstep, clamp, floor, fract, pow, length, normalize, select, texture, fwidth, modelWorldMatrix,
} from 'three/tsl';
import { bakeFaceAtlas, bakeHairTexture, FACE_ATLAS as FA } from './faceBake.js';
import { U, cloudShadow } from './env.js';
import { lightPool } from './materials.js';
import { worldToView } from './surfaces.js';
import { RiggedPeople } from './riggedPeople.js';

const MAX0 = 96, MAX1 = 260;          // near (detailed) and far instance capacity
const LOD_DIST = 30;                  // metres
const POSE = { walk: 0, idle: 0, flee: 0, talk: 1, phone: 2, umbrella: 3, wave: 4, point: 5, hands: 6, shelter: 7, brace: 8, seated: 9 };
const TAG = { always: 0, hairShort: 1, hairLong: 2, hairBun: 3, hairCurly: 4, helmet: 10, umbrella: 11, bag: 12, cap: 13, hood: 14 };
// regions: 0 skin, 1 top, 2 trousers, 3 shoes, 4 hair, 6 helmet, 7 umbrella canopy, 8 bag, 9 dark trim, 10 cap, 11 metal

// ------------------------------------------------------------------ geometry
class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.skin = []; this.idx = []; }
  add(geo, skinFn) {
    if (!geo.index) { const n = geo.attributes.position.count; geo.setIndex([...Array(n).keys()]); }
    geo.computeVertexNormals();
    const p = geo.attributes.position, nn = geo.attributes.normal, base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z); this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      this.skin.push(...skinFn(x, y, z, i));
    }
    for (const i of geo.index.array) this.idx.push(i + base);
  }
  build() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('skin', new THREE.Float32BufferAttribute(this.skin, 4));
    g.setIndex(this.idx);
    g.instanceCount = 0;
    return g;
  }
}
// flip triangles whose face normal points towards the given inside point (robust outward winding)
function orient(geo, inside) {
  const p = geo.attributes.position, I = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < I.length; t += 3) {
    a.fromBufferAttribute(p, I[t]); b.fromBufferAttribute(p, I[t + 1]); c.fromBufferAttribute(p, I[t + 2]);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    const ctr = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(ctr.clone().sub(inside(ctr, t / 3)) ) < 0) { const k = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = k; }
  }
  return geo;
}
function doubleSided(geo) {
  const p = geo.attributes.position, I = geo.index.array, n = p.count;
  const P = new Float32Array(n * 6); P.set(p.array, 0); P.set(p.array, n * 3);
  const J = [...I]; for (let t = 0; t < I.length; t += 3) J.push(I[t] + n, I[t + 2] + n, I[t + 1] + n);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(J);
  return g;
}
// tube through rings {c:[x,y,z], rx, rf (front +z / up for axis z), rb (back / down), s}
function tube(rings, seg, axis = 'y', caps = [true, true]) {
  const P = [], S = [], I = [], ref = [];
  for (const r of rings) for (let k = 0; k < seg; k++) {
    const a = k / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rz = sa >= 0 ? r.rf : r.rb;
    if (axis === 'y') P.push(r.c[0] + ca * r.rx, r.c[1], r.c[2] + sa * rz);
    else P.push(r.c[0] + ca * r.rx, r.c[1] + sa * rz, r.c[2]);
    S.push(r.s);
  }
  const ctr = r => new THREE.Vector3(...r.c);
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * seg + k, b = i * seg + (k + 1) % seg, c = (i + 1) * seg + k, d = (i + 1) * seg + (k + 1) % seg;
    I.push(a, c, b, b, c, d); const m = ctr(rings[i]).add(ctr(rings[i + 1])).multiplyScalar(0.5); ref.push(m, m);
  }
  const cap = (ri, next) => {
    const r = rings[ri], ci = P.length / 3; P.push(...r.c); S.push(r.s);
    const inside = ctr(r).lerp(ctr(rings[next]), 0.5);
    for (let k = 0; k < seg; k++) { I.push(ci, ri * seg + k, ri * seg + (k + 1) % seg); ref.push(inside); }
  };
  if (caps[0]) cap(0, 1);
  if (caps[1]) cap(rings.length - 1, rings.length - 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  orient(g, (c, t) => ref[t]);
  return { geo: g, S };
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// sample along a joint chain J0..J1..J2 at chain coordinate s (0..2)
const chainAt = (J, s) => s <= 1 ? lerp3(J[0], J[1], Math.max(0, s)) : lerp3(J[1], J[2], Math.min(1, s - 1));

function bodyGeometry(q) {
  const B = new MeshBuilder();
  const seg = q ? 22 : 10, lseg = q ? 14 : 7;
  // --- torso (pelvis to neck base), asymmetric front/back for chest, belly and seat
  const T = [
    [0.862, 0.05, 0.05, 0.05, 0.01], [0.885, 0.135, 0.09, 0.1, 0.0], [0.93, 0.162, 0.104, 0.12, -0.005], [0.955, 0.168, 0.107, 0.122, -0.005],
    [1.0, 0.163, 0.106, 0.112, -0.004], [1.06, 0.158, 0.104, 0.102, 0.0], [1.13, 0.164, 0.112, 0.104, 0.004], [1.2, 0.177, 0.124, 0.106, 0.008],
    [1.27, 0.187, 0.128, 0.106, 0.008], [1.34, 0.193, 0.114, 0.106, 0.0], [1.4, 0.189, 0.096, 0.1, -0.008], [1.435, 0.16, 0.082, 0.088, -0.012],
    [1.465, 0.1, 0.068, 0.072, -0.01], [1.49, 0.066, 0.058, 0.06, -0.006],
  ].filter((_, i) => q || i % 2 === 0 || i === 13);
  const torso = tube(T.map(([y, rx, rf, rb, z]) => ({ c: [0, y, z], rx, rf, rb, s: 0 })), seg);
  B.add(torso.geo, (x, y) => [0, 0, y < 0.952 ? 2 : 1, 0]);
  // jacket hem and collar (slightly proud of the body)
  if (q) {
    const hem = tube([{ c: [0, 0.94, -0.004], rx: 0.176, rf: 0.11, rb: 0.127, s: 0 }, { c: [0, 0.975, -0.004], rx: 0.17, rf: 0.108, rb: 0.12, s: 0 }], seg, 'y', [false, false]);
    B.add(hem.geo, () => [0, 0, 1, 0]);
    const col = tube([{ c: [0, 1.47, 0.0], rx: 0.078, rf: 0.07, rb: 0.07, s: 0 }, { c: [0, 1.515, -0.006], rx: 0.07, rf: 0.062, rb: 0.068, s: 0 }], seg, 'y', [false, false]);
    B.add(doubleSided(col.geo), () => [0, 0, 1, 0]);
  }
  // --- neck
  const neck = tube([{ c: [0, 1.45, -0.006], rx: 0.056, rf: 0.054, rb: 0.056, s: 0 }, { c: [0, 1.6, 0.004], rx: 0.049, rf: 0.047, rb: 0.05, s: 0 }], lseg, 'y', [false, true]);
  B.add(neck.geo, () => [0, 0, 0, 0]);
  // --- head: skull with jaw, chin, cheekbones; nose; ears
  const head = new THREE.SphereGeometry(0.1, q ? 48 : 14, q ? 32 : 10);
  { const p = head.attributes.position; for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, ...headShape(p.getX(i), p.getY(i), p.getZ(i), true));
  } }
  B.add(head, () => [0, 0, 0, 0]);
  if (q) {
    for (const sx of [-1, 1]) { const e = new THREE.SphereGeometry(0.022, 8, 6); e.scale(0.42, 1.3, 0.9); e.translate(sx * 0.087, 1.655, 0.0); B.add(e, () => [0, 0, 0, 0]); }
  }
  // --- legs, shoes, arms, hands (side +1 = the person's left, +x)
  for (const sx of [1, -1]) {
    const legLimb = sx > 0 ? 1 : 2, armLimb = sx > 0 ? 3 : 4;
    const JL = [[sx * 0.092, 0.93, 0], [sx * 0.098, 0.505, 0.012], [sx * 0.1, 0.085, -0.02]];
    const legR = [[-0.2, 0.087, 0.086, 0.09], [0, 0.093, 0.094, 0.1], [0.2, 0.088, 0.09, 0.088], [0.42, 0.079, 0.08, 0.076], [0.65, 0.069, 0.07, 0.064],
      [0.88, 0.06, 0.062, 0.056], [1.0, 0.057, 0.06, 0.054], [1.1, 0.058, 0.056, 0.062], [1.3, 0.062, 0.054, 0.07], [1.55, 0.053, 0.048, 0.056], [1.8, 0.046, 0.046, 0.046], [1.95, 0.05, 0.052, 0.052]]
      .filter((_, i) => q || i % 2 === 0 || i === 11);
    const leg = tube(legR.map(([s, rx, rf, rb]) => ({ c: s < 0 ? [sx * 0.085, 0.93 - s * 0.35, 0] : chainAt(JL, s), rx, rf, rb, s })), lseg, 'y', [true, false]);
    B.add(leg.geo, (x, y, z, i) => [legLimb, leg.S[i] ?? 0, 2, 0]);
    // shoe: along +z from heel to toe, sole flat
    const shoeRings = [[-0.07, 0.03, 0.035, 0.02], [-0.055, 0.042, 0.05, 0.04], [0.0, 0.047, 0.052, 0.045], [0.07, 0.05, 0.04, 0.046], [0.13, 0.047, 0.03, 0.045], [0.175, 0.03, 0.022, 0.04], [0.19, 0.012, 0.012, 0.03]]
      .filter((_, i) => q || i % 2 === 0 || i === 6);
    const shoe = tube(shoeRings.map(([z, rx, ru, rd]) => ({ c: [sx * 0.1, 0.048, z - 0.02], rx, rf: ru, rb: rd, s: 2.2 + (z + 0.07) * 2.5 })), lseg, 'z');
    { const p = shoe.geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0.004, p.getY(i))); }
    B.add(shoe.geo, (x, y, z, i) => [legLimb, shoe.S[i] ?? 2.5, 3, 0]);
    const JA = [[sx * 0.2, 1.43, -0.01], [sx * 0.225, 1.165, -0.03], [sx * 0.235, 0.905, 0.0]];
    const armR = [[-0.22, 0.056, 0.058, 0.058], [0, 0.060, 0.060, 0.060], [0.2, 0.057, 0.056, 0.056], [0.45, 0.051, 0.05, 0.05], [0.75, 0.047, 0.046, 0.047],
      [1.0, 0.046, 0.046, 0.044], [1.2, 0.046, 0.047, 0.044], [1.5, 0.041, 0.042, 0.04], [1.8, 0.036, 0.037, 0.035], [1.96, 0.038, 0.039, 0.037]]
      .filter((_, i) => q || i % 2 === 0 || i === 9);
    const arm = tube(armR.map(([s, rx, rf, rb]) => ({ c: s < 0 ? [sx * 0.165, 1.442 - s * 0.07, -0.01] : chainAt(JA, s), rx, rf, rb, s })), lseg, 'y', [true, false]);
    B.add(arm.geo, (x, y, z, i) => [armLimb, arm.S[i] ?? 0, 1, 0]);
    // deltoid cap
    const del = new THREE.SphereGeometry(0.058, q ? 12 : 6, q ? 8 : 4); del.scale(0.95, 0.85, 1.05); del.translate(sx * 0.19, 1.405, -0.01);
    B.add(del, () => [armLimb, -0.06, 1, 0]);
    // hand: palm, finger block, thumb (hanging, palm facing the thigh)
    const palm = new THREE.SphereGeometry(1, q ? 10 : 6, q ? 8 : 4); palm.scale(0.021, 0.048, 0.04); palm.translate(sx * 0.236, 0.86, 0.004);
    B.add(palm, () => [armLimb, 2.5, 0, 0]);
    if (q) {
      // Resting fingers taper and curl toward the thigh, with staggered knuckles.
      for (const [finger,length] of [.069,.076,.070,.056].entries()) {
        const z = .031 - finger*.016;
        const rings = [[0,.010], [.36,.009], [.75,.0078], [1,.0045]].map(([u,r]) =>
          ({c:[sx*(.239-.013*u*u), .833-length*u, z-.004*u], rx:r,rf:r,rb:r,s:2.8}));
        B.add(tube(rings,6).geo, () => [armLimb,2.8,0,0]);
      }
      const th = new THREE.CapsuleGeometry(0.0105, 0.035, 2, 6); th.rotateX(-0.5); th.translate(sx * 0.226, 0.855, 0.043);
      B.add(th, () => [armLimb, 2.6, 0, 0]);
    }
  }
  // --- hair styles (only the instance's style survives the vertex shader)
  const capShell = (r, cut, sx, sy, sz, oy, oz) => { const g = new THREE.SphereGeometry(r, q ? 20 : 9, q ? 10 : 5, 0, Math.PI * 2, 0, Math.PI * cut); g.scale(sx, sy, sz); g.translate(0, oy, oz); return g; };
  const hairTag = t => () => [0, 0, 4, t];
  // hair shells follow the skull at a small offset and dip under the skin below a hairline (forehead,
  // temples, sideburns, over the ears, nape), so the hairline is a clean edge rather than two
  // nearly coincident surfaces fighting
  const hairShell = (off, line, bump = 0) => {
    const g = new THREE.SphereGeometry(0.1, q ? 28 : 12, q ? 22 : 9), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = headShape(p.getX(i), p.getY(i), p.getZ(i)), dx = x, dy = y - 1.66, dz = z - 0.008, l = Math.hypot(dx, dy, dz) || 1;
      const a = Math.abs(Math.atan2(x, z)), yl = lerpTable(line, a);
      let o = y > yl ? off : -0.004;
      if (bump && y > yl) o += bump * (0.5 + 0.5 * Math.sin(x * 160) * Math.sin(y * 170) * Math.sin(z * 150));
      p.setXYZ(i, x + dx / l * o, y + dy / l * o, z + dz / l * o);
    }
    g.computeVertexNormals();
    return g;
  };
  const LINE_SHORT = [[0, 1.718], [0.45, 1.712], [0.9, 1.69], [1.18, 1.645], [1.38, 1.645], [1.55, 1.695], [1.85, 1.695], [2.25, 1.605], [Math.PI, 1.59]];
  const LINE_LONG = [[0, 1.716], [0.45, 1.708], [0.9, 1.685], [1.2, 1.64], [1.5, 1.62], [Math.PI, 1.6]];
  // short crop
  B.add(hairShell(0.0065, LINE_SHORT), hairTag(TAG.hairShort));
  // long: cap + fall to the shoulders behind and at the sides
  B.add(hairShell(0.009, LINE_LONG), hairTag(TAG.hairLong));
  { const pts = [[0.104, 1.7], [0.111, 1.64], [0.108, 1.57], [0.1, 1.5], [0.088, 1.45]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, q ? 18 : 8, Math.PI * 0.62, Math.PI * 0.76); g.scale(0.95, 1, 1.05); g.translate(0, 0, -0.012);
    B.add(doubleSided(g), hairTag(TAG.hairLong)); }
  // bun
  B.add(hairShell(0.008, LINE_LONG), hairTag(TAG.hairBun));
  { const g = new THREE.SphereGeometry(0.042, q ? 10 : 6, q ? 8 : 4); g.translate(0, 1.71, -0.105); B.add(g, hairTag(TAG.hairBun)); }
  // curly / afro: bumpy, fuller shell
  B.add(hairShell(0.016, LINE_SHORT.map(([a, y]) => [a, y - 0.004]), 0.008), hairTag(TAG.hairCurly));
  // --- headwear and accessories
  { // custodian helmet
    const pts = [[0.0, 1.97], [0.045, 1.96], [0.092, 1.9], [0.113, 1.81], [0.117, 1.73], [0.148, 1.72], [0.15, 1.71], [0.112, 1.715]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, q ? 20 : 10); g.translate(0, 0, -0.005);
    orient(g, c => new THREE.Vector3(0, c.y, -0.005));
    B.add(g, () => [0, 0, 6, TAG.helmet]);
    const badge = new THREE.SphereGeometry(0.022, 8, 6); badge.scale(1, 1.25, 0.3); badge.translate(0, 1.81, 0.112);
    B.add(badge, () => [0, 0, 11, TAG.helmet]);
  }
  { // baseball cap: crown + peak
    B.add(capShell(0.108, 0.5, 0.96, 0.95, 1.06, 1.69, -0.006), () => [0, 0, 10, TAG.cap]);
    const peak = new THREE.CylinderGeometry(0.085, 0.085, 0.008, q ? 16 : 8, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    peak.scale(1, 1, 1.0); peak.rotateX(0.12); peak.translate(0, 1.695, 0.07);
    B.add(peak, () => [0, 0, 10, TAG.cap]);
  }
  { // hood down, gathered behind the neck
    const g = new THREE.TorusGeometry(0.1, 0.035, q ? 6 : 4, q ? 16 : 8, Math.PI * 1.25); g.rotateX(Math.PI / 2); g.rotateY(Math.PI * 0.125 + Math.PI); g.scale(1.1, 1, 0.9); g.translate(0, 1.47, -0.03);
    B.add(g, () => [0, 0, 1, TAG.hood]);
  }
  { // umbrella held above the head (moves with the chest)
    const c = new THREE.ConeGeometry(0.56, 0.24, q ? 16 : 8, 1, true); const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); if (y < 0) p.setY(i, y + 0.025 * Math.cos(Math.atan2(z, x) * 8)); }
    c.translate(-0.13, 2.13, 0.16);
    B.add(doubleSided(c), () => [0, 0, 7, TAG.umbrella]);
    const sh = new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5); sh.translate(-0.13, 1.72, 0.16); B.add(sh, () => [0, 0, 9, TAG.umbrella]);
    const tip = new THREE.CylinderGeometry(0.004, 0.006, 0.06, 4); tip.translate(-0.13, 2.27, 0.16); B.add(tip, () => [0, 0, 9, TAG.umbrella]);
  }
  { // shoulder bag on the left hip with a strap across the chest
    const g = new THREE.CapsuleGeometry(0.1, 0.12, 3, 10); g.rotateZ(Math.PI / 2); g.scale(1, 1.1, 0.42); g.translate(0.2, 1.0, 0.0);
    B.add(g, () => [0, 0, 8, TAG.bag]);
    const strap = new THREE.TorusGeometry(0.29, 0.007, 3, 20, Math.PI * 0.55); strap.rotateY(Math.PI / 2); strap.rotateX(0.62); strap.translate(0.06, 1.18, 0.0);
    B.add(strap, () => [0, 0, 8, TAG.bag]);
  }
  return B.build();
}

// skull shape (jaw, chin, narrower crown) applied to a 0.1 m sphere; shared by the head and the hair shells
function headShape(x, y, z, sculpt = false) {
  const jaw = y < 0 ? 1 - 0.24 * Math.min(1, -y / 0.1) : 1;
  x *= 0.88 * jaw * (y > 0.05 ? 1 - (y - 0.05) * 0.6 : 1);
  z *= (z > 0 ? 1.02 : 1.08) * (y < -0.03 ? 0.96 : 1);
  if (z > 0 && y < -0.05) z += 0.012 * Math.min(1, (-y - 0.05) / 0.04) * Math.max(0, 1 - Math.abs(x) / 0.04);   // chin
  if (sculpt && z > 0) {
    const height = y*1.17+1.66, ax = Math.abs(x);
    const form = (cx,cy,w,h) => Math.exp(-(((ax-cx)/w)**2 + ((height-cy)/h)**2));
    const facing = Math.min(1,z/.042);
    z += facing * (
      .014*form(.032,1.683,.029,.011) - .014*form(.034,1.662,.020,.012)
      + .012*form(.051,1.640,.022,.017) + .018*form(0,1.651,.009,.029)
      + .021*form(0,1.633,.013,.010) + .009*form(.012,1.629,.006,.005)
      + .006*form(.008,1.606,.016,.004) + .007*form(0,1.598,.020,.005)
      + .009*form(0,1.571,.026,.013)
    );
  }
  return [x, y * 1.17 + 1.66, z + 0.008];
}
function lerpTable(t, a) {
  for (let k = 1; k < t.length; k++) if (a <= t[k][0]) { const [a0, y0] = t[k - 1], [a1, y1] = t[k]; return y0 + (y1 - y0) * (a - a0) / (a1 - a0); }
  return t[t.length - 1][1];
}

// ------------------------------------------------------------------ material (skinning + appearance)
const rotX = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c))); };
const rotY = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };
const rotZ = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z); };
const about = (v, piv, f, a) => f(v.sub(piv), a).add(piv);
const sel = (c, a, b) => select(c, a, b).uniformFlow().toVar();
const eq = (a, k) => step(k - 0.5, a).mul(step(a, k + 0.5));
const bit = (v, k) => step(0.5, fract(floor(v.div(2 ** k)).mul(0.5)));
const unpack = v => { const r = floor(v.div(65536)), g = floor(v.sub(r.mul(65536)).div(256)), b = v.sub(r.mul(65536)).sub(g.mul(256)); return pow(vec3(r, g, b).div(255), vec3(2.2)); };

function crowdMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const sk = attribute('skin', 'vec4');
  const iPos = attribute('iPos', 'vec4'), iAnim = attribute('iAnim', 'vec4'), iCol = attribute('iCol', 'vec4'), iSty = attribute('iSty', 'vec4');
  const vN = varyingProperty('vec3', 'vSkinN');
  // packed per-person data is decoded here, where it is exact (interpolated varyings would scramble the bits)
  const vSkinC = varyingProperty('vec3', 'vSkinC'), vTopC = varyingProperty('vec3', 'vTopC'), vLegC = varyingProperty('vec3', 'vLegC'), vHairC = varyingProperty('vec4', 'vHairC');
  const vMisc = varyingProperty('vec4', 'vMisc');   // hi-vis, shoe index, umbrella index, umbrella up
  const vOutfit = varyingProperty('float','vOutfit');
  const vFace = varyingProperty('float', 'vFace');  // face atlas cell (0-3 men, 4-7 women)
  const faceTex = bakeFaceAtlas(), hairTex = bakeHairTexture();
  // Neutralised facial albedo projected from the four character GLBs already shipped with the game.
  const portraitTex = new THREE.TextureLoader().load('assets/people/face-detail.png');
  portraitTex.colorSpace = THREE.NoColorSpace;
  portraitTex.anisotropy = 4;
  m.positionNode = Fn(() => {
    const limb = sk.x, s = sk.y, tag = sk.w;
    // iSty.x = hair style + 0.05 x face index
    const style = floor(iSty.x.add(0.01)), flags = floor(iSty.y.add(0.5)), hgt = iSty.z;
    vOutfit.assign(floor(flags.div(2048)));
    vFace.assign(floor(fract(iSty.x).mul(20).add(0.5)));
    vSkinC.assign(unpack(iCol.x)); vTopC.assign(unpack(iCol.y)); vLegC.assign(unpack(iCol.z));
    vHairC.assign(vec4(unpack(iCol.w), step(0.6, fract(iCol.x.mul(0.000031)))));
    vMisc.assign(vec4(bit(flags, 3), floor(flags.div(64)).sub(floor(flags.div(256)).mul(4)), floor(flags.div(256)).mod(8), bit(flags, 1)));
    const female = step(1.5, iSty.w), build = iSty.w.sub(female.mul(2));
    const phi = iAnim.x, run = step(1.5, iAnim.y), amp = iAnim.y.sub(run.mul(2));
    const pose = floor(iAnim.z), fall = fract(iAnim.z), t = iAnim.w;
    // ---- accessory / hair-style visibility
    const hairOn = step(0.5, tag).mul(step(tag, 4.5)).mul(step(abs(tag.sub(style)), 0.5));
    const keep = eq(tag, 0).add(hairOn).add(eq(tag, 10).mul(bit(flags, 0))).add(eq(tag, 11).mul(bit(flags, 1))).add(eq(tag, 12).mul(bit(flags, 2)))
      .add(eq(tag, 13).mul(bit(flags, 4))).add(eq(tag, 14).mul(bit(flags, 5))).min(1);
    // ---- body shape in the rest pose
    let p = positionGeometry, n = normalGeometry;
    const y = p.y;
    const isTorso = eq(limb, 0);
    const isLeg = step(0.5, limb).mul(step(limb, 2.5)), isArm = step(2.5, limb).mul(step(limb, 4.5)), isLimb = isLeg.add(isArm);
    const odd = step(0.5, fract(limb.mul(0.5))), side = odd.mul(2).sub(1);
    const shoulderZone = smoothstep(1.22, 1.4, y), hipZone = smoothstep(0.82, 0.9, y).mul(smoothstep(1.08, 0.96, y)), waistZone = smoothstep(0.98, 1.06, y).mul(smoothstep(1.16, 1.07, y));
    const torsoBody = isTorso.mul(step(y, 1.5)).mul(eq(tag, 0));
    const sx = float(1).add(torsoBody.mul(female.mul(shoulderZone.mul(-0.07).add(hipZone.mul(0.075)).add(waistZone.mul(-0.06))).add(build.mul(0.17))));
    const chest = female.mul(smoothstep(1.14, 1.22, y).mul(smoothstep(1.34, 1.25, y))).mul(step(0, p.z)).mul(torsoBody).mul(0.022);
    const belly = build.mul(smoothstep(0.96, 1.06, y).mul(smoothstep(1.24, 1.1, y))).mul(step(0, p.z)).mul(torsoBody).mul(0.04);
    // limbs inflate radially with build; arms and legs move with the shoulders / hips
    const axX = side.mul(sel(isArm.greaterThan(0.5), float(0.2).add(float(1.43).sub(y).mul(0.067)), float(0.095)));
    const inflate = float(1).add(isLimb.mul(build.mul(0.13)).mul(step(s, 1.98)));
    const shift = isArm.mul(female.mul(-0.012)).add(isLeg.mul(female.mul(0.006))).mul(side);
    p = vec3(sel(isLimb.greaterThan(0.5), axX.add(p.x.sub(axX).mul(inflate)).add(shift), p.x.mul(sx)), y, p.z.mul(sel(isLimb.greaterThan(0.5), inflate, sx)).add(chest).add(belly));
    // Vary the lower face and skull together with the hair, keeping features registered.
    const headWeight = smoothstep(1.52,1.59,y);
    const jawWidth = build.sub(.35).mul(.32).sub(female.mul(.035));
    p = vec3(p.x.mul(float(1).add(headWeight.mul(jawWidth).mul(float(1).sub(smoothstep(1.62,1.70,y))))),
      p.y, p.z.mul(float(1).add(headWeight.mul(build.sub(.35)).mul(.12))));
    const quilt = eq(vOutfit,2).mul(eq(sk.z,1));
    const loft = sin(y.mul(74)).mul(.0025).add(.007).mul(quilt);
    p = p.add(n.mul(loft));
    // ---- gait and pose angles
    const psiL = phi.add(float(Math.PI).mul(float(1).sub(odd)));
    const brace = eq(pose, 8).mul(iAnim.w), seated = eq(pose,9);
    const thigh = seated.mul(1.48).add(brace.mul(odd.mul(.2).add(.28))).add(amp.mul(sin(psiL)).mul(run.mul(0.25).add(0.52)));
    const kneeS = max(sin(psiL.add(1.3)), 0);
    const knee = amp.mul(kneeS.mul(kneeS).mul(run.mul(0.7).add(0.62)).add(0.1)).add(0.04).add(brace.mul(.67)).add(seated.mul(1.49));
    const ankle = amp.mul(0.25).mul(sin(psiL.sub(0.6)));
    const psiA = psiL.add(Math.PI);
    const idle = float(1).sub(amp.min(1));
    const gFlex = amp.mul(sin(psiA)).mul(run.mul(0.3).add(0.35)).add(idle.mul(0.03).mul(sin(t.mul(0.9).add(side))));
    const gElb = amp.mul(max(sin(psiA), 0).mul(0.25).add(0.15)).add(run.mul(1.15)).add(0.16);
    const gAbd = float(.035).add(build.mul(.04));
    const isR = float(1).sub(odd);   // the person's right arm carries the props
    const armPose = isArm.mul(sel(pose.greaterThan(5.5), float(1), isR.mul(step(0.5, pose)))).mul(mix(float(1),brace,eq(pose,8)));
    const pFlex = sel(eq(pose, 1).greaterThan(0.5), sin(t.mul(3.1)).mul(0.25).add(0.5), sel(eq(pose, 2).greaterThan(0.5), float(0.35), sel(eq(pose, 3).greaterThan(0.5), float(1.0),
      sel(eq(pose, 4).greaterThan(0.5), float(0.2), sel(eq(pose, 5).greaterThan(0.5), float(1.45), sel(eq(pose, 6).greaterThan(0.5), float(0.3), float(0.55)))))));
    const pAbd = sel(eq(pose, 1).greaterThan(0.5), float(0.15), sel(eq(pose, 2).greaterThan(0.5), float(0.45), sel(eq(pose, 3).greaterThan(0.5), float(0.05),
      sel(eq(pose, 4).greaterThan(0.5), float(2.5), sel(eq(pose, 5).greaterThan(0.5), float(0.1), sel(eq(pose, 6).greaterThan(0.5), float(2.7), float(-0.32)))))));
    const pElb = sel(eq(pose, 1).greaterThan(0.5), sin(t.mul(2.3)).mul(0.2).add(1.3), sel(eq(pose, 2).greaterThan(0.5), float(2.55), sel(eq(pose, 3).greaterThan(0.5), float(1.05),
      sel(eq(pose, 4).greaterThan(0.5), sin(t.mul(8)).mul(0.35).add(0.6), sel(eq(pose, 5).greaterThan(0.5), float(0.05), sel(eq(pose, 6).greaterThan(0.5), float(0.25), float(1.7)))))));
    const aFlex = mix(gFlex, pFlex, armPose), aAbd = mix(gAbd, pAbd, armPose), aElb = mix(gElb, pElb, armPose);
    // joints of this vertex's chain
    const J1 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.2), 1.43, -0.01), vec3(side.mul(0.092), 0.93, 0));
    const J2 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.225), 1.165, -0.03), vec3(side.mul(0.098), 0.505, 0.012));
    const J3 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.235), 0.905, 0.0), vec3(side.mul(0.1), 0.085, -0.02));
    const w1 = isLimb.mul(sel(isArm.greaterThan(0.5), smoothstep(-0.25, 0.0, s), smoothstep(-0.2, 0.05, s)));
    const w2 = isLimb.mul(smoothstep(0.88, 1.12, s)), w3 = isLimb.mul(smoothstep(1.9, 2.1, s));
    const th1 = sel(isArm.greaterThan(0.5), aFlex.negate(), thigh.negate()).mul(w1);
    const be1 = sel(isArm.greaterThan(0.5), side.mul(aAbd), side.mul(0.02)).mul(w1);
    const th2 = sel(isArm.greaterThan(0.5), aElb.negate(), knee).mul(w2);
    const th3 = sel(isArm.greaterThan(0.5), float(-0.08), ankle.negate()).mul(w3);
    p = about(p, J3, rotX, th3); n = rotX(n, th3);
    p = about(p, J2, rotX, th2); n = rotX(n, th2);
    p = about(p, J1, rotX, th1); n = rotX(n, th1);
    p = about(p, J1, rotZ, be1); n = rotZ(n, be1);
    // head look / nod, then chest counter-rotation and lean (arms and head ride on the chest)
    const isUmb = eq(tag, 11);
    const wh = isTorso.mul(smoothstep(1.5, 1.565, positionGeometry.y)).mul(float(1).sub(isUmb));
    const look = idle.mul(0.35).mul(sin(t.mul(0.27).add(iPos.x))).add(eq(pose, 2).mul(0.12));
    const nod = amp.mul(0.035).mul(sin(phi.mul(2))).add(eq(pose, 2).mul(0.1));
    p = about(p, vec3(0, 1.53, 0), rotY, look.mul(wh)); n = rotY(n, look.mul(wh));
    p = about(p, vec3(0, 1.53, 0), rotX, nod.negate().mul(wh)); n = rotX(n, nod.negate().mul(wh));
    const yawP = amp.mul(0.07).mul(sin(phi));
    const wc = sel(isLeg.greaterThan(0.5), float(0), sel(isArm.greaterThan(0.5), float(1), smoothstep(0.98, 1.3, positionGeometry.y)));
    const lean = amp.mul(0.04).add(run.mul(0.2)).add(eq(pose, 7).mul(0.06)).sub(brace.mul(.25));
    const breath = sin(t.mul(1.7)).mul(0.004).mul(idle);
    p = about(p, vec3(0, 1.0, 0), rotY, yawP.mul(-1.2).mul(wc)); n = rotY(n, yawP.mul(-1.2).mul(wc));
    p = about(p, vec3(0, 1.0, 0), rotX, lean.negate().mul(wc)); n = rotX(n, lean.negate().mul(wc));
    p = p.add(vec3(0, breath.mul(wc), 0));
    // pelvis: yaw with the stride, side sway and vertical bob
    p = rotY(p, yawP); n = rotY(n, yawP);
    const bob = amp.mul(run.mul(0.02).add(0.025)).mul(float(0.5).sub(abs(sin(phi))));
    const sway = amp.mul(0.018).mul(sin(phi)).add(idle.mul(0.01).mul(sin(t.mul(0.6).add(iPos.z))));
    p = p.add(vec3(sway, bob, 0));
    // falls (knocked over): rotate onto the back about the feet
    const fa = fall.mul(Math.PI / 2);
    p = about(p, vec3(0, 0.05, 0), rotX, fa.negate()); n = rotX(n, fa.negate());
    p = p.add(vec3(0, fall.mul(0.11), 0));
    // collapse hidden accessories into the torso, scale, face the heading, place
    p = mix(vec3(0, 1.2, 0), p, keep).mul(hgt);
    const yaw = float(Math.PI / 2).sub(iPos.w);
    vN.assign(modelWorldMatrix.mul(vec4(rotY(n, yaw),0)).xyz);
    return rotY(p, yaw).add(iPos.xyz);
  })();
  // fabric folds (bunching at elbows, knees and the waist), fine weave and hair strands perturb the normal
  {
    const rg = sk.z, rp0 = positionGeometry, cloth = step(0.5, rg).mul(step(rg, 2.5));
    const elbow = step(2.5, sk.x).mul(smoothstep(0.25, 0.0, abs(sk.y.sub(1.0))));
    const kneeZ = step(0.5, sk.x).mul(step(sk.x, 2.5)).mul(smoothstep(0.08, 0.0, abs(rp0.y.sub(0.5))));
    const waist = eq(sk.x, 0).mul(smoothstep(0.05, 0.0, abs(rp0.y.sub(1.0)))).add(eq(sk.x, 0).mul(smoothstep(0.04, 0.0, abs(rp0.y.sub(0.89)))));
    const zone = elbow.add(kneeZ).add(waist).min(1).mul(cloth);
    const ridge = cos(rp0.y.mul(210).add(sin(rp0.x.mul(70).add(rp0.z.mul(50))).mul(2.5)));
    const crumple = vec3(sin(rp0.y.mul(97).add(rp0.x.mul(53))), sin(rp0.z.mul(89).add(rp0.y.mul(71))), sin(rp0.x.mul(83).add(rp0.z.mul(61))));
    const strands = eq(rg, 4).mul(sin(rp0.x.mul(520).add(rp0.z.mul(300))));
    m.normalNode = worldToView(normalize(vN.add(vec3(0, ridge.mul(zone).mul(0.14), 0)).add(crumple.mul(cloth.mul(0.024))).add(vec3(strands.mul(0.18), 0, strands.mul(0.12)))));
  }
  // ---- appearance
  const region = sk.z, rp = positionGeometry;
  const hiVis = step(0.5, vMisc.x);
  const skinC = vSkinC, topRaw = vTopC, legC = vLegC, hairC = vHairC.xyz;
  const shoeI = floor(vMisc.y.add(0.5)), umbI = floor(vMisc.z.add(0.5));
  const shoeC = sel(shoeI.lessThan(0.5), vec3(0.012), sel(shoeI.lessThan(1.5), vec3(0.06, 0.03, 0.015), sel(shoeI.lessThan(2.5), vec3(0.75), vec3(0.09))));
  const umbC = sel(umbI.lessThan(0.5), vec3(0.01), sel(umbI.lessThan(1.5), vec3(0.03, 0.05, 0.25), sel(umbI.lessThan(2.5), vec3(0.3, 0.02, 0.03), sel(umbI.lessThan(3.5), vec3(0.03, 0.12, 0.05), vec3(0.6, 0.45, 0.12)))));
  // hi-vis: fluorescent yellow with retro-reflective bands
  const bands = step(abs(rp.y.sub(1.095)), 0.016).add(step(abs(rp.y.sub(1.235)), 0.016)).min(1);
  const topC = mix(topRaw, mix(vec3(0.62, 0.7, 0.02), vec3(0.55), bands), hiVis);
  // clothing detail: zip, hem shadow, seams, knee wear on trousers
  const front = step(0.0, rp.z);
  const zip = front.mul(step(abs(rp.x), 0.004)).mul(step(0.96, rp.y)).mul(step(rp.y, 1.45)).mul(eq(region, 1)).mul(eq(sk.x, 0));
  const clothPixel = fwidth(rp.y).add(fwidth(rp.x)).add(fwidth(rp.z));
  const weave = sin(rp.y.mul(780)).mul(sin(rp.x.add(rp.z).mul(780)))
    .mul(float(1).sub(smoothstep(.001,.006,clothPixel))).mul(.035).add(1);
  const knit = eq(vOutfit,1), quilted = eq(vOutfit,2), overshirt = eq(vOutfit,3);
  const hem = float(1).sub(smoothstep(.020,.040,abs(rp.y.sub(.957))));
  const cuff = step(2.5,sk.x).mul(smoothstep(1.68,1.88,sk.y));
  const rib = sin(rp.x.add(rp.z).mul(480)).mul(.05).add(.83);
  const quiltSeam = smoothstep(.75,.985,cos(rp.y.mul(74))).mul(.17);
  const placket = front.mul(eq(sk.x,0)).mul(step(abs(rp.x),.014));
  const buttons = placket.mul(step(abs(rp.x),.004)).mul(smoothstep(.91,.995,cos(rp.y.mul(71))));
  const topSurface = topC.mul(weave)
    .mul(mix(float(1),rib,knit.mul(max(hem,cuff))))
    .mul(float(1).sub(quilted.mul(quiltSeam)))
    .mul(float(1).sub(overshirt.mul(placket.mul(.18).add(buttons.mul(.58)))))
    .mul(float(1).sub(zip.mul(.5).mul(float(1).sub(max(knit,overshirt)))));
  const knees = eq(region, 2).mul(front).mul(smoothstep(0.08, 0.0, abs(rp.y.sub(0.5)))).mul(0.12);
  // face: baked atlas (faceBake.js) projected from the front onto the head. R shading, G facial hair,
  // B lip / blush tint, A eye mask (sclera, iris, pupil)
  const face = eq(region, 0).mul(eq(sk.x, 0)).mul(step(1.5, rp.y)).mul(smoothstep(0.012, 0.05, rp.z));
  const fuv = vec2(rp.x.sub(FA.x0).div(FA.w), rp.y.sub(FA.y0).div(FA.h)).clamp(0.004, 0.996);
  const fcell = vec2(vFace.sub(floor(vFace.div(FA.cols)).mul(FA.cols)), float(FA.rows - 1).sub(floor(vFace.div(FA.cols))));
  const ft = texture(faceTex, fuv.add(fcell).div(vec2(FA.cols, FA.rows)));
  const shade = mix(float(1), ft.r.mul(2), face), tint = ft.b.mul(face), eyeA = ft.a.mul(face);
  const white = smoothstep(0.17, 0.3, eyeA), iris = smoothstep(0.45, 0.6, eyeA), pupil = smoothstep(0.8, 0.95, eyeA);
  let skinD = skinC.mul(mix(vec3(1), vec3(1.0, 0.6, 0.58), tint.mul(0.8)));
  skinD = mix(skinD, hairC.mul(0.72), ft.g.mul(face));
  skinD = mix(skinD, vec3(0.72, 0.7, 0.68), white);
  skinD = mix(skinD, mix(vec3(0.05, 0.03, 0.015), vec3(0.08, 0.12, 0.16), vHairC.w), iris);
  skinD = mix(skinD, vec3(0.006), pupil).mul(shade);
  const portraitCell = vec2(vFace.mod(2),float(1).sub(step(3.5,vFace)));
  const portrait = texture(portraitTex,fuv.add(portraitCell).mul(.5));
  const facialColour = mix(skinC.mul(portrait.rgb).mul(2),hairC.mul(.65),ft.g.mul(.78));
  skinD = mix(skinD,facialColour,face.mul(portrait.a).mul(.92));
  // hair: baked strand map, tri-planar in head space (strands run down the sides and front to back on top)
  const hw = pow(abs(normalGeometry), vec3(4)), hwn = hw.div(hw.x.add(hw.y).add(hw.z).add(1e-4));
  // curly hair: the same map, finer and rotated, reads as tight coils instead of combed strands
  const curly = eq(sk.w, TAG.hairCurly);
  const huv = (a, b) => mix(vec2(a.mul(12.5), b.mul(10)), vec2(a.mul(34).add(b.mul(22)), b.mul(34).sub(a.mul(22))), curly);
  const ht = texture(hairTex, huv(rp.x, rp.y)).mul(hwn.z)
    .add(texture(hairTex, huv(rp.z, rp.y)).mul(hwn.x))
    .add(texture(hairTex, huv(rp.x, rp.z)).mul(hwn.y));
  const strands = ht.r.mul(1.15).add(0.42).mul(ht.g.mul(0.9).add(0.55));
  const sole = eq(region, 3).mul(step(rp.y, 0.016));
  const shoeD = mix(shoeC, sel(shoeI.greaterThan(1.5).and(shoeI.lessThan(2.5)), vec3(0.85), vec3(0.03)), sole);
  let col = sel(region.lessThan(0.5), skinD,
    sel(region.lessThan(1.5), topSurface,
    sel(region.lessThan(2.5), legC.mul(weave).mul(float(1).add(knees)),
    sel(region.lessThan(3.5), shoeD,
    sel(region.lessThan(4.5), hairC.mul(strands),
    sel(region.lessThan(6.5), vec3(0.012, 0.014, 0.02),
    sel(region.lessThan(7.5), umbC,
    sel(region.lessThan(8.5), vec3(0.06, 0.035, 0.02),
    sel(region.lessThan(9.5), vec3(0.025),
    sel(region.lessThan(10.5), topRaw.mul(0.55), vec3(0.6, 0.6, 0.62)))))))))));
  // rain soaks clothes (not skin, not the umbrella) unless the umbrella is up
  const soak = U.wet.mul(float(1).sub(step(0.5, vMisc.w))).mul(step(0.5, region)).mul(step(region, 2.5)).mul(0.28);
  col = col.mul(float(1).sub(soak));
  m.colorNode = col.mul(cloudShadow(positionWorld));
  m.roughnessNode = sel(region.lessThan(0.5), mix(mix(float(0.5), float(0.36), tint), float(0.2), white.add(iris).min(1)),
    sel(region.lessThan(2.5), mix(float(0.86), float(0.55), soak.mul(3)), sel(region.lessThan(3.5), float(0.42), sel(region.lessThan(4.5), float(0.62).sub(ht.r.mul(0.22)),
    sel(region.lessThan(6.5), float(0.3), sel(region.lessThan(7.5), float(0.28), float(0.5)))))));
  m.metalnessNode = eq(region, 11).mul(0.9);
  // faint subsurface warmth on skin; retro-reflective bands glow under headlights at night
  m.emissiveNode = lightPool(positionWorld).mul(col).add(skinD.mul(eq(region, 0)).mul(vec3(0.04, 0.015, 0.01))).add(vec3(0.4).mul(bands.mul(hiVis).mul(eq(region, 1)).mul(U.night)));
  return m;
}

// ------------------------------------------------------------------ crowd
const SKINS = [0xf1c7a5, 0xe8b893, 0xe0ac86, 0xc68a62, 0xa86f4c, 0x8d5a3b, 0x5e3a26, 0xf5d0b5];
const GREYS = [0x6b6b6b, 0x8f8b85, 0xb8b2a8, 0xd8d0c0];
const HAIRS = [0x2a1d14, 0x4a3122, 0x8b6a3e, 0x1b1b1b, 0xb9a27a, 0x6b6b6b, 0xd8d0c0, 0x6e2f1a, 0x3a2a20];
const TOPS = [0x2d3e50, 0x6b2737, 0x2f4f2f, 0x8a6d3b, 0x444444, 0xbfb8a5, 0x1f2f55, 0x7a7a7a, 0x9e3a2b, 0x3c5a6e, 0x111111, 0xd9d4c7, 0x5a6b3c, 0x7b5c8a, 0x2b2b30, 0xa88a5a];
const LEGS = [0x22252b, 0x2b3a55, 0x3e3a33, 0x111111, 0x5a5348, 0x3a4a63, 0x1d2840, 0x6b6156];

function packLook(L, a) {
  const style = L.bald ? 0 : (L.style ?? 1);
  let flags = (a.hat ? 1 : 0) | (a.pose === 'umbrella' ? 2 : 0) | (L.bag && !a.hiVis ? 4 : 0) | (a.hiVis ? 8 : 0) | (L.cap && !a.hat ? 16 : 0) | (L.hood ? 32 : 0);
  flags += 2048 * (a.hiVis ? 0 : (L.outfit ?? 0));
  flags += 64 * ((L.shoe ?? 0) & 3) + 256 * (L.umbIdx ?? 0);
  const face = (L.female ? 4 : 0) + ((L.face ?? 0) & 3);
  return [style + face * 0.05, flags, L.h || 1, Math.min(0.999, Math.max(0, L.build ?? 0.35)) + (L.female ? 2 : 0)];
}

let sharedClothing;
const bodies = new Map();

// A batch owns its instance data. Street crowds and seated passengers share the model and textures.
export function createCrowdBatch(max, detailed, shadows = false) {
  if (!bodies.has(detailed)) bodies.set(detailed,bodyGeometry(detailed));
  const model = bodies.get(detailed), geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(model.index);
  for (const [name,attr] of Object.entries(model.attributes)) geo.setAttribute(name,attr);
  const set = {max,geo};
  for (const name of ['iPos','iAnim','iCol','iSty']) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(max*4),4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name,attr);
    set[name] = attr;
  }
  set.mesh = new THREE.Mesh(geo,sharedClothing ??= crowdMaterial());
  set.mesh.castShadow = shadows;
  set.mesh.receiveShadow = true;
  set.mesh.frustumCulled = false;
  set.mesh.visible = false;
  geo.instanceCount = 0;
  return set;
}

export function disposeCrowdBatch(set) {
  // Shared vertex and index buffers outlive any individual bus or train.
  set.geo.setIndex(null);
  for (const name of ['position','normal','skin']) set.geo.deleteAttribute(name);
  set.geo.dispose();
}

export class People {
  constructor(scene, shadows) {
    this.list = [];
    this.rigs = new RiggedPeople(scene);
    this.sets = [MAX0,MAX1].map((max,lod) => {
      const set = createCrowdBatch(max,lod === 0,shadows && lod === 0);
      scene.add(set.mesh);
      return set;
    });
    this.tris = this.sets.map(s => s.geo.index.count / 3);
  }
  static randomLook(r = Math.random) {
    const pick = a => a[Math.floor(r() * a.length)];
    const female = r() < 0.48;
    const style = female ? [2, 2, 2, 3, 1, 4][Math.floor(r() * 6)] : [1, 1, 1, 1, 4, 0][Math.floor(r() * 6)];
    // face (faceBake.js): men clean shaven / stubble / beard / older; women young / natural / made up / older
    const face = female ? [0, 0, 1, 1, 2, 3][Math.floor(r() * 6)] : [0, 0, 1, 1, 2, 3][Math.floor(r() * 6)];
    return {
      face, outfit: Math.floor(r()*4), skin: pick(SKINS), hair: face === 3 && r() < 0.7 ? pick(GREYS) : pick(HAIRS), top: pick(TOPS), legs: pick(LEGS), bald: style === 0, style, female,
      build: Math.min(1, Math.max(0, 0.3 + (r() - 0.5) * 0.7)), shoe: Math.floor(r() * 4), cap: !female && r() < 0.12, hood: r() < 0.18,
      bag: r() < 0.25, umbrella: 0, umbIdx: Math.floor(r() * 5), h: female ? 0.93 + r() * 0.08 : 0.98 + r() * 0.08,
    };
  }
  draw(actors, camPos, maxDist = 160, dt = 0) {
    const cnt = [0, 0];
    const detailed = this.rigs.update(actors, camPos, dt);
    for (const a of actors) {
      if (!a.visible || detailed.has(a.id)) continue;
      const dx = a.x - camPos.x, dz = a.z - camPos.z, d2 = dx * dx + dz * dz;
      if (d2 > maxDist * maxDist) continue;
      const lod = d2 < LOD_DIST * LOD_DIST ? 0 : 1, S = this.sets[lod];
      let i = cnt[lod]; if (i >= S.max) { if (lod === 0 && cnt[1] < this.sets[1].max) { i = cnt[1]; writeCrowdMember(this.sets[1], i, a); cnt[1]++; } continue; }
      writeCrowdMember(S, i, a); cnt[lod]++;
    }
    for (let k = 0; k < 2; k++) {
      const S = this.sets[k]; S.geo.instanceCount = cnt[k]; S.mesh.visible = cnt[k] > 0;
      if (cnt[k]) for (const at of [S.iPos, S.iAnim, S.iCol, S.iSty]) { at.clearUpdateRanges(); at.addUpdateRange(0,cnt[k]*4); at.needsUpdate = true; }
    }
    return cnt[0] + cnt[1] + detailed.size;
  }
}

export function writeCrowdMember(S, i, a) {
    const L = a.look || {};
    const sp = a.gaitSpeed ?? a.speedNow ?? a.speed ?? 0;
    const amp = Math.min(1, sp / 1.5);
    const run = a.running || sp > 3.2 ? 2 : 0;
    const pose = POSE[a.pose] ?? 0;
    const fall = Math.min(0.99, Math.max(0, a.fall || 0));
    S.iPos.array.set([a.x, a.y, a.z, (a.heading || 0) + (a.pose === 'flee' ? Math.PI : 0)], i * 4);
    S.iAnim.array.set([a.gaitPhase ?? a.phase ?? 0, amp + run, pose + fall, a.pose === 'brace' ? a.brace : (a.t || 0) % 1000], i * 4);
    if (!L._pk || L._pkTop !== L.top) { L._pk = [L.skin ?? SKINS[0], L.top ?? TOPS[0], L.legs ?? LEGS[0], L.hair ?? HAIRS[0]]; L._pkTop = L.top; }
    S.iCol.array.set(L._pk, i * 4);
    S.iSty.array.set(packLook(L, a), i * 4);
  }
