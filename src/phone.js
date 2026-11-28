// Cal's phone: D-pad up on a controller (as in GTA V), N on a keyboard, or the phone button on screen.
// Apps: Kerb (book a ride: taxis.js), the Road Atlas, the radio when there's one to hand, and your money.
// The screens are plain buttons, so the controller moves between them like any other panel (data-pad="menu"):
// the D-pad or stick to move, Cross to choose, Circle Back.
import { cash } from './food.js';
import { distanceLabel } from './navigation.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = n => '£' + (+n || 0).toFixed(2);
// the kinds of place Kerb offers, from the Road Atlas's directory (hud.js), in this order
const KINDS = ['Pubs', 'Food', 'Shops', 'Stations', 'Petrol stations', 'Districts', 'Landmarks', 'Houses', 'Buildings'];
const ICONS = {
  kerb: '<svg viewBox="0 0 24 24"><path d="M4 15l1.6-5A2 2 0 017.5 8.6h9a2 2 0 011.9 1.4L20 15v4h-2.4v-2H6.4v2H4z"/><circle cx="7.5" cy="14.5" r="1.3" fill="#0d1f17"/><circle cx="16.5" cy="14.5" r="1.3" fill="#0d1f17"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.6"/></svg>',
  angler: '<svg viewBox="0 0 24 24"><path d="M3 12c3-4 8-5 12-2l4-3v10l-4-3c-4 3-9 2-12-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/></svg>',
  radio: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 8l9-4" stroke="currentColor" stroke-width="1.6"/><circle cx="15.5" cy="14" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 12h4M6 15h4" stroke="currentColor" stroke-width="1.6"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5zM5 10h2v7H5zm4 0h2v7H9zm4 0h2v7h-2zm4 0h2v7h-2zM3 18h18v2H3z"/></svg>',
  drone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>',
  tech: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9h16l-1.2 10.2a1.5 1.5 0 01-1.5 1.3H6.7a1.5 1.5 0 01-1.5-1.3z"/><path d="M8.5 9V7a3.5 3.5 0 017 0v2"/><path d="M10 14l2 2 3-4"/></svg>',
};
// the phone itself: Cal carries an Honor Magic7 Pro (flagship, MagicOS)
const PHONE_MODEL = 'HONOR Magic7 Pro';

export class Phone {
  constructor(G) {
    this.G = G; this.screen = 'home'; this.stack = []; this.quoteFor = null; this.places = []; this.kind = null; this.last = '';
    const el = this.el = document.createElement('div');
    el.id = 'phone'; el.hidden = true; el.dataset.pad = 'menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Phone');
    el.classList.add('magic');
    el.innerHTML = '<div class="phFrame"><div class="phPunch"></div><div class="phStatus"><b class="phTime"></b><span class="phSig">5G <i></i><i></i><i></i><i></i><em class="phBatt"><u></u></em></span></div><div class="phScreen"></div>'
      + '<div class="phNav"><button data-act="back">Back</button><button data-act="home">Home</button><button data-act="close">Close</button></div></div>';
    (document.getElementById('hud') || document.body).appendChild(el);
    this.body = el.querySelector('.phScreen');
    el.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) { e.stopPropagation(); this.act(b.dataset.act, b.dataset.arg); } });
    // touches on the phone are the phone's, not the game's (no swinging the camera round while you tap)
    for (const t of ['pointerdown', 'pointermove', 'touchstart', 'touchmove']) el.addEventListener(t, e => e.stopPropagation(), { passive: true });
  }
  get open() { return !this.el.hidden; }
  toggle(on = !this.open, screen = null) {
    if (on === this.open && !screen) return;
    this.el.hidden = !on;
    this.G.haptics?.tick?.();
    if (on) this.go(screen || (this.G.taxis?.job ? 'kerbRide' : 'home'), true);
  }
  go(screen, reset = false) {
    if (reset) this.stack = []; else if (screen !== this.screen) this.stack.push(this.screen);
    this.screen = screen; this.render(true);
  }
  back() { if (this.stack.length) { this.screen = this.stack.pop(); this.render(true); } else this.toggle(false); }
  act(a, arg) {
    const G = this.G, T = G.taxis;
    switch (a) {
      case 'back': return this.back();
      case 'home': return this.go('home', true);
      case 'close': return this.toggle(false);
      case 'app':
        if (arg === 'map') { this.toggle(false); return G.hud.toggleMap(true); }
        if (arg === 'radio') { this.toggle(false); return G.radio?.toggle?.(); }
        if (arg === 'fly') { this.toggle(false); return G.drone?.deploy(); }
        return this.go(arg === 'kerb' ? (T.job ? 'kerbRide' : 'kerbWhere') : arg);
      case 'kind': this.kind = arg; this.places = T.destinations(arg); return this.go('kerbPlaces');
      case 'place': {
        const p = arg === 'pin' ? G.hud.nav?.pin && { ...G.hud.nav.pin } : arg === 'home' ? this.home() : this.places[+arg];
        if (!p) return;
        // already in a hailed cab with no destination: tell the driver
        if (T.job?.stage === 'riding' && !T.job.dest) { T.setDest(p); return this.go('kerbRide', true); }
        this.quoteFor = T.quote(p); this.pick = p; return this.go('kerbQuote');
      }
      case 'request': {
        const r = T.book(this.quoteFor);
        if (r === 'ok') return this.go('kerbRide', true);
        this.note = { wanted: 'No driver will pick you up with the police after you.', busy: 'You already have a ride booked.', place: 'Book from the street, not from a car or a building.', cash: 'Not enough cash for this ride.', road: 'There\'s no road here for a car to pull up on. Walk to a street.', none: 'No drivers nearby right now. Try again in a moment.' }[r] || 'Couldn\'t book that.';
        return this.render(true);
      }
      case 'cancel': T.cancel('Kerb ride cancelled'); return this.go('home', true);
      case 'skip': T.skip(); if (this.screen !== 'kerbDone') this.toggle(false); return;   // (the receipt comes up when you're there)
      case 'stop': T.stopHere(); return this.render(true);
      case 'done': this.receipt = null; return this.go('home', true);
      case 'dmode': if (G.drone) { G.drone.mode = arg; G.drone.yawWant = G.drone.yaw; } return this.render(true);
      case 'dcam': if (G.drone) G.drone.cam = arg; return this.render(true);
      case 'lake': { const L = (G.fishing?.index || []).find(l => l.id === arg); if (L) { const x = L.peg1?.x ?? L.x, z = L.peg1?.z ?? L.z; G.hud.nav.set({ x, z, name: L.name }); G.hud.toast?.(`Route set: ${L.name}, ${L.place}`); this.toggle(false); } return; }
      case 'route': { const t = G.techShop?.nearest?.(); if (t) { G.hud.nav.set({ x: t.x, z: t.z, name: t.name }); G.hud.toast?.(`Route set: ${t.name} · ${distanceLabel(t.d)}`); this.toggle(false); } return; }
    }
  }
  home() { const h = (this.G.interiors?.sites || []).find(s => s.brothersHome); return h && { x: h.dx ?? h.x, z: h.dz ?? h.z, name: 'Home (' + (h.title || h.name || 'Woodley') + ')' }; }
  // a ride finished (taxis.js): the receipt
  arrived(J, paid) { this.receipt = { to: J.dest?.name || 'your stop', paid, driver: J.driver, kind: J.kind }; if (this.open || J.kind === 'kerb') { this.el.hidden = false; this.go('kerbDone', true); } }
  // ---------------------------------------------------------------- screens
  render(force = false) {
    const html = this['s_' + this.screen]?.() ?? this.s_home();
    if (!force && html === this.last) return;
    this.last = html;
    const focused = document.activeElement && this.el.contains(document.activeElement) ? document.activeElement.dataset.act + '|' + document.activeElement.dataset.arg : null;
    this.body.innerHTML = html;
    this.body.scrollTop = 0;
    // keep the controller's place (or start on the first button of a new screen)
    const again = focused && [...this.body.querySelectorAll('button')].find(b => b.dataset.act + '|' + b.dataset.arg === focused);
    if (again) again.focus({ preventScroll: true });
    if (force) this.note = null;
  }
  s_home() {
    const G = this.G, me = G.brothers.me, job = G.taxis?.job, radio = !!G.radio?.device?.(), h = G.world.hours();
    const time = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const W = G.world, wx = { clear: 'Sunny', broken: 'Partly cloudy', overcast: 'Cloudy', drizzle: 'Drizzle', rain: 'Rain', mist: 'Mist', clearing: 'Clearing' }[W.stateName?.()] || 'Fair';
    const temp = Math.round(9 + Math.max(0, W.sunIntensity || 0.5) * 9 - (W.cur?.rain || 0) * 3);
    const owns = !!G.drone?.kit?.(me);
    return `<div class="phHome"><div class="phWidget"><b>${time}</b><div><span>${esc(G.districtName?.(me.x, me.z) || 'Berkshire')}</span><span>${wx} · ${temp}°C</span></div></div>
      <div class="phHello"><small>${esc(PHONE_MODEL)}</small><strong>${esc(me.short || '')} · ${money(cash(me))}</strong></div>
      <div class="phApps">
        <button class="phApp kerb" data-act="app" data-arg="kerb"><i>${ICONS.kerb}</i><span>Kerb${job ? ' •' : ''}</span></button>
        <button class="phApp atlas" data-act="app" data-arg="map"><i>${ICONS.map}</i><span>Road Atlas</span></button>
        <button class="phApp drone" data-act="app" data-arg="drone"><i>${ICONS.drone}</i><span>Drone${owns ? '' : ''}</span></button>
        <button class="phApp tech" data-act="app" data-arg="tech"><i>${ICONS.tech}</i><span>TechZone</span></button>
        <button class="phApp angler" data-act="app" data-arg="angler"><i>${ICONS.angler}</i><span>Angler</span></button>
        ${radio ? `<button class="phApp radio" data-act="app" data-arg="radio"><i>${ICONS.radio}</i><span>Radio</span></button>` : ''}
        <button class="phApp bank" data-act="app" data-arg="bank"><i>${ICONS.bank}</i><span>Bank</span></button>
      </div></div>`;
  }
  // the drone: fly it from here (the phone becomes its screen and sticks), its state, its settings
  s_drone() {
    const G = this.G, me = G.brothers.me, D = G.drone, k = D?.kit?.(me);
    if (!k) return `<div class="phApp-head drone"><b>Kestrel Fly</b><span>No drone paired</span></div>
      <div class="phQuote"><strong>Kestrel T3</strong><p class="phLine">A camera drone with a thermal camera: 4K and infrared, 31 minutes in the air, 15 km of video link. On sale at TechZone, in every town.</p>
      <button class="phGo" data-act="route">Directions to TechZone</button></div>`;
    const why = D.canDeploy(), up = Object.keys(k.upgrades || {});
    const NAMES = { battery: 'High-capacity battery', guards: 'Propeller guards', range: 'Range extender' };
    return `<div class="phApp-head drone"><b>Kestrel Fly</b><span>Kestrel T3 · paired</span></div>
      <div class="phQuote"><div class="phFacts"><span>Battery 100%</span><span>Spare props ${Math.max(0, k.props ?? 0)}</span></div>
      ${up.length ? `<p class="phLine">${up.map(u => NAMES[u] || u).join(' · ')}</p>` : ''}
      <small>Flight mode</small><div class="phSeg">${['CINE', 'NORMAL', 'SPORT', 'MANUAL'].map(m => `<button data-act="dmode" data-arg="${m}" class="${D.mode === m ? 'on' : ''}">${m[0] + m.slice(1).toLowerCase()}</button>`).join('')}</div>
      <small>Camera</small><div class="phSeg">${[['normal', 'Visible'], ['thermal', 'Thermal'], ['ironbow', 'Ironbow']].map(([c, n]) => `<button data-act="dcam" data-arg="${c}" class="${D.cam === c ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${why ? `<p class="phNote warn">${esc(why)}</p>` : ''}
      <button class="phGo" data-act="app" data-arg="fly" ${why ? 'disabled' : ''}>Fly</button>
      <p class="phNote">Left thumb: climb and turn. Right thumb: fly. Pad: left stick climb / turn, right stick fly, Cross take off / land, Square camera, Circle home, L1 / R1 mode.</p></div>`;
  }
  s_tech() {
    const G = this.G, t = G.techShop?.nearest?.();
    return `<div class="phApp-head tech"><b>TechZone</b><span>Gadgets · accessories · drones</span></div>
      <div class="phQuote">${t ? `<small>Nearest store</small><strong>${esc(t.name)}</strong><div class="phFacts"><span>${distanceLabel(t.d)}</span><span>open 9–8</span></div>
      <button class="phGo" data-act="route">Get directions</button>` : '<p class="phNote">No store found.</p>'}
      <p class="phLine">Drones, spare batteries and props, guards, range extenders and more, in every town.</p></div>`;
  }
  // the angler's app: your best fish of each kind, the latest catches, what's in the tackle box, and the lakes
  s_angler() {
    const G = this.G, me = G.brothers.me, k = me.items?.fishing, lakes = G.fishing?.index || [];
    const NAMES = { roach: 'Roach', rudd: 'Rudd', perch: 'Perch', bream: 'Bream', tench: 'Tench', common: 'Common carp', mirror: 'Mirror carp', pike: 'Pike' };
    const lb = w => { let p = Math.floor(w), o = Math.round((w - p) * 16); if (o === 16) { p++; o = 0; } return p ? `${p} lb ${o} oz` : `${o} oz`; };
    const LAKE = Object.fromEntries(lakes.map(l => [l.id, l.name]));
    const pbs = k ? Object.entries(k.pb || {}).sort((a, b) => b[1] - a[1]) : [];
    const rods = k ? Object.keys(k.rods || {}).map(r => ({ float: 'Float rod', carp: 'Carp rod', lure: 'Lure rod' }[r])).join(' · ') : '';
    return `<div class="phApp-head angler"><b>Angler</b><span>${k?.stats ? `${k.stats.fish} fish · ${lb(k.stats.weight)} in all` : 'Your catches'}</span></div>
      <div class="phQuote">${!k || !rods ? '<p class="phLine">No rod yet: TechZone sells float, carp and lure rods, rigged and ready, with bait, hooks, floats and nets.</p>' : `<p class="phLine">${esc(rods)}${k.net ? ' · landing net' : ''}${k.mat ? ' · mat' : ''}${k.catapult ? ' · catapult' : ''}</p>
      <div class="phFacts"><span>Hooks ${k.tackle?.hooks || 0} · floats ${k.tackle?.floats || 0}</span><span>Hair rigs ${k.tackle?.hairrigs || 0} · leads ${k.tackle?.leads || 0}</span></div>
      <div class="phFacts"><span>Maggots ${k.bait?.maggots || 0} · corn ${k.bait?.corn || 0}</span><span>Boilies ${k.bait?.boilies || 0} · worms ${k.bait?.worms || 0}</span></div>`}
      ${pbs.length ? `<small>Personal bests</small><div class="phList">${pbs.map(([s, w]) => `<div class="phRow"><span>${esc(NAMES[s] || s)}</span><b>${lb(w)}</b></div>`).join('')}</div>` : ''}
      ${k?.log?.length ? `<small>Latest catches</small><div class="phList">${k.log.slice(0, 8).map(c => `<div class="phRow dim"><span>${esc(NAMES[c.s] || c.s)} · ${esc(LAKE[c.lake] || c.lake)} peg ${c.peg}</span><b>${lb(c.lb)}</b></div>`).join('')}</div>` : ''}
      <small>Fishing lakes</small>${lakes.map(l => `<button class="phGo" data-act="lake" data-arg="${l.id}">${esc(l.name)} · ${esc(l.place)}</button>`).join('')}</div>`;
  }
  s_bank() {
    const G = this.G, a = G.brothers.me, rides = G.taxis?.history || [];
    return `<div class="phApp-head bank"><b>County Bank</b></div><div class="phList">
      <div class="phRow"><span>${esc(a.short)}</span><b>${money(cash(a))}</b></div>
      ${rides.slice(-4).reverse().map(r => `<div class="phRow dim"><span>Kerb · ${esc(r.to || 'ride')}</span><b>−${money(r.fare)}</b></div>`).join('')}</div>`;
  }
  // Kerb: where to?
  s_kerbWhere() {
    const G = this.G, pin = G.hud.nav?.pin, home = this.home(), job = G.taxis?.job;
    const title = job?.stage === 'riding' ? 'Where to? <small>tell the driver</small>' : 'Where to?';
    return `<div class="phApp-head kerb"><b>Kerb</b><span>${title}</span></div><div class="phList">
      ${pin ? `<button class="phRow" data-act="place" data-arg="pin"><span>📍 ${esc(pin.name)}</span><em>waypoint</em></button>` : ''}
      ${home ? `<button class="phRow" data-act="place" data-arg="home"><span>🏠 Home</span><em>Woodley</em></button>` : ''}
      ${KINDS.filter(k => G.hud.placeCategories?.[k]).map(k => `<button class="phRow" data-act="kind" data-arg="${esc(k)}"><span>${esc(k)}</span><em>›</em></button>`).join('')}</div>`;
  }
  s_kerbPlaces() {
    return `<div class="phApp-head kerb"><b>Kerb</b><span>${esc(this.kind)}</span></div><div class="phList">
      ${this.places.length ? this.places.map((p, i) => `<button class="phRow" data-act="place" data-arg="${i}"><span>${esc(p.name)}</span><em>${distanceLabel(p.distance)}</em></button>`).join('') : '<p class="phNote">Nothing of that kind nearby.</p>'}</div>`;
  }
  s_kerbQuote() {
    const G = this.G, q = this.quoteFor, me = G.brothers.me, have = cash(me);
    if (!q) return `<div class="phApp-head kerb"><b>Kerb</b><span>${esc(this.pick?.name)}</span></div><p class="phNote">Kerb can't get you there by road from here.</p>`;
    const short = have + 1e-6 < q.fare;
    return `<div class="phApp-head kerb"><b>Kerb</b><span>Your ride</span></div>
      <div class="phQuote"><small>To</small><strong>${esc(q.dest.name)}</strong><div class="phFacts"><span>${q.distance}</span><span>about ${q.mins} min</span></div>
      <div class="phFare">${money(q.fare)}<small>paid in cash at the end · you have ${money(have)}</small></div>
      ${this.note ? `<p class="phNote warn">${esc(this.note)}</p>` : ''}
      <button class="phGo" data-act="request" ${short ? 'disabled' : ''}>${short ? 'Not enough cash' : 'Request Kerb'}</button></div>`;
  }
  s_kerbRide() {
    const G = this.G, T = G.taxis, J = T.job, st = T.status();
    if (!J) return this.s_kerbDone();
    const who = J.kind === 'kerb' ? `<div class="phDriver"><b>${esc(J.driver)}</b><span>${esc(J.car)}</span><code>${esc(J.plate)}</code></div>` : '<div class="phDriver"><b>Taxi</b><span>hackney carriage</span></div>';
    let line, buttons;
    if (st.stage === 'coming') { line = `On the way to you · <b>${st.eta} min</b> · ${distanceLabel(st.metres)}`; buttons = '<button class="phGo ghost" data-act="cancel">Cancel ride</button>'; }
    else if (st.stage === 'waiting') { line = `<b>Here</b> · ${distanceLabel(st.metres)} away · get in the back`; buttons = '<button class="phGo ghost" data-act="cancel">Cancel ride</button>'; }
    else if (!J.dest) { line = 'Where to?'; buttons = '<button class="phGo" data-act="app" data-arg="kerbWhere">Choose a destination</button>'; }
    else { line = `To <b>${esc(J.dest.name)}</b> · ${st.eta} min · ${money(J.fare)}`; buttons = `<button class="phGo" data-act="skip">Skip the journey</button><button class="phGo ghost" data-act="stop">Stop here</button>`; }
    return `<div class="phApp-head kerb"><b>Kerb</b><span>${J.kind === 'kerb' ? 'Your ride' : 'Taxi'}</span></div><div class="phQuote">${who}<p class="phLine">${line}</p>${buttons}</div>`;
  }
  s_kerbDone() {
    const r = this.receipt;
    if (!r) return this.s_home();
    return `<div class="phApp-head kerb"><b>Kerb</b><span>Thanks for riding</span></div><div class="phQuote"><small>You've arrived at</small><strong>${esc(r.to)}</strong>
      <div class="phFare">${money(r.paid)}<small>paid${r.driver && r.kind === 'kerb' ? ' · your driver was ' + esc(r.driver) : ''}</small></div><div class="phStars">★★★★★</div>
      <button class="phGo" data-act="done">Done</button></div>`;
  }
  // per frame: the clock, and the ride screens kept up to date
  update(dt) {
    const G = this.G, I = G.input;
    if (I.consume('phone')) this.toggle();
    if (!this.open) return;
    if ((this._t = (this._t || 0) - dt) > 0) return;
    this._t = 0.5;
    const h = G.world.hours(), t = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const tm = this.el.querySelector('.phTime'); if (tm.textContent !== t) tm.textContent = t;
    const bt = this.el.querySelector('.phBatt'); if (bt) bt.dataset.p = '87';
    if (this.screen === 'kerbRide' || this.screen === 'home' || this.screen === 'bank' || this.screen === 'drone') this.render();
  }
}
