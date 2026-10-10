// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds } from '../quantities';
import {
  workoutBlockText,
  workoutDurationText,
  workoutPercent,
  workoutShapeText,
} from './describe';
import { thresholdShare, type Workout } from './workout';

describe('a workout in words (#1100)', () => {
  it('says a duration in the unit a session is discussed in', () => {
    expect(workoutDurationText(45)).toBe('45 s');
    expect(workoutDurationText(600)).toBe('10 min');
    expect(workoutDurationText(3600)).toBe('1 h');
    expect(workoutDurationText(3720)).toBe('1 h 2 min');
    expect(workoutDurationText(-5)).toBe('0 s');
  });

  it('says a share as a whole percentage, never watts', () => {
    expect(workoutPercent(0.885)).toBe(89);
    expect(
      workoutBlockText({ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }),
    ).toBe('10 min at 60%');
  });

  it('says every block kind, and the shape is every block in order', () => {
    const workout: Workout = {
      name: 'Over-unders',
      blocks: [
        {
          kind: 'ramp',
          seconds: seconds(300),
          from: thresholdShare(0.6),
          to: thresholdShare(1.05),
        },
        {
          kind: 'intervals',
          repeats: 4,
          hardSeconds: seconds(180),
          hardTarget: thresholdShare(1.1),
          easySeconds: seconds(120),
          easyTarget: thresholdShare(0.5),
        },
        { kind: 'free-ride', seconds: seconds(420) },
      ],
    };
    expect(workoutShapeText(workout)).toBe(
      '5 min ramping 60% to 105%, 4 × 3 min at 110%, 2 min at 50%, 7 min free riding',
    );
  });
});
