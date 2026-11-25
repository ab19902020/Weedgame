// Stations (src/stations.js): every station of the lines passengers ride has its platforms, beside the
// track each direction runs on, and trains stand at every platform with their doors open on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Trains } from '../../../src/trains.js';
import { Stations } from '../../../src/stations.js';
const rail = JSON.parse(fs.readFileSync(new URL('../../../www/world/rail.json', import.meta.url)));
const setup = () => { const T = new Trains(null).setup(rail); T.ready = true; const S = new Stations({ trains: T }); return { T, S }; };

test('every station of the lines passengers ride has its platforms', () => {
  const { T, S } = setup();
  const names = new Set(T.lines.filter(l => l.board).flatMap(l => l.names));
  for (const n of ['Reading', 'Earley', 'Winnersh Triangle', 'Winnersh', 'Wokingham', 'Bracknell', 'Martins Heron', 'Reading West']) assert.ok(names.has(n), n + ' served');
  for (const n of names) {
    const st = S.list.find(s => s.name === n); assert.ok(st, 'station ' + n);
    for (const L of T.lines.filter(l => l.board && l.names.includes(n))) {
      const ps = st.platforms.filter(p => p.line === L), k = L.names.indexOf(n), end = (k === 0 && L.term0) || (k === L.names.length - 1 && L.term1);
      assert.equal(ps.length, end ? 1 : 2, `${n} on ${L.name}: ${end ? 'a terminus platform' : 'a platform each way'}`);
      if (!end) assert.notEqual(ps[0].side, ps[1].side, 'on opposite sides of the line');
    }
  }
});

test('platforms run beside the running track, long enough for the train', () => {
  const { T, S } = setup();
  for (const p of S.platforms) {
    assert.ok((p.hl * 2) >= p.line.Lt + 10, 'longer than the train');
    for (const q of p.pts) {
      const track = T.offset(p.line, q.s, p.terminus ? (p.side > 0 ? 1 : -1) : p.dir);
      assert.ok(Math.abs(Math.abs(q.edge - track) - 1.55) < 0.05, `${p.name}: edge 1.55 m from the rails`);
      assert.ok(Math.sign(q.outer - q.edge) === p.side, 'platform on its side');
      assert.ok(q.y > q.rail + 0.8 && q.y < q.rail + 0.95, 'level with the car floor');
    }
  }
});

test('within a cycle a train opens its doors at every platform', () => {
  const { T, S } = setup();
  for (const p of S.platforms) {
    const L = p.line; let served = false;
    for (let t = 0; t < L.cycle && !served; t += 5) { T.t = t; T.update(0); const tr = S.trainAt(p); if (tr) { served = true; assert.equal(S.platformFor(tr), p, 'the train finds this platform'); } }
    assert.ok(served, `${p.name} platform ${p.number} on ${L.name} is served`);
  }
  // waits are short: at most a few minutes between trains each way
  for (const L of T.lines.filter(l => l.board)) assert.ok(L.cycle / T.trains.filter(t => t.line === L).length <= 600, `${L.name}: a train every ${(L.cycle / T.trains.filter(t => t.line === L).length / 60).toFixed(1)} min`);
});
