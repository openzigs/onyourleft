// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0032 (#1383): **the load run's throwaway accounts, marked**.
 *
 * - **`athlete.load_run_at`** — when the operator's `load-accounts add`
 *   command made this account, or `NULL` for every account a rider made.
 *   `load-accounts erase` erases the accounts that carry it and no other, so
 *   the mark is what keeps the command off a real rider's account. Only that
 *   command writes it: no route sets it, and registration never does.
 *
 * `down` is refused while an account carries the mark: undoing it would turn
 * every throwaway account into an ordinary approved one that nothing could
 * tell apart from a rider's. Erase them first (`load-accounts erase`).
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('athlete').addColumn('load_run_at', 'integer').execute();
}

/** What `down` throws while a throwaway account is held. */
export class LoadAccountsHeldError extends Error {
  override readonly name = 'LoadAccountsHeldError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{
    n: number;
  }>`select count(*) as n from athlete where load_run_at is not null`.execute(db);
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new LoadAccountsHeldError(
      'Migration 0032 cannot be undone while the load run’s throwaway accounts are held: run `load-accounts erase` first. Nothing was changed.',
    );
  }
  await db.schema.alterTable('athlete').dropColumn('load_run_at').execute();
}
