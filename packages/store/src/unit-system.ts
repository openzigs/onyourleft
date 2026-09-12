// SPDX-License-Identifier: Apache-2.0

/**
 * Which units an athlete reads their numbers in — #238, and ADR 0020.
 *
 * ## This is stored here and read nowhere in `packages/`
 *
 * It is a **presentation** preference: nothing stored, computed, signed or
 * exported changes when it changes, and the conversion happens at the last
 * moment before a string, in `apps/web/src/units/`. This package holds the
 * *value* because the value has to survive a reload and because ADR 0020 D-2
 * put it on the athlete rather than on the device — so it travels with the
 * account export (#35) and survives an erase-and-reimport.
 *
 * ⚠️ **Nothing in `packages/` may branch on it.** `packages/domain` cannot
 * reach a store or a DOM and must not start; a conversion there converts and
 * does not decide (`speed.ts` §`metresPerSecondToMilesPerHour`). A reader of
 * this file looking for the place that picks a unit will not find one here,
 * and that is the design rather than an omission.
 *
 * ## One switch, not four
 *
 * ADR 0020 D-1: distance, speed, elevation and weight all follow this single
 * choice. The cost is recorded there and is accepted rather than overlooked —
 * a rider who wants miles for distance and metres for climbing, a genuinely
 * common combination in the UK, cannot have it. Splitting it later is
 * additive; collapsing four settings into one later is not.
 *
 * ## Why an unrecognised value falls back rather than throwing
 *
 * Unlike {@link Visibility}, which `parseVisibility` refuses to coerce. The
 * difference is what the field decides. A visibility outside its three values
 * could publish a private ride, so the safe answer is to stop; a unit
 * preference outside its two decides only whether a number reads `km` or `mi`,
 * and refusing the whole athlete row over it would take a rider's library away
 * because a hand-edited setting says `metrick`. So {@link parseUnitSystem}
 * answers with the default and the row decodes.
 */

/**
 * | Value | What a rider reads |
 * |---|---|
 * | `metric` | kilometres, km/h, metres, kilograms. **The default.** |
 * | `imperial` | miles, mph, feet, pounds. |
 */
export type UnitSystem = 'metric' | 'imperial';

/** Every permitted value. */
export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

/**
 * What an athlete who has not chosen reads.
 *
 * Metric, and **not guessed from the locale**. #238 is explicit that a guess is
 * the wrong answer here: a locale is a language and a region, not a statement
 * about how somebody measures a bike ride, and a wrong guess silently
 * misreports every number on every screen with nothing to tell the rider that a
 * choice was made on their behalf. The canonical unit of this program is metric
 * (`packages/domain`'s README), so metric is also the reading that involves the
 * fewest conversions — but the reason it is the default is that it is the one
 * an athlete can *see* is a default, because the settings screen shows the
 * current choice rather than implying it.
 */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

/** Whether `value` is one of the two. */
export function isUnitSystem(value: unknown): value is UnitSystem {
  return typeof value === 'string' && (UNIT_SYSTEMS as readonly string[]).includes(value);
}

/**
 * The unit system a stored value names, or {@link DEFAULT_UNIT_SYSTEM}.
 *
 * Total, deliberately — see the note at the top of this file about why this is
 * not {@link parseVisibility}.
 */
export function parseUnitSystem(value: unknown): UnitSystem {
  return isUnitSystem(value) ? value : DEFAULT_UNIT_SYSTEM;
}
