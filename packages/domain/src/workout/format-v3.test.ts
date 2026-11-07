// SPDX-License-Identifier: Apache-2.0

/**
 * Workout file format version 3 (#2302, ADR 0017's 2026-11-07 amendment):
 * the advisory cadence cue, written only when a workout carries one, so a
 * workout without a cue is still the version-1 or version-2 file an older
 * build opens.
 */

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, revolutionsPerMinute, seconds } from '../quantities';

import { WorkoutError, type WorkoutErrorCode } from './errors';
import { decodeWorkoutFile, encodeWorkoutFile, workoutFileVersionFor } from './format';
import { expandWorkout } from './timeline';
import {
  MAXIMUM_CADENCE_CUE_RPM,
  MAXIMUM_SEGMENTS,
  MINIMUM_CADENCE_CUE_RPM,
  thresholdShare,
  validateWorkout,
  type CadenceCue,
  type HeartRateHoldBlock,
  type Workout,
  type WorkoutBlock,
} from './workout';

const rpm = (low: number, high: number): CadenceCue => ({
  low: revolutionsPerMinute(low),
  high: revolutionsPerMinute(high),
});

const hold: HeartRateHoldBlock = {
  kind: 'heart-rate-hold',
  seconds: seconds(1200),
  range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
  startShare: thresholdShare(0.55),
  ceilingShare: thresholdShare(0.8),
};

const plain: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.45), to: thresholdShare(0.7) },
  {
    kind: 'intervals',
    repeats: 4,
    hardSeconds: seconds(300),
    hardTarget: thresholdShare(0.85),
    easySeconds: seconds(180),
    easyTarget: thresholdShare(0.55),
    label: 'Low cadence',
  },
  { kind: 'free-ride', seconds: seconds(300) },
];

/** Every place a cue may stand: a steady block, a ramp, and both halves of an interval. */
const cued: Workout = {
  name: 'Big gear',
  description: 'Low cadence, eased into.',
  blocks: [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.5), cadence: rpm(85, 95) },
    {
      kind: 'ramp',
      seconds: seconds(60),
      from: thresholdShare(0.6),
      to: thresholdShare(0.85),
      cadence: rpm(70, 80),
    },
    {
      kind: 'intervals',
      repeats: 4,
      hardSeconds: seconds(300),
      hardTarget: thresholdShare(0.85),
      easySeconds: seconds(180),
      easyTarget: thresholdShare(0.55),
      label: 'Low cadence',
      hardCadence: rpm(60, 65),
      easyCadence: rpm(90, 90),
    },
    { kind: 'free-ride', seconds: seconds(300) },
  ],
};

const refusal = (run: () => unknown): WorkoutError => {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkoutError) return error;
    throw error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
};
const code = (run: () => unknown): WorkoutErrorCode => refusal(run).code;

/** The cued workout's file, as a document a test may change. */
const cuedDocument = () =>
  JSON.parse(encodeWorkoutFile(cued)) as {
    onYourLeftWorkout: number;
    blocks: Record<string, unknown>[];
  };

describe('a workout is written at the lowest version that carries it', () => {
  it('no cue and no hold: version 1', () => {
    const workout: Workout = { name: 'Plain', blocks: plain };
    expect(workoutFileVersionFor(workout)).toBe(1);
    expect(encodeWorkoutFile(workout)).toContain('"onYourLeftWorkout": 1,');
  });

  it('a hold and no cue: version 2', () => {
    const workout: Workout = { name: 'Held', blocks: [...plain, hold] };
    expect(workoutFileVersionFor(workout)).toBe(2);
    expect(encodeWorkoutFile(workout)).toContain('"onYourLeftWorkout": 2,');
  });

  it('a cue, anywhere a cue may stand, with or without a hold: version 3', () => {
    expect(workoutFileVersionFor(cued)).toBe(3);
    expect(encodeWorkoutFile(cued)).toContain('"onYourLeftWorkout": 3,');
    expect(workoutFileVersionFor({ name: 'x', blocks: [...cued.blocks, hold] })).toBe(3);
    // One cue on its own, in each place, is enough.
    for (const block of cued.blocks.filter((each) => each.kind !== 'free-ride')) {
      expect(workoutFileVersionFor({ name: 'x', blocks: [...plain, block] })).toBe(3);
    }
    const easyOnly = { ...plain[1], easyCadence: rpm(90, 95) } as WorkoutBlock;
    expect(workoutFileVersionFor({ name: 'x', blocks: [easyOnly] })).toBe(3);
  });
});

describe('version 3 carries the cue', () => {
  it('round-trips, in both directions', () => {
    const text = encodeWorkoutFile(cued);
    expect(decodeWorkoutFile(text)).toStrictEqual(cued);
    expect(encodeWorkoutFile(decodeWorkoutFile(text))).toBe(text);
  });

  it('writes a cue as its two numbers and nothing else', () => {
    const extra = {
      ...cued.blocks[0],
      cadence: { ...rpm(85, 95), colour: 'red' },
    } as unknown as WorkoutBlock;
    const text = encodeWorkoutFile({ name: 'x', blocks: [extra] });
    expect(decodeWorkoutFile(text).blocks[0]).toStrictEqual(cued.blocks[0]);
  });

  it('puts each interval half’s cue on that half’s segments, and none on a free ride', () => {
    const segments = expandWorkout(decodeWorkoutFile(encodeWorkoutFile(cued))).segments;
    expect(segments[0]?.cadence).toStrictEqual(rpm(85, 95));
    expect(segments[1]?.cadence).toStrictEqual(rpm(70, 80));
    expect(segments[2]?.cadence).toStrictEqual(rpm(60, 65));
    expect(segments[3]?.cadence).toStrictEqual(rpm(90, 90));
    expect(segments[8]?.cadence).toStrictEqual(rpm(60, 65));
    expect(segments[9]?.cadence).toStrictEqual(rpm(90, 90));
    expect(segments[10]?.cadence).toBeUndefined();
    expect(segments[10]?.from).toBeUndefined();
  });

  it('refuses a version-1 or version-2 file that carries a cue: neither version has one', () => {
    for (const version of [1, 2]) {
      const document = cuedDocument();
      document.onYourLeftWorkout = version;
      const refused = refusal(() => decodeWorkoutFile(JSON.stringify(document)));
      expect(refused.code).toBe('unknown-field');
      expect(refused.message).toContain(`version-${String(version)}`);
    }
    // Each place a cue may stand is refused on its own.
    for (const [index, key] of [
      [0, 'cadence'],
      [1, 'cadence'],
      [2, 'hardCadence'],
      [2, 'easyCadence'],
    ] as const) {
      const document = cuedDocument();
      document.onYourLeftWorkout = 2;
      document.blocks.forEach((block, at) => {
        for (const each of ['cadence', 'hardCadence', 'easyCadence']) {
          if (at !== index || each !== key) delete block[each];
        }
      });
      expect(code(() => decodeWorkoutFile(JSON.stringify(document)))).toBe('unknown-field');
    }
  });

  it('still refuses an unknown key on a block, and on a cue (ADR 0017 D-4)', () => {
    const onBlock = cuedDocument();
    (onBlock.blocks[0] ?? {})['cadenceTarget'] = 90;
    expect(code(() => decodeWorkoutFile(JSON.stringify(onBlock)))).toBe('unknown-field');

    const onCue = cuedDocument();
    ((onCue.blocks[0] ?? {})['cadence'] as Record<string, unknown>)['target'] = 90;
    expect(code(() => decodeWorkoutFile(JSON.stringify(onCue)))).toBe('unknown-field');

    // A cue on a block kind that has none is an unknown key there.
    const onFreeRide = cuedDocument();
    (onFreeRide.blocks[3] ?? {})['cadence'] = { low: 90, high: 95 };
    expect(code(() => decodeWorkoutFile(JSON.stringify(onFreeRide)))).toBe('unknown-field');

    const missing = cuedDocument();
    ((missing.blocks[0] ?? {})['cadence'] as Record<string, unknown>)['high'] = undefined;
    expect(code(() => decodeWorkoutFile(JSON.stringify(missing)))).toBe('not-a-workout-file');

    const text = cuedDocument();
    (text.blocks[0] ?? {})['cadence'] = { low: '85', high: 95 };
    expect(code(() => decodeWorkoutFile(JSON.stringify(text)))).toBe('not-a-workout-file');
  });

  it('refuses a version this build does not read', () => {
    const document = cuedDocument();
    document.onYourLeftWorkout = 4;
    const refused = refusal(() => decodeWorkoutFile(JSON.stringify(document)));
    expect(refused.code).toBe('unsupported-version');
    expect(refused.message).toContain('versions 1 to 3');
  });

  it(`MAXIMUM_SEGMENTS (${String(MAXIMUM_SEGMENTS)}) still bounds a version-3 file`, () => {
    const intervals = {
      kind: 'intervals',
      repeats: 100,
      hardSeconds: 1,
      hardTarget: 1,
      easySeconds: 1,
      easyTarget: 0.5,
      hardCadence: { low: 90, high: 100 },
    };
    const document = {
      onYourLeftWorkout: 3,
      name: 'Too long',
      blocks: Array.from({ length: Math.ceil(MAXIMUM_SEGMENTS / 200) + 1 }, () => intervals),
    };
    expect(code(() => decodeWorkoutFile(JSON.stringify(document)))).toBe('workout-too-long');
  });
});

describe(`what a cue may say: whole rpm, ${String(MINIMUM_CADENCE_CUE_RPM)}–${String(MAXIMUM_CADENCE_CUE_RPM)}, low first`, () => {
  const steady = (cadence: unknown): Workout => ({
    name: 'x',
    blocks: [
      {
        kind: 'steady',
        seconds: seconds(60),
        target: thresholdShare(0.6),
        cadence: cadence as CadenceCue,
      },
    ],
  });

  it('accepts the bounds themselves, and a single cadence', () => {
    expect(validateWorkout(steady(rpm(30, 150)))).toBeDefined();
    expect(validateWorkout(steady(rpm(90, 90)))).toBeDefined();
  });

  it('refuses a cue at 20 rpm, naming the field and the bound', () => {
    const refused = refusal(() => validateWorkout(steady({ low: 20, high: 60 })));
    expect(refused.code).toBe('invalid-cadence');
    expect(refused.message).toMatch(/^block 1's cadence cue must be two whole numbers/);
    expect(refused.message).toContain('between 30 and 150');
  });

  it('refuses a cue whose low is above its high, naming the field', () => {
    const refused = refusal(() => validateWorkout(steady({ low: 95, high: 85 })));
    expect(refused.code).toBe('invalid-cadence');
    expect(refused.message).toBe(
      "block 1's cadence cue runs from 95 to 85 rpm; its low must not be above its high",
    );
  });

  it('refuses above 150, a fraction, a missing end, a string and a bare number', () => {
    for (const bad of [
      { low: 90, high: 151 },
      { low: 29, high: 90 },
      { low: 90.5, high: 95 },
      { low: 90 },
      { low: '90', high: 95 },
      90,
      null,
    ]) {
      expect(code(() => validateWorkout(steady(bad)))).toBe('invalid-cadence');
    }
  });

  it('checks a cue wherever it stands: a ramp, and each half of an interval', () => {
    const [, ramp, intervals] = cued.blocks;
    const one = (block: unknown): Workout => ({ name: 'x', blocks: [block as WorkoutBlock] });
    const tooLow = { low: 20, high: 60 };
    const ramped = refusal(() => validateWorkout(one({ ...ramp, cadence: tooLow })));
    expect(ramped.message).toMatch(/^block 1's cadence cue/);
    const hard = refusal(() => validateWorkout(one({ ...intervals, hardCadence: tooLow })));
    expect(hard.message).toMatch(/^block 1's hard cadence cue/);
    const easy = refusal(() => validateWorkout(one({ ...intervals, easyCadence: tooLow })));
    expect(easy.message).toMatch(/^block 1's easy cadence cue/);
  });

  it('the file decoder refuses an out-of-range cue through validateWorkout', () => {
    const document = cuedDocument();
    (document.blocks[0] ?? {})['cadence'] = { low: 20, high: 60 };
    expect(code(() => decodeWorkoutFile(JSON.stringify(document)))).toBe('invalid-cadence');
  });
});
