// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Pairing the tablet with the tripod phone, and the tablet's end of the
 * link once they are paired** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1, D-3 and D-4.
 *
 * The phone's end is `side-camera-link-port.ts`, which #528 wrote first. This
 * is where a link comes from on either device, and what the tablet can do
 * with one. `side-link.ts` §`sidePairingPort` is the implementation, over a
 * WebRTC data channel with no ICE server of any kind.
 *
 * ## Why a `*-port.ts`
 *
 * #529 asks for it by name: `check:wiring` watches every `*-port.ts`, so a
 * method here that no production code calls is a red `WIRE003`. The names are
 * distinctive (`offerSideCamera`, `commandSideCamera`, `endSidePairing`) for
 * `side-camera-link-port.ts`' reason — `close` or `send` is called somewhere
 * in this client already, and the gate would credit that call to this port.
 *
 * ## What a pairing is (D-4)
 *
 * **One connection, once, for one session**, and nothing about it is
 * remembered on either device. There is no list of paired phones and no
 * stored key, so there is nothing to revoke: ending the session — from either
 * device — IS revoking it, and a used code cannot pair again because the
 * connection it described is gone.
 */

import type { FramingReference, FramingVerdict } from './framing';
import type { SideAnalysisPort } from './side-analysis-port';
import type { PairingRefusal } from './side-link-code';
import type { SidePicture } from './side-link-pictures';
import type { PhoneCommand } from './side-link-messages';
import type { SideCameraLinkPort, SideCameraStopReason } from './side-camera-link-port';

/**
 * What the tablet shows about the phone — #529's second criterion, word for
 * word: *"pairing, framing, filming, stopped, or link lost"*.
 */
export type SidePhoneState = 'pairing' | 'framing' | 'filming' | 'stopped' | 'lost';

/** Where a command the tablet sent has got to. */
export type SideCommandStatus =
  /** Sent, and the phone has not said it arrived. */
  | 'waiting'
  /** The phone acknowledged it. */
  | 'acknowledged'
  /**
   * ⚠️ **The phone did not acknowledge it in time, and the tablet does not
   * assume it arrived** — #529's fourth criterion, in the trainer control
   * point's spirit. It may have arrived and its acknowledgement been lost; it
   * may not. The tablet says which one it knows, which is neither.
   */
  | 'unacknowledged';

/** Why a pairing ended. */
export type SidePairingEnd =
  /** The rider ended it on this tablet. */
  | 'ended-here'
  /** The phone ended it: its own stop, or its screen going away. */
  | 'phone-ended'
  /** The connection went and did not come back. */
  | 'link-lost'
  /** The two devices never found a path to each other. */
  | 'no-path'
  /**
   * No path, and both codes carried only mDNS names — spike 0011's finding
   * that an Android end cannot resolve one, said after ICE failed rather than
   * refused at decode (#529, from spike 0011's review).
   */
  | 'names-only'
  /** The device that connected did not send this pairing's secret first (D-4). */
  | 'not-our-phone'
  /** The other end sent something D-3 does not list (D-4). */
  | 'broken'
  /** The offer was not answered in time (D-4's bound). */
  | 'offer-expired';

/** Everything the tablet's screen renders from. The same object until something changes. */
export interface SideControlState {
  readonly phone: SidePhoneState;
  /**
   * Whether the phone's answer has been accepted — the offer is spent (D-4),
   * and the screen stops showing it even before the phone has proved itself.
   */
  readonly answered: boolean;
  /** Why the phone stopped, when it has said so. */
  readonly stopReason: SideCameraStopReason | undefined;
  /** The last command the tablet sent, and where it has got to. */
  readonly command: { readonly kind: PhoneCommand; readonly status: SideCommandStatus } | undefined;
  /** Why the pairing ended, or `undefined` while it has not. */
  readonly ended: SidePairingEnd | undefined;
}

/** The tablet's end of a paired link. */
export interface SideCameraControlPort {
  /** The current state. */
  sideControlState(): SideControlState;
  /** Call `listener` whenever {@link sideControlState} would answer differently. */
  onSideControlChange(listener: () => void): () => void;
  /**
   * Tell the phone to start or stop filming. Acknowledged, or reported as
   * not — {@link SideCommandStatus}. Ignored once the pairing has ended.
   */
  commandSideCamera(command: PhoneCommand): void;
  /**
   * End the pairing from this tablet — D-4's *"revoking"*. A phone that is
   * framing or filming is told to stop first. Idempotent.
   */
  endSidePairing(): void;
  /**
   * Call `listener` with every picture the phone sends — #530. Only after the
   * phone has proved itself (D-4), and nothing once the pairing has ended.
   *
   * ⚠️ **The picture is the listener's for the length of the call and no
   * longer**: nothing here holds one, and `side-analysis.ts` — the one
   * production listener — keeps at most one waiting for the model (D-6).
   *
   * @returns the unsubscribe.
   */
  onSideCameraPicture(listener: (picture: SidePicture) => void): () => void;
  /**
   * Send the phone the rider's stored framing reference, so it can draw the
   * ghost outline — ADR 0033 D-7, numbers only. Ignored before the phone has
   * proved itself and after the pairing ends.
   */
  shareFramingReference(reference: FramingReference): void;
  /** Send the phone the tablet's framing check (D-7). Ignored as above. */
  shareFramingVerdict(verdict: FramingVerdict): void;
}

/** The tablet's pairing, while its offer is on screen and after. */
export interface TabletSidePairing {
  /** The text of the QR code the tablet shows. */
  readonly offerCode: string;
  /**
   * The phone's answer, as the tablet's camera read it.
   *
   * @returns the refusal when the code is not this pairing's answer, and
   * `undefined` when it was accepted. ⚠️ **Accepted once**: a second answer,
   * or an answer after the pairing ended, is refused as `used` — D-4's
   * *"single use"*.
   */
  acceptSidePhoneCode(answerCode: string): Promise<PairingRefusal | undefined>;
  /** The link, from the moment the offer exists. */
  readonly control: SideCameraControlPort;
  /**
   * What the tablet makes of the phone's pictures — #530 — or `undefined`
   * where this build has no pose model to run. Made with the pairing and ends
   * with it.
   */
  readonly analysis: SideAnalysisPort | undefined;
}

/** The phone's pairing, once it has read the tablet's offer. */
export interface PhoneSidePairing {
  /** The text of the QR code the phone shows back. */
  readonly answerCode: string;
  /** The link, `connecting` until the tablet reads the answer. */
  readonly link: SideCameraLinkPort;
}

/** Where a pairing comes from, on either device. */
export interface SidePairingPort {
  /**
   * The tablet: make an offer to show. ⚠️ **One side camera at a time**: a
   * pairing this tablet already has is ended first, as if the rider had
   * pressed *End pairing* on it — a second phone replaces the first rather
   * than joining it (ADR 0033 did not consider more than one side camera).
   */
  offerSideCamera(): Promise<TabletSidePairing | PairingRefusal>;
  /**
   * The tablet's pairing, if it has one — ended or not.
   *
   * ⚠️ **Here, and not in a screen's state, because the pairing has to outlive
   * the screen.** The rider pairs on the Camera screen and then rides, and a
   * pairing held by the Camera screen would end the moment they left it —
   * with the phone on its 30 seconds. `main.tsx` builds one port per tab, as
   * it builds one camera, for the same reason `AppShell.tsx` §`camera` gives.
   */
  currentSideCamera(): TabletSidePairing | undefined;
  /** The phone: answer the offer its camera read. */
  answerSideCamera(offerCode: string): Promise<PhoneSidePairing | PairingRefusal>;
}
