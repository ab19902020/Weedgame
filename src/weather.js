// One world clock and one weather timeline for the whole map. State is integrated
// (wetness, puddles, cloud drift) and saved, so brother swaps and relaunches stay continuous.
// The sky is physical: the sun follows the NOAA solar position for Reading, the moon its real orbit and
// phase (astro.js), the stars turn with sidereal time, and every light colour (sunlight, sky light,
// fog, the light on the clouds) is read from the same atmosphere model the sky is drawn with.
import * as THREE from 'three/webgpu';
import { U, coverThreshold } from './env.js';
import { starRotation, moonPosition, moonPhase } from './astro.js';
import { transmittance, inscatter } from './atmosphere.js';

// cover: fraction of sky clouded; base/thick: cloud layer (m above the street); type: 0 stratus sheet ..
// 1 heaped cumulus; cirrus: high ice cloud; haze: aerosol (Mie) multiplier; dens: cloud extinction scale
export const STATES = {
  clear: { cover: 0.14, rain: 0, fog: 0.00045, wind: 3, dark: 0, base: 1350, thick: 900, type: 1, cirrus: 0.4, haze: 1.8, dens: 0.8 },
  broken: { cover: 0.47, rain: 0, fog: 0.0006, wind: 5, dark: 0, base: 1100, thick: 1600, type: 0.92, cirrus: 0.2, haze: 2.4, dens: 1 },
  overcast: { cover: 0.94, rain: 0, fog: 0.0009, wind: 6, dark: 0.15, base: 750, thick: 1100, type: 0.35, cirrus: 0, haze: 3.5, dens: 1.1 },
  drizzle: { cover: 0.97, rain: 0.22, fog: 0.0015, wind: 5, dark: 0.35, base: 450, thick: 1300, type: 0.18, cirrus: 0, haze: 5, dens: 1.3 },
  rain: { cover: 1.0, rain: 1.0, fog: 0.0024, wind: 9, dark: 0.85, base: 380, thick: 2600, type: 0.12, cirrus: 0, haze: 6, dens: 1.7 },
  mist: { cover: 0.75, rain: 0, fog: 0.0075, wind: 1, dark: 0.1, base: 300, thick: 520, type: 0.12, cirrus: 0.1, haze: 9, dens: 0.9 },
  clearing: { cover: 0.34, rain: 0, fog: 0.0008, wind: 7, dark: 0, base: 1000, thick: 2300, type: 1, cirrus: 0.28, haze: 1.3, dens: 1 },
};
const NEXT = {
  clear: [['broken', 0.5], ['mist', 0.05], ['clear', 0.45]],
  broken: [['clear', 0.45], ['overcast', 0.35], ['broken', 0.2]],
  overcast: [['drizzle', 0.38], ['broken', 0.45], ['mist', 0.17]],
  drizzle: [['rain', 0.55], ['overcast', 0.45]],
  rain: [['drizzle', 0.5], ['clearing', 0.5]],
  mist: [['overcast', 0.5], ['clear', 0.5]],
  clearing: [['broken', 0.6], ['clear', 0.4]],
};
const BLEND = 25 * 60; // game seconds to blend between states

function rnd(seed) { let s = seed >>> 0 || 1; s = Math.imul(s ^ (s >>> 15), 2246822507); s = Math.imul(s ^ (s >>> 13), 3266489909); return ((s ^ (s >>> 16)) >>> 0) / 4294967296; }

export class World {
  constructor(saved) {
    // The sandbox runs in an English summer (long days, trees in leaf): mid-June, mid-morning
    const now = new Date();
    const start = new Date(now.getFullYear(), 5, 15, 10, 30).getTime() / 1000;
    this.s = Object.assign({
      t: start,            // game time (unix seconds)
      scale: 30,           // game seconds per real second
      seed: (Math.random() * 1e9) | 0,
      seg: { i: 0, start: start, len: 70 * 60, state: 'broken', prev: 'clear' },
      wet: 0, puddle: 0, cloudOff: [0, 0], windDir: 0.6, forced: null, season: 1,
    }, saved || {});
    // saves from before the summer setting: same clock time and weather, moved to mid-June (one-off)
    if (!this.s.season) {
      const d = new Date(this.s.t * 1000), m = new Date(d.getFullYear(), 5, 15, d.getHours(), d.getMinutes(), d.getSeconds()).getTime() / 1000;
      const shift = m - this.s.t; this.s.t += shift; this.s.seg.start += shift; this.s.season = 1;
    }
    this.cur = { ...STATES.broken };
    this.sun = new THREE.Vector3(); this.moon = new THREE.Vector3();
    this.update(0);
  }
  get time() { return this.s.t; }
  hours() { const d = new Date(this.s.t * 1000); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
  stateName() { return this.s.seg.state; }
  // Dev → Weather (and ?weather=): the chosen weather comes in over a few seconds and then stays, however long
  // you play, until Auto hands it back to the timeline. (It used to blend in over 25 game minutes and give way
  // to the timeline after 90, so a clear sky could cloud over and rain again within a few real minutes.)
  force(state) {
    const seg = this.s.seg;
    if (state === 'auto' || !STATES[state]) {
      if (!this.s.forced) return;
      this.s.forced = null; seg.prev = 'custom'; seg.prevMix = this.mix(); seg.start = this.s.t; seg.len = 60 * 60; seg.blend = BLEND / 3; seg.i++;
      return;
    }
    seg.prev = 'custom'; seg.prevMix = this.mix();
    seg.state = state; seg.start = this.s.t; seg.len = 90 * 60; seg.i++;
    seg.blend = 8 * Math.max(1, this.s.scale);
    this.s.forced = state;
    // a dry sky: the falling rain stops at once (the streets still dry off by themselves)
    if (!STATES[state].rain) seg.prevMix.rain = 0;
  }
  setHour(h) { const d = new Date(this.s.t * 1000); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); this.s.t = d.getTime() / 1000; this.s.seg.start = Math.min(this.s.seg.start, this.s.t); }
  mix() {
    const seg = this.s.seg;
    const a = seg.prev === 'custom' ? seg.prevMix || STATES.broken : STATES[seg.prev], b = STATES[seg.state];
    const k = Math.max(0, Math.min(1, (this.s.t - seg.start) / (seg.blend || BLEND)));
    const e = k * k * (3 - 2 * k);
    const out = {};
    for (const key of Object.keys(b)) { const av = a[key] ?? b[key]; out[key] = av + (b[key] - av) * e; }
    return out;
  }
  advanceSegments() {
    const seg = this.s.seg;
    // held by Dev → Weather: the segment just goes on
    if (this.s.forced && STATES[this.s.forced]) { seg.state = this.s.forced; if (this.s.t > seg.start + seg.len) seg.len = this.s.t - seg.start + 3600; return; }
    let guard = 0;
    while (this.s.t > seg.start + seg.len && guard++ < 200) {
      const r = rnd(this.s.seed + seg.i * 7919);
      let acc = 0, next = seg.state;
      for (const [n, p] of NEXT[seg.state]) { acc += p; if (r <= acc) { next = n; break; } }
      // morning mist / afternoon showers bias
      seg.prev = seg.state; seg.state = next; seg.start = seg.start + seg.len; seg.i++; seg.blend = 0;
      seg.len = (35 + rnd(this.s.seed + seg.i * 104729) * 90) * 60;
      if (next === 'rain') seg.len *= 0.6;
    }
  }
  update(realDt) {
    const dt = realDt * this.s.scale;
    this.s.t += dt;
    this.advanceSegments();
    const w = this.cur = this.mix();
    // wind: slowly veering direction
    this.s.windDir += Math.sin(this.s.t / 5400) * 0.00002 * dt;
    const wx = Math.cos(this.s.windDir) * w.wind, wz = Math.sin(this.s.windDir) * w.wind;
    this.wind = [wx, wz];
    // the cloud deck drifts at about twice the street wind, sped up a little with the clock (not with the
    // full time-lapse: at 30x the sky would race), so moving clouds read as weather, not a fast-forward
    const drift = 2 * Math.min(this.s.scale, 4) * realDt;
    this.s.cloudOff[0] += wx * drift; this.s.cloudOff[1] += wz * drift;
    this.s.cloudOff[0] %= 4.2e6; this.s.cloudOff[1] %= 4.2e6;
    this.computeSun();
    // wetness & puddles
    const sunPow = Math.max(0, this.sun.y) * (1 - w.cover * 0.8);
    if (w.rain > 0.02) {
      this.s.wet = Math.min(1, this.s.wet + w.rain * 0.0045 * dt);
      this.s.puddle = Math.min(1, this.s.puddle + Math.max(0, w.rain - 0.15) * 0.0011 * dt);
    } else {
      const dry = 0.00022 * (0.35 + sunPow * 1.4 + w.wind / 12);
      this.s.wet = Math.max(0, this.s.wet - dry * dt);
      this.s.puddle = Math.max(0, this.s.puddle - dry * 0.45 * dt);
    }
    if (this.s.wet < this.s.puddle * 0.6) this.s.wet = this.s.puddle * 0.6;
    this.applyUniforms(realDt);
  }
  computeSun() {
    // NOAA-style approximation for Reading (51.45N, 0.95W)
    const d = new Date(this.s.t * 1000);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const doy = (d.getTime() - start) / 86400000;
    const g = 2 * Math.PI / 365 * (doy - 1);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    const tst = utcMin + eqt + 4 * -0.95;
    const ha = (tst / 4 - 180) * Math.PI / 180;
    const lat = 51.45 * Math.PI / 180;
    const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    const el = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cosZ)));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI; // from north, clockwise
    this.sunEl = el; this.sunAz = az;
    this.sun.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    // the moon (real place and phase) and the star sphere
    const ms = this.s.t * 1000;
    this.starM = starRotation(ms, this.starM);
    const mp = moonPosition(ms, this.starM);
    this.moon.set(mp.dir[0], mp.dir[1], mp.dir[2]);
    this.moonRadius = mp.radius;
    this.moonLit = moonPhase(ms).fraction;
  }
  // sky light from the atmosphere model: sun colour, zenith and horizon radiance, sky and ground light
  // for the clouds. A few dozen samples; refreshed a few times a second.
  skyLight(w) {
    const sun = [this.sun.x, this.sun.y, this.sun.z], moon = [this.moon.x, this.moon.y, this.moon.z], K = SKY_E, haze = w.haze ?? 2;
    const moonK = this.moonE(), lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const at = (el, az) => { const d = [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
      const a = inscatter(d, sun, K, 80, haze, 12), b = moonK > 0 ? inscatter(d, moon, moonK, 80, haze, 8) : [0, 0, 0];
      return [a[0] + b[0] + 0.0036, a[1] + b[1] + 0.0055, a[2] + b[2] + 0.0115]; };
    const sAz = this.sunAz || 0, D = Math.PI / 180;
    const zen = at(Math.PI / 2, 0);
    const hor = [0, 0, 0], mid = [0, 0, 0];
    for (let k = 0; k < 6; k++) { const az = sAz + k * Math.PI / 3, h = at(5 * D, az), m = at(30 * D, az); for (let i = 0; i < 3; i++) { hor[i] += h[i] / 6; mid[i] += m[i] / 6; } }
    const T = transmittance(80, Math.max(-0.2, this.sun.y), haze);
    // cosine-weighted sky light on an upward face, and the street's bounce light from below
    const skyAmb = [0, 1, 2].map(i => zen[i] * 0.35 + mid[i] * 0.45 + hor[i] * 0.2);
    const up = Math.max(0, this.sun.y), sunUp = smooth(-0.03, 0.03, this.sun.y);
    const ground = [0, 1, 2].map(i => (T[i] * up * sunUp * 1.35 + skyAmb[i]) * 0.16);
    return { zen, hor, T, skyAmb, ground, lum };
  }
  // moonlight in sky units: phase (with the opposition surge), above the horizon
  moonE() { return SKY_E * 0.035 * Math.pow(this.moonLit ?? 0, 1.6) * smooth(-0.03, 0.05, this.moon.y); }
  applyUniforms(realDt = 0) {
    const w = this.cur, el = this.sunEl;
    const day = smooth(-0.1, 0.12, Math.sin(el));         // 0 night .. 1 day
    this._skyT = (this._skyT ?? 0) - realDt;
    if (this._skyT <= 0 || !this._sky) { this._skyT = 0.2; this._sky = this.skyLight(w); }
    const S = this._sky, cover = w.cover, ov = cover * cover;
    U.sunTrue.value.copy(this.sun);
    U.moonDir.value.copy(this.moon);
    // key light: the sun; at night the moon, or the sky glow from overhead when the moon is down
    const moonUp = this.moon.y > 0.05;
    if (this.sun.y > -0.05) U.sunDir.value.copy(this.sun);
    else if (moonUp) U.sunDir.value.copy(this.moon);
    else U.sunDir.value.set(0.25, 0.92, 0.3).normalize();
    // sunlight colour: the atmosphere's transmittance (gold, then red, low in the sky), normalised to noon
    const sunUp = smooth(-0.03, 0.03, this.sun.y);
    U.sunTrans.value.setRGB(S.T[0], S.T[1], S.T[2]);
    U.sunCol.value.setRGB(S.T[0] / 0.87, S.T[1] / 0.87, S.T[2] / 0.87).multiplyScalar(day * sunUp + (1 - day) * 0.0);
    // zenith / horizon / fog: the clear sky, greyed and dimmed under cloud as the deck closes in
    const grey = S.lum(S.skyAmb) * 1.05 * (1 - w.dark * 0.5);
    const zen = new THREE.Color(S.zen[0], S.zen[1], S.zen[2]).lerp(new THREE.Color(grey * 0.94, grey * 0.97, grey), ov * 0.95);
    const hor = new THREE.Color(S.hor[0], S.hor[1], S.hor[2]).lerp(new THREE.Color(grey * 1.08, grey * 1.1, grey * 1.12), ov * 0.9);
    U.zenith.value.copy(zen); U.horizon.value.copy(hor);
    const murk = Math.min(1, w.rain * 0.5 + (w.fog > 0.004 ? 0.5 : 0));
    U.fogCol.value.copy(hor.clone().lerp(new THREE.Color(0.5, 0.52, 0.55).multiplyScalar(Math.max(0.02, grey * 0.9)), murk));
    U.fogDensity.value = w.fog;
    U.cover.value = cover; U.cloudDark.value = w.dark; U.rain.value = w.rain;
    U.night.value = 1 - smooth(-0.06, 0.08, Math.sin(el) - cover * 0.05 - w.dark * 0.05);
    U.wet.value = this.s.wet; U.puddle.value = this.s.puddle;
    U.cloudOff.value.set(this.s.cloudOff[0], this.s.cloudOff[1]);
    U.wind.value.set(this.wind[0], this.wind[1]);
    // clouds and atmosphere
    U.skyE.value = SKY_E; U.haze.value = w.haze ?? 2;
    U.moonE.value = this.moonE(); U.moonLit.value = this.moonLit ?? 0; U.moonRadius.value = this.moonRadius ?? 0.0047;
    U.cloudBase.value = w.base ?? 1100; U.cloudThick.value = w.thick ?? 1400; U.cloudType.value = w.type ?? 0.9;
    U.cloudDens.value = (w.dens ?? 1) * (1 + w.dark * 0.3); U.cirrus.value = w.cirrus ?? 0;
    U.covThr.value = coverThreshold(cover);
    U.cloudSun.value.setScalar(1.35);
    const lp = U.night.value * (0.45 + cover * 0.75) + (1 - U.night.value) * 0.0;
    U.lp.value = lp;
    U.skyAmb.value.setRGB(S.skyAmb[0], S.skyAmb[1], S.skyAmb[2]).multiplyScalar(1 - w.dark * 0.35);
    U.groundAmb.value.setRGB(S.ground[0] + 0.07 * lp, S.ground[1] + 0.05 * lp, S.ground[2] + 0.03 * lp);
    // stars: the world -> equatorial rotation, the pole for the moon's orientation, and visibility
    const m = this.starM;
    U.starRot.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    U.celNorth.value.set(m[6], m[7], m[8]);
    const dark = smooth(-0.07, -0.2, this.sun.y);
    U.starVis.value = dark * (1 - 0.55 * (this.moonLit ?? 0) * (moonUp ? 1 : 0)) * (1 - smooth(3, 9, w.haze ?? 2) * 0.8) * (1 - ov * 0.5);
    this.day = day;
    const moonLight = moonUp && this.sun.y < -0.05 ? 0.05 * Math.pow(this.moonLit ?? 0, 1.6) * smooth(0.05, 0.3, this.moon.y) : 0;
    this.sunIntensity = day * sunUp * (1 - cover * 0.78) * (1 - w.dark * 0.3) + moonLight * (1 - cover * 0.8);
    this.skyIntensity = 0.06 + day * (0.9 - w.dark * 0.25);
  }
}
const SKY_E = 20;   // sky calibration: noon zenith ~0.3, matching the scene's sunlight and exposure
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
