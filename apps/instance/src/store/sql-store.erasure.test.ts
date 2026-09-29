// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **An erased athlete leaves no row behind, in any table the schema has**
 * (#769; #35's criterion, server side).
 *
 * The athlete-scoped tables are found in the SCHEMA — every table with a
 * foreign key to `athlete`, read with `pragma_foreign_key_list` from the
 * migrated database — and not from `sql-store.ts`'s list or this file. So a
 * table a later migration adds (#13, #785) that references an athlete fails
 * here until `eraseAthlete` empties it, rather than being quietly missed by
 * both, whatever its column is called.
 *
 * Since #842's review it also holds the rule that made a session able to
 * block ANOTHER athlete's erasure: a reference from one athlete-scoped table
 * to another must carry `athlete_id` on both sides, so one athlete's row can
 * never point at another's.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './node-sqlite.ts';
import { openKysely } from './open-sql-store.ts';
import { athleteTablesInErasureOrder } from './sql-store.ts';
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

interface Reference {
  readonly table: string;
  readonly id: number;
  readonly parent: string;
  readonly from: string;
  readonly to: string;
}

/** Every foreign key in the database, one row per column pair. */
function references(path: string): Reference[] {
  const database = openDatabase(path);
  try {
    return database
      .prepare(
        `SELECT m.name AS "table", f.id AS id, f."table" AS parent, f."from" AS "from", f."to" AS "to"
         FROM sqlite_schema AS m, pragma_foreign_key_list(m.name) AS f
         WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq`,
      )
      .all() as unknown as Reference[];
  } finally {
    database.close();
  }
}

/** Every table with a foreign key to `athlete`, from the database itself. */
function athleteScopedTables(path: string): string[] {
  return [
    ...new Set(
      references(path)
        .filter((reference) => reference.parent === 'athlete')
        .map((reference) => reference.table),
    ),
  ].sort();
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

  it('names its owner in `athlete_id`, the column eraseAthlete deletes by', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const toAthlete = references(harness.path).filter((each) => each.parent === 'athlete');
    expect(toAthlete.length).toBeGreaterThan(0);
    for (const reference of toAthlete) {
      expect(`${reference.table}.${reference.from}`).toBe(`${reference.table}.athlete_id`);
    }
  });

  it('lets no athlete-scoped row reference another athlete’s row (#842 review)', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const all = references(harness.path);
    const scoped = new Set(athleteScopedTables(harness.path));
    const between = all.filter((each) => scoped.has(each.table) && scoped.has(each.parent));
    expect(between.length, 'session → device_key is one such reference').toBeGreaterThan(0);
    for (const reference of between) {
      const pairs = all.filter(
        (each) => each.table === reference.table && each.id === reference.id,
      );
      expect(
        pairs.some((each) => each.from === 'athlete_id' && each.to === 'athlete_id'),
        `${reference.table}.${reference.from} → ${reference.parent}.${reference.to}`,
      ).toBe(true);
    }
  });

  it('derives the tables it erases from the schema, children before the tables they reference', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const db = openKysely(harness.path);
    try {
      const order = await athleteTablesInErasureOrder(db);
      expect([...order].sort()).toEqual(athleteScopedTables(harness.path));
      expect(order, 'migration 0005’s manifest is found with no list naming it').toContain(
        'sync_item',
      );
      const scoped = new Set<string>(order);
      for (const reference of references(harness.path)) {
        if (!scoped.has(reference.table) || !scoped.has(reference.parent)) continue;
        if (reference.table === reference.parent) continue;
        expect(
          order.indexOf(reference.table as never),
          `${reference.table} before ${reference.parent}`,
        ).toBeLessThan(order.indexOf(reference.parent as never));
      }
    } finally {
      await db.destroy();
    }
  });

  it('answers the files the erased athlete held, for the blob sweep (#35)', async () => {
    harness = await createStoreHarness();
    await harness.write(seedWorld);
    const held = (await harness.read((store) => store.listActivityRecords(ATHLETE_B)))
      .map((record) => record.contentSha256)
      .sort();
    expect(held.length).toBeGreaterThan(0);
    const erased = await harness.write((store) => store.eraseAthlete(ATHLETE_B));
    expect([...erased].sort()).toEqual(held);
    expect(await harness.write((store) => store.eraseAthlete(ATHLETE_B)), 'idempotent').toEqual([]);
  });
});
