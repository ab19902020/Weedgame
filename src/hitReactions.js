// How people take a hit (peds.js decides what kind, riggedPeople.js calls apply() after the clip has posed the
// skeleton). Everything is a turn about a world axis worked out from the direction of the blow, so the same
// code drives the street rigs (Pelvis/Spine/Chest/ArmL...) and the ones built on the brothers' skeletons
// (Spine01/Spine02/L_Upperarm...), whose bones point their local axes in different ways.
//   jab       head snapped back, shoulders following, half a step back
//   body      doubled over the blow, knees giving a little, arms pulled in
//   stagger   thrown back: head and chest whip, arms fly out, a stumbling step or two
//   down      knees go, then over backwards (or forwards when hit from behind); lies there, then gets up
//   shot      a lethal one: knees buckle, the body crumples and stays (a head shot drops them at once; some
//             stumble a step or two first)
//   shotClutch hit in the body from the front: jolted back, then doubled over the wound, arms in
//   shotArch   hit from behind: the chest thrown forward along the shot, head and arms back, stumbling on
//   shotKnee   hit in the leg: that knee gives and they go down onto it, then up again
//   shotSpin   hit in the arm: spun round by it, the arm thrown back
//   down (writhe) lying wounded: knees drawn up, rolling a little, until they get up again
// applyWound() keeps a wounded person hunched over (or limping) as they get away.
import * as THREE from 'three/webgpu';

const RIGS = {
  npc: { spine: ['Spine', 'Chest'], head: ['Neck', 'Head'], arm: { L: ['ArmL', 'ForearmL'], R: ['ArmR', 'ForearmR'] }, leg: { L: ['ThighL', 'ShinL'], R: ['ThighR', 'ShinR'] } },
  tripo: { spine: ['Spine01', 'Spine02'], head: ['NeckTwist01', 'Head'], arm: { L: ['L_Upperarm', 'L_Forearm'], R: ['R_Upperarm', 'R_Forearm'] }, leg: { L: ['L_Thigh', 'L_Calf'], R: ['R_Thigh', 'R_Calf'] } },
};
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _w = new THREE.Quaternion(), _p = new THREE.Quaternion(), _a = new THREE.Vector3(), _h = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
// up quickly over `a` seconds, then back down over `d`
const pulse = (t, a, d) => t < a ? Math.sin(t / a * Math.PI / 2) : Math.exp(-(t - a) / d);
const ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };

export function rigOf(body) {
  const kind = body.getObjectByName('Spine01') ? 'tripo' : body.getObjectByName('Chest') ? 'npc' : null;
  if (!kind) return null;
  const R = RIGS[kind], g = n => body.getObjectByName(n);
  return { kind, spine: R.spine.map(g), head: R.head.map(g), arm: { L: R.arm.L.map(g), R: R.arm.R.map(g) }, leg: { L: R.leg.L.map(g), R: R.leg.R.map(g) } };
}
// turn a bone about a world axis (on top of whatever the clip did)
function turn(bone, axis, ang) {
  if (!bone || Math.abs(ang) < 1e-4) return;
  bone.getWorldQuaternion(_w); _q.setFromAxisAngle(axis, ang);
  bone.parent.getWorldQuaternion(_p);
  bone.quaternion.copy(_p.invert().multiply(_q.multiply(_w)));
  bone.updateMatrixWorld(true);
}

// the pose of a reaction at time t: per part angles about the blow's axis (+ = in the direction of the blow) and
// the body's fall (0 upright .. 1 flat on the ground)
export function reactionPose(R) {
  const t = R.t, s = R.s ?? 1, out = { spine: 0, spineLo: 0, head: 0, twist: 0, arms: 0, armsOut: 0, hips: 0, knees: 0, fall: 0, drop: 0, back: 1, kneel: 0, kSide: 1, armSide: 0, armFling: 0, writhe: 0, writheRoll: 0 };
  switch (R.type) {
    case 'jab': { const k = pulse(t, 0.07, 0.22) * s; out.head = 0.55 * k; out.spine = 0.16 * k; out.twist = 0.25 * k * (R.side || 1); out.arms = 0.25 * k; break; }
    case 'body': { const k = pulse(t, 0.1, 0.45) * s; out.spine = -0.62 * k; out.head = -0.3 * k; out.hips = 0.35 * k; out.knees = 0.45 * k; out.arms = -0.5 * k; break; }
    case 'stagger': { const k = pulse(t, 0.12, 0.38) * s; out.spine = 0.42 * k; out.head = 0.6 * k; out.twist = 0.35 * k * (R.side || 1); out.armsOut = 0.9 * k; out.knees = 0.25 * k; break; }
    case 'shot': {
      if (R.dead) {
        // flinch, knees buckle, then down: a head shot drops them where they stand; a stumble carries them a
        // couple of steps first
        const head = R.zone === 'head', st = R.stumble ? 0.55 : 0, fl = pulse(t, head ? 0.03 : 0.06, head ? 0.1 : 0.25);
        out.spine = (head ? 0.15 : 0.3) * fl + (st ? 0.25 * pulse(t, 0.1, 0.5) : 0); out.head = (head ? 0.8 : 0.4) * fl; out.twist = 0.45 * fl * (R.side || 1);
        const b0 = head ? 0.02 : 0.12 + st, f0 = head ? 0.12 : 0.35 + st;
        const buckle = ease((t - b0) / (head ? 0.18 : 0.35)); out.hips = 0.9 * buckle; out.knees = 1.5 * buckle; out.drop = 0.35 * buckle;
        out.fall = ease((t - f0) / (head ? 0.42 : 0.55)); out.armsOut = (head ? 0.2 : 0.5) * Math.min(1, t * 4) * (1 - out.fall * 0.5); out.back = R.back ?? 1;
        if (R.jolt > 0) { out.spine += R.jolt; R.jolt = Math.max(0, R.jolt - 0.02); }
      } else { const k = pulse(t, 0.06, 0.3) * s; out.spine = 0.3 * k; out.head = 0.35 * k; out.twist = 0.5 * k * (R.side || 1); out.arms = -0.35 * k; out.knees = 0.2 * k; }
      break;
    }
    case 'down': {
      // knees go (0.15 s), over (0.45 s), on the ground until `lie`, then up again over a second
      const lie = R.lie ?? 2.4, up = R.dead ? 0 : ease((t - lie) / 1.1);
      const over = ease((t - 0.1) / 0.45) * (1 - up);
      out.knees = 0.7 * ease(t / 0.15) * (1 - over) + up * (1 - up) * 2.2; out.hips = 0.4 * ease(t / 0.15) * (1 - over) + up * (1 - up) * 1.6;
      out.head = 0.5 * pulse(t, 0.08, 0.3) + 0.25 * over; out.spine = 0.3 * pulse(t, 0.1, 0.35);
      out.armsOut = 1.1 * Math.min(1, t * 6) * (1 - ease((t - 0.7) / 0.5)) * (1 - up);
      out.fall = over; out.back = R.back ?? 1;
      // wounded on the ground: knees drawn up, rolling, an arm over the wound
      if (R.writhe) { const w = over * (1 - up) * ease((t - 0.6) / 0.6) * R.writhe; out.writhe = w * (0.6 + 0.4 * Math.sin(t * 2.3)); out.writheRoll = w * 0.25 * Math.sin(t * 1.3); out.armsOut *= 1 - w; out.arms -= 0.6 * w; }
      break;
    }
    case 'shotClutch': {
      const jolt = pulse(t, 0.05, 0.14) * s, d = R.dur ?? 1.1, fold = ease((t - 0.06) / 0.25) * (1 - ease((t - d * 0.75) / (d * 0.25)));
      out.spine = 0.4 * jolt - 0.6 * fold; out.head = 0.5 * jolt - 0.3 * fold; out.twist = 0.25 * jolt * (R.side || 1);
      out.arms = -0.85 * fold; out.knees = 0.4 * fold; out.hips = 0.35 * fold;
      break;
    }
    case 'shotArch': {
      const k = pulse(t, 0.06, 0.4) * s, step = Math.sin(Math.min(1, t / (R.dur ?? 0.85)) * Math.PI * 2.5);
      out.spineLo = 0.35 * k; out.spine = -0.3 * k; out.head = -0.55 * k; out.armsOut = -0.9 * k; out.knees = 0.25 * k + 0.15 * Math.abs(step) * k;
      break;
    }
    case 'shotKnee': {
      const lie = R.lie ?? 1.2, down = ease((t - 0.04) / 0.22), up = ease((t - lie) / 0.6), k = down * (1 - up);
      out.kneel = k; out.kSide = R.side || 1; out.spine = -0.35 * k + 0.2 * pulse(t, 0.04, 0.15); out.head = 0.25 * pulse(t, 0.05, 0.2) - 0.15 * k;
      out.arms = -0.5 * k; out.drop = 0.45 * k;
      break;
    }
    case 'shotSpin': {
      const k = pulse(t, 0.05, 0.32) * s;
      out.twist = 1.0 * k * (R.side || 1); out.armSide = R.side || 1; out.armFling = 1.3 * k; out.spine = 0.18 * k; out.head = 0.3 * k; out.knees = 0.15 * k;
      break;
    }
  }
  return out;
}

// pose a rigged person mid-reaction (slot from riggedPeople; a is the ped with a.react)
export function applyReaction(slot, a) {
  const R = a.react;
  if (!R) { if (slot.reacting) { slot.body.quaternion.identity(); slot.body.position.y = 0; slot.reacting = false; } return; }
  const rig = slot.rig ??= rigOf(slot.body); if (!rig) return;
  slot.reacting = true;
  const P = reactionPose(R);
  // the blow's direction (horizontal), and the axis that tips things that way
  _h.set(Math.cos(R.dir), 0, Math.sin(R.dir));
  const axis = _a.crossVectors(UP, _h).normalize();
  // the person's own forward and right
  const hd = a.heading || 0; _f.set(Math.cos(hd), 0, Math.sin(hd)); _r.set(-Math.sin(hd), 0, Math.cos(hd));
  const side = _r.clone();
  slot.body.updateMatrixWorld(true);
  // trunk and head
  turn(rig.spine[0], axis, P.spine * 0.45 + P.spineLo); turn(rig.spine[1], axis, P.spine * 0.55);
  turn(rig.spine[1], UP, P.twist);
  turn(rig.head[0], axis, P.head * 0.4); turn(rig.head[1], axis, P.head * 0.6);
  // arms: pulled in (negative) or flung out in the direction of the blow (and out to the sides)
  for (const s of ['L', 'R']) {
    const [u, f] = rig.arm[s], sg = s === 'R' ? 1 : -1;
    const fling = P.armSide === sg ? P.armFling : 0;
    turn(u, axis, P.arms * 0.8 + P.armsOut * 0.9 + fling);
    turn(u, _f, -sg * (P.armsOut * 0.8 + fling * 0.5));
    turn(f, side, -Math.abs(P.arms) * 0.9 - Math.abs(P.armsOut) * 0.4 - fling * 0.3);
  }
  // legs: hips flex (thighs forward), knees bend (shins back); kneeling on the hit leg, the other foot planted
  // in front; drawn up when writhing on the ground
  for (const s of ['L', 'R']) {
    const [th, sh] = rig.leg[s], sg = s === 'R' ? 1 : -1, hitLeg = P.kSide === sg;
    turn(th, side, P.hips * (s === 'L' ? 1.05 : 0.95) + P.kneel * (hitLeg ? 0.15 : 1.35) + P.writhe * (s === 'L' ? 1.1 : 0.8));
    turn(sh, side, -P.knees - P.kneel * (hitLeg ? 1.65 : 1.3) - P.writhe * 1.4);
  }
  // the whole body: down onto the ground about the feet (backwards along the blow, or forwards), dropped by
  // the buckled knees, lifted by its own thickness once it's lying
  const fallDir = P.back >= 0 ? _h : _h.clone().negate();
  const fallAxis = new THREE.Vector3().crossVectors(UP, fallDir).normalize();
  // into the root's frame (the root only turns about Y)
  slot.root.getWorldQuaternion(_w); const inv = _w.clone().invert();
  fallAxis.applyQuaternion(inv);
  slot.body.quaternion.setFromAxisAngle(fallAxis, P.fall * Math.PI / 2 * 0.97);
  if (P.writheRoll) { _q.setFromAxisAngle(_a.set(0, 1, 0).applyQuaternion(inv), P.writheRoll); slot.body.quaternion.premultiply(_q); }
  slot.body.position.y = -P.drop * (1 - P.fall) + P.fall * 0.14;
}

// a wounded person getting away: hunched over a body wound with an arm across it, or a limp on a bad leg
export function applyWound(slot, a) {
  const W = a.wound; if (!W) return;
  const rig = slot.rig ??= rigOf(slot.body); if (!rig) return;
  const k = Math.min(1, W.t / 0.4) * Math.max(0, Math.min(1, (W.life - W.t) / 2));
  if (k <= 0.01) return;
  // facing: a fleeing person's root is turned round (riggedPeople), so take it from the body
  slot.body.updateMatrixWorld(true);
  const fw = _f.set(0, 0, 1).applyQuaternion(slot.root.getWorldQuaternion(_w)).setY(0).normalize();
  const right = _r.crossVectors(fw, UP).normalize();
  if (W.zone === 'leg') {
    // the step on the bad leg gives a little: the hips dip and the trunk leans over it
    const dip = Math.max(0, Math.sin((a.phase || 0) + (W.side > 0 ? 0 : Math.PI))) * k;
    turn(rig.spine[0], fw, W.side * 0.12 * dip); turn(rig.spine[1], right, -0.12 * k);
    slot.body.position.y = -0.05 * dip;
    return;
  }
  // hunched, the arm on the other side across the wound (its own side's arm for a wound to the arm hangs)
  turn(rig.spine[0], right, -0.18 * k); turn(rig.spine[1], right, -0.22 * k);
  const holdSide = W.zone === 'arm' ? (W.side > 0 ? 'L' : 'R') : (W.side > 0 ? 'L' : 'R'), sg = holdSide === 'R' ? 1 : -1;
  const [u, f] = rig.arm[holdSide];
  turn(u, right, 0.75 * k); turn(u, fw, sg * 0.55 * k); turn(f, right, 1.25 * k);
  if (W.zone === 'arm') { const [u2, f2] = rig.arm[holdSide === 'R' ? 'L' : 'R']; turn(u2, right, 0.25 * k); turn(f2, right, -0.2 * k); }
}
