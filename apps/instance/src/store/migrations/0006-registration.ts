// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0006 (#775): what registration modes and public-room eligibility
 * need beyond 0001's `athlete.registration_state`.
 *
 * - **`athlete.adult_confirmed_at`** — when the rider confirmed they are 18 or
 *   over (ruling Q5, 2026-09-28), or `null`. A date the rider CONFIRMED on,
 *   and nothing else: ⚠️ no date of birth is collected, anywhere, and
 *   `public-athlete.ts` classifies this column private.
 * - **`athlete.activated_at`** — when the account became active: when it
 *   registered, for one registered active, or when a moderator approved it.
 *   Public-room eligibility counts an account's age from here (#891's review),
 *   so days spent waiting for approval do not count. Every athlete already
 *   active when this runs is taken as active from when it was created.
 * - **`invite_code`** — the SHA-256 of a code a moderator minted for the
 *   invite-only registration mode, single use, with an expiry. The
 *   moderator's row (`athlete_id`), so it goes with their account.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('athlete').addColumn('adult_confirmed_at', 'integer').execute();
  await db.schema.alterTable('athlete').addColumn('activated_at', 'integer').execute();
  await sql`update athlete set activated_at = created_at where registration_state = 'active'`.execute(
    db,
  );

  await db.schema
    .createTable('invite_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('invite_code_by_athlete')
    .on('invite_code')
    .column('athlete_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invite_code').execute();
  await db.schema.alterTable('athlete').dropColumn('activated_at').execute();
  await db.schema.alterTable('athlete').dropColumn('adult_confirmed_at').execute();
}
