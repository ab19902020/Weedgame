// Rain particles, shelter raster, night light-pool map and the nearest-lights list used for
// wet reflections. All driven from the single weather clock.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, positionLocal, texture, mix, fract, step, max, sin, cameraPosition, instanceIndex, floor, positionWorld } from 'three/tsl';
import { U, coverData, coverTex, COVER_N, lightData, lightTex, LIGHT_N, LIGHT_RES, lightPos, lightCol, NL } from './env.js';
import { pointInRing } from './tiles.js';

const DROPS = 9000, BOX = 36, HGT = 22;

export class Atmos {
  constructor(G) {
    this.G = G;
    // rain: instanced thin quads that wrap inside a box around the camera
    const g = new THREE.PlaneGeometry(0.012, 0.55);
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = Math.random(); }
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    ig.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    ig.instanceCount = DROPS;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.camU = { pos: U.coverOrigin }; // placeholder
    const sd = attribute('seed', 'vec4');
    const fall = float(9.5);
    const t = U.t;
    const wind = U.wind.mul(0.18);
    const lx = fract(sd.x.sub(cameraPosition.x.div(BOX)).add(wind.x.mul(t).div(BOX))).sub(0.5).mul(BOX);
    const lz = fract(sd.y.sub(cameraPosition.z.div(BOX)).add(wind.y.mul(t).div(BOX))).sub(0.5).mul(BOX);
    const ly = fract(sd.z.sub(t.mul(fall).div(HGT))).sub(0.35).mul(HGT);
    const wx = cameraPosition.x.add(lx), wz = cameraPosition.z.add(lz), wy = cameraPosition.y.add(ly);
    // shelter: hide drops below the cover height at their column
    const cov = texture(coverTex, vec2(wx, wz).sub(U.coverOrigin).div(COVER_N)).level(0).r;
    const visible = step(sd.w, U.rain).mul(step(cov, wy));
    const slant = vec3(wind.x.div(fall), 0, wind.y.div(fall));
    const local = positionLocal;
    m.positionNode = vec3(wx, wy, wz).add(vec3(local.x, local.y, 0).mul(visible)).add(slant.mul(local.y).mul(visible));
    m.colorNode = vec4(mix(vec3(0.62, 0.66, 0.7), vec3(0.25, 0.27, 0.3), U.night), mix(float(0.16), float(0.32), U.rain).mul(visible));
    this.rain = new THREE.Mesh(ig, m);
    this.rain.frustumCulled = false; this.rain.renderOrder = 5;
    G.scene.add(this.rain);
    this.coverAt = { x: 1e9, z: 1e9 };
    this.lightAt = { x: 1e9, z: 1e9 };
    this.lightsDirty = true;
    G.tiles.listeners.push((ev, t) => { this.coverAt.x = 1e9; this.lightsDirty = true; });
  }
  // rebuild the shelter raster (1 m texels, 256 m window) when we move far enough
  updateCover(x, z) {
    const ox = Math.floor(x / 32) * 32 - COVER_N / 2, oz = Math.floor(z / 32) * 32 - COVER_N / 2;
    if (ox === this.coverAt.x && oz === this.coverAt.z) return;
    this.coverAt = { x: ox, z: oz };
    coverData.fill(-1000);
    const G = this.G;
    G.tiles.buildingsNear(ox + COVER_N / 2, oz + COVER_N / 2, COVER_N / 2 + 20, (P, s, n, top) => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let k = 0; k < n; k++) { const px = P[(s + k) * 2], pz = P[(s + k) * 2 + 1]; x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
      for (let zz = Math.max(oz, Math.floor(z0)); zz <= Math.min(oz + COVER_N - 1, Math.ceil(z1)); zz++)
        for (let xx = Math.max(ox, Math.floor(x0)); xx <= Math.min(ox + COVER_N - 1, Math.ceil(x1)); xx++)
          if (pointInRing(P, s, n, xx + 0.5, zz + 0.5)) coverData[(zz - oz) * COVER_N + (xx - ox)] = top;
    });
    // canopies: bus shelters and hand-authored canopies (landmarks)
    for (const c of G.canopies) {
      const cs = Math.cos(c.h), sn = Math.sin(c.h);
      for (let u = -c.l / 2; u <= c.l / 2; u += 0.5) for (let v = -c.w / 2; v <= c.w / 2; v += 0.5) {
        const xx = Math.floor(c.x + u * cs - v * sn - ox), zz = Math.floor(c.z + u * sn + v * cs - oz);
        if (xx >= 0 && zz >= 0 && xx < COVER_N && zz < COVER_N) coverData[zz * COVER_N + xx] = Math.max(coverData[zz * COVER_N + xx], c.y);
      }
    }
    coverTex.needsUpdate = true;
    U.coverOrigin.value.set(ox, oz);
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
    if (ox === this.lightAt.x && oz === this.lightAt.z && !this.lightsDirty) return;
    this.lightAt = { x: ox, z: oz }; this.lightsDirty = false;
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
      if (t.lamps) for (const [lx, , lz] of t.lamps) paint(lx, lz, 13, 150, 115, 70);
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
      for (const t of G.tiles.tiles.values()) if (t.lamps) for (const [x, y, z] of t.lamps) {
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
