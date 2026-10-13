// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether this device can see, for itself, that a re-plan's reason is so**
 * — #1244's review, ADR 0048 D-4 and D-12.
 *
 * A proposal carries a reason from a closed list, and the validator checks
 * only that it is on the list (D-4's P1: *"A reason is one of a fixed
 * list"*). The reason is the MODEL's choice. `replan-text.ts` would say it in
 * the device's own voice — *"because your heart rate stayed above the range
 * you chose"* — and that is a statement about the rider that nothing here
 * had checked: measured, it was said to a rider who had chosen no range.
 *
 * So a reason is said only when its premise holds in **what this device
 * itself sent** with the request the proposal answers: the summaries, the
 * plan's blocks and the goals. Where it does not, the move is said alone
 * (*"Next block shortened by 2 minutes."*), and the ride's record says the
 * reason was not shown (`ReplanRecord.reasonNotShown`).
 *
 * ⚠️ **Never a refusal.** ADR 0048 does not say a reason must be true, only
 * that it is one of the list; the move was checked by the validator against
 * the plan, the goals and the trainer, and stands or falls on that. This
 * decides a clause of a sentence and nothing a trainer is sent.
 *
 * ⚠️ **No figure of how well the plan is being followed is computed here**
 * (spike 0022's rule R1). Each check reads ONE block's summary, or compares
 * two blocks' mean cadence. Nothing is summed across blocks or set against a
 * goal's time.
 *
 * | Reason | Said only when |
 * |---|---|
 * | `heart-rate-high` | the latest summary sent has a mean heart rate above the top of the range the rider chose for it |
 * | `heart-rate-low` | … below the bottom of that range |
 * | `cadence-falling` | the latest two summaries with a cadence differ by {@link CADENCE_FALL_RPM} or more, the later the lower |
 * | `goal-duration` | the goals sent hold a duration |
 * | `on-plan` | never: see below |
 * | `goal-time-in-range` | never: the device withholds that goal, so no model was given it |
 * | `effort-check-in` | never: the device sends no effort check-in |
 *
 * ⚠️ **`on-plan` — *"because the workout is going to plan"* — is never said**
 * (#1244's fourth review). To see that a workout is going to plan a device
 * has to set the rider's power against the target, and that is the figure
 * of how well the plan is being followed which spike 0022's rule R1 keeps
 * off the ride path. This module first said it when the block just ridden
 * had no eased target and a heart rate inside any chosen range, which held
 * for a block ridden at a third of its target and for a summary with no
 * reading in it at all. A premise the device may not compute is one it
 * cannot see, and this module's rule is that such a reason is not said.
 *
 * *"The range the rider chose"* for a block is the block's own range when it
 * is a heart-rate hold, and otherwise the goals' range, when they hold one.
 */

import type { ReasonCode } from '@onyourleft/domain';

import type { ReplanInput } from './replan-job';

/** How far mean cadence must fall between two blocks to be called falling, in rpm. */
export const CADENCE_FALL_RPM = 5;

/**
 * The reasons this device can never see the premise of: two it sends nothing
 * for, and `on-plan`, whose premise it may not compute (rule R1, above).
 */
export const REASONS_NEVER_SHOWN: readonly ReasonCode[] = [
  'goal-time-in-range',
  'effort-check-in',
  'on-plan',
];

interface Range {
  readonly low: number;
  readonly high: number;
}

const isRange = (value: unknown): value is Range =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Range).low === 'number' &&
  typeof (value as Range).high === 'number';

/** The range the rider chose for a block of what was sent, if they chose one. */
function chosenRange(sent: ReplanInput, block: number): Range | undefined {
  const planned = sent.blocks[block];
  if (planned?.['kind'] === 'heart-rate-hold' && isRange(planned['range'])) {
    return planned['range'];
  }
  return isRange(sent.goals.holdRange) ? sent.goals.holdRange : undefined;
}

/**
 * Whether `reason`'s premise holds in `sent`: the input of the request the
 * proposal answers, exactly as it left this device.
 */
export function reasonPremiseHolds(reason: ReasonCode, sent: ReplanInput): boolean {
  const latest = sent.summaries.at(-1);
  if (latest === undefined) {
    return false;
  }
  const range = chosenRange(sent, latest.block);
  const mean = latest.meanHeartRate;
  switch (reason) {
    case 'heart-rate-high':
      return range !== undefined && mean !== undefined && mean > range.high;
    case 'heart-rate-low':
      return range !== undefined && mean !== undefined && mean < range.low;
    case 'cadence-falling': {
      const cadences = sent.summaries.flatMap((each) =>
        each.meanCadence === undefined ? [] : [each.meanCadence],
      );
      const last = cadences.at(-1);
      const before = cadences.at(-2);
      return last !== undefined && before !== undefined && before - last >= CADENCE_FALL_RPM;
    }
    case 'goal-duration':
      return sent.goals.durationMinutes !== undefined;
    case 'on-plan':
    case 'goal-time-in-range':
    case 'effort-check-in':
      return false;
  }
}
