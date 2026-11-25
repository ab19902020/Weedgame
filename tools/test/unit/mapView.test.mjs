// Road Atlas street names (src/mapView.js): a street's pieces are joined into one run across junctions, the
// straightest way on, so its name can sit along the whole street; a side road of the same name that turns off
// at a right angle stays its own run.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Path2D ??= class { moveTo() {} lineTo() {} closePath() {} };
const { MapView } = await import('../../../src/mapView.js');

function net(edges) {
  const pts = [], pstart = [], pcount = [], name = [], names = ['', 'High Street', 'Mill Lane'];
  for (const [nm, P] of edges) { pstart.push(pts.length / 3); pcount.push(P.length); name.push(names.indexOf(nm)); for (const [x, z] of P) pts.push(x, 0, z); }
  return { nEdges: edges.length, classes: ['residential'], cls: edges.map(() => 0), walkCls: new Set(), pts, pstart, pcount, name, names };
}

test('a street is joined up across junctions, the straightest way on', () => {
  const G = { manifest: { tiles: [], districts: [] }, net: net([
    ['High Street', [[0, 0], [50, 0]]],
    ['High Street', [[100, 2], [75, 1], [50, 0]]],    // the next piece, stored the other way round
    ['High Street', [[50, 0], [50, 60]]],             // a branch at a right angle
    ['Mill Lane', [[0, 10], [40, 10]]],
  ]) };
  const V = new MapView(G); V.ensure();
  const runs = V.chains([0, 1, 2, 3]);
  const high = runs.filter(r => r.nm === 'High Street').sort((a, b) => b.len - a.len);
  assert.equal(high.length, 2, 'the main run and the side road');
  assert.ok(Math.abs(high[0].len - 100) < 1, `main run ${high[0].len.toFixed(1)} m`);
  assert.equal(high[0].line.length, 4, 'one line through both pieces, no repeated junction point');
  const xs = high[0].line.map(p => p[0]);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]) || xs.every((x, i) => i === 0 || x < xs[i - 1]), 'in order along the street');
  assert.ok(Math.abs(high[1].len - 60) < 1);
  assert.equal(runs.filter(r => r.nm === 'Mill Lane').length, 1);
});
