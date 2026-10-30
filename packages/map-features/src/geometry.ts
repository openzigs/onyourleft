// SPDX-License-Identifier: Apache-2.0

import earcut from 'earcut';

import type { Box, GridSpec, PolygonFeature, Ring } from './types';

/**
 * The pure geometry phase B needs on a decoded polygon (#1544): simplify a
 * ring, clip a polygon to a box, triangulate it, rasterise it onto a grid.
 * Every coordinate is local metres (`types.ts`).
 */

/**
 * A ring simplified to within `toleranceMetres`, and never to more than
 * `maxVertices` vertices (nor fewer than 3).
 *
 * Douglas–Peucker over the closed ring, written so that it also answers "the
 * best `n` vertices": each vertex is given the distance at which the
 * recursion would split on it, capped by its parent's, so the importances fall
 * monotonically down the recursion. The vertices kept are those more important
 * than the tolerance; when that is more than `maxVertices`, the
 * `maxVertices` most important are kept instead, which is the same answer as
 * raising the tolerance until it fits. The two anchors — vertex 0 and the
 * vertex farthest from it — are always kept.
 */
export function simplifyRing(ring: Ring, toleranceMetres: number, maxVertices: number): Ring {
  const n = ring.length / 2;
  const cap = Math.max(3, Math.floor(maxVertices));
  if (n <= 3) return ring.slice();

  const xAt = (i: number): number => ring[(i % n) * 2] as number;
  const zAt = (i: number): number => ring[(i % n) * 2 + 1] as number;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(xAt(i) - xAt(0), zAt(i) - zAt(0));
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }

  const importance = new Float64Array(n);
  importance[0] = Number.POSITIVE_INFINITY;
  importance[far] = Number.POSITIVE_INFINITY;
  // [from, to, parent importance]; `to` may be `n`, which is vertex 0 again.
  const stack: [number, number, number][] = [
    [0, far, Number.POSITIVE_INFINITY],
    [far, n, Number.POSITIVE_INFINITY],
  ];
  while (stack.length > 0) {
    const [from, to, parent] = stack.pop() as [number, number, number];
    if (to - from < 2) continue;
    let split = -1;
    let splitDistance = -1;
    for (let k = from + 1; k < to; k++) {
      const d = segmentDistance(xAt(k), zAt(k), xAt(from), zAt(from), xAt(to), zAt(to));
      if (d > splitDistance) {
        splitDistance = d;
        split = k;
      }
    }
    const value = Math.min(splitDistance, parent);
    importance[split] = value;
    stack.push([from, split, value], [split, to, value]);
  }

  let kept: number[] = [];
  for (let i = 0; i < n; i++) if ((importance[i] as number) > toleranceMetres) kept.push(i);
  if (kept.length > cap || kept.length < 3) {
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (p, q) => (importance[q] as number) - (importance[p] as number) || p - q,
    );
    kept = order.slice(0, Math.min(cap, Math.max(3, kept.length))).sort((p, q) => p - q);
  }
  const out = new Float32Array(kept.length * 2);
  kept.forEach((index, j) => {
    out[j * 2] = xAt(index);
    out[j * 2 + 1] = zAt(index);
  });
  return out;
}

function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * A polygon clipped to a box (Sutherland–Hodgman, ring by ring), or `null`
 * when nothing of its outer ring is left. A hole clipped away is dropped. The
 * clipped area is exact; where the polygon leaves and re-enters the box, the
 * ring runs along the box's edge between, which is area-neutral.
 */
export function clipToBox(feature: PolygonFeature, box: Box): PolygonFeature | null {
  const rings: Ring[] = [];
  for (let r = 0; r < feature.rings.length; r++) {
    const clipped = clipRing(feature.rings[r] as Ring, box);
    if (clipped === null) {
      if (r === 0) return null;
      continue;
    }
    rings.push(clipped);
  }
  return { rings };
}

function clipRing(ring: Ring, box: Box): Ring | null {
  let points: number[] = Array.from(ring);
  const edges: [
    (x: number, z: number) => boolean,
    (ax: number, az: number, bx: number, bz: number) => [number, number],
  ][] = [
    [
      (x) => x >= box.minX,
      (ax, az, bx, bz) => [box.minX, az + ((box.minX - ax) * (bz - az)) / (bx - ax)],
    ],
    [
      (x) => x <= box.maxX,
      (ax, az, bx, bz) => [box.maxX, az + ((box.maxX - ax) * (bz - az)) / (bx - ax)],
    ],
    [
      (_, z) => z >= box.minZ,
      (ax, az, bx, bz) => [ax + ((box.minZ - az) * (bx - ax)) / (bz - az), box.minZ],
    ],
    [
      (_, z) => z <= box.maxZ,
      (ax, az, bx, bz) => [ax + ((box.maxZ - az) * (bx - ax)) / (bz - az), box.maxZ],
    ],
  ];
  for (const [inside, cross] of edges) {
    const input = points;
    points = [];
    const count = input.length / 2;
    for (let i = 0; i < count; i++) {
      const cx = input[i * 2] as number;
      const cz = input[i * 2 + 1] as number;
      const j = (i + count - 1) % count;
      const px = input[j * 2] as number;
      const pz = input[j * 2 + 1] as number;
      const currentIn = inside(cx, cz);
      const previousIn = inside(px, pz);
      if (currentIn) {
        if (!previousIn) points.push(...cross(px, pz, cx, cz));
        points.push(cx, cz);
      } else if (previousIn) {
        points.push(...cross(px, pz, cx, cz));
      }
    }
    if (points.length < 6) return null;
  }
  return Float32Array.from(points);
}

/**
 * The polygon's triangles, by earcut, as indices into its vertices taken ring
 * after ring: vertex `i` of the result's index space is the `i`-th vertex of
 * `rings[0]`, then of `rings[1]`, and so on. Holes are left uncovered.
 */
export function triangulate(feature: PolygonFeature): Uint32Array {
  let total = 0;
  for (const ring of feature.rings) total += ring.length;
  const flat = new Float64Array(total);
  const holes: number[] = [];
  let offset = 0;
  feature.rings.forEach((ring, r) => {
    if (r > 0) holes.push(offset / 2);
    flat.set(ring, offset);
    offset += ring.length;
  });
  return Uint32Array.from(earcut(flat, holes, 2));
}

/**
 * Calls `write` once for every grid cell whose **centre** is inside the
 * polygon, holes excluded (the even-odd rule over every ring), and for no
 * other cell. A scanline per row of cell centres, so the cost is the rows
 * the polygon spans times its edges, never the whole grid.
 */
export function rasterise(
  feature: PolygonFeature,
  grid: GridSpec,
  write: (cell: number) => void,
): void {
  const outer = feature.rings[0];
  if (outer === undefined || outer.length < 6) return;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < outer.length; i += 2) {
    minZ = Math.min(minZ, outer[i] as number);
    maxZ = Math.max(maxZ, outer[i] as number);
  }
  const cell = grid.cellMetres;
  const firstRow = Math.max(0, Math.ceil((minZ - grid.originZ) / cell - 0.5));
  const lastRow = Math.min(grid.rows - 1, Math.floor((maxZ - grid.originZ) / cell - 0.5));
  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const zc = grid.originZ + (row + 0.5) * cell;
    crossings.length = 0;
    for (const ring of feature.rings) {
      const count = ring.length / 2;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const x1 = ring[i * 2] as number;
        const z1 = ring[i * 2 + 1] as number;
        const x2 = ring[j * 2] as number;
        const z2 = ring[j * 2 + 1] as number;
        if (z1 <= zc !== z2 <= zc) crossings.push(x1 + ((zc - z1) * (x2 - x1)) / (z2 - z1));
      }
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(((crossings[k] as number) - grid.originX) / cell - 0.5));
      const to = Math.min(
        grid.columns - 1,
        Math.ceil(((crossings[k + 1] as number) - grid.originX) / cell - 0.5) - 1,
      );
      for (let column = from; column <= to; column++) write(row * grid.columns + column);
    }
  }
}
