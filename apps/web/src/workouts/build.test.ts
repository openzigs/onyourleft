// SPDX-License-Identifier: AGPL-3.0-or-later

import { thresholdShare, type WorkoutBlock } from '@onyourleft/domain';
import { athleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  blockFromDraft,
  checkName,
  EMPTY_DRAFT,
  MAXIMUM_BLOCK_SECONDS,
  MAXIMUM_NAME_LENGTH,
  minutesToSeconds,
  percentToShare,
  workoutToSave,
  type BlockDraft,
} from './build';

const OWNER = athleteId('rider');

const draft = (overrides: Partial<BlockDraft>): BlockDraft => ({ ...EMPTY_DRAFT, ...overrides });

const built = <T>(outcome: { status: string } & Record<string, unknown>): T => {
  if (outcome.status !== 'built') {
    throw new Error(`expected a build, got ${JSON.stringify(outcome)}`);
  }
  return outcome.value as T;
};

const refusalOf = (outcome: { status: string } & Record<string, unknown>): string => {
  if (outcome.status !== 'refused') {
    throw new Error('expected a refusal');
  }
  return (outcome.refusal as { code: string }).code;
};

describe('a percentage becomes a share, once, in one place', () => {
  it('reads 110 as 1.1 times threshold', () => {
    // ⚠️ The whole reason `build.ts` exists. These are the same instruction and
    // a factor of a hundred apart, and `110` is a perfectly good number as far
    // as every type in the program is concerned.
    expect(built<number>(percentToShare('110', 'The target'))).toBeCloseTo(1.1, 10);
  });

  it('refuses a share typed where a percentage was wanted', () => {
    // A rider who types `1.1` meant 1.1% of threshold — about three watts —
    // which is below `MINIMUM_SHARE` and refused rather than silently ridden.
    expect(refusalOf(percentToShare('1.1', 'The target'))).toBe('bad-target');
  });

  it('names the range in words a rider can act on', () => {
    const outcome = percentToShare('900', 'The target');
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.message).toContain('20% to 300%');
  });

  it.each(['', '   ', 'hard', 'NaN'])('refuses %o', (input) => {
    expect(refusalOf(percentToShare(input, 'The target'))).toBe('bad-target');
  });
});

describe('minutes become seconds', () => {
  it('reads a whole number', () => {
    expect(built<number>(minutesToSeconds('12', 'This block'))).toBe(720);
  });

  it('accepts a half minute, because a thirty-second interval is ordinary', () => {
    expect(built<number>(minutesToSeconds('0.5', 'This block'))).toBe(30);
  });

  it('refuses zero and below', () => {
    expect(refusalOf(minutesToSeconds('0', 'This block'))).toBe('bad-duration');
    expect(refusalOf(minutesToSeconds('-5', 'This block'))).toBe('bad-duration');
  });

  it('refuses a block longer than the typo guard, and says what the mistake probably was', () => {
    const outcome = minutesToSeconds(String(MAXIMUM_BLOCK_SECONDS / 60 + 1), 'This block');
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('bad-duration');
    expect(outcome.refusal.message).toContain('minutes rather than hours');
  });

  it('accepts the boundary itself', () => {
    expect(built<number>(minutesToSeconds(String(MAXIMUM_BLOCK_SECONDS / 60), 'This block'))).toBe(
      MAXIMUM_BLOCK_SECONDS,
    );
  });
});

describe('a draft becomes a block', () => {
  it('builds a steady block', () => {
    const block = built<WorkoutBlock>(blockFromDraft(draft({ minutes: '10', percent: '65' })));
    expect(block).toEqual({ kind: 'steady', seconds: 600, target: 0.65 });
  });

  it('carries an optional label, and omits the field when it is blank', () => {
    const labelled = built<WorkoutBlock>(
      blockFromDraft(draft({ minutes: '10', percent: '65', label: ' Warm up ' })),
    );
    expect(labelled).toHaveProperty('label', 'Warm up');
    const plain = built<WorkoutBlock>(blockFromDraft(draft({ minutes: '10', percent: '65' })));
    expect(plain).not.toHaveProperty('label');
  });

  it('builds a free ride, which has no target to read', () => {
    // ⚠️ And reads no percentage field even when one is filled in. A rider who
    // typed a target and then switched the block to free ride must not get a
    // refusal about a box that is no longer on the form.
    const block = built<WorkoutBlock>(
      blockFromDraft(draft({ kind: 'free-ride', minutes: '7', percent: 'nonsense' })),
    );
    expect(block).toEqual({ kind: 'free-ride', seconds: 420 });
  });

  it('builds a ramp from both ends', () => {
    const block = built<WorkoutBlock>(
      blockFromDraft(draft({ kind: 'ramp', minutes: '5', percent: '60', toPercent: '105' })),
    );
    expect(block).toEqual({ kind: 'ramp', seconds: 300, from: 0.6, to: 1.05 });
  });

  it('names which end of a ramp is wrong', () => {
    const outcome = blockFromDraft(
      draft({ kind: 'ramp', minutes: '5', percent: '60', toPercent: '5000' }),
    );
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.message).toContain('finishing target');
  });

  it('builds an intervals block', () => {
    const block = built<WorkoutBlock>(
      blockFromDraft(
        draft({
          kind: 'intervals',
          repeats: '4',
          minutes: '3',
          percent: '110',
          easyMinutes: '2',
          easyPercent: '50',
        }),
      ),
    );
    expect(block).toEqual({
      kind: 'intervals',
      repeats: 4,
      hardSeconds: 180,
      hardTarget: 1.1,
      easySeconds: 120,
      easyTarget: 0.5,
    });
  });

  it.each(['0', '2.5', '', 'four'])('refuses a repeat count of %o', (repeats) => {
    expect(
      refusalOf(
        blockFromDraft(
          draft({
            kind: 'intervals',
            repeats,
            minutes: '3',
            percent: '110',
            easyMinutes: '2',
            easyPercent: '50',
          }),
        ),
      ),
    ).toBe('bad-repeats');
  });

  it('tells the hard interval apart from the recovery in a refusal', () => {
    const outcome = blockFromDraft(
      draft({
        kind: 'intervals',
        repeats: '4',
        minutes: '3',
        percent: '110',
        easyMinutes: '',
        easyPercent: '50',
      }),
    );
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.message).toContain('recovery');
  });
});

describe('a name is checked before anything is written', () => {
  it('accepts an ordinary name', () => {
    expect(checkName('Sweet spot')).toBeUndefined();
  });

  it('refuses a blank one', () => {
    expect(checkName('   ')?.code).toBe('name-required');
  });

  it('refuses one that is too long, and accepts the boundary', () => {
    expect(checkName('x'.repeat(MAXIMUM_NAME_LENGTH))).toBeUndefined();
    expect(checkName('x'.repeat(MAXIMUM_NAME_LENGTH + 1))?.code).toBe('name-too-long');
  });
});

describe('a record is assembled, or refused', () => {
  const blocks: readonly WorkoutBlock[] = [
    { kind: 'steady', seconds: 600, target: thresholdShare(0.6) } as WorkoutBlock,
  ];

  it('trims the name and uses it for the workout too', () => {
    const record = built<WorkoutRecord>(
      workoutToSave({
        id: workoutId('w1'),
        owner: OWNER,
        name: '  Threshold  ',
        blocks,
        now: 1_700_000_000.7,
      }),
    );
    expect(record.name).toBe('Threshold');
    expect(record.workout.name).toBe('Threshold');
    expect(record.createdBy).toBe(OWNER);
    // Floored, not rounded: a stored instant that is later than the one the
    // save happened at would let a workout sort ahead of one saved after it.
    expect(record.createdAt).toBe(1_700_000_000);
  });

  it('refuses a workout with no blocks, in words that say what to do', () => {
    const outcome = workoutToSave({
      id: workoutId('w1'),
      owner: OWNER,
      name: 'Empty',
      blocks: [],
      now: 1,
    });
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    expect(outcome.refusal.code).toBe('no-blocks');
    expect(outcome.refusal.message).toContain('Add at least one block');
  });

  it('refuses a blank name before it looks at the blocks', () => {
    expect(
      refusalOf(workoutToSave({ id: workoutId('w1'), owner: OWNER, name: '', blocks: [], now: 1 })),
    ).toBe('name-required');
  });

  it('keeps the original creation time when an existing workout is edited', () => {
    // ⚠️ Otherwise a rename reorders the library, and a rider's oldest workout
    // jumps to the top the moment they fix a typo in its name.
    const existing = built<WorkoutRecord>(
      workoutToSave({ id: workoutId('w1'), owner: OWNER, name: 'First', blocks, now: 1000 }),
    );
    const edited = built<WorkoutRecord>(
      workoutToSave({
        id: workoutId('w2'),
        owner: OWNER,
        name: 'Renamed',
        blocks,
        now: 9000,
        existing,
      }),
    );
    expect(edited.id).toBe(existing.id);
    expect(edited.createdAt).toBe(1000);
    expect(edited.updatedAt).toBe(9000);
  });

  it('refuses a block that reached it past the types', () => {
    // The screen cannot produce this — `blockFromDraft` is the only path — but
    // `workoutToSave` validates anyway, because it is the function that decides
    // whether a record is safe to write and a record that could not survive its
    // own read should never be written.
    const forged = [{ kind: 'steady', seconds: 600, target: 88 }] as unknown as WorkoutBlock[];
    expect(
      refusalOf(
        workoutToSave({
          id: workoutId('w1'),
          owner: OWNER,
          name: 'Forged',
          blocks: forged,
          now: 1,
        }),
      ),
    ).toBe('bad-target');
  });
});
