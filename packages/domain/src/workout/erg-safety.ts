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
   * target that is a fraction of the interval low enough to ride at eight rpm,
   * so the player asks its caller to ease the trainer right off and waits.
   *
   * ⚠️ **"Ease right off" is the machine's LOWEST TARGET, not an FTMS Stop**
   * (#441), and this comment used to say "releases the trainer" — a reviewer
   * who remembers that is reading the old file. On the trainer #372 was
   * measured on, an acknowledged Stop left the ERG target applied, so a rescue
   * that stopped rescued nobody; the same trainer honoured a new `0x05` target
   * to within ±2 W. `apps/web/src/workout/session.ts` §`ease` writes it.
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
      reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
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

/**
 * What a rescue asks the caller to hold now — the verdict with the latch
 * applied. @see createErgRescue
 */
export type ErgRescueStep =
  /** No rescue. Hold the target the rider (or the workout) asked for. */
  | { readonly kind: 'full' }
  /** Hold `share` of that target — raised to the machine's floor by the caller. */
  | { readonly kind: 'relief'; readonly share: number; readonly reason: string }
  /** The rider has stopped. Hold the machine's lowest target. */
  | { readonly kind: 'floor'; readonly reason: string };

/**
 * Why the relief is still on after cadence has come back — the latch's own
 * sentence, because {@link assessErgCadence} has nothing to say about a rider
 * who is no longer in trouble.
 */
export const RECOVERING_REASON =
  'Cadence is recovering, so the target stays eased until it has held steady.';

/**
 * The rescue latch — how a rescue STARTS and how it ENDS, for every ERG writer
 * in the program (#441, #567).
 *
 * ⚠️ **One rule for two writers.** It used to be two variables inside
 * `player.ts`, which is why a manual ERG target set on the Ride screen had no
 * stall rescue at all (#567): the rule belonged to the workout. Now the
 * workout player and `apps/web/src/ride/manual-erg.ts` both hold one of these,
 * so "the same stall detection as a workout" is a fact about the call graph.
 *
 * A rescue starts on any `spiralling` or `stalled` verdict and ends only once
 * the verdict has been `holding` for a whole {@link TREND_WINDOW} — see
 * `player.ts` §"A rescue ends on a whole trend window of recovery" for why one
 * good reading is not enough.
 *
 * ⚠️ **Silence is not recovery (#567).** {@link assessErgCadence} answers
 * `holding` for a window with fewer than two readings, which is right for a
 * rider who was never rescued — a sensor that has not spoken is not a spiral.
 * It is wrong for one who was: a rider who stalled and whose cadence sensor
 * then went quiet had their full target put back after eight seconds of
 * nothing, on the strength of no evidence at all. While rescuing, a silent
 * window restarts the steady clock rather than advancing it.
 */
export interface ErgRescue {
  /**
   * Judge the history at `now`, update the latch, and say what to hold.
   *
   * @param history `undefined` when the trainer reports no cadence — never a
   * rescue, and never a recovery from one.
   */
  judge(history: readonly CadenceReading[] | undefined, now: Seconds): ErgRescueStep;
  /** Forget any rescue — a new workout, or a target the rider set by hand. */
  reset(): void;
}

export function createErgRescue(): ErgRescue {
  let rescuing = false;
  /** When the current unbroken run of heard `holding` verdicts began. */
  let steadySince: number | undefined;

  return {
    judge(history, now): ErgRescueStep {
      const verdict: ErgVerdict =
        history === undefined ? { kind: 'holding' } : assessErgCadence(history, now);

      if (verdict.kind === 'holding') {
        if (rescuing) {
          if (!heard(history, now)) {
            steadySince = undefined;
          } else {
            steadySince ??= now;
            if (now - steadySince >= TREND_WINDOW) {
              rescuing = false;
              steadySince = undefined;
            }
          }
        }
      } else {
        rescuing = true;
        steadySince = undefined;
      }

      if (verdict.kind === 'stalled') {
        return { kind: 'floor', reason: verdict.reason };
      }
      if (!rescuing) {
        return { kind: 'full' };
      }
      return verdict.kind === 'spiralling'
        ? { kind: 'relief', share: verdict.relief, reason: verdict.reason }
        : { kind: 'relief', share: RELIEF_SHARE, reason: RECOVERING_REASON };
    },

    reset(): void {
      rescuing = false;
      steadySince = undefined;
    },
  };
}

/** Whether the window at `now` holds enough readings to be a verdict at all. */
function heard(history: readonly CadenceReading[] | undefined, now: Seconds): boolean {
  if (history === undefined) {
    return false;
  }
  const inWindow = history.filter(
    (reading) => reading.at <= now && now - reading.at <= TREND_WINDOW,
  );
  return inWindow.length >= 2;
}
