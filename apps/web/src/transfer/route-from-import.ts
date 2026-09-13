// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning a file the **Files** screen was handed into a **route** — #232.
 *
 * ## Why this exists at all
 *
 * A `.gpx` means two things in this product and there are two importers on two
 * different screens. "Files" is the natural place to look for "import a file"
 * and it is the wrong one for a downloaded course: the Files importer makes an
 * *activity* — a ride you already did — and the Trainer game rides a *route*.
 * A rider who took the wrong one used to have to go and find the file again.
 *
 * This is the one action that closes that, and #232 requires it to work in
 * **either** direction: a file wrongly flagged as a course is still imported as
 * a ride and the rider ignores a sentence, and a file wrongly *not* flagged is
 * still one click from a route, because `TransferView` offers this on every GPX
 * it read rather than only on the flagged ones. `course-shaped.ts` decides the
 * sentence; it does not decide the offer.
 *
 * ## The file is re-read, not retained
 *
 * `ImportSource.bytes()` is lazy and stays lazy — `import-batch.ts`'s header
 * says why, and a three-hundred-file archive held in memory so that one of them
 * *might* become a route would undo it. A browser's `File` reads from disk on
 * demand and the handle outlives the batch, so "without re-finding the file"
 * costs a second read of one file rather than retaining three hundred.
 *
 * ## GPX only, and that is the format and not a shortcut
 *
 * `routes/save.ts` reads GPX and nothing else, so this does too. A FIT or TCX
 * file carries no verdict from `course-shaped.ts` either, which is what keeps
 * the screen from offering something it cannot do.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import type { AthleteId, RouteId, RouteRecord } from '@onyourleft/store';

import { routeFromGpx } from '../routes/save';
import { courseNote } from './course-shaped';
import type { ImportOutcome, ImportSource } from './import-batch';
import type { CourseStore } from './store-port';

/** One file the screen can offer to turn into a route, and what to say about it. */
export interface CourseOffer {
  readonly source: ImportSource;
  /** Present only when `course-shaped.ts` flagged it. @see courseNote */
  readonly note: string | undefined;
}

/**
 * Which of the files just run can be offered as routes, and what to say.
 *
 * ⚠️ **Every GPX that decoded is offered, flagged or not.** The verdict decides
 * the *sentence* and never the *offer* — #232 requires a wrong guess in either
 * direction to be recoverable in one action, and an offer gated on the verdict
 * would make a false negative unrecoverable.
 *
 * @param sources the files handed to the batch, in the order they were handed.
 * @param outcomes what the batch reported, one per source in the same order —
 * `importActivityFiles` pushes exactly one row per file and never reorders. The
 * filenames are compared anyway rather than trusted, because the cost of that
 * invariant quietly breaking is a button that writes the wrong file's line into
 * a rider's routes, and the cost of checking it is one comparison per row.
 */
export function courseOffers(
  sources: readonly ImportSource[],
  outcomes: readonly ImportOutcome[],
): readonly CourseOffer[] {
  const offers: CourseOffer[] = [];
  for (const [index, source] of sources.entries()) {
    const outcome = outcomes[index];
    if (outcome === undefined || outcome.fileName !== source.fileName) {
      continue;
    }
    // `undefined` is "there was no decoded GPX behind this row" — a FIT file, a
    // spreadsheet, a document that would not parse. Nothing to offer.
    if (outcome.course === undefined) {
      continue;
    }
    offers.push({ source, note: courseNote(outcome.course) });
  }
  return offers;
}

/** What became of the attempt. Always a message the rider can act on. */
export type CourseImportOutcome =
  | { readonly status: 'saved'; readonly record: RouteRecord }
  | { readonly status: 'refused'; readonly message: string };

/** What a rider is told when the file could not be read off the disk again. */
export const COURSE_UNREADABLE =
  'That file could not be read from your device a second time. Choose it again and retry.';

/** What a rider is told when the file read and the route could not be stored. */
export const COURSE_NOT_SAVED =
  'That file is a route, and this device could not save it. Nothing has been written.';

/** @see routeFromImportedFile */
export interface RouteFromImportOptions {
  readonly source: ImportSource;
  readonly store: CourseStore;
  readonly owner: AthleteId;
  /** A fresh id. Passed in for the reason every other id in this screen is. */
  readonly id: RouteId;
  /** Passed in rather than read: this module consults no clock. */
  readonly now: UnixSeconds;
}

/**
 * Read one file again and save it as a route, or say why not.
 *
 * **Never throws.** Every failure a file or a device can produce comes back as
 * a `refused` outcome carrying a sentence, for `importActivityFiles`'s reason:
 * this is called from a click handler on a screen that has just finished
 * reporting on three hundred files, and an exception there replaces a report
 * with a blank page.
 *
 * ⚠️ **The route is `private`, and there is no parameter here that could make
 * it anything else.** `routeFromGpx` applies ADR 0004 decision A and #73's
 * fourth criterion, and a route arriving by this path is a route arriving the
 * same way as any other.
 */
export async function routeFromImportedFile(
  options: RouteFromImportOptions,
): Promise<CourseImportOutcome> {
  let text: string;
  try {
    const bytes = await options.source.bytes();
    // `fatal: true`, like `readActivityFile`'s XML arm: bytes that are not
    // valid UTF-8 make a file whose text cannot be believed rather than a file
    // with an odd character in it.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { status: 'refused', message: COURSE_UNREADABLE };
  }

  const outcome = routeFromGpx(text, {
    id: options.id,
    owner: options.owner,
    fileName: options.source.fileName,
    now: unixSeconds(Math.floor(options.now)),
  });
  if (outcome.status === 'refused') {
    // The importer's own message names the problem — "no route points", "no
    // elevation anywhere" — so it is passed through rather than replaced.
    return { status: 'refused', message: outcome.refusal.message };
  }

  try {
    await options.store.putRoute(outcome.record);
  } catch {
    // Reported as this device's failure rather than the file's, the same split
    // `import-batch.ts` draws between `undecodable` and `not-stored`: the
    // rider's next step differs, and blaming the file would send them looking
    // for a defect that is ours.
    return { status: 'refused', message: COURSE_NOT_SAVED };
  }
  return { status: 'saved', record: outcome.record };
}
