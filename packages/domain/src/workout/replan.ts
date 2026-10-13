// SPDX-License-Identifier: Apache-2.0

/**
 * Re-plans during the ride (#1242, ADR 0048 D-4 to D-6): the closed list of
 * moves an instance agent may propose, and the validator that accepts or
 * refuses one on the device.
 *
 * The device half that calls {@link validateProposal} is
 * `apps/web/src/workout/replan-session.ts` (#1244); the instance job that
 * calls {@link decodeProposal} is `apps/instance/src/analysis/` (#1243).
 *
 * ## No model text reaches a number
 *
 * A proposal is decoded **whole or not at all** ({@link decodeProposal}): four
 * keys, a move from {@link PLAN_MOVE_KINDS} whose every value is on a short
 * list, and a reason from {@link REASON_CODES}. An unknown key, a value off
 * its list, or a string anywhere but `workoutId` refuses the proposal. The
 * validator then computes every share itself, from the rider's loaded plan —
 * a proposal carries no watt, no share and no sentence (ADR 0029 D-8's
 * corollary: there is no text to interpolate).
 *
 * Both the instance and the device import this module, so the vocabulary
 * cannot drift between them. **The device's answer is the one that counts**:
 * the instance decoding a proposal first is a courtesy, not a check the
 * device relies on.
 *
 * ## Pure
 *
 * {@link validateProposal} reads only its arguments. Time arrives as `now`, on
 * one clock the caller chooses and uses for every time in {@link PlanState};
 * `eslint.config.js` refuses `Date` and `Math.random` in this file. The same
 * inputs give the same answer.
 *
 * ## ⚠️ Every number below is a recorded decision
 *
 * P2–P7's values are the owner's rulings (ADR 0048 D-6, Q4). Changing one is
 * an appended amendment to that ADR, not a commit.
 *
 * ## The eleven decisions ADR 0048's words leave open
 *
 * All eleven are the owner's rulings of 2026-10-12 (#1296), recorded as ADR
 * 0048's amendment of that date under the same numbers, with the rulings of
 * the same day on #1300 (how 2's +10 % and a replaced hold are measured) in
 * the amendment after it. `docs/architecture.md` carries the same list.
 * Changing one is a further amendment.
 *
 * 1. **"Scale the remaining intervals" reaches steady and ramp blocks as well
 *    as intervals blocks.** A hold and a free ride are not scaled.
 * 2. **A swap is bound by P4's +5 % a move and +10 % in total.** The highest
 *    share of the block swapped in may be at most 5 % above the highest share
 *    of the block it replaces, as ridden now. **A replaced hold is read at
 *    its start share**, its ceiling being a cap and not a target (#1300); a
 *    hold swapped in for a hold is compared start with start and ceiling with
 *    ceiling. **The +10 % is of the share the place was loaded with**
 *    ({@link PlanBlock.loadedShare}), so it is a true 10 % and rises do not
 *    compound (#1300): what the replaced block had already been raised by,
 *    and the swap's own rise, are carried by the new block
 *    ({@link PlanBlock.carried}) in percentage points of that share; a fall
 *    earns nothing back. A block with a target may not replace a free ride,
 *    which has no target to measure a rise from, and a hold swapped in for a
 *    hold may have a range at most 5 bpm higher. Every swap is a harder move.
 * 3. **Shortening a recovery is a harder move**, bound by P4's one harder
 *    move in 10 minutes. A recovery is a block whose lowest share is under the
 *    highest share of the block after it, or a free ride before a block with
 *    a target. An extension and a hold range moved up are harder moves too.
 * 4. **A free ride may be swapped in with none loaded.** It sets no target,
 *    so P3's peak has nothing to bound. Every other kind needs a block of its
 *    own kind in the loaded workout: no peak is no licence.
 * 5. **The machine's minimum is not read here.** An easier move is bounded
 *    by {@link MINIMUM_SHARE} alone, so a scaled share may be fewer watts than
 *    the trainer's reported minimum. Raising it to that minimum is for
 *    whatever writes the target, and since #1297 that is
 *    `apps/web/src/workout/session.ts`: every target it writes, a workout's
 *    own and an eased one alike, is raised to its `powerFloor`, the minimum
 *    of the range the machine reported. A share that works out under it is
 *    therefore written as that minimum, and is not refused by
 *    `packages/sensors/protocol/src/fitness-machine-control.ts` with the
 *    target of the block before left on the trainer. ⚠️ Since #1305 there
 *    is one exception: a workout's own target more than 50 W under the
 *    minimum is not written at all, and the rider is told, when this app
 *    knows of no target on the trainer at or above that minimum (in the
 *    client: no target this app has had acknowledged by that trainer since
 *    the page loaded). Wherever the trainer may hold one, the minimum only
 *    eases and is written whatever the gap.
 * 6. **Warm-up and cool-down are the first and the last block.** The workout
 *    model marks neither, so the rule is structural: the main set is every
 *    block between them. The last block is never changed or removed by any
 *    move, and the first is never a future block.
 * 7. **A scale is in percentage points of the share a block joined the plan
 *    with**, kept for each share ({@link PlanBlock.percents}). Two +5 moves
 *    are +10 % exactly, and no sequence of moves takes a target more than
 *    10 % above that share, nor a block swapped in more than 10 % above the
 *    share its place was loaded with. **What is kept is the change reached**: a
 *    share held at its ceiling or at the floor by a move keeps the count it
 *    had, so the next move the other way takes full effect (#1296).
 * 8. **With no duration goal, total time may not grow past the loaded
 *    workout's own.** An absent goal is no licence.
 * 9. **A hold range moves up only to the highest range loaded**, and never
 *    above threshold heart rate or the goal's.
 * 10. **An intervals block is neither extended nor shortened.** Its length is
 *     a repeat count, which no move changes.
 * 11. **A proposal must name the latest summary sent**, and its age is counted
 *     from when that summary left.
 *
 * Where a ruling's words left a choice, the reading that refuses more was
 * taken: counting a move as harder only makes P4 refuse more.
 *
 * It bounds what changes and how fast, never whether the change is wise
 * (ADR 0048 D-5).
 */

import { seconds, type BeatsPerMinute, type Seconds, type Watts } from '../quantities';

import { readWorkoutGoals, type WorkoutGoals } from './goals';
import type { TrainerPowerRange } from './heart-rate-hold';
import {
  MINIMUM_SHARE,
  validateWorkout,
  type ThresholdShare,
  type Workout,
  type WorkoutBlock,
} from './workout';

/** P1: every kind of move there is. A new one is a change to ADR 0048 D-4. */
export const PLAN_MOVE_KINDS = [
  'extend-block',
  'shorten-block',
  'scale-remaining-intervals',
  'move-hold-range',
  'swap-next-block',
  'end-main-set',
] as const;

/** P1: the whole minutes a block may be extended or shortened by. */
export const REPLAN_BLOCK_MINUTES = [1, 2, 5] as const;

/** P1 and P4: the scales. The largest rise is P4's **+5 %** a move. */
export const REPLAN_SCALE_PERCENTS = [-10, -5, 5] as const;

/** P1: how far a hold's range may move, in beats per minute. */
export const REPLAN_HOLD_RANGE_BPM = [-5, -3, 3, 5] as const;

/** P1: every reason there is. None is about a body (ADR 0048 D-12). */
export const REASON_CODES = [
  'heart-rate-high',
  'heart-rate-low',
  'cadence-falling',
  'goal-time-in-range',
  'goal-duration',
  'effort-check-in',
  'on-plan',
] as const;

/** The keys of a proposal: these four and no other. */
export const PROPOSAL_KEYS = ['revision', 'summarySeq', 'move', 'reason'] as const;

/** The rules a refusal names: ADR 0048 D-4's P1 and D-6's P2 to P7. */
export const REPLAN_RULES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

/** P2: a move must arrive at least this long before the next block boundary. */
export const REPLAN_BOUNDARY_LEAD_SECONDS = 30;

/** P4: at most one accepted move in this long. */
export const REPLAN_MOVE_INTERVAL_SECONDS = 180;

/** P4: at most one accepted harder move in this long. */
export const REPLAN_HARDER_INTERVAL_SECONDS = 600;

/** P4: the most one harder move may raise a share, in percent. */
export const REPLAN_MAXIMUM_MOVE_PERCENT = 5;

/** P4: the most a block's share may be raised in total, in percent. */
export const REPLAN_MAXIMUM_CUMULATIVE_PERCENT = 10;

/** The most a hold swapped in for a hold may raise the range: P1's largest step. */
export const REPLAN_MAXIMUM_SWAP_RANGE_BPM = 5;

/** P5: a proposal older than this is stale. */
export const REPLAN_FRESHNESS_SECONDS = 60;

/** The longest `workoutId` the decoder reads; a saved workout's id is far shorter. */
export const MAXIMUM_WORKOUT_ID_CHARACTERS = 128;

export type PlanMove =
  | {
      readonly kind: 'extend-block' | 'shorten-block';
      readonly block: number;
      readonly minutes: (typeof REPLAN_BLOCK_MINUTES)[number];
    }
  | {
      readonly kind: 'scale-remaining-intervals';
      readonly percent: (typeof REPLAN_SCALE_PERCENTS)[number];
    }
  | {
      readonly kind: 'move-hold-range';
      readonly block: number;
      readonly bpm: (typeof REPLAN_HOLD_RANGE_BPM)[number];
    }
  /** One block of one of the rider's own saved workouts, for the next block. */
  | { readonly kind: 'swap-next-block'; readonly workoutId: string; readonly blockIndex: number }
  | { readonly kind: 'end-main-set' };

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReplanRule = (typeof REPLAN_RULES)[number];

/** What an agent sends: one move, one reason, and what it was computed from. */
export interface Proposal {
  /** The plan revision the agent read. */
  readonly revision: number;
  /** The summary the agent read. */
  readonly summarySeq: number;
  readonly move: PlanMove;
  readonly reason: ReasonCode;
}

/** One block of a plan, and how far re-plans have scaled it. */
export interface PlanBlock {
  /** The block as it joined the plan, with durations and ranges as last moved. */
  readonly base: WorkoutBlock;
  /**
   * The net scale each share has reached, in percentage points of
   * {@link base}'s share, in the order steady `target`; ramp `from`, `to`;
   * intervals `hardTarget`, `easyTarget`. A share a move could not move keeps
   * the count it had. Empty for a free ride, and all 0 for a hold.
   */
  readonly percents: readonly number[];
  /**
   * P4: the share this place in the plan was loaded with, which the +10 % is
   * measured against whatever has been swapped in since (#1300). The loaded
   * block's highest share, or its start share for a hold; `undefined` for a
   * free ride, which sets none.
   */
  readonly loadedShare: number | undefined;
  /**
   * P4: the rise already spent in this place before {@link base} joined the
   * plan, by swaps and by scales of the blocks it replaced, in percentage
   * points of {@link loadedShare}. 0 for a loaded block. It counts toward
   * the +10 %.
   */
  readonly carried: number;
  /** What is ridden: {@link base} at {@link percents}, inside the bounds of the day. */
  readonly block: WorkoutBlock;
}

/** A plan as last revised. Made by {@link loadPlan}, and by an accepted move. */
export interface PlanRevision {
  /** 0 for the loaded workout, and one more for every accepted move. */
  readonly revision: number;
  /** The workout the rider loaded: P3's peaks and P3's time are read from it. */
  readonly loaded: Workout;
  readonly blocks: readonly PlanBlock[];
  /** When the last move was accepted, for P4. */
  readonly lastAcceptedAt?: Seconds | undefined;
  /** When the last harder move was accepted, for P4. */
  readonly lastHarderAt?: Seconds | undefined;
}

/** One of the rider's own saved workouts, as their library holds it. */
export interface SavedWorkout {
  readonly id: string;
  readonly workout: Workout;
}

/** Where the ride is when a proposal arrives. Every time is on `now`'s clock. */
export interface PlanState {
  readonly plan: PlanRevision;
  /** How far into the plan the rider is, in seconds of workout. */
  readonly position: Seconds;
  /** The latest summary sent to the instance; `undefined` when none has been. */
  readonly summary: { readonly seq: number; readonly sentAt: Seconds } | undefined;
  /** P7: re-plans are switched on for this ride. */
  readonly enabled: boolean;
  /** P6. */
  readonly paused: boolean;
  /** P6: the stall rescue holds the target. */
  readonly rescue: boolean;
  /** P6: trainer control is held. */
  readonly control: boolean;
  /** P6, H1: a heart-rate strap is paired. */
  readonly heartRatePaired: boolean;
  /** The rider's own saved workouts, the only source of a swap. */
  readonly library: readonly SavedWorkout[];
}

/** The rider's thresholds, and whether either is a substituted default (H1). */
export interface OwnThresholds {
  readonly thresholdPower: Watts;
  readonly thresholdHeartRate: BeatsPerMinute;
  readonly assumed: { readonly power: boolean; readonly heartRate: boolean };
}

/**
 * Why an accepted move never reached the plan being ridden (ADR 0048 D-7,
 * D-8): the rider pressed *Keep the plan*, the ride paused or lost its
 * trainer before the boundary, the workout ended first, or the player would
 * not take the revised plan (`player.ts` §`revise`).
 */
export const REPLAN_NOT_APPLIED = ['kept', 'paused', 'ended', 'not-taken'] as const;

export type ReplanNotApplied = (typeof REPLAN_NOT_APPLIED)[number];

/**
 * P9: what is kept with the ride for every decision. A refusal's move is
 * present only when the proposal decoded, so nothing undecoded is kept.
 *
 * `not-applied` (#1244) follows an `accepted` record whose move was dropped
 * before its boundary, and names that record's revision: without it the
 * ride's record would say a move was made that the rider never rode.
 */
export type ReplanRecord =
  | {
      readonly decision: 'accepted';
      readonly move: PlanMove;
      readonly reason: ReasonCode;
      /** The revision the move made. */
      readonly revision: number;
      readonly at: Seconds;
    }
  | {
      readonly decision: 'refused';
      readonly rule: ReplanRule;
      readonly move?: PlanMove | undefined;
      readonly reason?: ReasonCode | undefined;
      readonly at: Seconds;
    }
  | {
      readonly decision: 'not-applied';
      readonly why: ReplanNotApplied;
      /** The revision that was dropped: an `accepted` record's. */
      readonly revision: number;
      readonly at: Seconds;
    };

export interface Accepted {
  readonly ok: true;
  /** The new revision. Nothing at or before the block being ridden differs. */
  readonly plan: PlanRevision;
  /** {@link plan} as a workout the player reads from the next boundary. */
  readonly workout: Workout;
  /** The first block that may differ: the one after the block being ridden. */
  readonly fromBlock: number;
  readonly record: ReplanRecord;
}

/** A refusal names its rule and carries nothing of the proposal. */
export interface Refused {
  readonly ok: false;
  readonly rule: ReplanRule;
  readonly record: ReplanRecord;
}

/**
 * A loaded workout as revision 0 of a plan.
 *
 * @throws {WorkoutError} for anything `validateWorkout` refuses.
 */
export function loadPlan(workout: Workout): PlanRevision {
  validateWorkout(workout);
  return {
    revision: 0,
    loaded: workout,
    blocks: workout.blocks.map((block) => ({
      base: block,
      percents: sharesOf(block).map(() => 0),
      loadedShare: measuredShare(block),
      carried: 0,
      block,
    })),
  };
}

/**
 * The plan after an accepted revision was dropped before its boundary
 * (#1244): the blocks still being ridden, under a NEW revision number, with
 * the dropped move's P4 times kept.
 *
 * - **The number moves on**, so a proposal computed from the dropped revision
 *   names a revision this plan never has again, and is refused under P5.
 * - **The times are kept**, so dropping a move does not buy another one
 *   sooner: P4's three and ten minutes count from the move that was accepted,
 *   whether or not it was ridden. That refuses more, never less.
 *
 * @param riding the plan in force, which stays.
 * @param dropped the accepted revision that will not be ridden.
 */
export function planNotApplied(riding: PlanRevision, dropped: PlanRevision): PlanRevision {
  return {
    revision: Math.max(riding.revision, dropped.revision) + 1,
    loaded: riding.loaded,
    blocks: riding.blocks,
    lastAcceptedAt: dropped.lastAcceptedAt,
    lastHarderAt: dropped.lastHarderAt,
  };
}

/** The workout a plan rides: the loaded one, with its blocks as last revised. */
export function planWorkout(plan: PlanRevision): Workout {
  return { ...plan.loaded, blocks: plan.blocks.map((entry) => entry.block) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly these own keys: none missing, none extra. */
function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** A number that is one of a list. `'5'` is not `5`, and neither is `5.0001`. */
function isOneOf<T extends number | string>(value: unknown, list: readonly T[]): value is T {
  return (list as readonly unknown[]).includes(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeMove(value: unknown): PlanMove | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind } = value;
  switch (kind) {
    case 'extend-block':
    case 'shorten-block': {
      const { block, minutes } = value;
      return hasExactly(value, ['kind', 'block', 'minutes']) &&
        isIndex(block) &&
        isOneOf(minutes, REPLAN_BLOCK_MINUTES)
        ? { kind, block, minutes }
        : undefined;
    }
    case 'scale-remaining-intervals': {
      const { percent } = value;
      return hasExactly(value, ['kind', 'percent']) && isOneOf(percent, REPLAN_SCALE_PERCENTS)
        ? { kind, percent }
        : undefined;
    }
    case 'move-hold-range': {
      const { block, bpm } = value;
      return hasExactly(value, ['kind', 'block', 'bpm']) &&
        isIndex(block) &&
        isOneOf(bpm, REPLAN_HOLD_RANGE_BPM)
        ? { kind, block, bpm }
        : undefined;
    }
    case 'swap-next-block': {
      const { workoutId, blockIndex } = value;
      return hasExactly(value, ['kind', 'workoutId', 'blockIndex']) &&
        typeof workoutId === 'string' &&
        workoutId.length > 0 &&
        workoutId.length <= MAXIMUM_WORKOUT_ID_CHARACTERS &&
        isIndex(blockIndex)
        ? { kind, workoutId, blockIndex }
        : undefined;
    }
    case 'end-main-set':
      return hasExactly(value, ['kind']) ? { kind } : undefined;
    default:
      return undefined;
  }
}

/**
 * P1: reads a value as a proposal, or as nothing. Never a partial proposal,
 * and the result is a new object holding only the keys this module names.
 *
 * It says only whether the value is in the vocabulary. Whether the move may
 * be made is {@link validateProposal}'s to say, on the device.
 */
export function decodeProposal(value: unknown): Proposal | undefined {
  if (!isRecord(value) || !hasExactly(value, PROPOSAL_KEYS)) {
    return undefined;
  }
  const { revision, summarySeq, reason } = value;
  if (!isIndex(revision) || !isIndex(summarySeq) || !isOneOf(reason, REASON_CODES)) {
    return undefined;
  }
  const move = decodeMove(value['move']);
  return move === undefined ? undefined : { revision, summarySeq, move, reason };
}

/** A time a record may carry: a finite number of seconds, not negative. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * P9: reads a value as one {@link ReplanRecord}, or as nothing (#1244). What
 * a ride kept is read back by this before anything shows it, so a row edited
 * by hand, or written by a later build with a move this one does not know,
 * is no record rather than half of one. The result is a new object holding
 * only the keys this module names, and its move and reason are read by the
 * same lists as a proposal's ({@link decodeProposal}).
 */
export function readReplanRecord(value: unknown): ReplanRecord | undefined {
  if (!isRecord(value) || !isTime(value['at'])) {
    return undefined;
  }
  const at = seconds(value['at']);
  switch (value['decision']) {
    case 'accepted': {
      const move = decodeMove(value['move']);
      const { reason, revision } = value;
      return hasExactly(value, ['decision', 'move', 'reason', 'revision', 'at']) &&
        move !== undefined &&
        isOneOf(reason, REASON_CODES) &&
        isIndex(revision)
        ? { decision: 'accepted', move, reason, revision, at }
        : undefined;
    }
    case 'refused': {
      const { rule } = value;
      if (!isOneOf(rule, REPLAN_RULES)) {
        return undefined;
      }
      // A refusal carries its move and reason together, or neither.
      if (hasExactly(value, ['decision', 'rule', 'at'])) {
        return { decision: 'refused', rule, at };
      }
      const move = decodeMove(value['move']);
      const { reason } = value;
      return hasExactly(value, ['decision', 'rule', 'move', 'reason', 'at']) &&
        move !== undefined &&
        isOneOf(reason, REASON_CODES)
        ? { decision: 'refused', rule, move, reason, at }
        : undefined;
    }
    case 'not-applied': {
      const { why, revision } = value;
      return hasExactly(value, ['decision', 'why', 'revision', 'at']) &&
        isOneOf(why, REPLAN_NOT_APPLIED) &&
        isIndex(revision)
        ? { decision: 'not-applied', why, revision, at }
        : undefined;
    }
    default:
      return undefined;
  }
}

function blockSeconds(block: WorkoutBlock): number {
  return block.kind === 'intervals'
    ? block.repeats * (block.hardSeconds + block.easySeconds)
    : block.seconds;
}

function totalSeconds(blocks: readonly WorkoutBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total += blockSeconds(block);
  }
  return total;
}

/** The highest share a block asks for; `undefined` for a free ride, which asks for none. */
function peakShare(block: WorkoutBlock): number | undefined {
  switch (block.kind) {
    case 'steady':
      return block.target;
    case 'ramp':
      return Math.max(block.from, block.to);
    case 'intervals':
      return Math.max(block.hardTarget, block.easyTarget);
    case 'heart-rate-hold':
      return block.ceilingShare;
    case 'free-ride':
      return undefined;
  }
}

/**
 * The share a block is measured at when a rise over it is counted: its
 * highest, but a hold's start share, since its ceiling is a cap and not a
 * target (#1300).
 */
function measuredShare(block: WorkoutBlock): number | undefined {
  return block.kind === 'heart-rate-hold' ? block.startShare : peakShare(block);
}

/** The bounds of the day, read once per proposal from the validator's own arguments. */
interface Bounds {
  /** P3: the highest share a block of a kind may be raised to, or swapped in at. */
  ceiling(kind: WorkoutBlock['kind']): number;
  /** P3: the highest a hold's range may reach, in beats per minute. */
  readonly holdTop: number;
  /** P3: the longest the plan may become, in seconds. */
  readonly longest: number;
}

function boundsOf(
  loaded: Workout,
  goals: WorkoutGoals,
  athlete: OwnThresholds,
  machine: TrainerPowerRange,
): Bounds {
  const peaks = new Map<WorkoutBlock['kind'], number>();
  let loadedHoldTop = Number.NEGATIVE_INFINITY;
  for (const block of loaded.blocks) {
    const peak = peakShare(block);
    if (peak !== undefined) {
      peaks.set(block.kind, Math.max(peaks.get(block.kind) ?? peak, peak));
    }
    if (block.kind === 'heart-rate-hold') {
      loadedHoldTop = Math.max(loadedHoldTop, block.range.high);
    }
  }
  const outer = Math.min(
    goals.powerCeiling ?? Number.POSITIVE_INFINITY,
    machine.maximum / athlete.thresholdPower,
  );
  return {
    // A kind the loaded workout has no block of has no peak, and so no licence.
    ceiling: (kind) => Math.min(outer, peaks.get(kind) ?? Number.NEGATIVE_INFINITY),
    holdTop: Math.min(
      loadedHoldTop,
      athlete.thresholdHeartRate,
      goals.heartRateAbove ?? Number.POSITIVE_INFINITY,
      goals.holdRange?.high ?? Number.POSITIVE_INFINITY,
    ),
    longest:
      goals.durationMinutes === undefined
        ? totalSeconds(loaded.blocks)
        : goals.durationMinutes * 60,
  };
}

/** The shares a block asks for, in a fixed order, to compare two versions of it. */
function sharesOf(block: WorkoutBlock): readonly number[] {
  switch (block.kind) {
    case 'steady':
      return [block.target];
    case 'ramp':
      return [block.from, block.to];
    case 'intervals':
      return [block.hardTarget, block.easyTarget];
    case 'heart-rate-hold':
      return [block.startShare, block.ceilingShare];
    case 'free-ride':
      return [];
  }
}

/**
 * One share after a scale move: the share the block joined with, at its net
 * scale, but never moved the wrong way from what is ridden now. A rise stops
 * at the ceiling, and leaves a share already above it where it is; a cut
 * stops at {@link MINIMUM_SHARE}, which is a target and never a Stop.
 *
 * `percent` is the net scale the share reached, which is `net` only when
 * nothing stopped it. A share that did not move keeps the count it had: a
 * count advanced by a move that changed nothing would be spent by the next
 * move the other way, which would then change nothing either (#1296).
 */
function scaleShare(
  joined: number,
  ridden: ThresholdShare,
  before: number,
  net: number,
  rising: boolean,
  ceiling: number,
): { readonly share: ThresholdShare; readonly percent: number } {
  const asked = (joined * (100 + net)) / 100;
  const share = (
    rising
      ? Math.max(ridden, Math.min(asked, ceiling))
      : Math.min(ridden, Math.max(asked, MINIMUM_SHARE))
  ) as ThresholdShare;
  if (share === ridden) {
    return { share, percent: before };
  }
  return { share, percent: share === asked ? net : (share / joined - 1) * 100 };
}

/** A block with the shares {@link sharesOf} reads, replaced in the same order. */
function withShares(block: WorkoutBlock, shares: readonly ThresholdShare[]): WorkoutBlock {
  const [first, second] = shares;
  switch (block.kind) {
    case 'steady':
      return first === undefined ? block : { ...block, target: first };
    case 'ramp':
      return first === undefined || second === undefined
        ? block
        : { ...block, from: first, to: second };
    case 'intervals':
      return first === undefined || second === undefined
        ? block
        : { ...block, hardTarget: first, easyTarget: second };
    case 'heart-rate-hold':
    case 'free-ride':
      return block;
  }
}

/** What applying a move gives: the new blocks, or the rule that refuses it. */
type Applied =
  | { readonly blocks: readonly PlanBlock[]; readonly harder: boolean }
  | { readonly rule: ReplanRule };

/** A block the move names must be after the one being ridden, and not the cool-down. */
function futureBlock(
  blocks: readonly PlanBlock[],
  index: number,
  current: number,
): PlanBlock | ReplanRule {
  const entry = index > current ? blocks[index] : undefined;
  if (entry === undefined) {
    return 'P2';
  }
  return index === blocks.length - 1 ? 'P3' : entry;
}

function replaced(
  blocks: readonly PlanBlock[],
  index: number,
  entry: PlanBlock,
): readonly PlanBlock[] {
  return blocks.map((old, at) => (at === index ? entry : old));
}

/**
 * A ratio of two shares is not exact: 0.735 / 0.7 is a hair over 1.05. A rise
 * this far over a limit is at the limit.
 */
const ROUNDING_PERCENT = 1e-9;

/**
 * A change of share as percentage points of the share the place was loaded
 * with, which is what the +10 % is counted in (#1300). A place loaded with no
 * target has no share to measure from, so anything there is over. The
 * infinity is there for the type, which wants a number: no place reaches it
 * with a rise to measure, since a block with a target cannot replace a free
 * ride.
 */
function loadedPoints(rise: number, entry: PlanBlock): number {
  return entry.loadedShare === undefined
    ? Number.POSITIVE_INFINITY
    : (rise / entry.loadedShare) * 100;
}

/**
 * What a swap is measured on: each share of the block swapped in, beside the
 * share of the replaced block it is compared with. A replaced hold is read at
 * its start share, and against another hold like with like. Nothing for a
 * free ride swapped in; `undefined` for a target in place of a free ride,
 * which has none to measure a rise from.
 */
function swapPairs(
  incoming: WorkoutBlock,
  outgoing: WorkoutBlock,
): readonly (readonly [number, number])[] | undefined {
  const peak = peakShare(incoming);
  if (peak === undefined) {
    return [];
  }
  if (incoming.kind === 'heart-rate-hold' && outgoing.kind === 'heart-rate-hold') {
    return [
      [incoming.startShare, outgoing.startShare],
      [incoming.ceilingShare, outgoing.ceilingShare],
    ];
  }
  const from = measuredShare(outgoing);
  return from === undefined ? undefined : [[peak, from]];
}

/**
 * Whether a block is a recovery before the block after it: its lowest share is
 * under that block's highest. A free ride asks for nothing, so it is a
 * recovery before any block with a target, and nothing is a recovery before
 * one. Shortening a recovery brings the harder block sooner.
 */
function isRecovery(block: WorkoutBlock, following: WorkoutBlock | undefined): boolean {
  const ahead = following === undefined ? undefined : peakShare(following);
  if (ahead === undefined) {
    return false;
  }
  const shares = sharesOf(block);
  return shares.length === 0 || Math.min(...shares) < ahead;
}

function applyDuration(
  move: Extract<PlanMove, { kind: 'extend-block' | 'shorten-block' }>,
  blocks: readonly PlanBlock[],
  current: number,
  bounds: Bounds,
): Applied {
  const entry = futureBlock(blocks, move.block, current);
  if (typeof entry === 'string') {
    return { rule: entry };
  }
  if (entry.base.kind === 'intervals') {
    // Its length is a repeat count, which no move changes.
    return { rule: 'P1' };
  }
  const extend = move.kind === 'extend-block';
  const length = entry.base.seconds + (extend ? 60 : -60) * move.minutes;
  if (length <= 0) {
    // Shortening a block to nothing is removing it, and no move removes one block.
    return { rule: 'P1' };
  }
  const changed = { seconds: length as Seconds };
  const next = replaced(blocks, move.block, {
    ...entry,
    base: { ...entry.base, ...changed },
    block: { ...entry.block, ...changed },
  });
  if (extend && totalSeconds(next.map((each) => each.block)) > bounds.longest) {
    return { rule: 'P3' };
  }
  // The block after it is always there: `futureBlock` refuses the last block.
  return { blocks: next, harder: extend || isRecovery(entry.block, blocks[move.block + 1]?.block) };
}

function applyScale(
  percent: (typeof REPLAN_SCALE_PERCENTS)[number],
  blocks: readonly PlanBlock[],
  current: number,
  bounds: Bounds,
): Applied {
  let reached = false;
  let moved = false;
  let over = false;
  const next = blocks.map((entry, index) => {
    const { base } = entry;
    if (
      index <= current ||
      index === blocks.length - 1 ||
      base.kind === 'heart-rate-hold' ||
      base.kind === 'free-ride'
    ) {
      return entry;
    }
    reached = true;
    const nets = entry.percents.map((each) => each + percent);
    const joined = sharesOf(base);
    // P4, twice: +10 % of the share the block joined with, and, with what the
    // place had already spent, +10 % of the share it was loaded with.
    if (
      nets.some(
        (net, at) =>
          net > REPLAN_MAXIMUM_CUMULATIVE_PERCENT ||
          entry.carried + loadedPoints(((joined[at] ?? 0) * net) / 100, entry) >
            REPLAN_MAXIMUM_CUMULATIVE_PERCENT + ROUNDING_PERCENT,
      )
    ) {
      over = true;
      return entry;
    }
    const before = sharesOf(entry.block) as readonly ThresholdShare[];
    const ceiling = bounds.ceiling(base.kind);
    const scaled = before.map((ridden, at) =>
      scaleShare(
        joined[at] ?? ridden,
        ridden,
        entry.percents[at] ?? 0,
        nets[at] ?? 0,
        percent > 0,
        ceiling,
      ),
    );
    moved ||= scaled.some((each, at) => each.share !== before[at]);
    return {
      base,
      percents: scaled.map((each) => each.percent),
      loadedShare: entry.loadedShare,
      carried: entry.carried,
      block: withShares(
        entry.block,
        scaled.map((each) => each.share),
      ),
    };
  });
  if (!reached) {
    return { rule: 'P2' };
  }
  if (over) {
    return { rule: 'P4' };
  }
  // Every share is already at its bound: there is nothing this move changes.
  return moved ? { blocks: next, harder: percent > 0 } : { rule: 'P3' };
}

function applyHoldRange(
  move: Extract<PlanMove, { kind: 'move-hold-range' }>,
  blocks: readonly PlanBlock[],
  current: number,
  bounds: Bounds,
): Applied {
  const entry = futureBlock(blocks, move.block, current);
  if (typeof entry === 'string') {
    return { rule: entry };
  }
  if (entry.base.kind !== 'heart-rate-hold') {
    return { rule: 'P1' };
  }
  const low = entry.base.range.low + move.bpm;
  const high = entry.base.range.high + move.bpm;
  // Down is bounded by the lowest range `validateWorkout` reads, at the end.
  if (move.bpm > 0 && high > bounds.holdTop) {
    return { rule: 'P3' };
  }
  const base: WorkoutBlock = {
    ...entry.base,
    range: { low: low as BeatsPerMinute, high: high as BeatsPerMinute },
  };
  return {
    blocks: replaced(blocks, move.block, { ...entry, base, block: base }),
    harder: move.bpm > 0,
  };
}

function applySwap(
  incoming: WorkoutBlock,
  blocks: readonly PlanBlock[],
  current: number,
  bounds: Bounds,
): Applied {
  const index = current + 1;
  const entry = futureBlock(blocks, index, current);
  if (typeof entry === 'string') {
    return { rule: entry };
  }
  // Bounded like any other block: its shares, its range and the plan's length.
  const peak = peakShare(incoming);
  if (peak !== undefined && peak > bounds.ceiling(incoming.kind)) {
    return { rule: 'P3' };
  }
  if (incoming.kind === 'heart-rate-hold' && incoming.range.high > bounds.holdTop) {
    return { rule: 'P3' };
  }
  // P4: at most +5 % over the block it replaces, as ridden now, and at most
  // +10 % in all over the share the place was loaded with: what the replaced
  // block had been raised by is not forgotten. Neither a fall nor a cut earns
  // anything back.
  const pairs = swapPairs(incoming, entry.block);
  if (pairs === undefined) {
    return { rule: 'P4' };
  }
  let rise = 0;
  let risen = 0;
  for (const [to, from] of pairs) {
    rise = Math.max(rise, (to / from - 1) * 100);
    risen = Math.max(risen, loadedPoints(to - from, entry));
  }
  const joined = sharesOf(entry.base);
  let scaled = 0;
  for (const [at, percent] of entry.percents.entries()) {
    scaled = Math.max(scaled, loadedPoints(((joined[at] ?? 0) * percent) / 100, entry));
  }
  const carried = entry.carried + scaled + risen;
  if (
    rise > REPLAN_MAXIMUM_MOVE_PERCENT + ROUNDING_PERCENT ||
    carried > REPLAN_MAXIMUM_CUMULATIVE_PERCENT + ROUNDING_PERCENT
  ) {
    return { rule: 'P4' };
  }
  if (
    incoming.kind === 'heart-rate-hold' &&
    entry.block.kind === 'heart-rate-hold' &&
    incoming.range.high > entry.block.range.high + REPLAN_MAXIMUM_SWAP_RANGE_BPM
  ) {
    return { rule: 'P4' };
  }
  const next = replaced(blocks, index, {
    base: incoming,
    percents: sharesOf(incoming).map(() => 0),
    loadedShare: entry.loadedShare,
    carried,
    block: incoming,
  });
  const before = totalSeconds(blocks.map((each) => each.block));
  const after = totalSeconds(next.map((each) => each.block));
  if (after > bounds.longest && after > before) {
    return { rule: 'P3' };
  }
  return { blocks: next, harder: true };
}

function applyMove(
  move: PlanMove,
  incoming: WorkoutBlock | undefined,
  blocks: readonly PlanBlock[],
  current: number,
  bounds: Bounds,
): Applied {
  switch (move.kind) {
    case 'extend-block':
    case 'shorten-block':
      return applyDuration(move, blocks, current, bounds);
    case 'scale-remaining-intervals':
      return applyScale(move.percent, blocks, current, bounds);
    case 'move-hold-range':
      return applyHoldRange(move, blocks, current, bounds);
    case 'swap-next-block':
      return incoming === undefined ? { rule: 'P1' } : applySwap(incoming, blocks, current, bounds);
    case 'end-main-set':
      // What is left is the block being ridden, then the cool-down.
      return current + 1 < blocks.length - 1
        ? {
            blocks: blocks.filter((_, index) => index <= current || index === blocks.length - 1),
            harder: false,
          }
        : { rule: 'P2' };
  }
}

/** The block of the rider's own library a swap names, if it is one they could ride. */
function libraryBlock(
  move: Extract<PlanMove, { kind: 'swap-next-block' }>,
  library: readonly SavedWorkout[],
): WorkoutBlock | undefined {
  const saved = library.find((each) => each.id === move.workoutId);
  if (saved === undefined) {
    return undefined;
  }
  try {
    validateWorkout(saved.workout);
  } catch {
    return undefined;
  }
  return saved.workout.blocks[move.blockIndex];
}

/** The block being ridden and how long until it ends, or `undefined` past the end. */
function whereIn(
  blocks: readonly PlanBlock[],
  position: number,
): { readonly current: number; readonly remaining: number } | undefined {
  let end = 0;
  for (const [index, entry] of blocks.entries()) {
    end += blockSeconds(entry.block);
    if (position < end) {
      return { current: index, remaining: end - position };
    }
  }
  return undefined;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Accept or refuse one proposal, on the device.
 *
 * The first rule that refuses is the one named, in this order: P1 (the
 * vocabulary, and a swap's library), P7, P6, P5, P2, P4's three minutes, then
 * the move's own bounds (a swap's P3 ceilings, then P4's rises, then P3's
 * length), then P4's ten minutes. An
 * accepted move yields the next {@link PlanRevision}, a pure
 * function of the old one and the move, in which nothing at or before the
 * block being ridden differs.
 *
 * @param proposal whatever arrived. Untrusted, and never trusted for having
 * been decoded by the instance.
 * @param now the time on the clock every time in `state` was read from.
 */
export function validateProposal(
  proposal: unknown,
  state: PlanState,
  goals: WorkoutGoals,
  athlete: OwnThresholds,
  machine: TrainerPowerRange,
  now: Seconds,
): Accepted | Refused {
  const decoded = decodeProposal(proposal);
  // A swap is in the vocabulary only when it names the rider's own workout:
  // until then its id is model text, and is not kept.
  const incoming =
    decoded?.move.kind === 'swap-next-block'
      ? libraryBlock(decoded.move, state.library)
      : undefined;
  if (
    decoded === undefined ||
    (decoded.move.kind === 'swap-next-block' && incoming === undefined)
  ) {
    return { ok: false, rule: 'P1', record: { decision: 'refused', rule: 'P1', at: now } };
  }
  const { move, reason } = decoded;
  const refuse = (rule: ReplanRule): Refused => ({
    ok: false,
    rule,
    record: { decision: 'refused', rule, move, reason, at: now },
  });

  if (!state.enabled) {
    return refuse('P7');
  }

  const { plan } = state;
  const where = Number.isFinite(state.position) ? whereIn(plan.blocks, state.position) : undefined;
  const typed = readWorkoutGoals(goals);
  if (
    state.paused ||
    state.rescue ||
    !state.control ||
    !state.heartRatePaired ||
    athlete.assumed.power ||
    athlete.assumed.heartRate ||
    !isPositive(athlete.thresholdPower) ||
    !isPositive(athlete.thresholdHeartRate) ||
    !isPositive(machine.maximum) ||
    !typed.ok ||
    // Inside the cool-down.
    where?.current === plan.blocks.length - 1
  ) {
    return refuse('P6');
  }

  const age = state.summary === undefined ? Number.NaN : now - state.summary.sentAt;
  if (
    decoded.revision !== plan.revision ||
    decoded.summarySeq !== state.summary?.seq ||
    !(age >= 0 && age <= REPLAN_FRESHNESS_SECONDS)
  ) {
    return refuse('P5');
  }

  if (where === undefined || where.remaining < REPLAN_BOUNDARY_LEAD_SECONDS) {
    return refuse('P2');
  }

  if (
    plan.lastAcceptedAt !== undefined &&
    !(now - plan.lastAcceptedAt >= REPLAN_MOVE_INTERVAL_SECONDS)
  ) {
    return refuse('P4');
  }

  const applied = applyMove(
    move,
    incoming,
    plan.blocks,
    where.current,
    boundsOf(plan.loaded, typed.goals, athlete, machine),
  );
  if ('rule' in applied) {
    return refuse(applied.rule);
  }
  if (
    applied.harder &&
    plan.lastHarderAt !== undefined &&
    !(now - plan.lastHarderAt >= REPLAN_HARDER_INTERVAL_SECONDS)
  ) {
    return refuse('P4');
  }

  const next: PlanRevision = {
    revision: plan.revision + 1,
    loaded: plan.loaded,
    blocks: applied.blocks,
    lastAcceptedAt: now,
    lastHarderAt: applied.harder ? now : plan.lastHarderAt,
  };
  const workout = planWorkout(next);
  try {
    // The last word: a plan the player could not ride is not a plan.
    validateWorkout(workout);
  } catch {
    return refuse('P3');
  }
  return {
    ok: true,
    plan: next,
    workout,
    fromBlock: where.current + 1,
    record: { decision: 'accepted', move, reason, revision: next.revision, at: now },
  };
}
