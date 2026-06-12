/* Orbit — Canvas2D cinematic layers
 *
 * The wow extras: the Moon, the rare comet, constellations, the ocean sun
 * glint, the HQ heartbeat and the city-surge marker. Same layer contract as
 * canvas/layers.js; registered alongside the core layers. Rendering only —
 * scheduling state machines live in each layer; orbital/sun math comes from
 * the engine's fast projection fields.
 */
import { TAU, DEG, clamp, rgba } from '../shared/util.js';
import { quadPoint } from '../shared/geometry.js';
import { ADD, NORMAL, drawGlow } from './draw.js';

const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)); // smoothstep

// ======================================================================
// The Moon — a small real moon on a distant orbit, passing behind the globe
// ======================================================================
const MOON_PERIOD = 95000; // ms per orbit

export function moonLayer() {
  let sprite = null;

  function build() {
    const S = 128,
      r = 56;

    sprite = document.createElement('canvas');
    sprite.width = sprite.height = S;

    const g = sprite.getContext('2d');

    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, r, 0, TAU);
    g.clip();

    // sunlit body
    const grad = g.createRadialGradient(S * 0.4, S * 0.36, r * 0.1, S / 2, S / 2, r);

    grad.addColorStop(0, '#f0f3f7');
    grad.addColorStop(0.55, '#c2cad6');
    grad.addColorStop(0.85, '#8a94a6');
    grad.addColorStop(1, '#5d6678');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    // maria / craters
    const spots = [
      [0.42, 0.3, 0.13, 0.18],
      [0.6, 0.48, 0.1, 0.16],
      [0.32, 0.56, 0.08, 0.2],
      [0.55, 0.7, 0.12, 0.14],
      [0.7, 0.28, 0.06, 0.2],
      [0.45, 0.46, 0.05, 0.22],
    ];

    for (const [fx, fy, fr, a] of spots) {
      g.fillStyle = `rgba(70,80,100,${a})`;
      g.beginPath();
      g.arc(S * fx, S * fy, r * fr, 0, TAU);
      g.fill();
    }
    // night-side shadow (light from upper-left, matching the scene)
    g.fillStyle = 'rgba(7,11,21,0.8)';
    g.beginPath();
    g.arc(S * 0.86, S * 0.78, r * 1.06, 0, TAU);
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(235,242,255,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(S / 2, S / 2, r - 0.5, 0, TAU);

    g.stroke();
  }

  return {
    name: 'moon',
    z: 6,
    visible: (e) => e.scene.moon,
    draw(e) {
      const { ctx, CX, CY, R, W, H, now } = e;

      if (!sprite) build();

      const ang = (now / MOON_PERIOD) * TAU + 0.9;
      const tilt = -0.16,
        ca = Math.cos(ang),
        sa = Math.sin(ang);
      const ex = ca * R * 2.3,
        ey = sa * R * 0.8;
      const mx = CX + ex * Math.cos(tilt) - ey * Math.sin(tilt);
      const my = CY - R * 0.08 + ex * Math.sin(tilt) + ey * Math.cos(tilt);
      const d = R * 0.27 * (1 - 0.12 * sa); // slightly smaller at the orbit's far side

      if (mx < -d || mx > W + d || my < -d || my > H + d) return;

      const a = e.introPhase(0.6, 0.95);

      if (a <= 0) return;
      ADD(ctx);
      drawGlow(ctx, mx, my, d * 0.85, 0.14 * a);
      NORMAL(ctx);
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, mx - d / 2, my - d / 2, d, d);

      ctx.globalAlpha = 1;
    },
  };
}

// ======================================================================
// Rare comet — a slow long-tailed wanderer, once every few minutes
// ======================================================================
export function cometLayer() {
  let active = false,
    t0 = 0,
    dur = 0,
    p0,
    cp,
    p1,
    nextAt = 0;

  return {
    name: 'comet',
    z: -2.4,
    simulate(e) {
      if (!e.scene.comet) {
        active = false;
        return;
      }
      if (nextAt === 0) nextAt = e.now + 40000 + Math.random() * 30000;
      if (!active && e.now >= nextAt && e.intro >= 1) {
        active = true;
        t0 = e.now;
        dur = 22000 + Math.random() * 6000;

        const { W, H } = e;

        p0 = [W + 160, H * (0.08 + Math.random() * 0.22)];
        p1 = [-200, H * (0.3 + Math.random() * 0.3)];
        cp = [W * (0.4 + Math.random() * 0.2), -H * 0.05];
        nextAt = e.now + 130000 + Math.random() * 110000;
      }

      if (active && e.now - t0 > dur) active = false;
    },
    draw(e) {
      if (!active) return;

      const { ctx, now } = e;
      const u = (now - t0) / dur;
      const env = Math.pow(Math.sin(Math.min(1, u) * Math.PI), 0.6);
      const head = quadPoint(p0, cp, p1, u);

      ADD(ctx);
      // dust tail — tapering glow puffs trailing the head along the path
      for (let k = 16; k >= 1; k--) {
        const uk = Math.max(0, u - k * 0.014);
        const [tx, ty] = quadPoint(p0, cp, p1, uk);
        const f = 1 - k / 17;

        drawGlow(ctx, tx, ty, f * 4.5 + 0.8, env * 0.38 * Math.pow(f, 1.5));
      }

      // ion line — a faint straight streak through the tail
      const [bx, by] = quadPoint(p0, cp, p1, Math.max(0, u - 0.21));
      const grad = ctx.createLinearGradient(bx, by, head[0], head[1]);

      grad.addColorStop(0, 'rgba(160,210,255,0)');
      grad.addColorStop(1, 'rgba(205,235,255,0.5)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = env * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(head[0], head[1]);
      ctx.stroke();
      // coma + core
      drawGlow(ctx, head[0], head[1], 8, env * 0.9);
      ctx.globalAlpha = env;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(head[0], head[1], 1.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Constellations — faint figures that shimmer into the starfield in turn
// ======================================================================
const FIGURES = [
  {
    pts: [
      [0, 0.45],
      [0.22, 0.1],
      [0.45, 0.38],
      [0.7, 0],
      [1, 0.28],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  }, // Cassiopeia
  {
    pts: [
      [0.2, 0],
      [0.75, 0.05],
      [0.36, 0.45],
      [0.5, 0.5],
      [0.64, 0.55],
      [0.15, 1],
      [0.85, 0.95],
    ],
    lines: [
      [0, 2],
      [1, 4],
      [2, 3],
      [3, 4],
      [2, 5],
      [4, 6],
    ],
  }, // Orion
  {
    pts: [
      [0.5, 0],
      [0.5, 0.35],
      [0.5, 0.75],
      [0.15, 0.45],
      [0.85, 0.25],
      [0.5, 1],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 5],
      [3, 1],
      [1, 4],
    ],
  }, // Cygnus
];
const ANCHORS = [
  [0.16, 0.2],
  [0.78, 0.64],
  [0.62, 0.12],
];
const CON_CYCLE = 42000;

export function constellationsLayer() {
  let placed = null;

  function build(e) {
    const s = Math.min(e.W, e.H) * 0.17;

    placed = FIGURES.map((f, i) => ({
      pts: f.pts.map(([fx, fy]) => [e.W * ANCHORS[i][0] + fx * s, e.H * ANCHORS[i][1] + fy * s]),
      lines: f.lines,
    }));
  }

  return {
    name: 'constellations',
    z: -2.6,
    resize(e) {
      build(e);
    },
    visible: (e) => e.scene.constellations,
    draw(e) {
      const { ctx, now } = e;

      if (!placed) build(e);

      const idx = Math.floor(now / CON_CYCLE) % placed.length;
      const p = (now % CON_CYCLE) / CON_CYCLE;
      const env = Math.min(sm(p / 0.06), 1 - sm((p - 0.5) / 0.12)) * e.introPhase(0.5, 0.9);

      if (env <= 0) return;

      const fig = placed[idx];
      // bounded pointer parallax only — figures must not drift with rotation
      const ox = -e.look.x * 3,
        oy = e.look.y * 3;
      const lp = clamp(p / 0.25, 0, 1) * fig.lines.length;

      ADD(ctx);
      ctx.strokeStyle = '#cfe0ff';
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'round';
      for (let j = 0; j < fig.lines.length; j++) {
        const seg = clamp(lp - j, 0, 1);

        if (seg <= 0) break;

        const [a, b] = fig.lines[j];
        const [ax, ay] = fig.pts[a],
          [bx, by] = fig.pts[b];

        ctx.globalAlpha = env * 0.28 * seg;
        ctx.beginPath();
        ctx.moveTo(ax + ox, ay + oy);
        ctx.lineTo(ax + (bx - ax) * seg + ox, ay + (by - ay) * seg + oy);
        ctx.stroke();
      }
      for (let j = 0; j < fig.pts.length; j++) {
        const [x, y] = fig.pts[j];
        const tw = 0.6 + 0.4 * Math.sin(now * 0.0016 + j * 1.7);

        drawGlow(ctx, x + ox, y + oy, 4.5, env * 0.5 * tw);
        ctx.globalAlpha = env * tw;
        ctx.fillStyle = '#eaf2ff';
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Ocean sun glint — soft specular sheen on the day side, tracking the sun
// ======================================================================
export function sunGlintLayer() {
  let sprite = null;

  function build() {
    const S = 256;

    sprite = document.createElement('canvas');
    sprite.width = sprite.height = S;

    const g = sprite.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);

    grad.addColorStop(0, 'rgba(255,242,214,0.55)');
    grad.addColorStop(0.3, 'rgba(255,230,190,0.18)');
    grad.addColorStop(1, 'rgba(255,225,180,0)');
    g.fillStyle = grad;

    g.fillRect(0, 0, S, S);
  }

  return {
    name: 'sunGlint',
    z: 45,
    visible: (e) => e.scene.sunGlint,
    draw(e) {
      const { ctx, CX, CY, R, now, proj } = e;

      if (!sprite) build();

      const s = proj.sunDir();

      if (s.z <= 0.05) return;

      const shimmer = 0.75 + 0.18 * Math.sin(now * 0.0021) + 0.07 * Math.sin(now * 0.00113 + 2);
      const a = Math.pow(s.z, 1.6) * 0.5 * shimmer * e.introPhase(0.5, 0.85);

      if (a <= 0.01) return;

      const px = CX + R * s.x,
        py = CY - R * s.y;

      ADD(ctx);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1.25, 0.85);
      ctx.globalAlpha = a;

      const r1 = R * 0.42;

      ctx.drawImage(sprite, -r1, -r1, r1 * 2, r1 * 2);
      ctx.globalAlpha = Math.min(1, a * 1.5);

      const r2 = R * 0.16;

      ctx.drawImage(sprite, -r2, -r2, r2 * 2, r2 * 2);
      ctx.restore();
      ctx.globalAlpha = 1;

      NORMAL(ctx);
    },
  };
}

// ======================================================================
// HQ heartbeat — a luminous wave rippling outward from HQ across the surface
// ======================================================================
const HB_PERIOD = 28000,
  HB_DUR = 2800,
  HB_MAX = 100 * DEG;
const HB_N = 96;
const HB_COS = new Float64Array(HB_N + 1),
  HB_SIN = new Float64Array(HB_N + 1);

for (let i = 0; i <= HB_N; i++) {
  const a = (i / HB_N) * TAU;

  HB_COS[i] = Math.cos(a);
  HB_SIN[i] = Math.sin(a);
}
export function heartbeatLayer() {
  let t0 = -1,
    nextAt = 0,
    hqTrig = null;

  return {
    name: 'heartbeat',
    z: 58,
    build(e) {
      const [lng, lat] = e.data.HQ.lnglat;
      const latR = lat * DEG,
        lngR = lng * DEG;

      hqTrig = {
        sinLat: Math.sin(latR),
        cosLat: Math.cos(latR),
        sinLng: Math.sin(lngR),
        cosLng: Math.cos(lngR),
      };
    },
    visible: (e) => e.scene.heartbeat,
    simulate(e) {
      if (nextAt === 0) nextAt = e.now + 12000;
      if (t0 < 0 && e.now >= nextAt && e.hqVisible && e.intro >= 1 && !e.sim.paused) {
        t0 = e.now;
        nextAt = e.now + HB_PERIOD;
      }

      if (t0 >= 0 && e.now - t0 > HB_DUR) t0 = -1;
    },
    draw(e) {
      if (t0 < 0 || !hqTrig) return;

      const { ctx, CX, CY, R, now, proj } = e;
      const p = (now - t0) / HB_DUR;
      const delta = sm(p) * HB_MAX;
      const a = Math.pow(1 - p, 0.5) * Math.min(1, p * 8);

      if (a <= 0.01) return;

      // HQ's unit vector in view space (x right, y up, z toward viewer)
      const { lon0, sinLat0, cosLat0 } = proj;
      const cosLon0 = Math.cos(lon0),
        sinLon0 = Math.sin(lon0);
      const cd = hqTrig.cosLng * cosLon0 + hqTrig.sinLng * sinLon0;
      const sd = hqTrig.sinLng * cosLon0 - hqTrig.cosLng * sinLon0;
      const hx = hqTrig.cosLat * sd;
      const hy = cosLat0 * hqTrig.sinLat - sinLat0 * hqTrig.cosLat * cd;
      const hz = sinLat0 * hqTrig.sinLat + cosLat0 * hqTrig.cosLat * cd;
      // orthonormal basis ⊥ HQ vector
      let ux = hz,
        uy = 0,
        uz = -hx;
      const ul = Math.hypot(ux, uz);

      if (ul < 1e-4) {
        ux = 1;
        uy = 0;
        uz = 0;
      } else {
        ux /= ul;
        uz /= ul;
      }

      const vx = hy * uz - hz * uy,
        vy = hz * ux - hx * uz,
        vz = hx * uy - hy * ux;
      const cD = Math.cos(delta),
        sD = Math.sin(delta);

      // trace the expanding small circle, breaking where it rounds the limb
      ADD(ctx);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const path = new Path2D();
      let pen = false;

      for (let i = 0; i <= HB_N; i++) {
        const ct = HB_COS[i],
          st = HB_SIN[i];
        const qz = hz * cD + (uz * ct + vz * st) * sD;

        if (qz <= 0.02) {
          pen = false;
          continue;
        }

        const qx = hx * cD + (ux * ct + vx * st) * sD;
        const qy = hy * cD + (uy * ct + vy * st) * sD;
        const sxp = CX + R * qx,
          syp = CY - R * qy;

        if (!pen) {
          path.moveTo(sxp, syp);
          pen = true;
        } else path.lineTo(sxp, syp);
      }
      ctx.strokeStyle = rgba('#5ad1ff', a * 0.22);
      ctx.lineWidth = 5;
      ctx.stroke(path);
      ctx.strokeStyle = rgba('#8cdfff', a * 0.75);
      ctx.lineWidth = 1.8;
      ctx.stroke(path);
      if (p < 0.3 && e.hq) drawGlow(ctx, e.hq[0], e.hq[1], 18, ((0.3 - p) / 0.3) * 0.5);

      NORMAL(ctx);
    },
  };
}

// ======================================================================
// Surge marker — pulsing rings + label on the city that's lighting up
// ======================================================================
export function surgeLayer() {
  return {
    name: 'surgeMarker',
    z: 67,
    visible: (e) => !!e.surge,
    draw(e) {
      const { ctx, now } = e;
      const s = e.surge;

      if (!s || !e.proj.visible(s.city.lnglat)) return;

      const p0 = e.proj.forward(s.city.lnglat);

      if (!p0) return;

      const [x, y] = p0;
      const a = Math.min(1, (now - s.t0) / 400) * Math.min(1, (s.until - now) / 600);

      if (a <= 0) return;
      for (const off of [0, 550]) {
        const p = ((now + off) % 1100) / 1100;

        ctx.globalAlpha = (1 - p) * 0.7 * a;
        ctx.strokeStyle = '#7cd4ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 3 + p * 22, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ADD(ctx);
      drawGlow(ctx, x, y, 10, 0.6 * a);
      NORMAL(ctx);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TAU);
      ctx.fill();
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.font = "600 12px 'Space Grotesk', system-ui, sans-serif";
      ctx.strokeStyle = 'rgba(5,6,12,0.8)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(s.city.name, x + 10, y - 8);
      ctx.fillStyle = '#bfe9ff';
      ctx.fillText(s.city.name, x + 10, y - 8);

      ctx.globalAlpha = 1;
    },
  };
}
