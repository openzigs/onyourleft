// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the Ride screen says as a lap taken by hand ends — #1318: that lap's
 * time and figures, shown as a notice and said once through the screen's one
 * region (`RideAnnouncer.tsx`).
 *
 * ## Not the HUD's sentence
 *
 * `game/hud/lap-text.ts` §`lapSummary` says a course lap, and compares it with
 * the lap before and the best: laps of one course are one road, so a time
 * against a time is a sentence about the rider. Laps taken by hand are each as
 * long as the rider made them, so a time against a time is a sentence about
 * nothing, and none is made. The lap's DISTANCE is said instead, which a
 * course lap's sentence leaves out because every lap of the course has the
 * same one.
 *
 * Every figure is the recording's own (`recording/laps.ts`), worked out as
 * *Lap* is pressed; the saved row's averages are worked out again when the
 * ride is saved ("Worked out twice"). The time is the MOVING time, as on the
 * HUD and in the ride's lap table. Plain names only: no score and no
 * trademarked metric (docs/agents/scope-and-ip.md §6).
 *
 * Pure: no clock, no state.
 */

import type { UnitSystem } from '@onyourleft/store';

import { formatDuration } from '../format';
import {
  LAP_WHILE_PAUSED,
  LAP_WHILE_PAUSED_SAID,
  spokenDuration,
  type LapSummary,
} from '../game/hud/lap-text';
import type { LapFigures } from '../recording/laps';
import { formatDistance, measurementText, shownDistance } from '../units/format';

/** The summary of lap `number`, which has just ended. */
export function manualLapSummary(number: number, lap: LapFigures, units: UnitSystem): LapSummary {
  const label = `Lap ${String(number)}`;
  if (Math.floor(lap.movingTime) <= 0) {
    // The whole lap was ridden with the recording paused: no time to state,
    // as the HUD says of a course lap ridden so.
    return { label, text: LAP_WHILE_PAUSED, sentence: `${label}: ${LAP_WHILE_PAUSED_SAID}` };
  }
  // A ride with no speed channel has laps of no known distance, as the ride
  // has none: said as nothing, never as 0.00 km (`units/format.ts`).
  const shown = shownDistance(lap.distance);
  const distance = shown === undefined ? undefined : measurementText(formatDistance(shown, units));
  const text = [
    formatDuration(lap.movingTime),
    distance,
    lap.averagePower === undefined ? undefined : `${String(lap.averagePower)} W`,
    lap.averageHeartRate === undefined ? undefined : `${String(lap.averageHeartRate)} bpm`,
  ].filter((part) => part !== undefined);
  const said = [
    spokenDuration(lap.movingTime),
    distance,
    lap.averagePower === undefined ? undefined : `average power ${String(lap.averagePower)} watts`,
    lap.averageHeartRate === undefined
      ? undefined
      : `average heart rate ${String(lap.averageHeartRate)}`,
  ].filter((part) => part !== undefined);
  return {
    label,
    text: `${text.join(' · ')}.`,
    sentence: `${label}: ${said.join(', ')}.`,
  };
}
