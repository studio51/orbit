/* Orbit: post-processing (WebGPU renderer)
 *
 * One render pipeline: scene pass → bloom → look finishing. The finishing
 * stage is look-weighted rather than branched, so cross-fading between looks
 * is just the numeric params easing:
 *
 *   chroma     radial RGB split          scanlines  hologram CRT lines
 *   vignette   edge darkening            grain      animated film grain
 *   tonemap    ACES filmic blend         exposure   overall gain
 */
import * as THREE from 'three/webgpu';
import {
  pass,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  sin,
  hash,
  floor,
  screenUV,
  screenSize,
  screenCoordinate,
  acesFilmicToneMapping,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LOOK_INDEX } from './looks.js';

/**
 * Build the render pipeline for an engine.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine (renderer, stage, camera, look, U, scene)
 * @returns {{ render: Function, bloom: object }} the pipeline wrapper
 */
export function createPost({ engine }) {
  const { renderer, stage, camera, look, U } = engine;
  const P = look.p;
  const holo = look.weights[LOOK_INDEX.hologram];

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(stage, camera);
  const color = scenePass.getTextureNode('output');
  const bloomPass = bloom(color, 0.5, 0.6, 0.8);

  // radial chromatic split (chroma = 0 collapses to a plain sample)
  const offset = screenUV.sub(0.5).mul(P.chroma);
  const split = vec3(
    color.sample(screenUV.add(offset)).r,
    color.sample(screenUV).g,
    color.sample(screenUV.sub(offset)).b
  );

  let c = split.add(bloomPass.rgb);

  // hologram scanlines + a slow rolling band
  const line = sin(screenUV.y.mul(screenSize.y).mul(1.35)).mul(0.5).add(0.5);
  const roll = smoothstep(0.0, 0.08, screenUV.y.sub(U.time.mul(0.11).fract()).abs())
    .oneMinus()
    .mul(0.5);

  c = c.mul(float(1).sub(holo.mul(line.mul(0.22).add(roll.mul(0.25)))));

  // vignette
  const r = screenUV
    .sub(0.5)
    .mul(vec2(screenSize.x.div(screenSize.y), 1))
    .length();

  c = c.mul(float(1).sub(P.vignette.mul(smoothstep(0.32, 1.05, r.mul(1.15)))));

  // film grain
  const seed = floor(screenCoordinate.x)
    .add(floor(screenCoordinate.y).mul(4096))
    .add(floor(U.time.mul(24)).mul(16777.0));

  c = c.add(hash(seed).sub(0.5).mul(P.grain));

  // tone map (blended per look) → output
  const mapped = mix(c.mul(P.exposure), acesFilmicToneMapping(c, P.exposure), P.tonemap);

  pipeline.outputNode = vec4(mapped.max(0), 1);

  return {
    bloom: bloomPass,
    render() {
      bloomPass.strength.value = P.bloomStrength.value * engine.scene.bloom;
      bloomPass.radius.value = P.bloomRadius.value;
      bloomPass.threshold.value = P.bloomThreshold.value;

      pipeline.render();
    },
  };
}
