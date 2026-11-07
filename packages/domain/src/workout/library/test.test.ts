// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { THRESHOLD_TEST_RULES } from '../../analysis/threshold-estimate';
import { WorkoutError } from '../errors';
import { tailorWorkout } from '../template';
import { expandWorkout } from '../timeline';
import { MAXIMUM_SHARE, type WorkoutBlock } from '../workout';

import {
  RAMP_MAXIMUM_SHARE,
  RAMP_START_SHARE,
  RAMP_STEP_SECONDS,
  RAMP_STEP_SHARE,
  RAMP_TEST,
  THRESHOLD_TESTS,
  TWENTY_MINUTE_TEST,
} from './test';

/** The `invalid-choice` refusal a tailoring throws, or a failure. */
function refusedChoice(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkoutError);
    expect((error as WorkoutError).code).toBe('invalid-choice');
    return (error as WorkoutError).message;
  }
  throw new Error('expected the choice to be refused');
}

const steps = (): readonly WorkoutBlock[] => RAMP_TEST.template.mainSet.blocks;

const stepShare = (block: WorkoutBlock | undefined): number => {
  if (block?.kind !== 'steady') {
    throw new Error('every ramp step is a steady block');
  }
  return block.target;
};

describe('the threshold tests', () => {
  it('are both tests, ridden exactly as written', () => {
    expect(THRESHOLD_TESTS.map((test) => test.kind)).toEqual(['ramp', 'twenty-minute']);
    for (const test of THRESHOLD_TESTS) {
      expect(test.template.category).toBe('test');
      expect(test.template.mainSet.scaling).toBe('fixed');
      // As written, the tailored workout is the template's blocks in order.
      const workout = tailorWorkout(test.template, {});
      expect(workout.blocks).toEqual([
        ...test.template.warmUp,
        ...test.template.mainSet.blocks,
        ...test.template.coolDown,
      ]);
      expect(workout.name).toBe(test.template.name);
    }
  });

  it('refuse a chosen length, an intensity and a repeat count', () => {
    for (const test of THRESHOLD_TESTS) {
      const template = test.template;
      expect(refusedChoice(() => tailorWorkout(template, { targetMinutes: 30 }))).toBe(
        `"${template.name}" is ridden as written, so its length cannot be chosen.`,
      );
      expect(refusedChoice(() => tailorWorkout(template, { intensityPercent: -5 }))).toContain(
        'is ridden at the intensity it is written at',
      );
      expect(refusedChoice(() => tailorWorkout(template, { repeats: 3 }))).toBe(
        'this workout has no repeat count to choose.',
      );
    }
  });

  it('hold the effort each estimate rule needs', () => {
    for (const test of THRESHOLD_TESTS) {
      const timeline = expandWorkout(tailorWorkout(test.template, {}));
      const first = test.template.warmUp.length;
      const effort = timeline.segments.filter(
        (segment) =>
          segment.block >= first && segment.block < first + test.template.mainSet.blocks.length,
      );
      const seconds = effort.reduce(
        (total, segment) => total + segment.endsAt - segment.startsAt,
        0,
      );
      expect(seconds).toBeGreaterThanOrEqual(THRESHOLD_TEST_RULES[test.kind].minimumSeconds);
    }
  });
});

describe('the ramp test', () => {
  it('rises in one-minute steps of 6 % of threshold from its first', () => {
    const shares = steps().map(stepShare);
    expect(shares[0]).toBe(RAMP_START_SHARE);
    for (const [index, block] of steps().entries()) {
      expect(block).toMatchObject({ kind: 'steady', seconds: RAMP_STEP_SECONDS });
      if (index > 0) {
        expect(stepShare(block) - stepShare(steps()[index - 1])).toBeCloseTo(RAMP_STEP_SHARE, 10);
      }
    }
  });

  it('caps its steps at the declared maximum, and stops at the last one under it', () => {
    const shares = steps().map(stepShare);
    const top = Math.max(...shares);
    expect(top).toBeLessThanOrEqual(RAMP_MAXIMUM_SHARE);
    // The cap is reached, not merely respected: one more step would pass it.
    expect(top + RAMP_STEP_SHARE).toBeGreaterThan(RAMP_MAXIMUM_SHARE);
    expect(shares).toHaveLength(24);
    expect(shares.at(-1)).toBe(1.98);
    expect(RAMP_MAXIMUM_SHARE).toBeLessThan(MAXIMUM_SHARE);
    // No target anywhere in the test, warm-up and cool-down included, is above it.
    const timeline = expandWorkout(tailorWorkout(RAMP_TEST.template, {}));
    for (const segment of timeline.segments) {
      expect(segment.from ?? 0).toBeLessThanOrEqual(RAMP_MAXIMUM_SHARE);
      expect(segment.to ?? 0).toBeLessThanOrEqual(RAMP_MAXIMUM_SHARE);
    }
  });

  it('warms up to where its first step begins, and cools down with no target', () => {
    const warmUp = RAMP_TEST.template.warmUp.at(-1);
    expect(warmUp).toMatchObject({ kind: 'ramp', to: RAMP_START_SHARE });
    // The safety half of the end: whatever ends the ramp, what follows asks the
    // trainer for nothing (`test-player.ts`).
    expect(RAMP_TEST.template.coolDown.map((block) => block.kind)).toEqual(['free-ride']);
  });
});

describe('the 20-minute test', () => {
  it('rides its twenty minutes as one free-ride block, the trainer released', () => {
    expect(TWENTY_MINUTE_TEST.template.mainSet.blocks).toEqual([
      expect.objectContaining({ kind: 'free-ride', seconds: 1200 }),
    ]);
  });
});

describe('the tests’ names and words', () => {
  // The banned-names list of spike 0038 §3.1 that bears on a test: the
  // load-metric marks as upper-case whole words, their long forms, and FTP as
  // a wording rule (ADR 0048 D-12 says "threshold power").
  const MARKS = /\b(?:NP|TSS|IF|CTL|ATL|TSB|FTP|MPA)\b/;
  const LONG_MARKS =
    /normali[sz]ed power|training stress score|intensity factor|functional threshold|half monty/i;

  it('use none of the load-metric marks', () => {
    for (const test of THRESHOLD_TESTS) {
      const words = [
        test.template.name,
        test.template.summary,
        ...[
          ...test.template.warmUp,
          ...test.template.mainSet.blocks,
          ...test.template.coolDown,
        ].map((block) => block.label ?? ''),
      ];
      for (const text of words) {
        expect(text).not.toMatch(MARKS);
        expect(text).not.toMatch(LONG_MARKS);
      }
    }
  });

  it('call what they make a threshold estimate', () => {
    for (const test of THRESHOLD_TESTS) {
      expect(test.template.summary).toContain('threshold estimate');
    }
  });
});
