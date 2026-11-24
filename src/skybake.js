// Baked sky: the raymarched cloud sky (sky.js) is rendered into a cube render target a few times a
// second and drawn as the scene background, instead of raymarching every screen pixel every frame.
// At 384-512 px per face this costs a small fraction of the per-pixel sky (6 faces every 0.25 s),
// which also lets the clouds use more raymarch steps. Clouds drift slowly enough that 4 updates
// per second read as continuous. ?skybake=0 restores the per-pixel sky.
import * as THREE from 'three/webgpu';

export function createSkyBake(G) {
  if (G.Q.get('skybake') === '0') return null;
  const size = G.quality === 'high' ? 512 : G.quality === 'medium' ? 384 : 256;
  const rt = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter;
  const cam = new THREE.CubeCamera(1, 8000, rt);
  const skyScene = new THREE.Scene();
  G.scene.remove(G.sky); skyScene.add(G.sky);
  G.scene.background = rt.texture;
  let t = 0;
  return {
    rt,
    update(dt, force = false) {
      t -= dt;
      if (t > 0 && !force) return;
      t = 0.25;
      cam.position.copy(G.camera.position);
      G.sky.position.copy(G.camera.position);
      cam.update(G.renderer, skyScene);
    },
  };
}
