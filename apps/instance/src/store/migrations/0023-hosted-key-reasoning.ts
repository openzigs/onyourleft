// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0023 (#1268): **`athlete_hosted_key.reasoning_tokens`** — what a
 * rider says their hosted model needs to reason in one turn.
 *
 * A model that reasons spends part of a turn's output allowance thinking
 * before it writes (`analysis/agent.ts`). The agent finds that out from the
 * model's replies; a rider who knows their model reasons says so here, beside
 * the key, and every turn of their hosted jobs is given that room from the
 * first. `NULL` is a rider who said nothing, and the agent finds out.
 *
 * The column is not secret and is not sealed with the key. It lives on the
 * key's row, so it goes when the key is cleared or replaced with the athlete.
 *
 * `down` drops the column: a rider sets it again after the instance rolls
 * forward, and until then the agent finds out from the replies.
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('athlete_hosted_key')
    .addColumn('reasoning_tokens', 'integer')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('athlete_hosted_key').dropColumn('reasoning_tokens').execute();
}
