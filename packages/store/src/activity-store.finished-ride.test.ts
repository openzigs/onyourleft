// SPDX-License-Identifier: Apache-2.0

/**
 * `putFinishedRide` (#1326): a finished ride — its activity, its samples, its
 * laps, and the `savedAs` link on the checkpoint it was recorded into — is in
 * the library whole or not at all.
 *
 * Every assertion reads back through the public path on a connection the write
 * never touched (docs/agents/store-harness.md). The decisive case, a lap the
 * store refuses, is one assertion body run twice: green against the real
 * store, and red against `piecewiseRideStoreFactory`, which writes the same
 * parts as separate writes — the shape this write path replaced.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreReferentialError, StoreValidationError } from './errors';
import { activityId } from './ids';
import type { NewFinishedRide } from './records';
import type { NewRecordingSession } from './recording';
import {
  assertSameStreamSet,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  lapFor,
  memoryWriteStoreFactory,
  piecewiseRideStoreFactory,
  resetFixtureIds,
  rideFor,
  seedAthletes,
  seedRecording,
  seedRide,
  streamSetFor,
  type StoreFactory,
  type StoreHarness,
} from './testing';

const harnesses: StoreHarness[] = [];

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

function finishedRide(recording?: NewRecordingSession): NewFinishedRide {
  const activity = rideFor(ATHLETE_A);
  return {
    activity,
    streams: streamSetFor(activity, { sampleCount: 120 }),
    laps: [lapFor(activity, 0), lapFor(activity, 1)],
    ...(recording === undefined ? {} : { recordingSession: recording.id }),
  };
}

/** Everything a reader could find of `ride`, on a fresh connection. */
async function whatIsThere(
  harness: StoreHarness,
  ride: NewFinishedRide,
  recording: NewRecordingSession,
) {
  return harness.read(async (store) => ({
    activity: await store.getActivity(ATHLETE_A, ride.activity.id),
    streams: await store.getStreamSetSummary(ATHLETE_A, ride.activity.id),
    laps: await store.listLaps(ATHLETE_A, ride.activity.id),
    savedAs: (await store.getRecordingSession(ATHLETE_A, recording.id))?.savedAs,
    library: (await store.listActivitySummaries(ATHLETE_A)).map((row) => row.id),
  }));
}

/**
 * The scenario the issue names: a lap fails, and nothing of the ride is left.
 *
 * The lap's id is already athlete B's, so the store refuses it — a real
 * refusal, through the real check, rather than a thrown stub. Throws (rather
 * than `expect`s) so the same body can be required to fail against the fake.
 */
async function aFailedLapLeavesNothing(harness: StoreHarness): Promise<void> {
  await seedAthletes(harness);
  const recording = await seedRecording(harness, ATHLETE_A, { state: 'stopped' });
  const other = await seedRide(harness, ATHLETE_B);
  const taken = lapFor(other, 0);
  await harness.write(async (store) => store.putLap(taken));

  const ride = finishedRide(recording);
  const withTakenLap: NewFinishedRide = {
    ...ride,
    laps: [ride.laps[0]!, { ...ride.laps[1]!, id: taken.id }],
  };
  let refused = false;
  try {
    await harness.write(async (store) => store.putFinishedRide(withTakenLap));
  } catch (error: unknown) {
    refused = error instanceof StoreReferentialError;
  }
  if (!refused) {
    throw new Error('the store accepted a lap that is another athlete’s');
  }

  const there = await whatIsThere(harness, ride, recording);
  if (
    there.activity !== undefined ||
    there.streams !== undefined ||
    there.laps.length !== 0 ||
    there.savedAs !== undefined ||
    there.library.length !== 0
  ) {
    throw new Error(
      `a failed save left part of the ride behind: activity ${String(there.activity !== undefined)}, ` +
        `samples ${String(there.streams !== undefined)}, ${String(there.laps.length)} laps, ` +
        `checkpoint marked ${String(there.savedAs)}`,
    );
  }
}

describe('putFinishedRide writes a ride whole', () => {
  it('writes the activity, its samples, its laps and the checkpoint link together', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const recording = await seedRecording(harness, ATHLETE_A, { state: 'stopped' });
    const ride = finishedRide(recording);

    await expect(harness.write(async (store) => store.putFinishedRide(ride))).resolves.toBe(
      ride.activity.id,
    );

    const there = await whatIsThere(harness, ride, recording);
    expect(there.activity?.name).toBe(ride.activity.name);
    // ADR 0004 A's default is applied on this path too, not only on putActivity's.
    expect(there.activity?.visibility).toBe('private');
    expect(there.activity?.mayBeRaced).toBe(false);
    expect(there.library).toEqual([ride.activity.id]);
    expect(there.laps.map((lap) => lap.id)).toEqual(ride.laps.map((lap) => lap.id));
    expect(there.laps.every((lap) => lap.athleteId === ATHLETE_A)).toBe(true);
    expect(there.savedAs).toBe(ride.activity.id);
    const samples = await harness.read(async (store) =>
      store.getStreamSet(ATHLETE_A, ride.activity.id),
    );
    expect(samples).toBeDefined();
    assertSameStreamSet(ride.streams, samples!);
  });

  it('saves a ride with no checkpoint to mark, and a ride with no laps', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const ride = { ...finishedRide(), laps: [] };

    await harness.write(async (store) => store.putFinishedRide(ride));

    const read = await harness.read(async (store) => ({
      activity: await store.getActivity(ATHLETE_A, ride.activity.id),
      streams: await store.getStreamSetSummary(ATHLETE_A, ride.activity.id),
    }));
    expect(read.activity?.id).toBe(ride.activity.id);
    expect(read.streams?.sampleCount).toBe(120);
  });

  it('leaves alone a checkpoint under that id that is another athlete’s', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const theirs = await seedRecording(harness, ATHLETE_B, { state: 'stopped' });
    const ride = finishedRide(theirs);

    await harness.write(async (store) => store.putFinishedRide(ride));

    const read = await harness.read(async (store) =>
      store.getRecordingSession(ATHLETE_B, theirs.id),
    );
    expect(read?.savedAs).toBeUndefined();
  });
});

describe('a failed part leaves nothing of the ride behind', () => {
  it('a lap the store refuses takes the activity, its samples and the link with it', async () => {
    await aFailedLapLeavesNothing(harnessWith());
  });

  it('…and the same body goes red against a store that writes the parts one by one', async () => {
    await expect(aFailedLapLeavesNothing(harnessWith(piecewiseRideStoreFactory()))).rejects.toThrow(
      /a failed save left part of the ride behind/,
    );
  });

  it('a ride whose athlete does not exist writes nothing', async () => {
    const harness = harnessWith();
    const ride = finishedRide();
    await expect(
      harness.write(async (store) => store.putFinishedRide(ride)),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });
});

describe('the parts of a ride must be the same ride', () => {
  it('refuses samples for another activity, and writes nothing', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const ride = finishedRide();
    const mismatched = {
      ...ride,
      streams: { ...ride.streams, activityId: activityId('elsewhere') },
    };

    await expect(
      harness.write(async (store) => store.putFinishedRide(mismatched)),
    ).rejects.toBeInstanceOf(StoreValidationError);
    expect(
      await harness.read(async (store) => store.getActivity(ATHLETE_A, ride.activity.id)),
    ).toBe(undefined);
  });

  it('refuses samples filed under another athlete', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const ride = finishedRide();
    const mismatched = { ...ride, streams: { ...ride.streams, athleteId: ATHLETE_B } };

    await expect(
      harness.write(async (store) => store.putFinishedRide(mismatched)),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });

  it('refuses a lap for another activity', async () => {
    const harness = harnessWith();
    await seedAthletes(harness);
    const ride = finishedRide();
    const mismatched = {
      ...ride,
      laps: [{ ...ride.laps[0]!, activityId: activityId('elsewhere') }],
    };

    await expect(
      harness.write(async (store) => store.putFinishedRide(mismatched)),
    ).rejects.toBeInstanceOf(StoreValidationError);
    expect(
      await harness.read(async (store) => store.getActivity(ATHLETE_A, ride.activity.id)),
    ).toBe(undefined);
  });
});

describe('the memory-write fake diverts this write path too', () => {
  it('reports success and leaves nothing a fresh connection can read', async () => {
    const harness = harnessWith(memoryWriteStoreFactory());
    await harness.write(async (store) => store.putFinishedRide(finishedRide()));
    expect(await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toEqual([]);
  });
});
