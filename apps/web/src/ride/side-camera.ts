// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera, as a rider riding hears of it** — #551, a follow-up to
 * #550 for #529 and epic #549,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md).
 *
 * #550 keeps the tablet's pairing with the tripod phone alive when the rider
 * leaves the Camera screen, so the rider can ride. Until #551 the phone's
 * state was drawn only ON the Camera screen (`views/SideCameraControl.tsx`),
 * so during a ride the tablet said nothing when the link dropped — while the
 * phone ran its 30 seconds (ADR 0033 D-5) and stopped the camera. A rider
 * could finish a session with no pictures and no idea why.
 *
 * This module is the pure half: which one short line a ride shows, whether
 * the rider may stop the camera from the ride, and the one sentence said when
 * the link goes. The Ride screen (`ride/SideCameraOnRide.tsx`) and the game's
 * HUD (`game/GameView.tsx`) both read it, so the two cannot disagree.
 *
 * ## What it deliberately says nothing about
 *
 * ⚠️ **No picture, ever** — ADR 0033's *"no preview on the tablet"*, the
 * owner's ruling on #527. Everything here is derived from
 * `camera/side-pairing-port.ts` §`SideControlState`, which is words about a
 * phone and carries no picture at all; nothing here reads the pictures'
 * channel (`onSideCameraPicture`) or the analysis port.
 *
 * And nothing here says anything about a body (ADR 0030): the line is about
 * the phone and the link, and so is the sentence.
 */

import type { AnnouncementEvent } from '../game/hud/announce';
import type { SideControlState } from '../camera/side-pairing-port';

/**
 * The line's states, in the order {@link sideCameraOnRide} decides them.
 *
 * - `lost` — the tablet cannot hear the phone. #551's own word, and the one
 *   that matters: the phone stops by itself within 30 seconds (D-5).
 * - `ended` — the pairing ended some other way while the phone had not said
 *   it stopped (a broken message, a stranger's connection). Not "stopped",
 *   because the tablet does not know that it did.
 * - `stopped` — the phone said it stopped.
 * - `stopping` — the rider pressed *Stop side camera* and the phone has not
 *   confirmed yet.
 * - `stop-unconfirmed` — …and did not confirm in time. The tablet does not
 *   assume the stop arrived (#529's fourth criterion, kept on the ride).
 * - `framing` — the phone's camera is on and it is NOT filming. On the line
 *   because a rider who believes they are being filmed is the other way to end
 *   a session with no pictures.
 * - `filming` — filming.
 */
export type SideCameraOnRide =
  'lost' | 'ended' | 'stopped' | 'stopping' | 'stop-unconfirmed' | 'framing' | 'filming';

/**
 * Where a paired side camera is, as one line — or `undefined` when there is
 * no pairing to speak of.
 *
 * `undefined` for no pairing, and for a pairing whose offer is still on the
 * Camera screen or whose phone has not yet proved itself (`pairing`): the
 * issue asks for the line *"while paired"*, and an offer nobody answered is
 * not a pairing a ride has anything to say about.
 *
 * ⚠️ **Link lost wins over everything**, including an ended pairing — the
 * link going IS how a pairing ends mid-ride (`side-link.ts` §`#end` sets the
 * phone `lost` for `link-lost`), and the rider's question is the same either
 * way: is anything being filmed.
 */
export function sideCameraOnRide(
  state: SideControlState | undefined,
): SideCameraOnRide | undefined {
  if (state === undefined || !state.answered) {
    return undefined;
  }
  if (state.phone === 'lost') {
    return 'lost';
  }
  if (state.phone === 'stopped') {
    return 'stopped';
  }
  if (state.ended !== undefined) {
    return 'ended';
  }
  if (state.phone === 'pairing') {
    return undefined;
  }
  if (state.command?.kind === 'stop') {
    if (state.command.status === 'waiting') return 'stopping';
    if (state.command.status === 'unacknowledged') return 'stop-unconfirmed';
  }
  return state.phone;
}

/** What every line starts with — a `StatusMessage`'s label for a lost link. */
export const SIDE_CAMERA_LABEL = 'Side camera';

/**
 * The line, per state, after {@link SIDE_CAMERA_LABEL} and a colon.
 *
 * ⚠️ **Short because the HUD has no room, measured.** On a 736×360 phone the
 * actions panel has about 16 px to spare on the CI runner's fonts before it
 * lands on the panel above (`ride.browser.spec.ts` §"#551" publishes it), and
 * this line shares a row with *Stop side camera* in about 160 px. Two lines
 * fit that row; the first wording (*"stopping — waiting for the phone to
 * confirm"*) was four. The lost link is a notice and has the notice slot's
 * width, so it keeps the 30 seconds.
 */
export const SIDE_CAMERA_ON_RIDE_TEXT: Readonly<Record<SideCameraOnRide, string>> = {
  lost: 'link lost. If it was filming, it stops by itself within 30 seconds.',
  ended: 'session ended.',
  stopped: 'stopped.',
  stopping: 'stopping…',
  'stop-unconfirmed': 'stop not confirmed. Look at the phone.',
  framing: 'on, not filming.',
  filming: 'filming.',
};

/** The whole line, as a rider reads it when it is not a lost link's notice. */
export function sideCameraLine(line: SideCameraOnRide): string {
  return `${SIDE_CAMERA_LABEL}: ${SIDE_CAMERA_ON_RIDE_TEXT[line]}`;
}

/**
 * Whether the rider may stop the camera from the ride — #551's third
 * criterion.
 *
 * While the phone films, and while the link is lost and the pairing has not
 * ended: a stop sent then may be heard if the link comes back inside the 30
 * seconds, and the Camera screen offers *Stop filming* in exactly those two
 * states (`views/SideCameraControl.tsx` §`Controls`). Not once the pairing has
 * ended — `commandSideCamera` ignores it then, and a control that does nothing
 * is noise on a HUD.
 */
export function sideCameraStoppable(state: SideControlState | undefined): boolean {
  return (
    state !== undefined &&
    state.answered &&
    state.ended === undefined &&
    (state.phone === 'filming' || state.phone === 'lost')
  );
}

/** Whether a ride would call this link lost. */
export function sideCameraLost(state: SideControlState | undefined): boolean {
  return sideCameraOnRide(state) === 'lost';
}

/** The one sentence said when the link goes. */
export const SIDE_CAMERA_LOST_SENTENCE =
  'Side camera link lost. If it was filming, it stops by itself within 30 seconds.';

/**
 * The announcement for one change, or `undefined` — #551's second criterion.
 *
 * **When it happens, never on a first render and never again every frame**:
 * `wasLost` is what the caller last saw, and only the step from not lost to
 * lost is an event. A ride that starts with the link already lost has not
 * seen it happen — `RideAnnouncer.tsx`'s rule, *"a screen a rider navigates
 * back to, with control already lost, does not announce it again"* — and the
 * line is on the screen for that rider either way.
 *
 * A link that comes back and goes again is said again: it happened again.
 */
export function sideCameraLostEvent(
  wasLost: boolean,
  state: SideControlState | undefined,
): AnnouncementEvent | undefined {
  return !wasLost && sideCameraLost(state)
    ? { kind: 'side-camera-lost', text: SIDE_CAMERA_LOST_SENTENCE }
    : undefined;
}
