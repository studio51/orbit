/* games.directory globe — BaseEngine (shared by both renderers)
 *
 * All the backend-agnostic machinery lives here: the event bus, the ordered
 * layer registry, the clock, auto-rotation, the beam-spawn cadence, drag-to-spin,
 * the sun, and the per-activity counters. A renderer subclasses this and fills in
 * five small hooks for the bits that genuinely differ between Canvas and SVG:
 *
 *   _viewportRect()   → the element's bounding rect (sizing source)
 *   _resizeBackend()  → size the canvas / set the SVG viewBox
 *   _dragTarget()     → the element drag listeners attach to
 *   _render()         → paint one frame (canvas clears+draws; svg mutates nodes)
 *   applyScene()      → map scene → element styles (no-op for canvas)
 *
 * Layer contract:
 *   { name, z, rebuildOn?, build?(e), resize?(e), simulate?(e), visible?(e), draw(e) }
 */
import { Projection } from "./geo.js";
import { SCENE_DEFAULTS } from "./config.js";
import { ACTIVITY_TYPES } from "./data.js";

export class BaseEngine {
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

    // clock
    this.now = 0; this.dt = 0; this.frameCount = 0;
    this._last = 0; this._spawnAcc = 0;

    // per-frame shared values
    this.hq = null; this.hqVisible = false;

    this._drag = { active: false, x: 0, y: 0 };
    this.layers = [];
    this._byName = {};
    this._handlers = {};
    this._hooks = [];
  }

  // ---- events --------------------------------------------------------
  on(evt, fn) { (this._handlers[evt] || (this._handlers[evt] = [])).push(fn); }
  emit(evt, payload) { const h = this._handlers[evt]; if (h) for (const fn of h) fn(payload); }

  // ---- layers --------------------------------------------------------
  register(layer) {
    this.layers.push(layer);
    this._byName[layer.name] = layer;
    this.layers.sort((a, b) => a.z - b.z);
    return layer;
  }
  layer(name) { return this._byName[name]; }
  build() { for (const l of this.layers) l.build && l.build(this); }
  resizeLayers() { for (const l of this.layers) l.resize && l.resize(this); }
  rebuildFor(key) {
    for (const l of this.layers) {
      if (l.build && l.rebuildOn && l.rebuildOn.includes(key)) l.build(this);
    }
  }

  // ---- per-activity counters ----------------------------------------
  onCount(fn) { this._hooks.push(fn); }
  bump(id) { for (const fn of this._hooks) fn(id); }

  // ---- viewport ------------------------------------------------------
  resize() {
    const rect = this._viewportRect();
    this.W = rect.width; this.H = rect.height;
    this.CX = this.W * 0.5; this.CY = this.H * 0.5;
    this.R = Math.min(this.W, this.H) * 0.36;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._resizeBackend();
    this.proj.setViewport(this.R, this.CX, this.CY);
    this.resizeLayers();
  }

  // ---- main loop -----------------------------------------------------
  start() {
    this.build();          // create/look-up state & nodes first
    this.resize();         // size the viewport, then position layers
    this.applyScene();     // map scene → element styles (svg only)
    window.addEventListener("resize", () => this.resize());
    this._bindDrag();
    this.proj.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]);
    this.proj.updateSun(performance.now());
    requestAnimationFrame((t) => { this._last = t; this._frame(t); });
  }

  _frame(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now; this.now = now; this.dt = dt; this.frameCount++;

    const sim = this.sim;
    if (!sim.paused) {
      if (!this._drag.active) {
        this.rotation[0] += sim.rotSpeed * dt;
        if (this.rotation[0] > 180) this.rotation[0] -= 360;
        if (this.rotation[0] < -180) this.rotation[0] += 360;
      }
      this._spawnAcc += dt * sim.rate;
      let guard = 0;
      const beams = this._byName.beams;
      while (this._spawnAcc >= 1 && guard < 12) { beams && beams.spawn(this); this._spawnAcc -= 1; guard++; }
    }
    this.proj.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]);
    this.proj.updateSun(now);

    this.hq = this.proj.forward(this.data.HQ.lnglat);
    this.hqVisible = !!this.hq && this.proj.visible(this.data.HQ.lnglat);

    for (const l of this.layers) l.simulate && l.simulate(this);
    this._render();

    if (this.fps) this.fps.tick(now);
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- drag to spin --------------------------------------------------
  _bindDrag() {
    const c = this._dragTarget(), d = this._drag;
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
  _viewportRect() { throw new Error("_viewportRect not implemented"); }
  _resizeBackend() {}
  _dragTarget() { throw new Error("_dragTarget not implemented"); }
  _render() { throw new Error("_render not implemented"); }
  applyScene() {}
}
