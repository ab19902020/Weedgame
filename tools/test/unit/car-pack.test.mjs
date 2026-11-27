// The supplied cars (vehicles.js models with `pack`, baked by tools/vehicles/bake-car-pack.py and
// bake-real-cars.py): every body faces +x, the way the car drives (the people carrier was once baked back to
// front and went along tail first, in traffic and when you drove it); the wheels go where the bake measured the
// axles; each one drives, sounds and fills up like its fleet twin (`like`); and none spins doing what a touch
// player does, as the fleet's own cars don't (handling.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CarDynamics, params, HANDLING } from '../../../src/carPhysics.js';
import { MODELS } from '../../../src/vehicles.js';
import { isElectric } from '../../../src/propulsion.js';

const dir = new URL('../../../www/vehicles/', import.meta.url);
// each baked car: the height of its body at the +x end and at the -x end (the last 12% of its length)
function bodies(set) {
  const J = JSON.parse(readFileSync(new URL(set + '.json', dir), 'utf8')), b = readFileSync(new URL(set + '.bin', dir));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), pos = new Float32Array(ab, J.layout.position.offset, J.vertices * 3);
  return J.cars.map(c => {
    let x0 = Infinity, x1 = -Infinity;
    for (let v = c.vStart; v < c.vStart + c.vCount; v++) { x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); }
    const end = 0.12 * (x1 - x0); let front = 0, rear = 0;
    for (let v = c.vStart; v < c.vStart + c.vCount; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1];
      if (x > x1 - end) front = Math.max(front, y); if (x < x0 + end) rear = Math.max(rear, y);
    }
    return { ...c, front, rear };
  });
}
const SETS = ['carpack', 'realcars'];

test('every supplied car faces the way it drives: the bonnet (+x) end is not the tall end', () => {
  for (const set of SETS) for (const c of bodies(set)) {
    assert.ok(c.front - c.rear < 0.25, `${set} ${c.name}: +x end ${c.front.toFixed(2)} m tall, -x end ${c.rear.toFixed(2)} m: back to front`);
  }
});

test('the game puts the wheels where the bake measured the axles', () => {
  for (const set of SETS) for (const c of bodies(set)) {
    const d = MODELS[c.name]; assert.ok(d?.pack, `${c.name} is a model`);
    for (const k of ['wb', 'wx', 'track', 'L']) assert.ok(Math.abs(d[k] - c[k]) < 0.02, `${c.name} ${k}: game ${d[k]}, baked ${c[k]}`);
  }
});

test('each new car drives, sounds and fills up like its fleet twin', () => {
  const pack = Object.keys(MODELS).filter(k => MODELS[k].pack);
  assert.ok(pack.length >= 14);
  for (const k of pack) {
    const d = MODELS[k], h = HANDLING[d.like];
    assert.ok(h && !MODELS[d.like]?.pack, `${k}: like '${d.like}' is a fleet car with handling`);
    const p = params(k); assert.equal(p.kw, h.kw, `${k} power`); assert.equal(p.drive, h.drive, `${k} driven wheels`);
  }
  assert.ok(isElectric('mercedeseqc'), 'the EQC is electric');
});

// what a touch player does (as handling.test.mjs)
const world = (wet = 0) => new CarDynamics({ world: { s: { wet }, cur: { rain: 0 }, day: 1 }, events: { emit: () => {} },
  tiles: { landcover: () => 1, ground: () => 0, tileAt: () => null, buildingsNear() {} }, traffic: { list: [] } });
const car = m => ({ id: m, model: m, def: MODELS[m], x: 0, y: 0, z: 0, heading: 0, sp: 0, v: 0, player: true });
const slip = v => { const fx = Math.cos(v.heading), fz = Math.sin(v.heading), u = v.ph.vx * fx + v.ph.vz * fz, vl = -v.ph.vx * fz + v.ph.vz * fx; return Math.atan2(vl, Math.max(0.5, Math.abs(u))); };
const at = (dyn, v, sp) => { dyn.ph(v); v.ph.vx = sp; v.ph.gear = Math.min(params(v.model).gears, 1 + Math.floor(sp / 9)); };
function drive(dyn, v, secs, f, assists) {
  let worst = 0;
  for (let t = 0; t < secs; t += 1 / 60) { dyn.drive(v, 1 / 60, { ...f(t), assists }); if (v.sp > 8) worst = Math.max(worst, Math.abs(slip(v))); }
  return worst * 180 / Math.PI;
}
const CASES = {
  'flooring it out of a junction': (dyn, v, a) => drive(dyn, v, 4, t => ({ throttle: 1, steer: t > 0.6 ? 1 : 0 }), a),
  'a swerve at 100 km/h': (dyn, v, a) => { at(dyn, v, 28); return drive(dyn, v, 4, t => ({ throttle: 0.6, steer: t < 0.5 ? 1 : t < 1.1 ? -1 : t < 1.5 ? 0.5 : 0 }), a); },
  'full lock at 80 km/h on the throttle': (dyn, v, a) => { at(dyn, v, 22); return drive(dyn, v, 3, () => ({ throttle: 1, steer: 1 }), a); },
  'braking hard while turning at 90 km/h': (dyn, v, a) => { at(dyn, v, 25); return drive(dyn, v, 3, () => ({ throttle: 0, brake: 1, steer: 0.8 }), a); },
};

test('the new cars drive forwards and never spin on Easy, dry or wet', () => {
  for (const m of Object.keys(MODELS).filter(k => MODELS[k].pack)) {
    // the accelerator takes it forwards, to 50 km/h in a sensible time
    const dyn = world(), v = car(m); let t = 0;
    while (v.sp < 13.9 && t < 12) { dyn.drive(v, 1 / 60, { throttle: 1, steer: 0, assists: 1 }); t += 1 / 60; }
    const u = v.ph.vx * Math.cos(v.heading) + v.ph.vz * Math.sin(v.heading);
    assert.ok(u > 13 && t < 6, `${m}: ${u.toFixed(1)} m/s forwards after ${t.toFixed(1)} s`);
    for (const wet of [0, 1]) for (const [name, f] of Object.entries(CASES)) {
      const worst = f(world(wet), car(m), 1);
      assert.ok(worst < 16, `${m} ${wet ? 'wet' : 'dry'}, ${name}: slid ${worst.toFixed(0)} degrees`);
    }
  }
});
