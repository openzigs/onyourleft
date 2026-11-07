// SPDX-License-Identifier: Apache-2.0

/**
 * Tempo sessions in the built-in library — #2300. Every working target from
 * 0.76 up to, not including, 0.91 of threshold.
 */

import type { WorkoutTemplate } from '../template';

import { COOL_DOWN, easyRecovery, minutes, share, STANDARD_PARAMETERS, WARM_UP } from './frame';

export const TEMPO_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'tempo-2x20',
    name: 'Tempo, two by twenty',
    summary: 'Twenty-minute tempo blocks with easy riding after each.',
    category: 'tempo',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(20), target: share(0.83), label: 'Tempo' }],
      repeats: { minimum: 1, maximum: 4, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 600 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'tempo-3x15',
    name: 'Tempo, three by fifteen',
    summary: 'Fifteen-minute tempo blocks with easy riding after each.',
    category: 'tempo',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(15), target: share(0.85), label: 'Tempo' }],
      repeats: { minimum: 1, maximum: 5, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'tempo-2x25',
    name: 'Tempo, two by twenty-five',
    summary: 'Twenty-five-minute blocks at the low end of tempo with easy riding after each.',
    category: 'tempo',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(25), target: share(0.8), label: 'Tempo' }],
      repeats: { minimum: 1, maximum: 3, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 600 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'tempo-long-steady',
    name: 'Tempo, long and steady',
    summary: 'One unbroken block at tempo.',
    category: 'tempo',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(40), target: share(0.8), label: 'Tempo' }],
      stretch: { minimum: 0.4, maximum: 1.6 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'tempo-rising-steps',
    name: 'Tempo in rising steps',
    summary: 'Three equal steps with no rest between, rising from the bottom of tempo to the top.',
    category: 'tempo',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        { kind: 'steady', seconds: minutes(15), target: share(0.78), label: 'Step one' },
        { kind: 'steady', seconds: minutes(15), target: share(0.83), label: 'Step two' },
        { kind: 'steady', seconds: minutes(15), target: share(0.88), label: 'Step three' },
      ],
      stretch: { minimum: 0.33, maximum: 1.6 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
