// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0047 (#2782, ADR 0080 D-3, D-5): **the owner's claim**, so the
 * owner key can be set from the app rather than pasted into
 * `OYL_INSTANCE_OWNER_KEY`.
 *
 * - **`owner_claim_code`** — a claim code the loopback setup page minted
 *   (#2784): the SHA-256 of its normalised form (never the code), when it was
 *   minted and when it expires (Unix seconds). Once a device redeems it over
 *   the sealed claim route the row is the **pending claim** as well: when it
 *   was redeemed, the device key that signed the sealed request, and the
 *   six-digit comparison code the instance derived from the code and that key
 *   (`@onyourleft/domain` §`ownerClaimComparisonCode`), which the loopback page
 *   shows beside the tablet's. A `CHECK` holds the three together: all `NULL`,
 *   or all set and the comparison code six digits. Confirming the claim or
 *   minting a new code deletes the row, so a code is never redeemed twice.
 * - **`instance_owner`** — at most one row (`slot` is always 1): the device
 *   key a confirmed claim made the owner, and when. The owner key the instance
 *   uses is `OYL_INSTANCE_OWNER_KEY` when it is set, else this row's
 *   (`moderation/moderation.ts` §`ownerKey`), read on every owner check. No foreign key: the
 *   claimed key is the owner's before that device has an account here.
 *
 * `down` drops both tables. An instance whose owner was claimed rather than
 * named in `.env` then has no owner until `OYL_INSTANCE_OWNER_KEY` is set,
 * exactly as before this migration; no rider's data is in either table.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('owner_claim_code')
    .addColumn('code_sha256', 'text', (column) => column.primaryKey())
    .addColumn('minted_at', 'integer', (column) => column.notNull())
    .addColumn('expires_at', 'integer', (column) => column.notNull())
    .addColumn('redeemed_at', 'integer')
    .addColumn('device_key', 'text')
    .addColumn('comparison_code', 'text')
    .addCheckConstraint(
      'owner_claim_code_pending',
      sql`(redeemed_at is null and device_key is null and comparison_code is null) or (redeemed_at is not null and device_key is not null and comparison_code is not null and length(comparison_code) = 6 and comparison_code not glob '*[^0-9]*')`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('instance_owner')
    .addColumn('slot', 'integer', (column) => column.primaryKey().check(sql`slot = 1`))
    .addColumn('owner_key', 'text', (column) => column.notNull())
    .addColumn('claimed_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('instance_owner').execute();
  await db.schema.dropTable('owner_claim_code').execute();
}
