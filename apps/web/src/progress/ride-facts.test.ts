// SPDX-License-Identifier: AGPL-3.0-or-later

/** The facts a ride's badges are earned from, and the look at older rides — #947. */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';

import { deriveProgress } from './progress';
import { LOOK_BATCH, lookAtOlderRides, rideFactsOf } from './ride-facts';

const OWNER = toAthleteId('athlete-a');
const DAY = 86_400;
const NOW = unixSeconds(1_790_000_000);

describe('rideFactsOf', () => {
  it('is {} for a ride with nothing to say, so it still reads as worked out', () => {
    expect(rideFactsOf({ sampleInterval: seconds(1) })).toEqual({});
  });

  it('reads a best at each badge duration the power covers, and none it does not', () => {
    const power = Array.from({ length: 90 }, (_unused, index) => watts(index < 10 ? 500 : 200));
    expect(rideFactsOf({ power, sampleInterval: seconds(1) })).toEqual({
      bestPower: [
        { duration: 5, power: 500 },
        { duration: 60, power: 250 },
      ],
    });
    // Not a 1 Hz grid: not read, rather than misread as seconds.
    expect(rideFactsOf({ power, sampleInterval: seconds(2) })).toEqual({});
  });

  it('says a workout was finished or a ghost raced only when told so', () => {
    expect(
      rideFactsOf({ sampleInterval: seconds(1), workoutFinished: true, ghostRaced: false }),
    ).toEqual({ workoutFinished: true });
  });
});

function olderRide(
  id: string,
  daysAgo: number,
  extra: Partial<StubAnalysisRide> = {},
): StubAnalysisRide {
  return {
    activity: stubActivity({
      id: activityId(id),
      startedAt: unixSeconds(NOW - daysAgo * DAY),
      startedAtTimeZone: 'UTC',
      movingTime: seconds(1_800),
      distance: metres(20_000),
      averagePower: watts(200),
    }),
    power: Array.from({ length: 120 }, () => watts(200)),
    altitude: Array.from({ length: 120 }, (_unused, index) => 100 + index),
    ...extra,
  };
}

describe('lookAtOlderRides', () => {
  it('reads only counted rides with no facts, oldest first, and writes what their samples show', async () => {
    const rides = [
      olderRide('newer', 1),
      olderRide('older', 9),
      olderRide('done', 5),
      {
        ...olderRide('idle', 3),
        activity: { ...olderRide('idle', 3).activity, movingTime: seconds(120) },
      },
    ];
    const done = rides[2];
    if (done !== undefined) {
      rides[2] = { ...done, activity: { ...done.activity, rideFacts: {} } };
    }
    const port = stubAnalysis(OWNER, rides);
    const summaries = await port.store.listActivitySummaries(OWNER);

    const outcome = await lookAtOlderRides(port, summaries);

    expect(outcome).toEqual({ read: 2, unreadable: 0, remaining: 0 });
    expect(port.factsWrites).toEqual(['older', 'newer']);
    const after = await port.store.listActivitySummaries(OWNER);
    expect(after.find((each) => each.id === 'older')?.rideFacts).toEqual({
      ascent: 119,
      bestPower: [
        { duration: 5, power: 200 },
        { duration: 60, power: 200 },
      ],
    });
    // Read, the history no longer holds a best back.
    expect(deriveProgress(after, NOW).unread).toBe(0);
  });

  it('reads no more than one batch per press', async () => {
    const rides = Array.from({ length: LOOK_BATCH + 3 }, (_unused, index) =>
      olderRide(`r${String(index)}`, index + 1),
    );
    const port = stubAnalysis(OWNER, rides);
    const outcome = await lookAtOlderRides(port, await port.store.listActivitySummaries(OWNER));
    expect(outcome).toEqual({ read: LOOK_BATCH, unreadable: 0, remaining: 3 });
  });

  it('skips a ride whose stream cannot be read, writes the rest, and tries it again next time', async () => {
    const rides = [olderRide('first', 9), olderRide('broken', 5), olderRide('last', 1)];
    const stub = stubAnalysis(OWNER, rides);
    let failing = true;
    const port = {
      ...stub,
      store: {
        ...stub.store,
        getStreamChannel: (async (owner, id, channel) => {
          if (failing && id === 'broken') throw new Error('the stream could not be decoded');
          return stub.store.getStreamChannel(owner, id, channel);
        }) as typeof stub.store.getStreamChannel,
      },
    };

    const first = await lookAtOlderRides(port, await port.store.listActivitySummaries(OWNER));

    expect(first).toEqual({ read: 2, unreadable: 1, remaining: 1 });
    expect(stub.factsWrites).toEqual(['first', 'last']);
    const between = await port.store.listActivitySummaries(OWNER);
    // Nothing was written for it, not even `{}`: it is still unread.
    expect(between.find((each) => each.id === 'broken')?.rideFacts).toBeUndefined();
    expect(deriveProgress(between, NOW).unread).toBe(1);

    // The next press tries it again, and this time it reads.
    failing = false;
    const second = await lookAtOlderRides(port, between);
    expect(second).toEqual({ read: 1, unreadable: 0, remaining: 0 });
    expect(stub.factsWrites).toEqual(['first', 'last', 'broken']);
  });
});
