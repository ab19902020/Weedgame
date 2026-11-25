import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCrowdMember } from '../../../src/humans.js';

function instance(actor) {
  const set = {};
  for (const name of ['iPos','iAnim','iCol','iSty']) set[name] = {array:new Float32Array(4)};
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
