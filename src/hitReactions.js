// How people take a hit (peds.js decides what kind; the crowd renderer, humans.js, turns this pose into the
// body's lean, arms, legs and fall in its vertex shader). Angles are about the blow's axis (+ = in the direction
// of the blow), so the renderer resolves them against the way the person faces.
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
// A wounded person getting away (hunched over the wound, or limping) is posed by humans.js from ped.wound.
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
// up quickly over `a` seconds, then back down over `d`
const pulse = (t, a, d) => t < a ? Math.sin(t / a * Math.PI / 2) : Math.exp(-(t - a) / d);
const ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };

// the pose of a reaction at time t: per part angles about the blow's axis (+ = in the direction of the blow) and
// the body's fall (0 upright .. 1 flat on the ground)
// (`out` is filled in and returned, so the renderer can reuse one object every frame)
export function reactionPose(R, out = {}) {
  const t = R.t, s = R.s ?? 1;
  out.spine = 0; out.spineLo = 0; out.head = 0; out.twist = 0; out.arms = 0; out.armsOut = 0; out.hips = 0; out.knees = 0; out.fall = 0; out.drop = 0;
  out.back = 1; out.kneel = 0; out.kSide = 1; out.armSide = 0; out.armFling = 0; out.writhe = 0; out.writheRoll = 0;
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
