# AGENTS.md: Orbit

Instructions for AI coding agents (Claude Code and friends) working in this repo.
Humans: this is also a fine quick-orientation read.

## Project

- **Name:** orbit · **Type:** plugin · **License:** MIT
- a real-time 3D globe visualizing live activity as beams arcing across the Earth, extracted as a standalone widget

## Conventions (Studio51 standard)

These apply to agents and humans alike. Where the **This repository** section
at the end of this file says otherwise, it wins.

### Where work lands

- **Commit straight to the integration branch:** `develop` if this repo has
  one, otherwise `main` (or `master`). No pull request and no pushed feature
  branch for our own work.
- **Local isolation is fine, leftovers are not.** A worktree or local branch
  may hold work in progress; merge it into the integration branch with
  `git merge` (never rebase or squash), push, and delete it.
- **Pull requests are for Dependabot, outside contributors, and releases.**
  They merge with a merge commit, never squash or rebase; the head branch is
  deleted on merge.

### Commits

- **One author, the repo owner, signed.** Commit with the owner's git identity
  and signing key exactly as configured. Never add a co-author of any kind: no
  `Co-authored-by:` trailer (AI or human), no "Generated with …" line, no
  `--author` override, no AI tool as author or committer. The same goes for
  pull request descriptions.
- **Signed and verified.** Never bypass signing (`--no-gpg-sign`,
  `-c commit.gpgsign=false`). If signing fails, stop and fix it, or ask.
- **Meaningful.** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`, `perf:`, `build:`, `ci:`), the subject naming the
  change in the imperative (`fix(auth): refresh expired tokens before
  retrying`) and the body saying why. One logical change per commit, each
  leaving the build green. Never `wip`, `fix stuff` or `address review`, and
  no `fixup!` commits: history is never rewritten, so get the commit right
  before you make it.
- **Merge commits only.** Never squash, rebase, or force-push; bring in the
  remote with `git pull --no-rebase`.
- **Enforced:** `.githooks/commit-msg` checks every message (enable it once per
  clone with `git config core.hooksPath .githooks`), the branches reject
  unsigned commits, and CI re-checks every pushed commit.

### Everything else

- **Changelog:** add a line under **Unreleased** in `CHANGELOG.md` for any user-facing change.
- **Secrets:** never commit credentials, `.env`, or keys.
- **Dependencies:** always the latest secure release. Never pin or bound a
  version in `Gemfile`, a gemspec, `package.json`, `Package.swift` or
  `pyproject.toml`; the committed lockfile holds exact versions and Dependabot
  moves them.
- **Deployment:** apps deploy on Railway, configured by `railway.json` and
  environment variables; nothing persistent lives on the container's disk.
- **Cloudflare & R2:** Cloudflare runs the domain, CDN and storage. Persistent
  files go to this app's own R2 bucket, filed in a folder tree a person can
  browse (`<area>/<owner>/<record>/<role>-<suffix>.<ext>`), never flat random
  keys or catch-all folders: Studio51 mounts the buckets as a drive.
- **Writing style:** never use em dashes; use a comma, or reword, instead.
- **Agent files:** this file is the single source of truth for every agent;
  `CLAUDE.md` / `CURSOR.md` / `CODEX.md` are pointers holding only
  agent-specific instructions. Shared guidance goes here.
- **README:** stays minimal. The **Navigation** section declares the
  Studio51 Solutions standard this repo adheres to and links the docs; all
  prose lives in `docs/`, each section in its own file.

### Comments & documentation

Comments are part of the standard; treat them as required, not optional.

- **Document every public method, class, module, and constant** with a comment
  block directly above it: a short sentence on what it is/does, then a description
  of **each parameter** and the **return value**.
- **Separate the prose from the parameter/return tags with one blank comment line**,
  and keep a blank comment line as the last line of a class/module doc block, right
  before the declaration it documents.
- **One sentence per line**; don't hard-wrap a single sentence across lines.
- **Use inline trailing comments** for accessors, struct fields, and grouped
  constants (annotate the line) rather than a comment paragraph above each.
- **Group related members** under a short `# --- Section ---` divider comment.

See the stack section below for the exact doc-comment syntax in this repo's language.

## Stack: Vanilla JS

- No build step. Open `index.html` directly, or serve the folder:
  `npx serve .` / `python3 -m http.server`.
- Plain ES modules: no bundler, no framework. Keep it dependency-free.
- Format with Prettier: `npx prettier --check .` (run `--write` to fix).
- House style with ESLint: `npx eslint .` (run `--fix` to fix). Enforces the
  "breathing" layout Prettier can't: a blank line before a function's final
  expression, between class members, and around declaration groups.
- Shared logic lives in `shared/`; entry points stay thin.

## Before you finish

Work is not finished until it leaves nothing behind.

- [ ] Tests pass; lint/format clean
- [ ] `CHANGELOG.md` updated (if user-facing)
- [ ] No secrets or large generated artifacts committed
- [ ] README and `docs/` still accurate for any behaviour you changed
- [ ] Every commit signed by the owner, Conventional and meaningful, with no co-author or AI attribution
- [ ] Everything pushed to the integration branch
- [ ] Every worktree you created removed, every local branch you created deleted
- [ ] `git status` clean and level with the remote
- [ ] No em dashes

## This repository

<!-- REPO_SECTION: kept as-is by `npx @studio51/create update`. State here
anything this repo does differently from the conventions above, such as a
different target branch or a release step, plus anything else specific to it. -->

### Vanilla JS + Three.js (WebGPU)

- Plain ES modules: no bundler, no framework, no `package.json`.
- **Three.js is the one allowed runtime dependency.** It is pinned to an exact version in
  the import maps (`webgpu/index.html`) and loaded from a CDN. Keep everything else
  dependency-free, and when bumping Three.js change every import map in one commit.
- `webgpu/` is the primary renderer and `canvas/` is the fallback. `legacy/` is kept for
  reference and is not maintained.
- Unit tests: `node --test tests/*.test.js`.
- Shared logic lives in `shared/`; entry points stay thin. Look definitions live only in
  `shared/looks.js`.
- Shaders are TSL. Read the "Shader pitfalls" in `docs/ARCHITECTURE.md` before editing
  them (shared nodes across `If` branches, `pow` with negative bases, seeded buffers).

<!-- /REPO_SECTION -->
