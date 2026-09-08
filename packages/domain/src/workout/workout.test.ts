// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds, type Seconds } from '../quantities';

import { WorkoutError } from './errors';
import {
  MAXIMUM_REPEATS,
  MAXIMUM_SHARE,
  MINIMUM_SHARE,
  thresholdShare,
  validateWorkout,
  type SteadyBlock,
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
