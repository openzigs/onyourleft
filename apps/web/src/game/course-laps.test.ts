// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  courseEndEvent,
  courseLapsDone,
  courseLineEvent,
  courseProgressEvent,
} from './course-laps';
import { planLap } from './hud/plan';

/**
 * A kilometre out and back — 500 m up a 40 m climb and down again — so its
 * two ends meet and it is honestly a loop, and rideable as a one-way course.
 */
function course(loop: boolean): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const out = index <= 50 ? index : 100 - index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(out * 0.8),
    });
  }
  return routeProfile(points, { loop });
}

const LOOP = course(true);
const ONE_WAY = course(false);
const LENGTH = LOOP.totalDistance as number;

describe('courseLapsDone — #1312', () => {
  it('counts every crossing of a loop’s line, by the odometer', () => {
    expect(courseLapsDone(LOOP, 0)).toBe(0);
    expect(courseLapsDone(LOOP, LENGTH - 1)).toBe(0);
    expect(courseLapsDone(LOOP, LENGTH)).toBe(1);
    expect(courseLapsDone(LOOP, LENGTH * 3 + 10)).toBe(3);
  });

  it('agrees with the lap the HUD says the rider is on', () => {
    for (const distance of [0, LENGTH - 1, LENGTH, LENGTH * 2.5]) {
      expect(courseLapsDone(LOOP, distance) + 1).toBe(planLap(LOOP, distance));
    }
  });

  it('counts a point-to-point course once, however far past its end the odometer runs', () => {
    expect(courseLapsDone(ONE_WAY, LENGTH - 1)).toBe(0);
    expect(courseLapsDone(ONE_WAY, LENGTH)).toBe(1);
    expect(courseLapsDone(ONE_WAY, LENGTH * 4)).toBe(1);
  });
});

describe('courseLineEvent — #1312', () => {
  it('says nothing on a frame that crossed no line', () => {
    expect(courseLineEvent(LOOP, 0, LENGTH - 1)).toBeUndefined();
    expect(courseLineEvent(LOOP, 1, LENGTH + 200)).toBeUndefined();
    expect(courseLineEvent(ONE_WAY, 1, LENGTH * 2)).toBeUndefined();
  });

  it('ends a whole lap of the course’s own length and climb at a loop’s line, and begins another', () => {
    expect(courseLineEvent(LOOP, 0, LENGTH + 0.5)).toEqual({
      kind: 'lap',
      distance: LOOP.totalDistance,
      ascent: LOOP.totalAscent,
      partial: false,
      again: true,
    });
    expect(LOOP.totalAscent as number).toBeGreaterThan(30);
  });

  it('ends one lap at the end of a point-to-point course, and begins no other', () => {
    expect(courseLineEvent(ONE_WAY, 0, LENGTH)).toMatchObject({ partial: false, again: false });
  });

  it('is one event however far a corrected odometer jumped', () => {
    expect(courseLineEvent(LOOP, 0, LENGTH * 3)).toMatchObject({ distance: LOOP.totalDistance });
  });
});

describe('courseEndEvent — #1312', () => {
  it('is a part lap, as far as the rider got and what that stretch climbs', () => {
    const event = courseEndEvent(LOOP, LENGTH * 2 + 250);

    expect(event).toMatchObject({ kind: 'lap', partial: true, again: false });
    if (event.kind !== 'lap') throw new Error('expected a part lap');
    expect(event.distance).toBeCloseTo(250, 6);
    // A quarter of the way round: half the climb, not all of it.
    expect(event.ascent as number).toBeGreaterThan(15);
    expect(event.ascent as number).toBeLessThan(25);
  });

  it('is a part lap for a point-to-point course the rider did not finish', () => {
    expect(courseEndEvent(ONE_WAY, 600)).toMatchObject({ distance: 600, partial: true });
  });

  it('is no lap at all for a ride that ended on the line, or never left it', () => {
    expect(courseEndEvent(LOOP, 0)).toEqual({ kind: 'ended' });
    expect(courseEndEvent(LOOP, LENGTH * 2)).toEqual({ kind: 'ended' });
  });

  it('is no lap after a point-to-point course was finished: the road ended there', () => {
    expect(courseEndEvent(ONE_WAY, LENGTH + 300)).toEqual({ kind: 'ended' });
  });
});

describe('courseProgressEvent — #1322', () => {
  it('is how far round the lap in progress, and what that stretch climbs: the part lap an end would close', () => {
    const end = courseEndEvent(LOOP, LENGTH * 2 + 250);
    if (end.kind !== 'lap') throw new Error('expected a part lap');
    expect(courseProgressEvent(LOOP, LENGTH * 2 + 250)).toEqual({
      kind: 'progress',
      distance: end.distance,
      ascent: end.ascent,
    });
    expect(courseProgressEvent(ONE_WAY, 600)).toMatchObject({ kind: 'progress', distance: 600 });
  });

  it('says nothing on the line, or after a point-to-point course was finished', () => {
    expect(courseProgressEvent(LOOP, 0)).toBeUndefined();
    expect(courseProgressEvent(LOOP, LENGTH)).toBeUndefined();
    expect(courseProgressEvent(ONE_WAY, LENGTH + 300)).toBeUndefined();
  });
});
