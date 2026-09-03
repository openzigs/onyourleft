// SPDX-License-Identifier: Apache-2.0

/**
 * Passing the wrong identifier to an athlete-scoped read is a **compile**
 * error.
 *
 * ## How this file asserts that, and why it is not a runtime test
 *
 * Every case below is a `// @ts-expect-error` directive over a call that must
 * not typecheck. The assertion is the directive itself: if the call ever starts
 * to compile, TypeScript reports `TS2578: Unused '@ts-expect-error' directive`,
 * `pnpm run typecheck` fails, and CI fails with it. This file is inside
 * `packages/store/tsconfig.json`'s program, so that is not hypothetical.
 *
 * The inversion is the point, and it matters more here than it does for a unit.
 * Every scoped read in this package takes an athlete id and an entity id side
 * by side, both are strings at runtime, and transposing them is the
 * cross-athlete exposure `CLAUDE.md` section 6 names — the defect that "passes
 * every single-athlete test in the suite". A runtime test cannot express it:
 * by the time a test runs, the brand has erased and the transposed call is two
 * plain strings, so it would simply return nothing and look like a miss.
 *
 * The `expect(...)` calls exist only to give each directive a statement to sit
 * over; the runtime result is not the assertion.
 */

import { describe, expect, it } from 'vitest';

import { openActivityStore, type ActivityId, type AthleteId } from './index';
import { activityId, athleteId, lapId } from './ids';

const store = openActivityStore('oyl-id-safety-typecheck-only');
const owner = athleteId('athlete-a');
const activity = activityId('activity-1');

describe('a bare string is not an identifier', () => {
  it('does not accept an unvalidated string where an athlete id is required', async () => {
    // @ts-expect-error a plain string has not been through the constructor
    await expect(store.getActivity('athlete-a', activity)).resolves.toBeUndefined();
  });

  it('accepts the same string once it has been through the constructor', async () => {
    await expect(store.getActivity(owner, activity)).resolves.toBeUndefined();
  });
});

describe('two identifiers are not interchangeable, however alike the strings look', () => {
  it('does not accept an activity id where an athlete id is required', async () => {
    // @ts-expect-error transposing the two arguments is the cross-athlete defect
    await expect(store.getActivity(activity, owner)).resolves.toBeUndefined();
  });

  it('does not accept a lap id where an activity id is required', async () => {
    // @ts-expect-error a lap id is not an activity id
    await expect(store.listLaps(owner, lapId('lap-1'))).resolves.toEqual([]);
  });

  it('does not accept an athlete id where an activity id is required', async () => {
    // @ts-expect-error deleting "the activity with this athlete's id" is meaningless
    await expect(store.deleteActivity(owner, owner)).resolves.toBe(false);
  });
});

describe('the brands are not assignable to each other through a variable', () => {
  it('does not let an ActivityId be held in an AthleteId', () => {
    // @ts-expect-error the phantom entity differs, so the two types are disjoint
    const misfiled: AthleteId = activity;
    expect(typeof misfiled).toBe('string');
  });

  it('does not let an AthleteId be held in an ActivityId', () => {
    // @ts-expect-error the phantom entity differs, so the two types are disjoint
    const misfiled: ActivityId = owner;
    expect(typeof misfiled).toBe('string');
  });
});
