// SPDX-License-Identifier: Apache-2.0

/**
 * The OpenBikeControl v1 codec (#1822): a button-state notification into steer
 * and button events, and the app-information message this program writes.
 * No transport and no game: #1824 (Web Bluetooth) and #1825 (the Android shell)
 * hand this bytes, and #1827 turns its events into Delivery's intents.
 *
 * ## The protocol, in this repository's own words
 *
 * Written from the OpenBikeControl specification, **Version 1** (MIT), read at
 * the spec repository's commit `760a7b15` on 2026-10-27 and again on
 * 2026-11-03. Nothing of the specification's text or tables is reproduced
 * here; the UUIDs, byte values and message layouts below are facts about the
 * wire. No code from BikeControl or qdomyos-zwift was read or copied
 * (`docs/agents/scope-and-ip.md`).
 *
 * - The controller is the GATT server and this program the central. It
 *   advertises {@link OPEN_BIKE_CONTROL_SERVICE}.
 * - **Button state** ({@link OPEN_BIKE_CONTROL_BUTTON_STATE}, read and notify):
 *   one message-type octet, `0x01`, then pairs of a button id and its state.
 *   A state of `0x00` is released, `0x01` pressed, and `0x02`..`0xFF` an
 *   analog value whose meaning depends on the button.
 * - Button `0x18` steers left and `0x19` right. Button `0x1B` carries a
 *   calibrated steering angle: `0x80` is straight ahead, each step is half a
 *   degree, so `0x02` is 63° left and `0xFE` 63° right. `0x00` says no angle
 *   is available (the rider's own steering takes over); `0x01` and `0xFF` mean
 *   nothing and are ignored.
 * - A device may send the angle beside the discrete steer buttons, so that an
 *   app without proportional steering still works. An app that has the angle
 *   prefers it: {@link SteerEvent.superseded} marks a discrete steer that came
 *   in the same message as an available angle.
 * - **App information** ({@link OPEN_BIKE_CONTROL_APP_INFORMATION}, write):
 *   `0x04`, a format version `0x01`, a length-prefixed app id, a
 *   length-prefixed app version, then a count and that many button ids.
 *
 * ## Sensor data is untrusted input
 *
 * CLAUDE.md §6: the device on the other end may not be what it claims. So
 * {@link parseButtonState} **never throws** and returns a typed
 * {@link ButtonStateError} for every malformed shape, and it checks the length
 * against {@link MAX_BUTTON_STATE_OCTETS} before it reads or allocates
 * anything, so an oversized notification costs nothing per byte.
 *
 * ## Not a trainer path
 *
 * Nothing here imports a module of the trainer-command seam, and no event
 * names a resistance, a power target or a gradient: a button that is not a
 * steer is reported as a bare id and state, for #1827 to ignore or map to a
 * throw. `open-bike-control.test.ts` holds the import list.
 */

import type { GattUuid } from './uuid';

/** The OpenBikeControl primary service a controller advertises. */
export const OPEN_BIKE_CONTROL_SERVICE: GattUuid = 'd273f680-d548-419d-b9d1-fa0472345229';

/** Button state: read and notify. */
export const OPEN_BIKE_CONTROL_BUTTON_STATE: GattUuid = 'd273f681-d548-419d-b9d1-fa0472345229';

/** Haptic feedback: write. Optional, and this program does not write to it. */
export const OPEN_BIKE_CONTROL_HAPTIC: GattUuid = 'd273f682-d548-419d-b9d1-fa0472345229';

/** App information: write. The app tells the device which buttons it uses. */
export const OPEN_BIKE_CONTROL_APP_INFORMATION: GattUuid = 'd273f683-d548-419d-b9d1-fa0472345229';

/** The button ids this codec gives a meaning to. Every other id is passed on as a number. */
export const OPEN_BIKE_CONTROL_BUTTON = {
  steerLeft: 0x18,
  steerRight: 0x19,
  steeringAngle: 0x1b,
} as const;

/** The message type of a button-state notification. */
const BUTTON_STATE_MESSAGE = 0x01;

/** The message type and format version of the app-information message. */
const APP_INFORMATION_MESSAGE = 0x04;
const APP_INFORMATION_VERSION = 0x01;

/**
 * The largest button-state notification this codec reads: the message type
 * and 32 pairs, 65 octets.
 *
 * Proposed in #1822's PR. The specification recommends at most nine pairs
 * (20 octets, one default ATT payload), but lets one physical button send
 * several actions at once and prefers a 247-octet MTU, so a conforming device
 * can exceed nine. 32 pairs is more than three actions on each of ten buttons
 * changing in one notification; anything longer is refused before a byte of it
 * is read.
 */
export const MAX_BUTTON_STATE_OCTETS = 1 + 2 * 32;

/** The steering angle's centre code and step. */
const ANGLE_CENTRE = 0x80;
const DEGREES_PER_STEP = 0.5;

/** The angle codes the specification gives a meaning to. */
const ANGLE_UNAVAILABLE = 0x00;
const ANGLE_FIRST = 0x02;
const ANGLE_LAST = 0xfe;

/** The furthest a valid angle reads either side of straight ahead, in degrees: 63. */
export const MAX_STEERING_ANGLE_DEGREES = (ANGLE_LAST - ANGLE_CENTRE) * DEGREES_PER_STEP;

/**
 * Steer left or right was pressed or released.
 *
 * `superseded` is true when the same notification also carried an available
 * steering angle: the device is steering proportionally, and the specification
 * asks an app that has the angle to act on it and not on this.
 */
export interface SteerEvent {
  readonly kind: 'steer';
  readonly direction: 'left' | 'right';
  readonly pressed: boolean;
  readonly superseded: boolean;
}

/** The handlebar's calibrated angle; negative is left, positive right, at most ±63°. */
export interface SteeringAngleEvent {
  readonly kind: 'steering-angle';
  readonly degrees: number;
}

/** The device has no angle to give (uncalibrated, recalibrating, or the sensor is lost). */
export interface SteeringAngleUnavailableEvent {
  readonly kind: 'steering-angle-unavailable';
}

/**
 * Any other button. `pressed` is true for every non-zero state; `state` is the
 * raw octet, so an analog value is not lost. The id is not interpreted here.
 */
export interface ButtonEvent {
  readonly kind: 'button';
  readonly button: number;
  readonly pressed: boolean;
  readonly state: number;
}

export type OpenBikeControlEvent =
  SteerEvent | SteeringAngleEvent | SteeringAngleUnavailableEvent | ButtonEvent;

/** Why a notification was refused. None of these is ever thrown. */
export type ButtonStateError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'no-buttons' }
  | { readonly kind: 'oversized'; readonly octets: number }
  | { readonly kind: 'unknown-message-type'; readonly messageType: number }
  | { readonly kind: 'odd-length'; readonly octets: number };

export type ButtonStateResult =
  | { readonly ok: true; readonly events: readonly OpenBikeControlEvent[] }
  | { readonly ok: false; readonly error: ButtonStateError };

const refused = (error: ButtonStateError): ButtonStateResult => ({ ok: false, error });

/**
 * Parse one button-state notification.
 *
 * Events come out in the order the pairs went in. An angle code the
 * specification calls a no-op (`0x01`, `0xFF`) gives no event.
 */
export function parseButtonState(value: DataView): ButtonStateResult {
  const octets = value.byteLength;
  if (octets === 0) return refused({ kind: 'empty' });
  if (octets > MAX_BUTTON_STATE_OCTETS) return refused({ kind: 'oversized', octets });
  const messageType = value.getUint8(0);
  if (messageType !== BUTTON_STATE_MESSAGE) {
    return refused({ kind: 'unknown-message-type', messageType });
  }
  if (octets === 1) return refused({ kind: 'no-buttons' });
  if ((octets - 1) % 2 !== 0) return refused({ kind: 'odd-length', octets });

  // First pass: is an angle available anywhere in this message? A discrete
  // steer before the angle is superseded as surely as one after it.
  let angleAvailable = false;
  for (let at = 1; at < octets; at += 2) {
    if (value.getUint8(at) === OPEN_BIKE_CONTROL_BUTTON.steeringAngle) {
      const code = value.getUint8(at + 1);
      if (code >= ANGLE_FIRST && code <= ANGLE_LAST) angleAvailable = true;
    }
  }

  const events: OpenBikeControlEvent[] = [];
  for (let at = 1; at < octets; at += 2) {
    const button = value.getUint8(at);
    const state = value.getUint8(at + 1);
    if (button === OPEN_BIKE_CONTROL_BUTTON.steeringAngle) {
      if (state === ANGLE_UNAVAILABLE) {
        events.push({ kind: 'steering-angle-unavailable' });
      } else if (state >= ANGLE_FIRST && state <= ANGLE_LAST) {
        events.push({ kind: 'steering-angle', degrees: (state - ANGLE_CENTRE) * DEGREES_PER_STEP });
      }
    } else if (
      button === OPEN_BIKE_CONTROL_BUTTON.steerLeft ||
      button === OPEN_BIKE_CONTROL_BUTTON.steerRight
    ) {
      events.push({
        kind: 'steer',
        direction: button === OPEN_BIKE_CONTROL_BUTTON.steerLeft ? 'left' : 'right',
        pressed: state !== 0,
        superseded: angleAvailable,
      });
    } else {
      events.push({ kind: 'button', button, pressed: state !== 0, state });
    }
  }
  return { ok: true, events };
}

/**
 * The app id this program sends. Fixed, so that it names the app and nothing
 * about the rider or the install.
 */
export const OPEN_BIKE_CONTROL_APP_ID = 'onyourleft';

/**
 * Build the app-information message: {@link OPEN_BIKE_CONTROL_APP_ID}, an
 * **empty** version (a version string would narrow down an install for no
 * benefit to the rider), and the buttons the app acts on.
 *
 * The buttons are this program's own constant, not input, so a value that is
 * not a byte, or more than 255 of them, is a programming error and throws.
 */
export function encodeAppInformation(buttons: readonly number[]): Uint8Array {
  if (buttons.length > 0xff) {
    throw new RangeError(
      `at most 255 button ids fit the app information, given ${String(buttons.length)}`,
    );
  }
  for (const button of buttons) {
    if (!Number.isInteger(button) || button < 0 || button > 0xff) {
      throw new RangeError(`a button id is one octet, 0 to 255, given ${String(button)}`);
    }
  }
  const id = OPEN_BIKE_CONTROL_APP_ID;
  const bytes = new Uint8Array(2 + 1 + id.length + 1 + 1 + buttons.length);
  let at = 0;
  bytes[at++] = APP_INFORMATION_MESSAGE;
  bytes[at++] = APP_INFORMATION_VERSION;
  bytes[at++] = id.length;
  // The id is lowercase ASCII, so each character is its own UTF-8 octet and no
  // platform encoder is needed in this platform-free module.
  for (let index = 0; index < id.length; index += 1) bytes[at++] = id.charCodeAt(index);
  bytes[at++] = 0; // the version: empty
  bytes[at++] = buttons.length;
  for (const button of buttons) bytes[at++] = button;
  return bytes;
}
