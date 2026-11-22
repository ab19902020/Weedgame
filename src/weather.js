// One world clock and one weather timeline for the whole map. State is integrated
// (wetness, puddles, cloud drift) and saved, so brother swaps and relaunches stay continuous.
import * as THREE from 'three/webgpu';
import { U } from './env.js';

export const STATES = {
  clear: { cover: 0.1, rain: 0, fog: 0.00045, wind: 3, dark: 0 },
  broken: { cover: 0.45, rain: 0, fog: 0.0006, wind: 5, dark: 0 },
  overcast: { cover: 0.93, rain: 0, fog: 0.0009, wind: 6, dark: 0.15 },
  drizzle: { cover: 0.96, rain: 0.22, fog: 0.0015, wind: 5, dark: 0.35 },
  rain: { cover: 1.0, rain: 1.0, fog: 0.0024, wind: 9, dark: 0.85 },
  mist: { cover: 0.75, rain: 0, fog: 0.0075, wind: 1, dark: 0.1 },
  clearing: { cover: 0.32, rain: 0, fog: 0.0008, wind: 7, dark: 0 },
};
const NEXT = {
  clear: [['broken', 0.7], ['mist', 0.1], ['clear', 0.2]],
  broken: [['clear', 0.3], ['overcast', 0.55], ['broken', 0.15]],
  overcast: [['drizzle', 0.5], ['broken', 0.3], ['mist', 0.2]],
  drizzle: [['rain', 0.55], ['overcast', 0.45]],
  rain: [['drizzle', 0.5], ['clearing', 0.5]],
  mist: [['overcast', 0.5], ['clear', 0.5]],
  clearing: [['broken', 0.6], ['clear', 0.4]],
};
const BLEND = 25 * 60; // game seconds to blend between states

function rnd(seed) { let s = seed >>> 0 || 1; s = Math.imul(s ^ (s >>> 15), 2246822507); s = Math.imul(s ^ (s >>> 13), 3266489909); return ((s ^ (s >>> 16)) >>> 0) / 4294967296; }

export class World {
  constructor(saved) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 10).getTime() / 1000;
    this.s = Object.assign({
      t: start,            // game time (unix seconds)
      scale: 30,           // game seconds per real second
      seed: (Math.random() * 1e9) | 0,
      seg: { i: 0, start: start, len: 70 * 60, state: 'broken', prev: 'clear' },
      wet: 0, puddle: 0, cloudOff: [0, 0], windDir: 0.6, forced: null,
    }, saved || {});
    this.cur = { ...STATES.broken };
    this.sun = new THREE.Vector3(); this.moon = new THREE.Vector3();
    this.update(0);
  }
  get time() { return this.s.t; }
  hours() { const d = new Date(this.s.t * 1000); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
  stateName() { return this.s.seg.state; }
  force(state) {
    const seg = this.s.seg;
    const blendNow = this.mix();
    seg.prev = 'custom'; seg.prevMix = blendNow;
    seg.state = state; seg.start = this.s.t; seg.len = 90 * 60; seg.i++;
  }
  setHour(h) { const d = new Date(this.s.t * 1000); d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); this.s.t = d.getTime() / 1000; this.s.seg.start = Math.min(this.s.seg.start, this.s.t); }
  mix() {
    const seg = this.s.seg;
    const a = seg.prev === 'custom' ? seg.prevMix || STATES.broken : STATES[seg.prev], b = STATES[seg.state];
    const k = Math.max(0, Math.min(1, (this.s.t - seg.start) / BLEND));
    const e = k * k * (3 - 2 * k);
    const out = {};
    for (const key of Object.keys(b)) out[key] = a[key] + (b[key] - a[key]) * e;
    return out;
  }
  advanceSegments() {
    const seg = this.s.seg;
    let guard = 0;
    while (this.s.t > seg.start + seg.len && guard++ < 200) {
      const r = rnd(this.s.seed + seg.i * 7919);
      let acc = 0, next = seg.state;
      for (const [n, p] of NEXT[seg.state]) { acc += p; if (r <= acc) { next = n; break; } }
      // morning mist / afternoon showers bias
      seg.prev = seg.state; seg.state = next; seg.start = seg.start + seg.len; seg.i++;
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
    this.s.cloudOff[0] += wx * 2.2 * dt; this.s.cloudOff[1] += wz * 2.2 * dt;
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
    this.applyUniforms();
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
    // moon roughly opposite, offset
    this.moon.set(-this.sun.x * 0.8 + 0.2, Math.max(0.15, -this.sun.y * 0.8 + 0.25), -this.sun.z * 0.8).normalize();
  }
  applyUniforms() {
    const w = this.cur, el = this.sunEl;
    const day = smooth(-0.1, 0.12, Math.sin(el));         // 0 night .. 1 day
    const golden = Math.max(0, 1 - Math.abs(Math.sin(el) - 0.05) / 0.22) * day;
    U.sunDir.value.copy(this.sun.y > -0.05 ? this.sun : this.moon);
    U.moonDir.value.copy(this.moon);
    const sunCol = new THREE.Color().setRGB(1, 0.93 - golden * 0.3, 0.84 - golden * 0.5);
    U.sunCol.value.copy(sunCol.multiplyScalar(day));
    const clearZen = new THREE.Color(0.16, 0.33, 0.68), ovZen = new THREE.Color(0.42, 0.45, 0.49), nightZen = new THREE.Color(0.006, 0.01, 0.025);
    const clearHor = new THREE.Color(0.62, 0.72, 0.84).lerp(new THREE.Color(0.95, 0.62, 0.38), golden * (1 - w.cover)), ovHor = new THREE.Color(0.56, 0.58, 0.6), nightHor = new THREE.Color(0.025, 0.03, 0.045);
    const zen = clearZen.clone().lerp(ovZen, w.cover * 0.95).multiplyScalar(1 - w.dark * 0.45);
    const hor = clearHor.clone().lerp(ovHor, w.cover * 0.9).multiplyScalar(1 - w.dark * 0.35);
    zen.lerp(nightZen, 1 - day); hor.lerp(nightHor.clone().lerp(new THREE.Color(0.07, 0.05, 0.035), w.cover), 1 - day);
    U.zenith.value.copy(zen); U.horizon.value.copy(hor);
    U.fogCol.value.copy(hor.clone().lerp(new THREE.Color(0.5, 0.52, 0.55).multiplyScalar(day * 0.9 + 0.05), w.rain * 0.5 + (w.fog > 0.004 ? 0.5 : 0)));
    U.fogDensity.value = w.fog;
    U.cover.value = w.cover; U.cloudDark.value = w.dark; U.rain.value = w.rain;
    U.night.value = 1 - smooth(-0.06, 0.08, Math.sin(el) - w.cover * 0.05 - w.dark * 0.05);
    U.wet.value = this.s.wet; U.puddle.value = this.s.puddle;
    U.cloudOff.value.set(this.s.cloudOff[0], this.s.cloudOff[1]);
    U.wind.value.set(this.wind[0], this.wind[1]);
    this.day = day;
    this.sunIntensity = day * (1 - w.cover * 0.78) * (1 - w.dark * 0.3);
    this.skyIntensity = 0.06 + day * (0.9 - w.dark * 0.25);
  }
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
