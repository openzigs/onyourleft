// SPDX-License-Identifier: Apache-2.0

/**
 * Sweet-spot sessions in the built-in library — #2300. Every working target
 * inside `SWEET_SPOT_FRACTIONS`, 0.88 to 0.94 of threshold.
 */

import type { WorkoutTemplate } from '../template';

import { COOL_DOWN, easyRecovery, minutes, share, STANDARD_PARAMETERS, WARM_UP } from './frame';

export const SWEET_SPOT_WORKOUTS: readonly WorkoutTemplate[] = [
  {
    id: 'sweet-spot-3x12',
    name: 'Sweet spot, three by twelve',
    summary: 'Twelve-minute sweet-spot efforts with easy riding after each.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(12), target: share(0.9), label: 'Sweet spot' }],
      repeats: { minimum: 2, maximum: 6, default: 3 },
      recovery: easyRecovery(240, { minimum: 120, maximum: 360 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sweet-spot-2x20',
    name: 'Sweet spot, two by twenty',
    summary: 'Twenty-minute sweet-spot efforts with easy riding after each.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(20), target: share(0.89), label: 'Sweet spot' }],
      repeats: { minimum: 1, maximum: 4, default: 2 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 600 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sweet-spot-4x10',
    name: 'Sweet spot, four by ten',
    summary: 'Ten-minute efforts at the top of sweet spot with easy riding after each.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(10), target: share(0.92), label: 'Sweet spot' }],
      repeats: { minimum: 2, maximum: 6, default: 4 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 420 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sweet-spot-3x15',
    name: 'Sweet spot, three by fifteen',
    summary: 'Fifteen-minute sweet-spot efforts with easy riding after each.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'repeat',
      rep: [{ kind: 'steady', seconds: minutes(15), target: share(0.9), label: 'Sweet spot' }],
      repeats: { minimum: 1, maximum: 5, default: 3 },
      recovery: easyRecovery(300, { minimum: 180, maximum: 480 }),
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sweet-spot-rising',
    name: 'Sweet spot, rising block',
    summary: 'One unbroken block in four equal steps, rising through sweet spot.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [
        { kind: 'steady', seconds: minutes(8), target: share(0.88), label: 'Step one' },
        { kind: 'steady', seconds: minutes(8), target: share(0.9), label: 'Step two' },
        { kind: 'steady', seconds: minutes(8), target: share(0.92), label: 'Step three' },
        { kind: 'steady', seconds: minutes(8), target: share(0.94), label: 'Step four' },
      ],
      stretch: { minimum: 0.5, maximum: 1.5 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
  {
    id: 'sweet-spot-long-block',
    name: 'Sweet spot, one long block',
    summary: 'One unbroken sweet-spot effort.',
    category: 'sweet-spot',
    warmUp: WARM_UP,
    mainSet: {
      scaling: 'stretch',
      blocks: [{ kind: 'steady', seconds: minutes(30), target: share(0.89), label: 'Sweet spot' }],
      stretch: { minimum: 0.5, maximum: 1.5 },
    },
    coolDown: COOL_DOWN,
    parameters: STANDARD_PARAMETERS,
  },
];
