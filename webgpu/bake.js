/* Orbit: one-time GPU bakes (WebGPU renderer)
 *
 * Everything about the planet that never changes frame to frame (biomes,
 * relief, ocean colour, the cloud field, the Milky Way) is evaluated here ONCE
 * on the GPU into equirectangular textures. The per-frame globe shader then
 * only samples them, which is what lets the Earth stay procedural and asset-free
 * without paying ~180 octaves of 3D noise per pixel per frame.
 *
 * Each bake is a full-screen pass into a half-float render target. The pass
 * receives the unit direction for every texel, so shader code written for the
 * sphere runs unchanged.
 */
import * as THREE from 'three/webgpu';
import {
  float,
  vec3,
  vec4,
  uv,
  texture,
  mix,
  smoothstep,
  clamp,
  max,
  abs,
  exp,
  sin,
  cos,
} from 'three/tsl';
import { fbm, sq } from './tsl-util.js';

const W = 2048; // main bake resolution (width); height is W / 2
const SKY_W = 1024; // the sky is smooth, so it bakes smaller

/**
 * Run a full-screen pass over the equirectangular domain into a render target.
 *
 * @param {THREE.WebGPURenderer} renderer an initialised renderer
 * @param {object} args pass description
 * @param {number} args.width target width (height is half)
 * @param {function(Node, Node): Node} args.fn builds the output vec4 from (unit direction, uv)
 * @param {boolean} [args.mips] generate mipmaps for the result
 * @returns {THREE.Texture} the baked texture (owned by an internal render target)
 */
function bake(renderer, { width, fn, mips = true }) {
  const rt = new THREE.RenderTarget(width, width / 2, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: mips,
    minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.anisotropy = 8;

  const lng = uv()
      .x.sub(0.5)
      .mul(Math.PI * 2),
    lat = uv().y.sub(0.5).mul(Math.PI);
  const p = vec3(cos(lat).mul(sin(lng)), sin(lat), cos(lat).mul(cos(lng)));
  const mat = new THREE.NodeMaterial();
  const quad = new THREE.QuadMesh(mat);

  mat.fragmentNode = fn(p, uv());

  const prev = renderer.getRenderTarget();

  renderer.setRenderTarget(rt);
  quad.render(renderer);
  renderer.setRenderTarget(prev);
  mat.dispose();
  rt.texture.userData.target = rt; // keeps the target reachable (disposal, debugging)

  return rt.texture;
}

/**
 * Bake every static planet and sky field.
 *
 * @param {THREE.WebGPURenderer} renderer an initialised renderer
 * @param {object} world the baked world masks ({ fieldTex })
 * @returns {object} the baked textures: `landTex` (albedo rgb + height a), `oceanTex`,
 *   `climTex` (arid, ice, patch, elevation), `miscTex` (cloud field, coast wobble),
 *   `milkyTex` and `nebulaTex` (static sky)
 */
export function bakePlanet(renderer, world) {
  const { fieldTex } = world;

  // Shared terrain fields (pure functions of the unit direction).
  const terrain = (p) => {
    const lat = abs(p.y);
    const elev = fbm(p.mul(2.6).add(vec3(3.1, 1.7, 4.2)), 6);
    const ridge = float(1)
      .sub(abs(fbm(p.mul(7.0), 4)))
      .pow(2);
    const height = elev.mul(0.55).add(ridge.mul(0.5).mul(smoothstep(-0.1, 0.45, elev)));
    const band = exp(sq(lat.sub(0.43).div(0.14)).negate());

    return { lat, elev, height, band };
  };

  // --- Land albedo (rgb) + height (a) ---
  const landTex = bake(renderer, {
    width: W,
    fn: (p, uvN) => {
      const { lat, elev, height, band } = terrain(p);
      const fld = texture(fieldTex, uvN).level(0);
      const cont = smoothstep(0.5, 0.95, fld.b);
      const arid = clamp(
        band
          .mul(1.15)
          .add(cont.mul(0.25))
          .add(fbm(p.mul(2.0).add(vec3(8, 2, 6)), 3).mul(0.4))
          .sub(0.2),
        0,
        1
      );
      const tropical = smoothstep(0.38, 0.0, lat).mul(float(1).sub(arid));
      const patch = fbm(p.mul(9.0), 3).mul(0.5).add(0.5);

      let land = mix(vec3(0.07, 0.15, 0.05), vec3(0.03, 0.105, 0.04), tropical);

      land = mix(land, vec3(0.22, 0.27, 0.09), patch.mul(0.65));

      const desert = mix(
        vec3(0.62, 0.46, 0.26),
        vec3(0.4, 0.22, 0.12),
        clamp(fbm(p.mul(5.0), 3).mul(0.5).add(0.5), 0, 1)
      );

      land = mix(land, desert, arid);
      land = mix(land, vec3(0.3, 0.31, 0.25), smoothstep(0.72, 0.84, lat.add(elev.mul(0.04))));
      land = mix(
        land,
        vec3(0.3, 0.27, 0.23),
        smoothstep(0.35, 0.7, height).mul(float(1).sub(arid.mul(0.5)))
      );

      const snowM = max(
        smoothstep(0.84, 0.9, lat.add(height.mul(0.05))),
        smoothstep(0.62, 0.85, height).mul(0.9)
      );

      land = mix(land, vec3(0.9, 0.93, 0.97), snowM);
      land = land.mul(fbm(p.mul(40.0), 3).mul(0.16).add(0.92));

      return vec4(land, height);
    },
  });

  // --- Ocean albedo: depth gradient off the shelf, plankton bloom, polar ice ---
  const oceanTex = bake(renderer, {
    width: W,
    fn: (p, uvN) => {
      const lat = abs(p.y);
      const sh = texture(fieldTex, uvN).level(0).r;
      const iceM = smoothstep(0.915, 0.955, lat.add(fbm(p.mul(14.0), 3).mul(0.03)));
      let ocean = mix(vec3(0.004, 0.022, 0.07), vec3(0.01, 0.09, 0.2), smoothstep(0.0, 0.3, sh));

      ocean = mix(ocean, vec3(0.03, 0.26, 0.34), smoothstep(0.25, 0.5, sh).mul(0.55));
      ocean = ocean.add(
        vec3(0.0, 0.02, 0.008).mul(smoothstep(0.35, 0.85, fbm(p.mul(5.0), 3).mul(0.5).add(0.5)))
      );
      ocean = mix(ocean, vec3(0.78, 0.86, 0.95), iceM);

      return vec4(ocean, 1);
    },
  });

  // --- Climate: arid, ice, patch, elevation (read by the cartoon / ink looks) ---
  const climTex = bake(renderer, {
    width: W,
    fn: (p, uvN) => {
      const { lat, elev, band } = terrain(p);
      const fld = texture(fieldTex, uvN).level(0);
      const cont = smoothstep(0.5, 0.95, fld.b);
      const arid = clamp(
        band
          .mul(1.15)
          .add(cont.mul(0.25))
          .add(fbm(p.mul(2.0).add(vec3(8, 2, 6)), 3).mul(0.4))
          .sub(0.2),
        0,
        1
      );
      const iceM = smoothstep(0.915, 0.955, lat.add(fbm(p.mul(14.0), 3).mul(0.03)));
      const patch = fbm(p.mul(4.0), 3).mul(0.5).add(0.5);

      return vec4(arid, iceM, patch, elev);
    },
  });

  // --- Misc: raw cloud field (r), coastline wobble (g) ---
  const miscTex = bake(renderer, {
    width: W,
    fn: (p) => {
      const warp = vec3(
        fbm(p.mul(1.5).add(vec3(5, 1, 3)), 3),
        fbm(p.mul(1.5).add(vec3(1, 7, 2)), 3),
        fbm(p.mul(1.5).add(vec3(9, 4, 8)), 3)
      );
      const base = fbm(p.mul(2.1).add(warp.mul(0.7)), 5)
        .mul(0.5)
        .add(0.5);
      const fine = fbm(p.mul(8.0).add(warp), 3).mul(0.14);
      const wobble = fbm(p.mul(95.0), 3).mul(0.5).add(0.5);

      return vec4(base.add(fine), wobble, 0, 1);
    },
  });

  // --- Static sky: Milky Way and nebula (stars are drawn live so they can twinkle) ---
  const galN = vec3(0.3, 0.86, 0.41).normalize();
  const milkyTex = bake(renderer, {
    width: SKY_W,
    mips: false,
    fn: (d) => {
      const gal = exp(sq(d.dot(galN).div(0.2)).negate());
      const dust = fbm(d.mul(3.4), 4).mul(0.5).add(0.5);

      return vec4(vec3(0.34, 0.4, 0.62).mul(gal).mul(dust.mul(dust)).mul(0.1), 1);
    },
  });
  const nebulaTex = bake(renderer, {
    width: SKY_W,
    mips: false,
    fn: (d) => {
      const neb = fbm(d.mul(1.6).add(vec3(4, 2, 7)), 4)
        .mul(0.5)
        .add(0.5);
      const tint = mix(
        vec3(0.08, 0.03, 0.16),
        vec3(0.02, 0.07, 0.17),
        fbm(d.mul(1.1), 3).mul(0.5).add(0.5)
      );

      return vec4(tint.mul(clamp(neb.sub(0.45).mul(2.2), 0, 1)).mul(0.55), 1);
    },
  });

  return { landTex, oceanTex, climTex, miscTex, milkyTex, nebulaTex };
}
