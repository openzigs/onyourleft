// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words of a re-plan WHILE IT HAPPENS — #1244, ADR 0048 D-7 and D-12:
 * the sentences composed from a move and a reason, and the status lines. The
 * Ride screen shows them and both announcers say them, as `hold-text.ts` is
 * for the heart-rate hold's.
 *
 * ⚠️ **The switch's label, its disclosure and the control's name are NOT
 * here.** They are `replan-disclosure.ts`'s (#1245), which the privacy policy
 * is held to word for word: `REPLAN_SWITCH_LABEL`, `replanDisclosure()` and
 * `REPLAN_KEEP_BUTTON`. This module had copies of two of them and no longer
 * does, so the owner approves one set of words.
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

/** What follows the sentence while the move waits for its boundary. */
export const REPLAN_STARTS_AT_NEXT_BLOCK = 'It starts with the next block.';

/** What the panel says once the rider has pressed *Keep the plan* (`REPLAN_KEEP_BUTTON`). */
export const PLAN_KEPT = 'The plan stays as it was.';

/**
 * The one short line for every failure (ADR 0048 D-6 P8, D-9): no instance,
 * the connection down, a job that failed, a request the instance refused.
 * It names no cause, because none of them changes what the rider does.
 */
export const REPLAN_UNAVAILABLE =
  'No re-plan could be asked for just now. The workout carries on as planned.';

/**
 * The one sentence for a waiting move that a pause or a lost trainer
 * discarded (ADR 0048 D-8). The rider may have read or heard the move's own
 * sentence, and the graph and the lookahead go back to the plan as it was at
 * the same moment, so they are told once. It names both causes because the
 * player drops a waiting move for either and does not say which.
 *
 * ⚠️ DRAFT wording, awaiting the owner's approval with the rest.
 */
export const REPLAN_DISCARDED =
  'That change was dropped because the ride paused or lost the trainer, so the plan stays as it was.';

/**
 * The control that switches re-plans off while a workout runs (ADR 0048 D-7:
 * *"A per-ride switch turns re-plans off"*). A button named for what it does,
 * and not the chooser's switch drawn again: once pressed it cannot be undone
 * for that workout, and a switch that cannot be switched back is not one.
 *
 * Approved as final by the owner on 2026-10-20 (#1483), with {@link REPLANS_OFF}.
 */
export const REPLAN_OFF_BUTTON = 'Switch re-plans off';

/**
 * What the panel says once re-plans are switched off for a workout, in place
 * of {@link REPLAN_OFF_BUTTON}. Nothing more is sent for that workout, and a
 * change that was waiting is dropped with it.
 */
export const REPLANS_OFF =
  'Re-plans are off for the rest of this workout. Nothing more is sent, and the plan stays as it is.';

/**
 * Said beside the chooser's heading while the per-ride switch is on, so the
 * choice is in sight where *Ride* is pressed however long the list is: the
 * switch itself is under the list, with what it sends. Two words, because it
 * shares the heading's line and must not move anything under it.
 */
export const REPLANS_ON_BADGE = 'Re-plans on';

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
 *
 * ⚠️ **`reason` is `undefined` when this device cannot see for itself that
 * the reason is so** (`replan-reason.ts`), and then the move is said alone:
 * *"Next block shortened by 2 minutes."* The reason is the model's choice
 * from a list; a clause about the rider's heart rate is said in this
 * device's voice only when this device holds what it says.
 */
export function replanSentence(
  move: PlanMove,
  reason: ReasonCode | undefined,
  next: number,
): string {
  return reason === undefined
    ? `${moveText(move, next)}.`
    : `${moveText(move, next)}, ${REASONS[reason]}.`;
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

/**
 * Whether a discarded move's one sentence ({@link REPLAN_DISCARDED}) should
 * be offered to an announcer now, and what to remember: the revision last
 * said to have been discarded. Once for each discarded move.
 *
 * Said only of a move whose own sentence was offered (`offered`).
 *
 * ⚠️ No silence rule, unlike {@link planChangeAnnouncement}: a move is
 * discarded by a pause or a lost trainer, which is not a moment a rider is
 * being asked to hold a hard effort, and a sentence held until a stretch ends
 * would arrive after the ride resumed with nothing to tie it to.
 */
export function planDiscardedAnnouncement(
  said: number | undefined,
  discarded: number | undefined,
  /**
   * The revision whose own sentence this announcer last offered. A discard
   * is said only of THAT move: one accepted in a hard stretch and never
   * said, or already waiting when the screen appeared, is taken away in
   * silence, because a voice saying a change was dropped when no change was
   * announced tells a rider nothing they can place.
   */
  offered: number | undefined,
): { readonly event: PlanChangedEvent | undefined; readonly said: number | undefined } {
  if (discarded === undefined || discarded === said) {
    return { event: undefined, said };
  }
  if (discarded !== offered) {
    // Remembered as dealt with, so it is not said late if the numbers meet.
    return { event: undefined, said: discarded };
  }
  return {
    event: { kind: 'plan-changed', text: `${REPLAN_LABEL}: ${REPLAN_DISCARDED}` },
    said: discarded,
  };
}

/** Every reason clause, for the word scan. */
export const REPLAN_REASON_TEXTS: readonly string[] = Object.values(REASONS);

/** Every fixed sentence and label of this module, for the word scan. */
export const REPLAN_FIXED_TEXTS: readonly string[] = [
  REPLAN_LABEL,
  REPLAN_STARTS_AT_NEXT_BLOCK,
  PLAN_KEPT,
  REPLAN_UNAVAILABLE,
  REPLAN_DISCARDED,
  REPLAN_OFF_BUTTON,
  REPLANS_OFF,
  REPLANS_ON_BADGE,
];
