// Grass blades on lawns, parks, pitches, verges and gardens within ~20 m of the camera
// (high quality only, or ?grass=1). Clumps are re-placed on the CPU when the camera has moved a few
// metres, using the streamed landcover and terrain; height fades out towards the edge so there is
// no visible border. Blades sway with the wind and darken when wet.
import * as THREE from 'three/webgpu';
import { float, vec3, mix, sin, uv, positionLocal, positionGeometry, positionWorld, cameraPosition, length, smoothstep, step, instanceIndex, fract, normalize, vec4 } from 'three/tsl';
import { U, cloudShadow } from './env.js';
import { worldToView } from './surfaces.js';

const LAWN = new Set([0, 7, 11, 13, 16]);   // grass, park, garden, pitch, cemetery
const R = 22, STEP = 0.36, MAXN = Math.ceil((2 * R / STEP) ** 2 * 0.55);

function clumpGeometry(blades = 9) {
  const P = [], UV = [], I = [];
  let s = 9876;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.2, h = 0.05 + rnd() * 0.16, w = 0.006 + rnd() * 0.007;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, yaw = rnd() * Math.PI, lean = (rnd() - 0.25) * 0.7;
    const cx = Math.cos(yaw), cz = Math.sin(yaw), lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const base = P.length / 3;
    const segs = 3;
    for (let k = 0; k <= segs; k++) {
      const f = k / segs, y = f * h, ww = w * (1 - f * 0.9), bend = f * f * h * 1.15;
      for (const sd of [-1, 1]) {
        P.push(ox + cx * ww * sd + lx * bend, y, oz + cz * ww * sd + lz * bend);
        UV.push(sd * 0.5 + 0.5, f);
      }
    }
    for (let k = 0; k < segs; k++) { const i = base + k * 2; I.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

export function createGrass(G) {
  const want = G.Q.get('grass');
  const on = G.budget ? G.budget.grass : G.quality === 'high';
  if (want === '0' || (!on && want !== '1')) return null;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  const f = uv().y;
  const rnd = fract(sin(float(instanceIndex).mul(78.233)).mul(43758.5453));
  const dist = length(positionWorld.xz.sub(cameraPosition.xz));
  const fade = smoothstep(R, R * 0.55, dist);
  const wind = length(U.wind);
  const sway = sin(U.t.mul(2.1).add(positionWorld.x.mul(0.7)).add(positionWorld.z.mul(0.5))).mul(0.5).add(0.5).mul(wind.mul(0.006).add(0.004)).mul(f.mul(f));
  // positionLocal is already instance-transformed here; shorten the blade by its own height to fade
  m.positionNode = vec3(positionLocal.x.add(sway.mul(U.wind.x.sign())), positionLocal.y.sub(positionGeometry.y.mul(float(1).sub(fade))), positionLocal.z.add(sway.mul(0.6)));
  const root = vec3(0.035, 0.062, 0.016), tip = vec3(0.16, 0.24, 0.05);
  const seedHead = step(0.86, rnd), daisy = step(0.94, rnd);
  let col = mix(root, tip, f).mul(rnd.mul(0.35).add(0.82));
  col = mix(col, vec3(0.42, 0.38, 0.12), seedHead.mul(smoothstep(0.55, 1.0, f)));
  col = mix(col, vec3(0.72, 0.7, 0.55), daisy.mul(smoothstep(0.7, 0.95, f)));
  col = col.mul(mix(float(1), float(0.7), U.wet));
  m.colorNode = col.mul(cloudShadow(positionWorld));
  // lit like the lawn underneath (mostly up-facing), not like thin vertical cards
  m.normalNode = worldToView(normalize(vec3(0, 1, 0)));
  m.roughnessNode = mix(float(0.75), float(0.35), U.wet);
  const v = normalize(positionWorld.sub(cameraPosition));
  const back = v.dot(U.sunDir).max(0).pow(4).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.6)));
  m.emissiveNode = col.mul(U.sunCol).mul(back.mul(0.8).mul(f));
  const mesh = new THREE.InstancedMesh(clumpGeometry(), m, MAXN);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = !!G.renderer.shadowMap.enabled;
  G.scene.add(mesh);
  const last = new THREE.Vector3(1e9, 0, 1e9);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), Yax = new THREE.Vector3(0, 1, 0);
  const hash = (x, z) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
  return {
    mesh,
    update(cam) {
      if ((cam.x - last.x) ** 2 + (cam.z - last.z) ** 2 < 9 || G._needGround) return;
      last.copy(cam);
      const T = G.tiles; let n = 0;
      const x0 = Math.floor((cam.x - R) / STEP), x1 = Math.ceil((cam.x + R) / STEP);
      const z0 = Math.floor((cam.z - R) / STEP), z1 = Math.ceil((cam.z + R) / STEP);
      for (let iz = z0; iz <= z1 && n < MAXN; iz++) for (let ix = x0; ix <= x1 && n < MAXN; ix++) {
        const jx = hash(ix, iz), jz = hash(iz + 17.1, ix - 3.3);
        const x = (ix + jx) * STEP, z = (iz + jz) * STEP;
        const dx = x - cam.x, dz = z - cam.z; if (dx * dx + dz * dz > R * R) continue;
        const c = T.landcover(x, z); if (c == null || !LAWN.has(c)) continue;
        const y = T.terrain(x, z); if (y == null) continue;
        q.setFromAxisAngle(Yax, jx * 6.283);
        const verge = c === 0 || c === 15 ? 1.55 : c === 11 ? 0.8 : 1;
        const s = (0.7 + jz * 0.7) * (c === 13 ? 0.72 : 1);
        mtx.compose(pv.set(x, y, z), q, sc.set(s, s * verge, s));
        mesh.setMatrixAt(n++, mtx);
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
