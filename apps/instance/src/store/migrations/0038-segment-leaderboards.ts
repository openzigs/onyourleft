// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0038 (#68): **segments published to the instance, the efforts
 * riders share on them, and a ride's visibility here** — what a cross-athlete
 * leaderboard reads (`segments/segments.ts`).
 *
 * - **`activity_record.visibility`** — the ride's ADR 0004 visibility, as the
 *   rider's device last sent it (`POST /v1/sync/records/{content}/visibility`):
 *   `private`, `followers` or `public`, and `private` on every row this adds it
 *   to, because nobody chose to share a ride before the column existed (ADR
 *   0004 decision A: "we choose the empty feed"). Only `public` reaches a
 *   shared board; `followers` is inert until #79 builds a follow.
 * - **`segment`** — one published segment: its id (the first 32 hex digits of
 *   the SHA-256 of its definition's canonical JSON, so the same definition is
 *   one segment however often it is sent), the athlete who published it first,
 *   the definition as sent (name, sport, path, endpoint radius, bearing
 *   tolerance), the path length the instance measured itself, and when it was
 *   published HERE — the instant a rolling-window board starts from.
 * - **`segment_effort`** — one timed traversal a rider shared: which segment,
 *   which of their synced rides (`activity_record`, by the same two columns),
 *   when it started, how long it took, and its three-state visibility from the
 *   device less `excluded` (#69's). `private-match` is stored, for the rider's
 *   own board, and never ranked on a shared one.
 *
 * ⚠️ **`segment_effort.segment_id` carries no foreign key, on purpose.** A
 * rider's effort on another rider's segment would be one athlete's row
 * pointing at another's, which `sql-store.erasure.test.ts` refuses (#842's
 * review). So erasing a segment's publisher deletes every effort on it
 * explicitly (`sql-store.ts` §`eraseAthlete`), and so does withdrawing it.
 *
 * ⚠️ **An effort's ride is a foreign key, `ON DELETE CASCADE`.** A ride
 * deleted from the instance (`deleteSyncItem`) takes its efforts with it in
 * the same statement: a board never ranks a ride the instance no longer holds.
 *
 * Indexes: `segment_effort_board` answers every shared board, whatever its
 * period, from `(segment_id, visibility)`, each athlete's efforts in the
 * rank's order after it, so their best is found without a sort;
 * `segment_effort_own` answers the personal board and an athlete's erasure;
 * `segment_by_athlete` the publisher's erasure, and `segment_by_created` the
 * list. `segments/leaderboard.test.ts` reads every board's plan and fails on a
 * scan of either effort table or a temporary sort.
 *
 * `down` drops the two tables and the column. Every published segment and
 * shared effort is lost with it — the rider's own copies are on their devices
 * (ADR 0036 D-3), and a rolled-back instance that cannot read the visibility
 * column must not be left holding efforts it could no longer filter.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('activity_record')
    .addColumn('visibility', 'text', (column) =>
      column
        .notNull()
        .defaultTo('private')
        .check(sql`visibility in ('private', 'followers', 'public')`),
    )
    .execute();
  await db.schema
    .createTable('segment')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('sport', 'text', (column) => column.notNull().check(sql`sport in ('ride', 'run')`))
    .addColumn('distance_metres', 'real', (column) => column.notNull())
    .addColumn('definition', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('segment_by_athlete').on('segment').column('athlete_id').execute();
  await db.schema
    .createIndex('segment_by_created')
    .on('segment')
    .columns(['created_at', 'id'])
    .execute();
  await db.schema
    .createTable('segment_effort')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('segment_id', 'text', (column) => column.notNull())
    .addColumn('content_sha256', 'text', (column) => column.notNull())
    .addColumn('started_at', 'integer', (column) => column.notNull())
    .addColumn('elapsed_seconds', 'real', (column) =>
      column.notNull().check(sql`elapsed_seconds > 0`),
    )
    .addColumn('visibility', 'text', (column) =>
      column.notNull().check(sql`visibility in ('public', 'private-match')`),
    )
    .addColumn('received_at', 'integer', (column) => column.notNull())
    .addUniqueConstraint('segment_effort_traversal', [
      'athlete_id',
      'segment_id',
      'content_sha256',
      'started_at',
    ])
    .addForeignKeyConstraint(
      'segment_effort_ride',
      ['athlete_id', 'content_sha256'],
      'activity_record',
      ['athlete_id', 'content_sha256'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('segment_effort_board')
    .on('segment_effort')
    .columns(['segment_id', 'visibility', 'athlete_id', 'elapsed_seconds', 'started_at', 'id'])
    .execute();
  await db.schema
    .createIndex('segment_effort_own')
    .on('segment_effort')
    .columns(['athlete_id', 'segment_id', 'elapsed_seconds', 'started_at', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('segment_effort_own').execute();
  await db.schema.dropIndex('segment_effort_board').execute();
  await db.schema.dropTable('segment_effort').execute();
  await db.schema.dropIndex('segment_by_created').execute();
  await db.schema.dropIndex('segment_by_athlete').execute();
  await db.schema.dropTable('segment').execute();
  await db.schema.alterTable('activity_record').dropColumn('visibility').execute();
}
