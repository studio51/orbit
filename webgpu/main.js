/* Orbit: WebGPU entry point
 *
 * Modes:
 *   • clean (default)  the production hero: globe, brand and live ticker, no controls.
 *   • demo (?demo)     adds the live feed, look lenses, scene settings and FPS meter.
 *
 * Scene source (all validated against the schema before use):
 *   • window.__ORBIT_SCENE__   inline embed from the platform        (highest priority)
 *   • ?config=<url>            fetch the per-deployment config JSON
 *   • ?demo                    the demo's own localStorage
 *   • otherwise                schema defaults
 *
 * `?look=<id>` overrides the look for this load (realistic, cartoon, neon, hologram, ink).
 */
import { HQ, ACTIVITY_TYPES, CITIES, VERBS, LAND_URLS_HD, LAND_URLS } from '../shared/data.js';
import { SIM_DEFAULTS, resolveScene, saveScene, sanitizeScene } from '../shared/config.js';
import {
  buildScenePanel,
  buildActivityControls,
  buildBaseControls,
  buildLookLenses,
  applyLookTheme,
  createTicker,
} from '../shared/ui.js';
import { createFpsMeter } from '../shared/fps.js';
import { fetchTopology } from '../shared/topology.js';
import { bakeWorld } from './world.js';
import { GlobeEngine } from './engine.js';
import { LOOKS } from './looks.js';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const loading = document.getElementById('loading');

document.body.classList.toggle('demo', demo);

const scene = await resolveScene({
  demo,
  configUrl: params.get('config'),
  inline: window.__ORBIT_SCENE__,
});

if (params.has('look')) scene.look = sanitizeScene({ look: params.get('look') }).look;

applyLookTheme(scene.look);

const topo = await fetchTopology([...LAND_URLS_HD, ...LAND_URLS]);

if (!topo) {
  loading.innerHTML =
    '<div class="load-err">Could not load the world map.<br>Check your connection and reload.</div>';
  throw new Error('world topology unreachable');
}

const sim = { ...SIM_DEFAULTS };
const data = { HQ, ACTIVITY_TYPES, CITIES };
const engine = new GlobeEngine({
  canvas: document.getElementById('globe-canvas'),
  scene,
  sim,
  data,
  world: bakeWorld(topo, CITIES),
});

if (demo || params.has('debug')) window.__orbit = engine; // handy in the console

// A host page (the landing page) can switch the look of an embedded globe.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.orbit !== 'look') return;

  const { look } = sanitizeScene({ look: e.data.id });

  engine.setLook(look);

  applyLookTheme(look);
});

// The live ticker is part of the hero spectacle, so it shows in both modes.
const ticker = createTicker(document.getElementById('ticker'), VERBS);

engine.on('beam', ({ type, city, color }) => ticker.push(type, city.name, color));
engine.on('surge', ({ city }) => ticker.special(`${city.name} is lighting up right now`));

// Controls and the FPS meter are demo-only; the production hero stays clean.
if (demo) {
  engine.fps = createFpsMeter('WebGPU');

  const activities = buildActivityControls({
    list: document.getElementById('activity-list'),
    types: ACTIVITY_TYPES,
    state: engine.state,
  });

  engine.onCount((id) => activities.bump(id));
  buildBaseControls({ sim, types: ACTIVITY_TYPES });

  const lenses = buildLookLenses({
    host: document.getElementById('lenses'),
    looks: LOOKS,
    current: scene.look,
    onSelect: async (id) => {
      if (id === scene.look) return;

      lenses.busy(id, true);
      await engine.setLook(id);
      lenses.busy(id, false);
      lenses.set(id);
      applyLookTheme(id);

      saveScene(scene);
    },
  });

  buildScenePanel({
    host: document.getElementById('scene'),
    toggle: document.getElementById('scene-toggle'),
    scene,
    renderer: 'webgpu',
    hide: ['look'], // chosen with the lenses
    onChange: (key) => {
      engine.applyScene();

      if (key === 'intro' && scene.intro) engine.replayIntro(); // toggled on, so replay the arrival
    },
  });
}

await engine.init();
loading.style.display = 'none';
engine.start();
