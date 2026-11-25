// Trains: line paths from rail.json, station stops with dwell, continuous motion and even spacing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Trains } from '../../../src/trains.js';
const rail = JSON.parse(fs.readFileSync(new URL('../../../www/world/rail.json', import.meta.url)));

test('rail data has both lines, Reading–Waterloo with its stations in order', () => {
  const rw = rail.lines.find(l => /Waterloo/.test(l.name)), gw = rail.lines.find(l => /Great Western/.test(l.name));
  assert.ok(rw && gw);
  const names = rw.stops.map(s => s.name);
  for (const n of ['Reading', 'Earley', 'Winnersh Triangle', 'Winnersh', 'Wokingham', 'Bracknell']) assert.ok(names.includes(n), n);
  for (let i = 1; i < rw.stops.length; i++) assert.ok(rw.stops[i].s > rw.stops[i - 1].s, 'stations in order');
  assert.ok(gw.stops.some(s => s.name === 'Reading'));
});

test('trains stop centred on every station and never jump', () => {
  const T = new Trains(null).setup(rail);
  assert.ok(T.trains.length >= 3);
  for (const L of T.lines) {
    // the front stands half a train beyond the station, so the train is centred on the platform
    L.centre.forEach((c, k) => {
      const front = c + L.Lt / 2, dwell = Array.from(L.fwd).filter(s => Math.abs(s - front) < 0.01).length * 0.5;
      assert.ok(dwell >= 30 || k === L.centre.length - 1, `${L.name} dwells at ${L.names[k]} (${dwell} s)`);
      assert.ok(Math.abs(c - L.stops[k]) < L.Lt / 2 + 1, 'stops at the station');
    });
    // the middle of the train moves continuously, also when it reverses at a terminus
    const tr = T.trains.find(t => t.line === L); let prev = null;
    for (let t = 0; t < L.cycle * 1.05; t += 1) {
      const [s, dir, v] = T.state(tr, t), mid = s - dir * L.Lt / 2;
      assert.ok(mid >= -L.Lt / 2 - 0.01 && mid <= L.len + L.Lt / 2 + 0.01, `${L.name}: middle ${mid} m off the line`);
      if (prev != null) assert.ok(Math.abs(mid - prev) <= L.vmax * 1.05 + 0.5, `jump ${prev}→${mid} at ${t}`);
      assert.ok(Math.abs(v) <= L.vmax + 0.01); prev = mid;
    }
  }
});

test('stopped trains know their station; trains keep left on double track', () => {
  const T = new Trains(null).setup(rail);
  const rw = T.lines.find(l => /Waterloo/.test(l.name)), seen = new Set();
  const tr = T.trains.find(t => t.line === rw);
  for (let t = 0; t < rw.cycle; t += 2) { const [s, dir, , st] = T.state(tr, t); Object.assign(tr, { s, dir, status: st }); const k = T.stationOf(tr); if (st !== 'running') { assert.ok(k >= 0, `${st} at ${s.toFixed(0)} m is a station`); seen.add(rw.names[k]); } }
  for (const n of rw.names) assert.ok(seen.has(n), 'calls at ' + n);
  // each direction runs on the left-hand track where the line has two
  let both = 0;
  for (let i = 0; i < rw.off.f.length; i++) { const f = rw.off.f[i], b = rw.off.b[i]; assert.ok(f >= -0.01 && b <= 0.01); if (f > 1 || b < -1) both++; }
  assert.ok(both > rw.off.f.length * 0.5, 'double track found along most of the line');
});

test('trains on a line are spread out and the service shuttles end to end', () => {
  const T = new Trains(null).setup(rail);
  for (const L of T.lines) {
    const ts = T.trains.filter(t => t.line === L); if (ts.length < 2) continue;
    const ph = ts.map(t => t.phase).sort((a, b) => a - b);
    for (let i = 1; i < ph.length; i++) assert.ok(Math.abs(ph[i] - ph[i - 1] - L.cycle / ts.length) < 1e-6);
  }
  const tr = T.trains[0], dirs = new Set(); for (let t = 0; t < tr.line.cycle; t += 30) dirs.add(T.state(tr, t)[1]);
  assert.deepEqual([...dirs].sort(), [-1, 1]);
});
