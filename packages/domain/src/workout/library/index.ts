// SPDX-License-Identifier: Apache-2.0

/**
 * The built-in workout library — epic #2295. One file per category; this
 * list is every template the app ships, and the catalogue tests enumerate it
 * rather than naming templates, so a template added here cannot go untested.
 *
 * ⚠️ #2300 (the aerobic half and the catalogue gates) and #2301 (the
 * high-intensity half) add their categories to this list. #2302 landed the
 * cadence drills first.
 */

import type { WorkoutTemplate } from '../template';

import { CADENCE_WORKOUTS } from './cadence';

export { CADENCE_WORKOUTS } from './cadence';

/** Every built-in template, in the order a browser lists them. */
export const BUILT_IN_WORKOUTS: readonly WorkoutTemplate[] = [...CADENCE_WORKOUTS];
