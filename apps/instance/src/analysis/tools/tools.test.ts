// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The agent's tools (#1098, ADR 0046 D-7), one at a time: their schemas,
 * their bounds, what they refuse to return, and the store read under them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encodeWorkoutFile, seconds, thresholdShare } from '@onyourleft/domain';

import { RIDE_INPUT } from '../agent-testing.ts';
import { openSqlStore } from '../../store/open-sql-store.ts';
import type { SqlStore } from '../../store/sql-store.ts';
import {
  createStoreHarness,
  registrationFixture,
  type StoreHarness,
} from '../../store/testing/index.ts';
import type { AnalysisReads, ReadItem, ToolReadKind } from './reads.ts';
import {
  AGENT_TOOLS,
  GOALS,
  GOALS_CHARACTERS,
  RECENT_RIDES,
  RECENT_RIDES_DEFAULT,
  RECENT_RIDES_LIMIT,
  RIDE_SECTIONS,
  RIDE_SUMMARY_CHARACTERS,
  WORKOUTS,
  WORKOUTS_CHARACTERS,
  WORKOUTS_LIMIT,
  type ToolContext,
} from './tools.ts';

const encode = (text: string) => new TextEncoder().encode(text);

/** Reads that answer from a list, recording what was asked. */
function listReads(items: Partial<Record<ToolReadKind, readonly string[]>>) {
  const asked: { kind: ToolReadKind; limit: number; athleteId: string }[] = [];
  const reads: AnalysisReads = {
    listLiveSyncItems: (athleteId, kind, limit) => {
      asked.push({ athleteId, kind, limit });
      // Deliberately more than asked for: the tool holds its own bound.
      return Promise.resolve((items[kind] ?? []).map((body): ReadItem => ({ body: encode(body) })));
    },
  };
  return { reads, asked };
}

const context = (reads: AnalysisReads): ToolContext => ({
  athleteId: 'athlete-a',
  input: RIDE_INPUT,
  reads,
});

describe('ride_sections', () => {
  it('returns every section, or one, from the device-built input — and never the pose summary', async () => {
    const { reads } = listReads({});
    const all = await RIDE_SECTIONS.run(context(reads), {});
    expect(JSON.parse(all)).toHaveLength(3);
    expect(all).not.toContain('torso');
    expect(all).not.toContain('posed');
    const one = await RIDE_SECTIONS.run(context(reads), { section: 2 });
    expect(JSON.parse(one)).toMatchObject([{ index: 2, kind: 'climb' }]);
    expect(await RIDE_SECTIONS.run(context(reads), { section: 7 })).toContain('no section');
  });

  it('takes a section from 1 to 8 and nothing else', () => {
    expect(RIDE_SECTIONS.validate({})).toStrictEqual({ ok: true, args: {} });
    expect(RIDE_SECTIONS.validate({ section: 8 }).ok).toBe(true);
    for (const bad of [
      { section: 0 },
      { section: 9 },
      { section: 1.5 },
      { section: '1' },
      null,
      [],
    ]) {
      expect(RIDE_SECTIONS.validate(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(RIDE_SECTIONS.validate({ athleteId: 'athlete-b' }).ok).toBe(false);
  });
});

describe('recent_rides', () => {
  const summary = (text: string) => JSON.stringify({ passages: [text] });

  it('asks the store for the job’s athlete and at most the count, and returns no more than it asked for', async () => {
    const { reads, asked } = listReads({
      'ride-summary': Array.from({ length: 12 }, (_, index) =>
        summary(`Ride number ${String(index)}.`),
      ),
    });
    const three = await RECENT_RIDES.run(context(reads), { count: 3 });
    expect(three.split('\n')).toHaveLength(3);
    expect(three).toContain('Ride 1 (most recent): Ride number 0.');
    const unsaid = await RECENT_RIDES.run(context(reads), {});
    expect(unsaid.split('\n')).toHaveLength(RECENT_RIDES_DEFAULT);
    expect(asked).toStrictEqual([
      { athleteId: 'athlete-a', kind: 'ride-summary', limit: 3 },
      { athleteId: 'athlete-a', kind: 'ride-summary', limit: RECENT_RIDES_DEFAULT },
    ]);
  });

  it('takes a count from 1 to 8, and refuses more', () => {
    expect(RECENT_RIDES.validate({ count: RECENT_RIDES_LIMIT }).ok).toBe(true);
    expect(RECENT_RIDES.validate({ count: RECENT_RIDES_LIMIT + 1 }).ok).toBe(false);
    expect(RECENT_RIDES.validate({ count: 3, path: '/etc' }).ok).toBe(false);
  });

  it('cuts a long summary to its bound, and leaves out one that is not a summary or carries a picture', async () => {
    const { reads } = listReads({
      'ride-summary': [
        summary('word '.repeat(1_000)),
        'not json',
        JSON.stringify({ text: 'no passages field' }),
        summary('My position: data:image/jpeg;base64,/9j/4AAQ'),
        summary('A short ride.'),
      ],
    });
    const result = await RECENT_RIDES.run(context(reads), { count: 8 });
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.length).toBeLessThanOrEqual(
      'Ride 1 (most recent): '.length + RIDE_SUMMARY_CHARACTERS,
    );
    expect(lines[1]).toBe('Ride 2: A short ride.');
    expect(result).not.toContain('data:');
  });

  it('says so when nothing is synced', async () => {
    expect(await RECENT_RIDES.run(context(listReads({}).reads), {})).toBe(
      'No summaries of other rides are synced.',
    );
  });
});

describe('goals', () => {
  it('returns the rider’s own text, JSON or plain, newest first, at most 4 000 characters', async () => {
    const { reads, asked } = listReads({
      goal: [
        JSON.stringify({ text: 'Ride a century in spring.' }),
        'A plain-text goal: climb more.',
        ...Array.from({ length: 10 }, () => JSON.stringify({ text: 'x'.repeat(900) })),
      ],
    });
    const result = await GOALS.run(context(reads), {});
    expect(
      result.startsWith('Goal: Ride a century in spring.\nGoal: A plain-text goal: climb more.'),
    ).toBe(true);
    expect(result.length).toBeLessThanOrEqual(GOALS_CHARACTERS);
    expect(asked[0]).toMatchObject({ athleteId: 'athlete-a', kind: 'goal' });
  });

  it('takes no argument at all', () => {
    expect(GOALS.validate({})).toStrictEqual({ ok: true, args: {} });
    expect(GOALS.validate({ athleteId: 'athlete-b' }).ok).toBe(false);
  });

  it('leaves out a goal carrying a picture', async () => {
    const { reads } = listReads({
      goal: [JSON.stringify({ text: 'see data:image/png;base64,iVBOR' }), 'Ride further.'],
    });
    expect(await GOALS.run(context(reads), {})).toBe('Goal: Ride further.');
  });
});

/** A saved workout's item body, as the device sends it: the ADR 0017 file. */
function workoutBody(name: string, minutes = 10, target = 0.6): string {
  return encodeWorkoutFile({
    name,
    description: 'Not for the model.',
    blocks: [
      { kind: 'steady', seconds: seconds(minutes * 60), target: thresholdShare(target) },
      {
        kind: 'intervals',
        repeats: 4,
        hardSeconds: seconds(180),
        hardTarget: thresholdShare(1.1),
        easySeconds: seconds(120),
        easyTarget: thresholdShare(0.5),
      },
    ],
  });
}

describe('workouts (#1100)', () => {
  it('returns each workout’s name, total time and shape — shares of threshold, never watts', async () => {
    const { reads, asked } = listReads({ workout: [workoutBody('Over-unders')] });
    expect(await WORKOUTS.run(context(reads), {})).toBe(
      'Workout: Over-unders — 30 min: 10 min at 60%, 4 × 3 min at 110%, 2 min at 50%',
    );
    expect(asked).toStrictEqual([{ athleteId: 'athlete-a', kind: 'workout', limit: 40 }]);
  });

  it('holds its bound over 40 saved workouts: at most 10, and at most 4 000 characters', async () => {
    const forty = Array.from({ length: 40 }, (_, index) =>
      workoutBody(`Workout number ${String(index)}`),
    );
    const result = await WORKOUTS.run(context(listReads({ workout: forty }).reads), {});
    const lines = result.split('\n');
    expect(lines).toHaveLength(WORKOUTS_LIMIT);
    expect(lines[0]).toContain('Workout number 0 ');
    expect(result.length).toBeLessThanOrEqual(WORKOUTS_CHARACTERS);

    // Long names: the character bound holds before the count does.
    const long = Array.from({ length: 40 }, () => workoutBody('n'.repeat(500)));
    const cut = await WORKOUTS.run(context(listReads({ workout: long }).reads), {});
    expect(cut.length).toBeLessThanOrEqual(WORKOUTS_CHARACTERS);
    expect(cut.split('\n').length).toBeGreaterThan(1);
  });

  it('skips a hand-edited row that is not a workout it would ride, and never throws', async () => {
    const tooHard = workoutBody('Too hard').replace('1.1', '99');
    const unknownKey = workoutBody('Extra').replace('"name"', '"watts": 300,\n  "name"');
    const { reads } = listReads({
      workout: [
        'not json',
        JSON.stringify({ text: 'a goal in the wrong kind' }),
        tooHard,
        unknownKey,
        workoutBody('Look at data:image/png;base64,iVBOR'),
        workoutBody('Kept'),
      ],
    });
    const result = await WORKOUTS.run(context(reads), {});
    expect(result).toBe('Workout: Kept — 30 min: 10 min at 60%, 4 × 3 min at 110%, 2 min at 50%');
    expect(result).not.toContain('Not for the model');
  });

  it('says so when none is synced, and takes no argument at all', async () => {
    expect(await WORKOUTS.run(context(listReads({}).reads), {})).toBe(
      'The cyclist has no saved workouts synced.',
    );
    expect(WORKOUTS.validate({})).toStrictEqual({ ok: true, args: {} });
    expect(WORKOUTS.validate({ athleteId: 'athlete-b' }).ok).toBe(false);
    expect(WORKOUTS.validate({ count: 50 }).ok).toBe(false);
  });

  it('is one of the agent’s tools', () => {
    expect(AGENT_TOOLS).toContain(WORKOUTS);
  });
});

describe('the workouts tool over the real store, three athletes (#1100)', () => {
  let harness: StoreHarness;
  let store: SqlStore;

  beforeEach(async () => {
    harness = await createStoreHarness();
    await harness.write(async (writer) => {
      for (const athlete of ['a', 'b', 'c']) {
        await writer.registerAthlete(registrationFixture(athlete));
        for (const [key, now] of [
          ['first', 10],
          ['second', 20],
        ] as const) {
          const body = encode(workoutBody(`${athlete}'s ${key}`));
          await writer.putSyncItem({
            athleteId: athlete,
            kind: 'workout',
            key,
            body,
            digest: `${athlete}-${key}`.padEnd(64, '0'),
            now,
          });
        }
        // The same name under another kind: never a workout.
        await writer.putSyncItem({
          athleteId: athlete,
          kind: 'goal',
          key: 'goals',
          body: encode(workoutBody(`${athlete}'s goal`)),
          digest: `${athlete}-goal`.padEnd(64, '0'),
          now: 30,
        });
      }
      await writer.deleteSyncItem('a', 'workout', 'first', 40);
    });
    store = await openSqlStore(harness.path);
  });

  afterEach(async () => {
    await store.close();
    await harness.destroy();
  });

  it('returns the job’s athlete’s live workouts only — no other athlete’s, no other kind, no tombstone', async () => {
    const forA = await WORKOUTS.run({ athleteId: 'a', input: RIDE_INPUT, reads: store }, {});
    expect(forA.split('\n').map((line) => line.split(' — ')[0])).toStrictEqual([
      "Workout: a's second",
    ]);
    const forB = await WORKOUTS.run({ athleteId: 'b', input: RIDE_INPUT, reads: store }, {});
    expect(forB.split('\n').map((line) => line.split(' — ')[0])).toStrictEqual([
      "Workout: b's second",
      "Workout: b's first",
    ]);
  });
});

describe('the store read under the tools (#1098)', () => {
  let harness: StoreHarness;
  let store: SqlStore;

  beforeEach(async () => {
    harness = await createStoreHarness();
    await harness.write(async (writer) => {
      await writer.registerAthlete(registrationFixture('a'));
      for (const [key, now] of [
        ['old', 10],
        ['new', 30],
        ['gone', 20],
      ] as const) {
        await writer.putSyncItem({
          athleteId: 'a',
          kind: 'goal',
          key,
          body: encode(key),
          digest: key.padEnd(64, '0'),
          now,
        });
      }
      await writer.deleteSyncItem('a', 'goal', 'gone', 40);
    });
    store = await openSqlStore(harness.path);
  });

  afterEach(async () => {
    await store.close();
    await harness.destroy();
  });

  it('returns live items only, newest first, at most the limit', async () => {
    const live = await store.listLiveSyncItems('a', 'goal', 10);
    expect(
      live.map((item) => new TextDecoder().decode(item.body ?? new Uint8Array())),
    ).toStrictEqual(['new', 'old']);
    expect(await store.listLiveSyncItems('a', 'goal', 1)).toHaveLength(1);
    expect(await store.listLiveSyncItems('a', 'note', 10)).toStrictEqual([]);
  });
});
