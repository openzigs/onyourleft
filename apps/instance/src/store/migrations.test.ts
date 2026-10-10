// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every migration is reversible, proved per migration** (#769, ADR 0037 D-6).
 *
 * The migrations are taken from the DIRECTORY, not from `migrations/index.ts`
 * or any other list, so a migration file nobody registered is still checked —
 * and the index is then held to the directory, so it cannot drift either.
 *
 * For each migration `n`, on ONE database file walked forward (#985):
 *
 * 1. with `1…n-1` applied, write fixture rows into every table there is, and
 *    read the schema back from `sqlite_schema` — never from the migration
 *    source;
 * 2. apply `n` and read the schema again;
 * 3. `down(n)`: the schema must equal step 1's, and every fixture row must
 *    still be there;
 * 4. `up(n)` again: the schema must equal step 2's, rows unchanged — and that
 *    database, migrated through `n`, is step 1 of `n + 1`.
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
  // The columns named, so migration 0012's `scope` takes its default (#898).
  session: `INSERT INTO session (token_sha256, athlete_id, device_key, expires_at, revoked_at) VALUES ('${'0'.repeat(64)}', 'a', 'key-a', 3, NULL)`,
  activity_record: `INSERT INTO activity_record (athlete_id, content_sha256, signed_record, received_at) VALUES ('a', '${'1'.repeat(64)}', x'00ff', 4)`,
  room: `INSERT INTO room VALUES ('room', 'race', 'private', '${'2'.repeat(64)}', 1)`,
  result: `INSERT INTO result (room_id, athlete_id, finish_ms, flags) VALUES ('room', 'a', 1000, 0)`,
  private_room: `INSERT INTO private_room VALUES ('room', '${'c'.repeat(64)}', 0, 16, NULL)`,
  room_member: `INSERT INTO room_member VALUES ('room', 'a', 'creator', 17)`,
  room_course: `INSERT INTO room_course (room_id, length_metres, grades, riding_position, capacity, countdown_ms, rejoin_window_ms, race_started_at) VALUES ('room', 450, '[[0,0],[150,2]]', 'hoods', NULL, 2000, NULL, NULL)`,
  auth_challenge: `INSERT INTO auth_challenge VALUES ('${'3'.repeat(64)}', 'key-b', 5, NULL)`,
  recovery_code: `INSERT INTO recovery_code VALUES ('${'4'.repeat(64)}', 'a', 6, NULL)`,
  link_code: `INSERT INTO link_code VALUES ('${'5'.repeat(64)}', 'a', 'key-a', 7, NULL)`,
  // An explicit id, so the second seeding is a conflict rather than a second
  // row: with no id the autoincrement made one, and any migration after 0004
  // read that as its `down` adding a row (#780, the first such migration).
  display_name_change: `INSERT INTO display_name_change (id, athlete_id, previous_name, changed_at) VALUES (1, 'a', 'Old', 8)`,
  // The columns named, so migration 0019's `confirmed_at` and `bound_by_key` are NULL (#1194).
  recovery_email: `INSERT INTO recovery_email (athlete_id, address) VALUES ('a', 'a@example.org')`,
  // The columns named, so migration 0019's `address` is NULL (#1194).
  email_recovery_token: `INSERT INTO email_recovery_token (token_sha256, athlete_id, expires_at, used_at) VALUES ('${'6'.repeat(64)}', 'a', 9, NULL)`,
  // The columns named, so migration 0018's `requested_by_key` is NULL (#1193).
  recovery_email_confirmation: `INSERT INTO recovery_email_confirmation (token_sha256, athlete_id, address, expires_at, used_at) VALUES ('${'7'.repeat(64)}', 'a', 'a@example.org', 10, NULL)`,
  block: `INSERT INTO block VALUES ('a', 'b', 10)`,
  report: `INSERT INTO report (id, athlete_id, target_athlete_id, reason, created_at) VALUES (1, 'a', 'b', 'Why', 11)`,
  invite_code: `INSERT INTO invite_code VALUES ('${'8'.repeat(64)}', 'a', 13, NULL)`,
  sync_item: `INSERT INTO sync_item (seq, athlete_id, kind, item_key, digest, body, received_at, deleted_at) VALUES (1, 'a', 'write-up', 'ride-1', '${'9'.repeat(64)}', x'7b7d', 14, NULL)`,
  history_source: `INSERT INTO history_source VALUES ('a', 'write-up', 'ride-1', '${'9'.repeat(64)}', 'm', 'c', 'indexed', 1, 15)`,
  history_passage: `INSERT INTO history_passage VALUES ('a', 'write-up', 'ride-1', 0, 'A ride.', 'm', 2, 'c', x'0000803f00000000')`,
  hosted_model_key: `INSERT INTO hosted_model_key VALUES (1, 'a', 'https://models.example/v1', 'm', x'000102030405060708090a0b', x'ffee', 18)`,
  instance_key: `INSERT INTO instance_key VALUES ('0123456789abcdef', 'encryption', x'${'ab'.repeat(32)}', x'000102030405060708090a0b', x'ffee', 1790000000, 19, NULL)`,
  instance_key_statement: `INSERT INTO instance_key_statement VALUES ('0123456789abcdef', 'key', 19, 172819, '{}', '${'cd'.repeat(64)}')`,
  instance_key_lease: `INSERT INTO instance_key_lease VALUES ('keys', 'holder', 20)`,
  sealed_replay: `INSERT INTO sealed_replay VALUES ('${'ef'.repeat(32)}', 20)`,
  account_change: `INSERT INTO account_change (id, athlete_id, at, kind, actor_key, subject_key, via, address) VALUES (1, 'a', 21, 'key_added', 'key-a', 'key-a', 'link_code', NULL)`,
  account_change_mark: `INSERT INTO account_change_mark VALUES ('a', 'key-a', 1, 22)`,
  // The columns named, so migration 0021's `ride_id` is NULL (#1229).
  analysis_job: `INSERT INTO analysis_job (id, athlete_id, status, source, template_version, input_json, candidate, failure, created_at, ended_at) VALUES ('job-a', 'a', 'succeeded', 'instance-local', '1', '{}', 'A ride.', NULL, 23, 24)`,
  analysis_event: `INSERT INTO analysis_event VALUES ('job-a', 'a', 1, 'result', '{}', 24)`,
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

  /**
   * ⚠️ **One database walked forward, not a fresh one per migration (#985).**
   * A fresh file per migration re-applied `1…n-1` every time — 78 of the 117
   * migration steps at thirteen migrations, growing with the square of the
   * count — and that is what took this case to 11 237 ms on a loaded runner.
   * The walk checks the same four things of every migration; what differs is
   * that the rows step 1 counts have also been through every earlier
   * migration's `down` and `up`, which is more than the fresh file asked of
   * them, not less. Seeding twice adds nothing (`FIXTURE_ROWS`).
   *
   * ⚠️ **Its timeout is judged against CI under coverage** (docs/agents/ci.md §4c).
   * Before the walk, on `Tests and coverage report`: 505–993 ms on 34 of 38
   * green runs read on 2026-10-01 (36843950489 to 36882904839), then 1 140,
   * 1 829, 2 775 and 3 293 ms (36849145949, 36881644356, 36877000180,
   * 36845803725); and over Vitest's 5 s, so red, 6 737 ms on 36860095171
   * attempt 1 (#975) and 11 237 ms on 36884103033 attempt 1 (#984). Every
   * figure over 2.5 s was an Intel Xeon 6973P-C. 35 s is about three times
   * the slowest; the walk took 180–230 ms locally where the fresh files took
   * 280–450 ms. The walk's first CI figure is 327 ms (36891647825, an AMD
   * EPYC 9V74), one run on a fast runner: the timeout still rests on the old
   * shape's slowest figures until a walk lands on a loaded Xeon.
   */
  it(
    'each one, undone, leaves the schema and the rows exactly as they were before it',
    { timeout: 35_000 },
    async () => {
      const onDisk = await migrationsOnDisk();
      const path = await freshPath();
      for (let n = 1; n <= onDisk.length; n += 1) {
        const name = onDisk[n - 1]![0];
        const through = Object.fromEntries(onDisk.slice(0, n)) as Record<string, InstanceMigration>;

        // Migrated through n - 1 already: by the previous turn's up(n - 1).
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
    },
  );

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

  it('ends every way-out session when 0012 is undone, so a rolled-back instance gives a suspended rider no more (#898)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0012-session-scope') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO session (token_sha256, athlete_id, device_key, expires_at, revoked_at, scope) VALUES ('${'1'.repeat(64)}', 'a', 'key-a', 3, NULL, 'leave')`,
      );
    } finally {
      database.close();
    }
    await withKysely(path, (db) => migrateDownOne(db));
    const read = openDatabase(path);
    try {
      const rows = read
        .prepare('SELECT token_sha256, revoked_at FROM session ORDER BY token_sha256')
        .all() as { token_sha256: string; revoked_at: number | null }[];
      expect(rows).toEqual([
        { token_sha256: '0'.repeat(64), revoked_at: null },
        { token_sha256: '1'.repeat(64), revoked_at: 0 },
      ]);
    } finally {
      read.close();
    }
  });

  it('takes the account-change log, the marks and `requested_by_key` away with 0018, rows and all, and puts them back empty (#1193)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0018-account-changes') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const columns = (): string[] => {
      const database = openDatabase(path);
      try {
        return (
          database
            .prepare(`SELECT name FROM pragma_table_info('recovery_email_confirmation')`)
            .all() as {
            name: string;
          }[]
        ).map((each) => each.name);
      } finally {
        database.close();
      }
    };
    const seeded = snapshot(path);
    expect(seeded.rows.account_change).toBe(1);
    expect(seeded.rows.account_change_mark).toBe(1);
    expect(columns()).toContain('requested_by_key');

    await withKysely(path, (db) => migrateDownOne(db));
    const undone = snapshot(path);
    expect(undone.rows).not.toHaveProperty('account_change');
    expect(undone.rows).not.toHaveProperty('account_change_mark');
    expect(columns()).not.toContain('requested_by_key');
    // Every other row stays, the confirmation the column was added to included.
    expect(undone.rows.recovery_email_confirmation).toBe(1);
    expect(undone.rows.device_key).toBe(seeded.rows.device_key);

    await withKysely(path, (db) => migrateUpOne(db));
    const redone = snapshot(path);
    expect([redone.rows.account_change, redone.rows.account_change_mark]).toEqual([0, 0]);
    expect(columns()).toContain('requested_by_key');
  });

  it('migrates three athletes’ single addresses to established with 0019, and back, and up again (#1194)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0018-account-changes') {
        await migrateDownOne(db);
      }
    });
    const rows = (query: string): unknown[] => {
      const database = openDatabase(path);
      try {
        return database.prepare(query).all();
      } finally {
        database.close();
      }
    };
    const exec = (statement: string): void => {
      const database = openDatabase(path);
      try {
        database.exec(statement);
      } finally {
        database.close();
      }
    };
    // Today's shape: one address each, a token mailed to it, one pending
    // confirmation each.
    for (const athlete of ['a', 'b', 'c']) {
      exec(`
        INSERT INTO athlete (id, display_name, created_at, registration_state) VALUES ('${athlete}', 'A', 1, 'active');
        INSERT INTO device_key (public_key, athlete_id, added_at, revoked_at) VALUES ('key-${athlete}', '${athlete}', 2, NULL);
        INSERT INTO recovery_email VALUES ('${athlete}', '${athlete}@example.org');
        INSERT INTO email_recovery_token VALUES ('${athlete.repeat(64)}', '${athlete}', 9, NULL);
        INSERT INTO recovery_email_confirmation (token_sha256, athlete_id, address, expires_at, used_at, requested_by_key)
          VALUES ('${athlete.toUpperCase().repeat(64)}', '${athlete}', 'new-${athlete}@example.org', 10, NULL, 'key-${athlete}');
      `);
    }
    const before = snapshot(path);
    const today = rows(`SELECT * FROM recovery_email ORDER BY athlete_id`);

    await withKysely(path, (db) => migrateUpOne(db));
    expect(rows(`SELECT * FROM recovery_email ORDER BY athlete_id`)).toEqual(
      ['a', 'b', 'c'].map((athlete) => ({
        athlete_id: athlete,
        address: `${athlete}@example.org`,
        confirmed_at: null,
        bound_by_key: null,
      })),
    );
    // Each token took its athlete's one address.
    expect(
      rows(`SELECT athlete_id, address FROM email_recovery_token ORDER BY athlete_id`),
    ).toEqual(
      ['a', 'b', 'c'].map((athlete) => ({
        athlete_id: athlete,
        address: `${athlete}@example.org`,
      })),
    );
    const migrated = snapshot(path);

    // The new shape holds what the old one cannot: a second address for `a`,
    // which is the row documented as lost on `down`.
    exec(`INSERT INTO recovery_email VALUES ('a', 'second-a@example.org', 50, 'key-a')`);
    await withKysely(path, (db) => migrateDownOne(db));
    const undone = snapshot(path);
    expect(undone.schema).toEqual(before.schema);
    expect(undone.rows).toEqual(before.rows);
    // The address bound before 0019 is the one kept, and every row is today's.
    expect(rows(`SELECT * FROM recovery_email ORDER BY athlete_id`)).toEqual(today);

    await withKysely(path, (db) => migrateUpOne(db));
    expect(snapshot(path)).toEqual(migrated);
  });

  it('takes both analysis tables away with 0020, rows and all, read from sqlite_schema, and puts them back empty (#1095)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0020-analysis-jobs') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const named = (): string[] => {
      const database = openDatabase(path);
      try {
        return (
          database
            .prepare(`SELECT name FROM sqlite_schema WHERE name LIKE 'analysis_%' ORDER BY name`)
            .all() as { name: string }[]
        ).map((each) => each.name);
      } finally {
        database.close();
      }
    };
    expect(named()).toEqual([
      'analysis_event',
      'analysis_job',
      'analysis_job_by_athlete',
      'analysis_job_by_status',
    ]);
    const seeded = snapshot(path);
    expect([seeded.rows.analysis_job, seeded.rows.analysis_event]).toEqual([1, 1]);

    await withKysely(path, (db) => migrateDownOne(db));
    expect(named()).toEqual([]);
    expect(snapshot(path).rows.athlete).toBe(seeded.rows.athlete);

    await withKysely(path, (db) => migrateUpOne(db));
    const redone = snapshot(path);
    expect(named()).toHaveLength(4);
    expect([redone.rows.analysis_job, redone.rows.analysis_event]).toEqual([0, 0]);
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
