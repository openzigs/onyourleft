// SPDX-License-Identifier: AGPL-3.0-or-later

/** What the port does, each claim read back on a fresh connection (#769). */

import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './node-sqlite.ts';
import { openSqlStore } from './open-sql-store.ts';
import { OwnershipConflictError, type SqlStore, type SyncItemWrite } from './sql-store.ts';
import {
  activityRecordFixture,
  athleteFixture,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  deviceKeyFixture,
  resultFixture,
  seedWorld,
  sessionFixture,
  SHARED_ROOM,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function world(): Promise<StoreHarness> {
  harness = await createStoreHarness();
  await harness.write(seedWorld);
  return harness;
}

describe('SqlStore (#769)', () => {
  it('stores an activity record once, and calls the second copy a duplicate', async () => {
    const opened = await world();
    const record = activityRecordFixture(ATHLETE_A, 'retried');
    expect(await opened.write((store) => store.putActivityRecord(record))).toBe('stored');
    expect(await opened.write((store) => store.putActivityRecord(record))).toBe('duplicate');
    const listed = await opened.read((store) => store.listActivityRecords(ATHLETE_A));
    expect(listed.filter((each) => each.contentSha256 === record.contentSha256)).toHaveLength(1);
  });

  it('keeps the same file from two athletes as two records', async () => {
    const opened = await world();
    const shared = activityRecordFixture(ATHLETE_A, 'shared');
    await opened.write(async (store) => {
      expect(await store.putActivityRecord(shared)).toBe('stored');
      expect(await store.putActivityRecord({ ...shared, athleteId: ATHLETE_B })).toBe('stored');
    });
    const read = await opened.read((store) =>
      store.getActivityRecord(ATHLETE_B, shared.contentSha256),
    );
    expect(read?.athleteId).toBe(ATHLETE_B);
  });

  it('refuses to hand one athlete’s device key or session to another', async () => {
    const opened = await world();
    await expect(
      opened.write((store) =>
        store.putDeviceKey({ ...deviceKeyFixture(ATHLETE_A), athleteId: ATHLETE_B }),
      ),
    ).rejects.toBeInstanceOf(OwnershipConflictError);
    await expect(
      opened.write((store) =>
        store.putSession({ ...sessionFixture(ATHLETE_A), athleteId: ATHLETE_B }),
      ),
    ).rejects.toBeInstanceOf(OwnershipConflictError);
    const keys = await opened.read((store) => store.listDeviceKeys(ATHLETE_A));
    expect(keys.map((key) => key.athleteId)).toEqual([ATHLETE_A]);
    const session = await opened.read((store) =>
      store.findSession(sessionFixture(ATHLETE_A).tokenSha256),
    );
    expect(session?.athleteId).toBe(ATHLETE_A);
  });

  it('refuses a session that names another athlete’s device key (#842 review)', async () => {
    const opened = await world();
    const crossed = {
      ...sessionFixture(ATHLETE_A),
      tokenSha256: 'c'.repeat(64),
      deviceKey: deviceKeyFixture(ATHLETE_B).publicKey,
    };
    await expect(opened.write((store) => store.putSession(crossed))).rejects.toBeInstanceOf(
      OwnershipConflictError,
    );
    expect(await opened.read((store) => store.findSession(crossed.tokenSha256))).toBeUndefined();
    // And B's erasure is not blocked by anything A holds.
    await opened.write((store) => store.eraseAthlete(ATHLETE_B));
    expect(await opened.read((store) => store.getAthlete(ATHLETE_B))).toBeUndefined();
  });

  it('refuses that session in the schema too, beneath the port’s check', async () => {
    const opened = await world();
    await opened.write(() => Promise.resolve());
    const database = openDatabase(opened.path);
    try {
      expect(() =>
        database
          .prepare(
            'INSERT INTO session (token_sha256, athlete_id, device_key, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)',
          )
          .run('d'.repeat(64), ATHLETE_A, deviceKeyFixture(ATHLETE_B).publicKey, 1),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      database.close();
    }
  });

  it('updates what may change: a revocation, a display name, a result', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.putDeviceKey({ ...deviceKeyFixture(ATHLETE_A), revokedAt: 1_790_000_900 });
      await store.putSession({ ...sessionFixture(ATHLETE_A), revokedAt: 1_790_000_901 });
      await store.putAthlete({ ...athleteFixture(ATHLETE_A), displayName: 'Renamed' });
      await store.putResult({
        ...resultFixture(ATHLETE_A),
        finishMs: 1,
        flags: 2,
        place: 2,
        wattsPerKilogram: 4.25,
        flaggedDurationsSeconds: [1200, 3600],
      });
      await store.putRoom({ ...SHARED_ROOM, visibility: 'public' });
    });
    await opened.read(async (store) => {
      expect((await store.listDeviceKeys(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_900);
      expect((await store.listSessions(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_901);
      expect((await store.getAthlete(ATHLETE_A))?.displayName).toBe('Renamed');
      expect(await store.listResults(ATHLETE_A)).toEqual([
        {
          roomId: SHARED_ROOM.id,
          athleteId: ATHLETE_A,
          finishMs: 1,
          flags: 2,
          // #785's three, read back through a fresh connection.
          place: 2,
          wattsPerKilogram: 4.25,
          flaggedDurationsSeconds: [1200, 3600],
        },
      ]);
      expect((await store.getRoom(SHARED_ROOM.id))?.visibility).toBe('public');
      expect(await store.listRoomResults(SHARED_ROOM.id)).toHaveLength(3);
    });
  });

  it('keeps a room’s course, its grade steps in order, and replaces it whole on a second put (#780)', async () => {
    const opened = await world();
    const course = {
      roomId: SHARED_ROOM.id,
      lengthMetres: 450.5,
      grades: [
        [0, 0],
        [150, 2],
        [300, -1.5],
      ] as const,
      ridingPosition: 'hoods' as const,
      capacity: null,
      countdownMs: 2_000,
      rejoinWindowMs: null,
      drafting: true,
      raceStartedAt: null,
    };
    await opened.write((store) => store.putRoomCourse(course));
    expect(await opened.read((store) => store.getRoomCourse(SHARED_ROOM.id))).toEqual(course);
    await opened.write((store) =>
      store.putRoomCourse({
        ...course,
        capacity: 80,
        grades: [[0, 1]],
        countdownMs: null,
        // #787: a room with drafting off reads back off.
        drafting: false,
      }),
    );
    expect(await opened.read((store) => store.getRoomCourse(SHARED_ROOM.id))).toEqual({
      ...course,
      capacity: 80,
      grades: [[0, 1]],
      countdownMs: null,
      drafting: false,
    });
    expect(await opened.read((store) => store.getRoomCourse('nowhere'))).toBeUndefined();
    // A race that left its lobby stays marked, at the first time it did.
    await opened.write(async (store) => {
      await store.markRaceStarted(SHARED_ROOM.id, 1_790_000_100);
      await store.markRaceStarted(SHARED_ROOM.id, 1_790_000_200);
    });
    expect((await opened.read((store) => store.getRoomCourse(SHARED_ROOM.id)))?.raceStartedAt).toBe(
      1_790_000_100,
    );
    await expect(
      opened.write((store) => store.putRoomCourse({ ...course, roomId: 'nowhere' })),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('never un-revokes a device key or a session on a later put (#842 review)', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.putDeviceKey({ ...deviceKeyFixture(ATHLETE_A), revokedAt: 1_790_000_900 });
      await store.putSession({ ...sessionFixture(ATHLETE_A), revokedAt: 1_790_000_901 });
      await store.putDeviceKey({ ...deviceKeyFixture(ATHLETE_A), revokedAt: null });
      await store.putSession({ ...sessionFixture(ATHLETE_A), revokedAt: null });
    });
    await opened.read(async (store) => {
      expect((await store.listDeviceKeys(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_900);
      expect((await store.listSessions(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_901);
    });
  });

  it('answers undefined for what is not there', async () => {
    const opened = await world();
    await opened.read(async (store) => {
      expect(await store.getAthlete('nobody')).toBeUndefined();
      expect(await store.getRoom('nowhere')).toBeUndefined();
      expect(await store.findSession('0'.repeat(64))).toBeUndefined();
      expect(await store.getActivityRecord(ATHLETE_A, '0'.repeat(64))).toBeUndefined();
    });
  });

  it('refuses a row whose athlete does not exist (foreign keys are on)', async () => {
    const opened = await world();
    await expect(
      opened.write((store) => store.putActivityRecord(activityRecordFixture('nobody'))),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('keeps going after a failed call: the queue does not jam', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await expect(store.putActivityRecord(activityRecordFixture('nobody'))).rejects.toThrow();
      expect(await store.getAthlete(ATHLETE_A)).toBeDefined();
    });
  });
});

describe('which sync writes scrub, counted on the connection (#1944)', () => {
  /**
   * Every statement the store runs, through `openSqlStore`'s `onQuery`: the
   * scrub is `secure_delete` on, the write, then a TRUNCATE checkpoint, so a
   * write that pays for one shows both, and one that does not shows neither.
   */
  const statements: string[] = [];
  const counted = (path: string): Promise<SqlStore> =>
    openSqlStore(path, { onQuery: (each) => statements.push(each) });

  function scrubs(): { readonly secureDelete: number; readonly truncations: number } {
    return {
      secureDelete: statements.filter((each) => /secure_delete\s*=\s*on/i.test(each)).length,
      truncations: statements.filter((each) => /wal_checkpoint\(\s*truncate\s*\)/i.test(each))
        .length,
    };
  }

  const note = (body: string, now: number): SyncItemWrite => ({
    athleteId: ATHLETE_A,
    kind: 'note',
    key: 'n-1944-count',
    body: new TextEncoder().encode(body),
    digest: `digest-of-${body}`,
    now,
  });

  /** `put`, with the statements it ran and no others counted. */
  async function put(store: SqlStore, item: SyncItemWrite) {
    statements.length = 0;
    const answer = await store.putSyncItem(item);
    return { answer, ...scrubs() };
  }

  async function countedWorld(): Promise<StoreHarness> {
    harness = await createStoreHarness(counted);
    await harness.write(seedWorld);
    return harness;
  }

  /** The body a fresh connection reads back, or `null` for a tombstone. */
  async function bodyHeld(opened: StoreHarness): Promise<string | null | undefined> {
    const held = await opened.read((store) => store.getSyncItem(ATHLETE_A, 'note', 'n-1944-count'));
    if (held === undefined) return undefined;
    return held.body === null ? null : new TextDecoder().decode(held.body);
  }

  it('a first write stores the item and pays no checkpoint', async () => {
    const opened = await countedWorld();
    const first = await opened.write((store) => put(store, note('first', 1_790_000_100)));
    expect(first).toStrictEqual({ answer: 'stored', secureDelete: 0, truncations: 0 });
    expect(await bodyHeld(opened)).toBe('first');
  });

  it('an unchanged write answers unchanged and pays no checkpoint', async () => {
    const opened = await countedWorld();
    await opened.write((store) => store.putSyncItem(note('same', 1_790_000_100)));
    const again = await opened.write((store) => put(store, note('same', 1_790_000_200)));
    expect(again).toStrictEqual({ answer: 'unchanged', secureDelete: 0, truncations: 0 });
    expect(await bodyHeld(opened)).toBe('same');
  });

  it('a write over a tombstone stores the item and pays no checkpoint', async () => {
    const opened = await countedWorld();
    await opened.write(async (store) => {
      await store.putSyncItem(note('deleted', 1_790_000_100));
      expect(await store.deleteSyncItem(ATHLETE_A, 'note', 'n-1944-count', 1_790_000_150)).toBe(
        true,
      );
    });
    expect(await bodyHeld(opened), 'the control: it is a tombstone').toBeNull();
    const over = await opened.write((store) => put(store, note('revived', 1_790_000_200)));
    expect(over).toStrictEqual({ answer: 'stored', secureDelete: 0, truncations: 0 });
    expect(await bodyHeld(opened)).toBe('revived');
  });

  it('a write that replaces a live body with different bytes scrubs, once', async () => {
    const opened = await countedWorld();
    await opened.write((store) => store.putSyncItem(note('before', 1_790_000_100)));
    const replaced = await opened.write((store) => put(store, note('after', 1_790_000_200)));
    expect(replaced).toStrictEqual({ answer: 'stored', secureDelete: 1, truncations: 1 });
    expect(await bodyHeld(opened)).toBe('after');
  });
});
