// Runs the Dev-panel perf flythrough in a browser by tapping its button, waits for the log and
// writes it to <outDir>/perf-flythrough-<backend>-<quality>.json.
// Usage: xvfb-run -a node tools/test/flythrough.js <outDir> [quality] [flyspeed m/s]   (needs `npm run serve`)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve(process.argv[2] || '/tmp/fly'); fs.mkdirSync(OUT, { recursive: true });
const quality = process.argv[3] || 'medium', speed = process.argv[4] || '';
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu'] });
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + `?backend=webgl&quality=${quality}${speed ? '&flyspeed=' + speed : ''}`);
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  const before = await p.evaluate(() => ({ x: GC.brothers.me.x, z: GC.brothers.me.z }));
  const tap = async sel => { const r = await p.locator(sel).first().boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 3 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(400); };
  await tap('#bDev'); await p.locator('#dev [data-act="perf-flythrough"]').scrollIntoViewIfNeeded(); await tap('#dev [data-act="perf-flythrough"]');
  if (!(await p.locator('#dev').isHidden())) await tap('#devX');
  const dl = p.waitForEvent('download', { timeout: 0 });
  await p.waitForFunction(() => GC.perf.fly.active, null, { timeout: 60000 });
  console.log('flythrough started', await p.evaluate(() => ({ km: GC.perf.fly.path.length / 1000, route: GC.perf.fly.path.route })));
  let lastLog = 0;
  while (await p.evaluate(() => GC.perf.fly.active)) { await p.waitForTimeout(5000); if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.log('  progress', await p.evaluate(() => (GC.perf.fly.progress() * 100).toFixed(0) + '%')); } }
  const d = await dl; const file = path.join(OUT, `perf-flythrough-${quality}.json`); await d.saveAs(file);
  const log = JSON.parse(fs.readFileSync(file, 'utf8'));
  await p.waitForFunction(() => !GC._needGround, null, { timeout: 0 });
  const after = await p.evaluate(() => ({ x: GC.brothers.me.x, z: GC.brothers.me.z, perfCar: GC.traffic.byId.has('perf-car') }));
  console.log(JSON.stringify({ file, completed: log.completed, routeKm: log.routeKm, seconds: log.seconds, summary: log.summary, legs: log.legs, gpu: log.gpu, backend: log.backend, restored: Math.hypot(after.x - before.x, after.z - before.z) < 1 && !after.perfCar }, null, 1));
  await b.close();
})();
