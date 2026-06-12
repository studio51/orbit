/* Orbit — projection & sun (shared by both renderers)
 *
 * Wraps d3.geoOrthographic but adds a hand-rolled fast forward-projection for
 * the thousands of land dots / spikes that must project every frame. d3's
 * generic pipeline allocates per point; here we precompute sin/cos(lat) and
 * lng(rad) once at build time and project with a few trig ops per point.
 *
 * Hot-loop layers read the public fields (lon0, sinLat0, cosLat0, cx, cy, R)
 * and inline the projection. Cold paths (HQ, source cities) use forward().
 *
 * The graticule and the night/core circles are cached: the graticule is fixed
 * config, and the night shapes only change when the sun moves (~1/s), so
 * nothing rebuilds GeoJSON per frame.
 *
 * Depends on the global `d3` (geo module).
 */
import { DEG } from './util.js';

export class Projection {
  #lastSun = -1e9;

  #graticule = null;

  #nightShape = null;

  #coreShape = null;

  constructor() {
    this.d3proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
    this.rotation = [-10, -25, 0]; // [lambda, phi, gamma]; start near Europe/Atlantic
    this.antisolar = [180, 0]; // night-hemisphere centre; moved by updateSun()

    this.R = 0;
    this.cx = 0;
    this.cy = 0;
    this.lon0 = 0;
    this.sinLat0 = 0;
    this.cosLat0 = 1;

    this.sun = { lon: 0, sinLat: 0, cosLat: 1, sinLon: 0, cosLon: 1 };

    this.setRotation(this.rotation[0], this.rotation[1], this.rotation[2]); // initial sync
  }

  setViewport(R, cx, cy) {
    this.R = R;
    this.cx = cx;
    this.cy = cy;

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

  // GeoJSON shapes for a d3.geoPath. The graticule is fixed; the night/core
  // circles are rebuilt only when the sun moves (see updateSun).
  graticule() {
    if (!this.#graticule) this.#graticule = d3.geoGraticule().step([20, 20])();

    return this.#graticule;
  }

  nightShape() {
    if (!this.#nightShape) this.#nightShape = d3.geoCircle().radius(90).center(this.antisolar)();

    return this.#nightShape;
  }

  coreShape() {
    if (!this.#coreShape) this.#coreShape = d3.geoCircle().radius(116).center(this.antisolar)();

    return this.#coreShape;
  }

  // Unit direction of the subsolar point in view space: x → screen right,
  // y → screen up (flip for canvas), z → toward the viewer. Lets renderers
  // place limb glare / scale daylight effects without d3 (and even when the
  // subsolar point is on the far hemisphere, where forward() returns null).
  sunDir() {
    const dlon = this.sun.lon - this.lon0;
    const cd = Math.cos(dlon),
      sd = Math.sin(dlon);

    return {
      x: this.sun.cosLat * sd,
      y: this.cosLat0 * this.sun.sinLat - this.sinLat0 * this.sun.cosLat * cd,
      z: this.sinLat0 * this.sun.sinLat + this.cosLat0 * this.sun.cosLat * cd,
    };
  }

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

    const lonR = lonDeg * DEG;

    this.sun.lon = lonR;
    this.sun.sinLon = Math.sin(lonR);
    this.sun.cosLon = Math.cos(lonR);
    this.sun.sinLat = Math.sin(declDeg * DEG);
    this.sun.cosLat = Math.cos(declDeg * DEG);

    this.antisolar = [lonDeg + 180, -declDeg];
    this.#nightShape = null; // rebuild lazily with the new centre
    this.#coreShape = null;
  }
}
