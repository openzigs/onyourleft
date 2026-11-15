// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0041 (#2604): **the open rooms, indexed**.
 *
 * - **`private_room_open`**: `private_room (room_id)`, holding only the
 *   rows where `closed_at IS NULL`. The owner's Status counts the open rooms
 *   on every read. Rooms are never deleted, so without this index that count
 *   scanned every room the instance ever made, inside the store's one lane.
 *   The index is partial because nearly every room is over.
 *
 * `down` drops the index and nothing else: no row changes either way.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('private_room_open')
    .on('private_room')
    .column('room_id')
    .where(sql.ref('closed_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('private_room_open').execute();
}
