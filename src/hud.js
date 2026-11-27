import {isElectric} from './propulsion.js';
// HUD: minimap, full map, buttons, notices, developer panel and performance overlay.
import { presets } from './graphics.js';
import { ROLES } from './riggedPeople.js';
import { GameMenu } from './gameMenu.js';
import { Navigation, distanceLabel } from './navigation.js';
import { STATES } from './weather.js';
import { MapView, siteIcon, siteDot } from './mapView.js';
import { WEAPONS, BY_KEY } from './weaponsData.js';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const TESTSPOTS = [
  ['Woodley precinct', -2869, -2192], ['Woodley signal crossing', -2790, -2318], ['Cemetery Junction arch', -5890, -2190, 0],
  ['Reading Town Hall (from The Forbury)', -7240, -2600, 3.14], ['Suttons Park Ave (A3290 flyover)', -5372, -2681, 0], ['M4 over Reading Road', -289, 790],
];
// line icons for the touch buttons (24-unit grid, stroked with currentColor)
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  cam: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  dev: svg('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>'),
  door: svg('<path d="M5 20V5l9-2v18zM14 5h5v15h-5M11 12h.5"/>'),
  exit: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
  bus: svg('<rect x="5" y="3" width="14" height="15" rx="2"/><path d="M5 11h14M8 21v-3M16 21v-3"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/>'),
  hand: svg('<path d="M7 12V6.5a1.5 1.5 0 013 0V11M10 10V4.5a1.5 1.5 0 013 0V11M13 10V5.5a1.5 1.5 0 013 0V12M16 11V8.5a1.5 1.5 0 013 0V14c0 4-3 7-7 7-3 0-5-2-6.5-4L3 13.5a1.5 1.5 0 012.4-1.8L7 14"/>'),
  gun: svg('<path d="M3 8h15l1 2h2v2h-6l-1 1h-3l-1 6H6l1-6H3z"/>'),
  pistol: svg('<path d="M3 8h15l1 2h2v2h-6l-1 1h-3l-1 6H6l1-6H3z"/>'),
  smg: svg('<path d="M2 9h17v3h-5l-1 2v4h-2l-1-4H8l-1 4H5l1-5H2zM19 10.5h3"/>'),
  rifle: svg('<path d="M1 10h4l1-2h12v2h5v2H17l-2 1v3h-2l-1-3H8l-2 3H3l1-3H1z"/>'),
  shotgun: svg('<path d="M1 10h5l1-1h15v2.5H8l-1 1.5H4l-1 3H1zM9 11.5v2.5h6"/>'),
  sniper: svg('<path d="M1 11h4l1-2h12v2h5v1.5H17l-2 1v3h-2l-1-3H8l-2 3H3l1-3H1zM8 5h8v3H8z"/>'),
  knife: svg('<path d="M3 15l12-9c2-1.3 4.5-.5 5.5.5L8 16zM8 16l-3 3-2-2 2-2"/>'),
  target: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/>'),
  next: svg('<path d="M4 8h12l-3-3M20 16H8l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  fist: svg('<path d="M6 10V7.5a1.5 1.5 0 013 0V10M9 9.5V6.5a1.5 1.5 0 013 0V10M12 9.5V7a1.5 1.5 0 013 0v3M15 10V8.5a1.5 1.5 0 013 0V14c0 3.5-2.5 6-6 6H11c-3 0-5-2-5-5v-5z"/>'),
  run: svg('<circle cx="14" cy="4.5" r="2"/><path d="M5 12l3-4h5l2 4 3 1M11 8l-2 6 4 3-1 5M9 14l-3 6"/>'),
  jump: svg('<circle cx="12" cy="4" r="2"/><path d="M12 7v7M8 10l4-2 4 2M9 21l3-7 3 7M4 17h3M17 17h3"/>'),
  horn: svg('<path d="M3 10v4h4l6 4V6L7 10z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>'),
  handbrake: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7v6M12 16v.5"/><path d="M2.5 8a11 11 0 000 8M21.5 8a11 11 0 010 8"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
};
export class Hud {
  constructor(G) {
    this.G = G;
    const root = document.getElementById('hud');
    root.innerHTML = `
      <div id="mini"><canvas id="miniC" width="220" height="220"></canvas><div id="lawBar"><span id="hpBar" aria-label="Health"><i></i></span><span id="stars" aria-label="Wanted level"></span></div><div id="road"></div><div id="guidance" hidden><small></small><strong></strong></div></div>
      <div id="hurt"></div><div id="bigText" hidden></div>
      <div id="clock"></div>
      <div id="banner" hidden></div>
      <div id="toast" hidden></div>
      <div id="feed"></div>
      <div id="fade"></div>
      <div id="btns">
        <div class="top">
          <button id="bCam" data-act="camera" aria-label="Camera">${ICON.cam}<b>Camera</b></button><button id="bSwap" aria-label="Swap brother">${ICON.swap}<b>Swap</b></button><button id="bMap" aria-label="Map">${ICON.map}<b>Map</b></button><button id="bMenu" aria-label="Menu">${ICON.menu}<b>Menu</b></button><button id="bDev" aria-label="Developer">${ICON.dev}<b>Dev</b></button>
        </div>
        <div class="foot">
          <button id="bUse" class="ctx"><i>${ICON.door}</i><span>Enter</span></button>
          <button id="bPickup" class="mid" aria-label="Pick up">${ICON.hand}<b>Pick up</b></button>
          <button id="bHit" class="mid" aria-label="Hit">${ICON.fist}<b>Hit</b></button>
          <button id="bAim" class="mid" aria-label="Aim" hidden>${ICON.target}<b>Aim</b></button>
          <button id="bNext" class="mid" aria-label="Next target" hidden>${ICON.next}<b>Next</b></button>
          <button id="bWeapon" class="mid" aria-label="Weapons">${ICON.gun}<b>Weapons</b></button>
          <div id="ammo" hidden></div>
          <button id="bRun" class="big" aria-label="Run">${ICON.run}<b>Run</b></button>
          <button id="bJump" class="big" aria-label="Jump">${ICON.jump}<b>Jump</b></button>
        </div>
        <div class="drive" hidden>
          <button id="bBeam" class="mid" aria-label="Full beam" aria-pressed="false">Beam</button><button id="bHorn" class="mid" aria-label="Horn">${ICON.horn}<b>Horn</b></button>
          <button id="bHand" class="mid" aria-label="Handbrake">${ICON.handbrake}<b>Handbrake</b></button>
          <div id="pBrake" class="pedal brake" role="button" aria-label="Brake"><span>BRAKE</span><em>R</em></div>
          <div id="pGas" class="pedal gas" role="button" aria-label="Accelerator"><span>GAS</span></div>
        </div>
        <div class="arrows" hidden><div id="sLeft" class="arrow" role="button" aria-label="Steer left">${ICON.left}</div><div id="sRight" class="arrow" role="button" aria-label="Steer right">${ICON.right}</div></div>
      </div>
      <div id="wheel" hidden><div class="ring"></div><p class="wName"></p></div>
      <div id="speedo" hidden><b>0</b><small>MPH</small><i></i></div>
      <div id="map" hidden><canvas id="mapC"></canvas><div class="maptools"><div class="atlasTitle">Green County <em>Road Atlas</em></div><button id="mClose">Close</button></div>
      <div class="atlasPlaces"><button id="mFit" hidden>Route</button><button id="mMe">Locate</button><button id="mOut" aria-label="Zoom out">−</button><button id="mIn" aria-label="Zoom in">+</button></div>
      <section class="mapDirectory" aria-label="Find a destination"><nav id="mKinds" aria-label="Location categories"></nav>
      <div class="placeDetail"><button id="mPrev" aria-label="Previous location">‹</button><div aria-live="polite"><small id="mDistance"></small><strong id="mName"></strong></div><button id="mNext" aria-label="Next location">›</button><button id="mGo">Set waypoint</button></div></section><div class="atlasFooter"><span id="mInfo"></span><button id="mClear">Clear waypoint</button></div></div>
      <div id="dev" class="panel" role="dialog" aria-labelledby="devTitle" hidden></div>
      <div id="perf" hidden></div>`;
    this.mini = root.querySelector('#miniC').getContext('2d');
    this.el = id => root.querySelector('#' + id);
    const I = G.input;
    for(const [id,action] of [['bJump','jump'],['bPickup','pickup']])I.bindButton(this.el(id),action);
    I.bindButton(this.el('bHit'), 'hit', true, true);   // held: an automatic keeps firing; dragged: aims as you fire
    I.bindAim(this.el('bAim'));                         // held, or tapped to stay up (combat.js targeting)
    I.bindButton(this.el('bNext'), 'nextTarget');
    // the reticle: free-aim crosshair, red on someone, brackets when locked on
    this.reticleEl = document.createElement('div'); this.reticleEl.id = 'reticle'; this.reticleEl.hidden = true;
    this.reticleEl.innerHTML = '<i class="c"></i><i class="t n"></i><i class="t s"></i><i class="t e"></i><i class="t w"></i><i class="b tl"></i><i class="b tr"></i><i class="b bl"></i><i class="b br"></i>';
    document.body.appendChild(this.reticleEl);
    this.el('bWeapon').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.toggleWheel(); });
    this.buildWheel();
    I.bindButton(this.el('bUse'), 'use'); I.bindButton(this.el('bRun'), 'run', true); I.bindButton(this.el('bHorn'), 'horn', true);
    I.bindButton(this.el('bBeam'),'beam'); I.bindButton(this.el('bHand'), 'brake', true); I.bindPedals(this.el('pGas'), this.el('pBrake')); I.bindArrows(this.el('sLeft'), this.el('sRight'));
    I.bindButton(this.el('bSwap'), 'swap'); I.bindButton(this.el('bCam'), 'camera'); I.bindButton(this.el('bMap'), 'map'); I.bindButton(this.el('bDev'), 'dev');
    this.el('mClose').onclick = () => this.toggleMap(false);
    this.el('mMe').onclick = () => { const me = G.brothers.me; this.mapView.x = me.x; this.mapView.z = me.z; this.mapView.s = 1.2; };
    this.mapView = { x: 0, z: 0, s: 0.25 };
    this.nav = new Navigation(G.net);
    const homes = new Set(['nice','trap','terrace','semi','detached','bungalow','cottage']);
    const sites = predicate => (G.interiors?.sites || []).filter(predicate);
    const categories = {
      Houses: () => sites(s => homes.has(s.kind) || s.brothersHome), 'Brothers’ home': () => sites(s => s.brothersHome), Shops: () => sites(s => s.kind==='shop' || s.kind==='mall'),
      Food: () => sites(s => s.kind==='food'), Pubs: () => sites(s => s.kind==='pub'),
      'Petrol stations': () => G.fuel?.stations || [], Stations: () => G.transit.stations.map(s => ({...s,name:s.name+' station'})),
      Buildings: () => sites(s => !homes.has(s.kind) && !['shop','mall','food','pub'].includes(s.kind)),
      Districts: () => G.manifest.districts, Landmarks: () => TESTSPOTS.slice(0,4).map(([name,x,z])=>({name,x,z}))
    };
    let results=[], index=0, category='Houses';
    const showPlace = () => {
      const p=this.mapPlace=results[index];
      this.el('mName').textContent=p?.name || 'No locations available';
      this.el('mDistance').textContent=p ? [index+1+' / '+results.length, distanceLabel(p.distance)+' away', p.district].filter(Boolean).join(' · ') : category;
      this.el('mGo').disabled=!p;
      this.el('mPrev').disabled=this.el('mNext').disabled=results.length<2;
      if(p) Object.assign(this.mapView,{x:p.x,z:p.z,s:Math.max(0.55,this.mapView.s)});
    };
    this.selectPlaces = (key=category) => {
      category=key; index=0;
      const me=G.brothers.me;
      results=categories[key]().map(s=>{
        const x=s.dx??s.x, z=s.dz??s.z;
        return {x,z,name:s.title||s.name,district:s.district,distance:Math.hypot(x-me.x,z-me.z)};
      }).filter(s=>Number.isFinite(s.distance)).sort((a,b)=>a.distance-b.distance);
      for(const button of this.el('mKinds').children) button.setAttribute('aria-pressed',String(button.textContent===key));
      showPlace();
    };
    for(const key of Object.keys(categories)){
      const button=document.createElement('button'); button.textContent=key;
      button.onclick=()=>{this.selectPlaces(key);this.el('mGo').focus({preventScroll:true});}; this.el('mKinds').append(button);
    }
    const cycle=step=>{if(results.length){index=(index+step+results.length)%results.length;showPlace();}};
    this.el('mPrev').onclick=()=>cycle(-1); this.el('mNext').onclick=()=>cycle(1);
    this.el('map').addEventListener('keydown', e=>{
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation(); cycle(e.key === 'ArrowLeft' ? -1 : 1);
    });
    this.el('mGo').onclick=()=>{if(this.mapPlace)this.nav.set({...this.mapPlace});};
    G.events?.on('interiors',()=>{if(!this.el('map').hidden)this.selectPlaces();});
    this.el('mClear').onclick=()=>this.nav.set(null);
    this.el('mOut').onclick=()=>this.zoomMap(.65);
    this.el('mIn').onclick=()=>this.zoomMap(1.5);
    this.el('miniC').onclick=()=>this.toggleMap(true);
    this.el('mFit').onclick=()=>{
      const points=[G.brothers.me,this.nav.pin,...(this.nav.route?.pts || [])].filter(Boolean);
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const p of points){left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.z);bottom=Math.max(bottom,p.z);}
      this.mapView={x:(left+right)/2,z:(top+bottom)/2,s:Math.max(.025,Math.min(2,(innerWidth-64)/Math.max(1,right-left),(innerHeight-160)/Math.max(1,bottom-top)))};
    };
    this.setupMap();
    this.atlas = new MapView(G);   // draws the Road Atlas and the minimap (mapView.js)
    this.menu=new GameMenu(this);
    this.overview = new Map();
    this.feedItems = [];
    this.perfOn = G.Q.has('perf');
    this.el('perf').hidden = !this.perfOn;
  }
  toast(t, secs = 3) { const panel = this.el('dev'); if (!panel.hidden && panel.querySelector('output')) panel.querySelector('output').textContent = t; const e = this.el('toast'); e.textContent = t; e.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => e.hidden = true, secs * 1000); }
  banner(t, kind, secs) { const e = this.el('banner'); e.textContent = t; e.className = kind || ''; e.hidden = false; clearTimeout(this._bt); if (secs || kind === 'clear') this._bt = setTimeout(() => e.hidden = true, (secs || 4) * 1000); }
  feed(t) { this.feedItems.unshift({ t, at: performance.now() }); this.feedItems = this.feedItems.slice(0, 4); this.renderFeed(); }
  renderFeed() { const now = performance.now(); this.feedItems = this.feedItems.filter(f => now - f.at < 14000); this.el('feed').innerHTML = this.feedItems.map(f => `<div>${esc(f.t)}</div>`).join(''); }
  fade(text) { const f = this.el('fade'); f.textContent = text || ''; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  // ------------------------------------------------------------------ per frame
  // ---------------------------------------------------------------- weapon wheel (combat.js)
  buildWheel() {
    const ring = this.el('wheel').querySelector('.ring'), G = this.G;
    {
      const items = [{ key: null, name: 'Fists', icon: 'fist' }, ...WEAPONS];
      ring.innerHTML = items.map((w, k) => {
        const a = (k / items.length) * Math.PI * 2 - Math.PI / 2, r = 41;
        return `<button data-k="${w.key ?? ''}" style="left:${50 + Math.cos(a) * r}%;top:${50 + Math.sin(a) * r}%">${ICON[w.icon] || ICON.gun}<b>${w.name}</b><em>${k}</em></button>`;
      }).join('');
      ring.querySelectorAll('button').forEach(b => {
        b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); G.combat?.select(b.dataset.k || null); this.toggleWheel(false); });
        b.addEventListener('pointerenter', () => { this.el('wheel').querySelector('.wName').textContent = b.querySelector('b').textContent; });
      });
    }
    this.el('wheel').addEventListener('pointerdown', e => { if (e.target.id === 'wheel') this.toggleWheel(false); });
  }
  toggleWheel(open = this.el('wheel').hidden) {
    const el = this.el('wheel'); if (this.G.brothers.me.vehicle) open = false;
    el.hidden = !open; this.wheelOpen = open;
    if (open) { const k = this.G.brothers.me.weapon || ''; el.querySelectorAll('.ring button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); el.querySelector('.wName').textContent = this.G.combat?.status()?.name || 'Fists'; }
  }
  weaponChanged() {
    const st = this.G.combat?.status(), hit = this.el('bHit');
    hit.innerHTML = st && !st.melee ? `${ICON.gun}<b>Fire</b>` : st ? `${ICON.knife}<b>Slash</b>` : `${ICON.fist}<b>Hit</b>`;
    hit.classList.toggle('fire', !!st && !st.melee);
    this.el('bAim').hidden = !(st && !st.melee) || this.G.brothers.me.vehicle;
    this.el('bWeapon').innerHTML = `${st ? ICON[BY_KEY[st.key].icon] || ICON.gun : ICON.gun}<b>${st ? st.name.split(' ').pop() : 'Weapons'}</b>`;
    this._ammo = null; this.updateAmmo();
    if (st) this.toast(st.name + (st.melee ? '' : ' · unlimited ammo'), 1.5);
    // the first gun out since aiming changed (v0.38): how it works now, once
    if (st && !st.melee) {
      let seen = true; try { seen = !!localStorage.getItem('greenCounty.freeAimTip'); localStorage.setItem('greenCounty.freeAimTip', '1'); } catch { /* storage blocked */ }
      if (!seen) setTimeout(() => this.toast(this.G.aimAssist ? 'Lock-on aiming: hold Aim to lock on to someone · Settings → Aiming for free aim'
        : this.G.padActive ? 'Free aim: hold L2, put the crosshair on them with the right stick, R2 to fire · lock-on is in Settings → Aiming'
        : 'Free aim: tap or hold Aim, drag to put the crosshair on them, then Fire · lock-on is in Settings → Aiming', 6), 1600);
    }
  }
  updateAmmo() {
    const st = this.G.combat?.status(), el = this.el('ammo');
    const t = st ? (st.melee ? st.name : st.reloading ? 'Reloading…' : `${st.mag} / ∞`) : '';
    if (t === this._ammo) return; this._ammo = t;
    el.hidden = !t; el.textContent = t; el.classList.toggle('empty', !!st && !st.melee && st.mag === 0);
  }
  // where the reticle goes this frame. Free aim: the middle of the view, red while it's over someone. Lock-on
  // aiming: on the locked person (brackets), on whoever the crosshair has snapped to (red), or the middle (white)
  updateReticle() {
    const G = this.G, C = G.combat, el = this.reticleEl; if (!C || !el) return;
    const i = G.brothers.active, s = C.s[i], w = C.weapon(i), me = G.brothers.me;
    const gun = !!w && !w.melee && !me.vehicle && !this.wheelOpen, aiming = gun && C.aiming(i);
    const R = gun && C.reticle(i);
    // the Aim button stays lit while a tapped aim is on (input.js bindAim)
    const ab = this.el('bAim'), lit = !!(G.input.aimLatch || G.input.held.has('aim')); if (ab && ab.classList.contains('on') !== lit) ab.classList.toggle('on', lit);
    // whenever the gun is up (Aim held, or firing): the crosshair where the rounds go (combat.js aim())
    const show = aiming || (gun && s.aim > 0.2);
    let x = innerWidth / 2, y = innerHeight / 2, cls = 'free';
    if (R?.center) cls = R.on ? 'on' : 'free';
    else if (R) {
      const v = (this._rv ||= new G.THREE.Vector3()).set(R.x, R.y, R.z).project(G.camera);
      if (v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2) { x = (v.x + 1) / 2 * innerWidth; y = (1 - v.y) / 2 * innerHeight; cls = R.lock ? 'lock' + (R.head ? ' head' : '') : 'on'; }
    }
    el.hidden = !show;
    if (!show) { this.el('bNext').hidden = true; return; }
    if (el.className !== cls) el.className = cls;
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    this.el('bNext').hidden = !s.lock;
  }
  // wanted stars (flashing while they search), health, the red edge when you're hit (wanted.js)
  updateLaw() {
    const W = this.G.wanted, me = this.G.brothers.me; if (!W) return;
    const lv = W.level, key = lv + W.phase;
    if (key !== this._lawKey) { this._lawKey = key; const st = this.el('stars'); st.innerHTML = lv ? '<b>★</b>'.repeat(lv) + '<s>★</s>'.repeat(5 - lv) : ''; st.classList.toggle('flash', W.phase === 'search'); }
    const hp = Math.round(me.hp ?? 100);
    if (hp !== this._hp) { this._hp = hp; const b = this.el('hpBar'); b.firstChild.style.width = hp + '%'; b.classList.toggle('low', hp < 30); }
    const o = W.hitFlash.toFixed(2), hurt = this.el('hurt'); if (hurt._o !== o) { hurt._o = o; hurt.style.opacity = o; }
  }
  bigText(t, cls) { const e = this.el('bigText'); e.textContent = t; e.className = cls || ''; e.hidden = false; clearTimeout(this._bigT); this._bigT = setTimeout(() => { e.hidden = true; }, 4200); }
  update(dt) {
    this.updateReticle();
    this.updateLaw();
    if (!this.el('btns').querySelector('.foot').hidden) this.updateAmmo();
    const G = this.G, me = G.brothers.me, I = G.input;
    if (I.consume('map')) this.toggleMap();
    if (I.consume('dev')) this.toggleDev();
    if (!this.el('dev').hidden && performance.now() >= (this.nextDevUpdate || 0)) { this.refreshDev(); this.nextDevUpdate = performance.now() + 1000; }
    const inCar = !!me.vehicle;
    const near = !inCar && G.brothers.nearestVehicle();
    const door=!inCar&&!G.transit.ride?G.interiors?.prompt:null;   // a building's front door (interiors.js)
    const boardable=!door&&!me.inside&&G.transit.nearby(me);
    const waiting=!inCar && !near && !boardable && !door && !me.inside && !G.transit.ride && (G.transit.platform(me)?'Awaiting train':G.transit.busStop(me)?'Awaiting bus':'');
    const giveUp=!inCar&&!near&&!!G.wanted?.canGiveUp();
    const useText=giveUp?'Give up':G.transit.ride?(G.transit.currentStop()?'Alight':'Request stop'):door&&!near?door.text:boardable?'Board':waiting||(inCar?'Exit':near?.owner?'Get in ('+near.owner+"'s)":near?'Get in':me.inside?'Indoors':'Get in');
    const use=this.el('bUse');
    if(use.lastChild.textContent!==useText){use.lastChild.textContent=useText;use.firstChild.innerHTML=inCar||G.transit.ride&&G.transit.currentStop()?ICON.exit:boardable||G.transit.ride?ICON.bus:ICON.door;}
    use.disabled=!!waiting;
    const ready=giveUp||inCar||near||G.transit.ride||boardable||door;
    use.classList.toggle('dim',!ready); use.classList.toggle('ready',!!(near||boardable||door)&&!inCar);
    // on foot: stick and actions; driving: wheel (or arrows) and pedals; riding a bus or train: just the stop button
    const ride=!!G.transit.ride, drive=inCar&&!ride, steer=this.menu?.settings?.steering||'Steering wheel';
    I.driving=drive; I.steering=steer;
    // handling: Easy (traction and stability control, ABS, steering assist; the default) or Realistic (carPhysics.js)
    I.assists=/^Realistic/.test(this.menu?.settings?.handling||'')?0:1;
    this.el('btns').querySelector('.foot').classList.toggle('driving',drive||ride);
    this.el('btns').querySelector('.drive').hidden=!drive;
    this.el('btns').querySelector('.arrows').hidden=!(drive&&steer==='Buttons');
    I.wheelEl.hidden=!(drive&&steer==='Steering wheel');
    I.rest.hidden=drive||ride;
    for(const id of ['bJump','bHit','bPickup','bRun','bWeapon'])this.el(id).hidden=drive||ride;
    { const st = this.G.combat?.status(); this.el('bAim').hidden = drive || ride || !(st && !st.melee); }
    if(drive||ride)this.el('ammo').hidden=true; else this.updateAmmo();
    this.el('bSwap').hidden=ride;
    if(drive!==this._wasDriving){this._wasDriving=drive;if(drive&&steer==='Tilt')I.calibrateTilt();}
    if(drive){
      const v=G.traffic.byId.get(me.vehicle),c=I.driveControls(0);
      const beam=this.el('bBeam'); beam.setAttribute('aria-pressed',String(!!v?.fullBeam)); beam.classList.toggle('activeBeam',!!v?.fullBeam);
      const mph=Math.round(Math.abs(v?.sp||0)*2.237),sp=this.el('speedo');sp.hidden=false;
      if(sp.firstChild.textContent!==String(mph))sp.firstChild.textContent=mph;
      sp.querySelector('i').textContent=v?.ph?.gear<0?'R':v?.ph?(Math.abs(v.sp)<0.3&&!c.gas?'N':String(v.ph.gear)):'';
      I.wheelEl.style.setProperty('--steer',(c.steer*110).toFixed(1)+'deg');
      this.el('pBrake').classList.toggle('rev',!!(v?.ph?.gear<0&&c.brake>0));
    } else this.el('speedo').hidden=true;
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.1) { this._acc = 0; const notice=this.nav.update(me); if(notice) this.toast(notice); this.miniText(); this.renderFeed(); this.drawClock(); }
    // the maps draw every frame (the minimap turns smoothly; the atlas redraws only when its view or contents change)
    if (!this.el('map').hidden) this.drawMap(); else this.drawMini();
    if(G.transit.ride){this.el('guidance').hidden=false;this.el('guidance').firstChild.textContent=G.transit.ride===G.transit?'RAIL':'BUS '+G.transit.ride.ref;this.el('guidance').lastChild.textContent='Next: '+G.transit.nextName()+(G.transit.request?' · Stop requested':'');}
    if (this.perfOn) this.el('perf').textContent = G.perf.text();
  }
  drawClock() {
    const G = this.G, h = G.world.hours();
    const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const st = G.world.stateName();
    const label = { clear: 'Clear', broken: 'Broken cloud', overcast: 'Overcast', drizzle: 'Drizzle', rain: 'Heavy rain', mist: 'Mist', clearing: 'Clearing' }[st] || st;
    const me = G.brothers.me;
    this.el('clock').textContent = `${me.short} · ${hh}:${mm} · ${label}${G.world.s.wet > 0.05 ? ` · roads ${G.world.s.wet > 0.6 ? 'wet' : 'damp'}` : ''}`;
  }
  drawMini() {
    const G = this.G, me = G.brothers.me, cv = this.el('miniC');
    const S = cv.clientWidth || 150, dpr = Math.min(3, devicePixelRatio || 1), dev = Math.round(S * dpr);
    if (cv.width !== dev) { cv.width = cv.height = dev; }
    // (the zoom was tuned for a 220 px disc: keep the same reach at any size)
    const scale = (me.vehicle ? Math.max(.35, .92 - (G.brothers.speedNow || 0) * .018) : 1.6) * S / 220; // px per metre
    const rot = this.menu.settings.orientation === 'North up' ? 0 : me.vehicle ? -me.heading-Math.PI/2 : -(G.brothers.cam.yaw + Math.PI / 2) - Math.PI; // map rotates with camera
    const c = this.mini, R = S / 2;
    this.atlas.minimap(c, S, dpr, me, scale, rot, c => {
      this.nav.draw(c, x => x, z => z, 1 / scale);
      if (G.interiors?.ready) { const reach = (S / 2) / scale; for (const site of G.interiors.sites) { if (site.kiosk || Math.abs(site.dx - me.x) > reach || Math.abs(site.dz - me.z) > reach) continue; siteDot(c, site.dx, site.dz, site.kind, 1 / scale); } }
      if (G.fuel?.ready) { const reach = (S / 2) / scale; for (const st of G.fuel.stations) { if (Math.abs(st.x - me.x) > reach || Math.abs(st.z - me.z) > reach) continue; siteDot(c, st.x, st.z, 'fuel', 1 / scale); } }
      const W = G.wanted;
      if (W?.level && W.phase === 'search') {
        const f = Math.floor(performance.now() / 320) % 2; c.beginPath(); c.arc(W.last.x, W.last.z, W.searchR(), 0, 7);
        c.fillStyle = f ? 'rgba(255,45,45,0.14)' : 'rgba(45,95,255,0.14)'; c.fill(); c.lineWidth = 2 / scale; c.strokeStyle = f ? '#ff5050' : '#5080ff'; c.stroke();
      }
      const reach = R / scale;
      for (const v of G.traffic.list) {
        if (Math.abs(v.x - me.x) > reach || Math.abs(v.z - me.z) > reach) continue;
        if (v.kind === 'police') dot(c, v.x, v.z, 4.5 / scale, v.siren ? (Math.floor(performance.now() / 250) % 2 ? '#2a6cff' : '#ff2a2a') : '#3a7aff', '#0b1220', 1.2 / scale);
        else if (v.owner || v.free) dot(c, v.x, v.z, 4 / scale, '#7fd0ff', '#0b1220', 1.2 / scale);
        else if (v.kind === 'bus') dot(c, v.x, v.z, 3.5 / scale, '#c080ff', '#0b1220', 1 / scale);
      }
    });
    // screen space: the other brother (held at the rim when out of range), the needle, north
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const other = G.brothers.b[1 - G.brothers.active];
    const cs = Math.cos(rot), sn = Math.sin(rot), ox0 = (other.x - me.x) * scale, oz0 = (other.z - me.z) * scale;
    let ox = ox0 * cs - oz0 * sn, oz = ox0 * sn + oz0 * cs;
    const lim = R - 10, ol = Math.hypot(ox, oz); if (ol > lim) { ox *= lim / ol; oz *= lim / ol; }
    dot(c, R + ox, R + oz, 6.5, '#ffb347', '#1a1208', 1.6);
    c.fillStyle = '#1a1208'; c.font = '800 8.5px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(other.short[0], R + ox, R + oz + 0.5);
    c.save(); c.translate(R, R);
    c.fillStyle = 'rgba(47,140,255,0.25)'; c.beginPath(); c.arc(0, 0, 13, 0, 7); c.fill();
    c.rotate(me.heading + rot);
    c.beginPath(); c.moveTo(11, 0); c.lineTo(-7.5, -7.5); c.lineTo(-3.5, 0); c.lineTo(-7.5, 7.5); c.closePath();
    c.lineJoin = 'round'; c.lineWidth = 4.5; c.strokeStyle = 'rgba(8,14,22,0.55)'; c.stroke();
    c.lineWidth = 2.4; c.strokeStyle = '#ffffff'; c.stroke(); c.fillStyle = '#2f8cff'; c.fill();
    c.restore();
    const nx = R + Math.cos(rot - Math.PI / 2) * (R - 10), nz = R + Math.sin(rot - Math.PI / 2) * (R - 10);
    dot(c, nx, nz, 7.5, '#14211d', '#e8f3ec', 1.2);
    c.fillStyle = '#ff6b5a'; c.font = '800 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', nx, nz + 0.5);
  }
  // the guidance panel and the road you're on (ten times a second)
  miniText() {
    const G = this.G, me = G.brothers.me;
    const guide=this.el('guidance');
    guide.hidden=!this.nav.pin;
    if(this.nav.pin){
      guide.firstChild.textContent=(me.vehicle?'SAT NAV':'ON FOOT')+(this.nav.route?'   ·   '+distanceLabel(this.nav.route.length-this.nav.progress):'');
      guide.lastChild.textContent=this.nav.instruction();
    }
    // road name + heading
    const brg = ((Math.atan2(Math.cos(me.heading), -Math.sin(me.heading)) * 180 / Math.PI) + 360) % 360;
    const hdg = DIRS[Math.round(brg / 45) % 8];
    const name = G.roadName(me.x, me.z);
    this.el('road').textContent = `${name || G.districtName(me.x, me.z)} · ${hdg}`;
  }
  // ------------------------------------------------------------------ full map
  zoomMap(factor) { this.mapView.s=Math.max(.025,Math.min(3,this.mapView.s*factor)); }
  setupMap() {
    const cv=this.el('mapC'), pointers=new Map();
    let tap=null;
    cv.onpointerdown=e=>{
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId,[e.clientX,e.clientY]);
      tap=pointers.size===1 ? [e.clientX,e.clientY] : null;
    };
    cv.onpointermove=e=>{
      const prev=pointers.get(e.pointerId); if(!prev)return;
      const x=e.clientX,z=e.clientY,v=this.mapView;
      if(tap && Math.hypot(x-tap[0],z-tap[1])>6)tap=null;
      if(pointers.size===2){
        const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)[1];
        const d=Math.hypot(prev[0]-other[0],prev[1]-other[1]);
        if(d>1)this.zoomMap(Math.hypot(x-other[0],z-other[1])/d);
      } else if(!tap){v.x-=(x-prev[0])/v.s; v.z-=(z-prev[1])/v.s;}
      pointers.set(e.pointerId,[x,z]);
    };
    cv.onpointerup=e=>{
      if(tap && pointers.size===1){
        const rect=cv.getBoundingClientRect(), v=this.mapView;
        const x=v.x+(e.clientX-rect.left-rect.width/2)/v.s,z=v.z+(e.clientY-rect.top-rect.height/2)/v.s;
        this.nav.set({x,z,name:this.G.roadName(x,z)||this.G.districtName(x,z)||'Dropped pin'});
      }
      tap=null; pointers.delete(e.pointerId);
    };
    cv.onpointercancel=e=>{tap=null;pointers.delete(e.pointerId);};
    cv.onwheel=e=>{e.preventDefault();this.zoomMap(e.deltaY<0?1.15:.87);};
  }
  toggleMap(on) {
    const m = this.el('map'); on = on ?? m.hidden; m.hidden = !on;
    if (on) { const me = this.G.brothers.me; this.mapView = { x: me.x, z: me.z, s: 0.35 }; this.selectPlaces(); this.el('mKinds').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true}); }
  }
  ovTile(i, j) {
    const k = i + '_' + j; if (this.overview.has(k)) return this.overview.get(k);
    const img = new Image(); img.src = `world/overview/${k}.png`; this.overview.set(k, img); return img;
  }
  drawMap(force = false) {
    const G = this.G, cv = this.el('mapC'), dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); force = true; }
    // redrawn when the view or what's on it changes, and four times a second for the moving markers
    const V = this.mapView, nav = this.nav, now = performance.now();
    const sig = `${V.x.toFixed(1)},${V.z.toFixed(1)},${V.s.toFixed(4)},${this.atlas.data.version},${nav.pin ? nav.pin.x + ',' + (nav.progress | 0) : ''}`;
    if (!force && !this.atlas.pending && sig === this._mapSig && now - (this._mapT || 0) < 250) return;
    this._mapSig = sig; this._mapT = now;
    const c = cv.getContext('2d');
    // names keep clear of the controls and of the brothers' markers
    const avoid = [];
    for (const q of this.el('map').querySelectorAll('.maptools,.atlasPlaces,.atlasFooter,.mapDirectory')) { const r = q.getBoundingClientRect(); if (r.width) avoid.push([r.x + r.width / 2, r.y + r.height / 2, r.width + 8, r.height + 8]); }
    for (const b of G.brothers.b) avoid.push([(b.x - V.x) * V.s + W / 2, (b.z - V.z) * V.s + H / 2 - 8, 64, 58]);
    // and of the buildings you can go into (their marker, and the name beside the main ones)
    if (G.interiors?.ready) for (const site of G.interiors.sites) {
      const x = (site.dx - V.x) * V.s + W / 2, z = (site.dz - V.z) * V.s + H / 2; if (x < -200 || x > W + 200 || z < -60 || z > H + 60) continue;
      const key = site.kind === 'trap' || site.kind === 'nice' || site.kind === 'mall';
      avoid.push([x, z, 22, 22]);
      if (site === G.interiors.sites[0] && G.fuel?.ready) for (const st of G.fuel.stations) { const fx = (st.x - V.x) * V.s + W / 2, fz = (st.z - V.z) * V.s + H / 2; avoid.push([fx, fz, 22, 22]); if (V.s >= 0.12) avoid.push([fx + 13 + st.title.length * 3.3, fz, st.title.length * 6.6 + 6, 18]); }
      if (V.s >= 0.22 || (key && V.s >= 0.04)) { const w = site.title.length * (key ? 7.4 : 6.6); avoid.push([x + 13 + w / 2, z, w + 6, 18]); }
    }
    this.atlas.atlas(c, V, W, H, {
      dpr, avoid, ovTile: (i, j) => this.ovTile(i, j),
      over: (c, X, Z, s) => {
        nav.draw(c, X, Z);
        if (G.fuel?.ready) for (const st of G.fuel.stations) {
          const x = X(st.x), z = Z(st.z); if (x < -30 || x > W + 30 || z < -30 || z > H + 30) continue;
          siteIcon(c, x, z, 'fuel', s < 0.05 ? 6 : 8.5);
          if (s >= 0.12 && z > 70 && z < H - 82) { c.font = '700 11px system-ui'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3.5; c.strokeText(st.title, x + 13, z); c.fillStyle = '#1d2420'; c.fillText(st.title, x + 13, z); }
        }
        if (G.interiors?.ready) for (const site of G.interiors.sites) {
          if (site.kiosk) continue;   // a petrol station's shop: the station's pump marker stands for it
          const x = X(site.dx), z = Z(site.dz); if (x < -30 || x > W + 30 || z < -30 || z > H + 30) continue;
          const key = site.kind === 'trap' || site.kind === 'nice' || site.kind === 'mall';
          siteIcon(c, x, z, site.kind, s < 0.05 && !key ? 5.5 : key ? 10 : 8);
          if ((s >= 0.22 || (key && s >= 0.04)) && z > 70 && z < H - 82) { c.font = `${key ? 800 : 700} ${key ? 12 : 11}px system-ui`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3.5; const t = key && s < 0.22 ? site.title.replace(/, .*/, '') : site.title; c.strokeText(t, x + 13, z); c.fillStyle = '#1d2420'; c.fillText(t, x + 13, z); }
        }
        if(this.mapPlace){
          c.save(); c.beginPath(); c.arc(X(this.mapPlace.x),Z(this.mapPlace.z),15,0,Math.PI*2);
          c.strokeStyle='#162d29'; c.lineWidth=5; c.stroke(); c.strokeStyle='#f5d772'; c.lineWidth=3; c.stroke(); c.restore();
        }
        // the brothers' cars and the police
        for (const v of G.traffic.list) {
          const x = X(v.x), z = Z(v.z); if (x < -10 || x > W + 10 || z < -10 || z > H + 10) continue;
          if (v.owner || v.free) { c.save(); c.translate(x, z); c.rotate(v.heading); c.fillStyle = '#2b8fe8'; c.strokeStyle = '#ffffff'; c.lineWidth = 1.6; c.beginPath(); c.roundRect ? c.roundRect(-7, -4, 14, 8, 2.5) : c.rect(-7, -4, 14, 8); c.fill(); c.stroke(); c.fillStyle = '#bfe3ff'; c.fillRect(1.5, -3, 3, 6); c.restore(); }
          else if (v.kind === 'police') dot(c, x, z, s < 0.1 ? 3.2 : 4.5, v.siren ? (Math.floor(now / 250) % 2 ? '#2a6cff' : '#ff2a2a') : '#2a4cff', '#ffffff', s < 0.1 ? 1 : 1.4);
        }
        // the brothers: you as a needle, the other as a ringed initial
        G.brothers.b.forEach((b, i) => {
          const x = X(b.x), z = Z(b.z), me = i === G.brothers.active;
          if (me) {
            c.save(); c.translate(x, z);
            c.fillStyle = 'rgba(47,113,212,0.18)'; c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill();
            c.rotate(b.heading); c.beginPath(); c.moveTo(13, 0); c.lineTo(-9, -9); c.lineTo(-4.5, 0); c.lineTo(-9, 9); c.closePath();
            c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = '#ffffff'; c.stroke(); c.fillStyle = '#2f71d4'; c.fill();
            c.restore();
          } else { dot(c, x, z, 9, '#ffb347', '#ffffff', 2.2); c.fillStyle = '#2a1a05'; c.font = '800 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.short[0], x, z + 0.5); }
          c.font = '800 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
          c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3.5; c.strokeText(b.short, x, z - 22); c.fillStyle = '#16211c'; c.fillText(b.short, x, z - 22);
        });
      },
    });
    this.el('mInfo').textContent=nav.pin ? nav.pin.name+' · '+(nav.route ? distanceLabel(nav.route.length-nav.progress)+' remaining' : nav.instruction()) : 'Tap a street to set a waypoint · drag to explore · pinch to zoom';
    this.el('mClear').hidden=this.el('mFit').hidden=!nav.pin;
  }
  // ------------------------------------------------------------------ developer panel
  toggleDev() {
    const d = this.el('dev');
    d.hidden = !d.hidden;
    if (d.hidden) { this.el('bDev').focus({preventScroll:true}); return; }
    if (d.childElementCount) { this.refreshDev(); this.el('devJump').focus(); return; }
    const G = this.G, w = G.world;
    d.innerHTML = `<header><h3 id="devTitle">Developer console</h3><button id="devX" aria-label="Close developer console">Close</button></header>
      <select id="devJump" aria-label="Jump to section"><option value="">Jump to section…</option></select>
      <div class="devScroll"></div><output aria-live="polite">Ready</output>`;
    const jump = this.el('devJump'), body = d.querySelector('.devScroll'), status = d.querySelector('output');
    this.el('devX').onclick = () => this.toggleDev();
    d.onkeydown = e => {
      if (['Escape','KeyP','Backquote'].includes(e.code)) { e.preventDefault(); if (!e.repeat) this.toggleDev(); }
      if (e.key === 'Tab') {
        const items = d.querySelectorAll('button,select'), first = items[0], last = items[items.length-1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      e.stopPropagation();
    };
    let group;
    const section = title => {
      group = document.createElement('section');
      const heading = document.createElement('h4'); heading.textContent = title; heading.tabIndex = -1;
      group.append(heading); body.append(group); jump.add(new Option(title, String(body.children.length-1)));
    };
    jump.onchange = () => {
      if (jump.value === '') return;
      const selected = body.children[Number(jump.value)], heading = selected.firstChild;
      (selected.querySelector('button') || heading).focus({preventScroll:true}); heading.scrollIntoView({block:'start'}); jump.value = '';
    };
    const dynamic = [];
    const btn = (label, fn, act) => {
      const b = document.createElement('button');
      if (typeof label === 'function') { const update = () => { b.textContent = label(); }; dynamic.push(update); update(); }
      else b.textContent = label;
      b.dataset.act = act || slug(b.textContent);
      b.onclick = () => { status.textContent = b.textContent; fn(); this.refreshDev(); };
      return b;
    };
    const row = (title, items) => {
      const r = document.createElement('div'), label = document.createElement('b');
      r.className = 'row'; label.textContent = title; r.append(label,...items); group.append(r);
    };
    section('Live diagnostics');
    const readout = document.createElement('p'); group.append(readout);
    this.refreshDev = () => {
      const me = G.brothers.me, animals = G.wildlife.sim.list;
      readout.textContent = [
        G.backend + ' · ' + G.quality + ' quality · ' + (G.perf.samples.at(-1)?.fps?.toFixed(1) ?? '…') + ' FPS',
        me.short + ' · ' + (G.traffic.byId.get(me.vehicle)?.model || 'on foot') + ' · X ' + Math.round(me.x) + ' / Z ' + Math.round(me.z),
        G.traffic.list.length + ' vehicles · ' + G.peds.list.length + ' pedestrians · ' + animals.length + ' animals',
        'Weather ' + w.stateName() + ' · seed ' + w.s.seed + ' · police ' + G.police.player.state
      ].join('\n');
      for (const update of dynamic) update();
    };
    section('Graphics');
    const TARGET = { low: ' · 720p 120', medium: ' · 1080p 60', high: ' · 4K 30' };
    row('Preset · saves and restarts the renderer',presets.map(q => btn(
      () => q[0].toUpperCase()+q.slice(1)+(TARGET[q] || '')+(G.choice===q ? ' ✓' : ''),
      () => { if (G.choice!==q) G.setQuality(q); },'quality-'+q)));
    const metrics = document.createElement('p'); group.append(metrics);
    dynamic.push(() => {
      const scale = G.post?.fsr ? G.post.scale : 1, sample = G.perf.samples.at(-1);
      metrics.textContent = [
        G.quality+' · '+G.backend+' · '+(G.device.chip || 'Chipset unavailable'),
        'Android Game Mode: '+G.device.mode+' · target '+G._fps+' FPS',
        (sample?.fps ?? '…')+' FPS · p95 '+(sample?.p95 ?? '…')+' ms',
        'Scene '+Math.round(innerWidth*G.renderer.getPixelRatio()*scale)+' × '+Math.round(innerHeight*G.renderer.getPixelRatio()*scale)
      ].join('\n');
    });
    section('Characters & animation');
    const rigs = G.people.rigs;
    row('Character preview', ['cal', 'leon', 'off'].map(role => btn(role, () => { rigs.previewRole = role === 'off' ? null : role; if (ROLES[role]?.hero) rigs.previewClip = ROLES[role].idle; }, 'preview-' + role)));
    for (const hero of ['cal', 'leon']) row(hero === 'cal' ? 'Cal' : 'Leon', ROLES[hero].clips.map(clip => btn(clip.replace(/_0?(\d)$/, ' $1').replace(/_/g, ' '), () => { rigs.previewRole = hero; rigs.previewClip = clip; }, hero + '-' + clip)));
    section('Vehicles & fuel');
    const fuel = amount => {
      const v = G.brothers.vehicleOf(G.brothers.me);
      if (!v) return this.toast('Enter a vehicle to test fuel');
      if (!G.fuel.hasTank(v)) return this.toast('This vehicle uses no stored energy');
      v.fuel = amount; G.save.markVehicle(v); this.toast((isElectric(v.model)?'Charge':'Fuel')+' set to '+Math.round(amount*100)+'%');
    };
    row('Money & fuel', [btn('Add £500', () => { const b = G.brothers.me; b.cash = (b.cash ?? 1500) + 500; this.toast(`${b.short} has £${b.cash.toFixed(2)}`); }), btn('Fill this car', () => fuel(1)), btn('Empty this car', () => fuel(.02))]);
    const vehicles = {bicycle:'Push bike',ebike:'Electric bike',evsaloon:'Electric fastback',evsuv:'Electric crossover',dirtbike:'Dirt bike', motorcycle:'Motorcycle', moped:'Moped', escooter:'E-scooter', rangerover:'Range Rover', sports:'Sports car', hatch:'Hatchback', saloon:'Saloon', estate:'Estate', suv:'SUV', coupe:'Coupé', hothatch:'Hot hatch', van:'Van', ambulance:'Ambulance', police:'Police car', fire:'Fire engine'};
    row('Spawn nearby', Object.entries(vehicles).map(([model,label]) => btn(label, () => {
      const me = G.brothers.me, h = me.heading || 0;
      if (me.inside || G.transit.ride) return this.toast('Go outside and leave public transport first');
      for (const offset of [7,-7,13,-13]) {
        const x = me.x + Math.cos(h)*offset, z = me.z + Math.sin(h)*offset;
        const y = G.tiles.ground(x,z,me.y+1);
        if (y == null || G.tiles.insideBuilding(x,z,y) || G.traffic.list.some(v => Math.hypot(v.x-x,v.z-z) < (v.len+5)/2)) continue;
        G.traffic.add({id:'dev-'+model+'-'+Date.now(),kind:'parked',model,paint:({rangerover:0x23382c,ambulance:0xe9ee77,police:0xe8e8e4})[model]??0xb5121b,x,y,z,heading:h,parked:true,free:true});
        return this.toast(label+' delivered');
      }
      this.toast('No clear space nearby. Move to an open road.');
    }, 'spawn-'+model)));
    row('Vehicle', [btn('Repair', () => { const v = G.traffic.byId.get(G.brothers.me.vehicle) || G.brothers.nearestVehicle(8); if (v) { v.dmg = [0, 0, 0, 0]; G.save.markVehicle(v); this.toast('Repaired'); } else this.toast('No vehicle nearby'); }, 'repair')]);
    section('Weather & time');
    row('Time', [6, 8, 12, 16, 18.5, 21, 0].map(h => btn(String(h).replace('.5', ':30'), () => w.setHour(h), 'time-' + h)));
    row('Speed', [1, 30, 120, 600].map(s => btn(() => s + '×' + (w.s.scale === s ? ' ✓' : ''), () => w.s.scale = s, 'speed-' + s)));
    row('Weather', [btn(() => 'auto' + (!w.s.forced ? ' ✓' : ''), () => w.force('auto'), 'weather-auto'), ...Object.keys(STATES).map(k => btn(() => k + (w.s.forced === k ? ' 🔒' : w.stateName() === k ? ' ✓' : ''), () => w.force(k), 'weather-' + k))]);
    row('Surfaces', [btn('Dry', () => { w.s.wet = 0; w.s.puddle = 0; }), btn('Soak', () => { w.s.wet = 1; w.s.puddle = 0.9; })]);
    row('Home',[btn('Woodley front door',()=>{const home=G.interiors.sites.find(s=>s.brothersHome);if(home){this.close?.();G.teleport(home.dx,home.dz);}})]);
    section('Emergency response');
    row('Incidents', [btn('Stage collision nearby', () => { const i = G.police.stageCollision(); this.toast(i ? 'Collision staged · watch for the response' : 'No suitable traffic nearby'); }),
      ...[['injury','Injury crash'],['rescue','Trapped occupant']].map(([severity,label])=>btn(label,()=>this.toast(G.police.stageCollision(severity)?label+' staged':'No suitable traffic nearby'))),
      btn('Vehicle fire',()=>this.toast(G.neighbourhood.startFire()?'Vehicle fire reported':'No available crew or suitable location')),
      btn('Stage breakdown nearby', () => { const i = G.police.stageBreakdown(); this.toast(i ? 'A car has broken down · watch for the patrol and recovery truck' : 'No suitable traffic nearby'); }),
    ]);
    row('Police', [btn('Wanted ★ +1', () => { const W = G.wanted; W.setLevel(W.level ? W.level + 1 : 2, 'Dev: police on to you'); W.spotted(G.brothers.me); }),
      btn('Clear wanted', () => G.wanted.clear('Dev: wanted level cleared')), btn('Heal', () => { G.brothers.me.hp = 100; this.toast('Health restored'); })]);
    section('Performance & simulation');
    row('Renderer', [btn('Perf overlay', () => { this.perfOn = !this.perfOn; this.el('perf').hidden = !this.perfOn; }), btn('Save perf log', () => G.perf.export()),
      btn(() => G.perf.fly.active ? 'Stop flythrough' : 'Perf flythrough', () => G.perf.fly.active ? G.perf.fly.finish(false) : G.perf.fly.start(), 'perf-flythrough'),
      btn(G.backend === 'WebGPU' ? 'Use WebGL2' : 'Retry WebGPU', () => G.backend === 'WebGPU' ? G.useWebGL() : G.retryWebGPU())]);
    row('Sim', [1, 2, 4, 8].map(k => btn(() => '×' + k + (G.simSteps === k ? ' ✓' : ''), () => G.simSteps = k, 'sim-' + k)));
    section('Wildlife, transit & interiors');
    const pin = (label, candidates) => {
      const me = G.brothers.me;
      let nearest, distance = Infinity;
      for (const p of candidates) {
        const m = Math.hypot(p.x-me.x,p.z-me.z);
        if (m < distance) { nearest = p; distance = m; }
      }
      if (!nearest) return this.toast('No '+label.toLowerCase()+' currently available');
      const name = nearest.title || nearest.name || nearest.key || label;
      this.nav.set({name,x:nearest.x,z:nearest.z});
      this.toast(name+' · '+Math.round(distance)+' m · waypoint set');
    };
    const locate = (name, list) => btn(name, () => pin(name,list()));
    row('Set up a dog walk', [btn('Stage dog walker', () => {
      const me = G.brothers.me, sim = G.wildlife.sim;
      const walkers = G.peds.near(me.x,me.z,100).filter(p => p.id && !p.officer && !p.gone && p.mode === 'walk');
      walkers.sort((a,b) => Math.hypot(a.x-me.x,a.z-me.z) - Math.hypot(b.x-me.x,b.z-me.z));
      const walker = walkers[0];
      if (!walker) return this.toast('No walking pedestrian within 100 m');
      let dog = sim.dogs.get(walker.id);
      if (!dog || dog.gone) {
        if (sim.roam >= sim.max) return this.toast('Wildlife population is at capacity');
        dog = sim.attachDog(walker,false,sim.rand());
      }
      pin('Dog walker',[{x:dog.x,z:dog.z,name:'Dog walker'}]);
    })]);
    row('Mark current location on map', [
      locate('Dog walker', () => G.wildlife.sim.list.filter(a => a.key==='dog' && a.owner && !a.gone)),
      locate('Wild animal', () => G.wildlife.sim.list.filter(a => a.key!=='dog' && !a.gone && !a.hidden)),
      locate('Train station', () => G.transit.stations),
      locate('Bus stop', () => G.net.busStops.map(([x,z,name]) => ({x,z,name}))),
      locate('Building entrance', () => (G.interiors.sites || []).map(s => ({x:s.dx??s.x,z:s.dz??s.z,title:s.title}))),
      locate('Petrol station', () => G.fuel.stations || [])
    ]);
    section('Travel & test locations');
    row('Go to', G.manifest.districts.filter(di => !/hamlet|neighbourhood/.test(di.kind || '')).map(di => btn(di.name, () => G.teleport(di.x, di.z), 'goto-' + slug(di.name))));
    row('Test spots', TESTSPOTS.map(([n, x, z, h]) => btn(n, () => G.teleport(x, z, h), 'spot-' + slug(n))));
    this.refreshDev(); jump.focus();
  }
}
function dot(c, x, z, r, col, edge, lw) { c.fillStyle = col; c.beginPath(); c.arc(x, z, r, 0, 7); c.fill(); if (edge) { c.strokeStyle = edge; c.lineWidth = lw || 1.5; c.stroke(); } }
// stable data-act ids for dev buttons (the acceptance run taps by id, not by label or position)
export function slug(s) { return String(s).toLowerCase().replace(/[✓×]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s) { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]); }
