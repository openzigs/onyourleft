// SPDX-License-Identifier: Apache-2.0

/**
 * **A ride's re-plan decisions survive a recovery** — #1328, ADR 0048 D-6 P9.
 *
 * The recording's header carries the decisions made so far, so a ride
 * recovered after a crash is saved with them. Through the real store on a
 * fresh connection: the recorder writes `putRecordingSession` on every flush,
 * and recovery reads `listRecordingSessions` and `recoverRecording`.
 *
 * ⚠️ **Nothing about this field may stop a ride being recovered.** A record
 * that does not read is dropped and counted, a field that is not a list holds
 * no record, and the recording is listed and recovered all the same. The read
 * half plants its row with a raw Dexie handle, because the store's own write
 * path will not write one.
 */

import Dexie from 'dexie';
import { seconds, unixSeconds, watts, type ReplanRecord } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { RECORDING_REPLAN_RECORDS_LIMIT } from './recording';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  recordingFor,
  replanlessCheckpointStoreFactory,
  seedAthletes,
  type StoreFactory,
  type StoreHarness,
} from './testing';

const ACCEPTED: ReplanRecord = {
  decision: 'accepted',
  move: { kind: 'shorten-block', block: 2, minutes: 2 },
  reason: 'heart-rate-high',
  revision: 1,
  at: seconds(1_700_000_300),
};
const REFUSED: ReplanRecord = {
  decision: 'refused',
  rule: 'P4',
  at: seconds(1_700_000_400),
};

/** A record from a build that knew a move this one does not. */
const FROM_A_LATER_BUILD = {
  decision: 'accepted',
  move: { kind: 'set-watts', watts: 400 },
  reason: 'SECRET-WORDS',
  revision: 2,
  at: 1_700_000_900,
};

const SPAN = {
  startedAt: unixSeconds(1_700_000_000),
  updatedAt: unixSeconds(1_700_000_700),
};

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function opened(factory?: StoreFactory): Promise<StoreHarness> {
  const open = createStoreHarness(factory === undefined ? {} : { factory });
  harness = open;
  await seedAthletes(open);
  return open;
}

async function behindTheStore(databaseName: string, id: string, change: object): Promise<void> {
  const raw = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    await raw.table(TABLE.recordingSessions).update(id, change);
  } finally {
    raw.close();
  }
}

/** A header with re-plan records and two samples, written through the store. */
async function recordingWithReplans(
  open: StoreHarness,
  replans: readonly ReplanRecord[],
): Promise<ReturnType<typeof recordingFor>> {
  const record = recordingFor(ATHLETE_A, { ...SPAN, replans });
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

/**
 * The round trip, as a check that throws: the recovered recording holds the
 * records the header was written with. Run against the real store and a fake.
 */
async function assertReplansSurviveRecovery(factory?: StoreFactory): Promise<void> {
  const open = await opened(factory);
  const record = await recordingWithReplans(open, [ACCEPTED, REFUSED]);
  await open.discard();
  const recovered = await open.read((store) => store.recoverRecording(ATHLETE_A, record.id));
  const read = JSON.stringify(recovered?.replans);
  if (read !== JSON.stringify([ACCEPTED, REFUSED])) {
    throw new Error(`the recovered recording's re-plan records came back as ${String(read)}`);
  }
}

describe('the re-plan records on a recording’s header — #1328', () => {
  it('come back on a fresh handle on the header and on the recovered recording, and for nobody else', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, replans: [ACCEPTED, REFUSED] });
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
    expect(read.header?.replans).toEqual([ACCEPTED, REFUSED]);
    expect(read.header?.replansDropped).toBeUndefined();
    expect(read.recovered?.replans).toEqual([ACCEPTED, REFUSED]);
    expect(read.theirs).toBeUndefined();
  });

  it('a recording with none has none, and no key', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, replans: [] });
    const read = await open.roundTrip(
      async (store) => {
        await store.putRecordingSession(record);
      },
      async (store) => store.recoverRecording(ATHLETE_A, record.id),
    );
    expect(read).toBeDefined();
    expect(read).not.toHaveProperty('replans');
    expect(read).not.toHaveProperty('replansDropped');
  });

  it('the harness passes against the real store and fails against a store that drops the field', async () => {
    await expect(assertReplansSurviveRecovery()).resolves.toBeUndefined();
    await harness?.destroy();
    harness = undefined;
    await expect(assertReplansSurviveRecovery(replanlessCheckpointStoreFactory())).rejects.toThrow(
      /re-plan records came back as undefined/,
    );
  });

  it('writes the header and leaves out, and counts, a record that does not read', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, {
      ...SPAN,
      state: 'paused',
      replans: [ACCEPTED, FROM_A_LATER_BUILD, REFUSED] as never,
      replansDropped: 2,
    });
    await expect(open.write(async (store) => store.putRecordingSession(record))).resolves.toBe(
      record.id,
    );
    const header = await open.read((store) => store.getRecordingSession(ATHLETE_A, record.id));
    expect(header?.state).toBe('paused');
    expect(header?.replans).toEqual([ACCEPTED, REFUSED]);
    expect(header?.replansDropped).toBe(3);
    expect(JSON.stringify(header)).not.toContain('SECRET-WORDS');
  });

  it.each([
    ['a string', 'nonsense'],
    ['an object', { decision: 'accepted' }],
    ['null', null],
    ['a list of nothing that reads', [FROM_A_LATER_BUILD, 7, 'x']],
  ])(
    'a planted field that is %s recovers the ride, with no record and a count',
    async (_what, planted) => {
      const open = await opened();
      const record = await recordingWithReplans(open, [ACCEPTED]);
      await open.discard();
      await behindTheStore(open.databaseName, record.id, {
        replans: planted,
        replansDropped: 'many',
      });
      const read = await open.read(async (store) => ({
        listed: (await store.listRecordingSessions(ATHLETE_A)).map((each) => each.id),
        recovered: await store.recoverRecording(ATHLETE_A, record.id),
      }));
      expect(read.listed).toContain(record.id);
      expect(read.recovered?.channels.power).toEqual([1, 2]);
      expect(read.recovered?.replans).toBeUndefined();
      expect(read.recovered?.replansDropped).toBe(Array.isArray(planted) ? planted.length : 1);
    },
  );

  it(`keeps the latest ${String(RECORDING_REPLAN_RECORDS_LIMIT)} of a longer list, and counts the rest unread`, async () => {
    const open = await opened();
    const record = await recordingWithReplans(open, [ACCEPTED]);
    await open.discard();
    const many = Array.from({ length: RECORDING_REPLAN_RECORDS_LIMIT + 5 }, (_, index) => ({
      ...REFUSED,
      at: 1_700_000_000 + index,
    }));
    await behindTheStore(open.databaseName, record.id, { replans: many });
    const recovered = await open.read((store) => store.recoverRecording(ATHLETE_A, record.id));
    expect(recovered?.replans).toHaveLength(RECORDING_REPLAN_RECORDS_LIMIT);
    expect(recovered?.replans?.[0]?.at).toBe(1_700_000_005);
    expect(recovered?.replansDropped).toBe(5);
  });
});
