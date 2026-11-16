// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2684, ADR 0070: houses in a suburb that maps streets and nothing else.
 * Many US suburbs carry neither building footprints nor `landuse=residential`
 * in OpenStreetMap, so the ground reads `other` and the realistic world drew
 * open country where the HUD map shows a dense grid of residential streets.
 * `land-class.ts` §`inferBuiltUp` now reads such ground as built-up, near a
 * residential street where the streets are as dense as a suburb's.
 *
 * Asserted through the paths a ride takes: the mask's `classAt`, which every
 * placement rule reads, and `sceneFrame` over the realistic structure cap,
 * which is what a frame draws. Each rule beside its control. The fixtures are
 * arithmetic in local metres (`footprint-fixtures-testing.ts`): nothing here
 * is a real place, and no OpenStreetMap data.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import { footprintPlans, FOOTPRINT_MAX_VERTICES, mappedTown } from './footprint-buildings';
import {
  besideRoad,
  farmRoadFixture,
  landBeside,
  STREET_SUBURB_FROM,
  STREET_SUBURB_TO,
  streetBeside,
  streetSuburbFixture,
} from './footprint-fixtures-testing';
import {
  INFERRED_MIN_STREET_DENSITY,
  INFERRED_REACH_METRES,
  landClassMask,
  LAND_CLASS_MAX_BYTES,
  LAND_CLASS_MAX_WORK,
  LEVELLING_MAX_CHUNKS,
  type LandClass,
  type LandClassMask,
} from './land-class';
import { REALISTIC_STRUCTURE_ITEMS } from './realistic-budget';
import type { ScatterItem } from './scatter';
import { STRUCTURE_MAX_ITEMS } from './settlements';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import type { CorridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

type Fixture = ReturnType<typeof streetSuburbFixture>;

/** The class `lateral` metres off the road at `along`. */
function classBeside(
  fixture: Fixture,
  land: LandClassMask,
  along: number,
  lateral: number,
): LandClass {
  const [x, z] = besideRoad(fixture.profile, fixture.origin, along, lateral);
  return land.classAt(x, z);
}

/** Every class a lot's ground could read in the suburb: 12 m and 20 m out, both sides, every 20 m. */
function lotGround(fixture: Fixture, land: LandClassMask, from: number, to: number): LandClass[] {
  const classes: LandClass[] = [];
  for (let along = from; along < to; along += 20) {
    for (const lateral of [-20, -12, 12, 20])
      classes.push(classBeside(fixture, land, along, lateral));
  }
  return classes;
}

/** How many built-up cells the whole fixture's corridor holds, every 5 m. */
function builtUpCells(fixture: Fixture, land: LandClassMask): number {
  let count = 0;
  for (let along = 5; along < 3_000; along += 5) {
    for (let lateral = -300; lateral <= 300; lateral += 5) {
      if (classBeside(fixture, land, along, lateral) === 'built-up') count += 1;
    }
  }
  return count;
}

const HOUSES = new Set(['building', 'shop-row']);
const BOUNDARIES = new Set(['wall', 'hedge', 'fence']);

/** A frame of a ride `distance` metres in, as `GameView` builds one in the realistic world. */
function frameAt(
  fixture: Fixture,
  distance: number,
  land: LandClassMask = landClassMask(fixture.corridor),
  structureItems: number = REALISTIC_STRUCTURE_ITEMS,
) {
  const { profile, origin, corridor } = fixture;
  const urban = urbanClassMap(corridor, land, profile);
  const { plans } = footprintPlans(corridor, land, profile, origin, FOOTPRINT_MAX_VERTICES, urban);
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    worldCorridor: corridor,
    landClass: land,
    mappedTown: mappedTown(corridor, plans, urban),
    structureItems,
  });
}

function housesOf(scatter: readonly ScatterItem[]): readonly ScatterItem[] {
  return scatter.filter((item) => HOUSES.has(item.kind));
}

/** With every rule of the mask at its default but inference given no work: the mask before #2684. */
function maskWithoutInference(corridor: WorldCorridor): LandClassMask {
  return landClassMask(
    corridor,
    LAND_CLASS_MAX_BYTES,
    LAND_CLASS_MAX_WORK,
    LEVELLING_MAX_CHUNKS,
    0,
  );
}

/** A land-use polygon from `from` to `to` along the suburb, `near` to `far` out on the right. */
function polygon(kind: string, layer: LandUseFeature['layer'] = 'landuse') {
  return (profile: RouteProfile, origin: CorridorOrigin): readonly LandUseFeature[] => [
    landBeside(profile, origin, layer, kind, 1_400, 1_800, -5, 60),
  ];
}

describe('inferred built-up land: a suburb of streets with no footprints and no land use — #2684', () => {
  const suburb = streetSuburbFixture();
  const land = landClassMask(suburb.corridor);

  it('reads the ground beside its streets as built-up, and open ground before it as other', () => {
    const inside = lotGround(suburb, land, STREET_SUBURB_FROM + 100, STREET_SUBURB_TO - 100);
    expect(inside.length).toBeGreaterThan(200);
    expect(inside.filter((here) => here !== 'built-up')).toEqual([]);
    // Before the streets: the open ground the realistic world drew there before.
    expect(lotGround(suburb, land, 200, 800).filter((here) => here !== 'other')).toEqual([]);
    // The control: the same corridor with no inference is `other` throughout.
    const before = maskWithoutInference(suburb.corridor);
    expect(builtUpCells(suburb, before)).toBe(0);
  });

  it('reaches INFERRED_REACH_METRES from a street, and no further', () => {
    // The outermost parallel street is 180 m out and the cross streets end at 240 m.
    expect(classBeside(suburb, land, 1_700, 240 + INFERRED_REACH_METRES - 10)).toBe('built-up');
    expect(classBeside(suburb, land, 1_700, 240 + INFERRED_REACH_METRES + 10)).toBe('other');
    expect(classBeside(suburb, land, STREET_SUBURB_TO + INFERRED_REACH_METRES + 10, 0)).toBe(
      'other',
    );
    // Measured from the street, not its box: past a cross street's end at
    // 1 720 m and 240 m out, 42 m on the diagonal is near and 71 m is not.
    expect(classBeside(suburb, land, 1_720 + 30, 240 + 30)).toBe('built-up');
    expect(classBeside(suburb, land, 1_720 + 50, 240 + 50)).toBe('other');
  });

  it('measures a diagonal street along its whole length, not about its start', () => {
    // The same road through a lattice of streets at 45° to it, 90 m apart
    // each way, each one 849 m long: the road crosses one every 64 m.
    const streets = [];
    for (let along = 400; along <= 2_400; along += 90) {
      for (const turn of [1, -1]) {
        streets.push(
          streetBeside(
            suburb.profile,
            suburb.origin,
            [
              [along, -300 * turn],
              [along + 600, 300 * turn],
            ],
            'residential',
          ),
        );
      }
    }
    const lattice = { ...suburb, corridor: { ...suburb.corridor, streets } };
    const ground = lotGround(lattice, landClassMask(lattice.corridor), 1_300, 2_100);
    expect(ground.filter((here) => here !== 'built-up')).toEqual([]);
  });

  it('draws houses along its road through the real scene, and no field boundary beside them', () => {
    const frame = frameAt(suburb, 1_700);
    const houses = housesOf(frame.scatter);
    expect(houses.length).toBeGreaterThan(10);
    // At the suburb's edge, with every structure the stylised rung keeps, so
    // a boundary the cap hides is still seen: the fields before the streets
    // are fenced, and no boundary stands among the houses.
    const whole = frameAt(suburb, STREET_SUBURB_FROM - 200, land, STRUCTURE_MAX_ITEMS);
    expect(housesOf(whole.scatter).length).toBeGreaterThan(5);
    expect(whole.scatter.filter((item) => BOUNDARIES.has(item.kind)).length).toBeGreaterThan(0);
    for (const house of housesOf(whole.scatter)) {
      for (const item of whole.scatter) {
        if (!BOUNDARIES.has(item.kind)) continue;
        expect(Math.hypot(item.x - house.x, item.z - house.z)).toBeGreaterThan(30);
      }
    }
    // The control: the frame before #2684 drew the fields and no house.
    const before = frameAt(suburb, 1_700, maskWithoutInference(suburb.corridor));
    expect(housesOf(before.scatter)).toEqual([]);
    expect(before.scatter.filter((item) => BOUNDARIES.has(item.kind)).length).toBeGreaterThan(0);
  });
});

describe('the rural control: a farm road with a house every few hundred metres — #2684', () => {
  const farm = farmRoadFixture();
  const land = landClassMask(farm.corridor);

  it('stays open country: no cell is inferred, and no house is drawn', () => {
    // The fixture at its crossroads: 560 m of road and 500 m of crossroad in
    // the 31.36 ha window, 34 street metres a hectare — a rural road's, short of a suburb's.
    expect(INFERRED_MIN_STREET_DENSITY).toBeGreaterThan(34);
    expect(builtUpCells(farm, land)).toBe(0);
    for (const distance of [400, 1_500, 2_600]) {
      expect(housesOf(frameAt(farm, distance, land).scatter), `at ${String(distance)}`).toEqual([]);
    }
  });
});

describe('what inference never reads as built-up — #2684', () => {
  it('leaves farmland, meadow, wood, water and park their own class', () => {
    for (const [kind, layer, held] of [
      ['farmland', 'landuse', 'farmland'],
      ['meadow', 'landuse', 'farmland'],
      ['wood', 'landuse', 'wood'],
      ['park', 'landuse', 'park'],
      ['golf_course', 'landuse', 'park'],
      ['lake', 'water', 'water'],
    ] as const) {
      const fixture = streetSuburbFixture('residential', 'ground', polygon(kind, layer));
      const land = landClassMask(fixture.corridor);
      expect(classBeside(fixture, land, 1_600, 20), kind).toBe(held);
      // Outside the polygon the suburb is still inferred: the control.
      expect(classBeside(fixture, land, 1_600, -20), kind).toBe('built-up');
    }
  });

  it('leaves a polygon that classes other alone — an aerodrome, a beach — but not Protomaps’ own `other`', () => {
    for (const kind of ['aerodrome', 'beach', 'heath']) {
      const fixture = streetSuburbFixture('residential', 'ground', polygon(kind));
      const land = landClassMask(fixture.corridor);
      expect(classBeside(fixture, land, 1_600, 20), kind).toBe('other');
      expect(classBeside(fixture, land, 1_600, -20), kind).toBe('built-up');
    }
    const neighbourhood = streetSuburbFixture('residential', 'ground', polygon('other'));
    expect(classBeside(neighbourhood, landClassMask(neighbourhood.corridor), 1_600, 20)).toBe(
      'built-up',
    );
  });

  it('keeps a wood a wood where a beach is drawn over it, as before', () => {
    const fixture = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'wood', 1_400, 1_800, -5, 60),
      landBeside(profile, origin, 'landuse', 'beach', 1_400, 1_800, -5, 60),
    ]);
    const land = landClassMask(fixture.corridor);
    expect(classBeside(fixture, land, 1_600, 20)).toBe('wood');
    // And a beach drawn over farmland leaves it farmland.
    const field = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'beach', 1_400, 1_800, -5, 60),
      landBeside(profile, origin, 'landuse', 'farmland', 1_400, 1_800, -5, 60),
    ]);
    expect(classBeside(field, landClassMask(field.corridor), 1_600, 20)).toBe('farmland');
  });

  it('counts residential and living streets, and neither service roads alone nor tunnels', () => {
    const living = streetSuburbFixture('living_street');
    expect(builtUpCells(living, landClassMask(living.corridor))).toBeGreaterThan(0);
    // A car park's aisles are `service`: near enough to stand a house by, never a suburb's density.
    const aisles = streetSuburbFixture('service');
    expect(builtUpCells(aisles, landClassMask(aisles.corridor))).toBe(0);
    const tunnels = streetSuburbFixture('residential', 'tunnel');
    expect(builtUpCells(tunnels, landClassMask(tunnels.corridor))).toBe(0);
    const unclassified = streetSuburbFixture('unclassified');
    expect(builtUpCells(unclassified, landClassMask(unclassified.corridor))).toBe(0);
  });

  it('infers nothing where the polygon pass ran out of work, so an unpainted wood is never a suburb', () => {
    const fixture = streetSuburbFixture('residential', 'ground', polygon('wood'));
    const short = landClassMask(fixture.corridor, LAND_CLASS_MAX_BYTES, 1);
    expect(builtUpCells(fixture, short)).toBe(0);
  });

  it('stops at its own work cap, and infers nothing past it', () => {
    // 1 000 cell tests: the density takes 672 (13 440 street metres in 20 m
    // pieces), which leaves 328 for the cells — a few rows of the first street.
    const suburb = streetSuburbFixture();
    const capped = landClassMask(
      suburb.corridor,
      LAND_CLASS_MAX_BYTES,
      LAND_CLASS_MAX_WORK,
      LEVELLING_MAX_CHUNKS,
      1_000,
    );
    const whole = builtUpCells(suburb, landClassMask(suburb.corridor));
    expect(builtUpCells(suburb, capped)).toBeLessThanOrEqual(328);
    expect(whole).toBeGreaterThan(10_000);
  });
});
