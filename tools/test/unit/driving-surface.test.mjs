import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceIndex,sampleSurfaces,chooseSurface,terrainMeshHeight,wheelPose } from '../../../src/drivingSurface.js';
test('collision reads the actual sloped road triangle',()=>{
  const index=buildSurfaceIndex({ground:{position:[0,1,0,8,9,0,0,1,8],extra:[0,0,0]}});
  const ys=[];sampleSurfaces(index,2,2,ys);assert.deepEqual(ys,[3]);
});
test('a raised kerb takes priority over the nearby terrain',()=>{
  assert.equal(chooseSurface(0,[0.17],0),0.17);
  assert.equal(chooseSurface(0,[0.17],0.17),0.17);
});
test('upper and lower flyover levels stay separate',()=>{
  assert.equal(chooseSurface(0,[0.05,7.05],0.05),0.05);
  assert.equal(chooseSurface(0,[0.05,7.05],7.05),7.05);
  assert.equal(chooseSurface(8,[1],1),1);
});
test('one raised wheel and a crest cannot be averaged into the ground',()=>{
  const p=wheelPose(0.2,0,0,0,0,1.4,0.8);
  assert.ok(p.y+1.4*Math.tan(p.pitch)+0.8*Math.tan(p.roll)>=0.2-1e-8);
  assert.equal(wheelPose(0,0,0,0,0.3,1.4,0.8).y,0.3);
});
test('real hills keep their measured slope and vehicle pitch',()=>{
  const p=wheelPose(10.28,10.28,9.72,9.72,10,1.4,0.8);
  assert.ok(Math.abs(p.grade-0.2)<1e-8);assert.ok(Math.abs(p.y-10)<1e-8);
});
test('terrain uses the same LOD triangles as the renderer',()=>{
  const mesh={position:[0,0,0,256,8,0,0,0,256,256,8,256]};
  assert.equal(terrainMeshHeight(mesh,128,128),4);
});
