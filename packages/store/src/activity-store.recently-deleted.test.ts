// SPDX-License-Identifier: Apache-2.0

/**
 * Recently deleted — #1431.
 *
 * A rider's *Delete* moves a ride here for thirty days instead of destroying
 * it. Every assertion reads back through a connection the writes never
 * touched (`docs/agents/store-harness.md`), and through the read a real
 * consumer uses: the library's list, the export's record and note reads, the
 * boards' effort reads, the import's duplicate check.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';

import { RECENTLY_DELETED_SECONDS } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  effortFor,
  extractableDeviceKey,
  FIXTURE_EPOCH,
  lapFor,
  resetFixtureIds,
  rideFor,
  riderTextFor,
  seedAthletes,
  segmentFor,
  signedRecordFor,
  streamSetFor,
} from './testing';
import type { StoreHarness } from './testing';
import type { NewActivity, SegmentRecord } from './records';

const DELETED_AT: UnixSeconds = unixSeconds(FIXTURE_EPOCH + 1_000_000);
const A_DAY = 24 * 60 * 60;

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

const FILE_HASH = 'ab'.repeat(32);

/** A ride with every part a delete must carry: laps, streams, record, efforts, note. */
async function seedWholeRide(): Promise<{ ride: NewActivity; segment: SegmentRecord }> {
  const segment = segmentFor(ATHLETE_A);
  const ride = rideFor(ATHLETE_A, {
    hasPosition: true,
    originalFile: { key: 'a/original.fit', sha256: FILE_HASH },
  });
  const { record: deviceKey, key } = await extractableDeviceKey(ATHLETE_A);
  const signed = await signedRecordFor(ride, key);
  await harness.write(async (store) => {
    await store.putSegment(segment);
    await store.putActivity(ride);
    await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
    await store.putLap(lapFor(ride, 1));
    await store.putLap(lapFor(ride, 2));
    await store.putActivityEfforts(ATHLETE_A, ride.id, [effortFor(ATHLETE_A, segment.id, ride.id)]);
    await store.putDeviceKey(deviceKey);
    await store.putActivityRecord(signed);
    await store.putRiderText(riderTextFor(ATHLETE_A, 'note', ride.id));
  });
  return { ride, segment };
}

describe('moving a ride to Recently deleted', () => {
  it('takes it out of every read a rider, a sync or the export reaches it by', async () => {
    const { ride, segment } = await seedWholeRide();
    const moved = await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT),
    );
    expect(moved).toBe(true);

    await harness.read(async (store) => {
      await expect(store.getActivity(ATHLETE_A, ride.id)).resolves.toBeUndefined();
      await expect(store.listActivitySummaries(ATHLETE_A)).resolves.toStrictEqual([]);
      // The export reads the signed record and the note; the sync lists notes.
      await expect(store.getActivityRecord(ATHLETE_A, ride.id)).resolves.toBeUndefined();
      await expect(store.listRiderTexts(ATHLETE_A, 'note')).resolves.toStrictEqual([]);
      await expect(store.listRiderTextKeys(ATHLETE_A, 'note')).resolves.toStrictEqual([]);
      // Not on a segment board.
      await expect(store.listEfforts(ATHLETE_A, segment.id)).resolves.toStrictEqual([]);
      await expect(store.listActivityEfforts(ATHLETE_A, ride.id)).resolves.toStrictEqual([]);
      // Not found by the import's duplicate check either.
      await expect(
        store.findActivityByOriginalFileHash(ATHLETE_A, FILE_HASH),
      ).resolves.toBeUndefined();
    });
  });

  it('lists it, newest deleted first, with when it will be removed', async () => {
    const { ride } = await seedWholeRide();
    const second = rideFor(ATHLETE_A, { name: 'Second' });
    await harness.write(async (store) => {
      await store.putActivity(second);
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT);
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, second.id, unixSeconds(DELETED_AT + 60));
    });

    const listed = await harness.read(async (store) =>
      store.listRecentlyDeleted(ATHLETE_A, unixSeconds(DELETED_AT + 120)),
    );
    expect(listed.map((each) => each.id)).toStrictEqual([second.id, ride.id]);
    expect(listed[1]?.deletedAt).toBe(DELETED_AT);
    expect(listed[1]?.removedAt).toBe(DELETED_AT + RECENTLY_DELETED_SECONDS);
    expect(listed[1]?.summary.name).toBe(ride.name);
    expect(listed[1]?.summary.distance).toBe(ride.distance);
    expect(listed[1]?.athleteId).toBe(ATHLETE_A);
  });

  it('moves nothing of another athlete', async () => {
    const theirs = rideFor(ATHLETE_B);
    await harness.write(async (store) => store.putActivity(theirs));
    await expect(
      harness.write(async (store) =>
        store.moveActivityToRecentlyDeleted(ATHLETE_A, theirs.id, DELETED_AT),
      ),
    ).resolves.toBe(false);
    await harness.read(async (store) => {
      await expect(store.getActivity(ATHLETE_B, theirs.id)).resolves.toBeDefined();
      await expect(store.listRecentlyDeleted(ATHLETE_A, DELETED_AT)).resolves.toStrictEqual([]);
    });
  });
});

describe('bringing a ride back', () => {
  it('restores it whole: samples, laps, note, record and efforts', async () => {
    const { ride, segment } = await seedWholeRide();
    const before = await harness.read(async (store) => ({
      streams: await store.getStreamSet(ATHLETE_A, ride.id),
      record: await store.getActivityRecord(ATHLETE_A, ride.id),
    }));
    await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT),
    );

    const outcome = await harness.write(async (store) =>
      store.restoreRecentlyDeleted(ATHLETE_A, ride.id, unixSeconds(DELETED_AT + A_DAY)),
    );
    expect(outcome).toBe('restored');

    await harness.read(async (store) => {
      const summaries = await store.listActivitySummaries(ATHLETE_A);
      expect(summaries.map((each) => each.id)).toStrictEqual([ride.id]);
      expect((await store.listLaps(ATHLETE_A, ride.id)).map((lap) => lap.ordinal)).toStrictEqual([
        1, 2,
      ]);
      expect(await store.getStreamSet(ATHLETE_A, ride.id)).toStrictEqual(before.streams);
      expect(await store.getActivityRecord(ATHLETE_A, ride.id)).toStrictEqual(before.record);
      expect((await store.listRiderTexts(ATHLETE_A, 'note')).map((note) => note.key)).toStrictEqual(
        [ride.id],
      );
      expect(await store.listEfforts(ATHLETE_A, segment.id)).toHaveLength(1);
      await expect(
        store.listRecentlyDeleted(ATHLETE_A, unixSeconds(DELETED_AT + A_DAY)),
      ).resolves.toStrictEqual([]);
    });
  });

  it('refuses a ride whose file is in the library again, and changes nothing', async () => {
    const { ride } = await seedWholeRide();
    const again = rideFor(ATHLETE_A, {
      originalFile: { key: 'a/again.fit', sha256: FILE_HASH },
    });
    await harness.write(async (store) => {
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT);
      await store.putActivity(again);
    });

    await expect(
      harness.write(async (store) => store.restoreRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT)),
    ).resolves.toBe('already-there');
    await harness.read(async (store) => {
      expect((await store.listActivitySummaries(ATHLETE_A)).map((each) => each.id)).toStrictEqual([
        again.id,
      ]);
      expect(await store.listRecentlyDeleted(ATHLETE_A, DELETED_AT)).toHaveLength(1);
    });
  });

  it("is `missing` for another athlete's ride, and leaves it where it is", async () => {
    const theirs = rideFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putActivity(theirs);
      await store.moveActivityToRecentlyDeleted(ATHLETE_B, theirs.id, DELETED_AT);
    });
    await expect(
      harness.write(async (store) =>
        store.restoreRecentlyDeleted(ATHLETE_A, theirs.id, DELETED_AT),
      ),
    ).resolves.toBe('missing');
    await harness.read(async (store) => {
      await expect(store.getActivity(ATHLETE_A, theirs.id)).resolves.toBeUndefined();
      await expect(store.getActivity(ATHLETE_B, theirs.id)).resolves.toBeUndefined();
      expect(await store.listRecentlyDeleted(ATHLETE_B, DELETED_AT)).toHaveLength(1);
    });
  });
});

describe('thirty days, then gone', () => {
  it('stops listing and restoring a ride whose time ran out, before any purge', async () => {
    const { ride } = await seedWholeRide();
    await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT),
    );
    const lastMoment = unixSeconds(DELETED_AT + RECENTLY_DELETED_SECONDS - 1);
    const expired = unixSeconds(DELETED_AT + RECENTLY_DELETED_SECONDS);

    await harness.read(async (store) => {
      expect(await store.listRecentlyDeleted(ATHLETE_A, lastMoment)).toHaveLength(1);
      await expect(store.listRecentlyDeleted(ATHLETE_A, expired)).resolves.toStrictEqual([]);
    });
    await expect(
      harness.write(async (store) => store.restoreRecentlyDeleted(ATHLETE_A, ride.id, expired)),
    ).resolves.toBe('missing');
  });

  it('purges an expired ride with its laps and streams, and keeps one still in its time', async () => {
    const { ride } = await seedWholeRide();
    const recent = rideFor(ATHLETE_A, { name: 'Recent' });
    const later = unixSeconds(DELETED_AT + 10 * A_DAY);
    await harness.write(async (store) => {
      await store.putActivity(recent);
      await store.putLap(lapFor(recent, 1));
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT);
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, recent.id, later);
    });

    const now = unixSeconds(DELETED_AT + RECENTLY_DELETED_SECONDS);
    await expect(
      harness.write(async (store) => store.purgeRecentlyDeleted(ATHLETE_A, now)),
    ).resolves.toBe(1);

    await harness.read(async (store) => {
      expect(
        (await store.listRecentlyDeleted(ATHLETE_A, now)).map((each) => each.id),
      ).toStrictEqual([recent.id]);
      await expect(store.listLaps(ATHLETE_A, ride.id)).resolves.toStrictEqual([]);
      await expect(store.getStreamSet(ATHLETE_A, ride.id)).resolves.toBeUndefined();
      // Gone for good: even a stale screen cannot bring it back.
      await expect(store.restoreRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT)).resolves.toBe(
        'missing',
      );
      expect(await store.listLaps(ATHLETE_A, recent.id)).toHaveLength(1);
    });
  });
});

describe('deleting for good', () => {
  it('removes one ride and every part of it', async () => {
    const { ride } = await seedWholeRide();
    await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT),
    );
    await expect(
      harness.write(async (store) => store.deleteRecentlyDeletedForGood(ATHLETE_A, ride.id)),
    ).resolves.toBe(true);
    await harness.read(async (store) => {
      await expect(store.listRecentlyDeleted(ATHLETE_A, DELETED_AT)).resolves.toStrictEqual([]);
      await expect(store.listLaps(ATHLETE_A, ride.id)).resolves.toStrictEqual([]);
      await expect(store.getStreamSet(ATHLETE_A, ride.id)).resolves.toBeUndefined();
      await expect(store.restoreRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT)).resolves.toBe(
        'missing',
      );
    });
  });

  it('empties the list, and only this athlete’s', async () => {
    const { ride } = await seedWholeRide();
    const theirs = rideFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putActivity(theirs);
      await store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT);
      await store.moveActivityToRecentlyDeleted(ATHLETE_B, theirs.id, DELETED_AT);
    });
    await expect(
      harness.write(async (store) => store.emptyRecentlyDeleted(ATHLETE_A)),
    ).resolves.toBe(1);
    await harness.read(async (store) => {
      await expect(store.listRecentlyDeleted(ATHLETE_A, DELETED_AT)).resolves.toStrictEqual([]);
      await expect(store.listLaps(ATHLETE_A, ride.id)).resolves.toStrictEqual([]);
      expect(await store.listRecentlyDeleted(ATHLETE_B, DELETED_AT)).toHaveLength(1);
    });
  });
});

describe('erasing the athlete', () => {
  it('takes Recently deleted with everything else, and counts it', async () => {
    const { ride } = await seedWholeRide();
    await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT),
    );
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.recentlyDeleted).toBe(1);
    expect(counts.activities).toBe(0);
    await harness.read(async (store) => {
      await expect(store.listRecentlyDeleted(ATHLETE_A, DELETED_AT)).resolves.toStrictEqual([]);
      await expect(store.restoreRecentlyDeleted(ATHLETE_A, ride.id, DELETED_AT)).resolves.toBe(
        'missing',
      );
    });
  });
});
