// network.route: A* over drivable half-edges returns a contiguous path that respects one-way streets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNet, manifest } from './world.mjs';
import { F_DRIVE, F_ONEWAY } from '../../../src/network.js';

const near = (net, x, z) => { const n = net.nearest(x, z, 300, e => net.flags[e] & F_DRIVE); assert.ok(n, 'no drivable road near ' + x + ',' + z); return net.eb[n.e]; };
const check = (net, a, b, r) => {
  assert.ok(Array.isArray(r) && r.length > 0, 'no route');
  assert.equal(net.startNode(r[0]), a, 'starts at the origin node');
  assert.equal(net.endNode(r.at(-1)), b, 'ends at the destination node');
  for (let i = 1; i < r.length; i++) assert.equal(net.startNode(r[i]), net.endNode(r[i - 1]), 'contiguous at step ' + i);
  for (const h of r) { const e = h >> 1; assert.ok(net.flags[e] & F_DRIVE, 'drivable'); if (net.flags[e] & F_ONEWAY) assert.equal(h & 1, 0, 'one-way edge driven forwards'); }
};

test('route between Woodley and Reading town centre is contiguous and legal', async () => {
  const net = await loadNet();
  const a = near(net, -2869, -2225), b = near(net, -7180, -2560);
  const r = net.route(a, b, { limit: 250000 });
  check(net, a, b, r);
  const len = r.reduce((s, h) => s + net.len[h >> 1], 0);
  const crow = Math.hypot(-2869 + 7180, -2225 + 2560);
  assert.ok(len >= crow * 0.98 && len < crow * 2.2, `route length ${len.toFixed(0)} m plausible vs ${crow.toFixed(0)} m crow-flies`);
});

test('route to itself is empty; routes between districts exist', async () => {
  const net = await loadNet(), m = manifest();
  const a = near(net, -2869, -2225);
  assert.deepEqual(net.route(a, a), []);
  const ds = m.districts.filter(d => /Earley|Wokingham|Cemetery/.test(d.name)).slice(0, 3);
  for (const d of ds) { const b = near(net, d.x, d.z); check(net, a, b, net.route(a, b, { limit: 250000 })); }
});
