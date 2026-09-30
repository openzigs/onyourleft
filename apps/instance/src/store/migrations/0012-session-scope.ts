// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0012 (#898): what a session may reach — **`session.scope`**.
 *
 * `full` is every session there has been, and every row this adds the column
 * to: a signed-in device, held to what its athlete's standing allows
 * (`handler.ts`). `leave` is a session a SUSPENDED athlete opens with a signed
 * statement (`POST /v1/auth/leave-session`), and it reaches exactly the routes
 * that declare `admitsSuspended` — taking the account's data out, and deleting
 * the account — and nothing else. A suspension still ends every session there
 * is (`sql-store.ts` §`moderate`); this is how the rider most likely to want to
 * leave can still do it.
 *
 * ⚠️ A `leave` session is never a full one: once the suspension is lifted it
 * authenticates nobody (`identity.ts` §`authenticate`), and the rider signs in
 * as usual. The check keeps a third value out.
 *
 * `down` drops the column. Every open `leave` session would then read as a full
 * one, so `down` REVOKES them first: an instance rolled back cannot give a
 * suspended rider more than it could before.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('session')
    .addColumn('scope', 'text', (column) =>
      column
        .notNull()
        .defaultTo('full')
        .check(sql`scope in ('full', 'leave')`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update session set revoked_at = coalesce(revoked_at, 0) where scope = 'leave'`.execute(
    db,
  );
  await db.schema.alterTable('session').dropColumn('scope').execute();
}
