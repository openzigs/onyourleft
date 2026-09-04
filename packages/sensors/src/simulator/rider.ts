// SPDX-License-Identifier: Apache-2.0

/**
 * The rider the simulated devices are attached to.
 *
 * Deterministic and steady by default: a conformance test wants "90 rpm" to
 * mean 90 rpm, and a scenario wants to change one thing and see one thing
 * change. There is no noise, no fatigue and no physics here — power → speed is
 * `packages/physics` (#88), and a second model of it in a test fixture would be
 * a second source of truth. Speed is a rider setting like the others.
 */

import {
  beatsPerMinute,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  watts,
  type BeatsPerMinute,
  type Metres,
  type MetresPerSecond,
  type RevolutionsPerMinute,
  type Watts,
} from '@onyourleft/domain';

export interface RiderProfile {
  readonly power: Watts;
  readonly cadence: RevolutionsPerMinute;
  readonly heartRate: BeatsPerMinute;
  readonly speed: MetresPerSecond;
  /**
   * Drives the CSC wheel counter. A rider setting rather than a device one —
   * which is exactly why a CSC sensor cannot declare `speed` on its own; see
   * `capability.ts`.
   */
  readonly wheelCircumference: Metres;
}

/** A steady endurance effort on a 700x25c wheel. */
export const DEFAULT_RIDER: RiderProfile = {
  power: watts(200),
  cadence: revolutionsPerMinute(90),
  heartRate: beatsPerMinute(145),
  speed: metresPerSecond(9),
  wheelCircumference: metres(2.105),
};
