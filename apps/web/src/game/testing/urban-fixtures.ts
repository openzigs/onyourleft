// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Corridors of known urban class for #1633's `urban-class.ts` — built from
 * arithmetic, in local metres, beside a straight level road from
 * `route-fixtures-testing.ts`. **No OpenStreetMap data, and nothing here is a
 * real place.**
 *
 * A corridor is a list of {@link UrbanStretch}es along the road, each one of
 * the kinds #1633's acceptance criteria name, and optionally stretches where
 * no map data was read ({@link UrbanFixtureOptions.uncovered}). Footprints are
 * 10 × 10 m squares in a grid laid out per 100 m window, so each window holds
 * the same coverage: `columns` along it by `rows` either side of the road,
 * from 12 m to 245 m out. #1633 sweeps 101 samples across, ±250 m, so a
 * window's land is 100 × 505 m and its coverage is
 * `2 × columns × rows × 100 / 50 500`.
 *
 * ⚠️ **Test support** — a file under `testing/`, which `check-wiring.mjs`
 * §`isTestSupport` reads as such: imported by Vitest suites and the browser
 * harness, and by nothing that ships.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, LandUseFeature } from '@onyourleft/map-features';

import { buildingBeside, landBeside, rectangleBeside } from '../footprint-fixtures-testing';
import { northRoute } from '../route-fixtures-testing';
import { corridorOrigin, type CorridorOrigin } from '../terrain';
import type { WorldCorridor } from '../world-data/corridor';

/**
 * - `rural`: farmland, no footprints;
 * - `village`: residential, about 8 % coverage of 2-storey (6 m) houses;
 * - `full-village`: the same at about 13 % coverage, just under a town's
 *   15 %, so a sweep that miscounts its own land by a fifth reads it as one;
 * - `town`: residential, about 26 % coverage of 2-storey houses;
 * - `city-height`: residential, about 44 % coverage of 2-storey houses, six
 *   of them 18 m (6 storeys) near the stretch's middle;
 * - `city-commerce`: about 39 % coverage with no heights mapped, on land 60 %
 *   commercial (±150 m of the road) and residential beyond.
 */
export type UrbanStretchKind =
  'rural' | 'village' | 'full-village' | 'town' | 'city-height' | 'city-commerce';

export interface UrbanStretch {
  readonly kind: UrbanStretchKind;
  /** Metres along the road; whole windows (multiples of 100 m) keep the coverage exact. */
  readonly from: number;
  readonly to: number;
}

export interface UrbanFixtureOptions {
  /** The road's length: 3 km by default. */
  readonly length?: number;
  /** Stretches along the road where no map data was read: no tile covers them. */
  readonly uncovered?: readonly { readonly from: number; readonly to: number }[];
}

/** A footprint's side, in metres. */
const SIDE = 10;
/** Footprints from this far out… */
const NEAREST = 12;
/** …to this far. */
const FARTHEST = 245;
/** Land use reaches past the sweep's ±250 m, so no sample lands on its edge. */
const LAND_REACH = 260;
/** The commercial land of `city-commerce`, either side: 61 of the sweep's 101 samples. */
const COMMERCIAL_REACH = 150;

/** Each kind's grid a window: footprints along it, and rows either side. */
const GRID: Readonly<Record<Exclude<UrbanStretchKind, 'rural'>, readonly [number, number]>> = {
  village: [3, 7],
  'full-village': [3, 11],
  town: [6, 11],
  'city-height': [8, 14],
  'city-commerce': [7, 14],
};

/** The height of every footprint but the towers: 6 m, two storeys. */
const HOUSE_METRES = 6;
/** A tower: 18 m, six storeys. */
const TOWER_METRES = 18;
/** How many towers a `city-height` stretch has. */
const TOWERS = 6;

/** A corridor of {@link UrbanStretch}es beside a straight, level road. */
export function urbanFixture(
  stretches: readonly UrbanStretch[],
  options: UrbanFixtureOptions = {},
): {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
} {
  const length = options.length ?? 3_000;
  const profile = northRoute(length, () => 10);
  const origin = corridorOrigin(profile);
  const landUse: LandUseFeature[] = [];
  const buildings: BuildingFeature[] = [];
  const land = (kind: string, from: number, to: number, near: number, far: number): void => {
    landUse.push(landBeside(profile, origin, 'landuse', kind, from, to, near, far));
  };
  for (const stretch of stretches) {
    const { kind, from, to } = stretch;
    if (kind === 'rural') {
      land('farmland', from, to, -LAND_REACH, LAND_REACH);
      continue;
    }
    if (kind === 'city-commerce') {
      land('commercial', from, to, -COMMERCIAL_REACH, COMMERCIAL_REACH);
      land('residential', from, to, COMMERCIAL_REACH, LAND_REACH);
      land('residential', from, to, -LAND_REACH, -COMMERCIAL_REACH);
    } else {
      land('residential', from, to, -LAND_REACH, LAND_REACH);
    }
    const [columns, rows] = GRID[kind];
    const middle = Math.floor((from + to) / 2 / 100) * 100;
    let towers = kind === 'city-height' ? TOWERS : 0;
    for (let window = from; window < to; window += 100) {
      for (let column = 0; column < columns; column += 1) {
        const along = window + ((column + 0.5) * 100) / columns;
        for (let row = 0; row < rows; row += 1) {
          const out = NEAREST + SIDE / 2 + (row * (FARTHEST - NEAREST - SIDE)) / (rows - 1);
          for (const side of [1, -1]) {
            let height: number | null = kind === 'city-commerce' ? null : HOUSE_METRES;
            // The towers: the first six of the middle window's.
            if (towers > 0 && window === middle) {
              height = TOWER_METRES;
              towers -= 1;
            }
            buildings.push(
              buildingBeside(
                profile,
                origin,
                [rectangleBeside(along, out * side, SIDE, SIDE)],
                height,
              ),
            );
          }
        }
      }
    }
  }
  // A north road: its local `z` is the distance along it, so a stretch's
  // tiles are a box from `from` to `to` in `z`.
  const gaps = [...(options.uncovered ?? [])].sort((a, b) => a.from - b.from);
  const coveredBoxes: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  let start = -500;
  for (const gap of gaps) {
    coveredBoxes.push({ minX: -1_000, maxX: 1_000, minZ: start, maxZ: gap.from });
    start = gap.to;
  }
  coveredBoxes.push({ minX: -1_000, maxX: 1_000, minZ: start, maxZ: length + 500 });
  return {
    profile,
    origin,
    corridor: {
      routeId: 'urban-fixture',
      origin,
      covered: (_x, z) => !gaps.some((gap) => z >= gap.from && z < gap.to),
      coveredBoxes,
      landUse,
      buildings,
      paths: [],
      streets: [],
    },
  };
}
