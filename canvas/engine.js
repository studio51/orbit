/* games.directory globe — Canvas2D engine
 *
 * Owns the viewport, clock, rotation, drag, sun, an event bus, and an ordered
 * registry of render layers. Each frame it advances simulation, clears the
 * single canvas, and draws every visible layer in z-order. Because the canvas
 * is fully cleared each frame, layers are pure immediate-mode draws — no
 * persistent nodes, no per-frame DOM mutation. That is the core FPS win.
 *
 * Layer contract (see layers.js):
 *   { name, z, rebuildOn?, build?(e), resize?(e), simulate?(e), visible?(e), draw(e) }
 */
import { Projection } from "../shared/geo.js";
import { SCENE_DEFAULTS } from "../shared/config.js";
import { ACTIVITY_TYPES } from "../shared/data.js";

export class Engine {
  constructor({ canvas, scene, sim, data }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
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
    this.W = 0; this.H = 0; this.CX = 0; this.CY = 0; this.R = 0;
    this.dpr = 1;

    // clock
    this.now = 0; this.dt = 0; this.frameCount = 0;
    this._last = 0; this._spawnAcc = 0;

    // per-frame shared values
    this.hq = null; this.hqVisible = false;

    // drag
    this._drag = { active: false, x: 0, y: 0 };

    this.layers = [];
    this._byName = {};
    this._handlers = {};
    this._hooks = []; // callbacks fired after each count bump etc.
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

  // Rebuild only layers that declared a dependency on `key` (e.g. density).
  rebuildFor(key) {
    for (const l of this.layers) {
      if (l.build && l.rebuildOn && l.rebuildOn.includes(key)) l.build(this);
    }
  }

  // ---- viewport ------------------------------------------------------
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.W = rect.width; this.H = rect.height;
    this.CX = this.W * 0.5; this.CY = this.H * 0.5;
    this.R = Math.min(this.W, this.H) * 0.36;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.proj.setViewport(this.R, this.CX, this.CY);
    this.resizeLayers();
  }

  // ---- per-activity counters ----------------------------------------
  onCount(fn) { this._hooks.push(fn); }
  bump(id) { for (const fn of this._hooks) fn(id); }

  // ---- main loop -----------------------------------------------------
  start() {
    this.resize();
    this.build();
    window.addEventListener("resize", () => this.resize());
    this._bindDrag();
    // paint one correct frame immediately (RAF is paused while tab hidden)
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

    // shared frame values
    this.hq = this.proj.forward(this.data.HQ.lnglat);
    this.hqVisible = !!this.hq && this.proj.visible(this.data.HQ.lnglat);

    // simulate (state advance), then draw
    for (const l of this.layers) l.simulate && l.simulate(this);

    this.ctx.clearRect(0, 0, this.W, this.H);
    for (const l of this.layers) {
      if (l.visible && !l.visible(this)) continue;
      l.draw(this);
    }

    if (this.fps) this.fps.tick(now);
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- drag to spin --------------------------------------------------
  _bindDrag() {
    const c = this.canvas, d = this._drag;
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
}
