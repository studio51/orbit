/* Orbit — UI wiring (shared by both renderers)
 *
 * The panel, activity list and ticker are pure DOM and backend-agnostic: they
 * mutate the live `scene` / `sim` / activity-state objects the engine reads,
 * and notify the engine when a change needs a structural rebuild. Both
 * renderers reuse this verbatim so their controls behave identically.
 */
import { SCENE_SCHEMA, formatValue } from './scene-schema.js';
import { saveScene, STORAGE } from './config.js';

const STRUCTURAL_KEYS = new Set(['density']); // changes that require a rebuild

// ---- "Scene & effects" gear panel (demo only) --------------------------
// Rendered straight from the schema, so adding a setting there adds a control here.
export function buildScenePanel({ host, toggle, scene, onChange }) {
  const fields = SCENE_SCHEMA.sections.flatMap((s) => s.fields);
  const byKey = {};

  fields.forEach((f) => {
    byKey[f.key] = f;
  });

  host.innerHTML = SCENE_SCHEMA.sections.map(sectionHTML).join('');

  // hydrate controls from current scene
  fields.forEach((f) => {
    if (f.type === 'range') {
      host.querySelector(`[data-k="${f.key}"]`).value = scene[f.key];
      host.querySelector(`[data-val="${f.key}"]`).textContent = formatValue(f, scene[f.key]);
    } else if (f.type === 'toggle') {
      host
        .querySelector(`[data-tog="${f.key}"]`)
        .setAttribute('aria-pressed', scene[f.key] ? 'true' : 'false');
    } else if (f.type === 'select') {
      host.querySelectorAll(`[data-seg="${f.key}"]`).forEach((bn) => {
        bn.classList.toggle('on', bn.getAttribute('data-v') === scene[f.key]);
      });
    }
  });

  const commit = (k) => {
    saveScene(scene);

    onChange(k, STRUCTURAL_KEYS.has(k));
  };

  host.addEventListener('input', (e) => {
    const k = e.target.getAttribute('data-k');

    if (!k) return;
    scene[k] = +e.target.value;
    host.querySelector(`[data-val="${k}"]`).textContent = formatValue(byKey[k], scene[k]);

    commit(k);
  });

  host.addEventListener('click', (e) => {
    const tog = e.target.closest('[data-tog]');

    if (tog) {
      const k = tog.getAttribute('data-tog');

      scene[k] = !scene[k];
      tog.setAttribute('aria-pressed', scene[k] ? 'true' : 'false');
      commit(k);
      return;
    }

    const seg = e.target.closest('[data-seg]');

    if (seg) {
      const k = seg.getAttribute('data-seg'),
        v = seg.getAttribute('data-v');

      scene[k] = v;
      host
        .querySelectorAll(`[data-seg="${k}"]`)
        .forEach((bn) => bn.classList.toggle('on', bn === seg));
      commit(k);
    }
  });

  // open/close + persistence
  function setOpen(open) {
    host.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-pressed', open ? 'true' : 'false');

    try {
      localStorage.setItem(STORAGE.sceneOpen, open ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
  }
  toggle.addEventListener('click', () => setOpen(host.hasAttribute('hidden')));

  let wasOpen = false;

  try {
    wasOpen = localStorage.getItem(STORAGE.sceneOpen) === '1';
  } catch (e) {
    /* ignore */
  }

  if (wasOpen) setOpen(true);
}

function sectionHTML(section) {
  return `<div class="sec-h">${section.title}</div>` + section.fields.map(fieldHTML).join('');
}
function fieldHTML(f) {
  if (f.type === 'range') {
    return (
      `<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">${f.label}</span>` +
      `<span class="sc-val" data-val="${f.key}"></span></div>` +
      `<input type="range" data-k="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}"></div>`
    );
  }
  if (f.type === 'toggle') {
    return (
      `<div class="sc-row"><span class="sc-lbl">${f.label}</span>` +
      `<button class="sw" data-tog="${f.key}" aria-pressed="false"></button></div>`
    );
  }
  if (f.type === 'select') {
    const b = f.options
      .map((o) => `<button data-seg="${f.key}" data-v="${o.value}">${o.label}</button>`)
      .join('');

    return `<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">${f.label}</span></div><div class="sc-seg">${b}</div></div>`;
  }

  return '';
}

// ---- activity list (swatch / name / count / toggle) --------------------
export function buildActivityControls({ list, types, state }) {
  types.forEach((t) => {
    const row = document.createElement('div');

    row.className = 'act-row';
    row.innerHTML =
      `<label class="swatch" style="--c:${t.color}">` +
      `<input type="color" value="${t.color}" data-color="${t.id}"></label>` +
      `<span class="act-name">${t.label}</span>` +
      `<span class="act-count" data-count="${t.id}">0</span>` +
      `<button class="eye" data-toggle="${t.id}" aria-pressed="true" title="Toggle">` +
      `<span class="eye-dot"></span></button>`;

    list.appendChild(row);
  });

  list.addEventListener('input', (e) => {
    const id = e.target.getAttribute('data-color');

    if (!id) return;
    state.types[id].color = e.target.value;

    e.target.closest('.swatch').style.setProperty('--c', e.target.value);
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');

    if (!btn) return;

    const id = btn.getAttribute('data-toggle');
    const on = !state.types[id].enabled;

    state.types[id].enabled = on;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');

    btn.closest('.act-row').classList.toggle('off', !on);
  });

  const totalEl = document.getElementById('total-count');

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
  const rate = document.getElementById('rate');
  const rateVal = document.getElementById('rate-val');

  rate.value = sim.rate;
  rateVal.textContent = sim.rate.toFixed(1) + '/s';
  rate.addEventListener('input', () => {
    sim.rate = +rate.value;
    rateVal.textContent = sim.rate.toFixed(1) + '/s';
  });

  const rot = document.getElementById('rot');
  const rotVal = document.getElementById('rot-val');

  rot.value = sim.rotSpeed;
  rotVal.textContent = sim.rotSpeed === 0 ? 'off' : sim.rotSpeed + '°/s';
  rot.addEventListener('input', () => {
    sim.rotSpeed = +rot.value;
    rotVal.textContent = sim.rotSpeed === 0 ? 'off' : sim.rotSpeed + '°/s';
  });

  const pause = document.getElementById('pause');

  pause.addEventListener('click', () => {
    sim.paused = !sim.paused;
    pause.classList.toggle('paused', sim.paused);

    pause.querySelector('.pp-label').textContent = sim.paused ? 'Play' : 'Pause';
  });

  const fwSel = document.getElementById('fw-trigger');

  types.forEach((t) => {
    const o = document.createElement('option');

    o.value = t.id;
    o.textContent = t.label;
    if (t.id === sim.fwTrigger) o.selected = true;

    fwSel.appendChild(o);
  });
  fwSel.value = sim.fwTrigger;
  fwSel.addEventListener('change', () => {
    sim.fwTrigger = fwSel.value;
  });

  const fwTog = document.getElementById('fw-toggle');

  fwTog.addEventListener('click', () => {
    sim.fireworks = !sim.fireworks;
    fwTog.setAttribute('aria-pressed', sim.fireworks ? 'true' : 'false');

    fwTog.closest('.fw-row').classList.toggle('off', !sim.fireworks);
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

      const line = document.createElement('div');

      line.className = 'tk-line';
      line.innerHTML =
        `<span class="tk-dot" style="color:${color};background:${color}"></span>` +
        `<span class="tk-txt">${verbs[type.id] || type.label}` +
        ` <span class="tk-city">· ${cityName}</span></span>`;
      el.insertBefore(line, el.firstChild);

      while (el.children.length > 7) el.removeChild(el.lastChild);
    },
    // surge callout — a highlighted line that bypasses the throttle
    special(text) {
      const line = document.createElement('div');

      line.className = 'tk-line tk-surge';
      line.innerHTML =
        `<span class="tk-dot" style="color:#5ad1ff;background:#5ad1ff"></span>` +
        `<span class="tk-txt">${text}</span>`;
      el.insertBefore(line, el.firstChild);

      while (el.children.length > 7) el.removeChild(el.lastChild);
    },
  };
}
