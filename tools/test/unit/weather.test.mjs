// Weather timeline (deterministic from the seed, continuous across save/restore) and wet/dry integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, STATES } from '../../../src/weather.js';

const mk = (o = {}) => new World({ seed: 4242, scale: 30, ...o });
const step = (w, gameSecs) => { const n = Math.ceil(gameSecs / 300); for (let i = 0; i < n; i++) w.update(300 / w.s.scale); };

test('same seed gives the same timeline; states are known', () => {
  const a = mk(), b = mk({ t: a.s.t, seg: { ...a.s.seg } });
  const sa = [], sb = [];
  for (let i = 0; i < 48; i++) { step(a, 1800); step(b, 1800); sa.push(a.stateName()); sb.push(b.stateName()); }
  assert.deepEqual(sa, sb);
  for (const s of sa) assert.ok(s in STATES, s);
  assert.ok(new Set(sa).size >= 3, 'the weather changes over a day: ' + [...new Set(sa)].join(','));
});

test('rain wets the roads and builds puddles; dry weather dries them', () => {
  const w = mk(); w.s.wet = 0; w.s.puddle = 0;
  w.force('rain'); step(w, 80 * 60);
  assert.ok(w.cur.rain > 0.9, 'raining');
  assert.ok(w.s.wet > 0.9, 'wet ' + w.s.wet.toFixed(2));
  assert.ok(w.s.puddle > 0.3, 'puddles ' + w.s.puddle.toFixed(2));
  const wet0 = w.s.wet, p0 = w.s.puddle;
  w.setHour(12); w.force('clear'); step(w, 80 * 60);
  assert.ok(w.cur.rain < 0.02);
  assert.ok(w.s.wet < wet0 && w.s.puddle < p0, `drying: wet ${w.s.wet.toFixed(2)}, puddles ${w.s.puddle.toFixed(2)}`);
  assert.ok(w.s.wet >= w.s.puddle * 0.6 - 1e-9, 'standing water keeps the surface wet');
});

test('saved state restores continuously (no jump in time, weather or wetness)', () => {
  const a = mk(); a.force('drizzle'); step(a, 5400);
  const saved = JSON.parse(JSON.stringify(a.s));
  const b = new World(saved);
  assert.equal(b.s.t, a.s.t); assert.equal(b.stateName(), a.stateName());
  assert.ok(Math.abs(b.s.wet - a.s.wet) < 1e-9);
  for (const k of Object.keys(a.cur)) assert.ok(Math.abs(a.cur[k] - b.cur[k]) < 1e-6, k);
});

test('Dev → Weather holds: a forced clear sky stops the rain within seconds and never rains again until Auto', () => {
  const w = mk(); w.force('rain'); step(w, 3600);
  assert.ok(w.cur.rain > 0.9, 'raining first');
  w.force('clear');
  for (let i = 0; i < 4; i++) w.update(1);          // four real seconds
  assert.ok(w.cur.rain < 0.01, 'the rain stops at once: ' + w.cur.rain.toFixed(3));
  for (let h = 0; h < 48; h++) { step(w, 1800); assert.equal(w.stateName(), 'clear'); assert.ok(w.cur.rain < 1e-6); }
  // held across a save and reload
  const b = new World(JSON.parse(JSON.stringify(w.s))); step(b, 7200); assert.equal(b.stateName(), 'clear');
  // Auto: the timeline takes over again
  b.force('auto'); assert.equal(b.s.forced, null);
  const seen = new Set(); for (let i = 0; i < 96; i++) { step(b, 1800); seen.add(b.stateName()); }
  assert.ok(seen.size >= 3, 'weather changes again under Auto: ' + [...seen].join(','));
});
