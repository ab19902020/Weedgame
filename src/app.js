// Green County · living Berkshire sandbox. Free roam only: no missions, objectives or calls.
import * as THREE from 'three/webgpu';
import { boot } from './main.js';
import { Controller } from './controller.js';
import { CarDynamics } from './carPhysics.js';
import { TyreFx } from './skidmarks.js';
import { Breakables } from './breakables.js';
import { HeroCars } from './heroCars.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Brothers } from './player.js';
import { Transit } from './transit.js';
import { Traffic } from './traffic.js';
import { Signals, SignalRenderer } from './signals.js';
import { VehicleRenderer, MODELS } from './vehicles.js';
import { People } from './characters.js';
import { Neighbourhood } from './neighbourhood.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { Parking, Buses } from './services.js';
import { Atmos } from './atmos.js';
import { Landmarks } from './landmarks.js';
import { Interiors } from './interiors.js';
import { Fuel } from './fuel.js';
import { Combat } from './combat.js';
import { Audio } from './audio.js';
import { Save } from './save.js';
import { deviceProfile, frameTarget, preferenceKey, presets, qualityFor, tuneGraphics } from './graphics.js';
import { Perf } from './perf.js';
import { Trains } from './trains.js';
import { LampGlow } from './lampGlow.js';
import { Stations } from './stations.js';
import { Wildlife } from './wildlife.js';

class Events { constructor() { this.h = {}; } on(n, f) { (this.h[n] ||= []).push(f); } emit(n, e) { for (const f of this.h[n] || []) f(e); } }

// WebGPU devices that fail at runtime fall back to the WebGL2 backend (remembered per device).
const BACKEND_KEY = 'greenCounty.backend', APP_VERSION = '0.6.0';
function guardWebGPU() {
  const q = new URLSearchParams(location.search);
  if (!q.get('backend')) { try { if (localStorage.getItem(BACKEND_KEY) === 'webgl:' + APP_VERSION) { q.set('backend', 'webgl'); history.replaceState(null, '', '?' + q); } } catch { } }
  const bad = /Instance dropped|valid external Instance|Device lost|GPUDevice|createBuffer failed|createRenderPipeline|WGSL/i;
  const fallback = (msg) => {
    if (new URLSearchParams(location.search).get('backend') === 'webgl' || window.__fellBack) return;
    window.__fellBack = true; console.warn('WebGPU failed, switching to WebGL2:', msg);
    try { localStorage.setItem(BACKEND_KEY, 'webgl:' + APP_VERSION); } catch { }
    const q2 = new URLSearchParams(location.search); q2.set('backend', 'webgl'); location.replace('?' + q2);
  };
  addEventListener('error', e => { if (bad.test(String(e.message))) fallback(e.message); });
  addEventListener('unhandledrejection', e => { if (bad.test(String(e.reason && (e.reason.message || e.reason)))) fallback(String(e.reason)); });
}
guardWebGPU();

const START = { x: -2869, z: -2192, h: -Math.PI / 2 };  // Woodley precinct, facing north along the shops

const G = await boot();
G.events = new Events();
G.setQuality = choice => {
  if (!presets.includes(choice)) return;
  if (!G.save.now()) { G.hud.toast('Could not save before changing graphics'); return; }
  const url = new URL(location.href);
  try { localStorage.setItem(preferenceKey,choice); url.searchParams.delete('quality'); }
  catch { url.searchParams.set('quality',choice); }
  url.searchParams.set('graphicsMenu','1');
  location.replace(url.href);
};
const target = () => frameTarget(G.device,G.Q.get('fps'),G.budget?.targetFps);
const tuning = {fps:target(),quiet:0};
G._fps = tuning.fps;
addEventListener('gcdevicechange', () => {
  const previous = target();
  G.device = deviceProfile();
  if (previous !== target()) { G._fps = tuning.fps = target(); tuning.quiet = 0; }
  if (G.hud && qualityFor(G.choice,G.device,G.touch) !== G.quality) G.setQuality(G.choice);
});
G.version = APP_VERSION;
G.retryWebGPU = () => { try { localStorage.removeItem(BACKEND_KEY); } catch { } const q = new URLSearchParams(location.search); q.set('backend', 'webgpu'); G.save.now(); location.replace('?' + q); };
G.useWebGL = () => { try { localStorage.setItem(BACKEND_KEY, 'webgl:' + APP_VERSION); } catch { } const q = new URLSearchParams(location.search); q.set('backend', 'webgl'); G.save.now(); location.replace('?' + q); };
G.time = 0; G.dt = 0;
G.save = new Save(G);
// world clock & weather continue from the save
if (G.save.world) { Object.assign(G.world.s, G.save.world); G.world.update(0); }
if (G.Q.get('time')) G.world.setHour(Number(G.Q.get('time')));
if (G.Q.get('weather')) G.world.force(G.Q.get('weather')), G.world.s.seg.start -= 3600;
if (G.Q.get('scale')) G.world.s.scale = Number(G.Q.get('scale'));
G.input = new Input(document.body);
G.signals = new Signals(G.net);
G.traffic = new Traffic(G.net, G.signals, { seed: (Math.random() * 1e9) | 0 });
G.carDyn = new CarDynamics(G);   // player driving, collisions, struck cars sliding (carPhysics.js)
G.tyreFx = new TyreFx(G.scene);   // skid marks and tyre smoke
G.lampGlow = new LampGlow(G);       // far street lights at night (lampGlow.js)
G.breakables = new Breakables(G);   // street furniture, trees, hedges and walls that give way; crash debris
G.traffic.maxVehicles = G.budget.vehicles; G.traffic.setRadius?.(G.budget.bubble);
G.vehicleRenderer = new VehicleRenderer(G.scene, G.renderer.shadowMap.enabled);
G.vehicleRenderer.heroCars = G.heroCars = new HeroCars(G.scene);   // the brothers' Range Rovers (heroCars.js)
G.people = new People(G.scene, G.renderer.shadowMap.enabled);
G.signalRenderer = new SignalRenderer(G.scene, G.net, G.signals);
G.peds = new Peds(G);
G.police = new Police(G);
G.neighbourhood=new Neighbourhood(G);
G.parking = new Parking(G);
G.buses = new Buses(G);
G.transit = new Transit(G);
G.traffic.busStop = v => G.buses.stopFor(v);
G.trains = new Trains(G);
G.stations = new Stations(G);   // platforms at every station of the lines passengers ride (stations.js)
G.landmarks = new Landmarks(G);
G.atmos = new Atmos(G);
G.fuel = new Fuel(G);             // every car's tank, the fuel gauge and the petrol stations (fuel.js)
G.interiors = new Interiors(G);   // enterable buildings: doors, interiors, the indoor camera (interiors.js)
G.shelteredAt = (x, y, z) => !!G.brothers?.me?.inside || G.atmos.sheltered(x, y, z);
G.coverNear = (x, z, r) => G.atmos.coverNear(x, z, r);
G.perf = new Perf(G);
G.audio = new Audio(G);

// ---------------------------------------------------------------- helpers
const districts = G.manifest.districts.map(d => ({ ...d, core: /town centre|Woodley|Wokingham/.test(d.name), coreR: d.name === 'Woodley' ? 300 : 700 }));
G.districtAt = (x, z) => { let best = null, bd = 1e9; for (const d of districts) { const k = Math.hypot(x - d.x, z - d.z) / d.r; if (k < bd) { bd = k; best = d; } } return best; };
// the district or village you're in, or the nearest one in open country ('near Hurst')
G.districtName = (x, z) => { const d = G.districtAt(x, z); if (!d) return 'Berkshire'; const k = Math.hypot(x - d.x, z - d.z) / d.r; return k < 1.25 ? d.name : k < 4 ? 'near ' + d.name : 'Berkshire'; };
G.roadName = (x, z) => { const n = G.net.nearest(x, z, 30, e => !!G.net.roadName(e)); return n ? G.net.roadName(n.e) : ''; };
const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
const camInfo = { night: 0, rain: 0, hour: 12, visible: (x, y, z, r) => { sph.center.set(x,y,z); sph.radius = r+2; return frustum.intersectsSphere(sph); } };
G.wildlife = new Wildlife(G, camInfo);   // wildlife, farm animals and pets: dogs out with their people, cats (wildlife.js)
function kerbPlace(x, z, filter) {
  const n = G.net.nearest(x, z, 200, filter || (e => (G.net.flags[e] & 16) && !/primary|trunk|motorway/.test(G.net.classes[G.net.cls[e]])));
  if (!n) return { x, z, heading: 0 };
  const off = G.net.width[n.e] / 2 - 1.0;
  return { x: n.x + n.dz * off, z: n.z - n.dx * off, heading: Math.atan2(n.dz, n.dx), e: n.e };
}
G.teleport = (x, z, heading) => {
  const B = G.brothers, me = B.me, v = B.vehicleOf(me), net = G.net;
  const n = net.nearest(x, z, 250, e => (net.flags[e] & 16) && !/motorway|trunk/.test(net.classes[net.cls[e]]));
  if (!n) return;
  let hd = Math.atan2(n.dz, n.dx), dir = 1;
  if (heading != null && Math.cos(hd - heading) < 0 && !(net.flags[n.e] & 1)) { hd += Math.PI; dir = -1; }
  const w = net.width[n.e] / 2;
  // left of the travel direction: (dz,-dx) * dir
  const lx = n.dz * dir, lz = -n.dx * dir;
  if (v) { const o = w - 1.0; v.x = n.x + lx * o; v.z = n.z + lz * o; v.heading = hd; v.y = 0; v.sp = 0; me.x = v.x; me.z = v.z; B.cam.yaw = hd + Math.PI; }
  else { const o = net.pav[n.e] ? w + 1.3 : w + 0.6; me.x = n.x + lx * o; me.z = n.z + lz * o; me.heading = hd; B.cam.yaw = hd + Math.PI; }
  me.y = 0; G._needGround = true;
  G.hud.fade(G.districtName(x, z));
};

// ---------------------------------------------------------------- brothers & their cars
const init = G.save.initialBrothers(START);
G.brothers = new Brothers(G, init);
G.hud = new Hud(G);
G.controller=new Controller(G);
G.combat = new Combat(G);                 // weapons, fists, the brothers' arms (combat.js)
G.people.rigs.onHero = (slot, a, dt) => G.combat.pose(slot, a, dt);
// the brothers' own cars are Range Rovers (older saves had a hatch and an estate under these ids)
const OWN = { 'cal-car': 'rangerover', 'leon-car': 'rangerover' };
for (const sv of G.save.vehicles) {
  const v = G.traffic.add({ id: sv.id, kind: 'parked', model: OWN[sv.id] || sv.model, paint: sv.id === 'cal-car' ? 0x1e4d38 : sv.id === 'leon-car' ? 0xffffff : sv.paint, x: sv.x, y: sv.y, z: sv.z, heading: sv.heading, parked: true, free: true, owner: sv.owner, parkedBy: sv.parkedBy, dmg: Array.isArray(sv.dmg) ? sv.dmg.slice(0, 4) : undefined, fuel: typeof sv.fuel === 'number' ? sv.fuel : undefined });
  if (sv.id.startsWith('p:')) G.save.taken.add(sv.id);
}
if (!G.traffic.byId.has('cal-car')) {
  // both cars on the service road at the north end of the precinct, in view from the start
  const a = kerbPlace(START.x, START.z - 33), b = kerbPlace(START.x - 6, START.z - 33);
  // Cal's is British racing green, Leon's is the white one. Same cabin, wheel and seats in both.
  G.traffic.add({ id: 'cal-car', kind: 'parked', model: 'rangerover', paint: 0x1e4d38, x: a.x, y: 0, z: a.z, heading: a.heading, parked: true, free: true, owner: 'Cal' });
  G.traffic.add({ id: 'leon-car', kind: 'parked', model: 'rangerover', paint: 0xffffff, x: b.x - Math.cos(b.heading) * 7, y: 0, z: b.z - Math.sin(b.heading) * 7, heading: b.heading, parked: true, free: true, owner: 'Leon' });
}
// the brothers' bikes, a scrambler and a road bike, beside the cars (added to older saves too)
if (!G.traffic.byId.has('cal-bike')) {
  const c = G.traffic.byId.get('cal-car'), l = G.traffic.byId.get('leon-car');
  if (c && l) {
    // across the bay from the Range Rovers, nose in, a metre and a half apart
    const mx = (c.x + l.x) / 2, mz = (c.z + l.z) / 2, h = c.heading, fx = Math.cos(h), fz = Math.sin(h), sx = -fz, sz = fx;
    const k = kerbPlace(mx + fx * 12, mz + fz * 12);
    G.traffic.add({ id: 'cal-bike', kind: 'parked', model: 'dirtbike', paint: 0xd0632a, x: k.x, y: 0, z: k.z, heading: k.heading + 0.25, parked: true, free: true, owner: 'Cal' });
    G.traffic.add({ id: 'leon-bike', kind: 'parked', model: 'motorcycle', paint: 0x2b2f36, x: k.x + Math.cos(k.heading) * 2.4, y: 0, z: k.z + Math.sin(k.heading) * 2.4, heading: k.heading + 0.25, parked: true, free: true, owner: 'Leon' });
    void sx; void sz;
  }
}
// the simulated fleet that was around both brothers comes back with the same ids
G.traffic.anchors = G.brothers.b;
G.traffic.restoreFleet(G.save.fleet, i => G.buses.routes.find(r => r.i === i));
// brothers who were driving when the game closed sit in their (parked) car
for (const b of G.brothers.b) { const v = G.brothers.vehicleOf(b); if (v) { v.parked = b !== G.brothers.me; v.player = b === G.brothers.me; } }
G._needGround = true;
if (G.save.migrated) G.hud.toast('Prototype save found · brothers placed where you left them · business progress kept for later', 6);

// ---------------------------------------------------------------- loop
G.focus = { x: G.brothers.me.x, z: G.brothers.me.z };
let last = performance.now(), started = false;
G.tiles.update(G.focus.x, G.focus.z);
G.police.init();
addEventListener('visibilitychange', () => { if (document.hidden) G.save.now(); });
addEventListener('pagehide', () => G.save.now());
G.events.on('impact', e => {
  G.audio.crash(e.x, e.z, Math.min(1, e.speed / 10));
  // a big smash in your own car plays out in slow motion for a moment (?slowmo=0 turns it off)
  if (e.v && e.v.player && e.speed > 13 && !(G.slowmo > 0) && G.Q.get('slowmo') !== '0') G.slowmo = 1.1;
});
G.events.on('horn', e => G.audio.horn(e.x, e.z));
G.events.on('parked', () => G.save.now());

G.simSteps = Number(G.Q.get('sim')) || 1;   // extra simulation substeps per rendered frame (dev/testing)
function frame() {
  const now = performance.now();
  const interval = 1000 / G._fps;
  if (now + .8 < (G._nextFrame || 0)) return;
  const deadline = G._nextFrame || now;
  G._nextFrame = (now-deadline >= interval ? now : deadline) + interval;
  const elapsed = now-last;
  let dt = Math.min(.1,elapsed/1000); last = now;
  G._renderMs = elapsed;
  G.controller.poll(dt);
  if (!G.hud.menu.el.hidden || document.hidden) { G._ema = 0; G._resT = 0; tuning.quiet = 0; return; }
  // a pub game on screen: the world waits (and the phone gets all its time for the game)
  if (G.interiors?.games?.open) { last = now; return; }
  if (G.Q.get('fixeddt')) dt = Number(G.Q.get('fixeddt'));
  if (G.slowmo > 0) { G.slowmo -= dt; dt *= G.slowmo > 0.35 ? 0.3 : 1 - 0.7 * Math.max(0, G.slowmo) / 0.35; }
  G.driveSeconds = Math.min(.5,elapsed/1000)/Math.max(1,Math.ceil(G.simSteps));
  for (let k = 1; k < G.simSteps; k++) step(dt, false);
  step(dt, true);
}
const _fwd = new THREE.Vector3();
function step(dt, render) {
  G.dt = dt; G.time += dt;
  const B = G.brothers, me = B.me;
  // until the ground under the active brother has streamed in, hold position
  if (G._needGround) {
    const gy = G.tiles.terrain(me.x, me.z);
    if (gy != null) {
      if (B.b.some(b => b.migrated)) for (const b of B.b) if (b.migrated) { const p = kerbPlace(b.x, b.z, e => G.net.walkable(e)); b.x = p.x + Math.sin(p.heading) * 1.5; b.z = p.z - Math.cos(p.heading) * 1.5; b.migrated = false; }
      for (const b of B.b) { const g = G.tiles.ground(b.x, b.z); if (g != null) b.y = g; }
      for (const v of G.traffic.list) if (v.free || v.owner) { const g = G.tiles.ground(v.x, v.z, v.y || gy + 1); if (g != null && (!v.y || Math.abs(v.y - g) > 1.5)) v.y = g; }
      G._needGround = false;
      if (!started) { started = true; document.getElementById('boot').textContent = ''; B.cam.yaw = me.heading + Math.PI; }
    }
  }
  pm.multiplyMatrices(G.camera.projectionMatrix, G.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
  G.world.update(dt);
  camInfo.night = G.U.night.value; camInfo.rain = G.world.cur.rain; camInfo.hour = G.world.hours();
  if (!G._needGround) { if (G.perf.fly.active) G.perf.fly.update(); else if (!G.transit.update(dt)) { B.update(dt, G.input); if (!G.interiors.homeTV.seated) G.controller.actions(dt); else { G.controller.hitPressed = false; G.controller.hitHeld = false; } G.combat.update(dt, G.controller.hitPressed, G.controller.hitHeld); } }
  G.focus.x = me.x; G.focus.z = me.z;
  // standing at a signalised crossing presses the button (calls the pedestrian stage)
  if (!me.vehicle && (G.brothers.speedNow || 0) < 0.3) {
    for (const h of G.signalRenderer.heads) if (h.ped && Math.hypot(h.x - me.x, h.z - me.z) < 5) {
      if (!G.signals.ctl[h.ci].demand && G.signals.ped(h.ci) === 'wait') { G.signals.press(h.ci); if (G._pressT !== h.ci) G.hud.toast('Pressed the crossing button · wait for the green man'); G._pressT = h.ci; }
      break;
    }
  }
  { // streaming look-ahead: camera forward and travel velocity
    const fwd = G.camera.getWorldDirection(_fwd), v = G.brothers.vehicleOf(me);
    const sp = v ? (v.sp || 0) : (G.brothers.speedNow || 0), hd = v ? v.heading : me.heading;
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    G.tiles.update(me.x, me.z, { x: fwd.x / fl, z: fwd.z / fl, vx: Math.cos(hd) * sp, vz: Math.sin(hd) * sp });
  }
  G.signals.update(dt);
  // player as an obstacle for NPC traffic
  const pv = B.vehicleOf(me);
  G.traffic.obstacles = G.transit.ride ? [] : [pv ? { x: pv.x, z: pv.z, r: pv.def.L / 2, v: Math.abs(pv.sp || 0) } : { x: me.x, z: me.z, r: 0.5, v: 0 }];
  G.traffic.update(dt, G.focus, camInfo);
  G.carDyn.update(dt);
  G.tyreFx.update(dt, G.world.wind);
  G.breakables.update(dt);
  G.buses.update(dt, G.focus, camInfo);
  G.peds.update(dt, G.focus, camInfo);
  G.wildlife.update(dt);
  G.police.update(dt);
  G.trains.update(dt);
  G.neighbourhood.update(dt);
  G.atmos.updateCover(me.x, me.z);
  G.atmos.updateLights(me.x, me.z);
  G.atmos.updateNearLights(G.camera.position);
  G.landmarks.update();
  G.interiors.update(dt);
  G.fuel.update(dt);
  if ((G._treeT = (G._treeT || 0) - dt) <= 0) {
    G._treeT = 1; let n = 0;
    for (const t of G.tiles.tiles.values()) if (t.trees && Math.abs(t.data.ox + 128 - me.x) < 300 && Math.abs(t.data.oz + 128 - me.z) < 300) for (const [x, z] of t.trees) if (Math.abs(x - me.x) < 25 && Math.abs(z - me.z) < 25) n++;
    G.treesNear = Math.min(1, n / 8);
  }
  if (!render) return;
  // draw dynamic actors
  G.transit.syncCabins(dt);
  if(G.transit.ride)G.transit.riderView(dt,G.transit.riderLook||{dx:0,dy:0});
  const cam = G.camera.position;
  G.vehicleRenderer.draw(G.traffic.list, cam, G.budget.vehicleDist);
  G.trains.draw(cam, Math.max(600, G.budget.vehicleDist * 2));
  const actors = [B.actor[B.active], ...G.transit.people, ...G.neighbourhood.actors, ...G.interiors.people]; const o = B.b[1 - B.active]; if (!o.vehicle) actors.push(B.actor[1 - B.active]);
  const rigs = G.people.rigs;
  if (rigs.previewRole) {
    const heading = B.cam.yaw;
    actors.push({ id:'rig-preview', previewRole:rigs.previewRole, previewClip:rigs.previewClip,
      x:me.x - 1.7*Math.sin(heading), z:me.z + 1.7*Math.cos(heading), y:me.y, heading, visible:true,
      look:B.actor[B.active].look });
  }
  G.combat.beginFrame();
  G.peds.draw(G.people, actors, cam, dt);
  G.wildlife.draw(cam);
  G.signalRenderer.draw(cam, (x, z) => G.tiles.ground(x, z), G.time);
  G.lampGlow.update();
  G.hud.update(dt);
  G.audio.update(dt, G);
  G.updateLighting(); G.placeSun(me.x, me.y, me.z);
  G.U.t.value = G.time;
  G.tiles.signAtlas.flush();
  G.save.tick();
  G.perf.frame(dt);
  G.perf.render.update();   // batching + distance culling within the quality budget
  // dynamic resolution. With FSR the internal render scale moves (the canvas stays at device resolution);
  // otherwise the canvas pixel ratio does. If the frame budget can't be held at the lowest sharp scale,
  // the target drops to 30 fps instead of pixelating further, and returns to 60 when there is headroom.
  if (!G.Q.get('fixedres')) {
    const ms = Math.min(250,G._renderMs);
    if (ms > 0) {
      G._ema = G._ema ? G._ema*.95 + ms*.05 : ms;
      G._resT = (G._resT || 0) + ms/1000;
    }
    if (G._resT >= 3) {
      G._resT = 0;
      const fsr = G.post?.fsr;
      const [min,,max] = fsr ? G.budget.scale : G.budget.pixelRatio;
      const hi = fsr ? max : Math.min(devicePixelRatio,max);
      const current = fsr ? G.post.scale : G.renderer.getPixelRatio();
      const next = tuneGraphics(tuning,G._ema,target(),current,Math.min(min,hi),hi,fsr ? .06 : .1);
      G._fps = tuning.fps;
      if (next !== current) {
        if (fsr) G.post.setScale(next);
        else { G.renderer.setPixelRatio(next); G.renderer.setSize(innerWidth,innerHeight); }
      }
    }
  }
  // first time the world is in: let tiles copy landcover blocks straight to the GPU, and compile every
  // material (all car models, both people LODs, trees, grass, post) up front instead of mid-play
  if (!G._warm && !G._needGround && G.tiles.pending.size === 0 && G.frame > 3) { G._warm = true; G.tiles.gpuReady = true; warmup(); }
  G.skyBake?.update(dt);
  G.ibl?.update(dt);
  G.grass?.update(G.camera.position);
  if (G.post) G.post.render(); else G.renderer.render(G.scene, G.camera);
  G.frame++;
}
async function warmup() {
  const c = G.camera.position, models = Object.keys(MODELS);
  G.vehicleRenderer.draw(models.map((model, i) => ({ model, x: c.x + 2 * i, y: c.y - 30, z: c.z, heading: 0, paint: 0x808080, spin: 0 })), c, 1e6);
  const P = G.people.constructor;
  G.people.draw([0, 1].map(k => ({ x: c.x + k * 80, y: c.y - 30, z: c.z, heading: 0, visible: true, look: P.randomLook(), pose: 'umbrella', speed: 1, phase: 0, t: 0 })), c, 1e6);
  try { await G.renderer.compileAsync(G.scene, G.camera); } catch (e) { console.warn('precompile', e); }
}
if (G.Q.has('graphicsMenu')) {
  const url = new URL(location.href); url.searchParams.delete('graphicsMenu'); history.replaceState(null,'',url);
  G.hud.menu.close(); G.hud.toggleDev();
  const picker = G.hud.el('devJump');
  picker.value = [...picker.options].find(o => o.text === 'Graphics')?.value || '';
  picker.dispatchEvent(new Event('change'));
}
G.renderer.setAnimationLoop(frame);

// headless checks: ?fp=leon or ?fp=cal closes the menu and sits that brother in the driver's seat
if (G.Q.get('fp') || G.Q.get('qa')) {
  globalThis.GC = G;
  G.sitIn = (id) => {
    const v = G.traffic.byId.get(id); if (!v) return false;
    const B = G.brothers, me = B.me;
    const other = B.vehicleOf(me);
    if (other && other !== v) { other.player = false; other.parked = true; other.camInside = false; }
    me.x = v.x; me.z = v.z; me.y = v.y; me.vehicle = v.id;
    v.parked = false; v.player = true; v.free = true; v.hidden = false; v.occupied = null; v.sp = 0;
    B.cam.car = 3; B.cam.lastUser = -10; B.cam.yaw = v.heading + Math.PI;
    return true;
  };
}
if (G.Q.get('fp')) {
  const id = G.Q.get('fp') === 'cal' ? 'cal-car' : 'leon-car';
  const tick = () => {
    if (!G.hud.menu.el.hidden) G.hud.menu.close();
    if (!G._needGround && G.sitIn(id)) return;
    setTimeout(tick, 250);
  };
  setTimeout(tick, 300);
}
