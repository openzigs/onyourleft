// SPDX-License-Identifier: Apache-2.0

/**
 * Time: the FIT epoch, and the wrapping event-time counters BLE sensors report.
 *
 * Two unrelated hazards live here because both are "a number of seconds that is
 * not a number of seconds".
 *
 * **The FIT epoch is not the Unix epoch.** FIT's `date_time` counts seconds from
 * **1989-12-31T00:00:00Z**, 631 065 600 s after 1970. Treating a FIT timestamp
 * as Unix time dates a 2026 ride to 2006 — a date that sorts, formats and
 * charts perfectly well, and that nobody notices until an athlete looks at a
 * ride list.
 *
 * **Event-time counters wrap.** CSCS and CPS both report the time of the last
 * wheel or crank event as a `uint16` of ticks, and both roll over to zero every
 * 65 536 ticks. Subtracting the previous reading without the modulus yields a
 * large negative interval roughly once a minute, and a cadence computed from it
 * is negative or absurd. See {@link eventTimeIntervalSeconds} for what the
 * modulus can and cannot recover.
 */

import type { Seconds, UnixSeconds } from './quantities';
import { seconds, unixSeconds } from './quantities';
import { assertIntegerInRange, UnitError } from './unit-error';

// --- The FIT epoch ----------------------------------------------------------

/**
 * The FIT epoch, in seconds since the Unix epoch: 1989-12-31T00:00:00Z.
 *
 * Written as a literal rather than computed from `Date.UTC`, because `Date` is
 * a platform-flavoured type this package avoids, and because a constant with
 * its derivation in a test is easier to audit than one derived at load time.
 * 7 304 days from 1970-01-01 to 1989-12-31, times 86 400.
 */
export const FIT_EPOCH_UNIX_SECONDS = 631065600;

/** The largest value FIT's `uint32` `date_time` can hold. */
export const FIT_TIMESTAMP_MAX = 4294967295;

/**
 * The largest `date_time` FIT treats as **system time** rather than as UTC.
 *
 * The FIT profile reserves values below `0x10000000` for seconds since the
 * device powered on, used by a device that has not yet got a clock — typically
 * one recording indoors with no GNSS fix. That threshold is 268 435 456 s after
 * the FIT epoch, which lands in mid-1998, so no real outdoor ride can collide
 * with it.
 *
 * This package does **not** reject such values, because 0 is a legitimate
 * `date_time` meaning the epoch itself and the conversion must stay total. It
 * exposes {@link isFitSystemTime} instead, and the FIT codec (#30, #31) is
 * expected to test it and treat the record's time as relative rather than
 * writing a 1989 date into a ride.
 */
export const FIT_SYSTEM_TIME_MAX = 0x10000000 - 1;

/**
 * True when a FIT `date_time` is in the reserved system-time range and does not
 * denote a UTC instant.
 */
export function isFitSystemTime(fitTimestamp: number): boolean {
  return fitTimestamp <= FIT_SYSTEM_TIME_MAX;
}

/**
 * Convert a FIT `date_time` to an instant.
 *
 * @throws {UnitError} if the value is not a whole number in `[0, 2^32 - 1]`.
 */
export function fitTimestampToUnixSeconds(fitTimestamp: number): UnixSeconds {
  assertIntegerInRange(fitTimestamp, 0, FIT_TIMESTAMP_MAX, 'FIT timestamp');
  return unixSeconds(fitTimestamp + FIT_EPOCH_UNIX_SECONDS);
}

/**
 * Convert an instant to a FIT `date_time`.
 *
 * Rounds to the nearest second, which is the resolution of the field. The
 * range check happens before the rounding, so an instant a fraction of a second
 * before the epoch is rejected rather than rounded up onto it.
 *
 * @throws {UnitError} if the instant is before 1989-12-31T00:00:00Z, or beyond
 * what a `uint32` field can hold. Rejected rather than clamped or wrapped: a
 * negative `date_time` written into an unsigned field reappears as a date sixty
 * years in the future, which is plausible enough to store and impossible to
 * detect afterwards.
 */
export function unixSecondsToFitTimestamp(instant: UnixSeconds): number {
  if (instant < FIT_EPOCH_UNIX_SECONDS) {
    throw new UnitError(
      `instant ${String(instant)} is before the FIT epoch ` +
        `(${String(FIT_EPOCH_UNIX_SECONDS)}, 1989-12-31T00:00:00Z) and has no FIT representation`,
    );
  }
  if (instant > FIT_EPOCH_UNIX_SECONDS + FIT_TIMESTAMP_MAX) {
    throw new UnitError(
      `instant ${String(instant)} is beyond the largest FIT timestamp ` +
        `(${String(FIT_EPOCH_UNIX_SECONDS + FIT_TIMESTAMP_MAX)})`,
    );
  }
  return Math.round(instant - FIT_EPOCH_UNIX_SECONDS);
}

// --- Wrapping counters ------------------------------------------------------

/** The number of distinct values a `uint16` counter takes before it repeats. */
export const UINT16_MODULUS = 65536;

/** The number of distinct values a `uint32` counter takes before it repeats. */
export const UINT32_MODULUS = 4294967296;

/**
 * The tick rate of the CSCS wheel and crank event times, and of the CPS **crank**
 * event time: 1/1024 s.
 */
export const EVENT_TICKS_PER_SECOND_1024 = 1024;

/**
 * The tick rate of the CPS **wheel** event time: 1/2048 s.
 *
 * The same profile uses two different rates for its two event times, one field
 * apart in the same packet. Hard-coding 1024 for both halves the wheel speed,
 * which is why every function here takes the rate as an argument instead.
 */
export const EVENT_TICKS_PER_SECOND_2048 = 2048;

/**
 * The forward distance between two readings of a free-running unsigned counter.
 *
 * The primitive under every rollover in this program: `uint16` event times,
 * `uint16` crank revolutions, `uint32` wheel revolutions. Always in
 * `[0, modulus)`, so a wrap reads as a small positive step rather than a large
 * negative one.
 *
 * @throws {UnitError} if either reading is not a whole number inside the
 * counter's range, or if the modulus is not a positive whole number.
 */
export function unsignedCounterDelta(previous: number, current: number, modulus: number): number {
  assertIntegerInRange(modulus, 1, Number.MAX_SAFE_INTEGER, 'counter modulus');
  assertIntegerInRange(previous, 0, modulus - 1, 'previous counter reading');
  assertIntegerInRange(current, 0, modulus - 1, 'current counter reading');
  return (current - previous + modulus) % modulus;
}

/**
 * The interval between two `uint16` event-time readings, in seconds.
 *
 * ## What the wrap handling recovers, and what it cannot
 *
 * The counter is 16 bits, so it carries the true elapsed time only modulo
 * 65 536 ticks — 64 s at 1024 Hz, 32 s at 2048 Hz. Within one period the
 * modulus recovers the interval exactly, including across a rollover: a step
 * from 65 000 to 100 is 636 ticks and not -64 900.
 *
 * **Beyond one period it is not recoverable, and this function cannot tell you
 * that it happened.** An interval of 636 ticks and an interval of 66 172 ticks
 * produce byte-identical readings; no amount of arithmetic separates them,
 * because the sensor did not transmit the difference. A test in `time.test.ts`
 * asserts exactly this, so the limitation is pinned rather than assumed.
 *
 * **What the consumer must do** (#41, #42): keep the wall-clock time at which
 * each notification arrived, and before trusting an interval, check it with
 * {@link eventTimeIntervalIsAmbiguous}. When it is ambiguous, drop the sample
 * and restart the accumulator rather than emitting a cadence — a sensor that
 * has been idle longer than a period is a stopped bike, and the honest output
 * is "no reading" rather than a number derived from a counter that lapped an
 * unknown number of times.
 *
 * @throws {UnitError} if either reading is not a whole number in `[0, 65535]`,
 * or the tick rate is not a positive whole number.
 */
export function eventTimeIntervalSeconds(
  previousTicks: number,
  currentTicks: number,
  ticksPerSecond: number,
): Seconds {
  assertIntegerInRange(ticksPerSecond, 1, Number.MAX_SAFE_INTEGER, 'event tick rate');
  const delta = unsignedCounterDelta(previousTicks, currentTicks, UINT16_MODULUS);
  return seconds(delta / ticksPerSecond);
}

/**
 * How long a `uint16` event-time counter takes to lap: 64 s at 1024 Hz, 32 s at
 * 2048 Hz.
 *
 * The horizon beyond which {@link eventTimeIntervalSeconds} is guessing.
 *
 * @throws {UnitError} if the tick rate is not a positive whole number.
 */
export function eventTimeAmbiguityHorizonSeconds(ticksPerSecond: number): Seconds {
  assertIntegerInRange(ticksPerSecond, 1, Number.MAX_SAFE_INTEGER, 'event tick rate');
  return seconds(UINT16_MODULUS / ticksPerSecond);
}

/**
 * True when so much real time has passed between two notifications that the
 * event-time interval between them cannot be trusted.
 *
 * The comparison is inclusive: at exactly one full period the counter reads the
 * same value it did before, which is indistinguishable from no event at all.
 *
 * @param elapsedRealSeconds - wall-clock seconds between the two notifications,
 * measured by the caller. This package cannot measure it: a clock is a platform
 * API and `packages/domain` has none.
 * @throws {UnitError} if the tick rate is not a positive whole number.
 */
export function eventTimeIntervalIsAmbiguous(
  elapsedRealSeconds: Seconds,
  ticksPerSecond: number,
): boolean {
  return elapsedRealSeconds >= eventTimeAmbiguityHorizonSeconds(ticksPerSecond);
}
