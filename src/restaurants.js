// The fast-food places (interiorPlan.js food(), menus in food.js): staff behind the tills and in the kitchen, a
// few people eating, and ordering: walk up to a till, Order, pick from the menu, pay, then eat in (you sit and
// eat while the clock moves on) or take it away in a bag and eat it wherever you like. Also the brothers' cash
// (each has his own; fuel.js spends it too).
import { People } from './characters.js';
import { MENUS, STYLE, FOOD_WORD, price, cash, spend } from './food.js';
export { cash, spend };

const BAR = ['There you go, that\'s', 'Cheers mate, that\'s', 'Lovely, that\'ll be', 'Coming up, that\'s'];
const LINES = { hello: ['Hiya, what can I get you?', 'Hi there, what would you like?', 'Next please! What can I get you?', 'Alright? What are you having?'],
  thanks: ['Cheers, it won\'t be long.', 'Lovely, just a couple of minutes.', 'Thank you! Your number\'s on the receipt.', 'Ta. Take a seat, I\'ll call you.'] };
const pick = a => a[Math.floor(Math.random() * a.length)];

export class Restaurants {
  constructor(G, interiors) {
    this.G = G; this.I = interiors; this.order = null; this.panel = null; this.number = 10 + Math.floor(Math.random() * 80);
    this.chip = null;
  }
  // ---------------------------------------------------------------- the people in a place, made when it's built
  people(b) {
    if (b.people) return b.people;
    const s = b.site, P = b.plan, st = STYLE[s.food] || STYLE.burger, I = this.I, out = [];
    const R = mulberry(s.seed || 1);
    const toW = (x, y) => I.toWorld(s, x, y);
    const head = (dx, dy) => { const wx = s.ax[0] * dx + s.ay[0] * dy, wz = s.ax[1] * dx + s.ay[1] * dy; return Math.atan2(wz, wx); };
    const staffLook = () => ({ ...People.randomLook(R, { work: true }), top: st.uniform, cap: R() < 0.7, hood: false, bag: false, umbrella: 0, hiVis: false });
    // one at each till, and up to two in the kitchen
    let k = 0;
    for (const sp of P.staffSpots) {
      if (sp.kitchen && k++ >= 2) continue;
      const [x, z] = toW(sp.x, sp.y);
      out.push({ id: `staff-${s.id}-${out.length}`, x, y: b.floor0, z, heading: head(sp.dx, sp.dy), base: head(sp.dx, sp.dy), look: staffLook(), visible: true, speed: 0, t: R() * 9, phase: 0,
        pose: 'idle', till: sp.till, kitchen: !!sp.kitchen, staff: true });
    }
    // a few people eating (more at lunch and teatime)
    const hr = this.G.world.hours(), pubby = s.food === 'pub';
    const busy = pubby ? (hr >= 17 && hr < 23.5 ? 1 : hr >= 12 && hr < 17 ? 0.5 : hr >= 11 ? 0.25 : 0.08) : hr > 11.5 && hr < 14 || hr > 17 && hr < 20.5 ? 1 : hr > 7 && hr < 23 ? 0.5 : 0.1;
    const seats = P.seats.slice(), room = P.W * P.D;
    const n = Math.min(seats.length, Math.round(Math.min(10, 1 + room / 28) * busy * (0.5 + R() * 0.6)));
    for (let i = 0; i < n; i++) {
      const sp = seats.splice(Math.floor(R() * seats.length), 1)[0], look = People.randomLook(R); look.umbrella = 0;
      const [x, z] = toW(sp.x, sp.y);
      out.push({ id: `diner-${s.id}-${i}`, x, y: b.floor0 + (sp.stool ? 0.78 : 0.5) - 0.87 * (look.h || 1), z, heading: head(sp.dx, sp.dy), look, visible: true, speed: 0, t: R() * 9, phase: 0, pose: R() < 0.25 ? 'phone' : 'seated', seat: sp });
    }
    for (const a of out) if (a.pose === 'phone') { a.pose = 'seated'; }
    return (b.people = out);
  }
  // ---------------------------------------------------------------- per frame inside a place
  // (outside: a place seen through its windows, its staff just getting on with it)
  update(dt, b, me, outside = false) {
    const G = this.G, people = this.people(b), o = this.order;
    for (const a of people) {
      a.t += dt;
      if (!a.staff) continue;
      // the one at your till looks at you and talks while you order; the kitchen works away
      const near = !outside && Math.hypot(me.x - a.x, me.z - a.z) < 3.2;
      const serving = !outside && this.panel && this.panelTill === a.till && this.panelSite === b.site;
      if (a.kitchen) { a.pose = 'idle'; a.heading = a.base + Math.sin(a.t * 0.6) * 0.5; }
      else if (serving || (near && a.till != null)) { a.heading = Math.atan2(me.z - a.z, me.x - a.x); a.pose = serving ? 'talk' : 'idle'; }
      else { a.heading += (a.base - a.heading) * Math.min(1, dt * 2); a.pose = 'idle'; }
    }
    // your order coming up
    if (outside) return;
    if (o && o.site === b.site && !o.ready && G.time >= o.readyAt) {
      o.ready = true;
      if (!o.pub) G.hud?.toast?.(`Order ${o.number}, ready!`, 3);
      if (o.mode === 'in') this.eatIn(b, o); else this.takeAway(o);
    }
  }
  // the till you're standing at, if any: { till } (local positions from the plan)
  tillAt(b, me) {
    if (!b.plan.tills) return null;
    const [lx, ly] = this.I.toLocal(b.site, me.x, me.z);
    let best = null, bd = 1.1;
    b.plan.tills.forEach((t, i) => { const d = Math.hypot(lx - t.x, ly - t.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ---------------------------------------------------------------- the menu and the order
  open(site, till) {
    const G = this.G, me = G.brothers.me, menu = MENUS[site.food] || MENUS.burger;
    if (this.order && !this.order.done) { G.hud?.toast?.(this.order.ready ? 'Your order\'s ready' : `Order ${this.order.number}'s still being made`); return; }
    this.close();
    const el = document.createElement('div'); el.id = 'orderPanel';
    el.innerHTML = `<div class="op-card"><div class="op-head"><div><b>${esc(site.title)}</b><small>${esc(pick(LINES.hello))}</small></div><span class="op-cash"></span></div>
      <div class="op-items"></div>
      <div class="op-foot"><div class="op-basket">Nothing yet</div><div class="op-btns"><button class="op-cancel">Cancel</button>${site.food === 'pub' ? '' : '<button class="op-take" disabled>Takeaway</button>'}<button class="op-in" disabled>${site.food === 'pub' ? 'Buy' : 'Eat in'}</button></div></div></div>`;
    document.body.appendChild(el);
    const basket = new Map();
    const list = el.querySelector('.op-items');
    menu.items.forEach(([nm, pr], i) => {
      const row = document.createElement('div'); row.className = 'op-row';
      row.innerHTML = `<span class="op-nm">${esc(nm)}</span><span class="op-pr">${price(pr)}</span><button class="op-minus" aria-label="Less">−</button><b class="op-q">0</b><button class="op-plus" aria-label="More">+</button>`;
      const q = row.querySelector('.op-q');
      const set = n => { n = Math.max(0, Math.min(9, n)); if (n) basket.set(i, n); else basket.delete(i); q.textContent = n; row.classList.toggle('on', n > 0); refresh(); };
      row.querySelector('.op-plus').onclick = () => set((basket.get(i) || 0) + 1);
      row.querySelector('.op-minus').onclick = () => set((basket.get(i) || 0) - 1);
      row.querySelector('.op-nm').onclick = () => set((basket.get(i) || 0) + 1);
      list.appendChild(row);
    });
    const total = () => [...basket].reduce((a, [i, n]) => a + menu.items[i][1] * n, 0);
    const refresh = () => {
      const t = total(), have = cash(me);
      el.querySelector('.op-cash').textContent = `${me.short} has ${price(have)}`;
      el.querySelector('.op-basket').textContent = basket.size ? `${[...basket].reduce((a, [, n]) => a + n, 0)} item${[...basket].reduce((a, [, n]) => a + n, 0) > 1 ? 's' : ''} · ${price(t)}${t > have ? ' · not enough cash' : ''}` : 'Tap what you want';
      for (const b of el.querySelectorAll('.op-take,.op-in')) b.disabled = !basket.size || t > have;
    };
    refresh();
    const go = mode => {
      const t = total(); if (!basket.size || !spend(me, t)) return;
      const items = [...basket].map(([i, n]) => [menu.items[i][0], n]), units = [...basket].reduce((a, [i, n]) => a + (menu.items[i][2] || 0) * n, 0);
      const n = ++this.number;
      const pubOrder = site.food === 'pub';
      this.order = { site, items, total: t, mode, number: n, units, pub: pubOrder, readyAt: G.time + (pubOrder ? 3 : 4 + Math.random() * 4 + items.length * 0.6), ready: false, done: false, word: FOOD_WORD[site.food] || 'food' };
      G.hud?.toast?.(pubOrder ? `${pick(BAR)} ${price(t)}, ta.` : `${pick(LINES.thanks)} Order ${n} · ${price(t)} paid`, 4);
      this.close();
    };
    el.querySelector('.op-cancel').onclick = () => this.close();
    if (el.querySelector('.op-take')) el.querySelector('.op-take').onclick = () => go('away');
    el.querySelector('.op-in').onclick = () => go('in');
    this.panel = el; this.panelTill = till; this.panelSite = site;
  }
  close() { this.panel?.remove(); this.panel = null; this.panelTill = null; this.panelSite = null; }
  describe(items) { return items.map(([nm, n]) => (n > 1 ? n + ' × ' : '') + nm.toLowerCase()).join(', '); }
  // eat in: you sit at a free table and eat; a quarter of an hour goes by
  eatIn(b, o) {
    const G = this.G, I = this.I, me = G.brothers.me;
    if (o.pub) {
      // at the bar: no fade, you just have it; a few go to your head
      me.drunk = Math.min(12, (me.drunk || 0) + o.units);
      const d = me.drunk;
      G.hud?.toast?.(`${me.short} has ${this.describe(o.items)}.${d >= 9 ? ' Steady on: you\'re hammered.' : d >= 6 ? ' You\'re well on your way.' : d >= 3 ? ' You\'re feeling it.' : ''}`, 4);
      o.done = true; this.order = null; return;
    }
    I.fadeOut(() => {
      const w = G.world; w.setHour((w.hours() + 0.25) % 24);
      G.hud?.toast?.(`You sit down and eat: ${this.describe(o.items)}. Lovely.`, 5);
      o.done = true; this.order = null;
    });
  }
  takeAway(o) {
    const G = this.G, me = G.brothers.me;
    me.takeaway = { from: o.site.title, items: o.items, word: o.word };
    G.hud?.toast?.(`Order ${o.number}: your takeaway's in a bag. Eat it whenever you like.`, 4);
    o.done = true; this.order = null;
  }
  // the takeaway chip on the HUD: tap to eat it, wherever you are
  hud() {
    const G = this.G, me = G.brothers.me, t = me.takeaway;
    if (!this.chip) {
      const c = this.chip = document.createElement('button'); c.id = 'takeChip'; c.hidden = true;
      c.onclick = () => { const b = G.brothers.me; if (!b.takeaway) return; G.hud?.toast?.(`${b.short} eats the ${b.takeaway.word} from ${b.takeaway.from}${b.vehicle ? ' at the wheel' : ''}. That hit the spot.`, 4); b.takeaway = null; };
      document.getElementById('hud')?.appendChild(c);
    }
    const want = t ? `<i>${BAG}</i><span>Takeaway · Eat</span>` : '';
    if (this.chip.dataset.v !== want) { this.chip.dataset.v = want; this.chip.innerHTML = want; this.chip.hidden = !t; }
  }
}
const BAG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
