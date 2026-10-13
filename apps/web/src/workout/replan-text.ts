// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words of a re-plan during the ride — #1244, ADR 0048 D-7 and D-12. The
 * ONE module for them, as `hold-text.ts` is for the heart-rate hold's: the
 * Ride screen shows them and both announcers say them.
 *
 * ## Every sentence is composed on the device
 *
 * A proposal carries a move and a reason from two closed lists
 * (`@onyourleft/domain` §`PLAN_MOVE_KINDS`, §`REASON_CODES`) and no text. The
 * sentence a rider reads is built HERE, from this module's own words for
 * each: a part for the move, a part for the reason. There is no parameter
 * through which a model's string could reach it, and the only values printed
 * are numbers the decoder holds to a short list and a block's position in the
 * plan (ADR 0029 D-8's corollary).
 *
 * ## The rules every sentence here keeps (ADR 0048 D-12, the owner's Q12)
 *
 * - One short sentence **about the workout**.
 * - A heart-rate range is *"the range you chose"*: never a limit, never a
 *   number for health or safety.
 * - None of D-12's banned words, and no claim to prevent, treat or reduce the
 *   risk of anything. `replan-text.test.ts` scans every sentence this module
 *   can produce.
 *
 * ## When it is SPOKEN
 *
 * `plan-changed` ranks below `trainer-lost`, `workout-fault`, `erg-held` and
 * `hold-changed` (`game/hud/announce.ts` §`PRIORITY`), is spoken only with
 * announcements on, once for each accepted move, and never in a segment
 * above threshold power or in the last 30 s of one at it
 * ({@link planChangeMayBeSpoken}). A move accepted in such a stretch is said
 * when the stretch ends, if it is still waiting then. A silence is never
 * explained.
 */

import type { PlanMove, ReasonCode, WorkoutSegment } from '@onyourleft/domain';

import { HARD_SEGMENT_SHARE, HOLD_QUIET_BEFORE_HARD_END_SECONDS } from './hold-text';

/** The label a screen puts before a waiting re-plan's sentence. */
export const REPLAN_LABEL = 'Plan change';

/** The one ride-time control: drop the waiting move (ADR 0048 D-7). */
export const KEEP_THE_PLAN = 'Keep the plan';

/** What follows the sentence while the move waits for its boundary. */
export const REPLAN_STARTS_AT_NEXT_BLOCK = 'It starts with the next block.';

/** What the panel says once the rider has pressed {@link KEEP_THE_PLAN}. */
export const PLAN_KEPT = 'The plan stays as it was.';

/**
 * The one short line for every failure (ADR 0048 D-6 P8, D-9): no instance,
 * the connection down, a job that failed, a request the instance refused.
 * It names no cause, because none of them changes what the rider does.
 */
export const REPLAN_UNAVAILABLE =
  'No re-plan could be asked for just now. The workout carries on as planned.';

/** The per-ride switch (ADR 0048 D-6 P7), off unless the rider turns it on. */
export const REPLAN_SWITCH_LABEL = 'Let my instance suggest changes to this workout as I ride';

/** What the switch does, under it. */
export const REPLAN_SWITCH_HELP =
  'After each block, a summary of that block is sent to your instance. It may suggest one change to the blocks ahead, which this device checks and applies at the next block. You can keep the plan as it was.';

const REASONS: Readonly<Record<ReasonCode, string>> = {
  'heart-rate-high': 'because your heart rate stayed above the range you chose',
  'heart-rate-low': 'because your heart rate stayed below the range you chose',
  'cadence-falling': 'because your cadence was falling',
  'goal-time-in-range': 'to fit the time in range you chose',
  'goal-duration': 'to fit the duration you chose',
  'effort-check-in': 'because of the effort you reported',
  'on-plan': 'because the workout is going to plan',
};

const minutesText = (minutes: number): string =>
  minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;

/** "Next block", or the block by its place in the plan, counted from 1. */
function blockName(block: number, next: number): string {
  return block === next ? 'Next block' : `Block ${String(block + 1)}`;
}

/** The same, inside a sentence. */
function blockInSentence(block: number, next: number): string {
  return block === next ? 'the next block' : `block ${String(block + 1)}`;
}

/**
 * What the move does, in this module's words.
 *
 * @param next the block that begins at the next boundary: `Accepted.fromBlock`.
 */
function moveText(move: PlanMove, next: number): string {
  switch (move.kind) {
    case 'extend-block':
      return `${blockName(move.block, next)} lengthened by ${minutesText(move.minutes)}`;
    case 'shorten-block':
      return `${blockName(move.block, next)} shortened by ${minutesText(move.minutes)}`;
    case 'scale-remaining-intervals':
      return move.percent < 0
        ? `Targets before the cool-down lowered by ${String(-move.percent)}%`
        : `Targets before the cool-down raised by ${String(move.percent)}%`;
    case 'move-hold-range':
      return move.bpm < 0
        ? `Heart-rate range for ${blockInSentence(move.block, next)} lowered by ${String(-move.bpm)} bpm`
        : `Heart-rate range for ${blockInSentence(move.block, next)} raised by ${String(move.bpm)} bpm`;
    case 'swap-next-block':
      // The saved workout's name is the rider's own text and is left out all
      // the same: the id that names it arrived in a proposal.
      return 'Next block swapped for one from your saved workouts';
    case 'end-main-set':
      return 'Main set ended early, so the cool-down is next';
  }
}

/**
 * The one sentence for an accepted move: what changes, and the reason the
 * proposal named. *"Next block shortened by 2 minutes, because your heart
 * rate stayed above the range you chose."*
 */
export function replanSentence(move: PlanMove, reason: ReasonCode, next: number): string {
  return `${moveText(move, next)}, ${REASONS[reason]}.`;
}

/** The event both announcers offer; written out here for `hold-text.ts`'s reason. */
export interface PlanChangedEvent {
  readonly kind: 'plan-changed';
  readonly text: string;
}

/** The stretches of a plan, as far as the silence rule reads them. */
export interface SpokenPlan {
  readonly segments: readonly Pick<WorkoutSegment, 'startsAt' | 'endsAt' | 'from' | 'to'>[];
}

/**
 * Whether a re-plan's sentence may be said at this point in the workout: not
 * in a segment above threshold power, and not in the last
 * {@link HOLD_QUIET_BEFORE_HARD_END_SECONDS} of one at or above it (ADR 0048
 * D-12; the shape of ADR 0030 D-7 S1 and S4).
 */
export function planChangeMayBeSpoken(plan: SpokenPlan, elapsedSeconds: number): boolean {
  const segment = plan.segments.find(
    (each) => elapsedSeconds >= each.startsAt && elapsedSeconds < each.endsAt,
  );
  if (segment === undefined) {
    return true;
  }
  const share = Math.max(segment.from ?? 0, segment.to ?? 0);
  if (share > HARD_SEGMENT_SHARE) {
    return false;
  }
  return !(
    share >= HARD_SEGMENT_SHARE &&
    segment.endsAt - elapsedSeconds <= HOLD_QUIET_BEFORE_HARD_END_SECONDS
  );
}

/** A re-plan waiting for its boundary, as a screen reads it. */
export interface WaitingReplan {
  /** Which accepted move this is: a second move is a new number. */
  readonly revision: number;
  readonly sentence: string;
}

/**
 * Whether a waiting re-plan should be offered to an announcer now, and what
 * to remember: the revision last offered.
 *
 * Each accepted move is offered ONCE, the first time the workout is somewhere
 * it may be said. A move that is dropped, or reaches its boundary, before
 * that is never said: the block it changed is announced as it begins, as
 * every block is.
 */
export function planChangeAnnouncement(
  offered: number | undefined,
  waiting: WaitingReplan | undefined,
  where: { readonly timeline: SpokenPlan; readonly elapsedSeconds: number } | undefined,
): { readonly event: PlanChangedEvent | undefined; readonly offered: number | undefined } {
  if (waiting === undefined || waiting.revision === offered) {
    return { event: undefined, offered };
  }
  if (where !== undefined && !planChangeMayBeSpoken(where.timeline, where.elapsedSeconds)) {
    return { event: undefined, offered };
  }
  return {
    event: { kind: 'plan-changed', text: `${REPLAN_LABEL}: ${waiting.sentence}` },
    offered: waiting.revision,
  };
}

/** Every reason clause, for the word scan. */
export const REPLAN_REASON_TEXTS: readonly string[] = Object.values(REASONS);

/** Every fixed sentence and label of this module, for the word scan. */
export const REPLAN_FIXED_TEXTS: readonly string[] = [
  REPLAN_LABEL,
  KEEP_THE_PLAN,
  REPLAN_STARTS_AT_NEXT_BLOCK,
  PLAN_KEPT,
  REPLAN_UNAVAILABLE,
  REPLAN_SWITCH_LABEL,
  REPLAN_SWITCH_HELP,
];
