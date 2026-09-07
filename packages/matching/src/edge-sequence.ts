// SPDX-License-Identifier: Apache-2.0

/**
 * Candidate 2 (#65): **map-matched edge-ID subsequence containment**, with the
 * map matching itself stubbed out.
 *
 * ## What this measures and what it deliberately does not
 *
 * #65 describes candidate 2 as: snap both the ride and the segment to an OSM
 * way sequence, then compare edge-ID subsequences — which "turns curve matching
 * into subsequence matching on integers, and makes 'ridden twice', 'ridden
 * backwards' and 'parallel trail vs road' tractable in a way geometric
 * tolerance does not."
 *
 * That claim has two halves and they are **not equally checkable here**:
 *
 * | Half | Status |
 * |---|---|
 * | Once you have edge sequences, subsequence matching settles the four hard cases | **measured below** |
 * | You can get edge sequences | ⚠️ **not measured — see the blocker** |
 *
 * So what follows is an *upper bound* on candidate 2: it assumes a perfect
 * snapper and shows what perfect snapping would buy. Anything the real thing
 * does is worse. That framing matters, because a subsequence matcher over
 * correct edge ids looks flawless, and a reader who mistakes this for a
 * measurement of candidate 2 would conclude it wins outright.
 *
 * ## ⚠️ The blocker, which is a finding rather than an excuse
 *
 * Producing edge ids needs an OSM extract and a Hidden Markov map matcher —
 * Valhalla's Meili or `cyang-kth/fmm`, both implementations of **Newson, P. and
 * Krumm, J., *Hidden Markov Map Matching Through Noise and Sparseness*, ACM
 * SIGSPATIAL GIS 2009, pp. 336–343** (the citation ADR 0007 D-6 requires, and
 * sixteen months earlier than the 2011-03-31 priority of the '922 family).
 *
 * Three things stand between that and Phase 1, and only the first is temporary:
 *
 * 1. **Neither engine is installable in this environment.** Both are native
 *    services; the egress proxy blocks the OSM extract downloads either would
 *    need.
 * 2. **Neither runs in a browser.** Phase 1 has no server at all — owner
 *    decision D6 — so a matcher that requires a routing service cannot ship in
 *    the milestone that #66 lands in. It becomes possible with #7, not before.
 * 3. **A stored edge-id table is an ODbL Derivative Database.** ADR 0012 D-3:
 *    it goes in its own object store, licensed ODbL, never as fields on
 *    `SegmentRecord` — and every self-hoster then inherits an obligation.
 *
 * The write-up weighs all three. This file exists so the algorithmic half is
 * argued from a number rather than from the issue's prose.
 */

/**
 * An edge of a road graph. An integer, because that is the whole point — the
 * comparison below is integer equality, not geometry.
 */
export type EdgeId = number;

/**
 * A directed traversal of an edge. **Direction is part of the identity**, which
 * is how "ridden backwards" is answered for free: the reverse traversal is a
 * different pair, so a descent shares no element with the climb.
 */
export interface EdgeStep {
  readonly edge: EdgeId;
  readonly forward: boolean;
}

/** Whether two steps are the same traversal of the same edge. */
function sameStep(a: EdgeStep, b: EdgeStep): boolean {
  return a.edge === b.edge && a.forward === b.forward;
}

/**
 * Every position at which `needle` occurs as a **contiguous** subsequence of
 * `haystack`.
 *
 * Contiguous rather than merely order-preserving, and that is the right
 * reading: a rider who left the segment's road and rejoined it did not ride the
 * segment. A gappy subsequence match would report an effort for a rider who cut
 * a corner, which is a false positive of exactly the kind #65's third criterion
 * is about.
 *
 * ⚠️ **Naïve O(n·m), deliberately.** Knuth–Morris–Pratt would make it O(n+m)
 * and is the obvious production choice; it is not here because what the
 * measurement compares is *stage fan-out*, and an asymptotically better string
 * search would change candidate 2's constant without changing which candidate
 * survives the three blockers above. Writing KMP for throwaway code would be
 * optimising the losing branch.
 *
 * @returns the start index of each occurrence, so "ridden twice" is a length-2
 * result rather than a boolean that discards the second effort.
 */
export function findTraversals(
  haystack: readonly EdgeStep[],
  needle: readonly EdgeStep[],
): number[] {
  if (needle.length === 0 || haystack.length < needle.length) {
    return [];
  }
  const found: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (const [offset, step] of needle.entries()) {
      const candidate = haystack[start + offset];
      if (candidate === undefined || !sameStep(candidate, step)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      found.push(start);
    }
  }
  return found;
}

/**
 * The reverse traversal of a path — every step in the opposite order, each
 * flipped.
 *
 * Used by the test that shows a descent matches nothing. It is two lines, and
 * that is the point being made: under edge sequences, direction is not a
 * tolerance to tune but a property of the data.
 */
export function reversed(path: readonly EdgeStep[]): EdgeStep[] {
  return [...path].reverse().map((step) => ({ edge: step.edge, forward: !step.forward }));
}
