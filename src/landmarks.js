// Hand-authored landmarks placed on their OSM footprints (dimensions estimated; see
// docs/COVERAGE.md), canopies (rain shelter) and street furniture: bus stops and shelters.
import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, float, fract, step, mix, max, positionWorld, normalWorld } from 'three/tsl';
import { mergeGeos } from './tiles.js';
import { U } from './env.js';
import { lightPool } from './materials.js';

const stoneMat = () => { const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 }); const u = uv(); const course = step(0.94, fract(u.y.div(0.45))).mul(0.12); m.colorNode = vec3(0.74, 0.66, 0.5).mul(float(1).sub(course)).mul(mix(float(1), float(0.78), U.wet)); m.emissiveNode = lightPool(positionWorld).mul(vec3(0.7, 0.62, 0.5)); return m; };
const brickMat = () => { const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }); const u = uv(); const band = step(0.82, fract(u.y.div(1.6))); const bx = fract(u.x.div(0.225).add(step(0.5, fract(u.y.div(0.15))).mul(0.5))), by = fract(u.y.div(0.075)); const mortar = max(step(0.93, bx), step(0.85, by)).mul(0.25); m.colorNode = mix(vec3(0.5, 0.16, 0.1), vec3(0.78, 0.6, 0.42), band).mul(float(1).sub(mortar)).mul(mix(float(1), float(0.8), U.wet)); m.emissiveNode = lightPool(positionWorld).mul(vec3(0.5, 0.2, 0.15)); return m; };

function box(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); }
function obb(ring) {
  // longest-edge-aligned bounding box
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    const a = Math.atan2(z1 - z0, x1 - x0), c = Math.cos(a), s = Math.sin(a);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of ring) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a, L: u1 - u0, W: v1 - v0, cx: ((u0 + u1) / 2) * c - ((v0 + v1) / 2) * s, cz: ((u0 + u1) / 2) * s + ((v0 + v1) / 2) * c };
  }
  if (best.L < best.W) { [best.L, best.W] = [best.W, best.L]; best.a += Math.PI / 2; }
  return best;
}

export class Landmarks {
  constructor(G) {
    this.G = G; this.built = new Map();
    this.stone = stoneMat(); this.brick = brickMat();
    this.slate = new THREE.MeshStandardNodeMaterial({ color: 0x2d3036, roughness: 0.6 });
    this.dark = new THREE.MeshStandardNodeMaterial({ color: 0x141618, roughness: 0.4 });
    this.glass = new THREE.MeshStandardNodeMaterial({ color: 0x8aa3b0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 });
    this.metal = new THREE.MeshStandardNodeMaterial({ color: 0x3b4046, roughness: 0.5, metalness: 0.5 });
    this.canopyMat = new THREE.MeshStandardNodeMaterial({ color: 0x5a6068, roughness: 0.55 });
    G.tiles.listeners.push((ev, t) => { if (ev === 'load') this.onTile(t); });
    // canopies (manifest) — rain shelter + geometry
    G.canopies = (G.manifest.canopies || []).map(([x0, z0, x1, z1, d, h, kind]) => {
      const l = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0), lx = Math.sin(a), lz = -Math.cos(a);
      return { x: (x0 + x1) / 2 + lx * d / 2, z: (z0 + z1) / 2 + lz * d / 2, h: a, l, w: d, hh: h, kind, y: null, x0, z0, built: false };
    });
    // bus stops: all get a flag pole; tagged shelters get a shelter (also a rain shelter)
    for (const [x, z, name, shelter] of G.net.busStops) if (shelter) G.canopies.push({ x, z, h: 0, l: 3.2, w: 1.4, hh: 2.4, kind: 2, y: null, built: false, bus: true });
    this.group = new THREE.Group(); G.scene.add(this.group);
    this.poles = new THREE.InstancedMesh(mergeGeos([new THREE.CylinderGeometry(0.04, 0.04, 2.7, 6).translate(0, 1.35, 0).toNonIndexed(), box(0.45, 0.45, 0.04, 0, 2.55, 0)]), new THREE.MeshStandardNodeMaterial({ color: 0xd02020, roughness: 0.6 }), G.net.busStops.length);
    this.poles.count = 0; this.group.add(this.poles);
  }
  onTile(t) {
    const G = this.G;
    for (const lm of t.data.buildings.landmarks || []) {
      if (this.built.has(lm.name)) continue;
      const obj = lm.name === 'Cemetery Arch' ? this.cemeteryArch(lm) : lm.name === 'Reading Town Hall' ? this.townHall(lm) : null;
      if (obj) { this.group.add(obj); this.built.set(lm.name, obj); }
    }
    // canopies and bus stop poles inside this tile once its ground is known
    const ox = t.data.ox, oz = t.data.oz;
    for (const c of G.canopies) {
      if (c.built || c.x < ox || c.x >= ox + 256 || c.z < oz || c.z >= oz + 256) continue;
      const g = G.tiles.terrain(c.x, c.z); if (g == null) continue;
      c.y = g + 0.17 + c.hh; c.built = true;
      this.group.add(this.canopy(c));
    }
    if (t.lod === 0) this.placePoles();
  }
  placePoles() {
    const G = this.G, m = new THREE.Matrix4(); let n = 0;
    for (const [x, z] of G.net.busStops) {
      const g = G.tiles.terrain(x, z); if (g == null) continue;
      m.makeTranslation(x, g + 0.17, z); this.poles.setMatrixAt(n++, m);
    }
    this.poles.count = n; this.poles.instanceMatrix.needsUpdate = true;
  }
  canopy(c) {
    const grp = new THREE.Group();
    grp.position.set(c.x, c.y, c.z); grp.rotation.y = -c.h;
    if (c.bus) {
      grp.add(new THREE.Mesh(box(c.l, 0.08, c.w, 0, 0, 0), this.metal));
      grp.add(new THREE.Mesh(mergeGeos([box(c.l, 2.2, 0.03, 0, -1.15, -c.w / 2), box(0.03, 2.2, c.w, -c.l / 2, -1.15, 0), box(0.03, 2.2, c.w, c.l / 2, -1.15, 0)]), this.glass));
      grp.add(new THREE.Mesh(mergeGeos([box(c.l - 0.4, 0.06, 0.35, 0, -1.9, -c.w / 2 + 0.25)]), this.metal));
    } else {
      grp.add(new THREE.Mesh(box(c.l, 0.22, c.w, 0, 0, 0), this.canopyMat));
      grp.add(new THREE.Mesh(box(c.l, 0.45, 0.06, 0, -0.1, c.w / 2), this.canopyMat)); // fascia on the open side
      const posts = [];
      if (c.kind === 0) for (let u = -c.l / 2 + 0.3; u <= c.l / 2 - 0.2; u += Math.max(3, c.l / Math.max(1, Math.round(c.l / 4)))) posts.push(box(0.12, c.hh, 0.12, u, -c.hh / 2, c.w / 2 - 0.15));
      else for (const u of [-c.l / 2 + 0.3, c.l / 2 - 0.3]) for (const v of [-c.w / 2 + 0.3, c.w / 2 - 0.3]) posts.push(box(0.2, c.hh, 0.2, u, -c.hh / 2, v));
      if (posts.length) grp.add(new THREE.Mesh(mergeGeos(posts), this.metal));
    }
    grp.traverse(o => { o.castShadow = this.G.renderer.shadowMap.enabled; o.receiveShadow = true; });
    return grp;
  }
  // Cemetery Junction gateway (1843): Bath-stone carriage arch with flanking lodge bays,
  // reference-modelled on the OSM footprint (13.3 x 7.0 m); heights estimated.
  cemeteryArch(lm) {
    const b = obb(lm.ring), G = this.G, grp = new THREE.Group();
    const base = lm.base - 0.3;
    grp.position.set(b.cx, base, b.cz); grp.rotation.y = -b.a;
    const L = b.L, W = b.W, archW = 4.2, archH = 5.6, cw = 6.4, sideW = (L - cw) / 2;
    const parts = [];
    // central block with a round-headed carriage arch (extruded shape seen along the width axis)
    const sh = new THREE.Shape();
    sh.moveTo(-cw / 2, 0); sh.lineTo(-archW / 2, 0); sh.lineTo(-archW / 2, archH - archW / 2); sh.absarc(0, archH - archW / 2, archW / 2, Math.PI, 0, true); sh.lineTo(archW / 2, 0); sh.lineTo(cw / 2, 0); sh.lineTo(cw / 2, 8.0); sh.lineTo(-cw / 2, 8.0); sh.closePath();
    const arch = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -W / 2).toNonIndexed();
    parts.push(arch);
    parts.push(box(cw + 0.6, 0.5, W + 0.5, 0, 8.25, 0));                        // cornice
    parts.push(box(cw - 0.8, 1.2, W - 0.6, 0, 9.1, 0));                         // attic
    for (const s of [-1, 1]) {
      parts.push(box(0.7, 7.2, 0.5, s * (archW / 2 + 0.6), 3.6, W / 2 + 0.05)); // pilasters
      parts.push(box(0.7, 7.2, 0.5, s * (archW / 2 + 0.6), 3.6, -W / 2 - 0.05));
      // lodge bays
      parts.push(box(sideW, 5.0, W - 0.4, s * (cw / 2 + sideW / 2), 2.5, 0));
      parts.push(box(sideW + 0.3, 0.35, W - 0.1, s * (cw / 2 + sideW / 2), 5.15, 0));
    }
    const g = mergeGeos(parts);
    // planar uv for stone courses
    const p = g.attributes.position, uvA = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uvA[i * 2] = p.getX(i) + p.getZ(i); uvA[i * 2 + 1] = p.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.stone); mesh.castShadow = mesh.receiveShadow = G.renderer.shadowMap.enabled;
    grp.add(mesh);
    // dark windows and doors in the lodges
    const win = [];
    for (const s of [-1, 1]) for (const f of [-1, 1]) win.push(box(1.0, 1.6, 0.06, s * (cw / 2 + sideW / 2), 2.6, f * (W / 2 - 0.17)));
    grp.add(new THREE.Mesh(mergeGeos(win), this.dark));
    // the arch is walkable/drivable: collision only on the side bays
    lm.hand = true;
    return grp;
  }
  // Reading Town Hall (Waterhouse, 1875): polychrome brick on the OSM footprint, steep slate
  // roof and clock tower over Town Hall Square. Tower height estimated (~32 m).
  townHall(lm) {
    const G = this.G, grp = new THREE.Group();
    const ring = lm.ring, base = lm.base - 0.4, wall = 15.5;
    const parts = [];
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const l = Math.hypot(x1 - x0, z1 - z0); if (l < 0.05) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([x0, base, z0, x1, base, z1, x1, base + wall, z1, x0, base, z0, x1, base + wall, z1, x0, base + wall, z0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([u, 0, u + l, 0, u + l, wall, u, 0, u + l, wall, u, wall], 2));
      g.computeVertexNormals();
      const n = g.attributes.normal; const ox = (z1 - z0) / l, oz = -(x1 - x0) / l;
      if (n.getX(0) * ox + n.getZ(0) * oz < 0) { const pa = g.attributes.position.array; for (let k = 0; k < 18; k += 9) { for (let q = 0; q < 3; q++) { const t = pa[k + 3 + q]; pa[k + 3 + q] = pa[k + 6 + q]; pa[k + 6 + q] = t; } } const ua = g.attributes.uv.array; for (let k = 0; k < 12; k += 6) { for (let q = 0; q < 2; q++) { const t = ua[k + 2 + q]; ua[k + 2 + q] = ua[k + 4 + q]; ua[k + 4 + q] = t; } } g.computeVertexNormals(); }
      parts.push(g); u += l;
    }
    const walls = new THREE.Mesh(mergeGeos(parts), this.brick);
    // tall gothic windows (dark insets) along each façade
    const wins = [];
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const l = Math.hypot(x1 - x0, z1 - z0); if (l < 5) continue;
      const ux = (x1 - x0) / l, uz = (z1 - z0) / l, nx = uz, nz = -ux;
      for (let s = 2.5; s < l - 1.5; s += 3.2) for (const y of [3.2, 8.6]) {
        const g = new THREE.BoxGeometry(1.1, 3.0, 0.08).toNonIndexed();
        g.rotateY(-Math.atan2(uz, ux)); g.translate(x0 + ux * s + nx * 0.05, base + y, z0 + uz * s + nz * 0.05); wins.push(g);
      }
    }
    const b = obb(ring);
    const roof = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
    roof.scale(b.L * 0.72, 7, b.W * 0.72); roof.rotateY(-b.a); roof.translate(b.cx, base + wall + 3.5, b.cz);
    // clock tower at the footprint corner nearest Town Hall Square
    const sq = { x: -7337.1, z: -2551.2 };
    let tc = ring[0], bd = 1e9; for (const p of ring) { const d = Math.hypot(p[0] - sq.x, p[1] - sq.z); if (d < bd) { bd = d; tc = p; } }
    const tx = tc[0] + (b.cx - tc[0]) * 0.08, tz = tc[1] + (b.cz - tc[1]) * 0.08;
    const tower = mergeGeos([box(6.2, 26, 6.2, 0, 13, 0), box(7.0, 0.6, 7.0, 0, 26.2, 0)]);
    const towerUV = tower.attributes.position; const tuv = new Float32Array(towerUV.count * 2);
    for (let i = 0; i < towerUV.count; i++) { tuv[i * 2] = towerUV.getX(i) + towerUV.getZ(i); tuv[i * 2 + 1] = towerUV.getY(i); }
    tower.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
    const tmesh = new THREE.Mesh(tower, this.brick); tmesh.position.set(tx, base, tz); tmesh.rotation.y = -b.a;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.2, 9, 4).rotateY(Math.PI / 4), this.slate); spire.position.set(tx, base + 31, tz); spire.rotation.y = -b.a;
    // clock faces
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
    c.fillStyle = '#e9e1c8'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 4; c.stroke();
    c.translate(64, 64); for (let i = 0; i < 12; i++) { c.fillStyle = '#222'; c.fillRect(-2, -56, 4, 10); c.rotate(Math.PI / 6); }
    const clockTex = new THREE.CanvasTexture(cv); clockTex.colorSpace = THREE.SRGBColorSpace;
    const faceMat = new THREE.MeshStandardNodeMaterial({ map: clockTex, roughness: 0.5 });
    this.hands = [];
    for (let k = 0; k < 4; k++) {
      const a = -b.a + k * Math.PI / 2;
      const f = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), faceMat);
      f.position.set(tx + Math.sin(a) * 3.15, base + 22, tz + Math.cos(a) * 3.15); f.rotation.y = a; grp.add(f);
      for (const [len, w] of [[1.0, 0.12], [1.35, 0.08]]) { const h = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.04).translate(0, len / 2, 0), this.dark); h.position.copy(f.position).add(new THREE.Vector3(Math.sin(a) * 0.04, 0, Math.cos(a) * 0.04)); h.rotation.y = a; grp.add(h); this.hands.push([h, len > 1.1]); }
    }
    const sh = G.renderer.shadowMap.enabled;
    for (const m of [walls, tmesh, spire]) { m.castShadow = m.receiveShadow = sh; grp.add(m); }
    grp.add(new THREE.Mesh(mergeGeos(wins), this.dark));
    grp.add(Object.assign(new THREE.Mesh(roof, this.slate), { castShadow: sh }));
    return grp;
  }
  update() {
    if (!this.hands) return;
    const h = this.G.world.hours();
    for (const [m, minute] of this.hands) m.rotation.z = -(minute ? (h % 1) * Math.PI * 2 : (h % 12) / 12 * Math.PI * 2);
  }
}
