// The drone's cloud layer (src/droneSky.js): the in-cloud test and the deck you see come from one noise field, the
// share of the sky it covers follows the weather's cloud cover, and the layer's heights follow the weather's cloud
// base above the drone's home.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { DroneSky } from '../../../src/droneSky.js';

function sky(cover, base = 1100, thick = 1600) {
  const U = { cloudBase: { value: base }, cloudThick: { value: thick } };
  const G = { scene: new THREE.Scene(), U, world: { s: { cloudOff: [1234, -567] }, cur: { cover } }, drone: { home: new THREE.Vector3(0, 50, 0) } };
  return new DroneSky(G);
}
const share = S => { let n = 0, k = 0; for (let x = -40000; x < 40000; x += 397) for (let z = -40000; z < 40000; z += 401) { n += S.cloudAt(x, z) > 0.5; k++; } return n / k; };

test('the cloud field is steady, between 0 and 1, and the same at the same spot', () => {
  const S = sky(0.5);
  for (let i = 0; i < 200; i++) { const x = i * 731 - 70000, z = i * -517 + 30000, c = S.cloudAt(x, z); assert.ok(c >= 0 && c <= 1); assert.equal(c, S.cloudAt(x, z)); }
});
test('more cloud cover, more of the sky in cloud', () => {
  const a = share(sky(0.15)), b = share(sky(0.5)), c = share(sky(0.94));
  assert.ok(a < b && b < c, `${a} ${b} ${c}`);
  assert.ok(a < 0.12, 'clear: few clouds ' + a);
  assert.ok(c > 0.85, 'overcast: nearly all cloud ' + c);
});
test('the layer sits at the weather\'s cloud base above home, with the deck inside it', () => {
  const L = sky(0.5, 750, 1100).layer();
  assert.equal(L.base, 800); assert.equal(L.top, 1900);
  assert.ok(L.deck > L.base && L.deck < L.top);
});
