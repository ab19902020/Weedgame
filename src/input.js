// Landscape touch controls + keyboard. Left half: floating joystick. Right half: drag to orbit.
export class Input {
  constructor(root) {
    this.move = { x: 0, y: 0 }; this.look = { dx: 0, dy: 0 };
    this.held = new Set(); this.pressed = new Set(); this.keys = new Set();
    this.lastLook = 0;
    this.stick = { id: null, ox: 0, oy: 0 };
    this.lookId = null; this.lx = 0; this.ly = 0;
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `<div id="stickBase"><div id="stickKnob"></div></div>`;
    root.append(el);
    this.base = el.querySelector('#stickBase'); this.knob = el.querySelector('#stickKnob');
    const opts = { passive: false };
    el.addEventListener('pointerdown', e => this.down(e), opts);
    addEventListener('pointermove', e => this.moveEv(e), opts);
    addEventListener('pointerup', e => this.up(e), opts);
    addEventListener('pointercancel', e => this.up(e), opts);
    addEventListener('keydown', e => { if (e.repeat) return; this.keys.add(e.code); const b = KEYMAP[e.code]; if (b) { this.pressed.add(b); this.held.add(b); } });
    addEventListener('keyup', e => { this.keys.delete(e.code); const b = KEYMAP[e.code]; if (b) this.held.delete(b); });
    addEventListener('blur', () => { this.keys.clear(); this.held.clear(); this.release(); });
  }
  down(e) {
    if (e.target.closest('button,.panel,#map')) return;
    e.preventDefault();
    const w = innerWidth;
    if (e.clientX < w * 0.42 && this.stick.id == null) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.base.style.display = 'block';
      this.base.style.left = (e.clientX - 60) + 'px'; this.base.style.top = (e.clientY - 60) + 'px';
      this.knob.style.transform = 'translate(0px,0px)';
    } else if (this.lookId == null) {
      this.lookId = e.pointerId; this.lx = e.clientX; this.ly = e.clientY;
    }
  }
  moveEv(e) {
    if (e.pointerId === this.stick.id) {
      e.preventDefault();
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const r = Math.hypot(dx, dy), max = 55;
      if (r > max) { dx *= max / r; dy *= max / r; }
      this.move.x = dx / max; this.move.y = dy / max;
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.look.dx += e.clientX - this.lx; this.look.dy += e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY; this.lastLook = performance.now();
    }
  }
  up(e) {
    if (e.pointerId === this.stick.id) { this.stick.id = null; this.move.x = this.move.y = 0; this.base.style.display = 'none'; }
    if (e.pointerId === this.lookId) this.lookId = null;
  }
  release() { this.stick.id = null; this.lookId = null; this.move.x = this.move.y = 0; this.base.style.display = 'none'; }
  // merged movement vector (stick + keys), y forward-negative like screen space
  axis() {
    let x = this.move.x+(this.padX||0), y = this.move.y+(this.padY||0);
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  takeLook() { const d = { dx: this.look.dx, dy: this.look.dy }; this.look.dx = this.look.dy = 0; if (this.keys.has('KeyQ')) d.dx -= 6; if (this.keys.has('KeyE')) d.dx += 6; return d; }
  consume(name) { const has = this.pressed.has(name); this.pressed.delete(name); return has; }
  // on-screen button wiring
  bindButton(btn, name, hold = false) {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.pressed.add(name); if (hold) this.held.add(name); btn.classList.add('on'); btn.setPointerCapture?.(e.pointerId); });
    const off = e => { if (hold) this.held.delete(name); btn.classList.remove('on'); };
    btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('lostpointercapture', off);
  }
}
const KEYMAP = { ShiftLeft: 'run', ShiftRight: 'run', KeyF: 'use', Enter: 'use', KeyH: 'horn', Space: 'brake', Tab: 'swap', KeyM: 'map', KeyP: 'dev', Backquote: 'dev', KeyC: 'camera', KeyV: 'camera' };
