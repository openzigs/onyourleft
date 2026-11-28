// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Asking for Bluetooth in context, inside the Android shell — #1436.
 * @see ./bluetooth-ask-port.ts for why this exists.
 */

import type { BluetoothAskPort } from './bluetooth-ask-port';
import type { ShellKind } from './capacitor';

/**
 * Why Android is about to ask, said before it does. ⚠️ **"Never reads", not
 * "never asks"**: below API 31 a Bluetooth search needs the location
 * permission and the plugin asks for it there (minSdk is 24), so on Android 11
 * and older the dialog a rider meets is titled Location.
 */
export const BLUETOOTH_WHY =
  'Android will ask to let On Your Left find nearby devices: it is how this app reaches your ' +
  'trainer and sensors, and it is used for nothing else. On Android 11 and older Android calls ' +
  'this Location — this app never reads your location.';

/**
 * Why the iOS app is about to ask — #3239. ⚠️ **Draft wording for the
 * owner.** iOS and iPadOS ask for Bluetooth by that name, and never for
 * Location to scan, so the Android sentence's second half has no place here.
 */
export const BLUETOOTH_WHY_IOS =
  'Your iPhone or iPad will ask to let On Your Left use Bluetooth: it is how this app reaches ' +
  'your trainer and sensors, and it is used for nothing else.';

/** {@link BLUETOOTH_WHY}, or the iOS app's — #3239. Android's in any other shell. */
export function bluetoothWhy(kind: ShellKind | undefined): string {
  return kind === 'ios' ? BLUETOOTH_WHY_IOS : BLUETOOTH_WHY;
}

/** The label above it: who is about to ask — #3239. */
export function beforeTheAskLabel(kind: ShellKind | undefined): string {
  return kind === 'ios' ? 'Before your iPhone or iPad asks' : 'Before Android asks';
}

/** The press that lets Android ask. */
export const LOOK_FOR_DEVICES = 'Look for my trainer and sensors';

/** Namespaced, because the origin is shared. The `v1` is the shape's. */
export const BLUETOOTH_ASKED_STORAGE_KEY = 'oyl.bluetooth-asked.v1';

/** The two things this asks of a `Storage`, so a test can hand it a double. */
export type AskStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * {@link BluetoothAskPort} over the device's own storage. With no storage —
 * a WebView that refuses it — every visit explains again, which costs a press
 * and never skips the explanation.
 */
export function deviceBluetoothAsk(storage: AskStorage | undefined): BluetoothAskPort {
  return {
    askedBefore: () => {
      try {
        return storage?.getItem(BLUETOOTH_ASKED_STORAGE_KEY) === 'yes';
      } catch {
        return false;
      }
    },
    noteAsked: () => {
      try {
        storage?.setItem(BLUETOOTH_ASKED_STORAGE_KEY, 'yes');
      } catch {
        // Full or refused: the rider is shown the explanation again next time.
      }
    },
  };
}
