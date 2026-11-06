// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0036 (#1381): **a notice's notifier details, erased six months
 * after the notice is closed** — the owner's ruling of 2026-10-30 (GDPR Art.
 * 5(1)(e)).
 *
 * - **`notice_erasure`** — one row a notice whose notifier details were
 *   erased: when, and whether the notifier had given a name and an email
 *   address. The record export says whether they gave each
 *   (`moderation/record.ts`), because whether a receipt was owed turns on it,
 *   and the erasure must not turn that into "they gave none". Append-only, as
 *   the notice is.
 * - **`notice_no_update`**, made again: a notice still refuses every `UPDATE`
 *   but ONE — the erasure, which empties the explanation and sets the
 *   location, the name and the email to `NULL`, changes nothing else, and is
 *   allowed only once the notice's `notice_erasure` row exists. The decision,
 *   its dates, the items the notice names and its reference (its id) stay.
 *   `DELETE` is still refused.
 *
 * `down` is refused while a notice has been erased: what was erased cannot be
 * put back, and dropping the table would make the record say the notifier
 * gave no name and no address. With none erased, it puts 0026's trigger back.
 */

import { sql, type Kysely } from 'kysely';

/**
 * 0026's trigger, which refuses every `UPDATE`: what `down` puts back, to the
 * character, since SQLite keeps a trigger's text as it was written.
 */
const REFUSE_EVERY_UPDATE = sql`create trigger notice_no_update before update on notice
    begin select raise(abort, 'notice is append-only'); end`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notice_erasure')
    .addColumn('notice_id', 'integer', (column) => column.primaryKey().references('notice.id'))
    .addColumn('gave_name', 'integer', (column) => column.notNull().check(sql`gave_name in (0, 1)`))
    .addColumn('gave_email', 'integer', (column) =>
      column.notNull().check(sql`gave_email in (0, 1)`),
    )
    .addColumn('at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await sql`create trigger notice_erasure_no_update before update on notice_erasure
    begin select raise(abort, 'notice_erasure is append-only'); end`.execute(db);
  await sql`create trigger notice_erasure_no_delete before delete on notice_erasure
    begin select raise(abort, 'notice_erasure is append-only'); end`.execute(db);
  await sql`drop trigger notice_no_update`.execute(db);
  await sql`create trigger notice_no_update before update on notice
    when not (
      exists (select 1 from notice_erasure where notice_erasure.notice_id = old.id)
      and new.id = old.id
      and new.received_at = old.received_at
      and new.kind = old.kind
      and new.items = old.items
      and new.bona_fide = old.bona_fide
      and new.explanation = ''
      and new.location is null
      and new.notifier_name is null
      and new.notifier_email is null
    )
    begin select raise(abort, 'notice is append-only'); end`.execute(db);
}

/** What `down` throws when a notice's notifier details have been erased. */
export class NoticeErasuresNotEmptyError extends Error {
  override readonly name = 'NoticeErasuresNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const erased = await sql<{ n: number }>`select count(*) as n from notice_erasure`.execute(db);
  if (Number(erased.rows[0]?.n ?? 0) > 0) {
    throw new NoticeErasuresNotEmptyError(
      'Migration 0036 cannot be undone: a notice’s notifier details have been erased, and undoing it would lose the record of whether the notifier gave a name and an address. Nothing was changed.',
    );
  }
  await sql`drop trigger notice_no_update`.execute(db);
  await REFUSE_EVERY_UPDATE.execute(db);
  await sql`drop trigger notice_erasure_no_delete`.execute(db);
  await sql`drop trigger notice_erasure_no_update`.execute(db);
  await db.schema.dropTable('notice_erasure').execute();
}
