// The corner shops and the petrol stations' shops (interiors.json kind 'shop'; interiorPlan.js shop()): someone
// behind the counter, and the till to rob. Walk up to the counter and Rob: with a weapon out the shopkeeper's
// hands go up and the till's emptied in a couple of seconds; with bare fists it takes a lot longer of shouting.
// The alarm goes the moment you start, a 999 call brings the nearest police cars on blue lights (police.js
// callIn) and the cash goes in the brother's pocket. A shop that's been done is wary for a while.
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
        visible: true, speed: 0, t: R() * 9, phase: 0, pose: 'idle', staff: true, clerk: true });
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
    G.police?.callIn?.(`armed robbery at ${s.name || 'a shop'}`, x, z, 2, 3);
    G.peds?.disturb?.(x, z, 40, 'gun');
  }
  update(dt, b, me) {
    const G = this.G, people = this.people(b), j = this.job;
    for (const a of people) {
      a.t += dt;
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
      G.hud?.banner?.(`+£${take} from the till · ${bro.short} has £${bro.cash.toFixed(0)} · get out before the police arrive`, 'pursuit', 5);
      G.audio?.play?.('Car_Trunk_Open', me.x, me.y + 1, me.z, 0.3);
      this.job = null;
    }
  }
}
