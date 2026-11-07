// SPDX-License-Identifier: Apache-2.0

/**
 * Over-under sessions in the built-in library — #2300: sets that alternate
 * just above and just below threshold with no rest inside the set. Every
 * working target from 0.91 up to, not including, 1.21 of threshold, with
 * some of it above 1 and some below.
 *
 * Each set is one `intervals` block, so it reads as "3 × 1 min at 105%, 2 min
 * at 95%"; the over comes first in each pair, the order `IntervalsBlock` rides.
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

export const OVER_UNDER_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'over-under-3x3',
    name: 'Over-unders, three sets of three',
    summary:
      'Sets of three pairs, a minute over threshold then two just under, with easy riding after each set.',
    category: 'over-under',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 3,
          hardSeconds: minutes(1),
          hardTarget: share(1.05),
          easySeconds: minutes(2),
          easyTarget: share(0.95),
          label: 'Over-under',
        },
      ],
      repeats: { minimum: 2, maximum: 5, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'over-under-3x4',
    name: 'Over-unders, three sets of four',
    summary:
      'Sets of four pairs, a minute over threshold then two just under, with easy riding after each set.',
    category: 'over-under',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 4,
          hardSeconds: minutes(1),
          hardTarget: share(1.05),
          easySeconds: minutes(2),
          easyTarget: share(0.95),
          label: 'Over-under',
        },
      ],
      repeats: { minimum: 2, maximum: 4, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'over-under-two-minute-overs',
    name: 'Over-unders, two-minute overs',
    summary:
      'Sets of three pairs, two minutes over threshold then two just under, with easy riding after each set.',
    category: 'over-under',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 3,
          hardSeconds: minutes(2),
          hardTarget: share(1.05),
          easySeconds: minutes(2),
          easyTarget: share(0.94),
          label: 'Over-under',
        },
      ],
      repeats: { minimum: 2, maximum: 4, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'over-under-three-minute-overs',
    name: 'Over-unders, three-minute overs',
    summary:
      'Sets of three pairs, three minutes well over threshold then two under, with easy riding after each set.',
    category: 'over-under',
    warmUp: WARM_UP_WITH_OPENERS,
    mainSet: {
      scaling: 'repeat',
      rep: [
        {
          kind: 'intervals',
          repeats: 3,
          hardSeconds: minutes(3),
          hardTarget: share(1.08),
          easySeconds: minutes(2),
          easyTarget: share(0.93),
          label: 'Over-under',
        },
      ],
      repeats: { minimum: 1, maximum: 4, default: 2 },
      recovery: easyRecovery(360, { minimum: 240, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
