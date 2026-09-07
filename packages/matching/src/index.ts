// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/matching` — **the #65 spike, and throwaway by design.**
 *
 * ⚠️ **Nothing imports this package and nothing should.** It exists so that
 * #65's recommendation rests on measurements from runnable code rather than on
 * estimates, and #66 either hardens it into a real matcher or deletes it. The
 * durable deliverable is `docs/spikes/0001-segment-matching.md`; this is its
 * evidence.
 *
 * Read `README.md` before reusing anything here. The short version: the
 * pipeline is honest and the thresholds are ours, but the corpus is synthetic,
 * the road-graph candidate is stubbed at its hardest step, and nothing has been
 * tried against a real GNSS trace.
 */

export { CELL_DEGREES, cellCover, cellOf, coversIntersect, type CellId } from './grid';
export { directedHausdorff, discreteFrechet } from './frechet';
export {
  GAP_SECONDS,
  indexCorpus,
  matchRide,
  nearestApproachIndex,
  SIMILARITY_METRES,
  type Effort,
  type IndexedSegment,
  type MatchResult,
  type RideTrace,
  type StageCounts,
} from './pipeline';
export { findTraversals, reversed, type EdgeId, type EdgeStep } from './edge-sequence';
