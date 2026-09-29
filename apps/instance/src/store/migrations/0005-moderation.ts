// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0005 (#83): blocking, reporting, suspension and the moderation
 * audit log.
 *
 * - **`block`** — one athlete (`athlete_id`, the BLOCKER) blocking another
 *   (`blocked_athlete_id`). The block is the blocker's row, so it goes when
 *   they erase their account; `blocked_athlete_id` carries no foreign key,
 *   because the erasure rule (`schema.ts`) is that a reference to `athlete`
 *   comes from `athlete_id` alone, and `eraseAthlete` removes the rows that
 *   name an erased athlete as blocked as well.
 * - **`report`** — a report, the REPORTER's row (`athlete_id`), naming its
 *   target in `target_athlete_id`, with the reason and when. A moderator's
 *   decision closes it (`closed_at`, `closed_by_athlete_id`, `outcome`).
 * - **`moderation_log`** — every moderator action, with its actor, action,
 *   target, reason and time. ⚠️ **Append-only in the schema**: two triggers
 *   abort any `UPDATE` or `DELETE`, so no code path — this repository's or an
 *   operator's `sqlite3` session — can rewrite the record quietly. It has no
 *   foreign key to `athlete` on purpose: erasing an account does not erase
 *   what a moderator did to it, or the audit trail would be something a
 *   suspended rider could delete (`sql-store.erasure.test.ts` states the
 *   exception, and `docs/moderation.md` tells an operator).
 * - **`athlete.suspended_at`** — when the account was suspended, or `null`.
 * - **`athlete.display_name_hidden_at`** — a moderator hid the display name
 *   (#83's "hide content"): other riders see the default name until the
 *   athlete chooses another.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('athlete').addColumn('suspended_at', 'integer').execute();
  await db.schema.alterTable('athlete').addColumn('display_name_hidden_at', 'integer').execute();

  await db.schema
    .createTable('block')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('blocked_athlete_id', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('block_primary_key', ['athlete_id', 'blocked_athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('block_by_blocked')
    .on('block')
    .column('blocked_athlete_id')
    .execute();

  await db.schema
    .createTable('report')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('target_athlete_id', 'text', (column) => column.notNull())
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('closed_at', 'integer')
    .addColumn('closed_by_athlete_id', 'text')
    .addColumn('outcome', 'text')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('report_by_reporter')
    .on('report')
    .columns(['athlete_id', 'created_at'])
    .execute();
  await db.schema.createIndex('report_open').on('report').columns(['closed_at', 'id']).execute();

  await db.schema
    .createTable('moderation_log')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('actor_athlete_id', 'text', (column) => column.notNull())
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('target_athlete_id', 'text')
    .addColumn('report_id', 'integer')
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('moderation_log_by_target')
    .on('moderation_log')
    .columns(['target_athlete_id', 'id'])
    .execute();
  await sql`create trigger moderation_log_no_update before update on moderation_log
    begin select raise(abort, 'moderation_log is append-only'); end`.execute(db);
  await sql`create trigger moderation_log_no_delete before delete on moderation_log
    begin select raise(abort, 'moderation_log is append-only'); end`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger moderation_log_no_delete`.execute(db);
  await sql`drop trigger moderation_log_no_update`.execute(db);
  await db.schema.dropTable('moderation_log').execute();
  await db.schema.dropTable('report').execute();
  await db.schema.dropTable('block').execute();
  await db.schema.alterTable('athlete').dropColumn('display_name_hidden_at').execute();
  await db.schema.alterTable('athlete').dropColumn('suspended_at').execute();
}
