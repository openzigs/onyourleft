// SPDX-License-Identifier: Apache-2.0

/**
 * Stage 3 of the pipeline: **discrete Fréchet distance**, on the survivors.
 *
 * ## Why Fréchet and not Hausdorff — #65 says this in one line and it is the
 * single most consequential line in the spike
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

import { distanceBetween, type GeographicPosition } from '@onyourleft/domain';

/**
 * The discrete Fréchet distance between two paths, in metres.
 *
 * ⚠️ **O(n·m) in time and O(m) in space, which is why it is stage 3 and not
 * stage 1.** A four-hour ride is ~14 400 samples; against a 40-sample segment
 * that is over half a million distance calls, so running it against a corpus
 * of 100 000 segments unfiltered is not an option — it is what the prefilter
 * and the endpoint gate exist to prevent, and `tools/measure.ts` reports how
 * many survivors actually reach here.
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
