/* Orbit: WebGPU entry point
 *
 * Modes:
 *   • clean (default)  the production hero: globe, brand and live ticker, no controls.
 *   • demo (?demo)     adds the live feed, look lenses, scene settings and the
 *                      performance readout.
 *   • embed (?embed)   clean, minus the brand, for a host page that carries its own.
 *
 * Scene source (all validated against the schema before use):
 *   • window.__ORBIT_SCENE__   inline embed from the platform        (highest priority)
 *   • ?config=<url>            fetch the per-deployment config JSON
 *   • ?demo                    the demo's own localStorage
 *   • otherwise                schema defaults
 *
 * `?look=<id>` overrides the look for this load (realistic, cartoon, neon, hologram, ink).
 * `?scale=<0.5..1>` fixes the resolution scale instead of letting the frame governor choose.
 * `?ticker=<px>` starts the ticker that far from the top, to clear a host page's header.
 *
 * Messages (same origin only): a host page can send `{ orbit: 'look', id }` to switch the
 * look, and receives `{ orbit: 'pace', fps, target, scale, gpuMs }` about once a second.
 */
import { HQ, ACTIVITY_TYPES, CITIES, VERBS, LAND_URLS_HD, LAND_URLS } from '../shared/data.js';
import { SIM_DEFAULTS, resolveScene, saveScene, sanitizeScene } from '../shared/config.js';
import {
  buildScenePanel,
  buildActivityControls,
  buildBaseControls,
  buildLookLenses,
  buildResolutionControl,
  bindShortcuts,
  applyLookTheme,
  createTicker,
} from '../shared/ui.js';
import { createFpsMeter } from '../shared/fps.js';
import { fetchTopology } from '../shared/topology.js';
import { bakeWorld } from './world.js';
import { GlobeEngine } from './engine.js';
import { probeRefresh } from './governor.js';
import { LOOKS } from './looks.js';

const PACE_POST_MS = 1000; // how often an embedded globe reports its frame rate to the host

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const embedded = window.parent !== window;
const loading = document.getElementById('loading');
const step = document.getElementById('loading-step');

document.body.classList.toggle('demo', demo);
document.body.classList.toggle('embed', params.has('embed'));

// A host whose header overlaps the globe can start the ticker lower: `?ticker=<px from top>`.
if (Number(params.get('ticker')) > 0) {
  document.documentElement.style.setProperty('--ticker-top', Number(params.get('ticker')) + 'px');
}

const scene = await resolveScene({
  demo,
  configUrl: params.get('config'),
  inline: window.__ORBIT_SCENE__,
});

if (params.has('look')) scene.look = sanitizeScene({ look: params.get('look') }).look;

applyLookTheme(scene.look);

// The display's refresh rate is measured while the map downloads, when the page is idle.
step.textContent = 'Downloading the world map';

const [topo, refresh] = await Promise.all([
  fetchTopology([...LAND_URLS_HD, ...LAND_URLS]),
  probeRefresh(),
]);

if (!topo) {
  loading.innerHTML =
    '<div class="load-err">Could not load the world map.<br>Check your connection and reload.</div>';
  throw new Error('world topology unreachable');
}

step.textContent = 'Drawing the continents';
await new Promise((r) => requestAnimationFrame(r)); // let the message paint before the bake

const fixedScale = Number(params.get('scale'));
const sim = { ...SIM_DEFAULTS };
const data = { HQ, ACTIVITY_TYPES, CITIES };
const engine = new GlobeEngine({
  canvas: document.getElementById('globe-canvas'),
  scene,
  sim,
  data,
  world: bakeWorld(topo, CITIES),
  refresh,
  resolution: fixedScale > 0 ? fixedScale : null,
  wheelZoom: !params.has('embed'), // an embedded globe leaves the wheel to its host page
});

if (demo || params.has('debug')) window.__orbit = engine; // handy in the console

/**
 * Switch the look everywhere it shows: the scene, the interface theme and the lenses.
 *
 * @param {string} id the look id
 */
let lenses = null;
const showLook = async (id) => {
  const { look } = sanitizeScene({ look: id });

  if (look === scene.look) return;

  lenses?.busy(look, true);
  await engine.setLook(look);
  lenses?.busy(look, false);
  lenses?.set(look);
  applyLookTheme(look);

  if (demo) saveScene(scene);
};

// A host page (the landing page) can switch the look of an embedded globe.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.orbit !== 'look') return;

  showLook(e.data.id);
});

// The live ticker is part of the hero spectacle, so it shows in both modes.
const ticker = createTicker(document.getElementById('ticker'), VERBS);

engine.on('beam', ({ type, city, color }) => ticker.push(type, city.name, color));
engine.on('surge', ({ city }) => ticker.special(`${city.name} is lighting up right now`));

// The readout is demo-only on screen; an embedded globe still measures, to report to its host.
if (demo || embedded) {
  engine.fps = createFpsMeter('WebGPU');
  engine.fps.el.hidden = !demo;
}

if (embedded) {
  setInterval(() => {
    parent.postMessage(
      {
        orbit: 'pace',
        fps: engine.fps.fps(),
        target: engine.pace.target,
        scale: engine.quality,
        gpuMs: Number.isFinite(engine.gpuMs) ? engine.gpuMs : null,
      },
      location.origin
    );
  }, PACE_POST_MS);
}

// Controls are demo-only; the production hero stays clean.
if (demo) {
  const activities = buildActivityControls({
    list: document.getElementById('activity-list'),
    types: ACTIVITY_TYPES,
    state: engine.state,
  });

  engine.onCount((id) => activities.bump(id));
  buildBaseControls({ sim, types: ACTIVITY_TYPES });

  lenses = buildLookLenses({
    host: document.getElementById('lenses'),
    looks: LOOKS,
    current: scene.look,
    onSelect: showLook,
  });

  // Resolution: automatic by default; the read-out shows what the governor settled on.
  const resVal = document.getElementById('res-val');
  const showRes = () => {
    resVal.textContent =
      Math.round(engine.quality * 100) + '%' + (engine.pace.pinned ? '' : ' auto');
  };

  buildResolutionControl({
    host: document.getElementById('resolution'),
    current: engine.pace.pinned ? engine.quality : null,
    onChange: (scale) => engine.setResolution(scale),
  });

  engine.on('pace', showRes);

  showRes();

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

  const shortcuts = {
    ' ': () => document.getElementById('pause').click(),
    h: () => document.body.classList.toggle('bare'),
    f: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    },
    r: () => engine.replayIntro(),
    Escape: () => document.body.classList.remove('bare'),
  };

  LOOKS.forEach((l, i) => {
    shortcuts[String(i + 1)] = () => showLook(l.id);
  });

  bindShortcuts(shortcuts);
}

step.textContent = 'Compiling shaders';
await engine.init();
loading.classList.add('done');
engine.start();
