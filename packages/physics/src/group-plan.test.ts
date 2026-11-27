// SPDX-License-Identifier: Apache-2.0

/**
 * The group plan (#3298, `@onyourleft/domain` §`planGroupRide`) on this
 * package's own speed: the front rider at the bot's 75 kg, in the hoods, with
 * the leading-rider factor `draft.ts` gives it for a wheel 0.5 m behind, at a
 * steady state. `packages/domain` cannot import this package, so this is where
 * the plan's average is held to the physics a group will ride (#3300 wires it).
 */

import { describe, expect, it } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  gradeAt,
  gradePercent,
  kilograms,
  metresPerSecond,
  planGroupRide,
  type GroupPlan,
  type GroupSpeedModel,
} from '@onyourleft/domain';
import { courseOf, FLAT_COURSE, HILLY_COURSE } from '@onyourleft/domain/group-ride-testing';

import { withDragArea } from './coefficients';
import { leadFactor } from './draft';
import { steadyStateSpeedMetresPerSecond } from './power';
import {
  RIDING_POSITION_DRAG_AREAS,
  ROAD_ROLLING_RESISTANCE_COEFFICIENT,
  SEA_LEVEL_AIR_DENSITY,
} from './riding';

/** The front rider's steady speed: the bot's mass, the hoods, a wheel 0.5 m behind. */
const frontSpeed: GroupSpeedModel = (powerWatts, grade) =>
  steadyStateSpeedMetresPerSecond({
    powerWatts,
    totalMass: kilograms(BOT_MASS_KILOGRAMS),
    grade: gradePercent(grade),
    airDensityKilogramsPerCubicMetre: SEA_LEVEL_AIR_DENSITY,
    coefficients: {
      ...withDragArea(leadFactor(0.5) * RIDING_POSITION_DRAG_AREAS.hoods),
      rollingResistanceCoefficient: ROAD_ROLLING_RESISTANCE_COEFFICIENT,
    },
  });

const TARGET = metresPerSecond(30 / 3.6);

/** Seconds to ride `course` a tick at a time on the plan, its ledger always on the plan. */
function riddenSeconds(plan: GroupPlan, course: ReturnType<typeof courseOf>): number {
  const total = course.totalDistance as number;
  const tick = 0.5;
  let odometer = 0;
  let seconds = 0;
  for (;;) {
    const power = plan.powerAt(odometer, { ridingSeconds: plan.plannedSecondsAt(odometer) });
    const speed = frontSpeed(power, gradeAt(course, odometer));
    if (odometer + speed * tick >= total) return seconds + (total - odometer) / speed;
    odometer += speed * tick;
    seconds += tick;
  }
}

describe("the group plan on physics' steady-state speed", () => {
  it.each([
    ['flat', FLAT_COURSE],
    ['hilly', HILLY_COURSE],
  ] as const)('rides the %s course in distance ÷ target, within 0.5 %%', (_, stretches) => {
    const course = courseOf(stretches);
    const result = planGroupRide({ course, targetSpeed: TARGET, frontSpeed });
    if ('error' in result) throw result.error;
    const goal = (course.totalDistance as number) / TARGET;
    expect(Math.abs(riddenSeconds(result, course) - goal) / goal).toBeLessThan(0.005);
  });

  it('is faster than the target on the hilly course’s flats and slower up its climb', () => {
    const result = planGroupRide({
      course: courseOf(HILLY_COURSE),
      targetSpeed: TARGET,
      frontSpeed,
    });
    if ('error' in result) throw result.error;
    expect(result.speedNowAt(1_500) as number).toBeGreaterThan(TARGET);
    expect(result.speedNowAt(8_500) as number).toBeGreaterThan(TARGET);
    expect(result.speedNowAt(3_750) as number).toBeLessThan(TARGET);
  });
});
