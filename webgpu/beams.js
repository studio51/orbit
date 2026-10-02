/* Orbit: activity beams, impact rings and the HQ beacon (WebGPU renderer)
 *
 * Beams are camera-facing ribbons along a lifted great-circle arc. The CPU only
 * writes a few numbers when a beam is born (endpoints, colour, birth time);
 * the whole animation (draw-on, comet trail, hold, fade) runs in the shader
 * from `time - birth`, so a beam costs nothing per frame.
 *
 * All three effects share one premultiplied blend, `rgb + dst·(1 − a)`, so a
 * look chooses additive glow (a = 0) or a solid stroke (a > 0) per fragment.
 *
 * Contract with the engine: `spawn({ type, city })`, and `update(e)` which
 * emits 'impact' when a beam lands and recycles finished beams.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  float,
  vec3,
  vec4,
  attribute,
  mix,
  clamp,
  smoothstep,
  step,
  pow,
  exp,
  sin,
  acos,
  abs,
  dot,
  cross,
  normalize,
  cameraPosition,
  positionGeometry,
} from 'three/tsl';
import { BEAM } from '../shared/sim.js';
import { lnglatToVec3, sq } from './tsl-util.js';

const POOL = 56; // concurrent beams
const SEGMENTS = 80; // ribbon resolution
const RING_POOL = 48; // concurrent rings
const DRAW = BEAM.DRAW_MS / 1000;
const HOLD = BEAM.HOLD_MS / 1000;
const FADE = BEAM.FADE_MS / 1000;

const PREMULT = (mat) => {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
};

/**
 * Build a pooled instanced geometry whose per-instance attributes are dynamic.
 *
 * @param {THREE.BufferGeometry} base the shared per-vertex geometry
 * @param {Object<string, number>} layout instance attribute name → component count
 * @returns {THREE.InstancedBufferGeometry} geometry with `POOL`-sized instance buffers
 */
function pooled(base, layout, count) {
  const geo = new THREE.InstancedBufferGeometry();

  geo.index = base.index;
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);

  for (const [name, size] of Object.entries(layout)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);

    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
  }
  geo.instanceCount = count;

  return geo;
}

/**
 * Create the beam, ring and beacon effects.
 *
 * @param {object} args build inputs
 * @param {object} args.engine the GlobeEngine (for time, HQ, state and events)
 * @returns {{ name: string, group: THREE.Group, spawn: Function, ring: Function, update: Function }} the module
 */
export function createBeams({ engine }) {
  const { U, look } = engine;
  const W = look.weights;
  const HQ = engine.hqVec;

  // ================= Beam ribbons =================
  const base = new THREE.BufferGeometry();
  const verts = (SEGMENTS + 1) * 2;
  const aU = new Float32Array(verts),
    aSide = new Float32Array(verts),
    idx = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    aU[i * 2] = aU[i * 2 + 1] = i / SEGMENTS;
    aSide[i * 2] = -1;
    aSide[i * 2 + 1] = 1;
    if (i < SEGMENTS) {
      const a = i * 2;

      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  base.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  base.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  base.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  base.setIndex(idx);

  const geo = pooled(base, { iA: 3, iB: 3, iColor: 3, iT0: 1, iLift: 1 }, POOL);

  geo.attributes.iT0.array.fill(-1e6); // all slots start dead
  for (let i = 0; i < POOL; i++) {
    geo.attributes.iA.setXYZ(i, 1, 0, 0); // valid, distinct endpoints: normalize(0) would be NaN
    geo.attributes.iB.setXYZ(i, 0, 1, 0);
  }

  const iA = attribute('iA', 'vec3'),
    iB = attribute('iB', 'vec3'),
    iColor = attribute('iColor', 'vec3'),
    iT0 = attribute('iT0', 'float'),
    iLift = attribute('iLift', 'float'),
    aUn = attribute('aU', 'float'),
    aSn = attribute('aSide', 'float');

  const omega = acos(clamp(dot(iA, iB), -0.9999, 0.9999));
  const sinO = sin(omega);
  const arcPoint = Fn(([u]) => {
    const s0 = sin(float(1).sub(u).mul(omega)).div(sinO);
    const s1 = sin(u.mul(omega)).div(sinO);
    const lift = sin(u.mul(Math.PI)).max(0).pow(0.85).mul(iLift);

    return iA.mul(s0).add(iB.mul(s1)).mul(lift.add(1.004));
  });
  const easeInOut = (t) =>
    t.lessThan(0.5).select(t.mul(t).mul(t).mul(4), float(1).sub(pow(t.mul(-2).add(2), 3).div(2)));

  const age = U.time.sub(iT0);
  const head = easeInOut(clamp(age.div(DRAW), 0, 1));
  const behind = head.sub(aUn); // > 0 means "behind the head"

  const p0 = arcPoint(aUn);
  const tangent = normalize(
    arcPoint(clamp(aUn.add(0.004), 0, 1)).sub(arcPoint(clamp(aUn.sub(0.004), 0, 1)))
  );
  const sideV = normalize(cross(tangent, normalize(cameraPosition.sub(p0))));
  const nearHead = exp(sq(behind.div(0.045)).negate()).mul(step(0, behind));
  const widthK = float(0.3)
    .add(float(0.7).mul(exp(behind.mul(-3.0))))
    .add(nearHead.mul(0.9));

  const beamMat = new THREE.MeshBasicNodeMaterial();

  PREMULT(beamMat);
  beamMat.depthTest = true;
  beamMat.positionNode = p0.add(sideV.mul(aSn).mul(look.p.beamWidth).mul(widthK));

  const fade = float(1).sub(clamp(age.sub(DRAW + HOLD).div(FADE), 0, 1));
  const alive = step(0, age).mul(step(0, behind)).mul(fade);
  const across = float(1).sub(abs(aSn));
  const trail = exp(behind.mul(-5.0));
  const body = mix(float(0.22), float(1), trail);

  const beamFrag = Fn(() => {
    const rgb = vec3(0).toVar(),
      a = float(0).toVar();
    const glow = (k) =>
      iColor
        .mul(body)
        .mul(pow(across, 1.4).mul(0.65).add(pow(across, 4).mul(1.6)))
        .mul(k)
        .add(vec3(1).mul(pow(across, 5)).mul(trail).mul(0.9).mul(k));

    // 0 realistic, 2 neon, 3 hologram: additive glow
    If(W[0].greaterThan(0.002), () => {
      rgb.addAssign(glow(look.p.beamGlow).mul(W[0]));
    });
    If(W[2].greaterThan(0.002), () => {
      rgb.addAssign(glow(look.p.beamGlow).mul(W[2]));
    });
    If(W[3].greaterThan(0.002), () => {
      const scan = sin(aUn.mul(300).sub(U.time.mul(24)))
        .mul(0.3)
        .add(0.7);

      rgb.addAssign(glow(look.p.beamGlow).mul(scan).mul(W[3]));
    });
    // 1 cartoon: a chunky solid stroke with a dark outline
    If(W[1].greaterThan(0.002), () => {
      const edge = step(0.36, across);
      const fill = mix(iColor, vec3(1), pow(across, 3).mul(0.35).add(trail.mul(0.25)));
      const stroke = mix(vec3(0.07, 0.04, 0.16), fill, edge);

      rgb.addAssign(stroke.mul(W[1]).mul(body.mul(0.6).add(0.4)));

      a.addAssign(smoothstep(0.0, 0.14, across).mul(W[1]).mul(body.mul(0.55).add(0.45)));
    });
    // 4 ink: a flat brush stroke, black body with a vermilion head
    If(W[4].greaterThan(0.002), () => {
      const headMix = clamp(trail.mul(1.4).sub(0.2), 0, 1);
      const ink = mix(vec3(0.1, 0.085, 0.07), look.c.accent, headMix);

      rgb.addAssign(ink.mul(W[4]).mul(smoothstep(0.0, 0.2, across)));

      a.addAssign(smoothstep(0.0, 0.2, across).mul(W[4]).mul(body.mul(0.5).add(0.5)));
    });

    return vec4(rgb.mul(alive), a.mul(alive));
  });

  beamMat.outputNode = beamFrag();

  const beams = new THREE.Mesh(geo, beamMat);

  beams.frustumCulled = false;
  beams.renderOrder = 4;

  // ================= Impact / ping rings =================
  const quad = new THREE.PlaneGeometry(2, 2);
  const ringGeo = pooled(quad, { rN: 3, rColor: 3, rT0: 1, rSize: 1, rDur: 1 }, RING_POOL);

  ringGeo.attributes.rT0.array.fill(-1e6);
  for (let i = 0; i < RING_POOL; i++) ringGeo.attributes.rN.setXYZ(i, 0, 0, 1);

  const rN = attribute('rN', 'vec3'),
    rColor = attribute('rColor', 'vec3'),
    rT0 = attribute('rT0', 'float'),
    rSize = attribute('rSize', 'float'),
    rDur = attribute('rDur', 'float');
  const up = abs(rN.y)
    .greaterThan(0.95)
    .select(vec3(1, 0, 0), vec3(0, 1, 0));
  const tx = normalize(cross(rN, up)),
    ty = cross(rN, tx);
  const rAge = U.time.sub(rT0);
  const rProg = clamp(rAge.div(rDur), 0, 1);
  const ringMat = new THREE.MeshBasicNodeMaterial();

  PREMULT(ringMat);
  ringMat.positionNode = rN
    .mul(1.004)
    .add(tx.mul(positionGeometry.x).mul(rSize))
    .add(ty.mul(positionGeometry.y).mul(rSize));

  const ringFrag = Fn(() => {
    const r = positionGeometry.xy.length();
    const front = float(1).sub(pow(float(1).sub(rProg), 3)); // ease-out expansion
    const band = exp(sq(r.sub(front).div(0.07)).negate());
    const flash = exp(r.mul(r).mul(-90)).mul(float(1).sub(rProg).pow(5));
    const life = step(0, rAge).mul(step(rAge, rDur)).mul(float(1).sub(rProg));
    const rgb = vec3(0).toVar(),
      a = float(0).toVar();

    // additive looks
    const glow = rColor
      .mul(band.mul(1.5))
      .add(vec3(1).mul(flash).mul(0.6).add(rColor.mul(flash).mul(0.6)));
    const additive = W[0].add(W[2]).add(W[3]);

    rgb.addAssign(glow.mul(additive));

    // cartoon / ink: crisp outlined ring
    const crisp = smoothstep(0.1, 0.0, abs(r.sub(front)).sub(0.05));

    rgb.addAssign(
      mix(vec3(0.07, 0.04, 0.16), rColor, 0.0)
        .mul(0)
        .add(rColor.mul(crisp).mul(W[1]))
    );
    a.addAssign(crisp.mul(W[1]));
    rgb.addAssign(look.c.accent.mul(crisp).mul(W[4]).mul(0.9));
    a.addAssign(crisp.mul(W[4]));

    return vec4(rgb.mul(life), a.mul(life));
  });

  ringMat.outputNode = ringFrag();

  const rings = new THREE.Mesh(ringGeo, ringMat);

  rings.frustumCulled = false;
  rings.renderOrder = 5;

  // ================= HQ beacon (light pillar + core) =================
  const beaconMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });

  PREMULT(beaconMat);

  const pillarGeo = new THREE.CylinderGeometry(0.0035, 0.011, 0.34, 24, 1, true);

  pillarGeo.translate(0, 0.17, 0);

  const beaconFrag = Fn(() => {
    const y = positionGeometry.y.div(0.34);
    const grad = float(1).sub(y).pow(2.2);
    const pulse = sin(U.time.mul(2.6)).mul(0.18).add(0.82);
    const col = mix(look.c.accent, vec3(1), float(1).sub(y).pow(4).mul(0.6));

    return vec4(col.mul(grad).mul(pulse).mul(0.9), 0);
  });

  beaconMat.outputNode = beaconFrag();

  const pillar = new THREE.Mesh(pillarGeo, beaconMat);
  const hqQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), HQ);

  pillar.quaternion.copy(hqQuat);
  pillar.position.copy(HQ).multiplyScalar(1.0);
  pillar.renderOrder = 5;

  const group = new THREE.Group();

  group.add(beams, rings, pillar);

  // ================= CPU side =================
  const active = [];
  const col = new THREE.Color();
  const v = new THREE.Vector3();
  let cursor = 0,
    ringCursor = 0;

  /**
   * Launch a ring on the globe surface.
   *
   * @param {THREE.Vector3} n surface unit normal
   * @param {THREE.Color} color ring colour
   * @param {number} size final ring radius in world units
   * @param {number} dur duration in seconds
   * @param {number} delay seconds until it starts
   */
  function ring(n, color, size, dur, delay = 0) {
    const i = ringCursor++ % RING_POOL,
      a = ringGeo.attributes;

    a.rN.setXYZ(i, n.x, n.y, n.z);
    a.rColor.setXYZ(i, color.r, color.g, color.b);
    a.rT0.setX(i, engine.time + delay);
    a.rSize.setX(i, size);
    a.rDur.setX(i, dur);

    for (const k of ['rN', 'rColor', 'rT0', 'rSize', 'rDur']) a[k].needsUpdate = true;
  }

  return {
    name: 'beams',
    group,
    ring,

    /**
     * Start a beam from a city to HQ.
     *
     * @param {{ type: object, city: { name: string, lnglat: number[] } }} pick the activity pick
     */
    spawn(pick) {
      const i = cursor++ % POOL,
        a = geo.attributes;
      const from = lnglatToVec3(pick.city.lnglat, v);
      const ang = Math.acos(Math.max(-1, Math.min(1, from.dot(HQ))));
      const color = engine.state.types[pick.type.id].color;

      col.set(color);
      a.iA.setXYZ(i, from.x, from.y, from.z);
      a.iB.setXYZ(i, HQ.x, HQ.y, HQ.z);
      a.iColor.setXYZ(i, col.r, col.g, col.b);
      a.iT0.setX(i, engine.time);
      a.iLift.setX(i, 0.045 + 0.3 * Math.pow(ang / Math.PI, 0.85));
      for (const k of ['iA', 'iB', 'iColor', 'iT0', 'iLift']) a[k].needsUpdate = true;

      ring(from.clone(), col.clone(), 0.045, 1.1);
      active.push({ t0: engine.time, type: pick.type, city: pick.city, color, landed: false });

      engine.emit('beam', { type: pick.type, city: pick.city, color });
    },

    /**
     * Land beams, emit impacts and recycle finished beams.
     *
     * @param {object} e the engine
     */
    update(e) {
      for (let i = active.length - 1; i >= 0; i--) {
        const b = active[i],
          age = e.time - b.t0;

        if (!b.landed && age >= DRAW) {
          b.landed = true;
          col.set(b.color);
          ring(HQ, col, 0.16, 1.5);
          ring(HQ, col, 0.1, 1.1, 0.18);
          e.bump(b.type.id);
          e.emit('impact', { type: b.type, city: b.city, color: b.color });
        }
        if (age > DRAW + HOLD + FADE) active.splice(i, 1);
      }

      // HQ heartbeat
      if (e.scene.heartbeat !== false && e.intro >= 1 && e.time - (this._beat || 0) > 2.6) {
        this._beat = e.time;
        col.set(e.look.c.accent.value);
        ring(HQ, col, 0.12, 2.0);
      }
    },
  };
}
