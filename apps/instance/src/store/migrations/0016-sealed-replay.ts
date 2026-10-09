// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0016 (#1191, ADR 0047 D-9): the sealed requests the instance has
 * seen.
 *
 * - **`sealed_replay`** — the SHA-256 of each sealed request's `enc`, and when
 *   it was seen, kept for ten minutes. A second request with the same `enc` is
 *   refused `replayed` without running anything. Durable on purpose: an
 *   instance restarted inside a request's 120-second freshness window must
 *   still refuse it, so the record cannot be held in memory. The check and the
 *   insert are ONE statement (`sql-store.ts` §`recordSealedRequest`), an
 *   insert that does nothing on the primary key, made before the inner route
 *   runs.
 *
 * It names no athlete and holds nothing that reads as a secret: an `enc` is a
 * public ephemeral key, sent in clear, and its hash says only that a request
 * was made. `eraseAthlete` (which derives its tables from `athlete_id`) never
 * reaches it.
 *
 * `down` drops it: an instance rolled back past this forgets ten minutes of
 * requests, and runs a version that has no sealed endpoint to replay them at.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sealed_replay')
    .addColumn('enc_sha256', 'text', (column) => column.primaryKey())
    .addColumn('seen_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('sealed_replay_seen_at')
    .on('sealed_replay')
    .column('seen_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sealed_replay').execute();
}
