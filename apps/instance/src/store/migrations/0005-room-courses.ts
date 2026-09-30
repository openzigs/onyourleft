// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0005 (#780): what a room is ridden on, so the self-hosted room
 * server can open it.
 *
 * A room row (0003) names its route by content hash and nothing else, and the
 * room core needs a course — a finish line and a grade at every distance
 * (`room/core/settings.ts` §`RoomCourse`) — to simulate anybody. This is that
 * course, as the room needs it and never as geometry: a length and the grade
 * as steps (`[[fromMetres, percent], …]`, JSON), plus the few settings an
 * operator may set per room. Absent, the room cannot be opened, and a socket
 * for it is refused before it upgrades.
 *
 * `race_started_at` (Unix seconds) is set once a race leaves its lobby. From
 * then the room is never opened as a lobby again — not when it finishes, and
 * not when the instance restarts in the middle of it: an interrupted race
 * does not resume (#807), and a rider rejoining it is told it is closed.
 *
 * A course belongs to a room, not to an athlete, so erasing an athlete leaves
 * it (the erasure test finds athlete-scoped tables by their foreign keys, and
 * this has none to `athlete`). #784 and #785, which let a rider create a
 * room, own its final shape and change it with a migration of their own.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('room_course')
    .addColumn('room_id', 'text', (column) => column.primaryKey().references('room.id'))
    .addColumn('length_metres', 'real', (column) => column.notNull().check(sql`length_metres > 0`))
    .addColumn('grades', 'text', (column) => column.notNull())
    .addColumn('riding_position', 'text', (column) =>
      column.notNull().check(sql`riding_position in ('upright', 'hoods', 'drops')`),
    )
    .addColumn('capacity', 'integer')
    .addColumn('countdown_ms', 'integer')
    .addColumn('rejoin_window_ms', 'integer')
    .addColumn('race_started_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('room_course').execute();
}
