// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0026 (#907): **a notice of illegal content**, from anybody, with
 * or without an account.
 *
 * - **`notice`** — what a notifier sent through the instance's notice page
 *   (`moderation/notices.ts`), and when it arrived: the kind (a notice of
 *   illegal content, or the intimate image content report of OSA s.20A), the
 *   explanation (DSA Art. 16(2)(a)), the items it names and any location in
 *   words (Art. 16(2)(b)), the notifier's name and email if they gave them
 *   ((c), optional), and whether they ticked the bona fide statement ((d)).
 *
 * ⚠️ **No column names a client address**, and none ever may: the instance
 * never stores one (`docs/moderation.md`). A notice's rate limit per address
 * is in memory (`auth/identity.ts`), and the cap across the instance is
 * counted from `received_at` here.
 *
 * ⚠️ **No column is a foreign key to `athlete`.** A notifier need not be a
 * rider, and a notice names items by their identifiers (`@onyourleft/domain`
 * §`moderation-item.ts`) inside `items`, never by an athlete column, so
 * erasing an account leaves a notice about them as it was received — as the
 * moderation log is left (#83).
 *
 * ⚠️ **Append-only in the schema**, as the moderation log is: what was
 * received is evidence of what the operator was told and when (DSA Art.
 * 16(3)), so two triggers abort any `UPDATE` or `DELETE`. What happened to a
 * notice afterwards is recorded beside it, not written over it. And `down` is
 * refused while the table holds a notice, for 0007's reason.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notice')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('received_at', 'integer', (column) => column.notNull())
    .addColumn('kind', 'text', (column) =>
      column.notNull().check(sql`kind in ('illegal_content', 'intimate_image')`),
    )
    .addColumn('explanation', 'text', (column) => column.notNull())
    .addColumn('items', 'text', (column) => column.notNull())
    .addColumn('location', 'text')
    .addColumn('notifier_name', 'text')
    .addColumn('notifier_email', 'text')
    .addColumn('bona_fide', 'integer', (column) => column.notNull().check(sql`bona_fide in (0, 1)`))
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('notice_by_received').on('notice').column('received_at').execute();
  await sql`create trigger notice_no_update before update on notice
    begin select raise(abort, 'notice is append-only'); end`.execute(db);
  await sql`create trigger notice_no_delete before delete on notice
    begin select raise(abort, 'notice is append-only'); end`.execute(db);
}

/** What `down` throws when a notice has been received. */
export class NoticesNotEmptyError extends Error {
  override readonly name = 'NoticesNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const received = await sql<{ n: number }>`select count(*) as n from notice`.execute(db);
  if (Number(received.rows[0]?.n ?? 0) > 0) {
    throw new NoticesNotEmptyError(
      'Migration 0026 cannot be undone: the instance has received notices, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger notice_no_delete`.execute(db);
  await sql`drop trigger notice_no_update`.execute(db);
  await db.schema.dropTable('notice').execute();
}
