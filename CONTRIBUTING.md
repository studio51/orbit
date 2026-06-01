# Contributing to Orbit

Thanks for taking the time to contribute. This project follows the Studio51
shared conventions; they're identical across all our repos, so once you know
them you know them everywhere.

## Getting set up

See the **Development** section of the [README](README.md) for install, run,
test, and lint commands.

## Workflow

1. Create a branch off `main`: `feature/…`, `fix/…`, or `chore/…`.
2. Make your change. Keep it focused: one logical change per PR.
3. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) if the change
   is user-facing.
4. Make sure tests and lint pass.
5. Open a pull request. Fill in the PR template.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add globe auto-rotate toggle
fix: correct beam arc easing at the poles
docs: document the data.js schema
chore: bump dependencies
```

## Code style

Formatting and linting are enforced by the configs in this repo (see the
**Development** section). Run the formatter before pushing; don't hand-format.

## Code of Conduct

By participating you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions

Open a [discussion or issue](https://github.com/studio51/orbit/issues) or reach the team at vlad@studio51.solutions.
