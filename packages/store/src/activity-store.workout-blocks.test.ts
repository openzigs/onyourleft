// SPDX-License-Identifier: Apache-2.0

/**
 * **A workout's blocks are kept with the ride** — #1319. `RideFacts.workoutBlocks`
 * through the real store on a fresh connection, written by `putActivity`
 * (the ride controller's save) and read by `getActivity` (the ride's page). And
 * on the recording's header, so a ride recovered after a crash keeps them.
 *
 * A list that does not read is dropped whole — never the ride, never the
 * header — because a block is numbered by where it stands.
 */

import Dexie from 'dexie';
import {
  beatsPerMinute,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type ThresholdShare,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { RecordedWorkoutBlock } from './recording';
import type { WorkoutBlockFact } from './records';
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

const share = (value: number): ThresholdShare => value as ThresholdShare;

const WARM_UP = { kind: 'steady', seconds: seconds(600), target: share(0.6) } as const;
const EFFORTS = {
  kind: 'intervals',
  repeats: 4,
  hardSeconds: seconds(180),
  hardTarget: share(1.1),
  easySeconds: seconds(120),
  easyTarget: share(0.5),
  label: 'Over-unders',
} as const;
const COOL_DOWN = { kind: 'free-ride', seconds: seconds(300) } as const;

const RIDDEN: WorkoutBlockFact = {
  outcome: 'ridden',
  block: WARM_UP,
  startedAt: unixSeconds(1_700_000_000),
  elapsedTime: seconds(600),
  movingTime: seconds(600),
  averagePower: watts(150),
  maxPower: watts(210),
  averageHeartRate: beatsPerMinute(120),
  maxHeartRate: beatsPerMinute(131),
  averageCadence: revolutionsPerMinute(88),
};
const CUT_SHORT: WorkoutBlockFact = {
  outcome: 'cut-short',
  block: EFFORTS,
  eased: true,
  startedAt: unixSeconds(1_700_000_600),
  elapsedTime: seconds(400),
  movingTime: seconds(380),
};
const SKIPPED: WorkoutBlockFact = { outcome: 'skipped', block: COOL_DOWN };

/** Every shape an entry may not have. Each takes the LIST with it, never the ride. */
const BAD: readonly unknown[] = [
  { ...RIDDEN, outcome: 'finished' },
  { ...RIDDEN, block: { kind: 'steady', seconds: 600, target: 60 } },
  { ...RIDDEN, block: { kind: 'sprint', seconds: 10 } },
  { ...RIDDEN, block: undefined },
  { ...RIDDEN, movingTime: -1 },
  { ...RIDDEN, startedAt: 'yesterday' },
  { ...RIDDEN, averagePower: Number.NaN },
  { ...RIDDEN, maxHeartRate: '180' },
  { outcome: 'ridden', block: WARM_UP },
  'a block',
  null,
];

describe('the workout blocks kept with their ride — #1319', () => {
  it('are written by putActivity and read back whole on a fresh connection, by their rider only', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, {
      rideFacts: { workoutBlocks: [RIDDEN, CUT_SHORT, SKIPPED] },
    });
    const read = await open.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => ({
        mine: await store.getActivity(ATHLETE_A, ride.id),
        theirs: await store.getActivity(ATHLETE_B, ride.id),
      }),
    );
    expect(read.mine?.rideFacts?.workoutBlocks).toEqual([RIDDEN, CUT_SHORT, SKIPPED]);
    expect(read.theirs).toBeUndefined();
  });

  it('leaves a list with an entry that does not read out on the way IN, and keeps the ride', async () => {
    const open = await opened();
    for (const bad of BAD) {
      const ride = rideFor(ATHLETE_A, {
        rideFacts: { workoutFinished: true, workoutBlocks: [RIDDEN, bad] as never },
      });
      await open.write(async (store) => store.putActivity(ride));
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(bad);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts, said).toEqual({ workoutFinished: true });
    }
  });

  it('drops a planted list that does not read on the way OUT, never the ride', async () => {
    const open = await opened();
    for (const planted of [...BAD.map((bad) => [RIDDEN, bad]), 'two', 5, { 0: RIDDEN }]) {
      const ride = rideFor(ATHLETE_A, { rideFacts: { workoutBlocks: [RIDDEN] } });
      await open.write(async (store) => store.putActivity(ride));
      await open.discard();
      await behindTheStore(open.databaseName, async (raw) => {
        const table = raw.table<Record<string, unknown>, string>(TABLE.activities);
        const row = await table.get(ride.id);
        await table.put({ ...row, rideFacts: { workoutBlocks: planted } });
      });
      const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
      const said = JSON.stringify(planted);
      expect(read?.id, said).toBe(ride.id);
      expect(read?.rideFacts?.workoutBlocks, said).toBeUndefined();
    }
  });

  it('keeps only the block’s own keys', async () => {
    const open = await opened();
    const ride = rideFor(ATHLETE_A, {
      rideFacts: {
        workoutBlocks: [{ ...RIDDEN, block: { ...WARM_UP, planted: 'x' } } as never],
      },
    });
    await open.write(async (store) => store.putActivity(ride));
    const read = await open.read((store) => store.getActivity(ATHLETE_A, ride.id));
    expect(read?.rideFacts?.workoutBlocks?.[0]?.block).toEqual(WARM_UP);
  });
});

describe('the workout blocks on a recording’s header — #1319', () => {
  const SPAN = {
    startedAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_700),
  };
  const FIRST: RecordedWorkoutBlock = {
    outcome: 'ridden',
    block: WARM_UP,
    from: { at: unixSeconds(1_700_000_010), movingTime: seconds(10) },
    to: { at: unixSeconds(1_700_000_610), movingTime: seconds(610) },
  };
  const OPEN: RecordedWorkoutBlock = {
    outcome: 'cut-short',
    block: EFFORTS,
    eased: true,
    from: { at: unixSeconds(1_700_000_610), movingTime: seconds(610) },
    to: { at: unixSeconds(1_700_000_690), movingTime: seconds(690) },
  };
  const LATER: RecordedWorkoutBlock = { outcome: 'skipped', block: COOL_DOWN };

  it('come back on a fresh handle on the header and on the recovered recording, and for nobody else', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, workoutBlocks: [FIRST, OPEN, LATER] });
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
    expect(read.header?.workoutBlocks).toEqual([FIRST, OPEN, LATER]);
    expect(read.recovered?.workoutBlocks).toEqual([FIRST, OPEN, LATER]);
    expect(read.theirs).toBeUndefined();
  });

  it('writes the header and leaves out a list that does not read, or lies outside the recording', async () => {
    const open = await opened();
    const outside: readonly unknown[] = [
      ...BAD,
      // Before the recording began, after the header was written, or before
      // the block in front of it ended.
      { ...FIRST, from: { at: 1_699_999_999, movingTime: 0 } },
      { ...OPEN, to: { at: 1_700_000_701, movingTime: 690 } },
      { ...OPEN, from: { at: 1_700_000_600, movingTime: 600 } },
      // Ending before it began, on either clock.
      { ...OPEN, to: { at: 1_700_000_609, movingTime: 690 } },
      { ...OPEN, to: { at: 1_700_000_690, movingTime: 609 } },
    ];
    for (const bad of outside) {
      const record = recordingFor(ATHLETE_A, {
        ...SPAN,
        state: 'paused',
        workoutBlocks: [FIRST, bad] as never,
      });
      await expect(
        open.write(async (store) => store.putRecordingSession(record)),
        JSON.stringify(bad),
      ).resolves.toBe(record.id);
      const header = await open.read((store) => store.getRecordingSession(ATHLETE_A, record.id));
      expect(header?.state, JSON.stringify(bad)).toBe('paused');
      expect(header?.workoutBlocks, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('drops a planted list that does not read, and the recording still recovers', async () => {
    const open = await opened();
    const record = recordingFor(ATHLETE_A, { ...SPAN, workoutBlocks: [FIRST] });
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
    await open.discard();
    await behindTheStore(open.databaseName, async (raw) => {
      await raw
        .table(TABLE.recordingSessions)
        .update(record.id, { workoutBlocks: [{ ...FIRST, outcome: 'done' }] });
    });
    const read = await open.read(async (store) => ({
      listed: (await store.listRecordingSessions(ATHLETE_A)).map((each) => each.id),
      recovered: await store.recoverRecording(ATHLETE_A, record.id),
    }));
    expect(read.listed).toContain(record.id);
    expect(read.recovered?.channels.power).toEqual([1, 2]);
    expect(read.recovered?.workoutBlocks).toBeUndefined();
  });
});
