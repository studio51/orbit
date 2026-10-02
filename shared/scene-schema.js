/* Orbit — scene SCHEMA (single source of truth)
 *
 * SCENE_SCHEMA is plain, JSON-serialisable data: the complete, bounded set of
 * tunable scene settings, grouped into sections. It is the contract between the
 * globe and the games.directory platform:
 *
 *   • the platform reads it to render a settings UI (labels, types, ranges, options);
 *   • the platform stores only what it validates against these bounds;
 *   • the globe derives its defaults from it and runs `sanitizeScene()` on any
 *     incoming config (API, inline, or localStorage) so out-of-range or unknown
 *     values can never reach the renderer.
 *
 * Serve it to the platform with `JSON.stringify(SCENE_SCHEMA)` — there are no
 * functions in it. Display formatting (the little value read-outs in the demo
 * panel) is derived from the `display`/`unit` hints by `formatValue()` below.
 *
 * Field shapes:
 *   range:  { key, type:"range",  label, default, min, max, step, display?, unit?, decimals? }
 *   toggle: { key, type:"toggle", label, default }
 *   select: { key, type:"select", label, default, options:[{value,label}] }
 * `display`: "pct" (value×100%), "pctOfMax" (value/max×100%), or omit and use `unit`.
 *
 * Renderer scoping: any section or field may carry `renderers: ['webgpu' | 'canvas' | 'svg', …]`.
 * Omitted means "every renderer". The validator still accepts every key (the contract is
 * renderer-independent); the demo panel just hides what the active renderer can't draw.
 */

import { LOOKS } from './looks.js';

export const SCENE_SCHEMA = {
  version: 2,
  sections: [
    {
      id: 'look',
      title: 'Clouds & bloom',
      renderers: ['webgpu'],
      fields: [
        {
          key: 'look',
          type: 'select',
          label: 'Art direction',
          default: 'realistic',
          options: LOOKS.map((l) => ({ value: l.id, label: l.label })),
        },
        {
          key: 'clouds',
          type: 'range',
          label: 'Cloud cover',
          default: 0.55,
          min: 0,
          max: 1,
          step: 0.05,
          display: 'pct',
        },
        {
          key: 'bloom',
          type: 'range',
          label: 'Bloom',
          default: 1,
          min: 0,
          max: 2,
          step: 0.1,
          display: 'pctOfMax',
        },
      ],
    },
    {
      id: 'texture',
      title: 'Texture',
      fields: [
        {
          key: 'dotSize',
          renderers: ['canvas', 'svg'],
          type: 'range',
          label: 'Dot size',
          default: 2.9,
          min: 1.5,
          max: 4.5,
          step: 0.1,
          unit: 'px',
          decimals: 1,
        },
        {
          key: 'texture',
          renderers: ['canvas', 'svg'],
          type: 'range',
          label: 'Relief texture',
          default: 0.32,
          min: 0,
          max: 0.6,
          step: 0.02,
          display: 'pctOfMax',
        },
        {
          key: 'landBright',
          renderers: ['canvas', 'svg'],
          type: 'range',
          label: 'Land brightness',
          default: 1,
          min: 0.4,
          max: 1,
          step: 0.05,
          display: 'pct',
        },
        {
          key: 'density',
          renderers: ['canvas', 'svg'],
          type: 'select',
          label: 'Dot density',
          default: 'med',
          options: [
            { value: 'sparse', label: 'Sparse' },
            { value: 'med', label: 'Medium' },
            { value: 'dense', label: 'Dense' },
          ],
        },
        { key: 'grid', type: 'toggle', label: 'Lat / long grid', default: false },
      ],
    },
    {
      id: 'atmosphere',
      title: 'Atmosphere',
      fields: [
        {
          key: 'atmos',
          type: 'range',
          label: 'Atmospheric glow',
          default: 1,
          min: 0,
          max: 2,
          step: 0.1,
          display: 'pctOfMax',
        },
        { key: 'sunGlare', type: 'toggle', label: 'Sun glare on limb', default: true },
      ],
    },
    {
      id: 'daynight',
      title: 'Day & night',
      fields: [
        { key: 'dayNight', type: 'toggle', label: 'Day / night shadow', default: true },
        {
          key: 'darkness',
          type: 'range',
          label: 'Night darkness',
          default: 0.55,
          min: 0,
          max: 0.9,
          step: 0.05,
          display: 'pctOfMax',
        },
        { key: 'cityLights', type: 'toggle', label: 'City lights', default: true },
        {
          key: 'cityBright',
          type: 'range',
          label: 'City brightness',
          default: 1,
          min: 0.3,
          max: 1.4,
          step: 0.05,
          display: 'pctOfMax',
        },
        { key: 'sunGlint', type: 'toggle', label: 'Ocean sun glint', default: true },
      ],
    },
    {
      id: 'aurora',
      title: 'Aurora',
      fields: [
        { key: 'aurora', type: 'toggle', label: 'Aurora', default: true },
        {
          key: 'auroraIntensity',
          type: 'range',
          label: 'Intensity',
          default: 1,
          min: 0,
          max: 1.5,
          step: 0.05,
          display: 'pctOfMax',
        },
        {
          key: 'auroraLat',
          type: 'range',
          label: 'Latitude',
          default: 71,
          min: 55,
          max: 82,
          step: 1,
          unit: '°',
          decimals: 0,
        },
        {
          key: 'auroraSpeed',
          type: 'range',
          label: 'Speed',
          default: 1,
          min: 0,
          max: 3,
          step: 0.1,
          unit: '×',
          decimals: 1,
        },
        {
          key: 'auroraScheme',
          type: 'select',
          label: 'Colour',
          default: 'gv',
          options: [
            { value: 'gv', label: 'Green·Violet' },
            { value: 'emerald', label: 'Emerald' },
            { value: 'rose', label: 'Rose' },
          ],
        },
      ],
    },
    {
      id: 'effects',
      title: 'Effects',
      fields: [
        {
          key: 'corona',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Edge corona',
          default: true,
        },
        {
          key: 'coronaIntensity',
          renderers: ['canvas', 'svg'],
          type: 'range',
          label: 'Corona intensity',
          default: 0.1,
          min: 0,
          max: 0.4,
          step: 0.02,
          display: 'pctOfMax',
        },
        {
          key: 'nodes',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Star nodes',
          default: true,
        },
        { key: 'orbits', type: 'toggle', label: 'Orbital rings', default: true },
      ],
    },
    {
      id: 'cinema',
      title: 'Cinema',
      fields: [
        { key: 'intro', type: 'toggle', label: 'Cinematic arrival', default: true },
        { key: 'parallax', type: 'toggle', label: 'Pointer parallax', default: true },
        { key: 'heartbeat', type: 'toggle', label: 'HQ heartbeat', default: true },
        { key: 'surges', type: 'toggle', label: 'City surges', default: true },
      ],
    },
    {
      id: 'cosmos',
      title: 'Cosmos',
      fields: [
        { key: 'shootingStars', type: 'toggle', label: 'Shooting stars', default: true },
        {
          key: 'meteorRate',
          type: 'range',
          label: 'Meteor frequency',
          default: 0.4,
          min: 0,
          max: 1,
          step: 0.05,
          display: 'pct',
        },
        {
          key: 'parallaxStars',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Parallax stars',
          default: true,
        },
        { key: 'nebula', type: 'toggle', label: 'Nebula haze', default: true },
        { key: 'moon', type: 'toggle', label: 'The Moon', default: true },
        {
          key: 'comet',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Rare comet',
          default: true,
        },
        {
          key: 'constellations',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Constellations',
          default: true,
        },
        {
          key: 'beamTrails',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Comet beam trails',
          default: true,
        },
        {
          key: 'atmosPulse',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Atmosphere pulse',
          default: true,
        },
        { key: 'starTwinkle', type: 'toggle', label: 'Star twinkle', default: true },
        {
          key: 'starDrift',
          renderers: ['canvas', 'svg'],
          type: 'toggle',
          label: 'Star drift',
          default: true,
        },
      ],
    },
  ],
};

// Flat list of all fields across sections.
export function sceneFields() {
  return SCENE_SCHEMA.sections.flatMap((s) => s.fields);
}

// { key: default } for every field.
export function sceneDefaults() {
  const out = {};

  for (const f of sceneFields()) out[f.key] = f.default;

  return out;
}

// Coerce arbitrary input into a valid scene: known keys only, every value
// clamped/snapped to its bounds (range), checked against options (select), or
// forced to boolean (toggle). Missing/invalid values fall back to the default.
export function sanitizeScene(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};

  for (const f of sceneFields()) {
    const v = src[f.key];

    if (f.type === 'toggle') {
      out[f.key] = typeof v === 'boolean' ? v : f.default;
    } else if (f.type === 'select') {
      out[f.key] = f.options.some((o) => o.value === v) ? v : f.default;
    } else {
      // range
      let n = Number(v);

      if (!Number.isFinite(n)) n = f.default;
      n = Math.min(f.max, Math.max(f.min, n));
      if (f.step)
        n = Math.min(f.max, Math.max(f.min, f.min + Math.round((n - f.min) / f.step) * f.step));
      out[f.key] = Number(n.toFixed(6)); // kill binary-float dust from snapping
    }
  }

  return out;
}

// Human-readable read-out for a range field (used by the demo panel only).
export function formatValue(field, value) {
  if (field.display === 'pct') return Math.round(value * 100) + '%';
  if (field.display === 'pctOfMax') return Math.round((value / field.max) * 100) + '%';

  return Number(value).toFixed(field.decimals ?? 0) + (field.unit || '');
}
