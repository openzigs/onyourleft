// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Streaks and badges — #947, one `describe` per rule. Every case builds the
 * summaries it needs and derives from nothing else: no clock but `NOW`, no
 * read, no network.
 */

import { metres, seconds, unixSeconds, watts, type UnixSeconds } from '@onyourleft/domain';
import { activityId, routeId, type ActivitySummary, type RideFacts } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubActivity } from '../detail/testing';

import {
  BEST_POWER_DURATIONS,
  CLIMBING_MILESTONES_METRES,
  countsAsRide,
  deriveProgress,
  DISTANCE_MILESTONES_METRES,
  RIDE_MINIMUM_MOVING_SECONDS,
  weekOf,
  type Badge,
} from './progress';

const DAY = 86_400;
const WEEK = 7 * DAY;
/** 2026-09-21T12:00:00Z, a Monday. */
const NOW = unixSeconds(1_790_000_000);

let counter = 0;
function ride(
  daysAgo: number,
  extra: Partial<ActivitySummary> & { readonly rideFacts?: RideFacts } = {},
): ActivitySummary {
  counter += 1;
  return stubActivity({
    id: activityId(`ride-${String(counter)}`),
    startedAt: unixSeconds(NOW - daysAgo * DAY),
    startedAtTimeZone: 'UTC',
    movingTime: seconds(1_800),
    distance: metres(20_000),
    ...extra,
  });
}

function kinds(badges: readonly Badge[], kind: Badge['kind']): Badge[] {
  return badges.filter((badge) => badge.kind === kind);
}

describe('what counts as a ride', () => {
  it('is five minutes of moving time, and a shorter recording earns nothing', () => {
    expect(RIDE_MINIMUM_MOVING_SECONDS).toBe(300);
    expect(countsAsRide({ movingTime: seconds(300) })).toBe(true);
    expect(countsAsRide({ movingTime: seconds(299) })).toBe(false);
    const idle = deriveProgress(
      [ride(1, { movingTime: seconds(299), distance: metres(200_000) })],
      NOW,
    );
    expect(idle.rides).toBe(0);
    expect(idle.badges).toEqual([]);
    expect(idle.streak).toEqual({ current: 0, longest: 0 });
  });
});

describe('the streak — weeks with a ride', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekOf(NOW, 'UTC')).toBe(weekOf(unixSeconds(NOW + 6 * DAY), 'UTC'));
    expect(weekOf(unixSeconds(NOW - DAY), 'UTC')).toBe(weekOf(NOW, 'UTC') - 1);
  });

  it('counts consecutive weeks, and a missed day inside a week does not matter', () => {
    // This week, and each of the three before it — twice in the oldest.
    const progress = deriveProgress([ride(0), ride(6), ride(13), ride(18), ride(20)], NOW);
    expect(progress.streak).toEqual({ current: 4, longest: 4 });
  });

  it('is still alive while this week is not over, though it has no ride yet', () => {
    const progress = deriveProgress([ride(1), ride(8)], NOW);
    expect(progress.streak.current).toBe(2);
  });

  it('starts again after a week with no ride, and keeps the longest', () => {
    // Three weeks running, a gap, then last week alone.
    const rides = [ride(1), ride(8 + 7), ride(8 + 14), ride(8 + 21)];
    const progress = deriveProgress(rides, NOW);
    expect(progress.streak).toEqual({ current: 1, longest: 3 });
    // And nought, never negative, once two weeks have gone by.
    const later = deriveProgress(rides, unixSeconds(NOW + 2 * WEEK));
    expect(later.streak).toEqual({ current: 0, longest: 3 });
  });
});

describe('distance badges', () => {
  it('earns each milestone on the ride that crosses it, and not twice', () => {
    expect(DISTANCE_MILESTONES_METRES).toEqual([
      100_000, 500_000, 1_000_000, 5_000_000, 10_000_000,
    ]);
    const rides = [
      ride(30, { distance: metres(60_000) }),
      ride(20, { distance: metres(39_999) }),
      ride(10, { distance: metres(1) }),
      ride(5, { distance: metres(500_000) }),
    ];
    const distance = kinds(deriveProgress(rides, NOW).badges, 'distance');
    expect(
      distance.map((badge) => [badge.activityId, badge.kind === 'distance' && badge.metres]),
    ).toEqual([
      [rides[3]?.id, 500_000],
      [rides[2]?.id, 100_000],
    ]);
  });
});

describe('climbing badges', () => {
  it('counts only rides that recorded elevation', () => {
    expect(CLIMBING_MILESTONES_METRES).toEqual([1_000, 5_000, 10_000, 50_000]);
    const rides = [
      ride(3, { rideFacts: { ascent: metres(600) } }),
      // No elevation recorded: adds nothing, rather than nought.
      ride(2, { rideFacts: {} }),
      ride(1, { rideFacts: { ascent: metres(400) } }),
      // Past 1 000 m already: earns nothing more.
      ride(0, { rideFacts: { ascent: metres(100) } }),
    ];
    const climbing = kinds(deriveProgress(rides, NOW).badges, 'climbing');
    expect(climbing).toHaveLength(1);
    expect(climbing[0]?.activityId).toBe(rides[2]?.id);
  });
});

describe('firsts', () => {
  it('the first ride, workout finished, saved route ridden and ride against the ghost, once each', () => {
    const rides = [
      ride(9, { movingTime: seconds(120) }), // not a ride
      ride(8),
      ride(7, { rideFacts: { workoutFinished: true } }),
      ride(6, { routeId: routeId('r-1') }),
      ride(5, { rideFacts: { ghostRaced: true } }),
      ride(4, { routeId: routeId('r-1'), rideFacts: { workoutFinished: true, ghostRaced: true } }),
    ];
    const firsts = kinds(deriveProgress(rides, NOW).badges, 'first');
    expect(
      firsts.map((badge) => [badge.kind === 'first' && badge.first, badge.activityId]).reverse(),
    ).toEqual([
      ['ride', rides[1]?.id],
      ['workout', rides[2]?.id],
      ['route', rides[3]?.id],
      ['ghost', rides[4]?.id],
    ]);
  });
});

describe('new personal bests', () => {
  const best = (power: number, duration = 60): RideFacts => ({
    bestPower: [{ duration: seconds(duration), power: watts(power) }],
  });

  it('a ride that beats every earlier best earns one; the first and an equal one do not', () => {
    expect(BEST_POWER_DURATIONS).toEqual([5, 60, 300, 1_200]);
    const rides = [
      ride(4, { rideFacts: best(300) }),
      ride(3, { rideFacts: best(300) }),
      ride(2, { rideFacts: best(310) }),
      ride(1, { rideFacts: best(305) }),
    ];
    const bests = kinds(deriveProgress(rides, NOW).badges, 'best');
    expect(bests).toHaveLength(1);
    expect(bests[0]).toMatchObject({ activityId: rides[2]?.id, duration: 60, power: 310 });
  });

  it('is never claimed over a power ride nobody has read yet', () => {
    const rides = [
      ride(4, { rideFacts: best(300) }),
      ride(3, { averagePower: watts(250) }), // a power meter, saved before #947
      ride(2, { rideFacts: best(320) }),
    ];
    const progress = deriveProgress(rides, NOW);
    expect(kinds(progress.badges, 'best')).toEqual([]);
    expect(progress.unread).toBe(1);
    // Read, and lower than 320: the 320 is a new best after all.
    const read = deriveProgress(
      rides.map((each, index) => (index === 1 ? { ...each, rideFacts: best(299) } : each)),
      NOW,
    );
    expect(kinds(read.badges, 'best')).toHaveLength(1);
  });

  it('keeps each duration apart', () => {
    const rides = [
      ride(2, { rideFacts: { bestPower: [{ duration: seconds(5), power: watts(800) }] } }),
      ride(1, { rideFacts: { bestPower: [{ duration: seconds(1200), power: watts(250) }] } }),
    ];
    expect(kinds(deriveProgress(rides, NOW).badges, 'best')).toEqual([]);
  });
});

describe('order and reading', () => {
  it('lists the newest badge first, and reads summaries in any order', () => {
    const rides = [ride(2), ride(1, { distance: metres(100_000) })];
    const progress = deriveProgress([...rides].reverse(), NOW);
    expect(progress.badges[0]).toMatchObject({ kind: 'distance', activityId: rides[1]?.id });
    expect(progress.badges.at(-1)).toMatchObject({ kind: 'first', first: 'ride' });
    const at: UnixSeconds | undefined = progress.badges[0]?.earnedAt;
    expect(at).toBe(rides[1]?.startedAt);
  });
});
