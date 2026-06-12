# Architecture

> How orbit is put together, and why.

## Overview

Orbit is a real-time, interactive 3D globe built as the centerpiece hero for the
[games.directory](https://games.directory) landing page. It visualizes live
gaming activity from around the world as luminous beams arcing across an
accurately-rendered rotating Earth, converging on a central HQ point.

This repo is that globe **extracted from games.directory as a standalone,
self-contained widget** — a drop-in "plugin" with no dependencies on the rest of
the site. Anyone can clone it, open it in a browser, and play with the live
controls, or drop it into their own landing page and point it at their own HQ,
cities, and activity types (see [`shared/data.js`](../shared/data.js)).

What the globe renders, in layers:

- **Core visualization** — an orthographic, geographically-accurate globe (D3 geo
  projection) with dotted-relief landmasses, drag-to-spin interaction, and
  continuous auto-rotation; **activity beams** that fire from real city
  coordinates toward HQ, each colored and labeled by activity type, with a live
  event feed alongside; and impact flashes / fireworks when beams land.
- **Atmosphere & realism** — a day/night terminator with adjustable darkness and
  twinkling city lights on the dark side, an atmospheric rim glow that gently
  breathes, an edge corona, a latitude/longitude grid, and an aurora effect with
  tunable intensity, latitude, speed, and color scheme.
- **Cosmic dazzle** — a parallax starfield (two drifting, out-of-phase twinkling
  layers), shooting stars / meteors, comet trails on the activity beams, and
  orbital rings and star nodes.

## Two renderers, one core

Orbit ships **rendered two ways** — a **Canvas 2D** build and an **SVG** build —
over a shared core, so the two strategies can be compared head-to-head:

- **Canvas** is the recommended one: the highest, most stable frame rate.
- **SVG** keeps the original vector-crisp look.

The two renderers share _everything_ except the actual painting. Geometry,
simulation, the engine, data, config and UI all live in `shared/`, so there's no
duplicated logic. Each renderer's `engine.js` (~30–80 lines) and `layers.js` are
**rendering only** — all behaviour comes from `shared/`.

A `BaseEngine` owns the viewport, clock, rotation, drag, sun and an event bus;
each renderer is a thin subclass that fills in a few backend hooks. Every visual
element is a self-contained **layer** (`{ name, z, build, resize, simulate,
draw }`) drawn in z-order.

## Structure

ES modules, no build step.

```
index.html        chooser + side-by-side compare
shared/           used by BOTH renderers
  data.js         HQ, activity types, cities — the file you edit to customise
  scene-schema.js the JSON settings contract: fields, bounds, defaults, sanitiser
  config.js       scene defaults (from schema), sim defaults, resolveScene()
  engine.js       BaseEngine: loop, layer registry, rotation, drag, spawn cadence
  geo.js          Projection (d3.geoOrthographic) + fast projection + sun
  geometry.js     pure geometry: orbit/aurora bands, land/spike/node builds, arc math
  sim.js          simulation: beam pick, particle physics, firework/meteor specs
  util.js         easing / colour / weighted pick
  ui.js           scene panel, activity list, controls, ticker (pure DOM)
  fps.js          live FPS meter
  ui.css          shared chrome styling
canvas/           engine subclass + rendering-only layers + entry   ← recommended
svg/              engine subclass + rendering-only layers + entry    (the original look)
legacy/           the original single-file version, kept for reference
```

## Key decisions

- **Shared core, thin renderers.** Behaviour lives once in `shared/`; the
  per-renderer code only paints. Adding an effect = write a layer factory in
  `canvas/layers.js` (and/or `svg/layers.js`, using the shared geometry/sim
  helpers) and register it in `registerDefaultLayers()`.
- **Schema as the single source of truth.** Scene settings are defined once in
  [`shared/scene-schema.js`](../shared/scene-schema.js) as plain,
  JSON-serialisable data — every field's type, label, bounds and default.
  Defaults are derived from the schema, so there's no second copy to drift, and
  `sanitizeScene()` validates every incoming config against it (see
  [Usage → Configuration](USAGE.md#configuration)).
- **No build step, minimal dependencies.** Plain ES modules; D3 v7 and
  `topojson-client` load from a CDN, and world landmass topology (`world-atlas`)
  is fetched at runtime with fallback CDNs.
