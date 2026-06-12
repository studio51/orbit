/* Orbit — configuration
 *
 * The tunable *scene* settings and their bounds live in scene-schema.js (the
 * platform-facing contract). This module derives the runtime defaults from it,
 * adds the non-scene knobs (simulation, palettes, storage keys), and provides
 * `resolveScene()` — the single entry point that produces a validated scene from
 * whichever source applies (platform API, inline embed, or the demo's localStorage).
 */
import { SCENE_SCHEMA, sceneDefaults, sanitizeScene } from './scene-schema.js';

export { SCENE_SCHEMA, sanitizeScene };

// Default scene (every key validated by construction).
export const SCENE_DEFAULTS = sceneDefaults();

// Live activity simulation defaults (driven by the demo's base control panel).
export const SIM_DEFAULTS = {
  paused: false,
  rotSpeed: 4, // degrees / second (auto-rotate) — calm and majestic
  rate: 2.4, // activities per second
  fireworks: true, // celebratory burst on the trigger event
  fwTrigger: 'completed', // which activity sets off fireworks
};

// Land-dot grid spacing per density setting (smaller = denser).
export const DENSITY_STEP = { sparse: 3.8, med: 3.0, dense: 2.4 };

// Aurora colour schemes: [glow stroke, veil stroke].
export const AURORA_SCHEMES = {
  gv: ['#5cffb0', '#b58cff'],
  emerald: ['#3dffa0', '#7affd1'],
  rose: ['#ff7ab0', '#b58cff'],
};

export const STORAGE = {
  scene: 'orbit-scene',
  sceneOpen: 'orbit-scene-open',
};

// ---- demo-mode persistence (localStorage) ------------------------------
export function loadScene() {
  try {
    return sanitizeScene(JSON.parse(localStorage.getItem(STORAGE.scene) || '{}'));
  } catch (e) {
    return sceneDefaults();
  }
}
export function saveScene(scene) {
  try {
    localStorage.setItem(STORAGE.scene, JSON.stringify(scene));
  } catch (e) {
    /* ignore */
  }
}

// ---- where the scene comes from ----------------------------------------
// Precedence: inline embed > platform API (configUrl) > demo localStorage > defaults.
// Every path runs through sanitizeScene(), so the renderer only ever sees a
// fully-validated, in-bounds scene.
export async function resolveScene({ demo = false, configUrl = null, inline = null } = {}) {
  if (inline && typeof inline === 'object') return sanitizeScene(inline);
  if (configUrl) {
    try {
      const r = await fetch(configUrl, { headers: { Accept: 'application/json' } });
      if (r.ok) return sanitizeScene(await r.json());
    } catch (e) {
      /* fall through to defaults */
    }
    return sceneDefaults();
  }
  if (demo) return loadScene();
  return sceneDefaults();
}
