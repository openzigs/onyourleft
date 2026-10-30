// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0028 (#911): **an appeal against a restriction**, kept with the
 * statement of reasons it appeals.
 *
 * - **`appeal`** — one per statement at most (`statement_log_id` is unique):
 *   the rider's grounds and when they filed, and — once a moderator decides
 *   it — the outcome (`upheld` or `reversed`), the decision the rider is told,
 *   whether the deciding moderator had a conflict of interest (they took the
 *   decision appealed: with one moderator, always, and the owner's ruling of
 *   2026-09-30 is to decide it, declare it and log it), when, and the
 *   moderation log entry that records it. A reversal lifts the suspension or
 *   restores the display name in the SAME transaction as that entry
 *   (`sql-store.ts` §`decideAppeal`).
 *
 * ⚠️ **`appellant_athlete_id` carries no foreign key**, for the log's
 * reason: an appeal and its decision are part of the audit trail and stay
 * when the account is erased.
 *
 * ⚠️ **Decided once, never deleted, in the schema**: a trigger aborts any
 * `UPDATE` of an appeal that is already decided, and another any `DELETE`.
 * An open appeal is updated exactly once, by its decision. And `down` is
 * refused while one is held, for 0007's reason.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('appeal')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('statement_log_id', 'integer', (column) =>
      column.notNull().unique().references('statement.log_id'),
    )
    .addColumn('appellant_athlete_id', 'text', (column) => column.notNull())
    .addColumn('grounds', 'text', (column) => column.notNull())
    .addColumn('filed_at', 'integer', (column) => column.notNull())
    .addColumn('outcome', 'text', (column) => column.check(sql`outcome in ('upheld', 'reversed')`))
    .addColumn('decision', 'text')
    .addColumn('moderator_conflict', 'integer', (column) =>
      column.check(sql`moderator_conflict in (0, 1)`),
    )
    .addColumn('decided_at', 'integer')
    .addColumn('decided_log_id', 'integer', (column) => column.references('moderation_log.id'))
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('appeal_open').on('appeal').columns(['decided_at', 'id']).execute();
  await sql`create trigger appeal_decided_once before update on appeal
    when old.decided_at is not null
    begin select raise(abort, 'an appeal is decided once'); end`.execute(db);
  await sql`create trigger appeal_no_delete before delete on appeal
    begin select raise(abort, 'an appeal is never deleted'); end`.execute(db);
}

/** What `down` throws when an appeal has been filed. */
export class AppealsNotEmptyError extends Error {
  override readonly name = 'AppealsNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from appeal`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new AppealsNotEmptyError(
      'Migration 0028 cannot be undone: riders have filed appeals, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger appeal_no_delete`.execute(db);
  await sql`drop trigger appeal_decided_once`.execute(db);
  await db.schema.dropTable('appeal').execute();
}
