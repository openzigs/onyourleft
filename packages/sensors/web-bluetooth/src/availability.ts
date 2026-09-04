// SPDX-License-Identifier: Apache-2.0

/**
 * Deciding whether Web Bluetooth can be used here, without ever throwing.
 *
 * #40's fourth acceptance criterion: *"a test proves the adapter reports
 * `unavailable` cleanly when `navigator.bluetooth` is absent, rather than
 * throwing — this is the Safari and Firefox path and it must be graceful."*
 * Safari and Firefox are a quarter of the web and they are never going to
 * implement this (CLAUDE.md §8); an exception on that path is an exception on
 * first load for a quarter of visitors.
 *
 * ## Four ways this is unusable, not one
 *
 * A feature detect written as `'bluetooth' in navigator` gets three of the four
 * wrong:
 *
 * 1. **The object is absent.** Safari and Firefox on every platform, and *any*
 *    browser in a non-secure context — Web Bluetooth requires HTTPS or
 *    `localhost`, so a page served over plain HTTP on a LAN address sees
 *    nothing. `unsupported`.
 * 2. **The object is present and the implementation is partial.** This is
 *    Revision 2's addition to #1, and it is Chrome on Linux: WebBluetoothCG's
 *    own implementation status states *"Linux is partially implemented and not
 *    supported"* and requires `chrome://flags/#enable-experimental-web-platform-features`
 *    plus kernel 3.19+ and BlueZ 5.41+. The object exists; the adapter is not
 *    usable. Detected by requiring both `requestDevice` and `getAvailability`
 *    to be callable. `unsupported`.
 * 3. **`getAvailability()` itself fails.** The same partial-implementation
 *    case, one layer in, and the reason this function catches rather than
 *    letting a rejection out. `unsupported`.
 * 4. **Everything works and the radio is off.** `adapter-unavailable`, which is
 *    the one recoverable state of the four: the athlete turns Bluetooth on and
 *    tries again, and `../../src/transport.ts` says the honest UI here is a
 *    retry rather than an offer of the native app.
 *
 * ## What this deliberately cannot detect
 *
 * `not-permitted`. Web Bluetooth exposes no queryable permission for the API
 * itself — `navigator.permissions.query({ name: 'bluetooth' })` is behind a
 * flag and this program does not rely on it — so a Permissions Policy refusal
 * in a cross-origin iframe is only observable when `requestDevice` rejects with
 * `SecurityError`. `errors.ts` maps it there. Reporting `available` and then
 * failing at the chooser is worse than reporting the refusal up front, and it
 * is the only thing the platform makes possible.
 */

import type { TransportAvailability } from '../../src/transport';

import type { BluetoothPort } from './gatt';

/** Reusable, because there is exactly one of each and they carry no data. */
const UNSUPPORTED: TransportAvailability = { kind: 'unsupported' };
const AVAILABLE: TransportAvailability = { kind: 'available' };
const ADAPTER_UNAVAILABLE: TransportAvailability = { kind: 'adapter-unavailable' };

/**
 * Whether an object claiming to be `navigator.bluetooth` is complete enough to
 * drive.
 *
 * Both methods, not either: a partial implementation that has `requestDevice`
 * and not `getAvailability` would pass a one-sided check and then fail on the
 * first availability query, which is case 2 above arriving one call later.
 */
export function isUsableBluetooth(candidate: BluetoothPort | undefined): boolean {
  return (
    candidate !== undefined &&
    typeof candidate.requestDevice === 'function' &&
    typeof candidate.getAvailability === 'function'
  );
}

/**
 * Ask the platform, and answer for it when it cannot answer for itself.
 *
 * Never rejects. That is the point of the function.
 */
export async function readAvailability(
  candidate: BluetoothPort | undefined,
): Promise<TransportAvailability> {
  if (!isUsableBluetooth(candidate) || candidate === undefined) {
    return UNSUPPORTED;
  }
  try {
    return (await candidate.getAvailability()) ? AVAILABLE : ADAPTER_UNAVAILABLE;
  } catch {
    // Case 3. A `getAvailability` that throws is a `getAvailability` that is
    // not there in any sense that matters, and this branch is what stops a
    // rejected promise reaching a caller that was told this method resolves.
    return UNSUPPORTED;
  }
}
