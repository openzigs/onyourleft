// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0031 (#789): **moderation in a room**.
 *
 * - **`report`** is rebuilt so that a report can come from a room:
 *   - `athlete_id`, the reporter, may be `NULL`: a room's plausibility flag is
 *     a report the ROOM files (ADR 0028 D-2 rule 3), and nobody made it;
 *   - `room_id` and `room_tick`: the room a rider reported from, or the flag
 *     was raised in, and the room's tick at that moment;
 *   - `flag_duration_seconds` and `flag_ceiling_watts_per_kilogram`: a flag's
 *     breached ceiling. Never a power trace.
 *   SQLite cannot drop a `NOT NULL`, so the table is copied into a new one
 *   with every row and id kept, and its indexes made again.
 * - **`room_removal`** — a rider removed from a room by its host or by a
 *   moderator: their ticket for that room is refused from then on. The
 *   removed rider's row (`athlete_id`), so erasing them erases it.
 * - **`moderation_log.room_id`** — the room an action was taken in. Adding a
 *   column is not an `UPDATE`: the append-only triggers are untouched.
 *
 * `down` is refused while a report with no reporter or from a room, or a log
 * entry naming a room, exists — undoing it would delete them, as 0007's
 * `down` refuses to drop the log. With none, it puts every table back as it
 * was; the removals go with their table, and a removed rider may ask for a
 * ticket again, as before this migration.
 */

import { sql, type Kysely } from 'kysely';

async function copyReport(db: Kysely<unknown>, fromRooms: boolean): Promise<void> {
  // The old table aside, the new one made by the same builder 0007 used — so
  // that `down` leaves `sqlite_schema` exactly as it found it — every row
  // copied with its id, and the indexes made again on the new table.
  await sql`alter table report rename to report_before`.execute(db);
  let table = db.schema
    .createTable('report')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) =>
      fromRooms ? column.references('athlete.id') : column.notNull().references('athlete.id'),
    )
    .addColumn('target_athlete_id', 'text', (column) => column.notNull())
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('closed_at', 'integer')
    .addColumn('closed_by_athlete_id', 'text')
    .addColumn('outcome', 'text');
  if (fromRooms) {
    table = table
      .addColumn('room_id', 'text')
      .addColumn('room_tick', 'integer')
      .addColumn('flag_duration_seconds', 'integer')
      .addColumn('flag_ceiling_watts_per_kilogram', 'real');
  }
  await table.modifyEnd(sql`strict`).execute();
  await sql`insert into report (id, athlete_id, target_athlete_id, reason, created_at, closed_at, closed_by_athlete_id, outcome)
    select id, athlete_id, target_athlete_id, reason, created_at, closed_at, closed_by_athlete_id, outcome from report_before`.execute(
    db,
  );
  await sql`drop table report_before`.execute(db);
  await db.schema
    .createIndex('report_by_reporter')
    .on('report')
    .columns(['athlete_id', 'created_at'])
    .execute();
  await db.schema.createIndex('report_open').on('report').columns(['closed_at', 'id']).execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await copyReport(db, true);
  await db.schema
    .createTable('room_removal')
    .addColumn('room_id', 'text', (column) => column.notNull())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('removed_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('room_removal_primary_key', ['room_id', 'athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.alterTable('moderation_log').addColumn('room_id', 'text').execute();
}

/** What `down` throws while rows only this migration can hold exist. */
export class RoomModerationNotEmptyError extends Error {
  override readonly name = 'RoomModerationNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select
      (select count(*) from report where athlete_id is null or room_id is not null)
    + (select count(*) from moderation_log where room_id is not null) as n`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new RoomModerationNotEmptyError(
      'Migration 0031 cannot be undone: reports from rooms or log entries naming a room exist, and undoing it would delete them. Nothing was changed.',
    );
  }
  await db.schema.alterTable('moderation_log').dropColumn('room_id').execute();
  await db.schema.dropTable('room_removal').execute();
  await copyReport(db, false);
}
