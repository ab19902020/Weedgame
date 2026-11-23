// Smooth-shaded human part meshes for the instanced crowd in characters.js. Same part names,
// pivots and proportions as before (hips at 0.9 m, shoulders at 1.44 m, head at 1.64 m), so
// posing code is unchanged. Front is +z.
import * as THREE from 'three/webgpu';
import { mergeGeos } from './tiles.js';

const V = (r, y) => new THREE.Vector2(r, y);
// smooth normals are computed while indexed, then expanded so parts merge with mergeGeos
const fin = g => { g.deleteAttribute('uv'); g.computeVertexNormals(); return g.index ? g.toNonIndexed() : g; };
const lathe = (pts, seg = 14) => new THREE.LatheGeometry(pts, seg);
const merge = list => mergeGeos(list.map(fin));

export function partGeo(kind) {
  if (kind === 'torso') {
    // hips -> waist -> chest -> shoulders -> neck, elliptical in plan
    const t = lathe([V(0.0, 0.84), V(0.165, 0.845), V(0.178, 0.92), V(0.168, 1.02), V(0.16, 1.08), V(0.176, 1.2), V(0.188, 1.31),
      V(0.186, 1.39), V(0.15, 1.455), V(0.085, 1.485), V(0.055, 1.5), V(0.052, 1.58), V(0.0, 1.585)], 12);
    t.scale(1, 1, 0.64);
    // shoulder caps so the arms join the body
    const sl = new THREE.SphereGeometry(0.056, 8, 5); sl.scale(1, 0.8, 1.05); sl.translate(-0.19, 1.41, 0);
    const sr = sl.clone(); sr.translate(0.38, 0, 0);
    // collar
    const collar = new THREE.TorusGeometry(0.062, 0.016, 4, 10); collar.rotateX(Math.PI / 2); collar.scale(1.15, 1, 0.95); collar.translate(0, 1.49, 0.005);
    return merge([t, sl, sr, collar]);
  }
  if (kind === 'head') {
    const skull = new THREE.SphereGeometry(0.1, 14, 10);
    const p = skull.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // narrower jaw and chin, flatter sides, fuller back of head
      const jaw = y < 0 ? 1 - 0.22 * Math.min(1, -y / 0.1) : 1;
      x *= 0.9 * jaw; z *= (z > 0 ? 1.0 : 1.06) * (y < -0.02 ? 0.97 : 1); y *= 1.16;
      p.setXYZ(i, x, y, z);
    }
    skull.translate(0, 1.645, 0);
    const nose = new THREE.ConeGeometry(0.016, 0.04, 6); nose.rotateX(Math.PI / 2 + 0.35); nose.translate(0, 1.632, 0.1);
    const earL = new THREE.SphereGeometry(0.022, 6, 4); earL.scale(0.45, 1.25, 0.9); earL.translate(-0.091, 1.645, -0.005);
    const earR = earL.clone(); earR.translate(0.182, 0, 0);
    return merge([skull, nose, earL, earR]);
  }
  if (kind === 'hair') {
    const g = new THREE.SphereGeometry(0.108, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.56);
    g.scale(0.95, 1.08, 1.08); g.translate(0, 1.665, -0.012);
    return merge([g]);
  }
  if (kind === 'leg') {
    // thigh -> knee -> calf -> ankle (pivot at the hip joint)
    const l = lathe([V(0.0, 0.02), V(0.082, 0.0), V(0.08, -0.12), V(0.066, -0.36), V(0.056, -0.45), V(0.06, -0.56), V(0.047, -0.76), V(0.042, -0.84), V(0.0, -0.845)], 8);
    l.scale(1, 1, 1.08);
    const shoe = new THREE.CapsuleGeometry(0.048, 0.17, 2, 7); shoe.rotateX(Math.PI / 2); shoe.scale(1.05, 0.72, 1); shoe.translate(0, -0.85, 0.05);
    return merge([l, shoe]);
  }
  if (kind === 'arm') {
    const a = lathe([V(0.0, 0.03), V(0.056, 0.01), V(0.054, -0.12), V(0.045, -0.27), V(0.043, -0.31), V(0.039, -0.45), V(0.033, -0.55), V(0.0, -0.56)], 7);
    return merge([a]);
  }
  if (kind === 'hand') {
    const palm = new THREE.SphereGeometry(0.042, 7, 5); palm.scale(0.75, 1.45, 1.0); palm.translate(0, -0.615, 0.006);
    const thumb = new THREE.CapsuleGeometry(0.012, 0.03, 1, 4); thumb.rotateX(0.5); thumb.translate(0, -0.6, 0.035);
    return merge([palm, thumb]);
  }
  if (kind === 'hat') {
    // police custodian-style helmet
    const dome = lathe([V(0.0, 1.95), V(0.05, 1.94), V(0.095, 1.89), V(0.115, 1.8), V(0.118, 1.74), V(0.0, 1.74)], 16);
    const comb = new THREE.SphereGeometry(0.018, 8, 6); comb.translate(0, 1.955, 0);
    const brim = new THREE.CylinderGeometry(0.15, 0.15, 0.012, 20); brim.translate(0, 1.735, 0);
    const badge = new THREE.CircleGeometry(0.025, 10); badge.translate(0, 1.82, 0.112);
    return merge([dome, comb, brim, badge]);
  }
  if (kind === 'umbrella') {
    const canopy = new THREE.ConeGeometry(0.55, 0.26, 16, 1, true); canopy.translate(0, 2.12, 0);
    const p = canopy.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x); if (p.getY(i) < 2.1) p.setY(i, p.getY(i) + 0.03 * Math.cos(a * 8)); }
    const st = new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5); st.translate(0, 1.7, 0);
    const handle = new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI); handle.translate(0.03, 1.23, 0);
    return merge([canopy, st, handle]);
  }
  if (kind === 'bag') {
    const g = new THREE.CapsuleGeometry(0.11, 0.14, 4, 10); g.scale(1.1, 1, 0.45); g.translate(0, 1.18, -0.17);
    const strap = new THREE.TorusGeometry(0.2, 0.01, 4, 16, Math.PI * 0.9); strap.rotateY(Math.PI / 2); strap.rotateZ(0.0); strap.translate(0, 1.3, -0.04);
    return merge([g, strap]);
  }
  throw new Error('unknown part ' + kind);
}
