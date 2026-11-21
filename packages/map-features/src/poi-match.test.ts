// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { MAX_POI_MATCH_WORK } from './limits';
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

/** A footprint of one `vertices`-vertex ring of `radius` metres about the origin. */
function round(vertices: number, radius: number): BuildingFeature {
  const ring = new Float32Array(vertices * 2);
  for (let v = 0; v < vertices; v++) {
    ring[v * 2] = radius * Math.cos((2 * Math.PI * v) / vertices);
    ring[v * 2 + 1] = radius * Math.sin((2 * Math.PI * v) / vertices);
  }
  return { ...footprint([]), rings: [ring] };
}

describe('matchPoisToBuildings stays inside its work budget (#2975, the review of #2996)', () => {
  // 48 stacked 8,000-vertex footprints: every POI at their middle walks
  // 384,000 vertices, so the default budget runs out within `shops` POIs.
  const perPoi = 48 * 8_000;
  const shops = Math.ceil(MAX_POI_MATCH_WORK / perPoi);
  const stack = Array.from({ length: 48 }, () => round(8_000, 300));
  const pois = [
    ...Array.from({ length: shops }, () => at('shop', 0, 0)),
    ...Array.from({ length: 50 }, () => at('fuel', 0, 0)),
  ];

  it('stops at the budget: the matches made stand, the POIs after are dropped, nothing throws', () => {
    // Not vacuous: 50 fuel stations would be far more work than the budget.
    expect(perPoi * 50).toBeGreaterThan(MAX_POI_MATCH_WORK);
    const got = matchPoisToBuildings(stack, pois);
    // The shops were matched to the first footprint; no fuel station was read.
    expect(got[0]?.poi).toBe('shop');
    expect(got.slice(1).every((b) => b.poi === undefined)).toBe(true);
    // The footprints themselves stand, every one.
    expect(got).toHaveLength(48);
  });

  it('control: with no budget, a fuel station is read and outranks the shops', () => {
    expect(matchPoisToBuildings(stack, pois, Number.POSITIVE_INFINITY)[0]?.poi).toBe('fuel');
  });

  it('a budget spent before any POI is looked at matches nothing', () => {
    const got = matchPoisToBuildings([footprint([[0, 0, 10, 10]])], [at('shop', 5, 5)], 0);
    expect(got[0]?.poi).toBeUndefined();
    expect(
      matchPoisToBuildings([footprint([[0, 0, 10, 10]])], [at('shop', 5, 5)], 100)[0]?.poi,
    ).toBe('shop');
  });

  it('bucketing counts against the budget: a footprint over 121 cells costs 968 units first', () => {
    // 320 m a side from 0 is 11 cells of 32 m each way; a cell is 8 units.
    const square = footprint([[0, 0, 320, 320]]);
    const poi = [at('shop', 5, 5)];
    expect(matchPoisToBuildings([square], poi, 900)[0]?.poi).toBeUndefined();
    // The POI itself is 1 footprint and 4 vertices more.
    expect(matchPoisToBuildings([square], poi, 968 + 5)[0]?.poi).toBe('shop');
    expect(matchPoisToBuildings([square], poi, 968 + 4)[0]?.poi).toBeUndefined();
  });
});

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
