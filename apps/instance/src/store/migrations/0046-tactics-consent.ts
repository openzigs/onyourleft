// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0046 (#2709, ADR 0071 D-5.2): **each rider's own consent to
 * model-chosen lap-race bot tactics**.
 *
 * - **`athlete_tactics_consent`** — at most one row an athlete (`athlete_id`
 *   is its primary key): the local model ADDRESS the consent names — the base
 *   URL the instance's analysis settings gave the local model when the rider
 *   agreed — and when it was recorded (Unix seconds). The consent names the
 *   rider's instance and that address (D-10 R-3, the owner's ruling of
 *   2026-11-16); the instance is the one holding the row, so only the address
 *   is a column. **A row naming another address than the settings give now is
 *   no consent** (`analysis/tactics.ts`): changing the address withdraws every
 *   rider's consent at once (D-5.3), with no row rewritten.
 *
 * It REFERENCES `athlete`, so `eraseAthlete` — which derives its tables from
 * those foreign keys — takes it with the athlete.
 *
 * `down` drops the table, and every rider's consent with it: the next model
 * race asks again, and until it is answered the race is seeded (D-1.1).
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('athlete_tactics_consent')
    .addColumn('athlete_id', 'text', (column) => column.primaryKey().references('athlete.id'))
    .addColumn('model_address', 'text', (column) => column.notNull())
    .addColumn('recorded_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('athlete_tactics_consent').execute();
}
