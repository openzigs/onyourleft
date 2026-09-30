// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0013 (#784, #785): a room a rider creates, who is in it, and what
 * a race's result publishes.
 *
 * Numbered 0013 because #926's `0012-session-scope` merged first; it runs
 * after it (Kysely refuses a database whose applied migrations are not a
 * prefix of the list in order).
 *
 * - **`private_room`** — a room a rider made (#784). `code_sha256` is the
 *   SHA-256 of its room code, never the code: the code is a bearer secret
 *   (whoever holds it may join), so a copy of this database does not let
 *   anybody in, and a code is looked up by its digest through the unique
 *   index. `route_loop` is whether the shared route is ridden as a loop — the
 *   one fact about the route its GPX cannot carry. `closed_at` is set once
 *   the room is over (`rooms/rooms.ts` §"The route's lifetime": a race
 *   finished, a group ride past its empty grace, nobody riding it a day after
 *   it was made, a race a restart interrupted, or its creator erased); a
 *   closed room is never opened again, and its route blob is deleted then.
 *   A room belongs to no athlete, so this table does not reference `athlete`:
 *   its creator is the `room_member` row with `role = 'creator'`, and an
 *   erasure ends the creator's rooms through that row BEFORE the row goes
 *   (`sync/routes.ts` §`eraseAccount`) — the rooms' sweep ends any room whose
 *   creator row is gone however it went.
 * - **`room_member`** — who may be ticketed into a private room: its creator,
 *   and whoever joined it by its code. Athlete-scoped (`athlete_id` REFERENCES
 *   `athlete`), so an erased athlete leaves no membership behind — derived by
 *   `eraseAthlete` from this foreign key with no edit there.
 * - **`result`** gains three columns (#785): `place` (1 first, from the
 *   room's finish order; `null` for a rider who did not finish), the rider's
 *   mean power-to-weight over the race (ruling Q17 — never watts), and the
 *   durations of every plausibility ceiling breached, as JSON. `place` is what
 *   lets an erased rider's row go while the others' results still show that
 *   somebody was there: a gap in the places is shown as "a rider", with
 *   nothing of theirs in it.
 * - **`room_course.race_finished_at`** (#785): when the race's room said it
 *   was over — every rider across the line or out of it. A race's result is
 *   read from then and not before (ADR 0028 D-7.7), so a rider over the line
 *   cannot read the order behind them while the others still ride.
 * - **`room_course.finishers`** (#785): how many riders crossed the line —
 *   the highest place written. It is what shows a LAST-placed rider who
 *   erased their account as "a rider" too, where a gap between two places
 *   could not. A count and nothing else: it names nobody.
 *
 * `down` drops the five columns and the two tables, rows and all. What goes
 * is what this migration added: a room's membership and code (the rooms and
 * their courses stay, and without a code nobody new can join them), three
 * figures of each result, and a count of finishers and when a race was over.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('private_room')
    .addColumn('room_id', 'text', (column) => column.primaryKey().references('room.id'))
    .addColumn('code_sha256', 'text', (column) => column.notNull().unique())
    .addColumn('route_loop', 'integer', (column) =>
      column.notNull().check(sql`route_loop in (0, 1)`),
    )
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('closed_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();

  await db.schema
    .createTable('room_member')
    .addColumn('room_id', 'text', (column) => column.notNull().references('room.id'))
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('role', 'text', (column) =>
      column.notNull().check(sql`role in ('creator', 'rider')`),
    )
    .addColumn('joined_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('room_member_key', ['room_id', 'athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('room_member_by_athlete')
    .on('room_member')
    .column('athlete_id')
    .execute();

  await db.schema.alterTable('room_course').addColumn('finishers', 'integer').execute();
  await db.schema.alterTable('room_course').addColumn('race_finished_at', 'integer').execute();
  await db.schema.alterTable('result').addColumn('place', 'integer').execute();
  await db.schema.alterTable('result').addColumn('watts_per_kilogram', 'real').execute();
  await db.schema
    .alterTable('result')
    .addColumn('flagged_seconds', 'text', (column) => column.notNull().defaultTo('[]'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('result').dropColumn('flagged_seconds').execute();
  await db.schema.alterTable('result').dropColumn('watts_per_kilogram').execute();
  await db.schema.alterTable('result').dropColumn('place').execute();
  await db.schema.alterTable('room_course').dropColumn('race_finished_at').execute();
  await db.schema.alterTable('room_course').dropColumn('finishers').execute();
  await db.schema.dropIndex('room_member_by_athlete').execute();
  await db.schema.dropTable('room_member').execute();
  await db.schema.dropTable('private_room').execute();
}
