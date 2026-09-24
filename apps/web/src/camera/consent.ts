// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the rider agrees to before a camera is ever switched on, as a pure
 * decision** (#382,
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-2,
 * D-4, D-5).
 *
 * The shape is `transfer/erase-device.ts` §`eraseDecision`'s and
 * `game/wind-choice.ts`'s: the rule is a function over what the rider did, it
 * returns a decision or a **named** refusal, and it is tested with no camera
 * and no DOM. Nothing here touches a port, a stream or a canvas.
 *
 * ## The wording is the feature, and it is quoted rather than drafted
 *
 * ADR 0029 D-5 states the bystander sentence **in the ADR**, and its 2026-09-23
 * amendment says why that matters more than it looks:
 *
 * > D-5's quoted wording is **not edited by this amendment**, and it must not
 * > be edited by #382 either: the point of quoting it in an ADR was that Phase B
 * > implements a sentence somebody ruled on.
 *
 * So {@link BYSTANDER_SENTENCE} is a copy, and `consent.test.ts` reads the ADR
 * off disk and asserts the two agree word for word. A rewording in either place
 * is a red test rather than a divergence nobody sees — which is the same move
 * `check-licence-hashes.sh` makes about a licence text and
 * `theme.a11y.test.ts` makes about `theme.css`.
 *
 * ⚠️ **And the owner's Q4 answer makes half of that sentence do the work.**
 * The camera is *"a second phone on a tripod, side-on, at roughly hip height"*,
 * which is a camera pointed **across the room** rather than at the bike. The
 * amendment records what follows: D-5's remedy has two limbs — *"point the
 * camera so they will not be in it, **or leave the camera off**"* — and in a
 * small room the first limb may not be available at all, so *"the second limb
 * is then the whole remedy, and a reviewer of #382 should read it that way
 * rather than as a softener."*
 *
 * ## Two answers, not one
 *
 * Owner decision D-B: a hosted model is permitted **on the rider's own key,
 * opted into, never default and never silent**. The failure that prevents is a
 * single "allow camera" toggle that silently also permits third-party egress,
 * so {@link CameraConsent} has two independent members and
 * {@link consentDecision} never infers one from the other.
 *
 * ⚠️ **The hosted answer is modelled here and is NOT offered on any screen,
 * deliberately.** There is no hosted path. ⚠️ **This paragraph said #387 owned
 * it, and #387 did not build it**: ADR 0029's 2026-09-23 amendment found that
 * the owner's amended promise — *"no network except a LOCAL endpoint the rider
 * configured and switched on"* — does not cover a hosted model, and left
 * whether the policy may gain a second exception to the owner. #387 built the
 * local path only, and its address rule refuses anything off the rider's own
 * network, so `hosted` has nothing to grant. A control granting something
 * no code can act on is a control that *"looks like the way in and is not"*,
 * which is #48's first criterion; and D-7's own consent wording is quoted in
 * the ADR precisely so that the issue which ships the path implements the
 * sentence somebody ruled on. Writing that screen now, ahead of the path, is
 * ADR 0029's own *"a policy amended in advance, so it is ready, is a false
 * statement about a shipped app"* one layer down.
 */

/**
 * D-5's sentence, verbatim.
 *
 * ⚠️ **Do not improve this.** `consent.test.ts` reads
 * `docs/adr/0029-camera-imagery-as-a-data-class.md` and compares. Changing the
 * words here without a superseding ADR is a red test, and changing them in the
 * ADR is forbidden outright by CLAUDE.md §7 — an ADR's body is never edited in
 * place.
 */
export const BYSTANDER_SENTENCE =
  'Anyone in the room will be in the picture. This app cannot tell who is in a frame and does ' +
  'not try to hide anyone. If somebody else might walk behind you, point the camera so they ' +
  'will not be in it, or leave the camera off.';

/**
 * What is captured, where it goes, and what is kept — #382's third criterion.
 *
 * Each line is a decision in ADR 0029 rather than a reassurance:
 *
 * 1. **what is captured** — stills, from the camera the rider points, only
 *    while the indicator is showing (D-5's second bullet);
 * 2. **where it goes** — nowhere, unless the rider sets up a computer of their
 *    own and switches it on (#387). That is a property of the source rather
 *    than a rule this client follows: `privacy/no-network.test.ts` permits one
 *    network call in the whole client, in `analysis-transport.ts`, and
 *    `analysis-endpoint.ts` builds no port at all until an address on the
 *    rider's own network is saved and switched on. ⚠️ This line said *"there is
 *    no code in it that can"* until #387 made that false; the sentence changed
 *    in the same pull request as the code, which is the only order in which a
 *    consent screen stays true;
 * 3. **what is kept** — nothing, unless the rider turns on this ride's keep
 *    (D-2), and then until they delete it (D-4);
 * 4. **what an erase cannot reach** — D-4's honest half, said **before** the
 *    rider presses anything rather than discovered afterwards.
 *
 * ⚠️ The fourth line is short today and will get longer, and it is worth
 * knowing why it is short: the two sentences ADR 0029 D-4 writes for
 * `ERASE_CANNOT_REACH` are both about a copy that **left the device** — a
 * machine the rider sent a frame to, and a hosted model. Neither is reachable
 * from this build, so claiming either here would be describing a feature the
 * app does not have, in the direction that frightens rather than the direction
 * that reassures. `transfer/erase-device.ts` is where they appear the day they
 * become true.
 */
export const CONSENT_STATEMENT: readonly string[] = [
  'The camera takes still pictures of you while you ride, and only while the "Camera on" sign is showing.',
  'Nothing is sent anywhere unless you set up a computer of your own below and switch it on. Then a picture goes to that one computer, only when you press the button that sends it, and nowhere else.',
  'A picture is thrown away as soon as it has been looked at, unless you turn on "keep this ride’s pictures" first. There is no setting that keeps them always.',
  'A picture you kept stays on this device until you delete it, delete the ride, or erase this device. A copy you have already exported is yours and is wherever you put it.',
];

/** Both answers a rider can give. @see consentDecision */
export interface CameraConsent {
  /**
   * Turn the camera on, on this device, for this device's own use.
   *
   * Everything this pull request builds sits under this one answer.
   */
  readonly local: boolean;
  /**
   * Send a picture to a service the rider has chosen — owner decision D-B,
   * ADR 0029 D-7.
   *
   * ⚠️ **Always `false` in this build and there is no way to set it from a
   * screen.** It is modelled so that the two answers are separable *by
   * construction* rather than by a later refactor, which is #382's own
   * criterion; see this file's header for why no control offers it yet.
   */
  readonly hosted: boolean;
}

/** The state of a device nobody has agreed to anything on. */
export const NO_CONSENT: CameraConsent = { local: false, hosted: false };

/**
 * Why a consent was refused.
 *
 * `hosted-without-local` is the one worth reading twice. A rider cannot agree
 * to send a picture somewhere without agreeing to take one, and modelling that
 * as a refusal rather than as an implication is the point: an implication would
 * be the code inferring one answer from the other, which is exactly what #382
 * forbids.
 */
export type ConsentRefusal = 'not-acknowledged' | 'nothing-agreed' | 'hosted-without-local';

/** Whether consent may be recorded, and why not when it may not. */
export interface ConsentDecision {
  /** `undefined` when there is a refusal. */
  readonly consent: CameraConsent | undefined;
  readonly refusal: ConsentRefusal | undefined;
}

/** What the rider actually did on the consent screen. */
export interface ConsentAnswers {
  /**
   * Whether the rider ticked the box beside {@link BYSTANDER_SENTENCE}.
   *
   * ⚠️ **A separate answer from {@link allowLocal}, and that is D-5 being
   * implemented rather than decorated.** The ADR requires the sentence to be
   * read *"before the camera is ever turned on"*, and a screen where the only
   * control is "turn the camera on" has shown the sentence and asked nothing
   * about it. A tick is the weakest acknowledgement that is still an answer.
   *
   * ⚠️ It is **not** a typed phrase. `erase-device.ts` uses one and says why —
   * *"this is the one irreversible action in the product"* — and this is not
   * that: switching a camera on is reversible by switching it off, nothing is
   * destroyed, and a typed phrase in front of an ordinary control trains riders
   * to type past warnings.
   */
  readonly acknowledgedBystanders: boolean;
  readonly allowLocal: boolean;
  /** @see CameraConsent.hosted — nothing sets this to `true` in this build. */
  readonly allowHosted: boolean;
}

/**
 * Whether these answers record a consent.
 *
 * ⚠️ **Granting the local answer grants nothing else**, which is the property
 * `consent.test.ts` asserts by name: the returned `hosted` is the rider's own
 * `allowHosted` and is never derived from `allowLocal`. Deleting that
 * independence — returning `hosted: input.allowLocal`, which is what a single
 * toggle looks like in code — turns that test red.
 */
export function consentDecision(input: ConsentAnswers): ConsentDecision {
  if (!input.allowLocal && !input.allowHosted) {
    return { consent: undefined, refusal: 'nothing-agreed' };
  }
  if (input.allowHosted && !input.allowLocal) {
    return { consent: undefined, refusal: 'hosted-without-local' };
  }
  if (!input.acknowledgedBystanders) {
    return { consent: undefined, refusal: 'not-acknowledged' };
  }
  return {
    consent: { local: input.allowLocal, hosted: input.allowHosted },
    refusal: undefined,
  };
}

/** One sentence per refusal, for the screen. */
export const CONSENT_REFUSAL_TEXT: Readonly<Record<ConsentRefusal, string>> = {
  'not-acknowledged':
    'Tick the box to say you have read what happens to anyone else in the room, then turn the camera on.',
  'nothing-agreed': 'The camera stays off until you say it may be on.',
  'hosted-without-local':
    'A picture cannot be sent anywhere unless the camera may take one on this device first.',
};
