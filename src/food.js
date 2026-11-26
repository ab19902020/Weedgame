// Menus for the fast-food places (interiors.js, interiorPlan.js, interiorMesh.js). Plain dish names and typical
// 2026 high-street prices by kind of place, not any chain's own products or names for them.
export const MENUS = {
  burger: { title: 'Burgers', items: [
    ['Cheeseburger', 1.99], ['Double cheeseburger', 3.29], ['Quarter-pound burger', 4.99], ['Chicken burger', 3.99], ['Chicken nuggets (9)', 4.79],
    ['Fries', 2.29], ['Large fries', 2.89], ['Milkshake', 2.79], ['Cola', 1.79], ['Burger meal', 7.49] ] },
  chicken: { title: 'Fried chicken', items: [
    ['2-piece meal', 6.99], ['3 hot wings', 3.49], ['Chicken fillet burger', 4.99], ['Popcorn chicken', 3.29], ['Family bucket', 21.99],
    ['Fries', 2.29], ['Beans', 1.79], ['Coleslaw', 1.79], ['Gravy', 1.49], ['Cola', 1.79] ] },
  piri: { title: 'Peri-peri chicken', items: [
    ['Quarter chicken', 6.95], ['Half chicken', 11.95], ['Chicken wrap', 8.95], ['Wings (5)', 7.45], ['Spicy rice', 3.75],
    ['Peri chips', 3.95], ['Corn on the cob', 3.25], ['Garlic bread', 3.25], ['Bottomless drink', 3.45] ] },
  sub: { title: 'Subs', items: [
    ['6-inch sub', 4.99], ['Footlong sub', 7.49], ['Meatball sub', 5.49], ['Chicken teriyaki sub', 5.99], ['Veggie sub', 4.49],
    ['Cookie', 1.19], ['Crisps', 1.19], ['Bottle of water', 1.29], ['Sub meal', 8.49] ] },
  bakery: { title: 'Bakery', items: [
    ['Sausage roll', 1.35], ['Vegan sausage roll', 1.45], ['Steak bake', 2.05], ['Chicken bake', 2.05], ['Cheese & onion bake', 1.95],
    ['Doughnut', 1.15], ['Coffee', 2.10], ['Tea', 1.60], ['Meal deal', 4.25] ] },
  chippy: { title: 'Fish & chips', items: [
    ['Cod & chips', 10.50], ['Haddock & chips', 11.50], ['Sausage & chips', 6.20], ['Chips', 3.40], ['Large chips', 4.20],
    ['Battered sausage', 2.60], ['Mushy peas', 1.80], ['Curry sauce', 1.80], ['Pickled egg', 1.00], ['Can of drink', 1.30] ] },
  kebab: { title: 'Kebabs', items: [
    ['Doner kebab', 7.50], ['Large doner', 9.50], ['Chicken shish', 9.00], ['Mixed kebab', 11.00], ['Chips', 3.00],
    ['Cheesy chips', 4.00], ['Doner meat & chips', 6.50], ['Garlic bread', 2.50], ['Can of drink', 1.20] ] },
  pizza: { title: 'Pizza', items: [
    ['Margherita (medium)', 12.99], ['Pepperoni (medium)', 14.99], ['Meat feast (large)', 19.99], ['Veggie (medium)', 13.99], ['Garlic bread', 4.99],
    ['Chicken wings', 5.99], ['Potato wedges', 3.99], ['Cookies', 4.49], ['Bottle of cola', 3.49] ] },
  // the pub: [name, price, alcohol units]
  pub: { title: 'At the bar', items: [
    ['Pint of lager', 5.40, 2.3], ['Pint of bitter', 4.90, 2], ['Pint of cider', 5.20, 2.6], ['Pint of stout', 5.70, 2.4], ['Glass of wine', 6.80, 2.3],
    ['Double vodka & coke', 8.20, 2], ['Pint of shandy', 4.20, 1], ['Soft drink', 2.90, 0], ['Packet of crisps', 1.50, 0], ['Pork scratchings', 1.90, 0], ['Basket of chips', 4.50, 0] ] },
  mex: { title: 'Burritos & tacos', items: [
    ['Burrito', 8.95], ['Burrito bowl', 8.95], ['Tacos (3)', 7.45], ['Quesadilla', 7.25], ['Nachos', 4.95],
    ['Chips & salsa', 2.95], ['Churros', 3.25], ['Fizzy drink', 2.45] ] },
};
// what you'd call the main thing you ate (for the messages)
export const FOOD_WORD = { pub: 'drink', burger: 'burger', chicken: 'chicken', piri: 'chicken', sub: 'sub', bakery: 'bake', chippy: 'fish and chips', kebab: 'kebab', pizza: 'pizza', mex: 'burrito' };
// the staff's uniforms and the place's colours (neutral, not any chain's)
export const STYLE = {
  pub: { uniform: 0x1c1c1c, wall: 0xb99d6b, accent: 0x5b3a22, floor: 0x6b2f35, seat: 0x4a2f1c, board: '#2a1d14', ink: '#fff2e0', hi: '#e8c26a' },
  burger: { uniform: 0x2b2b2b, wall: 0xe9e4da, accent: 0x4a4f55, floor: 0xb9b0a2, seat: 0x6b4a32, board: '#1d1f22', ink: '#f6efe0', hi: '#f0b43c' },
  chicken: { uniform: 0x7a2420, wall: 0xf2efe9, accent: 0x7a3a2a, floor: 0x9a9a98, seat: 0x3b3b3b, board: '#231a18', ink: '#fff4ec', hi: '#ff8a6a' },
  piri: { uniform: 0x2b2b2b, wall: 0xe9dcc6, accent: 0xb5653f, floor: 0x8a6a4a, seat: 0x5b3a22, board: '#2a211c', ink: '#f8ead8', hi: '#ffb36a' },
  sub: { uniform: 0x2f4a3a, wall: 0xe4e8de, accent: 0x6f7f68, floor: 0xb8ab94, seat: 0x4f5a4a, board: '#1f2620', ink: '#f2f6ea', hi: '#c6e27a' },
  bakery: { uniform: 0x2f4a7a, wall: 0xf4f1ea, accent: 0x3c4a63, floor: 0xc9c2b4, seat: 0x3c4a63, board: '#1c2333', ink: '#f4f6fb', hi: '#ffd25a' },
  chippy: { uniform: 0xf2f2f2, wall: 0xdfe8ea, accent: 0x2f5f8a, floor: 0xc9c2b4, seat: 0x2f5f8a, board: '#173352', ink: '#ffffff', hi: '#ffe066' },
  kebab: { uniform: 0x1c1c1c, wall: 0xf2f1ec, accent: 0x7d1f2a, floor: 0x9a9a98, seat: 0x7d1f2a, board: '#1a1a1a', ink: '#ffffff', hi: '#ff6a5a' },
  pizza: { uniform: 0x2f4a7a, wall: 0xf2efe9, accent: 0x2f4a7a, floor: 0x9a9a98, seat: 0x2f4a7a, board: '#16243c', ink: '#ffffff', hi: '#ff5a4a' },
  mex: { uniform: 0x4a2f5a, wall: 0xe8d4b4, accent: 0xb87a3a, floor: 0x8a6a4a, seat: 0x6b3a22, board: '#2a1d14', ink: '#fff2e0', hi: '#ffc04a' },
};
export const price = p => '£' + p.toFixed(2);

// the brothers' cash: each has his own (restaurants.js, fuel.js spend it)
const START_CASH = 1500;   // to start with (no wages yet: Dev adds more)
export const cash = b => (b.cash ??= START_CASH);
export function spend(b, amount) { if (cash(b) + 1e-6 < amount) return false; b.cash = Math.round((b.cash - amount) * 100) / 100; return true; }
