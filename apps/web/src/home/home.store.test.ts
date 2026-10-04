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
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  seedRoute,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

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
