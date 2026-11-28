// Persistence: the player, owned vehicles, the world and the fleet of traffic around him, under one key.
const KEY = 'greenCounty.sandbox.v1';
// who the player is (and the name an older save's brother carries on under)
export const CAL = { name: 'Cal Ward', short: 'Cal', outfit: { jacket: 0, skin: 0, hair: 0 } };

export function llToWorld(fit, lon, lat) {
  const u = lon - fit.lon0, v = lat - fit.lat0;
  const t = [1, u, v, u * u, u * v, v * v, u * u * u, u * u * v, u * v * v, v * v * v];
  let x = 0, z = 0; for (let i = 0; i < t.length; i++) { x += fit.x[i] * t[i]; z += fit.z[i] * t[i]; }
  return [x, z];
}
// two brothers' kit as one (a save from before v0.47): rods, tickets and records together, tackle and bait added up
function mergeKit(a = {}, b = {}) {
  const out = { ...b, ...a };
  if (a.fishing && b.fishing) {
    const f = out.fishing = { ...b.fishing, ...a.fishing };
    for (const k of ['rods', 'tickets', 'pb', 'drag', 'clip', 'sel']) f[k] = { ...(b.fishing[k] || {}), ...(a.fishing[k] || {}) };
    for (const k of ['tackle', 'bait']) { f[k] = { ...(b.fishing[k] || {}) }; for (const [t, n] of Object.entries(a.fishing[k] || {})) f[k][t] = (f[k][t] || 0) + n; }
    f.log = [...(a.fishing.log || []), ...(b.fishing.log || [])];
  }
  return out;
}

export class Save {
  constructor(G) {
    this.G = G; this.taken = new Set(); this.data = null;
    try { this.data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { this.data = null; }
    if (this.data) for (const id of this.data.taken || []) this.taken.add(id);
  }
  // the player at the start: as saved, or a fresh start in Woodley. A save from the two-brother game (before v0.47)
  // carries on as whichever brother was being played, as Cal, with both brothers' money and kit
  initialBrothers(start) {
    const d = this.data;
    if (d?.brothers?.length) {
      const i = Math.min(d.active ?? 0, d.brothers.length - 1), me = { ...d.brothers[i] };
      if (d.brothers.length > 1) {
        const other = d.brothers[1 - i] || {};
        me.cash = (me.cash ?? 1500) + (other.cash ?? 1500);
        me.items = mergeKit(me.items, other.items);
      }
      Object.assign(me, { name: CAL.name, short: CAL.short, outfit: { ...CAL.outfit } });
      return { brothers: [me], active: 0, camYaw: d.camYaw };
    }
    return { brothers: [{ ...CAL, outfit: { ...CAL.outfit }, x: start.x, y: 0, z: start.z, heading: start.h, vehicle: null }], active: 0 };
  }
  markVehicle(v) { v.free = true; if (v.id.startsWith('p:')) this.taken.add(v.id); this.dirty = true; }
  collect() {
    const G = this.G, B = G.brothers;
    const vehicles = G.traffic.list.filter(v => v.free || v.owner).map(v => ({ id: v.id, model: v.model, paint: v.paint, x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2), heading: +v.heading.toFixed(3), owner: v.owner || null, parkedBy: v.parkedBy || null, dmg: v.dmg && v.dmg.some(d => d > 0.01) ? v.dmg.map(d => +d.toFixed(2)) : undefined, fuel: v.fuel != null ? +v.fuel.toFixed(4) : undefined }));
    return {
      version: 1, mode: 'sandbox', savedAt: new Date().toISOString(),
      brothers: B.b.map(b => ({ ...b })), active: 0, camYaw: B.cam.yaw,
      vehicles, taken: [...this.taken].slice(-2000),
      // simulated traffic near the player (ids, routes, edge and position), restored on load
      fleet: G.traffic.snapshotFleet ? G.traffic.snapshotFleet(B.b.map(b => ({ x: b.x, z: b.z }))) : null,
      world: G.world.s,
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
