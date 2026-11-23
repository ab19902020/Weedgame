// Sky dome: analytic atmosphere + raymarched cloud layer lit by the same sun as the streets.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, positionWorld, cameraPosition, texture, normalize, dot, max, min, mix, smoothstep, step, exp, pow, clamp, fract, floor, sin, If, Loop, abs, log2, length } from 'three/tsl';
import { U, cloudTex, skyColor } from './env.js';

const h3 = Fn(([v]) => fract(sin(dot(v, vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));

export function createSky(steps = 8) {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const H0 = 1350, H1 = 2700;
  const density = Fn(([pos, hf]) => {
    const q = pos.xz.add(U.cloudOff);
    // distance-based mip level: far, grazing samples were aliasing into horizontal streaks
    const lod = log2(max(length(pos.xz.sub(cameraPosition.xz)).div(2500), 1));
    const base = texture(cloudTex, q.div(9000)).level(lod).r;
    const weather = texture(cloudTex, q.div(42000)).level(lod.mul(0.5)).b;
    const detail = texture(cloudTex, q.div(1900).add(hf.mul(0.37))).level(lod.add(1)).g;
    const shape = base.mul(0.7).add(weather.mul(0.3));
    const thr = mix(float(0.72), float(0.05), U.cover);
    const profile = smoothstep(0.0, 0.18, hf).mul(smoothstep(1.0, mix(float(0.45), float(0.85), U.cover), hf));
    const d = shape.sub(thr).mul(5).sub(detail.mul(0.6).mul(float(1.15).sub(profile))).mul(profile);
    return clamp(d, 0, 1).add(smoothstep(0.85, 1.0, U.cover).mul(profile).mul(0.6));
  });
  mat.colorNode = Fn(() => {
    const d = normalize(positionWorld.sub(cameraPosition));
    const col = skyColor(d).toVar();
    // night: stars + moon + urban glow under cloud
    const starField = step(0.9982, h3(floor(d.mul(380)))).mul(U.night).mul(float(1).sub(U.cover)).mul(step(0.05, d.y));
    col.addAssign(vec3(starField.mul(0.9)));
    const moon = smoothstep(0.99955, 0.9998, dot(d, normalize(U.moonDir))).mul(U.night).mul(float(1).sub(U.cover.mul(0.9)));
    col.addAssign(vec3(0.75, 0.78, 0.82).mul(moon.mul(1.5)));
    const glow = U.night.mul(U.cover.mul(0.8).add(0.2)).mul(exp(max(d.y, 0).mul(-6)));
    col.addAssign(vec3(0.09, 0.055, 0.03).mul(glow));
    const outc = col.toVar();
    If(d.y.greaterThan(0.012), () => {
      const camY = cameraPosition.y;
      const t0 = float(H0).sub(camY).div(d.y), t1 = float(H1).sub(camY).div(d.y);
      const dt = t1.sub(t0).div(steps);
      const trans = float(1).toVar();
      const light = vec3(0).toVar();
      const jitter = h3(d.mul(911));   // full-step dither hides slab banding
      const sunVis = smoothstep(-0.08, 0.05, U.sunDir.y);
      const amb = mix(vec3(U.zenith).mul(0.9).add(vec3(U.horizon).mul(0.5)), vec3(0.06, 0.05, 0.05), U.night.mul(0.5));
      Loop(steps, ({ i }) => {
        const t = t0.add(float(i).add(jitter).mul(dt));
        const pos = cameraPosition.add(d.mul(t));
        const hf = pos.y.sub(H0).div(H1 - H0);
        const dens = density(pos, hf);
        If(dens.greaterThan(0.003), () => {
          const lp = pos.add(U.sunDir.mul(350));
          const ld = density(lp, lp.y.sub(H0).div(H1 - H0));
          const sh = exp(ld.mul(-3.2).sub(U.cover.mul(1.2)));
          const powder = float(1).sub(exp(dens.mul(-6)));
          const lit = vec3(U.sunCol).mul(sh.mul(powder).mul(sunVis).mul(2.2)).add(amb.mul(hf.mul(0.6).add(0.45)));
          const dark = float(1).sub(U.cloudDark.mul(0.55));
          const a = float(1).sub(exp(dens.mul(dt).mul(-0.012)));
          light.addAssign(lit.mul(dark).mul(a).mul(trans));
          trans.mulAssign(float(1).sub(a));
        });
      });
      const fade = smoothstep(9000, 32000, t0);
      const cloudy = outc.mul(trans).add(light);
      outc.assign(mix(cloudy, mix(outc, vec3(U.horizon).mul(1.05), U.cover.mul(0.8)), fade));
    }).Else(() => {
      outc.assign(mix(vec3(U.fogCol), outc, smoothstep(-0.25, 0.012, d.y)));
    });
    return outc;
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
