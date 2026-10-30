// SPDX-License-Identifier: Apache-2.0

/**
 * The errors this package throws, as distinct classes so a caller can tell a
 * rejected write from corrupted data from a broken invariant.
 *
 * **No error message in this file may carry a coordinate.** ADR 0004 decision D
 * puts location data out of scope for error messages specifically, because an
 * error string reaches a console, a crash report and a bug tracker. Messages
 * here name ids, field names and record kinds — never a latitude, a longitude,
 * or a privacy-zone centre.
 */

/** Base class, so `catch (e) { if (e instanceof StoreError) }` works. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A value offered to the store is not the thing it claims to be — an empty id,
 * a visibility outside the three permitted values, a negative duration.
 */
export class StoreValidationError extends StoreError {}

/**
 * A write would have left a record pointing at a parent that does not exist.
 *
 * IndexedDB has no foreign keys, so nothing below this package will refuse such
 * a write. This class exists because that refusal has to be implemented here or
 * it does not happen at all. See `docs/architecture.md` and the referential
 * behaviour note in `activity-store.ts`.
 */
export class StoreReferentialError extends StoreError {}

/**
 * A record read back out of IndexedDB is not a shape this package can decode.
 *
 * Distinct from `StoreValidationError` because the two mean different things to
 * an operator: a validation error is a caller bug, a decode error is data on
 * this device that has been corrupted, hand-edited, or written by a version of
 * the schema this build does not know about.
 */
export class StoreDecodeError extends StoreError {}

/**
 * A conditional write found the row it would replace changed since its caller
 * read it (#1263), so it wrote nothing.
 *
 * Not a fault: the caller read the row, waited on something else (a sync on
 * its network request), and meanwhile the rider changed or deleted the row
 * here. The rider's change stands, and the caller decides what that means.
 */
export class StoreConflictError extends StoreError {}

/**
 * The database on this device was written by a **newer** build than this one.
 *
 * IndexedDB itself refuses a downgrade — `indexedDB.open(name, olderVersion)`
 * raises `VersionError`, because `onupgradeneeded` fires only on an increase.
 * **Dexie 4.4.5 does not surface that refusal.** Opening a Dexie database whose
 * declared version is lower than the one on disk succeeds: `db.verno` reports
 * the declared version while the backing store is still at the newer one, and
 * every subsequent read runs the old code against the new records.
 *
 * That is the quiet half of this program's dominant defect shape — the open
 * reports success while what is read is not what the caller thinks it is. On a
 * device where the ride file may be the only copy in existence, it is worth an
 * explicit failure. `ActivityStore` checks for it on open and throws this.
 *
 * The supported way back is ADR 0005 section F's: export, downgrade, re-import.
 */
export class StoreVersionError extends StoreError {}

/**
 * A world corridor's `features` blob is larger than the store holds (#1545):
 * refused whole at the write, never truncated, so a corridor is either all of
 * what was read or not kept at all.
 *
 * The message names the limit and the size in bytes and nothing else. The
 * blob is features near the rider's route, which is location data (ADR 0054
 * D-6.6), so no coordinate and no tile's x/y may appear in it (ADR 0004 D).
 */
export class WorldCorridorTooLargeError extends StoreValidationError {
  readonly limitBytes: number;
  readonly sizeBytes: number;

  constructor(limitBytes: number, sizeBytes: number) {
    super(
      `worldCorridors.features: ${String(sizeBytes)} bytes is over the limit of ${String(limitBytes)} bytes`,
    );
    this.limitBytes = limitBytes;
    this.sizeBytes = sizeBytes;
  }
}
