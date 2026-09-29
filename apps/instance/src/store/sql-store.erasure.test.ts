// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An erased athlete leaves no row behind, in any table the schema has**
 * (#769; #35's criterion, server side).
 *
 * The athlete-scoped tables are found in the SCHEMA — every table with an
 * `athlete_id` column, read with `pragma_table_info` from the migrated
 * database — and not from `sql-store.ts`'s list or this file. So a table a
 * later migration adds (#13, #785) with an `athlete_id` fails here until
 * `eraseAthlete` empties it, rather than being quietly missed by both.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './node-sqlite.ts';
import { ATHLETE_TABLES_IN_ERASURE_ORDER } from './sql-store.ts';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  seedWorld,
  type StoreHarness,
} from './testing/index.ts';

let harness: StoreHarness | undefined;
afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** Every table with an `athlete_id` column, from the database itself. */
function athleteScopedTables(path: string): string[] {
  const database = openDatabase(path);
  try {
    return (
      database
        .prepare(
          `SELECT DISTINCT m.name AS name FROM sqlite_schema AS m, pragma_table_info(m.name) AS c
           WHERE m.type = 'table' AND c.name = 'athlete_id' ORDER BY m.name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    database.close();
  }
}

function rowsOf(path: string, table: string, column: string, athleteId: string): number {
  const database = openDatabase(path);
  try {
    return (
      database
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ?`)
        .get(athleteId) as { n: number }
    ).n;
  } finally {
    database.close();
  }
}

describe('erasing an athlete (#769, #35)', () => {
  it('empties every athlete-scoped table the schema has of that athlete, and only that athlete', async () => {
    harness = await createStoreHarness();
    await harness.write(seedWorld);
    const tables = athleteScopedTables(harness.path);
    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      expect(
        rowsOf(harness.path, table, 'athlete_id', ATHLETE_B),
        `${table} seeded`,
      ).toBeGreaterThan(0);
    }

    await harness.write((store) => store.eraseAthlete(ATHLETE_B));

    for (const table of tables) {
      expect(rowsOf(harness.path, table, 'athlete_id', ATHLETE_B), `${table} erased`).toBe(0);
      expect(
        rowsOf(harness.path, table, 'athlete_id', ATHLETE_A),
        `${table} kept A`,
      ).toBeGreaterThan(0);
      expect(
        rowsOf(harness.path, table, 'athlete_id', ATHLETE_C),
        `${table} kept C`,
      ).toBeGreaterThan(0);
    }
    expect(rowsOf(harness.path, 'athlete', 'id', ATHLETE_B)).toBe(0);
    expect(rowsOf(harness.path, 'athlete', 'id', ATHLETE_A)).toBe(1);
    expect(await harness.read((store) => store.getAthlete(ATHLETE_B))).toBeUndefined();
  });

  it('names every athlete-scoped table in the erasure list', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    expect([...ATHLETE_TABLES_IN_ERASURE_ORDER].sort()).toEqual(athleteScopedTables(harness.path));
  });
});
