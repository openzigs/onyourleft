// SPDX-License-Identifier: Apache-2.0

/**
 * The physics an AI group ride's bots ride through — #3300, epic #3296, ADR
 * 0101 D-3.2.
 *
 * `@onyourleft/domain` §`stepGroupRide` decides how hard each bot of the line
 * pedals and cannot import this package, so it takes a `GroupPhysics`. This is
 * the real one, and it adds no physics: the draft is `draft.ts`
 * §`fieldDraftFactors`, unchanged and with no lateral input (ADR 0038 D-3.4);
 * a tick is {@link advance}, the one tick in this package; a holding power is
 * {@link powerRequired}'s steady state. `group-ride.test.ts` replaces
 * `advance` with a sentinel and requires a bot's position to change.
 *
 * Every rider it moves rides in the hoods on the road's rolling resistance in
 * the game's one air, as `riding.ts` §`ridingConditions` builds them, at a
 * fixed total mass: `BOT_MASS_KILOGRAMS`, the plan's (#3298), unless the
 * caller names one.
 *
 * Pure computation: no clock, no platform API, and nothing here is sent to a
 * trainer.
 */

import type { GroupPhysics, GroupSpeedModel } from '@onyourleft/domain';
import {
  BOT_MASS_KILOGRAMS,
  BOT_TACTIC_WHEEL_GAP_METRES,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  seconds,
  watts,
} from '@onyourleft/domain';

import { fieldDraftFactors, leadFactor } from './draft';
import { powerRequired, steadyStateSpeedMetresPerSecond } from './power';
import { ridingConditions } from './riding';
import { advance, type RideConditions } from './simulate';

/** A group's physics, and the plan's speed model on the same conditions. */
export interface GroupRidePhysics extends GroupPhysics {
  /**
   * The front rider's steady speed at a power and a grade, for
   * `planGroupRide`: with the leading-rider factor `draft.ts` gives a rider
   * whose next wheel is `BOT_TACTIC_WHEEL_GAP_METRES` behind, where the line
   * holds it.
   */
  readonly frontSpeed: GroupSpeedModel;
}

/**
 * The physics of a group whose riders weigh `totalMassKilograms` with their
 * bicycles: the bots' 75 kg by default.
 */
export function groupRidePhysics(
  totalMassKilograms: number = BOT_MASS_KILOGRAMS,
): GroupRidePhysics {
  const totalMass = kilograms(totalMassKilograms);
  // `ridingConditions` adds a bicycle to an athlete; here the mass is the whole of it.
  const conditions = (dragFactor: number): RideConditions => ({
    ...ridingConditions(totalMass, 'hoods', dragFactor),
    totalMass,
  });
  return {
    massKilograms: totalMassKilograms,
    draftFactors: (distancesMetres) => fieldDraftFactors(distancesMetres),
    holdWatts: (speedMps, grade, dragFactor) =>
      powerRequired({
        ...conditions(dragFactor),
        groundSpeed: metresPerSecond(speedMps),
        grade: gradePercent(grade),
      }).totalWatts,
    advance(from, powerWatts, grade, elapsed, dragFactor) {
      // From nought, and the metres ridden added on: a bot behind the rider
      // on the start line has an odometer under zero, which a ride's has not.
      const next = advance(
        { speed: metresPerSecond(from.speedMps), distance: metres(0) },
        { power: watts(powerWatts), grade: gradePercent(grade), duration: seconds(elapsed) },
        conditions(dragFactor),
      );
      return { distanceM: from.distanceM + next.distance, speedMps: next.speed };
    },
    frontSpeed: (powerWatts, grade) =>
      steadyStateSpeedMetresPerSecond({
        ...conditions(leadFactor(BOT_TACTIC_WHEEL_GAP_METRES)),
        powerWatts,
        grade: gradePercent(grade),
      }),
  };
}
