// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told when pairing a device, or asking a trainer for
 * control, did not work — one plain sentence per state, each with the thing to
 * do about it ([#1435](https://github.com/openzigs/onyourleft/issues/1435)).
 *
 * ## Read from the code, never from the message
 *
 * Until #1435 the pairing notice and the trainer's *Refused* line showed the
 * transport's own `message` — *"the chooser closed without a device"*, *"the
 * machine refused op code 0x0 with Control Not Permitted: …"*. Those are
 * written for a bug report, and `SensorError`'s own rule is that a screen
 * renders from `code` (a platform message can name a device address or a
 * neighbour's device). So every sentence here is chosen by
 * {@link SensorErrorCode} and by which step failed. A failure that is NOT a
 * `SensorError` — a fault in this program rather than a state of the device —
 * keeps its message, as it always did, because there is no state to name.
 *
 * ## The four states #1435 asks for, and what can and cannot be told apart
 *
 * - **Not found** — the chooser closed with nothing chosen.
 * - **Held by another app or device** — ⚠️ **never a state of its own, and
 *   that is measured rather than chosen.** A Bluetooth trainer takes one
 *   controller at a time; one that is held usually stops advertising, so it is
 *   simply missing from the chooser, and one that is still listed refuses the
 *   connection. Neither stack says WHY: Web Bluetooth rejects with the same
 *   `NotFoundError` for an empty chooser and a cancelled one, and the Android
 *   plugin's `No device found.` carries no reason. So "another app may hold
 *   it" is said wherever it is a likely cause — beside *not found*, and as the
 *   cause of a connection that did not come up — rather than as a diagnosis
 *   this program cannot make.
 * - **Receiving power but not taking control** — the trainer answered Request
 *   Control with `0x05` Control Not Permitted ({@link controlRefusalWords}).
 *   That one IS told apart: it is the machine's own answer.
 * - **Link lost** — `SensorPairing.tsx` §`connectionWords`.
 *
 * ⚠️ **Nothing here sends anything to find out** (CLAUDE.md §6: trainer
 * control is a safety matter). Each sentence is the answer to a press the
 * rider made — *Pair* or *Ask the trainer for control* — and nothing probes a
 * trainer for control to decide which state it is in.
 */

import { isSensorError } from '@onyourleft/sensors';

/** Which half of a pairing failed. */
export type PairingStep =
  /** The chooser: nothing is linked yet. */
  | 'choosing'
  /** A device was chosen, and connecting to it or reading it failed. */
  | 'linking';

/**
 * Said beside *not found*: why a device that is switched on may still be
 * missing from the chooser. Shared with the link failure below, so the two
 * places that name the cause say it in one set of words.
 */
export const ONE_CONTROLLER_AT_A_TIME =
  'A Bluetooth trainer takes one app or bike computer at a time: if another one is connected to ' +
  'it, disconnect it there first.';

/** The chooser closed with nothing chosen. */
export const NOT_FOUND =
  'No device was chosen. If yours was not in the list, wake it — pedal, or put the strap on — ' +
  `and bring it closer. ${ONE_CONTROLLER_AT_A_TIME}`;

/** The rider has not let this app (or this site) use Bluetooth. */
export const NOT_PERMITTED =
  'This app is not allowed to use Bluetooth, so it could not look for devices. Allow Bluetooth ' +
  'for it, then pair again.';

/** The radio is off or not ready. */
export const BLUETOOTH_OFF = 'Bluetooth is off or not ready. Turn it on, then pair again.';

/** The platform has no Bluetooth this app can use. */
export const NO_BLUETOOTH_HERE = 'Bluetooth pairing does not work here.';

/** A pairing that did not start from a press — the screen's bug, not the rider's. */
export const PRESS_AGAIN = 'Pairing has to start from a press of a Pair button. Press it again.';

/** The OS-wide connection budget is spent. */
export const TOO_MANY_DEVICES =
  'Bluetooth here is holding as many devices as it can. Forget one you are not using, then ' +
  'pair again.';

/** Anything else the chooser reported. */
export const NOT_PAIRED_TRY_AGAIN = 'The device could not be paired. Try again.';

/**
 * A device was chosen and the link to it did not come up, or dropped while it
 * was being set up — the state in which another app holding it is the likeliest
 * cause.
 */
export function linkNotMade(name: string): string {
  return (
    `${name} was found, but the connection did not come up. ${ONE_CONTROLLER_AT_A_TIME} ` +
    'Then wake it, bring it closer and pair it again.'
  );
}

/**
 * What a failed *Pair* says. `name` is the chosen device's advertised name,
 * already on the screen, and only read for a failure after the chooser.
 */
export function pairingFailureWords(error: unknown, step: PairingStep, name: string): string {
  if (!isSensorError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case 'no-device-selected':
      return NOT_FOUND;
    case 'not-permitted':
      return NOT_PERMITTED;
    case 'transport-unsupported':
      return NO_BLUETOOTH_HERE;
    case 'user-gesture-required':
      return PRESS_AGAIN;
    case 'connection-budget-exceeded':
      return TOO_MANY_DEVICES;
    case 'adapter-unavailable':
      // ⚠️ The Android transport reports a connect that failed as
      // `adapter-unavailable` (`apps/mobile/src/ble/transport.ts` §`connect`),
      // so after the chooser it is the link, not the radio: the radio found
      // the device a moment ago.
      return step === 'linking' ? linkNotMade(name) : BLUETOOTH_OFF;
    default:
      return step === 'linking' ? linkNotMade(name) : NOT_PAIRED_TRY_AGAIN;
  }
}

/**
 * The trainer is connected and sending power, and answered Request Control
 * with Control Not Permitted — the state #1435 calls *receiving power but not
 * taking control*.
 */
export const POWER_BUT_NO_CONTROL =
  'The trainer is sending power but would not hand over control: another app or a bike ' +
  'computer probably has it. Close that app or disconnect the trainer there, then ask for ' +
  'control again.';

/** Request Control went unanswered. */
export const CONTROL_UNANSWERED =
  'The trainer did not answer the request for control. Ask again in a moment; if it still does ' +
  'not answer, turn the trainer off and on.';

/** Request Control was refused for some other reason. */
export const CONTROL_REFUSED =
  'The trainer refused the request for control. Turn it off and on, then ask again.';

/** The link went while control was being asked for. */
export const CONTROL_LINK_GONE =
  'The connection to the trainer dropped while asking for control. Pair it again on Devices.';

/** What a refused *Ask the trainer for control* says. */
export function controlRefusalWords(error: unknown): string {
  if (!isSensorError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case 'control-not-held':
      return POWER_BUT_NO_CONTROL;
    case 'control-timed-out':
      return CONTROL_UNANSWERED;
    case 'not-connected':
      return CONTROL_LINK_GONE;
    default:
      return CONTROL_REFUSED;
  }
}
