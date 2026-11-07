// SPDX-License-Identifier: Apache-2.0

/** Recovery rides in the built-in library — #2300. Every target below 0.56 of threshold. */

import { seconds } from '../../quantities';
import type { WorkoutTemplate } from '../template';

import { EASY_COOL_DOWN, EASY_WARM_UP, minutes, share, STANDARD_PARAMETERS } from './frame';

export const RECOVERY_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'recovery-easy-spin',
    name: 'Easy spin',
    summary: 'Very easy riding from start to finish.',
    category: 'recovery',
    warmUp: EASY_WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(20), target: share(0.5), label: 'Easy' }],
      stretch: { minimum: 0.5, maximum: 2.5 },
    },
    coolDown: EASY_COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'recovery-spin-ups',
    name: 'Easy spin with spin-ups',
    summary: 'Very easy riding broken by short spin-ups with the trainer released.',
    category: 'recovery',
    warmUp: EASY_WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'steady', seconds: minutes(7), target: share(0.5), label: 'Easy' },
        { kind: 'free-ride', seconds: seconds(30), label: 'Spin-up' },
      ],
      repeats: { minimum: 3, maximum: 12, default: 4 },
    },
    coolDown: EASY_COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'recovery-free-finish',
    name: 'Recovery ride, free finish',
    summary: 'Easy riding that ends with the trainer released.',
    category: 'recovery',
    warmUp: EASY_WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(30), target: share(0.52), label: 'Easy' }],
      stretch: { minimum: 0.5, maximum: 2.5 },
    },
    coolDown: [...EASY_COOL_DOWN, { kind: 'free-ride', seconds: minutes(5), label: 'Free ride' }],
    parameters: STANDARD_PARAMETERS,
  },
];
