// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A write that met another connection's lock waits again, rather than
 * failing a rider** (#985).
 *
 * `node-sqlite.ts` sets a busy timeout, so a connection that finds the write
 * lock taken polls for it before giving up with `SQLITE_BUSY` ("database is
 * locked"). That poll is not FAIR: SQLite sleeps between attempts and tries
 * again, and a connection that keeps writing can take the lock back in the
 * gap every time. On a loaded two-core runner,
 * `sql-store.concurrency.test.ts`'s two writers did exactly that — one of
 * them missed the lock for the whole five seconds and the error reached the
 * caller (#985, run 36884103033).
 *
 * The instance has two writers on one file whenever an operator command
 * writes while the server serves — `room-open`, and the deploy's `migrate`
 * step while the old server is still up — so the same error could reach a
 * rider as a failed request. So a statement that fails with `SQLITE_BUSY`
 * OUTSIDE a transaction is run again, after an ASYNCHRONOUS pause: the
 * server's event loop is free while it waits, and the next attempt starts a
 * fresh busy timeout.
 *
 * ⚠️ **Only outside a transaction.** Outside one, `SQLITE_BUSY` means nothing
 * happened: either the `BEGIN IMMEDIATE` that opens every transaction
 * (`node-sqlite.ts`) did not get the lock, or an autocommit statement did
 * not. Inside one, the statement is part of work a retry here cannot see,
 * so the error goes to the caller as it is.
 *
 * ⚠️ **Bounded.** {@link BUSY_RETRY_DELAYS_MILLISECONDS} is the whole list of
 * pauses; after the last, the error reaches the caller. A lock held for good
 * (a hung operator command) still fails a request, in about twenty seconds
 * rather than five.
 */

import {
  SqliteDialect,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type SqliteDialectConfig,
  type TransactionSettings,
} from 'kysely';

/**
 * The pauses between attempts, in milliseconds: four attempts in all, each
 * with the full busy timeout, so about 21 s of patience at the default 5 s.
 */
export const BUSY_RETRY_DELAYS_MILLISECONDS: readonly number[] = [50, 200, 1_000];

/** SQLite's primary result code for "database is locked". */
const SQLITE_BUSY = 5;

/** Whether `error` is `node:sqlite`'s `SQLITE_BUSY` (any extended code of it). */
export function isBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('errcode' in error)) return false;
  const { errcode } = error;
  return typeof errcode === 'number' && (errcode & 0xff) === SQLITE_BUSY;
}

/** What the retry needs to know about the connection beneath it. */
export interface BusyRetryOptions {
  /** Whether the connection is inside a transaction now. */
  readonly inTransaction: () => boolean;
  /** The pauses; {@link BUSY_RETRY_DELAYS_MILLISECONDS} by default. */
  readonly delaysMilliseconds?: readonly number[];
  /** How a pause is taken; a timer by default. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const timer = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** A connection whose statements are retried on `SQLITE_BUSY` outside a transaction. */
export function retryingConnection(
  inner: DatabaseConnection,
  options: BusyRetryOptions,
): DatabaseConnection {
  const delays = options.delaysMilliseconds ?? BUSY_RETRY_DELAYS_MILLISECONDS;
  const sleep = options.sleep ?? timer;
  return {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await inner.executeQuery<R>(compiledQuery);
        } catch (error) {
          const delay = delays[attempt];
          if (delay === undefined || !isBusy(error) || options.inTransaction()) throw error;
          await sleep(delay);
        }
      }
    },
    streamQuery: <R>(compiledQuery: CompiledQuery, chunkSize: number) =>
      inner.streamQuery<R>(compiledQuery, chunkSize),
  };
}

/** A driver whose connection is {@link retryingConnection}. */
function retryingDriver(inner: Driver, options: BusyRetryOptions): Driver {
  return {
    init: (initOptions) => inner.init(initOptions),
    acquireConnection: async (acquireOptions) =>
      retryingConnection(await inner.acquireConnection(acquireOptions), options),
    // Kysely's SQLite driver issues its `begin` through the connection it is
    // handed, which is the retrying one: that is what retries a transaction's
    // start. Its commit, rollback and savepoints go through it too, and are
    // never retried, because by then the connection is in a transaction.
    beginTransaction: (connection, settings: TransactionSettings) =>
      inner.beginTransaction(connection, settings),
    commitTransaction: (connection) => inner.commitTransaction(connection),
    rollbackTransaction: (connection) => inner.rollbackTransaction(connection),
    ...(inner.savepoint === undefined ? {} : { savepoint: inner.savepoint.bind(inner) }),
    ...(inner.rollbackToSavepoint === undefined
      ? {}
      : { rollbackToSavepoint: inner.rollbackToSavepoint.bind(inner) }),
    ...(inner.releaseSavepoint === undefined
      ? {}
      : { releaseSavepoint: inner.releaseSavepoint.bind(inner) }),
    releaseConnection: (connection, releaseOptions) =>
      inner.releaseConnection(connection, releaseOptions),
    destroy: (destroyOptions) => inner.destroy(destroyOptions),
  };
}

/** Kysely's SQLite dialect, with {@link retryingConnection} under it. */
export class BusyRetryingSqliteDialect extends SqliteDialect {
  readonly #options: BusyRetryOptions;

  constructor(config: SqliteDialectConfig, options: BusyRetryOptions) {
    super(config);
    this.#options = options;
  }

  override createDriver(): Driver {
    return retryingDriver(super.createDriver(), this.#options);
  }
}
