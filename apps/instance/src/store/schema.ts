// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's tables, as Kysely sees them (#769).
 *
 * This is the TYPE of the schema; the schema itself is whatever the migrations
 * in `migrations/` build, and `migrations.test.ts` reads it back from
 * `sqlite_schema` rather than trusting either. The shape follows #769's
 * entity diagram, which is a starting point: #37, #772 and #785 own their
 * tables' final shape and change it with migrations of their own.
 *
 * ## Conventions
 *
 * - Columns are `snake_case`; the port in `sql-store.ts` speaks camelCase, as
 *   `packages/store`'s records do (ADR 0005 F: the instance mirrors the local
 *   store's shape), and converts at the one place it reads and writes a row.
 * - Times are integer **Unix seconds**, `packages/store`'s `UnixSeconds`.
 * - ⚠️ **Every athlete-scoped table names its owner in a column called
 *   `athlete_id`.** That is not a style note: `eraseAthlete` deletes by that
 *   column. The erasure test finds the athlete-scoped tables by their foreign
 *   keys to `athlete` and fails on one whose column is called anything else,
 *   and it requires a reference between two athlete-scoped tables to carry
 *   `athlete_id` on both sides (#842's review: a session could otherwise name
 *   another athlete's device key and block that athlete's erasure).
 * - A session stores the SHA-256 of its token and never the token, so a copy
 *   of this database authenticates nobody.
 */

/** An account on this instance. */
export interface AthleteTable {
  readonly id: string;
  readonly display_name: string;
  readonly created_at: number;
  readonly registration_state: string;
}

/** An Ed25519 public key an athlete signs with (ADR 0014). */
export interface DeviceKeyTable {
  /** The raw 32-byte key, base64url. */
  readonly public_key: string;
  readonly athlete_id: string;
  readonly added_at: number;
  readonly revoked_at: number | null;
}

/** A signed-in session. */
export interface SessionTable {
  /** SHA-256 of the bearer token, lowercase hex. Never the token. */
  readonly token_sha256: string;
  readonly athlete_id: string;
  readonly device_key: string;
  readonly expires_at: number;
  readonly revoked_at: number | null;
}

/** A signed activity record an athlete sent (ADR 0014's canonical bytes). */
export interface ActivityRecordTable {
  readonly athlete_id: string;
  /** SHA-256 of the original file, which is its key in the blob store (#770). */
  readonly content_sha256: string;
  readonly signed_record: Uint8Array;
  readonly received_at: number;
}

/** A group ride or a race. */
export interface RoomTable {
  readonly id: string;
  readonly kind: 'group' | 'race';
  readonly visibility: 'private' | 'public';
  readonly route_sha256: string;
  readonly physics_version: number;
}

/** One athlete's result in one room. */
export interface ResultTable {
  readonly room_id: string;
  readonly athlete_id: string;
  readonly finish_ms: number | null;
  readonly flags: number;
}

/** Every table, by name. */
export interface InstanceDatabase {
  readonly athlete: AthleteTable;
  readonly device_key: DeviceKeyTable;
  readonly session: SessionTable;
  readonly activity_record: ActivityRecordTable;
  readonly room: RoomTable;
  readonly result: ResultTable;
}
