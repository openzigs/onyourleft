// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Running the sweep — the production caller `backfill.ts` never had (#282).
 *
 * ## What was wrong, and what it looked like
 *
 * ⚠️ **Nothing in the client ever ran the segment matcher, so no segment effort
 * had ever been written.** `packages/domain`'s matcher, {@link sweepLibrary}'s
 * resumable page loop and `packages/store`'s `putActivityEfforts` were all
 * built, tested and green; `main.tsx` never constructed a `MatchPort` and
 * nothing called any of them. `SegmentDetailView` and `efforts/load.ts` read a
 * table only a test had ever filled, so a rider who made a segment (#64) saw an
 * empty history on it for ever. #278's wiring gate is what found it.
 *
 * This module is the missing half: it indexes the corpus once, drives
 * {@link sweepLibrary} page by page, and is **the only production writer of the
 * match checkpoint** — which is why `getMatchCheckpoint`, `putMatchCheckpoint`
 * and `clearMatchCheckpoint` exist on `MatchStore` at all.
 *
 * ## When a sweep runs, which #282 asks to be decided rather than wired
 *
 * **On a control the rider presses, and nowhere else.** That was already
 * decided twice in the two files being wired here, and this only carries it
 * out:
 *
 * - `backfill.ts`: *"Never called from a render… a read path that writes is a
 *   read path whose cost nobody can state. The screen offers a control and the
 *   rider decides when to pay for it."*
 * - `recording/finish.ts`: *"It does not run the segment matcher… Matching
 *   inline would put a bounded-time sweep on the end of the one action a rider
 *   takes while sweaty and impatient."*
 *
 * `analysis/history.ts`'s load backfill is the same shape and the precedent for
 * the wording on screen. ⚠️ **The cost is real and is stated on the screen
 * rather than left to be discovered**: a ride you have just recorded shows no
 * effort until the sweep is run. That is the trade for never putting an
 * unbounded decode between "stop" and "saved".
 *
 * ⚠️ **A segment created *while* a sweep is part-done is not matched against
 * the rides that sweep has already passed** — the checkpoint is a cursor and
 * knows nothing about the corpus. It is picked up by the next sweep, because a
 * sweep that reaches the end of the library clears the cursor and the one after
 * it starts from the beginning. A stale cursor cannot corrupt anything: the
 * effort id is derived and the write replaces, which is `packages/store`'s
 * `putActivityEfforts` doing the work rather than this file.
 */

import type { IndexedSegment } from '@onyourleft/domain';

import { indexSegments, sweepLibrary, type AbandonedNote } from './backfill';
import type { MatchPort } from './match-port';

/**
 * How many activities one press covers: **100**.
 *
 * Bounded so the control is *responsive* rather than fast, which is
 * `analysis/history.ts` §`BACKFILL_BATCH`'s reason word for word: a rider who
 * presses it sees it finish and sees that there is more to do, instead of
 * watching a frozen screen while a decade of riding is decoded. Four pages of
 * {@link sweepLibrary} at its own `SWEEP_PAGE_SIZE`, and pressing again
 * continues from the checkpoint this module wrote.
 */
export const SWEEP_ACTIVITY_BUDGET = 100;

/**
 * How many segments one sweep will match against: **1000**.
 *
 * ⚠️ **A truncated corpus would DELETE efforts rather than merely miss them**,
 * which is why exceeding this refuses the sweep instead of matching the first
 * thousand. `putActivityEfforts` replaces an activity's whole effort set — that
 * replace is what makes a re-sweep idempotent (#66's fifth criterion) — so a
 * sweep run against a corpus missing a segment removes every effort that
 * segment ever had. A bound that silently drops rows is safe for a *read*
 * budget and is not safe here.
 *
 * It is set far above any plausible corpus rather than tuned: a rider with a
 * thousand segments is already past what this screen's list shows, and the
 * refusal is a sentence rather than a crash.
 */
export const SWEEP_CORPUS_LIMIT = 1000;

/** What one press of the control did. */
export interface SweepOutcome {
  /** Activities this press covered. */
  readonly swept: number;
  /** Efforts written across them. */
  readonly efforts: number;
  /**
   * Activities the matcher started on a segment and abandoned, with the reason.
   *
   * #66's fourth criterion: the reason is carried out to where the athlete can
   * be told, rather than a silently shorter list of efforts.
   */
  readonly abandoned: readonly AbandonedNote[];
  /** How many segments the library was matched against. */
  readonly segments: number;
  /** `false` when {@link SWEEP_ACTIVITY_BUDGET} stopped it; pressing again continues. */
  readonly done: boolean;
}

/**
 * What {@link matchLibrary} did, or why it did nothing.
 *
 * A union rather than a `SweepOutcome` with zeroes in it: "there are no
 * segments yet" and "every ride matched nothing" are different sentences to a
 * rider, and a zero-valued outcome cannot tell them apart.
 */
export type SweepResult =
  | ({ readonly kind: 'swept' } & SweepOutcome)
  | { readonly kind: 'no-segments' }
  | { readonly kind: 'too-many-segments'; readonly limit: number; readonly found: number };

/**
 * What one press is reported as, in a sentence addressed to a rider.
 *
 * Here rather than in the view, on `create.ts`'s rule: a sentence lives beside
 * the rule that produces it, so a refusal cannot be reworded into something the
 * code does not do. It is also what makes the wording mutation-testable without
 * a DOM.
 */
export function sweepSentence(result: SweepResult): string {
  if (result.kind === 'no-segments') {
    return (
      'There is nothing to match your rides against yet. Make a segment above, then run this ' +
      'again.'
    );
  }
  if (result.kind === 'too-many-segments') {
    return (
      `This device holds ${String(result.found)} segments, which is more than the ` +
      `${String(result.limit)} one sweep can match at once. Nothing was matched — a sweep ` +
      'carrying only some of them would delete the efforts on the rest.'
    );
  }
  const rides = `${String(result.swept)} ${result.swept === 1 ? 'ride' : 'rides'}`;
  const segments = `${String(result.segments)} ${result.segments === 1 ? 'segment' : 'segments'}`;
  const efforts = `${String(result.efforts)} ${result.efforts === 1 ? 'effort' : 'efforts'}`;
  return result.done
    ? `Matched ${rides} against ${segments} and found ${efforts}.`
    : `Matched ${rides} against ${segments} so far and found ${efforts}. Press again to carry on.`;
}

/**
 * What to tell a rider about the traversals the matcher gave up on, if any.
 *
 * #66's fourth criterion carried the last step: *"the reason is recorded on the
 * activity so the athlete can be told why rather than left guessing"*. Counted
 * by **activity** rather than by note, because two segments abandoned in one
 * ride are one hole in one recording and "2 rides" would be untrue.
 *
 * @returns `undefined` when nothing was abandoned, so the caller renders
 * nothing rather than a sentence saying zero.
 */
export function abandonedSentence(abandoned: readonly AbandonedNote[]): string | undefined {
  const rides = new Set(abandoned.map((note) => note.activityId));
  if (rides.size === 0) {
    return undefined;
  }
  return (
    `A gap in the recording ran through a segment on ${String(rides.size)} ` +
    `${rides.size === 1 ? 'ride' : 'rides'}, so no time could be taken for ` +
    `${rides.size === 1 ? 'it' : 'them'}. That is the recording, not the segment.`
  );
}

/** Everything {@link matchLibrary} needs beyond the port. All optional. */
export interface MatchLibraryOptions {
  /** Activities before this press stops. @see SWEEP_ACTIVITY_BUDGET */
  readonly budget?: number;
  /** Segments before this press refuses. @see SWEEP_CORPUS_LIMIT */
  readonly corpusLimit?: number;
  /**
   * Activities per page, passed straight through to {@link sweepLibrary}.
   *
   * A pass-through rather than a second policy: the page is what a checkpoint
   * is written after, so the two numbers belong to whoever is deciding how long
   * one press may hold the tab. `backfill.ts` §`SWEEP_PAGE_SIZE` is the default
   * and states why it is a latency budget rather than a throughput one.
   */
  readonly pageSize?: number;
}

/**
 * Match this athlete's library against their segments, resuming where the last
 * press stopped.
 *
 * ⚠️ **Called from a control, never from a render.** See the file header.
 *
 * The checkpoint is written after **every** page and cleared only when the
 * library is exhausted, so a tab closed mid-sweep resumes rather than starting
 * over — and a sweep that finished starts the next one from the beginning,
 * which is what lets a segment made since then find its efforts in rides the
 * previous sweep had already been past.
 */
export async function matchLibrary(
  port: MatchPort,
  options: MatchLibraryOptions = {},
): Promise<SweepResult> {
  const corpusLimit = options.corpusLimit ?? SWEEP_CORPUS_LIMIT;
  // One more than the limit, so "exactly at the limit" and "over it" are told
  // apart by the read rather than by a count that has already been truncated.
  const segments = await port.store.listSegments(port.athleteId, corpusLimit + 1);
  if (segments.length === 0) {
    return { kind: 'no-segments' };
  }
  if (segments.length > corpusLimit) {
    return { kind: 'too-many-segments', limit: corpusLimit, found: segments.length };
  }

  const corpus: readonly IndexedSegment[] = indexSegments(segments);
  const budget = options.budget ?? SWEEP_ACTIVITY_BUDGET;

  let cursor = await port.store.getMatchCheckpoint(port.athleteId);
  let swept = 0;
  let efforts = 0;
  const abandoned: AbandonedNote[] = [];

  for (;;) {
    const step = await sweepLibrary({
      athleteId: port.athleteId,
      store: port.store,
      corpus,
      ...(cursor === undefined ? {} : { from: cursor }),
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
    });
    swept += step.swept;
    efforts += step.efforts;
    abandoned.push(...step.abandoned);

    const next = step.checkpoint;
    if (step.done || next === undefined) {
      // Finishing IS clearing the cursor. Leaving it behind would make the next
      // press resume at the end of the library and sweep nothing, which is how
      // a segment made tomorrow would never find yesterday's rides.
      await port.store.clearMatchCheckpoint(port.athleteId);
      return { kind: 'swept', swept, efforts, abandoned, segments: segments.length, done: true };
    }

    // Written BEFORE the budget is tested, so the work this press did is
    // durable whether it stops here or carries on. A checkpoint written only
    // on the way out is a checkpoint a closed tab never gets.
    await port.store.putMatchCheckpoint(next);
    cursor = next;

    if (swept >= budget) {
      return { kind: 'swept', swept, efforts, abandoned, segments: segments.length, done: false };
    }
  }
}
