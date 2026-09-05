// SPDX-License-Identifier: Apache-2.0

/**
 * The Fitness Machine Service reads: Indoor Bike Data, the Feature
 * characteristic and the two supported-range characteristics.
 *
 * Every payload is built with `createPayloadWriter`, which appends, against a
 * decoder that walks. Neither knows an offset, so a shared arithmetic mistake
 * cannot cancel out — the reason `testing.ts` exists rather than literal byte
 * arrays. The control point's own protocol is in
 * `fitness-machine-control.test.ts`.
 */

import {
  hundredthsKilometresPerHourToMetresPerSecond,
  metresPerSecond,
  unixSeconds,
  type MetresPerSecond,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';
import {
  MAX_PLAUSIBLE_CADENCE_RPM,
  MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND,
} from '../../src/revolutions';

import {
  createIndoorBikeDataProfile,
  decodeFitnessMachineFeature,
  decodeIndoorBikeData,
  decodeSupportedPowerRange,
  decodeSupportedResistanceLevelRange,
  fitnessMachineCapabilities,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
  INDOOR_BIKE_DATA_FLAG,
  MAX_PLAUSIBLE_TARGET_POWER_WATTS,
} from './fitness-machine';
import type { MeasurementSink } from './profile';
import { canonicalUuid } from './uuid';
import { createPayloadWriter, flagsOf } from './testing';

// --- Building an Indoor Bike Data payload ------------------------------------

/**
 * ⚠️ **Bit 0 is More Data and its sense is inverted.** Instantaneous Speed is
 * present when the bit is **clear** (FTMS 1.0 §4.9.1.2), so a test that wants a
 * frame *without* speed sets the bit. Every helper below states which it did.
 */
const SPEED_ABSENT = flagsOf(INDOOR_BIKE_DATA_FLAG.moreData);

describe('Indoor Bike Data — the inverted presence bit', () => {
  it('reads instantaneous speed when More Data is CLEAR, which is the common frame', () => {
    const payload = createPayloadWriter().u16(0).u16(2543).view();

    const reading = decodeIndoorBikeData(payload);

    // 2543 × 0.01 km/h = 25.43 km/h, converted through @onyourleft/domain.
    expect(reading.instantaneousSpeed).toBe(hundredthsKilometresPerHourToMetresPerSecond(2543));
    expect(reading.instantaneousSpeed).toBeCloseTo(7.0639, 4);
  });

  it('reads NO speed when More Data is SET, and reads the next field at octet 2', () => {
    // This is the case a generic "for each set bit, consume a field" loop gets
    // wrong: it would read 250 as a speed and then find nothing where the power
    // is. The power here is what proves the offset did not shift.
    const payload = createPayloadWriter()
      .u16(SPEED_ABSENT | flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .i16(250)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.instantaneousSpeed).toBeUndefined();
    expect(reading.instantaneousPower).toBe(250);
  });
});

describe('Indoor Bike Data across flag combinations', () => {
  it('decodes speed alone — the minimum legal frame', () => {
    const reading = decodeIndoorBikeData(createPayloadWriter().u16(0).u16(2000).view());

    expect(reading.instantaneousSpeed).toBeCloseTo(5.5556, 4);
    expect(reading.instantaneousCadence).toBeUndefined();
    expect(reading.instantaneousPower).toBeUndefined();
    expect(reading.totalDistance).toBeUndefined();
  });

  it('decodes speed, cadence and power — what a typical smart trainer sends', () => {
    const payload = createPayloadWriter()
      .u16(
        flagsOf(
          INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
          INDOOR_BIKE_DATA_FLAG.instantaneousPower,
        ),
      )
      .u16(2543)
      .u16(180) // half-rpm: 90 rpm
      .i16(214)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.instantaneousSpeed).toBeCloseTo(7.0639, 4);
    expect(reading.instantaneousCadence).toBe(90);
    expect(reading.instantaneousPower).toBe(214);
  });

  it('decodes the average fields, which sit between speed and cadence', () => {
    const payload = createPayloadWriter()
      .u16(
        flagsOf(
          INDOOR_BIKE_DATA_FLAG.averageSpeed,
          INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
          INDOOR_BIKE_DATA_FLAG.averageCadence,
        ),
      )
      .u16(2543)
      .u16(2400)
      .u16(180)
      .u16(176)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.averageSpeed).toBeCloseTo(6.6667, 4);
    expect(reading.instantaneousCadence).toBe(90);
    expect(reading.averageCadence).toBe(88);
  });

  it('skips a middle field: total distance is present, resistance level is not', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.totalDistance, INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .u24(1_234_567) // a uint24 above the uint16 ceiling, assembled by hand
      .i16(214)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.totalDistance).toBe(1_234_567);
    expect(reading.resistanceLevel).toBeUndefined();
    expect(reading.instantaneousPower).toBe(214);
  });

  it('reads a negative resistance level, which is a sint16 and not a magnitude', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.resistanceLevel, INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .i16(-12)
      .i16(214)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.resistanceLevel).toBe(-12);
    expect(reading.instantaneousPower).toBe(214);
  });

  it('consumes all FIVE octets behind the expended-energy bit, not two', () => {
    // Bit 8 gates three fields: Total Energy u16, Energy per Hour u16, Energy
    // per Minute u8. A decoder that reads one field here reads the heart rate
    // out of the middle of the energy triple.
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.expendedEnergy, INDOOR_BIKE_DATA_FLAG.heartRate))
      .u16(2543)
      .u16(412) // total energy, kcal
      .u16(780) // energy per hour, kcal
      .u8(13) // energy per minute, kcal
      .u8(147) // heart rate
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.totalEnergyKilocalories).toBe(412);
    expect(reading.energyPerHourKilocalories).toBe(780);
    expect(reading.energyPerMinuteKilocalories).toBe(13);
    expect(reading.heartRate).toBe(147);
  });

  it('reports the energy fields as absent when the machine sent the Data Not Available sentinel', () => {
    // FTMS §4.9.1.10-12: a machine that cannot calculate the figure must still
    // send the field, as 0xFFFF (or 0xFF for the per-minute one). Recording
    // 65 535 kcal for an hour's ride is the alternative.
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.expendedEnergy))
      .u16(2543)
      .u16(0xffff)
      .u16(0xffff)
      .u8(0xff)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.totalEnergyKilocalories).toBeUndefined();
    expect(reading.energyPerHourKilocalories).toBeUndefined();
    expect(reading.energyPerMinuteKilocalories).toBeUndefined();
    expect(reading.trailingOctets).toBe(0);
  });

  it('decodes a frame carrying every field, with the tail fields in the right places', () => {
    const payload = createPayloadWriter()
      .u16(
        flagsOf(
          INDOOR_BIKE_DATA_FLAG.averageSpeed,
          INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
          INDOOR_BIKE_DATA_FLAG.averageCadence,
          INDOOR_BIKE_DATA_FLAG.totalDistance,
          INDOOR_BIKE_DATA_FLAG.resistanceLevel,
          INDOOR_BIKE_DATA_FLAG.instantaneousPower,
          INDOOR_BIKE_DATA_FLAG.averagePower,
          INDOOR_BIKE_DATA_FLAG.expendedEnergy,
          INDOOR_BIKE_DATA_FLAG.heartRate,
          INDOOR_BIKE_DATA_FLAG.metabolicEquivalent,
          INDOOR_BIKE_DATA_FLAG.elapsedTime,
          INDOOR_BIKE_DATA_FLAG.remainingTime,
        ),
      )
      .u16(2543)
      .u16(2400)
      .u16(180)
      .u16(176)
      .u24(12_045)
      .i16(8)
      .i16(214)
      .i16(198)
      .u16(412)
      .u16(780)
      .u8(13)
      .u8(147)
      .u8(94) // metabolic equivalent, 0.1 resolution
      .u16(3600)
      .u16(1800)
      .view();

    const reading = decodeIndoorBikeData(payload);

    expect(reading.metabolicEquivalent).toBeCloseTo(9.4, 10);
    expect(reading.elapsedTimeSeconds).toBe(3600);
    expect(reading.remainingTimeSeconds).toBe(1800);
    expect(reading.averagePower).toBe(198);
  });

  it('leaves nothing unread when it accepts a frame', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .i16(214)
      .view();

    expect(decodeIndoorBikeData(payload).trailingOctets).toBe(0);
  });

  it('reports trailing octets rather than failing, because a future field is not a fault', () => {
    // Reserved-for-future-use bits shall be zero, but a Server that adds a
    // field this client does not know about must not take the ride down. The
    // count is surfaced so a bug report can name it.
    const payload = createPayloadWriter().u16(0).u16(2543).u8(0xff).u8(0xff).view();

    expect(decodeIndoorBikeData(payload).trailingOctets).toBe(2);
  });
});

describe('the flags-versus-fields disagreement between FTMS 1.0 and GSS v9', () => {
  it('treats bit 2 as a NORMAL presence bit, per GSS v9 §3.124', () => {
    // FTMS 1.0 Table 4.10 describes bit 2 with inverted polarity, the same
    // wording as the More Data row above it. GSS v9 (2023) says "present if set
    // to 1", the Cross Trainer table shows only bit 0 inverted, and the SIG's
    // Errata Correction 23224 is mandatory for FTMS 1.0 compliance and was not
    // obtained. This client implements GSS v9. Both readings are pinned here so
    // that a future correction changes a test rather than surprising a rider.
    const withBitSet = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousCadence))
      .u16(2543)
      .u16(180)
      .view();

    expect(decodeIndoorBikeData(withBitSet).instantaneousCadence).toBe(90);
  });

  it('reads no cadence when bit 2 is clear — which the FTMS 1.0 table would call present', () => {
    // Under Table 4.10's reading this frame carries a cadence. Under GSS v9 it
    // does not, and the two octets that follow the speed are a different field
    // entirely. Nothing is consumed here, so the trailing count says so.
    const withBitClear = createPayloadWriter().u16(0).u16(2543).u16(180).view();

    const reading = decodeIndoorBikeData(withBitClear);

    expect(reading.instantaneousCadence).toBeUndefined();
    expect(reading.trailingOctets).toBe(2);
  });
});

describe('Indoor Bike Data is untrusted input', () => {
  it('raises malformed-payload rather than a RangeError when a flag claims a field that is not there', () => {
    const truncated = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .u8(214) // one octet of a two-octet power field
      .view();

    expect(() => decodeIndoorBikeData(truncated)).toThrow(/instantaneous power/);
    try {
      decodeIndoorBikeData(truncated);
    } catch (error) {
      expect(isSensorError(error, 'malformed-payload')).toBe(true);
    }
  });

  it('raises malformed-payload for a payload with no flags field at all', () => {
    const empty = createPayloadWriter().u8(0).view();

    expect(() => decodeIndoorBikeData(empty)).toThrow(/flags/);
  });

  it.each([2, 4, 5, 7, 9, 11, 14, 15, 16])(
    'raises malformed-payload when a full frame is truncated at octet %i',
    (length) => {
      const full = createPayloadWriter()
        .u16(
          flagsOf(
            INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
            INDOOR_BIKE_DATA_FLAG.totalDistance,
            INDOOR_BIKE_DATA_FLAG.resistanceLevel,
            INDOOR_BIKE_DATA_FLAG.instantaneousPower,
            INDOOR_BIKE_DATA_FLAG.expendedEnergy,
          ),
        )
        .u16(2543)
        .u16(180)
        .u24(12_045)
        .i16(8)
        .i16(214)
        .u16(412)
        .u16(780)
        .u8(13)
        .bytes();
      const truncated = new DataView(full.buffer, full.byteOffset, length);

      expect(() => decodeIndoorBikeData(truncated)).toThrow();
      try {
        decodeIndoorBikeData(truncated);
      } catch (error) {
        expect(isSensorError(error, 'malformed-payload')).toBe(true);
      }
    },
  );

  it('rejects a negative instantaneous power as a decode fault, not a reading', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .i16(-1)
      .view();

    expect(() => decodeIndoorBikeData(payload)).toThrow(/-1/);
  });

  it('rejects a power above the plausible ceiling, which is what a mis-walked offset produces', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousPower))
      .u16(2543)
      .i16(30_000)
      .view();

    expect(() => decodeIndoorBikeData(payload)).toThrow(/30000/);
  });

  it('drops an implausible cadence rather than recording it', () => {
    const payload = createPayloadWriter()
      .u16(flagsOf(INDOOR_BIKE_DATA_FLAG.instantaneousCadence))
      .u16(2543)
      .u16((MAX_PLAUSIBLE_CADENCE_RPM + 10) * 2)
      .view();

    expect(decodeIndoorBikeData(payload).instantaneousCadence).toBeUndefined();
  });

  it('drops an implausible speed rather than recording it', () => {
    // 0x8000 in 0.01 km/h is 327.68 km/h, which is 91 m/s.
    const payload = createPayloadWriter().u16(0).u16(0x8000).view();

    expect(decodeIndoorBikeData(payload).instantaneousSpeed).toBeUndefined();
    expect(MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND).toBeLessThan(91);
  });

  it('reads a view that is a window onto a larger buffer, at its own byteOffset', () => {
    // Web Bluetooth hands over a view onto a reused buffer, frequently not
    // starting at zero. Reading `view.buffer` would step into whatever the
    // browser put next to the notification.
    const frame = createPayloadWriter().u16(0).u16(2543).bytes();
    const padded = new Uint8Array(frame.byteLength + 8);
    padded.set(frame, 5);
    const window = new DataView(padded.buffer, 5, frame.byteLength);

    expect(decodeIndoorBikeData(window).instantaneousSpeed).toBeCloseTo(7.0639, 4);
  });
});

describe('the Indoor Bike Data profile, as a transport registers it', () => {
  it('names the Fitness Machine service and the Indoor Bike Data characteristic', () => {
    const profile = createIndoorBikeDataProfile();

    expect(profile.service).toBe(canonicalUuid(0x1826));
    expect(profile.characteristic).toBe(canonicalUuid(0x2ad2));
    expect(FITNESS_MACHINE_SERVICE).toBe(canonicalUuid(0x1826));
    expect(INDOOR_BIKE_DATA).toBe(canonicalUuid(0x2ad2));
  });

  it('declares power, cadence and speed — one notification fans out into three', () => {
    expect([...createIndoorBikeDataProfile().capabilities].sort()).toStrictEqual([
      'cadence',
      'power',
      'speed',
    ]);
  });

  it('narrows its capability set to what the Feature characteristic claims, when given one', () => {
    // A capability the profile does not declare is one the adapter will never
    // subscribe to, so a transport that has not read the Feature characteristic
    // (#134) must get the wide set rather than an empty one.
    const features = decodeFitnessMachineFeature(
      createPayloadWriter()
        .u32(1 << 14)
        .u32(0)
        .view(),
    );

    expect([...createIndoorBikeDataProfile({ features }).capabilities].sort()).toStrictEqual([
      'power',
      'speed',
    ]);
  });

  it('pushes nothing for a field the frame does not carry', () => {
    const seen: string[] = [];
    const sink: MeasurementSink = {
      power: () => void seen.push('power'),
      cadence: () => void seen.push('cadence'),
      speed: () => void seen.push('speed'),
      'heart-rate': () => void seen.push('heart-rate'),
    };
    // Speed only: More Data clear, no other bit set.
    const payload = createPayloadWriter().u16(0).u16(2543).view();

    createIndoorBikeDataProfile().decode(payload, sink, unixSeconds(1_800_000_000));

    expect(seen).toStrictEqual(['speed']);
  });

  it('pushes every present measurement into the sink', () => {
    const seen: Array<[string, number]> = [];
    const sink: MeasurementSink = {
      power: (value) => void seen.push(['power', value]),
      cadence: (value) => void seen.push(['cadence', value]),
      speed: (value) => void seen.push(['speed', value]),
      'heart-rate': (value) => void seen.push(['heart-rate', value]),
    };
    const payload = createPayloadWriter()
      .u16(
        flagsOf(
          INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
          INDOOR_BIKE_DATA_FLAG.instantaneousPower,
          INDOOR_BIKE_DATA_FLAG.heartRate,
        ),
      )
      .u16(2543)
      .u16(180)
      .i16(214)
      .u8(147)
      .view();

    createIndoorBikeDataProfile().decode(payload, sink, unixSeconds(1_800_000_000));

    expect(seen).toStrictEqual([
      ['power', 214],
      ['cadence', 90],
      ['speed', hundredthsKilometresPerHourToMetresPerSecond(2543)],
    ]);
  });

  it('does not report a heart rate, because the trainer is not the strap it heard it from', () => {
    // FTMS carries a Heart Rate field. It is whatever the machine picked up
    // from a strap it paired with itself, attributed here to the trainer's own
    // device id — which is a measurement the athlete never chose to connect.
    // The value is decoded and surfaced on the reading; it is not fanned out as
    // a `heart-rate` capability.
    expect(createIndoorBikeDataProfile().capabilities).not.toContain('heart-rate');
  });

  it('pushes nothing at all when the frame is unreadable, rather than a partial frame', () => {
    const seen: string[] = [];
    const sink: MeasurementSink = {
      power: () => void seen.push('power'),
      cadence: () => void seen.push('cadence'),
      speed: () => void seen.push('speed'),
      'heart-rate': () => void seen.push('heart-rate'),
    };
    // Speed and cadence are readable; the power field is truncated.
    const payload = createPayloadWriter()
      .u16(
        flagsOf(
          INDOOR_BIKE_DATA_FLAG.instantaneousCadence,
          INDOOR_BIKE_DATA_FLAG.instantaneousPower,
        ),
      )
      .u16(2543)
      .u16(180)
      .u8(214)
      .view();

    expect(() =>
      createIndoorBikeDataProfile().decode(payload, sink, unixSeconds(1_800_000_000)),
    ).toThrow();
    expect(seen).toStrictEqual([]);
  });
});

describe('the Fitness Machine Feature characteristic', () => {
  it('reads two 32-bit fields, not one — eight octets', () => {
    const payload = createPayloadWriter()
      .u32((1 << 1) | (1 << 2) | (1 << 14)) // cadence, total distance, power measurement
      .u32((1 << 2) | (1 << 3) | (1 << 13)) // resistance, power target, simulation parameters
      .view();

    const features = decodeFitnessMachineFeature(payload);

    expect(features.machine.cadence).toBe(true);
    expect(features.machine.totalDistance).toBe(true);
    expect(features.machine.powerMeasurement).toBe(true);
    expect(features.machine.averageSpeed).toBe(false);
    expect(features.targetSetting.resistanceTarget).toBe(true);
    expect(features.targetSetting.powerTarget).toBe(true);
    expect(features.targetSetting.indoorBikeSimulationParameters).toBe(true);
    expect(features.targetSetting.speedTarget).toBe(false);
  });

  it('reads bit 16 of each field, which a 16-bit read would silently lose', () => {
    const payload = createPayloadWriter()
      .u32(1 << 16)
      .u32(1 << 16)
      .view();

    const features = decodeFitnessMachineFeature(payload);

    expect(features.machine.userDataRetention).toBe(true);
    expect(features.targetSetting.targetedCadenceConfiguration).toBe(true);
  });

  it('raises malformed-payload for the four-octet read a one-field decoder would accept', () => {
    const payload = createPayloadWriter().u32(0xffff).view();

    expect(() => decodeFitnessMachineFeature(payload)).toThrow(/target setting/);
  });

  it('maps the machine features onto the capabilities a trainer supplies', () => {
    const features = decodeFitnessMachineFeature(
      createPayloadWriter()
        .u32((1 << 1) | (1 << 14))
        .u32(0)
        .view(),
    );

    expect([...fitnessMachineCapabilities(features)].sort()).toStrictEqual([
      'cadence',
      'power',
      'speed',
    ]);
  });

  it('declares speed and no cadence for a machine whose Feature field claims no cadence', () => {
    // Instantaneous Speed is mandatory in every Indoor Bike Data frame, so
    // `speed` is unconditional. Cadence is not.
    const features = decodeFitnessMachineFeature(createPayloadWriter().u32(0).u32(0).view());

    expect([...fitnessMachineCapabilities(features)]).toStrictEqual(['speed']);
  });
});

describe('the Supported Power Range characteristic', () => {
  it('reads three fields — minimum, maximum and the minimum increment', () => {
    const payload = createPayloadWriter().i16(0).i16(1000).u16(5).view();

    expect(decodeSupportedPowerRange(payload)).toStrictEqual({
      minimum: 0,
      maximum: 1000,
      increment: 5,
    });
  });

  it('raises malformed-payload for the four-octet read a two-field decoder would accept', () => {
    const payload = createPayloadWriter().i16(0).i16(1000).view();

    expect(() => decodeSupportedPowerRange(payload)).toThrow(/increment/);
  });

  it('refuses an increment of zero, which would divide by zero when a setpoint is quantised', () => {
    const payload = createPayloadWriter().i16(0).i16(1000).u16(0).view();

    expect(() => decodeSupportedPowerRange(payload)).toThrow(/increment/);
  });

  it('refuses a maximum below the minimum', () => {
    const payload = createPayloadWriter().i16(500).i16(100).u16(5).view();

    expect(() => decodeSupportedPowerRange(payload)).toThrow(/maximum/);
  });

  it('refuses a negative minimum, which an indoor bike cannot mean', () => {
    const payload = createPayloadWriter().i16(-100).i16(1000).u16(5).view();

    expect(() => decodeSupportedPowerRange(payload)).toThrow(/minimum/);
  });

  it('refuses a maximum above the plausible ceiling for a setpoint written to a trainer', () => {
    const payload = createPayloadWriter().i16(0).i16(30_000).u16(5).view();

    expect(() => decodeSupportedPowerRange(payload)).toThrow(
      new RegExp(String(MAX_PLAUSIBLE_TARGET_POWER_WATTS)),
    );
  });
});

describe('the Supported Resistance Level Range characteristic', () => {
  it('reads three fields at a resolution of 0.1', () => {
    const payload = createPayloadWriter().i16(10).i16(320).u16(10).view();

    const range = decodeSupportedResistanceLevelRange(payload);

    expect(range.minimum).toBeCloseTo(1, 10);
    expect(range.maximum).toBeCloseTo(32, 10);
    expect(range.increment).toBeCloseTo(1, 10);
  });

  it('raises malformed-payload for a truncated value', () => {
    expect(() =>
      decodeSupportedResistanceLevelRange(createPayloadWriter().i16(10).i16(320).view()),
    ).toThrow(/increment/);
  });

  it('refuses an increment of zero', () => {
    expect(() =>
      decodeSupportedResistanceLevelRange(createPayloadWriter().i16(10).i16(320).u16(0).view()),
    ).toThrow(/increment/);
  });

  it('refuses a negative minimum, which a brake level is not', () => {
    expect(() =>
      decodeSupportedResistanceLevelRange(createPayloadWriter().i16(-10).i16(320).u16(10).view()),
    ).toThrow(/minimum/);
  });

  it('refuses a maximum below the minimum', () => {
    expect(() =>
      decodeSupportedResistanceLevelRange(createPayloadWriter().i16(200).i16(100).u16(10).view()),
    ).toThrow(/maximum/);
  });
});

describe('the speed conversion comes from the domain package, not a second copy', () => {
  it.each([0, 1, 2543, 5000])('agrees with @onyourleft/domain for a raw value of %i', (raw) => {
    const reading = decodeIndoorBikeData(createPayloadWriter().u16(0).u16(raw).view());
    const expected: MetresPerSecond = hundredthsKilometresPerHourToMetresPerSecond(raw);

    expect(reading.instantaneousSpeed).toBe(expected);
  });

  it('is not the identity, and not a plain divide by 100', () => {
    // The assertion that catches "speed was passed through unscaled": 25.43
    // km/h is 7.06 m/s, and both wrong answers are numbers a reviewer would
    // read past.
    const reading = decodeIndoorBikeData(createPayloadWriter().u16(0).u16(2543).view());

    expect(reading.instantaneousSpeed).not.toBe(metresPerSecond(2543));
    expect(reading.instantaneousSpeed).not.toBe(metresPerSecond(25.43));
  });
});
