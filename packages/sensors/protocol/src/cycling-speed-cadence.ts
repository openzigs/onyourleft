// SPDX-License-Identifier: Apache-2.0

/**
 * The Cycling Speed and Cadence Service (0x1816) client.
 *
 * ## This service reports neither a speed nor a cadence
 *
 * It reports **cumulative revolution counts and the event time of the last
 * revolution**, and both derived quantities are the client's arithmetic:
 *
 * ```
 * cadence = Δcrank_revolutions / Δcrank_event_time × 60
 * speed   = Δwheel_revolutions × wheel_circumference / Δwheel_event_time
 * ```
 *
 * ## Which of the counters actually wrap, and how often
 *
 * Revision 2 of #1 re-weighted this, and the weighting is what a test matrix
 * should follow:
 *
 * | Field | Width | Wraps |
 * |---|---|---|
 * | Last event time (both) | `uint16` at 1/1024 s | **every ~64 s** — constantly, on every ride |
 * | Cumulative crank revolutions | `uint16` | after 65 536 revolutions, ≈ 12 h at 90 rpm |
 * | Cumulative wheel revolutions | `uint32` | effectively never |
 *
 * The 64-second one is the case that happens to every rider within the first
 * minute. All three go through `deriveRevolutionInterval`, which takes the
 * modulus as a parameter, so none of them is handled by a second routine.
 *
 * ## Wheel circumference has no default
 *
 * #41: *"a default that assumes 700×25c silently misreports speed and distance
 * for anyone else"*. It is a rider setting rather than a device property, so
 * {@link createCyclingSpeedCadenceProfile} takes it and there is nothing to
 * omit.
 */

import type { Metres, UnixSeconds } from '@onyourleft/domain';
import { EVENT_TICKS_PER_SECOND_1024, UINT16_MODULUS, UINT32_MODULUS } from '@onyourleft/domain';

import {
  deriveCadence,
  deriveSpeed,
  type CounterShape,
  type RevolutionReading,
  type TimedReading,
} from '../../src/revolutions';

import { createDerivationStore } from './derivation';
import { createPayloadReader, flagSet } from './payload';
import type { GattProfile, MeasurementSink } from './profile';
import type { GattUuid } from './uuid';

/**
 * Cycling Speed and Cadence Service.
 *
 * 16-bit assigned number **0x1816**, read on 2026-09-04 from the Bluetooth SIG's
 * own machine-readable assigned numbers
 * (`bluetooth-SIG/public` → `assigned_numbers/uuids/service_uuids.yaml`).
 */
export const CYCLING_SPEED_CADENCE_SERVICE: GattUuid = '00001816-0000-1000-8000-00805f9b34fb';

/** CSC Measurement. 16-bit assigned number **0x2A5B**, same source. */
export const CSC_MEASUREMENT: GattUuid = '00002a5b-0000-1000-8000-00805f9b34fb';

/** CSC Feature. 16-bit assigned number **0x2A5C**, same source. */
export const CSC_FEATURE: GattUuid = '00002a5c-0000-1000-8000-00805f9b34fb';

/**
 * Wheel Revolution Data: `uint32` revolutions, `uint16` event time at 1/1024 s.
 *
 * ⚠️ The tick rate is 1024 **here** and 2048 for the Cycling Power wheel. Same
 * field name, different service, different resolution — see `cycling-power.ts`.
 */
export const CSC_WHEEL_COUNTER: CounterShape = {
  revolutionModulus: UINT32_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
};

/** Crank Revolution Data: `uint16` revolutions, `uint16` event time at 1/1024 s. */
export const CSC_CRANK_COUNTER: CounterShape = {
  revolutionModulus: UINT16_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
};

/** One CSC Measurement notification, decoded. Either half may be absent. */
export interface CscReading {
  readonly wheel: RevolutionReading | undefined;
  readonly crank: RevolutionReading | undefined;
}

/**
 * Decode one CSC Measurement notification.
 *
 * Flags is a single octet: bit 0 Wheel Revolution Data Present, bit 1 Crank
 * Revolution Data Present, bits 2–7 reserved. Wheel data comes first when both
 * are present, which is why the reader walks rather than indexes — a
 * crank-only sensor and a combined sensor put the crank counter at different
 * offsets.
 *
 * @throws {SensorError} with code `malformed-payload` for a packet shorter than
 * its flags claim.
 */
export function decodeCscMeasurement(value: DataView): CscReading {
  const reader = createPayloadReader(value, 'a CSC Measurement');
  const flags = reader.u8('flags field');

  const wheel = flagSet(flags, 0)
    ? {
        revolutions: reader.u32('cumulative wheel revolutions'),
        lastEventTimeTicks: reader.u16('last wheel event time'),
      }
    : undefined;

  const crank = flagSet(flags, 1)
    ? {
        revolutions: reader.u16('cumulative crank revolutions'),
        lastEventTimeTicks: reader.u16('last crank event time'),
      }
    : undefined;

  return { wheel, crank };
}

/** The CSC Feature characteristic: what the sensor can report at all. */
export interface CscFeatures {
  readonly wheelRevolutionData: boolean;
  readonly crankRevolutionData: boolean;
  readonly multipleSensorLocations: boolean;
}

/**
 * Decode the CSC Feature characteristic (`uint16`).
 *
 * Read once, on connect. It is what a pairing UI should describe a sensor from
 * — a combined speed-and-cadence unit that happens to send a crank-only
 * notification while the wheel is still is not a cadence-only sensor, and
 * inferring capabilities from whichever flags the first notification set says
 * it is.
 */
export function decodeCscFeature(value: DataView): CscFeatures {
  const reader = createPayloadReader(value, 'a CSC Feature');
  const flags = reader.u16('feature flags');
  return {
    wheelRevolutionData: flagSet(flags, 0),
    crankRevolutionData: flagSet(flags, 1),
    multipleSensorLocations: flagSet(flags, 2),
  };
}

/** What a CSC link remembers between notifications. */
interface CscState {
  wheel: TimedReading | undefined;
  crank: TimedReading | undefined;
}

/**
 * The Cycling Speed and Cadence profile, ready to register with a transport.
 *
 * A factory rather than a constant because the derivation is stateful, and
 * because the wheel circumference is a rider setting the profile has to be
 * told. The per-link accumulator is keyed on the sink — `derivation.ts` says
 * why that is the only key the seam offers, and why it is the right one.
 *
 * @param options.wheelCircumference the rolling circumference of the wheel the
 * sensor is on. Required: see the header.
 */
export function createCyclingSpeedCadenceProfile(options: {
  readonly wheelCircumference: Metres;
}): GattProfile {
  const states = createDerivationStore<CscState>(() => ({ wheel: undefined, crank: undefined }));

  return {
    service: CYCLING_SPEED_CADENCE_SERVICE,
    characteristic: CSC_MEASUREMENT,
    capabilities: ['speed', 'cadence'],
    decode(value: DataView, sink: MeasurementSink, at: UnixSeconds): void {
      // Decoded in full before anything is derived or reported, so a packet
      // that is malformed in its second half reports nothing from its first.
      // Half a frame is worse than none: it would put a speed on the ride
      // screen from a notification this program could not read.
      const reading = decodeCscMeasurement(value);
      const state = states.for(sink);

      if (reading.wheel !== undefined) {
        const derived = deriveSpeed(
          state.wheel,
          { reading: reading.wheel, at },
          {
            ...CSC_WHEEL_COUNTER,
            wheelCircumference: options.wheelCircumference,
          },
        );
        state.wheel = derived.next;
        if (derived.speed !== undefined) {
          sink.speed(derived.speed);
        }
      }

      if (reading.crank !== undefined) {
        const derived = deriveCadence(
          state.crank,
          { reading: reading.crank, at },
          CSC_CRANK_COUNTER,
        );
        state.crank = derived.next;
        if (derived.cadence !== undefined) {
          sink.cadence(derived.cadence);
        }
      }
    },
  };
}
