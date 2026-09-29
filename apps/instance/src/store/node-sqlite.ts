// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's ONE file that names `node:sqlite` (#769, ADR 0037 D-5).
 *
 * Everything else in `src/store/` is written against Kysely's `SqliteDatabase`
 * interface, so the same store runs on a Durable Object's SQLite (#781) with a
 * different file here and nothing else changed (ADR 0037 D-2).
 *
 * ## Why an adapter at all — the empty read
 *
 * ⚠️ **Kysely 0.29.6's SQLite driver returns NO rows from `node:sqlite`, and
 * says nothing.** Its connection calls `stmt.all()` only when `stmt.reader` is
 * true, and `node:sqlite`'s `StatementSync` has no `reader` property, so every
 * `SELECT` takes the `run()` branch and comes back as `rows: []`. It also
 * passes the parameters as ONE array, where `StatementSync` takes them spread.
 * (Measured for #835 on 2026-09-29 and recorded on #769.)
 *
 * So {@link kyselyDatabase} wraps a `DatabaseSync` in the
 * `better-sqlite3`-shaped interface Kysely documents: `reader` is whether the
 * prepared statement returns columns — `columns().length > 0`, which is true
 * of a `SELECT` and of an `INSERT … RETURNING` and false of a plain write —
 * and the parameters are spread. `node-sqlite.test.ts` holds both halves, and
 * every round trip in the harness would read nothing without the first.
 *
 * This is ADR 0037 D-5's first option, taken. Its fallback, `better-sqlite3`,
 * is not: it would be a native build and an `allowBuilds` answer, to avoid a
 * forty-line adapter.
 *
 * ## The pragmas, set on every connection
 *
 * - **`journal_mode = WAL`** (ADR 0037 D-5): readers do not block the writer.
 * - **`busy_timeout`**: a second connection waiting on the write lock waits
 *   for it rather than failing with `SQLITE_BUSY` at once — and every
 *   transaction begins IMMEDIATE, for the reason at {@link kyselyDatabase}.
 *   `sql-store.concurrency.test.ts` runs two writers in two threads.
 * - **Foreign keys ON.** SQLite leaves them off per connection, which would
 *   make a schema's `REFERENCES` clauses decoration; `node:sqlite` turns them
 *   on by default (`enableForeignKeyConstraints`), so no pragma is written —
 *   `node-sqlite.test.ts` reads the setting back, and a `DatabaseSync`
 *   opened with it off turns that test red.
 *
 * `allowExtension` is left false: nothing loads one yet. #835's sqlite-vec
 * fallback would need it set here, and `ERR_INVALID_STATE` without it.
 */

import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { SqliteDatabase, SqliteStatement } from 'kysely';

/** How long a connection waits for another's write lock, in milliseconds. */
export const BUSY_TIMEOUT_MILLISECONDS = 5_000;

/** What an opener may be told. */
export interface OpenOptions {
  /** How long to wait for another connection's write lock. {@link BUSY_TIMEOUT_MILLISECONDS} by default. */
  readonly busyTimeoutMilliseconds?: number;
}

/** Open a database file with the instance's pragmas set. */
export function openDatabase(path: string, options: OpenOptions = {}): DatabaseSync {
  const busyTimeout = options.busyTimeoutMilliseconds ?? BUSY_TIMEOUT_MILLISECONDS;
  if (!Number.isInteger(busyTimeout) || busyTimeout < 0) {
    throw new RangeError('The busy timeout is a whole number of milliseconds.');
  }
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
  database.exec('PRAGMA journal_mode = WAL');
  return database;
}

/** The `better-sqlite3`-shaped statement Kysely's driver expects. */
function kyselyStatement(statement: StatementSync): SqliteStatement {
  const spread = (parameters: ReadonlyArray<unknown>): SQLInputValue[] =>
    parameters as SQLInputValue[];
  return {
    reader: statement.columns().length > 0,
    all: (parameters) => statement.all(...spread(parameters)),
    run: (parameters) => statement.run(...spread(parameters)),
    iterate: (parameters) => statement.iterate(...spread(parameters)),
  };
}

/**
 * Kysely begins every transaction with a bare `begin`, which SQLite takes as
 * DEFERRED: the transaction starts as a reader and asks for the write lock at
 * its first write. In WAL mode, if another connection committed in between,
 * that upgrade fails with `SQLITE_BUSY` at once — the busy timeout does not
 * apply, because waiting cannot help a stale snapshot. Every transaction this
 * store opens writes, so each one takes the write lock up front instead.
 * `sql-store.concurrency.test.ts` is what showed it, and `node-sqlite.test.ts`
 * holds it deterministically in one thread.
 */
const BEGIN = /^\s*begin\s*$/i;

/** A `DatabaseSync` as Kysely's `SqliteDialect` wants one. */
export function kyselyDatabase(database: DatabaseSync): SqliteDatabase {
  return {
    close: () => database.close(),
    prepare: (sql) => kyselyStatement(database.prepare(BEGIN.test(sql) ? 'BEGIN IMMEDIATE' : sql)),
  };
}
