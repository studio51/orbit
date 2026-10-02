/* Orbit: world data baker (WebGPU renderer)
 *
 * Turns the world-atlas TopoJSON into the three GPU textures the Earth shader
 * samples, with no D3 and no committed image assets:
 *
 *   landTex    R8    4096×2048  crisp land mask (equirectangular, row 0 = south)
 *   fieldTex   RGBA  1024×512   R: shelf blur (coast), G: broad blur, B: continentality
 *   lightsTex  R8    2048×1024  procedural night lights clustered around the city list
 *
 * Everything is derived at load time from the topology plus `CITIES`, so the
 * repo stays asset-free. The topology is fetched at runtime (first reachable
 * mirror wins), exactly like the 2D renderers do.
 */
import * as THREE from 'three/webgpu';
import { DEG } from '../shared/util.js';
import { decodeLand } from '../shared/topology.js';

const LAND_W = 4096; // land mask resolution
const LAND_H = 2048;
const FIELD_W = 1024; // blurred field resolution
const FIELD_H = 512;
const LIGHT_W = 2048; // night-lights resolution
const LIGHT_H = 1024;

/**
 * Rasterize land polygons into an equirectangular mask.
 *
 * @param {Array} polys polygons from `decodeLand`
 * @returns {Uint8Array} LAND_W×LAND_H mask (0 or 255), row 0 = south pole
 */
function rasterizeLand(polys) {
  const cv = document.createElement('canvas');

  cv.width = LAND_W;
  cv.height = LAND_H;

  const ctx = cv.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, LAND_W, LAND_H);
  ctx.fillStyle = '#fff';

  for (const poly of polys) {
    ctx.beginPath();

    for (const r of poly) {
      r.forEach(([lng, lat], i) => {
        const x = ((lng + 180) / 360) * LAND_W,
          y = ((90 - lat) / 180) * LAND_H;

        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }

  const rgba = ctx.getImageData(0, 0, LAND_W, LAND_H).data;
  const out = new Uint8Array(LAND_W * LAND_H);

  // canvas rows run north→south; the texture wants south→north
  for (let y = 0; y < LAND_H; y++) {
    const src = (LAND_H - 1 - y) * LAND_W * 4,
      dst = y * LAND_W;

    for (let x = 0; x < LAND_W; x++) out[dst + x] = rgba[src + x * 4];
  }

  return out;
}

/**
 * Average a mask down into a smaller float grid.
 *
 * @param {Uint8Array} src source mask
 * @returns {Float32Array} FIELD_W×FIELD_H values in 0..1
 */
function downsample(src) {
  const fx = LAND_W / FIELD_W,
    fy = LAND_H / FIELD_H;
  const out = new Float32Array(FIELD_W * FIELD_H);

  for (let y = 0; y < FIELD_H; y++) {
    for (let x = 0; x < FIELD_W; x++) {
      let s = 0;

      for (let j = 0; j < fy; j++) {
        const row = (y * fy + j) * LAND_W + x * fx;

        for (let i = 0; i < fx; i++) s += src[row + i];
      }
      out[y * FIELD_W + x] = s / (fx * fy * 255);
    }
  }

  return out;
}

/**
 * One separable box-blur pass (wraps in longitude, clamps in latitude).
 *
 * @param {Float32Array} src input grid
 * @param {number} r box radius in cells
 * @returns {Float32Array} the blurred grid
 */
function boxBlur(src, r) {
  const w = FIELD_W,
    h = FIELD_H,
    n = 2 * r + 1;
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);

  for (let y = 0; y < h; y++) {
    let s = 0;

    for (let k = -r; k <= r; k++) s += src[y * w + ((k + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += src[y * w + ((x + r + 1) % w)] - src[y * w + ((x - r + w) % w)];
    }
  }

  for (let x = 0; x < w; x++) {
    let s = 0;

    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }

  return out;
}

/**
 * Approximate a Gaussian blur with three box passes.
 *
 * @param {Float32Array} src input grid
 * @param {number} r box radius in cells
 * @returns {Float32Array} the blurred grid
 */
function gaussian(src, r) {
  return boxBlur(boxBlur(boxBlur(src, r), r), r);
}

/**
 * Small deterministic PRNG so the lights look the same on every load.
 *
 * @param {number} seed integer seed
 * @returns {function(): number} generator returning floats in [0, 1)
 */
function mulberry32(seed) {
  let a = seed;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;

    let t = Math.imul(a ^ (a >>> 15), 1 | a);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter night lights: dense clusters around every city plus a sparse regional glow.
 *
 * @param {Uint8Array} land the crisp land mask (to keep lights on land)
 * @param {Array<{lnglat: number[]}>} cities city list to cluster around
 * @returns {Uint8Array} LIGHT_W×LIGHT_H intensity, row 0 = south pole
 */
function bakeLights(land, cities) {
  const rnd = mulberry32(51);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.2;
  const grid = new Float32Array(LIGHT_W * LIGHT_H);
  const onLand = (lng, lat) => {
    const x = Math.floor((((lng + 540) % 360) / 360) * LAND_W),
      y = Math.floor(((lat + 90) / 180) * LAND_H);

    return y >= 0 && y < LAND_H && land[y * LAND_W + x] > 127;
  };

  const splat = (lng, lat, v) => {
    const x = Math.round((((lng + 540) % 360) / 360) * LIGHT_W) % LIGHT_W,
      y = Math.round(((lat + 90) / 180) * (LIGHT_H - 1));

    if (y < 1 || y >= LIGHT_H - 1) return;
    grid[y * LIGHT_W + x] += v;
    grid[y * LIGHT_W + ((x + 1) % LIGHT_W)] += v * 0.35;
    grid[y * LIGHT_W + ((x + LIGHT_W - 1) % LIGHT_W)] += v * 0.35;
    grid[(y + 1) * LIGHT_W + x] += v * 0.35;
    grid[(y - 1) * LIGHT_W + x] += v * 0.35;
  };

  // --- Dense city clusters ---
  for (const c of cities) {
    const [lng0, lat0] = c.lnglat;
    const cosLat = Math.max(0.2, Math.cos(lat0 * DEG));

    splat(lng0, lat0, 1.2);

    for (let i = 0; i < 170; i++) {
      const rad = Math.abs(gauss()) * 1.15,
        ang = rnd() * Math.PI * 2;
      const lng = lng0 + (Math.cos(ang) * rad) / cosLat,
        lat = lat0 + Math.sin(ang) * rad;

      if (onLand(lng, lat)) splat(lng, lat, (0.3 + rnd() * 0.7) * Math.max(0.2, 1 - rad / 3));
    }
  }

  // --- Sparse regional glow (towns, highways) ---
  for (let i = 0; i < 9000; i++) {
    const c = cities[(rnd() * cities.length) | 0];
    const [lng0, lat0] = c.lnglat;
    const rad = Math.abs(gauss()) * 5.5,
      ang = rnd() * Math.PI * 2;
    const lat = lat0 + Math.sin(ang) * rad,
      lng = lng0 + (Math.cos(ang) * rad) / Math.max(0.3, Math.cos(lat * DEG));

    if (lat > -52 && lat < 70 && onLand(lng, lat)) splat(lng, lat, 0.12 + rnd() * 0.3);
  }

  const out = new Uint8Array(grid.length);

  for (let i = 0; i < grid.length; i++) out[i] = Math.min(255, grid[i] * 255);

  return out;
}

/**
 * Build a repeating, mip-mapped data texture.
 *
 * @param {Uint8Array} data texel data (row 0 = south)
 * @param {number} w width in texels
 * @param {number} h height in texels
 * @param {number} format a THREE texture format (RedFormat / RGBAFormat)
 * @returns {THREE.DataTexture} the uploaded texture
 */
function dataTexture(data, w, h, format) {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);

  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;

  return t;
}

/**
 * Bake every world texture from a topology and the city list.
 *
 * @param {object} topo a TopoJSON topology (see `fetchTopology`)
 * @param {Array<{lnglat: number[]}>} cities city list used to cluster the night lights
 * @returns {{landTex: THREE.DataTexture, fieldTex: THREE.DataTexture, lightsTex: THREE.DataTexture}}
 *   the three textures the Earth material samples
 */
export function bakeWorld(topo, cities) {
  const land = rasterizeLand(decodeLand(topo));
  const base = downsample(land);
  const shelf = gaussian(base, 2),
    broad = gaussian(base, 9),
    inland = gaussian(base, 26);
  const field = new Uint8Array(FIELD_W * FIELD_H * 4);

  for (let i = 0; i < base.length; i++) {
    field[i * 4] = shelf[i] * 255;
    field[i * 4 + 1] = broad[i] * 255;
    field[i * 4 + 2] = inland[i] * 255;
    field[i * 4 + 3] = 255;
  }

  return {
    landTex: dataTexture(land, LAND_W, LAND_H, THREE.RedFormat),
    fieldTex: dataTexture(field, FIELD_W, FIELD_H, THREE.RGBAFormat),
    lightsTex: dataTexture(bakeLights(land, cities), LIGHT_W, LIGHT_H, THREE.RedFormat),
  };
}
