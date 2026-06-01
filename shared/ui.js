/* games.directory globe — UI wiring (shared by both renderers)
 *
 * The panel, activity list and ticker are pure DOM and backend-agnostic: they
 * mutate the live `scene` / `sim` / activity-state objects the engine reads,
 * and notify the engine when a change needs a structural rebuild. Both
 * renderers reuse this verbatim so their controls behave identically.
 */
import { SCENE_SPEC, saveScene, STORAGE } from "./config.js";

const STRUCTURAL_KEYS = new Set(["density"]); // changes that require a rebuild

// ---- "Scene & effects" gear panel --------------------------------------
export function buildScenePanel({ host, toggle, scene, onChange }) {
  const byKey = {};
  SCENE_SPEC.forEach((c) => { if (c.k) byKey[c.k] = c; });

  host.innerHTML = SCENE_SPEC.map(ctrlHTML).join("");

  // hydrate controls from current scene
  SCENE_SPEC.forEach((c) => {
    if (!c.k) return;
    if (c.t === "slider") {
      host.querySelector(`[data-k="${c.k}"]`).value = scene[c.k];
      host.querySelector(`[data-val="${c.k}"]`).textContent = c.fmt(+scene[c.k]);
    } else if (c.t === "toggle") {
      host.querySelector(`[data-tog="${c.k}"]`).setAttribute("aria-pressed", scene[c.k] ? "true" : "false");
    } else if (c.t === "seg") {
      host.querySelectorAll(`[data-seg="${c.k}"]`).forEach((bn) => {
        bn.classList.toggle("on", bn.getAttribute("data-v") === scene[c.k]);
      });
    }
  });

  const commit = (k) => { saveScene(scene); onChange(k, STRUCTURAL_KEYS.has(k)); };

  host.addEventListener("input", (e) => {
    const k = e.target.getAttribute("data-k");
    if (!k) return;
    scene[k] = +e.target.value;
    host.querySelector(`[data-val="${k}"]`).textContent = byKey[k].fmt(scene[k]);
    commit(k);
  });

  host.addEventListener("click", (e) => {
    const tog = e.target.closest("[data-tog]");
    if (tog) {
      const k = tog.getAttribute("data-tog");
      scene[k] = !scene[k];
      tog.setAttribute("aria-pressed", scene[k] ? "true" : "false");
      commit(k);
      return;
    }
    const seg = e.target.closest("[data-seg]");
    if (seg) {
      const k = seg.getAttribute("data-seg"), v = seg.getAttribute("data-v");
      scene[k] = v;
      host.querySelectorAll(`[data-seg="${k}"]`).forEach((bn) => bn.classList.toggle("on", bn === seg));
      commit(k);
    }
  });

  // open/close + persistence
  function setOpen(open) {
    host.toggleAttribute("hidden", !open);
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
    try { localStorage.setItem(STORAGE.sceneOpen, open ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  toggle.addEventListener("click", () => setOpen(host.hasAttribute("hidden")));
  let wasOpen = false;
  try { wasOpen = localStorage.getItem(STORAGE.sceneOpen) === "1"; } catch (e) { /* ignore */ }
  if (wasOpen) setOpen(true);
}

function ctrlHTML(c) {
  if (c.sec) return `<div class="sec-h">${c.sec}</div>`;
  if (c.t === "slider") {
    return `<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">${c.l}</span>` +
      `<span class="sc-val" data-val="${c.k}"></span></div>` +
      `<input type="range" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}"></div>`;
  }
  if (c.t === "toggle") {
    return `<div class="sc-row"><span class="sc-lbl">${c.l}</span>` +
      `<button class="sw" data-tog="${c.k}" aria-pressed="false"></button></div>`;
  }
  if (c.t === "seg") {
    const b = c.opts.map((o) => `<button data-seg="${c.k}" data-v="${o[0]}">${o[1]}</button>`).join("");
    return `<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">${c.l}</span></div><div class="sc-seg">${b}</div></div>`;
  }
  return "";
}

// ---- activity list (swatch / name / count / toggle) --------------------
export function buildActivityControls({ list, types, state }) {
  types.forEach((t) => {
    const row = document.createElement("div");
    row.className = "act-row";
    row.innerHTML =
      `<label class="swatch" style="--c:${t.color}">` +
        `<input type="color" value="${t.color}" data-color="${t.id}"></label>` +
      `<span class="act-name">${t.label}</span>` +
      `<span class="act-count" data-count="${t.id}">0</span>` +
      `<button class="eye" data-toggle="${t.id}" aria-pressed="true" title="Toggle">` +
        `<span class="eye-dot"></span></button>`;
    list.appendChild(row);
  });

  list.addEventListener("input", (e) => {
    const id = e.target.getAttribute("data-color");
    if (!id) return;
    state.types[id].color = e.target.value;
    e.target.closest(".swatch").style.setProperty("--c", e.target.value);
  });
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle]");
    if (!btn) return;
    const id = btn.getAttribute("data-toggle");
    const on = !state.types[id].enabled;
    state.types[id].enabled = on;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.closest(".act-row").classList.toggle("off", !on);
  });

  const totalEl = document.getElementById("total-count");
  return {
    // refresh the per-type and grand-total counters
    bump(id) {
      const node = list.querySelector(`[data-count="${id}"]`);
      if (node) node.textContent = state.types[id].count.toLocaleString();
      if (totalEl) {
        let total = 0;
        for (const k in state.types) total += state.types[k].count;
        totalEl.textContent = total.toLocaleString();
      }
    },
  };
}

// ---- base controls: rate / rotation / pause / fireworks ----------------
export function buildBaseControls({ sim, types }) {
  const rate = document.getElementById("rate");
  const rateVal = document.getElementById("rate-val");
  rate.value = sim.rate;
  rateVal.textContent = sim.rate.toFixed(1) + "/s";
  rate.addEventListener("input", () => {
    sim.rate = +rate.value;
    rateVal.textContent = sim.rate.toFixed(1) + "/s";
  });

  const rot = document.getElementById("rot");
  const rotVal = document.getElementById("rot-val");
  rot.value = sim.rotSpeed;
  rotVal.textContent = sim.rotSpeed === 0 ? "off" : sim.rotSpeed + "°/s";
  rot.addEventListener("input", () => {
    sim.rotSpeed = +rot.value;
    rotVal.textContent = sim.rotSpeed === 0 ? "off" : sim.rotSpeed + "°/s";
  });

  const pause = document.getElementById("pause");
  pause.addEventListener("click", () => {
    sim.paused = !sim.paused;
    pause.classList.toggle("paused", sim.paused);
    pause.querySelector(".pp-label").textContent = sim.paused ? "Play" : "Pause";
  });

  const fwSel = document.getElementById("fw-trigger");
  types.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.id; o.textContent = t.label;
    if (t.id === sim.fwTrigger) o.selected = true;
    fwSel.appendChild(o);
  });
  fwSel.value = sim.fwTrigger;
  fwSel.addEventListener("change", () => { sim.fwTrigger = fwSel.value; });

  const fwTog = document.getElementById("fw-toggle");
  fwTog.addEventListener("click", () => {
    sim.fireworks = !sim.fireworks;
    fwTog.setAttribute("aria-pressed", sim.fireworks ? "true" : "false");
    fwTog.closest(".fw-row").classList.toggle("off", !sim.fireworks);
  });
}

// ---- live ticker (top-right) -------------------------------------------
export function createTicker(el, verbs) {
  let lastTick = -1e9;
  return {
    push(type, cityName, color) {
      const now = performance.now();
      if (now - lastTick < 220) return; // throttle so high rates don't thrash the DOM
      lastTick = now;
      const line = document.createElement("div");
      line.className = "tk-line";
      line.innerHTML =
        `<span class="tk-dot" style="color:${color};background:${color}"></span>` +
        `<span class="tk-txt">${verbs[type.id] || type.label}` +
        ` <span class="tk-city">· ${cityName}</span></span>`;
      el.insertBefore(line, el.firstChild);
      while (el.children.length > 7) el.removeChild(el.lastChild);
    },
  };
}
