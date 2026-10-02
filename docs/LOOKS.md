# Looks

> Five art directions for the same globe, switchable live.

A look re-dresses everything: the planet, clouds, atmosphere, sky, beams, particles,
the post-processing, and the interface around the globe. Switching cross-fades over
about a second and never recompiles a shader.

| Look        | What it is                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realistic   | Biomes and relief, a ray-marched Rayleigh and Mie atmosphere with sunsets, living clouds with shadows, ocean glint, city lights on the night side, aurora, a lit moon |
| Cartoon     | Flat banded palette, three-band cel shading toward violet, bold constant-width outlines, puffy outlined clouds, confetti sparks, chunky cards                         |
| Neon        | Dark body, striped synthwave land, glowing coastlines that shift from magenta to cyan, a wireframe grid, heavy bloom                                                  |
| Hologram    | Dot-matrix land on a latitude-aware lattice, scanlines and a rolling band, chromatic fringe, a sweeping scan line                                                     |
| Ink & Paper | Engraved hatching on warm paper from seam-free great-circle lines, an inked coastline, vermilion as the single accent                                                 |

## Choosing a look

- In the demo (`?demo`), click a lens at the bottom of the screen.
- For one load, add `?look=<id>` to the URL. The ids are `realistic`, `cartoon`,
  `neon`, `hologram` and `ink`.
- For an embed, set `look` in the scene config (see [Usage](USAGE.md#configuration)).
- A host page can switch an embedded globe with
  `iframe.contentWindow.postMessage({ orbit: 'look', id: 'neon' }, location.origin)`.

## How a look is built

Each look is an entry in [`shared/looks.js`](../shared/looks.js):

```js
{
  id: 'neon',
  label: 'Neon',
  blurb: 'Synthwave grid, glowing coastlines, heavy bloom',
  swatch: ['#16002b', '#ff2fb3', '#25f4ee'], // the lens orb gradient
  ui: { accent: '#ff2fb3', paper: false },
  params: { bloomStrength: 0.7, beamGlow: 0.75, /* ...numeric shader knobs */ },
  colors: { bgA: '#05000d', bgB: '#10032a', accent: '#25f4ee', rim: '#ff2fb3' },
}
```

At runtime `LookState` (in [`webgpu/looks.js`](../webgpu/looks.js)) owns one weight
uniform per look plus an eased uniform for every param and colour. The shaders add
each look's contribution weighted by its uniform, and skip the branch entirely while
the weight is zero.

## Adding a look

1. Add the entry to `shared/looks.js`. The schema's `look` options, the lens picker
   and the landing page all read that list. Give it the same `params` and `colors`
   keys as the others.
2. Add its branch to the globe, cloud and atmosphere shaders in
   [`webgpu/earth.js`](../webgpu/earth.js), the backdrop in
   [`webgpu/sky.js`](../webgpu/sky.js), and its beam, ring and spark styling in
   `beams.js`, `sparks.js` and `cosmos.js`. Branch order must match the order in
   `LOOKS`.
3. Add a `html[data-look='<id>']` token block to [`shared/ui.css`](../shared/ui.css)
   so the interface follows.

Read the [shader pitfalls](ARCHITECTURE.md#shader-pitfalls) first. Most of the sharp
edges live in step 2.
