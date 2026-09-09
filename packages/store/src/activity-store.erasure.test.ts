// SPDX-License-Identifier: Apache-2.0

/**
 * **Deleting an athlete leaves nothing of theirs, and everything of everyone
 * else's.**
 *
 * [#35](https://github.com/openzigs/onyourleft/issues/35)'s fourth acceptance
 * criterion, in the shape a local-first store can have it:
 *
 * > A test enumerates every table containing athlete-scoped data and asserts
 * > each is empty for that athlete after deletion — **with the enumeration
 * > derived from the schema**, so a table added later by #12 or #13 fails the
 * > test rather than being silently missed.
 *
 * #35's revision block says the local half of that issue is already delivered
 * and this file should not duplicate it. It does not: #62 deletes one
 * *activity* from the local store. Nothing until now asserted the *athlete*
 * cascade against anything but a hand-written list of tables, and a
 * hand-written list is exactly what that criterion rules out.
 *
 * ## Why the enumeration is the whole point
 *
 * `deleteAthlete` names fifteen tables. Every one of them was added by hand, in
 * the pull request that added the table, by somebody who remembered. Schema
 * version 9 is the ninth time that had to happen, and the failure mode when it
 * does not is silent: the row survives under an athlete id that no longer
 * exists, no scoped read can reach it, and it sits on the device holding
 * whatever it held — for `streamBlobs` and `recordingChunks`, a GPS trace of
 * where a person who asked to be erased lives.
 *
 * So the table list here comes from `SCHEMA_VERSIONS`, merged the way Dexie
 * merges it. A table added in a future version is in this test the moment it is
 * in the schema, and it fails until the cascade covers it or the test is told
 * why it holds nothing athlete-scoped.
 *
 * ⚠️ **`UNSCOPED_TABLES` is the escape hatch and it is deliberately awkward.**
 * A table listed there is claimed to hold nothing belonging to an athlete. That
 * claim is checked rather than believed: the test asserts such a table really
 * has no row carrying an athlete key, so mislabelling one to silence a failure
 * turns a different assertion red. There are none today.
 *
 * ## Read through a second connection, not through the writer
 *
 * The counts come from a raw Dexie handle opened on the same database — the
 * `packages/store` pattern for reading what actually landed, used by
 * `migrations.test.ts` and three others. Counting through `ActivityStore`'s own
 * scoped reads would ask the code under test whether it deleted the rows, which
 * is the "wrong harness" cause in `CLAUDE.md` section 5: a read filtered by the
 * same predicate as the delete returns nothing either way.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSIONS } from './schema';
import type { AthleteId } from './ids';
import { privacyZoneId } from './ids';
import type { MatchCheckpointRecord, PrivacyZoneRecord } from './records';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  ATHLETES,
  chunksOf,
  createStoreHarness,
  effortFor,
  extractableDeviceKey,
  FIXTURE_EPOCH,
  lapFor,
  recordingFor,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  segmentFor,
  signedRecordFor,
  streamSetFor,
  workoutFor,
} from './testing';
import type { StoreHarness } from './testing';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '@onyourleft/domain';

const SAMPLE_COUNT = 60;
const CHUNK_SAMPLES = 30;

/**
 * The keys a row uses to say whose it is.
 *
 * Three rather than one because the store genuinely uses three: `athleteId` on
 * most rows, `createdBy` on a segment and a workout, and the primary key itself
 * on `athletes` and `deviceKeys`, which are keyed *by* the athlete.
 */
const ATHLETE_KEYS = ['athleteId', 'createdBy'] as const;

/**
 * Tables whose primary key **is** the athlete id, so a row belongs to whoever
 * it is keyed by and carries no separate column saying so.
 */
const KEYED_BY_ATHLETE = new Set(['athletes', 'deviceKeys', 'matchCheckpoints']);

/**
 * Tables claimed to hold nothing athlete-scoped. Empty, and the assertion below
 * checks the claim rather than taking it.
 */
const UNSCOPED_TABLES: readonly string[] = [];

/** Every table the schema has ever declared, the way Dexie merges the versions. */
function tablesInSchema(): readonly string[] {
  const names = new Set<string>();
  for (const version of SCHEMA_VERSIONS) {
    for (const table of Object.keys(version)) {
      names.add(table);
    }
  }
  return [...names].sort();
}

/** Which athlete a row belongs to, or `undefined` if it says nothing about one. */
function ownerOfRow(table: string, key: unknown, row: Record<string, unknown>): string | undefined {
  for (const field of ATHLETE_KEYS) {
    const value = row[field];
    if (typeof value === 'string') {
      return value;
    }
  }
  if (KEYED_BY_ATHLETE.has(table) && typeof key === 'string') {
    return key;
  }
  return undefined;
}

/** Everything one athlete owns, written through the public path. */
async function seedEverything(harness: StoreHarness, owner: AthleteId): Promise<void> {
  const route = routeFor(owner);
  const workout = workoutFor(owner);
  const segment = segmentFor(owner);
  const ride = rideFor(owner, { routeId: route.id, hasPosition: true });
  const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
  const recording = recordingFor(owner);
  const chunks = chunksOf(recording, streams, CHUNK_SAMPLES);
  const zone: PrivacyZoneRecord = {
    id: privacyZoneId(`zone-${owner}`),
    athleteId: owner,
    centre: geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(FIXTURE_EPOCH),
  };
  const checkpoint: MatchCheckpointRecord = {
    athleteId: owner,
    lastStartedAt: ride.startedAt,
    lastActivityId: ride.id,
    swept: 1,
    updatedAt: unixSeconds(FIXTURE_EPOCH),
  };
  const { record: deviceKey, key } = await extractableDeviceKey(owner);
  const signed = await signedRecordFor(ride, key);

  await harness.write(async (store) => {
    await store.putRoute(route);
    await store.putWorkout(workout);
    await store.putSegment(segment);
    await store.putActivity(ride);
    await store.putStreamSet(streams);
    await store.putLap(lapFor(ride, 1));
    await store.putPrivacyZone(zone);
    await store.putActivityEfforts(owner, ride.id, [effortFor(owner, segment.id, ride.id)]);
    await store.putRecordingSession(recording);
    for (const chunk of chunks) {
      await store.appendRecordingChunk(chunk);
    }
    await store.putDeviceKey(deviceKey);
    await store.putActivityRecord(signed);
    await store.putMatchCheckpoint(checkpoint);
  });
}

/** Rows per athlete, per table, read through a connection nothing wrote on. */
async function censusOf(databaseName: string): Promise<Map<string, Map<string, number>>> {
  const database = new Dexie(databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    database.version(index + 1).stores(stores);
  });
  await database.open();
  try {
    const census = new Map<string, Map<string, number>>();
    for (const table of tablesInSchema()) {
      const counts = new Map<string, number>();
      await database.table(table).each((row: unknown, cursor) => {
        const owner = ownerOfRow(table, cursor.primaryKey, row as Record<string, unknown>);
        if (owner !== undefined) {
          counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
      });
      census.set(table, counts);
    }
    return census;
  } finally {
    database.close();
  }
}

describe('the erasure enumeration comes from the schema', () => {
  it('finds tables at all', () => {
    // Twelve stores existed at version 7 and two arrived after it. A derivation
    // that returned nothing would make every assertion below vacuous.
    expect(tablesInSchema().length).toBeGreaterThanOrEqual(14);
  });

  it('claims no table is unscoped without that being checked', () => {
    // The escape hatch exists; nothing uses it. If something ever does, the
    // assertion in "every table is athlete-scoped" is what checks the claim.
    expect(UNSCOPED_TABLES).toStrictEqual([]);
  });
});

describe('deleting an athlete leaves nothing of theirs in any table', () => {
  let harness: StoreHarness;

  beforeEach(async () => {
    resetFixtureIds();
    harness = createStoreHarness();
    await seedAthletes(harness);
    for (const athlete of ATHLETES) {
      await seedEverything(harness, athlete);
    }
  });

  afterEach(async () => {
    await harness.destroy();
  });

  it('every table in the schema holds rows for every athlete before deletion', async () => {
    // Without this, "empty afterwards" passes for a table the fixture never
    // filled — the vacuous half of an erasure test, and the reason a criterion
    // that only checks emptiness afterwards is not enough.
    await harness.discard();
    const census = await censusOf(harness.databaseName);

    const unseeded = tablesInSchema().filter(
      (table) => !UNSCOPED_TABLES.includes(table) && (census.get(table)?.get(ATHLETE_A) ?? 0) === 0,
    );
    expect(
      unseeded,
      'this table has no row for ATHLETE_A, so an emptiness check on it would prove nothing',
    ).toStrictEqual([]);
  });

  it('every table is empty for the deleted athlete', async () => {
    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    await harness.discard();
    const census = await censusOf(harness.databaseName);

    const remaining = tablesInSchema().filter(
      (table) => (census.get(table)?.get(ATHLETE_A) ?? 0) > 0,
    );
    expect(
      remaining,
      'this table still holds rows for an athlete who asked to be erased',
    ).toStrictEqual([]);
  });

  it('no other athlete loses a single row', async () => {
    await harness.discard();
    const before = await censusOf(harness.databaseName);

    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    await harness.discard();
    const after = await censusOf(harness.databaseName);

    // Both survivors, not one: with a single other athlete, "B kept their rows"
    // and "the delete did nothing to anybody but A" are the same statement, and
    // a cascade keyed on the wrong athlete would satisfy the weaker one.
    for (const survivor of [ATHLETE_B, ATHLETE_C]) {
      for (const table of tablesInSchema()) {
        expect(
          after.get(table)?.get(survivor) ?? 0,
          `${table} lost rows belonging to ${survivor}`,
        ).toBe(before.get(table)?.get(survivor) ?? 0);
      }
    }
  });

  it('is idempotent — a retry after a crash is not an error', async () => {
    const first = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    const second = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));

    expect(first.activities).toBeGreaterThan(0);
    // Every count zero, without naming the fields: a count added to
    // `AthleteDeletionCounts` later is covered without editing this line.
    expect(Object.values(second).filter((count) => count !== 0)).toStrictEqual([]);
  });

  it('every row in every table says whose it is', async () => {
    // The claim `UNSCOPED_TABLES` would make, checked for every table rather
    // than only the ones that use it: a row that names no athlete cannot be
    // erased by an athlete-scoped cascade, whatever the cascade does.
    await harness.discard();
    const database = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      database.version(index + 1).stores(stores);
    });
    await database.open();
    try {
      const anonymous: string[] = [];
      for (const table of tablesInSchema()) {
        await database.table(table).each((row: unknown, cursor) => {
          if (ownerOfRow(table, cursor.primaryKey, row as Record<string, unknown>) === undefined) {
            // The key is stringified only to name the offending row in the
            // failure message; Dexie types it as `IndexableType`, which
            // includes an array key, so it is JSON rather than `String`.
            anonymous.push(`${table}/${JSON.stringify(cursor.primaryKey)}`);
          }
        });
      }
      expect(
        anonymous,
        'this row belongs to nobody, so no athlete-scoped erasure can remove it',
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });
});
