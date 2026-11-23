// Procedural, instanced vehicles. Simulation owns vehicle state; this module only draws.
import * as THREE from 'three/webgpu';
import { Fn, attribute, vec2, vec3, float, int, mix, step, sin, fract, floor, positionLocal, positionGeometry, instanceIndex, select, abs, length, smoothstep, uniformArray } from 'three/tsl';
import { U } from './env.js';
import { mergeGeos } from './tiles.js';
import { lightPool } from './materials.js';
import { buildCar, vehicleMaterial, wheelGeometry, wheelMaterial, CAR_SPECS } from './carModel.js';
import { positionWorld } from 'three/tsl';

export const MODELS = {
  hatch: { L: 4.05, W: 1.74, H: 1.47, wb: 2.5, wr: 0.31, prof: 'hatch', max: 220, mass: 1150 },
  saloon: { L: 4.65, W: 1.8, H: 1.45, wb: 2.75, wr: 0.32, prof: 'saloon', max: 160, mass: 1400 },
  estate: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 120, mass: 1500 },
  suv: { L: 4.45, W: 1.85, H: 1.66, wb: 2.65, wr: 0.36, prof: 'suv', max: 100, mass: 1700 },
  van: { L: 5.3, W: 2.02, H: 2.35, wb: 3.3, wr: 0.34, prof: 'van', max: 60, mass: 2200 },
  police: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 16, mass: 1550, livery: 1 },
  hothatch: { L: 4.28, W: 1.79, H: 1.45, wb: 2.63, wr: 0.33, prof: 'hatch', max: 40, mass: 1350 },
  coupe: { L: 4.64, W: 1.83, H: 1.38, wb: 2.81, wr: 0.34, prof: 'saloon', max: 30, mass: 1550 },
  sports: { L: 4.52, W: 1.95, H: 1.2, wb: 2.62, wr: 0.35, prof: 'saloon', max: 12, mass: 1450 },
  bus: { L: 10.6, W: 2.55, H: 4.3, wb: 5.6, wr: 0.5, prof: 'decker', max: 30, mass: 12000 },
  busS: { L: 11.2, W: 2.5, H: 3.05, wb: 5.9, wr: 0.5, prof: 'single', max: 20, mass: 10000 },
};

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
for (const [k, d] of Object.entries(MODELS)) d.wx = CAR_SPECS[k] ? (CAR_SPECS[k].wheelX || 0) * d.L / 2 : 0;
const MODEL_LIST = Object.entries(MODELS);
// traffic mix (UK-ish), and paints: sports models get brighter colours
export function randomModel(r) {
  return r < 0.31 ? 'hatch' : r < 0.52 ? 'saloon' : r < 0.65 ? 'estate' : r < 0.8 ? 'suv' : r < 0.9 ? 'van' : r < 0.95 ? 'hothatch' : r < 0.985 ? 'coupe' : 'sports';
}
const SPORT_PAINTS = [0xb5121b, 0xe8e8e8, 0x111111, 0x1446a0, 0xf2b705, 0xe25a12, 0x2f6d3a, 0x7d8085];
export function paintFor(model, r) { return (model === 'sports' || model === 'coupe' || model === 'hothatch') ? SPORT_PAINTS[Math.floor(r * SPORT_PAINTS.length)] : PAINTS[Math.floor(r * PAINTS.length)]; }

function buildModel(def, key) {
  if (CAR_SPECS[key]) return mergeGeos(buildCar(def, key, MODEL_LIST.findIndex(([k]) => k === key) + 1).parts);
  const { L, W, H, prof } = def;
  const isBus = prof === 'decker' || prof === 'single';
  const belt = isBus ? 1.25 : prof === 'van' ? 1.2 : 0.98;
  let body;
  if (isBus) {
    const shape = new THREE.Shape(profile(prof, L, H).map(([x, y]) => new THREE.Vector2(x, y)));
    body = new THREE.ExtrudeGeometry(shape, { depth: W - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, steps: 1 });
    body.translate(0, 0, -(W - 0.08) / 2);
    body = body.toNonIndexed(); body.computeVertexNormals();
  } else body = loftBody(def, profile(prof, L, H), belt);   // rounded, smooth-shaded (carModel.js)
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
  if (isBus) add(new THREE.BoxGeometry(0.06, 0.28, 1.6).translate(l + 0.01, H - 0.45, 0), [0.05, 0.05, 0.05], 0, 4); // destination blind
  const g = mergeGeos(parts);
  return g;
}

export class VehicleRenderer {
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
    for (const [name, def] of Object.entries(MODELS)) {
      const g = buildModel(def, name);
      const st = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4); st.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iState', st);
      const pa = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 3), 3); pa.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iPaint', pa);
      const m = new THREE.InstancedMesh(g, mat, def.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = false;
      scene.add(m); this.meshes[name] = m;
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color(); this._w = new THREE.Matrix4();
  }
  draw(vehicles, cam, maxDist = 700) {
    const counts = {}; for (const k in MODELS) counts[k] = 0;
    let wn = 0;
    const md2 = maxDist * maxDist;
    for (const v of vehicles) {
      if (v.hidden) continue;
      const dx = v.x - cam.x, dz = v.z - cam.z; if (dx * dx + dz * dz > md2) continue;
      const def = MODELS[v.model]; const mesh = this.meshes[v.model]; const i = counts[v.model];
      if (i >= def.max) continue;
      counts[v.model]++;
      this._e.set(v.roll || 0, -v.heading, v.pitch || 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(v.x, v.y, v.z), this._q, this._s.set(1, 1, 1));
      mesh.setMatrixAt(i, this._m);
      this._c.setHex(v.paint).toArray(mesh.geometry.attributes.iPaint.array, i * 3);
      const st = mesh.geometry.attributes.iState;
      st.array[i * 4] = v.brake ? 1 : 0; st.array[i * 4 + 1] = v.lights ? 1 : 0; st.array[i * 4 + 2] = v.siren ? 1 : 0; st.array[i * 4 + 3] = v.heading;
      // wheels
      if (dx * dx + dz * dz < 160 * 160 && wn < 1496) {
        const sp = CAR_SPECS[v.model], r = def.wr, hw = def.W / 2 - 0.12 + (sp?.flare || 0) * 0.8, a = def.wb / 2, o = def.wx || 0;
        const wsty = sp ? [sp.rim || 0.66, sp.wheel || 0, v.spin || 0, sp.caliper ? 1 : 0] : [0.62, 2, v.spin || 0, 0];
        for (const [wx, wz, steer] of [[a + o, hw, 1], [a + o, -hw, 1], [-a + o, hw, 0], [-a + o, -hw, 0]]) {
          this.iWheel.array.set(wsty, wn * 4);
          this._w.makeRotationZ(-(v.spin || 0));
          if (steer && v.steer) this._w.premultiply(new THREE.Matrix4().makeRotationY(-v.steer));
          this._w.scale(this._v.set(r, r, 0.22)).setPosition(wx, r, wz);
          this.wheels.setMatrixAt(wn++, this._w.premultiply(this._m));
        }
      }
    }
    for (const k in MODELS) {
      const m = this.meshes[k]; m.count = counts[k]; m.visible = counts[k] > 0;   // empty instanced meshes cost a draw call
      m.instanceMatrix.needsUpdate = true; m.geometry.attributes.iPaint.needsUpdate = true; m.geometry.attributes.iState.needsUpdate = true;
    }
    this.wheels.count = wn; this.wheels.visible = wn > 0; this.wheels.instanceMatrix.needsUpdate = true; this.iWheel.needsUpdate = true;
  }
}
export const PAINTS = [0xe8e8e8, 0x1a1a1a, 0x9a9da0, 0x3a3d42, 0x6e7378, 0x8a1c1c, 0x1d3d7a, 0x234a33, 0xb8b3a6, 0x3d2b23, 0xc9c9c4, 0x0f2240, 0x5b6770, 0xd4d0c8, 0x7a1f2e, 0x2f2f33];
