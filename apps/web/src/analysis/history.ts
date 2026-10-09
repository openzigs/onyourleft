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
 * ⚠️ **The NEWEST {@link HISTORY_ACTIVITY_LIMIT} rides, then put in start
 * order** (#1130), so a truncation drops the *oldest* history rather than the
 * recent form the averages actually depend on. This comment said that from
 * #77 while the read took `direction: 'ascending'` — the OLDEST 5,000 — so a
 * rider past 5,000 rides saw a fitness line that stopped years ago. The
 * series is built in the order it is drawn, which is why the rows are
 * reversed rather than read ascending.
 */
export async function loadFitnessHistory(
  port: AnalysisPort,
  limit: number = HISTORY_ACTIVITY_LIMIT,
): Promise<FitnessHistory> {
  const summaries: ActivitySummary[] = await port.store.listActivitySummaries(port.athleteId, {
    orderBy: 'startedAt',
    direction: 'descending',
    limit: limit + 1,
  });
  const considered = summaries.slice(0, limit).reverse();
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
  /**
   * How many had no stream set stored, and were left as they were (#1084's
   * review). Such a ride may be a save still in progress from a tab running an
   * older bundle (ADR 0027), which writes the activity row first and its
   * streams after, so it is neither worked out nor marked: the next pass looks
   * at it again, and counts it here again. It costs one summary read and none
   * of {@link BACKFILL_BATCH}.
   */
  readonly noStreamsYet: number;
  /**
   * How many have not been looked at yet, so the caller can offer another
   * pass. A ride counted in {@link noStreamsYet} is not among them.
   */
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
 *
 * ⚠️ **Oldest first WITHIN the rides the chart reads** — the newest
 * {@link HISTORY_ACTIVITY_LIMIT} (#1130). Read from the oldest 5,000, as it
 * was, a rider past the bound could never have a ride the chart shows worked
 * out, and was offered the control for ever.
 */
export async function backfillLoadSummaries(
  port: AnalysisPort,
  batch: number = BACKFILL_BATCH,
): Promise<BackfillOutcome> {
  const summaries = (
    await port.store.listActivitySummaries(port.athleteId, {
      orderBy: 'startedAt',
      direction: 'descending',
      limit: HISTORY_ACTIVITY_LIMIT,
    })
  ).reverse();
  const missing = summaries.filter((summary) => needsLoadSummary(summary));

  let computed = 0;
  let nothingToWorkOut = 0;
  let noStreamsYet = 0;
  let looked = 0;
  // A ride with no stream set does not use up the batch: otherwise fifty of
  // them, oldest first, would stop every pass reaching a ride it could decode.
  for (const summary of missing) {
    if (computed + nothingToWorkOut >= batch) {
      break;
    }
    looked += 1;
    const found = await summariseOne(port, summary.id);
    if (found === 'computed') {
      computed += 1;
    } else if (found === 'nothing') {
      nothingToWorkOut += 1;
    } else {
      noStreamsYet += 1;
    }
  }
  return {
    computed,
    nothingToWorkOut,
    noStreamsYet,
    remaining: missing.length - looked,
  };
}

/**
 * Decode one ride and store its summary, or the marker when its streams hold
 * nothing a load could come from.
 *
 * A ride whose streams were read and gave nothing is **not** retried on the
 * next pass: it is marked with `summary.ts` §`NO_LOAD_TO_WORK_OUT`, which
 * `needsLoadSummary` reads as done (#1084). Until #1084 nothing was written,
 * so "not retried" was true of one pass only — every later pass decoded the
 * same ride and counted it as skipped again, and Home said its load was "not
 * worked out yet".
 *
 * ⚠️ **A ride with no stream set is NOT marked**, because the marker is
 * permanent and an absent read is not a final one. This build writes a ride's
 * summary (or the marker) on its activity row, so `needsLoadSummary` never
 * selects one of its own saves half-way. But a tab left on an older bundle
 * (ADR 0027) saves as builds before #1084 did — a bare activity row, then
 * `putStreamSet` — and a pass that ran between the two would have marked a
 * ride that has power or heart rate as having no load, for ever. So it is left
 * unmarked and answered `'no-streams'`: the next pass looks again, and the
 * backfill's report counts it apart (`BackfillOutcome.noStreamsYet`).
 */
async function summariseOne(
  port: AnalysisPort,
  id: ActivityId,
): Promise<'computed' | 'nothing' | 'no-streams'> {
  const streams = await port.store.getStreamSetSummary(port.athleteId, id);
  if (streams === undefined) {
    return 'no-streams';
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
    return 'nothing';
  }
  await port.store.setActivityLoadSummary(port.athleteId, id, summary);
  return 'computed';
}
