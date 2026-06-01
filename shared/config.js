/* games.directory globe — scene configuration (shared by both renderers)
 *
 * SCENE_DEFAULTS is the full set of live-tunable knobs. SCENE_SPEC describes
 * how the "Scene & effects" panel renders them. Both renderers read the same
 * scene object, so the canvas and SVG builds stay pixel-comparable.
 */

export const SCENE_DEFAULTS = {
  // texture
  dotSize: 2.9, texture: 0.32, density: "med", landBright: 1, grid: false,
  // atmosphere
  atmos: 1,
  // day & night
  dayNight: true, darkness: 0.55, cityLights: true, cityBright: 1,
  // aurora
  aurora: true, auroraIntensity: 1, auroraLat: 71, auroraSpeed: 1, auroraScheme: "gv",
  // effects
  corona: true, coronaIntensity: 0.1, nodes: true, orbits: true,
  // cosmos
  shootingStars: true, meteorRate: 0.5, starTwinkle: true, starDrift: true,
  atmosPulse: true, beamTrails: true,
};

// Live activity simulation defaults (driven by the base control panel).
export const SIM_DEFAULTS = {
  paused: false,
  rotSpeed: 6,            // degrees / second (auto-rotate)
  rate: 3.0,              // activities per second
  fireworks: true,        // celebratory burst on the trigger event
  fwTrigger: "completed", // which activity sets off fireworks
};

// Land-dot grid spacing per density setting (smaller = denser).
export const DENSITY_STEP = { sparse: 3.8, med: 3.0, dense: 2.4 };

// Aurora colour schemes: [glow stroke, veil stroke].
export const AURORA_SCHEMES = {
  gv: ["#5cffb0", "#b58cff"],
  emerald: ["#3dffa0", "#7affd1"],
  rose: ["#ff7ab0", "#b58cff"],
};

export const STORAGE = {
  scene: "gd-globe-scene",
  sceneOpen: "gd-globe-scene-open",
};

const pct = (v) => Math.round(v * 100) + "%";
const ofMax = (max) => (v) => Math.round((v / max) * 100) + "%";

// Declarative description of the gear panel. `sec` rows are headers; the rest
// are controls bound to a SCENE_DEFAULTS key.
export const SCENE_SPEC = [
  { sec: "Texture" },
  { k: "dotSize",     t: "slider", l: "Dot size",       min: 1.5, max: 4.5, step: 0.1,  fmt: (v) => v.toFixed(1) + "px" },
  { k: "texture",     t: "slider", l: "Relief texture", min: 0,   max: 0.6, step: 0.02, fmt: ofMax(0.6) },
  { k: "landBright",  t: "slider", l: "Land brightness", min: 0.4, max: 1,  step: 0.05, fmt: pct },
  { k: "density",     t: "seg",    l: "Dot density", opts: [["sparse", "Sparse"], ["med", "Medium"], ["dense", "Dense"]] },
  { k: "grid",        t: "toggle", l: "Lat / long grid" },

  { sec: "Atmosphere" },
  { k: "atmos",       t: "slider", l: "Atmospheric glow", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 50) + "%" },

  { sec: "Day & night" },
  { k: "dayNight",    t: "toggle", l: "Day / night shadow" },
  { k: "darkness",    t: "slider", l: "Night darkness", min: 0, max: 0.9, step: 0.05, fmt: ofMax(0.9) },
  { k: "cityLights",  t: "toggle", l: "City lights" },
  { k: "cityBright",  t: "slider", l: "City brightness", min: 0.3, max: 1.4, step: 0.05, fmt: ofMax(1.4) },

  { sec: "Aurora" },
  { k: "aurora",          t: "toggle", l: "Aurora" },
  { k: "auroraIntensity", t: "slider", l: "Intensity", min: 0, max: 1.5, step: 0.05, fmt: ofMax(1.5) },
  { k: "auroraLat",       t: "slider", l: "Latitude",  min: 55, max: 82, step: 1, fmt: (v) => v + "°" },
  { k: "auroraSpeed",     t: "slider", l: "Speed",     min: 0, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + "×" },
  { k: "auroraScheme",    t: "seg",    l: "Colour", opts: [["gv", "Green·Violet"], ["emerald", "Emerald"], ["rose", "Rose"]] },

  { sec: "Effects" },
  { k: "corona",          t: "toggle", l: "Edge corona" },
  { k: "coronaIntensity", t: "slider", l: "Corona intensity", min: 0, max: 0.4, step: 0.02, fmt: ofMax(0.4) },
  { k: "nodes",           t: "toggle", l: "Star nodes" },
  { k: "orbits",          t: "toggle", l: "Orbital rings" },

  { sec: "Cosmos" },
  { k: "shootingStars", t: "toggle", l: "Shooting stars" },
  { k: "meteorRate",    t: "slider", l: "Meteor frequency", min: 0, max: 1, step: 0.05, fmt: pct },
  { k: "beamTrails",    t: "toggle", l: "Comet beam trails" },
  { k: "atmosPulse",    t: "toggle", l: "Atmosphere pulse" },
  { k: "starTwinkle",   t: "toggle", l: "Star twinkle" },
  { k: "starDrift",     t: "toggle", l: "Star drift" },
];

// Load persisted scene, falling back to defaults. Only known keys are kept.
export function loadScene() {
  const scene = { ...SCENE_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.scene) || "{}");
    for (const k of Object.keys(saved)) if (k in scene) scene[k] = saved[k];
  } catch (e) { /* ignore malformed storage */ }
  return scene;
}

export function saveScene(scene) {
  try { localStorage.setItem(STORAGE.scene, JSON.stringify(scene)); } catch (e) { /* ignore */ }
}
