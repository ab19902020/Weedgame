// Persistence. Sandbox saves live under their own key; the v0.3–v0.5 prototype save
// ('greenCounty') is read for migration and never overwritten.
const KEY = 'greenCounty.sandbox.v1', LEGACY = 'greenCounty';

export function llToWorld(fit, lon, lat) {
  const u = lon - fit.lon0, v = lat - fit.lat0;
  const t = [1, u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v];
  let x = 0, z = 0; for (let i = 0; i < t.length; i++) { x += fit.x[i] * t[i]; z += fit.z[i] * t[i]; }
  return [x, z];
}
// legacy prototype projection: x=(lon+.99)*69400, y=(51.48-lat)*111100
export function legacyToWorld(fit, x, y) { return llToWorld(fit, x / 69400 - 0.99, 51.48 - y / 111100); }

export class Save {
  constructor(G) {
    this.G = G; this.taken = new Set(); this.data = null; this.legacy = null; this.migrated = false;
    try { this.data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { this.data = null; }
    try { this.legacy = JSON.parse(localStorage.getItem(LEGACY) || 'null'); } catch { this.legacy = null; }
    // Android: a save handed over from the previous file:// WebView origin
    if (!this.legacy && window.GCNative && GCNative.legacySave) { try { const s = GCNative.legacySave(); if (s) this.legacy = JSON.parse(s); } catch { } }
    if (this.data) for (const id of this.data.taken || []) this.taken.add(id);
  }
  // initial brothers state: saved, migrated from the prototype, or a fresh start in Woodley
  initialBrothers(start) {
    if (this.data?.brothers) return { brothers: this.data.brothers, active: this.data.active ?? 0, camYaw: this.data.camYaw };
    const fresh = (i, x, z, h) => ({ name: i ? 'Leon Ward' : 'Cal Ward', short: i ? 'Leon' : 'Cal', x, y: 0, z, heading: h, vehicle: null, outfit: { jacket: i, skin: i ? 1 : 0, hair: 0 } });
    const b = [fresh(0, start.x, start.z, start.h), fresh(1, start.x + 2.2, start.z + 1.2, start.h + 0.4)];
    const L = this.legacy;
    if (L && L.business && Array.isArray(L.business.positions)) {
      // keep each brother where the prototype left him (snapped to the nearest pavement later)
      this.migrated = true;
      L.business.positions.forEach((p, i) => { if (b[i] && Array.isArray(p)) { const [x, z] = legacyToWorld(this.G.manifest.llfit, p[0], p[1]); b[i].x = x; b[i].z = z; b[i].migrated = true; } });
      const w = L.business.wardrobe; if (Array.isArray(w)) w.forEach((o, i) => { if (b[i] && o) b[i].outfit = { jacket: o.jacket ?? i, skin: o.skin ?? 0, hair: o.hair ?? 0 }; });
      const active = L.business.active ?? 0;
      return { brothers: b, active, migratedFrom: 'prototype' };
    }
    return { brothers: b, active: 0 };
  }
  markVehicle(v) { v.free = true; if (v.id.startsWith('p:')) this.taken.add(v.id); this.dirty = true; }
  collect() {
    const G = this.G, B = G.brothers;
    const vehicles = G.traffic.list.filter(v => v.free || v.owner).map(v => ({ id: v.id, model: v.model, paint: v.paint, x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2), heading: +v.heading.toFixed(3), owner: v.owner || null, parkedBy: v.parkedBy || null, dmg: v.dmg && v.dmg.some(d => d > 0.01) ? v.dmg.map(d => +d.toFixed(2)) : undefined, fuel: v.fuel != null ? +v.fuel.toFixed(4) : undefined }));
    return {
      version: 1, mode: 'sandbox', savedAt: new Date().toISOString(),
      brothers: B.b.map(b => ({ ...b })), active: B.active, camYaw: B.cam.yaw,
      vehicles, taken: [...this.taken].slice(-2000),
      // simulated traffic near both brothers (ids, routes, edge and position), restored on load
      fleet: G.traffic.snapshotFleet ? G.traffic.snapshotFleet(B.b.map(b => ({ x: b.x, z: b.z }))) : null,
      world: G.world.s,
      // untouched business state from the prototype, kept for the future empire layer
      business: this.data?.business ?? (this.legacy ? { legacy: this.legacy } : null),
    };
  }
  now() {
    try { localStorage.setItem(KEY, JSON.stringify(this.collect())); this.dirty = false; this.last = performance.now(); return true; }
    catch (e) { console.warn('save failed', e); return false; }
  }
  tick() { if (performance.now() - (this.last || 0) > 8000) this.now(); }
  get world() { return this.data?.world; }
  get vehicles() { return this.data?.vehicles || []; }
  get fleet() { return this.data?.fleet || null; }
}
