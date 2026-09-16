// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one place a number becomes a unit** — #238, and ADR 0020.
 *
 * ## What this module is for, stated as the defect it prevents
 *
 * Before #238 the client was metric in two different ways. `format.ts` held
 * `SPEED_UNIT = 'km/h'` and `DISTANCE_UNIT = 'km'` as constants, so every
 * caller inherited the choice; and `game/hud/fields.ts` did its own
 * arithmetic and carried its own literal — `(state.ride.speed as number) * 3.6,
 * 'km/h'` — so a preference wired only into the constants would have changed
 * most of the product and left the one screen a rider stares at for an hour
 * unchanged. A half-converted app is worse than a consistently metric one.
 *
 * So the unit is not a constant any more, and **a value and its label are
 * produced together**. Every function here returns a {@link Measurement}: a
 * caller cannot obtain the string `mi` without also obtaining the number of
 * miles, and cannot obtain a converted number without the label that says what
 * it is. That is the structural half of #238's fifth criterion; the
 * enforcement half — that nothing outside this directory writes a unit literal
 * at all — is `no-inline-units.test.ts`, which reads the source of every other
 * file in this client and fails on one.
 *
 * ## The canonical unit does not change, and nothing upstream learns about this
 *
 * The conversion happens at the last moment before a string. Everything
 * stored, computed, signed and exported stays in the canonical unit
 * `packages/domain`'s README tabulates — metres, metres per second, kilograms
 * — and `packages/store/src/activity-store.units.test.ts` reads a ride back
 * either side of a preference change to prove the store never moves. An
 * exported FIT, GPX or TCX file is likewise untouched: those formats have
 * their own unit rules and a rider's display preference has no business
 * reaching a file another program will read.
 *
 * ## Three tiers, because 0.4 km and 0.25 mi are both unreadable
 *
 * | Function | Metric | Imperial | Used for |
 * |---|---|---|---|
 * | {@link formatSpeed} | km/h | mph | a live or recorded speed |
 * | {@link formatDistance} | km | mi | a ride, a route, a leg |
 * | {@link formatSmallDistance} | m | ft | a segment, a climb, an altitude, a nudge |
 * | {@link formatMass} | kg | lb | what the rider weighs |
 *
 * The third tier is not a rounding choice, it is the reason `SegmentsView`
 * never used `formatDistanceValue` in the first place: a segment runs from the
 * 400 m minimum to a few kilometres, and "0.4 km" throws away the digit that
 * distinguishes one climb from another. Its imperial counterpart is feet
 * rather than miles for exactly that reason, and feet are *finer* than metres,
 * so nothing is lost going the other way.
 *
 * ## Rounding
 *
 * #238 asks for this to be decided rather than inherited, so: **the precision
 * is per tier and the same in both systems**, and the reason it can be is that
 * the imperial units happen to bracket the metric ones acceptably.
 *
 * - A speed at one decimal: 0.1 km/h is 0.028 m/s and 0.1 mph is 0.045 m/s, so
 *   the mile reading jitters *less* in its last digit, which is the legibility
 *   problem #238 names and it does not arise in the direction this adds.
 * - A distance at one decimal: 0.1 km is 100 m and 0.1 mi is 161 m. The mile
 *   reading is 1.6× coarser, and that is accepted — a ride total is not read
 *   to the hundred metres. A caller that genuinely needs finer, like the game
 *   HUD counting down the last kilometre, passes `decimals` explicitly; that
 *   is a precision argument and not a unit one, which is the distinction this
 *   module exists to keep.
 * - A small distance at no decimals: a foot is 0.3 m, so whole feet are finer
 *   than whole metres.
 * - A mass at one decimal: 0.1 kg is 3.5 oz and 0.1 lb is 1.6 oz, so both are
 *   finer than a rider can weigh themselves to. It is one decimal rather than
 *   none because a rider who types 71.5 and reads back 72 would reasonably
 *   conclude the box discarded what they typed — which is the *appearance* of
 *   the defect `roundedMassStoreFactory` stands for, arriving from the display
 *   side.
 *
 * ## The mass tier arrived with its first caller, deliberately
 *
 * ⚠️ ADR 0020 D-1 put weight inside the switch's scope and then declined to
 * ship a formatter for it: *"`units/format.ts` deliberately does not ship a
 * mass formatter with no caller — `format.ts`'s own history records what
 * happens to an exported helper written ahead of its second caller."*
 * [#325](https://github.com/openzigs/onyourleft/issues/325) is that caller —
 * the settings screen where a rider enters their own weight — so the tier is
 * added here in the same change that renders one, and not before.
 */

import {
  KILOGRAMS_PER_POUND,
  kilometresPerHour,
  kilometresPerHourToMetresPerSecond,
  METRES_PER_FOOT,
  METRES_PER_MILE,
  metresPerSecondToKilometresPerHour,
  metresPerSecondToMilesPerHour,
  milesPerHour,
  milesPerHourToMetresPerSecond,
  type Kilograms,
  type Metres,
  type MetresPerSecond,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

/**
 * A number and the unit it is in, never one without the other.
 *
 * ⚠️ **Two fields rather than one string, and that is a requirement rather
 * than an oversight** — `format.ts` §`formatSpeedValue` records why, and #238
 * did not change it: `ride/MetricGrid.tsx` renders the digits and the unit in
 * different elements at different sizes and announces them to a screen reader
 * as one sentence, and the HUD's `HudReading` carries them as separate fields
 * for the same reason. A combined `'36.0 km/h'` would have to be split apart
 * again to be rendered at all.
 *
 * {@link measurementText} is the one place they are joined, for the callers
 * that want a sentence.
 */
export interface Measurement {
  /** The digits, with no unit and no space. */
  readonly value: string;
  /** The label a rider reads beside them — `km/h`, `mi`, `ft`. Never empty. */
  readonly unit: string;
}

/** Metres in a kilometre. Named so the division below is not a bare 1000. */
const METRES_PER_KILOMETRE = 1000;

/** How many decimals a speed is shown to. @see the module note on rounding. */
const SPEED_DECIMALS = 1;

/** How many decimals a distance is shown to, unless a caller asks otherwise. */
export const DISTANCE_DECIMALS = 1;

/** The unit label a speed carries. */
export function speedUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

/** The unit label a ride-scale distance carries. */
export function distanceUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'mi' : 'km';
}

/** The unit label a segment-scale distance or an elevation carries. */
export function smallDistanceUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'ft' : 'm';
}

/** How many decimals a mass is shown to. @see the module note on rounding. */
const MASS_DECIMALS = 1;

/** The unit label a rider's weight carries. */
export function massUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'lb' : 'kg';
}

/**
 * A speed in the rider's units, as a number.
 *
 * The conversion itself is in `@onyourleft/domain` and is not repeated here:
 * every conversion in this program goes through that package so that the
 * device and a Phase 3 instance cannot disagree about a number. What belongs
 * on this side of the boundary is only which of the two to call.
 */
export function speedIn(speed: MetresPerSecond, units: UnitSystem): number {
  return units === 'imperial'
    ? metresPerSecondToMilesPerHour(speed)
    : metresPerSecondToKilometresPerHour(speed);
}

/** A ride-scale distance in the rider's units, as a number. */
export function distanceIn(distance: number, units: UnitSystem): number {
  return distance / (units === 'imperial' ? METRES_PER_MILE : METRES_PER_KILOMETRE);
}

/** A segment-scale distance or an elevation in the rider's units, as a number. */
export function smallDistanceIn(distance: number, units: UnitSystem): number {
  return units === 'imperial' ? distance / METRES_PER_FOOT : distance;
}

/**
 * A mass in the rider's units, as a number.
 *
 * ⚠️ **The one direction.** Kilograms are what is stored, so this divides; the
 * *other* direction — what a rider typed, into kilograms — is
 * `athlete/mass.ts` §`massToSave`, because a typed value can also be blank or
 * refused and that is a decision rather than a conversion. Both reach for the
 * same `@onyourleft/domain` constant, so the pair cannot drift.
 */
export function massIn(mass: Kilograms, units: UnitSystem): number {
  return units === 'imperial' ? mass / KILOGRAMS_PER_POUND : mass;
}

/**
 * A speed the rider **typed**, back in the canonical unit — the inverse of
 * {@link speedIn}, added by #326.
 *
 * ⚠️ **The second inward conversion in this client, and the first one *here*.**
 * #325's is `athlete/mass.ts` §`massToSave`, which lives beside its screen
 * because a typed mass can also be blank or refused and that is a decision
 * rather than a conversion. A wind speed is refused too — by
 * `game/wind-choice.ts`, which is the decision half — so what is left for this
 * module is the conversion, and it belongs with the outward one it inverts.
 * The number in the box is in whichever unit that rider's screens show, and a
 * caller dividing by 3.6 itself is precisely what this module and
 * `no-inline-units.ts` exist to stop.
 *
 * @throws {UnitError} if `value` is not a finite, non-negative number — which
 * is a real branch here and not a formality, because the argument came off a
 * keyboard. Callers turn it into a refusal a rider can act on.
 */
export function speedFrom(value: number, units: UnitSystem): MetresPerSecond {
  return units === 'imperial'
    ? milesPerHourToMetresPerSecond(milesPerHour(value))
    : kilometresPerHourToMetresPerSecond(kilometresPerHour(value));
}

/**
 * A speed, for display.
 *
 * The argument is a `MetresPerSecond` rather than a `number`, so a caller
 * holding a distance, a cadence or an unvalidated sensor reading cannot reach
 * this function at all — the same guard `formatSpeedValue` carried before
 * #238, kept because it is what stops the HUD's `* 3.6` coming back as a
 * `* 2.24`.
 */
export function formatSpeed(speed: MetresPerSecond, units: UnitSystem): Measurement {
  return { value: speedIn(speed, units).toFixed(SPEED_DECIMALS), unit: speedUnit(units) };
}

/**
 * A ride-scale distance, for display.
 *
 * @param decimals overrides the default precision. A *precision* argument, not
 * a unit one — see the module note on rounding for which callers have a reason
 * to pass it.
 */
export function formatDistance(
  distance: Metres,
  units: UnitSystem,
  decimals: number = DISTANCE_DECIMALS,
): Measurement {
  return { value: distanceIn(distance, units).toFixed(decimals), unit: distanceUnit(units) };
}

/**
 * A segment-scale distance or an elevation, for display.
 *
 * Takes a plain `number` rather than a `Metres`, deliberately: an altitude is
 * **signed** — `AltitudeMetres` permits below sea level — and a signature that
 * refused those would push a cast into the one caller that draws an altitude
 * trace. Rounded to whole units, so a negative value rounds towards zero the
 * way `Math.round` does rather than away from it, which is what a reader
 * expects of a height.
 */
export function formatSmallDistance(distance: number, units: UnitSystem): Measurement {
  return {
    value: String(Math.round(smallDistanceIn(distance, units))),
    unit: smallDistanceUnit(units),
  };
}

/**
 * A rider's weight, for display.
 *
 * The argument is a `Kilograms` rather than a `number` for `formatSpeed`'s
 * reason: a caller holding a distance, a power or a stored figure it has not
 * validated cannot reach this function at all, and the brand is what stops a
 * *pounds* value being handed to something that will divide by the pound again.
 */
export function formatMass(mass: Kilograms, units: UnitSystem): Measurement {
  return { value: massIn(mass, units).toFixed(MASS_DECIMALS), unit: massUnit(units) };
}

/**
 * A measurement as one string, `'36.0 km/h'`.
 *
 * For the callers that build a sentence rather than a cell — the elevation
 * summary a screen reader hears, a refusal message, a table row's text. The
 * separator is a plain space, which is what every existing sentence in this
 * client used before #238.
 */
export function measurementText(measurement: Measurement): string {
  return `${measurement.value} ${measurement.unit}`;
}
