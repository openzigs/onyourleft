// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Running the matcher over the local library (#66), in both directions, as a
 * job that can be stopped and resumed.
 *
 * #66 names two workflows and they are the same sweep with a different corpus:
 *
 * - a **new activity** is matched against every segment the device knows about;
 * - a **new segment** is backfilled against every activity already stored —
 *   which the issue notes the incumbent warns "may take several hours", *"so it
 *   is a background job with progress, not a request"*.
 *
 * ## What is here, and what is deliberately not
 *
 * The matching itself is `@onyourleft/domain`'s and runs identically on a device
 * and, from Phase 4 (#7), on an instance. This file is the part that cannot be:
 * reading the library a page at a time, deciding an effort's visibility from the
 * athlete's privacy zones, and writing a checkpoint so a killed tab does not
 * start over.
 *
 * ⚠️ **Never called from a render**, on the same rule as `analysis/history.ts`'s
 * backfill: a read path that writes is a read path whose cost nobody can state.
 * The screen offers a control and the rider decides when to pay for it.
 *
 * ⚠️ **It yields between activities rather than running to completion.**
 * {@link sweepLibrary} processes one page and returns; the caller loops. A
 * single `await` over a thousand rides holds the main thread for as long as it
 * takes and the tab stops painting — and there is nowhere else to put it, since
 * Web Bluetooth and IndexedDB rule out doing this in a worker today.
 */

import {
  createEffort,
  geographicPosition,
  indexCorpus,
  matchRide,
  unixSeconds,
  type GeographicPosition,
  type IndexedSegment,
  type PrivacyCircle,
  type RideTrace,
  type UnixSeconds,
} from '@onyourleft/domain';

import type {
  ActivityId,
  ActivitySummary,
  AthleteId,
  MatchCheckpointRecord,
  SegmentEffortRecord,
  SegmentRecord,
} from '@onyourleft/store';
import type { MatchStore } from './match-port';

/**
 * How many activities one sweep step covers before returning to the caller.
 *
 * ⚠️ **A latency budget, not a throughput one.** Each activity means decoding
 * two stream channels and running the matcher over them; at this size a step is
 * short enough that the tab keeps painting between steps, which is the whole
 * reason the sweep is stepped rather than looped internally. Raising it makes
 * the sweep marginally faster and the page perceptibly worse.
 */
export const SWEEP_PAGE_SIZE = 25;

/** What one step of the sweep did. */
export interface SweepStep {
  /** Activities covered by this step. */
  readonly swept: number;
  /** Efforts written by this step, across all of them. */
  readonly efforts: number;
  /** Activities the matcher started on and abandoned, with the reason. */
  readonly abandoned: readonly AbandonedNote[];
  /** Where to resume, or `undefined` when the library is exhausted. */
  readonly checkpoint: MatchCheckpointRecord | undefined;
  readonly done: boolean;
}

/**
 * Why one activity produced no effort on one segment.
 *
 * #66's fourth criterion: *"the reason is recorded on the activity so the
 * athlete can be told why rather than left guessing"*. A matcher that silently
 * returns fewer efforts is indistinguishable from a broken one, to the rider
 * and to whoever is debugging it.
 */
export interface AbandonedNote {
  readonly activityId: ActivityId;
  readonly segmentId: string;
  readonly reason: 'recording-gap';
}

/** Everything a sweep needs that it cannot read for itself. */
export interface SweepOptions {
  readonly athleteId: AthleteId;
  readonly store: MatchStore;
  /** The corpus to match against. Indexed once by the caller, not per step. */
  readonly corpus: readonly IndexedSegment[];
  /** Where to resume from. Absent starts at the beginning of the library. */
  readonly from?: MatchCheckpointRecord | undefined;
  readonly pageSize?: number;
}

/**
 * Index a corpus once, so a sweep does not redo it on every step.
 *
 * ⚠️ **No cast.** A `SegmentRecord` is assignable to the domain's `Segment`
 * because its branded `id` and `createdBy` are still strings — the brand
 * narrows, it does not change the shape. That is worth stating because the
 * first version of this line asserted the conversion, and an assertion here
 * would have gone on compiling if the two types ever genuinely diverged.
 */
export function indexSegments(segments: readonly SegmentRecord[]): IndexedSegment[] {
  return indexCorpus(segments);
}

/**
 * Match one page of the library, write the efforts, and say where to resume.
 *
 * ⚠️ **The efforts for an activity are written in one call**, replacing whatever
 * that activity had. That is what makes a resumed sweep produce the same count
 * as a clean one: an activity re-swept because the checkpoint was a page stale
 * is re-*written*, not doubled. `packages/store`'s `putActivityEfforts` is
 * where that happens and `schema.ts` explains why it is the replace rather than
 * the id that gives the property.
 */
export async function sweepLibrary(options: SweepOptions): Promise<SweepStep> {
  const { athleteId, store, corpus } = options;
  const pageSize = options.pageSize ?? SWEEP_PAGE_SIZE;

  if (corpus.length === 0) {
    return { swept: 0, efforts: 0, abandoned: [], checkpoint: undefined, done: true };
  }

  const page = await store.listActivitySummaries(athleteId, {
    orderBy: 'startedAt',
    direction: 'ascending',
    limit: pageSize,
    // A cursor rather than an offset. `packages/store` says why: an offset
    // shifts when an older ride is imported mid-sweep, which SKIPS an activity
    // rather than repeating one — and repeating is harmless here because the
    // write replaces, while skipping leaves a ride with no efforts and nothing
    // to say so.
    ...(options.from === undefined ? {} : { startedAfter: options.from.lastStartedAt }),
  });
  if (page.length === 0) {
    return { swept: 0, efforts: 0, abandoned: [], checkpoint: undefined, done: true };
  }

  const zones = await privacyCirclesFor(athleteId, store);
  const athlete = await store.getAthlete(athleteId);
  const attributes = athlete?.mass === undefined ? {} : { riderMass: athlete.mass };

  let efforts = 0;
  const abandoned: AbandonedNote[] = [];
  let last: ActivitySummary | undefined;

  for (const summary of page) {
    last = summary;
    const trace = await traceOf(athleteId, summary.id, store);
    if (trace === undefined) {
      // A ride with no positions — an indoor trainer session, which is most
      // rides in the v0.1 milestone. It matches nothing, and writing an empty
      // effort set for it is still correct: a re-sweep after the rider deleted
      // a segment has to be able to remove what it once found.
      await store.putActivityEfforts(athleteId, summary.id, []);
      continue;
    }

    const result = matchRide(trace, corpus);
    const found: SegmentEffortRecord[] = result.efforts.map(
      (effort) =>
        createEffort(effort, {
          activityId: summary.id,
          athleteId,
          positions: trace.positions,
          privacyZones: zones,
          attributes,
        }) as unknown as SegmentEffortRecord,
    );
    efforts += await store.putActivityEfforts(athleteId, summary.id, found);
    for (const note of result.abandoned) {
      abandoned.push({
        activityId: summary.id,
        segmentId: note.segmentId,
        reason: note.reason,
      });
    }
  }

  const done = page.length < pageSize;
  const checkpoint =
    last === undefined || done
      ? undefined
      : {
          athleteId,
          lastStartedAt: last.startedAt,
          lastActivityId: last.id,
          swept: (options.from?.swept ?? 0) + page.length,
          updatedAt: last.startedAt,
        };

  return { swept: page.length, efforts, abandoned, checkpoint, done };
}

/**
 * The athlete's privacy zones, reduced to what the effort model needs.
 *
 * `packages/domain` cannot name a `PrivacyZoneRecord` — the dependency points
 * the other way — so the label and the id stay here. That is also the safer
 * shape: a zone's label is the athlete's own word for where they live, and it
 * has no business travelling into a ranking computation.
 */
async function privacyCirclesFor(
  athleteId: AthleteId,
  store: MatchStore,
): Promise<readonly PrivacyCircle[]> {
  const zones = await store.listPrivacyZones(athleteId);
  return zones.map((zone) => ({ centre: zone.centre, radius: zone.radius }));
}

/**
 * One activity's positions and times, or `undefined` when it has no trace.
 *
 * ⚠️ **Two channels and one summary row, never the whole stream set.** Matching
 * needs where the rider was and when; decoding power, heart rate, cadence,
 * speed and temperature to find out whether they rode a hill is the cost this
 * port exists to refuse — the same rule `segments/store-port.ts` states for
 * creation.
 *
 * ## Where the times come from, and why a gap is visible at all
 *
 * A stream set has no time channel. Sample `i` is at
 * `startedAt + i * sampleInterval`, so the times are **derived from the index**
 * — which means a stored ride's timestamps are perfectly uniform and a recording
 * gap is *not* a jump in them.
 *
 * ⚠️ **A gap is a run of absent samples**, and it becomes a time jump here
 * precisely because this function drops them: skipping thirty absent positions
 * advances the derived time by thirty seconds while producing no sample, which
 * is what `matchRide`'s `GAP_SECONDS` check then sees. Reconstructing the times
 * as `0, 1, 2, …` over the *kept* samples instead would erase every gap in the
 * library and quietly bridge them — an effort whose elapsed time includes
 * minutes nobody recorded, which is #66's fourth criterion inverted.
 */
async function traceOf(
  athleteId: AthleteId,
  id: ActivityId,
  store: MatchStore,
): Promise<RideTrace | undefined> {
  const summary = await store.getStreamSetSummary(athleteId, id);
  if (summary === undefined) {
    return undefined;
  }
  const latitude = await store.getStreamChannel(athleteId, id, 'latitude');
  const longitude = await store.getStreamChannel(athleteId, id, 'longitude');
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  const positions: GeographicPosition[] = [];
  const times: UnixSeconds[] = [];
  for (let index = 0; index < summary.sampleCount; index += 1) {
    const at = latitude[index];
    const on = longitude[index];
    // Both halves or neither: a latitude with no longitude is not a position,
    // and pairing it with the next sample's longitude would invent one.
    if (at === undefined || on === undefined) {
      continue;
    }
    positions.push(geographicPosition(at, on));
    times.push(unixSeconds(summary.startedAt + index * summary.sampleInterval));
  }
  return positions.length === 0 ? undefined : { positions, times };
}
