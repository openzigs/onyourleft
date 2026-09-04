// SPDX-License-Identifier: Apache-2.0

/**
 * The seam #41–#43 plug into: a GATT profile is a service UUID, a
 * characteristic UUID, the capabilities it can supply, and a decoder.
 *
 * ## Why the decoder pushes into a sink rather than returning measurements
 *
 * A decoder that returned `SensorMeasurement[]` would allocate an array on
 * every notification, and one notification per second from each of three
 * sensors is ten thousand arrays an hour that exist only to be iterated once
 * and thrown away. #40's fifth acceptance criterion is that notification
 * handling allocates nothing per notification, so the decoder is handed a sink
 * the adapter created **once per characteristic per link** and calls a method
 * on it per field present.
 *
 * The sink also removes two whole classes of decoder bug, because the decoder
 * never sees them:
 *
 * - **It cannot misattribute a measurement.** The device identity is the
 *   adapter's, stamped on the envelope the sink builds.
 * - **It cannot misdate one.** The receive instant is read once per
 *   notification by the adapter, before the decoder runs.
 *
 * ## The sink is keyed by capability, and the key set is checked
 *
 * `MeasurementSink` is a **mapped type over `MeasurementCapability`**, not a
 * hand-written interface with four methods. Review of PR #108 established the
 * difference in this repository: a hand-written list checks only that every
 * entry is in the union, and stays silently stale when the union grows. A
 * mapped type cannot — adding a fifth capability makes every sink in the
 * program a compile error until it grows a fifth method, which is the outcome
 * that gets the decoder written.
 */

import type {
  BeatsPerMinute,
  MetresPerSecond,
  RevolutionsPerMinute,
  Watts,
} from '@onyourleft/domain';
import type { MeasurementCapability } from '../../src/capability';

import type { GattUuid } from './gatt';

/**
 * The quantity each capability carries.
 *
 * `satisfies Record<MeasurementCapability, unknown>` in `sink-keys.test.ts` is
 * what stops this drifting from the union; the mapped type below is what stops
 * it drifting from the sink.
 */
export interface MeasurementValueFor {
  readonly power: Watts;
  readonly cadence: RevolutionsPerMinute;
  readonly 'heart-rate': BeatsPerMinute;
  readonly speed: MetresPerSecond;
}

/**
 * Where a decoder puts what it found.
 *
 * Every method is safe to call at any time: a value for a capability the device
 * did not declare, or one that arrives after the link dropped, is discarded by
 * the adapter rather than raised. A decoder is parsing untrusted bytes from a
 * device that may not be what it claims (SECURITY.md), and giving it an error
 * path to get wrong would be the larger risk.
 */
export type MeasurementSink = {
  readonly [Capability in MeasurementCapability]: (value: MeasurementValueFor[Capability]) => void;
};

/**
 * One GATT characteristic this program knows how to read.
 *
 * Registered with the adapter at construction. #41 supplies Heart Rate, #42
 * Cycling Speed and Cadence, #43 FTMS and Cycling Power; #40 supplies none,
 * because a profile that lands here rather than in its own issue arrives
 * without the specification reading that makes it correct.
 */
export interface GattProfile {
  /**
   * The primary service, as a canonical lowercase 128-bit UUID.
   *
   * The browser normalises `0x180d` and `'heart_rate'` to
   * `'0000180d-0000-1000-8000-00805f9b34fb'` before it compares anything, so
   * the adapter keeps the canonical form and never compares two spellings of
   * the same service — see `canonicalUuid`.
   */
  readonly service: GattUuid;
  readonly characteristic: GattUuid;
  /**
   * What a notification from this characteristic can carry.
   *
   * Declared rather than inferred from what `decode` happens to call, because
   * the adapter has to choose a source for each capability **before** the first
   * notification arrives: subscribing to power must start notifications on the
   * characteristic that will carry it, not on whichever one turns out to.
   */
  readonly capabilities: readonly MeasurementCapability[];
  /**
   * Turn one notification into zero or more measurements.
   *
   * @param value the characteristic's own `DataView`. **Not a copy** — copying
   * it would be an allocation per notification. A decoder must not retain it:
   * the browser reuses the underlying buffer for the next notification, so a
   * retained view reads the wrong payload a second later.
   * @param sink reused across notifications. A decoder must not retain it
   * either, for the same reason it must not retain the view.
   *
   * @throws anything. A hostile or malformed payload is expected, and the
   * adapter treats a throw as "this notification is unreadable", drops it and
   * carries on — a decoder is not required to be defensive as well as correct.
   */
  decode(value: DataView, sink: MeasurementSink): void;
}

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
