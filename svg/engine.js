/* games.directory globe — SVG engine
 *
 * Thin subclass of BaseEngine (shared/engine.js). The SVG-specific hooks: nodes
 * persist between frames (no clear), so renderFrame() just lets every layer mutate
 * its nodes, and applyScene() maps scene flags → element display/opacity.
 *
 * Depends on the global `d3` (geoPath for graticule/terminator strings).
 */
import { BaseEngine } from "../shared/engine.js";
import { AURORA_SCHEMES } from "../shared/config.js";

export const SVGNS = "http://www.w3.org/2000/svg";

// SVG element factory.
export function el(name, attrs) {
  const n = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export class Engine extends BaseEngine {
  constructor(opts) {
    super(opts);
    this.svg = opts.svg;
    this.defs = opts.svg.querySelector("defs");
    this.pathGen = d3.geoPath(this.proj.d3proj); // geo-path strings for graticule/night
  }

  viewportRect() { return this.svg.getBoundingClientRect(); }
  resizeBackend() { this.svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`); }
  dragTarget() { return this.svg; }
  renderFrame() { for (const l of this.layers) l.draw(this); }

  // ---- scene → SVG element styles/display ---------------------------
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
}
