/* games.directory globe — Canvas2D render layers
 *
 * Each layer is { name, z, rebuildOn?, build?, resize?, simulate?, visible?, draw }.
 * Layers draw in ascending z. To add an effect, write a factory and add it to
 * registerDefaultLayers().
 *
 * This file is rendering ONLY — geometry (orbit/aurora/land/spike/node/arc math)
 * comes from shared/geometry.js and simulation (beam pick, particle physics,
 * timings) from shared/sim.js, so the SVG build shares all of it.
 *
 * Glows are additive (globalCompositeOperation='lighter' + layered strokes/
 * sprites) rather than per-frame blur filters — the same look, far cheaper.
 * Static art (sphere, atmosphere, nebula, glare) is baked into offscreen
 * sprites on resize and blitted per frame; the day/night terminator renders
 * into a low-res offscreen whose upscale gives a naturally soft twilight edge
 * at a fraction of the fill cost.
 *
 * Depends on the global `d3` (graticule/terminator geo-paths).
 */
import { TAU, easeInOutCubic, tint, rgba, clamp } from "../shared/util.js";
import { DENSITY_STEP } from "../shared/config.js";
import { ADD, NORMAL, drawGlow, makeSprite, blit, pathFromSegments } from "./draw.js";
import {
  moonLayer, cometLayer, constellationsLayer, sunGlintLayer, heartbeatLayer, surgeLayer,
} from "./cinema.js";
import {
  ORBIT_DEFS, computeOrbit, arcControl, quadSplit, quadPoint,
  buildLandDots, buildSpikes, pickNodes, auroraSpecs, auroraSegments,
} from "../shared/geometry.js";
import {
  BEAM, pickBeam, beamEnvelope, spawnMeteorParams, stepMeteor, meteorOpacity,
  fireworkBurst, fireworkBarrage, stepFirework, fireworkAlpha,
} from "../shared/sim.js";

// ======================================================================
// Nebula — vast, slow-drifting hue washes behind everything (cached)
// ======================================================================
export function nebulaLayer() {
  let sprite = null, sw = 0, sh = 0;
  function build(e) {
    // baked at low res (it's pure soft gradient — invisible difference)
    const Q = 0.2;
    sw = e.W * 1.3; sh = e.H * 1.3;
    sprite = document.createElement("canvas");
    sprite.width = Math.max(2, Math.round(sw * Q));
    sprite.height = Math.max(2, Math.round(sh * Q));
    const g = sprite.getContext("2d");
    g.setTransform(Q, 0, 0, Q, 0, 0);
    g.globalCompositeOperation = "lighter";
    const blob = (fx, fy, fr, stops) => {
      const grad = g.createRadialGradient(sw * fx, sh * fy, 0, sw * fx, sh * fy, sw * fr);
      for (const [o, c] of stops) grad.addColorStop(o, c);
      g.fillStyle = grad; g.fillRect(0, 0, sw, sh);
    };
    blob(0.74, 0.18, 0.42, [[0, "rgba(124,92,242,0.14)"], [0.55, "rgba(96,72,210,0.06)"], [1, "rgba(0,0,0,0)"]]);
    blob(0.14, 0.80, 0.40, [[0, "rgba(48,108,222,0.12)"], [0.55, "rgba(40,86,190,0.05)"], [1, "rgba(0,0,0,0)"]]);
    blob(0.46, 0.40, 0.52, [[0, "rgba(58,176,212,0.05)"], [1, "rgba(0,0,0,0)"]]);
  }
  return {
    name: "nebula", z: -4,
    resize(e) { build(e); },
    visible: (e) => e.scene.nebula,
    draw(e) {
      const { ctx, now, W, H } = e;
      if (!sprite) build(e);
      const ia = e.introPhase(0, 0.35);
      if (ia <= 0) return;
      // slow autonomous drift + a bounded lean toward the pointer
      const dx = Math.sin(now * 1.7e-5) * W * 0.015 - W * 0.15 - e.look.x * 4.5;
      const dy = Math.cos(now * 1.3e-5) * H * 0.012 - H * 0.15 + e.look.y * 4.5;
      ADD(ctx);
      ctx.globalAlpha = ia;
      ctx.drawImage(sprite, dx, dy, sw, sh);
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Starfield — in-canvas parallax stars that answer the globe's rotation
// ======================================================================
export function starfieldLayer() {
  let n = 0, x, y, r, grp, depth, bright = [];
  const COLS = ["#ffffff", "#dfe9ff", "#cfdcff"];
  function build(e) {
    n = clamp(Math.round((e.W * e.H) / 7000), 90, 280);
    x = new Float32Array(n); y = new Float32Array(n); r = new Float32Array(n);
    grp = new Uint8Array(n); depth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random() * e.W; y[i] = Math.random() * e.H;
      r[i] = 0.5 + Math.random() * 1.0;
      grp[i] = (Math.random() * 3) | 0;
      depth[i] = 0.35 + Math.random() * 0.65;
    }
    bright = [];
    for (let i = 0; i < 12; i++) {
      bright.push({
        x: Math.random() * e.W, y: Math.random() * e.H,
        r: 1.1 + Math.random() * 1.2, ph: Math.random() * TAU,
        sp: 0.4 + Math.random() * 0.9, depth: 0.55 + Math.random() * 0.45,
        warm: Math.random() < 0.3, cross: i < 4,
      });
    }
  }
  return {
    name: "starfield", z: -3,
    resize(e) { build(e); },
    visible: (e) => e.scene.parallaxStars,
    draw(e) {
      const { ctx, W, H, now } = e;
      if (!x) build(e);
      const rot = e.rotAcc, K = 2.4; // unwrapped ° → px of parallax at depth 1
      const tw = e.scene.starTwinkle;
      ADD(ctx);
      // dim stars: one fillStyle + one globalAlpha per twinkle group; each
      // group resolves out of the darkness at a slightly different moment
      for (let g = 0; g < 3; g++) {
        const ia = e.introPhase(0.02 + g * 0.07, 0.45 + g * 0.05);
        if (ia <= 0) continue;
        ctx.fillStyle = COLS[g];
        ctx.globalAlpha = (tw ? 0.38 + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.0008 + g * 2.1)) : 0.55) * ia;
        for (let i = 0; i < n; i++) {
          if (grp[i] !== g) continue;
          let px = (x[i] - rot * K * depth[i]) % W; if (px < 0) px += W;
          ctx.fillRect(px - r[i] / 2, y[i] - r[i] / 2, r[i], r[i]);
        }
      }
      ctx.globalAlpha = 1;
      // bright stars: individual twinkle, soft glow, a few cross sparkles;
      // they pop in last, at the tail of the arrival
      const ib = e.introPhase(0.3, 0.58);
      if (ib > 0) for (const b of bright) {
        let px = (b.x - rot * K * b.depth) % W; if (px < 0) px += W;
        const a = (tw ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * b.sp + b.ph)) : 0.8) * ib;
        const col = b.warm ? "#ffe7c2" : "#eaf2ff";
        drawGlow(ctx, px, b.y, b.r * 3.2, a * 0.5);
        ctx.globalAlpha = a; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(px, b.y, b.r, 0, TAU); ctx.fill();
        if (b.cross) {
          const L = b.r * 4.5;
          ctx.globalAlpha = a * 0.4; ctx.strokeStyle = col; ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(px - L, b.y); ctx.lineTo(px + L, b.y);
          ctx.moveTo(px, b.y - L); ctx.lineTo(px, b.y + L);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Atmosphere — breathing rim glow, bottom bloom + sun glare on the limb
// ======================================================================
export function atmosphereLayer() {
  // Sprites bake the shape at reference strength; live atmos + pulse modulate
  // them via globalAlpha at blit time, so tuning never rebuilds anything.
  let rim = null, bottom = null, glare = null;
  function build(e) {
    const { CX, CY, R } = e;
    rim = makeSprite(e, (g) => {
      const grad = g.createRadialGradient(CX, CY, R * 0.78, CX, CY, R * 1.22);
      grad.addColorStop(0, "rgba(90,200,255,0)");
      grad.addColorStop(0.40, "rgba(96,200,255,0.10)");
      grad.addColorStop(0.50, "rgba(112,205,255,0.50)");
      grad.addColorStop(0.62, "rgba(132,145,255,0.30)");
      grad.addColorStop(0.80, "rgba(124,107,255,0.12)");
      grad.addColorStop(1, "rgba(124,107,255,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(CX, CY, R * 1.22, 0, TAU); g.fill();
      // crisp atmosphere shell just outside the limb
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(170,225,255,0.28)"; g.lineWidth = 1.4;
      g.beginPath(); g.arc(CX, CY, R * 1.005, 0, TAU); g.stroke();
    });
    bottom = makeSprite(e, (g) => {
      g.translate(CX, CY + R * 0.86); g.scale(R * 0.62, R * 0.26);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, "rgba(180,215,255,0.5)");
      grad.addColorStop(0.4, "rgba(120,170,255,0.16)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    });
    // warm scatter bloom, positioned each frame at the limb nearest the sun
    const GS = 256;
    glare = document.createElement("canvas");
    glare.width = glare.height = GS;
    const gg = glare.getContext("2d");
    const grad = gg.createRadialGradient(GS / 2, GS / 2, 0, GS / 2, GS / 2, GS / 2);
    grad.addColorStop(0, "rgba(255,243,222,0.85)");
    grad.addColorStop(0.25, "rgba(255,214,160,0.32)");
    grad.addColorStop(0.6, "rgba(255,176,124,0.09)");
    grad.addColorStop(1, "rgba(255,170,120,0)");
    gg.fillStyle = grad; gg.fillRect(0, 0, GS, GS);
  }
  return {
    name: "atmosphere", z: 10,
    resize(e) { build(e); },
    visible: (e) => e.scene.atmos > 0,
    draw(e) {
      const { ctx, scene, now, CX, CY, R, proj } = e;
      if (!rim) build(e);
      // ignition: the rim overshoots ~30% mid-arrival, then settles
      const ig = e.introPhase(0.25, 0.68);
      const ignite = ig >= 1 ? 1 : ig * (1 + 0.35 * Math.sin(ig * Math.PI));
      const pulse = scene.atmosPulse ? 0.84 + 0.16 * Math.sin(now * 0.0009) : 1;
      const bpulse = scene.atmosPulse ? 0.9 + 0.1 * Math.sin(now * 0.0009 + 1.2) : 1;
      blit(ctx, rim, Math.min(1, scene.atmos * pulse * ignite), true);
      blit(ctx, bottom, Math.min(1, scene.atmos * bpulse * e.introPhase(0.3, 0.7)), true);
      // sun glare — sits UNDER the sphere disc, so the globe occludes it
      // naturally and it reads as light scattering around the limb.
      if (scene.sunGlare) {
        const s = proj.sunDir();
        const len = Math.hypot(s.x, s.y) || 1e-6;
        const lx = s.z < 0 ? s.x / len : s.x, ly = s.z < 0 ? s.y / len : s.y;
        const px = CX + R * lx, py = CY - R * ly;
        const a = clamp((s.z + 0.55) / 1.1, 0, 1) * Math.min(1, scene.atmos) * 0.7 * e.introPhase(0.4, 0.75);
        if (a > 0.01) {
          ADD(ctx);
          ctx.globalAlpha = a;
          ctx.drawImage(glare, px - R * 0.95, py - R * 0.95, R * 1.9, R * 1.9);
          ctx.globalAlpha = Math.min(1, a * 1.3);
          ctx.drawImage(glare, px - R * 0.42, py - R * 0.42, R * 0.84, R * 0.84);
          ctx.globalAlpha = 1;
        }
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Sphere — globe disc: offset-lit ocean depth + inner limb scatter (cached)
// ======================================================================
export function sphereLayer() {
  let sprite = null;
  function build(e) {
    const { CX, CY, R } = e;
    sprite = makeSprite(e, (g) => {
      const grad = g.createRadialGradient(CX - R * 0.22, CY - R * 0.3, R * 0.08, CX, CY, R);
      grad.addColorStop(0, "#13294a");
      grad.addColorStop(0.4, "#0c1b36");
      grad.addColorStop(0.7, "#071226");
      grad.addColorStop(0.92, "#040b18");
      grad.addColorStop(1, "#030711");
      g.fillStyle = grad; g.beginPath(); g.arc(CX, CY, R, 0, TAU); g.fill();
      g.globalCompositeOperation = "lighter";
      // ambient key light, upper-left
      const h = g.createRadialGradient(CX - R * 0.32, CY - R * 0.34, R * 0.05, CX - R * 0.32, CY - R * 0.34, R);
      h.addColorStop(0, "rgba(120,180,255,0.22)");
      h.addColorStop(0.45, "rgba(120,180,255,0.05)");
      h.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = h; g.beginPath(); g.arc(CX, CY, R, 0, TAU); g.fill();
      // atmospheric scatter just INSIDE the limb — luminous shell depth
      const s = g.createRadialGradient(CX, CY, R * 0.82, CX, CY, R);
      s.addColorStop(0, "rgba(90,170,255,0)");
      s.addColorStop(0.72, "rgba(90,170,255,0.05)");
      s.addColorStop(0.94, "rgba(110,190,255,0.16)");
      s.addColorStop(1, "rgba(140,210,255,0.26)");
      g.fillStyle = s; g.beginPath(); g.arc(CX, CY, R, 0, TAU); g.fill();
    });
  }
  return {
    name: "sphere", z: 30,
    resize(e) { build(e); },
    draw(e) {
      if (!sprite) build(e);
      blit(e.ctx, sprite, e.introPhase(0.12, 0.5), false);
      e.ctx.globalAlpha = 1;
    },
  };
}

// ======================================================================
// Orbital rings — split front/back around the globe (geometry shared)
// ======================================================================
// Memoised per frame so the back + front orbit layers share one computation.
let orbitCache = null, orbitCacheFrame = -1;
function getOrbits(e) {
  if (orbitCacheFrame === e.frameCount) return orbitCache;
  orbitCache = ORBIT_DEFS.map((cfg, o) => {
    const g = computeOrbit(cfg, o, e.R, e.CX, e.CY, e.now);
    return { front: pathFromSegments(g.front), back: pathFromSegments(g.back), sat: g.sat };
  });
  orbitCacheFrame = e.frameCount;
  return orbitCache;
}
export function orbitsBackLayer() {
  return {
    name: "orbitsBack", z: 20,
    visible: (e) => e.scene.orbits,
    draw(e) {
      const { ctx } = e;
      const ia = e.introPhase(0.55, 0.85);
      if (ia <= 0) return;
      ctx.globalAlpha = ia;
      ctx.lineWidth = 0.7; ctx.strokeStyle = "rgba(111,155,214,0.15)";
      for (const ob of getOrbits(e)) ctx.stroke(ob.back);
      ctx.globalAlpha = 1;
    },
  };
}
export function orbitsFrontLayer() {
  return {
    name: "orbitsFront", z: 80,
    visible: (e) => e.scene.orbits,
    draw(e) {
      const { ctx } = e;
      const ia = e.introPhase(0.55, 0.85);
      if (ia <= 0) return;
      ADD(ctx);
      ctx.globalAlpha = ia;
      ctx.lineWidth = 0.85; ctx.strokeStyle = "rgba(188,214,255,0.44)";
      const orbits = getOrbits(e);
      for (const ob of orbits) ctx.stroke(ob.front);
      for (const ob of orbits) {
        if (!ob.sat) continue;
        const sa = (ob.sat.front ? 1 : 0.15) * ia;
        drawGlow(ctx, ob.sat.x, ob.sat.y, 6, sa);
        ctx.globalAlpha = sa; ctx.fillStyle = "#cce6ff";
        ctx.beginPath(); ctx.arc(ob.sat.x, ob.sat.y, 2, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Corona — faint radial spikes shimmering off the limb
// ======================================================================
export function spikesLayer() {
  let s = null;
  return {
    name: "spikes", z: 35,
    visible: (e) => e.scene.corona && e.scene.coronaIntensity > 0,
    build() { s = buildSpikes(); },
    draw(e) {
      const { ctx, CX, CY, R, now, scene, proj } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      const cosLon0 = Math.cos(lon0), sinLon0 = Math.sin(lon0);
      const tt = now * 0.0016;
      ADD(ctx);
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        const cd = s.cosLng[i] * cosLon0 + s.sinLng[i] * sinLon0;
        const cosc = sinLat0 * s.sin[i] + cosLat0 * s.cos[i] * cd;
        if (cosc <= 0) continue;
        const sd = s.sinLng[i] * cosLon0 - s.cosLng[i] * sinLon0;
        const px = CX + R * (s.cos[i] * sd);
        const py = CY - R * (cosLat0 * s.sin[i] - sinLat0 * s.cos[i] * cd);
        const pulse = 0.7 + 0.3 * Math.sin(tt + s.phase[i]);
        const len = (0.02 + s.lenF[i] * 0.04) * pulse;
        ctx.moveTo(px, py);
        ctx.lineTo(CX + (px - CX) * (1 + len), CY + (py - CY) * (1 + len));
      }
      ctx.lineWidth = 0.6; ctx.lineCap = "round";
      ctx.strokeStyle = rgba("#9fc6ff", Math.min(1, scene.coronaIntensity * 1.6) * e.introPhase(0.55, 0.9));
      ctx.stroke();
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Graticule — lat/long grid via d3 geoPath into the canvas context
// ======================================================================
export function graticuleLayer() {
  let path = null;
  return {
    name: "graticule", z: 40,
    visible: (e) => e.scene.grid,
    draw(e) {
      const { ctx, proj } = e;
      if (!path) path = d3.geoPath(proj.d3proj, ctx);
      ctx.beginPath(); path(proj.graticule());
      ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(140,160,210,0.30)"; ctx.stroke();
    },
  };
}

// ======================================================================
// Land — dotted relief; tags night-side city dots for cityLightsLayer
// ======================================================================
export function landLayer() {
  let d = null, sx, sy, vis;
  return {
    name: "land", z: 50, rebuildOn: ["density"],
    build(e) {
      if (!e.data.landFeature) return;
      d = buildLandDots(e.data.landFeature, DENSITY_STEP[e.scene.density] || 3.0);
      sx = new Float32Array(d.n); sy = new Float32Array(d.n); vis = new Uint8Array(d.n);
      e.landDots = d.pts; // real [lng,lat] pairs, used to seed star nodes
      e.cityLights = { x: new Float32Array(d.n), y: new Float32Array(d.n), grp: new Uint8Array(d.n), n: 0 };
    },
    draw(e) {
      const { ctx, CX, CY, R, scene, proj } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      const cosLon0 = Math.cos(lon0), sinLon0 = Math.sin(lon0);
      const sun = proj.sun, cityOn = scene.dayNight && scene.cityLights;
      const cl = e.cityLights; let cn = 0;
      const sinA = d.sin, cosA = d.cos, sLng = d.sinLng, cLng = d.cosLng, cityA = d.isCity, grpA = d.grp;
      // pass A: project every front dot once (no trig — angle-sum identities
      // over the precomputed sin/cos tables); tag night-side city dots
      for (let i = 0; i < d.n; i++) {
        const cd = cLng[i] * cosLon0 + sLng[i] * sinLon0;          // cos(lng − lon0)
        const cosc = sinLat0 * sinA[i] + cosLat0 * cosA[i] * cd;
        if (cosc <= 0) { vis[i] = 0; continue; }
        const sd = sLng[i] * cosLon0 - cLng[i] * sinLon0;          // sin(lng − lon0)
        sx[i] = CX + R * (cosA[i] * sd);
        sy[i] = CY - R * (cosLat0 * sinA[i] - sinLat0 * cosA[i] * cd);
        vis[i] = 1;
        if (cityOn && cityA[i]) {
          const cosSun = sun.sinLat * sinA[i] + sun.cosLat * cosA[i] * (cLng[i] * sun.cosLon + sLng[i] * sun.sinLon);
          if (cosSun < 0.04) { cl.x[cn] = sx[i]; cl.y[cn] = sy[i]; cl.grp[cn] = grpA[i]; cn++; }
        }
      }
      cl.n = cn;
      // passes B–D: dots are tier-SORTED, so each tier is one contiguous run
      // with a single fillStyle and zero per-dot branching on tier
      const base = scene.dotSize, tex = scene.texture, lb = scene.landBright * e.introPhase(0.35, 0.75);
      const sizes = [base * (1 - tex), base, base * (1 + tex * 1.5)];
      const alphas = [0.8 * lb, 0.92 * lb, 1.0 * lb];
      ADD(ctx);
      let start = 0;
      for (let t = 0; t < 3; t++) {
        const end = d.tierEnd[t], sz = sizes[t], half = sz / 2;
        ctx.fillStyle = rgba("#bfe0ff", Math.min(1, alphas[t]));
        for (let i = start; i < end; i++) {
          if (vis[i]) ctx.fillRect(sx[i] - half, sy[i] - half, sz, sz);
        }
        start = end;
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Night — day/night terminator, rendered into a low-res offscreen whose
// upscale gives a naturally soft twilight gradient (and costs ~1/20th the fill)
// ======================================================================
export function nightLayer() {
  let off = null, g = null, path = null;
  const Q = 0.22; // offscreen scale — softness AND speed come from the same trick
  function setup(e) {
    off = document.createElement("canvas");
    off.width = Math.max(2, Math.round(e.W * Q));
    off.height = Math.max(2, Math.round(e.H * Q));
    g = off.getContext("2d");
    path = d3.geoPath(e.proj.d3proj, g);
  }
  return {
    name: "night", z: 55,
    resize(e) { setup(e); },
    visible: (e) => e.scene.dayNight && e.scene.darkness > 0,
    draw(e) {
      const { ctx, proj, scene, W, H } = e;
      if (!off) setup(e);
      const dk = scene.darkness * e.introPhase(0.45, 0.8);
      g.setTransform(Q, 0, 0, Q, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = `rgba(4,7,17,${Math.min(0.85, 0.5 * dk)})`;
      g.beginPath(); path(proj.nightShape()); g.fill();
      g.fillStyle = `rgba(2,4,11,${Math.min(0.85, 0.42 * dk)})`;
      g.beginPath(); path(proj.coreShape()); g.fill();
      ctx.drawImage(off, 0, 0, W, H);
    },
  };
}

// ======================================================================
// City lights — warm twinkle on the night-side dots tagged by landLayer
// ======================================================================
export function cityLightsLayer() {
  return {
    name: "cityLights", z: 57,
    visible: (e) => e.scene.dayNight && e.scene.cityLights && e.cityLights && e.cityLights.n > 0,
    draw(e) {
      const { ctx, now, scene } = e;
      const cl = e.cityLights, cb = scene.cityBright * e.introPhase(0.5, 0.85), sz = 2.9, half = sz / 2;
      const tw = [
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0014)) * cb),
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0014 + 2.1)) * cb),
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0014 + 4.2)) * cb),
      ];
      ADD(ctx);
      for (let g = 0; g < 3; g++) {
        ctx.fillStyle = rgba("#ffd28a", Math.min(1, tw[g]));
        for (let i = 0; i < cl.n; i++) {
          if (cl.grp[i] === g) ctx.fillRect(cl.x[i] - half, cl.y[i] - half, sz, sz);
        }
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Aurora — wobbling polar bands, front-only, layered additive glow
// ======================================================================
export function auroraLayer() {
  return {
    name: "aurora", z: 60,
    visible: (e) => e.scene.aurora && e.scene.auroraIntensity > 0,
    draw(e) {
      const { ctx, proj, CX, CY, R, now, scene } = e;
      const t = now * 0.0011, k = scene.auroraIntensity * e.introPhase(0.5, 0.85);
      if (k <= 0) return;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ADD(ctx);
      for (const s of auroraSpecs(scene)) {
        const op = Math.min(1, (s.op0 + 0.22 * Math.sin(t + s.opPh)) * k);
        const segs = auroraSegments(proj, CX, CY, R, s.lat, s.amp, s.phase, now, scene.auroraSpeed);
        const path = pathFromSegments(segs);
        // veil + body + thin bright core = curtain glow without a filter
        ctx.lineWidth = s.width * 2.6; ctx.strokeStyle = rgba(s.col, op * 0.28); ctx.stroke(path);
        ctx.lineWidth = s.width * 1.1; ctx.strokeStyle = rgba(s.col, op * 0.85); ctx.stroke(path);
        ctx.lineWidth = s.width * 0.4; ctx.strokeStyle = rgba("#eafff4", op * 0.18); ctx.stroke(path);
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Star nodes — bright twinkling points anchored to land
// ======================================================================
export function nodesLayer() {
  let nodes = [];
  return {
    name: "nodes", z: 65,
    visible: (e) => e.scene.nodes,
    build(e) { nodes = pickNodes(e.landDots); },
    draw(e) {
      const { ctx, proj, now } = e;
      const tt = now * 0.001;
      ADD(ctx);
      for (const node of nodes) {
        const p = proj.forward(node.ll);
        if (!p || !proj.visible(node.ll)) continue;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(tt * node.sp + node.phase));
        const r = node.size * (0.7 + 0.3 * tw);
        drawGlow(ctx, p[0], p[1], r * 3, tw * 0.5);
        ctx.globalAlpha = tw; ctx.fillStyle = "#eaf4ff";
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Beams — activity beams converging on HQ (the core feature)
// ======================================================================
export function beamsLayer() {
  let beams = [];
  return {
    name: "beams", z: 90,
    spawn(e) {
      const pick = pickBeam(e);
      if (!pick) return;
      const ts = e.state.types[pick.type.id];
      ts.count++; e.bump(pick.type.id);
      e.emit("beam", { type: pick.type, city: pick.city, color: ts.color });
      beams.push({ type: pick.type, src: pick.city.lnglat, color: ts.color, t0: e.now, impacted: false });
    },
    draw(e) {
      const { ctx, CX, CY, R, now, scene, proj } = e;
      const hqp = e.hq, hqVisible = e.hqVisible;
      ctx.lineCap = "round";
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        const age = now - b.t0;
        if (age > BEAM.LIFE_MS) { beams.splice(i, 1); continue; }
        const sp = proj.forward(b.src);
        if (!sp || !hqp || !proj.visible(b.src) || !hqVisible) continue;

        const C = arcControl(sp, hqp, CX, CY, R);
        const t = easeInOutCubic(Math.min(1, age / BEAM.DRAW_MS));

        let hx, hy;
        const path = new Path2D();
        path.moveTo(sp[0], sp[1]);
        if (t >= 1) { path.quadraticCurveTo(C[0], C[1], hqp[0], hqp[1]); hx = hqp[0]; hy = hqp[1]; }
        else { const s = quadSplit(sp, C, hqp, t); path.quadraticCurveTo(s.ax, s.ay, s.hx, s.hy); hx = s.hx; hy = s.hy; }

        const op = beamEnvelope(age);
        const special = b.type.id === e.sim.fwTrigger;
        ctx.globalAlpha = op;
        ADD(ctx);
        // bloom → halo → body → white-hot core
        ctx.strokeStyle = rgba(b.color, 0.07);                   ctx.lineWidth = special ? 22 : 17;  ctx.stroke(path);
        ctx.strokeStyle = rgba(b.color, special ? 0.5 : 0.2);    ctx.lineWidth = special ? 12 : 10;  ctx.stroke(path);
        ctx.strokeStyle = rgba(b.color, 0.95);                   ctx.lineWidth = special ? 3.2 : 2.4; ctx.stroke(path);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";               ctx.lineWidth = special ? 1.4 : 1;   ctx.stroke(path);

        // comet trail behind the head while drawing
        if (scene.beamTrails && t < 1) {
          const u0 = Math.max(0, t - 0.17);
          const trail = new Path2D();
          for (let n = 0; n <= 6; n++) {
            const [qx, qy] = quadPoint(sp, C, hqp, u0 + (t - u0) * (n / 6));
            n === 0 ? trail.moveTo(qx, qy) : trail.lineTo(qx, qy);
          }
          ctx.strokeStyle = tint(b.color); ctx.lineWidth = 3.8; ctx.stroke(trail);
        }

        if (t < 1) {
          const hr = 4 + Math.sin(age / 90) * 0.7;
          drawGlow(ctx, hx, hy, hr * 2.8, op);
          ctx.globalAlpha = op; ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
          // tiny cross sparkle on the head
          const L = hr * 2.2;
          ctx.globalAlpha = op * 0.55; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(hx - L, hy); ctx.lineTo(hx + L, hy);
          ctx.moveTo(hx, hy - L); ctx.lineTo(hx, hy + L);
          ctx.stroke();
        } else if (!b.impacted) {
          b.impacted = true;
          e.emit("impact", { p: hqp.slice(), color: b.color });
          if (e.sim.fireworks && special) e.emit("fireworks", { p: hqp.slice(), color: b.color });
        }
        ctx.globalAlpha = 1;
        NORMAL(ctx);
      }
    },
  };
}

// ======================================================================
// Impacts — glow flash + twin expanding rings where a beam lands
// ======================================================================
export function impactsLayer() {
  let items = [];
  const TTL = 700;
  return {
    name: "impacts", z: 92,
    build(e) { items = []; e.on("impact", (d) => items.push({ x: d.p[0], y: d.p[1], color: d.color, t0: e.now })); },
    simulate(e) {
      for (let i = items.length - 1; i >= 0; i--) if ((e.now - items[i].t0) / TTL >= 1) items.splice(i, 1);
    },
    draw(e) {
      const { ctx, R, now } = e;
      ADD(ctx);
      for (const it of items) {
        const a = (now - it.t0) / TTL, ee = 1 - Math.pow(1 - a, 2);
        drawGlow(ctx, it.x, it.y, 8 + ee * 16, (1 - a) * 0.7);
        ctx.globalAlpha = 1 - a;
        ctx.strokeStyle = it.color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(it.x, it.y, 5 + ee * R * 0.17, 0, TAU); ctx.stroke();
        const a2 = clamp(a * 1.4 - 0.4, 0, 1), ee2 = 1 - Math.pow(1 - a2, 2);
        if (a2 > 0) {
          ctx.globalAlpha = (1 - a2) * 0.5;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(it.x, it.y, 4 + ee2 * R * 0.10, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = (1 - a) * 0.9; ctx.fillStyle = it.color;
        ctx.beginPath(); ctx.arc(it.x, it.y, 3 + ee * 6, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Fireworks — celebratory barrage on the trigger activity
// ======================================================================
export function fireworksLayer() {
  let parts = [];
  function burst(e, cx, cy, color, scale) {
    const spec = fireworkBurst(e.R, scale, color);
    parts.push({ flash: true, x: cx, y: cy, t: 0, ttl: spec.flash.ttl, grow: spec.flash.grow });
    for (const s of spec.sparks) parts.push(Object.assign({ x: cx, y: cy }, s));
  }
  return {
    name: "fireworks", z: 94,
    build(e) {
      parts = [];
      e.on("fireworks", (d) => {
        const [x, y] = d.p;
        for (const b of fireworkBarrage(e.R, d.color)) {
          const fire = () => burst(e, x + b.dx, y + b.dy, b.color, b.scale);
          b.delay ? setTimeout(fire, b.delay) : fire();
        }
      });
    },
    simulate(e) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.t += e.dt;
        if (p.t >= p.ttl) { parts.splice(i, 1); continue; }
        stepFirework(p, e.dt, e.R);
      }
    },
    draw(e) {
      if (!parts.length) return;
      const { ctx } = e;
      ADD(ctx);
      for (const p of parts) {
        ctx.globalAlpha = fireworkAlpha(p);
        ctx.fillStyle = p.flash ? "#fff" : p.color;
        const r = p.flash ? 3 + (p.t / p.ttl) * p.grow : p.r;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Shooting stars — meteors streaking through deep space (behind globe)
// ======================================================================
export function meteorsLayer() {
  let meteors = [], acc = 0;
  return {
    name: "meteors", z: 0,
    simulate(e) {
      if (e.scene.shootingStars && e.intro >= 0.9) {
        acc += e.dt * (0.12 + e.scene.meteorRate * 1.5);
        let guard = 0;
        while (acc >= 1 && guard < 3) { meteors.push(spawnMeteorParams(e.W, e.H)); acc -= 1; guard++; }
      } else acc = 0;
      for (let i = meteors.length - 1; i >= 0; i--) if (!stepMeteor(meteors[i], e.dt, e.H)) meteors.splice(i, 1);
    },
    draw(e) {
      if (!meteors.length) return;
      const { ctx } = e;
      ADD(ctx); ctx.lineCap = "round";
      for (const m of meteors) {
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.x - (m.vx / sp) * m.len, ty = m.y - (m.vy / sp) * m.len;
        const op = meteorOpacity(m);
        ctx.globalAlpha = op;
        const grad = ctx.createLinearGradient(tx, ty, m.x, m.y);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.55, "rgba(207,227,255,0.5)");
        grad.addColorStop(1, "rgba(255,255,255,1)");
        ctx.strokeStyle = grad; ctx.lineWidth = m.w;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(m.x, m.y); ctx.stroke();
        drawGlow(ctx, m.x, m.y, m.hr * 3, op);
        ctx.globalAlpha = op; ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(m.x, m.y, m.hr, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// HQ — pulsing marker + label
// ======================================================================
export function hqLayer() {
  return {
    name: "hq", z: 96,
    draw(e) {
      const { ctx, now } = e;
      if (!e.hqVisible || !e.hq) return;
      const ia = e.introPhase(0.72, 0.95);
      if (ia <= 0) return;
      const [x, y] = e.hq;
      for (const off of [0, 1300]) {
        const p = ((now + off) % 2600) / 2600;
        ctx.globalAlpha = (1 - p) * 0.8 * ia;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(x, y, 5 + p * 29, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ADD(ctx); drawGlow(ctx, x, y, 11, 0.9 * ia); NORMAL(ctx);
      ctx.globalAlpha = ia;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
      // label
      ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(5,6,12,0.8)";
      ctx.font = "600 14px 'Space Grotesk', system-ui, sans-serif";
      ctx.lineWidth = 3.5; ctx.strokeText(e.data.HQ.name, x + 12, y + 4);
      ctx.fillStyle = "#fff"; ctx.fillText(e.data.HQ.name, x + 12, y + 4);
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.lineWidth = 3.5; ctx.strokeText(e.data.HQ.city, x + 12, y + 20);
      ctx.fillStyle = "#5ad1ff"; ctx.fillText(e.data.HQ.city, x + 12, y + 20);
      ctx.globalAlpha = 1;
    },
  };
}

// ----------------------------------------------------------------------
export function registerDefaultLayers(engine) {
  [
    nebulaLayer(), starfieldLayer(), constellationsLayer(), cometLayer(),
    meteorsLayer(), moonLayer(), atmosphereLayer(),
    orbitsBackLayer(), sphereLayer(), spikesLayer(), graticuleLayer(),
    sunGlintLayer(), landLayer(), nightLayer(), cityLightsLayer(),
    heartbeatLayer(), auroraLayer(), nodesLayer(), surgeLayer(),
    orbitsFrontLayer(), beamsLayer(), impactsLayer(), fireworksLayer(), hqLayer(),
  ].forEach((l) => engine.register(l));
}
