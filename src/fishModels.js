// What you see when you go fishing (fishing.js moves it all): the rod (a tapered blank that bends to the line, with
// its rings and reel), the line, the float, the lure, the carp rod's pod and bite alarm, the landing net and the
// unhooking mat, the fish themselves (each species its own shape, colours and scales, and a tail that beats), the
// pegs along the banks and the lily beds, and splashes and rings on the water. Original geometry, drawn in code.
import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...o });

// ---------------------------------------------------------------- fish bodies
// profile: [x along the body 0 snout .. 1 tail root, half-height, half-width] (unit length); fins as outlines in
// the side view (x, y) for the dorsal, anal, pelvic, pectoral and tail; colours for the canvas skin
const FISH = {
  common: { prof: [[0, 0.02, 0.02], [0.06, 0.09, 0.07], [0.18, 0.15, 0.1], [0.36, 0.17, 0.1], [0.55, 0.15, 0.085], [0.75, 0.1, 0.06], [0.9, 0.055, 0.03], [1, 0.045, 0.02]],
    dorsal: [[0.36, 0.16], [0.42, 0.29], [0.48, 0.25], [0.74, 0.12], [0.76, 0.09]], anal: [[0.7, -0.1], [0.74, -0.2], [0.79, -0.16], [0.8, -0.08]], tail: 0.22, fork: 0.35,
    back: '#4a4120', side: '#a8873a', belly: '#e9d7a0', fin: '#7d5a2c', scales: 'full', barbels: true },
  mirror: { prof: [[0, 0.02, 0.02], [0.06, 0.09, 0.07], [0.18, 0.16, 0.105], [0.36, 0.185, 0.11], [0.55, 0.16, 0.09], [0.75, 0.1, 0.06], [0.9, 0.055, 0.03], [1, 0.045, 0.02]],
    dorsal: [[0.36, 0.17], [0.42, 0.3], [0.48, 0.26], [0.74, 0.12], [0.76, 0.09]], anal: [[0.7, -0.1], [0.74, -0.2], [0.79, -0.16], [0.8, -0.08]], tail: 0.22, fork: 0.35,
    back: '#3d3a22', side: '#8f7a3e', belly: '#e3d29e', fin: '#6f5126', scales: 'mirror', barbels: true },
  tench: { prof: [[0, 0.03, 0.03], [0.07, 0.09, 0.075], [0.2, 0.13, 0.1], [0.38, 0.14, 0.1], [0.58, 0.12, 0.08], [0.78, 0.085, 0.05], [0.92, 0.06, 0.03], [1, 0.055, 0.02]],
    dorsal: [[0.4, 0.13], [0.45, 0.25], [0.54, 0.24], [0.6, 0.12]], anal: [[0.62, -0.11], [0.66, -0.2], [0.74, -0.18], [0.76, -0.08]], tail: 0.2, fork: 0.05,
    back: '#2c3a1c', side: '#4f6b2e', belly: '#b9ad62', fin: '#2c3a1e', scales: 'fine', eye: '#c0342a' },
  bream: { prof: [[0, 0.02, 0.015], [0.08, 0.1, 0.045], [0.22, 0.2, 0.06], [0.4, 0.22, 0.06], [0.6, 0.16, 0.05], [0.8, 0.08, 0.03], [0.92, 0.045, 0.02], [1, 0.04, 0.015]],
    dorsal: [[0.42, 0.21], [0.47, 0.34], [0.56, 0.2]], anal: [[0.5, -0.17], [0.55, -0.24], [0.88, -0.07], [0.88, -0.04]], tail: 0.24, fork: 0.45,
    back: '#3e3a26', side: '#9a8550', belly: '#d9cba0', fin: '#4a3f2c', scales: 'full' },
  roach: { prof: [[0, 0.02, 0.015], [0.08, 0.08, 0.05], [0.24, 0.14, 0.07], [0.42, 0.145, 0.07], [0.62, 0.11, 0.055], [0.82, 0.065, 0.03], [0.93, 0.045, 0.02], [1, 0.04, 0.015]],
    dorsal: [[0.42, 0.14], [0.46, 0.27], [0.56, 0.13]], anal: [[0.64, -0.1], [0.67, -0.17], [0.74, -0.08]], tail: 0.22, fork: 0.45,
    back: '#30425a', side: '#c9d2d8', belly: '#f2f2ea', fin: '#c8502c', scales: 'full', eye: '#c3302a' },
  rudd: { prof: [[0, 0.025, 0.015], [0.08, 0.09, 0.05], [0.24, 0.155, 0.07], [0.42, 0.16, 0.07], [0.62, 0.12, 0.055], [0.82, 0.065, 0.03], [0.93, 0.045, 0.02], [1, 0.04, 0.015]],
    dorsal: [[0.5, 0.14], [0.54, 0.26], [0.62, 0.12]], anal: [[0.62, -0.11], [0.65, -0.18], [0.74, -0.08]], tail: 0.22, fork: 0.45,
    back: '#4a4a26', side: '#d2b35a', belly: '#f3ead0', fin: '#d93a22', scales: 'full', eye: '#d9a82a' },
  perch: { prof: [[0, 0.03, 0.02], [0.08, 0.1, 0.06], [0.24, 0.16, 0.085], [0.4, 0.17, 0.085], [0.6, 0.12, 0.065], [0.8, 0.07, 0.035], [0.92, 0.05, 0.02], [1, 0.045, 0.015]],
    dorsal: [[0.24, 0.16], [0.28, 0.32], [0.33, 0.33], [0.46, 0.17], [0.5, 0.16], [0.55, 0.26], [0.66, 0.11]], anal: [[0.64, -0.1], [0.67, -0.18], [0.74, -0.08]], tail: 0.2, fork: 0.3,
    back: '#2e4220', side: '#8a9a4a', belly: '#e8e2bd', fin: '#d4541e', scales: 'bars', spiny: true },
  pike: { prof: [[0, 0.015, 0.02], [0.1, 0.05, 0.06], [0.22, 0.075, 0.07], [0.45, 0.09, 0.07], [0.68, 0.085, 0.06], [0.85, 0.06, 0.04], [0.95, 0.04, 0.02], [1, 0.035, 0.015]],
    dorsal: [[0.72, 0.08], [0.76, 0.17], [0.84, 0.14], [0.86, 0.06]], anal: [[0.73, -0.08], [0.77, -0.16], [0.85, -0.13], [0.87, -0.05]], tail: 0.16, fork: 0.3,
    back: '#22331a', side: '#56703a', belly: '#e6e2c0', fin: '#7a6a32', scales: 'spots' },
};

function fishSkin(f, seed = 1) {
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // v: 0 top of the back .. 0.5 the belly .. 1 back again (round the body); u: snout to tail
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, f.back); grad.addColorStop(0.22, f.side); grad.addColorStop(0.5, f.belly); grad.addColorStop(0.78, f.side); grad.addColorStop(1, f.back);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // a lateral line
  g.strokeStyle = 'rgba(20,20,10,0.25)'; g.lineWidth = 1; for (const y of [0.3, 0.7]) { g.beginPath(); g.moveTo(W * 0.15, H * y); g.quadraticCurveTo(W * 0.5, H * (y + (y < 0.5 ? -0.04 : 0.04)), W, H * y); g.stroke(); }
  if (f.scales === 'full' || f.scales === 'fine') {
    const step = f.scales === 'fine' ? 4 : 7;
    for (let y = 0; y < H; y += step * 0.8) for (let x = W * 0.16; x < W; x += step) {
      g.strokeStyle = `rgba(30,25,10,${f.scales === 'fine' ? 0.12 : 0.22})`; g.beginPath(); g.arc(x + ((y / step) % 2) * step / 2, y, step * 0.55, -1.2, 1.2); g.stroke();
      g.fillStyle = 'rgba(255,250,220,0.06)'; g.fillRect(x, y, 1, 1);
    }
  } else if (f.scales === 'mirror') {
    // a few big plates along the back and the lateral line, scattered and uneven
    for (let i = 0; i < 26; i++) {
      const x = W * (0.2 + rnd() * 0.75), y = H * (rnd() < 0.5 ? 0.08 + rnd() * 0.22 : 0.7 + rnd() * 0.22), r = 4 + rnd() * 7;
      g.fillStyle = `rgba(${150 + rnd() * 60},${120 + rnd() * 50},${50 + rnd() * 30},0.85)`; g.beginPath(); g.ellipse(x, y, r * 1.2, r, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(30,25,10,0.45)'; g.stroke();
    }
  } else if (f.scales === 'bars') {
    for (let i = 0; i < 6; i++) { const x = W * (0.25 + i * 0.12); g.fillStyle = 'rgba(15,25,8,0.55)'; g.fillRect(x, 0, 7, H * 0.36); g.fillRect(x, H * 0.64, 7, H * 0.36); }
  } else if (f.scales === 'spots') {
    for (let i = 0; i < 90; i++) { const x = W * (0.15 + rnd() * 0.85), y = H * (rnd() < 0.5 ? 0.05 + rnd() * 0.33 : 0.62 + rnd() * 0.33); g.fillStyle = 'rgba(225,220,150,0.7)'; g.beginPath(); g.ellipse(x, y, 3.5, 1.8, 0, 0, 7); g.fill(); }
  }
  // the head darker and smooth, a gill cover
  const hg = g.createLinearGradient(0, 0, W * 0.2, 0); hg.addColorStop(0, 'rgba(20,15,5,0.35)'); hg.addColorStop(1, 'rgba(20,15,5,0)'); g.fillStyle = hg; g.fillRect(0, 0, W * 0.2, H);
  g.strokeStyle = 'rgba(20,15,5,0.4)'; g.lineWidth = 2; for (const y of [0.25, 0.75]) { g.beginPath(); g.arc(W * 0.17, H * y, H * 0.16, Math.PI * 0.6, Math.PI * 1.4); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a fish one metre long: a skinned body (three bones down the spine for the tail beat) with fins and eyes
export function makeFish(species, seed = 1) {
  const f = FISH[species] || FISH.common, N = 28, M = 14;
  const at = x => { const P = f.prof; for (let i = 0; i < P.length - 1; i++) if (x <= P[i + 1][0]) { const t = (x - P[i][0]) / (P[i + 1][0] - P[i][0]), s = t * t * (3 - 2 * t); return [P[i][1] + (P[i + 1][1] - P[i][1]) * s, P[i][2] + (P[i + 1][2] - P[i][2]) * s]; } return [P[P.length - 1][1], P[P.length - 1][2]]; };
  const pos = [], uv = [], idx = [], skI = [], skW = [];
  const bone = x => { const b = x * 3; const i = Math.min(2, Math.floor(b)), t = b - i; return [i, Math.min(3, i + 1), 1 - t, t]; };
  const push = (x, y, z, u, v) => { pos.push(0.5 - x, y, z); uv.push(u, v); const [i, j, wi, wj] = bone(x); skI.push(i, j, 0, 0); skW.push(wi, wj, 0, 0); };
  for (let i = 0; i <= N; i++) {
    const x = i / N, [h, w] = at(x);
    for (let k = 0; k <= M; k++) { const a = k / M * Math.PI * 2; push(x, Math.cos(a) * h, Math.sin(a) * w, x, k / M); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) { const a = i * (M + 1) + k, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4)); body.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
  body.setIndex(idx); body.computeVertexNormals();
  // fins: flat, both sides, skinned to the spine where they sit
  const fpos = [], fidx = [], fI = [], fW = [];
  const fin = (pts, zOff = 0, rotX = 0) => {
    const base = fpos.length / 3, cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const all = [[cx, cy], ...pts];
    for (const [x, y] of all) { const yy = y * Math.cos(rotX), zz = zOff + y * Math.sin(rotX); fpos.push(0.5 - x, yy, zz); const [i, j, wi, wj] = bone(Math.min(1, x)); fI.push(i, j, 0, 0); fW.push(wi, wj, 0, 0); }
    for (let k = 1; k < all.length - 1; k++) fidx.push(base, base + k, base + k + 1);
  };
  fin(f.dorsal); fin(f.anal);
  // tail: a forked fan behind the tail root
  const T = f.tail, fk = f.fork; fin([[1, 0.04], [1 + T * 0.75, T * 0.75], [1 + T * (1 - fk * 0.6), 0], [1 + T * 0.75, -T * 0.75], [1, -0.04]]);
  // pelvic and pectoral pairs, angled out
  const pv = species === 'pike' ? 0.55 : 0.42, pc = 0.16;
  for (const s of [1, -1]) { fin([[pv, -0.08], [pv + 0.1, -0.16], [pv + 0.08, -0.07]], s * 0.05, s * 0.5); fin([[pc, -0.07], [pc + 0.11, -0.13], [pc + 0.08, -0.05]], s * 0.07, s * 0.7); }
  const fins = new THREE.BufferGeometry();
  fins.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); fins.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(fI, 4)); fins.setAttribute('skinWeight', new THREE.Float32BufferAttribute(fW, 4));
  fins.setIndex(fidx); fins.computeVertexNormals();
  // the skeleton: four bones from the head back
  const bones = [0, 1, 2, 3].map(() => new THREE.Bone());
  bones[0].position.set(0.5, 0, 0); for (let i = 1; i < 4; i++) { bones[i].position.set(-1 / 3, 0, 0); bones[i - 1].add(bones[i]); }
  const skel = new THREE.Skeleton(bones);
  const skin = fishSkin(f, seed);
  const bm = std({ map: skin, roughness: 0.35, metalness: 0.05 }), fm = std({ color: f.fin, roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
  const g = new THREE.Group(), root = new THREE.Group();
  const mb = new THREE.SkinnedMesh(body, bm), mf = new THREE.SkinnedMesh(fins, fm);
  root.add(bones[0]); mb.bind(skel); mf.bind(skel); mb.frustumCulled = mf.frustumCulled = false;
  g.add(root, mb, mf);
  // eyes and barbels (rigid, on the head)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), std({ color: f.eye || '#d8c070', roughness: 0.2 })), pupil = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), std({ color: '#050505', roughness: 0.1 }));
  for (const s of [1, -1]) { const e = eye.clone(), p = pupil.clone(); const [h, w] = at(0.07); e.position.set(0.5 - 0.07, h * 0.35, s * w * 0.85); p.position.copy(e.position).add(new THREE.Vector3(0.004, 0, s * 0.011)); bones[0].add(e, p); }
  if (f.barbels) for (const s of [1, -1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.002, 0.05, 4), std({ color: f.side })); b.position.set(0.5 - 0.01, -0.015, s * 0.012); b.rotation.z = 1.2; bones[0].add(b); }
  g.userData = { bones, wag: (t, amp) => { for (let i = 1; i < 4; i++) bones[i].rotation.y = Math.sin(t - i * 0.9) * amp * (0.35 + i * 0.3); bones[0].rotation.y = -Math.sin(t) * amp * 0.12; } };
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

// ---------------------------------------------------------------- the gear
export class FishGear {
  constructor(G) {
    this.G = G; this.root = new THREE.Group(); this.root.name = 'fishing'; G.scene.add(this.root);
    this.mat = {
      blank: std({ color: 0x15171a, roughness: 0.35, metalness: 0.2 }), cork: std({ color: 0x1a1a1a, roughness: 0.9 }),
      ring: std({ color: 0xb0b4b8, metalness: 0.9, roughness: 0.25 }), reel: std({ color: 0x23272c, metalness: 0.5, roughness: 0.35 }),
      spool: std({ color: 0x8a8f96, metalness: 0.85, roughness: 0.25 }), floatRed: std({ color: 0xff3a10, emissive: 0x5a1000, roughness: 0.4 }),
      floatBody: std({ color: 0x2d3a26, roughness: 0.5 }), steel: std({ color: 0x6d7378, metalness: 0.8, roughness: 0.3 }),
      alarm: std({ color: 0x18191c, roughness: 0.5 }), led: std({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0 }),
      net: new THREE.MeshStandardMaterial({ color: 0x1c2a1c, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      mat: std({ color: 0x2f4a2a, roughness: 0.9 }), post: std({ color: 0x5b4126, roughness: 0.95 }), plate: std({ color: 0xf2f0e6, roughness: 0.8 }),
      lure: std({ color: 0xd9d4c0, metalness: 0.9, roughness: 0.15 }), shad: std({ color: 0xe9e0d0, roughness: 0.5 }),
    };
    // the rod: a tube re-shaped every frame along its bend (rings of RS sides), the handle a fatter part of it
    this.RN = 22; this.RS = 7;
    const rg = new THREE.BufferGeometry(); this.rodPos = new Float32Array((this.RN + 1) * this.RS * 3);
    rg.setAttribute('position', new THREE.BufferAttribute(this.rodPos, 3));
    const ri = []; for (let i = 0; i < this.RN; i++) for (let k = 0; k < this.RS; k++) { const a = i * this.RS + k, b = i * this.RS + (k + 1) % this.RS, c = a + this.RS, d = b + this.RS; ri.push(a, c, b, b, c, d); }
    rg.setIndex(ri); this.rodGeo = rg;
    this.rod = new THREE.Mesh(rg, this.mat.blank); this.rod.frustumCulled = false; this.rod.castShadow = true;
    this.rings = [0, 1, 2, 3, 4, 5].map(i => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.012 - i * 0.0014, 0.0012, 4, 10), this.mat.ring); this.root.add(m); return m; });
    // the reel: body, spool, handle
    const reel = this.reel = new THREE.Group();
    const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 14), this.mat.reel); rb.rotation.x = Math.PI / 2;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.032, 14), this.mat.spool); sp.rotation.x = Math.PI / 2; sp.position.z = 0.04;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.07, 0.012), this.mat.reel); stem.position.y = 0.045;
    this.crank = new THREE.Group(); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.006), this.mat.reel); arm.position.y = 0.03; const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.025, 8), this.mat.cork); knob.rotation.z = Math.PI / 2; knob.position.set(-0.014, 0.06, 0); this.crank.add(arm, knob); this.crank.position.x = -0.03;
    reel.add(rb, sp, stem, this.crank);
    this.root.add(this.rod, reel);
    // the line
    this.LN = 48; this.linePos = new Float32Array(this.LN * 3);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3)); lg.setDrawRange(0, 0);
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd8f070, transparent: true, opacity: 0.85 })); this.line.frustumCulled = false; this.root.add(this.line);
    // the float: a waggler (olive body, bright tip)
    const fl = this.float = new THREE.Group();
    const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.004, 0.2, 8), this.mat.floatBody); fb.position.y = -0.1;
    const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 8), this.mat.floatRed); ft.position.y = 0.025;
    const fball = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), this.mat.floatBody); fball.position.y = -0.17;
    fl.add(fb, ft, fball); fl.visible = false; this.root.add(fl);
    // lures: a spinner (blade and body) and a soft shad
    const sp2 = this.spinner = new THREE.Group(); const blade = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.mat.lure); blade.scale.set(1, 0.25, 0.6); blade.position.x = 0.02; const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.035, 6), this.mat.lure); sb.rotation.z = Math.PI / 2; sp2.add(blade, sb); sp2.userData.blade = blade;
    const sh = this.shad = new THREE.Group(); const shb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), this.mat.shad); shb.scale.set(3, 1, 0.8); const sht = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), this.mat.shad); sht.position.x = -0.07; sht.rotation.y = Math.PI / 2; sh.add(shb, sht);
    sp2.visible = sh.visible = false; this.root.add(sp2, sh);
    // the carp rod's pod: two bank sticks with a buzz bar, the bite alarm and a hanger on the line
    const pod = this.pod = new THREE.Group();
    for (const z of [0, 0.9]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), this.mat.steel); st.position.set(z, 0.25, 0); pod.add(st); }
    const al = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.04), this.mat.alarm); al.position.set(0.9, 0.52, 0); pod.add(al);
    const led = this.led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), this.mat.led); led.position.set(0.86, 0.54, 0.022); pod.add(led);
    const rest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.05), this.mat.alarm); rest.position.set(0, 0.5, 0); pod.add(rest);
    this.hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 10), new THREE.MeshStandardMaterial({ color: 0xff2a10, emissive: 0x401000, roughness: 0.4 }));
    pod.add(this.hanger); pod.visible = false; this.root.add(pod);
    // the landing net: a pole, two arms and the mesh
    const net = this.net = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2, 8), this.mat.blank); pole.rotation.z = Math.PI / 2; pole.position.x = -1; net.add(pole);
    for (const s of [1, -1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1.1, 6), this.mat.blank); arm.position.set(0.48, 0, s * 0.28); arm.rotation.z = Math.PI / 2; arm.rotation.y = s * 0.55; net.add(arm); }
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.55, 12, 1, true), this.mat.net); mesh.rotation.z = Math.PI; mesh.position.set(0.55, -0.28, 0); mesh.scale.set(1, 1, 1.1); net.add(mesh);
    net.visible = false; this.root.add(net);
    // the unhooking mat
    this.matMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.6), this.mat.mat); this.matMesh.visible = false; this.root.add(this.matMesh);
    // the fish on the line (built per species as needed)
    this.fishCache = new Map(); this.fishObj = null;
    // splashes: rings on the water and spray
    this.rings2 = []; const rgm = new THREE.RingGeometry(0.9, 1, 32); rgm.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(rgm, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m.renderOrder = 3; this.root.add(m); this.rings2.push({ m, t: 9, life: 1, size: 1 }); }
    this.drops = []; const dg = new THREE.SphereGeometry(0.02, 5, 4), dm = new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(dg, dm); m.visible = false; this.root.add(m); this.drops.push({ m, v: new THREE.Vector3(), t: 9 }); }
    // the cast's target on the water (green over water, red if it would land on a bank or an island)
    const tg = new THREE.RingGeometry(0.55, 0.75, 28); tg.rotateX(-Math.PI / 2);
    this.target = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0x8dff7a, transparent: true, opacity: 0.75, depthWrite: false })); this.target.renderOrder = 4; this.target.visible = false; this.root.add(this.target);
    this.pegsBuilt = new Set(); this.liliesBuilt = new Set();
    this.hide();
  }
  hide() { for (const o of [this.rod, this.reel, this.line, this.float, this.spinner, this.shad, this.pod, this.net, this.matMesh, this.target]) o.visible = false; for (const r of this.rings) r.visible = false; if (this.fishObj) this.fishObj.visible = false; }
  // ---------------------------------------------------------------- the rod
  // butt: the end of the handle; dir: along the rod unbent; bend (0..1.6): how far the tip comes round; bendDir: the
  // way it's pulled. Returns the tip.
  setRod(butt, dir, bendDir, bend, kind, spin = 0) {
    const L = kind === 'lure' ? 2.2 : kind === 'carp' ? 3.66 : 3.9;
    this.rod.visible = this.reel.visible = true;
    // the bent rod: a curve whose tip is pulled round towards bendDir, more at the tip than the butt
    const P = this._pts ||= Array.from({ length: this.RN + 1 }, () => new THREE.Vector3()), side = _a.copy(bendDir).addScaledVector(dir, -bendDir.dot(dir));
    if (side.lengthSq() < 1e-6) side.copy(UP).multiplyScalar(-1);
    side.normalize();
    const b = Math.min(1.6, bend);
    for (let i = 0; i <= this.RN; i++) {
      const t = i / this.RN, s = t * L, ang = b * t * t * 1.25;   // the curve tightens towards the tip
      P[i].copy(butt).addScaledVector(dir, s * Math.cos(ang * 0.6)).addScaledVector(side, s * Math.sin(ang * 0.6) * 0.75);
    }
    // rings round each point, tapering (the handle part thicker)
    const hand = kind === 'lure' ? 0.36 : 0.62;
    for (let i = 0; i <= this.RN; i++) {
      const t = i / this.RN, s = t * L, r = s < hand ? 0.0125 : 0.0085 * (1 - t) + 0.0018;
      const T = i < this.RN ? _b.subVectors(P[i + 1], P[i]) : _b.subVectors(P[i], P[i - 1]); T.normalize();
      const n1 = _c.crossVectors(T, UP); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize(); const n2 = _d.crossVectors(T, n1).normalize();
      for (let k = 0; k < this.RS; k++) { const a = k / this.RS * Math.PI * 2, o = (i * this.RS + k) * 3; this.rodPos[o] = P[i].x + (n1.x * Math.cos(a) + n2.x * Math.sin(a)) * r; this.rodPos[o + 1] = P[i].y + (n1.y * Math.cos(a) + n2.y * Math.sin(a)) * r; this.rodPos[o + 2] = P[i].z + (n1.z * Math.cos(a) + n2.z * Math.sin(a)) * r; }
    }
    this.rodGeo.attributes.position.needsUpdate = true; this.rodGeo.computeVertexNormals(); this.rodGeo.computeBoundingSphere();
    // the rings along the underside, the reel under the handle
    const ringAt = [0.32, 0.45, 0.58, 0.7, 0.82, 0.93];
    this.rings.forEach((m, k) => { m.visible = true; const i = Math.round(ringAt[k] * this.RN); const T = _b.subVectors(P[Math.min(this.RN, i + 1)], P[Math.max(0, i - 1)]).normalize(); m.position.copy(P[i]).addScaledVector(_c.crossVectors(T, _d.crossVectors(UP, T).normalize()).normalize(), -0.016); m.quaternion.setFromUnitVectors(_d.set(0, 0, 1), T); });
    const ri = Math.round((kind === 'lure' ? 0.18 : 0.34) / L * this.RN), RT = _b.subVectors(P[ri + 1], P[ri]).normalize();
    const down = _c.crossVectors(RT, _d.crossVectors(UP, RT).normalize()).normalize();
    this.reel.position.copy(P[ri]).addScaledVector(down, -0.075);
    _m.lookAt(_a.set(0, 0, 0), RT.clone().negate(), down.clone().negate()); this.reel.quaternion.setFromRotationMatrix(_m);
    this.crank.rotation.z = spin;
    this.tip = P[this.RN]; this.rodPts = P; this.rodLen = L;
    return P[this.RN];
  }
  // a point along the rod (metres from the butt), for the hands
  along(s) { const P = this.rodPts; if (!P) return null; const t = Math.max(0, Math.min(1, s / this.rodLen)) * this.RN, i = Math.min(this.RN - 1, Math.floor(t)); return _a.copy(P[i]).lerp(P[i + 1], t - i).clone(); }
  reelHandle() { return this.crank.children[1].getWorldPosition(new THREE.Vector3()); }
  // ---------------------------------------------------------------- the line: a polyline through the given points (sagging where slack)
  setLine(pts) {
    const n = Math.min(this.LN, pts.length); for (let i = 0; i < n; i++) { this.linePos[i * 3] = pts[i].x; this.linePos[i * 3 + 1] = pts[i].y; this.linePos[i * 3 + 2] = pts[i].z; }
    this.line.geometry.setDrawRange(0, n); this.line.geometry.attributes.position.needsUpdate = true; this.line.visible = n > 1;
  }
  setFloat(p, tipAbove = 0.04, tilt = 0) { const f = this.float; f.visible = !!p; if (!p) return; f.position.set(p.x, p.y + tipAbove - 0.05, p.z); f.rotation.z = tilt; }
  setLure(kind, p, heading = 0, t = 0) {
    this.spinner.visible = kind === 'spinner' && !!p; this.shad.visible = kind === 'shad' && !!p; if (!p) return;
    const o = kind === 'spinner' ? this.spinner : this.shad; o.position.copy(p); o.rotation.y = -heading;
    if (kind === 'spinner') o.userData.blade.rotation.x = t * 30; else o.rotation.z = Math.sin(t * 9) * 0.25;
  }
  setPod(p, heading, alarm = 0, hangerUp = 0) {
    const pd = this.pod; pd.visible = !!p; if (!p) return;
    pd.position.copy(p); pd.rotation.y = -heading;
    this.mat.led.emissiveIntensity = alarm * 4;
    this.hanger.position.set(0.55, 0.3 + hangerUp * 0.22, 0);
  }
  setNet(p, dir, dip = 0) {
    const n = this.net; n.visible = !!p; if (!p) return;
    n.position.copy(p); n.rotation.set(0, -Math.atan2(dir.z, dir.x), -0.15 - dip * 0.45);
  }
  setTarget(p, wet = true) { const t = this.target; t.visible = !!p; if (!p) return; t.position.set(p.x, p.y + 0.03, p.z); t.material.color.setHex(wet ? 0x8dff7a : 0xff5a3a); t.scale.setScalar(1 + Math.hypot(p.x, p.z) * 0); }
  setMat(p, heading) { this.matMesh.visible = !!p; if (p) { this.matMesh.position.copy(p); this.matMesh.rotation.y = -heading; } }
  // ---------------------------------------------------------------- the fish
  showFish(s, lengthM, p, heading, roll = 0, t = 0, amp = 0.3, pitch = 0) {
    if (!s) { if (this.fishObj) this.fishObj.visible = false; return; }
    let f = this.fishCache.get(s); if (!f) { f = makeFish(s, s.length * 7 + 3); this.fishCache.set(s, f); this.root.add(f); }
    if (this.fishObj && this.fishObj !== f) this.fishObj.visible = false;
    this.fishObj = f; f.visible = true; f.scale.setScalar(lengthM);
    f.position.copy(p); f.rotation.set(roll, -heading, pitch, 'YXZ'); f.rotation.order = 'YZX'; f.rotation.y = -heading; f.rotation.x = roll; f.rotation.z = pitch;
    f.userData.wag(t, amp);
  }
  // ---------------------------------------------------------------- splashes
  splash(x, y, z, mag = 1) {
    for (let k = 0; k < (mag > 0.6 ? 3 : 1); k++) { const r = this.rings2.find(q => q.t >= q.life) || this.rings2[0]; r.t = -k * 0.18; r.life = 1.1 + mag * 0.8; r.size = 0.25 + mag * 1.3; r.m.position.set(x, y + 0.01, z); }
    const n = Math.round(4 + mag * 14);
    for (let k = 0; k < n; k++) { const d = this.drops.find(q => q.t > 1.2) || this.drops[k % this.drops.length]; d.t = 0; d.m.position.set(x, y + 0.02, z); const a = Math.random() * 6.28, s = (0.4 + Math.random()) * (0.6 + mag * 1.6); d.v.set(Math.cos(a) * s * 0.5, (1 + Math.random()) * (1 + mag * 2), Math.sin(a) * s * 0.5); d.m.scale.setScalar(0.6 + mag); }
  }
  ring(x, y, z, size = 0.3) { const r = this.rings2.find(q => q.t >= q.life); if (!r) return; r.t = 0; r.life = 1.2; r.size = size; r.m.position.set(x, y + 0.01, z); }
  update(dt) {
    for (const r of this.rings2) { if (r.t >= r.life) { r.m.visible = false; continue; } r.t += dt; if (r.t < 0) { r.m.visible = false; continue; } const k = r.t / r.life; r.m.visible = true; r.m.scale.setScalar(r.size * (0.3 + k * 1.4)); r.m.material.opacity = 0.55 * (1 - k); }
    for (const d of this.drops) { if (d.t > 1.2) { d.m.visible = false; continue; } d.t += dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.visible = d.t < 1.2 && d.v.y > -6; }
  }
  // ---------------------------------------------------------------- pegs and lily beds of a lake (built once)
  pegs(lake, groundAt) {
    if (this.pegsBuilt.has(lake.id)) return; this.pegsBuilt.add(lake.id);
    const n = lake.pegs.length, post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), this.mat.post, n), cap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.12, 0.03), this.mat.plate, n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    lake.pegs.forEach((p, i) => {
      const g = groundAt(p.x, p.z) ?? p.g; Q.setFromAxisAngle(UP, -p.heading + Math.PI / 2);
      M.compose(new THREE.Vector3(p.x - Math.cos(p.heading) * 1.4, g + 0.45, p.z - Math.sin(p.heading) * 1.4), Q, new THREE.Vector3(1, 1, 1)); post.setMatrixAt(i, M);
      M.compose(new THREE.Vector3(p.x - Math.cos(p.heading) * 1.35, g + 0.82, p.z - Math.sin(p.heading) * 1.35), Q, new THREE.Vector3(1, 1, 1)); cap.setMatrixAt(i, M);
    });
    post.castShadow = true; this.G.scene.add(post, cap);
  }
  lilies(lake) {
    if (this.liliesBuilt.has(lake.id)) return; this.liliesBuilt.add(lake.id);
    // pads: discs with a notch cut, flat on the water; a few flowers
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.absarc(0, 0, 1, 0.2, Math.PI * 2 - 0.05, false); shape.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(shape, 12); geo.rotateX(-Math.PI / 2);
    const pads = []; let s = lake.id.length * 97 + 5; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const L of lake.lilies) for (let k = 0; k < Math.round(L.r * L.r * 1.6); k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * L.r; const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r; if (!lake.wet(x, z)) continue; pads.push([x, z, 0.12 + rnd() * 0.16, rnd() * 6.28, rnd()]); }
    const im = new THREE.InstancedMesh(geo, std({ color: 0x3f6e2a, roughness: 0.55, side: THREE.DoubleSide }), pads.length);
    const fl = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.05, 6), std({ color: 0xfafaf0, emissive: 0x202010, roughness: 0.5 }), pads.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(); let nf = 0;
    pads.forEach(([x, z, r, a, f], i) => { Q.setFromAxisAngle(UP, a); M.compose(new THREE.Vector3(x, lake.level + 0.012, z), Q, new THREE.Vector3(r, 1, r)); im.setMatrixAt(i, M); if (f < 0.1) { M.compose(new THREE.Vector3(x + 0.03, lake.level + 0.04, z), Q, new THREE.Vector3(1, 1, 1)); fl.setMatrixAt(nf++, M); } });
    fl.count = nf; im.receiveShadow = true; this.G.scene.add(im, fl);
  }
}
