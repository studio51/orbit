/* Orbit: shared TSL helpers (WebGPU renderer)
 *
 * Small node-graph building blocks reused by the Earth, sky and effect shaders:
 * coordinate conversion, hashing, fractal noise and unparametrised bump mapping.
 * Everything here returns TSL nodes; nothing touches the renderer.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  hash,
  floor,
  fract,
  dot,
  cross,
  normalize,
  abs,
  sign,
  sin,
  cos,
  atan,
  asin,
  dFdx,
  dFdy,
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
 * Hash a vec3 lattice cell to a float in [0, 1).
 *
 * @param {Node} cell vec3 integer-valued cell id
 * @returns {Node} float node
 */
export const hash3 = (cell) =>
  hash(cell.x.add(2048).add(cell.y.add(2048).mul(131)).add(cell.z.add(2048).mul(17389)));

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

/**
 * Perturb a normal from a scalar height field using screen-space derivatives
 * (Mikkelsen's unparametrised bump mapping), so it works on any surface.
 *
 * @param {Node} P vec3 surface position
 * @param {Node} N vec3 geometric normal
 * @param {Node} h float height
 * @param {Node} scale bump strength
 * @returns {Node} perturbed unit normal
 */
export const bumpNormal = Fn(([P, N, h, scale]) => {
  const dpdx = dFdx(P),
    dpdy = dFdy(P);
  const r1 = cross(dpdy, N),
    r2 = cross(N, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(dFdx(h).mul(r1).add(dFdy(h).mul(r2)));

  return normalize(abs(det).mul(N).sub(scale.mul(grad)));
});

/**
 * A twinkling point-star field over a direction vector.
 * Cells on a 3D lattice each hold at most one star at a jittered position.
 *
 * @param {Node} dir vec3 unit view direction
 * @param {number} density lattice frequency (higher = smaller, more numerous cells)
 * @param {number} rarity 0..1 chance threshold (higher = fewer stars)
 * @param {Node} time float seconds, drives the twinkle
 * @returns {{ star: Node, tint: Node }} intensity (float) and a cool/warm tint (vec3)
 */
export const starField = (dir, density, rarity, time) => {
  const g = dir.mul(density);
  const cell = floor(g);
  const f = fract(g).sub(0.5);
  const jitter = vec3(
    hash3(cell.add(vec3(1.7, 0.0, 0.0))),
    hash3(cell.add(vec3(0.0, 3.1, 0.0))),
    hash3(cell.add(vec3(0.0, 0.0, 5.3)))
  )
    .sub(0.5)
    .mul(0.7);
  const d = f.sub(jitter).length();
  const roll = hash3(cell);
  const present = roll.greaterThan(rarity).select(float(1), float(0));
  const mag = roll.sub(rarity).div(float(1).sub(rarity)).max(0).pow(3);
  const size = mag.mul(0.1).add(0.035);
  const tw = sin(time.mul(hash3(cell.add(9.0)).mul(3).add(1)).add(roll.mul(80)))
    .mul(0.25)
    .add(0.75);
  const star = float(1)
    .sub(d.div(size).clamp(0, 1))
    .pow(2)
    .mul(present)
    .mul(mag.mul(2.2).add(0.35))
    .mul(tw);
  const warm = hash3(cell.add(21.0));
  const tint = vec3(0.7, 0.8, 1.0).mix(vec3(1.0, 0.78, 0.55), warm.pow(2));

  return { star, tint };
};
