// SPDX-License-Identifier: Apache-2.0

/**
 * A database as an OLDER build of this store made it — the "downgrade" half of
 * ADR 0005 F's rollback (export → downgrade → re-import), which IndexedDB has no
 * event for. Here so a test outside this package (the account export's, under
 * `apps/web`) can run that path with the product's own export, without
 * depending on Dexie itself (#1236).
 */

import Dexie from 'dexie';

import { SCHEMA_VERSIONS } from '../schema';

/** An older build's database, open, with nothing but raw puts. */
export interface OlderSchemaDatabase {
  /** The version it opened at — what an older build would report. */
  readonly version: number;
  /** The tables an older build has. */
  readonly tables: readonly string[];
  /** Writes one row as an older build would, unchecked. */
  put(table: string, row: unknown): Promise<void>;
  close(): void;
}

/**
 * Opens `databaseName` with the schema of `version` and none after it. The
 * database must not exist at a newer version: IndexedDB refuses to open one
 * lower (`VersionError`), which is why a rollback deletes it first.
 */
export async function openOlderSchema(
  databaseName: string,
  version: number,
): Promise<OlderSchemaDatabase> {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSIONS.length) {
    throw new RangeError(`version must be 1..${String(SCHEMA_VERSIONS.length)}`);
  }
  const older = new Dexie(databaseName);
  SCHEMA_VERSIONS.slice(0, version).forEach((stores, index) => {
    older.version(index + 1).stores(stores);
  });
  await older.open();
  return {
    version: older.verno,
    tables: older.tables.map((table) => table.name),
    put: async (table, row) => {
      await older.table(table).put(row);
    },
    close: () => {
      older.close();
    },
  };
}
