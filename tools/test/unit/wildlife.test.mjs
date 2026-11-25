// Wildlife keeps to its places and hours (src/wildlifeSim.js on the made-up map in wildworld.mjs):
// a fox in a busy shopping street at midday is vanishingly rare but foxes are about the gardens at night;
// hedgehogs come out after dark (and are rare by day); ducks and geese stay on the lakes, cows and sheep in their
// fields, rabbits by their warrens; nothing appears in front of you; dogs keep to their people.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WildSim } from '../../../src/wildlifeSim.js';
import { SPECIES, LC, suitability, solarHour, active, habitatKey } from '../../../src/wildlifeSpecies.js';
import { makeWorld, PLACES, walkers, movePeds, landcover } from './wildworld.mjs';

// run the simulation at a place from a BST clock time for some seconds (the game clock at real speed)
function run(place, hourBST, secs, seed = 1, opts = {}) {
  const { W, state } = makeWorld({ time: Date.UTC(2026, 5, 15, hourBST - 1, 0) / 1000 });
  const P = PLACES[place]; state.focus.x = P.x; state.focus.z = P.z;
  walkers(state, opts.peds ?? 10, P, seed);
  const sim = new WildSim(W, { max: 110, seed });
  const dt = 1 / 20, seen = {}, log = [];
  for (let i = 0; i < secs / dt; i++) {
    state.t += dt; movePeds(state, dt);
    if (opts.turn) { const a = i * dt * 0.3; state.look.x = Math.cos(a); state.look.z = Math.sin(a); }
    const before = new Set(sim.list);
    sim.update(dt);
    for (const a of sim.list) {
      if (!a.hidden) seen[a.key] = (seen[a.key] || 0) + dt;
      if (!before.has(a)) log.push({ a, x: a.x, y: a.y, z: a.z, fl: !!a.fl, hidden: a.hidden, seen: W.visible(a.x, a.y + 0.5, a.z, 1.5), d: Math.hypot(a.x - P.x, a.z - P.z) });
    }
    if (opts.each) opts.each(sim, state);
  }
  return { sim, seen, log, W, state };
}

test('the species rules: where and when', () => {
  const h = (lc, o = {}) => { const x = { lc, waterD: 99, urban: 0.2, trees: 3, busy: 2, bigRoad: false, ...o }; x.key = habitatKey(x); return x; };
  const fox = SPECIES.fox, hog = SPECIES.hedgehog;
  // a fox: in a shopping street at noon on a Saturday next to nothing; in the gardens at night, often
  assert.ok(suitability(fox, h(LC.plaza, { urban: 0.9, busy: 110 }), 12) < 1e-6);
  assert.ok(suitability(fox, h(LC.garden, { busy: 0.4 }), 0) > 0.5);
  assert.ok(suitability(fox, h(LC.garden, { busy: 6 }), 12) < suitability(fox, h(LC.garden, { busy: 0.4 }), 0) * 0.1);
  // a hedgehog: after midnight in a garden; by day rare (but not impossible)
  const night = suitability(hog, h(LC.garden, { busy: 0.3 }), 1), day = suitability(hog, h(LC.garden, { busy: 5 }), 13);
  assert.ok(night > 0.8 && day > 0 && day < night * 0.02);
  // ducks on the water only, cows in fields only, feral pigeons like the crowds, badgers don't
  assert.equal(suitability(SPECIES.mallard, h(LC.garden), 12), 0);
  assert.ok(suitability(SPECIES.mallard, h(LC.water, { waterD: 0 }), 12) > 0.9);
  assert.ok(suitability(SPECIES.cow, h(LC.grass, { urban: 0.05 }), 12) > 0.9 && suitability(SPECIES.cow, h(LC.park), 12) === 0);   // cows on pasture, not in parks
  assert.ok(suitability(SPECIES.pigeon, h(LC.plaza, { urban: 0.9, busy: 80 }), 12) > suitability(SPECIES.pigeon, h(LC.plaza, { urban: 0.9, busy: 1 }), 12));
  // badgers are shyer of people than foxes: where folk are about at night they keep away more
  const shy = (sp, busy) => suitability(sp, h(LC.wood, { busy }), 0) / suitability(sp, h(LC.wood, { busy: 0 }), 0);
  assert.ok(shy(SPECIES.badger, 15) < 0.3 && shy(SPECIES.badger, 15) < shy(SPECIES.fox, 15) * 0.5);
  // the animals keep to the sun: 21:30 at midsummer is still dusk, 16:30 at midwinter already dark
  assert.ok(Math.abs(solarHour(Date.UTC(2026, 5, 21, 20, 30) / 1000) - 18.2) < 0.4);
  assert.ok(solarHour(Date.UTC(2026, 11, 21, 16, 30) / 1000) > 18.2);
  assert.ok(active('badger', 13) === 0 && active('badger', 23) === 1);
});

test('foxes: almost never in the town centre at midday, out about the gardens at night', () => {
  let centreFox = 0, gardenFox = 0;
  for (let s = 1; s <= 12; s++) {
    if (run('centre', 12, 120, s).seen.fox) centreFox++;
    if (run('gardens', 0, 120, s).seen.fox) gardenFox++;
  }
  assert.equal(centreFox, 0);
  assert.ok(gardenFox >= 4, `foxes in the gardens at night in ${gardenFox} of 12`);
});

test('hedgehogs after dark, seldom by day', () => {
  let night = 0, day = 0;
  for (let s = 1; s <= 12; s++) {
    if (run('gardens', 1, 150, s).seen.hedgehog) night++;
    if (run('gardens', 13, 150, s).seen.hedgehog) day++;
  }
  assert.ok(night >= 3, `hedgehogs at night in ${night} of 12`);
  assert.ok(day <= 1, `hedgehogs by day in ${day} of 12`);
});

test('waterfowl keep to the lake, herds to their fields, nothing walks into a house', () => {
  for (const [place, hour] of [['lakeside', 9], ['farm', 15], ['park', 7], ['gardens', 22]]) {
    const { sim } = run(place, hour, 150, 3, {
      each: sim => {
        for (const a of sim.list) {
          if (a.fl || a.hidden || a.S.plan === 'raptor' || a.S.plan === 'bat' || a.S.plan === 'aerial') continue;   // (the fliers go over the houses)
          const lc = landcover(a.x, a.z);
          if (a.S.plan === 'water' && !a.onLand) assert.equal(lc, LC.water, `${a.key} off the water at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
          if (a.S.site === 'herd') assert.ok(lc === a.field.lc && lc === LC.grass, `${a.key} out of its field (on ${lc})`);
          if (a.state !== 'perch' && a.state !== 'nest' && a.state !== 'tree' && a.state !== 'climb' && a.state !== 'down') assert.notEqual(lc, LC.building, `${a.key} (${a.state}) in a building`);
        }
      },
    });
    if (place === 'lakeside') {
      const n = sim.list.filter(a => a.S.plan === 'water').length, kinds = new Set(sim.list.filter(a => a.S.plan === 'water').map(a => a.key));
      assert.ok(n >= 15 && kinds.has('mallard') && kinds.size >= 4, `${n} waterfowl of ${kinds.size} kinds`);
      assert.ok(sim.list.some(a => a.young && a.key !== 'cow' && a.key !== 'sheep'), 'ducklings, cygnets or goslings in June');
    }
    if (place === 'farm') assert.ok(sim.list.some(a => a.S.site === 'herd'), 'a herd in the fields');
  }
});

test('nothing appears in view: animals arrive from out of sight', () => {
  for (const [place, hour] of [['park', 8], ['gardens', 23], ['lakeside', 19], ['centre', 13]]) {
    const { log } = run(place, hour, 200, 5, { turn: true });
    for (const e of log) {
      const S = e.a.S, far = S.draw * 0.85;
      if (e.a.site || e.a.nest || e.hidden) continue;   // places' animals open beyond sight; nesting birds sit in the crowns
      // a newcomer is out of the view, far off (too small to notice) or flying in from out of sight
      assert.ok(!e.seen || e.d > far || e.fl, `${e.a.key} appeared in view ${e.d.toFixed(0)} m away`);
    }
  }
});

test('places stay the same: the same herds and flocks on every visit', () => {
  const a = run('farm', 11, 5, 1).sim, b = run('farm', 11, 5, 99).sim;
  const herds = s => [...s.live.keys()].filter(x => x.kind === 'herd').map(x => `${x.key}@${x.x.toFixed(0)},${x.z.toFixed(0)}x${x.n}`).sort().join(' ');
  assert.ok(herds(a).length > 0);
  assert.equal(herds(a), herds(b));
});

test('rabbits come out of the warren at dusk and bolt back when you run at them', () => {
  const { sim, state } = run('park', 21, 240, 2);
  const out = sim.list.filter(a => a.key === 'rabbit' && !a.hidden);
  assert.ok(out.length >= 1, 'rabbits out at dusk');
  const r = out[0];
  state.focus.x = r.x + 6; state.focus.z = r.z; state.focus.speed = 4;   // running at it
  for (let i = 0; i < 400 && !r.hidden; i++) { state.t += 0.05; r.home && sim.update(0.05); }
  assert.ok(r.hidden, 'the rabbit went to ground');
});

test('dogs walk with their people', () => {
  let dogs = 0;
  for (let s = 1; s <= 6; s++) {
    const { sim } = run('park', 8, 60, s, {
      peds: 20, each: sim => {
        for (const a of sim.list) if (a.key === 'dog' && !a.offLead && a.owner) assert.ok(Math.hypot(a.owner.x - a.x, a.owner.z - a.z) < 4, 'on the lead, by its person');
        for (const a of sim.list) if (a.key === 'dog' && a.offLead) assert.ok(Math.hypot(a.owner.x - a.x, a.owner.z - a.z) < 40, 'off the lead, not far');
      },
    });
    dogs += sim.list.filter(a => a.key === 'dog').length;
  }
  assert.ok(dogs >= 3, `${dogs} dogs out in the morning in the park`);
});

test('the simulation is cheap enough for a phone', () => {
  const { W, state } = makeWorld({ time: Date.UTC(2026, 5, 15, 7, 0) / 1000 });
  state.focus.x = PLACES.lakeside.x; state.focus.z = PLACES.lakeside.z; walkers(state, 20, PLACES.lakeside);
  const sim = new WildSim(W, { max: 110, seed: 4 });
  for (let i = 0; i < 600; i++) { state.t += 0.05; movePeds(state, 0.05); sim.update(0.05); }
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) { state.t += 0.05; movePeds(state, 0.05); sim.update(0.05); }
  const ms = (performance.now() - t0) / 600;
  assert.ok(ms < 2, `${ms.toFixed(2)} ms a frame`);
});
