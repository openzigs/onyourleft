// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's *Calories* fact — #2433 — the one component the ride result card
 * and the ride's page both render, so the two show the same figure in the
 * same words for the same ride.
 *
 * ## An estimate looks like one
 *
 * Epic #2430's invariant, for the reason `athlete/mass.ts` gives about an
 * assumed weight: a guess in the same typeface as a measurement teaches a rider
 * to trust it. So the figure is `≈ 612 kcal` and the line beneath it always
 * says *estimate* and names the basis ({@link CALORIES_BASIS_TEXT}).
 *
 * ## No figure is a dash and a reason, never `0 kcal`
 *
 * A ride that stored no estimate says why ({@link noCaloriesReason}): it had
 * neither power nor heart rate, or it had heart rate and the rider has not set
 * what the heart-rate estimate needs, or it is a ride with power saved before
 * estimates were worked out. A power ride that did no work is a figure — 0 kcal
 * on the power basis (`@onyourleft/domain` §`rideCalories`) — and shows as one.
 */

import type { JSX } from 'react';

import type { ActivityCalories, ActivityCaloriesBasis } from '@onyourleft/store';

import { Reading } from '../design/Reading';

export const CALORIES_LABEL = 'Calories';

export const CALORIES_UNIT = 'kcal';

/** The line beneath a figure: what it is, and what it was worked out from. */
export const CALORIES_BASIS_TEXT: Readonly<Record<ActivityCaloriesBasis, string>> = {
  power: 'estimate from power',
  'heart-rate': 'estimate from heart rate',
  file: 'estimate from the file',
};

/** Said for a ride with neither channel. */
export const NO_CALORIES_NO_READINGS = 'no power or heart rate';

/** Said for a heart-rate ride with no figure: what would give it one. */
export const NO_CALORIES_SET_INPUTS =
  'set sex, year of birth and weight in Settings for a heart-rate estimate';

/**
 * The card's shorter word for {@link NO_CALORIES_SET_INPUTS}: the card's line
 * shares the heading's, and the whole sentence is the ride page's, one tap
 * away (`CaloriesLine`).
 */
export const NO_CALORIES_SET_INPUTS_SHORT = 'set your details in Settings';

/** Said for a ride with power that stored no figure, which only a ride saved before #2433 is. */
export const NO_CALORIES_SAVED_BEFORE = 'saved before calorie estimates';

/** The stored figure as shown: whole kilocalories, approximately. */
export function caloriesValue(calories: ActivityCalories): string {
  return `≈ ${String(Math.round(calories.energy))}`;
}

/** Why a ride shows no figure, from what it recorded. `compact` is the card's wording. */
export function noCaloriesReason(
  recorded: {
    readonly hasPower: boolean;
    readonly hasHeartRate: boolean;
  },
  compact = false,
): string {
  if (recorded.hasPower) {
    return NO_CALORIES_SAVED_BEFORE;
  }
  if (!recorded.hasHeartRate) {
    return NO_CALORIES_NO_READINGS;
  }
  return compact ? NO_CALORIES_SET_INPUTS_SHORT : NO_CALORIES_SET_INPUTS;
}

/**
 * The figure and its basis, or the dash and the reason, as words — what both
 * screens render, so the card and the page cannot word it differently.
 */
function said(
  calories: ActivityCalories | undefined,
  recorded: { readonly hasPower: boolean; readonly hasHeartRate: boolean },
  compact: boolean,
): JSX.Element {
  return calories === undefined ? (
    <>
      <span aria-hidden="true">—</span>
      <span className="oyl-visually-hidden">No figure</span>{' '}
      <span className="oyl-muted">({noCaloriesReason(recorded, compact)})</span>
    </>
  ) : (
    <>
      {/* The card's line is at the small size, so its figure is words rather
        than an `xxl` reading, which the card's grid measures (#1083). */}
      {compact ? (
        <strong>{`${caloriesValue(calories)} ${CALORIES_UNIT}`}</strong>
      ) : (
        <Reading value={caloriesValue(calories)} unit={CALORIES_UNIT} />
      )}{' '}
      <span className="oyl-muted">{CALORIES_BASIS_TEXT[calories.basis]}</span>
    </>
  );
}

/**
 * The ride result card's one line, beside its heading — #2433.
 *
 * ⚠️ **On the heading's line and not a fact in the card's grid, because the
 * grid has no row to spare.** On a 4:3 tablet in the Android shell the card is
 * 432 px wide, its four facts are already two rows of two, and *Start a new
 * ride* clears the fold by under 10 px more than the browser gate's 50
 * (`rideview.browser.spec.ts` §"#1042"). A fifth fact is a third row, about
 * 80 px, which put that button under the fold; the heading's line had the room.
 *
 * ⚠️ **Measured on the CI runner, whose font is wider than a Mac's.** With
 * *Calories* written out, the line wrapped under the heading there and cost
 * 23.9 px (68.2 → 44.3 px clear). So the label is for assistive technology
 * only — `≈ 612 kcal estimate from power` says what it is — the line is set
 * tight, and a line that does wrap costs one small line. Its longest no-figure
 * reason is {@link NO_CALORIES_SET_INPUTS_SHORT}.
 */
export function CaloriesLine({
  calories,
  hasPower,
  hasHeartRate,
}: {
  readonly calories: ActivityCalories | undefined;
  readonly hasPower: boolean;
  readonly hasHeartRate: boolean;
}): JSX.Element {
  return (
    <p className="oyl-result__calories" data-oyl-calories="">
      <span className="oyl-visually-hidden">{CALORIES_LABEL}: </span>
      {said(calories, { hasPower, hasHeartRate }, true)}
    </p>
  );
}

/**
 * The `<dt>`/`<dd>` pair, for a `<dl>` of ride facts — the ride's page.
 *
 * ⚠️ **The whole width of the facts, on one line**, for {@link CaloriesLine}'s
 * reason one screen over: on a phone the facts are two columns of 9rem, and a
 * seventh fact in one of them wrapped its words down four lines, which put the
 * page's first control 72 px under the fold (`controls-first.browser.spec.ts`).
 * Across the row, the figure and its basis, or the dash and its reason, are one
 * line, and the row costs what any other fact's does.
 */
export function CaloriesFact({
  calories,
  hasPower,
  hasHeartRate,
}: {
  readonly calories: ActivityCalories | undefined;
  readonly hasPower: boolean;
  readonly hasHeartRate: boolean;
}): JSX.Element {
  return (
    <div className="oyl-ride-summary__wide" data-oyl-calories="">
      <dt>{CALORIES_LABEL}</dt>
      <dd>{said(calories, { hasPower, hasHeartRate }, false)}</dd>
    </div>
  );
}
