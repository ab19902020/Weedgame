// The corner shops and the petrol stations' shops (interiors.json kind 'shop'; interiorPlan.js shop()): someone
// behind the counter, and the till to rob. Walk up to the counter and Rob: with a weapon out the shopkeeper's
// hands go up and the till's emptied in a couple of seconds; with bare fists it takes a lot longer of shouting.
// The alarm goes the moment you start and people outside scatter; the cash goes in the brother's pocket. (The police
// only come for a killing: wanted.js.) A shop that's been done is wary for a while.
import { People } from './characters.js';
import { cash } from './food.js';
import { shopColour } from './interiorPlan.js';

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const LINES = {
  hello: ['Alright?', 'Hiya.', 'Morning!', 'You alright there?', 'Just shout if you need anything.'],
  armed: ['Okay, okay! Take it!', 'Please, don\'t shoot!', 'Alright! Here, it\'s all yours!', 'Don\'t hurt me!'],
  bare: ['You\'re having a laugh.', 'I\'m not giving you anything!', 'Get out of my shop!', 'I\'m calling the police!'],
  wary: ['We\'ve already been done today.', 'Not again… the police are on their way.', 'There\'s nothing left in there!'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];

// where shoppers stand: in front of the shelving, chillers and freezer, every metre or so, facing it (both sides of
// an island of shelves), clear of everything else and inside the shop; spots in front of the same run share an aisle
function shopSpots(P) {
  const items = P.items || [], out = [];
  const free = (x, y) => x > 0.45 && x < P.W - 0.45 && y > 0.45 && y < P.D - 0.45 && items.every(it => {
    const c = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0), dx = x - it.x, dy = y - it.y;
    const u = dx * c + dy * sn, v = -dx * sn + dy * c;
    return Math.abs(u) > (it.w || 0) / 2 + 0.22 || Math.abs(v) > (it.d || 0) / 2 + 0.22;
  });
  items.forEach((it, k) => {
    if (!/^(gondola2?|chiller|freezer|fridge2)$/.test(it.type)) return;
    const c = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
    for (const sd of it.type === 'gondola2' ? [1, -1] : [1]) {
      const off = (it.d / 2 + 0.55) * sd;
      for (let u = -it.w / 2 + 0.45; u <= it.w / 2 - 0.45 + 1e-6; u += 1.05) {
        const x = it.x + u * c - off * sn, y = it.y + u * sn + off * c;
        if (free(x, y)) out.push({ x, y, dx: sn * sd, dy: -c * sd, aisle: k * 2 + (sd > 0 ? 0 : 1) });
      }
    }
  });
  return out;
}

export class Robbery {
  constructor(G, interiors) { this.G = G; this.I = interiors; this.job = null; this.robbed = new Map(); }
  // the shopkeeper behind the counter (drawn with the street's crowd)
  people(b) {
    if (b.people) return b.people;
    const s = b.site, P = b.plan, I = this.I, R = mulberry(s.seed || s.id || 1), out = [];
    const toW = (x, y) => I.toWorld(s, x, y), head = (dx, dy) => Math.atan2(s.ax[1] * dx + s.ay[1] * dy, s.ax[0] * dx + s.ay[0] * dy);
    for (const sp of P.staffSpots || []) {
      const [x, z] = toW(sp.x, sp.y);
      out.push({ id: `clerk-${s.id}`, x, y: b.floor0, z, heading: head(sp.dx, sp.dy), base: head(sp.dx, sp.dy), look: { ...People.randomLook(R, { work: true }), top: shopColour(s.name, R), cap: false, hood: false, bag: false, umbrella: 0 },
        visible: true, speed: 0, t: R() * 9, phase: 0, pose: 'idle', staff: true, clerk: true, lx: sp.x, ly: sp.y });
    }
    // shoppers: two to four browsing the shelves (each keeps to its own aisle, so nobody walks through the shelving),
    // and now and then someone at the till
    const spots = b.spots = shopSpots(P), used = new Set();
    const n = Math.min(spots.length, 2 + Math.floor(R() * 3));
    for (let k = 0; k < n; k++) {
      let i = -1;
      for (let q = 0; q < 20 && (i < 0 || used.has(i)); q++) i = Math.floor(R() * spots.length);
      if (i < 0 || used.has(i)) break;
      used.add(i);
      const sp = spots[i], [x, z] = toW(sp.x, sp.y);
      out.push({ id: `shopper-${s.id}-${k}`, x, y: b.floor0, z, heading: head(sp.dx, sp.dy), base: head(sp.dx, sp.dy),
        look: { ...People.randomLook(R), umbrella: 0, carrier: R() < 0.35 }, visible: true, speed: 0, speedNow: 0, t: R() * 9, phase: R() * 6, pose: 'idle',
        shopper: true, spot: i, lx: sp.x, ly: sp.y, wait: 2 + R() * 9 });
    }
    const till = P.tills?.[0], clerk = out.find(a => a.clerk);
    if (till && clerk && R() < 0.6) {
      const ly = till.y + 0.75, [x, z] = toW(till.x, ly), h = head(clerk.lx - till.x, clerk.ly - ly);
      out.push({ id: `customer-${s.id}`, x, y: b.floor0, z, heading: h, base: h, look: { ...People.randomLook(R), umbrella: 0 }, visible: true, speed: 0, speedNow: 0, t: 0, phase: 0, pose: 'idle',
        shopper: true, queue: true, lx: till.x, ly });
    }
    return (b.people = out);
  }
  tillAt(b, me) {
    const P = b.plan, t = P.tills?.[0]; if (!t) return false;
    const [lx, ly] = this.I.toLocal(b.site, me.x, me.z);
    return Math.hypot(lx - t.x, ly - t.y) < 1.5;
  }
  prompt(b, me) {
    if (!this.tillAt(b, me)) return null;
    if (this.job && this.job.site === b.site) return { text: `Emptying the till… ${Math.round(this.job.t / this.job.dur * 100)}%`, act: 'none', site: b.site, busy: true };
    const wary = this.robbed.has(b.site.id) && this.G.time - this.robbed.get(b.site.id) < 600;
    return { text: wary ? 'Rob the till (they\'re wary)' : 'Rob the till', act: 'rob', site: b.site };
  }
  start(b) {
    const G = this.G, me = G.brothers.me, s = b.site;
    if (this.job) return;
    const w = G.combat?.weapon(G.brothers.active), armed = !!w && !w.melee, knife = !!w?.melee;
    const wary = this.robbed.has(s.id) && G.time - this.robbed.get(s.id) < 600;
    const clerk = this.people(b)[0];
    this.job = { site: s, b, t: 0, dur: wary ? 6 : armed ? 2.6 : knife ? 3.6 : 6.5, armed, knife, clerk, alarmed: false, refused: !armed && !knife && Math.random() < 0.45 };
    // the weapon comes up at the shopkeeper
    if (armed) { const st = G.combat.s[G.brothers.active]; st.aimT = 4; }
    if (clerk) G.hud?.toast?.('“' + pick(wary ? LINES.wary : armed || knife ? LINES.armed : LINES.bare) + '”', 3);
    G.hud?.banner?.(`Robbing ${s.name || 'the shop'} — the alarm's gone off`, 'pursuit', 4);
    this.alarm(s);
  }
  alarm(s) {
    const G = this.G, [x, z] = this.I.toWorld(s, s.W / 2, 0);
    G.peds?.disturb?.(x, z, 40, 'gun');
  }
  update(dt, b, me) {
    const G = this.G, people = this.people(b), j = this.job;
    const s = b.site, I = this.I, head = (dx, dy) => Math.atan2(s.ax[1] * dx + s.ay[1] * dy, s.ax[0] * dx + s.ay[0] * dy);
    for (const a of people) {
      a.t += dt;
      if (a.shopper) {
        if (j && j.site === b.site) { a.pose = 'brace'; a.speedNow = 0; a.heading = Math.atan2(a.z - me.z, a.x - me.x); continue; }   // cowering, turned away
        if (a.queue) { a.pose = a.t % 14 < 9 ? 'idle' : 'talk'; continue; }
        if (a.target) {   // along the aisle to the next spot
          const T = a.target, dx = T.x - a.lx, dy = T.y - a.ly, d = Math.hypot(dx, dy);
          if (d < 0.04) { a.lx = T.x; a.ly = T.y; a.heading = a.base = head(T.dx, T.dy); a.target = null; a.wait = 4 + Math.random() * 10; a.pose = 'idle'; a.speedNow = 0; }
          else { const k = Math.min(d, 0.95 * dt); a.lx += dx / d * k; a.ly += dy / d * k; a.heading = head(dx, dy); a.pose = 'walk'; a.speedNow = 0.95; a.phase = (a.phase + dt * 3.4) % 6.283; }
          [a.x, a.z] = I.toWorld(s, a.lx, a.ly);
        } else {
          a.wait -= dt; a.speedNow = 0; a.pose = a.t % 23 < 4 ? 'phone' : 'idle';
          a.heading += (a.base - a.heading) * Math.min(1, dt * 3);
          if (a.wait <= 0) {   // on to another spot along the same aisle (not one someone's stood at)
            const here = b.spots[a.spot], taken = new Set(people.filter(q => q.shopper && q !== a).map(q => q.spot));
            const next = b.spots.map((p, i) => [p, i]).filter(([p, i]) => p.aisle === here.aisle && i !== a.spot && !taken.has(i));
            if (next.length) { const [p, i] = next[Math.floor(Math.random() * next.length)]; a.spot = i; a.target = p; }
            else a.wait = 3 + Math.random() * 6;
          }
        }
        continue;
      }
      if (j && j.site === b.site) {
        // hands up while it's emptied; then cowering behind the counter, on the phone to the police
        a.heading = Math.atan2(me.z - a.z, me.x - a.x);
        a.pose = j.t < j.dur ? (j.armed || j.knife ? 'hands' : 'point') : 'shelter';
      } else if (this.robbed.has(b.site.id) && G.time - this.robbed.get(b.site.id) < 60) { a.pose = 'phone'; a.heading = a.base; }
      else {
        const near = Math.hypot(me.x - a.x, me.z - a.z) < 4;
        if (near) a.heading = Math.atan2(me.z - a.z, me.x - a.x); else a.heading += (a.base - a.heading) * Math.min(1, dt * 2);
        a.pose = near && this.tillAt(b, me) ? 'talk' : 'idle';
        if (near && !this._greeted?.has(b.site.id)) { (this._greeted ??= new Set()).add(b.site.id); G.hud?.toast?.('“' + pick(LINES.hello) + '”', 2); }
      }
    }
    if (!j || j.site !== b.site) return;
    // walk off and it's abandoned (the alarm's still gone)
    if (!this.tillAt(b, me)) { G.hud?.toast?.('You walked away from the till — nothing taken', 3); this.job = null; return; }
    j.t += dt;
    // bare-fisted, some shopkeepers won't have it: they hit the alarm and hide, nothing handed over
    if (j.refused && j.t > 2.5) { G.hud?.toast?.('“' + pick(LINES.bare) + '” · They won\'t open the till. Try it with a weapon.', 4); this.robbed.set(b.site.id, G.time); this.job = null; return; }
    if (j.t >= j.dur) {
      const kiosk = b.site.kiosk, wary = this.robbed.has(b.site.id) && G.time - this.robbed.get(b.site.id) < 600;
      const base = kiosk ? 180 + Math.random() * 420 : 90 + Math.random() * 360;
      const take = Math.round(base * (wary ? 0.25 : 1) * (j.armed ? 1 : 0.7));
      const bro = G.brothers.me; bro.cash = Math.round((cash(bro) + take) * 100) / 100;
      this.robbed.set(b.site.id, G.time);
      G.hud?.banner?.(`+£${take} from the till · ${bro.short} has £${bro.cash.toFixed(0)}`, 'clear', 5);
      G.audio?.play?.('Car_Trunk_Open', me.x, me.y + 1, me.z, 0.3);
      this.job = null;
    }
  }
}
