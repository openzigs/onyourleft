// SPDX-License-Identifier: Apache-2.0

/**
 * #93's fifth acceptance criterion, and the fake that proves the assertion can
 * see it fail.
 *
 * > *"A test asserts only the current rider's own activities can source a ghost
 * > — the query filters on rider identity, not just route id. This names the
 * > failure being prevented: a lookup matching on route alone would happily
 * > return someone else's ride, and it would pass every single-rider test in the
 * > suite."*
 *
 * The last clause is the whole design of this file. Every assertion below seeds
 * **two** athletes onto the **same** route, because with one athlete in the
 * fixture the correct query and the broken one are indistinguishable — they
 * return the same rows, in the same order, and a suite of them certifies the
 * bug. So the green half runs against the real store and the red half runs the
 * *same assertion body* against `unscopedAttemptStoreFactory`, which is the one
 * fake in `fakes.ts` that breaks a read rather than a write.
 *
 * ⚠️ The red half is not decoration. Delete the `owner` component from
 * `listRouteAttempts`' `.equals([owner, route])` and the green half goes red —
 * that is the mutation recorded in this branch's pull request. Delete the red
 * half instead and nothing tells you whether the green half was ever capable of
 * failing.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { activityId, routeId, type RouteId } from './ids';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  routeFor,
  seedAthletes,
  seedRide,
  unscopedAttemptStoreFactory,
  type StoreHarness,
} from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/**
 * Both athletes ride the same route. A returns two attempts, B returns one, and
 * the ids are distinct so a leak is identifiable rather than merely a wrong
 * count.
 */
async function seedTwoRidersOnOneRoute(where: StoreHarness): Promise<RouteId> {
  await seedAthletes(where);
  const route = routeFor(ATHLETE_A);
  await where.write(async (store) => {
    await store.putRoute(route);
  });
  await seedRide(where, ATHLETE_A, { id: activityId('a-first'), routeId: route.id });
  await seedRide(where, ATHLETE_A, { id: activityId('a-second'), routeId: route.id });
  await seedRide(where, ATHLETE_B, { id: activityId('b-only'), routeId: route.id });
  return route.id;
}

describe('a ghost can only come from the rider who rode it', () => {
  it('returns this athlete’s attempts and not the other athlete’s', async () => {
    harness = createStoreHarness();
    const SHARED_ROUTE = await seedTwoRidersOnOneRoute(harness);

    const mine = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_A, SHARED_ROUTE),
    );

    expect(mine.map((ride) => ride.id).sort()).toEqual(['a-first', 'a-second']);
    // Stated separately from the equality above, because that assertion would
    // still pass if a future change made the list longer in a way that happened
    // to sort the stranger's ride out of the first two.
    expect(mine.some((ride) => ride.athleteId !== ATHLETE_A)).toBe(false);
    expect(mine.map((ride) => ride.id)).not.toContain('b-only');
  });

  it('gives the other athlete only their own attempt on the same route', async () => {
    harness = createStoreHarness();
    const SHARED_ROUTE = await seedTwoRidersOnOneRoute(harness);

    const theirs = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_B, SHARED_ROUTE),
    );

    expect(theirs.map((ride) => ride.id)).toEqual(['b-only']);
  });

  it('leaks the other athlete’s ride when the query forgets the rider', async () => {
    // The same seed, the same call, a store whose lookup matches on route alone.
    // This is what a `'routeId'` index would have given us.
    harness = createStoreHarness({ factory: unscopedAttemptStoreFactory() });
    const SHARED_ROUTE = await seedTwoRidersOnOneRoute(harness);

    const leaked = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_A, SHARED_ROUTE),
    );

    expect(leaked.map((ride) => ride.id)).toContain('b-only');
    expect(leaked.some((ride) => ride.athleteId === ATHLETE_B)).toBe(true);
  });
});

describe('the bounds and the absent cases', () => {
  it('returns nothing for a route this athlete has never ridden', async () => {
    harness = createStoreHarness();
    // Seeded and then deliberately not named: the point is that a *populated*
    // store answers "nothing" for a route this athlete never rode, rather than
    // an empty one trivially answering nothing.
    await seedTwoRidersOnOneRoute(harness);

    const none = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_A, routeId('never-ridden')),
    );

    expect(none).toEqual([]);
  });

  it('returns nothing rather than throwing when the route no longer exists', async () => {
    // `records.ts` §`routeId` records that nothing cascades: the ride happened,
    // and a dangling link means no ghost is offered.
    harness = createStoreHarness();
    const SHARED_ROUTE = await seedTwoRidersOnOneRoute(harness);
    await harness.write(async (store) => store.deleteRoute(ATHLETE_A, SHARED_ROUTE));

    const stillThere = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_A, SHARED_ROUTE),
    );

    // The rides survive the route's deletion; it is the *offer* that disappears,
    // and that decision belongs to the screen rather than to the store.
    expect(stillThere.map((ride) => ride.id).sort()).toEqual(['a-first', 'a-second']);
  });

  it('never returns a free ride, which has no route at all', async () => {
    harness = createStoreHarness();
    const SHARED_ROUTE = await seedTwoRidersOnOneRoute(harness);
    await seedRide(harness, ATHLETE_A, { id: activityId('a-free-ride') });

    const attempts = await harness.read(async (store) =>
      store.listRouteAttempts(ATHLETE_A, SHARED_ROUTE),
    );

    expect(attempts.map((ride) => ride.id)).not.toContain('a-free-ride');
  });

  it('refuses a limit that is not a positive integer', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);

    await expect(
      harness.read(async (store) => store.listRouteAttempts(ATHLETE_A, routeId('any'), 0)),
    ).rejects.toThrow(/positive integer/u);
  });
});
