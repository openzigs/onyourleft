// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A setpoint the ride controller held back rather than sent — #721, #722's
 * review, #724.
 *
 * `ride/controller.ts` §`mustWaitForForget` refuses an ERG target, a
 * workout's target or a game's gradient while a trainer's forget is in
 * progress or still running late. The machine refused nothing, so the loop
 * that wrote it must not tell the rider "the trainer refused that target" —
 * and it tells this refusal apart **by class, never by wording**:
 *
 * - `workout/session.ts` §`faultText` tells the rider the error's message
 *   verbatim, because the controller's sentence already says why and what
 *   ends it.
 * - `game/gradient.ts` §`faultText` says its own sentence, worded for the
 *   road, and does not read the message at all.
 *
 * Until #724 the gradient recognised it by the substring "still being
 * forgotten", so rewording the controller's reason would have put "The
 * trainer refused that gradient" back in front of the rider with nothing
 * going red.
 *
 * ## Why here
 *
 * A leaf, importing nothing, beside the one module that throws it.
 * `ride/controller.ts` already imports `workout/session.ts`, so the class
 * cannot live in the controller (the session would import it back), and
 * `game/` already reaches into `ride/` (`game/sensors.ts`) while nothing in
 * `ride/` or `workout/` imports `game/`. A module in `ride/` with no imports
 * of its own is therefore reachable from all three without a cycle, and it is
 * inside the wiring gate's watched set (CLAUDE.md §4j).
 *
 * ⚠️ **Never thrown on a release.** A Stop is resistance let go of, and nothing
 * holds it back (`ride/controller.ts` §`releaseTrainer`).
 */
export class TargetHeldBack extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TargetHeldBack';
  }
}
