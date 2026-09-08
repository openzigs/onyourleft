// SPDX-License-Identifier: Apache-2.0

/**
 * Comparing two efforts on one segment (#67) — where the time went, not just
 * how much of it there was.
 *
 * A rider asking *"am I getting faster?"* is answered by the ranking in
 * `effort.ts`. A rider asking **"where did I lose it?"** needs the two efforts
 * side by side, and that is this file: for each effort, how far along the
 * segment the rider had got at each elapsed second.
 *
 * ## ⚠️ Two efforts do not share a sample rate, and that is the whole problem
 *
 * #67's second criterion names the failure: an overlay that *"silently
 * truncates the shorter series"* when a 1 Hz ride is compared with a
 * smart-recorded one. The two efforts have different sample **counts**,
 * different sample **spacings**, and different **durations** — all three at
 * once — so anything that walks them by index, zips them, or bounds a loop by
 * `Math.min(a.length, b.length)` produces a chart that looks right and stops
 * early.
 *
 * The shape that avoids it: each effort produces its **own** series over its
 * **own** samples ({@link progressOf}), and the comparison is taken at stated
 * checkpoints along the segment rather than at sample positions
 * ({@link overlayEfforts}). Neither series is resampled to the other's rate and
 * neither is cut to the other's length.
 *
 * ## ⚠️ Nearest recorded sample, here too
 *
 * A checkpoint lands between two samples far more often than not. This reports
 * the **nearest recorded sample** to it and says how far off that was
 * ({@link Checkpoint.offsetMetres}), rather than interpolating an elapsed time
 * the recording never contained. Same rule as the matcher, and for the reason
 * `match.ts` gives — but note this is a *display* decision rather than
 * ADR 0007 D-2.2's, which is about deciding a crossing. Interpolating here
 * would not violate the ADR; it would just report a number no device recorded,
 * in a comparison whose whole point is what the devices recorded.
 */

import { distanceBetween } from '../geodesy';
import { metres, seconds } from '../quantities';

import type { GeographicPosition, Metres, Seconds, UnixSeconds } from '../quantities';

/**
 * How far a rider had travelled at one recorded sample of one effort.
 *
 * `distance` is measured **along the ride's own path**, cumulatively from the
 * effort's first sample — not as the straight line from the start, and not
 * along the segment's stored geometry. The rider's own trace is what they
 * actually rode.
 */
export interface ProgressPoint {
  readonly elapsed: Seconds;
  readonly distance: Metres;
}

/** One effort's progress, at its own sample rate. */
export interface EffortProgress {
  readonly effortId: string;
  readonly points: readonly ProgressPoint[];
  /** The last point's distance. What the checkpoints are taken as fractions of. */
  readonly total: Metres;
  /** The last point's elapsed time — the effort's own duration. */
  readonly duration: Seconds;
  /**
   * The mean spacing between this effort's samples, in seconds.
   *
   * Reported rather than assumed, because it is the number that tells a reader
   * the two series are not comparable point for point — and #67's criterion is
   * precisely about what happens when they are not.
   */
  readonly sampleIntervalSeconds: number;
}

/**
 * Build one effort's progress series from the ride it was found in.
 *
 * @param positions the ride's recorded positions.
 * @param times the ride's recorded timestamps, parallel to `positions`.
 * @param startIndex the effort's first sample, inclusive.
 * @param endIndex the effort's last sample, inclusive.
 *
 * @returns a series with one point per recorded sample in the span. An empty
 * series for a span that is empty or inverted, which a caller renders as "no
 * comparison" rather than as a flat line at zero.
 */
export function progressOf(
  effortId: string,
  positions: readonly GeographicPosition[],
  times: readonly UnixSeconds[],
  startIndex: number,
  endIndex: number,
): EffortProgress {
  const empty: EffortProgress = {
    effortId,
    points: [],
    total: metres(0),
    duration: seconds(0),
    sampleIntervalSeconds: 0,
  };
  const from = Math.max(0, startIndex);
  const to = Math.min(positions.length - 1, times.length - 1, endIndex);
  if (to <= from) {
    return empty;
  }
  const startedAt = times[from];
  if (startedAt === undefined) {
    return empty;
  }

  const points: ProgressPoint[] = [];
  let travelled = 0;
  for (let index = from; index <= to; index += 1) {
    const position = positions[index];
    const at = times[index];
    if (position === undefined || at === undefined) {
      continue;
    }
    const previous = index > from ? positions[index - 1] : undefined;
    if (previous !== undefined) {
      travelled += distanceBetween(previous, position);
    }
    points.push({ elapsed: seconds(at - startedAt), distance: metres(travelled) });
  }

  const last = points[points.length - 1];
  if (last === undefined) {
    return empty;
  }
  return {
    effortId,
    points,
    total: last.distance,
    duration: last.elapsed,
    // Mean rather than median: this is a description of the recording for the
    // reader, not an input to a tolerance. `match.ts` takes the median for the
    // endpoint gate, where one gap must not widen anything.
    sampleIntervalSeconds: points.length < 2 ? 0 : last.elapsed / (points.length - 1),
  };
}

/**
 * How many points a comparison is taken at: **21**, so every 5% of the segment.
 *
 * ⚠️ **A display budget, not a resolution claim.** Twenty-one rows is a table a
 * person can read and a chart that stays legible; a checkpoint every metre
 * would be neither, and neither effort has that resolution anyway — a ride
 * recorded every 10 s at 30 km/h has one sample per 83 m.
 */
export const COMPARISON_CHECKPOINTS = 21;

/** One effort's state at one checkpoint. */
export interface CheckpointReading {
  readonly effortId: string;
  /** The elapsed time of the **nearest recorded sample** to the checkpoint. */
  readonly elapsed: Seconds;
  /**
   * How far that sample was from the checkpoint.
   *
   * The honesty field. A 10 s recording puts this in the tens of metres, and a
   * reader comparing two efforts is entitled to know that one of the two times
   * is pinned to a sample 40 m from where the other one is.
   */
  readonly offset: Metres;
}

/** The two efforts, at one distance along the segment. */
export interface Checkpoint {
  /** How far along, as a fraction in `[0, 1]` of the **shorter** effort's total. */
  readonly fraction: number;
  readonly distance: Metres;
  readonly first: CheckpointReading | undefined;
  readonly second: CheckpointReading | undefined;
  /**
   * `second.elapsed - first.elapsed`, or `undefined` when either is missing.
   *
   * Positive means the second effort was **behind** at this point.
   *
   * ⚠️ **A plain `number`, not `Seconds`, and deliberately.** `seconds()`
   * refuses a negative value, because a `Seconds` in this package is a
   * *duration* and a negative one is a bug — which is exactly right, and
   * exactly wrong for a difference: "two seconds ahead" is the useful half of
   * this field. `bearingDifference` in `geodesy.ts` is the same shape and the
   * precedent for it.
   */
  readonly delta: number | undefined;
}

export interface EffortComparison {
  readonly first: EffortProgress;
  readonly second: EffortProgress;
  readonly checkpoints: readonly Checkpoint[];
  /**
   * `second.duration - first.duration`. Positive means the second was slower.
   *
   * A signed `number` for the reason {@link Checkpoint.delta} is.
   *
   * ⚠️ Taken from the two **durations**, not from the last checkpoint. The
   * checkpoints stop at the shorter effort's distance; the durations are each
   * effort's own. Reading the overall result off the last checkpoint is how an
   * overlay silently reports the shorter ride's margin as the final one.
   */
  readonly durationDelta: number;
}

/**
 * Compare two efforts at {@link COMPARISON_CHECKPOINTS} points along the road.
 *
 * ⚠️ **The checkpoints span the SHORTER effort's distance**, because beyond it
 * one of the two riders has no recorded position and a comparison would be
 * against nothing. That is a stated bound rather than a truncation: both
 * `EffortProgress` series are returned whole, so a chart draws each to its own
 * full extent and the difference is visible instead of being cut away.
 */
export function overlayEfforts(
  first: EffortProgress,
  second: EffortProgress,
  checkpointCount = COMPARISON_CHECKPOINTS,
): EffortComparison {
  const span = Math.min(first.total, second.total);
  const steps = Math.max(2, Math.floor(checkpointCount));
  const checkpoints: Checkpoint[] = [];

  if (span > 0) {
    for (let step = 0; step < steps; step += 1) {
      const fraction = step / (steps - 1);
      const distance = metres(span * fraction);
      const at = nearestReading(first, distance);
      const to = nearestReading(second, distance);
      checkpoints.push({
        fraction,
        distance,
        first: at,
        second: to,
        delta: at === undefined || to === undefined ? undefined : to.elapsed - at.elapsed,
      });
    }
  }

  return {
    first,
    second,
    checkpoints,
    durationDelta: second.duration - first.duration,
  };
}

/** The recorded sample of `progress` nearest to `distance` along it. */
function nearestReading(progress: EffortProgress, distance: Metres): CheckpointReading | undefined {
  let best: ProgressPoint | undefined;
  let bestOffset = Number.POSITIVE_INFINITY;
  for (const point of progress.points) {
    const offset = Math.abs(point.distance - distance);
    // Strictly closer, so a tie keeps the EARLIER sample — the same rule
    // `nearestEndpointSample` uses, and for the same reason: it cannot make an
    // effort look faster than the recording says.
    if (offset < bestOffset) {
      best = point;
      bestOffset = offset;
    }
  }
  return best === undefined
    ? undefined
    : { effortId: progress.effortId, elapsed: best.elapsed, offset: metres(bestOffset) };
}
