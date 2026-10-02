/* Orbit: camera rig (WebGPU renderer)
 *
 * Orbits a perspective camera around the globe. The globe never moves, so the
 * sun, clouds and beams stay in one frame and only the viewpoint travels:
 *
 *   • drag to spin, with fling inertia that decays back into auto-rotation
 *   • wheel / pinch to zoom (damped, clamped)
 *   • pointer parallax: the camera leans a few degrees toward the cursor
 *   • auto-rotate at `sim.rotSpeed` degrees per second
 *
 * `lng` / `lat` is the point on the Earth currently facing the camera.
 */
import { DEG } from '../shared/util.js';

const LOOK_DEG = 3.2; // max pointer-parallax lean
const ZOOM_MIN = 0.62; // closest, as a fraction of the fit distance
const ZOOM_MAX = 1.5; // farthest

export class OrbitRig {
  /**
   * Create the rig and bind its input listeners.
   *
   * @param {object} args rig inputs
   * @param {THREE.PerspectiveCamera} args.camera the camera to drive
   * @param {HTMLElement} args.element the element that receives pointer input
   * @param {object} args.sim live simulation settings (reads `paused`, `rotSpeed`)
   * @param {object} args.scene live scene settings (reads `parallax`)
   */
  constructor({ camera, element, sim, scene }) {
    this.camera = camera;
    this.element = element;
    this.sim = sim;
    this.scene = scene;

    this.lng = 10; // longitude facing the camera (degrees)
    this.lat = 22; // latitude facing the camera (degrees)
    this.fit = 3.4; // distance at which the globe fills the hero framing
    this.zoom = 1; // eased zoom multiplier
    this.zoomTarget = 1;
    this.fling = 0; // longitudinal fling velocity (deg/s)
    this.look = { x: 0, y: 0, tx: 0, ty: 0 }; // eased pointer-parallax offset (deg)
    this.dragging = false;

    this._pointers = new Map();
    this._last = { x: 0, y: 0, t: 0, vx: 0 };
    this._pinch = 0;

    this.#bind();
  }

  /**
   * Recompute the fit distance for a viewport so the globe keeps the same framing.
   *
   * @param {number} aspect width / height
   */
  setAspect(aspect) {
    const cam = this.camera;
    const tanHalf = Math.tan((cam.fov * DEG) / 2) * Math.min(1, aspect);

    this.fit = 1 / Math.sin(Math.atan(0.72 * tanHalf));
  }

  /**
   * Advance the rig and place the camera.
   *
   * @param {number} dt frame delta in seconds
   * @param {number} spinGain 0..1 auto-rotate multiplier (eases in during the intro)
   */
  update(dt, spinGain = 1) {
    if (!this.dragging) {
      if (this.fling) {
        this.lng -= this.fling * dt;
        this.fling *= Math.exp(-2.6 * dt);
        if (Math.abs(this.fling) < 0.25) this.fling = 0;
      }
      if (!this.sim.paused) this.lng -= this.sim.rotSpeed * dt * spinGain;
    }

    this.lng = ((((this.lng + 180) % 360) + 360) % 360) - 180;
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 7);

    const lk = this.look,
      ease = Math.min(1, dt * 2.5);
    const want = this.scene.parallax !== false && !this.dragging;

    lk.x += ((want ? lk.tx : 0) - lk.x) * ease;
    lk.y += ((want ? lk.ty : 0) - lk.y) * ease;

    const lng = (this.lng - lk.x) * DEG,
      lat = Math.max(-84, Math.min(84, this.lat - lk.y)) * DEG;
    const dist = this.fit * this.zoom;

    this.camera.position.set(
      Math.cos(lat) * Math.sin(lng) * dist,
      Math.sin(lat) * dist,
      Math.cos(lat) * Math.cos(lng) * dist
    );

    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Whether a globe-frame unit vector faces the camera (with a small limb margin).
   *
   * @param {THREE.Vector3} v unit direction in the globe frame
   * @returns {boolean} true when it is on the visible hemisphere
   */
  visible(v) {
    return v.dot(this.camera.position) / this.camera.position.length() > 0.06;
  }

  // --- Input ---
  #bind() {
    const el = this.element;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.fling = 0;
      this._last = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0 };
      el.classList.add('grabbing');

      if (this._pointers.size === 2) this._pinch = this.#pinchDist();
    });

    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();

      if (!this.dragging) {
        this.look.tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.look.ty = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        this.look.tx *= LOOK_DEG;
        this.look.ty *= LOOK_DEG;

        return;
      }
      if (!this._pointers.has(e.pointerId)) return;

      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size >= 2) {
        const d = this.#pinchDist();

        if (this._pinch) this.#zoomBy(this._pinch / d);
        this._pinch = d;

        return;
      }

      const k = 0.26 * Math.max(0.35, (this.zoom * this.fit - 1) / (this.fit - 1)),
        ddeg = (e.clientX - this._last.x) * k;
      const t = performance.now(),
        dts = Math.max(0.008, (t - this._last.t) / 1000);

      this.lng -= ddeg;
      this.lat = Math.max(-84, Math.min(84, this.lat + (e.clientY - this._last.y) * k));
      this._last.vx = this._last.vx * 0.75 + (ddeg / dts) * 0.25;
      this._last.x = e.clientX;
      this._last.y = e.clientY;
      this._last.t = t;
    });

    const up = (e) => {
      this._pointers.delete(e.pointerId);
      this._pinch = 0;
      if (this._pointers.size) return;

      this.dragging = false;
      el.classList.remove('grabbing');
      // recent movement → glide; stale velocity (held still) → no fling
      if (performance.now() - this._last.t < 90) {
        this.fling = Math.max(-200, Math.min(200, this._last.vx));
      }
    };

    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => {
      this.look.tx = 0;
      this.look.ty = 0;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();

        this.#zoomBy(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false }
    );
  }

  #zoomBy(f) {
    this.zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoomTarget * f));
  }

  #pinchDist() {
    const [a, b] = [...this._pointers.values()];

    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}
