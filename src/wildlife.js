// Wildlife and pets in the game: wildlifeSim.js decides who is where and what they are doing from the map, the
// hour, the weather and the people about; this feeds it the game world, draws the animals (wildlifeModels.js)
// and keeps the dogs' leads in their people's hands. (The simulation says when each animal calls, sim.calls;
// they will play once real recordings of them are in the sound bank: the game plays recorded sound only.)
import * as THREE from 'three/webgpu';
import { WildSim } from './wildlifeSim.js';
import { AnimalRenderer, MODELS, COATS } from './wildlifeModels.js';

const TILE = 256, TCELL = 16;
const LEADS = 24;

export class Wildlife {
  constructor(G, camInfo) {
    this.G = G; this.camInfo = camInfo;
    const T = G.tiles, net = G.net, q = G.quality;
    const big = new Set(net.classes.map((c, i) => (/motorway|trunk|primary/.test(c) ? i : -1)).filter(i => i >= 0));
    const tmp = { x: 0, z: 0 };
    this.W = {
      lc: (x, z) => { const t = T.tileAt(x, z); return t && t.data && t.data.lc ? T.landcover(x, z) : null; },
      ground: (x, z, y) => T.ground(x, z, y ?? null),
      water: (x, z) => T.waterLevel(x, z),
      trees: (x, z, r) => this.trees(x, z, r),
      treesLoaded: (x, z) => { const t = T.tileAt(x, z); return !!(t && t.trees); },
      busy: (x, z) => G.peds.density(x, z),
      bigRoad: (x, z, r) => !!net.nearest(x, z, r, e => big.has(net.cls[e])),
      blocked: (x, z, y) => !!T.insideBuilding(x, z, y),
      visible: (x, y, z, r) => camInfo.visible(x, y, z, r),
      time: () => G.world.time, clock: () => G.world.hours(), rain: () => G.world.cur.rain,
      wind: () => { const w = G.U.wind.value; tmp.x = w.x; tmp.z = w.y; return tmp; },
      focus: () => this.focus(),
      peds: () => G.peds.list, cars: () => G.traffic.list,
    };
    this.sim = new WildSim(this.W, { max: q === 'low' ? 30 : q === 'medium' ? 50 : 90, drawScale: q === 'low' ? 0.75 : 1, seed: (Math.random() * 1e9) | 0 });
    this.R = new AnimalRenderer(G.scene, G.renderer.shadowMap.enabled);
    // the dogs' leads: two thin pieces each, sagging a little between the hand and the collar
    const lg = new THREE.CylinderGeometry(0.006, 0.006, 1, 4, 1, true); lg.translate(0, 0.5, 0);
    this.leads = new THREE.InstancedMesh(lg, new THREE.MeshStandardNodeMaterial({ color: 0x3a2418, roughness: 0.7 }), LEADS * 2);
    this.leads.count = 0; this.leads.frustumCulled = false; this.leads.name = 'dog-leads';
    G.scene.add(this.leads);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.err = 0;
  }
  focus() {
    const B = this.G.brothers, me = B.me, v = B.vehicleOf(me);
    const f = this._f || (this._f = {});
    f.x = me.x; f.y = me.y; f.z = me.z; f.speed = B.speedNow || 0; f.vehicle = !!v || !!this.G.transit?.ride; f.vspeed = v ? Math.abs(v.sp || 0) : this.G.transit?.ride ? 10 : 0;
    return f;
  }
  // trees within r of (x, z): [x, z, H, groundY] from the tiles' tree lists (tiles.js addTrees), on a 16 m grid
  trees(x, z, r) {
    const T = this.G.tiles, out = [];
    for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) for (let tz = Math.floor((z - r) / TILE); tz <= Math.floor((z + r) / TILE); tz++) {
      const t = T.tiles.get(T.key(tx, tz)); if (!t || !t.trees || !t.trees.length) continue;
      let g = t._wild;
      if (!g || g.src !== t.trees || g.n !== t.trees.length) g = t._wild = this.treeGrid(t, tx * TILE, tz * TILE);
      const c0 = Math.max(0, Math.floor((x - r - g.ox) / TCELL)), c1 = Math.min(15, Math.floor((x + r - g.ox) / TCELL));
      const d0 = Math.max(0, Math.floor((z - r - g.oz) / TCELL)), d1 = Math.min(15, Math.floor((z + r - g.oz) / TCELL));
      for (let j = d0; j <= d1; j++) for (let i = c0; i <= c1; i++) for (const k of g.cells[j * 16 + i]) {
        const e = t.trees[k];
        if ((e[0] - x) ** 2 + (e[1] - z) ** 2 > r * r) continue;
        out.push([e[0], e[1], e[2], g.y[k]]);
      }
    }
    return out;
  }
  treeGrid(t, ox, oz) {
    const cells = Array.from({ length: 256 }, () => []);
    t.trees.forEach((e, k) => { const i = Math.min(15, Math.max(0, Math.floor((e[0] - ox) / TCELL))), j = Math.min(15, Math.max(0, Math.floor((e[1] - oz) / TCELL))); cells[j * 16 + i].push(k); });
    // the foot of each trunk (tiles.js places the tree there)
    const y = new Float32Array(t.trees.length), D = t.data.trees;
    for (let k = 0; k < y.length; k++) y[k] = D && D.length >= (k + 1) * 4 ? D[k * 4 + 1] : (this.G.tiles.terrain(t.trees[k][0], t.trees[k][1]) ?? 0);
    return { src: t.trees, n: t.trees.length, ox, oz, cells, y };
  }

  update(dt) {
    if (this.err > 3) return;
    this.sim.abundance = /^Realistic/.test(this.G.hud?.menu?.settings?.wildlife || '') ? 0 : 1;
    try {
      this.sim.update(dt);
    } catch (e) { this.err++; console.warn('wildlife', e); }
  }
  modelOf(a) {
    if (a._m) return a._m;
    return (a._m = this.pick(a));
  }
  pick(a) {
    if (a.key === 'dog') { const D = COATS.dog[Math.floor(a.breed * COATS.dog.length) % COATS.dog.length]; return [D.model, D.c, D.s || 1]; }
    const model = a.key;
    let coat;
    if (typeof a.coat === 'string') coat = COATS[a.coat][0];
    else { const L = COATS[model]; coat = L[(a.coat != null ? a.coat : Math.floor(a.seed * L.length)) % L.length]; }
    return [model, coat, 1];
  }
  draw(cam) {
    if (this.err > 3) return;
    try {
      const R = this.R, sim = this.sim, ds = sim.drawScale, info = this.camInfo;
      R.begin();
      for (const a of sim.list) {
        if (a.hidden || a.gone) continue;
        const dx = a.x - cam.x, dz = a.z - cam.z, dy = a.y - cam.y, d = Math.sqrt(dx * dx + dz * dz + dy * dy), far = a.S.draw * ds;
        if (d > far) continue;
        const [model, coat, bs] = this.modelOf(a), def = MODELS[model]; if (!def) continue;
        const size = (def.o.L || 0.3) * 2 * a.scale * bs + 0.5;
        if (!info.visible(a.x, a.y + size * 0.4, a.z, size)) continue;
        const fade = Math.min(1, (far - d) / (far * 0.08));
        let y = a.y + (a.lift || 0);
        if (a.swimming && !a.fl) y -= ((def.o.leg || 0) + (def.o.R || 0.1) * 0.75) * a.scale * bs;
        const o = this.o || (this.o = {});
        o.x = a.x; o.y = y; o.z = a.z; o.heading = a.heading; o.phase = a.phase; o.amp = a.amp; o.mode = a.mode; o.scale = a.scale * bs * fade;
        o.coat = coat; o.seed = a.seed; o.drop = a.drop; o.wag = a.wag; o.look = a.look; o.pitch = a.pitch; o.plain = a.plain;
        R.add(model, o);
      }
      for (const n of sim.nests) {
        if (Math.hypot(n.x - cam.x, n.z - cam.z) > 90 * ds || !info.visible(n.x, n.y, n.z, 0.5)) continue;
        const o = this.o || (this.o = {});
        o.x = n.x; o.y = n.y; o.z = n.z; o.heading = n.heading; o.phase = 0; o.amp = 0; o.mode = 0; o.scale = 1; o.coat = COATS[n.model][0]; o.seed = n.seed;
        o.drop = 0; o.wag = 0; o.look = 0; o.pitch = 0; o.plain = false;
        R.add(n.model, o);
      }
      R.end();
      this.drawLeads(cam);
    } catch (e) { this.err++; console.warn('wildlife', e); }
  }
  drawLeads(cam) {
    let n = 0;
    const L = this.leads, m = this.m, v = this.v, q = this.q, s = this.s;
    const seg = (ax, ay, az, bx, by, bz) => {
      v.set(bx - ax, by - ay, bz - az); const len = v.length(); if (len < 1e-3) return;
      q.setFromUnitVectors(this.up, v.multiplyScalar(1 / len));
      m.compose(v.set(ax, ay, az), q, s.set(1, len, 1)); L.setMatrixAt(n++, m);
    };
    for (const a of this.sim.list) {
      if (a.key !== 'dog' || a.offLead || a.gone || n >= LEADS * 2) continue;
      const o = a.owner; if (!o || o.gone) continue;
      if (Math.hypot(a.x - cam.x, a.z - cam.z) > 60) continue;
      const [model, , bs] = this.modelOf(a), P = MODELS[model].o, sc = a.scale * bs;
      const oh = o.heading || 0, side = a.side || 1;
      // from the hand on the dog's side to the collar behind its head
      const hx = o.x + Math.sin(oh) * 0.3 * side + Math.cos(oh) * 0.08, hz = o.z - Math.cos(oh) * 0.3 * side + Math.sin(oh) * 0.08, hy = (o.y || 0) + 0.82;
      const fwd = P.L * 0.85 * sc, cx = a.x + Math.cos(a.heading) * fwd, cz = a.z + Math.sin(a.heading) * fwd, cy = a.y + (P.leg + P.R * 1.55) * sc - (a.mode === 2 ? a.drop * sc : 0);
      const gap = Math.hypot(hx - cx, hy - cy, hz - cz), sag = Math.max(0.02, (1.9 - gap) * 0.3);
      const mx = (hx + cx) / 2, my = (hy + cy) / 2 - sag, mz = (hz + cz) / 2;
      seg(hx, hy, hz, mx, my, mz); seg(mx, my, mz, cx, cy, cz);
    }
    L.count = n; L.visible = n > 0;
    if (n) L.instanceMatrix.needsUpdate = true;
  }
}
