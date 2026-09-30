// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0003 (#769): rooms, and each athlete's result in one.
 *
 * A room belongs to no athlete, so it has no `athlete_id` and erasing an
 * athlete leaves it; their RESULT in it goes (`sql-store.ts`
 * §`eraseAthlete`). #785 owns the final shape of both.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('room')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('kind', 'text', (column) => column.notNull().check(sql`kind in ('group', 'race')`))
    .addColumn('visibility', 'text', (column) =>
      column.notNull().check(sql`visibility in ('private', 'public')`),
    )
    .addColumn('route_sha256', 'text', (column) => column.notNull())
    .addColumn('physics_version', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();

  await db.schema
    .createTable('result')
    .addColumn('room_id', 'text', (column) => column.notNull().references('room.id'))
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('finish_ms', 'integer')
    .addColumn('flags', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('result_key', ['room_id', 'athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('result_by_athlete').on('result').column('athlete_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('result').execute();
  await db.schema.dropTable('room').execute();
}
