// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's running totals — how far, how much climbing, what average power,
 * since #2387 how much work and how fast on average, and since #2434 what
 * calorie estimate — worked out ONE way,
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
  caloriesFromWork,
  HeartRateCaloriesFold,
  joules,
  metres,
  metresPerSecond,
  recordedAscent,
  RecordedAscentFold,
  rideCalories,
  TimeInZonesFold,
  watts,
  type CalorieEstimate,
  type CalorieRider,
  type Joules,
  type Metres,
  type MetresPerSecond,
  type RecordedChannels,
  type RecordedSeries,
  type RecordingSession,
  type Seconds,
  type TimeInZones,
  type Watts,
  type Zone,
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
  /**
   * The calorie estimate so far, or `undefined` with nothing to estimate it
   * from — #2434's *Calories*. {@link recordedRideCalories}, the function the
   * saved ride's figure is worked out by, so the HUD's figure at the end is the
   * saved one. Optional for {@link energy}'s reason.
   */
  readonly calories?: CalorieEstimate | undefined;
  /**
   * Whether the recorded series holds a heart-rate reading — what the reason
   * under *Calories*' dash is worked out from (`detail/CaloriesFact.tsx`
   * §`noCaloriesReason`), as the ride's page works it out from the saved
   * ride's channels. The recording's, not the live strap's, so a strap that
   * drops mid-ride does not change the reason (#2434's review). Optional for
   * {@link energy}'s reason.
   */
  readonly recordedHeartRate?: boolean | undefined;
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
  return power === undefined ? undefined : averageOf(powerSums(power, 0));
}

/**
 * One walk of the power channel: the readings that exist added up, and each
 * for its sample's length — the sums {@link rideAveragePower} and
 * {@link rideEnergy} are worked out from, so {@link rideTotals} walks it once
 * a recompute for both and for the calorie estimate (#2434's review).
 */
interface PowerSums {
  readonly total: number;
  readonly work: number;
  readonly count: number;
}

function powerSums(power: readonly (Watts | undefined)[], sampleInterval: number): PowerSums {
  let total = 0;
  let work = 0;
  let count = 0;
  for (const sample of power) {
    if (sample !== undefined) {
      total += sample;
      work += sample * sampleInterval;
      count += 1;
    }
  }
  return { total, work, count };
}

function averageOf(sums: PowerSums): Watts | undefined {
  // ⚠️ Divided by the readings that EXIST, not by the ride's length. A dropout
  // is missing data, not a stretch at zero watts, and averaging over the whole
  // series would make a ride with a flaky meter look easier than it was.
  return sums.count === 0 ? undefined : watts(Math.round(sums.total / sums.count));
}

function workOf(sums: PowerSums): Joules | undefined {
  return sums.count === 0 ? undefined : joules(sums.work);
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
export function rideEnergy(
  series: Pick<RecordedSeries<StreamChannelValue>, 'channels' | 'sampleInterval'>,
): Joules | undefined {
  const power = series.channels.power;
  return power === undefined ? undefined : workOf(powerSums(power, series.sampleInterval));
}

/**
 * A recorded ride's calorie estimate — #2433, and **the one place** a recorded
 * ride's figure is worked out, so the figure saved with the ride
 * (`finish.ts` §`rideToSave`) and the one the ride HUD shows ({@link rideTotals},
 * #2434) are the same function over the same series.
 *
 * From the ride's work ({@link rideEnergy}) when it has a power reading, else
 * from its heart-rate channel with the rider's inputs, else none —
 * `@onyourleft/domain` §`rideCalories` holds the rules and the sources. The
 * importer calls it too, over a decoded file's channels (`import-batch.ts`).
 * Here rather than in `finish.ts` since #2434, because `finish.ts` imports this
 * module and {@link rideTotals} needs it too.
 */
export function recordedRideCalories(
  series: Pick<RecordedSeries<StreamChannelValue>, 'channels' | 'sampleInterval'>,
  rider: CalorieRider,
): CalorieEstimate | undefined {
  return caloriesFrom(series, rider, rideEnergy(series));
}

/** {@link recordedRideCalories} with the ride's work already worked out. */
function caloriesFrom(
  series: Pick<RecordedSeries<StreamChannelValue>, 'channels' | 'sampleInterval'>,
  rider: CalorieRider,
  work: Joules | undefined,
): CalorieEstimate | undefined {
  return rideCalories({
    work,
    heartRate: series.channels.heartRate,
    sampleInterval: series.sampleInterval,
    rider,
  });
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
  return lapsClimbed(laps);
}

/** What the laps say was climbed: a game ride's climb. @see rideClimbed */
function lapsClimbed(laps: readonly Pick<RecordedCourseLap, 'ascent'>[]): Metres | undefined {
  const stated = laps.filter((lap) => lap.ascent !== undefined);
  if (stated.length === 0) {
    return undefined;
  }
  return metres(stated.reduce((sum, lap) => sum + (lap.ascent as number), 0));
}

/**
 * All of them, over one series and its laps.
 *
 * `rider` is what the heart-rate calorie estimate needs to know
 * (`athlete/calorie-inputs.ts` §`calorieRiderFor`); none, and a heart-rate
 * ride has no *Calories* while a ride with power still does.
 */
export function rideTotals(
  series: RecordedSeries<StreamChannelValue>,
  laps: readonly Pick<RecordedCourseLap, 'ascent'>[],
  rider: CalorieRider = {},
): RideTotals {
  const power = series.channels.power;
  const sums = power === undefined ? undefined : powerSums(power, series.sampleInterval);
  const energy = sums === undefined ? undefined : workOf(sums);
  return {
    distance: rideDistance(series),
    climbed: rideClimbed(series, laps),
    averagePower: sums === undefined ? undefined : averageOf(sums),
    energy,
    calories: caloriesFrom(series, rider, energy),
    recordedHeartRate: series.channels.heartRate?.some((sample) => sample !== undefined) ?? false,
  };
}

/**
 * What a running fold reads a recording through: the recorder's session.
 * `sealedCount` is how many leading slots can no longer change, so those are
 * folded once and held; the slots after them can still take a late reading,
 * so they are folded again, on a copy, every time.
 */
export type RunningSource = Pick<
  RecordingSession<StreamChannelValue>,
  'sampleCount' | 'sealedCount' | 'slice'
>;

/** One slot at a time, and a copy that goes on alone. */
interface SlotFold<F> {
  add(channels: RecordedChannels<StreamChannelValue>, at: number): void;
  copy(): F;
}

/**
 * A fold over every slot of a recording so far, worked out from the slots it
 * has not held yet rather than from the first slot again — #2283. The HUD's
 * totals and its time in zones were each `series()`, a copy of every channel
 * of the whole ride, once a sample: a cost that grew with the ride.
 */
class Running<F extends SlotFold<F>> {
  readonly #source: RunningSource;
  readonly #held: F;
  /** How many leading slots {@link #held} has had: the sealed ones, once each. */
  #folded: number;

  /**
   * `from` is the first slot folded — #2263: a lap in progress begins part-way
   * through the recording, and the slots before it are never read.
   */
  constructor(source: RunningSource, start: F, from = 0) {
    this.#source = source;
    this.#held = start;
    this.#folded = from;
  }

  /**
   * A fold that has had every slot so far, in order — or, with `end`, every
   * slot before it (#2263: a lap owns the slots up to the one it ends in).
   */
  now(end = Number.POSITIVE_INFINITY): F {
    const count = Math.min(this.#source.sampleCount, end);
    const sealed = Math.min(this.#source.sealedCount, count);
    const slice = this.#source.slice(this.#folded, count);
    let at = 0;
    for (; at < sealed - this.#folded; at += 1) this.#held.add(slice.channels, at);
    this.#folded += at;
    const open = this.#held.copy();
    for (; at < slice.sampleCount; at += 1) open.add(slice.channels, at);
    return open;
  }
}

/** {@link rideTotals}' sums, one slot at a time. */
class TotalsFold implements SlotFold<TotalsFold> {
  distance = 0;
  powerTotal = 0;
  work = 0;
  powerCount = 0;
  heartRateRead = false;
  /** Whether the recording has an altitude channel, which decides where the climb comes from. */
  altitudeChannel = false;
  ascent = new RecordedAscentFold();
  heartRateCalories: HeartRateCaloriesFold;

  readonly sampleInterval: Seconds;

  constructor(sampleInterval: Seconds, rider: CalorieRider) {
    this.sampleInterval = sampleInterval;
    this.heartRateCalories = new HeartRateCaloriesFold(sampleInterval, rider);
  }

  add(channels: RecordedChannels<StreamChannelValue>, at: number): void {
    // Each sum is added to in the order `rideTotals` adds to it, so that the
    // two are the same number and not merely close (`totals.test.ts`).
    const speed = channels.speed?.[at];
    if (speed !== undefined) this.distance += speed * this.sampleInterval;
    const power = channels.power?.[at];
    if (power !== undefined) {
      this.powerTotal += power;
      this.work += power * this.sampleInterval;
      this.powerCount += 1;
    }
    const heartRate = channels.heartRate?.[at];
    if (heartRate !== undefined) this.heartRateRead = true;
    this.heartRateCalories.add(heartRate);
    if (channels.altitude !== undefined) {
      this.altitudeChannel = true;
      this.ascent.add(channels.altitude[at]);
    }
  }

  copy(): TotalsFold {
    const next = new TotalsFold(this.sampleInterval, {});
    next.distance = this.distance;
    next.powerTotal = this.powerTotal;
    next.work = this.work;
    next.powerCount = this.powerCount;
    next.heartRateRead = this.heartRateRead;
    next.altitudeChannel = this.altitudeChannel;
    next.ascent = this.ascent.copy();
    next.heartRateCalories = this.heartRateCalories.copy();
    return next;
  }

  totals(laps: readonly Pick<RecordedCourseLap, 'ascent'>[]): RideTotals {
    const sums = { total: this.powerTotal, work: this.work, count: this.powerCount };
    const energy = workOf(sums);
    const heartRateEnergy = this.heartRateCalories.energy;
    return {
      distance: metres(this.distance),
      climbed: this.altitudeChannel ? this.ascent.ascent : lapsClimbed(laps),
      averagePower: averageOf(sums),
      energy,
      // `rideCalories`' order: the work when there is any, else the heart rate.
      calories:
        energy !== undefined
          ? { energy: caloriesFromWork(energy), basis: 'power' }
          : heartRateEnergy === undefined
            ? undefined
            : { energy: heartRateEnergy, basis: 'heart-rate' },
      recordedHeartRate: this.heartRateRead,
    };
  }
}

/**
 * {@link rideTotals} of a recording in progress, worked out from the samples
 * since the last time rather than from the whole series — #2283. The same
 * figures: `totals.test.ts` holds a three-hour ride to it sample by sample.
 * One per recording and rider: a new rider is a new fold, because each
 * heart-rate sample's estimate depends on who the rider is.
 */
export class RunningRideTotals {
  readonly #running: Running<TotalsFold>;

  constructor(source: RunningSource, sampleInterval: Seconds, rider: CalorieRider = {}) {
    this.#running = new Running(source, new TotalsFold(sampleInterval, rider));
  }

  /** The ride so far, with `laps` the laps so far and the lap in progress last. @see rideTotals */
  totals(laps: readonly Pick<RecordedCourseLap, 'ascent'>[]): RideTotals {
    return this.#running.now().totals(laps);
  }
}

/** The power readings that exist, added up and counted, one slot at a time. */
class PowerMeanFold implements SlotFold<PowerMeanFold> {
  total = 0;
  count = 0;

  add(channels: RecordedChannels<StreamChannelValue>, at: number): void {
    const power = channels.power?.[at];
    if (power !== undefined) {
      this.total += power;
      this.count += 1;
    }
  }

  copy(): PowerMeanFold {
    const next = new PowerMeanFold();
    next.total = this.total;
    next.count = this.count;
    return next;
  }
}

/**
 * The average power of the lap in progress — #2263, the lap splits' *Now*
 * row: the readings from the lap's first slot to the last one kept, worked
 * out from the samples since the last time, as {@link RunningRideTotals} is.
 * The rule a lap's own figure is worked out by when it ends (`laps.ts`
 * §`stretchFigures`): the mean of the readings that exist, rounded to a whole
 * watt, so a lap's *Now* figure at the line is the figure *Last* then shows.
 * One per lap: a lap that begins again is a new fold.
 */
export class RunningLapPower {
  readonly #running: Running<PowerMeanFold>;

  /** `from` is the lap's first slot in the recording (`laps.ts` §`lapSlots`). */
  constructor(source: RunningSource, from: number) {
    this.#running = new Running(source, new PowerMeanFold(), Math.max(0, from));
  }

  /**
   * The lap's average power over its slots before `end` — the slot it would
   * end in, were the line crossed now (`laps.ts` §`lapSlots`) — or
   * `undefined` while it has no reading.
   */
  average(end: number): Watts | undefined {
    const fold = this.#running.now(end);
    return averageOf({ total: fold.total, work: 0, count: fold.count });
  }
}

/** `timeInZones` over the power channel, one slot at a time. */
class PowerZonesFold implements SlotFold<PowerZonesFold> {
  readonly zones: TimeInZonesFold;

  constructor(zones: TimeInZonesFold) {
    this.zones = zones;
  }

  add(channels: RecordedChannels<StreamChannelValue>, at: number): void {
    this.zones.add(channels.power?.[at]);
  }

  copy(): PowerZonesFold {
    return new PowerZonesFold(this.zones.copy());
  }
}

/**
 * `timeInZones(zones, series.channels.power ?? [], sampleInterval)` of a
 * recording in progress, worked out from the samples since the last time —
 * #2283, beside {@link RunningRideTotals}. One per recording and set of zones.
 */
export class RunningPowerZoneTime {
  readonly #running: Running<PowerZonesFold>;

  constructor(source: RunningSource, zones: readonly Zone[], sampleInterval: Seconds) {
    this.#running = new Running(
      source,
      new PowerZonesFold(new TimeInZonesFold(zones, sampleInterval)),
    );
  }

  /** The time in each zone so far. */
  time(): TimeInZones {
    return this.#running.now().zones.time;
  }
}
