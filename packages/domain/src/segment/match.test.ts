// SPDX-License-Identifier: Apache-2.0

/**
 * #66's hard cases, and the proof that the spike's two findings are fixed
 * rather than tuned around.
 *
 * The four cases #66 names — ridden twice, ridden backwards, a trace within GPS
 * error of a segment, and a segment crossing a recording gap — are the same
 * four #65 measured, asserted here against the production matcher.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '../quantities';
import { UnitError } from '../unit-error';

import {
  GAP_SECONDS,
  indexCorpus,
  matchRide,
  medianSampleSpacing,
  SIMILARITY_METRES,
  type RideTrace,
} from './match';
import { createSegment, DEFAULT_ENDPOINT_RADIUS_METRES, type Segment } from './segment';

import type { GeographicPosition } from '../quantities';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function offsetBy(
  from: GeographicPosition,
  northMetres: number,
  eastMetres: number,
): GeographicPosition {
  const latitude = from.latitude + northMetres / METRES_PER_DEGREE_LATITUDE;
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(latitude),
    degreesLongitude(from.longitude + eastMetres / perDegreeLongitude),
  );
}

/** A straight path of `points` samples, `lengthMetres` long, on `bearingDegrees`. */
function straightPath(
  from: GeographicPosition,
  bearingDegrees: number,
  lengthMetres: number,
  points: number,
): GeographicPosition[] {
  const radians = (bearingDegrees * Math.PI) / 180;
  return Array.from({ length: points }, (_unused, index) => {
    const along = (lengthMetres * index) / (points - 1);
    return offsetBy(from, along * Math.cos(radians), along * Math.sin(radians));
  });
}

/** A 500 m northbound segment, 26 points at 20 m, optionally shifted east. */
function northbound(id = 'segment-1', eastMetres = 0, radiusMetres?: number): Segment {
  const segment = createSegment({
    id,
    createdBy: 'athlete-a',
    name: id,
    sport: 'ride',
    geometry: straightPath(offsetBy(ORIGIN, 0, eastMetres), 0, 500, 26),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
  if (radiusMetres === undefined) {
    return segment;
  }
  return {
    ...segment,
    start: { ...segment.start, radius: metres(radiusMetres) },
    end: { ...segment.end, radius: metres(radiusMetres) },
  };
}

/**
 * A ride down `path`, one sample every `intervalSeconds`, with a run-in.
 *
 * The run-in matters and is not padding: `sampleHeading` needs a previous
 * position, so a ride that begins exactly on the segment's first point has no
 * direction at that sample and the endpoint gate correctly refuses it.
 */
function rideAlong(
  path: readonly GeographicPosition[],
  options: { readonly intervalSeconds?: number; readonly startTime?: number } = {},
): RideTrace {
  const interval = options.intervalSeconds ?? 1;
  const base = options.startTime ?? 1_760_000_000;
  const head = path[0];
  const positions: GeographicPosition[] = [];
  if (head !== undefined) {
    for (let lead = 5; lead > 0; lead -= 1) {
      positions.push(offsetBy(head, -lead * 20, 0));
    }
  }
  positions.push(...path);
  return {
    positions,
    times: positions.map((_unused, index) => unixSeconds(base + index * interval)),
  };
}

/** Join traces end to end, renumbering the times so they stay increasing. */
function join(...traces: readonly RideTrace[]): RideTrace {
  const positions: GeographicPosition[] = [];
  const times: number[] = [];
  for (const trace of traces) {
    for (const position of trace.positions) {
      positions.push(position);
      times.push(1_760_000_000 + times.length);
    }
  }
  return { positions, times: times.map((value) => unixSeconds(value)) };
}

/** Thin a trace to every `every`-th sample, as a coarser device would record. */
function thinnedTo(ride: RideTrace, every: number): RideTrace {
  const positions = ride.positions.filter((_unused, index) => index % every === 0);
  return {
    positions,
    times: positions.map((_unused, index) => unixSeconds(1_760_000_000 + index * every)),
  };
}

describe('#66’s four hard cases', () => {
  it('a ride that traverses a segment twice produces two efforts with distinct times', () => {
    const segment = northbound();
    const lap = rideAlong(segment.geometry);
    // The second lap is deliberately slower: two efforts that shared a time
    // would satisfy "two efforts" while hiding a matcher that reported one
    // traversal twice.
    const slower: RideTrace = {
      positions: lap.positions.flatMap((position) => [position, position]),
      times: lap.positions.flatMap((_unused, index) => [index * 2, index * 2 + 1]).map(unixSeconds),
    };
    const ride = join(lap, slower);

    const { efforts } = matchRide(ride, indexCorpus([segment]));

    expect(efforts).toHaveLength(2);
    const [first, second] = efforts;
    expect(first?.elapsed).toBeGreaterThan(0);
    expect(second?.elapsed).toBeGreaterThan(first?.elapsed ?? 0);
    expect(second?.startIndex).toBeGreaterThan(first?.endIndex ?? 0);
  });

  it('a ride that traverses a segment backwards produces no effort for the forward one', () => {
    const segment = northbound();
    const backwards = rideAlong([...segment.geometry].reverse());

    expect(matchRide(backwards, indexCorpus([segment])).efforts).toEqual([]);
    // And the ride is a real traversal of the reverse, so the rejection is
    // about direction rather than about the fixture being unmatchable.
    const reversed = createSegment({
      id: 'segment-reverse',
      createdBy: 'athlete-a',
      name: 'the other way',
      sport: 'ride',
      geometry: [...segment.geometry].reverse(),
      elevationSource: 'none',
      visibility: 'private',
      createdAt: unixSeconds(1_760_000_000),
    });
    expect(matchRide(backwards, indexCorpus([reversed])).efforts).toHaveLength(1);
  });

  it('a parallel road 30 m away is rejected at the ENDPOINT GATE, before any curve work', () => {
    // #66's third criterion, and #65's. Two false-positive shapes exist because
    // they fail at different stages; believing this one exercised stage 3 would
    // have left the similarity threshold untested behind a passing test.
    const segment = northbound();
    const parallel = rideAlong(straightPath(offsetBy(ORIGIN, 0, 30), 0, 500, 26));

    const result = matchRide(parallel, indexCorpus([segment]));

    expect(result.efforts).toEqual([]);
    expect(result.counts.afterEndpointGate).toBe(0);
  });

  it('a detour that shares both endpoints is rejected by SIMILARITY, which only stage 3 can do', () => {
    const segment = northbound();
    // Same start and end, bulging 60 m east in the middle — so the endpoint
    // gate passes it and only the curve comparison can refuse it.
    const detour = [
      ...straightPath(ORIGIN, 45, 180, 9),
      ...straightPath(offsetBy(ORIGIN, 250, 60), 315, 180, 9),
    ];
    const ride = rideAlong([
      ...segment.geometry.slice(0, 2),
      ...detour,
      ...segment.geometry.slice(-2),
    ]);

    const result = matchRide(ride, indexCorpus([segment]));

    expect(result.efforts).toEqual([]);
    expect(result.counts.afterEndpointGate).toBe(1);
  });

  it('the rider on the road itself still matches, so the threshold is not simply too tight', () => {
    const segment = northbound();
    expect(matchRide(rideAlong(segment.geometry), indexCorpus([segment])).efforts).toHaveLength(1);
  });

  it('a recording gap across the middle yields no effort, and records why', () => {
    const segment = northbound();
    const ride = rideAlong(segment.geometry);
    // A hole well past the gap threshold, halfway down the segment.
    const holeAt = 15;
    const gapped: RideTrace = {
      positions: ride.positions,
      times: ride.times.map((time, index) =>
        index < holeAt ? time : unixSeconds(time + GAP_SECONDS * 10),
      ),
    };

    const result = matchRide(gapped, indexCorpus([segment]));

    expect(result.efforts).toEqual([]);
    // The half #66 adds over #65: the athlete can be told, rather than left to
    // wonder where their effort went.
    expect(result.abandoned).toEqual([
      { segmentId: segment.id, reason: 'recording-gap', atIndex: holeAt },
    ]);
  });

  it('a gap shorter than the threshold is tolerated', () => {
    const segment = northbound();
    const ride = rideAlong(segment.geometry);
    const nudged: RideTrace = {
      positions: ride.positions,
      times: ride.times.map((time, index) =>
        index < 15 ? time : unixSeconds(time + GAP_SECONDS - 1),
      ),
    };

    const result = matchRide(nudged, indexCorpus([segment]));

    expect(result.efforts).toHaveLength(1);
    expect(result.abandoned).toEqual([]);
  });
});

describe('the spike’s finding 1 — a coarse recording interval', () => {
  it('matches at every interval a device records at, not only at 1 Hz', () => {
    // ⚠️ THE REGRESSION TEST FOR THE WHOLE ISSUE. Before #66 this collapsed
    // from matched to unmatched between a 1 s interval and a 2 s one, because a
    // fixed 15 m radius cannot catch samples 16.7 m apart. It is a cliff, not a
    // slope, so an assertion at 1 Hz alone says nothing at all.
    const segment = northbound();
    const dense = rideAlong(straightPath(ORIGIN, 0, 500, 61));
    const corpus = indexCorpus([segment]);

    for (const every of [1, 2, 5, 10]) {
      expect(matchRide(thinnedTo(dense, every), corpus).efforts).toHaveLength(1);
    }
  });

  it('the gate widens by half the spacing, which is where that comes from', () => {
    // A rider who passes exactly through an endpoint records a sample no
    // further than half the spacing from it; the gate has to cover that or the
    // radius means nothing at a coarse interval.
    expect(medianSampleSpacing(straightPath(ORIGIN, 0, 500, 26))).toBeCloseTo(20, 3);
  });

  it('takes the MEDIAN spacing, so one gap does not widen the gate for the whole ride', () => {
    // A mean would be dragged upwards by a single long step and would loosen
    // the endpoint gate everywhere on the strength of one hole.
    const withOneHugeStep = [
      ...straightPath(ORIGIN, 0, 100, 11),
      offsetBy(ORIGIN, 5000, 0),
      offsetBy(ORIGIN, 5010, 0),
    ];
    expect(medianSampleSpacing(withOneHugeStep)).toBeCloseTo(10, 3);
  });

  it('has no spacing for a ride too short to have one, and widens the gate by nothing', () => {
    expect(medianSampleSpacing([])).toBe(0);
    expect(medianSampleSpacing([ORIGIN])).toBe(0);
  });
});

describe('the spike’s finding 2 — the radius and the similarity budget are no longer coupled', () => {
  it('a perfect traversal’s deviation does not grow as the endpoint radius widens', () => {
    // ⚠️ THE OTHER REGRESSION TEST. Before #66 a span opened at the FIRST
    // sample inside the radius, so it swallowed up to `radius` metres of
    // approach road: a noise-free ride down the segment's own road scored 0 m
    // at a 15 m radius and 40 m at a 50 m one, and at 50 m nothing matched at
    // all. Bounding the span by the NEAREST sample removes the dependence.
    const path = straightPath(ORIGIN, 0, 500, 26);
    const deviations = [15, 25, 40, 50, 80].map((radius) => {
      const [effort] = matchRide(
        rideAlong(path),
        indexCorpus([northbound('s', 0, radius)]),
      ).efforts;
      expect(effort).toBeDefined();
      return effort?.deviation ?? Number.POSITIVE_INFINITY;
    });

    for (const deviation of deviations) {
      expect(deviation).toBeLessThan(SIMILARITY_METRES);
    }
    // Not merely "all under the threshold" — flat, which is the actual claim.
    expect(Math.max(...deviations) - Math.min(...deviations)).toBeLessThan(1);
  });

  it('the effort still starts at the sample nearest the start, not the first one near it', () => {
    // The mechanism, asserted directly rather than only through its effect. A
    // wide gate admits several samples; the one chosen is the closest.
    const ride = rideAlong(straightPath(ORIGIN, 0, 500, 26));
    const [effort] = matchRide(ride, indexCorpus([northbound('s', 0, 60)])).efforts;

    expect(effort).toBeDefined();
    // Index 5 is the first sample of the segment path itself: the run-in ends
    // at index 4. A first-sample-inside-the-radius matcher would open earlier.
    expect(effort?.startIndex).toBe(5);
  });
});

describe('effort timing, and what it may not do', () => {
  it('times an effort from recorded samples only', () => {
    const segment = northbound();
    const ride = rideAlong(segment.geometry);
    const [effort] = matchRide(ride, indexCorpus([segment])).efforts;

    expect(effort).toBeDefined();
    const started = ride.times[effort?.startIndex ?? 0] ?? 0;
    const finished = ride.times[effort?.endIndex ?? 0] ?? 0;
    expect(effort?.elapsed).toBe(finished - started);
    expect(effort?.startedAt).toBe(started);
    // Whole seconds, because both ends are recorded samples of a 1 Hz ride. An
    // interpolated crossing would land between them (ADR 0007 D-2.2).
    expect(Number.isInteger(effort?.elapsed)).toBe(true);
  });

  it('refuses a trace whose positions and times disagree in length', () => {
    // Silently matching the shorter prefix would produce efforts timed against
    // the wrong samples — a wrong number presented as a right one.
    const ride: RideTrace = { positions: [ORIGIN, ORIGIN], times: [unixSeconds(1)] };
    expect(() => matchRide(ride, [])).toThrow(UnitError);
  });
});

describe('the funnel narrows, and the thresholds are ours', () => {
  it('passes fewer segments to each stage than the one before', () => {
    const ridden = northbound('ridden');
    const parallel = northbound('parallel', 30);
    const elsewhere = northbound('elsewhere', 50_000);
    const result = matchRide(
      rideAlong(ridden.geometry),
      indexCorpus([ridden, parallel, elsewhere]),
    );

    expect(result.counts.corpus).toBe(3);
    // `elsewhere` is 50 km away, so the cell prefilter removes it without a
    // single distance comparison — which is the whole point of stage 1.
    expect(result.counts.afterPrefilter).toBe(2);
    expect(result.counts.afterEndpointGate).toBe(1);
    expect(result.counts.afterSimilarity).toBe(1);
  });

  it('names a similarity tolerance, a gap threshold and an endpoint radius', () => {
    // Asserted so that deleting a constant — and inlining a magic number at the
    // comparison — fails rather than passing silently. #65's last criterion.
    expect(SIMILARITY_METRES).toBe(25);
    expect(GAP_SECONDS).toBe(20);
    expect(DEFAULT_ENDPOINT_RADIUS_METRES).toBe(15);
  });

  it('finds nothing in an empty corpus rather than throwing', () => {
    expect(matchRide(rideAlong(northbound().geometry), []).efforts).toEqual([]);
  });
});
