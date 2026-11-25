import assert from 'node:assert/strict';
import test from 'node:test';
import { Peds } from '../../../src/peds.js';
import { WildSim } from '../../../src/wildlifeSim.js';
import { makeWorld } from './wildworld.mjs';

function reaction(speed, fps, blocked = false) {
  const peds = new Peds({net:{}, events:{on(){}}, tiles:{insideBuilding:()=>blocked, ground:()=>0}});
  const actor = {x:0,y:0,z:0};
  peds.strike(actor,0,speed);
  let peak = 0, brace = 0;
  while (actor.impact) {
    peds.updateImpact(actor,1/fps);
    peak = Math.max(peak,actor.fall);
    brace = Math.max(brace,actor.brace);
  }
  assert.equal(actor.brace,0);
  assert.equal(actor.fall,0);
  return {peak,brace,x:actor.x};
}
test('a strike staggers, a fast vehicle knocks down and both recover', () => {
  const light = reaction(0,60), fast = reaction(12,60);
  assert.equal(light.peak,0);
  assert.ok(light.brace>.9 && light.x>0);
  assert.equal(fast.peak,1);
  assert.ok(fast.x>light.x);
  assert.ok(Math.abs(fast.x-reaction(12,30).x)<.001);
  assert.equal(reaction(12,30,true).x,0);
});

test('eligible dog owners first encountered on camera can acquire a dog off camera', () => {
  const {W,state} = makeWorld();
  state.peds = Array.from({length:32}, (_,i)=>({id:'p'+i, mode:'walk', x:12+i*.3,y:40,z:0}));
  let visible = true; W.visible = ()=>visible;
  const sim = new WildSim(W,{max:24});
  sim.clockH=8;
  sim.dogWalkers(state.focus);
  assert.equal(sim.list.length,0);
  visible=false;
  sim.dogWalkers(state.focus);
  assert.ok(sim.list.some(a=>a.owner && state.peds.includes(a.owner)));
  assert.ok(sim.list.length<=24);
});
