# Architecture

> How Orbit is put together, and why.

## Overview

Orbit is a real-time 3D globe that draws live activity as beams arcing across a
rotating Earth toward a central HQ point. It started as the hero globe for the
[games.directory](https://games.directory) landing page and is packaged here as a
standalone, drop-in widget with no dependencies on that site.

There are two renderers over one shared core:

- **WebGPU** (`webgpu/`) is the default. A true 3D sphere, lit by the real sun,
  with five switchable [looks](LOOKS.md).
- **Canvas 2D** (`canvas/`) is the fallback for browsers without WebGPU. The WebGPU
  page hands over to it automatically and keeps your URL options.

The original SVG renderer lives on in `legacy/svg/` for reference. It still runs but
is no longer maintained.

## The WebGPU pipeline

Everything is [Three.js](https://threejs.org) WebGPU with TSL (its node shading
language), loaded from a CDN through an import map. There is no bundler and no build
step. The renderer is split into small modules that talk to the engine through one
bag of shared uniforms and one look state.

```
load        topology (world-atlas 1:50m)  →  world.js
              • land mask 4096×2048, shelf / continentality blurs, procedural city lights
              • a small tileable detail-noise texture (waves, grain, cloud erosion)
bake once   bake.js, full-screen GPU passes into half-float targets
              • land albedo + height, relief slope, ocean colour, climate, cloud field
              • Milky Way, nebula, moon, aurora noise, paper grain
every frame engine.js
              • clock, real sun position, camera rig, intro, surges, beam cadence
              • frame governor: resolution scale from frame interval and GPU time
              • compute passes: spark integration, mote advection
              • scene pass: globe, moon, sky dome, stars, clouds, aurora, atmosphere,
                beams, rings, sparks
              • post pass: bloom, chromatic fringe, scanlines, vignette, grain, tone map
```

### Why bake

The biomes, relief, ocean colour and clouds never change from frame to frame, yet
evaluating them as 3D noise per pixel cost roughly 180 noise octaves per fragment.
`bake.js` evaluates them once on the GPU into textures, so the per-frame shaders only
sample them.

The rule now is absolute: **no per-frame shader evaluates noise**. One octave of 3D
Perlin noise costs more than a millisecond per megapixel on an integrated GPU, and
the last holdouts (wave normals and grain on the globe, the aurora, the moon, the
paper backdrop) together cost more than the rest of the frame. Each has a baked
replacement:

- **Relief** uses a baked slope (the height's east and north derivatives). One sample
  gives a smooth normal at any zoom, where screen-space derivatives of the height
  gave a faceted surface.
- **Waves, grain and cloud erosion** sample one 256×256 tileable noise texture built
  on the CPU at load, scrolled and layered for motion.
- **The aurora** scrolls through a baked noise texture whose horizontal axis is
  longitude (sampled on a circle, so it wraps) and whose vertical axis is time.

### The sky

The backdrop is a camera-centred dome drawn last among the opaque objects with the
depth test on, so no sky pixel is shaded behind the globe or the moon. Three.js draws
`scene.backgroundNode` first and without a depth test, which shaded the whole screen.

Stars are about 24,000 instanced sprites sized in CSS pixels. A star costs the few
pixels it covers and stays sharp at any resolution; the per-pixel star lattice it
replaced ran for every pixel on screen and was the most expensive shader in the
frame.

### Holding the frame rate

`governor.js` holds the display's refresh rate by trading resolution, and gives the
resolution back when there is room. `main.js` measures the refresh rate while the map
downloads, and the governor keeps checking it, so a window dragged to a 120 Hz
display is picked up.

It uses two signals, because neither is enough alone:

- **The frame interval** is the truth about what reached the screen, but it is locked
  to the display. On a 60 Hz display a frame never arrives faster than 16.7 ms, so
  the interval cannot show headroom. The old scaler used only this, and once it
  stepped down it could never step back up.
- **GPU time** (`gpu-clock.js`, from timestamp queries) shows headroom. The cost is
  close to linear in pixels, so the governor jumps to the scale it predicts will fit
  instead of creeping.

When even the lowest scale cannot hold the display rate, the governor targets half of
it (60 on a 120 Hz display) and lets the resolution recover under that budget. The
settled scale is remembered, so a reload starts where the last visit ended. The logic
is dependency-free and covered by `tests/governor.test.js` against a simulated
display.

The post chain keeps 4x multisampling but discards the multisampled buffers after the
resolve (`storeMultisampledColorBuffer = false`). Storing them, the default, wrote
hundreds of megabytes per frame at retina resolution. Bloom works at a resolution
fixed in CSS pixels, since the glow is low frequency.

### Compute particles

`sparks.js` holds two systems that live entirely on the GPU:

- **Sparks** are an impact burst ring buffer. A beam landing launches one tiny
  compute dispatch that seeds a block of the buffer, and a second kernel integrates
  every spark each frame (drag, a pull back toward the planet, a soft bounce off the
  surface).
- **Motes** are about 40k ambient dust particles on differential-rotation shells,
  advected by a single kernel per frame.

The CPU never touches a particle after seeding.

### Beams

A beam is a camera-facing ribbon along a lifted great-circle arc. When it is born the
CPU writes a handful of numbers (endpoints, colour, birth time) into an instanced
attribute buffer. The whole animation (draw-on, comet trail, hold, fade) then runs in
the shader from `time - birth`, so a beam costs nothing per frame.

## Looks

A look is plain data in [`shared/looks.js`](../shared/looks.js). The shaders evaluate
each look as a branch gated by a weight uniform, and `LookState` eases those weights
and the look's numeric and colour parameters, so switching looks is a cross-fade with
no recompile. See [Looks](LOOKS.md).

## Structure

ES modules, no build step.

```
index.html          landing page (the live globe as hero, look picker, embed guide)
shared/             used by every renderer
  looks.js          the look definitions (dependency-free data)
  data.js           HQ, activity types, cities (the file you edit to customise)
  scene-schema.js   the JSON settings contract: fields, bounds, defaults, sanitiser
  config.js         defaults from the schema, sim defaults, resolveScene()
  ui.js, ui.css     panels, look lenses, ticker; the interface themes itself per look
  engine.js, geo.js, geometry.js, sim.js, util.js, fps.js
                    the 2D core (Canvas and legacy SVG) and small helpers
webgpu/             the WebGPU renderer
  main.js           entry: scene resolution, UI wiring, fallback gate
  engine.js         renderer, clock, sun, intro, surges
  governor.js       frame governor: holds the refresh rate by trading resolution
  gpu-clock.js      GPU frame time from timestamp queries
  rig.js            orbit camera: drag, fling, zoom, parallax
  world.js          topology to land / shelf / light textures
  bake.js           one-time GPU bakes: planet, sky, moon, aurora noise, paper
  earth.js          globe, clouds, atmosphere
  sky.js            the sky dome (per-look backdrops, sun) and the star sprites
  beams.js          activity beams, impact rings, HQ beacon
  sparks.js         GPU compute particles
  cosmos.js         moon, orbit rings, shooting stars, aurora
  post.js           bloom and per-look finishing
  looks.js          LookState (the eased uniforms for the look data)
  uniforms.js, tsl-util.js
canvas/             Canvas 2D renderer (the fallback)
legacy/             the original single file version and the retired SVG renderer
```

## Key decisions

- **Three.js is the one runtime dependency.** It is pinned to an exact version in the
  import map and loaded from a CDN, so the repo keeps its no-build, no-`package.json`
  shape. Hand-writing a WebGPU renderer would have cost far more than it returned.
- **Schema as the single source of truth.** Scene settings are defined once in
  [`shared/scene-schema.js`](../shared/scene-schema.js) as plain JSON-serialisable
  data, and `sanitizeScene()` validates every incoming config against it. Fields can
  be scoped to renderers with `renderers: [...]`, so each demo panel shows only what
  its renderer can draw.
- **Looks are data, not code paths.** One shader set serves every look, so adding a
  look is a data entry plus a branch, and the cross-fade is free.
- **The interface re-dresses itself.** `shared/ui.css` is built from tokens, and
  setting `data-look` on `<html>` swaps all of them.

## Shader pitfalls

These cost real debugging time, so they are written down here.

- **Shared nodes across `If` branches.** TSL emits a node where it is first used. If a
  node (or a `.toVar()`) is first used inside one look's `If`, a different look that
  reuses it reads a value that was only assigned inside the branch that did not run.
  Declare shared variables before the branches (see `globeColor` in `earth.js`), or
  give each branch its own copy of the inputs (see `inputs()` in `sky.js`).
- **`pow` with a negative base is NaN.** Metal tolerates `pow(x, 2)` for negative `x`,
  which hides the bug; other GPUs return NaN. Use `sq(x)`, clamp the base, or
  `max(x, 0)`. One NaN in an HDR buffer turns into a black blob through bloom.
- **Seed pooled instance buffers.** Dead slots with zero vectors make `normalize(0)`
  NaN. Give them valid dummy values.
- **Sampling across the longitude seam.** Derive 2D texture coordinates from the
  sphere's own continuous `uv`, not from `atan`, or the mip level jumps at the seam.

## Measuring pitfalls

Profiling this renderer went wrong in four ways before it went right.

- **Waiting on the queue is not GPU time.** `device.queue.onSubmittedWorkDone()`
  looks like a frame timer, and it tracks GPU time in a tight loop. In a vsync-locked
  loop the browser batches the frame with its compositor, so it reads about 9 ms for
  a frame the GPU finishes in 3. Use timestamp queries.
- **Pass timings do not add up on a tile-based GPU.** Apple and most mobile GPUs
  defer every pass and run them together, so each pass's timestamps span most of the
  frame. The frame time is the longest pass, not the sum. An immediate-mode GPU runs
  passes one after another, and there the sum is right. `gpu-clock.js` tells the two
  apart.
- **A lightly loaded GPU slows its clock.** The same frame reads slower when there is
  room to spare, and Low Power Mode makes it worse. Treat GPU time as a hint: a
  reading well inside the budget is trustworthy, a reading near it is not. The
  governor only makes a confident climb on the former and probes on the latter.
- **A manual render loop must advance the node frame.** Passes update once per node
  frame. Calling `pipeline.render()` in a loop without
  `renderer._nodes.nodeFrame.update()` redraws only the final quad and reports a
  frame that costs nothing.
