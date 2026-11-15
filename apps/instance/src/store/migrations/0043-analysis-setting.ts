// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0043 (#2609): **the operator's analysis settings**, one row that
 * overrides `.env` field by field (ADR 0046, the 2026-11-14 amendment).
 *
 * - **`analysis_setting`** — at most one row (`slot` is 1, as
 *   `hosted_model_key`'s is): the local model's base URL, its name and its
 *   reasoning tokens; whether the instance offers the local model and the
 *   hosted source; and the switch for other riders' analysis on the local
 *   model. **Every one of those columns may be `NULL`, and `NULL` is "not set
 *   here"**: each model field falls back to its `.env` line, the two sources
 *   offered to on, and the switch to off (the amendment's point 2). Then when
 *   it was written (`updated_at`, Unix seconds) and from where (`updated_by`:
 *   `app` or `cli`). It names no athlete, so erasing an account leaves it: the
 *   operator log says who did what.
 *
 * The flags are `0` or `1` and the reasoning tokens a positive whole number
 * (CHECKs, so a `sqlite3` session cannot write a third value); the address and
 * the model are checked by the code that writes them, which is
 * `analysis/settings.ts` alone.
 *
 * `down` drops the table, row and all: every field returns to `.env`, the
 * switch to off and both sources to offered, which is the instance as it was
 * before this migration.
 */

import { sql, type Kysely } from 'kysely';

const FLAG = (column: string) => sql`${sql.ref(column)} is null or ${sql.ref(column)} in (0, 1)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('analysis_setting')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('local_url', 'text')
    .addColumn('local_model', 'text')
    .addColumn('reasoning_tokens', 'integer', (column) =>
      column.check(sql`reasoning_tokens is null or reasoning_tokens > 0`),
    )
    .addColumn('offer_local', 'integer', (column) => column.check(FLAG('offer_local')))
    .addColumn('offer_hosted', 'integer', (column) => column.check(FLAG('offer_hosted')))
    .addColumn('others_local', 'integer', (column) => column.check(FLAG('others_local')))
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .addColumn('updated_by', 'text', (column) =>
      column.notNull().check(sql`updated_by in ('app', 'cli')`),
    )
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('analysis_setting').execute();
}
