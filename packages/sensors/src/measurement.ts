// SPDX-License-Identifier: Apache-2.0

/**
 * What a transport delivers: one measurement per capability, every field
 * carrying its unit in its type.
 *
 * ## No raw numbers cross this boundary
 *
 * Every value below is a branded quantity from `@onyourleft/domain`. That is
 * acceptance criterion four of #39, and it is load-bearing rather than tidy: the
 * numbers arriving here have just come off a GATT payload where power is a
 * `sint16` of watts, speed is hundredths of a kilometre per hour, and cadence is
 * a revolution count that has to be differenced against an event-time counter
 * that wraps every 64 seconds. Those are four different ways to produce a
 * plausible wrong number, and a `number` field would accept all of them.
 * `Watts` and `MetresPerSecond` are constructed by `@onyourleft/domain`, which
 * validates as it labels, so "has a unit" and "has been checked" are the same
 * statement.
 *
 * The imports here are **type-only**. Nothing in `src/` calls a domain
 * constructor, so `@onyourleft/domain` contributes no runtime code to this
 * package — the transports in #40–#44 are where an unlabelled wire value meets
 * `watts()`, because that is the one place a reviewer can see which field is
 * which.
 *
 * ## Units this program does not have yet
 *
 * Three fields were left out rather than typed as a bare `number`, and each is a
 * gap in #25 rather than a decision here:
 *
 * - **Battery level** — needs a `Percent`. Every BLE sensor exposes it and the
 *   UI will want it.
 * - **FTMS resistance level and inclination** — need a `Percent` and a signed
 *   grade type.
 * - **FTMS total energy** — needs a `Kilojoules` (the characteristic reports
 *   kilojoules and kilocalories, which are not the same quantity).
 *
 * Adding any of them as `number` would put the first unlabelled number back on
 * the boundary this package exists to keep labelled.
 */

import type {
  BeatsPerMinute,
  MetresPerSecond,
  RevolutionsPerMinute,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';

import type { MeasurementCapability } from './capability';
import type { DeviceIdentity } from './device';

/**
 * What every measurement carries regardless of what it measures.
 *
 * @typeParam Capability - the discriminant. Narrowing on `capability` is what
 * makes `MeasurementFor<C>` work, and what makes a `switch` over a stream
 * exhaustively checked.
 */
export interface MeasurementEnvelope<Capability extends MeasurementCapability> {
  readonly capability: Capability;
  /**
   * Which device, on which stack, produced this.
   *
   * The full identity rather than the id, for the reason `device.ts` gives: an
   * id alone does not identify a device. It is on every measurement because a
   * ride can legitimately have two power sources — a trainer and a crank-based
   * meter — and a consumer that cannot attribute a sample cannot choose between
   * them.
   */
  readonly device: DeviceIdentity;
  /**
   * When the transport **received** this, as seconds since the Unix epoch.
   *
   * ⚠️ Not a device clock. Almost nothing in BLE cycling telemetry carries an
   * absolute time: the Cycling Power, CSC and FTMS notifications carry a
   * *wrapping* event-time counter in 1/1024 s or 1/2048 s ticks, which is good
   * for the interval between two notifications and useless as an instant. #42
   * and #43 difference those counters with
   * `@onyourleft/domain`'s `eventTimeIntervalSeconds`, which already knows about
   * the wrap; this field is the receive instant and is what a recorder should
   * align samples on.
   *
   * Measurements fanned out from a single composite notification (FTMS Indoor
   * Bike Data carries power, cadence and speed together) all carry the **same**
   * instant, which is how a consumer knows they were one sample.
   */
  readonly at: UnixSeconds;
}

/** Heart rate, from a strap, a band or a watch. */
export interface HeartRateMeasurement extends MeasurementEnvelope<'heart-rate'> {
  readonly heartRate: BeatsPerMinute;
}

/** Instantaneous mechanical power at the pedals. */
export interface PowerMeasurement extends MeasurementEnvelope<'power'> {
  readonly power: Watts;
}

/** Crank cadence. */
export interface CadenceMeasurement extends MeasurementEnvelope<'cadence'> {
  readonly cadence: RevolutionsPerMinute;
}

/** Ground speed, real or simulated by a trainer. */
export interface SpeedMeasurement extends MeasurementEnvelope<'speed'> {
  readonly speed: MetresPerSecond;
}

/**
 * Anything a transport may deliver.
 *
 * A discriminated union rather than one wide interface with every field
 * optional. The wide version compiles for a heart-rate strap that sets `power`,
 * and a consumer then has to check for a field that cannot be there.
 */
export type SensorMeasurement =
  HeartRateMeasurement | PowerMeasurement | CadenceMeasurement | SpeedMeasurement;

/**
 * The measurement a given capability produces.
 *
 * This is what makes `subscribe(id, 'power', listener)` hand the listener a
 * `PowerMeasurement` rather than the whole union — so the listener reads
 * `m.power` with no narrowing and no cast, and reading `m.heartRate` is a
 * compile error.
 */
export type MeasurementFor<Capability extends MeasurementCapability> = Extract<
  SensorMeasurement,
  { readonly capability: Capability }
>;

/**
 * Narrow a measurement to one capability.
 *
 * This exists because of a defect found while writing the first implementation
 * of `SensorTransport`, which is exactly where an interface's defects surface.
 * Every transport's `subscribe` filters one stream by capability, and the
 * obvious spelling does not narrow:
 *
 * ```ts
 * subscribe<C extends MeasurementCapability>(id, capability: C, listener: Listener<MeasurementFor<C>>) {
 *   session.onMeasurement((m) => {
 *     if (m.capability === capability) {
 *       listener(m);          // ✗ SensorMeasurement is not MeasurementFor<C>
 *     }
 *   });
 * }
 * ```
 *
 * TypeScript cannot narrow a union by comparing its discriminant to a value of
 * a *generic* type parameter, so each of the five transports in #40–#44 would
 * have reached for `m as MeasurementFor<C>` — five casts, in the one place where
 * a wrong one silently hands a heart-rate measurement to a power listener. One
 * guard, written and tested once, removes all five.
 */
export function isMeasurementOf<Capability extends MeasurementCapability>(
  measurement: SensorMeasurement,
  capability: Capability,
): measurement is MeasurementFor<Capability> {
  return measurement.capability === capability;
}
