// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bulk import: hundreds of files, one report, no file able to stop the rest.
 *
 * ## The failure this module exists to prevent
 *
 * A rider arriving from another platform has a bulk export: a directory of a
 * few hundred files somebody else wrote, spanning a decade of firmware. **One
 * of them will fail.** ADR 0009 chose file-based interoperability as this
 * project's entire interoperability surface, so this is the migration path in —
 * and an importer that stops at the first bad file turns a ten-year history
 * into "import failed" with no indication of which file, why, or what did land.
 *
 * So the contract is per file, and it is the whole of #51's first two
 * acceptance criteria:
 *
 * - every file gets its own outcome, **named by filename**;
 * - a failure is an outcome, not an exception, and the batch continues;
 * - what imported before a failure stays imported.
 *
 * ## Cancelling is not rolling back
 *
 * A rider who cancels half way through three hundred files wants the import to
 * *stop*, not to be undone: the hundred and fifty rides already on disk are
 * theirs and re-importing them would take as long again. So cancelling stops
 * the loop and the files not yet reached are reported as cancelled. Nothing is
 * deleted. #51's last criterion says exactly this, and
 * `import-batch.test.ts` asserts it by reading the imported rides back through
 * a **fresh** store connection after the cancellation.
 *
 * ## Deduplication is against the real local store
 *
 * `findActivityByOriginalFileHash` (#26) is the lookup, and it is athlete-scoped
 * by the store's own signature — there is no unscoped spelling to get wrong.
 * The id of an imported activity is **not** derived from the file's hash, and
 * that is deliberate: a hash-derived id would make a second import of the same
 * file overwrite the first *by primary key*, so the dedup check could be deleted
 * entirely and every "no duplicate" test would still pass. With a fresh id per
 * file, removing the check produces a second activity, which is what makes the
 * test in `import-batch.test.ts` a test.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { ActivityId, AthleteId, NewActivity } from '@onyourleft/store';

import {
  ActivityImportError,
  readActivityFile,
  type ImportFaultCode,
  type ImportedRide,
} from './read-activity-file';
import type { TransferStore } from './store-port';

/**
 * One file waiting to be imported.
 *
 * The bytes are **lazy**. A browser's `File` reads from disk on demand, and a
 * three-hundred-file archive read eagerly is every ride in memory at once — the
 * shape #127 removed from the FIT decoder, reintroduced one layer up. Nothing
 * here holds a file's bytes past its own iteration.
 */
export interface ImportSource {
  /** As the rider sees it in their archive, including any directory prefix. */
  readonly fileName: string;
  bytes(): Promise<Uint8Array>;
}

/** What became of one file. */
export type ImportOutcomeKind =
  /** A new ride is on disk. */
  | 'imported'
  /** These exact bytes are already imported; nothing was written. */
  | 'duplicate'
  /** Named, with a reason. The batch carried on. */
  | 'failed'
  /** The rider cancelled before this file was reached. Nothing was written. */
  | 'cancelled';

/** Why a file failed, beyond what the codec itself can say. */
export type ImportFailureCode =
  | ImportFaultCode
  /** The file could not be read off the disk at all. */
  | 'unreadable'
  /** It decoded, and the store refused or failed to hold it. */
  | 'not-stored';

/** One row of the import report. Always carries the filename. */
export interface ImportOutcome {
  readonly fileName: string;
  readonly kind: ImportOutcomeKind;
  /** The ride this file became, or the one it duplicates. */
  readonly activityId: ActivityId | undefined;
  /** One sentence, for a `failed` or `duplicate` row. */
  readonly reason: string | undefined;
  readonly code: ImportFailureCode | undefined;
  /**
   * What was wrong with a file that imported anyway — a truncated tail, a
   * coordinate out of range. Empty for a clean file.
   */
  readonly faults: readonly string[];
}

/** Where the batch has got to. Emitted after every file. */
export interface ImportProgress {
  /** Files finished, in any outcome. */
  readonly completed: number;
  readonly total: number;
  /** The outcome just recorded. */
  readonly outcome: ImportOutcome;
}

/** The whole batch, counted. */
export interface ImportReport {
  readonly outcomes: readonly ImportOutcome[];
  readonly imported: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly cancelled: number;
}

/** @see importActivityFiles */
export interface ImportBatchOptions {
  readonly sources: readonly ImportSource[];
  readonly store: TransferStore;
  readonly athleteId: AthleteId;
  newActivityId(): ActivityId;
  now(): UnixSeconds;
  digest(bytes: Uint8Array): Promise<string>;
  /**
   * The IANA zone written into every imported ride's `startedAtTimeZone`.
   *
   * ⚠️ **It is the importing device's zone, which for a ride recorded
   * elsewhere is a fallback and not a fact.** GPX and TCX carry UTC instants
   * and no zone at all; FIT's profile subset decoded here carries none either,
   * and the offset derivable from a local timestamp is an offset rather than an
   * IANA identifier. `startedAtTimeZone` is not optional (#26), so a ride
   * brought across from a holiday abroad renders in the zone of the machine
   * that imported it until a rider can correct it — which is its own issue.
   * The importer's zone is at least true of something and is the closest guess
   * available; `UTC` would assert a place the ride was not.
   */
  readonly timeZone: string;
  /** Aborting stops the loop between files. Nothing already written is undone. */
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: ImportProgress) => void) | undefined;
}

/**
 * Import every file, and report on every file.
 *
 * **Never throws for anything a file did.** The only exceptions that escape are
 * the ones that mean this client is broken rather than the archive.
 */
export async function importActivityFiles(options: ImportBatchOptions): Promise<ImportReport> {
  const outcomes: ImportOutcome[] = [];
  const total = options.sources.length;

  for (const source of options.sources) {
    // Checked at the top of the iteration, so the file being cancelled is one
    // that has not been written rather than one written and then reported as
    // cancelled — which would leave the report disagreeing with the disk.
    if (options.signal?.aborted === true) {
      outcomes.push({
        fileName: source.fileName,
        kind: 'cancelled',
        activityId: undefined,
        reason: 'cancelled before this file was reached; nothing was written for it',
        code: undefined,
        faults: [],
      });
      continue;
    }
    const outcome = await importOne(source, options);
    outcomes.push(outcome);
    options.onProgress?.({ completed: outcomes.length, total, outcome });
  }

  return {
    outcomes,
    imported: countOf(outcomes, 'imported'),
    duplicates: countOf(outcomes, 'duplicate'),
    failed: countOf(outcomes, 'failed'),
    cancelled: countOf(outcomes, 'cancelled'),
  };
}

function countOf(outcomes: readonly ImportOutcome[], kind: ImportOutcomeKind): number {
  return outcomes.filter((outcome) => outcome.kind === kind).length;
}

/**
 * One file, start to finish.
 *
 * ⚠️ **This is the `try` that keeps the batch alive**, and it is the mutation
 * `import-batch.test.ts` re-runs: removing it and letting the error propagate
 * turns three hundred files into one exception, which is the exact behaviour
 * #51's first criterion rejects.
 */
async function importOne(
  source: ImportSource,
  options: ImportBatchOptions,
): Promise<ImportOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = await source.bytes();
  } catch (error: unknown) {
    // Separate from a decode failure on purpose. "This file could not be read"
    // is a permission or a removed drive and the rider's next step is
    // different from "this file is not an activity file".
    return failure(source, 'unreadable', messageOf(error));
  }

  let sha256: string;
  let ride: ImportedRide;
  try {
    sha256 = await options.digest(bytes);
    ride = readActivityFile(source.fileName, bytes);
  } catch (error: unknown) {
    if (error instanceof ActivityImportError) {
      return failure(source, error.code, error.message);
    }
    return failure(source, 'unreadable', messageOf(error));
  }

  // The dedup read, and the two writes, are the part that can fail for reasons
  // that are about this device rather than about the file — a full disk, a
  // transaction aborted by a background tab. Reported as `not-stored` so the
  // report does not accuse the archive of something the browser did.
  try {
    const existing = await options.store.findActivityByOriginalFileHash(options.athleteId, sha256);
    if (existing !== undefined) {
      return {
        fileName: source.fileName,
        kind: 'duplicate',
        activityId: existing.id,
        reason: `already imported as “${existing.name}”; nothing was written`,
        code: undefined,
        faults: [],
      };
    }
    const activityId = await storeRide(options, source, ride, sha256);
    return {
      fileName: source.fileName,
      kind: 'imported',
      activityId,
      reason: undefined,
      code: undefined,
      faults: ride.faults,
    };
  } catch (error: unknown) {
    return failure(source, 'not-stored', messageOf(error));
  }
}

/**
 * Write the ride, then its streams — and undo the ride if the streams do not
 * land.
 *
 * The activity has to go down first: `putStreamSet` refuses a set whose
 * activity this athlete does not own, which is the store's write-path scoping
 * check and not something to work around. But that ordering has a trap, and it
 * is this module's version of "a write that reports success while the read
 * cannot see it": if the stream write fails, the activity row survives
 * **carrying the file's hash**, so re-importing the same file afterwards is
 * reported as a duplicate — of a ride with no data in it, which the rider can
 * now never import. Deleting the half-written activity is what makes a retry
 * work.
 */
async function storeRide(
  options: ImportBatchOptions,
  source: ImportSource,
  ride: ImportedRide,
  sha256: string,
): Promise<ActivityId> {
  const id = options.newActivityId();
  const record: NewActivity = {
    id,
    athleteId: options.athleteId,
    name: ride.name,
    startedAt: ride.startedAt,
    startedAtTimeZone: options.timeZone,
    elapsedTime: ride.elapsedTime,
    movingTime: ride.movingTime,
    distance: ride.distance,
    hasPosition: ride.hasPosition,
    ...(ride.averagePower === undefined ? {} : { averagePower: ride.averagePower }),
    // The key names the file this ride came from — `source.fileName`, the name
    // in the rider's archive, and **not** `ride.name`, which for GPX and TCX is
    // the `<name>` written inside the document and for FIT is derived from the
    // filename anyway. Those two differ for every XML file with a track name,
    // so the key that claimed to name a file was naming a ride. The hash is
    // what #26's `[athleteId+originalFileSha256]` index deduplicates on. Phase 1
    // keeps the reference and not the bytes — there is no original-file object
    // store yet — so re-exporting produces a file this client wrote rather than
    // the one the rider imported.
    originalFile: { key: source.fileName, sha256 },
    createdAt: options.now(),
  };
  // `visibility` is left unset deliberately: `putActivity` applies ADR 0004's
  // `private` default. An importer that chose a visibility would be choosing
  // one for somebody else's ten-year history.
  await options.store.putActivity(record);
  try {
    await options.store.putStreamSet({
      activityId: id,
      athleteId: options.athleteId,
      startedAt: ride.startedAt,
      sampleInterval: ride.sampleInterval,
      sampleCount: ride.sampleCount,
      channels: ride.channels,
    });
  } catch (error: unknown) {
    await options.store.deleteActivity(options.athleteId, id).catch(() => false);
    throw error;
  }
  return id;
}

function failure(source: ImportSource, code: ImportFailureCode, reason: string): ImportOutcome {
  return {
    fileName: source.fileName,
    kind: 'failed',
    activityId: undefined,
    reason,
    code,
    faults: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
