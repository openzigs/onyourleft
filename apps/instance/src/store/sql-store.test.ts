// SPDX-License-Identifier: AGPL-3.0-or-later

/** What the port does, each claim read back on a fresh connection (#769). */

import { afterEach, describe, expect, it } from 'vitest';
import { OwnershipConflictError } from './sql-store.ts';
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

  it('updates what may change: a revocation, a display name, a result', async () => {
    const opened = await world();
    await opened.write(async (store) => {
      await store.putDeviceKey({ ...deviceKeyFixture(ATHLETE_A), revokedAt: 1_790_000_900 });
      await store.putSession({ ...sessionFixture(ATHLETE_A), revokedAt: 1_790_000_901 });
      await store.putAthlete({ ...athleteFixture(ATHLETE_A), displayName: 'Renamed' });
      await store.putResult({ ...resultFixture(ATHLETE_A), finishMs: 1, flags: 2 });
      await store.putRoom({ ...SHARED_ROOM, visibility: 'public' });
    });
    await opened.read(async (store) => {
      expect((await store.listDeviceKeys(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_900);
      expect((await store.listSessions(ATHLETE_A))[0]?.revokedAt).toBe(1_790_000_901);
      expect((await store.getAthlete(ATHLETE_A))?.displayName).toBe('Renamed');
      expect(await store.listResults(ATHLETE_A)).toEqual([
        { roomId: SHARED_ROOM.id, athleteId: ATHLETE_A, finishMs: 1, flags: 2 },
      ]);
      expect((await store.getRoom(SHARED_ROOM.id))?.visibility).toBe('public');
      expect(await store.listRoomResults(SHARED_ROOM.id)).toHaveLength(3);
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
