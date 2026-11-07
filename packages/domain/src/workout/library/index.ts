// SPDX-License-Identifier: Apache-2.0

/**
 * The built-in workout library — #2300, under the library epic #2295.
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

import { ENDURANCE_WORKOUTS } from './endurance';
import { OVER_UNDER_WORKOUTS } from './over-under';
import { RECOVERY_WORKOUTS } from './recovery';
import { SWEET_SPOT_WORKOUTS } from './sweet-spot';
import { TEMPO_WORKOUTS } from './tempo';
import { THRESHOLD_WORKOUTS } from './threshold';

/** Every built-in workout, easiest category first. */
export const BUILT_IN_WORKOUTS: readonly WorkoutTemplate[] = [
  ...RECOVERY_WORKOUTS,
  ...ENDURANCE_WORKOUTS,
  ...TEMPO_WORKOUTS,
  ...SWEET_SPOT_WORKOUTS,
  ...THRESHOLD_WORKOUTS,
  ...OVER_UNDER_WORKOUTS,
];
