// Animals as low-poly instanced meshes, one per kind of animal, animated in the vertex shader like the crowd
// (humans.js): every vertex carries its part (body, four legs, head and neck, tail, two wings) with the joint it
// turns about, and its colour region; each animal carries its place, heading, gait phase, stride, pose and
// colours. Legs swing in diagonal pairs, heads drop to graze, tails wag, wings fold, flap or hold a glide,
// legs fold to lie down and tuck away to swim. Local frame: +Z forward, +Y up; metres.
import * as THREE from 'three/webgpu';
import { Fn, float, vec3, vec4, attribute, positionGeometry, normalGeometry, positionWorld, varyingProperty, sin, cos, abs, max, min, mix, step, smoothstep, floor, fract, pow, normalize } from 'three/tsl';
import { U, cloudShadow } from './env.js';
import { worldToView } from './surfaces.js';
import { lightPool } from './materials.js';

// ---------------------------------------------------------------- geometry kit
const V = new THREE.Vector3(), NN = new THREE.Vector3(), NM = new THREE.Matrix3(), UP = new THREE.Vector3(0, 1, 0);
class Kit {
  constructor() { this.pos = []; this.nor = []; this.rig = []; this.reg = []; this.idx = []; }
  // regions: 0 main coat, 1 second colour, 2 accent, 3 detail (nose, hooves, beak, feet), 4 eye, 5 extra (white)
  add(geo, m, role, piv, reg) {
    const P = geo.attributes.position, N = geo.attributes.normal, base = this.pos.length / 3;
    NM.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      V.fromBufferAttribute(P, i).applyMatrix4(m); NN.fromBufferAttribute(N, i).applyMatrix3(NM).normalize();
      this.pos.push(V.x, V.y, V.z); this.nor.push(NN.x, NN.y, NN.z);
      this.rig.push(role, piv[0], piv[1], piv[2]);
      this.reg.push(typeof reg === 'function' ? reg(V.x, V.y, V.z) : reg);
    }
    const I = geo.index ? geo.index.array : Array.from({ length: P.count }, (_, i) => i);
    for (const i of I) this.idx.push(base + i);
    geo.dispose();
  }
  geometry() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('arig', new THREE.Float32BufferAttribute(this.rig, 4));
    g.setAttribute('areg', new THREE.Float32BufferAttribute(this.reg, 1));
    g.setIndex(this.idx); g.instanceCount = 0;
    return g;
  }
}
const M = (p, s = [1, 1, 1], q = null) => new THREE.Matrix4().compose(new THREE.Vector3(...p), q || new THREE.Quaternion(), new THREE.Vector3(...s));
const toward = (a, b) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = d.length(); return { L, q: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] }; };
const ellip = (k, c, r, role, piv, reg, ws = 10, hs = 7, q = null) => k.add(new THREE.SphereGeometry(1, ws, hs), M(c, r, q), role, piv, reg);
const tube = (k, a, b, r0, r1, role, piv, reg, rs = 6) => { const t = toward(a, b); k.add(new THREE.CylinderGeometry(r1, r0, t.L, rs, 1, false), M(t.mid, [1, 1, 1], t.q), role, piv, reg); };
const cone = (k, a, b, r, role, piv, reg, rs = 5) => { const t = toward(a, b); k.add(new THREE.ConeGeometry(r, t.L, rs), M(t.mid, [1, 1, 1], t.q), role, piv, reg); };
const sheet = (k, pts, role, piv, reg) => {   // a flat fan (wings, tails, webbed feet), lit as its upper side
  const g = new THREE.BufferGeometry(), p = [], n = [];
  for (let i = 1; i + 1 < pts.length; i++) { p.push(...pts[0], ...pts[i], ...pts[i + 1]); n.push(0, 1, 0, 0, 1, 0, 0, 1, 0); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  k.add(g, new THREE.Matrix4(), role, piv, reg);
};
const pitch = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);

// ---------------------------------------------------------------- four-legged animals
// o: L half length, R half height, W half width of the body; leg: ground to belly; legR; neck [length, angle up];
// head [radius, half length]; snout [length, radius]; ears type and size; tail type, length, radius, angle (up +);
// regions: belly, sock (fraction of leg, region), face ('muzzle' | 'white' | 'badger' | 'blaze' | 'dark'),
// tailTip, rump (white patch), mane, rug, haunch (rabbits' big hind quarters)
export function quad(o) {
  const k = new Kit(), { L, R, W, leg } = o, cy = leg + R, legR = o.legR;
  const body = (x, y, z) => {
    if (o.rug && y > cy - R * 0.35 && Math.abs(z) < L * 0.72) return 1;
    if (o.rump && z < -L * 0.72 && y > cy - R * 0.6) return 5;
    if (o.belly != null && y < cy - R * 0.42) return o.belly;
    return 0;
  };
  ellip(k, [0, cy, 0], [W, R, L], 0, [0, 0, 0], body, 14, 9);
  if (o.chest) ellip(k, [0, cy + R * 0.08, L * 0.55], [W * 1.02, R * o.chest, L * 0.42], 0, [0, 0, 0], body);
  if (o.haunch) for (const s of [1, -1]) ellip(k, [s * W * 0.62, cy - R * 0.15, -L * 0.45], [W * 0.5, R * o.haunch, L * 0.45], 0, [0, 0, 0], body);
  // legs: front pair and hind pair, swinging about the shoulder and hip
  const sock = o.sock || [0, 3];
  const legs = [[1, L * 0.62, 1], [2, L * 0.62, -1], [3, -L * 0.6, 1], [4, -L * 0.6, -1]];
  for (const [role, z, s] of legs) {
    const top = [s * W * 0.55, cy - R * 0.15, z], foot = [s * W * 0.6, 0.02, z + (role > 2 ? -0.01 : 0.01)], piv = top;
    const hind = role > 2, r = legR * (hind && o.haunch ? 1.25 : 1);
    const lr = (x, y) => (y < leg * sock[0] ? sock[1] : (o.legReg ?? 0));
    tube(k, top, foot, r, r * 0.7, role, piv, lr, 6);
    const th = hind ? 2.1 : 1.6, tl = Math.min(R * 0.6, leg * 0.42);
    ellip(k, [top[0] * 0.97, top[1] - tl * 0.55, top[2] + (hind ? -r * 0.4 : r * 0.2)], [r * th * 0.85, tl, r * th], role, piv, o.legReg ?? 0, 7, 5);
    if (o.hoof) ellip(k, [foot[0], 0.03, foot[2] + 0.01], [r * 0.8, 0.035, r * 0.95], role, piv, 3, 6, 4);
  }
  // neck and head (they turn together about the base of the neck)
  const [nL, nA] = o.neck, [hR, hL] = o.head, [sL, sR] = o.snout;
  const nb = [0, cy + R * 0.3, L * 0.78], piv = nb;
  const hc = [0, nb[1] + nL * Math.sin(nA), nb[2] + nL * Math.cos(nA)];
  const headQ = pitch(o.headDown || 0.15);
  const face = (x, y, z) => {
    if (o.face === 'white') return 1;
    if (o.face === 'dark') return 3;
    if (o.face === 'muzzle' && y < hc[1] - hR * 0.15) return 5;
    if (o.face === 'blaze' && Math.abs(x) < hR * 0.22 && z > hc[2]) return 5;
    if (o.face === 'badger') return Math.abs(x) > hR * 0.22 && Math.abs(x) < hR * 0.62 && y > hc[1] - hR * 0.5 ? 3 : 5;
    return o.headReg ?? 0;
  };
  if (nL > 0.01) tube(k, nb, hc, o.neckR || R * 0.45, (o.neckR || R * 0.45) * 0.8, 5, piv, (x, y) => (o.mane && y > nb[1] + (hc[1] - nb[1]) * 0.1 && x * x < 0.0004 ? 3 : face(x, y, hc[2] - 1)), 7);
  if (o.mane) tube(k, [0, nb[1] + R * 0.35, nb[2] - 0.02], [0, hc[1] + hR * 0.6, hc[2] - hL * 0.4], 0.035, 0.03, 5, piv, 3, 4);
  ellip(k, hc, [hR * 0.82, hR * 0.88, hL], 5, piv, face, 10, 7, headQ);
  const st = [0, hc[1] - hR * 0.22, hc[2] + hL * 0.6], tip = [0, st[1] - sL * 0.25, st[2] + sL];
  tube(k, st, tip, sR, sR * 0.75, 5, piv, (x, y, z) => (z > tip[2] - sR * 0.6 ? 3 : face(x, y, z)), 7);
  ellip(k, [0, tip[1] + sR * 0.2, tip[2]], [sR * 0.55, sR * 0.45, sR * 0.4], 5, piv, 3, 6, 4);   // nose
  for (const s of [1, -1]) ellip(k, [s * hR * 0.62, hc[1] + hR * 0.25, hc[2] + hL * 0.42], [hR * 0.16, hR * 0.16, hR * 0.12], 5, piv, 4, 6, 4);
  // ears
  const eR = o.earReg ?? (o.face === 'badger' ? 5 : 0), eL = o.earL || hR * 0.6;
  for (const s of [1, -1]) {
    const eb = [s * hR * 0.5, hc[1] + hR * 0.65, hc[2] - hL * 0.25];
    if (o.ears === 'point') cone(k, eb, [eb[0] + s * eL * 0.18, eb[1] + eL, eb[2] - eL * 0.12], eL * 0.42, 5, piv, (x, y) => (y > eb[1] + eL * 0.6 && o.earTip != null ? o.earTip : eR), 4);
    else if (o.ears === 'long') ellip(k, [eb[0] * 0.8, eb[1] + eL * 0.5, eb[2] - eL * 0.25], [eL * 0.16, eL * 0.55, eL * 0.1], 5, piv, (x, y) => (y > eb[1] + eL * 0.85 && o.earTip != null ? o.earTip : eR), 6, 5, pitch(-0.35));
    else if (o.ears === 'flop') ellip(k, [s * (hR * 0.85), hc[1] - hR * 0.1, hc[2] - hL * 0.15], [eL * 0.12, eL * 0.5, eL * 0.3], 5, piv, o.earReg ?? 1, 6, 5);
    else if (o.ears === 'side') ellip(k, [s * (hR * 0.95 + eL * 0.35), hc[1] + hR * 0.35, hc[2] - hL * 0.3], [eL * 0.45, eL * 0.12, eL * 0.25], 5, piv, eR, 6, 4);
    else if (o.ears === 'round') ellip(k, [s * hR * 0.6, eb[1] + eL * 0.35, eb[2]], [eL * 0.4, eL * 0.42, eL * 0.12], 5, piv, eR, 6, 5);
    else ellip(k, [s * hR * 0.55, eb[1] + eL * 0.15, eb[2]], [eL * 0.3, eL * 0.25, eL * 0.1], 5, piv, eR, 5, 4);
  }
  if (o.horns) for (const s of [1, -1]) cone(k, [s * hR * 0.45, hc[1] + hR * 0.7, hc[2] - hL * 0.4], [s * hR * 0.95, hc[1] + hR * 1.15, hc[2] - hL * 0.3], hR * 0.12, 5, piv, 5, 4);
  // tail
  if (o.tail) {
    const [type, tL, tR, tA] = o.tail, tb = [0, cy + R * 0.35, -L * 0.95], tpiv = tb;
    const te = [0, tb[1] + tL * Math.sin(tA), tb[2] - tL * Math.cos(tA)];
    const treg = (x, y, z) => { const f = Math.hypot(x - tb[0], y - tb[1], z - tb[2]) / tL; return o.tailTip && f > 1 - o.tailTip ? 5 : (o.tailReg ?? 0); };
    if (type === 'thin') tube(k, tb, te, tR, tR * 0.6, 6, tpiv, treg, 5);
    else if (type === 'bush') { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(te[0] - tb[0], te[1] - tb[1], te[2] - tb[2]).normalize()); ellip(k, [(tb[0] + te[0]) / 2, (tb[1] + te[1]) / 2, (tb[2] + te[2]) / 2], [tR, tR, tL * 0.55], 6, tpiv, treg, 8, 6, q); }
    else if (type === 'tuft') { tube(k, tb, te, tR, tR * 0.7, 6, tpiv, o.tailReg ?? 0, 5); ellip(k, te, [tR * 2.2, tR * 4, tR * 2.2], 6, tpiv, 3, 6, 4); }
    else if (type === 'horse') { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(te[0] - tb[0], te[1] - tb[1], te[2] - tb[2]).normalize()); ellip(k, [(tb[0] + te[0]) / 2, (tb[1] + te[1]) / 2, (tb[2] + te[2]) / 2], [tR, tL * 0.55, tR * 0.8], 6, tpiv, 3, 7, 6, q); }
    else ellip(k, [0, tb[1] + tR * 0.3, tb[2] - tR * 0.4], [tR, tR, tR], 6, tpiv, o.tailReg ?? 5, 6, 5);   // stub / scut
  }
  return k;
}

// ---------------------------------------------------------------- hedgehog: a dome of spines
export function hog() {
  const k = new Kit(), cy = 0.07;
  ellip(k, [0, cy, -0.01], [0.085, 0.07, 0.13], 0, [0, 0, 0], (x, y) => (y < cy - 0.02 ? 1 : 0), 12, 8);
  // spines: small cones over the back, pale tips
  let n = 0;
  for (let a = 0; a < 7; a++) for (let b = 0; b < 11; b++) {
    const th = 0.18 + a * 0.2, ph = (b / 11) * Math.PI * 2 + a * 0.4, u = Math.sin(th);
    const nx = u * Math.cos(ph) * 0.085, ny = Math.cos(th) * 0.07, nz = u * Math.sin(ph) * 0.13 - 0.01;
    if (ny < 0.0 || nz > 0.1) continue;
    const base = [nx, cy + ny, nz], dir = new THREE.Vector3(nx * 1.2, ny * 1.1 + 0.02, nz * 0.9 - 0.04).normalize();
    cone(k, base, [base[0] + dir.x * 0.045, base[1] + dir.y * 0.045, base[2] + dir.z * 0.045], 0.011, 0, [0, 0, 0], (x, y) => (Math.hypot(x - base[0], y - base[1]) > 0.03 ? 5 : 0), 3); n++;
  }
  // face and snout (pale), black nose, small eyes; short legs
  const piv = [0, cy, 0.08];
  ellip(k, [0, cy - 0.015, 0.11], [0.045, 0.04, 0.05], 5, piv, 1, 8, 6);
  cone(k, [0, cy - 0.02, 0.14], [0, cy - 0.035, 0.2], 0.018, 5, piv, 1, 6);
  ellip(k, [0, cy - 0.035, 0.2], [0.009, 0.008, 0.008], 5, piv, 3, 5, 4);
  for (const s of [1, -1]) ellip(k, [s * 0.025, cy + 0.005, 0.15], [0.007, 0.007, 0.006], 5, piv, 4, 5, 4);
  for (const [role, z, s] of [[1, 0.06, 1], [2, 0.06, -1], [3, -0.07, 1], [4, -0.07, -1]]) tube(k, [s * 0.05, cy - 0.03, z], [s * 0.052, 0.005, z], 0.012, 0.01, role, [s * 0.05, cy - 0.03, z], 1, 4);
  return k;
}

// ---------------------------------------------------------------- birds
// o: L, R, W body; leg; head radius; beak [length, radius]; tail [length, width, fork]; wing [half span, chord];
// tilt (body angle, nose up +); regions: breast, head, wing, tip (wing tips), tail, crest, throat, legReg
export function bird(o) {
  const k = new Kit(), cy = o.leg + o.R, q = pitch(-(o.tilt || 0));
  const reg = (x, y, z) => {
    if (o.throat != null && z > o.L * 0.55 && y > cy && y < cy + o.R * 0.7) return o.throat;
    if (o.breast != null && z > -o.L * 0.1 && y < cy + o.R * 0.15) return o.breast;
    if (o.belly != null && y < cy - o.R * 0.35) return o.belly;
    if (o.rumpReg != null && z < -o.L * 0.5 && y > cy) return o.rumpReg;
    return 0;
  };
  ellip(k, [0, cy, 0], [o.W, o.R, o.L], 0, [0, 0, 0], reg, 12, 8, q);
  // neck and head
  const hc = [0, cy + o.R * (o.neckUp ?? 0.75), o.L * (o.neckFwd ?? 0.85)], piv = [0, cy + o.R * 0.4, o.L * 0.5];
  if (o.neck) tube(k, [0, cy + o.R * 0.4, o.L * 0.6], hc, o.neck, o.neck * 0.85, 5, piv, o.neckReg ?? o.headReg ?? 0, 6);
  ellip(k, hc, [o.head * 0.9, o.head, o.head * 1.1], 5, piv, (x, y, z) => (o.cheek != null && y < hc[1] && z > hc[2] - o.head * 0.3 ? o.cheek : (o.headReg ?? 0)), 9, 7);
  const [bL, bR] = o.beak;
  cone(k, [0, hc[1] - o.head * 0.1, hc[2] + o.head * 0.8], [0, hc[1] - o.head * 0.1 - bL * (o.beakDown || 0.15), hc[2] + o.head * 0.8 + bL], bR, 5, piv, 3, 5);
  for (const s of [1, -1]) ellip(k, [s * o.head * 0.68, hc[1] + o.head * 0.2, hc[2] + o.head * 0.45], [o.head * 0.18, o.head * 0.18, o.head * 0.12], 5, piv, 4, 5, 4);
  if (o.crest) cone(k, [0, hc[1] + o.head * 0.7, hc[2] - o.head * 0.2], [0, hc[1] + o.head * 1.5, hc[2] - o.head * 0.9], o.head * 0.35, 5, piv, o.crest, 4);
  // tail fan
  const [tL, tW, fork] = o.tail, tb = -o.L * 0.85, ty = cy + o.R * 0.1 - (o.tailDown || 0) * 0.3;
  const tip = tb - tL;
  sheet(k, fork ? [[0, ty, tb], [tW * 0.5, ty, tb], [tW, ty - tL * 0.05, tip], [0, ty, tip + tL * 0.55], [-tW, ty - tL * 0.05, tip], [-tW * 0.5, ty, tb]]
    : [[0, ty, tb], [tW * 0.45, ty, tb], [tW, ty - tL * (o.tailDown || 0.1), tip], [-tW, ty - tL * (o.tailDown || 0.1), tip], [-tW * 0.45, ty, tb]], 6, [0, ty, tb], o.tailReg ?? 0);
  // wings, modelled spread; the shader folds them along the body, flaps them or holds them for a glide
  const [span, chord] = o.wing;
  for (const [role, s] of [[7, 1], [8, -1]]) {
    const sh = [s * o.W * 0.7, cy + o.R * 0.35, o.L * 0.15], piv2 = sh;
    const wr = (x) => { const f = Math.abs(x) / span; return f > 0.72 && o.tip != null ? o.tip : f > 0.42 && o.patch != null ? o.patch : (o.wingReg ?? 0); };
    sheet(k, [sh, [sh[0], sh[1], sh[2] + chord * 0.35], [s * span * 0.55, sh[1] + 0.01, sh[2] + chord * 0.25], [s * span, sh[1] + 0.02, sh[2] - chord * 0.05], [s * span * 0.95, sh[1], sh[2] - chord * 0.45], [s * span * 0.5, sh[1], sh[2] - chord * 0.8], [sh[0], sh[1], sh[2] - chord * 0.75]], role, piv2, wr);
  }
  // legs and feet
  if (o.leg > 0.01) for (const [role, s] of [[1, 1], [2, -1]]) {
    const top = [s * o.W * 0.35, cy - o.R * 0.6, -o.L * 0.05], foot = [s * o.W * 0.4, 0.005, o.L * 0.02];
    tube(k, top, foot, o.legR || 0.006, (o.legR || 0.006) * 0.8, role, top, o.legReg ?? 3, 4);
    cone(k, foot, [foot[0], 0.004, foot[2] + Math.max(0.025, o.leg * 0.35)], (o.legR || 0.006) * 1.6, role, top, o.legReg ?? 3, 3);
  }
  return k;
}

// ---------------------------------------------------------------- water birds: a boat-shaped body, a neck held up
export function waterbird(o) {
  const k = new Kit(), cy = o.leg + o.R;
  const reg = (x, y, z) => {
    if (o.collar != null && z > o.L * 0.55 && y > cy + o.R * 0.2) return o.collar;
    if (o.breast != null && z > o.L * 0.35 && y < cy + o.R * 0.3) return o.breast;
    if (o.flank != null && y < cy + o.R * 0.15 && y > cy - o.R * 0.7 && Math.abs(z) < o.L * 0.6) return o.flank;
    if (o.under != null && z < -o.L * 0.55 && y < cy) return o.under;
    return 0;
  };
  ellip(k, [0, cy, 0], [o.W, o.R, o.L], 0, [0, 0, 0], reg, 14, 8);
  ellip(k, [0, cy + o.R * 0.25, -o.L * 0.8], [o.W * 0.55, o.R * 0.45, o.L * 0.35], 0, [0, 0, 0], o.tailReg ?? 0, 8, 6, pitch(0.5));   // up-tilted tail
  const piv = [0, cy + o.R * 0.3, o.L * 0.6];
  const nb = [0, cy + o.R * 0.3, o.L * 0.7], [nL, nA] = o.neck;
  let hc;
  if (o.sNeck) {   // the swan's S: up and back, then forward
    const m1 = [0, nb[1] + nL * 0.55, nb[2] - nL * 0.08];
    hc = [0, m1[1] + nL * 0.4, m1[2] + nL * 0.22];
    tube(k, nb, m1, o.neckR, o.neckR * 0.85, 5, piv, o.neckReg ?? 0, 7);
    tube(k, m1, hc, o.neckR * 0.85, o.neckR * 0.75, 5, piv, o.neckReg ?? 0, 7);
  } else {
    hc = [0, nb[1] + nL * Math.sin(nA), nb[2] + nL * Math.cos(nA)];
    tube(k, nb, hc, o.neckR, o.neckR * 0.8, 5, piv, (x, y) => (o.neckLow != null && y < nb[1] + (hc[1] - nb[1]) * 0.45 ? o.neckLow : (o.neckReg ?? 0)), 7);
  }
  ellip(k, hc, [o.head * 0.85, o.head * 0.9, o.head * 1.15], 5, piv, (x, y, z) => (o.strap != null && y < hc[1] + o.head * 0.2 && z < hc[2] + o.head * 0.3 && z > hc[2] - o.head * 0.6 ? o.strap : o.eyePatch != null && Math.abs(x) > o.head * 0.4 && Math.abs(y - hc[1] - o.head * 0.15) < o.head * 0.35 ? o.eyePatch : (o.headReg ?? 0)), 9, 7);
  const [bL, bW] = o.bill;
  ellip(k, [0, hc[1] - o.head * 0.15, hc[2] + o.head * 0.9 + bL * 0.45], [bW, bW * 0.45, bL * 0.55], 5, piv, (x, y, z) => (o.shield != null && z < hc[2] + o.head * 1.05 ? o.shield : 3), 7, 5);
  if (o.knob) ellip(k, [0, hc[1] + o.head * 0.1, hc[2] + o.head * 0.95], [bW * 0.5, bW * 0.55, bW * 0.6], 5, piv, 2, 5, 4);
  if (o.crest) cone(k, [0, hc[1] + o.head * 0.6, hc[2] - o.head * 0.3], [0, hc[1] + o.head * 1.4, hc[2] - o.head * 1.0], o.head * 0.4, 5, piv, o.crest, 4);
  for (const s of [1, -1]) ellip(k, [s * o.head * 0.7, hc[1] + o.head * 0.25, hc[2] + o.head * 0.35], [o.head * 0.15, o.head * 0.15, o.head * 0.12], 5, piv, 4, 5, 4);
  // folded wings along the back (they open to fly)
  for (const [role, s] of [[7, 1], [8, -1]]) {
    const sh = [s * o.W * 0.75, cy + o.R * 0.45, o.L * 0.25], span = o.wing[0], chord = o.wing[1];
    sheet(k, [sh, [sh[0], sh[1], sh[2] + chord * 0.3], [s * span * 0.6, sh[1] + 0.01, sh[2] + chord * 0.15], [s * span, sh[1] + 0.02, sh[2] - chord * 0.1], [s * span * 0.9, sh[1], sh[2] - chord * 0.55], [sh[0], sh[1], sh[2] - chord * 0.8]], role, sh, (x) => (Math.abs(x) / span > 0.7 && o.tip != null ? o.tip : o.speculum != null && Math.abs(x) / span > 0.35 && Math.abs(x) / span < 0.55 ? o.speculum : (o.wingReg ?? 0)));
  }
  for (const [role, s] of [[1, 1], [2, -1]]) {
    const top = [s * o.W * 0.4, cy - o.R * 0.6, -o.L * 0.15], foot = [s * o.W * 0.45, 0.005, -o.L * 0.1];
    tube(k, top, foot, 0.012, 0.01, role, top, 3, 4);
    sheet(k, [[foot[0], 0.006, foot[2] - 0.02], [foot[0] + 0.035, 0.006, foot[2] + 0.05], [foot[0] - 0.035, 0.006, foot[2] + 0.05]], role, top, 3);
  }
  return k;
}

// ---------------------------------------------------------------- birds of prey seen overhead: long wings held out
export function raptor(o) {
  const k = new Kit(), cy = 0.1;
  ellip(k, [0, cy, 0], [o.W, o.R, o.L], 0, [0, 0, 0], (x, y) => (y < cy - o.R * 0.3 && o.belly != null ? o.belly : 0), 10, 7);
  const piv = [0, cy, o.L * 0.6];
  ellip(k, [0, cy + o.R * 0.2, o.L * 0.95], [o.head * 0.85, o.head * 0.9, o.head], 5, piv, o.headReg ?? 0, 8, 6);
  cone(k, [0, cy + o.R * 0.15, o.L * 0.95 + o.head * 0.8], [0, cy, o.L * 0.95 + o.head * 1.35], o.head * 0.3, 5, piv, 3, 4);
  const [tL, tW, fork] = o.tail, tb = -o.L * 0.8;
  sheet(k, fork ? [[0, cy, tb], [tW * 0.45, cy, tb], [tW, cy, tb - tL], [0, cy, tb - tL * 0.6], [-tW, cy, tb - tL], [-tW * 0.45, cy, tb]]
    : [[0, cy, tb], [tW * 0.5, cy, tb], [tW, cy, tb - tL], [-tW, cy, tb - tL], [-tW * 0.5, cy, tb]], 6, [0, cy, tb], o.tailReg ?? 0);
  const [span, chord] = o.wing;
  for (const [role, s] of [[7, 1], [8, -1]]) {
    const sh = [s * o.W * 0.6, cy + o.R * 0.2, o.L * 0.15];
    sheet(k, [sh, [sh[0], sh[1], sh[2] + chord * 0.4], [s * span * 0.45, sh[1] + 0.03, sh[2] + chord * 0.45], [s * span * 0.8, sh[1] + 0.05, sh[2] + chord * 0.25], [s * span, sh[1] + 0.05, sh[2] - chord * 0.05], [s * span * 0.92, sh[1] + 0.04, sh[2] - chord * 0.45], [s * span * 0.5, sh[1] + 0.02, sh[2] - chord * 0.6], [sh[0], sh[1], sh[2] - chord * 0.55]], role, sh,
      (x) => { const f = Math.abs(x) / span; return f > 0.82 ? (o.tip ?? 3) : f > 0.55 && f < 0.72 && o.patch != null ? o.patch : (o.wingReg ?? 0); });
  }
  return k;
}

// ---------------------------------------------------------------- bats
export function bat() {
  const k = new Kit(), cy = 0.02;
  ellip(k, [0, cy, 0], [0.018, 0.016, 0.03], 0, [0, 0, 0], 0, 8, 6);
  ellip(k, [0, cy + 0.008, 0.032], [0.012, 0.012, 0.013], 5, [0, cy, 0.02], 0, 6, 5);
  for (const s of [1, -1]) cone(k, [s * 0.006, cy + 0.016, 0.03], [s * 0.009, cy + 0.03, 0.027], 0.005, 5, [0, cy, 0.02], 0, 3);
  for (const [role, s] of [[7, 1], [8, -1]]) { const sh = [s * 0.014, cy + 0.004, 0.012]; sheet(k, [sh, [s * 0.06, cy + 0.01, 0.03], [s * 0.11, cy + 0.005, 0.0], [s * 0.09, cy, -0.035], [s * 0.05, cy, -0.02], [s * 0.03, cy, -0.04], [sh[0], cy, -0.03]], role, sh, 1); }
  return k;
}

// ---------------------------------------------------------------- nests in the trees (twigs round a cup)
export function nest(size = 1) {
  const k = new Kit();
  const t = new THREE.TorusGeometry(0.12 * size, 0.06 * size, 5, 10); t.rotateX(Math.PI / 2);
  k.add(t, M([0, 0.05 * size, 0], [1, 0.8, 1]), 0, [0, 0, 0], 0);
  ellip(k, [0, 0.03 * size, 0], [0.11 * size, 0.05 * size, 0.11 * size], 0, [0, 0, 0], 1, 8, 5);
  for (let i = 0; i < 7; i++) { const a = i * 0.9; tube(k, [Math.cos(a) * 0.1 * size, 0.07 * size, Math.sin(a) * 0.1 * size], [Math.cos(a + 1.6) * 0.2 * size, 0.04 * size + (i % 2) * 0.03 * size, Math.sin(a + 1.6) * 0.2 * size], 0.008 * size, 0.006 * size, 0, [0, 0, 0], 0, 3); }
  return k;
}

// ---------------------------------------------------------------- the models
// kind: body plan builder; o: its measurements (wildlife.js reads leg, L and R for lying, floating and leads);
// shadow: casts a shadow (big animals); max: instances drawn at once
const C = (r, g, b) => (r << 16) | (g << 8) | b;
export const BUILD = { quad, bird, waterbird, raptor, hog: () => hog(), bat: () => bat(), nest: o => nest(o.size) };
export const MODELS = {
  cat: { kind: 'quad', o: { L: 0.21, R: 0.085, W: 0.075, leg: 0.15, legR: 0.019, neck: [0.06, 0.75], head: [0.06, 0.055], snout: [0.025, 0.022], ears: 'point', earL: 0.04, tail: ['thin', 0.28, 0.016, 0.9], belly: 1, sock: [0.25, 1] }, max: 8 },
  dog_lab: { kind: 'quad', o: { L: 0.36, R: 0.15, W: 0.13, leg: 0.31, legR: 0.038, neck: [0.13, 0.62], head: [0.085, 0.1], snout: [0.1, 0.045], ears: 'flop', earL: 0.11, tail: ['thin', 0.36, 0.03, 0.35], belly: 0, chest: 0.95 }, max: 16, shadow: true },
  dog_collie: { kind: 'quad', o: { L: 0.34, R: 0.15, W: 0.12, leg: 0.3, legR: 0.033, neck: [0.14, 0.75], head: [0.075, 0.1], snout: [0.11, 0.035], ears: 'point', earL: 0.08, tail: ['bush', 0.38, 0.065, -0.4], belly: 1, face: 'blaze', chest: 1.05, sock: [0.35, 1] }, max: 10, shadow: true },
  dog_terrier: { kind: 'quad', o: { L: 0.2, R: 0.1, W: 0.085, leg: 0.15, legR: 0.026, neck: [0.06, 0.8], head: [0.065, 0.07], snout: [0.05, 0.035], ears: 'flop', earL: 0.055, tail: ['thin', 0.12, 0.02, 1.2], belly: 1, chest: 1 }, max: 12, shadow: true },
  dog_dachs: { kind: 'quad', o: { L: 0.3, R: 0.085, W: 0.075, leg: 0.08, legR: 0.026, neck: [0.07, 0.6], head: [0.06, 0.08], snout: [0.09, 0.03], ears: 'flop', earL: 0.09, tail: ['thin', 0.2, 0.02, 0.3], belly: 0 }, max: 6, shadow: true },
  fox: { kind: 'quad', o: { L: 0.3, R: 0.105, W: 0.085, leg: 0.27, legR: 0.024, neck: [0.09, 0.55], head: [0.07, 0.08], snout: [0.1, 0.03], ears: 'point', earL: 0.08, earTip: 3, tail: ['bush', 0.42, 0.065, -0.2], tailTip: 0.18, face: 'muzzle', belly: 5, sock: [0.6, 3] }, max: 4, shadow: true },
  badger: { kind: 'quad', o: { L: 0.36, R: 0.13, W: 0.15, leg: 0.12, legR: 0.04, neck: [0.05, 0.1], head: [0.075, 0.1], snout: [0.08, 0.034], ears: 'small', earL: 0.04, tail: ['stub', 0.06, 0.04, 0], tailReg: 0, face: 'badger', belly: 3, legReg: 3, headDown: 0.3 }, max: 5, shadow: true },
  rabbit: { kind: 'quad', o: { L: 0.16, R: 0.095, W: 0.085, leg: 0.06, legR: 0.022, neck: [0.04, 0.9], head: [0.055, 0.06], snout: [0.03, 0.03], ears: 'long', earL: 0.1, tail: ['stub', 0.04, 0.03, 0.4], tailReg: 5, belly: 1, haunch: 0.9 }, max: 16 },
  hare: { kind: 'quad', o: { L: 0.24, R: 0.11, W: 0.09, leg: 0.15, legR: 0.024, neck: [0.06, 0.9], head: [0.06, 0.075], snout: [0.035, 0.03], ears: 'long', earL: 0.15, earTip: 3, tail: ['stub', 0.05, 0.03, 0.6], tailReg: 5, belly: 1, haunch: 1 }, max: 3 },
  squirrel: { kind: 'quad', o: { L: 0.11, R: 0.06, W: 0.05, leg: 0.06, legR: 0.012, neck: [0.03, 0.9], head: [0.038, 0.042], snout: [0.02, 0.018], ears: 'point', earL: 0.025, tail: ['bush', 0.22, 0.05, 1.25], belly: 5, haunch: 0.8 }, max: 10 },
  muntjac: { kind: 'quad', o: { L: 0.32, R: 0.13, W: 0.1, leg: 0.3, legR: 0.022, neck: [0.15, 0.85], head: [0.06, 0.085], snout: [0.07, 0.03], ears: 'round', earL: 0.08, tail: ['stub', 0.07, 0.03, -0.3], tailReg: 5, belly: 1, hoof: true }, max: 3, shadow: true },
  roe: { kind: 'quad', o: { L: 0.45, R: 0.17, W: 0.13, leg: 0.5, legR: 0.026, neck: [0.3, 1.0], head: [0.07, 0.1], snout: [0.07, 0.032], ears: 'round', earL: 0.11, rump: true, belly: 1, hoof: true }, max: 4, shadow: true },
  rat: { kind: 'quad', o: { L: 0.1, R: 0.045, W: 0.04, leg: 0.028, legR: 0.009, neck: [0.02, 0.4], head: [0.03, 0.035], snout: [0.03, 0.015], ears: 'round', earL: 0.022, tail: ['thin', 0.18, 0.008, -0.2], tailReg: 3, belly: 1 }, max: 4 },
  mouse: { kind: 'quad', o: { L: 0.045, R: 0.024, W: 0.022, leg: 0.015, legR: 0.005, neck: [0.01, 0.4], head: [0.018, 0.02], snout: [0.015, 0.008], ears: 'round', earL: 0.018, tail: ['thin', 0.09, 0.004, 0], tailReg: 1, belly: 5 }, max: 4 },
  cow: { kind: 'quad', o: { L: 0.95, R: 0.38, W: 0.32, leg: 0.72, legR: 0.075, neck: [0.32, 0.25], neckR: 0.2, head: [0.16, 0.24], snout: [0.16, 0.12], ears: 'side', earL: 0.14, tail: ['tuft', 0.85, 0.03, -1.35], belly: 0, chest: 0.98, hoof: true, headDown: 0.4, horns: false }, max: 48, shadow: true },
  sheep: { kind: 'quad', o: { L: 0.55, R: 0.29, W: 0.27, leg: 0.36, legR: 0.03, neck: [0.14, 0.45], neckR: 0.13, head: [0.09, 0.14], snout: [0.07, 0.06], ears: 'side', earL: 0.09, earReg: 3, tail: ['stub', 0.1, 0.07, -0.6], tailReg: 0, face: 'dark', legReg: 3, headDown: 0.35 }, max: 60, shadow: true },
  horse: { kind: 'quad', o: { L: 0.85, R: 0.33, W: 0.26, leg: 0.85, legR: 0.055, neck: [0.62, 0.95], neckR: 0.15, head: [0.12, 0.3], snout: [0.2, 0.08], ears: 'point', earL: 0.11, tail: ['horse', 0.75, 0.09, -1.15], face: 'blaze', mane: true, hoof: true, sock: [0.18, 5], headDown: 0.9, rug: true }, max: 10, shadow: true },
  hedgehog: { kind: 'hog', o: { leg: 0.05, L: 0.13, R: 0.07 }, max: 4 },
  woodpigeon: { kind: 'bird', o: { L: 0.16, R: 0.085, W: 0.08, leg: 0.035, legR: 0.006, head: 0.045, beak: [0.02, 0.008], tail: [0.15, 0.06], wing: [0.38, 0.17], breast: 1, throat: 5, tip: 3, legReg: 2 }, max: 18 },
  pigeon: { kind: 'bird', o: { L: 0.14, R: 0.075, W: 0.07, leg: 0.03, legR: 0.006, head: 0.04, beak: [0.018, 0.007], tail: [0.12, 0.05], wing: [0.33, 0.15], throat: 2, patch: 1, tip: 3, legReg: 2 }, max: 28 },
  crow: { kind: 'bird', o: { L: 0.19, R: 0.085, W: 0.075, leg: 0.06, legR: 0.008, head: 0.05, beak: [0.05, 0.014], tail: [0.17, 0.06], wing: [0.45, 0.19], legReg: 3 }, max: 10 },
  rook: { kind: 'bird', o: { L: 0.19, R: 0.085, W: 0.075, leg: 0.06, legR: 0.008, head: 0.05, beak: [0.056, 0.013], tail: [0.17, 0.065], wing: [0.46, 0.19], cheek: 1, legReg: 3 }, max: 18 },
  magpie: { kind: 'bird', o: { L: 0.12, R: 0.07, W: 0.06, leg: 0.05, legR: 0.006, head: 0.04, beak: [0.035, 0.009], tail: [0.24, 0.035], wing: [0.3, 0.13], belly: 5, patch: 5, legReg: 3 }, max: 8 },
  jackdaw: { kind: 'bird', o: { L: 0.14, R: 0.07, W: 0.06, leg: 0.045, legR: 0.006, head: 0.042, beak: [0.025, 0.009], tail: [0.13, 0.05], wing: [0.34, 0.15], cheek: 1, legReg: 3 }, max: 10 },
  robin: { kind: 'bird', o: { L: 0.055, R: 0.045, W: 0.04, leg: 0.025, legR: 0.003, head: 0.028, beak: [0.012, 0.004], tail: [0.055, 0.02], wing: [0.11, 0.05], breast: 2, belly: 5, legReg: 3, tilt: 0.2 }, max: 5 },
  blackbird: { kind: 'bird', o: { L: 0.1, R: 0.05, W: 0.045, leg: 0.035, legR: 0.004, head: 0.032, beak: [0.022, 0.006], tail: [0.1, 0.03], wing: [0.18, 0.08], legReg: 3, tilt: 0.15 }, max: 6 },
  bluetit: { kind: 'bird', o: { L: 0.045, R: 0.035, W: 0.032, leg: 0.02, legR: 0.0025, head: 0.024, beak: [0.008, 0.004], tail: [0.05, 0.016], wing: [0.1, 0.045], breast: 1, cheek: 5, headReg: 2, legReg: 3, tilt: 0.2 }, max: 8 },
  sparrow: { kind: 'bird', o: { L: 0.055, R: 0.038, W: 0.035, leg: 0.02, legR: 0.003, head: 0.026, beak: [0.011, 0.006], tail: [0.055, 0.02], wing: [0.12, 0.05], breast: 1, throat: 3, headReg: 2, legReg: 3 }, max: 16 },
  starling: { kind: 'bird', o: { L: 0.08, R: 0.045, W: 0.04, leg: 0.03, legR: 0.004, head: 0.03, beak: [0.025, 0.006], tail: [0.06, 0.025], wing: [0.18, 0.07], legReg: 3 }, max: 26 },
  parakeet: { kind: 'bird', o: { L: 0.1, R: 0.05, W: 0.045, leg: 0.025, legR: 0.004, head: 0.035, beak: [0.018, 0.012], beakDown: 0.6, tail: [0.22, 0.025], wing: [0.22, 0.08], throat: 1, legReg: 1, tilt: 0.35 }, max: 14 },
  swift: { kind: 'bird', o: { L: 0.075, R: 0.032, W: 0.03, leg: 0, head: 0.024, beak: [0.008, 0.006], tail: [0.07, 0.03, true], wing: [0.21, 0.045], throat: 5, legReg: 3 }, max: 16 },
  swallow: { kind: 'bird', o: { L: 0.07, R: 0.03, W: 0.028, leg: 0, head: 0.023, beak: [0.008, 0.006], tail: [0.11, 0.045, true], wing: [0.17, 0.05], throat: 2, belly: 1, legReg: 3 }, max: 10 },
  pheasant: { kind: 'bird', o: { L: 0.24, R: 0.1, W: 0.09, leg: 0.09, legR: 0.009, head: 0.045, neck: 0.03, neckUp: 1.1, beak: [0.025, 0.009], tail: [0.42, 0.04], tailDown: 0.15, wing: [0.38, 0.17], headReg: 2, cheek: 1, legReg: 3 }, max: 5 },
  greenpecker: { kind: 'bird', o: { L: 0.12, R: 0.06, W: 0.055, leg: 0.03, legR: 0.005, head: 0.04, beak: [0.045, 0.008], tail: [0.1, 0.035], wing: [0.24, 0.1], headReg: 2, rumpReg: 1, legReg: 3, tilt: 0.25 }, max: 3 },
  gull: { kind: 'bird', o: { L: 0.16, R: 0.075, W: 0.07, leg: 0.06, legR: 0.006, head: 0.042, beak: [0.035, 0.008], tail: [0.1, 0.06], wing: [0.5, 0.15], headReg: 2, wingReg: 1, tip: 3, legReg: 3 }, max: 16 },
  heron: { kind: 'bird', o: { L: 0.24, R: 0.12, W: 0.1, leg: 0.48, legR: 0.012, head: 0.045, neck: 0.03, neckUp: 4.2, neckFwd: 1.05, beak: [0.13, 0.014], tail: [0.12, 0.08], wing: [0.85, 0.32], breast: 5, headReg: 5, crest: 3, tip: 3, legReg: 3, tilt: 0.55 }, max: 3, shadow: true },
  owl: { kind: 'bird', o: { L: 0.13, R: 0.13, W: 0.11, leg: 0.03, legR: 0.008, head: 0.075, neckUp: 0.9, beak: [0.02, 0.01], beakDown: 0.8, tail: [0.08, 0.06], wing: [0.45, 0.2], breast: 1, legReg: 1, tilt: 1.1 }, max: 3 },
  redkite: { kind: 'raptor', o: { L: 0.24, R: 0.075, W: 0.07, head: 0.05, tail: [0.3, 0.16, true], wing: [0.85, 0.3], patch: 5, tip: 3, belly: 1, headReg: 5 }, max: 5 },
  buzzard: { kind: 'raptor', o: { L: 0.22, R: 0.085, W: 0.08, head: 0.055, tail: [0.2, 0.17, false], wing: [0.65, 0.3], patch: 1, tip: 3, belly: 1 }, max: 3 },
  kestrel: { kind: 'raptor', o: { L: 0.15, R: 0.05, W: 0.045, head: 0.035, tail: [0.17, 0.06, false], wing: [0.38, 0.13], tip: 3, belly: 1, headReg: 2, tailReg: 2 }, max: 2 },
  mallard: { kind: 'waterbird', o: { L: 0.24, R: 0.1, W: 0.11, leg: 0.06, head: 0.05, neck: [0.1, 1.2], neckR: 0.04, bill: [0.06, 0.022], wing: [0.42, 0.18], breast: 1, collar: null, tailReg: 3, speculum: 2, headReg: 2, neckLow: 5, under: 3 }, max: 32 },
  coot: { kind: 'waterbird', o: { L: 0.18, R: 0.09, W: 0.09, leg: 0.08, head: 0.045, neck: [0.07, 1.25], neckR: 0.035, bill: [0.035, 0.012], shield: 5, wing: [0.33, 0.14] }, max: 18 },
  moorhen: { kind: 'waterbird', o: { L: 0.16, R: 0.08, W: 0.075, leg: 0.08, head: 0.04, neck: [0.07, 1.2], neckR: 0.03, bill: [0.03, 0.01], shield: 2, wing: [0.28, 0.12], flank: null, under: 5 }, max: 8 },
  grebe: { kind: 'waterbird', o: { L: 0.24, R: 0.085, W: 0.09, leg: 0.05, head: 0.04, neck: [0.2, 1.35], neckR: 0.035, bill: [0.06, 0.012], crest: 3, neckReg: 5, eyePatch: 2, wing: [0.35, 0.13], flank: 1 }, max: 8 },
  tufted: { kind: 'waterbird', o: { L: 0.2, R: 0.09, W: 0.095, leg: 0.05, head: 0.045, neck: [0.07, 1.2], neckR: 0.04, bill: [0.045, 0.02], crest: 0, flank: 5, wing: [0.36, 0.15] }, max: 18 },
  swan: { kind: 'waterbird', o: { L: 0.6, R: 0.23, W: 0.3, leg: 0.12, head: 0.08, neck: [0.62, 1.4], neckR: 0.06, sNeck: true, bill: [0.1, 0.035], knob: true, wing: [1.1, 0.45] }, max: 6, shadow: true },
  canada: { kind: 'waterbird', o: { L: 0.42, R: 0.16, W: 0.17, leg: 0.22, head: 0.06, neck: [0.42, 1.25], neckR: 0.045, bill: [0.06, 0.025], neckReg: 2, headReg: 2, strap: 5, breast: 1, under: 5, wing: [0.8, 0.32], tip: 2 }, max: 32, shadow: true },
  greylag: { kind: 'waterbird', o: { L: 0.42, R: 0.17, W: 0.17, leg: 0.22, head: 0.06, neck: [0.38, 1.2], neckR: 0.05, bill: [0.07, 0.025], under: 5, wing: [0.8, 0.32], tip: 1 }, max: 16, shadow: true },
  egyptian: { kind: 'waterbird', o: { L: 0.36, R: 0.15, W: 0.15, leg: 0.24, head: 0.055, neck: [0.3, 1.25], neckR: 0.045, bill: [0.05, 0.02], eyePatch: 2, headReg: 5, wing: [0.7, 0.3], speculum: 5, tip: 3 }, max: 6, shadow: true },
  bat: { kind: 'bat', o: { leg: 0, L: 0.03, R: 0.016 }, max: 8 },
  nest: { kind: 'nest', o: { size: 1 }, max: 40 },
  nestSmall: { kind: 'nest', o: { size: 0.45 }, max: 30 },
};
// which model draws a species (dogs: by breed, see COATS)
export const modelOf = (key, coat) => (key === 'dog' ? coat.model : key);

// coats: [main, second, accent, detail, extra, pattern, flags]; pattern 0 plain, 1 patches (Holstein), 2 tabby,
// 3 speckled, 4 mottled, 5 tortoiseshell; flags 1 eyeshine at night (horses: region 1 is the rug, drawn in winter)
const D = C(25, 22, 20), W = C(236, 232, 224), P = C(214, 160, 150);
export const COATS = {
  cat: [[C(118, 96, 72), C(206, 190, 160), 0, D, W, 2, 1], [C(28, 26, 26), C(28, 26, 26), 0, C(40, 34, 34), W, 0, 1], [C(196, 112, 48), C(232, 196, 140), 0, P, W, 2, 1],
    [C(24, 24, 24), W, 0, P, W, 1, 1], [C(122, 120, 118), C(190, 186, 180), 0, P, W, 2, 1], [C(40, 32, 28), C(188, 108, 44), 0, D, W, 5, 1], [W, W, 0, P, W, 0, 1]],
  dog: [
    { model: 'dog_lab', c: [C(214, 170, 100), C(214, 170, 100), 0, D, W, 0, 5] }, { model: 'dog_lab', c: [C(26, 24, 22), C(26, 24, 22), 0, D, W, 0, 5] },
    { model: 'dog_lab', c: [C(92, 58, 36), C(92, 58, 36), 0, D, W, 0, 5] }, { model: 'dog_lab', c: [C(196, 140, 70), C(220, 180, 110), 0, D, W, 0, 5], s: 0.95 },   // golden retriever
    { model: 'dog_lab', c: [C(150, 90, 40), W, 0, D, W, 5, 5], s: 0.7 },   // beagle (tan, white, black)
    { model: 'dog_lab', c: [C(180, 110, 50), W, 0, D, W, 0, 5], s: 0.72 },   // cocker spaniel
    { model: 'dog_lab', c: [C(205, 150, 95), C(205, 150, 95), 0, D, W, 0, 5], s: 0.62 },   // cockapoo
    { model: 'dog_collie', c: [C(26, 24, 22), W, 0, D, W, 0, 5] }, { model: 'dog_collie', c: [C(70, 50, 30), C(180, 130, 70), 0, D, C(180, 130, 70), 0, 5], s: 1.2 },   // German shepherd
    { model: 'dog_terrier', c: [W, W, 0, D, W, 1, 5] }, { model: 'dog_terrier', c: [C(120, 90, 70), C(220, 210, 200), 0, D, W, 0, 5], s: 1.25 },   // Staffie
    { model: 'dog_terrier', c: [C(200, 170, 130), C(200, 170, 130), 0, D, W, 0, 5], s: 1.1 },   // French bulldog
    { model: 'dog_dachs', c: [C(120, 62, 30), C(120, 62, 30), 0, D, W, 0, 5] }, { model: 'dog_dachs', c: [C(28, 24, 22), C(160, 100, 50), 0, D, C(160, 100, 50), 0, 5] },
  ],
  cow: [[C(28, 26, 26), W, 0, C(80, 64, 60), W, 1, 0], [C(28, 26, 26), W, 0, C(80, 64, 60), W, 1, 0], [C(112, 52, 32), W, 0, C(60, 40, 32), W, 0, 0], [C(30, 28, 28), C(30, 28, 28), 0, C(60, 50, 50), W, 0, 0], [C(176, 120, 70), C(200, 150, 100), 0, C(90, 70, 60), W, 0, 0]],
  sheep: [[C(226, 220, 204), C(226, 220, 204), 0, C(36, 32, 30), W, 4, 0], [C(214, 206, 188), C(214, 206, 188), 0, C(232, 226, 214), W, 4, 0], [C(230, 224, 210), C(230, 224, 210), 0, C(30, 28, 26), W, 4, 0]],
  horse: [[C(88, 52, 30), C(40, 70, 110), 0, C(28, 24, 22), W, 0, 0], [C(124, 66, 36), C(30, 90, 60), 0, C(80, 46, 30), W, 0, 0], [C(190, 186, 180), C(110, 40, 50), 0, C(120, 110, 105), W, 0, 0], [C(30, 26, 24), C(40, 70, 110), 0, C(20, 18, 16), W, 0, 0]],
  fox: [[C(190, 92, 36), C(190, 92, 36), 0, C(30, 22, 18), W, 0, 1], [C(176, 84, 40), C(176, 84, 40), 0, C(36, 26, 20), C(232, 226, 214), 0, 1]],
  badger: [[C(126, 124, 120), C(126, 124, 120), 0, C(22, 20, 20), W, 4, 1]],
  hedgehog: [[C(92, 72, 52), C(150, 120, 90), 0, D, C(206, 190, 160), 0, 0]],
  rabbit: [[C(122, 100, 76), C(160, 140, 115), 0, D, W, 4, 0], [C(108, 92, 72), C(150, 132, 110), 0, D, W, 4, 0]],
  hare: [[C(140, 104, 66), C(200, 180, 150), 0, D, W, 4, 0]],
  squirrel: [[C(126, 122, 116), C(126, 122, 116), 0, D, C(220, 214, 204), 4, 0], [C(132, 116, 100), C(132, 116, 100), 0, D, C(222, 214, 200), 4, 0]],
  muntjac: [[C(150, 90, 50), C(176, 130, 90), 0, D, W, 0, 1]],
  roe: [[C(150, 100, 62), C(180, 150, 120), 0, D, W, 0, 1], [C(118, 102, 90), C(160, 146, 132), 0, D, W, 0, 1]],
  rat: [[C(100, 88, 76), C(150, 140, 126), 0, P, W, 0, 1]],
  mouse: [[C(140, 100, 64), C(170, 140, 110), 0, P, W, 0, 1]],
  woodpigeon: [[C(150, 156, 172), C(186, 150, 156), 0, C(220, 190, 120), W, 0, 0]],
  pigeon: [[C(130, 134, 146), C(90, 92, 100), C(96, 130, 110), C(200, 110, 110), W, 0, 0], [C(80, 82, 90), C(60, 62, 70), C(96, 130, 110), C(200, 110, 110), W, 0, 0], [C(150, 150, 156), C(60, 62, 70), C(110, 140, 120), C(200, 110, 110), W, 3, 0], [C(220, 216, 210), C(200, 196, 190), C(180, 180, 176), C(200, 110, 110), W, 0, 0]],
  crow: [[C(22, 22, 26), C(22, 22, 26), 0, C(20, 20, 22), W, 0, 0]],
  rook: [[C(22, 22, 30), C(150, 146, 150), 0, C(40, 40, 44), W, 0, 0]],
  magpie: [[C(18, 20, 26), C(18, 20, 26), 0, C(20, 20, 22), W, 0, 0]],
  jackdaw: [[C(36, 36, 42), C(110, 112, 118), 0, C(20, 20, 22), W, 0, 0]],
  robin: [[C(120, 96, 66), C(120, 96, 66), C(214, 96, 46), C(40, 34, 30), C(226, 220, 210), 0, 0]],
  blackbird: [[C(20, 20, 22), C(20, 20, 22), 0, C(236, 170, 30), W, 0, 0], [C(90, 64, 44), C(110, 80, 56), 0, C(150, 120, 60), W, 0, 0]],
  bluetit: [[C(100, 140, 90), C(236, 214, 70), C(60, 110, 200), C(40, 40, 50), W, 0, 0]],
  sparrow: [[C(130, 96, 66), C(170, 160, 150), C(120, 116, 112), C(30, 28, 26), W, 3, 0], [C(140, 112, 82), C(180, 170, 156), C(140, 112, 82), C(80, 70, 60), W, 3, 0]],
  starling: [[C(30, 34, 36), C(30, 34, 36), 0, C(220, 190, 80), C(220, 216, 200), 3, 0]],
  parakeet: [[C(96, 186, 66), C(110, 200, 90), 0, C(200, 40, 40), W, 0, 0]],
  swift: [[C(40, 36, 34), C(40, 36, 34), 0, C(30, 28, 26), C(150, 144, 136), 0, 0]],
  swallow: [[C(24, 34, 70), C(236, 226, 206), C(150, 50, 36), C(30, 28, 26), W, 0, 0]],
  pheasant: [[C(170, 90, 40), C(200, 40, 40), C(30, 80, 60), C(200, 180, 140), W, 3, 0], [C(150, 120, 80), C(160, 130, 90), C(150, 120, 80), C(140, 120, 90), W, 4, 0]],
  greenpecker: [[C(110, 140, 70), C(220, 210, 80), C(200, 30, 40), C(60, 60, 60), W, 0, 0]],
  gull: [[C(236, 236, 236), C(176, 182, 192), C(60, 54, 52), C(196, 40, 40), W, 0, 0], [C(236, 236, 236), C(176, 182, 192), C(236, 236, 236), C(196, 40, 40), W, 0, 0]],
  heron: [[C(150, 154, 160), C(150, 154, 160), 0, C(220, 180, 60), C(232, 232, 228), 0, 0]],
  owl: [[C(120, 84, 56), C(160, 120, 80), 0, C(70, 60, 50), W, 4, 1]],
  redkite: [[C(164, 70, 40), C(190, 100, 60), 0, C(30, 24, 22), C(226, 222, 214), 0, 0]],
  buzzard: [[C(100, 74, 50), C(196, 176, 150), 0, C(40, 34, 30), W, 4, 0]],
  kestrel: [[C(170, 96, 56), C(220, 190, 150), C(130, 134, 150), C(40, 34, 30), W, 3, 0]],
  mallard: [[C(170, 172, 168), C(110, 70, 50), C(30, 110, 60), C(226, 200, 60), W, 0, 0], [C(140, 108, 76), C(150, 116, 80), C(130, 100, 70), C(200, 130, 60), C(150, 116, 80), 4, 0]],
  coot: [[C(26, 26, 30), C(26, 26, 30), 0, C(236, 236, 232), W, 0, 0]],
  moorhen: [[C(40, 40, 46), C(40, 40, 46), C(200, 40, 30), C(226, 210, 60), W, 0, 0]],
  grebe: [[C(110, 100, 90), C(170, 110, 70), C(180, 90, 40), C(200, 120, 120), W, 0, 0]],
  tufted: [[C(26, 26, 30), C(26, 26, 30), 0, C(120, 130, 150), W, 0, 0], [C(80, 62, 46), C(80, 62, 46), 0, C(110, 110, 120), C(130, 110, 90), 0, 0]],
  swan: [[C(242, 242, 238), C(242, 242, 238), C(24, 22, 22), C(220, 110, 40), W, 0, 0]],
  canada: [[C(120, 104, 88), C(170, 156, 140), C(24, 22, 22), C(24, 22, 22), W, 0, 0]],
  greylag: [[C(130, 122, 112), C(150, 142, 132), 0, C(230, 130, 60), W, 4, 0]],
  egyptian: [[C(176, 150, 120), C(176, 150, 120), C(120, 60, 40), C(220, 150, 140), C(200, 186, 170), 0, 0]],
  duckling: [[C(74, 60, 38), C(224, 200, 96), C(74, 60, 38), C(46, 40, 34), C(230, 206, 104), 0, 0]],
  cygnet: [[C(150, 140, 130), C(156, 146, 136), C(64, 60, 56), C(96, 86, 80), C(160, 150, 140), 0, 0]],
  gosling: [[C(168, 160, 92), C(190, 180, 112), C(150, 140, 82), C(64, 60, 44), C(190, 180, 112), 4, 0]],
  cootchick: [[C(40, 36, 34), C(40, 36, 34), C(214, 110, 56), C(214, 110, 56), C(200, 90, 44), 0, 0]],
  bat: [[C(70, 56, 46), C(50, 40, 36), 0, D, W, 0, 0]],
  nest: [[C(96, 76, 52), C(70, 54, 40), 0, D, W, 4, 0]],
  nestSmall: [[C(110, 90, 62), C(90, 70, 50), 0, D, W, 4, 0]],
};

// ---------------------------------------------------------------- material
const rotX = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c))); };
const rotY = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };
const rotZ = (v, a) => { const c = cos(a), s = sin(a); return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z); };
const about = (p, piv, rot, a) => rot(p.sub(piv), a).add(piv);
const eq = (a, k) => step(k - 0.5, a).mul(step(a, k + 0.5));
const unpack = v => { const r = floor(v.div(65536)), g = floor(v.sub(r.mul(65536)).div(256)), b = v.sub(r.mul(65536)).sub(g.mul(256)); return pow(vec3(r, g, b).div(255), vec3(2.2)); };
// modes: 0 stand/walk, 1 graze or peck (head down), 2 lie or sit (legs folded), 3 fly (wings beating), 4 swim
// (legs tucked away), 5 curled up, 6 perched (wings folded, legs short), 7 glide (wings held out)
export const MODE = { walk: 0, graze: 1, lie: 2, fly: 3, swim: 4, curl: 5, perch: 6, glide: 7 };

export function animalMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const rig = attribute('arig', 'vec4'), reg = attribute('areg', 'float');
  const iPos = attribute('iPos', 'vec4'), iAnim = attribute('iAnim', 'vec4'), iCol = attribute('iCol', 'vec4'), iVar = attribute('iVar', 'vec4'), iMisc = attribute('iMisc', 'vec4');
  const vN = varyingProperty('vec3', 'vAnN'), vReg = varyingProperty('float', 'vAnReg'), vLoc = varyingProperty('vec3', 'vAnLoc');
  const vC0 = varyingProperty('vec3', 'vAnC0'), vC1 = varyingProperty('vec3', 'vAnC1'), vC2 = varyingProperty('vec3', 'vAnC2'), vC3 = varyingProperty('vec3', 'vAnC3'), vC5 = varyingProperty('vec3', 'vAnC5');
  const vPat = varyingProperty('vec4', 'vAnPat');   // pattern, seed, eyeshine, rug
  m.positionNode = Fn(() => {
    const role = rig.x, piv = rig.yzw;
    const phase = iAnim.x, amp = iAnim.y, mode = iAnim.z, sc = iAnim.w;
    const drop = iMisc.x, wag = iMisc.y, look = iMisc.z;
    const flags = iVar.w, seed = iVar.z;
    vC0.assign(unpack(iCol.x)); vC1.assign(unpack(iCol.y)); vC2.assign(unpack(iCol.z)); vC3.assign(unpack(iCol.w)); vC5.assign(unpack(iVar.x));
    vPat.assign(vec4(iVar.y, seed, step(0.5, fract(flags.mul(0.5))), 0));
    vReg.assign(reg); vLoc.assign(positionGeometry);
    let p = positionGeometry, n = normalGeometry;
    const isFL = eq(role, 1), isFR = eq(role, 2), isHL = eq(role, 3), isHR = eq(role, 4), isLeg = isFL.add(isFR).add(isHL).add(isHR);
    const lie = eq(mode, 2), fly = eq(mode, 3).add(eq(mode, 7)), swim = eq(mode, 4), curl = eq(mode, 5), perch = eq(mode, 6);
    // legs: diagonal pairs swing with the gait; folded under to lie down; tucked up in flight
    // (a negative stride amplitude asks for a bound: front pair together, then the hind pair, as rabbits and squirrels)
    const bound = step(amp, 0), aAmp = abs(amp);
    const legPh = phase.add(mix(isFR.add(isHL), isHL.add(isHR), bound).mul(Math.PI));
    const swing = sin(legPh).mul(aAmp).mul(float(1).sub(lie)).mul(float(1).sub(fly));
    // (lying, the forelegs tuck back under the chest and the hind legs forward under the belly)
    const fold = lie.mul(isFL.add(isFR).mul(1.45).add(isHL.add(isHR).mul(-1.35))).add(fly.add(perch).mul(0.9));
    const legA = swing.add(fold).mul(isLeg);
    p = about(p, piv, rotX, legA); n = rotX(n, legA);
    p = mix(p, piv, isLeg.mul(swim.add(curl).min(1)));
    // head and neck: down to graze or peck, a nod with the stride, a turn to look
    const isHead = eq(role, 5);
    const headA = eq(mode, 1).mul(0.95).add(curl.mul(0.7)).add(sin(phase.mul(2)).mul(aAmp).mul(0.07)).mul(isHead);
    p = about(p, piv, rotX, headA); n = rotX(n, headA);
    p = about(p, piv, rotY, look.mul(isHead)); n = rotY(n, look.mul(isHead));
    // tail: wag (dogs), sway (cats, foxes), flick
    const isTail = eq(role, 6);
    // (curled up, the tail wraps round)
    const tailA = sin(U.t.mul(wag.mul(9).add(1.5)).add(seed.mul(7))).mul(wag.mul(0.55).add(0.08)).add(curl.mul(1.5)).mul(isTail);
    p = about(p, piv, rotY, tailA); n = rotY(n, tailA);
    // wings: modelled spread; folded they lie along the flank (span back, chord down the side, the upper
    // surface outward); in flight they beat about the shoulder (phase) or hold out for a glide with a little dihedral
    const isWL = eq(role, 7), isWR = eq(role, 8), side = isWL.sub(isWR), isWing = isWL.add(isWR);
    const rel = p.sub(piv), ax = abs(rel.x);
    const foldP = vec3(piv.x.mul(1.3).sub(side.mul(ax).mul(0.12)), piv.y.add(rel.z.mul(0.6)).sub(ax.mul(0.08)), piv.z.sub(ax.mul(0.55)).add(rel.z.mul(0.15)));
    const flapA = mix(sin(phase).mul(0.85).add(0.2), float(0.12), eq(mode, 7)).mul(side);
    const flyP = rotZ(rel, flapA).add(piv);
    p = mix(p, mix(foldP, flyP, fly), isWing);
    n = mix(n, mix(normalize(vec3(side, 0.35, 0)), rotZ(n, flapA), fly), isWing);
    // lying down: the body drops onto its folded legs; curled up: a ball
    p = p.add(vec3(0, lie.add(curl).mul(drop).negate(), 0));
    p = mix(p, vec3(p.x.mul(1.1), p.y.mul(0.8), p.z.mul(0.78)), curl);
    // the whole body pitches: nose up to sit up, climb a tree trunk or climb in flight (+), down to dive (-)
    const pitchA = iMisc.w.negate();
    p = rotX(p, pitchA); n = rotX(n, pitchA);
    p = p.mul(sc);
    const yaw = float(Math.PI / 2).sub(iPos.w);
    vN.assign(rotY(n, yaw));
    return rotY(p, yaw).add(iPos.xyz);
  })();
  m.normalNode = worldToView(normalize(vN));
  m.colorNode = Fn(() => {
    const r = vReg, lp = vLoc, pat = vPat.x, seed = vPat.y;
    // coat patterns on the main region
    const n1 = sin(lp.x.mul(9.1).add(seed.mul(13))).mul(sin(lp.y.mul(7.3).add(seed.mul(5)))).mul(sin(lp.z.mul(6.7).add(seed.mul(3))));
    const n2 = sin(lp.x.mul(41).add(lp.z.mul(23)).add(seed)).mul(sin(lp.y.mul(37).sub(lp.z.mul(29))));
    const patches = smoothstep(0.02, 0.12, n1.add(sin(lp.z.mul(3.1).add(seed.mul(11))).mul(0.25)));
    const tabby = smoothstep(0.35, 0.65, sin(lp.z.mul(48).add(sin(lp.y.mul(30)).mul(1.5))).mul(0.5).add(0.5));
    const speck = step(0.82, n2.mul(0.5).add(0.5));
    const mottle = smoothstep(0.3, 0.7, n2.mul(0.5).add(0.5).add(n1.mul(0.3)));
    let main = vC0;
    main = mix(main, vC1, patches.mul(eq(pat, 1)));
    main = mix(main, vC0.mul(0.55), tabby.mul(eq(pat, 2)));
    main = mix(main, vC5, speck.mul(eq(pat, 3)));
    main = mix(main, vC1, mottle.mul(eq(pat, 4)).mul(0.6));
    main = mix(main, vC3.mul(0.6).add(vC1.mul(0.4)), patches.mul(eq(pat, 5)));
    const col0 = main.mul(eq(r, 0)).add(vC1.mul(eq(r, 1))).add(vC2.mul(eq(r, 2))).add(vC3.mul(eq(r, 3))).add(vec3(0.02, 0.018, 0.016).mul(eq(r, 4))).add(vC5.mul(eq(r, 5)));
    // rain darkens fur and feathers a little
    const col = col0.mul(float(1).sub(U.wet.mul(0.18).mul(step(r, 2.5))));
    return col.mul(cloudShadow(positionWorld));
  })();
  // street lamps light them at night; a fox's, cat's or deer's eyes catch the light (eyeshine)
  m.emissiveNode = lightPool(positionWorld).mul(vC0).mul(0.6).add(vec3(0.75, 0.68, 0.36).mul(eq(vReg, 4)).mul(vPat.z).mul(U.night).mul(0.55));
  return m;
}

// ---------------------------------------------------------------- the renderer: one instanced mesh per model
export class AnimalRenderer {
  constructor(scene, shadows) {
    this.scene = scene; this.shadows = shadows; this.sets = new Map(); this.mat = null;
  }
  set(model) {
    let S = this.sets.get(model);
    if (S) return S;
    const def = MODELS[model]; if (!def) return null;
    if (!this.mat) this.mat = animalMaterial();
    const geo = BUILD[def.kind](def.o).geometry(), max = def.max;
    const at = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    S = { max, geo, n: 0, iPos: at('iPos'), iAnim: at('iAnim'), iCol: at('iCol'), iVar: at('iVar'), iMisc: at('iMisc') };
    S.mesh = new THREE.Mesh(geo, this.mat); S.mesh.frustumCulled = false; S.mesh.castShadow = !!(this.shadows && def.shadow); S.mesh.receiveShadow = true;
    S.mesh.name = 'animals-' + model;
    this.scene.add(S.mesh);
    this.sets.set(model, S);
    return S;
  }
  begin() { for (const S of this.sets.values()) S.n = 0; }
  // a: { x, y, z, heading, phase, amp (< 0: bounding), mode, scale, coat [c0, c1, c2, c3, c5, pattern, flags], seed,
  // drop (lying: how far the body sinks), wag, look (head turn), pitch, plain (region 1 drawn in the main colour:
  // a horse without its rug) }
  add(model, a) {
    const S = this.set(model); if (!S || S.n >= S.max) return false;
    const i = S.n++, c = a.coat, j = i * 4;
    const P = S.iPos.array, A = S.iAnim.array, Q = S.iCol.array, V = S.iVar.array, M = S.iMisc.array;
    P[j] = a.x; P[j + 1] = a.y; P[j + 2] = a.z; P[j + 3] = a.heading;
    A[j] = a.phase % 6283.185; A[j + 1] = a.amp || 0; A[j + 2] = a.mode || 0; A[j + 3] = a.scale || 1;
    Q[j] = c[0]; Q[j + 1] = a.plain ? c[0] : c[1]; Q[j + 2] = c[2] || c[0]; Q[j + 3] = c[3];
    V[j] = c[4]; V[j + 1] = c[5] || 0; V[j + 2] = a.seed || 0; V[j + 3] = c[6] || 0;
    M[j] = a.drop || 0; M[j + 1] = a.wag || 0; M[j + 2] = a.look || 0; M[j + 3] = a.pitch || 0;
    return true;
  }
  end() {
    for (const S of this.sets.values()) {
      S.geo.instanceCount = S.n; S.mesh.visible = S.n > 0;
      if (S.n) for (const at of [S.iPos, S.iAnim, S.iCol, S.iVar, S.iMisc]) at.needsUpdate = true;
    }
  }
}
