// SPDX-License-Identifier: Apache-2.0

/**
 * Pyramid sessions in the built-in library — #2301: efforts that lengthen and
 * shorten, or climb, with easy riding between each step. Every working target
 * from 0.91 up to, not including, 1.51 of threshold (Threshold to Anaerobic in
 * `POWER_ZONE_LOWER_FRACTIONS`); the shorter the step, the harder.
 */

import type { WorkoutBlock } from '../workout';
import type { WorkoutTemplate } from '../template';

import {
  COOL_DOWN,
  easyRecovery,
  minutes,
  share,
  STANDARD_PARAMETERS,
  WARM_UP_WITH_OPENERS,
} from './frame';

/** One step of a ladder: an effort of `length` minutes at `target`. */
function step(length: number, target: number): WorkoutBlock {
  return { kind: 'steady', seconds: minutes(length), target: share(target), label: 'Step' };
}

/** Easy riding between steps, as long as the step before it. */
function between(length: number): WorkoutBlock {
  return { kind: 'steady', seconds: minutes(length), target: share(0.5), label: 'Easy' };
}

export const PYRAMID_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'pyramid-1-to-4',
    name: 'Pyramid, one to four and back',
    summary:
      'Steps that lengthen to the longest and shorten again, harder as they shorten, with easy riding as long as each step after it.',
    category: 'pyramid',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        step(1, 1.15),
        between(1),
        step(2, 1.1),
        between(2),
        step(3, 1.05),
        between(3),
        step(4, 1),
        between(4),
        step(3, 1.05),
        between(3),
        step(2, 1.1),
        between(2),
        step(1, 1.15),
      ],
      stretch: { minimum: 0.7, maximum: 1.6 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'pyramid-ascending',
    name: 'Pyramid, rising ladder',
    summary:
      'Five equal steps that climb from just under threshold to well over it, with easy riding between.',
    category: 'pyramid',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        step(2, 0.95),
        between(2),
        step(2, 1),
        between(2),
        step(2, 1.05),
        between(2),
        step(2, 1.1),
        between(2),
        step(2, 1.15),
      ],
      stretch: { minimum: 0.8, maximum: 2 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'pyramid-1-to-3',
    name: 'Pyramid, one to three and back',
    summary:
      'Sets of steps of one, two and three minutes and back down, with easy riding between steps and after each set.',
    category: 'pyramid',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        step(1, 1.15),
        between(1),
        step(2, 1.1),
        between(2),
        step(3, 1.05),
        between(3),
        step(2, 1.1),
        between(2),
        step(1, 1.15),
      ],
      repeats: { minimum: 1, maximum: 3, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
