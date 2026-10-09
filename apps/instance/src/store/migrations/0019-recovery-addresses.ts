// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0019 (#1194, ADR 0047 D-8 "What changes in code" 1–4): up to two
 * recovery addresses an athlete, each held for a week after it is confirmed.
 *
 * - **`recovery_email`** is re-keyed by **(athlete, address)**, and gains
 *   `confirmed_at` (when `/confirm` bound it, Unix seconds) and `bound_by_key`
 *   (the key that GAVE it — the binder). ⚠️ **0004's instance-wide unique
 *   constraint on `address` stays** (review K5): an address is bound to at most
 *   one athlete, held or established, so `recover/email` resolves it to one
 *   account. `bound_by_key` is referenced as `(bound_by_key, athlete_id)`
 *   against `device_key`, the #842 rule. A row from before this migration is
 *   kept with both new columns `NULL`, which the store reads as
 *   **established**: an address bound before phase 1 is past any hold, and the
 *   one-off review asks the rider whether it is theirs.
 * - **`recovery_email_confirmation`** — a pending confirmation is **one per
 *   key** (a partial unique index on `(athlete_id, requested_by_key)` over the
 *   unspent rows), so one key giving an address does not cancel another key's;
 *   and `superseded_at`, set when another key's confirmation of the same
 *   address bound it first, so a later `/confirm` with this one's code is
 *   `confirmation_superseded` rather than `code_unknown`.
 * - **`email_recovery_token.address`** — the address a token was mailed to, so
 *   a token recovers or steps up only for that address, and only while it is
 *   still bound and past its hold. A token from before this migration takes
 *   its athlete's one address, which is the only address it can have been
 *   mailed to.
 *
 * `down` restores 0018's shape with every EXISTING row, which is what an
 * instance rolled back the day it upgraded holds. ⚠️ **What only the new shape
 * can hold is lost on `down`**: an athlete with two addresses keeps ONE (the
 * one bound first — a `NULL` `confirmed_at` before any time), and a
 * confirmation's `superseded_at` and a token's `address` go with their
 * columns.
 *
 * `recovery_email` is rebuilt rather than renamed into place, in both
 * directions, so its `CREATE TABLE` text is exactly what each side's
 * migration writes (`migrations.test.ts` compares the schema text).
 */

import { sql, type Kysely } from 'kysely';

/** 0004's table, exactly as 0004 creates it. */
async function createKeyedByAthlete(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('recovery_email')
    .addColumn('athlete_id', 'text', (column) => column.primaryKey().references('athlete.id'))
    .addColumn('address', 'text', (column) => column.notNull().unique())
    .modifyEnd(sql`strict`)
    .execute();
}

async function createKeyedByAddress(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('recovery_email')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('address', 'text', (column) => column.notNull().unique())
    .addColumn('confirmed_at', 'integer')
    .addColumn('bound_by_key', 'text')
    .addPrimaryKeyConstraint('recovery_email_key', ['athlete_id', 'address'])
    .addForeignKeyConstraint(
      'recovery_email_bound_by_its_athletes_key',
      ['bound_by_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // Each token takes its athlete's one address BEFORE that table is rebuilt.
  await db.schema.alterTable('email_recovery_token').addColumn('address', 'text').execute();
  await sql`update email_recovery_token set address = (
      select address from recovery_email where recovery_email.athlete_id = email_recovery_token.athlete_id
    )`.execute(db);

  await sql`create table recovery_email_0019 as select athlete_id, address from recovery_email`.execute(
    db,
  );
  await db.schema.dropTable('recovery_email').execute();
  await createKeyedByAddress(db);
  await sql`insert into recovery_email (athlete_id, address, confirmed_at, bound_by_key)
      select athlete_id, address, null, null from recovery_email_0019`.execute(db);
  await db.schema.dropTable('recovery_email_0019').execute();

  await db.schema
    .alterTable('recovery_email_confirmation')
    .addColumn('superseded_at', 'integer')
    .execute();
  await db.schema
    .createIndex('recovery_email_confirmation_pending_per_key')
    .unique()
    .on('recovery_email_confirmation')
    .columns(['athlete_id', 'requested_by_key'])
    .where(sql.ref('used_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('recovery_email_confirmation_pending_per_key').execute();
  await db.schema.alterTable('recovery_email_confirmation').dropColumn('superseded_at').execute();

  // One address an athlete: the one bound first. A `NULL` `confirmed_at` (an
  // address from before 0019) sorts before any time.
  await sql`create table recovery_email_0019 as
      select athlete_id, address from recovery_email as outer_row
      where address = (
        select inner_row.address from recovery_email as inner_row
        where inner_row.athlete_id = outer_row.athlete_id
        order by inner_row.confirmed_at is not null, inner_row.confirmed_at, inner_row.address
        limit 1
      )`.execute(db);
  await db.schema.dropTable('recovery_email').execute();
  await createKeyedByAthlete(db);
  await sql`insert into recovery_email (athlete_id, address)
      select athlete_id, address from recovery_email_0019`.execute(db);
  await db.schema.dropTable('recovery_email_0019').execute();

  await db.schema.alterTable('email_recovery_token').dropColumn('address').execute();
}
