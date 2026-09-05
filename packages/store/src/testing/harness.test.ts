// SPDX-License-Identifier: Apache-2.0

/**
 * The harness proving itself — #28's decisive criterion.
 *
 * > *"The harness is proved to work by deliberately breaking persistence and
 * > observing the test go red: a fake repository that stores to memory instead
 * > of the database must fail a round-trip test. A harness that passes against
 * > a no-op write is worthless, and this is the only way to know it does not."*
 *
 * The mechanism here is that **the same assertion body runs three times**:
 * green against the real IndexedDB store, and red against each of the two
 * fakes in `fakes.ts`. Not a similar assertion — the same function,
 * `assertStreamSetRoundTrip`, with only the factory swapped. A demonstration
 * that lives in a pull-request description is a screenshot; this one fails the
 * build the day the harness stops catching anything.
 *
 * Several fakes rather than one, because a harness that catches a single
 * failure shape is calibrated to that shape:
 *
 * 1. **`memoryWriteStoreFactory`** — the write goes to memory. The literal fake
 *    the criterion names.
 * 2. **`misroutedBlobStoreFactory`** — the write goes to the **real** database,
 *    in a **real** transaction that **really commits**, under a key prefix the
 *    read path does not use. Every layer reports success. This is CLAUDE.md
 *    section 5's *wrong storage* in the form that survives a naive test, and it
 *    is the one worth having.
 * 3. **`gapFillingStoreFactory`** — the set comes back whole and a dropped
 *    strap has become thirty seconds at 0 bpm.
 * 4. **`droppedFlushStoreFactory`** — #46's checkpoint write, acknowledged at
 *    the edge and never reaching the database. It arrived with that write path,
 *    which is the rule: a new write path may not ship without a fake proving
 *    the harness catches its failure.
 */

import { beatsPerMinute, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activityId } from '../ids';
import type { NewStreamSet, StreamChannels, StreamSet } from '../streams';

import {
  droppedFlushStoreFactory,
  gapFillingStoreFactory,
  memoryWriteStoreFactory,
  misroutedBlobStoreFactory,
} from './fakes';
import { createStoreHarness, type StoreHarness } from './harness';
import {
  assertRecordingRecovers,
  assertSameSamples,
  assertSameStreamSet,
  assertStreamSetRoundTrip,
  RoundTripFailure,
} from './round-trip';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  ATHLETES,
  DROPPED_STRAP,
  resetFixtureIds,
  rideFor,
  seedAthletes,
  seedRecording,
  seedRide,
  streamSetFor,
} from './fixtures';
import type { StoreFactory } from './store';

const harnesses: StoreHarness[] = [];

/**
 * A one-sample stream set carrying exactly the channels given.
 *
 * The samples are bare numbers rather than domain quantities because these
 * cases are about the *comparison*, not about the encoding — and the brands
 * erase, so the comparison sees the same values either way.
 */
function setWith(channels: StreamChannels): NewStreamSet {
  return {
    activityId: activityId('ride'),
    athleteId: ATHLETE_A,
    startedAt: unixSeconds(1_700_000_000),
    sampleInterval: seconds(1),
    sampleCount: 1,
    channels,
  };
}

/** The same shape, as something that came back out of the store. */
function readWith(channels: StreamChannels): StreamSet {
  return setWith(channels);
}

function harnessWith(factory?: StoreFactory): StoreHarness {
  const harness = createStoreHarness(factory === undefined ? {} : { factory });
  harnesses.push(harness);
  return harness;
}

beforeEach(() => {
  resetFixtureIds();
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.destroy();
  }
});

/**
 * The one scenario every case below runs, so that "green" and "red" differ only
 * in which repository is behind the harness.
 */
async function runTheRoundTrip(harness: StoreHarness): Promise<void> {
  await seedAthletes(harness);
  const ride = await seedRide(harness, ATHLETE_A);
  await assertStreamSetRoundTrip(
    harness,
    streamSetFor(ride, { sampleCount: 300, channels: ['power', 'heartRate'] }),
  );
}

describe('the primitive: the read cannot be served by the connection that wrote', () => {
  it('opens a second connection for the read', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const opened = harness.connectionsOpened;

    await harness.read(async (store) => store.getAthlete(ATHLETE_A));

    expect(harness.connectionsOpened).toBe(opened + 1);
  });

  it('hands the read a different object from the one the write used', async () => {
    const harness = harnessWith();
    const writer = await harness.write((store) => Promise.resolve(store));
    const reader = await harness.read((store) => Promise.resolve(store));

    expect(reader).not.toBe(writer);
  });

  it('roundTrip closes the writing connection between the two halves', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const ride = rideFor(ATHLETE_A);
    const opened = harness.connectionsOpened;

    const read = await harness.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(ATHLETE_A, ride.id),
    );

    expect(read?.id).toBe(ride.id);
    expect(harness.connectionsOpened).toBe(opened + 1);
  });
});

describe('against the real store, the round trip passes', () => {
  it('the same assertion body the two fakes fail', async () => {
    await expect(runTheRoundTrip(harnessWith())).resolves.toBeUndefined();
  });
});

describe('deliberately breaking persistence — the criterion that makes #28 worth having', () => {
  it('a repository that stores to memory instead of the database fails the round trip', async () => {
    const harness = harnessWith(memoryWriteStoreFactory());

    // The write reports success. Nothing throws until a fresh connection asks
    // the database for it, which is the whole point.
    await expect(runTheRoundTrip(harness)).rejects.toThrow(RoundTripFailure);
    await expect(runTheRoundTrip(harnessWith(memoryWriteStoreFactory()))).rejects.toThrow(
      /reported success, and a fresh connection cannot see it/,
    );
  });

  it('the memory fake really does report the write as successful', async () => {
    // Otherwise the case above would be satisfied by a fake that simply throws,
    // which proves nothing about the read path.
    const harness = harnessWith(memoryWriteStoreFactory());
    const ride = rideFor(ATHLETE_A);
    const set: NewStreamSet = {
      activityId: ride.id,
      athleteId: ATHLETE_A,
      startedAt: unixSeconds(1_700_000_000),
      sampleInterval: seconds(1),
      sampleCount: 2,
      channels: { power: [watts(1), watts(2)] },
    };

    const written = await harness.write(async (store) => store.putStreamSet(set));

    expect(written).toBe(ride.id);
  });

  it('a write that commits to the real database under a key the reader does not use fails the round trip', async () => {
    const harness = harnessWith(misroutedBlobStoreFactory());

    // Named, not merely "throws": a fake that failed on the write would also
    // satisfy a bare `rejects`, and would prove nothing about the read.
    await expect(runTheRoundTrip(harness)).rejects.toThrow(/no bytes for it were found/);
  });

  it('a repository that fills every gap with a zero fails the round trip', async () => {
    // The shape a round trip that only asks "did anything come back" misses
    // entirely: a complete set of the right length, in which a dropped strap
    // has become thirty seconds at 0 bpm. This case exists because a mutation
    // run proved the comparison could be deleted with nothing going red.
    const harness = harnessWith(gapFillingStoreFactory());
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const set = streamSetFor(ride, {
      sampleCount: 900,
      channels: ['heartRate'],
      gaps: [DROPPED_STRAP],
    });

    await expect(assertStreamSetRoundTrip(harness, set)).rejects.toThrow(
      /channel heartRate, sample 600: wrote a gap and read back 0/,
    );
  });

  it('the gap-filling fake really does persist a complete set', async () => {
    // Otherwise the case above would be the memory fake again: the point is
    // that the write commits and the read succeeds, and only the comparison
    // catches it.
    const harness = harnessWith(gapFillingStoreFactory());
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(
        streamSetFor(ride, { sampleCount: 900, channels: ['heartRate'], gaps: [DROPPED_STRAP] }),
      ),
    );

    const read = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id));

    expect(read?.channels.heartRate).toHaveLength(900);
    expect(read?.channels.heartRate?.[600]).toBe(0);
  });

  it('a repository whose flush is acknowledged and never written fails the recovery round trip', async () => {
    // #46's shape, and the one that belongs to the new write path: every
    // `appendRecordingChunk` resolves with the sequence number the caller
    // expects, and every second row is simply not there. A recovery that
    // concatenated the survivors would return a series of almost the right
    // length with every sample after the first hole on the wrong second.
    const harness = harnessWith(droppedFlushStoreFactory());
    await seedAthletes(harness);
    const recording = await seedRecording(harness, ATHLETE_A);
    const chunks = [0, 1, 2, 3].map((seq) => ({
      sessionId: recording.id,
      athleteId: ATHLETE_A,
      seq,
      fromIndex: seq * 2,
      sampleCount: 2,
      channels: { power: [watts(100 + seq), watts(200 + seq)] },
    }));

    await harness.write(async (store) => {
      for (const chunk of chunks) {
        // Every one of these resolves. Nothing throws anywhere.
        await store.appendRecordingChunk(chunk);
      }
    });

    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
        sampleCount: 8,
        channels: { power: chunks.flatMap((chunk) => chunk.channels.power) },
      }),
    ).rejects.toThrow(/expected 8 samples to survive and 2 did/);
  });

  it('a repository that fills a recovered gap with a zero fails the recovery round trip', async () => {
    // The shape a recovery that only asked "did anything come back" misses
    // entirely, and the reason `assertRecordingRecovers` compares sample by
    // sample: a ride recovered after a crash with every dropout turned into
    // zeroes is the right length, decodes cleanly, and is not the ride.
    //
    // This case exists because a mutation run proved the comparison could be
    // deleted from `assertRecordingRecovers` with nothing in this package going
    // red — the identical hole that was found for `assertStreamSetRoundTrip`.
    const harness = harnessWith(gapFillingStoreFactory());
    await seedAthletes(harness);
    const recording = await seedRecording(harness, ATHLETE_A);
    const samples = [beatsPerMinute(140), undefined, beatsPerMinute(142)];

    await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 0,
        fromIndex: 0,
        sampleCount: 3,
        channels: { heartRate: samples },
      }),
    );

    await expect(
      assertRecordingRecovers(harness, ATHLETE_A, recording.id, {
        sampleCount: 3,
        channels: { heartRate: samples },
      }),
    ).rejects.toThrow(/channel heartRate, sample 1: wrote a gap and read back 0/);
  });

  it('the dropped-flush fake really does report every flush as successful', async () => {
    // Otherwise the case above would be satisfied by a fake that threw, which
    // proves nothing about the read.
    const harness = harnessWith(droppedFlushStoreFactory());
    await seedAthletes(harness);
    const recording = await seedRecording(harness, ATHLETE_A);

    const written = await harness.write(async (store) =>
      store.appendRecordingChunk({
        sessionId: recording.id,
        athleteId: ATHLETE_A,
        seq: 1,
        fromIndex: 0,
        sampleCount: 1,
        channels: { power: [watts(1)] },
      }),
    );
    // The second call in this handle's life, so it is the one that is dropped —
    // and it still resolves with the sequence number.
    expect(written).toBe(1);
  });

  it('the misrouting fake really does commit to the real database', async () => {
    // The distinguishing property. If this fake merely failed to write, it
    // would be the memory fake again and the harness would still be proved
    // against one failure shape only.
    const harness = harnessWith(misroutedBlobStoreFactory());
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 50, channels: ['power'] })),
    );

    // The metadata row survived a close and reopen, so the transaction really
    // committed — and the blobs it references are somewhere the reader is not
    // looking.
    const summary = await harness.read(async (store) =>
      store.getStreamSetSummary(ATHLETE_A, ride.id),
    );
    expect(summary?.channels).toEqual(['power']);
    await expect(
      harness.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).rejects.toThrow(/no bytes for it were found/);
  });
});

describe('the assertions themselves can fail, in the ways that matter', () => {
  it('a gap read back as a zero is a failure, not a match', () => {
    expect(() => {
      assertSameSamples('heartRate', [undefined, 60], [0, 60]);
    }).toThrow(RoundTripFailure);
  });

  it('a zero read back as a gap is a failure', () => {
    expect(() => {
      assertSameSamples('power', [0, 1], [undefined, 1]);
    }).toThrow(RoundTripFailure);
  });

  it('a truncated channel is a failure', () => {
    expect(() => {
      assertSameSamples('power', [1, 2, 3], [1, 2]);
    }).toThrow(/wrote 3 samples and read back 2/);
  });

  it('a channel that came back when nothing was written is a failure', () => {
    expect(() => {
      assertSameStreamSet(
        setWith({ power: [watts(1)] }),
        readWith({ power: [watts(1)], heartRate: [beatsPerMinute(60)] }),
      );
    }).toThrow(/channel heartRate was not written and came back with 1 samples/);
  });

  it('a channel that was written and did not come back is a failure', () => {
    expect(() => {
      assertSameStreamSet(
        setWith({ power: [watts(1)], heartRate: [beatsPerMinute(60)] }),
        readWith({ power: [watts(1)] }),
      );
    }).toThrow(/channel heartRate was written and did not come back at all/);
  });

  it('a scalar field that changed in the round trip is a failure', () => {
    const written = setWith({ power: [watts(1)] });
    expect(() => {
      assertSameStreamSet(written, { ...readWith({ power: [watts(1)] }), sampleCount: 2 });
    }).toThrow(/sampleCount: wrote 1 and read back 2/);
  });

  it('names the offending sample for a non-coordinate channel', () => {
    expect(() => {
      assertSameSamples('power', [210], [209]);
    }).toThrow(/sample 0: wrote 210 and read back 209/);
  });

  it('does not name the value for a coordinate channel — ADR 0004 decision D', () => {
    // The failure message reaches a console and a CI log, so the rule binds
    // here too. "A coordinate" and "a gap" is all a reader needs.
    expect(() => {
      assertSameSamples('latitude', [51.5074], [51.5075]);
    }).toThrow(/wrote a coordinate and read back a coordinate/);
    expect(() => {
      assertSameSamples('latitude', [51.5074], [51.5075]);
    }).not.toThrow(/51\.507/);
  });
});

describe('multi-tenant fixtures', () => {
  it('seeds three athletes, because two cannot tell scoped from connected', async () => {
    const harness = harnessWith();

    await seedAthletes(harness);

    const found = await harness.read(async (store) =>
      Promise.all(ATHLETES.map(async (id) => store.getAthlete(id))),
    );
    expect(found.map((athlete) => athlete?.id)).toEqual([ATHLETE_A, ATHLETE_B, ATHLETE_C]);
  });

  it('makes the write-path scoping case as short to write as the read-path one', async () => {
    // #26's review found that a two-athlete *read* fixture is blind to a
    // *write*-path hole. Both directions are one call each here.
    const harness = harnessWith();
    await seedAthletes(harness);
    const mine = await seedRide(harness, ATHLETE_A);

    await harness.write(async (store) => {
      await expect(store.putActivity({ ...rideFor(ATHLETE_B), id: mine.id })).rejects.toThrow(
        /belongs to a different athlete/,
      );
    });

    const survivor = await harness.read(async (store) => store.getActivity(ATHLETE_A, mine.id));
    expect(survivor).toBeDefined();
  });

  it('a ride seeded for one athlete is invisible to the other two', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const mine = await seedRide(harness, ATHLETE_A);

    await harness.read(async (store) => {
      expect(await store.getActivity(ATHLETE_B, mine.id)).toBeUndefined();
      expect(await store.getActivity(ATHLETE_C, mine.id)).toBeUndefined();
      expect(await store.getActivity(ATHLETE_A, mine.id)).toBeDefined();
    });
  });
});

describe('harness housekeeping', () => {
  it('gives every harness its own database, so two tests cannot see each other’s rows', async () => {
    const first = harnessWith();
    const second = harnessWith();
    expect(first.databaseName).not.toBe(second.databaseName);

    await seedAthletes(first);
    const seenBySecond = await second.read(async (store) => store.getAthlete(ATHLETE_A));
    expect(seenBySecond).toBeUndefined();
  });

  it('destroy removes the database, so a harness on the same name starts empty', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const { databaseName } = harness;
    await harness.destroy();

    const reopened = createStoreHarness({ databaseName });
    harnesses.push(reopened);

    expect(await reopened.read(async (store) => store.getAthlete(ATHLETE_A))).toBeUndefined();
  });

  it('a read against a database nothing has written finds nothing rather than throwing', async () => {
    const harness = harnessWith();

    expect(
      await harness.read(async (store) => store.getActivity(ATHLETE_A, activityId('nothing'))),
    ).toBeUndefined();
  });
});
