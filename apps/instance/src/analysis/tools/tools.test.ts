// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The agent's tools (#1098, ADR 0046 D-7), one at a time: their schemas,
 * their bounds, what they refuse to return, and the store read under them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  GOALS,
  GOALS_CHARACTERS,
  RECENT_RIDES,
  RECENT_RIDES_DEFAULT,
  RECENT_RIDES_LIMIT,
  RIDE_SECTIONS,
  RIDE_SUMMARY_CHARACTERS,
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
