// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the running instance meets its database (#791): migrations are an
 * explicit step the deploy runs BEFORE the new version starts, never
 * something the server does to itself on boot — where a failure takes the
 * server down with it and a rollback races the migration (#52's criterion).
 *
 * - {@link migrateForDeploy} is the step: it writes a marker beside the
 *   database while it runs, so a server starting at the same moment (a box
 *   coming back from a reboot, with compose starting both) knows to wait.
 * - {@link migrationState} is what the server reads: `at-head`, `migrating`
 *   (the marker is there), `behind` (a migration this build has is not
 *   applied) or `ahead` (the database was migrated by a newer build).
 * - {@link openServingStore} opens the store and migrates NOTHING.
 */

import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';

import { sql, type Kysely } from 'kysely';

import type { MigrationState } from '../readiness.ts';
import { appliedMigrations, migrateToLatest, tableRowCounts } from './migrate.ts';
import { MIGRATIONS } from './migrations/index.ts';
import { openKysely } from './open-sql-store.ts';
import { createSqlStore, type SqlStore } from './sql-store.ts';

/** The command an operator runs, as every refusal names it. */
export const MIGRATE_COMMAND = 'node src/operator/cli.ts migrate';

/** The marker a running migration leaves beside the database. */
export function migratingMarker(databasePath: string): string {
  return `${databasePath}.migrating`;
}

async function appliedNames(db: Kysely<unknown>): Promise<readonly string[]> {
  const tables = await sql<{ name: string }>`
    select name from sqlite_schema where type = 'table' and name = 'kysely_migration'`.execute(db);
  if (tables.rows.length === 0) return [];
  const rows = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(
    db,
  );
  return rows.rows.map((row) => row.name);
}

export async function migrationState(databasePath: string): Promise<MigrationState> {
  if (existsSync(migratingMarker(databasePath))) return 'migrating';
  const db = openKysely(databasePath) as unknown as Kysely<unknown>;
  try {
    const applied = new Set(await appliedNames(db));
    const known = Object.keys(MIGRATIONS);
    if ([...applied].some((name) => !known.includes(name))) return 'ahead';
    return known.every((name) => applied.has(name)) ? 'at-head' : 'behind';
  } finally {
    await db.destroy();
  }
}

/** The store, opened for serving: nothing is migrated. */
export function openServingStore(databasePath: string): SqlStore {
  return createSqlStore(openKysely(databasePath));
}

export interface MigrationReport {
  readonly changed: number;
  readonly applied: readonly string[];
  readonly rows: Readonly<Record<string, number>>;
}

/**
 * The deploy's migrate step: every migration not yet applied, with the
 * marker written first and removed last — also when a migration throws, so a
 * failure is `behind` (refused, naming this command) rather than `migrating`
 * for ever.
 */
export async function migrateForDeploy(databasePath: string): Promise<MigrationReport> {
  const marker = migratingMarker(databasePath);
  await writeFile(marker, `${String(Date.now())}\n`);
  const db = openKysely(databasePath) as unknown as Kysely<unknown>;
  try {
    const changed = await migrateToLatest(db);
    return { changed, applied: await appliedMigrations(db), rows: await tableRowCounts(db) };
  } finally {
    await db.destroy();
    await rm(marker, { force: true });
  }
}
