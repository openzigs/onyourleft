// SPDX-License-Identifier: Apache-2.0

/**
 * The rollback for schema version 4 — **export → downgrade → re-import**,
 * executed rather than described.
 *
 * ## Why it is not an `up`/`down` pair
 *
 * `migrations.ts` holds the pure-function migration contract, and version 4 has
 * no entry in the registry for the reason versions 2 and 3 have none: it adds
 * two object stores and rewrites **no** record, so there is no record
 * transformation to reverse. Writing a speculative one to have something to
 * demonstrate would put a schema change into the athlete's upgrade path that no
 * issue asked for — `migrations.ts` says so at length and this file does not
 * relitigate it.
 *
 * What #61's definition of done asks for — "local-store migration applies and
 * rolls back cleanly" — is therefore discharged in two places:
 *
 * - **applies**: `migrations.test.ts`, "version 3 to version 4", against a
 *   database with rows in it;
 * - **rolls back**: here.
 *
 * ## What "rolls back" can mean on this engine, and what it cannot
 *
 * IndexedDB has no downgrade event. `onupgradeneeded` fires only when the
 * version increases and opening at a lower version raises `VersionError`, so an
 * in-place rollback does not exist — the first test below proves that against
 * the real engine rather than asserting it. ADR 0005 section F names the path
 * that does exist:
 *
 * > The runtime rollback path is **export → downgrade → re-import**, which
 * > local-first already supports because the athlete's signed files are the
 * > canonical artefact.
 *
 * This file is the first time that sentence has been executable, and it is
 * #61's work that makes it so: the signed record **is** the canonical artefact
 * the sentence relies on. So the test is not "the rows come back" — it is that
 * the records come back **and still verify**, on a database the older build
 * created, against a verifier that never saw the newer one. A rollback that
 * returned rows a signature no longer covered would have lost the only thing
 * that made the export authoritative.
 *
 * The one thing that does **not** survive, stated plainly because it is the
 * consequence a support ticket will arrive about: **the private key does not
 * come back.** It is a non-extractable handle, so it cannot be written into an
 * export by construction — that is the same property #61's second criterion
 * asks for, seen from the other side. An athlete who downgrades keeps every
 * record they have signed, and every one of them still verifies; they cannot
 * sign a *new* record as the same identity. ADR 0014 and `README.md` record
 * that as the key-loss story, because an unanswered key-loss story becomes an
 * unanswered support ticket.
 */

import { ensureSigningKey, unixSeconds, verifyRecordSignature } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteActivityStore, openActivityStore } from './activity-store';
import { athleteId } from './ids';
import type { StoredActivityRecord } from './identity';
import type { AthleteRecord, NewActivity } from './records';
import { SCHEMA_VERSION, STORES_V1, STORES_V2, STORES_V3, TABLE } from './schema';
import { ATHLETE_A, athleteRecord, resetFixtureIds, rideFor, signedRecordFor } from './testing';
import { createWebCryptoKeystore, webCryptoVerifier } from './web-crypto';

let databaseName: string;

beforeEach(() => {
  resetFixtureIds();
  databaseName = `oyl-rollback-${String(Date.now())}-${String(Math.random()).slice(2)}`;
});

afterEach(async () => {
  await deleteActivityStore(databaseName);
});

/** What an export carries. No key material: there is none to carry. */
interface Export {
  readonly athlete: AthleteRecord | undefined;
  readonly activities: readonly NewActivity[];
  readonly records: readonly StoredActivityRecord[];
}

describe('IndexedDB has no downgrade event', () => {
  it('refuses to open at a lower version than the one on disk', async () => {
    // Asserted against the real engine rather than quoted, because everything
    // else in this file is a consequence of it. `migrations.test.ts` makes the
    // same point about a Dexie handle; this one is the raw `indexedDB.open`.
    const created = new Dexie(databaseName);
    created.version(SCHEMA_VERSION).stores(STORES_V1);
    await created.open();
    created.close();

    const refusal = await new Promise<string>((resolve) => {
      const request = indexedDB.open(databaseName, 1);
      request.onsuccess = () => {
        request.result.close();
        resolve('opened');
      };
      request.onerror = () => resolve(request.error?.name ?? 'unknown');
    });

    expect(refusal).toBe('VersionError');
  });
});

describe('export → downgrade → re-import', () => {
  it('brings every signed record back, still verifying, on a database the older build made', async () => {
    // --- 1. A version-4 device with an identity and two signed rides --------
    const owner = ATHLETE_A;
    const current = openActivityStore(databaseName);
    await current.putAthlete(athleteRecord(owner));
    const key = await ensureSigningKey(
      createWebCryptoKeystore(current, owner, { now: () => unixSeconds(1_700_000_100) }),
    );
    const rides = [rideFor(owner), rideFor(owner)];
    for (const ride of rides) {
      await current.putActivity(ride);
      await current.putActivityRecord(await signedRecordFor(ride, key));
    }

    // --- 2. Export, through the public read paths ---------------------------
    const exported: Export = {
      athlete: await current.getAthlete(owner),
      activities: await Promise.all(
        rides.map(async (ride) => (await current.getActivity(owner, ride.id)) as NewActivity),
      ),
      records: (
        await Promise.all(rides.map(async (ride) => current.getActivityRecord(owner, ride.id)))
      ).filter((row): row is StoredActivityRecord => row !== undefined),
    };
    current.close();

    // Through JSON, because an export is a file. Anything that survived only as
    // a live object reference would be gone by the time the older build read
    // it — and a `CryptoKey` is exactly such a reference, which is why no key
    // material can be in here.
    const file = JSON.stringify(exported);
    // Asserted as a round trip rather than as `not.toContain('privateKey')`,
    // which cannot fail: `Export` has no such member, so that string was a
    // grep for something the type forbids. This one **can** fail — any member
    // that survived only as a live object reference (a `CryptoKey`, a `Map`, a
    // `Date`) comes back different or not at all — which is the property the
    // comment above is actually about. The private key's absence is asserted
    // where it has bytes to look for: `identity-safety.test.ts`, and the
    // second test in this file.
    expect(JSON.parse(file)).toEqual(exported);

    // --- 3. Downgrade: the newer database is removed, and an older build's --
    //        schema is created in its place. This is what "run the previous
    //        release" looks like from the data's point of view.
    await deleteActivityStore(databaseName);
    const older = new Dexie(databaseName);
    older.version(1).stores(STORES_V1);
    older.version(2).stores(STORES_V2);
    older.version(3).stores(STORES_V3);
    await older.open();
    expect(older.verno).toBe(3);
    // The version-3 build has no store to put a signed record in. That is the
    // whole reason the export is the artefact and the database is not.
    expect(older.tables.map((table) => table.name)).not.toContain(TABLE.activityRecords);
    const reimported = JSON.parse(file) as Export;
    await older.table(TABLE.athletes).put(reimported.athlete);
    for (const activity of reimported.activities) {
      await older.table(TABLE.activities).put(activity);
    }
    older.close();

    // --- 4. Upgrade again and re-import the records through the public write
    //        path, which is what "re-import" means. Reopening at version 4 is
    //        what an athlete does by running the newer build again.
    const back = openActivityStore(databaseName);
    const activities = await back.listActivitySummaries(owner);
    expect(activities.map((activity) => activity.id).sort()).toEqual(
      rides.map((ride) => ride.id).sort(),
    );
    expect(reimported.records).toHaveLength(2);
    for (const row of reimported.records) {
      await back.putActivityRecord(row);
    }
    back.close();

    // --- 5. And they verify on a FRESH connection, read back through the same
    //        path a real consumer uses. Verifying `reimported` here instead
    //        would only prove that `JSON.parse` round-trips an object this test
    //        is still holding — the "wrong harness" shape in CLAUDE.md §5, and
    //        blind to a re-import that acknowledged the write and stored
    //        nothing.
    const reopened = openActivityStore(databaseName);
    const readBack = await Promise.all(
      rides.map(async (ride) => reopened.getActivityRecord(owner, ride.id)),
    );
    reopened.close();

    expect(readBack.filter((row) => row !== undefined)).toHaveLength(2);
    for (const row of readBack) {
      await expect(verifyRecordSignature(row?.record, webCryptoVerifier)).resolves.toMatchObject({
        status: 'verified',
      });
    }
  });

  it('cannot bring the private key back, and says so by having nowhere to put it', async () => {
    // The stated consequence, asserted rather than left to the prose: an
    // export is JSON, a non-extractable `CryptoKey` has no JSON, so the
    // identity is not in the file. Downgrading keeps every signed record and
    // loses the ability to sign a new one as the same athlete.
    const owner = athleteId('athlete-a');
    const store = openActivityStore(databaseName);
    await store.putAthlete(athleteRecord(owner));
    await ensureSigningKey(createWebCryptoKeystore(store, owner));
    const deviceKey = await store.getDeviceKey(owner);
    store.close();

    const asJson = JSON.parse(JSON.stringify(deviceKey)) as { privateKey: unknown };

    expect(asJson.privateKey).toEqual({});
  });
});
