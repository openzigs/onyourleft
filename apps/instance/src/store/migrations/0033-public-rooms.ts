// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0033 (#788): **when a public room's rider says it starts**.
 *
 * - **`private_room.starts_at`** — Unix seconds: the start its creator gave a
 *   PUBLIC room, which the listing orders by (`rooms/rooms.ts`), or `NULL` for
 *   a room shared by its code, which has none. The table keeps its name: it
 *   holds every room a rider made, and `room.visibility` says which kind.
 *
 * `down` drops the column and nothing else. A public room made before it is
 * then a rider's room nobody can list or join, and the sweep ends it within a
 * day of being made, as it ends any room nobody rides.
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('private_room').addColumn('starts_at', 'integer').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('private_room').dropColumn('starts_at').execute();
}
