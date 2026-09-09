// SPDX-License-Identifier: Apache-2.0

/**
 * Route persistence (#89 criterion 6) — the round trip, the athlete scope, the
 * independence from any activity, and the executed rollback.
 *
 * > Profiles are stored locally and survive an app restart — the test writes
 * > through the public API, discards the session, and reads back through the
 * > same path a rider would.
 *
 * "Discards the session" is the harness's own primitive and not a paraphrase:
 * `roundTrip`'s read closes every open handle before it opens another, so a
 * value still in memory cannot serve it.
 */

import { metres } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  assertRouteRoundTrip,
  createStoreHarness,
  memoryWriteStoreFactory,
  openedLoopStoreFactory,
  publishedRouteStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  rideFor,
  routeFor,
  seedAthletes,
  seedRoute,
  type StoreHarness,
} from './testing';
import { deleteActivityStore, openActivityStore } from './activity-store';
import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { routeId } from './ids';
import { fromPersistedRoute, toPersistedRoute } from './persisted';
import type { RouteRecord } from './records';
import { SCHEMA_VERSIONS, STORES_V6, TABLE } from './schema';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('the round trip — #89 criterion 6', () => {
  it('writes a route, discards every connection, and reads back the same one', async () => {
    await seedAthletes(harness);
    const route = routeFor(ATHLETE_A);
    const read = await assertRouteRoundTrip(harness, route);
    expect(read.profile.loop).toBe(true);
    expect(read.profile.elevations).toHaveLength(route.profile.elevations.length);
    expect(read.profile.totalDistance).toBeGreaterThan(1500);
  });

  it('keeps a point-to-point route point-to-point', async () => {
    await seedAthletes(harness);
    const read = await assertRouteRoundTrip(harness, routeFor(ATHLETE_A, { loop: false }));
    expect(read.profile.loop).toBe(false);
  });

  it('goes red against a store that writes to memory', async () => {
    const fake = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(fake);
      await expect(assertRouteRoundTrip(fake, routeFor(ATHLETE_A))).rejects.toThrow(
        RoundTripFailure,
      );
    } finally {
      await fake.destroy();
    }
  });

  it('goes red against a store that loses the loop flag on its way in', async () => {
    // The eighth fake, and #89's. Every array is right to the last bit and the
    // route no longer wraps — which is the whole of criterion 5 gone, silently.
    const fake = createStoreHarness({ factory: openedLoopStoreFactory() });
    try {
      await seedAthletes(fake);
      await expect(assertRouteRoundTrip(fake, routeFor(ATHLETE_A))).rejects.toThrow(
        RoundTripFailure,
      );
    } finally {
      await fake.destroy();
    }
  });

  it('the loop-losing fake gets everything BUT the loop right', async () => {
    // Stated as its own assertion so the fake is known to be subtle rather than
    // merely broken. A fake that also mangled the path would prove nothing
    // about the one-bit comparison.
    const fake = createStoreHarness({ factory: openedLoopStoreFactory() });
    try {
      await seedAthletes(fake);
      const route = routeFor(ATHLETE_A);
      const read = await fake.roundTrip(
        async (store) => store.putRoute(route),
        async (store) => store.getRoute(ATHLETE_A, route.id),
      );
      expect(read?.id).toBe(route.id);
      expect(read?.name).toBe(route.name);
      expect(read?.profile.totalDistance).toBe(route.profile.totalDistance);
      expect(read?.profile.totalAscent).toBe(route.profile.totalAscent);
      expect(read?.profile.elevations).toEqual(route.profile.elevations);
      expect(read?.profile.grades).toEqual(route.profile.grades);
      expect(read?.profile.positions).toEqual(route.profile.positions);
      // And the one bit that is wrong.
      expect(read?.profile.loop).toBe(false);
    } finally {
      await fake.destroy();
    }
  });
});

describe('visibility — #73 criterion 4', () => {
  it('is private on a route nobody chose a visibility for', async () => {
    // "Defaults are the setting almost everyone keeps." ADR 0004 decision A,
    // and it bites harder here than for a ride: a route's start is usually the
    // athlete's front door and there is no trimming that leaves it a route.
    await seedAthletes(harness);
    const read = await assertRouteRoundTrip(harness, routeFor(ATHLETE_A));
    expect(read.visibility).toBe('private');
  });

  it('round trips a route the rider deliberately made public', async () => {
    await seedAthletes(harness);
    const read = await assertRouteRoundTrip(harness, routeFor(ATHLETE_A, { visibility: 'public' }));
    expect(read.visibility).toBe('public');
  });

  it('goes red against a store that publishes a private route', async () => {
    // The ninth fake. Three characters different, everything else exact.
    const fake = createStoreHarness({ factory: publishedRouteStoreFactory() });
    try {
      await seedAthletes(fake);
      await expect(assertRouteRoundTrip(fake, routeFor(ATHLETE_A))).rejects.toThrow(
        RoundTripFailure,
      );
    } finally {
      await fake.destroy();
    }
  });

  it('the publishing fake gets everything BUT the visibility right', async () => {
    const fake = createStoreHarness({ factory: publishedRouteStoreFactory() });
    try {
      await seedAthletes(fake);
      const route = routeFor(ATHLETE_A);
      const read = await fake.roundTrip(
        async (store) => store.putRoute(route),
        async (store) => store.getRoute(ATHLETE_A, route.id),
      );
      expect(read?.name).toBe(route.name);
      expect(read?.profile.loop).toBe(route.profile.loop);
      expect(read?.profile.positions).toEqual(route.profile.positions);
      expect(read?.profile.grades).toEqual(route.profile.grades);
      // And the three characters that are not.
      expect(read?.visibility).toBe('public');
    } finally {
      await fake.destroy();
    }
  });

  it('reads a row written before the field existed as private, not as undefined', () => {
    // #89 shipped the routes store; #73 added this field one release later. A
    // row written by that build has no concept of sharing, and the only honest
    // reading of it is the closed one.
    const row = toPersistedRoute(routeFor(ATHLETE_A, { visibility: 'public' }));
    const beforeTheField: Record<string, unknown> = { ...row };
    delete beforeTheField['visibility'];
    expect(fromPersistedRoute(beforeTheField as unknown as typeof row).visibility).toBe('private');
  });

  it('round-trips the elevation source through a fresh handle', async () => {
    // ⚠️ #72's first criterion is about the STORE, not the screen: "both the
    // source name and its resolution are stored with the route". A field the
    // screen computes and the store drops would satisfy every assertion a
    // builder test could make and lose the thing that makes two routes
    // comparable.
    await seedAthletes(harness);
    const route: RouteRecord = {
      ...routeFor(ATHLETE_A),
      elevation: {
        dataset: 'Copernicus DEM GLO-30',
        resolution: metres(30),
        interval: metres(30),
        missing: metres(0),
      },
    };
    const read = await assertRouteRoundTrip(harness, route);
    expect(read.elevation).toStrictEqual(route.elevation);
  });

  it('reads a route saved before the field existed as having no known source', () => {
    // ⚠️ Absent means "nobody recorded a source", NOT "the default source".
    // Substituting a plausible dataset here would destroy exactly the
    // distinction #72 needs the field for — and it is why this field is read
    // faithfully where `visibility` two tests down is substituted.
    const row = toPersistedRoute(routeFor(ATHLETE_A));
    expect(fromPersistedRoute(row).elevation).toBeUndefined();
  });

  it('refuses a half-written elevation source rather than inventing the rest', () => {
    const row = toPersistedRoute({
      ...routeFor(ATHLETE_A),
      elevation: {
        dataset: 'Copernicus DEM GLO-30',
        resolution: metres(30),
        interval: metres(30),
        missing: metres(0),
      },
    });
    const partial: Record<string, unknown> = { ...row };
    delete partial['elevationResolution'];
    // The message names WHICH field is missing, which is what a partial write
    // needs said about it.
    expect(() => fromPersistedRoute(partial as unknown as typeof row)).toThrow(
      /route\.elevationResolution/,
    );
  });

  it('still refuses a value that is present and unrecognised', () => {
    // Absence is a pre-field row. A bad value is corruption, and coercing it
    // would hide the bad write that produced it.
    const row = toPersistedRoute(routeFor(ATHLETE_A));
    expect(() => fromPersistedRoute({ ...row, visibility: 'everyone' })).toThrow(
      StoreValidationError,
    );
  });
});

describe('the athlete scope', () => {
  it('does not answer another athlete’s route id', async () => {
    // CLAUDE.md section 6: a query matching an entity id without also filtering
    // on the owner "passes every single-athlete test in the suite".
    await seedAthletes(harness);
    const route = await seedRoute(harness, ATHLETE_A);
    expect(
      await harness.read(async (store) => store.getRoute(ATHLETE_B, route.id)),
    ).toBeUndefined();
    expect(await harness.read(async (store) => store.getRoute(ATHLETE_A, route.id))).toBeDefined();
  });

  it('refuses to let one athlete overwrite another’s route', async () => {
    await seedAthletes(harness);
    const route = await seedRoute(harness, ATHLETE_A);
    await expect(
      harness.write(async (store) => store.putRoute({ ...route, createdBy: ATHLETE_B })),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses a route whose athlete does not exist', async () => {
    await expect(
      harness.write(async (store) => store.putRoute(routeFor(ATHLETE_A))),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('reports a delete of somebody else’s route exactly as a delete of no route', async () => {
    // Reporting them differently would answer "does athlete A have a route with
    // this id" to athlete B.
    await seedAthletes(harness);
    const route = await seedRoute(harness, ATHLETE_A);
    expect(await harness.write(async (store) => store.deleteRoute(ATHLETE_B, route.id))).toBe(
      false,
    );
    expect(
      await harness.write(async (store) => store.deleteRoute(ATHLETE_B, routeId('never-existed'))),
    ).toBe(false);
    expect(await harness.write(async (store) => store.deleteRoute(ATHLETE_A, route.id))).toBe(true);
  });

  it('lists only this athlete’s routes, newest first, within the caller’s limit', async () => {
    await seedAthletes(harness);
    await seedRoute(harness, ATHLETE_A, { name: 'First' });
    await seedRoute(harness, ATHLETE_B, { name: 'Not yours' });
    await seedRoute(harness, ATHLETE_A, { name: 'Second' });
    const mine = await harness.read(async (store) => store.listRoutes(ATHLETE_A));
    expect(mine.map((route) => route.name)).toEqual(['Second', 'First']);
    const bounded = await harness.read(async (store) => store.listRoutes(ATHLETE_A, 1));
    expect(bounded).toHaveLength(1);
  });
});

describe('what a route outlives', () => {
  it('survives the deletion of every activity the athlete has', async () => {
    // A route holds no reference to an activity — it was imported from a file,
    // not cut from a ride — so tidying a library cannot remove one.
    await seedAthletes(harness);
    const ride = rideFor(ATHLETE_A);
    await harness.write(async (store) => store.putActivity(ride));
    const route = await seedRoute(harness, ATHLETE_A);
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    expect(await harness.read(async (store) => store.getRoute(ATHLETE_A, route.id))).toBeDefined();
  });

  it('does NOT survive the erasure of the athlete, and is counted', async () => {
    // A saved route is a line through the places somebody rides, which is
    // location data about them in ADR 0004's sense.
    await seedAthletes(harness);
    await seedRoute(harness, ATHLETE_A);
    await seedRoute(harness, ATHLETE_A);
    const survivor = await seedRoute(harness, ATHLETE_B);
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.routes).toBe(2);
    expect(await harness.read(async (store) => store.listRoutes(ATHLETE_A))).toEqual([]);
    // And the erasure was scoped: athlete B still has theirs.
    expect(
      await harness.read(async (store) => store.getRoute(ATHLETE_B, survivor.id)),
    ).toBeDefined();
  });
});

describe('a row on disk this build cannot read', () => {
  it('names the four lengths rather than failing at sample 1', () => {
    const row = toPersistedRoute(routeFor(ATHLETE_A));
    const truncated = { ...row, grades: row.grades.slice(0, -1) };
    expect(() => fromPersistedRoute(truncated)).toThrow(StoreDecodeError);
    expect(() => fromPersistedRoute(truncated)).toThrow(/disagree in length/);
  });

  it('refuses a profile of fewer than two samples', () => {
    const row = toPersistedRoute(routeFor(ATHLETE_A));
    const single = {
      ...row,
      latitudes: row.latitudes.slice(0, 1),
      longitudes: row.longitudes.slice(0, 1),
      elevations: row.elevations.slice(0, 1),
      grades: row.grades.slice(0, 1),
    };
    expect(() => fromPersistedRoute(single)).toThrow(/at least two samples/);
  });

  it('keeps an edited route’s updatedAt distinct from its createdAt', () => {
    // ⚠️ Added because a mutation came back GREEN: deleting the `updatedAt`
    // comparison from `assertRouteRoundTrip` left the whole suite passing, so
    // that line was proving nothing. The fixture's default has the two equal,
    // which is exactly the value a decoder that dropped the field would produce
    // — so nothing could tell the difference. This pins an edited route, where
    // they differ, and the fallback in `fromPersistedRoute` is the code it
    // guards.
    const edited = routeFor(ATHLETE_A, { updatedAt: 1_700_000_900 });
    const back = fromPersistedRoute(toPersistedRoute(edited));
    expect(back.updatedAt).toBe(edited.updatedAt);
    expect(back.updatedAt).not.toBe(back.createdAt);
  });

  it('reads a row written before updatedAt existed as its createdAt', () => {
    const row = toPersistedRoute(routeFor(ATHLETE_A, { updatedAt: 1_700_000_900 }));
    const beforeTheField: Record<string, unknown> = { ...row };
    delete beforeTheField['updatedAt'];
    const back = fromPersistedRoute(beforeTheField as unknown as typeof row);
    // A route nobody has edited was last written when it was created.
    expect(back.updatedAt).toBe(back.createdAt);
  });

  it('round trips through the persisted shape and back unchanged', () => {
    const route = routeFor(ATHLETE_A);
    const back = fromPersistedRoute(toPersistedRoute(route));
    expect(back).toEqual(route);
  });
});

describe('the version 7 → 6 rollback', () => {
  let priorName: string;

  beforeEach(() => {
    priorName = `oyl-route-rollback-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  });

  afterEach(async () => {
    await deleteActivityStore(priorName);
  });

  it('the prior schema opens at version 6 with no routes table', async () => {
    const prior = new Dexie(priorName);
    SCHEMA_VERSIONS.slice(0, 6).forEach((stores, index) => {
      prior.version(index + 1).stores(stores);
    });
    await prior.open();
    try {
      expect(prior.verno).toBe(6);
      const names = prior.tables.map((table) => table.name).sort();
      expect(names).not.toContain(TABLE.routes);
      for (const declared of Object.keys(STORES_V6)) {
        expect(names).toContain(declared);
      }
      // Derived from the declarations rather than written as a literal, so the
      // count cannot go stale the next time a version adds a store.
      const priorStores = new Set(
        SCHEMA_VERSIONS.slice(0, 6).flatMap((stores) => Object.keys(stores)),
      );
      expect(names).toHaveLength(priorStores.size);
    } finally {
      prior.close();
    }
  });

  it('export → downgrade → re-import keeps every version-6 record and drops the routes', async () => {
    const current = openActivityStore(priorName);
    await current.open();
    const ride = rideFor(ATHLETE_A);
    await current.putAthlete({ id: ATHLETE_A, displayName: 'A', createdAt: ride.createdAt });
    await current.putActivity(ride);
    await current.putRoute(routeFor(ATHLETE_A));
    await current.putRoute(routeFor(ATHLETE_A));
    expect(await current.listRoutes(ATHLETE_A)).toHaveLength(2);

    const exportedAthlete = await current.getAthlete(ATHLETE_A);
    const exportedRide = await current.getActivity(ATHLETE_A, ride.id);
    current.close();

    // Downgrade: erase and reopen at the prior schema. IndexedDB has no
    // downgrade event, so this is the runtime path — export, downgrade,
    // re-import — and not a shortcut around one.
    await deleteActivityStore(priorName);
    const prior = new Dexie(priorName);
    SCHEMA_VERSIONS.slice(0, 6).forEach((stores, index) => {
      prior.version(index + 1).stores(stores);
    });
    await prior.open();
    try {
      expect(prior.tables.map((table) => table.name)).not.toContain(TABLE.routes);
      await prior.table(TABLE.athletes).put({
        id: exportedAthlete?.id,
        displayName: exportedAthlete?.displayName,
        createdAt: exportedAthlete?.createdAt,
      });
      expect(await prior.table(TABLE.athletes).get(ATHLETE_A)).toBeDefined();
      expect(exportedRide?.id).toBe(ride.id);
    } finally {
      prior.close();
    }
  });
});
