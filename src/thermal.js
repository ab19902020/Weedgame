// The Kestrel's thermal camera (drone.js, droneHud.js). Two parts:
//  1. Heat: people, animals, running cars (their engine bays, exhausts and tyres) and the drone's own motors carry
//     warm bodies, drawn as bright shapes over them only while the thermal camera is on (instanced: one draw per kind).
//  2. The picture (post.js calls thermalView): the scene's light becomes a temperature: the sky is cold (it reads
//     about -20 C), sunlit ground and walls warmer than shade, water and grass cool, and the warm bodies, lamps,
//     headlights and engines hot. Then a sensor's look: white-hot or ironbow palette, a little grain.
//     Without post-processing (the Low preset) a CSS filter gives a white-hot view instead.
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, mix, smoothstep, step, dot, exp, clamp, uniform, screenUV, fract, sin } from 'three/tsl';

// ---------------------------------------------------------------- the post-processing view (post.js)
// colour: the scene's HDR colour; depth: its depth (1 = sky). Returns { node: display colour, on, palette }.
export function thermalView(colour, depth, t) {
  const on = uniform(0), palette = uniform(0), sky = uniform(0.04);
  const lum = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  // surfaces: 0.12 (deep shade, water at night) .. 0.5 (sun-baked tarmac and walls)
  const surf = float(0.12).add(float(0.38).mul(float(1).sub(exp(lum.mul(-1.4)))));
  // the warm bodies (drawn bright) and lamps: hot
  const hot = smoothstep(2.2, 9.0, lum);
  let T = mix(surf, float(0.62).add(hot.mul(0.38)), smoothstep(0.0, 0.15, hot));
  const isSky = step(0.99995, depth);
  T = mix(T, sky, isSky);
  // sensor grain
  const g = fract(sin(dot(screenUV.mul(vec2(1311.7, 977.3)).add(t.mul(61.3)), vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).mul(0.035);
  T = clamp(T.add(g), 0, 1);
  // white hot: a slight gamma; ironbow: black, indigo, magenta, red, orange, yellow, white
  const wh = vec3(T.pow(0.85));
  const c0 = vec3(0.02, 0.01, 0.06), c1 = vec3(0.30, 0.05, 0.52), c2 = vec3(0.80, 0.12, 0.32), c3 = vec3(0.98, 0.45, 0.05), c4 = vec3(1.0, 0.86, 0.25), c5 = vec3(1.0, 0.99, 0.9);
  const ib = mix(mix(mix(c0, c1, smoothstep(0.0, 0.25, T)), mix(c2, c3, smoothstep(0.45, 0.68, T)), smoothstep(0.25, 0.45, T)),
    mix(c4, c5, smoothstep(0.88, 1.0, T)), smoothstep(0.68, 0.88, T));
  return { node: mix(wh, ib, palette), on, palette, sky };
}

// ---------------------------------------------------------------- the warm bodies
const SIZE = { cow: [0.9, 1.4, 2.2], horse: [0.8, 1.6, 2.3], deer: [0.55, 1.1, 1.5], sheep: [0.6, 0.85, 1.1], fox: [0.3, 0.45, 0.8], badger: [0.35, 0.35, 0.8], dog: [0.3, 0.55, 0.85],
  swan: [0.45, 0.6, 1.1], canada: [0.35, 0.55, 0.85], greylag: [0.35, 0.55, 0.85], heron: [0.3, 0.9, 0.6], cat: [0.18, 0.3, 0.5], rabbit: [0.18, 0.25, 0.4], hare: [0.2, 0.32, 0.55],
  hedgehog: [0.15, 0.14, 0.25], squirrel: [0.12, 0.15, 0.3], pheasant: [0.18, 0.3, 0.6] };
const SMALL = [0.12, 0.16, 0.25];

export class Thermal {
  constructor(G) {
    this.G = G; this.on = false;
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
    const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, hotMat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); m.frustumCulled = false; m.count = 0; m.visible = false; G.scene.add(m); return m; };
    // a person: torso and legs as one capsule, the head (warmest) on top
    this.body = mk(new THREE.CapsuleGeometry(0.2, 1.05, 4, 10), 260);
    this.head = mk(new THREE.SphereGeometry(0.12, 10, 8), 260);
    this.animal = mk(new THREE.SphereGeometry(0.5, 10, 8), 160);
    this.engine = mk(new THREE.BoxGeometry(1, 1, 1), 120);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3(); this.c = new THREE.Color();
    this.hotList = [];
  }
  get mode() { const D = this.G.drone; return D?.active && D.cam !== 'normal' ? D.cam : null; }
  update(dt) {
    const G = this.G, mode = this.mode, T = G.post?.thermal;
    const on = !!mode;
    if (on !== this.on) {
      this.on = on;
      for (const m of [this.body, this.head, this.animal, this.engine]) m.visible = on;
      // no post-processing (Low): a CSS white-hot (or warm-toned ironbow) look on the canvas
      if (!T) G.renderer.domElement.style.filter = on ? (mode === 'ironbow' ? 'grayscale(1) contrast(1.9) brightness(0.85) sepia(1) saturate(4) hue-rotate(-25deg)' : 'grayscale(1) contrast(2) brightness(0.85)') : '';
    }
    if (T) { T.on.value = on ? 1 : 0; T.palette.value = mode === 'ironbow' ? 1 : 0; T.sky.value = 0.03 + (G.U?.cover?.value || 0) * 0.07; }
    if (!on) return;
    if (!T) { const want = mode === 'ironbow' ? 'sepia' : 'contrast(2)'; if (G.renderer.domElement.style.filter.indexOf(want) < 0) G.renderer.domElement.style.filter = mode === 'ironbow' ? 'grayscale(1) contrast(1.9) brightness(0.85) sepia(1) saturate(4) hue-rotate(-25deg)' : 'grayscale(1) contrast(2) brightness(0.85)'; }
    const cam = G.camera.position, R = 420, hot = this.hotList; hot.length = 0;
    let nb = 0, na = 0, ne = 0;
    const set = (mesh, i, x, y, z, sx, sy, sz, heat, yaw = 0) => {
      this.q.setFromAxisAngle(Y, yaw); this.p.set(x, y, z); this.s.set(sx, sy, sz);
      this.m.compose(this.p, this.q, this.s); mesh.setMatrixAt(i, this.m); mesh.instanceColor.setXYZ(i, heat, heat, heat);
    };
    // people: the street's crowd, the people in view (actors), and the brothers
    const B = G.brothers, people = [...G.peds.list, ...(G.interiors?.people || []), ...(G.emergency?.actors || []), ...(G.neighbourhood?.actors || [])];
    for (const b of B.b) if (!b.vehicle) people.push(b);
    for (const p of people) {
      if (nb >= 260) break;
      if (!p || p.gone || p.visible === false || p.hidden) continue;
      const dx = p.x - cam.x, dz = p.z - cam.z; if (dx * dx + dz * dz > R * R) continue;
      const y = p.y || 0, seated = p.pose === 'seated', lying = p.dead || p.down > 0.5 || p.fallT > 0;
      const k = p.dead ? 2.2 : 9;                       // the dead cool
      if (lying) set(this.body, nb, p.x, y + 0.2, p.z, 1, 0.3, 1, k * 0.8, 0);
      else set(this.body, nb, p.x, y + (seated ? 0.6 : 0.82), p.z, 1, seated ? 0.62 : 1, 1, k * 0.85);
      set(this.head, nb, p.x, y + (lying ? 0.25 : seated ? 1.2 : 1.62), p.z, 1, 1, 1, k);
      nb++; hot.push([p.x, y + 1.2, p.z, p.dead ? 24 : 34.5 + (p.id ? (p.id.length % 7) * 0.2 : 0)]);
    }
    // animals: a warm body to their size
    for (const a of G.wildlife?.sim?.list || []) {
      if (na >= 160) break;
      if (a.hidden) continue;
      const dx = a.x - cam.x, dz = a.z - cam.z; if (dx * dx + dz * dz > R * R) continue;
      const S = SIZE[a.key] || SMALL, sc = a.scale || 1;
      set(this.animal, na, a.x, (a.y || 0) + S[1] * 0.55 * sc, a.z, S[0] * sc * 2, S[1] * sc * 1.3, S[2] * sc * 2, a.swimming ? 6 : 7.5, -(a.heading || 0));
      na++; hot.push([a.x, (a.y || 0) + S[1] * 0.6, a.z, 38.5]);
    }
    // vehicles with their engines running: the engine bay hot, the exhaust hotter, the tyres warm
    for (const v of G.traffic.list) {
      if (ne >= 115) break;
      if (v.hidden || v.dead) continue;
      const running = !v.parked || v.player || (v.engineT || 0) > 0;
      if (!running) continue;
      const dx = v.x - cam.x, dz = v.z - cam.z; if (dx * dx + dz * dz > R * R) continue;
      const L = v.def?.L || 4.4, Wd = v.def?.W || 1.8, h = v.heading || 0, fx = Math.cos(h), fz = Math.sin(h), y = v.y || 0;
      const front = v.model?.startsWith('bus') ? -0.38 : 0.32;
      set(this.engine, ne++, v.x + fx * L * front, y + 0.75, v.z + fz * L * front, L * 0.3, 0.6, Wd * 0.8, 6.5, -h);
      if (ne < 120) set(this.engine, ne++, v.x - fx * L * 0.5, y + 0.3, v.z - fz * L * 0.5, 0.35, 0.18, 0.35, 11, -h);
      hot.push([v.x + fx * L * front, y + 0.8, v.z + fz * L * front, 72]);
    }
    for (const [m, n] of [[this.body, nb], [this.head, nb], [this.animal, na], [this.engine, ne]]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  // the temperature at the crosshair: the warm thing nearest the line of sight, or the ground, or the sky
  spot() {
    const G = this.G, cam = G.camera, d = cam.getWorldDirection(this._d ||= new THREE.Vector3()), o = cam.position;
    let best = null, bc = Math.cos(1.6 * Math.PI / 180);
    for (const [x, y, z, t] of this.hotList) {
      const vx = x - o.x, vy = y - o.y, vz = z - o.z, l = Math.hypot(vx, vy, vz); if (l > 400 || l < 0.3) continue;
      const c = (vx * d.x + vy * d.y + vz * d.z) / l, tol = Math.max(bc, Math.cos(Math.atan2(1.2, l)));
      if (c > tol && (!best || c > best[0])) best = [c, t];
    }
    if (best) return best[1];
    if (d.y > 0.02) return -18 - (G.U?.cover?.value ? -10 * G.U.cover.value : 0);
    // the ground: warmer in sunshine, cooler in rain and at night
    const w = G.world, sun = Math.max(0, w.sunIntensity || 0.6), rain = w.cur?.rain || 0;
    return 8 + sun * 14 * (1 - (w.cur?.cover || 0) * 0.6) - rain * 3;
  }
}
const Y = new THREE.Vector3(0, 1, 0);
