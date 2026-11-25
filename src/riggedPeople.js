// Close-range characters share geometry and materials, but each owns its skeleton and mixer.
// Roles: 'officer' and 'civilian' (19-joint rigs, six clips, near the camera) and the heroes 'cal' and 'leon'
// (the playable Ward brothers: Tripo rigs with 21 and 20 clips, prepared by tools/characters/prepare-hero.mjs).
import { AnimationMixer, Group, Mesh, BoxGeometry, MeshStandardMaterial, LoopOnce, Color, MeshStandardNodeMaterial, DataTexture, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three/webgpu';
import { texture, uniform, positionGeometry, smoothstep, mix, dot, vec3, abs, float } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const propSlide = new BoxGeometry(.033, .17, .042);
const propGrip = new BoxGeometry(.034, .05, .083);
const propSurface = new MeshStandardMaterial({color: 0x363a40, roughness: .83});

// Neutral cloth swatches multiply the civilian's own outfit colour. Mipmaps filter the
// yarn and diagonal denim ribs into a continuous tone at street distance.
const swatches = new Map();
function clothSwatch(field) {
  if (swatches.has(field)) return swatches.get(field);
  const size = 128, pixels = new Uint8Array(size*size*4);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const diagonal = Math.cos((x+y)*Math.PI/4);
    const warp = Math.cos(x*Math.PI/2)*Math.cos(y*Math.PI/2);
    const yarn = field === 'legs' ? 11*diagonal+4*warp : 8*warp;
    const shade = Math.round(231+yarn);
    pixels.set([shade,shade,shade,255],(y*size+x)*4);
  }
  const tex = new DataTexture(pixels,size,size);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(12,12);
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  swatches.set(field,tex);
  return tex;
}

// per-role clip names for the game's states, natural walk/run speeds (m/s) and presentation
const NPC = { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', swim: 'Swim', weaponHold: 'WeaponHold', once: ['Jump'], walkSpeed: 1.4, runSpeed: 3.8, scale: 1, swimTilt: true, prop: 'HandR', range: 44 };
export const ROLES = {
  officer: NPC,
  civilian: NPC,
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
    idle: 'idle', walk: 'walk', run: 'run', jump: 'jump', swim: 'swim', hit: 'front_kick_02', phone: 'make_a_call_01',
    // one-shot clips (the rest loop); fidgets play now and then while he stands still
    once: ['jump', 'front_kick_01', 'front_kick_02', 'jump_down', 'climb', 'greet_01', 'flip', 'pitch_baseball', 'turn', 'agree', 'laugh_01', 'afraid', 'run_upstairs'],
    fidgets: ['agree', 'laugh_01', 'turn', 'make_a_call_01'],
    clips: ['idle', 'walk', 'run', 'jump', 'swim', 'agree', 'greet_01', 'laugh_01', 'afraid', 'turn', 'make_a_call_01', 'make_a_call_02',
      'front_kick_01', 'front_kick_02', 'flip', 'pitch_baseball', 'shovel', 'climb', 'jump_down', 'run_upstairs'],
    // the source rig is 0.971 units tall; Leon is 1.81 m. In-place walk covers 1.21 m/s, run 4.38 m/s at this scale
    scale: 1.81 / 0.971, walkSpeed: 1.21, runSpeed: 4.38, jumpScale: 2.2, hitScale: 1.5, swimTilt: false, prop: null, range: 160, hero: true, shadow: true,
  },
};
// Share the existing character meshes and clips. Only the nearest eight people need mixers.
for (const [role,source] of [['jacket','cal'],['tracksuit','leon']]) {
  ROLES[role] = {...ROLES[source],source,hero:false,shadow:false,range:24};
}
function streetClothing(source) {
  const mat = new MeshStandardNodeMaterial();
  mat.normalMap = source.normalMap;
  mat.normalScale.copy(source.normalScale);
  mat.roughnessMap = source.roughnessMap;
  mat.side = source.side;
  mat.roughness = .88;
  const top = uniform(new Color()), legs = uniform(new Color());
  const p = positionGeometry, base = texture(source.map);
  const luma = dot(base.rgb,vec3(.2126,.7152,.0722));
  // The bind pose puts the hands at the ends of the outstretched sleeves.
  const shirt = smoothstep(.46,.50,p.y).mul(float(1).sub(smoothstep(.76,.80,p.y)))
    .mul(float(1).sub(smoothstep(.39,.43,abs(p.x))));
  const trousers = smoothstep(.072,.105,p.y).mul(float(1).sub(smoothstep(.46,.50,p.y)));
  mat.colorNode = mix(mix(base.rgb,legs.mul(luma.mul(3).add(.16)),trousers),
    top.mul(luma.mul(2.4).add(.21)),shirt);
  return {mat,top,legs};
}
function jerseyClothing(original) {
  const mat = new MeshStandardNodeMaterial();
  const p = positionGeometry, side = abs(p.x);
  const legs = uniform(new Color()), top = uniform(new Color());
  const skin = texture(original.map).rgb;
  const cuffs = smoothstep(.37,.38,side);
  const neckline = float(1.355).add(smoothstep(.055,.15,side).mul(.072));
  const covered = float(1).sub(smoothstep(neckline,neckline.add(.004),p.y)).mul(float(1).sub(cuffs));
  const waist = smoothstep(.868,.873,p.y);
  const jersey = top.mul(texture(clothSwatch('top')).r);
  const denim = legs.mul(texture(clothSwatch('legs')).r);
  mat.colorNode = mix(skin,mix(denim,jersey,waist),covered);
  mat.side = original.side;
  mat.roughness = .82;
  return {mat,top,legs};
}
// The civilian GLB depicts a long-haired woman in a jersey. Keep other silhouettes and
// accessories on their own detailed crowd mesh when approaching or leaving the camera.
function roleOf(a) {
  if (a.previewRole) return a.previewRole;
  if (a.id === 'brother0') return 'cal';
  if (a.id === 'brother1') return 'leon';
  if (a.officer) return 'officer';
  const look = a.look;
  if (!/^p\d+$/.test(a.id) || !look || look.hood || look.bag || look.cap ||
      ['umbrella','phone','point','wave','talk','hands'].includes(a.pose)) return null;
  if (look.female) return look.style === 2 ? 'civilian' : null;
  return look.outfit % 2 ? 'tracksuit' : 'jacket';
}

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
      new GLTFLoader().load('characters/' + role + '.glb', asset => this.templates.set(role, asset),
        undefined, e => console.warn('Character load failed', role, e));
    }
    return this.templates.get(role);
  }
  create(role, asset) {
    const R = ROLES[role], body = clone(asset.scene), root = new Group();
    body.scale.setScalar(R.scale);
    root.add(body);
    if (R.shadow) body.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.frustumCulled = false; } });
    const mixer = new AnimationMixer(body);
    const clips = R.source ? asset.animations.filter(clip => [R.walk,R.run,R.idle,R.swim,R.jump].includes(clip.name)) : asset.animations;
    const actions = Object.fromEntries(clips.map(clip => [clip.name, mixer.clipAction(clip)]));
    for (const name of R.once) if (actions[name]) { actions[name].setLoop(LoopOnce, 1); actions[name].clampWhenFinished = true; }
    let prop = null;
    const hand = R.prop && body.getObjectByName(R.prop);
    if (hand) {
      prop = new Group();
      const slide = new Mesh(propSlide, propSurface);
      slide.position.set(0,.043,.046);
      const grip = new Mesh(propGrip, propSurface);
      grip.rotation.x = -.16;
      prop.add(slide, grip);
      hand.add(prop);
      prop.position.y = .085;
    }
    this.scene.add(root);
    const streetMaterials = [];
    if (R.source) body.traverse(node => {
      if (!node.isSkinnedMesh) return;
      const clothing = streetClothing(node.material);
      node.material = clothing.mat;
      streetMaterials.push(clothing);
    });
    if (role === 'civilian') {
      let skin;
      body.traverse(node => { if (node.isMesh && node.material.map) skin = node.material; });
      if (skin) {
        const clothing = jerseyClothing(skin);
        streetMaterials.push(clothing);
        body.traverse(node => {
          if (node.isMesh && node.material.name !== 'Dark shoes') node.material = clothing.mat;
        });
      }
    }
    const names = R.source ? ['Spine2','L_Upperarm','R_Upperarm','L_Thigh','L_Calf','R_Calf'] :
      R === NPC ? ['Chest','ArmL','ArmR','ThighL','ShinL','ShinR'] : [];
    const reactionJoints = names.map((name,index) => {
      const bone = body.getObjectByName(name);
      return {bone,index, rest: bone?.quaternion.clone()};
    }).filter(joint => joint.bone);
    return {role, root, body, prop, actions, mixer, reactionJoints, streetMaterials, head:body.getObjectByName('Head'), lock: 0, still: 0};
  }
  // pick the clip for an actor's state; one-shots (jump, kick, fidgets) hold until they finish
  choose(slot, a, R, dt) {
    const speed = a.gaitSpeed ?? a.speedNow ?? a.speed ?? 0;
    if (a.previewClip) return { clip: R === NPC ? a.previewClip : (slot.actions[a.previewClip] ? a.previewClip : R.idle), scale: 1 };
    slot.lock = Math.max(0, slot.lock - dt);
    if (a.jumpTime > 0 && R.jump && slot.clip !== R.jump) return { clip: R.jump, scale: R.jumpScale || 1, hold: true };
    if (a.hitTime > 0 && R.hit && slot.clip !== R.hit) return { clip: R.hit, scale: R.hitScale || 1, hold: true };
    if (slot.lock > 0) return { clip: slot.clip, scale: slot.scale };
    if (a.pose === 'swim' && R.swim) return { clip: R.swim, scale: speed > 0.25 ? Math.max(0.8, Math.min(1.5, speed / 1.1)) : 0.45 };   // slow strokes treading water
    if (a.pose === 'weaponHold' && R.weaponHold) return { clip: R.weaponHold, scale: 1 };
    if (a.pose === 'jump' && R.jump) return { clip: R.jump, scale: 1 };
    if (a.phoneT > 0 && R.phone) return { clip: R.phone, scale: 1 };
    if (speed > 2.5) return { clip: R.run, scale: Math.max(.75, Math.min(1.5, speed / R.runSpeed)) };
    if (speed > .1) { slot.still = 0; return { clip: R.walk, scale: Math.max(.65, Math.min(1.6, speed / R.walkSpeed)) }; }
    // standing: the hero fidgets now and then (nod, laugh, look round, take a call)
    slot.still += dt;
    if (!R.source && R.fidgets && slot.still > 9 + (slot.wait ??= Math.random() * 8)) {
      slot.still = 0; slot.wait = Math.random() * 10;
      return { clip: R.fidgets[Math.floor(Math.random() * R.fidgets.length)], scale: 1, hold: true };
    }
    return { clip: R.idle, scale: 1 };
  }
  update(actors, cam, dt) {
    const candidates = [];
    for (const a of actors) {
      if (!a.visible) continue;
      const role = roleOf(a);
      if (!role || !ROLES[role]) continue;
      const distance = (a.x-cam.x)**2 + (a.z-cam.z)**2;
      if (distance < ROLES[role].range ** 2) candidates.push({a,role,distance: ROLES[role].hero ? -1 : distance});
    }
    candidates.sort((a,b) => a.distance-b.distance);
    const visible = new Set();
    for (const {a,role} of candidates.slice(0,8)) {
      const asset = this.load(ROLES[role].source || role);
      if (!asset) continue;
      const R = ROLES[role];
      let slot = this.active.get(a.id);
      if (slot && slot.role !== role) { this.remove(a.id, slot); slot = null; }
      if (!slot) { slot = this.create(role,asset); this.active.set(a.id,slot); }
      visible.add(a.id);
      if (!R.hero && a.look && slot.look !== a.look) {
        for (const {top,legs} of slot.streetMaterials) {
          top.value.setHex(a.look.top);
          legs.value.setHex(a.look.legs);
        }
        if (slot.head && R.source) slot.head.scale.set(1+((a.look.build ?? .35)-.35)*.13,1,1+((a.look.build ?? .35)-.35)*.09);
        const height = a.look.h || 1, build = (a.look.build ?? .35)-.35;
        slot.root.scale.set(height*(1+build*.16),height,height*(1+build*.14));
        slot.look = a.look;
      }
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
      slot.root.position.set(a.x,a.y,a.z);
      slot.root.rotation.y = Math.PI/2-a.heading+(a.pose === 'flee' ? Math.PI : 0);
      const swim = pick.clip === R.swim;
      slot.body.rotation.x = swim && R.swimTilt ? Math.PI*.46 : -(a.fall || 0)*Math.PI/2;
      slot.body.position.y = swim && R.swimTilt ? .5 : .15*(a.fall || 0);
      if (slot.prop) slot.prop.visible = pick.clip === R.weaponHold;
      // Restore the sampled pose before the mixer evaluates the next frame.
      if (slot.braced) for (const j of slot.reactionJoints) j.bone.quaternion.copy(j.rest);
      slot.mixer.update(dt);
      slot.braced = a.brace > 0;
      if (slot.braced) {
        const angles = [-.28,-.85,-1.05,-.48,.68,.46];
        slot.reactionJoints.forEach(({bone,rest,index:i}) => {
          rest.copy(bone.quaternion);
          bone.rotateX(angles[i]*a.brace);
        });
      }
    }
    for (const [id,slot] of this.active) if (!visible.has(id)) this.remove(id,slot);
    return visible;
  }
  remove(id,slot) {
    for (const {mat} of slot.streetMaterials) mat.dispose();
    slot.mixer.stopAllAction();
    slot.mixer.uncacheRoot(slot.body);
    slot.body.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    this.scene.remove(slot.root);
    this.active.delete(id);
  }
}
