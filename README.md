<!-- Screenshot: drop a hero image or GIF here (a GitHub asset URL works well). -->

# Orbit

> A real-time 3D globe that visualizes live activity as luminous beams arcing across the Earth, extracted from games.directory as a standalone, drop-in widget.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![CI](https://github.com/studio51/orbit/actions/workflows/ci.yml/badge.svg)](https://github.com/studio51/orbit/actions/workflows/ci.yml)

Orbit is the centerpiece hero globe for the [games.directory](https://games.directory)
landing page, packaged here as a self-contained plugin with no dependencies on
the rest of the site. Clone it, serve it, and play with the live controls, or
drop it into your own page and point it at your own HQ, cities, and activity
types. It renders on **WebGPU** (a true 3D sphere with GPU compute particles) in five
switchable looks, and falls back to Canvas 2D where WebGPU is unavailable.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Install & setup](docs/INSTALL.md)
- [Usage](docs/USAGE.md)
- [Looks](docs/LOOKS.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

[MIT](LICENSE), © 2026 Vlad Radulescu, Studio51 Solutions.
