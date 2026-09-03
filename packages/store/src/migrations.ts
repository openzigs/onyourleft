// SPDX-License-Identifier: Apache-2.0

/**
 * The migration contract: **a pair of pure functions over serialisable
 * records**, `up` and `down`, living side by side.
 *
 * ## Why it is shaped like this and not like a SQL migration
 *
 * `IndexedDB has no downgrade event.` `onupgradeneeded` fires only when the
 * version increases; opening a database at a version lower than the one on disk
 * raises `VersionError`. So "apply the migration, then roll it back against a
 * database containing rows, and verify the schema returns to its prior shape"
 * — #26's first acceptance criterion, written for a SQL server that Phase 1
 * does not have — **cannot** be executed as written. Not "is hard": the event
 * does not exist.
 *
 * ADR 0005 section F decided what it means instead, and CLAUDE.md section 5
 * repeats it:
 *
 * 1. Every migration is a pair of pure functions over serialisable records.
 * 2. `down` is **tested** by applying `up` then `down` to a fixture containing
 *    records and asserting the original shape returns. That test is what makes
 *    the rollback real rather than aspirational, and it is cheap because both
 *    functions are pure.
 * 3. The **runtime** rollback path is export -> downgrade -> re-import, which
 *    local-first already requires for other reasons: the athlete's signed files
 *    are the canonical artefact.
 *
 * Point 2 is the substance. A rollback nobody has executed is not a rollback,
 * and the record-level round trip is the strongest statement that can honestly
 * be made on this storage engine — it proves the data returns to its prior
 * shape, which is the part that matters. What it does not prove is that
 * IndexedDB's own index definitions revert, because they cannot; point 3 is the
 * answer to that, and it is why `down` must be **total over the records `up`
 * produced** rather than merely plausible.
 *
 * ## The registry is empty, and that is the honest state
 *
 * `SCHEMA_MIGRATIONS` below is empty. Schema version 1 is the initial schema of
 * a store that has never shipped, so there is no prior shape to return to and
 * no migration to roll back. Writing a speculative one to have something to
 * demonstrate would put a schema change into the athlete's upgrade path that no
 * issue asked for. The machinery is here, tested end to end through a real
 * Dexie version bump in `migrations.test.ts`, so the first real migration is an
 * entry in an array rather than a design exercise.
 */

import type { Transaction } from 'dexie';

/**
 * One schema change, as a reversible pure transformation of one table's
 * records.
 *
 * `up` and `down` are declared with **method syntax**, not property syntax.
 * That is deliberate and load-bearing: method signatures are checked
 * bivariantly, which is what lets a `RecordMigration<V1Row, V2Row>` be held in
 * an array of `AnyRecordMigration` without a cast. The registry is inherently
 * heterogeneous — each entry converts a different pair of shapes — and the
 * alternative is an `any` in the one file that must not have one.
 *
 * Both functions must be **pure**: no `Date.now()`, no random ids, no reads of
 * anything but their argument. A migration that is not pure cannot be round
 * tripped in a test, which means its `down` is untested, which means the
 * rollback is aspirational again.
 */
export interface RecordMigration<Before, After> {
  /** The schema version this migration produces. `up` moves to it. */
  readonly toVersion: number;
  /** The object store whose records change. */
  readonly table: string;
  /** One line, in the past tense, for the upgrade log and the PR body. */
  readonly description: string;
  /** Forward: a record in version `toVersion - 1` shape becomes `toVersion`. */
  up(before: Before): After;
  /**
   * Backward: a record `up` produced becomes its prior shape again.
   *
   * Must be total over `up`'s output. If a field is dropped by `up` and cannot
   * be recovered, `down` must restore the value the prior schema's default
   * would have written — and the migration's `description` must say so, because
   * that is data loss the round-trip test will not catch.
   */
  down(after: After): Before;
}

/** A migration whose record shapes are not known to the holder. @see RecordMigration */
export type AnyRecordMigration = RecordMigration<unknown, unknown>;

/**
 * Every migration this build knows how to apply, in ascending `toVersion`.
 *
 * Empty: schema version 1 is the initial schema. See the file comment.
 */
export const SCHEMA_MIGRATIONS: readonly AnyRecordMigration[] = [];

/**
 * Applies `up` to every record. Pure; returns a new array.
 *
 * The forward half of the round trip #26 asks to be evidenced.
 */
export function migrateUp<Before, After>(
  migration: RecordMigration<Before, After>,
  records: readonly Before[],
): After[] {
  return records.map((record) => migration.up(record));
}

/**
 * Applies `down` to every record. Pure; returns a new array.
 *
 * The rollback half. `migrateDown(m, migrateUp(m, rows))` must deep-equal
 * `rows`, and that assertion — against a fixture containing records, not
 * against an empty database — is the criterion this package discharges in place
 * of "rolled back against a database containing rows".
 */
export function migrateDown<Before, After>(
  migration: RecordMigration<Before, After>,
  records: readonly After[],
): Before[] {
  return records.map((record) => migration.down(record));
}

/**
 * Wraps a migration's `up` as a Dexie `.upgrade()` hook.
 *
 * This is the only place the pure functions meet the database. Dexie runs the
 * hook inside the `versionchange` transaction, so either every record is
 * rewritten or none is: a half-migrated store is not a state this can produce.
 *
 * `Collection.modify` is given a replacement rather than a set of field edits.
 * Assigning `ref.value` replaces the stored object wholesale, which is what
 * makes `up`'s return value the record — a field-by-field edit would leave any
 * key `up` dropped still on disk, and the round-trip test would still pass
 * because it never touches the database.
 */
export function upgradeWith<Before, After>(
  migration: RecordMigration<Before, After>,
): (transaction: Transaction) => Promise<void> {
  return async (transaction: Transaction): Promise<void> => {
    await transaction
      .table(migration.table)
      .toCollection()
      .modify((record: unknown, ref: { value: unknown }) => {
        ref.value = migration.up(record as Before);
      });
  };
}
