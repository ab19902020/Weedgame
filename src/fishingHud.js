// The fishing screen and controls (fishing.js does the fishing).
//   Touch: the big button is Cast (hold to swing back, let go to cast), then Feather (hold as the rig drops), then
//     Strike while you wait, and Net when a beaten fish is under the rod tip. Hold Reel to wind (slide your thumb
//     up on it to wind faster, down to wind slower). Drag on the left of the screen to aim the cast along the bank,
//     and while playing a fish to pull the rod over to that side (side strain); drag on the right to look about.
//     Drag − / + sets the clutch. Tackle (rod, bait, tie on a new rig), Feed (loose feed round the float), Clip (clip
//     the line at your last cast's distance) and Pack up along the top.
//   Keyboard: hold Space to cast, Space again to feather and to strike; hold R (or W) to wind; A / D aim and side
//     strain; Z / X clutch; E net; B feed; T tackle; C clip; Y picture; G or Esc pack up.
//   DualShock / DualSense: hold R2 to swing back and let go to cast; R2 (or L2) again to feather; R2 winds (how far
//     you squeeze it is how fast); Cross strikes and nets (or flick the right stick down and back to strike, like
//     lifting into it); left stick aims and gives side strain; L2 lifts the rod to pump a big fish; right stick
//     looks; L1 / R1 clutch down / up; Square tackle; Circle feed; D-pad up clip, left / right bait, down rod;
//     Triangle packs up. The pad buzzes on the alarm's bleeps and pulls with the fish; on a DualSense connected for
//     trigger effects, R2 stiffens as the line comes tight.
import { SPECIES, WATERS, BAITS, RODS, lbOz } from './fishData.js';
import { canAfford } from './fishing.js';
import { cash } from './food.js';

const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  rod: svg('<path d="M4 20L20 4"/><circle cx="7" cy="17" r="2.2"/><path d="M20 4v9"/>'),
  reel: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 5v-2M19 12h2"/>'),
  net: svg('<path d="M3 21l7-7"/><ellipse cx="15" cy="9" rx="6" ry="5"/><path d="M11 6l8 6M11 12l8-6M15 4v10"/>'),
  feed: svg('<circle cx="7" cy="7" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="16" cy="9" r="1.6"/><path d="M4 14c3 5 13 5 16 0"/>'),
  box: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>'),
  clip: svg('<path d="M8 3v12a4 4 0 008 0V6a2.5 2.5 0 00-5 0v9"/>'),
  exit: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
  cam: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
};
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => '£' + (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
const BAITNAME = id => BAITS[id]?.name || id;

export class FishingHud {
  constructor(G) {
    this.G = G; this.F = G.fishing;
    this.keys = new Set(); this.pad = { aim: 0, lift: 0, reel: 0, look: { dx: 0, dy: 0 } };
    this.touch = { aim: { id: null, ox: 0, x: 0 }, look: { id: null, x: 0, y: 0 }, reel: { id: null, oy: 0, v: 0 } };
    this.edges = new Set();
    const el = this.el = document.createElement('div'); el.id = 'fishHud'; el.hidden = true;
    el.innerHTML = `<div class="fZone aim"></div><div class="fZone look"></div>
      <div class="fTop"><div class="fInfo"><b class="fLake"></b><span class="fLine"></span></div>
        <div class="fBtns"><button data-f="tackle">${ICON.box}<b>Tackle</b></button><button data-f="feed">${ICON.feed}<b>Feed</b></button><button data-f="clip">${ICON.clip}<b>Clip</b></button><button data-f="exit">${ICON.exit}<b>Pack up</b></button></div></div>
      <div class="fBite"><canvas width="160" height="110"></canvas><span></span></div>
      <div class="fTension"><i class="fill"></i><i class="drag"></i><b>Line</b><button data-f="drag+">+</button><span class="fDrag"></span><button data-f="drag-">−</button></div>
      <button class="fReel">${ICON.reel}<span>Reel</span></button>
      <button class="fMain"><canvas width="200" height="200"></canvas><span>Cast</span></button>
      <div class="fAimStick"><i></i></div>
      <div class="fSay"></div>`;
    document.body.append(el);
    this.mainBtn = el.querySelector('.fMain'); this.mainLabel = this.mainBtn.querySelector('span'); this.powerCv = this.mainBtn.querySelector('canvas');
    this.reelBtn = el.querySelector('.fReel'); this.biteCv = el.querySelector('.fBite canvas'); this.biteTxt = el.querySelector('.fBite span');
    this.say = el.querySelector('.fSay'); this.aimStick = el.querySelector('.fAimStick');
    const opts = { passive: false };
    // the big button: pressed / held
    this.mainBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.mainHeld = true; this.edges.add('main'); this.mainBtn.setPointerCapture?.(e.pointerId); try { navigator.vibrate?.(8); } catch { /* none */ } }, opts);
    const mainUp = e => { if (!this.mainHeld) return; e.preventDefault?.(); this.mainHeld = false; };
    this.mainBtn.addEventListener('pointerup', mainUp); this.mainBtn.addEventListener('pointercancel', mainUp);
    // reel: hold to wind, slide up for faster
    this.reelBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const T = this.touch.reel; T.id = e.pointerId; T.oy = e.clientY; T.v = 0.7; this.reelBtn.setPointerCapture?.(e.pointerId); }, opts);
    this.reelBtn.addEventListener('pointermove', e => { const T = this.touch.reel; if (e.pointerId !== T.id) return; T.v = clamp(0.7 + (T.oy - e.clientY) / 90, 0.25, 1); });
    const reelUp = e => { const T = this.touch.reel; if (e.pointerId === T.id) { T.id = null; T.v = 0; } };
    this.reelBtn.addEventListener('pointerup', reelUp); this.reelBtn.addEventListener('pointercancel', reelUp);
    for (const b of el.querySelectorAll('[data-f]')) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.act(b.dataset.f); }, opts);
    // the free screen: left drags aim (and side strain), right drags look
    el.querySelector('.fZone.aim').addEventListener('pointerdown', e => { e.preventDefault(); const T = this.touch.aim; if (T.id != null) return; T.id = e.pointerId; T.ox = e.clientX; T.x = 0; this.aimStick.style.left = (e.clientX - 60) + 'px'; this.aimStick.style.top = (e.clientY - 22) + 'px'; this.aimStick.classList.add('on'); }, opts);
    el.querySelector('.fZone.look').addEventListener('pointerdown', e => { e.preventDefault(); const T = this.touch.look; if (T.id != null) return; T.id = e.pointerId; T.x = e.clientX; T.y = e.clientY; }, opts);
    addEventListener('pointermove', e => {
      const A = this.touch.aim, L = this.touch.look;
      if (e.pointerId === A.id) { const dx = clamp(e.clientX - A.ox, -70, 70); A.x = Math.abs(dx) < 6 ? 0 : dx / 70; this.aimStick.firstChild.style.transform = `translateX(${dx}px)`; }
      if (e.pointerId === L.id) { this.pad.look.dx += e.clientX - L.x; this.pad.look.dy += e.clientY - L.y; L.x = e.clientX; L.y = e.clientY; }
    }, opts);
    const up = e => { const A = this.touch.aim, L = this.touch.look; if (e.pointerId === A.id) { A.id = null; A.x = 0; this.aimStick.classList.remove('on'); this.aimStick.firstChild.style.transform = ''; } if (e.pointerId === L.id) L.id = null; };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    // keyboard
    addEventListener('keydown', e => {
      if (!this.F.active || this.panel) return;
      this.keys.add(e.code); if (e.repeat) return;
      const k = e.code;
      if (k === 'Space') { this.edges.add('main'); this.mainHeld = true; }
      else if (k === 'KeyE') this.edges.add('net'); else if (k === 'KeyB') this.act('feed'); else if (k === 'KeyT') this.act('tackle'); else if (k === 'KeyC') this.act('clip');
      else if (k === 'KeyZ') this.act('drag-'); else if (k === 'KeyX') this.act('drag+'); else if (k === 'KeyY') this.act('photo'); else if (k === 'Enter') this.edges.add('ok');
      else if (k === 'KeyG' || k === 'Escape') this.act('exit');
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'Space') this.mainHeld = false; });
    this.panel = null;
  }
  // ---------------------------------------------------------------- buttons
  act(a) {
    const F = this.F; if (!F.active) return;
    if (a === 'exit') { if (F.state === 'fight' && !this._confirmExit) { this._confirmExit = F.t; F.toast('Pack up mid-fight? Press again to put the rod down', 2.5); return; } this._confirmExit = 0; F.stop(); this.closePanel(); }
    else if (a === 'feed') F.feedSwim();
    else if (a === 'clip') F.toggleClip();
    else if (a === 'drag+') { F.setDrag(F.dragLb() + (F.rodSpec().line > 10 ? 0.5 : 0.2)); F.toast(`Clutch ${F.dragLb().toFixed(1)} lb`, 1); }
    else if (a === 'drag-') { F.setDrag(F.dragLb() - (F.rodSpec().line > 10 ? 0.5 : 0.2)); F.toast(`Clutch ${F.dragLb().toFixed(1)} lb`, 1); }
    else if (a === 'tackle') this.tackle();
    else if (a === 'photo') { if (F.state === 'landed') { F.photo = !F.photo; this.card(); } }
    this.G.haptics?.tick?.();
  }
  // ---------------------------------------------------------------- what fishing.js reads each frame
  input(dt) {
    const F = this.F, st = F.state, k = this.keys, P = this.pad, T = this.touch;
    const key = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    const edge = n => { const v = this.edges.has(n); this.edges.delete(n); return v; };
    const main = edge('main'), held = this.mainHeld || this.padMain;
    const I = {
      aim: clamp(T.aim.x + P.aim + key('KeyD', 'KeyA'), -1, 1),
      lift: clamp(P.lift + (k.has('ShiftLeft') ? 1 : 0), 0, 1),
      reel: clamp(Math.max(T.reel.v, P.reel, k.has('KeyR') || k.has('KeyW') ? 1 : 0), 0, 1),
      look: { dx: P.look.dx, dy: P.look.dy },
      dragDelta: 0, feed: false,
      castDown: false, castHeld: false, feather: false, strike: false, net: edge('net'), ok: edge('ok'), exit: false,
    };
    P.look.dx = P.look.dy = 0;
    if (st === 'ready') { I.castDown = main; I.castHeld = held; }
    else if (st === 'windup') I.castHeld = held;
    else if (st === 'release' || st === 'flight') I.feather = held || P.feather > 0.3;
    else if (st === 'fishing' || st === 'settle' || st === 'snagged') I.strike = main || edge('strike');
    else if (st === 'fight' || st === 'netting') I.net = I.net || main;
    else if (st === 'landed') I.ok = I.ok || main;
    edge('strike');
    // a flick back on the right stick strikes (and lifts into a fish)
    if (this.flick) { if (st === 'fishing' || st === 'settle') I.strike = true; this.flick = false; }
    void dt;
    return I;
  }
  // the pad (controller.js hands it over while fishing)
  padInput(pad, tap, axis, buttons) {
    const F = this.F, P = this.pad, v = n => pad.buttons[n]?.value || 0;
    P.aim = axis(0);
    P.look.dx += axis(2) * 14; P.look.dy += axis(3) * 10;
    const r2 = v(7), l2 = v(6);
    // R2: swing back and cast, feather, wind
    this.padMain = (F.state === 'ready' || F.state === 'windup') && r2 > 0.35;
    if ((F.state === 'ready') && r2 > 0.35 && !(this._r2 > 0.35)) this.edges.add('main');
    this._r2 = r2;
    P.feather = (F.state === 'flight' || F.state === 'release') ? Math.max(r2, l2) : 0;
    P.reel = (F.state === 'fishing' || F.state === 'settle' || F.state === 'snagged' || F.state === 'fight' || F.state === 'netting') ? r2 : 0;
    P.lift = l2;
    // a flick of the right stick down and back: the strike
    const ry = axis(3); if (ry > 0.85 && (this._ry ?? 0) < 0.35) this.flick = true; this._ry = ry;
    if (tap(0)) { if (F.state === 'fight' || F.state === 'netting') this.edges.add('net'); else if (F.state === 'landed') this.edges.add('ok'); else this.edges.add('strike'); }
    if (tap(4)) this.act('drag-'); if (tap(5)) this.act('drag+');
    if (tap(2)) this.act('tackle'); if (tap(1)) this.act('feed'); if (tap(3)) this.act(F.state === 'landed' ? 'photo' : 'exit');
    if (tap(12)) this.act('clip');
    if (tap(14) || tap(15)) this.cycleBait(tap(15) ? 1 : -1);
    if (tap(13)) this.cycleRod();
    void buttons;
  }
  cycleBait(d) {
    const F = this.F, ok = Object.entries(BAITS).filter(([, b]) => b.methods.includes(F.method)).map(([id]) => id), k = F.kit();
    const i = ok.indexOf(k.sel[F.method]); for (let s = 1; s <= ok.length; s++) { const b = ok[(i + d * s + ok.length * 4) % ok.length]; if (F.baitLeft(b) > 0) { F.chooseBait(b); return; } }
    F.toast('No other bait for this rod in the bag', 1.6);
  }
  cycleRod() {
    const F = this.F, list = ['float', 'ledger', 'lure'].filter(m => F.rodOwned(F.rodKind(m)));
    if (F.state !== 'ready') { F.toast('Wind in first to change rods', 1.6); return; }
    const i = list.indexOf(F.method); F.chooseMethod(list[(i + 1) % list.length]);
  }
  // ---------------------------------------------------------------- panels: a ticket, the tackle box, the catch
  closePanel() { this.panel?.remove(); this.panel = null; }
  openPanel(cls, html, onClick) {
    this.closePanel();
    const p = this.panel = document.createElement('div'); p.className = 'fPanel ' + cls; p.dataset.pad = 'menu'; p.innerHTML = html;
    document.body.append(p);
    p.addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (!b) return; e.stopPropagation(); onClick(b.dataset.p, b); });
    for (const t of ['pointerdown', 'pointermove', 'touchstart', 'touchmove']) p.addEventListener(t, e => e.stopPropagation(), { passive: true });
    return p;
  }
  ticket(lake, W, onBuy) {
    const me = this.G.brothers.me, can = canAfford(me, W.price);
    this.openPanel('ticket', `<h2>${esc(lake.name)}</h2><p class="sub">${esc(lake.place)} · ${esc(W.club)}</p>
      <p>${esc(W.label)}: <b>${money(W.price)}</b>${W.ticket === 'day' ? ' (today)' : ' (yours to keep)'}</p>
      <ul>${(W.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="sub">You have ${money(cash(me))}</p>
      <div class="row"><button data-p="buy" ${can ? '' : 'disabled'}>${can ? 'Buy and fish' : 'Not enough cash'}</button><button data-p="no">Not now</button></div>`,
      a => { this.closePanel(); if (a === 'buy') onBuy(); });
  }
  tackle() {
    const F = this.F, k = F.kit(), R = F.rodSpec();
    if (F.state === 'fight' || F.state === 'netting') { F.toast('Not while you\'re playing a fish', 1.6); return; }
    const rods = ['float', 'ledger', 'lure'].filter(m => F.rodOwned(F.rodKind(m)));
    const baits = Object.entries(BAITS).filter(([, b]) => b.methods.includes(F.method));
    const rod = k.rods[F.rodKind()], need = F.method === 'lure' ? [] : RODS[F.rodKind()].rig;
    const rigLine = !F.rigged() ? `<b class="warn">Nothing on the line.</b> ${F.method === 'lure' ? 'Clip on a lure' : `A new rig uses ${need.map(t => ({ hooks: '1 hook', floats: '1 float', hairrigs: '1 hair rig', leads: '1 lead' }[t])).join(' and ')}`}`
      : rod?.wear >= 12 ? '<b class="warn">The hook is blunt</b>: fish will come off. Change it' : F.method === 'lure' ? `${BAITNAME(rod.rig)} on the trace` : `Rigged · ${rod?.wear || 0} fish on this hook`;
    const spares = F.method === 'float' ? `hooks ${k.tackle.hooks} · floats ${k.tackle.floats}` : F.method === 'ledger' ? `hair rigs ${k.tackle.hairrigs} · leads ${k.tackle.leads}` : `spinners ${k.tackle.spinner} · shads ${k.tackle.shad}`;
    this.openPanel('tackle', `<h2>Tackle box</h2>
      <h3>Rod</h3><div class="row">${rods.map(m => `<button data-p="rod:${m}" class="${m === F.method ? 'on' : ''}">${esc(F.rodSpec(m).name)}<small>${F.rodSpec(m).line} lb line</small></button>`).join('')}</div>
      <h3>${F.method === 'lure' ? 'Lure' : 'Bait'}</h3><div class="row">${baits.map(([id, b]) => `<button data-p="bait:${id}" class="${id === k.sel[F.method] ? 'on' : ''}" ${F.baitLeft(id) > 0 ? '' : 'disabled'}>${esc(b.name)}<small>${F.baitLeft(id)} left</small></button>`).join('')}</div>
      <h3>Rig</h3><p>${rigLine}</p><p class="sub">Spares: ${spares}</p>
      <div class="row"><button data-p="retie">${F.method === 'lure' ? 'Clip on a lure' : rod?.wear >= 12 && F.rigged() ? 'Change the hook' : 'Tie on a new rig'}</button></div>
      <h3>Clutch</h3><p>${F.dragLb().toFixed(1)} lb of ${R.line} lb line <span class="sub">(about a third of the line's strength is right for a big fish)</span></p>
      <div class="row"><button data-p="drag-">Looser</button><button data-p="drag+">Tighter</button></div>
      <p class="sub">${esc(F.lake?.name)}: ${(F.water.rules || []).map(esc).join(' · ')}</p>
      <div class="row"><button data-p="close">Done</button></div>`, a => {
      if (a.startsWith('rod:')) { if (F.state !== 'ready') { F.toast('Wind in first to change rods', 1.6); return; } F.chooseMethod(a.slice(4)); }
      else if (a.startsWith('bait:')) F.chooseBait(a.slice(5));
      else if (a === 'retie') F.retie();
      else if (a === 'drag-' || a === 'drag+') this.act(a);
      if (a === 'close') this.closePanel(); else this.tackle();
    });
  }
  card() {
    const F = this.F, c = F.caught; if (!c) return;
    const k = F.kit(), pb = k.pb[c.s];
    this.openPanel('catch', `<div class="cTop"><b>${esc(c.name)}</b><span>${esc(c.weight)}</span></div>
      <p class="big">${esc(c.weight)} <small>(${c.kg} kg) · ${c.cm} cm</small></p>
      ${c.first ? '<p class="badge">Your first ' + esc(c.name.toLowerCase()) + '!</p>' : c.pb ? '<p class="badge">A new personal best!</p>' : `<p class="sub">Your best ${esc(c.name.toLowerCase())}: ${esc(lbOz(pb))}</p>`}
      ${c.lakeBest ? `<p class="badge gold">One of ${esc(c.lakeName)}'s biggest!</p>` : ''}
      <p class="sub">${esc(c.lakeName)}, peg ${c.peg} · ${esc(BAITNAME(c.bait))} · ${esc(F.rodSpec(c.method).name)}</p>
      <div class="row"><button data-p="photo">${F.photo ? 'Put it on the mat' : 'Hold it up for a picture'}</button><button data-p="return">Put it back</button></div>`, a => {
      if (a === 'photo') { F.photo = !F.photo; this.card(); }
      else if (a === 'return') { this.closePanel(); F.release_fish(); }
    });
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G, F = this.F;
    document.body.classList.toggle('fishing-on', F.active);
    if (this.el.hidden !== !F.active) { this.el.hidden = !F.active; if (!F.active) { this.closePanel(); this.keys.clear(); this.mainHeld = false; } }
    if (!F.active) return;
    const s = F.status();
    // the catch card, once, when a fish is landed
    if (s.state === 'landed' && !this.panel) this.card();
    if (s.state !== 'landed' && this.panel?.classList.contains('catch')) this.closePanel();
    // top: where, what's on, how much line
    const h = G.world?.hours?.() ?? 12, hhmm = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
    this.el.querySelector('.fLake').textContent = `${s.lake} · peg ${s.peg} · ${hhmm}`;
    const what = s.method === 'lure' ? BAITNAME(F.kit().rods.lure?.rig || s.bait) : `${BAITNAME(s.bait)} ×${s.baitLeft}`;
    this.el.querySelector('.fLine').textContent = `${s.rod} · ${s.line} lb · ${what}${s.clip ? ` · clipped ${s.clip} m` : ''}${s.state === 'fishing' || s.state === 'fight' ? ` · ${Math.round(s.state === 'fight' ? s.lineOut : s.distance)} m out` : s.state === 'ready' && s.open ? ` · ${s.open} m of water ahead` : ''}${!s.rigged ? ' · NO RIG' : s.wear >= 12 ? ' · blunt hook' : ''}`;
    // the big button's job
    const label = { ready: s.rigged ? 'Cast' : 'Tackle', windup: 'Release', release: 'Feather', flight: 'Feather', settle: 'Strike', fishing: 'Strike', snagged: 'Strike', fight: s.canNet ? 'Net' : 'Net', netting: 'Net', landed: 'OK' }[s.state] || '';
    if (this.mainLabel.textContent !== label) this.mainLabel.textContent = label;
    this.mainBtn.classList.toggle('hot', s.state === 'fishing' && s.bite?.phase === 'take' || s.state === 'fight' && s.canNet && s.fishE < 0.15);
    this.mainBtn.classList.toggle('dim', s.state === 'fight' && !s.canNet);
    if (s.state === 'ready' && !s.rigged && this.edges.has('main')) { this.edges.delete('main'); this.tackle(); }
    this.reelBtn.classList.toggle('on', (this.touch.reel.v || this.pad.reel || this.keys.has('KeyR')) > 0);
    this.drawPower(s); this.drawBite(s);
    // the line gauge: tension against the line's strength, the clutch setting marked
    const tg = this.el.querySelector('.fTension'), frac = clamp(s.tension / s.line, 0, 1), dragF = clamp(s.drag / s.line, 0, 1);
    tg.querySelector('.fill').style.height = (frac * 100).toFixed(1) + '%';
    tg.querySelector('.fill').style.background = frac > 0.85 ? '#ff4a3a' : frac > 0.6 ? '#ffc23a' : '#6fe08a';
    tg.querySelector('.drag').style.bottom = (dragF * 100).toFixed(1) + '%';
    tg.querySelector('.fDrag').textContent = `${s.drag.toFixed(1)} lb`;
    tg.classList.toggle('active', s.state === 'fight' || s.state === 'netting' || s.state === 'snagged');
    // the call: what's happening
    let say = '';
    if (s.state === 'windup') say = s.charge > 1.05 ? 'Too far back!' : `Let go to cast · ${Math.round(s.aimDist)} m`;
    else if (s.state === 'flight' || s.state === 'release') say = 'Feather it down…';
    else if (s.state === 'fishing' && s.bite?.phase === 'take') say = s.method === 'ledger' ? 'RUN! STRIKE!' : s.method === 'lure' ? 'HIT! STRIKE!' : 'IT\'S GONE UNDER! STRIKE!';
    else if (s.state === 'fight') say = s.snag ? 'Snagged! Side strain' : s.fishE < 0.12 ? (s.canNet ? 'It\'s beaten: NET IT' : 'Beaten: draw it in') : s.tension > s.drag * 0.95 ? 'It\'s taking line' : '';
    else if (s.state === 'snagged') say = 'Snagged: wind to pull free';
    if (this.say.textContent !== say) { this.say.textContent = say; this.say.classList.toggle('on', !!say); }
    void dt; void G; void SPECIES; void WATERS;
  }
  // the cast meter round the big button: power builds to full; past it, it goes off
  drawPower(s) {
    const c = this.powerCv.getContext('2d'), W = 200; c.clearRect(0, 0, W, W);
    if (s.state !== 'windup') return;
    const p = Math.min(1.6, s.charge), a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5;
    c.lineWidth = 12; c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.arc(100, 100, 88, a0, a1); c.stroke();
    const k = Math.min(1, p / 1.6), col = p > 1.05 ? '#ff5040' : p > 0.85 ? '#7dff8a' : '#ffffff';
    c.strokeStyle = col; c.beginPath(); c.arc(100, 100, 88, a0, a0 + (a1 - a0) * k); c.stroke();
    // the sweet spot: full power, before it goes off
    c.strokeStyle = 'rgba(125,255,138,0.6)'; c.lineWidth = 4; c.beginPath(); c.arc(100, 100, 100 - 4, a0 + (a1 - a0) * (0.85 / 1.6), a0 + (a1 - a0) * (1.05 / 1.6)); c.stroke();
  }
  // the bite indicator: the float's tip close up, or the alarm's LED and hanger
  drawBite(s) {
    const c = this.biteCv.getContext('2d'), W = 160, H = 110, box = this.el.querySelector('.fBite');
    const show = (s.state === 'fishing' || s.state === 'settle') && s.method !== 'lure';
    box.classList.toggle('on', show); if (!show) return;
    c.clearRect(0, 0, W, H);
    if (s.method === 'float') {
      // water line, the float's tip above it (dipping, under on a take)
      const F = this.F, B = F.bite; let tip = 22;
      if (B) { if (B.dip > 0) tip -= Math.sin((0.35 - B.dip) / 0.35 * Math.PI) * 16; if (B.phase === 'take') tip = B.shape.run === 'lift' && B.tTake < B.shape.window * 0.5 ? 34 : -10; }
      tip += Math.sin(F.t * 1.7) * 1.5;
      const g = c.createLinearGradient(0, 70, 0, H); g.addColorStop(0, '#3b5a6a'); g.addColorStop(1, '#1d3240'); c.fillStyle = g; c.fillRect(0, 70, W, H - 70);
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(0, 70, W, 2);
      if (tip > -6) { c.fillStyle = '#ff3a10'; c.fillRect(74, 70 - tip, 12, tip + 2); c.fillStyle = '#ffe0d0'; c.fillRect(74, 70 - tip, 12, 3); }
      this.biteTxt.textContent = B?.phase === 'take' ? 'UNDER!' : B ? 'dip…' : s.state === 'settle' ? 'cocking…' : 'watching the float';
    } else {
      const F = this.F, on = (F.alarmLed || 0) > 0.2;
      c.fillStyle = '#18191c'; c.fillRect(30, 30, 100, 50); c.fillStyle = on ? '#ff2020' : '#3a0808'; c.beginPath(); c.arc(60, 55, 9, 0, 7); c.fill();
      if (on) { c.fillStyle = 'rgba(255,40,40,0.35)'; c.beginPath(); c.arc(60, 55, 20, 0, 7); c.fill(); }
      const up = F.bite?.phase === 'take' ? 1 : 0; c.fillStyle = '#ff5020'; c.fillRect(100, 70 - up * 30, 14, 10);
      this.biteTxt.textContent = F.bite?.phase === 'take' ? 'RUN!' : F.bite ? 'bleep…' : 'alarm set';
    }
  }
}
