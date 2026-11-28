// Shop fascias from the names already on each building and POI sign.
// Lettering is original, set in the chains' public colours — not copied logo artwork.
// The brand id is packed into the building code as id * 64 (a multiple of 32, so the
// class and the shop bit still decode). Shader bands:
//   1–24   large stores (deep glass, canopy)
//   25–70, 85–127  high-street units
//   71–84  banks and bookmakers (smaller windows)
//   128–143 independents
//   144–159 pubs
//   160–167 independent cafés, 168–175 independent takeaways and restaurants (named so: the window shows their room)

export const BRAND_N = 176;
const PAL = new Uint8Array(BRAND_N * 4);
const CHAINS = [];

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function put(id, hex) {
  const [r, g, b] = rgb(hex);
  PAL[id * 4] = r; PAL[id * 4 + 1] = g; PAL[id * 4 + 2] = b; PAL[id * 4 + 3] = 255;
}
const MATCH = [];
function reg(id, re, bg, fg, o = {}) {
  put(id, bg);
  const b = {
    id, re, bg, fg,
    canopy: id <= 24,
    bank: id >= 71 && id <= 84,
    pub: false,
    italic: !!o.italic, serif: !!o.serif, upper: !!o.upper,
    weight: o.weight || 800,
    track: o.track || '0px',
    bar: o.bar || null,
    barColor: o.barColor || '#ffffff',
    mark: o.mark || null,
  };
  CHAINS.push(b);
  return b;
}

// Units are matched before the big stores so "Tesco Express" does not become a superstore.
const UNIT = [
  [/tesco express/, '#00539F', '#FFFFFF', { mark: 'dots' }],
  [/sainsburys local/, '#EE7B00', '#FFFFFF'],
  [/asda express|asda living/, '#5EAE32', '#FFFFFF', { italic: true, weight: 700 }],
  [/morrisons daily/, '#FFD100', '#1A1A1A', { weight: 700, bar: 'bottom', barColor: '#111111' }],
  [/little waitrose/, '#12382B', '#F7F4EC', { serif: true, weight: 600 }],
  [/simply food/, '#141414', '#F3E6C0', { serif: true, weight: 600, track: '1px' }],
  [/funeralcare/, '#20262B', '#F4F1E8', { serif: true, weight: 500 }],
  [/lloyds pharmacy/, '#007A53', '#FFFFFF', { weight: 700 }],
  [/boots opticians/, '#05054B', '#FFFFFF', { weight: 700 }],
  [/\bboots\b/, '#05054B', '#FFFFFF', { weight: 700 }],
  [/\bsuperdrug\b/, '#6C1F86', '#FFFFFF'],
  [/\bcosta\b/, '#6F263D', '#FFFFFF', { upper: true, track: '1.5px', weight: 700 }],
  [/\bstarbucks\b/, '#006241', '#FFFFFF', { weight: 700 }],
  [/\bgreggs\b/, '#F58220', '#FFFFFF', { bar: 'bottom', barColor: '#1B3F8B' }],
  [/caffe nero|cafe nero/, '#111111', '#FFFFFF', { bar: 'bottom', barColor: '#E87722', weight: 600 }],
  [/coffee ?# ?1|coffee no 1|\bcoffee 1\b/, '#4A2C2A', '#F6E7D4', { weight: 700 }],
  [/pret a manger|\bpret\b/, '#8C1D40', '#FFFFFF', { weight: 700 }],
  [/\bsubway\b/, '#FFC600', '#00843D', { upper: true, weight: 900 }],
  [/mcdonalds/, '#DA291C', '#FFC72C'],
  [/\bkfc\b/, '#E4002B', '#FFFFFF', { upper: true, weight: 900 }],
  [/burger king/, '#D62300', '#FFB81C', { upper: true }],
  [/nandos/, '#111111', '#FFFFFF', { bar: 'bottom', barColor: '#CE0E2D', weight: 700 }],
  [/dominos/, '#006491', '#FFFFFF', { bar: 'bottom', barColor: '#E31837' }],
  [/pizza express|pizzaexpress/, '#111111', '#FFFFFF', { weight: 500, track: '0.5px' }],
  [/pizza hut/, '#E31837', '#FFFFFF'],
  [/specsavers/, '#005C3A', '#FFFFFF', { weight: 700 }],
  [/vision express/, '#003DA5', '#FFFFFF'],
  [/holland and barrett/, '#1F7A3A', '#FFFFFF', { weight: 700 }],
  [/card factory/, '#E2186F', '#FFFFFF'],
  [/\bthe works\b/, '#FFE14A', '#E10600', { weight: 900 }],
  [/\bpeacocks\b/, '#E2007A', '#FFFFFF'],
  [/robert dyas/, '#123A70', '#FFFFFF', { bar: 'bottom', barColor: '#F36C21' }],
  [/\boxfam\b/, '#5C8A2E', '#FFFFFF'],
  [/sue ryder/, '#5B2C83', '#FFFFFF'],
  [/age uk/, '#003865', '#FFFFFF', { bar: 'bottom', barColor: '#F0A202' }],
  [/british heart/, '#E10600', '#FFFFFF'],
  [/cancer research/, '#00A3E0', '#FFFFFF', { bar: 'bottom', barColor: '#E2186F' }],
  [/helen and douglas|thames hospice/, '#6B2D5B', '#FFFFFF', { weight: 600 }],
  [/\btimpson\b/, '#0033A0', '#FFFFFF', { bar: 'bottom', barColor: '#FFD100' }],
  [/post office/, '#D4001A', '#FFFFFF', { weight: 700 }],
  [/whsmith|w h smith|wh smith/, '#003087', '#FFFFFF', { weight: 700 }],
  [/waterstones/, '#111111', '#FFFFFF', { serif: true, weight: 600 }],
  [/leightons/, '#073B6E', '#FFFFFF', { weight: 700 }],
  [/\bvodafone\b/, '#E60000', '#FFFFFF'],
  [/virgin media/, '#E10A0A', '#FFFFFF'],
  [/^ee$/, '#00937B', '#FFE100', { upper: true, weight: 900 }],
  [/premier inn/, '#3C1053', '#FFFFFF', { weight: 700 }],
  [/\bspar\b/, '#00843D', '#FFFFFF', { upper: true, bar: 'bottom', barColor: '#E10600' }],
  [/\blondis\b/, '#E30613', '#FFFFFF', { bar: 'bottom', barColor: '#0033A0' }],
  [/\bnisa\b/, '#E30613', '#FFFFFF'],
  [/costcutter/, '#E30613', '#FFD100'],
  [/screwfix/, '#0057B8', '#FFFFFF', { upper: true }],
  [/toolstation/, '#F26522', '#FFFFFF'],
  [/kwik fit/, '#78BE20', '#111111'],
  [/sports direct/, '#0033A0', '#FFFFFF', { upper: true }],
  [/jd sports|^jd$/, '#111111', '#FFFFFF', { upper: true, weight: 900 }],
  [/foot locker/, '#111111', '#FFFFFF', { upper: true }],
  [/\bclarks\b/, '#0033A0', '#FFFFFF', { weight: 600 }],
  [/new look/, '#111111', '#FFFFFF', { weight: 700, track: '0.5px' }],
  [/superdry/, '#F36C21', '#1A1A1A', { weight: 800 }],
  [/mountain warehouse/, '#0B4F8A', '#FFFFFF', { bar: 'bottom', barColor: '#F36C21' }],
  [/poundland/, '#F36F21', '#FFFFFF', { bar: 'bottom', barColor: '#00A651' }],
  [/tk maxx/, '#E10600', '#FFFFFF', { weight: 900 }],
  [/\bargos\b/, '#D21F26', '#FFFFFF'],
  [/hotel chocolat/, '#3C2415', '#E6C98A', { serif: true, weight: 600 }],
  [/fireaway/, '#C8102E', '#FFFFFF', { upper: true }],
  [/krispy kreme/, '#046A38', '#FFFFFF', { bar: 'bottom', barColor: '#E31C23' }],
  [/cake box/, '#E2186F', '#FFFFFF'],
  [/\bgails\b|gail s/, '#161616', '#F3E6C8', { serif: true, weight: 600 }],
  [/wenzels/, '#F5C518', '#C8102E'],
  [/kaspas/, '#E2186F', '#FFFFFF', { weight: 700 }],
  [/shake shack/, '#1B4D3E', '#FFFFFF', { weight: 700 }],
  [/black sheep coffee/, '#1A1A1A', '#FFFFFF', { weight: 700 }],
  [/\bitsu\b/, '#111111', '#FFFFFF', { weight: 500, track: '2px' }],
  [/toni and guy/, '#111111', '#FFFFFF', { weight: 500, track: '1px' }],
  [/l occitane/, '#F4EFE4', '#8A6A3B', { serif: true, weight: 600 }],
  [/chopstix/, '#E10600', '#FFD100', { weight: 800 }],
  [/\bryman\b/, '#0057B8', '#FFFFFF'],
  [/\btui\b/, '#E2001A', '#FFFFFF', { upper: true, weight: 800 }],
  [/the entertainer/, '#E10600', '#FFFFFF'],
  [/\blush\b/, '#111111', '#FFFFFF', { upper: true, weight: 700 }],
  [/toby carvery/, '#6B1C23', '#FFFFFF', { serif: true, weight: 600 }],
  [/\bshell\b/, '#FFD100', '#DD1D21', { weight: 800 }],
  [/\bbp\b/, '#009900', '#FBCE07', { weight: 800 }],
  [/\bco op\b|co operative food|^the co operative$/, '#00B5B0', '#FFFFFF', { weight: 700, mark: 'clover' }],
];

const BIG = [
  [/\bwaitrose\b/, '#12382B', '#F7F4EC', { serif: true, weight: 600, track: '0.5px' }],
  [/\biceland\b/, '#E10600', '#FFFFFF', { italic: true, weight: 700, bar: 'bottom', barColor: '#F26A21' }],
  [/\btesco\b/, '#00539F', '#FFFFFF', { mark: 'dots' }],
  [/\bsainsburys\b/, '#EE7B00', '#FFFFFF'],
  [/\basda\b/, '#5EAE32', '#FFFFFF', { italic: true, weight: 700 }],
  [/\baldi\b/, '#001F5B', '#FFFFFF', { upper: true, mark: 'aldi' }],
  [/\blidl\b/, '#0050AA', '#FFFFFF', { mark: 'lidl' }],
  [/\bmorrisons\b/, '#FFD100', '#1A1A1A', { weight: 700, bar: 'bottom', barColor: '#111111' }],
  [/\bm and s\b|\bmarks and spencer\b/, '#141414', '#F3E6C0', { serif: true, weight: 600, track: '1px' }],
  [/\bjohn lewis\b/, '#161616', '#FFFFFF', { serif: true, weight: 500, track: '1.5px' }],
  [/\bprimark\b/, '#8FCBF0', '#0A2144'],
  [/pets at home/, '#54267A', '#FFFFFF'],
  [/\bthe range\b/, '#E10613', '#FFFFFF'],
  [/\bwickes\b/, '#D20A2E', '#FFFFFF'],
  [/\bb and q\b/, '#F26522', '#FFFFFF', { upper: true }],
  [/\bikea\b/, '#0058A3', '#FFDA1A', { upper: true, weight: 900 }],
  [/\bhomebase\b/, '#F15A22', '#FFFFFF'],
  [/\bdunelm\b/, '#0E3A5C', '#FFFFFF'],
  [/\bcurrys\b/, '#141414', '#FFFFFF', { bar: 'bottom', barColor: '#E10600' }],
  [/\bhalfords\b/, '#F36F21', '#FFFFFF', { bar: 'bottom', barColor: '#003DA5' }],
  [/\bdecathlon\b/, '#0082C3', '#FFFFFF'],
  [/go outdoors/, '#2E7D32', '#FFFFFF'],
  [/home bargains/, '#E30613', '#FFFFFF', { mark: 'split' }],
  [/\bb and m\b/, '#F36C21', '#FFFFFF', { upper: true }],
];

const BANK = [
  [/\bnationwide\b/, '#011E41', '#FFFFFF', { weight: 700 }],
  [/natwest|nat west/, '#42145F', '#FFFFFF', { weight: 700 }],
  [/\bbarclays\b/, '#00A1E0', '#FFFFFF', { weight: 700 }],
  [/lloyds bank|\blloyds\b/, '#006A4D', '#FFFFFF', { weight: 600 }],
  [/\bhsbc\b/, '#DB0011', '#FFFFFF', { upper: true, weight: 700 }],
  [/\bsantander\b/, '#EC0000', '#FFFFFF', { weight: 700 }],
  [/\bhalifax\b/, '#003399', '#FFFFFF', { weight: 700 }],
  [/\btsb\b/, '#2E2F8B', '#FFFFFF', { bar: 'bottom', barColor: '#E91E8C' }],
  [/metro bank/, '#ED1C24', '#FFFFFF'],
  [/leeds building society/, '#0033A0', '#FFFFFF', { weight: 600 }],
  [/\bcoral\b/, '#0033A0', '#FFFFFF'],
  [/ladbrokes/, '#E10600', '#FFFFFF'],
  [/william hill/, '#002D72', '#FFFFFF'],
  [/paddy power/, '#0B6B32', '#FFFFFF'],
];

if (BIG.length > 24) throw new Error('too many large stores');
if (BANK.length > 14) throw new Error('too many banks');
if (UNIT.length > 89) throw new Error('too many high-street chains ' + UNIT.length);
const unitBrands = UNIT.map((row, i) => reg(i < 46 ? 25 + i : 85 + (i - 46), ...row));
const bigBrands = BIG.map((row, i) => reg(1 + i, ...row));
const bankBrands = BANK.map((row, i) => reg(71 + i, ...row));
MATCH.push(...unitBrands, ...bigBrands, ...bankBrands);

const INDIE = [
  ['#16324F', '#F4F0E6', 0], ['#1F3B2C', '#F4F1E4', 0], ['#6E2224', '#FBEFE0', 0], ['#2B1D14', '#F3E2B8', 0],
  ['#161616', '#F6F3EC', 0], ['#F4F0E6', '#1C1A17', 0], ['#0E4D6B', '#F3FBFF', 0], ['#6B1D3A', '#FFF6EE', 0],
  ['#C4552A', '#FFF8F2', 0], ['#243044', '#F0D78C', 1], ['#3E2A4A', '#F6F0FA', 0], ['#1B3A4B', '#E7F2C8', 0],
  ['#7A1F2B', '#FFF4E8', 0], ['#0F3D3E', '#F3EFE2', 0], ['#E7D7B1', '#2A2118', 1], ['#22262B', '#F2C14E', 0],
];
const PUB = [
  ['#1A120B', '#E7C98A'], ['#2C1210', '#F0D7A2'], ['#102016', '#E6D3A1'], ['#1B1A17', '#F3E6C4'],
  ['#3A2412', '#F6E7C1'], ['#14181C', '#E7D3A1'], ['#2A1A0C', '#F4E2B0'], ['#1A1F16', '#F0E2B8'],
  ['#F3E6C8', '#2A2118'], ['#E7D3A8', '#1A120B'], ['#241610', '#F0D090'], ['#0E1A16', '#E4D2A4'],
  ['#2B241C', '#F7F1E1'], ['#3D1C16', '#F3D7A5'], ['#1C140C', '#E8C56B'], ['#F7F1E4', '#1A120B'],
];
const CAFE = [['#2F4F3E', '#F4EFE2'], ['#F3EBDD', '#3B2A20'], ['#5A3A2A', '#F6E9D2'], ['#1E3A4C', '#F4F0E6'], ['#E9D8C0', '#2B2B2B'], ['#7A2E3A', '#FBF1E6'], ['#22302A', '#E9D9A8'], ['#B85C38', '#FFF7EE']];
const TAKEAWAY = [['#B71C1C', '#FFD54F'], ['#0D47A1', '#FFFFFF'], ['#1B5E20', '#FFEB3B'], ['#212121', '#FFC107'], ['#E65100', '#FFFFFF'], ['#880E4F', '#FFFFFF'], ['#F9A825', '#B71C1C'], ['#263238', '#80DEEA']];
INDIE.forEach((c, i) => put(128 + i, c[0]));
PUB.forEach((c, i) => put(144 + i, c[0]));
CAFE.forEach((c, i) => put(160 + i, c[0]));
TAKEAWAY.forEach((c, i) => put(168 + i, c[0]));
put(0, '#16324F');

export function paletteBytes() { return PAL; }

// a brand's style from its id (the sign painter's, signs.js: the tile worker may have chosen it by more than the name)
export function brandStyle(id, label) {
  const c = CHAINS.find(b => b.id === id); if (c) return { ...c, label };
  const base = { canopy: false, bank: false, pub: false, italic: false, upper: false, weight: 700, track: '0px', bar: null, barColor: '#ffffff', mark: null, label };
  if (id >= 128 && id < 144) { const [bg, fg, serif] = INDIE[id - 128]; return { ...base, id, bg, fg, serif: !!serif }; }
  if (id >= 144 && id < 160) { const [bg, fg] = PUB[id - 144]; return { ...base, id, bg, fg, pub: true, serif: true, weight: 600, track: '0.5px' }; }
  if (id >= 160 && id < 168) { const [bg, fg] = CAFE[id - 160]; return { ...base, id, bg, fg, eat: 'cafe', serif: true }; }
  if (id >= 168 && id < 176) { const [bg, fg] = TAKEAWAY[id - 168]; return { ...base, id, bg, fg, eat: 'takeaway', upper: true }; }
  return null;
}

export function normName(s) {
  return String(s || '').toLowerCase().replace(/['’`]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9#+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
// what pubs are called: "The ... Inn/Arms/Tavern", "The Royal Oak", "Fox and Hounds", "Cunning Fox"
const PUB_WORDS = 'oak|lion|horse|horses|swan|fox|hounds|crown|plough|head|chequers|bell|anchor|wheatsheaf|ship|cricketers|duck|hare|lamb|angel|falcon|eagle|boot|sun|moon|star|tuns|hand|castle|bull|stag|hart|feathers|greyhound|harrow|mitre|pheasant|grapes|wagon|coach|ram|bear|dragon|unicorn|griffin|pelican|kite|swallow|magpie|cock|hen|goose|plume|barley|hop|hops|mill|wharf|lock|bridge|boatman|ferry|railway|victoria|albert|george|duke|prince|queen|king|rose|thistle|elephant|tap';
const PUB_RE = new RegExp(`^the .*\\b(${PUB_WORDS})\\b|^[a-z]+ and [a-z]+$|^(old |red |white |black |royal |cunning |jolly |little |green |blue |grey |three |two |seven |rising |half |new |nags |kings |queens |saracens |bishops |rose and )?(${PUB_WORDS})$`);
function isPub(key) {
  if (/\b(inn|arms|tavern|pub|alehouse|ale house)\b/.test(key) || /^the [a-z0-9]+$/.test(key)) return true;
  const m = PUB_RE.exec(key); if (!m) return false;
  // "X and Y" only when one of them is a pub's word (Bull and Chequers, Fox and Hounds: not Smith and Sons)
  if (/^[a-z]+ and [a-z]+$/.test(key) && !/^the /.test(key)) return key.split(' and ').some(w => new RegExp(`^(${PUB_WORDS})$`).test(w));
  return true;
}
// an independent café, or a takeaway or restaurant, by its name: their windows show a café's or a takeaway's room
const CAFE_RE = /\b(cafe|caff|coffee|tea ?rooms?|tea shop|bakery|bakers|patisserie|deli|sandwich(es)?|brunch|espresso)\b/;
const TAKEAWAY_RE = /\b(takeaway|take away|chippy|chip shop|fish and chips|fish bar|fryer|kebabs?|pizza|pizzeria|chicken|grill|burgers?|curry|tandoori|indian|balti|spice|chinese|wok|noodles?|thai|sushi|oriental|dragon|lotus|bamboo|panda|canton|cantonese|peking|hong kong|szechuan|sichuan|mandarin|china|kowloon|bombay|delhi|bengal|raj|taj|nepal|gurkha|lahore|shawarma|falafel|doner|gyros|meze|turkish|diner|restaurant|bistro|brasserie|trattoria|ristorante|steakhouse|cantina|taverna)\b/;
function independent(raw, key) {
  const h = hash(key);
  if (isPub(key)) {
    const i = h % PUB.length, [bg, fg] = PUB[i];
    return { id: 144 + i, bg, fg, canopy: false, bank: false, pub: true, italic: false, serif: true, upper: false, weight: 600, track: '0.5px', bar: null, barColor: '#ffffff', mark: null, label: raw };
  }
  const eat = CAFE_RE.test(key) ? 'cafe' : TAKEAWAY_RE.test(key) ? 'takeaway' : null;
  if (eat) {
    const P = eat === 'cafe' ? CAFE : TAKEAWAY, i = h % P.length, [bg, fg] = P[i];
    return { id: (eat === 'cafe' ? 160 : 168) + i, bg, fg, canopy: false, bank: false, pub: false, eat, italic: false, serif: eat === 'cafe', upper: eat !== 'cafe', weight: 700, track: '0px', bar: null, barColor: '#ffffff', mark: null, label: raw };
  }
  const i = h % INDIE.length, [bg, fg, serif] = INDIE[i];
  return { id: 128 + i, bg, fg, canopy: false, bank: false, pub: false, italic: false, serif: !!serif, upper: false, weight: 700, track: '0px', bar: null, barColor: '#ffffff', mark: null, label: raw };
}

// an enterable site's brand (world/interiors.json): its kind decides, so a pub whose name doesn't sound like one, or a
// takeaway that isn't one of the chains, still gets the right fascia and the right room through its windows (the tile
// worker and interiorPlan.js both ask, and so agree)
const asEatery = (raw, key, eat) => { const P = eat === 'cafe' ? CAFE : TAKEAWAY, i = hash(key) % P.length, [bg, fg] = P[i];
  return { id: (eat === 'cafe' ? 160 : 168) + i, bg, fg, canopy: false, bank: false, pub: false, eat, italic: false, serif: eat === 'cafe', upper: eat !== 'cafe', weight: 700, track: '0px', bar: null, barColor: '#ffffff', mark: null, label: raw }; };
export function siteBrand(name, kind, food) {
  const b = fasciaBrand(name, true), raw = String(name || '').trim(), key = normName(raw);
  if (kind === 'pub' && !b?.pub && key) { const i = hash(key) % PUB.length, [bg, fg] = PUB[i];
    return { id: 144 + i, bg, fg, canopy: false, bank: false, pub: true, italic: false, serif: true, upper: false, weight: 600, track: '0.5px', bar: null, barColor: '#ffffff', mark: null, label: raw }; }
  if (kind === 'food' && key && !(b && ((b.id >= 36 && b.id <= 49) || b.id >= 160))) return asEatery(raw, key, food === 'bakery' || food === 'coffee' ? 'cafe' : 'takeaway');
  return b;
}

const SKIP = /\b(church|mosque|chapel|temple|synagogue|school|university|college|hospital|library|museum|community centre|youth centre|surgery)\b/;
const GENERIC = /^(shop|store|retail|building|yes|unit|block [a-z0-9]+|main entrance|reception)$/;

// retail: the building is tagged as a shop, or it is a commercial class. Chain names match either way.
export function fasciaBrand(name, retail) {
  const raw = String(name || '').trim();
  if (raw.length < 2) return null;
  const key = normName(raw);
  if (!key || GENERIC.test(key)) return null;
  for (const b of MATCH) if (b.re.test(key)) return { ...b, label: raw };
  if (!retail || SKIP.test(key)) return null;
  return independent(raw, key);
}

// Where the wordmark sits, in metres above the building base.
// High-street units: 74%–97.5% of the ground-floor height (buildingMaterial).
// Supermarkets: a band in the top quarter of the retail front, just under the parapet.
export function signBox(brand, floorH) {
  const fh = Math.max(2.4, Math.min(9.2, +floorH || 3.2));
  if (brand && brand.canopy) {
    const dy = fh * 0.76;
    return { dy, h: fh * 0.16 };
  }
  return { dy: fh * 0.74, h: fh * 0.235 };
}
