// What a drone sees high up (drone.js):
//  - FarTerrain: the whole map beyond the streamed tiles, an aerial texture painted from the world's own land cover
//    and trees (fields, woods, roads, roofs, water) over the EA LIDAR terrain at 64 m (tools/world/far_*.{mjs,py},
//    www/world/far). It lies just under the detailed tiles (the lowest ground in each cell), so where they are
//    loaded they cover it; beyond them the land carries on to the horizon instead of ending.
//  - The cloud layer: climbing through its base the picture whites out (fog thickens to a few tens of metres
//    where the layer has cloud over that spot), and above it the cloud deck spreads below in the sunshine with
//    clear sky overhead. Coverage follows the weather's cloud cover; the same noise drives the deck you see and
//    the in-cloud test, so a gap you see is a gap you can fly through.
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, mix, smoothstep, uniform, positionWorld, fract, sin, dot, floor, max, length, exp } from 'three/tsl';

// ---------------------------------------------------------------- value noise (the same in JS and in TSL)
const hashJ = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function noiseJ(x, z) { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hashJ(i, j), b = hashJ(i + 1, j), c = hashJ(i, j + 1), d = hashJ(i + 1, j + 1); return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv; }
const fbmJ = (x, z) => noiseJ(x, z) * 0.55 + noiseJ(x * 2.13 + 17, z * 2.13 - 9) * 0.3 + noiseJ(x * 4.7 + 5, z * 4.7 + 31) * 0.15;
const hashT = p => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const noiseT = p => { const i = floor(p), f = p.sub(i), s = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hashT(i), b = hashT(i.add(vec2(1, 0))), c = hashT(i.add(vec2(0, 1))), d = hashT(i.add(vec2(1, 1)));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y); };
const fbmT = p => noiseT(p).mul(0.55).add(noiseT(p.mul(2.13).add(vec2(17, -9))).mul(0.3)).add(noiseT(p.mul(4.7).add(vec2(5, 31))).mul(0.15));
const SCALE = 1 / 1800;

export class DroneSky {
  constructor(G) {
    this.G = G; this.inCloud = 0; this.far = null; this.loading = false;
    // ---- the cloud deck: one big sheet that follows the camera
    this.uCov = uniform(0.5); this.uOff = uniform(new THREE.Vector2()); this.uSun = uniform(new THREE.Color(1, 1, 1)); this.uAmb = uniform(new THREE.Color(0.6, 0.65, 0.75)); this.uCam = uniform(new THREE.Vector3());
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const p = positionWorld.xz.add(this.uOff).mul(SCALE);
    const n = fbmT(p), thr = float(1).sub(this.uCov);
    const dens = smoothstep(thr.sub(0.06), thr.add(0.12), n);
    // a lumpy top: lit where it rises towards the sun, shaded in the dips; distance fades it into the haze
    const nb = fbmT(p.add(vec2(0.004, 0.003)));
    const lit = smoothstep(-0.02, 0.03, n.sub(nb)).mul(0.35).add(0.65);
    const col = mix(this.uAmb, this.uSun, lit.mul(dens.mul(0.6).add(0.4)));
    const d = length(positionWorld.xz.sub(this.uCam.xz)), fade = exp(d.mul(-1 / 26000));
    m.colorNode = col; m.opacityNode = dens.mul(fade).mul(0.97);
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1), m);
    this.deck.rotation.x = -Math.PI / 2; this.deck.visible = false; this.deck.frustumCulled = false; this.deck.renderOrder = 2;
    G.scene.add(this.deck);
  }
  // cloud at a point (0..1), the same field as the deck's shader
  cloudAt(x, z) {
    const W = this.G.world, off = W.s.cloudOff || [0, 0], cov = W.cur?.cover ?? 0.4, n = fbmJ((x + off[0]) * SCALE, (z + off[1]) * SCALE), thr = 1 - cov;
    const t = Math.min(1, Math.max(0, (n - (thr - 0.06)) / 0.18)); return t * t * (3 - 2 * t);
  }
  // the layer's base and the deck's height (m above the sea), from the weather (heights above the street)
  layer() {
    const U = this.G.U, ref = this.G.drone?.home?.y ?? 50;
    const base = ref + U.cloudBase.value, thick = U.cloudThick.value;
    return { base, deck: base + Math.min(thick * 0.35, 700), top: base + thick };
  }
  update(dt) {
    const G = this.G, D = G.drone, U = G.U, cam = G.camera.position;
    const on = !!D?.active;
    // ---- far terrain: wanted when the drone is up high
    const agl = on ? D.p.y - (D.groundY ?? D.p.y) : 0;
    if (on && agl > 25 && !this.far && !this.loading) this.loadFar();
    if (this.far) this.far.visible = on && agl > 25;
    // with the far land showing, the haze that hides the edge of the streamed tiles isn't needed (it whited out the
    // view from up high), and the camera sees to the horizon: near and far planes scale with the height
    if (G.fogEdge) G.fogEdge.value = this.far?.visible ? 0 : 1;
    const cam0 = G.camera;
    if (on) {
      const nearW = Math.min(20, Math.max(0.12, agl * 0.02)), farW = agl > 60 ? Math.min(60000, 2600 + agl * 40) : 2600;
      if (Math.abs(cam0.near - nearW) > 0.01 || cam0.far !== farW) { cam0.near = nearW; cam0.far = farW; cam0.updateProjectionMatrix(); }
    }
    // ---- clouds
    const L = this.layer(), cover = G.world.cur?.cover ?? 0.4;
    let inCloud = 0;
    if (on && cam.y > L.base - 40 && cam.y < L.deck + 30) {
      const edge = Math.min(1, (cam.y - (L.base - 40)) / 60) * Math.min(1, (L.deck + 30 - cam.y) / 40);
      inCloud = this.cloudAt(cam.x, cam.z) * edge;
    }
    this.inCloud += (inCloud - this.inCloud) * Math.min(1, dt * 3);
    const above = on && cam.y > L.deck - 5;
    this.deck.visible = above && cover > 0.05;
    if (this.deck.visible) {
      this.deck.position.set(cam.x, L.deck, cam.z);
      this.uCov.value = cover; this.uOff.value.set(G.world.s.cloudOff[0], G.world.s.cloudOff[1]); this.uCam.value.copy(cam);
      const sun = U.sunCol.value, night = U.night.value;
      this.uSun.value.setRGB(0.98, 0.98, 1.0).multiply(sun).multiplyScalar(1.15 * (1 - night * 0.85));
      this.uAmb.value.setRGB(0.55, 0.6, 0.72).multiplyScalar(0.9 * (1 - night * 0.85) + 0.05);
      // above the deck the sky overhead is clear (the baked sky's own clouds are the ones seen from the street)
      U.cloudDens.value *= 0.08;
    }
    // inside: the world whites out
    if (this.inCloud > 0.01) {
      const k = this.inCloud;
      U.fogDensity.value = U.fogDensity.value * (1 - k) + 0.045 * k;
      U.fogCol.value.lerp(this._white ||= new THREE.Color(), 0).setRGB(0.82, 0.84, 0.87).multiplyScalar(0.55 + 0.45 * (1 - U.night.value));
    } else if (on && cam.y > 200) {
      // high up the air is clearer: thin the near-ground haze so the far land shows
      U.fogDensity.value *= Math.max(0.35, 1 - (cam.y - 200) / 1600);
    }
  }
  // ---------------------------------------------------------------- the far terrain (loaded the first time it's needed)
  async loadFar() {
    this.loading = true;
    try {
      const base = 'world/far/', meta = await (await fetch(base + 'far.json')).json();
      const hb = new Int16Array(await (await fetch(base + meta.height)).arrayBuffer());
      const tex = await new THREE.TextureLoader().loadAsync(base + meta.colour);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
      const gx = meta.gx, gz = meta.gz, pos = new Float32Array(gx * gz * 3), uv = new Float32Array(gx * gz * 2);
      for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
        const k = j * gx + i;
        pos[k * 3] = meta.x0 + i * meta.step; pos[k * 3 + 1] = hb[k] * meta.scale; pos[k * 3 + 2] = meta.z0 + j * meta.step;
        uv[k * 2] = (i * meta.step) / meta.w; uv[k * 2 + 1] = 1 - (j * meta.step) / meta.h;
      }
      const idx = new Uint32Array((gx - 1) * (gz - 1) * 6); let o = 0;
      for (let j = 0; j < gz - 1; j++) for (let i = 0; i < gx - 1; i++) { const a = j * gx + i, b = a + 1, c = a + gx, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
      this.far = new THREE.Mesh(geo, mat); this.far.name = 'farTerrain'; this.far.receiveShadow = false; this.far.castShadow = false; this.far.visible = false;
      this.G.scene.add(this.far);
    } catch (e) { console.warn('far terrain', e); }
    this.loading = false;
  }
}
void max;
