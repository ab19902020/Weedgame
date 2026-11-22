// TSL materials for the streamed world. All weather response (wetness, puddles, shelter,
// cloud shadows, night light pools, wet reflections) flows from the shared uniforms in env.js.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, positionWorld, positionLocal, normalWorld, cameraPosition, texture, uv,
  mix, smoothstep, step, clamp, fract, floor, abs, max, min, pow, exp, sin, cos, dot, normalize, length, reflect, select, If, Loop, fwidth,
} from 'three/tsl';
import { U, noiseTex, cloudTex, coverTex, COVER_N, lightTex, LIGHT_N, LIGHT_RES, atlasTex, ATLAS_N, cloudShadow, skyColor, lightPos, lightCol, NL } from './env.js';

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
  return texture(lightTex, q).rgb.mul(U.night).mul(inside).mul(2.2);
});
// wet reflection: fresnel-weighted sky + vertical light streaks from nearby lamps/vehicles
export const skyReflection = Fn(([p, n, amount]) => {
  const v = viewDir();
  const r = reflect(v.negate(), n);
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 4).mul(0.85).add(0.05);
  return skyColor(r).mul(fres).mul(amount).mul(float(1).sub(U.night.mul(0.75)));
});
export const wetReflection = Fn(([p, n, amount, sharp]) => {
  const v = viewDir();
  const r = reflect(v.negate(), n);
  const fres = pow(float(1).sub(max(dot(n, v), 0)), 4).mul(0.85).add(0.05);
  const sky = skyColor(r).mul(fres).mul(amount).mul(float(1).sub(U.night.mul(0.75)));
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
  return sky.add(acc.mul(amount).mul(fres.mul(2).add(0.3)));
});

function std(opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, ...opts });
  return m;
}

// --- terrain --------------------------------------------------------------------------
const PAL = [ // landcover class -> base colour (linear-ish sRGB values)
  [0.42, 0.5, 0.27], [0.2, 0.2, 0.2], [0.55, 0.54, 0.52], [0.36, 0.32, 0.3], [0.08, 0.13, 0.15], [0.26, 0.31, 0.16],
  [0.6, 0.57, 0.36], [0.40, 0.56, 0.25], [0.26, 0.26, 0.26], [0.42, 0.38, 0.33], [0.46, 0.42, 0.37], [0.38, 0.52, 0.24],
  [0.52, 0.44, 0.38], [0.33, 0.56, 0.22], [0.44, 0.47, 0.26], [0.36, 0.41, 0.22], [0.40, 0.5, 0.28], [0.5, 0.49, 0.48],
  [0.5, 0.44, 0.35], [0.72, 0.66, 0.52]];
const palData = new Uint8Array(32 * 4);
PAL.forEach((c, i) => { palData[i * 4] = c[0] * 255; palData[i * 4 + 1] = c[1] * 255; palData[i * 4 + 2] = c[2] * 255; palData[i * 4 + 3] = 255; });
export const palTex = new THREE.DataTexture(palData, 32, 1, THREE.RGBAFormat);
palTex.magFilter = palTex.minFilter = THREE.NearestFilter; palTex.colorSpace = THREE.SRGBColorSpace; palTex.needsUpdate = true;

export function terrainMaterial() {
  const m = std();
  const slot = attribute('aslot', 'vec2');
  const p = positionWorld;
  const cls = Fn(([off]) => {
    const t = slot.mul(128).add(positionLocal.xz.add(off).div(2)).div(ATLAS_N);
    return texture(atlasTex, t).r.mul(255);
  });
  const palC = Fn(([c]) => texture(palTex, vec2(c.add(0.5).div(32), 0.5)).rgb);
  const c0 = cls(vec2(0, 0));
  const col = palC(c0).mul(0.4).add(palC(cls(vec2(1.2, 0))).mul(0.15)).add(palC(cls(vec2(-1.2, 0))).mul(0.15))
    .add(palC(cls(vec2(0, 1.2))).mul(0.15)).add(palC(cls(vec2(0, -1.2))).mul(0.15));
  const isWater = step(3.5, c0).mul(step(c0, 4.5));
  const isGreen = float(1).sub(isWater);
  const n1 = nz(p.xz, 1 / 7).r, n2 = nz(p.xz, 1 / 61).a, n3 = nz(p.xz, 1 / 2.3).r;
  const field = step(5.5, c0).mul(step(c0, 6.5)).mul(sin(p.x.mul(0.8).add(p.z.mul(0.25))).mul(0.06));
  let albedo = col.mul(n1.mul(0.35).add(0.8)).mul(n2.mul(0.4).add(0.8)).mul(n3.mul(0.2).add(0.9)).add(field);
  const sh = shelter(p);
  const wet = U.wet.mul(float(1).sub(sh));
  albedo = albedo.mul(mix(float(1), float(0.78), wet.mul(isGreen)));
  const water = vec3(0.03, 0.05, 0.06);
  albedo = mix(albedo, water, isWater);
  const cs = cloudShadow(p);
  m.colorNode = albedo.mul(cs);
  m.roughnessNode = mix(mix(float(0.95), float(0.6), wet), float(0.08), isWater);
  const ripple = isWater.mul(U.rain).mul(nz(p.xz.add(vec2(U.t.mul(0.7), 0)), 1 / 1.3).r.mul(0.4));
  m.emissiveNode = lightPool(p).mul(albedo).add(skyReflection(p, vec3(ripple.sub(0.2).mul(0.15), 1, 0).normalize(), isWater.mul(0.9)));
  return m;
}

// --- roads, pavements, kerbs, paths, plazas, decks, ballast -------------------------------
export function groundMaterial() {
  const m = std();
  const s = attribute('surf', 'float');
  const p = positionWorld;
  const isRoad = step(s, 0.5).add(step(4.5, s).mul(step(s, 5.5)));        // 0, 5
  const isPave = step(0.5, s).mul(step(s, 1.5)).add(step(5.5, s).mul(step(s, 6.5)));  // 1, 6
  const isKerb = step(1.5, s).mul(step(s, 2.5));
  const isPath = step(2.5, s).mul(step(s, 3.5));
  const isPlaza = step(3.5, s).mul(step(s, 4.5));
  const isBallast = step(6.5, s);
  const fine = nz(p.xz, 1 / 0.9).r, fine2 = nz(p.xz, 1 / 0.21).r, big = nz(p.xz, 1 / 37).a, patch = nz(p.xz, 1 / 23).g;
  // asphalt with aggregate and repair patches
  const asphalt = vec3(0.105, 0.105, 0.11).mul(fine2.mul(0.5).add(0.75)).mul(smoothstep(0.62, 0.66, patch).mul(-0.25).add(1.05)).mul(big.mul(0.25).add(0.88));
  // UK concrete flags 600x900 / tarmac pavements
  const gx = fract(p.x.div(0.9)), gz = fract(p.z.div(0.6));
  const joint = max(smoothstep(0.035, 0.0, min(gx, float(1).sub(gx))), smoothstep(0.05, 0.0, min(gz, float(1).sub(gz))));
  const fwG = fwidth(p.x).add(fwidth(p.z));
  const aaG = smoothstep(0.03, 0.12, fwG);
  const flags = vec3(0.37, 0.36, 0.34).mul(fine.mul(0.2).add(0.88)).mul(float(1).sub(joint.mul(0.35).mul(float(1).sub(aaG))));
  const tarmacPave = vec3(0.17, 0.165, 0.16).mul(fine2.mul(0.5).add(0.75));
  const paveCol = mix(flags, tarmacPave, step(0.55, big));
  const kerb = vec3(0.46, 0.45, 0.43).mul(fine.mul(0.2).add(0.85));
  const path = vec3(0.2, 0.18, 0.15).mul(fine2.mul(0.5).add(0.75));
  const bx = fract(p.x.div(0.2).add(step(0.5, fract(p.z.div(0.2))).mul(0.5))), bz = fract(p.z.div(0.1));
  const brick = vec3(0.33, 0.21, 0.16).mul(float(1).sub(max(step(0.93, bx), step(0.9, bz)).mul(0.3).mul(float(1).sub(aaG)))).mul(fine.mul(0.3).add(0.8));
  const ballast = vec3(0.27, 0.24, 0.21).mul(fine2.mul(0.8).add(0.6));
  let albedo = asphalt.mul(isRoad).add(paveCol.mul(isPave)).add(kerb.mul(isKerb)).add(path.mul(isPath)).add(brick.mul(isPlaza)).add(ballast.mul(isBallast));
  // wetness & puddles (not under shelter)
  const sh = shelter(p);
  const expo = float(1).sub(sh);
  const wet = U.wet.mul(expo);
  const pmask = nz(p.xz, 1 / 9).a.mul(0.6).add(nz(p.xz, 1 / 2.7).g.mul(0.4));
  const pud = smoothstep(float(1).sub(U.puddle.mul(0.55)), float(1.02).sub(U.puddle.mul(0.55)), pmask).mul(expo).mul(isRoad.add(isPlaza).add(isPave.mul(0.6)).add(isPath));
  albedo = albedo.mul(mix(float(1), float(0.5), wet)).mul(mix(float(1), float(0.55), pud));
  const cs = cloudShadow(p);
  m.colorNode = albedo.mul(cs);
  m.roughnessNode = mix(mix(float(0.92), float(0.25), wet), float(0.03), pud);
  const ripple = U.rain.mul(pud).mul(nz(p.xz.add(vec2(U.t.mul(0.31), U.t.mul(-0.2))), 1 / 0.6).r.sub(0.5).mul(0.25));
  const n = normalize(vec3(ripple, 1, ripple.mul(0.7)));
  m.emissiveNode = lightPool(p).mul(albedo.add(0.04)).add(wetReflection(p, n, max(wet.mul(0.55), pud), pud));
  return m;
}

export function markingMaterial() {
  const m = std({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const s = attribute('surf', 'float');
  const p = positionWorld;
  const wear = nz(p.xz, 1 / 0.5).r.mul(0.35).add(0.7);
  let albedo = mix(vec3(0.78, 0.78, 0.74), vec3(0.75, 0.6, 0.1), step(0.5, s)).mul(wear);
  const expo = float(1).sub(shelter(p));
  const wet = U.wet.mul(expo);
  albedo = albedo.mul(mix(float(1), float(0.8), wet));
  m.colorNode = albedo.mul(cloudShadow(p));
  m.roughnessNode = mix(float(0.8), float(0.3), wet);
  m.emissiveNode = lightPool(p).mul(albedo).add(skyReflection(p, vec3(0, 1, 0), wet.mul(0.4)));
  return m;
}

// --- structures (bridges, walls, fences, hedges, rails) ---------------------------------
export function structMaterial() {
  const m = std();
  const s = attribute('surf', 'float');
  const p = positionWorld;
  const u = uv();
  const fine = nz(p.xz.add(p.y), 1 / 0.7).r;
  const concrete = vec3(0.45, 0.44, 0.42).mul(fine.mul(0.25).add(0.8)).mul(nz(p.xz.add(p.y.mul(3)), 1 / 9).a.mul(0.3).add(0.8));
  const bxv = fract(u.x.div(0.225).add(step(0.5, fract(u.y.div(0.075 * 2))).mul(0.5))), byv = fract(u.y.div(0.075));
  const brick = vec3(0.42, 0.2, 0.14).mul(float(1).sub(max(step(0.94, bxv), step(0.86, byv)).mul(0.35))).mul(fine.mul(0.3).add(0.8));
  const fence = vec3(0.22, 0.16, 0.11).mul(step(0.12, fract(u.x.div(0.15))).mul(0.25).add(0.75));
  const hedge = vec3(0.09, 0.17, 0.06).mul(nz(p.xz.add(p.y), 1 / 0.35).r.mul(0.9).add(0.45));
  const steel = vec3(0.45, 0.46, 0.47);
  const albedo = select(s.lessThan(0.5), concrete, select(s.lessThan(1.5), brick, select(s.lessThan(2.5), fence, select(s.lessThan(3.5), hedge, steel))));
  const wet = U.wet.mul(float(1).sub(shelter(p)));
  m.colorNode = albedo.mul(mix(float(1), float(0.7), wet)).mul(cloudShadow(p));
  m.roughnessNode = select(s.greaterThan(4.5), float(0.35), mix(float(0.9), float(0.5), wet));
  m.metalnessNode = select(s.greaterThan(4.5), float(0.6), float(0));
  m.emissiveNode = lightPool(p).mul(albedo);
  return m;
}

// --- buildings --------------------------------------------------------------------------
export function buildingMaterial() {
  const m = std();
  const A = attribute('bA', 'vec4');
  const floorH = A.x, seed = floor(A.y.add(0.5)), code = floor(A.z.add(0.5)), part = floor(A.w.add(0.5));
  const cls = code.sub(floor(code.div(32)).mul(32));
  const shop = step(31.5, code);
  const u = uv();
  const p = positionWorld;
  const r0 = h1(seed), r1 = h1(seed.add(17.3)), r2 = h1(seed.add(3.1));
  const isWall = step(part, 1.5).add(step(3.5, part).mul(step(part, 4.5))).add(step(5.5, part));
  const isRoof = step(1.5, part).mul(step(part, 2.5));
  const isFlat = step(2.5, part).mul(step(part, 3.5));
  const isChim = step(4.5, part).mul(step(part, 5.5));
  const isHouse = step(0.5, cls).mul(step(cls, 2.5));
  const isInd = step(7.5, cls).mul(step(cls, 8.5));
  const isOffice = step(5.5, cls).mul(step(cls, 6.5));
  // ---- facade base materials
  const fine = nz(vec2(u.x, u.y.add(p.x.mul(0.01))), 1 / 0.8).r;
  const bx = fract(u.x.div(0.225).add(step(0.5, fract(u.y.div(0.15))).mul(0.5))), by = fract(u.y.div(0.075));
  const mortar = max(step(0.93, bx), step(0.84, by));
  const brickTone = mix(vec3(0.36, 0.15, 0.09), vec3(0.42, 0.26, 0.15), r1).mul(h1(floor(u.x.div(0.225)).add(floor(u.y.div(0.075)).mul(13.1)).add(seed)).mul(0.25).add(0.85));
  const fwU = max(fwidth(u.x), fwidth(u.y));
  const aa = smoothstep(0.006, 0.028, fwU);           // fade small-scale pattern with pixel footprint
  const brickAvg = mix(vec3(0.38, 0.19, 0.12), vec3(0.45, 0.3, 0.19), r1);
  const brick = mix(mix(brickTone, vec3(0.55, 0.52, 0.47), mortar.mul(0.8)), brickAvg, aa);
  const yellowBrick = mix(mix(vec3(0.52, 0.43, 0.3), vec3(0.6, 0.57, 0.5), mortar.mul(0.7)), vec3(0.54, 0.46, 0.34), aa);
  const render = mix(vec3(0.72, 0.69, 0.6), vec3(0.8, 0.8, 0.76), r1).mul(fine.mul(0.12).add(0.92));
  const pebble = vec3(0.5, 0.49, 0.46).mul(mix(nz(u, 1 / 0.07).r.mul(0.45).add(0.75), float(0.97), aa));
  const clad = mix(vec3(0.5, 0.53, 0.55), vec3(0.32, 0.38, 0.46), r1).mul(step(0.3, fract(u.x.div(0.3))).mul(0.15).add(0.85));
  const concrete = vec3(0.55, 0.53, 0.5).mul(fine.mul(0.2).add(0.85));
  const stone = vec3(0.55, 0.5, 0.42).mul(nz(u, 1 / 0.4).r.mul(0.3).add(0.8));
  const houseWall = select(r0.lessThan(0.58), brick, select(r0.lessThan(0.8), render, select(r0.lessThan(0.92), pebble, yellowBrick)));
  const otherWall = select(isInd.greaterThan(0.5), clad, select(isOffice.greaterThan(0.5), select(r0.lessThan(0.45), concrete, select(r0.lessThan(0.75), brick, render)),
    select(cls.equal(9), stone, select(r0.lessThan(0.6), brick, render))));
  const wallCol = select(isHouse.greaterThan(0.5), houseWall, otherWall);
  // ---- windows / doors / shopfronts
  const fh = max(floorH, 2.4);
  const fi = floor(max(u.y, 0).div(fh));
  const fv = fract(max(u.y, 0).div(fh));
  const sp = select(isHouse.greaterThan(0.5), mix(float(2.4), float(3.2), r2), select(isOffice.greaterThan(0.5), mix(float(1.5), float(3.0), r2), mix(float(2.6), float(4), r2)));
  const ci = floor(u.x.div(sp));
  const cu = fract(u.x.div(sp));
  const ww = select(isOffice.greaterThan(0.5), mix(float(0.55), float(0.85), r1), select(isInd.greaterThan(0.5), float(0.25), float(0.45)));
  const winTop = select(isInd.greaterThan(0.5), float(0.92), float(0.8));
  const winBot = select(isInd.greaterThan(0.5), float(0.75), float(0.33));
  const inWin = step(abs(cu.sub(0.5)), ww.mul(0.5)).mul(step(winBot, fv)).mul(step(fv, winTop)).mul(step(0.0, u.y)).mul(isWall);
  const frame = inWin.mul(float(1).sub(step(abs(cu.sub(0.5)), ww.mul(0.5).sub(0.03)).mul(step(winBot.add(0.03), fv)).mul(step(fv, winTop.sub(0.03)))));
  const front = step(0.5, part).mul(step(part, 1.5));
  // ground floor shopfront on the frontage wall
  const shopFront = shop.mul(front).mul(step(fi, 0.5)).mul(step(0.06, fv)).mul(step(fv, 0.82)).mul(step(0.08, fract(u.x.div(2.6))));
  // front door for houses
  const doorCol = h1(seed.add(5.5)).mul(4).floor();
  const isDoor = isHouse.mul(front).mul(step(fi, 0.5)).mul(ci.equal(floor(r2.mul(2))).select(float(1), float(0))).mul(step(abs(cu.sub(0.5)), 0.2)).mul(step(fv, 0.78));
  const doorRGB = select(doorCol.lessThan(1), vec3(0.06, 0.08, 0.18), select(doorCol.lessThan(2), vec3(0.3, 0.05, 0.05), select(doorCol.lessThan(3), vec3(0.03, 0.03, 0.03), vec3(0.8, 0.8, 0.78))));
  const glass = max(inWin.sub(frame), shopFront).mul(float(1).sub(isDoor));
  const lit = step(h3(vec3(seed, fi, ci)), mix(float(0.0), float(0.55), U.night)).mul(glass);
  const glassCol = vec3(0.03, 0.04, 0.05);
  // ---- roofs
  const tileRow = fract(u.y.div(0.27));
  const slate = mix(vec3(0.13, 0.14, 0.16), vec3(0.34, 0.17, 0.11), step(0.55, h1(seed.add(9.9)))).mul(float(1).sub(step(0.85, tileRow).mul(mix(float(0.3), float(0.04), aa)))).mul(nz(u, 1 / 1.7).r.mul(0.3).add(0.8));
  const moss = nz(p.xz, 1 / 3.1).g;
  const roofCol = mix(slate, vec3(0.22, 0.24, 0.12), smoothstep(0.62, 0.8, moss).mul(0.4));
  const flatCol = mix(vec3(0.2, 0.2, 0.21), vec3(0.42, 0.42, 0.42), step(0.5, r1).mul(step(3.5, cls))).mul(nz(p.xz, 1 / 3).r.mul(0.3).add(0.8));
  const chim = brickTone.mul(0.9);
  let albedo = wallCol.mul(isWall);
  albedo = mix(albedo, vec3(0.92, 0.92, 0.9), frame.mul(isHouse).add(frame.mul(0.6)).min(1));
  albedo = mix(albedo, glassCol, glass);
  albedo = mix(albedo, doorRGB, isDoor);
  albedo = albedo.add(roofCol.mul(isRoof)).add(flatCol.mul(isFlat)).add(chim.mul(isChim));
  // wetness: roofs collect rain first and darken / gloss
  const wet = U.wet;
  albedo = albedo.mul(mix(float(1), mix(float(0.82), float(0.6), isRoof.add(isFlat)), wet));
  const cs = cloudShadow(p);
  m.colorNode = albedo.mul(cs);
  m.roughnessNode = mix(mix(float(0.88), float(0.4), wet.mul(isRoof.add(isFlat))), float(0.08), glass);
  m.metalnessNode = float(0);
  const n = normalWorld;
  const refl = skyReflection(p, n, glass.mul(0.6).add(wet.mul(isRoof).mul(0.25)));
  const warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.75, h3(vec3(seed, fi.add(3), ci))));
  m.emissiveNode = lit.mul(warm).mul(select(shop.greaterThan(0.5), float(2.4), float(1.3))).add(refl).add(lightPool(p).mul(albedo));
  return m;
}

// --- trees -------------------------------------------------------------------------------
export function treeMaterials() {
  const crown = std({ roughness: 0.85 });
  const p = positionWorld;
  const wobble = sin(U.t.mul(1.7).add(p.x.mul(0.3)).add(p.z.mul(0.2))).mul(length(U.wind).mul(0.012)).mul(positionLocal.y.max(0));
  crown.positionNode = positionLocal.add(vec3(wobble.mul(U.wind.x.sign()), 0, wobble.mul(0.6)));
  const leaf = nz(p.xz.add(p.y), 1 / 0.6).r;
  const base = vec3(0.12, 0.2, 0.07).mul(leaf.mul(0.7).add(0.55));
  crown.colorNode = base.mul(cloudShadow(p)).mul(mix(float(1), float(0.8), U.wet));
  crown.emissiveNode = lightPool(p).mul(base);
  const trunk = std({ roughness: 0.95, color: new THREE.Color(0.18, 0.14, 0.11) });
  return { crown, trunk };
}

// --- simple lit/unlit helpers --------------------------------------------------------------
export function lampMaterial() {
  const m = std({ roughness: 0.6, metalness: 0.4 });
  const head = attribute('lampHead', 'float');
  m.colorNode = mix(vec3(0.3, 0.31, 0.32), vec3(0.9, 0.85, 0.7), head);
  m.emissiveNode = vec3(1.0, 0.78, 0.5).mul(head).mul(U.night).mul(6);
  return m;
}
