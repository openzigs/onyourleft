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

import { expandWorkout, type Workout, type WorkoutBlock } from '@onyourleft/domain';
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
   * reader. A chart may sit beside this later; it may not replace it.
   */
  readonly shape: string;
  /**
   * The highest target in the workout, as a percentage of threshold, or
   * `undefined` for a workout that is all free riding.
   */
  readonly hardestPercent: number | undefined;
}

/** `3720` → `"1 h 2 min"`; `600` → `"10 min"`; `45` → `"45 s"`. */
export function durationText(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  if (whole < 60) {
    return `${String(whole)} s`;
  }
  const minutes = Math.round(whole / 60);
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** A share as a whole-number percentage. `0.885` → `89`. */
export function percentOf(share: number): number {
  return Math.round(share * 100);
}

/** One block, in the words a rider would use for it. */
export function blockText(block: WorkoutBlock): string {
  switch (block.kind) {
    case 'steady':
      return `${durationText(block.seconds)} at ${String(percentOf(block.target))}%`;
    case 'ramp':
      return (
        `${durationText(block.seconds)} ramping ${String(percentOf(block.from))}% ` +
        `to ${String(percentOf(block.to))}%`
      );
    case 'intervals':
      return (
        `${String(block.repeats)} × ${durationText(block.hardSeconds)} ` +
        `at ${String(percentOf(block.hardTarget))}%, ` +
        `${durationText(block.easySeconds)} at ${String(percentOf(block.easyTarget))}%`
      );
    case 'free-ride':
      // ⚠️ Not "at 0%". A free ride is the trainer being RELEASED, which is a
      // different instruction from a target of zero — `session.ts` sends
      // `stop()` for it — and a row that said 0% would be describing the one
      // thing the player is careful never to do.
      return `${durationText(block.seconds)} free riding`;
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

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
 */
export function workoutRow(record: WorkoutRecord): WorkoutRow {
  const timeline = expandWorkout(record.workout);
  const hardest = hardestShare(record.workout);
  return {
    id: record.id,
    name: record.name,
    totalSeconds: timeline.totalSeconds,
    duration: durationText(timeline.totalSeconds),
    blockCount: record.workout.blocks.length,
    shape: record.workout.blocks.map(blockText).join(', '),
    hardestPercent: hardest === undefined ? undefined : percentOf(hardest),
  };
}
