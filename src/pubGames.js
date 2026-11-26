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
    const tx = x + gauss() * sd, ty = y + gauss() * sd, sc = dartScore(tx, ty);
    this.thrown.push({ x: tx, y: ty, ...sc, who: this.turn }); this.scores[this.turn] += sc.s;
    if (this.thrown.length >= 3) { this.busy = true; setTimeout(() => this.next(), 1300); }
  }
  next() {
    this.busy = false; this.thrown = [];
    if (this.turn === 1) this.round++;
    this.turn = 1 - this.turn;
    if (this.round > 3) { this.over = true; const won = this.scores[0] > this.scores[1]; this.h.settle(won, this.stake, this.name); this.h.buttons([['Play again', () => this.h.start('darts', this.h.site)], ['Done', () => this.h.close()]]); this.h.msg(this.scores[0] === this.scores[1] ? 'A draw!' : won ? 'You win!' : `${this.name} wins.`); if (this.scores[0] === this.scores[1] && this.stake) this.h.me.cash = cash(this.h.me) + this.stake; return; }
    this.h.msg(this.turn === 0 ? `Round ${this.round}: your darts.` : `${this.name} steps up…`);
    if (this.turn === 1) this.cpuT = performance.now() / 1000 + 1;
  }
  frame(t) {
    const c = this.h.ctx, { W, H } = this.h, g = this.geom;
    // the opponent: aims for treble 20 (the bull now and then), a pub player's scatter
    if (this.turn === 1 && !this.over && !this.busy && t > this.cpuT && this.thrown.length < 3) { this.cpuT = t + 0.9; const bull = Math.random() < 0.15; this.throwAt(0, bull ? 0 : 103, 21); }
    // the sway: a slow figure of eight round your finger
    const amp = 13 + (this.h.me.drunk || 0) * 4;
    this.wob = this.aim ? [this.aim[0] + Math.sin(t * 1.9) * amp, this.aim[1] + Math.sin(t * 3.1 + 1) * amp * 0.8] : null;
    c.fillStyle = '#1b130d'; c.fillRect(0, 0, W, H);
    // the board
    const seg = (r0, r1, i, col) => { const a0 = (90 - (i * 18 - 9)) * Math.PI / 180, a1 = (90 - (i * 18 + 9)) * Math.PI / 180; c.beginPath(); c.arc(g.cx, g.cy, r1 * g.k, -a0, -a1); c.arc(g.cx, g.cy, r0 * g.k, -a1, -a0, true); c.closePath(); c.fillStyle = col; c.fill(); };
    c.fillStyle = '#111'; c.beginPath(); c.arc(g.cx, g.cy, 225 * g.k, 0, 7); c.fill();
    for (let i = 0; i < 20; i++) { const dark = i % 2 === 0; seg(15.9, 99, i, dark ? '#1c1c1c' : '#efe2c4'); seg(99, 107, i, dark ? '#c0392b' : '#2e8b4a'); seg(107, 162, i, dark ? '#1c1c1c' : '#efe2c4'); seg(162, 170, i, dark ? '#c0392b' : '#2e8b4a'); }
    c.fillStyle = '#2e8b4a'; c.beginPath(); c.arc(g.cx, g.cy, 15.9 * g.k, 0, 7); c.fill(); c.fillStyle = '#c0392b'; c.beginPath(); c.arc(g.cx, g.cy, 6.35 * g.k, 0, 7); c.fill();
    c.fillStyle = '#e8e0d0'; c.font = `700 ${Math.max(10, 15 * g.k * 1.3)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    ORDER.forEach((n, i) => { const a = (90 - i * 18) * Math.PI / 180; c.fillText(n, g.cx + Math.cos(a) * 197 * g.k, g.cy - Math.sin(a) * 197 * g.k); });
    // darts in the board this turn
    for (const d of this.thrown) { const x = g.cx + d.x * g.k, y = g.cy - d.y * g.k; c.fillStyle = d.who ? '#5ab8ff' : '#ffd25a'; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke(); c.fillStyle = '#fff'; c.font = '700 12px system-ui'; c.fillText(d.label, x, y - 13); }
    // the aim
    if (this.wob) { const x = g.cx + this.wob[0] * g.k, y = g.cy - this.wob[1] * g.k; c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, 7); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke(); }
    // the scores
    const sx = W - 180;
    c.textAlign = 'left'; c.fillStyle = '#fcf5db'; c.font = '700 16px system-ui'; c.fillText(`Round ${Math.min(3, this.round)} of 3`, sx, 40);
    for (const [i, nm] of [[0, this.h.me.short], [1, this.name]]) { c.fillStyle = this.turn === i && !this.over ? '#ffd25a' : '#cfe3d4'; c.font = '700 22px system-ui'; c.fillText(`${nm}: ${this.scores[i]}`, sx, 84 + i * 40); }
    if (this.stake) { c.fillStyle = '#9fd0b0'; c.font = '14px system-ui'; c.fillText(`${money(this.stake)} each on it`, sx, 170); }
    if (!this.aim && this.turn === 0 && !this.over && !this.busy) { c.fillStyle = '#cfe3d4'; c.font = '14px system-ui'; c.fillText(`Dart ${this.thrown.length + 1} of 3`, sx, 200); }
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
        if (b.x < BR) { b.x = BR; b.vx = -b.vx * 0.78; } if (b.x > TL - BR) { b.x = TL - BR; b.vx = -b.vx * 0.78; }
        if (b.y < BR) { b.y = BR; b.vy = -b.vy * 0.78; } if (b.y > TW - BR) { b.y = TW - BR; b.vy = -b.vy * 0.78; }
      } else { b.x = Math.max(-0.03, Math.min(TL + 0.03, b.x)); b.y = Math.max(-0.03, Math.min(TW + 0.03, b.y)); }
    }
    // (several passes, so a knock goes right through a pack of touching balls)
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= BR * 2 || !d) continue;
      const nx = dx / d, ny = dy / d, ov = BR * 2 - d; a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; if (rel <= 0) continue;
      const k = rel * 0.965; a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny;
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
class Pool {
  constructor(host, name, stake) {
    this.h = host; this.name = name; this.stake = stake; this.sim = new PoolSim();
    this.turn = 0; this.group = [null, null]; this.over = false; this.drag = null; this.shooting = false; this.cpuT = 0;
    const cv = host.cv, pt = e => { const r = cv.getBoundingClientRect(); return this.toT(e.clientX - r.left, e.clientY - r.top); };
    cv.onpointerdown = e => { if (this.turn !== 0 || this.over || this.shooting) return; cv.setPointerCapture(e.pointerId); this.drag = pt(e); };
    cv.onpointermove = e => { if (this.drag) this.drag = pt(e); };
    cv.onpointerup = cv.onpointercancel = () => { if (!this.drag) return; const a = this.aim(); this.drag = null; if (a && a.power > 0.04) this.shoot(a.dx * a.power * 5.2, a.dy * a.power * 5.2); };
    host.buttons([]);
    host.msg('Your break: drag back from the white ball to aim and set the power, let go to shoot.');
  }
  get geom() { const pad = 26, k = Math.min((this.h.W - 2 * pad) / TL, (this.h.H - 2 * pad - 30) / TW); return { k, x0: (this.h.W - TL * k) / 2, y0: (this.h.H - TW * k) / 2 + 12 }; }
  toT(px, py) { const g = this.geom; return [(px - g.x0) / g.k, (py - g.y0) / g.k]; }
  aim() { const c = this.sim.balls[0], [px, py] = this.drag; const dx = c.x - px, dy = c.y - py, L = Math.hypot(dx, dy); if (L < 0.01) return null; return { dx: dx / L, dy: dy / L, power: Math.min(1, L / 0.55) }; }
  shoot(vx, vy) { this.sim.shoot(vx, vy); this.shooting = true; this.shooter = this.turn; }
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
    if (cue) { const c = S.balls[0]; c.in = false; c.vx = c.vy = 0; c.x = TL * 0.22; c.y = TW / 2; while (S.balls.some(b => b !== c && !b.in && Math.hypot(b.x - c.x, b.y - c.y) < BR * 2.1)) c.y += BR * 2.2; }
    if (foul || !own) this.turn = o;
    const who = this.turn === 0 ? 'Your shot' : `${this.name}'s shot`;
    this.h.msg(`${foul ? 'Foul! ' : own ? 'Good pot. ' : ''}${who}${this.group[0] ? ` · you're on ${this.onBlack(0) ? 'the black' : this.group[0] + 's'}` : ''}.`);
    if (this.turn === 1) this.cpuT = performance.now() / 1000 + 1.2;
  }
  end(winner, how) {
    this.over = true; const won = winner === 0;
    this.h.msg(`${won ? 'You win' : this.name + ' wins'}: ${how}.`);
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
    this.onBlackBefore = this.onBlack(1); this.shoot(dx * sp, dy * sp);
  }
  frame(t) {
    const S = this.sim, c = this.h.ctx, { W, H } = this.h, g = this.geom;
    // (the balls move in real time whatever the frame rate: 240 steps a second, up to a tenth of a second a frame)
    const dt = Math.min(0.1, Math.max(0, t - (this.lt ?? t))); this.lt = t;
    if (this.shooting) { for (let k = 0, n = Math.max(1, Math.round(dt * 240)); k < n; k++) S.step(1 / 240); if (!S.moving) { this.shooting = false; this.settle(); } }
    else if (this.turn === 1 && !this.over && t > this.cpuT) { this.cpuT = t + 99; this.cpu(); }
    if (!this.shooting && this.turn === 0) this.onBlackBefore = this.onBlack(0);
    c.fillStyle = '#20160f'; c.fillRect(0, 0, W, H);
    const X = x => g.x0 + x * g.k, Y = y => g.y0 + y * g.k;
    // the table
    c.fillStyle = '#5b3a22'; c.fillRect(X(0) - 22, Y(0) - 22, TL * g.k + 44, TW * g.k + 44);
    c.fillStyle = '#1f7a40'; c.fillRect(X(0), Y(0), TL * g.k, TW * g.k);
    c.strokeStyle = '#ffffff55'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(TL * 0.22), Y(0)); c.lineTo(X(TL * 0.22), Y(TW)); c.stroke();
    for (const [px, py, pr] of POCKETS) { c.fillStyle = '#050505'; c.beginPath(); c.arc(X(px), Y(py), pr * g.k * 0.85, 0, 7); c.fill(); }
    // the aim: a line to the first ball and where it'd go
    if (this.drag && !this.shooting) {
      const a = this.aim(), cb = S.balls[0];
      if (a) {
        const hit = S.ray(cb.x, cb.y, a.dx, a.dy, 0), L = hit ? hit.t : 2.2;
        c.strokeStyle = '#ffffffcc'; c.setLineDash([6, 5]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(cb.x), Y(cb.y)); c.lineTo(X(cb.x + a.dx * L), Y(cb.y + a.dy * L)); c.stroke(); c.setLineDash([]);
        if (hit) { const gx = cb.x + a.dx * L, gy = cb.y + a.dy * L; c.strokeStyle = '#ffffff88'; c.beginPath(); c.arc(X(gx), Y(gy), BR * g.k, 0, 7); c.stroke(); const nx = hit.b.x - gx, ny = hit.b.y - gy, nl = Math.hypot(nx, ny); c.strokeStyle = '#ffd25aaa'; c.beginPath(); c.moveTo(X(hit.b.x), Y(hit.b.y)); c.lineTo(X(hit.b.x + nx / nl * 0.25), Y(hit.b.y + ny / nl * 0.25)); c.stroke(); }
        // the cue behind the white, drawn back with the power
        const back = 0.04 + a.power * 0.18; c.strokeStyle = '#c49a68'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(X(cb.x - a.dx * back), Y(cb.y - a.dy * back)); c.lineTo(X(cb.x - a.dx * (back + 0.9)), Y(cb.y - a.dy * (back + 0.9))); c.stroke(); c.lineCap = 'butt';
        c.fillStyle = '#ffd25a'; c.fillRect(X(0), Y(TW) + 26, TL * g.k * a.power, 6);
      }
    }
    // the balls
    for (const b of S.balls) {
      if (b.in) continue;
      const col = { cue: '#f4f2ea', red: '#c8281e', yellow: '#e8c21c', black: '#111111' }[b.c], x = X(b.x), y = Y(b.y), r = BR * g.k;
      c.fillStyle = '#00000055'; c.beginPath(); c.arc(x + r * 0.25, y + r * 0.3, r, 0, 7); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.fillStyle = '#ffffff88'; c.beginPath(); c.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, 7); c.fill();
    }
    // who's on what
    c.font = '700 14px system-ui'; c.textAlign = 'left'; c.textBaseline = 'middle';
    const tag = (i, x, nm) => { const gr = this.group[i]; c.fillStyle = this.turn === i && !this.over ? '#ffd25a' : '#cfe3d4'; c.fillText(`${nm}${gr ? ` (${this.onBlack(i) ? 'on the black' : gr + 's, ' + this.mine(i).length + ' left'})` : ''}`, x, 16); };
    tag(0, 12, this.h.me.short); tag(1, W / 2 + 12, this.name);
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
