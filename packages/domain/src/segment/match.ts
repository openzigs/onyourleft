// SPDX-License-Identifier: Apache-2.0

/**
 * The segment matcher (#66): which segments a ride traversed, and how long each
 * traversal took.
 *
 * Here rather than in `apps/web` because #66 says so and because the reason is
 * structural: the same judgement is made on the device today and, from Phase 4
 * (#7), on an instance ranking the same effort. Two implementations are two
 * places for a board and a rider's own screen to disagree.
 *
 * ## Pure, and enforced rather than promised
 *
 * No clock, no I/O, no randomness, no platform API. Elapsed time is a
 * difference of two recorded timestamps that arrive as parameters.
 * `packages/domain`'s `tsconfig.json` narrows `lib` to `ES2024` with
 * `types: []`, so `fetch`, `performance` and `process` are compile errors here,
 * and `eslint.config.js` bars them again in the editor (CLAUDE.md §4d). #66's
 * ninth criterion is that this imports and runs in a bare environment; both
 * gates say it does, and `match.test.ts` adds the behavioural half.
 *
 * ## The three stages, and what each is for
 *
 * 1. **Cell-cover prefilter** (`cells.ts`) — an integer set intersection, so a
 *    corpus of 100 000 segments is affordable. Survivors are bounded by the
 *    *ride's* footprint, not by the corpus size.
 * 2. **Endpoint gate** (`segment.ts`) — proximity plus direction agreement, on
 *    recorded samples only. Cheap per segment, and what makes stage 3 possible.
 * 3. **Curve similarity** (`frechet.ts`) — discrete Fréchet, which is
 *    order-preserving and therefore rejects a segment ridden backwards without
 *    a second check.
 *
 * ## ⚠️ What the spike found, and what this file does about it
 *
 * `docs/spikes/0001-segment-matching.md` §1 measured two failures in the naive
 * form of stage 2, and **both are fixed here rather than tuned around**:
 *
 * - The gate widens by half the ride's own sample spacing
 *   ({@link endpointReachRadius}), because a fixed 15 m radius detects
 *   *nothing* at any recording interval above 1 s.
 * - A span is bounded by the **nearest** sample to each endpoint
 *   ({@link nearestEndpointSample}), not the first one inside the radius, so
 *   the compared span no longer grows with the gate. Without this, widening the
 *   gate breaks similarity instead — which is the tension #66 exists to break.
 *
 * ## ⚠️ ADR 0007 D-2, which binds this file
 *
 * - **D-2.1** — no oriented virtual start line. The gate is two scalar
 *   comparisons; nothing here computes a line, a perpendicular, a half-space or
 *   a sign change.
 * - **D-2.2** — no extrapolation. Every index this file produces is an index
 *   *into the ride*. There is no fractional sample and no synthesised crossing,
 *   and `docs/spikes/0001-segment-matching.md` §4 states what that costs.
 * - **D-2.3** — no two-tier loose/tight match whose tight tier is line
 *   crossings. The three stages are a funnel of one test each, and none of them
 *   is a crossing.
 * - **D-2.4** — nothing here deletes a segment.
 */

import { distanceBetween } from '../geodesy';
import { metres, seconds } from '../quantities';
import { UnitError } from '../unit-error';

import { cellCover, coversIntersect, type CellId } from './cells';
import { COMPARISON_STEP_METRES, densify, discreteFrechet } from './frechet';
import { endpointReachRadius, nearestEndpointSample, sampleHeading, type Segment } from './segment';

import type {
  DegreesBearing,
  GeographicPosition,
  Metres,
  Seconds,
  UnixSeconds,
} from '../quantities';

/**
 * How far a ride may stray from a segment and still count as having ridden it:
 * **25 metres**.
 *
 * ⚠️ **Our own tunable.** No competitor publishes a figure and this must never
 * be described as parity with one (#65's last criterion). The two-sided
 * reasoning:
 *
 * - **Not larger.** A road and the cycleway beside it are commonly 15–25 m
 *   apart. At 40 m the matcher reports efforts on a segment the rider was never
 *   on — the failure that destroys a leaderboard's credibility, and the one no
 *   downstream care recovers from.
 * - **Not smaller.** Consumer GNSS horizontal error is commonly quoted at
 *   3–5 m under open sky and degrades badly under tree cover and beside
 *   buildings. At 10 m an honest traversal through a built-up section misses,
 *   and the rider is told nothing about why.
 *
 * `docs/spikes/0001-segment-matching.md` §5 measures the miss rate this
 * produces — 0% at 5 m of per-sample noise, 0.5% at 10 m, 81.5% at 20 m —
 * rather than asserting it is acceptable.
 *
 * ⚠️ **Do not tune this to improve a miss rate without re-running the
 * false-positive cases.** That is the exercise #65 warns makes the failure
 * worse, and both cases are written in `match.test.ts`.
 */
export const SIMILARITY_METRES = 25;

/**
 * How long a hole in the recording may be before a traversal is abandoned:
 * **20 seconds**.
 *
 * ⚠️ **Our own tunable**, and the one whose absence elsewhere is most
 * conspicuous: Strava's documentation names a "Gap Threshold" and publishes no
 * number for it. Ours is derived. A device recording every 10 s — the slowest
 * smart-recording interval in common use — produces a legitimate 10 s spacing,
 * so the threshold must sit above that or every such ride is one long gap.
 * Twice that leaves room for one dropped sample and refuses two.
 *
 * The consequence is stated rather than hidden: **a traversal spanning a longer
 * hole yields no effort at all**, because the alternative is publishing a time
 * that includes a period nobody measured. #66's fourth criterion adds the other
 * half — the rider is *told*, via {@link SegmentMatch.abandoned}, rather than
 * left to wonder where their effort went.
 */
export const GAP_SECONDS = 20;

/** A ride, as the matcher sees it. */
export interface RideTrace {
  readonly positions: readonly GeographicPosition[];
  /**
   * When each position was recorded, one per position, increasing.
   *
   * Absolute rather than elapsed, so an effort can be stamped with a real
   * instant without the matcher being told when the ride began.
   */
  readonly times: readonly UnixSeconds[];
}

/** One traversal of one segment, found in one ride. */
export interface MatchedEffort {
  readonly segmentId: string;
  /** Index into the ride of the sample nearest the segment's start. */
  readonly startIndex: number;
  /** Index into the ride of the sample nearest the segment's end. */
  readonly endIndex: number;
  readonly startedAt: UnixSeconds;
  /**
   * Elapsed time, as the difference of two **recorded** timestamps.
   *
   * ⚠️ Not an interpolated crossing time. ADR 0007 D-2.2 forbids synthesising a
   * point to decide a crossing, and a crossing time derived from a synthesised
   * point is that construct wearing a clock.
   */
  readonly elapsed: Seconds;
  /** How far the ride strayed from the segment. At or below the threshold. */
  readonly deviation: Metres;
}

/**
 * Why a traversal that reached a segment's start produced no effort.
 *
 * A union rather than a free string, and only one member today, because #66's
 * fourth criterion asks for one reason and a union of one still says where the
 * second goes.
 */
export type AbandonedReason = 'recording-gap';

/**
 * A traversal the matcher started and gave up on, with the reason.
 *
 * #66's fourth criterion: *"the reason is recorded on the activity so the
 * athlete can be told why rather than left guessing"*. A matcher that silently
 * returns fewer efforts is indistinguishable from one that is broken, both to
 * the rider and to whoever is debugging it.
 *
 * ⚠️ **Not an error.** Abandoning a traversal across a hole in the recording is
 * the correct outcome; this is the sentence that goes on the screen beside it.
 */
export interface AbandonedTraversal {
  readonly segmentId: string;
  readonly reason: AbandonedReason;
  /** Where in the ride it was given up. Enough to point at the gap. */
  readonly atIndex: number;
}

/** What each stage let through — the fan-out #65's second criterion measured. */
export interface StageCounts {
  readonly corpus: number;
  readonly afterPrefilter: number;
  readonly afterEndpointGate: number;
  readonly afterSimilarity: number;
}

export interface SegmentMatch {
  readonly efforts: readonly MatchedEffort[];
  readonly abandoned: readonly AbandonedTraversal[];
  readonly counts: StageCounts;
}

/** A segment with its cell cover precomputed, which is what an index is. */
export interface IndexedSegment {
  readonly segment: Segment;
  readonly cells: ReadonlySet<CellId>;
}

/**
 * Precompute a corpus's cell covers, once, outside the per-ride loop.
 *
 * Separated from {@link matchRide} deliberately: indexing is a cost paid when a
 * segment is created and matching is a cost paid on every ride, and rolling
 * them together makes the per-ride number look far worse than it is. The spike
 * reported them separately for the same reason.
 */
export function indexCorpus(segments: readonly Segment[]): IndexedSegment[] {
  return segments.map((segment) => ({ segment, cells: cellCover(segment.geometry) }));
}

/**
 * The ride's typical distance between consecutive samples, as a **median**.
 *
 * Median rather than mean, and that is the whole of why this is its own
 * function. A ride with one recording gap has a mean spacing pulled upwards by
 * a single 900 m step, which would widen the endpoint gate across the entire
 * ride on the strength of one hole. The median describes how the device was
 * actually recording.
 *
 * @returns 0 for a ride too short to have a spacing, which widens the gate by
 * nothing — the conservative answer.
 */
export function medianSampleSpacing(positions: readonly GeographicPosition[]): Metres {
  if (positions.length < 2) {
    return metres(0);
  }
  const steps: number[] = [];
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    steps.push(distanceBetween(previous, current));
  }
  if (steps.length === 0) {
    return metres(0);
  }
  steps.sort((a, b) => a - b);
  const middle = Math.floor(steps.length / 2);
  if (steps.length % 2 === 1) {
    return metres(steps[middle] ?? 0);
  }
  return metres(((steps[middle - 1] ?? 0) + (steps[middle] ?? 0)) / 2);
}

/**
 * Match one ride against an indexed corpus.
 *
 * @throws UnitError when `positions` and `times` disagree in length — a ride
 * whose samples and timestamps do not correspond is a caller bug, and silently
 * matching the shorter prefix would produce efforts timed against the wrong
 * samples.
 */
export function matchRide(ride: RideTrace, corpus: readonly IndexedSegment[]): SegmentMatch {
  if (ride.positions.length !== ride.times.length) {
    throw new UnitError(
      `a ride trace needs one time per position (got ${String(ride.positions.length)} positions and ${String(ride.times.length)} times)`,
    );
  }

  // Computed once for the whole ride rather than per segment: it is a property
  // of the recording, and recomputing it inside the corpus loop would make a
  // 100 000-segment match a 100 000-fold repetition of the same answer.
  const headings = headingsOf(ride.positions);
  const spacing = medianSampleSpacing(ride.positions);
  const rideCells = cellCover(ride.positions);

  // --- Stage 1: the cell-cover intersection --------------------------------
  const nearby = corpus.filter((entry) => coversIntersect(rideCells, entry.cells));

  // --- Stage 2: the endpoint gate ------------------------------------------
  const abandoned: AbandonedTraversal[] = [];
  const gated: { readonly entry: IndexedSegment; readonly spans: readonly Span[] }[] = [];
  for (const entry of nearby) {
    const found = candidateSpans(ride, entry.segment, headings, spacing);
    abandoned.push(...found.abandoned);
    if (found.spans.length > 0) {
      gated.push({ entry, spans: found.spans });
    }
  }

  // --- Stage 3: curve similarity on the survivors --------------------------
  const efforts: MatchedEffort[] = [];
  for (const { entry, spans } of gated) {
    for (const span of spans) {
      const traversed = ride.positions.slice(span.startIndex, span.endIndex + 1);
      const covered = coveredGeometry(entry.segment, traversed);
      // Both paths resampled to a common step first. Without it the comparison
      // measures how often each device wrote a sample rather than how far the
      // rider strayed, and a flawless traversal recorded every 10 s fails —
      // `frechet.ts` §`densify` has the derivation and the assumption it makes.
      const deviation = discreteFrechet(
        densify(traversed, COMPARISON_STEP_METRES),
        densify(covered, COMPARISON_STEP_METRES),
      );
      if (deviation > SIMILARITY_METRES) {
        continue;
      }
      const startedAt = ride.times[span.startIndex];
      const finishedAt = ride.times[span.endIndex];
      if (startedAt === undefined || finishedAt === undefined) {
        continue;
      }
      efforts.push({
        segmentId: entry.segment.id,
        startIndex: span.startIndex,
        endIndex: span.endIndex,
        startedAt,
        elapsed: seconds(finishedAt - startedAt),
        deviation: metres(deviation),
      });
    }
  }

  return {
    efforts,
    abandoned,
    counts: {
      corpus: corpus.length,
      afterPrefilter: nearby.length,
      afterEndpointGate: gated.length,
      afterSimilarity: new Set(efforts.map((effort) => effort.segmentId)).size,
    },
  };
}

/**
 * The stretch of the segment that the span actually covers: its geometry
 * trimmed to the vertices nearest the span's first and last samples.
 *
 * ## Why comparing against the whole geometry is wrong
 *
 * The span's ends are recorded samples, and a recorded sample sits up to half a
 * spacing short of the endpoint it is nearest — at a 10 s interval that is
 * about 42 m. Discrete Fréchet couples the two paths *end to end*, so it would
 * charge that quantisation as though the rider had strayed 42 m from the road.
 * They did not stray: the recording simply does not say where they were between
 * two samples, and a matcher that reports a flawless traversal as a 42 m
 * deviation is measuring the device rather than the ride.
 *
 * Trimming makes the comparison like-for-like — the part of the segment the
 * ride has samples for, against those samples.
 *
 * ⚠️ **This cannot let a partial traversal through**, which is the obvious
 * worry. The endpoint gate has already required the ride to come within
 * {@link endpointReachRadius} of *both* endpoints, so the trim can remove at
 * most that much from each end and no more. A rider who turned off halfway
 * never opened a span at all, so there is nothing here to trim.
 *
 * ⚠️ **Both returned ends are stored vertices of the segment.** Nothing is
 * interpolated to find them, and no coordinate produced here is stored, timed
 * or reported (ADR 0007 D-2.2).
 */
function coveredGeometry(
  segment: Segment,
  traversed: readonly GeographicPosition[],
): readonly GeographicPosition[] {
  const first = traversed[0];
  const last = traversed[traversed.length - 1];
  if (first === undefined || last === undefined) {
    return segment.geometry;
  }
  const from = nearestVertex(segment.geometry, first);
  const to = nearestVertex(segment.geometry, last);
  if (from === undefined || to === undefined || to <= from) {
    return segment.geometry;
  }
  return segment.geometry.slice(from, to + 1);
}

/** The index of the vertex closest to `target`, or `undefined` for an empty path. */
function nearestVertex(
  path: readonly GeographicPosition[],
  target: GeographicPosition,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, position] of path.entries()) {
    const distance = distanceBetween(position, target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** The direction of travel at each sample, from the sample before it. */
function headingsOf(
  positions: readonly GeographicPosition[],
): readonly (DegreesBearing | undefined)[] {
  return positions.map((position, index) => sampleHeading(positions[index - 1], position));
}

/** A candidate traversal, before its curve has been compared. */
interface Span {
  readonly startIndex: number;
  readonly endIndex: number;
}

interface SpanSearch {
  readonly spans: readonly Span[];
  readonly abandoned: readonly AbandonedTraversal[];
}

/**
 * Every span of the ride that runs from the segment's start to its finish, in
 * that order — bounded at each end by the **nearest** recorded sample.
 *
 * ## The two hard cases decided here
 *
 * **Ridden twice in one ride** yields two spans, because the scan does not stop
 * at the first finish: it closes a span and keeps looking. A matcher returning
 * only the first traversal would silently discard the rider's second and often
 * faster effort, and nothing downstream could tell.
 *
 * **Ridden backwards** yields none, and it costs no special case. The start
 * gate requires direction agreement with the segment's *recorded* direction, so
 * a descending rider never opens a span at all.
 *
 * ## How a span is bounded, which is the #66 change
 *
 * A run of consecutive samples may all lie inside the widened gate. The span
 * opens at the one **closest to the start endpoint** and closes at the one
 * closest to the end endpoint — not at the first of each, which is what the
 * spike's prototype did and what coupled the gate width to the similarity
 * budget (`docs/spikes/0001-segment-matching.md` §1, finding 2).
 *
 * ⚠️ **A gap longer than {@link GAP_SECONDS} abandons an open span and records
 * why.** It does not bridge it. A bridged gap produces an effort whose elapsed
 * time includes minutes nobody recorded, which is worse than no effort — it is
 * a wrong number presented as a right one, and on a leaderboard it wins.
 */
function candidateSpans(
  ride: RideTrace,
  segment: Segment,
  headings: readonly (DegreesBearing | undefined)[],
  spacing: Metres,
): SpanSearch {
  const tolerance = segment.bearingToleranceDegrees;
  const startRadius = endpointReachRadius(segment.start, spacing);
  const endRadius = endpointReachRadius(segment.end, spacing);

  const spans: Span[] = [];
  const abandoned: AbandonedTraversal[] = [];

  let index = 0;
  while (index < ride.positions.length) {
    // Open at the sample nearest the start endpoint, searching forward from
    // wherever the last traversal finished.
    const opened = nearestApproachRun(
      segment,
      'start',
      ride.positions,
      headings,
      tolerance,
      startRadius,
      index,
    );
    if (opened === undefined) {
      break;
    }

    const gapAt = firstGapAfter(ride, opened.index);
    const closed = nearestApproachRun(
      segment,
      'end',
      ride.positions,
      headings,
      tolerance,
      endRadius,
      opened.index + 1,
      gapAt,
    );

    if (closed === undefined) {
      // Reaching the start and never the end is ordinarily just a rider who
      // turned off — silent, and correctly so. It is only worth telling them
      // about when a hole in the recording is what cut the traversal short.
      if (gapAt !== undefined && gapAt < ride.positions.length) {
        abandoned.push({ segmentId: segment.id, reason: 'recording-gap', atIndex: gapAt });
      }
      index = opened.runEnd;
      continue;
    }

    spans.push({ startIndex: opened.index, endIndex: closed.index });
    index = closed.runEnd;
  }

  return { spans, abandoned };
}

interface Approach {
  /** The nearest sample in the run. */
  readonly index: number;
  /** One past the last sample of the run, so a scan can resume beyond it. */
  readonly runEnd: number;
}

/**
 * The first run of samples that reaches `which` endpoint, and the sample within
 * it that comes nearest.
 *
 * A *run* is a maximal stretch of consecutive reaching samples. Bounding the
 * search to one run rather than the whole remaining ride is what stops a rider
 * who passed the same endpoint twice from having their first approach measured
 * against their second.
 */
function nearestApproachRun(
  segment: Segment,
  which: 'start' | 'end',
  positions: readonly GeographicPosition[],
  headings: readonly (DegreesBearing | undefined)[],
  toleranceDegrees: number,
  radius: Metres,
  from: number,
  to = positions.length,
): Approach | undefined {
  const endpoint = which === 'start' ? segment.start : segment.end;
  const stop = Math.min(positions.length, to);

  let cursor = Math.max(0, from);
  while (cursor < stop) {
    const first = nearestEndpointSample(
      endpoint,
      positions,
      headings,
      toleranceDegrees,
      radius,
      cursor,
      cursor + 1,
    );
    if (first === undefined) {
      cursor += 1;
      continue;
    }
    // Found the run's first sample; walk to its end.
    let runEnd = cursor + 1;
    while (
      runEnd < stop &&
      nearestEndpointSample(
        endpoint,
        positions,
        headings,
        toleranceDegrees,
        radius,
        runEnd,
        runEnd + 1,
      ) !== undefined
    ) {
      runEnd += 1;
    }
    const nearest = nearestEndpointSample(
      endpoint,
      positions,
      headings,
      toleranceDegrees,
      radius,
      cursor,
      runEnd,
    );
    return nearest === undefined ? undefined : { index: nearest, runEnd };
  }
  return undefined;
}

/**
 * The index at which the recording first breaks for longer than
 * {@link GAP_SECONDS} after `from`, or `undefined` if it never does.
 *
 * Returns the index of the sample **after** the hole, which is where a span
 * would have had to bridge and is the useful thing to point a rider at.
 */
function firstGapAfter(ride: RideTrace, from: number): number | undefined {
  for (let index = from + 1; index < ride.times.length; index += 1) {
    const previous = ride.times[index - 1];
    const current = ride.times[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (current - previous > GAP_SECONDS) {
      return index;
    }
  }
  return undefined;
}
