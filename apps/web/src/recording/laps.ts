// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap of a course, as the RECORDING states it — #1312.
 *
 * ## Whose numbers these are
 *
 * A lap has two halves, and each comes from the one place that knows it:
 *
 * | figure | from |
 * |---|---|
 * | where the lap began and ended | the instants the rider crossed the line, on the ride's clock |
 * | its moving time | the recording engine's own `movingTime` at those two instants |
 * | its power, heart rate and cadence | the recorded series between them — the samples the save writes |
 * | its distance and its climb | the course (`game/course-laps.ts`): the simulation's road, not a sensor |
 *
 * ## Worked out twice, and the SAVED one is from the saved samples
 *
 * What the recording keeps of a lap is the first, second and fourth rows:
 * `@onyourleft/store` §`RecordedCourseLap`, two marks and what the course
 * says. The third is worked out from samples, and a slot can still take a
 * reading for `DEFAULT_LATE_TOLERANCE_SECONDS` after the line is crossed.
 *
 * - **As the line is crossed**, {@link courseLap} over the lap's slots as they
 *   then stand, for the HUD (`ride/controller.ts` §`noteCourseLine`).
 * - **As the ride is saved**, {@link lapsToSave} over the series the save
 *   writes, when every slot is final. That is the row the ride's page lists.
 *
 * ⚠️ **So the two can differ, by a late reading in a lap's last slots and by
 * nothing else**: an average or a best a watt or a beat apart. The times, the
 * distance and the climb are the marks' and the course's, and are the same in
 * both. A recovered ride has only the second (`RecordedCourseLap` is in the
 * checkpoint's header), and gets the same rows.
 *
 * ⚠️ **The moving time is the recorder's, and there is no second clock**
 * (`game/hud/fields.ts` §`HudInput.movingSeconds` says why). So a lap's moving
 * time leaves out exactly what the ride's does — a pause and an auto-pause.
 *
 * ⚠️ **But a mark can hold moving time the ride later gives back**, and the
 * saved rows are held to the ride ({@link heldToTheRide}, #1312's third
 * review note). An automatic pause is back-dated to when the rider stopped
 * (`packages/domain` §`advanceTo`), so a line crossed between the readings
 * that ran the clock on and the tick that begins the pause is marked at a
 * moving time the ride no longer has. Left alone, the laps of such a ride
 * add up to more than the ride moved. The HUD's figure, worked out as the
 * line is crossed, is the mark's; the saved row is the held one.
 *
 * ⚠️ **The averages are over the readings that EXIST**, `finish.ts`
 * §`averagePowerOf`'s rule: a dropout is missing data, not a stretch at
 * nought. While the recording is paused the engine takes no reading
 * (`packages/domain` §`RecordingOutcome` `paused`), so a pause inside a lap
 * adds nothing to its averages either: they are averages over the lap's
 * moving time.
 *
 * ⚠️ **The average speed is the course's distance over the moving time**
 * ({@link lapAverageSpeed}), not the mean of the speed channel. That channel
 * is the trainer's own wheel speed; the lap's distance is the road the game
 * rode, and a speed made of one over a distance made of the other would be a
 * figure about neither.
 *
 * Pure: it reads no clock and no store. `recording/recorder.ts` holds the laps
 * of the recording in progress and checkpoints them; `finish.ts` writes them.
 */

import {
  beatsPerMinute,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  watts,
  type Metres,
  type MetresPerSecond,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';
import type {
  ActivityId,
  LapId,
  NewLap,
  RecordedCourseLap,
  RecordedLapMark,
  StreamChannelValue,
} from '@onyourleft/store';

/** What a lap states, before it has an activity to belong to. */
export type LapFigures = Omit<NewLap, 'id' | 'activityId' | 'ordinal'>;

/** One crossing of the line: the instant, and the recorder's moving time at it. */
export type LapMark = RecordedLapMark;

/** What the course says about the stretch just ridden. */
export interface CourseStretch {
  /** How far along the road it was: a whole lap's length, or as far as the rider got. */
  readonly distance: Metres;
  /** Metres climbed over it, or `undefined` where the course cannot say. */
  readonly ascent: Metres | undefined;
  /** The rider stopped before the line. */
  readonly partial: boolean;
}

/**
 * What a game ride tells the recording about the line of its course.
 *
 * - `started`: the rider has left the line, so a lap begins here.
 * - `lap`: the stretch since the last mark is over — the line was crossed, or
 *   the game ride ended part-way round (`partial`). `again` says whether
 *   another lap begins at once: yes over a loop's line, no at the end of a
 *   point-to-point course or of the game ride.
 * - `ended`: the game ride is over with nothing more to state — it ended on
 *   the line, or after a point-to-point course was finished. No lap is open
 *   afterwards.
 * - `progress`: how far round the lap in progress the rider has got, and what
 *   that stretch climbs — #1322. Says nothing ended; it is what a recording
 *   that dies before the line saves its part lap from.
 */
export type CourseLineEvent =
  | { readonly kind: 'started' }
  | ({ readonly kind: 'lap'; readonly again: boolean } & CourseStretch)
  | { readonly kind: 'ended' }
  | ({ readonly kind: 'progress' } & Omit<CourseStretch, 'partial'>);

/** The part of a recorded series a lap is worked out from. */
export interface LapSeries {
  readonly startedAt: UnixSeconds;
  readonly sampleInterval: Seconds;
  readonly sampleCount: number;
  readonly channels: {
    readonly [Channel in 'power' | 'heartRate' | 'cadence']?:
      readonly (StreamChannelValue[Channel] | undefined)[] | undefined;
  };
}

/** The mean and the highest of the readings that exist in `[from, to)`. */
function summarised(
  samples: readonly (number | undefined)[] | undefined,
  from: number,
  to: number,
): { readonly mean: number; readonly highest: number } | undefined {
  if (samples === undefined) {
    return undefined;
  }
  let total = 0;
  let count = 0;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = from; index < to && index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample !== undefined) {
      total += sample;
      count += 1;
      highest = Math.max(highest, sample);
    }
  }
  return count === 0 ? undefined : { mean: Math.round(total / count), highest };
}

/** What {@link lapSlots} reads of a series: where its slots are. */
type LapGrid = Pick<LapSeries, 'startedAt' | 'sampleInterval' | 'sampleCount'>;

/**
 * The slots a lap owns: from the slot it began in up to, and not including,
 * the slot it ended in — so two laps in a row share no sample and leave none
 * out between them.
 */
export function lapSlots(
  grid: LapGrid,
  from: LapMark,
  to: LapMark,
): { readonly first: number; readonly end: number } {
  const slot = (at: UnixSeconds): number =>
    Math.min(
      grid.sampleCount,
      Math.max(0, Math.floor((at - grid.startedAt) / grid.sampleInterval)),
    );
  return { first: slot(from.at), end: slot(to.at) };
}

/**
 * The lap between two marks, from the samples of `series` in its slots
 * ({@link lapSlots}).
 *
 * `offset` is the index in the recording of `series`' first slot, for a caller
 * that hands over only the lap's own stretch of it (`session.slice`) rather
 * than a copy of the whole ride.
 */
export function courseLap(
  series: LapSeries,
  from: LapMark,
  to: LapMark,
  course: CourseStretch,
  offset = 0,
): LapFigures {
  const slots = lapSlots(
    {
      startedAt: series.startedAt,
      sampleInterval: series.sampleInterval,
      sampleCount: offset + series.sampleCount,
    },
    from,
    to,
  );
  const first = Math.max(0, slots.first - offset);
  const end = Math.max(first, slots.end - offset);
  const power = summarised(series.channels.power, first, end);
  const heartRate = summarised(series.channels.heartRate, first, end);
  const cadence = summarised(series.channels.cadence, first, end);
  return {
    startedAt: from.at,
    elapsedTime: seconds(Math.max(0, to.at - from.at)),
    movingTime: seconds(Math.max(0, to.movingTime - from.movingTime)),
    distance: course.distance,
    ...(power === undefined
      ? {}
      : { averagePower: watts(power.mean), maxPower: watts(power.highest) }),
    ...(heartRate === undefined
      ? {}
      : {
          averageHeartRate: beatsPerMinute(heartRate.mean),
          maxHeartRate: beatsPerMinute(heartRate.highest),
        }),
    ...(cadence === undefined ? {} : { averageCadence: revolutionsPerMinute(cadence.mean) }),
    ...(course.ascent === undefined ? {} : { ascent: course.ascent }),
    ...(course.partial ? { partial: true as const } : {}),
  };
}

/** A lap as the recording keeps it, between the two marks that ended and began it. */
export function riddenLap(from: LapMark, to: LapMark, course: CourseStretch): RecordedCourseLap {
  return {
    from,
    // ⚠️ **A lap never ends before it began, on either clock** (#1316's
    // fourth review). The recorder's moving time is NOT monotonic: an
    // automatic pause is back-dated to the instant the rider stopped
    // (`packages/domain` §`advanceTo`), while a reading may already have
    // moved the session's clock past that instant — so a mark taken between
    // that reading and the tick that begins the pause carries moving time the
    // pause then takes back, and a lap ended just after would move for less
    // than nothing. Such a lap moved for no time, and says so.
    to: {
      at: to.at < from.at ? from.at : to.at,
      movingTime: to.movingTime < from.movingTime ? from.movingTime : to.movingTime,
    },
    distance: course.distance,
    ...(course.ascent === undefined ? {} : { ascent: course.ascent }),
    ...(course.partial ? { partial: true as const } : {}),
  };
}

/** What a kept lap states, over `series` ({@link courseLap}). */
export function lapFiguresOf(series: LapSeries, lap: RecordedCourseLap, offset = 0): LapFigures {
  return courseLap(
    series,
    lap.from,
    lap.to,
    { distance: lap.distance, ascent: lap.ascent, partial: lap.partial === true },
    offset,
  );
}

/** What {@link lapAverageSpeed} and {@link bestLapIndex} read of a lap. */
type TimedLap = Pick<LapFigures, 'distance' | 'movingTime' | 'partial'>;

/**
 * A lap's average speed: its distance over its MOVING time. `undefined` for a
 * lap with no moving time, where a speed would be a division by nought.
 */
export function lapAverageSpeed(lap: TimedLap): MetresPerSecond | undefined {
  return lap.movingTime > 0 ? metresPerSecond(lap.distance / lap.movingTime) : undefined;
}

/**
 * Which lap was the best: the whole lap with the highest average speed, the
 * earlier one on a tie — or `undefined` with fewer than two whole laps, where
 * "best" says nothing.
 *
 * ⚠️ **A part lap is never the best and never counted**: it stopped short, so
 * its time is not a time for the course. By speed rather than by time so that
 * laps of two courses ridden in one recording are still compared fairly; on
 * one course the two orders are the same.
 */
export function bestLapIndex(laps: readonly TimedLap[]): number | undefined {
  let best: number | undefined;
  let bestSpeed = 0;
  let whole = 0;
  laps.forEach((lap, index) => {
    const speed = lap.partial === true ? undefined : lapAverageSpeed(lap);
    if (speed === undefined) {
      return;
    }
    whole += 1;
    if (speed > bestSpeed) {
      best = index;
      bestSpeed = speed;
    }
  });
  return whole >= 2 ? best : undefined;
}

/**
 * The laps of a ride with every mark's moving time held to no more than any
 * LATER mark's, nor the ride's own — so the laps' moving times add up to no
 * more than the ride's.
 *
 * ⚠️ **Moving time only ever runs forwards; a mark that reads more than a
 * later one is a mark a back-dated pause took time back from** (the header,
 * "But a mark can hold…"). Walking back from the end of the ride, each mark
 * is lowered to the lowest moving time at or after it, which is the most the
 * ride can have moved by then. Then lap by lap the moving times are the
 * differences of a sequence that never falls, from at least nought to at most
 * the ride's — and add up to no more than the ride's.
 *
 * Only the moving times change: the instants, and so the elapsed times and
 * the samples a lap's averages are worked out from, are the marks'.
 */
function heldToTheRide(
  ridden: readonly RecordedCourseLap[],
  rideMovingTime: Seconds,
): readonly RecordedCourseLap[] {
  let ceiling: number = rideMovingTime;
  const held: RecordedCourseLap[] = [];
  for (let index = ridden.length - 1; index >= 0; index -= 1) {
    const lap = ridden[index];
    if (lap === undefined) {
      continue;
    }
    const to = Math.min(lap.to.movingTime, ceiling);
    const from = Math.min(lap.from.movingTime, to);
    ceiling = from;
    held.unshift({
      ...lap,
      from: { at: lap.from.at, movingTime: seconds(from) },
      to: { at: lap.to.at, movingTime: seconds(to) },
    });
  }
  return held;
}

/**
 * The lap rows to write for a saved ride, in the order they were ridden,
 * worked out from `series` — the samples the save writes.
 *
 * ⚠️ **From the saved series and not from what the HUD was told** (the header,
 * "Worked out twice"): by now every slot is final, so a row's averages are
 * what anything reading the ride's samples between its two marks works out.
 *
 * ⚠️ **Their moving times are held to `rideMovingTime`**, the ride's own
 * ({@link heldToTheRide}): a row never says a lap moved for longer than the
 * ride it is a lap of.
 *
 * ⚠️ **None at all unless the rider completed the course at least once.** A
 * ride abandoned part-way round its first lap has no laps: one row reading
 * "part lap" would be the whole ride said twice.
 */
export function lapsToSave(
  ridden: readonly RecordedCourseLap[],
  series: LapSeries,
  activityId: ActivityId,
  newLapId: () => LapId,
  rideMovingTime: Seconds,
): readonly NewLap[] {
  if (!ridden.some((lap) => lap.partial !== true)) {
    return [];
  }
  return heldToTheRide(ridden, rideMovingTime).map((lap, ordinal) => ({
    ...lapFiguresOf(series, lap),
    id: newLapId(),
    activityId,
    ordinal,
  }));
}
