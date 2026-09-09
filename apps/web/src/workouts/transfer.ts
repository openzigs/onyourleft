// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Saving a workout to a file, and reading one back — #202,
 * [ADR 0017](../../../../docs/adr/0017-workout-file-format.md).
 *
 * ⚠️ **The format is `@onyourleft/domain`'s, not this screen's.** This module
 * reads a record, hands it over, and turns a refusal into a sentence — the same
 * division `routes/export.ts` keeps with `packages/fit`, and for the stronger
 * reason: a second encoder in the client would be a second answer to what a
 * workout file contains, and the one thing a format must not have is two.
 *
 * **Offline by construction, not by test double.** A workout leaves as a file
 * the rider downloads and arrives as a file they choose in a picker. There is
 * no network call on this path and there could not be: `packages/domain` cannot
 * name `fetch` at all — its tsconfig makes it a compile error — which is ADR
 * 0009 R5's *"every byte this product parses arrived from a file the user
 * chose"* holding without anybody having to check.
 */

import {
  decodeWorkoutFile,
  encodeWorkoutFile,
  unixSeconds,
  WORKOUT_FILE_EXTENSION,
  WORKOUT_FILE_MEDIA_TYPE,
  WorkoutError,
  type WorkoutErrorCode,
} from '@onyourleft/domain';
import type { AthleteId, WorkoutId, WorkoutRecord } from '@onyourleft/store';

import { safeFileStem } from '../transfer/export-activity';
import type { DownloadableFile } from '../transfer/store-port';

import { checkName } from './build';

/** Why an imported file could not become a workout. */
export interface WorkoutImportRefusal {
  /**
   * The domain's own code where the file was the problem, or one of this
   * module's two where it was not.
   *
   * `no-file` is a rider who pressed import without choosing anything;
   * `name-too-long` is a perfectly good file whose name will not fit a row, and
   * it is checked here rather than in the decoder because the length limit is
   * this library's convention and not the format's.
   */
  readonly code: WorkoutErrorCode | 'no-file' | 'name-too-long';
  readonly message: string;
}

export type WorkoutImportOutcome =
  | { readonly status: 'imported'; readonly record: WorkoutRecord }
  | { readonly status: 'refused'; readonly refusal: WorkoutImportRefusal };

export interface WorkoutImportInput {
  readonly id: WorkoutId;
  readonly owner: AthleteId;
  /** Seconds since the epoch. Injected, so the suite can assert what was written. */
  readonly now: number;
}

/**
 * Turn a saved workout into a file a rider can keep or send.
 *
 * ⚠️ **Cannot throw for anything this screen lists**, and that is worth saying
 * rather than defending against: `encodeWorkoutFile` validates, and a record
 * that would fail validation never reached the list — `workoutRow` expands
 * every row and `expandWorkout` validates, so an unridable row shows as a load
 * fault instead of a name with a button beside it.
 */
export function exportedWorkout(record: WorkoutRecord): DownloadableFile {
  const text = encodeWorkoutFile(record.workout);
  return {
    fileName: `${safeFileStem(record.name, 'workout')}${WORKOUT_FILE_EXTENSION}`,
    bytes: new TextEncoder().encode(text),
    mediaType: WORKOUT_FILE_MEDIA_TYPE,
  };
}

/**
 * Turn a file's text into a workout ready to save.
 *
 * Pure, and returns a refusal rather than throwing, for `SegmentsView.tsx`'s
 * rule: a screen that showed one thing and stored another would be lying in
 * whichever direction was convenient, and the way to stop that is for the
 * decision to be a value the screen renders and the test asserts.
 */
export function workoutFromFile(text: string, input: WorkoutImportInput): WorkoutImportOutcome {
  let decoded;
  try {
    decoded = decodeWorkoutFile(text);
  } catch (error) {
    if (error instanceof WorkoutError) {
      // The domain's messages are already sentences a rider can act on — they
      // were written that way because a rider meeting one through a bad file
      // and a developer meeting it through a bad literal are looking at the
      // same mistake. Rewording them here would make two wordings of one fault.
      return { status: 'refused', refusal: { code: error.code, message: error.message } };
    }
    throw error;
  }

  // The library's own convention, not the format's: an 80-character limit so a
  // name fits a row and a rider can tell two workouts apart. A file is entitled
  // to a longer one, and this is where it is refused rather than truncated —
  // truncating would save something the rider did not choose.
  const nameFault = checkName(decoded.name);
  if (nameFault !== undefined) {
    return {
      status: 'refused',
      refusal: { code: 'name-too-long', message: nameFault.message },
    };
  }

  return {
    status: 'imported',
    record: {
      id: input.id,
      createdBy: input.owner,
      name: decoded.name,
      workout: decoded,
      // Both stamped now: an import is a new workout on this device, whatever
      // the file's own history was. The format deliberately carries no
      // timestamps — see ADR 0017 D-2 — because a workout is a plan rather than
      // a thing that happened, and a "created" date copied from somebody else's
      // machine would sort a rider's library by a clock they never set.
      createdAt: unixSeconds(Math.floor(input.now)),
      updatedAt: unixSeconds(Math.floor(input.now)),
    },
  };
}
