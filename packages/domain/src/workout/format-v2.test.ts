// SPDX-License-Identifier: Apache-2.0

/**
 * Workout file format version 2 (#1239, ADR 0048 D-3, ADR 0017's 2026-10-09
 * amendment): the heart-rate hold block, and everything version 1 still is.
 */

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, seconds } from '../quantities';

import { WorkoutError, type WorkoutErrorCode } from './errors';
import { decodeWorkoutFile, encodeWorkoutFile, workoutFileVersionFor } from './format';
import {
  MAXIMUM_SEGMENTS,
  thresholdShare,
  validateWorkout,
  type HeartRateHoldBlock,
  type Workout,
} from './workout';

const hold: HeartRateHoldBlock = {
  kind: 'heart-rate-hold',
  seconds: seconds(1800),
  range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
  startShare: thresholdShare(0.55),
  ceilingShare: thresholdShare(0.8),
  label: 'Endurance',
};

const withHold: Workout = {
  name: 'Hold it',
  blocks: [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.5) },
    hold,
    { kind: 'free-ride', seconds: seconds(300) },
  ],
};

const refusal = (run: () => unknown): WorkoutErrorCode => {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkoutError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
};

/** Version-1 files as a build before #1239 wrote them, byte for byte. */
const VERSION_1_CORPUS: readonly string[] = [
  `{
  "onYourLeftWorkout": 1,
  "name": "Sweet spot",
  "blocks": [
    {
      "kind": "steady",
      "seconds": 600,
      "target": 0.6,
      "label": "Warm-up"
    },
    {
      "kind": "intervals",
      "repeats": 3,
      "hardSeconds": 600,
      "hardTarget": 0.9,
      "easySeconds": 300,
      "easyTarget": 0.55
    },
    {
      "kind": "free-ride",
      "seconds": 300
    }
  ]
}
`,
  `{
  "onYourLeftWorkout": 1,
  "name": "Ramp",
  "description": "Up, then down.",
  "blocks": [
    {
      "kind": "ramp",
      "seconds": 300,
      "from": 0.4,
      "to": 0.75
    }
  ]
}
`,
];

describe('version 1 is unchanged', () => {
  it('a version-1 corpus round-trips byte-identically', () => {
    for (const text of VERSION_1_CORPUS) {
      expect(encodeWorkoutFile(decodeWorkoutFile(text))).toBe(text);
    }
  });

  it('a workout with no hold is still written as version 1, so an older build opens it', () => {
    const workout = decodeWorkoutFile(VERSION_1_CORPUS[0] ?? '');
    expect(workoutFileVersionFor(workout)).toBe(1);
    expect(encodeWorkoutFile(workout)).toContain('"onYourLeftWorkout": 1,');
  });

  it('a version-1 file carrying a hold is refused: version 1 has no such block', () => {
    const text = encodeWorkoutFile(withHold).replace(
      '"onYourLeftWorkout": 2',
      '"onYourLeftWorkout": 1',
    );
    expect(refusal(() => decodeWorkoutFile(text))).toBe('unknown-block');
  });
});

describe('version 2 carries the heart-rate hold', () => {
  it('a version-2 file round-trips, in both directions', () => {
    const text = encodeWorkoutFile(withHold);
    expect(text).toContain('"onYourLeftWorkout": 2,');
    expect(decodeWorkoutFile(text)).toStrictEqual(withHold);
    expect(encodeWorkoutFile(decodeWorkoutFile(text))).toBe(text);
  });

  it('writes a range as its two numbers and nothing else', () => {
    const extra = { ...hold, range: { ...hold.range, colour: 'red' } };
    const text = encodeWorkoutFile({ name: 'x', blocks: [extra] });
    expect(decodeWorkoutFile(text).blocks[0]).toStrictEqual({ ...hold });
  });

  it('refuses an unknown key on a hold block, and on its range', () => {
    /** A fresh copy of the file's document, and its hold block's two records. */
    const fresh = () => {
      const document = JSON.parse(encodeWorkoutFile(withHold)) as {
        blocks: Record<string, unknown>[];
      };
      const block = document.blocks[1] ?? {};
      return { document, block, range: block['range'] as Record<string, unknown> };
    };
    const onBlock = fresh();
    onBlock.block['floorShare'] = 0.3;
    expect(refusal(() => decodeWorkoutFile(JSON.stringify(onBlock.document)))).toBe(
      'unknown-field',
    );

    const onRange = fresh();
    onRange.range['target'] = 135;
    expect(refusal(() => decodeWorkoutFile(JSON.stringify(onRange.document)))).toBe(
      'unknown-field',
    );

    const missing = fresh();
    missing.range['high'] = undefined;
    expect(refusal(() => decodeWorkoutFile(JSON.stringify(missing.document)))).toBe(
      'not-a-workout-file',
    );
  });

  it(`MAXIMUM_SEGMENTS (${String(MAXIMUM_SEGMENTS)}) still bounds a version-2 file`, () => {
    const intervals = {
      kind: 'intervals',
      repeats: 100,
      hardSeconds: 1,
      hardTarget: 1,
      easySeconds: 1,
      easyTarget: 0.5,
    };
    const document = {
      onYourLeftWorkout: 2,
      name: 'Too long',
      blocks: [
        ...Array.from({ length: Math.ceil(MAXIMUM_SEGMENTS / 200) }, () => intervals),
        JSON.parse(JSON.stringify(hold)),
      ],
    };
    expect(refusal(() => decodeWorkoutFile(JSON.stringify(document)))).toBe('workout-too-long');
  });
});

describe('what a hold block may say', () => {
  const ride = (overrides: Record<string, unknown>): WorkoutErrorCode =>
    refusal(() => validateWorkout({ name: 'x', blocks: [{ ...hold, ...overrides }] }));

  it('accepts the shape ADR 0048 D-3 approves', () => {
    expect(validateWorkout(withHold)).toBe(withHold);
  });

  it('refuses a range under 6 bpm, upside down, fractional, or outside 30–230 bpm', () => {
    expect(ride({ range: { low: 130, high: 135 } })).toBe('invalid-heart-rate-range');
    expect(ride({ range: { low: 140, high: 130 } })).toBe('invalid-heart-rate-range');
    expect(ride({ range: { low: 130.5, high: 140 } })).toBe('invalid-heart-rate-range');
    expect(ride({ range: { low: 25, high: 140 } })).toBe('invalid-heart-rate-range');
    expect(ride({ range: { low: 130, high: 231 } })).toBe('invalid-heart-rate-range');
    expect(ride({ range: undefined })).toBe('invalid-heart-rate-range');
  });

  it('refuses a ceiling over 0.85, a start above the ceiling, and a share out of range', () => {
    expect(ride({ ceilingShare: 0.9 })).toBe('target-out-of-range');
    expect(ride({ startShare: 0.82, ceilingShare: 0.8 })).toBe('target-out-of-range');
    expect(ride({ startShare: 0.1 })).toBe('target-out-of-range');
    expect(ride({ seconds: 0 })).toBe('invalid-duration');
  });
});
