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
import { vec2, vec3, float, mix, smoothstep, uniform, positionWorld, dot, floor, max, length, exp, texture } from 'three/tsl';

// ---------------------------------------------------------------- value noise (the same in JS and in TSL)
// Over one 256 x 256 lattice of random bytes, read here from the array and on the GPU from a texture of it, so the
// two agree exactly (a sin() hash doesn't: the GPU's float sin of a large argument scatters to a different value).
const NT = 256, LAT = new Uint8Array(NT * NT);
{ let s = 0x2545f491; for (let k = 0; k < LAT.length; k++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; LAT[k] = s & 255; } }
const latJ = (i, j) => LAT[((j & 255) << 8) | (i & 255)] / 255;
function noiseJ(x, z) { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = latJ(i, j), b = latJ(i + 1, j), c = latJ(i, j + 1), d = latJ(i + 1, j + 1); return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv; }
const fbmJ = (x, z) => noiseJ(x, z) * 0.55 + noiseJ(x * 2.13 + 17, z * 2.13 - 9) * 0.3 + noiseJ(x * 4.7 + 5, z * 4.7 + 31) * 0.15;
const latTex = new THREE.DataTexture(LAT, NT, NT, THREE.RedFormat, THREE.UnsignedByteType);
latTex.wrapS = latTex.wrapT = THREE.RepeatWrapping; latTex.magFilter = latTex.minFilter = THREE.NearestFilter; latTex.generateMipmaps = false; latTex.needsUpdate = true;
const latT = i => texture(latTex, i.add(0.5).div(NT)).level(0).r;
const noiseT = p => { const i = floor(p), f = p.sub(i), s = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = latT(i), b = latT(i.add(vec2(1, 0))), c = latT(i.add(vec2(0, 1))), d = latT(i.add(vec2(1, 1)));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y); };
const fbmT = p => noiseT(p).mul(0.55).add(noiseT(p.mul(2.13).add(vec2(17, -9))).mul(0.3)).add(noiseT(p.mul(4.7).add(vec2(5, 31))).mul(0.15));
const SCALE = 1 / 1800;

// a patchwork of English farmland (fields split and split again, hedgerows between them, a wood here and there),
// seamless when tiled
function fieldsCanvas(N) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const PAL = ['#969a5c', '#b0a66c', '#7a9250', '#68844a', '#8a9658', '#a09664', '#8c9a5e', '#b8ae78'], WOOD = '#2c4626', HEDGE = 'rgba(44,70,38,0.75)';
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const split = (x, y, w, h, d) => {
    if (d > 5 || (w < N / 9 && h < N / 9) || (d > 2 && rnd() < 0.18)) {
      g.fillStyle = rnd() < 0.09 ? WOOD : PAL[Math.floor(rnd() * PAL.length)];
      g.fillRect(x, y, w, h);
      // crop rows or grazing texture
      g.globalAlpha = 0.08; g.fillStyle = '#000'; for (let k = 0; k < w; k += 3) g.fillRect(x + k, y, 1, h); g.globalAlpha = 1;
      g.strokeStyle = HEDGE; g.lineWidth = 1.6; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      return;
    }
    if (w > h ? rnd() < 0.8 : rnd() < 0.2) { const k = Math.round(w * (0.3 + rnd() * 0.4)); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else { const k = Math.round(h * (0.3 + rnd() * 0.4)); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
  };
  split(0, 0, N, N, 0);
  return c;
}

export class DroneSky {
  constructor(G) {
    this.G = G; this.inCloud = 0; this.far = null; this.loading = false;
    // ---- the cloud deck: one big sheet that follows the camera
    this.uCov = uniform(0.5); this.uOff = uniform(new THREE.Vector2()); this.uSun = uniform(new THREE.Color(1, 1, 1)); this.uAmb = uniform(new THREE.Color(0.6, 0.65, 0.75)); this.uCam = uniform(new THREE.Vector3()); this.uHaze = uniform(new THREE.Color(0.8, 0.85, 0.9)); this.uSunDir = uniform(new THREE.Vector3(0.3, 0.8, 0.2));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const P = positionWorld.xz.add(this.uOff), p = P.mul(SCALE), thr = float(1).sub(this.uCov);
    // the deck's outline is the same fbm as cloudAt() (so a gap you see is a gap you can fly through), its edges
    // frayed by a finer octave
    const n = fbmT(p).add(noiseT(P.div(160).add(vec2(3.1, 7.7))).sub(0.5).mul(0.07));
    const dens = smoothstep(thr.sub(0.05), thr.add(0.1), n);
    // the tops: heaped higher towards each cloud's heart, in billows of ~400, 150 and 55 m. Shaded as a height field
    // lit by the sun with a wrapped falloff (light diffuses through the cloud, so the far sides of billows are
    // greyer, never black)
    const top = Q => { const d = smoothstep(thr.sub(0.05), thr.add(0.3), fbmT(Q.mul(SCALE)));
      const bil = noiseT(Q.div(380)).mul(0.55).add(noiseT(Q.div(140).add(vec2(7.3, 1.9))).mul(0.3)).add(noiseT(Q.div(55).add(vec2(3.1, 9.4))).mul(0.15));
      return d.mul(bil.mul(0.8).add(0.2)).mul(320); };
    const E = 7, h0 = top(P), hx = top(P.add(vec2(E, 0))), hz = top(P.add(vec2(0, E)));
    const N = vec3(h0.sub(hx), E, h0.sub(hz)).normalize();
    const wrap = max(dot(N, this.uSunDir).add(0.3).div(1.3), 0);
    // deeper hollows between the billows see less of the sky
    const occl = smoothstep(0, 140, h0).mul(0.25).add(0.75);
    const col = mix(this.uAmb, this.uSun, wrap).mul(occl);
    // far off, the deck melts into the horizon haze (it stays opaque, so the land under it never shows through)
    const d = length(positionWorld.xz.sub(this.uCam.xz)), fade = exp(d.mul(-1 / 30000));
    m.colorNode = mix(this.uHaze, col, fade); m.opacityNode = dens.mul(0.97);
    this.deck = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1), m);
    this.deck.rotation.x = -Math.PI / 2; this.deck.visible = false; this.deck.frustumCulled = false; this.deck.renderOrder = 50;   // after every other see-through thing (tiles fading in), so nothing below shows through
    G.scene.add(this.deck);
    // inside a cloud the sky is lost too: a veil round the camera, beyond the nearest few tens of metres (which the
    // thickened fog greys), in the fog's colour
    this.uVeil = uniform(0); this.uVeilCol = uniform(new THREE.Color(0.85, 0.88, 0.95));
    const vm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide, fog: false });
    vm.colorNode = this.uVeilCol; vm.opacityNode = this.uVeil;
    this.veil = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12), vm); this.veil.visible = false; this.veil.frustumCulled = false; this.veil.renderOrder = 3;
    G.scene.add(this.veil);
  }
  // cloud at a point (0..1), the same field as the deck's shader
  cloudAt(x, z) {
    const W = this.G.world, off = W.s.cloudOff || [0, 0], cov = W.cur?.cover ?? 0.4, n = fbmJ((x + off[0]) * SCALE, (z + off[1]) * SCALE), thr = 1 - cov;
    const t = Math.min(1, Math.max(0, (n - (thr - 0.05)) / 0.15)); return t * t * (3 - 2 * t);   // as the deck's shader
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
      const nearW = Math.min(20, Math.max(0.12, agl * 0.02)), farW = agl > 25 ? Math.min(60000, 4000 + agl * 40) : 2600;
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
    // above the deck the streamed street detail isn't wanted (the far terrain shows through the gaps): hidden, it
    // costs nothing and can't flash through the cloud as new tiles come in under the drone
    const hide = this.deck.visible;
    if (hide || this._hidTiles) { for (const t of G.tiles.tiles.values()) if (t.group) t.group.visible = !hide; this._hidTiles = hide; }
    if (this.deck.visible) {
      this.deck.position.set(cam.x, L.deck, cam.z);
      this.uCov.value = cover; this.uOff.value.set(G.world.s.cloudOff[0], G.world.s.cloudOff[1]); this.uCam.value.copy(cam);
      const sun = U.sunCol.value, night = U.night.value;
      // a sunlit cloud top is the brightest thing in view: near white (up there the sunlight is barely reddened
      // even when the sun is low), shaded blue-grey in its dips
      const sl = (sun.r + sun.g + sun.b) / 3;
      this.uSun.value.setRGB(sl + (sun.r - sl) * 0.12, sl + (sun.g - sl) * 0.12, (sl + (sun.b - sl) * 0.12) * 1.04).multiplyScalar(2.1 * (1 - night * 0.85));
      this.uSunDir.value.copy(U.sunDir.value);
      this.uAmb.value.setRGB(0.6, 0.66, 0.8).multiplyScalar(0.85 * (1 - night * 0.85) + 0.05);
      this.uHaze.value.copy(U.horizon.value).multiplyScalar(1.1);
      // above the deck the sky overhead is clear (the baked sky's own clouds are the ones seen from the street)
      U.cloudDens.value = 0;
    }
    // inside: the world whites out
    const thermal = D?.cam && D.cam !== 'normal';
    this.veil.visible = this.inCloud > 0.01 && !thermal;
    if (this.inCloud > 0.01) {
      const k = this.inCloud, lum = (0.08 + 1.3 * (1 - U.night.value)) * (1 - U.cloudDark.value * 0.4);
      U.fogDensity.value = U.fogDensity.value * (1 - k) + 0.045 * k;
      U.fogCol.value.setRGB(0.85, 0.88, 0.95).multiplyScalar(lum);
      this.uVeilCol.value.copy(U.fogCol.value); this.uVeil.value = Math.min(0.985, Math.pow(k, 0.8));
      this.veil.position.copy(cam);
    } else if (on) {
      // high up the air is clearer: the haze is the boundary layer's, so from a few hundred metres the far land
      // shows for tens of kilometres
      const alt = cam.y - (D.home?.y ?? 0);
      if (alt > 60) U.fogDensity.value *= Math.max(0.12, 1 - (alt - 60) / 560);
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
      // matte (Lambert): fields seen from a height don't glint, and a specular sheen whitened the land at a grazing view
      const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
      this.far = new THREE.Mesh(geo, mat); this.far.name = 'farTerrain'; this.far.receiveShadow = false; this.far.castShadow = false; this.far.visible = false;
      this.far.add(this.skirt(meta, hb));
      this.G.scene.add(this.far);
    } catch (e) { console.warn('far terrain', e); }
    this.loading = false;
  }
  // beyond the map: countryside to the horizon, so from high up the land doesn't stop at the edge of the map. A band
  // 45 km wide all round the far terrain, its inner edge on the far terrain's border heights, easing to the valley's
  // level outwards, in a patchwork of fields, hedges and woods that repeats every 6 km.
  skirt(meta, hb) {
    const gx = meta.gx, gz = meta.gz, H = (i, j) => hb[j * gx + i] * meta.scale, M = 45000, STEP = 8;
    const x0 = meta.x0, z0 = meta.z0, x1 = x0 + (gx - 1) * meta.step, z1 = z0 + (gz - 1) * meta.step;
    let lo = 1e9; for (let i = 0; i < gx; i++) lo = Math.min(lo, H(i, 0), H(i, gz - 1)); for (let j = 0; j < gz; j++) lo = Math.min(lo, H(0, j), H(gx - 1, j));
    // the border, walked round once: [x, z, h, outward x, outward z]
    const ring = [];
    for (let i = 0; i < gx - 1; i += STEP) ring.push([x0 + i * meta.step, z0, H(i, 0), 0, -1]);
    for (let j = 0; j < gz - 1; j += STEP) ring.push([x1, z0 + j * meta.step, H(gx - 1, j), 1, 0]);
    for (let i = gx - 1; i > 0; i -= STEP) ring.push([x0 + i * meta.step, z1, H(i, gz - 1), 0, 1]);
    for (let j = gz - 1; j > 0; j -= STEP) ring.push([x0, z0 + j * meta.step, H(0, j), -1, 0]);
    // outer points: straight out from the side, diagonally out from the corners
    const n = ring.length, pos = [], uv = [], idx = [], TILE = 6000;
    const put = (x, y, z) => { pos.push(x, y, z); uv.push(x / TILE, -z / TILE); return pos.length / 3 - 1; };
    for (const [x, z, h, ox, oz] of ring) {
      const cx = x <= x0 + 1 ? -1 : x >= x1 - 1 ? 1 : ox, cz = z <= z0 + 1 ? -1 : z >= z1 - 1 ? 1 : oz;
      put(x, h - 0.3, z); put(x + cx * M * 0.08, h * 0.5 + lo * 0.5 - 1, z + cz * M * 0.08); put(x + cx * M, lo - 2, z + cz * M);
    }
    for (let k = 0; k < n; k++) {
      const a = k * 3, b = ((k + 1) % n) * 3;
      for (let r = 0; r < 2; r++) idx.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(fieldsCanvas(512)); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6 }));
    m.name = 'farSkirt'; m.frustumCulled = false;
    return m;
  }
}
