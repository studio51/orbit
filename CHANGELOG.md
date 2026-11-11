# Changelog

All notable changes to Orbit are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Frame governor for the WebGPU renderer: it measures the display's refresh rate and the GPU time per frame, and trades resolution to hold that rate (120 fps on a 120 Hz display, 60 on a 60 Hz one), then gives the resolution back when there is room. The settled scale is remembered across reloads.
- Performance readout in the demo: frame rate against its target, GPU time per frame and the resolution scale. A **Resolution** control fixes the scale or returns it to Auto, and `?scale=<n>` does the same for an embed.
- Keyboard shortcuts in the demo: `Space` pauses, `1` to `5` switch looks, `H` hides the interface, `F` toggles full screen, `R` replays the arrival.
- `?embed` mode: the clean page without the brand, which leaves the mouse wheel and vertical swipes to the host page. `?ticker=<px>` lowers the ticker to clear a host's header, and an embedded globe posts `{ orbit: 'pace', fps, target, scale, gpuMs }` to its host.
- Unit tests for the frame governor against a simulated display.
- WebGPU renderer (`webgpu/`) built on Three.js and TSL: a true 3D globe with a real sun and terminator, a ray-marched atmosphere, living clouds with shadows, ocean glint, relief, procedural city lights, aurora, a lit moon, orbit rings with satellites and shooting stars.
- Five switchable looks, cross-faded live without recompiling shaders: Realistic, Cartoon, Neon, Hologram and Ink & Paper. Choose one with the new look lenses, `?look=<id>`, or the `look` scene setting.
- GPU compute particles: impact sparks in a ring buffer and about 40k ambient orbital motes, advected entirely by compute kernels.
- One-time GPU bakes of the static planet fields (biomes, relief, ocean, clouds, sky), so the globe shader only samples textures.
- Bloom, chromatic fringe, scanlines, vignette and grain as a per-look post-processing pipeline.
- New `look`, `clouds` and `bloom` scene settings. The schema is now version 2, and fields can be scoped to renderers with `renderers: [...]`.
- Landing page with a live globe in a frame and a look picker that re-dresses the whole page.
- `shared/looks.js`, the dependency-free single source of truth for the looks.
- Unit tests for the scene schema and look data (`node --test tests/`).
- Initial project scaffold from [Studio51 Standards](https://github.com/studio51/standards).
- Cinematic arrival (`intro`): ~3.2s choreographed bloom on load (nebula → stars → sphere → atmosphere → land → night/aurora/orbits → beams), with rotation easing in from stillness.
- Six cinematic canvas layers: orbiting moon, rare comet, shimmering constellations, ocean sun glint, HQ heartbeat wave, and city surges.
- New visual toggles: sun glare at the subsolar limb, in-canvas parallax starfield, nebula haze, and pointer parallax look-offset.
- Fling inertia — flick the globe and it glides, decaying back into auto-rotation (works while paused).
- Scene-schema `cinema` section and control-panel toggles for all the new options.

### Changed

- The WebGPU renderer no longer evaluates noise per frame. Relief uses a baked slope, waves and grain use a tileable detail texture, and the moon, the aurora and the paper backdrop are baked. Measured on an M2 MacBook Air in Low Power Mode at retina resolution (3024×1800), GPU time per frame at full resolution fell from 24 ms to 8 ms and the frame rate rose from 38 fps to the panel's 60. Left to adapt, the old renderer settled between 55% and 85% resolution; the new one holds 100%.
- Stars are about 24,000 crisp point sprites instead of a per-pixel lattice, and the sky dome is no longer shaded behind the globe.
- The aurora is drawn as stacked curtains around both ovals, so it gains height at the limb.
- The sun is a small hot disc with a tight halo. The old wide glare washed half the frame in grey when the sun was in view.
- Smoother relief, crisper clouds with slowly evolving edges, and engraving lines in the Ink & Paper look that dissolve into tone instead of beating into moiré.
- The adaptive resolution no longer gets stuck low. The old scaler needed frames faster than 14.5 ms to step up, which a 60 Hz display never delivers.
- The landing page is rebuilt around the live globe: it is the hero, unframed, with a live frame-rate readout from the globe itself, plus sections on what it draws, how it holds its frame rate and how to embed it.
- The ticker bows out while the settings drawer is open instead of sliding over the globe, and loading names each stage.
- Refreshed interface: glass panels, a settings drawer, look lenses, and a redrawn brand. Every surface themes itself per look (glass, chunky cartoon cards, neon, hologram wireframe, paper and ink), and the Canvas fallback shares the same chrome.
- The root page is now a landing page for the WebGPU renderer. The Canvas 2D renderer is the automatic fallback and keeps your URL options.
- The Canvas renderer hides settings it cannot draw (the schema marks them by renderer).
- Orbit now depends on Three.js (pinned, loaded from a CDN through an import map), the one allowed runtime dependency. AGENTS.md and the docs say so.
- The SVG renderer moved to `legacy/svg/` and is no longer maintained.
- Canvas renderer performance: zero trig in the hot loops (precomputed sin/cos with angle-sum projection), tier-sorted land dots drawn as contiguous runs, low-res offscreen terminator upscaled to screen, and cached GeoJSON rebuilt only when the sun moves.
- Adaptive quality in `BaseEngine`: an EMA of frame time nudges a dpr multiplier (down to 0.55) with cooldown hysteresis so weak GPUs get a softer image instead of dropped frames.
- Richer visuals: deeper offset-lit ocean, wider atmospheric rim with a crisp shell line, 4-layer beams, twin impact rings, 3-pass aurora, warmer city lights.
- Calmer defaults and pacing: rotation 4°/s, activity 2.4/s, meteor frequency 40%, slower/longer-lived meteors and beams.
- Renamed the widget's own branding from "games.directory" to **Orbit** across UI titles, logos and file headers. The embed API global is now `window.__ORBIT_SCENE__` (was `__GD_SCENE__`) and the persisted panel keys are `orbit-scene` / `orbit-scene-open` (was `gd-globe-*`) — a breaking change for existing embeds and saved settings.
- Moved the local-server / usage note off the root chooser page into [`docs/USAGE.md`](docs/USAGE.md).

### Fixed

[Unreleased]: https://github.com/studio51/orbit/commits/main
