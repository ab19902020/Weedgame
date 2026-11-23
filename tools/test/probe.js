// Draw-call / triangle / frame-time probe at fixed spots (dev tool, not part of acceptance).
// Usage: [OUT=file.json] xvfb-run -a node tools/test/probe.js [quality] [spots...]   (needs `npm run serve`)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const quality = process.argv[2] || 'medium';
const SPOTS = { woodley: [-2869, -2192, -1.57], cemetery: [-5890, -2190, 0], reading: [-7180, -2560, 3.14], a3290: [-5372, -2681, 0] };
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + `?backend=webgl&fixedres=1&quality=${quality}`);
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  const out = { quality, gl, spots: {} };
  for (const name of (process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SPOTS))) {
    const [x, z, h] = SPOTS[name];
    await p.evaluate(([x, z, h]) => GC.teleport(x, z, h), [x, z, h]);
    await p.waitForFunction(() => !GC._needGround, null, { timeout: 0, polling: 200 });
    for (let k = 0; k < 40; k++) { await p.waitForTimeout(500); if (await p.evaluate(() => !GC.tiles.busy && GC.tiles.pending.size === 0)) break; }
    const r = await p.evaluate(async () => {
      const f0 = GC.frame, t0 = performance.now(); const calls = [], tris = [];
      while (GC.frame < f0 + 12) { await new Promise(r => setTimeout(r, 30)); calls.push(GC.perf.info().calls); tris.push(GC.perf.info().tris); }
      const M = GC.tiles.mats, names = new Map(Object.entries(M).map(([k, v]) => [v, k])); const tally = {};
      GC.scene.traverse(o => { if (o.isMesh && !o.userData.k) o.userData.k = names.get(o.material) || (o.material === GC.tiles.signAtlas.material ? 'signs' : (o.parent && o.parent !== GC.scene ? 'sub:' : '') + (o.isInstancedMesh ? 'inst:' : '') + (o.material?.name || o.material?.type)); });
      const orig = GC.renderer.info.update; GC.renderer.info.update = function (o, c, i) { tally[o.userData.k || '?'] = (tally[o.userData.k || '?'] || 0) + 1; return orig.call(this, o, c, i); };
      const f1 = GC.frame; while (GC.frame < f1 + 1) await new Promise(r => setTimeout(r, 20)); for (const k in tally) delete tally[k]; const f2 = GC.frame; while (GC.frame < f2 + 1) await new Promise(r => setTimeout(r, 20));
      GC.renderer.info.update = orig;
      let meshes = 0, vis = 0; GC.scene.traverse(o => { if (o.isMesh) { meshes++; } });
      return { tally, rb: GC.perf.render.stats, calls: Math.max(...calls), tris: Math.max(...tris), msPerFrame: +((performance.now() - t0) / 12).toFixed(0), meshes, tiles: GC.tiles.tiles.size, lod0: [...GC.tiles.tiles.values()].filter(t => t.lod === 0).length, pr: GC.renderer.getPixelRatio(), vehicles: GC.traffic.list.length, peds: GC.peds.list.length };
    });
    out.spots[name] = r; console.log(name, JSON.stringify(r));
  }
  console.log(JSON.stringify(out));
  if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  await b.close();
})();
