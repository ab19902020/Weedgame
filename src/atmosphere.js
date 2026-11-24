// Physically based daylight: Rayleigh + Mie scattering with ozone absorption in a curved,
// exponentially thinning atmosphere. Optical depth towards the sun is closed form (an accurate Chapman
// approximation), multiple scattering comes from a small lookup table (Hillaire 2020) built once at
// start-up, so the twilight sky is deep blue rather than black. The same model runs here on the CPU (light
// colours, sky and fog uniforms) and in TSL inside the sky bake (sky.js), so the street lighting, the fog
// and the sky agree: blue zenith, pale horizon, an orange-red sun on the horizon, the Earth's shadow and
// the Belt of Venus at twilight, and a deep blue sky through the short June nights.
import * as THREE from 'three/webgpu';

export const ATM = {
  R: 6360e3, top: 6420e3, HR: 8000, HM: 1200,
  bR: [5.802e-6, 13.558e-6, 33.1e-6],      // Rayleigh scattering (1/m)
  bM: 3.996e-6,                             // Mie scattering at haze 1 (1/m); extinction = scattering / 0.9
  bO: [0.650e-6, 1.881e-6, 0.085e-6],       // ozone absorption (1/m), 15 km equivalent column centred at 25 km
  g: 0.78,
};
export const XR = ATM.R / ATM.HR, XM = ATM.R / ATM.HM;

// exp(-h) * Ch(X + h, zenith angle): column density (in scale heights) from altitude h (scale heights)
// to space along a ray with cos(zenith) mu, relative to the vertical column from the ground.
// Ch(x, chi) = sqrt(pi x / 2) erfcx(sqrt(x / 2) cos chi) for chi <= 90 degrees, with erfcx from a blended
// Komatu bound; below the horizontal, the tangent-point identity. Within 0.6% of numerical integration
// for scale heights of 1.2-8 km, altitudes 0-3 km and every direction that does not meet the ground.
export const erfcx = y => { const w = y / (y + 1), c = 1.2732395 * (1 - w) + 2 * w; return 1.1283792 / (y + Math.sqrt(y * y + c)); };
export function chapman(X, h, mu) {
  const x = X + h, a = Math.sqrt(1.5707963 * x), b = Math.sqrt(x / 2);
  if (mu >= 0) return Math.exp(-h) * a * erfcx(b * mu);
  const x0 = x * Math.sqrt(Math.max(0, 1 - mu * mu));
  return 2 * Math.sqrt(1.5707963 * x0) * Math.exp(Math.min(X - x0, 60)) - Math.exp(-h) * a * erfcx(-b * mu);
}
// slant factor through the ozone shell at 25 km, from altitude h
export const ozoneSlant = (h, mu) => { const k = (ATM.R + h) / (ATM.R + 25000); return 1 / Math.sqrt(Math.max(1e-4, 1 - k * k * (1 - mu * mu))); };
// transmittance from altitude h (m) to space along cos(zenith) mu, for haze t (Mie multiplier)
export function transmittance(h, mu, t = 1, out = [0, 0, 0]) {
  const cr = ATM.HR * chapman(XR, h / ATM.HR, mu), cm = ATM.HM * chapman(XM, h / ATM.HM, mu) * t / 0.9, co = 15000 * ozoneSlant(h, mu);
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-(ATM.bR[i] * cr + ATM.bM * cm + ATM.bO[i] * co));
  return out;
}
export const PR = c => 3 / (16 * Math.PI) * (1 + c * c);
export const PM = (c, g = ATM.g) => 3 / (8 * Math.PI) * (1 - g * g) * (1 + c * c) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * c, 1.5));
const densR = h => Math.exp(-h / ATM.HR), densM = h => Math.exp(-h / ATM.HM), densO = h => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

// ------------------------------------------------------------------ multiple scattering (Hillaire 2020)
// Psi_ms(altitude, cos sun zenith): isotropic multiple-scattering source per unit scattering coefficient,
// for unit sun irradiance. 24 (sun angle) x 12 (altitude, square-root spaced) texels, ground albedo 0.2.
export const MS_W = 24, MS_H = 12, MS_SCALE = 1000;
export function buildMultipleScattering(t = 1) {
  const out = new Float32Array(MS_W * MS_H * 4), R = ATM.R, top = ATM.top;
  const dirs = []; const n = 32;   // golden-spiral sphere
  for (let i = 0; i < n; i++) { const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996323; dirs.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  const ts = [0, 0, 0];
  for (let j = 0; j < MS_H; j++) for (let i = 0; i < MS_W; i++) {
    const h = Math.max(10, ((j + 0.5) / MS_H) ** 2 * (top - R)), muS = (i + 0.5) / MS_W * 2 - 1;
    const sun = [Math.sqrt(1 - muS * muS), muS, 0], r0 = R + h;
    const L2 = [0, 0, 0], F = [0, 0, 0];
    for (const d of dirs) {
      const mu = d[1], disc = r0 * r0 * (mu * mu - 1) + R * R;
      const ground = mu < 0 && disc > 0;
      const tMax = ground ? -r0 * mu - Math.sqrt(disc) : -r0 * mu + Math.sqrt(r0 * r0 * (mu * mu - 1) + top * top);
      const N = 12, dt = tMax / N; const tau = [0, 0, 0];
      for (let s = 0; s < N; s++) {
        const tt = (s + 0.5) * dt, px = d[0] * tt, py = r0 + d[1] * tt, pz = d[2] * tt, rr = Math.hypot(px, py, pz), hh = Math.max(0, rr - R);
        const rR = densR(hh), rM = densM(hh), rO = densO(hh);
        const muSs = (px * sun[0] + py * sun[1] + pz * sun[2]) / rr;
        transmittance(hh, muSs, t, ts);
        for (let k = 0; k < 3; k++) {
          const ext = ATM.bR[k] * rR + ATM.bM * t / 0.9 * rM + ATM.bO[k] * rO, sca = ATM.bR[k] * rR + ATM.bM * t * rM;
          const T = Math.exp(-tau[k] - ext * dt * 0.5);
          L2[k] += T * sca * ts[k] / (4 * Math.PI) * dt;
          F[k] += T * sca * dt;
          tau[k] += ext * dt;
        }
      }
      if (ground) {
        const gx = d[0] * tMax, gy = r0 + d[1] * tMax, gz = d[2] * tMax, gl = Math.hypot(gx, gy, gz);
        const muG = (gx * sun[0] + gy * sun[1] + gz * sun[2]) / gl;
        transmittance(0, muG, t, ts);
        for (let k = 0; k < 3; k++) L2[k] += Math.exp(-tau[k]) * ts[k] * Math.max(0, muG) * 0.2 / Math.PI;
      }
    }
    const o = (j * MS_W + i) * 4;
    for (let k = 0; k < 3; k++) { const l2 = L2[k] / n * 4 * Math.PI / (4 * Math.PI), f = F[k] / n; out[o + k] = l2 / (1 - Math.min(0.95, f)); }
    out[o + 3] = 1;
  }
  return out;
}
let MS = null;
export function msLookup(h, muS, out) {
  MS ||= buildMultipleScattering();
  const u = Math.max(0, Math.min(MS_W - 1.001, (muS * 0.5 + 0.5) * MS_W - 0.5)), v = Math.max(0, Math.min(MS_H - 1.001, Math.sqrt(Math.max(0, h) / (ATM.top - ATM.R)) * MS_H - 0.5));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  for (let k = 0; k < 3; k++) {
    const a = MS[(j * MS_W + i) * 4 + k], b = MS[(j * MS_W + i + 1) * 4 + k], c = MS[((j + 1) * MS_W + i) * 4 + k], d = MS[((j + 1) * MS_W + i + 1) * 4 + k];
    out[k] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
  return out;
}
// half-float (filterable on every GPU), scaled by MS_SCALE to stay clear of half-float underflow
export function msTexture() {
  MS ||= buildMultipleScattering();
  const half = new Uint16Array(MS.length);
  for (let i = 0; i < MS.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, MS[i] * MS_SCALE));
  const tex = new THREE.DataTexture(half, MS_W, MS_H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

// in-scattered radiance (sky units) from the camera at altitude h0 along direction d (unit, y up) for a
// light from direction l with irradiance E. Returns rgb.
export function inscatter(d, l, E, h0 = 80, t = 1, N = 16, out = [0, 0, 0]) {
  const R = ATM.R, r0 = R + h0, mu = Math.max(d[1], -0.02);
  const tTop = -r0 * mu + Math.sqrt(r0 * r0 * mu * mu - r0 * r0 + ATM.top * ATM.top);
  const cosT = d[0] * l[0] + d[1] * l[1] + d[2] * l[2], pr = PR(cosT), pm = PM(cosT);
  const sR = [0, 0, 0], sM = [0, 0, 0], sMS = [0, 0, 0], tv = [0, 0, 0], ts = [0, 0, 0], ms = [0, 0, 0];
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, tt = tTop * u * u, ds = tTop * (((i + 1) / N) ** 2 - (i / N) ** 2);
    const px = d[0] * tt, py = r0 + d[1] * tt, pz = d[2] * tt, r = Math.hypot(px, py, pz), h = r - R;
    if (h < 0) break;
    const rR = densR(h), rM = densM(h), rO = densO(h);
    const dsm = tt - prev; prev = tt;
    for (let k = 0; k < 3; k++) tv[k] += (ATM.bR[k] * rR + ATM.bM * t / 0.9 * rM + ATM.bO[k] * rO) * dsm;
    const muS = (px * l[0] + py * l[1] + pz * l[2]) / r;
    transmittance(h, muS, t, ts); msLookup(h, muS, ms);
    for (let k = 0; k < 3; k++) {
      const T = Math.exp(-tv[k]) * ds;
      sR[k] += T * ts[k] * rR; sM[k] += T * ts[k] * rM; sMS[k] += T * ms[k] * (ATM.bR[k] * rR + ATM.bM * t * rM);
    }
  }
  for (let k = 0; k < 3; k++) out[k] = E * (sR[k] * ATM.bR[k] * pr + sM[k] * ATM.bM * t * pm + sMS[k]);
  return out;
}
