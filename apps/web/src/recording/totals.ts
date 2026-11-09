// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's running totals — how far, how much climbing, what average power,
 * and since #2387 how much work and how fast on average — worked out ONE way,
 * for the save and for the screen alike — #2076.
 *
 * ## Why one function
 *
 * #2076's first criterion: the HUD's *Distance*, *Climbed* and *Avg power*
 * are read back from the recorder, the source the saved ride is written from,
 * and equal the saved ride's own totals when it ends. Two functions — one in
 * `finish.ts` for the save, one beside the HUD — would be two answers that
 * agree until somebody tunes one of them. So `finish.ts` writes the saved
 * activity's distance and average power from {@link rideDistance} and
 * {@link rideAveragePower}, and the controller hands the screen
 * {@link rideTotals} over the same series.
 *
 * ## The climb, and why it is the laps' on a game ride
 *
 * A ride RECORDED with altitude readings climbed what `route/profile.ts`
 * §`recordedAscent` says they climbed — the run rule the saved ride's
 * `rideFacts.ascent` is counted by. A game ride records no altitude (`channels.ts`:
 * no BLE source gives one), so its saved ride has no such figure; what it has
 * is its LAPS, each stating the course's climb over the stretch ridden
 * (`game/course-laps.ts`), worked out by the same run rule. So on a ride with
 * no altitude the climb is the laps' total, the open lap's progress included,
 * which is what the saved ride's laps add up to once the game says where the
 * rider stopped. `undefined` — a dash, never `0 m` — when neither says
 * anything: a ride nobody measured the climb of did not climb nought metres.
 */

import {
  joules,
  metres,
  metresPerSecond,
  recordedAscent,
  watts,
  type Joules,
  type Metres,
  type MetresPerSecond,
  type RecordedSeries,
  type Watts,
} from '@onyourleft/domain';
import type { RecordedCourseLap, StreamChannelValue } from '@onyourleft/store';

/** What the HUD shows of the ride so far. */
export interface RideTotals {
  /** How far, as the saved activity's distance is worked out. */
  readonly distance: Metres;
  /** How much climbing, or `undefined` when nothing measured any. @see the module note */
  readonly climbed: Metres | undefined;
  /** The mean of the power readings that exist, or `undefined` with none. */
  readonly averagePower: Watts | undefined;
  /**
   * The work the rider did, or `undefined` with no power reading — #2387's
   * *Energy*. {@link rideTotals} always says; optional so a figure kept
   * before #2387 (a test's, a harness's) reads as none rather than nought.
   * @see rideEnergy
   */
  readonly energy?: Joules | undefined;
}

/**
 * How far the rider went, integrated from the speed channel.
 *
 * ⚠️ **Integrated rather than read**, because there is no distance channel —
 * ADR 0011's eight are power, heart rate, cadence, speed, latitude, longitude,
 * altitude and temperature. An imported file usually states a distance or
 * carries per-point ones; a recorded ride has neither.
 *
 * **A sample with no speed adds no distance.** That is the same refusal
 * `ghost-source.ts` makes about a dropout: carrying the last known speed across
 * a hole invents ground the rider may never have covered. It means a ride whose
 * speed sensor dropped reports short — which is visible and conservative, where
 * inventing the distance is neither.
 */
export function rideDistance(series: RecordedSeries<StreamChannelValue>): Metres {
  const speed = series.channels.speed;
  if (speed === undefined) {
    return metres(0);
  }
  let total = 0;
  for (const sample of speed) {
    if (sample !== undefined) {
      total += sample * series.sampleInterval;
    }
  }
  return metres(total);
}

/** The mean of the readings that exist. `undefined` for a ride with no power. */
export function rideAveragePower(
  power: readonly (Watts | undefined)[] | undefined,
): Watts | undefined {
  if (power === undefined) {
    return undefined;
  }
  let total = 0;
  let count = 0;
  for (const sample of power) {
    if (sample !== undefined) {
      total += sample;
      count += 1;
    }
  }
  // ⚠️ Divided by the readings that EXIST, not by the ride's length. A dropout
  // is missing data, not a stretch at zero watts, and averaging over the whole
  // series would make a ride with a flaky meter look easier than it was.
  return count === 0 ? undefined : watts(Math.round(total / count));
}

/**
 * The work the rider did: each power reading that exists for its sample's
 * length, added up — #2387. Our own plain figure, shown in kilojoules, and no
 * load metric of any name (CLAUDE.md §6).
 *
 * **A sample with no power adds no work**, as a sample with no speed adds no
 * distance ({@link rideDistance}): a dropout is missing data, and carrying the
 * last reading across it invents work the rider may never have done. So a
 * flaky meter reports short, which is visible and conservative. `undefined` —
 * a dash, never `0 kJ` — when there is no reading at all: a ride nobody
 * measured the power of did not do nought joules of work.
 */
export function rideEnergy(series: RecordedSeries<StreamChannelValue>): Joules | undefined {
  const power = series.channels.power;
  if (power === undefined) {
    return undefined;
  }
  let total = 0;
  let count = 0;
  for (const sample of power) {
    if (sample !== undefined) {
      total += sample * series.sampleInterval;
      count += 1;
    }
  }
  return count === 0 ? undefined : joules(total);
}

/**
 * The ride's average speed — #2387: its distance over its MOVING time, as a
 * lap's is (`laps.ts` §`lapAverageSpeed`), so a pause does not slow it. The
 * distance is {@link RideTotals.distance} and the moving time the recorder's
 * (`fields.ts` §`HudInput.movingSeconds`), the two figures the HUD shows as
 * *Distance* and *Moving*. `undefined` with no moving time, where a speed
 * would be a division by nought.
 */
export function rideAverageSpeed(
  distance: Metres,
  movingSeconds: number,
): MetresPerSecond | undefined {
  return Number.isFinite(movingSeconds) && movingSeconds > 0
    ? metresPerSecond(distance / movingSeconds)
    : undefined;
}

/**
 * How much the ride has climbed. @see the module note
 *
 * `laps` are the recording's laps so far and, last, the lap in progress as a
 * part lap — `Recorder.courseLaps` and its open lap.
 */
export function rideClimbed(
  series: RecordedSeries<StreamChannelValue>,
  laps: readonly Pick<RecordedCourseLap, 'ascent'>[],
): Metres | undefined {
  const altitude = series.channels.altitude;
  if (altitude !== undefined) {
    return recordedAscent(altitude);
  }
  const stated = laps.filter((lap) => lap.ascent !== undefined);
  if (stated.length === 0) {
    return undefined;
  }
  return metres(stated.reduce((sum, lap) => sum + (lap.ascent as number), 0));
}

/** All four, over one series and its laps. */
export function rideTotals(
  series: RecordedSeries<StreamChannelValue>,
  laps: readonly Pick<RecordedCourseLap, 'ascent'>[],
): RideTotals {
  return {
    distance: rideDistance(series),
    climbed: rideClimbed(series, laps),
    averagePower: rideAveragePower(series.channels.power),
    energy: rideEnergy(series),
  };
}
