// Shared lighting / weather uniforms and procedural textures used by every material.
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, vec2, vec3, vec4, float, texture, Fn, positionWorld, cameraPosition, normalize, dot, max, mix, smoothstep, clamp, pow, exp, abs, fract, sin, sqrt, length } from 'three/tsl';
import { msTexture } from './atmosphere.js';
import { starCells, STAR_G } from './astro.js';

export const U = {
  sunDir: uniform(new THREE.Vector3(0.3, 0.8, 0.2)),   // key light: the sun by day, the moon at night
  sunCol: uniform(new THREE.Color(1, 0.95, 0.85)),
  zenith: uniform(new THREE.Color(0.25, 0.45, 0.75)),
  horizon: uniform(new THREE.Color(0.7, 0.78, 0.86)),
  fogCol: uniform(new THREE.Color(0.7, 0.75, 0.8)),
  fogDensity: uniform(0.0012),
  night: uniform(0),           // 0 day .. 1 full night (street lights on)
  wet: uniform(0),             // surface wetness 0..1
  puddle: uniform(0),          // puddle fill 0..1
  rain: uniform(0),            // current rain intensity 0..1
  cover: uniform(0.3),         // cloud cover 0..1
  cloudDark: uniform(0),       // storminess 0..1
  cloudOff: uniform(new THREE.Vector2(0, 0)), // wind-advected offset (m)
  wind: uniform(new THREE.Vector2(3, 1)),
  wake: uniform(new THREE.Vector3(0, 0, 0)),   // ripples spreading from a swimmer or a car in water: x, z, strength
  t: uniform(0),               // seconds (animation)
  moonDir: uniform(new THREE.Vector3(-0.3, 0.5, -0.2)),
  coverOrigin: uniform(new THREE.Vector2(0, 0)), // rain shelter raster origin (world xz of texel 0)
  lightOrigin: uniform(new THREE.Vector2(0, 0)),
  exposure: uniform(1),
  ibl: uniform(0),             // 1 when scene.environment (sky PMREM) supplies reflections
  // ---- sky (sky.js, weather.js): physically based atmosphere, volumetric clouds, sun, moon and stars
  sunTrue: uniform(new THREE.Vector3(0.3, 0.8, 0.2)),  // the sun itself, also below the horizon (twilight)
  sunTrans: uniform(new THREE.Color(1, 1, 1)),         // atmospheric transmittance towards the sun from the street
  skyE: uniform(20),           // solar irradiance in sky units (calibrates the atmosphere to the scene exposure)
  moonE: uniform(0),           // moonlight in the same units (phase and distance included)
  moonLit: uniform(0),         // illuminated fraction of the moon's disc
  moonRadius: uniform(0.0047), // apparent radius (radians)
  haze: uniform(1),            // aerosol (Mie) multiplier: dry summer haze .. murky drizzle
  cloudBase: uniform(1200),    // cloud layer base and thickness (m above the street)
  cloudThick: uniform(1400),
  cloudType: uniform(0.85),    // 0 stratus sheet .. 1 heaped cumulus
  cloudDens: uniform(1),       // extinction multiplier (rain clouds are denser)
  covThr: uniform(0.6),        // weather-map threshold that leaves `cover` of the sky clouded
  cirrus: uniform(0.2),        // high ice-cloud amount
  cloudSun: uniform(new THREE.Color(1, 1, 1)),   // direct light reaching the cloud layer (sun or moon), scene units
  skyAmb: uniform(new THREE.Color(0.3, 0.4, 0.55)), // light on the clouds from the sky above / the ground below
  groundAmb: uniform(new THREE.Color(0.12, 0.12, 0.1)),
  lp: uniform(0),              // urban light-pollution glow (night)
  starRot: uniform(new THREE.Matrix3()),          // world -> equatorial (sidereal time, latitude)
  starVis: uniform(0),         // 0 daylight .. 1 dark sky (twilight, moonlight, haze)
  celNorth: uniform(new THREE.Vector3(0, 0.78, -0.62)),
};
// nearby point lights for wet reflections: xyz + intensity, rgb + radius
export const NL = 16;
export const lightPos = uniformArray(new Array(NL).fill(0).map(() => new THREE.Vector4(0, -1000, 0, 0)), 'vec4');
export const lightCol = uniformArray(new Array(NL).fill(0).map(() => new THREE.Vector4(1, 1, 1, 0)), 'vec4');

// ------------------------------------------------------------------ noise textures
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
function tileNoise(n, cells, seed) {
  // tileable value-gradient noise via lattice interpolation
  const r = rng(seed), g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / n * cells, fy = y / n * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % cells) * cells + ix % cells], b = g[(iy % cells) * cells + (ix + 1) % cells];
    const c = g[((iy + 1) % cells) * cells + ix % cells], d = g[((iy + 1) % cells) * cells + (ix + 1) % cells];
    out[y * n + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}
function fbm(n, base, oct, seed) {
  const out = new Float32Array(n * n); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) { const t = tileNoise(n, base << o, seed + o * 101); for (let i = 0; i < out.length; i++) out[i] += t[i] * amp; tot += amp; amp *= 0.5; }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function worley(n, cells, seed) {
  const r = rng(seed), pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([(i % cells + r()) / cells, (Math.floor(i / cells) + r()) / cells]);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, cx = Math.floor(u * cells), cy = Math.floor(v * cells); let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = (cx + i + cells) % cells, gy = (cy + j + cells) % cells, p = pts[gy * cells + gx];
      let dx = p[0] + Math.floor((cx + i) / cells) / 1 * 0 - u + (cx + i < 0 ? -1 : cx + i >= cells ? 1 : 0), dy = p[1] - v + (cy + j < 0 ? -1 : cy + j >= cells ? 1 : 0);
      const d = dx * dx + dy * dy; if (d < best) best = d;
    }
    out[y * n + x] = Math.sqrt(best) * cells;
  }
  return out;
}
function makeTex(chs, n) {
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((chs[c] ? chs[c][i] : 0) * 255)));
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; t.colorSpace = THREE.NoColorSpace;
  return t;
}
// detail noise: r = fine fbm, g = medium, b = worley (cells), a = coarse blotches
const N = 256;
export const noiseTex = makeTex([fbm(N, 16, 4, 7), fbm(N, 4, 4, 19), worley(N, 12, 5).map(v => Math.min(1, v)), fbm(N, 2, 3, 41)], N);
// cloud noise: r = perlin-worley base, g = detail, b = large weather mask
const CN = 256;
const cBase = fbm(CN, 4, 5, 77), cW = worley(CN, 8, 91), cDet = fbm(CN, 16, 3, 13), cWeather = fbm(CN, 2, 3, 55);
export const cloudTex = makeTex([cBase.map((v, i) => Math.max(0, Math.min(1, v * 1.1 - (Math.min(1, cW[i])) * 0.35 + 0.15))), cDet, cWeather, cW.map(v => Math.min(1, v))], CN);

// ------------------------------------------------------------------ dynamic world textures
// Rain shelter raster: R channel = cover height above ground... we store absolute cover height (m) - 0, 1 m texels, 256 m window
export const COVER_N = 256;
export const coverData = new Float32Array(COVER_N * COVER_N).fill(-1000);
export const coverTex = new THREE.DataTexture(coverData, COVER_N, COVER_N, THREE.RedFormat, THREE.FloatType);
coverTex.magFilter = coverTex.minFilter = THREE.NearestFilter; coverTex.needsUpdate = true;
// Night light map (lamp pools / shop light), 1.5 m texels, 384 m window
export const LIGHT_N = 256, LIGHT_RES = 1.5;
export const lightData = new Uint8Array(LIGHT_N * LIGHT_N * 4);
export const lightTex = new THREE.DataTexture(lightData, LIGHT_N, LIGHT_N, THREE.RGBAFormat);
lightTex.magFilter = lightTex.minFilter = THREE.LinearFilter; lightTex.needsUpdate = true;
// Landcover atlas: 16 x 16 slots of 128 x 128
export const ATLAS_N = 2048;
export const atlasData = new Uint8Array(ATLAS_N * ATLAS_N);
export const atlasTex = new THREE.DataTexture(atlasData, ATLAS_N, ATLAS_N, THREE.RedFormat, THREE.UnsignedByteType);
atlasTex.magFilter = atlasTex.minFilter = THREE.NearestFilter; atlasTex.needsUpdate = true;

// ------------------------------------------------------------------ shared TSL helpers
export const nTex = (uvNode) => texture(noiseTex, uvNode);

// ------------------------------------------------------------------ cloud volumes (tools/sky/cloud_noise.py)
// 128^3 base shape, 32^3 detail and a 256^2 weather map (cumulus cells, Perlin-Worley, regional, cirrus).
// Filled when assets/clouds/noise3d.bin arrives; until then the sky is clear.
const vol = (n) => {
  const t = new THREE.Data3DTexture(new Uint8Array(n * n * n), n, n, n);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
};
export const shapeTex = vol(128), detailTex = vol(32);
export const weatherTex = new THREE.DataTexture(new Uint8Array(256 * 256 * 4), 256, 256, THREE.RGBAFormat);
weatherTex.wrapS = weatherTex.wrapT = THREE.RepeatWrapping; weatherTex.magFilter = THREE.LinearFilter; weatherTex.minFilter = THREE.LinearMipmapLinearFilter;
weatherTex.generateMipmaps = true; weatherTex.colorSpace = THREE.NoColorSpace; weatherTex.needsUpdate = true;
export const WEATHER_TILE = 24000;   // metres per weather-map repeat
// quantiles of the coverage field, so U.covThr can be set for a requested cloud fraction
export const coverQuantiles = new Float32Array(33).map((_, i) => i / 32);
const covField = (c, p, r) => c * 0.46 + p * 0.38 + r * 0.26 - 0.05;
let noiseLoad = null;
export function loadCloudNoise(base = 'assets/clouds/') {
  if (noiseLoad) return noiseLoad;
  noiseLoad = fetch(base + 'noise3d.bin').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
    const b = new Uint8Array(buf), n0 = 128 ** 3, n1 = 32 ** 3;
    shapeTex.image.data.set(b.subarray(0, n0)); shapeTex.needsUpdate = true;
    detailTex.image.data.set(b.subarray(n0, n0 + n1)); detailTex.needsUpdate = true;
    const w = b.subarray(n0 + n1, n0 + n1 + 256 * 256 * 4); weatherTex.image.data.set(w); weatherTex.needsUpdate = true;
    const f = new Float32Array(256 * 256);
    for (let i = 0; i < f.length; i++) f[i] = covField(w[i * 4] / 255, w[i * 4 + 1] / 255, w[i * 4 + 2] / 255);
    f.sort(); for (let i = 0; i <= 32; i++) coverQuantiles[i] = f[Math.min(f.length - 1, Math.floor(i / 32 * (f.length - 1)))];
    return true;
  }).catch(e => { console.warn('cloud noise', e); return false; });
  return noiseLoad;
}
// weather-map threshold leaving `cover` of the map clouded
export function coverThreshold(cover) {
  const q = Math.max(0, Math.min(1, 1 - cover)) * 32, i = Math.min(31, Math.floor(q)), f = q - i;
  return coverQuantiles[i] * (1 - f) + coverQuantiles[i + 1] * f;
}
// cloud coverage (0..1, soft-edged) at a world xz already shifted by the wind offset
export const cloudCoverage = Fn(([xz]) => {
  const w = texture(weatherTex, xz.div(WEATHER_TILE));
  const f = w.r.mul(0.46).add(w.g.mul(0.38)).add(w.b.mul(0.26)).sub(0.05);
  const soft = mix(float(0.16), float(0.3), U.cover);
  return smoothstep(U.covThr.sub(soft.mul(0.35)), U.covThr.add(soft), f).mul(smoothstep(0.0, 0.04, U.cover));
});
export const msTex = msTexture();
export const starTex = (() => {
  const t = new THREE.DataTexture(starCells(), STAR_G, STAR_G * 6, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
})();

// Ground shadow of the clouds: the weather-map coverage where the sun's ray from p crosses the middle of
// the cloud layer, so shadows sweep under the clouds you can see. A multiplier on albedo (1 in sun).
export const cloudShadow = Fn(([p]) => {
  const sd = U.sunDir;
  const h = U.cloudBase.add(U.cloudThick.mul(mix(float(0.3), float(0.15), U.cloudType)));
  const t = h.div(max(sd.y, 0.12));
  const q = p.xz.add(sd.xz.mul(t)).add(U.cloudOff);
  const c = cloudCoverage(q);
  const thick = smoothstep(0.75, 1.0, U.cover).mul(0.35).add(U.cloudDark.mul(0.25));
  return mix(float(1), float(0.42).sub(thick.mul(0.25)), clamp(c.mul(1.25), 0, 1).mul(smoothstep(0.02, 0.15, sd.y)));
});

// Sky radiance in a direction (no clouds): a cheap gradient fitted to the physical sky (weather.js
// evaluates the atmosphere for U.zenith / U.horizon), used for wet reflections and fog.
export const skyColor = Fn(([d]) => {
  const h = clamp(d.y, -0.2, 1);
  const base = mix(vec3(U.horizon), vec3(U.zenith), pow(smoothstep(-0.02, 0.9, h), 0.6));
  const sunAmt = max(dot(d, U.sunTrue), 0);
  const glow = pow(sunAmt, 8).mul(0.35).add(pow(sunAmt, 64).mul(0.6));
  const disk = smoothstep(0.99996, 0.99999, sunAmt).mul(12);
  const sunVis = smoothstep(-0.05, 0.02, U.sunTrue.y).mul(float(1).sub(U.cover.mul(0.85)));
  return base.add(vec3(U.sunCol).mul(glow.add(disk).mul(sunVis)));
});
