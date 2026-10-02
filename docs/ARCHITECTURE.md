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
bake once   bake.js, full-screen GPU passes into half-float targets
              • land albedo + height, ocean colour, climate, cloud field, Milky Way, nebula
every frame engine.js
              • clock, real sun position, camera rig, intro, surges, beam cadence
              • compute passes: spark integration, mote advection
              • scene pass: sky, globe, clouds, atmosphere, beams, rings, sparks, cosmos
              • post pass: bloom, chromatic fringe, scanlines, vignette, grain, tone map
```

### Why bake

The biomes, relief, ocean colour and clouds never change from frame to frame, yet
evaluating them as 3D noise per pixel cost roughly 180 noise octaves per fragment.
`bake.js` evaluates them once on the GPU into equirectangular textures, so the
per-frame globe shader only samples them. That change took the globe from 50 fps at
the lowest adaptive quality to a steady 60 fps at full resolution on the same
machine.

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
index.html          landing page (live preview, look picker)
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
  engine.js         renderer, clock, sun, intro, surges, adaptive resolution
  rig.js            orbit camera: drag, fling, zoom, parallax
  world.js          topology to land / shelf / light textures
  bake.js           one-time GPU bakes of the static planet and sky
  earth.js          globe, clouds, atmosphere
  sky.js            stars, nebula, sun glare, per-look backdrops
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
