// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0024 (#787): **`room_course.drafting`** — whether a room drafts
 * its riders.
 *
 * The owner's ruling of 2026-09-30: drafting is on by default, the rider who
 * makes the room chooses, and the choice is fixed for the room. So it is a
 * column of the room's course, written once as the room is made and read into
 * its plan every time it is opened (`room/room-plan.ts`); nothing writes it
 * afterwards. `1` drafts, `0` rides everybody at `k = 1`. Every room made
 * before this migration drafts, as every room made after it does unless its
 * maker said otherwise.
 *
 * A course belongs to a room, not to an athlete, so this adds nothing an
 * erasure must find. `down` drops the column: every room drafts again, which
 * is the default the ruling chose.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('room_course')
    .addColumn('drafting', 'integer', (column) =>
      column
        .notNull()
        .defaultTo(1)
        .check(sql`drafting in (0, 1)`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('room_course').dropColumn('drafting').execute();
}
