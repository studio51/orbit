/* Orbit: frame governor behaviour.
 *
 * The governor is pure logic, so these drive it with a simulated display: a GPU whose
 * frame cost grows with the pixel count, and a vsync that rounds every frame up to the
 * next refresh. They guard the properties the renderer depends on: it holds the display
 * rate, it gives resolution back, and a 60 Hz display never traps it at a low scale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameGovernor, LADDER, snapRate } from '../webgpu/governor.js';

/**
 * Run a governor against a simulated display for a while.
 *
 * @param {FrameGovernor} gov the governor under test
 * @param {object} sim the simulated machine
 * @param {number} sim.hz the display's real refresh rate
 * @param {function(number): number} sim.cost GPU milliseconds per frame at a scale
 * @param {number} sim.seconds how long to run
 * @param {boolean} [sim.clock] whether GPU timings are available
 * @returns {{ changes: number[] }} every scale the governor moved to
 */
function run(gov, { hz, cost, seconds, clock = true }) {
  const period = 1000 / hz;
  const changes = [];
  let t = 0;

  while (t < seconds * 1000) {
    const gpu = cost(gov.scale);
    const interval = Math.max(1, Math.ceil(gpu / period - 1e-9)) * period; // vsync rounds up
    const next = gov.sample(interval, clock ? gpu : NaN);

    if (next !== null) changes.push(next);
    t += interval;
  }

  return { changes };
}

const linear = (fixed, perScale) => (s) => fixed + perScale * s * s; // cost grows with pixels

test('snapRate picks the nearest standard refresh rate', () => {
  assert.equal(snapRate(16.67), 60);
  assert.equal(snapRate(8.33), 120);
  assert.equal(snapRate(6.94), 144);

  assert.equal(snapRate(11.2), 90);
});

test('a frame that fits is left at full resolution', () => {
  const gov = new FrameGovernor({ refresh: 120 });
  const { changes } = run(gov, { hz: 120, cost: linear(1, 4), seconds: 20 });

  assert.equal(gov.scale, 1);
  assert.equal(gov.target, 120);

  assert.deepEqual(changes, []);
});

test('an expensive frame trades resolution to hold 120 Hz', () => {
  const gov = new FrameGovernor({ refresh: 120 });
  const cost = linear(1.5, 14); // 15.5 ms at full resolution: half the display rate

  run(gov, { hz: 120, cost, seconds: 20 });

  assert.equal(gov.target, 120);
  assert.ok(gov.scale < 1, 'it scaled down');

  assert.ok(cost(gov.scale) <= 1000 / 120, `the settled scale ${gov.scale} fits the budget`);
});

test('it reaches the settled scale quickly, without creeping', () => {
  const gov = new FrameGovernor({ refresh: 120 });
  const cost = linear(1.5, 14);
  const { changes } = run(gov, { hz: 120, cost, seconds: 3 });

  assert.ok(cost(gov.scale) <= 1000 / 120, 'settled inside three seconds');

  assert.ok(changes.length <= 3, `took ${changes.length} changes`);
});

test('resolution comes back when the load eases', () => {
  const gov = new FrameGovernor({ refresh: 120 });
  let heavy = true;
  const cost = (s) => (heavy ? linear(1.5, 14)(s) : linear(1, 4)(s));

  run(gov, { hz: 120, cost, seconds: 10 });
  assert.ok(gov.scale < 1);

  heavy = false;
  run(gov, { hz: 120, cost, seconds: 30 });

  assert.equal(gov.scale, 1);
});

test('a 60 Hz display does not trap the scale low', () => {
  // The old scaler needed frames faster than 14.5 ms to step up, which vsync at 60 Hz
  // never delivers. With GPU timings the governor sees the room and climbs.
  const gov = new FrameGovernor({ refresh: 60, scale: 0.5 });

  run(gov, { hz: 60, cost: linear(1, 5), seconds: 30 });

  assert.equal(gov.scale, 1);
});

test('without GPU timings it still climbs, by probing', () => {
  const gov = new FrameGovernor({ refresh: 60, scale: 0.5 });

  run(gov, { hz: 60, cost: linear(1, 5), seconds: 90, clock: false });

  assert.equal(gov.scale, 1);
});

test('a failed probe is undone and not retried at once', () => {
  const gov = new FrameGovernor({ refresh: 120, scale: 0.75 });
  // fits at 0.75 (7.2 ms) with too little room to be confident; 0.86 (9.1 ms) misses
  const { changes } = run(gov, { hz: 120, cost: linear(1.5, 10.2), seconds: 60 });

  assert.equal(gov.scale, 0.75);
  assert.ok(changes.length >= 2, 'it probed at least once');

  assert.ok(changes.length <= 8, `it backed off instead of flapping (${changes.length} changes)`);
});

test('when even the lowest scale cannot hold the display rate it targets half', () => {
  const gov = new FrameGovernor({ refresh: 120 });

  run(gov, { hz: 120, cost: linear(9, 12), seconds: 20 }); // 9 ms before a single pixel

  assert.equal(gov.target, 60);

  assert.ok(gov.scale >= LADDER[0]);
});

test('a slower display than assumed is recognised, not blamed on the GPU', () => {
  const gov = new FrameGovernor({ refresh: 120 });

  run(gov, { hz: 60, cost: linear(1, 2), seconds: 10 });

  assert.equal(gov.refresh, 60);

  assert.equal(gov.scale, 1, 'resolution was not sacrificed for a rate the display cannot show');
});

test('a faster display than assumed is picked up', () => {
  const gov = new FrameGovernor({ refresh: 60 });

  run(gov, { hz: 120, cost: linear(1, 2), seconds: 5 });

  assert.equal(gov.refresh, 120);

  assert.equal(gov.target, 120);
});

test('a pinned scale is held whatever the load', () => {
  const gov = new FrameGovernor({ refresh: 120 });

  gov.pin(0.75);
  run(gov, { hz: 120, cost: linear(1.5, 30), seconds: 10 });

  assert.equal(gov.scale, 0.75);
  assert.equal(gov.pinned, true);

  gov.pin(null);

  assert.ok(LADDER.includes(gov.scale), 'released back onto the ladder');
});

test('a hidden tab does not count as slow frames', () => {
  const gov = new FrameGovernor({ refresh: 60 });

  for (let i = 0; i < 400; i++) gov.sample(i % 40 === 0 ? 5000 : 16.67, 3);

  assert.equal(gov.scale, 1);
});
