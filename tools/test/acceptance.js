// Acceptance run driven only through touch input (CDP Input.dispatchTouchEvent) on the
// on-screen joystick, camera drag and HUD/Dev buttons. Writes screenshots, a video and a JSON log.
// Usage: xvfb-run -a node tools/test/acceptance.js <outDir> [baseUrl]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve(process.argv[2] || 'docs/captures');
const BASE = process.argv[3] || 'http://localhost:8080/index.html';
fs.mkdirSync(OUT, { recursive: true });
const log = { started: new Date().toISOString(), steps: [], environment: {} };
const MISSION = /mission|objective|deliver|incoming call|answer call|order complete|grow room|harvest|sell flower/i;

async function launch(video) {
  const b = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, CHROMIUM_WEBGL_RENDERER: 'lavapipe' } });
  const ctx = await b.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, ...(video ? { recordVideo: { dir: video, size: { width: 915, height: 412 } } } : {}) });
  // the start menu opens on every load: tap "Enter free roam" (or "Resume") as a player would
  await ctx.addInitScript(() => { const iv = setInterval(() => { const b = document.querySelector('[data-go="play"]'); if (b && b.offsetWidth && window.GC && GC.hud && GC.hud.menu) { b.click(); clearInterval(iv); } }, 400); });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  // software rendering (SwiftShader) can stall a frame for tens of seconds; give Playwright actions room
  p.setDefaultTimeout(180000);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  const devHidden = () => p.evaluate(() => { const e = document.getElementById('dev'); return !e || e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden' || !e.getClientRects().length; });
  const T = {
    b, ctx, p, cdp, errors,
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id ?? 1, radiusX: 6, radiusY: 6, force: 1 })) }),
    frames: async n => { const f0 = await p.evaluate(() => GC.frame); await p.waitForFunction(k => GC.frame >= k, f0 + n, { timeout: 0, polling: 100 }); },
    runPt: null,
    stickHold: async (sx, sy, run) => {
      const ox = 140, oy = 300;
      // driving: the left thumb steers (drag sideways) and the right thumb is on the accelerator or the brake
      if (await p.evaluate(() => !!GC.brothers.me.vehicle && !GC.transit.ride)) {
        T.car = { gas: await T.rect('#pGas'), brake: await T.rect('#pBrake') };
        const ped = T.pedalPt(sy);
        await T.touch('touchStart', [[ox, oy, 1], ...ped]); await T.touch('touchMove', [[ox + sx * 42, oy, 1], ...ped]); await T.touch('touchMove', [[ox + sx * 84, oy, 1], ...ped]);
        return;
      }
      T.car = null;
      let extra = [];
      if (run) { const r = await T.rect('#bRun'); T.runPt = [r.x + r.width / 2, r.y + r.height / 2, 4]; extra = [T.runPt]; } else T.runPt = null;
      await T.touch('touchStart', [[ox, oy, 1], ...extra]); await T.touch('touchMove', [[ox + sx * 30, oy + sy * 30, 1], ...extra]); await T.touch('touchMove', [[ox + sx * 55, oy + sy * 55, 1], ...extra]);
    },
    // the right thumb stays down: on the accelerator, on the brake, or slid off both (coasting)
    pedalPt: sy => { const r = sy < -0.05 ? T.car.gas : sy > 0.05 ? T.car.brake : null; return [r ? [r.x + r.width / 2, r.y + r.height * 0.6, 6] : [T.car.gas.x - 150, T.car.gas.y - 170, 6]]; },
    stickMove: async (sx, sy) => T.car ? T.touch('touchMove', [[140 + sx * 84, 300, 1], ...T.pedalPt(sy)]) : T.touch('touchMove', [[140 + sx * 55, 300 + sy * 55, 1], ...(T.runPt ? [T.runPt] : [])]),
    stickRelease: async () => T.touch('touchEnd', []),
    stick: async (sx, sy, n, run) => { await T.stickHold(sx, sy, run); await T.frames(n); await T.stickRelease(); T.runPt = null; T.car = null; },
    look: async (dx, dy = 0) => { const x = 620, y = 200; await T.touch('touchStart', [[x, y, 2]]); for (let k = 1; k <= 6; k++) await T.touch('touchMove', [[x + dx * k / 6, y + dy * k / 6, 2]]); await T.frames(1); await T.touch('touchEnd', []); },
    // hold the brake pedal until the vehicle has stopped
    stopVehicle: async () => {
      const r = await T.rect('#pBrake'); const pt = [r.x + r.width / 2, r.y + r.height / 2, 5];
      await T.touch('touchStart', [pt]);
      for (let i = 0; i < 60; i++) { const sp = await p.evaluate(() => Math.abs(GC.brothers.vehicleOf(GC.brothers.me)?.sp || 0)); if (sp < 0.3) break; await T.frames(1); }
      await T.touch('touchEnd', []); await T.frames(1);
    },
    // turn the camera (right-side touch drag) so it looks towards a world point
    face: async (x, z) => {
      await p.waitForFunction(() => !GC._needGround && !GC.tiles.busy, null, { timeout: 0, polling: 200 }); await T.frames(2);
      for (let k = 0; k < 3; k++) {
        const d = await p.evaluate(([x, z]) => { const c = GC.brothers.cam, me = GC.brothers.me; const want = Math.atan2(me.z - z, me.x - x); let e = want - c.yaw; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return e; }, [x, z]);
        if (Math.abs(d) < 0.08) break;
        const px = Math.max(-280, Math.min(280, d / 0.0062));
        await T.look(px, 0);
      }
    },
    tapAt: async (x, y) => { await T.touch('touchStart', [[x, y, 3]]); await T.touch('touchEnd', []); },
    // element rect via page.evaluate (no actionability timeout: at ~1 fps under software rendering a frame can stall the main thread for >30 s)
    rect: async sel => { for (let k = 0; k < 5; k++) { const r = await p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; }, sel); if (r) return r; await p.waitForTimeout(500); } return null; },
    tap: async sel => { const r = await T.rect(sel); if (!r) throw new Error('no ' + sel); await T.tapAt(r.x + r.width / 2, r.y + r.height / 2); await T.frames(2); },
    dev: async (...acts) => { // open the developer panel and tap buttons by their stable data-act id
      for (const act of acts) {
        if (await devHidden()) await T.tap('#bDev');
        const r = await T.rect(`#dev button[data-act="${act}"]`); if (!r) throw new Error('no visible dev button with data-act=' + act);
        await T.tapAt(r.x + r.width / 2, r.y + r.height / 2); await T.frames(2);
      }
      if (!(await devHidden())) { const r = await T.rect('#devX'); await T.tapAt(r.x + r.width / 2, r.y + r.height / 2); await T.frames(1); }
    },
    state: () => p.evaluate(() => { const B = GC.brothers, me = B.me, v = B.vehicleOf(me); return { brother: me.short, x: +me.x.toFixed(1), y: +me.y.toFixed(2), z: +me.z.toFixed(1), heading: +me.heading.toFixed(2), vehicle: me.vehicle, speed: +(B.speedNow || 0).toFixed(2), road: GC.roadName(me.x, me.z), district: GC.districtName(me.x, me.z), time: new Date(GC.world.time * 1000).toISOString(), hour: +GC.world.hours().toFixed(2), weather: GC.world.stateName(), rain: +GC.world.cur.rain.toFixed(2), cover: +GC.world.cur.cover.toFixed(2), wet: +GC.world.s.wet.toFixed(3), puddle: +GC.world.s.puddle.toFixed(3), police: GC.police.player.state, fps: GC.perf.samples.at(-1)?.fps ?? null, backend: GC.backend, frame: GC.frame }; }),
    shot: async name => { const file = path.join(OUT, name + '.png'); try { await p.screenshot({ path: file, timeout: 180000 }); } catch (e) { await p.waitForTimeout(2000); await p.screenshot({ path: file, timeout: 180000 }); } return name + '.png'; },
    text: () => p.evaluate(() => document.body.innerText),
    // drive the stick so the brother/vehicle heads to a world point (re-evaluated every burst)
    // straight-line stick steering towards a world point (re-evaluated every burst)
    walkStraight: async (x, z, opts = {}) => {
      for (let i = 0; i < (opts.bursts || 30); i++) {
        const s = await p.evaluate(([x, z]) => { const B = GC.brothers, me = B.me, yaw = B.cam.yaw; const wx = x - me.x, wz = z - me.z, d = Math.hypot(wx, wz); const fx = -Math.cos(yaw), fz = -Math.sin(yaw); const ux = wx / d, uz = wz / d; return { d, sx: -ux * fz + uz * fx, sy: -(ux * fx + uz * fz) }; }, [x, z]);
        if (s.d < (opts.within || 1.5)) return s.d;
        await T.stick(s.sx, s.sy, Math.min(opts.frames || 6, Math.ceil(s.d / (opts.run ? 1.2 : 0.4))), opts.run && s.d > 6);
      }
      return -1;
    },
    // walk to a world point along the walk graph (pavements, footways, links), still only via the stick.
    // straight: true keeps the old straight-line behaviour (collision and crossing steps need it).
    walkTo: async (x, z, opts = {}) => {
      if (opts.straight) return T.walkStraight(x, z, opts);
      const plan = await p.evaluate(([x, z]) => { const me = GC.brothers.me, d = Math.hypot(x - me.x, z - me.z); if (d < 25 || !GC.walkGraph) return null; const r = GC.walkGraph.path(me.x, me.z, x, z); if (!r || r.length > d * 3 + 150) return null;
        const out = []; let acc = 0; for (let i = 1; i < r.pts.length - 1; i++) { acc += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); if (acc > 10) { out.push(r.pts[i]); acc = 0; } } return out; }, [x, z]);
      T.lastPlan = plan ? plan.length : 0;
      if (plan) for (const [wx, wz] of plan) {
        const left = await p.evaluate(([x, z]) => Math.hypot(x - GC.brothers.me.x, z - GC.brothers.me.z), [x, z]);
        if (left < 12) break;
        await T.walkStraight(wx, wz, { ...opts, within: 3, bursts: 6 });
      }
      return T.walkStraight(x, z, opts);
    },
    driveAlong: async (targets, opts = {}) => { // steer a vehicle through world points
      const trace = [];
      await T.stickHold(0, -0.6);
      for (const [x, z] of targets) {
        for (let i = 0; i < 400; i++) {
          const s = await p.evaluate(([x, z]) => { const B = GC.brothers, me = B.me, v = B.vehicleOf(me); const d = Math.hypot(x - v.x, z - v.z); let err = Math.atan2(z - v.z, x - v.x) - v.heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI; const decks = GC.net.decks(v.x, v.z, []); return { d, err, sp: v.sp, x: v.x, y: v.y, z: v.z, road: GC.roadName(v.x, v.z), district: GC.districtName(v.x, v.z), overhead: decks.filter(h => h > v.y + 3).map(h => +h.toFixed(1)) }; }, [x, z]);
          trace.push(s);
          if (s.overhead.length && !T._underShot) { T._underShot = true; await T.shot('14a-beneath-the-a3290'); }
          if (s.d < 8) break;
          const thr = s.sp > (opts.maxSpeed || 11) ? 0 : -0.75;
          await T.stickMove(Math.max(-1, Math.min(1, s.err * 1.6)), thr);
          await T.frames(1);
        }
      }
      await T.stickRelease();
      return trace;
    },
  };
  return T;
}
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
async function step(name, fn) {
  if (ONLY && !name.startsWith('Launch') && !ONLY.some(k => name.toLowerCase().includes(k))) return;
  const t0 = Date.now(); const rec = { name, ok: true, notes: [], shots: [] };
  console.log('== ' + name);
  try { await fn(rec); rec.ok = rec.fail == null; } catch (e) { rec.ok = false; rec.error = String(e.stack || e).slice(0, 800); console.log('   ERROR', rec.error); }
  rec.seconds = Math.round((Date.now() - t0) / 1000); log.steps.push(rec); fs.writeFileSync(path.join(OUT, 'acceptance.json'), JSON.stringify(log, null, 1));
  console.log('   ->', rec.ok ? 'ok' : 'FAILED', JSON.stringify(rec.notes).slice(0, 400));
}

(async () => {
  const vdir = path.join(OUT, 'video-tmp');
  const T = await launch(vdir);
  const { p } = T;
  await p.goto(BASE + '?backend=webgl');
  await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?backend=webgl&sim=2&fixedres=1');
  await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
  await T.frames(8);
  log.environment = await p.evaluate(() => ({ userAgent: navigator.userAgent, backend: GC.backend, quality: GC.quality, gl: (() => { try { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch { return null; } })(), viewport: [innerWidth, innerHeight] }));

  await step('Launch straight into free roam in Woodley', async rec => {
    const s = await T.state(); rec.state = s;
    rec.shots.push(await T.shot('01-launch-woodley-precinct'));
    const txt = await T.text();
    rec.notes.push(`Started as ${s.brother} on ${s.road}, ${s.district}`);
    if (s.district !== 'Woodley') rec.fail = 'not in Woodley';
    if (MISSION.test(txt)) rec.fail = 'mission-like text on screen: ' + txt.match(MISSION)[0];
  });

  await step('Walk into and around a solid building (collision)', async rec => {
    const a = await T.state();
    // head west into the shop row: the wall should stop us
    const r = await p.evaluate(() => { const me = GC.brothers.me; let hit = null; GC.tiles.buildingsNear(me.x, me.z, 30, (P, s, n) => { if (!hit) hit = [P[s * 2], P[s * 2 + 1]]; }); return hit; });
    await T.walkTo(a.x - 30, a.z, { bursts: 8, frames: 8, within: 0.5, straight: true });
    const b = await T.state();
    const inside = await p.evaluate(() => !!GC.tiles.insideBuilding(GC.brothers.me.x, GC.brothers.me.z, GC.brothers.me.y));
    rec.shots.push(await T.shot('02-against-shop-wall'));
    rec.notes.push(`tried to walk 30 m west from x=${a.x}; stopped at x=${b.x} (moved ${(a.x - b.x).toFixed(1)} m), inside building: ${inside}`);
    // slide north along the wall, then east around the end of the row
    await T.walkTo(b.x - 5, b.z - 40, { bursts: 6, frames: 8, straight: true });
    const c = await T.state();
    rec.notes.push(`slid along the facade to z=${c.z}`);
    if (inside) rec.fail = 'ended inside a building';
    await T.look(-260); await T.frames(2);
    rec.shots.push(await T.shot('03-shop-row-from-precinct'));
  });

  await step('Cross at a working signal (Woodley)', async rec => {
    await T.dev('spot-woodley-signal-crossing'); await T.frames(12);
    const info = await p.evaluate(() => { const me = GC.brothers.me; let best = null, bd = 1e9; for (const h of GC.signalRenderer.heads) if (h.ped) { const d = Math.hypot(h.x - me.x, h.z - me.z); if (d < bd) { bd = d; best = h; } } const pair = GC.signalRenderer.heads.filter(h => h.ped && h.ci === best.ci); let far = pair.filter(h => h !== best).sort((a, b) => Math.hypot(a.x - best.x, a.z - best.z) - Math.hypot(b.x - best.x, b.z - best.z)).find(h => Math.hypot(h.x - best.x, h.z - best.z) > 4) || pair[1]; return { ci: best.ci, a: [best.x, best.z], b: [far.x, far.z] }; });
    rec.notes.push(`controller ${info.ci}: kerb A ${info.a.map(v => v.toFixed(1))}, kerb B ${info.b.map(v => v.toFixed(1))}`);
    for (let k = 0; k < 3; k++) { const d = await T.walkTo(info.a[0], info.a[1], { within: 1.2, bursts: 20, straight: true }); if (d >= 0) break; }
    const dA = await p.evaluate(a => Math.hypot(GC.brothers.me.x - a[0], GC.brothers.me.z - a[1]), info.a);
    rec.notes.push(`standing ${dA.toFixed(1)} m from the crossing post`);
    await T.frames(4);
    const timeline = [];
    let walk = false;
    for (let i = 0; i < 160 && !walk; i++) {
      const st = await p.evaluate(ci => ({ ped: GC.signals.ped(ci), veh: GC.signals.ctl[ci].stages.map((s, k) => s.kind === 'veh' ? GC.signals.aspect(ci, s.g) : 'P').join(''), demand: GC.signals.ctl[ci].demand, t: +GC.signals.t.toFixed(1) }), info.ci);
      if (!timeline.length || timeline.at(-1).ped !== st.ped || timeline.at(-1).veh !== st.veh) timeline.push(st);
      if (i === 3) rec.shots.push(await T.shot('04-waiting-red-man'));
      walk = st.ped === 'walk';
      if (!walk) await T.frames(2);
    }
    rec.timeline = timeline;
    if (!walk) { rec.fail = 'green man never appeared'; return; }
    rec.shots.push(await T.shot('05-green-man'));
    const before = await T.state();
    await T.walkTo(info.b[0], info.b[1], { within: 1.5, bursts: 12, frames: 5, straight: true });
    const after = await T.state();
    rec.shots.push(await T.shot('06-crossed'));
    const vehDuring = await p.evaluate(ci => GC.signals.ctl[ci].stages.map((s) => s.kind === 'veh' ? GC.signals.aspect(ci, s.g) : 'P').join(''), info.ci);
    rec.notes.push(`crossed ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m on the green man; vehicle aspects while crossing: ${vehDuring}`);
  });

  await step('Watch a pedestrian and a bus complete a junction (Cemetery Junction)', async rec => {
    await T.dev('spot-cemetery-junction-arch', 'sim-8'); await T.frames(15);
    await T.face(-5816, -2188); await T.frames(2);
    rec.shots.push(await T.shot('07-cemetery-junction-arch'));
    const J = { x: -5845.7, z: -2188.9 };
    let bus = null, busTrack = [], pedTrack = [], ped = null;
    for (let i = 0; i < 260; i++) {
      const s = await p.evaluate(J => {
        const buses = GC.traffic.list.filter(v => v.kind === 'bus').map(v => ({ id: v.id, ref: v.ref, x: v.x, z: v.z, h: v.h, v: v.v, d: Math.hypot(v.x - J.x, v.z - J.z) }));
        const crossing = GC.peds.list.filter(p => (p.mode === 'cross' || p.mode === 'waitCross') && Math.hypot(p.x - J.x, p.z - J.z) < 90).map(p => ({ id: p.id, mode: p.mode, x: p.x, z: p.z, kind: p.cross?.kind }));
        return { buses, crossing, t: GC.time };
      }, J);
      if (!bus) { const b = s.buses.filter(b => b.d < 260).sort((a, b) => a.d - b.d)[0]; if (b) bus = b.id; }
      const b = s.buses.find(b => b.id === bus); if (b) busTrack.push([+b.x.toFixed(1), +b.z.toFixed(1), +b.d.toFixed(1), b.ref, +b.v.toFixed(1)]);
      if (!ped) { const c = s.crossing.find(c => c.mode === 'cross'); if (c) ped = c.id; }
      const pc = s.crossing.find(c => c.id === ped); pedTrack.push(pc ? pc.mode : (ped ? 'done' : null));
      const busPassed = busTrack.length > 3 && Math.min(...busTrack.map(t => t[2])) < 30 && busTrack.at(-1)[2] > 40 && busTrack.findIndex(t => t[2] < 30) < busTrack.length - 1;
      const pedDone = ped && pedTrack.at(-1) === 'done';
      if (i % 40 === 20) rec.shots.push(await T.shot('08-junction-' + i));
      if (busPassed && pedDone) break;
      await T.frames(2);
    }
    rec.bus = { id: bus, track: busTrack.filter((_, k) => k % 3 === 0) }; rec.ped = { id: ped, modes: [...new Set(pedTrack.filter(Boolean))] };
    const minD = busTrack.length ? Math.min(...busTrack.map(t => t[2])) : null;
    rec.notes.push(`bus ${bus} (${busTrack[0]?.[3] || '?'}) closest approach ${minD} m, last distance ${busTrack.at(-1)?.[2]} m`);
    rec.notes.push(`pedestrian ${ped} crossing states: ${rec.ped.modes.join(' -> ')}`);
    if (!bus || !(minD < 30) || !(busTrack.at(-1)[2] > 40)) rec.fail = 'no bus completed the junction in the time allowed';
    if (!ped) rec.fail = (rec.fail ? rec.fail + '; ' : '') + 'no pedestrian crossing observed';
    await T.dev('sim-2');
  });

  let parked = null;
  await step('Park, switch brothers, drive to Reading, return and find the car', async rec => {
    await T.dev('spot-woodley-precinct'); await T.frames(12);
    const car = await p.evaluate(() => { const v = GC.traffic.byId.get('cal-car'); return [v.x, v.z]; });
    await T.walkTo(car[0], car[1], { within: 3.2, bursts: 40, frames: 10, run: true });
    await T.tap('#bUse'); await T.frames(4);
    let s = await T.state(); if (s.vehicle !== 'cal-car') { rec.fail = 'could not get into Cal\'s car'; return; }
    rec.shots.push(await T.shot('09-cal-in-car'));
    await T.stick(0, -0.8, 16); await T.stopVehicle();
    await T.tap('#bUse'); await T.frames(4);
    parked = await p.evaluate(() => { const v = GC.traffic.byId.get('cal-car'); return { x: +v.x.toFixed(2), z: +v.z.toFixed(2), heading: +v.heading.toFixed(3), road: GC.roadName(v.x, v.z) }; });
    rec.notes.push(`Cal parked at ${parked.x}, ${parked.z} on ${parked.road}`);
    rec.shots.push(await T.shot('10-cal-parked'));
    await T.tap('#bSwap'); await T.frames(10);
    s = await T.state(); rec.notes.push(`switched to ${s.brother} at ${s.x}, ${s.z}`);
    const lcar = await p.evaluate(() => { const v = GC.traffic.byId.get('leon-car'); return [v.x, v.z]; });
    await T.walkTo(lcar[0], lcar[1], { within: 3.2, bursts: 40, frames: 10, run: true });
    await T.tap('#bUse'); await T.frames(3);
    s = await T.state(); if (s.vehicle !== 'leon-car') { rec.fail = 'Leon could not get into his car'; return; }
    await T.stick(0, 0.8, 14); await T.stopVehicle();   // reverse away: Leon's car is parked behind Cal's
    rec.notes.push('Leon reversed out; the Woodley-to-Reading run is shortened with the Dev "Go to" teleport (software rendering runs ~1 fps here)');
    await T.dev('goto-reading-town-centre'); await T.frames(15);
    await T.stick(0, -0.7, 16); await T.stopVehicle();
    await T.tap('#bUse'); await T.frames(3);
    s = await T.state(); rec.notes.push(`Leon parked in ${s.district} on ${s.road}`);
    await T.face(-7323, -2601); await T.frames(2);
    rec.shots.push(await T.shot('11-leon-in-reading'));
    await T.tap('#bSwap'); await T.frames(15);
    s = await T.state();
    const now = await p.evaluate(() => { const v = GC.traffic.byId.get('cal-car'); return { x: +v.x.toFixed(2), z: +v.z.toFixed(2), heading: +v.heading.toFixed(3) }; });
    rec.notes.push(`back as ${s.brother} in ${s.district}; Cal's car now at ${now.x}, ${now.z} (moved ${Math.hypot(now.x - parked.x, now.z - parked.z).toFixed(2)} m)`);
    rec.shots.push(await T.shot('12-cal-car-still-there'));
    if (Math.hypot(now.x - parked.x, now.z - parked.z) > 0.5) rec.fail = 'Cal\'s car moved';
    await T.tap('#bMap'); await T.frames(3); rec.shots.push(await T.shot('13-map-both-brothers')); await T.tap('#mClose');
  });

  await step('Drive across a town boundary and beneath a flyover (Suttons Park Avenue under the A3290)', async rec => {
    const car = await p.evaluate(() => { const v = GC.traffic.byId.get('cal-car'); return [v.x, v.z]; });
    await T.walkTo(car[0], car[1], { within: 3.2, bursts: 20, frames: 6 });
    await T.tap('#bUse'); await T.frames(3);
    if (!(await T.state()).vehicle) { rec.fail = 'could not get into the car'; return; }
    await T.dev('spot-suttons-park-ave-a3290-flyover'); await T.frames(15);
    // waypoints along Suttons Park Avenue, west (East Reading) to east (Earley), through the underpass
    const pts = await p.evaluate(() => { const net = GC.net, raw = []; for (let e = 0; e < net.nEdges; e++) { if (net.roadName(e) !== 'Suttons Park Avenue') continue; const s = net.pstart[e], n = net.pcount[e]; for (let i = 0; i < n; i++) { const x = net.pts[(s + i) * 3], z = net.pts[(s + i) * 3 + 2]; if (x > -5365 && x < -4960 && z > -2730 && z < -2670) raw.push([x, z]); } } raw.sort((a, b) => a[0] - b[0]); const out = []; for (const p of raw) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 22) out.push(p); return out; });
    rec.notes.push(`route points: ${pts.length}`);
    const trace = await T.driveAlong(pts, { maxSpeed: 10 });
    const districts = [...new Set(trace.map(t => t.district))], under = trace.filter(t => t.overhead.length);
    rec.notes.push(`districts passed: ${districts.join(' -> ')}; samples beneath a deck: ${under.length} (deck ${[...new Set(under.flatMap(t => t.overhead))].slice(0, 2).join(', ')} m above datum, car at ${under[0]?.y?.toFixed(1)} m)`);
    rec.trace = trace.filter((_, k) => k % 3 === 0).map(t => [+t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1), t.road, t.district, t.overhead]);
    await T.stopVehicle();
    rec.shots.push(await T.shot('14-after-underpass'));
    if (districts.length < 2) rec.fail = 'did not cross a district boundary';
    if (!under.length) rec.fail = (rec.fail ? rec.fail + '; ' : '') + 'never passed beneath a bridge deck';
    await T.tap('#bUse'); await T.frames(3);
  });

  await step('Clouds move, rain starts, roads get wet, then dry (Woodley precinct canopy)', async rec => {
    await T.dev('spot-woodley-precinct', 'weather-clear', 'time-12', 'dry'); await T.frames(10);
    await T.look(0, -60); await T.frames(2);
    const c0 = await p.evaluate(() => [...GC.world.s.cloudOff]);
    rec.shots.push(await T.shot('15-clear-midday'));
    await T.dev('speed-120'); await T.frames(20);
    const c1 = await p.evaluate(() => [...GC.world.s.cloudOff]);
    rec.notes.push(`cloud field advected ${Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(0)} m with the wind`);
    rec.shots.push(await T.shot('16-clouds-moved'));
    await T.look(0, 60);
    const series = [];
    await T.dev('weather-drizzle');
    for (let i = 0; i < 30; i++) { await T.frames(4); const s = await T.state(); series.push([s.hour, s.weather, s.rain, s.wet, s.puddle]); if (i === 12) rec.shots.push(await T.shot('17-drizzle')); }
    await T.dev('weather-rain');
    for (let i = 0; i < 30; i++) { await T.frames(4); const s = await T.state(); series.push([s.hour, s.weather, s.rain, s.wet, s.puddle]); }
    rec.shots.push(await T.shot('18-heavy-rain-wet-road'));
    if ((await T.state()).vehicle) { await T.stopVehicle(); await T.tap('#bUse'); await T.frames(3); }
    // stand under the shop canopy: rain is kept out and sound changes
    const can = await p.evaluate(() => { const me = GC.brothers.me; let best = null, bd = 1e9; for (const c of GC.canopies) if (c.kind === 0) { const d = Math.hypot(c.x - me.x, c.z - me.z); if (d < bd) { bd = d; best = c; } } return [best.x, best.z]; });
    await T.walkTo(can[0], can[1], { within: 0.8, bursts: 20, frames: 5 });
    const under = await p.evaluate(() => { const me = GC.brothers.me, A = GC.audio; return { sheltered: GC.shelteredAt(me.x, me.y + 1.2, me.z), rainGain: A.on ? +A.rain.g.gain.value.toFixed(3) : null, patterGain: A.on ? +A.rainRoof.g.gain.value.toFixed(3) : null, lowpassHz: A.on ? Math.round(A.rain.f.frequency.value) : null }; });
    rec.notes.push(`under canopy: sheltered=${under.sheltered}, rain bed gain ${under.rainGain}, overhead patter gain ${under.patterGain}, rain low-pass ${under.lowpassHz} Hz`);
    rec.shots.push(await T.shot('19-under-canopy-in-rain'));
    await T.dev('weather-clearing', 'speed-600');
    for (let i = 0; i < 40; i++) { await T.frames(4); const s = await T.state(); series.push([s.hour, s.weather, s.rain, s.wet, s.puddle]); if (i === 6) rec.shots.push(await T.shot('20-shower-passing')); }
    rec.shots.push(await T.shot('21-drying'));
    rec.series = series;
    const peak = Math.max(...series.map(r => r[3])), end = series.at(-1)[3];
    rec.notes.push(`wetness peaked at ${peak} and fell to ${end} after the shower (puddles ${series.at(-1)[4]})`);
    if (!(peak > 0.6 && end < peak - 0.2)) rec.fail = 'wetness did not build and dry';
    if (!under.sheltered) rec.fail = (rec.fail ? rec.fail + '; ' : '') + 'canopy did not shelter';
    await T.dev('speed-30', 'time-18.5');
    await T.frames(6); rec.shots.push(await T.shot('22-dusk-lights'));
  });

  await step('Police response to a witnessed collision, and its resolution', async rec => {
    await T.dev('spot-cemetery-junction-arch', 'sim-8', 'time-12'); await T.frames(10);
    const before = await p.evaluate(() => GC.police.nextInc);
    await T.dev('stage-collision-nearby'); await T.frames(3);
    const timeline = [];
    for (let i = 0; i < 500; i++) {
      const s = await p.evaluate(first => GC.police.incidents.filter(i => i.id >= first).map(i => ({ id: i.id, label: i.label, status: i.status, x: i.x, z: i.z, unit: i.unit?.id, d: i.unit ? Math.round(Math.hypot(i.unit.x - i.x, i.unit.z - i.z)) : null, siren: !!i.unit?.siren, witnesses: i.witnesses.length })), before);
      const inc = s[0]; if (!inc) break;
      if (!timeline.length || timeline.at(-1).status !== inc.status) { timeline.push({ ...inc, t: await p.evaluate(() => +GC.time.toFixed(1)) }); if (inc.status === 'responding' || inc.status === 'onscene') { await T.face(inc.x !== undefined ? inc.x : 0, inc.z); rec.shots.push(await T.shot('23-police-' + inc.status)); } }
      if (inc.status === 'cleared') break;
      await T.frames(2);
    }
    rec.timeline = timeline;
    rec.feed = await p.evaluate(() => GC.hud.feedItems.map(f => f.t));
    rec.notes.push(timeline.map(t => `${t.status}${t.unit ? ' (' + t.unit + (t.d != null ? ', ' + t.d + ' m' : '') + ')' : ''}`).join(' -> '));
    if (!timeline.some(t => t.status === 'cleared')) rec.fail = 'incident not resolved in time';
    const after = await p.evaluate(() => GC.police.units.map(u => u.id + ':' + u.status));
    rec.notes.push('units after: ' + after.join(', '));
    rec.shots.push(await T.shot('24-scene-cleared'));
    await T.dev('sim-2');
  });

  await step('Player disturbance: stop state and clean resolution', async rec => {
    await T.dev('spot-cemetery-junction-arch'); await T.frames(10);
    // go to the nearest foot patrol (setup via the dev API), then take a parked car in view of the officers
    const off = await p.evaluate(() => { const me = GC.brothers.me; let best = null, bd = 1e9; for (const o of GC.police.officers) { const d = Math.hypot(o.x - me.x, o.z - me.z); if (d < bd) { bd = d; best = o; } } return { x: best.x, z: best.z, id: best.id }; });
    await p.evaluate(o => GC.teleport(o.x + 6, o.z + 6), off); await T.frames(20);
    const tgt = await p.evaluate(id => { const o = GC.police.officers.find(q => q.id === id); let best = null, bd = 1e9; for (const v of GC.traffic.list) if (v.parked && !v.free && !v.owner) { const d = Math.hypot(v.x - o.x, v.z - o.z); if (d < bd) { bd = d; best = v; } } return best ? { x: best.x, z: best.z, d: bd, id: best.id } : null; }, off.id);
    rec.notes.push(`foot patrol ${off.id}; nearest parked car ${tgt && tgt.id} (${tgt && tgt.d.toFixed(0)} m from the officers)`);
    if (!tgt) { rec.fail = 'no parked car'; return; }
    await T.walkTo(tgt.x, tgt.z, { within: 3, bursts: 25, frames: 6, run: true });
    await T.tap('#bUse'); await T.frames(4);
    const states = [];
    for (let i = 0; i < 80; i++) { const s = await p.evaluate(() => ({ st: GC.police.player.state, msg: document.getElementById('banner').textContent })); if (!states.length || states.at(-1).st !== s.st) { states.push(s); if (s.st !== 'none') rec.shots.push(await T.shot('25-police-' + s.st)); } if (s.st === 'none' && states.length > 1) break; await T.frames(2); }
    rec.states = states;
    rec.notes.push(states.map(s => `${s.st}: ${s.msg}`).join(' | '));
    if (!states.some(s => s.st === 'stop' || s.st === 'pursuit')) rec.notes.push('not witnessed by police this run (officers were out of sight) — no reaction is the correct outcome');
    else if (states.at(-1).st !== 'none') rec.fail = 'did not resolve';
    if ((await T.state()).vehicle) { await T.tap('#bUse'); await T.frames(3); }
  });

  let before = null;
  await step('Close and resume', async rec => {
    before = await p.evaluate(() => ({ b: GC.brothers.b.map(b => [b.short, +b.x.toFixed(1), +b.z.toFixed(1), b.vehicle]), active: GC.brothers.active, cars: ['cal-car', 'leon-car'].map(id => { const v = GC.traffic.byId.get(id); return [id, +v.x.toFixed(1), +v.z.toFixed(1)]; }), t: Math.round(GC.world.time), weather: GC.world.stateName(), wet: +GC.world.s.wet.toFixed(2) }));
    await p.evaluate(() => GC.save.now());
    await p.reload(); await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
    await T.frames(5);
    const after = await p.evaluate(() => ({ b: GC.brothers.b.map(b => [b.short, +b.x.toFixed(1), +b.z.toFixed(1), b.vehicle]), active: GC.brothers.active, cars: ['cal-car', 'leon-car'].map(id => { const v = GC.traffic.byId.get(id); return [id, +v.x.toFixed(1), +v.z.toFixed(1)]; }), t: Math.round(GC.world.time), weather: GC.world.stateName(), wet: +GC.world.s.wet.toFixed(2) }));
    rec.before = before; rec.after = after;
    rec.shots.push(await T.shot('26-resumed'));
    const same = JSON.stringify(before.b) === JSON.stringify(after.b) && JSON.stringify(before.cars) === JSON.stringify(after.cars) && before.weather === after.weather && Math.abs(after.t - before.t) < 600;
    rec.notes.push(`brothers, cars and weather restored: ${same}; clock ${before.t} -> ${after.t}`);
    if (!same) rec.fail = 'state differs after resume';
  });

  await step('No objective or mission UI at any point', async rec => {
    const txt = await T.text();
    const found = MISSION.test(txt) ? txt.match(MISSION)[0] : null;
    rec.notes.push(found ? 'found: ' + found : 'no mission, objective, delivery, phone-call or sales text in the HUD');
    if (found) rec.fail = 'mission text visible';
  });

  await step('Perf flythrough from the Dev panel (short check, then stopped)', async rec => {
    const before = await p.evaluate(() => ({ x: GC.brothers.me.x, z: GC.brothers.me.z }));
    await T.dev('perf-flythrough');
    await p.waitForFunction(() => GC.perf.fly.active, null, { timeout: 60000 });
    const t0 = Date.now(); while (Date.now() - t0 < 40000) await p.waitForTimeout(2000);
    const mid = await p.evaluate(() => ({ progress: +GC.perf.fly.progress().toFixed(3), km: +(GC.perf.fly.path.length / 1000).toFixed(2) }));
    rec.shots.push(await T.shot('28-perf-flythrough'));
    await T.dev('perf-flythrough');                                        // the same button reads "Stop flythrough"
    await p.waitForFunction(() => !GC.perf.fly.active && !GC._needGround, null, { timeout: 0, polling: 300 });
    const after = await p.evaluate(() => ({ x: GC.brothers.me.x, z: GC.brothers.me.z, perfCar: GC.traffic.byId.has('perf-car'), last: (() => { try { const l = JSON.parse(localStorage.getItem('greenCounty.perf.last')); return l && { kind: l.kind, completed: l.completed, frames: l.summary?.frames, drawCallsP50: l.summary?.drawCallsP50 }; } catch { return null; } })() }));
    const restored = Math.hypot(after.x - before.x, after.z - before.z) < 1 && !after.perfCar;
    rec.result = { ...mid, restored, log: after.last };
    rec.notes.push(`flythrough ${(mid.progress * 100).toFixed(1)}% of ${mid.km} km in 40 s, stopped; brother restored: ${restored}; log saved: ${!!after.last}`);
    if (!(mid.progress > 0) || !restored || !after.last) rec.fail = 'flythrough did not run, restore or save its log';
  });

  await step('Traffic persists across save, reload and brother swap (same ids within 200 m of each brother)', async rec => {
    const ready = async () => { await p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '' && !GC._needGround, null, { timeout: 0, polling: 300 }); await T.frames(3); };
    const r = await require('./fleet.js').run({ p, tap: T.tap, ready });
    rec.result = r; rec.notes.push(JSON.stringify(r.steps));
    if (!r.ok) rec.fail = 'fleet not kept';
  });

  log.errors = T.errors.slice(0, 40);
  log.perf = await p.evaluate(() => GC.perf.report()).catch(() => null);
  await T.ctx.close(); await T.b.close();
  // collect the video
  const vids = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter(f => f.endsWith('.webm')) : [];
  if (vids[0]) { fs.renameSync(path.join(vdir, vids[0]), path.join(OUT, 'acceptance-run.webm')); }
  fs.rmSync(vdir, { recursive: true, force: true });

  // migration: a prototype save with an active phone order must load into free roam with no mission
  await step('Prototype save migrates with missions disabled', async rec => {
    const M = await launch(null);
    await M.p.goto(BASE + '?backend=webgl');
    await M.p.evaluate(() => { localStorage.clear(); localStorage.setItem('greenCounty', JSON.stringify({ x: 5830, y: 3000, cx: 5832, cy: 2994, drive: false, cash: 515, flower: 6, owned: [0, 2], crew: [2], business: { active: 1, positions: [[5830, 3000], [5844, 3005]], call: { i: 3, accepted: true }, jobs: 2, paint: 0x174936, wardrobe: [{ jacket: 2, skin: 0, hair: 0 }, { jacket: 3, skin: 1, hair: 1 }], blocks: ['13,6'] } })); });
    await M.p.goto(BASE + '?backend=webgl');
    await M.p.waitForFunction(() => window.GC && GC.frame > 3 && document.getElementById('boot').textContent === '', null, { timeout: 0, polling: 500 });
    await M.frames(6);
    const r = await M.p.evaluate(() => { GC.save.now(); const s = JSON.parse(localStorage.getItem('greenCounty.sandbox.v1')); return { active: GC.brothers.me.short, pos: GC.brothers.b.map(b => [b.short, Math.round(b.x), Math.round(b.z)]), district: GC.districtName(GC.brothers.me.x, GC.brothers.me.z), legacyKept: !!localStorage.getItem('greenCounty'), businessKept: !!s.business?.legacy?.business, jobs: s.business?.legacy?.business?.jobs, mode: s.mode, text: document.body.innerText }; });
    rec.result = { ...r, text: undefined };
    rec.shots.push(await M.p.screenshot({ path: path.join(OUT, '27-migrated-prototype-save.png') }).then(() => '27-migrated-prototype-save.png'));
    rec.notes.push(`active ${r.active} in ${r.district}; prototype save kept: ${r.legacyKept}; business progress carried (jobs=${r.jobs}); mode ${r.mode}`);
    if (MISSION.test(r.text)) rec.fail = 'mission text visible after migration';
    if (!r.legacyKept || !r.businessKept) rec.fail = 'legacy data not preserved';
    await M.b.close();
  });
  log.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'acceptance.json'), JSON.stringify(log, null, 1));
  console.log('done', log.steps.map(s => `${s.ok ? 'PASS' : 'FAIL'} ${s.name}`).join('\n'));
})();
