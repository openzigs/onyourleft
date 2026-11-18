// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0044 (#2641, ADR 0069 D-1, D-4, D-8): **the admin pages' one-time
 * codes and sessions**, and the operator log widened for the admin channel.
 *
 * - **`admin_code`** — a code `operator admin-code` minted: the SHA-256 of
 *   its normalised form (never the code), when it was minted and when it
 *   expires (Unix seconds), when it was used (`NULL` until then), and what
 *   minted it (`cli`; `app` is allowed for the day ADR 0069 D-11 Q-B is
 *   answered otherwise, and nothing writes it today). It names no athlete.
 * - **`admin_session`** — a browser's admin session: the SHA-256 of its
 *   cookie's token (never the token), the owner athlete it was opened for and
 *   the `OYL_INSTANCE_OWNER_KEY` that athlete held at sign-in, which listener
 *   it is on (`tunnel`; `loopback` is #2643's), how it was opened (`code`;
 *   `passkey` is #2642's), the SHA-256 of its CSRF token, and when it was
 *   created, last seen and expires absolutely. A foreign key to `athlete`,
 *   so erasing the account ends it (`eraseAthlete` derives its tables from
 *   those keys).
 * - **`operator_log`** is rebuilt, because SQLite widens a `CHECK` only by
 *   rebuilding its table: `source` gains `admin_tunnel` and `admin_loopback`,
 *   and the actor rule lets those two name the owner's athlete or nobody (an
 *   `admin_refused` entry counts attempts by unknown parties, so it names
 *   none). The rows are copied with their ids. ⚠️ **Dropping the table drops
 *   its two append-only triggers**, so both are created again, word for word
 *   as migration 0040 wrote them.
 *
 * ADR 0069 D-8 also names an `admin_passkey` table and a session's passkey
 * and step-up columns. They are #2642's, which owns their shape; nothing here
 * would read them.
 *
 * `down` is refused while the operator log holds an entry from either admin
 * source, rather than drop audit entries, and says so; otherwise it drops the
 * two tables (every code and session goes, which signs every browser out) and
 * rebuilds the log as migration 0040 made it, rows and ids kept.
 */

import { sql, type Kysely } from 'kysely';

/** The operator log as migration 0040 made it, or as this one widens it. */
async function createOperatorLog(db: Kysely<unknown>, widened: boolean): Promise<void> {
  await db.schema
    .createTable('operator_log')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('source', 'text', (column) =>
      column
        .notNull()
        .check(
          widened
            ? sql`source in ('app', 'cli', 'admin_tunnel', 'admin_loopback')`
            : sql`source in ('app', 'cli')`,
        ),
    )
    .addColumn('actor_athlete_id', 'text')
    .addColumn('action', 'text', (column) => column.notNull())
    // A second line behind the code's per-action vocabulary: a `sqlite3`
    // session still cannot write a space, a capital, a sign or a point here.
    .addColumn('detail', 'text', (column) =>
      column.check(
        sql`detail is null or (length(detail) between 1 and 200 and detail not glob '*[^a-z0-9_=,]*')`,
      ),
    )
    .addColumn('outcome', 'text', (column) =>
      column.notNull().check(sql`outcome in ('done', 'refused', 'failed')`),
    )
    .addCheckConstraint(
      'operator_log_actor',
      widened
        ? sql`(source = 'app' and actor_athlete_id is not null) or (source = 'cli' and actor_athlete_id is null) or source in ('admin_tunnel', 'admin_loopback')`
        : sql`(source = 'app' and actor_athlete_id is not null) or (source = 'cli' and actor_athlete_id is null)`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  // Word for word as migration 0040 wrote them, so `down` leaves the schema as it found it.
  await sql`create trigger operator_log_no_update before update on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
  await sql`create trigger operator_log_no_delete before delete on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
}

/** The log rebuilt in its other shape, every row and id copied across. */
async function rebuildOperatorLog(db: Kysely<unknown>, widened: boolean): Promise<void> {
  await sql`create table operator_log_0044_copy as select * from operator_log`.execute(db);
  // Dropping the table drops its triggers with it; no DELETE runs, so neither fires.
  await sql`drop table operator_log`.execute(db);
  await createOperatorLog(db, widened);
  await sql`insert into operator_log (id, at, source, actor_athlete_id, action, detail, outcome)
    select id, at, source, actor_athlete_id, action, detail, outcome
    from operator_log_0044_copy order by id`.execute(db);
  await sql`drop table operator_log_0044_copy`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('minted_at', 'integer', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .addColumn('minted_by', 'text', (column) =>
      column.notNull().check(sql`minted_by in ('cli', 'app')`),
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('admin_session')
    .addColumn('token_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) =>
      column.notNull().references('athlete.id').onDelete('cascade'),
    )
    .addColumn('owner_key', 'text', (column) => column.notNull())
    .addColumn('listener', 'text', (column) =>
      column.notNull().check(sql`listener in ('tunnel', 'loopback')`),
    )
    .addColumn('strength', 'text', (column) =>
      column.notNull().check(sql`strength in ('code', 'passkey')`),
    )
    .addColumn('csrf_sha256', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('last_seen_at', 'integer', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('admin_session_athlete')
    .on('admin_session')
    .column('athlete_id')
    .execute();
  await rebuildOperatorLog(db, true);
}

/** What `down` throws while the operator log holds an admin channel's entry. */
export class AdminEntriesLoggedError extends Error {
  override readonly name = 'AdminEntriesLoggedError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const logged = await sql<{ n: number }>`select count(*) as n from operator_log
    where source in ('admin_tunnel', 'admin_loopback')`.execute(db);
  if (Number(logged.rows[0]?.n ?? 0) > 0) {
    throw new AdminEntriesLoggedError(
      'Migration 0044 cannot be undone: the operator log holds entries from the admin pages, which the log before it cannot hold, and undoing it would delete them. Nothing was changed.',
    );
  }
  await rebuildOperatorLog(db, false);
  await db.schema.dropIndex('admin_session_athlete').execute();
  await db.schema.dropTable('admin_session').execute();
  await db.schema.dropTable('admin_code').execute();
}
