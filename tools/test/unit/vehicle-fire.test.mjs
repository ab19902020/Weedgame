// Cars catching fire and blowing up (vehicleFire.js), with stand-ins for the rest of the game: rounds into the
// bonnet set a car alight, it goes up some seconds later unless a hose is on it, the blast kills those close and
// knocks down those further out, sets off a car parked nose to tail, and the wreck comes down on its wheels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VehicleFires } from '../../../src/vehicleFire.js';
import { MODELS } from '../../../src/vehicles.js';

function world() {
  const hurts = [], booms = [], calls = [];
  const G = {
    time: 0, focus: { x: 0, z: 0 }, quality: 'medium',
    camera: { position: { x: 30, y: 2, z: 30 } },
    scene: { add() {}, remove() {} },
    traffic: { list: [], byId: new Map() },
    tiles: { ground: () => 0 },
    hud: { banner() {}, feed() {} },
    events: { emit() {} },
    roadName: () => 'Test Road',
    net: { nearest: () => null },
    peds: { list: [], nextId: 1, disturb() {}, hurt(p, dir, kind, dmg, o) { hurts.push({ p, kind, dmg, o }); if (o.lethal) p.dead = true; } },
    emergency: { wrecks: [], vehicleFire(v) { calls.push(v.id); return true; } },
    brothers: { me: { x: 200, y: 0, z: 200, hp: 100, vehicle: null }, cam: { shake: 0 } },
    wanted: { hurt() {}, knock() {} },
    carDyn: { loose: new Set(), makeLoose(o) { return (o.ph ||= { vx: 0, vz: 0, w: 0 }); } },
    breakables: { debris: { burst() {}, spark() {} }, gather() {} },
    carjack: { knockDown(v) { v.fallenBike = true; } },
    audio: { explosion() {}, shot() {}, crash() {}, play() {} },
    fireFx: { time: 0, burn() {}, light() {}, explosion(x, y, z, k) { booms.push([x, z, k]); }, puff() {} },
  };
  return { G, vf: new VehicleFires(G), hurts, booms, calls };
}
function add(G, id, model, x, z, heading = 0) {
  const v = { id, model, def: MODELS[model], kind: 'parked', parked: true, x, y: 0, z, heading, v: 0, paint: 0x2e5fa8 };
  G.traffic.list.push(v); G.traffic.byId.set(id, v); return v;
}
const pistol = { damage: 30 };
const run = (vf, secs, each) => { for (let t = 0; t < secs; t += 0.05) { vf.G.time += 0.05; each?.(); vf.update(0.05); } };

test('seven pistol rounds into the bonnet set a car alight, and some seconds later it goes up', () => {
  const { G, vf, booms, calls } = world(), v = add(G, 'a', 'saloon', 0, 0);
  for (let k = 0; k < 6; k++) vf.shot(v, 0, pistol, 'player');
  assert.ok(!v.burning, `still only smoking after six (engine ${v.eng.toFixed(2)})`);
  assert.ok(v.eng >= 0.45, 'smoking');
  vf.shot(v, 0, pistol, 'player');
  assert.ok(v.burning, 'alight after seven');
  assert.ok(v.fire.fuse >= 8.5 && v.fire.fuse <= 12, `fuse ${v.fire.fuse.toFixed(1)} s`);
  assert.deepEqual(calls, ['a'], 'a 999 call');
  run(vf, 4);
  assert.ok(!v.fire.exploded && v.fire.spread > 0.3, 'spreading back through the car');
  run(vf, 10);
  assert.ok(v.fire.exploded && v.burnt, 'gone up and burnt out');
  assert.equal(booms.length, 1);
  assert.deepEqual(v.flat, [1, 1, 1, 1], 'down on its rims');
});

test('rounds into the side or the back don\'t set the engine going; a hole in the tank does, from the rear', () => {
  const { G, vf } = world(), v = add(G, 'a', 'hatch', 0, 0);
  for (let k = 0; k < 12; k++) vf.shot(v, 2, pistol, 'player');
  assert.ok(!v.burning && !(v.eng > 0), 'side hits: nothing');
  for (let k = 0; k < 17; k++) vf.shot(v, 1, pistol, 'player');
  assert.ok(v.burning && v.fire.from === 'rear', 'the tank holed: alight from the back');
});

test('a motorbike goes up after four rounds, and quicker; a pedal bike never burns', () => {
  const { G, vf } = world(), m = add(G, 'm', 'motorcycle', 0, 0), b = add(G, 'b', 'bicycle', 10, 0);
  for (let k = 0; k < 4; k++) vf.shot(m, 2, pistol, 'player');
  assert.ok(m.burning, 'motorbike alight');
  assert.ok(m.fire.fuse <= 6.5, `short fuse (${m.fire.fuse.toFixed(1)} s)`);
  for (let k = 0; k < 20; k++) vf.shot(b, 0, pistol, 'player');
  assert.ok(!b.burning && !vf.ignite(b), 'pedal bike: no');
});

test('shooting a car that\'s already alight sets it off sooner', () => {
  const { G, vf } = world(), v = add(G, 'a', 'saloon', 0, 0);
  vf.ignite(v, { fuse: 10, by: 'player' });
  for (let k = 0; k < 10; k++) vf.shot(v, 2, pistol, 'player');
  assert.ok(v.fire.fuse < 5, `fuse cut to ${v.fire.fuse.toFixed(1)} s`);
});

test('the fire brigade\'s hose on it stops it going up, and puts it out', () => {
  const { G, vf, booms } = world(), v = add(G, 'a', 'saloon', 0, 0);
  vf.ignite(v, { fuse: 6 });
  run(vf, 20, () => vf.douse(v, 0.05, 14));
  assert.equal(booms.length, 0, 'no explosion');
  assert.ok(!v.burning && v.fire?.out !== false, 'out');
  run(vf, 40);
  assert.ok(!v.burning, 'and stays out');
});

test('the blast kills anyone close, knocks down those further off, and sets off a car parked nose to tail', () => {
  const { G, vf, hurts, booms } = world(), v = add(G, 'a', 'saloon', 0, 0), next = add(G, 'b', 'hatch', -(MODELS.saloon.L / 2 + 3.2), 0);
  const near = { x: 2.5, y: 0, z: 1.5 }, far = { x: 0, y: 0, z: 8 }, safe = { x: 30, y: 0, z: 0 };
  G.peds.list.push(near, far, safe);
  vf.ignite(v, { fuse: 0.1, by: 'player' });
  run(vf, 0.2);
  assert.equal(booms.length, 1);
  const h = p => hurts.find(e => e.p === p);
  assert.ok(h(near)?.o.lethal && h(near).o.by === 'player', 'close: killed, and it\'s on you');
  assert.ok(h(far) && !h(far).o.lethal && h(far).kind === 'down', 'further off: knocked down');
  assert.ok(!h(safe), 'well away: untouched');
  assert.ok(next.burning, 'the car behind caught');
  assert.ok(next.fire.fuse <= 6.5, 'and goes up in turn');
  run(vf, 7);
  assert.equal(booms.length, 2, 'two explosions');
});

test('the car thrown up by its own explosion comes down on its wheels where it was', () => {
  const { G, vf } = world(), v = add(G, 'a', 'saloon', 0, 0);
  vf.ignite(v, { fuse: 0.05 });
  run(vf, 0.1);
  assert.ok(v._air, 'in the air');
  let top = 0; run(vf, 6, () => { top = Math.max(top, v.y); });
  assert.ok(top > 0.6, `thrown up (${top.toFixed(2)} m)`);
  assert.ok(!v._air, 'landed');
  assert.ok(Math.abs(v.roll) < 1e-6 && Math.abs(v.pitch) < 1e-6, `upright (roll ${v.roll}, pitch ${v.pitch})`);
  assert.ok(Math.abs(v.y) < 0.02 && Math.hypot(v.x, v.z) < 4, `on the ground near where it was (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`);
});

test('your own car only catches once its engine\'s completely gone, and gives you time to get out', () => {
  const { G, vf } = world(), v = add(G, 'p', 'hatch', 0, 0);
  Object.assign(v, { player: true, parked: false, kind: 'traffic', dmg: [0.4, 0, 0, 0], eng: 1.05 });
  run(vf, 1);
  assert.ok(!v.burning, 'a wrecked engine alone: no');
  v.eng = 1.18; run(vf, 1);
  assert.ok(v.burning && v.fire.fuse >= 10, `alight, with ${v.fire?.fuse.toFixed(1)} s to get out`);
});
