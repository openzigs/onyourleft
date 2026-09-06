// SPDX-License-Identifier: Apache-2.0

/**
 * The recording checkpoint store — the durable half of #46.
 *
 * Every persistence assertion goes through the harness from
 * `@onyourleft/store/testing`, which closes every connection between the write
 * and the read. Here that is not a nicety: the subject of this file is *what
 * survives a crash*, and a read served by the connection that wrote cannot
 * distinguish a committed row from a queued one. Closing the connection is the
 * closest a test gets to killing the tab.
 */

import { beatsPerMinute, seconds, unixSeconds, watts } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { recordingSessionId } from './ids';
import type { PersistedRecordingChunk } from './recording-persisted';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  STREAM_CHANNELS,
  type NewStreamSet,
  type StreamChannel,
  type StreamChannels,
} from './streams';
import {
  assertRecordingRecovers,
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  chunksOf,
  createStoreHarness,
  DROPPED_STRAP,
  FOUR_HOUR_SAMPLE_COUNT,
  recordingFor,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  seedRecording,
  seedRide,
  streamSetFor,
  type StoreHarness,
} from './testing';

/**
 * The flush interval a recorder is expected to use, and the loss bound that
 * follows from it.
 *
 * Stated here rather than measured, because it is a **product guarantee** and
 * not an observation: at most this many seconds of a ride can be lost to a
 * crash. `apps/web/src/recording/recorder.ts` holds the defaults it is derived
 * from — a five-second flush interval, a two-second late tolerance, and the one
 * open second the grid has not closed.
 */
const FLUSH_INTERVAL_SAMPLES = 5;

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await harness.destroy();
});

/** A raw Dexie handle on the harness's database, for planting and inspecting rows. */
function rawHandle(): Dexie {
  const raw = new Dexie(harness.databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  return raw;
}

async function readRaw<T>(read: (raw: Dexie) => Promise<T>): Promise<T> {
  await harness.discard();
  const raw = rawHandle();
  try {
    return await read(raw);
  } finally {
    raw.close();
  }
}

/** The channels of a stream set, truncated to its first `count` samples. */
function firstSamples(set: NewStreamSet, count: number): StreamChannels {
  const channels: { -readonly [C in StreamChannel]?: readonly unknown[] } = {};
  for (const channel of STREAM_CHANNELS) {
    const samples = set.channels[channel];
    if (samples !== undefined) {
      channels[channel] = samples.slice(0, count);
    }
  }
  return channels as StreamChannels;
}

describe('a whole ride, checkpointed and recovered from disk alone', () => {
  it('recovers every sample of a 60-minute ride in order, with the gaps intact', async () => {
    // A one-hour ride with the thirty-second strap dropout ten minutes in.
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const set = streamSetFor(ride, { sampleCount: 3_600, gaps: [DROPPED_STRAP] });
    const recording = await seedRecording(harness, ATHLETE_A, { startedAt: set.startedAt });
    const chunks = chunksOf(recording, set, FLUSH_INTERVAL_SAMPLES);

    expect(chunks).toHaveLength(720);

    await harness.write(async (store) => {
      for (const chunk of chunks) {
        await store.appendRecordingChunk(chunk);
      }
    });

    // Every in-memory recorder state is discarded here: `assertRecordingRecovers`
    // reads on a connection this process has never used for a write.
    const recovered = await assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
      sampleCount: 3_600,
      channels: set.channels,
    });

    expect(recovered.startedAt).toBe(set.startedAt);
    expect(recovered.sampleInterval).toBe(seconds(1));
    expect(recovered.chunksAfterGap).toBe(0);
    expect(harness.connectionsOpened).toBeGreaterThanOrEqual(2);
    // The dropout survived as absence, and did not become thirty seconds at
    // 0 bpm. This is the one assertion the whole recovery path exists for.
    expect(
      recovered.channels.heartRate?.slice(DROPPED_STRAP.from, DROPPED_STRAP.from + 30),
    ).toEqual(new Array<undefined>(30).fill(undefined));
    expect(recovered.channels.heartRate?.[DROPPED_STRAP.from - 1]).toBeDefined();
  });

  it('recovers a channel that only appears part way through, without shifting it', async () => {
    // A heart-rate strap paired ten seconds into the ride.
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 2,
        channels: { power: [watts(200), watts(201)] },
      });
      await store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 1,
        fromIndex: 2,
        sampleCount: 2,
        channels: { power: [watts(202), watts(203)], heartRate: [undefined, beatsPerMinute(145)] },
      });
    });

    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recording.id),
    );
    expect(recovered?.sampleCount).toBe(4);
    expect(recovered?.channels.power).toEqual([200, 201, 202, 203]);
    // Absent for the two slots before the strap arrived, not shifted into them.
    expect(recovered?.channels.heartRate).toEqual([undefined, undefined, undefined, 145]);
  });

  it('finds nothing for a recording that was never written', async () => {
    const missing = recordingSessionId('never-written');
    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, missing)),
    ).resolves.toBeUndefined();
    await expect(
      harness.read(async (store) => store.getRecordingFootprint(ATHLETE_A, missing)),
    ).resolves.toBeUndefined();
  });
});

describe('the data-loss bound between flushes', () => {
  it('loses at most one flush interval when the tab dies between flushes', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, { sampleCount: 600 });
    const recording = await seedRecording(harness, ATHLETE_A, { startedAt: set.startedAt });
    const chunks = chunksOf(recording, set, FLUSH_INTERVAL_SAMPLES);

    // The rider has ridden 600 seconds. The last flush landed at 595, and the
    // tab dies before the next one — so the final window is offered and never
    // written, which is exactly the crash-between-flushes case.
    const written = chunks.slice(0, chunks.length - 1);
    await harness.write(async (store) => {
      for (const chunk of written) {
        await store.appendRecordingChunk(chunk);
      }
    });

    const survived = written.length * FLUSH_INTERVAL_SAMPLES;
    const recovered = await assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
      sampleCount: survived,
      channels: firstSamples(set, survived),
    });

    const lostSeconds = set.sampleCount - recovered.sampleCount;
    expect(lostSeconds).toBe(FLUSH_INTERVAL_SAMPLES);
    // The bound, stated as a number and asserted as one.
    expect(lostSeconds).toBeLessThanOrEqual(FLUSH_INTERVAL_SAMPLES);
  });

  it('recovers a consistent prefix when a flush is lost mid-ride, rather than a shifted series', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, { sampleCount: 100 });
    const recording = await seedRecording(harness, ATHLETE_A, { startedAt: set.startedAt });
    const chunks = chunksOf(recording, set, 10);

    // Chunks 0, 1 and 2 land; chunk 3 never commits; 4 through 9 do. A recovery
    // that concatenated the survivors would return 90 samples with every sample
    // after index 30 on the wrong second — the right length and the wrong ride.
    await harness.write(async (store) => {
      for (const chunk of chunks) {
        if (chunk.seq === 3) {
          continue;
        }
        await store.appendRecordingChunk(chunk);
      }
    });

    const recovered = await assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
      sampleCount: 30,
      channels: firstSamples(set, 30),
    });
    expect(recovered.chunksAfterGap).toBe(6);
  });

  it('stops at a chunk whose window does not continue the prefix', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 4,
        channels: { power: [watts(1), watts(2), watts(3), watts(4)] },
      });
      // Contiguous by `seq` and not by `fromIndex` — the shape a chunk written
      // against a series this recorder does not have would take.
      await store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 1,
        fromIndex: 40,
        sampleCount: 1,
        channels: { power: [watts(5)] },
      });
    });

    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recording.id),
    );
    expect(recovered?.sampleCount).toBe(4);
    expect(recovered?.chunksAfterGap).toBe(1);
  });
});

describe('a crash mid-write', () => {
  it('leaves no partial chunk behind — the append either commits whole or not at all', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 2,
        channels: { power: [watts(100), watts(101)] },
      }),
    );

    // The engine fails part way through writing the second chunk's row.
    // Captured **unbound** deliberately, the same way `stream-store.test.ts`
    // does it: the replacement re-applies it with the receiver it intercepted,
    // which is what lets every other object store's writes through untouched.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ): IDBRequest<IDBValidKey> {
      if (this.name === TABLE.recordingChunks) {
        throw new DOMException('the tab went away', 'AbortError');
      }
      return originalPut.apply(this, args);
    });

    await expect(
      harness.write(async (store) =>
        store.appendRecordingChunk({
          sessionId: recording.id,
          athleteId: ATHLETE_A,
          seq: 1,
          fromIndex: 2,
          sampleCount: 2,
          channels: { power: [watts(102), watts(103)] },
        }),
      ),
    ).rejects.toThrow();
    spy.mockRestore();

    // A fresh connection sees the first chunk and nothing of the second — not a
    // truncated row that fails to decode.
    const recovered = await assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
      sampleCount: 2,
      channels: { power: [watts(100), watts(101)] },
    });
    expect(recovered.chunksAfterGap).toBe(0);

    const rows = await readRaw(async (raw) =>
      raw.table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks).toArray(),
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a chunk whose stored bytes do not decode, rather than returning a short channel', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 4,
        channels: { power: [watts(1), watts(2), watts(3), watts(4)] },
      }),
    );

    // Truncate the stored bytes the way a half-written file would be.
    await readRaw(async (raw) => {
      const table = raw.table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks);
      const row = await table.get([recording.id, 0]);
      const corrupt = row as PersistedRecordingChunk;
      corrupt.channels[0]!.values = corrupt.channels[0]!.values.slice(0, 2);
      await table.put(corrupt);
    });

    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
  });

  it('refuses a chunk whose declared sample count disagrees with its channel', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 4,
        channels: { power: [watts(1), watts(2), watts(3), watts(4)] },
      }),
    );

    await readRaw(async (raw) => {
      const table = raw.table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks);
      const row = (await table.get([recording.id, 0])) as PersistedRecordingChunk;
      // The chunk claims four slots; its only channel now claims two, and its
      // bytes agree with the channel. Nothing but this cross-check notices.
      row.channels[0]!.sampleCount = 2;
      row.channels[0]!.values = row.channels[0]!.values.slice(0, 4);
      await table.put(row);
    });

    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
  });

  it('refuses a header row whose state is not one this build writes', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await readRaw(async (raw) => {
      const table = raw.table<{ id: string; state: string }, string>(TABLE.recordingSessions);
      const row = await table.get(recording.id);
      await table.put({ ...(row as { id: string; state: string }), state: 'uploading' });
    });

    await expect(
      harness.read(async (store) => store.getRecordingSession(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
  });

  it('refuses a chunk row whose channel list is not an array, on both read paths', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 1,
        channels: { power: [watts(1)] },
      }),
    );

    await readRaw(async (raw) => {
      const table = raw.table<Record<string, unknown>, [string, number]>(TABLE.recordingChunks);
      const row = (await table.get([recording.id, 0])) as Record<string, unknown>;
      await table.put({ ...row, channels: 'power' });
    });

    // Both the recovery and the footprint refuse it. The footprint is the one
    // that matters here: it never decodes a sample, so without this check it
    // would report a plausible byte count for a row it cannot read.
    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
    await expect(
      harness.read(async (store) => store.getRecordingFootprint(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
  });

  it('names the type rather than the value when a corrupt field is not a string', async () => {
    // ADR 0004 decision D's habit, applied to a decode message: a row that has
    // been corrupted into a number should not have that number echoed into a
    // console and a bug tracker.
    const recording = await seedRecording(harness, ATHLETE_A);
    await readRaw(async (raw) => {
      const table = raw.table<Record<string, unknown>, string>(TABLE.recordingSessions);
      const row = (await table.get(recording.id)) as Record<string, unknown>;
      await table.put({ ...row, state: 42 });
    });

    await expect(
      harness.read(async (store) => store.getRecordingSession(ATHLETE_A, recording.id)),
    ).rejects.toThrow(/found number$/);
  });

  it('refuses a header row whose pause list is not one this build wrote', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await readRaw(async (raw) => {
      const table = raw.table<Record<string, unknown>, string>(TABLE.recordingSessions);
      const row = (await table.get(recording.id)) as Record<string, unknown>;
      await table.put({ ...row, pauses: [{ from: 1, reason: 7 }] });
    });
    await expect(
      harness.read(async (store) => store.getRecordingSession(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);

    await readRaw(async (raw) => {
      const table = raw.table<Record<string, unknown>, string>(TABLE.recordingSessions);
      const row = (await table.get(recording.id)) as Record<string, unknown>;
      await table.put({ ...row, pauses: 'none' });
    });
    await expect(
      harness.read(async (store) => store.getRecordingSession(ATHLETE_A, recording.id)),
    ).rejects.toThrow(StoreDecodeError);
  });
});

describe('two tabs recording at once', () => {
  it('keeps two concurrent recordings from corrupting each other', async () => {
    const first = await seedRecording(harness, ATHLETE_A);
    const second = await seedRecording(harness, ATHLETE_A);
    expect(first.id).not.toBe(second.id);

    // Interleaved, the way two live tabs would flush.
    await harness.write(async (store) => {
      for (let seq = 0; seq < 6; seq += 1) {
        await store.appendRecordingChunk({
          sessionId: first.id,
          athleteId: ATHLETE_A,
          seq,
          fromIndex: seq * 2,
          sampleCount: 2,
          channels: { power: [watts(100 + seq), watts(150 + seq)] },
        });
        await store.appendRecordingChunk({
          sessionId: second.id,
          athleteId: ATHLETE_A,
          seq,
          fromIndex: seq * 2,
          sampleCount: 2,
          channels: { power: [watts(200 + seq), watts(250 + seq)] },
        });
      }
    });

    const firstRead = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, first.id),
    );
    const secondRead = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, second.id),
    );

    expect(firstRead?.sampleCount).toBe(12);
    expect(secondRead?.sampleCount).toBe(12);
    // Each tab's samples are its own. A `seq` keyed without the session would
    // have made the two tabs overwrite each other flush for flush.
    expect(firstRead?.channels.power?.[0]).toBe(100);
    expect(secondRead?.channels.power?.[0]).toBe(200);
    expect(firstRead?.channels.power?.[10]).toBe(105);
    expect(secondRead?.channels.power?.[10]).toBe(205);
  });

  it('deleting one recording leaves the other one whole', async () => {
    const first = await seedRecording(harness, ATHLETE_A);
    const second = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) => {
      for (const id of [first.id, second.id]) {
        await store.appendRecordingChunk({
          sessionId: id,
          athleteId: ATHLETE_A,
          seq: 0,
          fromIndex: 0,
          sampleCount: 1,
          channels: { power: [watts(120)] },
        });
      }
    });

    await expect(
      harness.write(async (store) => store.deleteRecordingSession(ATHLETE_A, first.id)),
    ).resolves.toBe(true);

    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, first.id)),
    ).resolves.toBeUndefined();
    const survivor = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, second.id),
    );
    expect(survivor?.sampleCount).toBe(1);

    // The deleted recording's chunk rows went with it rather than being left
    // for a later recording with the same id to inherit.
    const rows = await readRaw(async (raw) =>
      raw.table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks).toArray(),
    );
    expect(rows.map((row) => row.sessionId)).toEqual([second.id]);
  });

  it('deleting a recording that is not there is a no-op rather than an error', async () => {
    await expect(
      harness.write(async (store) =>
        store.deleteRecordingSession(ATHLETE_A, recordingSessionId('never')),
      ),
    ).resolves.toBe(false);
  });
});

describe('cross-athlete exposure', () => {
  it('does not let another athlete read a recording, on either read path', async () => {
    const mine = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: mine.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 1,
        channels: { power: [watts(200)] },
      }),
    );

    for (const other of [ATHLETE_B, ATHLETE_C]) {
      await expect(
        harness.read(async (store) => store.getRecordingSession(other, mine.id)),
      ).resolves.toBeUndefined();
      await expect(
        harness.read(async (store) => store.recoverRecording(other, mine.id)),
      ).resolves.toBeUndefined();
      await expect(
        harness.read(async (store) => store.getRecordingFootprint(other, mine.id)),
      ).resolves.toBeUndefined();
      await expect(
        harness.read(async (store) => store.listRecordingSessions(other)),
      ).resolves.toEqual([]);
    }
  });

  it('does not let another athlete delete a recording', async () => {
    const mine = await seedRecording(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) => store.deleteRecordingSession(ATHLETE_B, mine.id)),
    ).resolves.toBe(false);
    await expect(
      harness.read(async (store) => store.getRecordingSession(ATHLETE_A, mine.id)),
    ).resolves.toBeDefined();
  });

  it('does not let another athlete overwrite a recording header and take it over', async () => {
    const mine = await seedRecording(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.putRecordingSession({ ...recordingFor(ATHLETE_B), id: mine.id }),
      ),
    ).rejects.toThrow(StoreReferentialError);

    const still = await harness.read(async (store) =>
      store.getRecordingSession(ATHLETE_A, mine.id),
    );
    expect(still?.athleteId).toBe(ATHLETE_A);
  });

  it('does not let another athlete append to a recording', async () => {
    const mine = await seedRecording(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.appendRecordingChunk({
          sessionId: mine.id,
          athleteId: ATHLETE_B,
          seq: 0,
          fromIndex: 0,
          sampleCount: 1,
          channels: { power: [watts(999)] },
        }),
      ),
    ).rejects.toThrow(StoreReferentialError);

    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, mine.id),
    );
    expect(recovered?.sampleCount).toBe(0);
  });

  it('refuses a recording for an athlete who does not exist', async () => {
    await expect(
      harness.write(async (store) =>
        store.putRecordingSession(recordingFor('nobody' as typeof ATHLETE_A)),
      ),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('erasing an athlete takes their half-recorded ride with it', async () => {
    const mine = await seedRecording(harness, ATHLETE_A);
    const theirs = await seedRecording(harness, ATHLETE_B);
    await harness.write(async (store) => {
      for (const recording of [mine, theirs]) {
        await store.appendRecordingChunk({
          sessionId: recording.id,
          athleteId: recording.athleteId,
          seq: 0,
          fromIndex: 0,
          sampleCount: 1,
          channels: { power: [watts(120)] },
        });
      }
    });

    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.recordings).toBe(1);

    const rows = await readRaw(async (raw) => ({
      sessions: await raw.table<{ id: string }, string>(TABLE.recordingSessions).toArray(),
      chunks: await raw
        .table<PersistedRecordingChunk, [string, number]>(TABLE.recordingChunks)
        .toArray(),
    }));
    // Not one row of the erased athlete's recording is left on the device, and
    // the other athlete's is untouched.
    expect(rows.sessions.map((row) => row.id)).toEqual([theirs.id]);
    expect(rows.chunks.map((row) => row.sessionId)).toEqual([theirs.id]);
  });
});

describe('listing what can be recovered', () => {
  it('lists an athlete’s recordings, most recently checkpointed first', async () => {
    const older = await seedRecording(harness, ATHLETE_A, {
      updatedAt: unixSeconds(1_700_000_100),
    });
    const newer = await seedRecording(harness, ATHLETE_A, {
      updatedAt: unixSeconds(1_700_000_900),
    });
    await seedRecording(harness, ATHLETE_B);

    const listed = await harness.read(async (store) => store.listRecordingSessions(ATHLETE_A));
    expect(listed.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it('carries the pause list through a checkpoint, so a pause stays distinguishable from a dropout', async () => {
    const recording = await seedRecording(harness, ATHLETE_A, {
      state: 'paused',
      pauses: [
        { from: unixSeconds(1_700_000_600), to: unixSeconds(1_700_000_900), reason: 'manual' },
        { from: unixSeconds(1_700_001_200), reason: 'automatic' },
      ],
    });

    const read = await harness.read(async (store) =>
      store.getRecordingSession(ATHLETE_A, recording.id),
    );
    expect(read?.state).toBe('paused');
    expect(read?.pauses).toEqual([
      { from: unixSeconds(1_700_000_600), to: unixSeconds(1_700_000_900), reason: 'manual' },
      { from: unixSeconds(1_700_001_200), reason: 'automatic' },
    ]);
  });
});

describe('what the checkpoints cost', () => {
  // ⚠️ The 30 s below is a **contention allowance, not a performance bound**,
  // and the description it used to carry claimed otherwise. #143 measured this
  // file at 951 ms and confirmed it still passes with the timeout reverted to
  // Vitest's 5 s default — so a number 30× the observed runtime was tolerating
  // a real 6× regression in silence while reading like a budget.
  //
  // It is kept, and only as a stop on a hang. The case writes 2,880 chunk rows
  // through fake-indexeddb: under a second on a developer's machine, several
  // times that on a two-core shared runner alongside the twelve jsdom
  // environments #48 added, and the default went red on exactly that
  // contention with nothing about this code changed. A wall-clock assertion is
  // deliberately NOT added in its place — it would measure the runner rather
  // than the store, and would be the flakiest gate in the repository.
  //
  // What this case actually measures is the byte count, asserted exactly
  // below. That number moves when the encoding does, and it is the same on
  // every machine.
  it('measures a four-hour, 1 Hz, eight-channel recording and records the headroom', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const set = streamSetFor(ride, { gaps: [DROPPED_STRAP] });
    const recording = await seedRecording(harness, ATHLETE_A, { startedAt: set.startedAt });

    expect(set.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);

    await harness.write(async (store) => {
      for (const chunk of chunksOf(recording, set, FLUSH_INTERVAL_SAMPLES)) {
        await store.appendRecordingChunk(chunk);
      }
    });

    const footprint = await harness.read(async (store) =>
      store.getRecordingFootprint(ATHLETE_A, recording.id),
    );

    expect(footprint?.chunks).toBe(FOUR_HOUR_SAMPLE_COUNT / FLUSH_INTERVAL_SAMPLES);
    expect(footprint?.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);

    // The measurement, recorded as an **exact** assertion so it cannot rot into
    // a sentence in a pull request nobody re-runs: an encoding change moves this
    // number and the test says so. Chrome's quota is 60% of free disk and
    // Firefox's is 10%; the conservative floor this plans against is the 1 GiB
    // an origin can rely on, which leaves headroom for roughly four thousand
    // four-hour rides of checkpoints — and a checkpoint is transient, deleted
    // when its ride is finalised.
    // 17 bytes per sample (2 + 1 + 1 + 2 + 4 + 4 + 2 + 1 across the eight
    // channels), plus one presence-bitmap byte for each of the six five-sample
    // chunks the thirty-second dropout spans.
    expect(footprint?.encodedBytes).toBe(17 * FOUR_HOUR_SAMPLE_COUNT + 6);
    // 239.07 KiB — under a quarter of a mebibyte for a four-hour ride.
    expect((footprint?.encodedBytes ?? 0) / 1024).toBeCloseTo(239.07, 2);
  }, 30_000);

  it('counts nothing for a recording with no chunks yet', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    const footprint = await harness.read(async (store) =>
      store.getRecordingFootprint(ATHLETE_A, recording.id),
    );
    expect(footprint).toEqual({
      sessionId: recording.id,
      athleteId: ATHLETE_A,
      chunks: 0,
      sampleCount: 0,
      encodedBytes: 0,
    });
  });
});

describe('what the store refuses to write', () => {
  it('refuses a chunk whose channel length disagrees with its sample count', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) =>
        store.appendRecordingChunk({
          sessionId: recording.id,
          athleteId: ATHLETE_A,
          seq: 0,
          fromIndex: 0,
          sampleCount: 5,
          channels: { power: [watts(1), watts(2)] },
        }),
      ),
    ).rejects.toThrow(StoreValidationError);
  });

  it('refuses a chunk with a negative or fractional position', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    for (const broken of [
      { seq: -1, fromIndex: 0, sampleCount: 0 },
      { seq: 0, fromIndex: 1.5, sampleCount: 0 },
      { seq: 0, fromIndex: 0, sampleCount: -2 },
    ]) {
      await expect(
        harness.write(async (store) =>
          store.appendRecordingChunk({
            sessionId: recording.id,
            athleteId: ATHLETE_A,
            channels: {},
            ...broken,
          }),
        ),
      ).rejects.toThrow(StoreValidationError);
    }
  });

  it('refuses a recording whose sample interval is not positive', async () => {
    await expect(
      harness.write(async (store) =>
        store.putRecordingSession(recordingFor(ATHLETE_A, { sampleInterval: seconds(0) })),
      ),
    ).rejects.toThrow(StoreValidationError);
  });

  it('refuses a chunk for a recording that does not exist', async () => {
    await expect(
      harness.write(async (store) =>
        store.appendRecordingChunk({
          sessionId: recordingSessionId('never-started'),
          athleteId: ATHLETE_A,
          seq: 0,
          fromIndex: 0,
          sampleCount: 1,
          channels: { power: [watts(1)] },
        }),
      ),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('replaces rather than duplicates when a flush is retried', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    const chunk = {
      sessionId: recording.id,
      athleteId: ATHLETE_A,
      seq: 0,
      fromIndex: 0,
      sampleCount: 1,
      channels: { power: [watts(150)] },
    };
    await harness.write(async (store) => {
      await store.appendRecordingChunk(chunk);
      // The recorder did not learn whether the first call landed, so it retries.
      await store.appendRecordingChunk(chunk);
    });

    const footprint = await harness.read(async (store) =>
      store.getRecordingFootprint(ATHLETE_A, recording.id),
    );
    expect(footprint?.chunks).toBe(1);
    expect(footprint?.sampleCount).toBe(1);
  });
});

describe('the recovery assertion can fail', () => {
  it('reports a recording that was checkpointed and cannot be read back', async () => {
    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recordingSessionId('absent'), {
        sampleCount: 1,
        channels: {},
      }),
    ).rejects.toThrow(RoundTripFailure);
  });

  it('reports a recording that came back shorter than expected', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
        sampleCount: 10,
        channels: {},
      }),
    ).rejects.toThrow(RoundTripFailure);
  });

  it('reports a channel that was recorded and did not come back', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 1,
        channels: { power: [watts(1)] },
      }),
    );
    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
        sampleCount: 1,
        channels: { power: [watts(1)], heartRate: [undefined] },
      }),
    ).rejects.toThrow(RoundTripFailure);
  });

  it('reports a channel that came back when nothing was recorded for it', async () => {
    const recording = await seedRecording(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 1,
        channels: { power: [watts(1)] },
      }),
    );
    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
        sampleCount: 1,
        channels: {},
      }),
    ).rejects.toThrow(RoundTripFailure);
  });
});
