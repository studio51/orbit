# games.directory — Activity Globe

A real-time, interactive 3D globe built as the centerpiece hero for the
[games.directory](https://games.directory) landing page. It visualizes live
gaming activity from around the world as luminous beams arcing across an
accurately-rendered rotating Earth, converging on a central HQ point.

This repo is that globe **extracted from games.directory as a standalone,
self-contained widget** — a drop-in "plugin" with no dependencies on the rest
of the site. Anyone can clone it, open it in a browser, and play with the live
controls, or drop it into their own landing page and point it at their own HQ,
cities, and activity types (see [`shared/data.js`](shared/data.js)).

It ships **rendered two ways** — a **Canvas 2D** build and an **SVG** build —
over a shared core, so the two strategies can be compared head-to-head. See
[`COMPARISON.md`](COMPARISON.md). Canvas is the recommended one (highest, most
stable frame rate); SVG keeps the original vector-crisp look.

## Core visualization

- An orthographic, geographically-accurate globe (D3 geo projection) with
  dotted-relief landmasses, drag-to-spin interaction, and continuous
  auto-rotation.
- **Activity beams** — arcs that fire from real city coordinates toward HQ,
  each colored and labeled by activity type, with a live event feed alongside.
- Impact flashes / fireworks when beams land.

## Atmosphere & realism

- Day/night terminator with adjustable darkness and twinkling city lights on
  the dark side.
- Atmospheric rim glow that gently breathes.
- Edge corona, latitude/longitude grid, and an aurora effect with tunable
  intensity, latitude, speed, and color scheme.

## Cosmic dazzle layer

- Parallax starfield (two drifting, out-of-phase twinkling layers).
- Shooting stars / meteors streaking through deep space.
- Comet trails on the activity beams.
- Orbital rings and star nodes.

## Controls

Everything is user-tunable live via a **Scene & effects** panel organized into
sections — Texture, Atmosphere, Day & night, Aurora, Effects, and Cosmos — so
the spectacle can be dialed in for the landing page. Panel state and
open/closed preference persist across reloads (via `localStorage`).

## Architecture

ES modules, no build step. A `BaseEngine` owns the viewport, clock, rotation,
drag, sun and an event bus; each renderer is a thin subclass that fills in a few
backend hooks. Every visual element is a self-contained **layer**
(`{ name, z, build, resize, simulate, draw }`) drawn in z-order. The two renderers
share *everything* except the actual painting: geometry, simulation, the engine,
data, config and UI all live in `shared/`, so there's no duplicated logic.

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

Each renderer's `engine.js` (~30–80 lines) and `layers.js` are **rendering only** —
all behaviour comes from `shared/`. Adding an effect = write a layer factory in
`layers.js` (using the shared geometry/sim helpers) and register it.

D3 v7 and `topojson-client` load from a CDN; world landmass topology
(`world-atlas`) is fetched at runtime with fallback CDNs.

## Modes: clean hero vs demo

- **Clean (default)** — `/canvas/` or `/svg/`: just the globe, brand and live
  ticker. No controls, no FPS meter. This is what you embed on the landing page.
- **Demo** — add `?demo` (`/canvas/?demo`): adds the FPS meter and the full
  control + **Scene & effects** panel for tuning. The chooser links here.

## Configuration & the platform contract

Scene settings are defined once in [`shared/scene-schema.js`](shared/scene-schema.js)
as plain, JSON-serialisable data — every field's type, label, bounds and default.
That single schema is the contract with the games.directory platform:

- the platform reads `SCENE_SCHEMA` (serve it with `JSON.stringify`) to render its
  own settings UI — labels, ranges, options;
- the globe runs **`sanitizeScene()`** on every incoming config, so out-of-range
  or unknown values can never reach the renderer (it clamps to bounds, validates
  selects, coerces toggles, drops unknown keys);
- defaults are derived from the schema — there's no second copy to drift.

At runtime the scene is resolved by `resolveScene()` in this precedence:

1. **`window.__GD_SCENE__`** — an inline config object the platform embeds;
2. **`?config=<url>`** — fetched per-deployment config JSON (from your API);
3. **`?demo`** — the demo panel's own `localStorage`;
4. otherwise — schema defaults.

So the platform stores a validated config (bounded by the schema), and the plugin
pulls it via inline embed or API; nothing else changes between deployments.

## Customising & extending

- **Make it yours:** edit [`shared/data.js`](shared/data.js) — HQ, cities,
  activity types (label / colour / weight).
- **Add/adjust a setting:** add a field to [`shared/scene-schema.js`](shared/scene-schema.js)
  — the default, the demo control, and bounds-validation all follow automatically.
- **Add an effect:** add a layer factory to `canvas/layers.js` (and/or
  `svg/layers.js`, using the shared geometry/sim helpers) and register it in
  `registerDefaultLayers()`.

## Running

A static server is required — the world map is fetched at runtime, and ES
modules don't load from `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Open the chooser at `/`, the clean hero at `/canvas/`, or the tunable demo at
`/canvas/?demo`.
