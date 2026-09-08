// SPDX-License-Identifier: Apache-2.0

/**
 * Stage 3 of the pipeline: **discrete Fréchet distance**, on the survivors.
 *
 * ## Why Fréchet and not Hausdorff — #65 says this in one line and it is the
 * single most consequential line in the spike (#65)
 *
 * > *"discrete Fréchet is order-preserving and is the usual right answer for a
 * > directed path; Hausdorff is direction-blind and will happily match a
 * > segment ridden backwards."*
 *
 * Hausdorff distance asks, of two point sets, how far the worst point of one is
 * from the nearest point of the other. It is a question about **sets**, and a
 * path reversed is the same set — so a rider descending a climb is, to
 * Hausdorff, indistinguishable from a rider climbing it. `frechet.test.ts`
 * asserts exactly that on the same pair of paths: Fréchet separates them and
 * Hausdorff does not.
 *
 * Discrete Fréchet is the **coupling** distance: the smallest leash length for
 * which a walker on each path, neither ever stepping backwards, can traverse
 * both. Monotonicity is what encodes direction, and it is why "ridden
 * backwards" costs nothing extra to reject — it falls out of the metric rather
 * than out of a second check somebody has to remember to write.
 *
 * ## Provenance — ADR 0007 D-6 requires it by name and date
 *
 * **Eiter, T. and Mannila, H., *Computing Discrete Fréchet Distance*, Technical
 * Report CD-TR 94/64, Christian Doppler Laboratory for Expert Systems, TU
 * Vienna, 1994.** The dynamic program below is that paper's, unchanged in
 * substance: a coupling measure over the two index sequences, computed as a
 * table. It predates the 2011-03-31 priority of the US 9,116,922 family by
 * seventeen years, which is the point D-6 exists to make — this is not a
 * competitor's design arrived at by reading a competitor.
 *
 * ⚠️ **Nothing here is a start line, oriented or otherwise.** Fréchet compares
 * two paths as wholes; it computes no line, takes no orientation from a
 * user-selected point, and decides no crossing. ADR 0007 D-2.1.
 */

import { distanceBetween } from '../geodesy';
import { degreesLatitude, degreesLongitude, geographicPosition } from '../quantities';

import type { GeographicPosition } from '../quantities';

/**
 * The discrete Fréchet distance between two paths, in metres.
 *
 * ⚠️ **O(n·m) in time and O(m) in space, which is why it is stage 3 and not
 * stage 1.** A four-hour ride is ~14 400 samples; against a 40-sample segment
 * that is over half a million distance calls, so running it against a corpus
 * of 100 000 segments unfiltered is not an option — it is what the prefilter
 * and the endpoint gate exist to prevent;
 * `docs/spikes/0001-segment-matching.md` §3 reports how many survivors
 * actually reach here.
 *
 * The space bound is the one worth having: the textbook version allocates the
 * whole n×m table, which for the numbers above is a 576 MB `Float64Array`. Only
 * the previous row is ever read, so two rows suffice.
 *
 * @returns `Infinity` when either path is empty, which the caller reads as "no
 * similarity" rather than as an error. A zero would be a perfect match.
 */
export function discreteFrechet(
  first: readonly GeographicPosition[],
  second: readonly GeographicPosition[],
): number {
  if (first.length === 0 || second.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let previous = new Float64Array(second.length);
  let current = new Float64Array(second.length);

  for (const [i, a] of first.entries()) {
    for (const [j, b] of second.entries()) {
      const direct = distanceBetween(a, b);
      if (i === 0) {
        // The first row. Only the walker on `second` has moved, so the coupling
        // is the worst leash it has needed so far — there is no previous row to
        // consult, and reading one would read uninitialised zeros.
        current[j] = j === 0 ? direct : Math.max(current[j - 1] ?? 0, direct);
      } else if (j === 0) {
        // The first column, mirrored: only the walker on `first` has moved.
        current[j] = Math.max(previous[j] ?? 0, direct);
      } else {
        // The three legal predecessors: advance on `first`, on `second`, or on
        // both. Neither walker may step back — that monotonicity IS the
        // direction sensitivity this function is chosen for.
        const best = Math.min(previous[j] ?? 0, previous[j - 1] ?? 0, current[j - 1] ?? 0);
        current[j] = Math.max(best, direct);
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[second.length - 1] ?? Number.POSITIVE_INFINITY;
}

/**
 * The step a path is resampled to before two paths are compared: **10 metres**.
 *
 * Well under {@link SIMILARITY_METRES}, deliberately — see {@link densify} for
 * why the two numbers are related at all.
 */
export const COMPARISON_STEP_METRES = 10;

/**
 * Insert points along a path so that no step exceeds `maxStepMetres`.
 *
 * ## Why this is necessary, and it is not an optimisation
 *
 * Discrete Fréchet couples *vertices*, so its value carries a floor set by the
 * **coarser path's sample spacing**: every vertex of one path must be paired
 * with some vertex of the other, and a vertex falling midway between two of
 * them is half a spacing away however perfectly the two paths coincide. That is
 * `docs/spikes/0001-segment-matching.md` §1's third finding, and it is what
 * makes the raw comparison unusable at a coarse recording interval: a ride
 * sampled every 10 s at 30 km/h steps 83 m, so a *flawless* traversal of the
 * segment's own road scores about 42 m against a 25 m threshold. The rider is
 * on the road and the matcher says they were not.
 *
 * Resampling both paths to a common step removes it: at a 10 m step the floor
 * is about 5 m, which leaves the threshold measuring what it is supposed to
 * measure — how far the rider strayed — rather than how often their device
 * wrote a sample.
 *
 * ## ⚠️ What this assumes, stated rather than buried
 *
 * **That the rider travelled in a straight line between two recorded samples.**
 * They may not have. At an 83 m spacing on a curving road, that assumption is
 * worth tens of metres, and it makes a false positive *more* likely at coarse
 * intervals than at 1 Hz. That is the honest position: at a 10 s interval the
 * recording does not contain the information, and the choice is between an
 * assumption stated here and refusing to match those rides at all.
 *
 * ## ⚠️ Why this is not the extrapolation ADR 0007 D-2.2 forbids
 *
 * D-2.2 forbids **synthesising a point in order to decide a crossing**. No
 * point produced here decides anything: the endpoint gate has already run, on
 * recorded samples only, and produced the span's two indices. These points are
 * interpolated *between two recorded positions of the same path*, exist only
 * inside the distance computation, and are never stored, timed or reported —
 * the same standing `cells.ts` gives the interpolation in its cover, and for
 * the same reason. An effort's `startedAt` and `elapsed` still come from two
 * recorded timestamps and cannot come from anywhere else.
 *
 * @returns the path unchanged when `maxStepMetres` is not a positive finite
 * number, which keeps a caller's bad argument from silently emptying a
 * comparison.
 */
export function densify(
  path: readonly GeographicPosition[],
  maxStepMetres: number,
): readonly GeographicPosition[] {
  if (!Number.isFinite(maxStepMetres) || maxStepMetres <= 0 || path.length < 2) {
    return path;
  }
  const dense: GeographicPosition[] = [];
  for (const [index, position] of path.entries()) {
    dense.push(position);
    const next = path[index + 1];
    if (next === undefined) {
      continue;
    }
    const steps = Math.ceil(distanceBetween(position, next) / maxStepMetres);
    for (let step = 1; step < steps; step += 1) {
      const fraction = step / steps;
      dense.push(
        geographicPosition(
          degreesLatitude(position.latitude + (next.latitude - position.latitude) * fraction),
          degreesLongitude(position.longitude + (next.longitude - position.longitude) * fraction),
        ),
      );
    }
  }
  return dense;
}

/**
 * Directed Hausdorff distance, in metres. **Not used by the pipeline.**
 *
 * Here so that `frechet.test.ts` can demonstrate the failure rather than assert
 * it in a comment: the same reversed path that Fréchet separates, Hausdorff
 * reports as identical. Keeping the losing candidate runnable is the only way
 * that comparison is evidence.
 *
 * ⚠️ **Do not wire this into the matcher.** It is cheaper — O(n·m) with no
 * table — and that is exactly the temptation. A leaderboard built on it ranks
 * descents against climbs.
 */
export function directedHausdorff(
  from: readonly GeographicPosition[],
  to: readonly GeographicPosition[],
): number {
  let worst = 0;
  for (const a of from) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const b of to) {
      nearest = Math.min(nearest, distanceBetween(a, b));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}
