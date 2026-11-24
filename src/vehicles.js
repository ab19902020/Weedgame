// Procedural, instanced vehicles. Simulation owns vehicle state; this module only draws.
import * as THREE from 'three/webgpu';
import { Fn, attribute, vec3, float, mix, step, sin, fract, floor, positionLocal, instanceIndex, select, abs } from 'three/tsl';
import { U } from './env.js';
import { mergeGeos } from './tiles.js';
import { lightPool } from './materials.js';
import { positionWorld } from 'three/tsl';

export const MODELS = {
  hatch: { L: 4.05, W: 1.74, H: 1.47, wb: 2.5, wr: 0.31, prof: 'hatch', max: 220, mass: 1150 },
  saloon: { L: 4.65, W: 1.8, H: 1.45, wb: 2.75, wr: 0.32, prof: 'saloon', max: 160, mass: 1400 },
  estate: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 120, mass: 1500 },
  suv: { L: 4.45, W: 1.85, H: 1.66, wb: 2.65, wr: 0.36, prof: 'suv', max: 100, mass: 1700 },
  van: { L: 5.3, W: 2.02, H: 2.35, wb: 3.3, wr: 0.34, prof: 'van', max: 60, mass: 2200 },
  fire: { L:7.3,W:2.38,H:3.15,wb:4.1,wr:.44,prof:"van",max:3,mass:8000,livery:2 },
  police: { L: 4.75, W: 1.8, H: 1.5, wb: 2.8, wr: 0.32, prof: 'estate', max: 16, mass: 1550, livery: 1 },
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

function buildModel(def) {
  const { L, W, H, prof } = def;
  const shape = new THREE.Shape(profile(prof, L, H).map(([x, y]) => new THREE.Vector2(x, y)));
  let body = new THREE.ExtrudeGeometry(shape, { depth: W - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, steps: 1 });
  body.translate(0, 0, -(W - 0.08) / 2);
  body = body.toNonIndexed(); body.computeVertexNormals();
  // per-vertex classification: paint / glass / trim / lights
  const pos = body.attributes.position, nor = body.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3), paint = new Float32Array(n), lit = new Float32Array(n), liv = new Float32Array(n);
  const isBus = prof === 'decker' || prof === 'single';
  const belt = isBus ? 1.25 : prof === 'van' ? 1.2 : 0.98;
  for (let t = 0; t < n; t += 3) {
    let cy = 0, cx = 0, ny = 0, nx = 0, nz = 0;
    for (let k = 0; k < 3; k++) { cy += pos.getY(t + k) / 3; cx += pos.getX(t + k) / 3; ny += nor.getY(t + k) / 3; nx += nor.getX(t + k) / 3; nz += nor.getZ(t + k) / 3; }
    let glass = false;
    if (isBus) {
      const bands = prof === 'decker' ? [[1.3, 2.05], [2.55, 3.85]] : [[1.25, 2.55]];
      glass = Math.abs(ny) < 0.5 && bands.some(([a, b]) => cy > a && cy < b) && Math.abs(cx) < L / 2 - 0.15;
      if (Math.abs(nx) > 0.6 && cx > 0 && cy > 0.9 && cy < H - 0.3) glass = true; // windscreen
    } else {
      glass = cy > belt && cy < H - 0.04 && ny < 0.85 && !(prof === 'van' && Math.abs(nz) > 0.6 && cx < L / 2 - 1.3);
    }
    for (let k = 0; k < 3; k++) {
      const v = t + k;
      if (glass) { col[v * 3] = 0.05; col[v * 3 + 1] = 0.07; col[v * 3 + 2] = 0.09; paint[v] = 0; }
      else if (cy < 0.42) { col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 0.06; paint[v] = 0; }
      else { paint[v] = 1; col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = 1; liv[v] = def.livery && Math.abs(nz) > 0.5 && cy < belt && cy > 0.45 ? 1 : 0; }
    }
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.setAttribute('paint', new THREE.BufferAttribute(paint, 1));
  body.setAttribute('lit', new THREE.BufferAttribute(lit, 1));
  body.setAttribute('livery', new THREE.BufferAttribute(liv, 1));
  const parts = [body];
  const add = (g, rgb, p, l, lv = 0) => {
    g = g.toNonIndexed(); const c = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c * 3).map((_, i) => rgb[i % 3]), 3));
    g.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(c).fill(p), 1));
    g.setAttribute('lit', new THREE.BufferAttribute(new Float32Array(c).fill(l), 1));
    g.setAttribute('livery', new THREE.BufferAttribute(new Float32Array(c).fill(lv), 1));
    parts.push(g);
  };
  const l = L / 2, hy = isBus ? 0.75 : prof === 'van' ? 0.95 : 0.78;
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.14, 0.32).translate(l + 0.01, hy, s * (W / 2 - 0.3)), [0.9, 0.9, 0.85], 0, 1);      // headlights
    add(new THREE.BoxGeometry(0.06, 0.16, 0.26).translate(-l - 0.01, hy + 0.08, s * (W / 2 - 0.25)), [0.5, 0.04, 0.03], 0, 2); // tail / brake
    if (!isBus) add(new THREE.BoxGeometry(0.22, 0.12, 0.06).translate(l - (prof === 'van' ? 1.1 : 1.75), belt + 0.06, s * (W / 2 + 0.03)), [0.08, 0.08, 0.08], 0, 0); // mirrors
  }
  add(new THREE.BoxGeometry(0.05, 0.11, 0.52).translate(-l - 0.01, 0.45, 0), [0.95, 0.8, 0.1], 0, 0); // rear plate
  add(new THREE.BoxGeometry(0.05, 0.11, 0.52).translate(l + 0.01, 0.45, 0), [0.95, 0.95, 0.92], 0, 0); // front plate
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
  return g;
}

export class VehicleRenderer {
  constructor(scene, shadows) {
    this.meshes = {}; this.idx = {};
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.25, vertexColors: true });
    const vc = attribute('color', 'vec3'), paint = attribute('paint', 'float'), lit = attribute('lit', 'float'), liv = attribute('livery', 'float');
    const ic = attribute('iPaint', 'vec3');
    const st = attribute('iState', 'vec4'); // x brake, y lights, z siren, w indicator
    // Battenburg: alternating yellow / blue blocks on the side panels
    const lp = positionLocal;
    const checker = step(0.5, fract(lp.x.div(0.62).add(step(0.72, lp.y).mul(0.5))));
    const batten = mix(vec3(0.85, 0.82, 0.05), vec3(0.04, 0.1, 0.55), checker);
    let base = mix(vc, ic, paint);
    base = mix(base, batten, liv);
    mat.colorNode = base;
    mat.roughnessNode = mix(float(0.12), float(0.38), paint);
    const head = step(0.5, lit).mul(step(lit, 1.5));
    const tail = step(1.5, lit).mul(step(lit, 2.5));
    const bar = step(2.5, lit).mul(step(lit, 3.5));
    const blind = step(3.5, lit);
    const flash = step(0.5, fract(U.t.mul(2.6).add(step(0, lp.z).mul(0.5))));
    mat.emissiveNode = vec3(1, 0.95, 0.85).mul(head).mul(st.y).mul(4)
      .add(vec3(1, 0.05, 0.02).mul(tail).mul(st.y.mul(0.8).add(st.x.mul(3)).add(0.15)))
      .add(mix(vec3(0.05, 0.2, 1), vec3(0.05, 0.2, 1), flash).mul(bar).mul(st.z).mul(flash).mul(8))
      .add(vec3(1, 0.65, 0.05).mul(blind).mul(1.5))
      .add(lightPool(positionWorld).mul(base));
    this.mat = mat;
    const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2);
    const wm = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, color: 0x111111 });
    this.wheels = new THREE.InstancedMesh(wheelGeo, wm, 1500);
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.frustumCulled = false; this.wheels.count = 0; scene.add(this.wheels);
    for (const [name, def] of Object.entries(MODELS)) {
      const g = buildModel(def);
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
      this._e.set(v.roll || 0, -v.heading, v.pitch || 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(v.x, v.y, v.z), this._q, this._s.set(1, 1, 1));
      if(!v.hasCabin){
      counts[v.model]++;
      mesh.setMatrixAt(i, this._m);
      this._c.setHex(v.paint).toArray(mesh.geometry.attributes.iPaint.array, i * 3);
      const st = mesh.geometry.attributes.iState;
      st.array[i * 4] = v.brake ? 1 : 0; st.array[i * 4 + 1] = v.lights ? 1 : 0; st.array[i * 4 + 2] = v.siren ? 1 : 0; st.array[i * 4 + 3] = 0;
      }
      // wheels
      if (dx * dx + dz * dz < 160 * 160 && wn < 1496) {
        const r = def.wr, hw = def.W / 2 - 0.12, a = def.wb / 2;
        for (const [wx, wz, steer] of [[a, hw, 1], [a, -hw, 1], [-a, hw, 0], [-a, -hw, 0]]) {
          this._w.makeRotationZ(-(v.spin || 0));
          if (steer && v.steer) this._w.premultiply(new THREE.Matrix4().makeRotationY(-v.steer));
          this._w.scale(this._v.set(r, r, 0.22)).setPosition(wx, r, wz);
          this.wheels.setMatrixAt(wn++, this._w.premultiply(this._m));
        }
      }
    }
    for (const k in MODELS) {
      const m = this.meshes[k]; m.count = counts[k];
      m.instanceMatrix.needsUpdate = true; m.geometry.attributes.iPaint.needsUpdate = true; m.geometry.attributes.iState.needsUpdate = true;
    }
    this.wheels.count = wn; this.wheels.instanceMatrix.needsUpdate = true;
  }
}
export const PAINTS = [0xe8e8e8, 0x1a1a1a, 0x9a9da0, 0x3a3d42, 0x6e7378, 0x8a1c1c, 0x1d3d7a, 0x234a33, 0xb8b3a6, 0x3d2b23, 0xc9c9c4, 0x0f2240, 0x5b6770, 0xd4d0c8, 0x7a1f2e, 0x2f2f33];
