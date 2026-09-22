// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One frame of the owner's realistic page's ride — #478.
 *
 * ## Why this is its own module
 *
 * The page built its frames with `sceneFrame` and passed no `scatterItems` and
 * no `structureItems`, so every frame carried the TOP rung's scenery whatever
 * rung the ladder had chosen. `GameView` passes the rung's own budgets, and the
 * page exists to show what a rider would see: on the second realistic rung
 * ("reduced resolution and scenery") the page changed the resolution and the
 * water and drew all the scenery, and validation 0002 Part Z's soak — whose
 * numbers set ADR 0026 D-6's constants — would have measured a ladder the
 * product does not run.
 *
 * So the rung is a REQUIRED argument here, and the page cannot build a frame
 * without saying which rung it is on.
 */

import { metres, metresPerSecond, seconds, type RouteProfile } from '@onyourleft/domain';

import { simulatedCrankAngle } from '../../src/game/bicycle';
import type { SceneFrame } from '../../src/game/port';
import type { QualitySettings } from '../../src/game/quality';
import { sceneFrame } from '../../src/game/scene';
import { atStartLine } from '../../src/game/simulation';
import type { CorridorOrigin } from '../../src/game/terrain';

/** How fast the rider goes: about 32 km/h. */
export const RIDE_METRES_PER_SECOND = 9;

/** How far ahead of the rider the pacer rides. */
const PACER_LEAD_METRES = 25;

/** One frame of the ride, `distance` metres along, at the scenery budget of `rung`. */
export function rideFrame(input: {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly distance: number;
  readonly elapsed: number;
  readonly rung: Pick<QualitySettings, 'scatterItems' | 'structureItems'>;
}): SceneFrame {
  const start = atStartLine(input.profile);
  return sceneFrame({
    profile: input.profile,
    origin: input.origin,
    state: {
      ...start,
      ride: { speed: metresPerSecond(RIDE_METRES_PER_SECOND), distance: metres(input.distance) },
      elapsed: seconds(input.elapsed),
      ridden: seconds(input.elapsed),
    },
    botDistance: input.distance + PACER_LEAD_METRES,
    crankAngle: simulatedCrankAngle(input.distance),
    // As `GameView` passes them: the rung's own budgets, so a step down the
    // ladder places less scenery as well as drawing less of it.
    scatterItems: input.rung.scatterItems,
    structureItems: input.rung.structureItems,
  });
}
