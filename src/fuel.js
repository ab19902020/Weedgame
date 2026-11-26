// Fuel: every car has a tank that empties as you drive (a full tank lasts about RANGE_KM: shorter than a real
// one, so you do call in for fuel), a gauge beside the speedometer, and the engine cuts out when it's dry. The
// petrol stations (www/world/interiors.json 'fuel', the forecourt canopies by the map's fuel-station shops) get
// pump islands, and a canopy where the world doesn't already draw one: pull up beside a pump, stop and Fill up.
// Paid from the brother's cash (restaurants.js). Stranded, you can ring a mate to bring a can.
import * as THREE from 'three/webgpu';
import { cash, spend } from './restaurants.js';

const TANK = { rangerover: 90, sports: 65, coupe: 60, hothatch: 50, hatch: 45, saloon: 60, estate: 60, suv: 70, van: 75, police: 60, moped: 7, dirtbike: 9, motorcycle: 15, bus: 0, busS: 0, escooter: 0 };
const RANGE_KM = 60, PRICE = 1.45, FILL_RATE = 0.14;   // tank fractions a second at the pump
export const tankOf = v => TANK[v.model] ?? 55;
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h >>> 0) % 1000) / 1000; };

export class Fuel {
  constructor(G) {
    this.G = G; this.stations = []; this.near = new Map(); this.filling = null; this.rescue = null; this.ready = false;
    this.group = new THREE.Group(); this.group.name = 'fuel stations'; G.scene.add(this.group);
    const M = (c, o = {}) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.55, ...o });
    this.mats = { plinth: M(0xb9b6ae, { roughness: 0.9 }), pump: M(0xf2f1ec), band: M(0x2f6f4a), dark: M(0x2a2c30), screen: new THREE.MeshBasicNodeMaterial({ color: 0x9fe0b0 }),
      roof: M(0xf4f4f2, { roughness: 0.4 }), fascia: M(0x2f6f4a, { roughness: 0.4 }), column: M(0xd8d8d4), hose: M(0x1a1a1a) };
    this.geo = { box: new THREE.BoxGeometry(1, 1, 1) };
  }
  load(list) {
    for (const s of list) {
      // the canopy's axes: u along the long side, v across it
      const c = Math.cos(s.ang), sn = Math.sin(s.ang);
      s.u = s.long === 'u' ? [c, sn] : [-sn, c]; s.v = [-s.u[1], s.u[0]];
      // pump islands spaced along the long side, each lying across it, a lane each side
      const n = Math.max(1, Math.min(4, Math.round(s.L / 6.2))), len = Math.max(2.6, Math.min(4.6, s.D - 1.4));
      s.islands = [];
      for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * s.L - s.L / 2; s.islands.push({ x: s.x + s.u[0] * a, z: s.z + s.u[1] * a, len }); }
      s.title = s.name;
    }
    this.stations = list; this.ready = true;
  }
  // ---------------------------------------------------------------- the tank
  level(v) {
    if (v.fuel == null) v.fuel = v.owner ? 0.8 : 0.25 + 0.6 * hash(v.id);
    return v.fuel;
  }
  hasTank(v) { return tankOf(v) > 0; }
  // called while you drive: burns fuel with distance and throttle; returns the throttle allowed (0 when dry)
  drive(v, dt, throttle) {
    if (!this.hasTank(v)) return throttle;
    const lv = this.level(v), dist = Math.abs(v.sp || 0) * dt;
    v.fuel = Math.max(0, lv - dist / (RANGE_KM * 1000) * (0.55 + 0.9 * Math.abs(throttle)) - dt / 14400);
    if (v.fuel <= 0) {
      if (!this._dryWarn) { this._dryWarn = true; this.G.hud?.toast?.('Out of petrol! The engine\'s died.', 4); }
      return 0;
    }
    if (v.fuel < 0.1 && !this._lowWarn) { this._lowWarn = true; this.G.hud?.toast?.('Fuel light\'s on: find a petrol station (on the map).', 4); }
    if (v.fuel > 0.12) this._lowWarn = this._dryWarn = false;
    return throttle;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.ready) return;
    const G = this.G, B = G.brothers, me = B.me, v = B.vehicleOf(me);
    if ((this._nearT = (this._nearT || 0) - dt) <= 0) { this._nearT = 0.7; this.refreshNear(me); }
    this.ui();
    // which pump you're at (in a car, stopped, beside an island)
    this.at = null;
    if (v && this.hasTank(v) && Math.abs(v.sp || 0) < 0.8) {
      for (const s of this.stations) {
        if (Math.hypot(s.x - v.x, s.z - v.z) > s.L / 2 + 12) continue;
        for (const isl of s.islands) {
          const dx = v.x - isl.x, dz = v.z - isl.z, along = dx * s.v[0] + dz * s.v[1], across = dx * s.u[0] + dz * s.u[1];
          if (Math.abs(along) < isl.len / 2 + 2.2 && Math.abs(across) > 0.8 && Math.abs(across) < 4.2) { this.at = s; break; }
        }
        if (this.at) break;
      }
    }
    // filling
    const f = this.filling;
    if (f) {
      if (!v || v !== f.v || Math.abs(v.sp || 0) > 0.8 || !this.at) this.stopFill('stopped');
      else {
        const T = tankOf(v), add = Math.min(1 - v.fuel, FILL_RATE * dt), cost = add * T * PRICE;
        if (cash(me) < cost + 0.01) this.stopFill('cash');
        else { spend(me, cost); v.fuel += add; f.litres += add * T; f.cost += cost; if (v.fuel >= 0.999) { v.fuel = 1; this.stopFill('full'); } }
      }
    }
    // a mate on his way with a can
    if (this.rescue && G.time >= this.rescue.at) { const rv = this.rescue.v; rv.fuel = Math.max(rv.fuel || 0, 0.12); this.rescue = null; G.hud?.toast?.('Your mate turns up with a can: about 10 litres in the tank. Get to a station.', 5); }
  }
  stopFill(why) {
    const f = this.filling; if (!f) return; this.filling = null;
    const me = this.G.brothers.me;
    if (f.litres > 0.05) this.G.hud?.toast?.(`${why === 'full' ? 'Full tank' : why === 'cash' ? 'Out of cash' : 'Stopped'}: ${f.litres.toFixed(1)} litres, £${f.cost.toFixed(2)}. ${me.short} has £${cash(me).toFixed(2)}.`, 4);
  }
  press() {
    const G = this.G, me = G.brothers.me, v = G.brothers.vehicleOf(me); if (!v) return;
    if (this.filling) { this.stopFill('stopped'); return; }
    if (this.at) { if (v.fuel >= 0.995) { G.hud?.toast?.('The tank\'s already full.'); return; } this.filling = { v, litres: 0, cost: 0 }; return; }
    if (v.fuel <= 0 && !this.rescue) {
      if (!spend(me, 20)) { G.hud?.toast?.('You need £20 for a mate to bring a can.'); return; }
      this.rescue = { v, at: G.time + 25 };
      G.hud?.toast?.('You ring a mate: he\'s bringing a can of petrol (£20). About half a minute.', 5);
    }
  }
  // the fuel gauge by the speedometer and the Fill up button
  ui() {
    const G = this.G, me = G.brothers.me, v = G.brothers.vehicleOf(me), sp = document.getElementById('speedo');
    if (!this.gaugeEl && sp) {
      this.gaugeEl = document.createElement('span'); this.gaugeEl.id = 'fuelGauge'; this.gaugeEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 3h9v18H4zM6 5v5h5V5zM14 8h2l3 3v7a2 2 0 0 1-4 0v-4h-1v-2h3v6h0V11.8L15.2 10H14z"/></svg><span class="fg-bar"><i></i></span>';
      sp.appendChild(this.gaugeEl);
      this.btn = document.createElement('button'); this.btn.id = 'fuelBtn'; this.btn.hidden = true; this.btn.onclick = () => this.press();
      (document.getElementById('hud') || document.body).appendChild(this.btn);
    }
    if (!this.gaugeEl) return;
    const tank = v && this.hasTank(v);
    this.gaugeEl.hidden = !tank;
    if (tank) { const lv = this.level(v); this.gaugeEl.lastChild.firstChild.style.width = Math.round(lv * 100) + '%'; this.gaugeEl.classList.toggle('low', lv < 0.12); }
    let text = '';
    if (tank && this.filling) text = `Filling · ${this.filling.litres.toFixed(1)} L · £${this.filling.cost.toFixed(2)} · Stop`;
    else if (tank && this.at) { const need = (1 - v.fuel) * tankOf(v); text = need < 0.2 ? `${this.at.title} · Full tank` : `Fill up · ${need.toFixed(0)} L · £${(need * PRICE).toFixed(2)}`; }
    else if (tank && v.fuel <= 0) text = this.rescue ? 'A mate\'s bringing a can…' : 'Out of petrol · Ring a mate (£20)';
    if (this.btn.dataset.t !== text) { this.btn.dataset.t = text; this.btn.textContent = text; this.btn.hidden = !text; this.btn.classList.toggle('on', !!this.filling); }
  }
  // ---------------------------------------------------------------- the stations near you
  refreshNear(me) {
    for (const s of this.stations) {
      const d = Math.hypot(s.x - me.x, s.z - me.z), have = this.near.get(s.id);
      if (d < 260 && !have) { const g = this.build(s); if (g) this.near.set(s.id, g); }
      else if (d > 300 && have) { this.group.remove(have); this.near.delete(s.id); }
    }
  }
  build(s) {
    const T = this.G.tiles, y0 = T.ground(s.x, s.z); if (y0 == null) return null;
    const grp = new THREE.Group(), box = (w, h, d, x, y, z, rot, mat) => { const m = new THREE.Mesh(this.geo.box, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
    const rot = -Math.atan2(s.v[1], s.v[0]);   // an island's length runs along v
    for (const isl of s.islands) {
      const g = T.ground(isl.x, isl.z) ?? y0;
      box(isl.len, 0.16, 1.1, isl.x, g + 0.08, isl.z, rot, this.mats.plinth);
      for (const k of [-0.28, 0.28]) {
        const px = isl.x + s.v[0] * isl.len * k, pz = isl.z + s.v[1] * isl.len * k;
        box(0.75, 1.85, 0.5, px, g + 0.16 + 0.925, pz, rot, this.mats.pump);
        box(0.77, 0.22, 0.52, px, g + 0.16 + 1.72, pz, rot, this.mats.band);
        for (const side of [-1, 1]) {
          box(0.42, 0.26, 0.02, px + s.u[0] * side * 0.26, g + 1.35, pz + s.u[1] * side * 0.26, rot, this.mats.screen);
          box(0.06, 0.35, 0.08, px + s.u[0] * side * 0.27 + s.v[0] * 0.25, g + 1.0, pz + s.u[1] * side * 0.27 + s.v[1] * 0.25, rot, this.mats.hose);
        }
      }
      // bollards at the island's ends
      for (const k of [-0.5, 0.5]) box(0.16, 0.8, 0.16, isl.x + s.v[0] * isl.len * k, g + 0.16 + 0.4, isl.z + s.v[1] * isl.len * k, rot, this.mats.band);
    }
    // the canopy, where the world doesn't already have one
    if (s.draw) {
      const H = 4.9, roofRot = -Math.atan2(s.u[1], s.u[0]);
      box(s.L, 0.35, s.D, s.x, y0 + H, s.z, roofRot, this.mats.roof);
      for (const side of [-1, 1]) box(s.L + 0.1, 0.7, 0.08, s.x + s.v[0] * side * s.D / 2, y0 + H + 0.05, s.z + s.v[1] * side * s.D / 2, roofRot, this.mats.fascia);
      for (const isl of s.islands) box(0.35, H, 0.35, isl.x, y0 + H / 2, isl.z, roofRot, this.mats.column);
    }
    this.group.add(grp);
    return grp;
  }
}
