// The pubs (interiorPlan.js pub(), pubGames.js): every pub has a bar to buy drinks at, a pool table, a dartboard
// and a fruit machine you can walk up to; darts scores like a real board; the fruit machine pays out less than
// it takes; and a break at pool spreads the pack and comes to rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePlan } from '../../../src/interiorPlan.js';
import { MENUS } from '../../../src/food.js';
import { dartScore, fruitPay, PoolSim } from '../../../src/pubGames.js';
const SITES = JSON.parse(fs.readFileSync(new URL('../../../www/world/interiors.json', import.meta.url))).sites;

test('pubs: at least ten, Woodley\'s among them, each with a bar and all three games within reach', () => {
  const pubs = SITES.filter(s => s.kind === 'pub');
  assert.ok(pubs.length >= 10, `${pubs.length} pubs`);
  assert.ok(pubs.some(s => s.district === 'Woodley'), 'a pub in Woodley');
  assert.ok(MENUS.pub.items.some(i => i[2] > 0) && MENUS.pub.items.some(i => !i[2]), 'drinks with and without alcohol');
  for (const s of pubs) {
    const P = makePlan({ ...s, food: 'pub' });
    assert.ok(P.tills.length >= 1, `${s.name}: somewhere to buy a drink`);
    assert.deepEqual(P.games.map(g => g.type).sort(), ['darts', 'fruit', 'pool'], `${s.name} games`);
    for (const spot of [...P.tills, ...P.games]) { const [x, y] = P.collide(spot.x, spot.y, 0.3, 0); assert.ok(Math.hypot(x - spot.x, y - spot.y) < 0.3, `${s.name}: ${spot.type || 'till'} at (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}) can be stood at`); }
  }
});

test('darts: the board scores as a real one', () => {
  assert.equal(dartScore(0, 0).s, 50); assert.equal(dartScore(0, 10).s, 25);
  assert.equal(dartScore(0, 103).label, 'T20'); assert.equal(dartScore(0, 166).label, 'D20');
  assert.equal(dartScore(130, 0).s, 6); assert.equal(dartScore(0, -130).s, 3); assert.equal(dartScore(-130, 0).s, 11);
  assert.equal(dartScore(0, 200).s, 0);
});

test('fruit machine: the right prizes, and it keeps some of what it takes', () => {
  assert.equal(fruitPay(['7', '7', '7']), 100); assert.equal(fruitPay(['🍒', '🍋', '🍒']), 2); assert.equal(fruitPay(['🍋', '🍋', '🍊']), 1); assert.equal(fruitPay(['🍋', '🍊', '🍇']), 0);
  const STRIP = [['🍒', 6], ['🍋', 6], ['🍊', 5], ['🍇', 5], ['🔔', 3], ['BAR', 2], ['7', 1]].flatMap(([s, w]) => Array(w).fill(s));
  let paid = 0; const N = 200000; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) paid += fruitPay([0, 1, 2].map(() => STRIP[Math.floor(rnd() * STRIP.length)]));
  const rtp = paid / N; assert.ok(rtp > 0.5 && rtp < 0.95, `pays back ${(rtp * 100).toFixed(0)}%`);
});

test('pool: a break spreads the balls and everything comes to rest', () => {
  let pots = 0, spread = 0;
  for (let k = 0; k < 10; k++) {
    const S = new PoolSim(); S.shoot(4.8, (k - 5) * 0.02); S.run(40);
    assert.ok(!S.moving, 'at rest'); pots += S.potted.length;
    const xs = S.balls.filter(b => !b.in).map(b => b.x); spread += Math.max(...xs) - Math.min(...xs);
  }
  assert.ok(spread / 10 > 0.7, `the pack spreads ${(spread / 10).toFixed(2)} m on average`);
  assert.ok(pots >= 3, `${pots} balls potted in 10 breaks`);
});
