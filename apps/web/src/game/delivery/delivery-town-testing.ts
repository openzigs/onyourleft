// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A town a Delivery round can be ridden through — #1816's fixture, test
 * support only (never shipped).
 *
 * Two kilometres of road that rise and fall, so the grade the trainer is sent
 * changes along it, with 8 × 8 m houses every 14 m both sides, their middles
 * 12 m from the road's centre line: their doorsteps and porch steps stand
 * 4 to 8 m from it, inside a parcel's 12 m reach (`throw.ts`
 * §`PARCEL_FLIGHT_SECONDS`). All of it residential, all of it covered.
 * Synthetic: no OpenStreetMap data, and no name or address anywhere in it.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature } from '@onyourleft/map-features';

import { footprintPlans } from '../footprint-buildings';
import { buildingBeside, landBeside, rectangleBeside } from '../footprint-fixtures-testing';
import { landClassMask } from '../land-class';
import { mappedBuildingsOf, type MappedBuildings } from '../mapped-buildings';
import { northRoute } from '../route-fixtures-testing';
import { corridorOrigin, type CorridorOrigin } from '../terrain';
import type { WorldCorridor } from '../world-data/corridor';

/** How long the town's road is, metres. */
export const DELIVERY_TOWN_METRES = 2_000;

/** A Delivery town: its road, the corridor a ride is given, and its houses as a round picks from them. */
export interface DeliveryTown {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
  readonly buildings: MappedBuildings;
}

/**
 * Where the town's houses stand: the first one's middle along the road, and
 * every middle's distance from the centre line, metres. 50 and 12 unless
 * given; #1817 moves both off round numbers, so a target's point is digits
 * nothing else in a ride spells.
 */
export interface DeliveryTownLayout {
  readonly firstAlong?: number;
  readonly lateral?: number;
}

/** #1817's layout: every house's point, and so every target's, a run of digits. */
export const DISTINCTIVE_TOWN_LAYOUT: DeliveryTownLayout = {
  firstAlong: 50.3719,
  lateral: 12.4683,
};

/** The town, its corridor named for the route `routeId` (a ride is drawn from it only then). */
export function deliveryTown(
  routeId = 'delivery-town',
  layout: DeliveryTownLayout = {},
): DeliveryTown {
  const profile = northRoute(DELIVERY_TOWN_METRES, (along) => 10 + 20 * Math.sin(along / 300));
  const origin = corridorOrigin(profile);
  const houses: BuildingFeature[] = [];
  const middle = layout.lateral ?? 12;
  for (let along = layout.firstAlong ?? 50; along < DELIVERY_TOWN_METRES - 50; along += 14) {
    for (const lateral of [middle, -middle]) {
      houses.push(buildingBeside(profile, origin, [rectangleBeside(along, lateral, 8, 8)], 6));
    }
  }
  const corridor: WorldCorridor = {
    routeId,
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 2_500 }],
    landUse: [
      landBeside(
        profile,
        origin,
        'landuse',
        'residential',
        10,
        DELIVERY_TOWN_METRES - 10,
        -100,
        100,
      ),
    ],
    buildings: houses,
    paths: [],
    streets: [],
  };
  const plans = footprintPlans(corridor, landClassMask(corridor), profile, origin).plans;
  return { profile, origin, corridor, buildings: mappedBuildingsOf(plans) };
}
