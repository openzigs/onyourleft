// SPDX-License-Identifier: Apache-2.0

/**
 * The client-side arithmetic that turns two readings of a wrapping revolution
 * counter into a cadence or a speed.
 *
 * ## Why this is here rather than in each profile
 *
 * Three unrelated GATT characteristics report the same shape — a cumulative
 * revolution count and the event time of the last revolution, both free-running
 * unsigned integers that lap — and every one of them needs the same
 * differencing with the modulus, or it produces a negative interval roughly
 * once a minute. CSC Measurement carries two such counters, Cycling Power
 * Measurement carries two more, and `simulator/counters.ts` plays the device
 * half of both. Writing the arithmetic once is what stops the four of them
 * disagreeing.
 *
 * **This file was `simulator/counters.ts` until #41 and #42.** It moved out of
 * the simulator directory when it acquired a production consumer; `counters.ts`
 * re-exports it, so `@onyourleft/sensors/simulator` is unchanged.
 *
 * ## Nothing here is specific to a wire format
 *
 * The modulus and the tick rate are **parameters**, never constants. Revision 2
 * of #1 is emphatic about why: CSC reports both its event times at 1/1024 s,
 * Cycling Power reports its **wheel** event time at 1/2048 s and its **crank**
 * event time at 1/1024 s — one field apart in the same packet — and the
 * revolution counters are `uint32` for a CSC wheel and `uint16` for everything
 * else. A helper that hard-coded either would halve a speed or wrap a counter
 * twelve hours early, and both are the kind of wrong that looks plausible.
 *
 * Wire counters stay `number` here — a tick count and a revolution count are
 * dimensionless, and `@onyourleft/domain` has no brand for them. What leaves
 * this file towards a subscriber is a `RevolutionsPerMinute` or a
 * `MetresPerSecond`.
 */

import {
  eventTickRate,
  eventTicks,
  eventTimeIntervalIsAmbiguous,
  eventTimeIntervalSeconds,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  // @onyourleft/domain's, and the only wrapping subtraction in this program.
  unsignedCounterDelta,
  type Metres,
  type MetresPerSecond,
  type RevolutionsPerMinute,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';

/** One reading of a revolution counter, as a profile transmits it. */
export interface RevolutionReading {
  /** Cumulative revolutions, modulo the field's width. */
  readonly revolutions: number;
  /** Time of the last revolution in ticks, modulo 2^16. */
  readonly lastEventTimeTicks: number;
}

/** A reading, and when the client received it. */
export interface TimedReading {
  readonly reading: RevolutionReading;
  readonly at: UnixSeconds;
}

/** Which counter is being differenced: its width, and the rate its clock ticks at. */
export interface CounterShape {
  /** 2^16 for a crank or a Cycling Power wheel count, 2^32 for a CSC wheel count. */
  readonly revolutionModulus: number;
  /** 1024 for CSC and the Cycling Power crank, 2048 for the Cycling Power wheel. */
  readonly ticksPerSecond: number;
}

/** The turning between two readings, when there was any that could be trusted. */
export interface RevolutionInterval {
  /** Whole revolutions completed, wrap-corrected. Always at least one. */
  readonly revolutions: number;
  /** How long they took, from the sensor's own event clock. */
  readonly elapsed: Seconds;
}

/** What the client concluded from a new reading. */
export interface RevolutionDerivation {
  /** The turning to report, or nothing — see {@link deriveRevolutionInterval}. */
  readonly interval: RevolutionInterval | undefined;
  /** What the client should hold as "previous" for the next reading. */
  readonly next: TimedReading;
}

/**
 * Two readings in, at most one interval out.
 *
 * Reports nothing in three cases, each deliberate, **checked in this order**:
 *
 * - **No previous reading.** A rate needs an interval.
 * - **No new revolution.** A stopped crank is "no reading", not zero and not
 *   the last value; the previous reading is kept so the interval keeps
 *   accumulating until a revolution arrives.
 * - **Too much real time has passed since the last reading that carried an
 *   event.** Beyond the counter's period (64 s at 1024 Hz, 32 s at 2048 Hz) the
 *   interval is unrecoverable — `eventTimeIntervalSeconds` documents why — so
 *   the sample is dropped and the accumulator restarts from this reading.
 *   Trusting it would report about a thousand rpm after a 70-second dropout.
 *
 * The order is load-bearing, and it was found by a test going red. With the
 * horizon checked before the revolution delta, a crank that stops for longer
 * than a period trips the horizon on a reading that carries **no** event, the
 * accumulator restarts from that reading's stale event time, and the first turn
 * of the crank afterwards produces an interval of a few seconds against a truth
 * of seventy — about 9 rpm, plausible and wrong. Only a reading that carries a
 * new event can be too old to pair with.
 *
 * @throws {UnitError} if either reading is outside its counter's range — which
 * is a decode fault, and is why `packages/sensors/protocol` labels every field
 * as it reads it rather than after it has been differenced.
 */
export function deriveRevolutionInterval(
  previous: TimedReading | undefined,
  current: TimedReading,
  shape: CounterShape,
): RevolutionDerivation {
  if (previous === undefined) {
    return { interval: undefined, next: current };
  }
  const revolutions = unsignedCounterDelta(
    previous.reading.revolutions,
    current.reading.revolutions,
    shape.revolutionModulus,
  );
  if (revolutions === 0) {
    return { interval: undefined, next: previous };
  }
  const sinceLastReading = seconds(current.at - previous.at);
  if (eventTimeIntervalIsAmbiguous(sinceLastReading, shape.ticksPerSecond)) {
    return { interval: undefined, next: current };
  }
  // Named fields, not positional arguments. #103 changed this signature for the
  // reason this call site demonstrates: the three values are all plausible
  // `number`s in each other's roles, and the positional form this replaced
  // typechecked whichever order they were written in. `(1512, 1000, 1024)`
  // returned 63.98 s -- a counter wrap misread as a long interval -- silently.
  const elapsed = eventTimeIntervalSeconds({
    previousTicks: eventTicks(previous.reading.lastEventTimeTicks),
    currentTicks: eventTicks(current.reading.lastEventTimeTicks),
    ticksPerSecond: eventTickRate(shape.ticksPerSecond),
  });
  if (elapsed === 0) {
    // Revolutions moved and the event clock did not. No real sensor does this;
    // a device that has just been reset, or one that is lying, does. Dividing
    // would produce `Infinity`, which `revolutionsPerMinute` rejects — but it
    // would reject it as a unit error from inside the derivation rather than
    // here, where the reason can be recorded and the sample simply dropped.
    return { interval: undefined, next: current };
  }
  return { interval: { revolutions, elapsed }, next: current };
}

/** A cadence to emit, or nothing, and the reading to keep. */
export interface CadenceDerivation {
  readonly cadence: RevolutionsPerMinute | undefined;
  readonly next: TimedReading;
}

/**
 * Crank revolutions differenced into a cadence.
 *
 * `Δrevolutions / Δevent-time × 60`, with both deltas taken modulo their
 * counters. The event time is the sensor's own clock rather than the receive
 * instant, which is what makes the answer right when a notification is late.
 */
export function deriveCadence(
  previous: TimedReading | undefined,
  current: TimedReading,
  shape: CounterShape,
): CadenceDerivation {
  const { interval, next } = deriveRevolutionInterval(previous, current, shape);
  return {
    cadence:
      interval === undefined
        ? undefined
        : revolutionsPerMinute((interval.revolutions / interval.elapsed) * 60),
    next,
  };
}

/** A speed to emit, or nothing, and the reading to keep. */
export interface SpeedDerivation {
  readonly speed: MetresPerSecond | undefined;
  readonly next: TimedReading;
}

/**
 * Wheel revolutions differenced into a ground speed.
 *
 * `Δrevolutions × circumference / Δevent-time`.
 *
 * **The circumference is a required argument, and there is deliberately no
 * default.** #41 is explicit: a default that assumes 700×25c silently
 * misreports speed and distance for everyone else, and "silently" is the
 * problem — a rider on 650b or a 29er gets a ride whose distance is wrong by
 * several percent with nothing on screen to say so. It is a rider setting, not
 * a device property, so the profile cannot supply one and the caller must.
 */
export function deriveSpeed(
  previous: TimedReading | undefined,
  current: TimedReading,
  shape: CounterShape & { readonly wheelCircumference: Metres },
): SpeedDerivation {
  const { interval, next } = deriveRevolutionInterval(previous, current, shape);
  return {
    speed:
      interval === undefined
        ? undefined
        : metresPerSecond((interval.revolutions * shape.wheelCircumference) / interval.elapsed),
    next,
  };
}
