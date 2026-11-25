// SPDX-License-Identifier: Apache-2.0

/**
 * **An open-world ride says so, on the ride and on its checkpoint** — #3088,
 * the owner's ruling of 2026-11-25: an open-world ride is matched against no
 * segment, and the key is a mark on the saved ride.
 *
 * Through the real store on a fresh connection: `RideFacts.openWorld` written
 * by `putActivity` and read by `getActivity` and `listActivitySummaries` (the
 * page the segment sweep reads), and the recording header's `openWorld`
 * written by `putRecordingSession` and read by `recoverRecording`, so a ride
 * recovered after a crash is saved with it.
 *
 * ⚠️ **Nothing about the header's mark may stop a ride being recovered**: a
 * planted value that is not `true` reads as no mark, and the recording is
 * recovered all the same. The read half plants its row with a raw Dexie
 * handle, because the store's own write path will not write one.
 */

import Dexie from 'dexie';
import { unixSeconds, watts } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  recordingFor,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function opened(): Promise<StoreHarness> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  return open;
}

const SPAN = {
  startedAt: unixSeconds(1_700_000_000),
  updatedAt: unixSeconds(1_700_000_700),
};

/** A header and two samples, written through the store. */
async function recording(
  open: StoreHarness,
  overrides: Partial<ReturnType<typeof recordingFor>> = {},
): Promise<ReturnType<typeof recordingFor>> {
  const record = recordingFor(ATHLETE_A, { ...SPAN, ...overrides });
  await open.write(async (store) => {
    await store.putRecordingSession(record);
    await store.appendRecordingChunk({
      sessionId: record.id,
      athleteId: ATHLETE_A,
      seq: 0,
      fromIndex: 0,
      sampleCount: 2,
      channels: { power: [watts(1), watts(2)] },
    });
  });
  return record;
}

describe('the open-world mark kept with its ride — #3088', () => {
  it('is written by putActivity and read back on a fresh connection, by its rider only, on the page and the history', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { hasPosition: true, rideFacts: { openWorld: true } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
        listed: await store.listActivitySummaries(ATHLETE_A),
      }),
    );
    expect(read.mine?.rideFacts).toStrictEqual({ openWorld: true });
    expect(read.theirs).toBeUndefined();
    expect(read.listed.find((each) => each.id === ride.id)?.rideFacts?.openWorld).toBe(true);
  });

  it('is absent from a ride saved without it', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, { hasPosition: true, rideFacts: {} });
    await open.write(async (store) => store.putActivity(ride));
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts).toStrictEqual({});
  });
});

describe('the open-world mark kept on a recording’s checkpoint — #3088', () => {
  it('is recovered from the header on a fresh connection, and only by its rider', async () => {
    const open = await opened();
    const record = await recording(open, { openWorld: true });
    await open.discard();
    const read = await open.read(async (store) => ({
      mine: await store.recoverRecording(ATHLETE_A, record.id),
      theirs: await store.recoverRecording(ATHLETE_B, record.id),
    }));
    expect(read.mine?.openWorld).toBe(true);
    expect(read.mine?.sampleCount).toBe(2);
    expect(read.theirs).toBeUndefined();
  });

  it('is absent from a recording that was never marked', async () => {
    const open = await opened();
    const record = await recording(open);
    await open.discard();
    const recovered = await open.read((store) => store.recoverRecording(ATHLETE_A, record.id));
    expect(recovered?.sampleCount).toBe(2);
    expect(recovered).not.toHaveProperty('openWorld');
  });

  it('reads a planted value that is not true as no mark, and recovers the recording all the same', async () => {
    for (const planted of [false, 'true', 1, null, {}]) {
      const open = await opened();
      const record = await recording(open, { openWorld: true });
      await open.discard();
      const raw = new Dexie(open.databaseName);
      SCHEMA_VERSIONS.forEach((stores, index) => {
        raw.version(index + 1).stores(stores);
      });
      try {
        await raw.table(TABLE.recordingSessions).update(record.id, { openWorld: planted });
      } finally {
        raw.close();
      }
      const recovered = await open.read((store) => store.recoverRecording(ATHLETE_A, record.id));
      const said = JSON.stringify(planted);
      expect(recovered?.sampleCount, said).toBe(2);
      expect(recovered, said).not.toHaveProperty('openWorld');
      await open.destroy();
      harness = undefined;
    }
  });
});
