// Green County · Berkshire sandbox bootstrap.
import * as THREE from 'three/webgpu';
import { fog, vec3, float, positionWorld, cameraPosition, length, exp, max, dot, pow, mix, normalize } from 'three/tsl';
import { fetchContainer } from './data.js';
import { Network } from './network.js';
import { Tiles } from './tiles.js';
import { U, lightPos, lightCol, NL } from './env.js';
import { createSky } from './sky.js';
import { World } from './weather.js';
import { SignAtlas } from './signs.js';
import { createPost, createIBL } from './post.js';
import { createGrass } from './grass.js';
import { loadSurfaces } from './surfaces.js';

const Q = new URLSearchParams(location.search);
const status = t => { const el = document.getElementById('boot'); if (el) el.textContent = t; };

export async function boot(extra = {}) {
  status('Loading Berkshire…');
  const surfaces = loadSurfaces().catch(e => console.warn('surface textures', e));
  const manifest = await (await fetch('world/manifest.json')).json();
  const net = new Network(await fetchContainer('world/network.bin'));
  // ---------------------------------------------------------------- renderer
  const forceWebGL = Q.get('backend') === 'webgl' || !navigator.gpu;
  const quality = Q.get('quality') || (matchMedia('(pointer:coarse)').matches ? 'medium' : 'high');
  const renderer = new THREE.WebGPURenderer({ antialias: quality !== 'low', forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1.15));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = quality !== 'low' && Q.get('shadows') !== '0';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  renderer.domElement.id = 'view';
  const scene = new THREE.Scene();
  // aerial perspective: squared-exponential distance fog, thinner with height above the viewer,
  // warmed by sunlight scattered forward around the sun's direction
  {
    const rel = positionWorld.sub(cameraPosition), d = length(rel), v = rel.div(d.max(0.01));
    const hAtt = exp(max(positionWorld.y.sub(cameraPosition.y).add(3), 0).mul(-0.006));
    const dd = U.fogDensity.mul(d);
    const f = float(1).sub(exp(dd.mul(dd).mul(hAtt).negate()));
    const scatter = pow(max(dot(v, normalize(U.sunDir)), 0), 6).mul(float(1).sub(U.cover.mul(0.7))).mul(float(1).sub(U.night));
    const col = mix(vec3(U.fogCol), vec3(U.sunCol).mul(0.9).add(vec3(U.fogCol).mul(0.4)), scatter.mul(0.6));
    scene.fogNode = fog(col, f);
  }
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.4, 2600);
  const sky = createSky(quality === 'high' ? 12 : quality === 'medium' ? 8 : 4);
  sky.scale.setScalar(0.45);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a4030, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 600;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  // ---------------------------------------------------------------- world
  const tiles = new Tiles(scene, manifest, net, {
    shadows: renderer.shadowMap.enabled, r0: Number(Q.get('r0')) || (quality === 'high' ? 420 : 360), r1: Number(Q.get('r1')) || (quality === 'low' ? 800 : 1150),
    workers: Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)),
  });
  tiles.signAtlas = new SignAtlas();
  const world = new World(extra.weather);
  const G = { THREE, renderer, scene, camera, net, tiles, world, manifest, sun, hemi, sky, backend, quality, Q, U, lightPos, lightCol, NL, frame: 0 };
  window.GC = G;
  if (Q.has('dbg')) { G.TSL = await import('three/tsl'); G.SURF = await import('./surfaces.js'); }
  await surfaces;
  G.post = createPost(G);
  G.ibl = createIBL(G);
  G.grass = createGrass(G);
  G.updateLighting = () => {
    sun.intensity = 3.2 * world.sunIntensity + 0.12 * U.night.value;
    sun.color.copy(U.sunCol.value).lerp(new THREE.Color(0.6, 0.68, 0.9), U.night.value);
    hemi.intensity = (0.25 + world.skyIntensity * 1.1) * (G.ibl ? 0.35 + U.night.value * 0.65 : 1);
    if (G.ibl) { scene.environmentIntensity = 0.35 + world.skyIntensity * 0.75; G.ibl.groundLum.value = 0.08 + world.day * 0.6; }
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
