// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { choosableCourses, COURSE_TEXT, coursesFor } from './courses';
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
