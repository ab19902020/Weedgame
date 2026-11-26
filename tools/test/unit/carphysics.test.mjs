// Vehicle dynamics and collisions (src/carPhysics.js) on a flat test pad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CarDynamics, params } from '../../../src/carPhysics.js';
import { MODELS } from '../../../src/vehicles.js';

function world({ wet = 0, buildings = [], cars = [] } = {}) {
  const events = [];
  const G = {
    world: { s: { wet }, cur: { rain: 0 }, day: 1 },
    events: { emit: (k, e) => events.push([k, e]) },
    tiles: {
      landcover: () => 1, ground: () => 0, tileAt: () => null,
      // buildings: closed rings [[x,z],...]; walls: two-point rings
      buildingsNear(x, z, r, cb) { for (const b of buildings) { const P = new Float32Array(b.flat()); cb(P, 0, b.length, 10, -1); } },
    },
    traffic: { list: cars },
  };
  return { G, events, dyn: new CarDynamics(G) };
}
const car = (model, x = 0, z = 0, heading = 0, extra = {}) => ({ id: model + x, model, def: MODELS[model], x, y: 0, z, heading, sp: 0, v: 0, ...extra });
function run(dyn, v, secs, ctl, dt = 1 / 60, each) { for (let t = 0; t < secs; t += dt) { dyn.drive(v, dt, typeof ctl === 'function' ? ctl(t) : ctl); dyn.update(dt); each && each(t); } }
const speed = v => Math.hypot(v.ph.vx, v.ph.vz);

test('acceleration: 0-60 mph times and top speeds are in a believable range', () => {
  for (const [m, lo, hi, vlo, vhi] of [['hatch', 7.5, 14.5, 44, 53], ['hothatch', 5, 8.5, 60, 72], ['sports', 2.8, 5, 75, 92], ['rangerover', 3.8, 6.5, 62, 70]]) {
    const { dyn } = world(), v = car(m);
    let t60 = null;
    run(dyn, v, 60, { throttle: 1, steer: 0 }, 1 / 60, t => { if (t60 == null && v.sp >= 26.8) t60 = t; });
    assert.ok(t60 != null && t60 > lo && t60 < hi, `${m} 0-60 in ${t60?.toFixed(1)} s`);
    assert.ok(v.sp > vlo && v.sp < vhi, `${m} top speed ${v.sp.toFixed(1)} m/s`);
    assert.ok(Math.abs(v.z) < 0.5 && Math.abs(v.heading) < 0.01, `${m} runs straight`);
    assert.ok(v.gear >= params(m).gears - 1, `${m} reached top gears (${v.gear})`);
  }
});

test('braking: about 45 m from 30 m/s on dry tarmac, further in the wet', () => {
  const dist = wet => {
    const { dyn } = world({ wet }), v = car('saloon');
    run(dyn, v, 30, { throttle: 1, steer: 0 }, 1 / 60, null);
    // hold 30 m/s exactly, then brake
    v.ph.vx = 30; v.ph.vz = 0; v.heading = 0; v.x = 0; v.z = 0;
    run(dyn, v, 8, () => ({ throttle: v.sp > 0.3 ? -1 : 0, steer: 0 }));
    return v.x;
  };
  const dry = dist(0), wetD = dist(1);
  assert.ok(dry > 38 && dry < 58, `dry ${dry.toFixed(1)} m`);
  assert.ok(wetD > dry * 1.15, `wet ${wetD.toFixed(1)} m`);
});

test('cornering: steady turn holds the road; a handbrake turn swings the tail round', () => {
  const { dyn } = world(), v = car('hatch');
  v.ph = null; dyn.ph(v); v.ph.vx = 15;
  let maxLat = 0;
  run(dyn, v, 4, { throttle: 0.3, steer: 0.5 }, 1 / 60, () => { maxLat = Math.max(maxLat, Math.abs(v.ph.ay)); });
  assert.ok(Math.abs(v.heading) > 1, `turned ${v.heading.toFixed(2)} rad`);
  assert.ok(maxLat < 1.05 * 9.81 * 1.05, `lateral ${maxLat.toFixed(2)} m/s²`);
  const beta = Math.atan2(-Math.sin(v.heading) * v.ph.vx + Math.cos(v.heading) * v.ph.vz, Math.abs(v.sp));
  assert.ok(Math.abs(beta) < 0.25, `no spin (slip ${beta.toFixed(2)})`);
  // handbrake turn from 15 m/s
  const w2 = world(), c2 = car('hatch'); w2.dyn.ph(c2); c2.ph.vx = 15;
  run(w2.dyn, c2, 1.6, t => ({ throttle: 0, steer: 1, handbrake: t < 1.2 }));
  assert.ok(Math.abs(c2.heading) > 1.4, `handbrake turn ${c2.heading.toFixed(2)} rad`);
});

test('reverse gear', () => {
  const { dyn } = world(), v = car('hatch');
  run(dyn, v, 6, { throttle: -1, steer: 0 });
  assert.ok(v.sp < -4 && v.sp > -9.5, `reverse ${v.sp.toFixed(1)} m/s`);
  assert.equal(v.gear, -1);
});

test('head-on into a wall: stops dead with little rebound and a crumpled front', () => {
  const wall = [[20, -20], [30, -20], [30, 20], [20, 20]];
  const { dyn } = world({ buildings: [wall] }), v = car('hatch');
  dyn.ph(v); v.ph.vx = 20;
  let minX = 1e9;
  run(dyn, v, 3, { throttle: 0, steer: 0 }, 1 / 60, () => { minX = Math.min(minX, 20 - (v.x + 2.025)); });
  assert.ok(v.x + 2.025 <= 20.6, `stayed outside (${(v.x + 2.025).toFixed(2)})`);
  assert.ok(v.sp > -4.5 && v.sp < 1, `rebound ${v.sp.toFixed(1)} m/s`);
  assert.ok(v.dmg[0] > 0.3, `front damage ${v.dmg[0].toFixed(2)}`);
  assert.ok(v.dmg[1] < 0.05, 'rear untouched');
});

test('glancing blow: scrapes along the wall and keeps going', () => {
  const wall = [[-50, 6], [200, 6], [200, 30], [-50, 30]];
  const { dyn } = world({ buildings: [wall] }), v = car('saloon', 0, 0, 0.35);
  dyn.ph(v); v.ph.vx = Math.cos(0.35) * 22; v.ph.vz = Math.sin(0.35) * 22;
  run(dyn, v, 2, { throttle: 0, steer: 0 });
  assert.ok(v.z + 0.9 < 6.5, 'stayed out of the building');
  assert.ok(speed(v) > 12, `kept speed ${speed(v).toFixed(1)} m/s`);
  assert.ok(Math.abs(v.heading) < 0.3, `turned along the wall (${v.heading.toFixed(2)})`);
});

test('car into a parked car: the parked car is shoved and spins, the striker slows', () => {
  const parked = car('hatch', 12, 0.9, Math.PI / 2, { parked: true });
  const { dyn, events } = world({ cars: [] }), v = car('saloon');
  const G = dyn.G; G.traffic.list.push(v, parked);
  dyn.ph(v); v.ph.vx = 16;
  run(dyn, v, 3, { throttle: 0, steer: 0 });
  assert.ok(Math.hypot(parked.x - 12, parked.z - 0.9) > 1.5, `parked car moved ${Math.hypot(parked.x - 12, parked.z - 0.9).toFixed(2)} m`);
  assert.ok(Math.abs(parked.heading - Math.PI / 2) > 0.1, 'and rotated');
  assert.ok(speed(v) < 12, `striker slowed to ${speed(v).toFixed(1)}`);
  assert.ok(events.some(([k]) => k === 'impact'), 'impact event');
  assert.ok(parked.dmg[2] + parked.dmg[3] > 0.05, 'side damage on the parked car');
});

test('thin garden walls stop a car at 40 m/s (no tunnelling)', () => {
  const { dyn } = world({ buildings: [[[15, -10], [15, 10]]] }), v = car('hatch');
  dyn.ph(v); v.ph.vx = 40;
  run(dyn, v, 1.5, { throttle: 0, steer: 0 });
  assert.ok(v.x + 2.025 < 15.4, `front at ${(v.x + 2.025).toFixed(2)}`);
});

test('T-boning moving traffic makes it a crash the police hear about; a light nudge does not', () => {
  const mk = sp => { const o = car('estate', 10, 0, Math.PI / 2, { kind: 'traffic', v: 8 }); const w = world(); w.G.traffic.list.push(o); const v = car('saloon', 10 - 2.3 - 0.95 - sp * 0.05, 0); w.G.traffic.list.push(v); w.dyn.ph(v); v.ph.vx = sp; return { ...w, o, v }; };
  const hard = mk(14);
  run(hard.dyn, hard.v, 0.6, { throttle: 0, steer: 0 });
  assert.ok(hard.o.crashed, 'struck car crashed');
  assert.ok(hard.events.some(([k]) => k === 'vehicleHit'), 'vehicleHit for the police');
  const soft = mk(1.2);
  run(soft.dyn, soft.v, 0.6, { throttle: 0, steer: 0 });
  assert.ok(!soft.o.crashed, 'nudge: traffic carries on');
});

test('low-speed manoeuvring is smooth: full lock at walking pace circles without jitter', () => {
  const { dyn } = world(), v = car('hatch');
  let jitter = 0, last = 0;
  run(dyn, v, 8, { throttle: 0.15, steer: 1 }, 1 / 60, () => { const w = v.ph.w; jitter = Math.max(jitter, Math.abs(w - last)); last = w; });
  assert.ok(Math.abs(v.heading) > 2, `turned ${v.heading.toFixed(2)}`);
  assert.ok(jitter < 0.08, `yaw-rate steps ${jitter.toFixed(3)}`);
  const r = Math.abs(v.sp / v.ph.w);
  assert.ok(r > 3.5 && r < 9, `turning circle radius ${r.toFixed(1)} m`);
});

test('both motorcycles accelerate, steer and slow down through the player dynamics', () => {
  for(const model of ['dirtbike','motorcycle']){
    const {dyn}=world(), v=car(model);
    run(dyn,v,4,{throttle:.8,steer:0});
    const initial=v.sp;
    assert.ok(initial>7);
    run(dyn,v,.8,{throttle:.2,steer:.25});
    assert.ok(Math.abs(v.heading)>.04);
    run(dyn,v,2,{brake:1,steer:0});
    assert.ok(Number.isFinite(v.sp) && Math.abs(v.sp)<initial);
  }
});
