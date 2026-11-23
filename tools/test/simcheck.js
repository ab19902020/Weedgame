// Headed sanity run of the traffic simulation at a junction: counts moving / queued / stuck vehicles,
// lane changes, right-turn waits and signal stage changes over a period. Usage:
//   xvfb-run -a node tools/test/simcheck.js [spot=cemetery] [seconds=90] [sim=4]   (needs `npm run serve`)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const SPOTS = { cemetery: [-5890, -2190], woodley: [-2869, -2192], reading: [-7180, -2560] };
(async () => {
  const [spot = 'cemetery', secs = '90', sim = '4'] = process.argv.slice(2);
  const b = await chromium.launch({ headless: false });
  const p = await (await b.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '?backend=webgl'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + `?backend=webgl&fixedres=1&quality=low&sim=${sim}&fixeddt=0.1`);
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  await p.evaluate(([s, xy]) => { const dd = GC.manifest.districts.find(d => d.name.toLowerCase().startsWith(s)); const d = xy || [dd.x, dd.z]; GC.teleport(d[0], d[1]); }, [spot, SPOTS[spot] || null]);
  await p.waitForFunction(() => !GC._needGround, null, { timeout: 0, polling: 300 });
  const r = await p.evaluate(async secs => {
    const T = GC.traffic, S = GC.signals; const t0 = GC.time; const stages = new Map(); let laneCh = 0, rtw = 0; const lanes = new Map();
    const samples = [];
    while (GC.time - t0 < secs) {
      await new Promise(r => setTimeout(r, 250));
      for (const c of S.ctl) { const k = c.i; const prev = stages.get(k); if (prev && prev.s !== c.stage) prev.n++; stages.set(k, { s: c.stage, n: prev ? prev.n : 0 }); }
      for (const v of T.list) { if (v.parked || v.player) continue; const l = lanes.get(v.id); if (l != null && l[0] === v.h && l[1] !== v.lane) laneCh++; lanes.set(v.id, [v.h, v.lane]); if (v.rtWait > 0.5) rtw++; }
      GC.peds._seenCorner = (GC.peds._seenCorner || 0) + GC.peds.list.filter(q => q.corner).length; const mv = T.list.filter(v => !v.parked && !v.player && v.near);
      samples.push({ n: mv.length, moving: mv.filter(v => v.v > 1).length, stuck60: mv.filter(v => v.wait > 60).length, avgV: mv.length ? mv.reduce((a, v) => a + v.v, 0) / mv.length : 0 });
    }
    const modes = {}; let corners = 0; for (const q of GC.peds.list) { modes[q.mode] = (modes[q.mode] || 0) + 1; if (q.corner) corners++; }
    const peds = { count: GC.peds.list.length, modes, cornering: corners, cornerSamples: GC.peds._seenCorner, enteredBuildings: GC.peds.entered || 0, links: GC.walkGraph?.linkCount };
    const last = samples.at(-1), avg = k => +(samples.reduce((a, s) => a + s[k], 0) / samples.length).toFixed(2);
    let changes = 0, active = 0; for (const v of stages.values()) { changes += v.n; if (v.n) active++; }
    return { simSeconds: +(GC.time - t0).toFixed(0), nearVehicles: avg('n'), movingAvg: avg('moving'), avgSpeed: avg('avgV'), stuckOver60sAtEnd: last.stuck60, laneChanges: laneCh, rightTurnWaitSamples: rtw, signalStageChanges: changes, signalsCycling: active, peds };
  }, Number(secs));
  console.log(JSON.stringify({ spot, ...r, errors }));
  await b.close();
})();
