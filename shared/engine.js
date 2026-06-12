/* Orbit — BaseEngine (shared by both renderers)
 *
 * All the backend-agnostic machinery lives here: the event bus, the ordered
 * layer registry, the clock, auto-rotation, the beam-spawn cadence, drag-to-spin
 * (with fling inertia), pointer parallax, the cinematic arrival sequence, the
 * city-surge scheduler, the sun, adaptive render quality, and the per-activity
 * counters. A renderer subclasses this and fills in five small hooks for the
 * bits that genuinely differ between Canvas and SVG:
 *
 *   viewportRect()   → the element's bounding rect (sizing source)
 *   resizeBackend()  → size the canvas / set the SVG viewBox
 *   dragTarget()     → the element drag listeners attach to
 *   renderFrame()    → paint one frame (canvas clears+draws; svg mutates nodes)
 *   applyScene()     → map scene → element styles (no-op for canvas)
 *
 * Adaptive quality: an EMA of raw frame time nudges `quality` (a multiplier on
 * the device-pixel ratio) down when frames run long and back up when there's
 * headroom, with a cooldown so it never oscillates. A resize re-bakes sprites
 * at the new backing resolution; CSS size never changes, so it's invisible
 * except as a slightly softer image on weak GPUs — and a steady 60fps.
 *
 * Cinematic arrival: `intro` ramps 0→1 over ~3.2s after start. Layers read
 * eased sub-windows of it via `introPhase(a, b)` to choreograph the bloom
 * (stars resolve → sphere fades up → atmosphere ignites → land blooms → beams
 * begin). When `scene.intro` is false, intro is pinned at 1.
 *
 * Pointer parallax: the pointer's position eases into a small look offset
 * that's ADDED to the rotation at projection time (never written back into
 * `rotation`), so the whole globe leans gently toward the cursor while drag
 * and auto-rotate stay untouched. `rotAcc` is the unwrapped, look-inclusive
 * longitude — background layers key their parallax off it.
 *
 * Members written with `#` are true private state — internal to the engine and
 * not part of the API. The hooks above are deliberately public: they're the
 * subclass extension surface (`#`-private methods can't be overridden).
 *
 * Layer contract:
 *   { name, z, rebuildOn?, build?(e), resize?(e), simulate?(e), visible?(e), draw(e) }
 */
import { Projection } from './geo.js';
import { SCENE_DEFAULTS } from './config.js';
import { ACTIVITY_TYPES } from './data.js';

const QUALITY_MIN = 0.55; // never drop below ~half-res backing store
const EMA_SLOW_MS = 21; // sustained frames slower than this → step down
const EMA_FAST_MS = 14.5; // sustained frames faster than this → step up
const COOLDOWN_FRAMES = 150; // min frames between quality changes (~2.5s)

const INTRO_MS = 3200; // cinematic arrival duration
const INTRO_BEAMS_AT = 0.85; // beams hold until the scene has mostly bloomed

const LOOK_DEG = 3.2; // max pointer-parallax lean, degrees
const SURGE_FIRST_MS = 35000; // first city surge after load
const SURGE_EVERY_MS = [50000, 90000]; // min..max between surges
const SURGE_LEN_MS = 6500; // how long a surge lasts

export class BaseEngine {
  #handlers = {};
  #byName = {};
  #hooks = [];
  #drag = { active: false, x: 0, y: 0, vx: 0, t: 0 };
  #fling = 0;
  #spawnAcc = 0;
  #last = 0;
  #ema = 16.7;
  #cooldown = 60;
  #introT0 = 0;
  #prevLam = null;
  #nextSurge = 0;

  constructor({ scene, sim, data }) {
    this.scene = scene || { ...SCENE_DEFAULTS };
    this.sim = sim;
    this.data = data;

    // live per-activity state (colour/enabled/count), keyed by id
    this.state = { types: {} };
    (data.ACTIVITY_TYPES || ACTIVITY_TYPES).forEach((t) => {
      this.state.types[t.id] = Object.assign({ count: 0 }, t);
    });

    this.proj = new Projection();
    this.rotation = this.proj.rotation.slice(); // engine-owned; proj gets rotation+look each frame

    // viewport (CSS px)
    this.W = 0;
    this.H = 0;
    this.CX = 0;
    this.CY = 0;
    this.R = 0;
    this.dpr = 1;
    this.quality = 1; // adaptive multiplier on dpr (see header note)

    // clock + per-frame shared values
    this.now = 0;
    this.dt = 0;
    this.frameCount = 0;
    this.hq = null;
    this.hqVisible = false;

    // cinematic arrival progress (0→1; pinned at 1 when scene.intro is off)
    this.intro = 1;

    // pointer parallax: target (set by pointermove) and eased current offset
    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    // unwrapped, look-inclusive longitude — parallax driver for background layers
    this.rotAcc = 0;

    // active city surge: { city, t0, until } or null
    this.surge = null;

    this.layers = [];
  }

  // ---- events --------------------------------------------------------
  on(evt, fn) {
    (this.#handlers[evt] || (this.#handlers[evt] = [])).push(fn);
  }
  emit(evt, payload) {
    const h = this.#handlers[evt];
    if (h) for (const fn of h) fn(payload);
  }

  // ---- layers --------------------------------------------------------
  register(layer) {
    this.layers.push(layer);
    this.#byName[layer.name] = layer;
    this.layers.sort((a, b) => a.z - b.z);
    return layer;
  }
  layer(name) {
    return this.#byName[name];
  }
  build() {
    for (const l of this.layers) l.build && l.build(this);
  }
  resizeLayers() {
    for (const l of this.layers) l.resize && l.resize(this);
  }
  rebuildFor(key) {
    for (const l of this.layers) {
      if (l.build && l.rebuildOn && l.rebuildOn.includes(key)) l.build(this);
    }
  }

  // ---- per-activity counters ----------------------------------------
  onCount(fn) {
    this.#hooks.push(fn);
  }
  bump(id) {
    for (const fn of this.#hooks) fn(id);
  }

  // ---- cinematic arrival ----------------------------------------------
  // Eased progress through the sub-window [a, b] of the intro (fractions of
  // INTRO_MS). Returns 1 once the intro is over — zero cost in steady state.
  introPhase(a, b) {
    if (this.intro >= 1) return 1;
    const p = (this.intro - a) / (b - a);
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return p * p * (3 - 2 * p); // smoothstep
  }
  replayIntro() {
    this.#introT0 = performance.now();
  }

  // ---- viewport ------------------------------------------------------
  resize() {
    const rect = this.viewportRect();
    this.W = rect.width;
    this.H = rect.height;
    this.CX = this.W * 0.5;
    this.CY = this.H * 0.5;
    this.R = Math.min(this.W, this.H) * 0.36;
    this.dpr = Math.min(2, window.devicePixelRatio || 1) * this.quality;
    this.resizeBackend();
    this.proj.setViewport(this.R, this.CX, this.CY);
    this.resizeLayers();
  }

  // ---- main loop -----------------------------------------------------
  start() {
    this.build(); // create/look-up state & nodes first
    this.resize(); // size the viewport, then position layers
    this.applyScene(); // map scene → element styles (svg only)
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.#last = performance.now();
    });
    this.#bindDrag();
    this.#bindPointer();
    this.#introT0 = performance.now();
    this.#nextSurge = performance.now() + SURGE_FIRST_MS;
    this.proj.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]);
    this.proj.updateSun(performance.now());
    requestAnimationFrame((t) => {
      this.#last = t;
      this.#frame(t);
    });
  }

  #frame(now) {
    const raw = now - this.#last;
    const dt = Math.min(0.05, raw / 1000);
    this.#last = now;
    this.now = now;
    this.dt = dt;
    this.frameCount++;

    this.#adaptQuality(raw);

    // cinematic arrival progress
    this.intro = this.scene.intro === false ? 1 : Math.min(1, (now - this.#introT0) / INTRO_MS);

    const sim = this.sim;
    if (!this.#drag.active) {
      // fling inertia glides on top of auto-rotation (works even when paused)
      if (this.#fling) {
        this.rotation[0] += this.#fling * dt;
        this.#fling *= Math.exp(-2.6 * dt);
        if (Math.abs(this.#fling) < 0.25) this.#fling = 0;
      }
      // rotation eases in from stillness during the arrival
      if (!sim.paused) this.rotation[0] += sim.rotSpeed * dt * this.introPhase(0, 0.8);
      if (this.rotation[0] > 180) this.rotation[0] -= 360;
      if (this.rotation[0] < -180) this.rotation[0] += 360;
    }

    // pointer parallax eases toward its target (or back to rest)
    const lk = this.look,
      ease = Math.min(1, dt * 2.5);
    const want = this.scene.parallax !== false && !this.#drag.active;
    lk.x += ((want ? lk.tx : 0) - lk.x) * ease;
    lk.y += ((want ? lk.ty : 0) - lk.y) * ease;

    // surges: occasionally one city erupts
    this.#scheduleSurge(now);

    if (!sim.paused && this.intro >= INTRO_BEAMS_AT) {
      const mult = this.surge ? 2.6 : 1;
      this.#spawnAcc += dt * sim.rate * mult;
      let guard = 0;
      const beams = this.#byName.beams;
      while (this.#spawnAcc >= 1 && guard < 12) {
        beams && beams.spawn(this);
        this.#spawnAcc -= 1;
        guard++;
      }
    } else this.#spawnAcc = 0;

    // displayed rotation = engine rotation + look offset (never written back)
    const lam = this.rotation[0] + lk.x;
    const phi = Math.max(-90, Math.min(90, this.rotation[1] + lk.y));
    this.proj.setRotation(lam, phi, this.rotation[2]);
    this.proj.updateSun(now);

    // unwrapped longitude for background parallax
    if (this.#prevLam === null) this.#prevLam = lam;
    let dr = lam - this.#prevLam;
    if (dr > 180) dr -= 360;
    else if (dr < -180) dr += 360;
    this.rotAcc += dr;
    this.#prevLam = lam;

    this.hq = this.proj.forward(this.data.HQ.lnglat);
    this.hqVisible = !!this.hq && this.proj.visible(this.data.HQ.lnglat);

    for (const l of this.layers) l.simulate && l.simulate(this);
    this.renderFrame();

    if (this.fps) this.fps.tick(now);
    requestAnimationFrame((t) => this.#frame(t));
  }

  // ---- surges ----------------------------------------------------------
  #scheduleSurge(now) {
    if (this.surge && now > this.surge.until) this.surge = null;
    if (this.surge || this.sim.paused || this.intro < 1) return;
    if (this.scene.surges === false || now < this.#nextSurge) return;
    // pick a city on the visible hemisphere
    const cities = this.data.CITIES;
    for (let k = 0; k < 10; k++) {
      const c = cities[(Math.random() * cities.length) | 0];
      if (this.proj.visible(c.lnglat)) {
        this.surge = { city: c, t0: now, until: now + SURGE_LEN_MS };
        this.emit('surge', { city: c });
        break;
      }
    }
    this.#nextSurge =
      now + SURGE_EVERY_MS[0] + Math.random() * (SURGE_EVERY_MS[1] - SURGE_EVERY_MS[0]);
  }

  // EMA of raw frame time → nudge quality down/up with hysteresis + cooldown.
  #adaptQuality(rawMs) {
    if (rawMs <= 0 || rawMs > 250) return; // tab was hidden / first frame
    this.#ema += (Math.min(rawMs, 80) - this.#ema) * 0.05;
    if (--this.#cooldown > 0) return;
    if (this.#ema > EMA_SLOW_MS && this.quality > QUALITY_MIN) {
      this.quality = Math.max(QUALITY_MIN, this.quality - 0.15);
      this.#cooldown = COOLDOWN_FRAMES;
      this.resize();
    } else if (this.#ema < EMA_FAST_MS && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.15);
      this.#cooldown = COOLDOWN_FRAMES * 2; // step up more cautiously
      this.resize();
    }
  }

  // ---- pointer parallax ------------------------------------------------
  #bindPointer() {
    window.addEventListener('mousemove', (e) => {
      if (this.#drag.active || !this.W) return;
      this.look.tx = ((e.clientX / this.W) * 2 - 1) * LOOK_DEG;
      this.look.ty = -((e.clientY / this.H) * 2 - 1) * LOOK_DEG;
    });
    window.addEventListener('mouseleave', () => {
      this.look.tx = 0;
      this.look.ty = 0;
    });
  }

  // ---- drag to spin (with fling) --------------------------------------
  #bindDrag() {
    const c = this.dragTarget(),
      d = this.#drag;
    const pt = (e) => (e.touches ? e.touches[0] : e);
    const down = (e) => {
      d.active = true;
      this.#fling = 0;
      const p = pt(e);
      d.x = p.clientX;
      d.y = p.clientY;
      d.vx = 0;
      d.t = performance.now();
      c.classList.add('grabbing');
      e.preventDefault();
    };
    const move = (e) => {
      if (!d.active) return;
      const p = pt(e),
        k = 0.26;
      const ddeg = (p.clientX - d.x) * k;
      this.rotation[0] += ddeg;
      this.rotation[1] = Math.max(-90, Math.min(90, this.rotation[1] - (p.clientY - d.y) * k));
      const t = performance.now(),
        dts = Math.max(0.008, (t - d.t) / 1000);
      d.vx = d.vx * 0.75 + (ddeg / dts) * 0.25; // smoothed angular velocity (°/s)
      d.x = p.clientX;
      d.y = p.clientY;
      d.t = t;
    };
    const up = () => {
      if (!d.active) return;
      d.active = false;
      c.classList.remove('grabbing');
      // recent movement → glide; stale velocity (held still) → no fling
      if (performance.now() - d.t < 90) this.#fling = Math.max(-200, Math.min(200, d.vx));
    };
    c.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    c.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  // ---- backend hooks (overridden by subclasses) ---------------------
  viewportRect() {
    throw new Error('viewportRect not implemented');
  }
  resizeBackend() {}
  dragTarget() {
    throw new Error('dragTarget not implemented');
  }
  renderFrame() {
    throw new Error('renderFrame not implemented');
  }
  applyScene() {}
}
