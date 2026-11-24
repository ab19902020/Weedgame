// Shader-check page: builds every material on a WebGPU renderer so its WGSL can be captured (see run.sh).
import * as THREE from 'three/webgpu';
import { terrainMaterial, groundMaterial, markingMaterial, structMaterial, buildingMaterial, lampMaterial, treeMaterials } from '../../src/materials.js';
import { loadSurfaces } from '../../src/surfaces.js';
import { crownGeometry, trunkGeometry } from '../../src/vegetation.js';
import { VehicleRenderer } from '../../src/vehicles.js';
import { People } from '../../src/characters.js';
import { createGrass } from '../../src/grass.js';
import { createPost, createIBL } from '../../src/post.js';
import { createSky } from '../../src/sky.js';
window.__wgsl = [];
if (window.GPUDevice) { const o = GPUDevice.prototype.createShaderModule; GPUDevice.prototype.createShaderModule = function (d) { window.__wgsl.push(d.code); return o.call(this, d); }; }
const log = (...a) => { console.log(...a); document.body.append(a.join(' ') + '\n'); };
window.onerror = e => log('ERR', e);
(async () => {
  try {
    await loadSurfaces('../assets/tex/');
    const r = new THREE.WebGPURenderer({ forceWebGL: location.search.includes('webgl') });
    await r.init();
    log('backend', r.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2');
    if (r.backend.device) r.backend.device.addEventListener('uncapturederror', e => log('GPUERR', e.error.message.slice(0, 800)));
    r.setSize(320, 200); document.body.append(r.domElement);
    r.shadowMap.enabled = true;
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000); cam.position.set(0, 5, 20);
    const sun = new THREE.DirectionalLight(); sun.castShadow = true; scene.add(sun, new THREE.HemisphereLight());
    const geo = () => { const g = new THREE.PlaneGeometry(10, 10, 2, 2); const n = g.attributes.position.count;
      g.setAttribute('aslot', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('bA', new THREE.BufferAttribute(new Float32Array(n * 4).fill(3), 4)); g.setAttribute('lampHead', new THREE.BufferAttribute(new Float32Array(n), 1)); return g; };
    const mats = { terrain: terrainMaterial(), ground: groundMaterial(), mark: markingMaterial(), struct: structMaterial(), building: buildingMaterial(), lamp: lampMaterial() };
    for (const [k, m] of Object.entries(mats)) { const me = new THREE.Mesh(geo(), m); me.castShadow = me.receiveShadow = true; me.name = k; scene.add(me); }
    const tm = treeMaterials();
    const cr = new THREE.InstancedMesh(crownGeometry(), tm.crown, 2); cr.castShadow = true; scene.add(cr);
    const tr = new THREE.InstancedMesh(trunkGeometry(), tm.trunk, 2); scene.add(tr);
    const vr = new VehicleRenderer(scene, true);
    vr.draw(['hatch', 'hothatch', 'saloon', 'estate', 'suv', 'van', 'coupe', 'sports', 'police', 'bus'].map((model, i) => ({ model, x: i * 6, y: 0, z: 0, heading: 0.3, paint: 0xb5121b, spin: 1, lights: true, brake: i % 2 === 0, siren: model === 'police' })), cam.position, 1000);
    const ppl = new People(scene, true);
    const act = (x, pose, extra = {}) => ({ x, y: 0, z: 0, heading: 0.3, visible: true, look: People.randomLook(), pose, speed: 1.2, phase: 1, t: 3, ...extra });
    ppl.draw([act(0, 'umbrella'), act(1, 'phone', { hat: true, hiVis: true }), act(60, 'walk', { fall: 0.5 })], cam.position, 1000);
    scene.add(createSky(4));
    const G = { renderer: r, scene, camera: cam, quality: 'high', Q: new URLSearchParams(''), budget: { post: true, ao: { scale: 0.5, samples: 12 }, bloom: 0.3, ibl: 128, grass: true, ssr: { scale: 0.5, quality: 0.45 }, fsr: true, outPr: 1, scale: [0.5, 0.7, 1] }, tiles: { landcover: () => 0, terrain: () => 0 } };
    const grass = createGrass(G);
    const ibl = createIBL(G); ibl.update(1, true);
    const post = createPost(G);
    // WebGPU allows 8 vertex buffers per pipeline (maxVertexBuffers on phones too): count every
    // attribute a mesh carries plus its instancing buffers (an upper bound on what gets bound)
    scene.traverse(o => {
      if (!o.isMesh) return;
      const n = Object.keys(o.geometry.attributes).length + (o.isInstancedMesh ? 1 + (o.instanceColor ? 1 : 0) : 0);
      if (n > 8) log('VBLIMIT', o.name || o.material.type, n, Object.keys(o.geometry.attributes).join(','));
    });
    await r.compileAsync(scene, cam);
    log('compiled');
    for (let i = 0; i < 3; i++) post.render();
    await new Promise(res => setTimeout(res, 3000));
    log('DONE');
  } catch (e) { log('EXC', e.message, e.stack?.slice(0, 600)); }
})();
