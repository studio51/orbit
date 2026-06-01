# AGENTS.md: Orbit

Instructions for AI coding agents (Claude Code and friends) working in this repo.
Humans: this is also a fine quick-orientation read.

## Project

- **Name:** orbit · **Type:** plugin · **License:** MIT
- a real-time 3D globe visualizing live activity as beams arcing across the Earth, extracted as a standalone widget

## Conventions (Studio51 standard)

- **Commits:** Conventional Commits, e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- **Branches:** `feature/…`, `fix/…`, `chore/…`. Open a PR; don't push to `main`.
- **Changelog:** add a line under **Unreleased** in `CHANGELOG.md` for any user-facing change.
- **Secrets:** never commit credentials, `.env`, or keys.
- **Authorship:** never set an AI tool as the git commit author.

## Stack: Vanilla JS

- No build step. Open `index.html` directly, or serve the folder:
  `npx serve .` / `python3 -m http.server`.
- Plain ES modules: no bundler, no framework. Keep it dependency-free.
- Format with Prettier: `npx prettier --check .` (run `--write` to fix).
- Shared logic lives in `shared/`; entry points stay thin.

## Before you finish

- [ ] Tests pass
- [ ] Lint/format clean
- [ ] `CHANGELOG.md` updated (if user-facing)
- [ ] No secrets or large generated artifacts committed
- [ ] README still accurate for any behavior you changed
