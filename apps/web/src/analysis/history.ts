// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reads the fitness-and-fatigue chart performs, and the bound on them (#77).
 *
 * ⚠️ **One store read for the whole history, and not one sample decoded.**
 * That is #77's seventh criterion in its literal form — *"rendering the full
 * history of a 1,000-activity library issues a bounded number of store reads,
 * asserted by a counter, and does not load stream data for any activity"* — and
 * `history.test.ts` counts both.
 *
 * It is affordable because a ride carries the threshold-independent half of its
 * load already; `summary.ts` records why the load itself is not stored. So the
 * whole chart is one `listActivitySummaries`, then arithmetic.
 *
 * ## The backfill is a separate, explicit act
 *
 * Rides imported before #77 carry no summary, so they cannot contribute. This
 * file offers {@link backfillLoadSummaries} to compute them — and it is
 * **never** called from a render. A read path that writes is a read path whose
 * cost nobody can state, and it would make the counter above meaningless. The
 * screen says how many rides are missing and offers a control; the rider
 * decides when to pay for it.
 */

import {
  dailyLoads,
  fitnessSeries,
  type FitnessPoint,
  type LoadBasis,
  type LoadEntry,
} from '@onyourleft/domain';
import type { ActivityId, ActivitySummary } from '@onyourleft/store';

import {
  hasNoLoadToWorkOut,
  loadFromSummary,
  loadSummaryOf,
  NO_LOAD_TO_WORK_OUT,
  needsLoadSummary,
} from './summary';
import type { AnalysisPort } from './store-port';
import { thresholdsFor } from './thresholds';

/**
 * How many rides the history reads.
 *
 * A stated bound, like `BESTS_ACTIVITY_LIMIT`. Ten years of riding five times a
 * week is about 2 600 rides, so this covers a long history and still refuses to
 * be unbounded — and unlike the personal-best read, each ride here costs a few
 * bytes of arithmetic rather than a channel decode.
 */
export const HISTORY_ACTIVITY_LIMIT = 5000;

/** What the chart shows, and what it rests on. */
export interface FitnessHistory {
  readonly points: readonly FitnessPoint[];
  /** How many rides contributed a load. */
  readonly ridesCounted: number;
  /**
   * How many rides carry no load summary and so contributed nothing.
   *
   * Surfaced rather than swallowed: a ride with no summary and a rest day are
   * different things, and the whole chart turns on that distinction. The screen
   * offers to compute them.
   *
   * ⚠️ Since #1084 it counts only rides the backfill could still work out: a
   * ride found to have nothing a load could come from is
   * {@link ridesWithNoLoad}, so the screen does not offer, for ever, to
   * measure a ride no pass can measure.
   */
  readonly ridesWithoutSummary: number;
  /**
   * How many rides have nothing a load could be worked out from (#1084) —
   * `summary.ts` §`hasNoLoadToWorkOut`. Not a rest day and not a ride waiting
   * to be measured: a ride with no load, which contributes nothing.
   */
  readonly ridesWithNoLoad: number;
  /**
   * Which bases the counted rides used.
   *
   * #77's eighth criterion: *"the chart states the load basis (power-derived,
   * HR-derived, mixed) rather than silently blending them"*. A set rather than
   * a single value, because a real history is usually mixed and saying "power"
   * would be false for part of the line.
   */
  readonly bases: readonly LoadBasis[];
  /** True when {@link HISTORY_ACTIVITY_LIMIT} cut the history short. */
  readonly truncated: boolean;
}

/**
 * The whole chart, from one list read.
 *
 * Rides are read oldest-first so the series is built in the order it is drawn,
 * and so a truncation drops the *oldest* history rather than the recent form
 * the averages actually depend on.
 */
export async function loadFitnessHistory(
  port: AnalysisPort,
  limit: number = HISTORY_ACTIVITY_LIMIT,
): Promise<FitnessHistory> {
  const summaries: ActivitySummary[] = await port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'ascending',
    limit: limit + 1,
  });
  const considered = summaries.slice(0, limit);
  const athlete = await port.store.getAthlete(port.athleteId);
  const thresholds = thresholdsFor(athlete);

  const entries: LoadEntry[] = [];
  const bases = new Set<LoadBasis>();
  let withoutSummary = 0;
  let withNoLoad = 0;
  for (const summary of considered) {
    const load = loadFromSummary(summary, thresholds);
    if (load === undefined) {
      if (hasNoLoadToWorkOut(summary)) {
        withNoLoad += 1;
      } else {
        withoutSummary += 1;
      }
      continue;
    }
    bases.add(load.basis);
    entries.push({
      startedAt: summary.startedAt,
      timeZone: summary.startedAtTimeZone,
      load: load.load,
    });
  }

  return {
    points: fitnessSeries(dailyLoads(entries)),
    ridesCounted: entries.length,
    ridesWithoutSummary: withoutSummary,
    ridesWithNoLoad: withNoLoad,
    bases: [...bases],
    truncated: summaries.length > limit,
  };
}

/** What one backfill pass did. */
export interface BackfillOutcome {
  /** Rides given a summary by this pass. */
  readonly computed: number;
  /**
   * Rides this pass found to have nothing a load could be worked out from — too
   * short, or no usable power or heart rate (#1084). Each is marked
   * (`summary.ts` §`NO_LOAD_TO_WORK_OUT`) as it is found, so no later pass
   * decodes it or counts it again.
   */
  readonly nothingToWorkOut: number;
  /** How many still have none afterwards, so the caller can offer another pass. */
  readonly remaining: number;
}

/**
 * How many rides one backfill pass decodes.
 *
 * Bounded so the control is *responsive* rather than fast: a rider who presses
 * it sees it finish and sees how many are left, instead of watching a frozen
 * screen while a decade of riding inflates. Pressing it again continues.
 */
export const BACKFILL_BATCH = 50;

/**
 * Compute the missing load summaries for up to {@link BACKFILL_BATCH} rides.
 *
 * ⚠️ **Called from a control, never from a render.** See the file header.
 *
 * Oldest first, so a rider who stops after one pass has filled in the part of
 * their history the averages need earliest — the chart builds forward from the
 * first ride, so a hole at the start affects every later point and a hole at
 * the end affects only itself.
 */
export async function backfillLoadSummaries(
  port: AnalysisPort,
  batch: number = BACKFILL_BATCH,
): Promise<BackfillOutcome> {
  const summaries = await port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'ascending',
    limit: HISTORY_ACTIVITY_LIMIT,
  });
  const missing = summaries.filter((summary) => needsLoadSummary(summary));

  let computed = 0;
  let nothingToWorkOut = 0;
  for (const summary of missing.slice(0, batch)) {
    const wrote = await summariseOne(port, summary.id);
    if (wrote) {
      computed += 1;
    } else {
      nothingToWorkOut += 1;
    }
  }
  return {
    computed,
    nothingToWorkOut,
    remaining: missing.length - computed - nothingToWorkOut,
  };
}

/**
 * Decode one ride and store its summary. `false` when it has no usable trace.
 *
 * A ride that cannot be summarised is **not** retried on the next pass: it is
 * marked with `summary.ts` §`NO_LOAD_TO_WORK_OUT`, which `needsLoadSummary`
 * reads as done (#1084). Until #1084 nothing was written, so "not retried" was
 * true of one pass only — every later pass decoded the same ride and counted
 * it as skipped again, and Home said its load was "not worked out yet". A
 * ride with no stream set at all is marked too: there is nothing to decode.
 * ⚠️ That cannot catch a save half-way: the activity row is written before
 * its streams (`recording/finish.ts`), but since #1084 that row carries its
 * summary or the marker from the moment it is written, so `needsLoadSummary`
 * never selects it. A ride the backfill sees with no stream set is one whose
 * streams were never written.
 */
async function summariseOne(port: AnalysisPort, id: ActivityId): Promise<boolean> {
  const streams = await port.store.getStreamSetSummary(port.athleteId, id);
  if (streams === undefined) {
    await port.store.setActivityLoadSummary(port.athleteId, id, NO_LOAD_TO_WORK_OUT);
    return false;
  }
  const power = streams.channels.includes('power')
    ? await port.store.getStreamChannel(port.athleteId, id, 'power')
    : undefined;
  // Heart rate is decoded only when power gave no summary — no channel, a trace
  // too short, or (#1070) one that read nought throughout. Asking whether power
  // was ABSENT, as this did, never reached the strap of a ride whose power
  // channel read 0 W, and that is the ride the backfill now has to redo.
  const fromPower =
    power === undefined ? undefined : loadSummaryOf({ power }, streams.sampleInterval);
  const heartRate =
    fromPower === undefined && streams.channels.includes('heartRate')
      ? await port.store.getStreamChannel(port.athleteId, id, 'heartRate')
      : undefined;

  const summary = fromPower ?? loadSummaryOf({ heartRate }, streams.sampleInterval);
  if (summary === undefined) {
    await port.store.setActivityLoadSummary(port.athleteId, id, NO_LOAD_TO_WORK_OUT);
    return false;
  }
  await port.store.setActivityLoadSummary(port.athleteId, id, summary);
  return true;
}
