// Procedural WebAudio soundscape (no sampled assets): rain with shelter muffling, wind and
// trees, spatial traffic, footsteps by surface, local voices, horns, sirens, crossing beeps.
export class Audio {
  constructor(G) {
    this.G = G; this.on = false;
    const start = () => { if (!this.on) this.init(); removeEventListener('pointerdown', start); removeEventListener('keydown', start); };
    addEventListener('pointerdown', start); addEventListener('keydown', start);
  }
  init() {
    const A = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.on = true;
    const noise = this.noise = A.createBuffer(1, A.sampleRate * 2, A.sampleRate);
    const d = noise.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2; }
    this.master = A.createGain(); this.master.gain.value = 0.8; this.master.connect(A.destination);
    this.listener = A.listener;
    // beds
    const bed = (type, freq, q) => { const s = A.createBufferSource(); s.buffer = noise; s.loop = true; const f = A.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = A.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g }; };
    this.rain = bed('lowpass', 6000, 0.4);
    this.rainHi = bed('highpass', 3500, 0.5);       // patter on a canopy / car roof
    this.wind = bed('bandpass', 420, 0.6);
    this.leaves = bed('bandpass', 2600, 1.2);
    this.hum = bed('lowpass', 240, 0.8);            // distant traffic rumble
    this.murmur = bed('bandpass', 700, 3);          // crowd voices
    // per-vehicle engine voices
    this.voices = [];
    for (let i = 0; i < 6; i++) {
      const o = A.createOscillator(); o.type = 'sawtooth'; const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = A.createGain(); g.gain.value = 0; const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.3;
      const tn = A.createBufferSource(); tn.buffer = noise; tn.loop = true; const tf = A.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 900; const tg = A.createGain(); tg.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(p); tn.connect(tf); tf.connect(tg); tg.connect(p); p.connect(this.master); o.start(); tn.start();
      this.voices.push({ o, f, g, p, tg, tf, v: null });
    }
    this.stepT = 0; this.beepT = 0; this.sirenT = 0;
  }
  setPos(node, x, y, z) { const p = node; if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
  oneShot(fn, x, z, gain = 1) {
    if (!this.on) return;
    const A = this.ctx, g = A.createGain(); g.gain.value = gain;
    const p = A.createPanner(); p.refDistance = 8; p.rolloffFactor = 1.2; this.setPos(p, x, 1, z);
    g.connect(p); p.connect(this.master); fn(A, g);
  }
  crash(x, z, k = 1) {
    this.oneShot((A, out) => {
      const s = A.createBufferSource(); s.buffer = this.noise; const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; const g = A.createGain();
      g.gain.setValueAtTime(1.2 * k, A.currentTime); g.gain.exponentialRampToValueAtTime(0.001, A.currentTime + 0.9);
      s.connect(f); f.connect(g); g.connect(out); s.start(); s.stop(A.currentTime + 1);
    }, x, z);
  }
  horn(x, z) {
    this.oneShot((A, out) => {
      for (const fr of [415, 520]) { const o = A.createOscillator(); o.type = 'square'; o.frequency.value = fr; const g = A.createGain(); g.gain.value = 0.08; o.connect(g); g.connect(out); o.start(); o.stop(A.currentTime + 0.45); }
    }, x, z);
  }
  step(surface, wet, x, z, run) {
    this.oneShot((A, out) => {
      const s = A.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = A.createBiquadFilter();
      const soft = surface === 'grass' || surface === 'garden';
      f.type = soft ? 'lowpass' : 'bandpass'; f.frequency.value = soft ? 700 : wet ? 2400 : 1500; f.Q.value = soft ? 0.5 : 1.4;
      const g = A.createGain(); const t = A.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime((run ? 0.35 : 0.2) * (soft ? 0.6 : 1), t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + (wet ? 0.16 : 0.09));
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.2);
    }, x, z);
  }
  update(dt, G) {
    if (!this.on) return;
    const A = this.ctx, t = A.currentTime, cam = G.camera.position, me = G.brothers.me;
    const L = this.listener, f = G.camera.getWorldDirection(this._d || (this._d = new G.THREE.Vector3()));
    if (L.positionX) { L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    const w = G.world.cur, rain = w.rain;
    const inCar = !!me.vehicle;
    const sheltered = !inCar && G.shelteredAt(me.x, me.y + 1.2, me.z);
    // rain: open = broad hiss; under a canopy or in a car = muffled with hard patter overhead
    const covered = inCar || sheltered;
    this.rain.g.gain.setTargetAtTime(rain * (covered ? 0.18 : 0.55), t, 0.3);
    this.rain.f.frequency.setTargetAtTime(covered ? 900 : 6500, t, 0.3);
    this.rainHi.g.gain.setTargetAtTime(rain * (covered ? 0.45 : 0.08), t, 0.3);
    this.rainHi.f.frequency.setTargetAtTime(inCar ? 1800 : 3500, t, 0.3);
    const wind = Math.hypot(...G.world.wind) / 10;
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, wind * 0.18) * (inCar ? 0.3 : 1), t, 0.5);
    this.wind.f.frequency.setTargetAtTime(300 + wind * 300 + Math.sin(t * 0.7) * 80, t, 0.5);
    this.leaves.g.gain.setTargetAtTime(Math.min(0.12, wind * 0.1) * (G.treesNear || 0) * (inCar ? 0.2 : 1), t, 0.5);
    const busy = Math.min(1, G.traffic.list.filter(v => !v.parked && Math.abs(v.x - cam.x) < 300 && Math.abs(v.z - cam.z) < 300).length / 40);
    this.hum.g.gain.setTargetAtTime(0.03 + busy * 0.08, t, 0.5);
    const crowd = Math.min(1, G.peds.list.filter(p => Math.abs(p.x - cam.x) < 25 && Math.abs(p.z - cam.z) < 25).length / 10);
    this.murmur.g.gain.setTargetAtTime(crowd * 0.05 * (inCar ? 0.2 : 1), t, 0.4);
    this.murmur.f.frequency.setTargetAtTime(500 + 400 * Math.abs(Math.sin(t * 2.3)), t, 0.05);
    // nearest vehicles get engine voices
    const near = G.traffic.list.filter(v => !v.parked || v.player).map(v => [v, (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2]).filter(a => a[1] < 90 * 90).sort((a, b) => a[1] - b[1]).slice(0, this.voices.length);
    this.voices.forEach((vo, i) => {
      const it = near[i];
      if (!it) { vo.g.gain.setTargetAtTime(0, t, 0.2); vo.tg.gain.setTargetAtTime(0, t, 0.2); return; }
      const v = it[0], sp = v.v || Math.abs(v.sp || 0), big = v.model.startsWith('bus') || v.model === 'van';
      this.setPos(vo.p, v.x, v.y + 0.6, v.z);
      vo.o.frequency.setTargetAtTime((big ? 32 : 45) + sp * (big ? 3 : 5.5), t, 0.1);
      vo.f.frequency.setTargetAtTime(250 + sp * 40, t, 0.1);
      vo.g.gain.setTargetAtTime((v.player ? 0.05 : 0.035) * (0.4 + Math.min(1, sp / 12)), t, 0.1);
      vo.tg.gain.setTargetAtTime(Math.min(0.12, sp / 120) * (G.world.s.wet > 0.3 ? 2 : 1), t, 0.1); // tyre hiss, louder when wet
      vo.tf.frequency.setTargetAtTime(G.world.s.wet > 0.3 ? 2600 : 900, t, 0.2);
    });
    // footsteps
    if (!inCar && (G.brothers.speedNow || 0) > 0.4) {
      this.stepT -= dt * (G.brothers.speedNow > 3 ? 3.2 : 1.9);
      if (this.stepT <= 0) { this.stepT = 1; const lc = G.tiles.landcover(me.x, me.z); const surface = [, 'road', 'pave', , , , , 'grass', , , 'gravel', 'garden'][lc] || 'pave'; this.step(surface, G.world.s.wet > 0.2, me.x, me.z, G.brothers.speedNow > 3); }
    }
    // pelican crossing beeps when the green man shows nearby
    this.beepT -= dt;
    if (this.beepT <= 0) {
      this.beepT = 0.22;
      for (const c of G.signals.ctl) if (c.peds.length && c.phase === 'W' && Math.hypot(c.x - me.x, c.z - me.z) < 30) { this.oneShot((A2, out) => { const o = A2.createOscillator(); o.frequency.value = 2800; const g = A2.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(out); o.start(); o.stop(A2.currentTime + 0.08); }, c.x, c.z); break; }
    }
    // sirens
    this.sirenT -= dt;
    if (this.sirenT <= 0) {
      this.sirenT = 0.65;
      for (const v of G.traffic.list) if (v.siren && Math.hypot(v.x - cam.x, v.z - cam.z) < 400) {
        this.oneShot((A2, out) => { const o = A2.createOscillator(); o.type = 'triangle'; const tt = A2.currentTime; o.frequency.setValueAtTime(950, tt); o.frequency.setValueAtTime(700, tt + 0.33); const g = A2.createGain(); g.gain.value = 0.1; o.connect(g); g.connect(out); o.start(); o.stop(tt + 0.65); }, v.x, v.z, 2);
        break;
      }
    }
  }
}
