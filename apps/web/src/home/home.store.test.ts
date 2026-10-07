// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Home's "Next up" (#1010) against the **real** local store (#1088).
 *
 * `home.test.ts` covers `loadHome` and `loadNextUp` over `analysis/testing.ts`'s
 * stub, which hands back whole rows — so it could not see that the store's
 * `listActivitySummaries` dropped `routeId`, and that on a real device Home
 * never offered the route the rider last rode. This file is the claim that it
 * does: the ride is written through the store, and Home's two reads run over
 * fresh connections (`@onyourleft/store/testing`'s `read` discards every open
 * handle first, CLAUDE.md §5).
 */

import { metres, unixSeconds } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  rideFor,
  seedAthletes,
  seedRoute,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { HISTORY_ACTIVITY_LIMIT } from '../analysis/history';

import { loadHome, loadNextUp } from './home';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

const NOW = unixSeconds(1_800_000_000);

describe('#1088 — Home offers the route last ridden, through the real store', () => {
  it('reads the newest ride’s routeId off the list and offers that route', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    const route = await seedRoute(open, ATHLETE_A, { name: 'The loop' });
    await open.write(async (store) => {
      await store.putActivity(rideFor(ATHLETE_A, { routeId: route.id }));
    });

    const home = await open.read((store) => loadHome({ athleteId: ATHLETE_A, store }, NOW));
    expect(home.lastRouteId).toBe(route.id);

    const next = await open.read((store) => loadNextUp(home, { athleteId: ATHLETE_A, store }));
    expect(next).toMatchObject({ kind: 'route', id: route.id, name: 'The loop' });
  });

  it('offers a free ride when the newest ride was on no route (the control)', async () => {
    const open = createStoreHarness();
    harness = open;
    await seedAthletes(open);
    await seedRoute(open, ATHLETE_A);
    await open.write(async (store) => {
      await store.putActivity(rideFor(ATHLETE_A));
    });

    const home = await open.read((store) => loadHome({ athleteId: ATHLETE_A, store }, NOW));
    expect(home.lastRouteId).toBeUndefined();
    const next = await open.read((store) => loadNextUp(home, { athleteId: ATHLETE_A, store }));
    expect(next).toEqual({ kind: 'free' });
  });
});

const WEEK = 7 * 86_400;
/** Weeks of riding at the recent end, one ride each, the newest this week. */
const RECENT_WEEKS = 12;
/**
 * About 5,020 puts to fake-indexeddb. Slowest figures: 10 972 ms under
 * coverage on CI (run 37365629277, AMD EPYC 7763, with athlete B's rides —
 * the 11.2 s this note quoted before #1154's review had no run behind it) and
 * 12.6–14.4 s locally on #1126's review. 45 s is about three times the
 * slowest, §4c's convention; 30 s was only twice it.
 */
const SEEDING_TIMEOUT_MILLISECONDS = 45_000;
/** An old ride's distance: the 5,000 of them total exactly 5,000 km. */
const OLD_RIDE_METRES = 1_000;
/** A recent ride's: the tenth, oldest first, takes the total to 10,000 km. */
const RECENT_RIDE_METRES = 500_000;
/** Athlete B's rides: older than all of A's, and newer than all of A's. */
const B_OLDER = ['b-older-0', 'b-older-1', 'b-older-2'];
const B_NEWER = ['b-newer-0', 'b-newer-1', 'b-newer-2'];

describe('#1107, #1130 — past the read budget, Home reads the NEWEST rides and the badges keep moving, through the real store', () => {
  it(
    'keeps the current streak and the last ride past 5,000 rides, earns the badges over the whole history, and reads no other athlete’s rides',
    async () => {
      const open = createStoreHarness();
      harness = open;
      await seedAthletes(open);
      // More rides than one read holds: a block of old ones a minute apart,
      // years back, then one a week for the last RECENT_WEEKS weeks.
      const old = HISTORY_ACTIVITY_LIMIT;
      const OLD_FROM = 1_500_000_000;
      await open.write(async (store) => {
        // Athlete B either side of every ride of A's (CLAUDE.md §6). A newest
        // read that dropped the owner would begin with B's newer rides, and a
        // forward walk that did would begin with B's older ones; the
        // assertions below look for B's ids in what each produced.
        for (const [index, id] of B_OLDER.entries()) {
          await store.putActivity(
            rideFor(ATHLETE_B, {
              id: activityId(id),
              name: `B ${id}`,
              startedAt: unixSeconds(OLD_FROM - 86_400 * (index + 1)),
              startedAtTimeZone: 'UTC',
            }),
          );
        }
        for (const [index, id] of B_NEWER.entries()) {
          await store.putActivity(
            rideFor(ATHLETE_B, {
              id: activityId(id),
              name: `B ${id}`,
              startedAt: unixSeconds(NOW - 60 * (index + 1)),
              startedAtTimeZone: 'UTC',
            }),
          );
        }
        for (let index = 0; index < old; index += 1) {
          await store.putActivity(
            rideFor(ATHLETE_A, {
              id: activityId(`old-${String(index).padStart(5, '0')}`),
              startedAt: unixSeconds(OLD_FROM + index * 60),
              distance: metres(OLD_RIDE_METRES),
              startedAtTimeZone: 'UTC',
            }),
          );
        }
        for (let week = RECENT_WEEKS - 1; week >= 0; week -= 1) {
          await store.putActivity(
            rideFor(ATHLETE_A, {
              id: activityId(`recent-${String(week).padStart(2, '0')}`),
              name: `Recent ${String(week)}`,
              startedAt: unixSeconds(NOW - 3_600 - week * WEEK),
              distance: metres(RECENT_RIDE_METRES),
              startedAtTimeZone: 'UTC',
            }),
          );
        }
      });

      const home = await open.read((store) => loadHome({ athleteId: ATHLETE_A, store }, NOW));

      expect(home.truncated).toBe(true);
      // The recent end, which Home is for. Read oldest-first, the last ride was
      // years ago, this week was empty and the current streak read nought.
      expect(home.lastRide?.name).toBe('Recent 0');
      expect(home.week.rides).toBe(1);
      expect(home.progress.streak.current).toBe(RECENT_WEEKS);
      // The badges are claims about the whole history: the first ride is the
      // oldest one, not the 5,000th-newest…
      const first = home.progress.badges.find(
        (badge) => badge.kind === 'first' && badge.first === 'ride',
      );
      expect(first?.activityId).toBe(activityId('old-00000'));
      const distance = (metresCrossed: number): string | undefined =>
        home.progress.badges.find(
          (badge) => badge.kind === 'distance' && badge.metres === metresCrossed,
        )?.activityId;
      expect(distance(5_000_000)).toBe(activityId('old-04999'));
      // …and they keep moving past it (#1130): 10,000 km is crossed by a ride
      // in neither the oldest 5,000 nor anything #1107 read for the badges.
      expect(distance(10_000_000)).toBe(activityId('recent-02'));
      expect(home.progress.rides).toBe(old + RECENT_WEEKS);
      // Every ride of A's, read once, oldest first.
      expect(home.summaries).toHaveLength(old + RECENT_WEEKS);
      expect(home.summaries[0]?.id).toBe(activityId('old-00000'));
      expect(home.summaries.at(-1)?.id).toBe(activityId('recent-00'));

      // Nothing of athlete B's in the rows the badges came from (the walk and
      // the newest window together), in the badges, or in the last ride.
      const theirs = new Set<string>([...B_OLDER, ...B_NEWER]);
      expect(home.summaries.filter((summary) => theirs.has(summary.id))).toEqual([]);
      expect(home.summaries.every((summary) => summary.athleteId === ATHLETE_A)).toBe(true);
      expect(home.progress.badges.filter((badge) => theirs.has(badge.activityId))).toEqual([]);
    },
    SEEDING_TIMEOUT_MILLISECONDS,
  );
});
