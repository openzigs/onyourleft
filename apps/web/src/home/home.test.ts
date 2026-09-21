// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen's read budget and its arithmetic — #428.
 *
 * The app opens on this read, so its budget is the one every launch pays:
 * ONE list read and no stream decode, counted with the analysis screens' own
 * double (`analysis/testing.ts`), which records every channel and summary
 * read it is asked for.
 */

import { beatsPerMinute, metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';

import { loadHome, WEEK_SECONDS } from './home';

const OWNER = toAthleteId('athlete-a');
const DAY = 86_400;
/** 2026-09-21T12:00:00Z. */
const NOW = unixSeconds(1_790_000_000);

function ride(
  id: string,
  daysAgo: number,
  extra: Partial<Parameters<typeof stubActivity>[0]> = {},
): StubAnalysisRide {
  return {
    activity: stubActivity({
      id: activityId(id),
      name: `Ride ${id}`,
      startedAt: unixSeconds(NOW - daysAgo * DAY),
      startedAtTimeZone: 'UTC',
      movingTime: seconds(3000),
      distance: metres(30_000),
      effortWeightedPower: watts(200),
      loadCoveredTime: seconds(3600),
      ...extra,
    }),
    // Samples the home screen must never touch.
    power: Array.from({ length: 60 }, () => watts(200)),
    heartRate: Array.from({ length: 60 }, () => beatsPerMinute(140)),
  };
}

describe('the read budget — #428', () => {
  it('reads the list once and decodes no channel, over a thousand rides', async () => {
    const port = stubAnalysis(
      OWNER,
      Array.from({ length: 1000 }, (_unused, index) => ride(`r${String(index)}`, 1000 - index)),
    );

    await loadHome(port, NOW);

    expect(port.listReads).toHaveLength(1);
    expect(port.channelReads).toEqual([]);
    expect(port.summaryReads).toEqual([]);
  });

  it('bounds the read, and says when the bound bit', async () => {
    const port = stubAnalysis(OWNER, [ride('a', 3), ride('b', 2), ride('c', 1)]);
    const home = await loadHome(port, NOW, 2);
    expect(port.listReads[0]?.limit).toBe(3);
    expect(home.truncated).toBe(true);
  });
});

describe('the three states — #428', () => {
  it('has no last ride and no fitness for a rider with no rides: the empty state', async () => {
    const home = await loadHome(stubAnalysis(OWNER, []), NOW);
    expect(home.lastRide).toBeUndefined();
    expect(home.week.rides).toBe(0);
    expect(home.fitness).toEqual([]);
  });

  it('describes the one ride a rider has', async () => {
    const home = await loadHome(stubAnalysis(OWNER, [ride('only', 2)]), NOW);
    expect(home.lastRide?.name).toBe('Ride only');
    expect(home.lastRide?.movingTime).toBe(3000);
    expect(home.lastRide?.distance).toBe(30_000);
    expect(home.lastRide?.load).toBeGreaterThan(0);
    expect(home.week).toMatchObject({ rides: 1, movingTime: 3000, ridesWithLoad: 1 });
  });

  it('picks the NEWEST ride as the last one, and counts only the last seven days', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [ride('old', 30), ride('mid', 6), ride('new', 1)]),
      NOW,
    );
    expect(home.lastRide?.name).toBe('Ride new');
    expect(home.week.rides).toBe(2);
    expect(home.week.movingTime).toBe(6000);
  });

  it('draws the week line at exactly seven days', async () => {
    const edge = { startedAt: unixSeconds(NOW - WEEK_SECONDS) };
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('edge', 0, edge),
        ride('inside', 0, { startedAt: unixSeconds(NOW - WEEK_SECONDS + 1) }),
      ]),
      NOW,
    );
    expect(home.week.rides).toBe(1);
  });

  it('counts a ride with no load summary as a ride, and says the load came from fewer', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('summed', 2),
        ride('bare', 1, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
      ]),
      NOW,
    );
    expect(home.week).toMatchObject({ rides: 2, ridesWithLoad: 1 });
    expect(home.lastRide?.load).toBeUndefined();
  });

  it('carries fitness to TODAY, so a fortnight off shows as rest rather than as the day it stopped', async () => {
    const home = await loadHome(stubAnalysis(OWNER, [ride('a', 20), ride('b', 14)]), NOW);
    const last = home.fitness.at(-1);
    const onTheLastRide = home.fitness.find((point) => point.load > 0 && point === home.fitness[6]);
    expect(home.fitness.length).toBe(21);
    // Fourteen rest days later, the fast average has fallen a long way.
    expect(last?.recent).toBeLessThan((home.fitness[6]?.recent ?? 0) / 2);
    expect(onTheLastRide).toBeDefined();
  });
});
