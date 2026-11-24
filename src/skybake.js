// Baked sky: the raymarched sky (atmosphere + volumetric clouds, sky.js) is rendered into a cube render
// target, one face per frame in rotation, and drawn as the scene background through a per-pixel node that
// adds the sun disc, the moon and the stars (sky.js celestial), so those stay sharp at screen resolution
// while the expensive clouds are amortised: a full refresh every six frames, with an even cost per frame
// instead of a burst of six faces. The cube's alpha is the clouds' transmittance, which hides the sun,
// moon and stars behind cloud. ?skybake=0 restores the per-pixel sky (with its own celestial layer).
import * as THREE from 'three/webgpu';
import { createSky, backgroundNode } from './sky.js';

export function createSkyBake(G) {
  if (G.Q.get('skybake') === '0') {
    // per-pixel sky: swap in a dome that also draws the sun, moon and stars
    G.scene.remove(G.sky);
    G.sky = createSky(G.budget?.cloudSteps ?? 12, { celestial: true });
    G.sky.scale.setScalar(0.45);
    G.scene.add(G.sky);
    return null;
  }
  const size = G.quality === 'high' ? 512 : G.quality === 'medium' ? 384 : 256;
  const rt = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter;
  const cam = new THREE.CubeCamera(1, 8000, rt);
  const skyScene = new THREE.Scene();
  G.scene.remove(G.sky); skyScene.add(G.sky);
  G.scene.background = null;
  G.scene.backgroundNode = backgroundNode(rt.texture);
  const { renderer } = G;
  let face = 0, primed = false;
  // low quality refreshes a face every other frame
  const every = G.quality === 'low' ? 2 : 1;
  let tick = 0;
  const renderFace = (i) => {
    const prev = renderer.getRenderTarget(), pf = renderer.getActiveCubeFace(), pm = renderer.getActiveMipmapLevel();
    renderer.setRenderTarget(rt, i);
    renderer.render(skyScene, cam.children[i]);
    renderer.setRenderTarget(prev, pf, pm);
  };
  return {
    rt,
    update(dt, force = false) {
      if (!force && primed && (++tick % every)) return;
      cam.position.copy(G.camera.position);
      G.sky.position.copy(G.camera.position);
      if (cam.coordinateSystem !== renderer.coordinateSystem) { cam.coordinateSystem = renderer.coordinateSystem; cam.updateCoordinateSystem(); }
      cam.updateMatrixWorld(true);
      if (force || !primed) { for (let i = 0; i < 6; i++) renderFace(i); primed = true; return; }
      renderFace(face); face = (face + 1) % 6;
    },
  };
}
