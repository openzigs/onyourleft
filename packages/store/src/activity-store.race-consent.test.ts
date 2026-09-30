// SPDX-License-Identifier: Apache-2.0

/**
 * The **consent-scoped** store test of ADR 0021 D-5.3, and the fake that
 * proves it can fail (#793, ADR 0039 D-2.3).
 *
 * ADR 0021 split `activity-store.ghost-scope.test.ts`'s double duty in two.
 * That file is the PATENT control — only the rider's own rides may source a
 * ghost — and stays exactly as it is until #331, in a later pull request. This
 * file is the PRIVACY half, built first: a cross-rider read that returns
 * another rider's ride **only when that rider said it may be raced**, and
 * never the requester's own.
 *
 * Three athletes, for `activity-store.scoping.test.ts`'s reason: with one other
 * rider, "the consented rides" and "every other rider's rides" can be the same
 * set, and the broken read passes. So B consents on one ride and not on
 * another, C consents on theirs, and A — the requester — consents on theirs
 * too, which the read must still leave out.
 *
 * ⚠️ **The red half is the point.** It runs the same seed and the same call
 * against `consentIgnoredStoreFactory`, whose read forgets the flag, and
 * requires the unconsented ride to appear. Delete
 * `.filter((row) => row.mayBeRaced === true)` from `listRaceableAttempts` and
 * the green half goes red — the mutation recorded in #793's pull request.
 *
 * Every read here is on a connection the writes never touched (the harness's
 * `read`), which is CLAUDE.md §5's "wrong harness" cause closed.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { activityId, type RouteId } from './ids';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  consentIgnoredStoreFactory,
  createStoreHarness,
  routeFor,
  seedAthletes,
  seedRide,
  type StoreFactory,
  type StoreHarness,
} from './testing';
import { unixSeconds } from '@onyourleft/domain';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/**
 * Four riders' rides on one route. Only `b-yes` and `c-yes` may be offered to
 * A: `b-public-no` is SHARED with everybody and never consented, which is the
 * case ADR 0021 D-5.1 exists for; `a-yes` is A's own.
 */
async function seedConsentWorld(factory?: StoreFactory): Promise<{
  readonly where: StoreHarness;
  readonly route: RouteId;
}> {
  const where = createStoreHarness(factory === undefined ? {} : { factory });
  harness = where;
  await seedAthletes(where);
  const route = routeFor(ATHLETE_A);
  await where.write(async (store) => {
    await store.putRoute(route);
  });
  await seedRide(where, ATHLETE_A, {
    id: activityId('a-yes'),
    routeId: route.id,
    mayBeRaced: true,
  });
  await seedRide(where, ATHLETE_B, {
    id: activityId('b-yes'),
    routeId: route.id,
    mayBeRaced: true,
    startedAt: unixSeconds(1_700_000_100),
  });
  await seedRide(where, ATHLETE_B, {
    id: activityId('b-public-no'),
    routeId: route.id,
    visibility: 'public',
  });
  await seedRide(where, ATHLETE_C, {
    id: activityId('c-yes'),
    routeId: route.id,
    mayBeRaced: true,
    startedAt: unixSeconds(1_700_000_200),
  });
  return { where, route: route.id };
}

describe('a cross-rider ghost needs its rider’s consent — ADR 0021 D-5.1', () => {
  it('returns only other riders’ consented rides, newest first', async () => {
    const { where, route } = await seedConsentWorld();

    const raceable = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }),
    );

    expect(raceable.map((ride) => ride.id)).toStrictEqual(['c-yes', 'b-yes']);
    expect(raceable.every((ride) => ride.mayBeRaced)).toBe(true);
  });

  it('never offers a ride that is shared but not consented', async () => {
    const { where, route } = await seedConsentWorld();

    const raceable = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }),
    );

    expect(raceable.map((ride) => ride.id)).not.toContain('b-public-no');
  });

  it('leaves the requester’s own rides out, consented or not', async () => {
    const { where, route } = await seedConsentWorld();

    const forB = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_B }),
    );

    // A's consented ride and C's, and none of B's own.
    expect(forB.map((ride) => ride.id).sort()).toStrictEqual(['a-yes', 'c-yes']);
    expect(forB.some((ride) => ride.athleteId === ATHLETE_B)).toBe(false);
  });

  it('offers a stranger’s unconsented ride when the read forgets the flag', async () => {
    // The same seed, the same call, a store whose read ignores `mayBeRaced`.
    const { where, route } = await seedConsentWorld(consentIgnoredStoreFactory());

    const leaked = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }),
    );

    expect(leaked.map((ride) => ride.id)).toContain('b-public-no');
    // And still not A's own: the fake is wrong about exactly one thing.
    expect(leaked.map((ride) => ride.id)).not.toContain('a-yes');
  });
});

describe('the consent is off by default and revocable', () => {
  it('is off on a ride that never set it, read back on a fresh connection', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    await seedRide(harness, ATHLETE_B, { id: activityId('b-plain') });

    const ride = await harness.read(async (store) =>
      store.getActivity(ATHLETE_B, activityId('b-plain')),
    );

    expect(ride?.mayBeRaced).toBe(false);
  });

  it('turns on and off through the narrow write, and the read follows', async () => {
    const { where, route } = await seedConsentWorld();

    await expect(
      where.write(async (store) =>
        store.setActivityMayBeRaced(ATHLETE_B, activityId('b-public-no'), true),
      ),
    ).resolves.toBe(true);
    await expect(
      where.write(async (store) =>
        store.setActivityMayBeRaced(ATHLETE_C, activityId('c-yes'), false),
      ),
    ).resolves.toBe(true);

    const raceable = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }),
    );
    expect(raceable.map((ride) => ride.id).sort()).toStrictEqual(['b-public-no', 'b-yes']);
    const revoked = await where.read(async (store) =>
      store.getActivity(ATHLETE_C, activityId('c-yes')),
    );
    expect(revoked?.mayBeRaced).toBe(false);
    // Nothing else about the ride moved.
    expect(revoked?.routeId).toBe(route);
  });

  it('will not set another athlete’s consent', async () => {
    const { where } = await seedConsentWorld();

    await expect(
      where.write(async (store) =>
        store.setActivityMayBeRaced(ATHLETE_A, activityId('b-public-no'), true),
      ),
    ).resolves.toBe(false);

    const still = await where.read(async (store) =>
      store.getActivity(ATHLETE_B, activityId('b-public-no')),
    );
    expect(still?.mayBeRaced).toBe(false);
  });

  it('refuses a consent that is not a boolean, and a limit that is not a positive integer', async () => {
    const { where, route } = await seedConsentWorld();

    await expect(
      where.write(async (store) =>
        store.setActivityMayBeRaced(ATHLETE_B, activityId('b-yes'), 'yes' as unknown as boolean),
      ),
    ).rejects.toThrow(/true or false/u);
    await expect(
      where.read(async (store) => store.listRaceableAttempts({ route, requester: ATHLETE_A }, 0)),
    ).rejects.toThrow(/positive integer/u);
  });

  it('orders two rides that started together by id, so the list is stable', async () => {
    const { where, route } = await seedConsentWorld();
    await seedRide(where, ATHLETE_C, {
      id: activityId('c-also'),
      routeId: route,
      mayBeRaced: true,
      startedAt: unixSeconds(1_700_000_200),
    });

    const raceable = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }),
    );

    expect(raceable.map((ride) => ride.id)).toStrictEqual(['c-also', 'c-yes', 'b-yes']);
  });

  it('bounds the list at the limit, keeping the newest', async () => {
    const { where, route } = await seedConsentWorld();

    const one = await where.read(async (store) =>
      store.listRaceableAttempts({ route, requester: ATHLETE_A }, 1),
    );

    expect(one.map((ride) => ride.id)).toStrictEqual(['c-yes']);
  });
});
