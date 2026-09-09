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
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId as toActivityId,
  type NewActivity,
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

import { rideName, rideToSave, saveFinishedRide, type RideSaveStore } from './finish';

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
      deleteActivity: () => Promise.resolve(true),
    };
    expect((await saveFinishedRide(store, rideToSave(input()))).status).toBe('failed');
    // Streams behind no activity is the state `putStreamSet` refuses anyway;
    // this asserts the caller never asks it to.
    expect(attempted).toStrictEqual([]);
  });
});

function storeOf(): RideSaveStore {
  return {
    putActivity: () => Promise.resolve(ACTIVITY),
    putStreamSet: () => Promise.resolve(ACTIVITY),
    deleteActivity: () => Promise.resolve(true),
  };
}
