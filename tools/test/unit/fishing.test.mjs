// Fishing (src/fishing.js, src/fishData.js) on the real South Lake data: casts reach believable distances for each
// rod, the fish and their weights follow the lake's stock, bites come at a sensible rate, a fish played properly is
// landed (a carp on the carp rod, a roach swung in on the float rod), a big carp on light float tackle with the
// clutch screwed down snaps the line and costs the rig, and lost tackle has to be retied from spares.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three/webgpu';
import { Fishing, kitOf } from '../../../src/fishing.js';
import { Lake, STOCK, biteRates, drawWeight, lengthCm, lbOz } from '../../../src/fishData.js';

// a stand-in canvas: the fish skins are painted on one (fishModels.js), which Node doesn't have
const ctx2d = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop() {} }), set: (o, k, v) => { o[k] = v; return true; } });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const W = new URL('../../../www/world/fishing/', import.meta.url).pathname;
const lakeData = id => new Lake(JSON.parse(fs.readFileSync(W + id + '.json')));

function world(lakeId = 'southlake') {
  const lake = lakeData(lakeId);
  const me = { short: 'Cal', x: 0, y: 0, z: 0, heading: 0, cash: 5000, items: {} };
  const G = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, 1.6, 0.1, 3000), time: 0,
    world: { wind: [0, 0], cur: { cover: 0.5 }, s: { t: 1.75e9 }, hours: () => 7 },
    brothers: { me, b: [me], active: 0, actor: [{ id: 'brother0' }] },
    tiles: { ground: () => lake.level + 0.6, terrain: () => lake.level + 0.6 },
    hud: { toast: () => {} }, combat: { select: () => {} },
  };
  const F = new Fishing(G);
  const k = kitOf(me);
  k.rods = { float: { rig: true, wear: 0 }, carp: { rig: true, wear: 0 }, lure: { rig: 'shad' } };
  k.net = true; k.mat = true; k.catapult = true;
  Object.assign(k.tackle, { hooks: 10, floats: 3, hairrigs: 3, leads: 3, spinner: 1, shad: 1 });
  Object.assign(k.bait, { maggots: 200, corn: 100, boilies: 100, worms: 50, bread: 50 });
  k.tickets.southlake = true;
  F.start(lake, lake.pegs[8]);
  return { G, F, lake, me, k };
}
const idle = { aim: 0, lift: 0, reel: 0 };
function run(F, secs, inp = idle, each = null) { for (let i = 0; i < secs * 60; i++) { const I = typeof inp === 'function' ? inp(F) : inp; F.update(1 / 60, { ...idle, ...I }); each?.(F); } }
function cast(F, hold = 1.0) {
  F.update(1 / 60, { ...idle, castDown: true, castHeld: true });
  run(F, hold, { castHeld: true });
  run(F, 5, {}, () => {});
  return F.lastCast;
}

test('casts: the float rod reaches 25-40 m, the carp rod 75-110 m, the lure rod 35-55 m', () => {
  for (const [m, lo, hi] of [['float', 22, 42], ['ledger', 70, 115], ['lure', 32, 58]]) {
    const { F } = world();
    F.chooseMethod(m, true);
    F.aim = 0; const d = cast(F, 1.12);
    assert.ok(d > lo && d < hi, `${m}: ${d?.toFixed(1)} m`);
  }
});

test('fish weights follow the lake: most carp in their teens and twenties, none over the lake record', () => {
  const st = STOCK.southlake.fish.common; let n = 0, over = 0, sum = 0;
  for (let i = 0; i < 4000; i++) { const w = drawWeight(st); sum += w; if (w > st.max) over++; if (w > 10 && w < 30) n++; }
  assert.equal(over, 0); assert.ok(n / 4000 > 0.6, 'share of 10-30 lb: ' + n / 4000); assert.ok(sum / 4000 > 12 && sum / 4000 < 20);
  assert.equal(lbOz(23.5), '23 lb 8 oz'); assert.ok(lengthCm('common', 20) > 60 && lengthCm('common', 20) < 85);
});

test('bites: maggots under a float bring small fish at a lively rate; boilies are for carp', () => {
  const lake = lakeData('southlake'), spot = { x: -3300, z: -1150 };
  const m = biteRates('southlake', lake, spot, { bait: 'maggots', method: 'float', hour: 7 }), b = biteRates('southlake', lake, spot, { bait: 'boilies', method: 'ledger', hour: 21 });
  const tot = r => r.reduce((a, x) => a + x.rate, 0);
  assert.ok(tot(m) > 0.8 && tot(m) < 4, 'maggot bites a minute ' + tot(m));
  const carp = b.filter(x => x.s === 'common' || x.s === 'mirror').reduce((a, x) => a + x.rate, 0);
  assert.ok(carp / tot(b) > 0.7, 'boilies mostly carp');
  assert.ok(!m.some(x => x.s === 'bream'), 'no bream in South Lake');
});

// play a hooked fish the way a careful angler would: wind when the line isn't near the clutch, rod up, net it when beaten
function play(F, maxSecs = 600) {
  let t = 0;
  while (t < maxSecs && (F.state === 'fight' || F.state === 'netting')) {
    const near = F.fish && Math.hypot(F.fish.p.x - F.stand.x, F.fish.p.z - F.stand.z) < 4 && F.fish.y < 0.6;
    const I = { ...idle, lift: 0.6, reel: F.T < F.dragLb() * 0.4536 * 0.75 ? 1 : 0, net: near && F.fish.E < 0.12 && F.state === 'fight' };
    F.update(1 / 60, I); t += 1 / 60;
  }
  return t;
}
function hookFish(F, s, lb, method) {
  F.chooseMethod(method, true); F.aim = 0;
  cast(F, method === 'ledger' ? 0.6 : 0.7);
  run(F, 3);
  F.bite = { s, lb, record: 40, shape: { window: 5, self: 0, lead: 0 }, t: 0, phase: 'take', tTake: 0.1 };
  F.hook(0.9);
}

test('a 22 lb carp on the carp rod, played on a 4 lb clutch, is landed in a few minutes', () => {
  let landed = 0;
  for (let i = 0; i < 5; i++) {
    const { F } = world(); F.chooseMethod('ledger', true); F.setDrag(4.5);
    hookFish(F, 'common', 22, 'ledger');
    const t = play(F);
    if (F.state === 'landed') { landed++; assert.ok(t > 40 && t < 420, 'took ' + t.toFixed(0) + ' s'); assert.equal(F.caught.s, 'common'); }
  }
  assert.ok(landed >= 3, 'landed ' + landed + ' of 5');
});

test('a roach on the float rod comes in quickly and is swung in', () => {
  const { F, k } = world(); F.setDrag(1.2);
  hookFish(F, 'roach', 0.4, 'float');
  const t = play(F, 120);
  assert.equal(F.state, 'landed'); assert.ok(t < 60, 'roach took ' + t.toFixed(0) + ' s');
  assert.equal(k.log[0].s, 'roach'); assert.ok(k.pb.roach > 0.3);
});

test('a big carp on 4 lb float tackle with the clutch locked up snaps the line, and the rig has to be retied', () => {
  const { F, k } = world(); F.chooseMethod('float', true); F.setDrag(99);   // screwed right down
  hookFish(F, 'mirror', 28, 'float');
  let t = 0; while (t < 300 && F.state === 'fight') { F.update(1 / 60, { ...idle, reel: 1, lift: 1 }); t += 1 / 60; }
  assert.equal(F.state, 'ready');
  assert.equal(k.rods.float.rig, false, 'the float and hook went with it');
  const hooks = k.tackle.hooks, floats = k.tackle.floats;
  assert.ok(F.retie()); assert.equal(k.tackle.hooks, hooks - 1); assert.equal(k.tackle.floats, floats - 1); assert.equal(k.rods.float.rig, true);
});

test('the target ring is where the cast lands, and there is open water to cast at from every peg', () => {
  const { F, lake } = world(); F.chooseMethod('float', true);
  F.aim = 0; const pred = F.predictCast(1);
  // a full-power cast held to the top of the meter, no wind, no feathering
  F.update(1 / 60, { ...idle, castDown: true, castHeld: true }); run(F, 1.12, { castHeld: true }); run(F, 5);
  const d = Math.hypot(F.rig.p.x - pred.x, F.rig.p.z - pred.z);
  assert.ok(d < 6, 'landed ' + d.toFixed(1) + ' m from the target');
  for (const p of lake.pegs) { F.start(lake, p); let best = 0; for (let a = -1; a <= 1; a += 0.25) { F.aim = a; best = Math.max(best, F.openWater()); } assert.ok(best >= 15, `peg ${p.n}: only ${best} m of water`); }
});

test('every lake: pegs face open water, and the bait finds fish in each lake\'s stock', () => {
  for (const id of ['southlake', 'whiteswan', 'blackswan', 'canberra', 'orrell']) {
    const { F, lake } = world(id);
    for (const p of lake.pegs) { F.start(lake, p); let best = 0; for (let a = -1; a <= 1; a += 0.25) { F.aim = a; best = Math.max(best, F.openWater()); } assert.ok(best >= 12, `${id} peg ${p.n}: only ${best} m of water`); }
    const spot = { x: lake.pegs[0].x + Math.cos(lake.pegs[0].heading) * 15, z: lake.pegs[0].z + Math.sin(lake.pegs[0].heading) * 15 };
    const r = biteRates(id, lake, spot, { bait: 'corn', method: 'float', hour: 7 });
    assert.ok(r.length >= 3 && r.every(x => STOCK[id].fish[x.s]), id + ' corn bites from its own fish');
  }
});
