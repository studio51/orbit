/* games.directory globe — SVG entry point */
import { HQ, ACTIVITY_TYPES, CITIES, VERBS, LAND_URLS } from "../shared/data.js";
import { loadScene, SIM_DEFAULTS } from "../shared/config.js";
import { buildScenePanel, buildActivityControls, buildBaseControls, createTicker } from "../shared/ui.js";
import { createFpsMeter } from "../shared/fps.js";
import { Engine } from "./engine.js";
import { registerDefaultLayers } from "./layers.js";

const svg = document.getElementById("globe-svg");
const scene = loadScene();
const sim = { ...SIM_DEFAULTS };
const data = { HQ, ACTIVITY_TYPES, CITIES, landFeature: null };

const engine = new Engine({ svg, scene, sim, data });
registerDefaultLayers(engine);
engine.fps = createFpsMeter("svg");

// ---- UI wiring ---------------------------------------------------------
const activities = buildActivityControls({
  list: document.getElementById("activity-list"),
  types: ACTIVITY_TYPES,
  state: engine.state,
});
engine.onCount((id) => activities.bump(id));

const ticker = createTicker(document.getElementById("ticker"), VERBS);
engine.on("beam", ({ type, city, color }) => ticker.push(type, city.name, color));

buildBaseControls({ sim, types: ACTIVITY_TYPES });

function applyStarfield() {
  const stars = document.querySelectorAll(".stars");
  const drift = ["drift1 140s linear infinite", "drift2 200s linear infinite"];
  const twk = ["tw1 5.5s ease-in-out infinite", "tw2 7s ease-in-out infinite"];
  stars.forEach((el, i) => {
    el.style.animation = [scene.starDrift ? drift[i] : "", scene.starTwinkle ? twk[i] : ""]
      .filter(Boolean).join(", ");
  });
}

buildScenePanel({
  host: document.getElementById("scene"),
  toggle: document.getElementById("scene-toggle"),
  scene,
  onChange: (key, structural) => {
    if (structural) engine.rebuildFor(key);
    engine.applyScene();
    if (key === "starDrift" || key === "starTwinkle") applyStarfield();
  },
});
applyStarfield();

// ---- load world topology, then go --------------------------------------
function fail(msg) {
  const l = document.getElementById("loading");
  if (l) l.innerHTML = `<div class="load-err">Could not load world map data.<br><small>${msg}</small></div>`;
}
async function loadLand() {
  for (const url of LAND_URLS) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const topo = await r.json();
      return topojson.feature(topo, topo.objects.land);
    } catch (e) { /* try next source */ }
  }
  return null;
}

loadLand().then((feature) => {
  if (!feature) { fail("all map sources unreachable"); return; }
  data.landFeature = feature;
  document.getElementById("loading").style.display = "none";
  engine.start();
});
