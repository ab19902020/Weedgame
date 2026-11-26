// Enterable buildings: the sites (www/world/interiors.json, picked by tools/interiors/pick.mjs), the Enter and
// Leave prompts at their front doors, walking about inside (floors, stairs, walls and furniture), an indoor camera
// that stays in the room, a glowing marker and a real door outside each one, and the list the maps draw.
// The building's own shell stays as the world draws it; the interior sits inside it, faces turned inwards, so
// it can't be seen from outside and you see the street through its windows.
import * as THREE from 'three/webgpu';
import { makePlan } from './interiorPlan.js';
import { buildInterior, setDaylight } from './interiorMesh.js';
import { HomeTV } from './homeTV.js';
import { Restaurants } from './restaurants.js';

export const KIND_LABEL = { trap: 'Trap house', nice: 'House', terrace: 'Terraced house', semi: 'Semi-detached house', detached: 'Detached house', bungalow: 'Bungalow',
  cottage: 'Cottage', warehouse: 'Warehouse', office: 'Offices', shop: 'Shop', pub: 'Pub', church: 'Church', mall: 'Shopping centre', food: 'Takeaway' };
export const KIND_COLOUR = { trap: '#e5483b', nice: '#e8b33a', mall: '#8e5bd6', warehouse: '#5f7d95', office: '#2f8cff', shop: '#1fa37a', pub: '#b0703a', church: '#7c6bd1', food: '#f08a24' };
const HOME = new Set(['terrace', 'semi', 'detached', 'bungalow', 'cottage']);

export class Interiors {
  constructor(G) {
    this.G = G; this.homeTV=new HomeTV(this); this.sites = []; this.byId = new Map(); this.built = new Map();
    this.prompt = null; this.ready = false;
    this.group = new THREE.Group(); this.group.name = 'interiors'; G.scene.add(this.group);
    this.outside = new THREE.Group(); this.outside.name = 'interior doors'; G.scene.add(this.outside);
    this.near = new Map();          // id -> { group, ring } outside: door and marker for nearby sites
    this.fade = { t: 0, dir: 0, then: null };
    this.fadeEl = Object.assign(document.createElement('div'), { id: 'fadeBlack' });
    Object.assign(this.fadeEl.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', zIndex: '7', transition: 'none' });
    document.body.appendChild(this.fadeEl);
    this.ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ringGeo = new THREE.RingGeometry(0.55, 0.78, 40).rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(0.55, 32).rotateX(-Math.PI / 2);
    this.food = new Restaurants(G, this);   // staff, diners and ordering in the fast-food places (restaurants.js)
    fetch('world/interiors.json').then(r => r.json()).then(j => { this.load(j.sites); G.fuel?.load(j.fuel || []); }).catch(e => console.warn('interiors', e));
  }
  load(sites) {
    for (const s of sites) {
      // the plan is cheap (no meshes): it fixes the front door's place along the wall
      s.brothersHome=s.id===2 && s.district==='Woodley';
      s.plan = makePlan(s);
      const dx = s.plan.site.doorX, out = (s.door.wall || 0) + 0.75;
      [s.dx, s.dz] = this.toWorld(s, dx, -out);           // where you stand to go in
      [s.wx, s.wz] = this.toWorld(s, dx, -(s.door.wall || 0)); // the outside face of the front wall
      s.title = this.title(s);
      this.byId.set(s.id, s);
    }
    this.sites = sites; this.ready = true;
    this.G.events?.emit?.('interiors', { n: sites.length });
  }
  title(s) {
    if(s.brothersHome)return "Brothers’ home, "+s.street;
    if (s.kind === 'trap') return `Trap house, ${s.street}`;
    if (s.kind === 'nice') return `The nicer house, ${s.street}`;
    if (s.kind === 'mall') return 'The Oracle';
    if (s.kind === 'food') return s.name + (s.street && !/^A\d|^M\d/.test(s.street) ? ', ' + s.street : ', ' + s.district);
    if (s.name && !HOME.has(s.kind)) return s.name;
    return `${KIND_LABEL[s.kind] || 'Building'}${s.street ? ', ' + s.street : ''}`;
  }
  toWorld(s, lx, ly) { return [s.o[0] + s.ax[0] * lx + s.ay[0] * ly, s.o[1] + s.ax[1] * lx + s.ay[1] * ly]; }
  toLocal(s, x, z) { const dx = x - s.o[0], dz = z - s.o[1]; return [dx * s.ax[0] + dz * s.ax[1], dx * s.ay[0] + dz * s.ay[1]]; }

  // ---------------------------------------------------------------- the interior you're in
  ensure(s) {
    let b = this.built.get(s.id);
    if (b) { b.used = performance.now(); return b; }
    const g = this.G.tiles.ground(s.dx, s.dz);
    const floor0 = Math.max(s.base, g ?? s.base) + 0.12;
    const group = buildInterior(s.plan);
    // the plan's frame: x along ax, up, y along ay (right-handed, so faces keep their facing)
    group.matrixAutoUpdate = false;
    group.matrix.set(s.ax[0], 0, s.ay[0], s.o[0], 0, 1, 0, floor0, s.ax[1], 0, s.ay[1], s.o[1], 0, 0, 0, 1);
    group.matrixWorldNeedsUpdate = true;
    this.group.add(group);
    b = { site: s, plan: s.plan, floor0, group, used: performance.now() };
    const self = this;
    b.collide = (x, z, r, y) => { const [lx, ly] = self.toLocal(s, x, z); const [px, py] = s.plan.collide(lx, ly, r, y - floor0); return self.toWorld(s, px, py); };
    b.floorAt = (x, z, y) => { const [lx, ly] = self.toLocal(s, x, z); return floor0 + s.plan.floorAt(lx, ly, y - floor0); };
    b.camera = (c, dt, tx, ty, tz) => self.camera(b, c, dt, tx, ty, tz);
    this.built.set(s.id, b);
    // keep the two most recent
    if (this.built.size > 2) { const old = [...this.built.values()].sort((p, q) => p.used - q.used)[0]; if (old !== b) this.drop(old); }
    return b;
  }
  drop(b) { this.group.remove(b.group); b.group.traverse(o => o.geometry?.dispose()); this.built.delete(b.site.id); }
  // the built interior a brother is in (for walking and the camera), or null
  at(bro) {
    if (!bro?.inside || !this.ready) return null;
    const s = this.byId.get(bro.inside);
    // (a save from another version might name a building he isn't standing in: then he's simply outside)
    if (s) { const [lx, ly] = this.toLocal(s, bro.x, bro.z); if (lx > -2 && lx < s.W + 2 && ly > -2 && ly < s.D + 2) return this.ensure(s); }
    bro.inside = null; return null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.ready) return;
    const G = this.G, B = G.brothers, me = B.me;
    this.fadeStep(dt);
    const IN = this.at(me);
    for (const b of this.built.values()) b.group.visible = b === IN;
    if ((IN?.site.id ?? null) !== (this._vegFor ?? null)) { this._vegFor = IN?.site.id ?? null; if (IN) this.hideVeg(IN.site); else this.showVeg(); }
    // brighter by day, warmer at night
    setDaylight(1 - (G.U?.night?.value ?? 0));
    this.prompt = null;
    if (!this.fade.dir && !B.vehicleOf(me) && !G.transit?.ride) {
      if (IN) {
        const [lx, ly] = this.toLocal(IN.site, me.x, me.z), P = IN.plan;
        if (Math.hypot(lx - P.exit.x, ly - P.exit.y) < 1.3 && me.y - IN.floor0 < 0.8) this.prompt = { text: 'Leave', act: 'leave', site: IN.site };
        else if(IN.site.brothersHome && !this.homeTV.seated && me.y-IN.floor0<.9){
          const sofa=P.items.find(it=>it.type.startsWith('sofa'));
          if(sofa && Math.hypot(lx-sofa.x,ly-sofa.y)<2.2)this.prompt={text:'Sit on sofa',act:'sit',site:IN.site};
        }
        else if (IN.site.kind === 'food') { const till = this.food.tillAt(IN, me); if (till != null) this.prompt = { text: 'Order', act: 'order', site: IN.site, till }; }
      } else {
        let best = null, bd = 2.3;
        for (const s of this.sites) { const d = Math.hypot(s.dx - me.x, s.dz - me.z); if (d < bd) { bd = d; best = s; } }
        if (best) this.prompt = { text: 'Enter', act: 'enter', site: best, d: bd };
      }
    }
    // doors and markers outside the buildings near you
    if ((this._nearT = (this._nearT || 0) - dt) <= 0) { this._nearT = 0.5; this.refreshNear(me); }
    // the restaurant you're in: staff, your order; the menu closes when you walk off; the takeaway bag on the HUD
    if (IN && IN.site.kind === 'food') { this.food.update(dt, IN, me); if (this.food.panel && this.food.tillAt(IN, me) == null) this.food.close(); }
    else if (this.food.panel) this.food.close();
    if (this.food.order && !this.food.order.done && (!IN || IN.site !== this.food.order.site) && G.time > this.food.order.readyAt + 2) { const o = this.food.order; o.ready = true; this.food.takeAway(o); }
    this.food.hud();
    const t = G.time || performance.now() / 1000;
    for (const [id, n] of this.near) {
      const s = this.byId.get(id);
      if (n.ringY == null) { const g = G.tiles.ground(s.dx, s.dz); if (g != null) { n.ringY = g; n.group.position.y = g; } }
      const k = 1 + 0.08 * Math.sin(t * 2.4 + id);
      n.ring.scale.set(k, 1, k); n.ring.visible = n.disc.visible = !IN;
    }
  }
  // the people inside the place you're in (staff, diners), drawn with the street's crowd
  get people() { const b = this.at(this.G.brothers.me); return b && b.site.kind === 'food' ? this.food.people(b) : []; }
  refreshNear(me) {
    const R = 140;
    for (const s of this.sites) {
      const d = Math.hypot(s.dx - me.x, s.dz - me.z), have = this.near.get(s.id);
      if (d < R && !have) this.near.set(s.id, this.outsideBits(s));
      else if (d > R + 40 && have) { this.outside.remove(have.group); have.group.traverse(o => { if (o.geometry && o.geometry !== this.ringGeo && o.geometry !== this.discGeo) o.geometry.dispose(); }); this.near.delete(s.id); }
    }
  }
  // a glowing ring on the pavement at the door, and a real front door on the building's front wall
  outsideBits(s) {
    const group = new THREE.Group();
    const col = new THREE.Color(KIND_COLOUR[s.kind] || '#e9f2ff');
    const mat = this.ringMat.clone(); mat.color.copy(col);
    const ring = new THREE.Mesh(this.ringGeo, mat); ring.position.set(s.dx, 0.06, s.dz); ring.renderOrder = 3;
    const dm = this.ringMat.clone(); dm.color.copy(col).multiplyScalar(0.35); dm.opacity = 0.35;
    const disc = new THREE.Mesh(this.discGeo, dm); disc.position.set(s.dx, 0.05, s.dz); disc.renderOrder = 3;
    group.add(ring, disc);
    // the door: a panel, its frame and a step, flat to the front wall, facing the street
    const w = s.plan.frontW ? s.plan.frontW * 2 : 0.94, h = s.plan.frontTop || 2.05;
    const doorCol = { trap: 0xe9e6dc, nice: 0x2e3d55, mall: 0x3b3b3b, office: 0x3b3b3b, shop: 0x3b3b3b, warehouse: 0x5f7d95, church: 0x5b3a22, pub: 0x2f4a3a }[s.kind] ?? [0x2e3d55, 0x7d1f2a, 0x3a5a3a, 0x2c2c2c, 0xe9e6dc][s.id % 5];
    const glassy = s.kind === 'mall' || s.kind === 'office' || s.kind === 'shop';
    const m = new THREE.MeshStandardNodeMaterial({ color: doorCol, roughness: 0.5, metalness: glassy ? 0.4 : 0.05 });
    const fm = new THREE.MeshStandardNodeMaterial({ color: 0xf2f1ec, roughness: 0.6 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.1, 0.05), fm);
    const step = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.12, 0.45), new THREE.MeshStandardNodeMaterial({ color: 0x9a9690, roughness: 0.9 }));
    const yaw = Math.atan2(-s.ay[0], -s.ay[1]);   // facing out (-ay)
    const holder = new THREE.Group();
    holder.position.set(s.wx, 0, s.wz); holder.rotation.y = yaw;
    frame.position.set(0, (h + 0.1) / 2, 0.025); door.position.set(0, h / 2, 0.045); step.position.set(0, 0.06, 0.22);
    holder.add(frame, door, step);
    if (glassy) { const gl = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, h - 0.3, 0.02), new THREE.MeshStandardNodeMaterial({ color: 0x9fc4d8, roughness: 0.1, metalness: 0.3 })); gl.position.set(0, h / 2 + 0.05, 0.08); holder.add(gl); }
    else { const knob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.05), new THREE.MeshStandardNodeMaterial({ color: 0xc9b26a, metalness: 0.8, roughness: 0.3 })); knob.position.set(w / 2 - 0.12, 1.0, 0.09); holder.add(knob); }
    for (const o of holder.children) { o.castShadow = false; o.receiveShadow = true; }
    group.add(holder);
    this.outside.add(group);
    const n = { group, ring, disc, holder, ringY: null };
    // the door's base on the ground in front of the wall
    const g = this.G.tiles.ground(s.dx, s.dz);
    if (g != null) { group.position.y = g; n.ringY = g; }
    return n;
  }

  // ---------------------------------------------------------------- going in and coming out
  use() {
    const p = this.prompt; if (!p || this.fade.dir) return false;
    if(p.act==='sit')this.homeTV.sit(this.ensure(p.site)); else if (p.act === 'enter') this.enter(p.site); else if (p.act === 'order') this.food.open(p.site, p.till); else this.leave(p.site);
    return true;
  }
  // trees and shrubs whose leaves reach into the building (the shell hides them from outside; inside it doesn't)
  hideVeg(s) {
    this.showVeg();
    const T = this.G.tiles, m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), hidden = [];
    const cx = s.o[0] + s.ax[0] * s.W / 2 + s.ay[0] * s.D / 2, cz = s.o[1] + s.ax[1] * s.W / 2 + s.ay[1] * s.D / 2, R0 = Math.hypot(s.W, s.D) / 2 + 12;
    const inRect = (x, z, r) => { const [lx, ly] = this.toLocal(s, x, z); return lx > -r && lx < s.W + r && ly > -r && ly < s.D + r; };
    for (const t of T.tiles.values()) {
      if (Math.abs(t.data.ox + 128 - cx) > 128 + R0 || Math.abs(t.data.oz + 128 - cz) > 128 + R0) continue;
      if (t.treeMesh && t.trees) t.trees.forEach(([x, z, H], i) => { if (!inRect(x, z, H * 0.42)) return; for (const im of [t.treeMesh.crowns, t.treeMesh.trunks]) { im.getMatrixAt(i, m); hidden.push([im, i, m.clone()]); im.setMatrixAt(i, zero); im.instanceMatrix.needsUpdate = true; } });
      if (t.bushMesh && t.bushPos) for (let q = 0; q < t.bushPos.length; q += 4) { if (!inRect(t.bushPos[q], t.bushPos[q + 1], t.bushPos[q + 2])) continue; const i = t.bushPos[q + 3]; t.bushMesh.getMatrixAt(i, m); hidden.push([t.bushMesh, i, m.clone()]); t.bushMesh.setMatrixAt(i, zero); t.bushMesh.instanceMatrix.needsUpdate = true; }
    }
    this.hidden = hidden;
  }
  showVeg() { for (const [im, i, m] of this.hidden || []) { im.setMatrixAt(i, m); im.instanceMatrix.needsUpdate = true; } this.hidden = []; }
  enter(s) {
    const G = this.G, B = G.brothers, me = B.me;
    G.audio?.play?.('Car_Door_Close', s.dx, me.y, s.dz, 0.25);
    this.fadeOut(() => {
      me.inside = s.id;
      const b = this.ensure(s), P = s.plan;
      this.hideVeg(s);
      const [x, z] = this.toWorld(s, P.exit.x, P.exit.y + 0.35);
      me.x = x; me.z = z; me.y = b.floor0; me.heading = Math.atan2(s.ay[1], s.ay[0]);
      B.vel.x = B.vel.z = 0; B.cam.yaw = me.heading + Math.PI; B.cam.pitch = 0.2; B.cam.dist = 2.2;
      G.hud?.toast?.(s.title);
    });
  }
  leave(s) {
    const G = this.G, B = G.brothers, me = B.me;
    this.fadeOut(() => {
      me.inside = null; this.showVeg();
      me.x = s.dx; me.z = s.dz; me.y = G.tiles.ground(s.dx, s.dz) ?? me.y; me.heading = Math.atan2(-s.ay[1], -s.ay[0]);
      B.vel.x = B.vel.z = 0; B.cam.yaw = me.heading + Math.PI; B.cam.pitch = 0.28;
      G.audio?.play?.('Car_Door_Close', s.dx, me.y, s.dz, 0.25);
    });
  }
  fadeOut(then) { this.fade = { t: this.fade.t, dir: 1, then }; }
  fadeStep(dt) {
    const f = this.fade; if (!f.dir) return;
    f.t = Math.max(0, Math.min(1, f.t + f.dir * dt / (f.dir > 0 ? 0.28 : 0.4)));
    if (f.dir > 0 && f.t >= 1) { const t = f.then; f.then = null; t?.(); f.dir = -1; }
    else if (f.dir < 0 && f.t <= 0) f.dir = 0;
    this.fadeEl.style.opacity = f.t.toFixed(3);
  }

  // ---------------------------------------------------------------- the indoor camera: in the room, under the ceiling
  camera(b, c, dt, tx, ty, tz) {
    const G = this.G, s = b.site, P = b.plan;
    const big = !HOME.has(s.kind) && !['trap', 'nice', 'food', 'shop'].includes(s.kind);
    const want = big ? [4.2, 6.5, 9][c.foot] ?? 4.2 : [2.3, 3.0, 3.6][c.foot] ?? 2.3;
    c.dist += (want - c.dist) * Math.min(1, dt * 3);
    c.pitch = Math.max(-0.15, Math.min(big ? 0.9 : 0.6, c.pitch));
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const [lx, ly] = this.toLocal(s, tx, tz);
    const hx = tx + Math.cos(c.yaw) * cp * c.dist, hz = tz + Math.sin(c.yaw) * cp * c.dist;
    const [cx, cy] = this.toLocal(s, hx, hz);
    const hRel = ty - b.floor0;
    let f = P.ray(lx, ly, cx, cy, hRel);
    const d = Math.max(0.35, c.dist * f - (f < 1 ? 0.22 : 0));
    let x = tx + Math.cos(c.yaw) * cp * d, z = tz + Math.sin(c.yaw) * cp * d, y = ty + sp * d;
    // under the ceiling of the floor you're on, above its floor
    const li = P.levelAt(hRel - 1.3), lv = P.levels[li];
    const ceil = b.floor0 + lv.h + lv.ceil - 0.18, flo = b.floor0 + lv.h + 0.35;
    y = Math.max(flo, Math.min(ceil, y));
    // and inside the shell
    const [qx, qy] = this.toLocal(s, x, z), m = 0.18;
    const kx = Math.max(m, Math.min(P.W - m, qx)), ky = Math.max(m, Math.min(P.D - m, qy));
    if (kx !== qx || ky !== qy) [x, z] = this.toWorld(s, kx, ky);
    c.x = x; c.y = y; c.z = z;
    G.camera.position.set(x, y, z);
    G.camera.lookAt(tx, Math.min(ty, ceil - 0.05), tz);
  }
}
