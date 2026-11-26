// The brothers' weapons: ten from the Silo/Lost Signal armoury (Quaternius Ultimate Guns Pack, CC0 1.0,
// www/weapons/SOURCES.txt) with the owner's own firing and handling recordings (www/sfx/guns). Data only, so
// the catalogue can be checked without a browser (tools/test/unit/weapons.test.mjs).
//
// Every model is metric with the bore along +Z, up +Y and the gun's left +X. The points below were measured
// from the meshes themselves (the pistol grip is the 'Grip' material, the stock and handguard 'Furniture'):
//   grip      the middle of the pistol grip, where the right palm goes
//   gripAxis  down the grip, top to bottom (the fingers wrap round it)
//   fore      where the left hand holds (handguard, pump, the front of an SMG), or null one-handed
//   butt      the middle of the butt plate, which sits in the right shoulder (long guns)
//   muzzle    where the round leaves the barrel
//   sight     the rear sight (the eye lines up behind it when aiming a long gun)
// `scale` takes each low-poly model to a believable size in the brothers' hands (the pack's rifles are about
// two-thirds size). hold: 'pistol' (two hands on a handgun), 'smg' (held in front of the chest, no stock),
// 'rifle' (butt in the shoulder), 'knife'.
export const WEAPONS = [
  { key: 'knife', name: 'Combat knife', file: 'combat_knife', hold: 'knife', icon: 'knife', scale: 1.1,
    grip: [0, 0, -0.056], gripAxis: [0, 0, -1], blade: [0, 0, 0.12],
    melee: true, damage: 55, rpm: 150, reach: 1.7 },
  { key: 'pistol', name: 'Pistol', file: 'glock_19', hold: 'pistol', icon: 'pistol', scale: 1.2,
    grip: [0, -0.05, -0.033], gripAxis: [0, -0.89, -0.45], muzzle: [0, 0.017, 0.096], sight: [0, 0.03, -0.046],
    automatic: false, rpm: 400, mag: 15, reload: 1.4, reloadKind: 'pistol', damage: 30, spread: 0.012, range: 70, recoil: 0.14,
    fire: { sample: '9mm', rate: 1.0, gain: 0.9 } },
  { key: 'heavy', name: 'Heavy pistol', file: 'pistol_04', hold: 'pistol', icon: 'pistol', scale: 1.25,
    grip: [0, -0.05, -0.033], gripAxis: [0, -0.89, -0.45], muzzle: [0, 0.017, 0.118], sight: [0, 0.03, -0.046],
    automatic: false, rpm: 230, mag: 8, reload: 1.7, reloadKind: 'pistol', damage: 60, spread: 0.016, range: 80, recoil: 0.32,
    fire: { sample: '9mm', rate: 0.8, gain: 1.0 } },
  { key: 'uzi', name: 'Uzi', file: 'smg_01', hold: 'smg', icon: 'smg', scale: 1.3,
    grip: [0, -0.062, 0.028], gripAxis: [0, -0.89, 0.45], fore: [0, -0.04, 0.082], muzzle: [0, 0, 0.206], sight: [0, 0.043, -0.04],
    automatic: true, rpm: 950, mag: 32, reload: 1.7, reloadKind: 'pistol', damage: 18, spread: 0.035, range: 45, recoil: 0.1,
    fire: { sample: '9mm', rate: 1.08, gain: 0.75 } },
  { key: 'smg', name: 'Suppressed SMG', file: 'smg_02', hold: 'smg', icon: 'smg', scale: 1.3,
    grip: [0, -0.062, 0.028], gripAxis: [0, -0.89, 0.45], fore: [0, -0.04, 0.082], muzzle: [0, 0, 0.187], sight: [0, 0.043, -0.04],
    automatic: true, rpm: 900, mag: 30, reload: 1.75, reloadKind: 'pistol', damage: 17, spread: 0.024, range: 50, recoil: 0.08,
    fire: { sample: '9mm', rate: 1.25, gain: 0.32, muffle: 1400 } },
  { key: 'shotgun', name: 'Pump shotgun', file: 'mossberg_590a1', hold: 'rifle', icon: 'shotgun', scale: 1.35,
    grip: [0, -0.064, 0.024], gripAxis: [0, -0.89, 0.45], fore: [0, -0.034, 0.19], butt: [0, -0.012, -0.176], muzzle: [0, 0.006, 0.33], sight: [0, 0.023, -0.03],
    automatic: false, rpm: 75, mag: 8, reload: 3.0, reloadKind: 'shells', damage: 16, pellets: 9, spread: 0.06, range: 38, recoil: 0.48, pump: true,
    fire: { sample: '20g', rate: 1.0, gain: 1.0 } },
  { key: 'sawnoff', name: 'Sawn-off shotgun', file: 'shotgun_sawed_off', hold: 'smg', icon: 'shotgun', scale: 1.55,
    grip: [0, -0.04, -0.062], gripAxis: [0, -0.55, -0.83], fore: [0, -0.034, 0.1], muzzle: [0, 0.006, 0.17], sight: [0, 0.023, -0.03],
    automatic: false, rpm: 170, mag: 2, reload: 2.2, reloadKind: 'shells', damage: 15, pellets: 12, spread: 0.1, range: 22, recoil: 0.6,
    fire: { sample: '20g', rate: 0.94, gain: 1.0 } },
  { key: 'ak', name: 'Assault rifle', file: 'akm', hold: 'rifle', icon: 'rifle', scale: 1.35,
    grip: [0, -0.068, 0.058], gripAxis: [0, -0.91, 0.42], fore: [0, -0.026, 0.2], butt: [0, -0.012, -0.19], muzzle: [0, 0, 0.362], sight: [0, 0.043, -0.046],
    automatic: true, rpm: 600, mag: 30, reload: 2.3, reloadKind: 'ak', damage: 36, spread: 0.016, range: 120, recoil: 0.22,
    fire: { sample: '308', rate: 1.0, gain: 0.95 } },
  { key: 'carbine', name: 'Carbine', file: 'assault_rifle_01', hold: 'rifle', icon: 'rifle', scale: 1.35,
    grip: [0, -0.068, 0.056], gripAxis: [0, -0.91, 0.42], fore: [0, -0.026, 0.205], butt: [0, -0.004, -0.176], muzzle: [0, 0, 0.345], sight: [0, 0.043, -0.046],
    automatic: true, rpm: 760, mag: 30, reload: 2.1, reloadKind: 'ar', damage: 31, spread: 0.013, range: 110, recoil: 0.17,
    fire: { sample: '308', rate: 1.1, gain: 0.85 } },
  { key: 'sniper', name: 'Sniper rifle', file: 'sniper_rifle_02', hold: 'rifle', icon: 'sniper', scale: 1.35,
    grip: [0, -0.078, 0.036], gripAxis: [0, -0.91, 0.42], fore: [0, -0.034, 0.23], butt: [0, -0.012, -0.2], muzzle: [0, 0, 0.468], sight: [0, 0.055, -0.117],
    automatic: false, rpm: 46, mag: 5, reload: 2.9, reloadKind: 'bolt', damage: 160, spread: 0.0015, range: 320, recoil: 0.62, zoom: true, bolt: true,
    fire: { sample: '308', rate: 0.88, gain: 1.0 } },
];
export const BY_KEY = Object.fromEntries(WEAPONS.map(w => [w.key, w]));
export const SAMPLES = {
  '9mm': '9mm-single', '308': '308-single', '20g': '20-gauge-single',
  mag9Out: '9mm-mag-out', mag9In: '9mm-mag-in', rack: 'pistol-rack', reload1: 'pistol-reload-1', reload2: 'pistol-reload-2',
  akOut: 'ak-mag-out', akIn: 'ak-mag-in', arOut: 'ar-mag-out', arIn: 'ar-mag-in', boltOut: 'bolt-mag-out', boltIn: 'bolt-mag-in', shell: 'shotgun-load',
};
export const shotInterval = w => 60 / Math.max(1, w.rpm || 600);

// the reload, as the recordings that go with it: [sample, seconds in] (a shotgun takes its shells one at a time)
export function reloadCues(w) {
  const T = w.reload || 1.8;
  switch (w.reloadKind) {
    case 'shells': { const n = Math.min(w.mag, 4); return Array.from({ length: n }, (_, i) => ['shell', 0.2 + i * (T - 0.5) / n]).concat(w.pump ? [['rack', T - 0.2]] : []); }
    case 'ak': return [['akOut', 0.15], ['akIn', T * 0.55], ['rack', T - 0.25]];
    case 'ar': return [['arOut', 0.15], ['arIn', T * 0.55], ['rack', T - 0.25]];
    case 'bolt': return [['boltOut', 0.15], ['boltIn', T * 0.6]];
    default: return [['mag9Out', 0.08], [T < 1.5 ? 'reload1' : 'reload2', T * 0.4], ['mag9In', T * 0.56], ['rack', T - 0.3]];
  }
}
// the pellets or round of one shot: directions (unit vectors) scattered round `dir` by the weapon's spread
// (tighter when aimed); rnd is a 0..1 generator so tests can be repeatable
export function spreadDirs(w, dir, aimed, rnd = Math.random) {
  const n = w.pellets || 1, s = (w.spread || 0) * (aimed ? 0.55 : 1);
  // a frame round dir
  const up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const cx = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]];
  const cl = Math.hypot(...cx) || 1; for (let i = 0; i < 3; i++) cx[i] /= cl;
  const cy = [dir[1] * cx[2] - dir[2] * cx[1], dir[2] * cx[0] - dir[0] * cx[2], dir[0] * cx[1] - dir[1] * cx[0]];
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = s * Math.sqrt(rnd()), a = rnd() * Math.PI * 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
    const d = [dir[0] + cx[0] * u + cy[0] * v, dir[1] + cx[1] * u + cy[1] * v, dir[2] + cx[2] * u + cy[2] * v];
    const l = Math.hypot(...d); out.push([d[0] / l, d[1] / l, d[2] / l]);
  }
  return out;
}
