/* Orbit: world topology helpers (shared, dependency-free)
 *
 * Fetching and decoding the world-atlas TopoJSON. Kept free of any renderer import so
 * it can be unit tested in Node.
 */

/**
 * Fetch the first reachable topology from a list of mirrors.
 *
 * @param {string[]} urls candidate URLs, tried in order
 * @returns {Promise<object|null>} the parsed TopoJSON, or null when every mirror failed
 */
export async function fetchTopology(urls) {
  for (const url of urls) {
    try {
      const r = await fetch(url);

      if (!r.ok) throw new Error('HTTP ' + r.status);

      return await r.json();
    } catch (e) {
      /* try the next mirror */
    }
  }

  return null;
}

/**
 * Decode a land TopoJSON into plain polygons of `[lng, lat]` rings.
 * Handles the delta-encoded, quantised arcs and the reversed-arc (`~i`) convention.
 *
 * @param {object} topo a TopoJSON topology whose `objects.land` holds the land geometry
 * @returns {Array<Array<Array<number[]>>>} polygons, each a list of rings of [lng, lat] points
 */
export function decodeLand(topo) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0,
      y = 0;

    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;

      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const ring = (indices) => {
    const pts = [];

    for (const i of indices) {
      const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();

      for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
    }

    return pts;
  };

  const polys = [];
  const visit = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
    else if (g.type === 'Polygon') polys.push(g.arcs.map(ring));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => polys.push(p.map(ring)));
  };

  visit(topo.objects.land);

  return polys;
}
