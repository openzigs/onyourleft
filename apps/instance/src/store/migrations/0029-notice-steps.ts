// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0029 (#912): **what was done about each notice, and when** —
 * acknowledged, decided, notifier told.
 *
 * A notice (migration 0026) records when it was RECEIVED and is never
 * changed. What happened afterwards is recorded beside it, one row a step, in
 * `notice_step`:
 *
 * - `acknowledged` — the moderator confirmed receipt to the address the
 *   notifier gave (DSA Art. 16(4)). The instance sends no email (the owner's
 *   ruling of 2026-10-15): this records that the moderator did.
 * - `decided` — the decision, in the moderator's words, and the moderation log
 *   entry of any action it took (`log_id`).
 * - `notifier_told` — the moderator told the notifier the decision and the
 *   redress (Art. 16(5)).
 *
 * Each step happens once a notice (`notice_step_once`), and ⚠️ the table is
 * **append-only in the schema**, as the log is: a record that could be
 * rewritten after the fact is no evidence of when anything was done (OSA
 * s.23, DSA Art. 16(6)). `actor_athlete_id` carries no foreign key: erasing a
 * moderator's account does not erase what they did. And `down` is refused
 * while a step is held, for 0007's reason.
 *
 * An appeal (migration 0028) carries its own steps — filed, decided, the
 * decision and its log entry — and the rider is told in the app the moment it
 * is decided, so it needs no row here.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notice_step')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('notice_id', 'integer', (column) => column.notNull().references('notice.id'))
    .addColumn('step', 'text', (column) =>
      column.notNull().check(sql`step in ('acknowledged', 'decided', 'notifier_told')`),
    )
    .addColumn('actor_athlete_id', 'text', (column) => column.notNull())
    .addColumn('decision', 'text')
    .addColumn('log_id', 'integer', (column) => column.references('moderation_log.id'))
    .addColumn('at', 'integer', (column) => column.notNull())
    .addUniqueConstraint('notice_step_once', ['notice_id', 'step'])
    .modifyEnd(sql`strict`)
    .execute();
  await sql`create trigger notice_step_no_update before update on notice_step
    begin select raise(abort, 'notice_step is append-only'); end`.execute(db);
  await sql`create trigger notice_step_no_delete before delete on notice_step
    begin select raise(abort, 'notice_step is append-only'); end`.execute(db);
}

/** What `down` throws when a step has been recorded. */
export class NoticeStepsNotEmptyError extends Error {
  override readonly name = 'NoticeStepsNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from notice_step`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new NoticeStepsNotEmptyError(
      'Migration 0029 cannot be undone: the record of how notices were handled holds entries, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger notice_step_no_delete`.execute(db);
  await sql`drop trigger notice_step_no_update`.execute(db);
  await db.schema.dropTable('notice_step').execute();
}
