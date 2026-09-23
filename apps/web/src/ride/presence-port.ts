// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the ride may ask of the camera: is anybody on the bike** —
 * [#390](https://github.com/openzigs/onyourleft/issues/390).
 *
 * One method, and it returns one of three words. Nothing about a frame, a
 * grid, a count of people or who they are crosses this seam, because nothing
 * about any of those is derived: `camera/presence.ts` reduces two coarse
 * brightness grids to "something moved" or "nothing moved" and drops them.
 *
 * ## Why this is a `*-port.ts`
 *
 * CLAUDE.md §4j: the suffix is what puts a seam under `check:wiring`'s
 * `WIRE003`. The ride controller's recorder is what calls
 * {@link RiderPresencePort.riderPresence}; delete that and the method on this
 * interface is called by no production declaration, which is a red build
 * rather than a camera that watches a room for nothing.
 *
 * ⚠️ **The provider half is the §Limits case, and is recorded rather than
 * hidden.** `main.tsx` hands the camera controller to `createRideController`
 * as an optional option; a `main.tsx` that stopped handing it over leaves this
 * gate green, because *"an optional parameter nobody supplies is perfectly
 * well typed"* and is not something the gate follows — and no test renders
 * `main.tsx`. What is covered is everything after it: `ride/controller.test.ts`
 * §"#390" hands a port to a real controller and watches a real recorder pause.
 *
 * ## ⚠️ What the answer can send a trainer (#516)
 *
 * **One thing: the ease.** `absent` takes movement away, the recording engine
 * pauses itself, the ride controller pauses a running workout with it, and a
 * paused workout writes the machine's own Supported Power Range minimum —
 * #441's ease. #515 said presence did not reach the trainer; through that
 * chain it does. The direction is allowed because it is the safe one — less
 * resistance at a bike nobody is on — and because it is exactly what every
 * other pause already sends. No answer raises a target, sends a Stop or a
 * Reset, or requests control: `unknown` and `present` write exactly what a
 * ride with no camera writes, and `ride/controller.test.ts` §"#516" holds all
 * three as octets on the #44 simulated trainer.
 *
 * The method carries a distinctive name for the reason `camera-port.ts` gives:
 * `check-wiring.mjs` matches member names as names, so a `presence()` would be
 * kept alive by any other `presence` anywhere in the client.
 */

import type { RiderPresence } from '../recording/channels';

export type { RiderPresence } from '../recording/channels';

/** The camera's answer, read on every sensor reading. */
export interface RiderPresencePort {
  /**
   * Whether anybody is on the bike **right now**.
   *
   * ⚠️ Must be cheap and must never throw: it is called once per sensor
   * reading, inside the recorder, several times a second. It reads a value the
   * camera side already holds; it never opens, samples or waits on anything.
   * `unknown` whenever the camera is not in a position to say — which is the
   * answer that changes nothing.
   */
  riderPresence(): RiderPresence;
}
