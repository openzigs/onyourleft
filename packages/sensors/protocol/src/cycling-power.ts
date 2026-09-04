// SPDX-License-Identifier: Apache-2.0

/**
 * The Cycling Power Service (0x1818) client.
 *
 * Power meter pedals, crank and hub meters, and the power output of a smart
 * trainer. #42: *"Power is the most important number in this product."*
 *
 * ## The variable-length trap, and the reason a flag loop is not the fix
 *
 * Cycling Power Measurement is flags-driven and variable length. Only
 * Instantaneous Power is mandatory; every other field is present only if its
 * flag bit is set, and each present field shifts the offset of every field
 * after it. Parsing at fixed offsets works perfectly against the author's own
 * power meter and produces confidently wrong numbers for anyone whose device
 * sets a different combination.
 *
 * The obvious fix — loop over the set bits, advance an offset per bit — is
 * **worse**, and this is the correction revision 2 of #1 made to this issue:
 *
 * > **Flag bits 1, 3 and 12 are NOT presence bits.** Bit 1 is the *Pedal Power
 * > Balance Reference* (0 = unknown, 1 = left). Bit 3 is the *Accumulated
 * > Torque Source* (0 = wheel, 1 = crank). Bit 12 is the *Offset Compensation
 * > Indicator*.
 *
 * A parser that advanced an offset for every set bit would corrupt every
 * measurement from a device that sets bit 1 or bit 3 — which is most dual-sided
 * power meters, since they know which leg their balance figure refers to. So
 * the walk below is written out field by field in specification order, and the
 * three interpretation bits are read as values rather than skipped as lengths.
 * `cycling-power.test.ts` drives combinations that set bits 1 and 3 with no
 * extra field, which a bit-loop cannot survive.
 *
 * ## Two event-time resolutions, one field apart
 *
 * The **wheel** event time is 1/2048 s. The **crank** event time is 1/1024 s.
 * In CSC both are 1/1024 s, so the same field name means different things in
 * 0x1818 and 0x1816. Every helper takes the rate as a parameter for that
 * reason; hard-coding 1024 for the wheel halves the reported speed.
 *
 * ## Left-only meters
 *
 * A left-only meter commonly reports doubled total power and its own pedal
 * power balance of 50 %. This client **passes the device's figure through
 * unscaled** and surfaces the balance and its reference alongside it. Guessing
 * would silently halve the power of a rider whose meter does *not* double, and
 * there is no field that distinguishes the two. Whether to expose a scaling
 * option is #42's recorded product decision and belongs to the pairing UI
 * (#49), not to a decoder.
 */

import type { Metres, UnixSeconds, Watts } from '@onyourleft/domain';
import {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  UINT16_MODULUS,
  UINT32_MODULUS,
  unsignedCounterDelta,
  watts,
} from '@onyourleft/domain';

import type { MeasurementCapability } from '../../src/capability';
import {
  deriveCadence,
  deriveSpeed,
  type CounterShape,
  type RevolutionReading,
  type TimedReading,
} from '../../src/revolutions';

import { createDerivationStore } from './derivation';
import { createPayloadReader, flagSet, malformedPayload } from './payload';
import type { GattProfile, MeasurementSink } from './profile';
import type { GattUuid } from './uuid';

/**
 * Cycling Power Service.
 *
 * 16-bit assigned number **0x1818**, read on 2026-09-04 from the Bluetooth SIG's
 * own machine-readable assigned numbers
 * (`bluetooth-SIG/public` → `assigned_numbers/uuids/service_uuids.yaml`).
 */
export const CYCLING_POWER_SERVICE: GattUuid = '00001818-0000-1000-8000-00805f9b34fb';

/** Cycling Power Measurement. 16-bit assigned number **0x2A63**, same source. */
export const CYCLING_POWER_MEASUREMENT: GattUuid = '00002a63-0000-1000-8000-00805f9b34fb';

/** Cycling Power Feature. 16-bit assigned number **0x2A65**, same source. */
export const CYCLING_POWER_FEATURE: GattUuid = '00002a65-0000-1000-8000-00805f9b34fb';

/** Sensor Location. 16-bit assigned number **0x2A5D**, same source. */
export const CYCLING_POWER_SENSOR_LOCATION: GattUuid = '00002a5d-0000-1000-8000-00805f9b34fb';

/** Wheel Revolution Data: `uint32` revolutions, `uint16` event time at **1/2048 s**. */
export const CYCLING_POWER_WHEEL_COUNTER: CounterShape = {
  revolutionModulus: UINT32_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_2048,
};

/** Crank Revolution Data: `uint16` revolutions, `uint16` event time at **1/1024 s**. */
export const CYCLING_POWER_CRANK_COUNTER: CounterShape = {
  revolutionModulus: UINT16_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
};

/** Accumulated Torque is transmitted in 1/32 N·m. */
const TORQUE_UNITS_PER_NEWTON_METRE = 32;

/** Pedal Power Balance is transmitted in half-percent units. */
const BALANCE_UNITS_PER_PERCENT = 2;

/**
 * The ceiling above which an instantaneous power reading is treated as a decode
 * fault rather than as data.
 *
 * **A decode-fault detector, not a physiology check.** The field is a `sint16`,
 * so a mis-walked offset yields values in the tens of thousands of watts;
 * the highest power a human has been measured producing is around 2 500 W, for
 * about a second, by a track sprinter. 3 000 W sits above anything a rider can
 * do and two orders of magnitude below what a wrong offset produces, so a real
 * reading is never discarded and a wrong one never reaches a ride file.
 */
export const MAX_PLAUSIBLE_POWER_WATTS = 3000;

/** Which leg a pedal power balance figure is measured against. */
export type PedalPowerBalanceReference = 'unknown' | 'left';

/** Where an accumulated torque figure was measured. */
export type AccumulatedTorqueSource = 'wheel' | 'crank';

/** The two extreme magnitudes a meter reports over one revolution. */
export interface ExtremeMagnitudes {
  readonly maximum: number;
  readonly minimum: number;
}

/** One Cycling Power Measurement notification, decoded. */
export interface CyclingPowerReading {
  /** Mandatory. Validated: see {@link MAX_PLAUSIBLE_POWER_WATTS}. */
  readonly instantaneousPower: Watts;
  /** Flag bit 0, in whole percent. Flag bit 1 says which leg it refers to. */
  readonly pedalPowerBalancePercent: number | undefined;
  /** Flag bit 1. Meaningful whether or not bit 0 set a balance. */
  readonly pedalPowerBalanceReference: PedalPowerBalanceReference;
  /** Flag bit 2, in newton metres. Cumulative and wrapping — a `uint16` of 1/32 N·m. */
  readonly accumulatedTorqueNewtonMetres: number | undefined;
  /** Flag bit 2's raw `uint16`, kept because the wrap is on the raw counter. */
  readonly accumulatedTorqueRaw: number | undefined;
  /** Flag bit 3. */
  readonly accumulatedTorqueSource: AccumulatedTorqueSource;
  /** Flag bit 4. `uint32` revolutions, `uint16` event time at 1/2048 s. */
  readonly wheel: RevolutionReading | undefined;
  /** Flag bit 5. `uint16` revolutions, `uint16` event time at 1/1024 s. */
  readonly crank: RevolutionReading | undefined;
  /** Flag bit 6, in newtons. */
  readonly extremeForceNewtons: ExtremeMagnitudes | undefined;
  /** Flag bit 7, in newton metres. */
  readonly extremeTorqueNewtonMetres: ExtremeMagnitudes | undefined;
  /** Flag bit 8, in degrees. Two `uint12`s packed into three octets. */
  readonly extremeAnglesDegrees: ExtremeMagnitudes | undefined;
  /** Flag bit 9, in degrees. */
  readonly topDeadSpotAngleDegrees: number | undefined;
  /** Flag bit 10, in degrees. */
  readonly bottomDeadSpotAngleDegrees: number | undefined;
  /** Flag bit 11, in kilojoules. Cumulative and wrapping — a `uint16`. */
  readonly accumulatedEnergyKilojoules: number | undefined;
  /** Flag bit 12. Not a presence bit: the meter is reporting an offset compensation. */
  readonly offsetCompensationIndicator: boolean;
}

/**
 * Decode one Cycling Power Measurement notification.
 *
 * The walk is in specification order and every read is bounds-checked, so a
 * flag claiming a field the buffer does not contain is a typed error rather
 * than an out-of-range `DataView` read. That is the obvious attack on a
 * flags-gated packet, and CLAUDE.md §6 requires it be proved with a test rather
 * than asserted in a comment — `cycling-power.test.ts` truncates a payload at
 * every field boundary.
 *
 * @throws {SensorError} with code `malformed-payload` for a short packet, or
 * for an instantaneous power that is negative or above
 * {@link MAX_PLAUSIBLE_POWER_WATTS}.
 */
export function decodeCyclingPowerMeasurement(value: DataView): CyclingPowerReading {
  const reader = createPayloadReader(value, 'a Cycling Power Measurement');
  const flags = reader.u16('flags field');

  const rawPower = reader.i16('instantaneous power');
  if (rawPower < 0 || rawPower > MAX_PLAUSIBLE_POWER_WATTS) {
    // Surfaced as invalid rather than recorded. `watts()` would reject the
    // negative case on its own, but as a `UnitError` from inside the domain
    // package — which a caller cannot tell from a bug in this one, and which
    // says nothing about the far more common fault of a plausible-looking
    // enormous number out of a mis-walked offset.
    throw malformedPayload(
      `a Cycling Power Measurement reports ${String(rawPower)} W, which is outside 0..${String(
        MAX_PLAUSIBLE_POWER_WATTS,
      )} W and is a decode fault rather than a reading`,
    );
  }
  const instantaneousPower = watts(rawPower);

  const pedalPowerBalancePercent = flagSet(flags, 0)
    ? reader.u8('pedal power balance') / BALANCE_UNITS_PER_PERCENT
    : undefined;

  // Bit 1 is an interpretation bit, NOT a presence bit. Nothing is read here.
  const pedalPowerBalanceReference: PedalPowerBalanceReference = flagSet(flags, 1)
    ? 'left'
    : 'unknown';

  const accumulatedTorqueRaw = flagSet(flags, 2) ? reader.u16('accumulated torque') : undefined;

  // Bit 3 is an interpretation bit, NOT a presence bit. Nothing is read here.
  const accumulatedTorqueSource: AccumulatedTorqueSource = flagSet(flags, 3) ? 'crank' : 'wheel';

  const wheel = flagSet(flags, 4)
    ? {
        revolutions: reader.u32('cumulative wheel revolutions'),
        lastEventTimeTicks: reader.u16('last wheel event time'),
      }
    : undefined;

  const crank = flagSet(flags, 5)
    ? {
        revolutions: reader.u16('cumulative crank revolutions'),
        lastEventTimeTicks: reader.u16('last crank event time'),
      }
    : undefined;

  const extremeForceNewtons = flagSet(flags, 6)
    ? {
        maximum: reader.i16('maximum force magnitude'),
        minimum: reader.i16('minimum force magnitude'),
      }
    : undefined;

  const extremeTorqueNewtonMetres = flagSet(flags, 7)
    ? {
        maximum: reader.i16('maximum torque magnitude') / TORQUE_UNITS_PER_NEWTON_METRE,
        minimum: reader.i16('minimum torque magnitude') / TORQUE_UNITS_PER_NEWTON_METRE,
      }
    : undefined;

  // Three octets, not four: two `uint12`s packed, maximum in the low twelve
  // bits. Reading this as two `uint16`s is a one-octet overrun that silently
  // shifts every field after it — which is why it is a `u24` and a mask.
  let extremeAnglesDegrees: ExtremeMagnitudes | undefined;
  if (flagSet(flags, 8)) {
    const packed = reader.u24('extreme angles');
    extremeAnglesDegrees = { maximum: packed & 0xfff, minimum: (packed >>> 12) & 0xfff };
  }

  const topDeadSpotAngleDegrees = flagSet(flags, 9) ? reader.u16('top dead spot angle') : undefined;

  const bottomDeadSpotAngleDegrees = flagSet(flags, 10)
    ? reader.u16('bottom dead spot angle')
    : undefined;

  const accumulatedEnergyKilojoules = flagSet(flags, 11)
    ? reader.u16('accumulated energy')
    : undefined;

  return {
    instantaneousPower,
    pedalPowerBalancePercent,
    pedalPowerBalanceReference,
    accumulatedTorqueNewtonMetres:
      accumulatedTorqueRaw === undefined
        ? undefined
        : accumulatedTorqueRaw / TORQUE_UNITS_PER_NEWTON_METRE,
    accumulatedTorqueRaw,
    accumulatedTorqueSource,
    wheel,
    crank,
    extremeForceNewtons,
    extremeTorqueNewtonMetres,
    extremeAnglesDegrees,
    topDeadSpotAngleDegrees,
    bottomDeadSpotAngleDegrees,
    accumulatedEnergyKilojoules,
    // Bit 12 is an interpretation bit, NOT a presence bit.
    offsetCompensationIndicator: flagSet(flags, 12),
  };
}

/**
 * The Cycling Power Feature characteristic (`uint32`): what the meter can do.
 *
 * Read once, on connect, and it is the answer to #42's sixth criterion.
 * Capabilities inferred from whichever flags the *first notification* happened
 * to set are wrong for a device that reports crank revolutions only while the
 * crank is turning, and for a trainer whose first frame arrives before the
 * rider does. The feature field is a statement about the device; a measurement
 * frame is a statement about this second.
 */
export interface CyclingPowerFeatures {
  readonly pedalPowerBalance: boolean;
  readonly accumulatedTorque: boolean;
  readonly wheelRevolutionData: boolean;
  readonly crankRevolutionData: boolean;
  readonly extremeMagnitudes: boolean;
  readonly extremeAngles: boolean;
  readonly deadSpotAngles: boolean;
  readonly accumulatedEnergy: boolean;
  readonly offsetCompensationIndicator: boolean;
  readonly offsetCompensation: boolean;
  readonly measurementContentMasking: boolean;
  readonly multipleSensorLocations: boolean;
  readonly crankLengthAdjustment: boolean;
  readonly chainLengthAdjustment: boolean;
  readonly chainWeightAdjustment: boolean;
  readonly spanLengthAdjustment: boolean;
}

/** Decode the Cycling Power Feature characteristic. */
export function decodeCyclingPowerFeature(value: DataView): CyclingPowerFeatures {
  const reader = createPayloadReader(value, 'a Cycling Power Feature');
  const flags = reader.u32('feature flags');
  return {
    pedalPowerBalance: flagSet(flags, 0),
    accumulatedTorque: flagSet(flags, 1),
    wheelRevolutionData: flagSet(flags, 2),
    crankRevolutionData: flagSet(flags, 3),
    extremeMagnitudes: flagSet(flags, 4),
    extremeAngles: flagSet(flags, 5),
    deadSpotAngles: flagSet(flags, 6),
    accumulatedEnergy: flagSet(flags, 7),
    offsetCompensationIndicator: flagSet(flags, 8),
    offsetCompensation: flagSet(flags, 9),
    measurementContentMasking: flagSet(flags, 10),
    multipleSensorLocations: flagSet(flags, 11),
    crankLengthAdjustment: flagSet(flags, 12),
    chainLengthAdjustment: flagSet(flags, 13),
    chainWeightAdjustment: flagSet(flags, 14),
    spanLengthAdjustment: flagSet(flags, 15),
  };
}

/**
 * What a meter's Feature characteristic says it can report, as capabilities.
 *
 * `power` is unconditional: Instantaneous Power is mandatory in every Cycling
 * Power Measurement, so a device that implements the service at all reports it.
 * `speed` needs a wheel circumference as well as wheel revolution data, because
 * revolutions alone are not a speed — `capability.ts` says exactly this.
 */
export function cyclingPowerCapabilities(
  features: CyclingPowerFeatures,
  options?: { readonly wheelCircumference?: Metres | undefined },
): readonly MeasurementCapability[] {
  const capabilities: MeasurementCapability[] = ['power'];
  if (features.crankRevolutionData) {
    capabilities.push('cadence');
  }
  if (features.wheelRevolutionData && options?.wheelCircumference !== undefined) {
    capabilities.push('speed');
  }
  return capabilities;
}

/** What one Cycling Power link remembers between notifications. */
interface CyclingPowerState {
  wheel: TimedReading | undefined;
  crank: TimedReading | undefined;
  torqueRaw: number | undefined;
  energyKilojoules: number | undefined;
}

/**
 * The difference between two notifications for the two accumulating scalars.
 *
 * Both are `uint16` cumulative counters that lap — accumulated torque after
 * 2 048 N·m of raw units and accumulated energy after 65 536 kJ, which a long
 * ride reaches. Neither is a `MeasurementCapability`, so neither crosses the
 * transport boundary; they are differenced here because a consumer that did it
 * itself would be the second implementation of a wrapping subtraction, and
 * because the wrap is the part that is easy to get wrong.
 */
export interface CyclingPowerAccumulation {
  /** Newton metres accumulated since the previous notification. */
  readonly torqueNewtonMetres: number | undefined;
  /** Kilojoules accumulated since the previous notification. */
  readonly energyKilojoules: number | undefined;
}

/**
 * Difference the two accumulating scalars against the previous notification.
 *
 * Exported so the wrap is testable without a transport. Returns `undefined` for
 * a field the current frame does not carry, and for the first frame that does —
 * a difference needs two readings.
 */
export function accumulate(
  previous: {
    readonly torqueRaw: number | undefined;
    readonly energyKilojoules: number | undefined;
  },
  current: CyclingPowerReading,
): CyclingPowerAccumulation {
  return {
    torqueNewtonMetres:
      previous.torqueRaw === undefined || current.accumulatedTorqueRaw === undefined
        ? undefined
        : unsignedCounterDelta(previous.torqueRaw, current.accumulatedTorqueRaw, UINT16_MODULUS) /
          TORQUE_UNITS_PER_NEWTON_METRE,
    energyKilojoules:
      previous.energyKilojoules === undefined || current.accumulatedEnergyKilojoules === undefined
        ? undefined
        : unsignedCounterDelta(
            previous.energyKilojoules,
            current.accumulatedEnergyKilojoules,
            UINT16_MODULUS,
          ),
  };
}

/**
 * The Cycling Power profile, ready to register with a transport.
 *
 * @param options.wheelCircumference required before this profile will supply
 * `speed`. A hub power meter reports wheel revolutions, and revolutions are not
 * a speed without the athlete's wheel — omitting it declares a profile that
 * supplies power and cadence, so the adapter looks elsewhere for speed rather
 * than assigning it here and then reporting nothing.
 * @param options.onAccumulation called with the torque and energy accumulated
 * since the previous notification, when either is present. Neither is a
 * measurement capability, so there is nothing on the `SensorTransport` boundary
 * to carry them and a caller that wants them asks here.
 */
export function createCyclingPowerProfile(options?: {
  readonly wheelCircumference?: Metres | undefined;
  readonly onAccumulation?: ((accumulation: CyclingPowerAccumulation) => void) | undefined;
}): GattProfile {
  const wheelCircumference = options?.wheelCircumference;
  const states = createDerivationStore<CyclingPowerState>(() => ({
    wheel: undefined,
    crank: undefined,
    torqueRaw: undefined,
    energyKilojoules: undefined,
  }));

  const capabilities: readonly MeasurementCapability[] =
    wheelCircumference === undefined ? ['power', 'cadence'] : ['power', 'cadence', 'speed'];

  return {
    service: CYCLING_POWER_SERVICE,
    characteristic: CYCLING_POWER_MEASUREMENT,
    capabilities,
    decode(value: DataView, sink: MeasurementSink, at: UnixSeconds): void {
      // Decoded in full before anything is reported: a frame whose crank data
      // is truncated must not put its power on the ride screen, because the
      // truncation means the offsets are not what they were read as.
      const reading = decodeCyclingPowerMeasurement(value);
      const state = states.for(sink);

      sink.power(reading.instantaneousPower);

      if (reading.wheel !== undefined && wheelCircumference !== undefined) {
        const derived = deriveSpeed(
          state.wheel,
          { reading: reading.wheel, at },
          {
            ...CYCLING_POWER_WHEEL_COUNTER,
            wheelCircumference,
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
          CYCLING_POWER_CRANK_COUNTER,
        );
        state.crank = derived.next;
        if (derived.cadence !== undefined) {
          sink.cadence(derived.cadence);
        }
      }

      const accumulation = accumulate(state, reading);
      if (reading.accumulatedTorqueRaw !== undefined) {
        state.torqueRaw = reading.accumulatedTorqueRaw;
      }
      if (reading.accumulatedEnergyKilojoules !== undefined) {
        state.energyKilojoules = reading.accumulatedEnergyKilojoules;
      }
      if (
        accumulation.torqueNewtonMetres !== undefined ||
        accumulation.energyKilojoules !== undefined
      ) {
        options?.onAccumulation?.(accumulation);
      }
    },
  };
}
