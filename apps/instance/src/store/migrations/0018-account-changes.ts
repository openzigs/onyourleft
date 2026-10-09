// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0018 (#1193, ADR 0047 D-8): the account-change log, and each
 * device's place in it.
 *
 * - **`account_change`** — every account-security change, per athlete, with
 *   its time and **the device key that authorised it**: a link code minted, a
 *   key added (by a link code — named by the key that MINTED the code — or by
 *   `recover`, named by the key it added, with how), a key revoked, a
 *   recovery address added or cleared, and — once #1194 builds the reset —
 *   the recovery codes replaced. Written in the transaction that makes the
 *   change (`sql-store.ts`), read only sealed (`GET /v1/auth/account-changes`),
 *   carried by the account export and erased with the account.
 * - **`account_change_mark`** — how far ONE device has acknowledged that log.
 *   Keyed by athlete AND device key, so a device's acknowledgement moves its
 *   own mark and nobody else's: no key, an edge-added one included, can mark
 *   a notice seen for another device (D-8).
 * - **`recovery_email_confirmation.requested_by_key`** — the key that gave a
 *   pending address, so a revoke can cancel that key's confirmation and an
 *   address's binder is the key that gave it (D-8). `NULL` on a row written
 *   before this migration.
 *
 * Every key column is referenced as `(key, athlete_id)` against
 * `device_key`'s `(public_key, athlete_id)`, the #842 rule: one athlete's row
 * can never name another athlete's key, and `eraseAthlete` (which derives its
 * tables from the foreign keys to `athlete`) empties both tables with no edit.
 *
 * `down` drops both tables and the column: an instance rolled back past this
 * forgets the log, and runs a version that never showed it.
 */

import { sql, type Kysely } from 'kysely';

/** Every kind of entry the log holds. `codes_replaced` is written by #1194's reset. */
export const ACCOUNT_CHANGE_KINDS = [
  'codes_replaced',
  'address_added',
  'address_cleared',
  'link_code_minted',
  'key_added',
  'key_revoked',
] as const;

/** How a key was added: with a link code, or by `recover` with a code or a mailed token. */
export const KEY_ADDED_VIA = ['link_code', 'recovery_code', 'email_token'] as const;

const quoted = (values: readonly string[]): string => values.map((each) => `'${each}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('account_change')
    .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('kind', 'text', (column) =>
      column.notNull().check(sql.raw(`kind IN (${quoted(ACCOUNT_CHANGE_KINDS)})`)),
    )
    .addColumn('actor_key', 'text', (column) => column.notNull())
    .addColumn('subject_key', 'text')
    .addColumn('via', 'text', (column) =>
      column.check(sql.raw(`via IS NULL OR via IN (${quoted(KEY_ADDED_VIA)})`)),
    )
    .addColumn('address', 'text')
    .addForeignKeyConstraint(
      'account_change_by_its_athletes_key',
      ['actor_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .addForeignKeyConstraint(
      'account_change_about_its_athletes_key',
      ['subject_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('account_change_by_athlete')
    .on('account_change')
    .columns(['athlete_id', 'id'])
    .execute();
  await db.schema
    .createTable('account_change_mark')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('device_key', 'text', (column) => column.notNull())
    .addColumn('acknowledged_through', 'integer', (column) => column.notNull())
    .addColumn('acknowledged_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('account_change_mark_key', ['athlete_id', 'device_key'])
    .addForeignKeyConstraint(
      'account_change_mark_of_its_athletes_key',
      ['device_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .alterTable('recovery_email_confirmation')
    .addColumn('requested_by_key', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('recovery_email_confirmation')
    .dropColumn('requested_by_key')
    .execute();
  await db.schema.dropTable('account_change_mark').execute();
  await db.schema.dropTable('account_change').execute();
}
