# Usage

Orbit runs in two modes, served from a static file server (see
[Install & setup](INSTALL.md)).

- **Clean (default)**: `/webgpu/`, or `/canvas/` for the fallback. Just the globe, the
  brand and the live ticker, with no controls. This is what you embed on a landing page.
- **Demo**: add `?demo` (`/webgpu/?demo`). It adds the live feed, the look lenses, the
  scene settings drawer and an FPS meter.

URL options, all optional:

| Option          | Effect                                                               |
| --------------- | -------------------------------------------------------------------- |
| `?demo`         | Show the controls and use the demo's saved settings                  |
| `?look=<id>`    | Start in a look: `realistic`, `cartoon`, `neon`, `hologram` or `ink` |
| `?config=<url>` | Fetch the scene configuration from a JSON endpoint                   |
| `?debug`        | Expose the engine as `window.__orbit` in the console                 |

## Running locally

The world map is fetched at runtime, so Orbit needs to be served over HTTP (not
opened as a `file://` path). Any static server works, for example:

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Controls

- **Drag** the globe to spin it. A flick keeps gliding and settles back into the
  auto-rotation. **Scroll or pinch** to zoom. The camera also leans slightly toward the
  pointer.
- **Look lenses** (bottom of the demo) switch the whole scene and the interface around
  it. See [Looks](LOOKS.md).
- **Scene settings** (the drawer on the right) tune clouds, bloom, atmosphere, day and
  night, aurora, the moon, orbit rings and more. Only the settings the active renderer
  can draw are shown. Everything persists across reloads.
- The **live feed** lists each activity type with a counter, a colour swatch and a
  toggle, plus activity rate, rotation speed, pause, and which activity sets off the
  fireworks.

## Examples

Make it yours by editing [`shared/data.js`](../shared/data.js) to set your own HQ,
cities, and activity types (label / colour / weight). Then embed the clean hero:

```html
<!-- inline config the platform embeds before the globe loads -->
<script>
  window.__ORBIT_SCENE__ = { look: 'neon', clouds: 0.4 /* ...schema fields... */ };
</script>
<iframe src="/webgpu/" title="Activity globe"></iframe>
```

Or point a deployment at per-deployment config JSON from your API:

```
/webgpu/?config=https://your-api.example.com/scene.json
```

## Configuration

Scene settings are defined once in
[`shared/scene-schema.js`](../shared/scene-schema.js) as plain, JSON-serialisable
data: every field's type, label, bounds and default. That single schema is the
contract with the games.directory platform:

- the platform reads `SCENE_SCHEMA` (serve it with `JSON.stringify`) to render its
  own settings UI (labels, ranges, options);
- the globe runs **`sanitizeScene()`** on every incoming config, so out-of-range
  or unknown values can never reach the renderer (it clamps to bounds, validates
  selects, coerces toggles, drops unknown keys);
- defaults are derived from the schema, so there is no second copy to drift;
- a field or section can carry `renderers: ['webgpu']` (or `'canvas'`, `'svg'`) to say
  which renderer draws it. Validation still accepts every key, and each demo panel
  hides what it cannot draw.

At runtime the scene is resolved by `resolveScene()` in this precedence:

1. **`window.__ORBIT_SCENE__`**: an inline config object the platform embeds;
2. **`?config=<url>`**: fetched per-deployment config JSON (from your API);
3. **`?demo`**: the demo panel's own `localStorage`;
4. otherwise, schema defaults.

So the platform stores a validated config (bounded by the schema), and the plugin
pulls it via inline embed or API; nothing else changes between deployments.

### Adding or adjusting a setting

Add a field to [`shared/scene-schema.js`](../shared/scene-schema.js): the
default, the demo control, and bounds-validation all follow automatically. To add
a whole new effect, write a layer factory and register it (see
[Architecture → Key decisions](ARCHITECTURE.md#key-decisions)).
