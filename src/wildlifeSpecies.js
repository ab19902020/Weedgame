// Wildlife and pets of the map: who lives where and when they are about (wildlife.js moves and draws them).
// Grounded in what is recorded locally:
//  * the gravel-pit lakes (Dinton Pastures, South Lake, Whiteknights, Lea Farm): mallard, coot, moorhen,
//    great crested grebe, mute swan, Canada, greylag and Egyptian geese, black-headed gulls and grey herons
//    (Berkshire Ornithological Society; Berkshire Bird Records)
//  * Berkshire has been a red kite stronghold since their reintroduction in the 1990s; buzzards over farmland,
//    kestrels hovering over verges and the M4's embankments
//  * ring-necked parakeets have spread through Reading, Woodley and Calcot gardens over the last 20 years
//  * hedgehogs visit gardens across the county (RSPB garden survey), most active after midnight and avoiding
//    people and dogs (Bristol University); muntjac and roe deer come into gardens at the edge of town; badgers,
//    foxes, muntjac and roe deer are all recorded on the University's Whiteknights campus
//  * urban foxes are out at dusk, through the night and at dawn; by day they lie up in gardens and keep away
//    from busy places. Badgers avoid people more than foxes do (camera-trap studies).
// A place's habitat comes from the land cover raster (build_world.py LC), the water, the trees and how busy
// it is (peds.js footfall), so a fox in a shopping street at midday is vanishingly rare, ducks keep to the
// lakes, cows to the farmland and hedgehogs come out after dark.

export const LC = { grass: 0, road: 1, pavement: 2, building: 3, water: 4, wood: 5, farm: 6, park: 7, parking: 8, rail: 9, path: 10, garden: 11, plaza: 12, pitch: 13, allotment: 14, scrub: 15, cemetery: 16, hard: 17, brownfield: 18, sand: 19 };

// ---------------------------------------------------------------- time of day
// Animals keep to the sun, not the clock: activity curves are written for a day with sunrise at 6 and sunset at
// 18 ("solar hours"), and solarHour maps the real time onto it for the day of the year (NOAA approximation for
// Reading, as weather.js). Dog walking keeps to the clock.
export function sunTimes(tSec) {
  const d = new Date(tSec * 1000), start = Date.UTC(d.getUTCFullYear(), 0, 0), doy = (d.getTime() - start) / 86400000;
  const g = 2 * Math.PI / 365 * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const lat = 51.45 * Math.PI / 180, h0 = -0.833 * Math.PI / 180;
  const cosHa = (Math.sin(h0) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHa))) * 180 / Math.PI;
  const noon = 720 - 4 * -0.95 - eqt;                     // UTC minutes
  return { rise: noon - 4 * ha, set: noon + 4 * ha };     // UTC minutes of the day
}
export function solarHour(tSec) {
  const d = new Date(tSec * 1000), m = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60, { rise, set } = sunTimes(tSec);
  if (m >= rise && m < set) return 6 + 12 * (m - rise) / (set - rise);
  const night = 1440 - (set - rise), since = ((m - set) % 1440 + 1440) % 1440;
  return (18 + 12 * since / night) % 24;
}
// activity curves: index = (solar) hour, 0..1
export const ACT = {
  day: [0, 0, 0, 0, 0, 0.25, 0.85, 1, 1, 0.9, 0.8, 0.75, 0.7, 0.7, 0.7, 0.75, 0.8, 0.85, 0.6, 0.15, 0, 0, 0, 0],
  song: [0, 0, 0, 0, 0.1, 0.8, 1, 1, 0.75, 0.5, 0.4, 0.35, 0.3, 0.3, 0.3, 0.35, 0.45, 0.7, 0.8, 0.3, 0, 0, 0, 0],
  dawnDusk: [0.5, 0.45, 0.4, 0.45, 0.7, 1, 1, 0.85, 0.5, 0.3, 0.2, 0.15, 0.15, 0.15, 0.2, 0.25, 0.4, 0.6, 1, 1, 0.9, 0.75, 0.65, 0.55],
  fox: [1, 1, 1, 0.95, 0.9, 0.95, 0.7, 0.35, 0.15, 0.1, 0.08, 0.06, 0.06, 0.06, 0.06, 0.08, 0.1, 0.25, 0.75, 0.95, 1, 1, 1, 1],
  badger: [1, 1, 0.9, 0.7, 0.4, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.4, 0.8, 1, 1, 1],
  hedgehog: [1, 1, 0.95, 0.85, 0.55, 0.15, 0.03, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.05, 0.25, 0.5, 0.7, 0.85, 0.95],
  night: [1, 1, 1, 0.9, 0.6, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.6, 0.95, 1, 1, 1],
  bat: [0.9, 0.8, 0.65, 0.45, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 1, 1, 0.95, 0.9],
  owl: [1, 1, 0.9, 0.8, 0.6, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.7, 1, 1, 1, 1],
  cat: [0.7, 0.6, 0.5, 0.45, 0.5, 0.6, 0.7, 0.6, 0.45, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.45, 0.5, 0.6, 0.8, 0.85, 0.85, 0.8, 0.75, 0.7],
  soar: [0, 0, 0, 0, 0, 0, 0.05, 0.25, 0.5, 0.75, 0.95, 1, 1, 1, 1, 0.9, 0.7, 0.4, 0.05, 0, 0, 0, 0, 0],
  always: new Array(24).fill(1),
  swift: [0, 0, 0, 0, 0, 0.2, 0.6, 0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.9, 1, 0.8, 0.1, 0, 0, 0],
  // people walking their dogs (clock hours): before work, lunchtime, after work and a last walk
  walks: [0.02, 0.01, 0, 0, 0, 0.05, 0.4, 0.85, 0.75, 0.45, 0.35, 0.3, 0.35, 0.3, 0.25, 0.3, 0.45, 0.7, 0.85, 0.7, 0.55, 0.35, 0.18, 0.06],
};
export function active(curve, hour) {
  const c = ACT[curve] || curve, h0 = Math.floor(((hour % 24) + 24) % 24), f = hour - Math.floor(hour);
  return c[h0] * (1 - f) + c[(h0 + 1) % 24] * f;
}

// ---------------------------------------------------------------- habitat
// One of: water, shore (land within 25 m of water), wood, scrub, farm, meadow (open grass out of town), park
// (parks, pitches, cemeteries, allotments), garden, verge (grass in town), town (pavements, plazas, car parks,
// hard standing), road, rail, building.
export function habitatKey(h) {
  const c = h.lc;
  if (c === LC.water) return 'water';
  if (c === LC.building) return 'building';
  if (c === LC.road) return 'road';
  if (c === LC.rail) return 'rail';
  if (h.waterD < 25) return 'shore';
  if (c === LC.wood) return 'wood';
  if (c === LC.scrub || c === LC.brownfield) return 'scrub';
  if (c === LC.farm) return 'farm';
  if (c === LC.park || c === LC.pitch || c === LC.cemetery || c === LC.allotment) return 'park';
  if (c === LC.garden) return 'garden';
  if (c === LC.grass || c === LC.sand || c === LC.path) return h.urban < 0.18 ? 'meadow' : 'verge';
  return 'town';   // pavement, plaza, parking, hard standing
}

// ---------------------------------------------------------------- species
// plan: body plan for wildlife.js (quad, bird, water, raptor, hog, bat); hab: habitat suitability; act: activity
// curve; shy: [by day, by night] how strongly a busy place (people about) keeps them away (0 not at all; the
// feral pigeons like the crowds: negative); dens: relative abundance; group: [min, max]; cap: most at once; draw:
// distance they are drawn to (m); flee: how close a person on foot gets before they go; speed: [walk, run] m/s;
// site: kept in fixed places (herds in their fields, the lake's waterfowl, warrens, setts) rather than passing
// through; trees: needs trees about; move: how they get about. Colours are packed 0xRRGGBB.
export const SPECIES = {
  // ---- pets
  cat: { name: 'cat', plan: 'quad', hab: { garden: 1, verge: 0.45, park: 0.15, scrub: 0.2, farm: 0.08, town: 0.05, shore: 0.1 }, act: 'cat', shy: [0.45, 0.15], dens: 3, group: [1, 1], cap: 5, draw: 90, flee: 5, speed: [0.7, 4.5], move: 'walk', roads: true },
  dog: { name: 'dog', plan: 'quad', walked: true, draw: 140, speed: [1.3, 5] },
  // ---- farm: herds keep to their fields
  cow: { name: 'cow', plan: 'quad', site: 'herd', hab: { meadow: 1, farm: 0.3 }, act: 'always', group: [6, 16], cap: 48, draw: 320, flee: 3, speed: [0.5, 2.5], move: 'walk', calm: true },
  sheep: { name: 'sheep', plan: 'quad', site: 'herd', hab: { meadow: 1, farm: 0.3 }, act: 'always', group: [10, 26], cap: 60, draw: 260, flee: 11, speed: [0.6, 3.5], move: 'walk' },
  horse: { name: 'horse', plan: 'quad', site: 'herd', hab: { meadow: 1, farm: 0.3 }, act: 'always', group: [1, 4], cap: 10, draw: 320, flee: 4, speed: [1, 5], move: 'walk', calm: true },
  // ---- wild mammals
  fox: { name: 'red fox', plan: 'quad', hab: { garden: 0.9, park: 0.9, scrub: 1, wood: 0.8, farm: 0.6, meadow: 0.8, shore: 0.75, verge: 0.6, town: 0.35, rail: 0.4 }, act: 'fox', shy: [1.6, 0.25], dens: 0.5, group: [1, 1], cap: 3, draw: 150, flee: 14, speed: [1.2, 6.5], move: 'walk', roads: true, eyeshine: 1 },
  badger: { name: 'badger', plan: 'quad', site: 'sett', hab: { wood: 1, scrub: 0.8, farm: 0.55, meadow: 0.5, park: 0.3, garden: 0.2 }, act: 'badger', shy: [3, 1], dens: 0.3, group: [1, 3], cap: 4, draw: 110, flee: 16, speed: [0.8, 4], move: 'walk', eyeshine: 1 },
  hedgehog: { name: 'hedgehog', plan: 'hog', hab: { garden: 1, park: 0.6, scrub: 0.45, meadow: 0.3, verge: 0.3, wood: 0.25, shore: 0.2 }, act: 'hedgehog', shy: [2, 1], dens: 1.5, group: [1, 1], cap: 3, draw: 60, flee: 3, speed: [0.35, 0.9], move: 'walk' },
  rabbit: { name: 'rabbit', plan: 'quad', site: 'warren', hab: { meadow: 1, farm: 0.7, scrub: 0.8, park: 0.35, verge: 0.45, wood: 0.3 }, act: 'dawnDusk', shy: [1, 0.5], dens: 0.9, group: [2, 7], cap: 14, draw: 90, flee: 14, speed: [0.6, 7], move: 'hop' },
  hare: { name: 'brown hare', plan: 'quad', hab: { farm: 1, meadow: 0.6 }, act: 'dawnDusk', shy: [2, 1], dens: 0.12, group: [1, 2], cap: 2, draw: 140, flee: 25, speed: [1, 12], move: 'hop' },
  squirrel: { name: 'grey squirrel', plan: 'quad', hab: { park: 1, wood: 1, garden: 0.8, verge: 0.25, town: 0.08, shore: 0.4 }, act: 'day', shy: [0.3, 0], dens: 3, group: [1, 3], cap: 8, draw: 70, flee: 5, speed: [0.8, 5], move: 'hop', trees: 2 },
  muntjac: { name: 'muntjac', plan: 'quad', hab: { wood: 1, scrub: 1, garden: 0.35, park: 0.3, farm: 0.3, meadow: 0.3 }, act: 'dawnDusk', shy: [2, 0.8], dens: 0.22, group: [1, 1], cap: 2, draw: 120, flee: 18, speed: [0.8, 7], move: 'walk', eyeshine: 1 },
  roe: { name: 'roe deer', plan: 'quad', hab: { wood: 0.8, farm: 0.8, meadow: 0.7, scrub: 0.6 }, act: 'dawnDusk', shy: [3, 1], dens: 0.16, group: [1, 3], cap: 3, draw: 220, flee: 40, speed: [1, 10], move: 'walk', eyeshine: 1 },
  rat: { name: 'brown rat', plan: 'quad', hab: { shore: 1, town: 0.35, park: 0.3, farm: 0.25, garden: 0.15 }, act: 'night', shy: [2, 0.5], dens: 2, group: [1, 2], cap: 3, draw: 40, flee: 4, speed: [0.6, 3], move: 'walk' },
  mouse: { name: 'wood mouse', plan: 'quad', hab: { wood: 1, scrub: 1, meadow: 0.8, farm: 0.6, garden: 0.4, park: 0.3 }, act: 'night', shy: [2, 1], dens: 2, group: [1, 1], cap: 3, draw: 25, flee: 2, speed: [0.3, 2.2], move: 'hop' },
  // ---- birds on the ground and in the trees (perch in tree crowns, nest in some)
  woodpigeon: { name: 'wood pigeon', plan: 'bird', hab: { park: 1, garden: 1, farm: 0.9, meadow: 0.7, wood: 0.6, verge: 0.6, town: 0.3, shore: 0.4 }, act: 'day', shy: [0.1, 0], dens: 1.2, group: [1, 5], cap: 16, draw: 80, flee: 6, speed: [0.5, 9], move: 'perch' },
  pigeon: { name: 'feral pigeon', plan: 'bird', hab: { town: 1, park: 0.3, verge: 0.25, rail: 0.4, shore: 0.2 }, act: 'day', shy: [-0.6, 0], dens: 1.3, group: [4, 14], cap: 26, draw: 70, flee: 3, speed: [0.5, 9], move: 'ground' },
  crow: { name: 'carrion crow', plan: 'bird', hab: { farm: 1, meadow: 1, park: 0.8, verge: 0.7, shore: 0.4, town: 0.3 }, act: 'day', shy: [0.3, 0], dens: 0.8, group: [1, 4], cap: 8, draw: 110, flee: 12, speed: [0.6, 10], move: 'ground' },
  magpie: { name: 'magpie', plan: 'bird', hab: { garden: 1, park: 1, verge: 0.8, farm: 0.4, town: 0.2, scrub: 0.6 }, act: 'day', shy: [0.3, 0], dens: 0.7, group: [1, 2], cap: 6, draw: 80, flee: 9, speed: [0.6, 9], move: 'ground' },
  jackdaw: { name: 'jackdaw', plan: 'bird', hab: { farm: 0.6, park: 0.6, town: 0.5, meadow: 0.5 }, act: 'day', shy: [0.3, 0], dens: 0.45, group: [2, 8], cap: 10, draw: 90, flee: 9, speed: [0.6, 10], move: 'ground' },
  robin: { name: 'robin', plan: 'bird', hab: { garden: 1, park: 0.9, wood: 0.8, scrub: 0.6 }, act: 'song', shy: [0.4, 0], dens: 0.6, group: [1, 1], cap: 4, draw: 35, flee: 3, speed: [0.4, 7], move: 'perch', trees: 1 },
  blackbird: { name: 'blackbird', plan: 'bird', hab: { garden: 1, park: 1, wood: 0.8, verge: 0.5, scrub: 0.6 }, act: 'song', shy: [0.4, 0], dens: 0.8, group: [1, 2], cap: 5, draw: 40, flee: 4, speed: [0.5, 8], move: 'ground' },
  bluetit: { name: 'blue tit', plan: 'bird', hab: { garden: 1, wood: 1, park: 0.9, scrub: 0.6 }, act: 'day', shy: [0.4, 0], dens: 0.7, group: [1, 4], cap: 6, draw: 30, flee: 3, speed: [0.4, 7], move: 'perch', trees: 1 },
  sparrow: { name: 'house sparrow', plan: 'bird', hab: { garden: 1, town: 0.55, farm: 0.4, verge: 0.4 }, act: 'day', shy: [0.1, 0], dens: 0.8, group: [3, 10], cap: 14, draw: 35, flee: 4, speed: [0.4, 7], move: 'ground' },
  starling: { name: 'starling', plan: 'bird', hab: { park: 1, garden: 0.8, verge: 0.6, farm: 0.6, town: 0.45 }, act: 'day', shy: [0.2, 0], dens: 0.7, group: [4, 18], cap: 24, draw: 60, flee: 6, speed: [0.6, 10], move: 'ground' },
  parakeet: { name: 'ring-necked parakeet', plan: 'bird', hab: { park: 1, garden: 0.9, wood: 0.6, verge: 0.3 }, act: 'day', shy: [0.3, 0], dens: 0.35, group: [2, 9], cap: 12, draw: 90, flee: 10, speed: [0.5, 14], move: 'perch', trees: 2 },
  pheasant: { name: 'pheasant', plan: 'bird', hab: { farm: 1, wood: 0.8, scrub: 0.6, meadow: 0.6 }, act: 'day', shy: [1, 0], dens: 0.2, group: [1, 3], cap: 4, draw: 110, flee: 10, speed: [0.7, 9], move: 'ground' },
  greenpecker: { name: 'green woodpecker', plan: 'bird', hab: { park: 1, meadow: 0.6, garden: 0.5, farm: 0.3 }, act: 'day', shy: [0.8, 0], dens: 0.2, group: [1, 1], cap: 2, draw: 60, flee: 12, speed: [0.4, 9], move: 'ground' },
  gull: { name: 'black-headed gull', plan: 'bird', hab: { water: 1, shore: 1, park: 0.6, farm: 0.4, town: 0.35 }, act: 'day', shy: [0.2, 0], dens: 0.6, group: [2, 12], cap: 14, draw: 130, flee: 10, speed: [0.5, 11], move: 'ground' },
  heron: { name: 'grey heron', plan: 'bird', hab: { shore: 1 }, act: 'dawnDusk', shy: [1.2, 0.3], dens: 0.3, group: [1, 1], cap: 2, draw: 170, flee: 25, speed: [0.4, 7], move: 'wade' },
  rook: { name: 'rook', plan: 'bird', site: 'rookery', hab: { farm: 1, meadow: 0.9, park: 0.5, verge: 0.3 }, act: 'day', shy: [0.5, 0], group: [6, 16], cap: 18, draw: 150, flee: 15, speed: [0.6, 10], move: 'ground' },
  owl: { name: 'tawny owl', plan: 'bird', hab: { wood: 1, park: 0.8, garden: 0.35, scrub: 0.4 }, act: 'owl', shy: [1, 0.3], dens: 0.2, group: [1, 1], cap: 2, draw: 70, flee: 8, speed: [0.5, 9], move: 'perch', trees: 3 },
  // ---- birds of prey overhead
  redkite: { name: 'red kite', plan: 'raptor', hab: { farm: 1, meadow: 1, wood: 0.8, park: 0.7, verge: 0.8, garden: 0.6, town: 0.45, shore: 0.7, road: 0.6 }, act: 'soar', shy: [0, 0], dens: 0.55, group: [1, 3], cap: 4, draw: 650, flee: 0, speed: [9, 14], move: 'soar', alt: [28, 75] },
  buzzard: { name: 'buzzard', plan: 'raptor', hab: { farm: 1, wood: 1, meadow: 0.9, scrub: 0.7 }, act: 'soar', shy: [0, 0], dens: 0.3, group: [1, 2], cap: 2, draw: 550, flee: 0, speed: [8, 13], move: 'soar', alt: [35, 85] },
  kestrel: { name: 'kestrel', plan: 'raptor', hab: { verge: 1, meadow: 1, farm: 0.8, road: 0.5 }, act: 'day', shy: [0.3, 0], dens: 0.15, group: [1, 1], cap: 1, draw: 220, flee: 0, speed: [6, 12], move: 'hover', alt: [9, 18] },
  // ---- on the water (the lakes' resident flocks)
  mallard: { name: 'mallard', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [2, 9], cap: 30, draw: 110, flee: 8, speed: [0.5, 2], move: 'swim' },
  coot: { name: 'coot', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [1, 5], cap: 16, draw: 90, flee: 9, speed: [0.5, 2], move: 'swim' },
  moorhen: { name: 'moorhen', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [1, 2], cap: 6, draw: 70, flee: 8, speed: [0.4, 2], move: 'swim' },
  grebe: { name: 'great crested grebe', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [1, 2], cap: 6, draw: 120, flee: 15, speed: [0.5, 2.5], move: 'swim' },
  tufted: { name: 'tufted duck', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [2, 8], cap: 16, draw: 110, flee: 14, speed: [0.5, 2], move: 'swim' },
  swan: { name: 'mute swan', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [1, 2], cap: 6, draw: 220, flee: 5, speed: [0.4, 1.5], move: 'swim' },
  canada: { name: 'Canada goose', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [3, 14], cap: 30, draw: 180, flee: 10, speed: [0.5, 2], move: 'swim', grazes: true },
  greylag: { name: 'greylag goose', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [2, 8], cap: 14, draw: 180, flee: 12, speed: [0.5, 2], move: 'swim', grazes: true },
  egyptian: { name: 'Egyptian goose', plan: 'water', site: 'lake', hab: { water: 1 }, act: 'always', group: [2, 4], cap: 6, draw: 160, flee: 12, speed: [0.5, 2], move: 'swim', grazes: true },
  // ---- summer visitors that live on the wing (May to August): swifts screaming round the rooftops, swallows
  // skimming the fields and the water for insects
  swift: { name: 'swift', plan: 'aerial', hab: { town: 1, garden: 1, verge: 0.8, park: 0.7, water: 0.7, shore: 0.7, meadow: 0.4, farm: 0.3, road: 0.6, building: 1 }, act: 'swift', shy: [0, 0], dens: 0.5, group: [3, 9], cap: 12, draw: 160, flee: 0, speed: [9, 15], move: 'aerial', alt: [14, 45], months: [4, 5, 6, 7] },
  swallow: { name: 'swallow', plan: 'aerial', hab: { farm: 1, meadow: 1, water: 1, shore: 0.9, park: 0.4 }, act: 'day', shy: [0, 0], dens: 0.5, group: [2, 6], cap: 8, draw: 90, flee: 0, speed: [7, 11], move: 'aerial', alt: [1, 6], months: [3, 4, 5, 6, 7, 8] },
  // ---- bats over water, trees and street lights at dusk
  bat: { name: 'pipistrelle bat', plan: 'bat', hab: { shore: 1, water: 0.8, wood: 0.8, park: 0.8, garden: 0.7, verge: 0.3, meadow: 0.4 }, act: 'bat', shy: [0, 0], dens: 0.6, group: [1, 4], cap: 6, draw: 40, flee: 0, speed: [4, 7], move: 'flutter' },
};

// ---------------------------------------------------------------- the young (the game is set in June)
// months 0 = January; n: how many with a parent (or, for lambs and calves, the share of the flock or herd)
export const YOUNG = {
  mallard: { months: [3, 4, 5, 6], p: 0.45, n: [3, 9], scale: 0.4, coat: 'duckling', follow: true },
  swan: { months: [4, 5, 6, 7, 8], p: 0.7, n: [2, 6], scale: 0.48, coat: 'cygnet', follow: true },
  canada: { months: [3, 4, 5, 6], p: 0.5, n: [2, 6], scale: 0.42, coat: 'gosling', follow: true },
  greylag: { months: [3, 4, 5, 6], p: 0.4, n: [2, 5], scale: 0.42, coat: 'gosling', follow: true },
  coot: { months: [3, 4, 5, 6], p: 0.3, n: [1, 4], scale: 0.45, coat: 'cootchick', follow: true },
  sheep: { months: [2, 3, 4, 5, 6], share: 0.4, scale: 0.6 },
  cow: { months: [1, 2, 3, 4, 5, 6, 7, 8, 9], share: 0.2, scale: 0.55, beef: true },
};
export const isYoungSeason = (key, month) => !!YOUNG[key] && YOUNG[key].months.includes(month);

// ---------------------------------------------------------------- calls (for when recordings of them are in the sound bank)
// rate: calls per minute while about; act: an activity curve that shapes it (the dawn chorus); night: also at night
export const CALLS = {
  dog: { call: 'bark', rate: 0.8 }, cat: { call: 'meow', rate: 0.25 },
  cow: { call: 'moo', rate: 0.35 }, sheep: { call: 'baa', rate: 1.2 }, horse: { call: 'snort', rate: 0.3 },
  fox: { call: 'foxbark', rate: 0.25, night: true }, muntjac: { call: 'muntjac', rate: 0.5, night: true }, roe: { call: 'roebark', rate: 0.15, night: true },
  woodpigeon: { call: 'coo', rate: 1.2, act: 'song' }, pigeon: { call: 'pigeon', rate: 1.5 }, crow: { call: 'caw', rate: 1.2 }, rook: { call: 'rook', rate: 2.5 },
  magpie: { call: 'chatter', rate: 0.8 }, jackdaw: { call: 'chack', rate: 1.5 }, robin: { call: 'robin', rate: 3, act: 'song', night: true },
  blackbird: { call: 'blackbird', rate: 2.5, act: 'song' }, bluetit: { call: 'tit', rate: 2.5, act: 'song' }, sparrow: { call: 'cheep', rate: 4 },
  starling: { call: 'starling', rate: 2 }, parakeet: { call: 'parakeet', rate: 3 }, pheasant: { call: 'pheasant', rate: 0.4 },
  greenpecker: { call: 'yaffle', rate: 0.5 }, gull: { call: 'gull', rate: 1.5 }, heron: { call: 'heron', rate: 0.15 }, owl: { call: 'hoot', rate: 1.2, night: true },
  redkite: { call: 'kite', rate: 0.5 }, swift: { call: 'swift', rate: 3 }, swallow: { call: 'twitter', rate: 1.5 }, buzzard: { call: 'mew', rate: 0.4 }, mallard: { call: 'quack', rate: 0.8 }, coot: { call: 'coot', rate: 0.8 },
  moorhen: { call: 'moorhen', rate: 0.5 }, canada: { call: 'honk', rate: 1 }, greylag: { call: 'honk2', rate: 0.6 }, egyptian: { call: 'egyptian', rate: 0.5 },
};

// how much a busy place keeps a species away: people about (peds.js footfall; a quiet close ~0.2, a shopping
// street on a Saturday afternoon ~110). shy < 0: the species seeks the crowds (pigeons around people eating)
export function busyFactor(sp, busy, night) {
  const s = sp.shy ? sp.shy[night ? 1 : 0] : 0;
  if (s < 0) return Math.min(2.5, 1 - s * Math.min(1, busy / 40));
  return Math.exp(-Math.max(0, busy) * s / 10);
}
// relative chance of meeting this species at a place (habitat h: from habitatAt) at a solar hour
export function suitability(sp, h, hour) {
  const key = h.key || habitatKey(h);
  let k = (sp.hab && sp.hab[key]) || 0;
  if (!k) return 0;
  if (sp.trees && (h.trees || 0) < sp.trees) k *= 0.15;     // tree birds and squirrels need trees about
  if (h.bigRoad && sp.move !== 'soar' && sp.move !== 'hover' && sp.move !== 'aerial' && sp.plan !== 'bird') k *= 0.25;   // the din of a main road
  const night = active('night', hour) > 0.5;
  return k * active(sp.act, hour) * busyFactor(sp, h.busy || 0, night);
}
// rain keeps small birds, bats and most mammals under cover; ducks don't mind
export function weatherFactor(sp, rain) {
  if (sp.move === 'swim' || sp.site === 'herd') return 1;
  if (sp.move === 'flutter') return 1 - Math.min(1, rain * 1.6);
  return 1 - Math.min(0.8, rain * (sp.plan === 'bird' || sp.plan === 'raptor' ? 0.9 : 0.5));
}
