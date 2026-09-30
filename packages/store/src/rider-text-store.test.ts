// SPDX-License-Identifier: Apache-2.0

/**
 * The rider's goals, ride notes and documents (#836): kept on the device
 * first, one table, one row per athlete, kind and key.
 *
 * What matters here is what CLAUDE.md §5 names — a write that reports success
 * while a fresh read cannot see it (the round trip, red against a store that
 * never writes) — and the limits #836 states in characters, each checked at
 * the edge and one past it.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { activityId } from './ids';
import type { RiderTextRecord } from './records';
import {
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_GOALS_CHARACTERS,
  MAXIMUM_RIDE_NOTE_CHARACTERS,
  MAXIMUM_RIDER_DOCUMENTS,
  riderTextProblem,
  tidyRiderText,
} from './rider-text';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  assertRiderTextRoundTrip,
  assertSyncBaseRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  riderTextFor,
  RoundTripFailure,
  seedAthletes,
  seedRide,
  syncBaseFor,
} from './testing';
import type { StoreFactory, StoreHarness } from './testing';

let harness: StoreHarness;

async function harnessWith(factory?: StoreFactory): Promise<StoreHarness> {
  const made = createStoreHarness(factory === undefined ? {} : { factory });
  await seedAthletes(made);
  return made;
}

beforeEach(async () => {
  resetFixtureIds();
  harness = await harnessWith();
});

afterEach(async () => {
  await harness.destroy();
});

describe('a rider text', () => {
  it('reads back whole on a fresh connection, for each of the three kinds', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    for (const text of [
      riderTextFor(ATHLETE_A, 'goal'),
      riderTextFor(ATHLETE_A, 'note', ride.id),
      riderTextFor(ATHLETE_A, 'document'),
    ]) {
      await expect(assertRiderTextRoundTrip(harness, text)).resolves.toStrictEqual(text);
    }
  });

  it('is red against a store that never writes it', async () => {
    const broken = await harnessWith(memoryWriteStoreFactory());
    try {
      await expect(
        assertRiderTextRoundTrip(broken, riderTextFor(ATHLETE_A, 'goal')),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('is kept tidied — carriage returns folded, the ends trimmed — and answers what landed', async () => {
    const written = await harness.write(async (store) =>
      store.putRiderText({
        ...riderTextFor(ATHLETE_A, 'document'),
        name: '  plan.md  ',
        text: '  One\r\nTwo\rThree  \n',
      }),
    );
    const read = await harness.read(async (store) =>
      store.getRiderText(ATHLETE_A, 'document', written.key),
    );
    expect(written.text).toBe('One\nTwo\nThree');
    expect(written.name).toBe('plan.md');
    expect(read).toStrictEqual(written);
  });

  it('replaces the row for the same athlete, kind and key', async () => {
    const first = riderTextFor(ATHLETE_A, 'goal');
    await harness.write(async (store) => {
      await store.putRiderText(first);
      await store.putRiderText({ ...first, text: 'A second goal.' });
    });
    const listed = await harness.read(async (store) => store.listRiderTexts(ATHLETE_A, 'goal'));
    expect(listed.map((row) => row.text)).toStrictEqual(['A second goal.']);
  });

  it('writes only its six fields, whatever the caller spread in', async () => {
    const spread = {
      ...riderTextFor(ATHLETE_A, 'goal'),
      model: 'somebody',
    } as RiderTextRecord;
    await harness.write(async (store) => store.putRiderText(spread));
    await harness.discard();
    const database = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => database.version(index + 1).stores(stores));
    const rows = (await database.table(TABLE.riderTexts).toArray()) as Record<string, unknown>[];
    database.close();
    expect(Object.keys(rows[0] ?? {}).sort()).toStrictEqual(
      ['athleteId', 'key', 'kind', 'savedAt', 'text'].sort(),
    );
  });

  it('refuses a note on a ride that is not the athlete’s, or on no ride', async () => {
    const theirs = await seedRide(harness, ATHLETE_B);
    await expect(
      harness.write(async (store) =>
        store.putRiderText(riderTextFor(ATHLETE_A, 'note', theirs.id)),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
    await expect(
      harness.write(async (store) =>
        store.putRiderText(riderTextFor(ATHLETE_A, 'note', activityId('no-such-ride'))),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('refuses a text for an athlete who does not exist', async () => {
    await expect(
      harness.write(async (store) =>
        store.putRiderText({ ...riderTextFor(ATHLETE_A, 'goal'), athleteId: 'nobody' as never }),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('goes with its ride: deleting the ride deletes the note, and nothing else', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putRiderText(riderTextFor(ATHLETE_A, 'note', ride.id));
      await store.putRiderText(riderTextFor(ATHLETE_A, 'goal'));
      await store.deleteActivity(ATHLETE_A, ride.id);
    });
    const [note, goal] = await harness.read(async (store) =>
      Promise.all([
        store.getRiderText(ATHLETE_A, 'note', ride.id),
        store.getRiderText(ATHLETE_A, 'goal', 'goals'),
      ]),
    );
    expect(note).toBeUndefined();
    expect(goal?.text).toBe(riderTextFor(ATHLETE_A, 'goal').text);
  });

  it('keeps at most MAXIMUM_RIDER_DOCUMENTS documents, and still lets one be replaced', async () => {
    const base = riderTextFor(ATHLETE_A, 'document');
    await harness.write(async (store) => {
      for (let index = 0; index < MAXIMUM_RIDER_DOCUMENTS; index += 1) {
        await store.putRiderText({ ...base, key: `doc-${String(index)}` });
      }
    });
    await expect(
      harness.write(async (store) => store.putRiderText({ ...base, key: 'one-too-many' })),
    ).rejects.toBeInstanceOf(StoreValidationError);
    await expect(
      harness.write(async (store) =>
        store.putRiderText({ ...base, key: 'doc-0', text: 'Replaced.' }),
      ),
    ).resolves.toMatchObject({ text: 'Replaced.' });
  });

  it('removes one text, answering false when there was none', async () => {
    await harness.write(async (store) => store.putRiderText(riderTextFor(ATHLETE_A, 'document')));
    const key = riderTextFor(ATHLETE_A, 'document').key;
    await expect(
      harness.write(async (store) => store.deleteRiderText(ATHLETE_A, 'document', key)),
    ).resolves.toBe(true);
    await expect(
      harness.write(async (store) => store.deleteRiderText(ATHLETE_A, 'document', key)),
    ).resolves.toBe(false);
    await expect(
      harness.read(async (store) => store.listRiderTexts(ATHLETE_A, 'document')),
    ).resolves.toStrictEqual([]);
  });

  it('refuses a hand-edited row on the way out', async () => {
    await harness.write(async (store) => store.putRiderText(riderTextFor(ATHLETE_A, 'goal')));
    await harness.discard();
    const database = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => database.version(index + 1).stores(stores));
    await database.table(TABLE.riderTexts).put({
      ...riderTextFor(ATHLETE_A, 'goal'),
      text: 'binary\u0000here',
    });
    database.close();
    await expect(
      harness.read(async (store) => store.getRiderText(ATHLETE_A, 'goal', 'goals')),
    ).rejects.toBeInstanceOf(StoreDecodeError);
  });
});

describe('what a rider text may be', () => {
  const at = unixSeconds(1);
  const valid = (overrides: Partial<Record<keyof RiderTextRecord, unknown>>) =>
    riderTextProblem({ ...riderTextFor(ATHLETE_A, 'goal'), savedAt: at, ...overrides });

  it('states each kind’s limit in characters, allowing it and refusing one more', () => {
    const cases = [
      ['goal', 'goals', undefined, MAXIMUM_GOALS_CHARACTERS],
      ['note', 'ride-1', undefined, MAXIMUM_RIDE_NOTE_CHARACTERS],
      ['document', 'doc-1', 'plan.md', MAXIMUM_DOCUMENT_CHARACTERS],
    ] as const;
    for (const [kind, key, name, maximum] of cases) {
      const row = { athleteId: 'a', kind, key, name, text: 'x'.repeat(maximum) };
      expect(riderTextProblem(row)).toBeUndefined();
      expect(riderTextProblem({ ...row, text: 'x'.repeat(maximum + 1) })).toBe(
        `riderText.text: must be at most ${String(maximum)} characters`,
      );
    }
    // The numbers #836 states: a note is one 900-character passage.
    expect(MAXIMUM_RIDE_NOTE_CHARACTERS).toBe(900);
    expect(MAXIMUM_DOCUMENT_CHARACTERS).toBe(100_000);
  });

  it('allows a tab and a newline and refuses every other control, NUL included', () => {
    expect(valid({ text: 'one\ttwo\nthree' })).toBeUndefined();
    for (const control of ['\u0000', '\r', '\u0007', '\u007F', '\u0085']) {
      expect(valid({ text: `a${control}b` })).toBe(
        'riderText.text: must hold no control character but a tab or a newline',
      );
    }
  });

  it('refuses an empty text, a wrong key, a name where none belongs, and a document with none', () => {
    expect(valid({ text: '   ' })).toBe('riderText.text: must be text');
    expect(valid({ key: 'other' })).toBe('riderText.key: must be goals for the goals');
    expect(valid({ name: 'x' })).toBe('riderText.name: only a document has a name');
    expect(valid({ kind: 'document', key: 'doc-1' })).toMatch(/^riderText\.name:/u);
    expect(valid({ kind: 'document', key: '../x', name: 'x' })).toMatch(/^riderText\.key:/u);
    expect(valid({ kind: 'document', key: 'doc-1', name: 'a\nb' })).toMatch(/^riderText\.name:/u);
    expect(valid({ kind: 'note', key: '' })).toMatch(/^riderText\.key:/u);
    expect(valid({ kind: 'picture' })).toBe('riderText.kind: must be goal, note or document');
    expect(valid({ athleteId: '' })).toBe('riderText.athleteId: must be an athlete id');
  });

  it('refuses a document name holding a bidirectional override or isolate (#920 review)', () => {
    // "evil\u202Egnp.md" is drawn as "evildm.png": the name would lie about the file.
    for (const control of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2069']) {
      expect(valid({ kind: 'document', key: 'doc-1', name: `evil${control}gnp.md` })).toMatch(
        /^riderText\.name:/u,
      );
    }
    expect(valid({ kind: 'document', key: 'doc-1', name: 'بلان plan.md' })).toBeUndefined();
  });

  it('never repeats the text it refuses', () => {
    const secret = 'Priya lives at 12 Acacia Avenue\u0000';
    expect(valid({ text: secret })).not.toContain('Priya');
  });

  it('folds every carriage return and trims only the ends', () => {
    expect(tidyRiderText('\r\n a\r\nb\rc  d \r\n')).toBe('a\nb\nc  d');
  });
});

describe('the sync base, for a goal and a document (#836)', () => {
  it('keeps a row that names no ride, and reads it back', async () => {
    for (const kind of ['goal', 'document'] as const) {
      const base = syncBaseFor(ATHLETE_A, activityId('unused'), kind);
      expect(base.activityId).toBeNull();
      await expect(assertSyncBaseRoundTrip(harness, base)).resolves.toStrictEqual(base);
    }
  });

  it('keeps a note’s row as an item of its ride', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const base = syncBaseFor(ATHLETE_A, ride.id, 'note');
    await expect(assertSyncBaseRoundTrip(harness, base)).resolves.toStrictEqual(base);
  });

  it('refuses a goal’s row that names a ride, and a note’s that names none', async () => {
    const goal = syncBaseFor(ATHLETE_A, activityId('r'), 'goal');
    await expect(
      harness.write(async (store) => store.putSyncBase({ ...goal, activityId: activityId('r') })),
    ).rejects.toBeInstanceOf(StoreValidationError);
    const note = syncBaseFor(ATHLETE_A, activityId('r'), 'note');
    await expect(
      harness.write(async (store) => store.putSyncBase({ ...note, activityId: null })),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });
});
