// The ambulance service (src/emergency.js) and police incidents (src/police.js): several people shot in one place are
// one incident, one 999 call; one ambulance comes and its crew sees to them in turn; a second only when three or
// more are waiting, never a third at the same scene; somewhere else is a separate incident with its own ambulance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Police } from '../../../src/police.js';
import { Emergency } from '../../../src/emergency.js';

function world() {
  const G = { scene: new THREE.Scene(), events: { on() {}, emit() {} }, peds: { near: () => [], list: [] }, hud: { feed() {} }, traffic: { list: [] }, net: {} };
  G.police = new Police(G); G.emergency = new Emergency(G);
  // a stand-in for sending a crew: it just books the call
  G.emergency.sendCrew = function (service, x, z, reason, incident) { this.calls.push({ unit: { x, z }, service, incident, stage: 'drive', time: 0, t: 0 }); if (incident) incident.medicalBusy = true; return true; };
  return G;
}
const victim = (x, z, dead = true) => ({ x, z, dead });

test('five shot in one street are one incident with five casualties', () => {
  const G = world(), P = G.police;
  for (let i = 0; i < 5; i++) P.createIncident('fatal', 100 + i * 6, 50, [], { injury: true, patient: victim(100 + i * 6, 50), label: 'Shooting · one dead' });
  assert.equal(P.incidents.length, 1);
  assert.equal(P.incidents[0].patients.length, 5);
  assert.match(P.incidents[0].label, /5 casualties \(5 dead\)/);
  P.createIncident('fatal', 900, 50, [], { injury: true, patient: victim(900, 50), label: 'Shooting · one dead' });
  assert.equal(P.incidents.length, 2, 'somewhere else is its own incident');
});

test('one ambulance for the scene, a second only with three or more waiting, never a third', () => {
  const G = world(), P = G.police, E = G.emergency;
  for (let i = 0; i < 6; i++) P.createIncident('fatal', 100 + i * 5, 50, [], { injury: true, patient: victim(100 + i * 5, 50), label: 'Shooting · one dead' });
  const inc = P.incidents[0]; inc.status = 'reported';
  for (let s = 0; s < 120; s++) E.dispatchInjuries(1);
  const here = E.calls.filter(c => c.incident === inc).length;
  assert.equal(here, 2, 'two ambulances at most: ' + here);
  // a single casualty gets just the one
  const G2 = world(); G2.police.createIncident('casualty', 0, 0, [], { injury: true, medical: true, patient: victim(0, 0, false) });
  G2.police.incidents[0].status = 'reported';
  for (let s = 0; s < 120; s++) G2.emergency.dispatchInjuries(1);
  assert.equal(G2.emergency.calls.length, 1);
});

test('the crew takes the patients one after another (nearest first), and nobody twice', () => {
  const G = world(), P = G.police, E = G.emergency;
  for (const x of [10, 40, 20]) P.createIncident('casualty', x, 0, [], { injury: true, medical: true, patient: victim(x, 0, false) });
  const inc = P.incidents[0], c = { unit: { x: 0, z: 0 }, service: 'ambulance', incident: inc }; E.calls.push(c);
  const order = []; let p;
  while ((p = E.nextPatient(c))) { order.push(p.x); p.carried = true; }
  assert.deepEqual(order, [10, 20, 40]);
});
