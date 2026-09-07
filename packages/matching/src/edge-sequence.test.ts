// SPDX-License-Identifier: Apache-2.0

/**
 * Candidate 2's algorithmic half, measured against the same four hard cases the
 * geometric pipeline is measured against — so the write-up compares like with
 * like rather than comparing a measurement to a claim.
 *
 * ⚠️ **This assumes a perfect snapper**, which is the half that cannot be
 * measured here. See `edge-sequence.ts` for the three blockers. Everything
 * below is therefore an *upper bound* on candidate 2.
 */

import { describe, expect, it } from 'vitest';

import { findTraversals, reversed, type EdgeStep } from './edge-sequence';

/** A path along consecutive edges, all in the forward direction. */
function along(...edges: readonly number[]): EdgeStep[] {
  return edges.map((edge) => ({ edge, forward: true }));
}

const SEGMENT = along(10, 11, 12);

describe('the four hard cases, under edge sequences', () => {
  it('hard case 1 — ridden twice yields two occurrences', () => {
    const ride = along(1, 10, 11, 12, 5, 6, 10, 11, 12, 7);
    expect(findTraversals(ride, SEGMENT)).toEqual([1, 6]);
  });

  it('hard case 2 — ridden backwards yields none, by construction', () => {
    // Direction is part of an edge step's identity, so the reverse traversal
    // shares no element with the forward one. This is the case #65 says edge
    // sequences make "tractable in a way geometric tolerance does not" — there
    // is no tolerance involved at all.
    const ride = [...along(1), ...reversed(SEGMENT), ...along(7)];
    expect(findTraversals(ride, SEGMENT)).toEqual([]);
    // And the reverse IS found when that is what is looked for, so the
    // rejection above is about direction rather than about the fixture.
    expect(findTraversals(ride, reversed(SEGMENT))).toEqual([1]);
  });

  it('hard case 3 — a parallel road is a different edge, so there is nothing to tune', () => {
    // The strongest argument for candidate 2. A cycleway beside a road is a
    // DIFFERENT WAY in the graph, so the false positive the geometric pipeline
    // spends a 25 m threshold defending against cannot arise: no distance is
    // compared, and no tolerance exists to be widened by someone chasing a
    // miss rate.
    const onTheCycleway = along(1, 90, 91, 92, 7);
    expect(findTraversals(onTheCycleway, SEGMENT)).toEqual([]);
  });

  it('hard case 4 — a gap breaks contiguity, so a partial traversal is not an effort', () => {
    // The rider rejoined the road after leaving it. Contiguous matching says
    // that is not a traversal; a gappy subsequence match would report an
    // effort for a rider who cut the corner.
    const cutTheCorner = along(10, 11, 55, 12);
    expect(findTraversals(cutTheCorner, SEGMENT)).toEqual([]);
  });
});

describe('the matcher itself', () => {
  it('finds a traversal at the start and at the end of a ride', () => {
    expect(findTraversals(along(10, 11, 12, 5), SEGMENT)).toEqual([0]);
    expect(findTraversals(along(5, 10, 11, 12), SEGMENT)).toEqual([1]);
  });

  it('finds nothing in a ride shorter than the segment', () => {
    expect(findTraversals(along(10, 11), SEGMENT)).toEqual([]);
  });

  it('finds nothing for an empty needle rather than everything', () => {
    // An empty needle occurs at every position under the usual definition,
    // which would report an effort on a segment with no geometry.
    expect(findTraversals(along(1, 2, 3), [])).toEqual([]);
  });

  it('does not match the same edge traversed the other way within a longer ride', () => {
    const mixed: EdgeStep[] = [
      { edge: 10, forward: true },
      { edge: 11, forward: false },
      { edge: 12, forward: true },
    ];
    expect(findTraversals(mixed, SEGMENT)).toEqual([]);
  });

  it('reverses a path by flipping every step and the order', () => {
    expect(reversed(along(1, 2, 3))).toEqual([
      { edge: 3, forward: false },
      { edge: 2, forward: false },
      { edge: 1, forward: false },
    ]);
  });

  it('is its own inverse', () => {
    expect(reversed(reversed(SEGMENT))).toEqual(SEGMENT);
  });
});
