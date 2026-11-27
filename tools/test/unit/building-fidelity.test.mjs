import test from 'node:test';
import assert from 'node:assert/strict';
import { frontageScore, buildingStyle, nearestFrontage } from '../../../src/buildingFidelity.js';
test('a house front faces a street rather than the back of an adjacent road',()=>{
  assert.ok(frontageScore(10,1,6,false)<frontageScore(3,-1,6,false));
  assert.ok(frontageScore(20,1,6,false)<frontageScore(2,1,6,true));
});
test('frontage selects road on outward side of the house',()=>{
  const near=nearestFrontage(0,0,0,1,[-10,-2,10,-2,3,-10,9,10,9,3]);
  assert.equal(near.z,9);
});
test('neighbouring terraces share finish but actual tags win',()=>{
  const a={cls:2,wallH:5,roof:1,seed:4,streetX:5,streetZ:6};
  assert.equal(buildingStyle(a).code,buildingStyle({...a,seed:57,streetX:15}).code);
  assert.equal(buildingStyle({...a,tagged:6|(2<<5)}).code,6|(2<<5));
});
