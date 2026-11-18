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
import { PHYSICS_VERSION } from '@onyourleft/physics';
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
import { createSqlStore } from './sql-store.ts';
import { planFor } from '../room/room-plan.ts';

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
  // The columns named, so migration 0033's `starts_at` is NULL (#788).
  private_room: `INSERT INTO private_room (room_id, code_sha256, route_loop, created_at, closed_at) VALUES ('room', '${'c'.repeat(64)}', 0, 16, NULL)`,
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
  // The columns named, so migration 0035's handle is its default and its name NULL (#1529).
  block: `INSERT INTO block (athlete_id, blocked_athlete_id, created_at) VALUES ('a', 'b', 10)`,
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
  // The columns named, so migration 0022's `ride_id` is NULL (#1229).
  analysis_job: `INSERT INTO analysis_job (id, athlete_id, status, source, template_version, input_json, candidate, failure, created_at, ended_at) VALUES ('job-a', 'a', 'succeeded', 'instance-local', '1', '{}', 'A ride.', NULL, 23, 24)`,
  analysis_event: `INSERT INTO analysis_event VALUES ('job-a', 'a', 1, 'result', '{}', 24)`,
  // The columns named, so migration 0023's `reasoning_tokens` is NULL (#1268).
  athlete_hosted_key: `INSERT INTO athlete_hosted_key (athlete_id, url, model, iv, ciphertext, set_at) VALUES ('a', 'https://models.example/v1', 'm', x'000102030405060708090a0b', x'ffee', 25)`,
  athlete_hosted_consent: `INSERT INTO athlete_hosted_consent VALUES ('a', 'https://models.example', 26)`,
  athlete_tactics_consent: `INSERT INTO athlete_tactics_consent VALUES ('a', 'http://ollama:11434/v1', 26)`,
  room_removal: `INSERT INTO room_removal VALUES ('room', 'a', 23)`,
  moderation_log: `INSERT INTO moderation_log (id, actor_athlete_id, action, target_athlete_id, reason, at) VALUES (1, 'a', 'suspend', 'b', 'Why', 12)`,
  statement: `INSERT INTO statement VALUES (1, 'b', 'suspend', 'Facts', 'report', NULL, 'Terms 2', NULL, 0, NULL, 28)`,
  appeal: `INSERT INTO appeal VALUES (1, 1, 'b', 'Grounds', 29, NULL, NULL, NULL, NULL, NULL)`,
  notice: `INSERT INTO notice VALUES (1, 27, 'illegal_content', 'Why', '["room:0123456789abcdef0123456789abcdef"]', NULL, NULL, NULL, 0)`,
  notice_step: `INSERT INTO notice_step VALUES (1, 1, 'decided', 'a', 'Not illegal', 1, 30)`,
  notice_erasure: `INSERT INTO notice_erasure VALUES (1, 0, 0, 32)`,
  hidden_item: `INSERT INTO hidden_item VALUES (1, 'room:0123456789abcdef0123456789abcdef', 'b', 31, NULL)`,
  // #68: after `activity_record`, which an effort's ride is a foreign key to.
  segment: `INSERT INTO segment VALUES ('${'a'.repeat(32)}', 'a', 'S', 'ride', 555.5, '{}', 33)`,
  // The columns named, so migration 0039's `excluded_reason` is NULL (#69).
  segment_effort: `INSERT INTO segment_effort (id, athlete_id, segment_id, content_sha256, started_at, elapsed_seconds, visibility, received_at) VALUES ('effort-a', 'a', '${'a'.repeat(32)}', '${'1'.repeat(64)}', 34, 60.5, 'public', 35)`,
  segment_flag: `INSERT INTO segment_flag VALUES (1, 'a', '${'a'.repeat(32)}', 'effort-a', 'a', 'sha-a', 'vehicle', 36)`,
  segment_integrity_log: `INSERT INTO segment_integrity_log VALUES (1, 37, 'flagged_effort', 'a', 'a', '${'a'.repeat(32)}', 'effort-a', 'vehicle')`,
  // #2602: a CLI entry, so it names no athlete.
  operator_log: `INSERT INTO operator_log VALUES (1, 38, 'cli', NULL, 'migrate', 'applied=1', 'done')`,
  // #2606: a snapshot the backup service made, and the request it served.
  backup_record: `INSERT INTO backup_record VALUES (1, 39, 'done', NULL, 'snapshot-x', 10, 2, '${'e'.repeat(64)}', 4096, 'copied', 0, 1000, 2000, 21600)`,
  backup_request: `INSERT INTO backup_request VALUES (1, 39, 1)`,
  backup_lease: `INSERT INTO backup_lease VALUES ('${'f'.repeat(64)}', 'token', 'host:1', 40)`,
  // #2609: the operator's settings row, every column set.
  analysis_setting: `INSERT INTO analysis_setting VALUES (1, 'http://ollama:11434/v1', 'm', 512, 1, 0, 1, 39, 'cli')`,
  // #2641: a code redeemed, and the session it opened for athlete 'a'.
  admin_code: `INSERT INTO admin_code VALUES ('${'a1'.repeat(32)}', 41, 641, 42, 'cli')`,
  admin_session: `INSERT INTO admin_session VALUES ('${'a2'.repeat(32)}', 'a', 'key-a', 'tunnel', 'code', '${'a3'.repeat(32)}', 42, 43, 7242)`,
  // #2642: a passkey, the session above tied to it, and a sign-in's challenge.
  admin_passkey: `INSERT INTO admin_passkey VALUES ('p1', 'cred-1', 'ride.example', 'es256', '04ab', 0, 'aGFuZGxl', 'key-a', 'Laptop', 'tunnel', 44, NULL, NULL)`,
  admin_passkey_session: `INSERT INTO admin_passkey_session VALUES ('${'a2'.repeat(32)}', 'p1')`,
  admin_challenge: `INSERT INTO admin_challenge VALUES ('${'a4'.repeat(32)}', 'sign_in', NULL, NULL, NULL, NULL, 165)`,
  // #2782: a claim code a device redeemed and the owner has not yet decided, and an owner claimed.
  owner_claim_code: `INSERT INTO owner_claim_code VALUES ('${'b1'.repeat(32)}', 45, 645, 46, '${'b2'.repeat(32)}', '012345')`,
  instance_owner: `INSERT INTO instance_owner VALUES (1, '${'b3'.repeat(32)}', 47)`,
  // #2784: the setup at its backups step, a code, a session, and a mode the database holds.
  setup_state: `INSERT INTO setup_state VALUES (1, 'backups', NULL, NULL, 48)`,
  setup_code: `INSERT INTO setup_code VALUES ('${'c1'.repeat(32)}', 48, 648, NULL, 'start')`,
  setup_session: `INSERT INTO setup_session VALUES ('${'c2'.repeat(32)}', '${'c3'.repeat(32)}', 48, 48, 7248, NULL)`,
  instance_setting: `INSERT INTO instance_setting VALUES (1, 'closed', 48, 'setup')`,
};

/**
 * A table a migration's `down` REFUSES to drop while it holds a row, by
 * migration: the moderation log (#83, #891's review). The round trip below
 * leaves that one table empty for that one migration, and a test of its own
 * holds the refusal.
 */
const EMPTY_FOR_ITS_OWN_DOWN: Readonly<Record<string, string>> = {
  '0007-moderation': 'moderation_log',
  '0026-notices': 'notice',
  '0027-statements': 'statement',
  '0028-appeals': 'appeal',
  '0029-notice-steps': 'notice_step',
  '0030-hidden-items': 'hidden_item',
  '0036-notice-erasure': 'notice_erasure',
  '0039-leaderboard-integrity': 'segment_integrity_log',
  '0040-operator-log': 'operator_log',
  // Not a refusal: 0045's `down` ENDS every session a passkey opened (#2642),
  // so the earlier rows it keeps are counted with no session tied to a
  // passkey; a test of its own holds what it ends and what it keeps.
  '0045-admin-passkeys': 'admin_passkey_session',
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

/** A database at `path` migrated through `name` and no further. */
async function migratedThrough(path: string, name: string): Promise<void> {
  await withKysely(path, async (db) => {
    await migrateToLatest(db);
    while ((await appliedMigrations(db)).at(-1) !== name) await migrateDownOne(db);
  });
}

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
   * ⚠️ **It keeps Vitest's 5 s default, judged against CI under coverage**
   * (docs/agents/ci.md §4c). Before the walk, on `Tests and coverage report`:
   * 505–993 ms on 34 of 38 green runs read on 2026-10-01 (36843950489 to
   * 36882904839), then 1 140, 1 829, 2 775 and 3 293 ms (36849145949,
   * 36881644356, 36877000180, 36845803725); and over Vitest's 5 s, so red,
   * 6 737 ms on 36860095171 attempt 1 (#975) and 11 237 ms on 36884103033
   * attempt 1 (#984). Every figure over 2.5 s was an Intel Xeon 6973P-C. The
   * walk took 327 ms on its first CI run (36891647825, an AMD EPYC 9V74), and
   * 618 and 602 ms on the nightly coverage job (43207158376, 43008116660,
   * EPYC 9V74 both). #2550 took away the 35 s it had carried for the old
   * shape (#1688's ruling: make a slow case cheaper, never raise a timeout).
   */
  it('each one, undone, leaves the schema and the rows exactly as they were before it', async () => {
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
  });

  it('takes a lap race’s columns away with 0037, and every room made before reads the same through the room plan, down and up again (#1910)', async () => {
    const path = await freshPath();
    await withKysely(path, async (db) => {
      await migrateToLatest(db);
      while ((await appliedMigrations(db)).at(-1) !== '0036-notice-erasure') {
        await migrateDownOne(db);
      }
    });
    // An existing room — the fixture's race and its course — as every room
    // made before 0037 is. Its physics moved to this build's, so it opens.
    seedEveryTable(path);
    {
      const database = openDatabase(path);
      try {
        database
          .prepare(`UPDATE room SET physics_version = ? WHERE id = 'room'`)
          .run(PHYSICS_VERSION);
      } finally {
        database.close();
      }
    }
    const columns = (): string[] => {
      const database = openDatabase(path);
      try {
        return (database.prepare(`PRAGMA table_info(room_course)`).all() as { name: string }[])
          .map((column) => column.name)
          .filter((name) => name.startsWith('lap_'));
      } finally {
        database.close();
      }
    };
    // Read as the room is opened: the store's course read, into the plan.
    const plan = () =>
      withKysely(path, async (db) => {
        const store = createSqlStore(db);
        const room = await store.getRoom('room');
        return room === undefined
          ? undefined
          : planFor(room, await store.getRoomCourse('room'), 'any-seated-rider');
      });
    const before = await plan();
    expect(before).toMatchObject({ roomId: 'room', kind: 'race', lengthMetres: 450 });
    expect(before?.lapRace).toBeUndefined();
    expect(columns()).toEqual([]);

    await withKysely(path, (db) => migrateUpOne(db));
    expect(columns()).toEqual(['lap_laps', 'lap_items', 'lap_seed']);
    expect(await plan()).toEqual(before);

    await withKysely(path, (db) => migrateDownOne(db));
    expect(columns()).toEqual([]);
    expect(await plan()).toEqual(before);

    await withKysely(path, (db) => migrateUpOne(db));
    expect(columns()).toEqual(['lap_laps', 'lap_items', 'lap_seed']);
    expect(await plan()).toEqual(before);
  });

  it('holds 0037’s three columns together and in range, as a CHECK (#1910)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    seedEveryTable(path);
    const database = openDatabase(path);
    try {
      const set = (laps: unknown, items: unknown, seed: unknown) => () =>
        database
          .prepare(
            `UPDATE room_course SET lap_laps = ?, lap_items = ?, lap_seed = ? WHERE room_id = 'room'`,
          )
          .run(laps as number, items as number, seed as number);
      expect(set(3, 1, 4_294_967_295)).not.toThrow();
      expect(set(null, null, null)).not.toThrow();
      for (const [laps, items, seed] of [
        [3, 1, null],
        [3, null, 7],
        [null, 1, 7],
        [0, 1, 7],
        [101, 1, 7],
        [3, 2, 7],
        [3, 1, -1],
        [3, 1, 4_294_967_296],
      ]) {
        expect(set(laps, items, seed), JSON.stringify([laps, items, seed])).toThrow(/CHECK/);
      }
    } finally {
      database.close();
    }
  });

  it('holds 0047’s pending claim together, its comparison code six digits, and one owner row, as CHECKs (#2782)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    seedEveryTable(path);
    const database = openDatabase(path);
    try {
      const set = (at: unknown, key: unknown, comparison: unknown) => () =>
        database
          .prepare(
            `UPDATE owner_claim_code SET redeemed_at = ?, device_key = ?, comparison_code = ?`,
          )
          .run(at as number, key as string, comparison as string);
      expect(set(null, null, null)).not.toThrow();
      expect(set(46, 'key', '000000')).not.toThrow();
      for (const [at, key, comparison] of [
        [46, null, '012345'],
        [46, 'key', null],
        [null, 'key', '012345'],
        [46, 'key', '12345'],
        [46, 'key', '1234567'],
        [46, 'key', '01234a'],
      ]) {
        expect(set(at, key, comparison), JSON.stringify([at, key, comparison])).toThrow(/CHECK/);
      }
      // One owner: the slot is 1, and a second row cannot be written.
      expect(() => database.exec(`INSERT INTO instance_owner VALUES (2, 'another', 48)`)).toThrow(
        /CHECK/,
      );
      expect(() => database.exec(`INSERT INTO instance_owner VALUES (1, 'another', 48)`)).toThrow(
        /UNIQUE|PRIMARY/,
      );
    } finally {
      database.close();
    }
  });

  it('widens 0048’s operator log for the setup and the start, naming no athlete, and holds its rows to their CHECKs (#2784)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO operator_log VALUES (1, 48, 'setup', NULL, 'setup_sign_in', NULL, 'done')`,
      );
      database.exec(
        `INSERT INTO operator_log VALUES (2, 48, 'start', NULL, 'secret_generated', 'metrics_token', 'done')`,
      );
      for (const refused of [
        `INSERT INTO operator_log VALUES (3, 48, 'setup', 'a', 'setup_sign_in', NULL, 'done')`,
        `INSERT INTO operator_log VALUES (3, 48, 'start', 'a', 'secret_generated', NULL, 'done')`,
        `INSERT INTO operator_log VALUES (3, 48, 'wizard', NULL, 'setup_sign_in', NULL, 'done')`,
        `INSERT INTO setup_state VALUES (2, 'claim', NULL, NULL, 48)`,
        `INSERT INTO setup_state VALUES (1, 'welcome', NULL, NULL, 48)`,
        `INSERT INTO setup_code VALUES ('x', 48, 648, NULL, 'app')`,
        `INSERT INTO instance_setting VALUES (1, 'everyone', 48, 'setup')`,
        `INSERT INTO instance_setting VALUES (2, 'open', 48, 'setup')`,
        `INSERT INTO instance_setting VALUES (1, 'open', 48, 'app')`,
      ]) {
        expect(() => database.exec(refused), refused).toThrow(/CHECK constraint failed/);
      }
      expect(() => database.exec(`DELETE FROM operator_log WHERE id = 1`)).toThrow(/append-only/);
      expect(() => database.exec(`UPDATE operator_log SET outcome = 'failed'`)).toThrow(
        /append-only/,
      );
    } finally {
      database.close();
    }
  });

  it('refuses to undo 0048 while the operator log holds a setup or start entry, and changes nothing; with none it keeps every entry and its id (#2784)', async () => {
    const path = await freshPath();
    await migratedThrough(path, '0048-first-run-setup');
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO operator_log VALUES (7, 38, 'admin_tunnel', 'a', 'admin_sign_in', 'code', 'done')`,
      );
      database.exec(
        `INSERT INTO operator_log VALUES (9, 48, 'start', NULL, 'setup_code_minted', NULL, 'done')`,
      );
    } finally {
      database.close();
    }
    const before = snapshot(path);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /holds entries from the setup wizard/,
    );
    expect(snapshot(path)).toEqual(before);

    const other = await freshPath();
    await migratedThrough(other, '0048-first-run-setup');
    const seeded = openDatabase(other);
    try {
      seeded.exec(
        `INSERT INTO operator_log VALUES (7, 38, 'admin_tunnel', 'a', 'admin_sign_in', 'code', 'done')`,
      );
    } finally {
      seeded.close();
    }
    await withKysely(other, (db) => migrateDownOne(db));
    const after = openDatabase(other);
    try {
      expect(after.prepare('SELECT id, source FROM operator_log').all()).toEqual([
        { id: 7, source: 'admin_tunnel' },
      ]);
      expect(() =>
        after.exec(
          `INSERT INTO operator_log VALUES (8, 48, 'setup', NULL, 'setup_done', NULL, 'done')`,
        ),
      ).toThrow(/CHECK constraint failed/);
      expect(() => after.exec(`DELETE FROM operator_log`)).toThrow(/append-only/);
    } finally {
      after.close();
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

  it('refuses to undo 0040 while the operator log holds an entry, and changes nothing (#2602)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0040-operator-log') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const before = snapshot(path);
    expect(before.rows.operator_log).toBe(1);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /operator log holds entries/,
    );
    expect(snapshot(path)).toEqual(before);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0040-operator-log');
    });
  });

  it('keeps the operator log append-only through 0044’s rebuild, and widens its sources and actor rule (#2641)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO operator_log VALUES (1, 38, 'cli', NULL, 'migrate', 'applied=1', 'done')`,
      );
      // The admin sources, naming the owner or nobody.
      database.exec(
        `INSERT INTO operator_log VALUES (2, 39, 'admin_tunnel', 'a', 'admin_sign_in', 'code', 'done')`,
      );
      database.exec(
        `INSERT INTO operator_log VALUES (3, 40, 'admin_loopback', NULL, 'admin_refused', 'code,refused=2', 'refused')`,
      );
      for (const refused of [
        `INSERT INTO operator_log VALUES (4, 41, 'web', NULL, 'migrate', NULL, 'done')`,
        `INSERT INTO operator_log VALUES (4, 41, 'cli', 'a', 'migrate', NULL, 'done')`,
        `INSERT INTO operator_log VALUES (4, 41, 'app', NULL, 'migrate', NULL, 'done')`,
      ]) {
        expect(() => database.exec(refused), refused).toThrow(/CHECK constraint failed/);
      }
      expect(() => database.exec(`UPDATE operator_log SET outcome = 'failed'`)).toThrow(
        /append-only/,
      );
      expect(() => database.exec(`DELETE FROM operator_log WHERE id = 1`)).toThrow(/append-only/);
    } finally {
      database.close();
    }
  });

  it('refuses to undo 0044 while the operator log holds an admin entry, and changes nothing; with none it keeps every entry and its id (#2641)', async () => {
    const path = await freshPath();
    await migratedThrough(path, '0044-admin-sign-in');
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO operator_log VALUES (7, 38, 'cli', NULL, 'migrate', 'applied=1', 'done')`,
      );
      database.exec(
        `INSERT INTO operator_log VALUES (9, 39, 'admin_tunnel', NULL, 'admin_refused', 'code,refused=1', 'refused')`,
      );
    } finally {
      database.close();
    }
    const before = snapshot(path);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0044-admin-sign-in');
    });
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /holds entries from the admin pages/,
    );
    expect(snapshot(path)).toEqual(before);

    // With no admin entry, `down` goes, and the CLI's entry stays with its id.
    const other = await freshPath();
    await migratedThrough(other, '0044-admin-sign-in');
    const seeded = openDatabase(other);
    try {
      seeded.exec(
        `INSERT INTO operator_log VALUES (7, 38, 'cli', NULL, 'migrate', 'applied=1', 'done')`,
      );
    } finally {
      seeded.close();
    }
    await withKysely(other, (db) => migrateDownOne(db));
    const after = openDatabase(other);
    try {
      expect(after.prepare('SELECT id, source FROM operator_log').all()).toEqual([
        { id: 7, source: 'cli' },
      ]);
      expect(() => after.exec(`UPDATE operator_log SET outcome = 'failed'`)).toThrow(/append-only/);
      expect(() =>
        after.exec(
          `INSERT INTO operator_log VALUES (8, 39, 'admin_tunnel', NULL, 'admin_refused', NULL, 'refused')`,
        ),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      after.close();
    }
  });

  it('takes 0045’s passkeys away with every session they opened, and leaves every other row as it was, down and up again (#2642)', async () => {
    const path = await freshPath();
    // Up to 0045 and no further: the migrations after it are undone first (#2709's 0046).
    await withKysely(path, async (db) => {
      await migrateToLatest(db);
      while ((await appliedMigrations(db)).at(-1) !== '0045-admin-passkeys') {
        await migrateDownOne(db);
      }
    });
    // Every table seeded, then a second session, opened with a code, that no passkey opened.
    seedEveryTable(path);
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO admin_session VALUES ('${'b2'.repeat(32)}', 'a', 'key-a', 'tunnel', 'code', '${'b3'.repeat(32)}', 50, 51, 7250)`,
      );
      database.exec(
        `INSERT INTO operator_log VALUES (11, 52, 'admin_tunnel', 'a', 'admin_passkey_enrolled', 'es256', 'done')`,
      );
    } finally {
      database.close();
    }
    const before = snapshot(path);
    expect(before.rows).toMatchObject({
      admin_passkey: 1,
      admin_passkey_session: 1,
      admin_session: 2,
    });
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0045-admin-passkeys');
      await migrateDownOne(db);
    });
    const undone = snapshot(path);
    const { admin_passkey, admin_passkey_session, admin_challenge, ...rest } = before.rows;
    expect([admin_passkey, admin_passkey_session, admin_challenge]).toEqual([1, 1, 1]);
    // The passkey's session is ended; the code session and every other row stay.
    expect(undone.rows).toEqual({ ...rest, admin_session: 1 });
    const kept = openDatabase(path);
    try {
      expect(kept.prepare('SELECT token_sha256 FROM admin_session').all()).toEqual([
        { token_sha256: 'b2'.repeat(32) },
      ]);
      // The log's entry about the passkey stays: the log is append-only.
      expect(kept.prepare('SELECT action FROM operator_log WHERE id = 11').all()).toEqual([
        { action: 'admin_passkey_enrolled' },
      ]);
    } finally {
      kept.close();
    }
    await withKysely(path, (db) => migrateUpOne(db));
    const redone = snapshot(path);
    expect(redone.schema).toEqual(before.schema);
    expect(redone.rows).toEqual({
      ...undone.rows,
      admin_passkey: 0,
      admin_passkey_session: 0,
      admin_challenge: 0,
    });
  });

  it('refuses to undo 0039 while the leaderboard integrity log holds an entry, and changes nothing (#69)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0039-leaderboard-integrity') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const before = snapshot(path);
    expect(before.rows.segment_integrity_log).toBe(1);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /integrity log holds entries/,
    );
    expect(snapshot(path)).toEqual(before);
    // And the log is append-only in the schema: no UPDATE, no DELETE.
    const database = openDatabase(path);
    try {
      expect(() => database.exec('UPDATE segment_integrity_log SET reason = 1')).toThrow(
        /append-only/,
      );
      expect(() => database.exec('DELETE FROM segment_integrity_log')).toThrow(/append-only/);
      // Erasure's updates (#69, the owner's rulings of 2026-11-06): an erased
      // athlete's id emptied from the actor and the subject, nothing else, and
      // only once no athlete holds it.
      const row = () =>
        database
          .prepare(
            'SELECT id, at, action, actor_athlete_id AS actor, subject_athlete_id AS subject, segment_id AS segment, effort_id AS effort, reason FROM segment_integrity_log',
          )
          .get() as Record<string, unknown>;
      const seeded = row();
      expect(seeded).toMatchObject({ actor: 'a', subject: 'a' });
      const refused = (set: string) => {
        expect(() => database.exec(`UPDATE segment_integrity_log SET ${set}`), set).toThrow(
          /append-only/,
        );
      };
      // Athlete `a` is seeded: while it exists, its id stays, as actor and as subject.
      refused('actor_athlete_id = NULL');
      refused('subject_athlete_id = NULL');
      // Erased (the seed's other rows still point at it, so without their keys checked).
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec("DELETE FROM athlete WHERE id = 'a'");
      // Each other column, changed beside an allowed emptying, is refused —
      // one probe per condition the trigger holds.
      for (const emptied of ['actor_athlete_id = NULL', 'subject_athlete_id = NULL']) {
        refused(`${emptied}, id = id + 1`);
        refused(`${emptied}, at = at + 1`);
        refused(`${emptied}, action = 'excluded'`);
        refused(`${emptied}, segment_id = '${'b'.repeat(32)}'`);
        refused(`${emptied}, effort_id = NULL`);
        refused(`${emptied}, effort_id = 'effort-b'`);
        refused(`${emptied}, reason = 'other'`);
      }
      // An id is emptied, never replaced by another.
      refused("actor_athlete_id = 'b'");
      refused("subject_athlete_id = 'b'");
      refused("actor_athlete_id = NULL, subject_athlete_id = 'b'");
      refused("subject_athlete_id = NULL, actor_athlete_id = 'b'");
      expect(row()).toEqual(seeded);
      database.exec('UPDATE segment_integrity_log SET actor_athlete_id = NULL');
      database.exec('UPDATE segment_integrity_log SET subject_athlete_id = NULL');
      expect(row()).toEqual({ ...seeded, actor: null, subject: null });
    } finally {
      database.close();
    }
  });

  it('refuses to undo 0026 while a notice has been received, and changes nothing (#907)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0026-notices') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const before = snapshot(path);
    expect(before.rows.notice).toBe(1);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /has received notices/,
    );
    expect(snapshot(path)).toEqual(before);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0026-notices');
    });
  });

  it('refuses to undo 0036 while a notice’s notifier details have been erased, and changes nothing (#1381)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0036-notice-erasure') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const before = snapshot(path);
    expect(before.rows.notice_erasure).toBe(1);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /notifier details have been erased/,
    );
    expect(snapshot(path)).toEqual(before);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0036-notice-erasure');
    });
  });

  it('refuses to undo 0032 while a load-run account is held, and changes nothing (#1383)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0032-load-accounts') {
        await migrateDownOne(db);
      }
    });
    seedEveryTable(path);
    const database = openDatabase(path);
    try {
      database.exec(
        `INSERT INTO athlete (id, display_name, created_at, registration_state, load_run_at) VALUES ('load', 'Load 1', 32, 'active', 32)`,
      );
    } finally {
      database.close();
    }
    const before = snapshot(path);
    await expect(withKysely(path, (db) => migrateDownOne(db))).rejects.toThrow(
      /throwaway accounts are held/,
    );
    expect(snapshot(path)).toEqual(before);
    await withKysely(path, async (db) => {
      expect((await appliedMigrations(db)).at(-1)).toBe('0032-load-accounts');
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
    // Stop at 0020 (#2555): the per-migration walk already proves that the
    // downs of 0021 onward restore the schema, so going to the newest and back
    // down would reach this same schema at several times the cost.
    await withKysely(path, (db) =>
      migrateToLatest(
        db,
        Object.fromEntries(
          Object.entries(MIGRATIONS).filter(([name]) => name <= '0020-analysis-jobs'),
        ),
      ),
    );
    expect((await withKysely(path, (db) => appliedMigrations(db))).at(-1)).toBe(
      '0020-analysis-jobs',
    );
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

  it('takes the operator’s analysis settings away with 0043, row and all — every field back to .env — and puts the table back empty (#2609)', async () => {
    const path = await freshPath();
    await withKysely(path, (db) => migrateToLatest(db));
    const settingsRead = () =>
      withKysely(path, (db) =>
        createSqlStore(db as unknown as Parameters<typeof createSqlStore>[0]).getAnalysisSetting(),
      );
    await withKysely(path, (db) =>
      createSqlStore(db as unknown as Parameters<typeof createSqlStore>[0]).putAnalysisSetting({
        localUrl: 'http://ollama:11434/v1',
        localModel: 'm',
        reasoningTokens: null,
        offerLocal: null,
        offerHosted: false,
        othersLocal: true,
        updatedAt: 40,
        updatedBy: 'app',
      }),
    );
    expect(await settingsRead()).toMatchObject({ localModel: 'm', othersLocal: true });
    await withKysely(path, async (db) => {
      while ((await appliedMigrations(db)).at(-1) !== '0043-analysis-setting') {
        await migrateDownOne(db);
      }
      await migrateDownOne(db);
    });
    expect(snapshot(path).rows.analysis_setting).toBeUndefined();
    await withKysely(path, (db) => migrateToLatest(db));
    expect(await settingsRead()).toBeUndefined();
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
