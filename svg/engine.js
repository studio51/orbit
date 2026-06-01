/* games.directory globe — SVG engine
 *
 * Owns the viewport, clock, rotation, drag, sun, an event bus, and an ordered
 * registry of render layers. Same public shape as the Canvas2D engine — but
 * there is NO clearRect: the SVG nodes persist between frames. Each layer
 * creates/looks-up its persistent nodes in build() and updates their
 * attributes in draw(). Visibility is not gated by the engine; instead each
 * layer toggles its own nodes' display/opacity from scene flags, driven by
 * applyScene() (ported from the original) on boot and on every scene change.
 *
 * Layer contract (see layers.js):
 *   { name, z, rebuildOn?, build(e), resize?(e), simulate?(e), draw(e) }
 */
import { Projection } from "../shared/geo.js";
import { SCENE_DEFAULTS, AURORA_SCHEMES } from "../shared/config.js";
import { ACTIVITY_TYPES } from "../shared/data.js";

export const SVGNS = "http://www.w3.org/2000/svg";

// SVG element factory (mirrors the original's `el` helper).
export function el(name, attrs) {
  const n = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export class Engine {
  constructor({ svg, scene, sim, data }) {
    this.svg = svg;
    this.defs = svg.querySelector("defs");
    this.scene = scene || { ...SCENE_DEFAULTS };
    this.sim = sim;
    this.data = data;

    // accurate geo-path generator for graticule / night terminator strings
    this.pathGen = null; // lazily created (needs d3 global) after proj exists

    // live per-activity state (colour/enabled/count), keyed by id
    this.state = { types: {} };
    (data.ACTIVITY_TYPES || ACTIVITY_TYPES).forEach((t) => {
      this.state.types[t.id] = Object.assign({ count: 0 }, t);
    });

    this.proj = new Projection();
    this.rotation = this.proj.rotation; // shared array
    this.pathGen = d3.geoPath(this.proj.d3proj);

    // viewport (CSS px)
    this.W = 0; this.H = 0; this.CX = 0; this.CY = 0; this.R = 0;

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
    const rect = this.svg.getBoundingClientRect();
    this.W = rect.width; this.H = rect.height;
    this.CX = this.W * 0.5; this.CY = this.H * 0.5;
    this.R = Math.min(this.W, this.H) * 0.36;
    this.svg.setAttribute("viewBox", "0 0 " + this.W + " " + this.H);
    this.proj.setViewport(this.R, this.CX, this.CY);
    this.resizeLayers();
  }

  // ---- per-activity counters ----------------------------------------
  onCount(fn) { this._hooks.push(fn); }
  bump(id) { for (const fn of this._hooks) fn(id); }

  // ---- scene → SVG element styles/display (ported from applyScene) --
  applyScene() {
    const scene = this.scene;
    const $ = (id) => document.getElementById(id);

    const landS = $("land-s"), landM = $("land-m"), landL = $("land-l");
    const base = scene.dotSize, tex = scene.texture;
    if (landS) landS.style.strokeWidth = (base * (1 - tex)).toFixed(2);
    if (landM) landM.style.strokeWidth = base.toFixed(2);
    if (landL) landL.style.strokeWidth = (base * (1 + tex * 1.5)).toFixed(2);
    const dotsEl = $("land-dots");
    if (dotsEl) dotsEl.style.opacity = scene.landBright;
    const graticuleEl = $("graticule");
    if (graticuleEl) graticuleEl.style.display = scene.grid ? "" : "none";

    const sphereGlow = $("sphere-glow"), bottomGlow = $("bottom-glow");
    if (sphereGlow) sphereGlow.style.opacity = (0.7 * scene.atmos).toFixed(2);
    if (bottomGlow) bottomGlow.style.opacity = scene.atmos.toFixed(2);

    const dn = scene.dayNight;
    const nightEl = $("night"), nightCoreEl = $("night-core"), citylightsLayer = $("citylights");
    if (nightEl) { nightEl.style.display = dn ? "" : "none"; nightEl.style.opacity = (0.55 * scene.darkness).toFixed(2); }
    if (nightCoreEl) { nightCoreEl.style.display = dn ? "" : "none"; nightCoreEl.style.opacity = (0.58 * scene.darkness).toFixed(2); }
    if (citylightsLayer) citylightsLayer.style.display = (dn && scene.cityLights) ? "" : "none";

    const auroraLayer = $("aurora");
    if (auroraLayer) auroraLayer.style.display = scene.aurora ? "" : "none";
    const sch = AURORA_SCHEMES[scene.auroraScheme] || AURORA_SCHEMES.gv;
    const aurNG = $("aur-n-g"), aurNV = $("aur-n-v"), aurSG = $("aur-s-g"), aurSV = $("aur-s-v");
    if (aurNG) aurNG.style.stroke = sch[0];
    if (aurSG) aurSG.style.stroke = sch[0];
    if (aurNV) aurNV.style.stroke = sch[1];
    if (aurSV) aurSV.style.stroke = sch[1];

    const spikesEl = $("spikes");
    if (spikesEl) { spikesEl.style.display = scene.corona ? "" : "none"; spikesEl.style.opacity = scene.coronaIntensity; }
    const nodesLayer = $("nodes");
    if (nodesLayer) nodesLayer.style.display = scene.nodes ? "" : "none";
    const orbitsFront = $("orbits-front"), orbitsBack = $("orbits-back");
    if (orbitsFront) orbitsFront.style.display = scene.orbits ? "" : "none";
    if (orbitsBack) orbitsBack.style.display = scene.orbits ? "" : "none";

    const shootingLayer = $("shooting");
    if (shootingLayer) shootingLayer.style.display = scene.shootingStars ? "" : "none";
  }

  // ---- main loop -----------------------------------------------------
  start() {
    this.build();    // create/look-up nodes first — resize() positions them
    this.resize();
    this.applyScene();
    window.addEventListener("resize", () => this.resize());
    this._bindDrag();
    // paint one correct frame immediately (RAF is paused while tab hidden)
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

    // shared frame values
    this.hq = this.proj.forward(this.data.HQ.lnglat);
    this.hqVisible = !!this.hq && this.proj.visible(this.data.HQ.lnglat);

    // no clearing — SVG nodes persist. simulate (state advance), then draw.
    for (const l of this.layers) {
      l.simulate && l.simulate(this);
      l.draw(this);
    }

    if (this.fps) this.fps.tick(now);
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- drag to spin --------------------------------------------------
  _bindDrag() {
    const c = this.svg, d = this._drag;
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
