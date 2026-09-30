// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0010 (#793): a ride's **"may be raced"** consent, on the
 * instance as on the device (ADR 0021 D-5.1, ADR 0039 D-2.1 and D-2.5).
 *
 * **`activity_record.may_be_raced`** is `0` or `1`, and `0` on every row this
 * adds it to: nobody gave a consent that did not exist, and ADR 0039 D-2.1 is
 * "off by default". It is set only by the ride's own rider, through
 * `POST /v1/sync/records/{content}/race-consent`, which a device sends when the
 * rider changes it (`apps/web/src/instance/sync.ts`). ⚠️ **It is NOT in the
 * signed record**: a consent is revocable, and a signed record is not.
 *
 * `activity_record_raceable` is a PARTIAL index over the consented rows
 * alone, which is what the cross-rider read (`listRaceableActivities`) asks;
 * a row whose rider revokes leaves it at once.
 *
 * `down` drops the index and the column. Every consent is lost with it — the
 * safe direction: an instance that cannot read the column cannot honour a
 * revocation either.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('activity_record')
    .addColumn('may_be_raced', 'integer', (column) =>
      column
        .notNull()
        .defaultTo(0)
        .check(sql`may_be_raced in (0, 1)`),
    )
    .execute();
  await db.schema
    .createIndex('activity_record_raceable')
    .on('activity_record')
    .columns(['may_be_raced', 'athlete_id', 'received_at'])
    .where(sql.ref('may_be_raced'), '=', 1)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('activity_record_raceable').execute();
  await db.schema.alterTable('activity_record').dropColumn('may_be_raced').execute();
}
