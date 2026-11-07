// SPDX-License-Identifier: Apache-2.0

/**
 * VO₂ sessions in the built-in library — #2301. Every working target from
 * 1.06 up to, not including, 1.51 of threshold: the VO₂ and Anaerobic zones
 * of `POWER_ZONE_LOWER_FRACTIONS`, because the short-short sets (1.20–1.30)
 * cross into the second. Long efforts sit at 1.08–1.15, short-shorts at
 * 1.20–1.25, and every easy half is easy riding.
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

export const VO2_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'vo2-5x3',
    name: 'VO2, five by three',
    summary: 'Three-minute efforts well over threshold with equal easy riding after each.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(3), target: share(1.15), label: 'VO2' }],
      repeats: { minimum: 3, maximum: 8, default: 5 },
      recovery: easyRecovery(180, { minimum: 120, maximum: 300 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'vo2-5x4',
    name: 'VO2, five by four',
    summary: 'Four-minute efforts well over threshold with equal easy riding after each.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(4), target: share(1.1), label: 'VO2' }],
      repeats: { minimum: 3, maximum: 7, default: 5 },
      recovery: easyRecovery(240, { minimum: 180, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'vo2-4x5',
    name: 'VO2, four by five',
    summary: 'Five-minute efforts over threshold with equal easy riding after each.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(5), target: share(1.08), label: 'VO2' }],
      repeats: { minimum: 3, maximum: 6, default: 4 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 420 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'vo2-30-30',
    name: 'VO2, thirty on thirty off',
    summary:
      'Sets of ten 30-second efforts, each followed by 30 seconds easy, with easy riding after each set.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 10,
          hardSeconds: seconds(30),
          hardTarget: share(1.25),
          easySeconds: seconds(30),
          easyTarget: share(0.5),
          label: 'Thirty-thirty',
        },
      ],
      repeats: { minimum: 2, maximum: 4, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'vo2-30-15',
    name: 'VO2, thirty on fifteen off',
    summary:
      'Sets of twelve 30-second efforts, each followed by 15 seconds easy, with easy riding after each set.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 12,
          hardSeconds: seconds(30),
          hardTarget: share(1.2),
          easySeconds: seconds(15),
          easyTarget: share(0.5),
          label: 'Thirty-fifteen',
        },
      ],
      repeats: { minimum: 2, maximum: 4, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'vo2-40-20',
    name: 'VO2, forty on twenty off',
    summary:
      'Sets of ten 40-second efforts, each followed by 20 seconds easy, with easy riding after each set.',
    category: 'vo2',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 10,
          hardSeconds: seconds(40),
          hardTarget: share(1.22),
          easySeconds: seconds(20),
          easyTarget: share(0.5),
          label: 'Forty-twenty',
        },
      ],
      repeats: { minimum: 2, maximum: 4, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
