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

test('trains stop at every station and never jump', () => {
  const T = new Trains(null).setup(rail);
  assert.ok(T.trains.length >= 3);
  for (const L of T.lines) {
    for (const st of L.stops) {
      const fwdStop = Array.from(L.fwd).filter(s => Math.abs(s - st) < 0.01).length * 0.5;
      assert.ok(fwdStop >= 30 || st > L.len - 1, `${L.name} dwells at ${st.toFixed(0)} m (${fwdStop} s)`);
    }
    const tr = T.trains.find(t => t.line === L); let prev = null;
    for (let t = 0; t < L.cycle * 1.05; t += 1) { const [s, , v] = T.state(tr, t); assert.ok(s >= -0.01 && s <= L.len + 0.01); if (prev != null) assert.ok(Math.abs(s - prev) <= L.vmax * 1.05 + 0.5 || Math.abs(Math.abs(s - prev) - 0) < 1e-6, `jump ${prev}→${s} at ${t}`); assert.ok(Math.abs(v) <= L.vmax + 0.01); prev = s; }
  }
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
