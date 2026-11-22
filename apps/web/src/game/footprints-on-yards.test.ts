// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A mapped footprint touching a yard is built — #2696, ADR 0054's entry of
 * 2026-11-19 (proposed). Read through `footprintPlans`' verdicts, the path a
 * ride's press takes: a house with one corner on its own mapped `garden`, on
 * a strip of `grass`, on a `village_green` or on `allotments` is kept; the
 * same house with that corner on a mapped `park`, or inside a garden that is
 * itself inside a park, is dropped as D-5.2 drops it, and so is one in a wood.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingFeature, LandUseFeature } from '@onyourleft/map-features';

import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { footprintPlans, FOOTPRINT_VERDICTS, type FootprintVerdict } from './footprint-buildings';
import { landClassMask, parkProperNear, YARD_KINDS } from './land-class';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Three kilometres of level road due north. */
const ROAD = northRoute(3_000, () => 10);
const ORIGIN = corridorOrigin(ROAD);

/** A 12 by 10 m house at 1 200 m, 30 m to 40 m off the road. */
const HOUSE: BuildingFeature = buildingBeside(ROAD, ORIGIN, [rectangleBeside(1_200, 35, 12, 10)]);

const land = (kind: string, from: number, to: number, near: number, far: number): LandUseFeature =>
  landBeside(ROAD, ORIGIN, 'landuse', kind, from, to, near, far);

/** The street's residential land, everywhere the house stands. */
const RESIDENTIAL = land('residential', 1_000, 1_400, 8, 200);

/** A plot beside the house that its far corner (1 206 m, 40 m) stands 5 m and 6 m into. */
function plot(kind: string): LandUseFeature {
  return land(kind, 1_201, 1_230, 34, 70);
}

function corridorOf(...landUse: LandUseFeature[]): WorldCorridor {
  return {
    routeId: 'footprints-on-yards',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse,
    buildings: [HOUSE],
    paths: [],
    streets: [],
  };
}

function verdictOf(corridor: WorldCorridor): FootprintVerdict {
  const { verdicts } = footprintPlans(corridor, landClassMask(corridor), ROAD, ORIGIN);
  return FOOTPRINT_VERDICTS.find((verdict) => verdicts[verdict] > 0) as FootprintVerdict;
}

describe('a mapped footprint touching a yard — #2696', () => {
  it('names the four yard kinds, and only those', () => {
    expect([...YARD_KINDS].sort()).toStrictEqual([
      'allotments',
      'garden',
      'grass',
      'village_green',
    ]);
  });

  it('control: on residential land alone, the house is kept', () => {
    expect(verdictOf(corridorOf(RESIDENTIAL))).toBe('kept');
  });

  it('keeps the house with a corner on its garden, a lawn, a village green or allotments', () => {
    for (const kind of YARD_KINDS) {
      const corridor = corridorOf(RESIDENTIAL, plot(kind));
      // The mask still reads that corner as park: the yard is mown, never fenced.
      expect([kind, landClassMask(corridor).classAt(...cornerOf())]).toEqual([kind, 'park']);
      expect([kind, verdictOf(corridor)]).toEqual([kind, 'kept']);
    }
  });

  it('drops the same house with that corner on a park, or in a wood — ADR 0054 D-5.2 stands', () => {
    for (const kind of ['park', 'recreation_ground', 'golf_course', 'cemetery', 'wood']) {
      expect([kind, verdictOf(corridorOf(RESIDENTIAL, plot(kind)))]).toEqual([
        kind,
        'on-excluded-land',
      ]);
    }
  });

  it('drops a house whose garden is itself inside a park', () => {
    const park = land('park', 1_100, 1_300, 8, 120);
    expect(verdictOf(corridorOf(RESIDENTIAL, park, plot('garden')))).toBe('on-excluded-land');
  });

  it('reads a park that is not a yard half a mask cell round a point, and a yard never', () => {
    const corridor = corridorOf(RESIDENTIAL, plot('garden'), land('park', 1_300, 1_340, 38, 70));
    const [x, z] = cornerOf();
    expect(parkProperNear(corridor, x, z)).toBe(false);
    const [px, pz] = beside(1_320, 50);
    expect(parkProperNear(corridor, px, pz)).toBe(true);
    // 2 m outside the park's near edge, within half a 5 m cell of it.
    const [ex, ez] = beside(1_320, 36.5);
    expect(parkProperNear(corridor, ex, ez)).toBe(true);
    const [fx, fz] = beside(1_320, 30);
    expect(parkProperNear(corridor, fx, fz)).toBe(false);
    // A park too big for the grid's cells (3 by 14 km) is read from every cell.
    const huge = corridorOf(land('park', 10, 2_990, -7_000, 7_000));
    expect(parkProperNear(huge, x, z)).toBe(true);
  });
});

/** Local `(x, z)` of `(along, lateral)`, as the fixtures place them. */
function beside(along: number, lateral: number): [number, number] {
  const ring = land('probe', along, along + 1, lateral, lateral + 1).rings[0] as Float32Array;
  return [ring[0] as number, ring[1] as number];
}

/** The house's far corner, the one that stands on the plot. */
function cornerOf(): [number, number] {
  return beside(1_206, 40);
}
