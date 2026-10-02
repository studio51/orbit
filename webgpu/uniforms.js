/* Orbit: shared shader uniforms (WebGPU renderer)
 *
 * One bag of live uniforms that every shader module reads. The engine writes
 * them each frame (clock, sun, scene settings, cinematic-arrival progress);
 * the modules only ever read, so there is no per-module plumbing.
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Create the shared uniform bag.
 *
 * @returns {object} uniforms: clock, sun, scene-setting scalars and intro-phase scalars
 */
export function createUniforms() {
  return {
    // --- Clock & light ---
    time: uniform(0), // seconds since start (frozen by pause is NOT applied; shaders keep living)
    sun: uniform(new THREE.Vector3(1, 0, 0)), // unit vector toward the subsolar point
    cloudRot: uniform(0), // cloud-shell rotation about +Y (radians); shadows need it too

    // --- Scene settings (mapped from the validated scene) ---
    atmos: uniform(1), // atmosphere strength multiplier
    darkness: uniform(0.55), // night-side darkness
    cityLights: uniform(1), // 0/1 toggle
    cityBright: uniform(1), // city light brightness
    sunGlint: uniform(1), // 0/1 ocean glint toggle
    sunGlare: uniform(1), // 0/1 limb glare toggle
    grid: uniform(0), // 0/1 lat-long grid toggle
    clouds: uniform(0.55), // cloud coverage 0..1
    nebula: uniform(1), // 0/1 nebula haze toggle
    twinkle: uniform(1), // 0/1 star twinkle toggle

    // --- Cinematic arrival, each 0..1 ---
    intro: {
      stars: uniform(1),
      sphere: uniform(1),
      atmo: uniform(1),
      land: uniform(1),
      lights: uniform(1),
    },
  };
}
