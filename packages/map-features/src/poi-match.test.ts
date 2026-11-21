// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { matchPoisToBuildings, type PoiPoint } from './poi-match';
import { NO_BUILDING_FIELDS, POI_REACH_METRES } from './schema';
import type { BuildingFeature } from './types';

/** A footprint of the given rings, each `[x0, z0, x1, z1]` an axis-aligned box in metres. */
function footprint(
  boxes: readonly (readonly [number, number, number, number])[],
  kind: BuildingFeature['kind'] = 'building',
): BuildingFeature {
  return {
    kind,
    heightMetres: null,
    minHeightMetres: null,
    ...NO_BUILDING_FIELDS,
    rings: boxes.map(([x0, z0, x1, z1]) => Float32Array.of(x0, z0, x1, z0, x1, z1, x0, z1)),
  };
}

const at = (poi: PoiPoint['poi'], x: number, z: number): PoiPoint => ({ poi, x, z });

describe('matchPoisToBuildings (#2975)', () => {
  it('a POI inside a footprint is its, whatever its class', () => {
    for (const poi of ['shop', 'cafe', 'fuel'] as const) {
      const [got] = matchPoisToBuildings([footprint([[0, 0, 10, 10]])], [at(poi, 5, 5)]);
      expect(got?.poi).toBe(poi);
    }
  });

  it('outside every footprint, a shop or a café is its nearest’s within 3 m and no farther', () => {
    const reach = POI_REACH_METRES.shop;
    expect(reach).toBe(3);
    for (const poi of ['shop', 'cafe'] as const) {
      const near = matchPoisToBuildings(
        [footprint([[0, 0, 10, 10]])],
        [at(poi, 5, 10 + reach - 0.1)],
      );
      expect(near[0]?.poi).toBe(poi);
      const far = matchPoisToBuildings(
        [footprint([[0, 0, 10, 10]])],
        [at(poi, 5, 10 + reach + 0.1)],
      );
      expect(far[0]?.poi).toBeUndefined();
    }
  });

  it('a fuel station’s forecourt is the nearest footprint’s within 30 m, and no farther', () => {
    expect(POI_REACH_METRES.fuel).toBe(30);
    const kiosk = footprint([[0, 0, 10, 10]]);
    const house = footprint([[0, 50, 10, 60]]);
    // 20 m from the kiosk, 30 m from the house: the kiosk.
    expect(matchPoisToBuildings([house, kiosk], [at('fuel', 5, -20)]).map((b) => b.poi)).toEqual([
      undefined,
      'fuel',
    ]);
    // Nearer the house, still inside both reaches: the house.
    expect(matchPoisToBuildings([house, kiosk], [at('fuel', 5, 35)]).map((b) => b.poi)).toEqual([
      'fuel',
      undefined,
    ]);
    expect(matchPoisToBuildings([kiosk], [at('fuel', 5, -30.1)])[0]?.poi).toBeUndefined();
    expect(matchPoisToBuildings([kiosk], [at('fuel', 5, -29.9)])[0]?.poi).toBe('fuel');
  });

  it('a POI in a courtyard is not the footprint’s, unless it is within reach of the courtyard’s wall', () => {
    const courtyard = footprint([
      [0, 0, 40, 40],
      [10, 10, 30, 30],
    ]);
    expect(matchPoisToBuildings([courtyard], [at('shop', 20, 20)])[0]?.poi).toBeUndefined();
    expect(matchPoisToBuildings([courtyard], [at('shop', 20, 11)])[0]?.poi).toBe('shop');
  });

  it('a fuel station outranks a café, which outranks a shop, in either order', () => {
    const one = (pois: readonly PoiPoint[]) =>
      matchPoisToBuildings([footprint([[0, 0, 10, 10]])], pois)[0]?.poi;
    expect(one([at('shop', 2, 2), at('cafe', 3, 3)])).toBe('cafe');
    expect(one([at('cafe', 3, 3), at('shop', 2, 2)])).toBe('cafe');
    expect(one([at('fuel', 2, 2), at('cafe', 3, 3), at('shop', 4, 4)])).toBe('fuel');
    expect(one([at('shop', 4, 4), at('cafe', 3, 3), at('fuel', 2, 2)])).toBe('fuel');
  });

  it('never gives a building_part one: its building, which holds the POI too, takes it', () => {
    const part = footprint([[2, 2, 8, 8]], 'building_part');
    const building = footprint([[0, 0, 10, 10]]);
    expect(matchPoisToBuildings([part, building], [at('shop', 5, 5)]).map((b) => b.poi)).toEqual([
      undefined,
      'shop',
    ]);
    expect(matchPoisToBuildings([part], [at('shop', 5, 5)])[0]?.poi).toBeUndefined();
  });

  it('two footprints across a grid cell’s edge are both found, each POI matched to its own', () => {
    // 32 m cells: one footprint either side of x = 32, and one spanning three cells.
    const west = footprint([[20, 0, 30, 10]]);
    const east = footprint([[34, 0, 44, 10]]);
    const long = footprint([[-40, 40, 70, 50]]);
    const got = matchPoisToBuildings(
      [west, east, long],
      [at('shop', 31, 5), at('cafe', 33, 5), at('fuel', 68, 45)],
    );
    expect(got.map((b) => b.poi)).toEqual(['shop', 'cafe', 'fuel']);
  });

  it('returns the unmatched footprints as the same objects, in order, with no `poi` key', () => {
    const a = footprint([[0, 0, 10, 10]]);
    const b = footprint([[100, 0, 110, 10]]);
    const got = matchPoisToBuildings([a, b], [at('shop', 105, 5)]);
    expect(got[0]).toBe(a);
    expect('poi' in (got[0] as object)).toBe(false);
    expect(got[1]).not.toBe(b);
    expect(got[1]).toStrictEqual({ ...b, poi: 'shop' });
    expect(matchPoisToBuildings([a, b], [])).toEqual([a, b]);
  });
});
