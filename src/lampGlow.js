// Street lights seen from afar (after GTW's night city, galatolofederico/gtw, MIT): past the distance the lamp
// posts themselves are drawn to, every street lamp in the loaded world is a soft warm glow at its lantern, so at
// night the roads read as chains of lights out to the edge of the map. One instanced draw of camera-facing quads,
// rebuilt only when tiles stream in or out; nothing is drawn by day.
import * as THREE from 'three/webgpu';
import { attribute, uv, vec3, vec4, float, length, smoothstep, cameraPosition, positionLocal, modelViewMatrix, cameraProjectionMatrix, max, min, exp } from 'three/tsl';
import { U } from './env.js';

const MAX = 16384;

export class LampGlow {
  constructor(G) {
    this.G = G; this.dirty = true;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(MAX * 4);
    this.attr = new THREE.InstancedBufferAttribute(this.pos, 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('lamp', this.attr); geo.instanceCount = 0;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const L = attribute('lamp', 'vec4');
    // a billboard: the quad in view space round the lantern, sized in metres near and kept to a few pixels far off
    const centre = modelViewMatrix.mul(vec4(L.xyz, 1));
    const dist = length(L.xyz.sub(cameraPosition));
    const size = max(float(1.6), dist.mul(0.0055)).mul(L.w);
    m.vertexNode = cameraProjectionMatrix.mul(centre.add(vec4(positionLocal.xy.mul(size), 0, 0)));
    // fades in beyond the lamps that are really drawn (and their light pools), out into the haze at the far end
    const near = smoothstep(this.G.budget?.lampDist ? this.G.budget.lampDist * 0.55 : 140, this.G.budget?.lampDist ? this.G.budget.lampDist * 0.95 : 240, dist);
    const haze = exp(dist.mul(U.fogDensity).mul(dist.mul(U.fogDensity)).mul(-0.55));
    const r = length(uv().sub(0.5)).mul(2);
    const core = float(1).sub(smoothstep(0.0, 0.25, r)), halo = float(1).sub(smoothstep(0.1, 1.0, r)).pow(2.2);
    const k = U.night.mul(near).mul(haze).mul(min(float(1), float(900).div(dist)));
    m.colorNode = vec3(1.0, 0.7, 0.4).mul(core.mul(3.2).add(halo.mul(0.55))).mul(k);
    m.opacityNode = float(1);
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    G.scene.add(this.mesh);
    G.tiles.listeners.push(() => { this.dirty = true; });
  }
  rebuild() {
    const G = this.G, P = this.pos; let n = 0;
    for (const t of G.tiles.tiles?.values?.() || []) {
      const lp = t.data?.lamps; if (!lp) continue;
      const ox = t.data.ox, oz = t.data.oz;
      for (let i = 0; i < lp.length && n < MAX; i += 4) {
        if (t.lamps?.[i / 4]?.dead) continue;
        // the lantern: 1.2 m out along the arm, 7.35 m up (tiles.js lampGeo), the post turned by -ang + PI
        const th = -lp[i + 3] + Math.PI;
        P[n * 4] = lp[i] + ox - 1.2 * Math.cos(th); P[n * 4 + 1] = lp[i + 1] + 7.3; P[n * 4 + 2] = lp[i + 2] + oz + 1.2 * Math.sin(th); P[n * 4 + 3] = 1;
        n++;
      }
    }
    this.mesh.geometry.instanceCount = n; this.count = n;
    this.attr.clearUpdateRanges(); this.attr.addUpdateRange(0, n * 4); this.attr.needsUpdate = true;
    this.dirty = false;
  }
  update() {
    const on = U.night.value > 0.02;
    this.mesh.visible = on;
    if (on && this.dirty) this.rebuild();
  }
}
