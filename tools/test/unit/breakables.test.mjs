// Things that give way (breakables.js / carPhysics.giveWay) on a flat pad, with a stand-in for the
// breakables manager: lamp posts and hedges stop a creeping car but break when hit at speed; mature trees
// never give way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CarDynamics } from '../../../src/carPhysics.js';
import { MODELS } from '../../../src/vehicles.js';
import { SPEC, carLoss } from '../../../src/breakSpec.js';

function world(items) {
  const smashed = [];
  const G = {
    world: { s: { wet: 0 }, cur: { rain: 0 }, day: 1 },
    events: { emit: () => {} },
    tiles: { landcover: () => 1, ground: () => 0, tileAt: () => null, buildingsNear() {} },
    traffic: { list: [] },
    breakables: {
      gather(x, z, y, r, out) { for (const e of items) if (!e.broken) out.push(e.c); },
      smash(e, v, x, z, nx, nz, closing) { e.broken = true; smashed.push([e.kind, closing]); return carLoss(e, v, closing, G.time); },
      bump() {}, crash() {}, scrape() {},
    },
  };
  return { G, smashed, dyn: new CarDynamics(G) };
}
const post = (kind, x, z, r) => { const e = { kind, S: SPEC[kind], x, z, y: 0, r }; e.c = { k: 'post', x, z, r, b: e }; return e; };
const seg = (kind, ax, az, bx, bz, T) => { const e = { kind, S: SPEC[kind], ax, az, bx, bz, y: 0, T }; e.c = { k: 'wall', P: new Float32Array([ax, az, bx, bz]), s: 0, n: 2, T, b: e }; return e; };
const car = model => ({ id: 'c', model, def: MODELS[model], x: 0, y: 0, z: 0, heading: 0, sp: 0, v: 0 });
const run = (dyn, v, secs) => { for (let t = 0; t < secs; t += 1 / 60) { dyn.G.time = (dyn.G.time || 0) + 1 / 60; dyn.drive(v, 1 / 60, { throttle: 0, steer: 0 }); dyn.update(1 / 60); } };
const speed = v => Math.hypot(v.ph.vx, v.ph.vz);

test('a lamp post hit at speed snaps and the car carries on, a little slower and a little dented', () => {
  const lamp = post(20, 10, 0.3, 0.11), { dyn, smashed } = world([lamp]), v = car('hatch');
  dyn.ph(v); v.ph.vx = 15;
  run(dyn, v, 1.2);
  assert.ok(lamp.broken, 'lamp broken');
  assert.equal(smashed.length, 1);
  assert.ok(v.x > 14, `drove on past it (x ${v.x.toFixed(1)})`);
  assert.ok(speed(v) > 10 && speed(v) < 14.5, `kept most of its speed (${speed(v).toFixed(1)} m/s)`);
  assert.ok(v.dmg[0] > 0 && v.dmg[0] < 0.3, `light front damage (${v.dmg[0].toFixed(2)})`);
});

test('creeping into a lamp post just stops against it', () => {
  const lamp = post(20, 10, 0.3, 0.11), { dyn } = world([lamp]), v = car('hatch');
  dyn.ph(v); v.ph.vx = 2;
  run(dyn, v, 6);
  assert.ok(!lamp.broken, 'lamp still standing');
  assert.ok(v.x + v.def.L / 2 < 10.2, `stopped at the post (front at ${(v.x + v.def.L / 2).toFixed(2)})`);
});

test('a hedge gives way at speed but holds a car nosing into it', () => {
  const fast = seg(7, 10, -5, 10, 5, 0.35), w1 = world([fast]), v1 = car('saloon');
  w1.dyn.ph(v1); v1.ph.vx = 12;
  run(w1.dyn, v1, 1.5);
  assert.ok(fast.broken && v1.x > 13, `burst through (x ${v1.x.toFixed(1)})`);
  assert.ok(speed(v1) > 7 && speed(v1) < 11, `lost some speed (${speed(v1).toFixed(1)})`);
  const slow = seg(7, 10, -5, 10, 5, 0.35), w2 = world([slow]), v2 = car('saloon');
  w2.dyn.ph(v2); v2.ph.vx = 1.5;
  run(w2.dyn, v2, 8);
  assert.ok(!slow.broken && v2.x + v2.def.L / 2 < 10, 'held at the hedge');
});

test('shrubs never stop a car; mature trees always do', () => {
  const bush = post(22, 8, 0, 0.6), tree = post(23, 30, 0, 0.35), { dyn } = world([bush, tree]), v = car('hatch');
  dyn.ph(v); v.ph.vx = 20;
  run(dyn, v, 3);
  assert.ok(bush.broken, 'shrub flattened');
  assert.ok(!tree.broken, 'tree stands');
  assert.ok(v.x + v.def.L / 2 < 30.2, `stopped at the tree (front at ${(v.x + v.def.L / 2).toFixed(2)})`);
  assert.ok(v.dmg[0] > 0.3, 'and wrecked the front');
});

test('a garden wall gives way at speed even when the car takes two sections at once', () => {
  const a = seg(9, 12, -1.2, 12, 0, 0.12), b = seg(9, 12, 0, 12, 1.2, 0.12), { dyn, smashed } = world([a, b]), v = car('saloon');
  dyn.ph(v); v.ph.vx = 15;
  run(dyn, v, 1.5);
  assert.ok(a.broken && b.broken, 'both sections down');
  assert.equal(smashed.length, 2);
  assert.ok(v.x > 15 && speed(v) > 4, `ploughed through (x ${v.x.toFixed(1)}, ${speed(v).toFixed(1)} m/s)`);
  assert.ok(speed(v) < 10.5, 'but lost a good deal of speed');
});
