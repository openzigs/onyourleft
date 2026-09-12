// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning "ride against a pacer at 2.5 w/kg" into a plan, or into a refusal.
 *
 * ## Why this is a module and not four lines in the picker
 *
 * `botPacerPlan` **throws**, and it says why where it does: *"the intensity
 * arrives from a control on a screen, and a slipped decimal point should be
 * refused with a message rather than ridden away from."* A `try`/`catch` inside
 * a React event handler is where that refusal would go if it went nowhere — and
 * the branch a rider actually hits is then the one nothing can test without a
 * DOM. This is the pure core; `GameView.tsx` renders its answer.
 *
 * ## The one thing it must never do
 *
 * ⚠️ **It must never build a plan at the rider's own mass.** #237's third
 * criterion, and ADR 0007 D4 underneath it: the bot's power is a fraction of a
 * flat {@link BOT_MASS_KILOGRAMS} figure, and a pacer weighing what *you* weigh
 * would ride at a different speed for every rider, which is a different product
 * and a different patent question. {@link botPacerPlan} defaults to the right
 * mass and this file passes no second argument — deliberately, and asserted in
 * `pacer-choice.test.ts` against `rider.ts`'s own number rather than only
 * against the constant.
 */

import {
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  PacerError,
  botPacerPlan,
  type BotPacerPlan,
} from '@onyourleft/domain';

/**
 * The pace the intensity box starts on: **2.5 w/kg**, about 188 W at the bot's
 * mass.
 *
 * Chosen to be a pace a rider can sit behind rather than one they are dropped
 * by on the first rise — the point of a pacer is that it will not wait for you,
 * not that you never see it again. Well inside the bounds either side, which
 * `pacer-choice.test.ts` asserts so that moving one bound cannot leave the
 * default outside the range it is the default for.
 */
export const DEFAULT_PACER_INTENSITY = 2.5;

/** What the rider asked for, or what is wrong with it. Exactly one is defined. */
export interface PacerChoice {
  /** The plan to ride against, or `undefined` when there is to be no pacer. */
  readonly plan: BotPacerPlan | undefined;
  /**
   * What to tell the rider, when they asked for a pacer and the number cannot
   * make one.
   *
   * ⚠️ Present **only** when {@link plan} is absent *and* a pacer was asked
   * for. A rider who left the box clear is not shown a complaint about a
   * control they are not using — a refusal a rider cannot act on trains them to
   * ignore refusals.
   */
  readonly problem: string | undefined;
}

/** The bounds, as a sentence, built from the constants rather than typed out. */
function rangeSentence(): string {
  return (
    `a pacer's target intensity must be between ` +
    `${String(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM)} and ` +
    `${String(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM)} watts per kilogram`
  );
}

/**
 * The rider's choice, as the ride screen needs it.
 *
 * @param wanted - whether the "ride against a pacer" control is set.
 * @param intensity - whatever is in the intensity box, as typed. A string
 * rather than a number because that is what a control on a screen produces, and
 * because the two cases a `number` cannot tell apart — an empty box and a zero
 * — are a refusal and a refusal for different reasons.
 */
export function pacerChoice(wanted: boolean, intensity: string): PacerChoice {
  if (!wanted) {
    return { plan: undefined, problem: undefined };
  }
  const trimmed = intensity.trim();
  const value = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(value)) {
    // Built here rather than by handing `NaN` to `botPacerPlan`, whose message
    // would end "received NaN" — true, and no use to somebody who left the box
    // empty.
    return { plan: undefined, problem: `Choose a pace: ${rangeSentence()}.` };
  }
  try {
    return { plan: botPacerPlan(value), problem: undefined };
  } catch (error) {
    if (error instanceof PacerError) {
      // The rule's own message, which names the constraint **and** the value.
      // ADR 0004 decision D withholds a value only where it is a coordinate;
      // here the number read back is exactly what shows a rider the decimal
      // point they slipped.
      return { plan: undefined, problem: error.message };
    }
    throw error;
  }
}
