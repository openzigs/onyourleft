// SPDX-License-Identifier: Apache-2.0

/**
 * The wrapping revolution counters CSC and Cycling Power sensors report, and the
 * client-side arithmetic that turns two readings into a cadence.
 *
 * ## Both halves live here on purpose
 *
 * A real sensor transmits a cumulative revolution count and the event time of
 * the last revolution, both as free-running unsigned integers that lap. A real
 * client differences two readings — with the modulus, or it produces a negative
 * interval roughly once a minute. The simulator plays both roles: the device
 * half (`createRevolutionCounter`) produces readings that lap exactly as the
 * profile says, and the client half (`deriveCadence`) reads them the way #41
 * and #42 will have to, using `@onyourleft/domain`'s wrap-aware arithmetic and
 * its ambiguity horizon. A wrap that the device half performs and the client
 * half survives is a wrap that has been **watched to fire**, which is what #44
 * asks for.
 *
 * Wire counters stay `number` here — a tick count and a revolution count are
 * dimensionless, and `@onyourleft/domain` has no brand for them. They do not
 * cross the `SensorTransport` boundary: what leaves this file towards a
 * subscriber is a `RevolutionsPerMinute`.
 */

import {
  eventTimeIntervalIsAmbiguous,
  eventTimeIntervalSeconds,
  revolutionsPerMinute,
  seconds,
  UINT16_MODULUS,
  unsignedCounterDelta,
  type RevolutionsPerMinute,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';

/** One reading of a revolution counter, as the profile transmits it. */
export interface RevolutionReading {
  /** Cumulative revolutions, modulo the field's width. */
  readonly revolutions: number;
  /** Time of the last revolution in ticks, modulo 2^16. */
  readonly lastEventTimeTicks: number;
}

/** The device half. */
export interface RevolutionCounter {
  /** What the sensor would put in its next notification. */
  reading(): RevolutionReading;
  /** Turn the crank (or the wheel) at `rate` for `duration`. */
  advance(rate: RevolutionsPerMinute, duration: Seconds): void;
  /**
   * Put both counters just below their modulus, so they lap within the next
   * two seconds at 60 rpm or more.
   *
   * Meant to be armed before the client sees a reading — a sensor's counters
   * hold whatever they reached since power-on, so "nearly wrapped" is an
   * ordinary starting point. Arming under a live client is a counter teleport
   * no real sensor performs, and the client half will report it faithfully as
   * an enormous delta.
   */
  armWrap(): void;
}

/** How far below the wrap `armWrap` leaves the revolution count. */
const ARMED_REVOLUTIONS_BEFORE_WRAP = 2;
/** How far below the wrap `armWrap` leaves the event time, in ticks (~1.5 s at 1024 Hz). */
const ARMED_TICKS_BEFORE_WRAP = 1500;

export function createRevolutionCounter(options: {
  /** 2^16 for a crank or CPS wheel count, 2^32 for a CSC wheel count. */
  readonly revolutionModulus: number;
  /** 1024 for CSC and the CPS crank, 2048 for the CPS wheel. */
  readonly ticksPerSecond: number;
}): RevolutionCounter {
  // Device-side truth, unbounded. The modulus is applied only at `reading()`,
  // which is where the wire format applies it too.
  let elapsed = 0;
  let completed = 0;
  let lastEventSeconds = 0;
  // `armWrap` shifts the reported values rather than the truth, so the rate
  // arithmetic above is untouched by it.
  let revolutionOffset = 0;
  let tickOffset = 0;

  const reading = (): RevolutionReading => ({
    revolutions: (Math.floor(completed) + revolutionOffset) % options.revolutionModulus,
    lastEventTimeTicks:
      (Math.round(lastEventSeconds * options.ticksPerSecond) + tickOffset) % UINT16_MODULUS,
  });

  return {
    reading,

    advance(rate, duration) {
      const before = Math.floor(completed);
      elapsed += duration;
      completed += (rate / 60) * duration;
      const after = Math.floor(completed);
      if (after > before) {
        // The most recent whole revolution finished this long before now,
        // assuming a steady rate within the step — which at 1 Hz it is.
        lastEventSeconds = elapsed - (completed - after) * (60 / rate);
      }
    },

    armWrap() {
      const current = reading();
      const targetRevolutions = options.revolutionModulus - ARMED_REVOLUTIONS_BEFORE_WRAP;
      const targetTicks = UINT16_MODULUS - 1 - ARMED_TICKS_BEFORE_WRAP;
      revolutionOffset =
        (revolutionOffset + targetRevolutions - current.revolutions + options.revolutionModulus) %
        options.revolutionModulus;
      tickOffset =
        (tickOffset + targetTicks - current.lastEventTimeTicks + UINT16_MODULUS) % UINT16_MODULUS;
    },
  };
}

/** A reading, and when the client received it. */
export interface TimedReading {
  readonly reading: RevolutionReading;
  readonly at: UnixSeconds;
}

/** What the client half concluded from a new reading. */
export interface CadenceDerivation {
  /** A cadence to emit, or nothing — see `deriveCadence` for the three reasons. */
  readonly cadence: RevolutionsPerMinute | undefined;
  /** What the client should hold as "previous" for the next reading. */
  readonly next: TimedReading;
}

/**
 * The client half: two readings in, at most one cadence out.
 *
 * Emits nothing in three cases, each deliberate, **checked in this order**:
 *
 * - **No previous reading.** A rate needs an interval.
 * - **No new revolution.** A stopped crank is "no reading", not zero and not
 *   the last value; the previous reading is kept so the interval keeps
 *   accumulating until a revolution arrives.
 * - **Too much real time has passed since the last reading that carried an
 *   event.** Beyond the counter's period (64 s at 1024 Hz) the interval is
 *   unrecoverable — `eventTimeIntervalSeconds` documents why — so the sample is
 *   dropped and the accumulator restarts from this reading. Trusting it would
 *   report about a thousand rpm after a 70-second dropout.
 *
 * The order is load-bearing, and it was found by a test going red. With the
 * horizon checked before the revolution delta, a crank that stops for longer
 * than a period trips the horizon on a reading that carries **no** event, the
 * accumulator restarts from that reading's stale event time, and the first
 * turn of the crank afterwards produces an interval of a few seconds against a
 * truth of seventy — about 9 rpm, plausible and wrong. Only a reading that
 * carries a new event can be too old to pair with.
 */
export function deriveCadence(
  previous: TimedReading | undefined,
  current: TimedReading,
  options: { readonly revolutionModulus: number; readonly ticksPerSecond: number },
): CadenceDerivation {
  if (previous === undefined) {
    return { cadence: undefined, next: current };
  }
  const revolutions = unsignedCounterDelta(
    previous.reading.revolutions,
    current.reading.revolutions,
    options.revolutionModulus,
  );
  if (revolutions === 0) {
    return { cadence: undefined, next: previous };
  }
  const elapsed = seconds(current.at - previous.at);
  if (eventTimeIntervalIsAmbiguous(elapsed, options.ticksPerSecond)) {
    return { cadence: undefined, next: current };
  }
  const interval = eventTimeIntervalSeconds(
    previous.reading.lastEventTimeTicks,
    current.reading.lastEventTimeTicks,
    options.ticksPerSecond,
  );
  return {
    cadence: revolutionsPerMinute((revolutions / interval) * 60),
    next: current,
  };
}
