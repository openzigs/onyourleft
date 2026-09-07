// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The analysis reads, tested at two levels.
 *
 * The stub port answers *what does the loader ask the store for* — the read
 * budget, the channel that is skipped, the threshold that reaches the
 * boundaries. The #28 round-trip harness answers the one question a stub
 * cannot: #78's fifth criterion asks that adding an activity which beats a
 * personal best be *"asserted by a test that adds the activity and re-reads
 * through a fresh store handle, not by inspecting an in-memory result"*. A stub
 * has no handle to be fresh, so that assertion is made against the real store
 * at the bottom of this file.
 */

import {
  beatsPerMinute,
  effortAt,
  unixSeconds,
  watts,
  type BeatsPerMinute,
  type Watts,
} from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  seedRide,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { stubActivity } from '../detail/testing';

import { BESTS_ACTIVITY_LIMIT, loadLibraryBests, loadRideZones } from './load';
import { stubAnalysis, type StubAnalysisRide } from './testing';
import type { AnalysisPort } from './store-port';

const OWNER = toAthleteId('athlete-a');

/** A ride of one repeated wattage, at 1 Hz. */
function steadyPower(value: number, length: number): readonly Watts[] {
  return Array.from({ length }, () => watts(value));
}

function steadyHeartRate(value: number, length: number): readonly BeatsPerMinute[] {
  return Array.from({ length }, () => beatsPerMinute(value));
}

function ride(id: string, extra: Partial<StubAnalysisRide> = {}): StubAnalysisRide {
  return {
    activity: stubActivity({ id: activityId(id), name: id }),
    ...extra,
  };
}

describe('loadRideZones — what it reads, and what it does not', () => {
  it('reads only the channels the ride has', async () => {
    // The whole of #78's "a ride with only one of the two shows only that one
    // rather than an empty chart", answered in the data layer: the summary said
    // there is no heart-rate channel, so nothing tried to decode one.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.power).toBeDefined();
    expect(result?.heartRate).toBeUndefined();
    expect(port.channelReads).toEqual(['ride-1:power']);
    expect(port.summaryReads).toEqual(['ride-1']);
  });

  it('decodes nothing at all for a ride with neither channel', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1')]);

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.power).toBeUndefined();
    expect(result?.heartRate).toBeUndefined();
    expect(port.channelReads).toEqual([]);
  });

  it('reads both when both are there', async () => {
    const port = stubAnalysis(OWNER, [
      ride('ride-1', { power: steadyPower(200, 600), heartRate: steadyHeartRate(150, 600) }),
    ]);

    await loadRideZones(port, activityId('ride-1'));

    expect(port.channelReads).toEqual(['ride-1:power', 'ride-1:heartRate']);
  });

  it('is undefined for a ride this athlete does not have', async () => {
    // Covers "no such id" and "somebody else's ride" without distinguishing
    // them, for the reason `detail/load.ts` records.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 60) })]);

    expect(await loadRideZones(port, activityId('ride-9'))).toBeUndefined();
    expect(port.channelReads).toEqual([]);
  });
});

describe('loadRideZones — the threshold reaches the boundaries', () => {
  it('uses the athlete’s stored threshold rather than the default', async () => {
    // #78's first criterion, at the layer that actually assembles the screen:
    // not "the formula scales" — `zones.test.ts` has that — but "the number on
    // the athlete record is the number the boundaries came from".
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], {
      id: OWNER,
      displayName: 'A',
      createdAt: stubActivity().createdAt,
      thresholdPower: watts(400),
    });

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.thresholds.thresholdPower).toBe(400);
    expect(result?.thresholds.assumed.power).toBe(false);
    // 200 W is half of 400, so it is zone 1 — where at the 200 W default it
    // would be zone 4. The whole ride moves.
    expect(result?.power?.time.perZone[0]).toBe(600);
    expect(result?.power?.threshold).toBe(400);
  });

  it('falls back to the default and says the number is assumed', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.thresholds.assumed).toEqual({ power: true, heartRate: true });
    // At the 200 W default, 200 W is threshold itself — zone 4.
    expect(result?.power?.time.perZone[3]).toBe(600);
  });

  it('reports moving time beside the covered time, so a shortfall is visible', async () => {
    // `zones.ts` records that the two are not the same number and why. The
    // loader carries both rather than picking one, so the view can say "94%
    // covered" instead of showing a total that is short for no stated reason.
    const withGap: readonly (Watts | undefined)[] = [
      ...steadyPower(200, 100),
      ...Array.from<undefined>({ length: 50 }).fill(undefined),
    ];
    const port = stubAnalysis(OWNER, [
      { activity: stubActivity({ id: activityId('ride-1') }), power: withGap },
    ]);

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.power?.time.covered).toBe(100);
    expect(result?.movingTime).toBe(stubActivity().movingTime);
  });

  it('honours a stream stored at an interval other than one second', async () => {
    // The interval comes from the stored set. A five-second grid over 100
    // samples is 500 seconds of riding, not 100.
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({ id: activityId('ride-1') }),
        power: steadyPower(200, 100),
        sampleInterval: 5,
      },
    ]);

    const result = await loadRideZones(port, activityId('ride-1'));

    expect(result?.power?.time.covered).toBe(500);
  });
});

describe('loadLibraryBests', () => {
  it('takes the best of each duration across the library', async () => {
    const port = stubAnalysis(OWNER, [
      ride('sprinter', { power: [...steadyPower(600, 30), ...steadyPower(100, 3600)] }),
      ride('rouleur', { power: steadyPower(280, 3600) }),
    ]);

    const bests = await loadLibraryBests(port);

    expect(effortAt(bests.curve, 30)).toBe(600);
    expect(effortAt(bests.curve, 1800)).toBe(280);
    expect(bests.activitiesRead).toBe(2);
    expect(bests.activitiesWithPower).toBe(2);
    expect(bests.truncated).toBe(false);
  });

  it('never lets a window span two rides', async () => {
    // The correctness rule `power-duration.ts` states: two twenty-minute rides
    // at 300 W are not a forty-minute effort at 300 W. Concatenating the
    // samples before computing would say they are.
    const port = stubAnalysis(OWNER, [
      ride('first', { power: steadyPower(300, 1200) }),
      ride('second', { power: steadyPower(300, 1200) }),
    ]);

    const bests = await loadLibraryBests(port);

    expect(effortAt(bests.curve, 1200)).toBe(300);
    expect(effortAt(bests.curve, 1800)).toBeUndefined();
  });

  it('skips a ride with no power without decoding it', async () => {
    const port = stubAnalysis(OWNER, [
      ride('with-power', { power: steadyPower(250, 600) }),
      ride('strap-only', { heartRate: steadyHeartRate(150, 600) }),
      ride('no-streams'),
    ]);

    const bests = await loadLibraryBests(port);

    expect(bests.activitiesRead).toBe(3);
    expect(bests.activitiesWithPower).toBe(1);
    // Three cheap summary reads, one expensive decode. That is the budget.
    expect(port.summaryReads).toHaveLength(3);
    expect(port.channelReads).toEqual(['with-power:power']);
  });

  it('is empty for a library with no power anywhere, rather than a curve of zeros', async () => {
    const port = stubAnalysis(OWNER, [
      ride('strap-only', { heartRate: steadyHeartRate(150, 600) }),
    ]);

    const bests = await loadLibraryBests(port);

    expect(bests.curve).toEqual([]);
    expect(bests.activitiesWithPower).toBe(0);
  });

  it('bounds the read and says so when the history is longer', async () => {
    // The bound is stated, and the fact that it bit is reported rather than
    // swallowed: "your best twenty minutes" and "your best twenty minutes in
    // your last N rides" are different claims.
    const rides = Array.from({ length: 5 }, (_unused, index) =>
      ride(`ride-${String(index)}`, { power: steadyPower(100 + index, 60) }),
    );
    const port = stubAnalysis(OWNER, rides);

    const bests = await loadLibraryBests(port, 3);

    expect(bests.activitiesRead).toBe(3);
    expect(bests.truncated).toBe(true);
    // Four asked for, so that "is there more" is answered by the same query.
    expect(port.listReads[0]?.limit).toBe(4);
    expect(port.channelReads).toHaveLength(3);
  });

  it('reads newest first, so the bound truncates history and not recent form', async () => {
    const older = ride('older', { power: steadyPower(400, 60) });
    const newer: StubAnalysisRide = {
      activity: stubActivity({
        id: activityId('newer'),
        startedAt: unixSeconds(older.activity.startedAt + 1),
      }),
      power: steadyPower(100, 60),
    };
    const port = stubAnalysis(OWNER, [older, newer]);

    const bests = await loadLibraryBests(port, 1);

    expect(port.channelReads).toEqual(['newer:power']);
    expect(effortAt(bests.curve, 60)).toBe(100);
  });

  it('defaults to the stated limit', async () => {
    const port = stubAnalysis(OWNER, []);

    await loadLibraryBests(port);

    expect(port.listReads[0]?.limit).toBe(BESTS_ACTIVITY_LIMIT + 1);
  });
});

/**
 * #78's fifth criterion, in its literal form.
 *
 * *"adding a new activity that beats one updates it — asserted by a test that
 * adds the activity and re-reads through a fresh store handle, not by
 * inspecting an in-memory result."*
 *
 * `harness.read()` discards every open handle before it opens another, so the
 * second answer below cannot be served by the connection that wrote the ride.
 * That closes all four of the failure causes CLAUDE.md §5 names: a write that
 * landed in a cache, one acknowledged at the edge, one in a transaction that
 * never committed, and a harness comparing against the object it just built.
 */
describe('loadLibraryBests — through the real store, on a fresh handle', () => {
  let harness: StoreHarness | undefined;

  afterEach(async () => {
    await harness?.destroy();
    harness = undefined;
  });

  /** The port, over whichever connection the harness hands us. */
  function portOver(store: Parameters<Parameters<StoreHarness['read']>[0]>[0]): AnalysisPort {
    return { athleteId: ATHLETE_A, store };
  }

  it('raises a duration best when a ride that beats it is added', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);

    // A modest ride: sixty seconds at 200 W and nothing harder.
    const first = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putStreamSet({
        ...streamSetFor(first, { channels: ['power'], sampleCount: 120 }),
        channels: { power: Array.from({ length: 120 }, () => watts(200)) },
      });
    });

    const before = await harness.read(async (store) => loadLibraryBests(portOver(store)));
    expect(effortAt(before.curve, 60)).toBe(200);
    expect(before.activitiesWithPower).toBe(1);

    // Now a harder one, written through the public path.
    const second = await seedRide(harness, ATHLETE_A, {
      startedAt: unixSeconds(first.startedAt + 10_000),
    });
    await harness.write(async (store) => {
      await store.putStreamSet({
        ...streamSetFor(second, { channels: ['power'], sampleCount: 120 }),
        channels: { power: Array.from({ length: 120 }, () => watts(320)) },
      });
    });

    // A fresh connection. Nothing above it is reused.
    const after = await harness.read(async (store) => loadLibraryBests(portOver(store)));

    expect(effortAt(after.curve, 60)).toBe(320);
    expect(after.activitiesWithPower).toBe(2);
    // The one-minute best moved and the five-second best moved with it; the
    // two-minute best exists because each ride is 120 samples long.
    expect(effortAt(after.curve, 5)).toBe(320);
    expect(effortAt(after.curve, 120)).toBe(320);
    // And the harness really did open more than one connection, which is what
    // makes "fresh handle" a fact rather than a claim in a comment.
    expect(harness.connectionsOpened).toBeGreaterThan(2);
  });

  it('does not lower a best when a slower ride is added', async () => {
    // The other half, and the one a wrong fold gets wrong: a pointwise maximum
    // is not an average and a new ride can only raise a number.
    harness = createStoreHarness();
    await seedAthletes(harness);

    const hard = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putStreamSet({
        ...streamSetFor(hard, { channels: ['power'], sampleCount: 60 }),
        channels: { power: Array.from({ length: 60 }, () => watts(340)) },
      });
    });

    const easy = await seedRide(harness, ATHLETE_A, {
      startedAt: unixSeconds(hard.startedAt + 10_000),
    });
    await harness.write(async (store) => {
      await store.putStreamSet({
        ...streamSetFor(easy, { channels: ['power'], sampleCount: 60 }),
        channels: { power: Array.from({ length: 60 }, () => watts(120)) },
      });
    });

    const after = await harness.read(async (store) => loadLibraryBests(portOver(store)));

    expect(effortAt(after.curve, 60)).toBe(340);
  });

  it('reads zones for a stored ride through a fresh handle too', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);

    const stored = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putStreamSet({
        ...streamSetFor(stored, { channels: ['power'], sampleCount: 300 }),
        channels: { power: Array.from({ length: 300 }, () => watts(200)) },
      });
    });

    const result = await harness.read(async (store) => loadRideZones(portOver(store), stored.id));

    // 200 W with no stored threshold is the default threshold exactly: zone 4.
    expect(result?.power?.time.perZone[3]).toBe(300);
    expect(result?.power?.time.covered).toBe(300);
    expect(result?.heartRate).toBeUndefined();
  });
});
