// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1633: `urban-class.ts` over corridors built from arithmetic
 * (`testing/urban-fixtures.ts`) — each of the five classes, the smoothing,
 * and no fill across a stretch with no map data.
 */

import type { Metres, RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import { FOOTPRINT_MAX_VERTICES, footprintPlans } from './footprint-buildings';
import { denseTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { circuitRoute, hairpinRoute } from './route-fixtures-testing';
import { corridorOrigin } from './terrain';
import { untaggedCorridor, urbanFixture, type UrbanStretch } from './testing/urban-fixtures';
import { NO_URBAN_CLASS, urbanClassMap, type UrbanClass } from './urban-class';

/** The class of every 100 m window of a fixture, from its middle. */
function classesOf(stretches: readonly UrbanStretch[], uncovered?: { from: number; to: number }[]) {
  const fixture = urbanFixture(stretches, uncovered === undefined ? {} : { uncovered });
  const map = urbanClassMap(fixture.corridor, landClassMask(fixture.corridor), fixture.profile);
  return { fixture, map, at: (along: number): UrbanClass => map.classAt(along) };
}

/** Every window's class from `from` to `to`, by its middle. */
function windows(at: (along: number) => UrbanClass, from: number, to: number): UrbanClass[] {
  const out: UrbanClass[] = [];
  for (let along = from + 50; along < to; along += 100) out.push(at(along));
  return out;
}

describe('urbanClassMap — each class from its fixture (#1633)', () => {
  it('reads farmland with no footprints as rural', () => {
    const { at } = classesOf([{ kind: 'rural', from: 1_000, to: 1_600 }]);
    expect(windows(at, 1_000, 1_600)).toEqual(Array(6).fill('rural'));
  });

  it('reads residential land at about 8 % coverage of 2-storey houses as a village', () => {
    const { at } = classesOf([{ kind: 'village', from: 1_000, to: 1_600 }]);
    expect(windows(at, 1_000, 1_600)).toEqual(Array(6).fill('village'));
  });

  it('reads about 13 % coverage, just under a town’s, as a village', () => {
    const { at } = classesOf([{ kind: 'full-village', from: 1_000, to: 1_600 }]);
    expect(windows(at, 1_000, 1_600)).toEqual(Array(6).fill('village'));
  });

  it('reads the village’s coverage of 3-storey buildings as a town, not a village', () => {
    const fixture = urbanFixture([{ kind: 'village', from: 1_000, to: 1_600 }]);
    const corridor = {
      ...fixture.corridor,
      buildings: fixture.corridor.buildings.map((building) => ({ ...building, heightMetres: 9 })),
    };
    const map = urbanClassMap(corridor, landClassMask(corridor), fixture.profile);
    expect(windows((along) => map.classAt(along), 1_000, 1_600)).toEqual(Array(6).fill('town'));
  });

  it('reads about 25 % coverage as a town', () => {
    const { at } = classesOf([{ kind: 'town', from: 1_000, to: 1_600 }]);
    expect(windows(at, 1_000, 1_600)).toEqual(Array(6).fill('town'));
  });

  it('reads 45 % coverage with six 18 m footprints as a city centre, by height', () => {
    const { at } = classesOf([{ kind: 'city-height', from: 1_000, to: 1_400 }]);
    expect(windows(at, 1_000, 1_400)).toEqual(Array(4).fill('city-centre'));
  });

  it('reads 45 % coverage of 4-storey buildings, and no tower, as a city centre, by median', () => {
    const fixture = urbanFixture([{ kind: 'city-height', from: 1_000, to: 1_400 }]);
    const corridor = {
      ...fixture.corridor,
      buildings: fixture.corridor.buildings.map((building) => ({ ...building, heightMetres: 12 })),
    };
    const map = urbanClassMap(corridor, landClassMask(corridor), fixture.profile);
    expect(windows((along) => map.classAt(along), 1_000, 1_400)).toEqual(
      Array(4).fill('city-centre'),
    );
  });

  it('reads 40 % coverage on land 60 % commercial as a city centre, by commerce', () => {
    const { at } = classesOf([{ kind: 'city-commerce', from: 1_000, to: 1_400 }]);
    expect(windows(at, 1_000, 1_400)).toEqual(Array(4).fill('city-centre'));
  });

  it('reads the covered land around a stretch as rural, not as the stretch', () => {
    const { at } = classesOf([{ kind: 'city-commerce', from: 1_000, to: 1_400 }]);
    expect(at(500)).toBe('rural');
    expect(at(2_000)).toBe('rural');
  });
});

describe('urbanClassMap — smoothing (#1633 flicker)', () => {
  it('reads a single 100 m town window between city-centre runs as city centre', () => {
    const { at } = classesOf([
      { kind: 'city-commerce', from: 1_000, to: 1_400 },
      { kind: 'town', from: 1_400, to: 1_500 },
      { kind: 'city-commerce', from: 1_500, to: 1_900 },
    ]);
    expect(windows(at, 1_000, 1_900)).toEqual(Array(9).fill('city-centre'));
  });

  it('reads a 600 m town run between city-centre runs as town', () => {
    const { at } = classesOf([
      { kind: 'city-commerce', from: 1_000, to: 1_400 },
      { kind: 'town', from: 1_400, to: 2_000 },
      { kind: 'city-commerce', from: 2_000, to: 2_400 },
    ]);
    expect(windows(at, 1_000, 2_400)).toEqual([
      ...Array<UrbanClass>(4).fill('city-centre'),
      ...Array<UrbanClass>(6).fill('town'),
      ...Array<UrbanClass>(4).fill('city-centre'),
    ]);
  });
});

describe('urbanClassMap — no map data, no class (#1633, ADR 0054 D-4)', () => {
  it('reads a 200 m uncovered stretch inside a city-centre run as unknown, not city', () => {
    const { at, fixture } = classesOf(
      [{ kind: 'city-commerce', from: 1_000, to: 1_800 }],
      [{ from: 1_300, to: 1_500 }],
    );
    // The fixture's gap is where the mask has no map data.
    expect(landClassMask(fixture.corridor).covered(0, 1_400)).toBe(false);
    expect(windows(at, 1_000, 1_800)).toEqual([
      'city-centre',
      'city-centre',
      'city-centre',
      'unknown',
      'unknown',
      'city-centre',
      'city-centre',
      'city-centre',
    ]);
  });

  it('is unknown everywhere for NO_URBAN_CLASS', () => {
    for (const along of [0, 50, 1_000, Number.NaN]) {
      expect(NO_URBAN_CLASS.classAt(along)).toBe('unknown');
    }
  });

  it('is unknown off the route, and for a route with no length', () => {
    const { at } = classesOf([{ kind: 'town', from: 100, to: 2_900 }]);
    expect(at(1_500)).toBe('town');
    expect(at(-1)).toBe('unknown');
    expect(at(3_001)).toBe('unknown');
    expect(at(Number.NaN)).toBe('unknown');
  });

  it('is NO_URBAN_CLASS for a route with no length', () => {
    const fixture = urbanFixture([{ kind: 'town', from: 100, to: 2_900 }]);
    const empty = { ...fixture.profile, totalDistance: 0 as Metres };
    const map = urbanClassMap(fixture.corridor, landClassMask(fixture.corridor), empty);
    expect(map).toBe(NO_URBAN_CLASS);
  });

  it('wraps a loop route', () => {
    const loop = circuitRoute(400);
    const origin = corridorOrigin(loop);
    const corridor = {
      routeId: 'loop',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -5_000, maxX: 5_000, minZ: -5_000, maxZ: 5_000 }],
      landUse: [],
      buildings: [],
      paths: [],
      streets: [],
    };
    const map = urbanClassMap(corridor, landClassMask(corridor), loop);
    expect(map.classAt(50)).toBe('rural');
    expect(map.classAt(2 * loop.totalDistance + 50)).toBe('rural');
    expect(map.classAt(-50)).toBe('rural');
  });
});

/** A uniform 25 % town over a square kilometre around the route: 10 m houses on a 20 m grid. */
function uniformTownBeside(profile: RouteProfile) {
  const origin = corridorOrigin(profile);
  const ring = (x: number, z: number, side: number): Float32Array =>
    Float32Array.of(x, z, x + side, z, x + side, z + side, x, z + side);
  const buildings: BuildingFeature[] = [];
  for (let x = -700; x < 700; x += 20) {
    for (let z = -700; z < 1_200; z += 20) {
      buildings.push({
        kind: 'building',
        heightMetres: 6,
        minHeightMetres: null,
        rings: [ring(x, z, 10)],
      });
    }
  }
  const corridor = {
    routeId: 'uniform-town',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -5_000, maxX: 5_000, minZ: -5_000, maxZ: 5_000 }],
    landUse: [{ layer: 'landuse' as const, kind: 'residential', rings: [ring(-800, -800, 2_000)] }],
    buildings,
    paths: [],
    streets: [],
  };
  return { corridor, map: urbanClassMap(corridor, landClassMask(corridor), profile) };
}

describe('urbanClassMap — a route passing within its own sweep (#1633)', () => {
  it.each([100, 6])(
    'reads the same 25 % town down both legs of a hairpin of radius %d m, not a village',
    (radius) => {
      const profile = hairpinRoute(radius);
      const { map } = uniformTownBeside(profile);
      // Land is counted into the window of the road point nearest it, as the footprints are.
      // The windows well clear of the turn, whose normals fan out and sample it sparsely.
      const total = profile.totalDistance;
      for (const along of [150, 250, total - 250, total - 150]) {
        expect(map.classAt(along)).toBe('town');
      }
    },
  );
});

describe('urbanClassMap — handed to the footprints at the press (#1633)', () => {
  it('stamps each plan with the class of the stretch it stands beside', () => {
    const { fixture, map } = classesOf([
      { kind: 'village', from: 400, to: 1_000 },
      { kind: 'city-height', from: 1_400, to: 1_800 },
    ]);
    const land = landClassMask(fixture.corridor);
    const { plans } = footprintPlans(
      fixture.corridor,
      land,
      fixture.profile,
      fixture.origin,
      FOOTPRINT_MAX_VERTICES,
      map,
    );
    const classOf = (z: number): UrbanClass | undefined =>
      plans.find((plan) => Math.abs(plan.centroid.z - z) < 50)?.urban;
    expect(classOf(700)).toBe('village');
    expect(classOf(1_600)).toBe('city-centre');
    // With no map, every plan is `unknown`: today's plans.
    const none = footprintPlans(fixture.corridor, land, fixture.profile, fixture.origin).plans;
    expect(new Set(none.map((plan) => plan.urban))).toEqual(new Set(['unknown']));
  });

  it('classes #1540’s 2 000-footprint dense town', () => {
    const town = denseTownFixture();
    const map = urbanClassMap(town.corridor, landClassMask(town.corridor), town.profile);
    // 8 × 8 m houses on a 12 m grid to 215 m out: well past a town's coverage.
    expect(map.classAt(700)).toBe('town');
  });
});

/** A city locality of rank 10, 400 m west of the road at 1 300 m along (#1632). */
const CITY_POINT = {
  kind: 'locality',
  kindDetail: 'city',
  populationRank: 10,
  along: 1_300,
  out: 400,
} as const;

type FixturePlaces = NonNullable<NonNullable<Parameters<typeof urbanFixture>[1]>['places']>;

/** Every window's class from 1 000 m to 1 600 m, with the given stretch and places. */
function withPlaces(
  kind: UrbanStretch['kind'],
  places: FixturePlaces,
  uncovered?: { from: number; to: number }[],
): UrbanClass[] {
  const fixture = urbanFixture([{ kind, from: 1_000, to: 1_600 }], {
    places,
    ...(uncovered === undefined ? {} : { uncovered }),
  });
  const map = urbanClassMap(fixture.corridor, landClassMask(fixture.corridor), fixture.profile);
  return windows((along) => map.classAt(along), 1_000, 1_600);
}

describe('urbanClassMap — the place prior (#1632, ADR 0055 D-5)', () => {
  const town = Array<UrbanClass>(6).fill('town');
  const city = Array<UrbanClass>(6).fill('city-centre');

  it('lifts a borderline town to a city centre with a city locality within reach, and not without', () => {
    expect(withPlaces('town', [])).toEqual(town);
    expect(withPlaces('town', [CITY_POINT])).toEqual(city);
  });

  it('lifts it with a suburb of any rank, too', () => {
    expect(
      withPlaces('town', [
        { kind: 'neighbourhood', kindDetail: 'suburb', populationRank: 1, along: 1_300, out: 50 },
      ]),
    ).toEqual(city);
  });

  it('lifts a town of a city centre’s coverage with no mapped height: no upper bound on coverage', () => {
    const fixture = urbanFixture([{ kind: 'city-height', from: 1_000, to: 1_400 }], {
      places: [{ ...CITY_POINT, along: 1_200 }],
    });
    const classes = (corridor: typeof fixture.corridor): UrbanClass[] => {
      const map = urbanClassMap(corridor, landClassMask(corridor), fixture.profile);
      return windows((along) => map.classAt(along), 1_000, 1_400);
    };
    expect(classes(untaggedCorridor({ ...fixture.corridor, places: [] }))).toEqual(
      Array(4).fill('town'),
    );
    expect(classes(untaggedCorridor(fixture.corridor))).toEqual(Array(4).fill('city-centre'));
  });

  it('does not lift a town under the prior’s coverage', () => {
    expect(withPlaces('thin-town', [])).toEqual(town);
    expect(withPlaces('thin-town', [CITY_POINT])).toEqual(town);
  });

  it('does not lift with a city below the rank gate, and does at it', () => {
    expect(withPlaces('town', [{ ...CITY_POINT, populationRank: 8 }])).toEqual(town);
    expect(withPlaces('town', [{ ...CITY_POINT, populationRank: 9 }])).toEqual(city);
  });

  it('does not lift with a city beyond reach of every window', () => {
    // The nearest window centre is 1 050 m along: 820 m west of it is out of reach, 780 m in.
    expect(withPlaces('town', [{ ...CITY_POINT, along: 1_050, out: 820 }])).toEqual(town);
    expect(withPlaces('town', [{ ...CITY_POINT, along: 1_050, out: 780 }])).not.toEqual(town);
  });

  it.each([
    ['locality', 'town'],
    ['locality', 'village'],
    ['locality', 'hamlet'],
    ['macrohood', 'quarter'],
  ] as const)('never lifts with a %s/%s point, whatever its rank', (kind, kindDetail) => {
    expect(
      withPlaces('town', [
        { kind, kindDetail, populationRank: 18, along: 1_300, out: 0 },
        { kind, kindDetail, populationRank: 10, along: 1_300, out: 10 },
      ]),
    ).toEqual(town);
  });

  it('leaves rural and village built form as it is with a city inside it', () => {
    const at = { ...CITY_POINT, populationRank: 18, out: 0 };
    expect(withPlaces('rural', [at])).toEqual(Array(6).fill('rural'));
    expect(withPlaces('village', [at])).toEqual(Array(6).fill('village'));
  });

  it('leaves a window with no corridor unknown, whatever places exist nearby', () => {
    expect(
      withPlaces(
        'town',
        [
          { ...CITY_POINT, out: 0 },
          { kind: 'neighbourhood', kindDetail: 'suburb', populationRank: 4, along: 1_300, out: 0 },
        ],
        [{ from: 1_000, to: 1_600 }],
      ),
    ).toEqual(Array(6).fill('unknown'));
  });

  it('is applied before the smoothing: a lift too short to stand is smoothed away', () => {
    const fixture = urbanFixture(
      [
        { kind: 'thin-town', from: 1_000, to: 1_400 },
        { kind: 'town', from: 1_400, to: 1_500 },
        { kind: 'thin-town', from: 1_500, to: 1_900 },
      ],
      { places: [{ ...CITY_POINT, along: 1_450, out: 0 }] },
    );
    const map = urbanClassMap(fixture.corridor, landClassMask(fixture.corridor), fixture.profile);
    // Only the middle window is a borderline town; lifted alone, it is shorter than a run.
    expect(windows((along) => map.classAt(along), 1_000, 1_900)).toEqual(Array(9).fill('town'));
  });
});
