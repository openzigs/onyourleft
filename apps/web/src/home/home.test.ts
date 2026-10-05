// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home screen's read budget and its arithmetic — #428.
 *
 * The app opens on this read, so its budget is the one every launch pays:
 * ONE list read and no stream decode, counted with the analysis screens' own
 * double (`analysis/testing.ts`), which records every channel and summary
 * read it is asked for.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId, type RouteRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import type { RoutePort } from '../routes/store-port';
import { routeStub, stubRouteId } from '../routes/testing';

import { loadHome, loadNextUp, PROGRESS_PAGE_LIMIT, WEEK_DAYS, type HomeLastRide } from './home';

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

/** Any last ride: `loadNextUp` reads only whether there is one. */
const anyRide: HomeLastRide = {
  name: 'Ride',
  startedAt: NOW,
  timeZone: 'UTC',
  movingTime: seconds(60),
  distance: metres(100),
  load: undefined,
  noLoadToWorkOut: false,
};

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

  it('reads the NEWEST rides, so the bound drops the oldest — #1107', async () => {
    const port = stubAnalysis(OWNER, [ride('a', 30), ride('b', 2), ride('c', 1)]);
    const home = await loadHome(port, NOW, 2);
    expect(port.listReads[0]).toMatchObject({ orderBy: 'startedAt', direction: 'descending' });
    expect(home.lastRide?.name).toBe('Ride c');
    expect(home.week.rides).toBe(2);
  });

  it('past the bound, walks forward from the oldest ride to the newest window, reading each ride once — #1107, #1130', async () => {
    const port = stubAnalysis(OWNER, [ride('a', 30), ride('b', 2), ride('c', 1)]);
    const home = await loadHome(port, NOW, 2);
    // The newest window [b, c], then one forward page [a, b] that reaches it.
    expect(port.listReads).toHaveLength(2);
    expect(port.listReads[1]).toMatchObject({
      orderBy: 'startedAt',
      direction: 'ascending',
      limit: 2,
    });
    expect(port.channelReads).toEqual([]);
    const first = home.progress.badges.find(
      (badge) => badge.kind === 'first' && badge.first === 'ride',
    );
    expect(first?.activityId).toBe(activityId('a'));
    expect(home.progress.rides).toBe(3);
    expect(home.summaries.map((summary) => summary.id)).toEqual([
      activityId('a'),
      activityId('b'),
      activityId('c'),
    ]);
  });

  it('keeps the badges moving past the bound: a total crossed in the newest window is earned — #1130', async () => {
    // 30 km a ride, so the fourth crosses 100 km — and with a bound of two,
    // the fourth is in neither the oldest window nor any ride #1107 read for
    // the badges.
    const port = stubAnalysis(OWNER, [ride('a', 40), ride('b', 30), ride('c', 2), ride('d', 1)]);
    const home = await loadHome(port, NOW, 2);

    const hundred = home.progress.badges.find(
      (badge) => badge.kind === 'distance' && badge.metres === 100_000,
    );
    expect(hundred?.activityId).toBe(activityId('d'));
    expect(home.progress.rides).toBe(4);
    // The newest window, then two forward pages: [a, b], and [c, d] reaching it.
    expect(port.listReads).toHaveLength(3);
    expect(port.listReads[2]).toMatchObject({
      direction: 'ascending',
      startedAfter: NOW - 30 * DAY,
      afterActivityId: activityId('b'),
      limit: 2,
    });
  });

  it('stops the walk at PROGRESS_PAGE_LIMIT reads, and falls back to the two windows — #1130', async () => {
    const rides = Array.from({ length: PROGRESS_PAGE_LIMIT + 3 }, (_unused, index) =>
      ride(`r${String(index).padStart(2, '0')}`, 100 - index),
    );
    const port = stubAnalysis(OWNER, rides);
    const home = await loadHome(port, NOW, 1);

    expect(port.listReads).toHaveLength(1 + PROGRESS_PAGE_LIMIT);
    // The badges from the pages the walk read, as #1107's oldest window.
    expect(home.summaries).toHaveLength(PROGRESS_PAGE_LIMIT);
    expect(home.summaries[0]?.id).toBe(activityId('r00'));
    const first = home.progress.badges.find(
      (badge) => badge.kind === 'first' && badge.first === 'ride',
    );
    expect(first?.activityId).toBe(activityId('r00'));
  });

  it('makes no second read inside the bound (the control)', async () => {
    const port = stubAnalysis(OWNER, [ride('a', 30), ride('b', 2), ride('c', 1)]);
    const home = await loadHome(port, NOW, 3);
    expect(port.listReads).toHaveLength(1);
    expect(home.truncated).toBe(false);
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

  it('counts the DAYS ridden in the last seven, not the rides — #939', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('old', 9),
        ride('six', 6.5),
        ride('twoA', 2.2),
        ride('twoB', 2.1),
        ride('today', 0.1),
      ]),
      NOW,
    );
    expect(home.week.rides).toBe(4);
    expect(home.week.daysRidden).toBe(3);
  });

  // #939's review (N1): the sentence says DAYS, so a day is a calendar day in
  // the ride's own zone and not a 24-hour slice counted back from `now`.
  const TUESDAY_NOON = unixSeconds(Date.UTC(2026, 8, 22, 12) / 1000);
  const HOUR = 3600;
  const at = (id: string, hoursBeforeNoon: number, timeZone = 'UTC'): StubAnalysisRide =>
    ride(id, 0, {
      startedAt: unixSeconds(TUESDAY_NOON - hoursBeforeNoon * HOUR),
      startedAtTimeZone: timeZone,
    });

  it('counts Monday 22:00 and Tuesday 08:00 as two days, though they are ten hours apart', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [at('monday', 14), at('tuesday', 4)]),
      TUESDAY_NOON,
    );
    expect(home.week.daysRidden).toBe(2);
  });

  it('counts two rides on one calendar day as one day, though they straddle 24 hours back', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [at('monday-morning', 25), at('monday-afternoon', 23)]),
      TUESDAY_NOON,
    );
    expect(home.week.daysRidden).toBe(1);
  });

  it('reads the day in the zone the ride started in', async () => {
    // 03:00 UTC on Tuesday is 20:00 on Monday in Los Angeles.
    const home = await loadHome(
      stubAnalysis(OWNER, [at('evening', 9, 'America/Los_Angeles'), at('later', 8, 'UTC')]),
      TUESDAY_NOON,
    );
    expect(home.week.daysRidden).toBe(2);
  });

  it('counts today and the six days before it, and not the seventh', async () => {
    // Wednesday 2026-09-16 is six days back; Tuesday 2026-09-15 is seven.
    const home = await loadHome(
      stubAnalysis(OWNER, [at('six-back', 6 * 24 + 11), at('seven-back', 7 * 24 - 11)]),
      TUESDAY_NOON,
    );
    expect(home.week.daysRidden).toBe(1);
    // #939's second review: the seventh day back is not a ride either — the
    // count and the ring read one window.
    expect(home.week.rides).toBe(1);
    expect(home.week.movingTime).toBe(3000);
  });

  it('never counts a ride the days ring does not: 157 h ago is neither — #939 second review', async () => {
    const home = await loadHome(stubAnalysis(OWNER, [at('157h', 7 * 24 - 11)]), TUESDAY_NOON);
    expect(home.week).toMatchObject({ rides: 0, daysRidden: 0, movingTime: 0, load: 0 });
  });

  it('rides nothing on a day it has nothing for', async () => {
    const home = await loadHome(stubAnalysis(OWNER, [ride('old', 30)]), NOW);
    expect(home.week.daysRidden).toBe(0);
  });

  it('draws the week line at midnight starting the sixth day back, in the ride’s zone', async () => {
    // TUESDAY_NOON is 2026-09-22; the sixth day back opens at 2026-09-16T00:00Z.
    const sixthDayOpens = Date.UTC(2026, 8, 16) / 1000;
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('edge', 0, { startedAt: unixSeconds(sixthDayOpens - 1) }),
        ride('inside', 0, { startedAt: unixSeconds(sixthDayOpens) }),
      ]),
      TUESDAY_NOON,
    );
    expect(home.week).toMatchObject({ rides: 1, daysRidden: 1 });
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

/**
 * #939's second review: the panel says "You rode on N of the last seven days"
 * above "Rides M", so the two must read one window. Over many clocks, zones
 * (a DST change among them) and offsets, against an independent reading of
 * each ride's calendar day through `Intl`.
 */
describe('one window for the ride count and the days ring — #939', () => {
  const ZONES = [
    'UTC',
    'Europe/London', // BST ends 2026-10-25 01:00 UTC
    'America/Los_Angeles', // PDT ends 2026-11-01 09:00 UTC
    'Australia/Lord_Howe', // a half-hour DST change, 2026-10-04
    'Pacific/Kiritimati', // UTC+14
    'Pacific/Pago_Pago', // UTC−11
  ] as const;

  /** `YYYY-MM-DD` in `zone`, read through `Intl` rather than `localDay`. */
  const dateIn = (instant: number, zone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant * 1000));
  const daysBetween = (earlier: string, later: string): number =>
    Math.round((Date.parse(later) - Date.parse(earlier)) / (DAY * 1000));

  /** A small deterministic generator, so a red run is reproducible. */
  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }

  const HOUR = 3600;
  // Each boundary the review named, a second either side of it, and 7*24−11 h.
  const EDGES_HOURS = [
    0,
    1 / HOUR,
    6 * 24,
    7 * 24 - 11,
    7 * 24 - 1 / HOUR,
    7 * 24,
    7 * 24 + 1 / HOUR,
    8 * 24,
  ];

  // Clocks around the two DST changes and an ordinary week, at awkward hours.
  const CLOCKS = [
    Date.UTC(2026, 8, 22, 12),
    Date.UTC(2026, 9, 25, 0, 30),
    Date.UTC(2026, 9, 25, 1, 30),
    Date.UTC(2026, 9, 31, 23, 59),
    Date.UTC(2026, 10, 1, 9, 30),
    Date.UTC(2026, 9, 4, 15, 45),
    Date.UTC(2026, 9, 28, 23, 0),
  ].map((ms) => ms / 1000);

  it('rides > 0 implies days ≥ 1, days ≤ 7, days ≤ rides, and both match the calendar', async () => {
    const random = generator(939);
    let cases = 0;
    for (const now of CLOCKS) {
      for (let trial = 0; trial < 60; trial += 1) {
        const count = 1 + Math.floor(random() * 6);
        const rides: StubAnalysisRide[] = [];
        for (let index = 0; index < count; index += 1) {
          const zone = ZONES[Math.floor(random() * ZONES.length)] ?? 'UTC';
          const hoursBack =
            random() < 0.4
              ? (EDGES_HOURS[Math.floor(random() * EDGES_HOURS.length)] ?? 0) +
                (random() < 0.5 ? 0 : (random() - 0.5) * 2)
              : random() * 9 * 24;
          rides.push(
            ride(`t${String(trial)}-${String(index)}`, 0, {
              startedAt: unixSeconds(Math.round(now - hoursBack * HOUR)),
              startedAtTimeZone: zone,
            }),
          );
        }
        // The store hands them back oldest first.
        rides.sort((a, b) => a.activity.startedAt - b.activity.startedAt);
        const home = await loadHome(stubAnalysis(OWNER, rides), unixSeconds(now));
        const { rides: counted, daysRidden } = home.week;

        const inWindow = rides
          .map(({ activity }) => ({
            started: activity.startedAt,
            back: daysBetween(
              dateIn(activity.startedAt, activity.startedAtTimeZone),
              dateIn(now, activity.startedAtTimeZone),
            ),
          }))
          .filter(({ started, back }) => started <= now && back >= 0 && back < WEEK_DAYS);
        const where = `now ${String(now)}, rides ${JSON.stringify(rides.map((r) => [r.activity.startedAt, r.activity.startedAtTimeZone]))}`;

        expect(counted, where).toBe(inWindow.length);
        expect(daysRidden, where).toBe(new Set(inWindow.map(({ back }) => back)).size);
        if (counted > 0) expect(daysRidden, where).toBeGreaterThanOrEqual(1);
        expect(daysRidden, where).toBeLessThanOrEqual(WEEK_DAYS);
        expect(daysRidden, where).toBeLessThanOrEqual(counted);
        // The sentence and the count: "0 of the last seven days" above a ride,
        // or a day ridden with no ride, is the contradiction.
        expect(counted === 0, where).toBe(daysRidden === 0);
        cases += 1;
      }
    }
    expect(cases).toBe(CLOCKS.length * 60);
  });

  it('holds at 7 × 24 − 11 h in every zone, at every clock', async () => {
    for (const now of CLOCKS) {
      for (const zone of ZONES) {
        const started = now - (7 * 24 - 11) * HOUR;
        const home = await loadHome(
          stubAnalysis(OWNER, [
            ride('edge', 0, { startedAt: unixSeconds(started), startedAtTimeZone: zone }),
          ]),
          unixSeconds(now),
        );
        const back = daysBetween(dateIn(started, zone), dateIn(now, zone));
        const expected = back < WEEK_DAYS ? 1 : 0;
        expect(home.week, `${zone} at ${String(now)}`).toMatchObject({
          rides: expected,
          daysRidden: expected,
        });
      }
    }
  });
});

describe('the week before — #1010', () => {
  it('counts days seven to thirteen back, and neither this week nor the fourteenth day', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('fourteen', 14),
        ride('thirteen', 13),
        ride('seven', 7),
        ride('six', 6),
        ride('today', 0, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
      ]),
      NOW,
    );
    expect(home.week.rides).toBe(2);
    expect(home.previousWeek.rides).toBe(2);
    expect(home.previousWeek.movingTime).toBe(6000);
    expect(home.previousWeek.ridesWithLoad).toBe(2);
    expect(home.previousWeek.load).toBeGreaterThan(0);
  });

  it('says the week before carried fewer loads than rides when one had none', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('a', 8, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
        ride('b', 9),
      ]),
      NOW,
    );
    expect(home.previousWeek).toMatchObject({ rides: 2, ridesWithLoad: 1 });
  });
});

describe('next up — #1010', () => {
  const ROUTE_ID = stubRouteId('hill');

  function savedRoute(createdBy = OWNER): RouteRecord {
    const points: RoutePoint[] = [0, 500, 1000].map((along) => ({
      position: geographicPosition(
        degreesLatitude(51.5 + along / 111_195),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10 + along / 50),
    }));
    return {
      id: ROUTE_ID,
      createdBy,
      name: 'Hill',
      profile: routeProfile(points),
      visibility: 'private',
      createdAt: unixSeconds(1_700_000_000),
      updatedAt: unixSeconds(1_700_000_000),
    };
  }

  /** A route port that counts its reads. */
  function counting(routes: RoutePort): { port: RoutePort; reads: string[] } {
    const reads: string[] = [];
    return {
      reads,
      port: {
        athleteId: routes.athleteId,
        store: {
          ...routes.store,
          getRoute: (owner, id) => {
            reads.push(`getRoute ${owner} ${id}`);
            return routes.store.getRoute(owner, id);
          },
          listRoutes: (owner, limit) => {
            reads.push('listRoutes');
            return routes.store.listRoutes(owner, limit);
          },
        },
      },
    };
  }

  it('finds the NEWEST ride on a route from the summaries, with no read of its own', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('old', 5, { routeId: stubRouteId('older') }),
        ride('mid', 3, { routeId: ROUTE_ID }),
        ride('new', 1),
      ]),
      NOW,
    );
    expect(home.lastRouteId).toBe(ROUTE_ID);
  });

  it('offers that route, with ONE record read scoped to the athlete', async () => {
    const { port, reads } = counting(routeStub(OWNER, [savedRoute()]));
    const next = await loadNextUp({ lastRide: anyRide, lastRouteId: ROUTE_ID }, port);
    expect(next).toMatchObject({ kind: 'route', id: ROUTE_ID, name: 'Hill' });
    expect(reads).toEqual([`getRoute ${OWNER} ${ROUTE_ID}`]);
  });

  it('is the first ride with no ride, and a free ride with no route, reading nothing', async () => {
    const { port, reads } = counting(routeStub(OWNER, [savedRoute()]));
    expect(await loadNextUp({ lastRide: undefined, lastRouteId: ROUTE_ID }, port)).toEqual({
      kind: 'first',
    });
    expect(await loadNextUp({ lastRide: anyRide, lastRouteId: undefined }, port)).toEqual({
      kind: 'free',
    });
    expect(await loadNextUp({ lastRide: anyRide, lastRouteId: ROUTE_ID }, undefined)).toEqual({
      kind: 'free',
    });
    expect(reads).toEqual([]);
  });

  it('is a free ride when the route is gone, another athlete’s, or cannot be read', async () => {
    expect(
      await loadNextUp({ lastRide: anyRide, lastRouteId: ROUTE_ID }, routeStub(OWNER)),
    ).toEqual({ kind: 'free' });
    expect(
      await loadNextUp(
        { lastRide: anyRide, lastRouteId: ROUTE_ID },
        routeStub(OWNER, [savedRoute(toAthleteId('athlete-b'))]),
      ),
    ).toEqual({ kind: 'free' });
    const broken = routeStub(OWNER, [savedRoute()]);
    expect(
      await loadNextUp(
        { lastRide: anyRide, lastRouteId: ROUTE_ID },
        {
          athleteId: OWNER,
          store: { ...broken.store, getRoute: () => Promise.reject(new Error('no store')) },
        },
      ),
    ).toEqual({ kind: 'free' });
  });
});

describe('a ride that can never have a load — #1084', () => {
  it('tells "nothing to work out" apart from "not worked out yet"', async () => {
    const marked = await loadHome(
      stubAnalysis(OWNER, [
        ride('marked', 1, { effortWeightedPower: undefined, loadCoveredTime: seconds(0) }),
      ]),
      NOW,
    );
    expect(marked.lastRide?.load).toBeUndefined();
    expect(marked.lastRide?.noLoadToWorkOut).toBe(true);
    expect(marked.loadsToWorkOut).toBe(0);
    // No invented zero in the week either: a ride, and no ride with a load.
    expect(marked.week.rides).toBe(1);
    expect(marked.week.ridesWithLoad).toBe(0);

    const bare = await loadHome(
      stubAnalysis(OWNER, [
        ride('bare', 1, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
      ]),
      NOW,
    );
    expect(bare.lastRide?.load).toBeUndefined();
    expect(bare.lastRide?.noLoadToWorkOut).toBe(false);
    expect(bare.loadsToWorkOut).toBe(1);
  });

  it('reads a stale 0 W ride as still to work out until the backfill marks it', async () => {
    const stale = await loadHome(
      stubAnalysis(OWNER, [ride('stale', 1, { effortWeightedPower: watts(0) })]),
      NOW,
    );
    expect(stale.lastRide?.noLoadToWorkOut).toBe(false);
    expect(stale.loadsToWorkOut).toBe(1);
  });

  it('counts only the rides the backfill could still work out', async () => {
    const home = await loadHome(
      stubAnalysis(OWNER, [
        ride('loaded', 3),
        ride('marked', 2, { effortWeightedPower: undefined, loadCoveredTime: seconds(0) }),
        ride('bare', 1, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
      ]),
      NOW,
    );
    expect(home.loadsToWorkOut).toBe(1);
  });
});
