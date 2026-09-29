// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0002 (#769): the signed activity records an athlete sends.
 *
 * The key is `(athlete_id, content_sha256)`, so the same file sent twice by
 * one athlete is one row (a retried sync, #47) and the same file sent by two
 * athletes is two rows that cannot see each other. The original file itself is
 * in the blob store under `content_sha256` (#770); this row holds the signed
 * record, which is small.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('activity_record')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('content_sha256', 'text', (column) => column.notNull())
    .addColumn('signed_record', 'blob', (column) => column.notNull())
    .addColumn('received_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('activity_record_key', ['athlete_id', 'content_sha256'])
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('activity_record').execute();
}
