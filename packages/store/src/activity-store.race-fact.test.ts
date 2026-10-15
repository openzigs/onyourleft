// SPDX-License-Identifier: Apache-2.0

/**
 * **A race's result is stored with the ride on the device** — #785, the
 * owner's ruling of 2026-10-14. `RideFacts.races` through the real store, on
 * a fresh connection: written by `putActivity` (the ride controller's save),
 * read by `getActivity` (the ride's page and the export). And, as for a
 * re-plan record, a race fact that does not read is dropped, never the ride.
 *
 * And on the recording's checkpoint (#1360's review, B2): `roomRaces` on the
 * header, so a ride recovered after the app closed before *Stop* keeps its
 * races — and a race on a header that does not read never refuses the header,
 * never hides the recording from recovery and never hides another one.
 */

import Dexie from 'dexie';
import { unixSeconds, watts } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { PersistedActivity } from './persisted';
import type { NewActivity, RideFacts } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  recordingFor,
  rideFor,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from './testing';

const ROOM = 'ab'.repeat(16);

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

/** A raw Dexie handle on the harness's database, behind the store's back. */
async function behindTheStore<T>(
  databaseName: string,
  use: (raw: Dexie) => Promise<T>,
): Promise<T> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return await use(raw);
  } finally {
    raw.close();
  }
}

/** Overwrite one ride's stored `rideFacts` behind the store's back. */
async function plant(databaseName: string, id: string, rideFacts: unknown): Promise<void> {
  await behindTheStore(databaseName, async (raw) => {
    const table = raw.table<PersistedActivity, string>(TABLE.activities);
    const row = await table.get(id);
    if (row === undefined) throw new Error('no such ride to edit');
    await table.put({ ...row, rideFacts } as PersistedActivity);
  });
}

/** One ride's `rideFacts` as they were WRITTEN, read behind the store's back. */
async function writtenFacts(databaseName: string, id: string): Promise<unknown> {
  return behindTheStore(databaseName, async (raw) => {
    const row = await raw.table<PersistedActivity, string>(TABLE.activities).get(id);
    return row?.rideFacts;
  });
}

const PLACED = { roomId: ROOM, place: 2, finishers: 5 };
const NOT_PLACED = { roomId: ROOM, place: null, finishers: 3 };
const CROSSED = { roomId: ROOM, place: null, finishers: null, crossedTheLine: true as const };
const LEFT = { roomId: ROOM, place: null, finishers: null };

/** Every shape a race may not have. Each is dropped; none takes the ride with it. */
const BAD: readonly unknown[] = [
  { roomId: 'not a room!', place: 1, finishers: 1 },
  { roomId: 'x'.repeat(129), place: 1, finishers: 1 },
  { roomId: ROOM, place: 3, finishers: 2 },
  { roomId: ROOM, place: 1, finishers: null },
  { roomId: ROOM, place: 0, finishers: 2 },
  { roomId: ROOM, place: 1.5, finishers: 2 },
  // #1360's review, N5: a count below nought.
  { roomId: ROOM, place: null, finishers: -1 },
  // N2: crossing the line is said only where the room's order was not heard.
  { roomId: ROOM, place: null, finishers: 3, crossedTheLine: true },
  { roomId: ROOM, place: 1, finishers: 3, crossedTheLine: true },
  { roomId: ROOM, place: null, finishers: null, crossedTheLine: false },
  { roomId: ROOM, place: null, finishers: null, crossedTheLine: 'yes' },
  'a race',
  null,
];

describe('the races kept with their ride — #785', () => {
  it('are written by putActivity and read back whole on a fresh connection, by their rider only', async () => {
    const open = await opened();
    const ride: NewActivity = rideFor(ATHLETE_A, { rideFacts: { races: [PLACED] } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
      }),
    );
    expect(read.mine?.rideFacts).toEqual({ races: [PLACED] });
    expect(read.theirs).toBeUndefined();
  });

  it('keeps every race of one ride, in order: placed, not finished, across the line before the order, and left', async () => {
    // #1360's review, N3 and N2: two (here four) races in one recording are
    // all kept, and a rider who crossed the line and left before the room's
    // order is kept as having crossed it.
    const open = await opened();
    const races = [PLACED, NOT_PLACED, CROSSED, LEFT];
    const ride = rideFor(ATHLETE_A, { rideFacts: { races } });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );
    expect(read?.rideFacts?.races).toEqual(races);
  });

  it('drops a race that does not read on the way IN — it is not written at all — and keeps the ride and the races beside it', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = rideFor(ATHLETE_A, {
        rideFacts: { workoutFinished: true, races: [bad, LEFT] } as unknown as RideFacts,
      });
      await open.write(async (store) => store.putActivity(ride));
      // #1360's review, N4: read the ROW, so the write half is pinned on its
      // own — the read path would drop the same race and hide a write that
      // let it through.
      expect(await writtenFacts(open.databaseName, ride.id), JSON.stringify(bad)).toEqual({
        workoutFinished: true,
        races: [LEFT],
      });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      expect(read?.id, JSON.stringify(bad)).toBe(ride.id);
      expect(read?.rideFacts, JSON.stringify(bad)).toEqual({
        workoutFinished: true,
        races: [LEFT],
      });
    }
  });

  it('drops a race that does not read on the way OUT — never the ride, never the races beside it', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = await seedRide(open, ATHLETE_A);
      await open.discard();
      await plant(open.databaseName, ride.id, { ghostRaced: true, races: [CROSSED, bad] });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      expect(read?.id, JSON.stringify(bad)).toBe(ride.id);
      expect(read?.rideFacts, JSON.stringify(bad)).toEqual({ ghostRaced: true, races: [CROSSED] });
    }
    // A list that is not a list is no races.
    const ride = await seedRide(open, ATHLETE_A);
    await open.discard();
    await plant(open.databaseName, ride.id, { races: PLACED });
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts).toEqual({});
  });
});

describe('the races on a recording’s checkpoint — #785, #1360’s review (B2)', () => {
  const SPAN = {
    startedAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_700),
  };

  it('come back on a fresh handle on the header and on the recovered recording, and for nobody else', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, roomRaces: [PLACED, CROSSED] });
    const read = await open.roundTrip(
      async (store) => {
        await store.putRecordingSession(record);
      },
      async (store) => ({
        header: await store.getRecordingSession(ATHLETE_A, record.id),
        recovered: await store.recoverRecording(ATHLETE_A, record.id),
        theirs: await store.recoverRecording(ATHLETE_B, record.id),
      }),
    );
    expect(read.header?.roomRaces).toEqual([PLACED, CROSSED]);
    expect(read.recovered?.roomRaces).toEqual([PLACED, CROSSED]);
    expect(read.theirs).toBeUndefined();
  });

  it('reads a header with none, or written before the field existed, as a recording in no race', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, roomRaces: [] });
    const read = await open.roundTrip(
      async (store) => {
        await store.putRecordingSession(record);
      },
      async (store) => ({
        header: await store.getRecordingSession(ATHLETE_A, record.id),
        recovered: await store.recoverRecording(ATHLETE_A, record.id),
      }),
    );
    expect(read.header).not.toHaveProperty('roomRaces');
    expect(read.recovered?.roomRaces).toEqual([]);
  });

  it('writes the header — state, pauses and the good races — and leaves out a race that does not read', async () => {
    // #1316's lesson: a figure about the ride never decides whether the header
    // that recovery needs is written. A refused header is a failed checkpoint
    // to the recorder, and `storage: failed` for the rest of the ride.
    const open = await opened();
    for (const bad of BAD) {
      const record = recordingFor(ATHLETE_A, {
        ...SPAN,
        state: 'paused',
        pauses: [{ from: unixSeconds(1_700_000_650), reason: 'manual' }],
        roomRaces: [bad, PLACED] as never,
      });
      await expect(
        open.write(async (store) => store.putRecordingSession(record)),
        JSON.stringify(bad),
      ).resolves.toBe(record.id);
      const row = await behindTheStore(open.databaseName, async (raw) =>
        raw.table<Record<string, unknown>, string>(TABLE.recordingSessions).get(record.id),
      );
      expect(row?.['roomRaces'], JSON.stringify(bad)).toEqual([PLACED]);
      const header = await open.read((store) => store.getRecordingSession(ATHLETE_A, record.id));
      expect(header?.state).toBe('paused');
      expect(header?.pauses).toEqual(record.pauses);
      expect(header?.roomRaces).toEqual([PLACED]);
    }
  });

  it('drops a planted race that does not read, and the recording still recovers and neither header hides the other', async () => {
    const open = await opened();
    for (const planted of [...BAD.map((bad) => [bad]), 'two', 5, { 0: PLACED }]) {
      const healthy = recordingFor(ATHLETE_A, { ...SPAN, roomRaces: [LEFT] });
      const damaged = recordingFor(ATHLETE_A, { ...SPAN, roomRaces: [LEFT] });
      await open.write(async (store) => {
        await store.putRecordingSession(healthy);
        await store.putRecordingSession(damaged);
        await store.appendRecordingChunk({
          sessionId: damaged.id,
          athleteId: ATHLETE_A,
          seq: 0,
          fromIndex: 0,
          sampleCount: 2,
          channels: { power: [watts(1), watts(2)] },
        });
      });
      await open.discard();
      await behindTheStore(open.databaseName, async (raw) => {
        await raw.table(TABLE.recordingSessions).update(damaged.id, { roomRaces: planted });
      });
      const read = await open.read(async (store) => ({
        listed: (await store.listRecordingSessions(ATHLETE_A)).map((each) => each.id),
        recovered: await store.recoverRecording(ATHLETE_A, damaged.id),
        other: await store.recoverRecording(ATHLETE_A, healthy.id),
      }));
      const said = JSON.stringify(planted);
      expect(read.recovered?.roomRaces, said).toEqual([]);
      expect(read.recovered?.channels.power, said).toEqual([1, 2]);
      expect(read.listed, said).toEqual(expect.arrayContaining([healthy.id, damaged.id]));
      expect(read.other?.roomRaces, said).toEqual([LEFT]);
    }
  });
});
