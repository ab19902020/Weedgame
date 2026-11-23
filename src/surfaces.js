// Photographic CC0 surface library (Poly Haven) packed into two texture arrays:
//   albedo[layer]  RGB sRGB colour (AO pre-multiplied)
//   detail[layer]  RG tangent-space normal (OpenGL), B roughness
// Layers are listed in www/assets/tex/library.json (built by tools/assets/fetch_textures.py).
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, vec4, float, int, uniformArray, normalize, cross, select, abs, sqrt, max, mix, dot, cameraViewMatrix } from 'three/tsl';

export const L = {
  asphalt: 0, flags: 1, blocks: 2, concrete: 3, grass: 4, brick_red: 5, brick_dark: 6, brick_buff: 7, render: 8,
  pebbledash: 9, roof_clay: 10, roof_slate: 11, felt: 12, cladding: 13, gravel: 14, bark: 15, soil: 16, stone: 17, concrete_wall: 18, forest: 19,
};
const COUNT = 20, N = 512;
// metres covered by one texture repeat (measured from brick/tile counts where Poly Haven's figure looked off)
const TILE = [3.0, 1.8, 2.0, 4.0, 2.0, 1.0, 1.15, 2.0, 2.0, 2.6, 2.2, 3.0, 4.0, 2.7, 2.25, 1.0, 2.0, 3.0, 1.5, 3.0];

function arrayTex(srgb) {
  const t = new THREE.DataArrayTexture(new Uint8Array(N * N * 4 * COUNT).fill(128), N, N, COUNT);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export const albedoTex = arrayTex(true);
export const detailTex = arrayTex(false);
export const tileScale = uniformArray(TILE.map(m => 1 / m), 'float');
export const surfacesReady = { value: false };

async function decode(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, N, N);
  return g.getImageData(0, 0, N, N).data;
}
export async function loadSurfaces(base = 'assets/tex/') {
  const jobs = [];
  for (let i = 0; i < COUNT; i++) {
    jobs.push(decode(`${base}${i}_a.jpg`).then(d => albedoTex.image.data.set(d, i * N * N * 4)));
    jobs.push(decode(`${base}${i}_n.jpg`).then(d => detailTex.image.data.set(d, i * N * N * 4)));
  }
  await Promise.all(jobs);
  albedoTex.needsUpdate = true; detailTex.needsUpdate = true;
  surfacesReady.value = true;
}

// --- TSL helpers --------------------------------------------------------------------------
// uv in metres; layer an int node. Returns raw samples.
export const sAlbedo = (layer, uvm) => texture(albedoTex, uvm.mul(tileScale.element(layer))).depth(layer).rgb;
export const sDetail = (layer, uvm) => texture(detailTex, uvm.mul(tileScale.element(layer))).depth(layer);
// Anti-tiling: blend two samples with different rotation/offset by a low-frequency mask.
export const sAlbedoAT = (layer, uvm, mask) => {
  const uv2 = vec2(uvm.y.mul(-1).add(17.3), uvm.x.add(5.1));
  return mix(sAlbedo(layer, uvm), sAlbedo(layer, uv2), mask);
};
// World-space direction -> view space (independent of the mesh's model matrix).
export const worldToView = (n) => normalize(cameraViewMatrix.mul(vec4(n, 0)).xyz);
// Perturb a world-space geometric normal with a tangent-space map sample. perturbW returns the
// WORLD normal (blend it with others via mix, never select: a select around this breaks GLSL
// codegen); perturb returns the VIEW normal for material.normalNode.
export const perturbW = (nW, d, strength) => {
  const flat = abs(nW.y).greaterThan(0.95);
  const t = normalize(select(flat, vec3(1, 0, 0), cross(vec3(0, 1, 0), nW)));
  const b = normalize(cross(nW, t));
  const xy = d.rg.mul(2).sub(1).mul(strength);
  const z = sqrt(max(float(1).sub(dot(xy, xy)), 0.04));
  return normalize(t.mul(xy.x).add(b.mul(xy.y)).add(nW.mul(z)));
};
export const perturb = (nW, d, strength) => worldToView(perturbW(nW, d, strength));
// Ground planes: uv = (x, -z) so tangent=+x, bitangent=-z keeps the basis right-handed.
export const groundUV = (p) => vec2(p.x, p.z.negate());
export { int };
