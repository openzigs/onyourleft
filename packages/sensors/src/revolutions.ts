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

/**
 * How long a counter may stand still before the rider is reported as stopped.
 *
 * #41 requires that *"a notification with no change in revolutions produces a
 * cadence of zero — a coasting rider — rather than a … retained stale value"*.
 * Emitting zero on the **first** such notification satisfies the words and
 * produces a number nobody can use: a sensor notifies at about 1 Hz and a
 * crank at 40 rpm completes a revolution every 1.5 s, so a third of the frames
 * of ordinary slow pedalling carry no new revolution and the ride screen would
 * alternate between the real cadence and nought.
 *
 * So the rule is a horizon rather than a frame: hold while a revolution could
 * still plausibly be in progress, and report zero once one could not. Five
 * seconds is one revolution at **12 rpm** — below any cadence a rider sustains,
 * and comfortably above the 3 s of a 20 rpm crawl up a wall — while staying far
 * inside the ambiguity horizon below (32 s at 2048 Hz), so the two never
 * contend for the same reading.
 *
 * A consumer that wants faster than five seconds can pass its own; this is the
 * value both profiles in #41 and #42 use.
 */
export const COAST_HORIZON: Seconds = seconds(5);

/**
 * The cadence above which a derived figure is a decode fault rather than a rider.
 *
 * The same posture as `MAX_PLAUSIBLE_POWER_WATTS` in the Cycling Power decoder,
 * and here for the reason CLAUDE.md §6 gives: a revolution counter is untrusted
 * input, and the numerator and the denominator of this division both come off
 * the wire. A device reporting a 60 000-revolution jump against a one-tick
 * event interval yields tens of millions of rpm, which `revolutionsPerMinute`
 * accepts — it rejects only negatives. A track sprinter peaks near 240 rpm.
 */
export const MAX_PLAUSIBLE_CADENCE_RPM = 300;

/**
 * The ground speed above which a derived figure is a decode fault, in m/s.
 *
 * 40 m/s is 144 km/h — above the fastest recorded road descent and far below
 * what a hostile or mis-walked wheel counter produces.
 */
export const MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND = 40;

/** Which counter is being differenced: its width, its clock rate, and its coast horizon. */
export interface CounterShape {
  /** 2^16 for a crank or a Cycling Power wheel count, 2^32 for a CSC wheel count. */
  readonly revolutionModulus: number;
  /** 1024 for CSC and the Cycling Power crank, 2048 for the Cycling Power wheel. */
  readonly ticksPerSecond: number;
  /**
   * Wall-clock time with no completed revolution after which zero is reported.
   *
   * Required, with no default — {@link COAST_HORIZON} is the value both
   * profiles pass. A field rather than a constant because it is the one number
   * here that is a *policy* rather than a property of the wire format, and
   * because making it required is what proves no construction site was missed
   * when it was introduced.
   */
  readonly coastHorizon: Seconds;
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
  /**
   * The counter has stood still for longer than {@link CounterShape.coastHorizon}.
   *
   * There is no interval to report and there is still something to say: the
   * rider is coasting or stopped, and the derived quantity is **zero**, not the
   * last one. Never `true` at the same time as an `interval` — the two are the
   * "report a rate" and the "report a nought" halves of the same decision.
   */
  readonly coasting: boolean;
  /** What the client should hold as "previous" for the next reading. */
  readonly next: TimedReading;
}

/**
 * Two readings in, at most one interval out.
 *
 * Reports nothing in three cases, each deliberate, **checked in this order**:
 *
 * - **No previous reading.** A rate needs an interval.
 * - **No new revolution.** Within {@link CounterShape.coastHorizon} this is
 *   "no reading yet" rather than a rate: the previous reading is kept so the
 *   interval keeps accumulating until a revolution arrives, and a rider
 *   pedalling slowly is not told they have stopped between one turn and the
 *   next. **Past the horizon the same case sets `coasting`**, and the caller
 *   reports zero — a coasting rider, which is #41's criterion and what stops
 *   every consumer holding the last cadence for the length of a descent. The
 *   previous reading is still kept, because the event clock a stopped crank
 *   reports is the one from before it stopped and restarting from it is what
 *   would make the next turn read as a few seconds against a truth of seventy.
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
    return { interval: undefined, coasting: false, next: current };
  }
  const revolutions = unsignedCounterDelta(
    previous.reading.revolutions,
    current.reading.revolutions,
    shape.revolutionModulus,
  );
  const sinceLastReading = seconds(current.at - previous.at);
  if (revolutions === 0) {
    return {
      interval: undefined,
      coasting: sinceLastReading >= shape.coastHorizon,
      next: previous,
    };
  }
  if (eventTimeIntervalIsAmbiguous(sinceLastReading, shape.ticksPerSecond)) {
    return { interval: undefined, coasting: false, next: current };
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
    return { interval: undefined, coasting: false, next: current };
  }
  return { interval: { revolutions, elapsed }, coasting: false, next: current };
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
 *
 * **Zero when the crank has stood still past the coast horizon**, which is
 * #41's criterion: a coasting rider reads nought, not the cadence they were
 * turning before they stopped. Undefined — hold whatever you had — only while
 * the answer is genuinely unknown: before the first pair, within the horizon,
 * and across a gap the event clock cannot span.
 *
 * A figure above {@link MAX_PLAUSIBLE_CADENCE_RPM} is dropped rather than
 * reported: a counter is untrusted input and no rider turns a crank that fast.
 */
export function deriveCadence(
  previous: TimedReading | undefined,
  current: TimedReading,
  shape: CounterShape,
): CadenceDerivation {
  const { interval, coasting, next } = deriveRevolutionInterval(previous, current, shape);
  if (interval === undefined) {
    return { cadence: coasting ? revolutionsPerMinute(0) : undefined, next };
  }
  const rpm = (interval.revolutions / interval.elapsed) * 60;
  return {
    cadence: rpm > MAX_PLAUSIBLE_CADENCE_RPM ? undefined : revolutionsPerMinute(rpm),
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
 *
 * **Zero when the wheel has stood still past the coast horizon** — a rider at
 * the lights, and the speed half of #41's coasting criterion. Above
 * {@link MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND} the sample is dropped, for the
 * reason {@link deriveCadence} gives.
 */
export function deriveSpeed(
  previous: TimedReading | undefined,
  current: TimedReading,
  shape: CounterShape & { readonly wheelCircumference: Metres },
): SpeedDerivation {
  const { interval, coasting, next } = deriveRevolutionInterval(previous, current, shape);
  if (interval === undefined) {
    return { speed: coasting ? metresPerSecond(0) : undefined, next };
  }
  const rate = (interval.revolutions * shape.wheelCircumference) / interval.elapsed;
  return {
    speed: rate > MAX_PLAUSIBLE_SPEED_METRES_PER_SECOND ? undefined : metresPerSecond(rate),
    next,
  };
}
