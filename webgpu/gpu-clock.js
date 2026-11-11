/* Orbit: GPU frame clock (WebGPU renderer)
 *
 * Measures how long the GPU really spends on a frame, from WebGPU timestamp
 * queries. The frame governor needs this to see headroom: the interval between
 * frames is locked to the display, so it shows a missed frame but never how far
 * inside the budget a frame was.
 *
 * Two things here are not obvious:
 *
 *   • Waiting on the queue (`onSubmittedWorkDone`) does not measure GPU time in a
 *     vsync-locked loop. The browser batches the frame's work with its compositor,
 *     so it reads about 9 ms for a frame the GPU finishes in 3.
 *   • Per-pass timings do not simply add up. A tile-based GPU (Apple, most phones)
 *     defers every pass and runs them together, so each pass spans most of the frame
 *     and the frame time is the LONGEST pass. An immediate-mode GPU runs passes one
 *     after another, so the frame time is their SUM. The clock tells the two apart
 *     from how far the sum exceeds the longest pass.
 *
 * It reads Three.js's timestamp pool, which is internal API. Three.js is pinned, and
 * every access is guarded: if the pool is missing or changes shape the clock reports
 * itself unavailable and the governor falls back to probing.
 */

const POLL_FRAMES = 12; // resolve the queries this often
const OVERLAP_PER_PASS = 0.45; // sum / longest above this share of the pass count means "overlapping"
const OVERLAP_MIN = 2.5; // and never below this ratio

/**
 * Create a GPU frame clock for a renderer created with `trackTimestamp: true`.
 *
 * @param {THREE.WebGPURenderer} renderer an initialised renderer
 * @returns {{ available: boolean, poll: Function, take: Function }} the clock:
 *   `poll()` once per frame, `take()` returns the newest GPU frame time in milliseconds
 *   (NaN when there is none) and clears it
 */
export function createGpuClock(renderer) {
  const backend = renderer.backend;
  const clock = {
    available: !!(backend?.trackTimestamp && backend.timestampQueryPool),
    poll,
    take,
  };
  let frames = 0,
    busy = false,
    fresh = NaN,
    overlap = NaN; // smoothed (sum / longest) / passes: near 1 when every pass spans the frame

  /** Count a frame and, every few frames, resolve the pending queries. */
  function poll() {
    if (!clock.available || busy || ++frames < POLL_FRAMES) return;

    frames = 0;
    busy = true;

    renderer.resolveTimestampsAsync('render').then(read, fail);
  }

  /**
   * Take the newest measurement.
   *
   * @returns {number} GPU frame time in milliseconds, NaN when nothing new was measured
   */
  function take() {
    const v = fresh;

    fresh = NaN;

    return v;
  }

  function read() {
    busy = false;

    try {
      const pool = backend.timestampQueryPool.render; // created by the first timed pass

      const longest = new Map(),
        total = new Map(),
        count = new Map();

      for (const [uid, ms] of pool.timestamps) {
        const f = uid.slice(uid.lastIndexOf(':f') + 2);

        if (!(ms >= 0) || ms > 1000) continue; // a wrapped or unresolved query

        longest.set(f, Math.max(longest.get(f) || 0, ms));
        total.set(f, (total.get(f) || 0) + ms);
        count.set(f, (count.get(f) || 0) + 1);
      }

      if (!longest.size) return;

      let sumLongest = 0,
        sumTotal = 0,
        passes = 0;

      for (const f of longest.keys()) {
        sumLongest += longest.get(f);
        sumTotal += total.get(f);
        passes += count.get(f);
      }

      const n = longest.size;
      const ratio = sumTotal / Math.max(sumLongest, 1e-3) / Math.max(passes / n, 1);

      overlap = Number.isFinite(overlap) ? overlap + (ratio - overlap) * 0.3 : ratio;

      const overlapping =
        overlap > OVERLAP_PER_PASS && sumTotal / Math.max(sumLongest, 1e-3) > OVERLAP_MIN;

      fresh = (overlapping ? sumLongest : sumTotal) / n;
    } catch (e) {
      clock.available = false; // the pool changed shape: stop trusting it
    }
  }

  function fail() {
    busy = false;
    clock.available = false;
  }

  return clock;
}
