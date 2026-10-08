// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0015 (#1189, ADR 0047 D-5): the instance's own two keys.
 *
 * - **`instance_key`** — one row per key the instance holds: its id (the
 *   first 8 bytes of SHA-256 over the public key, 16 hex), its role
 *   (`identity`, Ed25519, or `encryption`, X25519), the public key, and the
 *   PRIVATE half as PKCS #8 wrapped with AES-256-GCM under a key derived from
 *   `OYL_INSTANCE_SECRET_KEY` (`keys/wrap.ts`), with the 12-byte nonce it was
 *   wrapped under. There is no plaintext column, so a `VACUUM INTO` snapshot
 *   (`operator backup`) holds ciphertext only. An encryption key also has its
 *   `serial` and, once a successor exists, `superseded_at`; a row is DELETED
 *   seven days after that (`keys/instance-keys.ts`).
 * - **`instance_key_statement`** — what the identity key signed: a key
 *   statement for one encryption key (`kind = 'key'`), or the endorsement of
 *   a new identity key (`'identity-rotation'`), as its RFC 8785 text and the
 *   signature. Public, and served at `GET /v1/instance/keys`.
 *
 * Neither names an athlete, so `eraseAthlete` (which derives its tables from
 * `athlete_id`) never reaches them, and the account export holds none of it.
 *
 * `down` drops both, and the keys with them: an instance rolled back past
 * this makes a new identity key on its next start, and every device re-pins.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('instance_key')
    .addColumn('key_id', 'text', (column) => column.primaryKey())
    .addColumn('role', 'text', (column) =>
      column.notNull().check(sql`role in ('identity', 'encryption')`),
    )
    .addColumn('public_key', 'blob', (column) => column.notNull())
    .addColumn('iv', 'blob', (column) => column.notNull())
    .addColumn('wrapped', 'blob', (column) => column.notNull())
    .addColumn('serial', 'integer')
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('superseded_at', 'integer')
    .addCheckConstraint('instance_key_serial', sql`(role = 'encryption') = (serial is not null)`)
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('instance_key_statement')
    .addColumn('key_id', 'text', (column) =>
      column.notNull().references('instance_key.key_id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (column) =>
      column.notNull().check(sql`kind in ('key', 'identity-rotation')`),
    )
    .addColumn('issued_at', 'integer', (column) => column.notNull())
    .addColumn('not_after', 'integer')
    .addColumn('body', 'text', (column) => column.notNull())
    .addColumn('signature', 'text', (column) => column.notNull())
    .addPrimaryKeyConstraint('instance_key_statement_pk', ['key_id', 'kind', 'issued_at'])
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('instance_key_statement').execute();
  await db.schema.dropTable('instance_key').execute();
}
