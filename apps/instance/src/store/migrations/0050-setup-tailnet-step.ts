// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0050 (#2817): **the setup wizard gains its tailnet step**,
 * `tailnet`, between `claim` and `passkey` (ADR 0079 D-2, D-8).
 *
 * `setup_state.step` is held to the wizard's steps by a `CHECK` (migration
 * 0048, widened by 0049), and SQLite widens a `CHECK` only by rebuilding its
 * table, so the one-row table is rebuilt with the step added, as 0049 did.
 * Its row is copied as it is.
 *
 * `down` rebuilds the table as 0049 made it. A setup that had reached
 * `tailnet` goes to `passkey`: the step after `claim` in the wizard that
 * `down` leaves, so a step already passed is not asked again. Nothing else is
 * in the table, and no rider's data is in it.
 */

import { sql, type Kysely, type RawBuilder } from 'kysely';

/** The wizard's steps as 0049 held them. */
const STEPS_BEFORE = sql<boolean>`step in ('claim', 'passkey', 'secrets', 'backups', 'registration', 'invite', 'ai', 'finish')`;

/** The wizard's steps with `tailnet` (`setup/setup-routes.ts` §`SETUP_STEPS`). */
const STEPS_AFTER = sql<boolean>`step in ('claim', 'tailnet', 'passkey', 'secrets', 'backups', 'registration', 'invite', 'ai', 'finish')`;

/** `setup_state` rebuilt under `steps`, each row copied with its step as `stepOf` gives it. */
async function rebuild(
  db: Kysely<unknown>,
  steps: RawBuilder<boolean>,
  stepOf: RawBuilder<string>,
): Promise<void> {
  await sql`create table setup_state_0050_copy as select * from setup_state`.execute(db);
  await db.schema.dropTable('setup_state').execute();
  await db.schema
    .createTable('setup_state')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('step', 'text', (column) => column.notNull().check(steps))
    .addColumn('done_at', 'integer')
    .addColumn('invite_minted_at', 'integer')
    .addColumn('updated_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await sql`insert into setup_state (slot, step, done_at, invite_minted_at, updated_at)
    select slot, ${stepOf}, done_at, invite_minted_at, updated_at
    from setup_state_0050_copy`.execute(db);
  await sql`drop table setup_state_0050_copy`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await rebuild(db, STEPS_AFTER, sql<string>`step`);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await rebuild(
    db,
    STEPS_BEFORE,
    sql<string>`case when step = 'tailnet' then 'passkey' else step end`,
  );
}
