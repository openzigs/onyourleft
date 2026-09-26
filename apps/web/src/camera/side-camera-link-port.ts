// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the tripod phone needs from its link to the tablet, and nothing
 * more** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3 and D-5.
 *
 * ## The implementation is `side-link.ts`, since #529
 *
 * #528 built the phone's side of the session against this interface before a
 * transport existed; [#529](https://github.com/openzigs/onyourleft/issues/529)
 * is the WebRTC data channel that implements it (`side-link.ts`
 * §`PhoneSideLink`), reached through `side-pairing-port.ts`, which is where a
 * link comes from. ⚠️ **A reviewer who remembers "no implementation exists
 * yet" is reading the old file.**
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
 * the framing verdict. Phone → tablet: its state, and why it stopped, and —
 * since [#530](https://github.com/openzigs/onyourleft/issues/530) — the
 * pictures, on their own channel, through {@link SideCameraLinkPort.sendPictureToTablet}.
 * ⚠️ **A reviewer who remembers "no picture travels over anything declared
 * here" is reading #528's file.** Nothing here carries an athlete, a ride
 * reading, a position or a wall-clock time: a picture carries a sequence
 * number and milliseconds since filming began, and nothing else (D-3).
 */

import type { SidePicture } from './side-link-pictures';

/**
 * Whether the tablet can currently hear this phone.
 *
 * - `connecting` — the phone has shown its answer and the tablet has not
 *   connected yet (#529). A session is not handed a link in this condition;
 *   the screen waits for `connected` first.
 * - `connected` — the tablet can hear this phone.
 * - `lost` — D-5's case: the phone keeps filming **for at most 30 seconds**,
 *   then stops on its own timer. A link that recovers inside that window is
 *   `connected` again and the session goes on (ADR 0033 D-5's *"streaming
 *   resumes with the next frame captured"*).
 * - `ended` — the pairing is over and **nothing can bring it back** (#529,
 *   carried over from #536's review): either device ended it, or the
 *   connection failed, which a host-only link cannot re-establish without a
 *   new pair of codes (D-1). ⚠️ **A session on an ended link is on its own
 *   30 seconds** exactly as on a lost one — an ended link never recovers, so
 *   the stop is certain — and a new session needs a new pairing (D-4: *"scan
 *   every time"*). `views/SideCameraView.tsx` refuses to hand an ended link to
 *   a new session for that reason.
 */
export type SideLinkCondition = 'connecting' | 'connected' | 'lost' | 'ended';

/**
 * One thing the link reports: its condition changing, or a command from the
 * tablet (D-3's tablet → phone column).
 *
 * ⚠️ **`reference` and `verdict` are `unknown` on purpose.** A received
 * message is untrusted input (D-4), and the phone decodes both itself —
 * `framing.ts` §`framingReferenceFrom` and §`framingVerdictFrom` — rather than
 * trusting that whatever produced this event already did.
 */
export type SideLinkEvent =
  | { readonly kind: 'condition'; readonly condition: SideLinkCondition }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'reference'; readonly reference: unknown }
  | { readonly kind: 'verdict'; readonly verdict: unknown };

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

/**
 * What became of one picture the phone tried to send — #530.
 *
 * - `sent` — handed to the channel. Not acknowledged, and not meant to be:
 *   the `frames` channel has no retransmission (D-3).
 * - `no-link` — the link is not connected, so the picture is discarded at
 *   once (D-5: *"a frame captured while the link is down is discarded at
 *   once"*).
 * - `busy` — the last picture has not left yet, so this one is dropped rather
 *   than queued behind it (D-6's *"a queue of photographs in memory is
 *   refused"*, on the sending end).
 * - `too-large` — larger than the connection carries in one message; not sent
 *   and not split (`side-link-pictures.ts` §`MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES`).
 */
export type SidePictureSent = 'sent' | 'no-link' | 'busy' | 'too-large';

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
   * Send one picture to the tablet — #530. Never throws and never waits, for
   * {@link reportToTablet}'s reason; what became of it is the answer.
   *
   * ⚠️ **The caller drops the picture whatever the answer is.** Nothing on the
   * phone keeps one (D-8), and a picture that was not sent is not sent later.
   */
  sendPictureToTablet(picture: SidePicture): SidePictureSent;
  /**
   * End the pairing. D-4: *"a pairing lasts one session"* and *"ends when
   * either device stops the session"* — nothing is remembered, so ending it is
   * also the whole of revoking it. Idempotent.
   */
  endSideLink(): void;
}
