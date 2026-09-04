// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  eventTimeAmbiguityHorizonSeconds,
  eventTimeIntervalIsAmbiguous,
  eventTickRate,
  eventTicks,
  eventTimeIntervalSeconds,
  FIT_EPOCH_UNIX_SECONDS,
  FIT_SYSTEM_TIME_MAX,
  FIT_TIMESTAMP_MAX,
  fitTimestampToUnixSeconds,
  isFitSystemTime,
  seconds,
  UINT16_MODULUS,
  UINT32_MODULUS,
  UnitError,
  unixSeconds,
  unixSecondsToFitTimestamp,
  unsignedCounterDelta,
} from './index';

describe('the FIT epoch is not the Unix epoch', () => {
  it('is 1989-12-31T00:00:00Z: 7304 days after 1970-01-01', () => {
    expect(FIT_EPOCH_UNIX_SECONDS).toBe(7304 * 86400);
    expect(FIT_EPOCH_UNIX_SECONDS).toBe(631065600);
  });

  it('decodes FIT timestamp 0 as the FIT epoch itself, not as 1970', () => {
    expect(fitTimestampToUnixSeconds(0)).toBe(FIT_EPOCH_UNIX_SECONDS);
  });

  it('decodes a 2026 ride as 2026 rather than as 2006', () => {
    // 2026-09-03T00:00:00Z. Read as Unix time the same field would be
    // 2006-08-29 — a date that sorts and charts perfectly well.
    expect(fitTimestampToUnixSeconds(1157328000)).toBe(1788393600);
  });

  it('round-trips an instant through the FIT representation', () => {
    const instant = unixSeconds(1788393600);
    expect(fitTimestampToUnixSeconds(unixSecondsToFitTimestamp(instant))).toBe(1788393600);
  });

  it('encodes the epoch boundary itself as zero', () => {
    expect(unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS))).toBe(0);
  });

  it('rejects the instant one second before the epoch', () => {
    expect(() => unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS - 1))).toThrow(
      UnitError,
    );
  });

  it('rejects the Unix epoch, which is the confusion this conversion exists for', () => {
    expect(() => unixSecondsToFitTimestamp(unixSeconds(0))).toThrow(/before the FIT epoch/);
  });

  it('rejects a fraction of a second before the epoch rather than rounding onto it', () => {
    expect(() => unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS - 0.4))).toThrow(
      UnitError,
    );
  });

  it('rounds a fractional instant to the nearest whole second', () => {
    expect(unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS + 10.4))).toBe(10);
    expect(unixSecondsToFitTimestamp(unixSeconds(FIT_EPOCH_UNIX_SECONDS + 10.6))).toBe(11);
  });

  it('rejects an instant past the end of the uint32 field', () => {
    const past = unixSeconds(FIT_EPOCH_UNIX_SECONDS + FIT_TIMESTAMP_MAX + 1);
    expect(() => unixSecondsToFitTimestamp(past)).toThrow(UnitError);
  });

  it('accepts the largest representable timestamp on both sides', () => {
    const instant = unixSeconds(FIT_EPOCH_UNIX_SECONDS + FIT_TIMESTAMP_MAX);
    expect(unixSecondsToFitTimestamp(instant)).toBe(FIT_TIMESTAMP_MAX);
    expect(fitTimestampToUnixSeconds(FIT_TIMESTAMP_MAX)).toBe(instant);
  });

  it('rejects a negative or oversized FIT timestamp', () => {
    expect(() => fitTimestampToUnixSeconds(-1)).toThrow(UnitError);
    expect(() => fitTimestampToUnixSeconds(FIT_TIMESTAMP_MAX + 1)).toThrow(UnitError);
  });

  it('rejects a fractional FIT timestamp', () => {
    expect(() => fitTimestampToUnixSeconds(1157328000.5)).toThrow(UnitError);
  });
});

describe('FIT system time', () => {
  it('is the range below 0x10000000', () => {
    expect(FIT_SYSTEM_TIME_MAX).toBe(268435455);
    expect(isFitSystemTime(0)).toBe(true);
    expect(isFitSystemTime(FIT_SYSTEM_TIME_MAX)).toBe(true);
  });

  it('stops at 0x10000000, which is mid-1998 — below every real outdoor ride', () => {
    expect(isFitSystemTime(FIT_SYSTEM_TIME_MAX + 1)).toBe(false);
    expect(isFitSystemTime(1157328000)).toBe(false);
  });

  // Regression: isFitSystemTime was the only public function in the package
  // that did not validate. Both of these returned `true` -- an impossible field
  // classified as "system time" rather than rejected, which #30/#31 would have
  // absorbed silently in a decode loop.
  it('rejects a value that is not a valid FIT date_time at all', () => {
    expect(() => isFitSystemTime(-1)).toThrow(UnitError);
    expect(() => isFitSystemTime(0.5)).toThrow(UnitError);
    expect(() => isFitSystemTime(FIT_TIMESTAMP_MAX + 1)).toThrow(UnitError);
  });
});

describe('unsignedCounterDelta', () => {
  it('is the plain difference when the counter has not wrapped', () => {
    expect(unsignedCounterDelta(10, 20, UINT16_MODULUS)).toBe(10);
  });

  it('is zero when the counter has not moved', () => {
    expect(unsignedCounterDelta(1234, 1234, UINT16_MODULUS)).toBe(0);
  });

  it('reads a uint16 wrap as a small forward step, not a large negative one', () => {
    expect(unsignedCounterDelta(65000, 100, UINT16_MODULUS)).toBe(636);
  });

  it('reads a uint32 wrap the same way — a wheel revolution counter', () => {
    expect(unsignedCounterDelta(UINT32_MODULUS - 3, 2, UINT32_MODULUS)).toBe(5);
  });

  it('rejects a reading outside the counter it claims to come from', () => {
    expect(() => unsignedCounterDelta(0, UINT16_MODULUS, UINT16_MODULUS)).toThrow(UnitError);
    expect(() => unsignedCounterDelta(-1, 0, UINT16_MODULUS)).toThrow(UnitError);
  });

  it('rejects a fractional reading', () => {
    expect(() => unsignedCounterDelta(0, 1.5, UINT16_MODULUS)).toThrow(UnitError);
  });
});

describe('event-time intervals', () => {
  it('converts a normal interval at 1/1024 s', () => {
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(0),
        currentTicks: eventTicks(1024),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(1);
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(1000),
        currentTicks: eventTicks(1512),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(0.5);
  });

  it('takes the tick rate as a field — the same ticks are half the time at 1/2048 s', () => {
    // The CPS wheel event time is 1/2048 s while its crank event time, one
    // field away in the same packet, is 1/1024 s. Hard-coding either halves or
    // doubles the result.
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(0),
        currentTicks: eventTicks(1024),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_2048,
      }),
    ).toBe(0.5);
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(0),
        currentTicks: eventTicks(1024),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(1);
  });

  it('handles a wrap: 65000 -> 100 is 636 ticks, not -64900', () => {
    const wrap = eventTimeIntervalSeconds({
      previousTicks: eventTicks(65000),
      currentTicks: eventTicks(100),
      ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
    });
    expect(wrap).toBe(636 / 1024);
    expect(wrap).toBeGreaterThan(0);
  });

  it('handles a wrap that lands exactly on zero', () => {
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(65535),
        currentTicks: eventTicks(0),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(1 / 1024);
  });

  it('rejects a reading outside a uint16', () => {
    expect(() =>
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(0),
        currentTicks: eventTicks(65536),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toThrow(UnitError);
  });

  it('rejects a tick rate of zero rather than dividing by it', () => {
    expect(() =>
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(0),
        currentTicks: eventTicks(1024),
        ticksPerSecond: eventTickRate(0),
      }),
    ).toThrow(UnitError);
  });

  it('labels a counter reading only inside its uint16 range', () => {
    expect(eventTicks(0)).toBe(0);
    expect(eventTicks(65535)).toBe(65535);
    expect(() => eventTicks(65536)).toThrow(UnitError);
    expect(() => eventTicks(-1)).toThrow(UnitError);
    expect(() => eventTicks(1.5)).toThrow(UnitError);
  });

  it('labels a tick rate only as a positive whole number', () => {
    expect(eventTickRate(1024)).toBe(1024);
    expect(() => eventTickRate(0)).toThrow(UnitError);
    expect(() => eventTickRate(-1024)).toThrow(UnitError);
    expect(() => eventTickRate(1024.5)).toThrow(UnitError);
  });

  it('publishes the two rates the profiles use, already labelled', () => {
    expect(EVENT_TICKS_PER_SECOND_1024).toBe(1024);
    expect(EVENT_TICKS_PER_SECOND_2048).toBe(2048);
  });
});

describe('a wrap stays distinguishable from a long interval (#103)', () => {
  // The property #41 and #42 branch on, and the one the three-positional-number
  // signature destroyed: `(1512, 1000, 1024)` returned 63.5 s, which is not
  // absurd — it is a hair under the 64 s ambiguity horizon, so it reads as a
  // bike that has been stopped for a minute rather than as a bug.
  const RATE = EVENT_TICKS_PER_SECOND_1024;

  it('reads a rollover as a short forward step, not as a minute of silence', () => {
    const wrap = eventTimeIntervalSeconds({
      previousTicks: eventTicks(65000),
      currentTicks: eventTicks(100),
      ticksPerSecond: RATE,
    });

    expect(wrap).toBe(636 / 1024);
    expect(eventTimeIntervalIsAmbiguous(wrap, RATE)).toBe(false);
  });

  it('reads the same two values named the other way round as 63.5 s', () => {
    // Not an error and cannot be made one: both fields hold the same kind of
    // value. It is here so the size of the mislabel is on the record.
    const transposed = eventTimeIntervalSeconds({
      previousTicks: eventTicks(100),
      currentTicks: eventTicks(65000),
      ticksPerSecond: RATE,
    });

    expect(transposed).toBe(64900 / 1024);
    expect(transposed).toBeGreaterThan(60);
  });

  it('separates the 0.5 s interval of #103 row 1 from row 3 by two orders of magnitude', () => {
    const correct = eventTimeIntervalSeconds({
      previousTicks: eventTicks(1000),
      currentTicks: eventTicks(1512),
      ticksPerSecond: RATE,
    });
    const rowThree = eventTimeIntervalSeconds({
      previousTicks: eventTicks(1512),
      currentTicks: eventTicks(1000),
      ticksPerSecond: RATE,
    });

    expect(correct).toBe(0.5);
    expect(rowThree).toBe(63.5);
    expect(rowThree / correct).toBe(127);
  });
});

describe('a wrap is NOT distinguishable from a very long interval', () => {
  /** What the sensor transmits after `trueTicks` have elapsed. */
  const asTransmitted = (previous: number, trueTicks: number): number =>
    (previous + trueTicks) % UINT16_MODULUS;

  it('reports the same interval for 636 ticks and for 636 + 65536 ticks', () => {
    const previous = 65000;
    const short = asTransmitted(previous, 636);
    const long = asTransmitted(previous, 636 + UINT16_MODULUS);

    // The two readings are byte-identical, so no implementation of this
    // function could tell them apart. The counter did not carry the difference.
    expect(short).toBe(long);
    expect(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(previous),
        currentTicks: eventTicks(short),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    ).toBe(
      eventTimeIntervalSeconds({
        previousTicks: eventTicks(previous),
        currentTicks: eventTicks(long),
        ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
      }),
    );
  });

  it('publishes the horizon beyond which the reading is a guess', () => {
    expect(eventTimeAmbiguityHorizonSeconds(EVENT_TICKS_PER_SECOND_1024)).toBe(64);
    expect(eventTimeAmbiguityHorizonSeconds(EVENT_TICKS_PER_SECOND_2048)).toBe(32);
  });

  it('tells a consumer when the elapsed real time has passed that horizon', () => {
    expect(eventTimeIntervalIsAmbiguous(seconds(63.9), EVENT_TICKS_PER_SECOND_1024)).toBe(false);
    expect(eventTimeIntervalIsAmbiguous(seconds(64), EVENT_TICKS_PER_SECOND_1024)).toBe(true);
    expect(eventTimeIntervalIsAmbiguous(seconds(64.1), EVENT_TICKS_PER_SECOND_1024)).toBe(true);
  });

  it('puts the horizon at half that for the 1/2048 s counter', () => {
    // 32 s of silence is safe on a 1024 Hz counter and already ambiguous on a
    // 2048 Hz one. A consumer that hard-codes 64 s trusts a lapped counter.
    expect(eventTimeIntervalIsAmbiguous(seconds(32), EVENT_TICKS_PER_SECOND_1024)).toBe(false);
    expect(eventTimeIntervalIsAmbiguous(seconds(32), EVENT_TICKS_PER_SECOND_2048)).toBe(true);
  });

  it('rejects a tick rate it cannot compute a horizon for', () => {
    expect(() => eventTimeAmbiguityHorizonSeconds(0)).toThrow(UnitError);
  });
});
