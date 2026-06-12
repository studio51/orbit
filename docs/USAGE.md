# Usage

Orbit runs in two modes, served from a static file server (see
[Install &amp; setup](INSTALL.md)).

- **Clean (default)** — `/canvas/` or `/svg/`: just the globe, brand and live
  ticker. No controls, no FPS meter. This is what you embed on the landing page.
- **Demo** — add `?demo` (`/canvas/?demo`): adds the FPS meter and the full
  control + **Scene & effects** panel for tuning. The chooser links here.

## Controls

Everything is user-tunable live via the **Scene & effects** panel (in demo mode),
organized into sections — Texture, Atmosphere, Day & night, Aurora, Effects, and
Cosmos — so the spectacle can be dialed in for the landing page. Panel state and
open/closed preference persist across reloads (via `localStorage`).

The globe itself is **drag-to-spin** and continuously auto-rotates.

## Examples

Make it yours by editing [`shared/data.js`](../shared/data.js) — set your own HQ,
cities, and activity types (label / colour / weight). Then embed the clean hero:

```html
<!-- inline config the platform embeds before the globe loads -->
<script>
  window.__GD_SCENE__ = { aurora: { intensity: 0.6 } /* …schema fields… */ };
</script>
<iframe src="/canvas/" title="Activity globe"></iframe>
```

Or point a deployment at per-deployment config JSON from your API:

```
/canvas/?config=https://your-api.example.com/scene.json
```

## Configuration

Scene settings are defined once in
[`shared/scene-schema.js`](../shared/scene-schema.js) as plain, JSON-serialisable
data — every field's type, label, bounds and default. That single schema is the
contract with the games.directory platform:

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

### Adding or adjusting a setting

Add a field to [`shared/scene-schema.js`](../shared/scene-schema.js) — the
default, the demo control, and bounds-validation all follow automatically. To add
a whole new effect, write a layer factory and register it (see
[Architecture → Key decisions](ARCHITECTURE.md#key-decisions)).
