// Fast food and fuel (src/food.js, src/interiorPlan.js food(), src/fuel.js): at least fifteen real takeaways from
// the map, each with tills you can stand at, a counter that keeps you out of the kitchen and menu prices; cash
// that can't go below zero; and a tank that empties as you drive, cuts the engine when dry, and the stations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePlan } from '../../../src/interiorPlan.js';
import { MENUS, cash, spend } from '../../../src/food.js';
import { Fuel, tankOf } from '../../../src/fuel.js';
const J = JSON.parse(fs.readFileSync(new URL('../../../www/world/interiors.json', import.meta.url)));
const FOOD = J.sites.filter(s => s.kind === 'food');

test('at least fifteen takeaways, of several kinds, spread about', () => {
  assert.ok(FOOD.length >= 15, `${FOOD.length} takeaways`);
  for (const k of ['burger', 'chicken']) assert.ok(FOOD.filter(s => s.food === k).length >= 3, k);
  assert.ok(new Set(FOOD.map(s => s.food)).size >= 6, 'kinds of food');
  assert.ok(new Set(FOOD.map(s => s.district)).size >= 12, 'places');
  for (const n of ["McDonald's", 'KFC', 'Burger King']) assert.ok(FOOD.some(s => s.name === n), n);
});

test('every takeaway: tills at the counter, a menu, and the kitchen out of reach', () => {
  for (const s of FOOD) {
    const P = makePlan(s);
    assert.ok(P.tills.length >= 1 && MENUS[s.food]?.items.length >= 8, `${s.id} ${s.name}`);
    assert.ok(P.staffSpots.filter(q => !q.kitchen).length === P.tills.length, `${s.id} someone at each till`);
    // walk from the door straight at the back wall: the counter stops you in front of it
    let x = P.exit.x, y = P.exit.y;
    for (let i = 0; i < 600; i++) [x, y] = P.collide(x, y + 0.05, 0.3, 0);
    const counter = P.items.find(i => i.type === 'foodcounter');
    assert.ok(y < counter.y - counter.d / 2, `${s.id} ${s.name}: stopped at ${y.toFixed(2)}, counter front ${(counter.y - counter.d / 2).toFixed(2)}`);
    // and each till can be reached from the door (nothing in the way at the till's spot)
    for (const t of P.tills) { const [cx, cy] = P.collide(t.x, t.y, 0.3, 0); assert.ok(Math.hypot(cx - t.x, cy - t.y) < 0.25, `${s.id} till at ${t.x.toFixed(1)} is clear`); }
  }
});

test('cash: spending, and never more than you have', () => {
  const b = {};
  assert.equal(cash(b), 1500);
  assert.ok(spend(b, 7.49)); assert.equal(b.cash, 1492.51);
  assert.ok(!spend(b, 5000)); assert.equal(b.cash, 1492.51);
});

test('fuel: the tank empties with distance and throttle, the engine cuts when dry', () => {
  const F = new Fuel({ scene: { add() {} }, hud: { toast() {} } });
  const v = { id: 'x', model: 'rangerover', owner: 'Cal', sp: 20 };
  assert.equal(F.level(v), 1, 'the brothers\' own cars start full');
  // 10 km at a steady 20 m/s on light throttle (a full tank lasts hours of driving: propulsion.js)
  for (let t = 0; t < 500; t += 0.1) F.drive(v, 0.1, 0.3);
  const used = 1 - v.fuel;
  assert.ok(used > 0.03 && used < 0.1, `10 km used ${(used * 100).toFixed(1)}% of the tank`);
  assert.ok(tankOf({ model: 'evsaloon' }) > 0 && tankOf({ model: 'bicycle' }) === 0, 'electric cars have a battery, bicycles nothing');
  v.fuel = 0.0001; for (let i = 0; i < 20; i++) F.drive(v, 0.1, 1);
  assert.equal(F.drive(v, 0.1, 1), 0, 'no throttle when dry');
  assert.equal(tankOf({ model: 'bus' }), 0);
  assert.ok(J.fuel.length >= 10, `${J.fuel.length} petrol stations`);
});
