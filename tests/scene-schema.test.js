/* Orbit: scene schema and look data invariants.
 *
 * These guard the contract the renderers and the platform rely on: every default is
 * valid, the sanitiser clamps and rejects, renderer scoping is well-formed, and every
 * look defines the same set of shader params and colours (LookState eases all of them).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_SCHEMA, sceneFields, sceneDefaults, sanitizeScene } from '../shared/scene-schema.js';
import { LOOKS, LOOK_INDEX } from '../shared/looks.js';

const RENDERERS = new Set(['webgpu', 'canvas', 'svg']);

test('every default survives sanitising unchanged', () => {
  const defaults = sceneDefaults();

  assert.deepEqual(sanitizeScene(defaults), defaults);
});

test('sanitising clamps ranges, rejects bad selects and drops unknown keys', () => {
  const out = sanitizeScene({ clouds: 99, look: 'sepia', darkness: -5, nope: 1, grid: 'yes' });

  assert.equal(out.clouds, 1);
  assert.equal(out.look, 'realistic');
  assert.equal(out.darkness, 0);
  assert.equal(out.grid, false);

  assert.equal('nope' in out, false);
});

test('sanitising tolerates garbage input', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.deepEqual(sanitizeScene(bad), sceneDefaults());
  }
});

test('field keys are unique', () => {
  const keys = sceneFields().map((f) => f.key);

  assert.equal(new Set(keys).size, keys.length);
});

test('renderer scoping uses known renderers only', () => {
  const scoped = [...SCENE_SCHEMA.sections, ...sceneFields()].filter((x) => x.renderers);

  assert.ok(scoped.length > 0);

  for (const x of scoped) {
    assert.ok(x.renderers.length > 0);
    for (const r of x.renderers) assert.ok(RENDERERS.has(r), `unknown renderer ${r}`);
  }
});

test('the look setting offers exactly the defined looks', () => {
  const field = sceneFields().find((f) => f.key === 'look');

  assert.deepEqual(
    field.options.map((o) => o.value),
    LOOKS.map((l) => l.id)
  );

  assert.ok(field.options.some((o) => o.value === field.default));
});

test('look ids are unique and indexed in order', () => {
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length);

  LOOKS.forEach((l, i) => assert.equal(LOOK_INDEX[l.id], i));
});

test('every look defines the same params and colours', () => {
  const [first, ...rest] = LOOKS;
  const params = Object.keys(first.params).sort();
  const colors = Object.keys(first.colors).sort();

  for (const l of rest) {
    assert.deepEqual(Object.keys(l.params).sort(), params, `${l.id} params`);
    assert.deepEqual(Object.keys(l.colors).sort(), colors, `${l.id} colors`);
  }
});

test('look params are finite numbers and colours are hex', () => {
  for (const l of LOOKS) {
    for (const [k, v] of Object.entries(l.params)) {
      assert.ok(Number.isFinite(v), `${l.id}.${k}`);
    }
    for (const [k, v] of Object.entries(l.colors)) {
      assert.match(v, /^#[0-9a-f]{6}$/i, `${l.id}.${k}`);
    }
    assert.equal(l.swatch.length, 3);
  }
});
