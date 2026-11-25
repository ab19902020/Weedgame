// Stations check: at every platform of every station, a train comes in, Board gets you on, and you ride to
// the next station and step off onto its platform.
// Usage: xvfb-run -a node tools/test/stations.js   (needs `npm run serve`; BASE=http://host:port/index.html)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
(async () => {
  const b = await chromium.launch({ headless: false, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
  const p = await (await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?backend=webgl&fixedres=1&quality=low&time=13');
  await p.waitForFunction(() => window.GC && GC.hud && GC.hud.menu, null, { timeout: 0, polling: 500 });
  await p.evaluate(() => GC.hud.menu.close());
  await p.waitForFunction(() => GC.frame > 3 && !GC._needGround && GC.stations?.platforms.length, null, { timeout: 0, polling: 500 });
  const list = await p.evaluate(() => GC.stations.platforms.map(q => [q.name, q.number]));
  const results = [];
  for (const [name, num] of list) results.push(await p.evaluate(async ([name, num]) => {
    const G = window.GC, S = G.stations, T = G.trains, pl = S.list.find(s => s.name === name).platforms.find(q => q.number === num);
    const frames = n => new Promise(res => { const f0 = G.frame, chk = () => G.frame >= f0 + n ? res() : requestAnimationFrame(chk); chk(); });
    G.transit.ride = null; G.teleport(pl.mid[0], pl.mid[2]);
    await new Promise(res => { const chk = () => (!G._needGround && G.tiles.pending.size === 0) ? res() : setTimeout(chk, 200); chk(); });
    const me = G.brothers.me, stand = () => { me.x = pl.mid[0]; me.z = pl.mid[2]; me.y = pl.mid[1]; };
    let k = 0; while (!S.trainAt(pl) && k++ < 5000) { T.t += 2; T.update(0); }
    const tr = S.trainAt(pl); if (!tr) return { name, num, ok: false, why: 'no train' };
    stand(); await frames(2); G.input.pressed.add('use'); await frames(3);
    if (G.transit.ride !== G.transit) return { name, num, ok: false, why: 'could not board' };
    const next = S.nextName(tr), s0 = tr.station; let g = 0;
    while (g++ < 6000 && !(tr.status !== 'running' && tr.station !== s0 && G.transit.moved)) { T.t += 1; T.update(0); if (g % 60 === 0) await frames(1); }
    await frames(2);
    if (G.transit.ride) { G.input.pressed.add('use'); await frames(3); }
    const there = S.platformAt(me.x, me.z, me.y);
    return { name, num, ok: !G.transit.ride && !!there && there.name === next, from: name, to: there?.name, expected: next };
  }, [name, num]));
  const out = { platforms: results.length, ok: results.filter(r => r.ok).length, failures: results.filter(r => !r.ok), errors };
  console.log(JSON.stringify(out, null, 1));
  await b.close(); process.exit(out.ok === out.platforms && !errors.length ? 0 : 1);
})();
