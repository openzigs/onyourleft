// SPDX-License-Identifier: Apache-2.0

/**
 * Endurance rides in the built-in library — #2300. Every power target from 0.56
 * up to, not including, 0.76 of threshold.
 *
 * The two heart-rate rides are **heart-rate holds** (the owner's ruling R-4 on
 * #2295): the range is written as shares of threshold heart rate, inside the
 * Endurance heart-rate zone (`HEART_RATE_ZONE_LOWER_FRACTIONS`, 0.81 up to
 * 0.90), and tailoring resolves it from the rider's own threshold heart rate.
 * Each ceiling is below `MAXIMUM_HOLD_CEILING_SHARE` (0.85).
 */

import type { WorkoutTemplate } from '../template';

import {
  COOL_DOWN,
  COOL_DOWN_FREE_FINISH,
  minutes,
  share,
  STANDARD_PARAMETERS,
  WARM_UP,
} from './frame';

export const ENDURANCE_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'endurance-steady-hour',
    name: 'Endurance, steady hour',
    summary: 'One unbroken block at a steady endurance pace.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(45), target: share(0.65), label: 'Endurance' }],
      stretch: { minimum: 0.3, maximum: 2.4 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'endurance-long',
    name: 'Endurance, long and steady',
    summary: 'A long unbroken block at an easy endurance pace, finished with the trainer released.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(102), target: share(0.62), label: 'Endurance' }],
      stretch: { minimum: 0.25, maximum: 1.2 },
    },
    coolDown: COOL_DOWN_FREE_FINISH,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'endurance-ninety',
    name: 'Endurance, ninety minutes',
    summary: 'One long block at the top of endurance pace.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(75), target: share(0.68), label: 'Endurance' }],
      stretch: { minimum: 0.2, maximum: 1.4 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'endurance-gentle-surges',
    name: 'Endurance with gentle surges',
    summary: 'Steady endurance riding with a short, gentle lift in pace every ten minutes.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [
        { kind: 'steady', seconds: minutes(8), target: share(0.65), label: 'Steady' },
        { kind: 'steady', seconds: minutes(2), target: share(0.74), label: 'Surge' },
      ],
      repeats: { minimum: 1, maximum: 10, default: 4 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'endurance-heart-rate',
    name: 'Endurance by heart rate',
    summary:
      'Steady riding in which the target moves to keep your heart rate in the endurance range worked out from your own threshold heart rate.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        {
          kind: 'heart-rate-zone-hold',
          seconds: minutes(45),
          rangeShare: { low: 0.81, high: 0.89 },
          startShare: share(0.62),
          ceilingShare: share(0.75),
          label: 'Heart-rate hold',
        },
      ],
      stretch: { minimum: 0.3, maximum: 2.4 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'endurance-heart-rate-low',
    name: 'Low endurance by heart rate',
    summary:
      'A long ride in which the target moves to keep your heart rate in the lower part of the endurance range worked out from your own threshold heart rate.',
    category: 'endurance',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        {
          kind: 'heart-rate-zone-hold',
          seconds: minutes(75),
          rangeShare: { low: 0.81, high: 0.87 },
          startShare: share(0.58),
          ceilingShare: share(0.7),
          label: 'Heart-rate hold',
        },
      ],
      stretch: { minimum: 0.2, maximum: 1.4 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
