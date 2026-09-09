// SPDX-License-Identifier: Apache-2.0

/**
 * A structured workout, in this project's own vocabulary — #14.
 *
 * ## The target is a SHARE of threshold, and it is branded
 *
 * A workout says "ride at 0.88 of your threshold", not "ride at 260 W": the
 * same workout has to work for two riders of different fitness, which is what
 * makes it a workout rather than a recording. {@link ThresholdShare} is the
 * branded ratio, and the brand is not decoration here.
 *
 * ⚠️ **Confusing a share with an absolute wattage is a SAFETY defect, not a
 * units nicety.** `0.75` and `75` are both plausible numbers, both pass every
 * arithmetic, and one of them is a trainer holding 75 W against somebody
 * expecting three quarters of threshold — or, the other way round, a trainer
 * asked for 0.75 W. `CLAUDE.md` §6 puts trainer control in the safety class,
 * and this is the one place in the workout model where the wrong number is
 * quiet. `Watts` and `ThresholdShare` are not assignable to each other, which
 * is the whole reason to spend a brand on a dimensionless ratio.
 *
 * ## Why the names are these names
 *
 * `CLAUDE.md` §6: the familiar names for load metrics are registered marks, so
 * this project coins plainly descriptive ones. "Share of threshold" follows
 * that discipline — it is what the number is. It is deliberately **not** the
 * percent-of-FTP spelling, and not because FTP is established as a mark (§6
 * records that it could not be established either way) but because
 * `packages/store` already calls the setting `thresholdPower` and one
 * vocabulary is better than two.
 *
 * ⚠️ It is also NOT `thresholdFraction`, which `analysis/load.ts` already
 * exports and which means something else: that one is a ratio **computed from a
 * ride that happened**, this one is a target **asked of a ride that has not**.
 * Same arithmetic, opposite direction, and reusing the name would make a
 * grep for either return both.
 *
 * ## No file format lives here, deliberately
 *
 * This module knows nothing about how a workout is written down. #14's scope
 * section proposes ZWO, and that is a decision with an ADR 0009 question
 * attached rather than a parser to write — see the issue this package's README
 * points at. The model is the part that does not depend on the answer, and
 * every format that ever lands maps onto it.
 */

import type { Quantity } from '../quantity';
import type { Seconds } from '../quantities';

import { WorkoutError } from './errors';

/**
 * A power target as a share of the athlete's threshold: 1 is threshold itself.
 *
 * @see the safety note in this module's header for why this is branded.
 */
export type ThresholdShare = Quantity<'share of threshold power'>;

/**
 * The smallest share a target may carry.
 *
 * Above zero rather than at it. A target of zero is not "easy", it is a request
 * for no power at all, and a rider coasting is a **free ride** block — a
 * different thing the model spells differently. 0.2 of threshold is below any
 * recovery interval anybody writes and still unambiguously a target.
 */
export const MINIMUM_SHARE = 0.2;

/**
 * The largest share a target may carry.
 *
 * ⚠️ **This is a typo guard, not a physiological limit.** A rider can produce
 * three times threshold in a sprint and more, and a workout that asks for it
 * for five seconds is a real workout. What this catches is `250` — a percentage
 * written where a share was wanted, which is 250× threshold and which a trainer
 * would answer by applying every newton it has. Refusing at 3.0 costs a rider
 * nothing they can express another way and catches the mistake that hurts.
 */
export const MAXIMUM_SHARE = 3;

/** The largest repeat count a block may carry, for the same reason. */
export const MAXIMUM_REPEATS = 100;

/**
 * The largest number of segments a workout may expand into.
 *
 * ⚠️ **This is the bound that stops a workout exhausting memory, and until
 * [ADR 0017](../../../../docs/adr/0017-workout-file-format.md) it did not
 * exist.** `expandWorkout` builds one array entry per segment and had no limit
 * on how many: ten thousand interval blocks at {@link MAXIMUM_REPEATS} is two
 * million entries, and nothing refused it.
 *
 * That was unreachable while blocks could only be built by `workouts/build.ts`.
 * It stopped being unreachable twice over — a **hand-edited IndexedDB row**
 * reaches `validateWorkout` through `fromPersistedWorkout`, and since ADR 0017
 * so does a **file**, which `CLAUDE.md` §6 classes as untrusted input whose
 * malformed cases must produce an error rather than resource exhaustion.
 *
 * ⚠️ **So the check lives here rather than in the file decoder**, which is the
 * whole point: one rule covering the row and the file, instead of two that can
 * drift apart. ADR 0017 D-6 records that.
 *
 * Like {@link MAXIMUM_SHARE} this is a bound on absurdity and not a design
 * limit. The longest workout anybody writes — five hours of thirty seconds on,
 * thirty seconds off — is 1 200 segments, so this is roughly eight times the
 * largest real thing and costs a rider nothing they can express another way.
 *
 * It does **not** bound the number of *blocks*, because counting segments needs
 * a validated repeat count and so has to run after the per-block loop. What
 * bounds the block count is the decoder's cap on the length of the text it will
 * parse at all — see `format.ts`. The two halves are deliberate and neither
 * substitutes for the other.
 */
export const MAXIMUM_SEGMENTS = 10_000;

/**
 * How many segments a block becomes, without building any of them.
 *
 * The counted-loop shape `analysis/fitness.ts` uses for `dayCount`: the size is
 * arithmetic, so asking for it must not cost the allocation the question exists
 * to avoid.
 */
function blockSegmentCount(block: WorkoutBlock): number {
  // Hard and easy, once per repeat — `expandWorkout` pushes both every time,
  // including the last, and the comment there says why.
  return block.kind === 'intervals' ? block.repeats * 2 : 1;
}

/**
 * How many segments {@link expandWorkout} would produce for this workout.
 *
 * Exported because it is the honest way to ask "is this too big" without
 * finding out by running out of memory.
 */
export function workoutSegmentCount(workout: Workout): number {
  let total = 0;
  for (const block of workout.blocks) {
    total += blockSegmentCount(block);
  }
  return total;
}

/**
 * @throws {WorkoutError} `target-out-of-range` outside
 * {@link MINIMUM_SHARE}..{@link MAXIMUM_SHARE}.
 */
export function thresholdShare(value: number): ThresholdShare {
  if (!Number.isFinite(value) || value < MINIMUM_SHARE || value > MAXIMUM_SHARE) {
    throw new WorkoutError('target-out-of-range', shareRefusal(value));
  }
  return value as ThresholdShare;
}

/**
 * The one wording for an out-of-range target, spelled once.
 *
 * Shared by the constructor and by `assertShare` below rather than written
 * twice, so the two cannot drift — a rider who meets it through a bad file and
 * a developer who meets it through a bad literal are looking at the same
 * mistake and should be told the same thing.
 */
function shareRefusal(value: number, where = 'a power target'): string {
  return (
    `${where} must be a share of threshold between ${String(MINIMUM_SHARE)} and ` +
    `${String(MAXIMUM_SHARE)}; received ${String(value)}. A target of 0.88 is 88% of ` +
    'threshold — if you meant 88, that is 88 times threshold.'
  );
}

/**
 * A stretch of riding at one unchanging target.
 *
 * The simplest thing a workout is made of, and the one every other block
 * reduces to once {@link expandWorkout} has run.
 */
export interface SteadyBlock {
  readonly kind: 'steady';
  readonly seconds: Seconds;
  readonly target: ThresholdShare;
  /** Shown to the rider while it runs. Absent when the workout named nothing. */
  readonly label?: string | undefined;
}

/**
 * A target that moves linearly from one share to another.
 *
 * One block rather than two, because a warm-up that climbs from 0.4 to 0.75 is
 * one thing a rider recognises, and expressing it as a hundred steady steps
 * would make the timeline a hundred entries and the screen unreadable.
 * {@link targetAt} does the interpolation.
 */
export interface RampBlock {
  readonly kind: 'ramp';
  readonly seconds: Seconds;
  readonly from: ThresholdShare;
  readonly to: ThresholdShare;
  readonly label?: string | undefined;
}

/**
 * A repeated hard/easy pair — the over/under shape #14's scope names.
 *
 * Held as a repeat count rather than as an expanded list so that the workout a
 * rider reads says "6 × 3 min at 1.05, 3 min at 0.6" instead of twelve blocks.
 * {@link expandWorkout} is where it becomes twelve.
 */
export interface IntervalsBlock {
  readonly kind: 'intervals';
  readonly repeats: number;
  readonly hardSeconds: Seconds;
  readonly hardTarget: ThresholdShare;
  readonly easySeconds: Seconds;
  readonly easyTarget: ThresholdShare;
  readonly label?: string | undefined;
}

/**
 * Ride however you like for this long.
 *
 * ⚠️ **Not a target of zero, and not ERG at all.** A free ride is where the
 * player *releases* control of the trainer rather than holding a number — a
 * distinction that matters because ERG mode with a low target is the one place
 * a rider cannot simply push harder, and a warm-down nobody can push through is
 * unpleasant. `targetAt` returns `undefined` here and the player reads that as
 * "stop writing targets", which is a different instruction from "write a small
 * one".
 */
export interface FreeRideBlock {
  readonly kind: 'free-ride';
  readonly seconds: Seconds;
  readonly label?: string | undefined;
}

export type WorkoutBlock = SteadyBlock | RampBlock | IntervalsBlock | FreeRideBlock;

/** A workout, as this program holds one. */
export interface Workout {
  readonly name: string;
  /** Free text from whoever wrote it. Absent rather than empty. */
  readonly description?: string | undefined;
  readonly blocks: readonly WorkoutBlock[];
}

/**
 * Check a workout is rideable, and return it.
 *
 * Total: it either returns the workout or throws. There is no "mostly valid"
 * outcome, because the consumer of a workout is a control loop that writes
 * resistance to a device a person is pedalling, and a block it cannot interpret
 * is one it would have to guess about.
 *
 * @throws {WorkoutError}
 */
export function validateWorkout(workout: Workout): Workout {
  if (workout.blocks.length === 0) {
    throw new WorkoutError('empty-workout', 'a workout needs at least one block to ride');
  }
  for (const [index, block] of workout.blocks.entries()) {
    validateBlock(block, index);
  }
  // ⚠️ AFTER the per-block loop, and it has to be: counting segments needs a
  // repeat count that is already known to be a whole number in range, which is
  // what `validateBlock` establishes. Counting first would mean counting with
  // `NaN` and deciding what that means, which is a worse question than paying
  // one pass over an array that is already in memory.
  const segments = workoutSegmentCount(workout);
  if (segments > MAXIMUM_SEGMENTS) {
    throw new WorkoutError(
      'workout-too-long',
      `this workout expands to ${String(segments)} intervals, and the most this program will ` +
        `ride is ${String(MAXIMUM_SEGMENTS)}. Check the repeat counts — a workout this long is ` +
        'usually a repeat count that gained a digit.',
    );
  }
  return workout;
}

function validateBlock(block: WorkoutBlock, index: number): void {
  const where = `block ${String(index + 1)}`;
  switch (block.kind) {
    case 'steady':
      assertDuration(block.seconds, where);
      assertShare(block.target, `${where}'s target`);
      return;
    case 'free-ride':
      assertDuration(block.seconds, where);
      return;
    case 'ramp':
      assertDuration(block.seconds, where);
      assertShare(block.from, `${where} starts at a target that`);
      assertShare(block.to, `${where} ends at a target that`);
      return;
    case 'intervals':
      assertDuration(block.hardSeconds, `${where}'s hard interval`);
      assertDuration(block.easySeconds, `${where}'s easy interval`);
      assertShare(block.hardTarget, `${where}'s hard target`);
      assertShare(block.easyTarget, `${where}'s easy target`);
      if (
        !Number.isInteger(block.repeats) ||
        block.repeats < 1 ||
        block.repeats > MAXIMUM_REPEATS
      ) {
        throw new WorkoutError(
          'invalid-repeat',
          `${where} repeats ${String(block.repeats)} times; it must be a whole number between 1 ` +
            `and ${String(MAXIMUM_REPEATS)}`,
        );
      }
      return;
    default: {
      // ⚠️ The `never` is the guarantee, and it is written out rather than
      // described: adding a kind to `WorkoutBlock` without a case above makes
      // THIS LINE a compile error, because the new member is not assignable to
      // `never`. Without it the switch would fall through silently and a block
      // nobody validated would reach a trainer. The throw is what happens for a
      // value that reached here at runtime past the types — a workout decoded
      // from a file, once a format exists.
      const unhandled: never = block;
      throw new WorkoutError(
        'unknown-block',
        `${where} is a kind of block this program does not know how to ride: ` +
          `${JSON.stringify(unhandled)}`,
      );
    }
  }
}

/**
 * Re-check a target that is already typed as a {@link ThresholdShare}.
 *
 * ⚠️ **This is not belt and braces, it is the only brace that survives the
 * one situation that matters.** `thresholdShare()` is a *constructor* guard: it
 * runs when a workout is built in TypeScript. A workout that arrives as data —
 * decoded from a store row, from a file once #202 gives us a format, from
 * anything that reached the brand past a cast — never went through it, and the
 * brand is a compile-time fiction at that point. `assertDuration` below exists
 * for exactly that reason and this is its sibling; a workout whose duration is
 * checked and whose target is not is checked in the half where a wrong number
 * is merely a short interval, and unchecked in the half where it is a trainer
 * asked for 88 times threshold.
 *
 * The message is the constructor's, word for word, because a rider meeting it
 * through a bad file and a developer meeting it through a bad literal are
 * looking at the same mistake.
 */
function assertShare(value: ThresholdShare, where: string): void {
  if (!Number.isFinite(value) || value < MINIMUM_SHARE || value > MAXIMUM_SHARE) {
    throw new WorkoutError('target-out-of-range', shareRefusal(value, where));
  }
}

function assertDuration(value: Seconds, where: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new WorkoutError(
      'invalid-duration',
      `${where} lasts ${String(value)} seconds; a block must last longer than zero`,
    );
  }
}
