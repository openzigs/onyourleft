// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds, thresholdShare, unixSeconds, type WorkoutBlock } from '@onyourleft/domain';
import { athleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { blockText, durationText, hardestShare, percentOf, workoutRow } from './library';

const OWNER = athleteId('rider');

const recordFor = (blocks: readonly WorkoutBlock[], name = 'Session'): WorkoutRecord => ({
  id: workoutId('w1'),
  createdBy: OWNER,
  name,
  workout: { name, blocks },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
});

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

describe('a length is written the way a rider says it', () => {
  it.each([
    [45, '45 s'],
    [59, '59 s'],
    [60, '1 min'],
    [600, '10 min'],
    [3540, '59 min'],
    [3600, '1 h'],
    [3720, '1 h 2 min'],
    [7380, '2 h 3 min'],
  ])('%i seconds reads as %o', (input, expected) => {
    expect(durationText(input)).toBe(expected);
  });

  it('never writes "1 h 0 min"', () => {
    expect(durationText(3599)).toBe('1 h');
    expect(durationText(3600)).toBe('1 h');
  });
});

describe('a share is shown as a percentage', () => {
  it.each([
    [0.6, 60],
    [0.885, 89],
    [1.1, 110],
  ])('%f reads as %i', (share, expected) => {
    expect(percentOf(share)).toBe(expected);
  });
});

describe('a block is described in words', () => {
  it('describes a steady block', () => {
    expect(blockText(steady(600, 0.65))).toBe('10 min at 65%');
  });

  it('describes a ramp by both ends', () => {
    expect(
      blockText({
        kind: 'ramp',
        seconds: seconds(300),
        from: thresholdShare(0.6),
        to: thresholdShare(1.05),
      }),
    ).toBe('5 min ramping 60% to 105%');
  });

  it('describes intervals the way a rider writes them down', () => {
    expect(
      blockText({
        kind: 'intervals',
        repeats: 4,
        hardSeconds: seconds(180),
        hardTarget: thresholdShare(1.1),
        easySeconds: seconds(120),
        easyTarget: thresholdShare(0.5),
      }),
    ).toBe('4 × 3 min at 110%, 2 min at 50%');
  });

  it('calls a free ride free riding, and never "at 0%"', () => {
    // ⚠️ A target of zero is the one thing the player is careful never to send
    // — `session.ts` releases the trainer instead — so a row that said 0% would
    // be describing the opposite instruction.
    const text = blockText({ kind: 'free-ride', seconds: seconds(420) });
    expect(text).toBe('7 min free riding');
    expect(text).not.toContain('0%');
  });
});

describe('the hardest target is the one a rider wants to know', () => {
  it('is undefined for a workout that is all free riding', () => {
    expect(
      hardestShare({ name: 'Spin', blocks: [{ kind: 'free-ride', seconds: seconds(600) }] }),
    ).toBeUndefined();
  });

  it('reads both ends of a ramp, so a descent from 120% is not called easy', () => {
    expect(
      hardestShare({
        name: 'Down',
        blocks: [
          {
            kind: 'ramp',
            seconds: seconds(300),
            from: thresholdShare(1.2),
            to: thresholdShare(0.6),
          },
        ],
      }),
    ).toBeCloseTo(1.2, 10);
  });

  it('reads an intervals block’s recovery too', () => {
    // An "easy" leg written at 95% is a workout with no recovery in it, and a
    // row that hid that would describe a gentler session than the real one.
    expect(
      hardestShare({
        name: 'No rest',
        blocks: [
          {
            kind: 'intervals',
            repeats: 3,
            hardSeconds: seconds(60),
            hardTarget: thresholdShare(0.9),
            easySeconds: seconds(60),
            easyTarget: thresholdShare(0.95),
          },
        ],
      }),
    ).toBeCloseTo(0.95, 10);
  });

  it('reads an intervals block’s hard target, which is usually the hardest thing in a workout', () => {
    expect(
      hardestShare({
        name: 'Vo2',
        blocks: [
          steady(600, 0.6),
          {
            kind: 'intervals',
            repeats: 5,
            hardSeconds: seconds(180),
            hardTarget: thresholdShare(1.2),
            easySeconds: seconds(180),
            easyTarget: thresholdShare(0.5),
          },
        ],
      }),
    ).toBeCloseTo(1.2, 10);
  });

  it('takes the maximum across blocks, not the last one', () => {
    expect(hardestShare({ name: 'Mixed', blocks: [steady(60, 1.2), steady(60, 0.5)] })).toBeCloseTo(
      1.2,
      10,
    );
  });
});

describe('a row is what a rider reads in the list', () => {
  it('takes its total from the expansion, not from summing the blocks', () => {
    // ⚠️ An intervals block lasts `repeats × (hard + easy)`, and writing that
    // arithmetic a second time here is how a row comes to disagree with the
    // clock the rider watches.
    const row = workoutRow(
      recordFor([
        {
          kind: 'intervals',
          repeats: 4,
          hardSeconds: seconds(180),
          hardTarget: thresholdShare(1.1),
          easySeconds: seconds(120),
          easyTarget: thresholdShare(0.5),
        },
      ]),
    );
    expect(row.totalSeconds).toBe(4 * 300);
    expect(row.duration).toBe('20 min');
  });

  it('counts the blocks the rider wrote, not the segments they expand to', () => {
    const row = workoutRow(
      recordFor([
        steady(600, 0.6),
        {
          kind: 'intervals',
          repeats: 6,
          hardSeconds: seconds(60),
          hardTarget: thresholdShare(1.2),
          easySeconds: seconds(60),
          easyTarget: thresholdShare(0.5),
        },
      ]),
    );
    // Two, not thirteen: a rider who wrote "6 ×" reads "2 blocks".
    expect(row.blockCount).toBe(2);
  });

  it('describes the shape in order', () => {
    const row = workoutRow(recordFor([steady(600, 0.6), steady(300, 1.0)]));
    expect(row.shape).toBe('10 min at 60%, 5 min at 100%');
  });

  it('carries no load, no score and no watts', () => {
    // ⚠️ Every such number is a function of the rider's threshold, and a
    // library row that quoted one would be quoting one threshold's answer for a
    // workout that is deliberately threshold-independent.
    const row = workoutRow(recordFor([steady(600, 0.6)]));
    expect(Object.keys(row).sort()).toEqual(
      ['blockCount', 'duration', 'hardestPercent', 'id', 'name', 'shape', 'totalSeconds'].sort(),
    );
    expect(JSON.stringify(row)).not.toContain('W');
  });

  it('reports no hardest target for an all-free-ride workout', () => {
    expect(
      workoutRow(recordFor([{ kind: 'free-ride', seconds: seconds(600) }])).hardestPercent,
    ).toBeUndefined();
  });
});
