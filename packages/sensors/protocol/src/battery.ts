// SPDX-License-Identifier: Apache-2.0

/**
 * The Battery Service (0x180F) client: one Battery Level value into a
 * {@link Percent} (#2046).
 *
 * ## The characteristic
 *
 * Battery Level (0x2A19) is a single `uint8`: the remaining charge as a whole
 * percentage, 0 to 100. Read, and optionally notified. Every BLE sensor this
 * program pairs with is likely to serve it, which is why a sensor module
 * wants it beside the reading.
 *
 * ## Sensor data is untrusted input
 *
 * CLAUDE.md §6: the device on the other end may not be what it claims. So
 * {@link parseBatteryLevel} **never throws** and returns a typed
 * {@link BatteryLevelError} for every malformed shape, and it checks the
 * length before it reads anything.
 *
 * - **Exactly one octet.** An empty payload has no level, and a longer one is
 *   not this characteristic. Reading the first octet of a longer payload would
 *   report a number from a device that is saying something else.
 * - **Never above 100.** A value of 101 to 255 is not a battery level, and it
 *   is refused rather than clamped: a clamped 255 would show a full battery for
 *   a device that sent nonsense, which is a lie a rider would act on.
 *
 * An error names the field and the constraint, and keeps the received value:
 * a battery level is not a coordinate (ADR 0004 decision D), so the number is
 * the diagnostic.
 *
 * ## Not on the transport boundary — read beside it (#2047)
 *
 * This is a decoder, not a `GattProfile`: a battery level is not a
 * `MeasurementCapability`, so `SensorTransport` does not carry it. Its first
 * consumer, Home's sensors module (#2047), reads it through the Web Bluetooth
 * transport's own `readBatteryLevel`, one read at a time, as
 * `openFitnessMachine` is that transport's own seam for FTMS.
 */

import { percent, type Percent } from '@onyourleft/domain';

import type { GattUuid } from './uuid';

/**
 * Battery Service.
 *
 * 16-bit assigned number **0x180F**, read on 2026-11-03 from the Bluetooth
 * SIG's own machine-readable assigned numbers (`bluetooth-SIG/public` →
 * `assigned_numbers/uuids/service_uuids.yaml`, name "Battery").
 * `web-bluetooth/src/protocol-registry.test.ts` asserts this literal equals
 * `canonicalUuid(0x180f)`.
 */
export const BATTERY_SERVICE: GattUuid = '0000180f-0000-1000-8000-00805f9b34fb';

/**
 * Battery Level. 16-bit assigned number **0x2A19**, read on 2026-11-03 from
 * `characteristic_uuids.yaml` in the same repository.
 */
export const BATTERY_LEVEL: GattUuid = '00002a19-0000-1000-8000-00805f9b34fb';

/** The one field this characteristic carries, as an error names it. */
const FIELD = 'battery level';

/** The largest level the characteristic can mean. */
export const MAX_BATTERY_LEVEL_PERCENT = 100;

/** Why a Battery Level value was refused. None of these is ever thrown. */
export type BatteryLevelError =
  | {
      readonly kind: 'wrong-length';
      readonly field: typeof FIELD;
      readonly constraint: 'exactly 1 octet';
      readonly octets: number;
      readonly message: string;
    }
  | {
      readonly kind: 'out-of-range';
      readonly field: typeof FIELD;
      readonly constraint: 'a whole percent from 0 to 100';
      readonly value: number;
      readonly message: string;
    };

export type BatteryLevelResult =
  | { readonly ok: true; readonly level: Percent }
  | { readonly ok: false; readonly error: BatteryLevelError };

/** Parse one Battery Level value, read or notified. */
export function parseBatteryLevel(value: DataView): BatteryLevelResult {
  const octets = value.byteLength;
  if (octets !== 1) {
    const constraint = 'exactly 1 octet';
    return {
      ok: false,
      error: {
        kind: 'wrong-length',
        field: FIELD,
        constraint,
        octets,
        message: `${FIELD} must be ${constraint}, received ${String(octets)}`,
      },
    };
  }
  const raw = value.getUint8(0);
  if (raw > MAX_BATTERY_LEVEL_PERCENT) {
    const constraint = 'a whole percent from 0 to 100';
    return {
      ok: false,
      error: {
        kind: 'out-of-range',
        field: FIELD,
        constraint,
        value: raw,
        message: `${FIELD} must be ${constraint}, received ${String(raw)}`,
      },
    };
  }
  // A `uint8` at or under 100 is a whole number in range, so `percent` cannot
  // throw here; it labels the value rather than re-checking it.
  return { ok: true, level: percent(raw) };
}
