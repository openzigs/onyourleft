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
  ReportTable,
  ResultTable,
  RoomTable,
  SessionTable,
} from './schema.ts';

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

/** A new athlete, their first key and their recovery codes, written together or not at all. */
export interface Registration {
  readonly athlete: Athlete;
  readonly key: DeviceKeyWrite;
  readonly recoveryCodeSha256s: readonly string[];
  /**
   * Only where the operator enabled email recovery. An address another
   * athlete already holds is NOT bound, and the registration still succeeds
   * (#861): refusing it, or failing on the UNIQUE index, would tell anybody
   * which addresses ride here. The address is unverified, so the first
   * athlete to give it keeps it; confirming an address before binding it is
   * #865.
   */
  readonly recoveryEmail?: string;
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

/** What storing an activity record did: a retried sync of the same file is `duplicate`. */
export type PutOutcome = 'stored' | 'duplicate';

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
   * code it holds. `false` when the athlete holds no such key.
   */
  revokeDeviceKey(athleteId: string, publicKey: string, at: number): Promise<boolean>;
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

  /** Change a display name, keeping the old one in the audit trail. `false` for no such athlete. */
  renameAthlete(athleteId: string, name: string, at: number): Promise<boolean>;
  listDisplayNameChanges(athleteId: string): Promise<readonly DisplayNameChange[]>;

  getRecoveryEmail(athleteId: string): Promise<RecoveryEmail | undefined>;
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
  getActivityRecord(athleteId: string, contentSha256: string): Promise<ActivityRecord | undefined>;
  listActivityRecords(athleteId: string): Promise<readonly ActivityRecord[]>;

  putRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;

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

  /** Remove every row this athlete owns, the athlete included (#35). */
  eraseAthlete(athleteId: string): Promise<void>;

  /** Close the connection. Nothing may be called after. */
  close(): Promise<void>;
}

/** A write named a key another athlete already holds. */
export class OwnershipConflictError extends Error {
  override readonly name = 'OwnershipConflictError';
}

/**
 * The tables `eraseAthlete` empties, children before parents so the foreign
 * keys hold at every step. ⚠️ Written down, and `sql-store.erasure.test.ts`
 * derives the list from the SCHEMA and fails when a table is missing here.
 */
export const ATHLETE_TABLES_IN_ERASURE_ORDER = [
  'result',
  'activity_record',
  'session',
  'link_code',
  'recovery_code',
  'display_name_change',
  'recovery_email',
  'email_recovery_token',
  'block',
  'report',
  'invite_code',
  'device_key',
] as const satisfies readonly (keyof InstanceDatabase)[];

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

const roomFrom = (row: Selectable<RoomTable>): Room => ({
  id: row.id,
  kind: row.kind,
  visibility: row.visibility,
  routeSha256: row.route_sha256,
  physicsVersion: row.physics_version,
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

    revokeDeviceKey: (athleteId, publicKey, at) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const updated = await trx
            .updateTable('device_key')
            .set({ revoked_at: sql<number>`coalesce(revoked_at, ${at})` })
            .where('athlete_id', '=', athleteId)
            .where('public_key', '=', publicKey)
            .executeTakeFirst();
          if (updated.numUpdatedRows === 0n) return false;
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
          return true;
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
          if (registration.recoveryEmail !== undefined) {
            await trx
              .insertInto('recovery_email')
              .values({ athlete_id: athlete.id, address: registration.recoveryEmail })
              // In the transaction, so two registrations racing for one
              // address cannot both reach the index: the second binds nothing.
              .onConflict((conflict) => conflict.column('address').doNothing())
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

    renameAthlete: (athleteId, name, at) =>
      exclusive(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('athlete')
            .select(['display_name', 'display_name_hidden_at'])
            .where('id', '=', athleteId)
            .executeTakeFirst();
          if (row === undefined) return false;
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
          return true;
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
      exclusive(async () => {
        await db.transaction().execute(async (trx) => {
          for (const table of ATHLETE_TABLES_IN_ERASURE_ORDER) {
            await trx.deleteFrom(table).where('athlete_id', '=', athleteId).execute();
          }
          // Another athlete's block OF this one names nobody once they are gone (#83).
          await trx.deleteFrom('block').where('blocked_athlete_id', '=', athleteId).execute();
          await trx.deleteFrom('athlete').where('id', '=', athleteId).execute();
        });
      }),

    close: () => exclusive(() => db.destroy()),
  };
}
