// Touch-driven landmark captures (dev-panel teleports + right-side camera drags only).
// Usage: xvfb-run -a node tools/test/landmarks.js docs/captures
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve(process.argv[2] || 'docs/captures');
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, CHROMIUM_WEBGL_RENDERER: 'lavapipe' } });
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 })) });
  const frames = async n => { const f0 = await p.evaluate(() => GC.frame); await p.waitForFunction(k => GC.frame >= k, f0 + n, { timeout: 0, polling: 100 }); };
  const tapAt = async (x, y) => { await touch('touchStart', [[x, y, 3]]); await touch('touchEnd', []); await frames(2); };
  const tapSel = async sel => { const r = await p.locator(sel).first().boundingBox(); await tapAt(r.x + r.width / 2, r.y + r.height / 2); };
  const dev = async (...labels) => { for (const l of labels) { if (await p.locator('#dev').isHidden()) await tapSel('#bDev'); const loc = p.locator('#dev button', { hasText: l }).first(); await loc.scrollIntoViewIfNeeded(); const r = await loc.boundingBox(); await tapAt(r.x + r.width / 2, r.y + r.height / 2); } if (!(await p.locator('#dev').isHidden())) await tapSel('#devX'); };
  const settle = async () => { await p.waitForFunction(() => !GC._needGround && !GC.tiles.busy && GC.tiles.pending.size === 0, null, { timeout: 0, polling: 300 }); await frames(4); };
  const look = async (dx, dy) => { const x = 620, y = 200; await touch('touchStart', [[x, y, 2]]); for (let k = 1; k <= 6; k++) await touch('touchMove', [[x + dx * k / 6, y + dy * k / 6, 2]]); await frames(1); await touch('touchEnd', []); await frames(2); };
  const face = async (x, z, pitchPx = 0) => { await settle(); for (let k = 0; k < 3; k++) { const d = await p.evaluate(([x, z]) => { const c = GC.brothers.cam, me = GC.brothers.me; let e = Math.atan2(me.z - z, me.x - x) - c.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return e; }, [x, z]); if (Math.abs(d) < 0.06) break; await look(Math.max(-280, Math.min(280, d / 0.0062)), 0); } if (pitchPx) await look(0, pitchPx); await frames(3); };
  const shot = async n => p.screenshot({ path: path.join(OUT, n + '.png') });
  await p.goto('http://localhost:8080/index.html?backend=webgl&fixedres=1'); await p.evaluate(() => localStorage.clear());
  await p.goto('http://localhost:8080/index.html?backend=webgl&fixedres=1');
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  await dev('clear', '12', 'Dry');
  const only = process.env.ONLY_L || 'L1,L2,L3,L4,L5';
  if (only.includes('L1')) { await dev('Cemetery Junction arch'); await face(-5816, -2188, -40); await shot('L1-cemetery-junction-gateway'); }
  if (only.includes('L2')) { await dev('Reading Town Hall (from The Forbury)'); await face(-7320, -2600, 50); await shot('L2-reading-town-hall'); }
  if (only.includes('L3')) { await dev('Woodley precinct'); await face(-2869, -2150); await shot('L3-woodley-precinct-canopies'); }
  if (only.includes('L4')) { await dev('Soak', 'rain', '21'); await frames(30); await settle(); await shot('L4-woodley-wet-night'); }
  if (only.includes('L5')) { await dev('Suttons Park Ave (A3290 flyover)', 'broken', '16', 'Dry'); await face(-5294, -2690, -30); await shot('L5-a3290-flyover-suttons-park-ave'); }
  console.log(fs.readdirSync(OUT).filter(f => f.startsWith('L')));
  await b.close();
})();
