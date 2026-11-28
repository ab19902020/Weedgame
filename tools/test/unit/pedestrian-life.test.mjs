// How people get about (src/peds.js): spread across the whole pavement rather than filing down one line, off to
// places of their own, running from gunfire and carrying on from wherever they got to, and getting on a bus at
// its door rather than vanishing from the queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, inflate } from '../../../src/data.js';
import { Network } from '../../../src/network.js';
import { Peds } from '../../../src/peds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const raw = fs.readFileSync(path.join(root, 'www/world/network.bin'));
const net = new Network(decode(await inflate(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))));

function world(hour = 11) {
  const G = {
    net, events: { on() {} }, budget: { people: 200, peopleDist: 170 }, time: 0,
    world: { hours: () => hour, time: Date.UTC(2026, 10, 25, hour) / 1000, cur: { rain: 0 }, s: { scale: 1 } },
    tiles: { landcover: () => 0, insideBuilding: () => false, ground: () => 0, terrain: () => 0, tileAt: () => null, tiles: new Map(), buildingsNear() {} },
    traffic: { list: [], zebraBusy: new Map() }, signals: { t: 0 }, transit: { services: new Map() },
  };
  const peds = new Peds(G); G.peds = peds; peds.timer = 1e9;      // (no spawning or thinning in these tests)
  peds.info = { visible: () => false }; peds.focus = { x: 0, z: 0 };
  return { G, peds };
}
// a long residential street in Woodley with pavements
const street = (() => { let best = null; for (let e = 0; e < net.nEdges; e++) if (net.pav[e] && net.clsName(e) === 'residential' && net.len[e] > 120 && (!best || net.len[e] > net.len[best])) { const t = net.at(e * 2, 0, [0, 0, 0, 0, 0]); if (Math.hypot(t[0] + 3300, t[2] + 1330) < 1500) best = e; } return best; })();
const person = (peds, e, s, extra = {}) => { const p = { id: 'p' + peds.nextId++, h: e * 2, s, sideSign: 1, lane: 0, look: { h: 1 }, speed: 1.3, mode: 'walk', t: 0, phase: 0, heading: 0, y: 0, visible: true, alpha: 1, planAfter: 1e9, ...extra }; [p.x, p.z] = peds.pos(p); peds.list.push(p); return p; };

test('people walk all across the pavement, not down one line', () => {
  const { peds } = world(), e = street;
  for (let k = 0; k < 40; k++) person(peds, e, 5 + k * 2.5);
  const off = [];
  for (let f = 0; f < 600; f++) { peds.update(1 / 20, { x: peds.list[0].x, z: peds.list[0].z }, peds.info); if (f % 60 === 59) for (const p of peds.list) if (p.mode === 'walk' && (p.h >> 1) === e && !p.corner) off.push(peds.latOff(p, e) - net.width[e] / 2); }
  off.sort((a, b) => a - b);
  const spread = off[Math.floor(off.length * 0.9)] - off[Math.floor(off.length * 0.1)];
  assert.ok(off.length > 100, `${off.length} samples`);
  assert.ok(spread > 0.7, `the middle 80% walk within ${spread.toFixed(2)} m of each other across a 2 m pavement`);
  assert.ok(off[0] >= 0.3 && off.at(-1) <= 1.7, `everyone stays on the pavement (${off[0].toFixed(2)} .. ${off.at(-1).toFixed(2)} m out from the kerb)`);
});

test('gunfire scatters everyone in earshot, and they carry on from where they ran to', () => {
  const { peds } = world(), e = street, t = net.at(e * 2, 60, [0, 0, 0, 0, 0]), shot = { x: t[0], z: t[2] };
  for (let k = 0; k < 12; k++) person(peds, e, 40 + k * 3);
  const d0 = new Map(peds.list.map(p => [p, Math.hypot(p.x - shot.x, p.z - shot.z)]));
  peds.disturb(shot.x, shot.z, 55, 'gun');
  for (let f = 0; f < 20 * 14; f++) peds.update(1 / 20, shot, peds.info);
  const ran = peds.list.filter(p => Math.hypot(p.x - shot.x, p.z - shot.z) > d0.get(p) + 15);
  assert.ok(ran.length >= 11, `${ran.length} of 12 ran at least 15 m further off`);
  const after = new Map(peds.list.map(p => [p, Math.hypot(p.x - shot.x, p.z - shot.z)]));
  for (let f = 0; f < 20 * 8; f++) peds.update(1 / 20, shot, peds.info);
  const back = peds.list.filter(p => !p.gone && Math.hypot(p.x - shot.x, p.z - shot.z) < after.get(p) - 8);
  assert.ok(back.length <= 1, `${back.length} slid back towards the shooting once they'd stopped running`);
});

test('people set off for all sorts of places, by the hour', () => {
  const { G, peds } = world(13);
  peds._parkEdges = [street];
  // shops, homes and workplaces along the streets round about, and the bus stops served there
  const t0 = net.at(street * 2, 0, [0, 0, 0, 0, 0]), dest = [];
  for (let e = 0; e < net.nEdges && dest.length < 300; e++) { if (!net.walkable(e)) continue; const t = net.at(e * 2, net.len[e] / 2, [0, 0, 0, 0, 0]); if (Math.hypot(t[0] - t0[0], t[2] - t0[2]) < 500) dest.push({ x: t[0] + 8, z: t[2], kind: ['shop', 'home', 'work'][dest.length % 3] }); }
  G.tiles.tiles.set('t', { data: { buildings: { destinations: dest } } });
  net.busStops.forEach((st, i) => { if (Math.hypot(st[0] - t0[0], st[1] - t0[2]) < 400) G.transit.services.set(i, []); });
  const acts = new Map();
  for (let k = 0; k < 200; k++) { const p = person(peds, street, 30); peds.planDay(p); const a = p.activity || p.goal?.kind || 'none'; acts.set(a, (acts.get(a) || 0) + 1); }
  assert.ok(acts.size >= 3, `activities at 13:00: ${JSON.stringify(Object.fromEntries(acts))}`);
  assert.ok(Math.max(...acts.values()) < 200 * 0.6, `no one thing takes most of them: ${JSON.stringify(Object.fromEntries(acts))}`);
});

test('a bus queue walks to the front door and gets on there', () => {
  const { G, peds } = world();
  const i = net.busStops.findIndex(st => Math.hypot(st[0] + 3300, st[1] + 1330) < 3000);
  assert.ok(i >= 0, 'a bus stop in Woodley');
  const st = net.busStops[i], hit = net.nearest(st[0], st[1], 30, e => net.walkable(e));
  const q = [];
  for (let k = 0; k < 3; k++) { const p = person(peds, hit.e, hit.s); p.goal = { kind: 'stop', i }; peds.joinQueue(p); q.push(p); }
  for (let f = 0; f < 200; f++) peds.update(1 / 20, { x: st[0], z: st[1] }, peds.info);
  const road = net.nearest(st[0], st[1], 30, e => !!(net.flags[e] & 16));
  const bus = { x: road.x, z: road.z, y: 0, heading: Math.atan2(road.dz, road.dx), len: 11, v: 0, served: true, nextStop: 0, busData: { stops: [{}, {}, {}, {}] }, passengers: [] };
  const n = peds.board(i, bus);
  assert.equal(n, 3);
  assert.ok(q.every(p => p.visible && !p.gone), 'still on the pavement the moment the bus pulls in');
  let t = 0;
  for (; t < 15 && bus.passengers.length < 3; t += 1 / 20) peds.update(1 / 20, { x: st[0], z: st[1] }, peds.info);
  assert.equal(bus.passengers.length, 3, 'all aboard');
  assert.ok(t > 1.5 && t < 8 + 3 * 2.5, `boarded in ${t.toFixed(1)} s (the bus waits 8 s + 2.5 s a passenger)`);
  const door = peds.busDoor(bus);
  assert.ok(Math.hypot(door[0] - road.x, door[1] - road.z) > 1.2, 'the door is on the kerb side of the bus');
});
