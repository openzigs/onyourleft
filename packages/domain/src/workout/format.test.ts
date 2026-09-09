// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds } from '../quantities';

import { WorkoutError, type WorkoutErrorCode } from './errors';
import {
  decodeWorkoutFile,
  encodeWorkoutFile,
  MAXIMUM_WORKOUT_FILE_CHARACTERS,
  WORKOUT_FILE_VERSION,
} from './format';
import { thresholdShare, type Workout, type WorkoutBlock } from './workout';

const share = thresholdShare;

const everyKind: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: share(0.6), label: 'Warm-up' },
  { kind: 'ramp', seconds: seconds(300), from: share(0.6), to: share(0.9) },
  {
    kind: 'intervals',
    repeats: 6,
    hardSeconds: seconds(180),
    hardTarget: share(1.05),
    easySeconds: seconds(180),
    easyTarget: share(0.6),
    label: 'Over-unders',
  },
  { kind: 'free-ride', seconds: seconds(600), label: 'Spin down' },
];

const full: Workout = {
  name: 'Over-unders',
  description: 'Three blocks of six.',
  blocks: everyKind,
};

/** The refusal, or a failure saying nothing was refused. */
const refusal = (run: () => unknown): WorkoutError => {
  try {
    run();
  } catch (error) {
    if (error instanceof WorkoutError) return error;
    throw error;
  }
  throw new Error('expected a refusal, and nothing was thrown');
};

const refusedWith = (text: string): WorkoutErrorCode => refusal(() => decodeWorkoutFile(text)).code;

/** A document built from `full`, with one thing changed. */
const documentOf = (workout: Workout = full): Record<string, unknown> =>
  JSON.parse(encodeWorkoutFile(workout)) as Record<string, unknown>;

const reserialised = (document: unknown): string => JSON.stringify(document);

/** The same record without one key. `Reflect.deleteProperty` so lint sees no dynamic `delete`. */
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> => {
  const copy = { ...record };
  Reflect.deleteProperty(copy, key);
  return copy;
};

describe('a workout survives the round trip through a file', () => {
  it('brings back every field of every block kind', () => {
    // ⚠️ Asserting on the whole workout rather than field by field: a
    // per-field test passes for a decoder that drops the field the test forgot,
    // which is exactly what a format with four block shapes invites.
    expect(decodeWorkoutFile(encodeWorkoutFile(full))).toStrictEqual(full);
  });

  it('brings back a workout with no description', () => {
    const bare: Workout = { name: 'Bare', blocks: everyKind };
    const back = decodeWorkoutFile(encodeWorkoutFile(bare));
    expect(back).toStrictEqual(bare);
    expect('description' in back).toBe(false);
  });

  it('brings back a block with no label', () => {
    const unlabelled: Workout = {
      name: 'Unlabelled',
      blocks: [{ kind: 'steady', seconds: seconds(60), target: share(0.7) }],
    };
    const back = decodeWorkoutFile(encodeWorkoutFile(unlabelled));
    expect(back).toStrictEqual(unlabelled);
    expect('label' in back.blocks[0]!).toBe(false);
  });

  it('writes the version key, and writes it as the number it reads', () => {
    expect(documentOf()['onYourLeftWorkout']).toBe(WORKOUT_FILE_VERSION);
  });

  it('writes something a person can read and edit', () => {
    const text = encodeWorkoutFile(full);
    expect(text).toContain('\n  "name": "Over-unders"');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('what the encoder refuses to write', () => {
  it('refuses a workout it would not read back', () => {
    // A file that leaves here and cannot come back is discovered by a rider
    // after they have relied on it, which is why encode validates.
    const bad = { name: 'Bad', blocks: [{ kind: 'steady', seconds: 60, target: 88 }] };
    expect(refusal(() => encodeWorkoutFile(bad as unknown as Workout)).code).toBe(
      'target-out-of-range',
    );
  });

  it('writes only the fields the format defines, not whatever the caller hung on the block', () => {
    const smuggled = {
      name: 'Smuggled',
      blocks: [{ kind: 'steady', seconds: seconds(60), target: share(0.7), absoluteWatts: 400 }],
    } as unknown as Workout;
    // Were this a spread, the encoder would write a file its own decoder then
    // refuses under `unknown-field` — a failure the writer would never see.
    expect(encodeWorkoutFile(smuggled)).not.toContain('absoluteWatts');
    expect(() => decodeWorkoutFile(encodeWorkoutFile(smuggled))).not.toThrow();
  });
});

describe('what the decoder refuses, and what it calls each refusal', () => {
  it('refuses text that is not JSON', () => {
    expect(refusedWith('not json at all')).toBe('not-a-workout-file');
  });

  it('refuses JSON that is not an object', () => {
    expect(refusedWith('[]')).toBe('not-a-workout-file');
    expect(refusedWith('42')).toBe('not-a-workout-file');
    expect(refusedWith('null')).toBe('not-a-workout-file');
  });

  it('refuses a document with no version key, whatever else it holds', () => {
    const error = refusal(() =>
      decodeWorkoutFile(reserialised(without(documentOf(), 'onYourLeftWorkout'))),
    );
    expect(error.code).toBe('not-a-workout-file');
    expect(error.message).toContain('onYourLeftWorkout');
  });

  it('tells a rider with a newer file that they need a newer program', () => {
    const error = refusal(() =>
      decodeWorkoutFile(reserialised({ ...documentOf(), onYourLeftWorkout: 2 })),
    );
    expect(error.code).toBe('unsupported-version');
    expect(error.message).toContain('newer version');
  });

  it('refuses a version that is the right number in the wrong type', () => {
    expect(refusedWith(reserialised({ ...documentOf(), onYourLeftWorkout: '1' }))).toBe(
      'unsupported-version',
    );
  });

  it('reads the version before it complains about anything else', () => {
    // A v2 file will carry v2 fields. Reporting the unknown field first would
    // tell a rider their file is malformed when it is merely newer.
    const future = { ...documentOf(), onYourLeftWorkout: 2, cooldownStrategy: 'gentle' };
    expect(refusedWith(reserialised(future))).toBe('unsupported-version');
  });
});

describe('an unknown field is refused rather than ignored — ADR 0017 D-4', () => {
  it('refuses an unknown key at the top level', () => {
    const error = refusal(() =>
      decodeWorkoutFile(reserialised({ ...documentOf(), author: 'somebody' })),
    );
    expect(error.code).toBe('unknown-field');
    expect(error.message).toContain('author');
  });

  it('refuses an unknown key inside a block', () => {
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    // The field that makes this rule worth its cost: silently dropped, this
    // block would ride at 0.6 of threshold instead of at 400 W, and the file
    // would report success.
    blocks[0] = { ...blocks[0], absoluteWatts: 400 };
    const error = refusal(() => decodeWorkoutFile(reserialised(document)));
    expect(error.code).toBe('unknown-field');
    expect(error.message).toContain('absoluteWatts');
    expect(error.message).toContain('block 1');
  });

  it('refuses a key a block of a DIFFERENT kind would have accepted', () => {
    // `repeats` is real, and meaningless on a steady block. Accepting it
    // because it is spelled correctly somewhere in the format is the leniency
    // this rule exists to refuse.
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    blocks[0] = { ...blocks[0], repeats: 4 };
    expect(refusedWith(reserialised(document))).toBe('unknown-field');
  });

  it('refuses __proto__ as the unknown key it is, rather than acting on it', () => {
    // `JSON.parse` makes `__proto__` an own data property rather than invoking
    // the setter, so nothing is polluted — but a decoder that ignored unknown
    // keys would carry it silently, and this asserts the refusal rather than
    // trusting the engine's behaviour to stay that way.
    const text = `{"onYourLeftWorkout":1,"name":"x","blocks":[],"__proto__":{"polluted":true}}`;
    expect(refusedWith(text)).toBe('unknown-field');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('names a required key that is missing', () => {
    const error = refusal(() => decodeWorkoutFile(reserialised(without(documentOf(), 'name'))));
    expect(error.code).toBe('not-a-workout-file');
    expect(error.message).toContain('name');
  });

  it('names a required key that is missing from a block', () => {
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    blocks[0] = without(blocks[0]!, 'target');
    const error = refusal(() => decodeWorkoutFile(reserialised(document)));
    expect(error.code).toBe('not-a-workout-file');
    expect(error.message).toContain('target');
  });
});

describe('the shape checks the decoder makes before the meaning checks', () => {
  it('refuses blocks that are not a list', () => {
    expect(refusedWith(reserialised({ ...documentOf(), blocks: {} }))).toBe('not-a-workout-file');
  });

  it('refuses a block that is not an object', () => {
    expect(refusedWith(reserialised({ ...documentOf(), blocks: ['steady'] }))).toBe(
      'not-a-workout-file',
    );
  });

  it('refuses a block kind it does not know, and says which it does', () => {
    const error = refusal(() =>
      decodeWorkoutFile(
        reserialised({ ...documentOf(), blocks: [{ kind: 'sprint', seconds: 5 }] }),
      ),
    );
    expect(error.code).toBe('unknown-block');
    expect(error.message).toContain('free-ride');
  });

  it('refuses a number written as a string rather than coercing it', () => {
    // "60" reaching a trainer's clock as sixty seconds by coercion is the quiet
    // success this decoder exists to prevent — and `Number.isFinite` alone
    // would not have caught it, because the value never reaches arithmetic.
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    blocks[0] = { ...blocks[0], seconds: '600' };
    expect(refusedWith(reserialised(document))).toBe('not-a-workout-file');
  });

  it('refuses a name that is blank', () => {
    expect(refusedWith(reserialised({ ...documentOf(), name: '   ' }))).toBe('not-a-workout-file');
  });

  it('refuses a file longer than it will parse, without parsing it', () => {
    const error = refusal(() => decodeWorkoutFile('x'.repeat(MAXIMUM_WORKOUT_FILE_CHARACTERS + 1)));
    expect(error.code).toBe('file-too-large');
  });
});

describe('the meaning checks are validateWorkout, not a second copy of it', () => {
  it('refuses a target that is a percentage, and names the block', () => {
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    blocks[0] = { ...blocks[0], target: 88 };
    const error = refusal(() => decodeWorkoutFile(reserialised(document)));
    expect(error.code).toBe('target-out-of-range');
    // The message that locates the block is `validateWorkout`'s, which is the
    // point: this decoder defers rather than writing its own range check with
    // its own wording that can drift.
    expect(error.message).toContain("block 1's target");
    expect(error.message).toContain('88 times threshold');
  });

  it('refuses a workout with no blocks', () => {
    expect(refusedWith(reserialised({ ...documentOf(), blocks: [] }))).toBe('empty-workout');
  });

  it('refuses a negative duration through the same path', () => {
    const document = documentOf();
    const blocks = document['blocks'] as Record<string, unknown>[];
    blocks[0] = { ...blocks[0], seconds: -600 };
    expect(refusedWith(reserialised(document))).toBe('invalid-duration');
  });

  it('refuses a file whose blocks would expand past the segment bound', () => {
    // The resource-exhaustion case, and the reason the bound is in
    // `validateWorkout` rather than here: a hand-edited store row reaches it by
    // a different route and meets the same rule.
    const many = Array.from({ length: 60 }, () => ({
      kind: 'intervals',
      repeats: 100,
      hardSeconds: 30,
      hardTarget: 1.05,
      easySeconds: 30,
      easyTarget: 0.6,
    }));
    expect(refusedWith(reserialised({ ...documentOf(), blocks: many }))).toBe('workout-too-long');
  });
});
