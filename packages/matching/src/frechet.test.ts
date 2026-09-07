// SPDX-License-Identifier: Apache-2.0

/**
 * The evidence behind #65's one-line claim that discrete Fréchet is the right
 * metric and Hausdorff is not.
 *
 * The issue asserts it; this measures it, on the same pair of paths.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { offsetBy, straightPath } from '../tools/corpus';
import { directedHausdorff, discreteFrechet } from './frechet';

const ORIGIN: GeographicPosition = geographicPosition(
  degreesLatitude(51.5),
  degreesLongitude(-0.12),
);

const NORTHBOUND = straightPath(ORIGIN, 0, 500, 26);

describe('why Fréchet and not Hausdorff', () => {
  it('Fréchet separates a path from its reverse; Hausdorff cannot', () => {
    // The whole reason for the choice, in one comparison. Hausdorff asks a
    // question about SETS, and a path reversed is the same set — so a rider
    // descending a climb is, to Hausdorff, indistinguishable from one climbing
    // it. A leaderboard built on it ranks descents against climbs.
    const reverse = [...NORTHBOUND].reverse();

    expect(directedHausdorff(NORTHBOUND, reverse)).toBeCloseTo(0, 6);
    // Fréchet's monotonic coupling has to drag one walker the whole length
    // while the other comes back, so the leash is the segment's own length.
    expect(discreteFrechet(NORTHBOUND, reverse)).toBeGreaterThan(400);
  });

  it('is zero for a path against itself', () => {
    expect(discreteFrechet(NORTHBOUND, NORTHBOUND)).toBeCloseTo(0, 9);
  });

  it('is symmetric', () => {
    const shifted = NORTHBOUND.map((point) => offsetBy(point, 0, 10));
    expect(discreteFrechet(NORTHBOUND, shifted)).toBeCloseTo(
      discreteFrechet(shifted, NORTHBOUND),
      9,
    );
  });

  it('reports the offset of a parallel path, not zero', () => {
    // Two roads 30 m apart running the same way. Every point of each is within
    // 30 m of the other, and the coupling distance IS that 30 m — which is what
    // makes it usable as the pipeline's similarity threshold.
    const parallel = NORTHBOUND.map((point) => offsetBy(point, 0, 30));
    expect(discreteFrechet(NORTHBOUND, parallel)).toBeGreaterThan(28);
    expect(discreteFrechet(NORTHBOUND, parallel)).toBeLessThan(32);
  });

  it('the coarser path’s SAMPLE SPACING sets a floor on the distance, even on the same road', () => {
    // ⚠️ A finding, not a tolerance to loosen. Both paths run down the identical
    // 500 m of road; one is sampled every 5 m and the other every 20 m. The
    // Fréchet distance is not zero — it is **10 m**, half the coarser spacing,
    // because a dense point halfway between two sparse ones is 10 m from the
    // nearer of them and the coupling has to reach it.
    //
    // That matters to the pipeline directly: `SIMILARITY_METRES` is 25, so a
    // segment stored at 20 m spacing spends 10 m of that budget on sampling
    // alone before any GNSS error is counted. A segment stored at 50 m spacing
    // would spend 25 m and match nothing at all.
    //
    // The write-up states it as a constraint on how segment geometry is
    // STORED, which is #64's decision and not a matcher tunable.
    const dense = straightPath(ORIGIN, 0, 500, 101);
    const spacingOfCoarse = 500 / 25;
    expect(discreteFrechet(dense, NORTHBOUND)).toBeCloseTo(spacingOfCoarse / 2, 1);
  });

  it('and the floor falls as the coarser path is sampled more densely', () => {
    // The other half of the same finding: it is the SPACING that sets the
    // floor, not some fixed cost of comparing paths at all.
    const dense = straightPath(ORIGIN, 0, 500, 101);
    const medium = straightPath(ORIGIN, 0, 500, 51);
    expect(discreteFrechet(dense, medium)).toBeLessThan(discreteFrechet(dense, NORTHBOUND));
  });

  it('is unbounded against an empty path rather than zero', () => {
    // Zero would read as a perfect match, which is the wrong answer for "there
    // was nothing to compare".
    expect(discreteFrechet([], NORTHBOUND)).toBe(Number.POSITIVE_INFINITY);
    expect(discreteFrechet(NORTHBOUND, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('handles a single-point path against a longer one', () => {
    const lone = [ORIGIN];
    // The leash has to reach the far end of the other path, so this is the
    // segment's length rather than zero.
    expect(discreteFrechet(lone, NORTHBOUND)).toBeGreaterThan(400);
  });

  it('a detour away and back exceeds the deviation, not the average', () => {
    // Fréchet reports the WORST leash, which is what a similarity threshold
    // wants: a rider who left the road for 60 m and came back did not ride it,
    // however good their average is.
    const detour = [
      ...straightPath(ORIGIN, 0, 200, 11),
      ...straightPath(offsetBy(ORIGIN, 200, 0), 90, 60, 4),
      ...straightPath(offsetBy(ORIGIN, 200, 60), 0, 100, 6),
      ...straightPath(offsetBy(ORIGIN, 300, 60), 270, 60, 4),
      ...straightPath(offsetBy(ORIGIN, 300, 0), 0, 200, 11),
    ];
    expect(discreteFrechet(detour, NORTHBOUND)).toBeGreaterThan(55);
  });
});
