// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Saving a workout to a file and reading one back — #202, ADR 0017.
 *
 * What is asserted here rather than in `packages/domain`'s `format.test.ts` is
 * what a *rider* gets: a filename they can find, a refusal they can act on, and
 * a record with this device's own identity on it rather than the file's.
 */

import { seconds, thresholdShare, unixSeconds, type WorkoutBlock } from '@onyourleft/domain';
import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { MAXIMUM_NAME_LENGTH } from './build';
import { exportedWorkout, workoutFromFile } from './transfer';

const ATHLETE = toAthleteId('athlete-a');

const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6), label: 'Warm-up' },
  {
    kind: 'intervals',
    repeats: 4,
    hardSeconds: seconds(180),
    hardTarget: thresholdShare(1.1),
    easySeconds: seconds(120),
    easyTarget: thresholdShare(0.5),
  },
];

function record(overrides: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const name = overrides.name ?? 'Sweet spot';
  return {
    id: workoutId('workout-1'),
    createdBy: ATHLETE,
    name,
    workout: { name, description: 'Four by three.', blocks },
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}

const IMPORT = { id: workoutId('workout-new'), owner: ATHLETE, now: 1_700_000_500 };

const textOf = (file: { bytes: Uint8Array }): string => new TextDecoder().decode(file.bytes);

describe('a workout leaves as a file a rider can find again', () => {
  it('names the file after the workout', () => {
    expect(exportedWorkout(record()).fileName).toBe('Sweet spot.oylworkout.json');
  });

  it('takes the characters a filename cannot hold out of the name', () => {
    // The same `safeFileStem` an activity export uses, rather than a second
    // sanitiser here that would sanitise slightly differently.
    expect(exportedWorkout(record({ name: 'Hills / Sat' })).fileName).toBe(
      'Hills - Sat.oylworkout.json',
    );
  });

  it('says the file is JSON, because it is', () => {
    expect(exportedWorkout(record()).mediaType).toBe('application/json');
  });

  it('carries the description, which the store used to drop', () => {
    expect(textOf(exportedWorkout(record()))).toContain('Four by three.');
  });
});

describe('a workout comes back as a workout on THIS device', () => {
  it('round-trips through the file and back into a record', () => {
    const original = record();
    const outcome = workoutFromFile(textOf(exportedWorkout(original)), IMPORT);
    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') return;
    expect(outcome.record.workout).toStrictEqual(original.workout);
  });

  it('takes this device’s id and clock, not the file’s', () => {
    // ⚠️ The file carries no id and no timestamps at all, so there is nothing
    // to take — this asserts the record is stamped rather than defaulted, which
    // is what stops an imported workout sorting by somebody else's clock.
    const outcome = workoutFromFile(textOf(exportedWorkout(record())), IMPORT);
    if (outcome.status !== 'imported') throw new Error('expected an import');
    expect(outcome.record.id).toBe('workout-new');
    expect(outcome.record.createdBy).toBe(ATHLETE);
    expect(outcome.record.createdAt).toBe(1_700_000_500);
    expect(outcome.record.updatedAt).toBe(1_700_000_500);
  });

  it('gives the record the name the file carries', () => {
    const outcome = workoutFromFile(textOf(exportedWorkout(record({ name: 'Ramps' }))), IMPORT);
    if (outcome.status !== 'imported') throw new Error('expected an import');
    expect(outcome.record.name).toBe('Ramps');
  });
});

describe('what a rider is told when the file will not do', () => {
  const refusalFor = (text: string): { code: string; message: string } => {
    const outcome = workoutFromFile(text, IMPORT);
    if (outcome.status !== 'refused') throw new Error('expected a refusal');
    return outcome.refusal;
  };

  it('passes the domain’s own sentence through rather than rewording it', () => {
    // Two wordings of one fault is how a rider gets told different things
    // depending on which door they came through.
    const refusal = refusalFor('{"nope":true}');
    expect(refusal.code).toBe('not-a-workout-file');
    expect(refusal.message).toContain('onYourLeftWorkout');
  });

  it('tells a rider with a newer file what to do about it', () => {
    expect(refusalFor('{"onYourLeftWorkout":99,"name":"x","blocks":[]}').code).toBe(
      'unsupported-version',
    );
  });

  it('refuses a target that would ask a trainer for 88 times threshold', () => {
    const hostile = JSON.stringify({
      onYourLeftWorkout: 1,
      name: 'Hostile',
      blocks: [{ kind: 'steady', seconds: 600, target: 88 }],
    });
    expect(refusalFor(hostile).code).toBe('target-out-of-range');
  });

  it('refuses a name too long for a row, rather than truncating it', () => {
    // Truncating would save something the rider did not choose, under a name
    // they would not recognise.
    const long = JSON.stringify({
      onYourLeftWorkout: 1,
      name: 'n'.repeat(MAXIMUM_NAME_LENGTH + 1),
      blocks: [{ kind: 'steady', seconds: 600, target: 0.6 }],
    });
    const refusal = refusalFor(long);
    expect(refusal.code).toBe('name-too-long');
    expect(refusal.message).toContain(String(MAXIMUM_NAME_LENGTH));
  });

  it('refuses a file whose blocks would expand past what this program will ride', () => {
    const many = JSON.stringify({
      onYourLeftWorkout: 1,
      name: 'Absurd',
      blocks: Array.from({ length: 60 }, () => ({
        kind: 'intervals',
        repeats: 100,
        hardSeconds: 30,
        hardTarget: 1.05,
        easySeconds: 30,
        easyTarget: 0.6,
      })),
    });
    expect(refusalFor(many).code).toBe('workout-too-long');
  });
});
