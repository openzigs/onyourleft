// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0034 (#1166): **the suspended accounts, indexed**.
 *
 * - **`athlete_suspended`** — `athlete (suspended_at, id)`, holding only the
 *   rows where `suspended_at IS NOT NULL`. The moderators' list of suspended
 *   accounts (#961) is read a page at a time in that order, newest first; with
 *   no index each page scanned every athlete and sorted what it found. The
 *   index is partial because nearly every account is not suspended.
 *
 * `down` drops the index and nothing else: no row is changed either way.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('athlete_suspended')
    .on('athlete')
    .columns(['suspended_at', 'id'])
    .where(sql.ref('suspended_at'), 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('athlete_suspended').execute();
}
