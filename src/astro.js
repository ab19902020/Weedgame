// Sky geometry for Reading (51.45 N, 0.95 W) from the game clock: the moon's position, distance and
// phase, sidereal time and the rotation that carries the star sphere, plus a catalogue of the bright
// stars so the constellations are the real ones (the Plough, Cassiopeia, Orion, the Summer Triangle).
// World axes: +x east, +y up, -z north (the same convention as the sun in weather.js).
export const LAT = 51.45, LON = -0.95;
const D2R = Math.PI / 180;

export const julian = ms => ms / 86400000 + 2440587.5;
// Greenwich mean sidereal time, degrees
export function gmst(jd) {
  const d = jd - 2451545.0, T = d / 36525;
  return (((280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000) % 360) + 360) % 360;
}
// Equatorial -> world rotation (3x3, column-major like THREE.Matrix3.elements). Columns are the world
// images of the equatorial x (vernal equinox), y (RA 6h) and z (north celestial pole) axes.
export function starRotation(ms, out = new Float32Array(9)) {
  const L = (gmst(julian(ms)) + LON) * D2R, f = LAT * D2R;
  const cL = Math.cos(L), sL = Math.sin(L), sf = Math.sin(f), cf = Math.cos(f);
  const m = [0, cf, sf], w = [-1, 0, 0], p = [0, sf, -cf];
  for (let i = 0; i < 3; i++) { out[i] = cL * m[i] + sL * w[i]; out[3 + i] = sL * m[i] - cL * w[i]; out[6 + i] = p[i]; }
  return out;
}
export const applyRot = (M, x, y, z, out = [0, 0, 0]) => {
  out[0] = M[0] * x + M[3] * y + M[6] * z; out[1] = M[1] * x + M[4] * y + M[7] * z; out[2] = M[2] * x + M[5] * y + M[8] * z;
  return out;
};
const eqVec = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];

// Moon: low-precision series (Astronomical Almanac), good to about 0.3 degrees, with topocentric
// parallax (the moon sits up to a degree lower than its geocentric place). Returns the world
// direction, distance (Earth radii), apparent radius (radians) and illuminated fraction.
export function moonPosition(ms, M = starRotation(ms)) {
  const T = (julian(ms) - 2451545.0) / 36525, s = x => Math.sin(x * D2R), c = x => Math.cos(x * D2R);
  const lam = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
    + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
  const eps = 23.439 * D2R, l = c(bet) * c(lam), m = c(bet) * s(lam), n = s(bet);
  const x = l, y = Math.cos(eps) * m - Math.sin(eps) * n, z = Math.sin(eps) * m + Math.cos(eps) * n;
  const dir = applyRot(M, x, y, z);
  // topocentric: the observer is one Earth radius above the centre
  const dist = 1 / Math.sin(par * D2R);
  dir[0] *= dist; dir[1] = dir[1] * dist - 1; dir[2] *= dist;
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  return { dir: [dir[0] / len, dir[1] / len, dir[2] / len], dist: len, radius: 0.2725 / len, eclLon: lam };
}

// The sun's ecliptic longitude (degrees), for the moon's phase angle
export function sunEclLon(ms) {
  const d = julian(ms) - 2451545.0, g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  return q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
}
// Fraction of the disc that is lit (0 new .. 1 full) and whether it is waxing
export function moonPhase(ms) {
  const e = ((moonPosition(ms).eclLon - sunEclLon(ms)) % 360 + 360) % 360;
  return { fraction: (1 - Math.cos(e * D2R)) / 2, waxing: e < 180, elongation: e };
}

// Bright stars (J2000): RA hours, minutes; Dec degrees, minutes; V magnitude; B-V colour index.
// Enough of them for every constellation a Reading street sees on a clear night.
const BRIGHT = [
  [6, 45.1, -16, 43, -1.46, 0.0], [14, 15.7, 19, 11, -0.05, 1.23], [18, 36.9, 38, 47, 0.03, 0.0], [5, 16.7, 46, 0, 0.08, 0.8], [5, 14.5, -8, 12, 0.13, -0.03],
  [7, 39.3, 5, 13, 0.34, 0.42], [5, 55.2, 7, 24, 0.5, 1.85], [19, 50.8, 8, 52, 0.76, 0.22], [4, 35.9, 16, 31, 0.86, 1.54], [13, 25.2, -11, 10, 0.97, -0.23],
  [16, 29.4, -26, 26, 0.96, 1.83], [7, 45.3, 28, 2, 1.14, 1.0], [22, 57.6, -29, 37, 1.16, 0.09], [20, 41.4, 45, 17, 1.25, 0.09], [10, 8.4, 11, 58, 1.35, -0.11],
  [6, 58.6, -28, 58, 1.5, -0.21], [7, 34.6, 31, 53, 1.58, 0.03], [17, 33.6, -37, 6, 1.62, -0.22], [5, 25.1, 6, 21, 1.64, -0.22], [5, 26.3, 28, 36, 1.65, -0.13],
  [5, 36.2, -1, 12, 1.69, -0.18], [5, 40.8, -1, 57, 1.77, -0.21], [12, 54.0, 55, 58, 1.77, -0.02], [11, 3.7, 61, 45, 1.79, 1.07], [3, 24.3, 49, 52, 1.79, 0.48],
  [7, 8.4, -26, 24, 1.83, 0.68], [18, 24.2, -34, 23, 1.85, -0.03], [13, 47.5, 49, 19, 1.86, -0.19], [5, 59.5, 44, 57, 1.9, 0.08], [6, 37.7, 16, 24, 1.93, 0.0],
  [2, 31.8, 89, 16, 1.98, 0.6], [6, 22.7, -17, 57, 1.98, -0.23], [9, 27.6, -8, 40, 1.98, 1.44], [2, 7.2, 23, 28, 2.0, 1.15], [0, 43.6, -17, 59, 2.04, 1.02],
  [18, 55.3, -26, 18, 2.05, -0.13], [0, 8.4, 29, 5, 2.06, -0.11], [1, 9.7, 35, 37, 2.06, 1.58], [5, 47.8, -9, 40, 2.07, -0.17], [14, 50.7, 74, 9, 2.08, 1.47],
  [17, 34.9, 12, 34, 2.08, 0.15], [3, 8.2, 40, 57, 2.09, -0.05], [2, 3.9, 42, 20, 2.1, 1.37], [11, 49.1, 14, 34, 2.14, 0.09], [0, 56.7, 60, 43, 2.15, -0.15],
  [10, 20.0, 19, 51, 2.08, 1.15], [5, 32.0, 0, -18, 2.23, -0.22], [20, 22.2, 40, 15, 2.23, 0.67], [0, 40.5, 56, 32, 2.24, 1.17], [17, 56.6, 51, 29, 2.24, 1.52],
  [15, 34.7, 26, 43, 2.23, -0.02], [13, 23.9, 54, 56, 2.23, 0.02], [0, 9.2, 59, 9, 2.28, 0.34], [16, 0.3, -22, 37, 2.29, -0.12], [11, 1.8, 56, 23, 2.37, -0.02],
  [14, 45.0, 27, 4, 2.37, 0.97], [21, 44.2, 9, 53, 2.38, 1.52], [23, 3.8, 28, 5, 2.42, 1.67], [17, 10.4, -15, 44, 2.43, 0.06], [11, 53.8, 53, 42, 2.44, 0.0],
  [21, 18.6, 62, 35, 2.45, 0.22], [23, 4.8, 15, 12, 2.49, -0.04], [20, 46.2, 33, 58, 2.48, 1.03], [3, 2.3, 4, 5, 2.54, 1.64], [11, 14.1, 20, 31, 2.56, 0.12],
  [5, 32.7, -17, 49, 2.58, 0.21], [15, 17.0, -9, 23, 2.61, -0.11], [15, 44.3, 6, 25, 2.63, 1.17], [1, 54.6, 20, 48, 2.64, 0.13], [1, 25.8, 60, 14, 2.68, 0.13],
  [13, 54.7, 18, 24, 2.68, 0.58], [14, 50.9, -16, 2, 2.75, 0.15], [16, 30.2, 21, 29, 2.78, 0.94], [17, 14.6, 14, 23, 2.78, 1.16], [19, 46.3, 10, 37, 2.72, 1.52],
  [13, 2.2, 10, 58, 2.83, 0.94], [0, 13.2, 15, 11, 2.83, -0.23], [19, 30.7, 27, 58, 3.05, 1.13], [3, 47.5, 24, 6, 2.87, -0.09], [3, 49.2, 24, 3, 3.62, -0.08],
  [3, 44.9, 24, 7, 3.7, -0.11], [3, 45.8, 24, 22, 3.87, -0.07], [3, 46.3, 23, 57, 4.18, -0.06], [3, 45.2, 24, 28, 4.3, -0.11], [12, 15.4, 57, 2, 3.31, 0.08],
  [1, 54.4, 63, 40, 3.37, -0.15], [11, 14.2, 15, 26, 3.33, -0.01], [6, 43.9, 25, 8, 3.06, 1.4], [6, 22.9, 22, 31, 2.88, 1.64], [7, 20.1, 21, 59, 3.53, 0.34],
  [4, 28.6, 19, 11, 3.53, 1.01], [4, 28.7, 15, 52, 3.4, 0.18], [4, 19.8, 15, 38, 3.65, 0.99], [4, 22.9, 17, 33, 3.76, 0.98], [5, 37.6, 21, 9, 3.0, -0.19],
  [5, 35.1, 9, 56, 3.39, -0.16], [5, 35.4, -5, 55, 2.77, -0.24], [19, 45.0, 45, 8, 2.87, -0.03], [18, 50.1, 33, 22, 3.52, 0.0], [18, 58.9, 32, 41, 3.25, -0.05],
  [19, 55.3, 6, 24, 3.71, 0.86], [15, 20.7, 71, 50, 3.0, 0.05], [23, 39.3, 77, 38, 3.21, 1.03], [21, 28.7, 70, 34, 3.23, -0.22], [17, 30.4, 52, 18, 2.79, 0.98],
  [14, 4.4, 64, 23, 3.65, -0.05], [19, 12.6, 67, 40, 3.07, 0.99], [17, 8.8, 65, 43, 3.17, -0.12], [3, 42.9, 47, 47, 3.01, -0.13], [3, 57.9, 40, 1, 2.89, -0.18],
  [3, 54.1, 31, 53, 2.85, 0.12], [3, 4.8, 53, 30, 2.93, 0.7], [5, 59.7, 37, 13, 2.62, -0.08], [4, 57.0, 33, 10, 2.69, 1.53], [5, 2.0, 43, 49, 2.99, 0.54],
  [14, 32.1, 38, 18, 3.04, 0.19], [15, 1.9, 40, 23, 3.49, 0.97], [16, 41.3, 31, 36, 2.81, 0.65], [17, 15.0, 36, 49, 3.16, 1.44], [16, 42.9, 38, 55, 3.53, 0.92],
  [17, 0.3, 30, 56, 3.92, -0.01], [22, 41.5, 10, 50, 3.4, -0.09], [22, 43.0, 30, 13, 2.94, 0.86], [0, 39.3, 30, 52, 3.27, 1.28], [9, 45.9, 23, 46, 2.98, 0.8],
  [10, 16.7, 23, 25, 3.43, 0.31], [9, 52.8, 26, 0, 3.88, 1.22], [10, 7.3, 16, 46, 3.52, -0.03], [12, 41.7, -1, 27, 2.74, 0.36], [12, 15.8, -17, 33, 2.59, -0.11],
  [12, 34.4, -23, 24, 2.65, 0.89], [12, 29.9, -16, 31, 2.95, -0.05], [16, 5.4, -19, 48, 2.62, -0.07], [18, 21.0, -29, 50, 2.7, 1.38], [18, 28.0, -25, 25, 2.81, 1.02],
  [19, 2.6, -29, 53, 2.6, 0.08], [7, 24.1, -29, 18, 2.45, -0.08], [6, 14.9, 22, 30, 3.31, 1.6], [6, 45.3, 12, 54, 3.36, 0.44], [8, 59.2, 48, 2, 3.14, 0.19],
  [10, 22.3, 41, 30, 3.06, 1.6], [8, 30.3, 60, 43, 3.35, 0.85], [5, 28.2, -20, 46, 2.84, 0.81], [5, 7.9, -5, 5, 2.79, 0.13], [16, 14.3, -3, 42, 2.73, 1.58],
  [17, 43.5, 4, 34, 2.76, 1.16], [21, 47.0, -16, 8, 2.85, 0.29], [21, 31.6, -5, 34, 2.87, 0.83], [22, 5.8, 0, -19, 2.95, 0.98], [11, 9.7, 44, 30, 3.0, 1.14],
  [12, 55.6, 3, 24, 3.38, 1.58], [13, 34.7, 0, -36, 3.37, 0.11],
];
// Star sphere on a cube-face cell grid (equatorial frame): each cell holds at most one star as
// (offset u, offset v, brightness, colour). The catalogue fills its cells exactly; the rest of the sky gets
// randomly placed fainter stars with the real count-magnitude slope, cut off at the light-polluted
// suburban limit (about magnitude 4.6). Faces are stacked vertically: texture is G x 6G, RGBA8.
export const STAR_G = 256;
export function starCells(G = STAR_G) {
  const data = new Uint8Array(G * G * 6 * 4);
  const put = (v, mag, bv, exact) => {
    const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
    let f, u, w;   // face index, face coords in [-1, 1]
    if (ax >= ay && ax >= az) { f = v[0] > 0 ? 0 : 1; u = (v[0] > 0 ? -v[2] : v[2]) / ax; w = v[1] / ax; }
    else if (ay >= az) { f = v[1] > 0 ? 2 : 3; u = v[0] / ay; w = (v[1] > 0 ? -v[2] : v[2]) / ay; }
    else { f = v[2] > 0 ? 4 : 5; u = (v[2] > 0 ? v[0] : -v[0]) / az; w = v[1] / az; }
    const cu = (u * 0.5 + 0.5) * G, cv = (w * 0.5 + 0.5) * G;
    const iu = Math.min(G - 1, Math.floor(cu)), iv = Math.min(G - 1, Math.floor(cv));
    let ou = cu - iu, ov = cv - iv;
    if (!exact) { ou = 0.22 + ou * 0.56; ov = 0.22 + ov * 0.56; }
    const k = ((f * G + iv) * G + iu) * 4;
    const b = Math.max(0, Math.min(255, Math.round((6.5 - mag) / 8 * 255)));   // mag -1.5 .. 6.5
    if (data[k + 2] >= b && data[k + 2] > 0) return;
    data[k] = Math.round(ou * 255); data[k + 1] = Math.round(ov * 255); data[k + 2] = b;
    data[k + 3] = Math.max(0, Math.min(255, Math.round((bv + 0.4) / 2.4 * 255)));
  };
  let seed = 917;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // faint field: N(<m) ~ 10^(0.48 m + 0.55) over the whole sky
  for (let i = 0; i < 2600; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const m = Math.log10(Math.pow(10, 0.48 * 3.0 + 0.55) + rnd() * (Math.pow(10, 0.48 * 5.0 + 0.55) - Math.pow(10, 0.48 * 3.0 + 0.55))) / 0.48 - 0.55 / 0.48;
    put([r * Math.cos(a), r * Math.sin(a), z], m, 0.2 + (rnd() - 0.35) * 1.4, false);
  }
  for (const [rh, rm, dd, dm, mag, bv] of BRIGHT) {
    const ra = (rh + rm / 60) * 15 * D2R, dec = (Math.abs(dd) + Math.abs(dm) / 60) * Math.sign(dd || dm || 1) * D2R;
    put(eqVec(ra, dec), mag, bv, true);
  }
  return data;
}
