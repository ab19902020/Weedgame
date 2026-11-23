// Persistent traffic: snapshot near the brothers and restore with the same ids, edges and positions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNet } from './world.mjs';
import { Traffic, KEEP_R } from '../../../src/traffic.js';
import { F_DRIVE } from '../../../src/network.js';

test('fleet snapshot/restore round trip keeps ids and places, stays small', async () => {
  const net = await loadNet();
  const sig = { aspect: () => 'G', detect() {}, t: 0 };
  const A = new Traffic(net, sig, { seed: 9 });
  const anchors = [{ x: -2869, z: -2225 }, { x: -7180, z: -2560 }];
  for (const a of anchors) for (let k = 0; k < 60; k++) {
    const n = net.nearest(a.x + (k % 10 - 5) * 30, a.z + (Math.floor(k / 10) - 3) * 30, 120, e => net.flags[e] & F_DRIVE);
    if (n) A.spawnAt(n.e * 2, Math.min(n.s, net.len[n.e] - 1));
  }
  const far = net.nearest(10000, 10000, 5000, e => net.flags[e] & F_DRIVE); if (far) A.spawnAt(far.e * 2, 0);
  const snap = A.snapshotFleet(anchors);
  const near = A.list.filter(v => anchors.some(a => Math.hypot(v.x - a.x, v.z - a.z) < KEEP_R));
  assert.equal(snap.cars.length, Math.min(600, near.length), 'everything within KEEP_R and nothing else');
  const json = JSON.stringify(snap);
  assert.ok(json.length < 1e6, 'under 1 MB (' + json.length + ' bytes)');
  const B = new Traffic(net, sig, { seed: 10 });
  const n = B.restoreFleet(JSON.parse(json));
  assert.equal(n, snap.cars.length);
  for (const r of snap.cars) {
    const v = B.byId.get(r.id), o = A.byId.get(r.id);
    assert.ok(v, 'id ' + r.id + ' restored'); assert.equal(v.h, o.h); assert.equal(v.model, o.model);
    assert.ok(Math.hypot(v.x - o.x, v.z - o.z) < 4, 'same place');
  }
  assert.ok(B.nextId >= A.nextId, 'new ids never collide with restored ones');
});
