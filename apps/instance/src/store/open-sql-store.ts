// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The store on the box: a SQLite file through `node:sqlite`, migrated to the
 * latest schema before anything reads it (#769, ADR 0037 D-2's adapter 1).
 *
 * The Durable Object adapter (#781) is this file's sibling, not a change to it.
 */

import { Kysely } from 'kysely';
import { BusyRetryingSqliteDialect } from './busy-retry.ts';
import { migrateToLatest } from './migrate.ts';
import { kyselyDatabase, openDatabase, type OpenOptions } from './node-sqlite.ts';
import type { InstanceDatabase } from './schema.ts';
import { createSqlStore, type SqlStore } from './sql-store.ts';

/** What opening the store may be told beyond the connection's pragmas. */
export interface StoreOpenOptions extends OpenOptions {
  /**
   * Called with every statement's SQL as it runs — how #38's "a bounded number
   * of queries" is counted rather than asserted by reading the code. Since
   * #985's review it is called once per ATTEMPT, beneath the busy retry
   * (`busy-retry.ts` §`onAttempt`), so a statement run again is counted again
   * and one that failed is counted too; with no retry and no failure that is
   * exactly the count Kysely's own log gave.
   */
  readonly onQuery?: (sql: string) => void;
  /**
   * The pauses before a statement that met `SQLITE_BUSY` outside a
   * transaction is run again (#985); `busy-retry.ts`'s default otherwise.
   */
  readonly busyRetryDelaysMilliseconds?: readonly number[];
}

/**
 * A Kysely over one `node:sqlite` connection to `path`, with the pragmas set
 * and a statement that meets `SQLITE_BUSY` outside a transaction retried
 * (`busy-retry.ts`, #985).
 */
export function openKysely(path: string, options: StoreOpenOptions = {}): Kysely<InstanceDatabase> {
  const { onQuery, busyRetryDelaysMilliseconds } = options;
  const database = openDatabase(path, options);
  return new Kysely<InstanceDatabase>({
    dialect: new BusyRetryingSqliteDialect(
      { database: kyselyDatabase(database) },
      {
        inTransaction: () => database.isTransaction,
        ...(busyRetryDelaysMilliseconds === undefined
          ? {}
          : { delaysMilliseconds: busyRetryDelaysMilliseconds }),
        ...(onQuery === undefined ? {} : { onAttempt: onQuery }),
      },
    ),
  });
}

/** Open the store at `path`, applying any migration not yet applied. */
export async function openSqlStore(
  path: string,
  options: StoreOpenOptions = {},
): Promise<SqlStore> {
  const db = openKysely(path, options);
  try {
    await migrateToLatest(db as Kysely<unknown>);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  return createSqlStore(db);
}
