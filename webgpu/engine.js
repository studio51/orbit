/* Orbit: WebGPU engine
 *
 * Owns the renderer, the scene graph, the clock and the per-frame choreography:
 * sun position from the real clock, the cinematic arrival, city surges, beam
 * spawn cadence, adaptive resolution and the look cross-fade.
 *
 * The visual modules are independent and talk to the engine only through the
 * shared uniform bag (`U`) and the `LookState`:
 *
 *   earth.js   planet + clouds + atmosphere     sky.js     stars / nebula / sun glare
 *   beams.js   activity arcs, rings, beacon     sparks.js  GPU-compute particles
 *   post.js    bloom + per-look finishing
 *
 * Events (via `on`): 'beam' ({ type, city, color }) when an activity spawns,
 * 'impact' ({ type, city, color }) when it lands, 'surge' ({ city }).
 */
import * as THREE from 'three/webgpu';
import { DEG, clamp } from '../shared/util.js';
import { weightedPick } from '../shared/util.js';
import { LookState } from './looks.js';
import { createUniforms } from './uniforms.js';
import { OrbitRig } from './rig.js';
import { createEarth } from './earth.js';
import { bakePlanet } from './bake.js';
import { createSky } from './sky.js';
import { createBeams } from './beams.js';
import { createSparks } from './sparks.js';
import { createCosmos } from './cosmos.js';
import { createPost } from './post.js';
import { lnglatToVec3 } from './tsl-util.js';

const INTRO_MS = 3200; // cinematic arrival duration
const INTRO_BEAMS_AT = 0.85; // beams hold until the scene has mostly bloomed
const QUALITY_MIN = 0.55; // never drop below ~half-res backing store
const EMA_SLOW_MS = 21; // sustained frames slower than this → step down
const EMA_FAST_MS = 14.5; // sustained frames faster than this → step up
const COOLDOWN_FRAMES = 150; // min frames between quality changes
const SURGE_FIRST_MS = 35000; // first city surge after load
const SURGE_EVERY_MS = [50000, 90000]; // min..max between surges
const SURGE_LEN_MS = 6500; // how long a surge lasts

export class GlobeEngine {
  #handlers = {};

  #hooks = [];

  #ema = 16.7;

  #cooldown = 60;

  #last = 0;

  #introT0 = 0;

  #spawnAcc = 0;

  #nextSurge = 0;

  #sunAt = -1e9;

  /**
   * @param {object} args engine inputs
   * @param {HTMLCanvasElement} args.canvas the render target
   * @param {object} args.scene validated scene settings (mutated live by the UI)
   * @param {object} args.sim live simulation settings
   * @param {object} args.data HQ, ACTIVITY_TYPES, CITIES
   * @param {object} args.world baked world textures (see world.js)
   */
  constructor({ canvas, scene, sim, data, world }) {
    this.canvas = canvas;
    this.scene = scene;
    this.sim = sim;
    this.data = data;
    this.world = world;

    // live per-activity state (colour / enabled / count), keyed by id
    this.state = { types: {} };
    data.ACTIVITY_TYPES.forEach((t) => {
      this.state.types[t.id] = Object.assign({ count: 0 }, t);
    });

    this.look = new LookState(scene.look);
    this.U = createUniforms();
    this.modules = []; // { name, update?(e), resize?(e) }, updated in order each frame
    this.now = 0;
    this.dt = 0;
    this.time = 0; // seconds since start
    this.frameCount = 0;
    this.intro = 1;
    this.quality = 1;
    this.surge = null;
    this.hqVec = lnglatToVec3(data.HQ.lnglat);
    this.W = 0;
    this.H = 0;
  }

  // ---- lifecycle -------------------------------------------------------

  /**
   * Create the renderer and every visual module. Call once, before `start()`.
   *
   * @returns {Promise<void>} resolves when the GPU is ready
   */
  async init() {
    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });

    await renderer.init();

    this.renderer = renderer;
    this.isWebGPU = !!renderer.backend?.isWebGPUBackend;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    this.stage = new THREE.Scene();
    this.rig = new OrbitRig({
      camera: this.camera,
      element: this.canvas,
      sim: this.sim,
      scene: this.scene,
    });

    const { U, look, world } = this;

    this.baked = bakePlanet(renderer, world); // one-time GPU bakes of the static fields

    const sky = createSky({ U, look, baked: this.baked });
    const earth = createEarth({ world, baked: this.baked, U, look });

    this.stage.backgroundNode = sky.node;
    this.sky = sky;
    this.earth = earth;
    this.stage.add(earth.group);

    this.beams = this.use(createBeams({ engine: this }));
    this.stage.add(this.beams.group);

    this.cosmos = this.use(createCosmos({ engine: this }));
    this.stage.add(this.cosmos.group);

    this.sparks = this.use(createSparks({ engine: this }));
    this.stage.add(this.sparks.group);
    this.sparks.init();

    this.on('impact', (hit) => this.#celebrate(hit));

    this.post = createPost({ engine: this });

    this.applyScene();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Compile every pipeline up front so the cinematic arrival never plays behind a stall
    // (the first compile of the globe shader can take seconds on a cold shader cache).
    await renderer.compileAsync(this.stage, this.camera);

    this.post.render();
  }

  /**
   * Register a visual module and let it attach to the scene.
   *
   * @param {{ name: string, update?: Function, resize?: Function }} mod the module
   * @returns {object} the same module
   */
  use(mod) {
    this.modules.push(mod);

    return mod;
  }

  /** Begin the render loop. */
  start() {
    this.#introT0 = performance.now();
    this.#nextSurge = performance.now() + SURGE_FIRST_MS;
    this.#last = performance.now();

    this.renderer.setAnimationLoop((t) => this.#frame(t));
  }

  // ---- events ----------------------------------------------------------

  /**
   * Subscribe to an engine event.
   *
   * @param {string} evt event name ('beam' | 'impact' | 'surge')
   * @param {Function} fn handler
   */
  on(evt, fn) {
    (this.#handlers[evt] || (this.#handlers[evt] = [])).push(fn);
  }

  /**
   * Fire an engine event.
   *
   * @param {string} evt event name
   * @param {*} payload event payload
   */
  emit(evt, payload) {
    const h = this.#handlers[evt];

    if (h) for (const fn of h) fn(payload);
  }

  /**
   * Register a per-activity counter callback (drives the live feed panel).
   *
   * @param {Function} fn called with the activity id each time one lands
   */
  onCount(fn) {
    this.#hooks.push(fn);
  }

  /**
   * Increment an activity's counter and notify listeners.
   *
   * @param {string} id activity type id
   */
  bump(id) {
    this.state.types[id].count++;

    for (const fn of this.#hooks) fn(id);
  }

  // Every landing throws a few sparks; the fireworks-trigger activity sets off a 3-stage barrage.
  #celebrate({ type, color }) {
    const big = this.sim.fireworks && type.id === this.sim.fwTrigger;

    this.sparks.burst(this.hqVec, color, big ? 110 : 26, big ? 0.7 : 0.45);

    if (!big) return;

    setTimeout(() => this.sparks.burst(this.hqVec, '#ffffff', 80, 0.6), 210);

    setTimeout(() => this.sparks.burst(this.hqVec, color, 70, 0.5), 410);
  }

  // ---- settings --------------------------------------------------------

  /** Push the live scene settings into the shared uniforms and look state. */
  applyScene() {
    const s = this.scene,
      U = this.U;

    this.look.set(s.look);
    U.atmos.value = s.atmos;
    U.darkness.value = s.dayNight ? s.darkness : 0;
    U.cityLights.value = s.cityLights ? 1 : 0;
    U.cityBright.value = s.cityBright;
    U.sunGlint.value = s.sunGlint ? 1 : 0;
    U.sunGlare.value = s.sunGlare ? 1 : 0;
    U.grid.value = s.grid ? 1 : 0;
    U.clouds.value = s.clouds;
    U.nebula.value = s.nebula ? 1 : 0;
    U.twinkle.value = s.starTwinkle ? 1 : 0;
  }

  /**
   * Switch the active look; every shader cross-fades there over about a second.
   *
   * @param {string} id the look id (see looks.js)
   * @returns {Promise<void>} resolves once the look is ready to show
   */
  async setLook(id) {
    this.scene.look = id;

    this.applyScene();
  }

  /** Replay the cinematic arrival. */
  replayIntro() {
    this.#introT0 = performance.now();
  }

  /**
   * Eased progress through the sub-window [a, b] of the intro.
   *
   * @param {number} a window start (0..1 of the intro)
   * @param {number} b window end
   * @returns {number} smoothstepped 0..1; 1 once the intro is over
   */
  introPhase(a, b) {
    if (this.intro >= 1) return 1;

    const p = clamp((this.intro - a) / (b - a), 0, 1);

    return p * p * (3 - 2 * p);
  }

  // ---- viewport --------------------------------------------------------

  /** Resize the drawing buffer to the canvas and refit the camera. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();

    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * this.quality);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    this.rig.setAspect(this.camera.aspect);

    for (const m of this.modules) m.resize && m.resize(this);
  }

  // ---- main loop -------------------------------------------------------

  #frame(now) {
    const raw = now - this.#last;
    const dt = Math.min(0.05, Math.max(0, raw / 1000));

    this.#last = now;
    this.now = now;
    this.dt = dt;
    this.time += dt;
    this.frameCount++;

    this.#adaptQuality(raw);

    // cinematic arrival
    this.intro = this.scene.intro === false ? 1 : Math.min(1, (now - this.#introT0) / INTRO_MS);

    const U = this.U;

    U.time.value = this.time;
    U.cloudRot.value = this.time * 0.004;
    this.earth.clouds.rotation.y = U.cloudRot.value;
    U.intro.stars.value = this.introPhase(0.0, 0.35);
    U.intro.sphere.value = this.introPhase(0.15, 0.5);
    U.intro.atmo.value = this.introPhase(0.3, 0.65);
    U.intro.land.value = this.introPhase(0.45, 0.8);
    U.intro.lights.value = this.introPhase(0.6, 0.95);

    this.rig.update(dt, this.introPhase(0, 0.8));
    this.look.update(dt);
    this.#updateSun(now);
    this.#scheduleSurge(now);
    this.#spawn(dt);

    for (const m of this.modules) m.update && m.update(this);

    if (this.post) this.post.render();
    else this.renderer.render(this.stage, this.camera);

    if (this.fps) this.fps.tick(now);
  }

  // Real subsolar point from the clock (or a headlight when day/night is off).
  #updateSun(now) {
    if (!this.scene.dayNight) {
      this.U.sun.value.copy(this.camera.position).normalize();
      this.U.sun.value.x += 0.35;
      this.U.sun.value.y += 0.25;
      this.U.sun.value.normalize();

      return;
    }
    if (now - this.#sunAt < 1000) return;

    this.#sunAt = now;

    const dt = new Date();
    const utc = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
    const lon = -15 * (utc - 12);
    const doy = Math.floor((dt - Date.UTC(dt.getUTCFullYear(), 0, 0)) / 86400000);
    const decl = -23.44 * Math.cos((360 / 365) * (doy + 10) * DEG);

    lnglatToVec3([lon, decl], this.U.sun.value);
  }

  // Occasionally one city erupts (more beams from it, plus a ticker callout).
  #scheduleSurge(now) {
    if (this.surge && now > this.surge.until) this.surge = null;
    if (this.surge || this.sim.paused || this.intro < 1) return;
    if (this.scene.surges === false || now < this.#nextSurge) return;

    const cities = this.data.CITIES;

    for (let k = 0; k < 10; k++) {
      const c = cities[(Math.random() * cities.length) | 0];

      if (this.rig.visible(lnglatToVec3(c.lnglat))) {
        this.surge = { city: c, t0: now, until: now + SURGE_LEN_MS };
        this.emit('surge', { city: c });
        break;
      }
    }

    this.#nextSurge =
      now + SURGE_EVERY_MS[0] + Math.random() * (SURGE_EVERY_MS[1] - SURGE_EVERY_MS[0]);
  }

  // Beam cadence: `sim.rate` activities per second (×2.6 during a surge).
  #spawn(dt) {
    const sim = this.sim;

    if (sim.paused || this.intro < INTRO_BEAMS_AT || !this.beams) {
      this.#spawnAcc = 0;

      return;
    }

    this.#spawnAcc += dt * sim.rate * (this.surge ? 2.6 : 1);

    let guard = 0;

    while (this.#spawnAcc >= 1 && guard < 12) {
      const pick = this.#pickBeam();

      if (pick) this.beams.spawn(pick);
      this.#spawnAcc -= 1;
      guard++;
    }
  }

  // Weighted activity type + a source city on the visible hemisphere.
  #pickBeam() {
    if (!this.rig.visible(this.hqVec)) return null; // can't land if HQ faces away

    const enabled = this.data.ACTIVITY_TYPES.filter((t) => this.state.types[t.id].enabled);

    if (!enabled.length) return null;

    const type = weightedPick(enabled, (t) => this.state.types[t.id].weight || 1);
    const cities = this.data.CITIES;
    let city = null;

    if (
      this.surge &&
      this.surge.until > this.now &&
      Math.random() < 0.7 &&
      this.rig.visible(lnglatToVec3(this.surge.city.lnglat))
    ) {
      city = this.surge.city;
    }
    for (let k = 0; !city && k < 8; k++) {
      const c = cities[(Math.random() * cities.length) | 0];

      if (this.rig.visible(lnglatToVec3(c.lnglat))) city = c;
    }

    return city ? { type, city } : null;
  }

  // EMA of raw frame time → nudge resolution down/up with hysteresis + cooldown.
  #adaptQuality(rawMs) {
    if (rawMs <= 0 || rawMs > 250) return; // tab was hidden / first frame

    this.#ema += (Math.min(rawMs, 80) - this.#ema) * 0.05;
    if (--this.#cooldown > 0) return;

    if (this.#ema > EMA_SLOW_MS && this.quality > QUALITY_MIN) {
      this.quality = Math.max(QUALITY_MIN, this.quality - 0.15);
      this.#cooldown = COOLDOWN_FRAMES;
      this.resize();
    } else if (this.#ema < EMA_FAST_MS && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.15);
      this.#cooldown = COOLDOWN_FRAMES * 2; // step up more cautiously
      this.resize();
    }
  }
}
