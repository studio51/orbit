/* Orbit — geometry (shared by both renderers)
 *
 * Pure functions that turn the projection + scene into coordinates. No DOM, no
 * canvas, no rendering — each renderer takes these points/arrays and paints them
 * its own way. Depends on the global `d3` (geoContains) for land-dot seeding.
 *
 * Perf notes:
 *   • Land dots / spikes precompute sin/cos of BOTH lat and lng at build time,
 *     so the per-frame projection needs zero trig calls per point — just a few
 *     multiplies (cos/sin of a longitude difference via the angle-sum identity).
 *   • Land dots are sorted by relief tier at build time (`tierEnd` ranges), so
 *     the renderer draws each tier as one contiguous run with one fillStyle and
 *     no per-dot branch.
 *   • The aurora samples fixed longitudes, so their sin/cos live in a table.
 */
import { DEG, TAU } from './util.js';
import { AURORA_SCHEMES } from './config.js';

// ---- beam arc (screen-space lifted quadratic) --------------------------
export function arcControl(a, b, CX, CY, R) {
  const mx = (a[0] + b[0]) / 2,
    my = (a[1] + b[1]) / 2;
  const vx = mx - CX,
    vy = my - CY,
    vlen = Math.hypot(vx, vy) || 1;
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lift = Math.min(R * 0.9, dist * 0.42 + R * 0.12);

  return [mx + (vx / vlen) * lift, my + (vy / vlen) * lift];
}
// De Casteljau split of the quadratic (p0,cp,p1) at t → the partial curve's
// control point (ax,ay) and its endpoint / beam head (hx,hy).
export function quadSplit(p0, cp, p1, t) {
  const ax = p0[0] + (cp[0] - p0[0]) * t,
    ay = p0[1] + (cp[1] - p0[1]) * t;
  const bx = cp[0] + (p1[0] - cp[0]) * t,
    by = cp[1] + (p1[1] - cp[1]) * t;

  return { ax, ay, hx: ax + (bx - ax) * t, hy: ay + (by - ay) * t };
}
// Point on the quadratic at parameter u.
export function quadPoint(p0, cp, p1, u) {
  const iu = 1 - u;

  return [
    iu * iu * p0[0] + 2 * iu * u * cp[0] + u * u * p1[0],
    iu * iu * p0[1] + 2 * iu * u * cp[1] + u * u * p1[1],
  ];
}

// ---- dotted land -------------------------------------------------------
// Returns tier-SORTED arrays (small → large) plus `tierEnd` — the exclusive
// end index of each tier — so renderers can draw contiguous runs. The legacy
// fields (`lng`, `tier`) are kept for compatibility with the SVG build.
export function buildLandDots(feature, step) {
  const recs = [];

  for (let lat = -84; lat <= 84; lat += step) {
    const ringStep = step / Math.max(0.18, Math.cos(lat * DEG));

    for (let l = -180; l < 180; l += ringStep) {
      if (!d3.geoContains(feature, [l, lat])) continue;

      const latR = lat * DEG,
        lngR = l * DEG;
      const r = Math.random();

      recs.push({
        sin: Math.sin(latR),
        cos: Math.cos(latR),
        lng: lngR,
        sinLng: Math.sin(lngR),
        cosLng: Math.cos(lngR),
        city: Math.random() < 0.45 ? 1 : 0,
        grp: (Math.random() * 3) | 0,
        tier: r < 0.46 ? 0 : r < 0.83 ? 1 : 2,
        pt: [l, lat],
      });
    }
  }
  recs.sort((a, b) => a.tier - b.tier);

  const n = recs.length;
  const d = {
    sin: new Float32Array(n),
    cos: new Float32Array(n),
    lng: new Float32Array(n),
    sinLng: new Float32Array(n),
    cosLng: new Float32Array(n),
    isCity: new Uint8Array(n),
    grp: new Uint8Array(n),
    tier: new Uint8Array(n),
    tierEnd: [0, 0, n],
    n,
    pts: new Array(n),
  };

  for (let i = 0; i < n; i++) {
    const r = recs[i];

    d.sin[i] = r.sin;
    d.cos[i] = r.cos;
    d.lng[i] = r.lng;
    d.sinLng[i] = r.sinLng;
    d.cosLng[i] = r.cosLng;
    d.isCity[i] = r.city;
    d.grp[i] = r.grp;
    d.tier[i] = r.tier;
    d.pts[i] = r.pt;
    if (r.tier === 0) d.tierEnd[0] = i + 1;
    if (r.tier <= 1) d.tierEnd[1] = i + 1;
  }

  return d;
}

// ---- corona spikes -----------------------------------------------------
export function buildSpikes(step = 7) {
  const sinA = [],
    cosA = [],
    lngA = [],
    sinLngA = [],
    cosLngA = [],
    lenA = [],
    phA = [];

  for (let lat = -86; lat <= 86; lat += step) {
    const ringStep = step / Math.max(0.16, Math.cos(lat * DEG));

    for (let l = -180; l < 180; l += ringStep) {
      const latR = lat * DEG,
        lngR = l * DEG;

      sinA.push(Math.sin(latR));
      cosA.push(Math.cos(latR));
      lngA.push(lngR);
      sinLngA.push(Math.sin(lngR));
      cosLngA.push(Math.cos(lngR));
      lenA.push(0.25 + Math.random() * 0.95);
      phA.push(Math.random() * TAU);
    }
  }

  return {
    sin: Float32Array.from(sinA),
    cos: Float32Array.from(cosA),
    lng: Float32Array.from(lngA),
    sinLng: Float32Array.from(sinLngA),
    cosLng: Float32Array.from(cosLngA),
    lenF: Float32Array.from(lenA),
    phase: Float32Array.from(phA),
    n: sinA.length,
  };
}

// ---- star nodes --------------------------------------------------------
export function pickNodes(pts, count = 18) {
  const nodes = [];

  if (!pts || !pts.length) return nodes;
  for (let i = 0; i < count; i++) {
    nodes.push({
      ll: pts[(Math.random() * pts.length) | 0],
      phase: Math.random() * TAU,
      sp: 1.5 + Math.random() * 2.5,
      size: 1.3 + Math.random() * 1.6,
    });
  }

  return nodes;
}

// ---- orbital rings -----------------------------------------------------
export const ORBIT_DEFS = [
  { rf: 1.16, incl: 1.15, yaw0: 0.4, spin: 0.05, sat: true },
  { rf: 1.24, incl: 0.6, yaw0: 2.1, spin: -0.035, sat: false },
  { rf: 1.1, incl: 1.45, yaw0: 1.2, spin: 0.06, sat: true },
  { rf: 1.32, incl: 0.95, yaw0: 3.0, spin: -0.025, sat: false },
  { rf: 1.19, incl: 0.3, yaw0: 0.8, spin: 0.04, sat: false },
];
// Front/back point lists for one ring at time `now`. o = index (drives sat phase).
export function computeOrbit(cfg, o, R, CX, CY, now, N = 84) {
  const Rr = R * cfg.rf;
  const ci = Math.cos(cfg.incl),
    si = Math.sin(cfg.incl);
  const yaw = cfg.yaw0 + now * 0.001 * cfg.spin * 6;
  const cy_ = Math.cos(yaw),
    sy = Math.sin(yaw);
  const front = [],
    back = [];
  let fSeg = null,
    bSeg = null,
    sat = null;
  const satIdx = (((now * 0.0004 * (o + 1)) % 1) * N) | 0;

  for (let k = 0; k <= N; k++) {
    const a = (k / N) * TAU;
    const x0 = Math.cos(a),
      y0 = Math.sin(a);
    const y1 = y0 * ci,
      z1 = y0 * si,
      x1 = x0; // tilt around X (z0 = 0)
    const x2 = x1 * cy_ + z1 * sy,
      z2 = -x1 * sy + z1 * cy_,
      y2 = y1; // spin around Y
    const sx = CX + x2 * Rr,
      syc = CY - y2 * Rr;

    if (z2 >= 0) {
      if (!fSeg) {
        fSeg = [];
        front.push(fSeg);
      }
      fSeg.push(sx, syc);
      bSeg = null;
    } else {
      if (!bSeg) {
        bSeg = [];
        back.push(bSeg);
      }
      bSeg.push(sx, syc);
      fSeg = null;
    }
    if (cfg.sat && k === satIdx) sat = { x: sx, y: syc, front: z2 >= 0 };
  }

  return { front, back, sat };
}

// ---- aurora ------------------------------------------------------------
export function auroraSpecs(scene) {
  const sch = AURORA_SCHEMES[scene.auroraScheme] || AURORA_SCHEMES.gv;
  const bl = scene.auroraLat;

  return [
    { lat: bl, amp: 4.5, phase: 0, col: sch[0], width: 5.5, op0: 0.34, opPh: 0 },
    { lat: bl + 2.5, amp: 5.5, phase: 1.6, col: sch[1], width: 3.5, op0: 0.3, opPh: 1.7 },
    { lat: -bl, amp: 4.5, phase: 2.4, col: sch[0], width: 5.5, op0: 0.34, opPh: 3.1 },
    { lat: -bl - 2.5, amp: 5.5, phase: 3.9, col: sch[1], width: 3.5, op0: 0.3, opPh: 4.6 },
  ];
}

// Fixed longitude sample points for the aurora bands (4° apart) — their sin/cos
// never change, so they live in a build-once table.
const AUR_N = 91;
const AUR_LNG = new Float64Array(AUR_N),
  AUR_SIN = new Float64Array(AUR_N),
  AUR_COS = new Float64Array(AUR_N);

for (let i = 0; i < AUR_N; i++) {
  const lngR = (-180 + i * 4) * DEG;

  AUR_LNG[i] = lngR;
  AUR_SIN[i] = Math.sin(lngR);
  AUR_COS[i] = Math.cos(lngR);
}
// Front-only polyline segments for one band (split where it crosses the limb).
export function auroraSegments(proj, CX, CY, R, baseLat, amp, phase, now, speed) {
  const { lon0, sinLat0, cosLat0 } = proj;
  const cosLon0 = Math.cos(lon0),
    sinLon0 = Math.sin(lon0);
  const t = now * 0.0006 * speed;
  const segs = [];
  let seg = null;

  for (let i = 0; i < AUR_N; i++) {
    const lngR = AUR_LNG[i];
    const lat =
      baseLat +
      amp * Math.sin(lngR * 3 + t * 6 + phase) +
      amp * 0.5 * Math.sin(lngR * 7 - t * 4 + phase);
    const latR = lat * DEG,
      sinL = Math.sin(latR),
      cosL = Math.cos(latR);
    const cd = AUR_COS[i] * cosLon0 + AUR_SIN[i] * sinLon0; // cos(lng − lon0)
    const cosc = sinLat0 * sinL + cosLat0 * cosL * cd;

    if (cosc <= 0.02) {
      seg = null;
      continue;
    } // back / limb → break

    const sd = AUR_SIN[i] * cosLon0 - AUR_COS[i] * sinLon0; // sin(lng − lon0)
    const px = CX + R * (cosL * sd);
    const py = CY - R * (cosLat0 * sinL - sinLat0 * cosL * cd);

    if (!seg) {
      seg = [];
      segs.push(seg);
    }
    seg.push(px, py);
  }

  return segs;
}
