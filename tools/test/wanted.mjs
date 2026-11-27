// The police after you (src/wanted.js), in the real game, scripted through the game API (for development):
//   quiet     gunfire and a wounding without a killing bring nobody
//   kill      a killing next to a patrol (or phoned in): a star
//   car       stopped in a car at two stars: they box you in, get out and arrest you (busted, the police station)
//   chase     three stars, driving off along the roads (an autopilot): rams, PITs, stingers, boxed in
//   foot      two stars, running away on foot: Tasered and cuffed
//   armed     five stars: armed response shoot; health runs out: wasted, the hospital
//   services  a killing gets an ambulance; a smashed car catches fire and the fire brigade puts it out
//   evade     three stars, then away out of sight: they search, then lose you
// Usage: node tools/test/wanted.mjs outdir [scenarios]   (needs `npm run serve`; BASE, CHROME_PATH as playability.mjs)
import { chromium } from 'playwright';
const [, , out = '.', only = 'quiet,kill,car,chase,foot,armed,services,evade'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080/index.html';
const want = only.split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
const errors = []; p.on('pageerror', e => { errors.push(e.message); console.log('pageerror:', e.message); });
p.on('console', m => { if (m.type() === 'error' && !/GPU stall|favicon|Failed to load resource/.test(m.text())) console.log('console error:', m.text().slice(0, 300)); });
await p.goto(BASE + '?backend=webgl&time=13&weather=clear&quality=low&fresh=1');
await p.waitForFunction(() => window.GC && GC.hud && GC.hud.menu, null, { timeout: 900000, polling: 500 });
await p.evaluate(() => GC.hud.menu.close());
await p.waitForFunction(() => GC.frame > 2 && GC.tiles.pending.size === 0 && !GC._needGround && GC.peds.list.length > 3, null, { timeout: 900000, polling: 1000 });
await p.evaluate(() => {
  const G = GC;
  G._frames = n => new Promise(res => { const f0 = G.frame; const chk = () => G.frame >= f0 + n ? res() : requestAnimationFrame(chk); chk(); });
  G._secs = s => new Promise(res => { const t0 = G.time; const chk = () => G.time - t0 >= s ? res() : requestAnimationFrame(chk); chk(); });
  G._start = { x: G.brothers.me.x, z: G.brothers.me.z, heading: G.brothers.me.heading };
  G._log = () => { const W = G.wanted, me = G.brothers.me, car = G.brothers.vehicleOf(me), T = car || me;
    return { t: +G.time.toFixed(1), lv: W.level, ph: W.phase, hold: W.hold?.kind || null, hp: Math.round(me.hp ?? 100),
      units: W.units.map(u => `${u.law?.mode}${u.driven ? '*' : ''}:${Math.round(Math.hypot(u.x - T.x, u.z - T.z))}m@${Math.abs(u.sp || u.v || 0).toFixed(0)}`).join(' '),
      foot: W.foot.length + (W.foot.length ? ' nearest ' + Math.round(Math.min(...W.foot.map(o => Math.hypot(o.x - T.x, o.z - T.z)))) + 'm' : ''), banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent.slice(0, 70) }; };
  G._contacts = 0; G.events.on('vehicleHit', e => { const mine = G.brothers.vehicleOf(G.brothers.me); if ((e.by === mine && e.other.law) || (e.other === mine && e.by.law)) G._contacts++; });
});
const log = async (label, secs, every = 2) => {
  for (let t = 0; t < secs; t += every) {
    await p.evaluate(s => GC._secs(s), every);
    const s = await p.evaluate(() => GC._log());
    console.log(label, JSON.stringify(s));
    if (s.hold === 'busted' || s.hold === 'wasted') return s;
  }
  return p.evaluate(() => GC._log());
};
const reset = () => p.evaluate(async () => { const G = GC, me = G.brothers.me; G.wanted.clear(null); if (me.vehicle) { const v = G.brothers.vehicleOf(me); v.sp = 0; if (v.ph) v.ph.vx = v.ph.vz = 0; G.brothers.toggleVehicle(); } G.teleport(G._start.x, G._start.z, G._start.heading); await new Promise(r => { const c = () => (!G._needGround && G.tiles.pending.size === 0) ? r() : setTimeout(c, 200); c(); }); me.hp = 100; G.combat.select(null); await G._frames(5); });

if (want.includes('quiet')) {
  // shooting, even at people, without killing anyone: nobody comes
  const r = await p.evaluate(async () => {
    const G = GC, me = G.brothers.me; G.combat.select('pistol');
    const T = G.peds.list.find(q => !q.dead && !q.officer && Math.hypot(q.x - me.x, q.z - me.z) < 60);
    for (let k = 0; k < 6; k++) { G.input.pressed.add('hit'); await G._frames(6); }
    if (T) G.peds.hurt(T, 0, 'shot', 20, { by: 'player', zone: 'leg' });   // wounded, not killed
    await G._secs(15);
    return { level: G.wanted.level, reports: G.wanted.reports.length, wounded: !!T && !T.dead };
  });
  console.log('QUIET (gunfire and a wounding, no killing):', JSON.stringify(r));
  await reset();
}
if (want.includes('kill')) {
  // a killing with a patrol car watching: straight on to you
  const r = await p.evaluate(async () => {
    const G = GC, me = G.brothers.me, net = G.net;
    const u = G.police.units.find(v => v.status === 'patrol');
    // bring a patrol round the corner: put it on the nearest road 40 m away
    const n = net.nearest(me.x + 35, me.z, 80, e => net.flags[e] & 16);
    G.police.rejoin(u, n);
    await G._frames(4);
    const T = G.peds.list.find(q => !q.dead && !q.officer && Math.hypot(q.x - me.x, q.z - me.z) < 40) || G.peds.list.find(q => !q.dead && !q.officer);
    T.x = me.x + 3; T.z = me.z + 1; G.peds.ground(T);
    G.peds.hurt(T, 0, 'shot', 999, { by: 'player' });
    await G._frames(3);
    return { level: G.wanted.level, phase: G.wanted.phase, banner: document.getElementById('banner').textContent };
  });
  console.log('KILL (seen by a patrol, or phoned in):', JSON.stringify(r));
  await log('kill', 18);
  await p.screenshot({ path: `${out}/kill.png` });
  await reset();
}
if (want.includes('car')) {
  // in a car, stopped on a road, two stars: they come, box you in, get out and pull you out
  await p.evaluate(async () => {
    const G = GC, me = G.brothers.me;
    let best = null, bd = 1e9; for (const t of G.traffic.list) { if (t.parked || t.player || t.kind !== 'traffic' || t.def.wheels === 2) continue; const d = Math.hypot(t.x - me.x, t.z - me.z); if (d < bd && d > 20) { bd = d; best = t; } }
    const pose = { x: best.x, y: best.y, z: best.z, heading: best.heading }; G.traffic.remove(best);
    const v = G.traffic.add({ id: 'test-car', kind: 'parked', model: 'hatch', paint: 0x335577, ...pose, parked: true, free: true });
    me.x = pose.x - Math.sin(pose.heading) * 1.6; me.z = pose.z + Math.cos(pose.heading) * 1.6; await G._frames(2); G.brothers.toggleVehicle();
    const W = G.wanted; W.setLevel(2, 'test'); W.spotted(me);
  });
  const end = await log('car', 70);
  await p.screenshot({ path: `${out}/car_end.png` });
  console.log('CAR result:', JSON.stringify(end), 'contacts', await p.evaluate(() => GC._contacts));
  await p.evaluate(() => GC._secs(5)); console.log('after:', JSON.stringify(await p.evaluate(() => ({ ...GC._log(), cash: GC.brothers.me.cash, pos: [Math.round(GC.brothers.me.x), Math.round(GC.brothers.me.z)] }))));
  await reset();
}
if (want.includes('chase')) {
  // three stars and you drive off along the roads (an autopilot follows the road ahead): PITs, rams, stingers, boxing in
  await p.evaluate(async () => {
    const G = GC, me = G.brothers.me, net = G.net;
    let best = null, bd = 1e9; for (const t of G.traffic.list) { if (t.parked || t.player || t.kind !== 'traffic' || t.def.wheels === 2 || (t.v ?? 0) < 4) continue; const d = Math.hypot(t.x - me.x, t.z - me.z); if (d < bd && d > 20) { bd = d; best = t; } }
    const pose = { x: best.x, y: best.y, z: best.z, heading: best.heading }; G.traffic.remove(best);
    const v = G.traffic.add({ id: 'test-chase', kind: 'parked', model: 'saloon', paint: 0x772222, ...pose, parked: true, free: true });
    me.x = pose.x - Math.sin(pose.heading) * 1.6; me.z = pose.z + Math.cos(pose.heading) * 1.6; await G._frames(2); G.brothers.toggleVehicle();
    G._auto = true;
    const real = G.input.driveControls.bind(G.input);
    G.input.driveControls = dt => {
      const car = G.brothers.vehicleOf(G.brothers.me); if (!car || !G._auto) return real(dt);
      const h = car.heading, look = 10 + Math.abs(car.sp || 0) * 0.8;
      const n = net.nearest(car.x + Math.cos(h) * look, car.z + Math.sin(h) * look, 45, e => (net.flags[e] & 16) && !/footway|path|cycle|pedestrian|steps|service|track/.test(net.classes[net.cls[e]]));
      let steer = 0; if (n) { let err = Math.atan2(n.z - car.z, n.x - car.x) - h; err = Math.atan2(Math.sin(err), Math.cos(err)); steer = Math.max(-1, Math.min(1, err * 2)); }
      return { steer, gas: Math.abs(car.sp || 0) > 20 ? 0.35 : 0.85, brake: 0 };
    };
    G._spikes = 0; G._knocks = 0;
    const W = G.wanted; W.setLevel(3, 'test'); W.spotted(me);
  });
  for (let k = 0; k < 45; k++) {
    await p.evaluate(() => GC._secs(2));
    const s = await p.evaluate(() => { const v = GC.brothers.vehicleOf(GC.brothers.me); if (v?.knockT > 0) GC._knocks++; if (v?.spikeStop > 0) GC._spikes++; return { ...GC._log(), contacts: GC._contacts, knocked: GC._knocks, spiked: GC._spikes > 0, block: !!GC.wanted.block, my: Math.round(Math.abs(v?.sp || 0)) }; });
    console.log('chase', JSON.stringify(s));
    if (k % 6 === 3) await p.screenshot({ path: `${out}/chase_${k}.png` });
    if (s.hold === 'busted' || s.hold === 'wasted') { await p.screenshot({ path: `${out}/chase_end.png` }); break; }
  }
  await p.evaluate(() => { GC._auto = false; });
  await reset();
}
if (want.includes('foot')) {
  // on foot, unarmed, running: Tasered and cuffed
  await p.evaluate(async () => { const G = GC, W = G.wanted; W.setLevel(2, 'test'); W.spotted(G.brothers.me); });
  await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft');
  let shot = false;
  for (let k = 0; k < 40; k++) {
    await p.evaluate(() => GC._secs(2));
    const s = await p.evaluate(() => GC._log());
    console.log('foot', JSON.stringify(s));
    if (!shot && s.foot && parseInt(s.foot.split('nearest ')[1]) < 25) { await p.screenshot({ path: `${out}/foot_officers.png` }); shot = true; }
    if (s.hold === 'stun') await p.screenshot({ path: `${out}/foot_stun.png` });
    if (s.hold === 'busted') { await p.screenshot({ path: `${out}/foot_busted.png` }); break; }
  }
  await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft');
  await reset();
}
if (want.includes('armed')) {
  // standing with a pistol out at four stars: armed police shoot; health goes; wasted, the hospital
  await p.evaluate(async () => { const G = GC, W = G.wanted; G.combat.select('pistol'); W.setLevel(5, 'test'); W.spotted(G.brothers.me); });
  let shot = false;
  for (let k = 0; k < 45; k++) {
    await p.evaluate(() => GC._secs(2));
    const s = await p.evaluate(() => GC._log());
    console.log('armed', JSON.stringify(s));
    if (!shot && s.hp < 90) { await p.screenshot({ path: `${out}/armed_shot.png` }); shot = true; }
    if (s.hold === 'wasted') { await p.evaluate(() => GC._secs(1)); await p.screenshot({ path: `${out}/wasted.png` }); await p.evaluate(() => GC._secs(4)); console.log('after wasted', JSON.stringify(await p.evaluate(() => ({ ...GC._log(), pos: [Math.round(GC.brothers.me.x), Math.round(GC.brothers.me.z)], cash: GC.brothers.me.cash })))); break; }
  }
  await reset();
}
if (want.includes('evade')) {
  // three stars, then away: far off and out of sight they search, then lose you
  await p.evaluate(async () => { const G = GC, W = G.wanted; W.setLevel(3, 'test'); W.spotted(G.brothers.me); await G._secs(3); G.teleport(G._start.x + 900, G._start.z + 300); });
  const end = await log('evade', 70, 3);
  console.log('EVADE result:', JSON.stringify(end));
}
if (want.includes('services')) {
  // a killing brings an ambulance (and a scene the police attend); a smashed car catches fire and the fire brigade comes
  const r0 = await p.evaluate(async () => {
    const G = GC, me = G.brothers.me;
    const T = G.peds.list.find(q => !q.dead && !q.officer && Math.hypot(q.x - me.x, q.z - me.z) < 50);
    G.peds.hurt(T, 0, 'shot', 999, { by: 'npc' });     // (not by you: no wanted level, just the services)
    let car = null, bd = 1e9; for (const v of G.traffic.list) { if (v.player || v.kind !== 'traffic' || v.def.wheels === 2) continue; const d = Math.hypot(v.x - me.x, v.z - me.z); if (d < bd && d > 15 && d < 150) { bd = d; car = v; } }
    car.dmg = [0.92, 0.6, 0.5, 0.5]; car.crashed = true; car.v = 0; car.hazard = true;
    G._svc = { T, car };
    return { level: G.wanted.level, incident: G.police.incidents.at(-1)?.label, car: car.id };
  });
  console.log('SERVICES start', JSON.stringify(r0));
  for (let k = 0; k < 40; k++) {
    await p.evaluate(() => GC._secs(3));
    const s = await p.evaluate(() => { const G = GC, N = G.neighbourhood, S = G._svc; return { t: Math.round(G.time), calls: N.calls.map(c => `${c.service}:${c.reason}:${Math.round(Math.hypot(c.unit.x - c.x, c.unit.z - c.z))}m${c.crew ? ':crew' : ''}${c.returning ? ':back' : ''}`).join(' '), bodyGone: !!S.T.gone, carSmoking: !!S.car.smoking, burning: !!S.car.burning, burnt: !!S.car.burnt, inc: G.police.incidents.map(i => i.label + ':' + i.status).join(' | ') }; });
    console.log('services', JSON.stringify(s));
    if (k === 10) await p.screenshot({ path: `${out}/services_a.png` });
    if (s.bodyGone && s.burnt) break;
  }
  await p.screenshot({ path: `${out}/services_end.png` });
  await reset();
}
console.log('page errors:', errors.length, errors.slice(0, 3));
await b.close();
