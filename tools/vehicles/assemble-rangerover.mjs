// Builds www/vehicles/rangerover.glb from the supplied exterior, dashboard and three seats.
//
// Exterior (Tripo): +Z forward, +Y up, +X the car's left. Wheels are separate discs.
// Dashboard (Tripo): +Z toward the driver, +X the car's right (RHD wheel), +Y up. Much larger than the shell.
// Seats (FBX, exported to GLB in centimetres): +X is the way the occupant faces, +Y up.
//
// Output nodes (src/heroCars.js): body, wheel_fl/fr/rl/rr (geometry centred on the axle),
// cabin* (sprung with the body), steering (centred, spins on local Z — the column).
import { NodeIO } from '@gltf-transform/core';
import { copyToDocument, dedup, prune, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const EXT = process.argv[2] || '/workspace/attachments/white range rover 3d model.glb';
const INT = process.argv[3] || '/workspace/attachments/car interior 3d model.glb';
const SEATS = {
  driver: process.argv[4] || '/tmp/seats/driver.glb',
  pass: process.argv[5] || '/tmp/seats/pass.glb',
  rear: process.argv[6] || '/tmp/seats/rear.glb',
};
const OUT = process.argv[7] || 'www/vehicles/rangerover.glb';

// Fit the dash inside the shell. 1 exterior unit = 5.06 m (heroCars scale).
const INT_S = 0.30;
const INT_T = [0, 0.100, 0.055]; // model metres-ish: floor, and the scuttle just under the windscreen
const CM = 1 / 506;               // seat centimetres -> exterior units
const REAR_K = 1.58;              // the bench file is short; match the front-seat height
// seat reference points (exterior units): right-hand drive
const SEAT = {
  driver: { x: -0.090, z: -0.070, floor: 0.108 },
  pass: { x: 0.090, z: -0.070, floor: 0.108, mirror: true },
  rear: { x: 0, z: -0.300, floor: 0.108, k: REAR_K },
};

const WHEELS = { tripo_part_4: 'fl', tripo_part_5: 'fr', tripo_part_2: 'rl', tripo_part_3: 'rr' };
const STEER_NAME = 'tripo_part_3';

const io = new NodeIO();

function xformAccessor(prim, posFn, norFn) {
  const pos = prim.getAttribute('POSITION');
  const src = pos.getArray();
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const p = posFn(src[i], src[i + 1], src[i + 2]);
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  pos.setArray(out);
  const nor = prim.getAttribute('NORMAL');
  if (nor && norFn) {
    const ns = nor.getArray(), no = new Float32Array(ns.length);
    for (let i = 0; i < ns.length; i += 3) {
      const n = norFn(ns[i], ns[i + 1], ns[i + 2]);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      no[i] = n[0] / l; no[i + 1] = n[1] / l; no[i + 2] = n[2] / l;
    }
    nor.setArray(no);
  }
}

function nodeMatrix(node) {
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
  const [x, y, z, w] = r;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  const m = [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0],
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1],
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2],
    t[0], t[1], t[2],
  ];
  return m;
}
function applyNode(prim, node) {
  const m = nodeMatrix(node);
  xformAccessor(prim,
    (x, y, z) => [m[0] * x + m[3] * y + m[6] * z + m[9], m[1] * x + m[4] * y + m[7] * z + m[10], m[2] * x + m[5] * y + m[8] * z + m[11]],
    (x, y, z) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z]);
  node.setTranslation([0, 0, 0]); node.setRotation([0, 0, 0, 1]); node.setScale([1, 1, 1]);
}

function bbox(prim) {
  const a = prim.getAttribute('POSITION').getArray();
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a[i + c]); hi[c] = Math.max(hi[c], a[i + c]); }
  return { lo, hi, n: a.length / 3 };
}

function mergePrims(doc, prims) {
  const buf = doc.getRoot().listBuffers()[0];
  let total = 0;
  for (const p of prims) total += p.getAttribute('POSITION').getCount();
  const arr = { POSITION: new Float32Array(total * 3), NORMAL: new Float32Array(total * 3), TEXCOORD_0: new Float32Array(total * 2) };
  const idx = []; let base = 0;
  for (const p of prims) {
    const n = p.getAttribute('POSITION').getCount();
    for (const nm of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
      const a = p.getAttribute(nm);
      if (!a) { if (nm !== 'TEXCOORD_0') throw new Error('missing ' + nm); continue; }
      const k = a.getElementSize(), e = new Array(k);
      for (let i = 0; i < n; i++) { a.getElement(i, e); for (let c = 0; c < k; c++) arr[nm][(base + i) * k + c] = e[c]; }
    }
    const I = p.getIndices();
    if (I) for (let i = 0; i < I.getCount(); i++) idx.push(I.getScalar(i) + base);
    else for (let i = 0; i < n; i++) idx.push(base + i);
    base += n;
  }
  const prim = doc.createPrimitive().setMaterial(prims[0].getMaterial());
  const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  prim.setAttribute('POSITION', acc('VEC3', arr.POSITION));
  prim.setAttribute('NORMAL', acc('VEC3', arr.NORMAL));
  if (prims[0].getAttribute('TEXCOORD_0')) prim.setAttribute('TEXCOORD_0', acc('VEC2', arr.TEXCOORD_0));
  prim.setIndices(acc('SCALAR', new Uint32Array(idx)));
  return prim;
}

function recenter(prim) {
  const b = bbox(prim), c = b.lo.map((v, i) => (v + b.hi[i]) / 2);
  xformAccessor(prim, (x, y, z) => [x - c[0], y - c[1], z - c[2]], null);
  return { c, r: Math.max(b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) / 2 };
}

// ---------------------------------------------------------------- exterior
const ext = await io.read(EXT);
const extRoot = ext.getRoot(), extScene = extRoot.listScenes()[0];
const extNodes = extRoot.listNodes().filter(n => n.getMesh());
const bodyPrims = [], wheelNodes = [];
for (const n of extNodes) {
  for (const p of n.getMesh().listPrimitives()) applyNode(p, n);
  if (WHEELS[n.getName()]) wheelNodes.push(n);
  else for (const p of n.getMesh().listPrimitives()) bodyPrims.push(p);
}
const top = ext.createNode('car');
for (const c of extScene.listChildren()) extScene.removeChild(c);
extScene.addChild(top);
top.addChild(ext.createNode('body').setMesh(ext.createMesh('body').addPrimitive(mergePrims(ext, bodyPrims))));
for (const n of wheelNodes) {
  const p = n.getMesh().listPrimitives()[0];
  const { c, r } = recenter(p);
  const key = WHEELS[n.getName()];
  top.addChild(ext.createNode('wheel_' + key).setTranslation(c).setMesh(ext.createMesh('wheel_' + key).addPrimitive(p)).setExtras({ radius: r }));
}
for (const n of extNodes) if (!wheelNodes.includes(n)) n.dispose();
console.log('exterior body', bbox(top.listChildren().find(n => n.getName() === 'body').getMesh().listPrimitives()[0]));

// ---------------------------------------------------------------- interior (dash). Ry(180) then scale and slide into the cabin.
function intPos(x, y, z) {
  return [-x * INT_S + INT_T[0], y * INT_S + INT_T[1], -z * INT_S + INT_T[2]];
}
function intNor(x, y, z) { return [-x, y, -z]; }
const inn = await io.read(INT);
const innNodes = inn.getRoot().listNodes().filter(n => n.getMesh());
const dashPrims = [];
let steerPrim = null;
for (const n of innNodes) {
  for (const p of n.getMesh().listPrimitives()) {
    applyNode(p, n);
    xformAccessor(p, intPos, intNor);
    if (n.getName() === STEER_NAME) steerPrim = p; else dashPrims.push(p);
  }
}
const steerInfo = recenter(steerPrim);
const mapIn = copyToDocument(ext, inn, [dashPrims[0].getMaterial(), steerPrim.getMaterial()]);
const dashMat = mapIn.get(dashPrims[0].getMaterial());
const steerMat = mapIn.get(steerPrim.getMaterial());
// primitives still belong to the interior document; rebuild them in ext by merging arrays
function adopt(doc, prim, material) {
  // prim is in another document — copy arrays
  const buf = doc.getRoot().listBuffers()[0];
  const out = doc.createPrimitive().setMaterial(material);
  for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
    const a = prim.getAttribute(semantic);
    if (!a) continue;
    const type = semantic === 'TEXCOORD_0' ? 'VEC2' : 'VEC3';
    out.setAttribute(semantic, doc.createAccessor().setType(type).setArray(new Float32Array(a.getArray())).setBuffer(buf));
  }
  const I = prim.getIndices();
  if (I) out.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(I.getArray())).setBuffer(buf));
  return out;
}
const dashMerged = mergePrims(inn, dashPrims); // still in inn
top.addChild(ext.createNode('cabin').setMesh(ext.createMesh('cabin').addPrimitive(adopt(ext, dashMerged, dashMat))));
top.addChild(ext.createNode('steering').setTranslation(steerInfo.c)
  .setMesh(ext.createMesh('steering').addPrimitive(adopt(ext, steerPrim, steerMat)))
  .setExtras({ radius: steerInfo.r }));
console.log('steering at', steerInfo.c.map(v => +v.toFixed(3)), 'r', steerInfo.r.toFixed(3));

// ---------------------------------------------------------------- seats
function seatXform(kind) {
  const S = SEAT[kind];
  const k = CM * (S.k || 1);
  return {
    // optional mirror across the seat's own width, then Ry(-90): face (+X) turns to exterior +Z
    pos: (x, y, z) => {
      const zz = S.mirror ? -z : z;
      return [-zz * k + S.x, y * k, x * k + S.z];
    },
    nor: (x, y, z) => {
      const zz = S.mirror ? -z : z;
      return [-zz, y, x];
    },
    place(doc) {
      let loY = 1e9;
      const prims = [];
      for (const n of doc.getRoot().listNodes()) {
        if (!n.getMesh()) continue;
        for (const p of n.getMesh().listPrimitives()) {
          applyNode(p, n);
          xformAccessor(p, this.pos, this.nor);
          const b = bbox(p); loY = Math.min(loY, b.lo[1]);
          prims.push(p);
        }
      }
      const lift = S.floor - loY;
      for (const p of prims) xformAccessor(p, (x, y, z) => [x, y + lift, z], null);
      const b = bbox(prims[0]);
      console.log('seat', kind, 'size', b.lo.map((v, i) => +(b.hi[i] - v).toFixed(3)), 'min', b.lo.map(v => +v.toFixed(3)), 'max', b.hi.map(v => +v.toFixed(3)));
      return prims;
    },
  };
}
for (const kind of ['driver', 'pass', 'rear']) {
  const doc = await io.read(SEATS[kind]);
  const prims = seatXform(kind).place(doc);
  // one mesh per material group — seats are a single material in practice; merge those that share it
  const groups = new Map();
  for (const p of prims) {
    const m = p.getMaterial();
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(p);
  }
  let i = 0;
  for (const [mat, ps] of groups) {
    const merged = ps.length > 1 ? mergePrims(doc, ps) : ps[0];
    const copied = copyToDocument(ext, doc, [merged.getMaterial()]).get(merged.getMaterial());
    const name = 'cabin_' + kind + (groups.size > 1 ? '_' + i : '');
    top.addChild(ext.createNode(name).setMesh(ext.createMesh(name).addPrimitive(adopt(ext, merged, copied))));
    i++;
  }
}

await ext.transform(
  weld({ tolerance: 0.00001 }),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', slots: /baseColor/, resize: [2048, 2048], quality: 86 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', slots: /^(?!baseColor)/, resize: [1024, 1024], quality: 82 }),
);
await io.write(OUT, ext);
const check = await io.read(OUT);
console.log('wrote', OUT);
for (const n of check.getRoot().listNodes()) {
  if (!n.getMesh()) continue;
  const p = n.getMesh().listPrimitives()[0];
  const b = bbox(p);
  console.log(n.getName(), 'v', b.n, 't', n.getTranslation().map(v => +v.toFixed(3)).join(','),
    'sz', b.hi.map((h, i) => +(h - b.lo[i]).toFixed(3)).join(','));
}
