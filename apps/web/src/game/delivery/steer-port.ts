// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's steering keys hand the ride — #1820.
 *
 * ⚠️ **A `*-port.ts` on purpose**, as `throw-input-port.ts` is:
 * `check:wiring` then requires its one method to have a production caller
 * (§4j, `WIRE003`). `hud/SteerKeys.tsx` calls it for each lane key. What
 * implements it is #1816's: `GameView` takes the intent, turns it into the
 * round's next steer state with `steer.ts` §`steerToward` and steps that on
 * the simulation tick. Until then no production ride hands the HUD a port,
 * so no key steers.
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
