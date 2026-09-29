// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migrate an instance database by hand (#769): an operator's tool, and how
 * #769's "rollback executed for real" was recorded.
 *
 *     node tools/migrate.ts <database file> status
 *     node tools/migrate.ts <database file> latest
 *     node tools/migrate.ts <database file> up
 *     node tools/migrate.ts <database file> down
 *
 * Every command prints the applied migrations and each table's row count
 * afterwards, so a rollback's cost is on the screen rather than inferred.
 * Only `latest` may create the file: `status`, `up` and `down` on a path that
 * does not exist are refused with exit 2, so a mistyped path is an error
 * rather than a new, empty database beside the real one.
 *
 * ⚠️ `down` undoes the newest migration, and a migration that created a table
 * drops it — with its rows. Take a copy of the file first.
 */

import { existsSync } from 'node:fs';
import {
  appliedMigrations,
  migrateDownOne,
  migrateToLatest,
  migrateUpOne,
  tableRowCounts,
  type MigratableDatabase,
} from '../src/store/migrate.ts';
import { openKysely } from '../src/store/open-sql-store.ts';

const COMMANDS: Record<string, (db: MigratableDatabase) => Promise<number>> = {
  status: () => Promise.resolve(0),
  latest: migrateToLatest,
  up: migrateUpOne,
  down: migrateDownOne,
};

const [path, command] = process.argv.slice(2);
const run = command === undefined ? undefined : COMMANDS[command];
if (path === undefined || run === undefined) {
  process.stderr.write('usage: node tools/migrate.ts <database file> status|latest|up|down\n');
  process.exit(2);
}
if (command !== 'latest' && !existsSync(path)) {
  process.stderr.write(`There is no database at ${path}; only \`latest\` creates one.\n`);
  process.exit(2);
}

const db = openKysely(path) as MigratableDatabase;
try {
  const changed = await run(db);
  process.stdout.write(`${command}: ${changed} migration(s) changed\n`);
  process.stdout.write(`applied: ${(await appliedMigrations(db)).join(', ') || '(none)'}\n`);
  for (const [table, count] of Object.entries(await tableRowCounts(db))) {
    process.stdout.write(`  ${table}: ${count} row(s)\n`);
  }
} finally {
  await db.destroy();
}
