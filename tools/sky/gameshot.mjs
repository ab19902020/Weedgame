// Screenshot the running game (npm run serve or tools/sky/preview.sh's server on :8099) after the world
// has streamed in.  node tools/sky/gameshot.mjs '?time=12&weather=broken' out.png [setupJS]
import { chromium } from 'playwright';
const [, , qs, out, setup] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 640) } });
p.on('pageerror', e => console.log('pageerror:', e.message));
p.on('console', m => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|favicon|404/.test(t)) console.log(m.type() + ':', t.slice(0, 300)); });
const base = process.env.BASE || 'http://localhost:8099/';
await p.goto(base + (qs.startsWith('?') ? qs : '?' + qs) + (qs.includes('backend=') ? '' : '&backend=webgl'));
const t0 = Date.now();
await p.waitForFunction(() => window.GC && window.GC.frame > 2 && window.GC.tiles && window.GC.tiles.pending.size === 0 && !window.GC._needGround, null, { timeout: 600000, polling: 1000 });
if (setup) await p.evaluate(setup);
const frames = Number(process.env.FRAMES || 12);
await p.waitForFunction(n => window.GC.frame > n, (await p.evaluate(() => window.GC.frame)) + frames, { timeout: 600000, polling: 500 });
const fpsProbe = await p.evaluate(async () => { const f0 = GC.frame, t = performance.now(); await new Promise(r => setTimeout(r, 15000)); return ((GC.frame - f0) / ((performance.now() - t) / 1000)).toFixed(2); });
console.log('fps (software GL):', fpsProbe);
await p.screenshot({ path: out, timeout: 240000 });
console.log('shot', out, 'after', Math.round((Date.now() - t0) / 1000), 's', await p.evaluate(() => JSON.stringify({ frame: GC.frame, backend: GC.backend, quality: GC.quality, hour: GC.world.hours().toFixed(2), state: GC.world.stateName() })));
await b.close();
