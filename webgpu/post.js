/* Orbit: post-processing (WebGPU renderer)
 *
 * One render pipeline: scene pass → bloom → look finishing. The finishing
 * stage is look-weighted rather than branched, so cross-fading between looks
 * is just the numeric params easing:
 *
 *   chroma     radial RGB split          scanlines  hologram CRT lines
 *   vignette   edge darkening            grain      animated film grain
 *   tonemap    ACES filmic blend         exposure   overall gain
 *
 * Two things keep this chain inside a 120 Hz frame at retina resolution:
 *
 *   • the scene pass keeps its 4x multisampling but discards the multisampled
 *     buffers once they are resolved, so they never leave tile memory. Storing
 *     them (the default) cost more than everything drawn into them.
 *   • bloom works at a resolution fixed in CSS pixels. The glow is low frequency,
 *     so a retina display gains nothing from blurring four times the texels.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  pass,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
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

const BLOOM_CSS_SCALE = 0.5; // bloom resolution as a fraction of the CSS-pixel size
const BLOOM_MIN_SCALE = 0.2; // floor, as a fraction of the drawing buffer
const CHROMA_MIN = 0.00002; // below this the colour split is skipped entirely

/**
 * Build the render pipeline for an engine.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine (renderer, stage, camera, look, U, scene)
 * @returns {{ render: Function, resize: Function, bloom: object }} the pipeline wrapper
 */
export function createPost({ engine }) {
  const { renderer, stage, camera, look, U } = engine;
  const P = look.p;
  const holo = look.weights[LOOK_INDEX.hologram];
  const cssHeight = uniform(900); // canvas height in CSS pixels, for resolution-independent lines

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(stage, camera);

  // Nothing reads the multisampled colour or depth after the resolve, so discard both.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  scenePass.renderTarget.storeMultisampledDepthBuffer = false;

  const color = scenePass.getTextureNode('output');
  const bloomPass = bloom(color, 0.5, 0.6, 0.8);

  // radial chromatic split: three taps when the look asks for it, one when it does not
  const scene = Fn(() => {
    const c = color.sample(screenUV).rgb.toVar();

    If(P.chroma.greaterThan(CHROMA_MIN), () => {
      const offset = screenUV.sub(0.5).mul(P.chroma);

      c.assign(
        vec3(color.sample(screenUV.add(offset)).r, c.g, color.sample(screenUV.sub(offset)).b)
      );
    });

    return c;
  });

  let c = scene().add(bloomPass.rgb);

  // hologram scanlines + a slow rolling band
  const line = sin(screenUV.y.mul(cssHeight).mul(1.35)).mul(0.5).add(0.5);
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

    /**
     * Refit the resolution-dependent stages to the drawing buffer.
     *
     * @param {object} e the engine (reads `H` and the renderer's pixel ratio)
     */
    resize(e) {
      const ratio = Math.max(0.01, e.renderer.getPixelRatio());

      cssHeight.value = e.H;

      bloomPass.setResolutionScale(
        Math.min(BLOOM_CSS_SCALE, Math.max(BLOOM_MIN_SCALE, BLOOM_CSS_SCALE / ratio))
      );
    },

    /** Render one frame through the pipeline. */
    render() {
      bloomPass.strength.value = P.bloomStrength.value * engine.scene.bloom;
      bloomPass.radius.value = P.bloomRadius.value;
      bloomPass.threshold.value = P.bloomThreshold.value;

      pipeline.render();
    },
  };
}
