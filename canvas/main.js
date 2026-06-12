/* Orbit — Canvas2D entry point
 *
 * Modes:
 *   • clean (default)  — the production hero: globe + brand + live ticker, no controls.
 *   • demo (?demo)     — adds the FPS meter and the full control / "Scene & effects" panel.
 *
 * Scene source (all validated against the schema before use):
 *   • window.__ORBIT_SCENE__   inline embed from the platform        (highest priority)
 *   • ?config=<url>         fetch the per-deployment config JSON
 *   • ?demo                 the demo's own localStorage
 *   • otherwise             schema defaults
 */
import { HQ, ACTIVITY_TYPES, CITIES, VERBS, LAND_URLS } from '../shared/data.js';
import { SIM_DEFAULTS, resolveScene } from '../shared/config.js';
import {
  buildScenePanel,
  buildActivityControls,
  buildBaseControls,
  createTicker,
} from '../shared/ui.js';
import { createFpsMeter } from '../shared/fps.js';
import { Engine } from './engine.js';
import { registerDefaultLayers } from './layers.js';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');

document.body.classList.toggle('demo', demo);

const canvas = document.getElementById('globe-canvas');
const sim = { ...SIM_DEFAULTS };
const data = { HQ, ACTIVITY_TYPES, CITIES, landFeature: null };

const scene = await resolveScene({
  demo,
  configUrl: params.get('config'),
  inline: window.__ORBIT_SCENE__,
});
const engine = new Engine({ canvas, scene, sim, data });

registerDefaultLayers(engine);

function applyStarfield() {
  const stars = document.querySelectorAll('.stars');
  const drift = ['drift1 140s linear infinite', 'drift2 200s linear infinite'];
  const twk = ['tw1 5.5s ease-in-out infinite', 'tw2 7s ease-in-out infinite'];

  stars.forEach((el, i) => {
    el.style.animation = [scene.starDrift ? drift[i] : '', scene.starTwinkle ? twk[i] : '']
      .filter(Boolean)
      .join(', ');
  });
}
applyStarfield();

// Live ticker is part of the hero spectacle — shown in both modes.
const ticker = createTicker(document.getElementById('ticker'), VERBS);

engine.on('beam', ({ type, city, color }) => ticker.push(type, city.name, color));
engine.on('surge', ({ city }) => ticker.special(`${city.name} is lighting up right now`));

// Controls + FPS meter are demo-only; the production hero stays clean.
if (demo) {
  engine.fps = createFpsMeter('canvas');

  const activities = buildActivityControls({
    list: document.getElementById('activity-list'),
    types: ACTIVITY_TYPES,
    state: engine.state,
  });

  engine.onCount((id) => activities.bump(id));
  buildBaseControls({ sim, types: ACTIVITY_TYPES });
  buildScenePanel({
    host: document.getElementById('scene'),
    toggle: document.getElementById('scene-toggle'),
    scene,
    onChange: (key, structural) => {
      if (structural) engine.rebuildFor(key);
      engine.applyScene();
      if (key === 'starDrift' || key === 'starTwinkle') applyStarfield();

      if (key === 'intro' && scene.intro) engine.replayIntro(); // toggle on → replay the arrival
    },
  });
}

// ---- load world topology, then go --------------------------------------
function fail(msg) {
  const l = document.getElementById('loading');

  if (l)
    l.innerHTML = `<div class="load-err">Could not load world map data.<br><small>${msg}</small></div>`;
}
async function loadLand() {
  for (const url of LAND_URLS) {
    try {
      const r = await fetch(url);

      if (!r.ok) throw new Error('HTTP ' + r.status);

      const topo = await r.json();

      return topojson.feature(topo, topo.objects.land);
    } catch (e) {
      /* try next source */
    }
  }

  return null;
}

loadLand().then((feature) => {
  if (!feature) {
    fail('all map sources unreachable');
    return;
  }
  data.landFeature = feature;
  document.getElementById('loading').style.display = 'none';

  engine.start();
});
