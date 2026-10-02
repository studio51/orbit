/* Orbit: GPU compute particles (WebGPU renderer)
 *
 * Two particle systems that live entirely on the GPU, driven by compute
 * kernels over storage buffers (this is the part that needs real WebGPU):
 *
 *   sparks   an impact burst system. When a beam lands the engine calls
 *            `burst()`, which launches one tiny compute dispatch that seeds a
 *            block of a ring buffer. A second kernel integrates all sparks
 *            every frame (drag + pull back toward the planet + surface bounce).
 *   motes    ~40k ambient dust motes orbiting the globe on differential-rotation
 *            shells with a little curl wobble, advected by one kernel per frame.
 *
 * The CPU never touches a particle after seeding; it just sets a few uniforms.
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
  hash,
  mix,
  smoothstep,
  step,
  sin,
  cos,
  exp,
  sqrt,
  max,
  length,
  cross,
  normalize,
  abs,
  uv,
  instancedArray,
  instanceIndex,
} from 'three/tsl';
import { LOOK_INDEX } from './looks.js';

const SPARKS = 16384; // spark ring buffer size
const MOTES = 40000; // ambient mote count
const R = LOOK_INDEX;

/**
 * Premultiplied-alpha blend: additive glow when alpha is 0, solid stroke otherwise.
 *
 * @param {THREE.Material} mat material to configure
 */
function premult(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/**
 * Create the spark and mote systems.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine (renderer, uniforms, look)
 * @returns {{ name: string, group: THREE.Group, burst: Function, update: Function }} the module
 */
export function createSparks({ engine }) {
  const { renderer, U, look } = engine;
  const W = look.weights;

  // ================= Sparks =================
  const sPos = instancedArray(SPARKS, 'vec3');
  const sVel = instancedArray(SPARKS, 'vec3');
  const sLife = instancedArray(SPARKS, 'vec2'); // x = age, y = lifetime (age ≥ lifetime → dead)
  const sCol = instancedArray(SPARKS, 'vec3');

  const uBase = uniform(0),
    uCount = uniform(0),
    uOrigin = uniform(new THREE.Vector3()),
    uColor = uniform(new THREE.Color()),
    uSeed = uniform(0),
    uSpeed = uniform(0.5),
    uDt = uniform(0.016);

  // Seed a block [uBase, uBase + uCount) as a cone of sparks around the surface normal.
  const emit = Fn(() => {
    const i = float(instanceIndex);

    If(i.greaterThanEqual(uBase).and(i.lessThan(uBase.add(uCount))), () => {
      const n = normalize(uOrigin);
      const seed = i.add(uSeed.mul(977.0));
      const r1 = hash(seed),
        r2 = hash(seed.add(13.0)),
        r3 = hash(seed.add(29.0)),
        r4 = hash(seed.add(47.0)),
        r5 = hash(seed.add(61.0));
      const up = abs(n.y)
        .greaterThan(0.95)
        .select(vec3(1, 0, 0), vec3(0, 1, 0));
      const t = normalize(cross(n, up)),
        b = cross(n, t);
      const theta = r1.mul(Math.PI * 2),
        cosA = float(1).sub(r2.mul(0.62));
      const sinA = sqrt(max(float(1).sub(cosA.mul(cosA)), 0));
      const dir = n.mul(cosA).add(
        t
          .mul(cos(theta))
          .add(b.mul(sin(theta)))
          .mul(sinA)
      );

      sPos.element(instanceIndex).assign(n.mul(1.006));
      sVel.element(instanceIndex).assign(dir.mul(uSpeed.mul(r3.mul(0.75).add(0.25))));
      sLife.element(instanceIndex).assign(vec2(0, r4.mul(0.9).add(0.7)));

      sCol.element(instanceIndex).assign(mix(vec3(uColor), vec3(1), r5.mul(0.55)));
    });
  })()
    .compute(SPARKS)
    .setName('Emit sparks');

  // Integrate every live spark: drag, a gentle pull back to the planet, and a soft surface bounce.
  const step_ = Fn(() => {
    const p = sPos.element(instanceIndex),
      v = sVel.element(instanceIndex),
      l = sLife.element(instanceIndex);

    If(l.x.lessThan(l.y), () => {
      const r = length(p);
      const pull = p
        .div(max(r, 0.001))
        .mul(-0.55)
        .div(max(r.mul(r), 0.6));

      v.addAssign(pull.mul(uDt));
      v.mulAssign(exp(uDt.mul(-1.6)));
      p.addAssign(v.mul(uDt));

      // bounce off the planet
      If(length(p).lessThan(1.004), () => {
        const nrm = normalize(p);

        p.assign(nrm.mul(1.004));

        v.assign(v.sub(nrm.mul(v.dot(nrm).mul(1.55))).mul(0.6));
      });

      l.x.addAssign(uDt);
    });
  })()
    .compute(SPARKS)
    .setName('Step sparks');

  const sparkMat = new THREE.SpriteNodeMaterial();

  premult(sparkMat);
  sparkMat.positionNode = sPos.toAttribute();

  const lifeAttr = sLife.toAttribute();
  const age01 = lifeAttr.x.div(max(lifeAttr.y, 0.001)).clamp(0, 1); // dead sparks overshoot 1; pow(negative) is NaN
  const alive = step(lifeAttr.x, lifeAttr.y).mul(step(0.0001, lifeAttr.y));

  sparkMat.scaleNode = look.p.sparkSize.mul(float(1).sub(age01).pow(0.7)).mul(alive);

  const sparkOut = Fn(() => {
    const d = uv().sub(0.5).length().mul(2);
    const soft = float(1)
      .sub(smoothstep(0.0, 1.0, d))
      .pow(1.6);
    const hard = float(1).sub(smoothstep(0.78, 0.92, d));
    const col = sCol.toAttribute();
    const fade = float(1).sub(age01).pow(0.6);
    const rgb = vec3(0).toVar(),
      a = float(0).toVar();

    // additive looks: glowing, twinkling embers
    const glow = col.mul(soft).mul(fade).mul(1.5);
    const additive = W[R.realistic].add(W[R.neon]).add(W[R.hologram]);

    rgb.addAssign(glow.mul(additive));
    // cartoon: solid confetti dots; ink: solid vermilion splatter
    rgb.addAssign(mix(col, vec3(1), 0.15).mul(hard).mul(W[R.cartoon]));
    a.addAssign(hard.mul(W[R.cartoon]).mul(step(0.05, fade)));
    rgb.addAssign(look.c.accent.mul(hard).mul(W[R.ink]));
    a.addAssign(hard.mul(W[R.ink]).mul(step(0.05, fade)));

    return vec4(rgb, a);
  });

  sparkMat.outputNode = sparkOut();

  const sparkSprite = new THREE.Sprite(sparkMat);

  sparkSprite.count = SPARKS;
  sparkSprite.frustumCulled = false;
  sparkSprite.renderOrder = 6;

  // ================= Motes =================
  const mPos = instancedArray(MOTES, 'vec3');
  const mSeed = instancedArray(MOTES, 'vec2'); // x = orbit speed, y = phase

  const initMotes = Fn(() => {
    const i = float(instanceIndex);
    const r1 = hash(i),
      r2 = hash(i.add(7.0)),
      r3 = hash(i.add(19.0)),
      r4 = hash(i.add(31.0));
    const radius = float(1.1).add(r1.pow(1.6).mul(0.7));
    const lat = r2.mul(2).sub(1).mul(1.25); // radians, biased toward the equator via the sin below
    const lng = r3.mul(Math.PI * 2);
    const y = sin(lat).mul(0.62);
    const rr = sqrt(max(float(1).sub(y.mul(y)), 0));

    mPos.element(instanceIndex).assign(vec3(sin(lng).mul(rr), y, cos(lng).mul(rr)).mul(radius));

    mSeed
      .element(instanceIndex)
      .assign(vec2(r4.mul(0.5).add(0.5).div(radius.mul(radius)), r4.mul(Math.PI * 2)));
  })()
    .compute(MOTES)
    .setName('Init motes');

  // Differential rotation around +Y (inner shells orbit faster) plus a small vertical wobble.
  const stepMotes = Fn(() => {
    const p = mPos.element(instanceIndex),
      s = mSeed.element(instanceIndex);
    const ang = s.x.mul(uDt).mul(0.35);
    const c = cos(ang),
      sn = sin(ang);
    const wob = sin(U.time.mul(0.4).add(s.y)).mul(0.012).mul(uDt);

    p.assign(vec3(p.x.mul(c).add(p.z.mul(sn)), p.y.add(wob), p.x.mul(sn.negate()).add(p.z.mul(c))));
  })()
    .compute(MOTES)
    .setName('Step motes');

  const moteMat = new THREE.SpriteNodeMaterial();

  premult(moteMat);
  moteMat.positionNode = mPos.toAttribute();
  moteMat.scaleNode = look.p.moteSize;

  const moteOut = Fn(() => {
    const d = uv().sub(0.5).length().mul(2);
    const soft = float(1)
      .sub(smoothstep(0.0, 1.0, d))
      .pow(2.0);
    const tw = sin(U.time.mul(1.3).add(float(instanceIndex).mul(12.9898)))
      .mul(0.3)
      .add(0.7);

    return vec4(vec3(0.7, 0.85, 1.0).mul(soft).mul(tw).mul(look.p.moteGlow), 0);
  });

  moteMat.outputNode = moteOut();

  const moteSprite = new THREE.Sprite(moteMat);

  moteSprite.count = MOTES;
  moteSprite.frustumCulled = false;
  moteSprite.renderOrder = 3;

  const group = new THREE.Group();

  group.add(moteSprite, sparkSprite);

  // ================= CPU side =================
  let cursor = 0,
    seed = 1,
    ready = false;
  const tmpColor = new THREE.Color();

  return {
    name: 'sparks',
    group,

    /**
     * Launch an impact burst from a surface point.
     *
     * @param {THREE.Vector3} origin unit surface normal where the burst starts
     * @param {string} hex burst colour
     * @param {number} count number of sparks
     * @param {number} speed launch speed scale
     */
    burst(origin, hex, count = 90, speed = 0.55) {
      if (!ready) return;
      if (cursor + count > SPARKS) cursor = 0;

      uBase.value = cursor;
      uCount.value = count;
      uOrigin.value.copy(origin);
      uColor.value.copy(tmpColor.set(hex));
      uSpeed.value = speed;
      uSeed.value = seed++;
      renderer.compute(emit);

      cursor += count;
    },

    /**
     * Seed the motes once the renderer is ready.
     */
    init() {
      renderer.compute(initMotes);

      ready = true;
    },

    /**
     * Advance both systems one frame.
     *
     * @param {object} e the engine
     */
    update(e) {
      if (!ready) return;

      uDt.value = Math.min(0.033, e.dt);
      renderer.compute(step_);
      renderer.compute(stepMotes);

      moteSprite.visible = e.scene.motes !== false;
    },
  };
}
