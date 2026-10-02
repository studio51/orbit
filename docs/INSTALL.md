# Install & setup

## Requirements

- A browser with **WebGPU** for the 3D globe: recent Chrome, Edge, Safari or Firefox.
  Browsers without it get the Canvas 2D globe automatically.
- A **static file server**. The world map is fetched at runtime and ES modules do not
  load from `file://`, so opening the HTML directly will not work.
- Network access to a CDN. Three.js, the world map and the fonts load from jsDelivr,
  unpkg and Google Fonts.
- No build step and no package install.

## Quick start

```bash
git clone https://github.com/studio51/orbit.git && cd orbit
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works, for example `npx serve .` instead of the Python one.

Once it is running, open:

- `/` for the landing page, with a live globe and the look picker
- `/webgpu/` for the clean WebGPU hero
- `/webgpu/?demo` for the tunable demo: live feed, look lenses, scene settings, FPS meter
- `/canvas/?demo` for the Canvas 2D fallback demo

See [Usage](USAGE.md) for the modes, controls and configuration.

## Development

There is nothing to install for the app itself. The checks run through `npx`:

```bash
npx prettier --check .   # add --write to fix
npx eslint .             # add --fix to fix
node --test tests/*.test.js   # unit tests for the schema and look data
```

While iterating on shaders, serve with caching off. Browsers cache ES modules
aggressively, and a stale module is easy to mistake for a shader bug. A static server
that sends `Cache-Control: no-store` does the job.
