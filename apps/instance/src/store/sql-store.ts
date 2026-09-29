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

import { sql, type Kysely, type Selectable } from 'kysely';
import type {
  ActivityRecordTable,
  AthleteTable,
  DeviceKeyTable,
  DisplayNameChangeTable,
  EmailRecoveryTokenTable,
  InstanceDatabase,
  RecoveryEmailConfirmationTable,
  LinkCodeTable,
  RecoveryCodeTable,
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
}

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

/** The storage port. */
export interface SqlStore {
  putAthlete(athlete: Athlete): Promise<void>;
  getAthlete(athleteId: string): Promise<Athlete | undefined>;

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
  /** An address given for recovery, waiting to be confirmed (#865). Binds nothing. */
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
  getActivityRecord(athleteId: string, contentSha256: string): Promise<ActivityRecord | undefined>;
  listActivityRecords(athleteId: string): Promise<readonly ActivityRecord[]>;

  putRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;

  putResult(result: Result): Promise<void>;
  listResults(athleteId: string): Promise<readonly Result[]>;
  /** A room's finish order is every rider's, by design: not athlete-scoped. */
  listRoomResults(roomId: string): Promise<readonly Result[]>;

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
  'recovery_email_confirmation',
  'email_recovery_token',
  'device_key',
] as const satisfies readonly (keyof InstanceDatabase)[];

const athleteFrom = (row: Selectable<AthleteTable>): Athlete => ({
  id: row.id,
  displayName: row.display_name,
  createdAt: row.created_at,
  registrationState: row.registration_state,
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
          })
          .onConflict((conflict) =>
            conflict.column('id').doUpdateSet({
              display_name: athlete.displayName,
              registration_state: athlete.registrationState,
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
            .select('display_name')
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
            .set({ display_name: name })
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
      exclusive(async () => {
        await db
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

    eraseAthlete: (athleteId) =>
      exclusive(async () => {
        await db.transaction().execute(async (trx) => {
          for (const table of ATHLETE_TABLES_IN_ERASURE_ORDER) {
            await trx.deleteFrom(table).where('athlete_id', '=', athleteId).execute();
          }
          await trx.deleteFrom('athlete').where('id', '=', athleteId).execute();
        });
      }),

    close: () => exclusive(() => db.destroy()),
  };
}
