# Changelog

All notable changes to Orbit are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffold from [Studio51 Standards](https://github.com/studio51/standards).
- Cinematic arrival (`intro`): ~3.2s choreographed bloom on load (nebula → stars → sphere → atmosphere → land → night/aurora/orbits → beams), with rotation easing in from stillness.
- Six cinematic canvas layers: orbiting moon, rare comet, shimmering constellations, ocean sun glint, HQ heartbeat wave, and city surges.
- New visual toggles: sun glare at the subsolar limb, in-canvas parallax starfield, nebula haze, and pointer parallax look-offset.
- Fling inertia — flick the globe and it glides, decaying back into auto-rotation (works while paused).
- Scene-schema `cinema` section and control-panel toggles for all the new options.

### Changed

- Canvas renderer performance: zero trig in the hot loops (precomputed sin/cos with angle-sum projection), tier-sorted land dots drawn as contiguous runs, low-res offscreen terminator upscaled to screen, and cached GeoJSON rebuilt only when the sun moves.
- Adaptive quality in `BaseEngine`: an EMA of frame time nudges a dpr multiplier (down to 0.55) with cooldown hysteresis so weak GPUs get a softer image instead of dropped frames.
- Richer visuals: deeper offset-lit ocean, wider atmospheric rim with a crisp shell line, 4-layer beams, twin impact rings, 3-pass aurora, warmer city lights.
- Calmer defaults and pacing: rotation 4°/s, activity 2.4/s, meteor frequency 40%, slower/longer-lived meteors and beams.
- Renamed the widget's own branding from "games.directory" to **Orbit** across UI titles, logos and file headers. The embed API global is now `window.__ORBIT_SCENE__` (was `__GD_SCENE__`) and the persisted panel keys are `orbit-scene` / `orbit-scene-open` (was `gd-globe-*`) — a breaking change for existing embeds and saved settings.
- Moved the local-server / usage note off the root chooser page into [`docs/USAGE.md`](docs/USAGE.md).

### Fixed

[Unreleased]: https://github.com/studio51/orbit/commits/main
