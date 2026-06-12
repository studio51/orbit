/* games.directory globe — SVG render layers
 *
 * Every visual element is a self-contained layer object:
 *   { name, z, rebuildOn?, build(e), resize?(e), simulate?(e), draw(e) }
 * Layers draw in ascending `z`. Ported verbatim from the original SVG
 * globe.js: same path-string building, same math, same attributes/classes.
 *
 * Unlike the Canvas2D build, SVG nodes persist between frames. build(e)
 * creates/looks-up the persistent nodes (reusing the scaffold ids where the
 * original did); draw(e) only mutates their attributes. Visibility is driven
 * by the engine's applyScene() toggling display/opacity — draw() always runs.
 *
 * Depends on the global `d3` (graticule/terminator geo-path strings).
 */
import { easeInOutCubic, tint } from '../shared/util.js';
import { DENSITY_STEP } from '../shared/config.js';
import {
  ORBIT_DEFS,
  computeOrbit,
  arcControl,
  quadSplit,
  quadPoint,
  buildLandDots,
  buildSpikes,
  pickNodes,
  auroraSpecs,
  auroraSegments,
} from '../shared/geometry.js';
import {
  BEAM,
  pickBeam,
  beamEnvelope,
  spawnMeteorParams,
  stepMeteor,
  meteorOpacity,
  fireworkBurst,
  fireworkBarrage,
  stepFirework,
  fireworkAlpha,
} from '../shared/sim.js';
import { el } from './engine.js';

// Build an SVG path string from a list of flat [x,y,x,y,…] segments.
function pathFromSegments(segments) {
  let d = '';
  for (const s of segments) {
    d += 'M' + s[0].toFixed(1) + ' ' + s[1].toFixed(1);
    for (let i = 2; i < s.length; i += 2) d += 'L' + s[i].toFixed(1) + ' ' + s[i + 1].toFixed(1);
  }
  return d;
}

const $ = (id) => document.getElementById(id);

// ======================================================================
// Shooting stars / meteors — streak through deep space (behind globe)
// ======================================================================
export function meteorsLayer() {
  let layerEl,
    meteors = [],
    acc = 0,
    seq = 0;
  return {
    name: 'meteors',
    z: 0,
    build(e) {
      layerEl = $('shooting');
      meteors = [];
      acc = 0;
    },
    simulate(e) {
      const dt = e.dt,
        scene = e.scene;
      if (scene.shootingStars) {
        acc += dt * (0.12 + scene.meteorRate * 1.5);
        let guard = 0;
        while (acc >= 1 && guard < 3) {
          spawn(e);
          acc -= 1;
          guard++;
        }
      } else {
        acc = 0;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        if (!stepMeteor(m, dt, e.H)) {
          m.g.remove();
          if (m.grad.parentNode) m.grad.remove();
          meteors.splice(i, 1);
          continue;
        }
      }
    },
    draw(e) {
      for (const m of meteors) {
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.x - (m.vx / sp) * m.len,
          ty = m.y - (m.vy / sp) * m.len;
        m.trail.setAttribute('x1', tx.toFixed(1));
        m.trail.setAttribute('y1', ty.toFixed(1));
        m.trail.setAttribute('x2', m.x.toFixed(1));
        m.trail.setAttribute('y2', m.y.toFixed(1));
        m.grad.setAttribute('x1', tx.toFixed(1));
        m.grad.setAttribute('y1', ty.toFixed(1));
        m.grad.setAttribute('x2', m.x.toFixed(1));
        m.grad.setAttribute('y2', m.y.toFixed(1));
        m.head.setAttribute('cx', m.x.toFixed(1));
        m.head.setAttribute('cy', m.y.toFixed(1));
        m.g.style.opacity = meteorOpacity(m).toFixed(2);
      }
    },
  };

  function spawn(e) {
    const id = 'met-g-' + seq++;
    const grad = el('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '0' }));
    grad.appendChild(el('stop', { offset: '55%', 'stop-color': '#cfe3ff', 'stop-opacity': '.55' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': '1' }));
    e.defs.appendChild(grad);
    const g = el('g', {});
    const trail = el('line', {
      class: 'met-trail',
      stroke: 'url(#' + id + ')',
      'stroke-width': (1.3 + Math.random() * 1.1).toFixed(1),
    });
    const head = el('circle', { class: 'met-head', r: (1.4 + Math.random() * 1.2).toFixed(1) });
    head.style.filter = 'drop-shadow(0 0 6px #fff) drop-shadow(0 0 12px #9fc6ff)';
    g.appendChild(trail);
    g.appendChild(head);
    layerEl.appendChild(g);
    meteors.push(Object.assign(spawnMeteorParams(e.W, e.H), { g, trail, head, grad }));
  }
}

// ======================================================================
// Atmosphere — sphere rim glow + bottom bloom (breathing pulse)
// ======================================================================
export function atmosphereLayer() {
  let sphereGlow, bottomGlow;
  return {
    name: 'atmosphere',
    z: 10,
    build(e) {
      sphereGlow = $('sphere-glow');
      bottomGlow = $('bottom-glow');
    },
    resize(e) {
      const { CX, CY, R } = e;
      sphereGlow.setAttribute('cx', CX);
      sphereGlow.setAttribute('cy', CY);
      sphereGlow.setAttribute('r', R * 1.06);
      bottomGlow.setAttribute('cx', CX);
      bottomGlow.setAttribute('cy', CY + R * 0.86);
      bottomGlow.setAttribute('rx', R * 0.62);
      bottomGlow.setAttribute('ry', R * 0.26);
    },
    draw(e) {
      const { now, scene } = e;
      // breathing atmosphere bloom; when pulse is off the static applyScene
      // opacity stands.
      if (scene.atmosPulse) {
        const pulse = 0.82 + 0.18 * Math.sin(now * 0.0011);
        sphereGlow.style.opacity = (0.7 * scene.atmos * pulse).toFixed(3);
        bottomGlow.style.opacity = (
          scene.atmos *
          (0.88 + 0.12 * Math.sin(now * 0.0011 + 1.2))
        ).toFixed(3);
      }
    },
  };
}

// ======================================================================
// Sphere — disc + soft top-left highlight (+ clip circle for night)
// ======================================================================
export function sphereLayer() {
  let sphereEl, highlightEl, clipCircle;
  return {
    name: 'sphere',
    z: 30,
    build(e) {
      sphereEl = $('sphere');
      highlightEl = $('sphere-highlight');
      clipCircle = $('clip-circle');
    },
    resize(e) {
      const { CX, CY, R } = e;
      sphereEl.setAttribute('cx', CX);
      sphereEl.setAttribute('cy', CY);
      sphereEl.setAttribute('r', R);
      highlightEl.setAttribute('cx', CX - R * 0.32);
      highlightEl.setAttribute('cy', CY - R * 0.34);
      highlightEl.setAttribute('r', R * 1.0);
      clipCircle.setAttribute('cx', CX);
      clipCircle.setAttribute('cy', CY);
      clipCircle.setAttribute('r', R + 2);
    },
    draw(e) {
      /* static — positioned on resize */
    },
  };
}

// ======================================================================
// Orbital rings — tilted/spun rings split front/back around the globe
// ======================================================================
// Shared orbit geometry — both front and back layers consume the same nodes,
// which are built once and rendered once per frame (back layer renders).
function makeOrbitState() {
  let orbits = [];
  function build(e) {
    orbits = [];
    const orbitsFront = $('orbits-front'),
      orbitsBack = $('orbits-back');
    // clear any prior nodes (rebuild safety)
    while (orbitsFront.firstChild) orbitsFront.removeChild(orbitsFront.firstChild);
    while (orbitsBack.firstChild) orbitsBack.removeChild(orbitsBack.firstChild);
    ORBIT_DEFS.forEach((cfg) => {
      const front = el('path', {});
      const back = el('path', {});
      orbitsFront.appendChild(front);
      orbitsBack.appendChild(back);
      let sat = null;
      if (cfg.sat) {
        sat = el('circle', { class: 'orbit-sat', r: 2 });
        sat.style.filter = 'drop-shadow(0 0 5px #bcd9ff)';
        orbitsFront.appendChild(sat);
      }
      orbits.push({ cfg, front, back, sat });
    });
  }
  function render(e) {
    const { CX, CY, R, now } = e;
    for (let o = 0; o < orbits.length; o++) {
      const ob = orbits[o];
      const g = computeOrbit(ob.cfg, o, R, CX, CY, now);
      ob.front.setAttribute('d', pathFromSegments(g.front));
      ob.back.setAttribute('d', pathFromSegments(g.back));
      if (ob.sat && g.sat) {
        if (g.sat.front) {
          ob.sat.setAttribute('cx', g.sat.x.toFixed(1));
          ob.sat.setAttribute('cy', g.sat.y.toFixed(1));
          ob.sat.style.opacity = 1;
        } else ob.sat.style.opacity = 0.15;
      }
    }
  }
  return { build, render };
}
const orbitState = makeOrbitState();
export function orbitsBackLayer() {
  return {
    name: 'orbitsBack',
    z: 20,
    build(e) {
      orbitState.build(e);
    },
    draw(e) {
      orbitState.render(e);
    }, // computes both front + back path strings
  };
}
export function orbitsFrontLayer() {
  return {
    name: 'orbitsFront',
    z: 80,
    draw(e) {
      /* path strings already set by orbitsBack's render */
    },
  };
}

// ======================================================================
// Corona — faint radial spikes shimmering off the limb (half-rate updates)
// ======================================================================
export function spikesLayer() {
  let spikesEl,
    sin,
    cos,
    lng,
    lenF,
    phase,
    n = 0;
  return {
    name: 'spikes',
    z: 35,
    build(e) {
      spikesEl = $('spikes');
      const s = buildSpikes();
      sin = s.sin;
      cos = s.cos;
      lng = s.lng;
      lenF = s.lenF;
      phase = s.phase;
      n = s.n;
    },
    draw(e) {
      if (e.frameCount % 2 !== 0) return; // faint corona — half-rate is invisible
      const { CX, CY, R, now, proj } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      let d = '';
      const tt = now * 0.0016;
      for (let i = 0; i < n; i++) {
        const dlon = lng[i] - lon0,
          cd = Math.cos(dlon);
        const cosc = sinLat0 * sin[i] + cosLat0 * cos[i] * cd;
        if (cosc <= 0) continue;
        const sd = Math.sin(dlon);
        const px = CX + R * (cos[i] * sd);
        const py = CY - R * (cosLat0 * sin[i] - sinLat0 * cos[i] * cd);
        const pulse = 0.7 + 0.3 * Math.sin(tt + phase[i]);
        const len = (0.02 + lenF[i] * 0.04) * pulse;
        const ex = CX + (px - CX) * (1 + len),
          ey = CY + (py - CY) * (1 + len);
        d += 'M' + (px | 0) + ' ' + (py | 0) + 'L' + (ex | 0) + ' ' + (ey | 0);
      }
      spikesEl.setAttribute('d', d);
    },
  };
}

// ======================================================================
// Graticule — lat/long grid via d3 geoPath string (half-rate updates)
// ======================================================================
export function graticuleLayer() {
  let graticuleEl;
  return {
    name: 'graticule',
    z: 40,
    build(e) {
      graticuleEl = $('graticule');
    },
    draw(e) {
      if (e.frameCount % 2 !== 0) return; // graticule barely moves frame-to-frame
      graticuleEl.setAttribute('d', e.pathGen(e.proj.graticule()) || '');
    },
  };
}

// ======================================================================
// Land — dotted relief; also lights night-side city dots (cityLights)
// ======================================================================
export function landLayer() {
  let landS, landM, landL, city0, city1, city2;
  let sin,
    cos,
    lng,
    isCity,
    grp,
    tier,
    n = 0;
  return {
    name: 'land',
    z: 50,
    rebuildOn: ['density'],
    build(e) {
      landS = $('land-s');
      landM = $('land-m');
      landL = $('land-l');
      city0 = $('city-0');
      city1 = $('city-1');
      city2 = $('city-2');
      const feature = e.data.landFeature;
      if (!feature) return;
      const d = buildLandDots(feature, DENSITY_STEP[e.scene.density] || 3.0);
      sin = d.sin;
      cos = d.cos;
      lng = d.lng;
      isCity = d.isCity;
      grp = d.grp;
      tier = d.tier;
      n = d.n;
      e.landDots = d.pts; // real [lng,lat] pairs, used to seed star nodes
    },
    draw(e) {
      const { CX, CY, R, scene, proj, now } = e;
      const { lon0, sinLat0, cosLat0 } = proj;
      const sun = proj.sun,
        dayN = scene.dayNight,
        cityOn = scene.cityLights;
      let ds = '',
        dm = '',
        dl = '',
        c0 = '',
        c1 = '',
        c2 = '';
      for (let i = 0; i < n; i++) {
        const dlon = lng[i] - lon0,
          cd = Math.cos(dlon);
        const cosc = sinLat0 * sin[i] + cosLat0 * cos[i] * cd;
        if (cosc <= 0) continue; // back hemisphere
        const sd = Math.sin(dlon);
        const sx = (CX + R * (cos[i] * sd)) | 0;
        const sy = (CY - R * (cosLat0 * sin[i] - sinLat0 * cos[i] * cd)) | 0;
        const seg = 'M' + sx + ' ' + sy + 'l.1 0';
        const t = tier[i];
        if (t === 0) ds += seg;
        else if (t === 1) dm += seg;
        else dl += seg;
        // city lights: only city points currently on the night side
        if (cityOn && dayN && isCity[i]) {
          const sdl = lng[i] - sun.lon;
          const cosSun = sun.sinLat * sin[i] + sun.cosLat * cos[i] * Math.cos(sdl);
          if (cosSun < 0.04) {
            const g = grp[i];
            if (g === 0) c0 += seg;
            else if (g === 1) c1 += seg;
            else c2 += seg;
          }
        }
      }
      landS.setAttribute('d', ds);
      landM.setAttribute('d', dm);
      landL.setAttribute('d', dl);
      city0.setAttribute('d', c0);
      city1.setAttribute('d', c1);
      city2.setAttribute('d', c2);
      // gentle staggered twinkle, scaled by configured brightness
      const t = now * 0.0017,
        cb = scene.cityBright;
      city0.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t)) * cb).toFixed(2);
      city1.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t + 2.1)) * cb).toFixed(2);
      city2.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t + 4.2)) * cb).toFixed(2);
    },
  };
}

// ======================================================================
// Night — day/night terminator (twilight band + deep-night core)
// ======================================================================
export function nightLayer() {
  let nightEl, nightCoreEl;
  return {
    name: 'night',
    z: 55,
    build(e) {
      nightEl = $('night');
      nightCoreEl = $('night-core');
    },
    draw(e) {
      if (!e.scene.dayNight) {
        nightEl.setAttribute('d', '');
        nightCoreEl.setAttribute('d', '');
        return;
      }
      nightEl.setAttribute('d', e.pathGen(e.proj.nightShape()) || '');
      nightCoreEl.setAttribute('d', e.pathGen(e.proj.coreShape()) || '');
    },
  };
}

// ======================================================================
// City lights — handled inside landLayer (kept as a no-op draw for parity)
// ======================================================================
export function cityLightsLayer() {
  return {
    name: 'cityLights',
    z: 57,
    draw(e) {
      /* city-light paths are produced by landLayer.draw */
    },
  };
}

// ======================================================================
// Aurora — wobbling polar bands, front-only, soft glow
// ======================================================================
export function auroraLayer() {
  let aurNG, aurNV, aurSG, aurSV;
  return {
    name: 'aurora',
    z: 60,
    build(e) {
      aurNG = $('aur-n-g');
      aurNV = $('aur-n-v');
      aurSG = $('aur-s-g');
      aurSV = $('aur-s-v');
    },
    draw(e) {
      const { CX, CY, R, now, scene, proj } = e;
      if (!scene.aurora) {
        aurNG.setAttribute('d', '');
        aurNV.setAttribute('d', '');
        aurSG.setAttribute('d', '');
        aurSV.setAttribute('d', '');
        return;
      }
      const nodes = [aurNG, aurNV, aurSG, aurSV];
      const specs = auroraSpecs(scene);
      for (let i = 0; i < nodes.length; i++) {
        const s = specs[i];
        nodes[i].setAttribute(
          'd',
          pathFromSegments(
            auroraSegments(proj, CX, CY, R, s.lat, s.amp, s.phase, now, scene.auroraSpeed)
          )
        );
      }
      const t = now * 0.0011,
        k = scene.auroraIntensity;
      aurNG.style.opacity = Math.min(1, (0.34 + 0.22 * Math.sin(t)) * k).toFixed(2);
      aurNV.style.opacity = Math.min(1, (0.3 + 0.22 * Math.sin(t + 1.7)) * k).toFixed(2);
      aurSG.style.opacity = Math.min(1, (0.34 + 0.22 * Math.sin(t + 3.1)) * k).toFixed(2);
      aurSV.style.opacity = Math.min(1, (0.3 + 0.22 * Math.sin(t + 4.6)) * k).toFixed(2);
    },
  };
}

// ======================================================================
// Star nodes — a handful of bright twinkling points anchored to land
// ======================================================================
export function nodesLayer() {
  let layerEl,
    nodes = [];
  return {
    name: 'nodes',
    z: 65,
    build(e) {
      layerEl = $('nodes');
      while (layerEl.firstChild) layerEl.removeChild(layerEl.firstChild);
      nodes = [];
      for (const desc of pickNodes(e.landDots)) {
        const el2 = el('circle', { class: 'node', r: 1 });
        el2.style.filter = 'drop-shadow(0 0 4px #cfe6ff)';
        layerEl.appendChild(el2);
        nodes.push(Object.assign({ el: el2 }, desc));
      }
    },
    draw(e) {
      const { proj, now } = e;
      const tt = now * 0.001;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const p = proj.forward(node.ll);
        if (!p || !proj.visible(node.ll)) {
          node.el.style.opacity = 0;
          continue;
        }
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(tt * node.sp + node.phase));
        node.el.setAttribute('cx', p[0].toFixed(1));
        node.el.setAttribute('cy', p[1].toFixed(1));
        node.el.setAttribute('r', (node.size * (0.7 + 0.3 * tw)).toFixed(2));
        node.el.style.opacity = tw.toFixed(2);
      }
    },
  };
}

// ======================================================================
// Beams — great-arc activity beams converging on HQ (the core feature)
// ======================================================================
export function beamsLayer() {
  let layerEl,
    beams = [];
  return {
    name: 'beams',
    z: 90,
    build(e) {
      layerEl = $('beams');
    },
    spawn(e) {
      const pick = pickBeam(e);
      if (!pick) return;
      const type = pick.type,
        city = pick.city;

      const ts = e.state.types[type.id];
      ts.count++;
      e.bump(type.id);
      e.emit('beam', { type, city, color: ts.color });

      const g = el('g', { class: 'beam' });
      if (type.id === e.sim.fwTrigger) g.setAttribute('class', 'beam beam-special');
      const glow = el('path', { class: 'beam-glow' });
      const core = el('path', { class: 'beam-core' });
      const hot = el('path', { class: 'beam-hot' });
      const spark = el('path', { class: 'beam-spark' });
      const head = el('circle', { class: 'beam-head', r: 4.2 });
      g.appendChild(glow);
      g.appendChild(core);
      g.appendChild(hot);
      g.appendChild(spark);
      g.appendChild(head);
      layerEl.appendChild(g);

      const col = ts.color;
      glow.setAttribute('stroke', col);
      core.setAttribute('stroke', col);
      spark.setAttribute('stroke', tint(col));
      head.setAttribute('fill', '#fff');
      head.style.filter = 'drop-shadow(0 0 7px ' + col + ')';

      beams.push({
        type,
        src: city.lnglat,
        color: col,
        g,
        glow,
        core,
        hot,
        spark,
        head,
        t0: e.now,
        impacted: false,
      });
    },
    draw(e) {
      const { CX, CY, R, now, scene, proj } = e;
      const hqp = e.hq,
        hqVisible = e.hqVisible;
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        const age = now - b.t0;
        if (age > BEAM.LIFE_MS) {
          if (b.g.parentNode) b.g.parentNode.removeChild(b.g);
          beams.splice(i, 1);
          continue;
        }

        const sp = proj.forward(b.src);
        const srcVis = !!sp && proj.visible(b.src);
        if (!sp || !hqp || !srcVis || !hqVisible) {
          b.g.style.opacity = 0; // an endpoint rotated out of view — hide this frame
          continue;
        }

        const C = arcControl(sp, hqp, CX, CY, R);
        const t = easeInOutCubic(Math.min(1, age / BEAM.DRAW_MS));

        let d, hx, hy;
        if (t >= 1) {
          d = 'M' + sp[0] + ' ' + sp[1] + 'Q' + C[0] + ' ' + C[1] + ' ' + hqp[0] + ' ' + hqp[1];
          hx = hqp[0];
          hy = hqp[1];
        } else {
          const s = quadSplit(sp, C, hqp, t);
          hx = s.hx;
          hy = s.hy;
          d = 'M' + sp[0] + ' ' + sp[1] + 'Q' + s.ax + ' ' + s.ay + ' ' + hx + ' ' + hy;
        }
        b.glow.setAttribute('d', d);
        b.core.setAttribute('d', d);
        b.hot.setAttribute('d', d);

        // comet trail: a bright leading sub-arc just behind the head
        if (scene.beamTrails && t < 1) {
          const u0 = Math.max(0, t - 0.17);
          let sd = '';
          for (let s = 0; s <= 6; s++) {
            const [qx, qy] = quadPoint(sp, C, hqp, u0 + (t - u0) * (s / 6));
            sd += (s === 0 ? 'M' : 'L') + qx.toFixed(1) + ' ' + qy.toFixed(1);
          }
          b.spark.setAttribute('d', sd);
          b.spark.style.opacity = 1;
        } else {
          b.spark.setAttribute('d', '');
        }

        // head dot rides the leading edge while drawing
        if (t < 1) {
          b.head.setAttribute('cx', hx.toFixed(1));
          b.head.setAttribute('cy', hy.toFixed(1));
          b.head.setAttribute('r', (4.2 + Math.sin(age / 90) * 0.7).toFixed(2));
          b.head.style.opacity = 1;
        } else {
          b.head.style.opacity = 0;
          if (!b.impacted) {
            b.impacted = true;
            e.emit('impact', { p: hqp.slice(), color: b.color });
            if (e.sim.fireworks && b.type.id === e.sim.fwTrigger)
              e.emit('fireworks', { p: hqp.slice(), color: b.color });
          }
        }

        // opacity envelope
        b.g.style.opacity = beamEnvelope(age);
      }
    },
  };
}

// ======================================================================
// Impacts — expanding ring + burst where a beam lands
// ======================================================================
export function impactsLayer() {
  let layerEl,
    items = [];
  return {
    name: 'impacts',
    z: 92,
    build(e) {
      layerEl = $('impacts');
      items = [];
      e.on('impact', (d) => {
        const c = el('circle', { class: 'impact', cx: d.p[0], cy: d.p[1], r: 5, stroke: d.color });
        const burst = el('circle', {
          class: 'impact-burst',
          cx: d.p[0],
          cy: d.p[1],
          r: 3,
          fill: d.color,
        });
        layerEl.appendChild(c);
        layerEl.appendChild(burst);
        items.push({ c, burst, t0: e.now });
      });
    },
    draw(e) {
      const { R, now } = e;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const a = (now - it.t0) / 620;
        if (a >= 1) {
          it.c.remove();
          it.burst.remove();
          items.splice(i, 1);
          continue;
        }
        const ee = 1 - Math.pow(1 - a, 2);
        it.c.setAttribute('r', 5 + ee * R * 0.18);
        it.c.style.opacity = 1 - a;
        it.burst.setAttribute('r', 3 + ee * 6);
        it.burst.style.opacity = (1 - a) * 0.9;
      }
    },
  };
}

// ======================================================================
// Fireworks — celebratory barrage on the trigger activity
// ======================================================================
export function fireworksLayer() {
  let layerEl,
    parts = [];
  function burst(e, cx, cy, color, scale) {
    const spec = fireworkBurst(e.R, scale, color);
    const flash = el('circle', { class: 'fw-flash', cx: cx, cy: cy, r: 3, fill: '#fff' });
    layerEl.appendChild(flash);
    parts.push(Object.assign({ el: flash, flash: true, x: cx, y: cy }, spec.flash));
    for (const s of spec.sparks) {
      const c = el('circle', { class: 'fw-spark', r: s.r, fill: s.color });
      c.style.filter = 'drop-shadow(0 0 5px ' + s.color + ')';
      layerEl.appendChild(c);
      parts.push(Object.assign({ el: c, x: cx, y: cy }, s));
    }
  }
  return {
    name: 'fireworks',
    z: 94,
    build(e) {
      layerEl = $('fireworks');
      parts = [];
      e.on('fireworks', (d) => {
        const [x, y] = d.p;
        for (const b of fireworkBarrage(e.R, d.color)) {
          const fire = () => burst(e, x + b.dx, y + b.dy, b.color, b.scale);
          b.delay ? setTimeout(fire, b.delay) : fire();
        }
      });
    },
    draw(e) {
      if (!parts.length) return;
      const dt = e.dt;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.ttl) {
          p.el.remove();
          parts.splice(i, 1);
          continue;
        }
        stepFirework(p, dt, e.R);
        if (p.flash) p.el.setAttribute('r', (3 + (p.t / p.ttl) * p.grow).toFixed(1));
        else {
          p.el.setAttribute('cx', p.x.toFixed(1));
          p.el.setAttribute('cy', p.y.toFixed(1));
        }
        p.el.style.opacity = fireworkAlpha(p).toFixed(2);
      }
    },
  };
}

// ======================================================================
// HQ — pulsing marker + label
// ======================================================================
export function hqLayer() {
  let hqRing, hqRing2, hqDot, hqLabel;
  return {
    name: 'hq',
    z: 96,
    build(e) {
      const layerEl = $('hq');
      hqRing = el('circle', { class: 'hq-ring' });
      hqRing2 = el('circle', { class: 'hq-ring hq-ring-2' });
      hqDot = el('circle', { class: 'hq-dot', r: 4.5 });
      hqLabel = el('g', { class: 'hq-label' });
      const lt = el('text', { class: 'hq-label-text', x: 12, y: 4 });
      lt.textContent = e.data.HQ.name;
      const sub = el('text', { class: 'hq-label-sub', x: 12, y: 20 });
      sub.textContent = e.data.HQ.city;
      hqLabel.appendChild(lt);
      hqLabel.appendChild(sub);
      layerEl.appendChild(hqRing2);
      layerEl.appendChild(hqRing);
      layerEl.appendChild(hqDot);
      layerEl.appendChild(hqLabel);
    },
    draw(e) {
      const p = e.hq,
        vis = e.hqVisible;
      const op = vis ? 1 : 0;
      [hqRing, hqRing2, hqDot, hqLabel].forEach((nde) => {
        nde.style.opacity = op;
      });
      if (!vis || !p) return;
      hqRing.setAttribute('cx', p[0]);
      hqRing.setAttribute('cy', p[1]);
      hqRing2.setAttribute('cx', p[0]);
      hqRing2.setAttribute('cy', p[1]);
      hqDot.setAttribute('cx', p[0]);
      hqDot.setAttribute('cy', p[1]);
      hqLabel.setAttribute('transform', 'translate(' + p[0] + ',' + p[1] + ')');
    },
  };
}

// ----------------------------------------------------------------------
export function registerDefaultLayers(engine) {
  [
    meteorsLayer(),
    atmosphereLayer(),
    orbitsBackLayer(),
    sphereLayer(),
    spikesLayer(),
    graticuleLayer(),
    landLayer(),
    nightLayer(),
    cityLightsLayer(),
    auroraLayer(),
    nodesLayer(),
    orbitsFrontLayer(),
    beamsLayer(),
    impactsLayer(),
    fireworksLayer(),
    hqLayer(),
  ].forEach((l) => engine.register(l));
}
