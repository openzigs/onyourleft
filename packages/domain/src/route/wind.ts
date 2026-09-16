// SPDX-License-Identifier: Apache-2.0

/**
 * The wind, and the one piece of arithmetic that turns it into a headwind — #326.
 *
 * ## Why this file exists
 *
 * `packages/physics` models a headwind completely: `terms.ts`'s
 * `airSpeedMetresPerSecond` is **signed**, and `aerodynamicDragForceNewtons`
 * departs from the published Martin et al. equation on purpose — it uses
 * `V_a·│V_a│` where the paper writes `V_a²`, because every trial in the paper
 * had air moving towards the rider and squaring an air velocity that has gone
 * negative turns a strong tailwind into a strong headwind. All of that was
 * built, justified and tested, and **nothing ever supplied a value**, so the
 * parameter defaulted to zero on every tick of every ride.
 *
 * `terms.ts` also says exactly why it could not supply one itself:
 *
 * > *"`headwind` is the **tangential** component of the wind: the part along
 * > the direction of travel… Resolving a wind direction and a heading into that
 * > component is the caller's job, because it needs a course and a compass and
 * > this package has neither."*
 *
 * A course and a compass are precisely what this package does have —
 * `route/profile.ts` gives a heading at every distance and `geodesy.ts` gives
 * the bearings it is built from. So the resolution lives here, one directory
 * away from the route it reads, as a pure function of two angles and a speed.
 *
 * ## Here rather than in the client, for the reason every conversion is
 *
 * The same rule `README.md` states for units and ADR 0004 decision C states for
 * distance: a number two layers could compute separately is a number two layers
 * can disagree about. The rider's tick and the bot pacer's tick both need this,
 * `packages/physics` composes them through one `advance`, and a second copy of
 * the cosine in `apps/web` would be the first crack in "the bot and the rider
 * ride the same air".
 *
 * ## The convention, stated once
 *
 * {@link Wind.fromBearing} is the direction the wind blows **from**, which is
 * the meteorological convention and the one a rider reads off a forecast: "a
 * northerly" comes *from* the north. A heading is the direction of travel. So a
 * rider heading due north into a northerly has `fromBearing === heading` and
 * the whole of the wind's speed as a headwind, and the cosine below carries
 * that through to a tailwind at 180° with no special cases.
 *
 * ⚠️ **Nothing here knows where a wind vector came from.** Today it is
 * rider-entered (`apps/web/src/game/wind-choice.ts`); a seeded breeze or a
 * weather service would produce the same two numbers. The second of those
 * crosses ADR 0002 decision A and is #248's subject, not this file's.
 */

import {
  degreesBearing,
  metresPerSecond,
  type DegreesBearing,
  type MetresPerSecond,
} from '../quantities';
import { UnitError } from '../unit-error';
import { headingOnRoute, type RouteProfile } from './profile';

/**
 * Degrees to radians. Named so the multiplication below is not a bare literal,
 * exactly as in `geodesy.ts`.
 */
const RADIANS_PER_DEGREE = Math.PI / 180;

/**
 * The fastest wind this package will accept: **40 m/s**.
 *
 * A typo guard rather than a meteorological limit, and it is stated as one. The
 * Beaufort scale puts hurricane force — force 12 — at 32.7 m/s and upwards, so
 * 40 m/s (144 km/h) is already past anything anyone rides in; what the bound is
 * actually for is the slipped decimal point that turns 5 into 50, and the
 * hand-edited row that a form's own `max` attribute never sees.
 *
 * ⚠️ Checked in {@link wind} rather than only at the control that collects it,
 * for the reason ADR 0017 D-6 gives about `validateWorkout`'s expansion bound:
 * one rule that covers every way a value arrives, instead of two that can
 * drift.
 */
export const MAXIMUM_WIND_SPEED_METRES_PER_SECOND = 40;

/**
 * A wind: how fast, and where from.
 *
 * Uniform over the route and constant for the ride. That is a simplification
 * and it is the honest one for a value a rider types in before setting off —
 * a gust model would be inventing detail nobody supplied.
 */
export interface Wind {
  /** How fast the air is moving, as a magnitude. */
  readonly speedMetresPerSecond: MetresPerSecond;
  /**
   * The compass bearing the wind blows **from** — meteorological convention.
   *
   * ⚠️ **Meaningless when the speed is zero**, and deliberately not given a
   * name of its own. A `STILL_AIR` constant was written here and removed
   * before it shipped: nothing in production would have read it — still air is
   * spelled as an **absent** `SimulationSetup.wind`, so that a windless ride
   * is bit-for-bit the ride it was before #326 — and an exported, tested
   * constant no production declaration names is the #237 / #259 shape this
   * repository keeps finding, which `check:wiring` cannot see here because
   * `packages/domain` is outside its watched set (CLAUDE.md §4j).
   * `wind(0, …)` is the same value for a caller that wants one.
   */
  readonly fromBearing: DegreesBearing;
}

/**
 * A wind, validated.
 *
 * @param speedMetresPerSecond - a magnitude. A negative "wind" is a direction
 * expressed as a sign, and this package has a field for the direction.
 * @param fromBearingDegrees - normalised into `[0, 360)` by
 * {@link degreesBearing}, so a caller may pass −90 or 450.
 * @throws {UnitError} if the speed is not a finite, non-negative number, if it
 * exceeds {@link MAXIMUM_WIND_SPEED_METRES_PER_SECOND}, or if the bearing is
 * not finite.
 */
export function wind(speedMetresPerSecond: number, fromBearingDegrees: number): Wind {
  const speed = metresPerSecond(speedMetresPerSecond);
  if (speed > MAXIMUM_WIND_SPEED_METRES_PER_SECOND) {
    throw new UnitError(
      `a wind speed in metres per second must be at most ` +
        `${String(MAXIMUM_WIND_SPEED_METRES_PER_SECOND)}, received ${String(speedMetresPerSecond)}`,
    );
  }
  return { speedMetresPerSecond: speed, fromBearing: degreesBearing(fromBearingDegrees) };
}

/**
 * The part of the wind that is along the direction of travel — `V_WTAN`.
 *
 * **Positive is a headwind**, which is the sign convention
 * `packages/physics`'s `airSpeedMetresPerSecond` adds to the ground speed. A
 * tailwind is therefore negative, and it is allowed to be larger in magnitude
 * than the rider's ground speed: that is the case the `V_a·│V_a│` form in
 * `terms.ts` exists for, and until this function had a caller it was
 * unreachable from a ride.
 *
 * The crosswind component is deliberately not returned. Martin et al.'s model
 * takes only the tangential part, and a yaw-dependent drag area is a different
 * model with coefficients this project has no provenance for.
 */
export function tangentialWindMetresPerSecond(source: Wind, heading: DegreesBearing): number {
  return (
    source.speedMetresPerSecond * Math.cos((source.fromBearing - heading) * RADIANS_PER_DEGREE)
  );
}

/**
 * The headwind a rider at `distance` along `profile` is riding into.
 *
 * The composition the physics package asked for: the route supplies the
 * compass, {@link tangentialWindMetresPerSecond} supplies the trigonometry.
 *
 * ⚠️ **A route that gives no heading gives no headwind, and zero is the
 * honest answer rather than a fallback.** `headingOnRoute` returns `undefined`
 * only where the route itself does not say which way the road goes — two
 * coincident grid positions, or a profile with a single point. Substituting
 * the last known heading would be inventing a direction, and substituting a
 * default bearing would silently turn a crosswind into a headwind on exactly
 * the segments nobody can check. Still air is what every ride had before #326
 * and it is what these points get.
 */
export function headwindOnRoute(profile: RouteProfile, distance: number, source: Wind): number {
  const heading = headingOnRoute(profile, distance);
  if (heading === undefined) {
    return 0;
  }
  return tangentialWindMetresPerSecond(source, heading);
}
