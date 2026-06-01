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
  constructor() {
    this.d3proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
    this.path = d3.geoPath(this.d3proj);                                // geo-path strings for graticule/night
    this._graticule = d3.geoGraticule().step([20, 20]);
    this._night = d3.geoCircle().radius(90);                            // twilight edge
    this._core = d3.geoCircle().radius(116);                            // deep-night core
    this.rotation = [-10, -25, 0];                                      // [lambda, phi, gamma]; start near Europe/Atlantic

    this.R = 0; this.cx = 0; this.cy = 0;
    this.lon0 = 0; this.sinLat0 = 0; this.cosLat0 = 1;

    this.sun = { lon: 0, sinLat: 0, cosLat: 1 };
    this._lastSun = -1e9;

    this._applyRotation();
  }

  setViewport(R, cx, cy) {
    this.R = R; this.cx = cx; this.cy = cy;
    this.d3proj.scale(R).translate([cx, cy]);
  }

  setRotation(lambda, phi, gamma) {
    this.rotation[0] = lambda;
    
    if (phi !== undefined) this.rotation[1] = phi;
    if (gamma !== undefined) this.rotation[2] = gamma;
    
    this._applyRotation();
  }

  _applyRotation() {
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

  graticule() { return this._graticule(); }
  nightShape() { return this._night(); }
  coreShape() { return this._core(); }

  // Real subsolar point from the clock; recomputed ~1/s (the sun barely moves).
  updateSun(now) {
    if (now - this._lastSun < 1000) return;
    
    this._lastSun = now;
    
    const dt = new Date();
    const utc = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
    const lonDeg = -15 * (utc - 12);
    const start = Date.UTC(dt.getUTCFullYear(), 0, 0);
    const doy = Math.floor((dt - start) / 86400000);
    const declDeg = -23.44 * Math.cos((360 / 365) * (doy + 10) * DEG);
    
    this.sun.lon = lonDeg * DEG;
    this.sun.sinLat = Math.sin(declDeg * DEG);
    this.sun.cosLat = Math.cos(declDeg * DEG);

    this._night.center([lonDeg + 180, -declDeg]);
    this._core.center([lonDeg + 180, -declDeg]);
  }
}
