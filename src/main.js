// Green County · Berkshire sandbox bootstrap.
import * as THREE from 'three/webgpu';
import { fog, vec3, float, positionWorld, cameraPosition, length, exp, max, dot, pow, mix, normalize } from 'three/tsl';
import { fetchContainer } from './data.js';
import { Network } from './network.js';
import { repairGaps, alignRoads } from './roadProfile.js';
import { cleanSignals, motorwayLayout, kerbBusStops, applyStops, barriers } from './roadDetail.js';
import { Tiles } from './tiles.js';
import { Trains } from './trains.js';
import { Stations } from './stations.js';
import { U, lightPos, lightCol, NL } from './env.js';
import { createSky } from './sky.js';
import { World } from './weather.js';
import { SignAtlas } from './signs.js';
import { createPost, createIBL } from './post.js';
import { createGrass } from './grass.js';
import { createSkyBake } from './skybake.js';
import { loadSurfaces } from './surfaces.js';
import { budgetFor } from './perf.js';
import { treeFar } from './vegetation.js';

const Q = new URLSearchParams(location.search);
const status = t => { const el = document.getElementById('boot'); if (el) el.textContent = t; };

export async function boot(extra = {}) {
  status('Loading Berkshire…');
  const surfaces = loadSurfaces().catch(e => console.warn('surface textures', e));
  const manifest = await (await fetch('world/manifest.json')).json();
  // roads: rejoin dropped motorway spans, then align bridges, flyovers and their approaches (roadProfile.js)
  const json = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  const [netData, rail, stops] = await Promise.all([fetchContainer('world/network.bin'), json('world/rail.json'), json('world/stops.json')]);
  const addedBridges = repairGaps(netData);
  cleanSignals(netData);
  const net = new Network(netData);
  net.addedBridges = addedBridges;
  alignRoads(net, rail);
  motorwayLayout(net); kerbBusStops(net); applyStops(net, stops); barriers(net);
  // ---------------------------------------------------------------- renderer
  const forceWebGL = Q.get('backend') === 'webgl' || !navigator.gpu;
  const quality = Q.get('quality') || (matchMedia('(pointer:coarse)').matches ? 'medium' : 'high');
  const budget = budgetFor(quality);   // explicit low / medium / high budgets (perf.js)
  // with post-processing on, the scene renders into an offscreen pass and FXAA smooths edges, so canvas MSAA is wasted
  const msaa = budget.antialias && (!budget.post || Q.get('post') === '0');
  const renderer = new THREE.WebGPURenderer({ antialias: msaa, forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  // with FSR the canvas runs at device resolution (capped) and only the 3D scene is rendered smaller
  const fsrOn = budget.fsr && budget.post && Q.get('post') !== '0' && Q.get('fsr') !== '0';
  renderer.setPixelRatio(fsrOn ? Math.min(devicePixelRatio, budget.outPr) : Math.min(devicePixelRatio, budget.pixelRatio[1]));
  renderer.setSize(innerWidth, innerHeight);
  // AgX: filmic highlight roll-off without ACES's hue shifts and over-saturation (?tm=aces to compare)
  renderer.toneMapping = Q.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.shadowMap.enabled = budget.shadow.size > 0 && Q.get('shadows') !== '0';
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
  // normal offset of about two shadow texels (it was 0.6 m: shadows started a hand's breadth from feet and wheels,
  // and nothing shorter than 60 cm cast one; with the map snapped to its texels, two texels show no acne)
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = Math.max(0.2, (2 * E / S) * 2.2);
  scene.add(hemi, sun, sun.target);
  // ---------------------------------------------------------------- world
  // station platforms: the tile worker cuts the ground under them down to the track (stations.js)
  const platforms = rail ? new Stations({ trains: Object.assign(new Trains(null).setup(rail), { ready: true }) }).footprints() : [];
  const tiles = new Tiles(scene, manifest, net, {
    renderer, platforms, railLines: (rail?.lines || []).map(L => ({ p: L.p, off: L.off })),
    shadows: renderer.shadowMap.enabled, r0: Number(Q.get('r0')) || budget.r0, r1: Number(Q.get('r1')) || budget.r1,
    workers: Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)),
  });
  tiles.signAtlas = new SignAtlas();
  tiles.budget = budget;   // bush density per quality (tiles.addBushes)
  treeFar.value = budget.treeDist;   // trees fade out short of where perf.js stops drawing them (vegetation.js)
  const world = new World(extra.weather);
  const G = { THREE, renderer, scene, camera, net, tiles, world, manifest, sun, hemi, sky, backend, quality, budget, Q, U, lightPos, lightCol, NL, rail, frame: 0 };
  window.GC = G;
  if (Q.has('dbg')) { G.TSL = await import('three/tsl'); G.SURF = await import('./surfaces.js'); }
  await surfaces;
  G.post = createPost(G);
  G.ibl = createIBL(G);
  G.grass = createGrass(G);
  G.skyBake = createSkyBake(G);
  G.updateLighting = () => {
    sun.intensity = 4.3 * world.sunIntensity + 0.12 * U.night.value;   // AgX rolls off highlights, so daylight can run brighter
    sun.color.copy(U.sunCol.value).lerp(new THREE.Color(0.6, 0.68, 0.9), U.night.value);
    hemi.intensity = (0.25 + world.skyIntensity * 1.1) * (G.ibl ? 0.35 + U.night.value * 0.65 : 1);
    if (G.ibl) { scene.environmentIntensity = 0.35 + world.skyIntensity * 0.75; G.ibl.groundLum.value = 0.08 + world.day * 0.6; }
    hemi.color.copy(U.zenith.value).lerp(new THREE.Color(0.75, 0.8, 0.9), 0.55);
    hemi.groundColor.setRGB(0.22, 0.22, 0.18).multiplyScalar(0.25 + world.day * 0.75);
    renderer.toneMappingExposure = (0.85 + U.night.value * 0.9 + U.cover.value * 0.25) * (renderer.toneMapping === THREE.AgXToneMapping ? 1.22 : 1);
  };
  // The shadow box follows the player in whole shadow-map texels, measured in the light's own frame, so the map
  // no longer slides under the world as you move (every shadow edge used to crawl and flicker); and it turns with
  // the sun in quarter-degree steps (a shadow edge moves a few centimetres each time) rather than a little every
  // frame. The light's own axes are the shadow camera's: x = up x towards-the-light, y = towards-the-light x x.
  const lightDir = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3(), lc = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0);
  const texel = (2 * E) / S, stepCos = Math.cos(0.25 * Math.PI / 180);
  G.placeSun = (fx, fy, fz) => {
    const d = U.sunDir.value;
    if (lightDir.lengthSq() === 0 || lightDir.dot(d) < stepCos * d.length()) lightDir.copy(d).normalize();
    lx.crossVectors(upY, lightDir); if (lx.lengthSq() < 1e-8) lx.set(1, 0, 0); lx.normalize();
    ly.crossVectors(lightDir, lx);
    lc.set(fx, fy, fz);
    const px = Math.round(lc.dot(lx) / texel) * texel, py = Math.round(lc.dot(ly) / texel) * texel, pz = lc.dot(lightDir);
    lc.copy(lx).multiplyScalar(px).addScaledVector(ly, py).addScaledVector(lightDir, pz);
    sun.position.copy(lc).addScaledVector(lightDir, 300);
    sun.target.position.copy(lc);
    sky.position.copy(camera.position);
  };
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  return G;
}
