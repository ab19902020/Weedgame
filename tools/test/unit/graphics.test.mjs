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

test('render scale can recover on vsync and 30 FPS can return to 60', () => {
  const state = {fps:60,quiet:0};
  const tune = (ms,scale) => tuneGraphics(state,ms,60,scale,.5,1,.06);
  assert.equal(tune(28,.8),.74);
  tune(28,.5);
  assert.equal(state.fps,30);
  for (let i=0;i<6;i++) tune(33.34,.5);
  assert.equal(state.fps,60);
  tune(16.67,.5);
  assert.equal(tune(16.67,.5),.53);
});
