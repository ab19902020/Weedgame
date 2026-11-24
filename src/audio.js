import cues from './soundCues.json';
import rrBank from './rangeroverCues.json';

// These indices follow the landcover palette in the world builder.
const groundSounds = ['grass','boots','boots','tile','water','grass','grass','grass','boots','gravel','gravel','grass','boots','grass','grass','grass','grass','boots','gravel','gravel'];
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
    this.murmur = {g:A.createGain()}; this.murmur.g.gain.value=0; this.murmur.g.connect(this.master);          // crowd voices
    // per-vehicle engine voices
    this.voices = [];
    for (let i = 0; i < 6; i++) {
      const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = A.createGain(); g.gain.value = 0; const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.3;
      const tn = A.createBufferSource(); tn.buffer = noise; tn.loop = true; const tf = A.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 900; const tg = A.createGain(); tg.gain.value = 0;
      f.connect(g); g.connect(p); tn.connect(tf); tf.connect(tg); tg.connect(p); p.connect(this.master); tn.start();
      this.voices.push({ f, g, p, tg, tf });
    }
    this.lastCue = new Map();
    this.pedSteps = new WeakMap();
    this.ready = this.loadRecordings().catch(error => console.warn('Sound recordings unavailable', error));
    this.stepT = 0; this.beepT = 0; this.sirenT = 0;
    // the player's car: engine (two detuned saws, firing frequency from rpm, intake opening with throttle),
    // tyre squeal on slides and a metal scrape against walls
    const eng = { g: A.createGain(), f: A.createBiquadFilter(), o1: A.createOscillator(), o2: A.createOscillator(), sub: A.createOscillator() };
    eng.o1.type = 'sawtooth'; eng.o2.type = 'sawtooth'; eng.sub.type = 'sine'; eng.f.type = 'lowpass'; eng.f.Q.value = 2.5; eng.g.gain.value = 0;
    for (const o of [eng.o1, eng.o2, eng.sub]) { o.connect(eng.f); o.start(); }
    eng.f.connect(eng.g); eng.g.connect(this.master);
    this.eng = eng;
    const sq = { o: A.createOscillator(), lfo: A.createOscillator(), lg: A.createGain(), g: A.createGain() };
    sq.o.type = 'triangle'; sq.o.frequency.value = 1150; sq.lfo.frequency.value = 7; sq.lg.gain.value = 60;
    sq.lfo.connect(sq.lg); sq.lg.connect(sq.o.frequency); sq.o.connect(sq.g); sq.g.gain.value = 0; sq.g.connect(this.master); sq.o.start(); sq.lfo.start();
    this.squeal = sq;
    this.scrape = bed('bandpass', 650, 1.6);
  }
  async loadRecordings() {
    const response = await fetch('sfx/berkshire.ogg');
    if (!response.ok) throw Error('Sound bank HTTP ' + response.status);
    this.bank = await this.ctx.decodeAudioData(await response.arrayBuffer());
    this.loop('pedestrians', this.murmur.g);
    for (const voice of this.voices) voice.engine = this.loop('engine', voice.f);
  }
  loop(name, output) {
    const [start, length] = cues[name][0];
    const source = this.ctx.createBufferSource();
    source.buffer = this.bank;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = start + length;
    source.connect(output);
    source.start(0, start + Math.random() * length);
    return source;
  }
  // Range Rover V8: a bank of seamless loops at six rpm points built from a real V8 (tools/vehicles/engine_bank.py),
  // crossfaded by rpm and fine-tuned in rate, opened up by the throttle; start-up and throttle-blip one-shots
  async loadRangeRover() {
    if (this.rr || !this.ctx) return this.rr;
    this.rr = { ready: false };
    const r = await fetch('sfx/rangerover.ogg'); if (!r.ok) throw Error('Range Rover bank HTTP ' + r.status);
    const buf = await this.ctx.decodeAudioData(await r.arrayBuffer()), A = this.ctx;
    const out = A.createGain(), filt = A.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2500; filt.Q.value = 0.7;
    out.gain.value = 0; out.connect(filt); filt.connect(this.master);
    const loops = rrBank.rpm.map(rpm => {
      const [start, len] = rrBank.cues['r' + rpm], src = A.createBufferSource(), g = A.createGain();
      src.buffer = buf; src.loop = true; src.loopStart = start; src.loopEnd = start + len; g.gain.value = 0;
      src.connect(g); g.connect(out); src.start(0, start + Math.random() * len);
      return { rpm, src, g };
    });
    Object.assign(this.rr, { ready: true, buf, out, filt, loops, lastThr: 0 });
    return this.rr;
  }
  rrOneShot(name, gain = 0.8) {
    const R = this.rr; if (!R?.ready) return false;
    const [start, len] = rrBank.cues[name], s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = R.buf; g.gain.value = gain; s.connect(g); g.connect(this.master); s.start(0, start, len);
    return true;
  }
  // engine start / stop for the car you get into or out of
  engineStart(v) {
    if (!this.on) return;
    if (v.model === 'rangerover') { this.loadRangeRover().then(() => this.rrOneShot('start', 0.9)).catch(e => console.warn(e)); return; }
    this.play('Car_Engine_Start_Up', v.x, v.y, v.z);
  }
  play(name, x, y, z, gain = 0.4) {
    if (!this.bank) return;
    const options = cues[name];
    let index = Math.floor(Math.random() * options.length);
    if (options.length > 1 && index === this.lastCue.get(name)) index = (index + 1) % options.length;
    this.lastCue.set(name, index);
    const [start, length] = options[index];
    const source = this.ctx.createBufferSource(), volume = this.ctx.createGain(), pan = this.ctx.createPanner();
    source.buffer = this.bank;
    volume.gain.value = gain;
    pan.refDistance = 5;
    this.setPos(pan, x, y, z);
    source.connect(volume); volume.connect(pan); pan.connect(this.master);
    source.onended = () => { source.disconnect(); volume.disconnect(); pan.disconnect(); };
    source.start(0, start, length);
  }
  setPos(node, x, y, z) { const p = node; if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
  oneShot(fn, x, z, gain = 1) {
    if (!this.on) return;
    const A = this.ctx, g = A.createGain(); g.gain.value = gain;
    const p = A.createPanner(); p.refDistance = 8; p.rolloffFactor = 1.2; this.setPos(p, x, 1, z);
    g.connect(p); p.connect(this.master); fn(A, g);
  }
  crash(x, z, k = 1) {
    const y = this.G.tiles.terrain(x,z) ?? this.G.brothers.me.y;
    this.play('crash', x, y + .5, z, .85 * k);
  }
  horn(x, z) {
    this.play('Car_Horn', x, this.G.tiles.terrain(x,z) ?? this.G.brothers.me.y, z, .55);
  }
  step(actor, run, level) {
    let name = groundSounds[this.G.tiles.landcover(actor.x, actor.z)] || 'boots';
    if (run && name === 'boots') name = 'run';
    if ((name === 'run' || name === 'boots') && this.G.world.s.puddle > .1 && Math.random() < this.G.world.s.puddle * .4) {
      this.play('water', actor.x, actor.y, actor.z, level * .5);
    }
    this.play(name, actor.x, actor.y, actor.z, level);
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

    // nearest vehicles get engine voices
    const near = G.traffic.list.filter(v => !v.parked && !v.player).map(v => [v, (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2]).filter(a => a[1] < 90 * 90).sort((a, b) => a[1] - b[1]).slice(0, this.voices.length);
    this.voices.forEach((vo, i) => {
      const it = near[i];
      if (!it) { vo.g.gain.setTargetAtTime(0, t, 0.2); vo.tg.gain.setTargetAtTime(0, t, 0.2); return; }
      const v = it[0], sp = v.v || Math.abs(v.sp || 0), big = v.model.startsWith('bus') || v.model === 'van';
      this.setPos(vo.p, v.x, v.y + 0.6, v.z);
      vo.engine?.playbackRate.setTargetAtTime((big ? .72 : .9) + Math.min(1.5, Math.abs(sp) * .048), t, .15);
      vo.f.frequency.setTargetAtTime(1000 + Math.abs(sp) * 85, t, 0.1);
      vo.g.gain.setTargetAtTime((v.player ? .48 : .32) * (0.4 + Math.min(1, sp / 12)), t, 0.1);
      vo.tg.gain.setTargetAtTime(Math.min(0.12, sp / 120) * (G.world.s.wet > 0.3 ? 2 : 1), t, 0.1); // tyre hiss, louder when wet
      vo.tf.frequency.setTargetAtTime(G.world.s.wet > 0.3 ? 2600 : 900, t, 0.2);
    });
    // the player's own car
    const pv = inCar ? G.traffic.byId.get(me.vehicle) : null;
    if (pv && pv.ph) {
      const ph = pv.ph, rpm = Math.max(700, pv.rpm || 900), thr = ph.thr || 0;
      const cyl = pv.model === 'sports' || pv.model === 'coupe' || pv.model === 'rangerover' ? 8 : pv.model.startsWith('bus') || pv.model === 'van' ? 6 : 4;
      const R = pv.model === 'rangerover' ? (this.rr || (this.loadRangeRover().catch(e => console.warn(e)), this.rr)) : null;
      if (R?.ready) {
        // the two nearest rpm loops, equal-power crossfade, each re-pitched to the exact rpm
        const L = R.loops; let i = 0; while (i < L.length - 2 && rpm > L[i + 1].rpm) i++;
        const a = L[i], b = L[i + 1], k = Math.max(0, Math.min(1, (rpm - a.rpm) / (b.rpm - a.rpm)));
        for (const l of L) {
          const w = l === a ? Math.cos(k * Math.PI / 2) : l === b ? Math.sin(k * Math.PI / 2) : 0;
          l.g.gain.setTargetAtTime(w, t, 0.04);
          if (w > 0) l.src.playbackRate.setTargetAtTime(Math.max(0.6, Math.min(1.6, rpm / l.rpm)), t, 0.03);
        }
        // on throttle the V8 is louder and brighter; lifting off it burbles quietly
        R.out.gain.setTargetAtTime(0.32 + thr * 0.5 + Math.min(0.15, rpm / 40000), t, 0.06);
        R.filt.frequency.setTargetAtTime(900 + thr * 5200 + rpm * 0.5, t, 0.06);
        if (thr > 0.85 && R.lastThr < 0.3 && Math.abs(pv.sp) < 2 && performance.now() - (R.blipT || 0) > 2500) { R.blipT = performance.now(); this.rrOneShot('blip', 0.45); }
        R.lastThr = thr;
      } else if (this.rr?.ready) this.rr.out.gain.setTargetAtTime(0, t, 0.15);
      const f = rpm / 60 * cyl / 2;
      this.eng.o1.frequency.setTargetAtTime(f, t, 0.03); this.eng.o2.frequency.setTargetAtTime(f * 1.006, t, 0.03); this.eng.sub.frequency.setTargetAtTime(f / 2, t, 0.03);
      this.eng.f.frequency.setTargetAtTime(280 + thr * 2200 + rpm * 0.12, t, 0.05);
      // synthesised engine: the whole note for most cars, a thin top layer for the recorded V8
      this.eng.g.gain.setTargetAtTime((R?.ready ? 0.25 * Math.min(1, rpm / 5000) : 1) * (0.045 + thr * 0.06 + Math.min(0.03, rpm / 200000)), t, 0.05);
      this.squeal.g.gain.setTargetAtTime(Math.min(0.09, (ph.slip || 0) * 0.1) * (G.world.s.wet > 0.3 ? 0.3 : 1), t, 0.06);
      this.squeal.o.frequency.setTargetAtTime(950 + Math.min(500, Math.abs(pv.sp) * 12), t, 0.1);
      this.scrape.g.gain.setTargetAtTime((ph.scrape || 0) * 0.3, t, 0.05);
    } else {
      this.eng.g.gain.setTargetAtTime(0, t, 0.2); this.squeal.g.gain.setTargetAtTime(0, t, 0.1); this.scrape.g.gain.setTargetAtTime(0, t, 0.1);
      if (this.rr?.ready) this.rr.out.gain.setTargetAtTime(0, t, 0.25);
    }
    // footsteps
    const running = G.brothers.speedNow > 3;
    if (!inCar && !G.transit.ride && !(G.brothers.actor[G.brothers.active].jumpTime > 0) && G.brothers.speedNow > .4) {
      this.stepT -= dt * (running ? 3.2 : 1.9);
      if (this.stepT <= 0) { this.stepT = 1; this.step(me, running, running ? .48 : .32); }
    }
    for (const ped of G.peds.list) {
      if (!ped.visible || ped.gone || ped.fallT > 0 || !(ped.speedNow > .4) || Math.hypot(ped.x-cam.x,ped.z-cam.z)>14) continue;
      const next = this.pedSteps.get(ped);
      if (next === undefined) this.pedSteps.set(ped, t + Math.random() * .5);
      else if (t >= next) {
        this.step(ped, ped.speedNow > 3, .13);
        this.pedSteps.set(ped, t + (ped.speedNow > 3 ? .32 : .53));
      }
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
