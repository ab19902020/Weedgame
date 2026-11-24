// Runs the traffic AI on the real network for a few simulated minutes (signals, give-way, lanes,
// indicators, signal detectors). Guards against merge regressions in Traffic.drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNet } from './world.mjs';
import { Traffic } from '../../../src/traffic.js';
import { F_DRIVE } from '../../../src/network.js';

test('traffic drives through junctions and signals without errors', async () => {
  const net = await loadNet();
  let t = 0, detected = 0;
  const sig = { get t() { return t; }, aspect: (ci, g) => ((Math.floor(t / 20) + ci + g) % 2 ? 'G' : 'R'), detect() { detected++; } };
  const T = new Traffic(net, sig, { seed: 5 });
  const focus = { x: -2869, z: -2225 };
  for (let k = 0; k < 120; k++) {
    const n = net.nearest(focus.x + (k % 12 - 6) * 40, focus.z + (Math.floor(k / 12) - 5) * 40, 150, e => net.flags[e] & F_DRIVE);
    if (n) T.spawnAt(n.e * 2 + (k & 1 && !(net.flags[n.e] & 1) ? 1 : 0), Math.min(n.s, net.len[n.e] - 1));
  }
  const start = new Map(T.list.map(v => [v.id, [v.x, v.z]]));
  const info = { night: 0, rain: 0, hour: 12, visible: () => false };
  for (let i = 0; i < 1800; i++) { t += 0.1; T.update(0.1, focus, info); }
  const moved = T.list.filter(v => start.has(v.id) && Math.hypot(v.x - start.get(v.id)[0], v.z - start.get(v.id)[1]) > 30).length;
  assert.ok(moved > start.size * 0.5, `${moved}/${start.size} cars travelled`);
  assert.ok(T.list.every(v => Number.isFinite(v.x) && Number.isFinite(v.z)), 'positions finite');
  assert.ok(T.list.some(v => v.ind), 'someone is indicating');
  assert.ok(detected > 0, 'signal detectors triggered');
});
