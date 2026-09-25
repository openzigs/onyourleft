// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the tripod phone needs from its link to the tablet, and nothing
 * more** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3 and D-5.
 *
 * ## No implementation exists yet, and this port is why that is safe
 *
 * The link itself — the data channel, the two QR codes, the one-time secret,
 * the candidate rule — is [#529](https://github.com/openzigs/onyourleft/issues/529),
 * and ADR 0033 D-0 forbids it choosing a transport before
 * [#532](https://github.com/openzigs/onyourleft/issues/532) has measured one.
 * So #528 builds the phone's side of the session against this interface, and
 * `main.tsx` hands the screen none: a phone that cannot be paired says so and
 * offers the framing setup alone. When #529 lands, its transport implements
 * this port and the screen's behaviour on a lost link — the part a rider's
 * safety rests on — is already built and tested.
 *
 * ## Why a `*-port.ts`, and the names
 *
 * CLAUDE.md §4j: `check:wiring` watches every `*-port.ts`, so a method here
 * that no production code calls is a red `WIRE003`. The names are distinctive
 * (`sideLinkCondition`, `onSideLinkEvent`, `reportToTablet`, `endSideLink`)
 * for `camera-port.ts`' measured reason: an ordinary name like `close` or
 * `send` is called somewhere in this client already, and the gate would credit
 * that call to this port.
 *
 * ## Exactly what crosses, in each direction (D-3)
 *
 * Tablet → phone: *start*, *stop*, the framing reference (numbers, D-7) and
 * the framing verdict. Phone → tablet: its state, and why it stopped. **No
 * picture travels over anything declared here** — the frames channel is
 * [#530](https://github.com/openzigs/onyourleft/issues/530)'s — and nothing
 * here carries an athlete, a ride reading, a position or a wall-clock time.
 */

/**
 * Whether the tablet can currently hear this phone.
 *
 * `lost` is D-5's case: the phone keeps filming **for at most 30 seconds**,
 * then stops on its own timer. A link that recovers inside that window is
 * `connected` again and the session goes on (ADR 0033 D-5's *"streaming
 * resumes with the next frame captured"*).
 */
export type SideLinkCondition = 'connected' | 'lost';

/**
 * One thing the link reports: its condition changing, or a command from the
 * tablet (D-3's tablet → phone column).
 *
 * ⚠️ **`reference` is `unknown` on purpose.** A received message is untrusted
 * input (D-4), and the phone decodes the reference itself —
 * `framing.ts` §`framingReferenceFrom` — rather than trusting that whatever
 * produced this event already did.
 */
export type SideLinkEvent =
  | { readonly kind: 'condition'; readonly condition: SideLinkCondition }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'reference'; readonly reference: unknown }
  | { readonly kind: 'verdict'; readonly verdict: 'matches' | 'differs' };

/** Why the phone stopped filming, as D-3's *"and why it stopped"*. */
export type SideCameraStopReason =
  /** The rider pressed the phone's own stop control. */
  | 'rider'
  /** The tablet said stop. */
  | 'tablet'
  /** D-5: the link was gone for 30 seconds. */
  | 'link-lost'
  /** The camera went out by itself — a permission revoked, the hardware taken. */
  | 'camera';

/** What the phone tells the tablet about itself (D-3's phone → tablet column). */
export type PhoneReport =
  | { readonly state: 'framing' }
  | { readonly state: 'filming' }
  | { readonly state: 'stopped'; readonly reason: SideCameraStopReason };

/** The phone's end of the link. */
export interface SideCameraLinkPort {
  /** Whether the tablet can hear this phone right now. */
  sideLinkCondition(): SideLinkCondition;
  /**
   * Call `listener` for every condition change and every command.
   *
   * @returns the unsubscribe.
   */
  onSideLinkEvent(listener: (event: SideLinkEvent) => void): () => void;
  /**
   * Tell the tablet where this phone is.
   *
   * ⚠️ **Never throws and never waits.** On a lost link there is nobody to
   * tell, and the phone's own behaviour must not depend on whether a report
   * arrived — D-5's *"the limit never depends on the link"*. Acknowledging a
   * report is the transport's business (#529), and so is re-sending one.
   */
  reportToTablet(report: PhoneReport): void;
  /**
   * End the pairing. D-4: *"a pairing lasts one session"* and *"ends when
   * either device stops the session"* — nothing is remembered, so ending it is
   * also the whole of revoking it. Idempotent.
   */
  endSideLink(): void;
}
