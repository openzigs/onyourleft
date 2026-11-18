// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0048 (#2784, ADR 0080 D-1, D-2, D-6, D-7): **the first-run setup
 * wizard** on the loopback listener, its settings, and the operator log
 * widened for it.
 *
 * - **`setup_state`** — at most one row (`slot` is always 1): the wizard step
 *   the setup is on, so it resumes there after a restart; when the setup was
 *   done (`NULL` while it is open — ADR 0080 D-7's *done* is a row with this
 *   set, read on every request); and when the setup minted its one rider
 *   invite. No row is *open*, at the claim step.
 * - **`setup_code`** — a setup code minted at a start of the instance or by
 *   `operator setup-code`: the SHA-256 of its normalised form (never the
 *   code), when it was minted and expires (Unix seconds), when it was used
 *   (`NULL` until then), and what minted it (`start` or `cli`).
 * - **`setup_session`** — a browser's setup session: the SHA-256 of its
 *   cookie's token (never the token), the SHA-256 of its CSRF token, when it
 *   was created, last seen and expires, and when it downloaded the emergency
 *   kit (`NULL` until then: ADR 0080 D-4's *once per setup session*). It
 *   names no athlete: before the claim there is none.
 * - **`instance_setting`** — at most one row: the registration mode the
 *   wizard or `operator registration set` chose (`NULL`: the environment's),
 *   when, and from where (`setup` or `cli`). ADR 0080 D-6: while it is set
 *   the database wins over `OYL_INSTANCE_REGISTRATION`.
 * - **`operator_log`** is rebuilt, as 0044 rebuilt it, because SQLite widens a
 *   `CHECK` only by rebuilding its table: `source` gains `setup` (the wizard)
 *   and `start` (the instance's own start: a secret it generated, a setup code
 *   it minted — #2781 deferred that entry here), and both name no athlete.
 *   The rows are copied with their ids. ⚠️ Dropping the table drops its two
 *   append-only triggers, so both are created again, word for word as
 *   migration 0040 wrote them.
 *
 * `down` is refused while the operator log holds an entry from either new
 * source, rather than drop audit entries, and says so. Otherwise it rebuilds
 * the log as 0044 made it, rows and ids kept, and drops the four tables: an
 * instance then reads its registration mode from `.env` again, and the setup
 * wizard is gone with the code that serves it. No rider's data is in any of
 * them.
 */

import { sql, type Kysely } from 'kysely';

/** The wizard's steps, in order (`setup/setup-routes.ts` §`SETUP_STEPS`). */
const STEPS = sql`step in ('claim', 'passkey', 'secrets', 'backups', 'registration', 'invite', 'finish')`;

/** The operator log as 0044 made it, or as this migration widens it. */
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
            ? sql`source in ('app', 'cli', 'admin_tunnel', 'admin_loopback', 'setup', 'start')`
            : sql`source in ('app', 'cli', 'admin_tunnel', 'admin_loopback')`,
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
        ? sql`(source = 'app' and actor_athlete_id is not null) or (source in ('cli', 'setup', 'start') and actor_athlete_id is null) or source in ('admin_tunnel', 'admin_loopback')`
        : sql`(source = 'app' and actor_athlete_id is not null) or (source = 'cli' and actor_athlete_id is null) or source in ('admin_tunnel', 'admin_loopback')`,
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
  await sql`create table operator_log_0048_copy as select * from operator_log`.execute(db);
  // Dropping the table drops its triggers with it; no DELETE runs, so neither fires.
  await sql`drop table operator_log`.execute(db);
  await createOperatorLog(db, widened);
  await sql`insert into operator_log (id, at, source, actor_athlete_id, action, detail, outcome)
    select id, at, source, actor_athlete_id, action, detail, outcome
    from operator_log_0048_copy order by id`.execute(db);
  await sql`drop table operator_log_0048_copy`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('setup_state')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('step', 'text', (column) => column.notNull().check(STEPS))
    .addColumn('done_at', 'integer')
    .addColumn('invite_minted_at', 'integer')
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('setup_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('minted_at', 'integer', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .addColumn('minted_by', 'text', (column) =>
      column.notNull().check(sql`minted_by in ('start', 'cli')`),
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('setup_session')
    .addColumn('token_sha256', 'text', (column) => column.primaryKey())
    .addColumn('csrf_sha256', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('last_seen_at', 'integer', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('kit_downloaded_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('instance_setting')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('registration', 'text', (column) =>
      column.check(sql`registration in ('open', 'approval', 'invite', 'closed')`),
    )
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .addColumn('updated_by', 'text', (column) =>
      column.notNull().check(sql`updated_by in ('setup', 'cli')`),
    )
    .modifyEnd(sql`strict`)
    .execute();
  await rebuildOperatorLog(db, true);
}

/** What `down` throws while the operator log holds an entry from the setup or the start. */
export class SetupEntriesLoggedError extends Error {
  override readonly name = 'SetupEntriesLoggedError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const logged = await sql<{ n: number }>`select count(*) as n from operator_log
    where source in ('setup', 'start')`.execute(db);
  if (Number(logged.rows[0]?.n ?? 0) > 0) {
    throw new SetupEntriesLoggedError(
      'Migration 0048 cannot be undone: the operator log holds entries from the setup wizard or the instance’s own start, which the log before it cannot hold, and undoing it would delete them. Nothing was changed.',
    );
  }
  await rebuildOperatorLog(db, false);
  await db.schema.dropTable('instance_setting').execute();
  await db.schema.dropTable('setup_session').execute();
  await db.schema.dropTable('setup_code').execute();
  await db.schema.dropTable('setup_state').execute();
}
