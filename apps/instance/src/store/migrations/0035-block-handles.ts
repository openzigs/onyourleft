// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0035 (#1529): **a block a rider can find again without an
 * athlete id**.
 *
 * - **`block.handle`** — an opaque random name for ONE block, unique on the
 *   instance, which is never the blocked athlete's id and says nothing about
 *   it. The app never holds another rider's athlete id (#1516), so it lists
 *   and undoes a block by this. The column's default makes it — 16 bytes
 *   of SQLite's `randomblob`, in hex — for every row written, the blocks
 *   already held among them, so no writer can leave one out.
 * - **`block.shown_name`** — the name a race's result showed the blocker on
 *   the row they blocked from (`POST /v1/rooms/{roomId}/blocks`), so their
 *   list can say whom they blocked. `NULL` for a block made by id, and for
 *   every block made before this migration: nothing recorded what it was
 *   made from. Erasing the blocked athlete sets it back to `NULL`
 *   (`sql-store.ts` §`eraseAthlete`), and keeps the row (#899).
 *
 * SQLite cannot add a column whose default is not a constant, so the
 * table is copied into a new one with every row kept, as 0031 copies
 * `report`, and its index made again.
 *
 * `down` keeps every block and loses only the handles and the names: a block
 * still holds, and only the app's list of them goes.
 */

import { sql, type Kysely } from 'kysely';

async function copyBlock(db: Kysely<unknown>, withHandles: boolean): Promise<void> {
  await sql`alter table block rename to block_before`.execute(db);
  // The index goes with the old table's name: dropped, and made again below.
  await db.schema.dropIndex('block_by_blocked').execute();
  let table = db.schema
    .createTable('block')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('blocked_athlete_id', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull());
  if (withHandles) {
    table = table
      .addColumn('handle', 'text', (column) =>
        column
          .notNull()
          .unique()
          .defaultTo(sql`(lower(hex(randomblob(16))))`),
      )
      .addColumn('shown_name', 'text');
  }
  await table
    .addPrimaryKeyConstraint('block_primary_key', ['athlete_id', 'blocked_athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  // Each row copied up is given its handle by the column's own default.
  await sql`insert into block (athlete_id, blocked_athlete_id, created_at)
    select athlete_id, blocked_athlete_id, created_at from block_before`.execute(db);
  await sql`drop table block_before`.execute(db);
  await db.schema
    .createIndex('block_by_blocked')
    .on('block')
    .column('blocked_athlete_id')
    .execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await copyBlock(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await copyBlock(db, false);
}
