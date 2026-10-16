// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0030 (#913): **one item hidden, and the rest left alone** — a
 * room's listing, the route shown in a room, or one row of a race's result.
 *
 * - **`hidden_item`** — the item's identifier (`@onyourleft/domain`
 *   §`moderation-item.ts`), the rider whose item it is, and the moderation
 *   log entry that hid it, written in ONE transaction with that entry and its
 *   statement of reasons (`sql-store.ts` §`hideItem`). `restored_at` is set
 *   when an appeal reverses it (#911).
 *
 * ⚠️ **Nothing is deleted to hide an item.** The route stays in the room's
 * blobs, the result stays in `result`, and the rider's own device copy is
 * never touched (ADR 0036 D-3): every read path a rider uses asks this table
 * and leaves the item out (`rooms/rooms.ts`).
 *
 * ⚠️ **Restored once, never deleted, in the schema**: a trigger aborts any
 * `UPDATE` but setting `restored_at` on a row that has none, and another any
 * `DELETE`. `owner_athlete_id` carries no foreign key, for the log's reason.
 * And `down` is refused while a row is held, for 0007's.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('hidden_item')
    .addColumn('log_id', 'integer', (column) => column.primaryKey().references('moderation_log.id'))
    .addColumn('item', 'text', (column) => column.notNull())
    .addColumn('owner_athlete_id', 'text', (column) => column.notNull())
    .addColumn('hidden_at', 'integer', (column) => column.notNull())
    .addColumn('restored_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('hidden_item_by_item')
    .on('hidden_item')
    .columns(['item', 'restored_at'])
    .execute();
  await sql`create trigger hidden_item_restored_once before update on hidden_item
    when old.restored_at is not null
      or new.item is not old.item
      or new.owner_athlete_id is not old.owner_athlete_id
      or new.hidden_at is not old.hidden_at
      or new.log_id is not old.log_id
    begin select raise(abort, 'a hidden item is restored once, and changed no other way'); end`.execute(
    db,
  );
  await sql`create trigger hidden_item_no_delete before delete on hidden_item
    begin select raise(abort, 'a hidden item is never deleted'); end`.execute(db);
}

/** What `down` throws when an item has been hidden. */
export class HiddenItemsNotEmptyError extends Error {
  override readonly name = 'HiddenItemsNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from hidden_item`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new HiddenItemsNotEmptyError(
      'Migration 0030 cannot be undone: moderators have hidden items, and undoing it would show them again. Nothing was changed.',
    );
  }
  await sql`drop trigger hidden_item_no_delete`.execute(db);
  await sql`drop trigger hidden_item_restored_once`.execute(db);
  await db.schema.dropTable('hidden_item').execute();
}
