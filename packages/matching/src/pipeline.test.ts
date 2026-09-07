// SPDX-License-Identifier: Apache-2.0

/**
 * #65's four hard cases, and its false-positive criterion.
 *
 * The issue names them explicitly — *"ridden twice in one ride, ridden
 * backwards, a road paralleling a trail, and a segment crossing a recording
 * gap"* — and asks the recommendation to speak in their terms. These are the
 * measurements behind that.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
  type Segment,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { offsetBy, straightPath, traversalOf } from '../tools/corpus';
import {
  GAP_SECONDS,
  indexCorpus,
  matchRide,
  nearestApproachIndex,
  SIMILARITY_METRES,
  type RideTrace,
} from './pipeline';

const ORIGIN: GeographicPosition = geographicPosition(
  degreesLatitude(51.5),
  degreesLongitude(-0.12),
);

/** A 500 m northbound segment, 26 points at 20 m. */
function northboundSegment(id = 'segment-1', offsetEastMetres = 0): Segment {
  return createSegment({
    id,
    createdBy: 'athlete-a',
    name: id,
    sport: 'ride',
    geometry: straightPath(offsetBy(ORIGIN, 0, offsetEastMetres), 0, 500, 26),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
}

/** Concatenate traces, renumbering the times so they stay increasing. */
function join(...traces: readonly RideTrace[]): RideTrace {
  const positions: GeographicPosition[] = [];
  const times: number[] = [];
  for (const trace of traces) {
    for (const position of trace.positions) {
      positions.push(position);
      times.push(times.length);
    }
  }
  return { positions, times };
}

describe('hard case 1 — ridden twice in one ride', () => {
  it('reports two efforts, not one', () => {
    // A matcher that stopped at the first finish would silently discard the
    // rider's second and usually faster effort, and nothing downstream could
    // tell that it had.
    const segment = northboundSegment();
    const lap = traversalOf(segment, { lead: 3 });
    const ride = join(lap, lap);

    const result = matchRide(ride, indexCorpus([segment]));
    expect(result.efforts).toHaveLength(2);
    // And they are genuinely distinct traversals, not the same span twice.
    expect(result.efforts[0]?.startIndex).not.toBe(result.efforts[1]?.startIndex);
    expect(result.efforts[1]?.startIndex ?? 0).toBeGreaterThan(result.efforts[0]?.endIndex ?? 0);
  });
});

describe('hard case 2 — ridden backwards', () => {
  it('reports no effort, and it costs no special case', () => {
    // The start gate requires direction agreement with the segment's RECORDED
    // direction, so a descending rider never opens a span at all. This is
    // `endpointReached` from #64, reused rather than reimplemented.
    const segment = northboundSegment();
    const forwards = traversalOf(segment);
    const backwards: RideTrace = {
      positions: [...forwards.positions].reverse(),
      times: forwards.times,
    };

    expect(matchRide(backwards, indexCorpus([segment])).efforts).toEqual([]);
    // The control: the same trace the right way round DOES match, so the
    // rejection above is about direction and not about the fixture.
    expect(matchRide(forwards, indexCorpus([segment])).efforts).toHaveLength(1);
  });
});

/**
 * #65's third criterion — *"a trace that runs within GPS error of a segment
 * without being on it produces no effort"* — and there are **two** shapes of
 * it, rejected at two different stages. Measuring only the first would leave
 * stage 3 untested while looking like it had been tested, so both are here.
 */
describe('hard case 3 — a road paralleling a trail (#65 criterion 3)', () => {
  it('a parallel road 30 m away is rejected at the ENDPOINT GATE, before any curve work', () => {
    // The cheap rejection, and the common one: a cycleway beside a road is
    // commonly 15–30 m from it, and 30 m is outside the 15 m endpoint radius
    // #64 chose, so the rider never approaches the segment's start closely
    // enough to open a span.
    //
    // ⚠️ This is the assertion that says WHICH stage did the work. The first
    // draft of this test asserted the parallel road reached stage 3; it does
    // not, and believing it did would have left the similarity threshold
    // untested behind a passing test.
    const road = northboundSegment('the-road', 0);
    const trail = northboundSegment('the-trail', 30);

    const result = matchRide(traversalOf(trail), indexCorpus([road]));
    expect(result.efforts).toEqual([]);
    // It DID reach the gate — so this is not the prefilter's doing either.
    expect(result.counts.afterPrefilter).toBe(1);
    expect(result.counts.afterEndpointGate).toBe(0);
  });

  it('a detour that shares both endpoints is rejected by SIMILARITY, which only stage 3 can do', () => {
    // The expensive rejection, and the one that justifies stage 3 existing.
    // This rider starts where the segment starts, heading the right way, and
    // finishes where it finishes, heading the right way — so the endpoint gate
    // passes them — but bulges 60 m east in between. Every check short of
    // comparing the curves says this is an effort.
    const segment = northboundSegment('the-climb', 0);
    const head = segment.geometry[0] as GeographicPosition;

    const detour: GeographicPosition[] = [
      ...straightPath(offsetBy(head, -60, 0), 0, 60, 4),
      ...straightPath(head, 45, 180, 9),
      ...straightPath(offsetBy(head, 127, 127), 0, 250, 13),
      ...straightPath(offsetBy(head, 377, 127), 315, 180, 9),
      ...straightPath(offsetBy(head, 500, 0), 0, 60, 4),
    ];
    const ride: RideTrace = {
      positions: detour,
      times: detour.map((_unused, index) => index),
    };

    const result = matchRide(ride, indexCorpus([segment]));
    expect(result.counts.afterEndpointGate).toBe(1);
    expect(result.counts.afterSimilarity).toBe(0);
    expect(result.efforts).toEqual([]);
  });

  it('the rider on the road itself still matches, so the threshold is not simply too tight', () => {
    const road = northboundSegment('the-road', 0);
    expect(matchRide(traversalOf(road), indexCorpus([road])).efforts).toHaveLength(1);
  });
});

describe('hard case 4 — a segment crossing a recording gap', () => {
  it('reports no effort rather than a time that includes unrecorded minutes', () => {
    const segment = northboundSegment();
    const clean = traversalOf(segment);
    // Punch a hole in the middle of the traversal by jumping the clock.
    const holed: RideTrace = {
      positions: clean.positions,
      times: clean.times.map((time, index) => (index > 15 ? time + GAP_SECONDS + 60 : time)),
    };

    expect(matchRide(holed, indexCorpus([segment])).efforts).toEqual([]);
    // The control: the same positions with no hole do match, so the rejection
    // is about the gap and not about the geometry.
    expect(matchRide(clean, indexCorpus([segment])).efforts).toHaveLength(1);
  });

  it('a gap shorter than the threshold is tolerated', () => {
    // A device recording every 10 s produces legitimate 10 s spacing. A
    // threshold that rejected that would make every such ride one long gap.
    const segment = northboundSegment();
    const clean = traversalOf(segment);
    const brief: RideTrace = {
      positions: clean.positions,
      times: clean.times.map((time, index) => (index > 15 ? time + GAP_SECONDS - 5 : time)),
    };
    expect(matchRide(brief, indexCorpus([segment])).efforts).toHaveLength(1);
  });
});

describe('the stage counts #65 asks to be reported', () => {
  it('narrows the corpus at each stage', () => {
    const ridden = northboundSegment('ridden', 0);
    // Far away: the prefilter should remove it without any geometry work.
    const elsewhere = createSegment({
      id: 'elsewhere',
      createdBy: 'athlete-a',
      name: 'elsewhere',
      sport: 'ride',
      geometry: straightPath(offsetBy(ORIGIN, 50_000, 50_000), 0, 500, 26),
      elevationSource: 'none',
      visibility: 'private',
      createdAt: unixSeconds(1_760_000_000),
    });
    // Nearby but not ridden: survives the prefilter, dies later.
    const parallel = northboundSegment('parallel', 30);

    const result = matchRide(traversalOf(ridden), indexCorpus([ridden, elsewhere, parallel]));
    expect(result.counts.corpus).toBe(3);
    expect(result.counts.afterPrefilter).toBe(2);
    expect(result.counts.afterSimilarity).toBe(1);
  });
});

describe('effort timing — nearest recorded sample, per ADR 0007 D-2.2', () => {
  it('times an effort from recorded samples only', () => {
    const segment = northboundSegment();
    const ride = traversalOf(segment);
    const [effort] = matchRide(ride, indexCorpus([segment])).efforts;
    expect(effort).toBeDefined();
    // Both ends are indices into the ride, so the elapsed time is a difference
    // of two recorded timestamps and nothing else.
    expect(effort?.elapsedSeconds).toBe(
      (ride.times[effort?.endIndex ?? 0] ?? 0) - (ride.times[effort?.startIndex ?? 0] ?? 0),
    );
    expect(Number.isInteger(effort?.elapsedSeconds)).toBe(true);
  });

  it('the interpolated control lands between the neighbouring samples, never outside', () => {
    // `nearestApproachIndex` exists to QUANTIFY what the constraint costs; it
    // must never wander outside the samples, because an index beyond a
    // neighbour is an extrapolation — the construct being measured against.
    const segment = northboundSegment();
    const ride = traversalOf(segment);
    const target = segment.start.position;
    for (let index = 1; index < ride.positions.length - 1; index += 1) {
      const interpolated = nearestApproachIndex(ride, target, index);
      if (interpolated === undefined) {
        continue;
      }
      expect(interpolated).toBeGreaterThanOrEqual(index - 1);
      expect(interpolated).toBeLessThanOrEqual(index + 1);
    }
  });

  it('has no interpolated index for a single-sample ride', () => {
    const lone: RideTrace = { positions: [ORIGIN], times: [0] };
    expect(nearestApproachIndex(lone, ORIGIN, 0)).toBeUndefined();
  });

  it('returns the middle sample exactly when the target is symmetric about it', () => {
    // The clamp test above bounds the answer; this pins it. Without a case that
    // fixes a VALUE, a control that returned its own `aroundIndex` — or a
    // constant — would satisfy every other assertion here, and the write-up's
    // §4 figure would rest on nothing. (It did: replacing this function with a
    // stub left the whole suite green until this test and its sibling in
    // `tools/measure.test.ts` existed.)
    const ride: RideTrace = {
      positions: [offsetBy(ORIGIN, -20, 0), ORIGIN, offsetBy(ORIGIN, 20, 0)],
      times: [0, 1, 2],
    };
    expect(nearestApproachIndex(ride, ORIGIN, 1)).toBeCloseTo(1, 6);
  });

  it('moves toward the neighbour the ride actually passed closer to', () => {
    // Asymmetric: the target sits nearer sample 2 than sample 0, so the vertex
    // of the parabola is on that side of sample 1. A control that ignored the
    // distances would answer 1.
    const ride: RideTrace = {
      positions: [offsetBy(ORIGIN, -40, 0), ORIGIN, offsetBy(ORIGIN, 20, 0)],
      times: [0, 1, 2],
    };
    const interpolated = nearestApproachIndex(ride, offsetBy(ORIGIN, 10, 0), 1);
    expect(interpolated).toBeGreaterThan(1);
    expect(interpolated).toBeLessThanOrEqual(2);
  });
});

describe('the thresholds are ours, and stated', () => {
  it('names a similarity tolerance and a gap threshold', () => {
    // #65's last criterion: every threshold labelled as our own tunable with
    // the reasoning. Asserted so that deleting the constant — and inlining a
    // magic number at the comparison — fails rather than passes silently.
    expect(SIMILARITY_METRES).toBe(25);
    expect(GAP_SECONDS).toBe(20);
  });
});
