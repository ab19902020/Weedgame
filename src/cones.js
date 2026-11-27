// Traffic cones (the Crayon City "Traffic Cone", 75 cm, free licence: www/props/CRAYON-LICENSE.txt).
// The police set out a taper of them behind a crash or a broken-down car while they're on scene (police.js) and
// take them in when it's cleared. Driving into one knocks it flying: it tumbles, rolls and lies where it lands.
// All of them are one instanced draw.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, positionWorld, vec3 } from 'three/tsl';
import { lightPool } from './materials.js';
import { cloudShadow } from './env.js';

const MAX = 48;
export class Cones {
  constructor(G) {
    this.G = G; this.sets = new Map(); this.mesh = null;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    new GLTFLoader().loadAsync('props/traffic-cone.glb').then(g => this.build(g.scene)).catch(e => console.warn('cones', e));
  }
  // the model's visible parts as one geometry, each part's colour baked into its vertices
  build(root) {
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => {
      if (!o.isMesh || /collider/i.test(o.material?.name || '') || o.material?.opacity === 0) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const c = o.material.color || new THREE.Color(1, 1, 1), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    });
    if (!parts.length) return;
    const geo = mergeGeometries(parts);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
    const albedo = attribute('color', 'vec3');
    m.colorNode = albedo.mul(cloudShadow(positionWorld));
    // the white band is retro-reflective: it shines back in headlights
    m.emissiveNode = lightPool(positionWorld).mul(albedo).mul(vec3(1.6));
    this.mesh = new THREE.InstancedMesh(geo, m, MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = this.G.renderer.shadowMap.enabled; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.G.scene.add(this.mesh);
  }
  // a taper of cones behind a stopped vehicle v (on the road's left, as on UK roads): from the kerb well back to
  // its offside edge just behind it
  taper(key, v, n = 5) {
    const G = this.G, h = v.heading || 0, fx = Math.cos(h), fz = Math.sin(h), rx = -Math.sin(h), rz = Math.cos(h);
    const L = v.def?.L || 4.4, W = v.def?.W || 1.8, list = [];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), back = L / 2 + 2.5 + k * 3.2, lat = (W / 2 + 0.45) * (1 - u) + (-W / 2 - 0.35) * u;
      const x = v.x - fx * back + rx * lat, z = v.z - fz * back + rz * lat, y = G.tiles.ground(x, z, (v.y ?? 0) + 1) ?? v.y ?? 0;
      list.push({ x, y, z, h: k * 1.3, vx: 0, vy: 0, vz: 0, spin: 0, tilt: 0, roll: 0, flying: false });
    }
    this.sets.set(key, list);
  }
  clear(key) { this.sets.delete(key); }
  update(dt) {
    if (!this.mesh) return;
    const G = this.G, me = G.brothers?.me, car = me && G.brothers.vehicleOf?.(me);
    const sp = car ? (car.sp ?? car.v ?? 0) : 0, carH = car?.heading || 0;
    let n = 0;
    for (const list of this.sets.values()) for (const c of list) {
      if (n >= MAX) break;
      // a car through it: thrown along the car's way and up, spinning
      if (car && !c.flying && Math.abs(sp) > 1.5) {
        const dx = c.x - car.x, dz = c.z - car.z;
        if (dx * dx + dz * dz < ((car.def?.L || 4.4) / 2 + 0.3) ** 2) {
          const lx = dx * Math.cos(carH) + dz * Math.sin(carH), lz = -dx * Math.sin(carH) + dz * Math.cos(carH);
          if (Math.abs(lx) < (car.def?.L || 4.4) / 2 + 0.25 && Math.abs(lz) < (car.def?.W || 1.8) / 2 + 0.25) {
            const k = Math.min(1.1, 0.75 + Math.random() * 0.35), side = lz >= 0 ? 1 : -1;
            c.vx = Math.cos(carH) * sp * k - Math.sin(carH) * side * 1.8; c.vz = Math.sin(carH) * sp * k + Math.cos(carH) * side * 1.8;
            c.vy = 2 + Math.abs(sp) * 0.12; c.spin = (Math.random() - 0.5) * 14; c.flying = true;
            G.audio?.shot?.('bin', c.x, c.z, Math.min(0.8, Math.abs(sp) / 18), c.y + 0.3);   // (a recorded knock: hollow plastic)
          }
        }
      }
      if (c.flying) {
        c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.h += c.spin * dt;
        c.tilt = Math.min(Math.PI / 2, c.tilt + Math.abs(c.spin) * dt * 0.4 + dt * 3);
        const gy = G.tiles.ground(c.x, c.z, c.y + 1);
        if (gy != null && c.y <= gy) {
          // bounce, then settle on its side and roll to a stop
          c.y = gy; c.vy = c.vy < -2 ? -c.vy * 0.3 : 0; c.vx *= 0.55; c.vz *= 0.55; c.spin *= 0.6;
          if (c.vy === 0 && Math.hypot(c.vx, c.vz) < 0.3) { c.flying = false; c.vx = c.vz = 0; c.tilt = Math.PI / 2; }
        }
      }
      this._e.set(c.tilt, c.h, 0, 'YXZ'); this._q.setFromEuler(this._e);
      // lying down it rests on its side, centred a cone's radius off the ground
      this._p.set(c.x, c.y + Math.sin(c.tilt) * 0.2, c.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
