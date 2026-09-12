// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The conditions the **rider** rides under.
 *
 * ⚠️ A placeholder, and it is one on purpose rather than by omission: mass and
 * air density belong to the athlete and to where they are, and neither has a
 * home in the store yet — `AthleteRecord.mass` exists (schema 6) but nothing
 * writes it, and there is no altitude at all. Wiring those is its own change.
 * Until then an 80 kg rider at sea level is stated here where it can be found,
 * rather than buried at a call site.
 *
 * ⚠️ **It moved out of `GameView.tsx` in #237 so that a test could name the
 * number without mounting a React tree**, and the number it names is the one
 * that matters: the bot pacer rides at {@link BOT_MASS_KILOGRAMS} and never at
 * this. `pacer-choice.test.ts` asserts the two are different, which is a
 * stronger statement than asserting the bot's is 75 — a plan quietly built from
 * the rider's conditions would satisfy the second and fail the first.
 */

import { altitudeMetres, degreesCelsius, kilograms } from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre, type RideConditions } from '@onyourleft/physics';

/**
 * What the rider and their bicycle weigh together, until the store carries it.
 *
 * Exported separately from {@link RIDE_CONDITIONS} so that the one assertion
 * that needs it — "the bot is not ridden at the rider's mass" — can be written
 * against a name rather than against a literal 80 that would silently stop
 * meaning anything the day this becomes the athlete's own.
 */
export const RIDER_MASS_KILOGRAMS = 80;

/** Sea level, 15 °C: the ISO 2533 reference, from `packages/physics`'s model. */
export const RIDE_CONDITIONS: RideConditions = {
  totalMass: kilograms(RIDER_MASS_KILOGRAMS),
  airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
    altitudeMetres(0),
    degreesCelsius(15),
  ),
};
