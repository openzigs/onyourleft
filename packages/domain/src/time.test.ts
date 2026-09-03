// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  eventTimeAmbiguityHorizonSeconds,
  eventTimeIntervalIsAmbiguous,
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
    expect(eventTimeIntervalSeconds(0, 1024, EVENT_TICKS_PER_SECOND_1024)).toBe(1);
    expect(eventTimeIntervalSeconds(1000, 1512, EVENT_TICKS_PER_SECOND_1024)).toBe(0.5);
  });

  it('takes the tick rate as an argument — the same ticks are half the time at 1/2048 s', () => {
    // The CPS wheel event time is 1/2048 s while its crank event time, one
    // field away in the same packet, is 1/1024 s. Hard-coding either halves or
    // doubles the result.
    expect(eventTimeIntervalSeconds(0, 1024, EVENT_TICKS_PER_SECOND_2048)).toBe(0.5);
    expect(eventTimeIntervalSeconds(0, 1024, EVENT_TICKS_PER_SECOND_1024)).toBe(1);
  });

  it('handles a wrap: 65000 -> 100 is 636 ticks, not -64900', () => {
    expect(eventTimeIntervalSeconds(65000, 100, EVENT_TICKS_PER_SECOND_1024)).toBe(636 / 1024);
    expect(eventTimeIntervalSeconds(65000, 100, EVENT_TICKS_PER_SECOND_1024)).toBeGreaterThan(0);
  });

  it('handles a wrap that lands exactly on zero', () => {
    expect(eventTimeIntervalSeconds(65535, 0, EVENT_TICKS_PER_SECOND_1024)).toBe(1 / 1024);
  });

  it('rejects a reading outside a uint16', () => {
    expect(() => eventTimeIntervalSeconds(0, 65536, EVENT_TICKS_PER_SECOND_1024)).toThrow(
      UnitError,
    );
  });

  it('rejects a tick rate of zero rather than dividing by it', () => {
    expect(() => eventTimeIntervalSeconds(0, 1024, 0)).toThrow(UnitError);
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
    expect(eventTimeIntervalSeconds(previous, short, EVENT_TICKS_PER_SECOND_1024)).toBe(
      eventTimeIntervalSeconds(previous, long, EVENT_TICKS_PER_SECOND_1024),
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
