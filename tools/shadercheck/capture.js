// Opens www/test/wgsl.html on a WebGPU renderer and saves every generated WGSL module to $DUMP (see run.sh).
const { chromium } = require('playwright');
(async () => {
  const flags = (process.env.FLAGS || '').split(' ').filter(Boolean);
  const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', ...flags], env: { ...process.env, CHROMIUM_WEBGL_RENDERER: 'lavapipe' } });
  const p = await b.newPage();
  const out = [];
  p.on('console', m => out.push(m.type() + ': ' + m.text().slice(0, 1500)));
  p.on('pageerror', e => out.push('PAGEERR ' + e.message));
  await p.goto('http://localhost:8080/test/wgsl.html' + (process.env.QS || ''));
  try { await p.waitForFunction(() => /DONE|EXC/.test(document.body.textContent), null, { timeout: 600000 }); } catch (e) { out.push('TIMEOUT'); }
  const codes = await p.evaluate(() => window.__wgsl || []); require('fs').writeFileSync(process.env.DUMP || '/dev/null', JSON.stringify(codes)); out.push('captured ' + codes.length);
  console.log(out.filter(l => !/toNonIndexed|GPU stall/.test(l))
    .filter(l => !/Instance dropped/.test(l)).slice(0, 40).join('\n'));
  await b.close();
})();
