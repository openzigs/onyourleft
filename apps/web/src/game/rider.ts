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
 * the coincidence — see `rider.test.ts` §"#325 criterion 4 — the bot stays at
 * its own mass", which drives `simulation.ts` §`botCourseFor` to get there.
 *
 * ⚠️ **There is no `headwindMetresPerSecond` here either, and adding one would
 * be the wrong repair for #326.** `RideConditions` is *"everything about the
 * ride that does not change from tick to tick"*, and a headwind is not that: it
 * is a wind resolved against the direction the rider is pointing, and the rider
 * turns. A constant here would give a rider a tailwind all the way out and all
 * the way home. The wind is a **vector** on `SimulationSetup.wind`, and
 * `simulation.ts` §`#conditionsAt` resolves it per step against the route's own
 * bearings.
 */

import { altitudeMetres, degreesCelsius, kilograms, type Kilograms } from '@onyourleft/domain';
import {
  airDensityKilogramsPerCubicMetre,
  withDragArea,
  type RideConditions,
} from '@onyourleft/physics';

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
 * How the rider is sitting on the bicycle — #365.
 *
 * ⚠️ **A position and not a number in a box**, which is #365's first criterion.
 * A drag area is a wind-tunnel measurement in square metres and nobody knows
 * their own; where their hands are is something every rider can answer without
 * being taught anything.
 */
export type RidingPosition = 'upright' | 'hoods' | 'drops';

/**
 * What each position is called on the picker, and the drag area it is ridden at.
 *
 * ⚠️ **A `Record` keyed by the union rather than an array**, so the lookup in
 * {@link ridingPositionDragArea} is total: there is no fallback branch, and
 * therefore no branch that could quietly become the answer for one of the
 * three. A fourth position added to {@link RidingPosition} is a compile error
 * here and in {@link RIDING_POSITION_ORDER} both.
 */
export const RIDING_POSITIONS: Readonly<
  Record<
    RidingPosition,
    {
      readonly label: string;
      /** `c_d · A`, in square metres. @see ridingPositionDragArea */
      readonly dragAreaSquareMetres: number;
    }
  >
> = {
  upright: { label: 'Sitting up, hands on the tops', dragAreaSquareMetres: 0.42 },
  hoods: { label: 'On the hoods', dragAreaSquareMetres: 0.36 },
  drops: { label: 'In the drops', dragAreaSquareMetres: 0.31 },
};

/** The order the picker offers them in: most air pushed first. */
export const RIDING_POSITION_ORDER: readonly RidingPosition[] = ['upright', 'hoods', 'drops'];

/**
 * What a rider who has chosen nothing is ridden in: **the hoods**.
 *
 * The position most people spend most of a ride in, and the middle of the three
 * — so a rider who never touches the control is wrong by one step in either
 * direction rather than by two in one.
 */
export const DEFAULT_RIDING_POSITION: RidingPosition = 'hoods';

/**
 * The drag area each position is ridden at, in square metres.
 *
 * ## Why the game has its own and `packages/physics` keeps Martin's
 *
 * `MARTIN_1998_COEFFICIENTS` is **that paper's rider**: *"a hypothetical
 * subject who had the average characteristics of our subjects (drag area =
 * 0.264 m², mass = 71.9 kg)"* — experienced cyclists in a **time-trial
 * position** on a track, on a bicycle with a rear disc, an airfoil-spoked front
 * wheel and 20 mm clinchers at nine atmospheres. Those numbers are correct,
 * faithfully sourced and reproduced by `martin-1998.test.ts` against the
 * paper's own worked example, and #88's whole point is that
 * `packages/physics` reproduces its source. **They are not touched here and
 * must not be** (ADR 0005's tech-stack posture applied to a paper:
 * `packages/physics/README.md` §2 is a provenance table, not a tuning sheet).
 *
 * What #365 is about is that *nobody ever chose the rider*. `rideConditionsFor`
 * set a mass and an air density and left `RideConditions.coefficients`
 * `undefined`, so every ride in the game fell back to `DEFAULT_COEFFICIENTS`
 * and every rider was simulated as a track racer. Measured from the committed
 * constants at 80 kg total: 150 W gave **32.4 km/h (20.1 mph)** on the flat,
 * against about 28.6 km/h (17.8 mph) for a rider on the hoods. A rider reported
 * it from a live session as *"my speed seemed higher than it should have been
 * for my power output and grade"*, and it was, by about 2.3 mph.
 *
 * ## Where the three numbers come from
 *
 * They are **this project's defaults and not measurements**, and the honest
 * description is a ladder anchored on the one figure in the tree that *was*
 * measured. Martin's 0.264 m² is a time-trial position; a road rider in the
 * drops is above it, on the hoods above that, and sitting up above that again.
 * The steps are about 15 % of drag area each, which is the order of magnitude
 * the cycling-aerodynamics literature reports between hand positions, and the
 * middle rung lands on 0.36 m² — the figure #365 quotes for *"a rider on the
 * hoods"*.
 *
 * ⚠️ **A class figure is not a rider.** Frontal area scales with body size, so
 * a 55 kg climber and a 95 kg rider in the same position are not the same drag
 * area, and nothing here knows which they are. The right long-run answer is a
 * measured or regressed `c_d · A` per rider; this is the answer that can be
 * given to somebody who has told us nothing but where their hands are.
 *
 * ⚠️ **Set through `withDragArea`, never by editing one factor.**
 * `packages/physics/README.md` §2 is explicit that Martin measures the
 * *product* and reports only the product, that the 0.88 × 0.30 split is that
 * package's own, and that a single factor is *"meaningless"*.
 */
export function ridingPositionDragArea(position: RidingPosition): number {
  return RIDING_POSITIONS[position].dragAreaSquareMetres;
}

/**
 * The rolling resistance every ride in the game uses — **0.005**.
 *
 * ⚠️ **Chosen once, and deliberately NOT per position**, which is #365's third
 * criterion answered explicitly. `C_RR` is a property of a tyre on a surface;
 * where a rider's hands are does not change it, and a table that moved it with
 * the position would be modelling something that is not there.
 *
 * **Why it is not Martin's 0.0032.** That figure is *"the average of those 10
 * values"* Kyle (1988) measured for *"high-pressure clincher bicycle tires on
 * smooth asphalt"* — the fast end of a narrow range, on a surface chosen to be
 * fast, at nine atmospheres. A road bike on ordinary tarmac on 25–32 mm tyres
 * at the pressures people actually run is around 0.005, which is the figure
 * #365 quotes for a typical rider and the one used here. It is a **default and
 * not a measurement**, exactly like the drag areas above and like
 * {@link BICYCLE_MASS_KILOGRAMS}.
 *
 * ⚠️ It is 56 % higher than Martin's, and on the flat at 150 W that is worth
 * roughly 0.8 km/h on its own — smaller than the drag change and not
 * negligible, which is why it is moved deliberately rather than left because it
 * was harder to defend than the drag area.
 */
export const GAME_ROLLING_RESISTANCE_COEFFICIENT = 0.005;

/**
 * What to ride an athlete of this mass, in this position, under.
 *
 * @param riderMass the **athlete's** mass, defaulted where they have not said
 * — `athlete/mass.ts` §`riderMassFor` is the one place that defaulting happens.
 * The bicycle is added here and only here.
 * @param position where the rider said their hands are. Defaults to
 * {@link DEFAULT_RIDING_POSITION}; the substitution is here for
 * `athlete/mass.ts`'s reason — one place, so two callers cannot disagree.
 */
export function rideConditionsFor(
  riderMass: Kilograms,
  position: RidingPosition = DEFAULT_RIDING_POSITION,
): RideConditions {
  return {
    totalMass: kilograms(riderMass + BICYCLE_MASS_KILOGRAMS),
    airDensityKilogramsPerCubicMetre: SEA_LEVEL_AIR_DENSITY,
    // ⚠️ **The field that was `undefined` on every ride until #365**, which is
    // why every rider was simulated with Martin's track-racer drag area.
    // `simulation.ts` already threaded `conditions.coefficients` through to
    // `advance`; the missing half was here, upstream of it.
    coefficients: {
      ...withDragArea(ridingPositionDragArea(position)),
      rollingResistanceCoefficient: GAME_ROLLING_RESISTANCE_COEFFICIENT,
    },
  };
}
