/* games.directory globe — simulation (shared by both renderers)
 *
 * Renderer-agnostic decisions and physics, operating on plain numbers. The
 * renderers own the visual objects (canvas data / svg nodes) but defer *what
 * happens* to these helpers, so the behaviour can't drift between builds.
 */
import { weightedPick, tint } from "./util.js";

// ---- beams -------------------------------------------------------------
// Calm-and-majestic pacing: a slow, graceful draw with a long dissolve.
export const BEAM = { DRAW_MS: 1800, HOLD_MS: 700, FADE_MS: 1100 };
BEAM.LIFE_MS = BEAM.DRAW_MS + BEAM.HOLD_MS + BEAM.FADE_MS;

// Choose the next beam's activity type (weighted) + a visible source city.
// During a city surge, ~70% of beams originate from the surging city.
export function pickBeam(e) {
  if (!e.proj.visible(e.data.HQ.lnglat)) return null; // can't land if HQ faces away
  const enabled = e.data.ACTIVITY_TYPES.filter((t) => e.state.types[t.id].enabled);
  if (!enabled.length) return null;
  const type = weightedPick(enabled, (t) => e.state.types[t.id].weight || 1);
  let city = null;
  if (e.surge && e.surge.until > e.now && Math.random() < 0.7 && e.proj.visible(e.surge.city.lnglat)) {
    city = e.surge.city;
  }
  for (let k = 0; !city && k < 8; k++) {
    const c = e.data.CITIES[(Math.random() * e.data.CITIES.length) | 0];
    if (e.proj.visible(c.lnglat)) { city = c; break; }
  }
  return city ? { type, city } : null;
}
// Draw → hold → fade opacity envelope for a beam of the given age (ms).
export function beamEnvelope(age) {
  const tail = BEAM.DRAW_MS + BEAM.HOLD_MS;
  return age > tail ? Math.max(0, 1 - (age - tail) / BEAM.FADE_MS) : 1;
}

// ---- meteors -----------------------------------------------------------
export function spawnMeteorParams(W, H) {
  const fromRight = Math.random() < 0.45;
  const x = fromRight ? W + 40 : Math.random() * W * 0.9;
  const y = fromRight ? Math.random() * H * 0.6 : -40;
  const ang = (Math.random() * 0.5 + 0.62) * Math.PI; // ~112°–203°: down & left
  const speed = (W + H) * (0.26 + Math.random() * 0.22);
  return {
    x, y, vx: Math.cos(ang) * speed, vy: Math.abs(Math.sin(ang)) * speed,
    len: 90 + Math.random() * 170, w: 1.3 + Math.random() * 1.1, hr: 1.4 + Math.random() * 1.2,
    t: 0, ttl: 1.1 + Math.random() * 0.8,
  };
}
// Advance a meteor; returns false once it should be removed.
export function stepMeteor(m, dt, H) {
  m.t += dt;
  if (m.t >= m.ttl || m.x < -120 || m.y > H + 120) return false;
  m.x += m.vx * dt; m.y += m.vy * dt;
  return true;
}
export function meteorOpacity(m) {
  const a = m.t / m.ttl;
  if (a < 0.12) return a / 0.12;
  if (a > 0.72) return Math.max(0, 1 - (a - 0.72) / 0.28);
  return 1;
}

// ---- fireworks ---------------------------------------------------------
// One burst: a flash spec + N spark specs (numeric only; caller sets x/y = cx/cy).
export function fireworkBurst(R, scale = 1, color) {
  const cols = [color, "#ffffff", tint(color)];
  const N = Math.round(48 * scale);
  const sparks = [];
  for (let i = 0; i < N; i++) {
    const ang = Math.random() * Math.PI * 2, core = i < N * 0.28;
    const speed = (0.42 + Math.random() * 0.95) * R * 1.7 * scale * (core ? 1.3 : 1);
    sparks.push({
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      r: core ? 1.5 : 2.1, color: core ? "#fff" : cols[(Math.random() * cols.length) | 0],
      t: 0, ttl: 0.9 + Math.random() * 0.8, twk: Math.random() * 10, twinkle: Math.random() < 0.55,
    });
  }
  return { flash: { t: 0, ttl: 0.34, grow: R * 0.46 * scale }, sparks };
}
// The 3-stage barrage: where/when each burst fires (offsets from the impact point).
export function fireworkBarrage(R, color) {
  const rx = (m) => (Math.random() * 2 - 1) * R * m;
  return [
    { delay: 0,   dx: 0,         dy: 0,                                   color,        scale: 1 },
    { delay: 210, dx: rx(0.20),  dy: -R * 0.14 * Math.random() - R * 0.04, color,        scale: 0.72 },
    { delay: 410, dx: rx(0.24),  dy: -R * 0.02,                            color: tint(color), scale: 0.66 },
  ];
}
// Integrate one spark (gravity + drag). No-op for the flash.
export function stepFirework(p, dt, R) {
  if (p.flash) return;
  const drag = Math.max(0, 1 - 2.4 * dt);
  p.vx *= drag; p.vy *= drag; p.vy += R * 1.25 * dt;
  p.x += p.vx * dt; p.y += p.vy * dt;
}
export function fireworkAlpha(p) {
  const a = p.t / p.ttl;
  if (p.flash) return 1 - a;
  let op = 1 - a;
  if (p.twinkle) op *= 0.45 + 0.55 * Math.abs(Math.sin(p.t * 16 + p.twk));
  return Math.max(0, op);
}
