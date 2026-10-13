// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A finished ride becomes an activity the rider owns.
 *
 * ⚠️ **This asserts against a REAL store, read back through a fresh handle**,
 * rather than against the object `rideToSave` just built. §5 names four ways a
 * write reports success while the read cannot see it, and the one this module
 * is most exposed to is *wrong harness*: the natural test here compares
 * `finished.streams.channels` to the series it was built from, which passes
 * whether or not a byte reached IndexedDB.
 */

import {
  metres,
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId as toActivityId,
  lapId as toLapId,
  type LapId,
  type NewActivity,
  type RecordedCourseLap,
  type StreamChannelValue,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasNoLoadToWorkOut, needsLoadSummary } from '../analysis/summary';

import { rideName, rideToSave, saveFinishedRide, type RideSaveStore } from './finish';
import { riddenLap } from './laps';

const ACTIVITY = toActivityId('ride-1');
const ZONE = 'Europe/London';
const STARTED = unixSeconds(1_700_000_000);

let harness: StoreHarness;

beforeEach(() => {
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/**
 * Ten seconds of riding whose fifth second is a dropout in every channel.
 *
 * The gap is the point: it is what tells a wrong answer from a right one all
 * the way to the file, and §5 calls conflating it with zero the defect that
 * ruins every number downstream.
 */
function series(overrides: Partial<RecordedSeries<StreamChannelValue>> = {}) {
  const power = [200, 200, 200, 200, undefined, 200, 200, 200, 200, 200];
  const speed = [5, 5, 5, 5, undefined, 5, 5, 5, 5, 5];
  return {
    startedAt: STARTED,
    sampleInterval: seconds(1),
    sampleCount: 10,
    channels: {
      power: power.map((value) => (value === undefined ? undefined : watts(value))),
      speed: speed.map((value) => (value === undefined ? undefined : metresPerSecond(value))),
    },
    pauses: [],
    ...overrides,
  } as RecordedSeries<StreamChannelValue>;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVITY,
    athleteId: ATHLETE_A,
    series: series(),
    elapsedTime: seconds(10),
    movingTime: seconds(9),
    timeZone: ZONE,
    now: unixSeconds(1_700_000_020),
    ...overrides,
  };
}

describe('a ride nobody rode produces no activity', () => {
  it('returns nothing for an empty series', () => {
    expect(rideToSave(input({ series: series({ sampleCount: 0 }) }))).toBeUndefined();
  });

  it('and the save reports that rather than failing', async () => {
    // "Empty" is not "failed". A rider who pressed Start and Stop has not lost
    // anything, and telling them a save failed would send them looking.
    expect(await saveFinishedRide(storeOf(), undefined)).toStrictEqual({ status: 'empty' });
  });
});

describe('the ride reaches the store, and comes back through a fresh handle', () => {
  it('stores an activity that the library can list', async () => {
    await seedAthletes(harness);
    const finished = rideToSave(input());
    const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
    expect(outcome).toStrictEqual({ status: 'saved', id: ACTIVITY });

    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, ACTIVITY));
    // The name is asserted by shape rather than by a literal date, because the
    // date depends on the zone and pinning one here would be re-implementing
    // `localDay` in the test — `rideName`'s own cases below pin the rule.
    expect(read?.name).toMatch(/^Ride \d{4}-\d{2}-\d{2}$/);
    expect(read?.movingTime).toBe(9);
    expect(read?.elapsedTime).toBe(10);
  });

  it('brings the samples back with the dropout still a dropout', async () => {
    // ⚠️ The assertion the whole module exists for. A gap that came back as a
    // zero would be a ride with a second at 0 W in it, and every metric
    // downstream — the curve, the load, the zones — would be computed from a
    // rider who never coasted.
    await seedAthletes(harness);
    const finished = rideToSave(input());
    await harness.write(async (store) => saveFinishedRide(store, finished));

    const set = await harness.read(async (store) => store.getStreamSet(ATHLETE_A, ACTIVITY));
    expect(set?.sampleCount).toBe(10);
    expect(set?.channels.power?.[4]).toBeUndefined();
    expect(set?.channels.power?.[3]).toBe(200);
    expect(set?.channels.power?.[5]).toBe(200);
  });

  it('scopes the write to the athlete who rode it', async () => {
    await seedAthletes(harness);
    await harness.write(async (store) => saveFinishedRide(store, rideToSave(input())));
    expect(await harness.read(async (store) => store.getActivity(ATHLETE_B, ACTIVITY))).toBe(
      undefined,
    );
  });
});

describe('#947 — the facts the badges are earned from, saved with the ride', () => {
  it('reads back the best power, no ascent where there was no altitude, and what only the ride knew', async () => {
    await seedAthletes(harness);
    const finished = rideToSave(input({ workoutFinished: true, ghostRaced: true }));
    await harness.write(async (store) => saveFinishedRide(store, finished));
    const read = await harness.read(async (store) =>
      (await store.listActivitySummaries(ATHLETE_A)).find((each) => each.id === ACTIVITY),
    );
    expect(read?.rideFacts).toEqual({
      // A 5 s window around the dropout is not covered; one after it is.
      bestPower: [{ duration: 5, power: 200 }],
      workoutFinished: true,
      ghostRaced: true,
    });
  });

  it('works out an ascent from the altitude a ride recorded, and says nothing it did not know', () => {
    const climbing = series({
      channels: {
        ...series().channels,
        altitude: [100, 104, 108, 112, undefined, 116, 120, 124, 128, 130],
      },
    } as Partial<RecordedSeries<StreamChannelValue>>);
    const finished = rideToSave(input({ series: climbing }));
    expect(finished?.activity.rideFacts).toEqual({
      ascent: 30,
      bestPower: [{ duration: 5, power: 200 }],
    });
  });
});

describe('what the activity says about the ride', () => {
  it('integrates distance from speed, and a dropout adds none', () => {
    // Nine readings at 5 m/s over one-second samples. The tenth second has no
    // speed, and carrying the last known one across it would invent five
    // metres the rider may never have covered.
    const finished = rideToSave(input());
    expect(finished?.activity.distance).toBe(45);
  });

  it('scales distance by the sample interval, not by the sample count', () => {
    // ⚠️ Added because a mutation dropping the interval SURVIVED: every other
    // fixture here records at 1 Hz, where `speed × interval` and `speed` are
    // the same number, so nothing could tell them apart. A ride recorded at any
    // other rate would have reported a distance short by that factor.
    const slow = series({ sampleInterval: seconds(5) });
    expect(rideToSave(input({ series: slow }))?.activity.distance).toBe(9 * 5 * 5);
  });

  it('reports no distance at all for a ride with no speed channel', () => {
    const noSpeed = series({ channels: { power: [watts(200)] }, sampleCount: 1 });
    expect(rideToSave(input({ series: noSpeed }))?.activity.distance).toBe(0);
  });

  it('averages power over the readings that exist, not over the ride', () => {
    // Nine readings of 200 W and one dropout. Averaging over ten would report
    // 180 W and make a flaky meter look like an easier ride.
    expect(rideToSave(input())?.activity.averagePower).toBe(200);
  });

  it('leaves average power off a ride that recorded none', () => {
    const noPower = series({ channels: { speed: [metresPerSecond(5)] }, sampleCount: 1 });
    const activity = rideToSave(input({ series: noPower }))?.activity as NewActivity;
    expect('averagePower' in activity).toBe(false);
  });

  it('stores no average for no power channel, and 0 W for readings that were all 0 — #1054', async () => {
    // #1054's first criterion, read back through the store as the library's
    // card reads it. The 0 is what the readings averaged, and it stays stored;
    // it is `format.ts` §`shownAveragePower` that keeps it off the screen.
    await seedAthletes(harness);
    const zeros = series({
      channels: {
        power: Array.from({ length: 10 }, () => watts(0)),
        speed: Array.from({ length: 10 }, () => metresPerSecond(5)),
      },
    });
    const noPower = series({ channels: { speed: [metresPerSecond(5)] }, sampleCount: 1 });
    const second = toActivityId('no-power-channel');
    await harness.write(async (store) => {
      await saveFinishedRide(store, rideToSave(input({ series: zeros })));
      await saveFinishedRide(store, rideToSave(input({ id: second, series: noPower })));
    });
    const read = await harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, ACTIVITY),
      await store.getActivity(ATHLETE_A, second),
    ]);
    expect(read[0]?.averagePower).toBe(0);
    expect(read[1] !== undefined && 'averagePower' in read[1]).toBe(false);
    expect(read[1]).toBeDefined();
  });

  it('sets no visibility, so the store applies ADR 0004’s private default', async () => {
    await seedAthletes(harness);
    const finished = rideToSave(input());
    expect('visibility' in finished!.activity).toBe(false);
    await harness.write(async (store) => saveFinishedRide(store, finished));
    const read = await harness.read(async (store) => store.getActivity(ATHLETE_A, ACTIVITY));
    expect(read?.visibility).toBe('private');
  });

  it('names the ride after the workout when one was ridden', () => {
    expect(rideName(STARTED, ZONE, 'Over-unders')).toBe('Over-unders');
  });

  it('falls back to the local calendar day the fitness chart counts it against', () => {
    // Not a time-of-day word: the same `localDay` the chart aggregates on, so a
    // ride's name and the day it is counted against cannot disagree.
    expect(rideName(STARTED, ZONE)).toMatch(/^Ride \d{4}-\d{2}-\d{2}$/);
  });

  it('ignores a workout name that is only spaces', () => {
    expect(rideName(STARTED, ZONE, '   ')).toMatch(/^Ride /);
  });
});

describe('a save that fails leaves nothing half-written', () => {
  it('takes the activity back out when the samples will not go down', async () => {
    // ⚠️ A row with no samples behind it shows in the library and opens to
    // nothing — the importer's own reason for the same rollback.
    const deleted: string[] = [];
    const store: RideSaveStore = {
      putActivity: () => Promise.resolve(ACTIVITY),
      putStreamSet: () => Promise.reject(new Error('the device is full')),
      putLap: (lap) => Promise.resolve(lap.id),
      deleteActivity: (_athlete, id) => {
        deleted.push(id);
        return Promise.resolve(true);
      },
    };
    const outcome = await saveFinishedRide(store, rideToSave(input()));
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('the device is full');
    expect(deleted).toStrictEqual([ACTIVITY]);
  });

  it('reports the original cause even when the tidy-up also fails', async () => {
    // The rider needs to know the device is full, not whatever the cleanup hit
    // on the way out.
    const store: RideSaveStore = {
      putActivity: () => Promise.resolve(ACTIVITY),
      putStreamSet: () => Promise.reject(new Error('the device is full')),
      putLap: (lap) => Promise.resolve(lap.id),
      deleteActivity: () => Promise.reject(new Error('and the delete failed too')),
    };
    const outcome = await saveFinishedRide(store, rideToSave(input()));
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('the device is full');
  });

  it('writes no streams when the activity itself will not go down', async () => {
    const attempted: string[] = [];
    const store: RideSaveStore = {
      putActivity: () => Promise.reject(new Error('no room')),
      putStreamSet: () => {
        attempted.push('streams');
        return Promise.resolve(ACTIVITY);
      },
      putLap: (lap) => Promise.resolve(lap.id),
      deleteActivity: () => Promise.resolve(true),
    };
    expect((await saveFinishedRide(store, rideToSave(input()))).status).toBe('failed');
    // Streams behind no activity is the state `putStreamSet` refuses anyway;
    // this asserts the caller never asks it to.
    expect(attempted).toStrictEqual([]);
  });
});

// #1312: the laps of a course ridden during the recording.
function riddenLaps(): {
  readonly ridden: readonly RecordedCourseLap[];
  readonly newLapId: () => LapId;
} {
  const mark = (offset: number, moving: number) => ({
    at: unixSeconds(STARTED + offset),
    movingTime: seconds(moving),
  });
  const course = { distance: metres(1_000), ascent: metres(9), partial: false };
  let next = 0;
  return {
    // Over `series()`: slots 0..4 (the dropout is the fifth), 5..8, and 9.
    ridden: [
      riddenLap(mark(0, 0), mark(5, 4), course),
      riddenLap(mark(5, 4), mark(9, 7), course),
      riddenLap(mark(9, 7), mark(10, 8), { ...course, distance: metres(120), partial: true }),
    ],
    newLapId: () => toLapId(`lap-${String((next += 1))}`),
  };
}

describe("#1312 — a ride's laps are saved with it", () => {
  it('and come back through a fresh handle, in order, with a part lap still a part lap', async () => {
    await seedAthletes(harness);
    const finished = rideToSave(input({ laps: riddenLaps() }));
    const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
    expect(outcome.status).toBe('saved');

    const laps = await harness.read(async (store) => store.listLaps(ATHLETE_A, ACTIVITY));
    expect(laps.map((lap) => [lap.ordinal, lap.movingTime, lap.distance, lap.partial])).toEqual([
      [0, 4, 1_000, undefined],
      [1, 3, 1_000, undefined],
      [2, 1, 120, true],
    ]);
    expect(laps[0]).toMatchObject({ averagePower: 200, maxPower: 200, ascent: 9 });
    // Scoped: another athlete asking for this ride's laps is given none.
    expect(await harness.read(async (store) => store.listLaps(ATHLETE_B, ACTIVITY))).toEqual([]);
  });

  it('a ride with no course under it is saved with no laps', async () => {
    await seedAthletes(harness);
    await harness.write(async (store) => saveFinishedRide(store, rideToSave(input())));

    expect(await harness.read(async (store) => store.listLaps(ATHLETE_A, ACTIVITY))).toEqual([]);
  });

  it('takes the whole ride back out when a lap will not go down', async () => {
    const deleted: string[] = [];
    let written = 0;
    const store: RideSaveStore = {
      ...storeOf(),
      putLap: (lap) => {
        written += 1;
        return written === 2
          ? Promise.reject(new Error('the device is full'))
          : Promise.resolve(lap.id);
      },
      deleteActivity: (_athlete, id) => {
        deleted.push(id);
        return Promise.resolve(true);
      },
    };

    const outcome = await saveFinishedRide(store, rideToSave(input({ laps: riddenLaps() })));

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('the device is full');
    expect(deleted).toStrictEqual([ACTIVITY]);
    // It stopped at the lap that failed.
    expect(written).toBe(2);
  });

  it('and through the real store that leaves no ride and no lap behind', async () => {
    await seedAthletes(harness);
    const finished = rideToSave(input({ laps: riddenLaps() }));
    await harness.write(async (store) => {
      const refusing: RideSaveStore = {
        putActivity: (record) => store.putActivity(record),
        putStreamSet: (set) => store.putStreamSet(set),
        deleteActivity: (athlete, id) => store.deleteActivity(athlete, id),
        putLap: (lap) =>
          lap.ordinal === 1 ? Promise.reject(new Error('refused')) : store.putLap(lap),
      };
      expect((await saveFinishedRide(refusing, finished)).status).toBe('failed');
    });

    expect(await harness.read(async (store) => store.getActivity(ATHLETE_A, ACTIVITY))).toBe(
      undefined,
    );
    expect(await harness.read(async (store) => store.listLaps(ATHLETE_A, ACTIVITY))).toEqual([]);
  });
});

function storeOf(): RideSaveStore {
  return {
    putActivity: () => Promise.resolve(ACTIVITY),
    putStreamSet: () => Promise.resolve(ACTIVITY),
    putLap: (lap) => Promise.resolve(lap.id),
    deleteActivity: () => Promise.resolve(true),
  };
}

describe('#1084 — a ride with nothing to work a load out from is saved as such', () => {
  it('reads back, through a fresh handle, as a ride with no load rather than one to work out', async () => {
    // Ten seconds is shorter than the smoothing window, so no load can ever
    // come from it: the row carries the marker from the moment it is written.
    await seedAthletes(harness);
    await harness.write(async (store) => saveFinishedRide(store, rideToSave(input())));
    const read = await harness.read(async (store) =>
      (await store.listActivitySummaries(ATHLETE_A)).find((each) => each.id === ACTIVITY),
    );
    expect(read?.loadCoveredTime).toBe(0);
    expect(read?.effortWeightedPower).toBeUndefined();
    expect(read?.effortWeightedHeartRate).toBeUndefined();
    expect(read === undefined ? undefined : hasNoLoadToWorkOut(read)).toBe(true);
    expect(read === undefined ? undefined : needsLoadSummary(read)).toBe(false);
  });

  it('saves a ride long enough for a load with the load, not the marker', () => {
    const long = series({
      sampleCount: 600,
      channels: { power: Array.from({ length: 600 }, () => watts(200)) },
    });
    const finished = rideToSave(input({ series: long }));
    expect(finished?.activity.effortWeightedPower).toBe(200);
    expect(finished?.activity.loadCoveredTime).toBe(600);
  });
});
