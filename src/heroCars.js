// Hand-made car models (GLB) for the brothers' own vehicles: the Range Rover. Prepared by
// tools/vehicles/prepare-car.mjs into one body mesh plus four wheels centred on their axles.
//
// Each car on the road gets its own clone (there are only a few): the body follows the sprung pose from
// VehicleRenderer (pitch and roll from acceleration), the wheels follow the ground pose, roll with the
// distance travelled and the fronts steer. The body material is the model's baked PBR texture set, plus:
// headlights with DRLs, tail and brake lights, reversing lights, indicators and the high-level brake light
// lit per pixel where the texture shows a lens; clearcoat where the texture is glossy; crumple, dents and
// broken lamps from the damage zones; and the dark glasshouse areas of the texture shaded as tinted glass.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { texture, uv, uniform, vec3, vec4, float, mix, step, smoothstep, abs, max, min, positionGeometry, positionLocal, normalGeometry, sin, fract, floor, dot, frontFacing } from 'three/tsl';

// model space: +Z forward, +Y up, +X the car's left, 0.978 units long. The game's car frame is +X forward.
export const HERO_CARS = {
  rangerover: {
    file: 'vehicles/rangerover.glb', scale: 5.06,
    // driver's eye (right-hand drive), metres in the car frame. The seat's headrest is behind
    // z ≈ −0.55 m; the wheel centre is 0.11 m ahead and 0.85 m up. Eyes sit in front of the
    // headrest, a little above the rim, so the wheel and the hands land in the lower third.
    driver: { fwd: -0.34, side: 0.44, eye: 1.22 },
    // lamp regions (model units) — headlights under the bonnet line, tail clusters on the rear corners
    head: { z: 0.425, x0: 0.112, x1: 0.206, y0: 0.172, y1: 0.228 },
    tail: { z: -0.425, x0: 0.143, x1: 0.212, y0: 0.158, y1: 0.262 },
    // glasshouse: windscreen (z from the scuttle to the roof), tailgate window and side windows; inside
    // these the model's dark texture is shaded as tinted, glossy glass
    screen: { z0: 0.055, z1: 0.25, y0: 0.255, x: 0.172 }, backlight: { z: -0.4, y0: 0.282, y1: 0.372, x: 0.158 },
    sides: { x: 0.118, y0: 0.268, y1: 0.374, z0: -0.425, z1: 0.17 },
  },
};

// how far the steering wheel turns per radian of front-wheel steer (about three turns lock to lock)
const STEER_RATIO = 12;
// the dash, wheel and seats sit this far lower in the shell so the scuttle meets the glass
const CABIN_DROP = 0.03;
const hash = p => fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

export class HeroCars {
  constructor(scene) {
    this.scene = scene;
    this.assets = new Map();
    this.active = new Map();
    this.seen = new Set();
  }
  load(model) {
    if (!this.assets.has(model)) {
      this.assets.set(model, null);
      new GLTFLoader().load(HERO_CARS[model].file, g => this.assets.set(model, this.prepare(model, g)), undefined, e => console.warn('Car model failed', model, e));
    }
    return this.assets.get(model);
  }
  // one-time: find parts, keep the source textures for per-car materials, build the glass geometry
  prepare(model, gltf) {
    const C = HERO_CARS[model], parts = { wheels: {}, cabin: [] };
    gltf.scene.traverse(n => {
      if (!n.isMesh) return;
      const keyName = n.name.startsWith('wheel_') ? n.name : n.parent?.name?.startsWith('wheel_') ? n.parent.name : '';
      if (keyName) {
        const node = n.name.startsWith('wheel_') ? n : n.parent;
        parts.wheels[keyName.slice(6)] = { geo: n.geometry, mat: n.material, pos: node.position.clone() };
      } else if (n.name === 'steering' || n.parent?.name === 'steering') {
        const node = n.name === 'steering' ? n : n.parent;
        parts.steering = { geo: n.geometry, mat: n.material, pos: node.position.clone() };
      } else if (n.name === 'body' || n.parent?.name === 'body') parts.body = { geo: n.geometry, mat: n.material };
      else if (n.name.startsWith('cabin') || n.parent?.name?.startsWith('cabin')) parts.cabin.push({ geo: n.geometry, mat: n.material });
    });
    parts.wheelMat = wheelMaterial(parts.wheels.fl.mat);
    return parts;
  }
  create(model, parts) {
    const C = HERO_CARS[model];
    const body = new THREE.Group(), ground = new THREE.Group();
    body.matrixAutoUpdate = ground.matrixAutoUpdate = false;
    const mBody = new THREE.Group(), mGround = new THREE.Group();
    for (const m of [mBody, mGround]) { m.rotation.y = Math.PI / 2; m.scale.setScalar(C.scale); }
    body.add(mBody); ground.add(mGround);
    const state = { brake: uniform(0), lights: uniform(0), reverse: uniform(0), indL: uniform(0), indR: uniform(0), camIn: uniform(0), dmg: uniform(new THREE.Vector4()), paint: uniform(new THREE.Vector3(1, 1, 1)) };
    const mesh = new THREE.Mesh(parts.body.geo, bodyMaterial(parts.body.mat, C, state));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mBody.add(mesh);
    const cabin = [];
    for (const c of parts.cabin) {
      const cm = new THREE.Mesh(c.geo, cabinMaterial(c.mat));
      cm.castShadow = true; cm.receiveShadow = true; cm.frustumCulled = false;
      cm.position.y = -CABIN_DROP;
      mBody.add(cm); cabin.push(cm);
    }
    let column = null;
    if (parts.steering) {
      const piv = new THREE.Group(); piv.position.copy(parts.steering.pos); piv.position.y -= CABIN_DROP;
      const sm = new THREE.Mesh(parts.steering.geo, cabinMaterial(parts.steering.mat));
      sm.castShadow = true; sm.frustumCulled = false;
      piv.add(sm);
      const hands = driverHands();
      piv.add(hands);
      mBody.add(piv); column = piv;
    }
    const wheels = {};
    for (const [k, w] of Object.entries(parts.wheels)) {
      const piv = new THREE.Group(); piv.position.copy(w.pos);
      const wm = new THREE.Mesh(w.geo, parts.wheelMat); wm.castShadow = true;
      piv.add(wm); mGround.add(piv); wheels[k] = { piv, mesh: wm };
    }
    this.scene.add(body, ground);
    return { model, body, ground, wheels, column, cabin, state, mesh };
  }
  // called by VehicleRenderer for each visible hero car with its ground and sprung body matrices
  place(v, groundM, bodyM) {
    const parts = this.load(v.model); if (!parts) return;
    const id = v.id || v.model + ':' + this.seen.size;
    let c = this.active.get(id);
    if (!c) { c = this.create(v.model, parts); this.active.set(id, c); }
    this.seen.add(id);
    c.body.matrix.copy(bodyM); c.ground.matrix.copy(groundM);
    c.body.matrixWorldNeedsUpdate = c.ground.matrixWorldNeedsUpdate = true;
    const spin = v.spin || 0, steer = v.player ? (v.steer || 0) : (v.steerVis || 0);
    for (const [k, w] of Object.entries(c.wheels)) w.mesh.rotation.set(spin, k[0] === 'f' ? -steer : 0, 0, 'YXZ');
    // column is model +Z (toward the bonnet): left lock is counterclockwise from the driver's seat.
    // The hands are on the same pivot, so they turn with the wheel.
    if (c.column) {
      c.column.rotation.z = -steer * STEER_RATIO;
      const hands = c.column.children.find(n => n.name === 'hands');
      if (hands) {
        hands.visible = !!v.camInside;
        if (v.camInside && v.handSkin != null) {
          hands.userData.skin.color.setHex(v.handSkin);
          hands.userData.cloth.color.setHex(v.handCloth);
        }
      }
    }
    const s = c.state, blink = (performance.now() / 666) % 1 < 0.5 ? 1 : 0;
    s.camIn.value = v.camInside ? 1 : 0;
    const paint = new THREE.Color(v.paint == null ? 0xffffff : v.paint);
    s.paint.value.set(paint.r, paint.g, paint.b);
    s.brake.value = v.brake ? 1 : 0; s.lights.value = v.lights ? 1 : 0; s.reverse.value = v.reversing ? 1 : 0;
    s.indL.value = (v.ind === 1 || v.hazard) && blink ? 1 : 0; s.indR.value = (v.ind === 2 || v.hazard) && blink ? 1 : 0;
    const d = v.dmg || [0, 0, 0, 0]; s.dmg.value.set(d[0], d[1], d[2], d[3]);
  }
  finish() {
    for (const [id, c] of this.active) if (!this.seen.has(id)) {
      this.scene.remove(c.body, c.ground);
      c.mesh.material.dispose();
      for (const m of c.cabin) m.material.dispose();
      if (c.column) {
        const seen = new Set();
        c.column.traverse(o => { if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); } });
      }
      this.active.delete(id);
    }
    this.seen.clear();
  }
}

function driverHands() {
  // model units, on the steering pivot: +Y up the wheel, +X the car's left, +Z toward the bonnet.
  // High ten-and-two so the knuckles sit in the driver's view. They turn with the wheel.
  const g = new THREE.Group(); g.name = 'hands';
  const skin = new THREE.MeshStandardNodeMaterial({ color: 0xb48265, roughness: 0.55 });
  const cloth = new THREE.MeshStandardNodeMaterial({ color: 0x314958, roughness: 0.82 });
  g.userData.skin = skin; g.userData.cloth = cloth;
  const R = 0.043, a = 0.95;
  for (const sign of [1, -1]) {
    const h = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.007, 0.010), skin);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.006, 0.014), skin);
    fingers.position.set(0, 0.003, 0.008); fingers.rotation.x = -1.05;
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.005, 0.011), skin);
    thumb.position.set(-sign * 0.009, -0.001, -0.002); thumb.rotation.z = -sign * 0.4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.009, 0.032), cloth);
    arm.position.set(-sign * 0.002, -0.016, -0.006); arm.rotation.x = 1.05; arm.rotation.z = -sign * 0.35;
    h.add(palm, fingers, thumb, arm);
    for (const o of h.children) o.frustumCulled = false;
    h.position.set(sign * Math.sin(a) * R, Math.cos(a) * R, -0.008);
    h.rotation.z = -sign * a;
    g.add(h);
  }
  g.visible = false;
  return g;
}

function cabinMaterial(src) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  m.colorNode = src.map ? texture(src.map, uv()).rgb : vec3(src.color?.r ?? 0.4, src.color?.g ?? 0.4, src.color?.b ?? 0.4);
  if (src.metalnessMap) { const rm = texture(src.metalnessMap, uv()); m.roughnessNode = rm.g; m.metalnessNode = rm.b; }
  else if (src.roughnessMap) m.roughnessNode = texture(src.roughnessMap, uv()).g;
  if (src.normalMap) m.normalMap = src.normalMap;
  return m;
}

function wheelMaterial(src) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = texture(src.map, uv()).rgb;
  if (src.metalnessMap) { const rm = texture(src.metalnessMap, uv()); m.roughnessNode = rm.g; m.metalnessNode = rm.b; }
  if (src.normalMap) { m.normalMap = src.normalMap; }
  return m;
}

function bodyMaterial(src, C, s) {
  // double-sided: from inside (driver's view) and through any gap the inside of the shell reads as a dark
  // cabin interior instead of letting you see straight through the car
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const back = float(1).sub(float(frontFacing));
  const p = positionGeometry, ax = abs(p.x);
  const base = texture(src.map, uv()).rgb;
  const rm = src.metalnessMap ? texture(src.metalnessMap, uv()) : vec4(1, 0.5, 0, 1);
  const lum = base.dot(vec3(0.3, 0.59, 0.11)), sat = max(max(base.r, base.g), base.b).sub(min(min(base.r, base.g), base.b));
  const d = s.dmg;
  // damage zones in model units (+Z front): front, rear, left (+X), right (-X)
  const zF = smoothstep(0.27, 0.49, p.z), zR = smoothstep(-0.27, -0.49, p.z), zL = smoothstep(0.12, 0.21, p.x), zRt = smoothstep(-0.12, -0.21, p.x);
  const dm = d.x.mul(zF).add(d.y.mul(zR)).add(d.z.mul(zL)).add(d.w.mul(zRt)).clamp(0, 1);
  const n0 = hash(floor(p.mul(vec3(900, 260, 900)))), n1 = hash(floor(p.mul(23)).add(3.1));   // n0: fine streaks; n1: panel-sized dents
  m.positionNode = positionLocal.add(vec3(
    d.z.mul(zL).mul(-0.024).add(d.w.mul(zRt).mul(0.024)),
    d.x.mul(zF).add(d.y.mul(zR)).mul(n1.sub(0.4)).mul(0.012),
    d.x.mul(zF.mul(zF)).mul(-0.06).add(d.y.mul(zR.mul(zR)).mul(0.055))).mul(float(0.6).add(n1.mul(0.8))));
  // lamps: inside each region, only where the texture shows a lens (bright, or red at the back)
  const H = C.head, T = C.tail;
  const inHead = step(H.z, p.z).mul(step(H.x0, ax)).mul(step(ax, H.x1)).mul(step(H.y0, p.y)).mul(step(p.y, H.y1));
  const headLens = inHead.mul(smoothstep(0.28, 0.55, lum));
  const inTail = step(p.z, T.z).mul(step(T.x0, ax)).mul(step(ax, T.x1)).mul(step(T.y0, p.y)).mul(step(p.y, T.y1));
  const red = smoothstep(0.08, 0.2, base.r.sub(max(base.g, base.b)));
  const tailLens = inTail.mul(red);
  const revLens = inTail.mul(step(p.y, T.y0 + 0.025)).mul(smoothstep(0.35, 0.6, lum));
  const hiStop = step(p.z, -0.4).mul(step(ax, 0.045)).mul(step(0.358, p.y)).mul(step(p.y, 0.374));
  const indFront = inHead.mul(step(H.x1 - 0.022, ax)), indRear = inTail.mul(step(T.y1 - 0.03, p.y));
  const indOn = mix(s.indR, s.indL, step(0, p.x));   // +X is the car's left
  const brokenF = smoothstep(0.38, 0.6, d.x), brokenR = smoothstep(0.38, 0.6, d.y);
  // glass: the windscreen is a raked pane, not a box. It runs from the scuttle (low, forward) up to the
  // header (high, back). A box cut left the lower glass solid, so the dash and cowl filled the view.
  const Bk = C.backlight, Sd = C.sides;
  // measured outer glass: y 0.24 → z 0.22, y 0.28 → z 0.14, y 0.32 → z 0.10.
  // The shell is thick: the pane the driver actually looks at sits up to ~0.12 behind that line.
  // The hole is a volume through both layers, not a razor cut on the outer skin (that left the
  // inner skin in place and the cabin read as a black wall).
  const zGlass = float(0.505).sub(p.y.mul(1.28));
  const dzG = p.z.sub(zGlass);
  const inScreen = step(0.198, p.y).mul(step(p.y, 0.348)).mul(step(ax, 0.178)).mul(step(-0.16, dzG)).mul(step(dzG, 0.06));
  // the glass and the headlining that hangs in front of it. The lining drops to about y 0.26
  // ahead of the driver and hides the pane; cut that lining too, and leave the outer roof (y > 0.335).
  const screenHole = step(0.198, p.y).mul(step(p.y, 0.336)).mul(step(ax, 0.160)).mul(step(-0.08, p.z)).mul(step(p.z, 0.30));
  const inBack = step(p.z, Bk.z).mul(step(Bk.y0, p.y)).mul(step(p.y, Bk.y1)).mul(step(ax, Bk.x));
  const inSide = step(Sd.x, ax).mul(step(Sd.y0, p.y)).mul(step(p.y, Sd.y1)).mul(step(Sd.z0, p.z)).mul(step(p.z, Sd.z1));
  // the texture has the cabin (seats, dash) baked into the glass, so the middle of each pane is glass whatever
  // its colour; only the edges, where frame and seals meet the glass, go by the texture
  const coreS = inScreen;
  const coreB = inBack.mul(step(Bk.y0 + 0.01, p.y)).mul(step(p.y, Bk.y1 - 0.01)).mul(step(ax, Bk.x - 0.02));
  const coreSd = inSide.mul(step(Sd.y0 + 0.012, p.y)).mul(step(p.y, Sd.y1 - 0.014)).mul(step(Sd.z0 + 0.025, p.z)).mul(step(p.z, Sd.z1 - 0.02));
  const glass0 = max(max(max(inScreen, inBack), inSide).mul(smoothstep(0.42, 0.22, lum)).mul(smoothstep(0.28, 0.14, sat)), max(max(coreS, coreB), coreSd));
  // the windows are two layers, and the outer one has gaps: from outside, the inner layer shows through them
  // from behind. Seen from outside the car, back faces in (and just inboard of) the glasshouse are glass too,
  // not cabin trim (which drew grey blotches all over the windows)
  const inScreenL = step(0.19, p.y).mul(step(p.y, 0.350)).mul(step(ax, 0.188)).mul(step(-0.18, dzG)).mul(step(dzG, 0.08));
  const inBackL = step(p.z, Bk.z + 0.03).mul(step(Bk.y0 - 0.01, p.y)).mul(step(p.y, Bk.y1 + 0.01)).mul(step(ax, Bk.x + 0.01));
  const inSideL = step(Sd.x - 0.025, ax).mul(step(Sd.y0 - 0.01, p.y)).mul(step(p.y, Sd.y1 + 0.01)).mul(step(Sd.z0 - 0.01, p.z)).mul(step(p.z, Sd.z1 + 0.01));
  const innerGlass = back.mul(max(max(inScreenL, inBackL), inSideL)).mul(float(1).sub(s.camIn));
  const inside = back.sub(innerGlass);
  const glass = max(glass0, innerGlass);
  // colour: the baked paint, darker and scuffed where dented
  const scuff = step(0.9, n0).mul(smoothstep(0.15, 0.5, dm)).mul(float(1).sub(glass));
  let col = mix(base, mix(vec3(0.01, 0.013, 0.017), base.mul(0.3), 0.3), glass);   // even dark tint; reflections do the rest
  col = col.mul(float(1).sub(dm.mul(n1.sub(0.3)).mul(0.35)));
  col = mix(col, vec3(0.3, 0.3, 0.29), scuff);
  col = mix(col, vec3(0.03), brokenF.mul(headLens).mul(step(0.5, n0)));
  // body colour: bright, low-saturation panels take the car's paint, keeping the texture's shading.
  // Glass, lamps and dark cladding stay as baked. White paint (1,1,1) leaves the shell white.
  const panels = smoothstep(0.42, 0.7, lum).mul(smoothstep(0.28, 0.1, sat)).mul(float(1).sub(glass)).mul(float(1).sub(headLens)).mul(float(1).sub(tailLens));
  col = mix(col, col.mul(s.paint), panels);
  // interior: charcoal trim and leather, a little lighter low down (seats, floor) than up at the headlining
  const trim = vec3(0.028, 0.026, 0.024).mul(float(0.8).add(base.dot(vec3(0.3, 0.59, 0.11)).mul(0.6)));
  m.colorNode = mix(col, trim, inside);
  // from inside, the window openings are cut out so the driver sees the road; from outside they stay glass
  const winRegion = max(max(inScreen, inBack), inSide.mul(step(Sd.y0 + 0.008, p.y)).mul(step(p.y, Sd.y1 - 0.012)));
  // (the model also has an inner glass layer facing into the cabin: cut that too)
  const inward = step(normalGeometry.dot(p.sub(vec3(0, 0.29, -0.08))), 0);
  // only while the camera sits inside this car: the windscreen is cut on both faces so the road shows through
  m.opacityNode = float(1).sub(max(max(inside, inward).mul(winRegion), screenHole).mul(s.camIn));
  m.alphaTest = 0.5;
  // gloss: the paint and glass in the texture get a clearcoat; rubber and trim stay matt
  const rough = rm.g, metal = rm.b;
  m.roughnessNode = mix(mix(mix(rough, float(0.04), glass), float(0.85), scuff), float(0.75), inside);
  m.metalnessNode = metal.mul(float(1).sub(scuff)).mul(float(1).sub(glass)).mul(float(1).sub(inside));
  m.clearcoatNode = max(smoothstep(0.75, 0.4, rough), glass).mul(float(1).sub(dm.mul(0.8))).mul(float(1).sub(inside));
  m.clearcoatRoughnessNode = mix(float(0.05), float(0.5), dm);
  if (src.normalMap) m.normalMap = src.normalMap;
  // emission
  const head = headLens.mul(float(1).sub(indFront)).mul(float(1).sub(brokenF));
  const drl = head.mul(0.9), beam = head.mul(s.lights).mul(4);
  const tail = tailLens.mul(float(1).sub(indRear)).mul(float(1).sub(brokenR)).mul(s.lights.mul(0.9).add(s.brake.mul(3.2)).add(0.05));
  const rev = revLens.mul(s.reverse).mul(2.5).mul(float(1).sub(brokenR));
  const ind = indFront.mul(step(0.3, lum)).add(indRear.mul(red)).min(1).mul(indOn).mul(4);
  m.emissiveNode = vec3(0.9, 0.93, 1).mul(drl.mul(float(1).sub(inside))).add(vec3(1, 0.95, 0.85).mul(beam))
    .add(vec3(1, 0.04, 0.02).mul(tail)).add(vec3(1, 0.03, 0.02).mul(hiStop).mul(s.brake).mul(3))
    .add(vec3(1, 0.98, 0.95).mul(rev)).add(vec3(1, 0.5, 0.05).mul(ind));
  return m;
}
