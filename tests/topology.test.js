/* Orbit: TopoJSON land decoding. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLand } from '../shared/topology.js';

// A 10×10 square, quantised with a delta-encoded arc.
const square = (geometry) => ({
  transform: { scale: [1, 1], translate: [-5, -5] },
  arcs: [
    [
      [0, 0],
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ],
  ],
  objects: { land: geometry },
});

const RING = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
  [-5, -5],
];

test('decodes a delta-encoded polygon and applies the transform', () => {
  const polys = decodeLand(square({ type: 'Polygon', arcs: [[0]] }));

  assert.deepEqual(polys, [[RING]]);
});

test('a reversed arc (~i) walks the ring backwards', () => {
  const polys = decodeLand(square({ type: 'Polygon', arcs: [[~0]] }));

  assert.deepEqual(polys, [[[...RING].reverse()]]);
});

test('handles multipolygons and geometry collections', () => {
  const multi = { type: 'MultiPolygon', arcs: [[[0]], [[0]]] };

  assert.equal(decodeLand(square(multi)).length, 2);

  assert.equal(decodeLand(square({ type: 'GeometryCollection', geometries: [multi] })).length, 2);
});

test('stitches several arcs into one ring without duplicating the joins', () => {
  const topo = {
    transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [0, 4],
        [-4, 0],
      ],
    ],
    objects: { land: { type: 'Polygon', arcs: [[0, 1]] } },
  };
  const [[ring]] = decodeLand(topo);

  assert.deepEqual(ring, [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]);
});
