/* Orbit: the planet (WebGPU renderer)
 *
 * Three meshes, all TSL shaders. The expensive procedural fields (biomes, relief,
 * ocean colour, the cloud field) are baked once into textures by bake.js, so the
 * per-frame shaders only sample them:
 *
 *   • the globe        surface colour for the active look(s), sun + terminator,
 *                      night lights, relief, glint, cloud shadows
 *   • the cloud shell  baked cloud field, lit and self-shaded (realistic + cartoon)
 *   • the atmosphere   realistic: a ray-marched Rayleigh/Mie shell with sunset
 *                      reddening; other looks: a stylised limb glow
 *
 * Every look is a branch evaluated only while its weight is non-zero (see
 * looks.js). The shared surface inputs are computed once; each branch turns
 * them into a colour.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  texture,
  mix,
  smoothstep,
  step,
  clamp,
  max,
  abs,
  exp,
  pow,
  sqrt,
  floor,
  fract,
  cos,
  sin,
  asin,
  atan,
  dot,
  length,
  normalize,
  fwidth,
  positionLocal,
  positionWorld,
  cameraPosition,
} from 'three/tsl';
import { noise3, rotateY, bumpNormal, dirToUv, sq } from './tsl-util.js';
import { LOOK_INDEX } from './looks.js';

export const ATMOS_RADIUS = 1.075; // outer edge of the atmosphere shell
export const CLOUD_RADIUS = 1.011; // cloud shell radius

const RAD = Math.PI / 180;
const R = LOOK_INDEX; // look name → weight slot

/**
 * Anti-aliased lat/long grid lines over an equirectangular uv.
 *
 * @param {Node} uvE equirectangular uv (vec2)
 * @param {number} cols meridian count
 * @param {number} rows parallel count
 * @param {number} width line half-width in pixels
 * @returns {Node} float 0..1 line coverage
 */
export function gridLines(uvE, cols, rows, width = 1.0) {
  const g = vec2(uvE.x.mul(cols), uvE.y.mul(rows));
  const d = abs(fract(g.sub(0.5)).sub(0.5));
  const fw = vec2(fwidth(g.x), fwidth(g.y)).mul(width);
  const lx = float(1).sub(smoothstep(float(0), fw.x.add(0.0001), d.x));
  const ly = float(1).sub(smoothstep(float(0), fw.y.add(0.0001), d.y));

  return max(lx, ly);
}

/**
 * Anti-aliased engraving lines: the sphere cut by parallel planes.
 * Seam-free (works in 3D), so the lines rotate cleanly with the globe.
 *
 * @param {Node} p unit position (vec3)
 * @param {Node} axis plane normal (vec3)
 * @param {number} density lines per unit radius
 * @param {Node} width 0..1 fraction of each period that is ink
 * @returns {Node} float 0..1 ink coverage
 */
function engrave(p, axis, density, width) {
  const v = dot(p, axis).mul(density);
  const aa = fwidth(v).mul(1.2).add(0.001);
  const d = abs(fract(v).sub(0.5)).mul(2);

  return float(1)
    .sub(smoothstep(width.sub(aa), width.add(aa), d))
    .mul(step(0.001, width));
}

/**
 * A constant-pixel-width outline around the 0.5 contour of a scalar field.
 *
 * @param {Node} field scalar field (float)
 * @param {number} inner pixel half-width that is fully inked
 * @param {number} outer pixel distance where the line has faded out
 * @returns {Node} float 0..1 line coverage
 */
function pxLine(field, inner, outer) {
  const dd = abs(field.sub(0.5)).div(fwidth(field).add(0.00001));

  return float(1).sub(smoothstep(inner, outer, dd));
}

const AXIS_A = new THREE.Vector3(0, 1, 0);
const AXIS_B = new THREE.Vector3(0.8, 0.35, 0.5).normalize();
const AXIS_C = new THREE.Vector3(-0.6, 0.5, 0.62).normalize();

/**
 * Build the planet, cloud shell and atmosphere.
 *
 * @param {object} args build inputs
 * @param {object} args.world baked masks ({ landTex, fieldTex, lightsTex }, see world.js)
 * @param {object} args.baked baked fields ({ landTex, oceanTex, climTex, miscTex }, see bake.js)
 * @param {object} args.U shared uniforms (see uniforms.js)
 * @param {object} args.look the LookState
 * @returns {{ group: THREE.Group, globe: THREE.Mesh, clouds: THREE.Mesh, atmosphere: THREE.Mesh }}
 *   the group and its three meshes
 */
export function createEarth({ world, baked, U, look }) {
  const W = look.weights;
  const L = U.sun;
  const sunCol = vec3(1.0, 0.9613, 0.88);

  // --- Shared surface inputs (evaluated once per fragment) ---
  const p = positionLocal.normalize().toVar('p');
  const uvE = vec2(uv().x.add(0.25), uv().y).toVar('uvE'); // sphere uv → equirectangular texture uv
  const landS = texture(world.landTex, uvE).r; // crisp land mask
  const fld = texture(world.fieldTex, uvE); // shelf / broad / continentality blurs
  const lightsV = texture(world.lightsTex, uvE).r;
  const A = texture(baked.landTex, uvE); // land albedo (rgb) + height (a)
  const B = texture(baked.oceanTex, uvE); // ocean albedo
  const C = texture(baked.climTex, uvE); // arid, ice, patch, elevation
  const M = texture(baked.miscTex, uvE); // cloud field (r), coast wobble (g)
  const lat = abs(p.y).toVar('lat'); // |sin(latitude)|
  const V = normalize(cameraPosition.sub(p)).toVar('V');
  const ndlGeo = dot(p, L).toVar('ndlGeo');
  const dayF = smoothstep(-0.12, 0.25, ndlGeo).toVar('dayF');
  const nightF = smoothstep(0.02, -0.2, ndlGeo).toVar('nightF');
  const limbK = float(1)
    .sub(max(dot(p, V), 0))
    .toVar('limbK'); // 0 centre → 1 limb
  const arid = C.r,
    iceM = C.g;

  // Land mask: sharp raster + soft shelf + baked fractal wobble → a natural coastline.
  const coastField = fld.r
    .mul(0.4)
    .add(landS.mul(0.6))
    .add(M.g.sub(0.5).mul(0.14))
    .toVar('coastField');
  const cw = fwidth(coastField).mul(0.8).add(0.004);
  const landM = smoothstep(float(0.5).sub(cw), float(0.5).add(cw), coastField).toVar('landM');

  // --- Clouds (baked field; the shell turns, so shadows rotate the lookup the other way) ---
  const cloudThreshold = float(0.97).sub(U.clouds.mul(0.72));
  const cloudShape = (raw) => smoothstep(cloudThreshold.sub(0.04), cloudThreshold.add(0.3), raw);
  const cloudAt = (dir) =>
    cloudShape(texture(baked.miscTex, dirToUv(rotateY(dir, U.cloudRot.negate()))).level(1).r);
  const cloudAtSurface = cloudAt(p.sub(L.mul(0.012))).toVar('cloudSurf');

  // ===================== Look: realistic =====================
  const realistic = () => {
    const height = A.a.add(noise3(p.mul(38.0)).mul(0.05));
    const land = A.rgb.mul(noise3(p.mul(90.0)).mul(0.08).add(1.0));
    const oceanMask = float(1).sub(landM).mul(float(1).sub(iceM));
    const albedo = mix(B.rgb, land.mul(U.intro.land.oneMinus().mul(-0.8).add(1)), landM);

    // lighting (relief bump on land, animated micro-waves on water)
    const Nland = bumpNormal(p, p, height.mul(landM), float(0.03));
    const waves = vec3(
      noise3(p.mul(260.0).add(vec3(U.time.mul(0.25), 0, 0))),
      noise3(p.mul(260.0).add(vec3(0, U.time.mul(0.21), 7))),
      noise3(p.mul(260.0).add(vec3(3, 0, U.time.mul(0.18))))
    );
    const Nwater = normalize(p.add(waves.mul(0.011)));
    const N = mix(Nwater, Nland, landM);
    const diffuse = clamp(dot(N, L).add(0.06).div(1.06), 0, 1);
    const ambient = vec3(0.7, 0.85, 1.0).mul(float(1).sub(U.darkness).mul(0.07));
    let col = albedo.mul(sunCol.mul(diffuse).mul(2.1).add(ambient));

    // sunset band along the terminator
    col = col.add(
      albedo
        .mul(vec3(1.0, 0.4, 0.12))
        .mul(exp(sq(ndlGeo.div(0.15)).negate()))
        .mul(0.5)
    );

    // cloud shadows
    col = col.mul(float(1).sub(cloudAtSurface.mul(0.42).mul(dayF)));

    // ocean glint (tight, glittering) + grazing sky reflection
    const H = normalize(L.add(V));
    const nh = max(dot(Nwater, H), 0);
    const glint = nh.pow(1800).mul(2.4).add(nh.pow(120).mul(0.1));
    const fres = limbK.pow(5);
    const shine = glint
      .mul(vec3(1.0, 0.93, 0.82))
      .mul(U.sunGlint)
      .add(vec3(0.16, 0.3, 0.6).mul(fres).mul(0.4));

    col = col.add(
      shine
        .mul(oceanMask)
        .mul(dayF)
        .mul(float(1).sub(cloudAtSurface.mul(0.92)))
    );

    // night-side city lights, hidden under cloud
    const lv = lightsV.pow(0.8).mul(3.0);
    const lightCol = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.86, 0.6), clamp(lv.sub(1.0), 0, 1));

    col = col.add(
      lightCol
        .mul(lv)
        .mul(landM)
        .mul(nightF)
        .mul(U.cityLights)
        .mul(U.cityBright)
        .mul(U.intro.lights)
        .mul(float(1).sub(cloudAtSurface.mul(0.8)))
        .mul(1.4)
    );

    return col;
  };

  // ===================== Look: cartoon =====================
  const cartoon = () => {
    const outline = vec3(0.07, 0.04, 0.2);
    const sh = fld.r;

    // flat, banded palette
    let ocean = vec3(0.03, 0.2, 0.95);

    ocean = mix(ocean, vec3(0.07, 0.42, 1.0), step(0.2, sh));
    ocean = mix(ocean, vec3(0.28, 0.72, 1.0), step(0.38, sh));

    let land = mix(vec3(0.08, 0.58, 0.07), vec3(0.02, 0.38, 0.09), step(0.55, C.b));

    land = mix(land, vec3(1.0, 0.6, 0.1), step(0.5, arid));
    land = mix(land, vec3(0.5, 0.26, 0.1), step(1.0, A.a));
    land = mix(land, vec3(1.0), max(step(0.86, lat.add(A.a.mul(0.03))), step(1.4, A.a)));

    let albedo = mix(ocean, land, landM);

    albedo = mix(albedo, vec3(0.95, 0.99, 1.0), iceM.mul(float(1).sub(landM)));

    // 3-band cel shading toward a violet shadow
    const ndl = dot(p, L);
    const full = smoothstep(0.27, 0.3, ndl),
      mid = smoothstep(-0.06, -0.03, ndl);
    const level = mid.mul(0.55).add(full.mul(0.45));
    let col = albedo.mul(mix(vec3(0.3, 0.26, 0.7), vec3(1.0), level)).mul(full.mul(0.12).add(1.0));

    // hard specular dot on the water
    const H = normalize(L.add(V));
    const spec = step(0.9988, dot(p, H)).mul(float(1).sub(landM)).mul(U.sunGlint).mul(dayF);

    col = mix(col, vec3(1.0), spec);

    // night windows
    const win = step(0.32, lightsV.pow(0.8))
      .mul(landM)
      .mul(nightF)
      .mul(U.cityLights)
      .mul(U.intro.lights);

    col = mix(col, vec3(1.0, 0.88, 0.35).mul(1.6), win);

    // coast outline + limb outline
    col = mix(col, outline, pxLine(coastField, 1.1, 2.2).mul(0.95));
    col = mix(col, outline, smoothstep(0.8, 0.84, limbK));

    return col.mul(1.05);
  };

  // ===================== Look: neon =====================
  const neon = () => {
    const magenta = vec3(1.0, 0.1, 0.62),
      cyan = vec3(0.1, 0.95, 0.95);
    const light = dayF.mul(0.7).add(0.3);

    // dark body with a slow vertical glow
    let col = mix(vec3(0.012, 0.0, 0.03), vec3(0.05, 0.0, 0.12), smoothstep(-0.5, 0.9, ndlGeo));

    // land: dark violet with retro sun-stripes
    const stripes = smoothstep(0.35, 0.5, fract(asin(p.y).mul(34.0)));
    const landFill = mix(vec3(0.05, 0.0, 0.1), vec3(0.15, 0.0, 0.3), stripes.mul(0.7).add(0.3));

    col = mix(col, landFill.mul(light), landM);

    // glowing coastline (cyan north → magenta south)
    const hue = mix(magenta, cyan, smoothstep(-0.6, 0.6, p.y));
    const coastCore = pxLine(coastField, 0.9, 2.6),
      coastGlow = pxLine(coastField, 1.5, 9.0);

    col = col.add(hue.mul(coastCore.mul(1.15).add(coastGlow.mul(0.22))).mul(light));

    // wireframe grid
    const grid = gridLines(uvE, 24, 12, 1.0);

    col = col.add(mix(magenta, cyan, landM).mul(grid).mul(0.42).mul(light));

    // neon city lights
    col = col.add(
      vec3(1.0, 0.7, 0.95)
        .mul(lightsV.pow(0.8))
        .mul(2.6)
        .mul(landM)
        .mul(nightF)
        .mul(U.cityLights)
        .mul(U.cityBright)
        .mul(U.intro.lights)
    );

    // fresnel rim
    col = col.add(mix(magenta, cyan, limbK).mul(limbK.pow(3)).mul(0.55));

    return col;
  };

  // ===================== Look: hologram =====================
  const hologram = () => {
    const cyan = vec3(0.12, 0.85, 1.0);
    const STEP = 2.1;
    const latD = asin(clamp(p.y, -1, 1)).div(RAD);
    const row = floor(latD.div(STEP).add(0.5));
    const latC = row.mul(STEP);
    const cosC = max(cos(latC.mul(RAD)), 0.06);
    const nCols = max(floor(cosC.mul(360).div(STEP)), 1);
    const lngD = atan(p.x, p.z).div(RAD);
    const colI = floor(lngD.div(360).mul(nCols).add(0.5));
    const lngC = colI.mul(360).div(nCols);
    const dLat = latD.sub(latC),
      dLng = lngD.sub(lngC).mul(cosC);
    const dist = sqrt(dLat.mul(dLat).add(dLng.mul(dLng)));
    const radius = STEP * 0.31;
    const dotM = float(1).sub(smoothstep(radius - 0.12, radius + 0.12, dist));
    const landC = smoothstep(
      0.35,
      0.65,
      texture(world.landTex, vec2(lngC.div(360).add(0.5), latC.div(180).add(0.5))).level(2).r
    );

    // dim ocean lattice, bright land dots with day/night modulation
    const flicker = sin(U.time.mul(1.7).add(row.mul(3.1)).add(colI.mul(1.3)))
      .mul(0.12)
      .add(0.88);
    const lightLvl = dayF.mul(0.55).add(0.45);
    let col = vec3(0.0, 0.025, 0.04);

    col = col.add(cyan.mul(dotM).mul(landC.mul(0.95).add(0.07)).mul(lightLvl).mul(flicker));

    // city lights as hot white dots
    col = col.add(
      vec3(0.8, 1.0, 1.0)
        .mul(dotM)
        .mul(step(0.18, lightsV))
        .mul(nightF)
        .mul(landC)
        .mul(U.cityLights)
        .mul(U.cityBright)
        .mul(U.intro.lights)
        .mul(1.8)
    );

    // latitude/longitude graticule
    col = col.add(cyan.mul(gridLines(uvE, 24, 12, 0.8)).mul(0.1));

    // sweeping scan band + fresnel edge
    const sweep = exp(sq(p.y.sub(fract(U.time.mul(0.1)).mul(2.2).sub(1.1)).div(0.05)).negate());

    col = col.add(cyan.mul(sweep).mul(0.5));
    col = col.add(cyan.mul(limbK.pow(2.5)).mul(0.9));

    return col;
  };

  // ===================== Look: ink & paper =====================
  const ink = () => {
    const paper = vec3(0.86, 0.79, 0.64),
      inkC = vec3(0.07, 0.055, 0.04);
    const ndl = dot(p, L);
    const lit = clamp(ndl.mul(0.85).add(0.3), 0, 1).mul(float(1).sub(arid.mul(0.15)));
    const shade = float(1).sub(lit);

    // water: parallel lines, denser and darker toward the coast and the night side
    const waterW = clamp(
      float(0.07).add(fld.r.mul(0.5)).add(nightF.mul(0.35)).add(shade.mul(0.25)),
      0,
      0.85
    );
    const water = engrave(p, vec3(AXIS_A), 85, waterW);

    // land: layered engraving that thickens with shade and relief
    const s = clamp(shade.add(A.a.mul(0.22)).add(0.05), 0, 1);
    const h1 = engrave(p, vec3(AXIS_B), 62, clamp(s.mul(1.5).sub(0.25), 0, 0.9));
    const h2 = engrave(p, vec3(AXIS_C), 62, clamp(s.mul(1.5).sub(0.75), 0, 0.9));
    const h3 = engrave(p, vec3(AXIS_A), 62, clamp(s.mul(1.4).sub(1.05), 0, 0.9));
    let ink_ = mix(water, max(max(h1, h2), h3), landM);

    ink_ = ink_.mul(float(1).sub(iceM));

    // bold coastline + limb
    ink_ = max(ink_, pxLine(coastField, 1.0, 2.1));
    ink_ = max(ink_, smoothstep(0.84, 0.87, limbK));

    // night lights punch through as paper dots on dense ink
    const lamp = step(0.3, lightsV.pow(0.8))
      .mul(landM)
      .mul(nightF)
      .mul(U.cityLights)
      .mul(U.intro.lights);

    ink_ = ink_.mul(float(1).sub(lamp));

    const tone = mix(paper, vec3(0.8, 0.88, 0.8), float(1).sub(landM).mul(0.35));
    const toned = mix(tone, vec3(0.9, 0.84, 0.68), landM.mul(0.5));

    return mix(toned, inkC, clamp(ink_, 0, 1));
  };

  const branches = [realistic, cartoon, neon, hologram, ink];

  // --- Globe material ---
  const globeMat = new THREE.MeshBasicNodeMaterial();
  const globeColor = Fn(() => {
    const out = vec3(0).toVar();

    // Declare the shared variables at the top level. TSL emits a `toVar` where it is first used,
    // so without this they would live inside whichever look branch happens to reference them
    // first, and stay zero whenever that look is inactive.
    const shared = p.x
      .add(uvE.x)
      .add(lat)
      .add(V.x)
      .add(ndlGeo)
      .add(dayF)
      .add(nightF)
      .add(limbK)
      .add(coastField)
      .add(landM)
      .add(cloudAtSurface);

    out.addAssign(vec3(shared.mul(0.0)));

    branches.forEach((fn, i) => {
      If(W[i].greaterThan(0.002), () => {
        out.addAssign(fn().mul(W[i]));
      });
    });

    // optional lat/long graticule over any look
    out.assign(mix(out, look.c.accent, gridLines(uvE, 24, 12, 0.9).mul(U.grid).mul(0.38)));

    return vec4(mix(look.c.bgA, out, U.intro.sphere), 1);
  });

  globeMat.colorNode = globeColor();

  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 112), globeMat);

  // --- Cloud shell (realistic + cartoon) ---
  const cloudMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const cloudOut = Fn(() => {
    const cp = normalize(positionWorld);
    const d = cloudShape(texture(baked.miscTex, vec2(uv().x.add(0.25), uv().y)).r);
    const rgb = vec3(0).toVar(),
      alpha = float(0).toVar();

    If(W[R.realistic].greaterThan(0.002), () => {
      const toward = cloudAt(normalize(cp.add(L.mul(0.022))));
      const ndl = dot(cp, L);
      const lit = smoothstep(-0.1, 0.4, ndl);
      const shade = mix(float(1.0), float(0.52), clamp(toward.sub(d.mul(0.4)), 0, 1));
      const dusk = mix(vec3(1.0, 0.5, 0.32), vec3(1.0, 0.99, 0.97), smoothstep(0.0, 0.4, ndl));

      rgb.addAssign(
        dusk
          .mul(lit)
          .mul(shade)
          .mul(1.9)
          .add(vec3(0.5, 0.62, 0.9).mul(0.012))
          .mul(W[R.realistic])
      );

      alpha.addAssign(d.mul(0.94).mul(W[R.realistic]));
    });

    If(W[R.cartoon].greaterThan(0.002), () => {
      const edge = smoothstep(0.44, 0.47, d);
      const core = smoothstep(0.5, 0.53, d);
      const under = smoothstep(0.78, 0.9, d); // thick centres catch the light
      const ndl = dot(cp, L);
      const lit = smoothstep(-0.05, 0.1, ndl);
      const body = mix(
        vec3(0.62, 0.55, 0.95),
        vec3(1.0),
        clamp(lit.mul(0.55).add(under.mul(0.5)), 0, 1)
      );

      rgb.addAssign(
        mix(vec3(0.16, 0.1, 0.62), body, core)
          .mul(edge)
          .mul(W[R.cartoon])
      );

      alpha.addAssign(edge.mul(W[R.cartoon]));
    });

    return vec4(rgb, alpha.mul(look.p.cloudAlpha.max(0.0)).mul(U.intro.sphere));
  });

  const cloudNode = cloudOut();

  cloudMat.colorNode = cloudNode.xyz.div(W[R.realistic].add(W[R.cartoon]).max(0.001));
  cloudMat.opacityNode = cloudNode.w;

  const clouds = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 128, 96), cloudMat);

  // --- Atmosphere ---
  const atmoMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmoColor = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const b = dot(ro, rd);
    const cc = dot(ro, ro);
    const rim = sqrt(max(cc.sub(b.mul(b)), 0)); // closest approach to the planet centre
    const outside = step(1.0, rim);
    const out = vec3(0).toVar();

    // --- realistic: ray-marched single scatter ---
    If(W[R.realistic].greaterThan(0.002), () => {
      const discA = b.mul(b).sub(cc.sub(ATMOS_RADIUS * ATMOS_RADIUS));
      const sA = sqrt(max(discA, 0));
      const t0 = max(b.negate().sub(sA), 0);
      const t1 = b.negate().add(sA);
      const discP = b.mul(b).sub(cc.sub(1.0));
      const tP = b.negate().sub(sqrt(max(discP, 0)));
      const hitsPlanet = discP.greaterThan(0).and(tP.greaterThan(0));
      const tEnd = hitsPlanet.select(tP, t1);
      const ds = max(tEnd.sub(t0), 0).div(10.0);
      const acc = vec3(0).toVar();
      const mieAcc = float(0).toVar();
      const cosT = dot(rd, L);
      const phaseMie = float(0.5)
        .mul(0.4224)
        .div(pow(float(1.5776).sub(float(1.52).mul(cosT)), 1.5));

      Loop(10, ({ i }) => {
        const pos = ro.add(rd.mul(t0.add(ds.mul(float(i).add(0.5)))));
        const h = clamp(
          length(pos)
            .sub(1.0)
            .div(ATMOS_RADIUS - 1.0),
          0,
          1
        );
        const dens = exp(h.mul(-5.5));
        const sn = dot(normalize(pos), L);
        const sunV = smoothstep(-0.2, 0.22, sn);
        const red = mix(vec3(1.0, 0.32, 0.1), vec3(1.0, 0.97, 0.92), smoothstep(-0.05, 0.45, sn));

        acc.addAssign(vec3(0.2, 0.5, 1.0).mul(red).mul(dens).mul(sunV).mul(ds));

        mieAcc.addAssign(dens.mul(sunV).mul(ds));
      });

      out.addAssign(
        acc
          .mul(9.0)
          .add(vec3(1.0, 0.86, 0.7).mul(mieAcc).mul(phaseMie).mul(3.0))
          .mul(W[R.realistic])
          .mul(look.p.atmos)
      );
    });

    // --- stylised limb glow for the other looks ---
    const gOut = exp(rim.sub(1.0).mul(-18.0)).mul(outside);
    const gIn = smoothstep(0.62, 1.0, rim).pow(4).mul(float(1).sub(outside));

    If(W[R.cartoon].greaterThan(0.002), () => {
      const halo = step(rim, 1.045).mul(outside);

      out.addAssign(vec3(0.55, 0.85, 1.0).mul(halo).mul(0.9).mul(W[R.cartoon]));
    });
    If(W[R.neon].greaterThan(0.002), () => {
      const hue = mix(
        vec3(1.0, 0.1, 0.62),
        vec3(0.1, 0.95, 0.95),
        clamp(rd.y.mul(0.5).add(0.5), 0, 1)
      );

      out.addAssign(
        hue
          .mul(gOut.mul(0.75).add(gIn.mul(0.3)))
          .mul(W[R.neon])
          .mul(look.p.atmos)
      );
    });
    If(W[R.hologram].greaterThan(0.002), () => {
      const sharp = exp(rim.sub(1.0).mul(-60.0)).mul(outside);

      out.addAssign(
        vec3(0.12, 0.85, 1.0)
          .mul(sharp.mul(1.3).add(gOut.mul(0.35)).add(gIn.mul(0.4)))
          .mul(W[R.hologram])
          .mul(look.p.atmos)
      );
    });

    return vec4(out.mul(U.atmos).mul(U.intro.atmo), 1);
  });

  atmoMat.colorNode = atmoColor();

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATMOS_RADIUS, 128, 96), atmoMat);

  globe.renderOrder = 0;
  clouds.renderOrder = 1;
  atmosphere.renderOrder = 2;

  const group = new THREE.Group();

  group.add(globe, clouds, atmosphere);

  return { group, globe, clouds, atmosphere };
}
