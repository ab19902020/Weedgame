// Green County · Berkshire sandbox bootstrap.
import * as THREE from 'three/webgpu';
import { fog, densityFogFactor, vec3 } from 'three/tsl';
import { fetchContainer } from './data.js';
import { Network } from './network.js';
import { Tiles } from './tiles.js';
import { U, lightPos, lightCol, NL } from './env.js';
import { createSky } from './sky.js';
import { World } from './weather.js';
import { SignAtlas } from './signs.js';
import { budgetFor } from './perf.js';

const Q = new URLSearchParams(location.search);
const status = t => { const el = document.getElementById('boot'); if (el) el.textContent = t; };

export async function boot(extra = {}) {
  status('Loading Berkshire…');
  const manifest = await (await fetch('world/manifest.json')).json();
  const net = new Network(await fetchContainer('world/network.bin'));
  // ---------------------------------------------------------------- renderer
  const forceWebGL = Q.get('backend') === 'webgl' || !navigator.gpu;
  const quality = Q.get('quality') || (matchMedia('(pointer:coarse)').matches ? 'medium' : 'high');
  const budget = budgetFor(quality);   // explicit low / medium / high budgets (perf.js)
  const renderer = new THREE.WebGPURenderer({ antialias: budget.antialias, forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  renderer.setPixelRatio(Math.min(devicePixelRatio, budget.pixelRatio[1]));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = budget.shadow.size > 0 && Q.get('shadows') !== '0';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  renderer.domElement.id = 'view';
  const scene = new THREE.Scene();
  scene.fogNode = fog(vec3(U.fogCol), densityFogFactor(U.fogDensity));
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.4, 2600);
  const sky = createSky(budget.cloudSteps);
  sky.scale.setScalar(0.45);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a4030, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = renderer.shadowMap.enabled;
  // shadow distance and resolution are capped per preset
  const S = budget.shadow.size || 512, E = budget.shadow.extent || 60;
  sun.shadow.mapSize.set(S, S);
  const sc = sun.shadow.camera; sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = 10; sc.far = budget.shadow.far || 450;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  // ---------------------------------------------------------------- world
  const tiles = new Tiles(scene, manifest, net, {
    shadows: renderer.shadowMap.enabled, r0: Number(Q.get('r0')) || budget.r0, r1: Number(Q.get('r1')) || budget.r1,
    workers: Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)),
  });
  tiles.signAtlas = new SignAtlas();
  const world = new World(extra.weather);
  const G = { THREE, renderer, scene, camera, net, tiles, world, manifest, sun, hemi, sky, backend, quality, budget, Q, U, lightPos, lightCol, NL, frame: 0 };
  window.GC = G;
  G.updateLighting = () => {
    sun.intensity = 3.2 * world.sunIntensity + 0.12 * U.night.value;
    sun.color.copy(U.sunCol.value).lerp(new THREE.Color(0.6, 0.68, 0.9), U.night.value);
    hemi.intensity = 0.25 + world.skyIntensity * 1.1;
    hemi.color.copy(U.zenith.value).lerp(new THREE.Color(0.75, 0.8, 0.9), 0.55);
    hemi.groundColor.setRGB(0.22, 0.22, 0.18).multiplyScalar(0.25 + world.day * 0.75);
    renderer.toneMappingExposure = 0.85 + U.night.value * 0.9 + U.cover.value * 0.25;
  };
  G.placeSun = (fx, fy, fz) => {
    const d = U.sunDir.value;
    sun.position.set(fx + d.x * 300, fy + d.y * 300, fz + d.z * 300);
    sun.target.position.set(fx, fy, fz);
    sky.position.copy(camera.position);
  };
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  return G;
}
