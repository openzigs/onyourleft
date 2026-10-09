// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0016 (#1203, ADR 0047 D-5): **one writer of the instance's keys
 * at a time**, across processes.
 *
 * The running instance's timer runs a maintenance pass, and an operator's
 * `instance-key init | rotate | rotate-identity | reset` writes the same
 * tables from a second process (`operator/cli.ts`). Each takes this lease
 * before it writes a key and gives it back after (`keys/instance-keys.ts`
 * §`leased`); a second taker is refused while it is held, and a lease whose
 * holder died is free once `expires_at` has passed by the box's clock.
 *
 * One row at most: `name` can only be `'keys'`. It names no athlete and holds
 * no key, so neither `eraseAthlete` nor the account export reaches it.
 * `down` drops it.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('instance_key_lease')
    .addColumn('name', 'text', (column) => column.primaryKey().check(sql`name = 'keys'`))
    .addColumn('holder', 'text', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('instance_key_lease').execute();
}
