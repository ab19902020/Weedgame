import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCrowdMember, People, CITIZENS } from '../../../src/humans.js';

function instance(actor) {
  const set = {};
  for (const name of ['iPos','iAnim','iCol','iSty','iExt','iR1','iR2','iR3']) set[name] = {array:new Float32Array(4)};
  writeCrowdMember(set,0,actor);
  return set;
}

test('boarding keeps face, outfit and accessory bits while selecting the seated pose', () => {
  const look = {skin:0x8d5a3b,top:0x6b2737,legs:0x22252b,hair:0x2a1d14,
    style:2,face:3,female:true,h:1.02,build:.4,cap:false,hood:true,bag:true,shoe:3,umbIdx:4,outfit:2};
  const walking = instance({x:1,y:2,z:3,pose:'walk',look});
  const seated = instance({x:4,y:.7,z:1,pose:'seated',look});
  assert.deepEqual(walking.iCol.array,seated.iCol.array);
  assert.deepEqual(walking.iSty.array,seated.iSty.array);
  assert.equal(seated.iAnim.array[2],9);
  const bits = seated.iSty.array[1];
  assert.equal(bits>>11,2);
  assert.equal((bits>>8)&7,4);
  assert.equal((bits>>6)&3,3);
});

test('old residents use the default jacket and uniforms keep their reflective finish', () => {
  const actor = {x:0,y:0,z:0,look:{top:0x444444}};
  assert.equal(instance(actor).iSty.array[1]>>11,0);
  actor.hiVis = true;
  actor.look.outfit = 3;
  const flags = instance(actor).iSty.array[1];
  assert.equal(flags>>11,0);
  assert.ok(flags&8);
});

test('a shot reaction reaches the crowd shader: kneeling on the hit leg, then the fall the way the blow sent them', () => {
  const look = {top:0x444444};
  // facing +x, shot in the right leg from in front (the blow travels -x): kneels on that leg
  const knee = instance({x:0,y:0,z:0,heading:0,look,react:{type:'shotKnee',t:0.4,dir:Math.PI,side:1,lie:1.2}});
  assert.ok(knee.iR3.array[1] < -0.5, 'right knee down (negative = the right leg)');
  assert.ok(knee.iExt.array[3] > 0.3, 'body lowered onto the knee');
  assert.equal(knee.iAnim.array[2], 0, 'no other pose on top of the reaction');
  // killed by a shot from in front: falls backwards (along the blow) and lies there
  const dead = instance({x:0,y:0,z:0,heading:0,look,react:{type:'shot',t:3,dir:Math.PI,dead:true,back:1}});
  assert.ok(dead.iR3.array[2] > 0.95, 'flat on the ground');
  assert.ok(Math.abs(Math.abs(dead.iR3.array[3]) - Math.PI) < 1e-6, 'fell backwards');
  // knocked down by a car (no reaction record): onto the back as before
  const hit = instance({x:0,y:0,z:0,heading:1,look,fall:0.6,pose:'brace',brace:1});
  assert.ok(Math.abs(hit.iR3.array[2] - 0.6) < 1e-6 && Math.abs(hit.iR3.array[3] - Math.PI) < 1e-6);   // (float32)
});

test('hands that are busy drop the carrier bag, and police on duty wear only the uniform', () => {
  const look = {top:0x444444, carrier:true, glasses:true, beanie:true, backpack:true};
  const walking = instance({x:0,y:0,z:0,pose:'walk',look}).iExt.array[0];
  assert.ok(walking & 8 && walking & 1 && walking & 2 && walking & 4);
  const umbrella = instance({x:0,y:0,z:0,pose:'umbrella',look}).iExt.array[0];
  assert.equal(umbrella & 8, 0);
  const officer = instance({x:0,y:0,z:0,pose:'walk',look,hiVis:true}).iExt.array[0];
  assert.equal(officer, 1, 'glasses only');
});

test('people on the street are mostly the supplied citizens, each of the right sex, and staff never are', () => {
  let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let citizens = 0;
  for (let k = 0; k < 400; k++) {
    const L = People.randomLook(r);
    if (L.citizen != null) { citizens++; assert.equal(!!CITIZENS[L.citizen].f, L.female); assert.ok(L.h > 0.85 && L.h < 1.1); }
  }
  assert.ok(citizens > 280 && citizens < 360, `about four in five (${citizens}/400)`);
  for (let k = 0; k < 100; k++) assert.equal(People.randomLook(r, { work: true }).citizen, null);
});
