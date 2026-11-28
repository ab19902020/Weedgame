// Touch controls + keyboard (the gamepad is read in controller.js).
// On foot: a floating joystick anywhere on the left; drag anywhere else to turn the camera.
// Driving: the left thumb steers, chosen in Settings as on the best mobile racers: a steering wheel you drag
// sideways (proportional, as Real Racing's and CarX's wheels), left and right buttons (as GTA's and Real Racing's
// touch zones: a tap is a small correction, a hold full lock) or tilting the phone. The right thumb works the
// pedals: accelerator and brake, which you can rock between without lifting. Brake held at a standstill engages
// reverse. Drag the free screen to look around. Handling assists (Easy or Realistic) are in carPhysics.js.
const STICK_R = 58, WHEEL_R = 96;
const KEYMAP = { ShiftLeft: 'run', ShiftRight: 'run', KeyF: 'use', Enter: 'use', KeyL: 'beam', KeyH: 'horn', Space: 'brake', KeyM: 'map', KeyN: 'phone', KeyP: 'dev', Backquote: 'dev', KeyC: 'camera', KeyV: 'camera',
  KeyJ: 'hit', KeyK: 'aim', KeyT: 'nextTarget', KeyR: 'reload', KeyX: 'wheel', Digit0: 'weapon0', Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Digit4: 'weapon4', Digit5: 'weapon5', Digit6: 'weapon6', Digit7: 'weapon7', Digit8: 'weapon8', Digit9: 'weapon9', Minus: 'weapon10' };
export class Input {
  constructor(root) {
    this.move = { x: 0, y: 0 }; this.look = { dx: 0, dy: 0 };
    this.held = new Set(); this.pressed = new Set(); this.keys = new Set();
    this.lastLook = 0;
    this.driving = false;               // set by the HUD each frame
    this.steering = 'Steering wheel';   // 'Steering wheel' | 'Buttons' | 'Tilt' (Settings)
    this.assists = 1;                   // handling: 1 Easy, 0 Realistic (Settings)
    this.stick = { id: null, ox: 0, oy: 0 };
    this.wheel = { id: null, ox: 0, x: 0 };
    this.pedal = { id: null, on: null, t: 0 };    // which pedal the right thumb is on
    this.arrows = { l: false, r: false };
    this.tilt = { x: 0, zero: null, live: false };
    this.lookId = null; this.lx = 0; this.ly = 0;
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `<div id="stickRest"></div><div id="stickBase"><div id="stickKnob"></div></div>
      <div id="wheel" hidden><svg viewBox="-50 -50 100 100"><circle r="44" class="rim"/><circle r="9" class="hub"/><path class="spoke" d="M-41,4 L-9,2 M41,4 L9,2 M0,9 L0,41"/><path class="mark" d="M-4,-44 L4,-44"/></svg></div>`;
    root.append(el);
    this.base = el.querySelector('#stickBase'); this.knob = el.querySelector('#stickKnob');
    this.rest = el.querySelector('#stickRest'); this.wheelEl = el.querySelector('#wheel');
    const opts = { passive: false };
    el.addEventListener('pointerdown', e => this.down(e), opts);
    addEventListener('pointermove', e => this.moveEv(e), opts);
    addEventListener('pointerup', e => this.up(e), opts);
    addEventListener('pointercancel', e => this.up(e), opts);
    addEventListener('keydown', e => { if (e.repeat) return; this.keys.add(e.code); const b = KEYMAP[e.code]; if (b) { this.pressed.add(b); this.held.add(b); } });
    addEventListener('keyup', e => { this.keys.delete(e.code); const b = KEYMAP[e.code]; if (b) this.held.delete(b); });
    addEventListener('blur', () => { this.keys.clear(); this.held.clear(); this.release(); });
    // the right mouse button aims (locks on), as in GTA on a PC
    addEventListener('mousedown', e => { if (e.button === 2) { this.pressed.add('aim'); this.held.add('aim'); } });
    addEventListener('mouseup', e => { if (e.button === 2) this.held.delete('aim'); });
    addEventListener('contextmenu', e => { if (!e.target.closest?.('input,textarea')) e.preventDefault(); });
    addEventListener('deviceorientation', e => this.orient(e));
  }
  // ------------------------------------------------------------------ pointers
  down(e) {
    if (e.target.closest('button,.panel,#map,.pedal,.arrow')) return;
    e.preventDefault();
    const left = e.clientX < innerWidth * 0.42;
    if (left && this.driving && this.steering === 'Steering wheel' && this.wheel.id == null) {
      this.wheel = { id: e.pointerId, ox: e.clientX, x: 0 };
      this.placeWheel(e.clientX, e.clientY);
    } else if (left && !this.driving && this.stick.id == null) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.base.style.display = 'block'; this.rest.style.opacity = 0;
      this.base.style.left = (e.clientX - 64) + 'px'; this.base.style.top = (e.clientY - 64) + 'px';
      this.knob.style.transform = 'translate(0px,0px)';
    } else if (this.lookId == null) {
      this.lookId = e.pointerId; this.lx = e.clientX; this.ly = e.clientY;
    }
  }
  moveEv(e) {
    if (e.pointerId === this.stick.id) {
      e.preventDefault();
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const r = Math.hypot(dx, dy);
      // past the rim the base follows the thumb, so a stick dragged too far never goes dead
      if (r > STICK_R) { const k = (r - STICK_R) / r; this.stick.ox += dx * k; this.stick.oy += dy * k; dx *= STICK_R / r; dy *= STICK_R / r; this.base.style.left = (this.stick.ox - 64) + 'px'; this.base.style.top = (this.stick.oy - 64) + 'px'; }
      const m = Math.hypot(dx, dy) / STICK_R, dead = 0.08, s = m < dead ? 0 : (m - dead) / (1 - dead) / (m || 1);
      this.move.x = dx / STICK_R * s * (m || 1); this.move.y = dy / STICK_R * s * (m || 1);
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === this.wheel.id) {
      e.preventDefault();
      let dx = e.clientX - this.wheel.ox;
      if (Math.abs(dx) > WHEEL_R) { this.wheel.ox += dx - Math.sign(dx) * WHEEL_R; dx = Math.sign(dx) * WHEEL_R; }
      const n = dx / WHEEL_R;
      // a little expo: fine corrections near the centre, full lock at the edge
      this.wheel.x = Math.sign(n) * (0.45 * Math.abs(n) + 0.55 * n * n);
    } else if (e.pointerId === this.pedal.id) {
      e.preventDefault(); this.pedalAt(e.clientX, e.clientY);
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.look.dx += e.clientX - this.lx; this.look.dy += e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY; this.lastLook = performance.now();
    } else if (this.btnLook && e.pointerId === this.btnLook.id) {
      // a thumb sliding on Fire or Aim (bindButton, bindAim): past 9 px it turns the view
      const L = this.btnLook;
      if (!L.live && Math.hypot(e.clientX - L.x0, e.clientY - L.y0) > 9) { L.live = true; L.x = e.clientX; L.y = e.clientY; }
      if (L.live) { this.look.dx += e.clientX - L.x; this.look.dy += e.clientY - L.y; L.x = e.clientX; L.y = e.clientY; this.lastLook = performance.now(); }
    }
  }
  up(e) {
    if (e.pointerId === this.stick.id) { this.stick.id = null; this.move.x = this.move.y = 0; this.base.style.display = 'none'; this.rest.style.opacity = ''; }
    if (e.pointerId === this.wheel.id) { this.wheel.id = null; this.wheel.x = 0; this.placeWheel(); }
    if (e.pointerId === this.pedal.id) this.setPedal(null);
    if (e.pointerId === this.lookId) this.lookId = null;
  }
  release() {
    this.stick.id = null; this.lookId = null; this.btnLook = null; this.aimLatch = false; this.move.x = this.move.y = 0; this.base.style.display = 'none'; this.rest.style.opacity = '';
    this.wheel.id = null; this.wheel.x = 0; this.setPedal(null); this.arrows.l = this.arrows.r = false; this.placeWheel();
  }
  // the wheel sits where the thumb lands, or at rest in the corner
  placeWheel(x, y) {
    const w = this.wheelEl.style;
    if (x == null) { w.left = ''; w.top = ''; w.bottom = ''; this.wheelEl.classList.remove('live'); return; }
    w.left = (x - 70) + 'px'; w.top = (y - 70) + 'px'; w.bottom = 'auto'; this.wheelEl.classList.add('live');
  }
  // ------------------------------------------------------------------ pedals (HUD elements with class .pedal)
  bindPedals(gas, brake) {
    this.pedals = { gas, brake };
    for (const el of [gas, brake]) el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (this.pedal.id != null && this.pedal.id !== e.pointerId) { this.extra = { id: e.pointerId, on: el === gas ? 'gas' : 'brake' }; this.light(); return; }
      this.pedal.id = e.pointerId; this.pedalAt(e.clientX, e.clientY);
    }, { passive: false });
    // a second thumb on the other pedal (left-foot braking) lifts when it's released
    addEventListener('pointerup', e => { if (this.extra?.id === e.pointerId) { this.extra = null; this.light(); } });
    addEventListener('pointercancel', e => { if (this.extra?.id === e.pointerId) { this.extra = null; this.light(); } });
  }
  pedalAt(x, y) {
    // whichever pedal is nearest the thumb (generous: you can slide off the edge a little)
    let best = null, bd = 1e9;
    for (const [k, el] of Object.entries(this.pedals || {})) {
      const r = el.getBoundingClientRect(), dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = k; }
    }
    this.setPedal(bd < 46 ? best : null, true);
  }
  setPedal(on, keep) {
    if (on !== this.pedal.on) { this.pedal.on = on; this.pedal.t = performance.now(); if (on) try { navigator.vibrate?.(8); } catch { /* no haptics */ } }
    if (!keep && !on) this.pedal.id = null;
    this.light();
  }
  light() {
    if (!this.pedals) return;
    for (const k of ['gas', 'brake']) this.pedals[k].classList.toggle('on', this.pedal.on === k || this.extra?.on === k);
  }
  bindArrows(l, r) {
    for (const [el, k] of [[l, 'l'], [r, 'r']]) {
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.arrows[k] = true; el.classList.add('on'); el.setPointerCapture?.(e.pointerId); }, { passive: false });
      const off = () => { this.arrows[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    }
  }
  // ------------------------------------------------------------------ tilt steering
  orient(e) {
    if (e.beta == null) return;
    const ang = (screen.orientation?.angle ?? window.orientation ?? 90);
    // landscape: turning the phone like a wheel rolls it about the screen's long axis
    const a = ang === 90 ? e.beta : ang === 270 || ang === -90 ? -e.beta : e.gamma;
    if (this.tilt.zero == null) this.tilt.zero = 0;
    this.tilt.raw = a; this.tilt.live = true;
  }
  calibrateTilt() { if (this.tilt.raw != null) this.tilt.zero = this.tilt.raw; }
  // ------------------------------------------------------------------ queries
  // merged movement vector (stick + keys + pad), y forward-negative like screen space
  axis() {
    let x = this.move.x + (this.padX || 0), y = this.move.y + (this.padY || 0);
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  // driving: accelerator, brake and steering stay independent
  driveControls(dt = 1 / 60) {
    const k = this.keys;
    // the wheel: a light filter (about 50 ms) takes the jitter of a thumb out without making it feel late
    this._wheel = (this._wheel ?? 0) + (this.wheel.x - (this._wheel ?? 0)) * (dt > 0 ? Math.min(1, dt * 20) : 0);
    if (this.wheel.id == null && this.wheel.x === 0 && Math.abs(this._wheel) < 0.01) this._wheel = 0;
    let steer = this._wheel + (this.padX || 0);
    if (this.steering === 'Buttons' || this.arrows.l || this.arrows.r) {
      // buttons ease in over a quarter second, so a tap is a small correction and a hold is full lock; let go and
      // the wheel comes straight back to centre
      const want = (this.arrows.r ? 1 : 0) - (this.arrows.l ? 1 : 0), cur = this._arrow || 0;
      const rate = !want || Math.sign(want) !== Math.sign(cur) ? 9 : 4;
      this._arrow = cur + Math.max(-dt * rate, Math.min(dt * rate, want - cur));
      if (!want && Math.abs(this._arrow) < 0.02) this._arrow = 0;
      steer += this._arrow;
    }
    if (this.steering === 'Tilt' && this.tilt.live) {
      const a = (this.tilt.raw - (this.tilt.zero || 0)) / 24, d = 0.06;
      steer += Math.sign(a) * Math.max(0, Math.min(1, (Math.abs(a) - d) / (1 - d)));
    }
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    let gas = Math.max(0, -(this.padY || 0)), brake = Math.max(0, this.padY || 0);
    if (k.has('KeyW') || k.has('ArrowUp')) gas = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brake = 1;
    const on = this.pedal.on, ex = this.extra?.on;
    // the accelerator squeezes in over a quarter second (a quick dab is a gentle push); the brake bites at once
    if (on === 'gas' || ex === 'gas') gas = Math.max(gas, Math.min(1, 0.55 + (performance.now() - this.pedal.t) / 1000 * 1.8));
    if (on === 'brake' || ex === 'brake') brake = 1;
    // legacy: the stick still drives (gamepad left stick, the on-foot stick held while getting in)
    if (this.move.y < -0.2) gas = Math.max(gas, -this.move.y); else if (this.move.y > 0.2) brake = Math.max(brake, this.move.y);
    steer += this.move.x;
    return { steer: Math.max(-1, Math.min(1, steer)), gas: Math.min(1, gas), brake: Math.min(1, brake) };
  }
  // older callers: throttle on -y
  driveAxis() { const c = this.driveControls(); return { x: c.steer, y: c.brake - c.gas }; }
  takeLook() { const d = { dx: this.look.dx, dy: this.look.dy }; this.look.dx = this.look.dy = 0; if (this.keys.has('KeyQ')) d.dx -= 6; if (this.keys.has('KeyE')) d.dx += 6; return d; }
  consume(name) { const has = this.pressed.has(name); this.pressed.delete(name); return has; }
  // on-screen button wiring
  // look: a thumb kept on the button and slid turns the view (and the crosshair) as on a mobile shooter's fire
  // button, once it has moved a little (so a tap never nudges the aim)
  bindButton(btn, name, hold = false, look = false) {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); this.pressed.add(name); if (hold) this.held.add(name); btn.classList.add('on'); try { btn.setPointerCapture?.(e.pointerId); } catch { /* not a live pointer */ }
      if (look) this.btnLook = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false };
      try { navigator.vibrate?.(6); } catch { /* no haptics */ }
    });
    const off = e => { if (hold) this.held.delete(name); btn.classList.remove('on'); if (this.btnLook?.id === e.pointerId) this.btnLook = null; };
    btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('lostpointercapture', off);
  }
  // Aim (touch): held, the gun is up while the thumb stays on it (and sliding it aims); a quick tap keeps it up
  // until the next tap (aimLatch), leaving the thumb free to drag the view and fire. combat.js clears the latch
  // when the gun is put away or you get in a car.
  bindAim(btn) {
    let downT = 0, was = false;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); downT = performance.now(); was = !!this.aimLatch; this.aimLatch = false;
      this.pressed.add('aim'); this.held.add('aim'); try { btn.setPointerCapture?.(e.pointerId); } catch { /* not a live pointer */ }
      this.btnLook = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false };
      try { navigator.vibrate?.(6); } catch { /* no haptics */ }
    });
    const off = e => {
      if (!this.held.has('aim')) return;
      this.held.delete('aim'); if (this.btnLook?.id === e.pointerId) this.btnLook = null;
      if (e.type === 'pointerup' && performance.now() - downT < 260 && !was) this.aimLatch = true;
    };
    btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('lostpointercapture', off);
  }
}
