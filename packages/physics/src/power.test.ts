// SPDX-License-Identifier: Apache-2.0

/**
 * The inputs `powerRequired` and `steadyStateSpeedMetresPerSecond` refuse.
 *
 * Every one of these is individually valid — a `Seconds` of zero is a duration,
 * a power of zero is a power, a power of ten megawatts is a number — and jointly
 * impossible with the rest of the call. They are the paths where returning a
 * plausible-looking number would be worse than throwing, and they are here as
 * their own file because `martin-1998.test.ts` is about the paper and should
 * stay that way.
 *
 * The zero-duration case is the one that matters most. It is a division by zero
 * that produces `Infinity` or `NaN` rather than an exception, and a `NaN` watt
 * figure propagates: every comparison against it is false, so a downstream
 * bounds check passes it, and it surfaces as an absence rather than as an error.
 */

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms, metresPerSecond, seconds } from '@onyourleft/domain';

import {
  PhysicsError,
  powerRequired,
  steadyStateSpeedMetresPerSecond,
  withDragArea,
} from './index';

const road = {
  totalMass: kilograms(82),
  grade: gradePercent(0),
  airDensityKilogramsPerCubicMetre: 1.2234,
  coefficients: withDragArea(0.264),
} as const;

describe('powerRequired', () => {
  it('refuses a velocity change over zero seconds rather than dividing by it', () => {
    expect(() =>
      powerRequired({
        ...road,
        groundSpeed: metresPerSecond(10),
        velocityChange: {
          initialSpeed: metresPerSecond(9),
          finalSpeed: metresPerSecond(11),
          duration: seconds(0),
        },
      }),
    ).toThrow(PhysicsError);
  });

  it('treats an absent velocity change as no acceleration, not as an error', () => {
    // The far commoner case, and the one Equation 13 reduces to for a steady
    // speed. If this threw, every steady-state call in the package would.
    const steady = powerRequired({ ...road, groundSpeed: metresPerSecond(10) });
    expect(steady.kineticEnergyWatts).toBe(0);
    expect(Number.isFinite(steady.totalWatts)).toBe(true);
  });

  it('returns a negative total on a descent, which is why it is not a Watts', () => {
    // `packages/domain`'s `watts()` rejects a negative, so a branded return type
    // would throw here — on an entirely ordinary input. Freewheeling down a 6 %
    // hill at 10 m/s takes power out of the rider, not into them.
    const descending = powerRequired({
      ...road,
      grade: gradePercent(-6),
      groundSpeed: metresPerSecond(10),
    });
    expect(descending.totalWatts).toBeLessThan(0);
    expect(descending.potentialEnergyWatts).toBeLessThan(0);
  });
});

describe('steadyStateSpeedMetresPerSecond', () => {
  it('refuses a power of zero or less, where the root is not unique', () => {
    // On a descent the cost curve dips below zero and comes back, so "the speed
    // at which a rider needs 0 W" has two answers and one of them is standing
    // still. That question belongs to `advance`, which integrates rather than
    // solves.
    for (const powerWatts of [0, -50]) {
      expect(() => steadyStateSpeedMetresPerSecond({ ...road, powerWatts })).toThrow(PhysicsError);
    }
    expect(() => steadyStateSpeedMetresPerSecond({ ...road, powerWatts: Number.NaN })).toThrow(
      PhysicsError,
    );
  });

  it('refuses a power no speed below the search ceiling could absorb', () => {
    // The bracket search doubles until the cost exceeds the target, and it has
    // to stop somewhere: without the ceiling this is an infinite loop rather
    // than an error, which is the worst of the three possible outcomes.
    expect(() => steadyStateSpeedMetresPerSecond({ ...road, powerWatts: 1e12 })).toThrow(
      PhysicsError,
    );
  });

  it('solves a power that sits exactly on the first bracket, without doubling', () => {
    // The loop's other edge: a target so small that `costAt(1)` already exceeds
    // it, so the bracket is never widened. A guard written as `while` rather
    // than `do…while` is the difference between this working and it returning
    // the ceiling.
    const crawling = steadyStateSpeedMetresPerSecond({ ...road, powerWatts: 1 });
    expect(crawling).toBeGreaterThan(0);
    expect(crawling).toBeLessThan(1);
  });
});
