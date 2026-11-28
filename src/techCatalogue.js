// What TechZone sells (techShop.js shows it at the till; prices in pounds).
// To add stock: add an entry here. `kind` decides what buying it does:
//   drone    the drone itself (drone.js: give)            needs: none
//   props    spare propeller sets for the drone           needs: 'drone'
//   upgrade  a one-off drone upgrade (drone.js spec)      needs: 'drone', upgrade: the key drone.js reads
//   item     anything else: kept in the brother's bag (b.items.gadgets), ready for a feature to use it
//   fishing  fishing gear (fishing.js kitOf): fish.rod = a rod (float / carp / lure) sold rigged and ready;
//            fish.gear = net / mat / catapult; fish.tackle + n = spare hooks, floats, hair rigs, leads or a lure;
//            fish.bait + n = hookbaits
// `shelf` places a box of it on the back shelves; `blurb` is the line under its name.
export const CATALOGUE = [
  { id: 'drone', kind: 'drone', cat: 'Drones', name: 'Kestrel T3 camera drone', price: 899, blurb: '4K camera and a thermal camera on a 3-axis gimbal · 31 min flight · 15 km video link · two spare prop sets in the box', hero: true },
  { id: 'props', kind: 'props', cat: 'Drone accessories', name: 'Spare propellers (4 sets)', price: 12.99, blurb: 'Snap-on props: a set is fitted after a crash breaks them', needs: 'drone', repeat: true },
  { id: 'battery', kind: 'upgrade', upgrade: 'battery', cat: 'Drone accessories', name: 'High-capacity flight battery', price: 129, blurb: '45% more flight time (about 45 minutes)', needs: 'drone' },
  { id: 'guards', kind: 'upgrade', upgrade: 'guards', cat: 'Drone accessories', name: 'Propeller guards', price: 24.99, blurb: 'Rings round the props: it shrugs off knocks that would crash it', needs: 'drone' },
  { id: 'range', kind: 'upgrade', upgrade: 'range', cat: 'Drone accessories', name: 'Long-range antenna kit', price: 59, blurb: '+10 km of video link (25 km): the whole county from one spot', needs: 'drone' },
  // ---- fishing: the rods come rigged (a float and hook, a lead and hair rig, a lure on a wire trace); spares for
  // what breaks off or gets snagged; the baits
  { id: 'rod-float', kind: 'fishing', fish: { rod: 'float' }, cat: 'Fishing rods', name: 'Float rod and reel', price: 59.99, blurb: '13 ft match rod, a 3000 reel with 4 lb line, rigged with a waggler float and a size 16 hook. Roach, rudd, perch, tench and bream', hero: true },
  { id: 'rod-carp', kind: 'fishing', fish: { rod: 'carp' }, cat: 'Fishing rods', name: 'Carp rod, big-pit reel and bite alarm', price: 189, blurb: '12 ft 3 lb test curve rod, 12 lb line, a rod pod and a bite alarm, rigged with a 3 oz lead and a hair rig. Carp and tench at range' },
  { id: 'rod-lure', kind: 'fishing', fish: { rod: 'lure' }, cat: 'Fishing rods', name: 'Lure rod and reel', price: 69.99, blurb: '7 ft spinning rod, 20 lb braid and a wire trace (pike teeth), with a spinner. Pike and perch' },
  { id: 'net', kind: 'fishing', fish: { gear: 'net' }, cat: 'Fishing kit', name: 'Landing net', price: 34.99, blurb: '42-inch carp net on a 2 m handle: anything over a couple of pounds needs netting' },
  { id: 'mat', kind: 'fishing', fish: { gear: 'mat' }, cat: 'Fishing kit', name: 'Unhooking mat', price: 19.99, blurb: 'Padded mat for carp and pike on the bank. The syndicates insist on one' },
  { id: 'catapult', kind: 'fishing', fish: { gear: 'catapult' }, cat: 'Fishing kit', name: 'Bait catapult', price: 7.99, blurb: 'Loose feed out to 40 m (by hand it only goes 13)' },
  { id: 'hooks', kind: 'fishing', fish: { tackle: 'hooks', n: 10 }, cat: 'Fishing tackle', name: 'Hooks, size 16 (10)', price: 2.49, blurb: 'For the float rod: a new one when a fish breaks you off or a hook goes blunt', repeat: true },
  { id: 'floats', kind: 'fishing', fish: { tackle: 'floats', n: 3 }, cat: 'Fishing tackle', name: 'Waggler floats (3)', price: 4.49, blurb: 'Lost with the hook when the line goes', repeat: true },
  { id: 'hairrigs', kind: 'fishing', fish: { tackle: 'hairrigs', n: 3 }, cat: 'Fishing tackle', name: 'Hair rigs, size 8 (3)', price: 4.99, blurb: 'Ready-tied carp hooklinks for the carp rod', repeat: true },
  { id: 'leads', kind: 'fishing', fish: { tackle: 'leads', n: 3 }, cat: 'Fishing tackle', name: '3 oz leads (3)', price: 3.99, blurb: 'Gone in a crack-off or a snag', repeat: true },
  { id: 'spinner', kind: 'fishing', fish: { tackle: 'spinner', n: 1 }, cat: 'Fishing tackle', name: 'Spinner', price: 4.99, blurb: 'A flashing blade: perch love it, pike too', repeat: true },
  { id: 'shad', kind: 'fishing', fish: { tackle: 'shad', n: 1 }, cat: 'Fishing tackle', name: 'Soft shad lure', price: 5.99, blurb: 'A rubber fish with a paddle tail: the pike lure', repeat: true },
  { id: 'maggots', kind: 'fishing', fish: { bait: 'maggots', n: 60 }, cat: 'Bait', name: 'Maggots (a pint)', price: 3.5, blurb: 'Everything eats a maggot: roach, rudd, perch, bream, tench', repeat: true },
  { id: 'corn', kind: 'fishing', fish: { bait: 'corn', n: 40 }, cat: 'Bait', name: 'Sweetcorn (a tin)', price: 1.2, blurb: 'Tench and carp, on the float or the hair', repeat: true },
  { id: 'boilies', kind: 'fishing', fish: { bait: 'boilies', n: 60 }, cat: 'Bait', name: 'Boilies (1 kg)', price: 9.99, blurb: 'The carp bait: on the hair rig, and catapulted round it', repeat: true },
  { id: 'worms', kind: 'fishing', fish: { bait: 'worms', n: 25 }, cat: 'Bait', name: 'Worms (a tub)', price: 3.99, blurb: 'Perch and tench can\'t resist them', repeat: true },
  { id: 'bread', kind: 'fishing', fish: { bait: 'bread', n: 30 }, cat: 'Bait', name: 'Bread (a loaf)', price: 1.4, blurb: 'Flake on the hook for rudd and roach', repeat: true },
];
export const CATEGORIES = ['Drones', 'Drone accessories', 'Fishing rods', 'Fishing kit', 'Fishing tackle', 'Bait'];
