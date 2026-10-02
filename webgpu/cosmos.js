/* Orbit: cosmos extras (WebGPU renderer)
 *
 * The things around the planet that make the scene feel inhabited:
 *
 *   moon           a procedural moon on a slow orbit that crosses in front of
 *                  and behind the globe (it keeps its framing as the camera turns)
 *   orbit rings    three tilted rings, each with a satellite
 *   shooting stars short-lived streaks, rate set by `meteorRate`
 *   aurora         curtains of light around both poles, drifting with the scene
 *
 * Each effect blends its look variants with arithmetic weights, never `If`,
 * so no shared node is ever first-declared inside a branch that does not run.
 */
import * as THREE from 'three/webgpu';
import {
  float,
  vec3,
  vec4,
  uniform,
  attribute,
  mix,
  clamp,
  smoothstep,
  step,
  pow,
  exp,
  abs,
  fract,
  sin,
  cos,
  asin,
  atan,
  dot,
  cross,
  normalize,
  fwidth,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  uv,
} from 'three/tsl';
import { fbm, noise3, sq } from './tsl-util.js';
import { LOOK_INDEX } from './looks.js';
import { ORBIT_DEFS } from '../shared/geometry.js';
import { AURORA_SCHEMES } from '../shared/config.js';

const R = LOOK_INDEX;
const METEORS = 6; // concurrent shooting stars
const METEOR_SEGS = 24;

/**
 * Premultiplied-alpha blend: additive glow when alpha is 0, a solid stroke otherwise.
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
 * Anti-aliased hatch lines along a scalar, inked where `width` (0..1) says so.
 *
 * @param {Node} v coordinate (float) whose integer steps are the lines
 * @param {Node} width 0..1 fraction of each period that is ink
 * @returns {Node} float 0..1 ink coverage
 */
function hatch(v, width) {
  const aa = fwidth(v).mul(1.2).add(0.001);

  return float(1).sub(smoothstep(width.sub(aa), width.add(aa), abs(fract(v).sub(0.5)).mul(2)));
}

/**
 * Create the moon, orbit rings, shooting stars and aurora.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine
 * @returns {{ name: string, group: THREE.Group, update: Function }} the module
 */
export function createCosmos({ engine }) {
  const { U, look } = engine;
  const W = look.weights;
  const sun = U.sun;
  const group = new THREE.Group();

  // ================= Moon =================
  const moonMat = new THREE.MeshBasicNodeMaterial();
  const mp = normalize(positionLocal);
  const mn = normalize(normalWorld);
  const mv = normalize(cameraPosition.sub(positionWorld));
  const ndl = dot(mn, sun);
  const lit = clamp(ndl, 0, 1);
  const maria = smoothstep(0.05, 0.35, fbm(mp.mul(2.3), 4));
  const rim = float(1).sub(clamp(dot(mn, mv), 0, 1));

  const moonReal = vec3(0.34, 0.33, 0.32)
    .mul(maria.mul(0.55).add(0.55))
    .mul(noise3(mp.mul(34.0)).mul(0.14).add(0.9))
    .mul(float(1).sub(smoothstep(0.55, 0.62, abs(noise3(mp.mul(7.0)))).mul(0.22)))
    .mul(lit.mul(2.1).add(0.012));
  const moonToon = mix(
    vec3(0.28, 0.22, 0.6),
    vec3(1.0, 0.95, 0.72),
    step(0.05, ndl).mul(0.5).add(step(0.45, ndl).mul(0.5))
  );
  const moonNeon = vec3(0.06, 0.0, 0.16)
    .mul(lit.add(0.2))
    .add(vec3(1.0, 0.1, 0.62).mul(pow(rim, 3)).mul(1.3))
    .add(
      vec3(0.1, 0.95, 0.95).mul(
        smoothstep(0.0, 0.12, ndl)
          .mul(smoothstep(0.2, 0.0, ndl))
          .mul(0.9)
      )
    );
  const moonHolo = vec3(0.1, 0.8, 1.0)
    .mul(lit.mul(0.8).add(0.12))
    .mul(
      step(0.0, sin(mp.y.mul(70.0)))
        .mul(0.45)
        .add(0.55)
    )
    .add(vec3(0.1, 0.8, 1.0).mul(pow(rim, 2.5)).mul(0.9));
  const inkW = clamp(float(1).sub(lit).mul(1.3).sub(0.15), 0, 0.9);
  const moonInk = mix(
    vec3(0.93, 0.89, 0.78),
    vec3(0.07, 0.055, 0.04),
    clamp(hatch(mp.y.mul(46.0).add(mp.x.mul(11.0)), inkW).add(smoothstep(0.82, 0.88, rim)), 0, 1)
  );

  moonMat.colorNode = moonReal
    .mul(W[R.realistic])
    .add(moonToon.mul(W[R.cartoon]))
    .add(moonNeon.mul(W[R.neon]))
    .add(moonHolo.mul(W[R.hologram]))
    .add(moonInk.mul(W[R.ink]));

  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 64, 48), moonMat);

  moon.renderOrder = 1;
  group.add(moon);

  // ================= Orbit rings + satellites =================
  const ringMat = new THREE.MeshBasicNodeMaterial();

  premult(ringMat);
  // additive glow in the luminous looks; a solid stroke (premultiplied colour) in cartoon and ink
  ringMat.outputNode = vec4(
    look.c.accent
      .mul(0.5)
      .mul(W[R.realistic].add(W[R.neon]).add(W[R.hologram]))
      .add(vec3(1.0, 0.85, 0.3).mul(W[R.cartoon]).mul(0.85))
      .add(vec3(0.1, 0.085, 0.07).mul(W[R.ink]).mul(0.85)),
    W[R.cartoon].add(W[R.ink]).mul(0.85)
  );

  // satellites are small glow sprites: additive in the luminous looks, a solid dot in cartoon and ink
  const satMat = new THREE.SpriteNodeMaterial();
  const satD = uv().sub(0.5).length().mul(2);
  const satSoft = float(1)
    .sub(smoothstep(0.0, 1.0, satD))
    .pow(2.2);
  const satHard = float(1).sub(smoothstep(0.35, 0.5, satD));
  const satSolid = W[R.cartoon].add(W[R.ink]);

  premult(satMat);
  satMat.scaleNode = float(0.075);
  satMat.outputNode = vec4(
    look.c.accent
      .mul(satSoft)
      .mul(2.2)
      .mul(float(1).sub(satSolid))
      .add(look.c.accent.mul(satHard).mul(satSolid)),
    satHard.mul(satSolid)
  );

  const rings = ORBIT_DEFS.map((def) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(def.rf, 0.0016, 6, 180), ringMat);
    const sat = new THREE.Sprite(satMat);

    mesh.renderOrder = 3;
    sat.visible = !!def.sat;
    group.add(mesh, sat);

    return { def, mesh, sat };
  });

  // ================= Shooting stars =================
  const verts = (METEOR_SEGS + 1) * 2;
  const mU = new Float32Array(verts),
    mS = new Float32Array(verts),
    idx = [];

  for (let i = 0; i <= METEOR_SEGS; i++) {
    mU[i * 2] = mU[i * 2 + 1] = i / METEOR_SEGS;
    mS[i * 2] = -1;
    mS[i * 2 + 1] = 1;
    if (i < METEOR_SEGS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }

  const meteorGeo = new THREE.InstancedBufferGeometry();

  meteorGeo.setIndex(idx);
  meteorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  meteorGeo.setAttribute('aU', new THREE.BufferAttribute(mU, 1));
  meteorGeo.setAttribute('aSide', new THREE.BufferAttribute(mS, 1));
  for (const [name, size] of [
    ['iStart', 3],
    ['iVel', 3],
    ['iT0', 1],
    ['iLife', 1],
  ]) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(METEORS * size), size);

    a.setUsage(THREE.DynamicDrawUsage);
    meteorGeo.setAttribute(name, a);
  }
  meteorGeo.attributes.iT0.array.fill(-1e6);
  meteorGeo.attributes.iLife.array.fill(1);
  for (let i = 0; i < METEORS; i++) meteorGeo.attributes.iVel.setXYZ(i, 1, 0, 0); // normalize(0) would be NaN
  meteorGeo.instanceCount = METEORS;

  const iStart = attribute('iStart', 'vec3'),
    iVel = attribute('iVel', 'vec3'),
    iT0 = attribute('iT0', 'float'),
    iLife = attribute('iLife', 'float'),
    aU = attribute('aU', 'float'),
    aSide = attribute('aSide', 'float');
  const mAge = U.time.sub(iT0);
  const head = iStart.add(iVel.mul(mAge));
  const dirV = normalize(iVel);
  const tailLen = float(1.5);
  const along = head.sub(dirV.mul(tailLen).mul(float(1).sub(aU)));
  const mSide = normalize(cross(dirV, normalize(cameraPosition.sub(along))));
  const meteorMat = new THREE.MeshBasicNodeMaterial();

  premult(meteorMat);
  meteorMat.depthTest = true;
  meteorMat.positionNode = along.add(mSide.mul(aSide).mul(0.014).mul(aU.mul(0.85).add(0.15)));

  const life01 = clamp(mAge.div(iLife), 0, 1);
  const flash = smoothstep(0.0, 0.12, life01)
    .mul(smoothstep(1.0, 0.7, life01))
    .mul(step(0, mAge));
  const meteorBody = pow(float(1).sub(abs(aSide)), 1.6)
    .mul(pow(aU, 2.2))
    .mul(flash);

  meteorMat.outputNode = vec4(
    vec3(0.85, 0.92, 1.0)
      .mul(meteorBody)
      .mul(float(2.0))
      .mul(W[R.realistic].add(W[R.cartoon]).add(W[R.neon]).add(W[R.hologram])),
    0
  ).add(
    vec4(
      vec3(0.1, 0.085, 0.07).mul(meteorBody.mul(1.4).min(1.0)),
      meteorBody.mul(1.4).min(1.0)
    ).mul(W[R.ink])
  );

  const meteors = new THREE.Mesh(meteorGeo, meteorMat);

  meteors.frustumCulled = false;
  meteors.renderOrder = 7;
  group.add(meteors);

  // ================= Aurora =================
  const uAurora = uniform(1),
    uLat = uniform(71),
    uSpeed = uniform(1),
    uColA = uniform(new THREE.Color('#5cffb0')),
    uColB = uniform(new THREE.Color('#b58cff'));
  const auroraMat = new THREE.MeshBasicNodeMaterial();

  premult(auroraMat);
  auroraMat.depthTest = true;

  const ap = normalize(positionLocal);
  const latDeg = asin(clamp(ap.y, -1, 1)).mul(180 / Math.PI);
  const lngR = atan(ap.x, ap.z);
  const t = U.time.mul(uSpeed).mul(0.35);
  const wobble = fbm(vec3(sin(lngR).mul(1.6), cos(lngR).mul(1.6), t.mul(0.6)), 3).mul(5.0);
  const dist = abs(abs(latDeg).sub(uLat)).sub(0).add(wobble.mul(0.6));
  const curtain = exp(sq(dist.div(3.6)).negate());
  const rays = pow(
    fbm(vec3(ap.x.mul(8.0), ap.z.mul(8.0), t.add(abs(latDeg).mul(0.12))), 3)
      .mul(0.5)
      .add(0.5)
      .max(0),
    1.6
  );
  const night = smoothstep(0.35, -0.3, dot(ap, sun));
  const aView = float(1).sub(clamp(dot(ap, normalize(cameraPosition.sub(ap))), 0, 1));
  const aur = curtain.mul(rays.mul(1.6).add(0.2)).mul(night).mul(aView.mul(1.8).add(0.55));
  const aurHue = mix(
    vec3(uColA),
    vec3(uColB),
    smoothstep(-2.0, 4.0, wobble.add(abs(latDeg).sub(uLat)))
  );

  auroraMat.outputNode = vec4(aurHue.mul(aur).mul(uAurora).mul(look.p.auroraAmt).mul(0.9), 0);

  const aurora = new THREE.Mesh(new THREE.SphereGeometry(1.03, 160, 96), auroraMat);

  aurora.renderOrder = 2;
  group.add(aurora);

  // ================= CPU side =================
  const camRight = new THREE.Vector3(),
    camUp = new THREE.Vector3(),
    camFwd = new THREE.Vector3();
  const local = new THREE.Vector3();
  let nextMeteor = 4,
    meteorCursor = 0;

  /**
   * Launch a shooting star in the camera's field of view.
   *
   * @param {object} e the engine
   */
  function launchMeteor(e) {
    const i = meteorCursor++ % METEORS,
      a = meteorGeo.attributes,
      d = 9 + Math.random() * 5;
    const rx = (Math.random() * 2 - 1) * d * 0.28 * Math.max(1, e.camera.aspect),
      ry = (0.2 + Math.random() * 0.7) * d * 0.22;
    const start = e.camera.position
      .clone()
      .addScaledVector(camFwd, -d)
      .addScaledVector(camRight, rx)
      .addScaledVector(camUp, ry);
    const vel = camRight
      .clone()
      .multiplyScalar(-(0.75 + Math.random() * 0.4))
      .addScaledVector(camUp, -(0.35 + Math.random() * 0.35))
      .multiplyScalar(6.5 + Math.random() * 3);

    a.iStart.setXYZ(i, start.x, start.y, start.z);
    a.iVel.setXYZ(i, vel.x, vel.y, vel.z);
    a.iT0.setX(i, e.time);
    a.iLife.setX(i, 0.9 + Math.random() * 0.7);

    for (const k of ['iStart', 'iVel', 'iT0', 'iLife']) a[k].needsUpdate = true;
  }

  return {
    name: 'cosmos',
    group,

    /**
     * Place the moon, turn the rings, launch meteors and sync the aurora to the scene.
     *
     * @param {object} e the engine
     */
    update(e) {
      const s = e.scene;

      // camera basis so the moon keeps its framing as the globe is turned
      e.camera.updateMatrixWorld();
      e.camera.matrixWorld.extractBasis(camRight, camUp, camFwd);

      const a = e.time * 0.045 + 0.9;
      const rm = e.rig.fit * 0.46;

      moon.visible = s.moon !== false;
      moon.position
        .set(0, 0, 0)
        .addScaledVector(camRight, Math.cos(a) * rm * 1.05)
        .addScaledVector(camFwd, Math.sin(a) * rm * 0.9)
        .addScaledVector(camUp, rm * 0.3 + Math.sin(a) * rm * 0.1);
      moon.rotation.y = e.time * 0.01;

      // orbit rings and satellites
      for (const [o, r] of rings.entries()) {
        r.mesh.visible = s.orbits !== false;
        r.sat.visible = r.mesh.visible && !!r.def.sat;
        r.mesh.rotation.set(r.def.incl, r.def.yaw0 + e.time * r.def.spin, 0, 'YXZ');
        if (r.sat.visible) {
          r.mesh.updateMatrix();

          const ang = e.time * 0.22 * (o + 1) * (o % 2 ? -1 : 1);

          local
            .set(Math.cos(ang) * r.def.rf, Math.sin(ang) * r.def.rf, 0)
            .applyMatrix4(r.mesh.matrix);
          r.sat.position.copy(local);
        }
      }

      // shooting stars
      meteors.visible = s.shootingStars !== false;
      if (meteors.visible && !e.sim.paused && e.intro >= 1 && e.time > nextMeteor) {
        launchMeteor(e);
        nextMeteor = e.time + (0.6 + Math.random() * 2.2) / Math.max(0.05, s.meteorRate * 1.6);
      }

      // aurora
      aurora.visible = s.aurora !== false;
      uAurora.value = s.auroraIntensity;
      uLat.value = s.auroraLat;
      uSpeed.value = s.auroraSpeed;

      const [ca, cb] = AURORA_SCHEMES[s.auroraScheme] || AURORA_SCHEMES.gv;

      uColA.value.set(ca);

      uColB.value.set(cb);
    },
  };
}
