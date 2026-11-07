// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  estimateThreshold,
  RAMP_TEST,
  seconds,
  thresholdShare,
  TWENTY_MINUTE_TEST,
  unixSeconds,
  watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import type { WorkoutBlockFact } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  conventionText,
  estimateFromRide,
  suggestionText,
  thresholdTestOf,
} from './threshold-test-result';

const START = 1_800_000_000;

/** A block ridden from `from` seconds into the ride, for `length` seconds. */
function ridden(block: WorkoutBlock, from: number, length: number): WorkoutBlockFact {
  return {
    outcome: 'ridden',
    block,
    startedAt: unixSeconds(START + from),
    elapsedTime: seconds(length),
    movingTime: seconds(length),
  };
}

/**
 * The ramp test's blocks as a ride saves them: the warm-up, then `steps`
 * steps ridden one after another, the rest skipped, and the cool-down ridden
 * for `coolDown` seconds.
 */
function rampRide(steps: number, coolDown = 60): WorkoutBlockFact[] {
  const warmUp = RAMP_TEST.template.warmUp[0] as WorkoutBlock;
  const facts: WorkoutBlockFact[] = [ridden(warmUp, 0, 480)];
  RAMP_TEST.template.mainSet.blocks.forEach((block, index) => {
    facts.push(
      index < steps
        ? ridden(block as WorkoutBlock, 480 + index * 60, 60)
        : { outcome: 'skipped', block: block as WorkoutBlock },
    );
  });
  const cool = RAMP_TEST.template.coolDown[0] as WorkoutBlock;
  facts.push(ridden(cool, 480 + steps * 60, coolDown));
  return facts;
}

/** Power at 1 Hz: `watts` for each second of each span, in order. */
function power(...spans: readonly (readonly [seconds: number, watts: number])[]): number[] {
  return spans.flatMap(([length, value]) => Array.from({ length }, () => value));
}

describe('which workouts are threshold tests — #2307', () => {
  it('knows the two tests by their built-in ids, and nothing else', () => {
    expect(thresholdTestOf('built-in:ramp-test')).toBe(RAMP_TEST);
    expect(thresholdTestOf('built-in:twenty-minute-test')).toBe(TWENTY_MINUTE_TEST);
    expect(thresholdTestOf('built-in:sweet-spot-3x12')).toBeUndefined();
    expect(thresholdTestOf('workout-4f1c')).toBeUndefined();
  });
});

describe('the estimate from a ride — #2307', () => {
  it('takes a ramp test’s effort from its steps alone, as the domain estimates it', () => {
    // Warm-up at 150 W, ten steps at 200…290 W, then a 600 W cool-down sprint.
    const series = power(
      [480, 150],
      ...Array.from({ length: 10 }, (_, step) => [60, 200 + step * 10] as const),
      [60, 600],
    );
    const result = estimateFromRide(RAMP_TEST, {
      blocks: rampRide(10),
      firstBlock: 0,
      startedAt: unixSeconds(START),
      sampleInterval: 1,
      power: series.map((value) => watts(value)),
    });
    // 0.75 × the best minute of the steps, 290 W — never the 600 W sprint after them.
    expect(result).toEqual({
      test: 'ramp',
      estimate: estimateThreshold('ramp', {
        power: series.map((value) => watts(value)),
        effortStartsAt: 480,
        effortEndsAt: 1080,
      }),
    });
    expect(result.estimate.kind === 'estimate' && result.estimate.thresholdPower).toBe(218);
  });

  it('finds the test after a workout ridden before it on the same ride', () => {
    const before: WorkoutBlockFact = ridden(
      { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5) },
      0,
      300,
    );
    const shifted = rampRide(5).map((fact) =>
      fact.outcome === 'skipped' ? fact : { ...fact, startedAt: unixSeconds(fact.startedAt + 300) },
    );
    const series = power([300, 100], [480, 150], [300, 250], [60, 100]);
    const result = estimateFromRide(RAMP_TEST, {
      blocks: [before, ...shifted],
      firstBlock: 1,
      startedAt: unixSeconds(START),
      sampleInterval: 1,
      power: series.map((value) => watts(value)),
    });
    expect(result.estimate.kind === 'estimate' && result.estimate.thresholdPower).toBe(188);
  });

  it('refuses a ramp given up in its first steps, with the domain’s reason and no number', () => {
    const result = estimateFromRide(RAMP_TEST, {
      blocks: rampRide(2),
      firstBlock: 0,
      startedAt: unixSeconds(START),
      sampleInterval: 1,
      power: power([480, 150], [120, 250], [60, 100]).map((value) => watts(value)),
    });
    expect(result.estimate.kind).toBe('refused');
  });

  it('refuses a test whose effort was never reached, or a ride with no blocks', () => {
    const neverReached = estimateFromRide(TWENTY_MINUTE_TEST, {
      blocks: [],
      firstBlock: 0,
      startedAt: unixSeconds(START),
      sampleInterval: 1,
      power: undefined,
    });
    expect(neverReached).toEqual({
      test: 'twenty-minute',
      estimate: estimateThreshold('twenty-minute', {
        power: [],
        effortStartsAt: 0,
        effortEndsAt: 0,
      }),
    });
    expect(neverReached.estimate.kind).toBe('refused');
  });
});

describe('what the offer says — #2307', () => {
  const estimate = {
    test: 'ramp',
    estimate: {
      kind: 'estimate',
      thresholdPower: watts(247),
      basis: watts(329),
      windowSeconds: 60,
      multiplier: 0.75,
    },
  } as const;

  it('says the estimate as a suggestion, beside the threshold the rider has now', () => {
    expect(suggestionText(estimate, watts(230))).toBe(
      'Your ramp test suggests a threshold of 247 W (it is 230 W now).',
    );
    expect(suggestionText(estimate, undefined)).toBe(
      'Your ramp test suggests a threshold of 247 W (you have none set now).',
    );
  });

  it('says why a refused test made none', () => {
    expect(
      suggestionText(
        { test: 'twenty-minute', estimate: { kind: 'refused', reason: 'Too short.' } },
        watts(230),
      ),
    ).toBe('Your 20-minute test made no threshold estimate. Too short.');
  });

  it('says the convention each test’s estimate is, from the rule it is computed with', () => {
    expect(conventionText('ramp')).toBe(
      'The estimate is a convention, not a measurement: 0.75 of your best minute.',
    );
    expect(conventionText('twenty-minute')).toBe(
      'The estimate is a convention, not a measurement: 0.95 of your twenty-minute average.',
    );
  });
});
