// Sky preview: renders the real sky modules (atmosphere, volumetric clouds, sun, moon, stars) over a
// simple street-scale scene at a chosen time, date, weather and view. Used to tune the sky without
// booting the whole world.  bash tools/sky/preview.sh '?hour=12&weather=broken&yaw=180' out.png
//   hour, day (days after 15 June), weather, yaw / pitch (deg), fov, w / h, q (cloud quality), bake=0
import * as THREE from 'three/webgpu';
import { U, loadCloudNoise } from '../../src/env.js';
import { World } from '../../src/weather.js';
import { createSky, backgroundNode } from '../../src/sky.js';
const Q = new URLSearchParams(location.search), num = (k, d) => Q.has(k) ? Number(Q.get(k)) : d;
window.ready = (async () => {
  const W = num('w', 960), H = num('h', 540);
  const renderer = new THREE.WebGPURenderer({ forceWebGL: !Q.has('webgpu'), antialias: true });
  await renderer.init();
  renderer.setSize(W, H); renderer.setPixelRatio(1); document.body.append(renderer.domElement);
  renderer.toneMapping = THREE.AgXToneMapping;
  await loadCloudNoise('../assets/clouds/');
  const world = new World({ seed: num('seed', 7), scale: 30 });
  if (Q.has('day')) { world.s.t += num('day', 0) * 86400; world.s.seg.start = world.s.t; }
  world.setHour(num('hour', 12));
  world.force(Q.get('weather') || 'broken'); world.s.seg.start -= 1800;
  world.s.cloudOff = [num('ox', 0), num('oz', 0)];
  world._sky = null; world.update(0);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(num('fov', 70), W / H, 0.5, 2600);
  const yaw = num('yaw', 180) * Math.PI / 180, pitch = num('pitch', 12) * Math.PI / 180;
  cam.position.set(0, 1.7, 0);
  cam.lookAt(Math.sin(yaw) * Math.cos(pitch), 1.7 + Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));   // yaw 0 = north
  // a little street for scale and for the light colour
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardNodeMaterial({ color: 0x4d5a3a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 6000), new THREE.MeshStandardNodeMaterial({ color: 0x2c2d2f, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2; road.position.y = 0.02; scene.add(road);
  const bm = new THREE.MeshStandardNodeMaterial({ color: 0x8a5a44, roughness: 0.9 });
  for (let i = 0; i < 40; i++) { const h = 6 + (i % 5) * 2.5, b = new THREE.Mesh(new THREE.BoxGeometry(9, h, 8), bm); const s = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    const a = yaw + s * 0.5; b.position.set(Math.sin(a) * (30 + k * 14) + s * Math.cos(yaw) * 14, h / 2, -Math.cos(a) * (30 + k * 14) + s * Math.sin(yaw) * 14); b.rotation.y = -yaw; scene.add(b); }
  const sun = new THREE.DirectionalLight(0xffffff, 3), hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a4030, 1);
  scene.add(sun, hemi);
  const d = U.sunDir.value; sun.position.set(d.x * 300, d.y * 300, d.z * 300);
  sun.intensity = 4.3 * world.sunIntensity + 0.12 * U.night.value;
  sun.color.copy(U.sunCol.value).lerp(new THREE.Color(0.6, 0.68, 0.9), U.night.value);
  hemi.intensity = 0.25 + world.skyIntensity * 1.1;
  hemi.color.copy(U.zenith.value).lerp(new THREE.Color(0.75, 0.8, 0.9), 0.55);
  hemi.groundColor.setRGB(0.22, 0.22, 0.18).multiplyScalar(0.25 + world.day * 0.75);
  renderer.toneMappingExposure = (0.85 + U.night.value * 0.9 + U.cover.value * 0.25) * 1.22;
  const sky = createSky(num('q', 16), { celestial: Q.get('bake') === '0' });
  sky.scale.setScalar(0.45); sky.position.copy(cam.position);
  U.t.value = 10;
  if (Q.get('bake') === '0') scene.add(sky);
  else {
    const rt = new THREE.CubeRenderTarget(num('cube', 512), { type: THREE.HalfFloatType, generateMipmaps: false });
    const cc = new THREE.CubeCamera(1, 8000, rt); cc.position.copy(cam.position);
    const skyScene = new THREE.Scene(); skyScene.add(sky);
    cc.update(renderer, skyScene);
    scene.backgroundNode = backgroundNode(rt.texture);
  }
  const t0 = performance.now();
  renderer.render(scene, cam);
  if (Q.has('glsl')) { const sh = await renderer.debug.getShaderAsync(Q.get('bake') === '0' ? scene : scene, cam, sky); window.__glsl = sh.fragmentShader; }
  return JSON.stringify({ ms: Math.round(performance.now() - t0), sunEl: +(world.sunEl * 57.3).toFixed(1), moonY: +world.moon.y.toFixed(3), moonLit: +world.moonLit.toFixed(2), state: world.stateName(), zenith: U.zenith.value.toArray().map(v => +v.toFixed(3)), horizon: U.horizon.value.toArray().map(v => +v.toFixed(3)) });
})().catch(e => 'ERR ' + e.message + ' ' + e.stack);
