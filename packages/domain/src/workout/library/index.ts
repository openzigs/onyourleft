// SPDX-License-Identifier: Apache-2.0

/**
 * The built-in workout library — #2300 (recovery to over-unders) and #2301
 * (VO₂ to race simulation), under the library epic #2295.
 *
 * ## What this is
 *
 * Templates a rider picks and tailors (`tailorWorkout`, `template.ts`) into an
 * ordinary workout. They are TypeScript constants shipped in the app, so the
 * library works with no instance and no network (CLAUDE.md §1 a), and a
 * built-in is never synced; a copy a rider saves syncs like any workout.
 *
 * ## Whose words these are
 *
 * The owner's ruling R-1 on #2295 (spike 0038): an **authored** library,
 * nothing vendored. Every structure here is a training fact — "2 × 20 min at
 * 0.95 of threshold" — written in this project's own words, and every name is
 * plainly descriptive. No name or summary is another product's, and none
 * carries a load-metric mark (`docs/agents/scope-and-ip.md` §6). The
 * catalogue gates (`catalogue.test.ts`) enforce that over every template here,
 * by enumeration, so a template added to this list cannot skip them.
 *
 * ## Adding a template
 *
 * Put it in its category's file, in our own words, and run the catalogue
 * gates: they check that it tailors with its defaults and at every length its
 * strategy allows, that its id and name are new, that its targets match its
 * category, and that its name and summary are clear of the banned list. A new
 * id is added to the gate's list of known ids, which is how a renamed id —
 * one a rider's browse history or a link may hold — shows up as a change.
 */

import type { WorkoutTemplate } from '../template';

import { ANAEROBIC_WORKOUTS } from './anaerobic';
import { ENDURANCE_WORKOUTS } from './endurance';
import { OVER_UNDER_WORKOUTS } from './over-under';
import { PYRAMID_WORKOUTS } from './pyramid';
import { RACE_SIMULATION_WORKOUTS } from './race-simulation';
import { RECOVERY_WORKOUTS } from './recovery';
import { SPRINT_WORKOUTS } from './sprint';
import { SWEET_SPOT_WORKOUTS } from './sweet-spot';
import { TEMPO_WORKOUTS } from './tempo';
import { THRESHOLD_TESTS } from './test';
import { THRESHOLD_WORKOUTS } from './threshold';
import { VO2_WORKOUTS } from './vo2';

/**
 * Every built-in workout, easiest category first, and the two threshold tests
 * (#2303, `test.ts`) after them: a test is not a training category, and its
 * estimate is what every other template here is a share of.
 */
export const BUILT_IN_WORKOUTS: readonly WorkoutTemplate[] = [
  ...RECOVERY_WORKOUTS,
  ...ENDURANCE_WORKOUTS,
  ...TEMPO_WORKOUTS,
  ...SWEET_SPOT_WORKOUTS,
  ...THRESHOLD_WORKOUTS,
  ...OVER_UNDER_WORKOUTS,
  ...VO2_WORKOUTS,
  ...ANAEROBIC_WORKOUTS,
  ...SPRINT_WORKOUTS,
  ...PYRAMID_WORKOUTS,
  ...RACE_SIMULATION_WORKOUTS,
  ...THRESHOLD_TESTS.map((test) => test.template),
];
