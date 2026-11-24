// Procedural animation for the two playable characters (Cal: the officer, Leon: the woman in the
// hoodie), driven every frame from the simulation instead of canned clips:
//  - Each bone has an alignment rotation that takes its bind pose (the officer was scanned in a T-pose, the
//    woman in an A-pose) into one anatomical frame: limbs hanging, feet forward, palms to the thighs. All
//    motion is anatomical joint angles in that frame, so the same gait drives both bodies.
//  - Walking and running follow normative gait kinematics (hip, knee and ankle flexion over the cycle,
//    toe break at push-off), with the pelvis bobbing twice a stride, swaying over the stance leg, rotating
//    with the stride and dropping on the swing side; the trunk counter-rotates, the arms swing opposite the
//    legs, the head stays level. Stride length and cadence follow speed and leg length, so feet plant
//    rather than skate. Walk and run blend by speed through one shared phase.
//  - Standing: soft knees, slow breathing in the chest and shoulders, weight shifting between the feet,
//    glances around. Starting, stopping and turning blend smoothly; the body leans into turns.
//  - Rain: an umbrella held up in the right hand.
import * as THREE from 'three/webgpu';

const D = Math.PI / 180;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _m3 = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const qAxis = (axis, ang, out = new THREE.Quaternion()) => out.setFromAxisAngle(axis, ang);
// rotation from Euler angles applied as X (flex) then Z (abduction) then Y (twist), in the parent frame
const qXZY = (x, z, y, out = new THREE.Quaternion()) => out.setFromEuler(_e.set(x, y, z, 'YZX'));

// periodic key curves over the gait cycle (u in 0..1, 0 = this foot's strike), degrees; Catmull-Rom
function curve(keys) {
  const k = keys.slice().sort((a, b) => a[0] - b[0]);
  return u => {
    u = ((u % 1) + 1) % 1;
    let i = k.findIndex(p => p[0] > u); if (i < 0) i = k.length;
    const p1 = k[(i - 1 + k.length) % k.length], p2 = k[i % k.length];
    const p0 = k[(i - 2 + k.length * 2) % k.length], p3 = k[(i + 1) % k.length];
    const t0 = p1[0], t1 = p2[0] <= p1[0] ? p2[0] + 1 : p2[0];
    const t = (u < t0 ? u + 1 : u) - t0, h = t1 - t0, s = t / h;
    const m1 = (p2[1] - p0[1]) / 2, m2 = (p3[1] - p1[1]) / 2;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * p1[1] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2[1] + (s3 - s2) * m2;
  };
}
// walking (~1.3 m/s): hip flexion, knee flexion, ankle dorsiflexion, toe extension (Winter; Perry)
const WALK = {
  hip: curve([[0, 25], [0.1, 22], [0.3, 6], [0.5, -10], [0.6, -6], [0.7, 8], [0.85, 26]]),
  knee: curve([[0, 4], [0.12, 17], [0.28, 7], [0.4, 4], [0.5, 9], [0.6, 36], [0.72, 60], [0.84, 38], [0.95, 6]]),
  ankle: curve([[0, 0], [0.07, -6], [0.2, 3], [0.45, 10], [0.55, 2], [0.62, -15], [0.7, -8], [0.8, 0], [0.9, 2]]),
  toe: curve([[0, 0], [0.4, 0], [0.52, 14], [0.6, 30], [0.68, 8], [0.75, 0]]),
};
// running (~4 m/s): longer swing, deep knee flexion in swing, flight phase
const RUN = {
  hip: curve([[0, 32], [0.15, 22], [0.32, -8], [0.42, -14], [0.6, 18], [0.8, 48], [0.92, 40]]),
  knee: curve([[0, 22], [0.14, 40], [0.32, 22], [0.42, 38], [0.6, 98], [0.75, 82], [0.9, 30]]),
  ankle: curve([[0, 4], [0.12, 18], [0.32, -22], [0.45, -12], [0.7, 4], [0.9, 6]]),
  toe: curve([[0, 0], [0.22, 10], [0.33, 30], [0.42, 0]]),
};

export class CharacterRig {
  constructor(root, opts = {}) {
    this.root = root;
    this.bones = {};
    root.traverse(o => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) { this.mesh = o; o.frustumCulled = false; } });
    const ex = opts.joints;          // rest joint positions (incl. end points), model space
    this.J = Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, new THREE.Vector3(...v)]));
    this.height = opts.height || 1.75;
    this.legLen = this.J.ThighL.y - this.J.FootL.y + 0.08;
    this.style = Object.assign({ armOut: 9, elbow: 14, stance: 0.5, swing: 1, femme: 0 }, opts.style || {});
    // alignment of each bone's bind frame to the anatomical frame
    this.A = {};
    const frame = (dir, ref) => { const d = dir.clone().normalize(), r = ref.clone().addScaledVector(d, -ref.dot(d)).normalize(), c = new THREE.Vector3().crossVectors(d, r);
      return new THREE.Matrix4().makeBasis(d, r, c); };
    const align = (restDir, canonDir, ref = Z) => {
      const Fr = frame(restDir, ref), Fc = frame(canonDir, ref);
      return new THREE.Quaternion().setFromRotationMatrix(Fc.multiply(Fr.transpose()));
    };
    const dir = (a, b) => this.J[b].clone().sub(this.J[a]);
    for (const s of ['L', 'R']) {
      this.A['UpperArm' + s] = align(dir('UpperArm' + s, 'Forearm' + s), new THREE.Vector3(0, -1, 0));
      this.A['Forearm' + s] = align(dir('Forearm' + s, 'Hand' + s), new THREE.Vector3(0, -1, 0));
      this.A['Hand' + s] = align(dir('Hand' + s, 'Fingers' + s), new THREE.Vector3(0, -1, 0));
      this.A['Fingers' + s] = this.A['Hand' + s]; this.A['Thumb' + s] = this.A['Hand' + s];
      this.A['Thigh' + s] = align(dir('Thigh' + s, 'Shin' + s), new THREE.Vector3(0, -1, 0));
      this.A['Shin' + s] = align(dir('Shin' + s, 'Foot' + s), new THREE.Vector3(0, -1, 0));
      const f = dir('Foot' + s, 'Toes' + s), t = dir('Toes' + s, 'Toes_end' + s);
      this.A['Foot' + s] = align(f, new THREE.Vector3(0, f.y, f.z), Y);
      this.A['Toes' + s] = align(t, new THREE.Vector3(0, t.y, t.z), Y);
    }
    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) this.rest[n] = b.position.clone();
    this.Wq = {};   // world (model-space) rotations this frame
    this.order = ['Hips', 'Spine', 'Spine1', 'Chest', 'Neck', 'Head', 'ClavicleL', 'UpperArmL', 'ForearmL', 'HandL', 'FingersL', 'ThumbL',
      'ClavicleR', 'UpperArmR', 'ForearmR', 'HandR', 'FingersR', 'ThumbR', 'ThighL', 'ShinL', 'FootL', 'ToesL', 'ThighR', 'ShinR', 'FootR', 'ToesR'];
    this.parent = {}; for (const n of this.order) this.parent[n] = this.bones[n].parent?.isBone ? this.bones[n].parent.name : null;
    // state
    this.phase = 0; this.loco = 0; this.runW = 0; this.t = Math.random() * 100; this.speed = 0; this.lean = 0; this.umb = 0;
    this.shift = 0; this.look = 0; this.lookT = 0; this.lookTarget = 0; this.yawPrev = null; this.turn = 0;
    this.prop = opts.prop || null;
    if (this.prop) { this.bones.HandR.add(this.prop); this.prop.position.copy(this.J.FingersR).sub(this.J.HandR).multiplyScalar(0.45); this.prop.visible = false; }
  }
  // actor state: speed (m/s), heading (rad), running, pose ('walk' | 'idle' | 'umbrella'), dt (s)
  update(a, dt) {
    if (dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const sp = Math.max(0, a.speedNow ?? a.speed ?? 0);
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    const v = this.speed, st = this.style;
    // turning rate (rad/s), smoothed
    if (this.yawPrev != null) { let dy = (a.heading || 0) - this.yawPrev; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.turn += (dy / dt - this.turn) * Math.min(1, dt * 6); }
    this.yawPrev = a.heading || 0;
    const loco = smooth(0.08, 0.6, v);
    this.loco += (loco - this.loco) * Math.min(1, dt * 6);
    const runW = smooth(2.3, 3.6, v); this.runW += (runW - this.runW) * Math.min(1, dt * 5);
    const umbT = a.pose === 'umbrella' ? 1 : 0; this.umb += (umbT - this.umb) * Math.min(1, dt * 4);
    if (this.prop) this.prop.visible = this.umb > 0.5;
    // stride: length grows with speed (and with leg length), cadence = speed / stride
    const k = this.legLen / 0.88;
    const strideW = (0.62 + 0.52 * Math.min(v, 2.4)) * k, strideR = (1.25 + 0.38 * v) * k;
    const stride = lerp(strideW, strideR, this.runW);
    this.phase = (this.phase + (v > 0.02 ? v / stride * dt : 0)) % 1;
    // amplitude: shuffling steps at low speed, full kinematics from ~1.2 m/s
    const ampW = Math.min(1.25, 0.35 + 0.65 * smooth(0.1, 1.3, v) + 0.2 * smooth(1.4, 2.2, v)), amp = lerp(ampW, Math.min(1.15, 0.75 + 0.08 * v), this.runW);
    const L = this.loco, R = this.runW, ph = this.phase;
    const leg = (u) => {
      const w = WALK, r = RUN;
      return { hip: lerp(w.hip(u), r.hip(u), R) * amp, knee: lerp(w.knee(u), r.knee(u), R) * lerp(1, amp, 0.6), ankle: lerp(w.ankle(u), r.ankle(u), R), toe: lerp(w.toe(u), r.toe(u), R) };
    };
    const lL = leg(ph), lR = leg(ph + 0.5);
    // idle: weight shift and breathing
    this.shift = Math.sin(this.t * 0.31) * 0.6 + Math.sin(this.t * 0.13 + 1.7) * 0.4;
    const breath = Math.sin(this.t * 1.55);
    if ((this.lookT -= dt) <= 0) { this.lookT = 2.5 + Math.random() * 5; this.lookTarget = (Math.random() - 0.5) * (Math.random() < 0.3 ? 1.1 : 0.45); }
    this.look += (this.lookTarget * (1 - L) - this.look) * Math.min(1, dt * 2.2);
    const I = 1 - L;
    // ------------------------------------------------------------------ pelvis
    const u2 = ph * Math.PI * 4, u1 = ph * Math.PI * 2;
    // walking: lowest in double support, highest at mid-stance; running: lowest at mid-stance, highest in flight
    const bob = L * lerp(0.022, 0.045, R) * amp * 0.5 * lerp(-Math.cos(u2), -Math.cos(u2 - 0.17 * Math.PI * 4), R) - L * lerp(0.0, 0.03, R);
    const sway = L * lerp(0.022, 0.008, R) * Math.sin(u1 - 0.6) + I * 0.012 * this.shift;
    const pYaw = L * lerp(5, 9, R) * D * -Math.cos(u1) * amp;
    const pObl = L * 4.5 * D * Math.sin(u1 - 0.9) * lerp(1, 0.5, R) + I * 2.5 * D * this.shift;
    const pTilt = L * (lerp(3, 10, R) * D + 1.5 * D * Math.cos(u2));
    this.lean += (Math.max(-0.35, Math.min(0.35, -this.turn * v * 0.045)) - this.lean) * Math.min(1, dt * 4);
    const hipsQ = qXZY(pTilt * 0.5, pObl + this.lean * 0.6, pYaw);
    const W = this.Wq;
    W.Hips = hipsQ.clone();
    // ------------------------------------------------------------------ spine and head (trunk counter-rotates)
    const trunkYaw = -pYaw * 1.25 + I * this.look * 0.15;
    const lean = L * lerp(2.5, 9, R) * D;
    const spineQ = [qXZY(lean * 0.4 + breath * 0.004 * I, -pObl * 0.45, trunkYaw * 0.3), qXZY(lean * 0.3 + breath * 0.006 * I, -pObl * 0.3, trunkYaw * 0.35), qXZY(lean * 0.3 - breath * 0.012 * I, -pObl * 0.2 + this.lean * 0.2, trunkYaw * 0.35)];
    this.chain('Hips', 'Spine', spineQ[0]); this.chain('Spine', 'Spine1', spineQ[1]); this.chain('Spine1', 'Chest', spineQ[2]);
    // head: hold the gaze level and forward; glances when standing
    const headYaw = -(pYaw + trunkYaw) * 0.8 + I * this.look * 0.7 + L * Math.max(-0.4, Math.min(0.4, this.turn * 0.12));
    this.chain('Chest', 'Neck', qXZY(-lean * 0.45 + 2 * D, 0, headYaw * 0.4));
    this.chain('Neck', 'Head', qXZY(-lean * 0.45 - pTilt * 0.4 + I * 2 * D * Math.sin(this.t * 0.21), -this.lean * 0.5, headYaw * 0.6));
    // ------------------------------------------------------------------ arms
    for (const [s, sg, l] of [['L', 1, lL], ['R', -1, lR]]) {
      const opp = s === 'L' ? lR : lL;   // arm swings with the opposite leg
      const swingW = (opp.hip - 5) * 0.62 * st.swing, swingR = opp.hip * 0.9;
      let flex = L * lerp(swingW, swingR, R) * D;
      let elbow = (st.elbow + L * lerp(8 + Math.max(0, opp.hip) * 0.35, 78, R)) * D + I * 3 * D * breath;
      let abd = (st.armOut + L * lerp(2, 6, R) + I * 1.5 * breath) * D * sg;
      let twist = lerp(-8, -14, R) * D * sg * L;
      let wrist = (8 + L * 6) * D;
      // umbrella (right hand): upper arm forward and in, forearm up, the shaft over the shoulder
      if (s === 'R' && this.umb > 0.01) { const u = this.umb; flex = lerp(flex, 24 * D, u); abd = lerp(abd, -6 * D, u); elbow = lerp(elbow, 104 * D, u); twist = lerp(twist, 25 * D, u); wrist = lerp(wrist, 0, u); }
      const clav = qXZY(0, (I * 1.2 * breath + L * 1.5 * Math.cos(u1 + (s === 'L' ? Math.PI : 0)) * (1 + R)) * D * sg, 0);
      this.chain('Chest', 'Clavicle' + s, clav);
      this.limb('Clavicle' + s, 'UpperArm' + s, qXZY(-flex, abd, twist));
      this.limb('UpperArm' + s, 'Forearm' + s, qXZY(-elbow, 0, -elbow * 0.25 * sg));
      this.limb('Forearm' + s, 'Hand' + s, qXZY(-wrist * 0.3, wrist * 0.5 * sg, 0));
      const curl = (lerp(28, 70, R) * L + 26 * I + (s === 'R' ? this.umb * 55 : 0)) * D;
      this.limb('Hand' + s, 'Fingers' + s, qXZY(0, -curl * sg, 0));
      this.limb('Hand' + s, 'Thumb' + s, qXZY(0, -curl * 0.4 * sg, 0));
    }
    // ------------------------------------------------------------------ legs
    const stanceKnee = I * (3 + 2 * Math.abs(this.shift)) * D;
    for (const [s, sg, l] of [['L', 1, lL], ['R', -1, lR]]) {
      const w = I * this.shift * sg;   // weight shift: the loaded leg straightens, the other relaxes
      const hip = L * l.hip * D + I * (1.5 + Math.max(0, -w) * 3) * D;
      const knee = L * l.knee * D + stanceKnee + I * Math.max(0, -w) * 6 * D;
      const ank = L * l.ankle * D - I * Math.max(0, -w) * 3 * D;
      const toe = L * l.toe * D;
      const abd = (L * 1.2 + I * st.stance) * D * sg - pObl * 0.5;
      this.limb('Hips', 'Thigh' + s, qXZY(-hip, abd, -pYaw * 0.4));
      this.limb('Thigh' + s, 'Shin' + s, qXZY(knee, 0, 0));
      this.limb('Shin' + s, 'Foot' + s, qXZY(-ank + (hip - knee) * 0.0, -abd * 0.6, 0));
      this.limb('Foot' + s, 'Toes' + s, qXZY(-toe, 0, 0));
    }
    // ------------------------------------------------------------------ write bones
    for (const n of this.order) {
      const b = this.bones[n], p = this.parent[n];
      if (!p) b.quaternion.copy(W[n]);
      else b.quaternion.copy(_q.copy(W[p]).invert().multiply(W[n]));
    }
    // feet on the ground: forward kinematics of both legs, then the pelvis height that puts the lowest point
    // of the feet on the floor (walking and standing: always in contact, which also gives the walk its
    // natural up-and-down; running: only lifted out of the floor, so the flight phase stays)
    const hp = _v.set(sway, bob * R - I * 0.006 * Math.abs(this.shift), L * lerp(0.0, 0.02, R)).add(this.rest.Hips);
    let low = Infinity;
    for (const s of ['L', 'R']) {
      const th = this.fk(hp, 'Hips', 'Thigh' + s), sh = this.fk(th, 'Thigh' + s, 'Shin' + s), ft = this.fk(sh, 'Shin' + s, 'Foot' + s);
      const ball = this.fk(ft, 'Foot' + s, 'Toes' + s), tip = ball.clone().add(this.J['Toes_end' + s].clone().sub(this.J['Toes' + s]).applyQuaternion(this.Wq['Toes' + s]));
      const heel = ft.clone().add(_m3.set(0, -(this.J['Foot' + s].y - 0.012), -0.035).applyQuaternion(this.Wq['Foot' + s]));
      low = Math.min(low, heel.y, ball.y - 0.008, tip.y - 0.004);
    }
    const lift = -low, fix = lerp(lift, Math.max(0, lift), R * L);
    this.ground = (this.ground ?? fix) + (fix - (this.ground ?? fix)) * Math.min(1, dt * 30);
    hp.y += this.ground;
    this.bones.Hips.position.copy(hp);
    // the umbrella stays upright over the head whatever the wrist does (shaft tilted slightly back)
    if (this.prop && this.prop.visible) this.prop.quaternion.copy(_q.copy(W.HandR).invert().multiply(qXZY(-0.22, 0.08, 0, _q2)));
  }
  // world position of `bone` given its parent's world position (model space, this frame's rotations)
  fk(parentPos, parent, bone) { return parentPos.clone().add(this.rest[bone].clone().applyQuaternion(this.Wq[parent])); }
  // spine-type bones: bind frame is already anatomical
  chain(parent, bone, local) { this.Wq[bone] = (this.Wq[bone] || new THREE.Quaternion()).copy(this.Wq[parent]).multiply(local); this._anat = this._anat || {}; this._anat[bone] = this.Wq[bone].clone(); }
  // limbs: anatomical world rotation, then the bind -> anatomical alignment
  limb(parent, bone, local) {
    this._anat = this._anat || {};
    const pa = this._anat[parent] || this.Wq[parent];
    const anat = (this._anat[bone] || new THREE.Quaternion()).copy(pa).multiply(local);
    this._anat[bone] = anat;
    this.Wq[bone] = (this.Wq[bone] || new THREE.Quaternion()).copy(anat).multiply(this.A[bone] || _q2.identity());
  }
}

// a folded-open umbrella for the right hand (shaft along the forearm-up direction)
export function makeUmbrella(color = 0x1d2230) {
  const g = new THREE.Group();
  const canopy = new THREE.ConeGeometry(0.5, 0.22, 16, 1, true);
  const p = canopy.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), y = p.getY(i); if (y < 0) p.setY(i, y + 0.03 * Math.cos(Math.atan2(z, x) * 8)); }
  canopy.computeVertexNormals();
  const cm = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.42, side: THREE.DoubleSide });
  const sm = new THREE.MeshStandardNodeMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.6 });
  const c = new THREE.Mesh(canopy, cm); c.position.y = 0.78; c.castShadow = true;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.84, 6), sm); shaft.position.y = 0.36;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8), new THREE.MeshStandardNodeMaterial({ color: 0x2a1c14, roughness: 0.6 }));
  handle.position.y = -0.02;
  g.add(c, shaft, handle);
  return g;
}
