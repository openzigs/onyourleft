// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0040 (#2602): **the operator log** — every action taken on the
 * instance as its operator, from the app's owner-only Operate area (#2601) or
 * from the operator's CLI (`src/operator/cli.ts`, the owner's ruling of
 * 2026-11-14 on #2601), modelled on the moderation log (migration 0007).
 *
 * - **`operator_log`** — one row per action: when (`at`, Unix seconds),
 *   where it came from (`source`: `app` or `cli`), who (`actor_athlete_id`:
 *   the owner's athlete for `app`, and `NULL` for `cli` — the CLI is run on
 *   the host and has no athlete, so it names none rather than borrowing the
 *   owner's), what (`action`, from the closed list in `sql-store.ts`
 *   §`OPERATOR_ACTIONS`), a short closed-vocabulary `detail` or `NULL`, and
 *   the `outcome`: `done`, `refused` or `failed`. The `CHECK`s hold the closed
 *   columns and the actor rule in the schema, not only in the code.
 *
 * ⚠️ **Append-only in the schema**, as the moderation log is: two triggers
 * abort any `UPDATE` or `DELETE`, so no code path — this repository's or an
 * operator's `sqlite3` session — rewrites the record quietly. It has no
 * foreign key to `athlete`, so erasing an account leaves what was done
 * (`eraseAthlete` derives its tables from those keys). And `down` is refused
 * while the log holds a single entry, so migrating back past 0040 cannot
 * delete it either.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('operator_log')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('source', 'text', (column) => column.notNull().check(sql`source in ('app', 'cli')`))
    .addColumn('actor_athlete_id', 'text')
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('detail', 'text')
    .addColumn('outcome', 'text', (column) =>
      column.notNull().check(sql`outcome in ('done', 'refused', 'failed')`),
    )
    .addCheckConstraint(
      'operator_log_actor',
      sql`(source = 'app' and actor_athlete_id is not null) or (source = 'cli' and actor_athlete_id is null)`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  await sql`create trigger operator_log_no_update before update on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
  await sql`create trigger operator_log_no_delete before delete on operator_log
    begin select raise(abort, 'operator_log is append-only'); end`.execute(db);
}

/** What `down` throws when the operator log holds anything. */
export class OperatorLogNotEmptyError extends Error {
  override readonly name = 'OperatorLogNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // As 0007's: undoing this drops a log nobody may delete, so it is refused
  // while the log records anything.
  const logged = await sql<{ n: number }>`select count(*) as n from operator_log`.execute(db);
  if (Number(logged.rows[0]?.n ?? 0) > 0) {
    throw new OperatorLogNotEmptyError(
      'Migration 0040 cannot be undone: the operator log holds entries, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger operator_log_no_delete`.execute(db);
  await sql`drop trigger operator_log_no_update`.execute(db);
  await db.schema.dropTable('operator_log').execute();
}
