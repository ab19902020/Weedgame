// The two playable Ward brothers, Cal and Leon: Tripo rigs with 21 and 20 clips (prepared by
// tools/characters/prepare-hero.mjs), each with its own skeleton and mixer. They are the only skinned GLB
// characters in the game; everyone else on the street is the procedural crowd (humans.js), which also draws
// every pedestrian's hit and shot reactions.
import { AnimationMixer, AnimationClip, Group, LoopOnce } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// per-role clip names for the game's states, natural walk/run speeds (m/s) and presentation
export const ROLES = {
  cal: {
    idle: 'standing_relax', walk: 'walk', run: 'run', jump: 'run_upstairs', swim: 'swim', hit: 'box_01',
    once: ['run_upstairs', 'front_kick_01', 'front_kick_02', 'box_01', 'box_02', 'turn', 'fall', 'scratch'],
    fidgets: ['scratch', 'turn'],
    clips: ['standing_relax', 'walk', 'run', 'swim', 'run_upstairs', 'scratch', 'turn', 'dance_04', 'box_01', 'box_02', 'front_kick_01',
      'front_kick_02', 'chop', 'slash', 'shovel', 'surf', 'fall', 'sit', 'make_a_call_01', 'play_mobile_game', 'play_video_game'],
    // the source rig is 0.959 units tall; Cal is 1.78 m. In-place walk covers 1.16 m/s, run 4.18 m/s at this scale
    scale: 1.78 / 0.959, walkSpeed: 1.16, runSpeed: 4.18, jumpScale: 1.2, hitScale: 1.8, swimTilt: false, prop: null, range: 160, hero: true, shadow: true,
  },
  leon: {
    // his own 'idle' sags into a half-seated crouch, so he stands with Cal's 'standing_relax', retargeted onto his
    // skeleton (tools/characters/retarget_idle.py → characters/leon_idle.json, loaded with his model)
    idle: 'standing_relax', extraClips: ['characters/leon_idle.json'], walk: 'walk', run: 'run', jump: 'jump', swim: 'swim', hit: 'front_kick_02', phone: 'make_a_call_01',
    // one-shot clips (the rest loop); fidgets play now and then while he stands still
    once: ['jump', 'front_kick_01', 'front_kick_02', 'jump_down', 'climb', 'greet_01', 'flip', 'pitch_baseball', 'turn', 'agree', 'laugh_01', 'afraid', 'run_upstairs'],
    fidgets: ['agree', 'laugh_01', 'turn', 'make_a_call_01'],
    clips: ['idle', 'walk', 'run', 'jump', 'swim', 'agree', 'greet_01', 'laugh_01', 'afraid', 'turn', 'make_a_call_01', 'make_a_call_02',
      'front_kick_01', 'front_kick_02', 'flip', 'pitch_baseball', 'shovel', 'climb', 'jump_down', 'run_upstairs'],
    // the source rig is 0.971 units tall; Leon is 1.81 m. In-place walk covers 1.21 m/s, run 4.38 m/s at this scale
    scale: 1.81 / 0.971, walkSpeed: 1.21, runSpeed: 4.38, jumpScale: 2.2, hitScale: 1.5, swimTilt: false, prop: null, range: 160, hero: true, shadow: true,
  },
};
function roleOf(a) {
  if (a.previewRole) return a.previewRole;
  if (a.id === 'brother0') return 'cal';
  if (a.id === 'brother1') return 'leon';
  return null;
}

const byDistance = (a, b) => a.distance - b.distance;
export class RiggedPeople {
  constructor(scene) {
    this.scene = scene;
    this.templates = new Map();
    this.active = new Map();
    this.previewRole = null;
    this.previewClip = 'Idle';
  }
  load(role) {
    if (!this.templates.has(role)) {
      this.templates.set(role, null);
      const extra = Promise.all((ROLES[role]?.extraClips || []).map(url => fetch(url).then(r => r.ok ? r.json() : Promise.reject(Error(url + ' HTTP ' + r.status))).then(j => AnimationClip.parse(j)).catch(e => { console.warn('Clip load failed', url, e); return null; })));
      new GLTFLoader().load('characters/' + role + '.glb', asset => extra.then(clips => {
        for (const c of clips) if (c && !asset.animations.some(a => a.name === c.name)) asset.animations.push(c);
        this.templates.set(role, asset);
      }), undefined, e => console.warn('Character load failed', role, e));
    }
    return this.templates.get(role);
  }
  create(role, asset) {
    const R = ROLES[role], body = clone(asset.scene), root = new Group();
    body.scale.setScalar(R.scale);
    root.add(body);
    if (R.shadow) body.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.frustumCulled = false; } });
    const mixer = new AnimationMixer(body);
    const actions = Object.fromEntries(asset.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
    for (const name of R.once) if (actions[name]) { actions[name].setLoop(LoopOnce, 1); actions[name].clampWhenFinished = true; }
    this.scene.add(root);
    const seatJoints = role === 'leon' ? ['L_Thigh','R_Thigh','L_Calf','R_Calf'].map(name => body.getObjectByName(name)).filter(Boolean).map(bone => ({ bone, rest: bone.quaternion.clone() })) : [];
    // the clip's own pose, saved after each update and put back before the next whenever IK or a reaction has moved
    // bones on top of it (the mixer only writes a value when it changes, so a still clip wouldn't undo them)
    const base = []; body.traverse(n => { if (n.isBone) base.push([n, n.quaternion.clone()]); });
    return {role, root, body, actions, mixer, seatJoints, head:body.getObjectByName('Head'), lock: 0, still: 0, base, extra: false};
  }
  // pick the clip for an actor's state; one-shots (jump, kick, fidgets) hold until they finish
  choose(slot, a, R, dt) {
    const speed = a.gaitSpeed ?? a.speedNow ?? a.speed ?? 0;
    if(a.pose==='seated' && slot.actions.sit)return {clip:'sit',scale:1};
    if (a.previewClip) return { clip: slot.actions[a.previewClip] ? a.previewClip : R.idle, scale: 1 };
    slot.lock = Math.max(0, slot.lock - dt);
    if (a.kickT > 0 && a.kickClip && slot.actions[a.kickClip] && slot.clip !== a.kickClip) { a.kickT = 0; return { clip: a.kickClip, scale: 1.5, hold: true }; }
    if (a.jumpTime > 0 && R.jump && slot.clip !== R.jump) return { clip: R.jump, scale: R.jumpScale || 1, hold: true };
    if (a.hitTime > 0 && R.hit && slot.clip !== R.hit) return { clip: R.hit, scale: R.hitScale || 1, hold: true };
    if (slot.lock > 0) return { clip: slot.clip, scale: slot.scale };
    if (a.pose === 'swim' && R.swim) return { clip: R.swim, scale: speed > 0.25 ? Math.max(0.8, Math.min(1.5, speed / 1.1)) : 0.45 };   // slow strokes treading water
    if (a.pose === 'jump' && R.jump) return { clip: R.jump, scale: 1 };
    if (a.phoneT > 0 && R.phone) return { clip: R.phone, scale: 1 };
    if (speed > 2.5) return { clip: R.run, scale: Math.max(.75, Math.min(1.5, speed / R.runSpeed)) };
    if (speed > .1) { slot.still = 0; return { clip: R.walk, scale: Math.max(.65, Math.min(1.6, speed / R.walkSpeed)) }; }
    // standing: the hero fidgets now and then (nod, laugh, look round, take a call)
    slot.still += dt;
    if (R.fidgets && !a.armed && slot.still > 9 + (slot.wait ??= Math.random() * 8)) {
      slot.still = 0; slot.wait = Math.random() * 10;
      return { clip: R.fidgets[Math.floor(Math.random() * R.fidgets.length)], scale: 1, hold: true };
    }
    return { clip: R.idle, scale: 1 };
  }
  update(actors, cam, dt) {
    const recs = this._recs ||= [], candidates = this._cands ||= []; candidates.length = 0;
    for (const a of actors) {
      if (!a.visible) continue;
      const role = roleOf(a);
      if (!role || !ROLES[role]) continue;
      const distance = (a.x-cam.x)**2 + (a.z-cam.z)**2;
      if (distance < ROLES[role].range ** 2) {
        const r = recs[candidates.length] ||= {}; r.a = a; r.role = role; r.distance = distance;
        candidates.push(r);
      }
    }
    candidates.sort(byDistance);
    const visible = this._vis ||= new Set(); visible.clear();
    for (let ci = 0; ci < candidates.length && ci < 8; ci++) {
      const { a, role } = candidates[ci];
      const asset = this.load(role);
      if (!asset) continue;
      const R = ROLES[role];
      let slot = this.active.get(a.id);
      if (slot && slot.role !== role) { this.remove(a.id, slot); slot = null; }
      if (!slot) { slot = this.kept?.get(a.id); if (slot && slot.role === role) { this.kept.delete(a.id); slot.root.visible = true; } else slot = this.create(role,asset); this.active.set(a.id,slot); }
      visible.add(a.id);
      const pick = this.choose(slot, a, R, dt);
      const action = slot.actions[pick.clip] || slot.actions[R.idle];
      if (slot.clip !== pick.clip) {
        const previous = slot.actions[slot.clip];
        action.reset().play();
        if ((pick.clip === R.walk || pick.clip === R.run) && !a.previewClip)
          action.time = (a.gaitPhase ?? a.phase ?? 0) / (2*Math.PI) * action.getClip().duration;
        if (previous) action.crossFadeFrom(previous, .15, false);
        slot.clip = pick.clip;
        slot.lock = pick.hold ? action.getClip().duration / pick.scale - .15 : 0;
      }
      if (a.previewClip && R.once.includes(pick.clip) && !action.isRunning()) action.reset().play();
      action.timeScale = slot.scale = pick.scale;
      slot.root.position.set(a.x,a.y+(a.down||0)*0.14,a.z);
      slot.root.rotation.order = 'YXZ';
      slot.root.rotation.y = Math.PI/2-a.heading+(a.pose === 'flee' ? Math.PI : 0);
      slot.root.rotation.x = -(a.down || 0) * Math.PI / 2 * 0.95;   // down (wanted.js: Tasered, or wasted): flat on his back
      const swim = pick.clip === R.swim;
      slot.body.rotation.x = swim && R.swimTilt ? Math.PI*.46 : -(a.fall || 0)*Math.PI/2;
      slot.body.position.y = swim && R.swimTilt ? .5 : .15*(a.fall || 0);
      // Restore the sampled pose before the mixer evaluates the next frame.
      if (slot.extra) { for (const [bone, q] of slot.base) bone.quaternion.copy(q); slot.extra = false; }
      if(slot.wasSeated)for(const j of slot.seatJoints)j.bone.quaternion.copy(j.rest);
      slot.mixer.update(dt);
      for (const e of slot.base) e[1].copy(e[0].quaternion);
      slot.wasSeated=a.pose==='seated' && slot.seatJoints.length>0;
      if(slot.wasSeated){
        slot.body.position.y=-.43;
        slot.seatJoints.forEach(({bone,rest},i)=>{rest.copy(bone.quaternion);bone.rotateX(i<2?-1.46:1.48);});
      }
      // the brothers' arms (weapons, fists: combat.js)
      if (this.onHero?.(slot, a, dt) !== false) slot.extra = true;
    }
    for (const [id,slot] of this.active) if (!visible.has(id)) this.remove(id,slot);
    return visible;
  }
  // a brother out of range (one left far behind) is hidden and kept for when he's near again (building a rig clones
  // a 78-bone skeleton: a hitch); the preview figure is thrown away
  remove(id,slot) {
    this.active.delete(id);
    if (/^brother/.test(id)) { slot.root.visible = false; (this.kept ||= new Map()).set(id, slot); return; }
    slot.mixer.stopAllAction();
    slot.mixer.uncacheRoot(slot.body);
    slot.body.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    this.scene.remove(slot.root);
  }
}
