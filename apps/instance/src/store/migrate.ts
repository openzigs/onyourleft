// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Running the migrations (#769, ADR 0037 D-6), with Kysely's `Migrator`.
 *
 * ⚠️ **Kysely's `migrateDown` skips a migration that has no `down` and still
 * reports success** (#769). {@link reversibleProvider} refuses such a
 * migration before the migrator ever sees it, so a rollback either happens or
 * throws — it cannot quietly do nothing. The type in `migrations/index.ts`
 * refuses it at compile time too; this is the half that also covers a module
 * whose `down` was deleted and cast back.
 */

import { sql, type Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import { MIGRATIONS, type InstanceMigration } from './migrations/index.ts';

/** Any Kysely the migrations can run on, whatever its table types. */
export type MigratableDatabase = Kysely<unknown>;

/** Thrown when a migration cannot be undone, or a step did not go as asked. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/** A provider that hands the migrator only migrations that have a `down`. */
export function reversibleProvider(
  migrations: Readonly<Record<string, InstanceMigration>>,
): MigrationProvider {
  return {
    getMigrations: () => {
      const checked: Record<string, Migration> = {};
      for (const [name, migration] of Object.entries(migrations)) {
        if (typeof migration.up !== 'function' || typeof migration.down !== 'function') {
          throw new MigrationError(`Migration ${name} does not export both up and down.`);
        }
        checked[name] = migration;
      }
      return Promise.resolve(checked);
    },
  };
}

function migratorFor(
  db: Kysely<unknown>,
  migrations: Readonly<Record<string, InstanceMigration>>,
): Migrator {
  return new Migrator({ db, provider: reversibleProvider(migrations) });
}

async function settle(
  step: Promise<{ error?: unknown; results?: readonly { status: string }[] }>,
): Promise<number> {
  const { error, results } = await step;
  if (error !== undefined) {
    throw error instanceof Error ? error : new MigrationError('A migration failed.');
  }
  const failed = results?.find((result) => result.status !== 'Success');
  if (failed !== undefined) throw new MigrationError('A migration step did not succeed.');
  return results?.length ?? 0;
}

/** Apply every migration not yet applied. Answers how many were applied. */
export function migrateToLatest(
  db: Kysely<unknown>,
  migrations: Readonly<Record<string, InstanceMigration>> = MIGRATIONS,
): Promise<number> {
  return settle(migratorFor(db, migrations).migrateToLatest());
}

/** Undo the most recent migration. Answers how many were undone (0 or 1). */
export function migrateDownOne(
  db: Kysely<unknown>,
  migrations: Readonly<Record<string, InstanceMigration>> = MIGRATIONS,
): Promise<number> {
  return settle(migratorFor(db, migrations).migrateDown());
}

/** Apply the next migration only. Answers how many were applied (0 or 1). */
export function migrateUpOne(
  db: Kysely<unknown>,
  migrations: Readonly<Record<string, InstanceMigration>> = MIGRATIONS,
): Promise<number> {
  return settle(migratorFor(db, migrations).migrateUp());
}

/** The names of the migrations applied to `db`, oldest first. */
export async function appliedMigrations(db: Kysely<unknown>): Promise<readonly string[]> {
  const infos = await new Migrator({
    db,
    provider: reversibleProvider(MIGRATIONS),
  }).getMigrations();
  return infos.filter((info) => info.executedAt !== undefined).map((info) => info.name);
}

/**
 * How many rows each of the instance's own tables holds — every table but
 * SQLite's and the migrator's bookkeeping. For an operator watching a
 * rollback, and for the record #769 asks a pull request to carry.
 */
export async function tableRowCounts(db: Kysely<unknown>): Promise<Record<string, number>> {
  const tables = await sql<{ name: string }>`
    select name from sqlite_schema
    where type = 'table' and name not like 'sqlite_%' and name not like 'kysely_%'
    order by name`.execute(db);
  const counts: Record<string, number> = {};
  for (const { name } of tables.rows) {
    const counted = await sql<{ n: number }>`select count(*) as n from ${sql.table(name)}`.execute(
      db,
    );
    counts[name] = counted.rows[0]?.n ?? 0;
  }
  return counts;
}
