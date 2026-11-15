// SPDX-License-Identifier: Apache-2.0

/**
 * Anaerobic sessions in the built-in library — #2301. Every working target
 * from 1.21 up to, not including, 1.51 of threshold: the Anaerobic zone of
 * `POWER_ZONE_LOWER_FRACTIONS`, with long easy riding after each effort.
 *
 * These are held in ERG. At up to 1.5 of threshold for a minute or less, a
 * rider who cannot hold the target is the spiral #14 names, and the player's
 * stall rescue (#585, `erg-safety.ts`) is what answers it; this file adds no
 * path round it.
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

export const ANAEROBIC_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'anaerobic-8x1',
    name: 'Anaerobic, eight by one',
    summary: 'One-minute efforts far over threshold with long easy riding after each.',
    category: 'anaerobic',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(1), target: share(1.3), label: 'Anaerobic' }],
      repeats: { minimum: 6, maximum: 10, default: 8 },
      recovery: easyRecovery(240, { minimum: 180, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'anaerobic-6x1-hard',
    name: 'Anaerobic, six hard one-minute efforts',
    summary:
      'One-minute efforts near the top of the anaerobic range with long easy riding after each.',
    category: 'anaerobic',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(1), target: share(1.4), label: 'Anaerobic' }],
      repeats: { minimum: 4, maximum: 8, default: 6 },
      recovery: easyRecovery(300, { minimum: 240, maximum: 420 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'anaerobic-10x1',
    name: 'Anaerobic, ten by one',
    summary: 'One-minute efforts at the bottom of the anaerobic range with easy riding after each.',
    category: 'anaerobic',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(1), target: share(1.25), label: 'Anaerobic' }],
      repeats: { minimum: 6, maximum: 12, default: 10 },
      recovery: easyRecovery(180, { minimum: 120, maximum: 300 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'anaerobic-8x30',
    name: 'Anaerobic, eight by thirty seconds',
    summary:
      'Thirty-second efforts at the top of the anaerobic range with long easy riding after each.',
    category: 'anaerobic',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: seconds(30), target: share(1.5), label: 'Anaerobic' }],
      repeats: { minimum: 6, maximum: 12, default: 8 },
      recovery: easyRecovery(240, { minimum: 180, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
