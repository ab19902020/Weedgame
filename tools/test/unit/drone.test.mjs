// The Kestrel T3's flight model (src/drone.js) on a made-up world: flat ground at 40 m, one building, a tree, a lake.
// It hovers, holds position against the wind, reaches each mode's speed, turns, climbs into the clouds, lands on a
// roof, crashes into a wall and recovers, flips itself over, flies home and lands beside the pilot, and in MANUAL
// mode does a full flip on the sticks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Drone } from '../../../src/drone.js';

const GROUND = 40;
// a 20 x 20 m building, 12 m tall, with its near wall 40 m north of the start (z = -40 .. -60)
const BLD = new Float32Array([-10, -40, 10, -40, 10, -60, -10, -60]);
function world(opts = {}) {
  const brother = { short: 'Cal', x: 0, y: GROUND, z: 0, heading: Math.PI, items: {} };   // facing west, away from the building
  const G = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1.6, 0.4, 3000), time: 0,
    world: { wind: opts.wind || [0, 0] },
    brothers: { me: brother, b: [brother], active: 0, actor: [{}], vehicleOf: () => null },
    traffic: { list: [] }, peds: { list: [] },
    hud: { toast: () => {} }, interiors: { at: () => null },
    tiles: {
      ground: (x, z) => (x > 150 && x < 250 && z > -50 && z < 50 ? GROUND - 3 : GROUND), terrain: (x, z) => (x > 150 && x < 250 && z > -50 && z < 50 ? GROUND - 3 : GROUND),
      waterLevel: (x, z) => (x > 150 && x < 250 && z > -50 && z < 50 ? GROUND - 0.5 : null),
      buildingsNear: (x, z, r, cb) => { if (x > -10 - r && x < 10 + r && z > -60 - r && z < -40 + r) cb(BLD, 0, 4, GROUND + 12, GROUND); },
      insideBuilding: () => null, tileAt: () => ({ ix: 0, iz: 0 }),
      byNum: new Map([[0 * 100003 + 0, { trees: [[30, 0, 12]] }]]),
    },
  };
  const d = new Drone(G); d.give(brother);
  return { G, d, brother };
}
// run the drone for t seconds at 60 fps with the given sticks (lx yaw, ly throttle, rx roll, ry pitch)
function fly(d, t, sticks = {}, gimbal = 0) { for (let i = 0; i < t * 60; i++) d.update(1 / 60, { sticks: { lx: 0, ly: 0, rx: 0, ry: 0, ...sticks }, gimbal }); }

test('deploys in front of the brother and takes off to a hover', () => {
  const { d } = world();
  assert.ok(d.deploy());
  assert.equal(d.state, 'landed');
  assert.ok(Math.abs(d.p.y - (GROUND + 0.09)) < 0.01);
  d.takeoff(); fly(d, 4);
  assert.equal(d.state, 'flying');
  const y = d.p.y; fly(d, 4);
  assert.ok(d.p.y - GROUND > 1, 'off the ground: ' + (d.p.y - GROUND).toFixed(2));
  assert.ok(Math.abs(d.p.y - y) < 0.3, 'holds its height: ' + (d.p.y - y).toFixed(2));
  assert.ok(d.speed < 0.2, 'holds its position');
});

test('holds position against a 7 m/s wind (GPS hold)', () => {
  const { d } = world({ wind: [7, 0] });
  d.deploy(); d.takeoff(); fly(d, 2, { ly: 1 }); fly(d, 3);
  const x0 = d.p.x; fly(d, 10);
  assert.ok(Math.abs(d.p.x - x0) < 2.5, 'drift over 10 s: ' + (d.p.x - x0).toFixed(2) + ' m');
});

test('each mode reaches its speed, and centred sticks brake to a stop', () => {
  for (const [mode, want] of [['CINE', 5], ['NORMAL', 12], ['SPORT', 19]]) {
    const { d } = world(); d.mode = mode; d.deploy(); d.takeoff(); fly(d, 3, { ly: 1 });
    // (facing west at the start: fly away from the building)
    fly(d, 12, { ry: 1 });
    assert.ok(d.speed > want * 0.85 && d.speed < want * 1.15, `${mode} ${d.speed.toFixed(1)} m/s, want ${want}`);
    fly(d, 6);
    assert.ok(d.speed < 0.6, `${mode} brakes: ${d.speed.toFixed(2)} m/s`);
  }
});

test('turns on the yaw stick and strafes on the roll stick', () => {
  const { d } = world(); d.deploy(); d.takeoff(); fly(d, 3, { ly: 1 });
  // steady turn rate once the stick is held (the stick shaping eases it in over the first moments)
  fly(d, 1, { lx: 1 }); const y0 = d.yaw; fly(d, 1, { lx: 1 });
  const turned = Math.atan2(Math.sin(d.yaw - y0), Math.cos(d.yaw - y0)) / Math.PI * 180;
  assert.ok(turned < -82 && turned > -108, 'yaw right at 95 deg/s: ' + turned.toFixed(0));
  fly(d, 1.5);
  const r = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw), p0 = d.p.clone();
  fly(d, 4, { rx: 1 });
  const moved = d.p.clone().sub(p0);
  assert.ok(moved.dot(r) > 20, 'strafed right: ' + moved.dot(r).toFixed(1));
});

test('climbs up into the clouds (2 km) and is limited at the ceiling', () => {
  const { d } = world(); d.mode = 'SPORT'; d.deploy(); d.takeoff();
  fly(d, 320, { ly: 1 });
  assert.ok(d.p.y - GROUND > 2000, 'climbed to ' + (d.p.y - GROUND).toFixed(0) + ' m');
  assert.ok(d.p.y - d.home.y <= 3600 + 5, 'ceiling held');
});

test('flies into a wall at speed: crash, then recovers and flies again', () => {
  const { d } = world(); d.mode = 'SPORT'; d.deploy();
  // face north (towards the building), 5 m up
  d.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0); d.yawWant = 0;
  d.takeoff(); fly(d, 1.5);
  fly(d, 8, { ry: 1 });
  assert.equal(d.state, 'crashed', 'state ' + d.state + ' at ' + d.p.toArray().map(v => v.toFixed(1)));
  assert.ok(d.p.z > -40.5, 'stopped at the wall, z=' + d.p.z.toFixed(2));
  fly(d, 4);
  d.recover(); fly(d, 3);
  assert.ok(d.state === 'flying' || d.state === 'landed', 'back in the air or on its feet: ' + d.state);
});

test('lands on a roof', () => {
  const { d } = world(); d.deploy();
  d.p.set(0, GROUND + 20, -50); d.home.y = GROUND; d.takeoff(); d.autoTO = 0; d.state = 'flying'; d.armed = true;
  fly(d, 12, { ly: -1 });
  assert.equal(d.state, 'landed', 'state ' + d.state);
  assert.ok(Math.abs(d.p.y - (GROUND + 12 + 0.24)) < 0.15, 'on the roof at ' + (d.p.y - GROUND).toFixed(2));
});

test('turtle mode flips it back over', () => {
  const { d } = world(); d.deploy();
  d.state = 'crashed'; d.broken = false; d.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); d.p.y = GROUND + 0.24;
  d.recover(); fly(d, 2);
  assert.ok(d.up.y > 0.8, 'upright: up.y=' + d.up.y.toFixed(2));
});

test('returns home and lands beside the pilot', () => {
  const { d, brother } = world(); d.mode = 'SPORT'; d.deploy(); d.takeoff(); fly(d, 3, { ly: 1 });
  fly(d, 10, { ry: 1 });
  assert.ok(d.dist > 100, 'away: ' + d.dist.toFixed(0) + ' m');
  d.toggleRTH(); fly(d, 60);
  assert.equal(d.state, 'landed', 'state ' + d.state);
  assert.ok(Math.hypot(d.p.x - brother.x, d.p.z - brother.z) < 4, 'beside the pilot: ' + Math.hypot(d.p.x - brother.x, d.p.z - brother.z).toFixed(1) + ' m');
});

test('MANUAL (acro): a full flip on the pitch stick, and it keeps no level', () => {
  const { d } = world(); d.mode = 'NORMAL'; d.deploy(); d.takeoff(); fly(d, 6, { ly: 1 });
  d.mode = 'MANUAL';
  // punch up, then a back flip: full pitch back for about half a second at ~700 deg/s
  fly(d, 0.6, { ly: 0.9 });
  let minUp = 1; for (let i = 0; i < 36; i++) { d.update(1 / 60, { sticks: { lx: 0, ly: 0.5, rx: 0, ry: -1 } }); minUp = Math.min(minUp, d.up.y); }
  assert.ok(minUp < -0.7, 'went upside down: min up.y ' + minUp.toFixed(2));
  // hands off at hover throttle: it does not level itself
  fly(d, 0.3, { ly: 0 });
  assert.ok(d.state === 'flying' || d.state === 'crashed');
});

test('a battery lasts about half an hour hovering', () => {
  const { d } = world(); d.deploy(); d.takeoff(); fly(d, 3, { ly: 0.5 });
  const b0 = d.battery; fly(d, 60);
  const perMin = b0 - d.battery;
  assert.ok(perMin > 1 / 40 && perMin < 1 / 24, 'minutes of hover: ' + (1 / perMin).toFixed(1));
});

test('into the lake: it ditches', () => {
  const { d } = world(); d.mode = 'SPORT'; d.deploy();
  d.p.set(160, GROUND + 3, 0); d.takeoff(); d.autoTO = 0; d.state = 'flying'; d.armed = true;
  fly(d, 4, { ly: -1 });
  assert.equal(d.state, 'ditched');
});
