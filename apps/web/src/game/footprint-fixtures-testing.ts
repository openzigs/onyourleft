// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mapped footprints for #1540's plans to be asserted over — built from
 * arithmetic, in local metres, beside routes from `route-fixtures-testing.ts`.
 * Nothing here is a real place, and no OpenStreetMap data.
 *
 * ⚠️ **A `-testing.ts` file**, test support to `check-wiring.mjs`: imported by
 * Vitest suites and by nothing that ships.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, LandUseFeature } from '@onyourleft/map-features';

import type { FootprintVerdict } from './footprint-buildings';
import { northRoute } from './route-fixtures-testing';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** A point `lateral` metres out from the drawn road at `along`, on its normal's side when positive. */
export function besideRoad(
  profile: RouteProfile,
  origin: CorridorOrigin,
  along: number,
  lateral: number,
): readonly [number, number] {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) throw new Error('the fixture road has no direction there');
  return [frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral];
}

/**
 * A ring of `(along, lateral)` pairs beside a straight road, as local metres.
 * Its winding is whatever the pairs give: the plans must not depend on it.
 */
export function ringBeside(
  profile: RouteProfile,
  origin: CorridorOrigin,
  pairs: readonly (readonly [number, number])[],
): Float32Array {
  return Float32Array.from(
    pairs.flatMap(([along, lateral]) => [...besideRoad(profile, origin, along, lateral)]),
  );
}

/** A rectangle `length` along the road by `depth` across it, centred at `(along, lateral)`. */
export function rectangleBeside(
  along: number,
  lateral: number,
  length: number,
  depth: number,
): readonly (readonly [number, number])[] {
  return [
    [along - length / 2, lateral - depth / 2],
    [along + length / 2, lateral - depth / 2],
    [along + length / 2, lateral + depth / 2],
    [along - length / 2, lateral + depth / 2],
  ];
}

/** A regular polygon of `sides` about `(along, lateral)`. */
export function polygonBeside(
  along: number,
  lateral: number,
  radius: number,
  sides: number,
  phase = 0.1,
): readonly (readonly [number, number])[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (2 * Math.PI * index) / sides + phase;
    return [along + radius * Math.cos(angle), lateral + radius * Math.sin(angle)] as const;
  });
}

/** A star of `points` vertices about `(along, lateral)`, alternately `outer` and `inner` out. */
export function starBeside(
  along: number,
  lateral: number,
  outer: number,
  inner: number,
  points: number,
): readonly (readonly [number, number])[] {
  return Array.from({ length: points }, (_, index) => {
    const angle = (2 * Math.PI * index) / points;
    const radius = index % 2 === 0 ? outer : inner;
    return [along + radius * Math.cos(angle), lateral + radius * Math.sin(angle)] as const;
  });
}

/** A building's footprint from rings of `(along, lateral)` pairs. */
export function buildingBeside(
  profile: RouteProfile,
  origin: CorridorOrigin,
  rings: readonly (readonly (readonly [number, number])[])[],
  heightMetres: number | null = null,
  part?: { readonly minHeightMetres: number },
): BuildingFeature {
  return {
    kind: part === undefined ? 'building' : 'building_part',
    heightMetres,
    minHeightMetres: part?.minHeightMetres ?? null,
    rings: rings.map((ring) => ringBeside(profile, origin, ring)),
  };
}

/** A land-use rectangle from `from` to `to` along the road and `near` to `far` across it. */
export function landBeside(
  profile: RouteProfile,
  origin: CorridorOrigin,
  layer: LandUseFeature['layer'],
  kind: string,
  from: number,
  to: number,
  near: number,
  far: number,
): LandUseFeature {
  return {
    layer,
    kind,
    rings: [
      ringBeside(profile, origin, [
        [from, near],
        [to, near],
        [to, far],
        [from, far],
      ]),
    ],
  };
}

/**
 * #1540's verdict fixture's road: 1.5 km level, then a steady 8 % climb to
 * 3 km. Every footprint but the steep one stands on the level.
 */
export function footprintFixtureRoute(): RouteProfile {
  return northRoute(3_000, (along) => (along <= 1_500 ? 10 : 10 + (along - 1_500) * 0.08));
}

/** The named footprints of {@link footprintFixture}, and the verdict each must come to. */
export const FOOTPRINT_FIXTURE_VERDICTS = {
  gable: 'kept',
  ell: 'kept',
  tower: 'kept',
  commercial: 'kept',
  industrial: 'kept',
  courtyard: 'kept',
  ring200: 'kept',
  wide: 'kept',
  part: 'kept',
  low: 'kept',
  barn: 'kept',
  farmhouse: 'kept',
  inWood: 'on-excluded-land',
  inPark: 'on-excluded-land',
  inLake: 'on-excluded-land',
  onRoad: 'on-road',
  steep: 'too-steep',
  shed: 'too-small',
  warehouse: 'too-large',
} as const satisfies Readonly<Record<string, FootprintVerdict>>;

export type FootprintFixtureName = keyof typeof FOOTPRINT_FIXTURE_VERDICTS;

/**
 * #1540's verdict fixture: built-up, farmland, wood, park and water beside
 * {@link footprintFixtureRoute}, every tile covered, and a footprint for each
 * case the rules and the shape rules name — {@link FOOTPRINT_FIXTURE_VERDICTS}.
 */
export function footprintFixture(): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
  readonly named: Readonly<Record<FootprintFixtureName, BuildingFeature>>;
} {
  const profile = footprintFixtureRoute();
  const origin = corridorOrigin(profile);
  const land = (
    layer: LandUseFeature['layer'],
    kind: string,
    from: number,
    to: number,
    near: number,
    far: number,
  ): LandUseFeature => landBeside(profile, origin, layer, kind, from, to, near, far);
  const building = (
    rings: readonly (readonly (readonly [number, number])[])[],
    height: number | null = null,
    part?: { readonly minHeightMetres: number },
  ): BuildingFeature => buildingBeside(profile, origin, rings, height, part);
  const named: Record<FootprintFixtureName, BuildingFeature> = {
    // Residential, 100–700 m along on the right.
    gable: building([rectangleBeside(330, 40, 14, 10)], 6),
    ell: building([
      [
        [395, 35],
        [409, 35],
        [409, 40],
        [400, 40],
        [400, 45],
        [395, 45],
      ].map(([along, lateral]) => [along as number, lateral as number] as const),
    ]),
    tower: building([rectangleBeside(470, 60, 12, 12)], 30),
    courtyard: building([
      polygonBeside(600, 120, 30, 48),
      polygonBeside(590, 120, 6, 12),
      polygonBeside(612, 118, 5, 10),
    ]),
    wide: building([rectangleBeside(220, 130, 140, 140)], 12),
    part: building([rectangleBeside(520, 120, 12, 12)], 15, { minHeightMetres: 6 }),
    low: building([rectangleBeside(640, 40, 8, 8)], 1.4),
    shed: building([rectangleBeside(380, 120, 3, 3)]),
    // Commercial, 800–1 300 m along on the right.
    commercial: building([rectangleBeside(850, 60, 30, 20)], 9),
    // 200 vertices that each matter: a star, alternately 25 and 22 m out.
    ring200: building([starBeside(950, 150, 25, 22, 200)], 9),
    warehouse: building([rectangleBeside(1_150, 125, 150, 150)], 10),
    // Industrial, 1 050–1 250 m along on the left.
    industrial: building([rectangleBeside(1_150, -100, 60, 40)], 8),
    // Farmland, 1 320–1 480 m along on the right, beside the level road.
    farmhouse: building([rectangleBeside(1_400, 20, 10, 8)]),
    barn: building([
      [
        [1_430, 15],
        [1_442, 15],
        [1_442, 19],
        [1_436, 19],
        [1_436, 25],
        [1_430, 25],
      ].map(([along, lateral]) => [along as number, lateral as number] as const),
    ]),
    // Wood, park and water on the left.
    inWood: building([rectangleBeside(300, -120, 12, 10)]),
    inPark: building([rectangleBeside(520, -120, 12, 10)]),
    inLake: building([rectangleBeside(700, -120, 12, 10)]),
    // Across the carriageway.
    onRoad: building([rectangleBeside(1_050, 3, 8, 8)]),
    // On the 8 % climb, 60 m along it: 4.8 m of the road's own rise under it.
    steep: building([rectangleBeside(2_000, 40, 60, 15)]),
  };
  const corridor: WorldCorridor = {
    routeId: 'footprint-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [
      land('landuse', 'residential', 100, 700, 20, 220),
      land('landuse', 'commercial', 800, 1_300, 20, 220),
      land('landuse', 'industrial', 1_050, 1_250, -220, -20),
      land('landuse', 'farmland', 1_320, 1_480, 12, 220),
      land('landuse', 'farmland', 1_500, 2_500, 20, 220),
      land('landuse', 'wood', 200, 400, -220, -20),
      land('landuse', 'park', 450, 600, -220, -20),
      land('water', 'lake', 650, 750, -220, -20),
    ],
    buildings: Object.values(named),
    paths: [],
  };
  return { profile, origin, corridor, named };
}

/**
 * #1540's performance fixture: the densest town its budget is stated for —
 * `count` 8 × 8 m houses on a 12 m grid either side of 1.2 km of level road,
 * all on residential land. Planned at ride start in at most 400 ms (#1540).
 */
export function denseTownFixture(count = 2_000): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (const side of [1, -1]) {
    for (let along = 110; along < 1_300 && buildings.length < count; along += 12) {
      for (let lateral = 20; lateral < 215 && buildings.length < count; lateral += 12) {
        buildings.push(
          buildingBeside(profile, origin, [rectangleBeside(along, lateral * side, 8, 8)], 6),
        );
      }
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'dense-town',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 100, 1_300, -220, 220)],
      buildings,
      paths: [],
    },
  };
}
