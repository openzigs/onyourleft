// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's SQL storage port, `SqlStore`, and its SQLite implementation
 * (#769, ADR 0037 D-5).
 *
 * ## Portable on purpose
 *
 * This file names Kysely and nothing of Node: {@link createSqlStore} takes a
 * `Kysely<InstanceDatabase>` over any SQLite, so the Durable Object adapter
 * (#781) hands it a different database and nothing here changes (ADR 0037
 * D-2). `node-sqlite.ts` is the one file that names `node:sqlite`, and
 * `open-sql-store.ts` the one that puts the two together for the box.
 *
 * ## The rules it keeps
 *
 * - **Every athlete-scoped read takes the athlete FIRST, as `athleteId`, and
 *   filters on it** — never on the entity id alone (`CLAUDE.md` §6,
 *   cross-athlete exposure). `sql-store.scoping.test.ts` enumerates the port
 *   from this interface's own keys and needs a probe or a stated reason for
 *   every member.
 * - **A key owned by one athlete is never re-pointed at another.** A device key
 *   and a session token are primary keys; a write that names one already held
 *   by another athlete is refused with {@link OwnershipConflictError} rather
 *   than taken as an update, which would hand one athlete's key to another.
 *   A session naming a device key another athlete holds is refused the same
 *   way, and the schema's composite foreign key refuses it beneath that.
 * - **A revocation is final.** An upsert keeps a `revoked_at` already set, so
 *   a routine put carrying `revokedAt: null` cannot un-revoke a key or a
 *   session.
 * - **One operation at a time.** Kysely's SQLite driver has one connection and
 *   no lock, so two transactions started together would nest a `begin` inside
 *   another. {@link createSqlStore} queues every call behind the one before it.
 */

import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  ActivityRecordTable,
  AthleteTable,
  BlockTable,
  DeviceKeyTable,
  DisplayNameChangeTable,
  EmailRecoveryTokenTable,
  InstanceDatabase,
  InviteCodeTable,
  LinkCodeTable,
  ModerationLogTable,
  RecoveryCodeTable,
  RecoveryEmailConfirmationTable,
  ReportTable,
  ResultTable,
  RoomCourseTable,
  RoomTable,
  SessionTable,
  SyncItemTable,
  SyncKind,
} from './schema.ts';

export type { SyncKind } from './schema.ts';

export interface Athlete {
  readonly id: string;
  readonly displayName: string;
  /** Unix seconds. */
  readonly createdAt: number;
  readonly registrationState: string;
}

/** An athlete as the store holds them: what was written, and what moderation set (#83). */
export interface AthleteRecord extends Athlete {
  /** When a moderator suspended the account, or `null`. */
  readonly suspendedAt: number | null;
  /** When a moderator hid the display name, or `null`. */
  readonly displayNameHiddenAt: number | null;
  /** When the rider confirmed they are 18 or over, or `null` (#775). Never a birth date. */
  readonly adultConfirmedAt: number | null;
  /**
   * When the account became active — registered active, or approved — or
   * `null` while it has never been (#775). Public-room eligibility counts an
   * account's age from here, not from when it registered (#891's review).
   */
  readonly activatedAt: number | null;
}

export interface DeviceKey {
  /** Lowercase hex, ADR 0014's spelling. */
  readonly publicKey: string;
  readonly athleteId: string;
  readonly addedAt: number;
  readonly revokedAt: number | null;
  /** When the key last signed in; `null` until it has (#773). */
  readonly lastUsedAt: number | null;
}

/** A device key as it is written: when it was last used is the store's to record. */
export type DeviceKeyWrite = Omit<DeviceKey, 'lastUsedAt'>;

export interface Session {
  /** SHA-256 of the bearer token, lowercase hex. Never the token. */
  readonly tokenSha256: string;
  readonly athleteId: string;
  readonly deviceKey: string;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface ActivityRecord {
  readonly athleteId: string;
  readonly contentSha256: string;
  readonly signedRecord: Uint8Array;
  readonly receivedAt: number;
}

export interface Room {
  readonly id: string;
  readonly kind: 'group' | 'race';
  readonly visibility: 'private' | 'public';
  readonly routeSha256: string;
  readonly physicsVersion: number;
}

/** A room's course, as the room core needs it (#780): never geometry. */
export interface RoomCourse {
  readonly roomId: string;
  readonly lengthMetres: number;
  /** `[fromMetres, percent]` steps, the first from 0, ascending. */
  readonly grades: readonly (readonly [number, number])[];
  readonly ridingPosition: 'upright' | 'hoods' | 'drops';
  readonly capacity: number | null;
  readonly countdownMs: number | null;
  readonly rejoinWindowMs: number | null;
  /** Unix seconds: when this race left its lobby, or `null`. Set by {@link SqlStore.markRaceStarted}. */
  readonly raceStartedAt: number | null;
}

export interface Result {
  readonly roomId: string;
  readonly athleteId: string;
  readonly finishMs: number | null;
  readonly flags: number;
}

/** A nonce issued to a public key (#772). */
export interface Challenge {
  readonly nonce: string;
  readonly publicKey: string;
  readonly expiresAt: number;
}

/**
 * What spending a single-use value did. `used` and `expired` are told apart
 * from `unknown` because #772 and #773 each ask for a distinct refusal.
 */
export type Take<T> =
  | ({ readonly outcome: 'taken' } & T)
  | { readonly outcome: 'unknown' }
  | { readonly outcome: 'used' }
  | { readonly outcome: 'expired' };

/** One of an athlete's recovery codes, as its SHA-256 (ruling Q1). */
export interface RecoveryCode {
  readonly codeSha256: string;
  readonly athleteId: string;
  readonly createdAt: number;
  readonly usedAt: number | null;
}

/** A link code, as its SHA-256, and the device key that minted it (#773). */
export interface LinkCode {
  readonly codeSha256: string;
  readonly athleteId: string;
  readonly mintedByKey: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

/** A name an athlete had before (#774). */
export interface DisplayNameChange {
  readonly athleteId: string;
  readonly previousName: string;
  readonly changedAt: number;
}

/** An athlete's email recovery address. */
export interface RecoveryEmail {
  readonly athleteId: string;
  readonly address: string;
}

/** An email recovery link's token, as its SHA-256. */
export interface EmailRecoveryToken {
  readonly tokenSha256: string;
  readonly athleteId: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

/**
 * An address an athlete gave for email recovery, waiting for them to follow
 * the link mailed to it (#865). The token is stored as its SHA-256.
 */
export interface EmailConfirmation {
  readonly tokenSha256: string;
  readonly athleteId: string;
  readonly address: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

/**
 * What spending a confirmation did: {@link Take}, or `held` when another
 * athlete's confirmed address it is — refused, and nothing spent.
 */
export type ConfirmOutcome = Take<{ readonly athleteId: string }> | { readonly outcome: 'held' };

/** A new athlete, their first key and their recovery codes, written together or not at all. */
export interface Registration {
  readonly athlete: Athlete;
  readonly key: DeviceKeyWrite;
  readonly recoveryCodeSha256s: readonly string[];
  /**
   * Only where the operator enabled email recovery: the address the athlete
   * gave, as a confirmation waiting for its link (#865). ⚠️ **Nothing is
   * bound here**, whoever holds the address: an address is bound only by
   * {@link SqlStore.confirmRecoveryEmail}, so an address typed at
   * registration — somebody else's included — is usable for recovery by
   * nobody until the mailbox's reader follows the link.
   */
  readonly recoveryEmailConfirmation?: Omit<EmailConfirmation, 'athleteId' | 'usedAt'>;
  /** The rider confirmed they are 18 or over as they registered (#775): when. */
  readonly adultConfirmedAt?: number;
  /**
   * An invitation to spend in the same transaction (#775's invite-only mode),
   * so a registration that fails leaves the invitation unspent, and one
   * invitation cannot register two athletes. A refusal throws
   * {@link InviteRefusedError}.
   */
  readonly inviteCodeSha256?: string;
}

/** A moderator's invitation, as its SHA-256 (#775). */
export interface InviteCode {
  readonly codeSha256: string;
  /** The moderator who minted it. */
  readonly athleteId: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

/** A registration's invitation could not be spent: why. */
export class InviteRefusedError extends Error {
  override readonly name = 'InviteRefusedError';
  readonly outcome: 'unknown' | 'used' | 'expired';
  constructor(outcome: 'unknown' | 'used' | 'expired') {
    super(`The invitation is ${outcome}.`);
    this.outcome = outcome;
  }
}

/** One athlete blocking another (#83). */
export interface Block {
  /** The blocker. */
  readonly athleteId: string;
  readonly blockedAthleteId: string;
  readonly createdAt: number;
}

/** A report (#83): its reporter is `athleteId`. */
export interface Report {
  readonly id: number;
  readonly athleteId: string;
  readonly targetAthleteId: string;
  readonly reason: string;
  readonly createdAt: number;
  readonly closedAt: number | null;
  readonly closedByAthleteId: string | null;
  readonly outcome: string | null;
}

/** What a moderator may do (#83, #775). */
export type ModerationActionKind =
  | 'suspend'
  | 'unsuspend'
  | 'hide_display_name'
  | 'dismiss_report'
  | 'approve_registration'
  | 'refuse_registration'
  /**
   * The instance's, not a moderator's: a pending account whose key the
   * operator named as a moderator's signed in, and was activated, because
   * nobody may approve a moderator (#891's review). Its actor is the account.
   */
  | 'activate_moderator_key';

/** One moderator action, as it is asked for and as it is logged. */
export interface ModerationAction {
  readonly action: ModerationActionKind;
  readonly actorAthleteId: string;
  readonly targetAthleteId: string | null;
  /** The report this action decides, if any: it is closed with the action as its outcome. */
  readonly reportId: number | null;
  readonly reason: string;
  readonly at: number;
}

/**
 * Everything the log records: the actions, a moderator minting an invitation
 * (#775), and a moderator's attempt to act on a moderator — themselves
 * included — which was refused and changed nothing (#891's review).
 */
export type LoggedActionKind =
  ModerationActionKind | 'mint_invite' | `refused_${ModerationActionKind}`;

/** One entry of the append-only moderation log. */
export interface ModerationLogEntry extends Omit<ModerationAction, 'action'> {
  readonly id: number;
  readonly action: LoggedActionKind;
}

/**
 * What asking for a moderator action did. It is `applied` — and logged, in the
 * same transaction — or it changed nothing and logged nothing.
 */
export type ModerationOutcome =
  | { readonly outcome: 'applied'; readonly logId: number }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'not_applicable' };

/** What revoking a device key did (#867). */
export type RevokeOutcome = 'revoked' | 'not_found' | 'last_device';

/** How many times a display name may change, and over how long (#774, #867). */
export interface RenameLimit {
  readonly count: number;
  readonly windowSeconds: number;
}

/** What a rename did (#867). */
export type RenameOutcome = 'renamed' | 'not_found' | 'rate_limited';

/** What storing an activity record did: a retried sync of the same file is `duplicate`. */
export type PutOutcome = 'stored' | 'duplicate';

/** Every kind a sync item may be, in the order the manifest documents them (#776). */
export const SYNC_KINDS: readonly SyncKind[] = [
  'activity',
  'write-up',
  'side-camera-report',
  'goal',
  'note',
  'document',
];

/** One thing an athlete synced, or its tombstone (#776). */
export interface SyncItem {
  /** Only ever grows: a changed item is a new `seq`. */
  readonly seq: number;
  readonly athleteId: string;
  readonly kind: SyncKind;
  /** The item's key: an activity's content SHA-256, or the device's own id for the rest. */
  readonly key: string;
  /** SHA-256 of the body, or of the signed record for an activity. `null` for a tombstone. */
  readonly digest: string | null;
  /** The item's bytes exactly as they were sent. `null` for an activity and a tombstone. */
  readonly body: Uint8Array | null;
  /** Unix seconds; `(receivedAt, seq)` is the manifest's order. */
  readonly receivedAt: number;
  /** When the item was deleted, for a tombstone. */
  readonly deletedAt: number | null;
}

/** A manifest row: the item, and a live activity's signed record beside it. */
export interface ManifestRow extends SyncItem {
  readonly signedRecord: Uint8Array | null;
}

/** A position in the manifest's order. */
export interface ManifestPosition {
  readonly receivedAt: number;
  readonly seq: number;
}

/** What {@link SqlStore.ingestActivity} is handed: a record already verified by the caller. */
export interface ActivityIngestion {
  readonly athleteId: string;
  readonly contentSha256: string;
  readonly signedRecord: Uint8Array;
  /** SHA-256 of `signedRecord`, lowercase hex: the manifest's digest for it. */
  readonly recordSha256: string;
  /** Unix seconds. The stored `receivedAt` is never earlier than any before it. */
  readonly now: number;
}

/** What ingesting did, and the record the athlete now holds for that file — the first one's on a duplicate. */
export interface Ingested {
  readonly outcome: PutOutcome;
  readonly record: ActivityRecord;
}

/** A non-activity item, as a device puts it (#776). */
export interface SyncItemWrite {
  readonly athleteId: string;
  readonly kind: Exclude<SyncKind, 'activity'>;
  readonly key: string;
  readonly body: Uint8Array;
  readonly digest: string;
  /** Unix seconds. */
  readonly now: number;
}

/** One of an athlete's activities, with its place in the list (#38). */
export interface ListedActivity {
  readonly seq: number;
  readonly record: ActivityRecord;
}

/** The storage port. */
export interface SqlStore {
  putAthlete(athlete: Athlete): Promise<void>;
  getAthlete(athleteId: string): Promise<AthleteRecord | undefined>;

  putDeviceKey(key: DeviceKeyWrite): Promise<void>;
  listDeviceKeys(athleteId: string): Promise<readonly DeviceKey[]>;
  /** Authentication: the key is what names the athlete, so this is not athlete-scoped. */
  findDeviceKey(publicKey: string): Promise<DeviceKey | undefined>;
  /** Record that one of this athlete's keys signed in. */
  touchDeviceKey(athleteId: string, publicKey: string, at: number): Promise<void>;
  /**
   * Revoke one of this athlete's keys, and every session and unspent link
   * code it holds. `not_found` when the athlete holds no such key.
   *
   * ⚠️ **The last-key rule is checked HERE, in the transaction that writes
   * (#867)**: the athlete's LAST live key is revoked only when
   * `recoveryCodeSha256` is one of their unspent recovery codes — checked,
   * not spent — and is otherwise `last_device`. The identity used to count
   * the live keys in one store call and revoke in another, so two sessions
   * revoking the last two keys at once could each see two and leave none.
   */
  revokeDeviceKey(
    athleteId: string,
    publicKey: string,
    at: number,
    recoveryCodeSha256: string | null,
  ): Promise<RevokeOutcome>;
  /** A new athlete with their first key and recovery codes, in one transaction (#772). */
  registerAthlete(registration: Registration): Promise<void>;

  putChallenge(challenge: Challenge): Promise<void>;
  /** Spend a nonce: `taken` once, `used` after, `expired` from `expiresAt` on. */
  takeChallenge(nonce: string, now: number): Promise<Take<{ readonly publicKey: string }>>;
  /** Delete every challenge that expired before `before`. Answers how many. */
  pruneChallenges(before: number): Promise<number>;

  listRecoveryCodes(athleteId: string): Promise<readonly RecoveryCode[]>;
  /** Spend a recovery code, whoever's it is: the code is what names the athlete. */
  takeRecoveryCode(codeSha256: string, now: number): Promise<Take<{ readonly athleteId: string }>>;

  putLinkCode(code: Omit<LinkCode, 'usedAt'>): Promise<void>;
  listLinkCodes(athleteId: string): Promise<readonly LinkCode[]>;
  /** Spend a link code: the code is what names the athlete. */
  takeLinkCode(codeSha256: string, now: number): Promise<Take<{ readonly athleteId: string }>>;

  /**
   * Change a display name, keeping the old one in the audit trail.
   * `not_found` for no such athlete; `rate_limited` when the athlete already
   * changed it `limit.count` times in the `limit.windowSeconds` before `at`.
   * ⚠️ Counted and written in ONE transaction (#867), so two renames at once
   * cannot each see the window under its limit.
   */
  renameAthlete(
    athleteId: string,
    name: string,
    at: number,
    limit: RenameLimit,
  ): Promise<RenameOutcome>;
  listDisplayNameChanges(athleteId: string): Promise<readonly DisplayNameChange[]>;

  getRecoveryEmail(athleteId: string): Promise<RecoveryEmail | undefined>;
  /**
   * An address given for recovery, waiting to be confirmed (#865). Binds
   * nothing. ⚠️ **Replaces the athlete's earlier unconfirmed confirmation**, in
   * the same transaction (#883), so an athlete has at most one link pending and
   * the table cannot grow with every address they give; a link already
   * followed stays, as the record that its token is spent.
   */
  putEmailConfirmation(confirmation: Omit<EmailConfirmation, 'usedAt'>): Promise<void>;
  listEmailConfirmations(athleteId: string): Promise<readonly EmailConfirmation[]>;
  /**
   * Spend one of THIS athlete's confirmation tokens and bind its address to
   * them, replacing any address they had, in one transaction (#865). Another
   * athlete's token is `unknown`. `held` — and nothing spent or bound — when
   * the address is already another athlete's.
   */
  confirmRecoveryEmail(
    athleteId: string,
    tokenSha256: string,
    now: number,
  ): Promise<ConfirmOutcome>;
  /** Email recovery: the address is what names the athlete. */
  findRecoveryEmail(address: string): Promise<RecoveryEmail | undefined>;
  putEmailRecoveryToken(token: Omit<EmailRecoveryToken, 'usedAt'>): Promise<void>;
  listEmailRecoveryTokens(athleteId: string): Promise<readonly EmailRecoveryToken[]>;
  /** Spend an email recovery token: the token is what names the athlete. */
  takeEmailRecoveryToken(
    tokenSha256: string,
    now: number,
  ): Promise<Take<{ readonly athleteId: string }>>;

  putSession(session: Session): Promise<void>;
  /** Authentication: the token names the athlete, so this is not athlete-scoped. */
  findSession(tokenSha256: string): Promise<Session | undefined>;
  listSessions(athleteId: string): Promise<readonly Session[]>;
  /** Revoke one of this athlete's sessions. `false` when the athlete holds no such session. */
  revokeSession(athleteId: string, tokenSha256: string, at: number): Promise<boolean>;

  putActivityRecord(record: ActivityRecord): Promise<PutOutcome>;
  /**
   * #37: file a verified signed record and index it in the manifest, in one
   * transaction. The same file from the same athlete is `duplicate` however
   * many requests race — the primary key decides, not a read before the write.
   */
  ingestActivity(ingestion: ActivityIngestion): Promise<Ingested>;
  /**
   * Whether ANY athlete — or any but `exceptAthleteId` — holds a record of
   * this file. Not athlete-scoped, by design: a blob is shared by every
   * athlete who sent the same bytes, and this is what says whether removing
   * it would take somebody else's file. It answers a boolean, never a row.
   */
  isContentHeld(contentSha256: string, exceptAthleteId?: string): Promise<boolean>;
  /** #38: one page of this athlete's live activities, newest first, in ONE query. */
  listActivityPage(
    athleteId: string,
    beforeSeq: number | undefined,
    limit: number,
  ): Promise<readonly ListedActivity[]>;

  /** #776: store an item, or answer `unchanged` when the athlete already holds these exact bytes. */
  putSyncItem(item: SyncItemWrite): Promise<'stored' | 'unchanged'>;
  getSyncItem(athleteId: string, kind: SyncKind, key: string): Promise<SyncItem | undefined>;
  /**
   * Replace a live item with its tombstone — an activity's record goes with
   * it. `false` when the athlete holds no such live item.
   */
  deleteSyncItem(athleteId: string, kind: SyncKind, key: string, now: number): Promise<boolean>;
  /** #776: the manifest, after `after`, in `(receivedAt, seq)` order, tombstones included. */
  listSyncManifest(
    athleteId: string,
    after: ManifestPosition | undefined,
    limit: number,
  ): Promise<readonly ManifestRow[]>;
  getActivityRecord(athleteId: string, contentSha256: string): Promise<ActivityRecord | undefined>;
  listActivityRecords(athleteId: string): Promise<readonly ActivityRecord[]>;

  putRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;
  /** A room's course. A room is nobody's, so this is not athlete-scoped. */
  putRoomCourse(course: RoomCourse): Promise<void>;
  getRoomCourse(roomId: string): Promise<RoomCourse | undefined>;
  /** A race left its lobby at `at` (Unix seconds). The first time is kept. */
  markRaceStarted(roomId: string, at: number): Promise<void>;

  putResult(result: Result): Promise<void>;
  listResults(athleteId: string): Promise<readonly Result[]>;
  /** A room's finish order is every rider's, by design: not athlete-scoped. */
  listRoomResults(roomId: string): Promise<readonly Result[]>;

  /** Block (#83). Idempotent: blocking twice keeps the first row. */
  putBlock(athleteId: string, blockedAthleteId: string, at: number): Promise<void>;
  /** Unblock. `false` when this athlete had no such block. */
  deleteBlock(athleteId: string, blockedAthleteId: string): Promise<boolean>;
  listBlocks(athleteId: string): Promise<readonly Block[]>;
  /**
   * What `viewerId` may know of `subjectId`, in ONE query (#83, #891's
   * review): the subject's standing and whether either blocks the other, or
   * `undefined` when there is no such athlete. A pair, so not one athlete's read.
   */
  sight(
    viewerId: string,
    subjectId: string,
  ): Promise<
    | {
        readonly registrationState: string;
        readonly suspendedAt: number | null;
        readonly blocked: boolean;
      }
    | undefined
  >;

  /**
   * A report (#83). Answers its id. `closedAs` stores it already closed, with
   * that outcome and no moderator: a report about nobody, which must count
   * toward the reporter's allowance and must never reach the queue.
   */
  putReport(
    report: Pick<Report, 'athleteId' | 'targetAthleteId' | 'reason' | 'createdAt'> & {
      readonly closedAs?: string;
    },
  ): Promise<number>;
  /** The reports this athlete made. */
  listReports(athleteId: string): Promise<readonly Report[]>;
  /** The moderators' queue: every report not yet decided, oldest first. */
  listOpenReports(): Promise<readonly Report[]>;

  /**
   * Apply a moderator action and append it to the log, in ONE transaction:
   * an action that is applied is logged, and one that is not changes nothing.
   */
  moderate(action: ModerationAction): Promise<ModerationOutcome>;
  /**
   * Log an action that was REFUSED — a moderator acting on a moderator — as
   * `refused_<action>`, changing nothing else. Answers the log entry's id.
   */
  logRefusedAction(action: ModerationAction): Promise<number>;
  /** The moderation log, oldest first. */
  listModerationLog(): Promise<readonly ModerationLogEntry[]>;

  /** Record that the athlete confirmed they are 18 or over (#775). The first date is kept. */
  confirmAdult(athleteId: string, at: number): Promise<boolean>;
  /** The moderators' approval queue: every athlete awaiting approval, oldest first (#775). */
  listPendingAthletes(): Promise<readonly AthleteRecord[]>;
  /** How many rides the athlete has synced: public-room eligibility counts them (#775). */
  countActivityRecords(athleteId: string): Promise<number>;
  /** A moderator's invitation, and its entry in the moderation log, together (#775). */
  mintInviteCode(
    code: Omit<InviteCode, 'usedAt'>,
    log: { readonly reason: string; readonly at: number },
  ): Promise<void>;
  listInviteCodes(athleteId: string): Promise<readonly InviteCode[]>;

  /**
   * Remove every row this athlete owns, the athlete included (#35). Answers
   * the content hashes of the records it removed, for the caller's blob sweep.
   * The tables are read from the schema's own foreign keys at the time of the
   * call ({@link athleteTablesInErasureOrder}), not from a list.
   */
  eraseAthlete(athleteId: string): Promise<readonly string[]>;

  /** Close the connection. Nothing may be called after. */
  close(): Promise<void>;
}

/** A write named a key another athlete already holds. */
export class OwnershipConflictError extends Error {
  override readonly name = 'OwnershipConflictError';
}

/** One foreign key column pair, as `pragma_foreign_key_list` reports it. */
interface ForeignKey {
  readonly child: string;
  readonly parent: string;
  readonly from: string;
}

/**
 * The tables `eraseAthlete` empties, children before parents so the foreign
 * keys hold at every step — **derived from the schema's foreign keys**, at the
 * time of the call (#35, #881's rule). A table a later migration adds with an
 * `athlete_id` REFERENCES `athlete` is erased with no edit here, and one whose
 * reference to `athlete` is through any other column is refused rather than
 * skipped: `eraseAthlete` deletes by `athlete_id`, and a table it could not
 * empty must not pass for erased.
 *
 * `sql-store.erasure.test.ts` still reads the schema itself and checks every
 * such table empty afterwards, so this function is tested by what it does and
 * not by agreeing with a second copy of itself.
 */
export async function athleteTablesInErasureOrder(
  db: Kysely<InstanceDatabase>,
): Promise<readonly (keyof InstanceDatabase)[]> {
  const keys = (
    await sql<ForeignKey>`
      select m.name as child, f."table" as parent, f."from" as "from"
      from sqlite_schema as m, pragma_foreign_key_list(m.name) as f
      where m.type = 'table'
      order by m.name, f.id, f.seq`.execute(db)
  ).rows;
  const scoped = new Set<string>();
  for (const key of keys) {
    if (key.parent !== 'athlete') continue;
    if (key.from !== 'athlete_id') {
      throw new Error(`${key.child} references athlete through a column eraseAthlete cannot read.`);
    }
    scoped.add(key.child);
  }
  // A table goes after every scoped table that references it.
  const referencedBy = new Map<string, Set<string>>();
  for (const key of keys) {
    if (!scoped.has(key.child) || !scoped.has(key.parent) || key.child === key.parent) continue;
    const children = referencedBy.get(key.parent) ?? new Set<string>();
    children.add(key.child);
    referencedBy.set(key.parent, children);
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (table: string): void => {
    if (placed.has(table)) return;
    if (visiting.has(table))
      throw new Error('The athlete-scoped tables reference each other in a cycle.');
    visiting.add(table);
    for (const child of [...(referencedBy.get(table) ?? [])].sort()) place(child);
    visiting.delete(table);
    placed.add(table);
    ordered.push(table);
  };
  for (const table of [...scoped].sort()) place(table);
  return ordered as (keyof InstanceDatabase)[];
}

const athleteFrom = (row: Selectable<AthleteTable>): AthleteRecord => ({
  id: row.id,
  displayName: row.display_name,
  createdAt: row.created_at,
  registrationState: row.registration_state,
  suspendedAt: row.suspended_at,
  displayNameHiddenAt: row.display_name_hidden_at,
  adultConfirmedAt: row.adult_confirmed_at,
  activatedAt: row.activated_at,
});

const inviteCodeFrom = (row: Selectable<InviteCodeTable>): InviteCode => ({
  codeSha256: row.code_sha256,
  athleteId: row.athlete_id,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
});

const blockFrom = (row: Selectable<BlockTable>): Block => ({
  athleteId: row.athlete_id,
  blockedAthleteId: row.blocked_athlete_id,
  createdAt: row.created_at,
});

const reportFrom = (row: Selectable<ReportTable>): Report => ({
  id: row.id,
  athleteId: row.athlete_id,
  targetAthleteId: row.target_athlete_id,
  reason: row.reason,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  closedByAthleteId: row.closed_by_athlete_id,
  outcome: row.outcome,
});

const moderationLogFrom = (row: Selectable<ModerationLogTable>): ModerationLogEntry => ({
  id: row.id,
  action: row.action as LoggedActionKind,
  actorAthleteId: row.actor_athlete_id,
  targetAthleteId: row.target_athlete_id,
  reportId: row.report_id,
  reason: row.reason,
  at: row.at,
});

const deviceKeyFrom = (row: Selectable<DeviceKeyTable>): DeviceKey => ({
  publicKey: row.public_key,
  athleteId: row.athlete_id,
  addedAt: row.added_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
});

const recoveryCodeFrom = (row: Selectable<RecoveryCodeTable>): RecoveryCode => ({
  codeSha256: row.code_sha256,
  athleteId: row.athlete_id,
  createdAt: row.created_at,
  usedAt: row.used_at,
});

const linkCodeFrom = (row: Selectable<LinkCodeTable>): LinkCode => ({
  codeSha256: row.code_sha256,
  athleteId: row.athlete_id,
  mintedByKey: row.minted_by_key,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
});

const displayNameChangeFrom = (row: Selectable<DisplayNameChangeTable>): DisplayNameChange => ({
  athleteId: row.athlete_id,
  previousName: row.previous_name,
  changedAt: row.changed_at,
});

const emailRecoveryTokenFrom = (row: Selectable<EmailRecoveryTokenTable>): EmailRecoveryToken => ({
  tokenSha256: row.token_sha256,
  athleteId: row.athlete_id,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
});

const emailConfirmationFrom = (
  row: Selectable<RecoveryEmailConfirmationTable>,
): EmailConfirmation => ({
  tokenSha256: row.token_sha256,
  athleteId: row.athlete_id,
  address: row.address,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
});

/** A single-use row's outcome, from what was read before it was spent. */
function outcomeOf(
  row: { readonly used_at: number | null; readonly expires_at?: number } | undefined,
  now: number,
): 'unknown' | 'used' | 'expired' | 'spendable' {
  if (row === undefined) return 'unknown';
  if (row.used_at !== null) return 'used';
  if (row.expires_at !== undefined && now >= row.expires_at) return 'expired';
  return 'spendable';
}

const sessionFrom = (row: Selectable<SessionTable>): Session => ({
  tokenSha256: row.token_sha256,
  athleteId: row.athlete_id,
  deviceKey: row.device_key,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

const activityRecordFrom = (row: Selectable<ActivityRecordTable>): ActivityRecord => ({
  athleteId: row.athlete_id,
  contentSha256: row.content_sha256,
  signedRecord: row.signed_record,
  receivedAt: row.received_at,
});

const syncItemFrom = (row: Selectable<SyncItemTable>): SyncItem => ({
  seq: row.seq,
  athleteId: row.athlete_id,
  kind: row.kind,
  key: row.item_key,
  digest: row.digest,
  body: row.body,
  receivedAt: row.received_at,
  deletedAt: row.deleted_at,
});

/**
 * The `received_at` a new manifest row gets: now, or the newest one already
 * written if the clock has stepped back. So `(received_at, seq)` only grows in
 * the order rows are inserted, and a cursor a device holds can never have a
 * new row slip in behind it (#776). Global rather than per athlete, because
 * the clock is.
 */
async function nextReceivedAt(trx: Kysely<InstanceDatabase>, now: number): Promise<number> {
  const newest = await trx
    .selectFrom('sync_item')
    .select((eb) => eb.fn.max('received_at').as('newest'))
    .executeTakeFirst();
  return Math.max(now, newest?.newest ?? now);
}

/**
 * Insert a manifest row for an item, after removing whatever row it had. The
 * new `received_at` is taken BEFORE the old row goes, so removing the newest
 * row cannot lower it and put the new row behind a cursor already past the old.
 */
async function replaceSyncRow(
  trx: Kysely<InstanceDatabase>,
  row: {
    readonly athleteId: string;
    readonly kind: SyncKind;
    readonly key: string;
    readonly digest: string | null;
    readonly body: Uint8Array | null;
    readonly now: number;
    readonly deletedAt: number | null;
    readonly receivedAt?: number;
  },
): Promise<void> {
  const receivedAt = row.receivedAt ?? (await nextReceivedAt(trx, row.now));
  await trx
    .deleteFrom('sync_item')
    .where('athlete_id', '=', row.athleteId)
    .where('kind', '=', row.kind)
    .where('item_key', '=', row.key)
    .execute();
  await trx
    .insertInto('sync_item')
    .values({
      athlete_id: row.athleteId,
      kind: row.kind,
      item_key: row.key,
      digest: row.digest,
      body: row.body,
      received_at: receivedAt,
      deleted_at: row.deletedAt,
    })
    .execute();
}

const roomFrom = (row: Selectable<RoomTable>): Room => ({
  id: row.id,
  kind: row.kind,
  visibility: row.visibility,
  routeSha256: row.route_sha256,
  physicsVersion: row.physics_version,
});

const roomCourseFrom = (row: Selectable<RoomCourseTable>): RoomCourse => ({
  roomId: row.room_id,
  lengthMetres: row.length_metres,
  grades: JSON.parse(row.grades) as [number, number][],
  ridingPosition: row.riding_position,
  capacity: row.capacity,
  countdownMs: row.countdown_ms,
  rejoinWindowMs: row.rejoin_window_ms,
  raceStartedAt: row.race_started_at,
});

const resultFrom = (row: Selectable<ResultTable>): Result => ({
  roomId: row.room_id,
  athleteId: row.athlete_id,
  finishMs: row.finish_ms,
  flags: row.flags,
});

/**
 * A moderator action's effect on its target, inside the action's transaction.
 * `false` when the athlete is not in a state the action applies to.
 */
async function applyToAthlete(
  trx: Transaction<InstanceDatabase>,
  action: ModerationAction,
  target: Selectable<AthleteTable>,
): Promise<boolean> {
  const at = action.at;
  const athlete = trx.updateTable('athlete').where('id', '=', target.id);
  switch (action.action) {
    case 'suspend': {
      if (target.suspended_at !== null) return false;
      await athlete.set({ suspended_at: at }).execute();
      // A suspension binds EVERY key at once (#775, ADR 0028 D-6.2): no session
      // the athlete holds outlives it, whichever device it was opened on.
      await trx
        .updateTable('session')
        .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
        .where('athlete_id', '=', target.id)
        .execute();
      return true;
    }
    case 'unsuspend':
      if (target.suspended_at === null) return false;
      await athlete.set({ suspended_at: null }).execute();
      return true;
    case 'hide_display_name':
      if (target.display_name_hidden_at !== null) return false;
      await athlete.set({ display_name_hidden_at: at }).execute();
      return true;
    case 'approve_registration':
    case 'activate_moderator_key':
      if (target.registration_state !== 'pending') return false;
      await athlete.set({ registration_state: 'active', activated_at: at }).execute();
      return true;
    case 'refuse_registration':
      if (target.registration_state !== 'pending') return false;
      await athlete.set({ registration_state: 'refused' }).execute();
      // A rider awaiting approval holds a session to see how it went; a
      // refusal ends it, as a suspension does.
      await trx
        .updateTable('session')
        .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
        .where('athlete_id', '=', target.id)
        .execute();
      return true;
    case 'dismiss_report':
      return true;
  }
}

/** The store over an already-migrated database. */
export function createSqlStore(db: Kysely<InstanceDatabase>): SqlStore {
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    putAthlete: (athlete) =>
      exclusive(async () => {
        await db
          .insertInto('athlete')
          .values({
            id: athlete.id,
            display_name: athlete.displayName,
            created_at: athlete.createdAt,
            registration_state: athlete.registrationState,
            activated_at: athlete.registrationState === 'active' ? athlete.createdAt : null,
          })
          .onConflict((conflict) =>
            conflict.column('id').doUpdateSet({
              display_name: athlete.displayName,
              registration_state: athlete.registrationState,
              // The first activation is kept; an account written active for
              // the first time here is active from when it was created.
              activated_at:
                athlete.registrationState === 'active'
                  ? sql<number>`coalesce(activated_at, ${athlete.createdAt})`
                  : sql<number | null>`activated_at`,
            }),
          )
          .execute();
      }),

    getAthlete: (athleteId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('athlete')
          .selectAll()
          .where('id', '=', athleteId)
          .executeTakeFirst();
        return row === undefined ? undefined : athleteFrom(row);
      }),

    putDeviceKey: (key) =>
      exclusive(async () => {
        await db.transaction().execute(async (trx) => {
          const held = await trx
            .selectFrom('device_key')
            .select('athlete_id')
            .where('public_key', '=', key.publicKey)
            .executeTakeFirst();
          if (held !== undefined && held.athlete_id !== key.athleteId) {
            throw new OwnershipConflictError('That device key belongs to another athlete.');
          }
          await trx
            .insertInto('device_key')
            .values({
              public_key: key.publicKey,
              athlete_id: key.athleteId,
              added_at: key.addedAt,
              revoked_at: key.revokedAt,
            })
            .onConflict((conflict) =>
              conflict.column('public_key').doUpdateSet({
                // A revocation is never undone by a later put (#842's review).
                revoked_at: sql`coalesce(device_key.revoked_at, excluded.revoked_at)`,
              }),
            )
            .execute();
        });
      }),

    listDeviceKeys: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('device_key')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('public_key')
            .execute()
        ).map(deviceKeyFrom),
      ),

    findDeviceKey: (publicKey) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('device_key')
          .selectAll()
          .where('public_key', '=', publicKey)
          .executeTakeFirst();
        return row === undefined ? undefined : deviceKeyFrom(row);
      }),

    touchDeviceKey: (athleteId, publicKey, at) =>
      exclusive(async () => {
        await db
          .updateTable('device_key')
          .set({ last_used_at: at })
          .where('athlete_id', '=', athleteId)
          .where('public_key', '=', publicKey)
          .execute();
      }),

    revokeDeviceKey: (athleteId, publicKey, at, recoveryCodeSha256) =>
      exclusive(() =>
        db.transaction().execute(async (trx): Promise<RevokeOutcome> => {
          const keys = await trx
            .selectFrom('device_key')
            .select(['public_key', 'revoked_at'])
            .where('athlete_id', '=', athleteId)
            .execute();
          const target = keys.find((key) => key.public_key === publicKey);
          if (target === undefined) return 'not_found';
          const live = keys.filter((key) => key.revoked_at === null);
          if (target.revoked_at === null && live.length === 1) {
            // The last key: only with a code that would let the athlete back
            // in. Checked in this transaction and not spent (#867).
            const held =
              recoveryCodeSha256 === null
                ? undefined
                : await trx
                    .selectFrom('recovery_code')
                    .select('code_sha256')
                    .where('athlete_id', '=', athleteId)
                    .where('code_sha256', '=', recoveryCodeSha256)
                    .where('used_at', 'is', null)
                    .executeTakeFirst();
            if (held === undefined) return 'last_device';
          }
          await trx
            .updateTable('device_key')
            .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
            .where('athlete_id', '=', athleteId)
            .where('public_key', '=', publicKey)
            .execute();
          await trx
            .updateTable('session')
            .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
            .where('athlete_id', '=', athleteId)
            .where('device_key', '=', publicKey)
            .execute();
          await trx
            .updateTable('link_code')
            .set({ used_at: sql<number>`coalesce(used_at, ${at})` })
            .where('athlete_id', '=', athleteId)
            .where('minted_by_key', '=', publicKey)
            .execute();
          return 'revoked';
        }),
      ),

    registerAthlete: (registration) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const { athlete, key } = registration;
          if (key.athleteId !== athlete.id) {
            throw new OwnershipConflictError('A first key must be its own athlete’s.');
          }
          if (registration.inviteCodeSha256 !== undefined) {
            const invite = await trx
              .selectFrom('invite_code')
              .selectAll()
              .where('code_sha256', '=', registration.inviteCodeSha256)
              .executeTakeFirst();
            const outcome = outcomeOf(invite, athlete.createdAt);
            if (outcome !== 'spendable') throw new InviteRefusedError(outcome);
            await trx
              .updateTable('invite_code')
              .set({ used_at: athlete.createdAt })
              .where('code_sha256', '=', registration.inviteCodeSha256)
              .execute();
          }
          const held = await trx
            .selectFrom('device_key')
            .select('athlete_id')
            .where('public_key', '=', key.publicKey)
            .executeTakeFirst();
          if (held !== undefined) {
            throw new OwnershipConflictError('That device key belongs to another athlete.');
          }
          await trx
            .insertInto('athlete')
            .values({
              id: athlete.id,
              display_name: athlete.displayName,
              created_at: athlete.createdAt,
              registration_state: athlete.registrationState,
              adult_confirmed_at: registration.adultConfirmedAt ?? null,
              activated_at: athlete.registrationState === 'active' ? athlete.createdAt : null,
            })
            .execute();
          await trx
            .insertInto('device_key')
            .values({
              public_key: key.publicKey,
              athlete_id: key.athleteId,
              added_at: key.addedAt,
              revoked_at: key.revokedAt,
            })
            .execute();
          for (const codeSha256 of registration.recoveryCodeSha256s) {
            await trx
              .insertInto('recovery_code')
              .values({
                code_sha256: codeSha256,
                athlete_id: athlete.id,
                created_at: athlete.createdAt,
                used_at: null,
              })
              .execute();
          }
          const confirmation = registration.recoveryEmailConfirmation;
          if (confirmation !== undefined) {
            // A confirmation, never a binding (#865): see `Registration`.
            await trx
              .insertInto('recovery_email_confirmation')
              .values({
                token_sha256: confirmation.tokenSha256,
                athlete_id: athlete.id,
                address: confirmation.address,
                expires_at: confirmation.expiresAt,
                used_at: null,
              })
              .execute();
          }
        }),
      ),

    putChallenge: (challenge) =>
      exclusive(async () => {
        await db
          .insertInto('auth_challenge')
          .values({
            nonce: challenge.nonce,
            public_key: challenge.publicKey,
            expires_at: challenge.expiresAt,
            used_at: null,
          })
          .execute();
      }),

    takeChallenge: (nonce, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('auth_challenge')
            .selectAll()
            .where('nonce', '=', nonce)
            .executeTakeFirst();
          const outcome = outcomeOf(row, now);
          if (outcome !== 'spendable' || row === undefined) {
            return { outcome: outcome === 'spendable' ? 'unknown' : outcome } as const;
          }
          await trx
            .updateTable('auth_challenge')
            .set({ used_at: now })
            .where('nonce', '=', nonce)
            .execute();
          return { outcome: 'taken', publicKey: row.public_key } as const;
        }),
      ),

    pruneChallenges: (before) =>
      exclusive(async () => {
        const deleted = await db
          .deleteFrom('auth_challenge')
          .where('expires_at', '<', before)
          .executeTakeFirst();
        return Number(deleted.numDeletedRows);
      }),

    listRecoveryCodes: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('recovery_code')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('code_sha256')
            .execute()
        ).map(recoveryCodeFrom),
      ),

    takeRecoveryCode: (codeSha256, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('recovery_code')
            .selectAll()
            .where('code_sha256', '=', codeSha256)
            .executeTakeFirst();
          const outcome = outcomeOf(row, now);
          if (outcome !== 'spendable' || row === undefined) {
            return { outcome: outcome === 'spendable' ? 'unknown' : outcome } as const;
          }
          await trx
            .updateTable('recovery_code')
            .set({ used_at: now })
            .where('code_sha256', '=', codeSha256)
            .execute();
          return { outcome: 'taken', athleteId: row.athlete_id } as const;
        }),
      ),

    putLinkCode: (code) =>
      exclusive(async () => {
        await db
          .insertInto('link_code')
          .values({
            code_sha256: code.codeSha256,
            athlete_id: code.athleteId,
            minted_by_key: code.mintedByKey,
            expires_at: code.expiresAt,
            used_at: null,
          })
          .execute();
      }),

    listLinkCodes: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('link_code')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('code_sha256')
            .execute()
        ).map(linkCodeFrom),
      ),

    takeLinkCode: (codeSha256, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('link_code')
            .selectAll()
            .where('code_sha256', '=', codeSha256)
            .executeTakeFirst();
          const outcome = outcomeOf(row, now);
          if (outcome !== 'spendable' || row === undefined) {
            return { outcome: outcome === 'spendable' ? 'unknown' : outcome } as const;
          }
          await trx
            .updateTable('link_code')
            .set({ used_at: now })
            .where('code_sha256', '=', codeSha256)
            .execute();
          return { outcome: 'taken', athleteId: row.athlete_id } as const;
        }),
      ),

    renameAthlete: (athleteId, name, at, limit) =>
      exclusive(() =>
        db.transaction().execute(async (trx): Promise<RenameOutcome> => {
          const row = await trx
            .selectFrom('athlete')
            .select(['display_name', 'display_name_hidden_at'])
            .where('id', '=', athleteId)
            .executeTakeFirst();
          if (row === undefined) return 'not_found';
          // Counted in the transaction that writes (#867).
          const recent = await trx
            .selectFrom('display_name_change')
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .where('athlete_id', '=', athleteId)
            .where('changed_at', '>', at - limit.windowSeconds)
            .executeTakeFirstOrThrow();
          if (Number(recent.n) >= limit.count) return 'rate_limited';
          await trx
            .insertInto('display_name_change')
            .values({ athlete_id: athleteId, previous_name: row.display_name, changed_at: at })
            .execute();
          await trx
            .updateTable('athlete')
            // A new name is new content: a moderator's hide was of the old one
            // (#83). The SAME name is not new, and stays hidden (#891's review).
            .set({
              display_name: name,
              display_name_hidden_at: name === row.display_name ? row.display_name_hidden_at : null,
            })
            .where('id', '=', athleteId)
            .execute();
          return 'renamed';
        }),
      ),

    listDisplayNameChanges: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('display_name_change')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('changed_at')
            .orderBy('id')
            .execute()
        ).map(displayNameChangeFrom),
      ),

    getRecoveryEmail: (athleteId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('recovery_email')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .executeTakeFirst();
        return row === undefined ? undefined : { athleteId: row.athlete_id, address: row.address };
      }),

    putEmailConfirmation: (confirmation) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          await trx
            .deleteFrom('recovery_email_confirmation')
            .where('athlete_id', '=', confirmation.athleteId)
            .where('used_at', 'is', null)
            .execute();
          await trx
            .insertInto('recovery_email_confirmation')
            .values({
              token_sha256: confirmation.tokenSha256,
              athlete_id: confirmation.athleteId,
              address: confirmation.address,
              expires_at: confirmation.expiresAt,
              used_at: null,
            })
            .execute();
        }),
      ),

    listEmailConfirmations: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('recovery_email_confirmation')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('token_sha256')
            .execute()
        ).map(emailConfirmationFrom),
      ),

    confirmRecoveryEmail: (athleteId, tokenSha256, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx): Promise<ConfirmOutcome> => {
          const row = await trx
            .selectFrom('recovery_email_confirmation')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .where('token_sha256', '=', tokenSha256)
            .executeTakeFirst();
          const outcome = outcomeOf(row, now);
          if (outcome !== 'spendable' || row === undefined) {
            return { outcome: outcome === 'spendable' ? 'unknown' : outcome };
          }
          const holder = await trx
            .selectFrom('recovery_email')
            .select('athlete_id')
            .where('address', '=', row.address)
            .executeTakeFirst();
          if (holder !== undefined && holder.athlete_id !== row.athlete_id) {
            return { outcome: 'held' };
          }
          await trx
            .insertInto('recovery_email')
            .values({ athlete_id: row.athlete_id, address: row.address })
            .onConflict((conflict) =>
              conflict.column('athlete_id').doUpdateSet({ address: row.address }),
            )
            .execute();
          await trx
            .updateTable('recovery_email_confirmation')
            .set({ used_at: now })
            .where('token_sha256', '=', tokenSha256)
            .execute();
          return { outcome: 'taken', athleteId: row.athlete_id };
        }),
      ),

    findRecoveryEmail: (address) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('recovery_email')
          .selectAll()
          .where('address', '=', address)
          .executeTakeFirst();
        return row === undefined ? undefined : { athleteId: row.athlete_id, address: row.address };
      }),

    putEmailRecoveryToken: (token) =>
      exclusive(async () => {
        await db
          .insertInto('email_recovery_token')
          .values({
            token_sha256: token.tokenSha256,
            athlete_id: token.athleteId,
            expires_at: token.expiresAt,
            used_at: null,
          })
          .execute();
      }),

    listEmailRecoveryTokens: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('email_recovery_token')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('token_sha256')
            .execute()
        ).map(emailRecoveryTokenFrom),
      ),

    takeEmailRecoveryToken: (tokenSha256, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('email_recovery_token')
            .selectAll()
            .where('token_sha256', '=', tokenSha256)
            .executeTakeFirst();
          const outcome = outcomeOf(row, now);
          if (outcome !== 'spendable' || row === undefined) {
            return { outcome: outcome === 'spendable' ? 'unknown' : outcome } as const;
          }
          await trx
            .updateTable('email_recovery_token')
            .set({ used_at: now })
            .where('token_sha256', '=', tokenSha256)
            .execute();
          return { outcome: 'taken', athleteId: row.athlete_id } as const;
        }),
      ),

    putSession: (session) =>
      exclusive(async () => {
        await db.transaction().execute(async (trx) => {
          const held = await trx
            .selectFrom('session')
            .select('athlete_id')
            .where('token_sha256', '=', session.tokenSha256)
            .executeTakeFirst();
          if (held !== undefined && held.athlete_id !== session.athleteId) {
            throw new OwnershipConflictError('That session belongs to another athlete.');
          }
          const key = await trx
            .selectFrom('device_key')
            .select('athlete_id')
            .where('public_key', '=', session.deviceKey)
            .executeTakeFirst();
          if (key !== undefined && key.athlete_id !== session.athleteId) {
            throw new OwnershipConflictError('That device key belongs to another athlete.');
          }
          await trx
            .insertInto('session')
            .values({
              token_sha256: session.tokenSha256,
              athlete_id: session.athleteId,
              device_key: session.deviceKey,
              expires_at: session.expiresAt,
              revoked_at: session.revokedAt,
            })
            .onConflict((conflict) =>
              conflict.column('token_sha256').doUpdateSet({
                expires_at: session.expiresAt,
                revoked_at: sql`coalesce(session.revoked_at, excluded.revoked_at)`,
              }),
            )
            .execute();
        });
      }),

    findSession: (tokenSha256) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('session')
          .selectAll()
          .where('token_sha256', '=', tokenSha256)
          .executeTakeFirst();
        return row === undefined ? undefined : sessionFrom(row);
      }),

    listSessions: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('session')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('token_sha256')
            .execute()
        ).map(sessionFrom),
      ),

    revokeSession: (athleteId, tokenSha256, at) =>
      exclusive(async () => {
        const updated = await db
          .updateTable('session')
          .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
          .where('athlete_id', '=', athleteId)
          .where('token_sha256', '=', tokenSha256)
          .executeTakeFirst();
        return updated.numUpdatedRows > 0n;
      }),

    putActivityRecord: (record) =>
      exclusive(async () => {
        const inserted = await db
          .insertInto('activity_record')
          .values({
            athlete_id: record.athleteId,
            content_sha256: record.contentSha256,
            signed_record: record.signedRecord,
            received_at: record.receivedAt,
          })
          .onConflict((conflict) => conflict.columns(['athlete_id', 'content_sha256']).doNothing())
          .returning('content_sha256')
          .executeTakeFirst();
        return inserted === undefined ? 'duplicate' : 'stored';
      }),

    getActivityRecord: (athleteId, contentSha256) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('activity_record')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .where('content_sha256', '=', contentSha256)
          .executeTakeFirst();
        return row === undefined ? undefined : activityRecordFrom(row);
      }),

    listActivityRecords: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('activity_record')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('received_at')
            .orderBy('content_sha256')
            .execute()
        ).map(activityRecordFrom),
      ),

    ingestActivity: (ingestion) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const receivedAt = await nextReceivedAt(trx, ingestion.now);
          const inserted = await trx
            .insertInto('activity_record')
            .values({
              athlete_id: ingestion.athleteId,
              content_sha256: ingestion.contentSha256,
              signed_record: ingestion.signedRecord,
              received_at: receivedAt,
            })
            .onConflict((conflict) =>
              conflict.columns(['athlete_id', 'content_sha256']).doNothing(),
            )
            .returning('content_sha256')
            .executeTakeFirst();
          if (inserted !== undefined) {
            await replaceSyncRow(trx, {
              athleteId: ingestion.athleteId,
              kind: 'activity',
              key: ingestion.contentSha256,
              digest: ingestion.recordSha256,
              body: null,
              now: ingestion.now,
              deletedAt: null,
              receivedAt,
            });
          }
          const row = await trx
            .selectFrom('activity_record')
            .selectAll()
            .where('athlete_id', '=', ingestion.athleteId)
            .where('content_sha256', '=', ingestion.contentSha256)
            .executeTakeFirstOrThrow();
          return {
            outcome: inserted === undefined ? 'duplicate' : 'stored',
            record: activityRecordFrom(row),
          } as const;
        }),
      ),

    isContentHeld: (contentSha256, exceptAthleteId) =>
      exclusive(async () => {
        let query = db
          .selectFrom('activity_record')
          .select('athlete_id')
          .where('content_sha256', '=', contentSha256);
        if (exceptAthleteId !== undefined) query = query.where('athlete_id', '!=', exceptAthleteId);
        const row = await query.limit(1).executeTakeFirst();
        return row !== undefined;
      }),

    listActivityPage: (athleteId, beforeSeq, limit) =>
      exclusive(async () => {
        let query = db
          .selectFrom('sync_item')
          .innerJoin('activity_record', (join) =>
            join
              .onRef('activity_record.athlete_id', '=', 'sync_item.athlete_id')
              .onRef('activity_record.content_sha256', '=', 'sync_item.item_key'),
          )
          .select([
            'sync_item.seq as seq',
            'activity_record.athlete_id as athlete_id',
            'activity_record.content_sha256 as content_sha256',
            'activity_record.signed_record as signed_record',
            'activity_record.received_at as received_at',
          ])
          .where('sync_item.athlete_id', '=', athleteId)
          .where('sync_item.kind', '=', 'activity')
          .where('sync_item.deleted_at', 'is', null);
        if (beforeSeq !== undefined) query = query.where('sync_item.seq', '<', beforeSeq);
        const rows = await query.orderBy('sync_item.seq', 'desc').limit(limit).execute();
        return rows.map((row) => ({ seq: row.seq, record: activityRecordFrom(row) }));
      }),

    putSyncItem: (item) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          if ((item.kind as SyncKind) === 'activity') {
            throw new Error(
              'An activity is synced through ingestActivity, with its signature checked.',
            );
          }
          const held = await trx
            .selectFrom('sync_item')
            .select(['digest', 'deleted_at'])
            .where('athlete_id', '=', item.athleteId)
            .where('kind', '=', item.kind)
            .where('item_key', '=', item.key)
            .executeTakeFirst();
          if (held !== undefined && held.deleted_at === null && held.digest === item.digest) {
            return 'unchanged' as const;
          }
          await replaceSyncRow(trx, {
            athleteId: item.athleteId,
            kind: item.kind,
            key: item.key,
            digest: item.digest,
            body: item.body,
            now: item.now,
            deletedAt: null,
          });
          return 'stored' as const;
        }),
      ),

    getSyncItem: (athleteId, kind, key) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('sync_item')
          .selectAll()
          .where('athlete_id', '=', athleteId)
          .where('kind', '=', kind)
          .where('item_key', '=', key)
          .executeTakeFirst();
        return row === undefined ? undefined : syncItemFrom(row);
      }),

    deleteSyncItem: (athleteId, kind, key, now) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const held = await trx
            .selectFrom('sync_item')
            .select('deleted_at')
            .where('athlete_id', '=', athleteId)
            .where('kind', '=', kind)
            .where('item_key', '=', key)
            .executeTakeFirst();
          if (held === undefined || held.deleted_at !== null) return false;
          if (kind === 'activity') {
            await trx
              .deleteFrom('activity_record')
              .where('athlete_id', '=', athleteId)
              .where('content_sha256', '=', key)
              .execute();
          }
          await replaceSyncRow(trx, {
            athleteId,
            kind,
            key,
            digest: null,
            body: null,
            now,
            deletedAt: now,
          });
          return true;
        }),
      ),

    listSyncManifest: (athleteId, after, limit) =>
      exclusive(async () => {
        // An activity's row brings its signed record, so the manifest can say
        // which ride it is without a query per entry. Joined on the athlete
        // AND the content: another athlete's record of the same file is not it.
        let query = db
          .selectFrom('sync_item')
          .leftJoin('activity_record', (join) =>
            join
              .onRef('activity_record.athlete_id', '=', 'sync_item.athlete_id')
              .onRef('activity_record.content_sha256', '=', 'sync_item.item_key')
              .on('sync_item.kind', '=', 'activity'),
          )
          .selectAll('sync_item')
          .select('activity_record.signed_record as signed_record')
          .where('sync_item.athlete_id', '=', athleteId);
        if (after !== undefined) {
          query = query.where(
            sql<boolean>`(sync_item.received_at, sync_item.seq) > (${after.receivedAt}, ${after.seq})`,
          );
        }
        const rows = await query
          .orderBy('sync_item.received_at')
          .orderBy('sync_item.seq')
          .limit(limit)
          .execute();
        return rows.map((row) => ({ ...syncItemFrom(row), signedRecord: row.signed_record }));
      }),

    putRoom: (room) =>
      exclusive(async () => {
        await db
          .insertInto('room')
          .values({
            id: room.id,
            kind: room.kind,
            visibility: room.visibility,
            route_sha256: room.routeSha256,
            physics_version: room.physicsVersion,
          })
          .onConflict((conflict) =>
            conflict.column('id').doUpdateSet({ visibility: room.visibility }),
          )
          .execute();
      }),

    getRoom: (roomId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('room')
          .selectAll()
          .where('id', '=', roomId)
          .executeTakeFirst();
        return row === undefined ? undefined : roomFrom(row);
      }),

    putRoomCourse: (course) =>
      exclusive(async () => {
        const row = {
          length_metres: course.lengthMetres,
          grades: JSON.stringify(course.grades),
          riding_position: course.ridingPosition,
          capacity: course.capacity,
          countdown_ms: course.countdownMs,
          rejoin_window_ms: course.rejoinWindowMs,
        };
        await db
          .insertInto('room_course')
          .values({ room_id: course.roomId, race_started_at: course.raceStartedAt, ...row })
          .onConflict((conflict) => conflict.column('room_id').doUpdateSet(row))
          .execute();
      }),

    getRoomCourse: (roomId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('room_course')
          .selectAll()
          .where('room_id', '=', roomId)
          .executeTakeFirst();
        return row === undefined ? undefined : roomCourseFrom(row);
      }),

    markRaceStarted: (roomId, at) =>
      exclusive(async () => {
        await db
          .updateTable('room_course')
          .set({ race_started_at: at })
          .where('room_id', '=', roomId)
          .where('race_started_at', 'is', null)
          .execute();
      }),

    putResult: (result) =>
      exclusive(async () => {
        await db
          .insertInto('result')
          .values({
            room_id: result.roomId,
            athlete_id: result.athleteId,
            finish_ms: result.finishMs,
            flags: result.flags,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['room_id', 'athlete_id'])
              .doUpdateSet({ finish_ms: result.finishMs, flags: result.flags }),
          )
          .execute();
      }),

    listResults: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('result')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('room_id')
            .execute()
        ).map(resultFrom),
      ),

    listRoomResults: (roomId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('result')
            .selectAll()
            .where('room_id', '=', roomId)
            .orderBy('athlete_id')
            .execute()
        ).map(resultFrom),
      ),

    putBlock: (athleteId, blockedAthleteId, at) =>
      exclusive(async () => {
        await db
          .insertInto('block')
          .values({ athlete_id: athleteId, blocked_athlete_id: blockedAthleteId, created_at: at })
          .onConflict((conflict) =>
            conflict.columns(['athlete_id', 'blocked_athlete_id']).doNothing(),
          )
          .execute();
      }),

    deleteBlock: (athleteId, blockedAthleteId) =>
      exclusive(async () => {
        const deleted = await db
          .deleteFrom('block')
          .where('athlete_id', '=', athleteId)
          .where('blocked_athlete_id', '=', blockedAthleteId)
          .executeTakeFirst();
        return deleted.numDeletedRows > 0n;
      }),

    listBlocks: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('block')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('blocked_athlete_id')
            .execute()
        ).map(blockFrom),
      ),

    sight: (viewerId, subjectId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('athlete')
          .select((eb) => [
            'registration_state',
            'suspended_at',
            eb
              .exists(
                eb
                  .selectFrom('block')
                  .select('block.athlete_id')
                  .where((where) =>
                    where.or([
                      where.and([
                        where('block.athlete_id', '=', viewerId),
                        where('block.blocked_athlete_id', '=', subjectId),
                      ]),
                      where.and([
                        where('block.athlete_id', '=', subjectId),
                        where('block.blocked_athlete_id', '=', viewerId),
                      ]),
                    ]),
                  ),
              )
              .as('blocked'),
          ])
          .where('athlete.id', '=', subjectId)
          .executeTakeFirst();
        return row === undefined
          ? undefined
          : {
              registrationState: row.registration_state,
              suspendedAt: row.suspended_at,
              blocked: Number(row.blocked) === 1,
            };
      }),

    putReport: (report) =>
      exclusive(async () => {
        const inserted = await db
          .insertInto('report')
          .values({
            athlete_id: report.athleteId,
            target_athlete_id: report.targetAthleteId,
            reason: report.reason,
            created_at: report.createdAt,
            closed_at: report.closedAs === undefined ? null : report.createdAt,
            closed_by_athlete_id: null,
            outcome: report.closedAs ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return inserted.id;
      }),

    listReports: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('report')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('id')
            .execute()
        ).map(reportFrom),
      ),

    listOpenReports: () =>
      exclusive(async () =>
        (
          await db
            .selectFrom('report')
            .selectAll()
            .where('closed_at', 'is', null)
            .orderBy('id')
            .execute()
        ).map(reportFrom),
      ),

    moderate: (action) =>
      exclusive(() =>
        db.transaction().execute(async (trx): Promise<ModerationOutcome> => {
          if (action.reportId !== null) {
            const report = await trx
              .selectFrom('report')
              .select(['target_athlete_id', 'closed_at'])
              .where('id', '=', action.reportId)
              .executeTakeFirst();
            if (report === undefined) return { outcome: 'not_found' };
            if (report.closed_at !== null) return { outcome: 'not_applicable' };
            if (
              action.targetAthleteId !== null &&
              report.target_athlete_id !== action.targetAthleteId
            ) {
              return { outcome: 'not_found' };
            }
          } else if (action.action === 'dismiss_report') {
            return { outcome: 'not_found' };
          }
          if (action.action !== 'dismiss_report') {
            if (action.targetAthleteId === null) return { outcome: 'not_found' };
            const target = await trx
              .selectFrom('athlete')
              .selectAll()
              .where('id', '=', action.targetAthleteId)
              .executeTakeFirst();
            if (target === undefined) return { outcome: 'not_found' };
            const applied = await applyToAthlete(trx, action, target);
            if (!applied) return { outcome: 'not_applicable' };
          }
          if (action.reportId !== null) {
            await trx
              .updateTable('report')
              .set({
                closed_at: action.at,
                closed_by_athlete_id: action.actorAthleteId,
                outcome: action.action,
              })
              .where('id', '=', action.reportId)
              .execute();
          }
          const logged = await trx
            .insertInto('moderation_log')
            .values({
              actor_athlete_id: action.actorAthleteId,
              action: action.action,
              target_athlete_id: action.targetAthleteId,
              report_id: action.reportId,
              reason: action.reason,
              at: action.at,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          return { outcome: 'applied', logId: logged.id };
        }),
      ),

    logRefusedAction: (action) =>
      exclusive(async () => {
        const logged = await db
          .insertInto('moderation_log')
          .values({
            actor_athlete_id: action.actorAthleteId,
            action: `refused_${action.action}`,
            target_athlete_id: action.targetAthleteId,
            report_id: action.reportId,
            reason: action.reason,
            at: action.at,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return logged.id;
      }),

    listModerationLog: () =>
      exclusive(async () =>
        (await db.selectFrom('moderation_log').selectAll().orderBy('id').execute()).map(
          moderationLogFrom,
        ),
      ),

    confirmAdult: (athleteId, at) =>
      exclusive(async () => {
        const updated = await db
          .updateTable('athlete')
          .set({ adult_confirmed_at: sql<number>`coalesce(adult_confirmed_at, ${at})` })
          .where('id', '=', athleteId)
          .executeTakeFirst();
        return updated.numUpdatedRows > 0n;
      }),

    listPendingAthletes: () =>
      exclusive(async () =>
        (
          await db
            .selectFrom('athlete')
            .selectAll()
            .where('registration_state', '=', 'pending')
            .orderBy('created_at')
            .orderBy('id')
            .execute()
        ).map(athleteFrom),
      ),

    countActivityRecords: (athleteId) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('activity_record')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('athlete_id', '=', athleteId)
          .executeTakeFirstOrThrow();
        return Number(row.n);
      }),

    mintInviteCode: (code, log) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('invite_code')
            .values({
              code_sha256: code.codeSha256,
              athlete_id: code.athleteId,
              expires_at: code.expiresAt,
              used_at: null,
            })
            .execute();
          await trx
            .insertInto('moderation_log')
            .values({
              actor_athlete_id: code.athleteId,
              action: 'mint_invite',
              target_athlete_id: null,
              report_id: null,
              reason: log.reason,
              at: log.at,
            })
            .execute();
        }),
      ),

    listInviteCodes: (athleteId) =>
      exclusive(async () =>
        (
          await db
            .selectFrom('invite_code')
            .selectAll()
            .where('athlete_id', '=', athleteId)
            .orderBy('code_sha256')
            .execute()
        ).map(inviteCodeFrom),
      ),

    eraseAthlete: (athleteId) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const held = await trx
            .selectFrom('activity_record')
            .select('content_sha256')
            .where('athlete_id', '=', athleteId)
            .execute();
          for (const table of await athleteTablesInErasureOrder(trx)) {
            // Every table here has `athlete_id`: the derivation refuses one that does not.
            await trx
              .deleteFrom(table as 'session')
              .where('athlete_id', '=', athleteId)
              .execute();
          }
          // Another athlete's block OF this one names nobody once they are gone (#83).
          await trx.deleteFrom('block').where('blocked_athlete_id', '=', athleteId).execute();
          await trx.deleteFrom('athlete').where('id', '=', athleteId).execute();
          return held.map((row) => row.content_sha256);
        }),
      ),

    close: () => exclusive(() => db.destroy()),
  };
}
