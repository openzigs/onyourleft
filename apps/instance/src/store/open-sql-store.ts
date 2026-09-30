// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The store on the box: a SQLite file through `node:sqlite`, migrated to the
 * latest schema before anything reads it (#769, ADR 0037 D-2's adapter 1).
 *
 * The Durable Object adapter (#781) is this file's sibling, not a change to it.
 */

import { Kysely, SqliteDialect } from 'kysely';
import { migrateToLatest } from './migrate.ts';
import { kyselyDatabase, openDatabase, type OpenOptions } from './node-sqlite.ts';
import type { InstanceDatabase } from './schema.ts';
import { createSqlStore, type SqlStore } from './sql-store.ts';

/** What opening the store may be told beyond the connection's pragmas. */
export interface StoreOpenOptions extends OpenOptions {
  /**
   * Called with every statement's SQL as it runs — how #38's "a bounded number
   * of queries" is counted rather than asserted by reading the code.
   */
  readonly onQuery?: (sql: string) => void;
}

/** A Kysely over one `node:sqlite` connection to `path`, with the pragmas set. */
export function openKysely(path: string, options: StoreOpenOptions = {}): Kysely<InstanceDatabase> {
  const { onQuery } = options;
  return new Kysely<InstanceDatabase>({
    dialect: new SqliteDialect({ database: kyselyDatabase(openDatabase(path, options)) }),
    ...(onQuery === undefined
      ? {}
      : {
          log: (event) => {
            if (event.level === 'query') onQuery(event.query.sql);
          },
        }),
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
