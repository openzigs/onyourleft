// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0027 (#910): **a statement of reasons for every restriction**,
 * kept with the moderation log entry that imposed it.
 *
 * - **`statement`** — one row per restricting action (a suspension, a hidden
 *   display name), keyed by that action's `moderation_log.id` and written in
 *   the SAME transaction as the entry (`sql-store.ts` §`moderate`), with the
 *   DSA Art. 17(3) fields as structured columns rather than a free-text
 *   reason: the facts and circumstances ((b)), what the decision was taken on
 *   (a notice, a report, or the moderator's own initiative), the law relied on
 *   ((d)) and the terms relied on ((e)), a notifier's name only where the
 *   moderator judged it necessary (recital 54), whether the moderator declared
 *   a conflict of interest (the owner's ruling of 2026-09-30), and when the
 *   restriction ends, if it does. Automated means ((c)) are never used, so
 *   there is no column for them; the redress routes ((f)) come from the
 *   instance's own settings when the statement is read.
 *
 * ⚠️ **`target_athlete_id` carries no foreign key**, for the moderation log's
 * reason: erasing an account does not erase what was done to it. A
 * statement names nothing of the notifier but what the moderator chose to.
 *
 * ⚠️ **Append-only in the schema**, as the log is: a statement is what the
 * rider was told, and two triggers abort any `UPDATE` or `DELETE`. And `down`
 * is refused while one is held, for 0007's reason.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('statement')
    .addColumn('log_id', 'integer', (column) => column.primaryKey().references('moderation_log.id'))
    .addColumn('target_athlete_id', 'text', (column) => column.notNull())
    .addColumn('restriction', 'text', (column) => column.notNull())
    .addColumn('facts', 'text', (column) => column.notNull())
    .addColumn('decided_on', 'text', (column) =>
      column.notNull().check(sql`decided_on in ('notice', 'report', 'own_initiative')`),
    )
    .addColumn('legal_ground', 'text')
    .addColumn('terms_ground', 'text')
    .addColumn('notifier_named', 'text')
    .addColumn('moderator_conflict', 'integer', (column) =>
      column.notNull().check(sql`moderator_conflict in (0, 1)`),
    )
    .addColumn('ends_at', 'integer')
    .addColumn('at', 'integer', (column) => column.notNull())
    .addCheckConstraint(
      'statement_has_a_ground',
      sql`legal_ground is not null or terms_ground is not null`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('statement_by_target')
    .on('statement')
    .columns(['target_athlete_id', 'log_id'])
    .execute();
  await sql`create trigger statement_no_update before update on statement
    begin select raise(abort, 'statement is append-only'); end`.execute(db);
  await sql`create trigger statement_no_delete before delete on statement
    begin select raise(abort, 'statement is append-only'); end`.execute(db);
}

/** What `down` throws when a statement has been written. */
export class StatementsNotEmptyError extends Error {
  override readonly name = 'StatementsNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from statement`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new StatementsNotEmptyError(
      'Migration 0027 cannot be undone: the instance holds statements of reasons, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger statement_no_delete`.execute(db);
  await sql`drop trigger statement_no_update`.execute(db);
  await db.schema.dropTable('statement').execute();
}
