// Builds the same materials on the WebGL2 backend and fails if any GLSL program does not compile or link.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: false, env: { ...process.env, CHROMIUM_WEBGL_RENDERER: 'lavapipe' } });
  const p = await b.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && /Shader Error|ERROR:/.test(m.text())) errs.push(m.text()); });
  await p.goto('http://localhost:8080/test/wgsl.html?webgl');
  await p.waitForFunction(() => /DONE|EXC/.test(document.body.textContent), null, { timeout: 600000 });
  const body = await p.evaluate(() => document.body.textContent);
  for (const e of errs.slice(0, 4)) console.log(e.split('\n').filter(l => /ERROR:|Shader Error/.test(l)).slice(0, 6).join('\n'));
  console.log(body.includes('EXC') ? body.slice(0, 800) : '', `GLSL: ${errs.length} failing program(s)`);
  await b.close();
  process.exit(errs.length || body.includes('EXC') ? 1 : 0);
})();
