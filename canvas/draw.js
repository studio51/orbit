/* games.directory globe — shared Canvas2D draw helpers
 *
 * Tiny rendering utilities used by both canvas/layers.js (the core layers)
 * and canvas/cinema.js (the cinematic extras). Rendering only — no geometry,
 * no simulation.
 */

export const ADD = (ctx) => (ctx.globalCompositeOperation = 'lighter');
export const NORMAL = (ctx) => (ctx.globalCompositeOperation = 'source-over');

// A cached soft white glow sprite, blitted with drawImage instead of the very
// expensive per-point ctx.shadowBlur (which forces an offscreen blur per draw).
let _glow = null;
export function glowSprite() {
  if (_glow) return _glow;
  const S = 128,
    c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  _glow = c;
  return _glow;
}
// Soft glow of radius r at (x,y). Caller sets composite; this resets globalAlpha.
export function drawGlow(ctx, x, y, r, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}
// Render a layer's static art into an offscreen canvas once (device-pixel sized).
export function makeSprite(e, paint) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(e.W * e.dpr));
  c.height = Math.max(2, Math.round(e.H * e.dpr));
  const g = c.getContext('2d');
  g.setTransform(e.dpr, 0, 0, e.dpr, 0, 0);
  paint(g);
  return c;
}
// Blit a full-screen sprite 1:1 over the backing store (transform-independent).
export function blit(ctx, sprite, alpha, additive) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (additive) ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, 0, 0);
  ctx.restore();
}
// Trace a list of flat [x,y,x,y,…] segments into a Path2D (one subpath each).
export function pathFromSegments(segments) {
  const p = new Path2D();
  for (const s of segments) {
    p.moveTo(s[0], s[1]);
    for (let i = 2; i < s.length; i += 2) p.lineTo(s[i], s[i + 1]);
  }
  return p;
}
