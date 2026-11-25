// Enterable buildings (src/interiorPlan.js, www/world/interiors.json): every site's floor plan is sound (rooms fill
// the building, every room can be reached from the front door, the stairs fit), you can walk up the stairs to
// the landing and into a bedroom and back down, walls stop you, and the sites asked for are there: the trap
// house on Drovers Way in Woodley, a nicer house in Woodley, The Oracle, and at least fifty in all, of many kinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePlan } from '../../../src/interiorPlan.js';
const SITES = JSON.parse(fs.readFileSync(new URL('../../../www/world/interiors.json', import.meta.url))).sites;

function reachable(P, lv) {
  const adj = new Map(lv.rooms.map(r => [r, new Set()]));
  for (const a of lv.rooms) for (const b of lv.rooms) if (a !== b && a.group === b.group) {
    const touch = (Math.abs(a.x1 - b.x0) < 0.02 || Math.abs(b.x1 - a.x0) < 0.02) && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 || (Math.abs(a.y1 - b.y0) < 0.02 || Math.abs(b.y1 - a.y0) < 0.02) && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5;
    if (touch) adj.get(a).add(b);
  }
  for (const w of lv.walls) if (!w.outer && w.open.some(o => o.bot < 0.3)) { adj.get(w.rooms[0]).add(w.rooms[1]); adj.get(w.rooms[1]).add(w.rooms[0]); }
  let start;
  if (lv.i === 0) start = lv.rooms.find(r => P.exit.x > r.x0 && P.exit.x < r.x1 && P.exit.y > r.y0 && P.exit.y < r.y1);
  else { const st = P.stairs[0], tx = (st.x0 + st.x1) / 2, ty = st.up > 0 ? st.y1 + 0.3 : st.y0 - 0.3; start = lv.rooms.find(r => tx > r.x0 && tx < r.x1 && ty > r.y0 && ty < r.y1); }
  if (!start) return [];
  const seen = new Set([start]), q = [start];
  while (q.length) for (const n of adj.get(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return lv.rooms.filter(r => !seen.has(r)).map(r => r.name).concat(start ? [] : ['(no start)']);
}

test('the sites asked for are there, spread over the map', () => {
  assert.ok(SITES.length >= 50, `${SITES.length} enterable buildings`);
  const trap = SITES.find(s => s.kind === 'trap');
  assert.equal(trap.street, 'Drovers Way'); assert.equal(trap.district, 'Woodley'); assert.equal(trap.lv, 2);
  const nice = SITES.find(s => s.kind === 'nice'); assert.equal(nice.district, 'Woodley');
  assert.ok(SITES.find(s => s.kind === 'mall' && s.name === 'The Oracle'));
  const kinds = new Set(SITES.map(s => s.kind)), places = new Set(SITES.map(s => s.district));
  assert.ok(kinds.size >= 12, `${kinds.size} kinds`); assert.ok(places.size >= 35, `${places.size} districts`);
  for (const k of ['terrace', 'semi', 'detached', 'bungalow', 'warehouse', 'office', 'shop']) assert.ok(SITES.filter(s => s.kind === k).length >= 5, k);
});

test('every floor plan is sound', () => {
  for (const s of SITES) {
    const P = makePlan(s);
    for (const lv of P.levels) {
      const A = lv.rooms.reduce((a, r) => a + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
      assert.ok(Math.abs(A - P.W * P.D) < 0.05, `${s.id} ${s.kind} level ${lv.i}: rooms cover ${A.toFixed(1)} of ${(P.W * P.D).toFixed(1)}`);
      for (const r of lv.rooms) assert.ok(r.x1 - r.x0 >= 0.8 && r.y1 - r.y0 >= 0.8, `${s.id} ${r.name} too small`);
      assert.deepEqual(reachable(P, lv), [], `${s.id} ${s.kind} level ${lv.i}: rooms you can't get to`);
    }
    assert.ok(P.levels[0].walls.some(w => w.outer === 'y0' && w.open.some(o => o.kind === 'front')), `${s.id} has a front door`);
    for (const st of P.stairs) assert.ok(st.x0 >= 0 && st.x1 <= P.W && st.y0 >= 0 && st.y1 <= P.D && st.rise / st.n < 0.215, `${s.id} stairs fit, risers ${(st.rise / st.n).toFixed(3)} m`);
    if (s.lv >= 2 && s.kind !== 'office') assert.equal(P.levels.length, 2, `${s.id} ${s.kind} has an upstairs`);
  }
});

// walk from (x, y) towards (tx, ty) in 5 cm steps the way the game does: collide, then take the floor's height
function walk(P, from, to, h) {
  let [x, y] = from;
  for (let i = 0; i < 400; i++) {
    const dx = to[0] - x, dy = to[1] - y, d = Math.hypot(dx, dy); if (d < 0.06) break;
    [x, y] = P.collide(x + dx / d * 0.05, y + dy / d * 0.05, 0.3, h);
    h = P.floorAt(x, y, h);
  }
  return { x, y, h };
}
test('upstairs and down again in the trap house; walls stop you', () => {
  const P = makePlan(SITES.find(s => s.kind === 'trap')), st = P.stairs[0], fh = P.fh;
  const mx = (st.x0 + st.x1) / 2;
  // from the front door to the foot of the stairs, up them, onto the landing
  let r = walk(P, [P.exit.x, P.exit.y], [mx + 0.1, st.y0 - 0.05], 0);
  assert.ok(r.h < 0.05, `still downstairs at the foot (${r.h.toFixed(2)} m)`);
  r = walk(P, [r.x, r.y], [mx, st.y1 + 0.5], r.h);
  assert.ok(Math.abs(r.h - fh) < 0.03, `at the top of the stairs: ${r.h.toFixed(2)} of ${fh} m`);
  // into the front bedroom (through its door off the landing) and the floor stays upstairs
  const bed = P.levels[1].rooms.find(q => q.name === 'bed1');
  r = walk(P, [r.x, r.y], [(st.x1 + bed.x0) / 2 + 0.1, bed.y1 - 0.6], r.h);
  r = walk(P, [r.x, r.y], [(bed.x0 + bed.x1) / 2, (bed.y0 + bed.y1) / 2], r.h);
  assert.ok(r.x > bed.x0 && Math.abs(r.h - fh) < 0.03, `in the bedroom upstairs (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.h.toFixed(2)})`);
  // back to the landing and down
  r = walk(P, [r.x, r.y], [(st.x1 + bed.x0) / 2 + 0.1, bed.y1 - 0.6], r.h);
  r = walk(P, [r.x, r.y], [mx, st.y1 + 0.3], r.h);
  r = walk(P, [r.x, r.y], [mx, st.y0 - 0.4], r.h);
  assert.ok(r.h < 0.05, `back downstairs (${r.h.toFixed(2)} m)`);
  // straight at the living room's side wall from the hall: the partition stops you (no door there)
  const hall = P.levels[0].rooms.find(q => q.name === 'hall');
  r = walk(P, [hall.x1 - 0.5, P.levels[0].rooms.find(q => q.name === 'kitchen').y0 - 0.4], [hall.x1 + 2, P.levels[0].rooms.find(q => q.name === 'kitchen').y0 - 0.4], 0);
  assert.ok(r.x < hall.x1, `the wall held (${r.x.toFixed(2)} < ${hall.x1.toFixed(2)})`);
});
