// Fire, smoke and explosions, and the light they throw.
//
// Two instanced sprite systems, one draw call each:
//   flames  additive: licking tongues of flame (three painted shapes), embers, the billowing fireball of an
//           explosion and its white flash. Each tongue is born at the root of the fire, white-yellow and small, rises
//           and stretches, reddens and thins out at the tip, so a fire is a flickering crowd of them, not a mesh.
//   smoke   alpha-blended: lumpy puffs that leave the top of the flames, roll upwards, spread, and drift away down
//           the wind, black off a burning car, grey off a doused one, lit orange from below by the fire. Drawn back
//           to front.
// One painted atlas (canvas, made on the first fire) feeds both.
//
// burn(src, dt) keeps a fire going for a frame: whoever owns it (vehicleFire.js, emergency.js) calls it every frame
// with the burning area and how hot it is; explosion() throws one off; light() asks for a firelight. The four
// strongest firelights near the camera light the world around them (env.js fireL/fireC, materials.js lightPool) and
// show in the wet road (atmos.js).
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, vec4, uv, texture, smoothstep, step, mix, sin, floor, fract, max, instancedDynamicBufferAttribute } from 'three/tsl';
import { U, NF } from './env.js';

const MAXF = 1100, MAXS = 760;
const K_FLAME = 0, K_EMBER = 1, K_BALL = 2, K_FLASH = 3;
const rnd = (a, b) => a + Math.random() * (b - a);
const QUALITY = { low: 0.6, medium: 0.8, high: 1 };

// ------------------------------------------------------------------ the atlas: 4 x 2 cells of 128 x 128
// 0-2 tongues of flame, 3 a glow, 4-5 billows, 6 a flash, 7 a puff
let ATLAS = null;
export function atlas() {
  if (ATLAS) return ATLAS;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  // (each cell faded out well before its edges, so no sprite shows a straight edge and no cell bleeds into the next in
  // the smaller mipmaps)
  const cell = (i, draw, round) => {
    g.save(); g.translate((i % 4) * 128, Math.floor(i / 4) * 128); g.beginPath(); g.rect(0, 0, 128, 128); g.clip(); draw();
    g.globalCompositeOperation = 'destination-in'; g.filter = 'none';
    if (round) { const m = g.createRadialGradient(64, 64, 40, 64, 64, 60); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, 128, 128); }
    else {
      const h = g.createLinearGradient(0, 0, 128, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.06, 'rgba(0,0,0,1)'); h.addColorStop(0.94, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = h; g.fillRect(0, 0, 128, 128);
      const v = g.createLinearGradient(0, 0, 0, 128); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.05, 'rgba(0,0,0,1)'); v.addColorStop(0.96, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = v; g.fillRect(0, 0, 128, 128);
    }
    g.restore();
  };
  // a tongue of flame: white-hot at the root, through yellow and orange to a ragged deep red tip
  const tongue = k => {
    const lean = (k - 1) * 10;
    g.filter = 'blur(3.5px)';
    const grad = g.createLinearGradient(0, 126, 0, 2);
    grad.addColorStop(0, 'rgba(255,226,140,1)'); grad.addColorStop(0.25, 'rgba(255,172,52,1)'); grad.addColorStop(0.55, 'rgba(248,104,18,0.95)');
    grad.addColorStop(0.82, 'rgba(186,40,4,0.5)'); grad.addColorStop(1, 'rgba(110,14,0,0)');
    g.fillStyle = grad;
    // the main lick, broad at the root
    g.beginPath(); g.moveTo(64, 125);
    g.bezierCurveTo(22, 121, 28, 80, 48 + lean * 0.3, 52); g.bezierCurveTo(56 + lean, 32, 60 + lean, 18, 66 + lean, 3);
    g.bezierCurveTo(74 + lean, 28, 104, 60, 102, 94); g.bezierCurveTo(100, 119, 84, 125, 64, 125); g.fill();
    // smaller licks off either side
    g.beginPath(); g.moveTo(60 - lean, 120); g.bezierCurveTo(36 - lean, 106, 38 - lean, 82, 30 - lean * 1.6, 50); g.bezierCurveTo(52 - lean, 74, 70 - lean, 96, 60 - lean, 120); g.fill();
    g.beginPath(); g.moveTo(70, 120); g.bezierCurveTo(92 + lean, 108, 96 + lean, 88, 100 + lean * 1.4, 64); g.bezierCurveTo(84 + lean, 84, 74, 100, 70, 120); g.fill();
    const core = g.createRadialGradient(64, 108, 2, 64, 102, 30); core.addColorStop(0, 'rgba(255,246,190,0.85)'); core.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = core; g.fillRect(0, 0, 128, 128);
    g.filter = 'none';
  };
  const glow = () => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.25, 'rgba(255,214,120,0.85)'); r.addColorStop(0.6, 'rgba(255,128,30,0.3)'); r.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  };
  // a cauliflower billow (white; tinted in the shader): overlapping soft lobes, denser in the middle
  // (irregular: lobes of all sizes scattered wide, and wisps drawn out from the edge, so a puff has no round outline)
  const billow = (seed, lobes, blur) => {
    let s = seed; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.filter = `blur(${blur}px)`;
    for (let i = 0; i < lobes; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 40, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 7 + R() * R() * 26;
      const k = 0.48 * (1 - d / 52);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${k.toFixed(3)})`); gr.addColorStop(0.5, `rgba(255,255,255,${(k * 0.45).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, x = 64 + Math.cos(a) * 30, y = 64 + Math.sin(a) * 30;
      g.save(); g.translate(x, y); g.rotate(a + (R() - 0.5)); g.scale(2.2, 0.7);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 12); gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(-14, -14, 28, 28); g.restore();
    }
    g.filter = 'none';
  };
  const flash = () => {
    glow();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + 0.2, L = i % 2 ? 40 : 60;
      const gr = g.createLinearGradient(64, 64, 64 + Math.cos(a) * L, 64 + Math.sin(a) * L); gr.addColorStop(0, 'rgba(255,250,230,0.7)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.strokeStyle = gr; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * L, 64 + Math.sin(a) * L); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  };
  cell(0, () => tongue(0)); cell(1, () => tongue(1)); cell(2, () => tongue(2)); cell(3, glow, true);
  cell(4, () => billow(7, 34, 5), true); cell(5, () => billow(91, 30, 6), true); cell(6, flash, true); cell(7, () => billow(4242, 38, 6), true);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (ATLAS = t);
}
// (u, v) inside cell i, from the sprite's own uv
const cellUV = (i) => uv().add(vec2(i.mod(4), float(1).sub(floor(i.div(4))))).mul(vec2(0.25, 0.5));

export class FireFx {
  constructor(G) {
    this.G = G; this.scene = G.scene;
    this.time = 0;
    // ---- flames: per particle position, velocity, age, life, size (start, end), stretch, cell, kind, brightness
    this.fp = new Float32Array(MAXF * 3); this.fv = new Float32Array(MAXF * 3); this.fa = new Float32Array(MAXF).fill(1e9); this.fl = new Float32Array(MAXF).fill(1);
    this.fs0 = new Float32Array(MAXF); this.fs1 = new Float32Array(MAXF); this.fst = new Float32Array(MAXF); this.fc = new Float32Array(MAXF); this.fk = new Uint8Array(MAXF);
    this.fb = new Float32Array(MAXF); this.fr = new Float32Array(MAXF); this.fdrag = new Float32Array(MAXF); this.fgrav = new Float32Array(MAXF);
    this.fi = 0;
    // ---- smoke: position, velocity, age (negative while it waits to appear), life, size, growth, darkness, glow, spin
    this.sp = new Float32Array(MAXS * 3); this.sv = new Float32Array(MAXS * 3); this.sa = new Float32Array(MAXS).fill(1e9); this.sl = new Float32Array(MAXS).fill(1);
    this.ss0 = new Float32Array(MAXS); this.ss1 = new Float32Array(MAXS); this.sd = new Float32Array(MAXS); this.sg = new Float32Array(MAXS); this.sr = new Float32Array(MAXS);
    this.sw = new Float32Array(MAXS); this.sdrag = new Float32Array(MAXS); this.sc = new Uint8Array(MAXS); this.sden = new Float32Array(MAXS);
    this.si = 0;
    this._order = new Uint16Array(MAXS); this._depth = new Float32Array(MAXS);
    this.built = false;
    this.lights = [];       // this frame's firelight requests: [x, y, z, r, g, b, intensity, reach]
    this.near = [];         // the ones chosen (atmos.js reflects them in the wet road)
    this.flashes = [];      // short-lived explosion lights: {x, y, z, t, life, i, reach, r, g, b}
  }
  build() {
    if (this.built) return; this.built = true;
    const tex = atlas();
    // flames
    this.fPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXF * 4), 4); this.fPos.setUsage(THREE.DynamicDrawUsage);
    this.fAtt = new THREE.InstancedBufferAttribute(new Float32Array(MAXF * 4), 4); this.fAtt.setUsage(THREE.DynamicDrawUsage);
    // (premultiplied: colour x alpha added, the background dimmed by `occ`. Tongues and the fireball hide some of what's
    // behind them, so they hold their colour against a bright sky; embers and the flash only add light)
    const fm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    fm.blending = THREE.CustomBlending; fm.blendSrc = THREE.OneFactor; fm.blendDst = THREE.OneMinusSrcAlphaFactor; fm.blendEquation = THREE.AddEquation;
    const P = instancedDynamicBufferAttribute(this.fPos, 'vec4'), A = instancedDynamicBufferAttribute(this.fAtt, 'vec4');
    fm.positionNode = P.xyz; fm.scaleNode = A.xy; fm.rotationNode = A.z;
    // (code: kind x 16 + cell x 2 + brightness / 3)
    const t = P.w, code = A.w, kind = floor(code.div(16)), cellI = floor(code.mod(16).div(2)).min(7), bright = fract(code.div(2)).mul(6);
    const tx = texture(tex, cellUV(cellI));
    const isF = step(kind, 0.5), isE = step(0.5, kind).mul(step(kind, 1.5)), isB = step(1.5, kind).mul(step(kind, 2.5)), isX = step(2.5, kind);
    // tongues: their own painted colour, reddening as they rise and burn out
    const cF = tx.rgb.mul(vec3(1.15, mix(float(1.05), float(0.62), t), mix(float(1), float(0.4), t)));
    const aF = smoothstep(0, 0.14, t).mul(smoothstep(1, 0.5, t));
    // embers: hot orange specks, twinkling
    const tw = float(0.65).add(sin(U.t.mul(31).add(A.z.mul(57))).mul(0.35));
    const cE = vec3(1, 0.55, 0.16).mul(3).mul(tw);
    const aE = smoothstep(1, 0.6, t);
    // the fireball: white-hot, through orange to a dull red as it rolls up and cools into smoke
    const cB = mix(mix(vec3(2.5, 2.0, 1.3), vec3(2.0, 0.78, 0.2), smoothstep(0, 0.18, t)), vec3(0.5, 0.1, 0.025), smoothstep(0.22, 0.75, t));
    const aB = smoothstep(0, 0.05, t).mul(smoothstep(1, 0.4, t));
    const cX = vec3(3, 2.75, 2.3), aX = smoothstep(1, 0, t);
    const col = cF.mul(isF).mul(1.5).add(cE.mul(isE)).add(cB.mul(isB)).add(cX.mul(isX));
    const alpha = tx.a.mul(aF.mul(isF).add(aE.mul(isE)).add(aB.mul(isB)).add(aX.mul(isX))).mul(bright).min(1);
    const occ = isF.mul(0.42).add(isB.mul(0.3).mul(smoothstep(0.1, 0.5, t)));
    fm.colorNode = col.mul(alpha); fm.opacityNode = alpha.mul(occ);
    this.flames = new THREE.Sprite(fm); this.flames.count = 0; this.flames.frustumCulled = false; this.flames.renderOrder = 6; this.flames.visible = false;
    this.scene.add(this.flames);
    // smoke
    this.sPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 4), 4); this.sPos.setUsage(THREE.DynamicDrawUsage);
    this.sAtt = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 4), 4); this.sAtt.setUsage(THREE.DynamicDrawUsage);
    const sm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: true });
    const SP = instancedDynamicBufferAttribute(this.sPos, 'vec4'), SA = instancedDynamicBufferAttribute(this.sAtt, 'vec4');
    sm.positionNode = SP.xyz; sm.scaleNode = vec2(SA.x, SA.x); sm.rotationNode = SA.y;
    // (z: which puff + darkness; w: density x 10 + the fire's glow on it)
    const st = SP.w, sCell = floor(SA.z).min(2), dark = fract(SA.z), glw = fract(SA.w), den = floor(SA.w).div(10);
    const stx = texture(tex, cellUV(sCell.add(4).add(step(1.5, sCell))));
    // lit from above by the day, from below by the fire it came off
    const day = float(1).sub(U.night.mul(0.82));
    const base = mix(vec3(0.045, 0.041, 0.038), vec3(0.62, 0.62, 0.64), dark);
    const lit = base.mul(mix(float(0.55), float(1.15), uv().y).mul(day).add(day.mul(0.06)).add(0.012)).add(vec3(1, 0.42, 0.1).mul(glw).mul(float(1).sub(uv().y.mul(0.55))).mul(0.9));
    sm.colorNode = lit;
    sm.opacityNode = stx.a.mul(1.45).min(1).mul(smoothstep(0, 0.1, st)).mul(smoothstep(1, 0.38, st)).mul(den);
    this.smoke = new THREE.Sprite(sm); this.smoke.count = 0; this.smoke.frustumCulled = false; this.smoke.renderOrder = 5; this.smoke.visible = false;
    this.scene.add(this.smoke);
  }
  // ------------------------------------------------------------------ spawning
  flame(kind, x, y, z, vx, vy, vz, life, s0, s1, stretch, cell, bright = 1, drag = 1.2, grav = 0) {
    const i = this.fi; this.fi = (this.fi + 1) % MAXF;
    this.fp[i * 3] = x; this.fp[i * 3 + 1] = y; this.fp[i * 3 + 2] = z;
    this.fv[i * 3] = vx; this.fv[i * 3 + 1] = vy; this.fv[i * 3 + 2] = vz;
    this.fa[i] = 0; this.fl[i] = life; this.fs0[i] = s0; this.fs1[i] = s1; this.fst[i] = stretch; this.fc[i] = cell; this.fk[i] = kind;
    this.fb[i] = Math.min(0.999, bright / 3); this.fr[i] = (Math.random() - 0.5) * 0.5; this.fdrag[i] = drag; this.fgrav[i] = grav;
  }
  puff(x, y, z, vx, vy, vz, life, s0, s1, dark, glow, density = 0.85, delay = 0, drag = 0.5) {
    const i = this.si; this.si = (this.si + 1) % MAXS;
    this.sp[i * 3] = x; this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = z;
    this.sv[i * 3] = vx; this.sv[i * 3 + 1] = vy; this.sv[i * 3 + 2] = vz;
    this.sa[i] = -delay; this.sl[i] = life; this.ss0[i] = s0; this.ss1[i] = s1; this.sd[i] = Math.min(0.99, Math.max(0, dark)); this.sg[i] = glow;
    this.sr[i] = Math.random() * 6.28; this.sw[i] = (Math.random() - 0.5) * 0.4; this.sdrag[i] = drag; this.sc[i] = Math.floor(Math.random() * 3); this.sden[i] = Math.min(9, Math.round(density * 10));
  }
  // keep a fire going for a frame. src: { x, y, z (the base), heading, hx, hz (half length and width of the
  // burning area), h (flame height, m), heat 0..1, smoke 0..1, dark 0 black .. 1 white, embers 0..1, light (0 none) }.
  // The source keeps its own accumulators between frames.
  burn(src, dt) {
    this.build();
    const heat = Math.max(0, Math.min(1.5, src.heat || 0)); if (heat <= 0.01 && !(src.smoke > 0.01)) return;
    const c = Math.cos(src.heading || 0), s = Math.sin(src.heading || 0), hx = src.hx || 0.4, hz = src.hz || 0.4, h = src.h || 1;
    const area = Math.max(0.3, hx * hz * 4), W = U.wind.value, wx = W.x, wz = W.y;
    const at = (o) => { const a = (Math.random() * 2 - 1) * hx, b = (Math.random() * 2 - 1) * hz; o[0] = src.x + c * a - s * b; o[1] = src.z + s * a + c * b; return o; };
    const Q = QUALITY[this.G.quality] ?? 0.8;   // (fewer, on a phone that's working hard)
    const q = this._q || (this._q = [0, 0]);
    // tongues of flame: more and taller as it takes hold
    src._f = (src._f || 0) + dt * heat * (14 + area * 9) * (src.rate ?? 1) * (0.5 + 0.5 * Q);
    while (src._f >= 1) {
      src._f -= 1; at(q);
      const r = Math.random(), sz = (0.3 + r * r * 0.85) * h * (0.55 + 0.45 * Math.min(1, heat)) * (src.size ?? 1);   // (mostly small licks, now and then a big one)
      this.flame(K_FLAME, q[0], src.y + Math.random() * 0.15 * h, q[1], wx * 0.12 + (Math.random() - 0.5) * 0.7, (1.1 + Math.random() * 1.5) * Math.sqrt(h), wz * 0.12 + (Math.random() - 0.5) * 0.7,
        0.4 + Math.random() * 0.5, sz * (0.8 + Math.random() * 0.4), sz * 0.45, 1.1 + Math.random() * 0.8, Math.floor(Math.random() * 3), 0.7 + Math.random() * 0.6, 1.4, -1.5);
    }
    // a glow through the body of the fire that fills it out between the licks
    src._g = (src._g || 0) + dt * heat * (7 + area * 3) * (0.5 + 0.5 * Q);
    while (src._g >= 1) {
      src._g -= 1; at(q); const sz = h * (0.7 + Math.random() * 0.5) * Math.min(1, heat + 0.2) * (src.size ?? 1);
      this.flame(K_BALL, q[0], src.y + 0.2 * h, q[1], wx * 0.1, 1 + Math.random() * 0.8, wz * 0.1, 0.55 + Math.random() * 0.35, sz, sz * 1.35, 1, Math.random() < 0.5 ? 4 : 5, 0.75, 1.6, -0.5);
    }
    // embers
    src._e = (src._e || 0) + dt * heat * 5 * (src.embers ?? 1);
    while (src._e >= 1) { src._e -= 1; at(q); this.flame(K_EMBER, q[0], src.y + h * 0.6, q[1], wx * 0.3 + (Math.random() - 0.5) * 1.6, 2 + Math.random() * 3, wz * 0.3 + (Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 1.6, 0.05, 0.03, 1, 3, 1.2, 0.9, -1.2); }
    // smoke off the top of the flames: thick and black while it's well alight
    const sm = src.smoke ?? heat;
    src._s = (src._s || 0) + dt * sm * (3.4 + area * 1.6) * (src.smokeRate ?? 1) * Q;
    while (src._s >= 1) {
      src._s -= 1; at(q);
      const s0 = (0.6 + Math.random() * 0.5) * Math.max(0.55, Math.sqrt(area) * 0.55), y0 = src.y + h * (heat > 0.05 ? 0.85 : 0.2);
      this.puff(q[0], y0, q[1], wx * 0.15 + (Math.random() - 0.5) * 0.6, 1.3 + Math.random() * 1.2 + heat * 0.9, wz * 0.15 + (Math.random() - 0.5) * 0.6,
        5.5 + Math.random() * 3.5, s0, s0 * (3.5 + Math.random() * 2.5), src.dark ?? 0.05, Math.min(1, heat * 0.9), src.density ?? 0.82, 0, 0.35);
    }
    // (the loudest fire near the camera this frame: audio.js plays the roar of it there)
    if (heat > 0.05) { const cam = this.G.camera.position, d = Math.hypot(src.x - cam.x, src.z - cam.z), k = heat * Math.sqrt(area), sc = k / (1 + d * 0.15); if (d < 90 && sc > (this._loudS || 0)) { this._loudS = sc; this._loud = [src.x, src.y + h * 0.4, src.z, k]; } }
    if (src.light && heat > 0.02) {
      const fl = 0.78 + 0.14 * Math.sin(this.time * 17 + src.x) + 0.08 * Math.sin(this.time * 41 + src.z);
      this.light(src.x, src.y + h * 0.6, src.z, 1, 0.52, 0.16, src.light * Math.min(1, heat) * fl, src.reach || 9 + 6 * Math.sqrt(area));
    }
  }
  // a car's petrol tank going up, or a pump: the white flash, a fireball rolling out and up into a column of black
  // smoke, a ring of dust blown out across the ground, embers raining down. k scales it (1 a car)
  explosion(x, y, z, k = 1) {
    this.build();
    // the flash
    this.flame(K_FLASH, x, y + 0.6, z, 0, 0, 0, 0.22, 7 * k, 13 * k, 1, 6, 3, 0, 0);
    this.flame(K_FLASH, x, y + 1, z, 0, 0, 0, 0.12, 16 * k, 22 * k, 1, 3, 2, 0, 0);
    // the fireball: lobes thrown out and up, which slow, swell and rise as they burn
    const n = Math.round(26 * k);
    for (let j = 0; j < n; j++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * 1.1, sp = rnd(3, 9) * k;
      const vx = Math.cos(a) * Math.cos(el) * sp, vz = Math.sin(a) * Math.cos(el) * sp, vy = Math.sin(el) * sp + rnd(1, 4);
      const s0 = rnd(1.2, 2.2) * k;
      this.flame(K_BALL, x + vx * 0.05, y + 0.5 + Math.random() * 0.6, z + vz * 0.05, vx, vy, vz, rnd(0.8, 1.5), s0, s0 * rnd(2.2, 3.2), 1, 4 + (j % 2), rnd(0.8, 1.4), 2.6, -3);
    }
    // tongues licking up out of it
    for (let j = 0; j < 14 * k; j++) this.flame(K_FLAME, x + rnd(-1.5, 1.5) * k, y + rnd(0, 1), z + rnd(-1.5, 1.5) * k, rnd(-1, 1), rnd(4, 8), rnd(-1, 1), rnd(0.5, 0.9), rnd(1.5, 2.5) * k, rnd(1, 1.6) * k, 1.6, j % 3, 1, 1.5, -2);
    // burning bits flung out, falling in arcs
    for (let j = 0; j < 60 * k; j++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(4, 16);
      this.flame(K_EMBER, x, y + 0.8, z, Math.cos(a) * sp, rnd(3, 13), Math.sin(a) * sp, rnd(1, 2.6), rnd(0.06, 0.14), 0.04, 1, 3, 1.6, 0.3, 9.81);
    }
    // the smoke: a rolling column that the fireball turns into, and a mushroom of it over the top
    const W = U.wind.value;
    for (let j = 0; j < 30 * k; j++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5 * k;
      this.puff(x + Math.cos(a) * r, y + rnd(0.8, 3), z + Math.sin(a) * r, Math.cos(a) * rnd(0.5, 3) + W.x * 0.1, rnd(4, 9), Math.sin(a) * rnd(0.5, 3) + W.y * 0.1,
        rnd(8, 13), rnd(2, 3.5) * k, rnd(6, 10) * k, rnd(0, 0.06), 0.9, 0.95, rnd(0.12, 0.55), 0.7);
    }
    // the blast's ring of dust and grit, low over the ground
    for (let j = 0; j < 16; j++) {
      const a = j / 16 * Math.PI * 2 + Math.random() * 0.3, sp = rnd(9, 15) * k;
      this.puff(x + Math.cos(a), y + 0.25, z + Math.sin(a), Math.cos(a) * sp, rnd(0.3, 1.0), Math.sin(a) * sp, rnd(1.6, 2.6), rnd(0.9, 1.4), rnd(3, 4.5), rnd(0.38, 0.48), 0.1, 0.34, 0, 2.8);
    }
    // the light: a white flash that lights up the street, then the fireball's orange glow
    this.flashes.push({ x, y: y + 1.5, z, t: 0, life: 0.45, i: 9 * k, reach: 40 * k, r: 1, g: 0.9, b: 0.72 });
    this.flashes.push({ x, y: y + 2, z, t: 0, life: 1.8, i: 3.5 * k, reach: 24 * k, r: 1, g: 0.5, b: 0.14 });
  }
  // a firelight for this frame (the four strongest near the camera are used)
  light(x, y, z, r, g, b, i, reach) { this.lights.push([x, y, z, r, g, b, i, reach]); }
  // ------------------------------------------------------------------ per frame
  update(dt) {
    this.time += dt;
    if (!this.built) { this.lightsOut(); return; }
    const cam = this.G.camera.position, W = U.wind.value, wx = W.x, wz = W.y;
    // flames
    const FP = this.fPos.array, FA = this.fAtt.array; let nf = 0;
    for (let i = 0; i < MAXF; i++) {
      if (this.fa[i] >= this.fl[i]) continue;
      this.fa[i] += dt; const t = this.fa[i] / this.fl[i]; if (t >= 1) continue;
      const j = i * 3, dr = Math.exp(-this.fdrag[i] * dt);
      this.fv[j] = (this.fv[j] - wx * 0.15) * dr + wx * 0.15; this.fv[j + 2] = (this.fv[j + 2] - wz * 0.15) * dr + wz * 0.15;
      this.fv[j + 1] = this.fv[j + 1] * dr - this.fgrav[i] * dt;
      this.fp[j] += this.fv[j] * dt; this.fp[j + 1] += this.fv[j + 1] * dt; this.fp[j + 2] += this.fv[j + 2] * dt;
      const k = this.fk[i];
      // embers falling to the ground go out there
      if (k === K_EMBER && this.fgrav[i] > 0 && this.fv[j + 1] < 0) { const g = this.G.tiles.ground(this.fp[j], this.fp[j + 2], this.fp[j + 1] + 1); if (g != null && this.fp[j + 1] < g + 0.05) { this.fa[i] = this.fl[i]; continue; } }
      const sz = this.fs0[i] + (this.fs1[i] - this.fs0[i]) * t, sy = sz * (k === K_FLAME ? this.fst[i] * (0.8 + 0.4 * t) : 1);
      const o = nf * 4;
      // (a tongue's root sits at its particle: the sprite is centred, so lift it by half its height)
      FP[o] = this.fp[j]; FP[o + 1] = this.fp[j + 1] + (k === K_FLAME ? sy * 0.42 : 0); FP[o + 2] = this.fp[j + 2]; FP[o + 3] = t;
      FA[o] = sz; FA[o + 1] = sy; FA[o + 2] = this.fr[i] + (k === K_BALL ? t * this.fr[i] * 3 : 0); FA[o + 3] = k * 16 + this.fc[i] * 2 + this.fb[i];
      nf++;
    }
    this.flames.count = nf; this.flames.visible = nf > 0;
    if (nf) { this.fPos.needsUpdate = true; this.fAtt.needsUpdate = true; this.fPos.clearUpdateRanges?.(); this.fAtt.clearUpdateRanges?.(); this.fPos.addUpdateRange?.(0, nf * 4); this.fAtt.addUpdateRange?.(0, nf * 4); }
    // smoke: rises, slows, spreads, and the wind takes it more the higher it gets
    let ns = 0;
    for (let i = 0; i < MAXS; i++) {
      if (this.sa[i] >= this.sl[i]) continue;
      this.sa[i] += dt; if (this.sa[i] < 0) continue;
      const t = this.sa[i] / this.sl[i]; if (t >= 1) continue;
      const j = i * 3, dr = Math.exp(-this.sdrag[i] * dt), up = Math.min(1, t * 2.5);
      this.sv[j] += ((wx * (0.5 + up * 0.7)) - this.sv[j]) * (1 - dr); this.sv[j + 2] += ((wz * (0.5 + up * 0.7)) - this.sv[j + 2]) * (1 - dr);
      this.sv[j + 1] = Math.max(0.2, this.sv[j + 1] * Math.exp(-0.25 * dt));
      this.sp[j] += this.sv[j] * dt; this.sp[j + 1] += this.sv[j + 1] * dt; this.sp[j + 2] += this.sv[j + 2] * dt;
      this.sg[i] *= Math.exp(-dt * 2.2); this.sr[i] += this.sw[i] * dt;
      const dx = this.sp[j] - cam.x, dy = this.sp[j + 1] - cam.y, dz = this.sp[j + 2] - cam.z;
      this._order[ns] = i; this._depth[i] = dx * dx + dy * dy + dz * dz; ns++;
    }
    if (ns) {
      const ord = this._order.subarray(0, ns), D = this._depth;
      ord.sort((a, b) => D[b] - D[a]);
      const SP = this.sPos.array, SA = this.sAtt.array;
      for (let n = 0; n < ns; n++) {
        const i = ord[n], j = i * 3, o = n * 4, t = this.sa[i] / this.sl[i];
        const e = 1 - (1 - t) * (1 - t);   // (puffs swell fast, then slowly)
        SP[o] = this.sp[j]; SP[o + 1] = this.sp[j + 1]; SP[o + 2] = this.sp[j + 2]; SP[o + 3] = t;
        SA[o] = this.ss0[i] + (this.ss1[i] - this.ss0[i]) * e; SA[o + 1] = this.sr[i]; SA[o + 2] = this.sc[i] + this.sd[i]; SA[o + 3] = this.sden[i] + Math.min(0.999, this.sg[i]);
      }
      this.sPos.needsUpdate = true; this.sAtt.needsUpdate = true;
      this.sPos.clearUpdateRanges?.(); this.sAtt.clearUpdateRanges?.(); this.sPos.addUpdateRange?.(0, ns * 4); this.sAtt.addUpdateRange?.(0, ns * 4);
    }
    this.smoke.count = ns; this.smoke.visible = ns > 0;
    // explosion flashes
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k]; f.t += dt; if (f.t >= f.life) { this.flashes.splice(k, 1); continue; }
      const e = 1 - f.t / f.life; this.light(f.x, f.y, f.z, f.r, f.g, f.b, f.i * e * e, f.reach * (0.7 + 0.3 * e));
    }
    this.applyLights();
    this.loud = this._loud || null; this._loud = null; this._loudS = 0;
  }
  // the four firelights that matter most to the camera: brightest for their distance (a fire is barely brighter by
  // day than the day itself, so the same fire lights much more at night)
  applyLights() {
    const L = this.lights, cam = this.G.camera.position, near = this.near; near.length = 0;
    const day = 0.42 + 0.58 * U.night.value;
    for (const l of L) { const d = Math.hypot(l[0] - cam.x, l[2] - cam.z); if (d < 150 + l[7]) { l[8] = l[6] / (1 + Math.max(0, d - l[7]) * 0.05); near.push(l); } }
    near.sort((a, b) => b[8] - a[8]); if (near.length > NF) near.length = NF;
    for (let i = 0; i < NF; i++) {
      const l = near[i], Lu = U['fireL' + i].value, Cu = U['fireC' + i].value;
      if (l) { Lu.set(l[0], l[1], l[2], l[7]); Cu.set(l[3] * l[6] * day, l[4] * l[6] * day, l[5] * l[6] * day, 0); }
      else { Lu.set(0, -1000, 0, 1); Cu.set(0, 0, 0, 0); }
    }
    U.fireN.value = near.length;
    L.length = 0;
  }
  lightsOut() { if (U.fireN.value) { for (let i = 0; i < NF; i++) U['fireC' + i].value.set(0, 0, 0, 0); U.fireN.value = 0; } this.lights.length = 0; }
}
