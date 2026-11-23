// Signal stage cycling (fixed time) and demand actuation (detectors, gap-out, rest on green, stage skipping).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNet } from './world.mjs';
import { Signals, MIN_GREEN, GAP, MAX_GREEN_K } from '../../../src/signals.js';

const pick = (sig, n = 2) => sig.ctl.find(c => !c.standalone && c.stages.filter(s => s.kind === 'veh').length >= n);
const run = (sig, secs, each) => { for (let t = 0; t < secs; t += 0.1) { if (each) each(); sig.update(0.1); } };

test('fixed-time controllers cycle through every vehicle stage with amber and all-red', async () => {
  const sig = new Signals(await loadNet()); sig.actuated = false;
  const c = pick(sig); assert.ok(c, 'a multi-stage controller exists');
  const seen = new Set(), phases = new Set();
  run(sig, 600, () => { seen.add(c.stage); phases.add(c.phase); });
  const veh = c.stages.map((s, i) => s.kind === 'veh' ? i : -1).filter(i => i >= 0);
  for (const i of veh) assert.ok(seen.has(i), 'stage ' + i + ' was served');
  for (const p of ['G', 'A', 'X', 'RA']) assert.ok(phases.has(p), 'phase ' + p + ' seen');
  // only one group ever shows green at once
  run(sig, 120, () => { const g = []; for (let k = 0; k < c.groups; k++) if (sig.aspect(c.i, k) === 'G') g.push(k); assert.ok(g.length <= 1); });
});

test('actuated: rests on green with no other demand, changes when another approach calls', async () => {
  const sig = new Signals(await loadNet());
  const c = pick(sig); const g0 = c.stages[c.stage].kind === 'veh' ? c.stages[c.stage].g : 0;
  // get onto a green for the current stage
  run(sig, 30, () => sig.detect(c.i, g0));
  const st0 = c.stage;
  run(sig, 200);                                          // nobody else waiting: stays
  assert.equal(c.stage, st0, 'rested on the current stage');
  assert.equal(c.phase, 'G');
  const other = c.stages.find((s, k) => s.kind === 'veh' && k !== st0).g;
  let t = 0; run(sig, 40, () => { sig.detect(c.i, other); if (sig.aspect(c.i, other) !== 'G') t += 0.1; });
  assert.equal(sig.aspect(c.i, other), 'G', 'the calling approach got green');
  assert.ok(t >= MIN_GREEN * 0 && t < 30, 'served within 30 s (' + t.toFixed(1) + ')');
});

test('actuated: a busy approach holds green up to the maximum, a quiet one gaps out', async () => {
  const sig = new Signals(await loadNet());
  const c = pick(sig), stA = c.stages.findIndex(s => s.kind === 'veh'), gA = c.stages[stA].g;
  const gB = c.stages.find((s, k) => s.kind === 'veh' && k !== stA).g;
  // bring stage A to green
  for (let i = 0; i < 2000 && !(c.stage === stA && c.phase === 'G'); i++) { sig.detect(c.i, gA); sig.update(0.1); }
  assert.equal(c.stage, stA);
  // busy: both call continuously -> held until max green
  let held = 0; while (c.phase === 'G' && held < 300) { sig.detect(c.i, gA); sig.detect(c.i, gB); sig.update(0.1); held += 0.1; }
  const max = c.stages[stA].green * MAX_GREEN_K;
  assert.ok(held > max - 1 && held < max + 1, `held ${held.toFixed(1)} s ~ max ${max.toFixed(1)} s`);
  // quiet: next time A is green with only B calling -> gaps out soon after min green
  for (let i = 0; i < 4000 && !(c.stage === stA && c.phase === 'G'); i++) { sig.detect(c.i, gA); sig.update(0.1); }
  let g = 0; while (c.phase === 'G' && g < 300) { sig.detect(c.i, gB); sig.update(0.1); g += 0.1; }
  assert.ok(g <= MIN_GREEN + GAP + 0.5, `gapped out after ${g.toFixed(1)} s`);
});
