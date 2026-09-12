// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The formatting decisions that do **not** depend on which units a rider reads
 * in: a duration, a power, and the instant a ride started.
 *
 * ⚠️ **Speed and distance are not here any more, and this file used to be
 * where they were.** A reviewer who remembers `SPEED_UNIT`, `DISTANCE_UNIT`,
 * `formatSpeedValue` and `formatDistanceValue` is reading the old file: #238
 * moved all four into `units/format.ts`, because a *constant* is exactly the
 * mechanism that cannot carry a preference, and the note on `formatSpeedValue`
 * about two places deciding how precise a speed is now applies one level up.
 * Nothing in this file is a unit a rider may choose — a watt is a watt in both
 * systems, and a minute is a minute — which is why these four stayed.
 */

import type { UnixSeconds, Watts } from '@onyourleft/domain';

/** The unit label an average power is shown in. Not a preference: see above. */
export const POWER_UNIT = 'W';

/**
 * `3725` → `1:02:05`. Hours only when there are some.
 *
 * Moved here from `views/RideView.tsx` by #62, which needed the same format for
 * a library row's duration. It was exported from a view and tested there, and
 * copying it would have been the second place deciding how a duration reads —
 * which the note at the top of `units/format.ts` records as the mistake these
 * two modules exist to prevent. `RideView` imports it now.
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
