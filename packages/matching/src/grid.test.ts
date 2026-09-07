// SPDX-License-Identifier: Apache-2.0

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { offsetBy, straightPath } from '../tools/corpus';
import { CELL_DEGREES, cellCover, cellOf, coversIntersect } from './grid';

const ORIGIN: GeographicPosition = geographicPosition(
  degreesLatitude(51.5),
  degreesLongitude(-0.12),
);

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

describe('the cell index', () => {
  it('puts two nearby positions in the same cell and a distant one elsewhere', () => {
    expect(cellOf(ORIGIN)).toBe(cellOf(offsetBy(ORIGIN, 50, 50)));
    expect(cellOf(ORIGIN)).not.toBe(cellOf(offsetBy(ORIGIN, 50_000, 0)));
  });

  it('does not collide across the latitude/longitude packing', () => {
    // The packing is `row * COLUMNS + column`. A column count too small would
    // let a position one row up collide with one far along the row — which
    // would make the prefilter admit segments from a different continent, and
    // it would look like a tolerance problem rather than an indexing one.
    const seen = new Set<number>();
    for (let row = -90; row < 90; row += 7) {
      for (let column = -180; column < 180; column += 11) {
        seen.add(cellOf(at(row, column)));
      }
    }
    expect(seen.size).toBe(26 * 33);
  });

  it('separates positions one cell apart in either axis', () => {
    expect(cellOf(ORIGIN)).not.toBe(cellOf(at(51.5 + CELL_DEGREES, -0.12)));
    expect(cellOf(ORIGIN)).not.toBe(cellOf(at(51.5, -0.12 + CELL_DEGREES)));
  });
});

describe('the cover, and the cells BETWEEN two samples', () => {
  it('covers the cells a long step passes through, not only its ends', () => {
    // ⚠️ The part that is easy to leave out and fatal when it is. Two positions
    // 5 km apart skip every cell between them, and a cover built from vertices
    // alone would miss a segment whose middle crosses a cell the ride never
    // sampled inside — a false negative produced by the INDEX rather than by
    // the tolerance, which no tolerance change would fix.
    const sparse = [ORIGIN, offsetBy(ORIGIN, 5000, 0)];
    const dense = straightPath(ORIGIN, 0, 5000, 200);

    const sparseCover = cellCover(sparse);
    const denseCover = cellCover(dense);

    // Every cell the densely-sampled path touches is in the sparse path's
    // cover, even though the sparse path has two points.
    for (const cell of denseCover) {
      expect(sparseCover.has(cell)).toBe(true);
    }
    expect(sparseCover.size).toBeGreaterThan(2);
  });

  it('covers a single position', () => {
    expect(cellCover([ORIGIN]).size).toBe(1);
  });

  it('covers nothing for an empty path', () => {
    expect(cellCover([]).size).toBe(0);
  });
});

describe('the intersection test', () => {
  it('is true for paths that share a cell and false for paths that do not', () => {
    const here = cellCover(straightPath(ORIGIN, 0, 500, 26));
    const alongside = cellCover(straightPath(offsetBy(ORIGIN, 0, 30), 0, 500, 26));
    const faraway = cellCover(straightPath(offsetBy(ORIGIN, 80_000, 0), 0, 500, 26));

    expect(coversIntersect(here, alongside)).toBe(true);
    expect(coversIntersect(here, faraway)).toBe(false);
  });

  it('is symmetric, however different the two sizes are', () => {
    // It iterates the smaller set for speed, so the two argument orders take
    // different code paths and both have to agree.
    const ride = cellCover(straightPath(ORIGIN, 0, 40_000, 400));
    const segment = cellCover(straightPath(ORIGIN, 0, 500, 26));
    expect(ride.size).toBeGreaterThan(segment.size);
    expect(coversIntersect(ride, segment)).toBe(coversIntersect(segment, ride));
    expect(coversIntersect(ride, segment)).toBe(true);
  });

  it('is false against an empty cover', () => {
    expect(coversIntersect(cellCover([ORIGIN]), new Set())).toBe(false);
  });
});
