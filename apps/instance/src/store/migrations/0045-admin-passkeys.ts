// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0045 (#2642, ADR 0069 D-1, D-4, D-8): **the owner's passkeys
 * for the admin pages**, which session each opened, and the ceremonies'
 * single-use challenges.
 *
 * - **`admin_passkey`** — one passkey: a random id, the credential id
 *   (base64url, unique), the RP ID it was enrolled for, its algorithm
 *   (`ed25519` or `es256`, ADR 0069 D-1), the public key (hex), the signature
 *   counter, the WebAuthn user handle the instance enrolled it under, the
 *   `OYL_INSTANCE_OWNER_KEY` the owner held at enrolment (under any other key it
 *   is not usable), the
 *   label the owner gave it, the listener it was enrolled on, when it was
 *   enrolled and last used, and when `operator admin-passkeys confirm`
 *   confirmed it — `NULL` until then for one enrolled through the tunnel,
 *   which can read and not change until it is (the owner's Q-C answer). It
 *   names no athlete: it is the owner's, whoever holds
 *   `OYL_INSTANCE_OWNER_KEY` (ADR 0069 D-1). A revoked passkey's row is
 *   deleted; the operator log keeps the record.
 * - **`admin_passkey_session`** — which passkey opened which session, so
 *   revoking the passkey ends every session it opened. Both keys cascade.
 * - **`admin_challenge`** — a challenge issued and not yet answered, kept as
 *   its SHA-256: a sign-in's (no session), or an enrolment's or a step-up's
 *   (for one session; a step-up's also bound to its action and the SHA-256
 *   of its canonical fields). Single use, two minutes (ADR 0069 D-4). A
 *   session's challenges go with it.
 *
 * ⚠️ ADR 0069 D-8 puts a session's passkey and pending step-up in
 * `admin_session`'s own columns; they are tables of their own here (*the
 * implementer's choice*), because a sign-in's challenge has no session to sit
 * in, and adding a column to `admin_session` would make `down` rewrite that
 * table's schema text rather than restore it.
 *
 * `down` drops the three tables: every passkey goes, and every session opened
 * with one is ended first, so no session outlives the record of how it was
 * opened. The operator log's entries about passkeys stay — its `action`
 * column is free of any `CHECK` (migration 0040).
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_passkey')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('credential_id', 'text', (column) => column.notNull().unique())
    .addColumn('rp_id', 'text', (column) => column.notNull())
    .addColumn('algorithm', 'text', (column) =>
      column.notNull().check(sql`algorithm in ('ed25519', 'es256')`),
    )
    .addColumn('public_key', 'text', (column) => column.notNull())
    .addColumn('sign_count', 'integer', (column) => column.notNull().check(sql`sign_count >= 0`))
    .addColumn('user_handle', 'text', (column) => column.notNull())
    // The OYL_INSTANCE_OWNER_KEY the owner held when they enrolled it: a passkey
    // does not outlive the owner it was enrolled by.
    .addColumn('owner_key', 'text', (column) => column.notNull())
    .addColumn('label', 'text', (column) =>
      column.notNull().check(sql`length(label) between 1 and 60`),
    )
    .addColumn('listener', 'text', (column) =>
      column.notNull().check(sql`listener in ('tunnel', 'loopback')`),
    )
    .addColumn('enrolled_at', 'integer', (column) => column.notNull())
    .addColumn('last_used_at', 'integer')
    .addColumn('confirmed_at', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('admin_passkey_session')
    .addColumn('token_sha256', 'text', (column) =>
      column.primaryKey().references('admin_session.token_sha256').onDelete('cascade'),
    )
    .addColumn('passkey_id', 'text', (column) =>
      column.notNull().references('admin_passkey.id').onDelete('cascade'),
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('admin_passkey_session_passkey')
    .on('admin_passkey_session')
    .column('passkey_id')
    .execute();
  await db.schema
    .createTable('admin_challenge')
    .addColumn('challenge_sha256', 'text', (column) => column.primaryKey())
    .addColumn('purpose', 'text', (column) =>
      column.notNull().check(sql`purpose in ('sign_in', 'enrol', 'step_up')`),
    )
    .addColumn('session_sha256', 'text', (column) =>
      column.references('admin_session.token_sha256').onDelete('cascade'),
    )
    .addColumn('action', 'text')
    .addColumn('fields_sha256', 'text')
    // The WebAuthn user handle an enrolment's options named, which the
    // registration response does not carry back.
    .addColumn('user_handle', 'text')
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    // A sign-in's challenge has no session; every other one has its session.
    .addCheckConstraint(
      'admin_challenge_session',
      sql`(purpose = 'sign_in') = (session_sha256 is null)`,
    )
    // A step-up's challenge is bound to its action and fields; no other one is.
    .addCheckConstraint(
      'admin_challenge_binding',
      sql`(purpose = 'step_up') = (action is not null and fields_sha256 is not null)`,
    )
    .addCheckConstraint(
      'admin_challenge_user',
      sql`(purpose = 'enrol') = (user_handle is not null)`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('admin_challenge_session')
    .on('admin_challenge')
    .column('session_sha256')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // A session opened with a passkey ends with the passkeys.
  await sql`delete from admin_session
    where token_sha256 in (select token_sha256 from admin_passkey_session)`.execute(db);
  await db.schema.dropIndex('admin_challenge_session').execute();
  await db.schema.dropTable('admin_challenge').execute();
  await db.schema.dropIndex('admin_passkey_session_passkey').execute();
  await db.schema.dropTable('admin_passkey_session').execute();
  await db.schema.dropTable('admin_passkey').execute();
}
