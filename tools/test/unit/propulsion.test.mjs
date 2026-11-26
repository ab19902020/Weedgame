import test from 'node:test';
import assert from 'node:assert/strict';
import {energyUsed} from '../../../src/propulsion.js';
import {params} from '../../../src/carPhysics.js';

test('sustained driving preserves at least half a full store after 30 minutes',()=>{
  for(const model of ['hatch','rangerover','motorcycle','evsuv','evsaloon','escooter','ebike']){
    assert.ok(energyUsed(model,1800,75,1)<=.5);
    assert.ok(energyUsed(model,3600,5,.25)<.51);
  }
  assert.equal(energyUsed('bicycle',86400,10,1),0);
  assert.equal(energyUsed('ebike',3600,0,0),0);
});

test('electric and pedal drivetrains have finite single-speed ratios',()=>{
  for(const model of ['bicycle','ebike','escooter','evsaloon','evsuv']){
    assert.equal(params(model).ratios.length,1);
    assert.ok(Number.isFinite(params(model).ratios[0]));
  }
});
