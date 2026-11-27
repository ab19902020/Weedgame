// Police checks (scripted through the game API, for development): long-route dispatch, broken-down car
// with recovery. Every case must resolve with control returned. (The police coming after you: tools/test/wanted.mjs.)
// Usage: xvfb-run -a node tools/test/police.js [cases=dispatch,breakdown]   (needs `npm run serve`)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const cases = (process.argv[2] || 'dispatch,breakdown').split(',');
(async () => {
  const b = await chromium.launch({ headless: false });
  const p = await (await b.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?backend=webgl&fixedres=1&quality=low&sim=8&fixeddt=0.1&time=13');
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  const res = {};
  const go = async (x, z) => { await p.evaluate(([x, z]) => GC.teleport(x, z), [x, z]); await p.waitForFunction(() => !GC._needGround, null, { timeout: 0, polling: 300 }); };
  const simWait = async (secs, cond) => p.evaluate(async ([secs, cond]) => { const f = new Function('return (' + cond + ')'); const t0 = GC.time; while (GC.time - t0 < secs) { if (f()) return +(GC.time - t0).toFixed(0); await new Promise(r => setTimeout(r, 200)); } return -1; }, [secs, cond]);
  if (cases.includes('dispatch')) {
    // Wokingham has no beat car of its own: the response comes from a neighbouring beat (long route)
    const d = await p.evaluate(() => GC.manifest.districts.find(d => /Wokingham/.test(d.name)) || GC.manifest.districts[0]);
    await go(d.x, d.z); await simWait(20, 'false');
    const inc = await p.evaluate(() => { const i = GC.police.stageCollision(); if (!i) return null; i.callAt = 2; return { id: i.id, x: i.x, z: i.z }; });
    if (!inc) res.dispatch = { ok: false, why: 'no collision could be staged' };
    else {
      const resp = await simWait(60, `GC.police.incidents.find(i => i.id === ${inc.id})?.status === 'responding'`);
      const info = await p.evaluate(id => { const i = GC.police.incidents.find(i => i.id === id); const u = i?.unit; return u ? { unit: u.id, dist: Math.round(Math.hypot(u.x - i.x, u.z - i.z)), routeLen: Math.round(u.routeLen || 0), routed: GC.police.routed, fails: GC.police.routeFails || 0 } : null; }, inc.id);
      const arrive = await simWait(900, `(() => { const i = GC.police.incidents.find(i => i.id === ${inc.id}); return !i || i.status === 'onscene' || i.status === 'cleared'; })()`);
      const st = await p.evaluate(id => GC.police.incidents.find(i => i.id === id)?.status || 'gone', inc.id);
      const clear = await simWait(200, `(() => { const i = GC.police.incidents.find(i => i.id === ${inc.id}); return !i || i.status === 'cleared'; })()`);
      res.dispatch = { ok: resp >= 0 && arrive >= 0 && clear >= 0 && st === 'onscene', respondingAfter: resp, ...info, arrivedAfterSimS: arrive, statusOnArrival: st, clearedAfter: clear };
    }
  }
  if (cases.includes('breakdown')) {
    await go(-7180, -2560); await simWait(25, 'false');
    const inc = await p.evaluate(() => { const i = GC.police.stageBreakdown(); return i ? { id: i.id, car: i.parties[0] } : null; });
    if (!inc) res.breakdown = { ok: false, why: 'no candidate' };
    else {
      const on = await simWait(900, `GC.police.incidents.find(i => i.id === ${inc.id})?.status === 'onscene'`);
      const truck = await simWait(400, `!!GC.police.incidents.find(i => i.id === ${inc.id})?.truck`);
      const trace = await p.evaluate(async ([id, car]) => { const out = []; const t0 = GC.time; while (GC.time - t0 < 120) { await new Promise(r => setTimeout(r, 2000)); const i = GC.police.incidents.find(i => i.id === id); if (!i || i.status === 'cleared') break; const t = i.truck, c = GC.traffic.byId.get(car); if (!t || !c) continue; out.push([Math.round(GC.time - t0), Math.round(Math.hypot(t.x - c.x, t.z - c.z)), +t.v.toFixed(1), t.h === c.h, t.ri + '/' + t.route.length, +t.stuck.toFixed(1), t.dead ? 'dead' : '', !!t.passing]); } return out; }, [inc.id, inc.car]);
      if (process.env.TRACE) console.error(JSON.stringify(trace));
      const done = await simWait(500, `(() => { const i = GC.police.incidents.find(i => i.id === ${inc.id}); return !i || i.status === 'cleared'; })()`);
      const info = await p.evaluate(([id, car]) => { const i = GC.police.incidents.find(i => i.id === id); return { how: i?.resolvedHow, carStillThere: GC.traffic.byId.has(car) && GC.traffic.byId.get(car).brokenDown, unitStatus: i?.unit?.status }; }, [inc.id, inc.car]);
      res.breakdown = { ok: on >= 0 && done >= 0 && !info.carStillThere, onsceneAfter: on, truckAfter: truck, clearedAfter: done, ...info };
    }
  }
  console.log(JSON.stringify({ ...res, errors }, null, 1));
  await b.close();
})();
