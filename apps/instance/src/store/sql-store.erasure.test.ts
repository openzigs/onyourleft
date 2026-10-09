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
  registrationFixture,
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

/**
 * Every column that names an athlete WITHOUT a foreign key to `athlete` (#83),
 * and what erasing that athlete does to the rows naming them. A reference with
 * a foreign key is found by {@link athleteScopedTables}; one without is found
 * here by its NAME, from the schema — every column ending `athlete_id` — so a
 * later table that names an athlete another way fails until it says which.
 *
 * - `erased`: `eraseAthlete` deletes the rows naming the erased athlete.
 * - `kept`: the rows stay, naming an id that no longer resolves to anybody,
 *   and the reason is recorded here.
 */
const NAMED_WITHOUT_A_FOREIGN_KEY: Readonly<
  Record<string, { readonly erased: true } | { readonly kept: string }>
> = {
  // Neither of the next two can carry a foreign key even in principle: since
  // #891's review each may name an id NOBODY ever held, stored so that a
  // rider's own block list and report allowance say nothing about who exists.
  'block.blocked_athlete_id': { erased: true },
  'report.target_athlete_id': {
    kept: 'the report is the REPORTER’s row, and a moderator still decides it',
  },
  'report.closed_by_athlete_id': { kept: 'who decided a report is part of the audit trail' },
  'moderation_log.actor_athlete_id': {
    kept: 'the audit log is append-only: erasing an account does not erase what was done (#83)',
  },
  'moderation_log.target_athlete_id': {
    kept: 'the audit log is append-only: a suspended rider cannot erase their record (#83)',
  },
};

/** Every `table.column` ending `athlete_id` that has no foreign key, from the database. */
function namedWithoutForeignKey(path: string): string[] {
  const database = openDatabase(path);
  try {
    const columns = database
      .prepare(
        `SELECT m.name AS "table", c.name AS "column"
         FROM sqlite_schema AS m, pragma_table_info(m.name) AS c
         WHERE m.type = 'table' AND m.name NOT LIKE 'kysely_%' AND c.name LIKE '%athlete_id'
         ORDER BY m.name, c.name`,
      )
      .all() as unknown as { table: string; column: string }[];
    const withKey = new Set(references(path).map((each) => `${each.table}.${each.from}`));
    return columns
      .map((each) => `${each.table}.${each.column}`)
      .filter((column) => !withKey.has(column));
  } finally {
    database.close();
  }
}

/**
 * An athlete-scoped table that holds ONE row on the whole instance, so the
 * three-athlete world cannot seed it for all three — and the case of its own
 * that erases it instead. A table named here without that case is a test that
 * never runs; the last case below holds the two together.
 */
const ONE_ROW_TABLES: Readonly<Record<string, string>> = {
  hosted_model_key:
    'the instance holds one hosted model key, for the operator (#1097, ADR 0046 Q9): “takes the hosted model key with the athlete it is held for”',
};

describe('erasing an athlete (#769, #35)', () => {
  it('empties every athlete-scoped table the schema has of that athlete, and only that athlete', async () => {
    harness = await createStoreHarness();
    await harness.write(seedWorld);
    const tables = athleteScopedTables(harness.path).filter((table) => !(table in ONE_ROW_TABLES));
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

  it('says, for every column that names an athlete with no foreign key, what erasure does (#83)', async () => {
    harness = await createStoreHarness();
    await harness.write(seedWorld);
    const columns = namedWithoutForeignKey(harness.path);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns).toEqual(Object.keys(NAMED_WITHOUT_A_FOREIGN_KEY).sort());

    const count = (column: string, athleteId: string): number => {
      const [table, name] = column.split('.') as [string, string];
      return rowsOf(harness!.path, table, name, athleteId);
    };
    // The log and a report's decision only exist once a moderator acts.
    await harness.write(async (store) => {
      const [report] = await store.listReports(ATHLETE_A);
      await store.moderate({
        action: 'suspend',
        actorAthleteId: ATHLETE_B,
        targetAthleteId: report!.targetAthleteId,
        reportId: report!.id,
        reason: 'Seen',
        at: 1_790_001_000,
      });
      await store.moderate({
        action: 'hide_display_name',
        actorAthleteId: ATHLETE_A,
        targetAthleteId: ATHLETE_B,
        reportId: null,
        reason: 'Seen',
        at: 1_790_001_000,
      });
    });
    for (const column of columns) {
      expect(count(column, ATHLETE_B), `${column} names B before`).toBeGreaterThan(0);
    }
    await harness.write((store) => store.eraseAthlete(ATHLETE_B));
    for (const column of columns) {
      const rule = NAMED_WITHOUT_A_FOREIGN_KEY[column]!;
      if ('erased' in rule) {
        expect(count(column, ATHLETE_B), `${column} erased`).toBe(0);
      } else {
        expect(count(column, ATHLETE_B), `${column} kept: ${rule.kept}`).toBeGreaterThan(0);
      }
    }
  });

  it('derives the tables it erases from the schema, children before the tables they reference', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const db = openKysely(harness.path);
    try {
      const order = await athleteTablesInErasureOrder(db);
      expect([...order].sort()).toEqual(athleteScopedTables(harness.path));
      expect(order, 'migration 0009’s manifest is found with no list naming it').toContain(
        'sync_item',
      );
      // Migration 0010's history index (#835, ADR 0040 D-10): found the same way.
      expect(order).toContain('history_source');
      expect(order).toContain('history_passage');
      // Migration 0018's account-change log and marks (#1193): found the same way.
      expect(order).toContain('account_change');
      expect(order).toContain('account_change_mark');
      // Migration 0020's analysis jobs and their events (#1095): found the
      // same way, the events before the jobs they reference.
      expect(order).toContain('analysis_job');
      expect(order.indexOf('analysis_event')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('analysis_event')).toBeLessThan(order.indexOf('analysis_job'));
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

  it('takes the hosted model key with the athlete it is held for, and no other athlete (#1097)', async () => {
    harness = await createStoreHarness();
    await harness.write(async (store) => {
      await store.registerAthlete(registrationFixture(ATHLETE_A));
      await store.registerAthlete(registrationFixture(ATHLETE_B));
      const put = await store.putHostedModelKey(ATHLETE_A, {
        url: 'https://models.example/v1',
        model: 'a-model',
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array([1, 2, 3]),
        setAt: 1_790_000_000,
      });
      expect(put).toEqual({ outcome: 'stored' });
    });
    expect(rowsOf(harness.path, 'hosted_model_key', 'athlete_id', ATHLETE_A)).toBe(1);

    await harness.write((store) => store.eraseAthlete(ATHLETE_B));
    expect(rowsOf(harness.path, 'hosted_model_key', 'athlete_id', ATHLETE_A), 'not B’s').toBe(1);

    await harness.write((store) => store.eraseAthlete(ATHLETE_A));

    expect(rowsOf(harness.path, 'hosted_model_key', 'athlete_id', ATHLETE_A)).toBe(0);
    expect(await harness.read((store) => store.getHostedModelKey())).toBeUndefined();
  });

  it('exempts from the three-athlete case only athlete-scoped tables, each with a case of its own', async () => {
    harness = await createStoreHarness();
    await harness.write(() => Promise.resolve());
    const scoped = athleteScopedTables(harness.path);
    for (const table of Object.keys(ONE_ROW_TABLES)) expect(scoped).toContain(table);
  });
});
