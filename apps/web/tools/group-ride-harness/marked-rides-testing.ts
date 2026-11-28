// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for #3309: **the pass marks, held in `pnpm run test`**. Each
 * `marks.<course>.test.ts` calls {@link holdMarksOn} for its course, so the
 * three courses run in parallel; each rider with a mark there is one case,
 * ridden exactly as the command rides it
 * (`main.ts` §`runHarness`), and goes red when a mark is broken.
 */

import { describe, expect, it } from 'vitest';

import { HARNESS_COURSES } from './courses';
import { markLine } from './main';
import { marksFor, markRide, type CourseName } from './marks';
import { rideScripted } from './ride';
import { SCRIPTED_RIDERS } from './riders';
import { scoreRide } from './score';

/** One case for each rider with a mark on `course`, holding every mark it has there. */
export function holdMarksOn(course: CourseName): void {
  const fixture = HARNESS_COURSES.find((each) => each.name === course);
  if (fixture === undefined) throw new Error('no such course');
  const marked = SCRIPTED_RIDERS.filter((rider) => marksFor(rider, course).length > 0);
  describe(`the pass marks on the ${course} course`, () => {
    it.each(marked)('%s holds every mark it has', (rider) => {
      const results = markRide(rider, course, scoreRide(rideScripted({ rider, course: fixture })));
      expect(results.length).toBeGreaterThan(0);
      // The lines the command prints, so a red case says which mark and why.
      expect(results.filter((each) => !each.passed).map(markLine)).toEqual([]);
    });
  });
}
