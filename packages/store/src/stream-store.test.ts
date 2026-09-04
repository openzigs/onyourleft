// SPDX-License-Identifier: Apache-2.0

/**
 * #27's acceptance criteria, against the real engine and through the public
 * retrieval path.
 *
 * Every persistence assertion here goes through the harness from
 * `@onyourleft/store/testing` (#28), which closes every connection between the
 * write and the read. That is not decoration: reading through the handle that
 * wrote cannot distinguish "persisted" from "still in this connection's
 * transaction queue", and it is the fourth and most insidious of CLAUDE.md
 * section 5's four causes.
 */

import { beatsPerMinute, seconds, unixSeconds, watts } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { activityId } from './ids';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import { channelBytesPerSample } from './stream-codec';
import { compressStreamBytes } from './stream-compression';
import type { PersistedStreamBlob, PersistedStreamSet } from './stream-persisted';
import { MAX_INFLATED_SAMPLES } from './stream-compression';
import { hasPositionChannels, STREAM_CHANNELS, type NewStreamSet } from './streams';
import {
  assertStreamSetRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  CHANNELS_WITHOUT_POSITION,
  createStoreHarness,
  DROPPED_STRAP,
  FOUR_HOUR_SAMPLE_COUNT,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  streamSetFor,
  type StoreHarness,
} from './testing';

/**
 * The retrieval budget, **stated before anything was measured**.
 *
 * It comes from the product, not from a benchmark: #11 and #62 draw a chart
 * when an athlete opens a ride, the perceptual ceiling for "no spinner" is
 * about one second from tap to painted chart, and retrieval may have at most
 * half of that because decoding, layout and paint have the other half. So the
 * budget for a four-hour, eight-channel set is **500 ms**.
 *
 * The number asserted below is larger, and the gap is honesty rather than
 * slack: this suite runs against `fake-indexeddb` in Node, where the store is
 * memory and no disk is touched, on a shared CI runner whose scheduling this
 * repository does not control. A tight assertion there measures the runner. The
 * assertion is a **regression ceiling** — an encoding change that made
 * retrieval an order of magnitude slower would trip it — and the number that
 * answers the criterion is the measured one, recorded in ADR 0011 beside the
 * statement that it is not a device measurement. A real-device figure needs a
 * real device and belongs to #62.
 */
const RETRIEVAL_BUDGET_MILLISECONDS = 500;
const RETRIEVAL_CEILING_MILLISECONDS = 5_000;

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

describe('the four-hour round trip — #27’s first criterion', () => {
  it('writes 14,400 samples across eight channels, discards every connection, and reads back every sample unchanged', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const set = streamSetFor(ride);

    expect(set.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);
    expect(Object.keys(set.channels)).toHaveLength(8);

    // Throws on the first disagreeing sample, and on a set that came back at
    // all. Nothing here can be satisfied by the writing connection: `read`
    // closed it before it opened another.
    const read = await assertStreamSetRoundTrip(harness, set);

    expect(read.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);
    expect(harness.connectionsOpened).toBeGreaterThanOrEqual(2);
  });

  it('measures retrieval of the four-hour set against the stated budget', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) => store.putStreamSet(streamSetFor(ride)));

    // A fresh connection, so this measures a cold read and not a cache.
    await harness.discard();
    const started = performance.now();
    const read = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));
    const elapsed = performance.now() - started;

    expect(read?.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);
    expect(elapsed).toBeLessThan(RETRIEVAL_CEILING_MILLISECONDS);
    // Printed rather than only asserted: the number ADR 0011 records is this
    // one, and a figure nobody can see in the log is a figure nobody can check.
    report(
      `[#27] four-hour eight-channel retrieval: ${elapsed.toFixed(1)} ms ` +
        `(product budget ${String(RETRIEVAL_BUDGET_MILLISECONDS)} ms on a device; ` +
        `CI regression ceiling ${String(RETRIEVAL_CEILING_MILLISECONDS)} ms)`,
    );
  });

  it('measures what four recorded hours cost on the device', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) => store.putStreamSet(streamSetFor(ride)));

    const summary = await harness.read(async (store) =>
      store.getStreamSetSummary(ATHLETE_A, ride.id),
    );
    const stored = await readRaw(async (raw) =>
      raw
        .table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs)
        .where('activityId')
        .equals(ride.id)
        .toArray(),
    );

    const actual = stored.reduce(
      (total, row) => total + row.values.byteLength + (row.present?.byteLength ?? 0),
      0,
    );
    // The recorded figure must be the real one. A summary that reports a number
    // nobody checked against the bytes is an estimate wearing a measurement's
    // clothes, which is exactly what #27 asks not to be given.
    expect(summary?.encodedBytes).toBe(actual);

    // The packed size before compression, from the codec's own widths, so the
    // ratio ADR 0011 records is measured at both ends rather than asserted at
    // one and estimated at the other.
    const packed =
      STREAM_CHANNELS.reduce((total, channel) => total + channelBytesPerSample(channel), 0) *
      FOUR_HOUR_SAMPLE_COUNT;
    const perHour = actual / 4;
    report(
      `[#27] four-hour eight-channel stream set: ${String(packed)} B packed, ` +
        `${String(actual)} B stored (${(actual / 1024).toFixed(1)} KiB), ` +
        `${(packed / actual).toFixed(2)}x from deflate-raw; ` +
        `${(perHour / 1024).toFixed(1)} KiB per recorded hour`,
    );
    expect(actual).toBeLessThan(packed);
    // A ceiling two orders above the packed-and-compressed shape, so this test
    // fails if someone reintroduces JSON or drops the packing, and does not
    // fail on a compressor that changes its ratio by a few per cent.
    expect(perHour).toBeLessThan(200 * 1024);
  });
});

describe('gaps round trip intact and are not zeros — #27’s second criterion', () => {
  it('a heart-rate strap that dropped for thirty seconds comes back absent, beside real zeros', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, {
      sampleCount: 3_600,
      channels: ['heartRate', 'power'],
      gaps: [DROPPED_STRAP],
    });

    const read = await assertStreamSetRoundTrip(harness, set);

    const heartRate = read.channels.heartRate;
    expect(heartRate).toBeDefined();
    expect(heartRate?.slice(600, 630).every((sample) => sample === undefined)).toBe(true);
    expect(heartRate?.[599]).toBeGreaterThan(0);
    expect(heartRate?.[630]).toBeGreaterThan(0);
  });

  it('distinguishes a gap from a stored zero in the same channel', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    // Hand-built rather than generated: zero and absent must sit next to each
    // other, which is the pair the criterion is about.
    const set: NewStreamSet = {
      activityId: ride.id,
      athleteId: ATHLETE_A,
      startedAt: unixSeconds(1_700_000_000),
      sampleInterval: seconds(1),
      sampleCount: 4,
      channels: {
        heartRate: [beatsPerMinute(0), undefined, beatsPerMinute(0), beatsPerMinute(58)],
        power: [watts(0), watts(0), undefined, watts(210)],
      },
    };

    const read = await assertStreamSetRoundTrip(harness, set);

    expect(read.channels.heartRate?.[0]).toBe(0);
    expect(read.channels.heartRate?.[1]).toBeUndefined();
    expect(read.channels.power?.[1]).toBe(0);
    expect(read.channels.power?.[2]).toBeUndefined();
  });

  it('never interpolates: a channel that is entirely absent comes back entirely absent', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, {
      sampleCount: 100,
      channels: ['heartRate'],
      gaps: [{ channel: 'heartRate', from: 0, count: 100 }],
    });

    const read = await assertStreamSetRoundTrip(harness, set);

    expect(read.channels.heartRate).toHaveLength(100);
    expect(read.channels.heartRate?.every((sample) => sample === undefined)).toBe(true);
  });
});

describe('a stream with no position channel — #27’s third criterion, and half the product', () => {
  it('an indoor trainer ride round trips with six channels and no track', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: false });
    const set = streamSetFor(ride, { channels: CHANNELS_WITHOUT_POSITION });

    const read = await assertStreamSetRoundTrip(harness, set);

    expect(read.channels.latitude).toBeUndefined();
    expect(read.channels.longitude).toBeUndefined();
    expect(read.channels.power).toHaveLength(FOUR_HOUR_SAMPLE_COUNT);
    expect(read.sampleCount).toBe(FOUR_HOUR_SAMPLE_COUNT);
  });

  it('the summary says there is no track without decoding a sample', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { channels: CHANNELS_WITHOUT_POSITION })),
    );

    const summary = await harness.read(async (store) =>
      store.getStreamSetSummary(ATHLETE_A, ride.id),
    );

    expect(summary).toBeDefined();
    expect(hasPositionChannels(summary!)).toBe(false);
    expect(summary?.channels).not.toContain('latitude');
  });

  it('a ride with a track reports one', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) => store.putStreamSet(streamSetFor(ride)));

    const summary = await harness.read(async (store) =>
      store.getStreamSetSummary(ATHLETE_A, ride.id),
    );

    expect(hasPositionChannels(summary!)).toBe(true);
  });
});

describe('a failed write leaves nothing behind — #27’s last criterion', () => {
  it('a storage failure part way through the channels leaves neither the metadata row nor any blob', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const set = streamSetFor(ride, { sampleCount: 600 });

    // The injection: the real engine's own `put`, made to fail on the third
    // blob. By then the metadata row has already been written inside the same
    // transaction, which is precisely "a partial object referenced by a
    // committed database row" — unless the transaction aborts.
    // Captured **unbound** deliberately: the replacement re-applies it with the
    // receiver it intercepted, which is what lets every other object store's
    // writes through untouched.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPut = IDBObjectStore.prototype.put;
    let blobPuts = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ): IDBRequest<IDBValidKey> {
      if (this.name === TABLE.streamBlobs) {
        blobPuts += 1;
        if (blobPuts === 3) {
          throw new Error('the device ran out of space part way through the write');
        }
      }
      return originalPut.apply(this, args);
    });

    await expect(harness.write(async (store) => store.putStreamSet(set))).rejects.toThrow();
    expect(blobPuts).toBeGreaterThanOrEqual(3);

    vi.restoreAllMocks();

    // Read through the public path on a connection that was not there when it
    // happened, and then again at the rows themselves — because "getStreamSet
    // returns undefined" would also be true of a summary row that survived
    // while its blobs did not.
    const read = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));
    expect(read).toBeUndefined();

    const rows = await readRaw(async (raw) => ({
      sets: await raw.table<PersistedStreamSet, string>(TABLE.streamSets).toArray(),
      blobs: await raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs).toArray(),
    }));
    expect(rows.sets).toEqual([]);
    expect(rows.blobs).toEqual([]);
  });

  it('a sample the encoding cannot represent is refused before anything is written', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, { sampleCount: 10, channels: ['power'] });
    // A power sample the uint16 cannot carry. It has to be put in by hand,
    // because `watts()` accepts it and only the encoding does not.
    const samples: (number | undefined)[] = [...(set.channels.power ?? [])];
    samples[5] = 70_000;
    const broken = { ...set, channels: { power: samples } } as NewStreamSet;

    await expect(harness.write(async (store) => store.putStreamSet(broken))).rejects.toThrow(
      StoreValidationError,
    );

    const rows = await readRaw(async (raw) =>
      raw.table<PersistedStreamSet, string>(TABLE.streamSets).toArray(),
    );
    expect(rows).toEqual([]);
  });

  it('refuses a channel whose length disagrees with the declared sample count', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, { sampleCount: 10, channels: ['power'] });

    await expect(
      harness.write(async (store) => store.putStreamSet({ ...set, sampleCount: 11 })),
    ).rejects.toThrow(StoreValidationError);
  });
});

describe('cross-athlete exposure — the write path as well as the read path', () => {
  it('refuses to file streams against an activity this athlete does not own', async () => {
    const theirs = await seedRide(harness, ATHLETE_B);
    const set = streamSetFor(theirs, { sampleCount: 10, channels: ['power'] });

    await expect(
      harness.write(async (store) => store.putStreamSet({ ...set, athleteId: ATHLETE_A })),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses to overwrite a stream set that belongs to another athlete, and leaves it intact', async () => {
    // A row planted directly, because the public path cannot produce this state
    // — which is the point: it becomes reachable the moment an activity id
    // arrives from an imported file (#51). The same hole was found on the
    // activity write path in review of PR #109.
    const mine = await seedRide(harness, ATHLETE_A);
    await harness.discard();
    const raw = rawHandle();
    await raw.table<PersistedStreamSet, string>(TABLE.streamSets).put({
      activityId: mine.id,
      athleteId: ATHLETE_B,
      startedAt: 1_700_000_000,
      sampleIntervalSeconds: 1,
      sampleCount: 3,
      channels: ['power'],
      encodedBytes: 42,
    });
    raw.close();

    const set = streamSetFor(mine, { sampleCount: 10, channels: ['power'] });
    await expect(harness.write(async (store) => store.putStreamSet(set))).rejects.toThrow(
      StoreReferentialError,
    );

    const survivor = await readRaw(async (handle) =>
      handle.table<PersistedStreamSet, string>(TABLE.streamSets).get(mine.id),
    );
    expect(survivor?.athleteId).toBe(ATHLETE_B);
    expect(survivor?.encodedBytes).toBe(42);
  });

  it('does not return another athlete’s stream set from an activity id alone', async () => {
    const theirs = await seedRide(harness, ATHLETE_B);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(theirs, { sampleCount: 10, channels: ['power'] })),
    );

    await harness.read(async (store) => {
      expect(await store.getStreamSet(ATHLETE_A, theirs.id)).toBeUndefined();
      expect(await store.getStreamSetSummary(ATHLETE_A, theirs.id)).toBeUndefined();
      expect(await store.getStreamChannel(ATHLETE_A, theirs.id, 'power')).toBeUndefined();
      expect(await store.deleteStreamSet(ATHLETE_A, theirs.id)).toBe(false);
    });

    // And it is still there for its owner.
    const stillTheirs = await harness.read(async (store) =>
      store.getStreamSet(ATHLETE_B, theirs.id),
    );
    expect(stillTheirs).toBeDefined();
  });
});

describe('reading one channel', () => {
  it('returns just that channel’s samples', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const set = streamSetFor(ride, { sampleCount: 500 });
    await harness.write(async (store) => store.putStreamSet(set));

    const power = await harness.read(async (store) =>
      store.getStreamChannel(ATHLETE_A, ride.id, 'power'),
    );

    expect(power).toEqual(set.channels.power);
  });

  it('returns nothing for a channel the ride does not have', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 10, channels: ['power'] })),
    );

    const heartRate = await harness.read(async (store) =>
      store.getStreamChannel(ATHLETE_A, ride.id, 'heartRate'),
    );

    expect(heartRate).toBeUndefined();
  });
});

describe('replacing and deleting', () => {
  it('replacing a set with fewer channels leaves no stale channel behind', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 60 })),
    );

    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 60, channels: ['power'] })),
    );

    const read = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));
    expect(Object.keys(read?.channels ?? {})).toEqual(['power']);
    // The stale rows are gone from disk, not merely filtered out of the answer.
    const blobs = await readRaw(async (raw) =>
      raw
        .table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs)
        .where('activityId')
        .equals(ride.id)
        .toArray(),
    );
    expect(blobs.map((row) => row.channel)).toEqual(['power']);
  });

  it('deleting the activity deletes its streams', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 60, channels: ['power'] })),
    );

    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));

    const rows = await readRaw(async (raw) => ({
      sets: await raw.table<PersistedStreamSet, string>(TABLE.streamSets).toArray(),
      blobs: await raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs).toArray(),
    }));
    expect(rows.sets).toEqual([]);
    expect(rows.blobs).toEqual([]);
  });

  it('deleting the athlete deletes their streams and reports how many sets went', async () => {
    const mine = await seedRide(harness, ATHLETE_A);
    const alsoMine = await seedRide(harness, ATHLETE_A);
    const theirs = await seedRide(harness, ATHLETE_B);
    await harness.write(async (store) => {
      await store.putStreamSet(streamSetFor(mine, { sampleCount: 30, channels: ['power'] }));
      await store.putStreamSet(streamSetFor(alsoMine, { sampleCount: 30, channels: ['power'] }));
      await store.putStreamSet(streamSetFor(theirs, { sampleCount: 30, channels: ['power'] }));
    });

    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.streamSets).toBe(2);

    const rows = await readRaw(async (raw) => ({
      sets: await raw.table<PersistedStreamSet, string>(TABLE.streamSets).toArray(),
      blobs: await raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs).toArray(),
    }));
    // The other athlete's ride is untouched — a cascade that took it would be
    // worse than one that left an orphan.
    expect(rows.sets.map((row) => row.activityId)).toEqual([theirs.id]);
    expect(rows.blobs.map((row) => row.activityId)).toEqual([theirs.id]);
  });

  it('deleting a set that is not there is a no-op rather than an error', async () => {
    const missing = await harness.read(async (store) =>
      store.deleteStreamSet(ATHLETE_A, activityId('never-existed')),
    );
    expect(missing).toBe(false);
  });

  it('deleting a set removes its blobs and leaves the activity', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30, channels: ['power'] })),
    );

    expect(await harness.write(async (store) => store.deleteStreamSet(ATHLETE_A, ride.id))).toBe(
      true,
    );

    await harness.read(async (store) => {
      expect(await store.getStreamSet(ATHLETE_A, ride.id)).toBeUndefined();
      expect(await store.getActivity(ATHLETE_A, ride.id)).toBeDefined();
    });
  });
});

describe('half-written data is refused loudly', () => {
  it('a summary claiming a channel whose bytes are gone fails rather than drawing a shorter chart', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30, channels: ['power', 'heartRate'] })),
    );

    await harness.discard();
    const raw = rawHandle();
    await raw
      .table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs)
      .delete([ride.id, 'heartRate']);
    raw.close();

    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(StoreDecodeError);
  });

  it('a compression framing this build does not write is refused', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30, channels: ['power'] })),
    );

    await harness.discard();
    const raw = rawHandle();
    const blobs = raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
    const row = await blobs.get([ride.id, 'power']);
    await blobs.put({ ...row!, compression: 'brotli' });
    raw.close();

    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(/brotli/);
  });

  it('refuses stored bytes that inflate past the size their row declares', async () => {
    // A deflate stream expands by up to about a thousand to one, so a few
    // kilobytes on disk can inflate to gigabytes. `CLAUDE.md` section 6 puts
    // resource exhaustion from malformed stored data in scope; today a row is
    // only as trustworthy as the devtools pane, and #51's import and #7's sync
    // will make one genuinely foreign.
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 4, channels: ['power'] })),
    );

    // A megabyte of zeros compresses to a couple of kilobytes. The row still
    // says four samples — eight bytes.
    const bomb = await compressStreamBytes(new Uint8Array(1_000_000));
    expect(bomb.byteLength).toBeLessThan(8_000);

    await harness.discard();
    const raw = rawHandle();
    const blobs = raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
    const row = await blobs.get([ride.id, 'power']);
    await blobs.put({ ...row!, values: bomb });
    raw.close();

    // The message names the guard, not the byte-length check that would also
    // have caught it — after allocating the megabyte, which is the point.
    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(/expand to more than the 8 bytes this row declares/);
  });

  it('a summary row whose channel list is not a list is refused', async () => {
    const ride = await plantCorruptSummary({ channels: 'power' as unknown as string[] });
    await expect(
      harness.read(async (store) => store.getStreamSetSummary(ATHLETE_A, ride)),
    ).rejects.toThrow(/streamSet.channels: expected an array/);
  });

  it('a summary row naming a channel this build does not have is refused', async () => {
    const ride = await plantCorruptSummary({ channels: ['powerr'] });
    await expect(
      harness.read(async (store) => store.getStreamSetSummary(ATHLETE_A, ride)),
    ).rejects.toThrow(/stream channel must be one of/);
  });

  // Review of PR #124 reproduced a decompression bomb: the inflation guard was
  // bounded by `row.sampleCount`, the same untrusted row whose bytes it was
  // defending against, so the attacker set the limit. A 24,464-byte row
  // declaring 12,582,912 samples inflated to +170 MiB of resident memory.
  //
  // MAX_INFLATED_SAMPLES is the ceiling the guard was missing, and it is checked
  // BEFORE any byte is decompressed. This test plants a declaration above it and
  // asserts the read is refused rather than attempted — if it ever passes by
  // inflating first and failing after, the memory is already gone.
  it('a row declaring more samples than this build will inflate is refused', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) => store.putStreamSet(streamSetFor(ride)));
    await harness.discard();

    // Take a real, valid blob row and change only the one field the guard used
    // to trust: its own declared sample count. Everything else stays exactly as
    // the writer produced it, so nothing but the ceiling can be what refuses it.
    const raw = rawHandle();
    const blobs = raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
    const existing = await blobs.where('activityId').equals(ride.id).first();
    if (existing === undefined) {
      throw new Error('fixture produced no stream blob to corrupt');
    }
    await blobs.put({ ...existing, sampleCount: MAX_INFLATED_SAMPLES + 1 });
    raw.close();

    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(/this build will inflate/);
  });

  it('a summary row with a fractional sample count is refused', async () => {
    const ride = await plantCorruptSummary({ sampleCount: 2.5 });
    await expect(
      harness.read(async (store) => store.getStreamSetSummary(ATHLETE_A, ride)),
    ).rejects.toThrow(/expected a non-negative integer/);
  });

  it('bytes that are not a valid deflate stream are refused', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30, channels: ['power'] })),
    );

    await harness.discard();
    const raw = rawHandle();
    const blobs = raw.table<PersistedStreamBlob, [string, string]>(TABLE.streamBlobs);
    const row = await blobs.get([ride.id, 'power']);
    await blobs.put({ ...row!, values: new Uint8Array([1, 2, 3, 4, 5]) });
    raw.close();

    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(StoreDecodeError);
  });
});

describe('the shapes a store with no streams still has to answer', () => {
  it('a ride with no streams reads as undefined rather than as an empty set', async () => {
    const ride = await seedRide(harness, ATHLETE_A);

    await harness.read(async (store) => {
      expect(await store.getStreamSet(ATHLETE_A, ride.id)).toBeUndefined();
      expect(await store.getStreamSetSummary(ATHLETE_A, ride.id)).toBeUndefined();
    });
  });

  it('stores a set with no channels at all', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const empty: NewStreamSet = {
      activityId: ride.id,
      athleteId: ATHLETE_A,
      startedAt: ride.startedAt,
      sampleInterval: seconds(1),
      sampleCount: 0,
      channels: {},
    };

    const read = await assertStreamSetRoundTrip(harness, empty);

    expect(read.channels).toEqual({});
    expect(read.sampleCount).toBe(0);
  });

  it('refuses a fractional or negative sample count', async () => {
    // The channel-length check catches this whenever there is a channel, so the
    // case that needs its own guard is the one with none: a set of no channels
    // and a fractional count would otherwise land a summary row that only fails
    // when someone tries to read it back.
    const ride = await seedRide(harness, ATHLETE_A);
    const empty: NewStreamSet = {
      activityId: ride.id,
      athleteId: ATHLETE_A,
      startedAt: ride.startedAt,
      sampleInterval: seconds(1),
      sampleCount: 0,
      channels: {},
    };

    await harness.write(async (store) => {
      await expect(store.putStreamSet({ ...empty, sampleCount: 2.5 })).rejects.toThrow(
        StoreValidationError,
      );
      await expect(store.putStreamSet({ ...empty, sampleCount: -1 })).rejects.toThrow(
        /non-negative integer/,
      );
    });

    const rows = await readRaw(async (raw) =>
      raw.table<PersistedStreamSet, string>(TABLE.streamSets).toArray(),
    );
    expect(rows).toEqual([]);
  });

  it('refuses a sample interval of zero', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, { sampleCount: 10, channels: ['power'] });

    await expect(
      harness.write(async (store) => store.putStreamSet({ ...set, sampleInterval: seconds(0) })),
    ).rejects.toThrow(StoreValidationError);
  });

  it('stores every one of the eight channels the issue names', async () => {
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 20 })),
    );

    const summary = await harness.read(async (store) =>
      store.getStreamSetSummary(ATHLETE_A, ride.id),
    );

    expect(summary?.channels).toEqual(STREAM_CHANNELS);
  });
});

/**
 * Writes a measured figure into the test log.
 *
 * A wrapper rather than a bare `console.log`, so the two measurements #27 asks
 * for are greppable as `[#27]` and so there is one place to send them if this
 * ever needs a reporter.
 */
/**
 * Plants a `streamSets` row that the public write path could not produce.
 *
 * Rows off disk are untrusted for `persisted.ts`'s reason: an earlier build
 * wrote them, or a devtools pane edited them, or they are partly corrupt. The
 * only way to exercise that is to write one directly.
 */
async function plantCorruptSummary(
  overrides: Partial<PersistedStreamSet>,
): Promise<ReturnType<typeof activityId>> {
  const ride = await seedRide(harness, ATHLETE_A);
  await harness.discard();
  const raw = rawHandle();
  await raw.table<PersistedStreamSet, string>(TABLE.streamSets).put({
    activityId: ride.id,
    athleteId: ATHLETE_A,
    startedAt: 1_700_000_000,
    sampleIntervalSeconds: 1,
    sampleCount: 3,
    channels: ['power'],
    encodedBytes: 10,
    ...overrides,
  });
  raw.close();
  return ride.id;
}

function report(line: string): void {
  // `console`, not `process.stdout`: this package's tsconfig sets `types: []`,
  // so `process` is not a name it has — deliberately, and the typechecker says
  // so before the test runs.
  console.log(line);
}
