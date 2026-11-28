// Prepares the hero character (Cal) for the game from a supplied Tripo GLB.
//
//   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/functions@4.1.1 sharp@0.33.5
//   node tools/characters/prepare-hero.mjs <source.glb> www/characters/<name>.glb [--idle-from <clip>]
//
//   Cal:  node tools/characters/prepare-hero.mjs man_in_jacket_3d_model.glb www/characters/cal.glb
//
// What it does:
//  1. Re-skins any vertices bound to 'neutral_bone' (a joint no clip animates, so they stayed at the
//     origin and dragged long spikes out of the body) with their nearest neighbour's weights.
//  2. Makes every clip in place: the hips' net travel over the clip is removed linearly, so walk, run,
//     swim and the emotes loop on the spot and the game moves the character. Bob, crouch and jump arcs stay.
//     Exporter suffixes ('walk.001') are dropped from clip names.
//  3. --idle-from: adds an 'idle' clip holding the first pose of the named clip, for a model without one
//     (Cal has his own 'standing_relax').
//  4. Merges every skinned part into one draw call, drops redundant keyframes and re-encodes
//     the textures as 1024 px JPEG (4096 px maps cost ≈256 MB of GPU memory per character, 1024 px ≈16 MB).
import { NodeIO } from '@gltf-transform/core';
import { resample, prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [src, out, ...opts] = process.argv.slice(2);
const idleFrom = opts.includes('--idle-from') ? opts[opts.indexOf('--idle-from') + 1] : null;
const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

// 1. vertices bound to the unanimated neutral bone
const skin = root.listSkins()[0], joints = skin.listJoints();
const nb = joints.findIndex(n => n.getName() === 'neutral_bone');
let fixed = 0;
if (nb >= 0) for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), P = prim.getAttribute('POSITION');
  const n = P.getCount(), j = [0, 0, 0, 0], w = [0, 0, 0, 0], p = [0, 0, 0], q = [0, 0, 0];
  const bad = [];
  for (let i = 0; i < n; i++) { J.getElement(i, j); W.getElement(i, w); if (j.some((x, k) => x === nb && w[k] > 0)) bad.push(i); }
  for (const i of bad) {
    P.getElement(i, p); let best = -1, bd = Infinity;
    for (let k = 0; k < n; k++) {
      if (bad.includes(k)) continue;
      P.getElement(k, q); const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) continue;
    J.setElement(i, J.getElement(best, [0, 0, 0, 0])); W.setElement(i, W.getElement(best, [0, 0, 0, 0])); fixed++;
  }
}

// 2. in-place clips: remove the hips' net travel linearly over each clip
for (const anim of root.listAnimations()) anim.setName(anim.getName().replace(/\.\d+$/, ''));
for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) {
  if (ch.getTargetPath() !== 'translation' || ch.getTargetNode()?.getName() !== 'Hip') continue;
  const s = ch.getSampler(), T = s.getInput(), V = s.getOutput(), n = T.getCount();
  const t0 = T.getScalar(0), t1 = T.getScalar(n - 1), a = V.getElement(0, [0, 0, 0]), b = V.getElement(n - 1, [0, 0, 0]), v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const f = (T.getScalar(i) - t0) / Math.max(1e-6, t1 - t0);
    V.getElement(i, v); V.setElement(i, [v[0] - (b[0] - a[0]) * f, v[1] - (b[1] - a[1]) * f, v[2] - (b[2] - a[2]) * f]);
  }
}

// 3. idle: the first pose of another clip, held
const buf = root.listBuffers()[0];
const src0 = idleFrom && root.listAnimations().find(a => a.getName() === idleFrom);
const idle = src0 ? doc.createAnimation('idle') : null;
const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 2])).setBuffer(buf);
if (src0) for (const ch of src0.listChannels()) {
  const s = ch.getSampler(), V = s.getOutput(), k = V.getElementSize(), e = V.getElement(0, new Array(k).fill(0));
  const out = doc.createAccessor().setType(V.getType()).setArray(new Float32Array([...e, ...e])).setBuffer(buf);
  const smp = doc.createAnimationSampler().setInput(times).setOutput(out).setInterpolation('LINEAR');
  idle.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(smp));
}

// 4. one draw call: every part shares the skin and the material and sits at the identity transform,
// so the primitives are concatenated into a single skinned primitive on the first mesh node
{
  const nodes = root.listNodes().filter(n => n.getMesh() && n.getSkin() === skin);
  const prims = nodes.flatMap(n => n.getMesh().listPrimitives());
  const names = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'];
  const total = prims.reduce((t, p) => t + p.getAttribute('POSITION').getCount(), 0);
  const arrays = Object.fromEntries(names.map(nm => {
    const a = prims[0].getAttribute(nm), k = a.getElementSize();
    return [nm, { k, type: a.getType(), arr: nm === 'JOINTS_0' ? new Uint16Array(total * k) : new Float32Array(total * k) }];
  }));
  const idx = [];
  let base = 0;
  for (const p of prims) {
    const n = p.getAttribute('POSITION').getCount();
    for (const nm of names) {
      const a = p.getAttribute(nm), { k, arr } = arrays[nm], e = new Array(k).fill(0);
      for (let i = 0; i < n; i++) { a.getElement(i, e); for (let c = 0; c < k; c++) arr[(base + i) * k + c] = e[c]; }
    }
    const I = p.getIndices();
    if (I) for (let i = 0; i < I.getCount(); i++) idx.push(I.getScalar(i) + base); else for (let i = 0; i < n; i++) idx.push(base + i);
    base += n;
  }
  const prim = doc.createPrimitive().setMaterial(prims[0].getMaterial());
  for (const nm of names) prim.setAttribute(nm, doc.createAccessor().setType(arrays[nm].type).setArray(arrays[nm].arr).setBuffer(buf));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  const mesh = doc.createMesh('hero').addPrimitive(prim);
  nodes[0].setMesh(mesh).setName('hero');
  for (const n of nodes.slice(1)) n.dispose();
}
// lean keyframes, phone-sized textures
await doc.transform(
  dedup(),
  resample({ tolerance: 1e-4 }),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 88 }),
);
await io.write(out, doc);
const r = (await io.read(out)).getRoot();
console.log(`fixed ${fixed} vertices; meshes ${r.listMeshes().length}, primitives ${r.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0)}, clips ${r.listAnimations().length}: ${r.listAnimations().map(a => a.getName()).join(', ')}`);
