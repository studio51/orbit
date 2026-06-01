/* games.directory globe — Canvas2D render layers
 *
 * Every visual element is a self-contained layer object:
 *   { name, z, rebuildOn?, build?, resize?, simulate?, visible?, draw }
 * Layers draw in ascending `z`. To add an effect, write a factory here and add
 * it to registerDefaultLayers() (or call engine.register() from your own code).
 *
 * Glows are additive: instead of per-frame blur filters (expensive), we set
 * globalCompositeOperation='lighter' and layer translucent strokes/fills — the
 * same look as SVG `mix-blend-mode:screen`, far cheaper.
 *
 * Depends on the global `d3` (for graticule/terminator geo-paths) and `topojson`.
 */
import { DEG, TAU, lerp, easeInOutCubic, tint, rgba, weightedPick } from "../shared/util.js";
import { DENSITY_STEP, AURORA_SCHEMES } from "../shared/config.js";

const ADD = (ctx) => (ctx.globalCompositeOperation = "lighter");
const NORMAL = (ctx) => (ctx.globalCompositeOperation = "source-over");

// ======================================================================
// Atmosphere — breathing rim glow + bottom bloom
// ======================================================================
export function atmosphereLayer() {
  return {
    name: "atmosphere", z: 10,
    visible: (e) => e.scene.atmos > 0,
    draw(e) {
      const { ctx, CX, CY, R, scene, now } = e;
      const pulse = scene.atmosPulse ? 0.82 + 0.18 * Math.sin(now * 0.0011) : 1;
      const a = 0.55 * scene.atmos * pulse;
      ADD(ctx);
      // rim
      const rim = ctx.createRadialGradient(CX, CY, R * 0.82, CX, CY, R * 1.16);
      rim.addColorStop(0, "rgba(90,209,255,0)");
      rim.addColorStop(0.80, "rgba(90,209,255,0)");
      rim.addColorStop(0.92, `rgba(110,200,255,${a})`);
      rim.addColorStop(0.97, `rgba(124,107,255,${a * 0.7})`);
      rim.addColorStop(1, "rgba(124,107,255,0)");
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(CX, CY, R * 1.16, 0, TAU); ctx.fill();
      // bottom bloom (squashed)
      const bpulse = scene.atmosPulse ? 0.88 + 0.12 * Math.sin(now * 0.0011 + 1.2) : 1;
      ctx.save();
      ctx.translate(CX, CY + R * 0.86);
      ctx.scale(R * 0.62, R * 0.26);
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      bg.addColorStop(0, `rgba(180,215,255,${0.55 * scene.atmos * bpulse})`);
      bg.addColorStop(0.4, `rgba(120,170,255,${0.18 * scene.atmos * bpulse})`);
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Sphere — dark globe disc + soft top-left highlight
// ======================================================================
export function sphereLayer() {
  return {
    name: "sphere", z: 30,
    draw(e) {
      const { ctx, CX, CY, R } = e;
      const g = ctx.createRadialGradient(CX - R * 0.2, CY - R * 0.28, R * 0.1, CX, CY, R);
      g.addColorStop(0, "#0e1d33");
      g.addColorStop(0.55, "#070f1f");
      g.addColorStop(1, "#02040a");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();
      // highlight
      ADD(ctx);
      const h = ctx.createRadialGradient(CX - R * 0.32, CY - R * 0.34, R * 0.05, CX - R * 0.32, CY - R * 0.34, R);
      h.addColorStop(0, "rgba(120,180,255,0.20)");
      h.addColorStop(0.45, "rgba(120,180,255,0.04)");
      h.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = h;
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Orbital rings — tilted/spun rings, split front/back around the globe
// ======================================================================
const ORBIT_DEFS = [
  { rf: 1.16, incl: 1.15, yaw0: 0.4, spin: 0.05, sat: true },
  { rf: 1.24, incl: 0.6,  yaw0: 2.1, spin: -0.035, sat: false },
  { rf: 1.10, incl: 1.45, yaw0: 1.2, spin: 0.06, sat: true },
  { rf: 1.32, incl: 0.95, yaw0: 3.0, spin: -0.025, sat: false },
  { rf: 1.19, incl: 0.3,  yaw0: 0.8, spin: 0.04, sat: false },
];
function computeOrbits(e) {
  if (e._orbitsAt === e.frameCount) return e._orbits;
  const { CX, CY, R, now } = e;
  const N = 84;
  const out = ORBIT_DEFS.map((cfg, o) => {
    const Rr = R * cfg.rf;
    const ci = Math.cos(cfg.incl), si = Math.sin(cfg.incl);
    const yaw = cfg.yaw0 + now * 0.001 * cfg.spin * 6;
    const cy_ = Math.cos(yaw), sy = Math.sin(yaw);
    const front = new Path2D(), back = new Path2D();
    let fStart = true, bStart = true;
    const satIdx = ((now * 0.0004 * (o + 1)) % 1) * N | 0;
    let sat = null;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const x0 = Math.cos(a), y0 = Math.sin(a);
      const y1 = y0 * ci, z1 = y0 * si, x1 = x0;          // tilt around X (z0=0)
      const x2 = x1 * cy_ + z1 * sy, z2 = -x1 * sy + z1 * cy_, y2 = y1; // spin around Y
      const sx = CX + x2 * Rr, syc = CY - y2 * Rr;
      if (z2 >= 0) { fStart ? front.moveTo(sx, syc) : front.lineTo(sx, syc); fStart = false; bStart = true; }
      else { bStart ? back.moveTo(sx, syc) : back.lineTo(sx, syc); bStart = false; fStart = true; }
      if (cfg.sat && k === satIdx) sat = { x: sx, y: syc, front: z2 >= 0 };
    }
    return { front, back, sat };
  });
  e._orbits = out; e._orbitsAt = e.frameCount;
  return out;
}
export function orbitsBackLayer() {
  return {
    name: "orbitsBack", z: 20,
    visible: (e) => e.scene.orbits,
    draw(e) {
      const { ctx } = e;
      ctx.lineWidth = 0.7; ctx.strokeStyle = "rgba(111,155,214,0.16)";
      for (const ob of computeOrbits(e)) ctx.stroke(ob.back);
    },
  };
}
export function orbitsFrontLayer() {
  return {
    name: "orbitsFront", z: 80,
    visible: (e) => e.scene.orbits,
    draw(e) {
      const { ctx } = e;
      ADD(ctx);
      ctx.lineWidth = 0.85; ctx.strokeStyle = "rgba(188,214,255,0.5)";
      const orbits = computeOrbits(e);
      for (const ob of orbits) ctx.stroke(ob.front);
      for (const ob of orbits) {
        if (!ob.sat) continue;
        ctx.globalAlpha = ob.sat.front ? 1 : 0.15;
        ctx.fillStyle = "#cce6ff";
        ctx.shadowColor = "#bcd9ff"; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(ob.sat.x, ob.sat.y, 2, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Corona — faint radial spikes shimmering off the limb
// ======================================================================
export function spikesLayer() {
  let sin, cos, lng, lenF, phase, n = 0;
  return {
    name: "spikes", z: 35,
    visible: (e) => e.scene.corona && e.scene.coronaIntensity > 0,
    build() {
      const step = 7, sinA = [], cosA = [], lngA = [], lenA = [], phA = [];
      for (let lat = -86; lat <= 86; lat += step) {
        const ringStep = step / Math.max(0.16, Math.cos(lat * DEG));
        for (let l = -180; l < 180; l += ringStep) {
          const latR = lat * DEG;
          sinA.push(Math.sin(latR)); cosA.push(Math.cos(latR)); lngA.push(l * DEG);
          lenA.push(0.25 + Math.random() * 0.95); phA.push(Math.random() * TAU);
        }
      }
      sin = Float64Array.from(sinA); cos = Float64Array.from(cosA); lng = Float64Array.from(lngA);
      lenF = Float64Array.from(lenA); phase = Float64Array.from(phA); n = sinA.length;
    },
    draw(e) {
      const { ctx, CX, CY, R, now, scene, proj } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      const tt = now * 0.0016;
      ADD(ctx);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const dlon = lng[i] - lon0, cd = Math.cos(dlon);
        const cosc = sinLat0 * sin[i] + cosLat0 * cos[i] * cd;
        if (cosc <= 0) continue;
        const sd = Math.sin(dlon);
        const px = CX + R * (cos[i] * sd);
        const py = CY - R * (cosLat0 * sin[i] - sinLat0 * cos[i] * cd);
        const pulse = 0.7 + 0.3 * Math.sin(tt + phase[i]);
        const len = (0.02 + lenF[i] * 0.04) * pulse;
        ctx.moveTo(px, py);
        ctx.lineTo(CX + (px - CX) * (1 + len), CY + (py - CY) * (1 + len));
      }
      ctx.lineWidth = 0.6; ctx.lineCap = "round";
      ctx.strokeStyle = rgba("#9fc6ff", Math.min(1, scene.coronaIntensity * 1.6));
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
      ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(140,160,210,0.34)"; ctx.stroke();
    },
  };
}

// ======================================================================
// Land — dotted relief; also tags night-side city dots for cityLightsLayer
// ======================================================================
export function landLayer() {
  let sin, cos, lng, isCity, grp, tier, n = 0;
  let sx, sy, vis; // per-frame screen-space scratch buffers
  return {
    name: "land", z: 50, rebuildOn: ["density"],
    build(e) {
      const feature = e.data.landFeature;
      if (!feature) return;
      const step = DENSITY_STEP[e.scene.density] || 3.0;
      const sinA = [], cosA = [], lngA = [], cityA = [], grpA = [], tierA = [], pts = [];
      for (let lat = -84; lat <= 84; lat += step) {
        const ringStep = step / Math.max(0.18, Math.cos(lat * DEG));
        for (let l = -180; l < 180; l += ringStep) {
          if (!d3.geoContains(feature, [l, lat])) continue;
          const latR = lat * DEG;
          sinA.push(Math.sin(latR)); cosA.push(Math.cos(latR)); lngA.push(l * DEG);
          pts.push([l, lat]);
          cityA.push(Math.random() < 0.45 ? 1 : 0);
          grpA.push((Math.random() * 3) | 0);
          const r = Math.random();
          tierA.push(r < 0.46 ? 0 : (r < 0.83 ? 1 : 2));
        }
      }
      sin = Float64Array.from(sinA); cos = Float64Array.from(cosA); lng = Float64Array.from(lngA);
      isCity = Uint8Array.from(cityA); grp = Uint8Array.from(grpA); tier = Uint8Array.from(tierA);
      n = sinA.length;
      sx = new Float32Array(n); sy = new Float32Array(n); vis = new Uint8Array(n);
      e.landDots = pts; // real [lng,lat] pairs, used to seed star nodes
      // shared city-light buffer, consumed by cityLightsLayer
      e.cityLights = { x: new Float32Array(n), y: new Float32Array(n), grp: new Uint8Array(n), n: 0 };
    },
    draw(e) {
      const { ctx, CX, CY, R, scene, proj } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      const sun = proj.sun, cityOn = scene.dayNight && scene.cityLights;
      const cl = e.cityLights; let cn = 0;
      // pass A: project every front dot once; tag night-side city dots
      for (let i = 0; i < n; i++) {
        const dlon = lng[i] - lon0, cd = Math.cos(dlon);
        const cosc = sinLat0 * sin[i] + cosLat0 * cos[i] * cd;
        if (cosc <= 0) { vis[i] = 0; continue; }
        const sd = Math.sin(dlon);
        sx[i] = CX + R * (cos[i] * sd);
        sy[i] = CY - R * (cosLat0 * sin[i] - sinLat0 * cos[i] * cd);
        vis[i] = 1;
        if (cityOn && isCity[i]) {
          const sdl = lng[i] - sun.lon;
          const cosSun = sun.sinLat * sin[i] + sun.cosLat * cos[i] * Math.cos(sdl);
          if (cosSun < 0.04) { cl.x[cn] = sx[i]; cl.y[cn] = sy[i]; cl.grp[cn] = grp[i]; cn++; }
        }
      }
      cl.n = cn;
      // passes B–D: one fillStyle per relief tier
      const base = scene.dotSize, tex = scene.texture, lb = scene.landBright;
      const sizes = [base * (1 - tex), base, base * (1 + tex * 1.5)];
      const alphas = [0.8 * lb, 0.92 * lb, 1.0 * lb];
      ADD(ctx);
      for (let t = 0; t < 3; t++) {
        const sz = sizes[t], half = sz / 2;
        ctx.fillStyle = rgba("#bfe0ff", Math.min(1, alphas[t]));
        for (let i = 0; i < n; i++) {
          if (vis[i] && tier[i] === t) ctx.fillRect(sx[i] - half, sy[i] - half, sz, sz);
        }
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Night — day/night terminator (twilight band + deep-night core)
// ======================================================================
export function nightLayer() {
  let path = null;
  return {
    name: "night", z: 55,
    visible: (e) => e.scene.dayNight && e.scene.darkness > 0,
    draw(e) {
      const { ctx, proj, scene } = e;
      if (!path) path = d3.geoPath(proj.d3proj, ctx);
      const d = scene.darkness;
      ctx.fillStyle = `rgba(3,6,15,${Math.min(0.85, 0.5 * d)})`;
      ctx.beginPath(); path(proj.nightShape()); ctx.fill();
      ctx.fillStyle = `rgba(2,4,10,${Math.min(0.85, 0.42 * d)})`;
      ctx.beginPath(); path(proj.coreShape()); ctx.fill();
    },
  };
}

// ======================================================================
// City lights — golden twinkle on the night-side dots tagged by landLayer
// ======================================================================
export function cityLightsLayer() {
  return {
    name: "cityLights", z: 57,
    visible: (e) => e.scene.dayNight && e.scene.cityLights && e.cityLights && e.cityLights.n > 0,
    draw(e) {
      const { ctx, now, scene } = e;
      const cl = e.cityLights, cb = scene.cityBright, sz = 3.1, half = sz / 2;
      const tw = [
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0017)) * cb),
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0017 + 2.1)) * cb),
        Math.min(1.4, (0.55 + 0.45 * Math.sin(now * 0.0017 + 4.2)) * cb),
      ];
      ADD(ctx);
      for (let g = 0; g < 3; g++) {
        ctx.fillStyle = rgba("#ffcf73", Math.min(1, tw[g]));
        for (let i = 0; i < cl.n; i++) {
          if (cl.grp[i] === g) ctx.fillRect(cl.x[i] - half, cl.y[i] - half, sz, sz);
        }
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Aurora — wobbling polar bands, front-only, soft additive glow
// ======================================================================
export function auroraLayer() {
  function band(e, baseLat, amp, phase) {
    const { ctx, CX, CY, R, now, scene, proj } = e;
    const { lon0, sinLat0, cosLat0 } = proj;
    const t = now * 0.0006 * scene.auroraSpeed;
    let start = true;
    ctx.beginPath();
    for (let l = -180; l <= 180; l += 4) {
      const lngR = l * DEG;
      const lat = baseLat + amp * Math.sin(lngR * 3 + t * 6 + phase) + amp * 0.5 * Math.sin(lngR * 7 - t * 4 + phase);
      const latR = lat * DEG, sinL = Math.sin(latR), cosL = Math.cos(latR);
      const dlon = lngR - lon0, cd = Math.cos(dlon);
      const cosc = sinLat0 * sinL + cosLat0 * cosL * cd;
      if (cosc <= 0.02) { start = true; continue; }
      const sd = Math.sin(dlon);
      const px = CX + R * (cosL * sd);
      const py = CY - R * (cosLat0 * sinL - sinLat0 * cosL * cd);
      start ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      start = false;
    }
  }
  return {
    name: "aurora", z: 60,
    visible: (e) => e.scene.aurora && e.scene.auroraIntensity > 0,
    draw(e) {
      const { ctx, now, scene } = e;
      const sch = AURORA_SCHEMES[scene.auroraScheme] || AURORA_SCHEMES.gv;
      const bl = scene.auroraLat, k = scene.auroraIntensity, t = now * 0.0011;
      const specs = [
        { lat: bl,        amp: 4.5, ph: 0,   col: sch[0], w: 5.5, op: (0.34 + 0.22 * Math.sin(t)) },
        { lat: bl + 2.5,  amp: 5.5, ph: 1.6, col: sch[1], w: 3.5, op: (0.30 + 0.22 * Math.sin(t + 1.7)) },
        { lat: -bl,       amp: 4.5, ph: 2.4, col: sch[0], w: 5.5, op: (0.34 + 0.22 * Math.sin(t + 3.1)) },
        { lat: -bl - 2.5, amp: 5.5, ph: 3.9, col: sch[1], w: 3.5, op: (0.30 + 0.22 * Math.sin(t + 4.6)) },
      ];
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ADD(ctx);
      for (const s of specs) {
        const op = Math.min(1, s.op * k);
        // fat soft pass + bright core pass = glow without a filter
        band(e, s.lat, s.amp, s.ph);
        ctx.lineWidth = s.w * 2.2; ctx.strokeStyle = rgba(s.col, op * 0.35); ctx.stroke();
        ctx.lineWidth = s.w;       ctx.strokeStyle = rgba(s.col, op);        ctx.stroke();
      }
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Star nodes — a handful of bright twinkling points anchored to land
// ======================================================================
export function nodesLayer() {
  let nodes = [];
  return {
    name: "nodes", z: 65,
    visible: (e) => e.scene.nodes,
    build(e) {
      nodes = [];
      const dots = e.landDots;
      if (!dots || !dots.length) return;
      for (let i = 0; i < 18; i++) {
        nodes.push({
          ll: dots[(Math.random() * dots.length) | 0],
          phase: Math.random() * TAU, sp: 1.5 + Math.random() * 2.5, size: 1.3 + Math.random() * 1.6,
        });
      }
    },
    draw(e) {
      const { ctx, proj, now } = e;
      const tt = now * 0.001;
      ADD(ctx);
      ctx.fillStyle = "#eaf4ff"; ctx.shadowColor = "#cfe6ff"; ctx.shadowBlur = 4;
      for (const node of nodes) {
        const p = proj.forward(node.ll);
        if (!p || !proj.visible(node.ll)) continue;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(tt * node.sp + node.phase));
        ctx.globalAlpha = tw;
        ctx.beginPath(); ctx.arc(p[0], p[1], node.size * (0.7 + 0.3 * tw), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Beams — great-arc activity beams converging on HQ (the core feature)
// ======================================================================
const DRAW_MS = 1500, HOLD_MS = 700, FADE_MS = 950, LIFE_MS = DRAW_MS + HOLD_MS + FADE_MS;
function arcControl(a, b, CX, CY, R) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const vx = mx - CX, vy = my - CY, vlen = Math.hypot(vx, vy) || 1;
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lift = Math.min(R * 0.9, dist * 0.42 + R * 0.12);
  return [mx + (vx / vlen) * lift, my + (vy / vlen) * lift];
}
export function beamsLayer() {
  let beams = [];
  return {
    name: "beams", z: 90,
    spawn(e) {
      if (!e.proj.visible(e.data.HQ.lnglat)) return; // can't land if HQ faces away
      const enabled = e.data.ACTIVITY_TYPES.filter((t) => e.state.types[t.id].enabled);
      if (!enabled.length) return;
      const type = weightedPick(enabled, (t) => e.state.types[t.id].weight || 1);

      let city = null;
      for (let k = 0; k < 8; k++) {
        const c = e.data.CITIES[(Math.random() * e.data.CITIES.length) | 0];
        if (e.proj.visible(c.lnglat)) { city = c; break; }
      }
      if (!city) return;

      const ts = e.state.types[type.id];
      ts.count++;
      e.bump(type.id);
      e.emit("beam", { type, city, color: ts.color });

      beams.push({ type, src: city.lnglat, color: ts.color, t0: e.now, impacted: false });
    },
    draw(e) {
      const { ctx, CX, CY, R, now, scene, proj } = e;
      const hqp = e.hq, hqVisible = e.hqVisible;
      ctx.lineCap = "round";
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        const age = now - b.t0;
        if (age > LIFE_MS) { beams.splice(i, 1); continue; }
        const sp = proj.forward(b.src);
        if (!sp || !hqp || !proj.visible(b.src) || !hqVisible) continue;

        const C = arcControl(sp, hqp, CX, CY, R);
        const drawP = Math.min(1, age / DRAW_MS);
        const t = easeInOutCubic(drawP);

        // partial arc via De Casteljau subdivision at t
        let hx, hy, ex, ey;
        const path = new Path2D();
        path.moveTo(sp[0], sp[1]);
        if (t >= 1) { path.quadraticCurveTo(C[0], C[1], hqp[0], hqp[1]); hx = hqp[0]; hy = hqp[1]; ex = C[0]; ey = C[1]; }
        else {
          const ax = lerp(sp[0], C[0], t), ay = lerp(sp[1], C[1], t);
          const bx = lerp(C[0], hqp[0], t), by = lerp(C[1], hqp[1], t);
          hx = lerp(ax, bx, t); hy = lerp(ay, by, t);
          path.quadraticCurveTo(ax, ay, hx, hy); ex = ax; ey = ay;
        }

        // opacity envelope
        let op = 1;
        if (age > DRAW_MS + HOLD_MS) op = Math.max(0, 1 - (age - DRAW_MS - HOLD_MS) / FADE_MS);
        const special = b.type.id === e.sim.fwTrigger;
        ctx.globalAlpha = op;

        ADD(ctx);
        // layered glow → core → hot
        ctx.strokeStyle = rgba(b.color, special ? 0.55 : 0.22); ctx.lineWidth = special ? 13 : 11; ctx.stroke(path);
        ctx.strokeStyle = rgba(b.color, 0.95);                   ctx.lineWidth = special ? 3.4 : 2.6; ctx.stroke(path);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";               ctx.lineWidth = special ? 1.5 : 1;   ctx.stroke(path);

        // comet trail behind the head while drawing
        if (scene.beamTrails && t < 1) {
          const u0 = Math.max(0, t - 0.17);
          const trail = new Path2D();
          for (let s = 0; s <= 6; s++) {
            const u = u0 + (t - u0) * (s / 6), iu = 1 - u;
            const qx = iu * iu * sp[0] + 2 * iu * u * C[0] + u * u * hqp[0];
            const qy = iu * iu * sp[1] + 2 * iu * u * C[1] + u * u * hqp[1];
            s === 0 ? trail.moveTo(qx, qy) : trail.lineTo(qx, qy);
          }
          ctx.strokeStyle = tint(b.color); ctx.lineWidth = 4.2; ctx.stroke(trail);
        }

        // head dot rides the leading edge
        if (t < 1) {
          ctx.fillStyle = "#fff"; ctx.shadowColor = b.color; ctx.shadowBlur = 7;
          ctx.beginPath(); ctx.arc(hx, hy, 4.2 + Math.sin(age / 90) * 0.7, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0;
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
// Impacts — expanding ring + burst where a beam lands
// ======================================================================
export function impactsLayer() {
  let items = [];
  return {
    name: "impacts", z: 92,
    build(e) { items = []; e.on("impact", (d) => items.push({ x: d.p[0], y: d.p[1], color: d.color, t0: e.now })); },
    simulate(e) {
      for (let i = items.length - 1; i >= 0; i--) if ((e.now - items[i].t0) / 620 >= 1) items.splice(i, 1);
    },
    draw(e) {
      const { ctx, R, now } = e;
      ADD(ctx);
      for (const it of items) {
        const a = (now - it.t0) / 620, ee = 1 - Math.pow(1 - a, 2);
        ctx.globalAlpha = 1 - a;
        ctx.strokeStyle = it.color; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(it.x, it.y, 5 + ee * R * 0.18, 0, TAU); ctx.stroke();
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
    scale = scale || 1;
    parts.push({ flash: true, x: cx, y: cy, t: 0, ttl: 0.34, grow: e.R * 0.46 * scale });
    const cols = [color, "#ffffff", tint(color)];
    const N = Math.round(48 * scale);
    for (let i = 0; i < N; i++) {
      const ang = Math.random() * TAU, core = i < N * 0.28;
      const speed = (0.42 + Math.random() * 0.95) * e.R * 1.7 * scale * (core ? 1.3 : 1);
      parts.push({
        x: cx, y: cy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        r: core ? 1.5 : 2.1, color: core ? "#fff" : cols[(Math.random() * cols.length) | 0],
        t: 0, ttl: 0.9 + Math.random() * 0.8, twk: Math.random() * 10, twinkle: Math.random() < 0.55,
      });
    }
  }
  return {
    name: "fireworks", z: 94,
    build(e) {
      parts = [];
      e.on("fireworks", (d) => {
        const [x, y] = d.p, color = d.color, R = e.R;
        burst(e, x, y, color, 1);
        setTimeout(() => burst(e, x + (Math.random() * 2 - 1) * R * 0.20, y - R * 0.14 * Math.random() - R * 0.04, color, 0.72), 210);
        setTimeout(() => burst(e, x + (Math.random() * 2 - 1) * R * 0.24, y - R * 0.02, tint(color), 0.66), 410);
      });
    },
    simulate(e) {
      if (!parts.length) return;
      const dt = e.dt, grav = e.R * 1.25, drag = Math.max(0, 1 - 2.4 * dt);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.t += dt;
        if (p.t >= p.ttl) { parts.splice(i, 1); continue; }
        if (p.flash) continue;
        p.vx *= drag; p.vy *= drag; p.vy += grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    },
    draw(e) {
      if (!parts.length) return;
      const { ctx } = e;
      ADD(ctx);
      for (const p of parts) {
        const a = p.t / p.ttl;
        if (p.flash) {
          ctx.globalAlpha = 1 - a; ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(p.x, p.y, 3 + a * p.grow, 0, TAU); ctx.fill();
          continue;
        }
        let op = 1 - a;
        if (p.twinkle) op *= 0.45 + 0.55 * Math.abs(Math.sin(p.t * 16 + p.twk));
        ctx.globalAlpha = Math.max(0, op); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
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
  function spawn(e) {
    const fromRight = Math.random() < 0.45;
    const x = fromRight ? e.W + 40 : Math.random() * e.W * 0.9;
    const y = fromRight ? Math.random() * e.H * 0.6 : -40;
    const ang = (Math.random() * 0.5 + 0.62) * Math.PI;
    const speed = (e.W + e.H) * (0.34 + Math.random() * 0.30);
    meteors.push({
      x, y, vx: Math.cos(ang) * speed, vy: Math.abs(Math.sin(ang)) * speed,
      len: 90 + Math.random() * 170, w: 1.3 + Math.random() * 1.1, hr: 1.4 + Math.random() * 1.2,
      t: 0, ttl: 0.9 + Math.random() * 0.7,
    });
  }
  return {
    name: "meteors", z: 0,
    simulate(e) {
      const dt = e.dt;
      if (e.scene.shootingStars) {
        acc += dt * (0.12 + e.scene.meteorRate * 1.5);
        let guard = 0;
        while (acc >= 1 && guard < 3) { spawn(e); acc -= 1; guard++; }
      } else acc = 0;
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]; m.t += dt;
        if (m.t >= m.ttl || m.x < -120 || m.y > e.H + 120) { meteors.splice(i, 1); continue; }
        m.x += m.vx * dt; m.y += m.vy * dt;
      }
    },
    draw(e) {
      if (!meteors.length) return;
      const { ctx } = e;
      ADD(ctx); ctx.lineCap = "round";
      for (const m of meteors) {
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.x - (m.vx / sp) * m.len, ty = m.y - (m.vy / sp) * m.len;
        const a = m.t / m.ttl;
        let op = 1;
        if (a < 0.12) op = a / 0.12; else if (a > 0.72) op = Math.max(0, 1 - (a - 0.72) / 0.28);
        ctx.globalAlpha = op;
        const grad = ctx.createLinearGradient(tx, ty, m.x, m.y);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.55, "rgba(207,227,255,0.55)");
        grad.addColorStop(1, "rgba(255,255,255,1)");
        ctx.strokeStyle = grad; ctx.lineWidth = m.w;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(m.x, m.y); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.shadowColor = "#9fc6ff"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.hr, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
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
      const [x, y] = e.hq;
      // two staggered pulse rings (2.6s period, 1.3s offset)
      for (const off of [0, 1300]) {
        const p = (((now + off) % 2600) / 2600);
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, 5 + p * 29, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // dot
      ctx.fillStyle = "#fff"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // label
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(5,6,12,0.8)";
      ctx.font = "600 14px 'Space Grotesk', system-ui, sans-serif";
      ctx.lineWidth = 3.5; ctx.strokeText(e.data.HQ.name, x + 12, y + 4);
      ctx.fillStyle = "#fff"; ctx.fillText(e.data.HQ.name, x + 12, y + 4);
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.lineWidth = 3.5; ctx.strokeText(e.data.HQ.city, x + 12, y + 20);
      ctx.fillStyle = "#5ad1ff"; ctx.fillText(e.data.HQ.city, x + 12, y + 20);
    },
  };
}

// ----------------------------------------------------------------------
export function registerDefaultLayers(engine) {
  [
    meteorsLayer(), atmosphereLayer(), orbitsBackLayer(), sphereLayer(),
    spikesLayer(), graticuleLayer(), landLayer(), nightLayer(), cityLightsLayer(),
    auroraLayer(), nodesLayer(), orbitsFrontLayer(), beamsLayer(),
    impactsLayer(), fireworksLayer(), hqLayer(),
  ].forEach((l) => engine.register(l));
}
