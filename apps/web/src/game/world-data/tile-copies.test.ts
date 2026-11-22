// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3047: which footprints are a tile's copy of another, and which are kept —
 * each rule with its control, a footprint that must stay. The walls the
 * kept one is built with are `footprint-walls.test.ts`'.
 */

import { describe, expect, it } from 'vitest';

import { NO_BUILDING_FIELDS, type BuildingFeature } from '@onyourleft/map-features';

import { TILE_COPY_WORK_PER_FOOTPRINT, withoutTileCopies } from './tile-copies';

/** A building from `x, z` pairs. */
function building(
  pairs: readonly (readonly [number, number])[],
  extra: Partial<BuildingFeature> = {},
): BuildingFeature {
  return {
    kind: 'building',
    heightMetres: null,
    minHeightMetres: null,
    ...NO_BUILDING_FIELDS,
    rings: [Float32Array.from(pairs.flat())],
    ...extra,
  };
}

/** A 14 × 10 m house at the origin. */
const HOUSE = building([
  [0, 0],
  [14, 0],
  [14, 10],
  [0, 10],
]);
/** The same, as the next tile's grid puts it: each vertex a quarter of a metre off. */
const REGRIDDED = building([
  [0.2, -0.15],
  [14.2, -0.15],
  [14.2, 9.85],
  [0.2, 9.85],
]);
/** The same, clipped at the next tile's buffer line, 6 m in. */
const CLIPPED = building([
  [0, 0],
  [6, 0],
  [6, 10],
  [0, 10],
]);

describe('withoutTileCopies — #3047', () => {
  it('keeps the first of two whole copies', () => {
    const kept = withoutTileCopies([HOUSE, REGRIDDED]);
    expect(kept).toEqual([HOUSE]);
    expect(withoutTileCopies([REGRIDDED, HOUSE])).toEqual([REGRIDDED]);
  });

  it('keeps the whole one of a whole and a clipped copy, whichever is first', () => {
    expect(withoutTileCopies([CLIPPED, HOUSE])).toEqual([HOUSE]);
    expect(withoutTileCopies([HOUSE, CLIPPED])).toEqual([HOUSE]);
    expect(withoutTileCopies([CLIPPED, REGRIDDED, HOUSE])).toHaveLength(1);
  });

  it('keeps the order of everything else, and hands back the same array when nothing is a copy', () => {
    const away = building([
      [100, 0],
      [110, 0],
      [110, 8],
      [100, 8],
    ]);
    expect(withoutTileCopies([away, CLIPPED, HOUSE])).toEqual([away, HOUSE]);
    const none = [HOUSE, away];
    expect(withoutTileCopies(none)).toBe(none);
  });

  it('carries a POI the left-out copy was matched to over to the one kept', () => {
    const shop = { ...CLIPPED, poi: 'shop' as const };
    const [kept] = withoutTileCopies([HOUSE, shop]);
    expect(kept?.poi).toBe('shop');
    expect(kept?.rings).toBe(HOUSE.rings);
    // control: the one kept keeps its own.
    expect(withoutTileCopies([{ ...HOUSE, poi: 'cafe' }, shop])[0]?.poi).toBe('cafe');
  });

  it('control: keeps a neighbour that shares a wall with it', () => {
    const next = building([
      [14, 0],
      [28, 0],
      [28, 10],
      [14, 10],
    ]);
    expect(withoutTileCopies([HOUSE, next])).toHaveLength(2);
  });

  it('control: keeps a footprint inside another whose far side is off its ring', () => {
    const shed = building([
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ]);
    expect(withoutTileCopies([HOUSE, shed])).toHaveLength(2);
  });

  it('control: keeps one whose vertices are all on the ring but whose edges cross outside it', () => {
    // An L, and a triangle across its notch from the inner corner's two arms.
    const ell = building([
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ]);
    const across = building([
      [10, 2],
      [4, 4],
      [2, 10],
    ]);
    expect(withoutTileCopies([ell, across])).toHaveLength(2);
  });

  it('control: keeps a copy whose tags differ — a part over its building', () => {
    const part = { ...CLIPPED, kind: 'building_part' as const, heightMetres: 8 };
    expect(withoutTileCopies([HOUSE, part])).toHaveLength(2);
    expect(withoutTileCopies([HOUSE, { ...CLIPPED, levels: 3 }])).toHaveLength(2);
  });

  it('keeps both where each tile clipped it, neither holding the other (the limit it states)', () => {
    const west = building([
      [0, 0],
      [9, 0],
      [9, 10],
      [0, 10],
    ]);
    const east = building([
      [5, 0],
      [14, 0],
      [14, 10],
      [5, 10],
    ]);
    expect(withoutTileCopies([west, east])).toHaveLength(2);
  });

  it('holds its work to the budget: stacked copies of a hostile 4,096-vertex footprint are kept, fast', () => {
    // The review of #3060: unbounded, 48 of these took 234 s; a dozen at 4,096 is minutes.
    const ring = Float32Array.from(
      Array.from({ length: 4_096 }, (_, i) => {
        const angle = (i / 4_096) * 2 * Math.PI;
        return [20 * Math.cos(angle), 20 * Math.sin(angle)];
      }).flat(),
    );
    const stacked = Array.from({ length: 12 }, () => building([], { rings: [ring] }));
    expect(withoutTileCopies(stacked)).toHaveLength(12);
  });

  it('keeps every footprint as it is once the budget is spent, and dedupes while it lasts', () => {
    // A pair of 4-vertex houses costs 6 · 4 · 4 = 96 units and a candidate, and each is tested once.
    expect(withoutTileCopies([HOUSE, REGRIDDED], 97)).toEqual([HOUSE]);
    expect(withoutTileCopies([HOUSE, REGRIDDED], 96)).toHaveLength(2);
    expect(TILE_COPY_WORK_PER_FOOTPRINT).toBe(20_000);
  });
});
