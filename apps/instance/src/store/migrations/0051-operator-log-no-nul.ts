// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0051 (#2618): **the operator log's `detail` refuses an embedded
 * NUL.**
 *
 * The `CHECK` on `detail` (migration 0040, rebuilt by 0044 and 0048) holds it
 * to lower-case letters, digits, `_`, `=` and `,`, at most 200 characters.
 * SQLite's `glob` and `length` both stop at the first NUL, so a value such as
 * `applied=1` + NUL + `Any Text At All` passed both: everything after the NUL
 * was never looked at. `instr(detail, char(0)) = 0` closes that: the code's
 * vocabulary (`sql-store.ts` §`OPERATOR_DETAILS`) never writes one, so only a
 * `sqlite3` session could, and now it cannot either.
 *
 * SQLite adds a `CHECK` only by rebuilding its table, so `operator_log` is
 * rebuilt as 0048 made it with the one clause added, and its rows copied with
 * their ids. ⚠️ Dropping the table drops its two append-only triggers, so both
 * are created again, word for word as migration 0040 wrote them.
 *
 * `up` is refused, changing nothing, while the log holds a `detail` with a
 * NUL in it: the log is append-only, so the entry cannot be cleaned, and
 * copying it would fail the new `CHECK`. The refusal names no value.
 *
 * `down` rebuilds the log as 0048 made it, rows and ids kept: every row the
 * narrower table holds fits the wider one.
 */

import { sql, type Kysely } from 'kysely';

/** The `detail` CHECK as 0040 wrote it, and with the NUL refused. */
const DETAIL_BEFORE = sql`detail is null or (length(detail) between 1 and 200 and detail not glob '*[^a-z0-9_=,]*')`;
const DETAIL_AFTER = sql`detail is null or (length(detail) between 1 and 200 and detail not glob '*[^a-z0-9_=,]*' and instr(detail, char(0)) = 0)`;

/** The operator log as 0048 made it, with `detail` held by `detailCheck`. */
async function createOperatorLog(
  db: Kysely<unknown>,
  detailCheck: typeof DETAIL_BEFORE,
): Promise<void> {
  await db.schema
    .createTable('operator_log')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('source', 'text', (column) =>
      column
        .notNull()
        .check(sql`source in ('app', 'cli', 'admin_tunnel', 'admin_loopback', 'setup', 'start')`),
    )
    .addColumn('actor_athlete_id', 'text')
    .addColumn('action', 'text', (column) => column.notNull())
    // A second line behind the code's per-action vocabulary: a `sqlite3`
    // session still cannot write a space, a capital, a sign or a point here.
    .addColumn('detail', 'text', (column) => column.check(detailCheck))
    .addColumn('outcome', 'text', (column) =>
      column.notNull().check(sql`outcome in ('done', 'refused', 'failed')`),
    )
    .addCheckConstraint(
      'operator_log_actor',
      sql`(source = 'app' and actor_athlete_id is not null) or (source in ('cli', 'setup', 'start') and actor_athlete_id is null) or source in ('admin_tunnel', 'admin_loopback')`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  // Word for word as migration 0040 wrote them, so `down` leaves the schema as it found it.
  await sql`create trigger operator_log_no_update before update on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
  await sql`create trigger operator_log_no_delete before delete on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
}

/** The log rebuilt under `detailCheck`, every row and id copied across. */
async function rebuildOperatorLog(
  db: Kysely<unknown>,
  detailCheck: typeof DETAIL_BEFORE,
): Promise<void> {
  await sql`create table operator_log_0051_copy as select * from operator_log`.execute(db);
  // Dropping the table drops its triggers with it; no DELETE runs, so neither fires.
  await sql`drop table operator_log`.execute(db);
  await createOperatorLog(db, detailCheck);
  await sql`insert into operator_log (id, at, source, actor_athlete_id, action, detail, outcome)
    select id, at, source, actor_athlete_id, action, detail, outcome
    from operator_log_0051_copy order by id`.execute(db);
  await sql`drop table operator_log_0051_copy`.execute(db);
}

/** What `up` throws while the operator log holds a `detail` with an embedded NUL. */
export class NulDetailLoggedError extends Error {
  override readonly name = 'NulDetailLoggedError';
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from operator_log
    where instr(detail, char(0)) > 0`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new NulDetailLoggedError(
      'Migration 0051 cannot be applied: the operator log holds an entry whose detail has an embedded NUL character, which no command writes, and the log is append-only, so it cannot be cleaned. Nothing was changed.',
    );
  }
  await rebuildOperatorLog(db, DETAIL_AFTER);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await rebuildOperatorLog(db, DETAIL_BEFORE);
}
