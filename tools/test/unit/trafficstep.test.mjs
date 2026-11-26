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
  const start = new Map(T.list.map(v => [v.id, [v.x, v.z]])), spawned = [...T.list];
  const info = { night: 0, rain: 0, hour: 12, visible: () => false };
  for (let i = 0; i < 1800; i++) { t += 0.1; T.update(0.1, focus, info); }
  // traffic only removes a car once it has driven out of range of the focus (KILL_R), so removed cars travelled too
  const moved = spawned.filter(v => v.dead || Math.hypot(v.x - start.get(v.id)[0], v.z - start.get(v.id)[1]) > 30).length;
  assert.ok(moved > start.size * 0.5, `${moved}/${start.size} cars travelled`);
  assert.ok(T.list.every(v => Number.isFinite(v.x) && Number.isFinite(v.z)), 'positions finite');
  assert.ok(T.list.some(v => v.ind), 'someone is indicating');
  assert.ok(detected > 0, 'signal detectors triggered');
});

test('a right-angle junction joins both lane centres without a sideways jump', () => {
  const net={nEdges:2,cls:[0,0],classes:['residential'],len:[60,60],width:[7,7],
    flags:[0,0],lanesF:[1,1],lanesB:[1,1],laneCount:()=>1,
    at:(h,s,out)=>Object.assign(out,h===0?[s-60,0,0,1,0]:[0,0,s,0,1])};
  const traffic=new Traffic(net,{}), v={len:4.6,h:0,lane:0,lat:0,route:[0,2],ri:0};
  const arc=traffic.junctionArc(v,0,2,0,0);
  v.entryArc=arc;
  v.s=59.99;traffic.place(v);
  const previous={...v};
  v.exitArc=arc;v.h=2;v.s=.01;v.ri=1;traffic.place(v);
  assert.ok(Math.hypot(v.x-previous.x,v.z-previous.z)<.05);
  assert.ok(Math.abs(v.heading-previous.heading)<.02);
  assert.ok(v.heading>.3 && v.heading<1.3);
});
