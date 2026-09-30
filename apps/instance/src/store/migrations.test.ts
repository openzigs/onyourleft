// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every migration is reversible, proved per migration** (#769, ADR 0037 D-6).
 *
 * The migrations are taken from the DIRECTORY, not from `migrations/index.ts`
 * or any other list, so a migration file nobody registered is still checked —
 * and the index is then held to the directory, so it cannot drift either.
 *
 * For each migration `n`, on a fresh database file:
 *
 * 1. apply `1…n-1`, write fixture rows into every table there is, and read the
 *    schema back from `sqlite_schema` — never from the migration source;
 * 2. apply `n` and read the schema again;
 * 3. `down(n)`: the schema must equal step 1's, and every fixture row must
 *    still be there;
 * 4. `up(n)` again: the schema must equal step 2's, rows unchanged.
 *
 * A migration with no `down` fails before any of that; a `down` that leaves a
 * table, a column or an index behind fails step 3.
 */

import { readdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import {
  appliedMigrations,
  migrateDownOne,
  migrateToLatest,
  migrateUpOne,
  MigrationError,
  tableRowCounts,
} from './migrate.ts';
import { MIGRATIONS, type InstanceMigration } from './migrations/index.ts';
import { openDatabase } from './node-sqlite.ts';
import { openKysely } from './open-sql-store.ts';

const DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d{4}-[a-z0-9-]+)\.ts$/;

async function migrationsOnDisk(): Promise<[string, Partial<InstanceMigration>][]> {
  const names = (await readdir(DIRECTORY))
    .map((file) => MIGRATION_FILE.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
  return Promise.all(
    names.map(
      async (name) =>
        [name, (await import(join(DIRECTORY, `${name}.ts`))) as Partial<InstanceMigration>] as [
          string,
          Partial<InstanceMigration>,
        ],
    ),
  );
}

/**
 * One row for each table, so a rollback that lost rows it should have kept
 * is visible. ⚠️ A table with no entry here fails the test: a new table owes a
 * fixture row, or its rollback is checked over an empty table. Each row names
 * its whole primary key, so seeding a second time adds nothing: a generated
 * id would add a second row, which the first migration after its table's
 * (0005, #865) then reads as a `down` that kept too much.
 */
const FIXTURE_ROWS: Readonly<Record<string, string>> = {
  athlete: `INSERT INTO athlete (id, display_name, created_at, registration_state) VALUES ('a', 'A', 1, 'active')`,
  device_key: `INSERT INTO device_key (public_key, athlete_id, added_at, revoked_at) VALUES ('key-a', 'a', 2, NULL)`,
  session: `INSERT INTO session VALUES ('${'0'.repeat(64)}', 'a', 'key-a', 3, NULL)`,
  activity_record: `INSERT INTO activity_record (athlete_id, content_sha256, signed_record, received_at) VALUES ('a', '${'1'.repeat(64)}', x'00ff', 4)`,
  room: `INSERT INTO room VALUES ('room', 'race', 'private', '${'2'.repeat(64)}', 1)`,
  result: `INSERT INTO result (room_id, athlete_id, finish_ms, flags) VALUES ('room', 'a', 1000, 0)`,
  private_room: `INSERT INTO private_room VALUES ('room', '${'c'.repeat(64)}', 0, 16, NULL)`,
  room_member: `INSERT INTO room_member VALUES ('room', 'a', 'creator', 17)`,
  room_course: `INSERT INTO room_course VALUES ('room', 450, '[[0,0],[150,2]]', 'hoods', NULL, 2000, NULL, NULL)`,
  auth_challenge: `INSERT INTO auth_challenge VALUES ('${'3'.repeat(64)}', 'key-b', 5, NULL)`,
  recovery_code: `INSERT INTO recovery_code VALUES ('${'4'.repeat(64)}', 'a', 6, NULL)`,
  link_code: `INSERT INTO link_code VALUES ('${'5'.repeat(64)}', 'a', 'key-a', 7, NULL)`,
  // An explicit id, so the second seeding is a conflict rather than a second
  // row: with no id the autoincrement made one, and any migration after 0004
  // read that as its `down` adding a row (#780, the first such migration).
  display_name_change: `INSERT INTO display_name_change (id, athlete_id, previous_name, changed_at) VALUES (1, 'a', 'Old', 8)`,
  recovery_email: `INSERT INTO recovery_email VALUES ('a', 'a@example.org')`,
  email_recovery_token: `INSERT INTO email_recovery_token VALUES ('${'6'.repeat(64)}', 'a', 9, NULL)`,
  recovery_email_confirmation: `INSERT INTO recovery_email_confirmation VALUES ('${'7'.repeat(64)}', 'a', 'a@example.org', 10, NULL)`,
  block: `INSERT INTO block VALUES ('a', 'b', 10)`,
  report: `INSERT INTO report (id, athlete_id, target_athlete_id, reason, created_at) VALUES (1, 'a', 'b', 'Why', 11)`,
  invite_code: `INSERT INTO invite_code VALUES ('${'8'.repeat(64)}', 'a', 13, NULL)`,
  sync_item: `INSERT INTO sync_item (seq, athlete_id, kind, item_key, digest, body, received_at, deleted_at) VALUES (1, 'a', 'write-up', 'ride-1', '${'9'.repeat(64)}', x'7b7d', 14, NULL)`,
  history_source: `INSERT INTO history_source VALUES ('a', 'write-up', 'ride-1', '${'9'.repeat(64)}', 'm', 'c', 'indexed', 1, 15)`,
  history_passage: `INSERT INTO history_passage VALUES ('a', 'write-up', 'ride-1', 0, 'A ride.', 'm', 2, 'c', x'0000803f00000000')`,
  moderation_log: `INSERT INTO moderation_log (id, actor_athlete_id, action, target_athlete_id, reason, at) VALUES (1, 'a', 'suspend', 'b', 'Why', 12)`,
};

/**
 * A table a migration's `down` REFUSES to drop while it holds a row, by
 * migration: the moderation log (#83, #891's review). The round trip below
 * leaves that one table empty for that one migration, and a test of its own
 * holds the refusal.
 */
const EMPTY_FOR_ITS_OWN_DOWN: Readonly<Record<string, string>> = {
  '0007-moderation': 'moderation_log',
};

interface Snapshot {
  readonly schema: readonly string[];
  readonly rows: Readonly<Record<string, number>>;
}

function snapshot(path: string): Snapshot {
  const database = openDatabase(path);
  try {
    const entries = database
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_schema
         WHERE name NOT LIKE 'kysely_%' AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
    const rows: Record<string, number> = {};
    for (const entry of entries.filter((each) => each.type === 'table')) {
      const counted = database.prepare(`SELECT count(*) AS n FROM "${entry.name}"`).get() as {
        n: number;
      };
      rows[entry.name] = counted.n;
    }
    return {
      schema: entries.map((entry) => `${entry.type} ${entry.name} ${entry.tbl_name} ${entry.sql}`),
      rows,
    };
  } finally {
    database.close();
  }
}

function seedEveryTable(path: string, except?: string): void {
  const database = openDatabase(path);
  try {
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table'
         AND name NOT LIKE 'kysely_%' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[];
    // Parents first, so every foreign key has something to point at.
    for (const table of Object.keys(FIXTURE_ROWS)) {
      if (table !== except && tables.some((each) => each.name === table)) {
        database.exec(`${FIXTURE_ROWS[table]} ON CONFLICT DO NOTHING`);
      }
    }
    const unseeded = tables.map((each) => each.name).filter((name) => !(name in FIXTURE_ROWS));
    if (unseeded.length > 0) {
      throw new Error(`No fixture row for ${unseeded.join(', ')}: add one to FIXTURE_ROWS.`);
    }
  } finally {
    database.close();
  }
}

let directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories = [];
});

async function freshPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-migrations-'));
  directories.push(directory);
  return join(directory, 'instance.sqlite');
}

async function withKysely<T>(path: string, operation: (db: Kysely<unknown>) => Promise<T>) {
  const db = openKysely(path) as unknown as Kysely<unknown>;
  try {
    return await operation(db);
  } finally {
    await db.destroy();
  }
}

describe('the migrations (#769)', () => {
  it('are registered in migrations/index.ts exactly as they are on disk', async () => {
    const onDisk = await migrationsOnDisk();
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(MIGRATIONS)).toEqual(onDisk.map(([name]) => name));
    for (const [name, module] of onDisk) {
      expect(MIGRATIONS[name]?.up, name).toBe(module.up);
      expect(MIGRATIONS[name]?.down, name).toBe(module.down);
    }
  });

  it('every one of them exports down', async () => {
    for (const [name, module] of await migrationsOnDisk()) {
      expect(typeof module.up, `${name} exports up`).toBe('function');
      expect(typeof module.down, `${name} exports down`).toBe('function');
    }
  });

  it('each one, undone, leaves the schema and the rows exactly as they were before it', async () => {
    const onDisk = await migrationsOnDisk();
    for (let n = 1; n <= onDisk.length; n += 1) {
      const name = onDisk[n - 1]![0];
      const earlier = Object.fromEntries(onDisk.slice(0, n - 1)) as Record<
        string,
        InstanceMigration
      >;
      const through = Object.fromEntries(onDisk.slice(0, n)) as Record<string, InstanceMigration>;
      const path = await freshPath();

      await withKysely(path, (db) => migrateToLatest(db, earlier));
      seedEveryTable(path);
      const before = snapshot(path);

      await withKysely(path, (db) => migrateToLatest(db, through));
      seedEveryTable(path, EMPTY_FOR_ITS_OWN_DOWN[name]);
      const after = snapshot(path);
      expect(after.schema, `${name} changes the schema`).not.toEqual(before.schema);

      await withKysely(path, (db) => migrateDownOne(db, through));
      const undone = snapshot(path);
      expect(undone.schema, `down(${name}) restores the schema`).toEqual(before.schema);
      expect(undone.rows, `down(${name}) keeps the earlier rows`).toEqual(before.rows);

      await withKysely(path, (db) => migrateUpOne(db, through));
      const redone = snapshot(path);
      expect(redone.schema, `up(${name}) again`).toEqual(after.schema);
      expect(redone.rows, `up(${name}) again keeps the earlier rows`).toEqual({
        ...before.rows,
        ...Object.fromEntries(
          Object.keys(after.rows)
            .filter((table) => !(table in before.rows))
            .map((table) => [table, 0]),
        ),
      });
    }
  });

  it('refuses to undo 0007 while the moderation log holds an entry, and changes nothing (#891)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0007-moderation') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const before = snapshot(path);
    expect(before.rows.moderation_log).toBe(1);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /moderation log holds entries/,
    );
    expect(snapshot(path)).toEqual(before);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0007-moderation');
    });
  });

  it('refuses a migration with no down, rather than letting Kysely skip it', async () => {
    const path = await freshPath();
    const noDown = { up: MIGRATIONS['0001-athletes-keys-sessions']!.up } as InstanceMigration;
    await expect(
      withKysely(path, (db) => migrateToLatest(db, { '0001-no-down': noDown })),
    ).rejects.toBeInstanceOf(MigrationError);
  });

  it('reports what is applied and how many rows each table holds', async () => {
    const path = await freshPath();
    await withKysely(path, async (db) => {
      expect(await appliedMigrations(db)).toEqual([]);
      await migrateToLatest(db);
      expect(await appliedMigrations(db)).toEqual(Object.keys(MIGRATIONS));
    });
    seedEveryTable(path);
    await withKysely(path, async (db) => {
      expect(await tableRowCounts(db)).toEqual(snapshot(path).rows);
      expect(Object.keys(await tableRowCounts(db)).sort()).toEqual(
        Object.keys(FIXTURE_ROWS).sort(),
      );
    });
  });
});
