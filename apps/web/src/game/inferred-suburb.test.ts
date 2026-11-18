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
import type {
  BuildingFeature,
  LandUseFeature,
  PlaceFeature,
  StreetFeature,
} from '@onyourleft/map-features';

import { footprintPlans, FOOTPRINT_MAX_VERTICES, mappedTown } from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  rectangleBeside,
  farmRoadFixture,
  landBeside,
  STREET_SUBURB_FROM,
  STREET_SUBURB_TO,
  streetBeside,
  streetSuburbFixture,
} from './footprint-fixtures-testing';
import {
  INFERRED_EDGE_BUILT_SHARE,
  INFERRED_EDGE_FOOTPRINTS,
  INFERRED_HAMLET_REACH_METRES,
  INFERRED_MIN_JOINS_PER_HECTARE,
  INFERRED_MIN_STREET_DENSITY,
  INFERRED_PLACE_REACH_METRES,
  INFERRED_REACH_METRES,
  INFERRED_RURAL_FARMLAND_SHARE,
  landClassMask,
  nearestPlace,
  suburbCues,
  LAND_CLASS_MAX_BYTES,
  landClassWork,
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
    landClassWork(corridor),
    LEVELLING_MAX_CHUNKS,
    0,
  );
}

function suburbPlace(x: number, z: number, kindDetail: PlaceFeature['kindDetail'] = 'suburb') {
  return {
    kind: kindDetail === 'suburb' ? 'neighbourhood' : 'locality',
    kindDetail,
    populationRank: 5,
    x,
    z,
  } as const satisfies PlaceFeature;
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
    // Diagonals share no node, so no join is counted: a suburban place near stands for the grid.
    const [placeX, placeZ] = besideRoad(suburb.profile, suburb.origin, 1_700, 0);
    const lattice = {
      ...suburb,
      corridor: {
        ...suburb.corridor,
        streets,
        places: [suburbPlace(placeX, placeZ)],
      },
    };
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
    // Integration with #2662: an aerodrome and a beach class `bare` now, a
    // class of their own, and are still never inferred built-up.
    for (const [kind, held] of [
      ['aerodrome', 'bare'],
      ['beach', 'bare'],
      ['heath', 'other'],
    ] as const) {
      const fixture = streetSuburbFixture('residential', 'ground', polygon(kind));
      const land = landClassMask(fixture.corridor);
      expect(classBeside(fixture, land, 1_600, 20), kind).toBe(held);
      expect(classBeside(fixture, land, 1_600, -20), kind).toBe('built-up');
    }
    const neighbourhood = streetSuburbFixture('residential', 'ground', polygon('other'));
    expect(classBeside(neighbourhood, landClassMask(neighbourhood.corridor), 1_600, 20)).toBe(
      'built-up',
    );
  });

  // Integration with #2662: a beach is `bare` now, which outranks farmland, so
  // the mapped-`other` case is a heath.
  it('keeps a wood a wood where a heath is drawn over it, as before', () => {
    const fixture = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'wood', 1_400, 1_800, -5, 60),
      landBeside(profile, origin, 'landuse', 'heath', 1_400, 1_800, -5, 60),
    ]);
    const land = landClassMask(fixture.corridor);
    expect(classBeside(fixture, land, 1_600, 20)).toBe('wood');
    // And a heath drawn over farmland leaves it farmland.
    const field = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'heath', 1_400, 1_800, -5, 60),
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
    // Two polygons, the first of which uses the whole budget: the second is
    // never painted, and the cells it would have held are not read as open land.
    const fixture = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      ...polygon('wood')(profile, origin),
      ...polygon('wood')(profile, origin),
    ]);
    const short = landClassMask(fixture.corridor, LAND_CLASS_MAX_BYTES, 1);
    expect(builtUpCells(fixture, short)).toBe(0);
  });

  it('infers where the last polygon used the whole budget: every polygon was painted', () => {
    const fixture = streetSuburbFixture('residential', 'ground', polygon('wood'));
    for (const budget of [1, 2, 50, 500, 5_000]) {
      const exact = landClassMask(fixture.corridor, LAND_CLASS_MAX_BYTES, budget);
      expect(classBeside(fixture, exact, 1_600, -20), String(budget)).toBe('built-up');
    }
  });

  it('stops at its own work cap: cells inferred before it are kept, and the rest are not', () => {
    // 500 000 cell tests: the streets, the chunk scan (about 330 000) and the
    // first rows of cells — a part of the whole 35 060, never the whole, never none.
    const suburb = streetSuburbFixture();
    const capped = landClassMask(
      suburb.corridor,
      LAND_CLASS_MAX_BYTES,
      landClassWork(suburb.corridor),
      LEVELLING_MAX_CHUNKS,
      500_000,
    );
    const whole = builtUpCells(suburb, landClassMask(suburb.corridor));
    expect(builtUpCells(suburb, capped)).toBeGreaterThan(0);
    expect(builtUpCells(suburb, capped)).toBeLessThan(whole);
    // And one that cannot even read the map is today's world.
    const starved = landClassMask(
      suburb.corridor,
      LAND_CLASS_MAX_BYTES,
      landClassWork(suburb.corridor),
      LEVELLING_MAX_CHUNKS,
      1_000,
    );
    expect(builtUpCells(suburb, starved)).toBe(0);
  });

  it('skips a hostile segment past the grid instead of giving up the ride', () => {
    const suburb = streetSuburbFixture();
    const hostile: StreetFeature = {
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: Float32Array.from([0, 0, 1e12, 1e12]),
    };
    const corrupt = {
      ...suburb,
      corridor: { ...suburb.corridor, streets: [hostile, ...suburb.corridor.streets] },
    };
    expect(builtUpCells(corrupt, landClassMask(corrupt.corridor))).toBe(
      builtUpCells(suburb, landClassMask(suburb.corridor)),
    );
  });
});

describe('the density threshold, either side of 45 street metres a hectare — #2684', () => {
  // A spine along the route with a street across it at every 80 m density
  // cell, `half` metres either side: 7 across in a 560 m window, so the
  // window holds 560 + 7 x 2 x half street metres, and 31.36 ha.
  function ladder(half: number): Fixture {
    const base = streetSuburbFixture();
    const { profile, origin } = base;
    const streets: StreetFeature[] = [];
    const stations: number[] = [];
    for (let along = 1_000 + 40; along < 2_000; along += 80) stations.push(along);
    streets.push(
      streetBeside(
        profile,
        origin,
        [[1_000, 0], ...stations.map((along) => [along, 0] as const), [2_000, 0]],
        'residential',
      ),
    );
    for (const along of stations) {
      streets.push(
        streetBeside(
          profile,
          origin,
          [
            [along, -half],
            [along, 0],
            [along, half],
          ],
          'residential',
        ),
      );
    }
    // A suburban place near stands for every other cue: only the density varies.
    const [placeX, placeZ] = besideRoad(profile, origin, 1_500, 0);
    return {
      ...base,
      corridor: { ...base.corridor, streets, places: [suburbPlace(placeX, placeZ)] },
    };
  }

  it('is a suburb at about 51 and open ground at about 38', () => {
    // The middle window: 560 + 14 x 75 = 1 610 m over 31.36 ha is 51.3, and
    // 560 + 14 x 45 = 1 190 m is 37.9 — the 38 and 50 ADR 0070 D-5 puts 45 between.
    expect(INFERRED_MIN_STREET_DENSITY).toBe(45);
    const dense = ladder(75);
    const thin = ladder(45);
    expect(classBeside(dense, landClassMask(dense.corridor), 1_500, 20)).toBe('built-up');
    expect(classBeside(thin, landClassMask(thin.corridor), 1_500, 20)).toBe('other');
  });
});

describe('suburb or rural: the cues, combined — the owner’s ruling of 2026-11-15 on #2684', () => {
  /** The streets' ground 20 m off the road at 1 600 m. */
  const inferred = (fixture: Fixture): boolean =>
    classBeside(fixture, landClassMask(fixture.corridor), 1_600, -20) === 'built-up';
  const bare = (): Fixture => streetSuburbFixture('residential', 'ground', () => [], false);
  const near = (fixture: Fixture) => besideRoad(fixture.profile, fixture.origin, 1_600, 0);

  it('does not read a dense grid as a suburb on its density alone', () => {
    // The same streets with no node in common: no join, and no other cue.
    expect(inferred(bare())).toBe(false);
    expect(inferred(streetSuburbFixture())).toBe(true);
  });

  it('reads a suburban place near, or mapped footprints near, as a cue for', () => {
    const withPlace = bare();
    const [x, z] = near(withPlace);
    expect(
      inferred({
        ...withPlace,
        corridor: { ...withPlace.corridor, places: [suburbPlace(x, z)] },
      }),
    ).toBe(true);
    const withHouses = bare();
    const buildings: BuildingFeature[] = [];
    for (let i = 0; i < INFERRED_EDGE_FOOTPRINTS; i += 1) {
      buildings.push({
        ...buildingBeside(
          withHouses.profile,
          withHouses.origin,
          [rectangleBeside(1_560 + i * 20, -250, 8, 18)],
          7,
        ),
        buildingType: 'house',
      });
    }
    expect(inferred({ ...withHouses, corridor: { ...withHouses.corridor, buildings } })).toBe(true);
    expect(
      inferred({
        ...withHouses,
        corridor: { ...withHouses.corridor, buildings: buildings.slice(1) },
      }),
    ).toBe(false);
  });

  it('reads farmland near, or a hamlet near, as a cue against, which a cue for cancels', () => {
    const fields = (joined: boolean): Fixture =>
      streetSuburbFixture(
        'residential',
        'ground',
        (profile, origin) => [
          landBeside(profile, origin, 'landuse', 'farmland', 1_300, 1_900, 100, 400),
        ],
        joined,
      );
    // Joined streets and farmland about: one for, one against, net nothing.
    expect(inferred(fields(true))).toBe(false);
    // A suburban place besides: two for, one against.
    const joinedFields = fields(true);
    const [x, z] = near(joinedFields);
    expect(
      inferred({
        ...joinedFields,
        corridor: { ...joinedFields.corridor, places: [suburbPlace(x, z)] },
      }),
    ).toBe(true);
    // A hamlet within reach against the joins: net nothing.
    const hamlet = streetSuburbFixture();
    const [hx, hz] = near(hamlet);
    expect(
      inferred({
        ...hamlet,
        corridor: { ...hamlet.corridor, places: [suburbPlace(hx, hz, 'hamlet')] },
      }),
    ).toBe(false);
  });

  it('draws sparser houses on inferred land than on mapped residential land', () => {
    const mapped = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'residential', 900, 2_600, -400, 400),
    ]);
    const infer = streetSuburbFixture();
    const count = (fixture: Fixture): number =>
      housesOf(frameAt(fixture, 1_700, undefined, STRUCTURE_MAX_ITEMS).scatter).length;
    const onMapped = count(mapped);
    const onInferred = count(infer);
    expect(onInferred).toBeGreaterThan(5);
    expect(onInferred).toBeLessThan(onMapped * 0.7);
  });

  it('tells inferred land from mapped land through inferredAt', () => {
    const suburb = streetSuburbFixture();
    const land = landClassMask(suburb.corridor);
    const [x, z] = besideRoad(suburb.profile, suburb.origin, 1_600, -20);
    expect(land.inferredAt(x, z)).toBe(true);
    const mapped = streetSuburbFixture('residential', 'ground', (profile, origin) => [
      landBeside(profile, origin, 'landuse', 'residential', 900, 2_600, -400, 400),
    ]);
    const [mx, mz] = besideRoad(mapped.profile, mapped.origin, 1_600, -20);
    const mappedLand = landClassMask(mapped.corridor);
    expect(mappedLand.classAt(mx, mz)).toBe('built-up');
    expect(mappedLand.inferredAt(mx, mz)).toBe(false);
    expect(land.inferredAt(Number.NaN, 0)).toBe(false);
  });

  it('levels the ground to inferred land as to mapped: 0 m on it, finite beside it', () => {
    const suburb = streetSuburbFixture();
    const land = landClassMask(suburb.corridor);
    const on = besideRoad(suburb.profile, suburb.origin, 1_600, -20);
    const off = besideRoad(suburb.profile, suburb.origin, 1_600, 240 + INFERRED_REACH_METRES + 40);
    const into = new Float64Array(2);
    land.builtUpDistances(Float64Array.from([...on, ...off]), 2, into);
    expect(into[0]).toBe(0);
    expect(into[1]).toBeGreaterThan(0);
    expect(into[1]).toBeLessThan(150);
  });

  it('suburbCues: each threshold, pinned either side', () => {
    const hectares = 31.36;
    const cells = 49 * 256;
    const base = { metres: 60 * hectares, joins: 0, farmland: 0, mapped: 0, footprints: 0 };
    const joins = (n: number) => ({ ...base, joins: n * hectares, place: 'none' as const });
    expect(suburbCues({ ...joins(INFERRED_MIN_JOINS_PER_HECTARE), place: 'none' })).toBe(true);
    expect(suburbCues({ ...joins(INFERRED_MIN_JOINS_PER_HECTARE - 0.01), place: 'none' })).toBe(
      false,
    );
    const dense = { ...base, place: 'suburban' as const };
    expect(suburbCues({ ...dense, metres: 45 * hectares })).toBe(true);
    expect(suburbCues({ ...dense, metres: 44.9 * hectares })).toBe(false);
    const farm = { ...dense, farmland: INFERRED_RURAL_FARMLAND_SHARE * cells };
    // A suburban place against farmland: one for, one against.
    expect(suburbCues(farm)).toBe(false);
    expect(suburbCues({ ...farm, joins: 99 })).toBe(true);
    expect(suburbCues({ ...farm, farmland: farm.farmland - 1, place: 'none', joins: 99 })).toBe(
      true,
    );
    expect(suburbCues({ ...base, footprints: INFERRED_EDGE_FOOTPRINTS, place: 'none' })).toBe(true);
    expect(suburbCues({ ...base, footprints: INFERRED_EDGE_FOOTPRINTS - 1, place: 'none' })).toBe(
      false,
    );
    expect(suburbCues({ ...base, mapped: INFERRED_EDGE_BUILT_SHARE * cells, place: 'none' })).toBe(
      true,
    );
    expect(
      suburbCues({ ...base, mapped: INFERRED_EDGE_BUILT_SHARE * cells - 1, place: 'none' }),
    ).toBe(false);
    expect(suburbCues({ ...base, place: 'hamlet', joins: 99 })).toBe(false);
  });

  it('nearestPlace: the nearest within reach speaks, a village speaks neither way', () => {
    const at = (kindDetail: PlaceFeature['kindDetail'], x: number) => suburbPlace(x, 0, kindDetail);
    expect(nearestPlace([at('suburb', INFERRED_PLACE_REACH_METRES)], 0, 0)).toBe('suburban');
    expect(nearestPlace([at('suburb', INFERRED_PLACE_REACH_METRES + 1)], 0, 0)).toBe('none');
    expect(nearestPlace([at('hamlet', INFERRED_HAMLET_REACH_METRES)], 0, 0)).toBe('hamlet');
    expect(nearestPlace([at('hamlet', INFERRED_HAMLET_REACH_METRES + 1)], 0, 0)).toBe('none');
    for (const kind of ['town', 'city', 'quarter'] as const) {
      expect(nearestPlace([at(kind, 900)], 0, 0), kind).toBe('suburban');
    }
    // A hamlet nearer than a suburb wins; a village nearer than both hides them.
    expect(nearestPlace([at('suburb', 1_000), at('hamlet', 300)], 0, 0)).toBe('hamlet');
    expect(nearestPlace([at('suburb', 1_000), at('village', 300)], 0, 0)).toBe('none');
    expect(nearestPlace(undefined, 0, 0)).toBe('none');
  });
});
