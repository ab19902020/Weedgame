// How the game feels in the hands on a PlayStation controller (DualShock 4 or DualSense), or any other pad.
// Rumble: every gunshot (heavier for shotguns and rifles), punches and kicks that land, crashes by how hard, the
// engine pulling hard, gravel and grass under the tyres, the weapon wheel and menus ticking. It goes to the pad
// through the browser's gamepad rumble where there is one, or through the Android app (GCNative.rumble: the
// controller's own motors over Bluetooth or USB).
// Adaptive triggers (DualSense only): connected over WebHID in a desktop Chrome or Edge (Settings → "DualSense
// triggers"), the triggers push back. Aiming a gun, L2 has a soft stop; R2 has a break you squeeze through like a
// real trigger (a heavy one for a shotgun or a rifle); driving, R2 stiffens with speed and L2 firms up under the
// brakes. The lightbar shows the brother you're playing, and flashes red and blue in a police pursuit.
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

export class Haptics {
  constructor(G) {
    this.G = G; this.on = true; this.ds = null; this.t = 0; this.cont = 0; this.lastTrig = '';
    G.events?.on('impact', e => { if (e.v === G.brothers?.vehicleOf?.(G.brothers.me)) this.crash(e.speed); });
    G.events?.on('vehicleHit', e => { const mine = G.brothers?.vehicleOf?.(G.brothers.me); if (e.by === mine || e.other === mine) this.crash(e.speed); });
    G.events?.on('pedHit', e => { if (e.v === G.brothers?.vehicleOf?.(G.brothers.me)) this.rumble(0.5, 0.4, 140); });
  }
  pad() {
    const list = navigator.getGamepads?.() || [];
    for (const p of list) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of list) if (p && p.connected) return p;
    return null;
  }
  // a burst on both motors (strong: the low, heavy motor; weak: the high, buzzy one), 0..1 for ms milliseconds
  rumble(strong, weak, ms) {
    if (!this.on) return;
    strong = clamp01(strong); weak = clamp01(weak);
    const pad = this.pad();
    if (this.ds) this.ds.motors(strong, weak, ms);
    if (!pad) return;
    const act = pad.vibrationActuator;
    if (act?.playEffect) { act.playEffect(act.effects?.includes?.('dual-rumble') === false ? act.effects[0] : 'dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); return; }
    try { window.GCNative?.rumble?.(strong, weak, ms | 0); } catch {}
  }
  // the moments
  shot(w) {
    const heavy = w.pellets ? 1 : w.hold === 'rifle' ? 0.75 : w.bolt ? 0.9 : 0.45;
    this.rumble(0.35 + heavy * 0.6, 0.6 + heavy * 0.3, 70 + heavy * 90);
    this.ds?.kick(heavy);
  }
  hit(kick) { this.rumble(kick ? 0.7 : 0.45, kick ? 0.5 : 0.35, kick ? 120 : 80); }
  crash(speed) { const k = clamp01((speed - 1.5) / 14); if (k > 0) this.rumble(0.3 + 0.7 * k, 0.2 + 0.6 * k, 120 + 260 * k); }
  tick() { this.rumble(0, 0.18, 22); }
  select() { this.rumble(0.2, 0.3, 45); }
  // continuous feel, every frame: the road and the engine through the motors, the triggers' resistance, the lightbar
  update(dt) {
    if (!this.on) return;
    const G = this.G, B = G.brothers; if (!B) return;
    const me = B.me, car = B.vehicleOf?.(me);
    this.t += dt; this.cont -= dt;
    if (car && this.cont <= 0) {
      this.cont = 0.11;
      const ph = car.ph || {}, sp = Math.abs(car.sp ?? car.v ?? 0), thr = ph.thr || 0;
      // a low hum pulling hard from slow, a buzz on gravel and grass, a judder when the tyres let go
      const engine = thr > 0.6 && sp < 14 ? 0.08 + 0.1 * thr : 0, rough = ph.soft ? clamp01(sp / 20) * 0.22 : 0, slip = clamp01((ph.slip || 0) - 0.3) * 0.35;
      if (engine + rough + slip > 0.04) this.rumble(engine + slip, rough + slip * 0.6, 140);
    }
    const ds = this.ds; if (!ds) return;
    // triggers: what the hands are on
    let R = 'off', L = 'off';
    const w = G.combat?.status?.(), aiming = !car && w && !w.melee && (G.input?.held?.has('aim') || G.input?.aimLatch || G.controller?.padAim);
    const fishing = G.fishing?.active;
    if (fishing) {
      // the reel: R2 stiffens as the line comes tight (and when the clutch is giving line); L2 a soft stop for the lift
      const st = G.fishing.status(), k = clamp01(st.tension / Math.max(1, st.line));
      R = 'reel' + Math.min(5, Math.round(k * 6)); L = st.state === 'fight' || st.state === 'netting' ? 'aim' : 'off';
    } else if (aiming) { L = 'aim'; R = w.pellets || w.bolt ? 'heavy' : w.hold === 'rifle' ? 'rifle' : 'pistol'; }
    else if (car) {
      const sp = Math.abs(car.sp ?? car.v ?? 0);
      R = 'gas' + Math.min(5, Math.floor(sp / 7)); L = (car.ph?.slip || 0) > 0.5 ? 'abs' : 'brake';
    }
    const key = R + '|' + L;
    if (key !== this.lastTrig || ds.kickT > 0) { this.lastTrig = key; ds.triggers(R, L); }
    ds.kickT = Math.max(0, ds.kickT - dt);
    // lightbar: the brother's colour; red and blue in a pursuit
    const P = G.police?.player, chase = P && P.state && P.state !== 'none';   // wanted (wanted.js): seen or searched for
    const col = chase ? ((this.t * 4) % 2 < 1 ? [255, 0, 20] : [0, 40, 255]) : B.active === 0 ? [20, 200, 60] : [230, 230, 230];
    ds.light(col);
    ds.flush();
  }
  // Settings button: pick the DualSense (needs a click: the browser asks which device)
  async connectDualSense() {
    if (!navigator.hid) { this.G.hud?.toast?.('Trigger effects need Chrome or Edge on a computer (WebHID)'); return false; }
    try {
      const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x054c, productId: 0x0ce6 }, { vendorId: 0x054c, productId: 0x0df2 }] });
      if (!d) return false;
      if (!d.opened) await d.open();
      this.ds = new DualSenseHID(d);
      this.G.hud?.toast?.('DualSense connected · trigger effects on');
      return true;
    } catch (e) { this.G.hud?.toast?.('Could not open the DualSense: ' + (e.message || e)); return false; }
  }
}

// ---------------------------------------------------------------- DualSense output reports over WebHID
// USB: report 0x02 (47 bytes after the id); Bluetooth: report 0x31 (77 bytes: a tag, the same payload, CRC-32).
// Payload: [0] flags (1 rumble, 2 motors not haptics, 4 right trigger, 8 left trigger), [1] flags (4 lightbar),
// [2] right (weak) motor, [3] left (strong) motor, [10..20] right trigger mode + 10 parameters, [21..31] left,
// [44..46] lightbar red, green, blue.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// trigger shapes: [mode, params...]: 0x05 off, 0x01 continuous resistance (start, force), 0x02 a section of
// resistance (start, end, force: squeezed through, it gives like a trigger breaking)
const TRIG = {
  off: [0x05], aim: [0x01, 40, 70], pistol: [0x02, 70, 150, 200], rifle: [0x02, 60, 140, 160], heavy: [0x02, 80, 175, 255],
  brake: [0x01, 30, 90], abs: [0x01, 30, 150],
  reel0: [0x01, 0, 10], reel1: [0x01, 0, 50], reel2: [0x01, 0, 90], reel3: [0x01, 0, 130], reel4: [0x01, 0, 180], reel5: [0x01, 0, 240],
  gas0: [0x01, 10, 20], gas1: [0x01, 10, 50], gas2: [0x01, 10, 80], gas3: [0x01, 10, 110], gas4: [0x01, 10, 140], gas5: [0x01, 10, 170],
};
class DualSenseHID {
  constructor(dev) {
    this.d = dev; this.kickT = 0;
    const out = dev.collections?.flatMap(c => c.outputReports || []) || [];
    this.bt = out.some(r => r.reportId === 0x31) && !out.some(r => r.reportId === 0x02);
    this.p = new Uint8Array(47); this.dirty = false; this.motorT = 0; this.seq = 0;
    this.p[0] = 0x03 | 0x04 | 0x08; this.p[1] = 0x04;
  }
  motors(strong, weak, ms) { this.p[3] = Math.round(strong * 255); this.p[2] = Math.round(weak * 255); this.motorT = performance.now() + ms; this.dirty = true; }
  kick(heavy) { this.kickT = 0.08 + heavy * 0.06; }
  triggers(R, L) {
    const r = TRIG[R] || TRIG.off, l = TRIG[L] || TRIG.off;
    this.p.fill(0, 10, 32); r.forEach((v, i) => this.p[10 + i] = v); l.forEach((v, i) => this.p[21 + i] = v); this.dirty = true;
  }
  light([r, g, b]) { if (this.p[44] !== r || this.p[45] !== g || this.p[46] !== b) { this.p[44] = r; this.p[45] = g; this.p[46] = b; this.dirty = true; } }
  flush() {
    if (this.motorT && performance.now() > this.motorT) { this.p[2] = this.p[3] = 0; this.motorT = 0; this.dirty = true; }
    if (!this.dirty || this.busy) return;
    this.dirty = false; this.busy = true;
    let id = 0x02, data = this.p;
    if (this.bt) {
      id = 0x31; data = new Uint8Array(77); data[0] = (this.seq = (this.seq + 1) & 0x0f) << 4 | 0x02; data.set(this.p, 1);
      const crc = crc32([0xa2, 0x31, ...data.subarray(0, 73)]);
      data[73] = crc & 0xff; data[74] = (crc >>> 8) & 0xff; data[75] = (crc >>> 16) & 0xff; data[76] = (crc >>> 24) & 0xff;
    }
    this.d.sendReport(id, data).catch(() => {}).finally(() => { this.busy = false; });
  }
}
