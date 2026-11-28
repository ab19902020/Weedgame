// Everyone on the street but Cal and Leon (pedestrians, police on foot, shop staff, drivers at a scene, bus and
// train passengers). One continuous body mesh per level of detail, skinned procedurally in the vertex shader:
// every vertex carries (limb, chain coordinate, clothing region, accessory tag) and is bent around the
// hip/knee/ankle or shoulder/elbow/wrist joints by angles worked out from each person's gait phase, speed,
// pose, way of standing and (when they've been hit or shot) the reaction from hitReactions.js. The whole crowd
// is one instanced draw per level of detail (near, mid, far).
// What varies per person: face, skin, build, height, hair style (short, long, bun, curly, ponytail, buzz cut,
// bald), clothes (plain, knit, puffer, overshirt, hoodie, open jacket over a T-shirt, stripes, tracksuit; long
// coats, skirts and dresses, shorts, jeans, tights), shoes, and what they carry or wear (glasses, beanie, cap,
// headphones, scarf, backpack, shoulder bag, a carrier bag, a phone, an umbrella), how they stand (arms
// loose, hands in pockets, arms folded, texting), their arm swing and an older person's stoop.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, positionGeometry, normalGeometry, positionWorld, varyingProperty, sin, cos,
  atan, abs, max, min, mix, step, smoothstep, clamp, floor, fract, pow, length, normalize, select, texture, fwidth,
  modelWorldMatrix,
} from 'three/tsl';
import { bakeFaceAtlas, bakeHairTexture, FACE_ATLAS as FA } from './faceBake.js';
import { U, cloudShadow } from './env.js';
import { lightPool } from './materials.js';
import { worldToView } from './surfaces.js';
import { RiggedPeople } from './riggedPeople.js';
import { reactionPose } from './hitReactions.js';
import { length as tslLength, uv as tslUv, vec3 as tslVec3, float as tslFloat, smoothstep as tslSmooth } from 'three/tsl';

// instance capacity and range of each level of detail: near (fingers, full faces), mid, far
const CAP = [28, 120, 300], LOD_NEAR = 11, LOD_MID = 36;   // metres
const POSE = { walk: 0, idle: 0, flee: 0, talk: 1, phone: 2, umbrella: 3, wave: 4, point: 5, hands: 6, shelter: 7, brace: 8, seated: 9, aim: 10, hold: 11 };
const TAG = { always: 0, hairShort: 1, hairLong: 2, hairBun: 3, hairCurly: 4, hairPony: 5, hairBuzz: 6, helmet: 10, umbrella: 11, bag: 12, cap: 13, hood: 14,
  glasses: 15, beanie: 16, backpack: 17, carrier: 18, headphones: 19, scarf: 20, coat: 21, skirt: 22, phone: 23, gun: 24 };
// regions: 0 skin, 1 top, 2 trousers, 3 shoes, 4 hair, 6 helmet, 7 umbrella canopy, 8 bag, 9 dark trim, 10 cap, 11 metal,
// 12 accent (second colour: beanie, scarf, backpack, the T-shirt under an open jacket), 13 carrier bag, 14 skirt
// accessory bits (iExt.x)
const ACC = { glasses: 1, beanie: 2, backpack: 4, carrier: 8, headphones: 16, scarf: 32, coat: 64, skirt: 128, shorts: 256, tights: 512, denim: 1024, phone: 2048 };

// ------------------------------------------------------------------ geometry
class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.skin = []; this.idx = []; }
  add(geo, skinFn, nfix) {
    if (!geo.index) { const n = geo.attributes.position.count; geo.setIndex([...Array(n).keys()]); }
    geo.computeVertexNormals();
    const p = geo.attributes.position, nn = geo.attributes.normal, base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let nx = nn.getX(i), ny = nn.getY(i), nz = nn.getZ(i);
      if (nfix) { const k = nfix(x, y, z); if (k !== 1) { ny *= k; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; } }
      this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
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

// q: level of detail, 2 near (fingers, ears, full rings), 1 mid, 0 far
function bodyGeometry(q) {
  const B = new MeshBuilder(), hi = q === 2, mid = q >= 1;
  const seg = [10, 14, 22][q], lseg = [7, 9, 14][q];
  // --- torso (pelvis to neck base), asymmetric front/back for chest, belly and seat
  const T = [
    [0.862, 0.05, 0.05, 0.05, 0.01], [0.885, 0.135, 0.09, 0.1, 0.0], [0.93, 0.162, 0.104, 0.12, -0.005], [0.955, 0.168, 0.107, 0.122, -0.005],
    [1.0, 0.163, 0.106, 0.112, -0.004], [1.06, 0.158, 0.104, 0.102, 0.0], [1.13, 0.164, 0.112, 0.104, 0.004], [1.2, 0.177, 0.124, 0.106, 0.008],
    [1.27, 0.187, 0.128, 0.106, 0.008], [1.34, 0.193, 0.114, 0.106, 0.0], [1.395, 0.186, 0.098, 0.1, -0.008], [1.428, 0.152, 0.084, 0.088, -0.012],
    [1.46, 0.106, 0.07, 0.074, -0.01], [1.49, 0.066, 0.058, 0.06, -0.006],
  ].filter((_, i) => mid || i % 2 === 0 || i === 13);
  const torso = tube(T.map(([y, rx, rf, rb, z]) => ({ c: [0, y, z], rx, rf, rb, s: 0 })), seg);
  // the seat and crotch face down and went almost black under a high sun: their normals are turned outwards
  B.add(torso.geo, (x, y) => [0, 0, y < 0.952 ? 2 : 1, 0], (x, y) => y < 0.95 ? 0.3 : 1);
  // jacket hem and collar (slightly proud of the body)
  if (mid) {
    const hem = tube([{ c: [0, 0.94, -0.004], rx: 0.176, rf: 0.11, rb: 0.127, s: 0 }, { c: [0, 0.975, -0.004], rx: 0.17, rf: 0.108, rb: 0.12, s: 0 }], seg, 'y', [false, false]);
    B.add(hem.geo, () => [0, 0, 1, 0]);
    const col = tube([{ c: [0, 1.47, 0.0], rx: 0.078, rf: 0.07, rb: 0.07, s: 0 }, { c: [0, 1.515, -0.006], rx: 0.07, rf: 0.062, rb: 0.068, s: 0 }], seg, 'y', [false, false]);
    B.add(doubleSided(col.geo), () => [0, 0, 1, 0]);
  }
  // --- neck
  const neck = tube([{ c: [0, 1.45, -0.006], rx: 0.056, rf: 0.054, rb: 0.056, s: 0 }, { c: [0, 1.6, 0.004], rx: 0.049, rf: 0.047, rb: 0.05, s: 0 }], lseg, 'y', [false, true]);
  B.add(neck.geo, () => [0, 0, 0, 0]);
  // --- head: skull with jaw, chin, cheekbones; nose; ears
  const head = new THREE.SphereGeometry(0.1, [14, 28, 48][q], [10, 20, 32][q]);
  { const p = head.attributes.position; for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, ...headShape(p.getX(i), p.getY(i), p.getZ(i), mid));
  } }
  B.add(head, () => [0, 0, 0, 0]);
  if (mid) {
    for (const sx of [-1, 1]) { const e = new THREE.SphereGeometry(0.022, hi ? 8 : 6, hi ? 6 : 4); e.scale(0.42, 1.3, 0.9); e.translate(sx * 0.087, 1.655, 0.0); B.add(e, () => [0, 0, 0, 0]); }
  }
  // --- legs, shoes, arms, hands (side +1 = the person's left, +x)
  for (const sx of [1, -1]) {
    const legLimb = sx > 0 ? 1 : 2, armLimb = sx > 0 ? 3 : 4;
    const JL = [[sx * 0.092, 0.93, 0], [sx * 0.098, 0.505, 0.012], [sx * 0.1, 0.085, -0.02]];
    const legR = [[-0.2, 0.087, 0.086, 0.09], [0, 0.093, 0.094, 0.1], [0.2, 0.088, 0.09, 0.088], [0.42, 0.079, 0.08, 0.076], [0.65, 0.069, 0.07, 0.064],
      [0.88, 0.06, 0.062, 0.056], [1.0, 0.057, 0.06, 0.054], [1.1, 0.058, 0.056, 0.062], [1.3, 0.062, 0.054, 0.07], [1.55, 0.053, 0.048, 0.056], [1.8, 0.046, 0.046, 0.046], [1.95, 0.05, 0.052, 0.052]]
      .filter((_, i) => mid || i % 2 === 0 || i === 11);
    const leg = tube(legR.map(([s, rx, rf, rb]) => ({ c: s < 0 ? [sx * 0.085, 0.93 - s * 0.35, 0] : chainAt(JL, s), rx, rf, rb, s })), lseg, 'y', [true, false]);
    B.add(leg.geo, (x, y, z, i) => [legLimb, leg.S[i] ?? 0, 2, 0]);
    // shoe: along +z from heel to a rounded toe, sole flat
    const shoeRings = [[-0.075, 0.03, 0.035, 0.02], [-0.06, 0.042, 0.05, 0.04], [-0.01, 0.046, 0.052, 0.045], [0.06, 0.049, 0.04, 0.046], [0.12, 0.048, 0.032, 0.046], [0.165, 0.04, 0.026, 0.042], [0.19, 0.024, 0.018, 0.03], [0.2, 0.008, 0.008, 0.016]]
      .filter((_, i) => mid || i % 2 === 0 || i === 7);
    const shoe = tube(shoeRings.map(([z, rx, ru, rd]) => ({ c: [sx * 0.1, 0.048, z - 0.02], rx, rf: ru, rb: rd, s: 2.2 + (z + 0.075) * 2.4 })), lseg, 'z');
    { const p = shoe.geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0.004, p.getY(i))); }
    B.add(shoe.geo, (x, y, z, i) => [legLimb, shoe.S[i] ?? 2.5, 3, 0]);
    const JA = [[sx * 0.2, 1.43, -0.01], [sx * 0.225, 1.165, -0.03], [sx * 0.235, 0.905, 0.0]];
    const armR = [[-0.22, 0.056, 0.058, 0.058], [0, 0.058, 0.058, 0.058], [0.2, 0.056, 0.055, 0.055], [0.45, 0.051, 0.05, 0.05], [0.75, 0.047, 0.046, 0.047],
      [1.0, 0.046, 0.046, 0.044], [1.2, 0.046, 0.047, 0.044], [1.5, 0.041, 0.042, 0.04], [1.8, 0.036, 0.037, 0.035], [1.96, 0.038, 0.039, 0.037]]
      .filter((_, i) => mid || i % 2 === 0 || i === 9);
    const arm = tube(armR.map(([s, rx, rf, rb]) => ({ c: s < 0 ? [sx * 0.17, 1.427 - s * 0.03, -0.01] : chainAt(JA, s), rx, rf, rb, s })), lseg, 'y', [true, false]);
    B.add(arm.geo, (x, y, z, i) => [armLimb, arm.S[i] ?? 0, 1, 0]);
    // deltoid: a soft rounding of the shoulder, not a pad
    const del = new THREE.SphereGeometry(0.05, hi ? 12 : 6, hi ? 8 : 4); del.scale(0.9, 0.78, 1.0); del.translate(sx * 0.186, 1.402, -0.01);
    B.add(del, () => [armLimb, -0.06, 1, 0]);
    // hand: palm, finger block, thumb (hanging, palm facing the thigh)
    const palm = new THREE.SphereGeometry(1, mid ? 10 : 6, mid ? 8 : 4); palm.scale(0.021, 0.048, 0.04); palm.translate(sx * 0.236, 0.86, 0.004);
    B.add(palm, () => [armLimb, 2.5, 0, 0]);
    if (hi) {
      // Resting fingers taper and curl toward the thigh, with staggered knuckles.
      for (const [finger,length] of [.069,.076,.070,.056].entries()) {
        const z = .031 - finger*.016;
        const rings = [[0,.010], [.36,.009], [.75,.0078], [1,.0045]].map(([u,r]) =>
          ({c:[sx*(.239-.013*u*u), .833-length*u, z-.004*u], rx:r,rf:r,rb:r,s:2.8}));
        B.add(tube(rings,6).geo, () => [armLimb,2.8,0,0]);
      }
      const th = new THREE.CapsuleGeometry(0.0105, 0.035, 2, 6); th.rotateX(-0.5); th.translate(sx * 0.226, 0.855, 0.043);
      B.add(th, () => [armLimb, 2.6, 0, 0]);
    } else if (mid) {
      const f = new THREE.SphereGeometry(1, 6, 4); f.scale(0.017, 0.04, 0.035); f.translate(sx * 0.237, 0.8, 0.008); B.add(f, () => [armLimb, 2.8, 0, 0]);
    }
  }
  // --- hair styles (only the instance's style survives the vertex shader)
  const capShell = (r, cut, sx, sy, sz, oy, oz) => { const g = new THREE.SphereGeometry(r, mid ? 20 : 9, mid ? 10 : 5, 0, Math.PI * 2, 0, Math.PI * cut); g.scale(sx, sy, sz); g.translate(0, oy, oz); return g; };
  const hairTag = t => () => [0, 0, 4, t];
  // hair shells follow the skull at a small offset and dip under the skin below a hairline (forehead,
  // temples, sideburns, over the ears, nape), so the hairline is a clean edge rather than two
  // nearly coincident surfaces fighting
  const hairShell = (off, line, bump = 0) => {
    const g = new THREE.SphereGeometry(0.1, [12, 20, 28][q], [9, 15, 22][q]), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = headShape(p.getX(i), p.getY(i), p.getZ(i)), dx = x, dy = y - 1.66, dz = z - 0.008, l = Math.hypot(dx, dy, dz) || 1;
      const a = Math.abs(Math.atan2(x, z)), yl = lerpTable(line, a);
      let o = y > yl ? off : -0.004;
      if (bump && y > yl) o += bump * (0.5 + 0.5 * Math.sin(x * 160) * Math.sin(y * 170) * Math.sin(z * 150));
      // a little more volume over the crown than at the sides
      if (y > yl) o *= 1 + Math.max(0, (y - 1.7) / 0.08) * 0.6;
      p.setXYZ(i, x + dx / l * o, y + dy / l * o, z + dz / l * o);
    }
    g.computeVertexNormals();
    return g;
  };
  const LINE_SHORT = [[0, 1.718], [0.45, 1.712], [0.9, 1.69], [1.18, 1.645], [1.38, 1.645], [1.55, 1.695], [1.85, 1.695], [2.25, 1.605], [Math.PI, 1.59]];
  const LINE_LONG = [[0, 1.716], [0.45, 1.708], [0.9, 1.685], [1.2, 1.64], [1.5, 1.62], [Math.PI, 1.6]];
  // short crop
  B.add(hairShell(0.009, LINE_SHORT), hairTag(TAG.hairShort));
  // long: cap + fall to the shoulders behind and at the sides
  B.add(hairShell(0.011, LINE_LONG), hairTag(TAG.hairLong));
  { const pts = [[0.104, 1.7], [0.112, 1.64], [0.11, 1.57], [0.103, 1.5], [0.092, 1.44], [0.086, 1.41]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, mid ? 18 : 8, Math.PI * 0.6, Math.PI * 0.8); g.scale(0.97, 1, 1.07); g.translate(0, 0, -0.012);
    B.add(doubleSided(g), hairTag(TAG.hairLong)); }
  // bun
  B.add(hairShell(0.009, LINE_LONG), hairTag(TAG.hairBun));
  { const g = new THREE.SphereGeometry(0.042, mid ? 10 : 6, mid ? 8 : 4); g.translate(0, 1.71, -0.105); B.add(g, hairTag(TAG.hairBun)); }
  // curly / afro: bumpy, fuller shell
  B.add(hairShell(0.018, LINE_SHORT.map(([a, y]) => [a, y - 0.004]), 0.009), hairTag(TAG.hairCurly));
  // ponytail: swept back into a tail from the back of the head
  B.add(hairShell(0.008, LINE_LONG), hairTag(TAG.hairPony));
  { const tail = tube([[1.715, 0.026, -0.1], [1.67, 0.032, -0.128], [1.6, 0.03, -0.134], [1.52, 0.022, -0.128], [1.46, 0.008, -0.118]]
      .map(([y, r, z]) => ({ c: [0, y, z], rx: r, rf: r * 0.8, rb: r * 0.8, s: 0 })), mid ? 8 : 5);
    B.add(tail.geo, hairTag(TAG.hairPony)); }
  // buzz cut: hair close to the scalp
  B.add(hairShell(0.003, LINE_SHORT), hairTag(TAG.hairBuzz));
  // --- headwear and accessories
  { // custodian helmet
    const pts = [[0.0, 1.97], [0.045, 1.96], [0.092, 1.9], [0.113, 1.81], [0.117, 1.73], [0.148, 1.72], [0.15, 1.71], [0.112, 1.715]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, mid ? 20 : 10); g.translate(0, 0, -0.005);
    orient(g, c => new THREE.Vector3(0, c.y, -0.005));
    B.add(g, () => [0, 0, 6, TAG.helmet]);
    const badge = new THREE.SphereGeometry(0.022, 8, 6); badge.scale(1, 1.25, 0.3); badge.translate(0, 1.81, 0.112);
    B.add(badge, () => [0, 0, 11, TAG.helmet]);
  }
  { // baseball cap: crown + peak
    B.add(capShell(0.108, 0.5, 0.96, 0.95, 1.06, 1.69, -0.006), () => [0, 0, 10, TAG.cap]);
    const peak = new THREE.CylinderGeometry(0.085, 0.085, 0.008, mid ? 16 : 8, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    peak.scale(1, 1, 1.0); peak.rotateX(0.12); peak.translate(0, 1.695, 0.07);
    B.add(peak, () => [0, 0, 10, TAG.cap]);
  }
  { // beanie: a taller knitted crown and a turned-up cuff
    B.add(capShell(0.114, 0.53, 0.93, 1.12, 1.06, 1.685, -0.008), () => [0, 0, 12, TAG.beanie]);
    const cuff = new THREE.TorusGeometry(0.103, 0.013, mid ? 5 : 3, mid ? 18 : 9); cuff.rotateX(Math.PI / 2); cuff.scale(0.9, 1, 1.04); cuff.translate(0, 1.695, -0.008);
    B.add(cuff, () => [0, 0, 12, TAG.beanie]);
  }
  { // hood down, gathered behind the neck
    const g = new THREE.TorusGeometry(0.1, 0.035, mid ? 6 : 4, mid ? 16 : 8, Math.PI * 1.25); g.rotateX(Math.PI / 2); g.rotateY(Math.PI * 0.125 + Math.PI); g.scale(1.1, 1, 0.9); g.translate(0, 1.47, -0.03);
    B.add(g, () => [0, 0, 1, TAG.hood]);
  }
  if (mid) { // glasses: two rims, a bridge and the arms back to the ears
    for (const sx of [-1, 1]) {
      const rim = new THREE.TorusGeometry(0.018, 0.0024, 3, hi ? 12 : 8); rim.scale(1.1, 0.85, 1); rim.translate(sx * 0.034, 1.666, 0.112);
      B.add(rim, () => [0, 0, 9, TAG.glasses]);
      const armG = new THREE.BoxGeometry(0.003, 0.004, 0.105); armG.translate(sx * 0.083, 1.668, 0.058);
      B.add(armG, () => [0, 0, 9, TAG.glasses]);
    }
    const bridge = new THREE.BoxGeometry(0.03, 0.003, 0.003); bridge.translate(0, 1.671, 0.116); B.add(bridge, () => [0, 0, 9, TAG.glasses]);
  }
  { // headphones: band over the crown, cups over the ears
    const band = new THREE.TorusGeometry(0.113, 0.007, 3, mid ? 14 : 8, Math.PI); band.scale(0.9, 1, 1); band.translate(0, 1.668, -0.004);
    B.add(band, () => [0, 0, 9, TAG.headphones]);
    for (const sx of [-1, 1]) { const cup = new THREE.CylinderGeometry(0.032, 0.032, 0.024, mid ? 12 : 6); cup.rotateZ(Math.PI / 2); cup.translate(sx * 0.098, 1.66, 0.0); B.add(cup, () => [0, 0, 9, TAG.headphones]); }
  }
  { // scarf: wrapped round the neck, one end hanging down the chest
    const wrap = new THREE.TorusGeometry(0.072, 0.026, mid ? 6 : 4, mid ? 14 : 8); wrap.rotateX(Math.PI / 2); wrap.scale(1.12, 1.25, 1.02); wrap.translate(0, 1.475, 0.0);
    B.add(wrap, () => [0, 0, 12, TAG.scarf]);
    const end = new THREE.BoxGeometry(0.07, 0.24, 0.016); end.rotateX(-0.12); end.translate(0.035, 1.33, 0.128);
    B.add(end, () => [0, 0, 12, TAG.scarf]);
  }
  { // umbrella held above the head (moves with the chest)
    const c = new THREE.ConeGeometry(0.56, 0.24, mid ? 16 : 8, 1, true); const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); if (y < 0) p.setY(i, y + 0.025 * Math.cos(Math.atan2(z, x) * 8)); }
    c.translate(-0.13, 2.13, 0.16);
    B.add(doubleSided(c), () => [0, 0, 7, TAG.umbrella]);
    const sh = new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5); sh.translate(-0.13, 1.72, 0.16); B.add(sh, () => [0, 0, 9, TAG.umbrella]);
    const tip = new THREE.CylinderGeometry(0.004, 0.006, 0.06, 4); tip.translate(-0.13, 2.27, 0.16); B.add(tip, () => [0, 0, 9, TAG.umbrella]);
  }
  { // shoulder bag flat against the left hip with a strap across the chest
    const g = new THREE.BoxGeometry(0.065, 0.22, 0.3, 1, 2, 2); { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i), zz = p.getZ(i); p.setX(i, p.getX(i) * (1 - 0.35 * Math.abs(zz) / 0.15) * (yy > 0.05 ? 0.8 : 1)); } }
    g.translate(0.215, 0.97, 0.0);
    B.add(g, () => [0, 0, 8, TAG.bag]);
    const strap = new THREE.TorusGeometry(0.29, 0.007, 3, 20, Math.PI * 0.55); strap.rotateY(Math.PI / 2); strap.rotateX(0.62); strap.translate(0.06, 1.18, 0.0);
    B.add(strap, () => [0, 0, 8, TAG.bag]);
  }
  { // backpack: a rounded pack between the shoulder blades and two straps over the shoulders
    const g = new THREE.CapsuleGeometry(0.1, 0.15, mid ? 4 : 2, mid ? 10 : 6); g.scale(1.18, 1, 0.6); g.translate(0, 1.22, -0.19);
    B.add(g, () => [0, 0, 12, TAG.backpack]);
    for (const sx of [-1, 1]) {
      const st = new THREE.TorusGeometry(0.135, 0.011, 3, mid ? 10 : 6, Math.PI); st.rotateY(Math.PI / 2); st.translate(sx * 0.1, 1.322, -0.04);
      B.add(st, () => [0, 0, 9, TAG.backpack]);
    }
  }
  { // carrier bag hanging from the right hand (rides on the hand)
    const g = new THREE.BoxGeometry(0.06, 0.29, 0.25, 1, 2, 1); { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.1) p.setZ(i, p.getZ(i) * 0.8); }
    g.translate(-0.252, 0.635, 0.0);
    B.add(g, () => [4, 2.5, 13, TAG.carrier]);
    const handle = new THREE.TorusGeometry(0.05, 0.005, 3, 8, Math.PI); handle.rotateY(Math.PI / 2); handle.translate(-0.25, 0.78, 0.0);
    B.add(handle, () => [4, 2.5, 13, TAG.carrier]);
  }
  { // phone in the right hand (to the ear on a call, held in front when texting)
    const g = new THREE.BoxGeometry(0.011, 0.14, 0.07); g.translate(-0.226, 0.84, 0.03);
    B.add(g, () => [4, 2.6, 9, TAG.phone]);
  }
  { // an officer's pistol in the right hand, only while aiming (pose 'aim'): in the rest pose the barrel points down
    // the arm (it comes up level as the arms come up) with the slide on the back of the hand and the grip in the palm
    const slide = new THREE.BoxGeometry(0.028, 0.17, 0.03); slide.translate(-0.229, 0.8, 0.045);
    const grip = new THREE.BoxGeometry(0.026, 0.035, 0.085); grip.translate(-0.229, 0.865, 0.0);
    B.add(slide, () => [4, 2.6, 9, TAG.gun]); B.add(grip, () => [4, 2.6, 9, TAG.gun]);
  }
  { // long coat: from the waist to the knees, swinging with the thighs; a skirt or dress to just above the knee
    const ring = (y, rx, rf, rb) => ({ c: [0, y, -0.004], rx, rf, rb, s: 0 });
    const coat = tube([ring(0.99, 0.176, 0.114, 0.128), ring(0.9, 0.202, 0.128, 0.14), ring(0.72, 0.21, 0.138, 0.15), ring(0.5, 0.216, 0.146, 0.156)], seg, 'y', [false, false]);
    B.add(doubleSided(coat.geo), () => [5, 0, 1, TAG.coat]);
    const skirt = tube([ring(0.975, 0.17, 0.11, 0.126), ring(0.9, 0.195, 0.124, 0.138), ring(0.76, 0.214, 0.142, 0.154), ring(0.6, 0.226, 0.156, 0.166)], seg, 'y', [false, false]);
    B.add(doubleSided(skirt.geo), () => [5, 0, 14, TAG.skirt]);
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
      .017*form(.032,1.683,.029,.011) - .018*form(.034,1.662,.020,.012)
      + .014*form(.051,1.640,.022,.017) + .022*form(0,1.651,.009,.029)
      + .026*form(0,1.633,.013,.010) + .010*form(.012,1.629,.006,.005)
      + .007*form(.008,1.606,.016,.004) + .008*form(0,1.598,.020,.005)
      + .011*form(0,1.571,.026,.013)
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

// tex: a texture atlas (the citizen pack) instead of the procedural clothes, faces and hair: the same skinning, gait,
// stances and reactions, without the body-shape changes (the meshes have their own shapes)
// a wound's blood on the body (gore.js sets ped.wounds): w = (angle round the body from the front, height on a standing
// body, how far it's soaked, how wet). Measured round the body (so it works on a citizen's mesh as on ours), spreading
// further down than up as it runs, ragged at the edge; the two wounds together
function woundBlood(rp, w0, w1) {
  const one = w => {
    let da = atan(rp.x, rp.z).sub(w.x);
    da = da.sub(floor(da.add(Math.PI).div(Math.PI * 2)).mul(Math.PI * 2));
    const dy = rp.y.sub(w.y), down = step(dy, 0);
    const d = length(vec2(da.mul(0.15), dy.mul(mix(float(1), float(0.42), down))));
    const rag = sin(rp.x.mul(61).add(rp.y.mul(47))).mul(sin(rp.z.mul(53).sub(rp.y.mul(39)))).mul(0.22).add(1);
    return float(1).sub(smoothstep(w.z.mul(0.5), w.z, d.mul(rag))).mul(step(0.001, w.z)).mul(w.w);
  };
  return max(one(w0), one(w1));
}
// darker and nearly black where it's soaked through, a brighter wet red at the edge
const bloodColour = b => mix(vec3(0.12, 0.006, 0.005), vec3(0.04, 0.0018, 0.0013), smoothstep(0.5, 1.0, b));
function crowdMaterial(tex = null) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  if (tex) m.side = THREE.DoubleSide;   // (the pack's skirts and hair are single sheets)
  const sk = attribute('skin', 'vec4');
  const iPos = attribute('iPos', 'vec4'), iAnim = attribute('iAnim', 'vec4'), iCol = attribute('iCol', 'vec4'), iSty = attribute('iSty', 'vec4');
  const iExt = attribute('iExt', 'vec4'), iR1 = attribute('iR1', 'vec4'), iR2 = attribute('iR2', 'vec4'), iR3 = attribute('iR3', 'vec4');
  const vN = varyingProperty('vec3', 'vSkinN');
  // packed per-person data is decoded here, where it is exact (interpolated varyings would scramble the bits).
  // Packed tight: WebGPU gives a pipeline 16 inter-stage slots (WebGL packs varyings itself), and with three.js's own
  // and the rest-pose position and normal this used 18, so on WebGPU nobody drawn by this material showed (police,
  // firefighters, paramedics, shop and café staff). The skin attribute's four values (limb, chain, region, tag) ride
  // in the four colours' fourth slots; the outfit and the face cell share one.
  const vSkinC = varyingProperty('vec4', 'vSkinC'), vTopC = varyingProperty('vec4', 'vTopC'), vLegC = varyingProperty('vec4', 'vLegC'), vHairC = varyingProperty('vec4', 'vHairC');
  const vAccC = varyingProperty('vec4', 'vAccC');
  const vMisc = varyingProperty('vec4', 'vMisc');   // hi-vis, shoe index, umbrella index, umbrella up
  const vLegs = varyingProperty('vec4', 'vLegs');   // shorts, tights, denim, outfit * 8 + face atlas cell (0-3 men, 4-7 women)
  const skV = vec4(vSkinC.w, vTopC.w, vLegC.w, vAccC.w);   // (the skin attribute, as the fragments see it)
  const ofV = floor(vLegs.w.add(0.5)), vOutfit = floor(ofV.div(8).add(0.01)), vFace = ofV.sub(vOutfit.mul(8));
  // two wounds (gore.js): the angle round the body from the front, the height, how far the blood has soaked, how wet
  const vW0 = varyingProperty('vec4', 'vW0'), vW1 = varyingProperty('vec4', 'vW1');
  const iW0 = attribute('iW0', 'vec4'), iW1 = attribute('iW1', 'vec4');
  const faceTex = bakeFaceAtlas(), hairTex = bakeHairTexture();
  // Neutralised facial albedo (skin detail, brows, lips) baked from character scans: one cell per face type.
  const portraitTex = new THREE.TextureLoader().load('assets/people/face-detail.png');
  portraitTex.colorSpace = THREE.NoColorSpace;
  portraitTex.anisotropy = 4;
  m.positionNode = Fn(() => {
    const limb = sk.x, s = sk.y, tag = sk.w;
    // iSty.x = hair style + 0.05 x face index
    const style = floor(iSty.x.add(0.01)), flags = floor(iSty.y.add(0.5)), hgt = iSty.z;
    const acc = floor(iExt.x.add(0.5)), gait = floor(iExt.z.add(0.5));
    const outfitI = floor(flags.div(2048)), faceI = floor(fract(iSty.x).mul(20).add(0.5));
    vW0.assign(iW0); vW1.assign(iW1);
    vSkinC.assign(vec4(unpack(iCol.x), sk.x)); vTopC.assign(vec4(unpack(iCol.y), sk.y)); vLegC.assign(vec4(unpack(iCol.z), sk.z)); vAccC.assign(vec4(unpack(iExt.y), sk.w));
    vHairC.assign(vec4(unpack(iCol.w), step(0.6, fract(iCol.x.mul(0.000031)))));
    vMisc.assign(vec4(bit(flags, 3), floor(flags.div(64)).sub(floor(flags.div(256)).mul(4)), floor(flags.div(256)).mod(8), bit(flags, 1)));
    vLegs.assign(vec4(bit(acc, 8), bit(acc, 9), bit(acc, 10), outfitI.mul(8).add(faceI)));
    const female = step(1.5, iSty.w), build = iSty.w.sub(female.mul(2));
    const phi = iAnim.x, run = step(1.5, iAnim.y), amp = iAnim.y.sub(run.mul(2));
    const pose = floor(iAnim.z.add(0.01)), t = iAnim.w;
    // how they stand and walk: 0 arms loose, 1 hands in pockets, 2 arms folded (standing), 3 texting; arm swing; stoop
    const istyle = floor(gait.mod(128).div(16)), swingK = gait.mod(16).mul(0.085).add(0.7), stoop = step(127.5, gait);
    // the reaction to a blow or a round (hitReactions.js, resolved against the way they face)
    const rF = iR1.x, rS = iR1.y, rTw = iR1.z, rHead = iR1.w;
    const clutch = iR2.x, flail = iR2.y, armOne = iR2.z, rKnee = iR2.w;
    const rHips = iR3.x, kneelS = iR3.y, fall = iR3.z, fallYaw = iR3.w, drop = iExt.w;
    // ---- accessory / hair-style visibility
    const hairOn = step(0.5, tag).mul(step(tag, 6.5)).mul(step(abs(tag.sub(style)), 0.5));
    const phoneOn = eq(pose, 2).add(eq(istyle, 3)).min(1), gunOn = eq(pose, 10);
    const keep = eq(tag, 0).add(hairOn).add(eq(tag, 10).mul(bit(flags, 0))).add(eq(tag, 11).mul(bit(flags, 1))).add(eq(tag, 12).mul(bit(flags, 2)))
      .add(eq(tag, 13).mul(bit(flags, 4))).add(eq(tag, 14).mul(bit(flags, 5)))
      .add(eq(tag, 15).mul(bit(acc, 0))).add(eq(tag, 16).mul(bit(acc, 1))).add(eq(tag, 17).mul(bit(acc, 2))).add(eq(tag, 18).mul(bit(acc, 3)))
      .add(eq(tag, 19).mul(bit(acc, 4))).add(eq(tag, 20).mul(bit(acc, 5))).add(eq(tag, 21).mul(bit(acc, 6))).add(eq(tag, 22).mul(bit(acc, 7)))
      .add(eq(tag, 23).mul(phoneOn)).add(eq(tag, 24).mul(gunOn)).min(1);
    // ---- body shape in the rest pose
    let p = positionGeometry, n = normalGeometry;
    const y = p.y;
    const isTorso = eq(limb, 0), isSkirt = eq(limb, 5);
    const isLeg = step(0.5, limb).mul(step(limb, 2.5)), isArm = step(2.5, limb).mul(step(limb, 4.5)), isLimb = isLeg.add(isArm);
    const odd = step(0.5, fract(limb.mul(0.5))), side = odd.mul(2).sub(1);
    if (!tex) {
    const shoulderZone = smoothstep(1.22, 1.4, y), hipZone = smoothstep(0.82, 0.9, y).mul(smoothstep(1.08, 0.96, y)), waistZone = smoothstep(0.98, 1.06, y).mul(smoothstep(1.16, 1.07, y));
    const torsoBody = isTorso.add(isSkirt).mul(step(y, 1.5)).mul(eq(tag, 0).add(eq(tag, 17)).add(eq(tag, 21)).add(eq(tag, 22)).min(1));
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
    const quilt = eq(outfitI,2).mul(eq(sk.z,1));
    const loft = sin(y.mul(74)).mul(.0025).add(.007).mul(quilt);
    p = p.add(n.mul(loft));
    }
    // ---- gait and pose angles
    const idle = float(1).sub(amp.min(1));
    const brace = eq(pose, 8).mul(iAnim.w), seated = eq(pose, 9);
    // the leg that takes the weight at rest (the other knee eases) and the kneeling leg of a leg wound
    const restSide = step(0.5, fract(hgt.mul(37.7))).mul(2).sub(1), kneelAmt = abs(kneelS);
    const thighOf = (o, sd) => {
      const psi = phi.add(float(Math.PI).mul(float(1).sub(o))), kThis = step(0, kneelS.mul(sd)), relaxed = step(0, restSide.mul(sd)).mul(idle).mul(eq(pose, 0));
      return seated.mul(1.48).add(brace.mul(o.mul(.2).add(.28))).add(amp.mul(sin(psi)).mul(run.mul(0.25).add(0.52)))
        .add(rHips).add(kneelAmt.mul(mix(float(1.35), float(0.15), kThis))).add(relaxed.mul(0.07));
    };
    const thigh = thighOf(odd, side);
    const psiL = phi.add(float(Math.PI).mul(float(1).sub(odd)));
    const kneeS = max(sin(psiL.add(1.3)), 0);
    const kThisLeg = step(0, kneelS.mul(side)), relaxedLeg = step(0, restSide.mul(side)).mul(idle).mul(eq(pose, 0));
    const knee = amp.mul(kneeS.mul(kneeS).mul(run.mul(0.7).add(0.62)).add(0.1)).add(0.04).add(brace.mul(.67)).add(seated.mul(1.49))
      .add(rKnee).add(kneelAmt.mul(mix(float(1.3), float(1.65), kThisLeg))).add(relaxedLeg.mul(0.17));
    const ankle = amp.mul(0.25).mul(sin(psiL.sub(0.6)));
    const psiA = psiL.add(Math.PI);
    const isR = float(1).sub(odd);   // the person's right arm carries the props
    // arms while walking or standing: a natural swing (each person's own), elbows a little bent
    const gFlex = amp.mul(sin(psiA)).mul(run.mul(0.3).add(0.35)).mul(swingK).add(idle.mul(float(0.05).add(sin(t.mul(0.9).add(side)).mul(0.03))));
    const gElb = amp.mul(max(sin(psiA), 0).mul(0.25).add(0.15)).add(run.mul(1.15)).add(0.24);
    const gAbd = float(.012).add(build.mul(.06)).sub(female.mul(.01));   // arms hang close to the body, not held out
    // way of standing (pockets and texting on the move as well; folded arms only standing still)
    const pockets = eq(istyle, 1), folded = eq(istyle, 2).mul(idle), texting = eq(istyle, 3).mul(isR);
    const st = pockets.add(folded).add(texting).min(1).mul(eq(pose, 0)).mul(float(1).sub(run));
    const sFlex = pockets.mul(0.05).add(folded.mul(0.38)).add(texting.mul(0.5));
    const sAbd = pockets.mul(0.2).add(folded.mul(-0.04)).add(texting.mul(0.06));
    const sElb = pockets.mul(0.62).add(folded.mul(1.28)).add(texting.mul(1.6));
    const sTw = pockets.mul(0.32).add(folded.mul(1.05)).add(texting.mul(0.5));
    const armPose = isArm.mul(sel(pose.greaterThan(5.5), float(1), isR.mul(step(0.5, pose)))).mul(mix(float(1),brace,eq(pose,8)));
    const aimP = eq(pose, 10), holdP = eq(pose, 11);
    const pFlex = sel(eq(pose, 1).greaterThan(0.5), sin(t.mul(3.1)).mul(0.25).add(0.5), sel(eq(pose, 2).greaterThan(0.5), float(0.35), sel(eq(pose, 3).greaterThan(0.5), float(1.0),
      sel(eq(pose, 4).greaterThan(0.5), float(0.2), sel(eq(pose, 5).greaterThan(0.5), float(1.45), sel(eq(pose, 6).greaterThan(0.5), float(0.3), sel(aimP.greaterThan(0.5), float(1.5), sel(holdP.greaterThan(0.5), float(1.05), float(0.55)))))))));
    const pAbd = sel(eq(pose, 1).greaterThan(0.5), float(0.15), sel(eq(pose, 2).greaterThan(0.5), float(0.45), sel(eq(pose, 3).greaterThan(0.5), float(0.05),
      sel(eq(pose, 4).greaterThan(0.5), float(2.5), sel(eq(pose, 5).greaterThan(0.5), float(0.1), sel(eq(pose, 6).greaterThan(0.5), float(2.7), sel(aimP.greaterThan(0.5), float(0.05), sel(holdP.greaterThan(0.5), float(0.08), float(-0.32)))))))));
    const pElb = sel(eq(pose, 1).greaterThan(0.5), sin(t.mul(2.3)).mul(0.2).add(1.3), sel(eq(pose, 2).greaterThan(0.5), float(2.55), sel(eq(pose, 3).greaterThan(0.5), float(1.05),
      sel(eq(pose, 4).greaterThan(0.5), sin(t.mul(8)).mul(0.35).add(0.6), sel(eq(pose, 5).greaterThan(0.5), float(0.05), sel(eq(pose, 6).greaterThan(0.5), float(0.25), sel(aimP.greaterThan(0.5), float(0.12), sel(holdP.greaterThan(0.5), float(0.85), float(1.7)))))))));
    let aFlex = mix(mix(gFlex, sFlex, st), pFlex, armPose), aAbd = mix(mix(gAbd, sAbd, st), pAbd, armPose), aElb = mix(mix(gElb, sElb, st), pElb, armPose);
    let aTw = mix(sTw.mul(st), aimP.mul(0.3).add(holdP.mul(0.35)), armPose);
    // reactions: both hands to the stomach, arms flung out (or thrown back), one arm flung by a round or holding a wound
    aFlex = mix(aFlex, float(0.36), clutch); aAbd = mix(aAbd, float(0.02), clutch); aElb = mix(aElb, float(1.4), clutch); aTw = mix(aTw, float(0.85), clutch);
    const flOut = max(flail, 0), flBack = max(flail.negate(), 0);
    aAbd = aAbd.add(flOut.mul(1.1)).add(flBack.mul(0.35)); aFlex = aFlex.add(flOut.mul(0.3)).sub(flBack.mul(1.0)); aElb = aElb.add(flOut.mul(0.2));
    const oneA = abs(armOne), hold = step(5, oneA), oneK = oneA.sub(hold.mul(10)).mul(step(0, armOne.mul(side)));
    const holdK = oneK.mul(hold), flingK = oneK.mul(float(1).sub(hold));
    aFlex = mix(aFlex, float(0.42), holdK).sub(flingK.mul(0.5)); aElb = mix(aElb, float(1.45), holdK).add(flingK.mul(0.3)); aTw = mix(aTw, float(0.95), holdK); aAbd = mix(aAbd, float(0.04), holdK).add(flingK.mul(1.2));
    // joints of this vertex's chain
    const J1 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.2), 1.43, -0.01), vec3(side.mul(0.092), 0.93, 0));
    const J2 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.225), 1.165, -0.03), vec3(side.mul(0.098), 0.505, 0.012));
    const J3 = sel(isArm.greaterThan(0.5), vec3(side.mul(0.235), 0.905, 0.0), vec3(side.mul(0.1), 0.085, -0.02));
    const w1 = isLimb.mul(sel(isArm.greaterThan(0.5), smoothstep(-0.25, 0.0, s), smoothstep(-0.2, 0.05, s)));
    const w2 = isLimb.mul(smoothstep(0.88, 1.12, s)), w3 = isLimb.mul(smoothstep(1.9, 2.1, s));
    const th1 = sel(isArm.greaterThan(0.5), aFlex.negate(), thigh.negate()).mul(w1);
    const be1 = sel(isArm.greaterThan(0.5), side.mul(aAbd), side.mul(0.02)).mul(w1);
    const tw1 = isArm.mul(aTw).mul(side.negate()).mul(w1);
    const th2 = sel(isArm.greaterThan(0.5), aElb.negate(), knee).mul(w2);
    const th3 = sel(isArm.greaterThan(0.5), float(-0.08), ankle.negate()).mul(w3);
    p = about(p, J3, rotX, th3); n = rotX(n, th3);
    p = about(p, J2, rotX, th2); n = rotX(n, th2);
    p = about(p, J1, rotX, th1); n = rotX(n, th1);
    p = about(p, J1, rotY, tw1); n = rotY(n, tw1);
    p = about(p, J1, rotZ, be1); n = rotZ(n, be1);
    // a coat or skirt swings with whichever thigh is under it, the hem most
    { const sw = mix(thighOf(float(0), float(-1)), thighOf(float(1), float(1)), smoothstep(-0.07, 0.07, positionGeometry.x)).mul(0.82)
        .mul(smoothstep(0.97, 0.7, positionGeometry.y)).mul(isSkirt).negate();
      p = about(p, vec3(0, 0.93, 0), rotX, sw); n = rotX(n, sw); }
    // head look / nod (+ = down), then chest counter-rotation and lean (arms and head ride on the chest)
    const isUmb = eq(tag, 11);
    const wh = isTorso.mul(smoothstep(1.5, 1.565, positionGeometry.y)).mul(float(1).sub(isUmb));
    const look = idle.mul(0.35).mul(sin(t.mul(0.27).add(iPos.x))).mul(float(1).sub(st.mul(eq(istyle, 3)))).add(eq(pose, 2).mul(0.12));
    const nod = amp.mul(0.035).mul(sin(phi.mul(2))).add(eq(pose, 2).mul(0.1)).add(st.mul(eq(istyle, 3)).mul(0.42)).add(stoop.mul(0.12)).add(rHead);
    p = about(p, vec3(0, 1.53, 0), rotY, look.mul(wh)); n = rotY(n, look.mul(wh));
    p = about(p, vec3(0, 1.53, 0), rotX, nod.mul(wh)); n = rotX(n, nod.mul(wh));
    const yawP = amp.mul(0.07).mul(sin(phi));
    const wc = sel(isLeg.add(isSkirt).greaterThan(0.5), float(0), sel(isArm.greaterThan(0.5), float(1), smoothstep(0.98, 1.3, positionGeometry.y)));
    // forward lean: into a run, a little at a walk, an older person's stoop, hunched by a blow
    const lean = amp.mul(0.04).add(run.mul(0.16)).add(eq(pose, 7).mul(0.06)).add(brace.mul(.25)).add(stoop.mul(0.2)).add(rF);
    const breath = sin(t.mul(1.7)).mul(0.004).mul(idle);
    p = about(p, vec3(0, 1.0, 0), rotY, yawP.mul(-1.2).add(rTw).mul(wc)); n = rotY(n, yawP.mul(-1.2).add(rTw).mul(wc));
    p = about(p, vec3(0, 1.0, 0), rotX, lean.mul(wc)); n = rotX(n, lean.mul(wc));
    p = about(p, vec3(0, 1.0, 0), rotZ, rS.negate().mul(wc)); n = rotZ(n, rS.negate().mul(wc));
    p = p.add(vec3(0, breath.mul(wc), 0));
    // pelvis: yaw with the stride, side sway (wider for women) and vertical bob; a contrapposto hip at rest
    p = rotY(p, yawP); n = rotY(n, yawP);
    const bob = amp.mul(run.mul(0.02).add(0.025)).mul(float(0.5).sub(abs(sin(phi))));
    const sway = amp.mul(female.mul(0.012).add(0.016)).mul(sin(phi)).add(idle.mul(0.01).mul(sin(t.mul(0.6).add(iPos.z)))).add(idle.mul(eq(pose, 0)).mul(restSide).mul(-0.014));
    p = p.add(vec3(sway, bob.sub(drop), 0));
    // falls: down onto the ground about the feet, in whichever direction the blow (or the car) sent them
    const fa = fall.mul(Math.PI / 2 * 0.97);
    p = rotY(p, fallYaw.negate()); n = rotY(n, fallYaw.negate());
    p = about(p, vec3(0, 0.05, 0), rotX, fa); n = rotX(n, fa);
    p = rotY(p, fallYaw); n = rotY(n, fallYaw);
    p = p.add(vec3(0, fall.mul(0.12), 0));
    // collapse hidden accessories into the torso, scale, face the heading, place
    p = mix(vec3(0, 1.2, 0), p, keep).mul(hgt);
    const yaw = float(Math.PI / 2).sub(iPos.w);
    vN.assign(modelWorldMatrix.mul(vec4(rotY(n, yaw),0)).xyz);
    return rotY(p, yaw).add(iPos.xyz);
  })();
  const blood = woundBlood(positionGeometry, vW0, vW1);
  if (tex) return texturedLook(m, tex, vN, skV, blood);
  // fabric folds (bunching at elbows, knees and the waist), fine weave and hair strands perturb the normal
  {
    const rg = skV.z, rp0 = positionGeometry, cloth = step(0.5, rg).mul(step(rg, 2.5)).add(eq(rg, 14)).min(1);
    const elbow = step(2.5, skV.x).mul(step(skV.x, 4.5)).mul(smoothstep(0.25, 0.0, abs(skV.y.sub(1.0))));
    const kneeZ = step(0.5, skV.x).mul(step(skV.x, 2.5)).mul(smoothstep(0.08, 0.0, abs(rp0.y.sub(0.5))));
    const waist = eq(skV.x, 0).mul(smoothstep(0.05, 0.0, abs(rp0.y.sub(1.0)))).add(eq(skV.x, 0).mul(smoothstep(0.04, 0.0, abs(rp0.y.sub(0.89)))));
    const zone = elbow.add(kneeZ).add(waist).min(1).mul(cloth);
    const ridge = cos(rp0.y.mul(210).add(sin(rp0.x.mul(70).add(rp0.z.mul(50))).mul(2.5)));
    const crumple = vec3(sin(rp0.y.mul(97).add(rp0.x.mul(53))), sin(rp0.z.mul(89).add(rp0.y.mul(71))), sin(rp0.x.mul(83).add(rp0.z.mul(61))));
    const strands = eq(rg, 4).mul(sin(rp0.x.mul(520).add(rp0.z.mul(300))));
    m.normalNode = worldToView(normalize(vN.add(vec3(0, ridge.mul(zone).mul(0.14), 0)).add(crumple.mul(cloth.mul(0.024))).add(vec3(strands.mul(0.18), 0, strands.mul(0.12)))));
  }
  // ---- appearance
  const region = skV.z, rp = positionGeometry, limbF = skV.x, chainS = skV.y;
  const hiVis = step(0.5, vMisc.x);
  const skinC = vSkinC.xyz, topRaw = vTopC.xyz, legRaw = vLegC.xyz, hairC = vHairC.xyz, accC = vAccC.xyz;
  const shorts = vLegs.x, tights = vLegs.y, denim = vLegs.z;
  const shoeI = floor(vMisc.y.add(0.5)), umbI = floor(vMisc.z.add(0.5));
  // shoes: black leather, brown leather, white trainers, dark trainers on white soles
  const shoeC = sel(shoeI.lessThan(0.5), vec3(0.014), sel(shoeI.lessThan(1.5), vec3(0.075, 0.038, 0.018), sel(shoeI.lessThan(2.5), vec3(0.55, 0.55, 0.53), vec3(0.035, 0.04, 0.055))));
  const umbC = sel(umbI.lessThan(0.5), vec3(0.01), sel(umbI.lessThan(1.5), vec3(0.03, 0.05, 0.25), sel(umbI.lessThan(2.5), vec3(0.3, 0.02, 0.03), sel(umbI.lessThan(3.5), vec3(0.03, 0.12, 0.05), vec3(0.6, 0.45, 0.12)))));
  const front = step(0.0, rp.z);
  const isTorsoF = eq(limbF, 0), isArmF = step(2.5, limbF).mul(step(limbF, 4.5)), isLegF = step(0.5, limbF).mul(step(limbF, 2.5));
  const outfit = floor(vOutfit.add(0.5));
  const knit = eq(outfit,1), quilted = eq(outfit,2), overshirt = eq(outfit,3), hoodie = eq(outfit, 4), openJacket = eq(outfit, 5), striped = eq(outfit, 6), tracksuit = eq(outfit, 7);
  // hi-vis: fluorescent yellow with retro-reflective bands
  const bands = step(abs(rp.y.sub(1.095)), 0.016).add(step(abs(rp.y.sub(1.235)), 0.016)).min(1);
  // an open jacket shows the T-shirt underneath down the front; stripes across a top; a tracksuit's side stripes
  const opening = isTorsoF.mul(front).mul(step(abs(rp.x), mix(float(0.03), float(0.075), smoothstep(1.42, 1.0, rp.y)))).mul(step(0.96, rp.y)).mul(step(rp.y, 1.47));
  const stripes = step(0.5, fract(rp.y.mul(14))).mul(isTorsoF.add(isArmF).min(1));
  const sideX = abs(rp.x).sub(sel(isArmF.greaterThan(0.5), float(0.235), sel(isLegF.greaterThan(0.5), float(0.1), float(9))));
  const sideStripe = step(abs(rp.z.sub(0.0)), 0.012).mul(step(0.0, sideX)).mul(isArmF.add(isLegF).min(1));
  let topC = mix(topRaw, accC, max(opening.mul(openJacket), stripes.mul(striped)));
  topC = mix(topC, vec3(0.8), sideStripe.mul(tracksuit));
  // on duty, by service (the umbrella-colour slot, unused in uniform): police in yellow with silver bands; the fire
  // brigade's tunic its own dark colour, banded yellow and silver; paramedics in yellow with green chequered bands
  const fireKit = hiVis.mul(eq(umbI, 1)), medicKit = hiVis.mul(eq(umbI, 2));
  const chequer = step(0.5, fract(rp.x.add(rp.z).mul(9).add(rp.y.mul(9))));
  const bandC = mix(vec3(0.55), mix(vec3(0.62, 0.7, 0.02), vec3(0.03, 0.27, 0.09), chequer), medicKit);
  topC = mix(topC, mix(vec3(0.62, 0.7, 0.02), bandC, bands), hiVis.sub(fireKit));
  const fireBands = step(abs(rp.y.sub(1.0)), 0.03).add(step(abs(rp.y.sub(1.235)), 0.022)).min(1);
  topC = mix(topC, mix(topC, mix(vec3(0.6), vec3(0.62, 0.62, 0.1), step(abs(rp.y.sub(1.0)), 0.012).add(step(abs(rp.y.sub(1.235)), 0.008)).min(1)), fireBands), fireKit);
  // clothing detail: zip, hem shadow, seams, knee wear on trousers, a hoodie's front pocket and cords
  const zip = front.mul(step(abs(rp.x), 0.004)).mul(step(0.96, rp.y)).mul(step(rp.y, 1.45)).mul(eq(region, 1)).mul(isTorsoF);
  const clothPixel = fwidth(rp.y).add(fwidth(rp.x)).add(fwidth(rp.z));
  const weave = sin(rp.y.mul(780)).mul(sin(rp.x.add(rp.z).mul(780)))
    .mul(float(1).sub(smoothstep(.001,.006,clothPixel))).mul(.035).add(1);
  const hem = float(1).sub(smoothstep(.020,.040,abs(rp.y.sub(.957))));
  const cuff = isArmF.mul(smoothstep(1.68,1.88,chainS));
  const rib = sin(rp.x.add(rp.z).mul(480)).mul(.05).add(.83);
  const quiltSeam = smoothstep(.75,.985,cos(rp.y.mul(74))).mul(.17);
  const placket = front.mul(isTorsoF).mul(step(abs(rp.x),.014));
  const buttons = placket.mul(step(abs(rp.x),.004)).mul(smoothstep(.91,.995,cos(rp.y.mul(71))));
  const pouch = front.mul(isTorsoF).mul(step(abs(rp.x), 0.085)).mul(step(0.985, rp.y)).mul(step(rp.y, 1.1)).mul(smoothstep(0.075, 0.085, abs(rp.x)).add(smoothstep(1.09, 1.1, rp.y)).min(1));
  const cords = front.mul(isTorsoF).mul(step(abs(abs(rp.x).sub(0.03)), 0.003)).mul(step(1.3, rp.y)).mul(step(rp.y, 1.44));
  const topSurface = topC.mul(weave)
    .mul(mix(float(1),rib,knit.add(hoodie).min(1).mul(max(hem,cuff))))
    .mul(float(1).sub(quilted.mul(quiltSeam)))
    .mul(float(1).sub(overshirt.mul(placket.mul(.18).add(buttons.mul(.58)))))
    .mul(float(1).sub(hoodie.mul(pouch.mul(0.35)))).mul(float(1).sub(hoodie.mul(cords).mul(0.5)))
    .mul(float(1).sub(zip.mul(.5).mul(float(1).sub(max(knit,overshirt)))));
  // trousers: denim has a twill, lighter wear on the thighs and knees; shorts end above the knee; tights under a skirt
  const knees = eq(region, 2).mul(front).mul(smoothstep(0.08, 0.0, abs(rp.y.sub(0.5)))).mul(0.12);
  const twill = sin(rp.x.add(rp.y).mul(900)).mul(float(1).sub(smoothstep(.001, .005, clothPixel))).mul(0.06).add(1);
  const fade = denim.mul(front).mul(isLegF).mul(smoothstep(0.75, 0.3, chainS).mul(0.18).add(smoothstep(0.15, 0.0, abs(chainS.sub(1.0))).mul(0.2)));
  let legC = mix(legRaw.mul(weave), legRaw.mul(twill).mul(float(1).add(fade.mul(1.6))), denim).mul(float(1).add(knees));
  legC = mix(legC, sel(tights.greaterThan(0.5), vec3(0.018, 0.016, 0.018), skinC), isLegF.mul(max(tights, shorts.mul(step(0.8, chainS)))));
  legC = mix(legC, topC, tracksuit.mul(float(1).sub(sideStripe)));
  // face: baked atlas (faceBake.js) projected from the front onto the head. R shading, G facial hair,
  // B lip / blush tint, A eye mask (sclera, iris, pupil)
  const face = eq(region, 0).mul(isTorsoF).mul(step(1.5, rp.y)).mul(smoothstep(0.012, 0.05, rp.z));
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
  // the scanned facial detail, divided by its own average colour so it shades this person's skin rather than
  // painting someone else's over it
  const portraitCell = vec2(vFace.mod(2),float(1).sub(step(3.5,vFace)));
  const portrait = texture(portraitTex,fuv.add(portraitCell).mul(.5));
  // (the mean is taken over the cheeks, nose and forehead, so plain skin comes out at 1)
  const cellMean = sel(vFace.mod(2).lessThan(0.5), sel(vFace.lessThan(3.5), vec3(0.417, 0.43, 0.421), vec3(0.434, 0.425, 0.421)),
    sel(vFace.lessThan(3.5), vec3(0.368, 0.353, 0.33), vec3(0.407, 0.4, 0.399)));
  const detail = portrait.rgb.div(cellMean).clamp(0.2, 1.25);
  const facialColour = mix(skinC.mul(detail), hairC.mul(.65), ft.g.mul(.78));
  skinD = mix(skinD, facialColour, face.mul(portrait.a).mul(.75).mul(float(1).sub(white.add(iris).min(1))));
  // hair: baked strand map, tri-planar in head space (strands run down the sides and front to back on top)
  const hw = pow(abs(normalGeometry), vec3(4)), hwn = hw.div(hw.x.add(hw.y).add(hw.z).add(1e-4));
  // curly hair: the same map, finer and rotated, reads as tight coils instead of combed strands
  const curly = eq(skV.w, TAG.hairCurly), buzz = eq(skV.w, TAG.hairBuzz);
  const huv = (a, b) => mix(vec2(a.mul(12.5), b.mul(10)), vec2(a.mul(34).add(b.mul(22)), b.mul(34).sub(a.mul(22))), curly);
  const ht = texture(hairTex, huv(rp.x, rp.y)).mul(hwn.z)
    .add(texture(hairTex, huv(rp.z, rp.y)).mul(hwn.x))
    .add(texture(hairTex, huv(rp.x, rp.z)).mul(hwn.y));
  const strands = ht.r.mul(1.0).add(0.45).mul(ht.g.mul(0.8).add(0.6));
  const hairD = mix(hairC.mul(strands), mix(skinC, hairC, 0.55), buzz);
  const sole = eq(region, 3).mul(step(rp.y, 0.02));
  const shoeD = mix(shoeC, sel(shoeI.greaterThan(1.5), vec3(0.62, 0.6, 0.57), vec3(0.02)), sole);
  const carrierC = sel(umbI.lessThan(1.5), vec3(0.85, 0.85, 0.82), sel(umbI.lessThan(2.5), vec3(0.75, 0.32, 0.05), sel(umbI.lessThan(3.5), vec3(0.08, 0.25, 0.08), vec3(0.12, 0.2, 0.45))));
  let col = sel(region.lessThan(0.5), skinD,
    sel(region.lessThan(1.5), topSurface,
    sel(region.lessThan(2.5), legC,
    sel(region.lessThan(3.5), shoeD,
    sel(region.lessThan(4.5), hairD,
    sel(region.lessThan(6.5), vec3(0.012, 0.014, 0.02),
    sel(region.lessThan(7.5), umbC,
    sel(region.lessThan(8.5), vec3(0.06, 0.035, 0.02),
    sel(region.lessThan(9.5), vec3(0.025),
    sel(region.lessThan(10.5), topRaw.mul(0.55),
    sel(region.lessThan(11.5), vec3(0.6, 0.6, 0.62),
    sel(region.lessThan(12.5), accC.mul(weave),
    sel(region.lessThan(13.5), carrierC, legRaw.mul(weave))))))))))))));
  // ambient occlusion in the rest pose: under the arms and down the sides they hang against, the inside of the
  // arms and thighs, under the chin, and darker towards the feet
  const armpit = isTorsoF.mul(smoothstep(0.11, 0.165, abs(rp.x))).mul(smoothstep(0.95, 1.12, rp.y)).mul(float(1).sub(smoothstep(1.36, 1.44, rp.y)));
  const innerArm = isArmF.mul(step(abs(rp.x), float(0.215))).mul(step(chainS, 1.9));
  const innerLeg = isLegF.mul(step(abs(rp.x), 0.085)).mul(smoothstep(0.6, 0.9, rp.y));
  const chin = isTorsoF.mul(smoothstep(1.45, 1.5, rp.y)).mul(float(1).sub(smoothstep(1.53, 1.58, rp.y))).mul(eq(region, 0));
  const ao = float(1).sub(armpit.mul(0.28)).sub(innerArm.mul(0.14)).sub(innerLeg.mul(0.18)).sub(chin.mul(0.3)).mul(smoothstep(-0.1, 0.55, rp.y).mul(0.2).add(0.8));
  col = col.mul(ao);
  // rain soaks clothes (not skin, not the umbrella) unless the umbrella is up
  const soak = U.wet.mul(float(1).sub(step(0.5, vMisc.w))).mul(step(0.5, region)).mul(step(region, 2.5)).mul(0.28);
  col = col.mul(float(1).sub(soak));
  col = mix(col, bloodColour(blood), blood.mul(0.94));
  m.colorNode = col.mul(cloudShadow(positionWorld));
  m.roughnessNode = mix(sel(region.lessThan(0.5), mix(mix(float(0.64), float(0.42), tint), float(0.2), white.add(iris).min(1)),
    sel(region.lessThan(2.5), mix(float(0.88), float(0.55), soak.mul(3)), sel(region.lessThan(3.5), mix(float(0.45), float(0.7), step(1.5, shoeI)), sel(region.lessThan(4.5), float(0.78).sub(ht.r.mul(0.2)),
    sel(region.lessThan(6.5), float(0.3), sel(region.lessThan(7.5), float(0.28), sel(region.lessThan(12.5), float(0.6), sel(region.lessThan(13.5), float(0.45), float(0.85))))))))), float(0.3), blood);
  m.metalnessNode = eq(region, 11).mul(0.9);
  // faint subsurface warmth on skin; retro-reflective bands glow under headlights at night
  m.emissiveNode = lightPool(positionWorld).mul(col).add(skinD.mul(eq(region, 0)).mul(vec3(0.04, 0.015, 0.01))).add(vec3(0.4).mul(max(bands.mul(hiVis.sub(fireKit)), fireBands.mul(fireKit)).mul(eq(region, 1)).mul(U.night)));
  return m;
}

// the citizens' surfaces: their own textures, darkened where rain soaks clothes, cloud shadow, lamp light
function texturedLook(m, tex, vN, sk, blood) {
  const region = sk.z, base = texture(tex, tslUv()).rgb;
  const soak = U.wet.mul(step(0.5, region)).mul(0.25);
  const col = mix(base.mul(float(1).sub(soak)), bloodColour(blood), blood.mul(0.94));
  m.colorNode = col.mul(cloudShadow(positionWorld));
  m.normalNode = worldToView(normalize(vN));
  m.roughnessNode = mix(sel(region.lessThan(0.5), float(0.62), mix(float(0.86), float(0.55), soak.mul(3))), float(0.3), blood);
  m.emissiveNode = lightPool(positionWorld).mul(col).add(col.mul(eq(region, 0)).mul(vec3(0.03, 0.012, 0.008)));
  return m;
}

// ------------------------------------------------------------------ citizens (supplied pack, auto-rigged)
// "Citizen NPC Pack 1 Character Lowpoly Mobile" by 00amza (Sketchfab), CC-BY-4.0, fitted to the crowd's skeleton by
// tools/characters/bake-citizens.py. Who is who (same order as citizens.json): sex and a typical height (the bake
// stands everyone at 1.79 m; the instance scale gives them their own)
export const CITIZENS = [
  { f: 0, h: 1.0 }, { f: 1, h: 0.93 }, { f: 0, h: 0.99 }, { f: 0, h: 1.01 }, { f: 1, h: 0.94 }, { f: 0, h: 0.98 }, { f: 1, h: 0.92 },
  { f: 0, h: 1.0 }, { f: 1, h: 0.93 }, { f: 0, h: 0.99 }, { f: 0, h: 1.02 }, { f: 0, h: 0.98 }, { f: 1, h: 0.94 }, { f: 1, h: 0.95 },
];
const CIT_CAP = 36;   // instances of each citizen drawn at once
let citizenData = null;
// fetch and build the fourteen geometries and the shared textured material (once)
function loadCitizens() {
  return citizenData ||= (async () => {
    const [J, buf] = await Promise.all([fetch('characters/citizens.json').then(r => r.json()), fetch('characters/citizens.bin').then(r => r.arrayBuffer())]);
    const L = J.layout, V = J.vertices;
    const pos = new Float32Array(buf, L.position.offset, V * 3), nq = new Int8Array(buf, L.normal.offset, V * 4);
    const uvq = new Uint16Array(buf, L.uv.offset, V * 2), skin = new Float32Array(buf, L.skin.offset, V * 4), idx = new Uint16Array(buf, L.index.offset, J.indices);
    const nrm = new Float32Array(V * 3), uv = new Float32Array(V * 2);
    for (let i = 0; i < V; i++) { nrm[i * 3] = nq[i * 4] / 127; nrm[i * 3 + 1] = nq[i * 4 + 1] / 127; nrm[i * 3 + 2] = nq[i * 4 + 2] / 127; uv[i * 2] = uvq[i * 2] / 65535; uv[i * 2 + 1] = uvq[i * 2 + 1] / 65535; }
    const tex = await new THREE.TextureLoader().loadAsync('characters/citizens.jpg');
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4;
    const models = J.citizens.map(c => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.slice(c.vStart * 3, (c.vStart + c.vCount) * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm.slice(c.vStart * 3, (c.vStart + c.vCount) * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv.slice(c.vStart * 2, (c.vStart + c.vCount) * 2), 2));
      g.setAttribute('skin', new THREE.BufferAttribute(skin.slice(c.vStart * 4, (c.vStart + c.vCount) * 4), 4));
      g.setIndex(new THREE.BufferAttribute(idx.slice(c.iStart, c.iStart + c.iCount), 1));
      return g;
    });
    return { models, material: crowdMaterial(tex) };
  })().catch(e => { console.warn('citizens', e); return null; });
}

// ------------------------------------------------------------------ crowd
// (skin albedos as measured, not as remembered: even pale skin is a warm mid tone, or it reads white in the sun)
const SKINS = [0xdca88c, 0xd49c7c, 0xc98f6c, 0xbd825e, 0xa86f4c, 0x8d5a3b, 0x6e4430, 0x5a3725, 0xe0b096, 0xb47656];
const GREYS = [0x77726c, 0x9a948b, 0xbdb6aa, 0xd6d0c4];
const HAIRS = [0x16110d, 0x221812, 0x2e2018, 0x3d2a1d, 0x4e3624, 0x664630, 0x87643e, 0xa98455, 0x5c2b17, 0x0e0c0b];
const TOPS = [0x1f2a44, 0x141414, 0x2e2e33, 0x8c8c8c, 0xe6e3dc, 0xd8cdb5, 0x5e1f2b, 0x4f5332, 0x8a7c5a, 0xa47e52, 0x23402f, 0x2b4b8c,
  0x7fa3c7, 0x9b2a2a, 0xb88a2c, 0x2f6466, 0xc98a9a, 0x8e7fa8, 0x9a4b2a, 0x4a6587, 0x3b3f46, 0x6b6f75];
const DENIM = [0x1f2b44, 0x34496b, 0x5f7898];
const LEGS = [0x121212, 0x2a2a2e, 0x55565b, 0x8f7d5c, 0x1b2233, 0x464a32, 0xb5a585, 0x3b2f2a];
const ACCENTS = [0x8a1c24, 0x1d3557, 0x2a2a2a, 0xc9a227, 0x3d5a40, 0xd9d4c7, 0x6b4f8a, 0xb55d2c, 0x2f6e7a, 0x999999, 0xe8e6e0, 0x161616];
const COATS = [0xa47e52, 0x2e2e33, 0x1f2a44, 0x141414, 0x4f5332, 0x6b5a48, 0x5e1f2b];
const TEES = [0xe8e6e0, 0x8c8c8c, 0x161616, 0xd8cdb5, 0x1f2a44];

// iSty: hair style + 0.05 x face, flags (hat, umbrella up, bag, hi-vis, cap, hood, shoe, umbrella/carrier colour, outfit),
// height, build (+2 for women)
function packStyle(L, a, out, o) {
  const style = L.bald ? 0 : (L.style ?? 1);
  const helmet = !!a.hat;
  let flags = (helmet ? 1 : 0) | (a.pose === 'umbrella' ? 2 : 0) | (L.bag && !a.hiVis && !L.backpack ? 4 : 0) | (a.hiVis ? 8 : 0) | (L.cap && !helmet ? 16 : 0) | (L.hood ? 32 : 0);
  flags += 2048 * (a.hiVis ? 0 : (L.outfit ?? 0));
  flags += 64 * ((L.shoe ?? 0) & 3) + 256 * (a.hiVis ? (a.uniform ?? 0) : (L.umbIdx ?? 0));   // in uniform: which service
  const face = (L.female ? 4 : 0) + ((L.face ?? 0) & 3);
  out[o] = style + face * 0.05; out[o + 1] = flags; out[o + 2] = L.h || 1; out[o + 3] = Math.min(0.999, Math.max(0, L.build ?? 0.35)) + (L.female ? 2 : 0);
}
// iExt: accessories, second colour, way of standing (+ arm swing, stoop), how far the body has dropped
function packExtras(L, a, reacting, out, o) {
  let acc = 0;
  if (a.hiVis) acc = L.glasses ? ACC.glasses : 0;     // on duty: uniform only
  else {
    const covered = a.hat || L.cap, handsBusy = a.pose === 'umbrella' || a.pose === 'phone' || a.pose === 'wave' || a.pose === 'point' || a.pose === 'hands' || a.pose === 'seated' || a.pose === 'aim' || a.pose === 'hold';
    if (L.glasses) acc |= ACC.glasses;
    if (L.beanie && !covered) acc |= ACC.beanie;
    if (L.backpack) acc |= ACC.backpack;
    if (L.carrier && !handsBusy && !reacting) acc |= ACC.carrier;
    if (L.headphones && !covered && !L.beanie) acc |= ACC.headphones;
    if (L.scarf) acc |= ACC.scarf;
    if (L.coat) acc |= ACC.coat;
    if (L.skirt) acc |= ACC.skirt;
    if (L.shorts) acc |= ACC.shorts;
    if (L.tights) acc |= ACC.tights;
    if (L.denim) acc |= ACC.denim;
  }
  const istyle = reacting || a.hiVis && (L.idle === 3) ? 0 : (L.idle ?? 0);
  out[o] = acc; out[o + 1] = L._acc ?? (L._acc = L.top2 ?? ACCENTS[0]); out[o + 2] = istyle * 16 + (L.swing ?? 4) + (L.stoop ? 128 : 0);
}
const legDrop = (hips, knees) => Math.max(0, 0.845 - (0.425 * Math.cos(hips) + 0.42 * Math.cos(hips - knees)));

let sharedClothing;
const bodies = new Map();

// A batch owns its instance data. Street crowds and seated passengers share the model and textures.
// detail: 2 near, 1 mid, 0 far (true / false: near / far)
export function createCrowdBatch(max, detail, shadows = false) {
  const q = detail === true ? 2 : detail === false ? 0 : detail;
  if (!bodies.has(q)) bodies.set(q, bodyGeometry(q));
  return makeBatch(bodies.get(q), sharedClothing ??= crowdMaterial(), max, shadows);
}
// an instanced batch of one body (procedural or a citizen) with the crowd's per-person attributes. They're written
// column by column (set.iPos.array etc., four floats a person) and interleaved into one GPU buffer when the batch is
// committed: WebGPU allows a pipeline 8 vertex buffers, and ten of their own plus the body's made 13, so on WebGPU
// none of them drew at all.
const INST = ['iPos', 'iAnim', 'iCol', 'iSty', 'iExt', 'iR1', 'iR2', 'iR3', 'iW0', 'iW1'], STRIDE = INST.length * 4;
function makeBatch(model, material, max, shadows) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(model.index);
  for (const [name,attr] of Object.entries(model.attributes)) geo.setAttribute(name,attr);
  const set = {max,geo};
  const ib = set.ib = new THREE.InstancedInterleavedBuffer(new Float32Array(max * STRIDE), STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  INST.forEach((name, k) => { geo.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, 4, k * 4)); set[name] = { array: new Float32Array(max * 4) }; });
  set.attrs = INST.map(name => set[name]);
  set.mesh = new THREE.Mesh(geo, material);
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

const pick = (r, a) => a[Math.floor(r() * a.length)];
export class People {
  constructor(scene, shadows) {
    this.list = [];
    this.rigs = new RiggedPeople(scene);
    // near (within LOD_NEAR: fingers, ears), mid (to LOD_MID) and far; near and mid cast shadows
    this.sets = CAP.map((max, lod) => {
      const set = createCrowdBatch(max, 2 - lod, shadows && lod < 2);
      scene.add(set.mesh);
      return set;
    });
    this.tris = this.sets.map(s => s.geo.index.count / 3);
    this.cnt = [0, 0, 0];
    // the citizen pack: one batch per citizen, at every distance (each is lighter than the procedural near body)
    this.cit = null; this.citN = [];
    loadCitizens().then(C => {
      if (!C) return;
      this.cit = C.models.map(g => { const set = makeBatch(g, C.material, CIT_CAP, shadows); scene.add(set.mesh); return set; });
      this.citN = this.cit.map(() => 0);
    });
    // without shadow maps: a soft dark blob on the ground under everyone, as games did before them
    this.blobs = null;
    if (!shadows) {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const r = tslLength(tslUv().sub(0.5)).mul(2);
      m.colorNode = tslVec3(0, 0, 0); m.opacityNode = tslFloat(1).sub(tslSmooth(0.25, 1.0, r)).mul(0.42);
      this.blobs = new THREE.InstancedMesh(g, m, 300); this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
      this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(this.blobs); this._bm = new THREE.Matrix4();
    }
  }
  // a pedestrian's look. opts.work: someone at work indoors (shop staff, clerks): no coat, bags or headphones
  static randomLook(r = Math.random, opts = {}) {
    const female = r() < 0.5, older = r() < 0.17, young = !older && r() < 0.45, work = !!opts.work;
    // face (faceBake.js): men clean shaven / stubble / beard / older; women young / natural / made up / older
    const face = older ? 3 : pick(r, [0, 0, 1, 1, 2]);
    // hair: 0 bald, 1 short, 2 long, 3 bun, 4 curly, 5 ponytail, 6 buzz cut
    const style = female ? pick(r, [2, 2, 2, 3, 5, 5, 4, 1]) : older ? pick(r, [1, 1, 1, 0, 6]) : pick(r, [1, 1, 1, 1, 6, 6, 4, 0]);
    let outfit = female ? pick(r, [0, 0, 1, 1, 2, 2, 3, 4, 5, 5, 6, 7]) : pick(r, [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7, 7]);
    const denim = r() < 0.45;
    let legs = denim ? pick(r, DENIM) : pick(r, LEGS), top = pick(r, TOPS);
    let top2 = outfit === 5 ? pick(r, TEES) : pick(r, ACCENTS);
    const coat = !work && r() < (female ? 0.14 : 0.1) && outfit !== 7;
    if (coat) { top = pick(r, COATS); outfit = pick(r, [0, 3, 5]); if (outfit === 5) top2 = pick(r, TEES); }
    const skirt = female && !coat && outfit !== 7 && r() < 0.26, dress = skirt && r() < 0.4;
    if (dress) legs = top;
    const tights = skirt && r() < 0.6, shorts = !skirt && !coat && outfit !== 2 && r() < 0.07;
    const cap = !female && !older && r() < 0.12, beanie = !work && !cap && r() < 0.1;
    const carrier = !work && r() < 0.12;
    let idle = pick(r, older ? [0, 0, 0, 1, 2, 2] : [0, 0, 0, 1, 1, 2, 3, 3]);
    if (carrier && idle !== 2) idle = 0;
    if (work && idle === 3) idle = 0;
    // most people on the street are one of the citizens (their own clothes and faces); the rest are dressed here
    let citizen = null;
    if (!work && r() < 0.8) {
      const ids = []; for (let k = 0; k < CITIZENS.length; k++) if (!!CITIZENS[k].f === female) ids.push(k);
      citizen = ids[Math.floor(r() * ids.length)];
      if (idle === 3) idle = 0;   // (no phone in their hands)
    }
    const look = {
      citizen,
      face, outfit, skin: pick(r, SKINS), hair: older && r() < 0.75 ? pick(r, GREYS) : pick(r, HAIRS), top, legs, top2, bald: style === 0, style, female,
      build: Math.min(1, Math.max(0, (female ? 0.28 : 0.35) + (r() - 0.5) * 0.75 + (older ? 0.1 : 0))), shoe: pick(r, [0, 0, 0, 1, 1, 2, 2, 3, 3]),
      cap, beanie, hood: outfit === 4 || r() < 0.04, bag: !work && r() < (female ? 0.32 : 0.12), backpack: !work && r() < (young ? 0.24 : 0.08),
      glasses: r() < (older ? 0.45 : 0.14), headphones: !work && young && r() < 0.18, scarf: !work && (r() < 0.06 || coat && r() < 0.35),
      coat, skirt, tights, shorts, denim: denim && !dress, carrier, idle, swing: Math.floor(r() * 8), stoop: older && r() < 0.5,
      umbrella: 0, umbIdx: Math.floor(r() * 5), h: (female ? 0.93 + r() * 0.08 : 0.98 + r() * 0.09) * (older ? 0.98 : 1),
    };
    if (citizen != null) look.h = CITIZENS[citizen].h * (0.97 + r() * 0.06);
    return look;
  }
  draw(actors, camPos, maxDist = 160, dt = 0) {
    const cnt = this.cnt; cnt[0] = cnt[1] = cnt[2] = 0;
    const detailed = this.rigs.update(actors, camPos, dt);
    const n2 = LOD_NEAR * LOD_NEAR, m2 = LOD_MID * LOD_MID, max2 = maxDist * maxDist;
    const cit = this.cit, citN = this.citN; for (let k = 0; k < citN.length; k++) citN[k] = 0;
    for (const a of actors) {
      if (!a.visible || detailed.has(a.id)) continue;
      const dx = a.x - camPos.x, dz = a.z - camPos.z, d2 = dx * dx + dz * dz;
      if (d2 > max2) continue;
      // one of the citizens (not on duty in uniform): its own batch
      const ci = a.look?.citizen;
      if (cit && ci != null && !a.hiVis && citN[ci] < CIT_CAP) { writeCrowdMember(cit[ci], citN[ci]++, a, true); continue; }
      // full levels hand over to the next one down
      let lod = d2 < n2 ? 0 : d2 < m2 ? 1 : 2;
      while (lod < 2 && cnt[lod] >= this.sets[lod].max) lod++;
      if (cnt[lod] >= this.sets[lod].max) continue;
      writeCrowdMember(this.sets[lod], cnt[lod]++, a);
    }
    if (this.blobs) {
      let n = 0; const B = this.blobs, m = this._bm;
      for (const a of actors) {
        if (!a.visible || n >= 300 || (a.fall || 0) > 0.5 || a.react?.dead) continue;
        const dx = a.x - camPos.x, dz = a.z - camPos.z; if (dx * dx + dz * dz > 70 * 70) continue;
        m.makeScale(0.85, 1, 0.85); m.elements[12] = a.x; m.elements[13] = (a.y || 0) + 0.03; m.elements[14] = a.z;
        B.setMatrixAt(n++, m);
      }
      B.count = n; if (n) B.instanceMatrix.needsUpdate = true;
    }
    let n = 0;
    for (let k = 0; k < 3; k++) { commitBatch(this.sets[k], cnt[k]); n += cnt[k]; }
    if (cit) for (let k = 0; k < cit.length; k++) { commitBatch(cit[k], citN[k]); n += citN[k]; }
    return n + detailed.size;
  }
}

export function commitBatch(S, n) {
  S.geo.instanceCount = n; S.mesh.visible = n > 0;
  if (!n) return;
  const D = S.ib.array, A = S.attrs;   // the columns, interleaved for the GPU (makeBatch)
  for (let k = 0; k < A.length; k++) {
    const src = A[k].array;
    for (let i = 0, d = k * 4, q = 0; i < n; i++, d += STRIDE, q += 4) { D[d] = src[q]; D[d + 1] = src[q + 1]; D[d + 2] = src[q + 2]; D[d + 3] = src[q + 3]; }
  }
  S.ib.clearUpdateRanges(); S.ib.addUpdateRange(0, n * STRIDE); S.ib.needsUpdate = true;
}

const _P = {}, NOLOOK = {};
// citizen: drawn with a citizen's own mesh (no umbrella to hold up)
export function writeCrowdMember(S, i, a, citizen = false) {
  const L = a.look || NOLOOK, o = i * 4;
  const sp = a.gaitSpeed ?? a.speedNow ?? a.speed ?? 0;
  const R = a.react, W = !R && a.wound;
  let amp = Math.min(1, sp / 1.5), run = a.running || sp > 3.2 ? 2 : 0, pose = citizen && a.pose === 'umbrella' ? 0 : POSE[a.pose] ?? 0;
  const hd = (a.heading || 0) + (a.pose === 'flee' ? Math.PI : 0);
  let rF = 0, rS = 0, rTw = 0, rHd = 0, clutch = 0, flail = 0, one = 0, kn = 0, hp = 0, kneel = 0, fall = 0, fyaw = Math.PI, drop = 0;
  let brace = pose === 8 ? (a.brace || 0) : 0;
  if (R) {
    // hit or shot: the reaction's angles about the blow turned into this person's own frame (x their left, z ahead)
    const P = reactionPose(R, _P);
    pose = 0; amp = 0; run = 0; brace = 0;
    const rel = R.dir - hd, dz = Math.cos(rel), dx = -Math.sin(rel), spn = P.spine + P.spineLo;
    rF = spn * dz; rS = spn * dx; rTw = P.twist + P.writheRoll; rHd = P.head * dz;
    clutch = Math.min(1, Math.max(0, -P.arms) * 1.2);
    flail = P.armsOut + Math.max(0, P.arms) * 0.6;
    if (P.armFling) one = -(P.armSide || 1) * Math.min(1, P.armFling / 1.3);
    fall = Math.min(0.999, P.fall);
    kn = P.knees + P.writhe * 1.4; hp = P.hips + P.writhe * 0.95;
    // the dead don't lie with their knees up: the buckled legs straighten out on the ground
    if (R.dead) { hp *= 1 - 0.75 * fall; kn *= 1 - 0.65 * fall; }
    kneel = -(P.kSide || 1) * P.kneel;
    fyaw = -((P.back >= 0 ? R.dir : R.dir + Math.PI) + (P.fallTurn || 0) - hd);
    drop = (P.kneel > 0.01 ? P.drop : Math.max(P.drop, legDrop(hp, kn))) * (1 - fall);
  } else {
    // knocked down by a car: onto their back
    if (a.fall > 0) fall = Math.min(0.999, a.fall);
    if (brace) drop = legDrop(0.3 * brace, 0.67 * brace) * (1 - fall);
    // down on one knee, leaning in (a paramedic at someone's side, a firefighter at a wrecked car: emergency.js)
    if (a.kneel) { const k = Math.min(1, Math.abs(a.kneel)); kneel = a.kneel; drop = Math.max(drop, 0.45 * k); rF += 0.3 * k; rHd -= 0.1 * k; }
    if (W) {
      // getting away hurt: hunched over a body wound, an arm across it, or a limp on a bad leg
      const k = Math.min(1, W.t / 0.4) * Math.max(0, Math.min(1, (W.life - W.t) / 2));
      if (k > 0.01) {
        if (W.zone === 'leg') { const dip = Math.max(0, Math.sin((a.gaitPhase ?? a.phase ?? 0) + (W.side > 0 ? 0 : Math.PI))) * k * Math.min(1, amp * 1.5); rS = -W.side * 0.14 * dip; rF = 0.08 * k; drop = 0.05 * dip; }
        else { rF = 0.38 * k; rHd = 0.12 * k; one = (W.side > 0 ? 1 : -1) * (10 + k); }
      }
    }
  }
  const P0 = S.iPos.array, A = S.iAnim.array, C = S.iCol.array, X = S.iExt.array, R1 = S.iR1.array, R2 = S.iR2.array, R3 = S.iR3.array;
  P0[o] = a.x; P0[o + 1] = a.y; P0[o + 2] = a.z; P0[o + 3] = hd;
  A[o] = a.gaitPhase ?? a.phase ?? 0; A[o + 1] = amp + run; A[o + 2] = pose; A[o + 3] = pose === 8 ? brace : (a.t || 0) % 1000;
  if (!L._pk || L._pkTop !== L.top || L._pkLegs !== L.legs) { L._pk = [L.skin ?? SKINS[0], L.top ?? TOPS[0], L.legs ?? LEGS[0], L.hair ?? HAIRS[0]]; L._pkTop = L.top; L._pkLegs = L.legs; }
  const pk = L._pk; C[o] = pk[0]; C[o + 1] = pk[1]; C[o + 2] = pk[2]; C[o + 3] = pk[3];
  packStyle(L, a, S.iSty.array, o);
  packExtras(L, a, !!(R || W), X, o); X[o + 3] = drop;
  R1[o] = rF; R1[o + 1] = rS; R1[o + 2] = rTw; R1[o + 3] = rHd;
  R2[o] = clutch; R2[o + 1] = flail; R2[o + 2] = one; R2[o + 3] = kn;
  R3[o] = hp; R3[o + 1] = kneel; R3[o + 2] = fall; R3[o + 3] = fyaw;
  // wounds (gore.js): none is a zero radius
  const Wd = a.wounds, W0 = S.iW0?.array, W1 = S.iW1?.array;
  if (!W0) return;
  if (Wd?.length) { const w = Wd[0]; W0[o] = w.a; W0[o + 1] = w.y; W0[o + 2] = w.r; W0[o + 3] = w.k; const v = Wd[1]; if (v) { W1[o] = v.a; W1[o + 1] = v.y; W1[o + 2] = v.r; W1[o + 3] = v.k; } else W1[o + 2] = 0; }
  else { W0[o + 2] = 0; W1[o + 2] = 0; }
}
