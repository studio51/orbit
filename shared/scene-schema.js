/* games.directory globe — scene SCHEMA (single source of truth)
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
 */

export const SCENE_SCHEMA = {
  version: 1,
  sections: [
    {
      id: "texture", title: "Texture", fields: [
        { key: "dotSize",    type: "range",  label: "Dot size",       default: 2.9, min: 1.5, max: 4.5, step: 0.1,  unit: "px", decimals: 1 },
        { key: "texture",    type: "range",  label: "Relief texture", default: 0.32, min: 0,  max: 0.6, step: 0.02, display: "pctOfMax" },
        { key: "landBright", type: "range",  label: "Land brightness", default: 1,   min: 0.4, max: 1,  step: 0.05, display: "pct" },
        { key: "density",    type: "select", label: "Dot density", default: "med",
          options: [{ value: "sparse", label: "Sparse" }, { value: "med", label: "Medium" }, { value: "dense", label: "Dense" }] },
        { key: "grid",       type: "toggle", label: "Lat / long grid", default: false },
      ],
    },
    {
      id: "atmosphere", title: "Atmosphere", fields: [
        { key: "atmos", type: "range", label: "Atmospheric glow", default: 1, min: 0, max: 2, step: 0.1, display: "pctOfMax" },
      ],
    },
    {
      id: "daynight", title: "Day & night", fields: [
        { key: "dayNight",   type: "toggle", label: "Day / night shadow", default: true },
        { key: "darkness",   type: "range",  label: "Night darkness", default: 0.55, min: 0, max: 0.9, step: 0.05, display: "pctOfMax" },
        { key: "cityLights", type: "toggle", label: "City lights", default: true },
        { key: "cityBright", type: "range",  label: "City brightness", default: 1, min: 0.3, max: 1.4, step: 0.05, display: "pctOfMax" },
      ],
    },
    {
      id: "aurora", title: "Aurora", fields: [
        { key: "aurora",          type: "toggle", label: "Aurora", default: true },
        { key: "auroraIntensity", type: "range",  label: "Intensity", default: 1, min: 0, max: 1.5, step: 0.05, display: "pctOfMax" },
        { key: "auroraLat",       type: "range",  label: "Latitude", default: 71, min: 55, max: 82, step: 1, unit: "°", decimals: 0 },
        { key: "auroraSpeed",     type: "range",  label: "Speed", default: 1, min: 0, max: 3, step: 0.1, unit: "×", decimals: 1 },
        { key: "auroraScheme",    type: "select", label: "Colour", default: "gv",
          options: [{ value: "gv", label: "Green·Violet" }, { value: "emerald", label: "Emerald" }, { value: "rose", label: "Rose" }] },
      ],
    },
    {
      id: "effects", title: "Effects", fields: [
        { key: "corona",          type: "toggle", label: "Edge corona", default: true },
        { key: "coronaIntensity", type: "range",  label: "Corona intensity", default: 0.1, min: 0, max: 0.4, step: 0.02, display: "pctOfMax" },
        { key: "nodes",           type: "toggle", label: "Star nodes", default: true },
        { key: "orbits",          type: "toggle", label: "Orbital rings", default: true },
      ],
    },
    {
      id: "cosmos", title: "Cosmos", fields: [
        { key: "shootingStars", type: "toggle", label: "Shooting stars", default: true },
        { key: "meteorRate",    type: "range",  label: "Meteor frequency", default: 0.5, min: 0, max: 1, step: 0.05, display: "pct" },
        { key: "beamTrails",    type: "toggle", label: "Comet beam trails", default: true },
        { key: "atmosPulse",    type: "toggle", label: "Atmosphere pulse", default: true },
        { key: "starTwinkle",   type: "toggle", label: "Star twinkle", default: true },
        { key: "starDrift",     type: "toggle", label: "Star drift", default: true },
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
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const f of sceneFields()) {
    const v = src[f.key];
    if (f.type === "toggle") {
      out[f.key] = typeof v === "boolean" ? v : f.default;
    } else if (f.type === "select") {
      out[f.key] = f.options.some((o) => o.value === v) ? v : f.default;
    } else { // range
      let n = Number(v);
      if (!Number.isFinite(n)) n = f.default;
      n = Math.min(f.max, Math.max(f.min, n));
      if (f.step) n = Math.min(f.max, Math.max(f.min, f.min + Math.round((n - f.min) / f.step) * f.step));
      out[f.key] = Number(n.toFixed(6)); // kill binary-float dust from snapping
    }
  }
  return out;
}

// Human-readable read-out for a range field (used by the demo panel only).
export function formatValue(field, value) {
  if (field.display === "pct") return Math.round(value * 100) + "%";
  if (field.display === "pctOfMax") return Math.round((value / field.max) * 100) + "%";
  return Number(value).toFixed(field.decimals ?? 0) + (field.unit || "");
}
