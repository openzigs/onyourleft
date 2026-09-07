// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { bearingDifference, distanceBetween, initialBearing } from '../geodesy';
import {
  degreesBearing,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '../quantities';
import { UnitError } from '../unit-error';

import {
  createSegment,
  DEFAULT_BEARING_TOLERANCE_DEGREES,
  DEFAULT_ENDPOINT_RADIUS_METRES,
  endBearing,
  endpointReached,
  MINIMUM_SEGMENT_LENGTH_METRES,
  MINIMUM_SEGMENT_POSITIONS,
  NEAR_DUPLICATE_OVERLAP,
  overlapFraction,
  OVERLAP_TOLERANCE_METRES,
  pathLength,
  sampleHeading,
  startBearing,
} from './segment';

import type { SegmentDraft } from './segment';
import type { GeographicPosition } from '../quantities';

// A degree of latitude is about 111.19 km on the sphere this package uses, so
// these two constants let a test say "300 m north" without a magic number.
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** A due-north path of `count` points spaced `spacingMetres` apart. */
function northwardPath(
  count: number,
  spacingMetres: number,
  origin = at(51.5, -0.12),
): GeographicPosition[] {
  const step = spacingMetres / METRES_PER_DEGREE_LATITUDE;
  return Array.from({ length: count }, (_unused, index) =>
    at(origin.latitude + index * step, origin.longitude),
  );
}

function draftOf(overrides: Partial<SegmentDraft> = {}): SegmentDraft {
  return {
    id: 'segment-1',
    createdBy: 'athlete-a',
    name: 'The long drag',
    sport: 'ride',
    geometry: northwardPath(21, 50),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
    ...overrides,
  };
}

describe('bearings on a sphere', () => {
  it('reports due north as 0 and due south as 180', () => {
    expect(initialBearing(at(51.5, -0.12), at(51.6, -0.12))).toBeCloseTo(0, 6);
    expect(initialBearing(at(51.5, -0.12), at(51.4, -0.12))).toBeCloseTo(180, 6);
  });

  it('reports due east as 90 and due west as 270, normalised out of atan2 range', () => {
    // `atan2` returns (-180, 180], so due west is -90 before normalisation. A
    // bearing of -90 stored on a segment would fail every direction-agreement
    // test against a real westward heading of 270.
    //
    // ⚠️ Two decimal places, not more, and the shortfall is physics rather
    // than error: a parallel of latitude is NOT a great circle, so the
    // great-circle track starting due east bows poleward and its initial
    // bearing is a few thousandths under 90. Asserting exactly 90 would be
    // asserting the flat-plane answer this function exists not to give.
    expect(initialBearing(at(51.5, -0.12), at(51.5, -0.11))).toBeCloseTo(90, 2);
    expect(initialBearing(at(51.5, -0.12), at(51.5, -0.13))).toBeCloseTo(270, 2);
  });

  it('is NOT the flat-plane atan2, which is wrong by the cosine of the latitude', () => {
    // Half a degree north and half a degree east, at 51.5 N. Treating degrees
    // as a plane makes that 45 degrees exactly. On a sphere a degree of
    // longitude is only cos(51.5) = 0.62 of a degree of latitude, so the same
    // move is much less east than it looks and the true bearing is well NORTH
    // of 45 — about 32.
    const bearing = initialBearing(at(51.5, 0), at(52, 0.5));
    expect(bearing).toBeDefined();
    expect(bearing ?? 0).toBeLessThan(45);
    expect(bearing ?? 0).toBeGreaterThan(25);
    // The flat-plane answer, for contrast — this is the value a naive
    // implementation returns, and it is more than ten degrees out. That is far
    // wider than the endpoint test's whole angular tolerance budget.
    const flat = (Math.atan2(0.5, 0.5) * 180) / Math.PI;
    expect(flat).toBeCloseTo(45, 6);
    expect(Math.abs((bearing ?? 0) - flat)).toBeGreaterThan(10);
  });

  it('has no bearing between two identical positions', () => {
    // `Math.atan2(0, 0)` is 0 rather than NaN, so an unguarded implementation
    // reports "due north" for a stationary rider and nothing looks wrong.
    expect(initialBearing(at(51.5, -0.12), at(51.5, -0.12))).toBeUndefined();
  });

  it('takes the short way round the seam, where subtraction does not', () => {
    // 358 is what `Math.abs(a - b)` returns here, and it is the bug this
    // function exists to prevent: every effort within a couple of degrees of
    // due north would be rejected.
    expect(bearingDifference(degreesBearing(359), degreesBearing(1))).toBeCloseTo(2, 9);
    expect(bearingDifference(degreesBearing(1), degreesBearing(359))).toBeCloseTo(2, 9);
  });

  it('reports 180 for exactly opposite directions', () => {
    expect(bearingDifference(degreesBearing(0), degreesBearing(180))).toBeCloseTo(180, 9);
    expect(bearingDifference(degreesBearing(270), degreesBearing(90))).toBeCloseTo(180, 9);
  });

  it('normalises a negative angle into [0, 360) rather than rejecting it', () => {
    // Every arithmetic path that produces a bearing lands outside the range:
    // atan2 goes negative, and reversing one by adding 180 goes over 360.
    expect(degreesBearing(-90)).toBe(270);
    expect(degreesBearing(450)).toBe(90);
    expect(degreesBearing(360)).toBe(0);
    expect(degreesBearing(-0)).toBe(0);
  });

  it('refuses a non-finite bearing', () => {
    expect(() => degreesBearing(Number.NaN)).toThrow(UnitError);
  });
});

describe('path geometry', () => {
  it('measures length along the path rather than end to end', () => {
    // A right-angled dog-leg: 300 m north then 300 m east. The path is 600 m
    // and the straight line is 424 m, so an implementation that measured the
    // chord would be out by nearly a third.
    const step = 300 / METRES_PER_DEGREE_LATITUDE;
    const corner = at(51.5 + step, -0.12);
    const path = [at(51.5, -0.12), corner, at(corner.latitude, -0.12 + 0.0043)];
    const along = pathLength(path);
    const chord = distanceBetween(path[0] as GeographicPosition, path[2] as GeographicPosition);
    expect(along).toBeGreaterThan(590);
    expect(along).toBeLessThan(610);
    expect(chord).toBeLessThan(along * 0.8);
  });

  it('has no length with fewer than two positions', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([at(51.5, -0.12)])).toBe(0);
  });

  it('finds a start bearing past a run of identical samples at a traffic light', () => {
    // Four identical samples then movement north. Taking positions[0] and
    // positions[1] gives a degenerate pair and no direction at all, so a
    // segment starting from a standstill would have no bearing.
    const stalled = [at(51.5, -0.12), at(51.5, -0.12), at(51.5, -0.12), at(51.6, -0.12)];
    expect(startBearing(stalled)).toBeCloseTo(0, 6);
  });

  it('finds an end bearing past identical samples, pointing INTO the last point', () => {
    // Moving north, then stationary. The end bearing must be 0 (north, the way
    // the rider was going) and not 180 (the way they came from), which is what
    // reversing the argument order would give.
    const arriving = [at(51.4, -0.12), at(51.5, -0.12), at(51.5, -0.12)];
    expect(endBearing(arriving)).toBeCloseTo(0, 6);
  });

  it('has no bearing at all when every position is identical', () => {
    const stationary = [at(51.5, -0.12), at(51.5, -0.12), at(51.5, -0.12)];
    expect(startBearing(stationary)).toBeUndefined();
    expect(endBearing(stationary)).toBeUndefined();
  });

  it('derives a sample heading from the previous position, and none at the first', () => {
    expect(sampleHeading(undefined, at(51.5, -0.12))).toBeUndefined();
    expect(sampleHeading(at(51.5, -0.12), at(51.5, -0.12))).toBeUndefined();
    expect(sampleHeading(at(51.5, -0.12), at(51.6, -0.12))).toBeCloseTo(0, 6);
  });
});

describe('the endpoint test — proximity and direction, never a line', () => {
  const endpoint = {
    position: at(51.5, -0.12),
    bearing: degreesBearing(0),
    radius: metres(DEFAULT_ENDPOINT_RADIUS_METRES),
  } as const;

  it('accepts a sample inside the radius travelling the right way', () => {
    expect(
      endpointReached(
        endpoint,
        at(51.5 + 5 / METRES_PER_DEGREE_LATITUDE, -0.12),
        degreesBearing(3),
        DEFAULT_BEARING_TOLERANCE_DEGREES,
      ),
    ).toBe(true);
  });

  it('rejects a sample outside the radius however well aimed', () => {
    expect(
      endpointReached(
        endpoint,
        at(51.5 + 200 / METRES_PER_DEGREE_LATITUDE, -0.12),
        degreesBearing(0),
        DEFAULT_BEARING_TOLERANCE_DEGREES,
      ),
    ).toBe(false);
  });

  it('rejects a rider going the other way down the same road', () => {
    // This is the whole reason a direction is stored: a descent is not the
    // climb, and without this the two share every effort.
    expect(
      endpointReached(
        endpoint,
        at(51.5, -0.12),
        degreesBearing(180),
        DEFAULT_BEARING_TOLERANCE_DEGREES,
      ),
    ).toBe(false);
  });

  it('accepts across the 0/360 seam, which subtraction would reject', () => {
    // The endpoint points due north; the rider is heading 359. If the direction
    // check were `Math.abs(a - b) <= tolerance` this is 359, and every
    // northbound segment in the corpus would be unmatchable.
    expect(
      endpointReached(
        endpoint,
        at(51.5, -0.12),
        degreesBearing(359),
        DEFAULT_BEARING_TOLERANCE_DEGREES,
      ),
    ).toBe(true);
  });

  it('treats an unknown heading as not reaching the endpoint', () => {
    // A stationary rider parked on a segment start has no direction. Admitting
    // that would hand them an effort in whichever direction they later chose.
    expect(
      endpointReached(endpoint, at(51.5, -0.12), undefined, DEFAULT_BEARING_TOLERANCE_DEGREES),
    ).toBe(false);
  });

  it('is inclusive at both tolerances, so a sample exactly on the line counts', () => {
    expect(endpointReached(endpoint, at(51.5, -0.12), degreesBearing(60), 60)).toBe(true);
    expect(endpointReached(endpoint, at(51.5, -0.12), degreesBearing(60.01), 60)).toBe(false);
  });
});

describe('overlap, for duplicate detection', () => {
  it('reports full overlap for a path against itself', () => {
    const path = northwardPath(11, 50);
    expect(overlapFraction(path, path, OVERLAP_TOLERANCE_METRES)).toBe(1);
  });

  it('reports no overlap for a road a kilometre away', () => {
    const here = northwardPath(11, 50);
    const elsewhere = northwardPath(11, 50, at(51.5, -0.135));
    expect(overlapFraction(here, elsewhere, OVERLAP_TOLERANCE_METRES)).toBe(0);
  });

  it('reports partial overlap for a path that extends past an existing one', () => {
    // Twenty points along the same road where the existing segment has ten, so
    // half the candidate is new. This is the "the climb plus the approach"
    // case, and it is above the near-duplicate threshold only when most of it
    // is shared.
    const existing = northwardPath(10, 50);
    const candidate = northwardPath(20, 50);
    const fraction = overlapFraction(candidate, existing, OVERLAP_TOLERANCE_METRES);
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
    expect(fraction).toBeLessThan(NEAR_DUPLICATE_OVERLAP);
  });

  it('does not care about direction, so the reverse of a segment is a duplicate', () => {
    // A rider creating the descent of an existing climb should be told the road
    // is already covered, even though the two are different segments.
    const climb = northwardPath(11, 50);
    const descent = [...climb].reverse();
    expect(overlapFraction(descent, climb, OVERLAP_TOLERANCE_METRES)).toBe(1);
  });

  it('reports no overlap rather than dividing by zero on an empty path', () => {
    expect(overlapFraction([], northwardPath(5, 50), OVERLAP_TOLERANCE_METRES)).toBe(0);
    expect(overlapFraction(northwardPath(5, 50), [], OVERLAP_TOLERANCE_METRES)).toBe(0);
  });
});

describe('creating a segment', () => {
  it('derives the distance, both endpoints and both bearings from the geometry', () => {
    const segment = createSegment(draftOf());
    expect(segment.distance).toBeGreaterThan(990);
    expect(segment.distance).toBeLessThan(1010);
    expect(segment.start.bearing).toBeCloseTo(0, 6);
    expect(segment.end.bearing).toBeCloseTo(0, 6);
    expect(segment.start.position).toEqual(at(51.5, -0.12));
    expect(segment.start.radius).toBe(DEFAULT_ENDPOINT_RADIUS_METRES);
    expect(segment.bearingToleranceDegrees).toBe(DEFAULT_BEARING_TOLERANCE_DEGREES);
  });

  it('copies the geometry, so mutating the caller’s array cannot reach it', () => {
    // #64's second criterion is about deleting the source ACTIVITY, which the
    // store enforces. This is the same property one layer down: the segment
    // must not alias an array somebody else still holds.
    const geometry = northwardPath(21, 50);
    const segment = createSegment(draftOf({ geometry }));
    geometry.push(at(0, 0));
    expect(segment.geometry).toHaveLength(21);
    expect(segment.geometry).not.toBe(geometry);
  });

  it('refuses a segment below the stated minimum length, naming the minimum', () => {
    // 20 points 10 m apart is 200 m, half the minimum.
    expect(() => createSegment(draftOf({ geometry: northwardPath(21, 10) }))).toThrow(
      new RegExp(String(MINIMUM_SEGMENT_LENGTH_METRES)),
    );
  });

  it('refuses a geometry with too few positions', () => {
    expect(() => createSegment(draftOf({ geometry: northwardPath(2, 1000) }))).toThrow(
      new RegExp(String(MINIMUM_SEGMENT_POSITIONS)),
    );
  });

  it('refuses a geometry that never moves', () => {
    const stationary = [at(51.5, -0.12), at(51.5, -0.12), at(51.5, -0.12)];
    expect(() => createSegment(draftOf({ geometry: stationary }))).toThrow(UnitError);
  });

  it('refuses altitudes that do not match the geometry position for position', () => {
    expect(() =>
      createSegment(draftOf({ altitudes: [1, 2, 3], elevationSource: 'device' })),
    ).toThrow(UnitError);
  });

  it('names no coordinate value in any refusal, per ADR 0004 decision D', () => {
    // The latitude below is deliberately distinctive. A message that reproduced
    // it would be publishing a position into a log line the throw site does not
    // control, which is the whole of that decision.
    const secret = 51.987_654_321;
    const tiny = [at(secret, -0.12), at(secret + 0.000_01, -0.12), at(secret + 0.000_02, -0.12)];
    let message = '';
    try {
      createSegment(draftOf({ geometry: tiny }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('51.98');
    expect(message).not.toContain('-0.12');
    // The length and the constraint ARE named, because for those the number is
    // the diagnostic.
    expect(message).toContain(String(MINIMUM_SEGMENT_LENGTH_METRES));
  });

  it('reports no elevation at all when the source carried none', () => {
    // An unmeasured climb must not read as a flat road.
    const segment = createSegment(draftOf());
    expect(segment.elevationGain).toBeUndefined();
    expect(segment.averageGrade).toBeUndefined();
    expect(segment.maximumGrade).toBeUndefined();
    expect(segment.elevationSource).toBe('none');
  });

  it('sums only the positive altitude changes into the gain', () => {
    // Up 10, down 4, up 6. The gain is 16, not the net 12 and not the total
    // variation 20.
    const geometry = northwardPath(4, 250);
    const segment = createSegment(
      draftOf({ geometry, altitudes: [100, 110, 106, 112], elevationSource: 'device' }),
    );
    expect(segment.elevationGain).toBeCloseTo(16, 6);
  });

  it('reports the steepest pair as the maximum grade', () => {
    // Three 250 m steps rising 5, 25 and 5 m. The steepest is 25/250 = 10%, and
    // the average is 35 m over 750 m = 4.67%.
    const geometry = northwardPath(4, 250);
    const segment = createSegment(
      draftOf({ geometry, altitudes: [0, 5, 30, 35], elevationSource: 'device' }),
    );
    expect(segment.maximumGrade).toBeGreaterThan(9);
    expect(segment.maximumGrade).toBeLessThan(11);
    expect(segment.averageGrade).toBeGreaterThan(4);
    expect(segment.averageGrade).toBeLessThan(5);
  });

  it('skips a gap in the altitude channel rather than scoring it as zero metres', () => {
    // The middle altitude is missing, on a road that rose steadily from 100 m
    // to 130 m. Only the one measured pair contributes: 120 -> 130 over 250 m,
    // so 10 m of gain at 4%.
    //
    // Substituting 0 for the gap would report a 100 m plunge and a 120 m climb
    // over two 250 m steps — a gain of 120 and a maximum grade of 48%, on a
    // road that never exceeded 4. Both numbers are asserted against below, so
    // the substitution cannot pass this test by accident.
    const geometry = northwardPath(4, 250);
    const withGap = createSegment(
      draftOf({
        geometry,
        altitudes: [100, Number.NaN, 120, 130],
        elevationSource: 'device',
      }),
    );
    expect(withGap.elevationGain).toBeCloseTo(10, 6);
    expect(withGap.elevationGain ?? 0).toBeLessThan(120);
    expect(withGap.maximumGrade ?? 0).toBeCloseTo(4, 3);
    expect(withGap.maximumGrade ?? 0).toBeLessThan(48);
  });

  it('reports no grade across a pair the rider did not move over', () => {
    // A stopped rider produces two identical samples, so the run is zero. The
    // altimeter still drifts, so the rise is not — and `rise / 0` is Infinity,
    // which would be stored as the maximum grade of a segment that merely
    // paused at a traffic light.
    //
    // Found by mutation: relaxing the guard from `run > 0` to `run >= 0` left
    // the whole suite green, because no fixture had a repeated position. This
    // test is that fixture.
    const geometry = [
      at(51.5, -0.12),
      at(51.5 + 250 / METRES_PER_DEGREE_LATITUDE, -0.12),
      at(51.5 + 250 / METRES_PER_DEGREE_LATITUDE, -0.12),
      at(51.5 + 500 / METRES_PER_DEGREE_LATITUDE, -0.12),
    ];
    const segment = createSegment(
      draftOf({ geometry, altitudes: [100, 105, 108, 113], elevationSource: 'device' }),
    );
    expect(Number.isFinite(segment.maximumGrade ?? 0)).toBe(true);
    // 5 m over 250 m is 2%, and the stationary pair contributes nothing to the
    // grade — while still contributing its 3 m to the gain, which is real.
    expect(segment.maximumGrade).toBeCloseTo(2, 3);
    expect(segment.elevationGain).toBeCloseTo(13, 6);
  });

  it('carries the elevation source and resolution so two segments can be compared', () => {
    const segment = createSegment(
      draftOf({
        altitudes: new Array(21).fill(0) as number[],
        elevationSource: 'dem',
        elevationResolutionMetres: 30,
      }),
    );
    expect(segment.elevationSource).toBe('dem');
    expect(segment.elevationResolutionMetres).toBe(30);
  });

  it('omits the resolution entirely rather than storing a zero for a device source', () => {
    const segment = createSegment(draftOf({ elevationSource: 'device' }));
    expect(segment.elevationResolutionMetres).toBeUndefined();
    expect('elevationResolutionMetres' in segment).toBe(false);
  });

  it('takes an endpoint radius and a bearing tolerance from the draft when given', () => {
    const segment = createSegment(
      draftOf({ endpointRadiusMetres: 40, bearingToleranceDegrees: 25 }),
    );
    expect(segment.start.radius).toBe(40);
    expect(segment.end.radius).toBe(40);
    expect(segment.bearingToleranceDegrees).toBe(25);
  });

  it('stores the tolerance on the segment, so changing the default cannot re-decide it', () => {
    // The number that decided every past effort has to travel with the segment.
    // A global constant read at match time would silently re-rank the whole
    // history the day somebody tuned it.
    const segment = createSegment(draftOf());
    expect(Object.keys(segment)).toContain('bearingToleranceDegrees');
  });

  it('stores no start line, no orientation and no OSM identifier', () => {
    // ADR 0007 D-2.1 and ADR 0012 D-1, asserted rather than promised. A key
    // added here later that matches either list fails this test, which is the
    // point: both changes would otherwise arrive looking like a feature.
    const segment = createSegment(draftOf());
    const keys = [...Object.keys(segment), ...Object.keys(segment.start)];
    for (const forbidden of ['line', 'startLine', 'orientation', 'oriented', 'plane', 'normal']) {
      expect(keys).not.toContain(forbidden);
    }
    for (const forbidden of ['wayId', 'osmId', 'nodeId', 'edgeId', 'wayIds', 'edgeIds']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
