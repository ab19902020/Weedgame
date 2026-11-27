import {quietDrive} from './propulsion.js';
import { MODELS } from './vehicles.js';
import fleet from './fleetCues.json';
import cues from './soundCues.json';
import world from './worldCues.json';
import dirtBank from './dirtbikeCues.json';
import roadBikeBank from './motorcycleCues.json';
import v8Bank from './rangeroverCues.json';
import i4Bank from './inline4Cues.json';

// Every sound in the game is a real recording (credits: www/sfx/CREDITS.txt):
//  - sfx/berkshire.ogg  footsteps, doors, horn, crashes, punches, crowd, traffic engines (soundCues.json)
//  - sfx/world.ogg      tyres (road, gravel, squeal, skids), scrape, rain, wind, distant traffic, siren, crossing
//                       bleeps, the car's ignition, doors, handbrake and horn, and the impacts of knocked-down
//                       street furniture (worldCues.json, tools/audio/build_sfx.py)
//  - sfx/rangerover.ogg V8 engine loops at six rpm points (Range Rover, sports cars, coupés)
//  - sfx/inline4.ogg    four-cylinder engine loops at seven rpm points (every other car)
// Loops are crossfaded and re-pitched by what the car is doing; nothing is synthesised.

// These indices follow the landcover palette in the world builder.
const groundSounds = ['grass','boots','boots','tile','water','grass','grass','grass','boots','gravel','gravel','grass','boots','grass','grass','grass','grass','boots','gravel','gravel'];
const ENGINES = { dirtbike:{url:"sfx/dirtbike.ogg",bank:dirtBank}, motorcycle:{url:"sfx/motorcycle.ogg",bank:roadBikeBank}, v8: { url: 'sfx/rangerover.ogg', bank: v8Bank }, i4: { url: 'sfx/inline4.ogg', bank: i4Bank } };
const ALIAS = { Car_Door_Open: ['doorOpen', 1.3], Car_Door_Close: ['doorClose', 1.3], Car_Engine_Start_Up: ['start', 1.4], Car_Engine_Turning_Off: ['stop', 1.3], Car_Parking_Brake: ['handbrake', 1] };
const isMotorbike = model => model === 'motorcycle' || model === 'dirtbike';
const heavyDiesel = model => model === 'bus' || model === 'busS' || model === 'fire';
const engineOf = model => { model = MODELS[model]?.like || model; return isMotorbike(model) ? model : model === 'rangerover' || model === 'sports' || model === 'coupe' ? 'v8' : 'i4'; };

export class Audio {
  constructor(G) {
    this.G = G; this.on = false;
    const start = () => { if (!this.on) this.init(); removeEventListener('pointerdown', start); removeEventListener('keydown', start); };
    addEventListener('pointerdown', start); addEventListener('keydown', start);
  }
  init() {
    const A = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.on = true;
    this.master = A.createGain(); this.master.gain.value = 0.8; this.master.connect(A.destination);
    this.outdoors = A.createGain();
    this.roomTone = A.createGain();
    this.inside = !!this.G.brothers?.me?.inside;
    this.outdoors.gain.value = this.inside ? 0 : 1;
    this.roomTone.gain.value = this.inside ? 0.34 : 0;
    this.outdoors.connect(this.master);
    this.roomTone.connect(this.master);
    this.listener = A.listener;
    // ambient beds: a gain and a filter each (the filter muffles them inside a car); recordings attach on load
    const bed = (hz = 20000) => { const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hz; f.Q.value = 0.5; const g = A.createGain(); g.gain.value = 0; f.connect(g); g.connect(this.outdoors); return { f, g }; };
    this.rain = bed(); this.rainRoof = bed(); this.wind = bed(); this.leaves = bed(); this.hum = bed();
    this.murmur = { g: A.createGain() }; this.murmur.g.gain.value = 0; this.murmur.g.connect(this.outdoors);
    // positioned loops: the nearest siren and the nearest crossing that is bleeping
    const spot = (ref = 10, roll = 1.2) => { const g = A.createGain(); g.gain.value = 0; const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; g.connect(p); p.connect(this.outdoors); return { g, p }; };
    this.siren = spot(25, 1); this.crossing = spot(6, 1.4);
    this.hose = spot(7, 1.3);   // a fire crew's jet: the rain recording's hiss, where the water's landing
    this.railRoll = spot(13, 1.2); this.carCabin = bed(2100); this.diesel = bed(5300);
    this.railPosition = new Float64Array(6);
    // per-vehicle voices for nearby traffic: a recorded engine plus recorded tyre roar on the road
    this.voices = [];
    for (let i = 0; i < 6; i++) {
      const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = A.createGain(); g.gain.value = 0; const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.3;
      const tg = A.createGain(); tg.gain.value = 0; const tf = A.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 1800;
      f.connect(g); g.connect(p); tf.connect(tg); tg.connect(p); p.connect(this.outdoors);
      this.voices.push({ f, g, p, tg, tf });
    }
    // the player's own car: tyre squeal, a heavier screech, road roar and metal scrape, all recorded loops
    const car = (hz = 20000) => { const f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hz; const g = A.createGain(); g.gain.value = 0; f.connect(g); g.connect(this.outdoors); return { f, g }; };
    this.squeal = car(); this.screech = car(); this.road = car(2500); this.gravel = car(3000); this.scrape = car();
    this.lastCue = new Map();
    this.pedSteps = new WeakMap();
    this.engines = {};
    this.ready = Promise.all([
      this.loadClip('garden-bird').then(buf => { this.bird = buf; }).catch(console.warn),
      this.loadClip('passing-engine').then(buf => { this.trafficIdle = buf; }).catch(console.warn),
      this.loadClip('room-tone').then(buf => this.slice(buf, [0, buf.duration], this.roomTone)).catch(console.warn),
      this.loadFleet().catch(error => console.warn('Fleet audio unavailable', error)),
      this.loadRecordings().catch(error => console.warn('Sound recordings unavailable', error)),
      this.loadWorld().catch(error => console.warn('World sound bank unavailable', error)),
    ]);
    this.stepT = 0;
    this.slipWas = 0; this.hbWas = false;
  }
  async loadClip(name) {
    const response = await fetch('sfx/' + name + '.ogg');
    if (!response.ok) throw Error(name + ' HTTP ' + response.status);
    return this.ctx.decodeAudioData(await response.arrayBuffer());
  }
  setInterior(inside) {
    if (!this.ctx || this.inside === inside) return;
    this.inside = inside;
    const t = this.ctx.currentTime;
    for (const [node, level] of [[this.outdoors, inside ? 0 : 1], [this.roomTone, inside ? 0.34 : 0]]) {
      node.gain.cancelAndHoldAtTime(t);
      node.gain.linearRampToValueAtTime(level, t + 0.12);
    }
  }
  async loadRecordings() {
    const response = await fetch('sfx/berkshire.ogg');
    if (!response.ok) throw Error('Sound bank HTTP ' + response.status);
    this.bank = await this.ctx.decodeAudioData(await response.arrayBuffer());
    this.loop('pedestrians', this.murmur.g);

  }
  async loadFleet() {
    const r = await fetch('sfx/fleet.ogg');
    if (!r.ok) throw Error('Fleet audio HTTP ' + r.status);
    this.fleetBank = await this.ctx.decodeAudioData(await r.arrayBuffer());
    this.railRoll.src = this.slice(this.fleetBank, fleet.railRoll, this.railRoll.g);
    this.diesel.src = this.slice(this.fleetBank,fleet.dieselIdle,this.diesel.f);
    this.carCabin.src = this.slice(this.fleetBank, fleet.carCabin, this.carCabin.f);
  }
  departure(name,x,y,z) {
    if (!this.fleetBank) return;
    const cam = this.G.camera.position;
    if (Math.hypot(cam.x-x,cam.z-z) > (name==='railHorn' ? 200 : 70)) return;
    this.shotFrom(this.fleetBank,[fleet[name]],name,x,y+1,z,.65,name==='railHorn' ? 20 : 9);
  }
  updateRail(G,cam,t) {
    if (!this.railRoll.src || t < (this.nextRailCheck || 0)) return;
    this.nextRailCheck = t + .12;
    let nearest = 120, speed = 0;
    if (G.transit.ride === G.transit) {
      this.setPos(this.railRoll.p,cam.x,cam.y,cam.z);
      speed = G.transit.train.v;
    } else for (const tr of G.trains.trains) {
      if (tr.v < .15) continue;
      for (let i=0; i<tr.line.cars; i++) {
        const p = G.trains.track(tr.line,G.trains.carCentre(tr,i),tr.dir,this.railPosition);
        const distance = Math.hypot(p[0]-cam.x,p[1]-cam.y,p[2]-cam.z);
        if (distance >= nearest) continue;
        nearest = distance; speed = tr.v;
        this.setPos(this.railRoll.p,p[0],p[1]+1,p[2]);
      }
    }
    this.railRoll.g.gain.setTargetAtTime(.55*Math.min(1,speed/13),t,.18);
    this.railRoll.src.playbackRate.setTargetAtTime(.7+Math.min(.65,speed/50),t,.16);
  }
  async loadWorld() {
    const r = await fetch('sfx/world.ogg');
    if (!r.ok) throw Error('World sound bank HTTP ' + r.status);
    this.wbank = await this.ctx.decodeAudioData(await r.arrayBuffer());
    const L = (name, node) => this.wloop(name, node);
    L('rain', this.rain.f); L('rainroof', this.rainRoof.f); L('wind', this.wind.f); L('leaves', this.leaves.f); L('traffic', this.hum.f);
    L('siren', this.siren.g); L('crossing', this.crossing.g); L('rain', this.hose.g);
    this.squeal.src = L('squeal', this.squeal.f); this.screech.src = L('screech', this.screech.f); this.road.src = L('road', this.road.f); this.gravel.src = L('gravel', this.gravel.f); L('scrape', this.scrape.f);
    for (const voice of this.voices) voice.tyre = L('road', voice.tf);
  }
  // a looping slice of a bank, started at a random point so repeats never line up
  slice(buf, [start, length], output) {
    const source = this.ctx.createBufferSource();
    source.buffer = buf; source.loop = true; source.loopStart = start; source.loopEnd = start + length;
    source.connect(output); source.start(0, start + Math.random() * length);
    return source;
  }
  loop(name, output) { return this.slice(this.bank, cues[name][0], output); }
  wloop(name, output) { return this.slice(this.wbank, world.loops[name], output); }
  // ---------------------------------------------------------------- engine banks (V8 and inline four)
  // loops at fixed rpm points built from real idles (tools/vehicles/engine_bank*.py), crossfaded by rpm and
  // fine-tuned in rate, opened up by the throttle; plus a real throttle blip
  async loadEngine(kind) {
    if (this.engines[kind] || !this.ctx) return this.engines[kind]?.loading;
    const E = this.engines[kind] = { ready: false }, { url, bank } = ENGINES[kind];
    E.loading = (async () => {
    const r = await fetch(url); if (!r.ok) throw Error(url + ' HTTP ' + r.status);
    const buf = await this.ctx.decodeAudioData(await r.arrayBuffer()), A = this.ctx;
    const out = A.createGain(), filt = A.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2500; filt.Q.value = 0.7;
    out.gain.value = 0; out.connect(filt); filt.connect(this.outdoors);
    const loops = bank.rpm.map(rpm => { const g = A.createGain(); g.gain.value = 0; g.connect(out); return { rpm, g, src: this.slice(buf, bank.cues['r' + rpm], g) }; });
    Object.assign(E, { ready: true, buf, out, filt, loops, lastThr: 0, cues: bank.cues });
    return E;
    })();
    return E.loading;
  }
  engineShot(kind, name, gain = 0.8) {
    const E = this.engines[kind]; if (!E?.ready || !E.cues[name]) return false;
    const [start, len] = E.cues[name], s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = E.buf; g.gain.value = gain; s.connect(g); g.connect(this.outdoors); s.start(0, start, len);
    return true;
  }
  // engine start for the car you get into
  engineStart(v) {
    if (!this.on) return;
    if (quietDrive(v.model) || heavyDiesel(v.model)) return;
    const kind = engineOf(v.model);
    if(isMotorbike(kind)){
      this.loadEngine(kind).then(()=>this.engineShot(kind,'start',.7)).catch(e=>console.warn(e));
      return;
    }
    this.loadEngine(kind).catch(e => console.warn(e));
    if (v.model === 'rangerover') { this.loadEngine('v8').then(() => this.engineShot('v8', 'start', 0.9)).catch(e => console.warn(e)); return; }
    this.play('Car_Engine_Start_Up', v.x, v.y + 0.5, v.z, 0.5);
  }
  // ---------------------------------------------------------------- one-shots
  play(name, x, y, z, gain = 0.4) {
    // the car's own sounds come from better recordings in the world bank (a real ignition, the Peugeot 308's doors)
    const alias = ALIAS[name];
    if (alias && this.wbank) { this.shot(alias[0], x, z, gain * alias[1], y); return; }
    if (!this.bank) return;
    const options = cues[name];
    this.shotFrom(this.bank, options, name, x, y, z, gain, 5);
  }
  // a recorded impact from the world bank (breakables.js): lamp, clang, iron, can, pole, wood, tree, treefall,
  // leaves, bin, brick, thud, glass, skid
  shot(name, x, z, gain = 1, y) {
    if (!this.wbank) return;
    const options = world.shots[name]; if (!options) return;
    const gy = y ?? (this.G.tiles.terrain?.(x, z) ?? this.G.brothers.me.y) + 0.5;
    this.shotFrom(this.wbank, options, 'w:' + name, x, gy, z, gain, 8, 0.94 + Math.random() * 0.12);
  }
  // a short recording from the footstep bank played right at the listener, at `rate` (the pub games: a heel on
  // tile pitched up is the click of the balls and the cue's tip)
  tap(name, gain = 0.4, rate = 1) {
    if (!this.bank || !cues[name]) return;
    const p = this.G.camera.position; this.shotFrom(this.bank, cues[name], 't:' + name, p.x, p.y, p.z, gain, 5, rate, this.master);
  }
  shotFrom(buf, options, key, x, y, z, gain, ref, rate = 1, output = this.outdoors) {
    let index = Math.floor(Math.random() * options.length);
    if (options.length > 1 && index === this.lastCue.get(key)) index = (index + 1) % options.length;
    this.lastCue.set(key, index);
    const [start, length] = options[index];
    const source = this.ctx.createBufferSource(), volume = this.ctx.createGain(), pan = this.ctx.createPanner();
    source.buffer = buf; source.playbackRate.value = rate;
    volume.gain.value = gain;
    pan.refDistance = ref;
    this.setPos(pan, x, y, z);
    source.connect(volume); volume.connect(pan); pan.connect(output);
    source.onended = () => { source.disconnect(); volume.disconnect(); pan.disconnect(); };
    source.start(0, start, length);
  }
  setPos(node, x, y, z) { const p = node; if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
  crash(x, z, k = 1) {
    const y = this.G.tiles.terrain(x,z) ?? this.G.brothers.me.y;
    this.play('crash', x, y + .5, z, .85 * k);
  }
  // the horn sounds for as long as it is held: the recording's attack, then its steady note looped a whole
  // number of cycles at a time, cut off when the button is let go (at least a short honk for a tap)
  horn(x, z) {
    const y = (this.G.tiles.terrain(x, z) ?? this.G.brothers.me.y) + 0.8;
    if (!this.wbank || !world.sustain?.horn) { this.play('Car_Horn', x, y, z, .55); return; }
    if (this.hornV) { this.hornV.t0 = this.ctx.currentTime; return; }
    const [start, , la, lb] = world.sustain.horn, A = this.ctx;
    const s = A.createBufferSource(), g = A.createGain(), p = A.createPanner();
    s.buffer = this.wbank; s.loop = true; s.loopStart = la; s.loopEnd = lb;
    g.gain.value = 0.6; p.refDistance = 6; this.setPos(p, x, y, z);
    s.connect(g); g.connect(p); p.connect(this.outdoors); s.start(0, start);
    s.onended = () => { s.disconnect(); g.disconnect(); p.disconnect(); };
    this.hornV = { s, g, p, t0: A.currentTime };
  }
  step(actor, run, level) {
    if (actor === this.G.brothers.me && actor.inside) {
      if (this.bank) this.shotFrom(this.bank, cues.boots, 'indoor-step', actor.x, actor.y, actor.z, level * 0.75, 5, run ? 1.08 : 1, this.master);
      return;
    }
    let name = groundSounds[this.G.tiles.landcover(actor.x, actor.z)] || 'boots';
    if (run && name === 'boots') name = 'run';
    if ((name === 'run' || name === 'boots') && this.G.world.s.puddle > .1 && Math.random() < this.G.world.s.puddle * .4) {
      this.play('water', actor.x, actor.y, actor.z, level * .5);
    }
    this.play(name, actor.x, actor.y, actor.z, level);
  }
  // ---------------------------------------------------------------- per frame
  update(dt, G) {
    if (!this.on) return;
    const t = this.ctx.currentTime, cam = G.camera.position, me = G.brothers.me;
    this.setInterior(!!me.inside);
    const L = this.listener, f = G.camera.getWorldDirection(this._d || (this._d = new G.THREE.Vector3()));
    if (L.positionX) { L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    this.updateRail(G,cam,t);
    const w = G.world.cur, rain = w.rain;
    const inCar = !!me.vehicle;
    if (this.bird && !me.inside && !inCar && G.treesNear > 0.35 && rain < 0.3 && t > (this.nextBird || 0)) {
      this.nextBird = t + 24 + Math.random() * 45;
      const hour = G.world.hours();
      if (hour >= 5 && hour < 21) {
        const a = Math.random() * Math.PI * 2;
        this.shotFrom(this.bird, [[0, this.bird.duration]], 'blackbird', me.x + 12*Math.cos(a), me.y + 3, me.z + 12*Math.sin(a), 0.38, 8);
      }
    }
    const sheltered = !inCar && G.shelteredAt(me.x, me.y + 1.2, me.z);
    // rain: open = the broad hiss of rain all around; in a car or under a canopy = muffled, with the drumming
    // of drops on the roof over the top
    const covered = inCar || sheltered;
    this.rain.g.gain.setTargetAtTime(rain * (covered ? 0.22 : 0.75), t, 0.4);
    this.rain.f.frequency.setTargetAtTime(covered ? 1100 : 20000, t, 0.3);
    this.rainRoof.g.gain.setTargetAtTime(rain * (inCar ? 0.8 : sheltered ? 0.45 : 0), t, 0.4);
    this.rainRoof.f.frequency.setTargetAtTime(inCar ? 6000 : 3500, t, 0.3);
    const wind = Math.hypot(...G.world.wind) / 10;
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, wind * 0.35) * (inCar ? 0.25 : 1), t, 0.6);
    this.wind.f.frequency.setTargetAtTime(inCar ? 700 : 20000, t, 0.3);
    this.leaves.g.gain.setTargetAtTime(Math.min(0.35, (0.05 + wind * 0.25) * (G.treesNear || 0)) * (inCar ? 0.15 : 1), t, 0.6);
    const busy = Math.min(1, G.traffic.list.filter(v => !v.parked && Math.abs(v.x - cam.x) < 300 && Math.abs(v.z - cam.z) < 300).length / 40);
    this.hum.g.gain.setTargetAtTime((0.08 + busy * 0.3) * (inCar ? 0.5 : 1), t, 0.6);
    this.hum.f.frequency.setTargetAtTime(inCar ? 900 : 20000, t, 0.3);
    const crowd = Math.min(1, G.peds.list.filter(p => Math.abs(p.x - cam.x) < 25 && Math.abs(p.z - cam.z) < 25).length / 10);
    this.murmur.g.gain.setTargetAtTime(crowd * 0.05 * (inCar ? 0.2 : 1), t, 0.4);

    // nearest vehicles get engine voices (recorded engine, re-pitched by speed) and tyre roar on the road
    const near = G.traffic.list.filter(v => !v.parked && !v.player).map(v => [v, (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2]).filter(a => a[1] < 90 * 90).sort((a, b) => a[1] - b[1]).slice(0, this.voices.length);
    const wet = G.world.s.wet > 0.3;
    this.voices.forEach((vo, i) => {
      const it = near[i];
      if (!it) { vo.g.gain.setTargetAtTime(0, t, 0.2); vo.tg.gain.setTargetAtTime(0, t, 0.2); return; }
      const v = it[0], sp = v.v || Math.abs(v.sp || 0), big = v.model.startsWith('bus') || v.model === 'van';
      this.setPos(vo.p, v.x, v.y + 0.6, v.z);
      const sound = heavyDiesel(v.model) ? 'diesel' : isMotorbike(v.model) ? v.model : 'traffic';
      // Select a recorded load band with hysteresis for the two-stroke passing the listener.
      let band = ENGINES[sound]?.bank.rpm[0];
      if (sound === 'dirtbike') {
        band = sp > (vo.band === 5700 ? 10 : 13) ? 5700 : sp > (vo.band === 3600 ? 3 : 5) ? 3600 : 1500;
      }
      if(vo.sound!==sound || vo.band!==band || (sound === 'traffic' && this.trafficIdle && vo.engine?.buffer !== this.trafficIdle)){
        const bank = sound === 'diesel' ? this.fleetBank : sound === 'traffic' ? (this.trafficIdle || this.bank) : this.engines[sound]?.buf;
        if(!bank && isMotorbike(sound) && !this.engines[sound]) this.loadEngine(sound).catch(e=>console.warn(e));
        if(vo.engine){ vo.engine.stop(); vo.engine.disconnect(); vo.engine=null; }
        if(bank){
          const cue=sound==='diesel' ? fleet.dieselIdle : sound==='traffic' ? (bank === this.trafficIdle ? [0, bank.duration] : cues.engine[0]) : ENGINES[sound].bank.cues['r'+band];
          vo.engine=this.slice(bank,cue,vo.f);vo.sound=sound;vo.band=band;
        } else vo.sound=null;
      }
      vo.engine?.playbackRate.setTargetAtTime(sound==='dirtbike' ? .9 + Math.min(.38,sp*.012) : (big ? .72 : .9) + Math.min(1.5, Math.abs(sp) * .048), t, .15);
      vo.f.frequency.setTargetAtTime(1000 + Math.abs(sp) * 85, t, 0.1);
      vo.g.gain.setTargetAtTime(quietDrive(v.model) ? 0 : .32 * (0.4 + Math.min(1, sp / 12)), t, 0.1);
      vo.tyre?.playbackRate.setTargetAtTime(0.8 + Math.min(0.5, sp / 60), t, 0.2);
      vo.tg.gain.setTargetAtTime(Math.min(0.35, sp / 50) * (wet ? 1.6 : 1), t, 0.1);   // louder and hissier when wet
      vo.tf.frequency.setTargetAtTime(wet ? 6000 : 1800, t, 0.2);
    });
    // the player's own car
    const pv = inCar ? G.traffic.byId.get(me.vehicle) : null;
    const diesel = pv && heavyDiesel(pv.model);
    this.diesel.g.gain.setTargetAtTime(diesel ? .38+.40*(pv.ph?.thr||0) : 0,t,.12);
    if (diesel) this.diesel.src?.playbackRate.setTargetAtTime(.85+Math.min(1,(pv.rpm||900)/4500),t,.09);
    const kind = pv && !diesel && !quietDrive(pv.model) ? engineOf(pv.model) : null;
    const cockpit = kind === 'i4' && !pv.def?.wheels && G.brothers.cam.car === 3;
    this.carCabin.g.gain.setTargetAtTime(cockpit ? .42 : 0,t,.13);
    if (cockpit) this.carCabin.src?.playbackRate.setTargetAtTime(Math.min(1.6,.82+(pv.rpm||900)/6200),t,.12);
    for (const [k, E] of Object.entries(this.engines)) if (E.ready && k !== kind) E.out.gain.setTargetAtTime(0, t, 0.2);
    if (pv && pv.ph) {
      const ph = pv.ph, rpm = Math.max(kind==='dirtbike' ? 1500 : 700, pv.rpm || 900), thr = ph.thr || 0, sp = Math.abs(pv.sp || 0);
      const E = kind && (this.engines[kind] || (this.loadEngine(kind).catch(e => console.warn(e)), null));
      if (E?.ready) {
        // the two nearest rpm loops, equal-power crossfade, each re-pitched to the exact rpm
        const Lp = E.loops; let i = 0; while (i < Lp.length - 2 && rpm > Lp[i + 1].rpm) i++;
        const a = Lp[i], b = Lp[i + 1], k = Math.max(0, Math.min(1, (rpm - a.rpm) / (b.rpm - a.rpm)));
        for (const l of Lp) {
          const g = l === a ? Math.cos(k * Math.PI / 2) : l === b ? Math.sin(k * Math.PI / 2) : 0;
          l.g.gain.setTargetAtTime(g, t, 0.04);
          if (g > 0) l.src.playbackRate.setTargetAtTime(Math.max(0.6, Math.min(1.6, rpm / l.rpm)), t, 0.03);
        }
        // on throttle the engine is louder and brighter; lifting off (and braking) it drops to a quiet burble
        const v8 = kind === 'v8';
        E.out.gain.setTargetAtTime((v8 ? 0.32 : 0.26) + thr * (v8 ? 0.5 : 0.42) + Math.min(0.15, rpm / 40000), t, 0.06);
        E.filt.frequency.setTargetAtTime(kind === 'dirtbike' ? 2900 + thr*6200 + rpm*.4 : (900 + thr * 5200 + rpm * 0.5)*(cockpit ? .48 : 1), t, 0.06);
        if (thr > 0.85 && E.lastThr < 0.3 && sp < 2 && performance.now() - (E.blipT || 0) > 2500) { E.blipT = performance.now(); this.engineShot(kind, 'blip', v8 ? 0.45 : 0.35); }
        E.lastThr = thr;
      }
      // tyres: road roar rising with speed; a squeal when they slide or lock, a heavier screech in a big slide,
      // and a recorded skid as a hard stop or handbrake turn begins. Light and moderate braking is silent, as
      // it is in a real car: only tyres past their grip make a sound.
      const slip = ph.slip || 0, wetK = G.world.s.wet > 0.3 ? 0.35 : 1, soft = ph.soft ? 0.25 : 1;
      // off the tarmac (gravel, grass, dirt) the road roar gives way to stones and earth under the tyres
      const lc = G.tiles.landcover(pv.x, pv.z), off = !(lc === 1 || lc === 2 || lc === 12) ? 1 : 0;
      this.offK = (this.offK ?? off) + (off - (this.offK ?? off)) * Math.min(1, dt * 6);
      this.gravel.g.gain.setTargetAtTime(Math.min(0.6, sp / 22) * this.offK * (ph.soft ? 0.7 : 1), t, 0.08);
      this.gravel.f.frequency.setTargetAtTime(ph.soft ? 1400 : 5000, t, 0.1);
      this.gravel.src?.playbackRate.setTargetAtTime(0.8 + Math.min(0.5, sp / 40), t, 0.1);
      this.road.g.gain.setTargetAtTime(Math.min(0.5, sp / 40) * (1 - this.offK * 0.85) * (G.world.s.wet > 0.3 ? 1.4 : 1), t, 0.08);
      this.road.f.frequency.setTargetAtTime((ph.soft ? 900 : 1600) + sp * 40 + (G.world.s.wet > 0.3 ? 3000 : 0), t, 0.1);
      this.road.src?.playbackRate.setTargetAtTime(0.75 + Math.min(0.55, sp / 55), t, 0.1);
      const sq = slip > 0.12 ? Math.min(1, (slip - 0.12) / 0.6) : 0;
      this.squeal.g.gain.setTargetAtTime(sq * 0.55 * wetK * soft * Math.min(1, sp / 5), t, 0.05);
      this.squeal.src?.playbackRate.setTargetAtTime(0.9 + Math.min(0.25, sp / 120), t, 0.1);
      this.screech.g.gain.setTargetAtTime(Math.max(0, sq - 0.55) * 0.9 * wetK * soft * Math.min(1, sp / 8), t, 0.07);
      if ((slip > 0.5 && this.slipWas < 0.25 && sp > 7) || (ph.hb && !this.hbWas && sp > 6)) this.shot('skid', pv.x, pv.z, 0.5 * wetK * soft, pv.y + 0.3);
      if (ph.hb && !this.hbWas && sp < 1.5) this.play('Car_Parking_Brake', pv.x, pv.y + 0.8, pv.z, 0.5);
      this.slipWas = slip; this.hbWas = !!ph.hb;
      this.scrape.g.gain.setTargetAtTime((ph.scrape || 0) * 0.6, t, 0.05);
    } else {
      for (const n of [this.squeal, this.screech, this.road, this.gravel, this.scrape]) n.g.gain.setTargetAtTime(0, t, 0.15);
      this.slipWas = 0; this.hbWas = false;
    }
    // let the horn go when the button is released
    if (this.hornV) {
      const H = this.hornV, held = G.input?.held.has('horn') || G.input?.padHorn;
      if (pv) this.setPos(H.p, pv.x, (pv.y || 0) + 0.8, pv.z);
      if (!(held && pv) && t - H.t0 > 0.28) { H.g.gain.setTargetAtTime(0, t, 0.02); H.s.stop(t + 0.15); this.hornV = null; }
    }
    // footsteps
    const running = G.brothers.speedNow > 3;
    if (!inCar && !G.transit.ride && !(G.brothers.actor[G.brothers.active].jumpTime > 0) && !me.swimming && !G.brothers.actor[G.brothers.active].wading && G.brothers.speedNow > .4) {
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
    // a pelican crossing bleeping while the green man shows (the nearest one within earshot)
    let cx = null;
    for (const c of G.signals.ctl) if (c.peds.length && c.phase === 'W') { const d = Math.hypot(c.x - cam.x, c.z - cam.z); if (d < 40 && (!cx || d < cx[1])) cx = [c, d]; }
    if (cx) this.setPos(this.crossing.p, cx[0].x, (G.tiles.terrain(cx[0].x, cx[0].z) ?? me.y) + 1.2, cx[0].z);
    this.crossing.g.gain.setTargetAtTime(cx ? 0.35 * (inCar ? 0.4 : 1) : 0, t, 0.03);
    // the nearest police siren
    let sv = null;
    for (const v of G.traffic.list) if (v.siren) { const d = Math.hypot(v.x - cam.x, v.z - cam.z); if (d < 400 && (!sv || d < sv[1])) sv = [v, d]; }
    if (sv) this.setPos(this.siren.p, sv[0].x, (sv[0].y || 0) + 1.5, sv[0].z);
    this.siren.g.gain.setTargetAtTime(sv ? 0.55 : 0, t, 0.15);
    // a fire crew's hose on (emergency.js)
    const hs = G.emergency?.hoseAt(cam);
    if (hs) this.setPos(this.hose.p, hs[0], hs[1], hs[2]);
    this.hose.g.gain.setTargetAtTime(hs ? 0.6 * (inCar ? 0.45 : 1) : 0, t, 0.25);
  }
}
