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

import { unixSeconds } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';
import {
  ATHLETE_A,
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
 * 1.8 s of case time locally (5,012 puts to fake-indexeddb). Coverage slows a
 * loop like this about three times on CI, which would pass Vitest's 5 s.
 */
const SEEDING_TIMEOUT_MILLISECONDS = 30_000;

describe('#1107 — past the read budget, Home reads the NEWEST rides, through the real store', () => {
  it(
    'keeps the current streak and the last ride past 5,000 rides, and takes the badges from the oldest',
    async () => {
      const open = createStoreHarness();
      harness = open;
      await seedAthletes(open);
      // More rides than one read holds: a block of old ones a minute apart,
      // years back, then one a week for the last RECENT_WEEKS weeks.
      const old = HISTORY_ACTIVITY_LIMIT;
      const OLD_FROM = 1_500_000_000;
      await open.write(async (store) => {
        for (let index = 0; index < old; index += 1) {
          await store.putActivity(
            rideFor(ATHLETE_A, {
              id: activityId(`old-${String(index).padStart(5, '0')}`),
              startedAt: unixSeconds(OLD_FROM + index * 60),
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
      // The badges are claims about the whole history, so they come from the
      // oldest window: the first ride is the oldest one, not the 5,000th-newest.
      const first = home.progress.badges.find(
        (badge) => badge.kind === 'first' && badge.first === 'ride',
      );
      expect(first?.activityId).toBe(activityId('old-00000'));
      expect(home.summaries[0]?.id).toBe(activityId('old-00000'));
    },
    SEEDING_TIMEOUT_MILLISECONDS,
  );
});
