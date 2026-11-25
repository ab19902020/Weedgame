// HUD: minimap, full map, buttons, notices, developer panel and performance overlay.
import { ROLES } from './riggedPeople.js';
import { GameMenu } from './gameMenu.js';
import { Navigation, distanceLabel } from './navigation.js';
import { STATES } from './weather.js';

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
      <div id="mini"><canvas id="miniC" width="220" height="220"></canvas><div id="road"></div><div id="guidance" hidden><small></small><strong></strong></div></div>
      <div id="clock"></div>
      <div id="banner" hidden></div>
      <div id="toast" hidden></div>
      <div id="feed"></div>
      <div id="fade"></div>
      <div id="btns">
        <div class="top">
          <button id="bCam" data-act="camera" aria-label="Camera">${ICON.cam}</button><button id="bSwap" aria-label="Swap brother">${ICON.swap}</button><button id="bMap" aria-label="Map">${ICON.map}</button><button id="bMenu" aria-label="Menu">${ICON.menu}</button><button id="bDev" aria-label="Developer">${ICON.dev}</button>
        </div>
        <div class="foot">
          <button id="bUse" class="ctx"><i>${ICON.door}</i><span>Enter</span></button>
          <button id="bPickup" class="mid" aria-label="Pick up">${ICON.hand}<b>Pick up</b></button>
          <button id="bHit" class="mid" aria-label="Hit">${ICON.fist}<b>Hit</b></button>
          <button id="bRun" class="big" aria-label="Run">${ICON.run}<b>Run</b></button>
          <button id="bJump" class="big" aria-label="Jump">${ICON.jump}<b>Jump</b></button>
        </div>
        <div class="drive" hidden>
          <button id="bHorn" class="mid" aria-label="Horn">${ICON.horn}<b>Horn</b></button>
          <button id="bHand" class="mid" aria-label="Handbrake">${ICON.handbrake}<b>Handbrake</b></button>
          <div id="pBrake" class="pedal brake" role="button" aria-label="Brake"><span>BRAKE</span><em>R</em></div>
          <div id="pGas" class="pedal gas" role="button" aria-label="Accelerator"><span>GAS</span></div>
        </div>
        <div class="arrows" hidden><div id="sLeft" class="arrow" role="button" aria-label="Steer left">${ICON.left}</div><div id="sRight" class="arrow" role="button" aria-label="Steer right">${ICON.right}</div></div>
      </div>
      <div id="speedo" hidden><b>0</b><small>MPH</small><i></i></div>
      <div id="map" hidden><canvas id="mapC"></canvas><div class="maptools"><div class="atlasTitle">Green County <em>Road Atlas</em></div><button id="mClose">Close</button></div>
      <div class="atlasPlaces"><select id="mPlaces" aria-label="Route to a place"><option value="">Route to a place…</option></select><button id="mFit" hidden>Route</button><button id="mMe">Locate</button><button id="mOut" aria-label="Zoom out">−</button><button id="mIn" aria-label="Zoom in">+</button></div>
      <div class="atlasFooter"><span id="mInfo"></span><button id="mClear">Clear waypoint</button></div></div>
      <div id="dev" class="panel" hidden></div>
      <div id="perf" hidden></div>`;
    this.mini = root.querySelector('#miniC').getContext('2d');
    this.el = id => root.querySelector('#' + id);
    const I = G.input;
    for(const [id,action] of [['bJump','jump'],['bHit','hit'],['bPickup','pickup']])I.bindButton(this.el(id),action);
    I.bindButton(this.el('bUse'), 'use'); I.bindButton(this.el('bRun'), 'run', true); I.bindButton(this.el('bHorn'), 'horn');
    I.bindButton(this.el('bHand'), 'brake', true); I.bindPedals(this.el('pGas'), this.el('pBrake')); I.bindArrows(this.el('sLeft'), this.el('sRight'));
    I.bindButton(this.el('bSwap'), 'swap'); I.bindButton(this.el('bCam'), 'camera'); I.bindButton(this.el('bMap'), 'map'); I.bindButton(this.el('bDev'), 'dev');
    this.el('mClose').onclick = () => this.toggleMap(false);
    this.el('mMe').onclick = () => { const me = G.brothers.me; this.mapView.x = me.x; this.mapView.z = me.z; this.mapView.s = 1.2; };
    this.mapView = { x: 0, z: 0, s: 0.25 };
    this.nav = new Navigation(G.net);
    const places = [...G.transit.stations.map(s=>({...s,name:s.name+" station"})),...G.manifest.districts.filter(d=>!/hamlet|neighbourhood/.test(d.kind||'')), ...TESTSPOTS.slice(0,4).map(([name,x,z])=>({name,x,z}))];
    const select = this.el('mPlaces');
    places.forEach((place,index)=>select.add(new Option(place.name,String(index))));
    select.onchange = () => {
      if (!select.value) return;
      const p=places[Number(select.value)]; this.nav.set({x:p.x,z:p.z,name:p.name});
      this.mapView.x=p.x; this.mapView.z=p.z; select.value='';
    };
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
    this.menu=new GameMenu(this);
    this.overview = new Map();
    this.feedItems = [];
    this.perfOn = G.Q.has('perf');
    this.el('perf').hidden = !this.perfOn;
  }
  toast(t, secs = 3) { const e = this.el('toast'); e.textContent = t; e.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => e.hidden = true, secs * 1000); }
  banner(t, kind, secs) { const e = this.el('banner'); e.textContent = t; e.className = kind || ''; e.hidden = false; clearTimeout(this._bt); if (secs || kind === 'clear') this._bt = setTimeout(() => e.hidden = true, (secs || 4) * 1000); }
  feed(t) { this.feedItems.unshift({ t, at: performance.now() }); this.feedItems = this.feedItems.slice(0, 4); this.renderFeed(); }
  renderFeed() { const now = performance.now(); this.feedItems = this.feedItems.filter(f => now - f.at < 14000); this.el('feed').innerHTML = this.feedItems.map(f => `<div>${esc(f.t)}</div>`).join(''); }
  fade(text) { const f = this.el('fade'); f.textContent = text || ''; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  // ------------------------------------------------------------------ per frame
  update(dt) {
    const G = this.G, me = G.brothers.me, I = G.input;
    if (I.consume('map')) this.toggleMap();
    if (I.consume('dev')) this.toggleDev();
    const inCar = !!me.vehicle;
    const near = !inCar && G.brothers.nearestVehicle();
    const boardable=G.transit.nearby(me);
    const waiting=!inCar && !near && !boardable && !G.transit.ride && (G.transit.platform(me)?'Awaiting train':G.transit.busStop(me)?'Awaiting bus':'');
    const useText=G.transit.ride?(G.transit.currentStop()?'Alight':'Request stop'):boardable?'Board':waiting||(inCar?'Exit':near?.owner?'Get in ('+near.owner+"'s)":'Get in');
    const use=this.el('bUse');
    if(use.lastChild.textContent!==useText){use.lastChild.textContent=useText;use.firstChild.innerHTML=inCar||G.transit.ride&&G.transit.currentStop()?ICON.exit:boardable||G.transit.ride?ICON.bus:ICON.door;}
    use.disabled=!!waiting;
    const ready=inCar||near||G.transit.ride||boardable;
    use.classList.toggle('dim',!ready); use.classList.toggle('ready',!!(near||boardable)&&!inCar);
    // on foot: stick and actions; driving: wheel (or arrows) and pedals; riding a bus or train: just the stop button
    const ride=!!G.transit.ride, drive=inCar&&!ride, steer=this.menu?.settings?.steering||'Drag wheel';
    I.driving=drive; I.steering=steer;
    this.el('btns').querySelector('.foot').classList.toggle('driving',drive||ride);
    this.el('btns').querySelector('.drive').hidden=!drive;
    this.el('btns').querySelector('.arrows').hidden=!(drive&&steer==='Arrow buttons');
    I.wheelEl.hidden=!(drive&&steer==='Drag wheel');
    I.rest.hidden=drive||ride;
    for(const id of ['bJump','bHit','bPickup','bRun'])this.el(id).hidden=drive||ride;
    this.el('bSwap').hidden=ride;
    if(drive!==this._wasDriving){this._wasDriving=drive;if(drive&&steer==='Tilt')I.calibrateTilt();}
    if(drive){
      const v=G.traffic.byId.get(me.vehicle),c=I.driveControls(0);
      const mph=Math.round(Math.abs(v?.sp||0)*2.237),sp=this.el('speedo');sp.hidden=false;
      if(sp.firstChild.textContent!==String(mph))sp.firstChild.textContent=mph;
      sp.lastChild.textContent=v?.ph?.gear<0?'R':v?.ph?(Math.abs(v.sp)<0.3&&!c.gas?'N':String(v.ph.gear)):'';
      I.wheelEl.style.setProperty('--steer',(c.steer*110).toFixed(1)+'deg');
      this.el('pBrake').classList.toggle('rev',!!(v?.ph?.gear<0&&c.brake>0));
    } else this.el('speedo').hidden=true;
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.1) { this._acc = 0; const notice=this.nav.update(me); if(notice) this.toast(notice); this.drawMini(); this.renderFeed(); this.drawClock(); if (!this.el('map').hidden) this.drawMap(); }
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
    const G = this.G, c = this.mini, W = 220, me = G.brothers.me, net = G.net;
    const scale = me.vehicle ? Math.max(.35,.92-(G.brothers.speedNow || 0)*.018) : 1.6; // px per metre
    const rot = this.menu.settings.orientation === 'North up' ? 0 : me.vehicle ? -me.heading-Math.PI/2 : -(G.brothers.cam.yaw + Math.PI / 2) - Math.PI; // map rotates with camera
    c.save(); c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(28,36,32,0.88)'; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, 7); c.fill(); c.clip();
    c.translate(W / 2, W / 2); c.rotate(rot); c.scale(scale, scale); c.translate(-me.x, -me.z);
    const R = W / scale * 0.75;
    // buildings from loaded tiles
    c.fillStyle = '#5b5550';
    G.tiles.buildingsNear(me.x, me.z, R, (P, s, n) => {
      c.beginPath(); for (let k = 0; k < n; k++) { const x = P[(s + k) * 2], z = P[(s + k) * 2 + 1]; k ? c.lineTo(x, z) : c.moveTo(x, z); } c.fill();
    });
    // roads
    const seen = new Set();
    for (let cx = Math.floor((me.x - R) / 50); cx <= Math.floor((me.x + R) / 50); cx++) for (let cz = Math.floor((me.z - R) / 50); cz <= Math.floor((me.z + R) / 50); cz++) {
      const l = net.grid.get(cx * 65536 + cz); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) seen.add(l[k]);
    }
    for (const pass of [0, 1]) for (const e of seen) {
      const walk = net.walkCls.has(net.cls[e]); if (walk && pass === 0) continue; if (!walk && pass === 1) continue;
      const cl = net.classes[net.cls[e]];
      c.strokeStyle = walk ? '#7d7a6c' : /motorway|trunk/.test(cl) ? '#e0a050' : /primary/.test(cl) ? '#d8c890' : '#c9c9c0';
      c.lineWidth = walk ? 1.2 : Math.max(3, net.width[e]);
      c.beginPath();
      const s = net.pstart[e], n = net.pcount[e];
      for (let i = 0; i < n; i++) { const x = net.pts[(s + i) * 3], z = net.pts[(s + i) * 3 + 2]; i ? c.lineTo(x, z) : c.moveTo(x, z); }
      c.stroke();
    }
    this.nav.draw(c,x=>x,z=>z,1/scale);
    // vehicles: parked brothers' cars, police
    for (const v of G.traffic.list) {
      if (Math.abs(v.x - me.x) > R || Math.abs(v.z - me.z) > R) continue;
      if (v.kind === 'police') dot(c, v.x, v.z, 5 / scale, v.siren ? (Math.floor(performance.now() / 250) % 2 ? '#2a6cff' : '#ff2a2a') : '#3a7aff');
      else if (v.owner || v.free) dot(c, v.x, v.z, 4.5 / scale, '#7fd0ff');
      else if (v.kind === 'bus') dot(c, v.x, v.z, 4 / scale, '#c080ff');
    }
    // other brother
    const other = G.brothers.b[1 - G.brothers.active];
    c.restore();
    c.save(); c.translate(W / 2, W / 2);
    const toScreen = (x, z) => { const dx = (x - me.x) * scale, dz = (z - me.z) * scale; const cs = Math.cos(rot), sn = Math.sin(rot); return [dx * cs - dz * sn, dx * sn + dz * cs]; };
    let [ox, oz] = toScreen(other.x, other.z);
    const lim = W / 2 - 12, ol = Math.hypot(ox, oz); if (ol > lim) { ox *= lim / ol; oz *= lim / ol; }
    c.fillStyle = '#ffb347'; c.beginPath(); c.arc(ox, oz, 7, 0, 7); c.fill(); c.fillStyle = '#222'; c.font = 'bold 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(other.short[0], ox, oz + 0.5);
    // me (arrow showing heading)
    const hd = me.heading + rot;
    c.rotate(hd); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, -6); c.lineTo(-3, 0); c.lineTo(-6, 6); c.fill();
    c.restore();
    // north marker
    const nx = Math.cos(rot - Math.PI / 2) * (W / 2 - 12), nz = Math.sin(rot - Math.PI / 2) * (W / 2 - 12);
    c.fillStyle = '#fff'; c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', W / 2 + nx, W / 2 + nz);
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
  zoomMap(factor) { this.mapView.s=Math.max(.04,Math.min(4,this.mapView.s*factor)); }
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
    if (on) { const me = this.G.brothers.me; this.mapView = { x: me.x, z: me.z, s: 0.35 }; }
  }
  ovTile(i, j) {
    const k = i + '_' + j; if (this.overview.has(k)) return this.overview.get(k);
    const img = new Image(); img.src = `world/overview/${k}.png`; this.overview.set(k, img); return img;
  }
  drawMap() {
    const G = this.G, cv = this.el('mapC'), ov = G.manifest.overview;
    if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
    const c = cv.getContext('2d'), V = this.mapView, W = cv.width, H = cv.height;
    c.fillStyle = '#6e766c'; c.fillRect(0, 0, W, H);
    const X = x => (x - V.x) * V.s + W / 2, Z = z => (z - V.z) * V.s + H / 2;
    const tw = ov.tile * ov.mpx;
    const i0 = Math.max(0, Math.floor((V.x - W / 2 / V.s - ov.x0) / tw)), i1 = Math.min(Math.ceil(ov.w / ov.tile) - 1, Math.floor((V.x + W / 2 / V.s - ov.x0) / tw));
    const j0 = Math.max(0, Math.floor((V.z - H / 2 / V.s - ov.z0) / tw)), j1 = Math.min(Math.ceil(ov.h / ov.tile) - 1, Math.floor((V.z + H / 2 / V.s - ov.z0) / tw));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const img = this.ovTile(i, j); if (!img.complete || !img.naturalWidth) continue;
      c.drawImage(img, X(ov.x0 + i * tw), Z(ov.z0 + j * tw), tw * V.s + 1, tw * V.s + 1);
    }
    // roads + names
    const net = G.net, labels = [];
    const minRank = V.s < 0.15 ? 7 : V.s < 0.5 ? 5 : 2;
    for (let e = 0; e < net.nEdges; e++) {
      const cl = net.classes[net.cls[e]];
      const rank = { motorway: 9, trunk: 9, primary: 8, secondary: 7, tertiary: 6, motorway_link: 6, trunk_link: 6, primary_link: 6, unclassified: 4, residential: 3, living_street: 2, service: 1 }[cl] || 0;
      if (rank < minRank) continue;
      const s = net.pstart[e], n = net.pcount[e];
      const x0 = net.pts[s * 3], z0 = net.pts[s * 3 + 2];
      if (X(x0) < -400 || X(x0) > W + 400 || Z(z0) < -400 || Z(z0) > H + 400) continue;
      c.strokeStyle = rank >= 9 ? '#e8a040' : rank >= 7 ? '#efe0a0' : '#f4f2ea'; c.lineWidth = Math.max(1, net.width[e] * V.s);
      c.beginPath(); for (let k = 0; k < n; k++) { const x = X(net.pts[(s + k) * 3]), z = Z(net.pts[(s + k) * 3 + 2]); k ? c.lineTo(x, z) : c.moveTo(x, z); } c.stroke();
      const nm = net.roadName(e); if (nm && net.len[e] * V.s > 60) labels.push([nm, s + (n >> 1), rank]);
    }
    c.font = '600 12px system-ui'; c.fillStyle = '#1a1a1a'; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.textAlign = 'center';
    const used = new Set(), cells = new Set();
    labels.sort((a, b) => b[2] - a[2]);
    for (const [nm, k] of labels) {
      const x = X(net.pts[k * 3]), z = Z(net.pts[k * 3 + 2]); const cell = Math.floor(x / 140) + ',' + Math.floor(z / 26);
      if (used.has(nm) && V.s < 1 || cells.has(cell) || x < 0 || x > W || z < 0 || z > H) continue;
      used.add(nm); cells.add(cell); c.strokeText(nm, x, z); c.fillText(nm, x, z);
    }
    // districts
    c.font = 'bold 15px system-ui';
    for (const d of G.manifest.districts) { if (/hamlet|neighbourhood/.test(d.kind || '')) continue; c.strokeText(d.name, X(d.x), Z(d.z) - 20); c.fillText(d.name, X(d.x), Z(d.z) - 20); }
    G.transit.drawMap(c,X,Z,V.s);
    this.nav.draw(c,X,Z);
    // vehicles & brothers
    for (const v of G.traffic.list) { if (v.owner || v.free) dot(c, X(v.x), Z(v.z), 6, '#4fb7ff'); if (v.kind === 'police') dot(c, X(v.x), Z(v.z), 4, '#2a4cff'); }
    G.brothers.b.forEach((b, i) => { dot(c, X(b.x), Z(b.z), 8, i === G.brothers.active ? '#ffffff' : '#ffb347'); c.fillStyle = '#111'; c.font = 'bold 13px system-ui'; c.fillText(b.short, X(b.x), Z(b.z) - 12); });
    const nav=this.nav;
    this.el('mInfo').textContent=nav.pin ? nav.pin.name+' · '+(nav.route ? distanceLabel(nav.route.length-nav.progress)+' remaining' : nav.instruction()) : 'Tap a street to set a waypoint · drag to explore';
    this.el('mClear').hidden=this.el('mFit').hidden=!nav.pin;
    const metres=[10,25,50,100,250,500,1000,2500].find(n=>n*V.s>=45)||2500;
    const width=metres*V.s;
    c.fillStyle='#19372e';c.fillRect(14,H-85,width+12,29);c.fillStyle='#fff5d9';
    c.font='bold 11px system-ui';c.textAlign='left';c.fillText(metres>=1000?metres/1000+' km':metres+' m',20,H-70);
    c.fillRect(20,H-65,width,2);
  }
  // ------------------------------------------------------------------ developer panel
  toggleDev() {
    const d = this.el('dev'); d.hidden = !d.hidden; if (d.hidden) return;
    const G = this.G, w = G.world;
    const btn = (label, fn, act) => { const b = document.createElement('button'); b.textContent = label; b.dataset.act = act || slug(label); b.onclick = e => { e.stopPropagation(); fn(); this.toggleDev(); this.toggleDev(); }; return b; };
    d.innerHTML = '<button class="x" id="devX">×</button><h3>Developer</h3>';
    d.querySelector('#devX').onclick = e => { e.stopPropagation(); d.hidden = true; };
    const row = (title, items) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<b>${title}</b>`; for (const it of items) r.append(it); d.append(r); };
    const rigs = G.people.rigs;
    row('Character preview', ['cal', 'leon', 'officer', 'civilian', 'off'].map(role => btn(role, () => { rigs.previewRole = role === 'off' ? null : role; if (ROLES[role]?.hero) rigs.previewClip = ROLES[role].idle; }, 'preview-' + role)));
    for (const hero of ['cal', 'leon']) row(hero === 'cal' ? 'Cal' : 'Leon', ROLES[hero].clips.map(clip => btn(clip.replace(/_0?(\d)$/, ' $1').replace(/_/g, ' '), () => { rigs.previewRole = hero; rigs.previewClip = clip; }, hero + '-' + clip)));
    row('Animation', ['Idle', 'Walk', 'Run', 'Jump', 'Swim', 'WeaponHold'].map(clip => btn(clip, () => { if (!rigs.previewRole || ROLES[rigs.previewRole]?.hero) rigs.previewRole = 'civilian'; rigs.previewClip = clip; }, 'anim-' + clip.toLowerCase())));
    row('Time', [6, 8, 12, 16, 18.5, 21, 0].map(h => btn(String(h).replace('.5', ':30'), () => w.setHour(h), 'time-' + h)));
    row('Speed', [1, 30, 120, 600].map(s => btn(s + '×' + (w.s.scale === s ? ' ✓' : ''), () => w.s.scale = s, 'speed-' + s)));
    row('Weather', Object.keys(STATES).map(k => btn(k + (w.stateName() === k ? ' ✓' : ''), () => w.force(k), 'weather-' + k)));
    row('Surfaces', [btn('Dry', () => { w.s.wet = 0; w.s.puddle = 0; }), btn('Soak', () => { w.s.wet = 1; w.s.puddle = 0.9; })]);
    row('World', [btn('Stage collision nearby', () => { const i = G.police.stageCollision(); this.toast(i ? 'Collision staged · watch for the response' : 'No suitable traffic nearby'); }),
      btn('Stage breakdown nearby', () => { const i = G.police.stageBreakdown(); this.toast(i ? 'A car has broken down · watch for the patrol and recovery truck' : 'No suitable traffic nearby'); }),
      btn('Perf overlay', () => { this.perfOn = !this.perfOn; this.el('perf').hidden = !this.perfOn; }), btn('Save perf log', () => G.perf.export()),
      btn(G.perf.fly.active ? 'Stop flythrough' : 'Perf flythrough', () => G.perf.fly.active ? G.perf.fly.finish(false) : G.perf.fly.start(), 'perf-flythrough'),
      btn(G.backend === 'WebGPU' ? 'Use WebGL2' : 'Retry WebGPU', () => G.backend === 'WebGPU' ? G.useWebGL() : G.retryWebGPU())]);
    row('Vehicle', [btn('Repair', () => { const v = G.traffic.byId.get(G.brothers.me.vehicle) || G.brothers.nearestVehicle(8); if (v) { v.dmg = [0, 0, 0, 0]; G.save.markVehicle(v); this.toast('Repaired'); } else this.toast('No vehicle nearby'); }, 'repair'),
      btn('Range Rover', () => { const me = G.brothers.me, h = me.heading || 0; const x = me.x + Math.cos(h) * 7, z = me.z + Math.sin(h) * 7; G.traffic.add({ id: 'dev-rr-' + Date.now(), kind: 'parked', model: 'rangerover', paint: 0x23382c, x, y: G.tiles.ground(x, z, me.y + 1) ?? me.y, z, heading: h, parked: true, free: true }); this.toast('Range Rover delivered'); }, 'spawn-rangerover'),
      btn('Sports car', () => { const me = G.brothers.me, h = me.heading || 0; const x = me.x + Math.cos(h) * 6, z = me.z + Math.sin(h) * 6; G.traffic.add({ id: 'dev-' + Date.now(), kind: 'parked', model: 'sports', paint: 0xb5121b, x, y: G.tiles.ground(x, z, me.y + 1) ?? me.y, z, heading: h, parked: true, free: true }); this.toast('Sports car delivered'); }, 'spawn-sports')]);
    row('Sim', [1, 2, 4, 8].map(k => btn('×' + k + (G.simSteps === k ? ' ✓' : ''), () => G.simSteps = k, 'sim-' + k)));
    row('Go to', G.manifest.districts.filter(di => !/hamlet|neighbourhood/.test(di.kind || '')).map(di => btn(di.name, () => G.teleport(di.x, di.z), 'goto-' + slug(di.name))));
    row('Test spots', TESTSPOTS.map(([n, x, z, h]) => btn(n, () => G.teleport(x, z, h), 'spot-' + slug(n))));
    const info = document.createElement('p'); info.textContent = `Renderer ${G.backend} · quality ${G.quality} · weather seed ${w.s.seed} · sandbox mode (no missions)`; d.append(info);
    d.append(btn('Close', () => {}));
    d.lastChild.onclick = () => d.hidden = true;
  }
}
function dot(c, x, z, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, z, r, 0, 7); c.fill(); }
// stable data-act ids for dev buttons (the acceptance run taps by id, not by label or position)
export function slug(s) { return String(s).toLowerCase().replace(/[✓×]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s) { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]); }
