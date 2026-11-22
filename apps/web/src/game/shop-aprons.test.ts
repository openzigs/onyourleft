// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2848's aprons, read back through the planner that lays them
 * (`footprint-buildings.ts` §`footprintPlans`), off each plan's own `apron`
 * triangles — what the belt uploads — and through the clearings and the belt
 * that read the plan (`mapped-buildings.ts`, `three-renderer.ts`
 * §`MappedBuildingBelt`). `shop-aprons.ts`' own rules are asked directly only
 * where a fixture cannot reach them.
 *
 * Every fixture is arithmetic beside a straight road. Nothing here is a real
 * place, and no coordinate is formatted into any message.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';
import {
  NO_BUILDING_FIELDS,
  type BuildingFeature,
  type LandUseFeature,
  type PathFeature,
  type StreetFeature,
} from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS } from './cross-streets';
import {
  CLAD_PAVING,
  FOOTPRINT_MAX_TRIANGLES,
  FOOTPRINT_ROLES,
  FOOTPRINT_VERTEX_FLOATS,
  STYLE_OFFSET,
  footprintPlans,
  mappedTown,
  type FootprintPlan,
  type FootprintPlanOptions,
} from './footprint-buildings';
import {
  besideRoad,
  buildingBeside,
  commercialStreetFixture,
  footprintFixtureRoute,
  landBeside,
  planFingerprint,
  rectangleBeside,
  ringBeside,
  streetBeside,
} from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import {
  clearOfDriveways,
  clearOfMappedBuildings,
  mappedBuildingsOf,
  MappedSelection,
  NEAR_ROLES,
  onMappedGround,
  selectMappedBuildings,
} from './mapped-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_TRIANGLES,
} from './realistic-budget';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import { nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed, type ScatterItem } from './scatter';
import { LOT_FLOATS, placeLot } from './settlements';
import { APRON, ApronObstacles, shopApron, type ApronFront, type ApronSite } from './shop-aprons';
import { CITY_PAVEMENT_WIDTH_METRES, KERB_LATERAL_METRES, streetsAt } from './streets';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import { MappedBuildingBelt } from './three-renderer';
import { urbanClassMap, type UrbanClassMap } from './urban-class';
import { inWater, waterways } from './waterways';
import { NO_PAVEMENT_DATA, pavementSides } from './footways';
import type { WorldCorridor } from './world-data/corridor';

/** A shop's footprint: a rectangle `length` along the road by `depth`, its middle `lateral` out. */
interface Shop {
  readonly along: number;
  readonly lateral: number;
  readonly length?: number;
  readonly depth?: number;
}

interface Town {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
}

/** Where the test street's commercial land starts and ends along the road. */
const LAND = { from: 900, to: 1_500, out: 80 } as const;

/**
 * A level street on commercial land with `shops` beside it and whatever else
 * the map draws there. A shop 12 m square whose middle is 14 m out has its
 * front 8 m from the centreline: 4.4 m of ground to the kerb's line.
 */
function street(
  shops: readonly Shop[],
  map: {
    readonly profile?: RouteProfile;
    readonly paths?: (profile: RouteProfile, origin: CorridorOrigin) => readonly PathFeature[];
    readonly streets?: (profile: RouteProfile, origin: CorridorOrigin) => readonly StreetFeature[];
    readonly landUse?: (profile: RouteProfile, origin: CorridorOrigin) => readonly LandUseFeature[];
    readonly buildings?: (
      profile: RouteProfile,
      origin: CorridorOrigin,
    ) => readonly BuildingFeature[];
  } = {},
): Town {
  const profile = map.profile ?? northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  return {
    profile,
    origin,
    corridor: {
      routeId: 'shop-aprons',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(
          profile,
          origin,
          'landuse',
          'commercial',
          LAND.from,
          LAND.to,
          -LAND.out,
          LAND.out,
        ),
        ...(map.landUse?.(profile, origin) ?? []),
      ],
      buildings: [
        ...shops.map((shop) =>
          buildingBeside(
            profile,
            origin,
            [rectangleBeside(shop.along, shop.lateral, shop.length ?? 12, shop.depth ?? 12)],
            6.5,
          ),
        ),
        ...(map.buildings?.(profile, origin) ?? []),
      ],
      paths: map.paths?.(profile, origin) ?? [],
      streets: map.streets?.(profile, origin) ?? [],
    },
  };
}

/** The town's plans, as the press makes them; `urban` its class, or none. */
function planned(
  town: Town,
  options: FootprintPlanOptions = {},
  urban?: UrbanClassMap,
): { readonly plans: readonly FootprintPlan[]; readonly land: LandClassMask } {
  const land = landClassMask(town.corridor);
  return {
    land,
    plans: footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options)
      .plans,
  };
}

/** One vertex of a plan's apron, with where it stands beside the drawn road. */
interface ApronVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly along: number;
  readonly lateral: number;
  readonly distance: number;
}

/** A plan's apron's vertices, in the order the belt uploads them. */
function apronVertices(town: Town, plan: FootprintPlan): ApronVertex[] {
  const floats = plan.triangles.apron;
  const out: ApronVertex[] = [];
  for (let at = 0; at < floats.length; at += FOOTPRINT_VERTEX_FLOATS) {
    const x = floats[at] as number;
    const y = floats[at + 1] as number;
    const z = floats[at + 2] as number;
    const near = nearestOnDrawnRoad(town.profile, town.origin, x, z, 200);
    if (near === undefined) throw new Error('an apron vertex is nowhere near the road');
    out.push({ x, y, z, along: near.along, lateral: near.lateral, distance: near.distance });
  }
  return out;
}

function trianglesOf(plan: FootprintPlan): number {
  return plan.triangles.apron.length / (3 * FOOTPRINT_VERTEX_FLOATS);
}

/** The least and the most of `values`. */
function span(values: readonly number[]): readonly [least: number, most: number] {
  return [Math.min(...values), Math.max(...values)];
}

/** The kerb's line: where an apron stops, outside the carriageway's edge. */
const KERB_LINE = KERB_LATERAL_METRES + APRON.short;

/** A float32's worth of slack on a length of a few thousand metres. */
const SLACK = 2e-3;

/** A sidewalk along the road from `from` to `to`, `lateral` out. */
function sidewalk(
  profile: RouteProfile,
  origin: CorridorOrigin,
  from: number,
  to: number,
  lateral: number,
  detail = 'sidewalk',
): PathFeature {
  return {
    kind: 'path',
    kindDetail: detail,
    line: ringBeside(profile, origin, [
      [from, lateral],
      [to, lateral],
    ]),
  };
}

describe('an apron’s numbers — #2848', () => {
  it('are the ones its header and the pull request state', () => {
    expect(APRON).toStrictEqual({
      lift: 0.05,
      piece: 2,
      column: 3.6,
      deepest: 12,
      least: 0.2,
      short: 0.1,
      footway: 2,
      street: 0.5,
      facing: 0.5,
      inset: 0.05,
    });
    // The kerb's line: a decimetre outside the 7 m carriageway's edge.
    expect(KERB_LINE).toBeCloseTo(3.6, 9);
  });
});

describe('which fronts get an apron — #2848', () => {
  const town = commercialStreetFixture();
  const land = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, land, town.profile);
  const plans = footprintPlans(
    town.corridor,
    land,
    town.profile,
    town.origin,
    undefined,
    urban,
  ).plans;

  it('lays one before every main-street block, across its whole front, from the wall to the kerb', () => {
    const blocks = plans.filter((plan) => plan.buildingArchetype === 'main-street');
    // The fixture's main street: 29 blocks a side.
    expect(blocks).toHaveLength(58);
    for (const plan of blocks) {
      expect(plan.apron.length).toBeGreaterThan(0);
      const vertices = apronVertices(town, plan);
      // A block is 12 m along the road and its front 10 m from the centreline.
      const [nearest, farthest] = span(vertices.map((vertex) => vertex.distance));
      expect(nearest).toBeCloseTo(KERB_LINE, 2);
      expect(farthest).toBeCloseTo(10, 2);
      const [first, last] = span(vertices.map((vertex) => vertex.along));
      expect(last - first).toBeCloseTo(12, 1);
      // And on the block's own side of the road, every vertex.
      const side = Math.sign((vertices[0] as ApronVertex).lateral);
      expect(vertices.every((vertex) => Math.sign(vertex.lateral) === side)).toBe(true);
    }
  });

  it('lays none before a front further than 12 m from the kerb, nor before a block of flats', () => {
    // The strip's stores and offices stand 32.5 m and 31 m back, behind a yard.
    const strip = plans.filter(
      (plan) => plan.shop.front && plan.buildingArchetype !== 'main-street',
    );
    expect(strip.length).toBeGreaterThan(0);
    for (const plan of strip) expect(plan.apron).toHaveLength(0);
    // Residential land: a garden apartment is no shop.
    const flats = plans.filter((plan) => plan.buildingArchetype === 'garden-apartment');
    expect(flats.length).toBeGreaterThan(0);
    for (const plan of flats) {
      expect(plan.apron).toHaveLength(0);
      expect(plan.triangles.apron).toHaveLength(0);
    }
  });

  it('holds the depth at 12 m: a front 12 m from the kerb has one, and one 12.5 m from it has none', () => {
    // Fronts at 15.5 m and 16 m from the centreline: 11.9 m and 12.4 m from the kerb's line.
    const { plans: pair } = planned(
      street([
        { along: 1_100, lateral: 21.5 },
        { along: 1_200, lateral: 22 },
      ]),
    );
    expect(pair).toHaveLength(2);
    expect((pair[0] as FootprintPlan).apron.length).toBeGreaterThan(0);
    expect((pair[1] as FootprintPlan).apron).toHaveLength(0);
  });

  it('lays none before a mapped garage on commercial land, nor before a house', () => {
    const typed = (buildingType: BuildingFeature['buildingType'], along: number) => {
      return (profile: RouteProfile, origin: CorridorOrigin): BuildingFeature => ({
        ...buildingBeside(profile, origin, [rectangleBeside(along, 14, 12, 12)], 6.5),
        ...NO_BUILDING_FIELDS,
        buildingType,
      });
    };
    const { plans: three } = planned(
      street([], {
        buildings: (profile, origin) => [
          typed('retail', 1_050)(profile, origin),
          typed('garage', 1_100)(profile, origin),
          typed('house', 1_150)(profile, origin),
        ],
      }),
    );
    expect(three.map((plan) => plan.apron.length > 0)).toEqual([true, false, false]);
  });

  it('lays none under a `building_part`, which stands on its own `min_height`', () => {
    const raised = (part: boolean) => {
      return (profile: RouteProfile, origin: CorridorOrigin): BuildingFeature[] => [
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(1_100, 14, 12, 12)],
          9,
          part ? { minHeightMetres: 3 } : undefined,
        ),
      ];
    };
    const whole = planned(street([], { buildings: raised(false) })).plans;
    const part = planned(street([], { buildings: raised(true) })).plans;
    expect(whole).toHaveLength(1);
    expect(part).toHaveLength(1);
    expect(whole[0]?.apron.length).toBeGreaterThan(0);
    expect(part[0]?.apron).toHaveLength(0);
  });

  it('lays none before an untyped footprint on residential or industrial land', () => {
    // The same footprint each time, and the land under it the only difference.
    const on = (kind: string): FootprintPlan => {
      const town = street([{ along: 1_700, lateral: 14 }], {
        landUse: (profile, origin) => [
          landBeside(profile, origin, 'landuse', kind, 1_600, 1_800, -LAND.out, LAND.out),
        ],
      });
      const { plans } = planned(town);
      expect(plans).toHaveLength(1);
      return plans[0] as FootprintPlan;
    };
    expect(on('commercial').apron.length).toBeGreaterThan(0);
    expect(on('residential').apron).toHaveLength(0);
    expect(on('industrial').apron).toHaveLength(0);
  });

  it('is the same apron every time the town is planned', () => {
    const again = footprintPlans(
      town.corridor,
      land,
      town.profile,
      town.origin,
      undefined,
      urban,
    ).plans;
    expect(again).toHaveLength(plans.length);
    for (const [index, plan] of plans.entries()) {
      const twin = again[index] as FootprintPlan;
      expect(Array.from(twin.apron)).toEqual(Array.from(plan.apron));
      expect(Array.from(twin.triangles.apron)).toEqual(Array.from(plan.triangles.apron));
    }
  });

  it('plans every footprint as before #2848 with `shopAprons: false`', () => {
    const off = footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, {
      shopAprons: false,
    }).plans;
    for (const plan of off) {
      expect(plan.apron).toHaveLength(0);
      expect(plan.triangles.apron).toHaveLength(0);
    }
    // `mapped-roofs.test.ts` §`BEFORE.commercial`: the frozen record of this town on `main`.
    expect(planFingerprint(off)).toBe('21078cf3');
    expect(planFingerprint(plans)).not.toBe('21078cf3');
    // And an apron is all that differs: every other role's floats are the same.
    for (const [index, plan] of plans.entries()) {
      const twin = off[index] as FootprintPlan;
      for (const role of FOOTPRINT_ROLES) {
        if (role === 'apron') continue;
        expect(plan.triangles[role]).toEqual(twin.triangles[role]);
      }
      expect(plan.triangleCount).toBe(twin.triangleCount + trianglesOf(plan));
    }
  });
});

describe('where the map has its own pavement — #2848', () => {
  /** A shop each side of the road at 1 100 m and at 1 200 m. */
  const shops: readonly Shop[] = [
    { along: 1_100, lateral: 14 },
    { along: 1_100, lateral: -14 },
    { along: 1_200, lateral: 14 },
    { along: 1_200, lateral: -14 },
  ];

  it('lays none where a sidewalk is mapped before the front, and one where it is across the road', () => {
    // A sidewalk 5 m out on the right, past the first pair of shops only.
    const { plans } = planned(
      street(shops, { paths: (profile, origin) => [sidewalk(profile, origin, 1_050, 1_150, 5)] }),
    );
    expect(plans.map((plan) => plan.apron.length > 0)).toEqual([false, true, true, true]);
  });

  it('lays none within 2 m of a footway, and one 2.5 m from it', () => {
    // The shop's ground runs from 1 094 m to 1 106 m along the road. A path
    // across the verge 1.5 m past its end stops it; one 2.5 m past does not.
    const across = (along: number) => (profile: RouteProfile, origin: CorridorOrigin) => [
      {
        kind: 'path',
        kindDetail: 'footway',
        line: ringBeside(profile, origin, [
          [along, 4],
          [along, 30],
        ]),
      },
    ];
    const near = planned(street([shops[0] as Shop], { paths: across(1_107.5) })).plans;
    const clear = planned(street([shops[0] as Shop], { paths: across(1_108.5) })).plans;
    expect((near[0] as FootprintPlan).apron).toHaveLength(0);
    expect((clear[0] as FootprintPlan).apron.length).toBeGreaterThan(0);
  });

  it('counts a crossing and a plain path as footways, and a track as none', () => {
    const before = (kind: string, kindDetail: string) => {
      return (profile: RouteProfile, origin: CorridorOrigin): PathFeature[] => [
        {
          kind,
          kindDetail,
          line: ringBeside(profile, origin, [
            [1_100, -6],
            [1_100, 6],
          ]),
        },
      ];
    };
    const laid = (kind: string, kindDetail: string): boolean =>
      (
        planned(street([shops[0] as Shop], { paths: before(kind, kindDetail) }))
          .plans[0] as FootprintPlan
      ).apron.length > 0;
    expect(laid('path', 'crossing')).toBe(false);
    expect(laid('path', '')).toBe(false);
    expect(laid('path', 'track')).toBe(true);
  });

  it('finds a footway that lies wholly inside the ground, touching no edge of it', () => {
    const { plans } = planned(
      street([shops[0] as Shop], {
        // 5.8 m out: 2.2 m from the kerb's line and from the wall, 4 m from either side.
        paths: (profile, origin) => [sidewalk(profile, origin, 1_098, 1_102, 5.8, 'footway')],
      }),
    );
    expect((plans[0] as FootprintPlan).apron).toHaveLength(0);
  });
});

describe('what an apron never covers — #2848', () => {
  /** A shop 35 m along the road, its front 8 m from the centreline: ten columns of ground. */
  const long: Shop = { along: 1_100, lateral: 14, length: 35 };

  it('is laid whole with nothing mapped before it', () => {
    const town = street([long]);
    const plan = planned(town).plans[0] as FootprintPlan;
    const vertices = apronVertices(town, plan);
    const [first, last] = span(vertices.map((vertex) => vertex.along));
    expect(first).toBeCloseTo(1_082.5, 1);
    expect(last).toBeCloseTo(1_117.5, 1);
    // Ten columns of three pieces: 4.4 m of ground in pieces no longer than 2 m.
    expect(trianglesOf(plan)).toBe(10 * 3 * 2);
  });

  it('keeps off a mapped side street, and its margin, and stays one piece', () => {
    // A residential street leaving the route square at 1 106 m, on the shop's side.
    const town = street([long], {
      streets: (profile, origin) => [
        streetBeside(
          profile,
          origin,
          [
            [1_106, 0],
            [1_106, 7],
          ],
          'residential',
        ),
      ],
    });
    const plan = planned(town).plans[0] as FootprintPlan;
    const vertices = apronVertices(town, plan);
    expect(vertices.length).toBeGreaterThan(0);
    const off = SIDE_ROAD_WIDTHS.minor / 2 + APRON.street;
    for (const vertex of vertices) {
      // The street's line ends 7 m out; the ground reaches 8 m.
      const beyond = Math.max(0, vertex.lateral - 7);
      expect(Math.hypot(vertex.along - 1_106, beyond)).toBeGreaterThan(off - SLACK);
    }
    // The longer side of it, from the front's start: one unbroken run.
    const [first, last] = span(vertices.map((vertex) => vertex.along));
    expect(first).toBeCloseTo(1_082.5, 1);
    expect(last).toBeLessThan(1_106 - off + SLACK);
    expect(last).toBeGreaterThan(1_106 - off - APRON.column);
  });

  it('is stopped by no street that is the route’s own, mapped a little off the drawn road', () => {
    // The route's street as a map has it: along the road, 5 m off the line the ride drew.
    const own = (lateral: number) => (profile: RouteProfile, origin: CorridorOrigin) => [
      {
        ...streetBeside(
          profile,
          origin,
          [
            [900, lateral],
            [1_300, lateral],
          ],
          'tertiary',
        ),
        kind: 'major_road',
      },
    ];
    const whole = trianglesOf(planned(street([long])).plans[0] as FootprintPlan);
    expect(
      trianglesOf(planned(street([long], { streets: own(5) })).plans[0] as FootprintPlan),
    ).toBe(whole);
    // Control: 9 m off it is past `cross-streets.ts`' tolerance, a road of its own before the shop.
    // #2973's rule 3b would drop the shop it runs through; off, the apron's own check is the one read.
    expect(
      (
        planned(street([long], { streets: own(9) }), { nearbyStreets: false })
          .plans[0] as FootprintPlan
      ).apron,
    ).toHaveLength(0);
  });

  it('is not stopped by a street in a tunnel under it', () => {
    const under = (grade: StreetFeature['grade']) => {
      return (profile: RouteProfile, origin: CorridorOrigin): StreetFeature[] => [
        streetBeside(
          profile,
          origin,
          [
            [1_100, -40],
            [1_100, 40],
          ],
          'residential',
          grade,
        ),
      ];
    };
    const whole = trianglesOf(planned(street([long])).plans[0] as FootprintPlan);
    const tunnel = planned(street([long], { streets: under('tunnel') })).plans[0] as FootprintPlan;
    const ground = planned(street([long], { streets: under('ground') })).plans[0] as FootprintPlan;
    expect(trianglesOf(tunnel)).toBe(whole);
    expect(trianglesOf(ground)).toBeLessThan(whole);
  });

  for (const [layer, kind] of [
    ['landuse', 'park'],
    ['landuse', 'wood'],
    ['landuse', 'beach'],
    ['water', 'lake'],
  ] as const) {
    it(`keeps off a mapped ${kind}, which outranks built-up land`, () => {
      // Over the ground beside the kerb before the front's far end: the mask's cells there, 5 m
      // square, and none under the shop.
      const town = street([long], {
        landUse: (profile, origin) => [
          landBeside(profile, origin, layer, kind, 1_106, 1_140, 1, 6.5),
        ],
      });
      const { plans, land } = planned(town);
      const plan = plans[0] as FootprintPlan;
      const vertices = apronVertices(town, plan);
      expect(vertices.length).toBeGreaterThan(0);
      for (const vertex of vertices) {
        expect(land.classAt(vertex.x, vertex.z)).toBe('built-up');
        // The polygon's edge, less a cell of the mask.
        expect(vertex.along).toBeLessThan(1_106 + 5);
      }
      expect(trianglesOf(plan)).toBeLessThan(10 * 3 * 2);
    });
  }

  it('keeps off the bank of the water the scene draws, where the mask still says land', () => {
    // A mapped lake behind the shop's far end, its shore 17 m out: the scene draws it, and
    // the 14 m of ground before its shore is its bank from where it starts. The shop is 6 m
    // deep, its front 8 m from the centreline.
    const town = street([{ along: 1_137.5, lateral: 11, length: 35, depth: 6 }], {
      landUse: (profile, origin) => [
        landBeside(profile, origin, 'water', 'lake', 1_130, 1_930, 17, 200),
      ],
    });
    const { plans, land } = planned(town);
    const ways = waterways(town.profile, scatterSeed(town.profile), land);
    expect(ways.lakes).toHaveLength(1);
    // Not vacuous: the shop's ground at its far end is on the bank, and the mask calls it land.
    const [x, z] = besideRoad(town.profile, town.origin, 1_152, 6);
    expect(inWater(ways, town.profile, 1_152, 6)).toBe(true);
    expect(land.classAt(x, z)).toBe('built-up');
    const plan = plans[0] as FootprintPlan;
    const vertices = apronVertices(town, plan);
    expect(vertices.length).toBeGreaterThan(0);
    for (const vertex of vertices) {
      expect(inWater(ways, town.profile, vertex.along, vertex.lateral)).toBe(false);
    }
    // It starts where the front does, and stops short of the front's end at 1 155 m.
    const [first, last] = span(vertices.map((vertex) => vertex.along));
    expect(first).toBeCloseTo(1_120, 1);
    expect(last).toBeLessThan(1_150);
  });

  it('lays no apron at all in a corridor whose map is more than the grids take', () => {
    // The street's own shop, and far off it the hostile tile's lines: none within 500 m of it.
    const hostile = (): StreetFeature[] =>
      Array.from({ length: 80 }, (_, index) => ({
        kind: 'minor_road',
        kindDetail: 'residential',
        grade: 'ground',
        line: Float32Array.of(500, -3_000 + index, 6_500, 3_000 + index),
      }));
    const few = (): StreetFeature[] => hostile().slice(0, 2);
    expect(
      (planned(street([long], { streets: few })).plans[0] as FootprintPlan).apron.length,
    ).toBeGreaterThan(0);
    expect(
      (planned(street([long], { streets: hostile })).plans[0] as FootprintPlan).apron,
    ).toHaveLength(0);
  });

  it('keeps off another footprint standing before the front', () => {
    // A kiosk between the front and the road, before the front's far end.
    const kiosk = (profile: RouteProfile, origin: CorridorOrigin): BuildingFeature[] => [
      buildingBeside(profile, origin, [rectangleBeside(1_110, 5.5, 3, 2.5)], 3),
    ];
    const town = street([long], { buildings: kiosk });
    const plans = planned(town).plans;
    const plan = plans.find((each) => each.apron.length > 0);
    if (plan === undefined) throw new Error('the shop has no apron');
    const vertices = apronVertices(town, plan);
    // The kiosk stands from 1 108.5 m to 1 111.5 m: no column of the apron reaches it.
    for (const vertex of vertices) expect(vertex.along).toBeLessThan(1_108.5 + SLACK);
    expect(trianglesOf(plan)).toBeLessThan(10 * 3 * 2);
    expect(trianglesOf(plan)).toBeGreaterThan(0);
  });

  it('lays a front that is not square to the road in whole triangles, none inside its own walls', () => {
    // A shop 20 m by 10 m turned 25° off the road: its front runs from 6.7 m out to 15.2 m.
    const turn = (25 * Math.PI) / 180;
    const corners = [
      [-10, -5],
      [10, -5],
      [10, 5],
      [-10, 5],
    ].map(
      ([a, n]) =>
        [
          1_100 + (a as number) * Math.cos(turn) - (n as number) * Math.sin(turn),
          15.5 + (a as number) * Math.sin(turn) + (n as number) * Math.cos(turn),
        ] as const,
    );
    const [near, far] = [corners[0], corners[1]] as [
      readonly [number, number],
      readonly [number, number],
    ];
    expect(near[1]).toBeCloseTo(6.74, 2);
    expect(far[1]).toBeCloseTo(15.19, 2);
    const town = street([], {
      buildings: (profile, origin) => [buildingBeside(profile, origin, [corners], 6.5)],
    });
    const plan = planned(town).plans[0] as FootprintPlan;
    const vertices = apronVertices(town, plan);
    expect(vertices.length).toBeGreaterThan(0);
    const [nearest, farthest] = span(vertices.map((vertex) => vertex.distance));
    expect(nearest).toBeCloseTo(KERB_LINE, 2);
    expect(farthest).toBeCloseTo(far[1], 1);
    const [first, last] = span(vertices.map((vertex) => vertex.along));
    expect(first).toBeCloseTo(near[0], 1);
    expect(last).toBeCloseTo(far[0], 1);
    for (let at = 0; at + 2 < vertices.length; at += 3) {
      const [a, b, c] = [vertices[at], vertices[at + 1], vertices[at + 2]] as ApronVertex[];
      if (a === undefined || b === undefined || c === undefined) throw new Error('no triangle');
      // In plan, with the road up `along`: twice its area, and never a sliver of none.
      const twice = Math.abs(
        (b.along - a.along) * (c.lateral - a.lateral) -
          (b.lateral - a.lateral) * (c.along - a.along),
      );
      expect(twice).toBeGreaterThan(0.01);
      // Never behind the wall's line, which rises 25° along the road from its near end.
      for (const corner of [a, b, c]) {
        const wall = near[1] + (corner.along - near[0]) * Math.tan(turn);
        expect(corner.lateral).toBeLessThan(wall + 0.01);
      }
    }
    expect(trianglesOf(plan)).toBe(vertices.length / 3);
    // Fewer than a square front's: the pieces past the wall's line at both of a column's edges
    // are not written. Six columns in eight pieces would be 96.
    expect(trianglesOf(plan)).toBeLessThan(96);
    expect(plan.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
  });

  /** A rectangle `2 × half` along its front by `2 × deep`, turned `degrees` about `(along, lateral)`. */
  const turned = (
    along: number,
    lateral: number,
    half: number,
    deep: number,
    degrees: number,
  ): (readonly [number, number])[] => {
    const turn = (degrees * Math.PI) / 180;
    return [
      [-half, -deep],
      [half, -deep],
      [half, deep],
      [-half, deep],
    ].map(
      ([a, n]) =>
        [
          along + (a as number) * Math.cos(turn) - (n as number) * Math.sin(turn),
          lateral + (a as number) * Math.sin(turn) + (n as number) * Math.cos(turn),
        ] as const,
    );
  };
  /** A shop whose ground ends at `end` along the road, and a mapped `buildingType` beside it. */
  const besideAShop = (
    end: number,
    neighbour: readonly (readonly [number, number])[],
    buildingType: BuildingFeature['buildingType'],
  ): { readonly town: Town; readonly plans: readonly FootprintPlan[] } => {
    const town = street([{ along: end - 6, lateral: 20 }], {
      buildings: (profile, origin) => [
        {
          ...buildingBeside(profile, origin, [neighbour], 6.5),
          ...NO_BUILDING_FIELDS,
          buildingType,
        },
      ],
    });
    return { town, plans: planned(town).plans };
  };
  /** How far short of `end` the shop's apron stops, metres along the road. */
  const shortOf = (end: number, { town, plans }: ReturnType<typeof besideAShop>): number => {
    const shop = plans[0] as FootprintPlan;
    expect(shop.apron.length).toBeGreaterThan(0);
    return end - span(apronVertices(town, shop).map((vertex) => vertex.along))[1];
  };

  it('keeps off a neighbour’s front porch, whichever of the two the map lists first', () => {
    // A house turned 35° toward the shop: its body clears the shop's ground by 0.4 m, and its
    // full-width porch reaches 1.1 m over it.
    const end = 1_143.6;
    const beside = besideAShop(end, turned(1_150, 14, 4.5, 4, -35), 'house');
    // The shop is planned first, and the porch placed after it: the apron is laid once both are.
    expect(beside.plans[1]?.porch).toBe(true);
    expect(beside.plans[1]?.garage).toBe(false);
    expect(shortOf(end, beside)).toBeCloseTo(3, 1);
    // Control: the same house square to the road, its porch before its own front alone.
    const square = besideAShop(end, turned(1_150, 14, 4.5, 4, 0), 'house');
    expect(square.plans[1]?.porch).toBe(true);
    expect(shortOf(end, square)).toBeCloseTo(0, 1);
  });

  it('keeps off a neighbour’s driveway', () => {
    // A mapped garage turned 40° toward the shop: its driveway runs to the road across the
    // last 5 m of the shop's ground.
    const end = 1_145;
    const beside = besideAShop(end, turned(1_150, 13, 3, 3, -40), 'garage');
    expect(beside.plans[1]?.driveway.length).toBeGreaterThan(0);
    expect(shortOf(end, beside)).toBeCloseTo(6, 1);
    // Control: the same garage square to the road, its driveway straight out past the shop's end.
    const square = besideAShop(end, turned(1_150, 13, 3, 3, 0), 'garage');
    expect(square.plans[1]?.driveway.length).toBeGreaterThan(0);
    expect(shortOf(end, square)).toBeCloseTo(0, 1);
  });

  it('keeps two neighbours’ aprons off each other, and every vertex off every carriageway', () => {
    const town = commercialStreetFixture();
    const land = landClassMask(town.corridor);
    const plans = footprintPlans(town.corridor, land, town.profile, town.origin).plans;
    const aprons = plans.filter((plan) => plan.apron.length > 0);
    expect(aprons.length).toBeGreaterThan(50);
    for (const plan of aprons) {
      for (const vertex of apronVertices(town, plan)) {
        expect(vertex.distance).toBeGreaterThan(KERB_LATERAL_METRES);
      }
    }
    // No apron's middle stands on another's ground.
    const index = mappedBuildingsOf(plans);
    for (const [at, plan] of aprons.entries()) {
      const others = mappedBuildingsOf(aprons.filter((_, each) => each !== at));
      const x = centre(plan.apron, 0);
      const z = centre(plan.apron, 1);
      expect(onMappedGround(index, x, z, 0)).toBe(true);
      expect(onMappedGround(others, x, z, 0)).toBe(false);
    }
  });
});

/** The mean of a ring's `x` (0) or `z` (1). */
function centre(ring: Float32Array, axis: 0 | 1): number {
  let sum = 0;
  for (let at = axis; at < ring.length; at += 2) sum += ring[at] as number;
  return sum / (ring.length / 2);
}

describe('an apron on the ground — #2848', () => {
  /** A mapped shop on unzoned land, so the ground under it is the hillside's own, not a town's levelled. */
  const retail = (along: number, lateral: number) => {
    return (profile: RouteProfile, origin: CorridorOrigin): BuildingFeature => ({
      ...buildingBeside(profile, origin, [rectangleBeside(along, lateral, 12, 10)], 6.5),
      ...NO_BUILDING_FIELDS,
      buildingType: 'retail',
    });
  };
  // #1540's road: level to 1 500 m, then a steady 8 % climb.
  const profile = footprintFixtureRoute();
  const origin = corridorOrigin(profile);
  const town: Town = {
    profile,
    origin,
    corridor: {
      routeId: 'shop-aprons-hill',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [],
      buildings: [retail(2_000, 17)(profile, origin), retail(2_100, -17)(profile, origin)],
      paths: [],
      streets: [],
    },
  };
  const { plans, land } = planned(town);
  const seed = scatterSeed(profile);
  const groundAt = (vertex: Pick<ApronVertex, 'along' | 'lateral'>): number =>
    terrainHeightAt(profile, origin, seed, vertex.along, vertex.lateral, land);

  it('stands every vertex 5 cm above the drawn ground beneath it, up an 8 % climb', () => {
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      const vertices = apronVertices(town, plan);
      expect(vertices.length).toBeGreaterThan(0);
      for (const vertex of vertices) {
        expect(vertex.y - groundAt(vertex)).toBeCloseTo(APRON.lift, 3);
      }
      // And it does climb: 12 m of front at 8 % is nearly a metre.
      const [lowest, highest] = span(vertices.map((vertex) => vertex.y));
      expect(highest - lowest).toBeGreaterThan(0.9);
    }
  });

  it('is laid in pieces no longer than 2 m to the kerb and no wider than 3.6 m along the wall', () => {
    for (const plan of plans) {
      const vertices = apronVertices(town, plan);
      for (let at = 0; at + 2 < vertices.length; at += 3) {
        const corners = [vertices[at], vertices[at + 1], vertices[at + 2]] as ApronVertex[];
        const [nearest, farthest] = span(corners.map((corner) => corner.distance));
        const [first, last] = span(corners.map((corner) => corner.along));
        expect(farthest - nearest).toBeLessThanOrEqual(APRON.piece + SLACK);
        expect(last - first).toBeLessThanOrEqual(APRON.column + SLACK);
      }
    }
  });

  it('neither sinks into the ground nor floats over it between its vertices', () => {
    let sampled = 0;
    for (const plan of plans) {
      const vertices = apronVertices(town, plan);
      for (let at = 0; at + 2 < vertices.length; at += 3) {
        const corners = [vertices[at], vertices[at + 1], vertices[at + 2]] as ApronVertex[];
        // The triangle's middle, and each of its edges' middles.
        const points = [
          [1 / 3, 1 / 3, 1 / 3],
          [1 / 2, 1 / 2, 0],
          [0, 1 / 2, 1 / 2],
          [1 / 2, 0, 1 / 2],
        ] as const;
        for (const weights of points) {
          const mix = (read: (corner: ApronVertex) => number): number =>
            corners.reduce(
              (sum, corner, index) => sum + read(corner) * (weights[index] as number),
              0,
            );
          const x = mix((corner) => corner.x);
          const z = mix((corner) => corner.z);
          const near = nearestOnDrawnRoad(profile, origin, x, z, 200);
          if (near === undefined) throw new Error('an apron is nowhere near the road');
          const above = mix((corner) => corner.y) - groundAt(near);
          // Its lift over the ground to half a centimetre: neither in the ground's plane nor
          // standing off it, the verge's foot and the hillside's bends included.
          expect(Math.abs(above - APRON.lift)).toBeLessThan(0.005);
          sampled += 1;
        }
      }
    }
    expect(sampled).toBeGreaterThan(100);
  });

  it('is painted as paving, facing up, its joints running from the wall to the kerb', () => {
    const plan = plans[0] as FootprintPlan;
    const floats = plan.triangles.apron;
    const vertices = apronVertices(town, plan);
    for (const [index, vertex] of vertices.entries()) {
      const at = index * FOOTPRINT_VERTEX_FLOATS;
      // Its normal.
      expect([floats[at + 3], floats[at + 4], floats[at + 5]]).toEqual([0, 1, 0]);
      // Its cladding: the driveway's paving, which the shader paints.
      expect(floats[at + STYLE_OFFSET]).toBe(CLAD_PAVING);
      // The shader's joints are across its `v`: metres along the wall, from the front's middle.
      expect(floats[at + 9]).toBeCloseTo(vertex.along - 2_000, 1);
      // And its `u` metres out from the wall, whose line is 12 m from the centreline.
      expect(floats[at + 8]).toBeCloseTo(12 - vertex.distance, 1);
    }
  });

  it('is wound to face up, every triangle', () => {
    for (const plan of plans) {
      const vertices = apronVertices(town, plan);
      for (let at = 0; at + 2 < vertices.length; at += 3) {
        const [a, b, c] = [vertices[at], vertices[at + 1], vertices[at + 2]] as ApronVertex[];
        if (a === undefined || b === undefined || c === undefined) throw new Error('no triangle');
        const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        expect(up).toBeGreaterThan(0);
      }
    }
  });
});

describe('an apron in a city centre — #2848', () => {
  const CITY: UrbanClassMap = { classAt: () => 'city-centre' };
  // A shop each side, its front 12 m from the centreline: 5 m behind a city's 3.5 m pavement.
  const shops: readonly Shop[] = [
    { along: 1_100, lateral: 18 },
    { along: 1_100, lateral: -18 },
  ];
  const mapped = (plans: readonly FootprintPlan[]): FootprintPlan[] =>
    plans.filter((plan) => plan.apron.length > 0);

  it('stops at the back of the city’s pavement, which the street lays there', () => {
    const town = street(shops);
    const { plans, land } = planned(town, {}, CITY);
    const aprons = mapped(plans);
    expect(aprons).toHaveLength(2);
    const back = KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES;
    for (const plan of aprons) {
      const [nearest] = span(apronVertices(town, plan).map((vertex) => vertex.distance));
      expect(nearest).toBeCloseTo(back, 2);
    }
    // The pavement the ride draws there reaches exactly as far: its vertices' farthest.
    const streets = streetsAt(
      town.profile,
      town.origin,
      scatterSeed(town.profile),
      1_050,
      1_150,
      pavementSides(town.corridor, town.profile, town.origin),
      land,
      CITY,
    );
    expect(streets.length).toBeGreaterThan(0);
    let farthest = 0;
    for (const { pavement } of streets) {
      for (let at = 0; at < pavement.positions.length; at += 3) {
        const near = nearestOnDrawnRoad(
          town.profile,
          town.origin,
          pavement.positions[at] as number,
          pavement.positions[at + 2] as number,
          50,
        );
        farthest = Math.max(farthest, near?.distance ?? 0);
      }
    }
    expect(farthest).toBeCloseTo(back, 2);
  });

  it('runs to the kerb on the side a city lays no pavement: a sidewalk mapped across the road only', () => {
    // A sidewalk on the LEFT, 5 m out, the whole street long: #1637 paves that side alone.
    const town = street(shops, {
      paths: (profile, origin) => [sidewalk(profile, origin, 950, 1_250, -5)],
    });
    const aprons = mapped(planned(town, {}, CITY).plans);
    // The left shop has the map's own pavement before it, and none of ours.
    expect(aprons).toHaveLength(1);
    const vertices = apronVertices(town, aprons[0] as FootprintPlan);
    expect((vertices[0] as ApronVertex).lateral).toBeGreaterThan(0);
    expect(span(vertices.map((vertex) => vertex.distance))[0]).toBeCloseTo(KERB_LINE, 2);
  });

  it('lays none where the wall stands on the pavement’s back, or within 0.2 m of it', () => {
    const deep = (lateral: number): number => {
      const town = street([{ along: 1_100, lateral }]);
      const aprons = mapped(planned(town, {}, CITY).plans);
      if (aprons.length === 0) return 0;
      const [nearest, farthest] = span(
        apronVertices(town, aprons[0] as FootprintPlan).map((vertex) => vertex.distance),
      );
      return farthest - nearest;
    };
    // The pavement's back is 7 m from the centreline; the shop's front is 6 m nearer than its middle.
    expect(deep(13.5)).toBeCloseTo(0.5, 2);
    expect(deep(13.1)).toBe(0);
    expect(deep(12.5)).toBe(0);
  });

  it('runs to the kerb with no urban class at all', () => {
    const town = street(shops);
    for (const plan of mapped(planned(town).plans)) {
      const [nearest] = span(apronVertices(town, plan).map((vertex) => vertex.distance));
      expect(nearest).toBeCloseTo(KERB_LINE, 2);
    }
    // `NO_PAVEMENT_DATA` is what a ride with no corridor hands the streets.
    expect(NO_PAVEMENT_DATA.sideAt(1_100)).toBe('unknown');
  });
});

describe('an apron’s budget — #2848', () => {
  const town = commercialStreetFixture();
  const land = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, land, town.profile);
  const plan = (options: FootprintPlanOptions = {}): readonly FootprintPlan[] =>
    footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options).plans;
  const on = plan();
  const off = plan({ shopAprons: false });

  it('counts its triangles in the plan’s, inside the plan’s cap', () => {
    for (const each of on) {
      const written = FOOTPRINT_ROLES.reduce(
        (sum, role) => sum + each.triangles[role].length / (3 * FOOTPRINT_VERTEX_FLOATS),
        0,
      );
      expect(each.triangleCount).toBe(written);
      expect(each.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    }
    // A block's apron: four columns of four pieces before 12 m of front, 6.4 m from the kerb.
    const block = on.find((each) => each.buildingArchetype === 'main-street') as FootprintPlan;
    expect(trianglesOf(block)).toBe(4 * 4 * 2);
  });

  it('draws the main street inside the frame’s triangles and in no more draw calls', () => {
    const selection = new MappedSelection();
    const frames: number[][] = [];
    for (const along of [900, 1_000, 1_100, 1_200, 1_300, 1_400]) {
      const frame = drawnRoadFrame(town.profile, town.origin, along);
      if (frame === undefined) throw new Error('the fixture road has no direction there');
      const row: number[] = [along];
      for (const plans of [off, on]) {
        selectMappedBuildings(
          mappedBuildingsOf(plans),
          frame.x,
          frame.z,
          MAPPED_BUILDING_TRIANGLES,
          selection,
        );
        expect(selection.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
        expect(selection.surfaces.length).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
        row.push(selection.count, selection.triangles, selection.surfaces.length);
      }
      frames.push(row);
    }
    // Along, then buildings, triangles and surfaces without the aprons and with them: the
    // same buildings in the same surfaces, and 32 triangles more for each block drawn near.
    expect(frames).toEqual([
      [900, 36, 1_086, 2, 36, 1_342, 2],
      [1_000, 36, 1_810, 2, 36, 2_514, 2],
      [1_100, 36, 2_564, 2, 36, 3_716, 2],
      [1_200, 36, 2_544, 2, 36, 3_696, 2],
      [1_300, 36, 2_544, 2, 36, 3_696, 2],
      [1_400, 36, 1_790, 2, 36, 2_494, 2],
    ]);
  });

  it('lays none where it would put its plan past the cap', () => {
    // A shop 70 m along the road, its back saw-toothed and its yards mapped as holes: with
    // ten yards its walls, parapets and roof are 604 of a plan's 640 triangles.
    const holed = (holes: number) => {
      return (profile: RouteProfile, origin: CorridorOrigin): BuildingFeature[] => {
        const outer: [number, number][] = [
          [1_165, 8],
          [1_235, 8],
        ];
        for (let tooth = 0; tooth < 12; tooth += 1) {
          outer.push([1_235 - (70 * (tooth + 0.5)) / 12, tooth % 2 === 0 ? 32 : 28]);
        }
        const yards = Array.from({ length: holes }, (_, index) =>
          rectangleBeside(1_170 + index * 4.4, 18, 2.2, 8),
        );
        return [buildingBeside(profile, origin, [outer, ...yards], 6.5)];
      };
    };
    const only = (town: Town, options: FootprintPlanOptions = {}): FootprintPlan => {
      const { plans } = planned(town, options);
      expect(plans).toHaveLength(1);
      return plans[0] as FootprintPlan;
    };
    // The same front either way: 20 columns of three pieces.
    const apron = 20 * 3 * 2;
    const few = only(street([], { buildings: holed(6) }));
    expect(trianglesOf(few)).toBe(apron);
    expect(few.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    const without = only(street([], { buildings: holed(10) }), { shopAprons: false });
    expect(without.triangleCount).toBeLessThanOrEqual(FOOTPRINT_MAX_TRIANGLES);
    expect(without.triangleCount + apron).toBeGreaterThan(FOOTPRINT_MAX_TRIANGLES);
    const many = only(street([], { buildings: holed(10) }));
    expect(many.apron).toHaveLength(0);
    expect(many.triangles.apron).toHaveLength(0);
    expect(many.triangleCount).toBe(without.triangleCount);
  });
});

describe('an apron’s ground is cleared, as a driveway’s is — #2848', () => {
  // A shop whose front is 15 m from the centreline: 11.4 m of apron.
  const town = street([{ along: 1_100, lateral: 21, length: 35 }]);
  const { plans } = planned(town);
  const plan = plans[0] as FootprintPlan;
  /** THE CONTROL: the same plans, drawn the same, with no apron's outline to clear. */
  const stripped = plans.map((each) => ({ ...each, apron: new Float32Array(0) }));
  // On the apron 5 m from the centreline: 10 m from the shop's wall, past #1534's 6 m margin.
  const at = drawnRoadFrame(town.profile, town.origin, 1_100);
  if (at === undefined) throw new Error('the fixture road has no direction there');
  const x = at.x + at.normalX * 5;
  const z = at.z + at.normalZ * 5;
  const item = (kind: ScatterItem['kind']): ScatterItem => ({
    kind,
    x,
    y: 0,
    z,
    rotation: Math.atan2(at.normalX, at.normalZ),
    scale: 1,
    variant: 0,
  });

  it('clears trees, shrubs and rocks off it', () => {
    expect(plan.apron.length).toBeGreaterThan(0);
    const natural = [item('tree-broadleaf'), item('shrub'), item('rock')];
    expect(clearOfMappedBuildings(natural, mappedBuildingsOf(plans))).toHaveLength(0);
    expect(clearOfMappedBuildings(natural, mappedBuildingsOf(stripped))).toHaveLength(3);
  });

  it('takes a roadside hedge off it', () => {
    const hedge = [item('hedge')];
    expect(clearOfDriveways(hedge, mappedBuildingsOf(plans))).toHaveLength(0);
    expect(clearOfDriveways(hedge, mappedBuildingsOf(stripped))).toHaveLength(1);
  });

  it('takes the apron into the building’s reach', () => {
    // The shop's own corners are 18.5 m from its middle; the kerb's corners are 24.6 m.
    const reach = mappedBuildingsOf(plans).radii[0] as number;
    const bare = mappedBuildingsOf(stripped).radii[0] as number;
    expect(bare).toBeCloseTo(Math.hypot(17.5, 6), 1);
    expect(reach).toBeCloseTo(Math.hypot(17.5, 21 - KERB_LINE), 1);
  });

  it('stands no procedural lot on it', () => {
    // A shed-sized lot on the apron: 2 m by 2 m.
    const lot = placeLot(new Float64Array(LOT_FLOATS), x, z, { x: 1, back: -1, front: 1 }, 0);
    expect(mappedTown(town.corridor, plans).overlaps(lot)).toBe(true);
    expect(mappedTown(town.corridor, stripped).overlaps(lot)).toBe(false);
  });
});

describe('the belt draws an apron — #2848', () => {
  const textures = new Map(
    PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
      surface,
      {
        colour: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
        normal: { image: { width: 512, height: 512 }, dispose: () => undefined } as never,
      },
    ]),
  );
  const belts: MappedBuildingBelt[] = [];
  afterEach(() => {
    for (const belt of belts.splice(0)) belt.dispose();
  });
  const town = commercialStreetFixture();
  const land = landClassMask(town.corridor);
  const urban = urbanClassMap(town.corridor, land, town.profile);
  const plansWith = (options: FootprintPlanOptions): readonly FootprintPlan[] =>
    footprintPlans(town.corridor, land, town.profile, town.origin, undefined, urban, options).plans;
  const refilled = (plans: readonly FootprintPlan[], along: number) => {
    const frame = drawnRoadFrame(town.profile, town.origin, along);
    if (frame === undefined) throw new Error('the fixture road has no direction there');
    const belt = new MappedBuildingBelt(mappedBuildingsOf(plans), textures);
    belts.push(belt);
    return { belt, stats: belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES), frame };
  };

  it('uploads each near shop’s apron after its other roles, unpainted, unshaded and not grounded', () => {
    const plans = plansWith({});
    const { belt, stats, frame } = refilled(plans, 1_200);
    const position = belt.mesh.geometry.getAttribute('position');
    const colour = belt.mesh.geometry.getAttribute('color');
    let aprons = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      const each = plans[drawn.plan] as FootprintPlan;
      if (each.apron.length === 0) continue;
      // Every block drawn from the middle of the main street is near.
      const apart = Math.hypot(each.centroid.x - frame.x, each.centroid.z - frame.z);
      expect(apart).toBeLessThanOrEqual(MAPPED_BUILDING_NEAR_METRES);
      expect(drawn.far).toBe(false);
      // The apron is the last of the walls' run: brick's, where the roof wears another surface.
      expect(each.surfaces.roof).not.toBe(each.surfaces.wall);
      let at = drawn.wallAt;
      for (const role of NEAR_ROLES) {
        if (role === 'apron') break;
        if (role === 'roof' || role === 'dormer-roof' || role === 'porch-roof') continue;
        at += each.triangles[role].length / FOOTPRINT_VERTEX_FLOATS;
      }
      const floats = each.triangles.apron;
      for (let vertex = 0; vertex < floats.length / FOOTPRINT_VERTEX_FLOATS; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          expect(position.array[(at + vertex) * 3 + axis]).toBe(
            floats[vertex * FOOTPRINT_VERTEX_FLOATS + axis],
          );
          expect(colour.array[(at + vertex) * 3 + axis]).toBe(1);
        }
      }
      aprons += 1;
    }
    expect(aprons).toBeGreaterThan(10);
  });

  it('draws no apron at the far level', () => {
    // From 200 m before the main street, every block in reach is past the near level.
    const on = refilled(plansWith({}), 800);
    const off = refilled(plansWith({ shopAprons: false }), 800);
    let far = 0;
    for (let place = 0; place < on.stats.buildings; place += 1) {
      const drawn = on.belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      if (on.belt.buildings.plans[drawn.plan]?.apron.length === 0) continue;
      expect(drawn.far).toBe(true);
      far += 1;
    }
    expect(far).toBeGreaterThan(10);
    expect(on.stats.triangles).toBe(off.stats.triangles);
  });

  it('draws the aprons in the walls’ own call: as many calls as without them', () => {
    const on = refilled(plansWith({}), 1_200).stats;
    const off = refilled(plansWith({ shopAprons: false }), 1_200).stats;
    expect(on.buildings).toBe(off.buildings);
    expect(on.drawCalls).toBe(off.drawCalls);
    expect(on.triangles).toBeGreaterThan(off.triangles);
    expect(on.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
  });
});

describe('`shop-aprons.ts`’ own rules — #2848', () => {
  /** A straight road up `z` at `x = 0`: the kerb's line is 3.6 m either side. */
  const site = (overrides: Partial<ApronSite> = {}): ApronSite => ({
    beside: (x) =>
      x === 0
        ? undefined
        : { towardX: -Math.sign(x), towardZ: 0, distance: Math.abs(x), kerb: KERB_LINE },
    clear: () => true,
    free: () => true,
    footwayNear: () => false,
    bends: [],
    ...overrides,
  });
  /** A front `length` long at `x = 8`, facing the road. */
  const front = (length: number, turned = 0): ApronFront => ({
    mx: 8,
    mz: 100,
    ex: -Math.sin(turned),
    ez: Math.cos(turned),
    nx: -Math.cos(turned),
    nz: -Math.sin(turned),
    length,
  });

  it('cuts a front into columns no wider than 3.6 m and pieces no longer than 2 m', () => {
    const apron = shopApron(front(10), site());
    if (apron === undefined) throw new Error('the front has no apron');
    // 10 m of front is three columns; 4.4 m of ground three pieces.
    expect(apron.stations).toHaveLength(4);
    expect(apron.levels).toHaveLength(4);
    expect(apron.triangleCount).toBe(3 * 3 * 2);
    for (const station of apron.stations) {
      expect(station.depth).toBeCloseTo(4.4, 6);
      expect(station.kerbX).toBeCloseTo(KERB_LINE, 6);
    }
    // Its outline: along the wall, then back along the kerb's line.
    expect(apron.ring).toHaveLength(16);
  });

  it('cuts a column on each line the ground bends on, and on none within 5 cm of its own edge', () => {
    const levels = (bends: readonly number[], wall = 8): readonly number[] | undefined =>
      shopApron({ ...front(10), mx: wall }, site({ bends }))?.levels.map(
        (level) => Math.round(level * 1_000) / 1_000,
      );
    // No bend: 4.4 m in three pieces.
    expect(levels([])).toEqual([3.6, 5.067, 6.533, 8]);
    // A bend at 6 m: a piece ends on it, and each side of it is cut to 2 m again.
    expect(levels([6])).toEqual([3.6, 4.8, 6, 8]);
    expect(levels([4.1, 6])).toEqual([3.6, 4.1, 6, 8]);
    // Bends outside the ground, and on its own edges, cut nothing.
    expect(levels([3.5, 3.6, 8, 12])).toEqual([3.6, 5.067, 6.533, 8]);
    // A bend 3 cm inside the wall's line is no piece of its own: the wall is 8.03 m out.
    expect(levels([8], 8.03)).toEqual([3.6, 5.077, 6.553, 8.03]);
    expect(levels([7.9], 8.03)).toEqual([3.6, 5.033, 6.467, 7.9, 8.03]);
  });

  it('lays none before a front turned more than 60° from the road, or away from it', () => {
    const turned = (degrees: number): ApronFront => front(10, (degrees * Math.PI) / 180);
    expect(shopApron(turned(55), site())).toBeDefined();
    expect(shopApron(turned(65), site())).toBeUndefined();
    expect(shopApron(turned(180), site())).toBeUndefined();
  });

  it('lays the longest unbroken run of columns, and the first of two as long', () => {
    // Seven columns of a 25 m front, each 3.57 m; the ground is taken at the third and the sixth.
    const taken = (columns: readonly number[]): ApronSite =>
      site({
        free: (ring) => {
          const middle = ((ring[1] as number) + (ring[3] as number)) / 2;
          const column = Math.floor((middle - 87.5) / (25 / 7));
          return !columns.includes(column);
        },
      });
    const first = shopApron(front(25), taken([2, 5]));
    expect(first?.stations).toHaveLength(3);
    expect(first?.stations[0]?.along).toBeCloseTo(-12.5, 6);
    const longest = shopApron(front(25), taken([1]));
    expect(longest?.stations).toHaveLength(6);
    expect(longest?.stations[0]?.along).toBeCloseTo(-12.5 + (2 * 25) / 7, 6);
    expect(shopApron(front(25), site({ free: () => false }))).toBeUndefined();
  });

  it('drops a column with any vertex on ground it may not cover, the wall’s foot and the kerb’s line included', () => {
    const whole = shopApron(front(10), site());
    for (const [x, z] of [
      [8, 95],
      [KERB_LINE, 95],
      [8 - 4.4 / 3, 95],
    ] as const) {
      const apron = shopApron(
        front(10),
        site({ clear: (px, pz) => !(Math.abs(px - x) < 1e-6 && Math.abs(pz - z) < 1e-6) }),
      );
      // The first column's edge is at z = 95: two columns are left.
      expect(apron?.triangleCount).toBe((whole?.triangleCount ?? 0) - 3 * 2);
    }
  });

  it('holds a column’s ground off its own edges when it asks whether the ground is free', () => {
    const rings: Float32Array[] = [];
    shopApron(
      front(10),
      site({
        free: (ring) => {
          rings.push(ring);
          return true;
        },
      }),
    );
    expect(rings).toHaveLength(3);
    for (const ring of rings) {
      const xs = [ring[0], ring[2], ring[4], ring[6]] as number[];
      expect(Math.max(...xs)).toBeCloseTo(8 - APRON.inset, 4);
      expect(Math.min(...xs)).toBeCloseTo(KERB_LINE + APRON.inset, 4);
    }
    // And off the lines of its sides: the first column's are z = 95 and z = 98.33.
    const zs = [rings[0]?.[1], rings[0]?.[3], rings[0]?.[5], rings[0]?.[7]] as number[];
    expect(Math.min(...zs)).toBeCloseTo(95 + APRON.inset, 4);
    expect(Math.max(...zs)).toBeCloseTo(95 + 10 / 3 - APRON.inset, 4);
  });

  it('stops filing a map that is more than its grids take, and says so', () => {
    // A hostile tile: lines across 6 km of it each way, each one's box some 35 000 cells.
    const lines = Array.from({ length: 80 }, (_, index) =>
      Float32Array.of(-3_000, -3_000 + index, 3_000, 3_000 + index),
    );
    const paths: PathFeature[] = lines.map((line) => ({
      kind: 'path',
      kindDetail: 'footway',
      line,
    }));
    const streets: StreetFeature[] = lines.map((line) => ({
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line,
    }));
    expect(new ApronObstacles(paths, [], () => false).overflowed).toBe(true);
    expect(new ApronObstacles([], streets, () => false).overflowed).toBe(true);
    // A street or two, and a town's worth of short ones, are well inside it.
    expect(new ApronObstacles(paths.slice(0, 2), streets.slice(0, 2), () => false).overflowed).toBe(
      false,
    );
    // The bound is the constructor's: a short street takes three cells, so five hold one and not two.
    const short = (z: number): StreetFeature => ({
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: Float32Array.of(0, z, 40, z),
    });
    const within = (streets: StreetFeature[]): boolean =>
      !new ApronObstacles([], streets, () => false, undefined, 5).overflowed;
    expect(within([short(10)])).toBe(true);
    expect(within([short(10), short(500)])).toBe(false);
  });

  it('measures a footway against the ground’s edges: 2 m, and not a hair more', () => {
    const path = (x: number): PathFeature => ({
      kind: 'path',
      kindDetail: 'footway',
      line: Float32Array.of(x, 80, x, 120),
    });
    const ring = Float32Array.of(8, 95, 8, 105, KERB_LINE, 105, KERB_LINE, 95);
    const near = (x: number): boolean =>
      new ApronObstacles([path(x)], [], () => false).footwayNear(ring);
    expect(near(8 + APRON.footway - 0.01)).toBe(true);
    expect(near(8 + APRON.footway + 0.01)).toBe(false);
    expect(near(KERB_LINE - APRON.footway + 0.01)).toBe(true);
    expect(near(KERB_LINE - APRON.footway - 0.01)).toBe(false);
  });
});
