// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's steering keys and a gamepad hand the ride — #1820, lifted out
 * of `delivery/steer-port.ts` by #1901 so that a lap race (epic #1894) takes
 * lane changes from the same keys and pads as a Delivery round.
 *
 * ⚠️ **A `*-port.ts` on purpose**, as `delivery/throw-input-port.ts` is:
 * `check:wiring` then requires its one method to have a production caller
 * (§4j, `WIRE003`). `hud/SteerKeys.tsx` calls it for each lane key and
 * `hud/GamepadIntents.tsx` for each lane a pad asks for. `GameView`
 * implements it on a ride running a Delivery round (#1853): it turns the
 * intent into the round's next steer state with `lanes.ts` §`steerToward`.
 * A lap race implements it with `lap-race/race-input.ts` §`askLane` (#1906).
 *
 * ⚠️ **One method, and it asks for a lane change and nothing else.** No game
 * event may change what the trainer is sent (ADR 0059 D-2, ADR 0060 D-2), so
 * nothing a rider presses to steer has a way to ask for anything more.
 * `delivery/steer.test.ts` holds the interface to this one method.
 */

import type { SteerIntent } from './lanes';

export interface SteerInputPort {
  /** The rider asked for a lane change, by a key from a keyboard, a bar remote or a gamepad. */
  steer(intent: SteerIntent): void;
}
