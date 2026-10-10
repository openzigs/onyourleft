// SPDX-License-Identifier: Apache-2.0

/**
 * The response model on its own (#1238). What a strap reports, read through
 * the real decoder, is `protocol/src/heart-rate-simulator.test.ts`.
 */

import { seconds, watts, type Seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  createHeartRateResponse,
  DEFAULT_RESTING_HEART_RATE,
  HUNT_HURNI_BPM_PER_WATT,
  HUNT_HURNI_TIME_CONSTANT,
} from './heart-rate-response';

describe('a heart rate that answers to load', () => {
  it('a step from 100 W to 150 W rises towards +19.6 bpm: 63 % at one τ and 95 % at three', () => {
    const heart = createHeartRateResponse({ settledAt: watts(100) });
    const before = heart.heartRate;
    expect(before).toBeCloseTo(DEFAULT_RESTING_HEART_RATE + 100 * HUNT_HURNI_BPM_PER_WATT, 9);

    heart.advance(watts(150), HUNT_HURNI_TIME_CONSTANT);
    expect(heart.heartRate - before).toBeGreaterThan(19.6 * (1 - Math.exp(-1)) - 1);
    expect(heart.heartRate - before).toBeLessThan(19.6 * (1 - Math.exp(-1)) + 1);

    heart.advance(watts(150), seconds(2 * HUNT_HURNI_TIME_CONSTANT));
    expect(Math.abs(heart.heartRate - before - 19.6 * (1 - Math.exp(-3)))).toBeLessThan(1);
    expect(heart.steadyStateAt(watts(150)) - before).toBeCloseTo(19.6, 9);
  });

  it('does not depend on how finely time is sliced', () => {
    const coarse = createHeartRateResponse({ settledAt: watts(100) });
    const fine = createHeartRateResponse({ settledAt: watts(100) });
    coarse.advance(watts(200), seconds(60));
    for (let i = 0; i < 60; i += 1) {
      fine.advance(watts(200), seconds(1));
    }
    expect(fine.heartRate).toBeCloseTo(coarse.heartRate, 9);
  });

  it('drifts upward at constant power, and a negative drift falls', () => {
    const steady = createHeartRateResponse({ settledAt: watts(150) });
    const drifting = createHeartRateResponse({ settledAt: watts(150) });
    const falling = createHeartRateResponse({ settledAt: watts(150) });
    drifting.drift(7.7);
    falling.drift(-7.7);
    for (let i = 0; i < 3600; i += 1) {
      steady.advance(watts(150), seconds(1));
      drifting.advance(watts(150), seconds(1));
      falling.advance(watts(150), seconds(1));
    }
    // An hour at 7.7 bpm/h, less the τ of lag behind a moving target.
    const lag = (7.7 * HUNT_HURNI_TIME_CONSTANT) / 3600;
    expect(drifting.heartRate - steady.heartRate).toBeCloseTo(7.7 - lag, 1);
    expect(falling.heartRate - steady.heartRate).toBeCloseTo(-(7.7 - lag), 1);
  });

  it('refuses a time constant, gain, step or drift it cannot integrate', () => {
    expect(() => createHeartRateResponse({ timeConstant: seconds(0) })).toThrow(RangeError);
    expect(() => createHeartRateResponse({ bpmPerWatt: Number.NaN })).toThrow(RangeError);
    const heart = createHeartRateResponse();
    expect(() => heart.advance(watts(100), -1 as Seconds)).toThrow(RangeError);
    expect(() => heart.drift(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
