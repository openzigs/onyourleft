// SPDX-License-Identifier: Apache-2.0

/**
 * The Heart Rate Service (0x180D) client.
 *
 * ## The two traps in one 2-to-20 octet packet
 *
 * **The 8-bit trap.** Flags bit 0 selects whether the heart rate is a `uint8`
 * or a `uint16`. Assuming `uint8` works for every value up to 255 — which is
 * every heart rate anyone will ever produce, including during development. The
 * bug ships and then misreports for a strap that simply chooses the 16-bit
 * encoding regardless of value, which some do, and it misreports *the field
 * after it* too, because the width also shifts the offset of everything
 * following.
 *
 * **Sensor contact is a tri-state and needs both bits.** GSS v9 §3.113: bit 1
 * is *Sensor Contact detected*, bit 2 is *Sensor Contact supported*. **Bit 1
 * alone is meaningless when bit 2 is clear** — a strap with no contact
 * detection at all leaves both clear, and a client that reads bit 1 as a
 * boolean reports it as having lost contact for the whole ride. Revision 2 of
 * #1 corrected #41's own acceptance criterion for exactly this.
 *
 * ## What reaches a subscriber, and what does not
 *
 * A reading whose contact status is `not-detected` reports **no heart rate at
 * all**. That is #41's third criterion: a strap that has come off the chest
 * transmits a heart rate of zero, and `beatsPerMinute(0)` is a perfectly valid
 * quantity, so the honest output is the absence of a reading rather than a
 * recorded resting heart rate of zero beats per minute in the middle of an
 * interval session.
 *
 * RR intervals and energy expended are decoded and returned by
 * {@link decodeHeartRateMeasurement}, and go no further: neither is a
 * `MeasurementCapability`, so there is nothing on the `SensorTransport`
 * boundary to carry them. They are decoded anyway because they are the raw
 * material for HRV and cannot be recovered later — #41 is explicit about that —
 * and because the RR array's length is what proves the flags walk consumed the
 * right number of octets.
 */

import { beatsPerMinute, seconds, type BeatsPerMinute, type Seconds } from '@onyourleft/domain';

import { createPayloadReader, flagSet, malformedPayload } from './payload';
import type { GattProfile, MeasurementSink } from './profile';
import type { GattUuid } from './uuid';

/**
 * Heart Rate Service.
 *
 * 16-bit assigned number **0x180D**, read on 2026-09-04 from the Bluetooth SIG's
 * own machine-readable assigned numbers
 * (`bluetooth-SIG/public` → `assigned_numbers/uuids/service_uuids.yaml`).
 * `web-bluetooth/src/protocol-registry.test.ts` asserts this literal equals
 * `canonicalUuid(0x180d)`, so the transcription is checked rather than trusted.
 */
export const HEART_RATE_SERVICE: GattUuid = '0000180d-0000-1000-8000-00805f9b34fb';

/** Heart Rate Measurement. 16-bit assigned number **0x2A37**, same source. */
export const HEART_RATE_MEASUREMENT: GattUuid = '00002a37-0000-1000-8000-00805f9b34fb';

/** Body Sensor Location. 16-bit assigned number **0x2A38**, same source. */
export const BODY_SENSOR_LOCATION: GattUuid = '00002a38-0000-1000-8000-00805f9b34fb';

/** The tick rate of an RR interval: 1/1024 s, per GSS v9 §3.113. */
const RR_TICKS_PER_SECOND = 1024;

/**
 * Whether the strap can tell it is against skin, and whether it currently is.
 *
 * Three states rather than a boolean, because the two flag bits encode three
 * meanings and collapsing them loses the one that matters. `unsupported` is the
 * common case: most straps do not implement contact detection.
 */
export type SensorContact = 'unsupported' | 'not-detected' | 'detected';

/** One Heart Rate Measurement notification, decoded. */
export interface HeartRateReading {
  readonly heartRate: BeatsPerMinute;
  readonly sensorContact: SensorContact;
  /**
   * Cumulative energy expended since the strap was reset.
   *
   * Raw, and named for its unit, because `@onyourleft/domain` has no energy
   * brand yet — `measurement.ts` records that gap. GSS v9 gives the field as a
   * `uint16`; revision 2 of #1 records the unit as joules, and the published
   * GATT XML says kilojoule, so the number is passed through unscaled and the
   * disagreement is left visible rather than resolved by guessing.
   */
  readonly energyExpended: number | undefined;
  /**
   * RR intervals, oldest first, one per beat since the last notification.
   *
   * Several per notification is normal at a 1 Hz notification rate and a heart
   * rate above 60. The count is inferred from the remaining payload length,
   * which is the only thing the characteristic offers — so an odd number of
   * trailing octets is a malformed packet rather than a rounding-down.
   */
  readonly rrIntervals: readonly Seconds[];
}

/**
 * Decode one Heart Rate Measurement notification.
 *
 * @throws {SensorError} with code `malformed-payload` for a packet that is
 * shorter than its own flags claim, or that ends mid-RR-interval.
 */
export function decodeHeartRateMeasurement(value: DataView): HeartRateReading {
  const reader = createPayloadReader(value, 'a Heart Rate Measurement');
  const flags = reader.u8('flags field');

  const wide = flagSet(flags, 0);
  const heartRate = beatsPerMinute(
    wide ? reader.u16('16-bit heart rate') : reader.u8('8-bit heart rate'),
  );

  // Bit 2 first. Bit 1 says nothing at all unless bit 2 says the strap can
  // answer the question, and reading them the other way round is the defect
  // revision 2 of #1 exists to prevent.
  const sensorContact: SensorContact = !flagSet(flags, 2)
    ? 'unsupported'
    : flagSet(flags, 1)
      ? 'detected'
      : 'not-detected';

  const energyExpended = flagSet(flags, 3) ? reader.u16('energy expended') : undefined;

  const rrIntervals: Seconds[] = [];
  if (flagSet(flags, 4)) {
    if (reader.remaining() === 0 || reader.remaining() % 2 !== 0) {
      throw malformedPayload(
        `a Heart Rate Measurement sets the RR-interval flag but leaves ${String(
          reader.remaining(),
        )} octets, which is not a whole number of uint16 intervals`,
      );
    }
    while (reader.remaining() > 0) {
      rrIntervals.push(seconds(reader.u16('RR interval') / RR_TICKS_PER_SECOND));
    }
  }

  return { heartRate, sensorContact, energyExpended, rrIntervals };
}

/**
 * The Heart Rate profile, ready to register with a transport.
 *
 * Stateless, and therefore a constant rather than a factory: nothing in this
 * characteristic is differenced against a previous notification, so there is no
 * per-link state to keep and one object serves every strap on every transport.
 * The CSC and Cycling Power profiles are factories for exactly the reason this
 * one is not.
 */
export const heartRateProfile: GattProfile = {
  service: HEART_RATE_SERVICE,
  characteristic: HEART_RATE_MEASUREMENT,
  capabilities: ['heart-rate'],
  decode(value: DataView, sink: MeasurementSink): void {
    const reading = decodeHeartRateMeasurement(value);
    if (reading.sensorContact === 'not-detected') {
      // The strap can tell, and it is not on. Reporting its zero would put a
      // resting heart rate of nought into the middle of a ride.
      return;
    }
    sink['heart-rate'](reading.heartRate);
  },
};
