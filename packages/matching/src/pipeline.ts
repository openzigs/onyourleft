// SPDX-License-Identifier: Apache-2.0

/**
 * The spike's matcher (#65, candidate 1): **coarse prefilter → endpoint gate →
 * curve similarity on survivors**.
 *
 * ⚠️ **Throwaway.** #65's deliverable is a recommendation and a measurement,
 * not production code. #66 either hardens this or deletes it, and the write-up
 * at `docs/spikes/0001-segment-matching.md` is the thing that outlives it.
 *
 * ## What it does INSTEAD of an oriented virtual start line
 *
 * #65's sixth criterion asks for this in the write-up, and it is stated here
 * too because this is the file somebody would have to change to break it.
 *
 * An effort begins when a **recorded sample** lies within the segment start's
 * tolerance radius *and* that sample's own direction of travel — computed from
 * the sample before it — agrees with the start's recorded direction to within
 * an angular tolerance. It ends the same way at the finish. Two scalar
 * comparisons per sample, from `@onyourleft/domain`'s `endpointReached`, which
 * is #64's production code reused unchanged rather than reimplemented here.
 *
 * There is **no line**: nothing computes a path through a user-selected point,
 * takes its orientation, and sets a line in relation to that orientation
 * (ADR 0007 D-2.1, US 9,116,922's four independent claims). There is **no
 * extrapolation**: the scan sees one recorded sample at a time and has nowhere
 * to put a synthesised intermediate point (D-2.2). There is **no two-tier
 * loose/tight match**: one similarity criterion with one threshold, and it is
 * a Fréchet distance rather than a pair of line crossings (D-2.3,
 * US 9,208,175). And nothing here discards a stored segment (D-2.4).
 *
 * ## Every threshold below is our own tunable
 *
 * #65's last criterion, and it is not a formality: **no numeric tolerance is
 * published by any other product** — not an endpoint radius, not a gap
 * threshold. Each constant carries its own reasoning and none of them is
 * parity with anything.
 */

import {
  distanceBetween,
  endpointReached,
  sampleHeading,
  type GeographicPosition,
  type Segment,
} from '@onyourleft/domain';

import { cellCover, coversIntersect, type CellId } from './grid';
import { discreteFrechet } from './frechet';

/**
 * How close the ride's path must stay to the segment's, in metres: **25**.
 *
 * ⚠️ **Our own tunable.** The number that decides the false-positive rate, and
 * the one a tuning exercise makes worse rather than better — #65's third
 * criterion is about exactly this. The two-sided reasoning:
 *
 * - **Not larger.** A road and the cycleway beside it are commonly 15–25 m
 *   apart. At 40 m the matcher reports efforts on a segment the rider was never
 *   on, which is the failure that destroys a leaderboard's credibility, and no
 *   amount of downstream care recovers from it.
 * - **Not smaller.** Consumer GNSS horizontal error is commonly quoted at 3–5 m
 *   under open sky and degrades badly under tree cover and beside buildings.
 *   At 10 m an honest traversal through a built-up section misses, and the
 *   rider is told nothing about why.
 *
 * `frechet-corpus.test.ts` measures the miss rate this produces rather than
 * asserting it is acceptable, which is #65's fourth criterion.
 */
export const SIMILARITY_METRES = 25;

/**
 * How long a hole in the recording may be before an effort is abandoned:
 * **20 seconds**.
 *
 * ⚠️ **Our own tunable**, and the one whose absence elsewhere is most
 * conspicuous: Strava's documentation names a "Gap Threshold" and publishes no
 * number for it. Ours is derived rather than guessed. A device recording every
 * 10 s — the slowest smart-recording interval in common use — produces a
 * legitimate 10 s spacing, so the threshold has to sit above that or every such
 * ride is one long gap. Twice that leaves room for one dropped sample and
 * refuses two.
 *
 * The consequence is stated rather than hidden: **an effort spanning a longer
 * hole is not reported at all**, because the alternative is reporting a time
 * that includes a period nobody measured. `pipeline.test.ts` pins that a
 * segment crossing a gap yields no effort — #65's fourth hard case.
 */
export const GAP_SECONDS = 20;

/** A ride, as the matcher sees it: positions and the time of each. */
export interface RideTrace {
  readonly positions: readonly GeographicPosition[];
  /** Seconds since the ride started, one per position. Strictly increasing. */
  readonly times: readonly number[];
}

/** One traversal of one segment. */
export interface Effort {
  readonly segmentId: string;
  /** Index into the ride of the sample that opened the effort. */
  readonly startIndex: number;
  readonly endIndex: number;
  /**
   * Elapsed seconds, from the **nearest recorded samples**.
   *
   * ⚠️ Not an interpolated crossing time, and that is a constraint rather than
   * a preference — ADR 0007 D-2.2 forbids synthesising a point to decide a
   * crossing, and a crossing time derived from a synthesised point is the same
   * construct wearing a clock. `tools/measure.ts` quantifies what it costs;
   * the write-up states the number.
   */
  readonly elapsedSeconds: number;
  /** How far the ride strayed from the segment, in metres. Below the threshold. */
  readonly similarityMetres: number;
}

/** What each stage of the pipeline let through. #65's second criterion. */
export interface StageCounts {
  readonly corpus: number;
  readonly afterPrefilter: number;
  readonly afterEndpointGate: number;
  readonly afterSimilarity: number;
}

export interface MatchResult {
  readonly efforts: readonly Effort[];
  readonly counts: StageCounts;
}

/** A segment with its cell cover precomputed, which is how a corpus is indexed. */
export interface IndexedSegment {
  readonly segment: Segment;
  readonly cells: ReadonlySet<CellId>;
}

/** Precompute a corpus's covers once, outside the per-ride loop. */
export function indexCorpus(segments: readonly Segment[]): IndexedSegment[] {
  return segments.map((segment) => ({ segment, cells: cellCover(segment.geometry) }));
}

/**
 * Match one ride against an indexed corpus.
 *
 * Pure: no clock, no I/O, no randomness. The harness in `tools/` times it from
 * outside, which is the only way the number means anything.
 */
export function matchRide(ride: RideTrace, corpus: readonly IndexedSegment[]): MatchResult {
  const rideCells = cellCover(ride.positions);

  // --- Stage 1: the cell-cover intersection -------------------------------
  const nearby = corpus.filter((entry) => coversIntersect(rideCells, entry.cells));

  // --- Stage 2: the endpoint gate -----------------------------------------
  // Cheap per segment and it is what makes stage 3 affordable: a segment whose
  // start is never approached in the right direction cannot have been ridden,
  // whatever its geometry looks like.
  const gated: { readonly entry: IndexedSegment; readonly spans: readonly Span[] }[] = [];
  for (const entry of nearby) {
    const spans = candidateSpans(ride, entry.segment);
    if (spans.length > 0) {
      gated.push({ entry, spans });
    }
  }

  // --- Stage 3: curve similarity on the survivors -------------------------
  const efforts: Effort[] = [];
  for (const { entry, spans } of gated) {
    for (const span of spans) {
      const traversed = ride.positions.slice(span.startIndex, span.endIndex + 1);
      const similarity = discreteFrechet(traversed, entry.segment.geometry);
      if (similarity > SIMILARITY_METRES) {
        continue;
      }
      efforts.push({
        segmentId: entry.segment.id,
        startIndex: span.startIndex,
        endIndex: span.endIndex,
        elapsedSeconds: (ride.times[span.endIndex] ?? 0) - (ride.times[span.startIndex] ?? 0),
        similarityMetres: similarity,
      });
    }
  }

  return {
    efforts,
    counts: {
      corpus: corpus.length,
      afterPrefilter: nearby.length,
      afterEndpointGate: gated.length,
      afterSimilarity: new Set(efforts.map((effort) => effort.segmentId)).size,
    },
  };
}

/** A candidate traversal, before its curve has been compared. */
interface Span {
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Every span of the ride that opens at the segment's start and closes at its
 * finish, **in that order**.
 *
 * ## The two hard cases this function is where they are decided
 *
 * **Ridden twice in one ride** yields two spans, because the scan does not stop
 * at the first finish — it closes a span and keeps looking. A matcher that
 * returned the first traversal would silently discard the rider's second and
 * usually faster effort, and nothing downstream could tell.
 *
 * **Ridden backwards** yields none, and it costs no special case: the start
 * gate requires direction agreement with the segment's *recorded* direction,
 * so a descending rider never opens a span at all. `endpointReached` is #64's,
 * and `segment.test.ts` there already pins that a rider going the other way is
 * rejected.
 *
 * ⚠️ **A gap longer than {@link GAP_SECONDS} abandons the open span rather than
 * spanning it.** The alternative is an elapsed time that includes a period
 * nobody recorded — a number that looks like a result and is not one.
 */
function candidateSpans(ride: RideTrace, segment: Segment): Span[] {
  const spans: Span[] = [];
  let open: number | undefined;

  for (const [index, position] of ride.positions.entries()) {
    const heading = sampleHeading(ride.positions[index - 1], position);

    if (open !== undefined) {
      const previousTime = ride.times[index - 1];
      const time = ride.times[index];
      if (previousTime !== undefined && time !== undefined && time - previousTime > GAP_SECONDS) {
        // The recording stopped mid-effort. Abandon rather than bridge.
        open = undefined;
      }
    }

    if (
      open !== undefined &&
      endpointReached(segment.end, position, heading, segment.bearingToleranceDegrees)
    ) {
      spans.push({ startIndex: open, endIndex: index });
      open = undefined;
      continue;
    }

    if (
      open === undefined &&
      endpointReached(segment.start, position, heading, segment.bearingToleranceDegrees)
    ) {
      open = index;
    }
  }

  return spans;
}

/**
 * What an **interpolated** crossing time would have said, for comparison only.
 *
 * ⚠️ **The pipeline does not call this and must not.** ADR 0007 D-2.2 forbids
 * synthesising a point to decide a crossing, and this synthesises the instant
 * at which the ride passed closest to an endpoint. It exists because #65's
 * fifth criterion asks the spike to **quantify the difference** between
 * nearest-sample and interpolated timing — a number that cannot be reported
 * without computing both.
 *
 * So this is the measurement's control, not an option on the table. The
 * write-up states the gap it reveals as the **price of the constraint**, which
 * is a more honest framing than presenting it as a design choice that was
 * weighed: it was not weighed, it was ruled out, and the cost is what a reader
 * is owed.
 *
 * @returns the fractional sample index at which the path passes nearest to
 * `target`, or `undefined` for a span too short to interpolate within.
 */
export function nearestApproachIndex(
  ride: RideTrace,
  target: GeographicPosition,
  aroundIndex: number,
): number | undefined {
  const before = ride.positions[aroundIndex - 1];
  const at = ride.positions[aroundIndex];
  const after = ride.positions[aroundIndex + 1];
  if (at === undefined) {
    return undefined;
  }
  if (before === undefined && after === undefined) {
    return undefined;
  }

  // A parabola through the three distances, minimised analytically. Cheap, and
  // exact enough for a comparison whose answer is measured in seconds.
  const d0 = before === undefined ? Number.POSITIVE_INFINITY : distanceBetween(before, target);
  const d1 = distanceBetween(at, target);
  const d2 = after === undefined ? Number.POSITIVE_INFINITY : distanceBetween(after, target);
  if (!Number.isFinite(d0) || !Number.isFinite(d2)) {
    return aroundIndex;
  }
  const denominator = d0 - 2 * d1 + d2;
  if (denominator === 0) {
    return aroundIndex;
  }
  const offset = (0.5 * (d0 - d2)) / denominator;
  // Clamped: a flat or concave triple can put the vertex outside the samples,
  // and an "interpolated" index beyond the neighbours is an extrapolation —
  // which is the construct being measured against, not one to accidentally use.
  return aroundIndex + Math.max(-1, Math.min(1, offset));
}
