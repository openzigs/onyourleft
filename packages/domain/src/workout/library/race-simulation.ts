// SPDX-License-Identifier: Apache-2.0

/**
 * Race simulations in the built-in library — #2301: a steady base broken by
 * the surges a race asks for. Every working target from 0.76 up to, not
 * including, 1.51 of threshold (Tempo to Anaerobic in
 * `POWER_ZONE_LOWER_FRACTIONS`).
 */

import { seconds } from '../../quantities';
import type { WorkoutTemplate } from '../template';

import {
  COOL_DOWN,
  easyRecovery,
  minutes,
  share,
  STANDARD_PARAMETERS,
  WARM_UP_WITH_OPENERS,
} from './frame';

export const RACE_SIMULATION_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'race-simulation-tempo-surges',
    name: 'Race simulation, tempo with surges',
    summary: 'Tempo riding broken every four minutes by a 30-second surge far over threshold.',
    category: 'race-simulation',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'steady', seconds: minutes(4), target: share(0.82), label: 'Tempo' },
        { kind: 'steady', seconds: seconds(30), target: share(1.35), label: 'Surge' },
      ],
      repeats: { minimum: 4, maximum: 16, default: 8 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'race-simulation-time-trial',
    name: 'Race simulation, time trial with a closing kick',
    summary: 'One long effort at time-trial pace that ends with a short, hard kick.',
    category: 'race-simulation',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        { kind: 'steady', seconds: minutes(20), target: share(0.97), label: 'Time-trial pace' },
        { kind: 'steady', seconds: minutes(1), target: share(1.3), label: 'Kick' },
      ],
      stretch: { minimum: 0.75, maximum: 1.5 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'race-simulation-criterium',
    name: 'Race simulation, criterium surges',
    summary:
      'Sets of six 30-second surges out of the corners, each followed by 30 seconds at tempo, with easy riding after each set.',
    category: 'race-simulation',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 6,
          hardSeconds: seconds(30),
          hardTarget: share(1.4),
          easySeconds: seconds(30),
          easyTarget: share(0.8),
          label: 'Surge',
        },
      ],
      repeats: { minimum: 2, maximum: 5, default: 3 },
      recovery: easyRecovery(240, { minimum: 180, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
