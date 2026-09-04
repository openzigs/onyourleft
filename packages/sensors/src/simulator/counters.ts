// SPDX-License-Identifier: Apache-2.0

/**
 * The device half of a wrapping revolution counter: what a CSC or Cycling Power
 * sensor would put in its next notification.
 *
 * ## The client half moved out in #41
 *
 * A real sensor transmits a cumulative revolution count and the event time of
 * the last revolution, both as free-running unsigned integers that lap. A real
 * client differences two readings — with the modulus, or it produces a negative
 * interval roughly once a minute. Both halves used to live in this file, so
 * that a wrap the device half performs and the client half survives is a wrap
 * that has been **watched to fire**, which is what #44 asks for. That is still
 * true and `simulator.ts` still does it.
 *
 * What changed is that the client half acquired a **production** consumer: the
 * protocol clients in #41 and #42 difference exactly these counters off a real
 * GATT payload. So it moved to [`../revolutions.ts`](../revolutions.ts), where
 * both the simulator and `packages/sensors/protocol` reach it, and this file
 * re-exports it so that `@onyourleft/sensors/simulator` is unchanged. Two
 * implementations of a wrapping subtraction is precisely the outcome #41's
 * brief said to avoid.
 *
 * Wire counters stay `number` here — a tick count and a revolution count are
 * dimensionless, and `@onyourleft/domain` has no brand for them. They do not
 * cross the `SensorTransport` boundary: what leaves towards a subscriber is a
 * `RevolutionsPerMinute` or a `MetresPerSecond`.
 */

import { UINT16_MODULUS, type RevolutionsPerMinute, type Seconds } from '@onyourleft/domain';

import type { RevolutionReading } from '../revolutions';

export type {
  CadenceDerivation,
  CounterShape,
  RevolutionDerivation,
  RevolutionInterval,
  RevolutionReading,
  SpeedDerivation,
  TimedReading,
} from '../revolutions';

export {
  COAST_HORIZON,
  deriveCadence,
  deriveRevolutionInterval,
  deriveSpeed,
} from '../revolutions';

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
