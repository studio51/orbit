/* Orbit: looks (WebGPU renderer)
 *
 * A "look" is a complete art direction for the globe. Every look is described
 * by plain data here (numeric params + colours); the shaders read them through
 * live uniforms, and `LookState` eases those uniforms toward the active look so
 * switching looks is a smooth cross-fade rather than a pop.
 *
 * Each look also owns one *weight* uniform. The Earth, sky, beams and cloud
 * shaders evaluate a look's branch only while its weight is above zero, so
 * the steady-state cost is that of a single look.
 *
 * Adding a look = add an entry to shared/looks.js, then add its branch in earth.js /
 * sky.js / beams.js (the look's index is its position in `LOOKS`).
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { LOOKS, LOOK_INDEX } from '../shared/looks.js';

export { LOOKS, LOOK_INDEX };

/**
 * Live look state: weight uniforms plus eased numeric and colour uniforms.
 */
export class LookState {
  /**
   * Create uniforms for every look param/colour, starting on one look.
   *
   * @param {string} startId id of the look to start on
   */
  constructor(startId = 'realistic') {
    const start = LOOKS[LOOK_INDEX[startId] ?? 0];

    this.id = start.id;
    this.weights = LOOKS.map((l) => uniform(l.id === start.id ? 1 : 0)); // per-look blend weight
    this.target = LOOKS.map((l) => (l.id === start.id ? 1 : 0));

    this.p = {}; // numeric params, eased toward the active look
    for (const k of Object.keys(start.params)) this.p[k] = uniform(start.params[k]);

    this.c = {}; // palette colours, eased toward the active look
    for (const k of Object.keys(start.colors))
      this.c[k] = uniform(new THREE.Color(start.colors[k]));

    this.speed = 3.2; // ease rate (1/s); higher = snappier cross-fade
  }

  /**
   * Switch to another look; the uniforms ease there over ~1s.
   *
   * @param {string} id the look id to blend toward
   * @returns {boolean} whether the id was a known look
   */
  set(id) {
    if (!(id in LOOK_INDEX)) return false;

    this.id = id;
    this.target = LOOKS.map((l) => (l.id === id ? 1 : 0));

    return true;
  }

  /**
   * Whether a look is contributing (weight above zero), used to skip idle work.
   *
   * @param {string} id the look id
   * @returns {boolean} true while the look has any visible weight
   */
  active(id) {
    return this.weights[LOOK_INDEX[id]].value > 0.002;
  }

  /**
   * Ease every uniform toward the active look.
   *
   * @param {number} dt frame delta in seconds
   */
  update(dt) {
    const k = 1 - Math.exp(-this.speed * dt);
    const to = LOOKS[LOOK_INDEX[this.id]];

    this.weights.forEach((u, i) => {
      const v = u.value + (this.target[i] - u.value) * k;

      u.value = Math.abs(this.target[i] - v) < 0.002 ? this.target[i] : v;
    });

    for (const key of Object.keys(this.p)) {
      this.p[key].value += (to.params[key] - this.p[key].value) * k;
    }

    for (const key of Object.keys(this.c)) {
      this.c[key].value.lerp(_tmp.set(to.colors[key]), k);
    }
  }
}

const _tmp = new THREE.Color();
