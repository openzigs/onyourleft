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
  LinkCodeTable,
  RecoveryCodeTable,
  ResultTable,
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
}

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
  getAthlete(athleteId: string): Promise<Athlete | undefined>;

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
  /**
   * #37: file a verified signed record and index it in the manifest, in one
   * transaction. The same file from the same athlete is `duplicate` however
   * many requests race — the primary key decides, not a read before the write.
   */
  ingestActivity(ingestion: ActivityIngestion): Promise<Ingested>;
  /**
   * Whether ANY athlete holds a record of this file. Not athlete-scoped, by
   * design: a blob is shared by every athlete who sent the same bytes, and
   * this is what says whether removing it would take somebody else's file.
   */
  isContentHeld(contentSha256: string): Promise<boolean>;
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
  ): Promise<readonly SyncItem[]>;
  getActivityRecord(athleteId: string, contentSha256: string): Promise<ActivityRecord | undefined>;
  listActivityRecords(athleteId: string): Promise<readonly ActivityRecord[]>;

  putRoom(room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | undefined>;

  putResult(result: Result): Promise<void>;
  listResults(athleteId: string): Promise<readonly Result[]>;
  /** A room's finish order is every rider's, by design: not athlete-scoped. */
  listRoomResults(roomId: string): Promise<readonly Result[]>;

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
            .select('display_name')
            .where('id', '=', athleteId)
            .executeTakeFirst();
          if (row === undefined) return false;
          await trx
            .insertInto('display_name_change')
            .values({ athlete_id: athleteId, previous_name: row.display_name, changed_at: at })
            .execute();
          await trx
            .updateTable('athlete')
            .set({ display_name: name })
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

    isContentHeld: (contentSha256) =>
      exclusive(async () => {
        const row = await db
          .selectFrom('activity_record')
          .select('athlete_id')
          .where('content_sha256', '=', contentSha256)
          .limit(1)
          .executeTakeFirst();
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
        let query = db.selectFrom('sync_item').selectAll().where('athlete_id', '=', athleteId);
        if (after !== undefined) {
          query = query.where(
            sql<boolean>`(received_at, seq) > (${after.receivedAt}, ${after.seq})`,
          );
        }
        const rows = await query.orderBy('received_at').orderBy('seq').limit(limit).execute();
        return rows.map(syncItemFrom);
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
          await trx.deleteFrom('athlete').where('id', '=', athleteId).execute();
          return held.map((row) => row.content_sha256);
        }),
      ),

    close: () => exclusive(() => db.destroy()),
  };
}
