// Procedural, instanced vehicles. Simulation owns vehicle state; this module only draws.
import * as THREE from 'three/webgpu';
import { Fn, attribute, vec2, vec3, float, int, mix, step, sin, fract, floor, positionLocal, positionGeometry, instanceIndex, select, abs, length, smoothstep, uniformArray } from 'three/tsl';
import { U } from './env.js';
import { mergeGeos } from './tiles.js';
import { lightPool } from './materials.js';
import { buildCar, vehicleMaterial, wheelGeometry, wheelMaterial, CAR_SPECS } from './carModel.js';
import { positionWorld } from 'three/tsl';

const FAR_LOD = 70;   // metres: beyond this cars use the light body
export const MODELS = {
  hatch: { L: 4.05, W: 1.74, H: 1.47, wb: 2.5, wr: 0.31, prof: 'hatch', max: 220, mass: 1150 },
  saloon: { L: 4.65, W: 1.8, H: 1.45, wb: 2.75, wr: 0.32, prof: 'saloon', max: 160, mass: 1400 },
  estate: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 120, mass: 1500 },
  suv: { L: 4.45, W: 1.85, H: 1.66, wb: 2.65, wr: 0.36, prof: 'suv', max: 100, mass: 1700 },
  van: { L: 5.3, W: 2.02, H: 2.35, wb: 3.3, wr: 0.34, prof: 'van', max: 60, mass: 2200 },
  fire: { L:7.3,W:2.38,H:3.15,wb:4.1,wr:.44,prof:"van",max:3,mass:8000,livery:2 },
  police: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 16, mass: 1550, livery: 1 },
  hothatch: { L: 4.28, W: 1.79, H: 1.45, wb: 2.63, wr: 0.33, prof: 'hatch', max: 40, mass: 1350 },
  coupe: { L: 4.64, W: 1.83, H: 1.38, wb: 2.81, wr: 0.34, prof: 'saloon', max: 30, mass: 1550 },
  sports: { L: 4.52, W: 1.95, H: 1.2, wb: 2.62, wr: 0.35, prof: 'saloon', max: 12, mass: 1450 },
  // the brothers' own car: a hand-made model drawn by heroCars.js (wheelbase centre 0.12 m ahead of the body centre)
  rangerover: { L: 4.95, W: 2.02, H: 1.9, wb: 2.91, wr: 0.42, prof: 'glb', max: 6, mass: 2450, glb: 'rangerover', wx: 0.12 },
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
for (const [k, d] of Object.entries(MODELS)) if (!d.glb) d.wx = CAR_SPECS[k] ? (CAR_SPECS[k].wheelX || 0) * d.L / 2 : 0;
const MODEL_LIST = Object.entries(MODELS);
// traffic mix (UK-ish), and paints: sports models get brighter colours
export function randomModel(r) {
  return r < 0.31 ? 'hatch' : r < 0.52 ? 'saloon' : r < 0.65 ? 'estate' : r < 0.8 ? 'suv' : r < 0.9 ? 'van' : r < 0.95 ? 'hothatch' : r < 0.985 ? 'coupe' : 'sports';
}
const SPORT_PAINTS = [0xb5121b, 0xe8e8e8, 0x111111, 0x1446a0, 0xf2b705, 0xe25a12, 0x2f6d3a, 0x7d8085];
export function paintFor(model, r) { return (model === 'sports' || model === 'coupe' || model === 'hothatch') ? SPORT_PAINTS[Math.floor(r * SPORT_PAINTS.length)] : PAINTS[Math.floor(r * PAINTS.length)]; }

function buildModel(def, key, lod = 0) {
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
  if (isBus) add(new THREE.BoxGeometry(0.06, 0.28, 1.6).translate(l + 0.01, H - 0.45, 0), [0.05, 0.05, 0.05], 0, 4); // destination blind
  const g = mergeGeos(parts);
  if (g.attributes.uv) g.deleteAttribute('uv');   // WebGPU: 8 vertex buffers per pipeline, instancing uses four
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
    // two levels of detail per car model: full detail near the camera, a light body beyond FAR_LOD m
    this.far = {};
    const make = (def, g, shadow) => {
      const st = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4); st.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iState', st);
      const pa = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 3), 3); pa.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iPaint', pa);
      const dg = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4); dg.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iDmg', dg);
      const m = new THREE.InstancedMesh(g, mat, def.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = false;
      scene.add(m); return m;
    };
    for (const [name, def] of Object.entries(MODELS)) {
      if (def.glb) continue;   // drawn by heroCars.js
      this.meshes[name] = make(def, buildModel(def, name), shadows);
      this.far[name] = CAR_SPECS[name] ? make(def, buildModel(def, name, 1), false) : this.meshes[name];
    }
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
    S.s = sp; S.h = v.heading;
    const big = MODELS[v.model].mass > 5000 ? 0.6 : 1;
    const tp = Math.max(-0.05, Math.min(0.05, along * 0.0042 * big)), tr = Math.max(-0.065, Math.min(0.065, -lat * 0.0058 * big));
    S.vp += ((tp - S.p) * 70 - S.vp * 9) * dt; S.p += S.vp * dt;
    S.vr += ((tr - S.r) * 55 - S.vr * 8) * dt; S.r += S.vr * dt;
  }
  draw(vehicles, cam, maxDist = 700) {
    const counts = {}, countsFar = {}; for (const k in MODELS) { counts[k] = 0; countsFar[k] = 0; }
    let wn = 0, sn = 0, bn = 0;
    const now = performance.now(), dt = Math.min(0.1, Math.max(0.001, (now - this.t0) / 1000)); this.t0 = now;
    const FAR2 = FAR_LOD * FAR_LOD;
    const md2 = maxDist * maxDist;
    for (const v of vehicles) {
      if (v.hidden) continue;
      const dx = v.x - cam.x, dz = v.z - cam.z; if (dx * dx + dz * dz > md2) continue;
      const def = MODELS[v.model], d2 = dx * dx + dz * dz, farM = this.far[v.model], isFar = d2 > FAR2 && farM !== this.meshes[v.model];
      const mesh = isFar ? farM : this.meshes[v.model], C = isFar ? countsFar : counts, i = C[v.model];
      if (i >= def.max) continue;
      if (d2 < 160 * 160) this.suspension(v, dt);
      const S = v._sus;
      // ground pose (wheels), then the sprung body on top of it
      this._e.set(v.roll || 0, -v.heading, v.pitch || 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._g.compose(this._v.set(v.x, v.y, v.z), this._q, this._s.set(1, 1, 1));
      if (S && d2 < 160 * 160) {
        this._e.set((v.roll || 0) + S.r, -v.heading, (v.pitch || 0) + S.p, 'YXZ'); this._q.setFromEuler(this._e);
        this._m.compose(this._v.set(v.x, v.y - Math.abs(S.r) * 0.25 - Math.abs(S.p) * 0.4, v.z), this._q, this._s.set(1, 1, 1));
      } else this._m.copy(this._g);
      if (def.glb) {
        // hand-made models: contact shadow and headlight pool here, the car itself in heroCars.js
        if (d2 < 90 * 90 && sn < 400) { this._sm.makeScale(def.L * 1.06, 1, def.W * 1.18).premultiply(this._g); this._sm.elements[13] += 0.035; this.shadows.setMatrixAt(sn++, this._sm); }
        if (v.lights && d2 < 140 * 140 && bn < 300 && !(v.dmg && v.dmg[0] > 0.6)) { this._sm.makeScale(22, 1, 9).premultiply(this._steer.makeTranslation(def.L / 2 - 0.1, 0.06, 0)).premultiply(this._g); this.beams.setMatrixAt(bn++, this._sm); }
        this.heroCars?.place(v, this._g, this._m);
        continue;
      }
      if (!v.hasCabin) {
      C[v.model]++;
      mesh.setMatrixAt(i, this._m);
      this._c.setHex(v.paint).toArray(mesh.geometry.attributes.iPaint.array, i * 3);
      const dmg = v.dmg, dga = mesh.geometry.attributes.iDmg.array;
      if (dmg) { dga[i * 4] = dmg[0]; dga[i * 4 + 1] = dmg[1]; dga[i * 4 + 2] = dmg[2]; dga[i * 4 + 3] = dmg[3]; } else dga.fill(0, i * 4, i * 4 + 4);
      const st = mesh.geometry.attributes.iState;
      const flags = (v.brake ? 1 : 0) | (v.reversing ? 2 : 0) | (v.ind === 1 ? 4 : 0) | (v.ind === 2 ? 8 : 0) | (v.hazard ? 16 : 0);
      st.array[i * 4] = flags; st.array[i * 4 + 1] = v.lights ? 1 : 0; st.array[i * 4 + 2] = v.siren ? 1 : 0; st.array[i * 4 + 3] = v.heading;
      if (d2 < 90 * 90 && sn < 400) {
        this._sm.makeScale(def.L * 1.06, 1, def.W * 1.18).premultiply(this._g);
        this._sm.elements[13] += 0.035;
        this.shadows.setMatrixAt(sn++, this._sm);
      }
      }
      if (v.lights && d2 < 140 * 140 && bn < 300 && !(v.dmg && v.dmg[0] > 0.6)) {
        // beam quad: starts at the nose, 22 m long, 9 m wide at the far end
        this._sm.makeScale(22, 1, 9).premultiply(this._steer.makeTranslation(def.L / 2 - 0.1, 0.06, 0)).premultiply(this._g);
        this.beams.setMatrixAt(bn++, this._sm);
      }
      // wheels
      if (d2 < (isFar ? 110 * 110 : 160 * 160) && wn < 1496) {
        const sp = CAR_SPECS[v.model], r = def.wr, hw = def.W / 2 - 0.105 + (sp?.flare || 0) * 0.8, a = def.wb / 2, o = def.wx || 0;
        const wsty = sp ? [sp.rim || 0.66, sp.wheel || 0, v.spin || 0, sp.caliper ? 1 : 0] : [0.62, 2, v.spin || 0, 0];
        for (const [wx, wz, steer] of [[a + o, hw, 1], [a + o, -hw, 1], [-a + o, hw, 0], [-a + o, -hw, 0]]) {
          this.iWheel.array.set(wsty, wn * 4);
          this._w.makeRotationZ(-(v.spin || 0));
          const sa = v.player ? v.steer : v.steerVis;
          if (steer && sa) this._w.premultiply(this._steer.makeRotationY(-sa));
          this._w.scale(this._v.set(r, r, 0.22)).setPosition(wx, r, wz);
          this.wheels.setMatrixAt(wn++, this._w.premultiply(this._g));
        }
      }
    }
    const commit = (m, n) => {
      m.count = n; m.visible = n > 0;   // empty instanced meshes cost a draw call
      if (n) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.iPaint.needsUpdate = true; m.geometry.attributes.iState.needsUpdate = true; m.geometry.attributes.iDmg.needsUpdate = true; }
    };
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
  const I = f.mul(along).mul(U.night.mul(0.9).add(U.wet.mul(0.15))).mul(0.32).mul(float(1).sub(smoothstep(0.42, 0.5, az)));
  m.colorNode = vec3(1, 0.9, 0.74).mul(I);
  m.opacityNode = I;
  return m;
}
export const PAINTS = [0xe8e8e8, 0x1a1a1a, 0x9a9da0, 0x3a3d42, 0x6e7378, 0x8a1c1c, 0x1d3d7a, 0x234a33, 0xb8b3a6, 0x3d2b23, 0xc9c9c4, 0x0f2240, 0x5b6770, 0xd4d0c8, 0x7a1f2e, 0x2f2f33];
