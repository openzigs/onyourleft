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
 * ## The registry, and its first entry
 *
 * `SCHEMA_MIGRATIONS` below was empty until schema version 13 (#800), and the
 * reason was honest: versions 2 to 12 added stores or indexes and changed no
 * record's shape, so there was nothing to transform and a `down` would have
 * been an identity function. Version 13 is the first that changes an existing
 * record — every side-camera report gains a **required** `pose` — so it is the
 * first entry, and `ActivityStore` is the first caller of {@link upgradeWith}.
 * `migrations.test.ts` rolls it back on a fixture and opens a real version-12
 * database with rows in it at version 13.
 */

import type { Transaction } from 'dexie';

import type { PersistedSideCameraReport, PersistedSideCameraReportV12 } from './persisted';
import { TABLE } from './schema';

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
 * Version 13 — #800: every side-camera report gains its pose summary field.
 *
 * `up` sets `pose: null` on every report written at version 12: none of them
 * kept a summary, because the owner's ruling to keep one (#795, ruling 1) came
 * after them. `null` is "this report keeps no pose summary", which is exactly
 * what they are — nothing is invented.
 *
 * ⚠️ **`down` drops the pose summary, and that is data loss the round trip
 * over version-12 rows cannot see.** A version-12 row has nowhere to hold one,
 * so a report kept at version 13 with a summary loses it on the way back; its
 * sentences survive. The runtime path back is still export → downgrade →
 * re-import (the file comment). Since #801 the account export carries the
 * summary (`export-everything.ts` §`ManifestPoseSummary`), so an export taken
 * before a downgrade still holds it.
 *
 * ⚠️ **Both halves are total over whatever is on disk, not only over the
 * declared shape** (#815's review). `up` runs inside Dexie's versionchange
 * transaction: a throw there aborts the upgrade and the database never opens,
 * so one hand-edited row whose `observations` is not an array would make every
 * ride on the device unreadable, with no downgrade to go back to. A malformed
 * value is therefore carried across unchanged, and that one report's read
 * fails with `StoreDecodeError` at version 13 exactly as it did at version 12.
 */
export const SIDE_REPORT_POSE_SUMMARY: RecordMigration<
  PersistedSideCameraReportV12,
  PersistedSideCameraReport
> = {
  toVersion: 13,
  table: TABLE.sideCameraReports,
  description:
    'gave every side-camera report a pose summary field, null for every report written before; down drops a kept summary',
  up(before: PersistedSideCameraReportV12): PersistedSideCameraReport {
    return {
      activityId: before.activityId,
      athleteId: before.athleteId,
      summary: before.summary,
      observations: copiedIfArray(before.observations),
      pose: null,
    };
  },
  down(after: PersistedSideCameraReport): PersistedSideCameraReportV12 {
    return {
      activityId: after.activityId,
      athleteId: after.athleteId,
      summary: after.summary,
      observations: copiedIfArray(after.observations),
    };
  },
};

/**
 * A copy of `value` when it is an array, and `value` itself when it is not.
 *
 * The rows a migration reads were written by an earlier build or edited by
 * hand, so their declared type is a claim rather than a fact; see
 * `SIDE_REPORT_POSE_SUMMARY` for why a migration must not throw on one.
 */
function copiedIfArray<T>(value: T[]): T[] {
  const onDisk: unknown = value;
  return Array.isArray(onDisk) ? [...(onDisk as T[])] : value;
}

/**
 * Every migration this build knows how to apply, in ascending `toVersion`.
 *
 * `ActivityStore` hands each one to Dexie as the `.upgrade()` of the version it
 * produces, so adding an entry here is the whole of wiring it in.
 */
export const SCHEMA_MIGRATIONS: readonly AnyRecordMigration[] = [SIDE_REPORT_POSE_SUMMARY];

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
