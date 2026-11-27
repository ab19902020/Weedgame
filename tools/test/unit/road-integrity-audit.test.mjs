import test from 'node:test';
import assert from 'node:assert/strict';
import { heightInTriangle,RoadSurfaceAudit } from '../roadSurfaceAudit.mjs';
test('interpolates the actual surface height, not the terrain',()=>{
  assert.equal(heightInTriangle(2,2,[0,0,0,8,8,0,0,0,8],0),2);
  assert.equal(heightInTriangle(7,7,[0,0,0,8,8,0,0,0,8],0),null);
});
test('road samples can be matched to a bridge emitted by a neighbouring tile',()=>{
  const net={nEdges:1,flags:[20],pts:[252,10,8,260,10,8],pstart:[0],pcount:[2],width:[4],ea:[0],eb:[1],names:['A329'],ref:[0],roadName:()=> 'IDR'};
  const audit=new RoadSurfaceAudit(net,['0_0','1_0']);
  assert.equal(audit.report().totals.noSurface,3);
  audit.consume({ox:0,oz:0,ground:{position:[251,10.045,5,261,10.045,5,261,10.045,11,251,10.045,5,261,10.045,11,251,10.045,11],extra:[5,5,5,5,5,5]}});
  assert.equal(audit.report().totals.noSurface,0);
  assert.equal(audit.report().totals.heightMismatch,0);
});
