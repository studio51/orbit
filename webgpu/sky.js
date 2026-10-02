/* Orbit: the sky (WebGPU renderer)
 *
 * A procedural `scene.backgroundNode`. Each look contributes its own backdrop
 * branch (see looks.js), evaluated only while its weight is non-zero:
 *
 *   realistic  layered twinkling stars, Milky Way, nebula haze, sun glare
 *   cartoon    big pastel sparkle stars on a violet gradient
 *   neon       synthwave horizon glow and a retro sun
 *   hologram   fine cyan dust on near-black teal
 *   ink        warm paper with fibre and speckle (screen-space, so it never swims)
 */
import {
  Fn,
  If,
  float,
  vec2,
  vec3,
  vec4,
  mix,
  smoothstep,
  exp,
  pow,
  dot,
  max,
  texture,
  normalize,
  normalWorldGeometry,
  screenUV,
  screenSize,
} from 'three/tsl';
import { fbm, starField, dirToUv, sq } from './tsl-util.js';
import { LOOK_INDEX } from './looks.js';

const R = LOOK_INDEX;

/**
 * Build the background node.
 *
 * @param {object} args build inputs
 * @param {object} args.U shared uniforms
 * @param {object} args.baked baked textures (`milkyTex`, `nebulaTex`; see bake.js)
 * @param {object} args.look the LookState
 * @returns {{ node: Node }} a vec4 node for `scene.backgroundNode`
 */
export function createSky({ U, look, baked }) {
  const W = look.weights;
  const t = U.time.mul(U.twinkle);

  // Every look branch builds its OWN copy of these inputs. TSL emits a shared node where it is
  // first used, so sharing one `dir`/`base` across `If` blocks leaves the later branches reading
  // a value that was only ever assigned inside a branch that did not run (a black backdrop).
  const inputs = () => {
    const dir = normalize(normalWorldGeometry);
    const skyUv = dirToUv(dir);

    return {
      dir,
      sunDot: max(dot(dir, U.sun), 0),
      base: mix(look.c.bgA, look.c.bgB, dir.y.mul(0.5).add(0.5)),
      milkyBake: texture(baked.milkyTex, skyUv).level(0).rgb,
      nebulaBake: texture(baked.nebulaTex, skyUv).level(0).rgb,
    };
  };

  const realistic = () => {
    const { dir, sunDot, base, milkyBake, nebulaBake } = inputs();
    const near = starField(dir, 70, 0.9, t);
    const far = starField(dir.add(vec3(0.31, 0.17, 0.5)), 190, 0.93, t);
    const stars = near.tint.mul(near.star).mul(1.3).add(far.tint.mul(far.star).mul(0.8));

    const nebula = nebulaBake.mul(U.nebula);

    const glare = vec3(1.0, 0.9, 0.72)
      .mul(pow(sunDot, 1400).mul(60).add(pow(sunDot, 70).mul(0.28)).add(pow(sunDot, 8).mul(0.012)))
      .mul(U.sunGlare);

    return base.add(stars.mul(look.p.starBright)).add(milkyBake).add(nebula).add(glare);
  };

  const cartoon = () => {
    const { dir, base, nebulaBake } = inputs();
    const s = starField(dir, 26, 0.82, t);
    const haze = nebulaBake.mul(vec3(1.6, 1.2, 2.4)).mul(U.nebula);

    return base.add(vec3(1.0, 0.95, 0.8).mul(s.star).mul(1.5)).add(haze);
  };

  const neon = () => {
    const { dir, sunDot, base } = inputs();
    const s = starField(dir, 60, 0.95, t);
    const horizon = exp(sq(dir.y.div(0.28)).negate());
    const glow = mix(
      vec3(0.9, 0.05, 0.5),
      vec3(0.1, 0.8, 0.95),
      smoothstep(-0.2, 0.5, dir.x.add(dir.z.mul(0.5)))
    )
      .mul(horizon)
      .mul(0.09);
    const sun = smoothstep(0.9965, 0.9975, sunDot);
    const bands = smoothstep(0.35, 0.5, dir.y.mul(70.0).sub(U.time.mul(0.4)).fract());
    const disc = mix(vec3(1.0, 0.25, 0.55), vec3(1.0, 0.8, 0.2), smoothstep(-0.05, 0.12, dir.y))
      .mul(sun)
      .mul(bands.mul(0.6).add(0.4));

    return base
      .add(glow)
      .add(vec3(0.9, 0.8, 1.0).mul(s.star).mul(0.5))
      .add(disc.mul(1.6))
      .add(vec3(1.0, 0.2, 0.6).mul(pow(sunDot, 200)).mul(0.2));
  };

  const hologram = () => {
    const { dir, base } = inputs();
    const s = starField(dir, 110, 0.9, t);
    const grid = smoothstep(0.96, 1.0, dir.y.mul(24.0).fract().sub(0.5).abs().mul(2.0)).mul(0.035);

    return base.add(vec3(0.3, 0.9, 1.0).mul(s.star).mul(0.45)).add(vec3(0.1, 0.7, 0.9).mul(grid));
  };

  const ink = () => {
    const { base } = inputs();
    const aspect = screenSize.x.div(screenSize.y);
    const q = vec3(screenUV.mul(vec2(aspect, 1)).mul(5.0), 0.7);
    const fibre = fbm(q.mul(vec3(1.0, 6.0, 1.0)), 3)
      .mul(0.025)
      .add(fbm(q.mul(14.0), 3).mul(0.018));
    const stain = fbm(vec3(screenUV.mul(vec2(aspect, 1)).mul(1.4), 4.0), 4)
      .mul(0.5)
      .add(0.5);

    return base.add(vec3(fibre)).sub(
      vec3(0.09, 0.1, 0.12)
        .mul(smoothstep(0.55, 0.9, stain))
        .mul(0.5)
    );
  };

  const branches = [realistic, cartoon, neon, hologram, ink];
  const sky = Fn(() => {
    const out = vec3(0).toVar();

    branches.forEach((fn, i) => {
      If(W[i].greaterThan(0.002), () => {
        out.addAssign(fn().mul(W[i]));
      });
    });

    return vec4(out.mul(mix(float(1), U.intro.stars, float(1).sub(W[R.ink]))), 1);
  });

  return { node: sky() };
}
