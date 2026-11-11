/* Orbit: shared TSL helpers (WebGPU renderer)
 *
 * Small node-graph building blocks reused by the Earth, sky and effect shaders:
 * coordinate conversion and the noise used by the one-time bakes.
 * Everything here returns TSL nodes; nothing touches the renderer.
 *
 * The noise helpers are for bake.js only. Per-frame shaders sample baked textures:
 * one octave of 3D noise per pixel costs more than a millisecond per megapixel.
 */
import * as THREE from 'three/webgpu';
import {
  vec2,
  vec3,
  sin,
  cos,
  atan,
  asin,
  mx_fractal_noise_float,
  mx_noise_float,
} from 'three/tsl';

const DEG = Math.PI / 180;

/**
 * Convert a `[lng, lat]` pair (degrees) to a unit vector in the globe frame.
 * The frame matches the Earth shader: +Y north, +Z toward (0°, 0°), +X toward 90°E.
 *
 * @param {number[]} lnglat longitude and latitude in degrees
 * @param {THREE.Vector3} [out] vector to write into
 * @returns {THREE.Vector3} the unit direction
 */
export function lnglatToVec3(lnglat, out = new THREE.Vector3()) {
  const lng = lnglat[0] * DEG,
    lat = lnglat[1] * DEG;

  return out.set(Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng));
}

/**
 * Square a node. Use instead of `pow(x, 2)`: `pow` is undefined for negative bases and
 * returns NaN on most GPUs (Metal happens to tolerate it, which hides the bug).
 *
 * @param {Node} x any numeric node
 * @returns {Node} x * x
 */
export const sq = (x) => x.mul(x);

/**
 * Fractal Perlin noise, roughly in [-1, 1].
 *
 * @param {Node} p vec3 sample position
 * @param {number} octaves octave count
 * @returns {Node} float node
 */
export const fbm = (p, octaves = 4) => mx_fractal_noise_float(p, octaves, 2.0, 0.5);

/**
 * Single-octave Perlin noise, roughly in [-1, 1].
 *
 * @param {Node} p vec3 sample position
 * @returns {Node} float node
 */
export const noise3 = (p) => mx_noise_float(p);

/**
 * Equirectangular texture coordinates for a unit direction.
 * Matches the baked textures: u = longitude, v = latitude.
 *
 * @param {Node} d vec3 unit direction
 * @returns {Node} vec2 uv in 0..1
 */
export const dirToUv = (d) =>
  vec2(
    atan(d.x, d.z)
      .div(Math.PI * 2)
      .add(0.5),
    asin(d.y.clamp(-1, 1)).div(Math.PI).add(0.5)
  );

/**
 * Rotate a vec3 around +Y.
 *
 * @param {Node} p vec3 node
 * @param {Node} a angle in radians
 * @returns {Node} rotated vec3
 */
export const rotateY = (p, a) =>
  vec3(p.x.mul(cos(a)).add(p.z.mul(sin(a))), p.y, p.x.mul(sin(a).negate()).add(p.z.mul(cos(a))));
