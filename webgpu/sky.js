/* Orbit: the sky (WebGPU renderer)
 *
 * Two pieces, both cheap enough to leave the frame budget to the planet:
 *
 *   • the dome   a camera-centred sphere drawn after the opaque planet with the
 *                depth test on, so no backdrop pixel is shaded behind the globe
 *                or the moon. Each look contributes its own backdrop branch.
 *   • the stars  about 24k instanced point sprites, sized in CSS pixels so they
 *                stay crisp at any resolution. Shading a star costs a few pixels,
 *                where the old per-pixel star lattice ran for the whole screen.
 *
 * Backdrops per look:
 *
 *   realistic  Milky Way, nebula haze, a photographic sun
 *   cartoon    pastel haze on a violet gradient, big four-point sparkle stars
 *   neon       synthwave horizon glow and a banded retro sun
 *   hologram   fine cyan dust and faint latitude lines
 *   ink        warm paper with fibre and stain (screen-space, so it never swims)
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  attribute,
  mix,
  smoothstep,
  exp,
  pow,
  sin,
  abs,
  dot,
  max,
  step,
  texture,
  normalize,
  positionGeometry,
  cameraViewMatrix,
  cameraProjectionMatrix,
  screenUV,
  screenSize,
} from 'three/tsl';
import { dirToUv, sq } from './tsl-util.js';
import { LOOK_INDEX } from './looks.js';

const R = LOOK_INDEX;
const STARS = 24000; // point sprites over the whole sky
const GALACTIC = 0.34; // share of the stars gathered toward the galactic plane
const DOME_RADIUS = 150; // inside the camera's far plane, beyond everything else
const STAR_DISTANCE = 120; // stars sit on a shell just inside the dome
const GAL_N = new THREE.Vector3(0.3, 0.86, 0.41).normalize(); // matches the baked Milky Way

/**
 * Small deterministic PRNG so the sky looks the same on every load.
 *
 * @param {number} seed integer seed
 * @returns {function(): number} generator returning floats in [0, 1)
 */
function mulberry32(seed) {
  let a = seed;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;

    let t = Math.imul(a ^ (a >>> 15), 1 | a);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter the stars: most uniformly over the sphere, the rest gathered around the
 * galactic plane so the sprites thicken where the baked Milky Way glows.
 *
 * @returns {{ star: Float32Array, aux: Float32Array }} per-star `[dir.xyz, magnitude]` and
 *   `[phase, twinkle speed, warmth, rank]`
 */
function scatterStars() {
  const rnd = mulberry32(2051);
  const star = new Float32Array(STARS * 4);
  const aux = new Float32Array(STARS * 4);
  const v = new THREE.Vector3();
  const tangent = new THREE.Vector3(1, 0, 0).cross(GAL_N).normalize();
  const bitangent = new THREE.Vector3().crossVectors(GAL_N, tangent);

  for (let i = 0; i < STARS; i++) {
    const galactic = i < STARS * GALACTIC;

    if (galactic) {
      const a = rnd() * Math.PI * 2;
      const off = (rnd() + rnd() + rnd() - 1.5) * 0.3; // roughly Gaussian, about 10° wide

      v.copy(tangent)
        .multiplyScalar(Math.cos(a))
        .addScaledVector(bitangent, Math.sin(a))
        .addScaledVector(GAL_N, off)
        .normalize();
    } else {
      const y = rnd() * 2 - 1,
        a = rnd() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);

      v.set(Math.cos(a) * r, y, Math.sin(a) * r);
    }

    // a steep power law: a sky of faint dust with a few bright anchors
    const mag = Math.pow(rnd(), galactic ? 9 : 5.5);

    star.set([v.x, v.y, v.z, mag], i * 4);

    aux.set([rnd() * Math.PI * 2, 0.6 + rnd() * 2.6, rnd(), rnd()], i * 4);
  }

  return { star, aux };
}

/**
 * Build the sky dome and the star sprites.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine (uniforms, look, baked textures)
 * @returns {{ name: string, group: THREE.Group, update: Function, resize: Function }} the module
 */
export function createSky({ engine }) {
  const { U, look, baked } = engine;
  const W = look.weights;
  const group = new THREE.Group();

  // ================= Dome =================
  // Shared inputs are declared at the top level of the shader (see `shared` below): TSL emits
  // a variable where it is first used, and a variable first used inside one look's `If` would
  // stay unset for every other look.
  const dir = normalize(positionGeometry).toVar('skyDir');
  const sunDot = max(dot(dir, U.sun), 0).toVar('skySunDot');
  const base = mix(look.c.bgA, look.c.bgB, dir.y.mul(0.5).add(0.5)).toVar('skyBase');
  const skyUv = dirToUv(dir).toVar('skyUv');
  const nebulaBake = texture(baked.nebulaTex, skyUv).level(0).rgb.toVar('skyNebula');

  const realistic = () => {
    const milky = texture(baked.milkyTex, skyUv).level(0).rgb;

    // A photographic sun: a small hot disc, a tight halo and a faint veil.
    // The old wide lobes washed half the frame in grey once bloom spread them.
    const disc = smoothstep(0.99992, 0.99997, sunDot).mul(42);
    const halo = pow(sunDot, 2600).mul(3.2).add(pow(sunDot, 380).mul(0.42));
    const veil = pow(sunDot, 42).mul(0.05);
    const glare = vec3(1.0, 0.92, 0.78)
      .mul(disc.add(halo))
      .add(vec3(1.0, 0.82, 0.6).mul(veil))
      .mul(U.sunGlare);

    return base.add(milky).add(nebulaBake.mul(U.nebula)).add(glare);
  };

  const cartoon = () => base.add(nebulaBake.mul(vec3(1.6, 1.2, 2.4)).mul(U.nebula));

  const neon = () => {
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
      .add(disc.mul(1.6))
      .add(vec3(1.0, 0.2, 0.6).mul(pow(sunDot, 200)).mul(0.2));
  };

  const hologram = () => {
    const grid = smoothstep(0.96, 1.0, dir.y.mul(24.0).fract().sub(0.5).abs().mul(2.0)).mul(0.035);

    return base.add(vec3(0.1, 0.7, 0.9).mul(grid));
  };

  const ink = () => {
    const st = screenUV.mul(vec2(screenSize.x.div(screenSize.y), 1));
    const fibre = texture(baked.paperTex, st).level(0).r;
    const stain = texture(baked.paperTex, st.mul(0.25)).level(0).g;

    return base.add(vec3(fibre)).sub(vec3(0.09, 0.1, 0.12).mul(stain).mul(0.5));
  };

  const branches = [realistic, cartoon, neon, hologram, ink];
  const domeColor = Fn(() => {
    const out = vec3(0).toVar();
    const shared = dir.x.add(sunDot).add(base.x).add(skyUv.x).add(nebulaBake.x);

    out.addAssign(vec3(shared.mul(0.0)));

    branches.forEach((fn, i) => {
      If(W[i].greaterThan(0.002), () => {
        out.addAssign(fn().mul(W[i]));
      });
    });

    return vec4(out.mul(mix(float(1), U.intro.stars, float(1).sub(W[R.ink]))), 1);
  });

  const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });

  domeMat.colorNode = domeColor();

  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 32, 16), domeMat);

  dome.frustumCulled = false;
  dome.renderOrder = 100; // last of the opaque objects, so the planet and moon reject it early
  group.add(dome);

  // ================= Stars =================
  const { star, aux } = scatterStars();
  const quad = new THREE.PlaneGeometry(2, 2);
  const starGeo = new THREE.InstancedBufferGeometry();

  starGeo.index = quad.index;
  starGeo.setAttribute('position', quad.attributes.position);
  starGeo.setAttribute('iStar', new THREE.InstancedBufferAttribute(star, 4));
  starGeo.setAttribute('iAux', new THREE.InstancedBufferAttribute(aux, 4));
  starGeo.instanceCount = STARS;

  const iStar = attribute('iStar', 'vec4'), // direction (xyz), magnitude (w)
    iAux = attribute('iAux', 'vec4'); // phase, twinkle speed, warmth, rank
  const uPx = uniform(new THREE.Vector2(0.002, 0.002)); // one CSS pixel in clip space
  const corner = positionGeometry.xy; // -1..1 across the sprite
  const P = look.p;
  const mag = iStar.w;

  // Looks pick how much of the catalogue they show (`starCut`) and whether magnitude matters
  // (`starFlat`): the cartoon sky is a few big, equal sparkles; the realistic one is all of it.
  const shown = step(iAux.w, P.starCut).mul(step(0.0005, P.starBright));
  const level = mix(mag, float(0.55), P.starFlat);
  const radius = float(1.5).add(level.mul(2.6)).mul(P.starSize).mul(shown); // CSS pixels
  const viewDir = cameraViewMatrix.mul(vec4(iStar.xyz, 0)).xyz;
  const clip = cameraProjectionMatrix.mul(vec4(viewDir.mul(STAR_DISTANCE), 1));
  const starMat = new THREE.MeshBasicNodeMaterial();

  starMat.transparent = true;
  starMat.depthWrite = false;
  starMat.blending = THREE.AdditiveBlending;
  starMat.vertexNode = vec4(clip.xy.add(corner.mul(radius).mul(uPx).mul(clip.w)), clip.z, clip.w);

  const starColor = Fn(() => {
    const d2 = dot(corner, corner);
    const soft = exp(d2.mul(-5.0)); // the sprite's edge sits at about 1% of the peak
    const arm = float(1).sub(pow(abs(corner.x), 0.55).add(pow(abs(corner.y), 0.55)));
    const sparkle = smoothstep(0.0, 0.16, arm);
    const shape = mix(soft, sparkle, W[R.cartoon]);
    const twinkle = sin(U.time.mul(U.twinkle).mul(iAux.y).add(iAux.x)).mul(0.28).add(0.72);
    const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.8, 0.58), sq(iAux.z));
    const colour = mix(look.c.star, look.c.star.mul(tint).mul(1.18), P.starTint);
    const energy = float(0.2).add(sq(level).mul(4.2)).add(level.mul(0.7));

    return vec4(colour.mul(shape).mul(energy).mul(twinkle).mul(P.starBright).mul(U.intro.stars), 1);
  });

  starMat.colorNode = starColor();

  const stars = new THREE.Mesh(starGeo, starMat);

  stars.frustumCulled = false;
  stars.renderOrder = -10; // first of the transparent objects, so solid strokes cover them
  group.add(stars);

  return {
    name: 'sky',
    group,

    /**
     * Keep the dome centred on the camera so it reads as infinitely far away.
     *
     * @param {object} e the engine
     */
    update(e) {
      dome.position.copy(e.camera.position);
    },

    /**
     * Refit the star sprites to the viewport, so their size holds in CSS pixels.
     *
     * @param {object} e the engine
     */
    resize(e) {
      uPx.value.set(2 / e.W, 2 / e.H);
    },
  };
}
