// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0021 (#1199, ADR 0046 D-9 as the owner ruled it on 2026-10-09):
 * each rider's OWN hosted model key, and each rider's own hosted consent.
 *
 * The owner withdrew D-9's Share mode: *"Operator key is not shared with
 * riders. If it is hosted they need to bring their own key."* So a hosted job
 * runs on the athlete's own key and nobody else's, with their own consent
 * naming where it goes.
 *
 * - **`athlete_hosted_key`** — at most one row an athlete (`athlete_id` is
 *   its primary key): the hosted service's `https:` base URL, the model's
 *   name, and the key as AES-256-GCM ciphertext under
 *   `OYL_INSTANCE_SECRET_KEY` with the 12-byte nonce it was sealed under
 *   (`analysis/hosted-key.ts`, the same cipher and additional data as 0014's
 *   one key). No plaintext column.
 * - **`athlete_hosted_consent`** — at most one row an athlete: the ORIGIN
 *   (`https://host[:port]`) their consent names (Q10), and when it was
 *   recorded. A hosted job runs only when it names the origin the athlete's
 *   key goes to.
 *
 * Both REFERENCE `athlete`, so `eraseAthlete` — which derives its tables from
 * those foreign keys — takes them with the athlete.
 *
 * `down` drops both tables, and every rider's key and consent with them: a
 * rider sets them again after the instance rolls forward.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('athlete_hosted_key')
    .addColumn('athlete_id', 'text', (column) => column.primaryKey().references('athlete.id'))
    .addColumn('url', 'text', (column) => column.notNull())
    .addColumn('model', 'text', (column) => column.notNull())
    .addColumn('iv', 'blob', (column) => column.notNull())
    .addColumn('ciphertext', 'blob', (column) => column.notNull())
    .addColumn('set_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('athlete_hosted_consent')
    .addColumn('athlete_id', 'text', (column) => column.primaryKey().references('athlete.id'))
    .addColumn('origin', 'text', (column) => column.notNull())
    .addColumn('recorded_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('athlete_hosted_consent').execute();
  await db.schema.dropTable('athlete_hosted_key').execute();
}
