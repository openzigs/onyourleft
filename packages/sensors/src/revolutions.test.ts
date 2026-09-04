// SPDX-License-Identifier: Apache-2.0

/**
 * The shared wrap-aware derivation, tested away from any wire format.
 *
 * `simulator/counters.test.ts` did not exist — the derivation was covered
 * through `simulator.test.ts`, which drives it via a simulated ride and so
 * cannot reach the cases that matter here directly. These are the ones a
 * profile depends on and a ride cannot arrange on demand: a counter that stands
 * still, a clock that stands still, and the two moduli.
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  metres,
  UINT16_MODULUS,
  UINT32_MODULUS,
  unixSeconds,
} from '@onyourleft/domain';

import {
  deriveCadence,
  deriveRevolutionInterval,
  deriveSpeed,
  type CounterShape,
  type TimedReading,
} from './revolutions';

const CRANK: CounterShape = {
  revolutionModulus: UINT16_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
};

const CPS_WHEEL: CounterShape = {
  revolutionModulus: UINT32_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_2048,
};

const START = 1_800_000_000;

const at = (revolutions: number, lastEventTimeTicks: number, second: number): TimedReading => ({
  reading: { revolutions, lastEventTimeTicks },
  at: unixSeconds(START + second),
});

describe('differencing two readings', () => {
  it('reports nothing, and keeps the reading, when there is no previous one', () => {
    const current = at(10, 1024, 0);

    expect(deriveRevolutionInterval(undefined, current, CRANK)).toEqual({
      interval: undefined,
      next: current,
    });
  });

  it('keeps the OLDER reading when no revolution has been completed', () => {
    // Load-bearing: the accumulator has to keep running across a coast, or a
    // rider who stops for three seconds and turns the crank once reports the
    // rate of that one turn rather than of the three seconds.
    const previous = at(10, 1024, 0);
    const current = at(10, 1024, 1);

    expect(deriveRevolutionInterval(previous, current, CRANK)).toEqual({
      interval: undefined,
      next: previous,
    });
  });

  it('restarts from the CURRENT reading when the interval is ambiguous', () => {
    // The opposite choice from the case above, and the reason the two checks
    // are in this order: the previous reading is unusable, so keeping it would
    // make the next sample unusable too.
    const previous = at(10, 0, 0);
    const current = at(20, 1024, 70);

    expect(deriveRevolutionInterval(previous, current, CRANK)).toEqual({
      interval: undefined,
      next: current,
    });
  });

  it('is ambiguous at exactly one full period, not only beyond it', () => {
    // At exactly 64 s the counter reads what it read before, which is
    // indistinguishable from no event at all.
    expect(
      deriveRevolutionInterval(at(10, 0, 0), at(20, 1024, 64), CRANK).interval,
    ).toBeUndefined();
    expect(deriveRevolutionInterval(at(10, 0, 0), at(20, 1024, 63), CRANK).interval).toBeDefined();
  });

  it('uses the tick rate it was given, not a constant', () => {
    // 2048 ticks is one second at 2048 Hz and two at 1024 Hz. The CPS wheel
    // and the CPS crank sit one field apart in the same packet at these two
    // rates, so a hard-coded 1024 halves every wheel speed.
    expect(deriveRevolutionInterval(at(0, 0, 0), at(10, 2048, 1), CPS_WHEEL).interval).toEqual({
      revolutions: 10,
      elapsed: 1,
    });
    expect(deriveRevolutionInterval(at(0, 0, 0), at(10, 2048, 1), CRANK).interval).toEqual({
      revolutions: 10,
      elapsed: 2,
    });
  });

  it('reports nothing when revolutions moved and the event clock did not', () => {
    // No real sensor does this; a device that has just been reset, or one that
    // is lying, does. Dividing would produce Infinity, which the quantity
    // constructors reject — as a unit error out of the domain package rather
    // than as a dropped sample here.
    expect(
      deriveRevolutionInterval(at(10, 512, 0), at(12, 512, 1), CRANK).interval,
    ).toBeUndefined();
  });

  it('takes the wheel modulus for a uint32 counter and the crank one for a uint16', () => {
    const wrapped = deriveRevolutionInterval(
      at(UINT32_MODULUS - 3, 0, 0),
      at(2, 2048, 1),
      CPS_WHEEL,
    );

    expect(wrapped.interval?.revolutions).toBe(5);
    expect(
      deriveRevolutionInterval(at(UINT16_MODULUS - 3, 0, 0), at(2, 1024, 1), CRANK).interval
        ?.revolutions,
    ).toBe(5);
  });

  it('refuses a reading outside its counter’s range', () => {
    // A decode fault reaching the derivation. `unsignedCounterDelta` validates,
    // which is why the profile labels every field as it reads it.
    expect(() =>
      deriveRevolutionInterval(at(0, 0, 0), at(UINT16_MODULUS, 1024, 1), CRANK),
    ).toThrow();
  });
});

describe('deriving a cadence', () => {
  it('is revolutions over the event-time interval, in rpm', () => {
    expect(deriveCadence(at(0, 0, 0), at(3, 2048, 2), CRANK).cadence).toBe(90);
  });

  it('is undefined wherever the interval is', () => {
    expect(deriveCadence(undefined, at(0, 0, 0), CRANK).cadence).toBeUndefined();
    expect(deriveCadence(at(0, 0, 0), at(0, 0, 1), CRANK).cadence).toBeUndefined();
  });
});

describe('deriving a speed', () => {
  it('is revolutions times circumference over the event-time interval', () => {
    const derived = deriveSpeed(at(0, 0, 0), at(10, 2048, 1), {
      ...CPS_WHEEL,
      wheelCircumference: metres(2.105),
    });

    expect(derived.speed).toBe(21.05);
  });

  it('scales with the circumference it is given', () => {
    const previous = at(0, 0, 0);
    const current = at(10, 2048, 1);

    const road = deriveSpeed(previous, current, {
      ...CPS_WHEEL,
      wheelCircumference: metres(2.105),
    });
    const gravel = deriveSpeed(previous, current, {
      ...CPS_WHEEL,
      wheelCircumference: metres(2.02),
    });

    expect(road.speed).not.toBe(gravel.speed);
    expect(gravel.speed).toBe(20.2);
  });

  it('is undefined wherever the interval is', () => {
    expect(
      deriveSpeed(undefined, at(0, 0, 0), { ...CPS_WHEEL, wheelCircumference: metres(2.105) })
        .speed,
    ).toBeUndefined();
  });
});
