// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The conditions the **rider** rides under.
 *
 * ⚠️ **This file used to export a hard-coded `RIDER_MASS_KILOGRAMS = 80` and a
 * ready-made `RIDE_CONDITIONS`, and a reviewer who remembers that is reading
 * the old file.** [#325](https://github.com/openzigs/onyourleft/issues/325)
 * replaced both: the mass is the athlete's own now, so there is a *function*
 * here and no constant to import. `AthleteRecord.mass` had been on the row
 * since schema 6, read by the segment matcher and by the account export, and
 * the game rode everybody at 80 kg regardless — which is not cosmetic, because
 * mass enters `packages/physics` twice, through `gravityForceNewtons` and
 * through `effectiveMassKilograms`, and on a climb it is very nearly the whole
 * of the resistance.
 *
 * ⚠️ **Where the default lives, and why it is not here.**
 * `athlete/mass.ts` §`DEFAULT_RIDER_MASS_KILOGRAMS` is the one place a missing
 * mass is substituted, and this module does not substitute one: it takes a
 * {@link Kilograms} and uses it. The settings screen names the same constant to
 * tell a rider what they are being ridden at, and if both did their own `??`
 * the two would agree until somebody changed one.
 *
 * ⚠️ **What is still a placeholder**: air density. Altitude has no home in the
 * store at all, so a rider in Denver rides through sea-level air. That is its
 * own change and is deliberately not this one.
 *
 * ⚠️ **The bot's mass is a different constant and stays fixed.**
 * `packages/domain`'s `BOT_MASS_KILOGRAMS` is 75 and nothing here may reach it
 * or be reached by it. Making the rider's mass dynamic makes that separation
 * *more* important rather than less: `pacer-choice.test.ts` used to assert the
 * bot's plan did not carry the rider's 80, which a single hard-coded number
 * made easy to state and easy to satisfy by accident. It now asserts the bot is
 * unmoved across two different rider masses, which is the same claim without
 * the coincidence — see `simulation.test.ts` §"regardless of the rider's mass".
 */

import { altitudeMetres, degreesCelsius, kilograms, type Kilograms } from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre, type RideConditions } from '@onyourleft/physics';

/**
 * What the bicycle under the rider weighs, in kilograms.
 *
 * ⚠️ **Not exported, deliberately.** A test that imported it could only assert
 * this number equals this number; what is worth pinning is the *sum*, and
 * `rider.test.ts` pins that through {@link rideConditionsFor} instead. It is
 * also the shape `check:wiring` asks for — an export in `game/` with no
 * production caller is a `WIRE002`.
 *
 * ⚠️ **It exists because `AthleteRecord.mass` is the athlete and
 * `RideConditions.totalMass` is `m_T`** — *"rider plus bicycle plus anything
 * either is carrying"*, per `packages/physics/src/power.ts`. Handing an
 * athlete's mass straight through would ride them on no bicycle, which is a
 * 13 % error in the *opposite* direction to the one #325 is about and would
 * look like a fix.
 *
 * **Provenance**: 9 kg is a road bike a rider owns, with pedals. The UCI
 * minimum is 6.8 kg and applies to a race machine nobody puts on a turbo; a
 * mid-range aluminium or carbon road bike with clinchers is 8–10 kg. It is a
 * **default and not a measurement**, and a rider cannot yet tell us what their
 * bicycle weighs — that is the same gap this issue closed for the rider
 * themselves, one object along, and it is deliberately left open rather than
 * guessed at with a second settings field nobody asked for.
 *
 * ⚠️ 71 + 9 = 80, which is exactly the constant this file used to carry. So a
 * rider who has entered nothing rides precisely as they did before #325, and
 * that is asserted rather than described — `rider.test.ts` §"leaves a rider who
 * has said nothing exactly where they were".
 */
const BICYCLE_MASS_KILOGRAMS = 9;

/**
 * Sea level, 15 °C: the ISO 2533 reference, from `packages/physics`'s model.
 *
 * Computed once at module scope rather than per call, because it does not
 * depend on the rider and `airDensityKilogramsPerCubicMetre` is a handful of
 * exponentials.
 */
const SEA_LEVEL_AIR_DENSITY = airDensityKilogramsPerCubicMetre(
  altitudeMetres(0),
  degreesCelsius(15),
);

/**
 * What to ride an athlete of this mass under.
 *
 * @param riderMass the **athlete's** mass, defaulted where they have not said
 * — `athlete/mass.ts` §`riderMassFor` is the one place that defaulting happens.
 * The bicycle is added here and only here.
 */
export function rideConditionsFor(riderMass: Kilograms): RideConditions {
  return {
    totalMass: kilograms(riderMass + BICYCLE_MASS_KILOGRAMS),
    airDensityKilogramsPerCubicMetre: SEA_LEVEL_AIR_DENSITY,
  };
}
