// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0001 (#769): athletes, the keys they sign with, and their sessions.
 *
 * Every table is `STRICT`, so SQLite refuses a value of the wrong type rather
 * than storing it, and `athlete_id` REFERENCES `athlete` (see `schema.ts` for
 * why that column name is load-bearing).
 *
 * ⚠️ **A session's device key must be ITS athlete's key, and the schema says
 * so** (#842's review). `device_key` is `UNIQUE (public_key, athlete_id)` and
 * `session (device_key, athlete_id)` references that pair, so a session naming
 * another athlete's key is refused by SQLite itself — not only by
 * `putSession`'s check. With the single-column reference it replaced, such a
 * row was accepted and then made the OTHER athlete's erasure (#35) fail on a
 * foreign key it could not satisfy.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('athlete')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('display_name', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('registration_state', 'text', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();

  await db.schema
    .createTable('device_key')
    .addColumn('public_key', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('added_at', 'integer', (column) => column.notNull())
    .addColumn('revoked_at', 'integer')
    .addUniqueConstraint('device_key_owner', ['public_key', 'athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('device_key_by_athlete')
    .on('device_key')
    .column('athlete_id')
    .execute();

  await db.schema
    .createTable('session')
    .addColumn('token_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('device_key', 'text', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('revoked_at', 'integer')
    .addForeignKeyConstraint(
      'session_device_key_is_its_athletes',
      ['device_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('session_by_athlete').on('session').column('athlete_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('session').execute();
  await db.schema.dropTable('device_key').execute();
  await db.schema.dropTable('athlete').execute();
}
