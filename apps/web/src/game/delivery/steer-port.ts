// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's steering keys hand the ride — #1820.
 *
 * ⚠️ **A `*-port.ts` on purpose**, as `throw-input-port.ts` is:
 * `check:wiring` then requires its one method to have a production caller
 * (§4j, `WIRE003`). `hud/SteerKeys.tsx` calls it for each lane key. `GameView`
 * implements it on a ride running a Delivery round (#1853): it turns the
 * intent into the round's next steer state with `steer.ts` §`steerToward`,
 * and `ride-round.ts` steps that on the simulation tick.
 *
 * ⚠️ **One method, and it asks for a lane change and nothing else.** No game
 * event may change what the trainer is sent (ADR 0059 D-2), so nothing a
 * rider presses to steer has a way to ask for anything more. The test holds
 * the interface to this one method.
 */

import type { SteerIntent } from './steer';

export interface SteerInputPort {
  /** The rider asked for a lane change, by a key from a keyboard or a bar remote. */
  steer(intent: SteerIntent): void;
}
