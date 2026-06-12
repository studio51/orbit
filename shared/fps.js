/* Orbit — FPS meter overlay (shared)
 *
 * Smoothed frames-per-second plus frame time, so the canvas and SVG builds can
 * be compared honestly. Call tick(now) once per rendered frame.
 */
export function createFpsMeter(label = '') {
  const el = document.createElement('div');

  el.className = 'fps-meter';
  el.innerHTML =
    `<span class="fps-num">–</span><span class="fps-unit">fps</span>` +
    `<span class="fps-ms"></span>` +
    (label ? `<span class="fps-tag">${label}</span>` : '');
  document.body.appendChild(el);

  const numEl = el.querySelector('.fps-num');
  const msEl = el.querySelector('.fps-ms');

  let last = 0;
  let emaMs = 16.7; // exponential moving average of frame time
  let acc = 0,
    frames = 0,
    shownAt = 0;

  return {
    el,
    tick(now) {
      if (last) {
        const dt = now - last;

        emaMs = emaMs * 0.9 + dt * 0.1;
        acc += dt;
        frames++;
      }
      last = now;
      // refresh the readout ~4×/s so it stays legible
      if (now - shownAt > 250 && frames) {
        const avg = acc / frames;
        const fps = avg > 0 ? Math.round(1000 / avg) : 0;

        numEl.textContent = fps;
        msEl.textContent = emaMs.toFixed(1) + ' ms';
        el.classList.toggle('warn', fps < 50);
        el.classList.toggle('bad', fps < 30);
        acc = 0;
        frames = 0;
        shownAt = now;
      }
    },
  };
}
