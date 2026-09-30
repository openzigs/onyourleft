// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The database half of a backup (#791): an ONLINE copy, taken while the
 * instance is running and writing, and the checks a restore is judged by.
 *
 * `VACUUM INTO` writes a new, complete, compacted database file from one
 * read transaction — so in WAL mode it neither blocks the instance's writer
 * nor copies a half-written page, which copying the `.sqlite` file (and
 * forgetting its `-wal` beside it) would. It is SQLite's own, so it needs no
 * binary in the image. Litestream (ADR 0037 D-5) streams continuously and is
 * a second process to run and watch; for one person's box a scheduled
 * snapshot is enough, and #807 decides the schedule.
 */

import { existsSync } from 'node:fs';

import { openDatabase } from './node-sqlite.ts';

/** Writes a consistent copy of `databasePath` to `destination`, which must not exist yet. */
export function vacuumInto(databasePath: string, destination: string): void {
  if (existsSync(destination)) throw new Error('the backup file already exists');
  const database = openDatabase(databasePath);
  try {
    database.prepare('VACUUM INTO ?').run(destination);
  } finally {
    database.close();
  }
}

/** Every table's row count — SQLite's and the migrator's own bookkeeping excepted. */
export function rowCounts(databasePath: string): Record<string, number> {
  const database = openDatabase(databasePath);
  try {
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'kysely_%' ORDER BY name`,
      )
      .all() as { name: string }[];
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const row = database.prepare(`SELECT count(*) AS n FROM ${quoted}`).get() as { n: number };
      counts[name] = row.n;
    }
    return counts;
  } finally {
    database.close();
  }
}

/** `PRAGMA integrity_check`: `true` only for SQLite's own `ok`. */
export function integrityOk(databasePath: string): boolean {
  const database = openDatabase(databasePath);
  try {
    const rows = database.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    return rows.length === 1 && rows[0]?.integrity_check === 'ok';
  } finally {
    database.close();
  }
}
