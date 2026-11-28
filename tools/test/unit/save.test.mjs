// Save round trip (the player, vehicles, world, fleet), and a save from the two-brother game carrying on as Cal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifest } from './world.mjs';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.window = globalThis;
const { Save, llToWorld } = await import('../../../src/save.js');
const M = manifest();
const mockG = (brothers, extra = {}) => ({ manifest: M, brothers: { b: brothers, active: 0, cam: { yaw: 0.7 } }, traffic: { list: extra.vehicles || [], snapshotFleet: () => ({ v: 1, nextId: 42, cars: [{ id: 'v7', k: 'traffic', m: 'hatch', p: 1, h: 10, s: 3, l: 0, v: 5, r: [10, 12] }] }) }, world: { s: { t: 1.7e9, seed: 5, wet: 0.4 } } });

test('round trip keeps the player, owned vehicles, world and fleet', () => {
  store.clear();
  const b = [{ name: 'Cal Ward', short: 'Cal', x: -5, y: 0, z: 8, heading: 2, vehicle: 'v3', cash: 812.5 }];
  const veh = [{ id: 'v3', model: 'hatch', paint: 2, x: -5, y: 0, z: 8, heading: 2, owner: 'Cal', free: true }];
  const s1 = new Save(mockG(b, { vehicles: veh }));
  assert.ok(s1.now());
  const s2 = new Save(mockG([]));
  const ib = s2.initialBrothers({ x: 0, z: 0, h: 0 });
  assert.deepEqual(ib.brothers.map(x => x.name), ['Cal Ward']);
  assert.equal(ib.active, 0); assert.equal(ib.camYaw, 0.7);
  assert.equal(ib.brothers[0].vehicle, 'v3'); assert.equal(ib.brothers[0].cash, 812.5);
  assert.equal(s2.vehicles[0].id, 'v3'); assert.equal(s2.world.wet, 0.4);
  assert.equal(s2.fleet.cars[0].id, 'v7'); assert.equal(s2.fleet.nextId, 42);
  assert.ok(store.get('greenCounty.sandbox.v1').length < 1e6, 'save under 1 MB');
});

test('fresh start: Cal alone, at the Woodley start position', () => {
  store.clear();
  const ib = new Save(mockG([])).initialBrothers({ x: 100, z: 200, h: 0 });
  assert.deepEqual(ib.brothers.map(x => x.short), ['Cal']);
  assert.equal(ib.brothers[0].x, 100); assert.equal(ib.active, 0);
});

test('a two-brother save carries on as the brother being played, as Cal, with both brothers\' money and kit', () => {
  store.clear();
  const cal = { name: 'Cal Ward', short: 'Cal', x: 1, y: 0, z: 2, heading: 0.1, vehicle: null, cash: 200,
    items: { fishing: { rods: { float: { line: 6 } }, bait: { maggots: 3, corn: 0 }, tackle: { hooks: 2 }, log: [{ s: 'roach' }] } } };
  const leon = { name: 'Leon Ward', short: 'Leon', x: -5, y: 0, z: 8, heading: 2, vehicle: 'leon-car', cash: 950, outfit: { jacket: 1, skin: 1, hair: 0 },
    items: { drone: { model: 'kestrel-t3', battery: 0.4 }, fishing: { rods: { carp: { line: 12 } }, bait: { maggots: 2, boilies: 5 }, tackle: { hooks: 1, leads: 4 }, log: [{ s: 'tench' }] } } };
  store.set('greenCounty.sandbox.v1', JSON.stringify({ version: 1, brothers: [cal, leon], active: 1, camYaw: 0.3 }));
  const ib = new Save(mockG([])).initialBrothers({ x: 0, z: 0, h: 0 });
  assert.equal(ib.brothers.length, 1); assert.equal(ib.active, 0);
  const me = ib.brothers[0];
  assert.equal(me.name, 'Cal Ward'); assert.equal(me.short, 'Cal'); assert.deepEqual(me.outfit, { jacket: 0, skin: 0, hair: 0 });
  assert.equal(me.x, -5); assert.equal(me.vehicle, 'leon-car');                 // where Leon was, in his car
  assert.equal(me.cash, 1150);
  assert.equal(me.items.drone.model, 'kestrel-t3');
  assert.deepEqual(Object.keys(me.items.fishing.rods).sort(), ['carp', 'float']);
  assert.equal(me.items.fishing.bait.maggots, 5); assert.equal(me.items.fishing.bait.boilies, 5);
  assert.equal(me.items.fishing.tackle.hooks, 3); assert.equal(me.items.fishing.tackle.leads, 4);
  assert.equal(me.items.fishing.log.length, 2);
});

test('llfit maps the fit origin near the world origin', () => {
  const [x, z] = llToWorld(M.llfit, M.llfit.lon0, M.llfit.lat0);
  assert.ok(Number.isFinite(x) && Number.isFinite(z));
});
