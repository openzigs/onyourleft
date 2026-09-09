// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turning a finished recording into an activity the rider owns.
 *
 * ## The step that was missing, and what its absence looked like
 *
 * ⚠️ **Until this module, a recorded ride never became an activity.**
 * `confirmStop` ended at `recording().stop(at)`, and `import-batch.ts` was the
 * only caller of `putActivity` or `putStreamSet` in the whole client — so the
 * one thing that produced an activity was opening somebody else's file. A ride
 * you actually rode was checkpointed and then abandoned: absent from the
 * library (#62), from the analysis screens (#75–#78), from the matcher (#66)
 * and from export (#51), and offered back on next open as an *interrupted*
 * ride, because a completed recording and a crashed one looked the same on
 * disk.
 *
 * `CLAUDE.md` §1 describes the v0.1 milestone as *"pair a BLE trainer, record a
 * ride, store it, view it"*. This is the "store it" that was not there.
 *
 * ## The order is the whole safety argument
 *
 * The local copy is the only copy in existence — there is no server in this
 * milestone — so the sequence is chosen so that **no step can lose a ride**:
 *
 * 1. Write the activity. `putStreamSet` refuses a set with no activity behind
 *    it, so this has to be first; `import-batch.ts` says the same.
 * 2. Write the streams. If this throws, the activity is deleted again, because
 *    a row with no samples behind it is a ride that shows in the library and
 *    opens to nothing.
 * 3. **Only then** discard the checkpoint — and that step belongs to the
 *    caller, not here. Until the activity is durable the checkpoint is the only
 *    copy, and a discard that ran first would turn a failed save into a lost
 *    ride rather than a retryable one.
 *
 * ⚠️ **A failed save leaves the checkpoint in place, deliberately.** The rider
 * is then offered the ride back on next open, which is the recovery path
 * working as intended rather than a duplicate to apologise for.
 *
 * ## What this does NOT do, and why each is a decision rather than an omission
 *
 * - **It does not sign the record.** #61's signed activity record exists in
 *   `packages/store`, and *nothing in this client writes one* — an imported
 *   activity is not signed either. Signing only recorded rides would make the
 *   library's provenance inconsistent in a way no screen explains, so the
 *   consistent thing is to leave signing to whichever issue turns it on for
 *   every activity at once.
 * - **It does not run the segment matcher.** `segments/backfill.ts` is a
 *   resumable sweep over the library and picks up a newly saved ride the next
 *   time it runs. Matching inline would put a bounded-time sweep on the end of
 *   the one action a rider takes while sweaty and impatient.
 * - **It sets no `visibility`.** `putActivity` applies ADR 0004's `private`
 *   default. The importer makes the same call for the same reason.
 */

import {
  localDay,
  metres,
  watts,
  type Metres,
  type RecordedSeries,
  type Seconds,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';
import type {
  ActivityId,
  AthleteId,
  NewActivity,
  NewStreamSet,
  StreamChannelValue,
} from '@onyourleft/store';

import { loadSummaryOf } from '../analysis/summary';

/** The activity and the samples behind it, ready to write. */
export interface FinishedRide {
  readonly activity: NewActivity;
  readonly streams: NewStreamSet;
}

export interface RideToSaveInput {
  readonly id: ActivityId;
  readonly athleteId: AthleteId;
  /** Straight off the engine — already in the store's own channel shape. */
  readonly series: RecordedSeries<StreamChannelValue>;
  readonly elapsedTime: Seconds;
  readonly movingTime: Seconds;
  /** The IANA zone this ride was ridden in. Stored, never inferred later. */
  readonly timeZone: string;
  readonly now: UnixSeconds;
  /**
   * The workout ridden, when there was one — it names the ride.
   *
   * A rider who rode "Over-unders" wants to find "Over-unders" in the library,
   * and the alternative is every indoor session sharing one name.
   */
  readonly workoutName?: string | undefined;
}

/**
 * What a ride is called when no workout named it.
 *
 * The local calendar date, in ISO order, through the **same** `localDay` the
 * fitness chart aggregates on — so a ride's name and the day it is counted
 * against cannot disagree about which day it was. Deliberately not a
 * time-of-day word: those are another product's convention, and ADR 0009 keeps
 * this project's vocabulary its own even where the idea is free.
 */
export function rideName(startedAt: UnixSeconds, timeZone: string, workoutName?: string): string {
  const named = workoutName?.trim();
  return named === undefined || named === '' ? `Ride ${localDay(startedAt, timeZone)}` : named;
}

/**
 * Everything needed to write the ride, or `undefined` when there is nothing to
 * write.
 *
 * ⚠️ **A recording with no samples produces no activity.** A rider who opened
 * the screen, pressed Start and pressed Stop has not ridden, and an empty row
 * in the library is worse than no row: it cannot be opened, it cannot be
 * exported, and it is indistinguishable from a ride whose samples were lost.
 */
export function rideToSave(input: RideToSaveInput): FinishedRide | undefined {
  const { series } = input;
  if (series.sampleCount === 0) {
    return undefined;
  }

  const startedAt = series.startedAt;
  const power = series.channels.power;
  const average = averagePowerOf(power);

  const activity: NewActivity = {
    id: input.id,
    athleteId: input.athleteId,
    name: rideName(startedAt, input.timeZone, input.workoutName),
    startedAt,
    startedAtTimeZone: input.timeZone,
    elapsedTime: input.elapsedTime,
    movingTime: input.movingTime,
    distance: distanceOf(series),
    hasPosition: series.channels.latitude !== undefined,
    ...(average === undefined ? {} : { averagePower: average }),
    // Computed here because the samples are in hand, which is the importer's
    // reason too: the fitness chart's own criterion forbids decoding streams to
    // draw it, so the threshold-independent half has to be stored at write
    // time or never. `analysis/summary.ts` records why the load itself is not.
    ...(loadSummaryOf({ power, heartRate: series.channels.heartRate }, series.sampleInterval) ??
      {}),
    // ⚠️ No `originalFile`. That key names the file an activity was imported
    // from and this one was not imported — a recorded ride has no file behind
    // it, and inventing a name would put a ride in the deduplication index
    // under a hash of something that does not exist.
    createdAt: input.now,
  };

  return {
    activity,
    streams: {
      activityId: input.id,
      athleteId: input.athleteId,
      startedAt,
      sampleInterval: series.sampleInterval,
      sampleCount: series.sampleCount,
      // The engine's channels ARE the store's channels — `channels.ts` closes
      // that loop by instantiating the engine at `StreamChannelValue`, so a
      // gap is still a gap here and no conversion can flatten one to zero.
      channels: series.channels,
    },
  };
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
function distanceOf(series: RecordedSeries<StreamChannelValue>): Metres {
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
function averagePowerOf(power: readonly (Watts | undefined)[] | undefined): Watts | undefined {
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

/** What this module needs from the store, and nothing more. */
export interface RideSaveStore {
  putActivity(record: NewActivity): Promise<ActivityId>;
  putStreamSet(set: NewStreamSet): Promise<ActivityId>;
  deleteActivity(athleteId: AthleteId, id: ActivityId): Promise<boolean>;
}

export type RideSaveOutcome =
  | { readonly status: 'saved'; readonly id: ActivityId }
  /** Nothing was ridden. Not a failure, and the caller says so differently. */
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly error: Error };

/**
 * Write a finished ride, activity first.
 *
 * **Never throws.** The caller is `confirmStop`, and a rejection there would
 * leave the ride stopped on screen with no record of why — see the ordering
 * argument in this module's header for what the caller must do next, and must
 * not do before.
 */
export async function saveFinishedRide(
  store: RideSaveStore,
  finished: FinishedRide | undefined,
): Promise<RideSaveOutcome> {
  if (finished === undefined) {
    return { status: 'empty' };
  }
  try {
    await store.putActivity(finished.activity);
  } catch (error: unknown) {
    return { status: 'failed', error: asError(error) };
  }
  try {
    await store.putStreamSet(finished.streams);
  } catch (error: unknown) {
    // The activity goes back, for the importer's reason: a row with no samples
    // behind it shows in the library and opens to nothing. The cleanup's own
    // failure is swallowed so the rider is told the original cause — a full
    // disk — rather than whatever the tidy-up hit on the way out.
    await store
      .deleteActivity(finished.activity.athleteId, finished.activity.id)
      .catch(() => false);
    return { status: 'failed', error: asError(error) };
  }
  return { status: 'saved', id: finished.activity.id };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
