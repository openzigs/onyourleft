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
 * crossed — the lap the ride's page lists, whose averages the save works out
 * again once every sample of it is final (`laps.ts`, "Worked out twice"). This
 * file formats, subtracts two moving times and chooses words; #94's fourth
 * criterion (`fields.ts`) is why it does no more.
 *
 * ## Said twice over, once each way
 *
 * The lap is SHOWN as a notice for {@link LAP_NOTICE_SECONDS} of ride and
 * SAID once through the HUD's one region (`announce.ts`, `lap-ended`) to a
 * rider who has announcements on — it respects that setting, since the third
 * pass. The
 * comparison is words — *faster*, *slower*, *best* — never a colour or an
 * arrow, so nothing about a lap is carried by colour alone (SC 1.4.1).
 *
 * ⚠️ **Compared only with whole laps of the same length — the lap before AND
 * the best.** A part lap stopped short, and a lap of another course ridden
 * earlier in the same recording is a different road: "12 s faster" than
 * either, or "Best: lap 1" of another road, would be a sentence about nothing.
 *
 * ⚠️ **Every comparison is made on the times as they are SHOWN**: whole
 * seconds, floored, as `format.ts` §`formatDuration` writes them. A
 * difference taken from the unrounded times and then rounded reads `1 s` or
 * `3 s` beside `9:52` and `9:50`; and a best decided on a fraction of a
 * second reads *Same time as lap 1* and *Your best lap of this ride* in one
 * notice. So the best lap here is the one with the shortest shown time, the
 * earlier on a tie — on one course `laps.ts` §`bestLapIndex`'s lap, which the
 * ride's page marks, except where two laps differ by less than the second the
 * page shows them to. (In a recording of two courses the page marks the one
 * lap with the highest average speed; the HUD says which lap of THIS course
 * is the best, and says "of this course" rather than "of this ride" when
 * it does.)
 *
 * ⚠️ **"The same course" is "the same length", to the float.** A lap carries
 * no identity of the course it was ridden on: its distance is
 * `profile.totalDistance` passed through unchanged, so one course always
 * compares equal with itself, and two different courses of exactly one length
 * would be taken for one. An identity on the lap is the sturdier rule, and it
 * is #1318's to add with laps that have no course at all.
 *
 * ⚠️ **No score and no trademarked name** (docs/agents/scope-and-ip.md §6):
 * plain averages, plainly named.
 *
 * Pure: no clock, no state.
 */

import type { UnitSystem } from '@onyourleft/store';

import { formatDuration } from '../../format';
import { lapAverageSpeed, type LapFigures } from '../../recording/laps';
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

/** A time in the whole seconds it is shown and said in. */
function shownSeconds(time: number): number {
  return Math.max(0, Math.floor(time));
}

/** How this lap's time compares with another's, shown and said — or neither when they are level. */
function against(
  lap: LapFigures,
  other: LapFigures,
  otherNumber: number,
): { readonly text: string; readonly sentence: string } {
  // Floored before subtracting, so the difference is the difference of the
  // two times shown beside it.
  const delta = shownSeconds(lap.movingTime) - shownSeconds(other.movingTime);
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

  // The best of the whole laps of THIS course, this one among them, by the
  // time each is shown with — and nothing to say with fewer than two.
  let best: number | undefined;
  let counted = 0;
  laps.forEach((other, at) => {
    if (!comparable(other)) {
      return;
    }
    counted += 1;
    const quickest = best === undefined ? undefined : laps[best];
    if (
      quickest === undefined ||
      shownSeconds(other.movingTime) < shownSeconds(quickest.movingTime)
    ) {
      best = at;
    }
  });
  if (counted < 2) {
    best = undefined;
  }
  const bestLap = best === undefined ? undefined : laps[best];
  // ⚠️ "Of this ride" only where that is true (#1316's third review). The
  // best is the best of THIS course; with one course ridden that is the best
  // of the ride, and with two it is not — the ride's page marks one lap of
  // the whole ride, by average speed. So a recording with whole laps of
  // another course says "of this course" and "on this course" instead.
  const oneCourse = laps.every((other) => other.partial === true || comparable(other));
  const which = String((best ?? index) + 1);
  const standing =
    best === undefined || bestLap === undefined
      ? undefined
      : best === index
        ? oneCourse
          ? { text: 'Your best lap of this ride.', sentence: 'Your best lap of this ride.' }
          : { text: 'Your best lap of this course.', sentence: 'Your best lap of this course.' }
        : oneCourse
          ? {
              text: `Best: lap ${which}, ${formatDuration(bestLap.movingTime)}.`,
              sentence: `Your best is lap ${which}, ${spokenDuration(bestLap.movingTime)}.`,
            }
          : {
              text: `Best on this course: lap ${which}, ${formatDuration(bestLap.movingTime)}.`,
              sentence: `Your best on this course is lap ${which}, ${spokenDuration(bestLap.movingTime)}.`,
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
