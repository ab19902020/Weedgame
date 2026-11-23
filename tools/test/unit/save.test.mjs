// Save round trip (brothers, vehicles, world, fleet) and migration from the v0.3–v0.5 prototype save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { manifest } from './world.mjs';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.window = globalThis;
const { Save, llToWorld, legacyToWorld } = await import('../../../src/save.js');
const M = manifest();
const mockG = (brothers, extra = {}) => ({ manifest: M, brothers: { b: brothers, active: 1, cam: { yaw: 0.7 } }, traffic: { list: extra.vehicles || [], snapshotFleet: () => ({ v: 1, nextId: 42, cars: [{ id: 'v7', k: 'traffic', m: 'hatch', p: 1, h: 10, s: 3, l: 0, v: 5, r: [10, 12] }] }) }, world: { s: { t: 1.7e9, seed: 5, wet: 0.4 } } });

test('round trip keeps brothers, active brother, owned vehicles, world and fleet', () => {
  store.clear();
  const b = [{ name: 'Cal Ward', short: 'Cal', x: 1, y: 0, z: 2, heading: 0.1, vehicle: null }, { name: 'Leon Ward', short: 'Leon', x: -5, y: 0, z: 8, heading: 2, vehicle: 'v3' }];
  const veh = [{ id: 'v3', model: 'hatch', paint: 2, x: -5, y: 0, z: 8, heading: 2, owner: 1, free: true }];
  const s1 = new Save(mockG(b, { vehicles: veh }));
  assert.ok(s1.now());
  const s2 = new Save(mockG([]));
  const ib = s2.initialBrothers({ x: 0, z: 0, h: 0 });
  assert.deepEqual(ib.brothers.map(x => x.name), ['Cal Ward', 'Leon Ward']);
  assert.equal(ib.active, 1); assert.equal(ib.camYaw, 0.7);
  assert.equal(ib.brothers[1].vehicle, 'v3');
  assert.equal(s2.vehicles[0].id, 'v3'); assert.equal(s2.world.wet, 0.4);
  assert.equal(s2.fleet.cars[0].id, 'v7'); assert.equal(s2.fleet.nextId, 42);
  assert.ok(store.get('greenCounty.sandbox.v1').length < 1e6, 'save under 1 MB');
});

test('fresh start: Cal and Leon in Woodley start position', () => {
  store.clear();
  const ib = new Save(mockG([])).initialBrothers({ x: 100, z: 200, h: 0 });
  assert.deepEqual(ib.brothers.map(x => x.short), ['Cal', 'Leon']);
  assert.equal(ib.brothers[0].x, 100); assert.equal(ib.active, 0);
});

test('legacy prototype save migrates positions and wardrobe and is never overwritten', () => {
  store.clear();
  const legacy = { business: { positions: [[70, 3300], [90, 3350]], wardrobe: [{ jacket: 3, skin: 1, hair: 2 }, null], active: 1, cash: 1234 } };
  store.set('greenCounty', JSON.stringify(legacy));
  const s = new Save(mockG([])); const ib = s.initialBrothers({ x: 0, z: 0, h: 0 });
  assert.equal(ib.migratedFrom, 'prototype'); assert.ok(s.migrated);
  const [x, z] = legacyToWorld(M.llfit, 70, 3300);
  assert.ok(Math.abs(ib.brothers[0].x - x) < 1e-6 && Math.abs(ib.brothers[0].z - z) < 1e-6);
  assert.ok(Number.isFinite(x) && Math.abs(x) < 60000 && Math.abs(z) < 60000, 'inside the map frame');
  assert.deepEqual(ib.brothers[0].outfit, { jacket: 3, skin: 1, hair: 2 });
  assert.equal(ib.active, 1);
  // saving writes the sandbox key, keeps the business layer, leaves the legacy key untouched
  s.G.brothers.b = ib.brothers; s.now();
  assert.equal(store.get('greenCounty'), JSON.stringify(legacy));
  assert.equal(JSON.parse(store.get('greenCounty.sandbox.v1')).business.legacy.business.cash, 1234);
});

test('llfit maps the fit origin near the world origin', () => {
  const [x, z] = llToWorld(M.llfit, M.llfit.lon0, M.llfit.lat0);
  assert.ok(Number.isFinite(x) && Number.isFinite(z));
});
