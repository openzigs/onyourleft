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

import type { Generated } from 'kysely';

/** An account on this instance. */
export interface AthleteTable {
  readonly id: string;
  readonly display_name: string;
  readonly created_at: number;
  readonly registration_state: string;
  /** When a moderator suspended the account, or `null` (#83). Added by migration 0007. */
  readonly suspended_at: number | null;
  /** When a moderator hid the display name, or `null` (#83). Added by migration 0007. */
  readonly display_name_hidden_at: number | null;
  /**
   * When the rider confirmed they are 18 or over, or `null` (#775, ruling Q5).
   * A confirmation's date, never a birth date. Added by migration 0008.
   */
  readonly adult_confirmed_at: number | null;
  /**
   * When the account became active — registered active, or approved — or
   * `null` while it never has (#775). Added by migration 0008.
   */
  readonly activated_at: number | null;
}

/** An Ed25519 public key an athlete signs with (ADR 0014). */
export interface DeviceKeyTable {
  /**
   * The raw 32-byte key, lowercase hex — ADR 0014's own spelling, the one a
   * signed activity record carries (#772 settled it; #769's comment said
   * base64url before anything wrote a key).
   */
  readonly public_key: string;
  readonly athlete_id: string;
  readonly added_at: number;
  readonly revoked_at: number | null;
  /** When the key last signed in (#773). Added by migration 0004. */
  readonly last_used_at: number | null;
}

/** A signed-in session. */
export interface SessionTable {
  /** SHA-256 of the bearer token, lowercase hex. Never the token. */
  readonly token_sha256: string;
  readonly athlete_id: string;
  readonly device_key: string;
  readonly expires_at: number;
  readonly revoked_at: number | null;
  /** What the session reaches (#898): `leave` only a suspended athlete's way out. Added by migration 0012. */
  readonly scope: SessionScope;
}

/** What a session reaches (#898, migration 0012). */
export type SessionScope = 'full' | 'leave';

/** A signed activity record an athlete sent (ADR 0014's canonical bytes). */
export interface ActivityRecordTable {
  readonly athlete_id: string;
  /** SHA-256 of the original file, which is its key in the blob store (#770). */
  readonly content_sha256: string;
  readonly signed_record: Uint8Array;
  readonly received_at: number;
  /**
   * The rider's "may be raced" consent, `0` or `1` (#793, migration 0011).
   * Defaults to `0`; not part of the signed record, because it is revocable.
   */
  readonly may_be_raced: Generated<number>;
}

/** A group ride or a race. */
export interface RoomTable {
  readonly id: string;
  readonly kind: 'group' | 'race';
  readonly visibility: 'private' | 'public';
  readonly route_sha256: string;
  readonly physics_version: number;
}

/** What a room is ridden on, as the room core needs it (#780, migration 0005). */
export interface RoomCourseTable {
  readonly room_id: string;
  readonly length_metres: number;
  /** JSON: `[[fromMetres, percent], …]`, the first from 0, ascending. */
  readonly grades: string;
  readonly riding_position: 'upright' | 'hoods' | 'drops';
  readonly capacity: number | null;
  readonly countdown_ms: number | null;
  readonly rejoin_window_ms: number | null;
  /** Unix seconds: when this race left its lobby. It is never a lobby again. */
  readonly race_started_at: number | null;
  /** How many riders crossed the line: the highest place written (#785, 0013). */
  readonly finishers: Generated<number | null>;
  /** Unix seconds: when this race's room said it was over — everybody off the road (#785, 0013). */
  readonly race_finished_at: Generated<number | null>;
}

/** One athlete's result in one room. */
export interface ResultTable {
  readonly room_id: string;
  readonly athlete_id: string;
  readonly finish_ms: number | null;
  readonly flags: number;
  /** 1 first, from the room's finish order; `null` for a rider who did not finish (#785, 0013). */
  readonly place: number | null;
  /** Mean power over the race per kilogram of declared mass (ruling Q17), or `null`. */
  readonly watts_per_kilogram: number | null;
  /** JSON: the durations, in seconds, of every plausibility ceiling breached. */
  readonly flagged_seconds: Generated<string>;
}

/** A room a rider made, and the digest of its code (#784, migration 0013). */
export interface PrivateRoomTable {
  readonly room_id: string;
  /** SHA-256 of the room code, lower-case hex. Never the code. */
  readonly code_sha256: string;
  /** 1 when the shared route is ridden as a loop. */
  readonly route_loop: number;
  readonly created_at: number;
  /** Unix seconds: when the room was over. Never opened again after. */
  readonly closed_at: number | null;
}

/** Who may be ticketed into a private room (#784, migration 0013). */
export interface RoomMemberTable {
  readonly room_id: string;
  readonly athlete_id: string;
  readonly role: 'creator' | 'rider';
  readonly joined_at: number;
}

/** A nonce issued to a public key (#772). Not athlete-scoped: see migration 0004. */
export interface AuthChallengeTable {
  readonly nonce: string;
  readonly public_key: string;
  readonly expires_at: number;
  readonly used_at: number | null;
}

/** A one-time recovery code, as its SHA-256 (#773, ruling Q1). */
export interface RecoveryCodeTable {
  readonly code_sha256: string;
  readonly athlete_id: string;
  readonly created_at: number;
  readonly used_at: number | null;
}

/** A code one device minted so another can be added to the athlete (#773). */
export interface LinkCodeTable {
  readonly code_sha256: string;
  readonly athlete_id: string;
  /** The device key that minted it — this athlete's, by the composite foreign key. */
  readonly minted_by_key: string;
  readonly expires_at: number;
  readonly used_at: number | null;
}

/** A name an athlete had before, and when it changed: #789's audit trail (#774). */
export interface DisplayNameChangeTable {
  readonly id: Generated<number>;
  readonly athlete_id: string;
  readonly previous_name: string;
  readonly changed_at: number;
}

/**
 * An athlete's address for email recovery — only where the operator enabled
 * it (#773), and only once the athlete confirmed it (#865).
 */
export interface RecoveryEmailTable {
  readonly athlete_id: string;
  readonly address: string;
}

/** An email recovery link's token, as its SHA-256 (#773). */
export interface EmailRecoveryTokenTable {
  readonly token_sha256: string;
  readonly athlete_id: string;
  readonly expires_at: number;
  readonly used_at: number | null;
}

/**
 * An address an athlete gave, waiting to be confirmed (#865), and the SHA-256
 * of the mailed token. Added by migration 0006.
 */
export interface RecoveryEmailConfirmationTable {
  readonly token_sha256: string;
  readonly athlete_id: string;
  readonly address: string;
  readonly expires_at: number;
  readonly used_at: number | null;
}

/** One athlete blocking another (#83): the blocker's row. */
export interface BlockTable {
  readonly athlete_id: string;
  /** No foreign key: `eraseAthlete` removes the rows naming an erased athlete (migration 0007). */
  readonly blocked_athlete_id: string;
  readonly created_at: number;
}

/** A report (#83): the reporter's row. */
export interface ReportTable {
  readonly id: Generated<number>;
  readonly athlete_id: string;
  readonly target_athlete_id: string;
  readonly reason: string;
  readonly created_at: number;
  readonly closed_at: number | null;
  readonly closed_by_athlete_id: string | null;
  readonly outcome: string | null;
}

/** One moderator action (#83). Append-only: the schema refuses an UPDATE or a DELETE. */
export interface ModerationLogTable {
  readonly id: Generated<number>;
  readonly actor_athlete_id: string;
  readonly action: string;
  readonly target_athlete_id: string | null;
  readonly report_id: number | null;
  readonly reason: string;
  readonly at: number;
}

/** A single-use invitation a moderator minted, as its SHA-256 (#775). */
export interface InviteCodeTable {
  readonly code_sha256: string;
  /** The moderator who minted it. */
  readonly athlete_id: string;
  readonly expires_at: number;
  readonly used_at: number | null;
}

/** What kind of thing a sync item is (#37, #776). */
export type SyncKind =
  'activity' | 'write-up' | 'ride-summary' | 'side-camera-report' | 'goal' | 'note' | 'document';

/** One thing an athlete synced, or its tombstone (#776). Added by migration 0009. */
export interface SyncItemTable {
  readonly seq: Generated<number>;
  readonly athlete_id: string;
  readonly kind: SyncKind;
  readonly item_key: string;
  /** SHA-256 of the body, or of the signed record for an activity; `null` for a tombstone. */
  readonly digest: string | null;
  /** The item exactly as the device sent it; `null` for an activity and a tombstone. */
  readonly body: Uint8Array | null;
  readonly received_at: number;
  readonly deleted_at: number | null;
}

/**
 * One synced item the history index has cut into passages, or found nothing
 * to cut (#835, ADR 0040). Added by migration 0010.
 */
export interface HistorySourceTable {
  readonly athlete_id: string;
  readonly source_kind: SyncKind;
  readonly source_key: string;
  /** The `sync_item.digest` of the body the passages were cut from. */
  readonly source_digest: string;
  readonly model: string;
  readonly convention: string;
  readonly outcome: 'indexed' | 'empty' | 'too-long' | 'picture';
  readonly passages: number;
  readonly indexed_at: number;
}

/** One passage of the history index and its vector (#835, ADR 0040 D-4). Added by migration 0010. */
export interface HistoryPassageTable {
  readonly athlete_id: string;
  readonly source_kind: SyncKind;
  readonly source_key: string;
  readonly ordinal: number;
  readonly passage: string;
  readonly model: string;
  readonly dimension: number;
  readonly convention: string;
  /** Little-endian `Float32`, unit length. */
  readonly vector: Uint8Array;
}

/** Every table, by name. */
export interface InstanceDatabase {
  readonly athlete: AthleteTable;
  readonly device_key: DeviceKeyTable;
  readonly session: SessionTable;
  readonly activity_record: ActivityRecordTable;
  readonly room: RoomTable;
  readonly room_course: RoomCourseTable;
  readonly result: ResultTable;
  readonly private_room: PrivateRoomTable;
  readonly room_member: RoomMemberTable;
  readonly auth_challenge: AuthChallengeTable;
  readonly recovery_code: RecoveryCodeTable;
  readonly link_code: LinkCodeTable;
  readonly display_name_change: DisplayNameChangeTable;
  readonly recovery_email: RecoveryEmailTable;
  readonly email_recovery_token: EmailRecoveryTokenTable;
  readonly recovery_email_confirmation: RecoveryEmailConfirmationTable;
  readonly block: BlockTable;
  readonly report: ReportTable;
  readonly moderation_log: ModerationLogTable;
  readonly invite_code: InviteCodeTable;
  readonly sync_item: SyncItemTable;
  readonly history_source: HistorySourceTable;
  readonly history_passage: HistoryPassageTable;
}
