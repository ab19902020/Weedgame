import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.self = { postMessage() {} };
const { supportIntersects } = await import('../../../src/tileWorker.js');
const road = [-20, 0, 0, 20, 0, 0, 3];
test('support edge in a lane is rejected even with its centre outside', () => {
  assert.equal(supportIntersects(road,0,0,3.6,1,0,1,0.65,-1,6),true);
  assert.equal(supportIntersects(road,0,0,4.5,1,0,1,0.65,-1,6),false);
});
test('supports do not obstruct the road on top of their own deck', () => {
  const upper = [-20, 8, 0, 20, 8, 0, 3];
  assert.equal(supportIntersects(upper,0,0,0,1,0,1,0.5,-1,6.8),false);
  assert.equal(supportIntersects(road,0,0,0,1,0,1,0.5,-1,6.8),true);
});
test('angled support and sloping lower road are checked over their entire footprint', () => {
  const slope = [-20,-3,0,20,3,0,3], d = Math.SQRT1_2;
  assert.equal(supportIntersects(slope,0,0,4,d,d,2,0.7,-1,6),true);
  assert.equal(supportIntersects(slope,0,0,12,d,d,2,0.7,-1,6),false);
});
test('a genuinely buried tunnel does not block a surface support above its clearance envelope', () => {
  const tunnel = [-20,-10,0,20,-10,0,3];
  assert.equal(supportIntersects(tunnel,0,0,0,1,0,1,0.5,-1,6),false);
});
