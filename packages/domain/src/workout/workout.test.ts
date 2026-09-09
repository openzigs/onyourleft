// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds, type Seconds } from '../quantities';

import { WorkoutError } from './errors';
import {
  MAXIMUM_REPEATS,
  MAXIMUM_SEGMENTS,
  MAXIMUM_SHARE,
  MINIMUM_SHARE,
  thresholdShare,
  validateWorkout,
  workoutSegmentCount,
  type SteadyBlock,
  type ThresholdShare,
  type Workout,
  type WorkoutBlock,
} from './workout';

const steady = (length: number, share: number): SteadyBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

const workout = (blocks: readonly WorkoutBlock[]): Workout => ({ name: 'Test', blocks });

const refusal = (build: () => unknown): WorkoutError => {
  try {
    build();
  } catch (error) {
    if (error instanceof WorkoutError) return error;
    throw error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
};

describe('a target is a share of threshold, and the brand is a safety guard', () => {
  it('accepts an ordinary interval target', () => {
    expect(thresholdShare(0.88)).toBe(0.88);
  });

  it('refuses a percentage written where a share was wanted', () => {
    // The mistake that matters: 88 is not 88%, it is 88 times threshold, and a
    // trainer asked for it applies every newton it has. CLAUDE.md §6 puts
    // trainer control in the safety class.
    const error = refusal(() => thresholdShare(88));
    expect(error.code).toBe('target-out-of-range');
    expect(error.message).toContain('88 times threshold');
  });

  it('refuses zero, because that is a free ride and not a target', () => {
    expect(refusal(() => thresholdShare(0)).code).toBe('target-out-of-range');
  });

  it.each([MINIMUM_SHARE, MAXIMUM_SHARE])('accepts the boundary %s', (share) => {
    expect(thresholdShare(share)).toBe(share);
  });

  it.each([MINIMUM_SHARE - 0.001, MAXIMUM_SHARE + 0.001, NaN, Infinity])('refuses %s', (share) => {
    expect(refusal(() => thresholdShare(share)).code).toBe('target-out-of-range');
  });
});

describe('validation refuses a workout rather than clamping it', () => {
  it('accepts an ordinary workout', () => {
    expect(validateWorkout(workout([steady(600, 0.6)]))).toBeDefined();
  });

  it('refuses a workout with no blocks', () => {
    expect(refusal(() => validateWorkout(workout([]))).code).toBe('empty-workout');
  });

  it('refuses a block lasting zero seconds', () => {
    const error = refusal(() =>
      validateWorkout(workout([{ ...steady(600, 0.6), seconds: seconds(0) }])),
    );
    expect(error.code).toBe('invalid-duration');
    // Named so the rider can find the block, not just told that one is wrong.
    expect(error.message).toContain('block 1');
  });

  it.each([-60, NaN, Infinity])(
    'refuses a duration of %s that arrived past the type system',
    (length) => {
      // ⚠️ Cast on purpose, and the cast is the point. `seconds()` already
      // refuses every one of these with a `UnitError`, so this branch of
      // `assertDuration` is UNREACHABLE through the public constructors — it is
      // defence for a workout decoded from a file, which is the same situation
      // the `default:` case in `validateBlock` exists for. Testing it through
      // `seconds()` would test the quantity constructor instead and pass while
      // proving nothing about this guard.
      expect(() => seconds(length)).toThrow();
      const error = refusal(() =>
        validateWorkout(workout([{ ...steady(600, 0.6), seconds: length as Seconds }])),
      );
      expect(error.code).toBe('invalid-duration');
    },
  );

  it('names which block is wrong, not just that one is', () => {
    const error = refusal(() =>
      validateWorkout(
        workout([steady(600, 0.6), steady(600, 0.6), { ...steady(1, 0.6), seconds: seconds(0) }]),
      ),
    );
    expect(error.message).toContain('block 3');
  });

  it.each([0, -1, 1.5, MAXIMUM_REPEATS + 1])('refuses %s repeats', (repeats) => {
    const error = refusal(() =>
      validateWorkout(
        workout([
          {
            kind: 'intervals',
            repeats,
            hardSeconds: seconds(180),
            hardTarget: thresholdShare(1.05),
            easySeconds: seconds(180),
            easyTarget: thresholdShare(0.6),
          },
        ]),
      ),
    );
    expect(error.code).toBe('invalid-repeat');
  });

  it('checks both halves of an intervals block, not only the first', () => {
    const error = refusal(() =>
      validateWorkout(
        workout([
          {
            kind: 'intervals',
            repeats: 4,
            hardSeconds: seconds(180),
            hardTarget: thresholdShare(1.05),
            easySeconds: seconds(0),
            easyTarget: thresholdShare(0.6),
          },
        ]),
      ),
    );
    expect(error.message).toContain('easy interval');
  });
});

describe('a target that reached the brand past a cast is still refused', () => {
  // ⚠️ These casts are the point. `thresholdShare()` is a CONSTRUCTOR guard, so
  // it never ran for a workout that arrived as data — a store row, or a file
  // once #202 gives us a format. The brand is a compile-time fiction at that
  // point, and `validateWorkout` is the only thing standing between a bad
  // number and a trainer. Every case below is a workout that typechecks.
  const forged = (value: number) => value as unknown as ThresholdShare;

  it('refuses a percentage in a steady block', () => {
    const error = refusal(() =>
      validateWorkout(workout([{ kind: 'steady', seconds: seconds(60), target: forged(88) }])),
    );
    expect(error.code).toBe('target-out-of-range');
    expect(error.message).toContain('88 times threshold');
  });

  it('names which end of a ramp is wrong', () => {
    expect(
      refusal(() =>
        validateWorkout(
          workout([
            {
              kind: 'ramp',
              seconds: seconds(60),
              from: thresholdShare(0.6),
              to: forged(250),
            },
          ]),
        ),
      ).message,
    ).toContain('ends at a target');
  });

  it('checks both targets of an intervals block', () => {
    const bad = (overrides: { hard?: number; easy?: number }) =>
      refusal(() =>
        validateWorkout(
          workout([
            {
              kind: 'intervals',
              repeats: 3,
              hardSeconds: seconds(60),
              hardTarget: forged(overrides.hard ?? 1.1),
              easySeconds: seconds(60),
              easyTarget: forged(overrides.easy ?? 0.5),
            },
          ]),
        ),
      );
    expect(bad({ hard: 40 }).message).toContain('hard target');
    expect(bad({ easy: 0 }).message).toContain('easy target');
  });

  it('refuses a NaN target, which no comparison alone would catch', () => {
    // `NaN < MINIMUM_SHARE` and `NaN > MAXIMUM_SHARE` are both false, so a
    // range check without the finiteness test lets it through — and a trainer
    // asked for NaN watts is a write nobody can predict.
    expect(
      refusal(() =>
        validateWorkout(workout([{ kind: 'steady', seconds: seconds(60), target: forged(NaN) }])),
      ).code,
    ).toBe('target-out-of-range');
  });

  it('says the same thing the constructor says', () => {
    // One wording, spelled once. A rider meeting this through a bad file and a
    // developer meeting it through a bad literal are looking at one mistake.
    const fromConstructor = refusal(() => thresholdShare(88)).message;
    const fromValidation = refusal(() =>
      validateWorkout(workout([{ kind: 'steady', seconds: seconds(60), target: forged(88) }])),
    ).message;
    expect(fromValidation).toContain(fromConstructor.slice(fromConstructor.indexOf('must be')));
  });

  it('leaves a free ride alone, because it has no target to check', () => {
    expect(() =>
      validateWorkout(workout([{ kind: 'free-ride', seconds: seconds(60) }])),
    ).not.toThrow();
  });
});

describe('the expansion is bounded, because a workout can arrive as data', () => {
  const intervals = (repeats: number): WorkoutBlock => ({
    kind: 'intervals',
    repeats,
    hardSeconds: seconds(30),
    hardTarget: thresholdShare(1.05),
    easySeconds: seconds(30),
    easyTarget: thresholdShare(0.6),
  });

  it('counts one segment for each block that is not a repeat', () => {
    expect(
      workoutSegmentCount(
        workout([
          steady(60, 0.7),
          {
            kind: 'ramp',
            seconds: seconds(60),
            from: thresholdShare(0.6),
            to: thresholdShare(0.9),
          },
          { kind: 'free-ride', seconds: seconds(60) },
        ]),
      ),
    ).toBe(3);
  });

  it('counts a hard and an easy interval for every repeat, including the last', () => {
    // `expandWorkout` pushes both every time, so counting one per repeat would
    // under-report by half and the bound would admit twice what it says.
    expect(workoutSegmentCount(workout([intervals(6)]))).toBe(12);
  });

  it('accepts a workout that lands exactly on the bound', () => {
    const blocks = Array.from({ length: MAXIMUM_SEGMENTS / 2 }, () => intervals(1));
    expect(workoutSegmentCount(workout(blocks))).toBe(MAXIMUM_SEGMENTS);
    expect(() => validateWorkout(workout(blocks))).not.toThrow();
  });

  it('refuses one segment past it, and says what to look at', () => {
    const blocks = [
      ...Array.from({ length: MAXIMUM_SEGMENTS / 2 }, () => intervals(1)),
      steady(60, 0.7),
    ];
    const error = refusal(() => validateWorkout(workout(blocks)));
    expect(error.code).toBe('workout-too-long');
    expect(error.message).toContain('repeat counts');
  });

  it('refuses the absurd case that motivated the bound', () => {
    // Sixty blocks at the maximum repeat count is 12 000 segments; ten thousand
    // such blocks is two million, which is what `expandWorkout` would have
    // allocated before this existed.
    const blocks = Array.from({ length: 60 }, () => intervals(MAXIMUM_REPEATS));
    expect(refusal(() => validateWorkout(workout(blocks))).code).toBe('workout-too-long');
  });

  it('reports a bad repeat count as a bad repeat count, not as a long workout', () => {
    // The count runs AFTER the per-block loop and has to: counting with a
    // repeat count of NaN would mean deciding what NaN segments means, which is
    // a worse question than one pass over an array already in memory.
    expect(refusal(() => validateWorkout(workout([intervals(Number.NaN)]))).code).toBe(
      'invalid-repeat',
    );
  });
});
