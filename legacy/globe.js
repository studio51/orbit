/* Orbit — engine
 * Accurate rotating orthographic globe (D3 geo) with dotted land,
 * and great-circle "activity beams" that fire from real city
 * coordinates and converge on HQ. Rendered in SVG.
 *
 * Depends on: d3 (v7, global `d3`), topojson-client (global `topojson`),
 * and GD (data.js).
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---- tunable state (driven by the control panel) -----------------------
  var state = {
    paused: false,
    rotSpeed: 6, // degrees / second (auto-rotate)
    rate: 3.0, // activities per second
    fireworks: true, // celebratory burst on the trigger event
    fwTrigger: 'completed', // which activity sets off fireworks
    types: {}, // id -> type object (live colour/enabled/count)
  };
  GD.ACTIVITY_TYPES.forEach(function (t) {
    state.types[t.id] = Object.assign({ count: 0 }, t);
  });

  // ---- scene configuration (persisted; driven by the gear panel) ---------
  var SCENE_DEFAULTS = {
    // texture
    dotSize: 2.9,
    texture: 0.32,
    density: 'med',
    landBright: 1,
    grid: false,
    // atmosphere
    atmos: 1,
    // day & night
    dayNight: true,
    darkness: 0.55,
    cityLights: true,
    cityBright: 1,
    // aurora
    aurora: true,
    auroraIntensity: 1,
    auroraLat: 71,
    auroraSpeed: 1,
    auroraScheme: 'gv',
    // effects
    corona: true,
    coronaIntensity: 0.1,
    nodes: true,
    orbits: true,
    // cosmos
    shootingStars: true,
    meteorRate: 0.5,
    starTwinkle: true,
    starDrift: true,
    atmosPulse: true,
    beamTrails: true,
  };
  var scene = Object.assign({}, SCENE_DEFAULTS);
  try {
    var saved = JSON.parse(localStorage.getItem('orbit-scene') || '{}');
    Object.keys(saved).forEach(function (k) {
      if (k in scene) scene[k] = saved[k];
    });
  } catch (e) {}
  function saveScene() {
    try {
      localStorage.setItem('orbit-scene', JSON.stringify(scene));
    } catch (e) {}
  }
  var DENSITY_STEP = { sparse: 3.8, med: 3.0, dense: 2.4 };
  var AURORA_SCHEMES = {
    gv: ['#5cffb0', '#b58cff'],
    emerald: ['#3dffa0', '#7affd1'],
    rose: ['#ff7ab0', '#b58cff'],
  };

  // ---- geometry / projection ---------------------------------------------
  var svg = document.getElementById('globe-svg');
  var sphereEl = document.getElementById('sphere');
  var sphereGlow = document.getElementById('sphere-glow');
  var highlightEl = document.getElementById('sphere-highlight');
  var graticuleEl = document.getElementById('graticule');
  var dotsEl = document.getElementById('land-dots');
  var landS = document.getElementById('land-s');
  var landM = document.getElementById('land-m');
  var landL = document.getElementById('land-l');
  var nightEl = document.getElementById('night');
  var nightCoreEl = document.getElementById('night-core');
  var clipCircle = document.getElementById('clip-circle');
  var city0 = document.getElementById('city-0');
  var city1 = document.getElementById('city-1');
  var city2 = document.getElementById('city-2');
  var citylightsLayer = document.getElementById('citylights');
  var auroraLayer = document.getElementById('aurora');
  var aurNG = document.getElementById('aur-n-g');
  var aurNV = document.getElementById('aur-n-v');
  var aurSG = document.getElementById('aur-s-g');
  var aurSV = document.getElementById('aur-s-v');
  var tickerEl = document.getElementById('ticker');
  var spikesEl = document.getElementById('spikes');
  var nodesLayer = document.getElementById('nodes');
  var orbitsBack = document.getElementById('orbits-back');
  var orbitsFront = document.getElementById('orbits-front');
  var bottomGlow = document.getElementById('bottom-glow');
  var beamsLayer = document.getElementById('beams');
  var impactsLayer = document.getElementById('impacts');
  var fireworksLayer = document.getElementById('fireworks');
  var hqLayer = document.getElementById('hq');
  var shootingLayer = document.getElementById('shooting');
  var svgDefs = svg.querySelector('defs');
  var starsEls = document.querySelectorAll('.stars');

  var W = 0,
    H = 0,
    CX = 0,
    CY = 0,
    R = 0;
  var rotation = [-10, -25, 0]; // [lambda, phi, gamma]; start near Europe/Atlantic
  var projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  var pathGen = d3.geoPath(projection);
  var graticule = d3.geoGraticule().step([20, 20]);

  var landFeature = null; // GeoJSON land (for dot containment)
  var landDots = []; // [ [lng,lat], ... ] points that fall on land
  var beams = []; // active beams

  function layout() {
    var rect = svg.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    CX = W * 0.5;
    CY = H * 0.5;
    R = Math.min(W, H) * 0.36;
    projection.scale(R).translate([CX, CY]).rotate(rotation);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    sphereEl.setAttribute('cx', CX);
    sphereEl.setAttribute('cy', CY);
    sphereEl.setAttribute('r', R);
    sphereGlow.setAttribute('cx', CX);
    sphereGlow.setAttribute('cy', CY);
    sphereGlow.setAttribute('r', R * 1.06);
    highlightEl.setAttribute('cx', CX - R * 0.32);
    highlightEl.setAttribute('cy', CY - R * 0.34);
    highlightEl.setAttribute('r', R * 1.0);
    bottomGlow.setAttribute('cx', CX);
    bottomGlow.setAttribute('cy', CY + R * 0.86);
    bottomGlow.setAttribute('rx', R * 0.62);
    bottomGlow.setAttribute('ry', R * 0.26);
    clipCircle.setAttribute('cx', CX);
    clipCircle.setAttribute('cy', CY);
    clipCircle.setAttribute('r', R + 2);
  }

  // visibility of a [lng,lat] on the current orthographic hemisphere
  function visible(lnglat) {
    var c = [-rotation[0], -rotation[1]];
    return d3.geoDistance(lnglat, c) < Math.PI / 2 - 0.04;
  }

  // ---- fast orthographic projection --------------------------------------
  // d3's projection allocates and runs a full rotate->project pipeline per
  // point; for the thousands of land dots / spikes we project every frame
  // that is the dominant cost. We cache each point's sin/cos(lat) and
  // lng(rad) at build time and project with a couple of trig ops per frame.
  var DEG = Math.PI / 180;
  var P_lon0 = 0,
    P_sinLat0 = 0,
    P_cosLat0 = 1;
  function updateFastProj() {
    P_lon0 = -rotation[0] * DEG;
    var lat0 = -rotation[1] * DEG;
    P_sinLat0 = Math.sin(lat0);
    P_cosLat0 = Math.cos(lat0);
  }

  // ---- sun position / day-night terminator -------------------------------
  // Real subsolar point from the clock; as the globe spins, the terminator
  // sweeps across the disc and cities light up gold as they enter night.
  var sun_lon = 0,
    sun_sinLat = 0,
    sun_cosLat = 1;
  var sunCircle = d3.geoCircle().radius(90); // night hemisphere (twilight edge)
  var coreCircle = d3.geoCircle().radius(116); // deep-night core (excludes twilight band)
  var lastSun = -1e9;
  function updateSun(now) {
    if (now - lastSun < 1000) return; // sun barely moves; recompute ~1/s
    lastSun = now;
    var dt = new Date();
    var utc = dt.getUTCHours() + dt.getUTCMinutes() / 60 + dt.getUTCSeconds() / 3600;
    var lonDeg = -15 * (utc - 12); // subsolar longitude
    var start = Date.UTC(dt.getUTCFullYear(), 0, 0);
    var doy = Math.floor((dt - start) / 86400000);
    var declDeg = -23.44 * Math.cos((360 / 365) * (doy + 10) * DEG); // solar declination
    sun_lon = lonDeg * DEG;
    sun_sinLat = Math.sin(declDeg * DEG);
    sun_cosLat = Math.cos(declDeg * DEG);
    sunCircle.center([lonDeg + 180, -declDeg]); // antisolar point = night centre
    coreCircle.center([lonDeg + 180, -declDeg]);
  }
  function renderNight() {
    if (!scene.dayNight) {
      nightEl.setAttribute('d', '');
      nightCoreEl.setAttribute('d', '');
      return;
    }
    nightEl.setAttribute('d', pathGen(sunCircle()) || '');
    nightCoreEl.setAttribute('d', pathGen(coreCircle()) || '');
  }

  // ---- polar auroras ------------------------------------------------------
  // A wobbling band of points near each pole, projected front-only, drawn as
  // a soft glowing polyline. Breaks the line when it crosses to the back.
  function auroraBand(baseLat, amp, phase, now) {
    var d = '',
      start = true;
    var t = now * 0.0006 * scene.auroraSpeed;
    for (var lng = -180; lng <= 180; lng += 4) {
      var lngR = lng * DEG;
      var lat =
        baseLat +
        amp * Math.sin(lngR * 3 + t * 6 + phase) +
        amp * 0.5 * Math.sin(lngR * 7 - t * 4 + phase);
      var latR = lat * DEG;
      var sinL = Math.sin(latR),
        cosL = Math.cos(latR);
      var dlon = lngR - P_lon0,
        cd = Math.cos(dlon);
      var cosc = P_sinLat0 * sinL + P_cosLat0 * cosL * cd;
      if (cosc <= 0.02) {
        start = true;
        continue;
      } // back / limb -> break
      var sd = Math.sin(dlon);
      var sx = CX + R * (cosL * sd);
      var sy = CY - R * (P_cosLat0 * sinL - P_sinLat0 * cosL * cd);
      d += (start ? 'M' : 'L') + sx.toFixed(1) + ' ' + sy.toFixed(1);
      start = false;
    }
    return d;
  }
  function renderAurora(now) {
    if (!scene.aurora) {
      aurNG.setAttribute('d', '');
      aurNV.setAttribute('d', '');
      aurSG.setAttribute('d', '');
      aurSV.setAttribute('d', '');
      return;
    }
    var bl = scene.auroraLat;
    aurNG.setAttribute('d', auroraBand(bl, 4.5, 0, now));
    aurNV.setAttribute('d', auroraBand(bl + 2.5, 5.5, 1.6, now));
    aurSG.setAttribute('d', auroraBand(-bl, 4.5, 2.4, now));
    aurSV.setAttribute('d', auroraBand(-bl - 2.5, 5.5, 3.9, now));
    var t = now * 0.0011,
      k = scene.auroraIntensity;
    aurNG.style.opacity = Math.min(1, (0.34 + 0.22 * Math.sin(t)) * k).toFixed(2);
    aurNV.style.opacity = Math.min(1, (0.3 + 0.22 * Math.sin(t + 1.7)) * k).toFixed(2);
    aurSG.style.opacity = Math.min(1, (0.34 + 0.22 * Math.sin(t + 3.1)) * k).toFixed(2);
    aurSV.style.opacity = Math.min(1, (0.3 + 0.22 * Math.sin(t + 4.6)) * k).toFixed(2);
  }

  // ---- live ticker --------------------------------------------------------
  var VERBS = {
    trophy: 'earned a Trophy',
    platinum: 'unlocked a Platinum',
    newgame: 'started a new game',
    friend: 'made a new friend',
    levelup: 'leveled up',
    completed: 'completed a game',
  };
  var lastTick = -1e9;
  function pushTicker(type, cityName) {
    var now = performance.now();
    if (now - lastTick < 220) return; // throttle so high rates don't thrash the DOM
    lastTick = now;
    var col = state.types[type.id].color;
    var line = document.createElement('div');
    line.className = 'tk-line';
    line.innerHTML =
      '<span class="tk-dot" style="color:' +
      col +
      ';background:' +
      col +
      '"></span>' +
      '<span class="tk-txt">' +
      (VERBS[type.id] || type.label) +
      ' <span class="tk-city">\u00b7 ' +
      cityName +
      '</span></span>';
    tickerEl.insertBefore(line, tickerEl.firstChild);
    while (tickerEl.children.length > 7) tickerEl.removeChild(tickerEl.lastChild);
  }

  // ---- build dotted land --------------------------------------------------
  var dotSin,
    dotCos,
    dotLng,
    dotCity,
    dotGrp,
    dotTier,
    dotN = 0;
  function buildLandDots() {
    var step = DENSITY_STEP[scene.density] || 3.0;
    var sinA = [],
      cosA = [],
      lngA = [],
      cityA = [],
      grpA = [],
      tierA = [],
      pts = [];
    for (var lat = -84; lat <= 84; lat += step) {
      var ringStep = step / Math.max(0.18, Math.cos(lat * DEG));
      for (var lng = -180; lng < 180; lng += ringStep) {
        if (d3.geoContains(landFeature, [lng, lat])) {
          var latR = lat * DEG;
          sinA.push(Math.sin(latR));
          cosA.push(Math.cos(latR));
          lngA.push(lng * DEG);
          pts.push([lng, lat]);
          cityA.push(Math.random() < 0.45 ? 1 : 0);
          grpA.push((Math.random() * 3) | 0);
          // size tier for relief texture: ~46% small, ~37% medium, ~17% large
          var r = Math.random();
          tierA.push(r < 0.46 ? 0 : r < 0.83 ? 1 : 2);
        }
      }
    }
    dotSin = Float64Array.from(sinA);
    dotCos = Float64Array.from(cosA);
    dotLng = Float64Array.from(lngA);
    dotCity = Uint8Array.from(cityA);
    dotGrp = Uint8Array.from(grpA);
    dotTier = Uint8Array.from(tierA);
    dotN = sinA.length;
    landDots = pts; // real [lng,lat] pairs, used to seed star nodes
  }

  function renderDots(now) {
    var ds = '',
      dm = '',
      dl = '',
      c0 = '',
      c1 = '',
      c2 = '';
    var dayN = scene.dayNight,
      cityOn = scene.cityLights;
    for (var i = 0; i < dotN; i++) {
      var dlon = dotLng[i] - P_lon0;
      var cd = Math.cos(dlon);
      var cosc = P_sinLat0 * dotSin[i] + P_cosLat0 * dotCos[i] * cd;
      if (cosc <= 0) continue; // back hemisphere
      var sd = Math.sin(dlon);
      var sx = (CX + R * (dotCos[i] * sd)) | 0;
      var sy = (CY - R * (P_cosLat0 * dotSin[i] - P_sinLat0 * dotCos[i] * cd)) | 0;
      var seg = 'M' + sx + ' ' + sy + 'l.1 0';
      var tier = dotTier[i];
      if (tier === 0) ds += seg;
      else if (tier === 1) dm += seg;
      else dl += seg;
      // city lights: only city points currently on the night side
      if (cityOn && dayN && dotCity[i]) {
        var sdl = dotLng[i] - sun_lon;
        var cosSun = sun_sinLat * dotSin[i] + sun_cosLat * dotCos[i] * Math.cos(sdl);
        if (cosSun < 0.04) {
          var g = dotGrp[i];
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
    var t = now * 0.0017,
      cb = scene.cityBright;
    city0.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t)) * cb).toFixed(2);
    city1.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t + 2.1)) * cb).toFixed(2);
    city2.style.opacity = Math.min(1.4, (0.55 + 0.45 * Math.sin(t + 4.2)) * cb).toFixed(2);
  }

  function renderGraticule() {
    graticuleEl.setAttribute('d', pathGen(graticule()) || '');
  }

  // ---- radial spike corona ------------------------------------------------
  var spkSin,
    spkCos,
    spkLng,
    spkLenF,
    spkPhase,
    spkN = 0;
  function buildSpikes() {
    var step = 7; // sparse — the corona is a faint shimmer, not detail
    var sinA = [],
      cosA = [],
      lngA = [],
      lenA = [],
      phA = [];
    for (var lat = -86; lat <= 86; lat += step) {
      var ringStep = step / Math.max(0.16, Math.cos(lat * DEG));
      for (var lng = -180; lng < 180; lng += ringStep) {
        var latR = lat * DEG;
        sinA.push(Math.sin(latR));
        cosA.push(Math.cos(latR));
        lngA.push(lng * DEG);
        lenA.push(0.25 + Math.random() * 0.95);
        phA.push(Math.random() * Math.PI * 2);
      }
    }
    spkSin = Float64Array.from(sinA);
    spkCos = Float64Array.from(cosA);
    spkLng = Float64Array.from(lngA);
    spkLenF = Float64Array.from(lenA);
    spkPhase = Float64Array.from(phA);
    spkN = sinA.length;
  }
  function renderSpikes(now) {
    var d = '';
    var tt = now * 0.0016;
    for (var i = 0; i < spkN; i++) {
      var dlon = spkLng[i] - P_lon0;
      var cd = Math.cos(dlon);
      var cosc = P_sinLat0 * spkSin[i] + P_cosLat0 * spkCos[i] * cd;
      if (cosc <= 0) continue;
      var sd = Math.sin(dlon);
      var px = CX + R * (spkCos[i] * sd);
      var py = CY - R * (P_cosLat0 * spkSin[i] - P_sinLat0 * spkCos[i] * cd);
      var pulse = 0.7 + 0.3 * Math.sin(tt + spkPhase[i]);
      var len = (0.02 + spkLenF[i] * 0.04) * pulse;
      var ex = CX + (px - CX) * (1 + len),
        ey = CY + (py - CY) * (1 + len);
      d += 'M' + (px | 0) + ' ' + (py | 0) + 'L' + (ex | 0) + ' ' + (ey | 0);
    }
    spikesEl.setAttribute('d', d);
  }

  // ---- bright star nodes --------------------------------------------------
  var nodes = [];
  function buildNodes() {
    nodes = [];
    if (!landDots.length) return;
    for (var i = 0; i < 18; i++) {
      var ll = landDots[(Math.random() * landDots.length) | 0];
      var el2 = el('circle', { class: 'node', r: 1 });
      el2.style.filter = 'drop-shadow(0 0 4px #cfe6ff)';
      nodesLayer.appendChild(el2);
      nodes.push({
        ll: ll,
        el: el2,
        phase: Math.random() * Math.PI * 2,
        sp: 1.5 + Math.random() * 2.5,
        size: 1.3 + Math.random() * 1.6,
      });
    }
  }
  function renderNodes(now) {
    var tt = now * 0.001;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var p = projection(n.ll);
      if (!p) {
        n.el.style.opacity = 0;
        continue;
      }
      var tw = 0.35 + 0.65 * Math.abs(Math.sin(tt * n.sp + n.phase));
      n.el.setAttribute('cx', p[0].toFixed(1));
      n.el.setAttribute('cy', p[1].toFixed(1));
      n.el.setAttribute('r', (n.size * (0.7 + 0.3 * tw)).toFixed(2));
      n.el.style.opacity = tw.toFixed(2);
    }
  }

  // ---- floating orbital rings ---------------------------------------------
  var orbits = [];
  function buildOrbits() {
    orbits = [];
    var defs = [
      { rf: 1.16, incl: 1.15, yaw0: 0.4, spin: 0.05, sat: true },
      { rf: 1.24, incl: 0.6, yaw0: 2.1, spin: -0.035, sat: false },
      { rf: 1.1, incl: 1.45, yaw0: 1.2, spin: 0.06, sat: true },
      { rf: 1.32, incl: 0.95, yaw0: 3.0, spin: -0.025, sat: false },
      { rf: 1.19, incl: 0.3, yaw0: 0.8, spin: 0.04, sat: false },
    ];
    defs.forEach(function (cfg) {
      var front = el('path', {});
      var back = el('path', {});
      orbitsFront.appendChild(front);
      orbitsBack.appendChild(back);
      var sat = cfg.sat ? el('circle', { class: 'orbit-sat', r: 2 }) : null;
      if (sat) {
        sat.style.filter = 'drop-shadow(0 0 5px #bcd9ff)';
        orbitsFront.appendChild(sat);
      }
      orbits.push({ cfg: cfg, front: front, back: back, sat: sat });
    });
  }
  function renderOrbits(now) {
    var N = 84;
    for (var o = 0; o < orbits.length; o++) {
      var ob = orbits[o],
        cfg = ob.cfg;
      var Rr = R * cfg.rf;
      var ci = Math.cos(cfg.incl),
        si = Math.sin(cfg.incl);
      var yaw = cfg.yaw0 + now * 0.001 * cfg.spin * 6;
      var cy_ = Math.cos(yaw),
        sy = Math.sin(yaw);
      var fd = '',
        bd = '',
        fStart = true,
        bStart = true;
      var satIdx = (((now * 0.0004 * (o + 1)) % 1) * N) | 0;
      for (var k = 0; k <= N; k++) {
        var a = (k / N) * Math.PI * 2;
        var x0 = Math.cos(a),
          y0 = Math.sin(a),
          z0 = 0;
        // tilt around X
        var y1 = y0 * ci - z0 * si,
          z1 = y0 * si + z0 * ci,
          x1 = x0;
        // spin around Y
        var x2 = x1 * cy_ + z1 * sy,
          z2 = -x1 * sy + z1 * cy_,
          y2 = y1;
        var sx = CX + x2 * Rr,
          sySc = CY - y2 * Rr;
        if (z2 >= 0) {
          fd += (fStart ? 'M' : 'L') + sx.toFixed(1) + ' ' + sySc.toFixed(1);
          fStart = false;
          bStart = true;
        } else {
          bd += (bStart ? 'M' : 'L') + sx.toFixed(1) + ' ' + sySc.toFixed(1);
          bStart = false;
          fStart = true;
        }
        if (ob.sat && k === satIdx) {
          if (z2 >= 0) {
            ob.sat.setAttribute('cx', sx.toFixed(1));
            ob.sat.setAttribute('cy', sySc.toFixed(1));
            ob.sat.style.opacity = 1;
          } else ob.sat.style.opacity = 0.15;
        }
      }
      ob.front.setAttribute('d', fd);
      ob.back.setAttribute('d', bd);
    }
  }

  // ---- HQ marker ----------------------------------------------------------
  var hqRing, hqRing2, hqDot, hqLabel;
  function buildHQ() {
    hqRing = el('circle', { class: 'hq-ring' });
    hqRing2 = el('circle', { class: 'hq-ring hq-ring-2' });
    hqDot = el('circle', { class: 'hq-dot', r: 4.5 });
    hqLabel = el('g', { class: 'hq-label' });
    var lt = el('text', { class: 'hq-label-text', x: 12, y: 4 });
    lt.textContent = GD.HQ.name;
    var sub = el('text', { class: 'hq-label-sub', x: 12, y: 20 });
    sub.textContent = GD.HQ.city;
    hqLabel.appendChild(lt);
    hqLabel.appendChild(sub);
    hqLayer.appendChild(hqRing2);
    hqLayer.appendChild(hqRing);
    hqLayer.appendChild(hqDot);
    hqLayer.appendChild(hqLabel);
  }
  function renderHQ() {
    var p = projection(GD.HQ.lnglat);
    var vis = !!p && visible(GD.HQ.lnglat);
    var op = vis ? 1 : 0;
    [hqRing, hqRing2, hqDot, hqLabel].forEach(function (n) {
      n.style.opacity = op;
    });
    if (!vis) return;
    hqRing.setAttribute('cx', p[0]);
    hqRing.setAttribute('cy', p[1]);
    hqRing2.setAttribute('cx', p[0]);
    hqRing2.setAttribute('cy', p[1]);
    hqDot.setAttribute('cx', p[0]);
    hqDot.setAttribute('cy', p[1]);
    hqLabel.setAttribute('transform', 'translate(' + p[0] + ',' + p[1] + ')');
  }

  // ---- beams --------------------------------------------------------------
  var DRAW_MS = 1500; // time to draw the arc (slower, more graceful)
  var HOLD_MS = 700; // glow hold once landed
  var FADE_MS = 950; // fade out
  var LIFE_MS = DRAW_MS + HOLD_MS + FADE_MS;

  function spawnBeam() {
    if (!visible(GD.HQ.lnglat)) return; // can't land if HQ faces away
    var enabled = GD.ACTIVITY_TYPES.filter(function (t) {
      return state.types[t.id].enabled;
    });
    if (!enabled.length) return;

    // weighted type pick
    var total = enabled.reduce(function (s, t) {
      return s + (state.types[t.id].weight || 1);
    }, 0);
    var r = Math.random() * total,
      type = enabled[0];
    for (var i = 0; i < enabled.length; i++) {
      r -= state.types[enabled[i].id].weight || 1;
      if (r <= 0) {
        type = enabled[i];
        break;
      }
    }

    // pick a visible source city (try a handful)
    var city = null;
    for (var k = 0; k < 8; k++) {
      var c = GD.CITIES[(Math.random() * GD.CITIES.length) | 0];
      if (visible(c.lnglat)) {
        city = c;
        break;
      }
    }
    if (!city) return;

    var ts = state.types[type.id];
    ts.count++;
    updateCount(type.id);
    pushTicker(type, city.name);

    var g = el('g', { class: 'beam' });
    if (type.id === state.fwTrigger) g.setAttribute('class', 'beam beam-special');
    var glow = el('path', { class: 'beam-glow' });
    var core = el('path', { class: 'beam-core' });
    var hot = el('path', { class: 'beam-hot' });
    var spark = el('path', { class: 'beam-spark' });
    var head = el('circle', { class: 'beam-head', r: 4.2 });
    g.appendChild(glow);
    g.appendChild(core);
    g.appendChild(hot);
    g.appendChild(spark);
    g.appendChild(head);
    beamsLayer.appendChild(g);

    var col = state.types[type.id].color;
    glow.setAttribute('stroke', col);
    core.setAttribute('stroke', col);
    spark.setAttribute('stroke', tint(col));
    head.setAttribute('fill', '#fff');
    head.style.filter = 'drop-shadow(0 0 7px ' + col + ')';

    beams.push({
      type: type,
      src: city.lnglat,
      color: col,
      g: g,
      glow: glow,
      core: core,
      hot: hot,
      spark: spark,
      head: head,
      t0: performance.now(),
      impacted: false,
    });
  }

  // a screen-space lifted quadratic arc; returns control point + endpoints
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function arcControl(a, b) {
    var mx = (a[0] + b[0]) / 2,
      my = (a[1] + b[1]) / 2;
    var vx = mx - CX,
      vy = my - CY;
    var vlen = Math.hypot(vx, vy) || 1;
    var dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    var lift = Math.min(R * 0.9, dist * 0.42 + R * 0.12);
    return [mx + (vx / vlen) * lift, my + (vy / vlen) * lift];
  }

  function renderBeams(now) {
    var hqp = projection(GD.HQ.lnglat);
    var hqVisible = !!hqp && visible(GD.HQ.lnglat);
    for (var i = beams.length - 1; i >= 0; i--) {
      var b = beams[i];
      var age = now - b.t0;
      if (age > LIFE_MS) {
        removeBeam(b);
        beams.splice(i, 1);
        continue;
      }

      var sp = projection(b.src);
      var srcVis = !!sp && visible(b.src);
      if (!sp || !hqp || !srcVis || !hqVisible) {
        // an endpoint rotated out of view — hide this frame
        b.g.style.opacity = 0;
        continue;
      }

      // quadratic bezier control point (lifted away from globe centre)
      var C = arcControl(sp, hqp);
      var drawP = Math.min(1, age / DRAW_MS);
      // easeInOutCubic — eases in and settles gently
      var t = drawP < 0.5 ? 4 * drawP * drawP * drawP : 1 - Math.pow(-2 * drawP + 2, 3) / 2;

      // partial arc via De Casteljau subdivision at t — no DOM geometry queries
      var d, hx, hy;
      if (t >= 1) {
        d = 'M' + sp[0] + ' ' + sp[1] + 'Q' + C[0] + ' ' + C[1] + ' ' + hqp[0] + ' ' + hqp[1];
        hx = hqp[0];
        hy = hqp[1];
      } else {
        var ax = lerp(sp[0], C[0], t),
          ay = lerp(sp[1], C[1], t);
        var bx = lerp(C[0], hqp[0], t),
          by = lerp(C[1], hqp[1], t);
        hx = lerp(ax, bx, t);
        hy = lerp(ay, by, t);
        d = 'M' + sp[0] + ' ' + sp[1] + 'Q' + ax + ' ' + ay + ' ' + hx + ' ' + hy;
      }
      b.glow.setAttribute('d', d);
      b.core.setAttribute('d', d);
      b.hot.setAttribute('d', d);

      // comet trail: a bright leading sub-arc just behind the head
      if (scene.beamTrails && t < 1) {
        var u0 = Math.max(0, t - 0.17),
          sd = '';
        for (var s = 0; s <= 6; s++) {
          var u = u0 + (t - u0) * (s / 6),
            iu = 1 - u;
          var qx = iu * iu * sp[0] + 2 * iu * u * C[0] + u * u * hqp[0];
          var qy = iu * iu * sp[1] + 2 * iu * u * C[1] + u * u * hqp[1];
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
        // gentle size pulse so the comet head shimmers as it travels
        b.head.setAttribute('r', (4.2 + Math.sin(age / 90) * 0.7).toFixed(2));
        b.head.style.opacity = 1;
      } else {
        b.head.style.opacity = 0;
        if (!b.impacted) {
          b.impacted = true;
          spawnImpact(hqp, b.color);
          if (state.fireworks && b.type.id === state.fwTrigger) spawnFireworkBarrage(hqp, b.color);
        }
      }

      // opacity envelope
      var op = 1;
      if (age > DRAW_MS + HOLD_MS) op = Math.max(0, 1 - (age - DRAW_MS - HOLD_MS) / FADE_MS);
      b.g.style.opacity = op;
    }
  }

  function removeBeam(b) {
    if (b.g && b.g.parentNode) b.g.parentNode.removeChild(b.g);
  }

  function spawnImpact(p, color) {
    var c = el('circle', { class: 'impact', cx: p[0], cy: p[1], r: 5, stroke: color });
    impactsLayer.appendChild(c);
    var burst = el('circle', { class: 'impact-burst', cx: p[0], cy: p[1], r: 3, fill: color });
    impactsLayer.appendChild(burst);
    var t0 = performance.now();
    (function tick() {
      var a = (performance.now() - t0) / 620;
      if (a >= 1) {
        c.remove();
        burst.remove();
        return;
      }
      var e = 1 - Math.pow(1 - a, 2);
      c.setAttribute('r', 5 + e * R * 0.18);
      c.style.opacity = 1 - a;
      burst.setAttribute('r', 3 + e * 6);
      burst.style.opacity = (1 - a) * 0.9;
      requestAnimationFrame(tick);
    })();
  }

  // ---- fireworks ----------------------------------------------------------
  var fireParticles = [];
  function tint(hex) {
    var c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.slice(0, 2), 16),
      g = parseInt(c.slice(2, 4), 16),
      b = parseInt(c.slice(4, 6), 16);
    r = Math.round(r + (255 - r) * 0.5);
    g = Math.round(g + (255 - g) * 0.5);
    b = Math.round(b + (255 - b) * 0.5);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function spawnFireworkBarrage(p, color) {
    spawnBurst(p[0], p[1], color, 1);
    setTimeout(function () {
      spawnBurst(
        p[0] + (Math.random() * 2 - 1) * R * 0.2,
        p[1] - R * 0.14 * Math.random() - R * 0.04,
        color,
        0.72
      );
    }, 210);
    setTimeout(function () {
      spawnBurst(p[0] + (Math.random() * 2 - 1) * R * 0.24, p[1] - R * 0.02, tint(color), 0.66);
    }, 410);
  }
  function spawnBurst(cx, cy, color, scale) {
    scale = scale || 1;
    var flash = el('circle', { class: 'fw-flash', cx: cx, cy: cy, r: 3, fill: '#fff' });
    fireworksLayer.appendChild(flash);
    fireParticles.push({ el: flash, flash: true, t: 0, ttl: 0.34, grow: R * 0.46 * scale });
    var cols = [color, '#ffffff', tint(color)];
    var N = Math.round(48 * scale);
    for (var i = 0; i < N; i++) {
      var ang = Math.random() * Math.PI * 2;
      var core = i < N * 0.28;
      var speed = (0.42 + Math.random() * 0.95) * R * 1.7 * scale * (core ? 1.3 : 1);
      var col = core ? '#fff' : cols[(Math.random() * cols.length) | 0];
      var c = el('circle', { class: 'fw-spark', r: core ? 1.5 : 2.1, fill: col });
      c.style.filter = 'drop-shadow(0 0 5px ' + col + ')';
      fireworksLayer.appendChild(c);
      fireParticles.push({
        el: c,
        x: cx,
        y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        t: 0,
        ttl: 0.9 + Math.random() * 0.8,
        twk: Math.random() * 10,
        twinkle: Math.random() < 0.55,
      });
    }
  }
  function updateFireworks(dt) {
    if (!fireParticles.length) return;
    var grav = R * 1.25;
    var drag = Math.max(0, 1 - 2.4 * dt);
    for (var i = fireParticles.length - 1; i >= 0; i--) {
      var p = fireParticles[i];
      p.t += dt;
      if (p.flash) {
        var a = p.t / p.ttl;
        if (a >= 1) {
          p.el.remove();
          fireParticles.splice(i, 1);
          continue;
        }
        p.el.setAttribute('r', (3 + a * p.grow).toFixed(1));
        p.el.style.opacity = 1 - a;
        continue;
      }
      if (p.t >= p.ttl) {
        p.el.remove();
        fireParticles.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy *= drag;
      p.vy += grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var op = 1 - p.t / p.ttl;
      if (p.twinkle) op *= 0.45 + 0.55 * Math.abs(Math.sin(p.t * 16 + p.twk));
      p.el.setAttribute('cx', p.x.toFixed(1));
      p.el.setAttribute('cy', p.y.toFixed(1));
      p.el.style.opacity = Math.max(0, op).toFixed(2);
    }
  }

  // ---- shooting stars / meteors ------------------------------------------
  var meteors = [],
    meteorAcc = 0,
    meteorSeq = 0;
  function spawnMeteor() {
    // start somewhere along the top or right edge, travel down-left
    var fromRight = Math.random() < 0.45;
    var x, y;
    if (fromRight) {
      x = W + 40;
      y = Math.random() * H * 0.6;
    } else {
      x = Math.random() * W * 0.9;
      y = -40;
    }
    var ang = (Math.random() * 0.5 + 0.62) * Math.PI; // ~112°–203°: down & left
    var speed = (W + H) * (0.34 + Math.random() * 0.3); // px/sec
    var vx = Math.cos(ang) * speed,
      vy = Math.abs(Math.sin(ang)) * speed;
    var len = 90 + Math.random() * 170;
    var id = 'met-g-' + meteorSeq++;
    var grad = el('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse' });
    var s0 = el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '0' });
    var s1 = el('stop', { offset: '55%', 'stop-color': '#cfe3ff', 'stop-opacity': '.55' });
    var s2 = el('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': '1' });
    grad.appendChild(s0);
    grad.appendChild(s1);
    grad.appendChild(s2);
    svgDefs.appendChild(grad);
    var g = el('g', {});
    var trail = el('line', {
      class: 'met-trail',
      stroke: 'url(#' + id + ')',
      'stroke-width': (1.3 + Math.random() * 1.1).toFixed(1),
    });
    var head = el('circle', { class: 'met-head', r: (1.4 + Math.random() * 1.2).toFixed(1) });
    head.style.filter = 'drop-shadow(0 0 6px #fff) drop-shadow(0 0 12px #9fc6ff)';
    g.appendChild(trail);
    g.appendChild(head);
    shootingLayer.appendChild(g);
    meteors.push({
      g: g,
      trail: trail,
      head: head,
      grad: grad,
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      len: len,
      t: 0,
      ttl: 0.9 + Math.random() * 0.7,
    });
  }
  function updateMeteors(dt) {
    if (scene.shootingStars) {
      meteorAcc += dt * (0.12 + scene.meteorRate * 1.5);
      var guard = 0;
      while (meteorAcc >= 1 && guard < 3) {
        spawnMeteor();
        meteorAcc -= 1;
        guard++;
      }
    } else {
      meteorAcc = 0;
    }
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      m.t += dt;
      if (m.t >= m.ttl || m.x < -120 || m.y > H + 120) {
        m.g.remove();
        if (m.grad.parentNode) m.grad.remove();
        meteors.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      var sp = Math.hypot(m.vx, m.vy) || 1;
      var tx = m.x - (m.vx / sp) * m.len,
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
      // ease in over first 12%, hold, ease out over last 28%
      var a = m.t / m.ttl,
        op = 1;
      if (a < 0.12) op = a / 0.12;
      else if (a > 0.72) op = Math.max(0, 1 - (a - 0.72) / 0.28);
      m.g.style.opacity = op.toFixed(2);
    }
  }

  // ---- main loop ----------------------------------------------------------
  var lastT = performance.now();
  var spawnAcc = 0;
  var frameCount = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    frameCount++;

    if (!state.paused) {
      if (!dragging) rotation[0] += state.rotSpeed * dt;
      if (rotation[0] > 180) rotation[0] -= 360;
      if (rotation[0] < -180) rotation[0] += 360;
      projection.rotate(rotation);
      updateFastProj();

      spawnAcc += dt * state.rate;
      var guard = 0;
      while (spawnAcc >= 1 && guard < 12) {
        spawnBeam();
        spawnAcc -= 1;
        guard++;
      }
    } else {
      projection.rotate(rotation);
      updateFastProj();
    }

    if (frameCount % 2 === 0) renderSpikes(now); // faint corona — half-rate is invisible
    renderDots(now);
    updateSun(now);
    renderNight();
    renderAurora(now);
    if (frameCount % 2 === 0) renderGraticule(); // graticule barely moves frame-to-frame
    renderNodes(now);
    renderOrbits(now);
    renderHQ();
    renderBeams(now);
    updateFireworks(dt);
    updateMeteors(dt);

    // breathing atmosphere bloom
    if (scene.atmosPulse) {
      var pulse = 0.82 + 0.18 * Math.sin(now * 0.0011);
      sphereGlow.style.opacity = (0.7 * scene.atmos * pulse).toFixed(3);
      bottomGlow.style.opacity = (
        scene.atmos *
        (0.88 + 0.12 * Math.sin(now * 0.0011 + 1.2))
      ).toFixed(3);
    }

    requestAnimationFrame(frame);
  }

  // ---- drag to spin -------------------------------------------------------
  var dragging = false,
    lastX = 0,
    lastY = 0;
  function onDown(e) {
    dragging = true;
    var pt = pointer(e);
    lastX = pt.x;
    lastY = pt.y;
    svg.classList.add('grabbing');
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    var pt = pointer(e);
    var k = 0.26;
    rotation[0] += (pt.x - lastX) * k;
    rotation[1] = Math.max(-90, Math.min(90, rotation[1] - (pt.y - lastY) * k));
    lastX = pt.x;
    lastY = pt.y;
  }
  function onUp() {
    dragging = false;
    svg.classList.remove('grabbing');
  }
  function pointer(e) {
    var t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  // ---- helpers ------------------------------------------------------------
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // ---- control panel wiring ----------------------------------------------
  function updateCount(id) {
    var node = document.querySelector('[data-count="' + id + '"]');
    if (node) node.textContent = state.types[id].count.toLocaleString();
    var totalNode = document.getElementById('total-count');
    if (totalNode) {
      var total = 0;
      for (var k in state.types) total += state.types[k].count;
      totalNode.textContent = total.toLocaleString();
    }
  }

  // ---- scene settings: apply config to the DOM ---------------------------
  function applyScene() {
    var base = scene.dotSize,
      tex = scene.texture;
    landS.style.strokeWidth = (base * (1 - tex)).toFixed(2);
    landM.style.strokeWidth = base.toFixed(2);
    landL.style.strokeWidth = (base * (1 + tex * 1.5)).toFixed(2);
    dotsEl.style.opacity = scene.landBright;
    graticuleEl.style.display = scene.grid ? '' : 'none';

    sphereGlow.style.opacity = (0.7 * scene.atmos).toFixed(2);
    bottomGlow.style.opacity = scene.atmos.toFixed(2);

    var dn = scene.dayNight;
    nightEl.style.display = dn ? '' : 'none';
    nightCoreEl.style.display = dn ? '' : 'none';
    nightEl.style.opacity = (0.55 * scene.darkness).toFixed(2);
    nightCoreEl.style.opacity = (0.58 * scene.darkness).toFixed(2);
    citylightsLayer.style.display = dn && scene.cityLights ? '' : 'none';

    auroraLayer.style.display = scene.aurora ? '' : 'none';
    var sch = AURORA_SCHEMES[scene.auroraScheme] || AURORA_SCHEMES.gv;
    aurNG.style.stroke = sch[0];
    aurSG.style.stroke = sch[0];
    aurNV.style.stroke = sch[1];
    aurSV.style.stroke = sch[1];

    spikesEl.style.display = scene.corona ? '' : 'none';
    spikesEl.style.opacity = scene.coronaIntensity;
    nodesLayer.style.display = scene.nodes ? '' : 'none';
    orbitsFront.style.display = scene.orbits ? '' : 'none';
    orbitsBack.style.display = scene.orbits ? '' : 'none';

    // cosmos
    shootingLayer.style.display = scene.shootingStars ? '' : 'none';
    // when the atmosphere pulse is off, the static glow opacity set above stands;
    // when on, the main loop drives sphereGlow / bottomGlow opacity each frame.
    var aDrift1 = scene.starDrift ? 'drift1 140s linear infinite' : '';
    var aDrift2 = scene.starDrift ? 'drift2 200s linear infinite' : '';
    var aTw1 = scene.starTwinkle ? 'tw1 5.5s ease-in-out infinite' : '';
    var aTw2 = scene.starTwinkle ? 'tw2 7s ease-in-out infinite' : '';
    if (starsEls[0]) starsEls[0].style.animation = [aDrift1, aTw1].filter(Boolean).join(', ');
    if (starsEls[1]) starsEls[1].style.animation = [aDrift2, aTw2].filter(Boolean).join(', ');
  }

  // ---- scene settings: build the gear panel ------------------------------
  function buildScene() {
    var pct = function (v) {
      return Math.round(v * 100) + '%';
    };
    var SPEC = [
      { sec: 'Texture' },
      {
        k: 'dotSize',
        t: 'slider',
        l: 'Dot size',
        min: 1.5,
        max: 4.5,
        step: 0.1,
        fmt: function (v) {
          return v.toFixed(1) + 'px';
        },
      },
      {
        k: 'texture',
        t: 'slider',
        l: 'Relief texture',
        min: 0,
        max: 0.6,
        step: 0.02,
        fmt: function (v) {
          return Math.round((v / 0.6) * 100) + '%';
        },
      },
      {
        k: 'landBright',
        t: 'slider',
        l: 'Land brightness',
        min: 0.4,
        max: 1,
        step: 0.05,
        fmt: pct,
      },
      {
        k: 'density',
        t: 'seg',
        l: 'Dot density',
        opts: [
          ['sparse', 'Sparse'],
          ['med', 'Medium'],
          ['dense', 'Dense'],
        ],
      },
      { k: 'grid', t: 'toggle', l: 'Lat / long grid' },
      { sec: 'Atmosphere' },
      {
        k: 'atmos',
        t: 'slider',
        l: 'Atmospheric glow',
        min: 0,
        max: 2,
        step: 0.1,
        fmt: function (v) {
          return Math.round(v * 50) + '%';
        },
      },
      { sec: 'Day & night' },
      { k: 'dayNight', t: 'toggle', l: 'Day / night shadow' },
      {
        k: 'darkness',
        t: 'slider',
        l: 'Night darkness',
        min: 0,
        max: 0.9,
        step: 0.05,
        fmt: function (v) {
          return Math.round((v / 0.9) * 100) + '%';
        },
      },
      { k: 'cityLights', t: 'toggle', l: 'City lights' },
      {
        k: 'cityBright',
        t: 'slider',
        l: 'City brightness',
        min: 0.3,
        max: 1.4,
        step: 0.05,
        fmt: function (v) {
          return Math.round((v / 1.4) * 100) + '%';
        },
      },
      { sec: 'Aurora' },
      { k: 'aurora', t: 'toggle', l: 'Aurora' },
      {
        k: 'auroraIntensity',
        t: 'slider',
        l: 'Intensity',
        min: 0,
        max: 1.5,
        step: 0.05,
        fmt: function (v) {
          return Math.round((v / 1.5) * 100) + '%';
        },
      },
      {
        k: 'auroraLat',
        t: 'slider',
        l: 'Latitude',
        min: 55,
        max: 82,
        step: 1,
        fmt: function (v) {
          return v + '\u00b0';
        },
      },
      {
        k: 'auroraSpeed',
        t: 'slider',
        l: 'Speed',
        min: 0,
        max: 3,
        step: 0.1,
        fmt: function (v) {
          return v.toFixed(1) + '\u00d7';
        },
      },
      {
        k: 'auroraScheme',
        t: 'seg',
        l: 'Colour',
        opts: [
          ['gv', 'Green\u00b7Violet'],
          ['emerald', 'Emerald'],
          ['rose', 'Rose'],
        ],
      },
      { sec: 'Effects' },
      { k: 'corona', t: 'toggle', l: 'Edge corona' },
      {
        k: 'coronaIntensity',
        t: 'slider',
        l: 'Corona intensity',
        min: 0,
        max: 0.4,
        step: 0.02,
        fmt: function (v) {
          return Math.round((v / 0.4) * 100) + '%';
        },
      },
      { k: 'nodes', t: 'toggle', l: 'Star nodes' },
      { k: 'orbits', t: 'toggle', l: 'Orbital rings' },
      { sec: 'Cosmos' },
      { k: 'shootingStars', t: 'toggle', l: 'Shooting stars' },
      {
        k: 'meteorRate',
        t: 'slider',
        l: 'Meteor frequency',
        min: 0,
        max: 1,
        step: 0.05,
        fmt: function (v) {
          return Math.round(v * 100) + '%';
        },
      },
      { k: 'beamTrails', t: 'toggle', l: 'Comet beam trails' },
      { k: 'atmosPulse', t: 'toggle', l: 'Atmosphere pulse' },
      { k: 'starTwinkle', t: 'toggle', l: 'Star twinkle' },
      { k: 'starDrift', t: 'toggle', l: 'Star drift' },
    ];
    var byKey = {};
    SPEC.forEach(function (c) {
      if (c.k) byKey[c.k] = c;
    });

    function ctrlHTML(c) {
      if (c.sec) return '<div class="sec-h">' + c.sec + '</div>';
      if (c.t === 'slider') {
        return (
          '<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">' +
          c.l +
          '</span><span class="sc-val" data-val="' +
          c.k +
          '"></span></div>' +
          '<input type="range" data-k="' +
          c.k +
          '" min="' +
          c.min +
          '" max="' +
          c.max +
          '" step="' +
          c.step +
          '"></div>'
        );
      }
      if (c.t === 'toggle') {
        return (
          '<div class="sc-row"><span class="sc-lbl">' +
          c.l +
          '</span><button class="sw" data-tog="' +
          c.k +
          '" aria-pressed="false"></button></div>'
        );
      }
      if (c.t === 'seg') {
        var b = c.opts
          .map(function (o) {
            return '<button data-seg="' + c.k + '" data-v="' + o[0] + '">' + o[1] + '</button>';
          })
          .join('');
        return (
          '<div class="sc-slider"><div class="sc-top"><span class="sc-lbl">' +
          c.l +
          '</span></div><div class="sc-seg">' +
          b +
          '</div></div>'
        );
      }
      return '';
    }

    var host = document.getElementById('scene');
    host.innerHTML = SPEC.map(ctrlHTML).join('');

    SPEC.forEach(function (c) {
      if (!c.k) return;
      if (c.t === 'slider') {
        host.querySelector('[data-k="' + c.k + '"]').value = scene[c.k];
        host.querySelector('[data-val="' + c.k + '"]').textContent = c.fmt(+scene[c.k]);
      } else if (c.t === 'toggle') {
        host
          .querySelector('[data-tog="' + c.k + '"]')
          .setAttribute('aria-pressed', scene[c.k] ? 'true' : 'false');
      } else if (c.t === 'seg') {
        host.querySelectorAll('[data-seg="' + c.k + '"]').forEach(function (bn) {
          bn.classList.toggle('on', bn.getAttribute('data-v') === scene[c.k]);
        });
      }
    });

    host.addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-k');
      if (!k) return;
      scene[k] = +e.target.value;
      host.querySelector('[data-val="' + k + '"]').textContent = byKey[k].fmt(scene[k]);
      applyScene();
      saveScene();
    });
    host.addEventListener('click', function (e) {
      var tog = e.target.closest('[data-tog]');
      if (tog) {
        var tk = tog.getAttribute('data-tog');
        scene[tk] = !scene[tk];
        tog.setAttribute('aria-pressed', scene[tk] ? 'true' : 'false');
        applyScene();
        saveScene();
        return;
      }
      var seg = e.target.closest('[data-seg]');
      if (seg) {
        var sk = seg.getAttribute('data-seg'),
          sv = seg.getAttribute('data-v');
        scene[sk] = sv;
        host.querySelectorAll('[data-seg="' + sk + '"]').forEach(function (bn) {
          bn.classList.toggle('on', bn === seg);
        });
        if (sk === 'density') {
          buildLandDots();
          renderDots(performance.now());
        }
        applyScene();
        saveScene();
        return;
      }
    });

    var gear = document.getElementById('scene-toggle');
    function setOpen(open) {
      if (open) host.removeAttribute('hidden');
      else host.setAttribute('hidden', '');
      gear.setAttribute('aria-pressed', open ? 'true' : 'false');
      try {
        localStorage.setItem('orbit-scene-open', open ? '1' : '0');
      } catch (e) {}
    }
    gear.addEventListener('click', function () {
      setOpen(host.hasAttribute('hidden'));
    });
    var wasOpen = false;
    try {
      wasOpen = localStorage.getItem('orbit-scene-open') === '1';
    } catch (e) {}
    if (wasOpen) setOpen(true);
  }

  function buildControls() {
    var list = document.getElementById('activity-list');
    GD.ACTIVITY_TYPES.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'act-row';
      row.innerHTML =
        '<label class="swatch" style="--c:' +
        t.color +
        '">' +
        '<input type="color" value="' +
        t.color +
        '" data-color="' +
        t.id +
        '">' +
        '</label>' +
        '<span class="act-name">' +
        t.label +
        '</span>' +
        '<span class="act-count" data-count="' +
        t.id +
        '">0</span>' +
        '<button class="eye" data-toggle="' +
        t.id +
        '" aria-pressed="true" title="Toggle">' +
        '<span class="eye-dot"></span></button>';
      list.appendChild(row);
    });

    list.addEventListener('input', function (e) {
      var id = e.target.getAttribute('data-color');
      if (!id) return;
      var col = e.target.value;
      state.types[id].color = col;
      e.target.closest('.swatch').style.setProperty('--c', col);
    });
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toggle]');
      if (!btn) return;
      var id = btn.getAttribute('data-toggle');
      var on = !state.types[id].enabled;
      state.types[id].enabled = on;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.closest('.act-row').classList.toggle('off', !on);
    });

    var rate = document.getElementById('rate');
    var rateVal = document.getElementById('rate-val');
    rate.addEventListener('input', function () {
      state.rate = +rate.value;
      rateVal.textContent = state.rate.toFixed(1) + '/s';
    });
    rate.value = state.rate;
    rateVal.textContent = state.rate.toFixed(1) + '/s';

    var rot = document.getElementById('rot');
    var rotVal = document.getElementById('rot-val');
    rot.addEventListener('input', function () {
      state.rotSpeed = +rot.value;
      rotVal.textContent = state.rotSpeed === 0 ? 'off' : state.rotSpeed + '°/s';
    });
    rot.value = state.rotSpeed;
    rotVal.textContent = state.rotSpeed + '°/s';

    var pause = document.getElementById('pause');
    pause.addEventListener('click', function () {
      state.paused = !state.paused;
      pause.classList.toggle('paused', state.paused);
      pause.querySelector('.pp-label').textContent = state.paused ? 'Play' : 'Pause';
    });

    // fireworks controls
    var fwSel = document.getElementById('fw-trigger');
    GD.ACTIVITY_TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.label;
      if (t.id === state.fwTrigger) o.selected = true;
      fwSel.appendChild(o);
    });
    fwSel.addEventListener('change', function () {
      state.fwTrigger = fwSel.value;
    });
    fwSel.value = state.fwTrigger;

    var fwTog = document.getElementById('fw-toggle');
    fwTog.addEventListener('click', function () {
      state.fireworks = !state.fireworks;
      fwTog.setAttribute('aria-pressed', state.fireworks ? 'true' : 'false');
      fwTog.closest('.fw-row').classList.toggle('off', !state.fireworks);
    });
  }

  // ---- boot ---------------------------------------------------------------
  function boot(topo) {
    landFeature = topojson.feature(topo, topo.objects.land);
    layout();
    buildLandDots();
    buildSpikes();
    buildNodes();
    buildOrbits();
    buildHQ();
    buildControls();
    buildScene();
    applyScene();

    window.addEventListener('resize', layout);
    svg.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    svg.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    document.getElementById('loading').style.display = 'none';
    // paint one correct frame immediately so the globe looks right even
    // before requestAnimationFrame resumes (it is paused while the tab is hidden)
    projection.rotate(rotation);
    updateFastProj();
    var n0 = performance.now();
    updateSun(n0);
    renderSpikes(n0);
    renderDots(n0);
    renderNight();
    renderAurora(n0);
    renderGraticule();
    renderNodes(n0);
    renderOrbits(n0);
    renderHQ();
    requestAnimationFrame(function (t) {
      lastT = t;
      frame(t);
    });
  }

  function fail(msg) {
    var l = document.getElementById('loading');
    if (l)
      l.innerHTML =
        '<div class="load-err">Could not load world map data.<br><small>' + msg + '</small></div>';
  }

  var LAND_URLS = [
    'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json',
    'https://unpkg.com/world-atlas@2/land-110m.json',
    'https://cdn.skypack.dev/world-atlas@2/land-110m.json',
  ];
  function loadLand(i) {
    i = i || 0;
    if (i >= LAND_URLS.length) {
      fail('all map sources unreachable');
      return;
    }
    fetch(LAND_URLS[i])
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(boot)
      .catch(function () {
        loadLand(i + 1);
      });
  }
  loadLand(0);
})();
