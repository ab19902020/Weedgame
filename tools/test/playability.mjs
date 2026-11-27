// Playability checks in the real game (scripted through the game API, for development), for what broke in v0.37:
//   cars     the brothers' Range Rovers are there and drawn; every supplied car, driven with the accelerator held,
//            goes forwards (and, with an output folder, a chase-camera picture of each: you should see its tail)
//   aim      free aim (the default): no lock, no snapping; the crosshair (red over someone) is where the rounds go,
//            a shot just beside someone misses them and one on them hits; Lock-on (Settings) still locks on; a quick
//            tap on the touch Aim button keeps the gun up until the next tap
// Usage: node tools/test/playability.mjs [cars,aim] [outdir]   (needs `npm run serve`; BASE to point elsewhere,
// CHROME_PATH for a Chromium other than Playwright's own, ONLY=compact,minivan to drive only some of the cars)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const cases = (process.argv[2] || 'cars,aim').split(','), outdir = process.argv[3];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.goto(BASE + '?backend=webgl&time=13&weather=clear&quality=low&fresh=1');
await p.waitForFunction(() => window.GC && GC.hud && GC.hud.menu, null, { timeout: 0, polling: 500 });
await p.evaluate(() => GC.hud.menu.close());
await p.waitForFunction(() => GC.frame > 2 && GC.tiles.pending.size === 0 && !GC._needGround && GC.peds.list.length > 3, null, { timeout: 0, polling: 1000 });
await p.evaluate(() => {
  const G = GC, B = G.brothers, up = B.update.bind(B), me = B.me;
  G._start = { x: me.x, y: me.y, z: me.z, heading: me.heading };   // the open square at the start (the aim checks run there)
  G._frames = n => new Promise(res => { const f0 = G.frame; const chk = () => G.frame >= f0 + n ? res() : requestAnimationFrame(chk); chk(); });
  // a person pinned in place, and the view held at a set yaw / pitch (after the game's own camera)
  B.update = (...a) => {
    const P = G._pin; if (P) { P.T.x = P.X; P.T.z = P.Z; P.T.y = P.Y; P.T.vx = P.T.vz = 0; }
    if (G._aimYaw != null) { B.cam.yaw = G._aimYaw; B.cam.pitch = G._aimPitch; B.cam.lastUser = G.time; }
    return up(...a);
  };
});
const res = {}; let ok = true;
const check = (name, pass, info) => { res[name] = { ok: !!pass, ...info }; if (!pass) ok = false; };
if (cases.includes('cars')) {
  await p.waitForFunction(() => GC.vehicleRenderer.meshes.compact && GC.vehicleRenderer.meshes.bmwx3, null, { timeout: 0, polling: 1000 });
  const rr = await p.evaluate(async () => {
    const G = GC, c = G.traffic.byId.get('cal-car'), l = G.traffic.byId.get('leon-car'), me = G.brothers.me;
    if (!c || !l) return { cars: !!c + !!l };
    me.x = c.x - Math.sin(c.heading) * 4; me.z = c.z + Math.cos(c.heading) * 4;
    // (the hand-made model loads on first sight)
    for (let k = 0; k < 40 && !(G.heroCars.active.get('cal-car')?.body.visible && G.heroCars.active.get('leon-car')?.body.visible); k++) await G._frames(2);
    const shown = id => !!G.heroCars.active.get(id)?.body.visible;
    return { cars: 2, model: c.model, cal: shown('cal-car'), leon: shown('leon-car') };
  });
  check('range rovers there and drawn', rr.cars === 2 && rr.model === 'rangerover' && rr.cal && rr.leon, rr);
  // every supplied car (the baked sets), and a Range Rover
  const models = await p.evaluate(async () => (await Promise.all(['carpack', 'realcars'].map(s => fetch('vehicles/' + s + '.json').then(r => r.json())))).flatMap(J => J.cars.map(c => c.name)).concat(['rangerover']));
  for (const model of models.filter(m => !process.env.ONLY || process.env.ONLY.split(',').includes(m))) {
    const r = await p.evaluate(async model => {
      const G = GC, me = G.brothers.me;
      if (me.vehicle) { const v = G.brothers.vehicleOf(me); v.sp = 0; if (v.ph) v.ph.vx = v.ph.vz = 0; G.brothers.toggleVehicle(); }
      let best = null, bd = 1e9;
      // a car moving freely (not queued behind others, where the test car would just run into the one in front)
      const clear = t => !G.traffic.list.some(o => o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 30 && (o.x - t.x) * Math.cos(t.heading) + (o.z - t.z) * Math.sin(t.heading) > 0);
      for (const t of G.traffic.list) { if (t.parked || t.player || t.kind !== 'traffic' || t.def.wheels === 2 || (t.v ?? 0) < 4 || !clear(t)) continue; const d = Math.hypot(t.x - me.x, t.z - me.z); if (d < bd && d > 15) { bd = d; best = t; } }
      if (!best) return { error: 'no traffic car to swap' };
      const pose = { x: best.x, y: best.y, z: best.z, heading: best.heading };
      G.traffic.remove(best);
      const v = G.traffic.add({ id: 'test-' + model + '-' + G.frame, kind: 'parked', model, paint: 0xb5121b, ...pose, parked: true, free: true });
      me.x = pose.x - Math.sin(pose.heading) * (v.def.W / 2 + 0.7); me.z = pose.z + Math.cos(pose.heading) * (v.def.W / 2 + 0.7); me.y = pose.y;
      await G._frames(2); G.brothers.toggleVehicle();
      if (G.brothers.vehicleOf(me) !== v) return { error: 'could not get in' };
      G.brothers.cam.car = 0; return {};
    }, model);
    if (r.error) { check('drive ' + model, false, r); continue; }
    await p.keyboard.down('KeyW'); await p.evaluate(() => GC._frames(25));
    const s = await p.evaluate(() => { const G = GC, v = G.brothers.vehicleOf(G.brothers.me), ph = v.ph; return { forwards: +(ph.vx * Math.cos(v.heading) + ph.vz * Math.sin(v.heading)).toFixed(1) }; });
    if (outdir) await p.screenshot({ path: `${outdir}/drive_${model}.png` });
    await p.keyboard.up('KeyW');
    check('drive ' + model, s.forwards > 2, s);
  }
  await p.evaluate(async () => { const G = GC, me = G.brothers.me; if (me.vehicle) { const v = G.brothers.vehicleOf(me); v.sp = 0; if (v.ph) v.ph.vx = v.ph.vz = 0; G.brothers.toggleVehicle(); } await G._frames(3); });
}
if (cases.includes('aim')) {
  const setup = await p.evaluate(async () => {
    const G = GC, me = G.brothers.me;
    if (me.vehicle) G.brothers.toggleVehicle();
    Object.assign(me, G._start); await G._frames(10);
    G.combat.select('pistol');
    const T = G.peds.list.find(q => !q.dead && !q.gone); T.hp = 100;
    const h = me.heading, X = me.x + Math.cos(h) * 12, Z = me.z + Math.sin(h) * 12, Y = G.tiles.ground(X, Z, me.y + 2) ?? me.y;
    G._pin = { T, X, Y, Z }; G._base = Math.atan2(me.z - Z, me.x - X);
    return { freeByDefault: !G.aimAssist };
  });
  check('free aim is the default', setup.freeByDefault, setup);
  await p.keyboard.down('KeyK');
  const sweep = await p.evaluate(async () => {
    const G = GC, s = G.combat.s[G.brothers.active], out = [];
    for (let k = -24; k <= 24; k++) {
      // (settle: the trace under the crosshair is refreshed every 66 ms of game time, and the HUD draws after it)
      G._aimYaw = G._base + k * 0.006; G._aimPitch = 0.04; const t0 = G.time; await G._frames(3); while (G.time - t0 < 0.15) await G._frames(1);
      const h = s.cross?.hit, person = h?.kind === 'ped' && !h.ped.dead;
      out.push({ k, on: person && h.ped === G._pin.T, person, snapped: !!s.lock || !!s.hover, red: document.getElementById('reticle').className === 'on' });
    }
    return out;
  });
  const on = sweep.filter(r => r.on).map(r => r.k);
  check('no lock or snapping in free aim', !sweep.some(r => r.snapped), {});
  // red over them, and over anyone else who walks into the line, and nowhere else
  const wrong = sweep.filter(r => r.red !== r.person).map(r => r.k);
  check('crosshair red over a person, only then', on.length > 0 && on.every(k => sweep.find(r => r.k === k).red) && !wrong.length, { over: on, others: sweep.filter(r => r.person && !r.on).map(r => r.k), wrong });
  if (on.length) {
    const shoot = async off => p.evaluate(async off => {
      const G = GC, T = G._pin.T; T.hp = 100; G._aimYaw = G._base + off * 0.006; await G._frames(4);
      for (let n = 0; n < 3; n++) { G.input.pressed.add('hit'); await G._frames(8); }
      return { hp: T.hp ?? 100 };
    }, off);
    const beside = await shoot(Math.max(...on) + 5), hit = await shoot(on[Math.floor(on.length / 2)]);
    check('a shot just beside them misses', beside.hp === 100, beside);
    check('a shot on them hits', hit.hp < 100, hit);
  }
  await p.keyboard.up('KeyK');
  const lock = await p.evaluate(async () => {
    const G = GC, s = G.combat.s[G.brothers.active]; G._aimYaw = null; G._pin.T.hp = 100; G.aimAssist = true;
    G.input.held.add('aim'); await G._frames(6); const r = { lock: !!s.lock };
    G.input.held.delete('aim'); G.aimAssist = false; await G._frames(3); return r;
  });
  check('Lock-on (Settings) locks on', lock.lock, lock);
  const tap = await p.evaluate(async () => {
    const G = GC, btn = document.getElementById('bAim'), r = btn.getBoundingClientRect();
    const ev = type => btn.dispatchEvent(new PointerEvent(type, { pointerId: 7, bubbles: true, clientX: r.x + 10, clientY: r.y + 10, pointerType: 'touch' }));
    ev('pointerdown'); ev('pointerup'); await G._frames(4); const first = G.combat.aiming();
    ev('pointerdown'); ev('pointerup'); await G._frames(4); return { first, second: G.combat.aiming() };
  });
  check('a tap on Aim keeps the gun up, a second tap lowers it', tap.first && !tap.second, tap);
}
console.log(JSON.stringify(res, null, 1));
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await b.close();
process.exit(ok && !errors.length ? 0 : 1);
