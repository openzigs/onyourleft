// SPDX-License-Identifier: Apache-2.0

/**
 * The Cycling Speed and Cadence client, from captured byte arrays with no
 * hardware attached.
 *
 * #41 names one criterion as the most important in the issue:
 *
 * > A test proves cadence derivation is correct **across a crank event-time
 * > wrap**, producing a continuous value rather than a spike or a negative.
 *
 * Revision 2 of #1 then re-weighted the matrix, and this file follows that
 * weighting: the **event time** wrap at ~64 s is the one that happens on every
 * ride and gets the most cases; the `uint16` crank revolution wrap at ~12 h is
 * real and gets one; the `uint32` wheel revolution wrap effectively never
 * happens and gets one anyway, because "effectively never" is not "never" and
 * the modulus is a parameter that could be written wrongly.
 */

import { describe, expect, it, vi } from 'vitest';

import { metres, unixSeconds, type UnixSeconds } from '@onyourleft/domain';

import { isSensorError } from '../../src/errors';

import {
  createCyclingSpeedCadenceProfile,
  CSC_MEASUREMENT,
  CYCLING_SPEED_CADENCE_SERVICE,
  decodeCscFeature,
  decodeCscMeasurement,
} from './cycling-speed-cadence';
import type { MeasurementSink } from './profile';
import { createPayloadWriter, flagsOf } from './testing';

/** CSC Measurement flag bit indices. */
const WHEEL = 0;
const CRANK = 1;

/** A 700×25c wheel, and a 650b one, so "two values" is two real wheels. */
const WHEEL_700_25C = metres(2.105);
const WHEEL_650B = metres(2.02);

const START = 1_800_000_000;

function cscFrame(options: {
  readonly wheel?: { readonly revolutions: number; readonly ticks: number };
  readonly crank?: { readonly revolutions: number; readonly ticks: number };
}): DataView {
  const writer = createPayloadWriter().u8(
    flagsOf(
      ...(options.wheel === undefined ? [] : [WHEEL]),
      ...(options.crank === undefined ? [] : [CRANK]),
    ),
  );
  if (options.wheel !== undefined) {
    writer.u32(options.wheel.revolutions).u16(options.wheel.ticks);
  }
  if (options.crank !== undefined) {
    writer.u16(options.crank.revolutions).u16(options.crank.ticks);
  }
  return writer.view();
}

interface Reported {
  readonly sink: MeasurementSink;
  readonly cadences: number[];
  readonly speeds: number[];
}

function recordingSink(): Reported {
  const cadences: number[] = [];
  const speeds: number[] = [];
  return {
    sink: {
      power: vi.fn(),
      cadence: (value) => cadences.push(value),
      'heart-rate': vi.fn(),
      speed: (value) => speeds.push(value),
    },
    cadences,
    speeds,
  };
}

/** Feed a sequence of frames through one profile on one link. */
function run(
  profile: ReturnType<typeof createCyclingSpeedCadenceProfile>,
  frames: readonly { readonly view: DataView; readonly at: UnixSeconds }[],
): Reported {
  const reported = recordingSink();
  for (const frame of frames) {
    profile.decode(frame.view, reported.sink, frame.at);
  }
  return reported;
}

describe('decoding a CSC Measurement', () => {
  it('reads wheel data alone', () => {
    expect(decodeCscMeasurement(cscFrame({ wheel: { revolutions: 4000, ticks: 2048 } }))).toEqual({
      wheel: { revolutions: 4000, lastEventTimeTicks: 2048 },
      crank: undefined,
    });
  });

  it('reads crank data alone, from the offset a crank-only sensor puts it at', () => {
    // The offset the crank counter sits at depends on whether wheel data
    // precedes it. A decoder that indexed rather than walked would read a
    // crank-only packet's revolutions out of the flags octet and one beyond.
    expect(decodeCscMeasurement(cscFrame({ crank: { revolutions: 900, ticks: 512 } }))).toEqual({
      wheel: undefined,
      crank: { revolutions: 900, lastEventTimeTicks: 512 },
    });
  });

  it('reads both, wheel first', () => {
    const view = cscFrame({
      wheel: { revolutions: 4_000_000, ticks: 100 },
      crank: { revolutions: 900, ticks: 200 },
    });

    expect(decodeCscMeasurement(view)).toEqual({
      wheel: { revolutions: 4_000_000, lastEventTimeTicks: 100 },
      crank: { revolutions: 900, lastEventTimeTicks: 200 },
    });
  });

  it('refuses a packet whose flags claim a field it does not carry', () => {
    // The obvious attack on a flags-gated payload, and the obvious bug.
    const truncated = createPayloadWriter().u8(flagsOf(WHEEL, CRANK)).u32(10).u16(20).view();

    let thrown: unknown;
    try {
      decodeCscMeasurement(truncated);
    } catch (error) {
      thrown = error;
    }
    expect(isSensorError(thrown, 'malformed-payload')).toBe(true);
  });

  it('refuses an empty payload', () => {
    expect(() => decodeCscMeasurement(createPayloadWriter().view())).toThrow();
  });
});

describe('deriving cadence', () => {
  const profile = () => createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C });

  it('reports nothing from the first notification', () => {
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1024 } }), at: unixSeconds(START) },
    ]);

    expect(reported.cadences).toEqual([]);
  });

  it('reports 90 rpm for three revolutions in two seconds', () => {
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1024 } }), at: unixSeconds(START) },
      {
        view: cscFrame({ crank: { revolutions: 103, ticks: 1024 + 2048 } }),
        at: unixSeconds(START + 2),
      },
    ]);

    expect(reported.cadences).toEqual([90]);
  });

  it('is continuous across an event-time wrap — the ~64 s case, on every ride', () => {
    // 65 100 → 508 is a step of 508 - 65 100 + 65 536 = 944 ticks ≈ 0.92 s.
    // A naive subtraction is -64 592 ticks: either a negative cadence or,
    // once someone adds an `abs`, an enormous positive one. Exactly once per
    // wrap, which is often enough for every rider to see and rare enough to
    // survive a short manual test.
    const before = 65_100;
    const after = 508;
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 200, ticks: before } }), at: unixSeconds(START) },
      {
        view: cscFrame({ crank: { revolutions: 202, ticks: after } }),
        at: unixSeconds(START + 1),
      },
    ]);

    const expected = (2 / ((after - before + 65_536) / 1024)) * 60;
    expect(reported.cadences).toHaveLength(1);
    expect(reported.cadences[0]).toBeCloseTo(expected, 9);
    // The properties that matter more than the exact figure: a real cadence,
    // not a negative and not a spike.
    expect(reported.cadences[0]).toBeGreaterThan(100);
    expect(reported.cadences[0]).toBeLessThan(140);
  });

  it('is continuous across the uint16 crank revolution wrap — the ~12 h case', () => {
    // 65 535 → 1 is two revolutions, not -65 534. At 90 rpm this is reached
    // after about twelve hours: rare, real, and a stage race is longer.
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 65_535, ticks: 1000 } }), at: unixSeconds(START) },
      {
        view: cscFrame({ crank: { revolutions: 1, ticks: 1000 + 1365 } }),
        at: unixSeconds(START + 1),
      },
    ]);

    expect(reported.cadences).toHaveLength(1);
    expect(reported.cadences[0]).toBeCloseTo((2 / (1365 / 1024)) * 60, 6);
  });

  it('reports nothing INSIDE the coast horizon rather than dividing by zero', () => {
    // #41: no change in revolutions must produce neither a division by zero
    // nor a retained stale value. Inside the five-second horizon it produces no
    // reading, and the previous reading is kept so the interval keeps
    // accumulating; past the horizon it produces a nought — the test below.
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1024 } }), at: unixSeconds(START) },
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1024 } }), at: unixSeconds(START + 1) },
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1024 } }), at: unixSeconds(START + 2) },
    ]);

    expect(reported.cadences).toEqual([]);
  });

  it('measures a coast from before it, so a long one is seen to be too long', () => {
    // The accumulator is kept across the frames that carried no event, and
    // this is the case that proves it. A coasting sensor repeats the same
    // reading, so at short gaps "kept the old one" and "restarted from the
    // identical new one" are indistinguishable — a shorter version of this
    // test was written first and mutation showed it could not fail.
    //
    // Past one counter period they diverge. Keeping the reading from before
    // the coast makes the elapsed time 65 s, over the 64 s horizon, so the
    // first turn of the crank is honestly dropped. Restarting on every frame
    // makes it 1 s, and the modular event-time delta then yields a plausible
    // cadence for a bike that has been stationary for over a minute.
    const coasting = Array.from({ length: 65 }, (_unused, second) => ({
      view: cscFrame({ crank: { revolutions: 100, ticks: 0 } }),
      at: unixSeconds(START + second),
    }));

    const reported = run(profile(), [
      ...coasting,
      { view: cscFrame({ crank: { revolutions: 101, ticks: 1024 } }), at: unixSeconds(START + 65) },
    ]);

    // Every frame from the fifth second to the sixty-fourth reports a nought —
    // sixty of them, which is #41's coasting criterion. What the reference
    // being kept buys is the *absence* of a sixty-first reading: the turn of
    // the crank at 65 s is 65 s after the last event, past the counter's
    // period, and is honestly dropped rather than reported as about 8 rpm.
    expect(reported.cadences).toEqual(Array.from({ length: 60 }, () => 0));
  });

  it('drops a sample whose event-time interval is beyond the counter’s period', () => {
    // Past 64 s at 1024 Hz the counter may have lapped any number of times and
    // the sensor did not transmit the difference. Reporting the modular answer
    // would put about a thousand rpm on the screen after a dropout.
    const reported = run(profile(), [
      { view: cscFrame({ crank: { revolutions: 100, ticks: 1000 } }), at: unixSeconds(START) },
      {
        view: cscFrame({ crank: { revolutions: 200, ticks: 1512 } }),
        at: unixSeconds(START + 70),
      },
    ]);

    expect(reported.cadences).toEqual([]);
  });
});

describe('deriving speed', () => {
  it('uses the configured wheel circumference, and two wheels give two speeds', () => {
    // #41: "a test proves speed derivation uses configured wheel
    // circumference, with at least two values". A default of 700×25c would
    // misreport a 650b rider's distance by four percent for a whole ride.
    const frames = [
      { view: cscFrame({ wheel: { revolutions: 1000, ticks: 0 } }), at: unixSeconds(START) },
      { view: cscFrame({ wheel: { revolutions: 1010, ticks: 1024 } }), at: unixSeconds(START + 1) },
    ];

    const road = run(
      createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C }),
      frames,
    );
    const gravel = run(
      createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_650B }),
      frames,
    );

    expect(road.speeds).toEqual([10 * 2.105]);
    expect(gravel.speeds).toEqual([10 * 2.02]);
  });

  it('is continuous across the uint32 wheel revolution wrap', () => {
    const reported = run(createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C }), [
      {
        view: cscFrame({ wheel: { revolutions: 4_294_967_290, ticks: 0 } }),
        at: unixSeconds(START),
      },
      {
        view: cscFrame({ wheel: { revolutions: 4, ticks: 1024 } }),
        at: unixSeconds(START + 1),
      },
    ]);

    // 4 - 4 294 967 290 + 2^32 = 10 revolutions, not a negative.
    expect(reported.speeds).toEqual([10 * 2.105]);
  });

  it('uses the wheel event time for speed and the crank event time for cadence', () => {
    // Both are 1/1024 s in CSC, but they are separate counters: a decoder that
    // differenced the crank clock against the wheel counter would produce a
    // plausible wrong speed whenever the two clocks disagreed.
    const reported = run(createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C }), [
      {
        view: cscFrame({
          wheel: { revolutions: 1000, ticks: 0 },
          crank: { revolutions: 100, ticks: 0 },
        }),
        at: unixSeconds(START),
      },
      {
        view: cscFrame({
          // The wheel turned ten times in one second, the crank twice in two.
          wheel: { revolutions: 1010, ticks: 1024 },
          crank: { revolutions: 102, ticks: 2048 },
        }),
        at: unixSeconds(START + 1),
      },
    ]);

    expect(reported.speeds).toEqual([10 * 2.105]);
    expect(reported.cadences).toEqual([60]);
  });
});

describe('one profile object, many links', () => {
  it('keeps a separate accumulator per sink, so two sensors never mix counters', () => {
    // `createWebBluetoothTransport` canonicalises the profile array once, so
    // every device on a transport decodes through the same object. A profile
    // that closed over one `previous` would difference an athlete's speed
    // sensor against their cadence sensor, and no single-device test fails.
    const profile = createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C });
    const first = recordingSink();
    const second = recordingSink();

    profile.decode(
      cscFrame({ crank: { revolutions: 100, ticks: 0 } }),
      first.sink,
      unixSeconds(START),
    );
    profile.decode(
      cscFrame({ crank: { revolutions: 900, ticks: 40_000 } }),
      second.sink,
      unixSeconds(START),
    );
    profile.decode(
      cscFrame({ crank: { revolutions: 101, ticks: 1024 } }),
      first.sink,
      unixSeconds(START + 1),
    );

    expect(first.cadences).toEqual([60]);
    expect(second.cadences).toEqual([]);
  });
});

describe('the CSC Feature characteristic', () => {
  it('describes what the sensor can report, rather than what one frame carried', () => {
    // A combined unit that happens to send a crank-only frame while the wheel
    // is still is not a cadence-only sensor.
    expect(decodeCscFeature(createPayloadWriter().u16(flagsOf(0, 1)).view())).toEqual({
      wheelRevolutionData: true,
      crankRevolutionData: true,
      multipleSensorLocations: false,
    });
    expect(decodeCscFeature(createPayloadWriter().u16(flagsOf(1, 2)).view())).toEqual({
      wheelRevolutionData: false,
      crankRevolutionData: true,
      multipleSensorLocations: true,
    });
  });

  it('refuses a feature characteristic that is too short', () => {
    expect(() => decodeCscFeature(createPayloadWriter().u8(1).view())).toThrow();
  });
});

describe('the CSC profile’s registration', () => {
  it('names the service and characteristic the SIG assigned', () => {
    const profile = createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C });

    expect(profile.service).toBe(CYCLING_SPEED_CADENCE_SERVICE);
    expect(profile.characteristic).toBe(CSC_MEASUREMENT);
    expect(profile.capabilities).toEqual(['speed', 'cadence']);
  });
});
