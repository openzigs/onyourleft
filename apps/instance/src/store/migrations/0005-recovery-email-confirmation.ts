// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0005 (#865): a recovery address is bound only once it is
 * confirmed.
 *
 * - **`recovery_email_confirmation`** — an address an athlete gave, waiting
 *   for them to follow the single-use, time-limited link mailed to it, and the
 *   SHA-256 of that link's token (never the token). `recovery_email` gains a
 *   row only when a confirmation is spent, so an address somebody typed is
 *   never usable for recovery until whoever reads that mailbox says so.
 *
 * Only ever written on an instance whose operator enabled email recovery
 * (ruling Q1). Athlete-scoped in `athlete_id` REFERENCES `athlete`, which is
 * what `eraseAthlete` deletes by (`schema.ts`).
 *
 * ⚠️ Rows 0004 already bound are left where they are: no instance ran 0004
 * before this migration (the first deploy is #780's), and a `down` that must
 * restore every earlier row could not put back a binding `up` had removed.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('recovery_email_confirmation')
    .addColumn('token_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('address', 'text', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('recovery_email_confirmation_by_athlete')
    .on('recovery_email_confirmation')
    .column('athlete_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('recovery_email_confirmation').execute();
}
