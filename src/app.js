// Green County · living Berkshire sandbox. Free roam only: no missions, objectives or calls.
import * as THREE from 'three/webgpu';
import { boot } from './main.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Brothers } from './player.js';
import { Traffic } from './traffic.js';
import { Signals, SignalRenderer } from './signals.js';
import { VehicleRenderer } from './vehicles.js';
import { People } from './characters.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { Parking, Buses } from './services.js';
import { Atmos } from './atmos.js';
import { Landmarks } from './landmarks.js';
import { Audio } from './audio.js';
import { Save } from './save.js';
import { Perf } from './perf.js';

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
G.vehicleRenderer = new VehicleRenderer(G.scene, G.renderer.shadowMap.enabled);
G.people = new People(G.scene, G.renderer.shadowMap.enabled);
G.signalRenderer = new SignalRenderer(G.scene, G.net, G.signals);
G.peds = new Peds(G);
G.police = new Police(G);
G.parking = new Parking(G);
G.buses = new Buses(G);
G.traffic.busStop = v => G.buses.stopFor(v);
G.landmarks = new Landmarks(G);
G.atmos = new Atmos(G);
G.shelteredAt = (x, y, z) => G.atmos.sheltered(x, y, z);
G.coverNear = (x, z, r) => G.atmos.coverNear(x, z, r);
G.perf = new Perf(G);
G.audio = new Audio(G);

// ---------------------------------------------------------------- helpers
const districts = G.manifest.districts.map(d => ({ ...d, core: /town centre|Woodley|Wokingham/.test(d.name), coreR: d.name === 'Woodley' ? 300 : 700 }));
G.districtAt = (x, z) => { let best = null, bd = 1e9; for (const d of districts) { const k = Math.hypot(x - d.x, z - d.z) / d.r; if (k < bd) { bd = k; best = d; } } return best; };
G.districtName = (x, z) => { const d = G.districtAt(x, z); return d && Math.hypot(x - d.x, z - d.z) < d.r * 1.25 ? d.name : 'A329 corridor'; };
G.roadName = (x, z) => { const n = G.net.nearest(x, z, 30, e => !!G.net.roadName(e)); return n ? G.net.roadName(n.e) : ''; };
const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
const camInfo = { night: 0, rain: 0, hour: 12, visible: (x, y, z, r) => frustum.intersectsSphere(sph.set(new THREE.Vector3(x, y, z), r + 2)) };
function kerbPlace(x, z, filter) {
  const n = G.net.nearest(x, z, 200, filter || (e => (G.net.flags[e] & 16) && !/primary|trunk|motorway/.test(G.net.classes[G.net.cls[e]])));
  if (!n) return { x, z, heading: 0 };
  const off = G.net.width[n.e] / 2 - 1.0;
  return { x: n.x + n.dz * off, z: n.z - n.dx * off, heading: Math.atan2(n.dz, n.dx), e: n.e };
}
G.teleport = (x, z, heading) => {
  const B = G.brothers, me = B.me, v = B.vehicleOf(me);
  const p = kerbPlace(x, z, e => G.net.walkable(e) || (G.net.flags[e] & 16));
  if (heading != null && Math.cos(p.heading - heading) < 0) {   // face the requested way on a two-way road (keep to the left)
    p.heading += Math.PI; const w = G.net.width[p.e] / 2 - 1.0;
    const n = G.net.nearest(x, z, 200, e => e === p.e); if (n) { p.x = n.x - n.dz * w; p.z = n.z + n.dx * w; }
  }
  if (v) { v.x = p.x; v.z = p.z; v.heading = p.heading; v.y = 0; v.sp = 0; me.x = p.x; me.z = p.z; B.cam.yaw = p.heading + Math.PI; }
  else { me.x = p.x + Math.sin(p.heading) * 2; me.z = p.z - Math.cos(p.heading) * 2; }
  me.y = 0; G._needGround = true;
  G.hud.fade(G.districtName(x, z));
};

// ---------------------------------------------------------------- brothers & their cars
const init = G.save.initialBrothers(START);
G.brothers = new Brothers(G, init);
G.hud = new Hud(G);
for (const sv of G.save.vehicles) {
  const v = G.traffic.add({ id: sv.id, kind: 'parked', model: sv.model, paint: sv.paint, x: sv.x, y: sv.y, z: sv.z, heading: sv.heading, parked: true, free: true, owner: sv.owner, parkedBy: sv.parkedBy });
  if (sv.id.startsWith('p:')) G.save.taken.add(sv.id);
}
if (!G.traffic.byId.has('cal-car')) {
  // both cars on the service road at the north end of the precinct, in view from the start
  const a = kerbPlace(START.x, START.z - 33), b = kerbPlace(START.x - 6, START.z - 33);
  G.traffic.add({ id: 'cal-car', kind: 'parked', model: 'hatch', paint: G.save.legacy?.business?.paint ?? 0x812f42, x: a.x, y: 0, z: a.z, heading: a.heading, parked: true, free: true, owner: 'Cal' });
  G.traffic.add({ id: 'leon-car', kind: 'parked', model: 'estate', paint: 0x223e69, x: b.x - Math.cos(b.heading) * 7, y: 0, z: b.z - Math.sin(b.heading) * 7, heading: b.heading, parked: true, free: true, owner: 'Leon' });
}
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
G.events.on('impact', e => { G.audio.crash(e.x, e.z, Math.min(1, e.speed / 10)); });
G.events.on('horn', e => G.audio.horn(e.x, e.z));
G.events.on('parked', () => G.save.now());

G.simSteps = Number(G.Q.get('sim')) || 1;   // extra simulation substeps per rendered frame (dev/testing)
function frame() {
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (G.Q.get('fixeddt')) dt = Number(G.Q.get('fixeddt'));
  for (let k = 1; k < G.simSteps; k++) step(dt, false);
  step(dt, true);
}
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
  if (!G._needGround) B.update(dt, G.input);
  G.focus.x = me.x; G.focus.z = me.z;
  // standing at a signalised crossing presses the button (calls the pedestrian stage)
  if (!me.vehicle && (G.brothers.speedNow || 0) < 0.3) {
    for (const h of G.signalRenderer.heads) if (h.ped && Math.hypot(h.x - me.x, h.z - me.z) < 5) {
      if (!G.signals.ctl[h.ci].demand && G.signals.ped(h.ci) === 'wait') { G.signals.press(h.ci); if (G._pressT !== h.ci) G.hud.toast('Pressed the crossing button · wait for the green man'); G._pressT = h.ci; }
      break;
    }
  }
  G.tiles.update(me.x, me.z);
  G.signals.update(dt);
  // player as an obstacle for NPC traffic
  const pv = B.vehicleOf(me);
  G.traffic.obstacles = [pv ? { x: pv.x, z: pv.z, r: pv.def.L / 2, v: Math.abs(pv.sp || 0) } : { x: me.x, z: me.z, r: 0.5, v: 0 }];
  G.traffic.update(dt, G.focus, camInfo);
  G.buses.update(dt, G.focus, camInfo);
  G.peds.update(dt, G.focus, camInfo);
  G.police.update(dt);
  G.atmos.updateCover(me.x, me.z);
  G.atmos.updateLights(me.x, me.z);
  G.atmos.updateNearLights(G.camera.position);
  G.landmarks.update();
  if ((G._treeT = (G._treeT || 0) - dt) <= 0) {
    G._treeT = 1; let n = 0;
    for (const t of G.tiles.tiles.values()) if (t.trees && Math.abs(t.data.ox + 128 - me.x) < 300 && Math.abs(t.data.oz + 128 - me.z) < 300) for (const [x, z] of t.trees) if (Math.abs(x - me.x) < 25 && Math.abs(z - me.z) < 25) n++;
    G.treesNear = Math.min(1, n / 8);
  }
  if (!render) return;
  // draw dynamic actors
  const cam = G.camera.position;
  G.vehicleRenderer.draw(G.traffic.list, cam, G.quality === 'low' ? 450 : 700);
  const actors = [B.actor[B.active]]; const o = B.b[1 - B.active]; if (!o.vehicle) actors.push(B.actor[1 - B.active]);
  G.peds.draw(G.people, actors, cam);
  G.signalRenderer.draw(cam, (x, z) => G.tiles.ground(x, z), G.time);
  G.hud.update(dt);
  G.audio.update(dt, G);
  G.updateLighting(); G.placeSun(me.x, me.y, me.z);
  G.U.t.value = G.time;
  G.tiles.signAtlas.flush();
  G.save.tick();
  G.perf.frame(dt);
  // dynamic resolution: hold ~30 fps on unknown phones (pixel ratio 0.7 .. cap)
  if (!G.Q.get('fixedres')) {
    const ms = dt * 1000; G._ema = G._ema ? G._ema * 0.95 + ms * 0.05 : ms;
    G._resT = (G._resT || 0) + dt;
    if (G._resT > 4) {
      G._resT = 0;
      const cap = Math.min(devicePixelRatio, G.quality === 'high' ? 1.5 : 1.35), pr = G.renderer.getPixelRatio();
      let next = pr;
      if (G._ema > 38) next = Math.max(0.7, pr - 0.15); else if (G._ema < 26) next = Math.min(cap, pr + 0.1);
      if (Math.abs(next - pr) > 0.01) { G.renderer.setPixelRatio(next); G.renderer.setSize(innerWidth, innerHeight); }
    }
  }
  G.renderer.render(G.scene, G.camera);
  G.frame++;
}
G.renderer.setAnimationLoop(frame);
