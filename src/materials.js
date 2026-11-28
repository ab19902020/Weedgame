// TSL materials for the streamed world. All weather response (wetness, puddles, shelter,
// cloud shadows, night light pools, wet reflections) flows from the shared uniforms in env.js.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, positionWorld, positionLocal, normalWorld, cameraPosition, texture, uv,
  mix, smoothstep, step, clamp, fract, floor, abs, max, min, pow, exp, sin, cos, dot, normalize, length, reflect, select, If, Loop, fwidth,
  int, cross, dFdx, dFdy,
} from 'three/tsl';
import { U, noiseTex, cloudTex, coverTex, COVER_N, lightTex, LIGHT_N, LIGHT_RES, atlasTex, ATLAS_N, cloudShadow, skyColor, lightPos, lightCol, NL } from './env.js';
import { L, sAlbedo, sDetail, sAlbedoAT, perturb, perturbW, groundUV, worldToView } from './surfaces.js';
import { BRAND_N, paletteBytes } from './brands.js';
// branch-free select: plain select() compiles to if/else blocks, which breaks texture sampling
// (WGSL uniformity) and leaks block-scoped vars (GLSL). Both sides are cheap or already computed.
const sel = (c, a, b) => select(c, a, b).uniformFlow().toVar();   // own variable: GLSL emits the ternary unparenthesised

const brandTex = new THREE.DataTexture(paletteBytes(), BRAND_N, 1);
brandTex.magFilter = THREE.NearestFilter;
brandTex.minFilter = THREE.NearestFilter;
brandTex.wrapS = THREE.ClampToEdgeWrapping;
brandTex.wrapT = THREE.ClampToEdgeWrapping;
brandTex.colorSpace = THREE.NoColorSpace;
brandTex.needsUpdate = true;

const h1 = Fn(([x]) => fract(sin(x.mul(12.9898)).mul(43758.5453)));
const h3 = Fn(([v]) => fract(sin(dot(v, vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));
const nz = (p, scale) => texture(noiseTex, p.mul(scale));

// --- shared surface helpers ------------------------------------------------------------
export const viewDir = () => normalize(cameraPosition.sub(positionWorld));
// sheltered: 1 when a canopy / roof covers this point
export const shelter = Fn(([p]) => {
  const c = texture(coverTex, p.xz.sub(U.coverOrigin).div(COVER_N)).r;
  return step(p.y.add(0.4), c);
});
// light pools from street lamps & shops (night)
export const lightPool = Fn(([p]) => {
  const q = p.xz.sub(U.lightOrigin).div(LIGHT_N * LIGHT_RES);
  const inside = step(0.0, q.x).mul(step(q.x, 1.0)).mul(step(0.0, q.y)).mul(step(q.y, 1.0));
  // Keep the lit area anchored in world space; the raster can move in 48 m steps.
  const fade = float(1).sub(smoothstep(98,140,length(p.xz.sub(cameraPosition.xz))));
  return texture(lightTex, q).rgb.mul(U.night).mul(inside).mul(fade).mul(2.2);
});
// wet reflection: fresnel-weighted sky + vertical light streaks from nearby lamps/vehicles
export const skyReflection = Fn(([p, n, amount]) => {
  const v = viewDir();
  const r = reflect(v.negate(), n);
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 4).mul(0.85).add(0.05);
  // what a window sees near the horizon is the buildings and trees across the street, not open sky
  const horizon = smoothstep(-0.05, 0.4, r.y).mul(0.62).add(0.38);
  return skyColor(r).mul(fres).mul(horizon).mul(amount).mul(float(1).sub(U.night.mul(0.75))).mul(float(1).sub(U.ibl.mul(0.8)));
});
export const wetReflection = Fn(([p, n, amount, sharp]) => {
  const v = viewDir();
  const r = reflect(v.negate(), n);
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 4).mul(0.85).add(0.05);
  const sky = skyColor(r).mul(fres).mul(amount).mul(float(1).sub(U.night.mul(0.75))).mul(float(1).sub(U.ibl.mul(0.8)));
  const acc = vec3(0).toVar();
  If(amount.greaterThan(0.02), () => {
    const rh = normalize(r.xz.add(vec2(1e-5, 0)));
    Loop(NL, ({ i }) => {
      const L = lightPos.element(i), C = lightCol.element(i);
      const d = L.xyz.sub(p);
      const dist = length(d).max(0.01);
      const ld = d.div(dist);
      const hx = dot(rh, normalize(ld.xz.add(vec2(1e-5, 0))));
      const dy = r.y.sub(ld.y);
      const streak = pow(max(hx, 0), mix(float(300), float(2500), sharp)).mul(exp(dy.mul(dy).mul(-14)));
      acc.addAssign(C.rgb.mul(L.w).mul(streak).div(dist.mul(dist).mul(0.004).add(1)));
    });
  });
  // Fresnel-weighted: steep views of the wet ground right in front of the camera reflect little
  const streaks = acc.mul(amount).mul(fres.mul(2.4).add(0.04));
  return sky.add(streaks.div(streaks.add(1)).mul(1.6));        // soft-clipped so close signal heads don't flood
});

function std(opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, ...opts });
  return m;
}

// --- terrain --------------------------------------------------------------------------
const PAL = [ // landcover class -> tint (relative colour cast applied over the photographic layer)
  [0.42, 0.5, 0.27], [0.2, 0.2, 0.2], [0.55, 0.54, 0.52], [0.36, 0.32, 0.3], [0.08, 0.13, 0.15], [0.26, 0.31, 0.16],
  [0.6, 0.57, 0.36], [0.40, 0.56, 0.25], [0.26, 0.26, 0.26], [0.42, 0.38, 0.33], [0.46, 0.42, 0.37], [0.38, 0.52, 0.24],
  [0.52, 0.44, 0.38], [0.33, 0.56, 0.22], [0.44, 0.47, 0.26], [0.36, 0.41, 0.22], [0.40, 0.5, 0.28], [0.5, 0.49, 0.48],
  [0.5, 0.44, 0.35], [0.72, 0.66, 0.52]];
const palData = new Uint8Array(32 * 4);
PAL.forEach((c, i) => { palData[i * 4] = c[0] * 255; palData[i * 4 + 1] = c[1] * 255; palData[i * 4 + 2] = c[2] * 255; palData[i * 4 + 3] = 255; });
export const palTex = new THREE.DataTexture(palData, 32, 1, THREE.RGBAFormat);
palTex.magFilter = palTex.minFilter = THREE.NearestFilter; palTex.colorSpace = THREE.SRGBColorSpace; palTex.needsUpdate = true;
// landcover class -> surface layer
// classes (build_world.py LC): 0 grass 1 road 2 pavement 3 building 4 water 5 wood 6 farm 7 park 8 parking
// 9 rail 10 path 11 garden 12 plaza 13 pitch 14 allotment 15 scrub 16 cemetery 17 hard 18 brownfield 19 sand
// (3, the 2 m cells round a building's walls: paving, like the pavement beside it; 10, paths: tarmac)
const LAYER_OF = [L.grass, L.asphalt, L.flags, L.flags, L.soil, L.forest, L.soil, L.grass, L.asphalt, L.gravel,
  L.asphalt, L.grass, L.blocks, L.grass, L.soil, L.forest, L.grass, L.asphalt, L.soil, L.gravel];
const classLayer = (c) => {
  let n = int(LAYER_OF[19]);
  for (let i = 18; i >= 0; i--) n = sel(c.lessThan(i + 0.5), int(LAYER_OF[i]), n);
  return n;
};
const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

// inside a building (U.in*): true where the world's own surfaces should go (within the footprint, above its floor)
const indoorCut = p => { const d = p.xz.sub(U.inO), lx = dot(d, U.inX), ly = dot(d, U.inY);
  return U.inOn.mul(step(0.08, lx)).mul(step(lx, U.inWD.x.sub(0.08))).mul(step(0.08, ly)).mul(step(ly, U.inWD.y.sub(0.08))).mul(step(U.inWD.z.sub(0.3), p.y)).lessThan(0.5); };
export function terrainMaterial() {
  const m = std();
  m.maskNode = indoorCut(positionWorld);
  const slot = attribute('aslot', 'vec2');
  const p = positionWorld;
  const cls = Fn(([off]) => {
    const t = slot.mul(128).add(positionLocal.xz.add(off).div(2)).div(ATLAS_N);
    return texture(atlasTex, t).r.mul(255);
  });
  // jitter the 2 m landcover lookup so soft boundaries (grass, woods, fields) read as organic edges, not
  // pixels; hard town ground (roads, pavements, car parks, hard standing, building edges) keeps straight edges
  const c00 = cls(vec2(0, 0));
  const hardG = step(0.5, c00).mul(step(c00, 3.5)).add(step(7.5, c00).mul(step(c00, 10.5))).add(step(11.5, c00).mul(step(c00, 12.5))).add(step(16.5, c00).mul(step(c00, 17.5))).min(1);
  const jit = nz(p.xz, 1 / 5.3).rg.sub(0.5).mul(mix(float(2.4), float(0.45), hardG));
  const palC = Fn(([c]) => texture(palTex, vec2(c.add(0.5).div(32), 0.5)).rgb);
  const c0 = cls(jit);
  const tintRaw = palC(c0).mul(0.5).add(palC(cls(jit.add(vec2(1.6, 0)))).mul(0.25)).add(palC(cls(jit.add(vec2(0, -1.6)))).mul(0.25));
  const isWater = step(3.5, c0).mul(step(c0, 4.5));
  const layer = classLayer(c0);
  const greenish = step(c0, 0.5).add(step(6.5, c0).mul(step(c0, 7.5))).add(step(10.5, c0).mul(step(c0, 11.5))).add(step(12.5, c0).mul(step(c0, 16.5))).min(1);
  const uvm = groundUV(p);
  const big = nz(p.xz, 1 / 41).a;
  const tex = sAlbedoAT(layer, uvm, smoothstep(0.35, 0.65, nz(p.xz, 1 / 13).g));
  // grass and woodland floors take their colour cast from the landcover class; others stay photographic
  const tint = mix(vec3(1), clamp(tintRaw.div(vec3(0.42, 0.5, 0.27)), 0.55, 1.6), greenish.mul(0.6));
  // mown stripes on parks and pitches, plough lines on fields
  const stripes = step(6.5, c0).mul(step(c0, 7.5)).add(step(12.5, c0).mul(step(c0, 13.5))).mul(step(0.5, fract(p.x.mul(0.08).add(p.z.mul(0.02)))).mul(0.06));
  const rows = step(5.5, c0).mul(step(c0, 6.5)).mul(sin(p.x.mul(2.2).add(p.z.mul(0.6))).mul(0.07));
  // lawns: keep the photo's blade detail, pull its colour to British lawn green (cast per class)
  const isLawn = step(c0, 0.5).add(step(6.5, c0).mul(step(c0, 7.5))).add(step(10.5, c0).mul(step(c0, 11.5))).add(step(12.5, c0).mul(step(c0, 13.5))).add(step(15.5, c0).mul(step(c0, 16.5))).min(1);
  const lawn = vec3(luma(tex)).mul(vec3(0.62, 1.05, 0.3)).mul(tint).mul(mix(float(0.85), float(1.2), nz(p.xz, 1 / 6.1).r));
  const base = mix(tex.mul(tint), lawn, isLawn.mul(0.8));
  let albedo = base.mul(big.mul(0.25).add(0.88)).mul(float(1).add(stripes).add(rows));
  const clover = isLawn.mul(step(0.72, nz(p.xz, 1 / 0.45).r)).mul(step(nz(p.xz, 1 / 0.11).g, 0.42));
  const daisy = isLawn.mul(step(0.972, nz(p.xz, 1 / 0.16).b));
  albedo = mix(albedo, albedo.mul(vec3(0.62, 0.95, 0.5)), clover.mul(0.4));
  albedo = mix(albedo, vec3(0.8, 0.78, 0.64), daisy);
  const sh = shelter(p);
  const wet = U.wet.mul(float(1).sub(sh));
  albedo = albedo.mul(mix(float(1), mix(float(0.62), float(0.82), greenish), wet));
  // water: dark, smooth and rippled by wind and rain
  const t = U.t;
  const w1 = nz(p.xz.add(vec2(t.mul(0.9), t.mul(0.4))), 1 / 7).rg, w2 = nz(p.xz.add(vec2(t.mul(-0.5), t.mul(0.7))), 1 / 2.3).rg;
  const rip = w1.add(w2).sub(1).mul(mix(float(0.12), float(0.35), U.rain).add(length(U.wind).mul(0.01)));
  const waterN = normalize(vec3(rip.x, 1, rip.y));
  // under water (class 4) the terrain is the carved bed seen through the water surface: dark silt with weed
  const silt = mix(vec3(0.07, 0.065, 0.045), vec3(0.05, 0.075, 0.035), nz(p.xz, 1 / 2.7).g);
  albedo = mix(albedo, silt, isWater);
  const d = sDetail(layer, uvm);
  m.colorNode = albedo.mul(cloudShadow(p));
  m.roughnessNode = mix(mix(d.b.mul(0.35).add(0.62), float(0.32), wet), float(0.8), isWater);
  m.normalNode = worldToView(mix(perturbW(normalWorld, d, float(0.9)), mix(normalWorld, waterN, 0.3), isWater));
  m.emissiveNode = lightPool(p).mul(albedo);
  return m;
}

// --- open water: lakes, rivers, brooks (tile worker water surfaces over carved beds) ----------------------
// wDepth: metres of water over the bed at each vertex. Colour follows Beer-Lambert absorption (peaty green-
// brown English water), shallows turn clear over the bed, waves are three octaves of wind-driven noise plus rain
// rings, reflections are Fresnel-weighted sky and street lights, and a thin lapping line runs along the shore.
export function waterMaterial() {
  // lit by hand (unlit node material): the reflections come from the analytic sky, not the IBL cube map, whose
  // face joins show as a hard line on a mirror-flat lake; it is also cheaper than the full light loop on phones
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: THREE.DoubleSide });
  const p = positionWorld, t = U.t;
  const depth = attribute('wDepth', 'float').max(0);
  const wl = length(U.wind), wd = normalize(U.wind.add(vec2(1e-4, 0)));
  const calm = clamp(wl.mul(0.08).add(0.15), 0.15, 1);
  // height field from scrolling noise octaves (texture red channel), with its gradient by finite differences
  const hf = Fn(([q]) => {
    const a = nz(q.add(wd.mul(t.mul(0.55))), 1 / 9).r;
    const b = nz(q.add(vec2(t.mul(-0.31), t.mul(0.42))), 1 / 3.3).r;
    const c = nz(q.add(wd.mul(t.mul(1.3))), 1 / 1.1).r;
    return a.mul(0.55).add(b.mul(0.3)).add(c.mul(0.15).mul(calm));
  });
  const e = 0.35, h0 = hf(p.xz), hx = hf(p.xz.add(vec2(e, 0))), hz = hf(p.xz.add(vec2(0, e)));
  const amp = calm.mul(0.55).add(U.rain.mul(0.25));
  let gx = hx.sub(h0).div(e).mul(amp), gz = hz.sub(h0).div(e).mul(amp);
  // rain: expanding rings from random drops on a 0.6 m lattice
  const cell = floor(p.xz.div(0.6)), f = fract(p.xz.div(0.6)).sub(0.5);
  const rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  const ph = fract(t.mul(0.9).add(rnd)), rr = length(f).sub(ph.mul(0.45));
  const ring = sin(rr.mul(40)).mul(smoothstep(0.08, 0, abs(rr))).mul(float(1).sub(ph)).mul(U.rain).mul(step(0.35, rnd));
  gx = gx.add(f.x.mul(ring).mul(3)); gz = gz.add(f.y.mul(ring).mul(3));
  // wake: rings spreading from a swimmer (or a car wading), and churned water right around them
  const wv = p.xz.sub(vec2(U.wake.x, U.wake.y)), wdst = length(wv).max(0.05);
  const wave = sin(wdst.mul(7).sub(t.mul(6))).mul(exp(wdst.mul(-0.45))).mul(U.wake.z).mul(0.45);
  gx = gx.add(wv.x.div(wdst).mul(wave)); gz = gz.add(wv.y.div(wdst).mul(wave));
  const churn = smoothstep(1.4, 0.2, wdst).mul(U.wake.z);
  const n = normalize(vec3(gx.negate(), 1, gz.negate()));
  const v = normalize(cameraPosition.sub(p));
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 5).mul(0.95).add(0.02);
  // body: shallow water shows the bed, deep water is dark peaty green; lit by sun and sky
  const absorb = float(1).sub(exp(depth.mul(-0.55)));
  const body = mix(vec3(0.06, 0.085, 0.05), vec3(0.012, 0.03, 0.028), absorb);
  const day = float(1).sub(U.night.mul(0.85));
  const lit = vec3(U.sunCol).mul(max(U.sunDir.y, 0).mul(0.9)).mul(float(1).sub(U.cover.mul(0.6))).add(skyColor(vec3(0, 1, 0)).mul(0.55)).mul(day).add(0.02);
  // shore: a narrow lapping line where the water meets the bank (depth ~0), moving with the waves
  const lap = smoothstep(0.16, 0.02, depth).mul(smoothstep(0.45, 0.7, nz(p.xz.add(vec2(t.mul(0.2), 0)), 1 / 0.7).g.add(h0.mul(0.3))))
    .add(churn.mul(smoothstep(0.4, 0.85, nz(p.xz.add(vec2(t.mul(0.35), t.mul(-0.2))), 1 / 1.1).g.add(h0.mul(0.25)))).mul(0.5)).min(1);
  const bodyLit = mix(body, vec3(0.42, 0.44, 0.4), lap.mul(0.55)).mul(lit).mul(cloudShadow(p)).add(lightPool(p).mul(body));
  // reflection: the sky (plus street lights by night, from wetReflection's streaks) and the sun's glitter
  const r = reflect(v.negate(), n);
  const sky = skyColor(r).mul(float(1).sub(U.night.mul(0.75)));
  const sharpR = float(1).sub(calm.mul(0.6));     // calm water: long, sharp light streaks (and not a WGSL constant)
  const streaks = wetReflection(p, n, float(1), sharpR).sub(skyColor(r).mul(pow(float(1).sub(max(dot(n, v), 0)), 4).mul(0.85).add(0.05)).mul(float(1).sub(U.night.mul(0.75))).mul(float(1).sub(U.ibl.mul(0.8)))).max(0);
  const glint = pow(max(dot(r, U.sunDir), 0), 900).mul(30).add(pow(max(dot(r, U.sunDir), 0), 120).mul(0.6))
    .mul(vec3(U.sunCol)).mul(float(1).sub(U.night)).mul(float(1).sub(U.cover.mul(0.85)));
  const alpha = clamp(absorb.mul(1.1).add(0.3).add(fres.mul(0.5)).add(lap.mul(0.3)), 0.35, 0.97);
  // the blend scales everything by alpha: divide the reflections back up so shallows still mirror the sky
  const refl = sky.mul(fres).add(streaks).add(glint);
  m.colorNode = vec4(bodyLit.mul(float(1).sub(fres)).add(refl.div(alpha)), alpha);
  return m;
}

// --- roads, pavements, kerbs, paths, plazas, decks, ballast -------------------------------
export function groundMaterial() {
  const m = std();
  m.maskNode = indoorCut(positionWorld);
  const s = attribute('surf', 'float');
  const p = positionWorld;
  const isRoad = step(s, 0.5).add(step(4.5, s).mul(step(s, 5.5)));        // 0, 5
  const isPave = step(0.5, s).mul(step(s, 1.5)).add(step(5.5, s).mul(step(s, 6.5)));  // 1, 6
  const isKerb = step(1.5, s).mul(step(s, 2.5));
  const isPath = step(2.5, s).mul(step(s, 3.5));
  const isPlaza = step(3.5, s).mul(step(s, 4.5));
  const isBallast = step(6.5, s);
  const big = nz(p.xz, 1 / 37).a, patch = nz(p.xz, 1 / 23).g;
  // UK pavements: concrete flags, or tarmac where the large-scale noise says so
  const tarmacPave = isPave.mul(step(0.58, big)).mul(step(s, 1.5));
  const layer = sel(isRoad.add(tarmacPave).greaterThan(0.5), int(L.asphalt), sel(isPave.greaterThan(0.5), int(L.flags), sel(isKerb.greaterThan(0.5), int(L.concrete),
    sel(isPath.greaterThan(0.5), int(L.asphalt), sel(isPlaza.greaterThan(0.5), int(L.blocks), int(L.gravel))))));
  const uvm = groundUV(p).mul(sel(isPath.greaterThan(0.5), float(1.6), float(1)));
  const tex = sAlbedoAT(layer, uvm, smoothstep(0.3, 0.7, nz(p.xz, 1 / 11).g));
  // colour casts: darker A-road asphalt, repair patches, warm block paving, lighter tarmac pavements
  const roadTone = vec3(0.78).mul(smoothstep(0.62, 0.66, patch).mul(-0.18).add(1.04)).mul(big.mul(0.2).add(0.9));
  const tone = sel(isRoad.greaterThan(0.5), roadTone, sel(tarmacPave.greaterThan(0.5), vec3(0.95), sel(isPlaza.greaterThan(0.5), vec3(1.18, 0.92, 0.8),
    sel(isPath.greaterThan(0.5), vec3(0.82, 0.78, 0.72), sel(isBallast.greaterThan(0.5), vec3(0.8, 0.72, 0.66), vec3(1))))));
  let albedo = tex.mul(tone);
  // aggregate chips, tar patches, slab joints, weeds in the cracks, mossy kerbs
  const chip = smoothstep(0.80, 0.88, nz(p.xz, 1 / 0.07).r).mul(isRoad);
  albedo = albedo.add(vec3(0.55, 0.52, 0.46).mul(chip.mul(0.16)));
  const cell = floor(p.xz.mul(0.065));
  const patchPick = h3(vec3(cell.x, cell.y, 2.2));
  const fx = fract(p.x.mul(0.065)), fz = fract(p.z.mul(0.065));
  const insetX = patchPick.mul(.24), insetZ = fract(patchPick.mul(39)).mul(.32);
  const inPatch = step(0.88, patchPick).mul(smoothstep(insetX,insetX.add(.006),fx)).mul(step(fx, 0.86)).mul(smoothstep(insetZ,insetZ.add(.006),fz)).mul(step(fz, 0.86)).mul(isRoad);
  albedo = mix(albedo, albedo.mul(vec3(0.58, 0.56, 0.52)), inPatch);
  // sealed cracks ("tar snakes"): thin glossy black wavy lines over stretches of older tarmac, a pixel or so
  // wide close to, fading out before they could shimmer in the distance
  const snakeN = nz(p.xz.add(vec2(13.1, 7.7)), 1 / 6.1).r, snakeW = fwidth(snakeN).max(1e-4);
  const snake = isRoad.mul(float(1).sub(smoothstep(snakeW.mul(0.6), snakeW.mul(1.6).add(0.004), abs(snakeN.sub(0.5)))))
    .mul(smoothstep(0.55, 0.7, nz(p.xz, 1 / 41).b)).mul(float(1).sub(smoothstep(0.01, 0.03, snakeW)));
  albedo = mix(albedo, vec3(0.025, 0.025, 0.027), snake.mul(0.85));
  const joint = smoothstep(0.012, 0.04, fract(p.x.div(0.6))).mul(smoothstep(0.012, 0.04, fract(p.z.div(0.9))));
  const flags = isPave.mul(float(1).sub(step(0.5, tarmacPave)));
  albedo = mix(albedo.mul(0.58), albedo, mix(float(1), joint, flags));
  const weed = flags.mul(step(0.986, nz(p.xz, 1 / 1.3).r)).mul(step(0.4, nz(p.xz, 1 / 0.16).g));
  albedo = mix(albedo, vec3(0.1, 0.24, 0.06), weed);
  albedo = mix(albedo, albedo.mul(vec3(0.72, 0.86, 0.64)), isKerb.mul(smoothstep(0.5, 0.88, nz(p.xz, 1 / 1.5).r).mul(0.6)));
  // wetness & puddles (not under shelter)
  const sh = shelter(p);
  const expo = float(1).sub(sh);
  const wet = U.wet.mul(expo);
  const pmask = nz(p.xz, 1 / 9).a.mul(0.6).add(nz(p.xz, 1 / 2.7).g.mul(0.4));
  const pud = smoothstep(float(1).sub(U.puddle.mul(0.55)), float(1.02).sub(U.puddle.mul(0.55)), pmask).mul(expo).mul(isRoad.add(isPlaza).add(isPave.mul(0.6)).add(isPath).min(1));
  albedo = albedo.mul(mix(float(1), float(0.5), wet)).mul(mix(float(1), float(0.55), pud));
  const d = sDetail(layer, uvm);
  m.colorNode = albedo.mul(cloudShadow(p));
  m.roughnessNode = mix(mix(mix(d.b.mul(0.3).add(0.66), float(0.38), snake), float(0.2), wet), float(0.025), pud);
  const ripple = U.rain.mul(pud).mul(nz(p.xz.add(vec2(U.t.mul(0.31), U.t.mul(-0.2))), 1 / 0.6).r.sub(0.5).mul(0.25));
  const nFlat = normalize(vec3(ripple, 1, ripple.mul(0.7)));
  m.normalNode = worldToView(mix(perturbW(normalWorld, d, mix(float(1.0), float(0.45), wet)), nFlat, smoothstep(0.3, 0.7, pud)));
  m.emissiveNode = lightPool(p).mul(albedo.add(0.04)).add(wetReflection(p, nFlat, max(wet.mul(0.55), pud), pud));
  return m;
}

export function markingMaterial() {
  const m = std({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  m.maskNode = indoorCut(positionWorld);
  const s = attribute('surf', 'float');
  const p = positionWorld;
  // thermoplastic paint: worn by tyres, with the asphalt grain showing through
  const grain = sAlbedo(int(L.asphalt), groundUV(p)).r.mul(1.6);
  const wear = nz(p.xz, 1 / 0.5).r.mul(0.35).add(0.7).mul(smoothstep(0.1, 0.4, nz(p.xz, 1 / 3.1).g).mul(0.3).add(0.7));
  let albedo = mix(vec3(0.8, 0.8, 0.76), vec3(0.78, 0.62, 0.1), step(0.5, s)).mul(wear).mul(grain.mul(0.25).add(0.8));
  const blister = length(fract(p.xz.mul(16)).sub(.5));
  const relief = float(1).sub(smoothstep(.18,.31,blister)).mul(float(1).sub(smoothstep(.018,.09,fwidth(p.x).add(fwidth(p.z)))));
  const tactile = mix(vec3(.37,.115,.075),vec3(.54,.39,.20),step(2.5,s)).mul(relief.mul(.22).add(.91));
  albedo = mix(albedo,tactile,step(1.5,s));
  // road studs (cat's eyes, surf 4-7: red nearside edge, amber offside edge, white lane line, green slip
  // road): a grey body that throws headlight back in its own colour after dark
  const stud = step(3.5, s).mul(step(s, 7.5));
  const studCol = sel(s.lessThan(4.5), vec3(1, 0.05, 0.03), sel(s.lessThan(5.5), vec3(1, 0.5, 0.04), sel(s.lessThan(6.5), vec3(1, 0.97, 0.88), vec3(0.08, 1, 0.3))));
  albedo = mix(albedo, vec3(0.5, 0.5, 0.48), stud);
  // street ironwork (8 inspection cover, 9 gully grate): a worn frame, a cover's raised tread, a gully's slots;
  // the pattern settles to its average once a pixel covers more than a couple of its studs
  const iron = step(7.5, s), gully = step(8.5, s);
  const cu = uv(), fwc = max(fwidth(cu.x), fwidth(cu.y)).max(1e-4), near = float(1).sub(smoothstep(0.03, 0.09, fwc));
  const edgeD = min(min(cu.x, float(1).sub(cu.x)), min(cu.y, float(1).sub(cu.y)));
  const rim = float(1).sub(smoothstep(float(0.07).sub(fwc), float(0.07).add(fwc), edgeD));
  const tread = step(0.28, abs(fract(cu.x.mul(9)).sub(0.5))).max(step(0.28, abs(fract(cu.y.mul(9)).sub(0.5)))).oneMinus();
  const slots = step(abs(fract(cu.x.mul(7)).sub(0.5)), 0.22).mul(step(0.16, edgeD));
  const rust = nz(p.xz, 1 / 0.35).g;
  const ironBase = mix(vec3(0.11, 0.105, 0.1), vec3(0.2, 0.12, 0.07), smoothstep(0.55, 0.85, rust).mul(0.6));
  const coverCol = mix(ironBase, ironBase.mul(1.7), mix(float(0.35), tread, near).max(rim.mul(0.8)));
  const gullyCol = mix(mix(ironBase.mul(1.25), vec3(0.012), mix(float(0.45), slots, near)), ironBase.mul(1.6), rim);
  albedo = mix(albedo, mix(coverCol, gullyCol, gully), iron);
  const expo = float(1).sub(shelter(p));
  const wet = U.wet.mul(expo);
  albedo = albedo.mul(mix(float(1), float(0.8), wet));
  m.colorNode = albedo.mul(cloudShadow(p));
  m.roughnessNode = mix(mix(float(0.7), float(0.5), iron), float(0.25), wet);
  m.emissiveNode = lightPool(p).mul(albedo).add(skyReflection(p, vec3(0, 1, 0), wet.mul(mix(float(0.4), float(0.7), iron)))).add(studCol.mul(stud).mul(U.night.mul(2.2).add(0.12)));
  return m;
}

// --- structures (bridges, walls, fences, hedges, rails) ---------------------------------
export function structMaterial() {
  const m = std();
  m.maskNode = indoorCut(positionWorld);
  const s = attribute('surf', 'float');
  const p = positionWorld;
  const u = uv();
  // street props (ids 10..17, tile worker): 10 black bin, 11 blue lid, 12 green lid, 13 pillar-box red, 14 cable,
  // 15 creosoted pole, 16 bench timber, 17 dark grey plastic/metal
  const prop = step(9.5, s), timber = step(14.5, s).mul(step(s, 16.5));
  const layer = sel(s.lessThan(0.5), int(L.concrete_wall), sel(s.lessThan(1.5), int(L.brick_red), sel(s.lessThan(2.5), int(L.bark), sel(s.lessThan(3.5), int(L.grass),
    sel(s.lessThan(9.5), int(L.cladding), sel(timber.greaterThan(0.5), int(L.bark), int(L.concrete_wall)))))));
  const uvm = sel(s.lessThan(0.5), vec2(u.x, u.y.add(p.y)), u.mul(sel(s.lessThan(3.5).and(s.greaterThan(2.5)), float(2.5), float(1))));
  const tex = sAlbedo(layer, uvm);
  const fence = vec3(0.42, 0.32, 0.24).mul(step(0.1, fract(u.x.div(0.15))).mul(0.3).add(0.7));
  const hedgeLeaf = vec3(0.12, 0.28, 0.08).mul(nz(p.xz.add(vec2(p.y, 0)), 1 / 0.28).r.mul(0.7).add(0.55)).mul(nz(p.xz, 1 / 0.08).g.mul(0.35).add(0.82));
  const hedgeFlower = step(0.94, nz(p.xz, 1 / 0.14).r).mul(step(0.62, h1(floor(p.x.mul(0.2)).add(floor(p.z.mul(0.2))))));
  const hedgeCol = mix(hedgeLeaf, vec3(0.75, 0.58, 0.68), hedgeFlower);
  const propCol = sel(s.lessThan(10.5), vec3(0.035, 0.037, 0.04), sel(s.lessThan(11.5), vec3(0.03, 0.09, 0.3), sel(s.lessThan(12.5), vec3(0.045, 0.19, 0.06),
    sel(s.lessThan(13.5), vec3(0.52, 0.025, 0.02), sel(s.lessThan(14.5), vec3(0.015), sel(s.lessThan(15.5), vec3(0.15, 0.1, 0.065), sel(s.lessThan(16.5), vec3(0.36, 0.23, 0.13), vec3(0.08, 0.085, 0.09))))))));
  const propAlb = propCol.mul(tex.dot(vec3(0.3, 0.59, 0.11)).mul(mix(float(0.9), float(2.2), timber)).add(mix(float(0.6), float(0.2), timber)));
  const albedo0 = sel(s.lessThan(1.5), tex, sel(s.lessThan(2.5), tex.mul(fence).mul(2.2), sel(s.lessThan(3.5), hedgeCol.mul(tex.g.mul(1.4).add(0.45)), sel(s.lessThan(9.5), vec3(0.46, 0.47, 0.48), propAlb))));
  // 18 privet shrub, 19 red flowers, 20 yellow, 21 white, 22 ivy mound
  const isPlant = step(17.5, s);
  const plantCol = sel(s.lessThan(18.5), vec3(0.09, 0.24, 0.07), sel(s.lessThan(19.5), vec3(0.5, 0.1, 0.16), sel(s.lessThan(20.5), vec3(0.7, 0.52, 0.1), sel(s.lessThan(21.5), vec3(0.78, 0.76, 0.68), vec3(0.1, 0.28, 0.08)))));
  const plantN = nz(p.xz.add(vec2(0, p.y)), 1 / 0.16).r.mul(0.45).add(0.65);
  const albedo = mix(albedo0, plantCol.mul(plantN), isPlant);
  const wet = U.wet.mul(float(1).sub(shelter(p)));
  const d = sDetail(layer, uvm);
  m.colorNode = albedo.mul(mix(float(1), float(0.7), wet)).mul(cloudShadow(p));
  const steel = step(4.5, s).mul(float(1).sub(prop));
  const propRough = mix(sel(s.greaterThan(12.5).and(s.lessThan(13.5)), float(0.28), float(0.5)), float(0.82), timber);
  m.roughnessNode = mix(mix(mix(d.b.mul(0.3).add(0.62), float(0.45), wet), float(0.35), steel), mix(propRough, float(0.3), wet), prop);
  m.metalnessNode = steel.mul(0.6);
  const leafy = step(2.5, s).mul(step(s, 3.5)).add(isPlant).min(1);
  m.normalNode = perturb(normalWorld, d, mix(mix(float(0.9), float(0.35), prop.mul(float(1).sub(timber))), float(1.6), leafy));
  m.emissiveNode = lightPool(p).mul(albedo);
  return m;
}

// --- buildings --------------------------------------------------------------------------
// what's seen through shop windows: Blender renders (tools/blender/build_shop_textures.sh), an atlas of four rows
let shopShelves0 = null;
function shopShelvesTex() {
  if (shopShelves0) return shopShelves0;
  const t = shopShelves0 = new THREE.TextureLoader().load('assets/shop/window.jpg');
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function buildingMaterial() {
  const shopShelves = shopShelvesTex();
  const m = std();
  m.maskNode = indoorCut(positionWorld);   // (a shell lower than the rooms inside it showed its roof upstairs)
  const A = attribute('bA', 'vec4');
  // the tile worker places front doors and passes their position along the wall in the seed: seed + 1000 * (u * 4)
  const seedRaw = floor(A.y.add(0.5)), doorU = floor(seedRaw.div(1000)).mul(0.25);
  const floorH = A.x, seed = seedRaw.sub(floor(seedRaw.div(1000)).mul(1000)), code = floor(A.z.add(0.5)), packedPart = floor(A.w.add(0.5));
  const style = floor(packedPart.div(32)), part = packedPart.sub(style.mul(32));
  const party = floor(style.div(256)), finish = style.sub(party.mul(256)), roofFinish = floor(finish.div(32)), wallFinish = finish.sub(roofFinish.mul(32));
  const pEq = k => step(k - 0.5, part).mul(step(part, k + 0.5));
  const front = step(0.5, part).mul(step(part, 1.5));
  const cls = code.sub(floor(code.div(32)).mul(32));
  const shop = step(31.5, code.sub(floor(code.div(64)).mul(64)));
  const brand = floor(code.div(64.0));
  const hasBrand = step(0.5, brand);
  const fasciaCol = texture(brandTex, vec2(brand.add(0.5).div(BRAND_N), float(0.5))).rgb;
  const big = step(0.5, brand).mul(step(brand, 24.5));
  const bank = step(70.5, brand).mul(step(brand, 84.5));
  const isPub = step(143.5, brand).mul(step(brand, 159.5));
  const u = uv();
  const p = positionWorld;
  const r0 = h1(seed), r1 = h1(seed.add(17.3)), r2 = h1(seed.add(3.1)), r3 = h1(seed.add(41.7));
  // parts: 0/1 wall/frontage, 2 pitched roof, 3 flat roof, 4 gable, 5 chimney, 6 parapet, 7 trim (fascia,
  // bargeboard, hood), 8 gutter/downpipe, 9 ridge/hip tiles, 10 chimney pot, 11 soffit, 12 bay glazing, 13 bay/hood roof
  const isWall = step(part, 1.5).add(pEq(4)).add(pEq(6));
  const isRoof = pEq(2).add(pEq(9)).add(pEq(13));
  const isTrim = pEq(7), isGutter = pEq(8), isPot = pEq(10), isSoffit = pEq(11), isBay = pEq(12);
  const isFlat = step(2.5, part).mul(step(part, 3.5));
  const isChim = step(4.5, part).mul(step(part, 5.5));
  const isHouse = step(0.5, cls).mul(step(cls, 2.5));
  const isTerrace = step(1.5, cls).mul(step(cls, 2.5));
  const isInd = step(7.5, cls).mul(step(cls, 8.5));
  const isOffice = step(5.5, cls).mul(step(cls, 6.5));
  // ---- wall surface: photographic brick / render / pebbledash / cladding / stone
  const houseLayer = sel(r0.lessThan(mix(float(0.4), float(0.2), isTerrace)), int(L.brick_red), sel(r0.lessThan(mix(float(0.55), float(0.62), isTerrace)), int(L.brick_dark),
    sel(r0.lessThan(0.8), int(L.render), sel(r0.lessThan(0.92), int(L.pebbledash), int(L.brick_buff)))));
  const otherLayer = sel(isInd.greaterThan(0.5), int(L.cladding), sel(isOffice.greaterThan(0.5), sel(r0.lessThan(0.45), int(L.concrete_wall), sel(r0.lessThan(0.75), int(L.brick_red), int(L.render))),
    sel(cls.equal(9), int(L.stone), sel(r0.lessThan(0.4), int(L.brick_red), sel(r0.lessThan(0.6), int(L.brick_dark), int(L.render))))));
  const defaultWall = sel(isHouse.greaterThan(0.5), houseLayer, otherLayer);
  const wallLayer = sel(wallFinish.equal(1), int(L.brick_red), sel(wallFinish.equal(2), int(L.brick_dark), sel(wallFinish.equal(3), int(L.render), sel(wallFinish.equal(4), int(L.pebbledash), sel(wallFinish.equal(5), int(L.brick_buff), sel(wallFinish.equal(6), int(L.stone), sel(wallFinish.equal(7), int(L.concrete_wall), sel(wallFinish.equal(8), int(L.cladding), defaultWall))))))));
  const defaultRoof = sel(r3.lessThan(mix(float(0.45), float(0.85), isTerrace)), int(L.roof_slate), int(L.roof_clay));
  const roofLayer = sel(isFlat.greaterThan(0.5), int(L.felt), sel(roofFinish.equal(1), int(L.roof_slate), sel(roofFinish.equal(2), int(L.roof_clay), sel(roofFinish.equal(3), int(L.felt), defaultRoof))));
  const layer = sel(isWall.add(isBay).greaterThan(0.5), wallLayer, sel(isChim.greaterThan(0.5), int(L.brick_red), roofLayer));
  const uvm = vec2(u.x, u.y);
  const wallTex = sAlbedo(layer, uvm);
  const isRender = sel(wallLayer.equal(int(L.render)), float(1), float(0)).mul(isWall);
  const isPeb = sel(wallLayer.equal(int(L.pebbledash)), float(1), float(0)).mul(isWall);
  // render paint colours: magnolia, white, cream, pale grey, the odd pastel
  const paint = sel(r1.lessThan(0.35), vec3(1.25, 1.2, 1.05), sel(r1.lessThan(0.6), vec3(1.4, 1.4, 1.36), sel(r1.lessThan(0.8), vec3(1.3, 1.22, 1.0), sel(r1.lessThan(0.93), vec3(1.1, 1.12, 1.12), vec3(1.15, 1.25, 1.3)))));
  const cladTint = mix(vec3(0.75, 0.8, 0.85), vec3(0.45, 0.55, 0.7), r1);
  let wallCol = wallTex.mul(mix(vec3(1), paint, isRender)).mul(mix(vec3(1), vec3(1.5), isPeb)).mul(mix(vec3(1), cladTint.mul(1.3), sel(wallLayer.equal(int(L.cladding)), float(1), float(0))));
  wallCol = wallCol.mul(h1(seed.add(2.2)).mul(0.18).add(0.91));   // per-building weathering / batch variation
  const streak = isRender.mul(smoothstep(0.8, 0.96, nz(vec2(u.x.mul(2.2), float(0.3)), 0.4).r)).mul(smoothstep(0.2, 4.0, u.y));
  wallCol = wallCol.mul(float(1).sub(streak.mul(0.28)));
  const ivyN = nz(vec2(u.x.mul(0.7), u.y), 1 / 0.2);
  const ivy = isHouse.mul(pEq(1)).mul(step(h1(seed.add(8.8)), 0.34)).mul(step(u.x, mix(float(1.4), float(6.0), r2))).mul(step(u.y, mix(float(1.1), float(4.6), r1))).mul(step(0.4, ivyN.r));
  wallCol = mix(wallCol, vec3(0.07, 0.2, 0.06).mul(ivyN.g.mul(0.55).add(0.6)), ivy);
  // plinth course below the damp-proof line, and a rain-darkened band at the foot of the wall
  const fV0 = fwidth(u.y).max(1e-4);
  wallCol = wallCol.mul(mix(float(1), float(0.68), float(1).sub(smoothstep(float(0.32).sub(fV0), float(0.32).add(fV0), u.y)).mul(step(-2, u.y)))).mul(smoothstep(-0.4, 0.6, u.y).mul(0.12).add(0.88));
  // ---- windows / doors / shopfronts
  const fh = max(floorH, 2.4);
  const fi = floor(max(u.y, 0).div(fh));
  const fv = fract(max(u.y, 0).div(fh));
  const sp = sel(isHouse.greaterThan(0.5), mix(float(2.4), float(3.2), r2), sel(isOffice.greaterThan(0.5), mix(float(1.5), float(3.0), r2), mix(float(2.6), float(4), r2)));
  const ci = floor(u.x.div(sp));
  const cu = fract(u.x.div(sp));
  // anti-aliasing: how much wall one pixel covers (fU across, fV up, in the wall's own units), so each edge below
  // is smoothed over a pixel instead of snapping on and off as the camera moves: window frames, glazing bars,
  // sills, shop mullions and door frames are thinner than a pixel a short way off, and flickered
  const fU = fwidth(u.x).max(1e-4), fV = fwidth(u.y).max(1e-4);
  const fcu = fU.div(sp).mul(0.75), ffv = fV.div(fh).mul(0.75);
  const insideU = (x, half, f) => float(1).sub(smoothstep(half.sub(f), half.add(f), abs(x.sub(0.5))));   // |x - 0.5| < half
  const between = (x, lo, hi, f) => smoothstep(lo.sub(f), lo.add(f), x).mul(float(1).sub(smoothstep(hi.sub(f), hi.add(f), x)));
  const below = (x, e, f) => float(1).sub(smoothstep(e.sub(f), e.add(f), x));
  const lineAA = (d, hw, f) => float(1).sub(smoothstep(hw.sub(f), hw.add(f), d)).mul(min(float(1), hw.div(f)));   // a bar of half width hw, d from its middle
  // offices come in three kinds: punched windows, ribbon glazing (bands of windows floor by floor) and curtain
  // walling (glass floor to floor); blocks of flats get wider windows with coloured panels under them
  const offStyle = floor(h1(seed.add(61.7)).mul(3));
  const ribbon = isOffice.mul(step(0.5, offStyle)).mul(step(offStyle, 1.5)), curtainW = isOffice.mul(step(1.5, offStyle));
  const isFlats = step(2.5, cls).mul(step(cls, 3.5));
  const ww0 = sel(isOffice.greaterThan(0.5), mix(float(0.42), float(0.58), r1), sel(isInd.greaterThan(0.5), float(0.25), mix(float(0.42), float(0.56), isFlats)));
  const ww = mix(mix(ww0, float(0.965), ribbon), float(0.985), curtainW);
  const winTop = mix(mix(sel(isInd.greaterThan(0.5), float(0.9), float(0.78)), float(0.84), ribbon), float(0.975), curtainW);
  // blocks of flats: on some, every 2nd or 3rd column of windows is a balcony (a slab edge, a balustrade, a
  // glazed door behind); on some the concrete floor slabs show as bands; most have a stair core, a column of
  // tall narrow landing windows
  const flatBal = isFlats.mul(step(h1(seed.add(71.3)), 0.6));
  const balN = floor(h1(seed.add(72.1)).mul(2)).add(2), balK = ci.add(floor(h1(seed.add(73.7)).mul(3)));
  const balCol = flatBal.mul(step(balK.sub(floor(balK.div(balN)).mul(balN)), 0.5)).mul(step(0.5, fi));
  const stairCi = floor(h1(seed.add(75.5)).mul(4)).add(1);
  const stairCol = isFlats.mul(step(h1(seed.add(75.9)), 0.7)).mul(step(abs(ci.sub(stairCi)), 0.5)).mul(float(1).sub(balCol));
  const winBot = mix(mix(mix(mix(sel(isInd.greaterThan(0.5), float(0.72), float(0.38)), float(0.3), ribbon), float(0.03), curtainW), float(0.035), balCol), float(0.12), stairCol);
  const shopUp = shop.mul(front).mul(step(0.5, fi));
  const wwS = mix(mix(ww, float(0.22), stairCol), float(0.36), shopUp);
  const botS = mix(winBot, float(0.46), shopUp);
  const topS = mix(mix(winTop, float(0.93), stairCol), float(0.7), shopUp);
  // view ray in façade space; u direction from screen derivatives so it always matches the uv
  const nW = normalWorld;
  const dp1 = dFdx(p), dp2 = dFdy(p), du1 = dFdx(u.x), du2 = dFdy(u.x);
  const tRaw = cross(dp2, nW).mul(du1).add(cross(nW, dp1).mul(du2));
  const tU = normalize(tRaw.sub(nW.mul(dot(nW, tRaw))).add(vec3(1e-5, 0, 1e-5)));
  const vIn = normalize(positionWorld.sub(cameraPosition));             // ray into the building
  const rx = dot(vIn, tU), ry = vIn.y, rz = max(dot(vIn, nW.negate()), 0.05);
  const rearShop = shop.mul(float(1).sub(front)).mul(step(fi, 0.5));
  const blankSide = big.mul(float(1).sub(front)).max(party);
  const inWin = insideU(cu, wwS.mul(0.5), fcu).mul(between(fv, botS, topS, ffv)).mul(step(0.0, u.y)).mul(isWall).mul(float(1).sub(shop.mul(front).mul(step(fi, 0.5)))).mul(float(1).sub(rearShop.max(blankSide)));
  // frames and glass sit 11 cm back in the opening: shift their coordinates by parallax and show the
  // reveal (shaded brick) where the shifted opening no longer covers the pixel
  const rev = float(0.11).div(rz).mul(float(1).sub(isInd));
  const cuS = cu.add(rx.mul(rev).div(sp)), fvS = fv.add(ry.mul(rev).div(fh));
  const opening = insideU(cuS, wwS.mul(0.5), fcu).mul(between(fvS, botS, topS, ffv));
  const reveal = inWin.mul(float(1).sub(opening));
  const fw = float(0.045).div(sp);                                 // ~6 cm uPVC frame
  const inner = insideU(cuS, wwS.mul(0.5).sub(fw), fcu).mul(between(fvS, botS.add(0.025), topS.sub(0.025), ffv)).mul(opening);
  // glazing bars: casement split for houses, transoms for offices
  const bar = isHouse.mul(lineAA(abs(cuS.sub(0.5)), fw.mul(0.5), fcu)).add(lineAA(abs(fvS.sub(mix(winBot, winTop, 0.72))), float(0.008), ffv).mul(isHouse))
    .add(isOffice.mul(lineAA(abs(fract(fvS.mul(2)).sub(0.5)), float(0.012), ffv.mul(2)))).min(1);
  const frame = inWin.mul(opening).mul(float(1).sub(inner)).add(inWin.mul(inner).mul(bar)).min(1);
  // shop street face: one shopfront, not brick piers with black garage openings
  const shopG = shop.mul(front).mul(step(fi, 0.5)).mul(step(-0.2, u.y));
  const f0m = fh.mul(0.76);
  const f1m = fh.mul(0.92);
  const fascia0 = mix(float(0.74), f0m.div(fh), big);
  const fascia1 = mix(float(0.975), f1m.div(fh), big);
  const gBot = mix(float(0.14), mix(mix(mix(float(0.14), float(0.02), big), float(0.32), bank), float(0.4), isPub), hasBrand);
  const bayW = mix(float(1.7), float(3.1), big);
  const inBand = shopG.mul(between(fv, gBot, fascia0, ffv));
  const cellU = fract(u.x.div(bayW)), fcell = fU.div(bayW).mul(0.75);
  const transom = lineAA(abs(fv.sub(mix(gBot, fascia0, 0.62))), float(0.012), ffv);
  const shopFront = inBand.mul(between(cellU, float(0.028), float(0.972), fcell)).mul(float(1).sub(transom));
  const shopFrame = inBand.mul(float(1).sub(shopFront));
  const doorHalf = mix(float(0.48), float(0.9), big);
  const doorCol = h1(seed.add(5.5)).mul(5).floor();
  const hasDoor = isHouse.mul(front).mul(step(0.1, doorU));
  const du = abs(u.x.sub(doorU));
  const isDoor = hasDoor.mul(below(du, float(0.46), fU)).mul(below(u.y, float(2.05), fV)).mul(step(0, u.y));
  const doorFrame = hasDoor.mul(below(du, float(0.54), fU)).mul(below(u.y, float(2.13), fV)).mul(step(-0.05, u.y)).mul(float(1).sub(isDoor));
  const doorGlass = isDoor.mul(below(du, float(0.28), fU)).mul(between(u.y, float(1.25), float(1.85), fV));
  const doorZone = hasDoor.mul(step(du, 0.8)).mul(step(fi, 0.5));
  const doorRGB = sel(doorCol.lessThan(1), vec3(0.04, 0.06, 0.16), sel(doorCol.lessThan(2), vec3(0.32, 0.04, 0.05), sel(doorCol.lessThan(3), vec3(0.02, 0.02, 0.02),
    sel(doorCol.lessThan(4), vec3(0.06, 0.16, 0.08), vec3(0.82, 0.82, 0.8)))));
  // bay window panels: u 0..1 per light, v in metres per storey; stall riser, stone sill, frames, transom, lintel
  const bv = u.y.sub(floor(u.y.div(fh)).mul(fh)), bfu = fract(u.x);
  const bRiser = isBay.mul(step(bv, 0.5)), bSill = isBay.mul(step(0.5, bv)).mul(step(bv, 0.57));
  const bHead = isBay.mul(step(min(fh.sub(0.3), float(2.32)), bv));
  const fb = fU.mul(0.75);
  const bFrame = isBay.mul(float(1).sub(bRiser)).mul(float(1).sub(bSill)).mul(float(1).sub(bHead))
    .mul(float(1).sub(between(bfu, float(0.06), float(0.94), fb)).add(lineAA(abs(bv.sub(1.85)), float(0.035), fV)).min(1));
  const bGlass = isBay.mul(float(1).sub(bRiser)).mul(float(1).sub(bSill)).mul(float(1).sub(bHead)).mul(float(1).sub(bFrame));
  const glass = max(max(inWin.mul(inner).mul(float(1).sub(bar)), shopFront).mul(float(1).sub(isDoor)).mul(float(1).sub(doorZone)), max(bGlass, doorGlass));
  // ---- room interiors behind the glass (parallax box: back wall, side walls, floor, ceiling)
  const depth = sel(shopFront.greaterThan(0.5), float(6), float(3.2));
  const halfW = sp.mul(0.5);
  const x0 = cuS.sub(0.5).mul(sp), y0 = fvS.mul(fh);
  const tBack = depth.div(rz);
  const tSide = sel(rx.greaterThan(0), halfW.sub(x0), halfW.add(x0)).div(abs(rx).max(1e-3));
  const tFloor = sel(ry.lessThan(0), y0.div(ry.negate().max(1e-3)), float(1e4));
  const tCeil = sel(ry.greaterThan(0), fh.sub(y0).div(ry.max(1e-3)), float(1e4));
  const tHit = min(min(tBack, tSide), min(tFloor, tCeil));
  const hitBack = step(tBack, tHit.add(1e-4)), hitSide = step(tSide, tHit.add(1e-4)).mul(float(1).sub(hitBack));
  const hitFloor = step(tFloor, tHit.add(1e-4)).mul(float(1).sub(hitBack)).mul(float(1).sub(hitSide));
  const roomSeed = h3(vec3(seed, fi, ci));
  const wallpaper = mix(vec3(0.55, 0.5, 0.42), vec3(0.42, 0.48, 0.5), h1(roomSeed.mul(91)));
  const room = sel(hitBack.greaterThan(0.5), wallpaper, sel(hitSide.greaterThan(0.5), wallpaper.mul(0.75), sel(hitFloor.greaterThan(0.5), vec3(0.22, 0.16, 0.12), vec3(0.75, 0.74, 0.7))));
  // furniture silhouettes in homes; shelving with stock in shops
  const hy = y0.add(ry.mul(tHit)), hx = x0.add(rx.mul(tHit)), hz = rz.mul(tHit);
  // (the room's fine detail fades to its average once a pixel covers more than a few centimetres of wall)
  const detail = float(1).sub(smoothstep(0.03, 0.1, max(fU, fV)));
  const furniture = hitBack.mul(step(hy, mix(float(0.7), float(1.1), roomSeed))).mul(step(abs(hx.sub(roomSeed.sub(0.5).mul(sp))), sp.mul(0.25))).mul(mix(float(0.15), float(0.6), detail));
  // what's in there, rendered in Blender (assets/shop/window.jpg, four rows from the bottom, each 4 m of wall repeating
  // and each place starting at its own point): a shop's stocked shelving 1.6 m high round its walls (tools/blender/
  // shelves.py), or the far wall 2.4 m high of a café, a takeaway or a pub, its counter or bar, staff, tables (eateries.py)
  const isCafe = step(35.5, brand).mul(step(brand, 41.5)).add(step(159.5, brand).mul(step(brand, 167.5)));
  const isFast = step(41.5, brand).mul(step(brand, 49.5)).add(step(167.5, brand));
  const eatery = isPub.add(isCafe).add(isFast).min(1);
  const row = isCafe.add(isFast.mul(2)).add(isPub.mul(3)), rowH = mix(float(1.6), float(2.4), eatery);
  const shelfZone = shopFront.mul(mix(hitBack.add(hitSide).min(1), hitBack, eatery)).mul(step(hy, rowH)).mul(detail);
  const along = sel(hitBack.greaterThan(0.5), hx, hz);
  const stock = texture(shopShelves, vec2(fract(along.div(4).add(roomSeed.mul(0.71))), row.add(hy.div(rowH).clamp(0.006, 0.994)).div(4))).rgb;
  let roomCol = room.mul(float(1).sub(furniture));
  // a shop's walls a mid grey (not the homes' wallpaper); a café's or a pub's warm
  roomCol = mix(roomCol, room.mul(mix(vec3(0.4, 0.4, 0.42), vec3(0.95, 0.78, 0.58), eatery)), shopFront);
  // above the shelves a shop is a dark bulkhead (and a dimmer ceiling between its lights), not more lit wall
  roomCol = mix(roomCol, vec3(0.05, 0.05, 0.055), shopFront.mul(float(1).sub(eatery)).mul(step(2.75, hy)).mul(hitBack.add(hitSide).min(1)));
  roomCol = mix(roomCol, roomCol.mul(0.5), shopFront.mul(float(1).sub(hitBack)).mul(float(1).sub(hitSide)).mul(float(1).sub(hitFloor)));
  roomCol = mix(roomCol, stock, shelfZone);
  // strip lights across a shop's ceiling, and now and then someone browsing against the shelves
  const hitCeil = float(1).sub(hitBack).mul(float(1).sub(hitSide)).mul(float(1).sub(hitFloor));
  const strip = shopFront.mul(hitCeil).mul(step(fract(hz.div(1.6)), 0.12)).mul(step(abs(fract(hx.div(2.4)).sub(0.5)), 0.38));
  roomCol = mix(roomCol, vec3(2.2, 2.15, 2.0), strip);
  const pu = fract(hx.div(2.9).add(roomSeed.mul(3))), pid = floor(hx.div(2.9).add(roomSeed.mul(3)));
  const pOn = step(h1(pid.add(roomSeed.mul(11))), 0.45);
  const body = step(abs(pu.sub(0.5)), float(0.07).sub(max(hy.sub(1.25), 0).mul(0.05))).mul(step(hy, 1.5)).mul(step(0.0, hy));
  const head = step(length(vec2(pu.sub(0.5).mul(2.9), hy.sub(1.62))), 0.11);
  const person = shopFront.mul(float(1).sub(eatery)).mul(hitBack).mul(pOn).mul(body.add(head).min(1)).mul(detail);   // (an eatery's are in its picture)
  const coat = mix(vec3(0.08, 0.09, 0.12), vec3(0.35, 0.12, 0.1), h1(pid.mul(5.3)));
  roomCol = mix(roomCol, mix(coat, vec3(0.55, 0.4, 0.32), head.mul(0.9)), person);
  roomCol = roomCol.mul(exp(tHit.mul(-0.12)));
  // further off, the parallax room's walls, floor and ceiling (which swap as the view angle changes) settle to
  // the room's average, so distant windows don't flicker as you move
  roomCol = mix(wallpaper.mul(0.55), roomCol, float(1).sub(smoothstep(0.05, 0.18, max(fU, fV))));
  // curtains / nets on homes, part-drawn blinds in offices
  const curtain = isHouse.mul(step(roomSeed, 0.55)).mul(smoothstep(halfW.mul(0.62).sub(fU), halfW.mul(0.62).add(fU), abs(x0)));
  const nets = isHouse.mul(step(0.55, roomSeed)).mul(step(roomSeed, 0.75)).mul(0.55);
  const blinds = isOffice.mul(step(roomSeed, 0.4)).mul(smoothstep(fh.mul(mix(float(0.45), float(0.85), h1(roomSeed.mul(7)))).sub(fV), fh.mul(mix(float(0.45), float(0.85), h1(roomSeed.mul(7)))).add(fV), y0)).mul(mix(float(0.75), step(0.35, fract(y0.mul(7))).mul(0.3).add(0.6), detail));
  const curtainCol = mix(vec3(0.5, 0.38, 0.3), vec3(0.78, 0.74, 0.66), h1(roomSeed.mul(37)));
  roomCol = mix(roomCol, curtainCol, curtain.max(blinds));
  roomCol = mix(roomCol, vec3(0.8, 0.8, 0.78), nets);
  roomCol = mix(roomCol, fasciaCol, shopFront.mul(hasBrand).mul(0.14));
  const lit = step(roomSeed, mix(float(0.06), float(0.55), U.night)).add(shopFront).min(1);
  const warm = mix(vec3(1.0, 0.74, 0.46), vec3(0.85, 0.9, 1.0), step(0.75, h1(roomSeed.mul(13))).max(shopFront));
  // ---- roofs: photographic clay / slate / felt with moss and weathering
  const moss = nz(p.xz, 1 / 3.1).g;
  const roofCol = wallTex.mul(mix(vec3(1), vec3(0.75, 0.85, 0.55), smoothstep(0.62, 0.8, moss).mul(0.35))).mul(h1(seed.add(9.9)).mul(0.2).add(0.9));
  const flatCol = wallTex.mul(sel(step(3.5, cls).mul(step(0.5, r1)).greaterThan(0.5), vec3(1.5), vec3(0.85)));
  let albedo = wallCol.mul(isWall);
  const frameCol = sel(isOffice.greaterThan(0.5), vec3(0.12, 0.13, 0.14), sel(r3.lessThan(0.85), vec3(0.9, 0.9, 0.88), vec3(0.15, 0.12, 0.1)));
  albedo = mix(albedo, frameCol, frame.mul(float(1).sub(doorZone)));
  albedo = mix(albedo, wallCol.mul(mix(float(0.55), float(0.8), step(0, ry))), reveal.mul(float(1).sub(shopFront)));
  const sill = insideU(cu, ww.mul(0.5).add(0.06), fcu).mul(between(fv, winBot.sub(0.05), winBot, ffv)).mul(isWall).mul(float(1).sub(isInd)).mul(float(1).sub(shopFront)).mul(float(1).sub(doorZone)).mul(step(0, u.y))
    .mul(float(1).sub(rearShop.max(blankSide))).mul(float(1).sub(shop.mul(front).mul(step(fi, 0.5)))).mul(float(1).sub(curtainW)).mul(float(1).sub(balCol)).mul(float(1).sub(stairCol));   // (only under a window that's there)
  albedo = mix(albedo, vec3(0.7, 0.68, 0.62), sill);
  // the panels under flats' windows: muted (weathered render, faded GRP, dark spandrel glass), and on about a
  // third of blocks none at all, just brick
  const panelCol = sel(r1.lessThan(0.25), vec3(0.38, 0.2, 0.15), sel(r1.lessThan(0.5), vec3(0.24, 0.25, 0.27), sel(r1.lessThan(0.7), vec3(0.16, 0.24, 0.25), sel(r1.lessThan(0.85), vec3(0.62, 0.61, 0.58), vec3(0.1, 0.1, 0.11)))));
  const flatPanel = isFlats.mul(step(0.34, h1(seed.add(79.3)))).mul(float(1).sub(stairCol)).mul(insideU(cu, ww.mul(0.5), fcu)).mul(between(fv, float(0.06), winBot.sub(0.04), ffv)).mul(isWall).mul(step(0, u.y)).mul(float(1).sub(shop.mul(front).mul(step(fi, 0.5))));
  albedo = mix(albedo, panelCol, flatPanel);
  // spandrels between a curtain wall's floors: a dark band at each slab
  const spandrel = curtainW.mul(isWall).mul(float(1).sub(between(fv, winBot, winTop, ffv))).mul(step(0, u.y)).mul(float(1).sub(shopG));
  albedo = mix(albedo, vec3(0.16, 0.18, 0.2), spandrel);
  albedo = mix(albedo, mix(vec3(0.012, 0.014, 0.016), vec3(0.03, 0.06, 0.07), curtainW.add(ribbon.mul(0.5))), glass);
  albedo = mix(albedo, doorRGB, isDoor.mul(float(1).sub(doorGlass)));
  albedo = mix(albedo, frameCol, doorFrame);
  albedo = mix(albedo, vec3(0.012, 0.014, 0.016), doorGlass);
  // the flats' floor slabs as pale concrete bands, then the balconies in front of everything
  const flatWall = isFlats.mul(isWall).mul(step(0, u.y)).mul(float(1).sub(blankSide)).mul(float(1).sub(shop.mul(front).mul(step(fi, 0.5))));
  const slabs = flatWall.mul(step(h1(seed.add(76.3)), 0.5)).mul(step(0.5, fi)).mul(below(fv, float(0.075), ffv));
  albedo = mix(albedo, vec3(0.62, 0.61, 0.58), slabs);
  const balU = insideU(cu, ww.mul(0.5).add(0.1), fcu);
  const balRail = balCol.mul(flatWall).mul(balU).mul(below(fv, float(0.37), ffv));
  const balSlab = balCol.mul(flatWall).mul(insideU(cu, ww.mul(0.5).add(0.12), fcu)).mul(below(fv, float(0.05), ffv));
  const bStyle = h1(seed.add(77.7));
  const railBars = lineAA(abs(fract(u.x.div(0.12)).sub(0.5)), float(0.09), fU.div(0.12)).mul(float(1).sub(smoothstep(0.03, 0.08, fU)));
  const topRail = between(fv, float(0.34), float(0.37), ffv);
  const balOcc = balRail.mul(sel(bStyle.lessThan(0.35), float(0.55), sel(bStyle.lessThan(0.7), railBars.mul(0.6).add(0.15), float(1))));
  const balRGB = sel(bStyle.lessThan(0.35), vec3(0.08, 0.12, 0.13), sel(bStyle.lessThan(0.7), vec3(0.06, 0.065, 0.07), mix(vec3(0.82, 0.82, 0.8), panelCol, step(0.5, h1(seed.add(78.1))))));
  albedo = mix(albedo, balRGB, balOcc);
  albedo = mix(albedo, vec3(0.1, 0.1, 0.11), balRail.mul(topRail));
  albedo = mix(albedo, vec3(0.7, 0.69, 0.66), balSlab);
  albedo = albedo.add(roofCol.mul(isRoof).mul(float(1).sub(pEq(9).mul(0.3)))).add(flatCol.mul(isFlat)).add(wallTex.mul(isChim));
  // trims (uPVC white mostly; black or stained timber on some), gutters, soffits, clay pots, bay windows
  const trimCol = sel(r3.lessThan(0.8), vec3(0.8, 0.8, 0.78), sel(r3.lessThan(0.93), vec3(0.035, 0.035, 0.04), vec3(0.17, 0.1, 0.055)));
  const gutterCol = sel(r1.lessThan(0.22), vec3(0.75), vec3(0.03, 0.03, 0.032));
  albedo = albedo.add(trimCol.mul(isTrim)).add(gutterCol.mul(isGutter)).add(trimCol.mul(0.92).mul(isSoffit)).add(vec3(0.42, 0.2, 0.1).mul(isPot));
  albedo = albedo.add(isBay.mul(mix(mix(mix(vec3(0.012, 0.014, 0.016), trimCol, bFrame.add(bHead).min(1)), vec3(0.68, 0.66, 0.6), bSill), wallCol, bRiser)));
  // ground floor of a shop is a shopfront: pale surround, stall, metal frame, brand fascia. No brick.
  const fascia = shopG.mul(between(fv, fascia0, fascia1, ffv));
  const plainFascia = sel(r1.lessThan(0.5), vec3(0.09, 0.12, 0.18), vec3(0.14, 0.09, 0.09));
  const fasciaRGB = mix(plainFascia, fasciaCol, hasBrand);
  albedo = mix(albedo, vec3(0.86, 0.87, 0.88), shopG);
  albedo = mix(albedo, fasciaRGB, fascia);
  const crown = shopG.mul(smoothstep(fascia1.sub(ffv), fascia1.add(ffv), fv));
  albedo = mix(albedo, vec3(0.8, 0.81, 0.82), crown);
  // big stores and sheds: profiled steel cladding (vertical ribs every 30 cm) in two tones split by a
  // brand-coloured stripe, over a brick plinth with a flashing on top, rather than one flat pale slab
  // (the 30 cm ribs fade to their average once a pixel covers a third of one: they made moire that crawled)
  const ribs = smoothstep(0.3, 0.46, abs(fract(u.x.div(0.3)).sub(0.5)));
  const ribShade = mix(float(1.0), float(1.04).sub(ribs.mul(0.13)).sub(below(fract(u.x.div(0.3)), float(0.06), fU.div(0.3)).mul(0.06)), float(1).sub(smoothstep(0.03, 0.1, fU)));
  const splitY = mix(float(4.2), float(5.4), r2);
  const stripeB = below(abs(u.y.sub(splitY)), float(0.2), fV);
  const cladTop = mix(vec3(0.78, 0.79, 0.8), vec3(0.62, 0.66, 0.7), step(0.6, r1));
  const cladLow = mix(vec3(0.42, 0.44, 0.47), vec3(0.2, 0.26, 0.24), step(0.7, r3));
  let cladCol = mix(cladTop, cladLow, step(u.y, splitY)).mul(ribShade);
  cladCol = mix(cladCol, mix(vec3(0.16, 0.3, 0.42), fasciaCol.mul(0.85), hasBrand), stripeB);
  cladCol = mix(cladCol, vec3(0.62, 0.63, 0.64), lineAA(abs(u.y.sub(2.05)), float(0.05), fV));      // plinth flashing
  cladCol = mix(cladCol, wallCol.mul(0.9), below(u.y, float(2.0), fV));                            // brick plinth
  const bigTop = big.mul(front).mul(step(0.5, fi)).mul(isWall);
  albedo = mix(albedo, cladTop.mul(ribShade), bigTop);
  const stallCol = mix(mix(mix(vec3(0.16, 0.16, 0.17), fasciaCol.mul(0.55), big), vec3(0.45, 0.43, 0.4), bank), vec3(0.1, 0.09, 0.08), isPub);
  const stall = shopG.mul(step(0.0, u.y)).mul(below(fv, gBot, ffv));
  albedo = mix(albedo, mix(vec3(0.2, 0.2, 0.21), stallCol, hasBrand), stall);
  const frameB = mix(vec3(0.07, 0.075, 0.08), mix(vec3(0.07, 0.075, 0.08), fasciaCol.mul(0.3), 0.3), hasBrand.mul(float(1).sub(big)));
  const sHalf = doorHalf;
  const sDoor = shopG.mul(step(0.4, doorU)).mul(below(abs(u.x.sub(doorU)), sHalf, fU)).mul(step(0.02, u.y)).mul(below(u.y, floorH.mul(fascia0), fV));
  const sFrame = shopG.mul(step(0.4, doorU)).mul(below(abs(u.x.sub(doorU)), sHalf.add(0.08), fU)).mul(step(-0.02, u.y)).mul(below(u.y, floorH.mul(fascia0).add(0.04), fV)).mul(float(1).sub(sDoor));
  albedo = mix(albedo, frameB, shopFrame.add(sFrame).min(1));
  albedo = mix(albedo, vec3(0.07, 0.08, 0.085), shopFront.add(sDoor).min(1));
  const shed = blankSide.mul(isWall).mul(float(1).sub(min(glass.add(frame), float(1))));
  albedo = mix(albedo, cladCol, shed);
  const mossFoot = isWall.mul(float(1).sub(shopG)).mul(float(1).sub(glass.add(frame).min(1))).mul(smoothstep(1.15, -0.1, u.y)).mul(smoothstep(0.42, 0.8, nz(vec2(u.x, u.y.mul(1.7)), 1 / 0.65).g));   // façade uv: p.xz is constant down a wall and drew stripes
  albedo = mix(albedo, vec3(0.14, 0.2, 0.09), mossFoot.mul(0.5));
  const trimAll = isTrim.add(isGutter).add(isSoffit).add(isPot).add(bFrame).add(bHead).add(bSill).add(doorFrame).min(1);
  // wetness: roofs collect rain first and darken / gloss
  const wet = U.wet;
  albedo = albedo.mul(mix(float(1), mix(float(0.8), float(0.6), isRoof.add(isFlat)), wet));
  const d = sDetail(layer, uvm);
  m.colorNode = albedo.mul(cloudShadow(p));
  // (shop glass a touch less mirror-like than house windows, and the frames satin, not glossy)
  m.roughnessNode = mix(mix(mix(mix(d.b.mul(0.3).add(0.62), float(0.35), wet.mul(isRoof.add(isFlat).add(isWall.mul(0.4)))), float(0.42), trimAll), float(0.62), shopFrame.add(sFrame).min(1)), mix(float(0.04), float(0.16), shopFront), glass.add(isDoor.mul(0.6)).min(1));
  m.metalnessNode = float(0);
  // glass mirrors the sky map, which has no street in it: towards the horizon (a shop window seen along the
  // parade, a block's windows from below) occlude that reflection, as the buildings and trees opposite would
  const rW = reflect(viewDir().negate(), nW);
  m.aoNode = mix(float(1), smoothstep(-0.05, 0.4, rW.y).mul(0.62).add(0.3), glass.add(doorGlass).min(1));
  const plain = glass.add(frame).add(isDoor).add(sill).add(trimAll).add(balRail).add(slabs).min(1);
  m.normalNode = perturb(nW, d, mix(float(1.0), float(0.7), isRender).mul(float(1).sub(plain)));
  const refl = skyReflection(p, nW, glass.mul(float(1).sub(balOcc)).mul(mix(float(0.55), float(1), h1(roomSeed.mul(17.3)).max(shopFront))).mul(mix(mix(float(0.6), float(1.0), curtainW.add(ribbon.mul(0.5))), float(0.18), shopFront)).add(wet.mul(isRoof).mul(0.25)));
  const daylight = float(1).sub(U.night).mul(mix(float(0.07), float(0.04), U.cover));
  // ceiling light: brighter towards the top of the room and the back wall
  const pool = hy.div(fh).mul(0.6).add(0.55).mul(mix(float(0.8), float(1.15), hitBack));
  const lamp = lit.mul(mix(float(0.55), mix(float(0.3), float(0.85), U.night), shopFront)).mul(pool);
  const shopDay = shopFront.add(sDoor).min(1).mul(float(1).sub(U.night)).mul(0.34);
  const seeIn = max(glass, sDoor).mul(float(1).sub(balOcc));
  // glass passes less of the room behind it the more obliquely it's seen (and reflects more): a shop window
  // seen along the street is mostly reflection, not a pale wash of lit shelves
  const transm = float(1).sub(pow(float(1).sub(max(dot(nW, viewDir()), 0)), 2).mul(0.85));
  const interior = roomCol.mul(seeIn).mul(warm.mul(lamp).add(daylight).add(shopDay)).mul(transm);
  m.emissiveNode = interior.add(refl).add(lightPool(p).mul(albedo)).add(fascia.mul(fasciaCol).mul(U.night).mul(0.55));
  // the real interior of an enterable building you're stood near shows through its ground-floor windows (interiors.js
  // showcase): the panes there are cut away, so what you see from the street is what you walk into
  // A pane is cut only where the view through it goes on into the room's box (its plan, floor to ceiling): at a glancing
  // angle past the room's end you'd otherwise see out through the back of the building
  const showRect = (o, X, Y, WD, on) => {
    const d = p.xz.sub(o), lx = dot(d, X), ly = dot(d, Y);
    const near = on.mul(step(-0.8, lx)).mul(step(lx, WD.x.add(0.8))).mul(step(-0.8, ly)).mul(step(ly, WD.y.add(0.8))).mul(step(WD.z.sub(0.3), p.y)).mul(step(p.y, WD.z.add(WD.w)));
    const c = cameraPosition.xz.sub(o), cl = vec3(dot(c, X), cameraPosition.y, dot(c, Y));
    const v = p.sub(cameraPosition), dl = vec3(dot(v.xz, X), v.y, dot(v.xz, Y));       // camera to pane, in the room's frame
    const inv = vec3(1, 1, 1).div(dl.add(step(abs(dl), vec3(1e-5)).mul(1e-4)));
    const t0 = vec3(0, WD.z, 0).sub(cl).mul(inv), t1 = vec3(WD.x, WD.z.add(WD.w), WD.y).sub(cl).mul(inv);
    const tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    return near.mul(step(tn, tf)).mul(step(1.02, tf));   // (the pane's at t = 1: the room's still ahead of it)
  };
  const showCut = max(showRect(U.shO0, U.shX0, U.shY0, U.shWD0, U.shOn0), showRect(U.shO1, U.shX1, U.shY1, U.shWD1, U.shOn1)).mul(step(0.5, glass));
  m.maskNode = indoorCut(positionWorld).and(showCut.lessThan(0.5));
  return m;
}

// --- trees (instanced leaf-card crowns built in vegetation.js) ------------------------------
export { treeMaterials } from './vegetation.js';

// --- simple lit/unlit helpers --------------------------------------------------------------
export function lampMaterial() {
  const m = std({ roughness: 0.6, metalness: 0.4 });
  const head = attribute('lampHead', 'float');
  m.colorNode = mix(vec3(0.3, 0.31, 0.32), vec3(0.9, 0.85, 0.7), head);
  m.emissiveNode = vec3(1.0, 0.78, 0.5).mul(head).mul(U.night).mul(6).mul(float(1).sub(smoothstep(425,555,length(positionWorld.xz.sub(cameraPosition.xz)))));
  return m;
}
