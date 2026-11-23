// Walk graph: footway links and pathfinding used by pedestrians and the acceptance walkTo helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNet } from './world.mjs';
import { WalkGraph } from '../../../src/walkgraph.js';

test('walk paths are continuous on walkable edges and plausible in length', async () => {
  const net = await loadNet(), g = new WalkGraph(net);
  assert.ok(g.links.size > 0, 'dangling footways linked');
  const pairs = [[[-2869, -2225], [-2700, -2050]], [[-7180, -2560], [-6900, -2700]]];
  for (const [[x0, z0], [x1, z1]] of pairs) {
    const p = g.path(x0, z0, x1, z1);
    assert.ok(p && p.pts.length >= 2, 'a path exists');
    const crow = Math.hypot(x1 - x0, z1 - z0);
    assert.ok(p.length >= crow * 0.8 && p.length < crow * 3 + 200, `length ${p.length.toFixed(0)} vs ${crow.toFixed(0)}`);
    for (let i = 1; i < p.pts.length; i++) { const a = p.pts[i - 1], b = p.pts[i]; assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 400, 'no teleport jumps'); }
  }
});
