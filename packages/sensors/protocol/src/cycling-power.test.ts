// SPDX-License-Identifier: Apache-2.0

/**
 * The Cycling Power client, from captured byte arrays with no hardware
 * attached.
 *
 * The centre of this file is the flag-combination matrix. #42 asks for at least
 * six distinct combinations *"including combinations that skip a middle field,
 * so a fixed-offset implementation cannot pass"*, and revision 2 of #1 adds the
 * requirement that makes the matrix actually load-bearing:
 *
 * > **That set must specifically include bit 1 set and bit 3 set**, or the
 * > suite will not catch this.
 *
 * Bits 1, 3 and 12 are *interpretation* bits, not presence bits. A parser that
 * loops over set bits advancing an offset corrupts every measurement from a
 * device that sets bit 1 or bit 3 — which is most dual-sided power meters — and
 * a matrix that never sets one would be green against that parser.
 */

import { describe, expect, it, vi } from 'vitest';

import { metres, unixSeconds, watts, type UnixSeconds } from '@onyourleft/domain';

import { isSensorError } from '../../src/errors';

import {
  accumulate,
  createCyclingPowerProfile,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  cyclingPowerCapabilities,
  decodeCyclingPowerFeature,
  decodeCyclingPowerMeasurement,
  MAX_PLAUSIBLE_POWER_WATTS,
  type CyclingPowerAccumulation,
} from './cycling-power';
import type { MeasurementSink } from './profile';
import { createPayloadWriter, flagsOf } from './testing';

/** Cycling Power Measurement flag bit indices, GSS v9 §3.65. */
const BALANCE = 0;
const BALANCE_REFERENCE_LEFT = 1;
const TORQUE = 2;
const TORQUE_SOURCE_CRANK = 3;
const WHEEL = 4;
const CRANK = 5;
const EXTREME_FORCE = 6;
const EXTREME_TORQUE = 7;
const EXTREME_ANGLES = 8;
const TOP_DEAD_SPOT = 9;
const BOTTOM_DEAD_SPOT = 10;
const ENERGY = 11;
const OFFSET_COMPENSATION = 12;

const WHEEL_700_25C = metres(2.105);
const START = 1_800_000_000;

interface Reported {
  readonly sink: MeasurementSink;
  readonly powers: number[];
  readonly cadences: number[];
  readonly speeds: number[];
}

function recordingSink(): Reported {
  const powers: number[] = [];
  const cadences: number[] = [];
  const speeds: number[] = [];
  return {
    sink: {
      power: (value) => powers.push(value),
      cadence: (value) => cadences.push(value),
      'heart-rate': vi.fn(),
      speed: (value) => speeds.push(value),
    },
    powers,
    cadences,
    speeds,
  };
}

describe('the mandatory field alone', () => {
  it('parses a packet carrying only flags and instantaneous power', () => {
    // #42's first criterion. Four octets is the whole packet from a trainer
    // that reports nothing else.
    const view = createPayloadWriter().u16(flagsOf()).i16(248).view();

    expect(decodeCyclingPowerMeasurement(view)).toMatchObject({
      instantaneousPower: watts(248),
      pedalPowerBalancePercent: undefined,
      pedalPowerBalanceReference: 'unknown',
      accumulatedTorqueSource: 'wheel',
      wheel: undefined,
      crank: undefined,
      offsetCompensationIndicator: false,
    });
  });
});

describe('every optional field present at once', () => {
  it('parses each one, asserted individually', () => {
    // #42's second criterion. Every presence bit set and every interpretation
    // bit set, which is also the longest packet the characteristic defines.
    const view = createPayloadWriter()
      .u16(
        flagsOf(
          BALANCE,
          BALANCE_REFERENCE_LEFT,
          TORQUE,
          TORQUE_SOURCE_CRANK,
          WHEEL,
          CRANK,
          EXTREME_FORCE,
          EXTREME_TORQUE,
          EXTREME_ANGLES,
          TOP_DEAD_SPOT,
          BOTTOM_DEAD_SPOT,
          ENERGY,
          OFFSET_COMPENSATION,
        ),
      )
      .i16(300)
      .u8(101) // 50.5 %, in half-percent units
      .u16(3200) // 100 N·m, in 1/32 N·m units
      .u32(120_000)
      .u16(4096)
      .u16(9000)
      .u16(2048)
      .i16(400)
      .i16(-50)
      .i16(3200)
      .i16(-320)
      .u24((60 << 12) | 300) // minimum 60°, maximum 300°
      .u16(15)
      .u16(190)
      .u16(1234)
      .view();

    expect(decodeCyclingPowerMeasurement(view)).toEqual({
      instantaneousPower: watts(300),
      pedalPowerBalancePercent: 50.5,
      pedalPowerBalanceReference: 'left',
      accumulatedTorqueNewtonMetres: 100,
      accumulatedTorqueRaw: 3200,
      accumulatedTorqueSource: 'crank',
      wheel: { revolutions: 120_000, lastEventTimeTicks: 4096 },
      crank: { revolutions: 9000, lastEventTimeTicks: 2048 },
      extremeForceNewtons: { maximum: 400, minimum: -50 },
      extremeTorqueNewtonMetres: { maximum: 100, minimum: -10 },
      extremeAnglesDegrees: { maximum: 300, minimum: 60 },
      topDeadSpotAngleDegrees: 15,
      bottomDeadSpotAngleDegrees: 190,
      accumulatedEnergyKilojoules: 1234,
      offsetCompensationIndicator: true,
    });
  });
});

describe('the flag-combination matrix', () => {
  /**
   * Each case names the bits set and the value of the *last* field in the
   * packet. If the walk is off by one octet anywhere, that last field is
   * wrong — which is why every case asserts it rather than only the power.
   */
  const cases = [
    {
      name: 'balance only, skipping torque and both counters',
      bits: [BALANCE],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u8(90),
      expected: { pedalPowerBalancePercent: 45, crank: undefined },
    },
    {
      name: 'crank only, skipping balance, torque and wheel — the middle fields',
      bits: [CRANK],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u16(500).u16(1024),
      expected: { crank: { revolutions: 500, lastEventTimeTicks: 1024 } },
    },
    {
      name: 'wheel only, skipping balance and torque',
      bits: [WHEEL],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u32(70_000).u16(2000),
      expected: { wheel: { revolutions: 70_000, lastEventTimeTicks: 2000 } },
    },
    {
      name: 'balance with its reference bit set, and nothing else — a dual-sided meter',
      bits: [BALANCE, BALANCE_REFERENCE_LEFT],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u8(100),
      expected: { pedalPowerBalancePercent: 50, pedalPowerBalanceReference: 'left' as const },
    },
    {
      name: 'the torque source bit set with NO torque field — bit 3 is not a presence bit',
      bits: [TORQUE_SOURCE_CRANK, CRANK],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u16(600).u16(2048),
      expected: {
        accumulatedTorqueNewtonMetres: undefined,
        accumulatedTorqueSource: 'crank' as const,
        crank: { revolutions: 600, lastEventTimeTicks: 2048 },
      },
    },
    {
      name: 'both interpretation bits set with no fields of their own, plus energy',
      bits: [BALANCE_REFERENCE_LEFT, TORQUE_SOURCE_CRANK, ENERGY],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u16(555),
      expected: {
        pedalPowerBalancePercent: undefined,
        pedalPowerBalanceReference: 'left' as const,
        accumulatedTorqueSource: 'crank' as const,
        accumulatedEnergyKilojoules: 555,
      },
    },
    {
      name: 'energy only, skipping every field between it and power',
      bits: [ENERGY],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u16(4321),
      expected: { accumulatedEnergyKilojoules: 4321 },
    },
    {
      name: 'the offset compensation indicator alone — bit 12 is not a presence bit',
      bits: [OFFSET_COMPENSATION],
      body: (w: ReturnType<typeof createPayloadWriter>) => w,
      expected: { offsetCompensationIndicator: true },
    },
    {
      name: 'dead spot angles without the extreme angles that precede them',
      bits: [TOP_DEAD_SPOT, BOTTOM_DEAD_SPOT],
      body: (w: ReturnType<typeof createPayloadWriter>) => w.u16(12).u16(200),
      expected: {
        extremeAnglesDegrees: undefined,
        topDeadSpotAngleDegrees: 12,
        bottomDeadSpotAngleDegrees: 200,
      },
    },
  ];

  for (const { name, bits, body, expected } of cases) {
    it(`parses ${name}`, () => {
      const view = body(
        createPayloadWriter()
          .u16(flagsOf(...bits))
          .i16(210),
      ).view();

      expect(decodeCyclingPowerMeasurement(view)).toMatchObject({
        instantaneousPower: watts(210),
        ...expected,
      });
    });
  }

  it('drives at least six distinct combinations', () => {
    // #42's third criterion is a count as well as a shape. Asserted so that
    // deleting a case is a failure rather than a quiet reduction in cover.
    expect(new Set(cases.map((one) => flagsOf(...one.bits))).size).toBeGreaterThanOrEqual(6);
  });
});

describe('extreme angles', () => {
  it('reads two uint12s out of three octets, not two uint16s out of four', () => {
    // Reading this field as two `uint16`s overruns by one octet and shifts
    // every field after it, which is why the dead spot angles are asserted
    // here too rather than only the angles.
    const view = createPayloadWriter()
      .u16(flagsOf(EXTREME_ANGLES, TOP_DEAD_SPOT))
      .i16(200)
      .u24((4095 << 12) | 1)
      .u16(77)
      .view();

    expect(decodeCyclingPowerMeasurement(view)).toMatchObject({
      extremeAnglesDegrees: { maximum: 1, minimum: 4095 },
      topDeadSpotAngleDegrees: 77,
    });
  });
});

describe('an implausible power reading', () => {
  it('surfaces a negative power as invalid rather than recording it', () => {
    // #42's seventh criterion. `sint16` -1 read as a `uint16` is 65 535 W —
    // a number that passes a non-negative check and lands in a ride file.
    let thrown: unknown;
    try {
      decodeCyclingPowerMeasurement(createPayloadWriter().u16(flagsOf()).i16(-1).view());
    } catch (error) {
      thrown = error;
    }

    expect(isSensorError(thrown, 'malformed-payload')).toBe(true);
  });

  it('surfaces a power above the ceiling as invalid', () => {
    expect(() =>
      decodeCyclingPowerMeasurement(
        createPayloadWriter()
          .u16(flagsOf())
          .i16(MAX_PLAUSIBLE_POWER_WATTS + 1)
          .view(),
      ),
    ).toThrow(/decode fault/);
  });

  it('accepts a track sprinter’s peak, and zero', () => {
    // The ceiling is a decode-fault detector, not a physiology check: it must
    // never discard a real reading.
    expect(
      decodeCyclingPowerMeasurement(createPayloadWriter().u16(flagsOf()).i16(2400).view())
        .instantaneousPower,
    ).toBe(watts(2400));
    expect(
      decodeCyclingPowerMeasurement(createPayloadWriter().u16(flagsOf()).i16(0).view())
        .instantaneousPower,
    ).toBe(watts(0));
  });
});

describe('a payload shorter than its flags claim', () => {
  it('is refused at every field boundary, never read out of bounds', () => {
    const full = createPayloadWriter()
      .u16(flagsOf(BALANCE, TORQUE, WHEEL, CRANK, EXTREME_FORCE, EXTREME_ANGLES, ENERGY))
      .i16(200)
      .u8(100)
      .u16(3200)
      .u32(1000)
      .u16(1024)
      .u16(500)
      .u16(2048)
      .i16(300)
      .i16(-20)
      .u24(0)
      .u16(99)
      .bytes();

    // Every truncation from "flags only" to "one octet short" must be a typed
    // error. A single length would leave most of the walk untested.
    for (let length = 0; length < full.byteLength; length += 1) {
      const truncated = full.slice(0, length);
      const view = new DataView(truncated.buffer, truncated.byteOffset, truncated.byteLength);

      let thrown: unknown;
      try {
        decodeCyclingPowerMeasurement(view);
      } catch (error) {
        thrown = error;
      }
      expect(isSensorError(thrown, 'malformed-payload'), `at length ${String(length)}`).toBe(true);
    }

    // …and the full packet reads, so the loop above is not passing because
    // every length fails.
    const view = new DataView(full.buffer, full.byteOffset, full.byteLength);
    expect(decodeCyclingPowerMeasurement(view).accumulatedEnergyKilojoules).toBe(99);
  });
});

describe('the Cycling Power Feature characteristic', () => {
  it('describes the device, rather than whichever flags the first frame set', () => {
    // #42's sixth criterion. A crank-based meter reports no crank revolutions
    // at all while the bike is stationary, so a capability set inferred from
    // the first notification says it cannot report cadence.
    const features = decodeCyclingPowerFeature(
      createPayloadWriter()
        .u32(flagsOf(0, 1, 3, 7))
        .view(),
    );

    expect(features).toMatchObject({
      pedalPowerBalance: true,
      accumulatedTorque: true,
      wheelRevolutionData: false,
      crankRevolutionData: true,
      accumulatedEnergy: true,
      spanLengthAdjustment: false,
    });
  });

  it('turns the feature field into capabilities, with power unconditional', () => {
    const crankOnly = decodeCyclingPowerFeature(createPayloadWriter().u32(flagsOf(3)).view());
    const hub = decodeCyclingPowerFeature(createPayloadWriter().u32(flagsOf(2)).view());
    const nothing = decodeCyclingPowerFeature(createPayloadWriter().u32(0).view());

    expect(cyclingPowerCapabilities(crankOnly)).toEqual(['power', 'cadence']);
    expect(cyclingPowerCapabilities(hub, { wheelCircumference: WHEEL_700_25C })).toEqual([
      'power',
      'speed',
    ]);
    // Revolutions are not a speed without the athlete's wheel — `capability.ts`
    // says exactly this, so a hub meter with no circumference set is not a
    // speed source.
    expect(cyclingPowerCapabilities(hub)).toEqual(['power']);
    expect(cyclingPowerCapabilities(nothing)).toEqual(['power']);
  });

  it('refuses a feature characteristic shorter than its uint32', () => {
    expect(() => decodeCyclingPowerFeature(createPayloadWriter().u16(1).view())).toThrow();
  });
});

describe('the accumulating scalars', () => {
  const reading = (torqueRaw: number | undefined, energy: number | undefined) =>
    decodeCyclingPowerMeasurement(
      (() => {
        const writer = createPayloadWriter().u16(
          flagsOf(
            ...(torqueRaw === undefined ? [] : [TORQUE]),
            ...(energy === undefined ? [] : [ENERGY]),
          ),
        );
        writer.i16(200);
        if (torqueRaw !== undefined) {
          writer.u16(torqueRaw);
        }
        if (energy !== undefined) {
          writer.u16(energy);
        }
        return writer.view();
      })(),
    );

  it('reports nothing from the first frame — a difference needs two readings', () => {
    expect(
      accumulate({ torqueRaw: undefined, energyKilojoules: undefined }, reading(100, 5)),
    ).toEqual({ torqueNewtonMetres: undefined, energyKilojoules: undefined });
  });

  it('differences accumulated torque across its uint16 wrap', () => {
    // #42: "a test proves accumulated torque and accumulated energy handle
    // counter wrap". 65 500 → 36 is 72 raw units, not -65 464.
    expect(
      accumulate({ torqueRaw: 65_500, energyKilojoules: undefined }, reading(36, undefined)),
    ).toMatchObject({ torqueNewtonMetres: 72 / 32 });
  });

  it('differences accumulated energy across its uint16 wrap', () => {
    // 65 536 kJ is reached by a long ride at any real power.
    expect(
      accumulate({ torqueRaw: undefined, energyKilojoules: 65_530 }, reading(undefined, 4)),
    ).toMatchObject({ energyKilojoules: 10 });
  });

  it('reports nothing for a field the current frame does not carry', () => {
    expect(
      accumulate({ torqueRaw: 100, energyKilojoules: 20 }, reading(undefined, undefined)),
    ).toEqual({ torqueNewtonMetres: undefined, energyKilojoules: undefined });
  });

  it('reaches a caller through the profile, frame after frame', () => {
    const seen: CyclingPowerAccumulation[] = [];
    const profile = createCyclingPowerProfile({ onAccumulation: (one) => seen.push(one) });
    const reported = recordingSink();
    const frame = (torqueRaw: number, energy: number) =>
      createPayloadWriter().u16(flagsOf(TORQUE, ENERGY)).i16(200).u16(torqueRaw).u16(energy).view();

    profile.decode(frame(65_500, 65_530), reported.sink, unixSeconds(START));
    profile.decode(frame(36, 4), reported.sink, unixSeconds(START + 1));

    expect(seen).toEqual([{ torqueNewtonMetres: 72 / 32, energyKilojoules: 10 }]);
  });
});

describe('the Cycling Power profile', () => {
  const frame = (options: {
    readonly power: number;
    readonly crank?: { readonly revolutions: number; readonly ticks: number };
    readonly wheel?: { readonly revolutions: number; readonly ticks: number };
  }): DataView => {
    const writer = createPayloadWriter().u16(
      flagsOf(
        ...(options.wheel === undefined ? [] : [WHEEL]),
        ...(options.crank === undefined ? [] : [CRANK]),
      ),
    );
    writer.i16(options.power);
    if (options.wheel !== undefined) {
      writer.u32(options.wheel.revolutions).u16(options.wheel.ticks);
    }
    if (options.crank !== undefined) {
      writer.u16(options.crank.revolutions).u16(options.crank.ticks);
    }
    return writer.view();
  };

  const run = (
    profile: ReturnType<typeof createCyclingPowerProfile>,
    frames: readonly { readonly view: DataView; readonly at: UnixSeconds }[],
  ): Reported => {
    const reported = recordingSink();
    for (const one of frames) {
      profile.decode(one.view, reported.sink, one.at);
    }
    return reported;
  };

  it('names the service and characteristic the SIG assigned', () => {
    const profile = createCyclingPowerProfile();

    expect(profile.service).toBe(CYCLING_POWER_SERVICE);
    expect(profile.characteristic).toBe(CYCLING_POWER_MEASUREMENT);
  });

  it('reports power from every frame, including the first', () => {
    const reported = run(createCyclingPowerProfile(), [
      { view: frame({ power: 210 }), at: unixSeconds(START) },
      { view: frame({ power: 215 }), at: unixSeconds(START + 1) },
    ]);

    expect(reported.powers).toEqual([210, 215]);
  });

  it('derives cadence across a crank event-time wrap, reusing #41’s derivation', () => {
    // #42's fourth criterion, reworded by revision 2 of #1: reuse the
    // derivation *parameterised by tick rate*, not the tick rate itself. The
    // CPS crank clock is 1/1024 s, like CSC's.
    const reported = run(createCyclingPowerProfile(), [
      {
        view: frame({ power: 250, crank: { revolutions: 200, ticks: 65_100 } }),
        at: unixSeconds(START),
      },
      {
        view: frame({ power: 250, crank: { revolutions: 202, ticks: 508 } }),
        at: unixSeconds(START + 1),
      },
    ]);

    const expected = (2 / ((508 - 65_100 + 65_536) / 1024)) * 60;
    expect(reported.cadences).toHaveLength(1);
    expect(reported.cadences[0]).toBeCloseTo(expected, 9);
    expect(reported.cadences[0]).toBeGreaterThan(0);
  });

  it('reads the wheel event time at 1/2048 s, not at 1/1024 s', () => {
    // The correction revision 2 of #1 made, and the one that would otherwise
    // ship: the CPS wheel clock is 1/2048 s while the crank clock one field
    // away is 1/1024 s. Reading 1024 here halves every reported speed.
    const reported = run(createCyclingPowerProfile({ wheelCircumference: WHEEL_700_25C }), [
      {
        view: frame({ power: 250, wheel: { revolutions: 1000, ticks: 0 } }),
        at: unixSeconds(START),
      },
      {
        // 2048 ticks at 2048 Hz is one second. At 1024 Hz it would be two,
        // and the speed would be half.
        view: frame({ power: 250, wheel: { revolutions: 1010, ticks: 2048 } }),
        at: unixSeconds(START + 1),
      },
    ]);

    expect(reported.speeds).toEqual([10 * 2.105]);
  });

  it('declares no speed capability, and reports none, without a wheel circumference', () => {
    const profile = createCyclingPowerProfile();
    const reported = run(profile, [
      {
        view: frame({ power: 250, wheel: { revolutions: 1000, ticks: 0 } }),
        at: unixSeconds(START),
      },
      {
        view: frame({ power: 250, wheel: { revolutions: 1010, ticks: 2048 } }),
        at: unixSeconds(START + 1),
      },
    ]);

    expect(profile.capabilities).toEqual(['power', 'cadence']);
    expect(reported.speeds).toEqual([]);
  });

  it('declares speed when it has a circumference to use', () => {
    expect(createCyclingPowerProfile({ wheelCircumference: WHEEL_700_25C }).capabilities).toEqual([
      'power',
      'cadence',
      'speed',
    ]);
  });

  it('reports nothing at all from a frame it could not decode', () => {
    // Power is mandatory and comes first, so the tempting implementation
    // reports it and then fails on the crank field. It must not: the
    // truncation means the offsets are not what they were read as.
    const reported = recordingSink();
    const truncated = createPayloadWriter().u16(flagsOf(CRANK)).i16(250).u16(300).view();

    expect(() =>
      createCyclingPowerProfile().decode(truncated, reported.sink, unixSeconds(START)),
    ).toThrow();
    expect(reported.powers).toEqual([]);
  });

  it('keeps a separate accumulator per sink', () => {
    const profile = createCyclingPowerProfile();
    const first = recordingSink();
    const second = recordingSink();

    profile.decode(
      frame({ power: 200, crank: { revolutions: 100, ticks: 0 } }),
      first.sink,
      unixSeconds(START),
    );
    profile.decode(
      frame({ power: 200, crank: { revolutions: 900, ticks: 40_000 } }),
      second.sink,
      unixSeconds(START),
    );
    profile.decode(
      frame({ power: 200, crank: { revolutions: 101, ticks: 1024 } }),
      first.sink,
      unixSeconds(START + 1),
    );

    expect(first.cadences).toEqual([60]);
    expect(second.cadences).toEqual([]);
  });
});
