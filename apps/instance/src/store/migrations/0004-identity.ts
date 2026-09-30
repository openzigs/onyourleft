// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0004 (#772, #773, #774): what identity needs beyond 0001's
 * athletes, keys and sessions.
 *
 * - **`auth_challenge`** — a nonce the instance issued to a public key, and
 *   whether it has been spent. Kept after use, with `used_at`, so a replay is
 *   told apart from a nonce the instance never issued (#772 asks for distinct
 *   refusals). Not athlete-scoped: a challenge is issued before the key names
 *   anybody, and to a key that may belong to nobody yet.
 * - **`device_key.last_used_at`** — when the key last signed in, for the
 *   device list (#773).
 * - **`recovery_code`** — the SHA-256 of each one-time recovery code shown at
 *   registration (ruling Q1). Never the code.
 * - **`link_code`** — the SHA-256 of a code one device mints so another can be
 *   added (#773), with the device key that minted it. ⚠️ That key is
 *   referenced as `(minted_by_key, athlete_id)` against `device_key`'s
 *   `(public_key, athlete_id)`, the #842 rule: a row of one athlete can never
 *   name another athlete's key.
 * - **`display_name_change`** — every name an athlete has had before the one
 *   they have, and when it changed: the moderation audit trail #789 acts on
 *   (#774), and what the rename rate limit counts.
 * - **`recovery_email`** and **`email_recovery_token`** — only ever written on
 *   an instance whose operator enabled email recovery (ruling Q1). A token is
 *   stored as its SHA-256.
 *
 * Every athlete-scoped table names its owner in `athlete_id` REFERENCES
 * `athlete`, which is what `eraseAthlete` deletes by (`schema.ts`).
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('auth_challenge')
    .addColumn('nonce', 'text', (column) => column.primaryKey())
    .addColumn('public_key', 'text', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('auth_challenge_by_expiry')
    .on('auth_challenge')
    .column('expires_at')
    .execute();

  await db.schema.alterTable('device_key').addColumn('last_used_at', 'integer').execute();

  await db.schema
    .createTable('recovery_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('recovery_code_by_athlete')
    .on('recovery_code')
    .column('athlete_id')
    .execute();

  await db.schema
    .createTable('link_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('minted_by_key', 'text', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .addForeignKeyConstraint(
      'link_code_minted_by_its_athletes_key',
      ['minted_by_key', 'athlete_id'],
      'device_key',
      ['public_key', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('link_code_by_athlete')
    .on('link_code')
    .column('athlete_id')
    .execute();

  await db.schema
    .createTable('display_name_change')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('previous_name', 'text', (column) => column.notNull())
    .addColumn('changed_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('display_name_change_by_athlete')
    .on('display_name_change')
    .columns(['athlete_id', 'changed_at'])
    .execute();

  await db.schema
    .createTable('recovery_email')
    .addColumn('athlete_id', 'text', (column) => column.primaryKey().references('athlete.id'))
    .addColumn('address', 'text', (column) => column.notNull().unique())
    .modifyEnd(sql`strict`)
    .execute();

  await db.schema
    .createTable('email_recovery_token')
    .addColumn('token_sha256', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('used_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('email_recovery_token_by_athlete')
    .on('email_recovery_token')
    .column('athlete_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('email_recovery_token').execute();
  await db.schema.dropTable('recovery_email').execute();
  await db.schema.dropTable('display_name_change').execute();
  await db.schema.dropTable('link_code').execute();
  await db.schema.dropTable('recovery_code').execute();
  await db.schema.alterTable('device_key').dropColumn('last_used_at').execute();
  await db.schema.dropTable('auth_challenge').execute();
}
