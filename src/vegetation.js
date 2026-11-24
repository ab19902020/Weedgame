// Trees: leaf-card crowns (alpha-tested clusters of leaves on camera-independent cards) with
// spherical "volume" normals, translucency against the sun, wind sway and photographic bark.
// The crown geometry is unit radius, so the existing instancing in tiles.js scales it per tree.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, positionLocal, positionGeometry, positionWorld, normalWorld, cameraPosition, uv, texture, int, attribute,
  mix, sin, length, max, dot, normalize, pow, smoothstep, fract, instanceIndex,
} from 'three/tsl';
import { U, cloudShadow } from './env.js';
import { L, sAlbedo, sDetail, perturb } from './surfaces.js';

const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// ---- leaf cluster texture (2x2 atlas): oak, lime, copper beech, yew/needle
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
    { n: 210, base: [34, 78, 28], yel: 40, serr: true },
    { n: 190, base: [78, 120, 32], yel: 70, serr: false },
    { n: 180, base: [92, 38, 28], yel: 20, serr: false },
    { n: 260, base: [22, 58, 30], yel: 8, serr: false, needle: true },
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
export function treeMaterials() {
  const leafTex = leafTexture();
  const crown = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35 });
  const p = positionWorld;
  const tid = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  const wind = length(U.wind);
  const gust = sin(U.t.mul(0.9).add(tid.mul(30))).mul(0.5).add(0.5);
  const g0 = positionGeometry;
  const sway = sin(U.t.mul(1.6).add(tid.mul(17)).add(g0.x.mul(1.3))).mul(wind.mul(0.008).mul(gust.mul(0.7).add(0.3)));
  const flutter = sin(U.t.mul(9).add(g0.x.mul(23)).add(g0.z.mul(17))).mul(wind.mul(0.0032));
  const lift = g0.y.add(1).max(0).mul(4);
  crown.positionNode = positionLocal.add(vec3(sway.mul(lift).add(flutter), flutter.mul(0.6), sway.mul(lift).mul(0.6)));
  const lt = texture(leafTex, uv());
  const dist = length(cameraPosition.sub(p));
  const alpha = lt.a.mul(mix(float(1), float(2.4), smoothstep(25, 160, dist)));
  // instanceColor is the species (set in tiles.js): oak, lime, plane, copper, yew
  const species = attribute('instanceColor', 'vec3');
  let col = lt.rgb.mul(species).mul(tid.mul(0.18).add(0.9)).mul(mix(float(1), float(0.72), U.wet));
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.78);
  const pg = positionGeometry;
  const r = length(pg);
  const ao = smoothstep(0.2, 0.95, r).mul(0.6).add(0.4).mul(pg.y.mul(0.28).add(0.8));
  col = col.mul(ao);
  crown.colorNode = vec4(col.mul(cloudShadow(p)), alpha);
  const v = normalize(p.sub(cameraPosition));
  const back = pow(max(dot(v, U.sunDir), 0), 5).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.6)));
  crown.emissiveNode = col.mul(vec3(1.05, 1.15, 0.45)).mul(U.sunCol).mul(back.mul(0.95).add(0.025));
  const trunk = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const tuv = vec2(uv().x.mul(1.6), positionWorld.y.mul(0.85));
  const bark = sAlbedo(int(L.bark), tuv);
  const lichen = smoothstep(0.62, 0.86, texture(leafTex, tuv.mul(0.15)).g).mul(0.22);
  trunk.colorNode = bark.mul(mix(vec3(0.72, 0.62, 0.5), vec3(0.85), species.b)).mul(mix(float(1), float(0.62), U.wet)).mul(mix(vec3(1), vec3(0.75, 0.9, 0.62), lichen)).mul(cloudShadow(positionWorld));
  trunk.normalNode = perturb(normalWorld, sDetail(int(L.bark), tuv), float(1.35));
  return { crown, trunk };
}
