// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0014 (#1097): the instance's one hosted model key.
 *
 * - **`hosted_model_key`** — at most ONE row (`slot` is its primary key and
 *   can only be 1): the hosted service's `https:` base URL, the model's name,
 *   and the key as AES-256-GCM ciphertext with the 12-byte nonce it was
 *   sealed under (`analysis/hosted-key.ts`). There is no plaintext column, so
 *   a `VACUUM INTO` snapshot (`operator backup`) holds ciphertext only.
 *   `athlete_id` REFERENCES `athlete`: the key is held FOR one athlete, the
 *   operator (ADR 0046 Q9, `operator model-key set`), whatever other riders
 *   the instance has, and `eraseAthlete` — which derives its tables from
 *   these foreign keys — takes it with them.
 *
 * `down` drops the table, and the key with it: an operator who rolls back
 * past this migration sets the key again after rolling forward.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('hosted_model_key')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('athlete_id', 'text', (column) => column.notNull().unique().references('athlete.id'))
    .addColumn('url', 'text', (column) => column.notNull())
    .addColumn('model', 'text', (column) => column.notNull())
    .addColumn('iv', 'blob', (column) => column.notNull())
    .addColumn('ciphertext', 'blob', (column) => column.notNull())
    .addColumn('set_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('hosted_model_key').execute();
}
