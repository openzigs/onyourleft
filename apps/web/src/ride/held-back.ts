// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A setpoint the ride controller held back rather than sent — #721, #722's
 * review, #724, #728.
 *
 * Three holds throw it, each named by {@link TargetHeldBack.hold}:
 *
 * - `ride/controller.ts` §`mustWaitForForget` (`'forget-running'`) refuses an
 *   ERG target, a workout's target or a game's gradient while a trainer's
 *   forget is in progress or still running late.
 * - The game's gradient handle (`ride/controller.ts` §`simulationControl`)
 *   refuses a gradient while its trainer is being let go so it can be
 *   forgotten (`'letting-go-to-forget'`, #659's review),
 * - once the controller has been disposed (`'let-go'`, #695),
 * - and once its trainer has been detached — forgotten, or its pairing
 *   undone — so the client it wrote through is closed (`'disconnected'`,
 *   #732).
 *
 * The machine refused nothing in any of them, so the loop that wrote it must
 * not tell the rider "the trainer refused that target" — and it tells this
 * refusal apart **by class and by `hold`, never by wording**:
 *
 * - `workout/session.ts` §`faultText` tells the rider a `'forget-running'`
 *   error's message verbatim, because the controller's sentence already says
 *   why and what ends it, and words the other two itself.
 * - `game/gradient.ts` §`faultText` says its own sentence for each kind,
 *   worded for the road, and does not read the message at all.
 *
 * Neither the `'letting-go-to-forget'` nor the `'let-go'` sentence may say the
 * trainer WAS let go (#729's review): both holds are thrown while the release's
 * Stop may still be on the wire, and the Stop can be refused.
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
  /**
   * Which hold this is — #728. A typed field rather than the message, for the
   * reason the class exists at all: a loop that words the hold for its rider
   * must not depend on the controller's sentence.
   *
   * - `'forget-running'` — `mustWaitForForget`: a forget is in progress or
   *   still running late, and the hold lifts by itself when it lands.
   * - `'letting-go-to-forget'` — the trainer this handle drives is being let
   *   go so it can be forgotten (#659's review). The hold lifts only if the
   *   Stop does not land and the forget is abandoned; otherwise the trainer is
   *   gone.
   * - `'let-go'` — the ride controller was disposed (#695) and is letting the
   *   trainer go; its Stop may still be on the wire, or refused. Permanent:
   *   nothing this controller handed out writes again.
   * - `'disconnected'` — #732: the trainer this handle drives has been
   *   detached (Forget finished, or its pairing was undone) and the client is
   *   closed. Permanent for this handle: a trainer paired again is a new
   *   client, and a new handle. Before it, the closed client's own
   *   `not-connected` error reached the rider as "The trainer refused that
   *   gradient. The next one will be sent again.", and both halves were false.
   *
   * `game/gradient.ts` §`faultText` words each one for the road;
   * `workout/session.ts` §`faultText` says a `'forget-running'` message
   * verbatim and words the other two itself, though it only ever receives
   * `'forget-running'` today.
   */
  readonly hold: 'forget-running' | 'letting-go-to-forget' | 'let-go' | 'disconnected';

  constructor(hold: TargetHeldBack['hold'], reason: string) {
    super(reason);
    this.name = 'TargetHeldBack';
    this.hold = hold;
  }
}
