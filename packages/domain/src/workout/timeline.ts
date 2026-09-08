// SPDX-License-Identifier: Apache-2.0

/**
 * A workout, flattened into segments a player looks up — #14.
 *
 * ## Why a timeline exists at all
 *
 * The player could walk the blocks and keep a cursor. It does not, for two
 * reasons that are both about what goes wrong.
 *
 * A cursor makes **seeking** a replay: jumping to 40 minutes into an hour means
 * stepping through everything before it, and a rider who scrubs a workout
 * backwards makes the player run its own history again. A timeline makes a seek
 * a binary search over a sorted array.
 *
 * And a cursor makes **the target a function of how you got here**. That is the
 * shape of bug where a paused-and-resumed workout writes a different number
 * from a fresh one at the same offset, which is hard to see and easy to ship.
 * `targetAt(timeline, offset)` cannot have that bug: it takes no state.
 *
 * ## What a segment is
 *
 * One steady stretch or one ramp, with absolute offsets from the start. An
 * `intervals` block becomes `2 × repeats` segments here, which is the whole of
 * what expansion means.
 *
 * ⚠️ **Ramps are NOT expanded into steps.** A ten-minute ramp stays one segment
 * and {@link targetAt} interpolates within it. Expanding it into 600 one-second
 * segments would make the timeline the size of the ride and would quantise a
 * smooth target into stairs — and the trainer is written to at about 1 Hz
 * anyway, so the stairs would be the wrong ones.
 */

import { seconds, type Seconds } from '../quantities';

import { validateWorkout, type ThresholdShare, type Workout, type WorkoutBlock } from './workout';

/** One stretch of the ride, at absolute offsets from the workout's start. */
export interface WorkoutSegment {
  /** Inclusive. */
  readonly startsAt: Seconds;
  /** Exclusive, so consecutive segments do not both own their boundary. */
  readonly endsAt: Seconds;
  /**
   * The target at {@link startsAt}, or `undefined` for a free ride.
   *
   * `undefined` means "release the trainer", not "target nothing" — see
   * `FreeRideBlock`.
   */
  readonly from: ThresholdShare | undefined;
  /** The target at {@link endsAt}. Equal to {@link from} unless this is a ramp. */
  readonly to: ThresholdShare | undefined;
  /** The index of the block this came from, so a screen can group by block. */
  readonly block: number;
  readonly label?: string | undefined;
}

/** A workout with its segments and its total length. */
export interface WorkoutTimeline {
  readonly workout: Workout;
  readonly segments: readonly WorkoutSegment[];
  readonly totalSeconds: Seconds;
}

/**
 * Flatten a workout into segments.
 *
 * @throws {WorkoutError} for anything `validateWorkout` refuses — expansion
 * validates first rather than trusting its caller, because this is the function
 * every other consumer goes through and a check somewhere upstream is a check
 * somebody can skip.
 */
export function expandWorkout(workout: Workout): WorkoutTimeline {
  validateWorkout(workout);

  const segments: WorkoutSegment[] = [];
  let offset = 0;

  const push = (
    length: number,
    from: ThresholdShare | undefined,
    to: ThresholdShare | undefined,
    block: number,
    label: string | undefined,
  ): void => {
    segments.push({
      startsAt: seconds(offset),
      endsAt: seconds(offset + length),
      from,
      to,
      block,
      ...(label === undefined ? {} : { label }),
    });
    offset += length;
  };

  for (const [index, block] of workout.blocks.entries()) {
    expandBlock(block, index, push);
  }

  return { workout, segments, totalSeconds: seconds(offset) };
}

function expandBlock(
  block: WorkoutBlock,
  index: number,
  push: (
    length: number,
    from: ThresholdShare | undefined,
    to: ThresholdShare | undefined,
    block: number,
    label: string | undefined,
  ) => void,
): void {
  switch (block.kind) {
    case 'steady':
      push(block.seconds, block.target, block.target, index, block.label);
      return;
    case 'ramp':
      push(block.seconds, block.from, block.to, index, block.label);
      return;
    case 'free-ride':
      push(block.seconds, undefined, undefined, index, block.label);
      return;
    case 'intervals':
      // Hard then easy, every time, including the last repeat. A rider who
      // wants to finish on the hard effort ends the block with one and adds a
      // steady recovery after it — which is a different workout and says so.
      // Dropping the final easy interval here would make `6 ×` mean five and a
      // half, and the arithmetic on the screen would stop matching the clock.
      for (let repeat = 0; repeat < block.repeats; repeat += 1) {
        push(block.hardSeconds, block.hardTarget, block.hardTarget, index, block.label);
        push(block.easySeconds, block.easyTarget, block.easyTarget, index, block.label);
      }
      return;
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The segment covering an offset, or `undefined` past the end.
 *
 * Binary search rather than a scan: a two-hour workout with 30-second intervals
 * is a few hundred segments, and a player asking at 1 Hz would otherwise walk
 * the array 7 200 times.
 */
export function segmentAt(timeline: WorkoutTimeline, offset: Seconds): WorkoutSegment | undefined {
  // ⚠️ No early return for an out-of-range offset, deliberately. The search
  // below already answers both ends correctly — past the end, `low` climbs
  // past `high`; before the start, `high` falls below `low` — so a guard here
  // would be a second implementation of the same decision, and the kind that
  // drifts. `Seconds` cannot be negative in any case: `seconds()` refuses it,
  // so a negative offset only exists past a cast.
  let low = 0;
  let high = timeline.segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = timeline.segments[middle];
    if (segment === undefined) {
      return undefined;
    }
    if (offset < segment.startsAt) {
      high = middle - 1;
    } else if (offset >= segment.endsAt) {
      low = middle + 1;
    } else {
      return segment;
    }
  }
  return undefined;
}

/**
 * The target at an offset, interpolated through a ramp.
 *
 * `undefined` in three different situations that a caller must not merge:
 * before the start, past the end, and during a free ride. All three mean "do
 * not write a target", which is why one value serves — but a screen that wants
 * to say *why* asks {@link segmentAt} instead.
 *
 * ⚠️ Returns a plain `number`, not a `ThresholdShare`, and that is deliberate:
 * an interpolated value between two valid shares is itself in range, but it has
 * not been through `thresholdShare`'s validation and claiming the brand would
 * be claiming a check that did not happen. A caller converting it to watts
 * multiplies by threshold; a caller that wants the brand re-enters the
 * constructor, which is `quantity.ts`'s stated rule for arithmetic.
 */
export function targetAt(timeline: WorkoutTimeline, offset: Seconds): number | undefined {
  const segment = segmentAt(timeline, offset);
  if (segment === undefined || segment.from === undefined || segment.to === undefined) {
    return undefined;
  }
  if (segment.from === segment.to) {
    return segment.from;
  }
  const span = segment.endsAt - segment.startsAt;
  // `span` is positive: `validateWorkout` refuses a zero-length block, so no
  // segment can be empty and this cannot divide by zero.
  const through = (offset - segment.startsAt) / span;
  return segment.from + (segment.to - segment.from) * through;
}
