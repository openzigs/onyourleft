// SPDX-License-Identifier: Apache-2.0

/**
 * Threshold sessions in the built-in library — #2300. Every working target
 * from 0.91 up to, not including, 1.06 of threshold: the Threshold zone of
 * `POWER_ZONE_LOWER_FRACTIONS`, as spike 0038 §5.2 asked rather than the
 * 0.91–1.05 #2300 first wrote.
 */

import type { WorkoutTemplate } from '../template';

import {
  COOL_DOWN,
  easyRecovery,
  minutes,
  share,
  STANDARD_PARAMETERS,
  WARM_UP_WITH_OPENERS,
} from './frame';

export const THRESHOLD_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'threshold-2x20',
    name: 'Threshold, two by twenty',
    summary: 'Twenty-minute efforts just under threshold with easy riding after each.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(20), target: share(0.95), label: 'Threshold' }],
      repeats: { minimum: 1, maximum: 3, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 600 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'threshold-3x12',
    name: 'Threshold, three by twelve',
    summary: 'Twelve-minute efforts just under threshold with easy riding after each.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(12), target: share(0.98), label: 'Threshold' }],
      repeats: { minimum: 2, maximum: 5, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'threshold-4x8',
    name: 'Threshold, four by eight',
    summary: 'Eight-minute efforts at threshold with easy riding after each.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(8), target: share(1), label: 'Threshold' }],
      repeats: { minimum: 3, maximum: 7, default: 4 },
      recovery: easyRecovery(240, { minimum: 120, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'threshold-5x6',
    name: 'Threshold, five by six',
    summary: 'Six-minute efforts just over threshold with easy riding after each.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(6), target: share(1.02), label: 'Threshold' }],
      repeats: { minimum: 3, maximum: 9, default: 5 },
      recovery: easyRecovery(180, { minimum: 120, maximum: 300 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'threshold-3x15',
    name: 'Threshold, three by fifteen',
    summary: 'Fifteen-minute efforts just under threshold with easy riding after each.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(15), target: share(0.96), label: 'Threshold' }],
      repeats: { minimum: 2, maximum: 4, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'threshold-1x30',
    name: 'Threshold, one by thirty',
    summary: 'One unbroken effort just under threshold.',
    category: 'threshold',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(30), target: share(0.95), label: 'Threshold' }],
      // 20 to 40 minutes: a block this close to threshold may not double.
      stretch: { minimum: 0.66, maximum: 1.34 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
