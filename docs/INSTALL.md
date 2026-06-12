# Install &amp; setup

## Requirements

- A modern browser (Canvas 2D / SVG, ES modules).
- A **static file server** — the world map is fetched at runtime and ES modules
  don't load from `file://`, so opening the HTML directly won't work.
- No build step, no package install. D3 v7 and `topojson-client` load from a CDN.

## Quick start

```bash
git clone https://github.com/studio51/orbit.git && cd orbit
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works — e.g. `npx serve .` instead of the Python one.

Once it's running, open:

- `/` — the chooser plus side-by-side compare
- `/canvas/` — the clean Canvas hero (recommended renderer)
- `/canvas/?demo` — the tunable demo with the FPS meter and Scene & effects panel

See [Usage](USAGE.md) for the modes, controls, and configuration.

## Development

No dependencies to install. Formatting is enforced with Prettier:

```bash
npx prettier --check .   # add --write to fix
```
