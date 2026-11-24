// The sky: a physically based atmosphere, volumetric clouds, cirrus, and the sun, moon and stars.
//
//   createSky(quality, { celestial })  sky dome material. Rendered into the sky cube (skybake.js, one face
//       per frame) or per pixel with ?skybake=0. RGB is the sky with its clouds; alpha is the clouds'
//       transmittance, so the per-pixel celestial layer is hidden by cloud in front of it.
//   celestial(dir, T)  sun disc (limb darkened), the moon (its real place, phase, maria and earthshine)
//       and the stars (the real bright-star catalogue, turning with sidereal time, twinkling near the
//       horizon, faint ones lost to Reading's light pollution). Per screen pixel, so they stay sharp.
//   backgroundNode(cubeTexture)  scene.backgroundNode: the baked cube plus the celestial layer.
//
// Clouds are raymarched through a layer between U.cloudBase and its top on a curved Earth (so the deck
// converges on the horizon), shaped by a 2D weather map (coverage), a 3D Perlin-Worley volume and a Worley
// detail volume that frays the edges (wispy bases, cauliflower tops), with height profiles from flat
// stratus to heaped cumulus. Each sample is lit by sunlight (or moonlight) filtered through the atmosphere
// at cloud height, so clouds turn gold then pink after the street is in shadow, with Beer-Lambert
// self-shadowing, a softened multiple-scattering lobe, a two-lobe phase function (silver linings when
// looking towards the sun), sky light from above and ground light from below, then aerial perspective.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, texture, texture3D, cubeTexture, positionWorld, positionLocal, cameraPosition, normalize, dot, cross,
  max, min, mix, smoothstep, step, exp, pow, clamp, sqrt, abs, fract, floor, sin, cos, atan, log2, If, Loop, Break, length, screenCoordinate, fwidth,
} from 'three/tsl';
import { U, shapeTex, detailTex, weatherTex, msTex, starTex, loadCloudNoise, WEATHER_TILE } from './env.js';
import { ATM, XR, XM, MS_SCALE } from './atmosphere.js';
import { STAR_G } from './astro.js';

const R = ATM.R, TOP = ATM.top, CAM = 80;         // the street sits ~80 m up on the Thames valley floor
const BR = vec3(...ATM.bR), BO = vec3(...ATM.bO);
const FOURPI = 4 * Math.PI;

// ------------------------------------------------------------------ atmosphere (TSL twin of atmosphere.js)
const erfcxN = y => float(1.1283792).div(y.add(sqrt(y.mul(y).add(mix(float(1.2732395), float(2), y.div(y.add(1)))))));
const chapmanN = (X, h, mu) => {
  const x = h.add(X), up = exp(h.negate()).mul(sqrt(x.mul(1.5707963))).mul(erfcxN(sqrt(x.mul(0.5)).mul(abs(mu))));
  const x0 = x.mul(sqrt(max(float(1).sub(mu.mul(mu)), 0)));
  const down = sqrt(x0.mul(1.5707963)).mul(2).mul(exp(min(float(X).sub(x0), 60))).sub(up);
  return mix(down, up, step(0, mu));
};
// transmittance from altitude h (m) to space along cos(zenith) mu
export const transN = (h, mu) => {
  const cr = chapmanN(XR, h.div(ATM.HR), mu).mul(ATM.HR);
  const cm = chapmanN(XM, h.div(ATM.HM), mu).mul(U.haze).mul(ATM.HM / 0.9 * ATM.bM);
  const k = h.add(R).div(R + 25000);
  const co = float(15000).div(sqrt(max(float(1).sub(k.mul(k).mul(float(1).sub(mu.mul(mu)))), 1e-4)));
  return exp(BR.mul(cr).add(cm).add(BO.mul(co)).negate());
};
const PRn = c => c.mul(c).add(1).mul(3 / (16 * Math.PI));
const PMn = (c, g) => float(3 / (8 * Math.PI) * (1 - g * g) / (2 + g * g)).mul(c.mul(c).add(1)).div(pow(max(float(1 + g * g).sub(c.mul(2 * g)), 1e-4), 1.5));
const HG = (c, g) => float((1 - g * g) / FOURPI).div(pow(max(float(1 + g * g).sub(c.mul(2 * g)), 1e-4), 1.5));
const msAt = (h, mu) => texture(msTex, vec2(mu.mul(0.5).add(0.5), sqrt(h.div(TOP - R)))).level(0).rgb;

// sky radiance along unit direction d from the street: sun and moon, single + multiple scattering
export const atmosphere = (d, N = 10) => {
  const r0 = R + CAM, mu = max(d.y, -0.012);
  const tTop = mu.mul(-r0).add(sqrt(mu.mul(mu).sub(1).mul(r0 * r0).add(TOP * TOP)));
  const sR = vec3(0).toVar(), sM = vec3(0).toVar(), sMS = vec3(0).toVar();
  const mR = vec3(0).toVar(), mM = vec3(0).toVar(), mMS = vec3(0).toVar();
  const tau = vec3(0).toVar(), prev = float(0).toVar();
  Loop(N, ({ i }) => {
    const u = float(i).add(0.5).div(N), tt = tTop.mul(u).mul(u);
    const ds = tTop.mul(float(i).add(1).div(N).pow(2).sub(float(i).div(N).pow(2)));
    const p = vec3(d.x.mul(tt), d.y.mul(tt).add(r0), d.z.mul(tt)), r = length(p), h = max(r.sub(R), 0), up = p.div(r);
    const rR = exp(h.div(-ATM.HR)), rM = exp(h.div(-ATM.HM)), rO = max(float(1).sub(abs(h.sub(25000)).div(15000)), 0);
    tau.addAssign(BR.mul(rR).add(rM.mul(U.haze).mul(ATM.bM / 0.9)).add(BO.mul(rO)).mul(tt.sub(prev)));
    prev.assign(tt);
    const Tv = exp(tau.negate()).mul(ds), scat = BR.mul(rR).add(rM.mul(U.haze).mul(ATM.bM));
    const muS = dot(up, U.sunTrue), Ts = transN(h, muS).mul(Tv);
    sR.addAssign(Ts.mul(rR)); sM.addAssign(Ts.mul(rM)); sMS.addAssign(Tv.mul(msAt(h, muS)).mul(scat));
    const muM = dot(up, U.moonDir), Tm = transN(h, muM).mul(Tv);
    mR.addAssign(Tm.mul(rR)); mM.addAssign(Tm.mul(rM)); mMS.addAssign(Tv.mul(msAt(h, muM)).mul(scat));
  });
  const cS = dot(d, U.sunTrue), cM = dot(d, U.moonDir), bM = U.haze.mul(ATM.bM);
  const sun = sR.mul(BR).mul(PRn(cS)).add(sM.mul(bM).mul(PMn(cS, ATM.g))).add(sMS.mul(1 / MS_SCALE));
  const moon = mR.mul(BR).mul(PRn(cM)).add(mM.mul(bM).mul(PMn(cM, ATM.g))).add(mMS.mul(1 / MS_SCALE));
  // night: airglow and starlight keep the sky deep blue; the town's lights glow on the horizon
  const lift = max(d.y, 0);
  const floorC = vec3(0.0036, 0.0055, 0.0115).mul(exp(lift.mul(-3)).mul(1.2).add(0.6));
  const lp = vec3(0.07, 0.048, 0.03).mul(U.lp).mul(exp(lift.mul(-7)).mul(0.85).add(0.15));
  return sun.mul(U.skyE).add(moon.mul(U.moonE)).add(floorC).add(lp);
};

// ------------------------------------------------------------------ clouds
const remap = (x, a, b) => clamp(x.sub(a).div(max(b.sub(a), 1e-4)), 0, 1);
// distance along a ray from the street (cos zenith mu) to the shell `alt` metres above the street: the far
// root of the sphere intersection (we start inside it)
const shellT = (mu, alt) => { const rr = alt.add(R + CAM); return mu.mul(-(R + CAM)).add(sqrt(mu.mul(mu).sub(1).mul((R + CAM) ** 2).add(rr.mul(rr)))); };
// density at world point p (flat coordinates) whose altitude above the street is h; dist = from the eye
function cloudDensity(p, h, dist, detail) {
  const hf = h.sub(U.cloudBase).div(U.cloudThick);
  const xz = p.xz.add(U.cloudOff).add(U.wind.mul(hf.mul(45)));   // tops lean downwind
  const lvl = clamp(log2(dist.div(9000)), 0, 4);
  const w = texture(weatherTex, xz.div(WEATHER_TILE)).level(lvl);
  const f = w.r.mul(0.46).add(w.g.mul(0.38)).add(w.b.mul(0.26)).sub(0.05);
  const soft = mix(float(0.16), float(0.1), U.cover);
  const cov = max(smoothstep(U.covThr.sub(soft.mul(0.5)), U.covThr.add(soft), f), smoothstep(0.82, 0.98, U.cover)).mul(smoothstep(0.0, 0.04, U.cover));
  // vertical structure: flat bases; coverage shrinks with height so cumulus tops round off and the
  // biggest cells tower; stratus is a sheet filling its (thin) layer
  const topCu = float(1).sub(smoothstep(cov.mul(0.5).add(0.18), cov.mul(0.2).add(0.8), hf));
  const topSt = float(1).sub(smoothstep(0.55, 1.0, hf));
  const top = mix(topSt, topCu, U.cloudType);
  const q = vec3(xz.x, h.mul(1.5), xz.y);
  let shape = texture3D(shapeTex, q.div(4300)).level(0).r;
  // flat cumulus bases; stratocumulus decks get a lumpy, rolling base
  const baseRamp = smoothstep(0.0, mix(float(0.12), float(0.035), U.cloudType), hf.sub(float(0.66).sub(shape).mul(float(1).sub(U.cloudType)).mul(0.6))).mul(step(hf, 1));
  shape = mix(shape, float(0.66), smoothstep(14000, 42000, dist));       // distant clouds: no shimmer
  const c = cov.mul(top);
  let dens = remap(shape, float(1).sub(c), float(1)).mul(c).mul(baseRamp);
  if (detail) {
    const det = texture3D(detailTex, q.div(620).add(vec3(U.t.mul(0.004), 0, 0))).level(0).r;
    // wispy (inverted) detail at the base, billowy cauliflower detail on the tops
    const er = mix(det, float(1).sub(det), clamp(hf.mul(4), 0, 1)).mul(mix(float(0.42), float(0.22), U.cover)).mul(float(1).sub(smoothstep(6000, 24000, dist)));
    dens = remap(dens, er, float(1));
  }
  return dens;
}

export function createSky(quality = 12, opts = {}) {
  loadCloudNoise();
  const steps = Math.max(14, Math.round(quality * 3)), lightSteps = quality >= 12 ? 5 : 4;
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  // keep alpha (cloud transmittance): an opaque NormalBlending material would force it to 1
  mat.blending = THREE.NoBlending;
  mat.colorNode = Fn(() => {
    const d = normalize(positionWorld.sub(cameraPosition));
    const sky = atmosphere(d).toVar();
    const out = vec4(sky, 1).toVar();
    // ---------------------------------------------------------------- clouds
    const mu = d.y;
    If(mu.greaterThan(-0.004), () => {
      const t0 = shellT(mu, U.cloudBase), t1 = min(shellT(mu, U.cloudBase.add(U.cloudThick)), t0.add(36000));
      const T = float(1).toVar(), L = vec3(0).toVar(), wt = float(0).toVar(), wd = float(0).toVar();
      // cirrus first (it is behind everything), a thin sheet at 9 km
      const tc = shellT(mu, float(9000));
      If(U.cirrus.greaterThan(0.01).and(tc.lessThan(120000)), () => {
        const pc = cameraPosition.add(d.mul(tc));
        const wc = U.cloudOff.mul(1.6).add(pc.xz);
        const ang = atan(U.wind.y, U.wind.x);
        const ca = cos(ang), sa = sin(ang);
        const rot = vec2(wc.x.mul(ca).add(wc.y.mul(sa)), wc.y.mul(ca).sub(wc.x.mul(sa)));
        // fibrous ice cloud: soft wind-aligned streaks gathered into patches, gently bent by a slow warp
        const warp = texture(weatherTex, rot.div(60000).add(0.61)).level(0).rg.sub(0.5).mul(3500);
        const rw = rot.add(warp);
        const streak = texture(weatherTex, rw.div(vec2(26000, 7000)).add(0.37)).level(0).a;
        const fibre = texture(weatherTex, rw.div(vec2(9000, 1500))).level(0).a;
        const patch = texture(weatherTex, rot.div(64000)).level(0).b;
        const cd = smoothstep(0.3, 0.9, patch.mul(U.cirrus).mul(1.7)).mul(smoothstep(0.25, 0.85, streak)).mul(fibre.mul(0.35).add(0.65)).mul(0.45).mul(smoothstep(110000, 30000, tc));
        const upc = normalize(vec3(d.x.mul(tc), d.y.mul(tc).add(R + CAM), d.z.mul(tc)));
        const lc = transN(float(9000), dot(upc, U.sunTrue)).mul(U.cloudSun).mul(step(-0.12, U.sunTrue.y));
        const cosT = dot(d, U.sunTrue);
        const Lc = lc.mul(HG(cosT, 0.7).mul(FOURPI).mul(0.55).add(0.35)).add(vec3(U.skyAmb).mul(0.45));
        // thin ice: mostly transparent, adds its own scattered light (no dark streaks at night)
        out.assign(vec4(sky.mul(float(1).sub(cd.mul(0.35))).add(Lc.mul(cd)), 1));
      });
      If(t0.lessThan(90000).and(U.cover.greaterThan(0.005)), () => {
        const dt = t1.sub(t0).div(steps);
        const ign = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
        // key light: the sun while it still reaches the cloud deck, otherwise the moon
        const isSun = step(-0.045, U.sunTrue.y);
        const ld = normalize(mix(U.moonDir, U.sunTrue, isSun));
        const pe = vec3(d.x.mul(t0), d.y.mul(t0).add(R + CAM), d.z.mul(t0));
        const hMid = U.cloudBase.add(U.cloudThick.mul(0.35));
        const lightC = transN(hMid, dot(normalize(pe), ld)).mul(U.cloudSun).mul(mix(U.moonE.div(max(U.skyE, 1e-3)).mul(1.4), float(1), isSun));
        const cosT = dot(d, ld);
        const phase1 = mix(HG(cosT, 0.8), HG(cosT, -0.2), 0.25).mul(FOURPI).add(HG(cosT, 0.97).mul(FOURPI * 0.08));
        const phase2 = mix(HG(cosT, 0.35).mul(FOURPI), float(1), 0.5);
        const dens0 = U.cloudDens.mul(0.08);
        // adaptive march: coarse steps through clear air; on a hit, back up and take fine steps (with the
        // detail noise and lighting) until the ray has been in clear air for a while again
        const dtF = dt.mul(0.3);
        const tc = t0.add(ign.mul(dt)).toVar(), fine = float(0).toVar(), empty = float(0).toVar();
        Loop(steps * 2, () => {
          If(tc.greaterThan(t1), () => { Break(); });
          const p = cameraPosition.add(d.mul(tc));
          const h = sqrt(tc.mul(tc).add(tc.mul(mu).mul(2 * (R + CAM))).add((R + CAM) ** 2)).sub(R + CAM);
          If(fine.lessThan(0.5), () => {
            If(cloudDensity(p, h, tc, false).greaterThan(0.001), () => { fine.assign(1); empty.assign(0); tc.subAssign(dt.mul(0.75)); })
              .Else(() => { tc.addAssign(dt); });
          }).Else(() => {
            const dn = cloudDensity(p, h, tc, true);
            If(dn.greaterThan(0.002), () => {
              empty.assign(0);
              // light: optical depth towards the key light, coarse to fine
              let od = float(0);
              const seg = [[40, 60], [120, 110], [260, 190], [520, 330], [980, 600]].slice(0, lightSteps);
              for (const [s0, w] of seg) od = od.add(cloudDensity(p.add(ld.mul(s0)), h.add(ld.y.mul(s0)), tc.add(s0), false).mul(w));
              od = od.mul(dens0);
              // single scattering (forward-peaked, with a silver-lining spike) plus a broad, slowly
              // attenuated multiple-scattering lobe that keeps sunlit faces bright white
              // thick decks pass sunlight by diffusion (~1 / optical depth), not exponentially
              const beer = exp(od.negate()), msT = mix(exp(od.mul(-0.24)), float(1).div(od.mul(0.11).add(1)), U.cover.mul(U.cover));
              const direct = lightC.mul(beer.mul(phase1).add(msT.mul(phase2).mul(0.85)));
              const hf = h.sub(U.cloudBase).div(U.cloudThick);
              const ambC = mix(vec3(U.groundAmb), vec3(U.skyAmb), smoothstep(-0.1, 1.0, hf)).mul(mix(float(1), hf.mul(0.7).add(0.3), U.cover.mul(U.cover)));
              const amb = mix(vec3(dot(ambC, vec3(0.2126, 0.7152, 0.0722))), ambC, 0.6);   // multiple scattering whitens the sky light
              const S = direct.add(amb).mul(float(1).sub(U.cloudDark.mul(0.55)));
              const sig = dn.mul(dens0);
              const a = float(1).sub(exp(sig.mul(dtF).negate()));
              L.addAssign(S.mul(a).mul(T));
              wt.addAssign(T.mul(a)); wd.addAssign(T.mul(a).mul(tc));
              T.mulAssign(float(1).sub(a));
            }).Else(() => {
              empty.addAssign(1);
              If(empty.greaterThan(5), () => { fine.assign(0); });
            });
            tc.addAssign(dtF);
          });
          If(T.lessThan(0.012), () => { Break(); });
        });
        // aerial perspective: distant cloud fades into the sky colour
        const dist = wd.div(max(wt, 1e-4));
        const fade = exp(dist.mul(U.haze.mul(1.5e-5).add(U.fogDensity.mul(0.04))).negate());   // visibility, not the street fog
        const Lf = L.mul(fade).add(sky.mul(float(1).sub(T)).mul(float(1).sub(fade)));
        out.assign(vec4(out.rgb.mul(T).add(Lf), T));
      });
      // the scene fog meets the sky at the horizon (no seam where the terrain ends)
      const fogH = float(1).sub(exp(U.fogDensity.mul(2600).pow(2).negate())).mul(exp(max(mu, 0).mul(-22)));
      out.assign(vec4(mix(out.rgb, vec3(U.fogCol), fogH), out.a));
    }).Else(() => {
      out.assign(vec4(mix(vec3(U.fogCol).mul(0.85), vec3(U.fogCol), smoothstep(-0.25, 0.0, mu)), 0));
    });
    // per-pixel sky (?skybake=0): the sun, moon and stars go straight on top (derivatives: outside branches)
    if (opts.celestial) return vec4(out.rgb.add(celestial(d, out.a)), 1);
    return out;
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ------------------------------------------------------------------ sun, moon and stars
// moon maria in disc coordinates (x right/east-limb, y up/north, as seen from Britain): centre, radius, depth
const MARIA = [
  [-0.62, 0.24, 0.40, 0.42], [-0.52, -0.02, 0.28, 0.38], [-0.27, 0.53, 0.30, 0.5], [0.25, 0.45, 0.19, 0.5], [0.45, 0.13, 0.23, 0.48],
  [0.80, 0.29, 0.13, 0.55], [0.68, -0.14, 0.19, 0.44], [0.50, -0.27, 0.11, 0.42], [-0.24, -0.36, 0.20, 0.38], [-0.57, -0.41, 0.11, 0.44],
  [-0.25, 0.83, 0.11, 0.35], [0.18, 0.84, 0.10, 0.32], [0.06, 0.23, 0.09, 0.36], [-0.37, -0.17, 0.12, 0.3],
];
const moonAlbedo = (x, y) => {
  let a = float(1);
  for (const [mx, my, r, k] of MARIA) a = a.sub(smoothstep(r, r * 0.55, length(vec2(x.sub(mx), y.sub(my)))).mul(k));
  // bright young craters: Tycho (with a halo of rays), Copernicus, Kepler, Aristarchus
  const spot = (cx, cy, r, k) => smoothstep(r, 0, length(vec2(x.sub(cx), y.sub(cy)))).mul(k);
  a = a.add(spot(-0.15, -0.68, 0.06, 0.5)).add(spot(-0.15, -0.68, 0.3, 0.12)).add(spot(-0.33, 0.16, 0.04, 0.35)).add(spot(-0.6, 0.13, 0.03, 0.3)).add(spot(-0.66, 0.38, 0.025, 0.45));
  const grain = sin(x.mul(53).add(y.mul(37))).mul(sin(y.mul(61).sub(x.mul(23)))).mul(0.04);
  return clamp(a.add(grain), 0.32, 1.3);
};
const SUN_R = 0.00465, SUN_DISC = 2.4, MOON_DISC = 0.055, STAR_K = 0.55;
// faces of the star cube (equatorial frame): direction for face f and face coords (u, v)
const faceDir = (f, u, v) => {
  const a = vec3(1, v, u.negate()), b = vec3(-1, v, u), c = vec3(u, 1, v.negate()), e = vec3(u, -1, v), g = vec3(u, v, 1), h = vec3(u.negate(), v, -1);
  return normalize(mix(mix(mix(a, b, step(0.5, f)), mix(c, e, step(2.5, f)), step(1.5, f)), mix(g, h, step(4.5, f)), step(3.5, f)));
};
export const celestial = (d, T) => {
  const px = length(fwidth(d)).max(1e-5);           // radians per pixel
  // ---- sun: limb-darkened disc, reddened and dimmed by the air in front of it
  const cs = length(d.sub(U.sunTrue)).div(SUN_R);
  const muL = sqrt(max(float(1).sub(cs.mul(cs)), 0));
  const limb = float(1).sub(float(1).sub(muL).mul(0.62)).sub(float(1).sub(muL).pow(2).mul(0.12));
  const sun = vec3(U.sunTrans).mul(U.skyE).mul(SUN_DISC).mul(limb).mul(smoothstep(px.div(SUN_R).add(1), float(1).sub(px.div(SUN_R)), cs));
  const col = sun.toVar();
  // ---- moon: Lommel-Seeliger shading of the real phase, maria, earthshine on the dark limb
  const mr = U.moonRadius, md = d.sub(U.moonDir), ml = length(md).div(mr);
  If(ml.lessThan(1.5), () => {
    const m = U.moonDir;
    const upv = normalize(U.celNorth.sub(m.mul(dot(U.celNorth, m))));
    const rt = cross(m, upv);
    const x = dot(md, rt).div(mr), y = dot(md, upv).div(mr);
    const z = sqrt(max(float(1).sub(x.mul(x)).sub(y.mul(y)), 0));
    const n = rt.mul(x).add(upv.mul(y)).sub(m.mul(z));
    const mu0 = dot(n, U.sunTrue);
    const ls = max(mu0, 0).div(max(mu0, 0).add(z).add(1e-3)).mul(2);
    const earth = float(0.012).mul(float(1).sub(U.moonLit)).mul(float(1).sub(U.moonLit));
    const disc = smoothstep(px.div(mr).add(1), float(1).sub(px.div(mr)), ml);
    const tr = transN(float(CAM), U.moonDir.y.max(-0.05));
    col.addAssign(tr.mul(U.skyE).mul(MOON_DISC).mul(moonAlbedo(x, y)).mul(ls.add(earth)).mul(disc));
  });
  // ---- stars from the cell texture (equatorial frame, cube faces stacked vertically)
  If(U.starVis.greaterThan(0.002), () => {
    const e = U.starRot.mul(d);
    const ax = abs(e.x), ay = abs(e.y), az = abs(e.z);
    const isX = step(ay, ax).mul(step(az, ax)), isY = float(1).sub(isX).mul(step(az, ay)), isZ = float(1).sub(isX).sub(isY);
    const f = isX.mul(step(e.x, 0)).add(isY.mul(step(e.y, 0).add(2))).add(isZ.mul(step(e.z, 0).add(4)));
    const sgx = mix(float(1), float(-1), step(e.x, 0)), sgy = mix(float(1), float(-1), step(e.y, 0)), sgz = mix(float(1), float(-1), step(e.z, 0));
    const u = isX.mul(e.z.negate().mul(sgx).div(max(ax, 1e-4))).add(isY.mul(e.x.div(max(ay, 1e-4)))).add(isZ.mul(e.x.mul(sgz).div(max(az, 1e-4))));
    const v = isX.mul(e.y.div(max(ax, 1e-4))).add(isY.mul(e.z.negate().mul(sgy).div(max(ay, 1e-4)))).add(isZ.mul(e.y.div(max(az, 1e-4))));
    const cu = clamp(u.mul(0.5).add(0.5).mul(STAR_G), 0, STAR_G - 0.001), cv = clamp(v.mul(0.5).add(0.5).mul(STAR_G), 0, STAR_G - 0.001);
    const iu = floor(cu), iv = floor(cv);
    const cell = texture(starTex, vec2(iu.add(0.5).div(STAR_G), f.mul(STAR_G).add(iv).add(0.5).div(STAR_G * 6))).level(0);
    const s = faceDir(f, iu.add(cell.r).div(STAR_G).mul(2).sub(1), iv.add(cell.g).div(STAR_G).mul(2).sub(1));
    const dd = length(e.sub(s));
    const sig = px.mul(0.62);
    const mag = float(6.5).sub(cell.b.mul(8));
    const flux = pow(float(10), mag.mul(-0.4)).mul(STAR_K).mul(smoothstep(5.1, 3.9, mag)).mul(step(0.004, cell.b));
    const hsh = fract(sin(iu.mul(12.9898).add(iv.mul(78.233)).add(f.mul(37.719))).mul(43758.5453));
    const scint = smoothstep(0.6, 0.0, d.y).mul(0.55).add(0.12);
    const tw = float(1).add(sin(U.t.mul(hsh.mul(9).add(6)).add(hsh.mul(40))).mul(sin(U.t.mul(hsh.mul(5).add(3.1)).add(hsh.mul(17)))).mul(scint));
    const bv = cell.a.mul(2.4).sub(0.4);
    const tint = mix(mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.97, 0.92), smoothstep(-0.3, 0.55, bv)), vec3(1.0, 0.7, 0.45), smoothstep(0.55, 1.9, bv));
    const ext = exp(float(0.28).div(max(d.y, 0.035)).negate());
    const psf = exp(dd.mul(dd).div(sig.mul(sig).mul(-2)));
    col.addAssign(tint.mul(flux.mul(psf).mul(tw).mul(ext).mul(U.starVis)));
  });
  return col.mul(T).mul(smoothstep(-0.004, 0.004, d.y));
};

// background: the baked cube (sky + clouds) plus the per-pixel celestial layer
export function backgroundNode(cube) {
  return Fn(() => {
    const d = normalize(positionLocal);
    const c = cubeTexture(cube, d);
    return vec4(c.rgb.add(celestial(d, c.a)), 1);
  })();
}
