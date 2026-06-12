/* Orbit — small pure helpers (shared by both renderers) */

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// easeInOutCubic — eases in and settles gently
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Parse "#rgb" / "#rrggbb" into [r, g, b] (0–255).
export function hexToRgb(hex) {
  let c = (hex || '#ffffff').replace('#', '');

  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];

  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

// Lighten a colour toward white (used for spark/comet highlights).
export function tint(hex, amount = 0.5) {
  const [r, g, b] = hexToRgb(hex);
  const m = (x) => Math.round(x + (255 - x) * amount);

  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// "#rrggbb" + alpha → "rgba(...)" for canvas fills/strokes.
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);

  return `rgba(${r},${g},${b},${a})`;
}

// Weighted random pick. `items` each expose `.weight` (default 1).
export function weightedPick(items, weightOf = (t) => t.weight || 1) {
  let total = 0;

  for (const it of items) total += weightOf(it);

  let r = Math.random() * total;

  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }

  return items[items.length - 1];
}
