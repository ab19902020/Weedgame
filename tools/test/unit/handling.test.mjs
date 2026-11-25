// Handling and driving assists (src/carPhysics.js): what a touch player actually does (flooring it out of a
// junction, full lock at speed, a quick swerve, lifting or braking hard mid-corner) must not spin any car with
// the assists on ('Easy', the default), dry or wet; 'Realistic' allows more slide but still no spin from
// braking in a turn; steering at speed actually turns the car (it used to scrub at about half a g); and the
// handbrake still swings the tail round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CarDynamics, params } from '../../../src/carPhysics.js';
import { MODELS } from '../../../src/vehicles.js';

const world = (wet = 0) => new CarDynamics({ world: { s: { wet }, cur: { rain: 0 }, day: 1 }, events: { emit: () => {} },
  tiles: { landcover: () => 1, ground: () => 0, tileAt: () => null, buildingsNear() {} }, traffic: { list: [] } });
const car = m => ({ id: m, model: m, def: MODELS[m], x: 0, y: 0, z: 0, heading: 0, sp: 0, v: 0, player: true });
const slip = v => { const fx = Math.cos(v.heading), fz = Math.sin(v.heading), u = v.ph.vx * fx + v.ph.vz * fz, vl = -v.ph.vx * fz + v.ph.vz * fx; return Math.atan2(vl, Math.max(0.5, Math.abs(u))); };
const at = (dyn, v, sp) => { dyn.ph(v); v.ph.vx = sp; v.ph.gear = Math.min(params(v.model).gears, 1 + Math.floor(sp / 9)); };
// largest sideslip at a real speed (above 8 m/s: in a tight turn at walking pace the body's angle to its path is geometry)
function drive(dyn, v, secs, f, assists) {
  let worst = 0;
  for (let t = 0; t < secs; t += 1 / 60) { dyn.drive(v, 1 / 60, { ...f(t), assists }); if (v.sp > 8) worst = Math.max(worst, Math.abs(slip(v))); }
  return worst * 180 / Math.PI;
}
const CASES = {
  'flooring it out of a junction': (dyn, v, a) => drive(dyn, v, 4, t => ({ throttle: 1, steer: t > 0.6 ? 1 : 0 }), a),
  'full throttle and full lock at 50 km/h': (dyn, v, a) => { at(dyn, v, 14); return drive(dyn, v, 3, () => ({ throttle: 1, steer: 1 }), a); },
  'a swerve at 100 km/h': (dyn, v, a) => { at(dyn, v, 28); return drive(dyn, v, 4, t => ({ throttle: 0.6, steer: t < 0.5 ? 1 : t < 1.1 ? -1 : t < 1.5 ? 0.5 : 0 }), a); },
  'full lock at 80 km/h on the throttle': (dyn, v, a) => { at(dyn, v, 22); return drive(dyn, v, 3, () => ({ throttle: 1, steer: 1 }), a); },
  'lifting off mid-corner at 70 km/h': (dyn, v, a) => { at(dyn, v, 19); return drive(dyn, v, 3, t => ({ throttle: t < 1 ? 0.8 : 0, steer: 0.8 }), a); },
  'braking hard while turning at 90 km/h': (dyn, v, a) => { at(dyn, v, 25); return drive(dyn, v, 3, () => ({ throttle: 0, brake: 1, steer: 0.8 }), a); },
};
const MODELS_TRIED = ['rangerover', 'sports', 'coupe', 'hothatch', 'police', 'suv', 'hatch', 'saloon', 'van'];

test('Easy (the default): no car spins, dry or wet, whatever the player does', () => {
  for (const wet of [0, 1]) for (const m of MODELS_TRIED) for (const [name, f] of Object.entries(CASES)) {
    const worst = f(world(wet), car(m), 1);
    assert.ok(worst < 16, `${m} ${wet ? 'wet' : 'dry'}, ${name}: slid ${worst.toFixed(0)} degrees`);
  }
});

test('Realistic: more slide is allowed, but braking in a turn or lifting off never spins it', () => {
  let more = 0;
  for (const wet of [0, 1]) for (const m of MODELS_TRIED) for (const [name, f] of Object.entries(CASES)) {
    const worst = f(world(wet), car(m), 0);
    assert.ok(worst < 35, `${m} ${wet ? 'wet' : 'dry'}, ${name}: slid ${worst.toFixed(0)} degrees`);
    if (worst > f(world(wet), car(m), 1) + 1) more++;
  }
  assert.ok(more > 10, `Realistic lets the cars move around more (${more} cases)`);
});

test('steering at speed turns the car: the Range Rover pulls most of a g at full lock and keeps its speed', () => {
  for (const [m, kmh, g] of [['rangerover', 100, 0.8], ['rangerover', 60, 0.8], ['hatch', 100, 0.85], ['sports', 100, 1.05]]) {
    const dyn = world(), v = car(m), sp = kmh / 3.6; at(dyn, v, sp);
    let w = 0;
    for (let i = 0; i < 180; i++) { dyn.drive(v, 1 / 60, { throttle: v.sp < sp ? 0.5 : 0.1, steer: 1, assists: 1 }); if (i >= 120) w += Math.abs(v.ph.w) / 60; }
    const lat = v.sp * w / 9.81;
    assert.ok(lat > g, `${m} at ${kmh} km/h: ${lat.toFixed(2)} g`);
    assert.ok(v.sp > sp * 0.85, `${m} kept its speed (${(v.sp * 3.6).toFixed(0)} km/h)`);
  }
});

test('the handbrake still swings the tail round with the assists on', () => {
  const dyn = world(), v = car('hatch'); at(dyn, v, 15);
  for (let t = 0; t < 1.6; t += 1 / 60) dyn.drive(v, 1 / 60, { throttle: 0, steer: 1, handbrake: t < 1.2, assists: 1 });
  assert.ok(Math.abs(v.heading) > 1.4, `handbrake turn ${v.heading.toFixed(2)} rad`);
});
