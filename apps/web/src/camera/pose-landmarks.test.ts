// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The model's 33 points, down to the near side's sure ones** — #530.
 */

import { describe, expect, it } from 'vitest';

import {
  MINIMUM_LANDMARK_VISIBILITY,
  MODEL_INDEX,
  MODEL_LANDMARK_COUNT,
  MODEL_VALUES_PER_LANDMARK,
  sidePoseFromModel,
} from './pose-landmarks';
import { SIDE_POSE_LANDMARKS, type SidePoseLandmark } from './side-analysis-port';

/**
 * A model output: every point hidden (visibility 0) at the centre, then the
 * given points set. `side` sets each named landmark on that side.
 */
function output(
  points: readonly {
    name: SidePoseLandmark;
    side: 'left' | 'right';
    x?: number;
    y?: number;
    visibility?: number;
  }[],
): number[] {
  const values: number[] = Array.from(
    { length: MODEL_LANDMARK_COUNT * MODEL_VALUES_PER_LANDMARK },
    (_, index) => (index % MODEL_VALUES_PER_LANDMARK === 2 ? 0 : 0.5),
  );
  for (const point of points) {
    const at = MODEL_INDEX[point.name][point.side] * MODEL_VALUES_PER_LANDMARK;
    values[at] = point.x ?? 0.4;
    values[at + 1] = point.y ?? 0.6;
    values[at + 2] = point.visibility ?? 0.9;
  }
  return values;
}

function everyPoint(side: 'left' | 'right', visibility = 0.9) {
  return SIDE_POSE_LANDMARKS.map((name, index) => ({
    name,
    side,
    x: 0.1 + index * 0.05,
    y: 0.2 + index * 0.05,
    visibility,
  }));
}

describe('what the tablet keeps of one picture', () => {
  it('keeps the near side’s nine points, as shares of the picture, and the picture’s shape', () => {
    const outcome = sidePoseFromModel(256, 192, output(everyPoint('right')));
    expect(outcome.kind).toBe('pose');
    if (outcome.kind !== 'pose') {
      return;
    }
    expect(outcome.pose.nearSide).toBe('right');
    expect(outcome.pose.aspect).toBeCloseTo(256 / 192);
    expect(outcome.pose.landmarks.map((mark) => mark.name)).toEqual([...SIDE_POSE_LANDMARKS]);
    expect(outcome.pose.landmarks[0]).toEqual({ name: 'ear', x: 0.1, y: 0.2, visibility: 0.9 });
  });

  it('takes the more visible side as the near one, and keeps none of the far side', () => {
    const outcome = sidePoseFromModel(
      256,
      256,
      output([
        ...everyPoint('left', 0.95),
        // The far side, faintly, at a position no near-side point has.
        ...everyPoint('right', 0.6).map((point) => ({ ...point, x: 0.99 })),
      ]),
    );
    expect(outcome.kind === 'pose' ? outcome.pose.nearSide : undefined).toBe('left');
    expect(
      outcome.kind === 'pose' ? outcome.pose.landmarks.some((mark) => mark.x === 0.99) : true,
    ).toBe(false);
  });

  it('keeps a point at exactly the visibility floor and drops one just under it', () => {
    const outcome = sidePoseFromModel(
      256,
      256,
      output([
        { name: 'hip', side: 'left', visibility: 0.9 },
        { name: 'knee', side: 'left', visibility: 0.9 },
        { name: 'ankle', side: 'left', visibility: MINIMUM_LANDMARK_VISIBILITY },
        { name: 'toe', side: 'left', visibility: MINIMUM_LANDMARK_VISIBILITY - 0.01 },
      ]),
    );
    expect(outcome.kind === 'pose' ? outcome.pose.landmarks.map((mark) => mark.name) : []).toEqual([
      'hip',
      'knee',
      'ankle',
    ]);
  });

  it('drops a point the model placed outside the picture', () => {
    const outcome = sidePoseFromModel(
      256,
      256,
      output([
        { name: 'hip', side: 'left' },
        { name: 'knee', side: 'left' },
        { name: 'ankle', side: 'left' },
        { name: 'toe', side: 'left', y: 1.02 },
        { name: 'ear', side: 'left', x: -0.01 },
      ]),
    );
    expect(outcome.kind === 'pose' ? outcome.pose.landmarks.map((mark) => mark.name) : []).toEqual([
      'hip',
      'knee',
      'ankle',
    ]);
  });
});

describe('when there is nobody to keep', () => {
  it('is no-rider when the model found nobody', () => {
    expect(sidePoseFromModel(256, 256, [])).toEqual({ kind: 'no-rider' });
  });

  it('is no-rider with fewer sure points than a placement needs', () => {
    const two = output([
      { name: 'hip', side: 'left' },
      { name: 'knee', side: 'left' },
    ]);
    expect(sidePoseFromModel(256, 256, two)).toEqual({ kind: 'no-rider' });
  });
});

describe('what is a fault in the worker’s answer', () => {
  it('is unreadable for the wrong number of values, a non-finite one, or no picture size', () => {
    const good = output(everyPoint('left'));
    expect(sidePoseFromModel(256, 256, good.slice(1))).toEqual({ kind: 'unreadable' });
    expect(sidePoseFromModel(256, 256, [...good.slice(1), Number.NaN])).toEqual({
      kind: 'unreadable',
    });
    expect(sidePoseFromModel(0, 256, good)).toEqual({ kind: 'unreadable' });
    expect(sidePoseFromModel(256, Number.POSITIVE_INFINITY, good)).toEqual({
      kind: 'unreadable',
    });
  });
});
