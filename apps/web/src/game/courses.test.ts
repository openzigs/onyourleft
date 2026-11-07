// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { circuitRouteId } from '@onyourleft/store';

import { choosableCourses, COURSE_TEXT, coursesFor } from './courses';
import { DELIVERY_COURSE_TEXT, type DeliveryCourse } from './StageChooser';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import type { RidableRoute } from './StageChooser';

const LOOP: RidableRoute = {
  id: 'loop',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};
const OUT: RidableRoute = {
  id: 'out',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};
const LAKE: RidableRoute = {
  id: 'lake',
  name: 'Lake loop',
  profile: circuitRoute(90),
  attempts: 1,
};

describe('coursesFor — #2292', () => {
  it('offers the lap race every loop, in order, and every other route after them with why', () => {
    const courses = coursesFor('lap-race', [OUT, LOOP, LAKE]);
    expect(courses.map((course) => course.route.id)).toEqual(['loop', 'lake', 'out']);
    expect(courses.map((course) => course.unavailable)).toEqual([
      undefined,
      undefined,
      COURSE_TEXT.notALoop,
    ]);
    expect(choosableCourses(courses)).toBe(2);
  });

  it('offers Delivery every saved route: the press decides on its houses, as from the setup', () => {
    const courses = coursesFor('delivery', [OUT, LOOP]);
    expect(courses.map((course) => course.route.id)).toEqual(['out', 'loop']);
    expect(choosableCourses(courses)).toBe(2);
  });

  it('offers nothing over no routes', () => {
    expect(coursesFor('lap-race', [])).toEqual([]);
    expect(choosableCourses(coursesFor('delivery', []))).toBe(0);
  });
});

describe('coursesFor with Delivery’s counts — #2294 through #2292’s seam', () => {
  const week = { houses: 8 };
  const counts = new Map<string, DeliveryCourse>([
    ['out', { kind: 'counted', houses: 12 }],
    ['loop', { kind: 'counted', houses: 2 }],
    ['lake', { kind: 'unread', state: { kind: 'off', why: 'map-tiles-off' } }],
  ]);

  it('says what a route holds, greys one that holds no round with why, and keeps the order', () => {
    const courses = coursesFor('delivery', [OUT, LOOP, LAKE], { courses: counts, week });
    expect(courses.map((course) => course.route.id)).toEqual(['out', 'loop', 'lake']);
    // Up to the day's round, not the route's twelve.
    expect(courses[0]).toEqual({ route: OUT, line: 'Delivery: up to 8 houses on the round' });
    expect(courses[1]?.unavailable).toBe(
      `${DELIVERY_COURSE_TEXT.noRound}: 2 mapped houses in reach, and a round needs 3`,
    );
    expect(courses[2]?.unavailable).toBe(
      `${DELIVERY_COURSE_TEXT.noRound}: map tiles are off in Settings`,
    );
    expect(choosableCourses(courses)).toBe(1);
  });

  it('leaves a route still being counted choosable, saying so', () => {
    const courses = coursesFor('delivery', [OUT, LAKE], { courses: new Map(), week });
    expect(courses.map((course) => course.line)).toEqual([
      DELIVERY_COURSE_TEXT.counting,
      DELIVERY_COURSE_TEXT.counting,
    ]);
    expect(choosableCourses(courses)).toBe(2);
  });
});

describe('coursesFor with the built-in circuits — #2293 through #2292’s seam', () => {
  const RING: RidableRoute = {
    id: circuitRouteId('fixture-ring'),
    name: 'Fixture ring',
    profile: circuitRoute(70),
    attempts: 0,
  };

  it('lists the circuits for the lap race after the rider’s loops and before what cannot be raced', () => {
    const courses = coursesFor('lap-race', [OUT, LOOP, LAKE], undefined, [RING]);
    expect(courses.map((course) => course.route.id)).toEqual(['loop', 'lake', RING.id, 'out']);
    expect(courses[2]).toEqual({ route: RING });
    expect(choosableCourses(courses)).toBe(3);
  });

  it('lists them to a rider with no routes of their own', () => {
    expect(coursesFor('lap-race', [], undefined, [RING])).toEqual([{ route: RING }]);
  });

  it('never lists one for Delivery, counted or not: a circuit is a lap race and nothing else', () => {
    expect(coursesFor('delivery', [OUT], undefined, [RING]).map((c) => c.route.id)).toEqual([
      'out',
    ]);
    const counted = coursesFor('delivery', [OUT], { courses: new Map(), week: { houses: 8 } }, [
      RING,
    ]);
    expect(counted.map((c) => c.route.id)).toEqual(['out']);
  });
});
