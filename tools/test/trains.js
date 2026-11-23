// Trains check: lines loaded, a train calls at a station near the player and is drawn there.
// Usage: xvfb-run -a node tools/test/trains.js [station=Earley] [shot.png]   (needs `npm run serve`)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const station = process.argv[2] || 'Earley', shot = process.argv[3] || '';
(async () => {
  const b = await chromium.launch({ headless: false });
  const p = await (await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?backend=webgl&fixedres=1&quality=low&time=13');
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '' && GC.trains?.ready, null, { timeout: 0, polling: 500 });
  const st = await p.evaluate(n => GC.trains.stations.find(s => s.name === n), station);
  await p.evaluate(([x, z]) => GC.teleport(x + 25, z + 25), [st.x, st.z]);
  await p.waitForFunction(() => !GC._needGround, null, { timeout: 0, polling: 300 });
  const lines = await p.evaluate(() => GC.trains.lines.map(l => ({ name: l.name, km: +(l.len / 1000).toFixed(1), stops: l.stops.length, trains: GC.trains.trains.filter(t => t.line === l).length, cycleMin: +(l.cycle / 60).toFixed(1) })));
  // jump the train clock to just before the next call here, then watch it arrive and leave
  const r = await p.evaluate(async ([sx, sz]) => {
    const T = GC.trains, near = () => T.list().filter(t => Math.hypot(t.x - sx, t.z - sz) < 120);
    let k = 0; while (!near().some(t => t.status === 'at station') && k++ < 20000) { T.t += 5; T.update(0); }
    T.t -= 60; const seen = [];
    const t0 = GC.time; while (GC.time - t0 < 150) { await new Promise(r => requestAnimationFrame(r)); const n = near(); if (n.length) seen.push({ t: +(GC.time - t0).toFixed(0), drawn: T.drawn, ...n[0] }); }
    return { arrivals: seen.filter(s => s.status === 'at station').length, drawnMax: Math.max(0, ...seen.map(s => s.drawn)), first: seen[0], last: seen.at(-1), statuses: [...new Set(seen.map(s => s.status))] };
  }, [st.x, st.z]);
  if (shot) { await p.evaluate(async () => { const T = GC.trains; }); await p.screenshot({ path: shot }); }
  const out = { station: st, lines, ...r, ok: r.arrivals > 0 && r.drawnMax > 0 && errors.length === 0, errors };
  console.log(JSON.stringify(out, null, 1));
  await b.close(); process.exit(out.ok ? 0 : 1);
})();
