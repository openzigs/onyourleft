// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A race's result, as sentences** — #785. The ONE function every line of a
 * result on this client is built by ({@link raceResultLines}), so the rule the
 * instance's publication holds (`apps/instance` §`publication.ts`) is held again
 * where the words are made:
 *
 * - **Beside another rider: W/kg, never watts** — ADR 0028's 2026-09-22
 *   amendment and ruling Q17. Watts beside W/kg over one window IS the
 *   declared mass, one division away, which Q4 refused to show. A flag is on
 *   the same side: its duration and its ceiling in W/kg, never a power.
 * - **On the rider's OWN line, both may be shown**, because both are their
 *   own: `ownWatts` is the rider's own mean power, which this device measured
 *   and nobody else is sent.
 * - **A rider who erased their account, or whom this rider may not see, is
 *   "a rider"** — a place, and nothing of theirs (ruling Q2, #83).
 *
 * Nothing here orders anybody: the order is the room's own, published after
 * the race (ADR 0028 D-7.7), and this only puts it into words.
 */

import type { RaceFlag, RaceResultRow } from '../net/rooms-port';

/** One line of a result, in parts a screen lays out. */
export interface RaceResultLine {
  /** "1st", "2nd"… or "Did not finish". */
  readonly place: string;
  /** The rider's name, "You", or "A rider". */
  readonly who: string;
  /** The time from the start to the line, or nothing for a rider who did not finish. */
  readonly time: string | undefined;
  /** Power-to-weight — and, on the rider's own line alone, their own watts beside it. */
  readonly figure: string | undefined;
  /** One sentence per flag, or none. Every rider sees every flag (ADR 0028 D-2 rule 3). */
  readonly flags: readonly string[];
  readonly you: boolean;
}

/** "A rider" — the place and nothing of theirs. */
export const UNNAMED_RIDER = 'A rider';

const ORDINAL_SUFFIX: Readonly<Record<string, string>> = { one: 'st', two: 'nd', few: 'rd' };
const ordinals = new Intl.PluralRules('en-GB', { type: 'ordinal' });

function ordinal(place: number): string {
  return `${String(place)}${ORDINAL_SUFFIX[ordinals.select(place)] ?? 'th'}`;
}

/** A duration as `h:mm:ss`, or `m:ss` under an hour. */
export function raceTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${ss}`
    : `${String(minutes)}:${ss}`;
}

/** A window's length, as a person says it. */
function windowOf(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? 'an hour' : `${String(seconds / 3600)} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? 'a minute' : `${String(seconds / 60)} minutes`;
  return `${String(seconds)} seconds`;
}

/** A flag, in words: its window and its ceiling, in W/kg. Never a power. */
export function flagText(flag: RaceFlag): string {
  return `Flagged: over ${flag.overWattsPerKilogram.toFixed(1)} W/kg for ${windowOf(flag.durationSeconds)}.`;
}

/**
 * THE lines of a race's result.
 *
 * @param ownWatts the rider's OWN mean power over the race, measured on this
 * device, shown on their own line only — or `undefined` for none.
 */
export function raceResultLines(
  rows: readonly RaceResultRow[],
  ownWatts?: number,
): readonly RaceResultLine[] {
  return rows.map((row) => {
    const ratio =
      row.wattsPerKilogram === null ? undefined : `${row.wattsPerKilogram.toFixed(1)} W/kg`;
    const own =
      row.you && ownWatts !== undefined && Number.isFinite(ownWatts)
        ? `${String(Math.round(ownWatts))} W`
        : undefined;
    return {
      place: row.place === null ? 'Did not finish' : ordinal(row.place),
      who: row.you ? 'You' : (row.displayName ?? UNNAMED_RIDER),
      time: row.finishMs === null ? undefined : raceTime(row.finishMs),
      figure: ratio === undefined ? own : own === undefined ? ratio : `${ratio}, ${own}`,
      flags: row.flags.map(flagText),
      you: row.you,
    };
  });
}
