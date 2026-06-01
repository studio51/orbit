# Canvas vs SVG — two renderers, one globe

This repo renders the same activity globe **two ways**, over a shared core, so the
two strategies can be compared head-to-head. Open the root `index.html` and hit
**Compare side-by-side**, or load `canvas/` and `svg/` directly. Each carries a
live FPS meter.

> **Why bother?** The original was a single 1,000-line SVG implementation. SVG was
> being asked to do something it's bad at — rebuild thousands of path strings and
> write `style.opacity` on dozens of nodes *every frame*. Moving to canvas removes
> that whole class of work. Building both lets the difference speak for itself
> rather than asserting it.

---

## Shared core (`shared/`)

Both renderers import the same modules, so the comparison is fair — the *only*
variable is how pixels reach the screen.

| Module | Responsibility |
| ------ | -------------- |
| `data.js` | HQ, activity types, cities, ticker verbs, map URLs — **the file you edit to customise** |
| `config.js` | Scene defaults, the panel spec, persistence |
| `geo.js` | `Projection` — wraps `d3.geoOrthographic`, adds the fast forward-projection + sun/terminator |
| `util.js` | easing, colour, weighted pick |
| `ui.js` | scene panel, activity list, base controls, ticker (pure DOM, backend-agnostic) |
| `fps.js` | the smoothed FPS meter |
| `ui.css` | all the chrome (panel, brand, ticker, loading) |

## Same architecture, two backends

Both renderers use an identical **layer-registry engine**: an `Engine` owns the
viewport, clock, rotation, drag, sun and an event bus, plus an ordered list of
layers. Each layer is a small object:

```js
{ name, z, rebuildOn?, build?(e), resize?(e), simulate?(e), draw(e) }
```

Layers draw in ascending `z`. Adding an effect = write a factory in `layers.js`
and register it. The engines differ in exactly one place — the per-frame loop:

```
Canvas:  clear the canvas → every layer draws itself fresh   (immediate mode)
SVG:     no clear → every layer mutates its persistent nodes  (retained mode)
```

That one difference drives everything below.

---

## How each pushes pixels

| | **Canvas 2D** | **SVG** |
| --- | --- | --- |
| Model | Immediate — clear + redraw each frame | Retained — persistent nodes, mutate attributes |
| Land dots | `fillRect` into one context (1 project pass + 3 tier passes) | three batched `<path>` `d` strings rebuilt each frame |
| Glows | additive `globalCompositeOperation = 'lighter'` + layered strokes | `mix-blend-mode: screen` + a few blur filters |
| Beams / particles | drawn directly, nothing persists | one `<g>` of `<path>`/`<circle>` per beam, created & removed |
| Per-frame DOM work | **none** | hundreds of attribute writes + style recalcs |
| What the browser does | one raster of one element | layout/paint/composite across many nodes |

---

## Performance

The structural story is simple: **canvas does less work per frame and asks the
browser to do far less.** SVG's cost grows with node count and with how much of
each frame's geometry actually changes — and here almost everything changes every
frame (the globe spins, beams travel). That's the worst case for retained-mode
SVG and the best case for immediate-mode canvas.

Where you feel it:

- **Beam-heavy moments.** Crank *Activity rate* up. Canvas stays flat; SVG climbs
  as nodes are created/animated/destroyed and the layout/paint cost rises.
- **Dense land + high-DPI.** Canvas scales with the device pixel ratio (capped at
  2×) and is bound by fill rate; SVG re-rasterises large, blurred, blended regions.
- **Mobile / integrated GPUs.** The gap widens — SVG filter + blend re-rasterisation
  is exactly what weaker compositors struggle with.

SVG isn't *slow* in absolute terms — at the default rate on a desktop it holds up
fine — it just has a lower ceiling and degrades sooner under load.

### Canvas isn't automatically faster — it's only as good as the draw code

Canvas wins **only if you avoid its expensive operations**. A naive port can easily
end up *slower* than SVG. The two traps that bit the first cut of this build, and how
it now avoids them:

- **`ctx.shadowBlur` per point.** Every shadowed fill forces a separate offscreen
  Gaussian-blur pass — brutal when used per star-node / beam-head / meteor / HQ dot,
  every frame. **Fix:** bake one soft white glow into an offscreen sprite once and
  `drawImage` it (additively). A blit is a fraction of the cost of a blur.
- **Re-creating + re-filling large gradients every frame.** The sphere disc, its
  highlight, and the atmosphere rim/bottom glow don't change shape as the globe
  spins, yet were being `createRadialGradient`'d and filled across the whole disc
  each frame — at the device pixel ratio that's a lot of fill-rate. **Fix:** render
  them to offscreen sprites once on resize and blit them each frame; the live
  `atmos`/pulse values just modulate `globalAlpha`.

Lesson: the architecture (immediate-mode, one cleared canvas) is what gives the
headroom — but you have to keep per-frame work to cheap fills, strokes and blits, and
push everything static or blurred into a cached sprite.

> ⚠️ **Don't trust headless numbers.** FPS captured in headless Chrome (and the
> screenshots in review) is throttled by virtual-time and a software compositor and
> is **not** representative. Compare the live meters in a real browser, ideally with
> *Activity rate* high and a retina display — and on the actual target hardware.

---

## Fidelity

The canvas port reproduces the SVG look closely; a few honest differences:

- **Glow falloff.** SVG uses Gaussian blur filters; canvas fakes the same bloom with
  additive layered strokes/fills. Very close, occasionally a touch crisper.
- **Soft terminator.** The SVG night uses a blur filter; canvas stacks two graduated
  alpha circles (no per-frame filter, which would cost too much). Marginally less
  feathered at the edge.
- **Text.** HQ label is real SVG `<text>` vs canvas `fillText`/`strokeText` — both
  use the same font and dark outline.

Everything else — projection, land dots, beams, aurora, fireworks, meteors, orbits,
city lights, controls — is the same maths and the same numbers.

---

## Which should you ship?

**Canvas**, for this use case. It's the landing-page hero: maximum spectacle, high
activity rate, varied hardware. Immediate-mode canvas gives the highest, most
stable frame rate and the headroom to push more beams and particles.

Reach for **SVG** when you need resolution-independent vector output (print/export),
crisp infinite-zoom, easy per-element DOM hit-testing/CSS styling, or accessibility
hooks on individual elements — none of which is the priority for an animated hero.

---

## Files

```
index.html          chooser + side-by-side compare
shared/             data, config, projection, ui, fps, chrome css  (used by both)
canvas/             Canvas2D engine + layers + entry  ← recommended
svg/                SVG engine + layers + entry        (modularised original)
legacy/             the original single-file version, for reference
```
