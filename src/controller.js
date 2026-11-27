// PlayStation controller (DualShock 4 / DualSense, or any pad with the standard mapping), laid out as GTA V:
//   on foot   left stick move (L3 —), right stick camera (R3 camera behind), Cross sprint, Square jump,
//             Triangle enter / exit a vehicle and every interaction, Circle reload (melee with no gun), R2 fire /
//             attack, L2 aim (flick the right stick to switch target), L1 weapon wheel (hold, point a stick,
//             let go), R1 pick up, D-pad down switch brother, D-pad up map, touchpad map, Options pause
//   driving   R2 accelerate, L2 brake / reverse, R1 handbrake (Cross too), L3 horn, Triangle get out,
//             D-pad right headlights / full beam, touchpad camera, D-pad down switch brother
//   menus     D-pad or left stick move between buttons (any direction), Cross choose, Circle back, Options close;
//             on the map: left stick pans, L1 / R1 zoom, Triangle drops a waypoint
//   pointer   the pub games and the console games in the living room get a pointer on the left stick:
//             Cross is a click (hold and move to drag: aim a dart, line up a cue), Triangle Enter, Circle Escape,
//             D-pad the arrow keys, Options leaves
// Rumble and the DualSense's triggers: haptics.js.
import { Mesh, BoxGeometry, MeshStandardMaterial } from 'three/webgpu';

const X = 0, O = 1, SQ = 2, TRI = 3, L1 = 4, R1 = 5, L2 = 6, R2 = 7, SHARE = 8, OPT = 9, L3 = 10, R3 = 11, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15, PS = 16, PAD = 17;
const dz = x => Math.sign(x) * Math.max(0, Math.abs(x) - 0.14) / 0.86;
const KEYS = { [UP]: ['ArrowUp', 38], [DOWN]: ['ArrowDown', 40], [LEFT]: ['ArrowLeft', 37], [RIGHT]: ['ArrowRight', 39], [TRI]: ['Enter', 13], [O]: ['Escape', 27] };

export class Controller {
  constructor(G) { this.G = G; this.previous = []; this.items = []; this.bags = [0, 0]; this.rep = 0; this.lastDir = null; this.cur = { x: innerWidth / 2, y: innerHeight / 2, el: null, down: false }; }
  pad() {
    const list = navigator.getGamepads?.() || [];
    for (const p of list) if (p && p.connected && p.mapping === 'standard') return p;
    return null;
  }
  poll(dt) {
    const G = this.G, I = G.input, H = G.hud, M = H.menu;
    const pad = this.pad();
    const buttons = pad ? pad.buttons.map(b => b.pressed) : [], tap = n => buttons[n] && !this.previous[n], up = n => !buttons[n] && this.previous[n];
    const axis = n => dz(pad?.axes[n] || 0);
    const car = !!G.brothers.me.vehicle;
    I.padX = 0; I.padY = 0; I.padRun = false; I.padBrake = false; I.padHorn = false; this.padFire = false; this.padAim = false;
    G.padActive = !!pad;
    if (!pad) { this.showCursor(false); this.previous = []; return; }
    // ---- a game in the living room or the pub: a pointer
    const frame = document.querySelector('#homeTV.playing iframe'), pub = document.getElementById('gamePanel');
    if (frame || pub) { this.pointer(dt, pad, tap, up, axis, frame, pub); this.previous = buttons; return; }
    this.showCursor(false);
    // ---- Options: the pause menu (it closes any other panel first)
    if (tap(OPT) || tap(PS)) {
      if (!M.el.hidden) M.close(); else if (!H.el('map').hidden) H.toggleMap(false); else M.open();
      this.previous = buttons; return;
    }
    // ---- menus and panels
    const panel = this.panel();
    if (panel) { this.menu(dt, panel, pad, tap, axis); this.previous = buttons; return; }
    // ---- radio wheel: left D-pad opens, right stick or D-pad chooses, Cross confirms.
    if(G.radio?.opened){
      const x=axis(2),y=axis(3);if(Math.hypot(x,y)>.4)G.radio.select(x<-.35?'off':y<0?'music':'podcast');
      if(tap(UP))G.radio.select('music');if(tap(DOWN))G.radio.select('podcast');if(tap(LEFT))G.radio.select('off');
      if(tap(X)){G.radio.tune(G.radio.selected);G.radio.close();}else if(tap(O))G.radio.close();
      if(tap(L1))G.radio.skip(-1);if(tap(R1))G.radio.skip(1);
      this.previous=buttons;return;
    }
    if(tap(LEFT)&&G.radio?.device()){G.radio.toggle();this.previous=buttons;return;}
    // ---- weapon wheel: L1 held, a stick points at the weapon, let go to take it
    if (H.wheelOpen) { this.wheel(tap, up, axis, buttons); this.previous = buttons; return; }
    // ---- playing
    I.padX = axis(0);
    I.look.dx += axis(2) * dt * 260; I.look.dy += axis(3) * dt * 200;
    if (tap(TRI)) I.pressed.add('use');
    if (tap(DOWN)) I.pressed.add('swap');
    if (tap(UP) || tap(SHARE)) H.toggleMap(true);
    if (car) {
      I.padY = (pad.buttons[L2]?.value || 0) - (pad.buttons[R2]?.value || 0);
      I.padBrake = buttons[R1] || buttons[X];
      I.padHorn = buttons[L3];
      if (tap(L3)) I.pressed.add('horn');
      if (tap(RIGHT)) I.pressed.add('beam');
      if (tap(PAD)) I.pressed.add('camera');
    } else {
      I.padY = axis(1);
      I.padRun = buttons[X];
      if (tap(PAD)) H.toggleMap(true);
      if (tap(SQ)) I.pressed.add('jump');
      const w = G.combat?.status?.(), gun = w && !w.melee;
      // Circle: reload with a gun in hand, a punch or a slash without
      if (tap(O)) I.pressed.add(gun ? 'reload' : 'hit');
      if (tap(R2)) I.pressed.add('hit');
      this.padFire = !!buttons[R2];
      this.padAim = !!buttons[L2];
      if (tap(L1)) { I.pressed.add('wheel'); this.wheelPick = null; }
      if (tap(R1)) I.pressed.add('pickup');
      // aiming: a flick of the right stick (or R3) moves the lock to the next target
      const rx = axis(2), flick = this.padAim && Math.abs(rx) > 0.85 && !this.flicked;
      this.flicked = this.padAim && Math.abs(rx) > 0.5;
      if (flick || (this.padAim && tap(R3))) I.pressed.add('nextTarget');
      else if (tap(R3)) G.brothers.cam.yaw = G.brothers.me.heading + Math.PI;
      if (tap(LEFT) || tap(RIGHT)) G.brothers.cam.yaw += (tap(LEFT) ? -1 : 1) * Math.PI / 2;
    }
    this.previous = buttons;
  }
  // the panel the controller is in, if any (topmost first)
  panel() {
    const G = this.G, H = G.hud, M = H.menu, vis = e => e && e.isConnected && !e.hidden && e.getClientRects().length > 0;   // (fixed panels have no offsetParent)
    const tv = document.getElementById('homeTV');
    if (vis(tv)) return tv;
    if (G.interiors?.food?.panel) return G.interiors.food.panel;
    if (!M.el.hidden) return M.el;
    if (!H.el('map').hidden) return H.el('map');
    if (!H.el('dev').hidden) return H.el('dev');
    const other = [...document.querySelectorAll('[data-pad="menu"]')].find(vis);
    return other || null;
  }
  // move between the panel's buttons in the direction pushed (D-pad, or the left stick with repeat)
  menu(dt, panel, pad, tap, axis) {
    const G = this.G, H = G.hud, M = H.menu, isMap = panel === H.el('map');
    const list = [...panel.querySelectorAll('button,select,input,[tabindex]')].filter(e => e.offsetWidth && !e.disabled);
    let el = list.includes(document.activeElement) ? document.activeElement : null;
    // a panel that has just opened (or changed its buttons) starts on its first button
    if (!el && list.length && !isMap) { this.focus(list[0]); el = list[0]; }
    const sx = isMap ? 0 : axis(0), sy = isMap ? 0 : axis(1);
    let dir = tap(UP) ? [0, -1] : tap(DOWN) ? [0, 1] : tap(LEFT) ? [-1, 0] : tap(RIGHT) ? [1, 0] : null;
    if (!dir && Math.hypot(sx, sy) > 0.6) {
      const d = Math.abs(sx) > Math.abs(sy) ? [Math.sign(sx), 0] : [0, Math.sign(sy)], key = d.join();
      this.rep -= dt;
      if (key !== this.lastDir || this.rep <= 0) { dir = d; this.rep = key !== this.lastDir ? 0.38 : 0.12; this.lastDir = key; }
    } else if (!dir) { this.lastDir = null; }
    if (isMap && dir?.[0] && (!el || el.closest('.placeDetail'))) {
      H.el(dir[0] < 0 ? 'mPrev' : 'mNext').click();
      dir = null;
    }
    if (el?.tagName === 'SELECT' && dir && dir[1] === 0) {
      el.selectedIndex = (el.selectedIndex + dir[0] + el.length) % el.length; el.dispatchEvent(new Event('change')); dir = null;
    }
    if (dir) {
      const next = el ? this.nearest(el, list, dir) : list[0];
      if (next && next !== el) { this.focus(next); G.haptics?.tick(); }
    }
    el = list.includes(document.activeElement) ? document.activeElement : null;
    if (tap(X)) { (el || list[0])?.click(); G.haptics?.select(); }
    if (tap(O)) {
      if (panel === M.el) { const back = M.el.querySelector('.preferences button'); if (back?.offsetWidth) back.click(); else M.close(); }
      else if (isMap) H.toggleMap(false);
      else if (panel === H.el('dev')) H.toggleDev();
      else if (panel === G.interiors?.food?.panel) G.interiors.food.close();
      else {
        const back = list.find(b => /^(Back|TV menu|Return to console|Leave|Close|Cancel)$/i.test(b.textContent.trim())) || list.find(b => /^(Stand up|Turn TV off)$/i.test(b.textContent.trim()));
        back?.click();
      }
    }
    if (isMap) {
      if (tap(L2)) H.el('mPrev').click();
      if (tap(R2)) H.el('mNext').click();
      H.mapView.x += axis(0) * dt * 450 / H.mapView.s; H.mapView.z += axis(1) * dt * 450 / H.mapView.s;
      if (tap(L1) || tap(R1)) H.zoomMap(tap(L1) ? 0.7 : 1.4);
      if (tap(TRI)) { const { x, z } = H.mapView; H.nav.set({ x, z, name: G.roadName(x, z) || 'Dropped pin' }); }
    }
  }
  nearest(from, list, [dx, dy]) {
    const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bs = Infinity;
    for (const e of list) {
      if (e === from) continue;
      const q = e.getBoundingClientRect(), ex = q.left + q.width / 2 - cx, ey = q.top + q.height / 2 - cy;
      const along = ex * dx + ey * dy, across = Math.abs(ex * dy - ey * dx);
      if (along <= 4) continue;
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = e; }
    }
    // nothing that way: wrap round to the far end of the row or column
    if (!best) { const far = list.filter(e => e !== from).sort((a, b) => { const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(); return ((A.left - B.left) * dx + (A.top - B.top) * dy); }); best = far[0] || null; }
    return best;
  }
  focus(el) {
    document.querySelectorAll('.pad-focus').forEach(e => e.classList.remove('pad-focus'));
    el.classList.add('pad-focus'); el.focus({ preventScroll: false }); el.scrollIntoView?.({ block: 'nearest' });
  }
  // the weapon wheel: whichever weapon the stick points at lights up; letting go of L1 (or Cross) takes it
  wheel(tap, up, axis, buttons) {
    const G = this.G, H = G.hud, ring = H.el('wheel').querySelector('.ring'), btns = [...ring.querySelectorAll('button')];
    let x = axis(2), y = axis(3); if (Math.hypot(x, y) < 0.5) { x = axis(0); y = axis(1); }
    if (Math.hypot(x, y) > 0.5) {
      const a = Math.atan2(y, x), r = ring.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let best = null, bd = 9;
      for (const b of btns) { const q = b.getBoundingClientRect(), ba = Math.atan2(q.top + q.height / 2 - cy, q.left + q.width / 2 - cx), d = Math.abs(Math.atan2(Math.sin(ba - a), Math.cos(ba - a))); if (d < bd) { bd = d; best = b; } }
      if (best && best !== this.wheelPick) {
        this.wheelPick = best; btns.forEach(b => b.classList.toggle('on', b === best));
        H.el('wheel').querySelector('.wName').textContent = best.querySelector('b').textContent; G.haptics?.tick();
      }
    }
    const take = () => { if (this.wheelPick) { G.combat?.select(this.wheelPick.dataset.k || null); G.haptics?.select(); } H.toggleWheel(false); this.wheelPick = null; };
    if (up(L1) || tap(X)) take();
    else if (tap(O)) { H.toggleWheel(false); this.wheelPick = null; }
  }
  // ---- a pointer for the games on canvases and in the console (left stick moves it, Cross clicks and drags)
  showCursor(on) {
    let c = this.cursorEl;
    if (!on) { if (c) c.hidden = true; return; }
    if (!c) { c = this.cursorEl = document.createElement('div'); c.id = 'padCursor'; document.body.append(c); }
    c.hidden = false; c.style.transform = `translate(${this.cur.x}px,${this.cur.y}px)`;
  }
  pointer(dt, pad, tap, up, axis, frame, pub) {
    const cur = this.cur, sp = 900 * dt, lx = axis(0), ly = axis(1);
    cur.x = Math.max(0, Math.min(innerWidth - 1, cur.x + Math.sign(lx) * lx * lx * sp + (pad.buttons[RIGHT]?.pressed && !frame ? sp * 0.4 : 0) - (pad.buttons[LEFT]?.pressed && !frame ? sp * 0.4 : 0)));
    cur.y = Math.max(0, Math.min(innerHeight - 1, cur.y + Math.sign(ly) * ly * ly * sp + (pad.buttons[DOWN]?.pressed && !frame ? sp * 0.4 : 0) - (pad.buttons[UP]?.pressed && !frame ? sp * 0.4 : 0)));
    this.showCursor(true);
    // where the pointer is: inside the console's page, or on the main page
    let doc = document, win = window, px = cur.x, py = cur.y;
    if (frame) {
      const r = frame.getBoundingClientRect();
      if (cur.x >= r.left && cur.x < r.right && cur.y >= r.top && cur.y < r.bottom && frame.contentDocument) { doc = frame.contentDocument; win = frame.contentWindow; px = cur.x - r.left; py = cur.y - r.top; }
    }
    const target = doc.elementFromPoint(px, py) || doc.body;
    const fire = (type, el = target) => {
      const P = win.PointerEvent || win.MouseEvent, o = { bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: cur.down ? 1 : 0, view: win };
      if (el.setPointerCapture && !el._padCap) { el._padCap = true; const real = el.setPointerCapture; el.setPointerCapture = id => { try { real.call(el, id); } catch {} }; }
      el.dispatchEvent(new P('pointer' + type, o));
      el.dispatchEvent(new win.MouseEvent('mouse' + type, o));
    };
    if (tap(X)) { cur.down = true; cur.el = target; fire('down'); if (target.focus) target.focus(); }
    else if (cur.down && (lx || ly)) fire('move', cur.el && cur.el.isConnected ? cur.el : target);
    if (up(X) && cur.down) {
      cur.down = false; const el = cur.el && cur.el.isConnected ? cur.el : target; fire('up', el);
      if (el === target || el.contains?.(target)) target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: px, clientY: py, view: win }));
      this.G.haptics?.tick();
    }
    // keys for the console games (the football manager plays by Enter and Escape and the arrows)
    if (frame?.contentDocument) for (const [b, [key, code]] of Object.entries(KEYS)) {
      const n = +b, d = frame.contentDocument, t = d.activeElement || d.body;
      if (tap(n)) t.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key, keyCode: code, which: code, bubbles: true }));
      if (up(n)) t.dispatchEvent(new frame.contentWindow.KeyboardEvent('keyup', { key, keyCode: code, which: code, bubbles: true }));
    }
    // the right stick scrolls whatever's under the pointer
    const sy = axis(3);
    if (Math.abs(sy) > 0.2) { let s = target; while (s && s !== doc.body && !(s.scrollHeight > s.clientHeight + 4)) s = s.parentElement; (s || doc.scrollingElement)?.scrollBy?.(0, sy * 900 * dt); }
    // Options: back out of the game
    if (tap(OPT) || tap(PS)) {
      if (frame) [...document.querySelectorAll('#homeTV button')].find(b => /Return to console/.test(b.textContent))?.click();
      else pub?.querySelector('.gp-x')?.click();
    }
  }
  actions(dt){
    const G=this.G,B=G.brothers,a=B.actor[B.active],me=B.me,I=G.input;
    if(!this.items.length && !G._needGround){
      const geo=new BoxGeometry(.36,.24,.28),mat=new MeshStandardMaterial({color:0xb38b5b});
      for(const offset of [1.6,3.2]){
        const box=new Mesh(geo,mat);box.position.set(me.x+offset,me.y+.12,me.z);G.scene.add(box);this.items.push(box);
      }
    }
    const jump=I.consume('jump'),hit=I.consume('hit'),pickup=I.consume('pickup');
    // Hit punches, slashes or fires (combat.js); held, it keeps an automatic firing
    this.hitPressed=hit&&!me.vehicle;this.hitHeld=!me.vehicle&&(I.held.has('hit')||this.padFire);
    if(me.vehicle)return;
    if(jump && !(a.jumpTime>0) && !me.swimming)a.jumpTime=.68;
    if(a.jumpTime>0){a.jumpTime=Math.max(0,a.jumpTime-dt);const t=1-a.jumpTime/.68;a.y=me.y+3.2*t*(1-t);}
    if(pickup){
      const item=this.items.find(o=>o.visible && Math.hypot(o.position.x-me.x,o.position.z-me.z)<2.3);
      if(item){item.visible=false;this.bags[B.active]++;}G.hud.toast(item?'Parcel picked up':'No parcel within reach');
    }
  }
}
