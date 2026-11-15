// SPDX-License-Identifier: Apache-2.0

/**
 * The parts every built-in workout shares — #2300, under the library epic
 * #2295: the warm-ups, the cool-downs, the easy riding between repeats and the
 * intensity range a rider may choose.
 *
 * Written once here so that thirty templates do not carry thirty slightly
 * different warm-ups. The conventions are #2300's:
 *
 * - a **warm-up** of about 10 minutes ramping from 0.45 to 0.70 of threshold,
 *   with two short openers before a hard set;
 * - a **cool-down** of 5 minutes ramping down to 0.45, which may end in a
 *   **free ride** that releases the trainer.
 *
 * Every number here is a share of threshold (`ThresholdShare`), never a zone:
 * the owner's ruling R-2 on #2295.
 */

import { seconds } from '../../quantities';
import {
  MAXIMUM_INTENSITY_PERCENT,
  MINIMUM_INTENSITY_PERCENT,
  type Recovery,
  type TemplateParameters,
} from '../template';
import { thresholdShare, type WorkoutBlock } from '../workout';

/** A share of threshold, checked where it is written. */
export const share = thresholdShare;

/** A whole number of minutes, as seconds. */
export function minutes(count: number): ReturnType<typeof seconds> {
  return seconds(count * 60);
}

/** The intensity range every built-in offers: the whole of the owner's −25 % to +10 %. */
export const STANDARD_PARAMETERS: TemplateParameters = {
  intensityPercent: { minimum: MINIMUM_INTENSITY_PERCENT, maximum: MAXIMUM_INTENSITY_PERCENT },
};

/** Ten minutes rising from 0.45 to 0.70 of threshold. */
export const WARM_UP: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: minutes(10), from: share(0.45), to: share(0.7), label: 'Warm-up' },
];

/** The warm-up, then two 30-second openers, for a session with hard sets in it. */
export const WARM_UP_WITH_OPENERS: readonly WorkoutBlock[] = [
  ...WARM_UP,
  {
    kind: 'intervals',
    repeats: 2,
    hardSeconds: seconds(30),
    hardTarget: share(1.05),
    easySeconds: seconds(90),
    easyTarget: share(0.55),
    label: 'Openers',
  },
];

/** Five minutes rising from 0.40 to 0.50, for a recovery ride. */
export const EASY_WARM_UP: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: minutes(5), from: share(0.4), to: share(0.5), label: 'Warm-up' },
];

/** Five minutes easing from 0.50 to 0.40, for a recovery ride. */
export const EASY_COOL_DOWN: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: minutes(5), from: share(0.5), to: share(0.4), label: 'Cool-down' },
];

/** Five minutes easing from 0.60 to 0.45 of threshold. */
export const COOL_DOWN: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: minutes(5), from: share(0.6), to: share(0.45), label: 'Cool-down' },
];

/** The cool-down, then three minutes of free riding with the trainer released. */
export const COOL_DOWN_FREE_FINISH: readonly WorkoutBlock[] = [
  ...COOL_DOWN,
  { kind: 'free-ride', seconds: minutes(3), label: 'Free ride' },
];

/**
 * Easy riding between repeats at 0.55 of threshold, which a rider may make
 * shorter or longer within `range`, in seconds.
 */
export function easyRecovery(
  length: number,
  range: { readonly minimum: number; readonly maximum: number },
): Recovery {
  return {
    block: { kind: 'steady', seconds: seconds(length), target: share(0.55), label: 'Easy' },
    seconds: range,
  };
}
