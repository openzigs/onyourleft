// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The history index's rows (#835, ADR 0040): written through the port, read
 * back through a FRESH store (`harness.read` closes every connection first),
 * so a write that landed nowhere a reader looks cannot pass.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { HistoryIndexWrite, SyncItemWrite } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  HISTORY_FIXTURE_CONVENTION,
  HISTORY_FIXTURE_DIMENSION,
  HISTORY_FIXTURE_MODEL,
  historyIndexFixture,
  registrationFixture,
  syncItemFixtures,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

const INDEXABLE = ['write-up', 'ride-summary', 'goal', 'note', 'document'] as const;

function writeUpOf(athleteId: string): SyncItemWrite {
  const item = syncItemFixtures(athleteId).find((each) => each.kind === 'write-up');
  if (item === undefined) throw new Error('fixture');
  return item;
}

async function seeded(): Promise<StoreHarness> {
  const made = await createStoreHarness();
  await made.write(async (store) => {
    for (const athlete of [ATHLETE_A, ATHLETE_B]) {
      await store.registerAthlete(registrationFixture(athlete));
      for (const item of syncItemFixtures(athlete)) await store.putSyncItem(item);
    }
  });
  return made;
}

const passagesOf = (store: Parameters<Parameters<StoreHarness['read']>[0]>[0], athlete: string) =>
  store.listHistoryPassages(
    athlete,
    HISTORY_FIXTURE_MODEL,
    HISTORY_FIXTURE_DIMENSION,
    HISTORY_FIXTURE_CONVENTION,
  );

describe('the history index’s rows (#835)', () => {
  it('keeps passages and their vectors, byte for byte, through a fresh store', async () => {
    harness = await seeded();
    const vector = new Float32Array([0.6, -0.8, 1e-7]);
    const write: HistoryIndexWrite = {
      ...historyIndexFixture(ATHLETE_A),
      passages: [{ ordinal: 0, text: 'A steady hour.', vector }],
    };
    expect(await harness.write((store) => store.putHistoryIndex(write))).toBe('stored');
    const read = await harness.read((store) => passagesOf(store, ATHLETE_A));
    expect(read).toHaveLength(1);
    expect(read[0]?.text).toBe('A steady hour.');
    expect(read[0]?.kind).toBe('write-up');
    expect(read[0]?.key).toBe(write.key);
    expect([...(read[0]?.vector ?? [])]).toStrictEqual([...vector]);
  });

  it('never returns a passage of another model, dimension or prefix convention (ADR 0040 D-7)', async () => {
    harness = await seeded();
    await harness.write((store) => store.putHistoryIndex(historyIndexFixture(ATHLETE_A)));
    const [same, otherModel, otherDimension, otherConvention] = await harness.read((store) =>
      Promise.all([
        passagesOf(store, ATHLETE_A),
        store.listHistoryPassages(ATHLETE_A, 'another-model', 3, HISTORY_FIXTURE_CONVENTION),
        store.listHistoryPassages(ATHLETE_A, HISTORY_FIXTURE_MODEL, 4, HISTORY_FIXTURE_CONVENTION),
        store.listHistoryPassages(ATHLETE_A, HISTORY_FIXTURE_MODEL, 3, 'no-prefixes'),
      ]),
    );
    expect(same).toHaveLength(2);
    expect(otherModel).toStrictEqual([]);
    expect(otherDimension).toStrictEqual([]);
    expect(otherConvention).toStrictEqual([]);
  });

  it('refuses a write whose vector is not the write’s dimension, and keeps nothing of it', async () => {
    harness = await seeded();
    const bad: HistoryIndexWrite = {
      ...historyIndexFixture(ATHLETE_A),
      passages: [
        { ordinal: 0, text: 'ok', vector: new Float32Array([1, 0, 0]) },
        { ordinal: 1, text: 'short', vector: new Float32Array([1, 0]) },
      ],
    };
    await expect(harness.write((store) => store.putHistoryIndex(bad))).rejects.toThrow();
    expect(await harness.read((store) => passagesOf(store, ATHLETE_A))).toStrictEqual([]);
  });

  it('answers stale, writing nothing, for an item that moved or went while it was embedded', async () => {
    harness = await seeded();
    const moved = { ...historyIndexFixture(ATHLETE_A), digest: 'f'.repeat(64) };
    expect(await harness.write((store) => store.putHistoryIndex(moved))).toBe('stale');
    // Another athlete's item, under this athlete's name, is not theirs to index.
    const theirs = { ...historyIndexFixture(ATHLETE_B), athleteId: ATHLETE_A };
    expect(await harness.write((store) => store.putHistoryIndex(theirs))).toBe('stale');
    await harness.write((store) =>
      store.deleteSyncItem(ATHLETE_A, 'write-up', writeUpOf(ATHLETE_A).key, 1_790_000_900),
    );
    expect(
      await harness.write((store) => store.putHistoryIndex(historyIndexFixture(ATHLETE_A))),
    ).toBe('stale');
    expect(await harness.read((store) => passagesOf(store, ATHLETE_A))).toStrictEqual([]);
  });

  it('drops an item’s passages in the same write that replaces or deletes the item (ADR 0040 D-10)', async () => {
    harness = await seeded();
    await harness.write(async (store) => {
      await store.putHistoryIndex(historyIndexFixture(ATHLETE_A));
      await store.putHistoryIndex(historyIndexFixture(ATHLETE_B));
    });
    // Replaced: a new body is a new item, and the old passages go with the old body.
    await harness.write((store) =>
      store.putSyncItem({
        ...writeUpOf(ATHLETE_A),
        body: new TextEncoder().encode('{"text":"changed"}'),
        digest: 'e'.repeat(64),
      }),
    );
    expect(await harness.read((store) => passagesOf(store, ATHLETE_A))).toStrictEqual([]);
    // Deleted: the same, for B — and A's deletion touched nothing of B's before.
    expect(await harness.read((store) => passagesOf(store, ATHLETE_B))).toHaveLength(2);
    await harness.write((store) =>
      store.deleteSyncItem(ATHLETE_B, 'write-up', writeUpOf(ATHLETE_B).key, 1_790_000_900),
    );
    expect(await harness.read((store) => passagesOf(store, ATHLETE_B))).toStrictEqual([]);
  });

  it('lists as pending exactly the live items with no row for this body, model and convention', async () => {
    harness = await seeded();
    const pending = (model = HISTORY_FIXTURE_MODEL) =>
      harness!.read((store) =>
        store.listPendingHistorySources(INDEXABLE, model, HISTORY_FIXTURE_CONVENTION, 100),
      );
    const keysOf = (rows: Awaited<ReturnType<typeof pending>>) =>
      rows.map((row) => `${row.athleteId} ${row.kind}`).sort();

    const before = await pending();
    // Five indexable kinds each for two athletes; never the side-camera report.
    expect(before).toHaveLength(10);
    expect(before.every((row) => row.kind !== 'side-camera-report')).toBe(true);
    const first = before.find((row) => row.athleteId === ATHLETE_A && row.kind === 'write-up');
    expect(new TextDecoder().decode(first?.body)).toBe(
      new TextDecoder().decode(writeUpOf(ATHLETE_A).body),
    );

    await harness.write((store) => store.putHistoryIndex(historyIndexFixture(ATHLETE_A)));
    expect(keysOf(await pending())).not.toContain(`${ATHLETE_A} write-up`);
    expect(keysOf(await pending())).toContain(`${ATHLETE_B} write-up`);
    // A change of model makes every item pending again (ADR 0040 D-7).
    expect(keysOf(await pending('another-model'))).toContain(`${ATHLETE_A} write-up`);
    // A deleted item is never pending.
    await harness.write((store) =>
      store.deleteSyncItem(ATHLETE_B, 'goal', 'goal-of-athlete-b', 1_790_000_900),
    );
    expect(keysOf(await pending())).not.toContain(`${ATHLETE_B} goal`);
    // Nothing asked for, nothing listed.
    expect(
      await harness.read((store) =>
        store.listPendingHistorySources([], HISTORY_FIXTURE_MODEL, 'x', 10),
      ),
    ).toStrictEqual([]);
  });

  it('keeps an item that yielded no passage off the pending list', async () => {
    harness = await seeded();
    await harness.write((store) =>
      store.putHistoryIndex({ ...historyIndexFixture(ATHLETE_A), outcome: 'empty', passages: [] }),
    );
    const pending = await harness.read((store) =>
      store.listPendingHistorySources(
        ['write-up'],
        HISTORY_FIXTURE_MODEL,
        HISTORY_FIXTURE_CONVENTION,
        10,
      ),
    );
    expect(pending.map((row) => row.athleteId)).toStrictEqual([ATHLETE_B]);
  });

  it('summarises which model built an athlete’s index, and how many passages', async () => {
    harness = await seeded();
    await harness.write((store) => store.putHistoryIndex(historyIndexFixture(ATHLETE_A)));
    expect(await harness.read((store) => store.summariseHistoryIndex(ATHLETE_A))).toStrictEqual([
      { model: HISTORY_FIXTURE_MODEL, dimension: HISTORY_FIXTURE_DIMENSION, passages: 2 },
    ]);
    expect(await harness.read((store) => store.summariseHistoryIndex(ATHLETE_B))).toStrictEqual([]);
  });
});
