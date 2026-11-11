# Usage

Orbit runs in two modes, served from a static file server (see
[Install & setup](INSTALL.md)).

- **Clean (default)**: `/webgpu/`, or `/canvas/` for the fallback. Just the globe, the
  brand and the live ticker, with no controls. This is what you embed on a landing page.
- **Demo**: add `?demo` (`/webgpu/?demo`). It adds the live feed, the look lenses, the
  scene settings drawer and a performance readout.
- **Embed**: add `?embed`. The clean page without the brand, for a host page that
  carries its own. The mouse wheel is left to the host page, and on touch screens a
  vertical swipe scrolls the page while a horizontal drag spins the globe.

URL options, all optional:

| Option          | Effect                                                               |
| --------------- | -------------------------------------------------------------------- |
| `?demo`         | Show the controls and use the demo's saved settings                  |
| `?look=<id>`    | Start in a look: `realistic`, `cartoon`, `neon`, `hologram` or `ink` |
| `?config=<url>` | Fetch the scene configuration from a JSON endpoint                   |
| `?embed`        | Hide the brand and leave scrolling to the host page                  |
| `?scale=<n>`    | Fix the resolution scale (0.5 to 1) instead of adapting it           |
| `?ticker=<px>`  | Start the ticker that far from the top, to clear a host's header     |
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
  toggle, plus activity rate, rotation speed, resolution, pause, and which activity
  sets off the fireworks.
- **Keyboard**: `Space` pauses, `1` to `5` switch looks, `H` hides the interface,
  `F` toggles full screen and `R` replays the arrival.

## Frame rate and resolution

Orbit aims for the display's refresh rate: 120 frames a second on a 120 Hz screen, 60
on a 60 Hz one. A frame governor measures the display and the GPU, lowers the
resolution scale when a frame would run long, and raises it again when there is room.
If even half resolution cannot hold the display rate it targets half of it instead.

The demo's performance readout shows the frame rate against its target, the GPU time
per frame and the resolution scale. **Resolution** in the live feed panel fixes the
scale (100%, 75% or 50% of native pixels) or returns it to **Auto**. `?scale=<n>` does
the same for an embed.

GPU timings need the browser's `timestamp-query` feature. Without it the governor
still holds the frame rate, and finds its way back up by probing.

An embedded globe reports its pace to a same-origin host about once a second:

```js
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.orbit !== 'pace') return;

  const { fps, target, scale, gpuMs } = e.data; // gpuMs is null when timings are unavailable
});
```

## Examples

Make it yours by editing [`shared/data.js`](../shared/data.js) to set your own HQ,
cities, and activity types (label / colour / weight). Then embed the clean hero:

```html
<!-- inline config the platform embeds before the globe loads -->
<script>
  window.__ORBIT_SCENE__ = { look: 'neon', clouds: 0.4 /* ...schema fields... */ };
</script>
<iframe src="/webgpu/?embed" title="Activity globe"></iframe>
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
