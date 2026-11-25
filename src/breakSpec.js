// What it takes to knock things down (used by breakables.js and carPhysics.js; no three.js here so the
// unit tests can load it). Kinds 1-9 are tile-worker struct props (tileWorker.js: brkRec), 20+ instanced.
// brk: closing speed that breaks it (m/s); loss + frac * closing speed: what the car loses going through;
// dmg: how much of the hit dents the car; fall: animation; snd: sound
export const SPEC = {
  1: { brk: 10, loss: 4, frac: 0.3, dmg: 1.1, fall: 'topple', snd: 'pole' },          // telegraph pole
  2: { brk: 0.6, loss: 0.25, frac: 0.02, dmg: 0, fall: 'toss', snd: 'bin', up: 3 },     // wheelie bin
  3: { brk: 1.8, loss: 0.6, frac: 0.03, dmg: 0, fall: 'toss', snd: 'can', up: 2.5 },    // litter bin
  4: { brk: 2.5, loss: 1.2, frac: 0.05, dmg: 0.2, fall: 'toss', snd: 'wood', up: 1.6 }, // bench
  5: { brk: 13, loss: 5, frac: 0.35, dmg: 1.3, fall: 'topple', snd: 'iron' },          // pillar box
  7: { brk: 2.2, loss: 0.8, frac: 0.14, dmg: 0, fall: 'flatten', snd: 'leaves' },       // hedge section
  8: { brk: 2.5, loss: 0.5, frac: 0.06, dmg: 0, fall: 'toss', snd: 'wood', up: 1.2 },   // fence panel
  10: { brk: 0.4, loss: 0.3, frac: 0.05, dmg: 0, fall: 'flatten', snd: 'leaves' },      // garden shrub
  9: { brk: 11, loss: 3.5, frac: 0.3, dmg: 1.1, fall: 'rubble', snd: 'brick' },         // low garden wall
  20: { brk: 4, loss: 2, frac: 0.08, dmg: 0.8, fall: 'topple', snd: 'lamp' },           // lamp post
  21: { brk: 9, loss: 3.5, frac: 0.32, dmg: 1.1, fall: 'topple', snd: 'tree' },         // young tree
  23: { brk: Infinity, loss: 0, frac: 0, dmg: 0, fall: null, snd: 'tree' },             // mature tree
  22: { brk: 0.4, loss: 0.25, frac: 0.05, dmg: 0, fall: 'flatten', snd: 'leaves' },     // shrub
};

// the speed (m/s) a car loses breaking e at closing speed `closing`. A car is wider than one hedge, fence or
// wall section: the neighbouring sections it takes at the same moment add only a little more drag
export function carLoss(e, v, closing, now) {
  const S = e.S;
  let loss = Math.min(closing, S.loss + S.frac * closing);
  if (e.kind >= 7 && e.kind <= 9 && v._smashK === e.kind && now - v._smashT < 0.35) loss *= 0.2;
  v._smashK = e.kind; v._smashT = now;
  return loss;
}
// does a hit at `closing` m/s break e? A car already ploughing through a run of hedge, fence or wall takes
// the next section with it at a quarter of the usual speed
export function breaks(e, v, closing, now) {
  const run = e.kind >= 7 && e.kind <= 9 && v._smashK === e.kind && now - v._smashT < 0.35;
  return closing >= (run ? e.S.brk * 0.25 : e.S.brk);
}
