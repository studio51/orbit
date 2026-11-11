/* Orbit: frame governor (WebGPU renderer)
 *
 * Holds the display's refresh rate by trading resolution, and gives the
 * resolution back as soon as there is room for it.
 *
 * It listens to two signals:
 *
 *   • the frame interval   the truth about what reached the screen. It is locked to
 *                          the display, so it shows a missed frame but never how much
 *                          room is left.
 *   • the GPU time         how long the GPU took to finish a frame. It is the only way
 *                          to see headroom, so it is what lets the scale climb again.
 *
 * The scaler it replaces used the interval alone. On a 60 Hz display a frame can never
 * arrive faster than 16.7 ms, so once that scaler stepped down it could not tell it was
 * safe to step back up, and the globe stayed soft for the rest of the session.
 *
 * The render cost is close to linear in pixels, so the governor jumps straight to the
 * scale it predicts will fit rather than creeping one step per second. When even the
 * lowest scale cannot hold the display rate it targets half of it instead (60 on a
 * 120 Hz display) and lets the resolution recover under that easier budget.
 *
 * GPU time is a hint, not a ruler. A GPU under light load lowers its clock, so the same
 * frame reads slower when there is room to spare. Readings well inside the budget are
 * trusted for a confident climb; readings merely inside it earn a single probing step,
 * and a probe that misses frames is undone and retried less and less often.
 *
 * This module is dependency-free logic, so it runs under `node --test`.
 */

/** Standard display refresh rates, used to snap a measured cadence. */
export const RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];

/** Resolution steps as a fraction of the native pixel ratio (each is about 1.3x the pixels). */
export const LADDER = [0.5, 0.58, 0.66, 0.75, 0.86, 1];

const WINDOW_S = 0.5; // seconds of frames per decision
const SLOW_FRAME = 1.5; // an interval this many budgets long counts as a missed frame
const MISS_LIMIT = 0.25; // share of missed frames that means "over budget"
const OVER_AVG = 1.2; // mean interval, in budgets, that means "over budget"
const GPU_BOUND = 0.7; // GPU time, in budgets, above which a slow window is the GPU's fault
const HEADROOM = 0.62; // GPU time, in budgets, below which a climb is confident
const PROBE_ROOM = 0.88; // GPU time, in budgets, below which a single probing step is allowed
const AIM_DOWN = 0.8; // budget share to aim for when stepping down
const AIM_UP = 0.78; // budget share to aim for when stepping up
const MAX_STEP_UP = 2; // ladder steps per confident climb
const HOLD_MIN_S = 1.5; // shortest wait before a climb
const HOLD_PROBE_S = 10; // shortest wait before a probing step
const HOLD_MAX_S = 240; // longest wait, reached by repeated failed climbs
const SETTLE_FRAMES = 10; // frames ignored after a change (buffers are being reallocated)
const FORGIVE_WINDOWS = 120; // calm windows (a minute) before a failed climb is half forgiven
const IDLE_MS = 250; // an interval this long means the tab was hidden
const MIN_TARGET = 30; // never aim below this rate

/**
 * Snap a frame interval to the nearest standard refresh rate.
 *
 * @param {number} ms frame interval in milliseconds
 * @returns {number} the nearest rate in hertz
 */
export function snapRate(ms) {
  const hz = 1000 / ms;
  let best = RATES[0];

  for (const r of RATES) if (Math.abs(r - hz) < Math.abs(best - hz)) best = r;

  return best;
}

/**
 * Measure the display's refresh rate from the animation-frame cadence.
 * Call it while the page is idle (for instance while the world map downloads).
 *
 * @param {number} [frames] how many intervals to sample
 * @param {number} [timeoutMs] give up after this long (a hidden tab gets no frames)
 * @returns {Promise<number>} the refresh rate in hertz, 60 when it cannot be measured
 */
export function probeRefresh(frames = 24, timeoutMs = 600) {
  return new Promise((resolve) => {
    const seen = [];
    let last = 0,
      done = false;
    const finish = () => {
      if (done) return;

      done = true;
      seen.sort((a, b) => a - b);

      // the lower quartile: slow frames are noise, the display cannot run fast by accident
      resolve(seen.length >= 6 ? snapRate(seen[Math.floor(seen.length / 4)]) : 60);
    };

    const tick = (t) => {
      if (done) return;
      if (last) seen.push(t - last);

      last = t;

      if (seen.length >= frames) finish();
      else requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    setTimeout(finish, timeoutMs);
  });
}

/**
 * Adaptive resolution controller that holds a display's refresh rate.
 */
export class FrameGovernor {
  #n = 0; // frames in the current window

  #sum = 0; // summed intervals

  #slow = 0; // missed frames

  #gpuSum = 0; // summed GPU times

  #gpuN = 0; // GPU samples

  #fast = []; // intervals, for tracking the display's own cadence

  #skip = SETTLE_FRAMES; // frames still to ignore

  #sinceChange = 0; // seconds since the scale last changed

  #hold = HOLD_MIN_S; // seconds to wait before the next climb

  #climbed = false; // the last change was a climb, so a miss now means it was too far

  #before = 1; // the scale before the last climb, to return to if it fails

  #stuck = 0; // consecutive over-budget windows at the lowest scale

  #mismatch = 0; // consecutive windows slower than the display with an idle GPU

  #calm = 0; // consecutive windows with nothing to do

  #pinned = null; // fixed scale, or null for automatic

  /**
   * @param {object} [args] options
   * @param {number} [args.refresh] the display's refresh rate in hertz
   * @param {number} [args.scale] the scale to start from
   * @param {number[]} [args.ladder] allowed scales, ascending
   */
  constructor({ refresh = 60, scale = 1, ladder = LADDER } = {}) {
    this.ladder = ladder;
    this.refresh = refresh; // the display's rate (Hz)
    this.target = refresh; // the rate being held (the display's, or half of it)
    this.scale = this.#snap(scale); // current resolution scale
    this.gpuMs = NaN; // smoothed GPU frame time
    this.frameMs = 1000 / refresh; // smoothed frame interval
  }

  /** Frame budget at the current target, in milliseconds. */
  get budget() {
    return 1000 / this.target;
  }

  /** Whether the scale is fixed by `pin()`. */
  get pinned() {
    return this.#pinned !== null;
  }

  /**
   * Fix the scale, or hand control back.
   *
   * @param {number|null} scale a scale to hold, or null for automatic
   * @returns {number} the scale now in effect
   */
  pin(scale) {
    this.#pinned = scale === null ? null : Math.min(1, Math.max(this.ladder[0], scale));
    this.scale = this.#pinned ?? this.#snap(this.scale); // back on the ladder when released

    this.#reset();
    this.#skip = SETTLE_FRAMES;

    return this.scale;
  }

  /**
   * Feed one frame. Returns the new scale when it changes.
   *
   * @param {number} intervalMs time since the previous frame, in milliseconds
   * @param {number} [gpuMs] GPU time of a recent frame, NaN when unknown
   * @returns {number|null} the scale to apply, or null when nothing changed
   */
  sample(intervalMs, gpuMs = NaN) {
    if (!(intervalMs > 0) || intervalMs > IDLE_MS) {
      this.#reset(); // hidden tab or first frame: the window is meaningless

      return null;
    }

    this.frameMs += (intervalMs - this.frameMs) * 0.1;

    if (Number.isFinite(gpuMs)) {
      this.gpuMs = Number.isFinite(this.gpuMs) ? this.gpuMs + (gpuMs - this.gpuMs) * 0.2 : gpuMs;
    }

    if (this.#skip > 0) {
      this.#skip--;

      return null;
    }

    this.#n++;
    this.#sum += intervalMs;
    this.#fast.push(intervalMs);
    this.#sinceChange += intervalMs / 1000;
    if (intervalMs > this.budget * SLOW_FRAME) this.#slow++;

    if (Number.isFinite(gpuMs)) {
      this.#gpuSum += gpuMs;
      this.#gpuN++;
    }

    if (this.#sum < WINDOW_S * 1000) return null;

    return this.#decide();
  }

  // One decision per window.
  #decide() {
    const avg = this.#sum / this.#n;
    const miss = this.#slow / this.#n;
    const gpu = this.#gpuN ? this.#gpuSum / this.#gpuN : NaN;
    const known = Number.isFinite(gpu);
    const cadence = this.#fast.sort((a, b) => a - b)[Math.floor(this.#fast.length * 0.2)];

    this.#reset();

    // A cadence clearly quicker than the assumed display means a faster display.
    if (cadence < (1000 / this.refresh) * 0.85 && snapRate(cadence) > this.refresh) {
      this.refresh = this.target = snapRate(cadence);
      this.#mismatch = 0;

      return null;
    }

    const budget = this.budget;
    const over = miss > MISS_LIMIT || avg > budget * OVER_AVG;

    // Slow frames with an idle GPU are not a rendering problem: the display (or the browser)
    // runs slower than assumed. Resolution cannot fix that, so follow the cadence instead.
    if (over && known && gpu < budget * 0.5) {
      if (++this.#mismatch >= 3) {
        this.refresh = this.target = snapRate(avg);
        this.#mismatch = 0;
      }

      return null;
    }
    this.#mismatch = 0;

    if (this.#pinned !== null) return null;

    if (over && (!known || gpu > budget * GPU_BOUND)) return this.#stepDown(known ? gpu : avg);

    this.#stuck = 0;

    if (!over) {
      const up = this.#stepUp(gpu, known);

      if (up !== null) return up;
    }

    // a long calm spell forgives earlier failed climbs
    if (++this.#calm >= FORGIVE_WINDOWS) {
      this.#calm = 0;
      this.#hold = Math.max(HOLD_MIN_S, this.#hold / 2);
    }

    return null;
  }

  // Drop to the scale predicted to fit; when there is nowhere left to go, halve the target.
  #stepDown(cost) {
    const budget = this.budget;
    const i = this.ladder.indexOf(this.scale);

    this.#calm = 0;

    if (this.#climbed && this.#sinceChange < WINDOW_S * 5) {
      // That climb was a step too far: undo exactly it, and wait longer before the next try.
      this.#climbed = false;
      this.#hold = Math.min(HOLD_MAX_S, Math.max(HOLD_PROBE_S, this.#hold * 2));

      return this.#apply(this.#before);
    }
    this.#climbed = false;

    if (i <= 0) {
      if (++this.#stuck >= 2 && this.target / 2 >= MIN_TARGET) {
        this.target /= 2;
        this.#stuck = 0;
        this.#hold = HOLD_MIN_S;
      }

      return null;
    }

    const want = this.scale * Math.sqrt((budget * AIM_DOWN) / Math.max(cost, budget * 1.05));
    let next = i - 1;

    while (next > 0 && this.ladder[next] > want) next--;

    return this.#apply(this.ladder[next]);
  }

  // Climb when the GPU has room, or return to the full display rate when there is plenty.
  #stepUp(gpu, known) {
    const budget = this.budget;
    const i = this.ladder.indexOf(this.scale);
    const top = this.ladder.length - 1;

    if (this.target < this.refresh && known && i >= top - 1 && gpu < (1000 / this.refresh) * 0.5) {
      this.target = this.refresh; // enough room to try the display's own rate again

      return null;
    }

    if (i >= top) return null;

    const confident = known && gpu < budget * HEADROOM;
    const wait = confident ? this.#hold : Math.max(HOLD_PROBE_S, this.#hold);

    if (this.#sinceChange < wait) return null;
    if (known && gpu > budget * PROBE_ROOM) return null;

    let next = i + 1;

    if (confident) {
      const want = this.scale * Math.sqrt((budget * AIM_UP) / Math.max(gpu, 0.1));

      while (next < top && next - i < MAX_STEP_UP && this.ladder[next + 1] <= want) next++;
    }

    this.#climbed = true;
    this.#before = this.scale;

    return this.#apply(this.ladder[next]);
  }

  #apply(scale) {
    if (scale === this.scale) return null;

    this.scale = scale;
    this.#sinceChange = 0;
    this.#skip = SETTLE_FRAMES;
    this.#calm = 0;

    return scale;
  }

  #reset() {
    this.#n = this.#sum = this.#slow = this.#gpuSum = this.#gpuN = 0;
    this.#fast = [];
  }

  // Nearest ladder step at or below a scale.
  #snap(scale) {
    let best = this.ladder[0];

    for (const s of this.ladder) if (s <= scale + 1e-6) best = s;

    return best;
  }
}
