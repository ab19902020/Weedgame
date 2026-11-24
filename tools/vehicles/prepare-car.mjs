// Prepares a supplied car model (Tripo GLB, many parts on one material) for the game:
//
//   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/functions@4.1.1 sharp@0.33.5
//   node tools/vehicles/prepare-car.mjs range_rover_3d_model.glb www/vehicles/rangerover.glb \
//        --wheels fl=tripo_part_6,fr=tripo_part_5,rl=tripo_part_3,rr=tripo_part_4
//
// Output: one 'body' mesh (every non-wheel part merged, part offsets baked: one draw call) and four
// wheel nodes 'wheel_fl' … 'wheel_rr' whose geometry is re-centred on its axle (bounding-box centre), so
// the game can spin each wheel about its own axle and steer the fronts. Textures: base colour 2048 px,
// normal and roughness/metal 1024 px (from 4096 px). The model keeps its own units and axes (+Z forward,
// +Y up, +X the car's left); the game scales and turns it (src/heroCars.js).
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [src, out, ...opts] = process.argv.slice(2);
const wheelArg = opts.includes('--wheels') ? opts[opts.indexOf('--wheels') + 1] : '';
const wheelOf = Object.fromEntries(wheelArg.split(',').filter(Boolean).map(s => s.split('=')).map(([k, v]) => [v, k]));
const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot(), buf = root.listBuffers()[0], scene = root.listScenes()[0];
const names = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

// concatenate primitives (with each node's translation baked in, minus an optional centre)
function merge(parts, centre = [0, 0, 0]) {
  const total = parts.reduce((t, [, p]) => t + p.getAttribute('POSITION').getCount(), 0);
  const arr = { POSITION: new Float32Array(total * 3), NORMAL: new Float32Array(total * 3), TEXCOORD_0: new Float32Array(total * 2) };
  const idx = []; let base = 0;
  for (const [node, p] of parts) {
    const t = node.getTranslation(), n = p.getAttribute('POSITION').getCount();
    if (node.getRotation().some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-6) || node.getScale().some(v => Math.abs(v - 1) > 1e-6)) throw new Error('part has rotation/scale: ' + node.getName());
    for (const nm of names) {
      const a = p.getAttribute(nm), k = a.getElementSize(), e = new Array(k).fill(0);
      for (let i = 0; i < n; i++) { a.getElement(i, e); for (let c = 0; c < k; c++) arr[nm][(base + i) * k + c] = nm === 'POSITION' ? e[c] + t[c] - centre[c] : e[c]; }
    }
    const I = p.getIndices();
    if (I) for (let i = 0; i < I.getCount(); i++) idx.push(I.getScalar(i) + base); else for (let i = 0; i < n; i++) idx.push(base + i);
    base += n;
  }
  const prim = doc.createPrimitive().setMaterial(parts[0][1].getMaterial());
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(arr.POSITION).setBuffer(buf));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(arr.NORMAL).setBuffer(buf));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(arr.TEXCOORD_0).setBuffer(buf));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  return prim;
}
const meshNodes = root.listNodes().filter(n => n.getMesh());
const bodyParts = [], wheels = [];
for (const n of meshNodes) for (const p of n.getMesh().listPrimitives()) (wheelOf[n.getName()] ? wheels : bodyParts).push([n, p]);
const top = doc.createNode('car');
scene.listChildren().forEach(c => scene.removeChild(c));
scene.addChild(top);
top.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(merge(bodyParts))));
for (const [node, p] of wheels) {
  const pos = p.getAttribute('POSITION'), mn = pos.getMinNormalized ? null : null;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], e = [0, 0, 0], t = node.getTranslation();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, e); for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], e[c] + t[c]); hi[c] = Math.max(hi[c], e[c] + t[c]); } }
  // axle: centre in height and length; across the car keep the wheel's own centre too
  const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const key = wheelOf[node.getName()];
  top.addChild(doc.createNode('wheel_' + key).setTranslation(centre).setMesh(doc.createMesh('wheel_' + key).addPrimitive(merge([[node, p]], centre)))
    .setExtras({ radius: Math.max(hi[1] - lo[1], hi[2] - lo[2]) / 2 }));
}
for (const n of meshNodes) n.dispose();
await doc.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', slots: /baseColor/, resize: [2048, 2048], quality: 88 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', slots: /^(?!baseColor)/, resize: [1024, 1024], quality: 88 }),
);
await io.write(out, doc);
const r = (await io.read(out)).getRoot();
console.log('nodes:', r.listNodes().map(n => `${n.getName()}${n.getMesh() ? ` (${n.getMesh().listPrimitives()[0].getAttribute('POSITION').getCount()} v)` : ''}${n.getExtras().radius ? ` r=${n.getExtras().radius.toFixed(4)} at ${n.getTranslation().map(v => v.toFixed(4))}` : ''}`).join(', '));
