// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD says as a lap of the course ends — #1312: that lap's time and
 * averages, and how it compares with the rider's previous lap and with their
 * best lap of this ride.
 *
 * ## Nothing here is computed about the lap
 *
 * Every figure is the recording's own (`recording/laps.ts`), handed back
 * through `trainer-port.ts` §`GameTrainerPort.courseLine` as the line is
 * crossed — so the lap the HUD states is the row the ride's page lists. This
 * file formats, subtracts two moving times and chooses words; #94's fourth
 * criterion (`fields.ts`) is why it does no more.
 *
 * ## Said twice over, once each way
 *
 * The lap is SHOWN as a notice for {@link LAP_NOTICE_SECONDS} of ride and
 * SAID once through the HUD's one region (`announce.ts`, `lap-ended`). The
 * comparison is words — *faster*, *slower*, *best* — never a colour or an
 * arrow, so nothing about a lap is carried by colour alone (SC 1.4.1).
 *
 * ⚠️ **Compared only with whole laps of the same length.** A part lap stopped
 * short, and a lap of another course ridden earlier in the same recording is a
 * different road: "12 s faster" than either would be a sentence about nothing.
 * The best lap is `laps.ts` §`bestLapIndex`'s, which is the page's rule too.
 *
 * ⚠️ **No score and no trademarked name** (docs/agents/scope-and-ip.md §6):
 * plain averages, plainly named.
 *
 * Pure: no clock, no state.
 */

import type { UnitSystem } from '@onyourleft/store';

import { formatDuration } from '../../format';
import { bestLapIndex, lapAverageSpeed, type LapFigures } from '../../recording/laps';
import { formatSpeed, measurementText } from '../../units/format';

/**
 * How long a finished lap stays on the HUD, in seconds of RIDE.
 *
 * Long enough to read four figures and a comparison at a handlebar's distance
 * twice over, and short of `GameView` §`STANDING_NOTICE_SECONDS`: on a phone a
 * notice costs the route panel's cell (#437), and this one comes round every
 * lap. A judgement, stated as one.
 */
export const LAP_NOTICE_SECONDS = 10;

/** A finished lap, as the HUD shows it and as its one region says it. */
export interface LapSummary {
  /** The notice's label: which lap. */
  readonly label: string;
  /** The notice's text: the figures, then the comparison. */
  readonly text: string;
  /** The one sentence for the HUD's region. */
  readonly sentence: string;
}

/** `5 minutes 12 seconds`, `48 seconds`, `1 hour 2 minutes 3 seconds` — a time as it is heard. */
function spokenDuration(totalSeconds: number): string {
  // Floored, as `format.ts` §`formatDuration` floors: the two say one time.
  const whole = Math.max(0, Math.floor(totalSeconds));
  const parts: (readonly [number, string])[] = [
    [Math.floor(whole / 3600), 'hour'],
    [Math.floor((whole % 3600) / 60), 'minute'],
    [whole % 60, 'second'],
  ];
  const said = parts
    .filter(([count]) => count > 0)
    .map(([count, unit]) => `${String(count)} ${unit}${count === 1 ? '' : 's'}`);
  return said.length === 0 ? '0 seconds' : said.join(' ');
}

/** How this lap's time compares with another's, shown and said — or neither when they are level. */
function against(
  lap: LapFigures,
  other: LapFigures,
  otherNumber: number,
): { readonly text: string; readonly sentence: string } {
  const delta = Math.round(lap.movingTime - other.movingTime);
  const than = `lap ${String(otherNumber)}`;
  if (delta === 0) {
    return { text: `Same time as ${than}.`, sentence: `The same time as ${than}.` };
  }
  const word = delta < 0 ? 'faster' : 'slower';
  const by = Math.abs(delta);
  return {
    text: `${String(by)} s ${word} than ${than}.`,
    sentence: `${spokenDuration(by)} ${word} than ${than}.`,
  };
}

/**
 * The summary of the lap that has just ended — the LAST of `laps`, which is
 * every lap of the recording so far. `undefined` for a part lap (the game ride
 * has ended, and there is no HUD left to show it on) and for no laps at all.
 */
export function lapSummary(laps: readonly LapFigures[], units: UnitSystem): LapSummary | undefined {
  const index = laps.length - 1;
  const lap = laps[index];
  if (lap === undefined || lap.partial === true) {
    return undefined;
  }
  const number = index + 1;
  const speed = lapAverageSpeed(lap);
  const speedShown = speed === undefined ? undefined : measurementText(formatSpeed(speed, units));
  const shown = [
    formatDuration(lap.movingTime),
    lap.averagePower === undefined ? undefined : `${String(lap.averagePower)} W`,
    speedShown,
    lap.averageHeartRate === undefined ? undefined : `${String(lap.averageHeartRate)} bpm`,
  ].filter((part) => part !== undefined);
  const said = [
    spokenDuration(lap.movingTime),
    lap.averagePower === undefined ? undefined : `average power ${String(lap.averagePower)} watts`,
    speedShown === undefined ? undefined : `average speed ${speedShown}`,
    lap.averageHeartRate === undefined
      ? undefined
      : `average heart rate ${String(lap.averageHeartRate)}`,
  ].filter((part) => part !== undefined);

  const comparable = (other: LapFigures): boolean =>
    other.partial !== true && other.distance === lap.distance;
  let previous = index - 1;
  while (previous >= 0 && !comparable(laps[previous] as LapFigures)) {
    previous -= 1;
  }
  const earlier = laps[previous];
  const compared = earlier === undefined ? undefined : against(lap, earlier, previous + 1);

  const best = bestLapIndex(laps);
  const bestLap = best === undefined ? undefined : laps[best];
  const standing =
    best === undefined || bestLap === undefined
      ? undefined
      : best === index
        ? { text: 'Your best lap of this ride.', sentence: 'Your best lap of this ride.' }
        : {
            text: `Best: lap ${String(best + 1)}, ${formatDuration(bestLap.movingTime)}.`,
            sentence: `Your best is lap ${String(best + 1)}, ${spokenDuration(bestLap.movingTime)}.`,
          };

  const label = `Lap ${String(number)}`;
  return {
    label,
    text: [`${shown.join(' · ')}.`, compared?.text, standing?.text]
      .filter((part) => part !== undefined)
      .join(' '),
    sentence: [`${label}: ${said.join(', ')}.`, compared?.sentence, standing?.sentence]
      .filter((part) => part !== undefined)
      .join(' '),
  };
}
