// Camera post-processing and image-based lighting.
//   post: one scene pass (colour + view normals) -> GTAO at reduced resolution -> HDR bloom
//         -> tone map -> FXAA.  Off on 'low' quality or with ?post=0.
//   ibl:  the live sky (clouds included) rendered into a small cube every few seconds and
//         prefiltered (PMREM) as scene.environment, so every PBR surface picks up sky light
//         and glossy reflections that follow the weather.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, vec2, vec3, vec4, float, uniform, mix, renderOutput, screenUV, normalWorld, positionWorld, Fn, smoothstep, max, metalness, roughness, rtt } from 'three/tsl';
import { ssr } from 'three/examples/jsm/tsl/display/SSRNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { fsr1 } from 'three/examples/jsm/tsl/display/FSR1Node.js';
import { createSky } from './sky.js';
import { U } from './env.js';

export function createPost(G) {
  const B = G.budget || { post: G.quality !== 'low', ao: { scale: G.quality === 'high' ? 0.5 : 0.4, samples: G.quality === 'high' ? 12 : 6 }, bloom: G.quality === 'high' ? 0.3 : 0.22 };
  if (!B.post || G.Q.get('post') === '0') return null;
  const { renderer, scene, camera } = G;
  const scenePass = pass(scene, camera);
  // internal render scale (FSR path): the scene and its effects render at s x the output size and are
  // upscaled to the device resolution, instead of shrinking the whole canvas (which looked pixelated)
  const useFSR = !!B.fsr && G.Q.get('fsr') !== '0';
  let s = useFSR ? (Number(G.Q.get('scale')) || B.scale[1]) : 1;
  scenePass.setResolutionScale(s);
  const useSSR = !!B.ssr && G.Q.get('ssr') !== '0';
  scenePass.setMRT(useSSR ? mrt({ output, normal: normalView, metalrough: vec2(metalness, roughness) }) : mrt({ output, normal: normalView }));
  const colour = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normal = scenePass.getTextureNode('normal');
  const useAO = B.ao.scale > 0 && G.Q.get('ao') !== '0';
  const aoPass = useAO ? ao(depth, normal, camera) : null;
  if (aoPass) {
  aoPass.resolutionScale = B.ao.scale * s;
  aoPass.samples.value = B.ao.samples;
  aoPass.radius.value = 1.1;          // metres: contact shadows at kerbs, eaves, window reveals, under cars
  aoPass.distanceExponent.value = 1.4;
  aoPass.thickness.value = 1.2;
  aoPass.scale.value = 1.15;
  }
  const strength = uniform(0.9);
  let c = aoPass ? colour.rgb.mul(mix(float(1), aoPass.getTextureNode().sample(screenUV).r, strength)) : colour.rgb;
  // screen-space reflections ('fake ray tracing'): wet roads and puddles, glass, car paint and chrome
  // reflect what is actually on screen; the sky PMREM still covers rays that leave the screen
  let ssrPass = null;
  if (useSSR) {
    const mr = scenePass.getTextureNode('metalrough');
    ssrPass = ssr(colour, depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, reflectNonMetals: true, camera });
    ssrPass.resolutionScale = (B.ssr.scale ?? 0.5) * s;
    ssrPass.quality.value = B.ssr.quality ?? 0.45;
    ssrPass.maxDistance.value = 60;
    ssrPass.thickness.value = 0.35;
    ssrPass.intensity.value = 0.9;
    ssrPass.screenEdgeFade.value = 0.25;
    if (G.Q.get('ssrdbg')) { const pipe = new THREE.RenderPipeline(renderer); pipe.outputNode = G.Q.get('ssrdbg') === 'mr' ? vec4(mr.rg, 0, 1) : vec4(ssrPass.rgb.add(vec3(0, 0, ssrPass.a.mul(0.3))), 1); return { pipe, render() { pipe.render(); } }; }
    // energy weighting the node leaves to us: only smooth surfaces reflect (puddles and glass most,
    // wet tarmac and paint less, rough walls not at all), metals more strongly than dielectrics
    const rough = mr.g, metal = mr.r;
    // rays that miss come back black (the node's env fallback needs an equirect map, not our live PMREM):
    // drop them so the material's own sky/IBL reflection shows instead
    const hitLum = max(max(ssrPass.r, ssrPass.g), ssrPass.b);
    const w = smoothstep(0.5, 0.04, rough).mul(mix(float(0.55), float(0.85), metal)).mul(ssrPass.a).mul(smoothstep(0.004, 0.04, hitLum)).clamp(0, 1);
    c = mix(c, ssrPass.rgb, w);
  }
  // HDR bloom: lamps, headlights, lit shopfronts, sun glints on wet roads
  if (B.bloom > 0) c = c.add(bloom(vec4(c, 1), B.bloom, 0.45, 1.6).rgb);
  const pipe = new THREE.RenderPipeline(renderer);
  pipe.outputColorTransform = false;
  // subtle lens vignette after tone mapping
  const vig = float(1).sub(smoothstep(0.55, 1.05, screenUV.sub(0.5).mul(vec3(1.25, 1, 0).xy).length().mul(1.45)).mul(0.16));
  // gentle 'punchy' grade on top of AgX: +10% saturation, slight S-curve contrast
  const disp = renderOutput(vec4(c, 1)).rgb;
  const lum = disp.dot(vec3(0.2126, 0.7152, 0.0722));
  // grade on top of AgX: richer saturation, S-curve contrast, cool shadows / warm highlights
  let g = mix(vec3(lum), disp, 1.2);
  g = g.add(g.sub(0.5).mul(0.11));
  g = g.mul(mix(vec3(0.97, 1.0, 1.05), vec3(1.035, 1.0, 0.955), smoothstep(0.2, 0.8, lum))).clamp(0, 1);
  const graded = vec4(g.mul(vig), 1);
  let lowA = null, lowB = null;
  if (useFSR) {
    // grade + FXAA at the internal resolution, then FSR 1 (edge-adaptive upsampling + contrast-adaptive
    // sharpening) to the full drawing-buffer size
    lowA = rtt(graded, null, null, { resolutionScale: s });
    lowB = rtt(fxaa(lowA), null, null, { resolutionScale: s });
    pipe.outputNode = fsr1(lowB, 0.3);
  } else pipe.outputNode = fxaa(graded);
  return {
    pipe, aoPass, ssrPass, strength, fsr: useFSR,
    get scale() { return s; },
    setScale(v) {
      if (!useFSR || Math.abs(v - s) < 0.005) return;
      s = v; scenePass.setResolutionScale(v); lowA.setResolutionScale(v); lowB.setResolutionScale(v);
      if (aoPass) aoPass.resolutionScale = B.ao.scale * v;
      if (ssrPass) ssrPass.resolutionScale = (B.ssr.scale ?? 0.5) * v;
    },
    render() { pipe.render(); },
  };
}

export function createIBL(G) {
  const cube = G.budget ? G.budget.ibl : (G.quality === 'high' ? 128 : G.quality === 'medium' ? 64 : 0);
  if (!cube || G.Q.get('ibl') === '0') return null;
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
  const size = cube;
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
      if (scene.environment !== rt.texture) {
        // objects drawn before the first environment existed compiled without it: rebuild their materials once,
        // or tiles loaded in the first seconds lack sky reflections their later neighbours have (a seam on water)
        const first = !scene.environment;
        scene.environment = rt.texture;
        if (first) { const seen = new Set(); scene.traverse(o => { for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.needsUpdate = true; } }); }
      }
      U.ibl.value = 1;
    },
  };
  return api;
}
