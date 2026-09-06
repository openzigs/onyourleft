// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metres, MetresPerSecond, UnixSeconds, Watts } from '@onyourleft/domain';
import { metresPerSecondToKilometresPerHour } from '@onyourleft/domain';

/** The unit label a speed is shown in. */
export const SPEED_UNIT = 'km/h';

/** The unit label a distance is shown in. */
export const DISTANCE_UNIT = 'km';

/** The unit label an average power is shown in. */
export const POWER_UNIT = 'W';

/** Metres in a kilometre. Named so the division below is not a bare 1000. */
const METRES_PER_KILOMETRE = 1000;

/**
 * Format a speed for display, as digits without a unit.
 *
 * The conversion itself lives in `@onyourleft/domain` and is not repeated here:
 * every conversion in the program goes through that package so that the device
 * and a Phase 3 instance cannot disagree about a number. What belongs on this
 * side of the boundary is only the presentation decision — how many decimals,
 * and which unit label.
 *
 * The argument is a `MetresPerSecond` rather than a `number`, so a caller
 * holding a distance, a cadence or an unvalidated sensor reading cannot reach
 * this function at all. Validation happened when the quantity was constructed;
 * see `@onyourleft/domain`'s README.
 *
 * ⚠️ **Digits and unit are returned separately, and that is a requirement
 * rather than an oversight.** `ride/MetricGrid.tsx` renders the two in
 * different elements at different sizes, and announces them to a screen reader
 * as one sentence built by `metricSentence`. A single `'36.0 km/h'` string
 * would have to be split apart there to be rendered at all.
 *
 * This function replaced one that returned the combined string, which #143
 * found had lost its last production caller while `MetricGrid` carried its own
 * copy of the `.toFixed(1)` and the unit label. An exported helper with a test
 * and no caller survives refactors it should not, and two places deciding how
 * many decimals a speed has is exactly the disagreement this module exists to
 * prevent.
 */
export function formatSpeedValue(speed: MetresPerSecond): string {
  return metresPerSecondToKilometresPerHour(speed).toFixed(1);
}

/**
 * `3725` → `1:02:05`. Hours only when there are some.
 *
 * Moved here from `views/RideView.tsx` by #62, which needed the same format for
 * a library row's duration. It was exported from a view and tested there, and
 * copying it would have been the second place deciding how a duration reads —
 * which the note on {@link formatSpeedValue} above records as the mistake this
 * module exists to prevent. `RideView` imports it now.
 *
 * Takes a plain `number` rather than {@link Seconds}, deliberately: the live
 * ride screen counts elapsed seconds it has not made a quantity of, and a
 * signature that refused those would push a cast into the caller. Where a
 * caller *does* hold a `Seconds` — a stored ride's `elapsedTime` — it is
 * assignable, so nothing is lost at the stricter call site.
 */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${String(minutes)}:${pad(secs)}`;
}

/**
 * A stored distance in kilometres, as digits without a unit.
 *
 * One decimal, matching {@link formatSpeedValue}: a library row showing
 * `42.19` beside a speed showing `31.4` reads as two different kinds of
 * measurement rather than one ride.
 */
export function formatDistanceValue(distance: Metres): string {
  return (distance / METRES_PER_KILOMETRE).toFixed(1);
}

/** An average power as whole watts. A fractional watt is not a thing a rider reads. */
export function formatPowerValue(power: Watts): string {
  return String(Math.round(power));
}

/**
 * A ride's start, rendered **in the zone it was ridden in**.
 *
 * Not the viewer's zone. `ActivityRecord` stores `startedAtTimeZone` beside the
 * instant precisely so this is possible, and the reason is in that field's own
 * doc comment: a ride done at 7am in Lisbon is a 7am ride forever, and
 * re-rendering it as 8am because the rider has since flown to Paris is wrong in
 * a way they would notice and could not correct.
 *
 * An invalid zone — a hand-edited row, a zone this browser's ICU does not carry
 * — falls back to UTC rather than throwing. A library that refuses to list a
 * ride because of its time zone would be worse than one that lists it an hour
 * out, and the row is still identifiable by everything else on it.
 */
export function formatStartedAt(startedAt: UnixSeconds, timeZone: string): string {
  const at = new Date(startedAt * 1000);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(at);
  }
}
