// SPDX-License-Identifier: Apache-2.0

/**
 * The Fitness Machine Service (0x1826) reads: Indoor Bike Data, the Feature
 * characteristic, and the two supported-range characteristics an ERG or
 * resistance setpoint has to be checked against.
 *
 * The **control point** is next door in `fitness-machine-control.ts`, because
 * it is not a decoder: it is a request/response protocol with state, and
 * CLAUDE.md §6 calls trainer control a safety problem rather than only a
 * security one. Keeping the two apart means the half that only reads bytes can
 * be reviewed as a decoder, and the half that applies physical resistance to a
 * person who is pedalling is not buried inside it.
 *
 * ## Every UUID was read from the assigned numbers, and the issue body was wrong
 *
 * #43's body named `0x2AD3` for Indoor Bike Data. **`0x2AD3` is Training
 * Status; Indoor Bike Data is `0x2AD2`.** The issue's own revision block
 * corrects it, and the correction was checked again here on **2026-09-04**
 * against the Bluetooth SIG's assigned characteristic numbers — every constant
 * below matched. A client that subscribed to `0x2AD3` would pair, report
 * connected, and deliver nothing, which is the hardest failure in this stack to
 * diagnose; `web-bluetooth/src/protocol-registry.test.ts` asserts each literal
 * equals `canonicalUuid` of its 16-bit number so the transcription is checked
 * rather than trusted.
 *
 * ## The three traps in Indoor Bike Data, and why a bit loop cannot survive them
 *
 * 1. **Flag bit 0 is inverted.** It is *More Data*, and Instantaneous Speed is
 *    present when the bit is **clear** (FTMS 1.0 §4.9.1.2). Every other bit is
 *    normal polarity, so the generic "for each set bit, consume a field" loop
 *    reads a speed that is not there on the first packet and misaligns every
 *    field after it.
 * 2. **Bit 8 gates three fields, five octets.** Total Energy `uint16`, Energy
 *    per Hour `uint16`, Energy per Minute `uint8` — one bit, three reads.
 * 3. **Total Distance is a `uint24`.** There is no `DataView.getUint24`, so it
 *    is assembled little-endian by hand; `payload.ts` does that once.
 *
 * So the walk below is written out field by field in specification order, the
 * same posture `cycling-power.ts` took for the three interpretation bits that
 * are not presence bits.
 *
 * ## The disagreement about bit 2, recorded rather than resolved
 *
 * FTMS 1.0 Table 4.10 describes bit 2 (Instantaneous Cadence) with **inverted**
 * polarity — the same wording as the More Data row directly above it — while
 * GSS v9 §3.124 says the field is present when the bit is set to 1. They cannot
 * both be right, and the field is two octets, so choosing wrongly shifts every
 * field after it.
 *
 * **This client implements GSS v9**, for three reasons: GSS v9 (2023) is six
 * years newer and is the delegated authority for the field layout; the
 * equivalent Cross Trainer table shows only bit 0 inverted; and the duplicated
 * wording reads as a copy-paste erratum. The SIG states Errata Correction 23224
 * is mandatory for FTMS 1.0 compliance and it was not obtained — it is the
 * likely resolution. Both readings are pinned by tests in
 * `fitness-machine.test.ts` so that a correction changes a test rather than
 * surprising a rider.
 *
 * ## Sensor data is untrusted input, and this device is also an actuator
 *
 * Every read is bounds-checked and every failure is a
 * `SensorError('malformed-payload')`. The supported-range characteristics get
 * more than that: they are read **from the device** and then used to bound a
 * setpoint written **back to it**, so a hostile or broken device that advertises
 * a 30 000 W ceiling would otherwise be trusted to define its own safety limit.
 * {@link MAX_PLAUSIBLE_TARGET_POWER_WATTS} is the client's own ceiling and the
 * range decoder refuses anything above it, which is the guard that has to hold
 * before `fitness-machine-control.ts` clamps to the advertised range at all.
 */

import {
  beatsPerMinute,
  hundredthsKilometresPerHourToMetresPerSecond,
  metres,
  resistanceLevel,
  revolutionsPerMinute,
  seconds,
  watts,
  type BeatsPerMinute,
  type Metres,
  type MetresPerSecond,
  type ResistanceLevel,
  type RevolutionsPerMinute,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

import type { MeasurementCapability } from '../../src/capability';
import {
  MAX_PLAUSIBLE_CADENCE_RPM,
  MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND,
} from '../../src/revolutions';

import { MAX_PLAUSIBLE_POWER_WATTS } from './cycling-power';
import { createPayloadReader, flagSet, malformedPayload, type PayloadReader } from './payload';
import type { GattProfile, MeasurementSink } from './profile';
import type { GattUuid } from './uuid';

// --- The service and its characteristics ------------------------------------

/**
 * Fitness Machine Service.
 *
 * 16-bit assigned number **0x1826**, read on 2026-09-04 from the Bluetooth SIG
 * assigned service numbers.
 */
export const FITNESS_MACHINE_SERVICE: GattUuid = '00001826-0000-1000-8000-00805f9b34fb';

/**
 * Indoor Bike Data. 16-bit assigned number **0x2AD2**, same source.
 *
 * ⚠️ Not `0x2AD3`, which is Training Status. See the header.
 */
export const INDOOR_BIKE_DATA: GattUuid = '00002ad2-0000-1000-8000-00805f9b34fb';

/** Fitness Machine Feature. 16-bit assigned number **0x2ACC**, same source. */
export const FITNESS_MACHINE_FEATURE: GattUuid = '00002acc-0000-1000-8000-00805f9b34fb';

/** Fitness Machine Control Point. 16-bit assigned number **0x2AD9**, same source. */
export const FITNESS_MACHINE_CONTROL_POINT: GattUuid = '00002ad9-0000-1000-8000-00805f9b34fb';

/** Fitness Machine Status. 16-bit assigned number **0x2ADA**, same source. */
export const FITNESS_MACHINE_STATUS: GattUuid = '00002ada-0000-1000-8000-00805f9b34fb';

/** Supported Resistance Level Range. 16-bit assigned number **0x2AD6**, same source. */
export const SUPPORTED_RESISTANCE_LEVEL_RANGE: GattUuid = '00002ad6-0000-1000-8000-00805f9b34fb';

/** Supported Power Range. 16-bit assigned number **0x2AD8**, same source. */
export const SUPPORTED_POWER_RANGE: GattUuid = '00002ad8-0000-1000-8000-00805f9b34fb';

// --- Scalings and ceilings --------------------------------------------------

/** Instantaneous and Average Cadence are transmitted in half-rpm. */
const CADENCE_UNITS_PER_RPM = 2;

/** Metabolic Equivalent is transmitted at a resolution of 0.1. */
const METABOLIC_EQUIVALENT_UNITS_PER_UNIT = 10;

/** Resistance level is transmitted at a resolution of 0.1 in the range characteristic. */
const RESISTANCE_UNITS_PER_LEVEL = 10;

/** `0xFFFF` in a `uint16` energy field means "Data Not Available" (FTMS §4.9.1.10). */
const UINT16_NOT_AVAILABLE = 0xffff;

/** `0xFF` in the `uint8` energy field means the same (FTMS §4.9.1.12). */
const UINT8_NOT_AVAILABLE = 0xff;

/**
 * The ceiling on a power **setpoint** this client will write to a trainer, and
 * on the maximum a trainer is allowed to advertise for itself.
 *
 * **A safety bound, not a plausibility one**, which is why it is far below
 * {@link MAX_PLAUSIBLE_POWER_WATTS} — that constant bounds a *reading*, and
 * discarding a reading costs a sample. This one bounds a value written to a
 * machine that applies physical resistance to a person who is pedalling, and
 * the failure it prevents is a rider thrown against a brake they did not ask
 * for. 2 000 W is above the maximum any trainer on the market can absorb and
 * roughly the maximum a track sprinter produces, so no legitimate workout
 * reaches it.
 *
 * It bounds the **device's advertised range too**, and that is the point. The
 * Supported Power Range characteristic is read *from the device* and then used
 * to validate what is written *back to it*; a device that may not be what it
 * claims (SECURITY.md) must not get to define its own ceiling.
 */
export const MAX_PLAUSIBLE_TARGET_POWER_WATTS = 2000;

// --- Indoor Bike Data (0x2AD2) ----------------------------------------------

/**
 * The bit index of each Indoor Bike Data flag, named rather than numbered.
 *
 * ⚠️ `moreData` is bit 0 and it is **inverted**: Instantaneous Speed is present
 * when it is clear. It is named `moreData` rather than `instantaneousSpeed`
 * precisely so that a reader who assumes presence-when-set has to stop and read
 * the name.
 */
export const INDOOR_BIKE_DATA_FLAG = {
  /** ⚠️ Inverted. Speed is present when this is CLEAR. */
  moreData: 0,
  averageSpeed: 1,
  instantaneousCadence: 2,
  averageCadence: 3,
  totalDistance: 4,
  resistanceLevel: 5,
  instantaneousPower: 6,
  averagePower: 7,
  /** Gates three fields and five octets. */
  expendedEnergy: 8,
  heartRate: 9,
  metabolicEquivalent: 10,
  elapsedTime: 11,
  remainingTime: 12,
} as const;

/** One Indoor Bike Data notification, decoded. */
export interface IndoorBikeDataReading {
  /**
   * Present when flag bit 0 is **clear**. `undefined` also when the value was
   * implausible — see {@link MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND}.
   */
  readonly instantaneousSpeed: MetresPerSecond | undefined;
  /** Flag bit 1. Since the start of the training session. */
  readonly averageSpeed: MetresPerSecond | undefined;
  /** Flag bit 2, transmitted in half-rpm. */
  readonly instantaneousCadence: RevolutionsPerMinute | undefined;
  /** Flag bit 3, transmitted in half-rpm. */
  readonly averageCadence: RevolutionsPerMinute | undefined;
  /** Flag bit 4. A `uint24` of metres, cumulative for the session. */
  readonly totalDistance: Metres | undefined;
  /**
   * Flag bit 5. The machine's **current** brake level.
   *
   * A raw `sint16` and unitless, deliberately not a `ResistanceLevel`: the
   * reported field is signed while the settable one is a non-negative `uint8`
   * (FTMS Table 4.15), so they are not the same quantity and a shared brand
   * would let a reported -12 be written back as a setpoint.
   */
  readonly resistanceLevel: number | undefined;
  /** Flag bit 6. */
  readonly instantaneousPower: Watts | undefined;
  /** Flag bit 7. */
  readonly averagePower: Watts | undefined;
  /** Flag bit 8, first of three. `undefined` when the machine sent `0xFFFF`. */
  readonly totalEnergyKilocalories: number | undefined;
  /** Flag bit 8, second of three. */
  readonly energyPerHourKilocalories: number | undefined;
  /** Flag bit 8, third of three. `undefined` when the machine sent `0xFF`. */
  readonly energyPerMinuteKilocalories: number | undefined;
  /**
   * Flag bit 9. Whatever strap the *machine* paired with, not one the athlete
   * chose — which is why it is not fanned out as a capability. See
   * {@link createIndoorBikeDataProfile}.
   */
  readonly heartRate: BeatsPerMinute | undefined;
  /** Flag bit 10, at a resolution of 0.1. */
  readonly metabolicEquivalent: number | undefined;
  /** Flag bit 11. */
  readonly elapsedTimeSeconds: Seconds | undefined;
  /** Flag bit 12. */
  readonly remainingTimeSeconds: Seconds | undefined;
  /**
   * Octets the walk did not consume.
   *
   * Surfaced rather than raised. A Server that adds a field this client does
   * not know about must not take a ride down, and a non-zero count here is the
   * signal a bug report needs — but it is also what a wrong bit-2 polarity
   * looks like, so it is worth seeing.
   */
  readonly trailingOctets: number;
}

/** Read a `uint16` power field, refusing what a mis-walked offset produces. */
function readPower(reader: PayloadReader, field: string): Watts {
  const raw = reader.i16(field);
  if (raw < 0 || raw > MAX_PLAUSIBLE_POWER_WATTS) {
    throw malformedPayload(
      `an Indoor Bike Data ${field} reports ${String(raw)} W, which is outside 0..${String(
        MAX_PLAUSIBLE_POWER_WATTS,
      )} W and is a decode fault rather than a reading`,
    );
  }
  return watts(raw);
}

/** Read a half-rpm cadence field, dropping an implausible figure rather than recording it. */
function readCadence(reader: PayloadReader, field: string): RevolutionsPerMinute | undefined {
  const rpm = reader.u16(field) / CADENCE_UNITS_PER_RPM;
  return rpm > MAX_PLAUSIBLE_CADENCE_RPM ? undefined : revolutionsPerMinute(rpm);
}

/** Read a 0.01 km/h speed field through `@onyourleft/domain`, never a local divide. */
function readSpeed(reader: PayloadReader, field: string): MetresPerSecond | undefined {
  const speed = hundredthsKilometresPerHourToMetresPerSecond(reader.u16(field));
  return speed > MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND ? undefined : speed;
}

/**
 * Decode one Indoor Bike Data notification.
 *
 * @throws {SensorError} with code `malformed-payload` for a short packet, or
 * for a power field that is negative or above {@link MAX_PLAUSIBLE_POWER_WATTS}.
 */
export function decodeIndoorBikeData(value: DataView): IndoorBikeDataReading {
  const reader = createPayloadReader(value, 'an Indoor Bike Data notification');
  const flags = reader.u16('flags field');

  // ⚠️ Inverted. `!flagSet` is the whole of the More Data trap.
  const instantaneousSpeed = flagSet(flags, INDOOR_BIKE_DATA_FLAG.moreData)
    ? undefined
    : readSpeed(reader, 'instantaneous speed');

  const averageSpeed = flagSet(flags, INDOOR_BIKE_DATA_FLAG.averageSpeed)
    ? readSpeed(reader, 'average speed')
    : undefined;

  const instantaneousCadence = flagSet(flags, INDOOR_BIKE_DATA_FLAG.instantaneousCadence)
    ? readCadence(reader, 'instantaneous cadence')
    : undefined;

  const averageCadence = flagSet(flags, INDOOR_BIKE_DATA_FLAG.averageCadence)
    ? readCadence(reader, 'average cadence')
    : undefined;

  const totalDistance = flagSet(flags, INDOOR_BIKE_DATA_FLAG.totalDistance)
    ? metres(reader.u24('total distance'))
    : undefined;

  const resistance = flagSet(flags, INDOOR_BIKE_DATA_FLAG.resistanceLevel)
    ? reader.i16('resistance level')
    : undefined;

  const instantaneousPower = flagSet(flags, INDOOR_BIKE_DATA_FLAG.instantaneousPower)
    ? readPower(reader, 'instantaneous power')
    : undefined;

  const averagePower = flagSet(flags, INDOOR_BIKE_DATA_FLAG.averagePower)
    ? readPower(reader, 'average power')
    : undefined;

  // One bit, three fields, five octets. Reading one here shifts the heart rate
  // into the middle of the energy triple.
  let totalEnergy: number | undefined;
  let energyPerHour: number | undefined;
  let energyPerMinute: number | undefined;
  if (flagSet(flags, INDOOR_BIKE_DATA_FLAG.expendedEnergy)) {
    const total = reader.u16('total energy');
    const perHour = reader.u16('energy per hour');
    const perMinute = reader.u8('energy per minute');
    totalEnergy = total === UINT16_NOT_AVAILABLE ? undefined : total;
    energyPerHour = perHour === UINT16_NOT_AVAILABLE ? undefined : perHour;
    energyPerMinute = perMinute === UINT8_NOT_AVAILABLE ? undefined : perMinute;
  }

  const heartRate = flagSet(flags, INDOOR_BIKE_DATA_FLAG.heartRate)
    ? beatsPerMinute(reader.u8('heart rate'))
    : undefined;

  const metabolicEquivalent = flagSet(flags, INDOOR_BIKE_DATA_FLAG.metabolicEquivalent)
    ? reader.u8('metabolic equivalent') / METABOLIC_EQUIVALENT_UNITS_PER_UNIT
    : undefined;

  const elapsedTimeSeconds = flagSet(flags, INDOOR_BIKE_DATA_FLAG.elapsedTime)
    ? seconds(reader.u16('elapsed time'))
    : undefined;

  const remainingTimeSeconds = flagSet(flags, INDOOR_BIKE_DATA_FLAG.remainingTime)
    ? seconds(reader.u16('remaining time'))
    : undefined;

  return {
    instantaneousSpeed,
    averageSpeed,
    instantaneousCadence,
    averageCadence,
    totalDistance,
    resistanceLevel: resistance,
    instantaneousPower,
    averagePower,
    totalEnergyKilocalories: totalEnergy,
    energyPerHourKilocalories: energyPerHour,
    energyPerMinuteKilocalories: energyPerMinute,
    heartRate,
    metabolicEquivalent,
    elapsedTimeSeconds,
    remainingTimeSeconds,
    trailingOctets: reader.remaining(),
  };
}

// --- Fitness Machine Feature (0x2ACC) ---------------------------------------

/** The first 32-bit field: what the machine can **report** (FTMS Table 4.3). */
export interface FitnessMachineFeatureBits {
  readonly averageSpeed: boolean;
  readonly cadence: boolean;
  readonly totalDistance: boolean;
  readonly inclination: boolean;
  readonly elevationGain: boolean;
  readonly pace: boolean;
  readonly stepCount: boolean;
  readonly resistanceLevel: boolean;
  readonly strideCount: boolean;
  readonly expendedEnergy: boolean;
  readonly heartRateMeasurement: boolean;
  readonly metabolicEquivalent: boolean;
  readonly elapsedTime: boolean;
  readonly remainingTime: boolean;
  readonly powerMeasurement: boolean;
  readonly forceOnBeltAndPowerOutput: boolean;
  readonly userDataRetention: boolean;
}

/** The second 32-bit field: what the machine can be **told** (FTMS Table 4.4). */
export interface TargetSettingFeatureBits {
  readonly speedTarget: boolean;
  readonly inclinationTarget: boolean;
  readonly resistanceTarget: boolean;
  readonly powerTarget: boolean;
  readonly heartRateTarget: boolean;
  readonly targetedExpendedEnergyConfiguration: boolean;
  readonly targetedStepNumberConfiguration: boolean;
  readonly targetedStrideNumberConfiguration: boolean;
  readonly targetedDistanceConfiguration: boolean;
  readonly targetedTrainingTimeConfiguration: boolean;
  readonly targetedTimeInTwoHeartRateZonesConfiguration: boolean;
  readonly targetedTimeInThreeHeartRateZonesConfiguration: boolean;
  readonly targetedTimeInFiveHeartRateZonesConfiguration: boolean;
  readonly indoorBikeSimulationParameters: boolean;
  readonly wheelCircumferenceConfiguration: boolean;
  readonly spinDownControl: boolean;
  readonly targetedCadenceConfiguration: boolean;
}

/**
 * What a machine says it can do.
 *
 * ⚠️ **Eight octets, two 32-bit fields.** A decoder that reads one `uint32` and
 * stops sees none of the target-setting bits at all, and would gate the ERG and
 * gradient UI on nothing. Bit 3 of the second field is Power Target and bit 13
 * is Indoor Bike Simulation Parameters; those two are what say whether ERG and
 * gradient mode exist on this trainer.
 */
export interface FitnessMachineFeatures {
  readonly machine: FitnessMachineFeatureBits;
  readonly targetSetting: TargetSettingFeatureBits;
}

/**
 * Decode the Fitness Machine Feature characteristic.
 *
 * @throws {SensorError} `malformed-payload` for anything shorter than eight
 * octets — including the four-octet read a one-field decoder would accept.
 */
export function decodeFitnessMachineFeature(value: DataView): FitnessMachineFeatures {
  const reader = createPayloadReader(value, 'a Fitness Machine Feature');
  const machineBits = reader.u32('fitness machine features field');
  const targetBits = reader.u32('target setting features field');
  return {
    machine: {
      averageSpeed: flagSet(machineBits, 0),
      cadence: flagSet(machineBits, 1),
      totalDistance: flagSet(machineBits, 2),
      inclination: flagSet(machineBits, 3),
      elevationGain: flagSet(machineBits, 4),
      pace: flagSet(machineBits, 5),
      stepCount: flagSet(machineBits, 6),
      resistanceLevel: flagSet(machineBits, 7),
      strideCount: flagSet(machineBits, 8),
      expendedEnergy: flagSet(machineBits, 9),
      heartRateMeasurement: flagSet(machineBits, 10),
      metabolicEquivalent: flagSet(machineBits, 11),
      elapsedTime: flagSet(machineBits, 12),
      remainingTime: flagSet(machineBits, 13),
      powerMeasurement: flagSet(machineBits, 14),
      forceOnBeltAndPowerOutput: flagSet(machineBits, 15),
      userDataRetention: flagSet(machineBits, 16),
    },
    targetSetting: {
      speedTarget: flagSet(targetBits, 0),
      inclinationTarget: flagSet(targetBits, 1),
      resistanceTarget: flagSet(targetBits, 2),
      powerTarget: flagSet(targetBits, 3),
      heartRateTarget: flagSet(targetBits, 4),
      targetedExpendedEnergyConfiguration: flagSet(targetBits, 5),
      targetedStepNumberConfiguration: flagSet(targetBits, 6),
      targetedStrideNumberConfiguration: flagSet(targetBits, 7),
      targetedDistanceConfiguration: flagSet(targetBits, 8),
      targetedTrainingTimeConfiguration: flagSet(targetBits, 9),
      targetedTimeInTwoHeartRateZonesConfiguration: flagSet(targetBits, 10),
      targetedTimeInThreeHeartRateZonesConfiguration: flagSet(targetBits, 11),
      targetedTimeInFiveHeartRateZonesConfiguration: flagSet(targetBits, 12),
      indoorBikeSimulationParameters: flagSet(targetBits, 13),
      wheelCircumferenceConfiguration: flagSet(targetBits, 14),
      spinDownControl: flagSet(targetBits, 15),
      targetedCadenceConfiguration: flagSet(targetBits, 16),
    },
  };
}

/**
 * The capabilities a machine's Feature characteristic says it supplies.
 *
 * `speed` is unconditional: Instantaneous Speed is mandatory in every indoor
 * bike Data Record (FTMS §4.9.1.2), so a machine implementing the service at
 * all reports it — and unlike a wheel-revolution sensor it reports a speed
 * rather than revolutions, so no wheel circumference is needed and
 * `capability.ts`'s rule is satisfied.
 *
 * `heart-rate` is deliberately never included; see
 * {@link createIndoorBikeDataProfile}.
 */
export function fitnessMachineCapabilities(
  features: FitnessMachineFeatures,
): readonly MeasurementCapability[] {
  const capabilities: MeasurementCapability[] = ['speed'];
  if (features.machine.powerMeasurement) {
    capabilities.push('power');
  }
  if (features.machine.cadence) {
    capabilities.push('cadence');
  }
  return capabilities;
}

// --- The supported ranges a setpoint is checked against ---------------------

/** Supported Power Range (0x2AD8): three fields, not two. */
export interface SupportedPowerRange {
  readonly minimum: Watts;
  readonly maximum: Watts;
  /**
   * The smallest step the machine resolves. An ERG setpoint must be **quantised
   * to this** as well as clamped to the range: a trainer asked for 251 W with a
   * 5 W increment does something unspecified with the 1.
   */
  readonly increment: Watts;
}

/**
 * Decode the Supported Power Range characteristic.
 *
 * Refuses four things, each of which is a fault this client must not carry into
 * a setpoint:
 *
 * - a short value — the four-octet read a two-field decoder would accept;
 * - an **increment of zero**, which divides by zero the moment a setpoint is
 *   quantised;
 * - a maximum below the minimum, which makes every setpoint out of range;
 * - a maximum above {@link MAX_PLAUSIBLE_TARGET_POWER_WATTS}, or a negative
 *   minimum. The device does not get to define its own ceiling.
 *
 * @throws {SensorError} `malformed-payload` for each of those.
 */
export function decodeSupportedPowerRange(value: DataView): SupportedPowerRange {
  const reader = createPayloadReader(value, 'a Supported Power Range');
  const minimum = reader.i16('minimum power');
  const maximum = reader.i16('maximum power');
  const increment = reader.u16('minimum increment');

  if (minimum < 0) {
    throw malformedPayload(
      `a Supported Power Range reports a minimum of ${String(
        minimum,
      )} W; an indoor bike cannot absorb a negative target`,
    );
  }
  if (maximum < minimum) {
    throw malformedPayload(
      `a Supported Power Range reports a maximum of ${String(maximum)} W below its minimum of ${String(
        minimum,
      )} W`,
    );
  }
  if (maximum > MAX_PLAUSIBLE_TARGET_POWER_WATTS) {
    throw malformedPayload(
      `a Supported Power Range reports a maximum of ${String(
        maximum,
      )} W, above the ${String(MAX_PLAUSIBLE_TARGET_POWER_WATTS)} W this client will write to a trainer`,
    );
  }
  if (increment <= 0) {
    throw malformedPayload(
      'a Supported Power Range reports a minimum increment of 0 W, which cannot quantise a setpoint',
    );
  }

  return { minimum: watts(minimum), maximum: watts(maximum), increment: watts(increment) };
}

/** Supported Resistance Level Range (0x2AD6). All three fields at a resolution of 0.1. */
export interface SupportedResistanceLevelRange {
  readonly minimum: ResistanceLevel;
  readonly maximum: ResistanceLevel;
  readonly increment: ResistanceLevel;
}

/**
 * Decode the Supported Resistance Level Range characteristic.
 *
 * @throws {SensorError} `malformed-payload` for a short value, a negative
 * minimum, a maximum below the minimum, or an increment of zero.
 */
export function decodeSupportedResistanceLevelRange(
  value: DataView,
): SupportedResistanceLevelRange {
  const reader = createPayloadReader(value, 'a Supported Resistance Level Range');
  const minimum = reader.i16('minimum resistance level') / RESISTANCE_UNITS_PER_LEVEL;
  const maximum = reader.i16('maximum resistance level') / RESISTANCE_UNITS_PER_LEVEL;
  const increment = reader.u16('minimum increment') / RESISTANCE_UNITS_PER_LEVEL;

  if (minimum < 0) {
    throw malformedPayload(
      `a Supported Resistance Level Range reports a minimum of ${String(
        minimum,
      )}; a brake level is not negative`,
    );
  }
  if (maximum < minimum) {
    throw malformedPayload(
      `a Supported Resistance Level Range reports a maximum of ${String(
        maximum,
      )} below its minimum of ${String(minimum)}`,
    );
  }
  if (increment <= 0) {
    throw malformedPayload(
      'a Supported Resistance Level Range reports a minimum increment of 0, which cannot quantise a setpoint',
    );
  }

  return {
    minimum: resistanceLevel(minimum),
    maximum: resistanceLevel(maximum),
    increment: resistanceLevel(increment),
  };
}

// --- The profile a transport registers --------------------------------------

/**
 * The Indoor Bike Data profile, ready to register with a transport.
 *
 * **One notification fans out into three measurements with one instant**, which
 * is the arrangement `capability.ts` describes and the reason the seam is a
 * capability rather than a characteristic: the trainer's own stream is the
 * preferred source for power, cadence and speed together, and
 * `planCapabilitySources` spends one connection instead of three because of it.
 *
 * ⚠️ **Heart rate is decoded and deliberately not fanned out.** Indoor Bike
 * Data carries a Heart Rate field, and it is whatever strap the *machine*
 * paired with itself. Reporting it as a `heart-rate` measurement would stamp
 * the trainer's device identity on a reading from a device the athlete never
 * connected, and would let a trainer supply a heart rate that silently outranks
 * the strap the athlete did choose. It is on {@link IndoorBikeDataReading} for
 * a caller who wants it explicitly.
 *
 * @param options.features narrows the declared capability set to what the
 * machine's Feature characteristic claims. Omitted, the profile declares all
 * three — which is what a transport that has not read the Feature
 * characteristic (#134) must assume, because a capability the profile does not
 * declare is one the adapter will never subscribe to.
 */
export function createIndoorBikeDataProfile(options?: {
  readonly features?: FitnessMachineFeatures | undefined;
}): GattProfile {
  const capabilities: readonly MeasurementCapability[] =
    options?.features === undefined
      ? ['power', 'cadence', 'speed']
      : fitnessMachineCapabilities(options.features);

  return {
    service: FITNESS_MACHINE_SERVICE,
    characteristic: INDOOR_BIKE_DATA,
    capabilities,
    // Two parameters, not three. `GattProfile.decode` passes the receive
    // instant as a third, and a profile that does not need it stays assignable
    // without declaring it — this one differences nothing, because Indoor Bike
    // Data reports a speed and a cadence rather than the revolution counters
    // CSC and Cycling Power make a client difference for itself.
    decode(value: DataView, sink: MeasurementSink): void {
      // Decoded in full before anything is reported. A frame whose power field
      // is truncated must not put its speed on the ride screen, because the
      // truncation means the offsets are not what they were read as.
      const reading = decodeIndoorBikeData(value);

      if (reading.instantaneousPower !== undefined) {
        sink.power(reading.instantaneousPower);
      }
      if (reading.instantaneousCadence !== undefined) {
        sink.cadence(reading.instantaneousCadence);
      }
      if (reading.instantaneousSpeed !== undefined) {
        sink.speed(reading.instantaneousSpeed);
      }
    },
  };
}
