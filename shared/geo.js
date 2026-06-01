/* games.directory globe — projection & sun (shared by both renderers)
 *
 * Wraps d3.geoOrthographic but adds a hand-rolled fast forward-projection for
 * the thousands of land dots / spikes that must project every frame. d3's
 * generic pipeline allocates per point; here we precompute sin/cos(lat) and
 * lng(rad) once at build time and project with a few trig ops per point.
 *
 * Hot-loop layers read the public fields (lon0, sinLat0, cosLat0, cx, cy, R)
 * and inline the projection. Cold paths (HQ, source cities) use forward().
 *
 * Depends on the global `d3` (geo module).
 */
import { DEG } from "./util.js";

export class Projection {
  #lastSun = -1e9;

  constructor() {
    this.d3proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
    this.rotation = [-10, -25, 0];                                      // [lambda, phi, gamma]; start near Europe/Atlantic
    this.antisolar = [180, 0];                                          // night-hemisphere centre; moved by updateSun()

    this.R = 0; this.cx = 0; this.cy = 0;
    this.lon0 = 0; this.sinLat0 = 0; this.cosLat0 = 1;

    this.sun = { lon: 0, sinLat: 0, cosLat: 1 };

    this.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]); // initial sync
  }

  setViewport(R, cx, cy) {
    this.R = R; this.cx = cx; this.cy = cy;
    this.d3proj.scale(R).translate([cx, cy]);
  }

  // Set the rotation and sync d3 + the cached fast-projection trig.
  setRotation(lambda, phi, gamma) {
    this.rotation[0] = lambda;
    if (phi !== undefined) this.rotation[1] = phi;
    if (gamma !== undefined) this.rotation[2] = gamma;

    this.d3proj.rotate(this.rotation);
    this.lon0 = -this.rotation[0] * DEG;
    const lat0 = -this.rotation[1] * DEG;
    this.sinLat0 = Math.sin(lat0);
    this.cosLat0 = Math.cos(lat0);
  }

  // Accurate projection of one point; null if on the far hemisphere.
  forward(lnglat) {
    return this.d3proj(lnglat);
  }

  // Is [lng,lat] on the visible hemisphere (with a small limb margin)?
  visible(lnglat) {
    const c = [-this.rotation[0], -this.rotation[1]];

    return d3.geoDistance(lnglat, c) < Math.PI / 2 - 0.04;
  }

  // GeoJSON shapes for a d3.geoPath. The projection applies the rotation, so
  // these depend only on fixed config (+ the antisolar centre for night/core).
  graticule()  { return d3.geoGraticule().step([20, 20])(); }
  nightShape() { return d3.geoCircle().radius(90).center(this.antisolar)(); }   // twilight edge
  coreShape()  { return d3.geoCircle().radius(116).center(this.antisolar)(); }  // deep-night core

  // Real subsolar point from the clock; recomputed ~1/s (the sun barely moves).
  updateSun(now) {
    if (now - this.#lastSun < 1000) return;

    this.#lastSun = now;
    
    const dt = new Date();
    const utc = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
    const lonDeg = -15 * (utc - 12);
    const start = Date.UTC(dt.getUTCFullYear(), 0, 0);
    const doy = Math.floor((dt - start) / 86400000);
    const declDeg = -23.44 * Math.cos((360 / 365) * (doy + 10) * DEG);
    
    this.sun.lon = lonDeg * DEG;
    this.sun.sinLat = Math.sin(declDeg * DEG);
    this.sun.cosLat = Math.cos(declDeg * DEG);

    this.antisolar = [lonDeg + 180, -declDeg];
  }
}
