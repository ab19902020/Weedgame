// TechZone, the gadget, tech and accessory shop: one in every town (tools/interiors/gadget.mjs), the same fit-out in
// each (interiorPlan.js techFit), and a unit in The Oracle. This module puts the life in them:
//  - the staff behind the counter (and someone browsing), the demo Kestrel T3 turning on its plinth, boxes and
//    devices on the tables and shelves, the promo screen;
//  - the till: walk up to it (Shop at TechZone) and buy from the catalogue (techCatalogue.js), paid from the
//    brother's cash (food.js);
//  - outside: the TechZone fascia over the door, and any sign on the unit's frontage reads TechZone;
//  - nearest(): the closest store (the phone's TechZone and Drone apps route you there).
import * as THREE from 'three/webgpu';
import { People } from './characters.js';
import { cash, spend } from './food.js';
import { CATALOGUE, CATEGORIES } from './techCatalogue.js';
import { buildDroneModel, buildDroneBox } from './droneModel.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = n => '£' + (+n || 0).toFixed(2).replace(/\.00$/, '');
const R32 = s => { let a = s | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// the TechZone wordmark on a canvas (fascia, promo screen, panel)
function logoCanvas(w, h, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = o.bg || '#111418'; x.fillRect(0, 0, w, h);
  if (o.stripe !== false) { x.fillStyle = '#ff7a1a'; x.fillRect(0, h - h * 0.08, w, h * 0.08); }
  const fs = h * (o.scale || 0.5); x.font = `800 ${fs}px system-ui, sans-serif`; x.textBaseline = 'middle';
  const a = 'Tech', b = 'Zone', wa = x.measureText(a).width, wb = x.measureText(b).width, sx = w / 2 - (wa + wb) / 2, y = h * 0.47;
  x.fillStyle = '#ff7a1a'; x.fillText(a, sx, y); x.fillStyle = '#ffffff'; x.fillText(b, sx + wa, y);
  if (o.sub) { x.font = `600 ${h * 0.14}px system-ui`; x.fillStyle = '#c8ccd4'; x.textAlign = 'center'; x.fillText(o.sub, w / 2, h * 0.8); }
  return c;
}
function promoCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 320; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1024, 320); g.addColorStop(0, '#0d1b2e'); g.addColorStop(0.55, '#16213a'); g.addColorStop(1, '#3a1d0a'); x.fillStyle = g; x.fillRect(0, 0, 1024, 320);
  // a thermal strip: people in white-hot
  const tg = x.createLinearGradient(640, 0, 1024, 0); tg.addColorStop(0, '#0000'); tg.addColorStop(0.25, '#222'); tg.addColorStop(1, '#444'); x.fillStyle = tg; x.fillRect(620, 0, 404, 320);
  for (let i = 0; i < 5; i++) { x.fillStyle = '#f4f4f4'; const px = 700 + i * 62, py = 150 + (i % 2) * 40; x.beginPath(); x.ellipse(px, py, 11, 30, 0, 0, 7); x.fill(); x.beginPath(); x.arc(px, py - 40, 10, 0, 7); x.fill(); }
  x.font = '800 64px system-ui'; x.fillStyle = '#ffffff'; x.fillText('Kestrel T3', 48, 110);
  x.font = '600 30px system-ui'; x.fillStyle = '#ff9a4a'; x.fillText('4K + THERMAL · FLY ANYWHERE', 50, 170);
  x.font = '500 24px system-ui'; x.fillStyle = '#c8d0e0'; x.fillText('31 min flight · 15 km video · up into the clouds', 50, 220);
  x.font = '800 40px system-ui'; x.fillStyle = '#ffffff'; x.fillText('£899', 50, 280);
  return c;
}

export class TechShop {
  constructor(G) {
    this.G = G; this.stores = []; this.ready = false; this.panel = null; this.fascias = new Map(); this.decorated = new WeakSet();
    this.mats = {
      fascia: new THREE.MeshBasicMaterial({ map: canvasTex(logoCanvas(1024, 160, { scale: 0.55 })), color: new THREE.Color(1.25, 1.25, 1.25) }),
      promo: new THREE.MeshBasicMaterial({ map: canvasTex(promoCanvas()), color: new THREE.Color(1.3, 1.3, 1.3) }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 1.1) }),
      black: new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.3, metalness: 0.4 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.5 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.45, metalness: 0.5 }),
    };
  }
  // ---------------------------------------------------------------- the stores (once the interiors have loaded)
  init() {
    const I = this.G.interiors; if (!I?.ready) return false;
    this.stores = [];
    for (const s of I.sites) {
      if (s.kind === 'gadget') { s.title = `TechZone, ${s.town || s.district}`; this.stores.push({ site: s, x: s.dx, z: s.dz, name: s.title }); }
      if (s.kind === 'mall' && s.plan?.techUnit) this.stores.push({ site: s, x: s.dx, z: s.dz, name: 'TechZone, The Oracle', mall: true });
    }
    // the signs on each store's frontage read TechZone (tiles.js signText); the tiles already built redo theirs
    // (a store whose unit has a sign of its own gets no extra fascia board: the sign itself reads TechZone)
    const fronts = this.stores.filter(t => !t.mall);
    const T = this.G.tiles;
    T.signText = (text, x0, z0, x1, z1) => {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hit = fronts.find(t => Math.hypot(mx - t.site.wx, mz - t.site.wz) < 9);
      if (!hit) return text; hit.signed = true; return 'TechZone';
    };
    for (const f of fronts) { const t = T.tileAt(f.site.wx, f.site.wz); if (t) T.refreshSigns?.(t); }
    this.ready = true;
    return true;
  }
  nearest() {
    const me = this.G.brothers.me; let best = null;
    for (const t of this.stores) { const d = Math.hypot(t.x - me.x, t.z - me.z); if (!best || d < best.d) best = { x: t.x, z: t.z, name: t.name, d }; }
    return best;
  }
  // ---------------------------------------------------------------- inside: the till prompt and the people
  plan(b) { const P = b.plan; return P.style?.gadget ? { tills: P.tills, staff: P.staffSpots, plinth: P.techPlinth } : P.techTills ? { tills: P.techTills, staff: P.techStaff, plinth: P.techPlinth } : null; }
  prompt(b, me) {
    const T = this.plan(b); if (!T) return null;
    const [lx, ly] = this.G.interiors.toLocal(b.site, me.x, me.z);
    if (me.y - b.floor0 > 0.9) return null;
    if (T.tills.some(t => Math.hypot(lx - t.x, ly - t.y) < 1.25)) return { text: 'Shop at TechZone', act: 'tech', site: b.site };
    if (T.plinth && Math.hypot(lx - T.plinth.x, ly - T.plinth.y) < 1.5) return { text: 'Kestrel T3 · £899', act: 'tech', site: b.site };
    return null;
  }
  people(b) {
    const T = this.plan(b); if (!T) return [];
    if (b.techPeople) return b.techPeople;
    const s = b.site, I = this.G.interiors, R = R32((s.seed || 1) * 31 + s.id), out = [];
    const toW = (x, y) => I.toWorld(s, x, y), head = (dx, dy) => Math.atan2(s.ax[1] * dx + s.ay[1] * dy, s.ax[0] * dx + s.ay[0] * dy);
    // staff in the TechZone shirt (charcoal, the orange lanyard reads at a distance)
    for (const sp of T.staff) {
      const [x, z] = toW(sp.x, sp.y);
      out.push({ id: `tz-staff-${s.id}-${out.length}`, x, y: b.floor0, z, heading: head(sp.dx, sp.dy), base: head(sp.dx, sp.dy),
        look: { ...People.randomLook(R, { work: true }), top: 0x23262b, cap: false, hood: false, bag: false, umbrella: 0, hiVis: false }, visible: true, speed: 0, t: R() * 9, phase: 0, pose: 'idle', staff: true, lx: sp.x, ly: sp.y });
    }
    // one or two people browsing: at a table or looking at the drone
    const spots = [];
    if (T.plinth) spots.push([T.plinth.x - 0.9, T.plinth.y + 0.3, 1, -0.3]);
    for (const it of b.plan.items || []) if (it.type === 'techtable' && !it.lv) spots.push([it.x + 1.1, it.y, -1, 0]);
    const n = Math.min(spots.length, 1 + Math.floor(R() * 2));
    for (let k = 0; k < n; k++) {
      const [sx, sy, dx, dy] = spots.splice(Math.floor(R() * spots.length), 1)[0], [x, z] = toW(sx, sy);
      out.push({ id: `tz-shopper-${s.id}-${k}`, x, y: b.floor0, z, heading: head(dx, dy), base: head(dx, dy), look: { ...People.randomLook(R), umbrella: 0 }, visible: true, speed: 0, speedNow: 0, t: R() * 9, phase: R() * 6, pose: R() < 0.4 ? 'phone' : 'idle', shopper: true });
    }
    return (b.techPeople = out);
  }
  // ---------------------------------------------------------------- the products in a store, made when it's built
  decorate(b) {
    if (this.decorated.has(b)) return; this.decorated.add(b);
    const T = this.plan(b); if (!T) return;
    const g = new THREE.Group(); g.name = 'techzone stock';
    // the demo drone on its plinth, turning slowly, its lights on
    if (T.plinth) { const d = buildDroneModel({ leds: true }); d.scale.setScalar(1.6); d.position.set(T.plinth.x, T.plinth.h + 0.09, T.plinth.y); g.add(d); b.techDemo = d; }
    const P = b.plan, items = (P.items || []).filter(i => !i.lv), M = this.mats;
    for (const it of items) {
      const rot = it.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
      const at = (u, v, h) => new THREE.Vector3(it.x + u * c - v * s, h, it.y + u * s + v * c);
      if (it.type === 'techtable') {
        // a drone, a tablet, phones and headphones on each table
        const dd = buildDroneModel({ leds: false }); dd.position.copy(at(-it.w * 0.28, 0, it.h + 0.05)); dd.rotation.y = -rot + 0.4; dd.scale.setScalar(1.15); g.add(dd);
        const tab = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.19), M.black); tab.position.copy(at(0.1, 0.1, it.h + 0.01)); tab.rotation.y = -rot; g.add(tab);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.17), M.screen); scr.rotation.x = -Math.PI / 2; scr.rotation.z = -rot; scr.position.copy(at(0.1, 0.1, it.h + 0.017)); g.add(scr);
        for (let k = 0; k < 3; k++) { const ph = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.01, 0.16), M.black); ph.position.copy(at(it.w * 0.18 + k * 0.12, -0.18, it.h + 0.01)); ph.rotation.y = -rot; g.add(ph); }
        const hp = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 6, 16, Math.PI), M.grey); hp.position.copy(at(it.w * 0.32, 0.22, it.h + 0.02)); hp.rotation.set(0, -rot, 0); g.add(hp);
      }
      if (it.type === 'techshelf') {
        // boxed Kestrels on the middle shelves
        for (let k = 0; k < 4; k++) { const bx = buildDroneBox(); bx.position.copy(at(-it.w / 2 + 0.3 + k * 0.4, -0.02, 1.13)); bx.rotation.y = -rot; bx.scale.setScalar(0.9); g.add(bx); }
      }
      if (it.type === 'promo') {
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.w * 0.3125), M.promo);
        pm.position.copy(at(0, -0.05, 2.2 + it.w * 0.155)); pm.rotation.y = -rot + Math.PI; g.add(pm);
      }
    }
    b.group.add(g);
    b.group.updateMatrixWorld(true);
  }
  // ---------------------------------------------------------------- outside: the fascia over the door
  fascia(t) {
    const s = t.site, w = Math.min(s.W * 0.85, 6.5), h = Math.max(0.55, w / 7);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), [this.mats.black, this.mats.black, this.mats.black, this.mats.black, this.mats.fascia, this.mats.black]);
    const g = this.G.tiles.ground(s.dx, s.dz) ?? s.base;
    const ox = -s.ay[0] * 0.08, oz = -s.ay[1] * 0.08;
    m.position.set(s.wx + ox, Math.max(s.base, g) + 2.75 + h / 2, s.wz + oz);
    m.rotation.y = Math.atan2(-s.ay[0], -s.ay[1]);
    this.G.scene.add(m);
    return m;
  }
  // ---------------------------------------------------------------- the till: the catalogue
  open() {
    const G = this.G, me = G.brothers.me;
    if (this.panel) return this.render();
    const el = this.panel = document.createElement('div');
    el.id = 'techPanel'; el.dataset.pad = 'menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'TechZone');
    (document.getElementById('hud') || document.body).append(el);
    el.addEventListener('click', e => { const b = e.target.closest('button[data-buy],button[data-close]'); if (!b) return; e.stopPropagation(); if (b.dataset.close != null) this.close(); else this.buy(b.dataset.buy); });
    for (const t of ['pointerdown', 'pointermove', 'touchstart', 'touchmove']) el.addEventListener(t, e => e.stopPropagation(), { passive: true });
    this.render();
    G.haptics?.select?.();
    void me;
  }
  close() { this.panel?.remove(); this.panel = null; }
  render() {
    const G = this.G, me = G.brothers.me, k = G.drone?.kit(me), el = this.panel; if (!el) return;
    const owned = it => it.kind === 'drone' ? !!k : it.kind === 'upgrade' ? !!k?.upgrades?.[it.upgrade] : it.kind === 'item' ? (me.items?.gadgets || []).includes(it.id) : false;
    const rows = CATEGORIES.map(cat => `<h3>${esc(cat)}</h3>` + CATALOGUE.filter(i => i.cat === cat).map(it => {
      const have = owned(it), needs = it.needs === 'drone' && !k, poor = cash(me) + 1e-6 < it.price;
      const label = have && !it.repeat ? 'Owned' : needs ? 'Needs a drone' : poor ? 'Not enough cash' : `Buy ${money(it.price)}`;
      return `<div class="tzItem${it.hero ? ' hero' : ''}"><div><b>${esc(it.name)}</b><small>${esc(it.blurb)}</small>${it.id === 'props' && k ? `<em>${Math.max(0, k.props ?? 0)} sets in the kit</em>` : ''}</div>
        <button data-buy="${it.id}" ${(have && !it.repeat) || needs || poor ? 'disabled' : ''}>${label}</button></div>`;
    }).join('')).join('');
    el.innerHTML = `<div class="tzHead"><canvas class="tzLogo" width="300" height="56"></canvas><span>${esc(me.short)} · ${money(cash(me))}</span><button data-close>Close</button></div>
      <div class="tzBody">${rows}<p class="tzNote">Gadgets, phones and accessories arriving soon.</p></div>`;
    const lc = el.querySelector('.tzLogo').getContext('2d'); lc.drawImage(logoCanvas(300, 56, { bg: '#0000', stripe: false, scale: 0.62 }), 0, 0);
  }
  buy(id) {
    const G = this.G, me = G.brothers.me, it = CATALOGUE.find(i => i.id === id); if (!it) return;
    if (!spend(me, it.price)) { G.hud?.toast?.('Not enough cash'); return; }
    if (it.kind === 'drone') { G.drone.give(me); G.hud?.toast?.('Kestrel T3 bought! Fly it with the Fly drone button, your phone\'s Drone app, or D-pad right on a pad', 5); }
    else if (it.kind === 'props') { G.drone.upgrade(me, 'props'); G.hud?.toast?.('4 spare prop sets in the kit'); }
    else if (it.kind === 'upgrade') { G.drone.upgrade(me, it.upgrade); G.hud?.toast?.(`${it.name} fitted`); }
    else { me.items ??= {}; (me.items.gadgets ??= []).push(it.id); G.hud?.toast?.(`${it.name} bought`); }
    G.haptics?.select?.(); G.audio?.play?.('Car_Door_Close', me.x, me.y + 1, me.z, 0.0001);
    G.save?.now?.();
    this.render();
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G;
    if (!this.ready && !this.init()) return;
    const me = G.brothers.me, IN = G.interiors.at(me);
    if (IN && this.plan(IN)) { this.decorate(IN); if (IN.techDemo) IN.techDemo.rotation.y += dt * 0.35, IN.techDemo.userData.leds?.(G.time, 'landed'); }
    // the till's panel closes when you walk away
    if (this.panel && (!IN || !this.prompt(IN, me))) this.close();
    // fascias over the doors of the stores near you
    if ((this._ft = (this._ft || 0) - dt) <= 0) {
      this._ft = 1;
      for (const t of this.stores) {
        if (t.mall) continue;
        const d = Math.hypot(t.x - me.x, t.z - me.z), have = this.fascias.get(t);
        if (d < 260 && !have && !t.signed) this.fascias.set(t, this.fascia(t));
        else if ((d > 320 || t.signed) && have) { G.scene.remove(have); have.geometry.dispose(); this.fascias.delete(t); }
      }
    }
  }
}
function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
