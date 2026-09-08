// SPDX-License-Identifier: Apache-2.0

/**
 * The ERG spiral of death, and how a player gets out of it — #14.
 *
 * > *"cadence drops, the trainer raises resistance to hold target power, which
 * > drops cadence further, until the rider stalls. A workout player that does
 * > not detect and break this loop is actively unpleasant to use. This is a
 * > functional requirement, not a polish item."*
 *
 * ## Why it happens, which is what makes it detectable
 *
 * In ERG the trainer holds power, and power is torque times cadence. When
 * cadence falls the trainer must raise torque to keep the product constant — so
 * the pedals get heavier exactly when the rider is already struggling, which
 * drops cadence again. It is positive feedback with a rider inside it, and the
 * rider loses.
 *
 * The signature is therefore **not** "cadence is low". A rider grinding at 60
 * rpm on purpose is fine and must not be interrupted. The signature is
 * **cadence falling, over several seconds, while a target is being held** —
 * a *trend*, which is why {@link assessErgCadence} takes a history rather than
 * a reading.
 *
 * ## What this module is not
 *
 * ⚠️ It writes nothing and knows no GATT. It answers one question — *is this
 * rider losing the fight, and what should the target become?* — and the caller
 * does something about it. That is the `packages/domain` rule (no platform API,
 * and the header of `packages/domain/src/trainer/simulation.ts` makes the same
 * split for gradients) and it is also what makes the spiral testable at all:
 * the #44 simulator can play a collapsing rider into a pure function.
 */

import {
  revolutionsPerMinute,
  seconds,
  type RevolutionsPerMinute,
  type Seconds,
} from '../quantities';

/**
 * Below this, a rider is about to stall whatever the trend says.
 *
 * ⚠️ **A floor, not the detector.** Reaching 50 rpm by choice on a steep
 * simulated climb is ordinary; reaching it in ERG means the trainer has already
 * won. The trend rule below is what catches the spiral early — this is the
 * backstop for the case where it started before the player was looking, which
 * is what a mid-workout reconnection looks like.
 */
export const STALLING_CADENCE = revolutionsPerMinute(50);

/**
 * The cadence loss, in rpm, that counts as a collapse over {@link TREND_WINDOW}.
 *
 * ⚠️ **This number is a judgement and has NOT been calibrated against a real
 * trainer**, which is #14's own breakdown trigger and is open as #137. It is
 * set where it is because a rider settling into an interval routinely loses ten
 * rpm in the first few seconds and must not trip it, while a spiral loses
 * fifteen and keeps going. Whoever gets a trainer should re-measure it and say
 * so here rather than leaving this paragraph in place.
 */
export const COLLAPSE_RPM = 15;

/** How far back the trend looks. Long enough to be a trend, short enough to act. */
export const TREND_WINDOW = seconds(8);

/**
 * How much of the target to keep when a spiral is detected.
 *
 * ⚠️ **Reduce rather than release**, and the difference matters to a rider
 * mid-interval. Releasing ERG drops all resistance at once, which throws
 * somebody pushing hard forward onto a suddenly weightless pedal; and it ends
 * the interval, which is the workout deciding the rider failed. Two thirds is
 * enough of a drop to let cadence recover and small enough that the interval is
 * still the interval.
 */
export const RELIEF_SHARE = 2 / 3;

/**
 * At or below this, the rider has stopped rather than slowed.
 *
 * Named rather than derived from {@link STALLING_CADENCE} by arithmetic: the
 * two answer different questions — one is "this target is too hard", the other
 * is "there is nobody pedalling" — and tying them together would mean a change
 * to one silently moved the other.
 */
export const STOPPED_CADENCE = revolutionsPerMinute(10);

/** One cadence reading, and when it was taken. */
export interface CadenceReading {
  readonly at: Seconds;
  readonly cadence: RevolutionsPerMinute;
}

export type ErgVerdict =
  /** Nothing wrong. Hold the target. */
  | { readonly kind: 'holding' }
  /**
   * Cadence is collapsing under the target. Reduce it.
   *
   * `relief` is the multiplier to apply to the workout's target — not a new
   * target, because this module does not know what the target is.
   */
  | { readonly kind: 'spiralling'; readonly relief: number; readonly reason: string }
  /**
   * The rider has effectively stopped.
   *
   * Distinct from `spiralling` because the answer is different: there is no
   * target low enough to ride at eight rpm, so the player releases the trainer
   * and waits rather than reducing.
   */
  | { readonly kind: 'stalled'; readonly reason: string };

/**
 * Read a cadence history and say whether ERG is winning.
 *
 * @param history readings in any order; only those within {@link TREND_WINDOW}
 * of `now` are considered. Unordered is accepted because a caller keeping a
 * ring buffer should not have to sort it to ask a question.
 * @param now the instant to judge at. **A parameter, not a clock** — this is
 * `packages/domain`, where the recording engine may not read one either.
 */
export function assessErgCadence(history: readonly CadenceReading[], now: Seconds): ErgVerdict {
  const window = history.filter((reading) => reading.at <= now && now - reading.at <= TREND_WINDOW);
  if (window.length < 2) {
    // One reading is not a trend, and no readings is a sensor that has not
    // spoken yet. Neither is evidence of a spiral, and treating silence as a
    // fault would drop the target every time a cadence sensor dropped out.
    return { kind: 'holding' };
  }

  const ordered = [...window].sort((left, right) => left.at - right.at);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) {
    return { kind: 'holding' };
  }

  if (last.cadence <= STOPPED_CADENCE) {
    // Ten rpm or less: the rider has stopped pedalling, or nearly. No target is
    // rideable here, so reducing one would only make the trainer quieter about
    // the same problem.
    return {
      kind: 'stalled',
      reason: 'Pedalling has stopped, so the trainer has been released.',
    };
  }

  const lost = first.cadence - last.cadence;
  if (lost >= COLLAPSE_RPM && last.cadence < STALLING_CADENCE + COLLAPSE_RPM) {
    // Both halves, and the second is what stops a false positive. A rider
    // coming down from a 120 rpm spin-up loses 15 rpm and is nowhere near
    // trouble; the same 15 rpm ending at 55 is the spiral. Without the second
    // clause every interval that begins with a fast start would trip this.
    return {
      kind: 'spiralling',
      relief: RELIEF_SHARE,
      reason: 'Cadence is falling under the target, so it has been eased to let you spin back up.',
    };
  }

  if (last.cadence < STALLING_CADENCE) {
    // The backstop. No trend needed: already low enough that holding the target
    // will finish the job.
    return {
      kind: 'spiralling',
      relief: RELIEF_SHARE,
      reason: 'Cadence is low for this target, so it has been eased.',
    };
  }

  return { kind: 'holding' };
}
