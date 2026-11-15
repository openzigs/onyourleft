// SPDX-License-Identifier: Apache-2.0

/**
 * Sprint sessions in the built-in library — #2301.
 *
 * ## Every sprint is a free ride
 *
 * The owner's ruling 6 on #2295 (2026-11-06): a sprint of 20 seconds or less
 * is a **free-ride** block. The player releases the trainer and the rider
 * sprints as hard as they like; it never holds 2 to 2.5 times threshold in
 * ERG against a rider who may not reach it, which is the spiral of death #14
 * names. Every sprint here is 10 to 20 seconds, so every one is a free ride.
 *
 * Between sprints the rider spins in ERG on an endurance base for at least
 * three minutes, and that riding is guarded by the player's stall rescue
 * (#585) exactly as any ERG block is: a rider who stalls after a sprint is
 * eased to the trainer's floor. `sprint.test.ts` proves that through the
 * player.
 */

import { seconds } from '../../quantities';
import type { WorkoutTemplate } from '../template';

import { COOL_DOWN, share, STANDARD_PARAMETERS, WARM_UP_WITH_OPENERS } from './frame';

export const SPRINT_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'sprint-6x15',
    name: 'Sprints, six by fifteen seconds',
    summary: 'Fifteen-second sprints with the trainer released, each followed by easy spinning.',
    category: 'sprint',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'free-ride', seconds: seconds(15), label: 'Sprint' },
        { kind: 'steady', seconds: seconds(300), target: share(0.6), label: 'Easy' },
      ],
      repeats: { minimum: 4, maximum: 12, default: 6 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sprint-8x10',
    name: 'Sprints, eight by ten seconds',
    summary: 'Ten-second sprints with the trainer released, each followed by easy spinning.',
    category: 'sprint',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'free-ride', seconds: seconds(10), label: 'Sprint' },
        { kind: 'steady', seconds: seconds(240), target: share(0.6), label: 'Easy' },
      ],
      repeats: { minimum: 6, maximum: 14, default: 8 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sprint-10x20',
    name: 'Sprints, ten by twenty seconds',
    summary: 'Twenty-second sprints with the trainer released, each followed by easy spinning.',
    category: 'sprint',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'free-ride', seconds: seconds(20), label: 'Sprint' },
        { kind: 'steady', seconds: seconds(300), target: share(0.62), label: 'Easy' },
      ],
      repeats: { minimum: 4, maximum: 12, default: 10 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sprint-endurance-base',
    name: 'Endurance with sprints',
    summary:
      'Steady endurance riding with a fifteen-second sprint, trainer released, every ten minutes.',
    category: 'sprint',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'steady', seconds: seconds(600), target: share(0.65), label: 'Endurance' },
        { kind: 'free-ride', seconds: seconds(15), label: 'Sprint' },
      ],
      repeats: { minimum: 2, maximum: 10, default: 6 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
