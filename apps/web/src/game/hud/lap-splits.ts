// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A loop's lap splits on the HUD — #2080: the lap in progress and its time,
 * the last lap and the best, each with its average power.
 *
 * ## The laps are the recording's, and nothing else's
 *
 * {@link lapSplits} is handed the laps the recording stated as each line was
 * crossed (`ride/controller.ts` §`noteCourseLine`, through `GameTrainerPort`
 * §`courseLine`) and the recorder's own lap time (`HudInput.lapSeconds`). It
 * works nothing out from the game's clock or its odometer, so the times it
 * shows are the rows the saved ride lists: `ride/controller.test.ts` §"#2080"
 * reads both. A lap is numbered by its place in the recording, as the lap's
 * notice numbers it (`lap-text.ts` §`lapSummary`) and as the ride's page does
 * (`ordinal + 1`).
 *
 * ## Which lap is the best
 *
 * The rules the lap's notice already uses, so the two never name different
 * laps: only a WHOLE lap counts (a part lap is where the ride ended), only one
 * with a moving time to its name (a lap ridden while the recording was paused
 * has none — #1316's fourth review), and only a lap of the same course as the
 * last one (the same distance), so a lap of another course is never this
 * course's best. Level times go to the earlier lap. A time is compared in the
 * whole seconds it is shown in.
 *
 * ## A dash, never a nought
 *
 * Nothing recording: no lap time, so the lap in progress reads a dash. No lap
 * finished yet: *Last* and *Best* read dashes. A lap with no power reading
 * reads a dash for its power — never `0 W`, which would be a reading.
 *
 * Pure: no clock, no state.
 */

import { formatDuration } from '../../format';
import type { LapFigures } from '../../recording/laps';

import { NO_READING } from './fields';

/** One row of the panel: which lap, its time and its average power, as shown. */
export interface LapSplitRow {
  /** `Now`, `Last` or `Best`. */
  readonly label: string;
  /** The lap's number in the recording, from 1, or {@link NO_READING}. */
  readonly lap: string;
  /** Its moving time, `m:ss` (`format.ts` §`formatDuration`), or {@link NO_READING}. */
  readonly time: string;
  /** Its average power, `231 W`, or {@link NO_READING}. */
  readonly power: string;
}

/** The panel's three rows, in the order they are drawn. */
export interface LapSplitsView {
  readonly now: LapSplitRow;
  readonly last: LapSplitRow;
  readonly best: LapSplitRow;
}

/** The words of the panel. ⚠️ New rider-facing words, for the owner's approval. */
export const LAP_SPLITS_TEXT = {
  /** The panel's accessible name. */
  name: 'Lap splits',
  now: 'Now',
  last: 'Last',
  best: 'Best',
  /** The column headings. */
  lap: 'Lap',
  time: 'Time',
  power: 'Avg power',
  /** The control that swaps the panel with a race's standings. */
  showLaps: 'Show laps',
  showStandings: 'Show standings',
} as const;

/** A time in the whole seconds it is shown in. */
function shownSeconds(time: number): number {
  return Math.max(0, Math.floor(time));
}

function row(label: string, laps: readonly LapFigures[], index: number | undefined): LapSplitRow {
  const lap = index === undefined ? undefined : laps[index];
  if (lap === undefined || index === undefined) {
    return { label, lap: NO_READING, time: NO_READING, power: NO_READING };
  }
  return {
    label,
    lap: String(index + 1),
    // A lap ridden while the recording was paused has no time to state.
    time: shownSeconds(lap.movingTime) === 0 ? NO_READING : formatDuration(lap.movingTime),
    power: lap.averagePower === undefined ? NO_READING : `${String(lap.averagePower)} W`,
  };
}

/**
 * The panel's rows, from every lap of the recording so far and the recorder's
 * time on the lap in progress. @see the module note.
 *
 * @param laps every lap the recording has stated, in order — the last answer
 *   of `GameTrainerPort.courseLine`, or the saved ride's rows.
 * @param lapSeconds the recorder's time on the lap in progress, or
 *   `undefined` with no lap open (nothing recording, or the ride over).
 */
export function lapSplits(
  laps: readonly LapFigures[],
  lapSeconds: number | undefined,
): LapSplitsView {
  let last: number | undefined;
  for (let index = laps.length - 1; index >= 0; index -= 1) {
    if (laps[index]?.partial !== true) {
      last = index;
      break;
    }
  }
  const course = last === undefined ? undefined : laps[last]?.distance;
  let best: number | undefined;
  laps.forEach((lap, index) => {
    if (lap.partial === true || lap.distance !== course || shownSeconds(lap.movingTime) === 0) {
      return;
    }
    const quickest = best === undefined ? undefined : laps[best];
    if (
      quickest === undefined ||
      shownSeconds(lap.movingTime) < shownSeconds(quickest.movingTime)
    ) {
      best = index;
    }
  });
  const open = lapSeconds !== undefined && Number.isFinite(lapSeconds);
  return {
    now: {
      label: LAP_SPLITS_TEXT.now,
      // The lap in progress follows every lap the recording has finished.
      lap: open ? String((last ?? -1) + 2) : NO_READING,
      time: open ? formatDuration(lapSeconds) : NO_READING,
      // The recording states a lap's average when the lap ends, and not before.
      power: NO_READING,
    },
    last: row(LAP_SPLITS_TEXT.last, laps, last),
    best: row(LAP_SPLITS_TEXT.best, laps, best),
  };
}
