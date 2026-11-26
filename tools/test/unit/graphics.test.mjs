import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityFor, frameTarget, tuneGraphics } from '../../../src/graphics.js';

test('Auto honours the handset mode and manual graphics choices take priority', () => {
  const device = {chip:'SM8750-AB', mode:'standard', hz:120};
  assert.equal(qualityFor('auto',device,true),'high');
  assert.equal(qualityFor('auto',{...device,chip:''},true),'medium');
  device.mode = 'performance';
  assert.equal(frameTarget(device),120);
  device.mode = 'battery';
  assert.equal(qualityFor('auto',device,true),'low');
  assert.equal(qualityFor('high',device,true),'high');
  assert.equal(frameTarget(device,120),30);
});

test('the controller holds 60: resolution drops after two slow windows, never a 30/60 flip-flop, 120 tried once', () => {
  const state = {fps:60,quiet:0};
  const tune = (ms,scale,target=60) => tuneGraphics(state,ms,target,scale,.5,1,.06);
  assert.equal(tune(28,.8),.8, 'one slow window: nothing yet');
  assert.equal(tune(28,.8),.74, 'two in a row: the internal resolution comes down');
  tune(28,.5); tune(28,.5);
  assert.equal(state.fps,60, 'at the lowest resolution it stays a 60 fps target (no drop to 30)');
  for (let i=0;i<3;i++) tune(16.67,.5);
  assert.equal(tune(16.67,.5),.5);
  assert.equal(tune(16.67,.5),.5);
  assert.equal(tune(16.67,.5),.53, 'with headroom the resolution creeps back up');
  // Low on a 120 Hz screen: tries 120 once; if that can't hold, back to 60 for good
  const low = {fps:60,quiet:0};
  for (let i=0;i<6;i++) tuneGraphics(low,16.67,120,1,1,1,.1);
  assert.equal(low.fps,120);
  tuneGraphics(low,11,120,1,1,1,.1);
  assert.equal(low.fps,60);
  for (let i=0;i<20;i++) tuneGraphics(low,16.67,120,1,1,1,.1);
  assert.equal(low.fps,60, 'no second try');
  // High is a 30 fps preset and stays one
  const high = {fps:30,quiet:0};
  for (let i=0;i<10;i++) tuneGraphics(high,33.4,30,.8,.55,1,.06);
  assert.equal(high.fps,30);
});
