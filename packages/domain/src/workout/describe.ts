// SPDX-License-Identifier: Apache-2.0

/**
 * A workout in words — #14, moved here from `apps/web/src/workouts/library.ts`
 * by #1100 so that the instance agent's `workouts` tool says a workout's shape
 * in exactly the sentence the Workouts screen shows, rather than a second
 * sentence that drifts from it.
 *
 * ⚠️ **No watts.** Every target is a share of the rider's threshold, said as a
 * percentage, because a workout is threshold-independent (ADR 0017) and a
 * figure in watts would be one threshold's answer for it.
 */

import type { Workout, WorkoutBlock } from './workout';

/** `3720` → `"1 h 2 min"`; `600` → `"10 min"`; `45` → `"45 s"`. */
export function workoutDurationText(totalSeconds: number): string {
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
export function workoutPercent(share: number): number {
  return Math.round(share * 100);
}

/** One block, in the words a rider would use for it. */
export function workoutBlockText(block: WorkoutBlock): string {
  switch (block.kind) {
    case 'steady':
      return `${workoutDurationText(block.seconds)} at ${String(workoutPercent(block.target))}%`;
    case 'ramp':
      return (
        `${workoutDurationText(block.seconds)} ramping ${String(workoutPercent(block.from))}% ` +
        `to ${String(workoutPercent(block.to))}%`
      );
    case 'intervals':
      return (
        `${String(block.repeats)} × ${workoutDurationText(block.hardSeconds)} ` +
        `at ${String(workoutPercent(block.hardTarget))}%, ` +
        `${workoutDurationText(block.easySeconds)} at ${String(workoutPercent(block.easyTarget))}%`
      );
    case 'free-ride':
      // ⚠️ Not "at 0%". A free ride eases the trainer to its OWN lowest
      // target (`apps/web/src/workout/session.ts` §`ease`, since #441), and
      // that floor is the machine's reported minimum, not zero. A sentence
      // that said 0% would describe a number the player never writes.
      return `${workoutDurationText(block.seconds)} free riding`;
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** `"4 × 3 min at 110%, 2 min at 50%, 10 min at 60%"` — every block, in order. */
export function workoutShapeText(workout: Workout): string {
  return workout.blocks.map(workoutBlockText).join(', ');
}
