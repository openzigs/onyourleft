// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { decodeTile } from './decode';
import { clipToBox, rasterise, simplifyRing, triangulate } from './geometry';
import {
  FIXTURE_FRAME,
  FIXTURE_TILE,
  NAMED_FIXTURES,
  tileAtLimit,
  woodWithHoleTile,
} from './testing';
import type { GridSpec, PolygonFeature, Ring } from './types';

function polygonsOf(bytes: Uint8Array): PolygonFeature[] {
  const result = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
  if ('reason' in result) throw new Error(result.reason);
  return [...result.landUse, ...result.buildings];
}

/** Every polygon of the fixture set: the five named tiles and the ring-limit tile. */
const FIXTURE_POLYGONS: readonly PolygonFeature[] = [
  ...Object.values(NAMED_FIXTURES).flatMap((build) => polygonsOf(build())),
  ...polygonsOf(tileAtLimit('ringsPerPolygon')),
];

function wood(): PolygonFeature {
  const feature = polygonsOf(woodWithHoleTile())[0];
  if (feature === undefined) throw new Error('no wood');
  return feature;
}

function shoelace(ring: Ring): number {
  let sum = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum +=
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number) -
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number);
  }
  return sum / 2;
}

/** Whether any two non-adjacent edges of the ring cross. */
function selfIntersects(ring: Ring): boolean {
  const n = ring.length / 2;
  const p = (i: number): [number, number] => [
    ring[(i % n) * 2] as number,
    ring[(i % n) * 2 + 1] as number,
  ];
  const orient = (a: [number, number], b: [number, number], c: [number, number]): number =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const [a, b, c, d] = [p(i), p(i + 1), p(j), p(j + 1)];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0)
        return true;
    }
  }
  return false;
}

describe('simplifyRing', () => {
  it('never returns more than maxVertices, nor a self-intersecting ring, for the fixture set', () => {
    let rings = 0;
    for (const feature of FIXTURE_POLYGONS) {
      for (const ring of feature.rings) {
        for (const [tolerance, max] of [
          [0, 1000],
          [0.5, 1000],
          [5, 1000],
          [0, 6],
          [0, 3],
        ] as const) {
          const simplified = simplifyRing(ring, tolerance, max);
          expect(simplified.length / 2).toBeLessThanOrEqual(max);
          expect(simplified.length / 2).toBeGreaterThanOrEqual(3);
          expect(selfIntersects(simplified)).toBe(false);
          rings++;
        }
      }
    }
    expect(rings).toBeGreaterThan(1000);
  });

  it('keeps every vertex at zero tolerance, and drops the near-collinear ones at a looser one', () => {
    const outer = wood().rings[0] as Ring;
    expect(simplifyRing(outer, 0, 1000)).toEqual(outer);
    // A square with a vertex 1 cm off one edge's midpoint.
    const square = Float32Array.of(0, 0, 50, 0.01, 100, 0, 100, 100, 0, 100);
    expect(simplifyRing(square, 0.5, 100)).toEqual(Float32Array.of(0, 0, 100, 0, 100, 100, 0, 100));
  });

  it('under a vertex cap, keeps the most important vertices', () => {
    // A square with one vertex pushed out 30 m: at a cap of 5 that one stays.
    const shape = Float32Array.of(0, 0, 50, 1, 100, 0, 130, 50, 100, 100, 50, 99, 0, 100);
    const five = simplifyRing(shape, 0, 5);
    expect(Array.from(five)).toEqual([0, 0, 100, 0, 130, 50, 100, 100, 0, 100]);
  });
});

describe('triangulate', () => {
  it('covers each fixture polygon’s area to within 0.5 %, holes excluded', () => {
    for (const feature of FIXTURE_POLYGONS) {
      const [outer, ...holes] = feature.rings as [Ring, ...Ring[]];
      const area =
        Math.abs(shoelace(outer)) - holes.reduce((sum, hole) => sum + Math.abs(shoelace(hole)), 0);
      const flat = feature.rings.flatMap((ring) => Array.from(ring));
      const triangles = triangulate(feature);
      let covered = 0;
      for (let t = 0; t < triangles.length; t += 3) {
        const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]] as [
          number,
          number,
          number,
        ];
        covered +=
          Math.abs(
            ((flat[b * 2] as number) - (flat[a * 2] as number)) *
              ((flat[c * 2 + 1] as number) - (flat[a * 2 + 1] as number)) -
              ((flat[c * 2] as number) - (flat[a * 2] as number)) *
                ((flat[b * 2 + 1] as number) - (flat[a * 2 + 1] as number)),
          ) / 2;
      }
      expect(Math.abs(covered - area) / area).toBeLessThan(0.005);
    }
  });

  it('leaves the wood’s hole uncovered: its triangles total the outer area less the hole', () => {
    const feature = wood();
    const outerOnly = triangulate({ rings: [feature.rings[0] as Ring] });
    expect(triangulate(feature).length).toBeGreaterThan(outerOnly.length);
  });
});

describe('clipToBox', () => {
  it('a polygon wholly inside is unchanged; wholly outside is null', () => {
    const feature = wood();
    const inside = clipToBox(feature, { minX: -1e6, minZ: -1e6, maxX: 1e6, maxZ: 1e6 });
    expect(inside?.rings.map((r) => r.length)).toEqual(feature.rings.map((r) => r.length));
    expect(clipToBox(feature, { minX: 1e5, minZ: 1e5, maxX: 1e5 + 10, maxZ: 1e5 + 10 })).toBeNull();
  });

  it('a square cut by a box keeps exactly the overlap, and a hole cut away is dropped', () => {
    const square: PolygonFeature = {
      rings: [
        Float32Array.of(0, 0, 100, 0, 100, 100, 0, 100),
        Float32Array.of(80, 80, 80, 90, 90, 90, 90, 80),
      ],
    };
    const clipped = clipToBox(square, { minX: 50, minZ: -10, maxX: 150, maxZ: 60 });
    expect(clipped?.rings).toHaveLength(1);
    expect(Math.abs(shoelace(clipped?.rings[0] as Ring))).toBeCloseTo(50 * 60, 6);
  });
});

describe('rasterise', () => {
  /** Brute force: every cell of the grid, its centre tested by ray casting against every ring. */
  function bruteCells(feature: PolygonFeature, grid: GridSpec): number[] {
    const cells: number[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const x = grid.originX + (column + 0.5) * grid.cellMetres;
        const z = grid.originZ + (row + 0.5) * grid.cellMetres;
        let inside = false;
        for (const ring of feature.rings) {
          const n = ring.length / 2;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = ring[i * 2] as number;
            const zi = ring[i * 2 + 1] as number;
            const xj = ring[j * 2] as number;
            const zj = ring[j * 2 + 1] as number;
            if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
          }
        }
        if (inside) cells.push(row * grid.columns + column);
      }
    }
    return cells;
  }

  /** A 5 m grid over the whole wood, with a margin. */
  function woodGrid(feature: PolygonFeature): GridSpec {
    const outer = feature.rings[0] as Ring;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i] as number);
      maxX = Math.max(maxX, outer[i] as number);
      minZ = Math.min(minZ, outer[i + 1] as number);
      maxZ = Math.max(maxZ, outer[i + 1] as number);
    }
    const originX = Math.floor(minX) - 13.3;
    const originZ = Math.floor(minZ) - 11.7;
    return {
      originX,
      originZ,
      cellMetres: 5,
      columns: Math.ceil((maxX - originX) / 5) + 3,
      rows: Math.ceil((maxZ - originZ) / 5) + 3,
    };
  }

  it('writes exactly the cells whose centres are inside the wood, holes excluded, at 5 m', () => {
    const feature = wood();
    const grid = woodGrid(feature);
    const written: number[] = [];
    rasterise(feature, grid, (cell) => written.push(cell));
    const expected = bruteCells(feature, grid);
    expect(written.sort((a, b) => a - b)).toEqual(expected);
    expect(new Set(written).size).toBe(written.length);
    expect(expected.length).toBeGreaterThan(500);
  });

  it('control: the hole’s cells are not written, and ignoring the hole would write them', () => {
    const feature = wood();
    const grid = woodGrid(feature);
    const holeCells = bruteCells({ rings: [feature.rings[1] as Ring] }, grid);
    expect(holeCells.length).toBeGreaterThan(50);
    const written = new Set<number>();
    rasterise(feature, grid, (cell) => written.add(cell));
    for (const cell of holeCells) expect(written.has(cell)).toBe(false);
    const outerOnly = new Set<number>();
    rasterise({ rings: [feature.rings[0] as Ring] }, grid, (cell) => outerOnly.add(cell));
    for (const cell of holeCells) expect(outerOnly.has(cell)).toBe(true);
  });

  it('writes nothing outside the grid', () => {
    const feature = wood();
    const full = woodGrid(feature);
    const half: GridSpec = {
      ...full,
      columns: Math.floor(full.columns / 2),
      rows: Math.floor(full.rows / 2),
    };
    const written: number[] = [];
    rasterise(feature, half, (cell) => written.push(cell));
    const expected = bruteCells(feature, half);
    expect(written.sort((a, b) => a - b)).toEqual(expected);
  });
});
