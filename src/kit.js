// Props from the supplied Crayon City kit (free licence: www/props/CRAYON-LICENSE.txt), each baked once into one
// geometry with its parts' colours in the vertices (the kit's collision boxes left out), so every copy of every prop
// can share one material and be instanced.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, positionWorld } from 'three/tsl';
import { lightPool } from './materials.js';
import { cloudShadow } from './env.js';

const cache = new Map();
let material = null;
export function kitMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  const albedo = attribute('color', 'vec3');
  material.colorNode = albedo.mul(cloudShadow(positionWorld));
  material.emissiveNode = lightPool(positionWorld).mul(albedo);
  return material;
}
// the geometry of props/<name>.glb (a promise; null if it won't load)
export function loadKit(name) {
  if (!cache.has(name)) cache.set(name, new GLTFLoader().loadAsync(`props/${name}.glb`).then(g => {
    const root = g.scene; root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => {
      if (!o.isMesh || /collider/i.test(o.material?.name || '') || o.material?.opacity === 0) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const c = o.material.color || new THREE.Color(1, 1, 1), n = geo.attributes.position.count, col = new Float32Array(n * 3);
      // glass reads as dark tinted glass, not the kit's pale blue
      const glass = /glass/i.test(o.material.name || '');
      for (let i = 0; i < n; i++) { col[i * 3] = glass ? 0.05 : c.r; col[i * 3 + 1] = glass ? 0.07 : c.g; col[i * 3 + 2] = glass ? 0.08 : c.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(geo);
    });
    return parts.length ? mergeGeometries(parts) : null;
  }).catch(e => { console.warn('kit', name, e); return null; }));
  return cache.get(name);
}
