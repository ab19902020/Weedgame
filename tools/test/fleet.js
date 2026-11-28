// Traffic persistence check: the simulated fleet within 200 m of Cal keeps its ids across a save + reload. Usage: xvfb-run -a node tools/test/fleet.js [outJson]  (needs `npm run serve`)
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const R = 200;
async function idsNear(p) {
  return p.evaluate(R => GC.brothers.b.map(b => GC.traffic.list.filter(v => !v.parked && !v.player && (v.kind === 'traffic' || v.kind === 'bus') && Math.hypot(v.x - b.x, v.z - b.z) < R).map(v => v.id)), R);
}
// wait (bounded) until the simulated traffic around Cal has built up
async function warm(p, min = 4, ms = 150000) {
  await p.waitForFunction(([R, min]) => { const me = GC.brothers.me; return GC.traffic.list.filter(v => !v.parked && !v.player && (v.kind === 'traffic' || v.kind === 'bus') && Math.hypot(v.x - me.x, v.z - me.z) < R * 0.8).length >= min; }, [R, min], { timeout: ms, polling: 1000 }).catch(() => {});
}
const overlap = (a, b) => a.length ? a.filter(id => b.includes(id)).length / a.length : 1;
async function run(T) {
  const { p, ready } = T, out = { steps: [] };
  await warm(p);
  const before = await idsNear(p);
  const size = await p.evaluate(() => { GC.save.now(); return localStorage.getItem('greenCounty.sandbox.v1').length; });
  const fleetN = await p.evaluate(() => JSON.parse(localStorage.getItem('greenCounty.sandbox.v1')).fleet.cars.length);
  out.steps.push({ step: 'saved', near: before.map(l => l.length), fleetRecords: fleetN, saveBytes: size });
  await p.reload(); await ready();
  const afterReload = await idsNear(p);
  out.steps.push({ step: 'reloaded', near: afterReload.map(l => l.length), kept: before.map((l, i) => +overlap(l, afterReload[i]).toFixed(2)) });
  out.ok = before.every((l, i) => overlap(l, afterReload[i]) >= 0.9) && size < 1048576 && before[0].length > 0;
  out.saveBytes = size;
  return out;
}
module.exports = { run };
if (require.main === module) (async () => {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?backend=webgl&fixedres=1');
  const ready = async () => { await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '' && !GC._needGround, null, { timeout: 0, polling: 300 }); };
  const tap = async sel => { const r = await p.locator(sel).first().boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 3 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(500); };
  await ready(); await p.waitForTimeout(8000);
  const out = await run({ p, tap, ready });
  console.log(JSON.stringify(out, null, 1));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  await b.close(); process.exit(out.ok ? 0 : 1);
})();
