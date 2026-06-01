/* games.directory globe — BaseEngine (shared by both renderers)
 *
 * All the backend-agnostic machinery lives here: the event bus, the ordered
 * layer registry, the clock, auto-rotation, the beam-spawn cadence, drag-to-spin,
 * the sun, and the per-activity counters. A renderer subclasses this and fills in
 * five small hooks for the bits that genuinely differ between Canvas and SVG:
 *
 *   viewportRect()   → the element's bounding rect (sizing source)
 *   resizeBackend()  → size the canvas / set the SVG viewBox
 *   dragTarget()     → the element drag listeners attach to
 *   renderFrame()    → paint one frame (canvas clears+draws; svg mutates nodes)
 *   applyScene()     → map scene → element styles (no-op for canvas)
 *
 * Members written with `#` are true private state — internal to the engine and
 * not part of the API. The hooks above are deliberately public: they're the
 * subclass extension surface (`#`-private methods can't be overridden).
 *
 * Layer contract:
 *   { name, z, rebuildOn?, build?(e), resize?(e), simulate?(e), visible?(e), draw(e) }
 */
import { Projection } from "./geo.js";
import { SCENE_DEFAULTS } from "./config.js";
import { ACTIVITY_TYPES } from "./data.js";

export class BaseEngine {
  #handlers = {};
  #byName = {};
  #hooks = [];
  #drag = { active: false, x: 0, y: 0 };
  #spawnAcc = 0;
  #last = 0;

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
    this.rotation = this.proj.rotation; // shared array

    // viewport (CSS px)
    this.W = 0; this.H = 0; this.CX = 0; this.CY = 0; this.R = 0; this.dpr = 1;

    // clock + per-frame shared values
    this.now = 0; this.dt = 0; this.frameCount = 0;
    this.hq = null; this.hqVisible = false;

    this.layers = [];
  }

  // ---- events --------------------------------------------------------
  on(evt, fn) { (this.#handlers[evt] || (this.#handlers[evt] = [])).push(fn); }
  emit(evt, payload) { const h = this.#handlers[evt]; if (h) for (const fn of h) fn(payload); }

  // ---- layers --------------------------------------------------------
  register(layer) {
    this.layers.push(layer);
    this.#byName[layer.name] = layer;
    this.layers.sort((a, b) => a.z - b.z);
    return layer;
  }
  layer(name) { return this.#byName[name]; }
  build() { for (const l of this.layers) l.build && l.build(this); }
  resizeLayers() { for (const l of this.layers) l.resize && l.resize(this); }
  rebuildFor(key) {
    for (const l of this.layers) {
      if (l.build && l.rebuildOn && l.rebuildOn.includes(key)) l.build(this);
    }
  }

  // ---- per-activity counters ----------------------------------------
  onCount(fn) { this.#hooks.push(fn); }
  bump(id) { for (const fn of this.#hooks) fn(id); }

  // ---- viewport ------------------------------------------------------
  resize() {
    const rect = this.viewportRect();
    this.W = rect.width; this.H = rect.height;
    this.CX = this.W * 0.5; this.CY = this.H * 0.5;
    this.R = Math.min(this.W, this.H) * 0.36;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.resizeBackend();
    this.proj.setViewport(this.R, this.CX, this.CY);
    this.resizeLayers();
  }

  // ---- main loop -----------------------------------------------------
  start() {
    this.build();          // create/look-up state & nodes first
    this.resize();         // size the viewport, then position layers
    this.applyScene();     // map scene → element styles (svg only)
    window.addEventListener("resize", () => this.resize());
    this.#bindDrag();
    this.proj.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]);
    this.proj.updateSun(performance.now());
    requestAnimationFrame((t) => { this.#last = t; this.#frame(t); });
  }

  #frame(now) {
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now; this.now = now; this.dt = dt; this.frameCount++;

    const sim = this.sim;
    if (!sim.paused) {
      if (!this.#drag.active) {
        this.rotation[0] += sim.rotSpeed * dt;
        if (this.rotation[0] > 180) this.rotation[0] -= 360;
        if (this.rotation[0] < -180) this.rotation[0] += 360;
      }
      this.#spawnAcc += dt * sim.rate;
      let guard = 0;
      const beams = this.#byName.beams;
      while (this.#spawnAcc >= 1 && guard < 12) { beams && beams.spawn(this); this.#spawnAcc -= 1; guard++; }
    }
    this.proj.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]);
    this.proj.updateSun(now);

    this.hq = this.proj.forward(this.data.HQ.lnglat);
    this.hqVisible = !!this.hq && this.proj.visible(this.data.HQ.lnglat);

    for (const l of this.layers) l.simulate && l.simulate(this);
    this.renderFrame();

    if (this.fps) this.fps.tick(now);
    requestAnimationFrame((t) => this.#frame(t));
  }

  // ---- drag to spin --------------------------------------------------
  #bindDrag() {
    const c = this.dragTarget(), d = this.#drag;
    const pt = (e) => (e.touches ? e.touches[0] : e);
    const down = (e) => { d.active = true; const p = pt(e); d.x = p.clientX; d.y = p.clientY; c.classList.add("grabbing"); e.preventDefault(); };
    const move = (e) => {
      if (!d.active) return;
      const p = pt(e), k = 0.26;
      this.rotation[0] += (p.clientX - d.x) * k;
      this.rotation[1] = Math.max(-90, Math.min(90, this.rotation[1] - (p.clientY - d.y) * k));
      d.x = p.clientX; d.y = p.clientY;
    };
    const up = () => { d.active = false; c.classList.remove("grabbing"); };
    c.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    c.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  }

  // ---- backend hooks (overridden by subclasses) ---------------------
  viewportRect() { throw new Error("viewportRect not implemented"); }
  resizeBackend() {}
  dragTarget() { throw new Error("dragTarget not implemented"); }
  renderFrame() { throw new Error("renderFrame not implemented"); }
  applyScene() {}
}
