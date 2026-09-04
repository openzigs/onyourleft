// SPDX-License-Identifier: Apache-2.0

/**
 * A GATT UUID, and the one normalisation every layer of this program compares
 * through.
 *
 * ## Why this moved out of `web-bluetooth/`
 *
 * `GattUuid` and {@link canonicalUuid} were declared by #40 inside
 * `web-bluetooth/src/gatt.ts` and `web-bluetooth/src/profile.ts`, because at
 * that point the browser adapter was the only thing that had a UUID to compare.
 * #41 and #42 give them a second consumer, and it is the one the arrangement
 * exists for: `README.md` promises that the protocol clients are *"the same
 * parser, unchanged"* for the Capacitor plugin over CoreBluetooth and Android
 * BLE (#15). A profile that had to import its own service UUID's type from the
 * *browser* adapter would make #15 depend on #40, which is exactly the coupling
 * #39 was written to prevent.
 *
 * So the declarations live here, in a directory with no platform surface at
 * all, and `web-bluetooth/` re-exports them unchanged. Nothing about its entry
 * point moved.
 *
 * A UUID is not a Web Bluetooth type. It is a Bluetooth SIG assigned number,
 * and CoreBluetooth's `CBUUID` and Android's `java.util.UUID` carry the same
 * value.
 */

/**
 * A GATT UUID, in the canonical lowercase 128-bit form the browser normalises
 * to.
 *
 * Not branded: it is only ever compared with `===` against another string
 * {@link canonicalUuid} produced, and a brand here would have to be applied by
 * every profile to no benefit.
 */
export type GattUuid = string;

/**
 * The 128-bit form of a 16-bit assigned service or characteristic number.
 *
 * The Bluetooth base UUID, from the Assigned Numbers document. A profile may be
 * written with either form; the adapter canonicalises both so that a registry
 * entry written as `0x180d` and a browser that reports the long form are the
 * same key rather than two.
 */
const BLUETOOTH_BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/**
 * Normalise a UUID the way the browser does.
 *
 * @throws {RangeError} for anything that is neither a 16-bit assigned number
 * nor a 128-bit UUID. A silently accepted misspelling is a characteristic that
 * is never found, which surfaces as a sensor that pairs and then reports
 * nothing — the hardest failure in this stack to diagnose.
 */
export function canonicalUuid(value: GattUuid | number): GattUuid {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(
        `a 16-bit assigned number must be an integer in 0x0000..0xffff, received ${String(value)}`,
      );
    }
    return `${value.toString(16).padStart(8, '0')}${BLUETOOTH_BASE_UUID_SUFFIX}`;
  }
  const lower = value.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) {
    return lower;
  }
  if (/^(0x)?[0-9a-f]{1,4}$/.test(lower)) {
    return canonicalUuid(Number.parseInt(lower.replace(/^0x/, ''), 16));
  }
  throw new RangeError(`${value} is neither a 16-bit assigned number nor a 128-bit UUID`);
}
