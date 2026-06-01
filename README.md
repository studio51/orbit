# games.directory — Activity Globe

A real-time, interactive 3D globe built as the centerpiece hero for the
[games.directory](https://games.directory) landing page. It visualizes live
gaming activity from around the world as luminous beams arcing across an
accurately-rendered rotating Earth, converging on a central HQ point.

This repo is that globe **extracted from games.directory as a standalone,
self-contained widget** — a drop-in "plugin" with no dependencies on the rest
of the site. Anyone can clone it, open it in a browser, and play with the live
controls, or drop it into their own landing page and point it at their own HQ,
cities, and activity types (see [`data.js`](data.js)).

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

## Tech

Self-contained HTML + JS — no build step. D3 geo for the projection, SVG for
the beams and effects, CSS for the starfield and atmosphere.

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Markup, styles, and SVG scaffold for the scene.                   |
| `globe.js`   | Rendering engine — projection, land dots, beams, effects, panel.  |
| `data.js`    | HQ location, activity types, and real-world city coordinates.     |

D3 v7 and `topojson-client` are loaded from a CDN; world landmass topology
(`world-atlas`) is fetched at runtime, with fallback CDNs.

## Running

No build or server is strictly required, but the runtime `fetch` of the world
map needs an `http(s)://` origin (browsers block `fetch` from `file://`). Serve
the directory with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
