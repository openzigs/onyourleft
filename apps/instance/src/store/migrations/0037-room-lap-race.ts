// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0037 (#1910): **a lap race's laps, items and seed** on the room's
 * course — `room_course.lap_laps`, `lap_items` and `lap_seed`.
 *
 * The `drafting` precedent (0024, #787): chosen by the rider who makes the
 * room, fixed for it, written once as the room is made and read into its plan
 * every time it is opened (`room/room-plan.ts`). All three are NULL for every
 * room that is not a lap race — every room made before this migration — and
 * all three are set for one that is: a CHECK holds them together, so a row
 * cannot say "a lap race" without saying how many laps, whether items are on
 * and the room's seed.
 *
 * - `lap_laps` — 1 to 100, `@onyourleft/protocol`'s `MAXIMUM_LAPS`.
 * - `lap_items` — `1` items on, `0` off.
 * - `lap_seed` — 0 to 2³² − 1: the room's own seed, from which every item draw
 *   comes (`room/core/settings.ts` §`LapRaceSettings`). Drawn from the CSPRNG
 *   when the room is made and never sent to a client. Not in #1910's text,
 *   which names "the two settings": the room core needs a seed it can open
 *   the same race from, and one derived from the room id would be one every
 *   member could compute from the URL their socket opens.
 *
 * A course belongs to a room, not to an athlete — `room_course` has no foreign
 * key to `athlete` — so this adds nothing an erasure must find. `down` drops
 * the three columns, the seed first because its CHECK names the other two:
 * every room is then the race or ride it was, and a lap race made in between
 * opens as an ordinary race on its loop.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('room_course')
    .addColumn('lap_laps', 'integer', (column) =>
      column.check(sql`lap_laps is null or (lap_laps between 1 and 100)`),
    )
    .execute();
  await db.schema
    .alterTable('room_course')
    .addColumn('lap_items', 'integer', (column) =>
      column.check(sql`lap_items is null or lap_items in (0, 1)`),
    )
    .execute();
  await db.schema
    .alterTable('room_course')
    .addColumn('lap_seed', 'integer', (column) =>
      column.check(
        sql`(lap_seed is null or (lap_seed between 0 and 4294967295)) and (lap_laps is null) = (lap_seed is null) and (lap_items is null) = (lap_seed is null)`,
      ),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('room_course').dropColumn('lap_seed').execute();
  await db.schema.alterTable('room_course').dropColumn('lap_items').execute();
  await db.schema.alterTable('room_course').dropColumn('lap_laps').execute();
}
