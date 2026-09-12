// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The three rejections, one test each, plus the anchor behaviour that is the
 * reason two of the three work at all.
 *
 * Every fixture here is built from a straight eastward line at the equator, so
 * the expected distance is arithmetic a reviewer can check rather than a number
 * read out of a previous run: at latitude 0 a degree of longitude is
 * `EARTH_MEAN_RADIUS_METRES * π / 180` metres, and {@link eastOf} converts a
 * distance in metres back into the longitude that produces it.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  EARTH_MEAN_RADIUS_METRES,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import type { TrackPoint } from '@onyourleft/fit';

import {
  distanceAlongTrack,
  IMPLAUSIBLE_SPEED_METRES_PER_SECOND,
  POSITION_GAP_SECONDS,
  STATIONARY_SPEED_METRES_PER_SECOND,
} from './track-distance';

/** Metres per degree of longitude on the equator, from the sphere this program uses. */
const METRES_PER_DEGREE = (EARTH_MEAN_RADIUS_METRES * Math.PI) / 180;

/** A position `metresEast` along the equator from the prime meridian. */
function eastOf(metresEast: number): GeographicPosition {
  return geographicPosition(degreesLatitude(0), degreesLongitude(metresEast / METRES_PER_DEGREE));
}

/** One track point: when, and how far east. `undefined` east means no position. */
function fix(at: number, metresEast: number | undefined): TrackPoint {
  return {
    timestamp: unixSeconds(at),
    position: metresEast === undefined ? undefined : eastOf(metresEast),
    altitude: undefined,
    distance: undefined,
    speed: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
    temperature: undefined,
  };
}

describe('distanceAlongTrack — a track with nothing wrong with it', () => {
  it('sums the separations of consecutive fixes', () => {
    // Ten seconds at 10 m/s: a hundred metres, and every rule above lets it
    // through. This is the assertion #231 is about — a file carrying positions
    // and no distance of any kind reports the distance it carries.
    const points = Array.from({ length: 11 }, (_, index) => fix(1000 + index, index * 10));

    expect(distanceAlongTrack(points)).toBeCloseTo(100, 6);
  });

  it('derives nothing from a track with no positions at all, and does not fail', () => {
    // An indoor trainer ride. Zero is the honest answer and a refusal would be
    // wrong: half this product is indoors.
    const points = Array.from({ length: 60 }, (_, index) => fix(1000 + index, undefined));

    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('needs two positioned fixes, and one is not a distance', () => {
    expect(distanceAlongTrack([fix(1000, 0)])).toBe(0);
    expect(distanceAlongTrack([])).toBe(0);
  });

  it('measures across points that carry a time and no position', () => {
    // An indoor `<trkpt>` in the middle of an outdoor file, or a fix the
    // decoder dropped because it carried a lat with no lon. The interval is
    // still real clock time, so the ground either side of it is real ground.
    const points = [fix(1000, 0), fix(1001, undefined), fix(1002, 20)];

    expect(distanceAlongTrack(points)).toBeCloseTo(20, 6);
  });
});

describe('distanceAlongTrack — a gap is a hole, not a straight line', () => {
  it('does not integrate across an interval longer than the gap rule allows', () => {
    // Ten minutes between two fixes six kilometres apart. Summing it files a
    // 36 km/h sprint the rider never rode; the issue names exactly this.
    const points = [fix(1000, 0), fix(1000 + 600, 6000)];

    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('re-anchors after a gap so the rest of the ride still counts', () => {
    // 100 m ridden, a ten-minute hole, then another 100 m. The hole is not
    // bridged and the ground on the far side is not lost — holding the old
    // anchor would reject every remaining step and report 100 m for a ride
    // that covered at least 200.
    const before = Array.from({ length: 11 }, (_, index) => fix(1000 + index, index * 10));
    const after = Array.from({ length: 11 }, (_, index) => fix(2000 + index, 50_000 + index * 10));

    expect(distanceAlongTrack([...before, ...after])).toBeCloseTo(200, 6);
  });

  it('bridges an interval exactly on the limit and refuses the second past it', () => {
    // The boundary itself, because `>` and `>=` are one character apart and the
    // difference between them is invisible to every other test here.
    const onTheLimit = [fix(1000, 0), fix(1000 + POSITION_GAP_SECONDS, 500)];
    const pastIt = [fix(1000, 0), fix(1000 + POSITION_GAP_SECONDS + 1, 500)];

    expect(distanceAlongTrack(onTheLimit)).toBeCloseTo(500, 6);
    expect(distanceAlongTrack(pastIt)).toBe(0);
  });
});

describe('distanceAlongTrack — drift at rest is not a ride', () => {
  it('adds nothing for a receiver wandering under the stationary threshold', () => {
    // Five minutes on a table at 1 Hz, wandering half a metre each way. Summed
    // blindly this is 150 m of ride that never happened; the anchor is what
    // makes it nothing at all rather than merely less.
    const points = Array.from({ length: 300 }, (_, index) =>
      fix(1000 + index, index % 2 === 0 ? 0 : 0.5),
    );

    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('measures drift from the anchor, not from the point before it', () => {
    // ⚠️ The case a per-step filter passes and this one rejects: every step is
    // 0.6 m — under the threshold — and they all point the same way, so a
    // filter that advanced its anchor each time would compare 0.6 m against
    // 0.6 m forever while the receiver walked 60 m down the road. Measured from
    // the anchor the displacement grows and the ride is counted once it is
    // moving faster than a stopped bike.
    const points = Array.from({ length: 101 }, (_, index) => fix(1000 + index, index * 0.6));

    // 0.6 m/s never clears the threshold no matter how long it runs, so the
    // only thing that ever advances the anchor is the gap rule at 60 s.
    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('counts a rider who is slow but moving', () => {
    // 1.5 m/s — 5.4 km/h — is a rider on a wall, not a receiver on a table, and
    // the threshold is set below it on purpose.
    const points = Array.from({ length: 61 }, (_, index) => fix(1000 + index, index * 1.5));

    expect(distanceAlongTrack(points)).toBeCloseTo(90, 6);
  });

  it('puts the line where the constant says, a shade either side of it', () => {
    // ⚠️ Not a step *exactly* on the threshold: a haversine distance lands a
    // few ulps either side of any round number, so "exactly on" would pin
    // nothing but the rounding. What this does pin is where the line is —
    // moving the constant in either direction turns one of these two red.
    const under = [fix(1000, 0), fix(1001, STATIONARY_SPEED_METRES_PER_SECOND * 0.99)];
    const over = [fix(1000, 0), fix(1001, STATIONARY_SPEED_METRES_PER_SECOND * 1.01)];

    expect(distanceAlongTrack(under)).toBe(0);
    expect(distanceAlongTrack(over)).toBeCloseTo(STATIONARY_SPEED_METRES_PER_SECOND * 1.01, 6);
  });
});

describe('distanceAlongTrack — a fix that jumped is not a rider', () => {
  it('rejects a step no bicycle has ever ridden', () => {
    // Five kilometres in a second. A receiver that lost lock and reacquired
    // against the wrong satellites does this, and two such fixes add ten
    // kilometres to a ride.
    const points = [fix(1000, 0), fix(1001, 5000)];

    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('steps over a lone bad fix and keeps the ground on either side of it', () => {
    // A ride at 10 m/s with one fix five kilometres out to sea. Both steps
    // touching it are rejected; the anchor stays put, so the real ten metres
    // between its neighbours is measured rather than lost with it.
    const points = [fix(1000, 0), fix(1001, 10), fix(1002, 5000), fix(1003, 30), fix(1004, 40)];

    expect(distanceAlongTrack(points)).toBeCloseTo(40, 6);
  });

  it('puts the line where the constant says, a shade either side of it', () => {
    const under = [fix(1000, 0), fix(1001, IMPLAUSIBLE_SPEED_METRES_PER_SECOND * 0.99)];
    const over = [fix(1000, 0), fix(1001, IMPLAUSIBLE_SPEED_METRES_PER_SECOND * 1.01)];

    expect(distanceAlongTrack(under)).toBeCloseTo(IMPLAUSIBLE_SPEED_METRES_PER_SECOND * 0.99, 6);
    expect(distanceAlongTrack(over)).toBe(0);
  });
});

describe('distanceAlongTrack — a clock that does not move forward', () => {
  it('adds nothing for two fixes in the same second and keeps the anchor', () => {
    // A duplicate timestamp is not an interval a speed can be judged over. The
    // anchor holds, so the next fix that does carry time forward is measured
    // from a real position rather than from whichever duplicate came last.
    const points = [fix(1000, 0), fix(1000, 500), fix(1001, 20)];

    expect(distanceAlongTrack(points)).toBeCloseTo(20, 6);
  });

  it('adds nothing for a timestamp that goes backwards', () => {
    const points = [fix(1000, 0), fix(995, 100)];

    expect(distanceAlongTrack(points)).toBe(0);
  });

  it('ignores a point with no timestamp at all', () => {
    const untimed: TrackPoint = { ...fix(0, 500), timestamp: undefined };
    const points = [fix(1000, 0), untimed, fix(1001, 20)];

    expect(distanceAlongTrack(points)).toBeCloseTo(20, 6);
  });
});
