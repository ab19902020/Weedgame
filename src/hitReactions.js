// How people take a hit (peds.js decides what kind, riggedPeople.js calls apply() after the clip has posed the
// skeleton). Everything is a turn about a world axis worked out from the direction of the blow, so the same
// code drives the street rigs (Pelvis/Spine/Chest/ArmL...) and the ones built on the brothers' skeletons
// (Spine01/Spine02/L_Upperarm...), whose bones point their local axes in different ways.
//   jab       head snapped back, shoulders following, half a step back
//   body      doubled over the blow, knees giving a little, arms pulled in
//   stagger   thrown back: head and chest whip, arms fly out, a stumbling step or two
//   down      knees go, then over backwards (or forwards when hit from behind); lies there, then gets up
//   shot      a flinch and twist towards the wound; a lethal one: knees buckle, the body crumples and stays
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
  const t = R.t, s = R.s ?? 1, out = { spine: 0, head: 0, twist: 0, arms: 0, armsOut: 0, hips: 0, knees: 0, fall: 0, drop: 0, back: 1 };
  switch (R.type) {
    case 'jab': { const k = pulse(t, 0.07, 0.22) * s; out.head = 0.55 * k; out.spine = 0.16 * k; out.twist = 0.25 * k * (R.side || 1); out.arms = 0.25 * k; break; }
    case 'body': { const k = pulse(t, 0.1, 0.45) * s; out.spine = -0.62 * k; out.head = -0.3 * k; out.hips = 0.35 * k; out.knees = 0.45 * k; out.arms = -0.5 * k; break; }
    case 'stagger': { const k = pulse(t, 0.12, 0.38) * s; out.spine = 0.42 * k; out.head = 0.6 * k; out.twist = 0.35 * k * (R.side || 1); out.armsOut = 0.9 * k; out.knees = 0.25 * k; break; }
    case 'shot': {
      if (R.dead) {
        // flinch, knees buckle, then down
        const fl = pulse(t, 0.06, 0.25);
        out.spine = 0.3 * fl; out.head = 0.4 * fl; out.twist = 0.45 * fl * (R.side || 1);
        const buckle = ease((t - 0.12) / 0.35); out.hips = 0.9 * buckle; out.knees = 1.5 * buckle; out.drop = 0.35 * buckle;
        out.fall = ease((t - 0.35) / 0.55); out.armsOut = 0.5 * Math.min(1, t * 4) * (1 - out.fall * 0.5); out.back = R.back ?? 1;
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
  turn(rig.spine[0], axis, P.spine * 0.45); turn(rig.spine[1], axis, P.spine * 0.55);
  turn(rig.spine[1], UP, P.twist);
  turn(rig.head[0], axis, P.head * 0.4); turn(rig.head[1], axis, P.head * 0.6);
  // arms: pulled in (negative) or flung out in the direction of the blow (and out to the sides)
  for (const s of ['L', 'R']) {
    const [u, f] = rig.arm[s], sg = s === 'R' ? 1 : -1;
    turn(u, axis, P.arms * 0.8 + P.armsOut * 0.9);
    turn(u, _f, -sg * P.armsOut * 0.8);
    turn(f, side, -Math.abs(P.arms) * 0.9 - P.armsOut * 0.4);
  }
  // legs: hips flex (thighs forward), knees bend (shins back)
  for (const s of ['L', 'R']) {
    const [th, sh] = rig.leg[s];
    turn(th, side, P.hips * (s === 'L' ? 1.05 : 0.95));
    turn(sh, side, -P.knees);
  }
  // the whole body: down onto the ground about the feet (backwards along the blow, or forwards), dropped by
  // the buckled knees, lifted by its own thickness once it's lying
  const fallDir = P.back >= 0 ? _h : _h.clone().negate();
  const fallAxis = new THREE.Vector3().crossVectors(UP, fallDir).normalize();
  // into the root's frame (the root only turns about Y)
  slot.root.getWorldQuaternion(_w); const inv = _w.clone().invert();
  fallAxis.applyQuaternion(inv);
  slot.body.quaternion.setFromAxisAngle(fallAxis, P.fall * Math.PI / 2 * 0.97);
  slot.body.position.y = -P.drop * (1 - P.fall) + P.fall * 0.14;
}
