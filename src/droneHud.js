// The drone's screen and controls (drone.js does the flying).
//   Touch (Mode 2, like a real drone's remote): left thumb = climb / descend and turn, right thumb = forwards / back
//   and sideways. Each stick appears where the thumb lands in its half of the screen and springs back to centre
//   (centre = hold position in CINE / NORMAL / SPORT, hover throttle in MANUAL). Buttons: Take off / Land, Return
//   home, Camera (normal / thermal white-hot / thermal ironbow), Mode, View (FPV / chase / from the pilot), Exit.
//   The gimbal slider on the right tilts the camera (-90 to +25 degrees).
//   Keyboard: W/S climb, A/D turn, arrows (or I/K/J/L) fly, Space take off / land, R return home, T camera,
//   M mode, V view, Q/E tilt the camera, G or Esc exit.
//   Controller: see controller.js (Mode 2 sticks, Cross take off / land, Square camera, Circle return home,
//   L1 / R1 mode, L2 / R2 tilt, D-pad left / right view, Triangle exit).
// The OSD: mode, GPS, signal and battery, flight time; height, height over the ground and climb rate; speed and
// distance home; a compass tape with home on it; a horizon line and pitch ladder in MANUAL; the radar map; warnings.
import { MODES } from './drone.js';

const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  drone: svg('<circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>'),
  up: svg('<path d="M12 19V6M6 11l6-6 6 6"/><path d="M5 21h14"/>'),
  down: svg('<path d="M12 4v13M6 12l6 6 6-6"/><path d="M5 21h14"/>'),
  home: svg('<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/>'),
  cam: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  mode: svg('<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/><circle cx="12" cy="18" r="1.2"/>'),
  view: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  exit: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
};
const CAMNAME = { normal: 'VISIBLE', thermal: 'IR · WHITE HOT', ironbow: 'IR · IRONBOW' };
const VIEWNAME = { fpv: 'FPV', chase: 'CHASE', pilot: 'PILOT' };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const STICK_R = 62;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

export class DroneHud {
  constructor(G) {
    this.G = G; this.D = G.drone;
    this.touch = { l: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, r: { id: null, ox: 0, oy: 0, x: 0, y: 0 } };
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, gimbal: 0 };
    this.gimbalDrag = null;
    const el = this.el = document.createElement('div');
    el.id = 'droneHud'; el.hidden = true;
    el.innerHTML = `<canvas id="dOSD"></canvas>
      <div class="dZone l"></div><div class="dZone r"></div>
      <div class="dStick l rest"><i></i></div><div class="dStick r rest"><i></i></div>
      <div class="dTop">
        <button data-d="rth">${ICON.home}<b>Home</b></button><button data-d="cam">${ICON.cam}<b>Camera</b></button><button data-d="mode">${ICON.mode}<b>Mode</b></button><button data-d="view">${ICON.view}<b>View</b></button><button data-d="exit">${ICON.exit}<b>Exit</b></button>
      </div>
      <button class="dTO" data-d="to">${ICON.up}<span>Take off</span></button>
      <div class="dGimbal"><div class="track"><i></i></div><b>Tilt</b></div>
      <div class="dStatic"></div>`;
    document.body.append(el);
    this.cv = el.querySelector('#dOSD'); this.cx = this.cv.getContext('2d');
    this.sticks = { l: el.querySelector('.dStick.l'), r: el.querySelector('.dStick.r') };
    this.toBtn = el.querySelector('.dTO'); this.gimbalEl = el.querySelector('.dGimbal'); this.staticEl = el.querySelector('.dStatic');
    // the launch button (on foot, when a brother owns a drone)
    const launch = this.launch = document.createElement('button');
    launch.id = 'droneLaunch'; launch.hidden = true; launch.innerHTML = `${ICON.drone}<span>Fly drone</span>`;
    launch.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.D.deploy(); });
    (document.getElementById('hud') || document.body).append(launch);
    // touch
    const opts = { passive: false };
    for (const side of ['l', 'r']) el.querySelector('.dZone.' + side).addEventListener('pointerdown', e => this.down(e, side), opts);
    addEventListener('pointermove', e => this.move(e), opts);
    addEventListener('pointerup', e => this.up(e), opts); addEventListener('pointercancel', e => this.up(e), opts);
    for (const b of el.querySelectorAll('[data-d]')) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.act(b.dataset.d); try { navigator.vibrate?.(8); } catch { /* no haptics */ } });
    const gt = el.querySelector('.dGimbal .track');
    gt.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.gimbalDrag = e.pointerId; this.gimbalAt(e.clientY); gt.setPointerCapture?.(e.pointerId); }, opts);
    gt.addEventListener('pointermove', e => { if (e.pointerId === this.gimbalDrag) this.gimbalAt(e.clientY); });
    gt.addEventListener('pointerup', () => { this.gimbalDrag = null; });
    // keyboard
    this.keys = new Set();
    addEventListener('keydown', e => {
      if (!this.D.active) { if (e.code === 'KeyG' && !e.repeat && this.D.kit() && this.G.hud?.menu?.el?.hidden !== false) this.D.deploy(); return; }
      this.keys.add(e.code); if (!e.repeat) this.key(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('resize', () => this.size()); this.size();
  }
  size() { const r = Math.min(2, devicePixelRatio || 1); this.cv.width = innerWidth * r; this.cv.height = innerHeight * r; this.dpr = r; }
  // ---------------------------------------------------------------- actions
  act(a) {
    const D = this.D, G = this.G;
    if (a === 'to') { if (D.state === 'flying') D.land(); else D.takeoff(); }
    else if (a === 'rth') D.toggleRTH();
    else if (a === 'cam') { D.cycleCam(); G.hud?.toast?.('Camera: ' + CAMNAME[D.cam].toLowerCase().replace('ir', 'infrared'), 1.5); }
    else if (a === 'mode') { D.cycleMode(1); G.hud?.toast?.(`${D.mode} mode${D.mode === 'MANUAL' ? ' · full acro: nothing levels it' : D.mode === 'SPORT' ? ' · fast' : D.mode === 'CINE' ? ' · slow and smooth' : ''}`, 1.8); }
    else if (a === 'view') D.cycleView();
    else if (a === 'exit') D.exit();
  }
  key(code) {
    if (code === 'Space') this.act('to'); else if (code === 'KeyR') this.act('rth'); else if (code === 'KeyT') this.act('cam');
    else if (code === 'KeyM') this.act('mode'); else if (code === 'KeyV') this.act('view'); else if (code === 'KeyG' || code === 'Escape') this.act('exit');
  }
  gimbalAt(y) { const r = this.gimbalEl.querySelector('.track').getBoundingClientRect(), t = clamp((y - r.top) / r.height, 0, 1); this.D.gimbalWant = (25 - t * 115) * Math.PI / 180; }
  // ---------------------------------------------------------------- touch sticks
  down(e, side) {
    e.preventDefault(); const T = this.touch[side]; if (T.id != null) return;
    T.id = e.pointerId; T.ox = e.clientX; T.oy = e.clientY; T.x = T.y = 0;
    const s = this.sticks[side]; s.classList.remove('rest'); s.style.left = (e.clientX - 70) + 'px'; s.style.top = (e.clientY - 70) + 'px'; s.style.right = s.style.bottom = 'auto';
    s.firstChild.style.transform = 'translate(0,0)';
  }
  move(e) {
    for (const side of ['l', 'r']) {
      const T = this.touch[side]; if (e.pointerId !== T.id) continue;
      e.preventDefault();
      let dx = e.clientX - T.ox, dy = e.clientY - T.oy; const r = Math.hypot(dx, dy);
      if (r > STICK_R) { dx *= STICK_R / r; dy *= STICK_R / r; }
      // a small dead zone, then linear (the drone's own expo and the mode's stick shaping do the rest)
      const n = v => { const a = Math.abs(v) / STICK_R; return Math.sign(v) * (a < 0.06 ? 0 : (a - 0.06) / 0.94); };
      T.x = n(dx); T.y = -n(dy);
      this.sticks[side].firstChild.style.transform = `translate(${dx}px,${dy}px)`;
    }
  }
  up(e) {
    for (const side of ['l', 'r']) {
      const T = this.touch[side]; if (e.pointerId !== T.id) continue;
      T.id = null; T.x = T.y = 0; const s = this.sticks[side]; s.classList.add('rest'); s.style.left = s.style.top = s.style.right = s.style.bottom = ''; s.firstChild.style.transform = '';
    }
  }
  // ---------------------------------------------------------------- the combined input for drone.js
  input(dt) {
    const k = this.keys, P = this.pad, T = this.touch;
    const key = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    const sticks = {
      lx: clamp(T.l.x + P.lx + key('KeyD', 'KeyA'), -1, 1),
      ly: clamp(T.l.y + P.ly + key('KeyW', 'KeyS'), -1, 1),
      rx: clamp(T.r.x + P.rx + key('ArrowRight', 'ArrowLeft') + key('KeyL', 'KeyJ'), -1, 1),
      ry: clamp(T.r.y + P.ry + key('ArrowUp', 'ArrowDown') + key('KeyI', 'KeyK'), -1, 1),
    };
    return { sticks, gimbal: clamp(P.gimbal + key('KeyE', 'KeyQ'), -1, 1) };
  }
  // the controller (controller.js hands over the pad while the drone is up)
  padInput(pad, tap, axis, buttons) {
    const D = this.D, P = this.pad;
    // Mode 2: left stick = throttle / yaw, right stick = pitch / roll
    P.lx = axis(0); P.ly = -axis(1); P.rx = axis(2); P.ry = -axis(3);
    P.gimbal = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0);
    if (tap(0)) this.act('to');            // Cross: take off / land
    if (tap(2)) this.act('cam');           // Square: camera
    if (tap(1)) this.act('rth');           // Circle: return home
    if (tap(3)) this.act('exit');          // Triangle: exit
    if (tap(4)) { D.cycleMode(-1); this.G.hud?.toast?.(D.mode + ' mode', 1.2); }   // L1 / R1: mode down / up
    if (tap(5)) { D.cycleMode(1); this.G.hud?.toast?.(D.mode + ' mode', 1.2); }
    if (tap(14) || tap(15)) this.act('view'); // D-pad left / right: view
    if (tap(12)) D.gimbalWant = 0; if (tap(13)) D.gimbalWant = -Math.PI / 2;      // D-pad up / down: level / straight down
    if (tap(11)) D.gimbalWant = -12 * Math.PI / 180;                              // R3: back to the usual tilt
    // a light buzz in the hands at high throttle, a thump on a bump or crash
    for (const e of D.events) { if (e.kind === 'crash') this.G.haptics?.crash(Math.max(4, e.impact)); else if (e.kind === 'bump') this.G.haptics?.hit(false); }
    void buttons;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.G, D = this.D;
    // the launch button: on foot with a drone in the bag
    const canFly = !D.active && D.kit() && !D.canDeploy();
    if (this.launch.hidden !== !canFly) this.launch.hidden = !canFly;
    document.body.classList.toggle('drone-on', D.active);
    if (this.el.hidden !== !D.active) { this.el.hidden = !D.active; if (!D.active) { for (const s of ['l', 'r']) this.up({ pointerId: this.touch[s].id }); this.keys.clear(); } }
    // pad input is cleared each frame unless the controller sets it
    if (!G.padActive || !D.active) { this.pad.lx = this.pad.ly = this.pad.rx = this.pad.ry = this.pad.gimbal = 0; }
    if (!D.active) { D.events.length = 0; return; }
    const label = D.state === 'flying' ? 'Land' : D.state === 'crashed' ? (D.up.y < 0.3 ? 'Flip over' : 'Take off') : 'Take off';
    if (label !== this._label) { this._label = label; this.toBtn.innerHTML = `${label === 'Land' ? ICON.down : ICON.up}<span>${label}</span>`; }
    this.toBtn.classList.toggle('dim', D.state === 'ditched');
    this.gimbalEl.hidden = D.mode === 'MANUAL' || D.view !== 'fpv';
    this.gimbalEl.querySelector('i').style.top = (clamp((25 - D.gimbalWant * 180 / Math.PI) / 115, 0, 1) * 100) + '%';
    // weak video: break-up and snow over the picture
    const snow = D.signal < 0.35 ? (0.35 - D.signal) / 0.35 : D.state === 'ditched' ? 0.7 : 0;
    this.staticEl.style.opacity = snow ? (snow * (0.5 + Math.random() * 0.5)).toFixed(2) : '0';
    this.draw();
    G.audio?.droneEvents?.(D.events);
    D.events.length = 0;
  }
  // ---------------------------------------------------------------- the OSD
  draw() {
    const c = this.cx, D = this.D, G = this.G, r = this.dpr, W = innerWidth, H = innerHeight;
    c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, W, H);
    const thermal = D.cam !== 'normal';
    const ink = thermal ? '#ffffff' : '#f4fbff', dim = 'rgba(226,236,244,0.92)', warnC = '#ffcf3a', badC = '#ff5a4a';
    c.font = '600 13px system-ui'; c.textBaseline = 'middle'; c.lineWidth = 1.5;
    // a thin dark outline under every figure, so it reads over white cloud as well as dark ground
    const text = (t, x, y, al = 'left', col = ink, f) => { if (f) c.font = f; c.textAlign = al; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.strokeText(t, x, y); c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3; c.fillStyle = col; c.fillText(t, x, y); c.shadowBlur = 0; };
    const S = D.spec, agl = D.agl, hgt = D.p.y - D.home.y, vs = D.v.y, hs = D.speed;
    // ---- top row: mode, GPS, camera; signal, battery, time
    const L = Math.max(14, (window.visualViewport?.offsetLeft || 0) + 14);
    c.fillStyle = D.mode === 'MANUAL' ? 'rgba(200,60,40,0.85)' : D.mode === 'SPORT' ? 'rgba(220,140,20,0.85)' : 'rgba(20,24,28,0.6)';
    roundRect(c, L, 10, 86, 24, 6); c.fill();
    text(D.mode, L + 43, 22, 'center', '#fff', '700 13px system-ui');
    text(`GPS 18 · ${VIEWNAME[D.view]} · ${CAMNAME[D.cam]}`, L + 96, 22, 'left', dim, '600 12px system-ui');
    const bx = W - 300;
    // signal bars
    for (let i = 0; i < 5; i++) { c.fillStyle = D.signal > i / 5 + 0.05 ? ink : 'rgba(255,255,255,0.25)'; c.fillRect(bx + i * 6, 26 - i * 3 - 4, 4, i * 3 + 4); }
    text(`${(D.dist / 1000).toFixed(D.dist < 10000 ? 2 : 1)} km`, bx + 36, 22, 'left', dim, '600 12px system-ui');
    // battery
    const pct = Math.round(D.battery * 100), bc = pct < 15 ? badC : pct < 30 ? warnC : '#6de38a';
    c.strokeStyle = ink; c.strokeRect(bx + 96, 15, 30, 14); c.fillStyle = ink; c.fillRect(bx + 126, 19, 3, 6);
    c.fillStyle = bc; c.fillRect(bx + 98, 17, 26 * D.battery, 10);
    const volts = (13.6 + 3.2 * Math.pow(D.battery, 0.8)).toFixed(1);
    text(`${pct}% · ${volts} V`, bx + 134, 22, 'left', bc, '700 12px system-ui');
    const ft = D.flightT, mm = Math.floor(ft / 60), ss = Math.floor(ft % 60);
    text(`${mm}:${String(ss).padStart(2, '0')}`, W - 14, 22, 'right', dim, '600 12px system-ui');
    // ---- warnings (centre top)
    const warn = [];
    if (D.state === 'crashed') warn.push([D.broken ? 'CRASHED · PROPS BROKEN' : D.up.y < 0.3 ? 'CRASHED · UPSIDE DOWN: FLIP OVER' : 'CRASHED · TAKE OFF AGAIN', badC]);
    if (D.state === 'ditched') warn.push(['IN THE WATER · EXIT TO FISH IT OUT', badC]);
    if (D.rth) warn.push([D.rth.phase === 'land' ? (D.rth.auto ? 'LANDING' : 'LANDING AT HOME') : `RETURNING HOME · ${D.rth.why?.toUpperCase() || ''}`, warnC]);
    if (D.battery < 0.25 && D.state === 'flying') warn.push([D.battery < 0.12 ? 'BATTERY CRITICAL' : 'LOW BATTERY', badC]);
    if (D.signal < 0.6) warn.push([D.signal < 0.25 ? 'SIGNAL LOST' : 'WEAK SIGNAL', D.signal < 0.25 ? badC : warnC]);
    if (G.droneSky?.inCloud > 0.3) warn.push(['IN CLOUD · VISIBILITY LOW', warnC]);
    if (hgt > 120 && hgt < S.ceiling - 50) warn.push(['ABOVE 120 m · BEYOND THE UK DRONE LIMIT', 'rgba(255,255,255,0.75)']);
    if (hgt > S.ceiling - 50) warn.push(['ALTITUDE LIMIT', warnC]);
    if (D.obstacle && D.obstacle < 8 && D.state === 'flying') warn.push([`OBSTACLE ${D.obstacle.toFixed(1)} m`, D.obstacle < 3 ? badC : warnC]);
    if (D.state === 'landed' && !D.rth) warn.push(['READY TO FLY · TAKE OFF', 'rgba(140,255,190,0.95)']);
    warn.slice(0, 3).forEach(([t, col], i) => { c.font = '700 14px system-ui'; const w = c.measureText(t).width + 24; c.fillStyle = 'rgba(10,12,14,0.55)'; roundRect(c, W / 2 - w / 2, 44 + i * 30, w, 24, 6); c.fill(); text(t, W / 2, 56 + i * 30, 'center', col, '700 14px system-ui'); });
    // ---- left: height; right: speed and distance
    // (below the Take off / Land button on the left; clear of the tilt slider and the palette bar on the right)
    const midY = Math.max(240, H * 0.5), RX = W - 58;
    text('H', L, midY - 18, 'left', dim, '600 12px system-ui'); text(`${hgt.toFixed(hgt < 100 ? 1 : 0)} m`, L + 16, midY - 18, 'left', ink, '700 22px system-ui');
    text(`AGL ${agl.toFixed(agl < 100 ? 1 : 0)} m`, L, midY + 8, 'left', dim, '600 12px system-ui');
    text(`VS ${vs >= 0 ? '+' : ''}${vs.toFixed(1)} m/s`, L, midY + 26, 'left', dim, '600 12px system-ui');
    text(`${hs.toFixed(1)} m/s`, RX, midY - 18, 'right', ink, '700 22px system-ui');
    text(`${Math.round(hs * 2.237)} mph`, RX, midY + 8, 'right', dim, '600 12px system-ui');
    text(`D ${D.dist < 1000 ? Math.round(D.dist) + ' m' : (D.dist / 1000).toFixed(2) + ' km'}`, RX, midY + 26, 'right', dim, '600 12px system-ui');
    // ---- centre: crosshair, or the horizon line and pitch ladder in MANUAL
    const cxp = W / 2, cyp = H / 2;
    c.strokeStyle = ink; c.lineWidth = 1.6;
    if (D.mode === 'MANUAL' && D.view === 'fpv') {
      const up = D.up, f = D.fwd, rgt = { x: f.z * up.y - f.y * up.z, y: f.x * up.z - f.z * up.x, z: f.y * up.x - f.x * up.y };
      const roll = Math.atan2(-rgt.y, up.y), pitch = Math.asin(clamp(f.y, -1, 1)) + 30 * Math.PI / 180;   // the camera's up-tilt
      const ppd = H / (116 * Math.PI / 180) * 0.9;
      c.save(); c.translate(cxp, cyp); c.rotate(roll);
      c.beginPath(); c.moveTo(-140, pitch * ppd); c.lineTo(-40, pitch * ppd); c.moveTo(40, pitch * ppd); c.lineTo(140, pitch * ppd); c.stroke();
      for (const deg of [-20, -10, 10, 20]) { const y = (pitch - deg * Math.PI / 180) * ppd; c.globalAlpha = 0.55; c.beginPath(); c.moveTo(-40, y); c.lineTo(40, y); c.stroke(); c.globalAlpha = 1; }
      c.restore();
      c.beginPath(); c.moveTo(cxp - 12, cyp); c.lineTo(cxp - 4, cyp); c.moveTo(cxp + 4, cyp); c.lineTo(cxp + 12, cyp); c.moveTo(cxp, cyp - 4); c.lineTo(cxp, cyp + 4); c.stroke();
    } else {
      c.beginPath(); c.arc(cxp, cyp, 3, 0, 7); c.moveTo(cxp - 22, cyp); c.lineTo(cxp - 9, cyp); c.moveTo(cxp + 9, cyp); c.lineTo(cxp + 22, cyp); c.moveTo(cxp, cyp + 9); c.lineTo(cxp, cyp + 16); c.stroke();
      if (thermal) text(`${this.spotTemp().toFixed(1)} °C`, cxp + 26, cyp - 14, 'left', ink, '700 13px system-ui');
    }
    // ---- bottom: compass tape with home on it
    const hdgDeg = ((90 - (-D.heading * 180 / Math.PI) + 360) % 360 + 360) % 360;   // 0 = north, clockwise
    const tw = Math.min(420, W * 0.44), tx = W / 2 - tw / 2, ty = H - 30;
    c.fillStyle = 'rgba(10,12,14,0.45)'; roundRect(c, tx, ty - 16, tw, 30, 6); c.fill();
    c.save(); c.beginPath(); c.rect(tx, ty - 16, tw, 30); c.clip();
    for (let d = -90; d <= 90; d += 5) {
      const a = Math.round(hdgDeg / 5) * 5 + d, x = W / 2 + (a - hdgDeg) * tw / 180;
      const n = ((a % 360) + 360) % 360;
      c.strokeStyle = dim; c.beginPath(); c.moveTo(x, ty - 14); c.lineTo(x, ty - (n % 45 === 0 ? 4 : 9)); c.stroke();
      if (n % 45 === 0) text(DIRS[n / 45], x, ty + 6, 'center', n === 0 ? '#ff8a6a' : ink, '700 12px system-ui');
    }
    // home: its bearing from the drone
    const pp = D.pilotPos(), hb = ((Math.atan2(pp.x - D.p.x, -(pp.z - D.p.z)) * 180 / Math.PI) + 360) % 360;
    let rel = ((hb - hdgDeg + 540) % 360) - 180; const hx = W / 2 + clamp(rel, -88, 88) * tw / 180;
    c.fillStyle = '#5fd0ff'; c.beginPath(); c.moveTo(hx, ty - 15); c.lineTo(hx - 6, ty - 24 + 9); c.lineTo(hx + 6, ty - 24 + 9); c.fill();
    text('H', hx, ty - 6, 'center', '#5fd0ff', '800 11px system-ui');
    c.restore();
    c.strokeStyle = ink; c.beginPath(); c.moveTo(W / 2, ty - 18); c.lineTo(W / 2, ty - 10); c.stroke();
    text(`${String(Math.round(hdgDeg) % 360).padStart(3, '0')}°`, W / 2, ty - 28, 'center', ink, '700 12px system-ui');
    // ---- the radar: roads around the drone, the pilot, heading up
    this.radar(c, L, 44, 104, hdgDeg);
    // ---- thermal palette bar
    if (thermal) {
      // a horizontal bar under the buttons, cold on the left (clear of the speed readout and the tilt slider)
      const py = 120, px = W - 220, bw = 150, g = c.createLinearGradient(px + bw, 0, px, 0);
      if (D.cam === 'ironbow') { g.addColorStop(0, '#fffbe0'); g.addColorStop(0.25, '#ffc21a'); g.addColorStop(0.5, '#e0451e'); g.addColorStop(0.75, '#7a1a8c'); g.addColorStop(1, '#05030f'); }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#000000'); }
      c.fillStyle = g; c.fillRect(px, py, bw, 7); c.strokeStyle = dim; c.strokeRect(px, py, bw, 7);
      text('-10°', px - 5, py + 7, 'right', dim, '600 11px system-ui'); text('45°', px + bw + 5, py + 7, 'left', dim, '600 11px system-ui');
    }
  }
  // the temperature under the crosshair (thermal): what the centre ray meets, by what it is
  spotTemp() {
    const T = this.G.thermal; if (T?.spot) return T.spot();
    return 12;
  }
  radar(c, x0, y0, size, hdgDeg) {
    const G = this.G, D = this.D, net = G.net, cx = x0 + size / 2, cy = y0 + size / 2, R = size / 2;
    const scale = R / Math.max(120, Math.min(900, 150 + (D.p.y - (D.groundY ?? D.p.y)) * 2.2));
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = 'rgba(14,20,18,0.62)'; c.fill(); c.clip();
    c.translate(cx, cy); c.rotate(-hdgDeg * Math.PI / 180); c.scale(scale, scale); c.translate(-D.p.x, -D.p.z);
    const Rw = R / scale, seen = new Set();
    for (let gx = Math.floor((D.p.x - Rw) / 50); gx <= Math.floor((D.p.x + Rw) / 50); gx++) for (let gz = Math.floor((D.p.z - Rw) / 50); gz <= Math.floor((D.p.z + Rw) / 50); gz++) {
      const l = net.grid.get(gx * 65536 + gz); if (!l) continue; for (let k = 0; k < l.length; k += 2) seen.add(l[k]);
      if (seen.size > 1500) break;
    }
    c.lineCap = 'round';
    for (const e of seen) {
      if (net.walkCls.has(net.cls[e])) continue;
      const cl = net.classes[net.cls[e]];
      c.strokeStyle = /motorway|trunk/.test(cl) ? '#e0a050' : /primary|secondary/.test(cl) ? '#d8c890' : '#9aa09a';
      c.lineWidth = Math.max(1.2 / scale, net.width[e]);
      c.beginPath(); const s = net.pstart[e], n = net.pcount[e];
      for (let i = 0; i < n; i++) { const x = net.pts[(s + i) * 3], z = net.pts[(s + i) * 3 + 2]; i ? c.lineTo(x, z) : c.moveTo(x, z); }
      c.stroke();
    }
    // the pilot
    const pp = D.pilotPos(); c.fillStyle = '#5fd0ff'; c.beginPath(); c.arc(pp.x, pp.z, 5 / scale, 0, 7); c.fill();
    c.restore();
    // the drone: an arrow, heading up
    c.fillStyle = '#ff8a3a'; c.beginPath(); c.moveTo(cx, cy - 7); c.lineTo(cx - 5, cy + 5); c.lineTo(cx, cy + 2); c.lineTo(cx + 5, cy + 5); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R - 0.5, 0, 7); c.stroke();
  }
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export { MODES };
