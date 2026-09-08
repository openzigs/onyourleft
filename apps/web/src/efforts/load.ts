// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reads the effort-history screen performs, and the bound on them (#67).
 *
 * Two loads, split so the expensive one is only paid when a rider asks for it:
 *
 * 1. {@link loadHistory} — the segment, its efforts, and the name and date of
 *    the ride each was found in. **Not one sample decoded.** This is the whole
 *    list view, and it is what a rider looks at most days.
 * 2. {@link loadOverlay} — two efforts' progress, which needs latitude,
 *    longitude and a time base for **two** activities. Six reads, and only
 *    after the rider has picked two efforts to compare.
 *
 * `load.test.ts` counts the calls rather than trusting this comment.
 *
 * ## ⚠️ Where the sample indices come from, since the effort does not store any
 *
 * `SegmentEffortRecord` holds `startedAt` and `elapsed` and **no indices**, and
 * that is deliberate rather than an omission: an index is a position in whatever
 * the sample array happened to be, and a re-import that dropped one sample would
 * invalidate every stored index in the library while leaving them all
 * plausible.
 *
 * They are derivable instead, exactly, because a stream set's time base is
 * uniform by construction — sample `i` is at `startedAt + i * sampleInterval`
 * (`packages/store`'s `StreamSetSummary`). So the effort's own recorded instants
 * name its samples. {@link sampleIndexAt} is that arithmetic, and it is the one
 * place it happens.
 */

import { overlayEfforts, progressOf, unixSeconds } from '@onyourleft/domain';

import type { EffortComparison, GeographicPosition, UnixSeconds } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  SegmentEffortRecord,
  SegmentId,
  SegmentRecord,
  StreamSetSummary,
} from '@onyourleft/store';

import type { EffortPort } from './store-port';

/**
 * How many efforts one screen decodes: **200**.
 *
 * ⚠️ **A read budget, not a claim about how many a rider has.** Each row costs
 * one `getActivity` for the ride's name and date, so an athlete with a decade
 * on a commute segment would otherwise pay thousands of point lookups to render
 * a list nobody scrolls to the bottom of. The store returns them **fastest
 * first** (`[athleteId+segmentId+elapsed]`), so the truncated tail is the slow
 * end — the personal best and everything near it are never the part that is
 * cut.
 */
export const EFFORT_LIMIT = 200;

/** One row of the history: the effort, and what ride it came from. */
export interface EffortRow {
  readonly effort: SegmentEffortRecord;
  /** `undefined` when the ride has been deleted — see below. */
  readonly activity: ActivityRecord | undefined;
}

export interface EffortHistory {
  readonly segment: SegmentRecord;
  /** Ranked by `@onyourleft/domain`'s stated basis; the first is the personal best. */
  readonly rows: readonly EffortRow[];
  /** True when the store had more than {@link EFFORT_LIMIT}, so the screen can say so. */
  readonly truncated: boolean;
}

/**
 * The segment and its efforts, or `undefined` when this athlete has no such
 * segment.
 *
 * `undefined` covers both "no such id" and "that segment belongs to somebody
 * else", and deliberately does not distinguish them — the same rule the rest of
 * this client follows, because telling them apart answers "does athlete B have
 * a segment with this id" to athlete A.
 */
export async function loadHistory(
  port: EffortPort,
  id: SegmentId,
): Promise<EffortHistory | undefined> {
  const segment = await port.store.getSegment(port.athleteId, id);
  if (segment === undefined) {
    return undefined;
  }

  // One more than the budget, so "there are more" is observed rather than
  // inferred from a full page — which would claim truncation on a library that
  // happens to hold exactly the limit.
  const efforts = await port.store.listEfforts(port.athleteId, id, EFFORT_LIMIT + 1);
  const truncated = efforts.length > EFFORT_LIMIT;
  const kept = truncated ? efforts.slice(0, EFFORT_LIMIT) : efforts;

  const rows: EffortRow[] = [];
  for (const effort of kept) {
    // ⚠️ An absent activity is a row, not a skip. #66 cascades efforts when a
    // ride is deleted, so this should not happen — and if it ever does, a
    // silently shorter list is the worst way to find out.
    const activity = await port.store.getActivity(port.athleteId, effort.activityId);
    rows.push({ effort, activity });
  }

  return { segment, rows, truncated };
}

/**
 * The sample index of an instant in a stream set.
 *
 * Rounded rather than floored: the instants stored on an effort came *from*
 * this grid, so the division is exact up to floating-point noise, and flooring
 * would turn `41.999999` into sample 41.
 *
 * @returns a clamped index, so a corrupt or mismatched instant produces the
 * nearest real sample rather than an out-of-range read the caller has to guard.
 */
export function sampleIndexAt(summary: StreamSetSummary, instant: UnixSeconds): number {
  if (summary.sampleInterval <= 0) {
    return 0;
  }
  const raw = Math.round((instant - summary.startedAt) / summary.sampleInterval);
  return Math.max(0, Math.min(summary.sampleCount - 1, raw));
}

/** What {@link loadOverlay} returns, or the reason it could not. */
export type OverlayResult =
  | { readonly kind: 'comparison'; readonly comparison: EffortComparison }
  | { readonly kind: 'no-track'; readonly missing: readonly ActivityId[] };

/**
 * Two efforts' progress, compared.
 *
 * ⚠️ **Six reads, and never a whole stream set**: one summary and two channels
 * per activity. A rider comparing two efforts from the *same* ride still costs
 * six rather than three — the two reads are not deduplicated, deliberately,
 * because the saving is one point lookup and the branch that would save it is a
 * second code path through the part of this file that has to be right.
 *
 * @returns `no-track` naming the activities that had no position stream, which
 * the screen renders as a sentence rather than an empty chart. An indoor ride
 * is the ordinary case for it and most rides in the v0.1 milestone are indoor.
 */
export async function loadOverlay(
  port: EffortPort,
  first: SegmentEffortRecord,
  second: SegmentEffortRecord,
): Promise<OverlayResult> {
  const [a, b] = await Promise.all([traceOf(port, first), traceOf(port, second)]);
  const missing: ActivityId[] = [];
  if (a === undefined) {
    missing.push(first.activityId);
  }
  if (b === undefined) {
    missing.push(second.activityId);
  }
  if (a === undefined || b === undefined) {
    return { kind: 'no-track', missing };
  }
  return { kind: 'comparison', comparison: overlayEfforts(a, b) };
}

/** One effort's progress series, from the ride it was found in. */
async function traceOf(
  port: EffortPort,
  effort: SegmentEffortRecord,
): Promise<ReturnType<typeof progressOf> | undefined> {
  const summary = await port.store.getStreamSetSummary(port.athleteId, effort.activityId);
  if (summary === undefined) {
    return undefined;
  }
  const [latitude, longitude] = await Promise.all([
    port.store.getStreamChannel(port.athleteId, effort.activityId, 'latitude'),
    port.store.getStreamChannel(port.athleteId, effort.activityId, 'longitude'),
  ]);
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  const positions: (GeographicPosition | undefined)[] = [];
  const times: UnixSeconds[] = [];
  for (let index = 0; index < summary.sampleCount; index += 1) {
    const at = latitude[index];
    const on = longitude[index];
    positions.push(
      at === undefined || on === undefined ? undefined : { latitude: at, longitude: on },
    );
    times.push(unixSeconds(summary.startedAt + index * summary.sampleInterval));
  }

  const from = sampleIndexAt(summary, effort.startedAt);
  const to = sampleIndexAt(summary, unixSeconds(effort.startedAt + effort.elapsed));

  // Absent samples are dropped and their times go with them, so the elapsed
  // clock still advances across a gap — the same rule `segments/backfill.ts`
  // states, and the reason a gap is visible at all rather than bridged.
  const keptPositions: GeographicPosition[] = [];
  const keptTimes: UnixSeconds[] = [];
  for (let index = from; index <= to; index += 1) {
    const position = positions[index];
    const time = times[index];
    if (position === undefined || time === undefined) {
      continue;
    }
    keptPositions.push(position);
    keptTimes.push(time);
  }
  if (keptPositions.length === 0) {
    return undefined;
  }
  return progressOf(effort.id, keptPositions, keptTimes, 0, keptPositions.length - 1);
}
