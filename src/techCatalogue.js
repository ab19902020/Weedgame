// What TechZone sells (techShop.js shows it at the till; prices in pounds).
// To add stock: add an entry here. `kind` decides what buying it does:
//   drone    the drone itself (drone.js: give)            needs: none
//   props    spare propeller sets for the drone           needs: 'drone'
//   upgrade  a one-off drone upgrade (drone.js spec)      needs: 'drone', upgrade: the key drone.js reads
//   item     anything else: kept in the brother's bag (b.items.gadgets), ready for a feature to use it
// `shelf` places a box of it on the back shelves; `blurb` is the line under its name.
export const CATALOGUE = [
  { id: 'drone', kind: 'drone', cat: 'Drones', name: 'Kestrel T3 camera drone', price: 899, blurb: '4K camera and a thermal camera on a 3-axis gimbal · 31 min flight · 15 km video link · two spare prop sets in the box', hero: true },
  { id: 'props', kind: 'props', cat: 'Drone accessories', name: 'Spare propellers (4 sets)', price: 12.99, blurb: 'Snap-on props: a set is fitted after a crash breaks them', needs: 'drone', repeat: true },
  { id: 'battery', kind: 'upgrade', upgrade: 'battery', cat: 'Drone accessories', name: 'High-capacity flight battery', price: 129, blurb: '45% more flight time (about 45 minutes)', needs: 'drone' },
  { id: 'guards', kind: 'upgrade', upgrade: 'guards', cat: 'Drone accessories', name: 'Propeller guards', price: 24.99, blurb: 'Rings round the props: it shrugs off knocks that would crash it', needs: 'drone' },
  { id: 'range', kind: 'upgrade', upgrade: 'range', cat: 'Drone accessories', name: 'Long-range antenna kit', price: 59, blurb: '+10 km of video link (25 km): the whole county from one spot', needs: 'drone' },
];
export const CATEGORIES = ['Drones', 'Drone accessories'];
