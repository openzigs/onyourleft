// SPDX-License-Identifier: Apache-2.0

import Dexie from 'dexie';
import {
  metres,
  seconds,
  unixSeconds,
  watts,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ActivityStore,
  deleteActivityStore,
  openActivityStore,
  type ActivityRecord,
  type AthleteRecord,
  type NewActivity,
  type NewLap,
  type PrivacyZoneRecord,
} from './index';
import { activityId, athleteId, lapId, privacyZoneId } from './ids';
import { StoreReferentialError } from './errors';
import { DEFAULT_PRIVACY_ZONE_RADIUS_METRES } from './records';
import type { PersistedActivity } from './persisted';
import { TABLE, STORES_V1, SCHEMA_VERSION } from './schema';

/**
 * Two athletes in every fixture, always.
 *
 * CLAUDE.md section 6: a query that matches on an entity id without also
 * filtering on the owning athlete "passes every single-athlete test in the
 * suite". A one-athlete fixture cannot fail that way, so it is not a fixture.
 */
const ATHLETE_A = athleteId('athlete-a');
const ATHLETE_B = athleteId('athlete-b');

let databaseName: string;
let store: ActivityStore;
let counter = 0;

function athlete(id = ATHLETE_A, displayName = 'A'): AthleteRecord {
  return { id, displayName, createdAt: unixSeconds(1_700_000_000) };
}

/** An indoor trainer ride: no position data at all. The common Phase 1 case. */
function indoorRide(overrides: Partial<NewActivity> = {}): NewActivity {
  return {
    id: activityId(`activity-${String((counter += 1))}`),
    athleteId: ATHLETE_A,
    name: 'Zwift Watopia',
    startedAt: unixSeconds(1_700_100_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(4_200),
    movingTime: seconds(3_600),
    distance: metres(40_000),
    hasPosition: false,
    createdAt: unixSeconds(1_700_104_200),
    ...overrides,
  };
}

function lap(activity: NewActivity, ordinal: number, overrides: Partial<NewLap> = {}): NewLap {
  return {
    id: lapId(`lap-${activity.id}-${String(ordinal)}`),
    activityId: activity.id,
    ordinal,
    startedAt: unixSeconds(1_700_100_000 + ordinal * 600),
    elapsedTime: seconds(600),
    movingTime: seconds(590),
    distance: metres(5_000),
    ...overrides,
  };
}

/** Reopens the database and returns a fresh handle. See `close()`'s doc. */
function reopen(): ActivityStore {
  store.close();
  store = openActivityStore(databaseName);
  return store;
}

beforeEach(() => {
  counter = 0;
  databaseName = `oyl-test-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  store = openActivityStore(databaseName);
});

afterEach(async () => {
  store.close();
  await deleteActivityStore(databaseName);
});

describe('persistence — the write must be visible to a reader that was not there when it happened', () => {
  it('an activity with no position data at all survives a close and reopen', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();
    await store.putActivity(ride);

    const fresh = reopen();
    const read = await fresh.getActivity(ATHLETE_A, ride.id);

    expect(read).toBeDefined();
    expect(read?.hasPosition).toBe(false);
    expect(read?.name).toBe('Zwift Watopia');
    expect(read?.distance).toBe(40_000);
  });

  it('moving time and elapsed time survive the round trip as distinct values', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide({ elapsedTime: seconds(7_384), movingTime: seconds(6_011) });
    await store.putActivity(ride);

    const read = await reopen().getActivity(ATHLETE_A, ride.id);

    expect(read?.elapsedTime).toBe(7_384);
    expect(read?.movingTime).toBe(6_011);
    // Asserted separately from the values: equal numbers would satisfy both
    // assertions above if one field were written over the other.
    expect(read?.elapsedTime).not.toBe(read?.movingTime);
  });

  it('the absolute instant and the local time zone are both stored, and neither is derived from the other', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide({
      startedAt: unixSeconds(1_720_000_000),
      startedAtTimeZone: 'Australia/Adelaide',
    });
    await store.putActivity(ride);

    const read = await reopen().getActivity(ATHLETE_A, ride.id);

    expect(read?.startedAt).toBe(1_720_000_000);
    expect(read?.startedAtTimeZone).toBe('Australia/Adelaide');
  });

  it('laps survive a close and reopen, in ordinal order', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();
    await store.putActivity(ride);
    await store.putLap(lap(ride, 2));
    await store.putLap(lap(ride, 0));
    await store.putLap(lap(ride, 1));

    const read = await reopen().listLaps(ATHLETE_A, ride.id);

    expect(read.map((l) => l.ordinal)).toEqual([0, 1, 2]);
    expect(read[0]?.athleteId).toBe(ATHLETE_A);
  });

  it('optional quantities round trip when present and stay absent when not', async () => {
    await store.putAthlete(athlete());
    const withPower = indoorRide({ averagePower: watts(231) });
    const withoutPower = indoorRide();
    await store.putActivity(withPower);
    await store.putActivity(withoutPower);

    const fresh = reopen();

    expect((await fresh.getActivity(ATHLETE_A, withPower.id))?.averagePower).toBe(231);
    const bare = await fresh.getActivity(ATHLETE_A, withoutPower.id);
    expect(bare).toBeDefined();
    expect('averagePower' in (bare as ActivityRecord)).toBe(false);
  });

  it('writes the flattened original-file reference to disk and rebuilds it on read', async () => {
    await store.putAthlete(athlete());
    const sha256 = 'a'.repeat(64);
    const ride = indoorRide({ originalFile: { key: 'files/ride.fit', sha256 } });
    await store.putActivity(ride);
    store.close();

    // Read the raw row, not the decoded record: the compound index
    // [athleteId+originalFileSha256] can only work if the hash is a top-level
    // property, and a decoded read would hide a nested one.
    const raw = new Dexie(databaseName);
    raw.version(SCHEMA_VERSION).stores(STORES_V1);
    const row = await raw.table<PersistedActivity, string>(TABLE.activities).get(ride.id);
    raw.close();

    expect(row?.originalFileSha256).toBe(sha256);
    expect(row?.originalFileKey).toBe('files/ride.fit');
    expect(row).not.toHaveProperty('originalFile');

    store = openActivityStore(databaseName);
    expect((await store.getActivity(ATHLETE_A, ride.id))?.originalFile).toEqual({
      key: 'files/ride.fit',
      sha256,
    });
  });
});

describe('visibility — ADR 0004 decision A', () => {
  it('an activity created without a visibility is private on disk', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();
    expect(ride).not.toHaveProperty('visibility');
    await store.putActivity(ride);
    store.close();

    const raw = new Dexie(databaseName);
    raw.version(SCHEMA_VERSION).stores(STORES_V1);
    const row = await raw.table<PersistedActivity, string>(TABLE.activities).get(ride.id);
    raw.close();
    store = openActivityStore(databaseName);

    // Asserted on the stored row, not on the returned record: "the default is
    // private" is exactly the claim that silently becomes `undefined` in a
    // document store, and a decode that defaulted would hide it.
    expect(row?.visibility).toBe('private');
  });

  it('an explicit visibility is kept', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide({ visibility: 'public' });
    await store.putActivity(ride);

    expect((await reopen().getActivity(ATHLETE_A, ride.id))?.visibility).toBe('public');
  });
});

describe('referential integrity — the constraint this engine does not have', () => {
  it('refuses an activity whose athlete does not exist', async () => {
    const orphan = indoorRide();

    await expect(store.putActivity(orphan)).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('writes nothing when it refuses', async () => {
    const orphan = indoorRide();
    await expect(store.putActivity(orphan)).rejects.toThrow();

    // The athlete is created afterwards, so a row written by the refused call
    // would now be readable. Reopened, because a rolled-back transaction can
    // still leave a value in an in-process cache.
    await store.putAthlete(athlete());
    expect(await reopen().getActivity(ATHLETE_A, orphan.id)).toBeUndefined();
  });

  it('refuses a lap whose activity does not exist', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();

    await expect(store.putLap(lap(ride, 0))).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('refuses a privacy zone whose athlete does not exist', async () => {
    await expect(store.putPrivacyZone(privacyZone())).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('takes a lap’s owning athlete from its activity, not from the caller', async () => {
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const bRide = indoorRide({ athleteId: ATHLETE_B });
    await store.putActivity(bRide);
    await store.putLap(lap(bRide, 0));

    const fresh = reopen();
    expect(await fresh.listLaps(ATHLETE_A, bRide.id)).toEqual([]);
    expect((await fresh.listLaps(ATHLETE_B, bRide.id))[0]?.athleteId).toBe(ATHLETE_B);
  });
});

describe('on-delete behaviour — cascade, chosen explicitly', () => {
  it('deleting an athlete deletes their activities and laps rather than orphaning them', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();
    await store.putActivity(ride);
    await store.putLap(lap(ride, 0));
    await store.putLap(lap(ride, 1));

    const counts = await store.deleteAthlete(ATHLETE_A);
    expect(counts).toEqual({ activities: 1, laps: 2, privacyZones: 0 });

    // Re-create the athlete before reading. If the cascade had left the rows
    // behind, the scoped reads below would find them again — which is the
    // whole point: an orphan is invisible until its owner's id is reused.
    const fresh = reopen();
    await fresh.putAthlete(athlete());
    expect(await fresh.getActivity(ATHLETE_A, ride.id)).toBeUndefined();
    expect(await fresh.listLaps(ATHLETE_A, ride.id)).toEqual([]);
    expect(await fresh.listActivitySummaries(ATHLETE_A)).toEqual([]);
  });

  it('deleting an athlete deletes their privacy zones', async () => {
    await store.putAthlete(athlete());
    await store.putPrivacyZone(privacyZone());

    const counts = await store.deleteAthlete(ATHLETE_A);
    expect(counts.privacyZones).toBe(1);

    const fresh = reopen();
    await fresh.putAthlete(athlete());
    expect(await fresh.listPrivacyZones(ATHLETE_A)).toEqual([]);
  });

  it('deleting one athlete leaves the other athlete’s data completely intact', async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const aRide = indoorRide();
    const bRide = indoorRide({ athleteId: ATHLETE_B });
    await store.putActivity(aRide);
    await store.putActivity(bRide);
    await store.putLap(lap(aRide, 0));
    await store.putLap(lap(bRide, 0));
    await store.putPrivacyZone(privacyZone());
    await store.putPrivacyZone(privacyZone({ id: privacyZoneId('zone-b'), athleteId: ATHLETE_B }));

    await store.deleteAthlete(ATHLETE_A);

    const fresh = reopen();
    expect(await fresh.getAthlete(ATHLETE_B)).toBeDefined();
    expect(await fresh.getActivity(ATHLETE_B, bRide.id)).toBeDefined();
    expect(await fresh.listLaps(ATHLETE_B, bRide.id)).toHaveLength(1);
    expect(await fresh.listPrivacyZones(ATHLETE_B)).toHaveLength(1);
  });

  it('deleting an athlete who does not exist is a no-op rather than an error', async () => {
    await expect(store.deleteAthlete(ATHLETE_B)).resolves.toEqual({
      activities: 0,
      laps: 0,
      privacyZones: 0,
    });
  });

  it('deleting an activity deletes its laps', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();
    const other = indoorRide();
    await store.putActivity(ride);
    await store.putActivity(other);
    await store.putLap(lap(ride, 0));
    await store.putLap(lap(other, 0));

    expect(await store.deleteActivity(ATHLETE_A, ride.id)).toBe(true);

    const fresh = reopen();
    // The activity itself, read back through a fresh connection. Review of
    // PR #109 found that removing `#activities.delete(id)` left all 113 tests
    // green: the laps went, the method returned true, and the ride stayed on
    // disk and stayed listed. The laps were asserted; the thing the method is
    // named after was not.
    expect(await fresh.getActivity(ATHLETE_A, ride.id)).toBeUndefined();
    expect(
      (await fresh.listActivitySummaries(ATHLETE_A)).map((summary) => summary.id),
    ).not.toContain(ride.id);
    expect(await fresh.getActivity(ATHLETE_A, other.id)).toBeDefined();

    expect(await fresh.listLaps(ATHLETE_A, ride.id)).toEqual([]);
    expect(await fresh.listLaps(ATHLETE_A, other.id)).toHaveLength(1);
  });
});

describe('the checks are inside the write’s transaction, not merely before it', () => {
  // Non-blocking finding from the PR #109 review, made load-bearing. Moving
  // `#requireAthlete` outside the transaction and narrowing its scope to
  // [activities] left all 113 tests green: "refuses" and "writes nothing when it
  // refuses" are both satisfied by a check that runs outside. The atomicity that
  // is the entire stated reason for the placement was unguarded.
  //
  // Asserting a transaction's scope directly is not something Dexie exposes, so
  // this pins the observable consequence instead: the write must be able to see
  // the athletes table, and a refusal must leave nothing behind even when the
  // check and the write are interleaved with another writer.

  it('putActivity’s transaction spans athletes, so the check and the write are atomic', async () => {
    await store.putAthlete(athlete());
    const ride = indoorRide();

    // A concurrent delete of the owning athlete, racing the write. Whichever
    // order the engine picks, the store must not end up with an activity whose
    // athlete is gone — which is only guaranteed if both tables are in one
    // transaction.
    await Promise.allSettled([store.putActivity(ride), store.deleteAthlete(ATHLETE_A)]);

    const fresh = reopen();
    const orphan = await fresh.getActivity(ATHLETE_A, ride.id);
    const owner = await fresh.getAthlete(ATHLETE_A);
    expect(
      orphan === undefined || owner !== undefined,
      'an activity survived without its athlete — the check and the write were not atomic',
    ).toBe(true);
  });
});

describe('cross-athlete exposure — the WRITE path, not only the read path', () => {
  // Found in review of PR #109, and invisible to every fixture that existed:
  // `Table.put` is keyed on the primary key alone, so a second athlete writing
  // the same id silently destroyed the first athlete's row and then OWNED it —
  // which chains, because the new owner can `deleteActivity` it and take the
  // original owner's laps with it.
  //
  // A two-athlete *read* fixture cannot see this. CLAUDE.md §6 says "any
  // query"; a `put` is one, and it was being read as a rule about reads.

  it('refuses to overwrite another athlete’s activity, and leaves it intact', async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const ride = indoorRide();
    await store.putActivity(ride);

    await expect(
      store.putActivity({ ...indoorRide(), id: ride.id, athleteId: ATHLETE_B }),
    ).rejects.toThrow(StoreReferentialError);

    // The refusal is not the point — the row surviving is. Read back through a
    // fresh connection, still owned by A.
    const fresh = reopen();
    const survivor = await fresh.getActivity(ATHLETE_A, ride.id);
    expect(survivor).toBeDefined();
    expect(await fresh.getActivity(ATHLETE_B, ride.id)).toBeUndefined();
  });

  it('refuses to overwrite another athlete’s lap', async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const rideA = indoorRide();
    await store.putActivity(rideA);
    const lapA = lap(rideA, 0);
    await store.putLap(lapA);

    const rideB = indoorRide({ athleteId: ATHLETE_B });
    await store.putActivity(rideB);

    await expect(store.putLap({ ...lap(rideB, 0), id: lapA.id })).rejects.toThrow(
      StoreReferentialError,
    );

    const fresh = reopen();
    expect(await fresh.listLaps(ATHLETE_A, rideA.id)).toHaveLength(1);
  });

  it('refuses to overwrite another athlete’s privacy zone', async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const zone = privacyZone();
    await store.putPrivacyZone(zone);

    await expect(
      store.putPrivacyZone({ ...privacyZone(), id: zone.id, athleteId: ATHLETE_B }),
    ).rejects.toThrow(StoreReferentialError);

    const fresh = reopen();
    expect(await fresh.listPrivacyZones(ATHLETE_A)).toHaveLength(1);
    expect(await fresh.listPrivacyZones(ATHLETE_B)).toHaveLength(0);
  });

  it('closes the chain: B cannot take A’s activity and then delete A’s laps with it', async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    const rideA = indoorRide();
    await store.putActivity(rideA);
    await store.putLap(lap(rideA, 0));

    // Step one of the chain, now refused.
    await expect(
      store.putActivity({ ...indoorRide(), id: rideA.id, athleteId: ATHLETE_B }),
    ).rejects.toThrow(StoreReferentialError);

    // Step two therefore finds nothing of B's to delete, and A keeps both.
    expect(await store.deleteActivity(ATHLETE_B, rideA.id)).toBe(false);

    const fresh = reopen();
    expect(await fresh.getActivity(ATHLETE_A, rideA.id)).toBeDefined();
    expect(await fresh.listLaps(ATHLETE_A, rideA.id)).toHaveLength(1);
  });
});

describe('cross-athlete exposure — every read filters on the owner, not only the id', () => {
  let aRide: NewActivity;
  let bRide: NewActivity;

  beforeEach(async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    aRide = indoorRide({ name: 'A ride' });
    bRide = indoorRide({ athleteId: ATHLETE_B, name: 'B ride' });
    await store.putActivity(aRide);
    await store.putActivity(bRide);
    await store.putLap(lap(bRide, 0));
  });

  it('getActivity does not return the other athlete’s activity from its id', async () => {
    const fresh = reopen();
    expect(await fresh.getActivity(ATHLETE_B, bRide.id)).toBeDefined();
    expect(await fresh.getActivity(ATHLETE_A, bRide.id)).toBeUndefined();
  });

  it('listActivitySummaries returns only the requesting athlete’s activities', async () => {
    const names = (await reopen().listActivitySummaries(ATHLETE_A)).map((a) => a.name);
    expect(names).toEqual(['A ride']);
  });

  it('listLaps does not return the other athlete’s laps from an activity id', async () => {
    expect(await reopen().listLaps(ATHLETE_A, bRide.id)).toEqual([]);
  });

  it('deleteActivity refuses another athlete’s activity and does not delete it', async () => {
    expect(await store.deleteActivity(ATHLETE_A, bRide.id)).toBe(false);
    expect(await reopen().getActivity(ATHLETE_B, bRide.id)).toBeDefined();
  });

  it('findActivityByOriginalFileHash does not cross athletes when both imported the same file', async () => {
    const sha256 = 'b'.repeat(64);
    await store.putActivity({ ...aRide, originalFile: { key: 'a.fit', sha256 } });
    await store.putActivity({ ...bRide, originalFile: { key: 'b.fit', sha256 } });

    const fresh = reopen();
    expect((await fresh.findActivityByOriginalFileHash(ATHLETE_A, sha256))?.id).toBe(aRide.id);
    expect((await fresh.findActivityByOriginalFileHash(ATHLETE_B, sha256))?.id).toBe(bRide.id);
  });

  it('findActivityByOriginalFileHash returns nothing for a hash nobody stored', async () => {
    expect(await store.findActivityByOriginalFileHash(ATHLETE_A, 'c'.repeat(64))).toBeUndefined();
  });

  it('listPrivacyZones returns only the requesting athlete’s zones', async () => {
    await store.putPrivacyZone(privacyZone());
    await store.putPrivacyZone(privacyZone({ id: privacyZoneId('zone-b'), athleteId: ATHLETE_B }));

    const fresh = reopen();
    expect((await fresh.listPrivacyZones(ATHLETE_A)).map((z) => z.id)).toEqual(['zone-a']);
    expect((await fresh.listPrivacyZones(ATHLETE_B)).map((z) => z.id)).toEqual(['zone-b']);
  });
});

describe('listActivitySummaries', () => {
  beforeEach(async () => {
    await store.putAthlete(athlete());
    await store.putAthlete(athlete(ATHLETE_B, 'B'));
    await store.putActivity(
      indoorRide({
        id: activityId('old-short'),
        startedAt: unixSeconds(100),
        distance: metres(1_000),
      }),
    );
    await store.putActivity(
      indoorRide({
        id: activityId('new-long'),
        startedAt: unixSeconds(300),
        distance: metres(9_000),
      }),
    );
    await store.putActivity(
      indoorRide({ id: activityId('mid'), startedAt: unixSeconds(200), distance: metres(5_000) }),
    );
    // The other athlete's rides sit either side of every boundary above, so a
    // range query that forgot the athlete component would pick them up.
    await store.putActivity(
      indoorRide({
        id: activityId('b-first'),
        athleteId: ATHLETE_B,
        startedAt: unixSeconds(50),
        distance: metres(500),
      }),
    );
    await store.putActivity(
      indoorRide({
        id: activityId('b-last'),
        athleteId: ATHLETE_B,
        startedAt: unixSeconds(999),
        distance: metres(99_000),
      }),
    );
  });

  it('orders by start time, newest first, by default', async () => {
    const ids = (await reopen().listActivitySummaries(ATHLETE_A)).map((a) => a.id);
    expect(ids).toEqual(['new-long', 'mid', 'old-short']);
  });

  it('orders by start time ascending when asked', async () => {
    const ids = (await store.listActivitySummaries(ATHLETE_A, { direction: 'ascending' })).map(
      (a) => a.id,
    );
    expect(ids).toEqual(['old-short', 'mid', 'new-long']);
  });

  it('orders by distance', async () => {
    const ids = (
      await store.listActivitySummaries(ATHLETE_A, { orderBy: 'distance', direction: 'ascending' })
    ).map((a) => a.id);
    expect(ids).toEqual(['old-short', 'mid', 'new-long']);
  });

  it('paginates with offset and limit', async () => {
    const page = await store.listActivitySummaries(ATHLETE_A, { offset: 1, limit: 1 });
    expect(page.map((a) => a.id)).toEqual(['mid']);
  });

  it('breaks ties deterministically when two activities start at the same instant', async () => {
    await store.putActivity(
      indoorRide({ id: activityId('tie-b'), startedAt: unixSeconds(500), distance: metres(1) }),
    );
    await store.putActivity(
      indoorRide({ id: activityId('tie-a'), startedAt: unixSeconds(500), distance: metres(1) }),
    );

    const first = (await store.listActivitySummaries(ATHLETE_A, { direction: 'ascending' })).map(
      (a) => a.id,
    );
    const second = (
      await reopen().listActivitySummaries(ATHLETE_A, { direction: 'ascending' })
    ).map((a) => a.id);

    expect(first).toEqual(second);
    expect(first.slice(-2)).toEqual(['tie-a', 'tie-b']);
  });

  it('never returns the original-file reference on a list row', async () => {
    await store.putActivity(
      indoorRide({
        id: activityId('with-file'),
        originalFile: { key: 'k', sha256: 'd'.repeat(64) },
        averagePower: watts(212),
      }),
    );

    const rows = await reopen().listActivitySummaries(ATHLETE_A);
    for (const row of rows) {
      expect(row).not.toHaveProperty('originalFile');
    }
    const withFile = rows.find((r) => r.id === 'with-file');
    expect(withFile).toBeDefined();
    // The summary keeps what a list row renders — power among it — and drops
    // only what belongs to the detail view.
    expect(withFile?.averagePower).toBe(212);
    expect(rows.filter((r) => r.averagePower === undefined)).toHaveLength(3);
  });

  it('rejects an order it does not have an index for, including an inherited key', async () => {
    await expect(
      store.listActivitySummaries(ATHLETE_A, { orderBy: 'nonsense' as never }),
    ).rejects.toThrow(/orderBy must be one of/);
    // `'__proto__'` on a plain object literal answers with `Object.prototype`,
    // and Dexie's `where()` accepts an object as a criteria specification.
    await expect(
      store.listActivitySummaries(ATHLETE_A, { orderBy: '__proto__' as never }),
    ).rejects.toThrow(/orderBy must be one of/);
  });

  it('rejects a negative or fractional offset and limit', async () => {
    await expect(store.listActivitySummaries(ATHLETE_A, { offset: -1 })).rejects.toThrow(
      /offset must be a non-negative integer/,
    );
    await expect(store.listActivitySummaries(ATHLETE_A, { limit: 1.5 })).rejects.toThrow(
      /limit must be a non-negative integer/,
    );
  });
});

describe('athletes and privacy zones', () => {
  it('an athlete round trips', async () => {
    await store.putAthlete(athlete());
    expect(await reopen().getAthlete(ATHLETE_A)).toEqual(athlete());
  });

  it('an athlete who was never stored reads as undefined', async () => {
    expect(await store.getAthlete(ATHLETE_B)).toBeUndefined();
  });

  it('a privacy zone round trips, centre included', async () => {
    await store.putAthlete(athlete());
    await store.putPrivacyZone(privacyZone());

    const [zone] = await reopen().listPrivacyZones(ATHLETE_A);
    expect(zone?.centre.latitude).toBeCloseTo(51.5007, 6);
    expect(zone?.centre.longitude).toBeCloseTo(-0.1246, 6);
    expect(zone?.radius).toBe(DEFAULT_PRIVACY_ZONE_RADIUS_METRES);
  });

  it('reports the schema version it opened at', () => {
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

function privacyZone(overrides: Partial<PrivacyZoneRecord> = {}): PrivacyZoneRecord {
  return {
    id: privacyZoneId('zone-a'),
    athleteId: ATHLETE_A,
    centre: geographicPosition(degreesLatitude(51.5007), degreesLongitude(-0.1246)),
    radius: metres(DEFAULT_PRIVACY_ZONE_RADIUS_METRES),
    label: 'home',
    createdAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}
