// Arms and hands for Cal's rig (Tripo skeletons: L_/R_ Clavicle, Upperarm, Forearm, Hand, Index1..3,
// Mid, Ring, Pinky, Thumb), worked in world space so it doesn't matter that Cal's and Leon's bones point their
// local axes different ways: the animation clips still drive the body and legs, and this lays the arms on top.
//  reach(): a two-bone solve from the shoulder to put the wrist on a target with the elbow bent towards a pole,
//           then the hand turned so its knuckles point along F and its palm faces N (each the shortest turn from
//           where the clip had it, so the arm doesn't twist), blended in by a weight
//  curl():  fingers (and thumb) closed round a grip, about the hand's own knuckle axis
//  palm():  where the palm of a hand is now, and its frame (the grip point for whatever it holds)
import * as THREE from 'three/webgpu';

const FINGERS = ['Index', 'Mid', 'Ring', 'Pinky'];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

// set a bone's local rotation so its world rotation becomes `world` (blended from the clip's by w)
function setWorld(bone, world, w) {
  bone.parent.getWorldQuaternion(_pq);
  _q3.copy(_pq).invert().multiply(world);
  if (w >= 0.999) bone.quaternion.copy(_q3); else bone.quaternion.slerp(_q3, w);
  bone.updateMatrixWorld(true);
}

export class HeroArms {
  constructor(body) {
    this.body = body;
    const g = n => body.getObjectByName(n);
    body.updateMatrixWorld(true);
    this.side = {};
    for (const s of ['R', 'L']) {
      const S = this.side[s] = { up: g(s + '_Upperarm'), fore: g(s + '_Forearm'), hand: g(s + '_Hand'),
        fingers: FINGERS.map(f => [1, 2, 3].map(k => g(`${s}_${f}${k}`))), thumb: [1, 2, 3].map(k => g(`${s}_Thumb${k}`)) };
      this.ok = !!(S.up && S.fore && S.hand && S.fingers.every(f => f.every(Boolean)));
      if (!this.ok) return;
      // the hand's own axes: F wrist to knuckles, X little finger to index, N out of the palm (the side the thumb
      // closes towards)
      const kn = new THREE.Vector3(); for (const f of S.fingers) kn.add(f[0].position); kn.multiplyScalar(0.25);
      S.kn = kn.clone();
      S.F = kn.clone().normalize();
      const x = S.fingers[0][0].position.clone().sub(S.fingers[3][0].position); x.addScaledVector(S.F, -x.dot(S.F)).normalize();
      S.X = x;
      S.N = new THREE.Vector3().crossVectors(S.F, S.X).normalize();
      const tip = S.hand.worldToLocal(S.thumb[2].getWorldPosition(new THREE.Vector3()));
      tip.addScaledVector(S.F, -tip.dot(S.F)).addScaledVector(S.X, -tip.dot(S.X));
      if (tip.dot(S.N) < 0) S.N.negate();
      S.rest = Object.fromEntries([S.up, S.fore, S.hand, ...S.fingers.flat(), ...S.thumb].map(b => [b.name, b.quaternion.clone()]));
    }
  }
  // world length of the hand from the wrist to the knuckles
  handLen(s) { const S = this.side[s]; return S.hand.localToWorld(_a.copy(S.kn)).distanceTo(S.hand.getWorldPosition(_b)); }
  // the palm now: centre (a little in from the wrist-knuckle midpoint, towards the palm) and world F, X, N
  palm(s, out = {}) {
    const S = this.side[s], q = S.hand.getWorldQuaternion(_q);
    out.F = (out.F || new THREE.Vector3()).copy(S.F).applyQuaternion(q);
    out.X = (out.X || new THREE.Vector3()).copy(S.X).applyQuaternion(q);
    out.N = (out.N || new THREE.Vector3()).copy(S.N).applyQuaternion(q);
    const w = S.hand.getWorldPosition(_a), len = this.handLen(s);
    out.p = (out.p || new THREE.Vector3()).copy(w).addScaledVector(out.F, len * 0.55).addScaledVector(out.N, len * 0.22);
    out.len = len;
    return out;
  }
  // where the wrist has to be for the palm centre to sit at `palm` with the hand facing F/N
  wristFor(s, palm, F, N, out = new THREE.Vector3()) { const len = this.handLen(s); return out.copy(palm).addScaledVector(F, -len * 0.55).addScaledVector(N, -len * 0.22); }
  // the wrist of side s to `target` (world), elbow towards `pole`, hand knuckles along F and palm towards N
  reach(s, target, F, N, pole, w = 1) {
    const S = this.side[s]; if (!this.ok || w <= 0.001) return;
    const sh = S.up.getWorldPosition(new THREE.Vector3()), el = S.fore.getWorldPosition(new THREE.Vector3()), wr = S.hand.getWorldPosition(new THREE.Vector3());
    const a = sh.distanceTo(el), b = el.distanceTo(wr);
    const d = _a.copy(target).sub(sh); let dist = d.length(); if (dist < 1e-5) return;
    d.divideScalar(dist); dist = Math.max(Math.abs(a - b) + 1e-3, Math.min((a + b) * 0.9995, dist));
    const cosA = Math.max(-1, Math.min(1, (a * a + dist * dist - b * b) / (2 * a * dist))), sinA = Math.sqrt(1 - cosA * cosA);
    const p = _b.copy(pole).addScaledVector(d, -pole.dot(d)); if (p.lengthSq() < 1e-6) p.copy(DOWN).addScaledVector(d, -DOWN.dot(d)); p.normalize();
    const E = _c.copy(sh).addScaledVector(d, a * cosA).addScaledVector(p, a * sinA);
    // upper arm: the shortest turn from where it points now to the new elbow
    const cu = _d.copy(el).sub(sh).normalize(), du = _e.copy(E).sub(sh).normalize();
    S.up.getWorldQuaternion(_q2); _q.setFromUnitVectors(cu, du); setWorld(S.up, _q.multiply(_q2), w);
    // forearm: from the (new) elbow at the target
    const e2 = S.fore.getWorldPosition(new THREE.Vector3()), w2 = S.hand.getWorldPosition(new THREE.Vector3());
    const cf = _d.copy(w2).sub(e2).normalize(), df = _e.copy(target).sub(e2).normalize();
    S.fore.getWorldQuaternion(_q2); _q.setFromUnitVectors(cf, df); setWorld(S.fore, _q.multiply(_q2), w);
    this.orient(s, F, N, w);
  }
  // turn the hand so its knuckles point along F and its palm faces N
  orient(s, F, N, w = 1) {
    const S = this.side[s];
    const qh = S.hand.getWorldQuaternion(_q2);
    const Fc = _a.copy(S.F).applyQuaternion(qh), Nc = _b.copy(S.N).applyQuaternion(qh), Bc = _c.crossVectors(Fc, Nc);
    _m.makeBasis(Fc, Nc, Bc);
    const Ft = _d.copy(F).normalize(), Nt = _e.copy(N).addScaledVector(Ft, -N.dot(Ft)).normalize(), Bt = new THREE.Vector3().crossVectors(Ft, Nt);
    _m2.makeBasis(Ft, Nt, Bt).multiply(_m.transpose());
    _q.setFromRotationMatrix(_m2);
    setWorld(S.hand, _q.multiply(qh), w);
  }
  // close the fingers round a grip: angles (radians) for the three joints of the index finger, the other three
  // fingers, and the thumb; about the hand's knuckle axis so each finger folds towards the palm
  curl(s, index, rest, thumb, w = 1) {
    const S = this.side[s]; if (!this.ok || w <= 0.001) return;
    const qh = S.hand.getWorldQuaternion(new THREE.Quaternion());
    const F = _a.copy(S.F).applyQuaternion(qh), N = _b.copy(S.N).applyQuaternion(qh);
    const axis = new THREE.Vector3().crossVectors(F, N).normalize();   // turning F about this moves it towards N
    S.fingers.forEach((f, i) => {
      const ang = i === 0 ? index : rest;
      f.forEach((bone, k) => {
        bone.getWorldQuaternion(_q2); _q.setFromAxisAngle(axis, ang[k] * (0.86 + 0.07 * i));
        setWorld(bone, _q.multiply(_q2), w);
      });
    });
    // the thumb comes round towards the palm and the index finger
    const tAxis = _c.copy(F).negate();
    S.thumb.forEach((bone, k) => { bone.getWorldQuaternion(_q2); _q.setFromAxisAngle(k === 0 ? tAxis : axis, thumb[k]); setWorld(bone, _q.multiply(_q2), w); });
  }
}
