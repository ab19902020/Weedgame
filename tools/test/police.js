// Police checks (scripted through the game API, for development): long-route dispatch, broken-down car
// with recovery, foot chase, off-road pursuit. Every case must resolve with control returned.
// Usage: xvfb-run -a node tools/test/police.js [cases=dispatch,breakdown,foot,offroad]   (needs `npm run serve`)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const cases = (process.argv[2] || 'dispatch,breakdown,foot,offroad').split(',');
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
  if (cases.includes('foot')) {
    const o = await p.evaluate(() => { const o = GC.police.officers.find(o => !o.leader); return { x: o.x, z: o.z, id: o.id }; });
    await go(o.x, o.z); await simWait(3, 'false');
    // an offence in sight of the officer, then walk away: scripted state, movement by driving the brother's position
    const r = await p.evaluate(async () => {
      const P = GC.police, o = P.officers.find(o => !o.leader), me = GC.brothers.me;
      me.x = o.x + 6; me.z = o.z; P.onOffence('a disturbance (test)', me.x, me.z, 1);
      const states = [P.player.state];
      // run away (real input: stick forward + Run, camera turned so forward points away from the officer)
      const dir = Math.atan2(me.z - o.z, me.x - o.x), I = GC.input, ax = I.axis.bind(I);
      I.axis = () => ({ x: 0, y: -1 }); I.held.add('run'); GC.brothers.cam.yaw = dir + Math.PI; GC.brothers.cam.lastUser = GC.time;
      let t0 = GC.time;
      while (GC.time - t0 < 8) { GC.brothers.cam.yaw = dir + Math.PI; await new Promise(r => requestAnimationFrame(r)); if (states.at(-1) !== P.player.state) states.push(P.player.state); }
      // stop and wait to be caught
      I.axis = () => ({ x: 0, y: 0 }); I.held.delete('run');
      t0 = GC.time; while (GC.time - t0 < 90 && P.player.state !== 'none') { await new Promise(r => requestAnimationFrame(r)); if (states.at(-1) !== P.player.state) states.push(P.player.state); }
      I.axis = ax;
      return { states, final: P.player.state };
    });
    res.foot = { ok: r.states.includes('footchase') && r.final === 'none', ...r };
  }
  if (cases.includes('offroad')) {
    const r = await p.evaluate(async () => {
      const G = GC, P = G.police, u = P.units[0], net = G.net;
      // find a spot well away from drivable roads (a park / field) near this unit
      let spot = null;
      for (let k = 0; k < 400 && !spot; k++) { const a = k * 0.7, rr = 60 + k * 3; const x = u.x + Math.cos(a) * rr, z = u.z + Math.sin(a) * rr; if (!net.nearest(x, z, 40, e => net.flags[e] & 16) && net.nearest(x, z, 140, e => net.flags[e] & 16) && !G.tiles.insideBuilding(x, z)) spot = [x, z]; }
      if (!spot) return { ok: false, why: 'no off-road spot' };
      // put the player there in a car with the unit in pursuit
      const me = G.brothers.me; me.x = spot[0]; me.z = spot[1];
      const road = net.nearest(spot[0], spot[1], 140, e => net.flags[e] & 16);
      u.h = road.e * 2; u.s = road.s; u.route = [u.h]; u.ri = 0; G.traffic.place(u);
      P.player.state = 'pursuit'; P.player.unit = u; P.player.t = 0; u.status = 'pursuit'; u.siren = true;
      const states = []; let off = false, minD = 1e9; const t0 = G.time;
      while (G.time - t0 < 90) { G.brothers.speedNow = 0; await new Promise(r => requestAnimationFrame(r)); off = off || !!u.offroad; minD = Math.min(minD, Math.hypot(u.x - me.x, u.z - me.z)); if (states.at(-1) !== P.player.state) states.push(P.player.state); if (P.player.state === 'none' && G.time - t0 > 5) break; }
      // make sure it is back on the graph after resolution
      const t1 = G.time; while (G.time - t1 < 50 && u.offroad) await new Promise(r => requestAnimationFrame(r));
      return { wentOffroad: off, closestM: Math.round(minD), states, final: P.player.state, unitBackOnRoad: !u.offroad };
    });
    res.offroad = { ok: r.wentOffroad && r.final === 'none' && r.unitBackOnRoad, ...r };
  }
  console.log(JSON.stringify({ ...res, errors }, null, 1));
  await b.close();
})();
