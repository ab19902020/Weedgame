// The front doors of the buildings you can go into, one design for both sides: the one you walk up to outside
// (interiors.js outsideBits) and the same door seen from inside (interiorMesh.js, the front opening). A door is a list
// of parts in its own frame: x across it from its middle, y up from the threshold, z out from the wall towards the
// street. Each part is paint (its colour), metal (chrome, brass, stainless) or glass (clear, or frosted).
//   house: a composite front door in a white uPVC frame: raised panels below, frosted glazing above (or a fanlight
//          over the door), a chrome letterbox, a lever handle, on some a knocker
//   shop:  an aluminium-framed glass door, a pair when the doorway's wide: pull handles, kick plates, PUSH and PULL
//          and the opening hours on the glass
//   pub:   a gloss-painted door: raised panels below, etched glass in the top two, brass push and kick plates
//   church: oak boards with black iron straps and a ring handle; warehouse: a steel door with a push bar
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shade = (c, k) => { const r = Math.min(255, ((c >> 16) & 255) * k), g = Math.min(255, ((c >> 8) & 255) * k), b = Math.min(255, (c & 255) * k); return (r << 16) | (g << 8) | b; };
export const DOOR_KIND = s => ['shop', 'food', 'gadget', 'office', 'mall'].includes(s.kind) ? 'shop' : s.kind === 'pub' ? 'pub' : s.kind === 'church' ? 'church' : s.kind === 'warehouse' ? 'warehouse' : 'house';

// parts: [{ m: 'paint' | 'metal' | 'glass' | 'frost', x0, x1, y0, y1, z0, z1, c }]
export function doorParts(kind, w, h, col, seed = 0) {
  const P = [], add = (m, x0, x1, y0, y1, z0, z1, c = col) => P.push({ m, x0, x1, y0, y1, z0, z1, c });
  const hw = w / 2;
  if (kind === 'shop') {
    const AL = 0x2a2d31, SS = 0xd3d6d9;
    // the outer frame, the leaves (a pair over 1.2 m), stiles and rails round the glass
    add('paint', -hw - 0.06, -hw, 0, h + 0.08, -0.02, 0.07, AL); add('paint', hw, hw + 0.06, 0, h + 0.08, -0.02, 0.07, AL);
    add('paint', -hw - 0.06, hw + 0.06, h, h + 0.08, -0.02, 0.07, AL);
    const leaves = w > 1.2 ? [[-hw, 0, 1], [0, hw, -1]] : [[-hw, hw, -1]];
    for (const [a, b, toward] of leaves) {
      add('paint', a, a + 0.055, 0.02, h, 0.0, 0.05, AL); add('paint', b - 0.055, b, 0.02, h, 0.0, 0.05, AL);
      add('paint', a, b, h - 0.08, h, 0.0, 0.05, AL); add('paint', a, b, 0.02, 0.22, 0.0, 0.05, AL);
      add('glass', a + 0.055, b - 0.055, 0.22, h - 0.08, 0.02, 0.03);
      add('metal', a + 0.07, b - 0.07, 0.04, 0.2, 0.05, 0.054, SS);                          // the kick plate
      // the pull handle by the meeting edge (or the lock side): a bar on two stand-offs
      const hx = toward > 0 ? b - 0.12 : a + 0.12;
      add('metal', hx - 0.016, hx + 0.016, 0.75, 1.45, 0.085, 0.115, SS);
      for (const y of [0.8, 1.4]) add('metal', hx - 0.01, hx + 0.01, y - 0.01, y + 0.01, 0.05, 0.085, SS);
      // PUSH / PULL, and on the first leaf the opening hours, in white vinyl on the glass
      add('paint', hx - 0.07 * toward - 0.06, hx - 0.07 * toward + 0.06, 1.52, 1.57, 0.031, 0.034, 0xf2f2f0);
      if (a === -hw) for (let k = 0; k < 6; k++) { const y = 1.05 - k * 0.045; add('paint', a + 0.12, a + 0.12 + (k ? 0.2 : 0.26), y, y + 0.014, 0.031, 0.034, 0xf2f2f0); }
    }
    add('metal', -hw - 0.06, hw + 0.06, 0, 0.02, -0.02, 0.09, 0xb9bcbf);                  // the threshold
    return P;
  }
  if (kind === 'pub') {
    const BR = 0xc9a24a, fr = shade(col, 0.75);
    add('paint', -hw - 0.09, -hw, 0, h + 0.09, -0.02, 0.07, fr); add('paint', hw, hw + 0.09, 0, h + 0.09, -0.02, 0.07, fr); add('paint', -hw - 0.09, hw + 0.09, h, h + 0.09, -0.02, 0.07, fr);
    add('paint', -hw, hw, 0.02, h, 0, 0.045);
    const xa = [-hw + 0.08, -0.03], xb = [0.03, hw - 0.08];
    for (const [x0, x1] of [xa, xb]) {
      add('paint', x0, x1, 0.25, 0.85, 0.045, 0.06, shade(col, 1.12));                           // raised panels below
      add('frost', x0, x1, 1.15, h - 0.12, 0.035, 0.045, 0xe6ecee);                               // etched glass above
      add('paint', x0, x1, 1.13, 1.16, 0.045, 0.058, shade(col, 0.9)); add('paint', x0, x1, h - 0.13, h - 0.1, 0.045, 0.058, shade(col, 0.9));
      add('paint', (x0 + x1) / 2 - 0.012, (x0 + x1) / 2 + 0.012, 1.15, h - 0.12, 0.045, 0.055, shade(col, 0.9));   // a glazing bar
    }
    add('metal', hw - 0.12, hw - 0.04, 0.95, 1.3, 0.045, 0.05, BR);                                 // push plate
    add('metal', -hw + 0.04, hw - 0.04, 0.03, 0.2, 0.045, 0.05, BR);                                // kick plate
    add('metal', hw - 0.22, hw - 0.08, 1.06, 1.09, 0.05, 0.08, BR);                                 // handle
    add('metal', -hw - 0.09, hw + 0.09, 0, 0.02, -0.02, 0.09, 0x9a9690);
    return P;
  }
  if (kind === 'church') {
    const IR = 0x18181a;
    add('paint', -hw - 0.14, -hw, 0, h + 0.14, -0.03, 0.08, 0x9a9384); add('paint', hw, hw + 0.14, 0, h + 0.14, -0.03, 0.08, 0x9a9384); add('paint', -hw - 0.14, hw + 0.14, h, h + 0.14, -0.03, 0.08, 0x9a9384);
    add('paint', -hw, hw, 0.02, h, 0, 0.05, col);
    for (let x = -hw + 0.12; x < hw - 0.05; x += 0.13) add('paint', x - 0.006, x + 0.006, 0.04, h - 0.02, 0.05, 0.054, shade(col, 0.7));   // the boards
    for (const y of [0.35, 1.15, h - 0.35]) add('metal', -hw + 0.03, hw - 0.03, y, y + 0.06, 0.05, 0.062, IR);
    add('metal', hw - 0.2, hw - 0.1, 1.0, 1.1, 0.062, 0.08, IR);
    return P;
  }
  if (kind === 'warehouse') {
    const GR = 0x8e9399;
    add('paint', -hw - 0.05, -hw, 0, h + 0.05, -0.02, 0.06, 0x55595e); add('paint', hw, hw + 0.05, 0, h + 0.05, -0.02, 0.06, 0x55595e); add('paint', -hw - 0.05, hw + 0.05, h, h + 0.05, -0.02, 0.06, 0x55595e);
    add('paint', -hw, hw, 0.02, h, 0, 0.045, col);
    add('glass', -0.12, 0.12, 1.3, 1.75, 0.03, 0.04);                                                // a vision panel
    add('metal', -hw + 0.08, hw - 0.08, 1.0, 1.05, 0.06, 0.1, GR); for (const x of [-hw + 0.1, hw - 0.1]) add('metal', x - 0.03, x + 0.03, 0.97, 1.08, 0.045, 0.06, GR);
    return P;
  }
  // a house: composite door, white uPVC frame (and on some a fanlight over the door)
  const WH = 0xf1f0ea, CH = 0xc9ccd0, fan = seed % 3 === 0;
  const top = fan ? h + 0.32 : h;
  add('paint', -hw - 0.07, -hw, 0, top + 0.07, -0.02, 0.07, WH); add('paint', hw, hw + 0.07, 0, top + 0.07, -0.02, 0.07, WH); add('paint', -hw - 0.07, hw + 0.07, top, top + 0.07, -0.02, 0.07, WH);
  if (fan) { add('paint', -hw, hw, h, h + 0.04, -0.02, 0.07, WH); add('frost', -hw, hw, h + 0.04, top, 0.02, 0.03, 0xdbe4e8); }
  add('paint', -hw, hw, 0.02, h, 0, 0.045);
  const style = seed % 4, x0 = -hw + 0.09, x1 = hw - 0.09;
  if (style === 0) {
    // four panels, the top pair glazed
    for (const [a, b] of [[x0, -0.03], [0.03, x1]]) { add('paint', a, b, 0.14, 0.8, 0.045, 0.058, shade(col, 1.1)); add('frost', a, b, 1.3, h - 0.14, 0.04, 0.05, 0xd7e0e4); add('paint', a - 0.015, b + 0.015, h - 0.15, h - 0.13, 0.045, 0.056, shade(col, 1.1)); add('paint', a - 0.015, b + 0.015, 1.28, 1.3, 0.045, 0.056, shade(col, 1.1)); }
  } else if (style === 1) {
    // a tall glazed light down the middle, panels either side
    add('frost', -0.11, 0.11, 0.35, h - 0.16, 0.04, 0.05, 0xd7e0e4);
    for (const [a, b] of [[x0, -0.17], [0.17, x1]]) { add('paint', a, b, 0.14, 0.95, 0.045, 0.058, shade(col, 1.1)); add('paint', a, b, 1.15, h - 0.16, 0.045, 0.058, shade(col, 1.1)); }
  } else if (style === 2) {
    // a half-moon light at the top, two long panels below
    add('frost', -0.2, 0.2, h - 0.42, h - 0.14, 0.04, 0.05, 0xd7e0e4);
    for (const [a, b] of [[x0, -0.03], [0.03, x1]]) add('paint', a, b, 0.14, h - 0.55, 0.045, 0.058, shade(col, 1.1));
  } else {
    // three small square lights in a row, a big panel below
    for (const k of [-1, 0, 1]) add('frost', k * 0.2 - 0.07, k * 0.2 + 0.07, h - 0.45, h - 0.2, 0.04, 0.05, 0xd7e0e4);
    add('paint', x0, x1, 0.14, h - 0.62, 0.045, 0.058, shade(col, 1.1));
  }
  add('metal', -0.16, 0.16, 0.98, 1.05, 0.045, 0.058, CH); add('paint', -0.13, 0.13, 1.0, 1.03, 0.058, 0.06, 0x1a1a1a);   // the letterbox
  add('metal', hw - 0.11, hw - 0.07, 0.88, 1.2, 0.045, 0.055, CH); add('metal', hw - 0.24, hw - 0.07, 1.03, 1.055, 0.055, 0.085, CH);   // the handle
  if (seed % 2) add('metal', -0.05, 0.05, 1.42, 1.55, 0.045, 0.07, CH);                                                          // a knocker
  add('metal', -hw - 0.07, hw + 0.07, 0, 0.025, -0.02, 0.09, 0xb9bcbf);                                                        // the threshold
  return P;
}

// one mesh per kind of surface, the parts' colours in their vertices; the materials are shared by every door
let MATS = null;
function materials() {
  return MATS ??= {
    paint: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 }),
    metal: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0xb8ced8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }),
    frost: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.9 }),
  };
}
export function doorMeshes(parts) {
  const M = materials(), out = [];
  for (const m of ['paint', 'metal', 'frost', 'glass']) {
    const ps = parts.filter(p => p.m === m); if (!ps.length) continue;
    const geos = ps.map(p => {
      const g = new THREE.BoxGeometry(Math.max(0.002, p.x1 - p.x0), Math.max(0.002, p.y1 - p.y0), Math.max(0.002, p.z1 - p.z0));
      g.translate((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2); g.deleteAttribute('uv');
      const c = new THREE.Color(p.c ?? 0xffffff), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos), M[m]);
    for (const g of geos) g.dispose();
    if (m === 'glass') mesh.renderOrder = 2;
    out.push(mesh);
  }
  return out;
}
