// The brothers' living-room TV (Woodley home): sit on the sofa in front of it, turn it on, flick through the
// channels (drawn live onto the screen in the room), watch the episodes when they're packaged with the game, or
// play the games console (Narco Lord, The Results Business: full-screen, with the controller driving them).
// The menu is the game's own panel of buttons: touch, or the controller's D-pad / stick, Cross and Circle
// (controller.js steps through any open panel marked data-pad="menu").
import * as THREE from 'three/webgpu';

const southPark = [
  ['Elon Gets Upgraded', 'Elon_Gets_Upgraded_1080p'],
  ['Interdimensional Cable', 'Interdimensional_Cable_South_Park_1080p'],
  ['Make America Cartman Again', 'Make_America_Cartman_Again_1080p'],
  ['Cancel Anytime', 'Cancel_Anytime_1080p'], ['Drain the Swamp', 'Drain_the_Swamp_1080p'],
  ['Midterm Meltdown', 'Midterm_Meltdown_1080p'], ['Couples Counseling', 'Couples_Counseling_1080p'],
  ['Player Owned', 'Player_Owned_Episode_1080p'], ['Roads Are Optional', 'Roads_Are_Optional_1080p'], ['Free Ride', 'free_ride'],
];
const series = {
  'South Park': southPark,
  'All or Something': [
    ['The Clear Plan', 'ALL_OR_SOMETHING_EP1_THE_CLEAR_PLAN_1080p'],
    ['Three Midfielders', 'all_or_something_ep01_three_midfielders'],
    ['Welcome to Hull', 'all_or_something_ep02_welcome_to_hull'],
    ['Clear the Air', 'ALL_OR_SOMETHING_CLEAR_THE_AIR_1080x1920'],
    ['Why United Are Failing', 'WHY_UNITED_ARE_FAILING_1080x1920']
  ]
};
const CHANNELS = [['BBC Berks News', 'news'], ['Sport: Reading v Swindon', 'sport'], ['Weather', 'weather'], ['Music', 'music'], ['Nature', 'nature']];
const HEADLINES = ['Roadworks on the A329(M) into next week', 'Wokingham council approves new cycle lanes', 'Reading Festival line-up announced',
  'Thames Valley Police appeal for witnesses in Woodley', 'Royal Berkshire Hospital opens new wing', 'Dinton Pastures lake reopens after clean-up',
  'Bracknell shopping centre extends opening hours', 'Bus fares frozen across Reading for the year', 'M4 smart motorway works near junction 10',
  'Record crowds at the Madejski for derby day'];

export class HomeTV {
  constructor(interiors) { this.interiors = interiors; this.generation = 0; this.t = 0; }
  get G() { return this.interiors.G; }
  sit(room) {
    if (this.seated) return;
    const G = this.G, B = G.brothers, sofa = room.plan.items.find(i => i.type.startsWith('sofa'));
    const tv = room.plan.items.find(i => i.type === 'tv');
    if (!sofa || !tv) return;
    this.room = room; this.tv = tv; this.seated = true; this.exitPoint = [B.me.x, B.me.y, B.me.z, B.me.heading];
    const world = it => this.interiors.toWorld(room.site, it.x, it.y);
    const [x, z] = world(sofa), [tx, tz] = world(tv);
    Object.assign(B.me, { x, z, y: room.floor0, heading: Math.atan2(tz - z, tx - x) });
    B.vel.x = B.vel.z = B.speedNow = 0;
    this.cameraTarget = [tx, room.floor0 + tv.base + 0.1 + tv.h / 2, tz];
    this.panel = document.createElement('section'); this.panel.id = 'homeTV'; this.panel.ariaLabel = 'Living room television';
    this.panel.dataset.pad = 'menu';
    this.panel.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.append(this.panel);
    this.off();
  }
  updateSeat(dt) {
    const G = this.G, B = G.brothers, a = B.actor[B.active], p = B.me;
    Object.assign(a, { x: p.x, z: p.z, y: p.y, heading: p.heading, running: false, speed: 0, speedNow: 0, gaitSpeed: 0, pose: 'seated', visible: true });
    a.t += dt;
    const side = p.heading + Math.PI / 2;
    G.camera.position.set(p.x - 0.33 * Math.cos(p.heading) + 0.43 * Math.cos(side), p.y + 1.23, p.z - 0.33 * Math.sin(p.heading) + 0.43 * Math.sin(side));
    G.camera.lookAt(...this.cameraTarget);
    G.input.pressed.clear();
    // a live channel redraws its picture about twenty times a second
    if (this.channel) { this.t += dt; this.acc = (this.acc || 0) + dt; if (this.acc > 0.05) { this.draw(this.acc); this.acc = 0; } }
  }
  clear() {
    this.generation++;
    if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video = null; }
    this.screenOff();
    this.channel = null;
    this.panel.replaceChildren(); this.panel.classList.remove('playing');
  }
  button(label, fn) {
    const b = document.createElement('button'); b.textContent = label; b.onclick = fn; this.panel.append(b); return b;
  }
  // a picture on the TV in the room (the screen's own plane, just in front of the black glass)
  screenOn(map) {
    this.screenOff();
    const tv = this.tv, screen = new THREE.Mesh(new THREE.PlaneGeometry(tv.w - 0.06, tv.h - 0.045), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    screen.rotation.y = -tv.rot;
    screen.position.set(tv.x - 0.042 * Math.sin(tv.rot), tv.base + 0.1 + tv.h * 0.5, tv.y + 0.042 * Math.cos(tv.rot));
    this.room.group.add(screen); this.screen = screen;
  }
  screenOff() {
    if (!this.screen) return;
    this.screen.removeFromParent(); this.screen.material.map?.dispose(); this.screen.material.dispose(); this.screen.geometry.dispose(); this.screen = null;
  }
  off() {
    this.clear(); this.button('Turn TV on', () => this.menu()); this.button('Stand up', () => this.stand());
  }
  menu() {
    this.clear();
    for (const [name, id] of CHANNELS) this.button(name, () => this.watch(id));
    for (const name of Object.keys(series)) this.button(name, () => this.channels(name));
    this.button('Games console', () => this.consoleMenu());
    this.button('Turn TV off', () => this.off()); this.button('Stand up', () => this.stand());
    this.watch('news', true);
  }
  // a live channel: drawn on a canvas, shown on the screen in the room; the menu stays to flick channels
  watch(id, keepMenu = false) {
    if (!keepMenu) { this.clear(); this.menuBack(); }
    if (!this.canvas) { this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 360; }
    this.channel = id; this.t = 0;
    const tex = new THREE.CanvasTexture(this.canvas); tex.colorSpace = THREE.SRGBColorSpace;
    this.tex = tex; this.draw(0); this.screenOn(tex);
  }
  menuBack() {
    for (const [name, id] of CHANNELS) this.button(name, () => { this.channel = null; this.watch(id, true); });
    this.button('TV menu', () => this.menu()); this.button('Turn TV off', () => this.off());
  }
  channels(name) {
    this.seriesName = name; const episodes = series[name];
    this.clear(); episodes.forEach(([title], i) => this.button(title, () => this.play(i)));
    this.button('Back', () => this.menu());
  }
  play(i) {
    this.clear(); const episodes = series[this.seriesName], [title, file] = episodes[i], v = document.createElement('video'); this.video = v;
    v.playsInline = true; v.preload = 'metadata'; v.src = (episodes === southPark ? 'assets/home/episodes/' : 'assets/home/united/') + file + '.mp4';
    const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace;
    this.screenOn(tex);
    const pause = this.button('Pause', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
    v.onpause = () => pause.textContent = 'Play'; v.onplay = () => pause.textContent = 'Pause';
    const next = () => this.play((i + 1) % episodes.length);
    v.onended = next; v.onerror = () => { if (this.video === v) pause.textContent = title + ' unavailable'; };
    this.button('Previous episode', () => this.play((i + episodes.length - 1) % episodes.length)); this.button('Next episode', next); this.button('Episode list', () => this.channels(this.seriesName)); this.button('TV menu', () => this.menu()); v.play().catch(() => { pause.textContent = 'Play'; });
  }
  consoleMenu() {
    this.clear(); this.button('Narco Lord', () => this.game('narco')); this.button('The Results Business', () => this.game('results'));
    this.button('TV menu', () => this.menu());
  }
  async game(id) {
    this.clear(); this.panel.classList.add('playing'); const generation = this.generation;
    this.button('Return to console', () => this.consoleMenu());
    try {
      const res = await fetch('assets/home/' + id + '.html.gz'); if (!res.ok) throw Error();
      const html = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
      if (this.generation !== generation) return;
      const frame = document.createElement('iframe'); frame.title = id === 'narco' ? 'Narco Lord' : 'The Results Business';
      frame.dataset.pad = 'game';   // (controller.js drives a pointer and the keys inside it)
      frame.srcdoc = html; this.panel.append(frame);
    } catch { if (this.generation === generation) this.button('Retry game', () => this.game(id)); }
  }
  stand() {
    this.clear(); this.panel.remove(); this.seated = false; this.tex = null;
    const B = this.G.brothers; [B.me.x, B.me.y, B.me.z, B.me.heading] = this.exitPoint;
    this.G.input.pressed.clear(); this.room = null;
  }
  // ---------------------------------------------------------------- the channels
  draw(dt) {
    const c = this.canvas.getContext('2d'), W = 640, H = 360, t = this.t, G = this.G;
    const f = this[this.channel]; if (!f) return;
    f.call(this, c, W, H, t, G, dt);
    if (this.tex) this.tex.needsUpdate = true;
  }
  news(c, W, H, t, G) {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1d3a'); g.addColorStop(1, '#16335f'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i++) { c.fillStyle = `rgba(80,140,220,${0.06 + 0.04 * Math.sin(t * 0.7 + i)})`; c.fillRect(i * 90 - 40, 0, 50, H); }
    // the presenter at the desk
    c.fillStyle = '#0a1426'; c.fillRect(150, 250, 340, 110);
    c.fillStyle = '#2a2f3a'; c.beginPath(); c.ellipse(320, 262, 78, 60, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#c8916c'; c.beginPath(); c.arc(320, 170 + Math.sin(t * 2.1) * 1.5, 34, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2a20'; c.beginPath(); c.arc(320, 158, 35, Math.PI, 0); c.fill();
    c.fillStyle = '#e9edf3'; c.fillRect(300, 210, 40, 30);
    // lower third and the ticker: local headlines, and whatever the police are dealing with now
    const live = (G.police?.incidents || []).filter(i => i.status !== 'cleared').map(i => 'Live: ' + i.label);
    const lines = [...live, ...HEADLINES], k = Math.floor(t / 6) % lines.length;
    c.fillStyle = '#b80f1f'; c.fillRect(0, 280, 120, 34); c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif'; c.fillText(live.length ? 'BREAKING' : 'BERKS NEWS', 10, 303);
    c.fillStyle = 'rgba(255,255,255,0.94)'; c.fillRect(120, 280, W - 120, 34); c.fillStyle = '#0b1d3a'; c.font = 'bold 17px sans-serif'; c.fillText(lines[k].slice(0, 58), 132, 303);
    c.fillStyle = '#081428'; c.fillRect(0, 314, W, 30); c.fillStyle = '#f2c94c'; c.font = '15px sans-serif';
    const tick = lines.join('   •   '), w = c.measureText(tick).width, x = W - ((t * 70) % (w + W));
    c.fillText(tick, x, 334);
    const hr = G.world?.hours?.() ?? 12; c.fillStyle = '#fff'; c.font = 'bold 16px sans-serif';
    c.fillText(`${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.floor((hr % 1) * 60)).padStart(2, '0')}`, W - 62, 28);
  }
  sport(c, W, H, t, G, dt) {
    const s = this.match ||= { ball: [320, 180], v: [60, 20], score: [0, 0], players: Array.from({ length: 22 }, (_, i) => [100 + (i % 11) * 42, 70 + Math.floor(i / 11) * 200 + (i % 3) * 25]), min: 1 };
    for (let k = 0; k < 14; k++) { c.fillStyle = k % 2 ? '#2f8a3a' : '#34953f'; c.fillRect(k * W / 14, 0, W / 14 + 1, H); }
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.strokeRect(20, 20, W - 40, H - 40); c.beginPath(); c.moveTo(W / 2, 20); c.lineTo(W / 2, H - 20); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 40, 0, Math.PI * 2); c.stroke(); c.strokeRect(20, H / 2 - 60, 60, 120); c.strokeRect(W - 80, H / 2 - 60, 60, 120);
    // the ball rolls and bounces; the players chase it, each holding a bit of their own shape
    const b = s.ball; b[0] += s.v[0] * dt; b[1] += s.v[1] * dt; s.v[0] *= 0.995; s.v[1] *= 0.995;
    if (b[1] < 26 || b[1] > H - 26) s.v[1] *= -1;
    if (b[0] < 22 || b[0] > W - 22) {
      if (b[1] > H / 2 - 50 && b[1] < H / 2 + 50) { s.score[b[0] < W / 2 ? 1 : 0]++; b[0] = W / 2; b[1] = H / 2; } else s.v[0] *= -1;
    }
    if (Math.hypot(s.v[0], s.v[1]) < 25) { const a = Math.random() * Math.PI * 2; s.v = [Math.cos(a) * 110, Math.sin(a) * 70]; }
    s.players.forEach((p, i) => {
      const home = [80 + (i % 11) * 48, 60 + (i * 37) % 240], k = i % 11 === 0 ? 0.2 : 0.6;
      const tx = b[0] * k + home[0] * (1 - k), ty = b[1] * k + home[1] * (1 - k);
      p[0] += (tx - p[0]) * Math.min(1, dt * 1.6); p[1] += (ty - p[1]) * Math.min(1, dt * 1.6);
      c.fillStyle = i < 11 ? '#1d4fa8' : '#d72b2b'; c.beginPath(); c.arc(p[0], p[1], 6, 0, Math.PI * 2); c.fill();
    });
    c.fillStyle = '#fff'; c.beginPath(); c.arc(b[0], b[1], 4, 0, Math.PI * 2); c.fill();
    s.min = Math.min(90, 1 + Math.floor(t / 4));
    c.fillStyle = 'rgba(10,15,25,0.85)'; c.fillRect(20, 20, 210, 30); c.fillStyle = '#fff'; c.font = 'bold 17px sans-serif';
    c.fillText(`RDG ${s.score[0]} - ${s.score[1]} SWI   ${s.min}'`, 30, 41);
  }
  weather(c, W, H, t, G) {
    c.fillStyle = '#0d2a45'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#3f7a4a'; c.beginPath(); c.moveTo(60, 120); c.bezierCurveTo(180, 60, 380, 70, 590, 110); c.lineTo(600, 250); c.bezierCurveTo(420, 300, 200, 300, 70, 260); c.closePath(); c.fill();
    c.strokeStyle = '#5f9cc6'; c.lineWidth = 4; c.beginPath(); c.moveTo(60, 170); c.bezierCurveTo(200, 150, 300, 200, 600, 160); c.stroke();
    const rain = G.world?.cur?.rain ?? 0, cover = G.world?.cur?.cover ?? 0.3, night = G.U?.night?.value ?? 0;
    const temp = Math.round(8 + 10 * (1 - night) * (1 - cover * 0.5));
    const towns = [['Newbury', 120, 220], ['Reading', 330, 160], ['Woodley', 400, 150], ['Wokingham', 420, 225], ['Bracknell', 500, 235], ['Maidenhead', 540, 120]];
    for (const [name, x, y] of towns) {
      c.fillStyle = '#fff'; c.font = '14px sans-serif'; c.fillText(name, x - 28, y + 32);
      if (cover > 0.45 || rain > 0.1) { c.fillStyle = '#d8dee6'; c.beginPath(); c.arc(x - 10, y, 13, 0, Math.PI * 2); c.arc(x + 6, y - 6, 16, 0, Math.PI * 2); c.arc(x + 18, y + 2, 11, 0, Math.PI * 2); c.fill(); }
      else { c.fillStyle = night > 0.5 ? '#e8e3c0' : '#f6c94a'; c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.fill(); }
      if (rain > 0.1) { c.strokeStyle = '#7fb6ff'; c.lineWidth = 2; for (let k = 0; k < 3; k++) { const yy = y + 12 + ((t * 40 + k * 7) % 14); c.beginPath(); c.moveTo(x - 8 + k * 8, yy); c.lineTo(x - 11 + k * 8, yy + 6); c.stroke(); } }
      c.fillStyle = '#ffdd55'; c.font = 'bold 15px sans-serif'; c.fillText(`${temp + Math.round(((x * 7) % 5) - 2)}°`, x + 18, y - 12);
    }
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, H - 46, W, 46); c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif';
    c.fillText(rain > 0.4 ? 'Heavy rain this evening, take care on the roads' : rain > 0.1 ? 'Showers on and off, brighter later' : cover > 0.5 ? 'Grey and mild, staying dry' : 'Sunny spells across Berkshire', 20, H - 18);
  }
  music(c, W, H, t) {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${(t * 20) % 360},70%,25%)`); g.addColorStop(1, `hsl(${(t * 20 + 120) % 360},70%,15%)`); c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 32; i++) {
      const h = (0.3 + 0.7 * Math.abs(Math.sin(t * (2 + i * 0.13) + i))) * (H * 0.55);
      c.fillStyle = `hsl(${(i * 11 + t * 40) % 360},85%,60%)`; c.fillRect(20 + i * 19, H - 50 - h, 14, h);
    }
    c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif'; c.fillText('Berkshire FM · Non-stop hits', 20, 36);
  }
  nature(c, W, H, t) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#87b5d8'); g.addColorStop(0.6, '#d8e8d0'); g.addColorStop(0.61, '#4b7d3f'); g.addColorStop(1, '#2f5a2a'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let k = 0; k < 6; k++) { const x = ((k * 140 + t * 12) % (W + 200)) - 100; c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.ellipse(x, 50 + k * 9, 48, 14, 0, 0, Math.PI * 2); c.fill(); }
    // a fox trotting across the meadow
    const fx = ((t * 45) % (W + 120)) - 60, fy = 270 + Math.sin(t * 9) * 2;
    c.fillStyle = '#c4641f'; c.beginPath(); c.ellipse(fx, fy, 30, 12, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(fx + 32, fy - 8, 12, 9, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(fx - 28, fy - 3); c.quadraticCurveTo(fx - 58, fy - 18, fx - 62, fy + 4); c.lineTo(fx - 30, fy + 4); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(fx - 60, fy + 1, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c4641f'; for (const dx of [-18, -8, 14, 24]) c.fillRect(fx + dx, fy + 8, 4, 14 + Math.sin(t * 12 + dx) * 3);
    c.fillStyle = '#fff'; c.font = 'italic 18px serif'; c.fillText('Wild Berkshire: the red fox', 20, H - 18);
  }
}
