// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's power curve, beside the all-time one — #2081.
 *
 * The best average power the ride held for each length of time from five
 * seconds to an hour, computed by the same function the Analysis screen's
 * duration bests are (`@onyourleft/domain` §`powerDurationCurve`), over the
 * same full-resolution power channel. That is what makes this ride's curve
 * equal to what Analysis' bests table would say of a library of this one
 * ride, and the all-time line equal to what that table says of the library
 * (`views/ActivityDetailView.test.tsx` holds both through the real store).
 *
 * ⚠️ **No second read of the power channel.** The curve is computed in
 * `detail/load.ts` §`loadTrace` from the full-resolution samples the power
 * chart's read has already decoded, and only its fifteen numbers leave there
 * — never the samples. The all-time line is Analysis' own library read
 * (`analysis/load.ts` §`loadLibraryBests`), asked only once the curve's
 * section scrolls into view.
 */

import {
  CURVE_DURATIONS,
  powerDurationCurve,
  type PowerDurationCurve,
  type PowerSeries,
} from '@onyourleft/domain';

import { durationLabel } from '../analysis/present';
import { formatPowerValue } from '../format';

/** The durations the ride page's curve is drawn over: five seconds to an hour (#2081). */
export const RIDE_CURVE_DURATIONS: readonly number[] = CURVE_DURATIONS.filter(
  (duration) => duration >= 5 && duration <= 3600,
);

/** What a table cell shows for a duration a curve has no effort for. */
export const NO_EFFORT = '—';

/** A curve cut to {@link RIDE_CURVE_DURATIONS}. */
export function onRideDurations(curve: PowerDurationCurve): PowerDurationCurve {
  return curve.filter((effort) => RIDE_CURVE_DURATIONS.includes(effort.duration));
}

/**
 * A ride's curve over {@link RIDE_CURVE_DURATIONS}, from its full-resolution
 * power samples. A ride whose every window spans a gap has an empty curve,
 * which is a fact about the ride rather than a failure.
 */
export function ridePowerCurve(samples: PowerSeries): PowerDurationCurve {
  return powerDurationCurve(samples, RIDE_CURVE_DURATIONS);
}

/** The value a curve has at `duration`, formatted, or {@link NO_EFFORT}. */
function cell(curve: PowerDurationCurve, duration: number): string {
  const effort = curve.find((each) => each.duration === duration);
  return effort === undefined ? NO_EFFORT : formatPowerValue(effort.power);
}

/**
 * The curve's table: one row per duration either curve has, the duration as
 * Analysis' bests table labels it, then this ride's best, then the all-time
 * best when there is one.
 */
export function curveRows(
  ride: PowerDurationCurve,
  allTime: PowerDurationCurve | undefined,
): readonly (readonly string[])[] {
  return RIDE_CURVE_DURATIONS.filter(
    (duration) =>
      ride.some((effort) => effort.duration === duration) ||
      (allTime ?? []).some((effort) => effort.duration === duration),
  ).map((duration) => [
    durationLabel(duration),
    cell(ride, duration),
    ...(allTime === undefined ? [] : [cell(allTime, duration)]),
  ]);
}

/** The durations the curve's description names: a sprint, a minute, five, twenty and sixty. */
const SAID_DURATIONS: readonly number[] = [5, 60, 300, 1200, 3600];

/**
 * The curve in one sentence, for a reader who is not looking at it — the
 * shape a sighted reader takes from the picture, as `TraceChart`'s
 * description is; the table under it holds every number.
 */
export function describeCurve(
  ride: PowerDurationCurve,
  allTime: PowerDurationCurve | undefined,
): string {
  if (ride.length === 0) {
    return 'Power curve: this ride has no stretch of power long enough to measure.';
  }
  const said = (curve: PowerDurationCurve): string =>
    SAID_DURATIONS.flatMap((duration) => {
      const effort = curve.find((each) => each.duration === duration);
      return effort === undefined
        ? []
        : [`${durationLabel(duration)} ${formatPowerValue(effort.power)} W`];
    }).join(', ');
  const longest = ride[ride.length - 1];
  const reach =
    longest === undefined || longest.duration === RIDE_CURVE_DURATIONS.at(-1)
      ? ''
      : ` The ride's curve stops at ${durationLabel(longest.duration)}.`;
  const best =
    allTime === undefined || allTime.length === 0 ? '' : ` All-time best: ${said(allTime)}.`;
  return `Power curve. This ride's best: ${said(ride)}.${reach}${best}`;
}
