// Close-range characters share geometry and materials, but each owns its skeleton and mixer.
import { AnimationMixer, Group, Mesh, BoxGeometry, MeshStandardMaterial, LoopOnce } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const propSlide = new BoxGeometry(.033, .17, .042);
const propGrip = new BoxGeometry(.034, .05, .083);
const propSurface = new MeshStandardMaterial({color: 0x363a40, roughness: .83});
const states = {jump:'Jump', swim:'Swim', weaponHold:'WeaponHold'};

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
    const body = clone(asset.scene), root = new Group();
    root.add(body);
    const mixer = new AnimationMixer(body);
    const actions = Object.fromEntries(asset.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
    actions.Jump.setLoop(LoopOnce, 1);
    actions.Jump.clampWhenFinished = true;
    const prop = new Group();
    const slide = new Mesh(propSlide, propSurface);
    slide.position.set(0,.043,.046);
    const grip = new Mesh(propGrip, propSurface);
    grip.rotation.x = -.16;
    prop.add(slide, grip);
    body.getObjectByName('HandR').add(prop);
    prop.position.y = .085;
    this.scene.add(root);
    return {role, root, body, prop, actions, mixer};
  }
  update(actors, cam, dt) {
    const candidates = [];
    for (const a of actors) {
      if (!a.visible) continue;
      const role = a.previewRole || (a.officer ? 'officer' : /^p\d+$/.test(a.id) && Number(a.id.slice(1)) % 4 === 0 ? 'civilian' : null);
      if (!role) continue;
      const distance = (a.x-cam.x)**2 + (a.z-cam.z)**2;
      if (distance < 44**2) candidates.push({a,role,distance});
    }
    candidates.sort((a,b) => a.distance-b.distance);
    const visible = new Set();
    for (const {a,role} of candidates.slice(0,8)) {
      const asset = this.load(role);
      if (!asset) continue;
      let slot = this.active.get(a.id);
      if (slot && slot.role !== role) { this.remove(a.id, slot); slot = null; }
      if (!slot) { slot = this.create(role,asset); this.active.set(a.id,slot); }
      visible.add(a.id);
      const speed = a.speedNow ?? a.speed ?? 0;
      const clip = a.previewClip || states[a.pose] || (speed > 2.5 ? 'Run' : speed > .1 ? 'Walk' : 'Idle');
      const action = slot.actions[clip];
      if (slot.clip !== clip) {
        const previous = slot.actions[slot.clip];
        action.reset().play();
        if (previous) action.crossFadeFrom(previous,.15,false);
        slot.clip = clip;
      }
      if (a.previewClip === 'Jump' && !action.isRunning()) action.reset().play();
      action.timeScale = a.previewClip ? 1 : clip === 'Walk' ? Math.max(.65,Math.min(1.5,speed/1.4)) : clip === 'Run' ? Math.max(.75,Math.min(1.5,speed/3.8)) : 1;
      slot.root.position.set(a.x,a.y,a.z);
      slot.root.rotation.y = Math.PI/2-a.heading+(a.pose === 'flee' ? Math.PI : 0);
      slot.body.rotation.x = clip === 'Swim' ? Math.PI*.46 : -(a.fall || 0)*Math.PI/2;
      slot.body.position.y = clip === 'Swim' ? .5 : .15*(a.fall || 0);
      slot.prop.visible = clip === 'WeaponHold';
      slot.mixer.update(dt);
    }
    for (const [id,slot] of this.active) if (!visible.has(id)) this.remove(id,slot);
    return visible;
  }
  remove(id,slot) {
    slot.mixer.stopAllAction();
    slot.mixer.uncacheRoot(slot.body);
    slot.body.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    this.scene.remove(slot.root);
    this.active.delete(id);
  }
}
