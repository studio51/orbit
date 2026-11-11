/* Orbit: performance readout overlay (shared)
 *
 * Smoothed frames-per-second plus frame time, so the renderers can be compared
 * honestly. The WebGPU renderer also reports what its frame governor is doing:
 * the rate it is holding, the GPU time per frame and the resolution scale.
 * Call `tick(now)` once per rendered frame.
 */

const REFRESH_MS = 250; // refresh the readout about four times a second so it stays legible

/**
 * Create the readout and add it to the page.
 *
 * @param {string} [label] renderer name shown as a tag
 * @returns {{ el: HTMLElement, tick: Function, fps: Function }} the element, the per-frame tick
 *   and a getter for the last displayed frame rate
 */
export function createFpsMeter(label = '') {
  const el = document.createElement('div');

  el.className = 'fps-meter';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Performance');
  el.innerHTML =
    `<span class="fps-cell"><span class="fps-num">–</span><span class="fps-unit">fps</span>` +
    `<span class="fps-target"></span></span>` +
    `<span class="fps-cell"><span class="fps-lbl">Frame</span><span class="fps-ms"></span></span>` +
    `<span class="fps-cell" hidden><span class="fps-lbl">Resolution</span>` +
    `<span class="fps-res"></span></span>` +
    (label ? `<span class="fps-cell fps-tag">${label}</span>` : '');
  document.body.appendChild(el);

  const numEl = el.querySelector('.fps-num');
  const targetEl = el.querySelector('.fps-target');
  const msEl = el.querySelector('.fps-ms');
  const msLbl = msEl.previousElementSibling;
  const resEl = el.querySelector('.fps-res');

  let last = 0;
  let emaMs = 16.7; // exponential moving average of frame time
  let acc = 0,
    frames = 0,
    shownAt = 0,
    shown = 0;

  return {
    el,

    /**
     * The frame rate last written to the readout.
     *
     * @returns {number} frames per second
     */
    fps: () => shown,

    /**
     * Count one rendered frame.
     *
     * @param {number} now the frame's timestamp in milliseconds
     * @param {object} [pace] governor state from the WebGPU engine
     * @param {number} [pace.scale] resolution scale, 1 = native pixels
     * @param {number} [pace.target] the frame rate being held, in hertz
     * @param {number} [pace.gpuMs] GPU time per frame in milliseconds
     * @param {boolean} [pace.pinned] whether the resolution is fixed by the user
     */
    tick(now, pace = null) {
      if (last) {
        const dt = now - last;

        emaMs = emaMs * 0.9 + dt * 0.1;
        acc += dt;
        frames++;
      }
      last = now;

      if (now - shownAt <= REFRESH_MS || !frames) return;

      const avg = acc / frames;
      const goal = pace?.target || 60;

      shown = avg > 0 ? Math.round(1000 / avg) : 0;
      numEl.textContent = shown;
      el.classList.toggle('warn', shown < goal * 0.85);
      el.classList.toggle('bad', shown < goal * 0.5);

      if (pace) {
        const timed = Number.isFinite(pace.gpuMs);

        targetEl.textContent = 'of ' + goal;
        msLbl.textContent = timed ? 'GPU' : 'Frame';
        msEl.textContent = (timed ? pace.gpuMs : emaMs).toFixed(1) + ' ms';
        resEl.textContent = Math.round(pace.scale * 100) + '%' + (pace.pinned ? '' : ' auto');
        resEl.parentElement.hidden = false;
      } else {
        msEl.textContent = emaMs.toFixed(1) + ' ms';
      }

      acc = 0;
      frames = 0;
      shownAt = now;
    },
  };
}
