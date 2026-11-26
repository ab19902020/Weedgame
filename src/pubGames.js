// The pub games (interiors.js opens them at the oche, the pool table and the fruit machine): darts and pool
// against one of the regulars, for fun or for a stake, and a fruit machine. Each plays full screen on a canvas,
// by touch or mouse. Winnings and stakes come out of the brother's cash (food.js).
import { cash, spend } from './food.js';

const REGULARS = ['Dave', 'Shaz', 'Big Mick', 'Tina', 'Raj', 'Kev', 'Lorraine', 'Gaz', 'Bev', 'Tommo', 'Jan', 'Wayne'];
const money = v => '£' + (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export class PubGames {
  constructor(G) { this.G = G; this.el = null; this.game = null; this.raf = 0; }
  get open() { return !!this.el; }
  // the frame round every game: title, cash, a canvas, a row of buttons, Leave
  frame(title) {
    this.close();
    const el = this.el = document.createElement('div'); el.id = 'gamePanel';
    el.innerHTML = `<div class="gp-top"><b>${title}</b><span class="gp-msg"></span><span class="gp-cash"></span><button class="gp-x">Leave</button></div><canvas></canvas><div class="gp-btns"></div>`;
    document.body.appendChild(el);
    el.querySelector('.gp-x').onclick = () => this.close();
    this.cv = el.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
    this.btns = el.querySelector('.gp-btns'); this.msgEl = el.querySelector('.gp-msg'); this.cashEl = el.querySelector('.gp-cash');
    const loop = t => { if (!this.el) return; this.size(); this.game?.frame(t / 1000); this.cashEl.textContent = `${this.me.short}: ${money(cash(this.me))}`; this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  size() {
    const cv = this.cv, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.W = r.width; this.H = r.height; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  msg(t) { if (this.msgEl.textContent !== t) this.msgEl.textContent = t; }
  buttons(list) {
    this.btns.innerHTML = '';
    for (const [label, fn, cls] of list) { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; this.btns.appendChild(b); }
  }
  close() { cancelAnimationFrame(this.raf); this.el?.remove(); this.el = null; this.game?.stop?.(); this.game = null; }
  get me() { return this.G.brothers.me; }
  // a stake, then the game
  start(kind, site) {
    this.site = site;
    const name = REGULARS[Math.floor(Math.random() * REGULARS.length)];
    if (kind === 'fruit') { this.frame(`Fruit machine · ${site.name}`); this.game = new Fruit(this); return; }
    this.frame(`${kind === 'darts' ? 'Darts' : 'Pool'} with ${name} · ${site.name}`);
    const go = stake => {
      if (stake && !spend(this.me, stake)) { this.G.hud?.toast?.('Not enough cash for that'); return; }
      this.game = kind === 'darts' ? new Darts(this, name, stake) : new Pool(this, name, stake);
    };
    this.game = { frame: () => { const c = this.ctx; c.fillStyle = '#16241f'; c.fillRect(0, 0, this.W, this.H); c.fillStyle = '#fcf5db'; c.font = '700 18px system-ui'; c.textAlign = 'center'; c.fillText(`${name} fancies a game of ${kind}.`, this.W / 2, this.H / 2 - 10); c.font = '14px system-ui'; c.fillStyle = '#cfe3d4'; c.fillText('Play for fun, or put some money on it (winner takes both stakes).', this.W / 2, this.H / 2 + 18); } };
    this.msg('');
    this.buttons([['Just for fun', () => go(0)], ['£5 on it', () => go(5)], ['£20 on it', () => go(20)]]);
  }
  // the end of a game with a stake: the winner takes both
  settle(won, stake, name) {
    if (stake) { if (won) this.me.cash = cash(this.me) + stake * 2; }
    this.G.hud?.toast?.(won ? `You beat ${name}${stake ? ` and win ${money(stake * 2)}` : ''}!` : `${name} wins${stake ? `: ${money(stake)} gone` : ''}.`, 4);
  }
}

// ---------------------------------------------------------------- darts: nine darts each, highest score wins
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export function dartScore(x, y) {   // mm from the bull, y up
  const r = Math.hypot(x, y);
  if (r <= 6.35) return { s: 50, label: 'Bull' };
  if (r <= 15.9) return { s: 25, label: '25' };
  if (r > 170) return { s: 0, label: 'Miss' };
  const deg = (90 - Math.atan2(y, x) * 180 / Math.PI + 9 + 720) % 360, n = ORDER[Math.floor(deg / 18) % 20];
  const m = r >= 99 && r <= 107 ? 3 : r >= 162 ? 2 : 1;
  return { s: n * m, label: (m === 3 ? 'T' : m === 2 ? 'D' : '') + n };
}
class Darts {
  constructor(host, name, stake) {
    this.h = host; this.name = name; this.stake = stake;
    this.scores = [0, 0]; this.turn = 0; this.round = 1; this.thrown = []; this.aim = null; this.t0 = 0; this.cpuT = 0; this.over = false;
    const cv = host.cv, pt = e => { const r = cv.getBoundingClientRect(); return this.toMM(e.clientX - r.left, e.clientY - r.top); };
    cv.onpointerdown = e => { if (this.turn !== 0 || this.over || this.thrown.length >= 3 || this.busy) return; cv.setPointerCapture(e.pointerId); this.aim = pt(e); };
    cv.onpointermove = e => { if (this.aim) this.aim = pt(e); };
    cv.onpointerup = cv.onpointercancel = () => { if (!this.aim) return; const w = this.wob || this.aim; this.throwAt(w[0], w[1], 6 + (host.me.drunk || 0) * 1.5); this.aim = null; };
    host.buttons([]);
    host.msg('Your darts: hold where you want to aim (it sways), let go to throw.');
  }
  get geom() { const R = Math.min(this.h.W * 0.62, this.h.H) / 2 - 10; return { cx: Math.min(this.h.W * 0.36, this.h.W - R - 190) + 4, cy: this.h.H / 2, k: R / 225 }; }
  toMM(px, py) { const g = this.geom; return [(px - g.cx) / g.k, -(py - g.cy) / g.k]; }
  throwAt(x, y, sd) {
    // the dart flies in from the thrower's hand and lands a moment later (the score counts when it sticks)
    const tx = x + gauss() * sd, ty = y + gauss() * sd, sc = dartScore(tx, ty);
    const d = { x: tx, y: ty, ...sc, who: this.turn, t0: performance.now() / 1000, lean: (Math.random() - 0.5) * 0.5, landed: false };
    this.thrown.push(d);
    setTimeout(() => {
      d.landed = true; d.tl = performance.now() / 1000; this.scores[d.who] += sc.s; this.shake = 0.09;
      const me = this.h.me; this.h.G.audio?.shot?.('wood', me.x, me.z, sc.s ? 0.35 : 0.2, me.y + 1.6);
      this.pop = { text: sc.s ? `${sc.label}${sc.label !== String(sc.s) && sc.s !== 25 && sc.s !== 50 ? ' · ' + sc.s : ''}` : 'Miss', x: tx, y: ty, t: d.tl, big: sc.s >= 50 };
      const turn = this.thrown.filter(q => q.who === d.who && q.landed).reduce((a, q) => a + q.s, 0);
      if (this.thrown.length >= 3 && turn === 180) this.pop = { text: 'ONE HUNDRED AND EIGHTY!', x: 0, y: 0, t: d.tl, big: true, centre: true };
    }, 230);
    if (this.thrown.length >= 3) { this.busy = true; setTimeout(() => this.next(), 1600); }
  }
  next() {
    this.busy = false; this.thrown = [];
    if (this.turn === 1) this.round++;
    this.turn = 1 - this.turn;
    if (this.round > 3) { this.over = true; const won = this.scores[0] > this.scores[1]; this.h.settle(won, this.stake, this.name); this.h.buttons([['Play again', () => this.h.start('darts', this.h.site)], ['Done', () => this.h.close()]]); this.h.msg(this.scores[0] === this.scores[1] ? 'A draw!' : won ? 'You win!' : `${this.name} wins.`); if (this.scores[0] === this.scores[1] && this.stake) this.h.me.cash = cash(this.h.me) + this.stake; return; }
    this.h.msg(this.turn === 0 ? `Round ${this.round}: your darts.` : `${this.name} steps up…`);
    if (this.turn === 1) this.cpuT = performance.now() / 1000 + 1;
  }
  // the board, drawn once per size onto its own canvas: sisal fibres, the wire spider, the number ring
  boardCanvas(g) {
    const R = 228 * g.k, key = Math.round(R);
    if (this._bc && this._bk === key) return this._bc;
    const dpr = Math.min(2, devicePixelRatio || 1), S = Math.ceil(R * 2 + 8), cv = document.createElement('canvas');
    cv.width = S * dpr; cv.height = S * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const cx = S / 2, cy = S / 2, k = g.k;
    const seg = (r0, r1, i, col) => { const a0 = (90 - (i * 18 - 9)) * Math.PI / 180, a1 = (90 - (i * 18 + 9)) * Math.PI / 180; c.beginPath(); c.arc(cx, cy, r1 * k, -a0, -a1); c.arc(cx, cy, r0 * k, -a1, -a0, true); c.closePath(); c.fillStyle = col; c.fill(); };
    // the black surround and its bevel
    let gr = c.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.2, cx, cy, R); gr.addColorStop(0, '#2a2a2a'); gr.addColorStop(1, '#0b0b0b');
    c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, 226 * k, 0, 7); c.fill();
    for (let i = 0; i < 20; i++) { const dark = i % 2 === 0; seg(15.9, 99, i, dark ? '#1d1b19' : '#eadcb8'); seg(99, 107, i, dark ? '#b8261c' : '#1f7a40'); seg(107, 162, i, dark ? '#1d1b19' : '#eadcb8'); seg(162, 170, i, dark ? '#b8261c' : '#1f7a40'); }
    c.fillStyle = '#1f7a40'; c.beginPath(); c.arc(cx, cy, 15.9 * k, 0, 7); c.fill(); c.fillStyle = '#b8261c'; c.beginPath(); c.arc(cx, cy, 6.35 * k, 0, 7); c.fill();
    // sisal: thousands of tiny fibre flecks, lighter and darker, only on the playing area
    c.save(); c.beginPath(); c.arc(cx, cy, 170 * k, 0, 7); c.clip();
    for (let n = 0; n < 5200; n++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 170 * k; c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)'; c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.2, 1.2); }
    gr = c.createRadialGradient(cx - R * 0.25, cy - R * 0.3, 0, cx, cy, 170 * k); gr.addColorStop(0, 'rgba(255,250,235,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)'); c.fillStyle = gr; c.fillRect(0, 0, S, S);
    c.restore();
    // the spider: silver wire round the rings and between the segments
    c.strokeStyle = '#d8dadc'; c.lineWidth = Math.max(0.8, 1.1 * k * 2);
    for (const r of [6.35, 15.9, 99, 107, 162, 170]) { c.beginPath(); c.arc(cx, cy, r * k, 0, 7); c.stroke(); }
    for (let i = 0; i < 20; i++) { const a = (90 - (i * 18 + 9)) * Math.PI / 180; c.beginPath(); c.moveTo(cx + Math.cos(a) * 15.9 * k, cy - Math.sin(a) * 15.9 * k); c.lineTo(cx + Math.cos(a) * 170 * k, cy - Math.sin(a) * 170 * k); c.stroke(); }
    // the number ring: chrome numbers round the outside
    c.fillStyle = '#e9ecef'; c.font = `800 ${Math.max(10, 24 * k)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    ORDER.forEach((n, i) => { const a = (90 - i * 18) * Math.PI / 180, x = cx + Math.cos(a) * 196 * k, y = cy - Math.sin(a) * 196 * k; c.save(); c.translate(x, y); c.rotate(-a + Math.PI / 2); c.fillText(n, 0, 0); c.restore(); });
    this._bc = cv; this._bk = key; this._bs = S; return cv;
  }
  // a dart seen from the oche, a little below and to the right: steel tip in the board, barrel, shaft and flights
  // standing out towards you (bigger and further out while it's in the air)
  drawDart(c, x, y, scale, col, lean, wob = 0) {
    const L = 30 * scale, ang = -2.0 + lean + wob, ux = Math.cos(ang), uy = Math.sin(ang);
    const px = -uy, py = ux, P = (a, b) => [x + ux * a + px * b, y + uy * a + py * b];
    // its shadow on the board
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); const s0 = [x + 3 * scale, y + 2 * scale]; c.moveTo(...s0); c.lineTo(s0[0] + ux * L * 0.55 + 10 * scale, s0[1] + uy * L * 0.2 + 14 * scale); c.lineTo(s0[0] + ux * L * 0.55 + 14 * scale, s0[1] + uy * L * 0.2 + 10 * scale); c.closePath(); c.fill();
    c.lineCap = 'round';
    // point, barrel (knurled tungsten), shaft
    c.strokeStyle = '#c9ccd0'; c.lineWidth = 1.6 * scale; c.beginPath(); c.moveTo(x, y); c.lineTo(...P(L * 0.12, 0)); c.stroke();
    const gb = c.createLinearGradient(...P(0, -3 * scale), ...P(0, 3 * scale)); gb.addColorStop(0, '#5d6266'); gb.addColorStop(0.45, '#e6e8ea'); gb.addColorStop(1, '#3a3e42');
    c.strokeStyle = gb; c.lineWidth = 5.5 * scale; c.beginPath(); c.moveTo(...P(L * 0.12, 0)); c.lineTo(...P(L * 0.46, 0)); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 0.8 * scale; for (let k = 0.17; k < 0.44; k += 0.045) { c.beginPath(); c.moveTo(...P(L * k, -2.6 * scale)); c.lineTo(...P(L * k, 2.6 * scale)); c.stroke(); }
    c.strokeStyle = '#1c1c1c'; c.lineWidth = 3 * scale; c.beginPath(); c.moveTo(...P(L * 0.46, 0)); c.lineTo(...P(L * 0.76, 0)); c.stroke();
    // flights: two wings seen edge-on-ish and one face-on, in the player's colour
    const f0 = 0.68, f1 = 1.0;
    for (const [w, shade] of [[9, 1], [-6, 0.75], [4, 0.55]]) {
      c.fillStyle = shade === 1 ? col : shade > 0.6 ? col + 'cc' : col + '99';
      c.beginPath(); c.moveTo(...P(L * f0, 0)); c.lineTo(...P(L * (f0 + 0.08), w * scale)); c.lineTo(...P(L * f1, w * scale * 1.05)); c.lineTo(...P(L * f1, 0)); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.7 * scale; c.stroke();
    }
    c.lineCap = 'butt';
  }
  frame(t) {
    const c = this.h.ctx, { W, H } = this.h, g = this.geom;
    // the opponent: aims for treble 20 (the bull now and then), a pub player's scatter
    if (this.turn === 1 && !this.over && !this.busy && t > this.cpuT && this.thrown.length < 3) { this.cpuT = t + 1.1; const bull = Math.random() < 0.15; this.throwAt(0, bull ? 0 : 103, 21); }
    // the sway: a slow figure of eight round your finger
    const amp = 13 + (this.h.me.drunk || 0) * 4;
    this.wob = this.aim ? [this.aim[0] + Math.sin(t * 1.9) * amp, this.aim[1] + Math.sin(t * 3.1 + 1) * amp * 0.8] : null;
    const now = performance.now() / 1000;
    // the wall: dark wood panelling, the cabinet with its doors open, a spotlight on the board
    let gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#24170f'); gr.addColorStop(0.5, '#3a2617'); gr.addColorStop(1, '#22160e');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2; for (let x = 0; x < W; x += 46) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    const sh = this.shake > 0 ? (this.shake -= 1 / 60, Math.sin(now * 90) * 2.2) : 0;
    const R = 228 * g.k, cab = R * 1.18;
    c.fillStyle = '#4a2d18'; c.fillRect(g.cx - cab, g.cy - cab, cab * 2, cab * 2);
    c.fillStyle = '#2b1a0e'; c.fillRect(g.cx - cab + 8, g.cy - cab + 8, cab * 2 - 16, cab * 2 - 16);
    for (const sgn of [-1, 1]) { c.fillStyle = '#5a3820'; c.fillRect(g.cx + sgn * cab - (sgn < 0 ? cab * 0.55 : 0), g.cy - cab, cab * 0.55, cab * 2); c.strokeStyle = '#2b1a0e'; c.lineWidth = 3; c.strokeRect(g.cx + sgn * cab - (sgn < 0 ? cab * 0.55 : 0) + 8, g.cy - cab + 8, cab * 0.55 - 16, cab * 2 - 16); }
    gr = c.createRadialGradient(g.cx, g.cy - R * 0.4, R * 0.2, g.cx, g.cy, cab * 1.4); gr.addColorStop(0, 'rgba(255,240,200,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    const bc = this.boardCanvas(g); c.drawImage(bc, g.cx - this._bs / 2 + sh, g.cy - this._bs / 2, this._bs, this._bs);
    // the darts: in the board once landed (wobbling as they settle), in the air before
    const col = who => who ? '#3a8ee8' : '#e8b820';
    for (const d of this.thrown) {
      const bx = g.cx + d.x * g.k + sh, by = g.cy - d.y * g.k;
      if (d.landed) { const age = now - d.tl, wob = Math.sin(age * 38) * 0.22 * Math.exp(-age * 7); this.drawDart(c, bx, by, Math.max(0.7, g.k * 3), col(d.who), d.lean, wob); }
      else {
        const f = Math.min(1, (now - d.t0) / 0.23), e = f * f, sx = W * 0.62, sy = H + 60;
        const x = sx + (bx - sx) * e, y = sy + (by - sy) * e - Math.sin(f * Math.PI) * H * 0.18;
        this.drawDart(c, x, y, Math.max(0.7, g.k * 3) * (1 + (1 - f) * 2.2), col(d.who), d.lean - (1 - f) * 0.6);
      }
    }
    // the aim
    if (this.wob) { const x = g.cx + this.wob[0] * g.k, y = g.cy - this.wob[1] * g.k; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, 7); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke(); c.fillStyle = 'rgba(255,60,40,0.9)'; c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
    // what it scored: rises and fades
    if (this.pop) {
      const a = now - this.pop.t; if (a > 1.3) this.pop = null; else {
        const x = this.pop.centre ? g.cx : g.cx + this.pop.x * g.k, y = (this.pop.centre ? g.cy : g.cy - this.pop.y * g.k) - 24 - a * 30;
        c.globalAlpha = Math.min(1, 2.2 - a * 1.7); c.font = `900 ${this.pop.big ? 28 : 20}px system-ui`; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#000'; c.strokeText(this.pop.text, x, y); c.fillStyle = this.pop.big ? '#ffd25a' : '#ffffff'; c.fillText(this.pop.text, x, y); c.globalAlpha = 1;
      }
    }
    // the chalkboard: round, each player's total, the last three darts
    const sx = Math.min(W - 196, g.cx + cab + 20), sw = Math.max(170, W - sx - 12), sy = 14;
    c.fillStyle = '#5a3a22'; c.fillRect(sx - 8, sy - 8, sw + 16, 236); c.fillStyle = '#1c2622'; c.fillRect(sx, sy, sw, 220);
    c.fillStyle = 'rgba(255,255,255,0.04)'; for (let n = 0; n < 60; n++) c.fillRect(sx + Math.random() * sw, sy + Math.random() * 220, 18, 1);
    const chalk = (txt, x, y, size, colr = '#f2f0e6') => { c.fillStyle = colr; c.font = `700 ${size}px "Segoe Print","Bradley Hand","Comic Neue",system-ui`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, x, y); };
    chalk(`Round ${Math.min(3, this.round)} of 3`, sx + 12, sy + 22, 15, '#cfe3d4');
    for (const [i, nm] of [[0, this.h.me.short], [1, this.name]]) chalk(`${nm}  ${this.scores[i]}`, sx + 12, sy + 62 + i * 38, 22, this.turn === i && !this.over ? '#ffe28a' : '#f2f0e6');
    const ds = this.thrown.filter(q => q.landed).map(q => q.label).join('   ');
    if (ds) chalk(ds, sx + 12, sy + 146, 16, '#9fd0b0');
    if (this.stake) chalk(`${money(this.stake)} each on it`, sx + 12, sy + 178, 13, '#9fd0b0');
    if (!this.aim && this.turn === 0 && !this.over && !this.busy) chalk(`Dart ${this.thrown.length + 1} of 3`, sx + 12, sy + 204, 13, '#cfe3d4');
  }
}

// ---------------------------------------------------------------- pool: UK eight-ball, reds against yellows
const TL = 1.9, TW = 0.95, BR = 0.0254, POCKETS = [[0, 0, 0.072], [TL / 2, -0.012, 0.062], [TL, 0, 0.072], [0, TW, 0.072], [TL / 2, TW + 0.012, 0.062], [TL, TW, 0.072]];
export class PoolSim {
  constructor() {
    this.balls = [{ id: 0, c: 'cue', x: TL * 0.22, y: TW / 2, vx: 0, vy: 0, in: false }];
    // the rack: apex on the foot spot, the black in the middle of the third row
    const fx = TL * 0.73, cols = ['red', 'yellow', 'red', 'yellow', 'black', 'red', 'red', 'yellow', 'red', 'yellow', 'yellow', 'red', 'yellow', 'red', 'yellow'];
    let k = 0; for (let row = 0; row < 5; row++) for (let q = 0; q <= row; q++) this.balls.push({ id: k + 1, c: cols[k++], x: fx + row * BR * 1.78, y: TW / 2 + (q - row / 2) * BR * 2.06, vx: 0, vy: 0, in: false });
  }
  get moving() { return this.balls.some(b => !b.in && (b.vx || b.vy)); }
  shoot(vx, vy) { const c = this.balls[0]; c.vx = vx; c.vy = vy; this.first = null; this.potted = []; }
  step(dt) {
    const B = this.balls.filter(b => !b.in);
    for (const b of B) {
      const v = Math.hypot(b.vx, b.vy); if (!v) continue;
      const nv = Math.max(0, v - (0.3 + 0.1 * v) * dt); if (nv < 0.004) { b.vx = b.vy = 0; continue; }
      b.vx *= nv / v; b.vy *= nv / v; b.x += b.vx * dt; b.y += b.vy * dt;
      // into a pocket
      for (const [px, py, pr] of POCKETS) if (Math.hypot(b.x - px, b.y - py) < pr) { b.in = true; b.vx = b.vy = 0; this.potted?.push(b); break; }
      if (b.in) continue;
      // the cushions (not across the pockets' mouths)
      const nearP = POCKETS.some(([px, py, pr]) => Math.hypot(b.x - px, b.y - py) < pr + BR * 1.3);
      if (!nearP) {
        const v0 = Math.hypot(b.vx, b.vy);
        if (b.x < BR) { b.x = BR; b.vx = -b.vx * 0.78; } if (b.x > TL - BR) { b.x = TL - BR; b.vx = -b.vx * 0.78; }
        if (b.y < BR) { b.y = BR; b.vy = -b.vy * 0.78; } if (b.y > TW - BR) { b.y = TW - BR; b.vy = -b.vy * 0.78; }
        if (Math.hypot(b.vx, b.vy) < v0 * 0.99 && v0 > 0.3) this.cushions?.push(v0);
      } else { b.x = Math.max(-0.03, Math.min(TL + 0.03, b.x)); b.y = Math.max(-0.03, Math.min(TW + 0.03, b.y)); }
    }
    // (several passes, so a knock goes right through a pack of touching balls)
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= BR * 2 || !d) continue;
      const nx = dx / d, ny = dy / d, ov = BR * 2 - d; a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; if (rel <= 0) continue;
      const k = rel * 0.965; a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny;
      if (rel > 0.05) this.knocks?.push(rel);
      if (this.first == null && (a.id === 0 || b.id === 0)) this.first = a.id === 0 ? b : a;
    }
  }
  run(secs) { for (let t = 0; t < secs && this.moving; t += 1 / 240) this.step(1 / 240); }
  // the first ball a shot from (x, y) along (dx, dy) would meet: { b, t } (t: distance to contact)
  ray(x, y, dx, dy, skip = 0) {
    let best = null;
    for (const b of this.balls) {
      if (b.in || b.id === skip) continue;
      const ox = b.x - x, oy = b.y - y, t = ox * dx + oy * dy; if (t <= 0) continue;
      const p2 = ox * ox + oy * oy - t * t, r2 = 4 * BR * BR; if (p2 > r2) continue;
      const tt = t - Math.sqrt(r2 - p2); if (!best || tt < best.t) best = { b, t: tt };
    }
    return best;
  }
  clear(x0, y0, x1, y1, skip) { const L = Math.hypot(x1 - x0, y1 - y0), h = this.ray(x0, y0, (x1 - x0) / L, (y1 - y0) / L, skip); return !h || h.t > L - BR * 2.2; }
}
// the drawing of the table: felt, cushions, the wooden rails with their diamonds, leather pockets (rendered once
// per size); the balls are shaded spheres that roll (a spot on the white, the 8 on the black turn with them)
const CUSH = 0.034, RAIL = 0.085, BALL = { cue: '#f4f1e6', red: '#c4221a', yellow: '#efc317', black: '#141414' };
const rot = (v, a, th) => { const c = Math.cos(th), s = Math.sin(th), d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  return [v[0] * c + (a[1] * v[2] - a[2] * v[1]) * s + a[0] * d * (1 - c), v[1] * c + (a[2] * v[0] - a[0] * v[2]) * s + a[1] * d * (1 - c), v[2] * c + (a[0] * v[1] - a[1] * v[0]) * s + a[2] * d * (1 - c)]; };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), m = v => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))); return `rgb(${m(n >> 16)},${m(n >> 8 & 255)},${m(n & 255)})`; };
class Pool {
  constructor(host, name, stake) {
    this.h = host; this.name = name; this.stake = stake; this.sim = new PoolSim();
    this.sim.knocks = []; this.sim.cushions = [];
    this.turn = 0; this.group = [null, null]; this.over = false; this.drag = null; this.shooting = false; this.cpuT = 0; this.tray = [];
    for (const b of this.sim.balls) { b.e1 = rot([1, 0, 0], [0, 0, 1], Math.random() * 6); b.e3 = b.c === 'black' ? [0, 0, 1] : rot([0, 0, 1], [1, 0, 0], Math.random() * 3); b.lx = b.x; b.ly = b.y; }
    const cv = host.cv, pt = e => { const r = cv.getBoundingClientRect(); return this.toT(e.clientX - r.left, e.clientY - r.top); };
    cv.onpointerdown = e => { if (this.turn !== 0 || this.over || this.shooting || this.cueMove) return; cv.setPointerCapture(e.pointerId); this.drag = pt(e); };
    cv.onpointermove = e => { if (this.drag) this.drag = pt(e); };
    cv.onpointerup = cv.onpointercancel = () => { if (!this.drag) return; const a = this.aim(); this.drag = null; if (a && a.power > 0.04) this.strike(a.dx, a.dy, a.power * 5.2, 0.04 + a.power * 0.18, 0); };
    host.buttons([]);
    host.msg('Your break: drag back from the white ball to aim and set the power, let go to shoot.');
  }
  get geom() {
    const m = (CUSH + RAIL) * 2, k = Math.min((this.h.W - 16) / (TL + m), (this.h.H - 62) / (TW + m));
    return { k, x0: (this.h.W - TL * k) / 2, y0: (this.h.H - 30 - TW * k) / 2 + 26 };
  }
  toT(px, py) { const g = this.geom; return [(px - g.x0) / g.k, (py - g.y0) / g.k]; }
  aim() { const c = this.sim.balls[0], [px, py] = this.drag; const dx = c.x - px, dy = c.y - py, L = Math.hypot(dx, dy); if (L < 0.01) return null; return { dx: dx / L, dy: dy / L, power: Math.min(1, L / 0.55) }; }
  // the cue comes forward from `back` (drawn back over `aimT` seconds first for the regular), then the white goes
  strike(dx, dy, sp, back, aimT) { this.cueMove = { dx, dy, sp, back, aimT, t0: performance.now() / 1000 }; }
  shoot(vx, vy) { this.sim.shoot(vx, vy); this.shooting = true; this.shooter = this.turn; }
  sfx(name, gain, rate) { this.h.G.audio?.tap?.(name, gain, rate); }
  mine(i) { const g = this.group[i]; return g ? this.sim.balls.filter(b => b.c === g && !b.in) : []; }
  onBlack(i) { return this.group[i] && !this.mine(i).length; }
  // after the balls stop: fouls, the colours, whose go
  settle() {
    const S = this.sim, i = this.shooter, o = 1 - i, pot = S.potted || [], first = S.first;
    const cue = pot.some(b => b.id === 0), black = pot.some(b => b.c === 'black');
    let foul = cue || !first || (this.group[i] ? (this.onBlack(i) ? first.c !== 'black' : first.c !== this.group[i]) : first.c === 'black');
    if (black) { const win = !foul && this.onBlackBefore, who = i === 0 ? 'you' : this.name; return this.end(win ? i : o, win ? `${who} potted the black` : `${who} potted the black ${foul ? 'on a foul' : 'too early'}`); }
    const cols = pot.filter(b => b.c === 'red' || b.c === 'yellow');
    if (!this.group[i] && !foul && cols.length) { this.group[i] = cols[0].c; this.group[o] = cols[0].c === 'red' ? 'yellow' : 'red'; }
    const own = cols.some(b => b.c === this.group[i]);
    if (cue) { const c = S.balls[0]; c.in = false; c.vx = c.vy = 0; c.x = TL * 0.22; c.y = TW / 2; while (S.balls.some(b => b !== c && !b.in && Math.hypot(b.x - c.x, b.y - c.y) < BR * 2.1)) c.y += BR * 2.2; c.lx = c.x; c.ly = c.y; c.potT = null; this.tray = this.tray.filter(b => b !== c); }
    if (foul || !own) this.turn = o;
    const who = this.turn === 0 ? 'Your shot' : `${this.name}'s shot`;
    this.h.msg(`${foul ? 'Foul! ' : own ? 'Good pot. ' : ''}${who}${this.group[0] ? ` · you're on ${this.onBlack(0) ? 'the black' : this.group[0] + 's'}` : ''}.`);
    if (foul || own) this.flash = { text: foul ? 'Foul — two shots' : pot.length > 1 ? `${pot.length} down!` : 'Good pot', good: !foul, t: performance.now() / 1000 };
    if (this.turn === 1) this.cpuT = performance.now() / 1000 + 1.0;
  }
  end(winner, how) {
    this.over = true; const won = winner === 0;
    this.h.msg(`${won ? 'You win' : this.name + ' wins'}: ${how}.`);
    this.flash = { text: won ? 'You win!' : `${this.name} wins`, good: won, t: performance.now() / 1000, big: true };
    this.h.settle(won, this.stake, this.name);
    this.h.buttons([['Rack them up again', () => { this.h.game = new Pool(this.h, this.name, 0); }], ['Done', () => this.h.close()]]);
  }
  // the regular: the easiest pot of their colour (the black when they're on it), with a pub player's error
  cpu() {
    const S = this.sim, c = S.balls[0], targets = this.onBlack(1) ? S.balls.filter(b => b.c === 'black' && !b.in) : this.group[1] ? this.mine(1) : S.balls.filter(b => !b.in && (b.c === 'red' || b.c === 'yellow'));
    let best = null;
    for (const b of targets) for (const [px, py] of POCKETS) {
      const tx = px - b.x, ty = py - b.y, tl = Math.hypot(tx, ty), gx = b.x - tx / tl * BR * 2, gy = b.y - ty / tl * BR * 2;
      const ax = gx - c.x, ay = gy - c.y, al = Math.hypot(ax, ay), cut = Math.acos(Math.max(-1, Math.min(1, (ax * tx + ay * ty) / (al * tl))));
      if (cut > 1.2 || !S.clear(c.x, c.y, gx, gy, 0) || !S.clear(b.x, b.y, px, py, b.id)) continue;
      const score = cut * 1.5 + (al + tl) * 0.4;
      if (!best || score < best.score) best = { score, dx: ax / al, dy: ay / al, d: al + tl };
    }
    if (!best) { const b = targets.sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0]; const ax = b.x - c.x, ay = b.y - c.y, al = Math.hypot(ax, ay); best = { dx: ax / al, dy: ay / al, d: 1.5 }; }
    const err = gauss() * 0.022, cs = Math.cos(err), sn = Math.sin(err), dx = best.dx * cs - best.dy * sn, dy = best.dx * sn + best.dy * cs, sp = Math.min(4.2, 1.1 + best.d * 1.1);
    this.onBlackBefore = this.onBlack(1); this.strike(dx, dy, sp, 0.05 + sp / 5.2 * 0.18, 0.8);
  }
  // the table without the balls, cached per size
  tableCanvas(g, W, H) {
    const key = `${Math.round(g.k)}x${Math.round(W)}x${Math.round(H)}`;
    if (this._tc && this._tk === key) return this._tc;
    const dpr = Math.min(2, devicePixelRatio || 1), cv = document.createElement('canvas'); cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const k = g.k, X = x => g.x0 + x * k, Y = y => g.y0 + y * k, cu = CUSH * k, ra = RAIL * k;
    // the pub round it: floorboards in the gloom
    let gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1b120c'); gr.addColorStop(1, '#2c1d12'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; for (let y = 0; y < H; y += 22) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // the table's shadow on the floor
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(X(0) - cu - ra + 6, Y(0) - cu - ra + 10, TL * k + 2 * (cu + ra), TW * k + 2 * (cu + ra));
    // the wooden rails: mahogany with grain and a bevelled edge
    const ox = X(0) - cu - ra, oy = Y(0) - cu - ra, ow = TL * k + 2 * (cu + ra), oh = TW * k + 2 * (cu + ra), rr = ra * 0.5;
    const rrect = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    gr = c.createLinearGradient(0, oy, 0, oy + oh); gr.addColorStop(0, '#7a4524'); gr.addColorStop(0.5, '#5a3018'); gr.addColorStop(1, '#3e200f');
    rrect(ox, oy, ow, oh, rr); c.fillStyle = gr; c.fill();
    c.save(); rrect(ox, oy, ow, oh, rr); c.clip();
    for (let n = 0; n < 140; n++) { const y = oy + Math.random() * oh; c.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,200,150' : '0,0,0'},${0.04 + Math.random() * 0.06})`; c.lineWidth = 0.6 + Math.random(); c.beginPath(); c.moveTo(ox, y); c.bezierCurveTo(ox + ow * 0.3, y + (Math.random() - 0.5) * 6, ox + ow * 0.7, y + (Math.random() - 0.5) * 6, ox + ow, y + (Math.random() - 0.5) * 4); c.stroke(); }
    c.restore();
    c.strokeStyle = 'rgba(255,220,180,0.25)'; c.lineWidth = 1.5; rrect(ox + 1.5, oy + 1.5, ow - 3, oh - 3, rr); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2; c.strokeRect(X(0) - cu, Y(0) - cu, TL * k + 2 * cu, TW * k + 2 * cu);
    // the diamonds (sights) on the rails
    c.fillStyle = '#efe6cf';
    const dia = (x, y) => { const s = Math.max(2, ra * 0.12); c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.7, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.7, y); c.closePath(); c.fill(); };
    for (let i = 1; i < 8; i++) if (i !== 4) { const x = X(TL * i / 8); dia(x, Y(0) - cu - ra / 2); dia(x, Y(TW) + cu + ra / 2); }
    for (let i = 1; i < 4; i++) { const y = Y(TW * i / 4); dia(X(0) - cu - ra / 2, y); dia(X(TL) + cu + ra / 2, y); }
    // the cloth: green baize, a fine nap, lit from the lamp above
    c.fillStyle = '#13693a'; c.fillRect(X(0) - cu, Y(0) - cu, TL * k + 2 * cu, TW * k + 2 * cu);
    c.save(); c.beginPath(); c.rect(X(0) - cu, Y(0) - cu, TL * k + 2 * cu, TW * k + 2 * cu); c.clip();
    for (let n = 0; n < TL * TW * k * k / 9; n++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; c.fillRect(X(0) - cu + Math.random() * (TL * k + 2 * cu), Y(0) - cu + Math.random() * (TW * k + 2 * cu), 1.3, 1.3); }
    for (const fx of [0.3, 0.7]) { gr = c.createRadialGradient(X(TL * fx), Y(TW / 2), 0, X(TL * fx), Y(TW / 2), TL * k * 0.42); gr.addColorStop(0, 'rgba(190,255,170,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(X(0) - cu, Y(0) - cu, TL * k + 2 * cu, TW * k + 2 * cu); }
    gr = c.createRadialGradient(X(TL / 2), Y(TW / 2), TW * k * 0.4, X(TL / 2), Y(TW / 2), TL * k * 0.62); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.32)'); c.fillStyle = gr; c.fillRect(X(0) - cu, Y(0) - cu, TL * k + 2 * cu, TW * k + 2 * cu);
    // the cushions: raised rubber under the cloth, a shade darker with a lit nose, broken at the pockets
    const cush = (x0, y0, x1, y1, nx, ny) => {
      const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, w = cu, j = cu * 1.1;
      c.beginPath(); c.moveTo(x0 - nx * w, y0 - ny * w); c.lineTo(x1 - nx * w, y1 - ny * w); c.lineTo(x1 - ux * j, y1 - uy * j); c.lineTo(x0 + ux * j, y0 + uy * j); c.closePath();
      const gg = c.createLinearGradient(x0 - nx * w, y0 - ny * w, x0, y0); gg.addColorStop(0, '#0c4a28'); gg.addColorStop(0.75, '#15703e'); gg.addColorStop(1, '#2c8f55'); c.fillStyle = gg; c.fill();
    };
    const cp = 0.085, mp = 0.06;
    cush(X(cp), Y(0), X(TL / 2 - mp), Y(0), 0, 1); cush(X(TL / 2 + mp), Y(0), X(TL - cp), Y(0), 0, 1);
    cush(X(TL / 2 - mp), Y(TW), X(cp), Y(TW), 0, -1); cush(X(TL - cp), Y(TW), X(TL / 2 + mp), Y(TW), 0, -1);
    cush(X(0), Y(TW - cp), X(0), Y(cp), 1, 0); cush(X(TL), Y(cp), X(TL), Y(TW - cp), -1, 0);
    c.restore();
    // the baulk line and the D, the spot
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(TL * 0.22), Y(0)); c.lineTo(X(TL * 0.22), Y(TW)); c.stroke();
    c.beginPath(); c.arc(X(TL * 0.22), Y(TW / 2), TW * k * 0.17, Math.PI / 2, Math.PI * 1.5); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.arc(X(TL * 0.73), Y(TW / 2), 1.6, 0, 7); c.fill();
    // the pockets: leather-trimmed jaws round a deep black hole
    for (const [px, py, pr] of POCKETS) {
      const x = X(px), y = Y(py), r = pr * k * 0.95;
      c.fillStyle = '#2a170c'; c.beginPath(); c.arc(x, y, r * 1.22, 0, 7); c.fill();
      gr = c.createRadialGradient(x, y, r * 0.2, x, y, r); gr.addColorStop(0, '#000'); gr.addColorStop(0.8, '#070605'); gr.addColorStop(1, '#1d1712'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,200,150,0.18)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r * 1.18, 0, 7); c.stroke();
    }
    this._tc = cv; this._tk = key; return cv;
  }
  ball(c, b, x, y, r, alpha = 1) {
    const col = BALL[b.c];
    c.globalAlpha = alpha;
    // its shadow, cast away from the lamp
    const g = this.geom, sx = (b.x - TL / 2) / TL * r * 0.9, sy = (b.y - TW / 2) / TW * r * 0.9;
    let gr = c.createRadialGradient(x + sx + r * 0.15, y + sy + r * 0.3, 0, x + sx + r * 0.15, y + sy + r * 0.3, r * 1.3); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(x + sx + r * 0.15, y + sy + r * 0.3, r * 1.3, 0, 7); c.fill();
    // the sphere: lit from above-left, the cloth's green in the bottom edge
    gr = c.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.05);
    gr.addColorStop(0, shade(col, b.c === 'black' ? 0.35 : 0.55)); gr.addColorStop(0.35, col); gr.addColorStop(0.85, shade(col, -0.45)); gr.addColorStop(1, shade(col, -0.7));
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    // the markings, turning as it rolls: the 8 on the black (both sides), red spots on the white
    c.save(); c.beginPath(); c.arc(x, y, r * 0.98, 0, 7); c.clip();
    const e2 = [b.e3[1] * b.e1[2] - b.e3[2] * b.e1[1], b.e3[2] * b.e1[0] - b.e3[0] * b.e1[2], b.e3[0] * b.e1[1] - b.e3[1] * b.e1[0]];
    const marks = b.c === 'black' ? [[b.e3, 0.42, '#f4f1e6', true], [b.e3.map(v => -v), 0.42, '#f4f1e6', true]] : b.c === 'cue' ? [b.e1, b.e1.map(v => -v), e2, e2.map(v => -v), b.e3, b.e3.map(v => -v)].map(v => [v, 0.17, '#c0281e']) : [];
    for (const [v, ang, mc, eight] of marks) {
      if (v[2] <= 0.02) continue;
      const px = x + v[0] * r, py = y + v[1] * r, rd = r * Math.sin(ang), a = Math.atan2(v[1], v[0]);
      c.fillStyle = mc; c.beginPath(); c.ellipse(px, py, Math.max(0.3, rd * v[2]), rd, a, 0, 7); c.fill();
      if (eight && v[2] > 0.3) { c.save(); c.translate(px, py); c.rotate(a); c.scale(v[2], 1); c.rotate(-a); c.fillStyle = '#141414'; c.font = `800 ${Math.max(6, r * 0.62)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('8', 0, r * 0.04); c.restore(); }
    }
    c.restore();
    // the shine: the lamp's reflection and a softer bounce
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(x - r * 0.36, y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.ellipse(x + r * 0.3, y + r * 0.42, r * 0.3, r * 0.12, -0.6, 0, 7); c.fill();
    c.globalAlpha = 1;
  }
  // the cue: tip, ferrule, maple shaft, ebony butt with its inlaid points and the wrap
  cue(c, x, y, dx, dy, back, k) {
    const at = d => [x - dx * d * k, y - dy * d * k], nx = -dy, ny = dx;
    const seg = (d0, d1, w0, w1, fill) => { const [ax, ay] = at(d0), [bx, by] = at(d1); c.beginPath(); c.moveTo(ax + nx * w0 * k, ay + ny * w0 * k); c.lineTo(bx + nx * w1 * k, by + ny * w1 * k); c.lineTo(bx - nx * w1 * k, by - ny * w1 * k); c.lineTo(ax - nx * w0 * k, ay - ny * w0 * k); c.closePath(); c.fillStyle = fill; c.fill(); };
    const d0 = BR + back, L = 1.45, wAt = d => 0.0052 + (d - d0) / L * 0.0095;
    // the shadow on the cloth
    c.save(); c.translate(6, 9); seg(d0, d0 + L, wAt(d0) * 1.2, wAt(d0 + L) * 1.2, 'rgba(0,0,0,0.3)'); c.restore();
    const lin = (a, b) => { const [ax, ay] = at(0), g = c.createLinearGradient(ax + nx * 0.016 * k, ay + ny * 0.016 * k, ax - nx * 0.016 * k, ay - ny * 0.016 * k); g.addColorStop(0, a); g.addColorStop(0.45, b); g.addColorStop(1, a); return g; };
    const parts = [[0, 0.006, lin('#2b5aa0', '#5d8fd8')], [0.006, 0.026, lin('#cfc8b4', '#fbf7ea')], [0.026, 0.86, lin('#b88a52', '#f0d6a4')], [0.86, 1.08, lin('#1a0f08', '#4a2c18')], [1.08, 1.38, lin('#111', '#3a3a3a')], [1.38, 1.45, lin('#0a0a0a', '#2a2a2a')]];
    for (const [a, b, f] of parts) seg(d0 + a, d0 + b, wAt(d0 + a), wAt(d0 + b), f);
    // the points: maple spikes into the butt
    for (const s of [-1, 1]) { const [ax, ay] = at(d0 + 0.86), [bx, by] = at(d0 + 0.98), w = wAt(d0 + 0.86) * k; c.fillStyle = '#e0bf86'; c.beginPath(); c.moveTo(ax + nx * w * 0.85 * s, ay + ny * w * 0.85 * s); c.lineTo(ax + nx * w * 0.15 * s, ay + ny * w * 0.15 * s); c.lineTo(bx + nx * w * 0.6 * s, by + ny * w * 0.6 * s); c.closePath(); c.fill(); }
    // the wrap's rings
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; for (let d = 1.1; d < 1.37; d += 0.018) { const [ax, ay] = at(d0 + d), w = wAt(d0 + d) * k; c.beginPath(); c.moveTo(ax + nx * w, ay + ny * w); c.lineTo(ax - nx * w, ay - ny * w); c.stroke(); }
  }
  frame(t) {
    const S = this.sim, c = this.h.ctx, { W, H } = this.h, g = this.geom, now = performance.now() / 1000;
    // (the balls move in real time whatever the frame rate: 240 steps a second, up to a tenth of a second a frame)
    const dt = Math.min(0.1, Math.max(0, t - (this.lt ?? t))); this.lt = t;
    if (this.shooting) { for (let k = 0, n = Math.max(1, Math.round(dt * 240)); k < n; k++) S.step(1 / 240); if (!S.moving) { this.shooting = false; this.settle(); } }
    else if (this.turn === 1 && !this.over && !this.cueMove && t > this.cpuT) { this.cpuT = t + 99; this.cpu(); }
    if (!this.shooting && this.turn === 0) this.onBlackBefore = this.onBlack(0);
    // the clicks: the hardest knock this frame (a heel on tile, pitched up), the cushions a duller thud
    if (S.knocks.length) { const v = Math.max(...S.knocks); if (now - (this.kt || 0) > 0.035) { this.sfx('tile', Math.min(0.5, 0.08 + v * 0.14), 1.75 + Math.random() * 0.2); this.kt = now; } S.knocks.length = 0; }
    if (S.cushions.length) { const v = Math.max(...S.cushions); this.sfx('wood', Math.min(0.25, v * 0.06), 1.5); S.cushions.length = 0; }
    // rolling: each ball's markings turn about the axis across its path
    for (const b of S.balls) {
      if (b.in) { if (b.potT == null) { b.potT = now; const p = POCKETS.reduce((q, P) => Math.hypot(b.x - P[0], b.y - P[1]) < Math.hypot(b.x - q[0], b.y - q[1]) ? P : q); b.potP = p; b.potFrom = [b.x, b.y]; this.sfx('wood', 0.3, 0.8); this.h.G.audio?.shot?.('thud', this.h.me.x, this.h.me.z, 0.12, this.h.me.y + 1); } continue; }
      b.potT = null;
      const mx = b.x - b.lx, my = b.y - b.ly, d = Math.hypot(mx, my);
      if (d > 1e-6) { const ax = [-my / d, mx / d, 0]; b.e1 = rot(b.e1, ax, d / BR); b.e3 = rot(b.e3, ax, d / BR); }
      b.lx = b.x; b.ly = b.y;
    }
    const X = x => g.x0 + x * g.k, Y = y => g.y0 + y * g.k, r = BR * g.k;
    c.drawImage(this.tableCanvas(g, W, H), 0, 0, W, H);
    // the shot being lined up (the player's drag, or the cue coming through)
    let A = null;
    if (this.drag && !this.shooting && !this.cueMove) { const a = this.aim(); if (a) A = { dx: a.dx, dy: a.dy, back: 0.04 + a.power * 0.18, power: a.power, guide: true }; }
    if (this.cueMove) {
      const m = this.cueMove, e = now - m.t0;
      if (e < m.aimT) A = { dx: m.dx, dy: m.dy, back: 0.04 + (m.back - 0.04) * Math.min(1, e / m.aimT * 1.6) + Math.sin(e * 9) * 0.006 * (e < m.aimT * 0.7 ? 1 : 0), power: m.sp / 5.2, guide: m.aimT === 0 };
      else {
        const s = (e - m.aimT) / Math.max(0.05, 0.07 + m.back * 0.15);
        if (s >= 1) { this.cueMove = null; this.shoot(m.dx * m.sp, m.dy * m.sp); this.sfx('tile', Math.min(0.55, 0.15 + m.sp * 0.08), 1.3); this.after = { dx: m.dx, dy: m.dy, t: now }; }
        else A = { dx: m.dx, dy: m.dy, back: m.back * (1 - s * s), power: m.sp / 5.2 };
      }
    }
    const cb = S.balls[0];
    // the guide: a dotted line to the first ball, the ghost ball, where the object ball goes and where the white
    // goes off it
    if (A?.guide) {
      const hit = S.ray(cb.x, cb.y, A.dx, A.dy, 0), L = hit ? hit.t : 2.2;
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.setLineDash([5, 6]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(cb.x), Y(cb.y)); c.lineTo(X(cb.x + A.dx * L), Y(cb.y + A.dy * L)); c.stroke(); c.setLineDash([]);
      if (hit) {
        const gx = cb.x + A.dx * L, gy = cb.y + A.dy * L, nx = hit.b.x - gx, ny = hit.b.y - gy, nl = Math.hypot(nx, ny), ux = nx / nl, uy = ny / nl;
        c.strokeStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(X(gx), Y(gy), r, 0, 7); c.stroke();
        const cut = A.dx * ux + A.dy * uy;
        c.strokeStyle = 'rgba(255,210,90,0.85)'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(hit.b.x), Y(hit.b.y)); c.lineTo(X(hit.b.x + ux * (0.1 + 0.3 * cut)), Y(hit.b.y + uy * (0.1 + 0.3 * cut))); c.stroke();
        const tx = A.dx - ux * cut, ty = A.dy - uy * cut, tl = Math.hypot(tx, ty);
        if (tl > 0.05) { c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(gx), Y(gy)); c.lineTo(X(gx + tx / tl * 0.18 * tl), Y(gy + ty / tl * 0.18 * tl)); c.stroke(); }
      }
    }
    // the balls (a potted one drops into the pocket)
    for (const b of S.balls) {
      if (!b.in) { this.ball(c, b, X(b.x), Y(b.y), r); continue; }
      const a = (now - b.potT) / 0.28; if (a >= 1) { if (!this.tray.includes(b)) this.tray.push(b); continue; }
      const px = b.potFrom[0] + (b.potP[0] - b.potFrom[0]) * Math.min(1, a * 1.6), py = b.potFrom[1] + (b.potP[1] - b.potFrom[1]) * Math.min(1, a * 1.6);
      this.ball(c, b, X(px), Y(py), r * (1 - a * 0.55), 1 - a * 0.7);
    }
    if (A && !cb.in) this.cue(c, X(cb.x), Y(cb.y), A.dx, A.dy, A.back, g.k);
    // the power: a meter under the table, green to red
    const mw = Math.min(260, TL * g.k * 0.5), mx = W / 2 - mw / 2, my = Math.min(H - 14, Y(TW) + (CUSH + RAIL) * g.k + 8);
    if (A) {
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(mx - 2, my - 2, mw + 4, 10);
      const gr = c.createLinearGradient(mx, 0, mx + mw, 0); gr.addColorStop(0, '#5bd16a'); gr.addColorStop(0.6, '#f0d040'); gr.addColorStop(1, '#e8402c');
      c.fillStyle = gr; c.fillRect(mx, my, mw * Math.min(1, A.power), 6);
    }
    // the ball return: what's been potted, in order
    this.tray.forEach((b, i) => this.ball(c, b, 14 + i * r * 2.3 + r, H - r - 6, r * 0.8));
    // who's on what
    c.font = '700 14px system-ui'; c.textBaseline = 'middle';
    const tag = (i, x, nm, al) => {
      const gr = this.group[i], on = this.turn === i && !this.over; c.textAlign = al;
      c.fillStyle = on ? '#ffd25a' : '#cfe3d4'; c.fillText(`${on ? '▶ ' : ''}${nm}${gr ? ` · ${this.onBlack(i) ? 'on the black' : gr + 's, ' + this.mine(i).length + ' left'}` : ''}`, x, 14);
      if (gr && !this.onBlack(i)) { const n = this.mine(i).length; for (let q = 0; q < n; q++) { const bx = al === 'left' ? x + 6 + q * 13 : x - 6 - q * 13; c.fillStyle = BALL[gr]; c.beginPath(); c.arc(bx, 30, 5, 0, 7); c.fill(); } }
    };
    tag(0, 12, this.h.me.short, 'left'); tag(1, W - 12, this.name, 'right');
    // a word on the shot
    if (this.flash) {
      const a = now - this.flash.t; if (a > (this.flash.big ? 3 : 1.4)) this.flash = null; else {
        c.globalAlpha = Math.min(1, (this.flash.big ? 3.5 : 1.9) - a * 1.3); c.font = `900 ${this.flash.big ? 34 : 22}px system-ui`; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#000';
        const y = Y(TW / 2) - a * 14; c.strokeText(this.flash.text, W / 2, y); c.fillStyle = this.flash.good ? '#ffd25a' : '#ff7a6a'; c.fillText(this.flash.text, W / 2, y); c.globalAlpha = 1;
      }
    }
  }
}

// ---------------------------------------------------------------- the fruit machine: £1 a go, holds now and then
const SYM = [['🍒', 6, 8], ['🍋', 6, 8], ['🍊', 5, 10], ['🍇', 5, 12], ['🔔', 3, 20], ['BAR', 2, 40], ['7', 1, 100]];
const STRIP = SYM.flatMap(([s, w]) => Array(w).fill(s));
export function fruitPay(r) {   // three symbols -> £ won on a £1 stake
  if (r[0] === r[1] && r[1] === r[2]) return SYM.find(s => s[0] === r[0])[2];
  const ch = r.filter(s => s === '🍒').length;
  if (ch >= 2) return 2;
  if (r[0] === r[1]) return 1;
  return 0;
}
class Fruit {
  constructor(host) {
    this.h = host; this.reels = [0, 1, 2].map(() => ({ s: STRIP[Math.floor(Math.random() * STRIP.length)], off: 0, until: 0, hold: false }));
    this.spinning = false; this.holds = false; this.last = '';
    this.ui();
    host.msg('£1 a spin. Three in a row pays; two cherries pays £2.');
  }
  ui() {
    const h = this.h, list = [['Spin · £1', () => this.spin(), 'big']];
    if (this.holds && !this.spinning) this.reels.forEach((r, i) => list.push([r.hold ? `Held ${i + 1}` : `Hold ${i + 1}`, () => { r.hold = !r.hold; this.ui(); }, r.hold ? 'on' : '']));
    h.buttons(list);
  }
  spin() {
    if (this.spinning) return;
    if (!spend(this.h.me, 1)) { this.h.G.hud?.toast?.('No cash left for the machine'); return; }
    const now = performance.now() / 1000; this.spinning = true;
    this.reels.forEach((r, i) => { if (r.hold && this.holds) return; r.until = now + 0.7 + i * 0.45; r.next = STRIP[Math.floor(Math.random() * STRIP.length)]; });
    this.ui();
  }
  frame(t) {
    const c = this.h.ctx, { W, H } = this.h;
    if (this.spinning && this.reels.every(r => !r.until || t >= r.until)) {
      this.spinning = false;
      for (const r of this.reels) if (r.until) { r.s = r.next; r.until = 0; }
      const res = this.reels.map(r => r.s), pay = fruitPay(res), heldNow = this.holds;
      for (const r of this.reels) r.hold = false;
      this.holds = !pay && !heldNow && Math.random() < 0.3;
      if (pay) { this.h.me.cash = cash(this.h.me) + pay; this.h.msg(`${res.join(' ')}  ·  You win ${money(pay)}!`); }
      else this.h.msg(this.holds ? 'Holds available: hold the reels you like, then spin.' : `${res.join(' ')}  ·  No luck.`);
      this.ui();
    }
    // the cabinet
    c.fillStyle = '#1d1030'; c.fillRect(0, 0, W, H);
    const bw = Math.min(W * 0.8, 560), bh = Math.min(H * 0.62, 260), x0 = (W - bw) / 2, y0 = (H - bh) / 2;
    const grad = c.createLinearGradient(0, y0 - 40, 0, y0 + bh + 40); grad.addColorStop(0, '#d84a9a'); grad.addColorStop(1, '#5a2a8a');
    c.fillStyle = grad; c.fillRect(x0 - 24, y0 - 40, bw + 48, bh + 80);
    c.fillStyle = '#fff4d8'; c.font = '800 22px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★ CASH SPINNER ★', W / 2, y0 - 20);
    const rw = bw / 3;
    this.reels.forEach((r, i) => {
      const x = x0 + i * rw;
      c.fillStyle = '#fffaf0'; c.fillRect(x + 6, y0, rw - 12, bh);
      c.save(); c.beginPath(); c.rect(x + 6, y0, rw - 12, bh); c.clip();
      const spinning = r.until && t < r.until;
      const show = (sym, dy, a) => { c.globalAlpha = a; if (sym === 'BAR') { c.fillStyle = '#111'; c.fillRect(x + rw / 2 - 42, y0 + bh / 2 + dy - 18, 84, 36); c.fillStyle = '#fff'; c.font = '800 24px system-ui'; c.fillText('BAR', x + rw / 2, y0 + bh / 2 + dy + 1); } else if (sym === '7') { c.fillStyle = '#d0201a'; c.font = '900 76px system-ui'; c.fillText('7', x + rw / 2, y0 + bh / 2 + dy + 4); } else { c.font = '68px system-ui'; c.fillText(sym, x + rw / 2, y0 + bh / 2 + dy + 4); } c.globalAlpha = 1; };
      if (spinning) { const k = (t * 9 + i) % 1; for (let q = -1; q <= 1; q++) show(STRIP[(Math.floor(t * 9) + q * 5 + i * 7) % STRIP.length], (q + k) * bh * 0.55, 0.75); }
      else show(r.s, 0, 1);
      c.restore();
      if (r.hold) { c.fillStyle = '#ffd25a'; c.font = '800 16px system-ui'; c.fillText('HELD', x + rw / 2, y0 + bh + 18); }
    });
    c.strokeStyle = '#ff3a3a'; c.lineWidth = 3; c.beginPath(); c.moveTo(x0, y0 + bh / 2); c.lineTo(x0 + bw, y0 + bh / 2); c.stroke();
    c.fillStyle = '#fff4d8'; c.font = '600 13px system-ui'; c.fillText('7 7 7 £100 · BAR ×3 £40 · 🔔×3 £20 · 🍇×3 £12 · 🍊×3 £10 · 🍋/🍒×3 £8 · 🍒🍒 £2 · pair £1', W / 2, y0 + bh + 40);
  }
}
