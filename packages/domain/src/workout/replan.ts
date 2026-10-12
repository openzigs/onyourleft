// SPDX-License-Identifier: Apache-2.0

/**
 * Re-plans during the ride (#1242, ADR 0048 D-4 to D-6): the closed list of
 * moves an instance agent may propose, and the validator that accepts or
 * refuses one on the device.
 *
 * @unwired nothing calls it until #1244 builds the device half of re-plans
 * (`apps/web/src/workout/replan-session.ts`) and #1243 the instance job; this
 * tag is removed there.
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
 * ## What the ADR does not settle, decided here
 *
 * - **Warm-up and cool-down are the first and the last block.** The workout
 *   model marks neither, so the rule is structural: the main set is every
 *   block between them. The last block is never changed or removed by any
 *   move, and the first is never a future block.
 * - **A scale is in percentage points of a block's own share**, kept per
 *   block ({@link PlanBlock.percent}) and applied to the share it had when it
 *   joined the plan. Two +5 moves are therefore +10 % exactly, and no sequence
 *   of moves can take a target more than 10 % above that share.
 * - **A harder move** is any that is not certainly easier: an extension, a
 *   +5 % scale, a hold range moved up, and every swap. Counting a move as
 *   harder only makes P4 refuse more.
 * - **With no duration goal, total time may not grow past the loaded
 *   workout's own.** An absent goal is no licence.
 * - **A swapped-in block needs a block of its own kind in the loaded
 *   workout**, because P3's peak is per kind and no peak is no licence.
 * - **A proposal must name the latest summary sent**, and its age is counted
 *   from when that summary left.
 *
 * It bounds what changes and how fast, never whether the change is wise
 * (ADR 0048 D-5).
 */

import type { BeatsPerMinute, Seconds, Watts } from '../quantities';

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

/** P4: the most a block's share may be raised in total, in percent. */
export const REPLAN_MAXIMUM_CUMULATIVE_PERCENT = 10;

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
  /** The net scale accepted for it, in percentage points of {@link base}'s shares. */
  readonly percent: number;
  /** What is ridden: {@link base} at {@link percent}, inside the bounds of the day. */
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
 * P9: what is kept with the ride for every decision. A refusal's move is
 * present only when the proposal decoded, so nothing undecoded is kept.
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
    blocks: workout.blocks.map((block) => ({ base: block, percent: 0, block })),
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
 */
function scaleShare(
  joined: number,
  ridden: ThresholdShare,
  net: number,
  rising: boolean,
  ceiling: number,
): ThresholdShare {
  const scaled = Math.max(MINIMUM_SHARE, (joined * (100 + net)) / 100);
  return (
    rising ? Math.max(ridden, Math.min(scaled, ceiling)) : Math.min(ridden, scaled)
  ) as ThresholdShare;
}

/** A block after a scale move. A hold and a free ride are not scaled. */
function scaleBlock(entry: PlanBlock, net: number, rising: boolean, ceiling: number): WorkoutBlock {
  const joined = sharesOf(entry.base);
  const at = (index: number, ridden: ThresholdShare): ThresholdShare =>
    scaleShare(joined[index] ?? ridden, ridden, net, rising, ceiling);
  const ridden = entry.block;
  switch (ridden.kind) {
    case 'steady':
      return { ...ridden, target: at(0, ridden.target) };
    case 'ramp':
      return { ...ridden, from: at(0, ridden.from), to: at(1, ridden.to) };
    case 'intervals':
      return {
        ...ridden,
        hardTarget: at(0, ridden.hardTarget),
        easyTarget: at(1, ridden.easyTarget),
      };
    case 'heart-rate-hold':
    case 'free-ride':
      return ridden;
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
    base: { ...entry.base, ...changed },
    percent: entry.percent,
    block: { ...entry.block, ...changed },
  });
  if (extend && totalSeconds(next.map((each) => each.block)) > bounds.longest) {
    return { rule: 'P3' };
  }
  return { blocks: next, harder: extend };
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
    const net = entry.percent + percent;
    if (net > REPLAN_MAXIMUM_CUMULATIVE_PERCENT) {
      over = true;
      return entry;
    }
    const block = scaleBlock(entry, net, percent > 0, bounds.ceiling(base.kind));
    const before = sharesOf(entry.block);
    moved ||= sharesOf(block).some((share, at) => share !== before[at]);
    return { base, percent: net, block };
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
    blocks: replaced(blocks, move.block, { base, percent: 0, block: base }),
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
  const next = replaced(blocks, index, { base: incoming, percent: 0, block: incoming });
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
 * vocabulary, and a swap's library), P7, P6, P5, P2, P4, then the move's own
 * bounds. An accepted move yields the next {@link PlanRevision}, a pure
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
