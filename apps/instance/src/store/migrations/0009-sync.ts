// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0009 (#37, #776): the sync manifest.
 *
 * **`sync_item`** is one row for every thing an athlete has synced to this
 * instance — a signed activity record (#37), and the data classes #776's
 * 2026-09-29 addition names: a ride's model write-up (`rideWriteUps`), its
 * side-camera report with the pose summary inside it
 * (`sideCameraReports.pose`), and the rider's goals, notes and reference
 * documents (#836). It is what `GET /v1/sync/manifest` pages through.
 *
 * - **`seq`** is `INTEGER PRIMARY KEY AUTOINCREMENT`, so it only ever grows and
 *   is never reused, not even after the newest row is deleted. A changed item
 *   is deleted and inserted again rather than updated, so its change is a NEW
 *   `seq` and a device paging from an older cursor sees it.
 * - **`received_at`** is the manifest's sort key, and the store writes it as
 *   `max(now, the newest received_at)` (`sql-store.ts` §`nextReceivedAt`), so
 *   `(received_at, seq)` grows in insertion order even when the clock steps
 *   back. That is what makes #776's `(receivedAt, id)` cursor gap-free: a row
 *   can never be inserted BEHIND a position a reader has already passed.
 * - **`body`** is the item exactly as the device sent it — for a write-up, the
 *   device's screened copy, byte for byte (#776's addition). An activity's
 *   body is `NULL`: its signed record is `activity_record`'s, and its file is
 *   in the blob store.
 * - **`deleted_at`** marks a tombstone: the item was deleted (an erase on a
 *   device), and the manifest carries that so another device learns it.
 *
 * Athlete-scoped, so it names its owner in `athlete_id` REFERENCES `athlete`,
 * and `sql-store.erasure.test.ts` finds it by that foreign key.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sync_item')
    .addColumn('seq', 'integer', (column) => column.primaryKey().autoIncrement())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('item_key', 'text', (column) => column.notNull())
    .addColumn('digest', 'text')
    .addColumn('body', 'blob')
    .addColumn('received_at', 'integer', (column) => column.notNull())
    .addColumn('deleted_at', 'integer')
    .addUniqueConstraint('sync_item_key', ['athlete_id', 'kind', 'item_key'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('sync_item_by_position')
    .on('sync_item')
    .columns(['athlete_id', 'received_at', 'seq'])
    .execute();
  // What blob garbage collection asks: does ANY athlete still hold this file?
  await db.schema
    .createIndex('activity_record_by_content')
    .on('activity_record')
    .column('content_sha256')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('activity_record_by_content').execute();
  await db.schema.dropIndex('sync_item_by_position').execute();
  await db.schema.dropTable('sync_item').execute();
}
