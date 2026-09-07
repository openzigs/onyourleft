// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning zones and best efforts into the words on the screen.
 *
 * Separate from the components that render them so the two decisions that are
 * easy to get wrong are testable without a DOM:
 *
 * ## Rounding a boundary is a display decision, and it must not invent a gap
 *
 * A power zone boundary is a fraction of a threshold, so it is very often not a
 * whole watt: 0.91 × 250 is 227.5. Rounding zone 3's **upper** and zone 4's
 * **lower** independently is how a table comes to read `190–227` above
 * `228–265`, with 227.6 W in no zone at all — a display that contradicts the
 * rule `zones.ts` spent a file establishing.
 *
 * {@link zoneRange} therefore rounds **one** number and shows it in both rows:
 * a zone's upper bound is displayed by rounding the next zone's lower bound,
 * which is the same value, so the two rows agree by construction rather than by
 * both being rounded carefully. The caption
 * {@link ZONE_BOUNDARY_NOTE} states the inclusivity so a reader can place a
 * value that lands exactly on a shown number.
 *
 * ## A percentage of what
 *
 * {@link zoneShare} is a share of the **covered** time, not of the ride's
 * moving time. The two are not the same number — `zones.ts` records both
 * reasons — and a column of percentages that does not add to 100 is the kind of
 * thing a rider notices and cannot explain. So the shares add to 100 and the
 * coverage is stated separately, in {@link coverageNote}.
 */

import type { TimeInZones, Zone } from '@onyourleft/domain';

import { formatDuration } from '../format';

/** Said once, under every zone table. @see zoneRange */
export const ZONE_BOUNDARY_NOTE =
  'A range includes its lower value and excludes its upper, so a reading of exactly the shown ' +
  'number is in the zone that starts there.';

/**
 * A zone's range, in its own unit.
 *
 * The top zone is open above and says so in words rather than with an infinity
 * symbol, which a screen reader renders as "infinity" and a rider reads as a
 * bug.
 */
export function zoneRange(zone: Zone, unit: string): string {
  const lower = Math.round(zone.lower);
  if (zone.upper === undefined) {
    return `${String(lower)} ${unit} and above`;
  }
  return `${String(lower)}–${String(Math.round(zone.upper))} ${unit}`;
}

/**
 * A zone's share of the covered time, as a whole percentage with a `%`.
 *
 * `0%` when nothing was covered at all, rather than `NaN%`: a ride whose sensor
 * said nothing has a real answer to "how much of it was in zone 3", and it is
 * none of it.
 */
export function zoneShare(seconds: number, covered: number): string {
  if (covered <= 0) {
    return '0%';
  }
  return `${String(Math.round((seconds / covered) * 100))}%`;
}

/**
 * How much of the ride the zone table is describing, in words.
 *
 * `undefined` when the channel covered the whole of the moving time, which is
 * the ordinary case and does not deserve a sentence. A partial cover always
 * gets one: a total that is short by six per cent with no explanation is worse
 * than no total.
 */
export function coverageNote(covered: number, movingTime: number): string | undefined {
  if (movingTime <= 0 || covered >= movingTime) {
    return undefined;
  }
  const percent = Math.round((covered / movingTime) * 100);
  return (
    `This covers ${formatDuration(covered)} of the ride's ${formatDuration(movingTime)} moving ` +
    `time (${String(percent)}%) — the sensor reported nothing for the rest.`
  );
}

/**
 * A curve duration as a label a rider reads: `5s`, `20min`, `2h`.
 *
 * Not `formatDuration`'s clock shape. `0:05` and `20:00` are the right form for
 * *elapsed* time, where the reader is comparing against a stopwatch; these are
 * the *names* of efforts — "my twenty-minute power" is a thing people say and
 * "my 20:00 power" is not.
 */
export function durationLabel(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  if (totalSeconds < 3600) {
    const minutes = totalSeconds / 60;
    return `${Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)}min`;
  }
  const hours = totalSeconds / 3600;
  return `${Number.isInteger(hours) ? String(hours) : hours.toFixed(1)}h`;
}

/** The width of a zone's bar, as a percentage string for an inline style. */
export function barWidth(seconds: number, covered: number): string {
  if (covered <= 0) {
    return '0%';
  }
  return `${String((seconds / covered) * 100)}%`;
}

/** Rows for one zone table, already formatted. */
export interface ZoneRow {
  readonly index: number;
  readonly name: string;
  readonly range: string;
  readonly time: string;
  readonly share: string;
  readonly width: string;
}

/** @see ZoneRow */
export function zoneRows(
  zones: readonly Zone[],
  time: TimeInZones,
  unit: string,
): readonly ZoneRow[] {
  return zones.map((zone, index) => {
    const total = time.perZone[index] ?? 0;
    return {
      index: zone.index,
      name: zone.name,
      range: zoneRange(zone, unit),
      time: formatDuration(total),
      share: zoneShare(total, time.covered),
      width: barWidth(total, time.covered),
    };
  });
}
