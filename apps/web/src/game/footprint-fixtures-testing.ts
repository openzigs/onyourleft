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
import { FIXTURE_LATITUDE, northRoute } from './route-fixtures-testing';
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
    streets: [],
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
      streets: [],
    },
  };
}

/**
 * #1549's fixture: a town strung along 3 km of level road — 8 × 8 m houses
 * every 12 m, two rows a side at 25 m and 60 m out, all on residential land.
 * From anywhere along its middle more than `MAPPED_BUILDING_MAX` stand within
 * the belt's reach and some stand past its near level, so the count, the
 * budget and the far level all bind in one fixture.
 *
 * #1856: `nearRow` moves the near rows in. At the 25 m default their
 * doorsteps stand 20.5 m out, past a Delivery parcel's reach, so no house in
 * the town can be a Delivery target; at 12 m they stand 7.5 m out, inside it.
 */
export function rowTownFixture(nearRow = 25): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10);
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (let along = 50; along < 2_950; along += 12) {
    for (const lateral of [nearRow, 60, -nearRow, -60]) {
      buildings.push(buildingBeside(profile, origin, [rectangleBeside(along, lateral, 8, 8)], 6));
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'row-town',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [landBeside(profile, origin, 'landuse', 'residential', 10, 2_990, -100, 100)],
      buildings,
      paths: [],
      streets: [],
    },
  };
}

/**
 * #1581's fixture: a town of mixed footprints, as a real map has them, where
 * #1549's are identical boxes in rows. Along 1 km of level road from 1 000 m,
 * both sides: houses every 20 m in two rows, each a rectangle 6 to 14 m along
 * by 6 to 12 m deep, turned up to 15° off the road, 3.5 to 12 m high or with
 * no height mapped; every fifth an L. Residential land to 1 600 m and
 * commercial beyond, so a high street of flat roofs follows the houses. Every
 * number is drawn from a fixed sequence, so the town is the same every run.
 */
export function mixedTownFixture(latitude = FIXTURE_LATITUDE): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10, { latitude });
  const origin = corridorOrigin(profile);
  let state = 0x15_81;
  const next = (): number => {
    // A 32-bit xorshift: a fixed sequence, not a seed the ride reads.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const heights = [null, 3.5, 5, 6, 7, 8.5, 9, 12] as const;
  const buildings: BuildingFeature[] = [];
  for (let along = 1_000; along < 2_000; along += 20) {
    for (const [lateral, row] of [
      [22, 0],
      [-22, 0],
      [48, 1],
      [-48, 1],
    ] as const) {
      const length = 6 + next() * 8;
      const depth = 6 + next() * 6;
      const turn = ((next() * 2 - 1) * 15 * Math.PI) / 180;
      const height = heights[Math.floor(next() * heights.length)] ?? null;
      const ell = (buildings.length + row) % 5 === 0;
      const centreAlong = along + (next() - 0.5) * 4;
      const centreLateral = lateral + (next() - 0.5) * 4;
      const a = length / 2;
      const d = depth / 2;
      const corners: readonly (readonly [number, number])[] = ell
        ? [
            [-a, -d],
            [a, -d],
            [a, 0],
            [0, 0],
            [0, d],
            [-a, d],
          ]
        : [
            [-a, -d],
            [a, -d],
            [a, d],
            [-a, d],
          ];
      const ring = corners.map(
        ([x, y]) =>
          [
            centreAlong + x * Math.cos(turn) - y * Math.sin(turn),
            centreLateral + x * Math.sin(turn) + y * Math.cos(turn),
          ] as const,
      );
      buildings.push(buildingBeside(profile, origin, [ring], height));
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'mixed-town',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(profile, origin, 'landuse', 'residential', 950, 1_600, -70, 70),
        landBeside(profile, origin, 'landuse', 'commercial', 1_600, 2_050, -70, 70),
      ],
      buildings,
      paths: [],
      streets: [],
    },
  };
}

/**
 * #1585's fixture: a Richmond street, the kind of footprint the RVA set was
 * modelled from — along 400 m of level road from 1 000 m, both sides, a lot
 * every 10 m: a house 7 m along the road by 19 m deep, its narrow end to the
 * road, on residential land; and beyond 1 200 m on commercial land a shop
 * 7.5 m by 24 m. Every third lot is instead a square 11 m house or shop,
 * which no model fits, so models and extrusions stand side by side. Every
 * footprint is a rectangle square to the road, with no height mapped, so
 * each is two storeys (#1540's default).
 */
export function richmondStreetFixture(latitude = FIXTURE_LATITUDE): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10, { latitude });
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (let along = 1_000, lot = 0; along < 1_400; along += 10, lot += 1) {
    const shop = along >= 1_200;
    const square = lot % 3 === 2;
    const wide = square ? 11 : shop ? 7.5 : 7;
    const deep = square ? 11 : shop ? 24 : 19;
    for (const side of [1, -1]) {
      buildings.push(
        buildingBeside(profile, origin, [
          rectangleBeside(along, side * (12 + deep / 2), wide, deep),
        ]),
      );
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'richmond-street',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(profile, origin, 'landuse', 'residential', 950, 1_195, -70, 70),
        landBeside(profile, origin, 'landuse', 'commercial', 1_195, 1_450, -70, 70),
      ],
      buildings,
      paths: [],
      streets: [],
    },
  };
}

/** A ring as `(x, y)` corners in metres, from its own origin: `x` along the road and `y` out from it. */
export type ShapeCorners = readonly (readonly [number, number])[];

/**
 * #1660's shapes, each a ring of corners from its own origin: an L (14 × 10 m
 * with a 6 × 5 m notch), a T, a U, a Z (two rectangles stepped), a box at
 * 0.9 rectangularity (14 × 10 m less a 3.5 × 4 m corner), a 12-gon, and a
 * quadrilateral with one edge 20° off the others' axis.
 */
export const ROOF_SHAPES = {
  ell: [
    [0, 0],
    [14, 0],
    [14, 5],
    [8, 5],
    [8, 10],
    [0, 10],
  ],
  tee: [
    [4.5, 0],
    [9.5, 0],
    [9.5, 6],
    [14, 6],
    [14, 10],
    [0, 10],
    [0, 6],
    [4.5, 6],
  ],
  you: [
    [0, 0],
    [14, 0],
    [14, 10],
    [10, 10],
    [10, 5],
    [4, 5],
    [4, 10],
    [0, 10],
  ],
  zed: [
    [0, 0],
    [8, 0],
    [8, 4],
    [14, 4],
    [14, 9],
    [6, 9],
    [6, 5],
    [0, 5],
  ],
  notched: [
    [0, 0],
    [14, 0],
    [14, 6],
    [10.5, 6],
    [10.5, 10],
    [0, 10],
  ],
  dodecagon: Array.from({ length: 12 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 12 + 0.1;
    return [6 + 6 * Math.cos(angle), 6 + 6 * Math.sin(angle)] as const;
  }),
  skewed: [
    [0, 0],
    [14, 0],
    [14 + 10 * Math.tan((20 * Math.PI) / 180), 10],
    [0, 10],
  ],
} as const satisfies Readonly<Record<string, ShapeCorners>>;

/** One of {@link ROOF_SHAPES}. */
export type RoofShapeName = keyof typeof ROOF_SHAPES;

/** A shape's corners as `(along, lateral)` pairs, its origin at `(along, lateral)`. */
export function shapeBeside(
  corners: ShapeCorners,
  along: number,
  lateral: number,
): readonly (readonly [number, number])[] {
  return corners.map(([x, y]) => [along + x, lateral + y] as const);
}

/**
 * #1660's cap fixture: a U whose two arms are 120 m long and 1.6 m wide, a
 * 1 m base across their ends, and a one-sided saw-tooth of 0.7 m every 5.1 m
 * along all four of the arms' long walls — each tooth within the snap of the
 * axis, and too deep for #1540's 0.5 m simplification to remove, so its
 * walls alone are past `FOOTPRINT_MAX_FAR_TRIANGLES` once more vertices than
 * `FOOTPRINT_MAX_VERTICES` are kept.
 */
export function sawToothYou(): ShapeCorners {
  const teeth = 0.7;
  const length = 120;
  const arm = 1.6;
  const gap = 2;
  const step = 5.1;
  // A long wall from `from` to `to` along x at `y`, its teeth pointing `into` the arm.
  const wall = (from: number, to: number, y: number, into: number): [number, number][] => {
    const out: [number, number][] = [];
    const count = Math.round(Math.abs(to - from) / step);
    for (let k = 0; k <= count; k += 1) {
      const x = from + ((to - from) * k) / count;
      out.push([x, k % 2 === 1 && k < count ? y + into * teeth : y]);
    }
    return out;
  };
  return [
    // The first arm's outer wall, out along y = 0; its end; its inner wall back.
    ...wall(0, length, 0, 1),
    ...wall(length, 1, arm, -1),
    // The base, then the second arm's inner wall out and its outer wall back.
    ...wall(1, length, arm + gap, 1),
    ...wall(length, 0, 2 * arm + gap, -1),
  ];
}

/**
 * #1635's fixture: a terraced street, for the owner's by-eye pair on the
 * realistic page (`?town=terrace`). Along 400 m of level road from 1 000 m,
 * both sides, rows of houses that share their side walls: each 6 to 9 m along
 * the road by 12 m deep, its front 14 m out, of a height drawn from a short
 * list so that neighbours are now the same height and now not, and a 6 m
 * alley after every eighth. Residential land to 1 200 m and commercial
 * beyond, as `mixedTownFixture` lays its land, so the press classes the
 * street a town. Every number is drawn from a fixed sequence.
 */
export function terraceStreetFixture(latitude = FIXTURE_LATITUDE): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10, { latitude });
  const origin = corridorOrigin(profile);
  let state = 0x16_35;
  const next = (): number => {
    // A 32-bit xorshift: a fixed sequence, not a seed the ride reads.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const heights = [9, 9, 9, 12, 6, 15] as const;
  const buildings: BuildingFeature[] = [];
  for (const side of [1, -1]) {
    let along = 1_000;
    let inRow = 0;
    while (along < 1_400) {
      const width = 6 + Math.floor(next() * 4);
      const height = heights[Math.floor(next() * heights.length)] ?? 9;
      buildings.push(
        buildingBeside(
          profile,
          origin,
          [rectangleBeside(along + width / 2, side * 20, width, 12)],
          height,
        ),
      );
      along += width;
      inRow += 1;
      if (inRow === 8) {
        along += 6;
        inRow = 0;
      }
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'terrace-street',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(profile, origin, 'landuse', 'residential', 950, 1_200, -70, 70),
        landBeside(profile, origin, 'landuse', 'commercial', 1_200, 1_450, -70, 70),
      ],
      buildings,
      paths: [],
      streets: [],
    },
  };
}

/**
 * #1637's fixture: a city centre along 1 km of level road from 1 000 m, both
 * sides — commercial land 260 m either side, and blocks 20 × 20 m every 25 m
 * along and across, 15 m (five storeys) high, from 32 m out to 252 m, so
 * #1633 reads it as `city-centre` (about 57 % coverage, a median of five
 * storeys) and the first 32 m beside the road is built-up land with no
 * footprint: the frontage #1637's terraced blocks fill. A park 40 m along by
 * 56 m deep beside the road on the right from 1 400 m, which no block may
 * stand on. No street is mapped. `use` is the land's: `residential` is the
 * same blocks on land the map calls houses.
 */
export function cityStreetscapeFixture(
  latitude = FIXTURE_LATITUDE,
  use: 'commercial' | 'residential' = 'commercial',
): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10, { latitude });
  const origin = corridorOrigin(profile);
  const buildings: BuildingFeature[] = [];
  for (let along = 1_012.5; along < 2_000; along += 25) {
    for (let lateral = 42; lateral < 252; lateral += 25) {
      for (const side of [1, -1]) {
        buildings.push(
          buildingBeside(profile, origin, [rectangleBeside(along, side * lateral, 20, 20)], 15),
        );
      }
    }
  }
  return {
    profile,
    origin,
    corridor: {
      routeId: 'city-centre',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        landBeside(profile, origin, 'landuse', use, 1_000, 2_000, -260, 260),
        landBeside(profile, origin, 'landuse', 'park', 1_400, 1_440, 4, 60),
      ],
      buildings,
      paths: [],
      streets: [],
    },
  };
}

/**
 * #1542's countryside, for the owner's by-eye pair on the realistic page
 * (`?town=countryside`): from 900 m to 2 100 m of a level road, fields either
 * side with a gap between two of them, a field set back behind open ground, a
 * wood on each side and a park — every class #1542 plants and bounds by. No
 * building. Every tile covered.
 */
export function countrysideFixture(latitude = FIXTURE_LATITUDE): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const profile = northRoute(3_000, () => 10, { latitude });
  const origin = corridorOrigin(profile);
  const land = (kind: string, from: number, to: number, near: number, far: number) =>
    landBeside(profile, origin, 'landuse', kind, from, to, near, far);
  return {
    profile,
    origin,
    corridor: {
      routeId: 'countryside',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [
        // Positive lateral: two fields with a gap, a wood, a field set back.
        land('farmland', 900, 1_180, 4, 300),
        land('farmland', 1_230, 1_450, 4, 300),
        land('wood', 1_450, 1_700, 4, 300),
        land('farmland', 1_700, 2_100, 40, 300),
        // Negative: a field, a wood 30 m back behind a strip of field, a park.
        land('farmland', 900, 1_350, -300, -4),
        land('wood', 1_350, 1_650, -300, -30),
        land('farmland', 1_350, 1_650, -30, -4),
        land('park', 1_650, 1_850, -300, -4),
        land('farmland', 1_850, 2_100, -300, -4),
      ],
      buildings: [],
      paths: [],
      streets: [],
    },
  };
}
