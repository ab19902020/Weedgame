// The Kestrel T3's model: a folding camera drone, 33 cm across the motors. Carbon-grey body with the battery on
// top, four arms in an X, motors and two-blade props (they blur into discs as they spin up), a three-axis gimbal
// under the nose carrying the visible camera and the thermal camera side by side, green navigation lights at the
// front, red at the back, and landing feet. Forward is -Z (as the drone's flight model has it).
// buildDroneModel({ leds, guards, box }) -> THREE.Group with userData.spin(motors, dt, on) and userData.leds(t, state)
import * as THREE from 'three/webgpu';

const mats = {};
function mat(key, make) { return mats[key] ||= make(); }
const body = () => mat('body', () => new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.15 }));
const carbon = () => mat('carbon', () => new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.1 }));
const grey = () => mat('grey', () => new THREE.MeshStandardMaterial({ color: 0x6b7077, roughness: 0.35, metalness: 0.6 }));
const metal = () => mat('metal', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.05, metalness: 0.2 }));
const accent = () => mat('accent', () => new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4, metalness: 0.1 }));
const prop = () => mat('prop', () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 1 }));
const blur = () => mat('blur', () => new THREE.MeshBasicMaterial({ color: 0x30333a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));

const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r0, r1, h, m, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);

export function buildDroneModel(o = {}) {
  const g = new THREE.Group(); g.name = 'kestrel';
  // body: a tapered fuselage, rounded with a few chamfer boxes, the battery on top with its orange latch
  const hull = box(0.105, 0.05, 0.2, body()); g.add(hull);
  const nose = box(0.085, 0.042, 0.05, body(), 0, -0.002, -0.118); g.add(nose);
  const tail = box(0.08, 0.04, 0.04, body(), 0, 0.001, 0.115); g.add(tail);
  const bat = box(0.085, 0.032, 0.15, grey(), 0, 0.04, 0.012); g.add(bat);
  g.add(box(0.03, 0.006, 0.012, accent(), 0, 0.057, 0.07));
  // the forward obstacle sensors: two small dark lenses either side of the nose
  for (const s of [-1, 1]) { const l = cyl(0.007, 0.007, 0.006, glass(), 10); l.rotation.x = Math.PI / 2; l.position.set(s * 0.025, 0.01, -0.144); g.add(l); }
  // arms in an X, motors at the ends; props alternate direction (front-left and back-right clockwise)
  const props = [], blurs = [];
  const arm = 0.165, pos = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  pos.forEach(([sx, sz], i) => {
    const ax = sx * arm * 0.707, az = sz * arm * 0.707;
    const a = box(0.022, 0.014, arm, carbon()); a.position.set(ax / 2, 0.004, az / 2); a.rotation.y = Math.atan2(ax, az); g.add(a);
    const mot = cyl(0.016, 0.018, 0.026, metal(), 16); mot.position.set(ax, 0.02, az); g.add(mot);
    const bell = cyl(0.012, 0.016, 0.01, grey(), 16); bell.position.set(ax, 0.037, az); g.add(bell);
    // two-blade prop, slightly swept
    const p = new THREE.Group(); p.position.set(ax, 0.044, az);
    for (const s of [0, Math.PI]) { const bl = box(0.064, 0.002, 0.012, prop(), 0.034, 0, 0); bl.rotation.x = 0.12; const bg = new THREE.Group(); bg.rotation.y = s; bg.add(bl); p.add(bg); }
    p.userData.dir = i % 2 ? -1 : 1;
    g.add(p); props.push(p);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.068, 24), blur()); disc.rotation.x = -Math.PI / 2; disc.position.set(ax, 0.045, az); g.add(disc); blurs.push(disc);
    // a landing foot under each arm
    const foot = box(0.008, 0.035, 0.008, carbon(), ax * 0.9, -0.02, az * 0.9); g.add(foot);
    if (o.guards) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.003, 6, 28), grey()); ring.rotation.x = Math.PI / 2; ring.position.set(ax, 0.045, az); g.add(ring); }
  });
  // the gimbal under the nose: yoke, the camera head with its visible lens and the thermal lens beside it
  const yoke = box(0.05, 0.012, 0.018, grey(), 0, -0.034, -0.11); g.add(yoke);
  const head = box(0.048, 0.034, 0.036, body(), 0, -0.056, -0.118); g.add(head);
  const lensV = cyl(0.011, 0.011, 0.012, glass(), 16); lensV.rotation.x = Math.PI / 2; lensV.position.set(-0.01, -0.056, -0.138); g.add(lensV);
  const ringV = cyl(0.013, 0.013, 0.004, metal(), 16); ringV.rotation.x = Math.PI / 2; ringV.position.set(-0.01, -0.056, -0.133); g.add(ringV);
  const lensT = box(0.014, 0.014, 0.008, mat('therm', () => new THREE.MeshStandardMaterial({ color: 0x3a2a12, roughness: 0.15, metalness: 0.4 })), 0.014, -0.056, -0.137); g.add(lensT);
  // navigation lights: green front (blinks while armed), red back (steady)
  const front = [], back = [];
  const ledG = mat('ledG', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 4, 0.6) })), ledR = mat('ledR', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.1) }));
  const ledOff = mat('ledOff', () => new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  pos.forEach(([sx, sz]) => { const l = box(0.012, 0.006, 0.012, sz < 0 ? ledG : ledR, sx * 0.165 * 0.707, 0.005, sz * 0.165 * 0.707 + sz * 0.012); g.add(l); (sz < 0 ? front : back).push(l); });
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
  // the props turn at a visible rate (a real one at 9,000 rpm would just alias); the blur disc fades in with speed
  let ang = 0;
  g.userData.spin = (motors, dt, on) => {
    const avg = on ? (motors[0] + motors[1] + motors[2] + motors[3]) / 4 : 0;
    ang += dt * (on ? 34 + avg * 40 : 0);
    props.forEach((p, i) => { p.rotation.y = ang * p.userData.dir + i * 0.7; });
    const k = on ? Math.min(1, 0.4 + avg) : 0;
    blur().opacity = k * 0.55; prop().opacity = 1 - k * 0.85;
  };
  g.userData.leds = (t, state) => {
    const blink = state === 'flying' ? (Math.sin(t * 9) > 0) : state === 'landed' ? (Math.sin(t * 3) > 0.6) : false;
    for (const l of front) l.material = blink || state === 'flying' && Math.sin(t * 9) > -0.2 ? ledG : ledOff;
    for (const l of back) l.material = state === 'crashed' || state === 'ditched' ? (Math.sin(t * 12) > 0 ? ledR : ledOff) : ledR;
  };
  if (!o.leds) g.userData.leds(0, 'packed');
  return g;
}

// the box it comes in, for the shop shelves: a printed carton with the drone pictured (a coloured panel)
export function buildDroneBox() {
  const g = new THREE.Group();
  const card = mat('card', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8 }));
  const band = mat('band', () => new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.6 }));
  g.add(box(0.34, 0.12, 0.26, card, 0, 0.06, 0));
  g.add(box(0.342, 0.05, 0.262, band, 0, 0.035, 0));
  g.add(box(0.12, 0.002, 0.08, accent(), -0.08, 0.121, 0.05));
  return g;
}
