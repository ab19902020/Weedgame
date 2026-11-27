// Procedural, instanced vehicles. Simulation owns vehicle state; this module only draws.
import * as THREE from 'three/webgpu';
import { Fn, attribute, vec2, vec3, float, int, mix, step, sin, fract, floor, positionLocal, positionGeometry, instanceIndex, select, abs, length, smoothstep, uniformArray } from 'three/tsl';
import { motorcycleMesh } from './motorcycles.js';
import { U, cloudShadow } from './env.js';
import { mergeGeos } from './tiles.js';
import { lightPool } from './materials.js';
import { buildCar, vehicleMaterial, wheelGeometry, wheelMaterial, CAR_SPECS } from './carModel.js';
import { positionWorld, texture, uv } from 'three/tsl';

const FAR_LOD = 70;   // metres: beyond this cars use the light body
export const MODELS = {
  evsaloon:{ L:4.77,W:1.87,H:1.49,wb:2.88,wr:.34,prof:'saloon',max:60,mass:1850 },
  evsuv:{ L:4.56,W:1.91,H:1.77,wb:2.75,wr:.36,prof:'suv',max:50,mass:2090 },
  bicycle:{ L:1.79,W:.59,H:1.06,wb:1.08,wr:.35,prof:'cycle',max:45,mass:90,wheels:2,tyre:.035 },
  ebike:{ L:1.85,W:.63,H:1.10,wb:1.14,wr:.355,prof:'cycle',max:36,mass:108,wheels:2,tyre:.053 },
  hatch: { L: 4.05, W: 1.74, H: 1.47, wb: 2.5, wr: 0.31, prof: 'hatch', max: 220, mass: 1150 },
  saloon: { L: 4.65, W: 1.8, H: 1.45, wb: 2.75, wr: 0.32, prof: 'saloon', max: 160, mass: 1400 },
  estate: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 120, mass: 1500 },
  suv: { L: 4.45, W: 1.85, H: 1.66, wb: 2.65, wr: 0.36, prof: 'suv', max: 100, mass: 1700 },
  van: { L: 5.3, W: 2.02, H: 2.35, wb: 3.3, wr: 0.34, prof: 'van', max: 60, mass: 2200 },
  ambulance: { L:5.3,W:2.02,H:2.55,wb:3.3,wr:.35,prof:"van",max:5,mass:3600,livery:3 },
  fire: { L:7.3,W:2.38,H:3.15,wb:4.1,wr:.44,prof:"van",max:3,mass:8000,livery:2 },
  police: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 16, mass: 1550, livery: 1 },
  hothatch: { L: 4.28, W: 1.79, H: 1.45, wb: 2.63, wr: 0.33, prof: 'hatch', max: 40, mass: 1350 },
  coupe: { L: 4.64, W: 1.83, H: 1.38, wb: 2.81, wr: 0.34, prof: 'saloon', max: 30, mass: 1550 },
  sports: { L: 4.52, W: 1.95, H: 1.2, wb: 2.62, wr: 0.35, prof: 'saloon', max: 12, mass: 1450 },
  // the brothers' own car: a hand-made model drawn by heroCars.js (wheelbase centre 0.12 m ahead of the body centre)
  rangerover: { L: 4.95, W: 2.02, H: 1.9, wb: 2.91, wr: 0.42, prof: 'glb', max: 6, mass: 2450, glb: 'rangerover', wx: 0.12 },
  bus: { L: 10.6, W: 2.55, H: 4.3, wb: 5.6, wr: 0.5, prof: 'decker', max: 30, mass: 12000 },
  busS: { L: 11.2, W: 2.5, H: 3.05, wb: 5.9, wr: 0.5, prof: 'single', max: 20, mass: 10000 },
  // town two-wheelers: drawn as a frame plus a rider, two wheels on the centreline
  dirtbike: { L:2.15,W:.82,H:1.22,wb:1.47,wr:.335,prof:'enduro',max:28,mass:200,wheels:2,tyre:.105 },
  motorcycle: { L:2.18,W:.84,H:1.1,wb:1.53,wr:.315,prof:'roadbike',max:40,mass:295,wheels:2,tyre:.145 },
  moped: { L: 1.85, W: 0.72, H: 1.15, wb: 1.25, wr: 0.28, prof: 'moped', max: 70, mass: 180, wheels: 2, tyre: 0.07 },
  escooter: { L: 1.15, W: 0.55, H: 1.2, wb: 0.85, wr: 0.15, prof: 'scooter', max: 50, mass: 30, wheels: 2, tyre: 0.045 },
  // the supplied car pack ("Generic passenger car pack" by Comrade1280, CC-BY-4.0; tools/vehicles/bake-car-pack.py):
  // textured bodies drawn by their own material, our wheels at the measured axles and track
  compact: { L: 3.26, W: 1.61, H: 1.32, wb: 2.08, wr: 0.24, wx: -0.07, track: 1.13, prof: 'hatch', max: 30, mass: 1050, pack: 'compact' },
  coupe2: { L: 4.24, W: 1.88, H: 1.28, wb: 2.41, wr: 0.3, wx: -0.02, track: 1.33, prof: 'saloon', max: 30, mass: 1400, pack: 'coupe2' },
  hatch2: { L: 3.96, W: 1.74, H: 1.35, wb: 2.4, wr: 0.3, wx: -0.04, track: 1.38, prof: 'hatch', max: 30, mass: 1150, pack: 'hatch2' },
  minivan: { L: 4.61, W: 1.87, H: 1.76, wb: 2.84, wr: 0.32, wx: -0.07, track: 1.41, prof: 'van', max: 30, mass: 1800, pack: 'minivan' },
  offroad: { L: 3.94, W: 1.96, H: 1.57, wb: 2.32, wr: 0.36, wx: 0.06, track: 1.47, prof: 'suv', max: 20, mass: 1900, pack: 'offroad' },
  pickup: { L: 5.18, W: 2.07, H: 1.7, wb: 3.19, wr: 0.38, wx: 0.12, track: 1.46, prof: 'suv', max: 20, mass: 2100, pack: 'pickup' },
  sedan: { L: 4.36, W: 1.94, H: 1.34, wb: 2.62, wr: 0.3, wx: 0.01, track: 1.4, prof: 'saloon', max: 30, mass: 1450, pack: 'sedan' },
  sport2: { L: 3.91, W: 1.77, H: 1.04, wb: 2.45, wr: 0.31, wx: -0.12, track: 1.37, prof: 'saloon', max: 12, mass: 1300, pack: 'sport2' },
  suv2: { L: 4.61, W: 2.07, H: 1.73, wb: 2.73, wr: 0.38, wx: 0.07, track: 1.46, prof: 'suv', max: 30, mass: 1900, pack: 'suv2' },
  wagon: { L: 4.38, W: 1.95, H: 1.38, wb: 2.63, wr: 0.3, wx: 0.02, track: 1.4, prof: 'estate', max: 30, mass: 1500, pack: 'wagon' },
};
// the car pack joins the traffic mix once it has loaded (VehicleRenderer.loadPack)
export const PACK = { ready: false, names: Object.keys(MODELS).filter(k => MODELS[k].pack), weights: { compact: 1, coupe2: 0.5, hatch2: 1.4, minivan: 0.8, offroad: 0.4, pickup: 0.35, sedan: 1.2, sport2: 0.15, suv2: 1, wagon: 1 } };
PACK.total = PACK.names.reduce((a, k) => a + PACK.weights[k], 0);

// a car-pack body: its own texture, repainted per car where the texture shows the original paint (ref, linear; null
// keeps the texture's colours), dark glass, and lamps that light with the car's lights and brakes (front +x)
function packMaterial(tex, ref) {
  // (satin, no clearcoat: the textures already carry the body's shading, and a clearcoat turned dark cars into mirrors)
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 });
  const part = attribute('part', 'float'), t = texture(tex, uv()).rgb, ip = attribute('iPaint', 'vec3'), st = attribute('iState', 'vec4');
  const glass = step(0.5, part).mul(step(part, 1.5)), lamp = step(1.5, part), body = float(1).sub(glass).sub(lamp);
  let paint = t;
  if (ref) {
    // texels near the original paint colour (compared in display space) take the car's paint, keeping their light and
    // shade as a brightness ratio (a per-channel ratio blew dark reds up into white)
    // (by hue: the textures' tops are lighter than their sides, so a match on the colour itself missed bonnets and roofs)
    const P = vec3(ref[0], ref[1], ref[2]), g = vec3(1 / 2.2), lum = c => c.x.mul(0.2126).add(c.y.mul(0.7152)).add(c.z.mul(0.0722));
    const tS = t.max(0).pow(g), pS = P.pow(g), mean = c => c.x.add(c.y).add(c.z).div(3);
    const cT = tS.sub(mean(tS)), cP = pS.sub(mean(pS));
    const satT = length(cT), satP = length(cP), same = cT.dot(cP).div(satT.mul(satP).max(1e-5));   // (grey texels: no hue, no NaN)
    const w = smoothstep(0.82, 0.94, same).mul(smoothstep(0.2, 0.45, satT.div(satP.max(0.01)))).mul(body);
    paint = mix(t, ip.mul(lum(t).div(lum(P).max(0.004)).clamp(0.35, 1.8)), w);
  }
  const col = mix(mix(paint, vec3(0.012, 0.015, 0.02), glass), t, lamp);
  m.colorNode = col.mul(cloudShadow(positionWorld));
  m.roughnessNode = mix(mix(float(0.55), float(0.08), glass), float(0.25), lamp);
  // headlamps (not red) at the front with the lights on; tail lamps (red) at the back, brighter on the brakes
  const brake = step(0.5, fract(st.x.mul(0.5))), lights = st.y, front = step(0, positionGeometry.x);
  const red = step(t.g.mul(1.6), t.r).mul(step(0.22, t.r));
  const head = lamp.mul(front).mul(float(1).sub(red)).mul(lights).mul(2.6);
  const tail = lamp.mul(float(1).sub(front)).mul(red).mul(lights.mul(0.9).add(brake.mul(2.6)));
  m.emissiveNode = t.mul(head.add(tail)).add(lightPool(positionWorld).mul(col));
  return m;
}

function profile(kind, L, H) {
  const l = L / 2;
  switch (kind) {
    case 'hatch': return [[-l, 0.28], [-l, 0.95], [-l + 0.12, 1.12], [-l + 0.35, H], [l - 1.75, H], [l - 0.95, 1.02], [l - 0.12, 0.88], [l, 0.62], [l, 0.28]];
    case 'saloon': return [[-l, 0.3], [-l, 0.9], [-l + 0.5, 1.0], [-l + 1.15, H], [l - 1.85, H], [l - 1.05, 1.0], [l - 0.1, 0.86], [l, 0.62], [l, 0.3]];
    case 'estate': return [[-l, 0.3], [-l, 0.95], [-l + 0.12, H - 0.05], [-l + 0.3, H], [l - 1.85, H], [l - 1.05, 1.0], [l - 0.1, 0.86], [l, 0.62], [l, 0.3]];
    case 'suv': return [[-l, 0.38], [-l, 1.05], [-l + 0.12, H - 0.05], [-l + 0.3, H], [l - 1.6, H], [l - 0.95, 1.1], [l - 0.1, 0.98], [l, 0.72], [l, 0.38]];
    case 'van': return [[-l, 0.32], [-l, H - 0.05], [-l + 0.1, H], [l - 1.25, H], [l - 0.55, 1.25], [l - 0.08, 1.05], [l, 0.75], [l, 0.32]];
    case 'decker': return [[-l, 0.32], [-l, H - 0.15], [-l + 0.2, H], [l - 0.2, H], [l, H - 0.15], [l, 0.32]];
    default: return [[-l, 0.32], [-l, H - 0.12], [-l + 0.2, H], [l - 0.25, H], [l, H - 0.25], [l, 0.32]];
  }
}

// wheel x offset per model (front-engined cars sit their wheels forward of the body centre)
for (const [k, d] of Object.entries(MODELS)) if (!d.glb && !d.pack) d.wx = CAR_SPECS[k] ? (CAR_SPECS[k].wheelX || 0) * d.L / 2 : 0;
const MODEL_LIST = Object.entries(MODELS);
// traffic mix (UK-ish), and paints: sports models get brighter colours
export function randomModel(r) {
  // about four cars in ten from the car pack, by how common each kind is (once it's loaded)
  if (PACK.ready) { const q = (r * 7.31) % 1; if (q < 0.4) { let t = ((r * 53.7) % 1) * PACK.total; for (const k of PACK.names) { t -= PACK.weights[k]; if (t <= 0) return k; } return PACK.names[0]; } }
  return r < .065 ? 'evsaloon' : r < .115 ? 'evsuv' : r < 0.31 ? 'hatch' : r < 0.52 ? 'saloon' : r < 0.65 ? 'estate' : r < 0.8 ? 'suv' : r < 0.9 ? 'van' : r < 0.95 ? 'hothatch' : r < 0.985 ? 'coupe' : 'sports';
}
const SPORT_PAINTS = [0xb5121b, 0xe8e8e8, 0x111111, 0x1446a0, 0xf2b705, 0xe25a12, 0x2f6d3a, 0x7d8085];
export function paintFor(model, r) { return (model === 'sports' || model === 'coupe' || model === 'hothatch') ? SPORT_PAINTS[Math.floor(r * SPORT_PAINTS.length)] : PAINTS[Math.floor(r * PAINTS.length)]; }

function buildModel(def, key, lod = 0) {
  if (def.wheels === 2) return motorcycleMesh(key === 'dirtbike', false, key);
  if (CAR_SPECS[key]) { const g = mergeGeos(buildCar(def, key, MODEL_LIST.findIndex(([k]) => k === key) + 1, lod).parts); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
  const { L, W, H, prof } = def;
  const isBus = prof === 'decker' || prof === 'single';
  const belt = isBus ? 1.25 : prof === 'van' ? 1.2 : 0.98;
  let body;
  if (true) {   // buses and the fire engine: extruded side profile (cars come from carModel.js)
    const shape = new THREE.Shape(profile(prof, L, H).map(([x, y]) => new THREE.Vector2(x, y)));
    body = new THREE.ExtrudeGeometry(shape, { depth: W - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, steps: 1 });
    body.translate(0, 0, -(W - 0.08) / 2);
    body = body.toNonIndexed(); body.computeVertexNormals();
  }
  // per-vertex classification: paint / glass / trim / lights
  const pos = body.attributes.position, nor = body.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3), paint = new Float32Array(n), lit = new Float32Array(n), liv = new Float32Array(n);
  for (let t = 0; t < n; t += 3) {
    let cy = 0, cx = 0, cz = 0, ny = 0, nx = 0, nz = 0;
    for (let k = 0; k < 3; k++) { cy += pos.getY(t + k) / 3; cx += pos.getX(t + k) / 3; cz += pos.getZ(t + k) / 3; ny += nor.getY(t + k) / 3; nx += nor.getX(t + k) / 3; nz += nor.getZ(t + k) / 3; }
    let glass = false;
    if (isBus) {
      const bands = prof === 'decker' ? [[1.3, 2.05], [2.55, 3.85]] : [[1.25, 2.55]];
      glass = Math.abs(ny) < 0.5 && bands.some(([a, b]) => cy > a && cy < b) && Math.abs(cx) < L / 2 - 0.15;
      if (Math.abs(nx) > 0.6 && cx > 0 && cy > 0.9 && cy < H - 0.3) glass = true; // windscreen
    } else if (body.attributes.glassQ) {
      glass = body.attributes.glassQ.getX(t) > 0.5 && !(prof === 'van' && Math.abs(nz) > 0.6 && cx < L / 2 - 1.3);
    } else {
      glass = cy > belt && cy < H - 0.04 && ny < 0.85 && !(prof === 'van' && Math.abs(nz) > 0.6 && cx < L / 2 - 1.3);
    }
    for (let k = 0; k < 3; k++) {
      const v = t + k;
      if (glass) { col[v * 3] = 0.05; col[v * 3 + 1] = 0.07; col[v * 3 + 2] = 0.09; paint[v] = 0; lit[v] = 14; }
      else if (cy < (isBus ? 0.42 : def.prof === 'suv' ? 0.5 : 0.36)) { col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 0.05; paint[v] = 0; }
      else { paint[v] = 1; col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 1; liv[v] = def.livery && Math.abs(nz) > 0.5 && cy < belt && cy > 0.45 ? 1 : 0; }
    }
  }
  // per-vertex flags packed into one vec4 (paint, lit, livery, model index + 1): WebGPU allows only
  // 8 vertex buffers per pipeline and instancing already takes three (matrix, iState, iPaint)
  const vdat = new Float32Array(n * 4), mi = isBus ? 0 : Object.values(MODELS).indexOf(def) + 1;
  for (let v = 0; v < n; v++) { vdat[v * 4] = paint[v]; vdat[v * 4 + 1] = lit[v]; vdat[v * 4 + 2] = liv[v]; vdat[v * 4 + 3] = mi; }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.setAttribute('vdat', new THREE.BufferAttribute(vdat, 4));
  body.deleteAttribute('glassQ');
  const parts = [body];
  const add = (g, rgb, p, l, lv = 0) => {
    g = g.toNonIndexed(); const c = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c * 3).map((_, i) => rgb[i % 3]), 3));
    g.setAttribute('vdat', new THREE.BufferAttribute(new Float32Array(c * 4).map((_, i) => [p, l, lv, 0][i % 4]), 4));
    parts.push(g);
  };
  const l = L / 2, hy = isBus ? 0.75 : prof === 'van' ? 0.95 : 0.78;
  for (const s of [-1, 1]) {
    const inset = isBus ? 0.01 : -0.11;
    add(new THREE.BoxGeometry(0.12, 0.13, 0.36).translate(l + inset, hy, s * (W / 2 - 0.3)), [0.9, 0.9, 0.85], 0, 1);      // headlights
    add(new THREE.BoxGeometry(0.12, 0.15, 0.3).translate(-l - inset, hy + 0.08, s * (W / 2 - 0.27)), [0.5, 0.04, 0.03], 0, 2); // tail / brake
    if (!isBus) add(new THREE.BoxGeometry(0.22, 0.12, 0.06).translate(l - (prof === 'van' ? 1.1 : 1.75), belt + 0.06, s * (W / 2 + 0.03)), [0.08, 0.08, 0.08], 0, 0); // mirrors
  }
  add(new THREE.BoxGeometry(0.05, 0.11, 0.52).translate(-l - 0.01, 0.45, 0), [0.95, 0.8, 0.1], 0, 0); // rear plate
  add(new THREE.BoxGeometry(0.05, 0.11, 0.52).translate(l + 0.01, 0.45, 0), [0.95, 0.95, 0.92], 0, 0); // front plate
  if (!isBus) add(new THREE.BoxGeometry(0.05, 0.16, W * 0.42).translate(l + 0.0, hy - 0.16, 0), [0.03, 0.03, 0.035], 0, 0); // grille
  if (def.livery) {
    add(new THREE.BoxGeometry(0.35, 0.1, 1.2).translate(-0.4, H + 0.05, 0), [0.1, 0.1, 0.12], 0, 3); // light bar
  }
  if(def.livery===2){
    for(const side of [-1,1]){
      add(new THREE.BoxGeometry(4.1,1.25,.04).translate(-.65,1.62,side*W/2),[.54,.56,.58],0,0);
      add(new THREE.BoxGeometry(4.9,.12,.04).translate(-.65,.88,side*W/2),[.95,.82,.19],0,0);
      add(new THREE.BoxGeometry(4.9,.10,.10).translate(-.65,H+.12,side*.4),[.62,.64,.67],0,0);
    }
    for(let x=-2.9;x<1.8;x+=.48)add(new THREE.BoxGeometry(.07,.08,.82).translate(x,H+.12,0),[.55,.57,.59],0,0);
  }
  if (isBus) for(const side of [-1,1]){
    for(const y of (prof==='decker'?[1.64,3.16]:[1.90])){
      for(let bay=0;bay<6;bay++){
        const x=-l+.95+bay*(L-1.9)/5;
        add(new THREE.BoxGeometry((L-1.9)/5-.10,.82,.034).translate(x,y,side*(W/2+.006)),[.075,.12,.15],0,14);
      }
    }
    if(side<0)for(const offset of [-.59,0,.59]){
      add(new THREE.BoxGeometry(.046,1.9,.06).translate(l-1.5+offset,1.37,side*(W/2+.03)),[.045,.056,.061],0,0);
    }
    add(new THREE.BoxGeometry(.14,.26,.11).translate(l-.67,2.15,side*(W/2+.13)),[.09,.11,.12],0,0);
  }
  if(def.livery===2) for(const side of [-1,1]){
    for(let row=0;row<8;row++)add(new THREE.BoxGeometry(4.05,.019,.035).translate(-.65,1.12+row*.14,side*(W/2+.02)),[.29,.32,.34],0,0);
    for(let i=0;i<4;i++)add(new THREE.BoxGeometry(.045,1.22,.054).translate(-2.63+i*1.31,1.62,side*(W/2+.018)),[.24,.28,.30],0,0);
    add(new THREE.BoxGeometry(3.95,.08,.19).translate(-.68,.69,side*W/2),[.54,.57,.6],0,0);
  }
  if (isBus) add(new THREE.BoxGeometry(0.06, 0.28, 1.6).translate(l + 0.01, H - 0.45, 0), [0.05, 0.05, 0.05], 0, 4); // destination blind
  const g = mergeGeos(parts);
  if (g.attributes.uv) g.deleteAttribute('uv');   // WebGPU: 8 vertex buffers per pipeline, instancing uses four
  return g;
}

export class VehicleRenderer {
  // the car pack (tools/vehicles/bake-car-pack.py): geometries, one material per car (its own paint reference), then
  // it joins the traffic mix
  async loadPack() {
    try {
      const [J, buf, tex] = await Promise.all([fetch('vehicles/carpack.json').then(r => r.json()), fetch('vehicles/carpack.bin').then(r => r.arrayBuffer()), new THREE.TextureLoader().loadAsync('vehicles/carpack.jpg')]);
      tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4;
      const L = J.layout, V = J.vertices;
      const pos = new Float32Array(buf, L.position.offset, V * 3), nq = new Int8Array(buf, L.normal.offset, V * 4), uq = new Uint16Array(buf, L.uv.offset, V * 2);
      const pt = new Uint8Array(buf, L.part.offset, V), idx = new Uint16Array(buf, L.index.offset, J.indices);
      for (const c of J.cars) {
        const def = MODELS[c.name]; if (!def) continue;
        const n = c.vCount, v0 = c.vStart, N = new Float32Array(n * 3), UV = new Float32Array(n * 2), T = new Float32Array(n);
        for (let i = 0; i < n; i++) { const j = v0 + i; N[i * 3] = nq[j * 4] / 127; N[i * 3 + 1] = nq[j * 4 + 1] / 127; N[i * 3 + 2] = nq[j * 4 + 2] / 127; UV[i * 2] = uq[j * 2] / 65535; UV[i * 2 + 1] = uq[j * 2 + 1] / 65535; T[i] = pt[j]; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos.slice(v0 * 3, (v0 + n) * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
        g.setAttribute('part', new THREE.BufferAttribute(T, 1));
        g.setIndex(new THREE.BufferAttribute(idx.slice(c.iStart, c.iStart + c.iCount), 1));
        const ref = c.paint ? new THREE.Color().setRGB(c.paint[0], c.paint[1], c.paint[2], THREE.SRGBColorSpace) : null;
        this.meshes[c.name] = this.far[c.name] = this.make(def, g, this.shadowsOn, packMaterial(tex, ref && [ref.r, ref.g, ref.b]));
      }
      PACK.ready = true;
    } catch (e) { console.warn('car pack', e); }
  }
  constructor(scene, shadows) {
    this.meshes = {}; this.idx = {};
    const mat = vehicleMaterial(MODEL_LIST);
    this.mat = mat;
    const wheelGeo = wheelGeometry();
    this.iWheel = new THREE.InstancedBufferAttribute(new Float32Array(1500 * 4), 4); this.iWheel.setUsage(THREE.DynamicDrawUsage);
    wheelGeo.setAttribute('iWheel', this.iWheel);
    const wm = wheelMaterial();
    this.wheels = new THREE.InstancedMesh(wheelGeo, wm, 1500);
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.frustumCulled = false; this.wheels.count = 0; scene.add(this.wheels);
    // two levels of detail per car model: full detail near the camera, a light body beyond FAR_LOD m
    this.far = {};
    const make = (def, g, shadow, material = mat) => {
      const st = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4); st.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iState', st);
      const pa = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 3), 3); pa.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iPaint', pa);
      const dg = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4); dg.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iDmg', dg);
      const m = new THREE.InstancedMesh(g, material, def.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = false;
      scene.add(m); return m;
    };
    this.make = make; this.shadowsOn = shadows; this.scene = scene;
    this.loadPack();
    for (const [name, def] of Object.entries(MODELS)) {
      if (def.glb || def.pack) continue;   // drawn by heroCars.js / loaded with the car pack
      this.meshes[name] = make(def, buildModel(def, name), shadows);
      this.far[name] = CAR_SPECS[name] ? make(def, buildModel(def, name, 1), false) : this.meshes[name];
    }
    this.riders = {};
    const riderMaterial = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83});
    for(const name of ['dirtbike','motorcycle','bicycle','ebike','escooter','moped']){
      const geometry=motorcycleMesh(name==='dirtbike',true,name);
      const riders=new THREE.InstancedMesh(geometry,riderMaterial,MODELS[name].max);
      riders.count=0;riders.frustumCulled=false;riders.castShadow=shadows;
      riders.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(riders);this.riders[name]=riders;
    }
    // Cycle legs follow opposite pedals. All riders share the same two limb meshes.
    this.legs = [0x324151,0x40505e].map(colour => {
      const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.059,.047,1,7),new THREE.MeshStandardMaterial({color:colour}),2*(MODELS.bicycle.max+MODELS.ebike.max));
      mesh.count=0; mesh.frustumCulled=false; scene.add(mesh); return mesh;
    });
    const shoeGeometry=new THREE.BoxGeometry(.22,.085,.095).translate(.045,.025,0);
    this.feet=new THREE.InstancedMesh(shoeGeometry,new THREE.MeshStandardMaterial({color:0x2c3033}),this.legs[0].instanceMatrix.count);
    this.feet.count=0;this.feet.frustumCulled=false;scene.add(this.feet);
    this.legMatrix=new THREE.Matrix4(); this.legQuat=new THREE.Quaternion();
    this.legDir=new THREE.Vector3(); this.legMid=new THREE.Vector3(); this.legScale=new THREE.Vector3(); this.legUp=new THREE.Vector3(0,1,0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color(); this._w = new THREE.Matrix4();
    this._g = new THREE.Matrix4(); this._sm = new THREE.Matrix4(); this._steer = new THREE.Matrix4();
    // soft contact shadow under every nearby car (one draw call)
    this.shadows = new THREE.InstancedMesh(contactGeometry(), contactMaterial(), 400);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false; this.shadows.count = 0; this.shadows.renderOrder = 1;
    scene.add(this.shadows);
    // headlight pools on the road ahead of cars with their lights on (additive, one draw call)
    this.beams = new THREE.InstancedMesh(beamGeometry(), beamMaterial(), 300);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false; this.beams.count = 0; this.beams.renderOrder = 2;
    scene.add(this.beams);
    // One player spotlight lights road geometry, signs and walls as the road changes grade.
    // (High only: a light in the scene is paid for by every pixel of every lit surface, on or off, so on Low and
    // Medium the headlights are the light pools drawn on the road (beams) and this is a stand-in that lights nothing)
    if (shadows) { this.drivingLamp = new THREE.SpotLight(0xffedd5,0,100,.44,.56,2); scene.add(this.drivingLamp,this.drivingLamp.target); }
    else this.drivingLamp = { position: new THREE.Vector3(), target: { position: new THREE.Vector3() }, intensity: 0, distance: 0, angle: 0 };
    this.t0 = performance.now();
  }
  // sprung body: pitch under braking and acceleration, roll in corners, with a little overshoot
  suspension(v, dt) {
    const S = v._sus || (v._sus = { p: 0, r: 0, vp: 0, vr: 0, s: v.v ?? Math.abs(v.sp || 0), h: v.heading, steer: 0 });
    const sp = v.v ?? Math.abs(v.sp || 0);
    let along, lat;
    if (v.ph && v.player) { along = v.ph.ax; lat = v.ph.ay; }
    else {
      let dh = v.heading - S.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      along = Math.max(-11, Math.min(6, (sp - S.s) / dt)); lat = Math.max(-9, Math.min(9, sp * dh / dt));
      // AI front wheels steer with the path's curvature
      if (!v.player && sp > 0.5) S.steer += (Math.max(-0.5, Math.min(0.5, Math.atan(dh / dt * MODELS[v.model].wb / sp))) - S.steer) * Math.min(1, dt * 6);
      if (!v.player) v.steerVis = S.steer;
    }
    if(MODELS[v.model].wheels===2){
      const lateral=v.player && v.ph ? sp*v.ph.w : lat;
      const target=Math.max(-.58,Math.min(.58,Math.atan2(lateral,9.81)));
      S.bank=(S.bank||0)+(target-(S.bank||0))*(1-Math.exp(-dt*7));
    }
    S.s = sp; S.h = v.heading;
    const big = MODELS[v.model].mass > 5000 ? 0.6 : 1;
    const tp = Math.max(-0.05, Math.min(0.05, along * 0.0042 * big)), tr = Math.max(-0.065, Math.min(0.065, -lat * 0.0058 * big));
    // collisions jolt the body: a frontal hit pitches the nose down, a side hit rolls it away (carPhysics.kick)
    if (v._kick) { S.vp += v._kick[0] * 0.055 * big; S.vr -= v._kick[1] * 0.07 * big; v._kick = null; }
    S.vp += ((tp - S.p) * 70 - S.vp * 9) * dt; S.p += S.vp * dt;
    S.vr += ((tr - S.r) * 55 - S.vr * 8) * dt; S.r += S.vr * dt;
    S.p = Math.max(-0.14, Math.min(0.14, S.p)); S.r = Math.max(-0.16, Math.min(0.16, S.r));
  }
  draw(vehicles, cam, maxDist = 700) {
    const counts = this._cn ||= {}, countsFar = this._cf ||= {}; for (const k in MODELS) { counts[k] = 0; countsFar[k] = 0; }
    for (const k in this.riders) this.riders[k].count = 0;
    this.feet.count=0;this.drivingLamp.intensity=0;
    for(const mesh of this.legs) mesh.count=0;
    let wn = 0, sn = 0, bn = 0;
    const now = performance.now(), dt = Math.min(0.1, Math.max(0.001, (now - this.t0) / 1000)); this.t0 = now;
    const FAR2 = FAR_LOD * FAR_LOD;
    const md2 = maxDist * maxDist;
    for (const v of vehicles) {
      if (v.hidden) continue;
      const dx = v.x - cam.x, dz = v.z - cam.z; if (dx * dx + dz * dz > md2) continue;
      // a hand-made model (the brothers' Range Rovers, 85,000 triangles) past 35 m: the instanced SUV stands in for it,
      // as GTA swaps a car for its low-detail model at a distance
      const d2 = dx * dx + dz * dz, mk = MODELS[v.model].glb && d2 > 35 * 35 && !v.camInside && this.meshes.suv ? 'suv' : v.model;
      if (mk !== v.model) this.heroCars?.hide(v);   // (kept, hidden: rebuilding it on the way back would stall a frame)
      const def = MODELS[mk], farM = this.far[mk], isFar = d2 > FAR2 && farM !== this.meshes[mk];
      const mesh = isFar ? farM : this.meshes[mk], C = isFar ? countsFar : counts, i = C[mk];
      if (!mesh || i >= def.max) continue;
      if (d2 < 160 * 160) this.suspension(v, dt);
      const S = v._sus;
      // ground pose (wheels), then the sprung body on top of it
      const bank=def.wheels===2 ? (S?.bank || 0) : 0;
      // shot-out tyres (combat.js): that corner sits down on its rim (0 front-left, 1 front-right, 2 rear-left, 3 rear-right)
      const F = v.flat, fr = F ? (F[1] + F[3] - F[0] - F[2]) * 0.045 : 0, fp = F ? (F[2] + F[3] - F[0] - F[1]) * 0.03 : 0, fy = F ? (F[0] + F[1] + F[2] + F[3]) * 0.035 : 0;
      this._e.set((v.roll || 0)+bank+fr, -v.heading, (v.pitch || 0)+fp, 'YXZ');
      this._q.setFromEuler(this._e);
      this._g.compose(this._v.set(v.x, v.y - fy, v.z), this._q, this._s.set(1, 1, 1));
      if (S && d2 < 160 * 160) {
        this._e.set((v.roll || 0) + bank + S.r + fr, -v.heading, (v.pitch || 0) + S.p + fp, 'YXZ'); this._q.setFromEuler(this._e);
        this._m.compose(this._v.set(v.x, v.y - fy - Math.abs(S.r) * 0.25 - Math.abs(S.p) * 0.4, v.z), this._q, this._s.set(1, 1, 1));
      } else this._m.copy(this._g);
      if(v.player && v.lights && !(v.dmg?.[0]>.6)){
        const lamp=this.drivingLamp, bike=def.wheels===2, high=!!v.fullBeam;
        const reach=high?(bike?68:115):(bike?32:58);
        lamp.position.set(def.L*.48,bike?.85:.76,0).applyMatrix4(this._g);
        lamp.target.position.set(reach,high?-.8:-2.0,high?0:-.65).applyMatrix4(this._g);
        lamp.distance=reach; lamp.angle=high?.31:.48;
        lamp.intensity=(bike?.55:1)*(high?14000:6200);
      }
      const riders=this.riders[mk];
      if(riders && !v.camInside && (!v.parked || v.occupied)){
        riders.setMatrixAt(riders.count++,this._m);
        if(def.prof==='cycle'){
          const moving=Math.abs(v.player?v.sp||0:v.v||0)>.35 && !v.brake;
          v.pedalPhase=(v.pedalPhase||0)+(moving ? dt*Math.min(9,2+Math.abs(v.player?v.sp||0:v.v||0)) : 0);
          for(const side of [-1,1]){
            const phase=v.pedalPhase+(side===1?0:Math.PI);
            const px=-.055+.15*Math.cos(phase), py=.36+.15*Math.sin(phase);
            this.legMatrix.makeTranslation(px,py-.03,side*.11).premultiply(this._m);
            this.feet.setMatrixAt(this.feet.count++,this.legMatrix);
            const dx=px+.19, dy=py-.99, dist=Math.hypot(dx,dy), bend=Math.sqrt(Math.max(0,.43**2-dist**2/4));
            const kx=-.19+dx/2-dy/dist*bend, ky=.99+dy/2+dx/dist*bend;
            for(let j=0;j<2;j++){
              const x=j?kx:-.19,y=j?ky:.99, ex=j?px:kx, ey=j?py:ky;
              this.legDir.set(ex-x,ey-y,0);const len=this.legDir.length();
              this.legQuat.setFromUnitVectors(this.legUp,this.legDir.normalize());
              this.legMatrix.compose(this.legMid.set((x+ex)/2,(y+ey)/2,side*.11),this.legQuat,this.legScale.set(1,len,1)).premultiply(this._m);
              const mesh=this.legs[j];mesh.setMatrixAt(mesh.count++,this.legMatrix);
            }
          }
        }
      }
      if (def.glb) {
        // hand-made models: contact shadow and headlight pool here, the car itself in heroCars.js
        if (d2 < 90 * 90 && sn < 400) { this._sm.makeScale(def.L * 1.06, 1, def.W * 1.18).premultiply(this._g); this._sm.elements[13] += 0.035; this.shadows.setMatrixAt(sn++, this._sm); }
        if (v.lights && d2 < 140 * 140 && bn < 300 && !(v.dmg && v.dmg[0] > 0.6)) { this._sm.makeScale(v.fullBeam ? 74 : 38, 1, v.fullBeam ? 15 : 11).premultiply(this._steer.makeTranslation(def.L / 2 - 0.1, 0.06, 0)).premultiply(this._g); this.beams.setMatrixAt(bn++, this._sm); }
        this.heroCars?.place(v, this._g, this._m, d2);
        continue;
      }
      if (!v.hasCabin) {
      C[mk]++;
      mesh.setMatrixAt(i, this._m);
      this._c.setHex(v.paint).toArray(mesh.geometry.attributes.iPaint.array, i * 3);
      const dmg = v.dmg, dga = mesh.geometry.attributes.iDmg.array;
      if (dmg) { dga[i * 4] = dmg[0]; dga[i * 4 + 1] = dmg[1]; dga[i * 4 + 2] = dmg[2]; dga[i * 4 + 3] = dmg[3]; } else dga.fill(0, i * 4, i * 4 + 4);
      const st = mesh.geometry.attributes.iState;
      const flags = (v.brake ? 1 : 0) | (v.reversing ? 2 : 0) | (v.ind === 1 ? 4 : 0) | (v.ind === 2 ? 8 : 0) | (v.hazard || v.alarmT > 0 ? 16 : 0);
      st.array[i * 4] = flags; st.array[i * 4 + 1] = v.fullBeam && v.lights ? 1.35 : v.lights ? 1 : 0; st.array[i * 4 + 2] = v.siren || v.lightsOnly ? 1 : 0; st.array[i * 4 + 3] = v.heading;
      if (d2 < 90 * 90 && sn < 400) {
        this._sm.makeScale(def.L * 1.06, 1, def.W * 1.18).premultiply(this._g);
        this._sm.elements[13] += 0.035;
        this.shadows.setMatrixAt(sn++, this._sm);
      }
      }
      if (v.lights && d2 < 140 * 140 && bn < 300 && !(v.dmg && v.dmg[0] > 0.6)) {
        const bike = def.wheels === 2;
        this._sm.makeScale((bike ? 18 : 38)*(v.fullBeam?1.9:1), 1, bike ? 5 : 11).premultiply(this._steer.makeTranslation(def.L / 2 - 0.1, 0.06, 0)).premultiply(this._g);
        this.beams.setMatrixAt(bn++, this._sm);
      }
      // wheels: two, on the centreline, for a moped or scooter
      if (d2 < (isFar ? 110 * 110 : 160 * 160) && wn < 1496) {
        // (each model's wheel style and positions worked out once, not as fresh arrays for every car every frame)
        const W = WHEELS[mk] ||= wheelsOf(mk, def), r = def.wr, posts = W.posts, tyre = def.tyre || 0.22, spin = v.spin || 0, iw = this.iWheel.array;
        for (let k = 0; k < posts.length; k += 3) {
          const wx = posts[k], wz = posts[k + 1], steer = posts[k + 2];
          iw[wn * 4] = W.sty[0]; iw[wn * 4 + 1] = W.sty[1]; iw[wn * 4 + 2] = spin; iw[wn * 4 + 3] = W.sty[3];
          this._w.makeRotationZ(-(v.spin || 0));
          const sa = v.player ? v.steer : v.steerVis;
          if (steer && sa) this._w.premultiply(this._steer.makeRotationY(-sa));
          this._w.scale(this._v.set(r, r, tyre)).setPosition(wx, r, wz);
          this.wheels.setMatrixAt(wn++, this._w.premultiply(this._g));
        }
      }
    }
    for (const k in this.riders) { const riders = this.riders[k]; riders.visible = riders.count > 0; if (riders.visible) riders.instanceMatrix.needsUpdate = true; }
    for (const riders of this.legs) { riders.visible = riders.count > 0; if (riders.visible) riders.instanceMatrix.needsUpdate = true; }
    this.feet.visible = this.feet.count > 0; if (this.feet.visible) this.feet.instanceMatrix.needsUpdate = true;
    this.heroCars?.finish();
    for (const k in MODELS) {
      if (!this.meshes[k]) continue;
      commit(this.meshes[k], counts[k]);
      if (this.far[k] !== this.meshes[k]) commit(this.far[k], countsFar[k]);
    }
    this.wheels.count = wn; this.wheels.visible = wn > 0; this.wheels.instanceMatrix.needsUpdate = true; this.iWheel.needsUpdate = true;
    this.shadows.count = sn; this.shadows.visible = sn > 0; this.shadows.instanceMatrix.needsUpdate = true;
    this.beams.count = bn; this.beams.visible = bn > 0; if (bn) this.beams.instanceMatrix.needsUpdate = true;
  }
}
// an instanced model's count and the ranges of its per-car attributes to upload (empty ones cost a draw call: hidden)
function commit(m, n) {
  m.count = n; m.visible = n > 0;
  if (!n) return;
  const A = m.geometry.attributes;
  for (const attr of [m.instanceMatrix, A.iPaint, A.iState, A.iDmg]) { attr.clearUpdateRanges(); attr.addUpdateRange(0, n * attr.itemSize); attr.needsUpdate = true; }
}
// wheel style [rim, kind, (spin), caliper] and positions [x, z, steers] x n for a model
const WHEELS = {};
function wheelsOf(mk, def) {
  const sp = CAR_SPECS[mk], hw = def.track ? def.track / 2 + 0.06 : def.W / 2 - 0.105 + (sp?.flare || 0) * 0.8, a = def.wb / 2, o = def.wx || 0;
  const sty = def.prof === 'cycle' ? [.91, 4, 0, 0] : mk === 'dirtbike' ? [.77, 4, 0, 0] : mk === 'motorcycle' ? [.72, 1, 0, 1] : sp ? [sp.rim || 0.66, sp.wheel || 0, 0, sp.caliper ? 1 : 0] : [0.62, 2, 0, 0];
  const posts = def.wheels === 2 ? [a + o, 0, 1, -a + o, 0, 0] : [a + o, hw, 1, a + o, -hw, 1, -a + o, hw, 0, -a + o, -hw, 0];
  return { sty, posts };
}
// unit quad on the ground (x along the car, z across); opacity: a soft rounded rectangle, darkest under the tyres
function contactGeometry() { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; }
function contactMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const p = positionGeometry, q = vec2(abs(p.x).mul(2), abs(p.z).mul(2));
  const d = q.x.pow(6).add(q.y.pow(6)).pow(1 / 6);
  const body = smoothstep(1.0, 0.55, d);
  const tyres = smoothstep(0.16, 0.0, length(vec2(abs(p.x).sub(0.31).mul(2.2), abs(p.z).sub(0.4).mul(3.0))));
  m.colorNode = vec3(0, 0, 0);
  m.opacityNode = body.mul(0.55).add(tyres.mul(0.35)).min(0.8).mul(float(1).sub(U.night.mul(0.35)));
  return m;
}
// headlight pool: unit quad from x 0..1 (ahead) and z -0.5..0.5; two overlapping fans, brightest a few metres out
function beamGeometry() { const g = new THREE.PlaneGeometry(1, 1, 8, 4); g.translate(0.5, 0, 0); g.rotateX(-Math.PI / 2); return g; }
function beamMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
  const p = positionGeometry, ax = p.x.max(0.001), az = abs(p.z);
  const fan = (c) => smoothstep(1, 0.35, abs(p.z.sub(c)).div(ax.mul(0.42).add(0.035)));
  const f = fan(0.042).add(fan(-0.042)).min(1.3);
  const along = smoothstep(0.0, 0.12, ax).mul(smoothstep(1, 0.25, ax));
  const I = f.mul(along).mul(U.night.mul(0.9).add(U.wet.mul(0.15))).mul(0.48).mul(float(1).sub(smoothstep(0.42, 0.5, az)));
  m.colorNode = vec3(1, 0.9, 0.74).mul(I);
  m.opacityNode = I;
  return m;
}
export const PAINTS = [0xe8e8e8, 0x1a1a1a, 0x9a9da0, 0x3a3d42, 0x6e7378, 0x8a1c1c, 0x1d3d7a, 0x234a33, 0xb8b3a6, 0x3d2b23, 0xc9c9c4, 0x0f2240, 0x5b6770, 0xd4d0c8, 0x7a1f2e, 0x2f2f33];
