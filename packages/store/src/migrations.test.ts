// SPDX-License-Identifier: Apache-2.0

/**
 * #26's first acceptance criterion asks that every migration be "applied and
 * then rolled back against a database containing rows, and the schema verified
 * to return to its prior shape".
 *
 * That criterion was written for a SQL server. **It cannot be executed as
 * written on IndexedDB**, and not because it is difficult: `onupgradeneeded`
 * fires only when the version increases, and opening at a lower version raises
 * `VersionError`. There is no downgrade event to run a `down` migration in. The
 * first test below proves that, against the real engine, rather than asserting
 * it in a comment.
 *
 * ADR 0005 section F and CLAUDE.md section 5 decided what discharges the intent
 * instead, and it is what the rest of this file does:
 *
 * - apply `up` to a fixture **containing records**;
 * - apply `down` to the result;
 * - assert the records are back to their prior shape.
 *
 * Both halves are exercised twice — once as pure functions, and once through a
 * real Dexie version bump against a real (fake-indexeddb) IndexedDB, with the
 * database closed and reopened in between so the assertion reads what is on
 * disk rather than what is in the connection.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  migrateDown,
  migrateUp,
  SCHEMA_MIGRATIONS,
  upgradeWith,
  type RecordMigration,
} from './migrations';
import { SCHEMA_VERSION } from './schema';

/**
 * A fixture migration. Not a production one — see `SCHEMA_MIGRATIONS`.
 *
 * It does the two things a real schema change does: it **renames** a field
 * (losslessly reversible) and it **adds** one with a default (reversible by
 * dropping it again). Written to be pure and total in both directions, which is
 * what the contract requires and what makes the round trip below meaningful.
 */
interface RideV1 {
  id: string;
  athleteId: string;
  duration: number;
}

interface RideV2 {
  id: string;
  athleteId: string;
  elapsedTime: number;
  visibility: string;
}

const RENAME_DURATION: RecordMigration<RideV1, RideV2> = {
  toVersion: 2,
  table: 'rides',
  description: 'renamed duration to elapsedTime and defaulted visibility to private',
  up(before: RideV1): RideV2 {
    return {
      id: before.id,
      athleteId: before.athleteId,
      elapsedTime: before.duration,
      visibility: 'private',
    };
  },
  down(after: RideV2): RideV1 {
    return { id: after.id, athleteId: after.athleteId, duration: after.elapsedTime };
  },
};

const FIXTURE: readonly RideV1[] = [
  { id: 'r1', athleteId: 'athlete-a', duration: 3_600 },
  { id: 'r2', athleteId: 'athlete-a', duration: 0 },
  { id: 'r3', athleteId: 'athlete-b', duration: 7_384 },
];

const TEST_STORES = { rides: 'id, athleteId' };

let databaseName: string;

beforeEach(() => {
  databaseName = `oyl-migration-${String(Date.now())}-${String(Math.random()).slice(2)}`;
});

afterEach(async () => {
  await Dexie.delete(databaseName);
});

async function openAt(version: number, upgrade?: (tx: never) => Promise<void>): Promise<Dexie> {
  const db = new Dexie(databaseName);
  db.version(1).stores(TEST_STORES);
  if (version >= 2) {
    const v2 = db.version(2).stores(TEST_STORES);
    if (upgrade !== undefined) {
      v2.upgrade(upgrade as never);
    }
  }
  await db.open();
  return db;
}

describe('IndexedDB has no downgrade event — the premise the criterion has to be translated around', () => {
  it('the engine refuses to open a version-2 database at version 1', async () => {
    const upgraded = await openAt(2);
    const upgradedIdbVersion = upgraded.backendDB().version;
    upgraded.close();

    const outcome = await new Promise<string>((resolve) => {
      const request = indexedDB.open(databaseName, upgradedIdbVersion - 1);
      request.onsuccess = (): void => {
        request.result.close();
        resolve('opened');
      };
      request.onerror = (): void => {
        resolve(request.error?.name ?? 'unknown error');
      };
    });

    // `VersionError`, not a Dexie error: this is the engine's own refusal, and
    // it is why `down` is a pure function over records rather than an upgrade
    // hook that runs backwards. Dexie's *own* behaviour here is softer than the
    // engine's and is covered in `activity-store.version-guard.test.ts`.
    expect(outcome).toBe('VersionError');
  });
});

describe('the up/down pair is a rollback at the record level', () => {
  it('up then down returns every record to its prior shape', () => {
    const upgraded = migrateUp(RENAME_DURATION, FIXTURE);
    const rolledBack = migrateDown(RENAME_DURATION, upgraded);

    expect(rolledBack).toEqual(FIXTURE);
  });

  it('up actually changed something, so the round trip is not a no-op', () => {
    const upgraded = migrateUp(RENAME_DURATION, FIXTURE);

    expect(upgraded[0]).toEqual({
      id: 'r1',
      athleteId: 'athlete-a',
      elapsedTime: 3_600,
      visibility: 'private',
    });
    expect(upgraded[0]).not.toHaveProperty('duration');
  });

  it('is pure — the fixture is not mutated', () => {
    const before = structuredClone(FIXTURE);
    migrateDown(RENAME_DURATION, migrateUp(RENAME_DURATION, FIXTURE));

    expect(FIXTURE).toEqual(before);
  });

  it('maps an empty set to an empty set in both directions', () => {
    expect(migrateUp(RENAME_DURATION, [])).toEqual([]);
    expect(migrateDown(RENAME_DURATION, [])).toEqual([]);
  });
});

describe('the same pair, applied to a database that contains rows', () => {
  it('rewrites every stored record wholesale, and the result survives a close and reopen', async () => {
    const v1 = await openAt(1);
    await v1.table('rides').bulkPut([...FIXTURE]);
    v1.close();

    const v2 = await openAt(2, upgradeWith(RENAME_DURATION));
    v2.close();

    // Reopened a third time: the assertion must read what is on disk, not what
    // the connection that ran the upgrade happens to be holding.
    const reread = await openAt(2, upgradeWith(RENAME_DURATION));
    const rows = (await reread.table('rides').orderBy('id').toArray()) as RideV2[];
    reread.close();

    expect(rows).toEqual([
      { id: 'r1', athleteId: 'athlete-a', elapsedTime: 3_600, visibility: 'private' },
      { id: 'r2', athleteId: 'athlete-a', elapsedTime: 0, visibility: 'private' },
      { id: 'r3', athleteId: 'athlete-b', elapsedTime: 7_384, visibility: 'private' },
    ]);
    // Wholesale replacement, not a field edit: the old key is gone from disk.
    for (const row of rows) {
      expect(row).not.toHaveProperty('duration');
    }
  });

  it('rolls those stored rows back to their prior shape, which is the evidence the criterion asks for', async () => {
    const v1 = await openAt(1);
    await v1.table('rides').bulkPut([...FIXTURE]);
    v1.close();

    const v2 = await openAt(2, upgradeWith(RENAME_DURATION));
    const migrated = (await v2.table('rides').orderBy('id').toArray()) as RideV2[];
    v2.close();

    const rolledBack = migrateDown(RENAME_DURATION, migrated);

    expect(rolledBack).toEqual([...FIXTURE].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it('leaves an empty table empty rather than failing', async () => {
    const v1 = await openAt(1);
    v1.close();

    const v2 = await openAt(2, upgradeWith(RENAME_DURATION));
    const rows = await v2.table('rides').toArray();
    v2.close();

    expect(rows).toEqual([]);
  });
});

describe('the production registry', () => {
  it('is empty, because schema version 1 is the initial schema', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(SCHEMA_MIGRATIONS).toEqual([]);
  });

  it('would hold migrations in ascending toVersion order', () => {
    const versions = SCHEMA_MIGRATIONS.map((migration) => migration.toVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });
});
