// Camera post-processing and image-based lighting.
//   post: one scene pass (colour + view normals) -> GTAO at reduced resolution -> HDR bloom
//         -> tone map -> FXAA.  Off on 'low' quality or with ?post=0.
//   ibl:  the live sky (clouds included) rendered into a small cube every few seconds and
//         prefiltered (PMREM) as scene.environment, so every PBR surface picks up sky light
//         and glossy reflections that follow the weather.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, vec3, vec4, float, uniform, mix, renderOutput, screenUV, normalWorld, positionWorld, Fn, smoothstep, max } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { createSky } from './sky.js';
import { U } from './env.js';

export function createPost(G) {
  if (G.quality === 'low' || G.Q.get('post') === '0') return null;
  const { renderer, scene, camera } = G;
  const high = G.quality === 'high';
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const colour = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normal = scenePass.getTextureNode('normal');
  const aoPass = ao(depth, normal, camera);
  aoPass.resolutionScale = high ? 0.5 : 0.4;
  aoPass.samples.value = high ? 12 : 6;
  aoPass.radius.value = 1.1;          // metres: contact shadows at kerbs, eaves, window reveals, under cars
  aoPass.distanceExponent.value = 1.4;
  aoPass.thickness.value = 1.2;
  aoPass.scale.value = 1.15;
  const aoTerm = aoPass.getTextureNode().sample(screenUV).r;
  const strength = uniform(0.9);
  let c = colour.rgb.mul(mix(float(1), aoTerm, strength));
  // HDR bloom: lamps, headlights, lit shopfronts, sun glints on wet roads
  const bl = bloom(vec4(c, 1), high ? 0.3 : 0.22, 0.45, 1.6);
  c = c.add(bl.rgb);
  const pipe = new THREE.RenderPipeline(renderer);
  pipe.outputColorTransform = false;
  // subtle lens vignette after tone mapping
  const vig = float(1).sub(smoothstep(0.55, 1.05, screenUV.sub(0.5).mul(vec3(1.25, 1, 0).xy).length().mul(1.45)).mul(0.16));
  // gentle 'punchy' grade on top of AgX: +10% saturation, slight S-curve contrast
  const disp = renderOutput(vec4(c, 1)).rgb;
  const lum = disp.dot(vec3(0.2126, 0.7152, 0.0722));
  let g = mix(vec3(lum), disp, 1.1);
  g = g.add(g.sub(0.5).mul(0.08)).clamp(0, 1);
  pipe.outputNode = fxaa(vec4(g.mul(vig), 1));
  return {
    pipe, aoPass, strength,
    render() { pipe.render(); },
  };
}

export function createIBL(G) {
  if (G.quality === 'low' || G.Q.get('ibl') === '0') return null;
  const { renderer, scene } = G;
  const envScene = new THREE.Scene();
  const sky = createSky(4);
  sky.scale.setScalar(0.45);
  envScene.add(sky);
  // ground hemisphere: dull urban ground bounce, brightness follows the daylight
  const groundLum = uniform(0.1);
  const gm = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  gm.colorNode = Fn(() => {
    const d = positionWorld.sub(sky.position).normalize();
    return vec3(0.36, 0.36, 0.33).mul(groundLum).mul(smoothstep(0.02, -0.15, d.y));
  })();
  gm.transparent = true;
  gm.opacityNode = Fn(() => smoothstep(0.0, -0.08, positionWorld.sub(sky.position).normalize().y))();
  const ground = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gm);
  ground.renderOrder = 1;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const size = G.quality === 'high' ? 128 : 64;
  let rt = null, t = 0;
  const pos = new THREE.Vector3();
  scene.environmentIntensity = 1;
  const api = {
    groundLum,
    update(dt, force = false) {
      t -= dt;
      if (t > 0 && !force) return;
      t = 3.5;
      pos.copy(G.camera.position);
      sky.position.copy(pos); ground.position.copy(pos);
      const prevTM = renderer.toneMapping;
      rt = pmrem.fromScene(envScene, 0, 1, 2500, { size, position: pos, renderTarget: rt });
      renderer.toneMapping = prevTM;
      if (scene.environment !== rt.texture) scene.environment = rt.texture;
      U.ibl.value = 1;
    },
  };
  return api;
}
