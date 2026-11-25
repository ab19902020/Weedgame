// Rain particles, shelter raster, night light-pool map and the nearest-lights list used for
// wet reflections. All driven from the single weather clock.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, positionLocal, texture, mix, fract, step, max, min, sin, cos, abs, cameraPosition, instanceIndex, floor, positionWorld, normalize, cross, length, smoothstep, uv, uniform, varyingProperty, sqrt } from 'three/tsl';
import { U, coverData, coverTex, COVER_N, lightData, lightTex, LIGHT_N, LIGHT_RES, lightPos, lightCol, NL } from './env.js';
import { pointInRing } from './tiles.js';

const DROPS = 9000, BOX = 36, HGT = 22, SPLASHES = 700, SPLASH_BOX = 22;
const splashAt = uniform(new THREE.Vector3(0, -1000, 0));   // the active brother's ground point

export class Atmos {
  constructor(G) {
    this.G = G;
    // rain: streaks that wrap inside a box around the camera. Each drop has its own fall speed, length and
    // width, falls along the wind, faces the camera about its own axis, has a soft profile, and catches
    // the sky light by day and the street lights at night. Hidden under roofs, canopies and shelters.
    const g = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = Math.random(); }
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    ig.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    ig.instanceCount = DROPS;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.camU = { pos: U.coverOrigin }; // placeholder
    const sd = attribute('seed', 'vec4');
    const t = U.t;
    const vLit = varyingProperty('vec3', 'vRainLit'), vVis = varyingProperty('float', 'vRainVis');
    m.positionNode = Fn(() => {
      const r1 = fract(sd.x.mul(7.131)), r2 = fract(sd.y.mul(5.317)), r3 = fract(sd.z.mul(3.713));
      const fall = r1.mul(2.2).add(7.8);                                   // terminal velocity, m/s
      const wind = U.wind.mul(0.55);
      const lx = fract(sd.x.sub(cameraPosition.x.div(BOX)).add(wind.x.mul(t).div(BOX))).sub(0.5).mul(BOX);
      const lz = fract(sd.y.sub(cameraPosition.z.div(BOX)).add(wind.y.mul(t).div(BOX))).sub(0.5).mul(BOX);
      const ly = fract(sd.z.sub(t.mul(fall).div(HGT))).sub(0.35).mul(HGT);
      const c = vec3(cameraPosition.x.add(lx), cameraPosition.y.add(ly), cameraPosition.z.add(lz));
      const cov = texture(coverTex, c.xz.sub(U.coverOrigin).div(COVER_N)).level(0).r;
      const vis = step(sd.w, U.rain).mul(step(cov, c.y));
      // streak: motion-blurred along the fall direction, longer and heavier in a downpour
      const axis = normalize(vec3(wind.x, fall.negate(), wind.y));
      const len = r2.mul(0.45).add(0.3).mul(U.rain.mul(0.6).add(0.55));
      const wid = r3.mul(0.006).add(0.008).mul(U.rain.mul(0.4).add(0.6));
      const side = normalize(cross(axis, normalize(cameraPosition.sub(c))));
      const lp = positionLocal;
      // light: the sky by day; at night street-lamp and shop-window pools light the drops orange
      const pool = texture(lightTex, c.xz.sub(U.lightOrigin).div(LIGHT_N * LIGHT_RES)).level(0).rgb;
      const sky = mix(vec3(U.horizon), vec3(U.zenith), 0.4).mul(0.95).add(0.06);
      vLit.assign(sky.add(pool.mul(U.night).mul(2.2)));
      const dist = length(c.sub(cameraPosition));
      vVis.assign(vis.mul(smoothstep(1.2, 3.0, dist)).mul(smoothstep(BOX * 0.5, BOX * 0.3, dist)));
      return c.add(side.mul(lp.x.mul(wid)).mul(vis)).add(axis.mul(lp.y.mul(len)).mul(vis));
    })();
    {
      const q = uv(), across = abs(q.x.sub(0.5)).mul(2), along = q.y;
      const prof = float(1).sub(across.mul(across)).mul(sin(along.mul(Math.PI)));
      m.colorNode = vec4(vLit, prof.mul(mix(float(0.16), float(0.36), U.rain)).mul(vVis));
    }
    this.rain = new THREE.Mesh(ig, m);
    this.rain.frustumCulled = false; this.rain.renderOrder = 5;
    G.scene.add(this.rain);
    // splashes: little crowns that ring out on the ground around the active brother, each one living a
    // fraction of a second at a fresh random spot; none under cover
    {
      const sg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
      const ss = new Float32Array(SPLASHES * 4);
      for (let i = 0; i < SPLASHES; i++) for (let k = 0; k < 4; k++) ss[i * 4 + k] = Math.random();
      sg.setAttribute('seed', new THREE.InstancedBufferAttribute(ss, 4)); sg.instanceCount = SPLASHES;
      const sm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
      const se = attribute('seed', 'vec4');
      const vAge = varyingProperty('float', 'vSplashAge'), vOn = varyingProperty('float', 'vSplashOn');
      sm.positionNode = Fn(() => {
        const life = se.z.mul(0.12).add(0.22), cyc = t.div(life).add(se.w.mul(7));
        const k = floor(cyc), age = fract(cyc);
        const h1 = fract(sin(k.mul(12.9898).add(se.x.mul(78.233))).mul(43758.5453)), h2 = fract(sin(k.mul(39.346).add(se.y.mul(11.135))).mul(24634.6345));
        const px = splashAt.x.add(h1.sub(0.5).mul(SPLASH_BOX)), pz = splashAt.z.add(h2.sub(0.5).mul(SPLASH_BOX));
        const cov = texture(coverTex, vec2(px, pz).sub(U.coverOrigin).div(COVER_N)).level(0).r;
        const on = step(se.y, U.rain).mul(step(cov, splashAt.y.add(0.3)));
        vAge.assign(age); vOn.assign(on);
        const r = age.mul(0.045).add(0.008).mul(se.x.mul(0.6).add(0.7));   // crowns of a few centimetres
        return vec3(px, splashAt.y.add(0.025), pz).add(positionLocal.mul(r.mul(2)).mul(on));
      })();
      const q = uv().sub(0.5).mul(2), d = length(q);
      const ring = smoothstep(0.55, 0.8, d).mul(smoothstep(1.0, 0.82, d));
      sm.colorNode = vec4(mix(vec3(U.horizon), vec3(U.zenith), 0.4).mul(0.6).add(vec3(0.05)), ring.mul(float(1).sub(vAge)).mul(0.22).mul(vOn).mul(U.rain.mul(0.6).add(0.4)));
      this.splash = new THREE.Mesh(sg, sm);
      this.splash.frustumCulled = false; this.splash.renderOrder = 4;
      G.scene.add(this.splash);
    }
    this.coverAt = { x: 1e9, z: 1e9 };
    this.lightAt = { x: 1e9, z: 1e9 };
    this.lightsDirty = true;
    G.tiles.listeners.push((ev, t) => { this._coverDirty = true; this.lightsDirty = true; });
  }
  // rebuild the shelter raster (1 m texels, 256 m window) when we move far enough
  // Rain-shelter raster (1 m cells around the player). Rebuilt when the player crosses into a new 32 m
  // cell, by scanline-filling building footprints into a back buffer a few milliseconds per frame; the
  // previous raster stays valid until the new one is complete, so driving no longer stalls.
  updateCover(x, z) {
    const me = this.G.brothers?.me, inCar = me?.vehicle;
    splashAt.value.set(x, inCar ? -1000 : (me?.y ?? 0), z);
    this.rain.visible = U.rain.value > 0.005; this.splash.visible = this.rain.visible && !inCar;
    const ox = Math.floor(x / 32) * 32 - COVER_N / 2, oz = Math.floor(z / 32) * 32 - COVER_N / 2;
    const moved = ox !== this.coverAt.x || oz !== this.coverAt.z;
    if ((moved && (!this._cov || this._cov.ox !== ox || this._cov.oz !== oz)) || (this._coverDirty && !this._cov)) {
      this._coverDirty = false;
      const list = [];
      this.G.tiles.buildingsNear(ox + COVER_N / 2, oz + COVER_N / 2, COVER_N / 2 + 20, (P, s, n, top) => list.push([P, s, n, top]));
      this._cov = { ox, oz, list, i: 0, buf: this._covBuf || (this._covBuf = new Float32Array(coverData.length)) };
      this._cov.buf.fill(-1000);
      if (Math.abs(this.coverAt.x - ox) > COVER_N / 3 || Math.abs(this.coverAt.z - oz) > COVER_N / 3) this._cov.urgent = true;  // first build or teleport: finish now
    }
    const job = this._cov; if (!job) return;
    const t0 = performance.now(), buf = job.buf, xs = [];
    while (job.i < job.list.length && (job.urgent || performance.now() - t0 < 1.5)) {
      const [P, s, n, top] = job.list[job.i++];
      let z0 = 1e9, z1 = -1e9; for (let k = 0; k < n; k++) { const pz = P[(s + k) * 2 + 1]; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz; }
      for (let zz = Math.max(job.oz, Math.floor(z0)); zz <= Math.min(job.oz + COVER_N - 1, Math.ceil(z1)); zz++) {
        const zc = zz + 0.5; xs.length = 0;
        for (let k = 0, j = n - 1; k < n; j = k++) {
          const ax = P[(s + j) * 2], az = P[(s + j) * 2 + 1], bx = P[(s + k) * 2], bz = P[(s + k) * 2 + 1];
          if ((az <= zc && bz > zc) || (bz <= zc && az > zc)) xs.push(ax + (zc - az) / (bz - az) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        const row = (zz - job.oz) * COVER_N;
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const a = Math.max(job.ox, Math.ceil(xs[q] - 0.5)), b = Math.min(job.ox + COVER_N - 1, Math.floor(xs[q + 1] - 0.5));
          for (let xx = a; xx <= b; xx++) buf[row + xx - job.ox] = top;
        }
      }
    }
    if (job.i < job.list.length) return;
    // canopies: bus shelters and hand-authored canopies (landmarks)
    const { ox: cx0, oz: cz0 } = job;
    for (const c of this.G.canopies) {
      const cs = Math.cos(c.h), sn = Math.sin(c.h);
      for (let u = -c.l / 2; u <= c.l / 2; u += 0.5) for (let v = -c.w / 2; v <= c.w / 2; v += 0.5) {
        const xx = Math.floor(c.x + u * cs - v * sn - cx0), zz = Math.floor(c.z + u * sn + v * cs - cz0);
        if (xx >= 0 && zz >= 0 && xx < COVER_N && zz < COVER_N) buf[zz * COVER_N + xx] = Math.max(buf[zz * COVER_N + xx], c.y);
      }
    }
    coverData.set(buf);
    this.coverAt = { x: cx0, z: cz0 };
    coverTex.needsUpdate = true;
    U.coverOrigin.value.set(cx0, cz0);
    this._cov = null;
  }
  sheltered(x, y, z) {
    const xx = Math.floor(x - this.coverAt.x), zz = Math.floor(z - this.coverAt.z);
    if (xx < 0 || zz < 0 || xx >= COVER_N || zz >= COVER_N) return false;
    return coverData[zz * COVER_N + xx] > y + 0.4;
  }
  // nearest canopy centre for pedestrians looking for shelter
  coverNear(x, z, r) {
    let best = null, bd = r;
    for (const c of this.G.canopies) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = [c.x, c.z]; } }
    return best;
  }
  // night light pools: lamps + shop windows painted into a 384 m window
  updateLights(x, z) {
    const ox = Math.floor(x / 48) * 48 - LIGHT_N * LIGHT_RES / 2, oz = Math.floor(z / 48) * 48 - LIGHT_N * LIGHT_RES / 2;
    const now = performance.now();
    if (ox === this.lightAt.x && oz === this.lightAt.z && (!this.lightsDirty || now - (this._lightT || 0) < 700)) return;   // tile arrivals: at most ~1.4x/s
    this.lightAt = { x: ox, z: oz }; this.lightsDirty = false; this._lightT = now;
    lightData.fill(0);
    const paint = (px, pz, rad, r, g, b) => {
      const cx = (px - ox) / LIGHT_RES, cz = (pz - oz) / LIGHT_RES, rr = rad / LIGHT_RES;
      for (let j = Math.max(0, Math.floor(cz - rr)); j <= Math.min(LIGHT_N - 1, Math.ceil(cz + rr)); j++)
        for (let i = Math.max(0, Math.floor(cx - rr)); i <= Math.min(LIGHT_N - 1, Math.ceil(cx + rr)); i++) {
          const d = Math.hypot(i - cx, j - cz) / rr; if (d >= 1) continue;
          const f = (1 - d) * (1 - d);
          const k = (j * LIGHT_N + i) * 4;
          lightData[k] = Math.min(255, lightData[k] + r * f); lightData[k + 1] = Math.min(255, lightData[k + 1] + g * f); lightData[k + 2] = Math.min(255, lightData[k + 2] + b * f);
        }
    };
    for (const t of this.G.tiles.tiles.values()) {
      if (t.lamps) for (const L of t.lamps) if (!L.dead) paint(L[0], L[2], 13, 150, 115, 70);   // (knocked-down lamps are dark)
      if (t.data && t.data.signs && t.data.signs.data) {
        const S = t.data.signs.data;
        for (let i = 0; i < S.length / 7; i++) paint(t.data.ox + (S[i * 7] + S[i * 7 + 2]) / 2, t.data.oz + (S[i * 7 + 1] + S[i * 7 + 3]) / 2, 7, 120, 100, 70);
      }
    }
    lightTex.needsUpdate = true;
    U.lightOrigin.value.set(ox, oz);
  }
  // nearest bright lights (lamp heads, vehicle lights, signal lamps) for wet reflections
  updateNearLights(cam) {
    const G = this.G, list = [];
    const night = U.night.value;
    if (night > 0.2) {
      for (const t of G.tiles.tiles.values()) if (t.lamps) for (const L of t.lamps) {
        if (L.dead) continue;
        const [x, y, z] = L;
        const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2; if (d2 < 120 * 120) list.push([x, y, z, 1.4 * night, 1, 0.75, 0.45, d2]);
      }
    }
    for (const v of G.traffic.list) {
      if (!v.lights && !v.brake && !v.siren) continue;
      const d2 = (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2; if (d2 > 110 * 110) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading), L = v.def.L / 2;
      if (v.lights) list.push([v.x + c * L, v.y + 0.75, v.z + s * L, 1.6, 1, 0.95, 0.85, d2 - 1]);
      if (v.lights || v.brake) list.push([v.x - c * L, v.y + 0.85, v.z - s * L, v.brake ? 0.9 : 0.35, 1, 0.08, 0.04, d2]);
      if (v.siren) list.push([v.x, v.y + v.def.H + 0.1, v.z, (Math.floor(U.t.value * 2.6) % 2) * 2.5, 0.1, 0.3, 1, d2 - 2]);
    }
    G.signalRenderer.nearLights(cam, list, 40);
    list.sort((a, b) => a[7] - b[7]);
    for (let i = 0; i < NL; i++) {
      const l = list[i];
      if (l) { lightPos.array[i].set(l[0], l[1], l[2], l[3]); lightCol.array[i].set(l[4], l[5], l[6], 1); }
      else { lightPos.array[i].set(0, -1000, 0, 0); }
    }
  }
}
