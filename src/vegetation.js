// Trees: leaf-card crowns (alpha-tested clusters of leaves on camera-independent cards) with
// spherical "volume" normals, translucency against the sun, wind sway and photographic bark.
// The crown geometry is unit radius, so the existing instancing in tiles.js scales it per tree.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, positionLocal, positionGeometry, positionWorld, normalWorld, cameraPosition, uv, texture, int, attribute,
  mix, sin, length, max, dot, normalize, pow, smoothstep, fract, instanceIndex, normalViewGeometry, instanceColor,
  uniform, screenCoordinate, interleavedGradientNoise, step,
} from 'three/tsl';
import { U, cloudShadow } from './env.js';
import { L, sAlbedo, sDetail, perturb } from './surfaces.js';

const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// ---- leaf cluster texture (2x2 atlas): oak, lime, copper beech, yew/needle (made once: the far crowns and the
// Blender-grown trees near you share it)
let leafTex0 = null;
const sharedLeafTex = () => leafTex0 ||= leafTexture();
function leafTexture() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.clearRect(0, 0, N, N);
  const leaf = (x, y, a, L, W, rgb, serrate) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    g.beginPath();
    if (!serrate) {
      g.moveTo(-L, 0);
      g.quadraticCurveTo(-L * 0.2, -W, L * 0.15, -W * 0.15);
      g.quadraticCurveTo(L * 0.7, -W * 0.35, L, 0);
      g.quadraticCurveTo(L * 0.7, W * 0.35, L * 0.15, W * 0.15);
      g.quadraticCurveTo(-L * 0.2, W, -L, 0);
    } else {
      g.moveTo(-L * 0.2, 0);
      for (let k = 0; k <= 8; k++) {
        const f = k / 8, s = Math.sin(f * Math.PI), wob = (k % 2 ? 1 : 0.62);
        g.lineTo(-L * 0.15 + f * L * 1.15, -W * s * wob);
      }
      for (let k = 8; k >= 0; k--) {
        const f = k / 8, s = Math.sin(f * Math.PI), wob = (k % 2 ? 1 : 0.62);
        g.lineTo(-L * 0.15 + f * L * 1.15, W * s * wob);
      }
    }
    g.fill();
    g.strokeStyle = `rgba(${Math.min(255, rgb[0] + 30)},${Math.min(255, rgb[1] + 28)},${rgb[2]},0.55)`;
    g.lineWidth = 0.7; g.beginPath(); g.moveTo(-L * 0.7, 0); g.lineTo(L * 0.85, 0); g.stroke();
    g.restore();
  };
  const specs = [
    // leaf colours (sRGB): real foliage reflects ~8-15% in the green, so these sit well above black
    { n: 210, base: [62, 118, 44], yel: 40, serr: true },
    { n: 190, base: [104, 150, 48], yel: 70, serr: false },
    { n: 200, base: [78, 126, 56], yel: 30, serr: true },   // field maple / hawthorn green (copper beech is tinted from green in the shader)
    { n: 260, base: [44, 92, 50], yel: 8, serr: false, needle: true },
  ];
  specs.forEach((sp, v) => {
    const ox = (v % 2) * N / 2, oy = Math.floor(v / 2) * N / 2, h = N / 2;
    g.save(); g.beginPath(); g.rect(ox, oy, h, h); g.clip();
    g.strokeStyle = 'rgba(58,42,28,0.9)'; g.lineCap = 'round';
    const twigs = [];
    for (let i = 0; i < 6; i++) {
      const x0 = ox + h * (0.28 + rnd() * 0.44), y0 = oy + h * (0.5 + rnd() * 0.42);
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4, len = h * (0.22 + rnd() * 0.28);
      const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
      g.lineWidth = 1.4 + rnd(); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      twigs.push([x0, y0, x1, y1]);
    }
    for (let i = 0; i < sp.n; i++) {
      let x, y, a;
      if (i < sp.n * 0.72) {
        const t = twigs[i % twigs.length], f = rnd();
        x = t[0] + (t[2] - t[0]) * f + (rnd() - 0.5) * 16;
        y = t[1] + (t[3] - t[1]) * f + (rnd() - 0.5) * 16;
        a = Math.atan2(t[3] - t[1], t[2] - t[0]) + (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.8);
      } else {
        const r = Math.sqrt(rnd()) * h * 0.48, th = rnd() * Math.PI * 2;
        x = ox + h / 2 + Math.cos(th) * r; y = oy + h / 2 + Math.sin(th) * r * 0.92; a = rnd() * Math.PI * 2;
      }
      const shade = 0.45 + rnd() * 0.6, yellow = rnd() * (sp.yel / 80);
      const rgb = sp.base.map((ch, k) => Math.round(Math.min(255, (ch + (k === 0 ? yellow * 80 : k === 1 ? yellow * 30 : 0)) * shade)));
      if (sp.needle) {
        g.save(); g.translate(x, y); g.rotate(a);
        g.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.moveTo(0, -5); g.lineTo(0, 5); g.stroke();
        g.restore();
      } else leaf(x, y, a, 7 + rnd() * 10, (7 + rnd() * 8) * (0.32 + rnd() * 0.16), rgb, sp.serr && rnd() < 0.7);
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---- crown geometry: ~56 leaf cards in a unit ellipsoid, normals pointing out from the centre
export function crownGeometry(cards = 72) {
  const P = [], N = [], UV = [], I = [];
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  for (let k = 0; k < cards; k++) {
    // fibonacci-ish distribution with jitter, biased to the outer shell
    const yy = 1 - 2 * (k + 0.5) / cards, rr = Math.sqrt(1 - yy * yy), th = k * 2.39996 + rnd() * 0.6;
    d.set(Math.cos(th) * rr, yy, Math.sin(th) * rr).normalize();
    const rad = 0.5 + 0.38 * Math.sqrt(rnd());
    c.copy(d).multiplyScalar(rad);
    c.y = c.y * 0.92 + 0.04;
    // card plane: roughly facing outwards, randomly tilted
    t.crossVectors(up, d); if (t.lengthSq() < 1e-3) t.set(1, 0, 0); t.normalize().applyAxisAngle(d, rnd() * Math.PI);
    b.crossVectors(d, t).normalize();
    const tilt = (rnd() - 0.5) * 0.9;
    t.applyAxisAngle(b, tilt);
    const s = 0.55 + rnd() * 0.25;
    const v = k % 4, u0 = (v % 2) * 0.5, v0 = Math.floor(v / 2) * 0.5;
    const base = P.length / 3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      q.copy(c).addScaledVector(t, sx * s).addScaledVector(b, sy * s);
      P.push(q.x, q.y, q.z);
      // spherical normal, nudged by the card's own facing, gives soft volumetric shading
      const n = q.clone().sub(new THREE.Vector3(0, 0.05, 0)).normalize().multiplyScalar(0.8).addScaledVector(d, 0.2).normalize();
      N.push(n.x, n.y, n.z);
      UV.push(u0 + (sx + 1) * 0.25, v0 + (1 - (sy + 1) * 0.5) * 0.5);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setIndex(I);
  geo.computeBoundingSphere();
  return geo;
}

// ---- trunk with two forks into the crown ------------------------------------------------
export function trunkGeometry() {
  const parts = [new THREE.CylinderGeometry(0.11, 0.2, 1, 8, 1, true).translate(0, 0.5, 0)];
  const fork = (ax, az, h) => {
    const g = new THREE.CylinderGeometry(0.035, 0.09, 0.5, 6, 1, true).translate(0, 0.25, 0);
    g.rotateZ(ax); g.rotateX(az); g.translate(0, h, 0); return g;
  };
  parts.push(fork(0.55, 0.1, 0.9), fork(-0.5, -0.25, 0.95), fork(0.1, 0.6, 0.85));
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), UVa = new Float32Array(n * 2), I = [];
  let o = 0;
  for (const p of parts) {
    P.set(p.attributes.position.array, o * 3); Nn.set(p.attributes.normal.array, o * 3); UVa.set(p.attributes.uv.array, o * 2);
    for (const i of p.index.array) I.push(i + o);
    o += p.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UVa, 2));
  geo.setIndex(I);
  // root flare: widen the butt of the main stem
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.22 && Math.abs(pos.getX(i)) < 0.45 && Math.abs(pos.getZ(i)) < 0.45) {
      const f = 1 + (0.22 - y) / 0.22 * 0.9;
      pos.setX(i, pos.getX(i) * f); pos.setZ(i, pos.getZ(i) * f);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---- materials ---------------------------------------------------------------------------
// Trees fade out over the 70 m short of this distance (main.js sets it to the quality budget's treeDist, the
// distance at which perf.js stops drawing a tile's trees), so a tile's trees are already gone when its trees are
// switched off and a whole block of them no longer pops in or out on the skyline as you move.
export const treeFar = uniform(1e5);
const treeFade = (d) => float(1).sub(smoothstep(treeFar.sub(70), treeFar, d));
// The Blender-grown trees (nearTrees.js) stand within treeNear of the camera and the leaf-card crowns beyond it,
// handing over in a fine screen-space dither across the last 10 m: each pixel shows one or the other (the far
// crowns keep it where the noise is under the hand-over, the near trees where it isn't). 0 until the near trees are
// loaded, when the far crowns are everywhere.
export const treeNear = uniform(0);
const handOver = (d) => smoothstep(treeNear.sub(10), treeNear, d);
const keepFar = (d) => step(interleavedGradientNoise(screenCoordinate.xy), handOver(d));
const keepNear = (d) => float(1).sub(keepFar(d));
export function treeMaterials() {
  const leafTex = sharedLeafTex();
  const crown = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35 });
  const p = positionWorld;
  const tid = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  const wind = length(U.wind);
  const gust = sin(U.t.mul(0.9).add(tid.mul(30))).mul(0.5).add(0.5);
  const g0 = positionGeometry;
  const sway = sin(U.t.mul(1.6).add(tid.mul(17)).add(g0.x.mul(1.3))).mul(wind.mul(0.008).mul(gust.mul(0.7).add(0.3)));
  const flutter = sin(U.t.mul(9).add(tid.mul(19)).add(g0.x.mul(23)).add(g0.z.mul(17))).mul(wind.mul(0.0032));
  const lift = g0.y.add(1).max(0).mul(4);
  const windDir = U.wind.div(wind.max(.01));
  crown.positionNode = positionLocal.add(vec3(sway.mul(lift).mul(windDir.x).add(flutter), flutter.mul(0.6), sway.mul(lift).mul(windDir.y)));
  const lt = texture(leafTex, uv());
  const dist = length(cameraPosition.sub(p));
  const alpha = lt.a.mul(mix(float(1), float(2.4), smoothstep(25, 160, dist))).mul(treeFade(dist)).mul(keepFar(dist));
  // the species tint (oak, lime, plane, copper, yew; shrub palettes) is the mesh's instance colour, which three.js
  // multiplies into colorNode itself. It must be read through the instanceColor varying: it is not a geometry
  // attribute, and attribute('instanceColor') silently read zero and turned every crown near-black.
  // Tints arrive halved from tiles.js (so 0.5 = the leaf texture's own colour): double here.
  const species = instanceColor;
  let col = lt.rgb.mul(2).mul(tid.mul(0.18).add(0.9)).mul(mix(float(1), float(0.72), U.wet));
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.78);
  // copper beech and red-leaved shrubs (red-leaning tints): take the leaf's luminance into a deep copper
  const copper = smoothstep(0.08, 0.2, species.r.sub(species.g));
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))).mul(vec3(1.9, 1.05, 1.05)), copper);
  const pg = positionGeometry;
  const r = length(pg);
  const ao = smoothstep(0.2, 0.95, r).mul(0.6).add(0.4).mul(pg.y.mul(0.28).add(0.8));
  col = col.mul(ao);
  crown.colorNode = vec4(col.mul(cloudShadow(p)), alpha);
  const v = normalize(p.sub(cameraPosition));
  const back = pow(max(dot(v, U.sunDir), 0), 5).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.6)));
  // translucency: strong looking towards the sun, plus a soft wrap so sunlit crowns glow green rather than going navy
  const wrap = max(dot(normalWorld, U.sunDir).mul(0.5).add(0.5), 0).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.5)));
  crown.emissiveNode = col.mul(species).mul(vec3(1.05, 1.15, 0.45)).mul(U.sunCol).mul(back.mul(0.95).add(wrap.mul(0.16)).add(0.03));
  // leaf cards are double-sided but carry outward 'volume' normals: don't let three.js flip them on back faces
  // (that lit half of every crown from the inside and made trees look near-black)
  crown.normalNode = normalViewGeometry;
  const trunk = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, alphaTest: 0.5 });
  // (the trunks dissolve with their crowns, in a fine dither)
  const tdist = length(cameraPosition.sub(positionWorld));
  trunk.opacityNode = treeFade(tdist).add(interleavedGradientNoise(screenCoordinate.xy).mul(0.5).sub(0.25)).mul(keepFar(tdist));
  const tuv = vec2(uv().x.mul(1.6), positionWorld.y.mul(0.85));
  const bark = sAlbedo(int(L.bark), tuv);
  const lichen = smoothstep(0.62, 0.86, texture(leafTex, tuv.mul(0.15)).g).mul(0.22);
  // trunks carry no instance colour (it would tint the bark green): grey-barked beech/plane by hash instead
  trunk.colorNode = bark.mul(mix(vec3(0.72, 0.62, 0.5), vec3(0.85), smoothstep(0.62, 0.78, tid))).mul(mix(float(1), float(0.62), U.wet)).mul(mix(vec3(1), vec3(0.75, 0.9, 0.62), lichen)).mul(cloudShadow(positionWorld));
  trunk.normalNode = perturb(normalWorld, sDetail(int(L.bark), tuv), float(1.35));
  return { crown, trunk };
}

// ---- the Blender-grown trees near you (tools/blender/trees.py; drawn by nearTrees.js) -----------------------------
// Bark and leaf cards in one mesh and one material. The vertex colour carries what Blender baked: r the ambient
// occlusion ray traced through the tree, g the sway weight (0 at the root .. 1 at the twig ends), b leaf (1) or bark
// (0), a the bark tone (0 brown and rough, oak .. 1 smooth grey, beech). Leaf cards use the same leaf atlas, species
// tint (instance colour) and translucency as the far crowns; the bark is the game's photographic bark, in metres.
const LUMA = vec3(0.2126, 0.7152, 0.0722);
export function nearTreeMaterial() {
  const leafTex = sharedLeafTex();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.84, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35 });
  const vc = attribute('color', 'vec4');
  const ao = vc.x, wgt = vc.y, leaf = vc.z, tone = vc.w;
  const p = positionWorld, g0 = positionGeometry;
  const tid = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  const wind = length(U.wind), windDir = U.wind.div(wind.max(.01));
  const gust = sin(U.t.mul(0.9).add(tid.mul(30))).mul(0.5).add(0.5);
  // the crown leans with the gusts, more towards the top and out along the limbs; the leaves flutter on their own
  const sway = sin(U.t.mul(1.25).add(tid.mul(17)).add(g0.y.mul(0.07))).mul(wind.mul(0.028).mul(gust.mul(0.7).add(0.3))).mul(wgt.mul(wgt));
  const flutter = sin(U.t.mul(9).add(tid.mul(19)).add(g0.x.mul(3.1)).add(g0.z.mul(2.3))).mul(wind.mul(0.006)).mul(leaf);
  m.positionNode = positionLocal.add(vec3(sway.mul(windDir.x).add(flutter), flutter.mul(0.6), sway.mul(windDir.y).add(flutter.mul(0.5))));
  const dist = length(cameraPosition.sub(p));
  const species = instanceColor;
  // leaves: as the far crowns
  const lt = texture(leafTex, uv());
  let leafCol = lt.rgb.mul(2).mul(tid.mul(0.18).add(0.9)).mul(mix(float(1), float(0.72), U.wet));
  leafCol = mix(vec3(dot(leafCol, LUMA)), leafCol, 0.78);
  const copper = smoothstep(0.08, 0.2, species.r.sub(species.g));
  leafCol = mix(leafCol, vec3(dot(leafCol, LUMA)).mul(vec3(1.9, 1.05, 1.05)), copper);
  // bark: brown and rough on oaks, smooth and grey on beech, mottled plane; darker when wet. three.js multiplies the
  // instance colour (the species' leaf tint) into the whole mesh, so the bark is divided by it first
  const bark = sAlbedo(int(L.bark), uv()).mul(mix(vec3(0.74, 0.63, 0.5), vec3(0.92, 0.9, 0.86), tone)).mul(mix(float(1), float(0.62), U.wet));
  const barkCol = bark.div(species.max(0.08));
  const col = mix(barkCol, leafCol, leaf).mul(ao.mul(ao).mul(0.35).add(ao.mul(0.65)));
  const alpha = mix(float(1), lt.a.mul(mix(float(1), float(2.4), smoothstep(25, 160, dist))), leaf).mul(keepNear(dist));
  m.colorNode = vec4(col.mul(cloudShadow(p)), alpha);
  const v = normalize(p.sub(cameraPosition));
  const back = pow(max(dot(v, U.sunDir), 0), 5).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.6)));
  const wrap = max(dot(normalWorld, U.sunDir).mul(0.5).add(0.5), 0).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.5)));
  m.emissiveNode = leafCol.mul(species).mul(vec3(1.05, 1.15, 0.45)).mul(U.sunCol).mul(back.mul(0.95).add(wrap.mul(0.16)).add(0.03)).mul(leaf).mul(ao);
  // leaf cards: the "volume" normals Blender gave them (no flipping on back faces); bark: round, with the bark's relief
  m.normalNode = normalize(mix(perturb(normalWorld, sDetail(int(L.bark), uv()), float(1.35)), normalViewGeometry, leaf));
  return m;
}
