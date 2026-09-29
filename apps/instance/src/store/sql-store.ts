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
 * - **One operation at a time.** Kysely's SQLite driver has one connection and
 *   no lock, so two transactions started together would nest a `begin` inside
 *   another. {@link createSqlStore} queues every call behind the one before it.
 */

import type { Kysely, Selectable } from 'kysely';
import type {
  ActivityRecordTable,
  AthleteTable,
  DeviceKeyTable,
  InstanceDatabase,
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
  readonly publicKey: string;
  readonly athleteId: string;
  readonly addedAt: number;
  readonly revokedAt: number | null;
}

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

/** What storing an activity record did: a retried sync of the same file is `duplicate`. */
export type PutOutcome = 'stored' | 'duplicate';

/** The storage port. */
export interface SqlStore {
  putAthlete(athlete: Athlete): Promise<void>;
  getAthlete(athleteId: string): Promise<Athlete | undefined>;

  putDeviceKey(key: DeviceKey): Promise<void>;
  listDeviceKeys(athleteId: string): Promise<readonly DeviceKey[]>;

  putSession(session: Session): Promise<void>;
  /** Authentication: the token names the athlete, so this is not athlete-scoped. */
  findSession(tokenSha256: string): Promise<Session | undefined>;
  listSessions(athleteId: string): Promise<readonly Session[]>;

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
});

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
              conflict.column('public_key').doUpdateSet({ revoked_at: key.revokedAt }),
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
                revoked_at: session.revokedAt,
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
