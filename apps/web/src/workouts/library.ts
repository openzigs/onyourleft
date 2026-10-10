// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A saved workout as a row a rider reads — #14.
 *
 * Pure, and separate from the view for `library/`'s reason: what a row *says*
 * is a decision worth testing on its own, and a decision embedded in JSX is one
 * that gets asserted by rendering a component and reading its text.
 *
 * ## What a row does NOT carry
 *
 * ⚠️ **No load, no stress score, no "this workout is worth 84 points".** Every
 * such number is a function of the rider's threshold, and #78's own rule is
 * that a threshold is optional and never substituted (`analysis/thresholds.ts`
 * is the single place in this program that supplies a default, and it says so).
 * A library row that quoted a load would be quoting one threshold's answer for
 * a workout that is deliberately threshold-independent — the whole reason a
 * target is a *share* rather than watts.
 *
 * What a row carries instead is what the workout says about itself: how long it
 * lasts, how it is built, and how hard its hardest block asks the rider to go
 * **relative to their own threshold**. That last one is a ratio, so it is true
 * for every rider.
 */

import {
  expandWorkout,
  workoutBlockText,
  workoutDurationText,
  workoutPercent,
  workoutShapeText,
  type Workout,
  type WorkoutTimeline,
} from '@onyourleft/domain';
import type { WorkoutRecord } from '@onyourleft/store';

export interface WorkoutRow {
  readonly id: string;
  readonly name: string;
  /** Total riding time, in seconds. */
  readonly totalSeconds: number;
  /** `"1 h 12 min"`. The unit a session is discussed in. */
  readonly duration: string;
  /** How many blocks the rider wrote, NOT how many segments they expand to. */
  readonly blockCount: number;
  /**
   * `"4 × 3 min at 110%, 10 min steady, a ramp"` — the shape, in words.
   *
   * Words rather than a chart, and that is #48's rule rather than a placeholder:
   * a workout's structure has to be readable without seeing it, and a screen
   * that only draws it is one where the structure is unavailable to a screen
   * reader. A chart may sit beside this; it may not replace it — and since
   * #1043 one does (`BlockChart.tsx`), `aria-hidden` beside these words.
   */
  readonly shape: string;
  /**
   * The highest target in the workout, as a percentage of threshold, or
   * `undefined` for a workout that is all free riding.
   */
  readonly hardestPercent: number | undefined;
}

/**
 * A duration, a share as a percentage, and one block, in words. Since #1100
 * they are `packages/domain`'s (`workout/describe.ts`), so the instance
 * agent's `workouts` tool says a workout's shape in this same sentence: the
 * names here are the ones every caller in this client already uses.
 */
export {
  workoutBlockText as blockText,
  workoutDurationText as durationText,
  workoutPercent as percentOf,
};

/** The highest target anywhere in the workout, or `undefined` if there is none. */
export function hardestShare(workout: Workout): number | undefined {
  let hardest: number | undefined;
  const consider = (value: number): void => {
    hardest = hardest === undefined || value > hardest ? value : hardest;
  };
  for (const block of workout.blocks) {
    switch (block.kind) {
      case 'steady':
        consider(block.target);
        break;
      case 'ramp':
        // Both ends, because a ramp DOWN from 120% is as hard as one up to it
        // and reading only `to` would call it easy.
        consider(block.from);
        consider(block.to);
        break;
      case 'intervals':
        consider(block.hardTarget);
        // The easy target too: an "easy" leg written at 95% is a workout with
        // no recovery in it, and a row that hid that would be describing a
        // gentler session than the one the rider is about to ride.
        consider(block.easyTarget);
        break;
      case 'free-ride':
        break;
      case 'heart-rate-hold':
        // The most the hold may ask for, which is how hard the block can be.
        consider(block.ceilingShare);
        break;
    }
  }
  return hardest;
}

/**
 * Turn a stored workout into a row.
 *
 * ⚠️ **The total comes from `expandWorkout`, not from summing the blocks
 * here.** An intervals block's length is `repeats × (hard + easy)` and writing
 * that arithmetic again is how a row comes to disagree with the clock the rider
 * watches. The expansion is the one place that knows, and it is cheap.
 *
 * A caller that has already expanded the workout — the Workouts list, which
 * draws the timeline on the card (#941) — hands it in rather than expanding it
 * a second time. It must be `record.workout`'s own expansion.
 */
export function workoutRow(
  record: WorkoutRecord,
  timeline: WorkoutTimeline = expandWorkout(record.workout),
): WorkoutRow {
  const hardest = hardestShare(record.workout);
  return {
    id: record.id,
    name: record.name,
    totalSeconds: timeline.totalSeconds,
    duration: workoutDurationText(timeline.totalSeconds),
    blockCount: record.workout.blocks.length,
    shape: workoutShapeText(record.workout),
    hardestPercent: hardest === undefined ? undefined : workoutPercent(hardest),
  };
}
