// A made-up stretch of Berkshire for the wildlife tests (wildlifeSim.js runs on it as it runs on the game's map):
// a gravel-pit lake, farmland with its fields, a wood, a park, gardens and houses, and a busy town centre.
import { LC } from '../../../src/wildlifeSpecies.js';

export const PLACES = {
  lake: { x: 300, z: 0 },          // the middle of the lake (radius 90 m)
  lakeside: { x: 300, z: 100 },    // the path round it
  farm: { x: -420, z: 0 },         // fields: pasture (south) and ploughland (north)
  wood: { x: -230, z: 0 },
  park: { x: 0, z: 0 },
  gardens: { x: 0, z: 330 },       // houses with back gardens
  centre: { x: 0, z: -360 },       // shops, pavements and squares
};
export function landcover(x, z) {
  if (Math.abs(x) > 700 || Math.abs(z) > 700) return null;   // off the map (not loaded)
  if ((x - 300) ** 2 + z ** 2 < 90 * 90) return LC.water;
  if (x < -300) return Math.abs(z % 160) < 3 ? LC.scrub : z > 0 ? LC.grass : LC.farm;   // pasture to the south, ploughland to the north, hedges between
  if (x < -160) return LC.wood;
  if (z > 220) {   // houses: a street every 60 m, houses on it, gardens behind
    const m = ((z - 220) % 60 + 60) % 60;
    if (m < 7) return LC.road;
    if (m < 10) return LC.pavement;
    if (m < 22) return (Math.floor(x / 9) % 2) ? LC.building : LC.garden;
    return LC.garden;
  }
  if (z < -250) {   // the town centre
    const m = ((x % 50) + 50) % 50;
    if (m < 14) return LC.building;
    if (m < 22) return LC.pavement;
    if (m < 30) return LC.plaza;
    return LC.building;
  }
  if (Math.abs(z - 160) < 5) return LC.road;
  if (Math.abs(x - 120) < 2) return LC.path;
  return LC.park;
}
export function makeWorld(opts = {}) {
  const state = { t: opts.time ?? Date.UTC(2026, 5, 15, 11, 0) / 1000, rain: 0, focus: { x: 0, y: 40, z: 0, speed: 0, vehicle: false, vspeed: 0 }, look: { x: 1, z: 0 }, peds: [], cars: [] };
  const trees = [];
  for (let x = -690; x < 690; x += 11) for (let z = -690; z < 690; z += 11) {
    const c = landcover(x, z), r = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    if ((c === LC.wood && r < 0.75) || (c === LC.park && r < 0.12) || (c === LC.garden && r < 0.25) || (c === LC.farm && r < 0.02)) trees.push([x + r * 3, z - r * 3, 8 + r * 10, 40]);
  }
  const W = {
    lc: (x, z) => landcover(x, z),
    ground: (x, z) => (landcover(x, z) == null ? null : landcover(x, z) === LC.water ? 38 : 40),
    water: (x, z) => (landcover(x, z) === LC.water ? 40 : null),
    trees: (x, z, r) => trees.filter(t => (t[0] - x) ** 2 + (t[1] - z) ** 2 < r * r),
    treesLoaded: (x, z) => landcover(x, z) != null,
    busy: (x, z) => {
      const h = new Date(state.t * 1000).getUTCHours() + 1, day = h > 7 && h < 21 ? 1 : 0.08;
      return (z < -250 ? 100 : z > 220 ? 6 : 3) * day;
    },
    bigRoad: () => false,
    blocked: (x, z) => landcover(x, z) === LC.building,
    // the camera: at the player, looking along state.look with a 100 degree field of view, 600 m deep
    visible: (x, y, z, r) => {
      const dx = x - state.focus.x, dz = z - state.focus.z, d = Math.hypot(dx, dz);
      if (d < r) return true;
      if (d > 600) return false;
      return (dx * state.look.x + dz * state.look.z) / d > Math.cos(50 * Math.PI / 180) - r / d;
    },
    time: () => state.t, clock: () => (new Date(state.t * 1000).getUTCHours() + 1 + new Date(state.t * 1000).getUTCMinutes() / 60) % 24,
    rain: () => state.rain, wind: () => ({ x: 2, z: 1 }),
    focus: () => state.focus, peds: () => state.peds, cars: () => state.cars,
  };
  return { W, state, trees };
}
// people walking up and down the path and the streets (as peds.js would move them)
export function walkers(state, n, place, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) state.peds.push({ id: 'p' + (i + 1 + seed * 1000), x: place.x + (rnd() - 0.5) * 80, z: place.z + (rnd() - 0.5) * 80, y: 40, heading: rnd() * 6.28, speed: 1.3, speedNow: 1.3, mode: 'walk' });
}
export function movePeds(state, dt) {
  for (const p of state.peds) {
    p.x += Math.cos(p.heading) * p.speedNow * dt; p.z += Math.sin(p.heading) * p.speedNow * dt;
    const c = landcover(p.x, p.z);
    if (c == null || c === LC.water || c === LC.building) { p.x -= Math.cos(p.heading) * p.speedNow * dt * 2; p.z -= Math.sin(p.heading) * p.speedNow * dt * 2; p.heading += 2; }
  }
}
